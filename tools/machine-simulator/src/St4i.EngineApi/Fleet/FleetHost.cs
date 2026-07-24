using System.Collections.Concurrent;
using St4i.EdgeCore.Config;
using St4i.EdgeCore.Drivers;
using St4i.EdgeCore.Drivers.HotFolder;
using St4i.EdgeCore.Drivers.Simulators;
using St4i.EdgeCore.Engine;
using St4i.EdgeCore.Infrastructure;
using St4i.EdgeCore.Mapping;
using St4i.EdgeCore.Models;
using St4i.EdgeCore.Transport;
using Microsoft.Extensions.Logging;

namespace St4i.EngineApi.Fleet;

/// <summary>
/// Task 3 — the headless composition root: builds + runs the simulated fleet with NO UI, reusing
/// exactly the same EdgeCore driver→normalize→transport pipeline the WPF app's <c>FleetService</c>
/// drives (<see cref="SimulatedDriver"/>/<see cref="ScenarioAwareDriver"/>/<see cref="EdgePipeline"/>/
/// <see cref="SwitchableTransport"/>/<see cref="TransportCoordinator"/> — all relocated into EdgeCore
/// by this same task specifically so this class and the WPF exhibition app can share them byte-for-byte)
/// and exposes it to the ASP.NET minimal-API endpoints in <c>Endpoints/</c>.
///
/// Owns: the fleet roster (fleet.json with an in-code fallback — same resolution order as
/// <c>FleetService.LoadFleet</c>), per-machine <see cref="MachineState"/> (thread-safe, HTTP-GET-safe
/// snapshots), fleet-wide KPI counters, the active <see cref="ScenarioConfig"/>, and the
/// connection/Settings state a <c>PUT /v1/settings</c> mutates.
/// </summary>
public sealed class FleetHost
{
    private const double BurstMultiplier = 6.0;
    private static readonly TimeSpan BurstDuration = TimeSpan.FromSeconds(4);
    private const double MinCycleSeconds = 0.05;
    private const double OutageFakeErrorRate = 0.9;
    private const double OutageLatencyMs = 60;
    private const string ConfigKind = "recipe";

    /// <summary>Completion-review #1/#7 — bounded wait for a restart path's OLD run-task to finish
    /// tearing down before the new one starts, so at most a sliver of time (never unbounded) has two
    /// pipelines alive against the shared <see cref="_transport"/>. If the old task is still stuck past
    /// this, the restart proceeds anyway (an exhibition demo must never hang on Register/Scenario) —
    /// the identity guard in <see cref="StartLocked"/>'s catch handler is what actually prevents the
    /// stale task from corrupting shared state whenever it does eventually finish.</summary>
    private static readonly TimeSpan RestartTeardownTimeout = TimeSpan.FromSeconds(3);

    public const string DefaultServerUrl = "http://localhost:5000";
    public const string DefaultMachineCode = "ENGINE-API-01";
    public const string DefaultLanguage = "vi";

    private static readonly IReadOnlyList<ScenarioPresetInfo> Presets = new[]
    {
        new ScenarioPresetInfo("normal", "Ca binh thuong - toc do/ty le loi mac dinh cua day chuyen.", ScenarioConfig.Normal),
        new ScenarioPresetInfo("high-defect", "Lo loi cao - tang manh ty le loi tiem them de trinh dien andon/alert.", new ScenarioConfig(1.0, 0.35, 0.05, false)),
        new ScenarioPresetInfo("sensor-drift", "Sensor drift - tang toc chu ky de lo su kien troi hieu chuan dinh ky cua IOT_SENSOR.", new ScenarioConfig(5.0, 0.03, 0.05, false)),
        new ScenarioPresetInfo("network-outage", "Mat mang demo - chuyen transport sang store-and-forward loi cao (~90%).", new ScenarioConfig(1.0, 0.0, 0.0, true)),
        new ScenarioPresetInfo("hotfolder-aoi", "Hot-folder AOI - ghi 1 file doc28 mau roi de HotFolderAoiDriver doc lai that.", ScenarioConfig.Normal, TriggersHotFolderDemo: true),
    };

    private readonly object _gate = new();
    private readonly object _kpiGate = new();
    private readonly SwitchableTransport _transport;
    private readonly TransportCoordinator _transportCoordinator;
    private readonly EventBus _eventBus;
    private readonly ResilienceProbe _probe = new();
    private readonly ILogger<FleetHost>? _logger;

    /// <summary>Task C3 — optional (defaults to null so pre-existing tests that construct
    /// <see cref="FleetHost"/> directly without one, e.g. <c>FleetHostHealthAndRegistrationTests</c>,
    /// keep compiling unchanged) config-sync analogue of <see cref="_transportCoordinator"/>: forwarded
    /// the exact same mode/settings changes (see <see cref="ApplyMode"/>/<see cref="UpdateSettings"/>) so
    /// <c>SwitchableConfigSyncBackend</c> tracks Live/Demo/Auto right alongside <see cref="_transport"/>.</summary>
    private readonly St4i.EngineApi.Config.ConfigSyncCoordinator? _configSyncCoordinator;

