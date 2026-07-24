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
    /// <param name="cycleRateMultiplier">I-5 (mc-feature-review.md) — the active scenario's
    /// <c>CycleRateMultiplier</c> (1.0 = unscaled), threaded into whichever simulators define a
    /// config-derived <see cref="IMachineSimulator.CycleSecondsOverride"/> (Screwdrive/Iot today) so a
    /// scenario multiplier composes with a config-store cadence override instead of being silently
    /// ignored by it — see <see cref="ScrewdriveSim.CycleSecondsOverride"/>'s doc comment. AOI has no
    /// cadence override, so it needs no multiplier here — its cadence already comes entirely from
    /// <paramref name="d"/>.CycleSeconds, which the caller (<c>FleetHost.StartLocked</c>) already
    /// pre-scales by this SAME multiplier before calling this factory. Defaults to 1.0 (every pre-existing
    /// call site/test that doesn't pass one behaves exactly as before).</param>
    /// <param name="productConfigStore">WS3-T1 — optional (defaults null, every pre-existing call site
    /// unaffected) source for <see cref="AoiInspectorSim"/>'s real-product-points cycle plan; see its own
    /// <c>ResolveRealPoints</c> remarks. Ignored by every other machine type.</param>
    public static IMachineSimulator Create(
        MachineDescriptor d, int seed, MachineConfigStore? configStore = null, Func<string, string?>? currentProductCode = null,
        double cycleRateMultiplier = 1.0, ProductConfigStore? productConfigStore = null)
    {
        ArgumentNullException.ThrowIfNull(d);

        // Bind the fleet-wide "what product is machine X running right now" callback down to the
        // per-machine Func<string?> shape each simulator's constructor expects.
        Func<string?>? productCodeProvider = currentProductCode is null ? null : () => currentProductCode(d.Code);

        return (d.MachineType ?? "").Trim().ToUpperInvariant() switch
        {
            "SCREWDRIVE" => new ScrewdriveSim(d, seed, configStore, productCodeProvider, cycleRateMultiplier),
            "DISPENSING" => new DispensingSim(d, seed),
            "WELDER" => new WelderSim(d, seed),
            "ASSEMBLY" => new AssemblySim(d, seed),
            "LEAK_TEST" => new LeakTestSim(d, seed),
            "FUNCTIONAL_TEST" => new FunctionalTestSim(d, seed),
            "IOT_SENSOR" => new IotSensorSim(d, seed, configStore, productCodeProvider, cycleRateMultiplier),
            "AOI" or "AOI_AVI" or "AVI" => new AoiInspectorSim(d, seed, configStore: configStore, productCodeProvider: productCodeProvider, productConfigStore: productConfigStore),
            _ => FallbackByDeviceClass(d, seed, configStore, productCodeProvider, cycleRateMultiplier, productConfigStore),
        };
    }

    private static IMachineSimulator FallbackByDeviceClass(
        MachineDescriptor d, int seed, MachineConfigStore? configStore, Func<string?>? productCodeProvider,
        double cycleRateMultiplier, ProductConfigStore? productConfigStore) =>
        d.DeviceClass switch
        {
            DeviceClass.Iot => new IotSensorSim(d, seed, configStore, productCodeProvider, cycleRateMultiplier),
            DeviceClass.AoiAvi => new AoiInspectorSim(d, seed, configStore: configStore, productCodeProvider: productCodeProvider, productConfigStore: productConfigStore),
            _ => new ScrewdriveSim(d, seed, configStore, productCodeProvider, cycleRateMultiplier),
        };
}
