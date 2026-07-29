using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;
using St4i.EdgeCore.Drivers;
using St4i.Connector.Abstractions;
using St4i.EdgeCore.Drivers.Simulators;
using St4i.EdgeCore.Engine;
using St4i.EdgeCore.Infrastructure;
using St4i.EdgeCore.Mapping;
using St4i.EdgeCore.Models;
using St4i.Connector.Abstractions.Models;
using St4i.EdgeCore.Transport;

namespace St4i.EdgeService;

/// <summary>
/// Task 21 — the headless seam: proves the EdgeCore driver→normalize→transport pipeline runs as a
/// plain <see cref="BackgroundService"/> with NO UI, reusing exactly the same St4i.EdgeCore engine
/// the WPF app's <c>FleetService</c> drives (<see cref="SimulatedDriver"/>/<see cref="EdgePipeline"/>/
/// <see cref="DemoTransport"/> unchanged, <see cref="SimulatorFactory"/> shared with it) — this is the
/// "evolves into production middleware" proof: the identical pipeline that backs the exhibition kiosk
/// can also run unattended as a Windows service. This project deliberately does NOT reference the WPF
/// project or any WPF assembly.
///
/// Fleet source: <c>--fleet &lt;path&gt;</c> via <see cref="FleetConfig.Load"/> if
/// <see cref="EdgeServiceOptions.FleetPath"/> is given AND the file exists AND parses with entries — see
/// <see cref="LoadFleet"/>. Falling back to the small fixed in-code default (<see cref="BuildDefaultFleet"/>,
/// 8 <see cref="IMachineSimulator"/> types across all 3 <see cref="DeviceClass"/> values) for a blank/
/// missing/malformed/empty <c>--fleet</c> is now demo-mode-ONLY (SM-1b,
/// .superpowers/sdd/2026-07-29-dotA-single-machine-sellable-blueprint/task-1b-brief.md): a real product
/// deployment (the default — <c>ST4I_DEMO_ENABLED</c> unset) gets an EMPTY roster in that same situation
/// instead, never fabricated machines piped to a real Live transport endpoint.
///
/// <c>--smoke N</c>: <see cref="EdgeServiceOptions.SmokeCount"/> counts
/// <see cref="EdgePipeline.Committed"/> events; once N is reached, this cancels the pipeline's own
/// linked token immediately (rather than waiting for the host's full shutdown timeout, which would
/// leave <see cref="SimulatedDriver.ReadAsync"/> potentially blocked mid-<c>Task.Delay</c> for a slow
/// sim's cadence) and asks <see cref="IHostApplicationLifetime"/> to stop the host —
/// <see cref="ExecuteAsync"/> then returns normally (the expected <see cref="OperationCanceledException"/>
/// from that self-cancel is swallowed, the same contract <see cref="EdgePipeline.RunAsync"/> documents
/// for cancellation), so the process exits 0. With no <c>--smoke</c>, the pipeline runs until the
/// host's own <c>stoppingToken</c> is cancelled (Ctrl-C / service stop) — the normal Generic Host
/// shutdown path, no special handling needed here.
/// </summary>
public sealed class EdgeWorker : BackgroundService
{
    /// <summary>Task F1-2 — Live-path connection settings, read directly from the process environment
    /// (no <see cref="EdgeServiceOptions"/> field: those are CLI-arg-driven, these are launch-env-driven,
    /// same split as <see cref="TransportModeGate"/>/<see cref="St4i.EdgeCore.Transport.WalOptions"/>'s
    /// own <c>FromEnvironment</c> idiom).</summary>
    internal const string ServerUrlEnvVar = "ST4I_SERVER_URL";
    internal const string MachineCodeEnvVar = "ST4I_MACHINE_CODE";
    internal const string VerifyTlsEnvVar = "ST4I_VERIFY_TLS";

    /// <summary>Same placeholder server URL as St4iMachineSimulator's <c>App.xaml.cs</c> and
    /// St4i.EngineApi's <c>FleetHost.DefaultServerUrl</c> — a local engine listening on its default port,
    /// overridable via <see cref="ServerUrlEnvVar"/> once a real deployment target is known.</summary>
    internal const string DefaultServerUrl = "http://localhost:5000";

