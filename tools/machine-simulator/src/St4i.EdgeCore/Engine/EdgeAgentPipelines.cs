using St4i.Connector.Abstractions;
using St4i.Connector.Abstractions.Models;
using St4i.EdgeCore.Drivers;
using St4i.EdgeCore.Drivers.Simulators;
using St4i.EdgeCore.Fleet;
using St4i.EdgeCore.Infrastructure;
using St4i.EdgeCore.Mapping;
using St4i.EdgeCore.Models;
using St4i.EdgeCore.Transport;

namespace St4i.EdgeCore.Engine;

/// <summary>
/// 🔴 <b>Task E-3 (docs/plans/2026-08-04-dotE-fleet-core-extraction-blueprint.md) — the N-driver lifecycle
/// an EDGE AGENT gets: N drivers, N <see cref="EdgePipeline"/>s, one transport, and NO WAY TO WRITE TO A
/// DEVICE.</b>
///
/// <para><b>What it does.</b> Builds one pipeline per registered <see cref="ConnectorRegistry"/> instance,
/// plus (optionally) one for the built-in simulator group, runs them concurrently until the token is
/// cancelled, isolates a faulted pipeline from its siblings, and disposes every driver it built. That is
/// the whole surface.</para>
///
/// <para>🔴 <b>WHY THIS IS NOT A FACADE OVER <c>FleetCore</c>, decided on evidence rather than taste.</b>
/// Blueprint §2's shape is "avoid the hazard STRUCTURALLY, not by discipline", and the hazard here is
/// blueprint §3: an edge agent must not be able to write to a machine, because the HALT guard
/// (<c>EstopGuardRule</c>), RBAC and the audit trail all live in <c>St4i.EngineApi</c> and none of them is
/// reachable from this process. Three shapes were considered:
/// <list type="number">
/// <item><b>Wrap <c>FleetCore</c> in a read-only facade.</b> Rejected on a hard blocker, not a preference:
/// <c>FleetCore</c>'s constructor requires a <see cref="SwitchableTransport"/> AND a
/// <see cref="TransportCoordinator"/>, and a <see cref="TransportCoordinator"/> in turn requires a live
/// <see cref="LiveTransport"/> + <see cref="AutoTransport"/> pair. <c>EdgeWorker</c> resolves ONE
/// <see cref="ITransport"/> (Demo or Live, bound to one machine code). Standing up EngineApi's whole
/// transport-coordination stack inside the edge agent — for a lifecycle that never switches modes — would
/// have added far more machinery than it reused. It also drags in a roster resolver, the scenario engine,
/// the KPI counters, per-machine <c>MachineState</c> and <c>UpdateSettings</c>, none of which an edge agent
/// has any business owning.</item>
/// <item><b>Make only <c>TryWriteSetpointAsync</c>/<c>TryInvokeCommandAsync</c> <c>internal</c>.</b> Too
/// narrow. Starting from the SET OF MEMBERS rather than from the two named ones: <c>Estop</c>,
/// <c>ResetEstop</c>, <c>RegisterMachine</c>, <c>UpdateSettings</c>, <c>ApplyScenario</c>, <c>Burst</c>,
/// <c>RunHotFolderAoiDemoAsync</c> and <c>ApplyMode</c> all mutate, and two of them write files.</item>
/// <item><b>What was done: <c>FleetCore</c> is <c>internal</c> (visible only to <c>St4i.EngineApi</c>, via
/// the <c>InternalsVisibleTo</c> E-2 already added), and a second host gets THIS type instead.</b> One word
/// closes every member above for every host that is not the one owning the guard, and this class is
/// read-only by construction rather than by subtraction.</item>
/// </list></para>
///
/// <para>🔴 <b>"Read-only by construction" — the exact property, and its exact limit.</b>
/// <list type="bullet">
/// <item>No member of this class accepts, returns or exposes an <see cref="IDeviceDriver"/>. The caller
/// supplies <see cref="IMachineSimulator"/>s and a <see cref="ConnectorRegistry"/>; every driver is built,
/// owned and disposed HERE. So an edge host's own code holds no driver reference to cast to
/// <see cref="IWritableDeviceDriver"/>.</item>
/// <item>Nothing here resolves a machine code to a driver. That routing — the unguarded half of the write
/// path — exists only on <c>FleetCore</c>, which this class does not use and this assembly does not
/// export.</item>
/// <item><b>The limit, stated so nobody over-reads it:</b> the drivers this class builds ARE writable
/// objects (a <c>ModbusRtuDriver</c> implements <see cref="IWritableDeviceDriver"/>), and no visibility
/// change can alter that — the driver IS the thing that owns the port. What is structural is that reaching
/// one requires ADDING code that builds a driver, which is a visible, reviewable act, rather than casting a
/// reference the host already holds.</item>
/// </list></para>
///
/// <para><b>Fault isolation, and the one case where it must behave exactly like the single pipeline it
/// replaces.</b> Each pipeline runs on its own task. A cancellation is normal completion. Any other
/// exception faults that pipeline alone: it is logged, its driver disposed, its siblings keep running.
/// <see cref="RunAsync"/> rethrows the first fault only when EVERY pipeline has faulted — with exactly one
/// pipeline (a deployment with no <c>connectors.json</c>) that is byte-for-byte the old behaviour, where an
/// unexpected exception propagated out of <c>EdgeWorker.ExecuteAsync</c>; with several, one dead connector
/// does not take the process down.</para>
///
/// <para>🔴 <b><see cref="Committed"/> is raised WITHOUT holding any lock, and the first cut of this class
/// did hold one.</b> N pipelines commit concurrently where the single pipeline this replaces did not, so
/// serialising the raise looked like the cheap way to keep <c>EdgeWorker</c>'s non-atomic <c>++</c> correct
/// without touching it. It is the wrong trade and this codebase has the receipts: blueprint §10.3 is a whole
/// section about host-supplied code — log calls, cancellations — running while a lock is held, and
/// <c>EdgeWorker</c>'s subscriber logs a line and cancels a token. Introducing a NEW lock-holding-callback
/// site in the task that inherits that finding would be the "a fix and a sweep feel like one action" trap
/// from the other end. The subscriber was made atomic instead
/// (<c>Interlocked.Increment</c>), and <see cref="_stateGate"/> now guards nothing but two lists — no
/// callback, no I/O, no disposal ever runs under it. <b>Subscribers must be thread-safe: this event fires
/// from N pipeline tasks.</b></para>
/// </summary>
public sealed class EdgeAgentPipelines
{
    /// <summary>The slot label of the built-in simulator group. It reads the same as
    /// <c>FleetCore.SimulatedSlotLabel</c> and is deliberately a SEPARATE literal: that constant sits on an
    /// <c>internal</c> type, and widening a type's visibility to share a nine-character string would undo the
    /// reason it is internal.
    ///
    /// <para><b>Stated honestly: this is NOT mechanically pinned against the engine's constant, and it does
    /// not need to be.</b> The two labels never meet — the engine's keys its own pipeline slots and,
    /// through those, alarm target ids; this one is a read-out on <see cref="StartedLabels"/> with no
    /// consumer that joins it to anything. If they ever DO need to agree, the answer is a shared constant on
    /// a public type, not an <c>InternalsVisibleTo</c>.</para></summary>
    public const string SimulatedLabel = "simulated";

