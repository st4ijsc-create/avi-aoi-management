using St4i.Connector.Abstractions.Models;
using St4i.EdgeCore.Drivers;
using St4i.EdgeCore.Drivers.Simulators;
using St4i.EdgeCore.Models;
using Xunit;

namespace St4i.EdgeCore.Tests;

/// <summary>
/// 🔴 Task AA-1 (.superpowers/sdd/oee-definition-and-row-shape/task-1-brief.md) — the standing witness for
/// <c>docs/owner-decisions.md</c> item 4: <b><c>WaveformSeries.RateHz</c> is the DISCRIMINATOR for the shape
/// of a <c>WaveformSeries.Samples</c> row.</b> The rule itself is published on the contract, at
/// <c>WaveformSeries</c>'s <c>Samples</c> parameter in
/// <c>src/St4i.Connector.Abstractions/Models/DeviceReading.cs</c>; this file is what holds this product's own
/// producers to it.
///
/// <para><b>THE RULE, restated here in the form this file checks it, because a witness that paraphrases its
/// own subject is not a witness.</b> Per row of <c>Samples</c>:
/// <list type="bullet">
///   <item><description><c>RateHz</c> set — exactly ONE element, the measured value. The time axis is
///   implicit: row <c>i</c> is the sample at <c>i / RateHz</c> seconds.</description></item>
///   <item><description><c>RateHz</c> null — exactly TWO elements, <c>[x, y]</c>. Element 0 is the series'
///   own independent variable and is not a time.</description></item>
/// </list>
/// An empty <c>Samples</c> list satisfies it vacuously, since the rule is per row.</para>
///
/// <para>🔴 <b>WHY THIS IS A CONTRACT CHECK AND NOT A VALIDATION, stated so nobody later reads a green run
/// as more than it is (§8.1(h6)).</b> Nothing anywhere rejects a row that breaks the rule. The type takes any
/// <c>double</c> array; the normalizer copies rows to the wire unchanged; the conformance harness compares
/// rows element by element without asking a row's length; and no reader in <c>src/</c> or <c>tests/</c>
/// indexes an ELEMENT of a row at all. So this file asserts that the two producers this product ships
/// HONOUR the rule — never that anything enforces it. A deliberately ragged series is in fact carried
/// losslessly today, on purpose, by <c>ConnectorRoundTripTests</c>'s own fixture, and that is a statement
/// about the SERIALIZER rather than a counter-example to the rule.</para>
///
/// <para><b>SCOPE, named rather than implied (§8.1(f)).</b> This file stands in <c>St4i.EdgeCore</c>'s
/// simulators. It sweeps every built-in simulator rather than the two known producers, so a THIRD producer
/// added later is checked without anybody remembering to add it here. It says nothing about drivers outside
/// this repository, and nothing about the vendored device-client SDK — whose published examples send a shape
/// the rule does not define, and which this repository may not edit.</para>
/// </summary>
public sealed class WaveformSeriesRowShapeContractTests
{
    /// <summary>The one predicate both facts below drive. Returns <c>null</c> when the series obeys the
    /// row-shape rule, otherwise a description of the FIRST row that breaks it.</summary>
    private static string? RowShapeViolation(WaveformSeries series)
    {
        var required = series.RateHz is null ? 2 : 1;
        for (var i = 0; i < series.Samples.Count; i++)
        {
            var row = series.Samples[i];
            if (row.Length != required)
            {
                return $"\"{series.Name}\": RateHz is " +
                       (series.RateHz is null ? "null, so every row must hold exactly 2 elements [x, y]"
                                              : "set, so every row must hold exactly 1 element") +
                       $" -- row {i} holds {row.Length}.";
            }
        }

        return null;
    }

    /// <summary>Every built-in simulator, constructed the same way <c>SimulatorTests.AllSimulators</c>
    /// constructs them. Enumerated rather than filtered down to the two known waveform producers, so that a
    /// simulator which STARTS emitting a waveform is covered the day it does.</summary>
    private static IEnumerable<(string Name, IMachineSimulator Sim)> BuiltInSimulators()
    {
        var d = new MachineDescriptor("MC-01", "SN", DeviceClass.Automation, "TYPE", "step", DriverKinds.Simulated, "RC1", null, 1.0);
        yield return (nameof(ScrewdriveSim), new ScrewdriveSim(d, 11));
        yield return (nameof(DispensingSim), new DispensingSim(d, 11));
        yield return (nameof(WelderSim), new WelderSim(d, 11));
        yield return (nameof(AssemblySim), new AssemblySim(d, 11));
        yield return (nameof(LeakTestSim), new LeakTestSim(d, 11));
        yield return (nameof(FunctionalTestSim), new FunctionalTestSim(d, 11));
        yield return (nameof(IotSensorSim), new IotSensorSim(d, 11));
        yield return (nameof(AoiInspectorSim), new AoiInspectorSim(d, 11));
    }

