using St4i.EdgeCore.Config;
using St4i.EdgeCore.Models;
using St4i.Connector.Abstractions.Models;

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
/// Task 3 (docs/plans/2026-07-21-machine-config.md): the optional <c>configStore</c>/
/// <c>currentProductCode</c> parameters are threaded into whichever simulators Task 3 wired
/// for live config (Screwdrive/Iot/Aoi today) so their generated values/cadence track
/// <see cref="MachineConfigStore"/> — omitted (both default null), every simulator behaves exactly as it
/// did before this task, which is what keeps every pre-existing call site/test unaffected.
/// </summary>
public static class SimulatorFactory
{
    /// <param name="d">The roster entry to build a model for; null raises <see cref="ArgumentNullException"/>,
    /// and it is the only argument checked. Dispatch reads <see cref="MachineDescriptor.MachineType"/>
    /// trimmed and upper-cased, then <see cref="MachineDescriptor.DeviceClass"/>, and the fallback's own
    /// fallback is <see cref="ScrewdriveSim"/> — so an unrecognised type on an
    /// <see cref="DeviceClass.Automation"/> machine becomes a screwdriver rather than an error, by the same
    /// "a stray entry must not take the fleet down" choice the class remarks describe.
    ///
    /// <para>🔴 <b>The type vocabulary read here and the one
    /// <see cref="MachineParameterSchema.ConfigKindForMachineType"/> reads are two independent lists, and
    /// they are not equal.</b> Measured at commit <c>5e194ab0</c> against that dictionary's own keys:
    /// <c>ASSEMBLY</c>, <c>LEAK_TEST</c> and <c>FUNCTIONAL_TEST</c> are known here and absent there — which
    /// that schema states about itself and treats as ordinary. Two more are not covered by that statement.
    /// <c>AOI_AVI</c> is accepted here and unknown there, so — when a <paramref name="configStore"/> is
    /// wired — such a machine gets an <see cref="AoiInspectorSim"/> whose constructor ensures and persists
    /// an <c>aoi_inspection</c> record, while <c>MachineSettingsEndpoints</c> answers "unsupported machine
    /// type" for that same machine because its own lookup returns null.
    /// <c>IOT_GATEWAY</c> is the mirror image — known there, no case here — and it reaches
    /// <see cref="IotSensorSim"/> only through the <see cref="DeviceClass.Iot"/> fallback, so a descriptor
    /// carrying that type with <see cref="DeviceClass.Automation"/> is built as a screwdriver instead.
    /// (<c>OnboardingFleetJoin</c> does pair <c>IOT_GATEWAY</c> with <see cref="DeviceClass.Iot"/>, so the
    /// onboarding path lands correctly; a hand-built or file-authored descriptor need not.)</para></param>
    /// <param name="seed">Forwarded unchanged to whichever simulator is built and used only by
    /// <c>SimulatorBase.Rng</c>; see that constructor's own <c>seed</c> note for the determinism it
    /// carries. Nothing here derives it from <paramref name="d"/>, so two machines handed the same value
    /// draw the same sequence.</param>
    /// <param name="configStore">Forwarded to the three CLASSES Task 3 wired —
    /// <see cref="ScrewdriveSim"/>, <see cref="IotSensorSim"/>, <see cref="AoiInspectorSim"/> — and to
    /// those alone, on both the machine-type arm and the device-class fallback. So it also reaches an
    /// unrecognised machine type, because the fallback's default builds a <see cref="ScrewdriveSim"/>.
    /// Handing one in for a WELDER, DISPENSING, ASSEMBLY, LEAK_TEST or FUNCTIONAL_TEST descriptor is
    /// accepted and then dropped by this switch: those five constructors take no store, so no
    /// <c>Ensure</c> happens and their readings are unaffected. Null (the default) is the pre-Task-3 path
    /// for every type.</param>
    /// <param name="currentProductCode">The fleet-wide "what is machine X running right now" callback,
    /// keyed by machine code. Bound down here to the per-machine <c>Func&lt;string?&gt;</c> each simulator's
    /// constructor takes, as a closure over <paramref name="d"/>.<see cref="MachineDescriptor.Code"/> — so
    /// the code captured is the one on the descriptor, not whatever a later caller might pass. Reaches the
    /// same three types as <paramref name="configStore"/>; null (the default) leaves every simulator's
    /// product lookup answering null.</param>
    /// <param name="cycleRateMultiplier">I-5 (mc-feature-review.md) — the active scenario's
    /// <c>CycleRateMultiplier</c> (1.0 = unscaled), threaded into whichever simulators define a
    /// config-derived <see cref="IMachineSimulator.CycleSecondsOverride"/> (Screwdrive/Iot today) so a
    /// scenario multiplier composes with a config-store cadence override instead of being silently
    /// ignored by it — see <see cref="ScrewdriveSim.CycleSecondsOverride"/>'s doc comment. AOI has no
    /// cadence override, so it needs no multiplier here — its cadence already comes entirely from
    /// <paramref name="d"/>.CycleSeconds, which the caller already pre-scales by this SAME multiplier before
    /// calling this factory. 🔴 Task J-1: that caller is <c>FleetCore.BuildStartPlan</c>, which runs with
    /// <c>FleetCore._gate</c> RELEASED — this factory reaches <c>MachineConfigStore.Ensure</c> through
    /// <c>SimulatorBase</c>'s ctor, i.e. a file WRITE, and that is why it was hoisted. <c>StartLocked</c> is
    /// still a caller, but only for a descriptor the plan did not already cover. Defaults to 1.0 (every pre-existing
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
