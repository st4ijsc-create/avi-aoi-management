using System.IO;
using St4i.EdgeCore.Drivers;
using St4i.Connector.Abstractions;
using St4i.EdgeCore.Drivers.HotFolder;
using St4i.EdgeCore.Drivers.Simulators;
using St4i.EdgeCore.Engine;
using St4i.EdgeCore.Infrastructure;
using St4i.EdgeCore.Mapping;
using St4i.EdgeCore.Models;
using St4i.Connector.Abstractions.Models;
using St4i.EdgeCore.Transport;

namespace St4iMachineSimulator.Services;

/// <summary>
/// Task 15 — owns the exhibition's default in-code fleet: a fixed roster of ~10
/// <see cref="MachineDescriptor"/>s spanning every <see cref="IMachineSimulator"/> type across all 3
/// <see cref="DeviceClass"/> values, wrapped in a single <see cref="SimulatedDriver"/> and driven by
/// a single <see cref="EdgePipeline"/> against the DI-resolved <see cref="ITransport"/> (Live-first/
/// Demo-fallback <c>AutoTransport</c> — see <c>App.xaml.cs</c>) and <see cref="EventBus"/>.
///
/// <see cref="Start"/>/<see cref="Stop"/> are the composition root for "Start Fleet"/"Stop Fleet" in
/// the shell's top bar (Task 14's <c>AppShellViewModel</c>); <see cref="Committed"/> is what
/// <c>FleetViewModel</c> subscribes to in order to update the dashboard's tiles/KPIs.
///
/// Task 19b extends this with the Scenario screen's runtime knobs (<see cref="ApplyScenario"/>/
/// <see cref="Burst"/>/<see cref="RunHotFolderAoiDemoAsync"/>) — see each member's own remarks.
/// </summary>
public sealed class FleetService : IDisposable
{
    /// <summary>Cycle-rate multiplier <see cref="Burst"/> applies for <see cref="BurstDuration"/>.</summary>
    private const double BurstMultiplier = 6.0;

    private static readonly TimeSpan BurstDuration = TimeSpan.FromSeconds(4);

    /// <summary>Floor on a scaled <see cref="MachineDescriptor.CycleSeconds"/> — guards against a
    /// runaway near-zero interval if a future caller ever combines an extreme
    /// <see cref="ScenarioConfig.CycleRateMultiplier"/> with an already-fast sim.</summary>
    private const double MinCycleSeconds = 0.05;

    private const double OutageFakeErrorRate = 0.9;
    private const double OutageLatencyMs = 60;

    private readonly object _gate = new();
    private readonly SwitchableTransport _transport;
    private readonly TransportCoordinator _transportCoordinator;
    private readonly EventBus _eventBus;

    private CancellationTokenSource? _cts;
    private Task? _runTask;

    /// <summary>The currently-running pipeline's <see cref="EdgePipeline.Committed"/> subscription — held
    /// so <see cref="StopLocked"/> can detach <see cref="OnPipelineCommitted"/> from it immediately
    /// (fix-pass: previously the lambda subscribed in <see cref="StartLocked"/> was never unsubscribed,
    /// so a cancelled-but-not-yet-unwound outgoing pipeline could still forward a straggling reading to
    /// <see cref="Committed"/> after a restart had already started the replacement — see
    /// <see cref="StopLocked"/>'s remarks).</summary>
    private EdgePipeline? _currentPipeline;

    /// <summary>Lazily built once, then reused across every "Mất mạng demo" toggle — a fresh, real
    /// <see cref="DemoTransport"/> instance dedicated to the outage scenario (kept separate from
    /// <see cref="TransportCoordinator.Demo"/>, which normal Demo-mode traffic uses) so its own internal
    /// per-idempotency-key id counters never mix with a real Demo-mode session's.</summary>
    private DemoTransport? _outageTransport;

    /// <summary>Non-null while a <see cref="Burst"/>'s automatic revert is pending. Guarded by
    /// <see cref="_gate"/> (fix-pass: previously read/swapped lock-free via
    /// <see cref="Interlocked.Exchange{T}(ref T,T)"/>, which raced with <see cref="_burstBaseline"/>'s
    /// own capture — see <see cref="Burst"/>'s remarks).</summary>
    private CancellationTokenSource? _burstRevertCts;