    private const int CyclesPerSimulator = 12;

    /// <summary>🔴 The measurement the owner's decision asserted and nobody had run: BOTH producers already
    /// obey the rule. Swept over every built-in simulator, not the two named ones, and it refuses to pass
    /// vacuously — a tree where no waveform is emitted at all, or where only one arm of the rule occurs,
    /// fails here instead of reporting a clean sweep of nothing.</summary>
    [Fact]
    public void EveryWaveformTheBuiltInSimulatorsEmit_ObeysTheRateHzRowShapeRule_AndBothArmsAreExercised()
    {
        var violations = new List<string>();
        var ratedArm = new List<string>();
        var untimedArm = new List<string>();

        foreach (var (simName, sim) in BuiltInSimulators())
        {
            for (var cycle = 1L; cycle <= CyclesPerSimulator; cycle++)
            {
                foreach (var series in sim.NextCycle(cycle).Waveforms)
                {
                    var failure = RowShapeViolation(series);
                    if (failure is not null) violations.Add($"{simName} cycle {cycle} -- {failure}");
                    (series.RateHz is null ? untimedArm : ratedArm).Add($"{simName}:{series.Name}");
                }
            }
        }

        Assert.True(
            violations.Count == 0,
            $"{violations.Count} waveform series emitted by this product's own simulators break the row-shape " +
            "rule published on WaveformSeries.Samples. The rule is a CONTRACT and nothing validates it at " +
            "runtime, so a break here is shipped to every third-party consumer silently:" +
            Environment.NewLine + string.Join(Environment.NewLine, violations.Select(v => "    " + v)));

        Assert.True(
            ratedArm.Count > 0,
            "No simulator emitted a waveform with RateHz SET, so the one-element arm of the rule was never " +
            "exercised and the sweep above proved nothing about it. This is a floor, not a census: fix the " +
            "sweep or say what changed -- do not delete the floor.");
        Assert.True(
            untimedArm.Count > 0,
            "No simulator emitted a waveform with RateHz NULL, so the two-element arm of the rule was never " +
            "exercised and the sweep above proved nothing about it. Same floor, same instruction.");
    }

    /// <summary>🔴 The two producers named individually, because the owner's decision is a claim about THEM
    /// and a sweep that happens to be green is not that claim. Each arm is pinned to the reading it came out
    /// of, so the semantic half of the rule is witnessed too and not only the row length: on the rated arm
    /// the time base is recoverable from the sample count and the rate, and on the untimed arm element 0 is
    /// demonstrably the tightening ANGLE rather than a time.</summary>
    [Fact]
    public void TheTwoBuiltInProducers_SitOnOppositeArmsOfTheRule_AndElementZeroIsAnAngleNotATime()
    {
        var d = new MachineDescriptor("MC-01", "SN", DeviceClass.Automation, "TYPE", "step", DriverKinds.Simulated, "RC1", null, 1.0);

        // ── The RATED arm: WelderSim's weld_current.
        var weld = new WelderSim(d, 11).NextCycle(1);
        var current = Assert.Single(weld.Waveforms);
        Assert.Equal("weld_current", current.Name);
        Assert.NotNull(current.RateHz);
        Assert.Null(RowShapeViolation(current));
        Assert.All(current.Samples, row => Assert.Single(row));

        // Not part of the rule -- evidence that RateHz on this arm is a real time base and not decoration.
        // The series covers exactly the weld duration this same reading reports as its weld_time metric.
        var weldTimeSeconds = weld.Metrics.Single(m => m.Name == "weld_time").Value / 1000.0;
        Assert.Equal(weldTimeSeconds, current.Samples.Count / current.RateHz!.Value, 9);

        // ── The UNTIMED arm: ScrewdriveSim's torque_vs_angle.
        var screw = new ScrewdriveSim(d, 11).NextCycle(1);
        var torqueVsAngle = Assert.Single(screw.Waveforms);
        Assert.Equal("torque_vs_angle", torqueVsAngle.Name);
        Assert.Null(torqueVsAngle.RateHz);
        Assert.Null(RowShapeViolation(torqueVsAngle));
        Assert.All(torqueVsAngle.Samples, row => Assert.Equal(2, row.Length));

        // Element 0 is the tightening ANGLE, in degrees: it rises monotonically to exactly the angle metric
        // this same reading reports. A time axis would not land on that number, and Unit ("Nm") does not
        // describe it -- which is why the contract now says Unit describes the MEASURED value only.
        var angle = screw.Metrics.Single(m => m.Name == "angle").Value;
        Assert.Equal("Nm", torqueVsAngle.Unit);
        Assert.Equal(angle, torqueVsAngle.Samples[^1][0], 9);
        for (var i = 1; i < torqueVsAngle.Samples.Count; i++)
        {
            Assert.True(
                torqueVsAngle.Samples[i][0] > torqueVsAngle.Samples[i - 1][0],
                $"element 0 of row {i} did not advance past row {i - 1}; it is documented as the series' own " +
                "independent variable.");
        }
    }

