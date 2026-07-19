using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;
using St4i.EdgeCore.Drivers;
using St4i.EdgeCore.Drivers.Simulators;
using St4i.EdgeCore.Engine;
using St4i.EdgeCore.Infrastructure;
using St4i.EdgeCore.Mapping;
using St4i.EdgeCore.Models;
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
/// <see cref="EdgeServiceOptions.FleetPath"/> is given AND the file exists, else the small fixed
/// in-code default (<see cref="BuildDefaultFleet"/>) covering all 8 <see cref="IMachineSimulator"/>
/// types across all 3 <see cref="DeviceClass"/> values.
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
    private readonly ILogger<EdgeWorker> _logger;
    private readonly IHostApplicationLifetime _lifetime;
    private readonly EdgeServiceOptions _options;

    public EdgeWorker(ILogger<EdgeWorker> logger, IHostApplicationLifetime lifetime, EdgeServiceOptions options)
    {
        _logger = logger ?? throw new ArgumentNullException(nameof(logger));
        _lifetime = lifetime ?? throw new ArgumentNullException(nameof(lifetime));
        _options = options ?? throw new ArgumentNullException(nameof(options));
    }

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
            _logger.LogWarning("Fleet is empty — nothing to run. EdgeWorker exiting.");
            return;
        }

        var sims = fleet.Select((d, i) => SimulatorFactory.Create(d, seed: 2000 + i)).ToList();
        IDeviceDriver driver = new SimulatedDriver(sims);
        var profile = new MappingProfile { Name = "edge-service-fleet", DeviceClass = "Mixed" };
        var eventBus = new EventBus();
        var transport = new DemoTransport();
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

        _logger.LogInformation("EdgeWorker stopped after {Count} commit(s)", commitCount);
    }

    private IReadOnlyList<MachineDescriptor> LoadFleet()
    {
        var path = _options.FleetPath;
        if (string.IsNullOrWhiteSpace(path))
        {
            return BuildDefaultFleet();
        }

        if (!File.Exists(path))
        {
            _logger.LogWarning("--fleet path {Path} not found — falling back to default in-code fleet", path);
            return BuildDefaultFleet();
        }

        _logger.LogInformation("Loading fleet from {Path}", path);
        return FleetConfig.Load(path);
    }

    /// <summary>The headless default roster — one machine per <see cref="IMachineSimulator"/> type
    /// (8 machines spanning Automation/Iot/AoiAvi), at cadences fast enough for a quick
    /// <c>--smoke</c> run yet still visibly staggered when run unattended with no args.</summary>
    internal static IReadOnlyList<MachineDescriptor> BuildDefaultFleet() =>
    [
        new("SCRW-01", "SN-SCRW01", DeviceClass.Automation, "SCREWDRIVE", "screw_tightening", DriverKind.Simulated, "RC-SCRW-A", null, 0.3),
        new("DISP-01", "SN-DISP01", DeviceClass.Automation, "DISPENSING", "glue_dispense", DriverKind.Simulated, "RC-DISP-A", null, 0.35),
        new("WELD-01", "SN-WELD01", DeviceClass.Automation, "WELDER", "spot_weld", DriverKind.Simulated, "RC-WELD-A", null, 0.32),
        new("ASSY-01", "SN-ASSY01", DeviceClass.Automation, "ASSEMBLY", "press_fit", DriverKind.Simulated, "RC-ASSY-A", null, 0.28),
        new("LEAK-01", "SN-LEAK01", DeviceClass.Automation, "LEAK_TEST", "leak_test", DriverKind.Simulated, "RC-LEAK-A", null, 0.4),
        new("FCT-01", "SN-FCT01", DeviceClass.Automation, "FUNCTIONAL_TEST", "functional_test", DriverKind.Simulated, "RC-FCT-A", null, 0.38),
        new("IOT-01", "SN-IOT01", DeviceClass.Iot, "IOT_SENSOR", "telemetry", DriverKind.Simulated, null, null, 0.2),
        new("AOI-01", "SN-AOI01", DeviceClass.AoiAvi, "AOI", "inspection", DriverKind.Simulated, "RC-AOI-A", null, 0.5),
    ];
}