    /// <summary>Fix-pass — the TRUE pre-burst <see cref="ScenarioConfig.CycleRateMultiplier"/> to revert
    /// to, captured ONCE per burst "episode" (the first <see cref="Burst"/> call while
    /// <see cref="_burstRevertCts"/> is null) rather than re-read on every overlapping click. Before this
    /// fix, a SECOND click while a burst was still active re-read <c>_scenario.CycleRateMultiplier</c>,
    /// which by then was already the BURST value (e.g. 6.0) — so the eventual revert restored to 6.0
    /// instead of the real baseline (typically 1.0), leaving the fleet stuck at burst speed forever.</summary>
    private double _burstBaseline = 1.0;

    private volatile ScenarioConfig _scenario = ScenarioConfig.Normal;

    public FleetService(SwitchableTransport transport, TransportCoordinator transportCoordinator, EventBus eventBus)
    {
        _transport = transport ?? throw new ArgumentNullException(nameof(transport));
        _transportCoordinator = transportCoordinator ?? throw new ArgumentNullException(nameof(transportCoordinator));
        _eventBus = eventBus ?? throw new ArgumentNullException(nameof(eventBus));
        Fleet = LoadFleet();
    }

    /// <summary>Task 22 — the roster this run is actually using: an external <c>fleet.json</c>
    /// (11 machines out of the box — 2×SCREWDRIVE/1×DISPENSING/1×WELDER/1×ASSEMBLY/1×LEAK_TEST/
    /// 1×FUNCTIONAL_TEST/2×IOT_SENSOR/2×AOI, mixing all 3 <see cref="DeviceClass"/> values) when one is
    /// found next to the exe or via <c>--fleet &lt;path&gt;</c> — see <see cref="LoadFleet"/> — else the
    /// smaller in-code <see cref="BuildDefaultFleet"/> fallback (kept so the app still runs with no
    /// packaging file present at all, e.g. a debug F5 run before publish). Cadences are lively-but-
    /// readable (&lt;2s each) so the dashboard visibly updates during a live demo — these are the
    /// UN-SCALED cadences, see <see cref="ApplyScenario"/> for how
    /// <see cref="ScenarioConfig.CycleRateMultiplier"/> scales them at build time.</summary>
    public IReadOnlyList<MachineDescriptor> Fleet { get; }

    /// <summary>The same DI-resolved <see cref="ITransport"/> this service drives the pipeline with
    /// (doc 16: Machine Detail's config-sync panel) — exposed so <c>FleetViewModel</c> can hand each
    /// <c>MachineViewModel</c> the exact transport its readings actually flow through, rather than
    /// resolving/constructing a second one. Task 19b's <see cref="ApplyScenario"/> NetworkOutage swap
    /// re-points this SAME <see cref="SwitchableTransport"/>'s inner — every existing holder of this
    /// property observes the swap with no re-wiring.</summary>
    public ITransport Transport => _transport;

    /// <summary>True once <see cref="Start"/> has kicked off the background pipeline task and it
    /// hasn't been <see cref="Stop"/>ped since (or the pipeline task hasn't faulted — see
    /// <see cref="LastError"/>).</summary>
    public bool IsRunning { get; private set; }

    /// <summary>Set if the background pipeline task faulted (an exception other than the expected
    /// <see cref="OperationCanceledException"/> from <see cref="Stop"/>) — <see cref="EdgePipeline"/>
    /// itself already survives per-reading transport failures internally (see its own remarks), so
    /// this should stay null in normal operation. Cleared on the next successful <see cref="Start"/>.</summary>
    public Exception? LastError { get; private set; }

    /// <summary>Fired once per reading committed through the pipeline, on whatever background thread
    /// happened to be running <see cref="EdgePipeline.RunAsync"/>'s loop — never the UI thread.
    /// Subscribers (<c>FleetViewModel</c>) must marshal to the UI thread themselves before touching
    /// any bound property.</summary>
    public event Action<DeviceReading, TransportAck>? Committed;

