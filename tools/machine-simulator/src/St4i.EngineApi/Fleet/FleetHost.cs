using St4i.Connector.Abstractions;
using St4i.Connector.Abstractions.Models;
using St4i.EdgeCore.Config;
using St4i.EdgeCore.Engine;
using St4i.EdgeCore.Fleet;
using St4i.EdgeCore.Historian;
using St4i.EdgeCore.Infrastructure;
using St4i.EdgeCore.Mapping;
using St4i.EdgeCore.Models;
using St4i.EdgeCore.Transport;
using St4i.EdgeCore.Uns;
using St4i.EngineApi.AssetRegistry;
using Microsoft.Extensions.Logging;

namespace St4i.EngineApi.Fleet;

/// <summary>
/// The headless engine's fleet surface, as every <c>Endpoints/</c> route, <c>LineController</c>,
/// <c>AlarmEvaluator</c> and <c>RelayNotificationChannel</c> has always seen it — the same public member
/// set, the same signatures, the same semantics.
///
/// <para>🔴 <b>Task E-2 (docs/plans/2026-08-04-dotE-fleet-core-extraction-blueprint.md) — this class is now
/// a THIN SHELL over <see cref="FleetCore"/>, which lives in <c>St4i.EdgeCore</c>.</b> Đợt D made RS-485
/// work, but only inside this process; the process that actually owns the serial port on a machine is
/// <c>St4i.EdgeService</c>, whose <c>EdgeWorker</c> knew only one driver and one pipeline. (🔴 <b>Past tense
/// since E-3</b>, corrected by the whole-branch review as I1: it now runs N drivers on N pipelines from its
/// own <c>connectors.json</c>, through <c>EdgeAgentPipelines</c> — never through <see cref="FleetCore"/>,
/// which is <c>internal</c> exactly so that host cannot reach its unguarded write path. This is the SAME
/// sentence E-4's post-commit sweep corrected at <c>FleetCore.cs:123</c>; E-2 split these two files out of
/// one, so the prose was duplicated, and only one copy was swept. README §24.) A direct
/// <c>EdgeService → St4i.EngineApi</c> reference is not available (NU1605 at restore, plus this project's
/// ASP.NET Core / web-UI publish surface), so the N-driver lifecycle had to come DOWN to the assembly both
/// hosts already reference. That relocation is E-2; teaching <c>EdgeWorker</c> to use it is E-3.</para>
///
/// <para><b>What stayed here, and why it is exactly this list</b> (blueprint §4, as corrected by E-1 §1.4):
/// every wire DTO and the projections that build them, the scenario PRESET catalogue, the connection probe,
/// <see cref="IAssetRegistry"/>, <c>ConfigSyncCoordinator</c>, and the <see cref="ILogger"/> the core does
/// not speak. Everything that touches the roster, the pipeline slots, the KPI counters, the settings fields
/// or the HALT latch went down, INCLUDING the members blueprint §4 filed as "scenario/demo — stays"
/// (<see cref="ApplyScenario"/>, <see cref="Burst"/>, <see cref="RunHotFolderAoiDemoAsync"/>): E-1 §1.4
/// showed each of them mutates core state under the core's own lock, so only their DTO shells stayed.</para>
///
/// <para>🔴 <b>THIS CLASS HOLDS NO LOCK, and that is load-bearing rather than tidy.</b> E-1 §3.2 enumerated
/// two shapes for the cut and judged both bad: a shell that reads a gate-protected PAIR through two separate
/// core calls loses the pair's atomicity, and a shell with a lock of its own creates a real
/// <c>shell → core</c> ordering that deadlocks the moment the core ever calls back out under its own gate.
/// The shape here is the third: <b>one lock, in <see cref="FleetCore"/>, and exactly TWO paired reads left
/// on this side of the cut, both LABELLED at their own declaration</b> — <see cref="CurrentScenarioDto"/>
/// (found by the E-2 review) and <see cref="MachineDetail"/> (found by the whole-branch review, I2).
/// 🔴 This sentence said "not one paired read" until G-1's review round; it had been contradicted twice in
/// this same file since I2, and <see cref="FleetCore"/>'s own banner was corrected to "exactly TWO" at the
/// time while this one was missed. A banner that says "none" is what stops the next reader counting — which
/// is the whole reason I2 exists — so it is fixed here even though it predates G-1.
/// Every OTHER member below is either a straight delegation or a delegation plus a pure
/// projection of the record the core already resolved atomically. If you ever add a member here that reads
/// two things from the core and combines them, you have re-created E-1's first bad shape — resolve the pair
/// inside <see cref="FleetCore"/> instead, and return a record. Do not add a third exception.</para>
/// </summary>
public sealed class FleetHost
{
    /// <summary>Kept as <c>const</c> aliases of <see cref="FleetCore"/>'s own so <c>Program.cs</c>'s existing
    /// <c>FleetHost.DefaultServerUrl</c>/<c>DefaultMachineCode</c> call sites are untouched, and so there is
    /// still exactly ONE definition of each value. See <see cref="FleetCore.DefaultServerUrl"/> for the
    /// "blank is the honest product default, not a typo'd config" reasoning.</summary>
    public const string DefaultServerUrl = FleetCore.DefaultServerUrl;

