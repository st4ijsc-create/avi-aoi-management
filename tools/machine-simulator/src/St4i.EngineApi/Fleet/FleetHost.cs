using System.Collections.Concurrent;
using St4i.EdgeCore.Config;
using St4i.EdgeCore.Drivers;
using St4i.Connector.Abstractions;
using St4i.EdgeCore.Drivers.HotFolder;
using St4i.EdgeCore.Drivers.Modbus;
using St4i.EdgeCore.Drivers.Simulators;
using St4i.EdgeCore.Engine;
using St4i.EdgeCore.Historian;
using St4i.EdgeCore.Infrastructure;
using St4i.EdgeCore.Mapping;
using St4i.EdgeCore.Models;
using St4i.Connector.Abstractions.Models;
using St4i.EdgeCore.Transport;
using St4i.EdgeCore.Uns;
using St4i.EngineApi.AssetRegistry;
using Microsoft.Extensions.Logging;

namespace St4i.EngineApi.Fleet;

/// <summary>GĐ3 sub-4 LC-2 — one pipeline slot's driver health, as read by <see cref="FleetHost.GetDriverHealth"/>:
/// the slot's label, its driver's <see cref="IDeviceDriver.Kind"/> (GP-3: a free-form connector id, no
/// longer a closed enum), and its current <see cref="DriverHealthState"/>. A top-level (not nested) type
/// — same "small DTO sitting alongside the class it's produced by" idiom as
/// <see cref="St4i.EngineApi.Safety.SafetySnapshot"/> for <see cref="FleetHost.GetSafetyStatus"/>.</summary>
public sealed record DriverHealthSnapshot(string SlotLabel, string Kind, DriverHealthState Health);

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

    /// <summary>WS-A-T7 — optional (defaults null so every pre-existing test/call site that constructs
    /// <see cref="FleetHost"/> directly without one, e.g. <c>FleetHostHealthAndRegistrationTests</c>,
    /// keeps compiling/behaving byte-for-byte unchanged) durable-historian sink. Fed ALONGSIDE the
    /// existing in-memory <see cref="MachineState"/> path in <see cref="OnPipelineCommitted"/> (never
    /// instead of it) and the genuine OPERATOR run-state transitions — <see cref="Start"/>/
    /// <see cref="Stop"/> (guarded to a real not-running↔running transition), <see cref="Estop"/>,
    /// <see cref="ResetEstop"/> — this class owns no historian logic itself, just forwards to
    /// <see cref="HistorianWriter"/>'s own non-blocking, non-throwing
    /// <c>Enqueue</c>/<c>RecordRunEventFireAndForget</c>. Fix round 1 (WS-A-T7 review): deliberately NOT
    /// emitted from the shared <c>StartLocked</c>/<c>StopLocked</c> helpers — those are also the internal
    /// restart chokepoint <see cref="RegisterMachine"/>/<see cref="ApplyScenario"/>/<see cref="Burst"/>
    /// use, and emitting there would pollute the historian's run-event timeline (OEE Availability =
    /// Start→next Stop/Estop) with a spurious Stop/Start pair on every internal restart, and make
    /// <see cref="Estop"/> double-emit "Stop" + "Estop" for the same teardown.</summary>
    private readonly HistorianWriter? _historianWriter;

    /// <summary>G2-2 (docs/plans/2026-07-27-giaidoan2-synapse-connect-blueprint.md task 2) — optional
    /// (defaults null, same "every pre-existing test that constructs <see cref="FleetHost"/> directly
    /// without one keeps compiling/behaving byte-for-byte unchanged" contract as every other optional
    /// store/writer above) local Unified Namespace publisher. Threaded straight into every
    /// <see cref="EdgePipeline"/> this host builds (see <see cref="StartLocked"/>) so every committed
    /// reading is additively mirrored onto the Sparkplug + <c>syn/...</c> topics — never instead of, and
    /// never able to slow down, the existing ST4I HTTP path this same pipeline already drives.
    ///
    /// G2-3 — typed against the <see cref="IUnsPublisher"/> INTERFACE (not the concrete
    /// <see cref="UnsPublisher"/>) so a test can inject a fake that records calls without a real broker;
    /// <see cref="EdgePipeline"/> already took the interface, so this only changes this field/ctor param's
    /// own declared type — every existing call site (<see cref="StartLocked"/> passing <c>_unsPublisher</c>
    /// into <see cref="EdgePipeline"/>'s ctor) keeps compiling unchanged. Also now the seam
    /// <see cref="Start"/>/<see cref="Stop"/>/<see cref="Estop"/> call <see cref="IUnsPublisher.PublishNodeBirth"/>/
    /// <see cref="IUnsPublisher.PublishNodeDeath"/> through, at the SAME guarded real-transition sites as the
    /// historian run-events above.</summary>
    private readonly IUnsPublisher? _unsPublisher;

    /// <summary>GP-4 (.superpowers/sdd/2026-07-28-wsg-plugin-connector-seam-blueprint/task-4-brief.md) —
    /// optional (defaults null, same "every pre-existing test/call site that constructs
    /// <see cref="FleetHost"/> directly without one keeps compiling/behaving byte-for-byte unchanged"
    /// contract as every other optional dependency above) connector-id-keyed registry, replacing what used
    /// to be TWO separate per-driver-kind fields here: <c>Func&lt;IDeviceDriver&gt;? _modbusDriverFactory</c>
    /// and <c>OpcUaDriverFactory? _opcUaDriverFactory</c> (G2-6 / GĐ3 sub-3 OU-1). Every registered
    /// connector rides the SAME G2-5 per-slot fault isolation those two fields' pipeline slots always did
    /// (see <see cref="StartLocked"/>) — a fault in any one connector, or a connector that fails to even
    /// BUILD (a bad config, or a third-party factory that throws despite
    /// <see cref="St4i.Connector.Abstractions.IConnectorFactory.TryCreate"/>'s contract not to), can never
    /// touch the simulated fleet or any sibling connector. Production (Program.cs) registers Modbus/OPC-UA
    /// into this registry via the <c>ModbusConnectorFactory</c>/<c>OpcUaConnectorFactory</c> adapters;
    /// <see cref="StartLocked"/> asks it fresh, on every call, for the full set of configured connector ids
    /// and a driver for each — this is what "onboarding a connector" now means: one
    /// <see cref="ConnectorRegistry.Register"/> call, zero changes to this class.</summary>
    private readonly ConnectorRegistry? _connectorRegistry;

    /// <summary>GP-5 (.superpowers/sdd/2026-07-28-wsg-plugin-connector-seam-blueprint/task-5-brief.md item
    /// 3, carried from the GP-4 review) — every currently-registered connector id that FAILED to start on
    /// its most recent <see cref="StartLocked"/> attempt, keyed by connector id, valued by the operator-
    /// readable error <see cref="ConnectorRegistry.TryCreateDriver"/> (or this class's own defensive catch)
    /// produced. Mutated only inside <see cref="StartLocked"/> (assumes the caller holds <see cref="_gate"/>,
    /// same as every other <see cref="StartLocked"/>-owned mutation) — a <see cref="ConcurrentDictionary{TKey,TValue}"/>
    /// purely so <see cref="GetConfiguredConnectorIssues"/> (a hot GET-style read, like
    /// <see cref="GetDriverHealth"/>) never needs to take <see cref="_gate"/> itself. An entry is added the
    /// first time its connector fails to build a driver, and removed the next time that SAME connector id
    /// succeeds (see the connector loop in <see cref="StartLocked"/>) — so this reflects the LATEST attempt
    /// only, never a permanently-stuck "once failed, always failed" state.</summary>
    private readonly ConcurrentDictionary<string, string> _connectorStartIssues = new(StringComparer.Ordinal);

    /// <summary>P2-1 (WS-J Asset Registry) — optional (defaults null, same "every pre-existing test that
    /// constructs <see cref="FleetHost"/> directly without one keeps compiling/behaving byte-for-byte
    /// unchanged" contract as every other optional dependency above) durable canonical asset registry.
    /// Upserted — fire-and-forget, never awaited (<see cref="IAssetRegistry.UpsertAsync"/> itself never
    /// throws, see that interface's doc comment) — once per roster-seed machine in the ctor below, and
    /// again on every dynamic <see cref="RegisterMachine"/> call, so every machine this host ever knows
    /// about becomes a durable asset row with no separate "sync the registry" step required.</summary>
    private readonly IAssetRegistry? _assetRegistry;

    /// <summary>FF-1 (docs/plans/2026-07-27-ws-ff-fast-follows.md) — optional (defaults null, same
    /// "every pre-existing test that constructs <see cref="FleetHost"/> directly without one keeps
    /// compiling/behaving byte-for-byte unchanged" contract as every other optional store above)
    /// atomic-JSON-backed persistence for <see cref="_serverUrl"/>/<see cref="_machineCode"/>/
    /// <see cref="_verifyTls"/> — written by <see cref="UpdateSettings"/> on every change so a runtime
    /// <c>PUT /v1/settings</c> survives a process restart. Deliberately never asked to persist
    /// <see cref="_language"/> (a pure display preference) or any mk_ key (stays in
    /// <see cref="CredentialStore"/>, DPAPI-encrypted — never written here).
    ///
    /// This ctor eagerly loads a persisted file (if one exists) straight into <see cref="_serverUrl"/>/
    /// <see cref="_machineCode"/>/<see cref="_verifyTls"/> — same "read it back on construction" idiom
    /// <see cref="MachineConfigStore"/>/<see cref="Historian.OeeSettingsStore"/> already use — so
    /// <see cref="GetSettings"/> reports the right values for ANY caller immediately after construction,
    /// with no extra glue required (this is what makes "new <see cref="FleetHost"/> pointed at the same
    /// settings directory" a faithful in-process stand-in for a real process restart in tests). It
    /// deliberately does NOT also call <see cref="TransportCoordinator.RebuildLive"/> here — that requires
    /// a credential lookup and touches <see cref="_transportCoordinator"/>/<c>_configSyncCoordinator</c>,
    /// which is exactly what <c>Program.cs</c>'s startup wiring does right after this ctor returns, via a
    /// real <see cref="UpdateSettings"/> call (the one that also decides persisted-file-vs-env-var
    /// precedence) — that single call is what actually re-points the Live transport to match, before
    /// <c>app.Run()</c> ever serves a request.</summary>
    private readonly FleetSettingsStore? _settingsStore;

    /// <summary>SM-1 (.superpowers/sdd/2026-07-29-dotA-single-machine-sellable-blueprint/task-1-brief.md) —
    /// optional (defaults null, same "every pre-existing test/call site that constructs <see cref="FleetHost"/>
    /// directly without one keeps compiling/behaving byte-for-byte unchanged" contract as every other
    /// optional dependency above) reuse of the ONE existing seam that already decides demo-vs-product
    /// (<c>Program.cs</c>'s <c>TransportCoordinator</c>/auto-login wiring, <c>ModeEndpoints</c>) — deliberately
    /// NOT a second "am I in demo mode" flag invented for the fleet roster specifically. Consulted exactly
    /// once, by <see cref="LoadFleet"/>, from the constructor:
    ///  - <see langword="null"/> (every pre-existing test) or <see cref="St4i.EdgeCore.Config.DemoModeGate.Enabled"/>
    ///    keeps the ORIGINAL fleet.json/<see cref="BuildDefaultFleet"/> resolution byte-identical — the
    ///    exhibition/sales fleet must never regress.
    ///  - non-null and disabled means a real product deployment: the roster starts EMPTY. fleet.json and
    ///    <see cref="BuildDefaultFleet"/> become demo-only artifacts — see <see cref="ResolveFleet"/>.
    /// Production (Program.cs) never has to pass this explicitly: <see cref="St4i.EdgeCore.Config.DemoModeGate"/>
    /// is already registered as a DI singleton, so the container resolves it into this optional parameter
    /// automatically, the same way <see cref="MachineConfigStore"/> already does.
    ///
    /// SM-1b fix round 1 (task-1b-brief.md, review) — this class moved from
    /// <c>St4i.EngineApi.Config.DemoModeGate</c> to <see cref="St4i.EdgeCore.Config.DemoModeGate"/> so
    /// <c>St4i.EdgeService</c>'s own fleet-source gate could share it too, with no new project-reference
    /// edge (both projects already <c>ProjectReference</c> <c>St4i.EdgeCore</c>) — see that class's own
    /// doc comment for the full history. Every reference in this file updated; no behavior change.</summary>
    private readonly St4i.EdgeCore.Config.DemoModeGate? _demoModeGate;

    /// <summary>SM-1 — the fleet is "running" (an operator has called <see cref="Start"/> and neither
    /// <see cref="Stop"/>/<see cref="Estop"/> nor a total runtime fault-out has happened since). This
    /// REPLACES the old computed definition (<c>_slots.Count > 0</c>) — that definition could never
    /// distinguish "an empty roster the operator deliberately started, with nothing to pipeline yet" (a
    /// coherent running state this task makes real, see the deliverable) from "every slot has faulted out
    /// at runtime" (a degraded state that WAS, and still is, reported as not-running). Set by
    /// <see cref="StartLocked"/> (unconditionally, whenever it doesn't early-return), cleared by
    /// <see cref="StopLocked"/>, and ALSO cleared by <see cref="StartSlot"/>'s own fault-catch the moment
    /// its removal brings <see cref="_slots"/> back down to zero — that one line is what keeps every
    /// pre-existing "the sole/last slot faulting flips IsRunning false" test passing unchanged; a roster
    /// that never had any slot to begin with (the empty-roster case) never reaches that catch at all, so
    /// it stays running until a genuine <see cref="Stop"/>/<see cref="Estop"/>.</summary>
    private bool _running;

    /// <summary>Task 3 — "what product is machine X running right now", keyed case-insensitively by
    /// <see cref="MachineDescriptor.Code"/>. A machine absent from this map (the common case — nothing
    /// sets it yet outside tests) resolves machine-scoped config only, exactly like a machine whose
    /// <c>configKind</c> has no product dimension at all. Read by <see cref="CurrentProductFor"/>, which
    /// every config-aware simulator's <see cref="Func{T,TResult}"/> provider (built in
    /// <see cref="StartLocked"/>) calls fresh on every cycle — so <see cref="SetCurrentProduct"/> takes
    /// effect on an already-running fleet with no restart, same as a plain adjustment does.</summary>
    private readonly ConcurrentDictionary<string, string?> _currentProduct = new(StringComparer.OrdinalIgnoreCase);

    /// <summary>G2-5 — one independent pipeline in the fleet: its EdgePipeline, the CTS that stops it, and its
    /// background run-task. Each slot faults in ISOLATION (a fault removes only THIS slot from <see cref="_slots"/>,
    /// never the others) so one flaky driver can't tear down the whole fleet. Mutated only under <see cref="_gate"/>
    /// (except <see cref="RunTask"/>, assigned once right after Task.Run, before the slot is observed off-thread).</summary>
    private sealed class PipelineSlot
    {
        public required string Label { get; init; }
        public required EdgePipeline Pipeline { get; init; }
        public required CancellationTokenSource Cts { get; init; }

        /// <summary>G2-6 review fix — the slot's OWN driver, so whichever code path actually removes this
        /// slot from <see cref="_slots"/> (<see cref="WaitAndDisposeOldPipeline"/> for a superseded slot, or
        /// this slot's own fault-catch in <see cref="StartSlot"/> for a self-fault) can dispose it.
        /// <see cref="ModbusTcpDriver"/> (G2-6) is the first driver to own a live resource (a TCP
        /// connection) that cancelling <see cref="Cts"/> alone does not release — before this field existed,
        /// FleetHost never called <c>DisposeAsync</c> on any slot's driver at all, so every Stop/restart/
        /// fault-removal leaked one connection until GC finalized it.</summary>
        public required IDeviceDriver Driver { get; init; }

        public Task? RunTask { get; set; }
    }

    private readonly List<PipelineSlot> _slots = new();

    private DemoTransport? _outageTransport;
    private CancellationTokenSource? _burstRevertCts;
    private double _burstBaseline = 1.0;

    private volatile ScenarioConfig _scenario = ScenarioConfig.Normal;
    private volatile string _activePresetName = "normal";

    private long _totalCycles;
    private long _totalPass;
    private long _totalJudged;

    /// <summary>SM-2 — the SAME three counters as <see cref="_totalCycles"/>/<see cref="_totalPass"/>/
    /// <see cref="_totalJudged"/> above, ADDITIVELY tracked alongside them (never instead of — those three
    /// stay exactly as they were, still read by <see cref="GetKpiCounters"/>/<see cref="Snapshot"/>'s own
    /// pure-demo branch), counting ONLY readings from a non-fabricated (real) machine. See
    /// <see cref="OnPipelineCommitted"/> for how each reading is classified (cheaply, on this same hot
    /// path, from the already-resolved <see cref="MachineState.Descriptor"/> — never a second lookup) and
    /// <see cref="Snapshot"/> for which of the two counter sets a caller actually sees.</summary>
    private long _totalCyclesReal;
    private long _totalPassReal;
    private long _totalJudgedReal;

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
        St4i.EdgeCore.Config.ProductConfigStore? productConfigStore = null,
        HistorianWriter? historianWriter = null,
        FleetSettingsStore? settingsStore = null,
        IUnsPublisher? unsPublisher = null,
        IAssetRegistry? assetRegistry = null,
        ConnectorRegistry? connectorRegistry = null,
        St4i.EdgeCore.Config.DemoModeGate? demoModeGate = null)
    {
        _transport = transport ?? throw new ArgumentNullException(nameof(transport));
        _transportCoordinator = transportCoordinator ?? throw new ArgumentNullException(nameof(transportCoordinator));
        _eventBus = eventBus ?? throw new ArgumentNullException(nameof(eventBus));
        _logger = logger;
        _configSyncCoordinator = configSyncCoordinator;
        _configStore = configStore;
        _productConfigStore = productConfigStore;
        _historianWriter = historianWriter;
        _settingsStore = settingsStore;
        _unsPublisher = unsPublisher;
        _assetRegistry = assetRegistry;
        _connectorRegistry = connectorRegistry;
        _demoModeGate = demoModeGate;

        // FF-1 — eager load, no lock needed: runs once, before this instance is published to any other
        // thread (same reasoning SeedAoiProductLinks below documents for itself). See _settingsStore's own
        // doc comment for why this only sets fields and leaves the actual transport rebuild to Program.cs.
        if (_settingsStore is not null)
        {
            var persisted = _settingsStore.Load();
            if (persisted is not null)
            {
                _serverUrl = persisted.ServerUrl;
                _machineCode = persisted.MachineCode;
                _verifyTls = persisted.VerifyTls;
            }
        }

        _fleet = LoadFleet().ToList();
        _states = new ConcurrentDictionary<string, MachineState>(StringComparer.OrdinalIgnoreCase);
        foreach (var descriptor in _fleet)
        {
            _states[descriptor.Code] = new MachineState(descriptor);
            // P2-1 — fire-and-forget: UpsertAsync never throws (see IAssetRegistry's doc comment), and a
            // null _assetRegistry (every pre-existing test/no-DI-registration case) makes this a no-op,
            // byte-identical to before this task.
            _ = _assetRegistry?.UpsertAsync(descriptor);
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

    /// <summary>G2-5 — test-only seam (default null) — lets <c>St4i.EngineApi.Tests</c> inject ADDITIONAL
    /// pipeline groups beyond the simulated one, so the multi-slot fault-isolation machinery can be
    /// exercised deterministically before a real second driver (Modbus, G2-6) exists. Production never
    /// sets this (<c>internal</c>, requires <c>InternalsVisibleTo</c>). Each tuple: a slot label, its
    /// driver, and the fallback MappingProfile for its readings.</summary>
    internal Func<IReadOnlyList<(string Label, IDeviceDriver Driver, MappingProfile Profile)>>? AdditionalPipelinesForTests { get; set; }

    /// <summary>G2-5 / SM-1 — see <see cref="_running"/>'s own doc comment for the full definition. With a
    /// non-empty roster (every roster before this task, and demo mode always) this is byte-identical to the
    /// original stored-flag behavior: the slot's fault-catch removes it (see <see cref="StartLocked"/>), so
    /// the last slot faulting flips this false exactly as before.</summary>
    public bool IsRunning { get { lock (_gate) return _running; } }

    /// <summary>Branch-review C-2 — the E-STOP latch, now owned by the engine (not any one browser
    /// tab's React state) so it's shared across every panel that polls <see cref="Snapshot"/> and
    /// survives a page reload. Only <see cref="Estop"/> sets it; only <see cref="ResetEstop"/> clears
    /// it — never touched implicitly by <see cref="Start"/>/<see cref="Stop"/>, so an operator/API
    /// stop is never mistaken for an emergency one.</summary>
    public bool EstopEngaged { get { lock (_gate) return _estopEngaged; } }

    private bool _estopEngaged;

    /// <summary>XC-R40 — the single read-only accessor for the supervisory safety state (see
    /// <see cref="St4i.EngineApi.Safety.SafetySnapshot"/>). Pure read: takes <see cref="_gate"/> only to
    /// read a consistent estop+running pair, never mutates. No corresponding setter exists — the latch
    /// changes ONLY through <see cref="Estop"/>/<see cref="ResetEstop"/>.</summary>
    public St4i.EngineApi.Safety.SafetySnapshot GetSafetyStatus()
    {
        lock (_gate) { return new St4i.EngineApi.Safety.SafetySnapshot(_estopEngaged, IsRunning); }
    }

    /// <summary>GĐ3 sub-4 LC-2 — per-slot driver health, read-only: the FIRST production reader of
    /// <see cref="IDeviceDriver.Health"/> (added for <see cref="Alarms.AlarmEvaluator"/>'s DriverHealth
    /// alarm source). Pure read under <see cref="_gate"/> — same lock every other read of <see cref="_slots"/>
    /// in this class already takes, mirroring <see cref="GetSafetyStatus"/>'s own "pure read, never mutates"
    /// contract. Returns one entry per CURRENTLY live slot (an empty list while the fleet is stopped) —
    /// nothing here reaches into a slot that has been removed; <see cref="Alarms.AlarmEvaluator"/> is what
    /// notices a slot's disappearance (by diffing this list against its own last pass) and clears that
    /// slot's alarms on its behalf.</summary>
    public IReadOnlyList<DriverHealthSnapshot> GetDriverHealth()
    {
        lock (_gate)
        {
            return _slots.Select(s => new DriverHealthSnapshot(s.Label, s.Driver.Kind, s.Driver.Health)).ToList();
        }
    }

    /// <summary>GP-5 (task-5-brief.md item 3, carried from the GP-4 review) — every currently-registered
    /// connector id that is configured but NOT currently running, because its most recent start attempt
    /// failed (a bad/malformed <c>connectors.json</c>/env-var configuration, or a third-party factory that
    /// rejected/threw — see <see cref="StartLocked"/>'s connector loop). Before this method existed, that
    /// failure produced exactly one startup <c>LogWarning</c> and nothing else: no <see cref="GetDriverHealth"/>
    /// entry (no slot was ever created for it), no alarm, no health signal — on an edge box, a
    /// <c>connectors.json</c> typo presented to an operator as "my connector just isn't there," discoverable
    /// only by reading the log file.
    ///
    /// <para>Deliberately informational, not a fault: this is surfaced through its own projection
    /// (<c>GET /v1/connectors</c>), never through <see cref="LastError"/>/<c>GET /v1/health</c> — the GP-4
    /// review specifically judged that an optional peripheral's bad config must not flip the whole host
    /// unhealthy, and this method changes nothing about that. Empty (never <see langword="null"/>) whenever
    /// no connector is currently failing to start — including the ordinary case where
    /// <see cref="_connectorRegistry"/> is null/empty, or the fleet has never been started at all (no
    /// <see cref="StartLocked"/> attempt has run yet, so nothing has had a chance to fail).</para></summary>
    public IReadOnlyList<ConnectorStatusDto> GetConfiguredConnectorIssues() =>
        _connectorStartIssues.Select(kv => new ConnectorStatusDto(kv.Key, kv.Value)).ToList();

    /// <summary>SM-2 fix round 1 (review CRITICAL) — the SAME "not blend, not suppress" mode-aware rule
    /// <see cref="Snapshot"/> applies to <see cref="FleetKpisDto"/>, factored out so both call sites can
    /// never drift apart: a real (non-Simulated) machine ANYWHERE in the current roster means "there is
    /// something to blend with," so a caller must use the real-only counters; no real machine (a pure demo
    /// roster, or an empty product roster) means there is nothing to blend WITH, so the original blended
    /// counters are correct AND byte-identical to before this task. Reads <see cref="Fleet"/> once (a
    /// single <see cref="_gate"/> acquisition) rather than each caller re-deriving its own roster scan.</summary>
    private (bool HasFabricatedMachine, bool HasRealMachine) ClassifyRoster()
    {
        var fleet = Fleet;
        return (
            fleet.Any(d => DriverKinds.IsFabricated(d.DriverKind)),
            fleet.Any(d => !DriverKinds.IsFabricated(d.DriverKind)));
    }

    /// <summary>GĐ3 sub-4 LC-2 — the fleet-wide KPI counters <see cref="Alarms.AlarmEvaluator"/>'s windowed
    /// NG-rate source polls (diffing successive calls to compute a DELTA rather than a fleet-lifetime
    /// rate), which feeds a genuinely customer-facing alarm ("Fleet NG-rate X% ... exceeds the Y% limit").
    ///
    /// SM-2 fix round 1 (review CRITICAL) — this used to return the raw BLENDED
    /// <see cref="_totalPass"/>/<see cref="_totalJudged"/> unconditionally, the one customer-facing surface
    /// this task's own diff had left un-audited: in "demo fleet plus one real machine" — the brief's own
    /// opening scenario — a healthy demo stream could mask a genuine quality problem on the real machine,
    /// or a stable demo stream could trip/clear an alarm that has nothing to do with it. Now mode-aware via
    /// the SAME <see cref="ClassifyRoster"/> rule <see cref="Snapshot"/> uses: a real machine anywhere in
    /// the current roster returns the real-only counters instead — never blended, and computed under the
    /// SAME <see cref="_kpiGate"/> lock either branch already used.</summary>
    public (long TotalPass, long TotalJudged) GetKpiCounters()
    {
        var (_, hasRealMachine) = ClassifyRoster();

        lock (_kpiGate)
        {
            return hasRealMachine ? (_totalPassReal, _totalJudgedReal) : (_totalPass, _totalJudged);
        }
    }

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
    private readonly record struct PipelineHandle(IReadOnlyList<PipelineSlot>? OldSlots);

    /// <summary>Fix round 1 (WS-A-T7 review, Important) — the historian's "Start" run event belongs HERE,
    /// not inside <see cref="StartLocked"/>: that helper is also the shared restart chokepoint
    /// <see cref="RegisterMachine"/>/<see cref="ApplyScenario"/> call directly (bypassing this public
    /// method entirely) to rebuild the pipeline after a live roster/scenario change, which is never a
    /// genuine operator "start" and must stay invisible to the historian's run-event timeline (OEE
    /// Availability = Start→next Stop/Estop; a spurious pair per internal restart would corrupt it). The
    /// <c>wasRunning</c>/<c>IsRunning</c> comparison (read under <see cref="_gate"/>, same as every other
    /// <c>IsRunning</c> read in this class) guards against emitting again when <see cref="Start"/> is
    /// called on an already-running (or still-<see cref="EstopEngaged"/>) fleet, where
    /// <see cref="StartLocked"/> itself no-ops.</summary>
    public void Start()
    {
        bool started;
        List<IDeviceDriver> orphanedConnectorDrivers;
        lock (_gate)
        {
            var wasRunning = IsRunning;
            orphanedConnectorDrivers = StartLocked();
            started = !wasRunning && IsRunning;

            // Review fix (Important) — the NBIRTH call is made HERE, still inside _gate, deliberately: two
            // genuinely concurrent operator calls (e.g. a Start racing a Stop on two threads) could otherwise
            // order the gate-protected transitions one way while off-gate publish calls raced the other way,
            // letting a Stop's NDEATH run before its logically-preceding Start's NBIRTH — hitting the
            // born-guard, no-op'ing, and leaving that birth's NDEATH never sent. Holding _gate across this
            // call is cheap/deadlock-free: PublishNodeBirth only takes the publisher's own _lifecycleGate
            // briefly and does a non-blocking channel TryWrite (no I/O, never calls back into FleetHost), so
            // lock order is always _gate -> _lifecycleGate, never reversed. The historian run-event below
            // stays OUTSIDE _gate — that's a pre-existing async fire-and-forget pattern, unchanged/out of
            // scope here.
            if (started)
            {
                _unsPublisher?.PublishNodeBirth();
            }
        }

        // Review fix round 2 — off-lock, same as WaitAndDisposeOldPipeline below; see
        // DisposeOrphanedConnectorDrivers' own doc comment for why this must never run inside _gate.
        DisposeOrphanedConnectorDrivers(orphanedConnectorDrivers);

        if (started)
        {
            _ = _historianWriter?.RecordRunEventFireAndForget("Start");
        }
    }

    /// <summary>Fix round 1 (WS-A-T7 review, Important) — mirror of <see cref="Start"/>'s reasoning: the
    /// historian's "Stop" run event belongs at THIS public operator boundary, not inside
    /// <see cref="StopLocked"/> — that helper is also the shared teardown step
    /// <see cref="RegisterMachine"/>/<see cref="ApplyScenario"/>'s internal restarts AND
    /// <see cref="Estop"/> call directly (bypassing this method), none of which are a genuine operator
    /// stop. Only a real running→not-running transition through THIS method emits "Stop" — an
    /// already-stopped fleet (where <see cref="StopLocked"/> no-ops) emits nothing.</summary>
    public void Stop()
    {
        // Wait/dispose must happen OUTSIDE _gate — see WaitAndDisposeOldPipeline's remarks. Stop()
        // itself stays synchronous (bounded by RestartTeardownTimeout) so a caller observing it return
        // can trust the old pipeline is actually torn down, not just "cancel requested".
        PipelineHandle handle;
        bool stopped;
        lock (_gate)
        {
            var wasRunning = IsRunning;
            handle = StopLocked();
            stopped = wasRunning && !IsRunning;

            // Review fix (Important) — same reasoning as Start()'s own NBIRTH call: kept inside _gate so the
            // NDEATH's enqueue order is serialized with the transition decision itself, not racing an
            // off-gate concurrent Start's NBIRTH. The historian run-event below stays OUTSIDE _gate
            // (pre-existing async fire-and-forget pattern, unchanged here).
            if (stopped)
            {
                _unsPublisher?.PublishNodeDeath();
            }
        }

        if (stopped)
        {
            _ = _historianWriter?.RecordRunEventFireAndForget("Stop");
        }

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

            // Review fix (Important) — same reasoning as Start()/Stop()'s own moved calls: kept inside
            // _gate so this NDEATH is serialized with the transition, never racing an off-gate concurrent
            // Start's NBIRTH. The historian run-event below stays OUTSIDE _gate (pre-existing async
            // fire-and-forget pattern, unchanged here).
            _unsPublisher?.PublishNodeDeath();
        }

        _ = _historianWriter?.RecordRunEventFireAndForget("Estop");
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

        _ = _historianWriter?.RecordRunEventFireAndForget("EstopReset");
    }

    /// <summary>Review fix round 1 — the ONLY two connector ids whose pipeline slot label must reproduce a
    /// pre-existing (pre-GP-4) literal spelling that differs from the id itself: <c>"modbus"</c>/<c>"opcua"</c>
    /// (lowercase), not <see cref="DriverKinds.Modbus"/>/<see cref="DriverKinds.OpcUa"/> (the canonical,
    /// PascalCase spelling). Every OTHER connector id — built-in or third-party — uses the id ITSELF,
    /// verbatim, as its slot label; see <see cref="ResolveConnectorSlotLabel"/>'s own remarks for why that
    /// (not a general lowercasing rule) is what actually prevents a label collision.</summary>
    private static readonly IReadOnlyDictionary<string, string> LegacyConnectorSlotLabels =
        new Dictionary<string, string>(StringComparer.Ordinal)
        {
            [DriverKinds.Modbus] = "modbus",
            [DriverKinds.OpcUa] = "opcua",
        };

    /// <summary>Review fix round 1 — the pipeline slot label for a registry-driven connector. Originally
    /// <c>connectorId.ToLowerInvariant()</c>, which reproduced <c>"modbus"</c>/<c>"opcua"</c> correctly but
    /// was NOT collision-free: <see cref="DriverKinds"/>' own casing rule deliberately keeps a THIRD-PARTY
    /// id case-SENSITIVE (so <c>"Vendor.Acme.Weld"</c> and <c>"vendor.acme.weld"</c> are two distinct,
    /// simultaneously-registrable connectors), and lowercasing both would have produced the SAME slot label
    /// for two genuinely different connectors — <see cref="Alarms.AlarmEvaluator"/> keys its degraded/down
    /// alarms on exactly this label (<c>DegradedKey</c>/<c>DownKey</c>, <c>TargetId: slot.SlotLabel</c>), so
    /// one connector's alarms would silently clobber the other's. Same hazard for a connector registered
    /// with <c>Kind="Simulated"</c>: lowercased, that collided with the always-present sim group's own
    /// hardcoded <c>"simulated"</c> label below.
    ///
    /// Fixed by using the (already-normalized) connector id VERBATIM as the label for everything except the
    /// two built-ins that need a literal pre-existing spelling (<see cref="LegacyConnectorSlotLabels"/>) —
    /// this is what is actually collision-free: every <see cref="ConnectorRegistry.RegisteredIds"/> entry is
    /// already guaranteed unique (it is a dictionary key), so two DIFFERENT registered ids can never produce
    /// the SAME label under this rule, and <c>"Simulated"</c> (PascalCase, the canonical built-in spelling)
    /// no longer collides with the sim group's own lowercase <c>"simulated"</c> literal.</summary>
    private static string ResolveConnectorSlotLabel(string connectorId) =>
        LegacyConnectorSlotLabels.TryGetValue(connectorId, out var legacyLabel) ? legacyLabel : connectorId;

    /// <summary>Review fix round 2 — <see cref="StartLocked"/> USED to dispose an orphaned connector
    /// driver (see the connector loop below) inline, synchronously, while <see cref="_gate"/> was held by
    /// every one of its callers. That is a hazard this class's own review has already named twice: a
    /// slow/hung third-party <see cref="IDeviceDriver.DisposeAsync"/> would delay <see cref="Estop"/> — the
    /// exact "blocks E-STOP" class of bug <see cref="IConnectorFactory.TryCreate"/>'s own doc comment warns
    /// against for <c>TryCreate</c> itself. <see cref="StartLocked"/> now only COLLECTS orphaned drivers
    /// into the returned list — every caller disposes them via <see cref="DisposeOrphanedConnectorDrivers"/>
    /// AFTER releasing <see cref="_gate"/>, the same "wait/dispose must happen OUTSIDE _gate" discipline
    /// <see cref="WaitAndDisposeOldPipeline"/> already documents for the restart-teardown path. An empty
    /// list (never <see langword="null"/>) is returned on every early-return/no-op path below, so a caller
    /// can unconditionally hand the result to <see cref="DisposeOrphanedConnectorDrivers"/> with no null
    /// check.</summary>
    private List<IDeviceDriver> StartLocked()
    {
        // Defense in depth: the client already disables START while latched, but the engine itself
        // must refuse too — a stale client, a second panel, or a direct API call must never be able to
        // restart a machine that's still emergency-stopped.
        if (IsRunning || _estopEngaged) return new List<IDeviceDriver>();
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
        // G2-6/P2-3 — a DriverKinds.Modbus machine is driven by the real Modbus pipeline slot (below), NOT
        // simulated. Excluding it here is what prevents it being double-driven (a simulator AND the Modbus
        // slot) once it's a roster member. Non-Modbus rosters are unaffected (the Where is a no-op), so sim
        // seeds/indices are byte-identical to before.
        // GĐ3 sub-3 OU-2 — same reasoning, now ALSO excluding DriverKinds.OpcUa: once Program.cs seeds a
        // roster descriptor for a configured OPC-UA machine (below), it must be driven ONLY by the real
        // OPC-UA pipeline slot, never simulated too. A roster with no Modbus/OPC-UA machines is unaffected
        // (the Where stays a no-op), so sim seeds/indices are byte-identical to before this task.
        //
        // GP-5 (task-5-brief.md item 1) — the GP-4 review's own note here ("generalizing [this] would
        // require a roster/MachineDescriptor story for third-party connectors that does not exist yet")
        // is exactly what GP-5's connectors.json supplies, so the exclusion is now a UNION, never a
        // substitution: BOTH built-in literals stay (Modbus/OPC-UA are excluded unconditionally, whether or
        // not a connector for them is currently registered — FleetHostModbusRosterTests.
        // ModbusRosterMember_NoModbusConnector_ExcludedFromSimulation_StaysIdle_SimFleetUnaffected pins this;
        // replacing the two literals with "any registered connector id" would silently re-simulate an
        // unregistered Modbus/OPC-UA roster member, which is the exact regression that test guards against)
        // PLUS a third, registry-driven clause for every other (third-party) DriverKind: once an operator
        // registers a real IConnectorFactory for some id, e.g. "vendor.acme.widget" (GP-5's whole point —
        // connectors.json makes this reachable, where before only Program.cs code could), a roster entry for
        // that same id must ALSO stop being simulated — otherwise the simulator's CycleCounter and the real
        // connector's CycleCounter both write the SAME MachineState (Cycles derives from CycleCounter),
        // corrupting per-machine cycles and therefore fleet KPI/OEE/FPY. Silently. See
        // FleetHostThirdPartyRosterTests for both directions of this third clause.
        //
        // DriverKinds.Normalize(d.DriverKind) here (not a raw d.DriverKind lookup) is required because
        // ConnectorRegistry.RegisteredIds is always normalized (Register/TryCreateDriver both fold through
        // DriverKinds.Normalize), while a MachineDescriptor's own DriverKind is normalized at FleetConfig.Load
        // (fleet.json entries) but NOT at RegisterMachine (see that method's own fix, this same task) prior
        // to this fix — normalizing on both sides here is defense in depth even after that RegisterMachine
        // fix, since _fleet can also be seeded in-process (BuildDefaultFleet, test doubles) without ever
        // passing through either normalization point.
        //
        // Null-guarded: _connectorRegistry is an optional ctor parameter (every pre-existing test/call site
        // that constructs FleetHost without one, e.g. FleetHostHealthAndRegistrationTests, must keep
        // compiling/behaving byte-for-byte unchanged) — a null registry simply contributes nothing to the
        // union, same as an empty one would.
        //
        // TDD note (caught by running FleetHostConnectorRegistryTests against the first draft of this
        // fix): `d.DriverKind == DriverKinds.Simulated` is carved out of the third clause ON PURPOSE, not an
        // oversight. Every roster machine built by BuildDefaultFleet/the shipped fleet.json carries
        // DriverKind=DriverKinds.Simulated — that is what "simulate this machine" MEANS, a completely
        // different concept from "a real connector drives this machine" (Modbus/OPC-UA/third-party).
        // ConnectorRegisteredWithKindSimulated_GetsDistinctSlotLabel_FromTheBuiltInSimSlot legitimately
        // registers a connector under Kind=DriverKinds.Simulated (item 4's own decision: the built-in sim
        // group is NOT itself registry-driven, so a THIRD PARTY choosing that same id registers a genuinely
        // separate, additional slot, never a substitute for it). Without this carve-out, that one
        // registration would make `registeredConnectorIds.Contains("Simulated")` true, and the third clause
        // would then exclude EVERY roster machine (all of them DriverKind=Simulated) from simFleet —
        // emptying it entirely and crashing SimulatedDriver's ctor ("at least one simulator is required").
        // The first draft of this fix did exactly that; this carve-out is what closes it.
        var registeredConnectorIds = _connectorRegistry?.RegisteredIds;
        var simFleet = effectiveFleet.Where(d =>
            d.DriverKind != DriverKinds.Modbus
            && d.DriverKind != DriverKinds.OpcUa
            && (d.DriverKind == DriverKinds.Simulated
                || registeredConnectorIds is null
                || !registeredConnectorIds.Contains(DriverKinds.Normalize(d.DriverKind))))
            .ToList();
        var sims = simFleet.Select((d, i) => SimulatorFactory.Create(d, seed: 1000 + i, _configStore, CurrentProductFor, multiplier, _productConfigStore)).ToList();

        // SM-1 (task-1-brief.md) — a roster with no simulated machines (an empty product roster, or one
        // containing ONLY real Modbus/OPC-UA/registered-connector entries — every one of which `simFleet`
        // above already excludes) must never reach SimulatedDriver's own constructor guard ("At least one
        // simulator is required"). That guard is correct and stays exactly as strict as it is — it caught a
        // real bug once — so the fix belongs at THIS call site, not a weakened constructor: no simulators
        // simply means no "simulated" pipeline group is built this Start, never a crash.
        IDeviceDriver? driver = null;
        if (sims.Count > 0)
        {
            driver = new ScenarioAwareDriver(new SimulatedDriver(sims), () => _scenario);

            var decorator = DriverDecoratorForTests;
            if (decorator is not null)
            {
                driver = decorator(driver);
            }
        }

        // G2-1 — per-machine mapping/*.json profiles (docs/plans/2026-07-27-giaidoan2-synapse-connect-
        // blueprint.md task 1): built fresh off `effectiveFleet` on every StartLocked call (including a
        // RegisterMachine/ApplyScenario-triggered restart), so a newly-registered machine's own
        // MappingProfile name is always resolved against the CURRENT roster, never a stale one. The
        // shared `profile` below is now only the fallback for a machine code this resolver doesn't
        // recognize (should not happen in practice — every reading's driver was built from this SAME
        // effectiveFleet, see `sims` above) — never a per-machine override target itself anymore.
        var mappingDir = Path.Combine(AppContext.BaseDirectory, "mapping");
        var mappingResolver = MappingProfileResolver.Build(
            effectiveFleet,
            mappingDir,
            logWarning: msg => _logger?.LogWarning("{MappingProfileMsg}", msg),
            logError: (ex, msg) => _logger?.LogWarning(ex, "{MappingProfileMsg}", msg));

        var profile = new MappingProfile { Name = "fleet-mixed", DeviceClass = "Mixed" };

        // G2-5 — the pipeline groups to run this cycle. Today: exactly the one simulated group
        // (byte-identical to the old single pipeline). The test seam appends extra groups; a future
        // task (Modbus, G2-6) will add real per-driver groups here. A group = (label, driver, fallback
        // profile, per-reading resolver).
        // GP-5 (task-5-brief.md item 4) — deliberately NOT built through ConnectorRegistry, unlike every
        // registry-driven connector below. Two concrete, evidence-based reasons, not a convenience shortcut:
        //
        // (1) COLLISION: the registry stores at most ONE factory per normalized id (Register's own doc
        // comment: "re-registering the same id replaces the previous entry"). FleetHostConnectorRegistryTests.
        // ConnectorRegisteredWithKindSimulated_GetsDistinctSlotLabel_FromTheBuiltInSimSlot already pins that a
        // THIRD-PARTY connector registered with Kind=DriverKinds.Simulated must coexist as a slot SEPARATE
        // from this always-present sim group (2 distinct "Simulated"-kind slots, 2 distinct labels). Moving
        // this group's own driver into the SAME registry, under the SAME normalized "Simulated" key, would
        // make that coexistence impossible by construction — whichever of the two Register calls ran last
        // would silently replace the other in the dictionary. That is exactly the id-collision hazard GP-4's
        // review fix round 1 already fought to eliminate; reintroducing it here would be a regression, not a
        // simplification.
        //
        // (2) SHAPE MISMATCH: IConnectorFactory.TryCreate(string config) is one opaque, forwarded-verbatim
        // config string producing ONE driver — a shape built for a THIRD PARTY's own configuration, which
        // this codebase never inspects. This group's driver is the opposite: ONE SimulatedDriver built from
        // MANY simulators (`sims` above), one per roster machine currently in `_fleet` (minus the exclusions
        // just above), re-derived from mutable FleetHost-owned state on every single restart — `_fleet`
        // itself (mutated by RegisterMachine), `_configStore`/CurrentProductFor/`_productConfigStore` (live
        // config, re-resolved per cycle), and `multiplier` (the active scenario). There is no "opaque config
        // string" that stands in for "the entire current roster plus three FleetHost service references" —
        // forcing this through IConnectorFactory would mean either inventing a FleetHost-specific side
        // channel a factory reaches through (defeating "config is opaque, host doesn't understand it", the
        // exact property GP-4 built this contract around) or serializing the whole roster to a string every
        // restart for a factory that could only ever have ONE real implementation (FleetHost's own) — pure
        // ceremony, no third party ever plugs in here.
        //
        // Net: the built-in sim group stays exactly as special-cased as it already was before this task —
        // hardcoded label "simulated" (pinned by this same collision test above and by
        // ConnectorRegisteredWithKindSimulated_GetsDistinctSlotLabel_FromTheBuiltInSimSlot), built directly
        // here, never asked of `_connectorRegistry`. This is the ONE remaining special case in StartLocked;
        // everything else (Modbus, OPC-UA, any third-party id) goes through the registry uniformly.
        var groups = new List<(string Label, IDeviceDriver Driver, MappingProfile Profile, Func<string, MappingProfile?>? Resolver)>();
        if (driver is not null)
        {
            groups.Add(("simulated", driver, profile, mappingResolver.Resolve));
        }

        var extra = AdditionalPipelinesForTests?.Invoke();
        if (extra is not null)
        {
            foreach (var g in extra) groups.Add((g.Label, g.Driver, g.Profile, null));
        }

        // GP-4 — every registered connector gets its own slot, built fresh (never reused across restarts,
        // same "a driver owns a live resource cancelling a CTS alone does not release" reasoning
        // ConnectorRegistry/IConnectorFactory's own doc comments carry) whenever one is actually wired up
        // (Program.cs only registers Modbus/OPC-UA when their respective ST4I_*_ENABLED env var is set AND
        // their config file loaded — otherwise the registry is empty/null and the fleet is byte-identical
        // to before this task). This replaces what used to be two hardcoded, copy-pasted blocks here (one
        // per driver kind) — onboarding a new connector no longer touches this method at all.
        //
        // A connector that fails to produce a driver — a bad/malformed configuration (TryCreateDriver
        // returns false), or a third-party factory that throws despite IConnectorFactory.TryCreate's
        // contract not to — is logged and skipped, exactly like today's "malformed map file disables that
        // driver for this run without crashing the host" behavior for Modbus/OPC-UA specifically. This is
        // deliberately NOT surfaced through LastError (that property is reserved for a slot that started
        // and later faulted at RUNTIME — see StartSlot's catch below; touching it here would flip
        // GET /v1/health unhealthy merely because an optional peripheral's config is bad, which is not
        // today's behavior and is not this task's to change) — only a log warning, so the failure is
        // visible without being mistaken for the whole fleet's health.
        //
        // Review fix round 2 — `orphanedConnectorDrivers` COLLECTS (never disposes inline) any driver a
        // rejected/faulted connector still handed back; disposal happens in the caller, off `_gate`, via
        // `DisposeOrphanedConnectorDrivers` (see that method's own doc comment for why round 1's inline,
        // in-lock dispose was itself the hazard this round closes).
        var orphanedConnectorDrivers = new List<IDeviceDriver>();
        if (_connectorRegistry is not null)
        {
            foreach (var connectorId in _connectorRegistry.RegisteredIds)
            {
                IDeviceDriver? connectorDriver = null;
                string? connectorError = null;
                var built = false;
                try
                {
                    built = _connectorRegistry.TryCreateDriver(connectorId, out connectorDriver, out connectorError);
                }
                catch (Exception ex)
                {
                    // Defense in depth: IConnectorFactory.TryCreate's contract says "never throw for bad
                    // config," but a third-party factory is not this codebase's own code to trust blindly.
                    // ConnectorRegistry.TryCreateDriver ALSO guards against this now (review fix round 1) —
                    // this catch is deliberately doubled, not redundant to trim, because this is the ONE
                    // place third-party code runs while _gate is held (see IConnectorFactory.TryCreate's
                    // own "MUST return promptly" remarks) and Estop() takes the same lock. Catching here —
                    // BEFORE any slot exists for this connector — is what keeps a rogue factory from taking
                    // down the simulated fleet and every sibling connector along with it, not just disabling
                    // itself; a fault AFTER a slot exists is already isolated by StartSlot's own per-slot
                    // catch below. `built` stays false; `connectorDriver` may or may not have been assigned
                    // before the throw (an `out` parameter write is visible to the caller even if the
                    // callee then throws) — handled uniformly below, same as a contract-violating `false`
                    // return that still hands back a non-null driver.
                    connectorError = ex.Message;
                }

                if (built && connectorDriver is not null)
                {
                    // GP-5 (task-5-brief.md item 3) — a connector that just successfully started is, by
                    // definition, no longer "configured but not started"; clear any issue a PREVIOUS
                    // StartLocked call recorded for this same id (e.g. an operator fixed a typo'd
                    // connectors.json entry and restarted the fleet) so GetConfiguredConnectorIssues never
                    // reports a stale failure once the connector is actually running.
                    _connectorStartIssues.TryRemove(connectorId, out _);

                    // No per-machine MappingProfile override exists for a registry-driven connector (same
                    // as pre-GP-4 Modbus/OPC-UA), so this uses a plain Automation-class fallback profile,
                    // same shape as `profile` above.
                    var connectorLabel = ResolveConnectorSlotLabel(connectorId);
                    var connectorProfile = new MappingProfile { Name = connectorLabel, DeviceClass = "Automation" };
                    groups.Add((connectorLabel, connectorDriver, connectorProfile, null));
                    continue;
                }

                var resolvedConnectorError = connectorError ?? "factory returned no driver and no error (contract violation)";
                _logger?.LogWarning(
                    "Connector '{ConnectorId}' could not be started: {ConnectorError}",
                    connectorId,
                    resolvedConnectorError);

                // GP-4 review carry-over, closed by GP-5 (task-5-brief.md item 3) — before this, a
                // configured-but-failed-to-start connector produced this one LogWarning and NOTHING else:
                // no GetDriverHealth() entry (no slot was ever created), no alarm, no health signal — an
                // operator had no way to discover a connectors.json typo except by reading the log file.
                // Deliberately NOT surfaced through LastError/`/v1/health` (see the big comment above this
                // loop) — this is purely an informational projection an operator can poll
                // (GetConfiguredConnectorIssues, GET /v1/connectors), never a fault signal.
                _connectorStartIssues[connectorId] = resolvedConnectorError;

                if (connectorDriver is not null)
                {
                    // Review fix round 1 — a contract-violating factory can return false (or throw AFTER
                    // already assigning its `out` driver parameter) while still handing back a real,
                    // non-null driver instance; ModbusTcpDriver is exactly the class of driver that owns a
                    // live socket a silently-discarded reference would leak.
                    //
                    // Review fix round 2 — round 1 disposed this HERE, synchronously, inside StartLocked —
                    // which every caller invokes with `_gate` held. A slow/hung third-party DisposeAsync
                    // would then delay Estop() (which takes the same lock) for up to RestartTeardownTimeout
                    // — precisely the "blocks E-STOP" hazard class IConnectorFactory.TryCreate's own doc
                    // comment warns against for TryCreate itself, reopened by round 1's own leak fix. Fixed
                    // by only COLLECTING the orphan here — the actual bounded dispose now happens in
                    // DisposeOrphanedConnectorDrivers, called by every StartLocked caller AFTER _gate is
                    // released, the same "off-lock" discipline WaitAndDisposeOldPipeline already follows.
                    orphanedConnectorDrivers.Add(connectorDriver);
                }
            }
        }

        foreach (var g in groups)
        {
            StartSlot(g.Label, g.Driver, g.Profile, g.Resolver);
        }

        // SM-1 — set unconditionally here (never gated on `groups.Count > 0`): this method already
        // early-returned above if IsRunning/_estopEngaged, so reaching this point always means a genuine
        // not-running -> running transition, whether or not any pipeline slot actually got built (an empty
        // product roster builds zero slots by design — see _running's own doc comment).
        _running = true;

        return orphanedConnectorDrivers;
    }

    /// <summary>Review fix round 2 — the off-lock counterpart to <see cref="StartLocked"/>'s orphan
    /// collection: every <see cref="StartLocked"/> caller invokes this AFTER releasing <see cref="_gate"/>,
    /// mirroring <see cref="WaitAndDisposeOldPipeline"/>'s own "wait/dispose must happen OUTSIDE _gate"
    /// discipline exactly (same reasoning: <see cref="Estop"/> takes <see cref="_gate"/> too, and a
    /// slow/hung third-party <see cref="IDeviceDriver.DisposeAsync"/> must never delay an emergency stop).
    /// Best-effort and per-driver BOUNDED (<see cref="RestartTeardownTimeout"/>, same budget
    /// <see cref="WaitAndDisposeOldPipeline"/> uses) — a driver whose <c>DisposeAsync</c> throws or hangs
    /// past that bound cannot wedge this method or any other orphan's own disposal.</summary>
    private void DisposeOrphanedConnectorDrivers(IReadOnlyList<IDeviceDriver> orphans)
    {
        foreach (var orphan in orphans)
        {
            try
            {
                orphan.DisposeAsync().AsTask().Wait(RestartTeardownTimeout);
            }
            catch (Exception ex)
            {
                // Best-effort, same "never let teardown hang/throw on a misbehaving driver" posture as
                // WaitAndDisposeOldPipeline's own dispose calls.
                _logger?.LogDebug(ex, "FleetHost orphaned connector driver dispose observed a fault");
            }
        }
    }

    /// <summary>Builds one pipeline slot, wires its Committed handler, adds it to <see cref="_slots"/>, and
    /// starts its background run-task with a PER-SLOT fault catch. Assumes the caller holds <see cref="_gate"/>.</summary>
    private void StartSlot(string label, IDeviceDriver driver, MappingProfile profile, Func<string, MappingProfile?>? resolver)
    {
        var pipeline = new EdgePipeline(driver, profile, _transport, _eventBus, resolver, _unsPublisher);
        pipeline.Committed += OnPipelineCommitted;
        var cts = new CancellationTokenSource();
        var slot = new PipelineSlot { Label = label, Pipeline = pipeline, Cts = cts, Driver = driver };
        _slots.Add(slot);

        slot.RunTask = Task.Run(async () =>
        {
            try
            {
                await pipeline.RunAsync(cts.Token).ConfigureAwait(false);
            }
            catch (OperationCanceledException)
            {
                // Expected on Stop()/restart.
            }
            catch (Exception ex)
            {
                _logger?.LogError(ex, "FleetHost pipeline slot '{Slot}' faulted", label);

                // G2-6 review fix — the disposes below happen OUTSIDE _gate (never dispose while holding
                // the lock): `removed` is decided under _gate (same slot-membership identity guard as
                // before — a superseded slot was already removed+disposed by StopLocked/
                // WaitAndDisposeOldPipeline, so a stale/slow-to-unwind fault can't double-own teardown), but
                // the actual driver DisposeAsync/CTS.Dispose only run when THIS catch is the one that
                // genuinely removed the slot. Idempotent either way (DisposeAsync/CTS.Dispose tolerate a
                // hypothetical double-call), but the guard keeps ownership unambiguous in the common case.
                bool removed;
                lock (_gate)
                {
                    // Slot-membership IS the identity guard (replaces the old _cts/_currentPipeline ReferenceEquals):
                    // a superseded slot was already removed by StopLocked, so a stale/slow-to-unwind fault can't
                    // clobber a freshly-restarted fleet. Removing THIS slot isolates the fault — sibling slots stay
                    // in _slots (fleet keeps running); when the LAST slot goes, IsRunning follows to false.
                    removed = _slots.Remove(slot);
                    if (removed)
                    {
                        LastError = ex;
                        pipeline.Committed -= OnPipelineCommitted;

                        // SM-1 — IsRunning is no longer computed straight off _slots.Count (see _running's
                        // own doc comment); this is the one place that old invariant must be reproduced by
                        // hand. Only fires when THIS removal is what brought _slots back down to zero — an
                        // empty roster (no slot ever built) never reaches this catch at all, so it never
                        // touches _running; only a roster that HAD live slots, all of which have now
                        // faulted out, flips running->false here, exactly like the old computed property did.
                        if (_slots.Count == 0)
                        {
                            _running = false;
                        }
                    }
                }

                if (removed)
                {
                    try
                    {
                        await driver.DisposeAsync().ConfigureAwait(false);
                    }
                    catch
                    {
                        // best-effort — a driver whose fault already tore down its own connection must not
                        // block this slot's teardown any further.
                    }

                    cts.Dispose();
                }
            }
        });
    }

    /// <summary>Cancels + detaches every current pipeline slot and returns them as a <see cref="PipelineHandle"/>
    /// instead of discarding them — callers that immediately restart (<see cref="RegisterMachine"/>/
    /// <see cref="ApplyScenario"/>) release <see cref="_gate"/>, wait for the old tasks via
    /// <see cref="WaitAndDisposeOldPipeline"/>, THEN re-acquire the gate to call <see cref="StartLocked"/>
    /// — never while still holding it (a slot's own catch above re-acquires <see cref="_gate"/>, so waiting for
    /// an old task from inside this same lock would deadlock whenever that catch actually needs to
    /// run). Assumes the caller already holds <see cref="_gate"/>.
    ///
    /// <para><b>Batch review (WS-G-plugin whole-batch, fix 1) — <see cref="CancellationTokenSource.Cancel"/>
    /// itself is wrapped per-slot in its own try/catch.</b> <c>Cancel()</c> runs every callback registered via
    /// <see cref="CancellationToken.Register(Action)"/> SYNCHRONOUSLY on THIS thread and rethrows any exception
    /// one of them throws. <c>ModbusTcpDriver.PollOnceAsync</c>'s <c>ct.Register(DisposeConnection)</c> (the
    /// repo's first-ever registration on a slot token) is benign today (<c>DisposeConnection</c> wraps each
    /// disposal in its own try/catch), but <see cref="Estop"/>/<see cref="Stop"/> call this method with
    /// <see cref="_gate"/> HELD — an uncaught throw here, from a THIRD-PARTY driver mirroring that same
    /// <c>ct.Register</c> pattern with a misbehaving callback, would abort this entire loop before
    /// <c>_slots.Clear()</c> below ever runs and before <see cref="Estop"/> latches <see cref="_estopEngaged"/>
    /// — machinery would keep running while the caller believes E-STOP succeeded (or the caller sees an
    /// exception instead of a clean stop). Caught PER-SLOT, not around the whole loop, so one misbehaving
    /// driver's callback can never also skip cancelling every OTHER slot — see
    /// <see cref="IDeviceDriver.ReadAsync"/>'s own doc comment for the contract this documents on the driver
    /// side.</para></summary>
    private PipelineHandle StopLocked()
    {
        // SM-1 — guard on _running (the operator-started flag), not _slots.Count: an empty-roster fleet
        // that was Start()ed has _running == true with zero slots, and this call must still flip it back
        // to false (a real Stop()) rather than early-returning as a no-op. Only a genuinely
        // already-not-running fleet (never started, or already stopped/faulted-out) skips everything below.
        if (!_running) return default;
        _running = false;

        if (_slots.Count == 0) return default;

        var old = _slots.ToList();
        foreach (var slot in old)
        {
            try
            {
                slot.Cts.Cancel();
            }
            catch (Exception ex)
            {
                // A driver's cancellation-registration callback threw — never let it abort E-STOP for every
                // OTHER slot, or stop this method from reaching _slots.Clear()/the EstopEngaged latch below.
                _logger?.LogError(
                    ex,
                    "FleetHost pipeline slot '{Slot}' threw from a cancellation-registration callback during " +
                    "Cts.Cancel() — IDeviceDriver.ReadAsync's contract requires such a callback to be prompt " +
                    "and non-throwing; continuing to cancel/tear down every other slot regardless",
                    slot.Label);
            }

            slot.Pipeline.Committed -= OnPipelineCommitted;
        }

        _slots.Clear();
        return new PipelineHandle(old);
    }

    /// <summary>Completion-review #7 — bounded, OFF-LOCK wait for each old slot's run-task to actually
    /// finish (closing the "leaked CTS + briefly two pipelines share <see cref="_transport"/>" gap)
    /// before the caller starts fresh ones. Must never be called while holding <see cref="_gate"/>: a
    /// slot's own catch handler (see <see cref="StartSlot"/>) re-acquires <see cref="_gate"/> to apply
    /// its slot-membership-guarded write, so a caller blocked on <c>Task.Wait()</c> for that same task
    /// WHILE holding the gate would deadlock against it. If an old task is still stuck past the timeout,
    /// this gives up and disposes its CTS anyway — Cancel() has already been requested, so the task will
    /// eventually unwind and its own membership guard (not this method) is what keeps a late finish from
    /// corrupting state.
    ///
    /// G2-6 review fix — ALSO disposes each slot's <see cref="PipelineSlot.Driver"/>, best-effort, AFTER its
    /// run-task has exited (cancel → run-task exits on the cancellation → wait → dispose driver → dispose
    /// cts). Cancelling a slot's <see cref="PipelineSlot.Cts"/> alone stops its poll loop but does NOT
    /// release a driver-owned live resource (e.g. <see cref="ModbusTcpDriver"/>'s TCP
    /// connection) — before this fix, FleetHost never called <c>DisposeAsync</c> on ANY slot's driver, so
    /// every Stop/restart leaked one connection per real-driver slot until GC finalized it. Sync-waiting
    /// <c>DisposeAsync</c> here (bounded by <see cref="RestartTeardownTimeout"/>, same budget the run-task
    /// wait above already uses) is deadlock-safe: this method runs OFF <see cref="_gate"/>, and a driver's
    /// <c>DisposeAsync</c> never calls back into <see cref="FleetHost"/> (e.g. <c>ModbusTcpDriver</c> just
    /// cancels/closes its own <c>TcpClient</c>).</summary>
    private void WaitAndDisposeOldPipeline(PipelineHandle handle)
    {
        if (handle.OldSlots is null) return;

        foreach (var slot in handle.OldSlots)
        {
            if (slot.RunTask is not null)
            {
                try
                {
                    slot.RunTask.Wait(RestartTeardownTimeout);
                }
                catch (AggregateException ex)
                {
                    // Defensive only: a slot's run-task body catches every exception it can throw
                    // (OperationCanceledException and general Exception both handled internally, see
                    // StartSlot), so this Task should never actually fault. If something inside that catch
                    // itself somehow throws, this just keeps Task.Wait()'s unwrap-and-rethrow from surfacing
                    // as an unhandled exception on the restart caller instead of a log line.
                    _logger?.LogDebug(ex, "FleetHost old pipeline slot teardown wait observed a faulted task");
                }
            }

            try
            {
                slot.Driver.DisposeAsync().AsTask().Wait(RestartTeardownTimeout);
            }
            catch (Exception ex)
            {
                // Best-effort, same "never let teardown hang/throw on a misbehaving driver" posture as the
                // run-task wait above.
                _logger?.LogDebug(ex, "FleetHost old pipeline slot driver dispose observed a fault");
            }

            slot.Cts.Dispose();
        }
    }

    private void OnPipelineCommitted(DeviceReading reading, TransportAck ack)
    {
        // SM-2 (.superpowers/sdd/2026-07-29-dotA-single-machine-sellable-blueprint/task-2-brief.md) —
        // data lineage, classified HERE, cheaply, on this hot path: from the SAME already-resolved
        // MachineDescriptor.DriverKind every other classification in this codebase reads (via the ONE
        // canonical DriverKinds.IsFabricated call path) — never a second/independently-invented rule, and
        // never inferred later from the CURRENT roster at Snapshot()-read time (the roster can change
        // between now and then). A reading whose machine code doesn't resolve to any MachineState (no
        // descriptor to classify — not reached by any registered driver in practice) is conservatively
        // treated as not-real for the real-only counters below, same "uncertain provenance never silently
        // counts as real" posture SqliteHistorianStore's own real-presence gate documents.
        var isFabricated = true;
        if (_states.TryGetValue(reading.MachineCode, out var state))
        {
            state.ApplyReading(reading, ack);
            isFabricated = DriverKinds.IsFabricated(state.Descriptor.DriverKind);
            _historianWriter?.Enqueue(HistorianResultRecord.From(state.Descriptor, reading, ack, DateTimeOffset.UtcNow));
        }

        Interlocked.Increment(ref _totalCycles);
        if (!isFabricated) Interlocked.Increment(ref _totalCyclesReal);

        if (reading.Verdict != Verdict.Skip)
        {
            lock (_kpiGate)
            {
                _totalJudged++;
                if (reading.Verdict is Verdict.Pass or Verdict.Warn) _totalPass++;

                if (!isFabricated)
                {
                    _totalJudgedReal++;
                    if (reading.Verdict is Verdict.Pass or Verdict.Warn) _totalPassReal++;
                }
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

        // SM-2 — "not blend, not suppress": the CURRENT roster decides which counter set this call
        // reports. A real machine present means _totalCycles/_totalJudged/_totalPass (blended across every
        // slot, fabricated included) would silently blend fabricated cycles into a number a customer reads
        // — so the real-only counters are reported instead, excluding the fabricated fleet entirely, even
        // though Machines above still lists it (see HasMixedProvenance). No real machine present (a pure
        // demo roster, or an empty product roster) means there is nothing to blend WITH — the original
        // blended counters are reported unchanged, which is also what keeps the exhibition contract
        // (pure demo's own numbers) byte-identical to before this task.
        var (hasFabricatedMachine, hasRealMachine) = ClassifyRoster();

        long totalCycles;
        double fpy;
        if (hasRealMachine)
        {
            totalCycles = Interlocked.Read(ref _totalCyclesReal);
            lock (_kpiGate)
            {
                fpy = _totalJudgedReal == 0 ? 0.0 : (double)_totalPassReal / _totalJudgedReal;
            }
        }
        else
        {
            totalCycles = Interlocked.Read(ref _totalCycles);
            lock (_kpiGate)
            {
                fpy = _totalJudged == 0 ? 0.0 : (double)_totalPass / _totalJudged;
            }
        }

        var hasMixedProvenance = hasFabricatedMachine && hasRealMachine;

        return new FleetSnapshotDto(machines, new FleetKpisDto(online, totalCycles, fpy, hasMixedProvenance), isRunning, estopEngaged);
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
    /// (including whatever was just added) — any connector driver <see cref="StartLocked"/> collects as
    /// orphaned (review fix round 2) is likewise disposed OFF this same lock, via
    /// <see cref="DisposeOrphanedConnectorDrivers"/>. There's a narrow window between those two locked sections
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

        // GP-5 (task-5-brief.md item 1) — FleetConfig.Load already normalizes a fleet.json entry's
        // DriverKind through DriverKinds.Normalize (so "modbus"/"MODBUS"/"Modbus" all land on the exact
        // canonical spelling); a descriptor arriving through THIS method (Program.cs's Modbus/OPC-UA seed
        // descriptors, OnboardingFleetJoin, or any future caller) never went through that same fold. Every
        // built-in seed descriptor in this codebase already passes a canonical DriverKinds constant
        // directly, so this is a no-op for them — it matters for a caller that hands in some OTHER casing
        // of a built-in id, or a third-party id whose exact-spelling storage here is what StartLocked's own
        // union filter (and every other DriverKind-literal comparison in this class) relies on comparing
        // correctly against DriverKinds.Modbus/OpcUa/registry ids.
        descriptor = descriptor with { DriverKind = DriverKinds.Normalize(descriptor.DriverKind) };

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

            // P2-1 — same fire-and-forget upsert as the ctor's roster-seed loop above; a newly-registered
            // machine becomes a durable asset row too, not just the ones present at process start.
            _ = _assetRegistry?.UpsertAsync(descriptor);

            if (IsRunning)
            {
                restartHandle = StopLocked();
                restarting = true;
            }
        }

        if (restarting)
        {
            WaitAndDisposeOldPipeline(restartHandle);
            List<IDeviceDriver> orphanedConnectorDrivers;
            lock (_gate) { orphanedConnectorDrivers = StartLocked(); }
            // Review fix round 2 — off-lock, same reasoning as WaitAndDisposeOldPipeline just above.
            DisposeOrphanedConnectorDrivers(orphanedConnectorDrivers);
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
            List<IDeviceDriver> orphanedConnectorDrivers;
            lock (_gate) { orphanedConnectorDrivers = StartLocked(); }
            // Review fix round 2 — off-lock, same reasoning as WaitAndDisposeOldPipeline just above.
            DisposeOrphanedConnectorDrivers(orphanedConnectorDrivers);
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
                DriverKinds.HotFolderAoi, "RC-HOTFOLDER-DEMO", null, CycleSeconds: 1.0);
            var sim = new AoiInspectorSim(demoDescriptor, seed: 777, pointsPerBoard: 8, ngRate: 1.0);
            var reading = sim.NextCycle(cycle: 1);

            var writtenPath = new Doc28Writer().WriteAtomic(watchDir, reading);

            await using var driver = new HotFolderAoiDriver(watchDir, archiveDir, errorDir);
            var profile = new MappingProfile { Name = "hotfolder-demo", DeviceClass = nameof(DeviceClass.AoiAvi) };
            var pipeline = new EdgePipeline(driver, profile, _transport, _eventBus, uns: _unsPublisher);

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
        string persistedServerUrl;
        string persistedMachineCode;
        bool persistedVerifyTls;
        lock (_gate)
        {
            rebuildNeeded = false;
            if (request.ServerUrl is not null) { _serverUrl = request.ServerUrl; rebuildNeeded = true; }
            if (request.VerifyTls is not null) { _verifyTls = request.VerifyTls.Value; rebuildNeeded = true; }
            if (request.MachineCode is not null) { _machineCode = request.MachineCode; rebuildNeeded = true; }
            if (request.Language is not null) { _language = request.Language; }

            persistedServerUrl = _serverUrl;
            persistedMachineCode = _machineCode;
            persistedVerifyTls = _verifyTls;
        }

        if (rebuildNeeded)
        {
            var mkKey = CredentialStore.Load(_machineCode);
            _transportCoordinator.RebuildLive(_serverUrl, _machineCode, mkKey, _verifyTls);
            _configSyncCoordinator?.RebuildLive(_serverUrl, _machineCode, mkKey, _verifyTls, _transportCoordinator.Mode);

            // FF-1 — persist serverUrl/machineCode/verifyTls ONLY (never the mk_ key above, never
            // _language) so this survives a process restart; see FleetSettingsStore's own doc comment for
            // the file-vs-env-var precedence this enables. The values saved are the ones captured under
            // _gate above (this call's own effective triple), not a fresh unsynchronized field read, so a
            // concurrent second UpdateSettings call can never make this write a torn mix of both calls'
            // values.
            _settingsStore?.Save(new PersistedFleetSettings
            {
                ServerUrl = persistedServerUrl,
                MachineCode = persistedMachineCode,
                VerifyTls = persistedVerifyTls,
            });
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
    /// <summary>GP-3 — instance method (not static, as before) purely so a per-entry
    /// <see cref="FleetConfig.Load"/> warning can reach <see cref="_logger"/>; called exactly once, from
    /// the constructor, after <see cref="_logger"/> is assigned.
    ///
    /// SM-1 (.superpowers/sdd/2026-07-29-dotA-single-machine-sellable-blueprint/task-1-brief.md) —
    /// <see cref="_demoModeGate"/> now decides which of two outcomes this resolves to, reusing the same
    /// demo-vs-product seam <c>Program.cs</c>/<c>ModeEndpoints</c> already key off, rather than inventing a
    /// second one:
    ///  - null (every pre-existing test/call site that constructs <see cref="FleetHost"/> directly) or
    ///    <see cref="St4i.EdgeCore.Config.DemoModeGate.Enabled"/> — byte-identical to this method's
    ///    pre-SM-1 behavior, handled by <see cref="ResolveFleet"/> with <c>demoMode: true</c>.
    ///  - non-null and disabled (a real product deployment) — the roster starts EMPTY. No fleet.json path
    ///    at all (nothing beside the exe, no <c>--fleet</c> arg) is simply an empty roster, same as before
    ///    this task for THAT specific case; a path that DOES resolve is still handed to
    ///    <see cref="ResolveFleet"/> (with <c>demoMode: false</c>) purely so a present-but-broken file
    ///    produces a clear, visible warning instead of being silently ignored outright — but its content
    ///    (valid or not) never populates a product roster; see that method's own remarks.
    /// </summary>
    private IReadOnlyList<MachineDescriptor> LoadFleet()
    {
        var demoMode = _demoModeGate is null || _demoModeGate.Enabled;
        var path = ResolveFleetPath();

        return path is null
            ? (demoMode ? BuildDefaultFleet() : Array.Empty<MachineDescriptor>())
            : ResolveFleet(path, demoMode);
    }

    /// <summary>The shared decision core both branches of <see cref="LoadFleet"/> funnel through once a
    /// <c>fleet.json</c> PATH has actually been resolved (see <see cref="ResolveFleetPath"/>). Factored out
    /// of <see cref="LoadFleet"/> (rather than duplicated per-mode) so the parsing/exception handling is
    /// written — and tested — exactly once. <see langword="internal"/> (not <see langword="private"/>) so
    /// <c>St4i.EngineApi.Tests</c> can drive the malformed-file branch directly against a throwaway temp
    /// file: there is no clean per-test way to reach this same code path through <see cref="LoadFleet"/>
    /// itself without mutating real, shared, concurrently-read process/filesystem state (this assembly's
    /// own <c>fleet.json</c>, sitting beside every test's output directory, and the actual process command
    /// line <see cref="ResolveFleetPath"/> also consults) — which would be flaky under this solution's
    /// parallel test execution.
    ///
    /// <para><paramref name="demoMode"/> <see langword="true"/> (demo): byte-identical to this method's
    /// pre-SM-1 behavior. A <see cref="FleetConfigException"/> (genuinely unparseable JSON) or a
    /// zero-machine result both fall back to <see cref="BuildDefaultFleet"/>, exactly as before — the
    /// exhibition/sales fleet's forgiving "never crash startup over a bad file" contract is unchanged.</para>
    ///
    /// <para><paramref name="demoMode"/> <see langword="false"/> (product): NEVER falls back to
    /// <see cref="BuildDefaultFleet"/> — that would be exactly the "silently show a customer fake machines
    /// that look like production data" bug this task exists to close. A genuinely malformed file logs a
    /// clear warning naming the path and yields an empty roster — never a raw exception, never the demo
    /// fleet. A file that parses FINE but has entries ALSO yields an empty roster (with its own warning
    /// naming the ignored count): fleet.json is a demo-only artifact in product mode — its content is never
    /// a valid way to declare a real machine, only <c>connectors.json</c>/env vars
    /// (via <see cref="RegisterMachine"/>) are.</para></summary>
    internal IReadOnlyList<MachineDescriptor> ResolveFleet(string path, bool demoMode)
    {
        try
        {
            var loaded = FleetConfig.Load(path, logWarning: msg => _logger?.LogWarning("{FleetConfigWarning}", msg));
            if (loaded.Count > 0)
            {
                if (demoMode) return loaded;

                _logger?.LogWarning(
                    "Product mode ignores fleet.json — {Count} entry(ies) at '{Path}' were NOT loaded into the " +
                    "roster. fleet.json only supplies the demo fleet; configure real machines via connectors.json " +
                    "or the ST4I_MODBUS_*/ST4I_OPCUA_* environment variables instead. The roster starts empty.",
                    loaded.Count, path);
                return Array.Empty<MachineDescriptor>();
            }
        }
        catch (FleetConfigException ex)
        {
            if (demoMode)
            {
                // Malformed fleet.json — fall through to the in-code default rather than fail startup.
                _logger?.LogWarning(ex, "Malformed fleet.json at '{Path}' — falling back to the in-code default fleet", path);
                return BuildDefaultFleet();
            }

            _logger?.LogWarning(
                ex,
                "Product mode: fleet.json at '{Path}' is malformed and was ignored. fleet.json only supplies the " +
                "demo fleet; configure real machines via connectors.json or the ST4I_MODBUS_*/ST4I_OPCUA_* " +
                "environment variables instead. The roster starts empty.",
                path);
            return Array.Empty<MachineDescriptor>();
        }

        return demoMode ? BuildDefaultFleet() : Array.Empty<MachineDescriptor>();
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