    /// <summary>Task 19b — the scenario currently in effect; survives independent of
    /// <see cref="IsRunning"/> (set it while stopped and it applies the moment <see cref="Start"/> next
    /// runs; set it while running and <see cref="ApplyScenario"/> applies it live). Defaults to
    /// <see cref="ScenarioConfig.Normal"/> before any preset/slider has been touched.</summary>
    public ScenarioConfig Scenario => _scenario;

    /// <summary>Fired every time <see cref="ApplyScenario"/> actually applies a new
    /// <see cref="ScenarioConfig"/> — including from <see cref="Burst"/>'s own calls (both the initial
    /// spike and its automatic revert). The revert fires on a background <see cref="Task.Delay"/>
    /// continuation, NOT the UI thread — subscribers (<c>ScenarioViewModel</c>) must marshal before
    /// touching any bound property, same rule as <see cref="Committed"/>.</summary>
    public event Action<ScenarioConfig>? ScenarioChanged;

    /// <summary>
    /// Builds a fresh <see cref="SimulatedDriver"/> (new simulator instances, so per-machine cycle
    /// counters restart at 1 — <see cref="SimulatedDriver"/> itself is stateful and single-use) and
    /// runs its <see cref="EdgePipeline"/> on a background <see cref="Task"/>. A no-op if already
    /// running.
    /// </summary>
    public void Start()
    {
        lock (_gate)
        {
            StartLocked();
        }
    }

    /// <summary>Cancels the running pipeline. A no-op if not running. Deliberately does not await or
    /// Dispose the <see cref="CancellationTokenSource"/> here: the background pipeline task may still
    /// be inside an await referencing its token (e.g. the driver's pacing <c>Task.Delay</c>), and
    /// disposing a CTS while a wait against its token is in flight is a documented race — letting the
    /// GC reclaim it once that in-flight await observes cancellation and unwinds is simpler and safe
    /// for this exhibition tool.</summary>
    public void Stop()
    {
        lock (_gate)
        {
            StopLocked();
        }
    }

    /// <summary>
    /// Task 19b — applies a new <see cref="ScenarioConfig"/>. DefectRate/FaultRate take effect on the
    /// very NEXT reading with no restart (<see cref="ScenarioAwareDriver"/> reads <see cref="Scenario"/>
    /// live, per reading). NetworkOutage swaps the DI <see cref="SwitchableTransport"/>'s inner
    /// immediately — turning it back off re-points the transport at whatever Live/Demo/Auto instance
    /// currently matches <see cref="TransportCoordinator.Mode"/> (NOT unconditionally Demo — if the
    /// operator had selected Live/Auto before the outage demo, that's what's restored). CycleRateMultiplier
    /// is baked into each sim's <see cref="MachineDescriptor.CycleSeconds"/> at driver-build time, so it
    /// restarts the running pipeline — but ONLY when it actually changed from what's currently applied,
    /// so dragging the Defect/Fault sliders never causes the visible "cycle count reset to 1" a restart
    /// produces (see <c>MachineViewModel.Cycles</c>' own remarks on why a restart resets it).
    ///
    /// Fix-pass (round 2): a multiplier-changed restart is <c>StopLocked(); StartLocked();</c> back to
    /// back under a SINGLE <see cref="_gate"/> acquisition (as it originally was) — NOT split across two
    /// lock blocks with an unlocked gap between them (round 2 briefly tried that, awaiting the outgoing
    /// task's unwind in the gap; round 3 removed it — see round 3 below for why). <see cref="StopLocked"/>
    /// detaches the outgoing pipeline's <see cref="EdgePipeline.Committed"/> handler SYNCHRONOUSLY, right
    /// there inside this same lock, before <see cref="StartLocked"/> subscribes the replacement's — that
    /// detach alone is what makes it safe for no straggling old-generation reading to ever reach
    /// <see cref="Committed"/>/the VMs again, regardless of how long the outgoing background task takes
    /// to actually unwind (its own cancellation observes <see cref="_cts"/> on its next await and it ends
    /// on its own, updating nothing since nothing is listening).
    ///
    /// Fix-pass (round 3): an earlier version of this method additionally blocked the CALLING thread on
    /// <c>Task.WhenAny(outgoingTask, Task.Delay(...)).GetAwaiter().GetResult()</c> between the two lock
    /// blocks, "to let the outgoing task unwind before starting the replacement". That await was never
    /// load-bearing for correctness (the synchronous <c>Committed</c> detach above already guarantees no
    /// stray events) and every caller of this method — <c>ScenarioViewModel.Burst()</c>,
    /// <c>ApplyPresetAsync</c>, and every live slider tick via <c>OnCycleRateChanged</c> — runs on the UI
    /// thread, so it silently blocked the UI for up to that bound on every Burst click, preset click, or
    /// CycleRate slider drag: the exact <c>.GetAwaiter().GetResult()</c>-on-the-UI-thread anti-pattern
    /// this project otherwise avoids everywhere else (see e.g. the Onboarding/Settings selftest remarks
    /// on why blocking is dangerous). Removed — this method is restored to its original single-lock
    /// <c>StopLocked(); StartLocked();</c> shape (see below), with only the synchronous <c>Committed</c>
    /// detach carried forward from round 2.
    /// </summary>
    public void ApplyScenario(ScenarioConfig config)
    {
        ArgumentNullException.ThrowIfNull(config);

        lock (_gate)
        {
            var previous = _scenario;
            _scenario = config;

            ApplyNetworkOutageLocked(config.NetworkOutage);

            var multiplierChanged = Math.Abs(config.CycleRateMultiplier - previous.CycleRateMultiplier) > 1e-9;
            if (IsRunning && multiplierChanged)
            {
                StopLocked(); // cancels + detaches Committed synchronously — see this method's own remarks
                StartLocked();
            }
        }

        ScenarioChanged?.Invoke(config);
    }