    /// <summary>EdgeService did not previously have a default machine identity (it always ran the
    /// whole in-code fleet through a single shared <see cref="DemoTransport"/> that never cared about
    /// machine identity). Live mode's <see cref="LiveTransport"/> binds to exactly ONE machine/mk_ key
    /// (see LiveTransport's own doc comment), so this task introduces one small placeholder default —
    /// same idea as App.xaml.cs's <c>PlaceholderMachineCode</c>/FleetHost's <c>DefaultMachineCode</c> —
    /// overridable via <see cref="MachineCodeEnvVar"/>.</summary>
    internal const string DefaultMachineCode = "EDGE-SVC-01";

    private readonly ILogger<EdgeWorker> _logger;
    private readonly IHostApplicationLifetime _lifetime;
    private readonly EdgeServiceOptions _options;

    /// <summary>SM-1b (.superpowers/sdd/2026-07-29-dotA-single-machine-sellable-blueprint/task-1b-brief.md)
    /// — the SAME demo/product decision <see cref="BuildLiveOrDemoTransport"/> already made for the
    /// Live/Demo TRANSPORT choice, now ALSO consulted by <see cref="LoadFleet"/> for the fleet SOURCE:
    /// before this task, <see cref="LoadFleet"/> had no gate at all and unconditionally fabricated 8
    /// machines whenever <c>--fleet</c> was blank/missing/malformed — worse than St4i.EngineApi's
    /// pre-SM-1 <c>FleetHost</c>, because nothing here sandboxed that fabricated data from a real Live
    /// transport endpoint.
    ///
    /// Optional (defaults <see langword="null"/>) so every pre-existing test/call site that constructs
    /// <see cref="EdgeWorker"/> directly without one keeps compiling and behaving byte-for-byte
    /// unchanged: <see langword="null"/> is treated as demo mode by <see cref="LoadFleet"/>, exactly like
    /// <see cref="St4i.EngineApi.Fleet.FleetHost"/>'s own <c>_demoModeGate</c> field treats a null
    /// <c>DemoModeGate</c> as demo. Production (<c>Program.cs</c>) never leaves this null: it registers
    /// the fully-resolved gate (raw <c>ST4I_DEMO_ENABLED</c> + <see cref="ResolveGate"/>'s own
    /// <c>--smoke</c> CI-path default) as a DI singleton, so a bare <c>--smoke N</c> run (README §9, no
    /// env var set) keeps getting the demo fleet it always has, while a real product deployment (env var
    /// absent, no <c>--smoke</c>) never fabricates one.
    ///
    /// Reused (not duplicated) by <see cref="BuildLiveOrDemoTransport"/> too, so the fleet source and the
    /// transport can never disagree about demo-vs-product for a single run — see that method's own
    /// remarks.
    ///
    /// This project reuses its OWN <see cref="TransportModeGate"/> rather than
    /// <c>St4i.EngineApi.Config.DemoModeGate</c> — a real ProjectReference in that direction was tried and
    /// fails at restore (NU1605 package-downgrade: EdgeService pins <c>Microsoft.Extensions.Hosting</c>
    /// 9.0.0, EngineApi transitively requires &gt;= 10.0.10 via its Windows-service package, and EngineApi
    /// is also an ASP.NET Core <c>Microsoft.NET.Sdk.Web</c> host with a hard publish-time dependency on the
    /// built web UI) — see <see cref="TransportModeGate"/>'s own doc comment for the full writeup.</summary>
    private readonly TransportModeGate? _demoModeGate;

    public EdgeWorker(
        ILogger<EdgeWorker> logger,
        IHostApplicationLifetime lifetime,
        EdgeServiceOptions options,
        TransportModeGate? demoModeGate = null)
    {
        _logger = logger ?? throw new ArgumentNullException(nameof(logger));
        _lifetime = lifetime ?? throw new ArgumentNullException(nameof(lifetime));
        _options = options ?? throw new ArgumentNullException(nameof(options));
        _demoModeGate = demoModeGate;
    }

    /// <summary>SM-1b — the process exit code when a <c>--smoke N</c> run's roster is empty (see
    /// <see cref="ExecuteAsync"/>'s early-return branch): distinct from 0 (success) so CI notices a broken
    /// smoke run instead of reading either a hang or a false pass. Not claimed to match any external
    /// convention — just "not zero."</summary>
    internal const int SmokeEmptyRosterExitCode = 1;

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        var fleet = LoadFleet();
        _logger.LogInformation(
            "EdgeWorker starting — {Count} machine(s): {Codes}{SmokeSuffix}",
            fleet.Count,
            string.Join(", ", fleet.Select(d => d.Code)),
            _options.SmokeCount is int n ? $" (smoke mode: stop after {n} commits)" : "");

