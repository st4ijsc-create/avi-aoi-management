using St4i.EdgeCore.Config;
using St4i.EdgeCore.Drivers.Simulators;
using St4i.EdgeCore.Models;
using St4i.Connector.Abstractions.Models;
using Xunit;

/// <summary>
/// 🔴 Item 42, 2026-08-23 (BL-1) — <see cref="MachineParameterSchema.IsConsumedBySimulator"/> is a CLAIM
/// about the rest of the codebase, and a claim that only a doc comment carries is exactly what let
/// <c>weld_profile</c> and <c>dispense_program</c> be served as tunable machine settings for the whole life
/// of the feature while reaching no draw. This file makes it a measurement.
///
/// <para><b>How it measures.</b> For every machine type the schema maps to a kind, it builds that type's
/// simulator through the real <c>SimulatorFactory.Create</c> WITH a store, then asks the store whether a
/// record now exists for that machine code. A record can only appear because <c>SimulatorBase</c>'s
/// constructor called <see cref="MachineConfigStore.Ensure"/>, which it does only when the factory actually
/// handed the store down. So "a record exists" is a direct, mechanical reading of "the store reaches this
/// machine's simulator", taken through the real production path rather than by reflecting over constructor
/// signatures. 🔴 What that reading does NOT survive: the machine-type strings below are LITERALS, so
/// renaming a type in the schema's map without touching this file leaves a row measuring a machine type
/// that no longer exists — the <see cref="MachineParameterSchema.ConfigKindForMachineType"/> assertion in
/// each row is what turns that into a failure rather than a silent pass, and it is there for exactly
/// that.</para>
///
/// <para>🔴 <b>The ceiling, stated where the result appears.</b> This measures REACHABILITY of the store,
/// not the fate of each key. A kind can be reachable and still contain a parameter that reaches no draw —
/// <c>screw_program</c>'s <c>angleTarget</c> is exactly that, by <c>ScrewdriveSim</c>'s own admission. A
/// per-key instrument would be a different one and this is not it, so a green here must not be read as "every
/// declared parameter does something".</para>
/// </summary>
public class UnconsumedConfigKindsTests
{
    private static string TempDir() => Directory.CreateTempSubdirectory("st4i-unconsumed-kinds-").FullName;

    /// <summary>Every machine type in <c>MachineParameterSchema</c>'s own map, paired with the device class
    /// a real roster gives it — the fallback arm reads <see cref="DeviceClass"/> for any type the factory's
    /// switch does not name, and <c>IOT_GATEWAY</c> is precisely such a type.</summary>
    public static TheoryData<string, DeviceClass, string, bool> Kinds() => new()
    {
        { "SCREWDRIVE",      DeviceClass.Automation, MachineParameterSchema.ScrewProgram,    true  },
        { "IOT_SENSOR",      DeviceClass.Iot,        MachineParameterSchema.IotSettings,     true  },
        { "IOT_GATEWAY",     DeviceClass.Iot,        MachineParameterSchema.IotSettings,     true  },
        { "AOI",             DeviceClass.AoiAvi,     MachineParameterSchema.AoiInspection,   true  },
        { "AVI",             DeviceClass.AoiAvi,     MachineParameterSchema.AoiInspection,   true  },
        { "DISPENSING",      DeviceClass.Automation, MachineParameterSchema.DispenseProgram, false },
        { "WELDER",          DeviceClass.Automation, MachineParameterSchema.WeldProfile,     false },
    };

    /// <summary>The declared answer must equal the measured one, in BOTH directions — a kind claimed
    /// consumed whose store never arrives, and a kind claimed unconsumed whose store does, both redden this.
    /// The second direction is the one that matters most: the day somebody wires
    /// <c>DispensingSim</c>/<c>WelderSim</c> to a store, this test fails and forces the doc comments, the
    /// REST push message and item 42's record to be corrected in the same change rather than drifting.</summary>
    [Theory]
    [MemberData(nameof(Kinds))]
    public void The_declared_consumption_of_a_kind_matches_what_the_factory_actually_wires(
        string machineType, DeviceClass deviceClass, string expectedKind, bool expectedConsumed)
    {
        var code = $"CFG-{machineType}";
        var d = new MachineDescriptor(
            code, $"SN-{code}", deviceClass, machineType, null, DriverKinds.Simulated, "RC1", null, 1.0);

        Assert.Equal(expectedKind, MachineParameterSchema.ConfigKindForMachineType(machineType));
        Assert.Equal(expectedConsumed, MachineParameterSchema.IsConsumedBySimulator(expectedKind));

        var store = new MachineConfigStore(TempDir());
        SimulatorFactory.Create(d, seed: 1, configStore: store);

        var storeReachedTheSimulator = store.GetConfig(code) is not null;
        Assert.Equal(expectedConsumed, storeReachedTheSimulator);
    }

    /// <summary>The DISPENSING trap, pinned as the exact character-level fact item 42 re-measured: two
    /// <c>dispense_program</c> keys are spelled identically to metric keys the same simulator publishes, so
    /// an operator editing one watches the other stand still. Reddens if either the schema or the simulator
    /// renames its way out of the collision — which would be a real fix, and should be recorded as one
    /// rather than absorbed.</summary>
    [Fact]
    public void Exactly_two_dispense_program_keys_are_spelled_as_metrics_the_same_simulator_publishes()
    {
        var d = new MachineDescriptor(
            "DISP-KEYS", "SN-DISP-KEYS", DeviceClass.Automation, "DISPENSING", "glue_dispense",
            DriverKinds.Simulated, "RC1", null, 1.0);

        var metricKeys = SimulatorFactory.Create(d, seed: 7).NextCycle(1).Metrics.Select(m => m.Name).ToHashSet(StringComparer.Ordinal);
        var configKeys = MachineParameterSchema.ParametersFor(MachineParameterSchema.DispenseProgram).Select(p => p.Key).ToList();

        var collisions = configKeys.Where(metricKeys.Contains).OrderBy(k => k, StringComparer.Ordinal).ToList();
        Assert.Equal(new[] { "pressure", "temperature" }, collisions);
    }

    /// <summary>🔴 The half of BC-1 §7.2 that did NOT survive re-measurement, pinned so the corrected number
    /// cannot drift back. That report wrote "two of the four keys on EACH side share a name with a metric
    /// that same simulator emits". For WELDER the count is ZERO: the two metric keys are
    /// <c>weld_current</c> and <c>weld_time</c>, and no <c>weld_profile</c> key matches either character for
    /// character. The QUANTITIES do correspond — which is what <c>WelderSim</c>'s own doc comment says, and
    /// it said it correctly while the source report overstated it.</summary>
    [Fact]
    public void No_weld_profile_key_is_spelled_as_a_metric_the_welder_publishes()
    {
        var d = new MachineDescriptor(
            "WELD-KEYS", "SN-WELD-KEYS", DeviceClass.Automation, "WELDER", "weld_spot",
            DriverKinds.Simulated, "RC1", null, 1.0);

        var metricKeys = SimulatorFactory.Create(d, seed: 7).NextCycle(1).Metrics.Select(m => m.Name).ToList();
        var configKeys = MachineParameterSchema.ParametersFor(MachineParameterSchema.WeldProfile).Select(p => p.Key).ToList();

        Assert.Equal(new[] { "weld_current", "weld_time" }, metricKeys);
        Assert.Empty(configKeys.Where(k => metricKeys.Contains(k, StringComparer.Ordinal)));
    }
}