    /// <summary>
    /// Task 19b — "Burst": <see cref="BurstMultiplier"/>× cycle-rate for <see cref="BurstDuration"/>,
    /// then automatically restores the TRUE pre-burst <see cref="ScenarioConfig.CycleRateMultiplier"/>
    /// (not necessarily <see cref="ScenarioConfig.Normal"/>'s 1.0 — bursting from an operator-set 1.5x
    /// returns to 1.5x). Overlapping clicks supersede: a newer <see cref="Burst"/> cancels the previous
    /// one's pending revert, so only the LATEST click's timer ever fires — otherwise an earlier revert
    /// could stomp a later burst's multiplier back down mid-flight.
    ///
    /// Fix-pass: <see cref="_burstBaseline"/> is captured ONCE per burst "episode" — only when NO burst
    /// is currently pending (<see cref="_burstRevertCts"/> is null) — rather than re-read from
    /// <see cref="_scenario"/> on every click. Re-reading on every click was the bug: a SECOND click
    /// while the first burst was still active saw <c>_scenario.CycleRateMultiplier</c> already at
    /// <see cref="BurstMultiplier"/> (e.g. 6.0), so it "baselined" on the burst value itself — the
    /// eventual revert then restored 6.0, not the real pre-burst rate, leaving the fleet stuck at burst
    /// speed forever. Now covered by <see cref="_gate"/> (was lock-free <c>Interlocked</c> juggling)
    /// specifically so the "is a burst already pending" check and the baseline capture/CTS swap happen
    /// as one atomic step.
    ///
    /// Fire-and-forget by design (mirrors the exhibition-tool "don't block the caller" shape
    /// <see cref="MachineViewModel.SyncConfigCommand"/> already uses); the eventual revert surfaces
    /// through <see cref="ScenarioChanged"/> like any other <see cref="ApplyScenario"/> call.
    /// </summary>
    public void Burst()
    {
        CancellationTokenSource cts;
        double baseline;
        lock (_gate)
        {
            cts = new CancellationTokenSource();
            var previousCts = _burstRevertCts;

            if (previousCts is null)
            {
                // No burst currently pending — THIS click is the start of a new episode, so its
                // pre-burst value is the one true baseline for the eventual revert.
                _burstBaseline = _scenario.CycleRateMultiplier;
            }
            // else: a burst is already active — _burstBaseline already holds the FIRST click's
            // pre-burst value; deliberately do NOT overwrite it with _scenario.CycleRateMultiplier now
            // (that would just be the burst value itself).

            previousCts?.Cancel();
            _burstRevertCts = cts;
            baseline = _burstBaseline;
        }

        ApplyScenario(_scenario with { CycleRateMultiplier = BurstMultiplier });

        _ = RevertBurstAfterDelayAsync(baseline, cts);
    }

