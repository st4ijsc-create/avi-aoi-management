using St4i.Connector.Abstractions.Models;
using St4i.EdgeCore.Drivers;
using St4i.EdgeCore.Drivers.Simulators;
using St4i.EdgeCore.Models;
using Xunit;

namespace St4i.EdgeCore.Tests;

/// <summary>
/// 🔴 Task AA-1 (.superpowers/sdd/oee-definition-and-row-shape/task-1-brief.md), rewritten in review round
/// 1 — <b>this file pins the row shape THIS PRODUCT'S TWO BUILT-IN PRODUCERS EMIT. It does not assert that
/// shape is the canonical one, because that is an OPEN OWNER DECISION</b> —
/// <c>docs/owner-decisions.md</c> item 14, opened 2026-08-18 and not decided.
///
/// <para><b>WHY THE DISTINCTION IS THE WHOLE POINT.</b> Two published conventions in this repository
/// disagree about how many numbers a <c>WaveformSeries.Samples</c> row holds. This product's producers
/// split on <c>RateHz</c>: set means one-element rows, null means two-element <c>[x, y]</c> rows. The
/// platform's ingest route requires <b>exactly two</b> numbers in every row and treats <c>rateHz</c> as an
/// independent optional field. Under the second convention <c>ScrewdriveSim</c> is valid and
/// <c>WelderSim</c> is not. An earlier revision of this file asserted the platform's own canonical example
/// was a violation, reusing that example's numbers; <b>that assertion is REMOVED</b> — a test is the worst
/// possible place to settle a question nobody has decided.</para>
///
/// <para><b>SO WHAT DOES A GREEN RUN HERE WITNESS?</b> Exactly one thing: the two producers still emit
/// what they emitted when this was written, and they have not drifted silently. If a later task changes
/// <c>WelderSim</c> to emit pairs — which is what settling item 14 one way would require — this file goes
/// RED, and that is the intended behaviour, not an obstacle: the change would be a decision, and a
/// decision should have to be taken deliberately rather than arrive as a diff nobody noticed.</para>
///
/// <para><b>🔴 SCOPE, and two claims an earlier revision published here that are RETRACTED.</b> Kept
/// verbatim rather than deleted, because they were shipped and read. RETRACTED 2026-08-18, review round 1:
/// <list type="bullet">
///   <item><description><c>"no reader in src/ or tests/ indexes an ELEMENT of a row at all"</c> — false at
///   the commit that published it. THIS FILE indexes elements, in three places below, and the count that
///   produced the sentence was run on the base tree before the file existed. At repository scope it is
///   further out: the ingest validator destructures a fixed two-element tuple, which is a stronger shape
///   assumption than indexing.</description></item>
///   <item><description><c>"a THIRD producer added later is checked without anybody remembering to add it
///   here"</c> — an overclaim. <c>BuiltInSimulators</c> is a HAND-WRITTEN list of the eight simulator
///   classes that exist today. A NINTH class would not be swept and nothing would say so; there is no
///   reflection census of <c>SimulatorBase</c> anywhere in this suite. The true, narrower claim: if one of
///   the eight listed simulators starts emitting a waveform, it is swept.</description></item>
/// </list></para>
///
/// <para><b>The two floors below count SERIES that touched each arm, not rows inspected</b> — stated
/// precisely because the previous revision advertised them as blocking a vacuous sweep, and a series with
/// an empty <c>Samples</c> list passes a floor while contributing no inspected row. What actually stops a
/// vacuous pass today is the second fact, which pins each arm to a concrete number out of the same
/// reading.</para>
/// </summary>
public sealed class WaveformSeriesRowShapeContractTests
{
    /// <summary>The one predicate every fact below drives. Returns <c>null</c> when the series matches the
    /// row shape this product's producers emit, otherwise a description of the FIRST row that does not.
    /// Named DEVIATION rather than violation on purpose: it measures a difference from an observed shape,
    /// not a breach of a settled rule.</summary>
    private static string? RowShapeDeviation(WaveformSeries series)
    {
        var expected = series.RateHz is null ? 2 : 1;
        for (var i = 0; i < series.Samples.Count; i++)
        {
            var row = series.Samples[i];
            if (row.Length != expected)
            {
                return $"\"{series.Name}\": RateHz is " +
                       (series.RateHz is null ? "null, so this product's producers emit exactly 2 elements [x, y]"
                                              : "set, so this product's producers emit exactly 1 element") +
                       $" -- row {i} holds {row.Length}.";
            }
        }

        return null;
    }

