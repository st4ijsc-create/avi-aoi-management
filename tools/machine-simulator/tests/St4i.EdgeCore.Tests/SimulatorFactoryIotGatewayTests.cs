using St4i.EdgeCore.Config;
using St4i.EdgeCore.Drivers.Simulators;
using St4i.EdgeCore.Models;
using St4i.Connector.Abstractions.Models;
using Xunit;

/// <summary>
/// 🔴 <b>WITNESS for owner item 49, HALF B — owner's ruling of 2026-08-25.</b> Half B is one line in
/// <see cref="SimulatorFactory.Create"/>'s switch: <c>IOT_GATEWAY</c> now names
/// <see cref="IotSensorSim"/> instead of falling through to <c>FallbackByDeviceClass</c>, whose default
/// arm builds a <see cref="ScrewdriveSim"/>.
///
/// <para><b>Why most descriptors below carry <see cref="DeviceClass.Automation"/>.</b> An
/// <c>IOT_GATEWAY</c> descriptor with <see cref="DeviceClass.Iot"/> reached <see cref="IotSensorSim"/>
/// BEFORE this change too — through the fallback's <c>Iot</c> arm — so a test written on that pairing
/// would have been green on both sides of the ruling and would have measured nothing.
/// <c>Automation</c> is the pairing item 49 §49.5(2) names.
/// <c>OnboardingFleetJoin</c> pairs <c>IOT_GATEWAY</c> with <c>Iot</c>, so the population that
/// moves is the hand-built and file-authored descriptors — which is what these are.</para>
///
/// <para>🔴 <b>AND THE PAIRING ITEM 49 DOES NOT NAME, found by enumerating
/// <see cref="DeviceClass"/> rather than by trusting the item's example.</b> That enum has THREE members,
/// so <c>IOT_GATEWAY</c> had THREE prior answers, and <b>TWO of them move</b>:
/// <list type="bullet">
/// <item><c>Automation</c> → was <see cref="ScrewdriveSim"/> (<c>ProcessResult</c>, <c>screw_program</c>)
/// → now <see cref="IotSensorSim"/>. This is the one §49.5(2) prices.</item>
/// <item><c>AoiAvi</c> → was <see cref="AoiInspectorSim"/> (<c>ReadingKind.Inspection</c>,
/// <c>Measurements</c>, Pass/Fail, <c>aoi_inspection</c>) → now <see cref="IotSensorSim"/>.
/// <b>Item 49 never mentions this pairing at all</b>, and its MQTT payload changes just as outright as
/// the screwdriver's. It has its own test below.</item>
/// <item><c>Iot</c> → was and remains <see cref="IotSensorSim"/>. The control.</item>
/// </list>
/// So "one pairing moves" would have been false, and the earlier draft of this very paragraph said it.
/// The corrected statement is: <b>one of the three holds, two move.</b></para>
///
/// <para>🔴 <b>WHAT THIS FILE DOES NOT MEASURE — law (3), stated where the result appears.</b>
/// <list type="number">
/// <item>It does not and cannot enumerate the affected population on a customer's disk. Every descriptor
/// here is constructed by this file. Item 49 §49.5(2) records that no measurement in this repository can
/// list the hand-built/file-authored descriptors that exist in the field, and this file does not change
/// that. <b>An uncountable set is not an empty set</b>, and a green run here says nothing about how many
/// real machines the ruling moved — only about what happens to one when it does.</item>
/// <item>It does not assert anything about the MQTT/UNS bytes. It reads the <see cref="DeviceReading"/>
/// the simulator produces, which is the object the publisher is fed; it never starts a broker, never
/// builds a Sparkplug payload and never compares a topic. "The payload changes outright" is measured
/// here at the READING, one layer upstream of the wire.</item>
/// <item>It says nothing about whether half B is the RIGHT call. That was the owner's on 2026-08-25.
/// Half A — removing the store from the fallback's default arm — is untouched and still closed; the
/// re-measurement that keeps it closed is <see cref="ScrewTorqueDeclarationTests"/>' subject, not this
/// file's.</item>
/// </list></para>
/// </summary>
public class SimulatorFactoryIotGatewayTests
{
    private static string TempDir() => Directory.CreateTempSubdirectory("st4i-iot-gateway-").FullName;

    private static MachineDescriptor Gateway(string code, DeviceClass deviceClass) => new(
        code, $"SN-{code}", deviceClass, "IOT_GATEWAY", "telemetry_sample",
        DriverKinds.Simulated, "RC1", null, 1.0);

