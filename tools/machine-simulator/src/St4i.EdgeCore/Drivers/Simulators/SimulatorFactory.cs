using St4i.EdgeCore.Models;

namespace St4i.EdgeCore.Drivers.Simulators;

/// <summary>
/// Task 21 — shared descriptor→<see cref="IMachineSimulator"/> factory, extracted from the WPF app's
/// <c>FleetService.BuildSimulator</c> (that method now delegates here) so the headless
/// <c>St4i.EdgeService</c> can build the exact same simulator roster without depending on the WPF
/// project — the whole point of the headless seam is that EdgeCore alone is enough.
///
/// Switches on <see cref="MachineDescriptor.MachineType"/> first (the authoritative signal), falling
/// back to <see cref="MachineDescriptor.DeviceClass"/> for any type string this build doesn't
/// recognize rather than throwing — keeps a stray/typo'd fleet.json-style entry from taking the whole
/// fleet down.
/// </summary>
public static class SimulatorFactory
{
    public static IMachineSimulator Create(MachineDescriptor d, int seed)
    {
        ArgumentNullException.ThrowIfNull(d);

        return (d.MachineType ?? "").Trim().ToUpperInvariant() switch
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
    }

    private static IMachineSimulator FallbackByDeviceClass(MachineDescriptor d, int seed) => d.DeviceClass switch
    {
        DeviceClass.Iot => new IotSensorSim(d, seed),
        DeviceClass.AoiAvi => new AoiInspectorSim(d, seed),
        _ => new ScrewdriveSim(d, seed),
    };
}