    /// <summary>Every built-in simulator, constructed the way <c>SimulatorTests.AllSimulators</c>
    /// constructs them. 🔴 A HAND-WRITTEN list of the eight classes that exist today, not a census — see
    /// the retraction on this class.</summary>
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

    /// <summary>The sweep: every waveform the eight listed simulators emit matches the shape those
    /// producers are observed to use. This is a DRIFT pin on measured behaviour — it says nothing about
    /// which convention is canonical.</summary>
    [Fact]
    public void EveryWaveformTheBuiltInSimulatorsEmit_MatchesTheRowShapeThoseProducersUse_AndBothArmsAreExercised()
    {
        var deviations = new List<string>();
        var ratedArm = new List<string>();
        var untimedArm = new List<string>();

        foreach (var (simName, sim) in BuiltInSimulators())
        {
            for (var cycle = 1L; cycle <= CyclesPerSimulator; cycle++)
            {
                foreach (var series in sim.NextCycle(cycle).Waveforms)
                {
                    var deviation = RowShapeDeviation(series);
                    if (deviation is not null) deviations.Add($"{simName} cycle {cycle} -- {deviation}");
                    (series.RateHz is null ? untimedArm : ratedArm).Add($"{simName}:{series.Name}");
                }
            }
        }

        Assert.True(
            deviations.Count == 0,
            $"{deviations.Count} waveform series emitted by this product's own simulators no longer match the " +
            "row shape recorded for them. That is a DRIFT report, not a verdict: which row shape is canonical " +
            "is docs/owner-decisions.md item 14, still open. If this moved deliberately, say so there:" +
            Environment.NewLine + string.Join(Environment.NewLine, deviations.Select(d => "    " + d)));

        Assert.True(
            ratedArm.Count > 0,
            "No simulator emitted a waveform with RateHz SET, so the one-element arm was never exercised and " +
            "the sweep proved nothing about it. This is a FLOOR over SERIES, not a census over rows -- fix the " +
            "sweep or say what changed, do not lower the floor.");
        Assert.True(
            untimedArm.Count > 0,
            "No simulator emitted a waveform with RateHz NULL, so the two-element arm was never exercised. " +
            "Same floor, same instruction.");
    }

    /// <summary>The two producers named individually, each pinned to a concrete number out of the SAME
    /// reading, so a drift cannot hide behind a row count. 🔴 The <c>weld_current</c> assertion pins a shape
    /// the platform's ingest route does not accept — deliberately, because it is what this product emits
    /// today and item 14 has not been decided. It is a record, not an endorsement.</summary>
    [Fact]
    public void TheTwoBuiltInProducers_SitOnOppositeSidesOfTheRateHzSplit_AndElementZeroIsAnAngleNotATime()
    {
        var d = new MachineDescriptor("MC-01", "SN", DeviceClass.Automation, "TYPE", "step", DriverKinds.Simulated, "RC1", null, 1.0);

        // ── RateHz SET: WelderSim's weld_current, one element per row.
        var weld = new WelderSim(d, 11).NextCycle(1);
        var current = Assert.Single(weld.Waveforms);
        Assert.Equal("weld_current", current.Name);
        Assert.NotNull(current.RateHz);
        Assert.Null(RowShapeDeviation(current));
        Assert.All(current.Samples, row => Assert.Single(row));

        // The rate is a real time base and not decoration: the series covers exactly the weld duration
        // this same reading reports as its weld_time metric.
        var weldTimeSeconds = weld.Metrics.Single(m => m.Name == "weld_time").Value / 1000.0;
        Assert.Equal(weldTimeSeconds, current.Samples.Count / current.RateHz!.Value, 9);

        // ── RateHz NULL: ScrewdriveSim's torque_vs_angle, two elements per row.
        var screw = new ScrewdriveSim(d, 11).NextCycle(1);
        var torqueVsAngle = Assert.Single(screw.Waveforms);
        Assert.Equal("torque_vs_angle", torqueVsAngle.Name);
        Assert.Null(torqueVsAngle.RateHz);
        Assert.Null(RowShapeDeviation(torqueVsAngle));
        Assert.All(torqueVsAngle.Samples, row => Assert.Equal(2, row.Length));

        // Element 0 is the tightening ANGLE in degrees: it rises monotonically to exactly the angle metric
        // this same reading reports. A time axis would not land on that number, and Unit ("Nm") does not
        // describe it -- which is why the contract says Unit describes the MEASURED value only.
        var angle = screw.Metrics.Single(m => m.Name == "angle").Value;
        Assert.Equal("Nm", torqueVsAngle.Unit);
        Assert.Equal(angle, torqueVsAngle.Samples[^1][0], 9);
        for (var i = 1; i < torqueVsAngle.Samples.Count; i++)
        {
            Assert.True(
                torqueVsAngle.Samples[i][0] > torqueVsAngle.Samples[i - 1][0],
                $"element 0 of row {i} did not advance past row {i - 1}; it is the series' own independent " +
                "variable.");
        }
    }

