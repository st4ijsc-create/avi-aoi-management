using St4i.EdgeCore.Drivers;
using St4i.EdgeCore.Infrastructure;
using St4i.EdgeCore.Mapping;
using St4i.EdgeCore.Models;
using St4i.EdgeCore.Transport;
using St4i.EdgeCore.Uns;

namespace St4i.EdgeCore.Engine;

/// <summary>
/// Ties the whole EdgeCore together (Task 13, last EdgeCore piece before the WPF UI): reads
/// <see cref="DeviceReading"/>s from an <see cref="IDeviceDriver"/>, normalizes each via
/// <see cref="Normalizer"/> into a <see cref="CanonicalEnvelope"/>, sends it through an
/// <see cref="ITransport"/>, publishes an <see cref="ApiTraceEvent"/> for observability (the WPF
/// trace pane, doc-62), and raises <see cref="Committed"/> so subscribers (Task 14/21 — the fleet
/// dashboard/session runner) can react per-reading.
/// </summary>
public sealed class EdgePipeline
{
    private readonly IDeviceDriver _driver;
    private readonly MappingProfile _profile;
    private readonly ITransport _transport;
    private readonly EventBus _bus;
    private readonly Func<string, MappingProfile?>? _profileResolver;
    private readonly IUnsPublisher? _uns;

    /// <param name="profileResolver">G2-1 — optional (defaults to <see langword="null"/>, so every
    /// pre-existing call site/test that constructs an <see cref="EdgePipeline"/> without one keeps
    /// compiling and behaving byte-for-byte unchanged — every reading normalizes through the single
    /// shared <paramref name="profile"/>, exactly as before this task). When provided, invoked with each
    /// reading's <see cref="DeviceReading.MachineCode"/> to pick that machine's OWN
    /// <see cref="MappingProfile"/> (see <see cref="MappingProfileResolver"/>) instead of the shared one —
    /// a <see langword="null"/> result (machine code the resolver doesn't recognize) falls back to
    /// <paramref name="profile"/>, same as leaving this parameter unset entirely. This is deliberately a
    /// PER-READING lookup, not a per-pipeline one: there is still only ONE shared <see cref="EdgePipeline"/>
    /// for the whole fleet (per-machine pipelines are a later task) — this is what lets that one pipeline
    /// normalize each machine's readings against its own profile without a bigger refactor.</param>
    /// <param name="uns">G2-2 (UNS spine) — optional (defaults to <see langword="null"/>, so every
    /// pre-existing call site/test keeps compiling and behaving byte-for-byte unchanged: the ST4I HTTP
    /// path via <paramref name="transport"/> and the <see cref="Committed"/> event are NEVER affected by
    /// whether this is set). When provided, every normalized reading is ADDITIONALLY published (via
    /// <see cref="IUnsPublisher.PublishReading"/> — non-blocking, never throws) onto the local Unified
    /// Namespace's Sparkplug + retained semantic-mirror topics, alongside (never instead of) the existing
    /// transport send.</param>
    public EdgePipeline(
        IDeviceDriver driver, MappingProfile profile, ITransport transport, EventBus bus,
        Func<string, MappingProfile?>? profileResolver = null,
        IUnsPublisher? uns = null)
    {
        _driver = driver ?? throw new ArgumentNullException(nameof(driver));
        _profile = profile ?? throw new ArgumentNullException(nameof(profile));
        _transport = transport ?? throw new ArgumentNullException(nameof(transport));
        _bus = bus ?? throw new ArgumentNullException(nameof(bus));
        _profileResolver = profileResolver;
        _uns = uns;
    }

    /// <summary>Fired once per reading, immediately after its trace event is published — carries the
    /// raw reading plus whatever ack the transport produced (including a failed one; see remarks on
    /// <see cref="RunAsync"/> below about per-reading failures never killing the loop).</summary>
    public event Action<DeviceReading, TransportAck>? Committed;

    /// <summary>
    /// Drains <see cref="IDeviceDriver.ReadAsync"/> until <paramref name="ct"/> is cancelled. A
    /// transport-level failure for one reading (a normal outcome — e.g. a permanent-4xx
    /// <see cref="TransportAck"/> with Success=false, or <see cref="ITransport.SendAsync"/> throwing)
    /// is recorded (trace event + <see cref="Committed"/> with a failed ack, or a synthesized one for
    /// the throw case) rather than allowed to end the loop — one bad reading must not take down the
    /// rest of the fleet. Cancellation itself is NOT swallowed: once <paramref name="ct"/> fires, the
    /// enumerator's <see cref="OperationCanceledException"/> propagates out of <see cref="RunAsync"/>
    /// (the standard cancellable-async-iterator contract also used by <see cref="IDeviceDriver"/>).
    /// </summary>
    public async Task RunAsync(CancellationToken ct)
    {
        await foreach (var reading in _driver.ReadAsync(ct).WithCancellation(ct).ConfigureAwait(false))
        {
            var profile = _profileResolver?.Invoke(reading.MachineCode) ?? _profile;
            var env = Normalizer.Normalize(reading, profile);

            // G2-2 (UNS spine) — additive, non-blocking enqueue onto the local Unified Namespace; a
            // no-op when _uns is null (the common case until FleetHost/Program.cs wires one up). Placed
            // right after Normalize/before the transport send so it observes the exact same env every
            // HTTP call gets, and deliberately never awaited/guarded — IUnsPublisher's contract is that
            // it never throws and never blocks, so this can't affect _transport.SendAsync/Committed below.
            _uns?.PublishReading(reading, env);

            TransportAck ack;
            var started = DateTimeOffset.UtcNow;
            try
            {
                ack = await _transport.SendAsync(env, ct).ConfigureAwait(false);
            }
            catch (OperationCanceledException)
            {
                throw;
            }
            catch (Exception ex)
            {
                var latency = (long)(DateTimeOffset.UtcNow - started).TotalMilliseconds;
                ack = new TransportAck(Success: false, LatencyMs: latency, Error: ex.Message);
            }

            var trace = new ApiTraceEvent(
                At: DateTimeOffset.Now,
                MachineCode: reading.MachineCode,
                Kind: reading.Kind,
                Method: "POST",
                Path: env.Path,
                Status: ack.HttpStatus,
                LatencyMs: ack.LatencyMs,
                Mode: _transport.Mode,
                Duplicate: ack.Duplicate,
                Error: ack.Error);
            _bus.Publish(trace);

            Committed?.Invoke(reading, ack);
        }
    }
}