    private async Task RevertBurstAfterDelayAsync(double baseline, CancellationTokenSource cts)
    {
        try
        {
            await Task.Delay(BurstDuration, cts.Token).ConfigureAwait(false);
        }
        catch (OperationCanceledException)
        {
            return; // superseded by a newer Burst() call — that one owns the revert now
        }

        // Only revert (and only clear _burstRevertCts, ending the "episode") if nothing replaced this
        // CTS while we were waiting — belt-and-suspenders against a Burst() landing between the delay
        // completing and this check.
        bool shouldRevert;
        lock (_gate)
        {
            shouldRevert = _burstRevertCts == cts;
            if (shouldRevert) _burstRevertCts = null;
        }

        if (shouldRevert)
        {
            ApplyScenario(_scenario with { CycleRateMultiplier = baseline });
        }
    }

    /// <summary>
    /// Task 19b — the "Hot-folder AOI" preset's one-shot action (not a persistent scenario knob): builds
    /// one guaranteed-NG sample board via a dedicated <see cref="AoiInspectorSim"/>, writes it as a real
    /// doc-28 file via <see cref="Doc28Writer.WriteAtomic"/> into a watched temp folder, then runs a
    /// dedicated <see cref="EdgePipeline"/> over a real <see cref="HotFolderAoiDriver"/> watching that
    /// SAME folder — sharing this service's own <see cref="Transport"/>/<see cref="EventBus"/> so the
    /// round-tripped reading flows through Normalizer→Transport exactly like a real machine's would and
    /// shows up in the API Inspector — proving the doc-28 closed loop with a real producer + real
    /// consumer, not a mock. Stops itself the moment its own file round-trips (or after a 5s safety net
    /// if it never does) rather than running forever, since <see cref="HotFolderAoiDriver.ReadAsync"/>
    /// otherwise waits indefinitely for the NEXT file.
    ///
    /// Fix-pass: deletes its whole <c>%TEMP%\st4i-sim-hotfolder-demo</c> base directory (in/archive/
    /// error) in a <c>finally</c> once the round-trip completes or times out — previously this
    /// accumulated one file-set per demo click/selftest run forever.
    /// </summary>
    public async Task<string> RunHotFolderAoiDemoAsync(CancellationToken ct)
    {
        var baseDir = Path.Combine(Path.GetTempPath(), "st4i-sim-hotfolder-demo");
        var watchDir = Path.Combine(baseDir, "in");
        var archiveDir = Path.Combine(baseDir, "archive");
        var errorDir = Path.Combine(baseDir, "error");

        try
        {
            // ngRate: 1.0 is deliberate — this is a ONE-SHOT demo write, not the fleet's own AOI-01/
            // AOI-02 sims (which keep their normal ~5% rate): the demo must always visibly show a real
            // defect flowing through, not a coin-flip clean pass.
            var demoDescriptor = new MachineDescriptor(
                "HOTFOLDER-DEMO", "SN-HOTFOLDER", DeviceClass.AoiAvi, "AOI", "inspection",
                DriverKinds.HotFolderAoi, "RC-HOTFOLDER-DEMO", null, CycleSeconds: 1.0);
            var sim = new AoiInspectorSim(demoDescriptor, seed: 777, pointsPerBoard: 8, ngRate: 1.0);
            var reading = sim.NextCycle(cycle: 1);

            var writtenPath = new Doc28Writer().WriteAtomic(watchDir, reading);

            await using var driver = new HotFolderAoiDriver(watchDir, archiveDir, errorDir);
            var profile = new MappingProfile { Name = "hotfolder-demo", DeviceClass = nameof(DeviceClass.AoiAvi) };
            var pipeline = new EdgePipeline(driver, profile, _transport, _eventBus);

            using var timeoutCts = CancellationTokenSource.CreateLinkedTokenSource(ct);
            DeviceReading? ingested = null;
            void OnCommitted(DeviceReading r, TransportAck a)
            {
                ingested = r;
                timeoutCts.Cancel(); // one-shot demo: stop the instant our own file round-trips
            }

            pipeline.Committed += OnCommitted;
            timeoutCts.CancelAfter(TimeSpan.FromSeconds(5)); // safety net if the file is never picked up
            try
            {
                await pipeline.RunAsync(timeoutCts.Token).ConfigureAwait(false);
            }
            catch (OperationCanceledException)
            {
                // expected: either our own success-cancel above, or the 5s safety net
            }
            finally
            {
                pipeline.Committed -= OnCommitted;
            }

            var fileName = Path.GetFileName(writtenPath);
            if (ingested is null)
            {
                return $"Đã ghi {fileName} vào {watchDir} nhưng chưa xác nhận được HotFolderAoiDriver đọc lại trong 5s.";
            }

            var ngCount = ingested.Measurements.Count(m => string.Equals(m.Result, "NG", StringComparison.OrdinalIgnoreCase));
            return $"Đã ghi {fileName} — HotFolderAoiDriver đọc lại thành công: {ngCount}/{ingested.Measurements.Count} điểm NG, verdict={ingested.Verdict}.";
        }
        finally
        {
            // Best-effort: a locked file (e.g. an antivirus scan mid-flight, or the watcher's handle not
            // yet released on some environments) must not turn an otherwise-successful demo into a
            // reported failure — this cleanup is pure housekeeping, not part of the demo's own contract.
            try
            {
                if (Directory.Exists(baseDir)) Directory.Delete(baseDir, recursive: true);
            }
            catch (IOException)
            {
            }
            catch (UnauthorizedAccessException)
            {
            }
        }
    }