    /// <summary>E1: per-machine live state, keyed case-insensitively by <see cref="MachineDescriptor.Code"/>.
    /// Was a plain <see cref="Dictionary{TKey,TValue}"/> built once in the ctor and never structurally
    /// mutated after — safe to read lock-free only because of that invariant. <see cref="RegisterMachine"/>
    /// breaks that invariant (machines can now be added after construction), so this is now a
    /// <see cref="ConcurrentDictionary{TKey,TValue}"/>: additions are safe to interleave with
    /// <see cref="Snapshot"/>/<see cref="MachineDetail"/> readers on other threads with no lock needed on
    /// the read side — <c>.Values</c> hands back a point-in-time copy, never a torn live view.</summary>
    private readonly ConcurrentDictionary<string, MachineState> _states;

    /// <summary>E1: mutable backing store for the fleet roster — only ever mutated (by
    /// <see cref="RegisterMachine"/>) under <see cref="_gate"/>, same lock <see cref="StartLocked"/>/
    /// <see cref="StopLocked"/> already use. The public <see cref="Fleet"/> property hands back a
    /// defensive copy so external readers never see a torn list mid-mutation.</summary>
    private readonly List<MachineDescriptor> _fleet;

    /// <summary>Task 3 (docs/plans/2026-07-21-machine-config.md) — optional (defaults to null so every
    /// pre-existing test that constructs <see cref="FleetHost"/> directly without one keeps compiling and
    /// behaving unchanged) machine operating-configuration store. Threaded into
    /// <see cref="SimulatorFactory.Create"/> so the config-aware simulators (Screwdrive/Iot/Aoi today)
    /// re-resolve their effective config live, straight off this SAME store <c>MachineSettingsEndpoints</c>
    /// writes to — a PUT against a running fleet is visible on the very next cycle, no restart.</summary>
    private readonly MachineConfigStore? _configStore;

    /// <summary>WS3-T1 — optional (defaults null so every pre-existing test that constructs
    /// <see cref="FleetHost"/> directly without one keeps compiling/behaving unchanged) source for
    /// <see cref="AoiInspectorSim"/>'s real-product-points cycle plan, threaded into
    /// <see cref="SimulatorFactory.Create"/> exactly like <see cref="_configStore"/> already is.</summary>
    private readonly St4i.EdgeCore.Config.ProductConfigStore? _productConfigStore;

    /// <summary>Task 3 — "what product is machine X running right now", keyed case-insensitively by
    /// <see cref="MachineDescriptor.Code"/>. A machine absent from this map (the common case — nothing
    /// sets it yet outside tests) resolves machine-scoped config only, exactly like a machine whose
    /// <c>configKind</c> has no product dimension at all. Read by <see cref="CurrentProductFor"/>, which
    /// every config-aware simulator's <see cref="Func{T,TResult}"/> provider (built in
    /// <see cref="StartLocked"/>) calls fresh on every cycle — so <see cref="SetCurrentProduct"/> takes
    /// effect on an already-running fleet with no restart, same as a plain adjustment does.</summary>
    private readonly ConcurrentDictionary<string, string?> _currentProduct = new(StringComparer.OrdinalIgnoreCase);

    private CancellationTokenSource? _cts;
    private Task? _runTask;
    private EdgePipeline? _currentPipeline;
    private DemoTransport? _outageTransport;
    private CancellationTokenSource? _burstRevertCts;
    private double _burstBaseline = 1.0;

    private volatile ScenarioConfig _scenario = ScenarioConfig.Normal;
    private volatile string _activePresetName = "normal";

    private long _totalCycles;
    private long _totalPass;
    private long _totalJudged;

    private string _serverUrl = DefaultServerUrl;
    private bool _verifyTls = true;
    private string _language = DefaultLanguage;
    private string _machineCode = DefaultMachineCode;

    public FleetHost(
        SwitchableTransport transport,
        TransportCoordinator transportCoordinator,
        EventBus eventBus,
        ILogger<FleetHost>? logger = null,
        St4i.EngineApi.Config.ConfigSyncCoordinator? configSyncCoordinator = null,
        MachineConfigStore? configStore = null,
        St4i.EdgeCore.Config.ProductConfigStore? productConfigStore = null)
    {
        _transport = transport ?? throw new ArgumentNullException(nameof(transport));
        _transportCoordinator = transportCoordinator ?? throw new ArgumentNullException(nameof(transportCoordinator));
        _eventBus = eventBus ?? throw new ArgumentNullException(nameof(eventBus));
        _logger = logger;
        _configSyncCoordinator = configSyncCoordinator;
        _configStore = configStore;
        _productConfigStore = productConfigStore;

        _fleet = LoadFleet().ToList();
        _states = new ConcurrentDictionary<string, MachineState>(StringComparer.OrdinalIgnoreCase);
        foreach (var descriptor in _fleet)
        {
            _states[descriptor.Code] = new MachineState(descriptor);
        }

        SeedAoiProductLinks();
    }