    private readonly ITransport _transport;
    private readonly EventBus _eventBus;
    private readonly MappingProfile _fallbackProfile;
    private readonly Action<string>? _logWarning;
    private readonly Action<Exception, string>? _logError;

    /// <summary>Guards <see cref="_labels"/>/<see cref="_startIssues"/> and NOTHING ELSE. No callback, no
    /// I/O and no disposal is ever performed while it is held — see the class remarks for why that is a rule
    /// here rather than an accident.</summary>
    private readonly object _stateGate = new();

    private readonly List<ConnectorStartIssue> _startIssues = new();
    private readonly List<string> _labels = new();

    /// <param name="transport">Where every pipeline sends. Shared, exactly as the one pipeline this replaces
    /// shared it — <see cref="ITransport"/> is upload-only (blueprint §3: <c>SendAsync</c>/
    /// <c>HeartbeatAsync</c>/<c>SyncConfigAsync</c>, all client→server), which is the other half of why an
    /// edge agent cannot carry a write down to a device.</param>
    /// <param name="eventBus">The trace bus every <see cref="EdgePipeline"/> publishes to.</param>
    /// <param name="fallbackProfile">The <see cref="MappingProfile"/> every reading normalises through.
    /// Deliberately ONE shared profile and no <c>MappingProfileResolver</c>: that resolver reads
    /// <c>mapping/*.json</c> from <see cref="AppContext.BaseDirectory"/>, and blueprint §9.4(1) records that
    /// <c>St4i.EdgeService.csproj</c> ships no such directory — so wiring it here would produce exactly the
    /// silent, cause-less degradation §9.4 calls the frightening class of defect. An edge host that later
    /// wants per-machine profiles must SHIP the directory first.</param>
    /// <param name="logWarning">EdgeCore's logging convention (this assembly is deliberately
    /// logging-framework-free). Nullable, and the nullability is load-bearing — see D-7a: no mechanism state
    /// is ever carried inside a log call's argument list in this class.</param>
    /// <param name="logError">As <paramref name="logWarning"/>, for the exception-carrying channel.</param>
    public EdgeAgentPipelines(
        ITransport transport,
        EventBus eventBus,
        MappingProfile fallbackProfile,
        Action<string>? logWarning = null,
        Action<Exception, string>? logError = null)
    {
        _transport = transport ?? throw new ArgumentNullException(nameof(transport));
        _eventBus = eventBus ?? throw new ArgumentNullException(nameof(eventBus));
        _fallbackProfile = fallbackProfile ?? throw new ArgumentNullException(nameof(fallbackProfile));
        _logWarning = logWarning;
        _logError = logError;
    }