    public void Dispose()
    {
        _burstRevertCts?.Cancel();
        lock (_gate)
        {
            StopLocked();
        }
    }

    // ─────────────────────────────────────────────────────────────────────
    // START/STOP CORE — assumes the caller already holds _gate
    // ─────────────────────────────────────────────────────────────────────

    private void StartLocked()
    {
        if (IsRunning) return;

        LastError = null;

        var multiplier = _scenario.CycleRateMultiplier > 0 ? _scenario.CycleRateMultiplier : 1.0;
        var effectiveFleet = Math.Abs(multiplier - 1.0) < 1e-9
            ? Fleet
            : Fleet.Select(d => d with { CycleSeconds = Math.Max(MinCycleSeconds, d.CycleSeconds / multiplier) }).ToList();

        var sims = effectiveFleet.Select((d, i) => BuildSimulator(d, seed: 1000 + i)).ToList();
        IDeviceDriver driver = new ScenarioAwareDriver(new SimulatedDriver(sims), () => _scenario);

        // Normalizer only consults MappingProfile.DefaultStepType/UnitMap (never DeviceClass) — see
        // Mapping/Normalizer.cs — and every simulator already fills in its own StepType, so one
        // generic profile is correct for this mixed-DeviceClass fleet; there is no per-reading
        // routing decision that depends on which class-specific profile was used.
        var profile = new MappingProfile { Name = "fleet-mixed", DeviceClass = "Mixed" };
        var pipeline = new EdgePipeline(driver, profile, _transport, _eventBus);
        pipeline.Committed += OnPipelineCommitted;
        _currentPipeline = pipeline;

        var cts = new CancellationTokenSource();
        _cts = cts;
        IsRunning = true;

        _runTask = Task.Run(async () =>
        {
            try
            {
                await pipeline.RunAsync(cts.Token).ConfigureAwait(false);
            }
            catch (OperationCanceledException)
            {
                // Expected on Stop() — the pipeline's cancellable read loop propagates this per its
                // documented contract; it is not a fleet failure.
            }
            catch (Exception ex)
            {
                // A genuinely unexpected fault (EdgePipeline.RunAsync itself already survives
                // per-reading transport throws/failures internally — see its own remarks — so this is
                // NOT the normal "one bad reading" path). Don't leave IsRunning stuck true with no
                // signal that the fleet silently died.
                LastError = ex;
                IsRunning = false;
            }
        });
    }