    /// <summary>WS3-T2 (docs/PRODUCTION_UI_DESIGN.md §3.2/§3.4, ws3-t1-report.md's fast-follow #1) —
    /// WS3-T1 built the per-step cycle-plan machinery and proved AOI's plan carries a linked product's
    /// REAL points end-to-end, but nothing ever called <see cref="SetCurrentProduct"/> for the shipped
    /// roster, so AOI-01/AOI-02 ran un-linked by default and a live <c>GET /v1/machines/AOI-01</c>
    /// returned <c>"plan":null</c> — no per-point data for the living-twin schematic to draw, which is
    /// the whole point of this task. This seeds every <see cref="DeviceClass.AoiAvi"/> machine in the
    /// roster (fleet order) with one of <see cref="_productConfigStore"/>'s own catalog products,
    /// round-robin (1st AOI machine → the 1st product code alphabetically, i.e. seeded "MODEL-A"; 2nd
    /// AOI machine → "MODEL-B"; wrapping if there are more AOI machines than products) — a real,
    /// already-seeded product, never a fabricated one. A caller can still override any of these later via
    /// <see cref="SetCurrentProduct"/> (e.g. a future settings/onboarding endpoint) since this only seeds
    /// the SAME <see cref="_currentProduct"/> map that method writes.
    ///
    /// No-op (nothing to link) when no <see cref="ProductConfigStore"/> is wired or it has zero products
    /// — the same "ordinary case, not an error" contract <c>AoiInspectorSim.ResolveRealPoints</c> already
    /// documents for an unresolved product. Runs once, at construction, before this instance is published
    /// to any other thread — no lock needed, same reasoning <see cref="ProductConfigStore.Load"/> itself
    /// documents.</summary>
    private void SeedAoiProductLinks()
    {
        if (_productConfigStore is null) return;

        var products = _productConfigStore.ListProducts();
        if (products.Count == 0) return;

        var aoiMachines = _fleet.Where(d => d.DeviceClass == DeviceClass.AoiAvi).ToList();
        for (var i = 0; i < aoiMachines.Count; i++)
        {
            _currentProduct[aoiMachines[i].Code] = products[i % products.Count].Code;
        }
    }

    /// <summary>Point-in-time copy of the fleet roster. E1: no longer a fixed, ctor-built list —
    /// <see cref="RegisterMachine"/> can append to it after construction, so this getter takes
    /// <see cref="_gate"/> to hand back a stable snapshot rather than exposing the live, mutable
    /// backing list to a caller that might enumerate it while a registration is in flight.</summary>
    public IReadOnlyList<MachineDescriptor> Fleet
    {
        get { lock (_gate) return _fleet.ToArray(); }
    }

    public ITransport Transport => _transport;

    /// <summary>Test-only seam (default no-op) — lets <c>St4i.EngineApi.Tests</c> wrap the pipeline's
    /// <see cref="IDeviceDriver"/> in a fault-injecting decorator so the restart-race identity guard
    /// (completion-review.md #1/#7) can be reproduced deterministically instead of relying on real
    /// non-determinism. Applied once per <see cref="StartLocked"/> call, right after the real driver is
    /// built; production code never sets this (<c>internal</c>, requires <c>InternalsVisibleTo</c>).</summary>
    internal Func<IDeviceDriver, IDeviceDriver>? DriverDecoratorForTests { get; set; }

    public bool IsRunning { get; private set; }

    /// <summary>Branch-review C-2 — the E-STOP latch, now owned by the engine (not any one browser
    /// tab's React state) so it's shared across every panel that polls <see cref="Snapshot"/> and
    /// survives a page reload. Only <see cref="Estop"/> sets it; only <see cref="ResetEstop"/> clears
    /// it — never touched implicitly by <see cref="Start"/>/<see cref="Stop"/>, so an operator/API
    /// stop is never mistaken for an emergency one.</summary>
    public bool EstopEngaged { get { lock (_gate) return _estopEngaged; } }

    private bool _estopEngaged;

    public Exception? LastError { get; private set; }

    public TransportMode Mode => _transportCoordinator.Mode;

    public ScenarioConfig CurrentScenario => _scenario;

    public string ActivePresetName => _activePresetName;

    /// <summary>Read-only snapshot of the currently-active scenario — unlike <see cref="ApplyScenario"/>,
    /// this never mutates anything (no restart, no transport swap), so it's safe for a <c>GET</c>.</summary>
    public ScenarioDto CurrentScenarioDto() => ScenarioDto.From(_scenario, _activePresetName);

    // ─────────────────────────────────────────────────────────────────────
    // START/STOP
    // ─────────────────────────────────────────────────────────────────────

    /// <summary>Completion-review #1/#7 — the OLD run-task/CTS a <see cref="StopLocked"/> tears down,
    /// handed back to the caller instead of being discarded so it can be awaited/disposed OUTSIDE
    /// <see cref="_gate"/> (see <see cref="WaitAndDisposeOldPipeline"/>'s remarks on why that has to
    /// happen off-lock).</summary>
    private readonly record struct PipelineHandle(Task? RunTask, CancellationTokenSource? Cts);

