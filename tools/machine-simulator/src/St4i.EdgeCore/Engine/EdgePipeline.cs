using St4i.EdgeCore.Drivers;
using St4i.EdgeCore.Infrastructure;
using St4i.EdgeCore.Mapping;
using St4i.EdgeCore.Models;
using St4i.EdgeCore.Transport;

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

    public EdgePipeline(IDeviceDriver driver, MappingProfile profile, ITransport transport, EventBus bus)
    {
        _driver = driver ?? throw new ArgumentNullException(nameof(driver));
        _profile = profile ?? throw new ArgumentNullException(nameof(profile));
        _transport = transport ?? throw new ArgumentNullException(nameof(transport));
        _bus = bus ?? throw new ArgumentNullException(nameof(bus));
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
            var env = Normalizer.Normalize(reading, _profile);

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