    /// <summary>
    /// Fix-pass: detaches <see cref="OnPipelineCommitted"/> from the OUTGOING <see cref="_currentPipeline"/>
    /// SYNCHRONOUSLY, right here — before this method returns, i.e. before <see cref="ApplyScenario"/>'s
    /// caller (or <see cref="Stop"/>'s) sees control back. This is what actually closes the restart race:
    /// the outgoing pipeline's background <see cref="Task.Run"/> continuation may still be mid-flight for
    /// a little while after <see cref="_cts"/> is cancelled (e.g. an in-flight <c>SendAsync</c> that was
    /// already awaiting when Cancel() was called), and it CAN still publish one more
    /// <see cref="EdgePipeline.Committed"/> invocation for that straggling reading — but since this
    /// handler is already unsubscribed by then, that invocation is a no-op as far as this service (and
    /// every VM downstream of <see cref="Committed"/>) is concerned. Eliminates the "cycle counts jump
    /// backward / duplicate rows" symptom regardless of exactly how long the outgoing task takes to
    /// unwind — <see cref="ApplyScenario"/>'s additional bounded await is a further narrowing on top, not
    /// what makes this safe.
    /// </summary>
    private void StopLocked()
    {
        if (!IsRunning) return;

        _cts?.Cancel();
        _cts = null;
        _runTask = null;
        IsRunning = false;

        if (_currentPipeline is not null)
        {
            _currentPipeline.Committed -= OnPipelineCommitted;
            _currentPipeline = null;
        }
    }

    private void OnPipelineCommitted(DeviceReading reading, TransportAck ack) => Committed?.Invoke(reading, ack);

    /// <summary>Assumes the caller already holds <see cref="_gate"/> (called only from
    /// <see cref="ApplyScenario"/>).</summary>
    private void ApplyNetworkOutageLocked(bool outage)
    {
        if (outage)
        {
            _outageTransport ??= new DemoTransport(latencyMs: OutageLatencyMs, fakeErrorRate: OutageFakeErrorRate);
            _transport.SetInner(_outageTransport);
        }
        else
        {
            // Re-applying the CURRENT Mode is idempotent when outage was never on (cheap: a single
            // instance-reference swap under SwitchableTransport's own lock) and correctly restores the
            // right Live/Demo/Auto instance when it was — TransportCoordinator is the single source of
            // truth for that mapping (see its own class remarks).
            _transportCoordinator.ApplyMode(_transportCoordinator.Mode);
        }
    }

    // ─────────────────────────────────────────────────────────────────────
    // FLEET ROSTER + SIMULATOR FACTORY
    // ─────────────────────────────────────────────────────────────────────

    /// <summary>descriptor→<see cref="IMachineSimulator"/> factory. Task 21: delegates to EdgeCore's
    /// <see cref="SimulatorFactory"/> (extracted from this method's original body, byte-identical
    /// switch logic) so the headless <c>St4i.EdgeService</c> can build the exact same roster without
    /// depending on this WPF project.</summary>
    internal static IMachineSimulator BuildSimulator(MachineDescriptor d, int seed) =>
        SimulatorFactory.Create(d, seed);