    public void Start()
    {
        lock (_gate) StartLocked();
    }

    public void Stop()
    {
        // Wait/dispose must happen OUTSIDE _gate — see WaitAndDisposeOldPipeline's remarks. Stop()
        // itself stays synchronous (bounded by RestartTeardownTimeout) so a caller observing it return
        // can trust the old pipeline is actually torn down, not just "cancel requested".
        PipelineHandle handle;
        lock (_gate) handle = StopLocked();
        WaitAndDisposeOldPipeline(handle);
    }

    /// <summary>Branch-review C-2/C-3 — a real, confirmed emergency stop: tears the pipeline down (same
    /// path <see cref="Stop"/> uses) and only THEN latches <see cref="EstopEngaged"/>, so a caller
    /// awaiting this method genuinely knows the machine stopped before it reports success (C-3 — the
    /// client used to latch and log a success banner on a fire-and-forget POST that could still fail).
    /// The latch itself is engine-owned (not client React state), so it's visible on every subsequent
    /// <see cref="Snapshot"/> to every panel/tab, and survives a page reload.</summary>
    public void Estop()
    {
        PipelineHandle handle;
        lock (_gate)
        {
            handle = StopLocked();
            _estopEngaged = true;
        }

        WaitAndDisposeOldPipeline(handle);
    }

    /// <summary>Clears the E-STOP latch — an explicit, separate transition from <see cref="Start"/>
    /// (spec/C-2: "RESET clears the latch but does NOT auto-restart the fleet"). The fleet stays
    /// stopped until an operator presses START again.</summary>
    public void ResetEstop()
    {
        lock (_gate)
        {
            _estopEngaged = false;
        }
    }