    /// <summary>🔴 §8.1(h6) — an instrument that cannot go red is not an instrument, and this is the half a
    /// green sweep cannot supply. Bank one drives the SAME predicate with hand-built series covering every
    /// way the rule can break, INCLUDING the exact shape the vendored SDK's own worked examples send.</summary>
    [Fact]
    public void TheRowShapeCheck_GoesRedOnEveryWayTheRuleCanBreak()
    {
        // Compliant, both arms, and the vacuous case.
        Assert.Null(RowShapeViolation(new("rated", "A", 200.0, new List<double[]> { new[] { 1.0 }, new[] { 2.0 } })));
        Assert.Null(RowShapeViolation(new("untimed", "Nm", null, new List<double[]> { new[] { 0.0, 1.0 }, new[] { 90.0, 2.0 } })));
        Assert.Null(RowShapeViolation(new("empty-rated", "A", 200.0, new List<double[]>())));
        Assert.Null(RowShapeViolation(new("empty-untimed", "Nm", null, new List<double[]>())));

        // Every way it breaks.
        Assert.NotNull(RowShapeViolation(new("rated-pair", "A", 200.0, new List<double[]> { new[] { 0.0, 1.0 } })));
        Assert.NotNull(RowShapeViolation(new("rated-empty-row", "A", 200.0, new List<double[]> { Array.Empty<double>() })));
        Assert.NotNull(RowShapeViolation(new("rated-triple", "A", 200.0, new List<double[]> { new[] { 0.0, 1.0, 2.0 } })));
        Assert.NotNull(RowShapeViolation(new("untimed-scalar", "Nm", null, new List<double[]> { new[] { 1.0 } })));
        Assert.NotNull(RowShapeViolation(new("untimed-triple", "Nm", null, new List<double[]> { new[] { 0.0, 1.0, 2.0 } })));
        Assert.NotNull(RowShapeViolation(new("untimed-empty-row", "Nm", null, new List<double[]> { Array.Empty<double>() })));

        // Ragged: the first rows comply and a later one does not, so a check that only looked at row 0 would
        // report clean here.
        Assert.NotNull(RowShapeViolation(new("ragged", "A", 200.0,
            new List<double[]> { new[] { 1.0 }, new[] { 2.0 }, new[] { 3.0, 4.0 } })));

        // 🔴 The shape the vendored device-client SDK's worked screwdriver examples actually send -- rateHz
        // SET together with two-element rows whose element 0 is a tightening angle. Named as known-wrong on
        // the contract; this is the assertion that it really is outside the rule rather than a second
        // convention. Those files are vendored and are NOT edited by this repository.
        Assert.NotNull(RowShapeViolation(new("torque_vs_angle", "Nm", 1000.0,
            new List<double[]> { new[] { 0.0, 0.1 }, new[] { 90.0, 4.0 }, new[] { 412.0, 12.0 } })));
    }

    /// <summary>🔴 The second bank, and the sharper one: the same predicate, driven by a REAL producer's own
    /// output with one thing changed. It shows the check going red on data this product actually emits, and
    /// it shows what "RateHz is the DISCRIMINATOR" means operationally — the very same rows are legal on one
    /// arm and illegal on the other, with not one sample touched.</summary>
    [Fact]
    public void TheRowShapeCheck_GoesRedOnARealProducersOwnSeries_WhenOnlyTheDiscriminatorMoves()
    {
        var d = new MachineDescriptor("MC-01", "SN", DeviceClass.Automation, "TYPE", "step", DriverKinds.Simulated, "RC1", null, 1.0);

        // ScrewdriveSim's real rows, untouched. Legal with RateHz null; illegal the moment a rate is claimed.
        var screw = Assert.Single(new ScrewdriveSim(d, 11).NextCycle(1).Waveforms);
        Assert.Null(RowShapeViolation(screw));
        Assert.NotNull(RowShapeViolation(screw with { RateHz = 500.0 }));

        // WelderSim's real rows, untouched. Legal with its rate; illegal the moment the rate is dropped.
        var weld = Assert.Single(new WelderSim(d, 11).NextCycle(1).Waveforms);
        Assert.Null(RowShapeViolation(weld));
        Assert.NotNull(RowShapeViolation(weld with { RateHz = null }));

        // And a single element appended to ONE real row of an otherwise compliant series.
        Assert.NotEmpty(weld.Samples);
        var lengthened = weld.Samples.ToList();
        lengthened[0] = new[] { lengthened[0][0], 0.0 };
        Assert.NotNull(RowShapeViolation(weld with { Samples = lengthened }));
    }
}
