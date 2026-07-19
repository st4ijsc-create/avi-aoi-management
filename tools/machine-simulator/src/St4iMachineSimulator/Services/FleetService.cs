using System.IO;
using St4i.EdgeCore.Drivers;
using St4i.EdgeCore.Drivers.HotFolder;
using St4i.EdgeCore.Drivers.Simulators;
using St4i.EdgeCore.Engine;
using St4i.EdgeCore.Infrastructure;
using St4i.EdgeCore.Mapping;
using St4i.EdgeCore.Models;
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

    /// <summary>Lazily built once, then reused across every "Mất mạng demo" toggle — a fresh, real
    /// <see cref="DemoTransport"/> instance dedicated to the outage scenario (kept separate from
    /// <see cref="TransportCoordinator.Demo"/>, which normal Demo-mode traffic uses) so its own internal
    /// per-idempotency-key id counters never mix with a real Demo-mode session's.</summary>
    private DemoTransport? _outageTransport;

    /// <summary>Non-null while a <see cref="Burst"/>'s automatic revert is pending; swapped out (via
    /// <see cref="Interlocked.CompareExchange{T}(ref T,T,T)"/>) rather than protected by <see cref="_gate"/>
    /// so overlapping Burst clicks can supersede each other without the revert task needing to hold the
    /// same lock <see cref="ApplyScenario"/> itself takes.</summary>
    private CancellationTokenSource? _burstRevertCts;

    private volatile ScenarioConfig _scenario = ScenarioConfig.Normal;

    public FleetService(SwitchableTransport transport, TransportCoordinator transportCoordinator, EventBus eventBus)
    {
        _transport = transport ?? throw new ArgumentNullException(nameof(transport));
        _transportCoordinator = transportCoordinator ?? throw new ArgumentNullException(nameof(transportCoordinator));
        _eventBus = eventBus ?? throw new ArgumentNullException(nameof(eventBus));
        Fleet = BuildDefaultFleet();
    }

    /// <summary>The fixed roster this build ships with — 2×SCREWDRIVE, 1×DISPENSING, 1×WELDER,
    /// 1×ASSEMBLY, 1×LEAK_TEST, 1×FUNCTIONAL_TEST, 1×IOT_SENSOR, 2×AOI (10 machines, mixing all 3
    /// <see cref="DeviceClass"/> values), at lively-but-readable cadences (&lt;2s each) so the
    /// dashboard visibly updates during a live demo. These are the UN-SCALED cadences — see
    /// <see cref="ApplyScenario"/> for how <see cref="ScenarioConfig.CycleRateMultiplier"/> scales
    /// them at build time.</summary>
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
                StopLocked();
                StartLocked();
            }
        }

        ScenarioChanged?.Invoke(config);
    }

    /// <summary>
    /// Task 19b — "Burst": <see cref="BurstMultiplier"/>× cycle-rate for <see cref="BurstDuration"/>,
    /// then automatically restores whatever <see cref="ScenarioConfig.CycleRateMultiplier"/> was active
    /// right before THIS call (not necessarily <see cref="ScenarioConfig.Normal"/>'s 1.0 — bursting from
    /// an operator-set 1.5x returns to 1.5x). Overlapping clicks supersede: a newer <see cref="Burst"/>
    /// cancels the previous one's pending revert via <see cref="_burstRevertCts"/>, so only the LATEST
    /// click's timer ever fires — otherwise an earlier revert could stomp a later burst's multiplier back
    /// down mid-flight. Fire-and-forget by design (mirrors the exhibition-tool "don't block the caller"
    /// shape <see cref="MachineViewModel.SyncConfigCommand"/> already uses); the eventual revert surfaces
    /// through <see cref="ScenarioChanged"/> like any other <see cref="ApplyScenario"/> call.
    /// </summary>
    public void Burst()
    {
        var baseline = _scenario.CycleRateMultiplier;

        var cts = new CancellationTokenSource();
        var previousCts = Interlocked.Exchange(ref _burstRevertCts, cts);
        previousCts?.Cancel();

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

        // Only revert if nothing replaced this CTS while we were waiting (mirrors the guard above —
        // belt-and-suspenders against a Burst() landing between the delay completing and this check).
        if (Interlocked.CompareExchange(ref _burstRevertCts, null, cts) == cts)
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
    /// </summary>
    public async Task<string> RunHotFolderAoiDemoAsync(CancellationToken ct)
    {
        var baseDir = Path.Combine(Path.GetTempPath(), "st4i-sim-hotfolder-demo");
        var watchDir = Path.Combine(baseDir, "in");
        var archiveDir = Path.Combine(baseDir, "archive");
        var errorDir = Path.Combine(baseDir, "error");

        // ngRate: 1.0 is deliberate — this is a ONE-SHOT demo write, not the fleet's own AOI-01/AOI-02
        // sims (which keep their normal ~5% rate): the demo must always visibly show a real defect
        // flowing through, not a coin-flip clean pass.
        var demoDescriptor = new MachineDescriptor(
            "HOTFOLDER-DEMO", "SN-HOTFOLDER", DeviceClass.AoiAvi, "AOI", "inspection",
            DriverKind.HotFolderAoi, "RC-HOTFOLDER-DEMO", null, CycleSeconds: 1.0);
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
        pipeline.Committed += (reading, ack) => Committed?.Invoke(reading, ack);

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

    private void StopLocked()
    {
        if (!IsRunning) return;

        _cts?.Cancel();
        _cts = null;
        _runTask = null;
        IsRunning = false;
    }

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

    /// <summary>descriptor→<see cref="IMachineSimulator"/> factory: switches on
    /// <see cref="MachineDescriptor.MachineType"/> first (the authoritative signal), falling back to
    /// <see cref="MachineDescriptor.DeviceClass"/> for any type string this build doesn't recognize
    /// rather than throwing — keeps a stray/typo'd fleet.json-style entry from taking the whole fleet
    /// down.</summary>
    internal static IMachineSimulator BuildSimulator(MachineDescriptor d, int seed) =>
        (d.MachineType ?? "").Trim().ToUpperInvariant() switch
        {
            "SCREWDRIVE" => new ScrewdriveSim(d, seed),
            "DISPENSING" => new DispensingSim(d, seed),
            "WELDER" => new WelderSim(d, seed),
            "ASSEMBLY" => new AssemblySim(d, seed),
            "LEAK_TEST" => new LeakTestSim(d, seed),
            "FUNCTIONAL_TEST" => new FunctionalTestSim(d, seed),
            "IOT_SENSOR" => new IotSensorSim(d, seed),
            "AOI" or "AOI_AVI" or "AVI" => new AoiInspectorSim(d, seed),
            _ => FallbackByDeviceClass(d, seed),
        };

    private static IMachineSimulator FallbackByDeviceClass(MachineDescriptor d, int seed) => d.DeviceClass switch
    {
        DeviceClass.Iot => new IotSensorSim(d, seed),
        DeviceClass.AoiAvi => new AoiInspectorSim(d, seed),
        _ => new ScrewdriveSim(d, seed),
    };

    private static IReadOnlyList<MachineDescriptor> BuildDefaultFleet() =>
    [
        new("SCRW-01", "SN-SCRW01", DeviceClass.Automation, "SCREWDRIVE", "screw_tightening", DriverKind.Simulated, "RC-SCRW-A", null, 0.6),
        new("SCRW-02", "SN-SCRW02", DeviceClass.Automation, "SCREWDRIVE", "screw_tightening", DriverKind.Simulated, "RC-SCRW-A", null, 0.8),
        new("DISP-01", "SN-DISP01", DeviceClass.Automation, "DISPENSING", "glue_dispense", DriverKind.Simulated, "RC-DISP-A", null, 1.0),
        new("WELD-01", "SN-WELD01", DeviceClass.Automation, "WELDER", "spot_weld", DriverKind.Simulated, "RC-WELD-A", null, 0.9),
        new("ASSY-01", "SN-ASSY01", DeviceClass.Automation, "ASSEMBLY", "press_fit", DriverKind.Simulated, "RC-ASSY-A", null, 0.7),
        new("LEAK-01", "SN-LEAK01", DeviceClass.Automation, "LEAK_TEST", "leak_test", DriverKind.Simulated, "RC-LEAK-A", null, 1.2),
        new("FCT-01", "SN-FCT01", DeviceClass.Automation, "FUNCTIONAL_TEST", "functional_test", DriverKind.Simulated, "RC-FCT-A", null, 1.1),
        new("IOT-01", "SN-IOT01", DeviceClass.Iot, "IOT_SENSOR", "telemetry", DriverKind.Simulated, null, null, 0.4),
        new("AOI-01", "SN-AOI01", DeviceClass.AoiAvi, "AOI", "inspection", DriverKind.Simulated, "RC-AOI-A", null, 1.8),
        new("AOI-02", "SN-AOI02", DeviceClass.AoiAvi, "AOI", "inspection", DriverKind.Simulated, "RC-AOI-A", null, 2.0),
    ];
}