    private void StartLocked()
    {
        // Defense in depth: the client already disables START while latched, but the engine itself
        // must refuse too — a stale client, a second panel, or a direct API call must never be able to
        // restart a machine that's still emergency-stopped.
        if (IsRunning || _estopEngaged) return;
        LastError = null;

        // Assumes the caller already holds _gate (Start()/ApplyScenario()/RegisterMachine() all do) —
        // reads _fleet directly rather than through the Fleet property so a Register-while-running
        // restart always rebuilds sims from the CURRENT roster, including whatever was just added.
        var multiplier = _scenario.CycleRateMultiplier > 0 ? _scenario.CycleRateMultiplier : 1.0;
        var effectiveFleet = Math.Abs(multiplier - 1.0) < 1e-9
            ? _fleet
            : _fleet.Select(d => d with { CycleSeconds = Math.Max(MinCycleSeconds, d.CycleSeconds / multiplier) }).ToList();

        // Task 3: threading _configStore/CurrentProductFor through here (rather than baking resolved
        // values into the sims at construction) is what makes a live settings edit apply to an
        // ALREADY-RUNNING fleet — each config-aware sim re-resolves fresh on every single cycle (see
        // SimulatorBase.ResolveEffectiveConfig's remarks), so nothing here needs to change on Restart
        // for a mid-run edit to show up; a restart is only needed for a scenario cycle-rate multiplier
        // change (see the surrounding ApplyScenario/RegisterMachine callers of this method).
        //
        // I-5 (mc-feature-review.md) — ALSO pass `multiplier` itself (not just the pre-scaled descriptor
        // above) so a config-aware sim's own CycleSecondsOverride (Screwdrive/Iot — always non-null once
        // _configStore is wired, which production always is) composes with the active scenario instead of
        // overriding it outright. Safe to bake in at construction (not a live Func<double>, unlike
        // _configStore itself): a multiplier change ALWAYS restarts this whole pipeline (multiplierChanged
        // check in ApplyScenario/Burst), so it can never go stale for the lifetime of these sim instances.
        var sims = effectiveFleet.Select((d, i) => SimulatorFactory.Create(d, seed: 1000 + i, _configStore, CurrentProductFor, multiplier, _productConfigStore)).ToList();
        IDeviceDriver driver = new ScenarioAwareDriver(new SimulatedDriver(sims), () => _scenario);

        var decorator = DriverDecoratorForTests;
        if (decorator is not null)
        {
            driver = decorator(driver);
        }

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
                // Expected on Stop() — see FleetService's matching remarks in the WPF app.
            }
            catch (Exception ex)
            {
                _logger?.LogError(ex, "FleetHost pipeline faulted");

                // Completion-review #1: this runs off-thread, well after StartLocked() returned — a
                // restart (StopLocked immediately followed by StartLocked, see RegisterMachine/
                // ApplyScenario below) can already have replaced _cts/_currentPipeline with a NEW
                // pipeline's by the time a stale/cancelled-but-slow-to-unwind task's catch gets here.
                // Re-acquire _gate and only touch the shared IsRunning/LastError if THIS task's own
                // `cts`/`pipeline` closures are still the CURRENT ones — otherwise this is a superseded
                // pipeline's fault and must not clobber a freshly-restarted, healthy fleet.
                lock (_gate)
                {
                    if (ReferenceEquals(_cts, cts) && ReferenceEquals(_currentPipeline, pipeline))
                    {
                        LastError = ex;
                        IsRunning = false;
                    }
                }
            }
        });
    }

    /// <summary>Cancels + detaches the current pipeline and returns it as a <see cref="PipelineHandle"/>
    /// instead of discarding it — callers that immediately restart (<see cref="RegisterMachine"/>/
    /// <see cref="ApplyScenario"/>) release <see cref="_gate"/>, wait for the old task via
    /// <see cref="WaitAndDisposeOldPipeline"/>, THEN re-acquire the gate to call <see cref="StartLocked"/>
    /// — never while still holding it (the catch above re-acquires <see cref="_gate"/>, so waiting for
    /// the old task from inside this same lock would deadlock whenever that catch actually needs to
    /// run). Assumes the caller already holds <see cref="_gate"/>.</summary>
    private PipelineHandle StopLocked()
    {
        if (!IsRunning) return default;

        var oldTask = _runTask;
        var oldCts = _cts;

        oldCts?.Cancel();
        _cts = null;
        _runTask = null;
        IsRunning = false;

        if (_currentPipeline is not null)
        {
            _currentPipeline.Committed -= OnPipelineCommitted;
            _currentPipeline = null;
        }

        return new PipelineHandle(oldTask, oldCts);
    }

    /// <summary>Completion-review #7 — bounded, OFF-LOCK wait for the old run-task to actually finish
    /// (closing the "leaked CTS + briefly two pipelines share <see cref="_transport"/>" gap) before the
    /// caller starts a new one. Must never be called while holding <see cref="_gate"/>: the run-task's
    /// own catch handler (see <see cref="StartLocked"/>) re-acquires <see cref="_gate"/> to apply its
    /// identity-guarded write, so a caller blocked on <c>Task.Wait()</c> for that same task WHILE holding
    /// the gate would deadlock against it. If the old task is still stuck past the timeout, this gives up
    /// and disposes the CTS anyway — Cancel() has already been requested, so the task will eventually
    /// unwind and its own identity guard (not this method) is what keeps a late finish from corrupting
    /// state.</summary>
    private void WaitAndDisposeOldPipeline(PipelineHandle handle)
    {
        if (handle.RunTask is not null)
        {
            try
            {
                handle.RunTask.Wait(RestartTeardownTimeout);
            }
            catch (AggregateException ex)
            {
                // Defensive only: the run-task's own body catches every exception it can throw
                // (OperationCanceledException and general Exception both handled internally, see
                // StartLocked), so this Task should never actually fault. If something inside that catch
                // itself somehow throws, this just keeps Task.Wait()'s unwrap-and-rethrow from surfacing
                // as an unhandled exception on the restart caller instead of a log line.
                _logger?.LogDebug(ex, "FleetHost old pipeline teardown wait observed a faulted task");
            }
        }

        handle.Cts?.Dispose();
    }

    private void OnPipelineCommitted(DeviceReading reading, TransportAck ack)
    {
        if (_states.TryGetValue(reading.MachineCode, out var state))
        {
            state.ApplyReading(reading, ack);
        }

        Interlocked.Increment(ref _totalCycles);

        if (reading.Verdict != Verdict.Skip)
        {
            lock (_kpiGate)
            {
                _totalJudged++;
                if (reading.Verdict is Verdict.Pass or Verdict.Warn) _totalPass++;
            }
        }
    }

    // ─────────────────────────────────────────────────────────────────────
    // SNAPSHOTS
    // ─────────────────────────────────────────────────────────────────────
    public FleetSnapshotDto Snapshot()
    {
        // M-3: IsRunning is only ever WRITTEN under _gate (StartLocked/StopLocked) — read it under the
        // same lock here too (a GET can land on a different thread than whichever POST last flipped it)
        // rather than relying on an unsynchronized read of a plain, non-volatile bool. E1: read it FIRST
        // so both the per-tile status projection and the online count use the exact same running/stopped
        // verdict — no window where one reflects a stale value the other doesn't.
        bool isRunning;
        bool estopEngaged;
        lock (_gate)
        {
            isRunning = IsRunning;
            estopEngaged = _estopEngaged;
        }

        // _states.Values (ConcurrentDictionary) is a point-in-time copy, safe to enumerate here even if
        // RegisterMachine adds an entry on another thread concurrently (E1) — no lock needed.
        var machines = _states.Values
            .OrderBy(s => s.Code, StringComparer.Ordinal)
            .Select(s => s.ToTile(isRunning))
            .ToList();

        // E1 (health-truth): online must reflect the RUNNING state, not "ever produced a cycle" — the
        // pre-fix bug was a stopped fleet that stayed "N/N online" forever because Cycles never resets.
        var online = isRunning ? machines.Count(m => m.Cycles > 0) : 0;
        var totalCycles = Interlocked.Read(ref _totalCycles);
        double fpy;
        lock (_kpiGate)
        {
            fpy = _totalJudged == 0 ? 0.0 : (double)_totalPass / _totalJudged;
        }

        return new FleetSnapshotDto(machines, new FleetKpisDto(online, totalCycles, fpy), isRunning, estopEngaged);
    }

    /// <summary>Branch-review I-9 — gated exactly like <see cref="ToTile(bool)"/>: when the fleet
    /// pipeline is NOT running, the reported <c>StatusText</c> is forced to idle regardless of the last
    /// real verdict, so <c>GET /v1/machines/{code}</c> can no longer disagree with <c>GET /v1/fleet</c>
    /// about whether a stopped machine is "OK" (the live-reproduced bug: a stopped machine kept
    /// rendering a green "ĐẠT" pass badge because this DTO alone was never gated).</summary>
    public MachineDetailDto? MachineDetail(string code)
    {
        bool isRunning;
        lock (_gate)
        {
            isRunning = IsRunning;
        }

        return _states.TryGetValue(code, out var state) ? state.ToDetail(isRunning) : null;
    }

    // ─────────────────────────────────────────────────────────────────────
    // DYNAMIC REGISTRATION (E1) — foundation for the onboarding overhaul (E2 calls this).
    // ─────────────────────────────────────────────────────────────────────
    /// <summary>Adds a machine to the LIVE fleet roster at runtime. Returns <see langword="false"/>
    /// (no-op, no throw) if <paramref name="descriptor"/>'s <see cref="MachineDescriptor.Code"/>
    /// already exists (case-insensitively) — E2's onboarding flow can call this speculatively without
    /// pre-checking for a race against another registration.
    ///
    /// Concurrency: the roster mutation (dup-check + <c>_fleet.Add</c> + <c>_states.TryAdd</c>) happens
    /// under <see cref="_gate"/> — the same lock <see cref="StartLocked"/>/<see cref="StopLocked"/>/
    /// <see cref="ApplyScenario"/> already serialize on. <see cref="Snapshot"/>/<see cref="MachineDetail"/>
    /// take no lock at all (by design — they're hot GET paths) and remain safe to call concurrently with
    /// this method because <see cref="_states"/> is a <see cref="ConcurrentDictionary{TKey,TValue}"/>:
    /// the new entry either isn't visible yet or is fully constructed when it becomes visible, never torn.
    ///
    /// If the fleet is currently running, the pipeline is restarted — completion-review #1/#7:
    /// <see cref="StopLocked"/> runs under <see cref="_gate"/> and hands back the OLD run-task/CTS, the
    /// gate is released, <see cref="WaitAndDisposeOldPipeline"/> waits for that old task OFF-LOCK (bounded
    /// by <see cref="RestartTeardownTimeout"/>, required — the old task's own catch re-acquires
    /// <see cref="_gate"/>, so waiting for it while still holding the gate would deadlock), and only THEN
    /// does a fresh <c>lock (_gate) StartLocked()</c> rebuild the pipeline from the current roster
    /// (including whatever was just added). There's a narrow window between those two locked sections
    /// where another thread could itself call <see cref="Stop"/>/<see cref="Start"/> and observe/flip
    /// <see cref="IsRunning"/> — accepted the same way the pre-existing restart-under-one-lock code
    /// accepted "last writer wins" for concurrent scenario/registration calls; this is a single-operator
    /// exhibition tool, not a multi-writer production control plane. Every other machine's
    /// <see cref="MachineState"/> (and its I-1 cycle-offset) survives the restart untouched, exactly as it
    /// does for a scenario-triggered restart. If the fleet is stopped, the new machine is simply included
    /// the next time <see cref="Start"/> runs.
    ///
    /// Either way, the new machine is visible in the very next <see cref="Snapshot"/> immediately —
    /// idle status, 0 cycles — since its <see cref="MachineState"/> is inserted before this method
    /// returns.</summary>
    public bool RegisterMachine(MachineDescriptor descriptor)
    {
        ArgumentNullException.ThrowIfNull(descriptor);
        if (string.IsNullOrWhiteSpace(descriptor.Code))
        {
            throw new ArgumentException("MachineDescriptor.Code must not be null/blank.", nameof(descriptor));
        }

        PipelineHandle restartHandle = default;
        var restarting = false;

        lock (_gate)
        {
            if (_fleet.Any(d => string.Equals(d.Code, descriptor.Code, StringComparison.OrdinalIgnoreCase)))
            {
                return false;
            }

            _fleet.Add(descriptor);
            // TryAdd (not the indexer): the _fleet duplicate-check above is the source of truth under
            // this same lock, so a collision here would indicate _fleet/_states drifted out of sync —
            // fail loudly (silently returning false here) rather than clobber an existing MachineState.
            if (!_states.TryAdd(descriptor.Code, new MachineState(descriptor)))
            {
                _fleet.RemoveAt(_fleet.Count - 1);
                return false;
            }

            if (IsRunning)
            {
                restartHandle = StopLocked();
                restarting = true;
            }
        }

        if (restarting)
        {
            WaitAndDisposeOldPipeline(restartHandle);
            lock (_gate) StartLocked();
        }

        return true;
    }

    // ─────────────────────────────────────────────────────────────────────
    // SCENARIO
    // ─────────────────────────────────────────────────────────────────────
    public ScenarioDto ApplyScenario(ScenarioConfig config, string? presetName = null)
    {
        ArgumentNullException.ThrowIfNull(config);

        PipelineHandle restartHandle = default;
        var restarting = false;

        lock (_gate)
        {
            var previous = _scenario;
            _scenario = config;
            _activePresetName = presetName ?? "custom";

            ApplyNetworkOutageLocked(config.NetworkOutage);

            var multiplierChanged = Math.Abs(config.CycleRateMultiplier - previous.CycleRateMultiplier) > 1e-9;
            if (IsRunning && multiplierChanged)
            {
                restartHandle = StopLocked();
                restarting = true;
            }
        }

        // Completion-review #1/#7 — same off-lock wait-then-restart shape as RegisterMachine above;
        // see its doc comment for the full deadlock/identity-guard reasoning.
        if (restarting)
        {
            WaitAndDisposeOldPipeline(restartHandle);
            lock (_gate) StartLocked();
        }

        return ScenarioDto.From(_scenario, _activePresetName);
    }

    public IReadOnlyList<ScenarioPresetInfo> ListPresets() => Presets;

    public async Task<(ScenarioPresetInfo? Preset, ScenarioDto? Applied, string? HotFolderStatus)> ApplyPresetAsync(string name, CancellationToken ct)
    {
        var preset = Presets.FirstOrDefault(p => string.Equals(p.Name, name, StringComparison.OrdinalIgnoreCase));
        if (preset is null) return (null, null, null);

        var applied = ApplyScenario(preset.Config, preset.Name);

        string? hotFolderStatus = null;
        if (preset.TriggersHotFolderDemo)
        {
            hotFolderStatus = await RunHotFolderAoiDemoAsync(ct).ConfigureAwait(false);
        }

        return (preset, applied, hotFolderStatus);
    }

    public ScenarioDto Burst()
    {
        CancellationTokenSource cts;
        double baseline;
        lock (_gate)
        {
            cts = new CancellationTokenSource();
            var previousCts = _burstRevertCts;

            if (previousCts is null)
            {
                _burstBaseline = _scenario.CycleRateMultiplier;
            }

            previousCts?.Cancel();
            _burstRevertCts = cts;
            baseline = _burstBaseline;
        }

        var applied = ApplyScenario(_scenario with { CycleRateMultiplier = BurstMultiplier }, presetName: "burst");
        _ = RevertBurstAfterDelayAsync(baseline, cts);
        return applied;
    }

    private async Task RevertBurstAfterDelayAsync(double baseline, CancellationTokenSource cts)
    {
        try
        {
            await Task.Delay(BurstDuration, cts.Token).ConfigureAwait(false);
        }
        catch (OperationCanceledException)
        {
            return;
        }

        bool shouldRevert;
        lock (_gate)
        {
            shouldRevert = _burstRevertCts == cts;
            if (shouldRevert) _burstRevertCts = null;
        }

        if (shouldRevert)
        {
            ApplyScenario(_scenario with { CycleRateMultiplier = baseline }, presetName: _activePresetName);
        }
    }

    /// <summary>Assumes the caller already holds <see cref="_gate"/>.</summary>
    private void ApplyNetworkOutageLocked(bool outage)
    {
        if (outage)
        {
            _outageTransport ??= new DemoTransport(latencyMs: OutageLatencyMs, fakeErrorRate: OutageFakeErrorRate);
            _transport.SetInner(_outageTransport);
        }
        else
        {
            _transportCoordinator.ApplyMode(_transportCoordinator.Mode);
        }
    }

    /// <summary>Writes one guaranteed-NG doc-28 file and runs a dedicated <see cref="EdgePipeline"/> over
    /// a real <see cref="HotFolderAoiDriver"/> watching it — the headless-host analogue of the WPF app's
    /// <c>FleetService.RunHotFolderAoiDemoAsync</c>, sharing this host's own <see cref="Transport"/>/
    /// EventBus so the round-tripped reading shows up on the WS inspector stream exactly like a real
    /// machine's would.</summary>
    public async Task<string> RunHotFolderAoiDemoAsync(CancellationToken ct)
    {
        var baseDir = Path.Combine(Path.GetTempPath(), "st4i-engineapi-hotfolder-demo");
        var watchDir = Path.Combine(baseDir, "in");
        var archiveDir = Path.Combine(baseDir, "archive");
        var errorDir = Path.Combine(baseDir, "error");

        try
        {
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
                timeoutCts.Cancel();
            }

            pipeline.Committed += OnCommitted;
            timeoutCts.CancelAfter(TimeSpan.FromSeconds(5));
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
                return $"Wrote {fileName} to {watchDir} but HotFolderAoiDriver did not confirm read-back within 5s.";
            }

            var ngCount = ingested.Measurements.Count(m => string.Equals(m.Result, "NG", StringComparison.OrdinalIgnoreCase));
            return $"Wrote {fileName} — HotFolderAoiDriver read it back: {ngCount}/{ingested.Measurements.Count} NG point(s), verdict={ingested.Verdict}.";
        }
        finally
        {
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

    // ─────────────────────────────────────────────────────────────────────
    // CURRENT PRODUCT (Task 3) — which product's machine×product settings layer a config-aware
    // simulator resolves against right now.
    // ─────────────────────────────────────────────────────────────────────

    /// <summary>Sets (or, with <paramref name="productCode"/> null, clears) the product this machine is
    /// currently running — read fresh, per cycle, by every config-aware simulator's product-code
    /// provider (see <see cref="StartLocked"/>), so this takes effect on an already-running fleet
    /// immediately, no restart. Does not validate <paramref name="productCode"/> against
    /// <c>ProductConfigStore</c> — Task 3's scope is "the effective config drives behaviour", not product
    /// catalog validation, and an unknown product code simply resolves to no product-scoped adjustments
    /// (falls through to the machine-scoped/baseline layers), never an error.</summary>
    public void SetCurrentProduct(string machineCode, string? productCode)
    {
        ArgumentException.ThrowIfNullOrEmpty(machineCode);
        if (string.IsNullOrWhiteSpace(productCode))
        {
            _currentProduct.TryRemove(machineCode, out _);
        }
        else
        {
            _currentProduct[machineCode] = productCode;
        }
    }

    /// <summary>The product <paramref name="machineCode"/> is currently running, or null if none has been
    /// set (machine-scoped config only).</summary>
    public string? CurrentProductFor(string machineCode) =>
        _currentProduct.TryGetValue(machineCode, out var productCode) ? productCode : null;

    // ─────────────────────────────────────────────────────────────────────
    // SYNC-CONFIG
    // ─────────────────────────────────────────────────────────────────────
    public async Task<SyncConfigResponse?> SyncConfigAsync(string code, CancellationToken ct)
    {
        if (!_states.TryGetValue(code, out var state)) return null;

        try
        {
            var result = await _transport.SyncConfigAsync(state.Code, ConfigKind, state.CachedConfigVersion, ct).ConfigureAwait(false);
            state.ApplyConfigSync(result);
            return new SyncConfigResponse(state.Code, result.Changed, result.Version, result.DriftState, result.Applied, state.DriftState);
        }
        catch (Exception ex)
        {
            state.ApplyConfigSyncError(ex.Message);
            return new SyncConfigResponse(state.Code, false, state.CachedConfigVersion, "error", false, state.DriftState);
        }
    }

    // ─────────────────────────────────────────────────────────────────────
    // SETTINGS
    // ─────────────────────────────────────────────────────────────────────
    public SettingsDto GetSettings()
    {
        lock (_gate)
        {
            return new SettingsDto(_serverUrl, _verifyTls, _language, _machineCode, _transportCoordinator.Mode);
        }
    }

    public SettingsDto UpdateSettings(SettingsUpdateRequest request)
    {
        bool rebuildNeeded;
        lock (_gate)
        {
            rebuildNeeded = false;
            if (request.ServerUrl is not null) { _serverUrl = request.ServerUrl; rebuildNeeded = true; }
            if (request.VerifyTls is not null) { _verifyTls = request.VerifyTls.Value; rebuildNeeded = true; }
            if (request.MachineCode is not null) { _machineCode = request.MachineCode; rebuildNeeded = true; }
            if (request.Language is not null) { _language = request.Language; }
        }

        if (rebuildNeeded)
        {
            var mkKey = CredentialStore.Load(_machineCode);
            _transportCoordinator.RebuildLive(_serverUrl, _machineCode, mkKey, _verifyTls);
            _configSyncCoordinator?.RebuildLive(_serverUrl, _machineCode, mkKey, _verifyTls, _transportCoordinator.Mode);
        }

        return GetSettings();
    }

    public Task<ProbeResult> ProbeAsync(string serverUrl, CancellationToken ct) => _probe.ProbeAsync(serverUrl, ct);

    public void ApplyMode(TransportMode mode)
    {
        _transportCoordinator.ApplyMode(mode);
        _configSyncCoordinator?.ApplyMode(mode);
    }

    // ─────────────────────────────────────────────────────────────────────
    // FLEET ROSTER — same resolution order as the WPF app's FleetService.LoadFleet/ResolveFleetPath.
    // ─────────────────────────────────────────────────────────────────────
    private static IReadOnlyList<MachineDescriptor> LoadFleet()
    {
        var path = ResolveFleetPath();
        if (path is not null)
        {
            try
            {
                var loaded = FleetConfig.Load(path);
                if (loaded.Count > 0) return loaded;
            }
            catch (FleetConfigException)
            {
                // Malformed fleet.json — fall through to the in-code default rather than fail startup.
            }
        }

        return BuildDefaultFleet();
    }

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