    /// <summary>
    /// Task 22 packaging — resolves the fleet roster from an external <c>fleet.json</c> when one is
    /// findable (see <see cref="ResolveFleetPath"/>), falling back to <see cref="BuildDefaultFleet"/>
    /// when no path resolves, the file doesn't parse (<see cref="FleetConfigException"/> — a malformed
    /// hand-edited fleet.json must never crash the exhibition kiosk on startup), or it parses to zero
    /// machines (an accidentally-emptied fleet.json is treated the same as "missing", not "run nothing").
    /// </summary>
    private static IReadOnlyList<MachineDescriptor> LoadFleet()
    {
        var path = ResolveFleetPath();
        if (path is not null)
        {
            try
            {
                // GP-3 — this app has no ILogger/structured-logging infra wired into this static ctor
                // path (unlike St4i.EngineApi's FleetHost/St4i.EdgeService's EdgeWorker); Debug.WriteLine
                // is the zero-dependency channel every other diagnostic in this class already lacks, but
                // it is at least visible via a debugger/DebugView, which is strictly better than the
                // warning going nowhere at all. The entry is still skipped either way; this only affects
                // whether the skip is observable.
                var loaded = FleetConfig.Load(path, logWarning: msg => System.Diagnostics.Debug.WriteLine(msg));
                if (loaded.Count > 0) return loaded;
            }
            catch (FleetConfigException ex)
            {
                // Malformed fleet.json — fall through to the in-code default below rather than take
                // the whole kiosk down over a hand-editing mistake in a packaging file.
                System.Diagnostics.Debug.WriteLine($"Malformed fleet.json at '{path}' — falling back to the in-code default fleet: {ex.Message}");
            }
        }

        return BuildDefaultFleet();
    }

    /// <summary>Task 22 — <c>--fleet &lt;path&gt;</c> on the command line wins if present (same flag
    /// name/shape as <c>St4i.EdgeService</c>'s — see its <c>Program.cs</c>); otherwise a
    /// <c>fleet.json</c> sitting next to the running exe (<see cref="AppContext.BaseDirectory"/> — where
    /// the csproj's CopyToOutputDirectory item lands it, both in a plain build/run and in a published
    /// single-file output). Returns null (not a path) when neither resolves, so <see cref="LoadFleet"/>
    /// goes straight to the in-code default without a wasted <see cref="File.Exists"/> round-trip inside
    /// <see cref="FleetConfig.Load"/> for a path that was never going to exist.</summary>
    private static string? ResolveFleetPath()
    {
        var args = Environment.GetCommandLineArgs();
        for (var i = 0; i < args.Length - 1; i++)
        {
            if (string.Equals(args[i], "--fleet", StringComparison.OrdinalIgnoreCase)) return args[i + 1];
        }

        var besideExe = Path.Combine(AppContext.BaseDirectory, "fleet.json");
        return File.Exists(besideExe) ? besideExe : null;
    }

    private static IReadOnlyList<MachineDescriptor> BuildDefaultFleet() =>
    [
        new("SCRW-01", "SN-SCRW01", DeviceClass.Automation, "SCREWDRIVE", "screw_tightening", DriverKinds.Simulated, "RC-SCRW-A", null, 0.6),
        new("SCRW-02", "SN-SCRW02", DeviceClass.Automation, "SCREWDRIVE", "screw_tightening", DriverKinds.Simulated, "RC-SCRW-A", null, 0.8),
        new("DISP-01", "SN-DISP01", DeviceClass.Automation, "DISPENSING", "glue_dispense", DriverKinds.Simulated, "RC-DISP-A", null, 1.0),
        new("WELD-01", "SN-WELD01", DeviceClass.Automation, "WELDER", "spot_weld", DriverKinds.Simulated, "RC-WELD-A", null, 0.9),
        new("ASSY-01", "SN-ASSY01", DeviceClass.Automation, "ASSEMBLY", "press_fit", DriverKinds.Simulated, "RC-ASSY-A", null, 0.7),
        new("LEAK-01", "SN-LEAK01", DeviceClass.Automation, "LEAK_TEST", "leak_test", DriverKinds.Simulated, "RC-LEAK-A", null, 1.2),
        new("FCT-01", "SN-FCT01", DeviceClass.Automation, "FUNCTIONAL_TEST", "functional_test", DriverKinds.Simulated, "RC-FCT-A", null, 1.1),
        new("IOT-01", "SN-IOT01", DeviceClass.Iot, "IOT_SENSOR", "telemetry", DriverKinds.Simulated, null, null, 0.4),
        new("AOI-01", "SN-AOI01", DeviceClass.AoiAvi, "AOI", "inspection", DriverKinds.Simulated, "RC-AOI-A", null, 1.8),
        new("AOI-02", "SN-AOI02", DeviceClass.AoiAvi, "AOI", "inspection", DriverKinds.Simulated, "RC-AOI-A", null, 2.0),
    ];
}
