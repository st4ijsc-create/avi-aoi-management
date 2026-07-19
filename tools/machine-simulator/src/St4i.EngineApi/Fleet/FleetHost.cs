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
    private readonly Dictionary<string, MachineState> _states;

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

    public FleetHost(SwitchableTransport transport, TransportCoordinator transportCoordinator, EventBus eventBus, ILogger<FleetHost>? logger = null)
    {
        _transport = transport ?? throw new ArgumentNullException(nameof(transport));
        _transportCoordinator = transportCoordinator ?? throw new ArgumentNullException(nameof(transportCoordinator));
        _eventBus = eventBus ?? throw new ArgumentNullException(nameof(eventBus));
        _logger = logger;

        Fleet = LoadFleet();
        _states = Fleet.ToDictionary(d => d.Code, d => new MachineState(d), StringComparer.OrdinalIgnoreCase);
    }

    public IReadOnlyList<MachineDescriptor> Fleet { get; }

    public ITransport Transport => _transport;

    public bool IsRunning { get; private set; }

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
    public void Start()
    {
        lock (_gate) StartLocked();
    }

    public void Stop()
    {
        lock (_gate) StopLocked();
    }

    private void StartLocked()
    {
        if (IsRunning) return;
        LastError = null;

        var multiplier = _scenario.CycleRateMultiplier > 0 ? _scenario.CycleRateMultiplier : 1.0;
        var effectiveFleet = Math.Abs(multiplier - 1.0) < 1e-9
            ? Fleet
            : Fleet.Select(d => d with { CycleSeconds = Math.Max(MinCycleSeconds, d.CycleSeconds / multiplier) }).ToList();

        var sims = effectiveFleet.Select((d, i) => SimulatorFactory.Create(d, seed: 1000 + i)).ToList();
        IDeviceDriver driver = new ScenarioAwareDriver(new SimulatedDriver(sims), () => _scenario);

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
                LastError = ex;
                IsRunning = false;
                _logger?.LogError(ex, "FleetHost pipeline faulted");
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

        if (_currentPipeline is not null)
        {
            _currentPipeline.Committed -= OnPipelineCommitted;
            _currentPipeline = null;
        }
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
        var machines = _states.Values
            .OrderBy(s => s.Code, StringComparer.Ordinal)
            .Select(s => s.ToTile())
            .ToList();

        var online = machines.Count(m => m.Cycles > 0);
        var totalCycles = Interlocked.Read(ref _totalCycles);
        double fpy;
        lock (_kpiGate)
        {
            fpy = _totalJudged == 0 ? 0.0 : (double)_totalPass / _totalJudged;
        }

        // M-3: IsRunning is only ever WRITTEN under _gate (StartLocked/StopLocked) — read it under the
        // same lock here too (a GET can land on a different thread than whichever POST last flipped it)
        // rather than relying on an unsynchronized read of a plain, non-volatile bool.
        bool isRunning;
        lock (_gate)
        {
            isRunning = IsRunning;
        }

        return new FleetSnapshotDto(machines, new FleetKpisDto(online, totalCycles, fpy), isRunning);
    }

    public MachineDetailDto? MachineDetail(string code) =>
        _states.TryGetValue(code, out var state) ? state.ToDetail() : null;

    // ─────────────────────────────────────────────────────────────────────
    // SCENARIO
    // ─────────────────────────────────────────────────────────────────────
    public ScenarioDto ApplyScenario(ScenarioConfig config, string? presetName = null)
    {
        ArgumentNullException.ThrowIfNull(config);

        lock (_gate)
        {
            var previous = _scenario;
            _scenario = config;
            _activePresetName = presetName ?? "custom";

            ApplyNetworkOutageLocked(config.NetworkOutage);

            var multiplierChanged = Math.Abs(config.CycleRateMultiplier - previous.CycleRateMultiplier) > 1e-9;
            if (IsRunning && multiplierChanged)
            {
                StopLocked();
                StartLocked();
            }
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
        }

        return GetSettings();
    }

    public Task<ProbeResult> ProbeAsync(string serverUrl, CancellationToken ct) => _probe.ProbeAsync(serverUrl, ct);

    public void ApplyMode(TransportMode mode) => _transportCoordinator.ApplyMode(mode);

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