    /// <summary>🔴 §8.1(h6) bank one — an instrument that cannot go red is not an instrument. Drives the
    /// predicate with hand-built series covering each way a row can differ from the producers' shape.
    /// <b>Deliberately uses no shape and no number taken from the platform's published example</b>: an
    /// earlier revision asserted that example was a deviation, using its own figures, which turned an
    /// undecided question into a standing assertion. That case is gone and is not replaced.</summary>
    [Fact]
    public void TheRowShapeCheck_GoesRedOnEveryDeviationFromTheProducersShape()
    {
        // Matching, both arms, and the vacuous case.
        Assert.Null(RowShapeDeviation(new("rated", "A", 200.0, new List<double[]> { new[] { 1.0 }, new[] { 2.0 } })));
        Assert.Null(RowShapeDeviation(new("untimed", "Nm", null, new List<double[]> { new[] { 0.0, 1.0 }, new[] { 90.0, 2.0 } })));
        Assert.Null(RowShapeDeviation(new("empty-rated", "A", 200.0, new List<double[]>())));
        Assert.Null(RowShapeDeviation(new("empty-untimed", "Nm", null, new List<double[]>())));

        // Every way a row differs.
        Assert.NotNull(RowShapeDeviation(new("rated-pair", "A", 200.0, new List<double[]> { new[] { 0.0, 1.0 } })));
        Assert.NotNull(RowShapeDeviation(new("rated-empty-row", "A", 200.0, new List<double[]> { Array.Empty<double>() })));
        Assert.NotNull(RowShapeDeviation(new("rated-triple", "A", 200.0, new List<double[]> { new[] { 0.0, 1.0, 2.0 } })));
        Assert.NotNull(RowShapeDeviation(new("untimed-scalar", "Nm", null, new List<double[]> { new[] { 1.0 } })));
        Assert.NotNull(RowShapeDeviation(new("untimed-triple", "Nm", null, new List<double[]> { new[] { 0.0, 1.0, 2.0 } })));
        Assert.NotNull(RowShapeDeviation(new("untimed-empty-row", "Nm", null, new List<double[]> { Array.Empty<double>() })));

        // Ragged: the first rows match and a later one does not, so a check that only looked at row 0 would
        // report clean here.
        Assert.NotNull(RowShapeDeviation(new("ragged", "A", 200.0,
            new List<double[]> { new[] { 1.0 }, new[] { 2.0 }, new[] { 3.0, 4.0 } })));
    }

    /// <summary>🔴 Bank two, and the sharper one: the same predicate driven by a REAL producer's own output
    /// with one thing changed. It shows the check going red on data this product actually emits, and it
    /// shows what the <c>RateHz</c> split means operationally — the very same rows sit on one side of it or
    /// the other with not one sample touched.</summary>
    [Fact]
    public void TheRowShapeCheck_GoesRedOnARealProducersOwnSeries_WhenOnlyTheRateHzFieldMoves()
    {
        var d = new MachineDescriptor("MC-01", "SN", DeviceClass.Automation, "TYPE", "step", DriverKinds.Simulated, "RC1", null, 1.0);

        // ScrewdriveSim's real rows, untouched: matching with RateHz null, deviating the moment a rate is claimed.
        var screw = Assert.Single(new ScrewdriveSim(d, 11).NextCycle(1).Waveforms);
        Assert.Null(RowShapeDeviation(screw));
        Assert.NotNull(RowShapeDeviation(screw with { RateHz = 500.0 }));

        // WelderSim's real rows, untouched: matching with its rate, deviating the moment the rate is dropped.
        var weld = Assert.Single(new WelderSim(d, 11).NextCycle(1).Waveforms);
        Assert.Null(RowShapeDeviation(weld));
        Assert.NotNull(RowShapeDeviation(weld with { RateHz = null }));

        // And a single element appended to ONE real row of an otherwise matching series.
        Assert.NotEmpty(weld.Samples);
        var lengthened = weld.Samples.ToList();
        lengthened[0] = new[] { lengthened[0][0], 0.0 };
        Assert.NotNull(RowShapeDeviation(weld with { Samples = lengthened }));
    }
}