        if (fleet.Count == 0)
        {
            if (_options.SmokeCount is int smokeTarget)
            {
                // SM-1b — a --smoke run's whole contract is "commit N readings, then exit 0" (README §9's
                // CI path); with zero machines nothing can ever commit, so that bound can never be
                // reached. Hanging until externally killed would wedge a CI job forever, and silently
                // returning (exit 0) would report a smoke test as PASSED when it never actually exercised
                // the pipeline at all — both worse than a loud, immediate, non-zero failure naming exactly
                // why.
                _logger.LogError(
                    "--smoke {N} requires at least one machine to ever commit a reading, but the roster is " +
                    "empty (product mode with no usable --fleet configured) — exiting with a non-zero code " +
                    "instead of hanging indefinitely or reporting a false pass.",
                    smokeTarget);
                Environment.ExitCode = SmokeEmptyRosterExitCode;
                _lifetime.StopApplication();
                return;
            }

            // SM-1b — an empty roster is a genuine, supported running state (a product deployment with no
            // machine configured yet), not an error. StopApplication() is required here even though
            // nothing failed: a BackgroundService's ExecuteAsync completing on its own does NOT stop the
            // Generic Host by itself — nothing else in an empty-roster run ever calls StopApplication
            // (the smoke branch above is the only other caller, and OnCommitted below never fires with no
            // pipeline to run) — without this the process would hang forever waiting for an external
            // Ctrl-C/service-stop that a headless empty-roster deployment may never receive in time.
            _logger.LogWarning("Fleet is empty — nothing to run. EdgeWorker exiting.");
            _lifetime.StopApplication();
            return;
        }

        var sims = fleet.Select((d, i) => SimulatorFactory.Create(d, seed: 2000 + i)).ToList();
        IDeviceDriver driver = new SimulatedDriver(sims);
        var profile = new MappingProfile { Name = "edge-service-fleet", DeviceClass = "Mixed" };
        var eventBus = new EventBus();
        var transport = BuildLiveOrDemoTransport();
        var pipeline = new EdgePipeline(driver, profile, transport, eventBus);

        // Linked (not just stoppingToken) so a reached --smoke count can unwind RunAsync immediately
        // instead of waiting on the host's own (slower, externally-driven) shutdown sequence.
        using var localCts = CancellationTokenSource.CreateLinkedTokenSource(stoppingToken);
        var commitCount = 0;

        void OnCommitted(DeviceReading reading, TransportAck ack)
        {
            commitCount++;
            _logger.LogInformation(
                "commit #{Count} machine={MachineCode} kind={Kind} verdict={Verdict} ack.success={Success} ack.id={AckId} ack.status={AckStatus}",
                commitCount, reading.MachineCode, reading.Kind, reading.Verdict, ack.Success, ack.Id, ack.HttpStatus);

            if (_options.SmokeCount is int smokeTarget && commitCount >= smokeTarget)
            {
                _logger.LogInformation("smoke target of {N} commit(s) reached — stopping host", smokeTarget);
                localCts.Cancel();
                _lifetime.StopApplication();
            }
        }

        pipeline.Committed += OnCommitted;
        try
        {
            await pipeline.RunAsync(localCts.Token).ConfigureAwait(false);
        }
        catch (OperationCanceledException)
        {
            // Expected: either the host's own stoppingToken (Ctrl-C / service stop) or this worker's
            // own smoke-count self-cancel above — neither is a failure.
        }
        finally
        {
            pipeline.Committed -= OnCommitted;
        }

        // WS-C precedent (LiveTransport.Dispose's own remarks: it owns an HttpClient) — a Live-mode
        // transport built by BuildTransport needs disposing once the pipeline is done with it; a
        // DemoTransport has nothing to release, hence the type check rather than an unconditional cast.
        if (transport is IDisposable disposableTransport)
        {
            disposableTransport.Dispose();
        }