    /// <summary>🔴 <b>The first of the two red-able assertions half B was granted for.</b> Reddens by
    /// deleting the <c>"IOT_GATEWAY"</c> arm from <see cref="SimulatorFactory.Create"/>: without it the
    /// descriptor falls to <c>FallbackByDeviceClass</c>, whose <c>Automation</c> path is the default arm,
    /// and the assertion below reads <see cref="ScrewdriveSim"/>.</summary>
    [Fact]
    public void AnIotGatewayOnTheAutomationDeviceClass_IsASensor_NotAScrewdriver()
    {
        var sim = SimulatorFactory.Create(Gateway("GW-AUTO-01", DeviceClass.Automation), seed: 7);

        Assert.IsType<IotSensorSim>(sim);
        Assert.IsNotType<ScrewdriveSim>(sim);
    }

    /// <summary>🔴 <b>The second one, and it is the half about DISK.</b> Item 49's title is not "a machine
    /// is built as the wrong class" — it is "…silently becomes a screwdriver AND WRITES a configuration
    /// record". <see cref="SimulatorBase"/>'s constructor calls <see cref="MachineConfigStore.Ensure"/>,
    /// and <see cref="ScrewdriveSim"/> hard-codes <c>screw_program</c> while <see cref="IotSensorSim"/>
    /// hard-codes <c>iot_settings</c>. So the kind persisted under this machine's own code is a direct
    /// reading of which class the factory built.
    ///
    /// <para>The store is re-opened over the same directory — a process restart — so what is asserted is
    /// what is ON DISK, not what is in one instance's map. Reddens the same way as the test above.</para>
    ///
    /// <para>📌 The directory is a per-test temp directory, so this touches no
    /// <c>%ProgramData%</c> leaf and is unaffected by the structural redirection landed on
    /// 2026-08-29 — the two locations do not intersect.</para></summary>
    [Fact]
    public void NoScrewProgramRecordIsWrittenUnderAnIotGatewaysOwnCode()
    {
        var dir = TempDir();
        var store = new MachineConfigStore(dir);

        _ = SimulatorFactory.Create(Gateway("GW-AUTO-02", DeviceClass.Automation), seed: 7, configStore: store);

        var persisted = new MachineConfigStore(dir).GetConfig("GW-AUTO-02");

        Assert.NotNull(persisted);
        Assert.Equal(MachineParameterSchema.IotSettings, persisted!.ConfigKind);
        Assert.NotEqual(MachineParameterSchema.ScrewProgram, persisted.ConfigKind);
    }

    /// <summary>🔴 <b>THE SECOND PAIRING THAT MOVES — the one item 49 never names.</b> An
    /// <c>IOT_GATEWAY</c> descriptor on <see cref="DeviceClass.AoiAvi"/> was an
    /// <see cref="AoiInspectorSim"/> before this change, which emits <c>ReadingKind.Inspection</c> with a
    /// <c>Measurements</c> array and a Pass/Fail verdict, and which persists an <c>aoi_inspection</c>
    /// record rather than a <c>screw_program</c> one. It is now an <see cref="IotSensorSim"/>.
    ///
    /// <para>🔴 <b>Why this matters beyond tidiness:</b> item 49 §49.5(2) priced half B on the
    /// screwdriver pairing alone, so this second payload change went into the ruling UNPRICED, and the
    /// same unpaid <c>Ensure</c> migration applies to it — a gateway already seeded as
    /// <c>aoi_inspection</c> throws on its first start after this change, exactly as the screwdriver one
    /// does. Reported in <c>docs/owner-decisions.md</c> §49.7.3.</para>
    ///
    /// <para>🔴 Reddens by deleting the <c>"IOT_GATEWAY"</c> arm, like the others.</para></summary>
    [Fact]
    public void AnIotGatewayOnTheAoiAviDeviceClass_AlsoMoves_AndItemFortyNineNeverNamedThisPairing()
    {
        var dir = TempDir();
        var store = new MachineConfigStore(dir);

        var sim = SimulatorFactory.Create(Gateway("GW-AOI-01", DeviceClass.AoiAvi), seed: 7, configStore: store);

        Assert.IsType<IotSensorSim>(sim);
        Assert.IsNotType<AoiInspectorSim>(sim);

        var persisted = new MachineConfigStore(dir).GetConfig("GW-AOI-01");
        Assert.Equal(MachineParameterSchema.IotSettings, persisted!.ConfigKind);
        Assert.NotEqual(MachineParameterSchema.AoiInspection, persisted.ConfigKind);
    }

    /// <summary>🔴 <b>THE CONTROL THAT MUST NOT MOVE.</b> A bank in which every case flips proves only that
    /// something changed. This pairing — <c>IOT_GATEWAY</c> + <see cref="DeviceClass.Iot"/>, which is what
    /// <c>OnboardingFleetJoin</c> produces — answered <see cref="IotSensorSim"/> before the ruling and
    /// answers it after, through a DIFFERENT code path (the fallback's <c>Iot</c> arm before, the switch's
    /// own arm now). It is what says the ruling moved the population it was priced on and no other.</summary>
    [Fact]
    public void AnIotGatewayOnTheIotDeviceClass_WasAlreadyASensor_AndStillIs()
    {
        var sim = SimulatorFactory.Create(Gateway("GW-IOT-01", DeviceClass.Iot), seed: 7);

        Assert.IsType<IotSensorSim>(sim);
    }