    public const string DefaultMachineCode = FleetCore.DefaultMachineCode;

    public const string DefaultLanguage = FleetCore.DefaultLanguage;

    /// <summary>The scenario preset catalogue — genuinely shell-side, unlike the scenario MECHANISM. These
    /// five entries are a menu of <see cref="ScenarioConfig"/>s plus operator-facing Vietnamese copy and a
    /// demo flag; nothing here touches a lock, the roster or a pipeline. <see cref="ApplyPresetAsync"/> is
    /// the only reader.</summary>
    private static readonly IReadOnlyList<ScenarioPresetInfo> Presets = new[]
    {
        new ScenarioPresetInfo("normal", "Ca binh thuong - toc do/ty le loi mac dinh cua day chuyen.", ScenarioConfig.Normal),
        new ScenarioPresetInfo("high-defect", "Lo loi cao - tang manh ty le loi tiem them de trinh dien andon/alert.", new ScenarioConfig(1.0, 0.35, 0.05, false)),
        new ScenarioPresetInfo("sensor-drift", "Sensor drift - tang toc chu ky de lo su kien troi hieu chuan dinh ky cua IOT_SENSOR.", new ScenarioConfig(5.0, 0.03, 0.05, false)),
        new ScenarioPresetInfo("network-outage", "Mat mang demo - chuyen transport sang store-and-forward loi cao (~90%).", new ScenarioConfig(1.0, 0.0, 0.0, true)),
        new ScenarioPresetInfo("hotfolder-aoi", "Hot-folder AOI - ghi 1 file doc28 mau roi de HotFolderAoiDriver doc lai that.", ScenarioConfig.Normal, TriggersHotFolderDemo: true),
    };

    /// <summary>The config kind <see cref="SyncConfigAsync"/> asks the ecosystem for. Moved here with that
    /// method — it is the only reader, and the core never speaks it.</summary>
    private const string ConfigKind = "recipe";

    private readonly FleetCore _core;
    private readonly ResilienceProbe _probe = new();
    private readonly St4i.EngineApi.Config.ConfigSyncCoordinator? _configSyncCoordinator;

    /// <summary>Identical parameter list, order, optionality and defaults to the pre-E-2 ctor — every one of
    /// the 39 test files and every DI registration that constructs this type is untouched. The body's only
    /// job is to translate the four EngineApi-typed dependencies into the callback seams
    /// <see cref="FleetCore"/> declares, and then hand the rest through verbatim.</summary>
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
        _configSyncCoordinator = configSyncCoordinator;