        _logger.LogInformation("EdgeWorker stopped after {Count} commit(s)", commitCount);
    }

    /// <summary>Resolves this run's Live-path connection settings from the process environment and
    /// delegates to the fully-explicit, unit-testable <see cref="BuildTransport"/>. Kept as a thin
    /// instance-method seam so <see cref="ExecuteAsync"/> stays a one-line call, while every actual
    /// decision (gate/queuePath/logging) lives in the static method the test project exercises directly.</summary>
    private ITransport BuildLiveOrDemoTransport()
    {
        // SM-1b — reuse the SAME resolved gate _demoModeGate already threads through LoadFleet
        // (constructor-injected in production, see that field's own remarks) rather than recomputing it
        // from scratch, so the transport and the fleet source can never disagree about demo-vs-product
        // for a single run. Falls back to resolving fresh only when no gate was supplied — no production
        // or test call site does that today, but every pre-existing EdgeWorker construction still
        // compiles/behaves unchanged either way.
        var gate = _demoModeGate
            ?? ResolveGate(_options.SmokeCount, Environment.GetEnvironmentVariable(TransportModeGate.EnvVarName));

        var serverUrlRaw = Environment.GetEnvironmentVariable(ServerUrlEnvVar);
        var serverUrl = string.IsNullOrWhiteSpace(serverUrlRaw) ? DefaultServerUrl : serverUrlRaw;

        var machineCodeRaw = Environment.GetEnvironmentVariable(MachineCodeEnvVar);
        var machineCode = string.IsNullOrWhiteSpace(machineCodeRaw) ? DefaultMachineCode : machineCodeRaw;

        var verifyTls = ParseVerifyTls(Environment.GetEnvironmentVariable(VerifyTlsEnvVar));

        // C-1 (WS-C final-review fix wave, same lesson St4i.EngineApi/Program.cs and App.xaml.cs already
        // apply) — WalOptions.FromEnvironment() only resolves knobs; BuildTransport itself is what calls
        // EnsureDir() before ever handing a queuePath to LiveTransport.ForMachine.
        var wal = WalOptions.FromEnvironment();

        // Skip the real %ProgramData%\ST4I\sim\creds disk read entirely when we're about to hand back a
        // DemoTransport anyway — it would just be discarded, and a not-yet-onboarded/Demo-only box may
        // never have a creds directory at all.
        var mkKey = gate.Enabled ? null : CredentialStore.Load(machineCode);

        return BuildTransport(gate, serverUrl, machineCode, verifyTls, wal, mkKey, _logger);
    }

    /// <summary>Task F1-2 — the effective <see cref="TransportModeGate"/> for one run. An explicit
    /// <see cref="TransportModeGate.EnvVarName"/> (any non-blank value, including an explicit "false")
    /// always wins. Only when the operator has NOT set it at all does a <c>--smoke</c> run (README §9's
    /// CI path) fall back to Demo — keeps `St4i.EdgeService --fleet fleet.json --smoke N` exactly as
    /// fast/deterministic as it always was (no real network dial-out, no CI script changes required)
    /// while a bare (no <c>--smoke</c>) launch gets this task's new product default of Live.</summary>
    internal static TransportModeGate ResolveGate(int? smokeCount, string? demoEnabledRaw) =>
        smokeCount is not null && string.IsNullOrWhiteSpace(demoEnabledRaw)
            ? new TransportModeGate("true")
            : new TransportModeGate(demoEnabledRaw);

    /// <summary>Task F1-2 — gate-driven Live/Demo selection, fully explicit-parameter (no
    /// <see cref="Environment"/> reads, no real credential-store I/O) so <c>St4i.EdgeService.Tests</c>
    /// can exercise every branch directly. <paramref name="gate"/><c>.Enabled</c> → unchanged
    /// <see cref="DemoTransport"/> behavior. Otherwise (the product default) → <see cref="LiveTransport"/>:
    /// creates the WAL directory (WS-C's Critical lesson — <see cref="WalOptions.EnsureDir"/> — a fresh
    /// install has never created it, and the SDK's own Enqueue does not create missing parents) before
    /// ever resolving a queue file, exactly like <c>TransportCoordinator.RebuildLive</c>'s own precedent.
    /// <paramref name="mkKey"/> may be <see langword="null"/> (no credential saved yet) — the resulting
    /// <see cref="LiveTransport"/> just fails sends gracefully until one exists (see LiveTransport's own
    /// St4iConfigException handling), which is fine for a not-yet-onboarded box. Logs the resolved mode +
    /// machineCode + WAL on/off — deliberately never logs <paramref name="mkKey"/> itself.</summary>
    internal static ITransport BuildTransport(
        TransportModeGate gate,
        string serverUrl,
        string machineCode,
        bool verifyTls,
        WalOptions wal,
        string? mkKey,
        ILogger logger)
    {
        if (gate.Enabled)
        {
            logger.LogInformation(
                "Transport mode: DEMO ({EnvVar} set) — machine={MachineCode}",
                TransportModeGate.EnvVarName, machineCode);
            return new DemoTransport();
        }

        string? queuePath = null;
        if (wal.Enabled)
        {
            wal.EnsureDir();
            queuePath = wal.ResolveQueueFile(machineCode);
        }

        logger.LogInformation(
            "Transport mode: LIVE — machine={MachineCode} server={ServerUrl} verifyTls={VerifyTls} wal={WalEnabled} credential={CredentialState}",
            machineCode, serverUrl, verifyTls, wal.Enabled, mkKey is null ? "missing" : "present");

        return LiveTransport.ForMachine(serverUrl, mkKey ?? string.Empty, machineCode, queuePath, verifyTls);
    }

    /// <summary>"false"/"0" (case-insensitive) disables TLS verification; unset/blank/anything else
    /// leaves it enabled — same default-enabled, explicit-opt-out idiom as
    /// <see cref="WalOptions.EnvVarEnabled"/>'s own parsing in <see cref="WalOptions.FromEnvironment"/>.</summary>
    private static bool ParseVerifyTls(string? raw)
    {
        if (string.IsNullOrWhiteSpace(raw)) return true;
        var trimmed = raw.Trim();
        return !(trimmed == "0" || string.Equals(trimmed, "false", StringComparison.OrdinalIgnoreCase));
    }

    /// <summary>GP-3 — <c>internal</c> (not <c>private</c>), same "deliberately testable seam" convention
    /// as <see cref="BuildTransport"/>/<see cref="ResolveGate"/> above: reachable from
    /// <c>St4i.EdgeService.Tests</c> via this assembly's <c>AssemblyInfo.cs</c>
    /// <c>InternalsVisibleTo("St4i.EdgeService.Tests")</c>, so the fix below (a missing
    /// <c>catch (FleetConfigException)</c> — every other <see cref="FleetConfig.Load"/> caller in this
    /// codebase already had one; this was the one loader that could still take the whole process down
    /// over a hand-editing mistake) has a direct regression test instead of only being
    /// integration-covered by a full process run.
    ///
    /// <para>SM-1b (.superpowers/sdd/2026-07-29-dotA-single-machine-sellable-blueprint/task-1b-brief.md) —
    /// <see cref="_demoModeGate"/> now decides what happens when <c>--fleet</c> is blank, missing,
    /// malformed, or parses to zero entries: <see langword="null"/> (every pre-existing call site) or an
    /// ENABLED gate keeps this method's ORIGINAL behavior byte-identical (falls back to
    /// <see cref="BuildDefaultFleet"/>) — the demo fleet must never regress. A non-null, DISABLED gate (a
    /// real product deployment) makes that same situation yield an EMPTY roster instead — never the
    /// fabricated fleet, which is exactly the defect this task exists to close (see the class doc comment:
    /// unlike this fabricated fleet, a real Live transport endpoint is not sandboxed the way
    /// St4i.EngineApi's Demo/Live split sandboxes <c>FleetHost</c>'s own roster).</para>
    ///
    /// <para>Deliberately DIFFERENT from <c>FleetHost.ResolveFleet</c> in one respect: a <c>--fleet</c>
    /// file that actually PARSES and has entries is honored in EITHER mode, not demo-only. <c>FleetHost</c>
    /// can afford to treat a valid fleet.json as demo-only because St4i.EngineApi has a SECOND,
    /// genuinely-real-machine path (connectors.json + <c>RegisterMachine</c>) that product mode uses
    /// instead. EdgeService has no such second path — <c>--fleet</c> is the ONLY roster input this project
    /// has — so making it demo-only too would leave a product deployment permanently unable to run any
    /// machine at all, the opposite of this task's goal. Only the FABRICATION fallback
    /// (blank/missing/malformed/empty) is gated by <see cref="_demoModeGate"/>; a real, valid file's
    /// content never is.</para></summary>
    internal IReadOnlyList<MachineDescriptor> LoadFleet()
    {
        var demoMode = _demoModeGate is null || _demoModeGate.Enabled;
        var path = _options.FleetPath;

        if (string.IsNullOrWhiteSpace(path))
        {
            return demoMode ? BuildDefaultFleet() : Array.Empty<MachineDescriptor>();
        }

        if (!File.Exists(path))
        {
            if (demoMode)
            {
                _logger.LogWarning("--fleet path {Path} not found — falling back to default in-code fleet", path);
                return BuildDefaultFleet();
            }

            _logger.LogWarning(
                "Product mode: --fleet path '{Path}' not found — the roster starts empty rather than " +
                "substituting the fabricated demo fleet. Point --fleet at a real fleet.json-shaped file " +
                "describing your machine(s).",
                path);
            return Array.Empty<MachineDescriptor>();
        }

        _logger.LogInformation("Loading fleet from {Path}", path);
        try
        {
            // GP-3 fix: this catch did not exist before — every other FleetConfig.Load caller
            // (St4i.EngineApi's FleetHost, St4iMachineSimulator's FleetService) already treats a
            // genuinely unparseable fleet.json as "fall back to the in-code default", never an unhandled
            // startup crash. Without it, a malformed --fleet file would throw FleetConfigException
            // straight out of this BackgroundService's ExecuteAsync, which by default stops the whole
            // Generic Host — the one loader of the three that could actually take the process down over
            // a hand-editing mistake. logWarning (per-entry tolerance — a malformed INDIVIDUAL machine
            // entry, as opposed to the whole file) is wired the same way FleetHost wires it to its own
            // ILogger.
            var loaded = FleetConfig.Load(path, logWarning: msg => _logger.LogWarning("{FleetConfigWarning}", msg));

            // SM-1b — a file that parses and has entries is real configuration in EITHER mode; see this
            // method's own doc comment for why (EdgeService has no connectors.json-equivalent second
            // path).
            if (loaded.Count > 0) return loaded;
        }
        catch (FleetConfigException ex)
        {
            if (demoMode)
            {
                _logger.LogWarning(ex, "Malformed fleet.json at '{Path}' — falling back to the in-code default fleet", path);
                return BuildDefaultFleet();
            }

            _logger.LogWarning(
                ex,
                "Product mode: --fleet at '{Path}' is malformed — the roster starts empty rather than " +
                "substituting the fabricated demo fleet. Fix the file or point --fleet elsewhere.",
                path);
            return Array.Empty<MachineDescriptor>();
        }

        // Parsed fine but zero entries — same "no real content" outcome as a missing file.
        return demoMode ? BuildDefaultFleet() : Array.Empty<MachineDescriptor>();
    }

    /// <summary>The headless default roster — one machine per <see cref="IMachineSimulator"/> type
    /// (8 machines spanning Automation/Iot/AoiAvi), at cadences fast enough for a quick
    /// <c>--smoke</c> run yet still visibly staggered when run unattended with no args.</summary>
    internal static IReadOnlyList<MachineDescriptor> BuildDefaultFleet() =>
    [
        new("SCRW-01", "SN-SCRW01", DeviceClass.Automation, "SCREWDRIVE", "screw_tightening", DriverKinds.Simulated, "RC-SCRW-A", null, 0.3),
        new("DISP-01", "SN-DISP01", DeviceClass.Automation, "DISPENSING", "glue_dispense", DriverKinds.Simulated, "RC-DISP-A", null, 0.35),
        new("WELD-01", "SN-WELD01", DeviceClass.Automation, "WELDER", "spot_weld", DriverKinds.Simulated, "RC-WELD-A", null, 0.32),
        new("ASSY-01", "SN-ASSY01", DeviceClass.Automation, "ASSEMBLY", "press_fit", DriverKinds.Simulated, "RC-ASSY-A", null, 0.28),
        new("LEAK-01", "SN-LEAK01", DeviceClass.Automation, "LEAK_TEST", "leak_test", DriverKinds.Simulated, "RC-LEAK-A", null, 0.4),
        new("FCT-01", "SN-FCT01", DeviceClass.Automation, "FUNCTIONAL_TEST", "functional_test", DriverKinds.Simulated, "RC-FCT-A", null, 0.38),
        new("IOT-01", "SN-IOT01", DeviceClass.Iot, "IOT_SENSOR", "telemetry", DriverKinds.Simulated, null, null, 0.2),
        new("AOI-01", "SN-AOI01", DeviceClass.AoiAvi, "AOI", "inspection", DriverKinds.Simulated, "RC-AOI-A", null, 0.5),
    ];
}
