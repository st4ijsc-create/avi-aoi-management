using St4i.EdgeCore.Config;
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
///
/// Task 3 (docs/plans/2026-07-21-machine-config.md): the optional <paramref name="configStore"/>/
/// <paramref name="currentProductCode"/> parameters are threaded into whichever simulators Task 3 wired
/// for live config (Screwdrive/Iot/Aoi today) so their generated values/cadence track
/// <see cref="MachineConfigStore"/> — omitted (both default null), every simulator behaves exactly as it
/// did before this task, which is what keeps every pre-existing call site/test unaffected.
/// </summary>
public static class SimulatorFactory
{
    public static IMachineSimulator Create(
        MachineDescriptor d, int seed, MachineConfigStore? configStore = null, Func<string, string?>? currentProductCode = null)
    {
        ArgumentNullException.ThrowIfNull(d);

        // Bind the fleet-wide "what product is machine X running right now" callback down to the
        // per-machine Func<string?> shape each simulator's constructor expects.
        Func<string?>? productCodeProvider = currentProductCode is null ? null : () => currentProductCode(d.Code);

        return (d.MachineType ?? "").Trim().ToUpperInvariant() switch
        {
            "SCREWDRIVE" => new ScrewdriveSim(d, seed, configStore, productCodeProvider),
            "DISPENSING" => new DispensingSim(d, seed),
            "WELDER" => new WelderSim(d, seed),
            "ASSEMBLY" => new AssemblySim(d, seed),
            "LEAK_TEST" => new LeakTestSim(d, seed),
            "FUNCTIONAL_TEST" => new FunctionalTestSim(d, seed),
            "IOT_SENSOR" => new IotSensorSim(d, seed, configStore, productCodeProvider),
            "AOI" or "AOI_AVI" or "AVI" => new AoiInspectorSim(d, seed, configStore: configStore, productCodeProvider: productCodeProvider),
            _ => FallbackByDeviceClass(d, seed, configStore, productCodeProvider),
        };
    }

    private static IMachineSimulator FallbackByDeviceClass(MachineDescriptor d, int seed, MachineConfigStore? configStore, Func<string?>? productCodeProvider) =>
        d.DeviceClass switch
        {
            DeviceClass.Iot => new IotSensorSim(d, seed, configStore, productCodeProvider),
            DeviceClass.AoiAvi => new AoiInspectorSim(d, seed, configStore: configStore, productCodeProvider: productCodeProvider),
            _ => new ScrewdriveSim(d, seed, configStore, productCodeProvider),
        };
}