    /// <summary>Fired once per reading committed by ANY pipeline, with whatever ack the transport produced.
    /// 🔴 Raised with NO lock held, from N concurrent pipeline tasks — a subscriber must be thread-safe. See
    /// the class remarks for why serialising it here was rejected.</summary>
    public event Action<DeviceReading, TransportAck>? Committed;

    /// <summary>The slot label of every pipeline actually started by the most recent <see cref="RunAsync"/>,
    /// in start order: <see cref="SimulatedLabel"/> first when simulators were supplied, then one entry per
    /// connector instance that produced a driver. Empty before the first <see cref="RunAsync"/>. This is the
    /// "N drivers are running" read-out, and it is a list of STRINGS on purpose — see the class remarks on
    /// why no member of this type hands back an <see cref="IDeviceDriver"/>.</summary>
    public IReadOnlyList<string> StartedLabels
    {
        get { lock (_stateGate) return _labels.ToArray(); }
    }

    /// <summary>Every configured connector instance that did NOT produce a driver on the most recent
    /// <see cref="RunAsync"/>, with the reason. The same "visible, never silent" posture — and the same
    /// record type — as <c>FleetCore.GetConfiguredConnectorIssues</c>: a <c>connectors.json</c> typo must not
    /// present to an operator as "my connector just isn't there".</summary>
    public IReadOnlyList<ConnectorStartIssue> StartIssues
    {
        get { lock (_stateGate) return _startIssues.ToArray(); }
    }