        // 🔴 E-2 — NULL when there is no ILogger, deliberately, and NOT a lambda that closes over a null
        // logger. St4i.EdgeCore's logging convention is nullable callbacks — a pair everywhere until G-1
        // added logDebug below, which makes FleetCore the FIRST three-channel type in that assembly
        // (WalFlushPump and HistorianWriter both carry two). D-7a's Critical is what
        // makes the nullability load-bearing rather than stylistic: `?.` short-circuits the whole argument
        // list, so any mechanism state smuggled into a log call's arguments silently stops working for hosts
        // built without a callback. A never-null callback would make that failure mode unreachable BY TEST
        // while leaving it perfectly reachable in production — FleetHostConnectorVisibilityTests builds its
        // host with no logger precisely so the mutation stays red. See FleetCore._logWarning.
        //
        // Log LEVEL: fourteen call sites, recounted from the pre-E-2 source (commit 5f2b8883) rather than
        // from the note that records them — four message-only (all LogWarning, all still LogWarning here)
        // and ten exception-carrying, which were five LogWarning + two LogError + three LogDebug. Blueprint
        // §10.4's accounting is exact and there is no fourth LogDebug site.
        //
        // 🔴 G-1 — E-2 collapsed all ten onto LogError because EdgeCore's convention had only two channels.
        // The three that were LogDebug are best-effort teardown cleanup, and St4i.EngineApi ships no
        // appsettings.json, so they did not go from Debug to Error in an operator's eyes: they went from
        // SILENT to Error, and under AddWindowsService from silent to a synchronous Windows Event Log write.
        // A third channel restores exactly those three (see FleetCore._logDebug for why LogDebug and not
        // LogInformation, and for the enumeration behind "exactly three").
        //
        // The remaining five drifted sites (LogWarning -> LogError) are LEFT as E-2 recorded them: they
        // change severity but NOT Event Log presence, because AddEventLog's default filter already admits
        // Warning. That is the whole of the difference, and it is why this task is three lines and not ten.
        Action<string>? logWarning = logger is null
            ? null
            : msg => logger.LogWarning("{FleetCoreMessage}", msg);
        Action<Exception, string>? logError = logger is null
            ? null
            : (ex, msg) => logger.LogError(ex, "{FleetCoreMessage}", msg);

        // 🔴 G-1 — the third channel, and NULL when there is no ILogger for exactly the reason the pair
        // above is: a never-null callback removes the only way to build the core without one, which is what
        // makes D-7a's Critical testable at all.
        Action<Exception, string>? logDebug = logger is null
            ? null
            : (ex, msg) => logger.LogDebug(ex, "{FleetCoreMessage}", msg);

        // 🔴 P2-1 — see FleetCore._onMachineSeeded. `_ =` plus the `Async` suffix reads as fire-and-forget
        // and is NOT: Microsoft.Data.Sqlite does not override the async ADO.NET members, so a real
        // AssetRegistryStore runs its whole SQLite transaction on THIS thread. This lambda is unchanged and
        // still exactly as costly as it was — one invocation per seeded machine, synchronous, null when no
        // registry is wired.
        //
        // 🔴 G-1 changed WHERE the core invokes it, not what it does: no longer under FleetCore._gate
        // (blueprint §9.2 violation 3, the 12.35 ms block of an EstopEngaged reader), so the cost lands on
        // the registering caller instead of on every reader of the halt latch.
        Action<MachineDescriptor>? onMachineSeeded = assetRegistry is null
            ? null
            : descriptor => { _ = assetRegistry.UpsertAsync(descriptor); };

        // Task C3 — fires exactly where `_configSyncCoordinator?.RebuildLive(...)` fired before the cut:
        // inside UpdateSettings, after TransportCoordinator.RebuildLive, before FleetSettingsStore.Save.
        Action<string, string, string?, bool, TransportMode>? onLiveSettingsRebuilt = configSyncCoordinator is null
            ? null
            : (serverUrl, machineCode, mkKey, verifyTls, mode) =>
                configSyncCoordinator.RebuildLive(serverUrl, machineCode, mkKey, verifyTls, mode);