    /// <summary>🔴 <b>THE COST THE RULING WAS NOT PRICED ON — built rather than described, because a
    /// sentence is not a witness.</b> Item 49 §49.5(2) priced half B as an MQTT-payload change. It did not
    /// price MIGRATION, and there is one: a gateway machine that was already started BEFORE this change has
    /// a <c>screw_program</c> record persisted under its code, and
    /// <see cref="MachineConfigStore.Ensure"/> refuses to re-ensure one machine under a second kind. So the
    /// first start after the change throws out of the simulator's CONSTRUCTOR.
    ///
    /// <para>This test asserts the CURRENT behaviour — it is green, and it is green on a defect. It exists
    /// so the defect has a running example at the place someone will look, exactly as this repository's
    /// fixture banks certify their own blind spots rather than hiding them. The day someone decides how to
    /// migrate such a record (delete it, or teach <c>Ensure</c> to re-key), THIS is the test that must be
    /// flipped and re-explained. Reported in <c>docs/owner-decisions.md</c> §49.7; NOT repaired here,
    /// because both repairs are decisions rather than work.</para>
    ///
    /// <para>🔴 What it does not measure: whether any host CATCHES this throw. It calls the factory
    /// directly. Whether a real start surfaces it as one failed machine or as a failed fleet is a
    /// different measurement and this is not it.</para></summary>
    [Fact]
    public void AGatewayAlreadySeededAsAScrewdriver_NowThrowsOnItsFirstStart_AndThatIsUnpaidMigration()
    {
        var dir = TempDir();
        var before = new MachineConfigStore(dir);
        before.Ensure("GW-MIGRATE-01", MachineParameterSchema.ScrewProgram); // the pre-change state, on disk

        var after = new MachineConfigStore(dir);

        var thrown = Assert.Throws<InvalidOperationException>(
            () => SimulatorFactory.Create(Gateway("GW-MIGRATE-01", DeviceClass.Automation), seed: 7, configStore: after));

        Assert.Contains("cannot re-ensure", thrown.Message, StringComparison.OrdinalIgnoreCase);
    }

    /// <summary>🔴 <b>"The payload changes outright" as a MEASUREMENT.</b> Item 49 §49.5(2)'s words are
    /// "different metric, different unit, different verdict"; this reads all three off the two readings
    /// instead of trusting the sentence. The screwdriver reading is obtained from the same descriptor with
    /// the machine type changed to <c>SCREWDRIVE</c> — i.e. the class the gateway used to be built as.
    ///
    /// <para>🔴 What it does not measure: the wire. See this class's own ceiling, clause 2.</para></summary>
    [Fact]
    public void TheGatewaysReading_SharesNoMetricNameUnitOrVerdictWithTheScrewdriverItUsedToBe()
    {
        var gateway = SimulatorFactory.Create(Gateway("GW-PAYLOAD-01", DeviceClass.Automation), seed: 7).NextCycle(1);
        var screwdriver = SimulatorFactory.Create(
            new MachineDescriptor("GW-PAYLOAD-01", "SN-GW-PAYLOAD-01", DeviceClass.Automation, "SCREWDRIVE",
                "screw_tightening", DriverKinds.Simulated, "RC1", null, 1.0), seed: 7).NextCycle(1);

        // Different reading KIND, and that alone re-routes the semantic topic.
        Assert.Equal(ReadingKind.Telemetry, gateway.Kind);
        Assert.Equal(ReadingKind.ProcessResult, screwdriver.Kind);

        // Different VERDICT vocabulary: telemetry carries no pass/fail concept at all.
        Assert.Equal(Verdict.Skip, gateway.Verdict);
        Assert.NotEqual(Verdict.Skip, screwdriver.Verdict);

        // Different METRIC/UNIT vocabulary — and the arrays swap: the screwdriver populates Metrics and
        // Waveforms, the gateway populates Telemetry and neither of the other two.
        Assert.Empty(gateway.Metrics);
        Assert.Empty(gateway.Waveforms);
        Assert.NotEmpty(screwdriver.Metrics);
        Assert.NotEmpty(screwdriver.Waveforms);

        Assert.Equal(
            new[] { "current", "humidity", "temperature" },
            gateway.Telemetry.Select(t => t.Metric).OrderBy(x => x, StringComparer.Ordinal).ToArray());
        Assert.Equal(
            new[] { "angle", "torque" },
            screwdriver.Metrics.Select(m => m.Name).OrderBy(x => x, StringComparer.Ordinal).ToArray());

        Assert.Empty(gateway.Telemetry.Select(t => t.Unit).Intersect(screwdriver.Metrics.Select(m => m.Unit)));
    }
}