    /// <summary>
    /// Builds the drivers, runs one <see cref="EdgePipeline"/> per driver until <paramref name="ct"/> is
    /// cancelled (or every pipeline has ended), then disposes every driver it built.
    /// </summary>
    /// <param name="simulators">The built-in simulator group, or <see langword="null"/>/empty for none. The
    /// <see cref="SimulatedDriver"/> is constructed HERE from these — the caller never holds a driver.
    /// <see cref="SimulatedDriver"/>'s own constructor guard ("at least one simulator is required") is
    /// respected by not calling it at all for an empty list, the same fix <c>FleetCore.StartLocked</c>
    /// applies at its own call site rather than by weakening that guard.</param>
    /// <param name="connectors">Connector instances to start, or <see langword="null"/> for none. One
    /// pipeline per <see cref="ConnectorRegistry.RegisteredIds"/> entry that produces a driver; an instance
    /// that does not is recorded in <see cref="StartIssues"/> and skipped, and any driver a
    /// rejecting/throwing factory still handed back is disposed rather than leaked (see
    /// <see cref="ConnectorRegistry.TryCreateDriver"/>'s own remarks on why that reference can be non-null on
    /// a <see langword="false"/> return).</param>
    /// <returns>A task that completes when every pipeline has ended. Rethrows the first non-cancellation
    /// fault only if EVERY pipeline faulted — see the class remarks.</returns>
    public async Task RunAsync(
        IReadOnlyList<IMachineSimulator>? simulators,
        ConnectorRegistry? connectors,
        CancellationToken ct)
    {
        var built = new List<(string Label, IDeviceDriver Driver)>();
        var issues = new List<ConnectorStartIssue>();

        if (simulators is { Count: > 0 })
        {
            built.Add((SimulatedLabel, new SimulatedDriver(simulators)));
        }

        foreach (var id in connectors?.RegisteredIds ?? Array.Empty<string>())
        {
            IDeviceDriver? driver;
            string? error;
            try
            {
                if (connectors!.TryCreateDriver(id, out driver, out error))
                {
                    built.Add((id, driver));
                    continue;
                }
            }
            catch (Exception ex)
            {
                // ConnectorRegistry.TryCreateDriver already promises not to throw; this is the same doubled
                // defence FleetCore.StartLocked keeps around the same call, for the same reason — a
                // third-party factory's misbehaviour must never take the agent down.
                driver = null;
                error = ex.Message;
            }

            issues.Add(new ConnectorStartIssue(id, error ?? "(no reason reported)"));
            _logWarning?.Invoke(
                $"connector instance '{id}' did not produce a driver and will not be polled this run: {error}");

            // An orphaned driver from a factory that assigned `out driver` and then failed. Disposed here,
            // on the caller's own thread and outside every lock — this class holds no lock while doing I/O.
            if (driver is not null)
            {
                await DisposeQuietlyAsync(id, driver).ConfigureAwait(false);
            }
        }

        lock (_stateGate)
        {
            _labels.Clear();
            _labels.AddRange(built.Select(b => b.Label));
            _startIssues.Clear();
            _startIssues.AddRange(issues);
        }

        if (built.Count == 0)
        {
            _logWarning?.Invoke("No driver could be started — this agent has nothing to poll.");
            return;
        }

        // No lock: see the class remarks. N pipelines raise this concurrently and subscribers must cope.
        void Raise(DeviceReading reading, TransportAck ack) => Committed?.Invoke(reading, ack);

        var faults = new Exception?[built.Count];
        var tasks = new Task[built.Count];

        for (var i = 0; i < built.Count; i++)
        {
            var index = i;
            var (label, driver) = built[i];
            var pipeline = new EdgePipeline(driver, _fallbackProfile, _transport, _eventBus);
            pipeline.Committed += Raise;

            tasks[i] = Task.Run(async () =>
            {
                try
                {
                    await pipeline.RunAsync(ct).ConfigureAwait(false);
                }
                catch (OperationCanceledException)
                {
                    // Expected: the host asked every pipeline to stop. Normal completion, never a fault.
                }
                catch (Exception ex)
                {
                    faults[index] = ex;
                    _logError?.Invoke(ex, $"pipeline '{label}' stopped with an error; its siblings are unaffected");
                }
                finally
                {
                    pipeline.Committed -= Raise;
                }
            }, CancellationToken.None);
        }

        try
        {
            await Task.WhenAll(tasks).ConfigureAwait(false);
        }
        finally
        {
            foreach (var (label, driver) in built)
            {
                await DisposeQuietlyAsync(label, driver).ConfigureAwait(false);
            }
        }

        // Every pipeline faulted — nothing is left running, so this agent is dead and the caller must learn
        // it the way it always did. With exactly one pipeline this is byte-for-byte the pre-E-3 behaviour.
        if (faults.All(f => f is not null))
        {
            throw faults[0]!;
        }
    }

    /// <summary>Disposal must never turn a shutdown into a crash — every caller here is already unwinding.
    /// Logged, never rethrown; the same posture <c>FleetCore</c>'s own teardown paths take.</summary>
    private async Task DisposeQuietlyAsync(string label, IDeviceDriver driver)
    {
        try
        {
            await driver.DisposeAsync().ConfigureAwait(false);
        }
        catch (Exception ex)
        {
            _logError?.Invoke(ex, $"disposing driver for '{label}' failed");
        }
    }
}
