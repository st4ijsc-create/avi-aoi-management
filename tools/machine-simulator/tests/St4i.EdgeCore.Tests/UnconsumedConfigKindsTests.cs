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

        // 🔴 WITNESS for owner item 49, HALF C — owner's ruling 2026-08-24. Reddens by removing
        // ["AOI_AVI"] = AoiInspection from MachineParameterSchema.MachineTypeToConfigKind: the
        // ConfigKindForMachineType assertion below answered null for this string until that row was added,
        // while the factory has always built an AoiInspectorSim WITH a store for it. That gap is the whole
        // of half C — a machine that gets an aoi_inspection record written under its own code while
        // GET /v1/machines/{code}/settings answers 400 for the same machine. `true` here is not new
        // behaviour; it is the row that finally lets this table ASK about a type it could not name.
        { "AOI_AVI",         DeviceClass.AoiAvi,     MachineParameterSchema.AoiInspection,   true  },
    };

    /// <summary>The declared answer must equal the measured one, in BOTH directions — a kind claimed
    /// consumed whose store never arrives, and a kind claimed unconsumed whose store does, both redden this.
    /// The second direction is the one that matters most: the day somebody wires
    /// <c>DispensingSim</c>/<c>WelderSim</c> to a store, this test fails and forces the doc comments, the
    /// REST push message and item 42's record to be corrected in the same change rather than drifting.
    ///
    /// <para>🔴 <b>OWNER ITEM 68, 2026-08-24 — THIS IS THE INSTRUMENT ITEM 68 SAYS DOES NOT EXIST, AND
    /// NAMING IT HERE IS PART OF THAT ITEM'S RECORD.</b> Item 68 §68.3 says that choosing the cheap bank is
    /// "accepting that the day a new simulator is wired, the warning will be wrong in the opposite direction
    /// and NO TOOL WILL CATCH IT". Measured 2026-08-24: <b>this test catches exactly that event</b>, it has
    /// caught it since BL-1 built it for item 42 on 2026-08-23 — a day before item 68 was opened — and it
    /// runs INSIDE the gate, because it lives under <c>tests/St4i.EdgeCore.Tests</c> rather than under
    /// <c>web/</c>. The claim in §68.3 is therefore false as written, and it is corrected in item 68's body
    /// rather than quietly.</para>
    ///
    /// <para>🔴 <b>AND THE PART THAT IS STILL TRUE, said here because this is where the result appears —
    /// law (3).</b> What reddens is the C# side. Nothing in this repository's gate reads
    /// <c>web/src/i18n/en.ts</c> or <c>vi.ts</c>, where the operator-facing sentence
    /// <c>machineSettings.limitation</c> actually lives: the gate compiles no TypeScript and starts no
    /// browser (owner item 60). So this test forces the SERVER's account of itself to be corrected in the
    /// same change; it does NOT force the web copy to be corrected, and a person who reddens it can make it
    /// green again while leaving the operator's screen saying the stale thing. That last mile has no
    /// instrument and this test is not it. Whoever turns a `false` above into a `true` must also edit both
    /// i18n dictionaries and <c>web/tests/29-machine-settings-unwired-types.spec.ts</c> by hand.</para>
    ///
    /// <para>📎 🔴 <b>THE PARAGRAPH ABOVE IS PARTLY RETRACTED, 2026-08-25 (task CA-1, owner ruling of
    /// 2026-08-25 on item 60) — kept verbatim and un-struck, because it was exactly true when written and
    /// only one of its clauses moved.</b> The gate now runs <c>npm run build</c>, <c>npm run lint</c> and
    /// <c>npm run test:e2e</c> for <c>web/</c>.
    /// <i>FALSE as of that ruling:</i> "the gate compiles no TypeScript and starts no browser" — it does
    /// both, on every run; and "Nothing in this repository's gate reads web/src/i18n/en.ts or vi.ts" — both
    /// dictionaries are now type-checked by <c>tsc -b</c>, and <c>vi.ts</c> is additionally IMPORTED and
    /// asserted against the rendered screen by <c>web/tests/29-machine-settings-unwired-types.spec.ts</c>,
    /// which the gate now executes.
    /// <i>STILL TRUE, and it is the half that matters:</i> "that last mile has no instrument". That spec
    /// asserts THE SCREEN SHOWS WHAT THE DICTIONARY SAYS, which is a tautology with respect to staleness —
    /// nothing anywhere compares the operator-facing sentence against
    /// <c>MachineParameterSchema.IsConsumedBySimulator</c>. A person who flips a <c>false</c> above to
    /// <c>true</c> and rewords <c>vi.ts</c> to match still gets a green gate whether the new wording is
    /// right or wrong, and <c>en.ts</c> is asserted by nothing at all. So the hand-edit instruction in the
    /// sentence above stands unchanged; what changed is that two of the three reasons given for it have
    /// stopped being reasons.</para></summary>
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

        // Assert.DoesNotContain with a predicate rather than Assert.Empty over a Where — the latter is
        // xUnit2029, and this suite's warning count is pinned, so the analyzer's preferred form is the
        // one that keeps EXPECT_WARNINGS where it is instead of moving it by one.
        Assert.DoesNotContain(configKeys, k => metricKeys.Contains(k, StringComparer.Ordinal));
    }
}
