using St4i.EdgeCore.Drivers;
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
/// </summary>
public sealed class FleetService : IDisposable
{
    private readonly ITransport _transport;
    private readonly EventBus _eventBus;

    private CancellationTokenSource? _cts;
    private Task? _runTask;

    public FleetService(ITransport transport, EventBus eventBus)
    {
        _transport = transport ?? throw new ArgumentNullException(nameof(transport));
        _eventBus = eventBus ?? throw new ArgumentNullException(nameof(eventBus));
        Fleet = BuildDefaultFleet();
    }

    /// <summary>The fixed roster this build ships with — 2×SCREWDRIVE, 1×DISPENSING, 1×WELDER,
    /// 1×ASSEMBLY, 1×LEAK_TEST, 1×FUNCTIONAL_TEST, 1×IOT_SENSOR, 2×AOI (10 machines, mixing all 3
    /// <see cref="DeviceClass"/> values), at lively-but-readable cadences (&lt;2s each) so the
    /// dashboard visibly updates during a live demo.</summary>
    public IReadOnlyList<MachineDescriptor> Fleet { get; }

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

    /// <summary>
    /// Builds a fresh <see cref="SimulatedDriver"/> (new simulator instances, so per-machine cycle
    /// counters restart at 1 — <see cref="SimulatedDriver"/> itself is stateful and single-use) and
    /// runs its <see cref="EdgePipeline"/> on a background <see cref="Task"/>. A no-op if already
    /// running.
    /// </summary>
    public void Start()
    {
        if (IsRunning) return;

        LastError = null;
        var sims = Fleet.Select((d, i) => BuildSimulator(d, seed: 1000 + i)).ToList();
        var driver = new SimulatedDriver(sims);
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

    /// <summary>Cancels the running pipeline. A no-op if not running. Deliberately does not await or
    /// Dispose the <see cref="CancellationTokenSource"/> here: the background pipeline task may still
    /// be inside an await referencing its token (e.g. the driver's pacing <c>Task.Delay</c>), and
    /// disposing a CTS while a wait against its token is in flight is a documented race — letting the
    /// GC reclaim it once that in-flight await observes cancellation and unwinds is simpler and safe
    /// for this exhibition tool.</summary>
    public void Stop()
    {
        if (!IsRunning) return;

        _cts?.Cancel();
        _cts = null;
        _runTask = null;
        IsRunning = false;
    }

    public void Dispose() => Stop();

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