        _core = new FleetCore(
            transport,
            transportCoordinator,
            eventBus,
            logWarning: logWarning,
            logError: logError,
            logDebug: logDebug,
            onLiveSettingsRebuilt: onLiveSettingsRebuilt,
            configStore: configStore,
            productConfigStore: productConfigStore,
            historianWriter: historianWriter,
            settingsStore: settingsStore,
            unsPublisher: unsPublisher,
            onMachineSeeded: onMachineSeeded,
            connectorRegistry: connectorRegistry,
            demoModeGate: demoModeGate);
    }

    // ─────────────────────────────────────────────────────────────────────
    // LIFECYCLE / ROSTER / SAFETY — straight delegation, no projection.
    // ─────────────────────────────────────────────────────────────────────

    /// <summary>Point-in-time copy of the fleet roster. See <see cref="FleetCore.Fleet"/>.</summary>
    public IReadOnlyList<MachineDescriptor> Fleet => _core.Fleet;

    public ITransport Transport => _core.Transport;

    /// <summary>Test-only seam (default no-op) — lets <c>St4i.EngineApi.Tests</c> wrap the pipeline's
    /// <see cref="IDeviceDriver"/> in a fault-injecting decorator so the restart-race identity guard
    /// (completion-review.md #1/#7) can be reproduced deterministically. Production never sets this
    /// (<c>internal</c> on BOTH sides of the cut — see <c>St4i.EdgeCore/AssemblyInfo.cs</c> for why the
    /// narrowest way to keep this reachable after the move was two <c>InternalsVisibleTo</c> entries rather
    /// than making the core's seams public).</summary>
    internal Func<IDeviceDriver, IDeviceDriver>? DriverDecoratorForTests
    {
        get => _core.DriverDecoratorForTests;
        set => _core.DriverDecoratorForTests = value;
    }

    /// <summary>G2-5 — test-only seam (default null): injects ADDITIONAL pipeline groups beyond the
    /// simulated one, so the multi-slot fault-isolation machinery and the <c>AmbiguousDriver</c> guard can be
    /// exercised deterministically. See <see cref="DriverDecoratorForTests"/> for the visibility note.</summary>
    internal Func<IReadOnlyList<(string Label, IDeviceDriver Driver, MappingProfile Profile)>>? AdditionalPipelinesForTests
    {
        get => _core.AdditionalPipelinesForTests;
        set => _core.AdditionalPipelinesForTests = value;
    }

    /// <summary>🔴 J-1 — test-only seam (default null): fires inside <c>FleetCore</c>'s hoisted pipeline
    /// build, with that class's <c>_gate</c> RELEASED. See <see cref="FleetCore.StartBuildObserverForTests"/>
    /// for why the two seams above could not serve, and <see cref="DriverDecoratorForTests"/> for the
    /// visibility note. This is a straight pass-through and reads nothing — it is not a third exception to
    /// this class's no-paired-read rule.</summary>
    internal Action? StartBuildObserverForTests
    {
        get => _core.StartBuildObserverForTests;
        set => _core.StartBuildObserverForTests = value;
    }

    public bool IsRunning => _core.IsRunning;

    /// <summary>The HALT latch. See <see cref="FleetCore.EstopEngaged"/> — including the SM-4 truth that this
    /// is a SUPERVISORY software latch and never a safety-rated device.</summary>
    public bool EstopEngaged => _core.EstopEngaged;

    /// <summary>XC-R40 — the single read-only accessor for the supervisory safety state, and the sole input
    /// to <see cref="Policy.Rules.EstopGuardRule"/>.
    ///
    /// <para>🔴 <b>This is a straight delegation and it MUST stay one.</b> Blueprint §9.3b: the pair
    /// <c>(EstopEngaged, IsRunning)</c> is resolved inside <see cref="FleetCore"/> in ONE lock acquisition.
    /// Re-deriving it here as <c>new SafetySnapshot(_core.EstopEngaged, _core.IsRunning)</c> would compile,
    /// pass all 2555 tests, and quietly make an atomic pair non-atomic — §9.3b proved exactly that mutation
    /// survives today. §9.3b also corrected §9.3's MECHANISM: <c>EstopGuardRule.cs:47</c> reads
    /// <c>EstopEngaged</c> only, so a torn pair does not let a write through; what it corrupts is a SCREEN
    /// (<c>GET /v1/safety</c>). The pair still moves together, on the corrected grounds — a paired read split
    /// across two acquisitions is a latent hazard from the moment anyone reads both fields, and
    /// <c>SafetyEndpoints.cs:34</c> already does.</para></summary>
    public SafetySnapshot GetSafetyStatus() => _core.GetSafetyStatus();

    /// <summary>GĐ3 sub-4 LC-2 — per-slot driver health, read-only. See
    /// <see cref="FleetCore.GetDriverHealth"/>.</summary>
    public IReadOnlyList<DriverHealthSnapshot> GetDriverHealth() => _core.GetDriverHealth();

    /// <summary>GP-5 — every configured connector id that is NOT currently running because its most recent
    /// start attempt failed. Deliberately informational, surfaced through <c>GET /v1/connectors</c> alone and
    /// never through <see cref="LastError"/>/<c>GET /v1/health</c>: an optional peripheral's bad config must
    /// not flip the whole host unhealthy. See <see cref="FleetCore.GetConfiguredConnectorIssues"/>.</summary>
    public IReadOnlyList<ConnectorStatusDto> GetConfiguredConnectorIssues() =>
        _core.GetConfiguredConnectorIssues().Select(i => new ConnectorStatusDto(i.Id, i.Error)).ToList();

    /// <summary>Pure discovery — "does machine code X have a live, writable driver right now", no I/O and no
    /// side effect. See <see cref="MachineDriverAvailability"/>.</summary>
    public MachineDriverAvailability GetMachineDriverAvailability(string machineCode) =>
        _core.GetMachineDriverAvailability(machineCode);

    /// <summary>Resolves the machine to a live writable driver under the core's gate, releases the lock, and
    /// only THEN performs the write — see <see cref="FleetCore.TryWriteSetpointAsync"/> for the disposal-race
    /// contract and for why the failure <c>Detail</c> carries the exception's TYPE NAME and never its
    /// message.</summary>
    public Task<(MachineDriverAvailability Availability, SetpointWriteResult? Result)> TryWriteSetpointAsync(
        string machineCode, SetpointWriteRequest request, CancellationToken ct = default) =>
        _core.TryWriteSetpointAsync(machineCode, request, ct);

    /// <summary>Command-invocation mirror of <see cref="TryWriteSetpointAsync"/>. Same shape, same redaction
    /// contract.</summary>
    public Task<(MachineDriverAvailability Availability, CommandResult? Result)> TryInvokeCommandAsync(
        string machineCode, CommandRequest request, CancellationToken ct = default) =>
        _core.TryInvokeCommandAsync(machineCode, request, ct);

    /// <summary>The fleet-wide KPI counters <c>AlarmEvaluator</c>'s windowed NG-rate source polls. Mode-aware
    /// — see <see cref="FleetCore.GetKpiCounters"/>.</summary>
    public (long TotalPass, long TotalJudged) GetKpiCounters() => _core.GetKpiCounters();

    public Exception? LastError => _core.LastError;

    public TransportMode Mode => _core.Mode;

    public ScenarioConfig CurrentScenario => _core.CurrentScenario;

    public string ActivePresetName => _core.ActivePresetName;

    /// <summary>Read-only snapshot of the currently-active scenario — unlike <see cref="ApplyScenario"/>,
    /// this never mutates anything (no restart, no transport swap), so it's safe for a <c>GET</c>.
    ///
    /// <para>🔴 <b>THE ONE LABELLED EXCEPTION to this class's own rule above, and it is labelled because an
    /// unlabelled one gets copied.</b> This member does read two things from the core and combine them —
    /// exactly the shape the banner forbids — and the E-2 review found it thirty-four lines below the
    /// sentence forbidding it. It is exempt for a measured reason, not a convenient one:
    /// <c>_scenario</c> and <c>_activePresetName</c> are <see langword="volatile"/> fields that
    /// <see cref="FleetHost"/> read as two unsynchronised reads BEFORE the cut as well, so nothing about
    /// the extraction changed what a caller can observe here.
    ///
    /// <para>What keeps it exempt rather than merely grandfathered: the pair is written together under
    /// <c>FleetCore</c>'s gate, so a torn read is possible — and its only consequence is a
    /// <c>GET /v1/scenario</c> response naming a preset one apply behind its config. No guard, no write
    /// path and no latch reads either field. If that ever stops being true — if anything on the write or
    /// safety path starts reading this pair — this exemption dies and the pair must be resolved inside
    /// <see cref="FleetCore"/> and returned as one record, like every other pair on this seam.</para></para>
    /// </summary>
    public ScenarioDto CurrentScenarioDto() => ScenarioDto.From(_core.CurrentScenario, _core.ActivePresetName);

    /// <summary>Starts the read pipeline. See <see cref="FleetCore.Start"/> — including why the NBIRTH
    /// publish stays inside the gate and the historian run-event stays outside it.</summary>
    public void Start() => _core.Start();

    /// <summary>Stops the read pipeline, synchronously and boundedly. See <see cref="FleetCore.Stop"/>.</summary>
    public void Stop() => _core.Stop();

    /// <summary>SM-4/B-8 — READ <see cref="FleetCore.Estop"/> BEFORE CALLING: despite the name this does not
    /// stop a machine and cannot. It tears down THIS SOFTWARE's own read pipeline and latches
    /// <see cref="EstopEngaged"/>. A real emergency stop is a hardwired, safety-rated circuit per ISO 13849;
    /// software is never the safety path.</summary>
    public void Estop() => _core.Estop();

    /// <summary>Clears the HALT latch without restarting the fleet. See
    /// <see cref="FleetCore.ResetEstop"/>.</summary>
    public void ResetEstop() => _core.ResetEstop();

    /// <summary>Adds a machine to the LIVE roster at runtime, restarting the pipeline if it is running. See
    /// <see cref="FleetCore.RegisterMachine"/>.</summary>
    public bool RegisterMachine(MachineDescriptor descriptor) => _core.RegisterMachine(descriptor);

    public void SetCurrentProduct(string machineCode, string? productCode) =>
        _core.SetCurrentProduct(machineCode, productCode);

    public string? CurrentProductFor(string machineCode) => _core.CurrentProductFor(machineCode);

    /// <summary>The malformed-fleet.json decision core, reachable directly so a test can drive that branch
    /// against a throwaway temp file rather than mutating this assembly's own shipped <c>fleet.json</c> and
    /// the real process command line. See <see cref="FleetCore.ResolveFleet"/>.</summary>
    internal IReadOnlyList<MachineDescriptor> ResolveFleet(string path, bool demoMode) =>
        _core.ResolveFleet(path, demoMode);

    // ─────────────────────────────────────────────────────────────────────
    // PROJECTIONS — the only work this class does that is not delegation.
    // Each one takes ONE record the core already resolved atomically and reshapes it.
    // 🔴 TWO of them read two things from the core, and BOTH ARE LABELLED at their own declaration:
    // CurrentScenarioDto() (found by the E-2 review) and MachineDetail() (found by the whole-branch review,
    // I2). This banner said "none of them" for three tasks while two counterexamples sat under it — and E-2
    // had LOOKED at MachineDetail, since §10.2 is about removing its lock block, and still wrote the
    // universal. Neither is a regression (both pairs were two reads at BASE too); what was wrong was the
    // banner. See this class's own doc comment for why the rule is not negotiable, and each member's own
    // label for what keeps it exempt and what kills the exemption.
    // ─────────────────────────────────────────────────────────────────────

    /// <summary><c>GET /v1/fleet</c>. <see cref="FleetCore.ReadSnapshot"/> resolves running/estop under one
    /// lock acquisition, snapshots every <see cref="MachineState"/> under its own, and computes the
    /// mode-aware KPI rollup; this method only reshapes that one record.</summary>
    public FleetSnapshotDto Snapshot()
    {
        var snapshot = _core.ReadSnapshot();
        return new FleetSnapshotDto(
            snapshot.Machines.Select(FleetProjections.ToTileDto).ToList(),
            new FleetKpisDto(snapshot.Online, snapshot.TotalCycles, snapshot.Fpy, snapshot.HasMixedProvenance),
            snapshot.IsRunning,
            snapshot.EstopEngaged);
    }

    /// <summary><c>GET /v1/machines/{code}</c>. Branch-review I-9 — gated exactly like the fleet tiles: a
    /// stopped fleet forces the reported <c>StatusText</c> to idle regardless of the last real verdict, so
    /// this endpoint can never disagree with <c>GET /v1/fleet</c> about whether a stopped machine is "OK"
    /// (the live-reproduced bug: a stopped machine kept rendering a green "ĐẠT" badge because this DTO alone
    /// was never gated).
    ///
    /// <para>🔴 <b>THE SECOND LABELLED EXCEPTION to this class's no-paired-read rule</b> (whole-branch review,
    /// I2 — labelled for the same reason <see cref="CurrentScenarioDto"/> is: an unlabelled exception gets
    /// copied). It reads <see cref="FleetCore.IsRunning"/> — one <c>_gate</c> acquisition — and then
    /// <see cref="FleetCore.TryGetMachineState"/>, which takes no gate at all, and combines them via
    /// <c>state.ToDetail(isRunning)</c>. Exactly the shape the banner above forbids.</para>
    ///
    /// <para><b>Why it is exempt rather than a defect:</b> byte-identical to BASE. Before the cut this member
    /// read <c>IsRunning</c> — itself a <c>lock (_gate)</c> getter — and then the machine state, as two
    /// separate reads; E-2 removed only a redundant re-entrant acquisition around the first (blueprint §10.2),
    /// so nothing a caller can observe changed. <b>And the exemption is narrower than the scenario one:</b>
    /// what a torn read costs here is precisely the I-9 bug the paragraph above exists to prevent, briefly —
    /// a machine that has just been stopped can render one green "ĐẠT" badge before the next poll. A screen,
    /// not a write and not a latch; no guard and no write path reads this pair.</para>
    ///
    /// <para><b>What kills the exemption</b> (same condition as <see cref="CurrentScenarioDto"/>'s): if
    /// anything on the write path or the safety path starts reading this pair, or if the I-9 gating is ever
    /// asked to be exact rather than eventually-consistent, it must be resolved inside
    /// <see cref="FleetCore"/> and returned as ONE record — a <c>TryGetMachineDetail</c> that takes
    /// <c>_gate</c> once. That is a real, cheap follow-up, and it is an item rather than a blocker.</para></summary>
    public MachineDetailDto? MachineDetail(string code)
    {
        var isRunning = _core.IsRunning;
        return _core.TryGetMachineState(code, out var state) ? state.ToDetail(isRunning) : null;
    }

    // ─────────────────────────────────────────────────────────────────────
    // SCENARIO — the preset catalogue is genuinely shell-side; the mechanism is not.
    // ─────────────────────────────────────────────────────────────────────

    public ScenarioDto ApplyScenario(ScenarioConfig config, string? presetName = null)
    {
        var (applied, preset) = _core.ApplyScenario(config, presetName);
        return ScenarioDto.From(applied, preset);
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
        var (applied, preset) = _core.Burst();
        return ScenarioDto.From(applied, preset);
    }

    /// <summary>Writes one guaranteed-NG doc-28 file and runs a dedicated <c>EdgePipeline</c> over a real
    /// <c>HotFolderAoiDriver</c> watching it. Blueprint §4 filed this as "stays", but E-1 §1.4(8) is right
    /// that it cannot: it builds its own pipeline over the core's <c>_transport</c>/<c>_eventBus</c>/
    /// <c>_unsPublisher</c>. It moved whole; see <see cref="FleetCore.RunHotFolderAoiDemoAsync"/>.</summary>
    public Task<string> RunHotFolderAoiDemoAsync(CancellationToken ct) => _core.RunHotFolderAoiDemoAsync(ct);

    // ─────────────────────────────────────────────────────────────────────
    // SYNC-CONFIG — stayed here: it takes no lock, and the only core state it needs is the MachineState the
    // core hands out. Byte-identical to the pre-E-2 body, reading through FleetCore.TryGetMachineState/
    // FleetCore.Transport instead of the fields those two now front.
    // ─────────────────────────────────────────────────────────────────────
    public async Task<SyncConfigResponse?> SyncConfigAsync(string code, CancellationToken ct)
    {
        if (!_core.TryGetMachineState(code, out var state)) return null;

        try
        {
            var result = await _core.Transport.SyncConfigAsync(state.Code, ConfigKind, state.CachedConfigVersion, ct).ConfigureAwait(false);
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
    // SETTINGS / MODE / PROBE
    // ─────────────────────────────────────────────────────────────────────
    public SettingsDto GetSettings() => FleetProjections.ToSettingsDto(_core.GetSettings());

    public SettingsDto UpdateSettings(SettingsUpdateRequest request) =>
        FleetProjections.ToSettingsDto(
            _core.UpdateSettings(request.ServerUrl, request.VerifyTls, request.Language, request.MachineCode));

    public Task<ProbeResult> ProbeAsync(string serverUrl, CancellationToken ct) => _probe.ProbeAsync(serverUrl, ct);

    /// <summary>Forwards the mode to BOTH coordinators, in the same order as before the cut: the transport
    /// coordinator (now via <see cref="FleetCore.ApplyMode"/>) and then the config-sync coordinator, which
    /// stays here. Neither call takes a lock.</summary>
    public void ApplyMode(TransportMode mode)
    {
        _core.ApplyMode(mode);
        _configSyncCoordinator?.ApplyMode(mode);
    }
}
