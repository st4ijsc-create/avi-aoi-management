using St4i.EdgeCore.Drivers.Simulators;
using St4i.EdgeCore.Historian;
using St4i.EdgeCore.Infrastructure;
using St4i.EdgeCore.Metrics;
using St4i.EdgeCore.Models;
using St4i.Connector.Abstractions.Models;
using Xunit;

/// <summary>
/// 🔴 <b>OWNER'S RULING 2026-08-24 — docs/owner-decisions.md items 43 (the <see cref="AssemblySim"/> half)
/// and 61 (<see cref="FunctionalTestSim"/>), DIRECTION A for both.</b> Quoted verbatim: <i>"Nhóm A: Các còn
/// số đang có đều là giả định và dùng để test nên ko cần quan tâm tính chính xác của nó, hãy đảm bảo rằng
/// logic code của chức năng trong các trường hợp là đúng là được, bạn tự quyết (hoặc chọn A cho tất
/// cả)"</i>.
///
/// <para><b>WHAT THE RULING ORDERED IS THE LOGIC, NOT THE NUMBER, so that is what this file measures.</b>
/// Every band below is an ASSUMPTION and is labelled as one at the constant that carries it. What is
/// asserted here is that the CASES come out right: that each verdict is reachable, that the boundaries fall
/// on the side they are supposed to, that the near-edge margin actually fires, and that the shift each fix
/// causes is the one the record claims.</para>
///
/// <para><b>THE THREE LAWS THIS FILE OWES, STATED WHERE ITS RESULTS SHOW UP.</b>
/// <list type="number">
/// <item><b>IT CAN GO RED.</b> Each test names the single edit that reddens it, and every one of those
/// edits was made and reverted — the control pair is recorded in
/// <c>.superpowers/sdd/group-a-41-43-61-71/task-1-report.md</c>. The <c>Item43_…</c> witnesses redden by
/// restoring <c>VerdictHelper.Evaluate(force, null, null)</c>; the <c>Item61_…</c> witnesses redden by
/// restoring <c>VerdictHelper.Evaluate(score, ScoreLsl, ScoreUsl)</c>. The two <c>…_Guard_…</c> tests were
/// GREEN ON BOTH SIDES and say so in their own summaries — they are not evidence of this change.</item>
/// <item><b>FALSE POSITIVES.</b> Nothing here touches the filesystem, the clock, the network or shared
/// process state except one read of the shipped <c>fleet.json</c>. Every simulator is constructed with an
/// explicit seed and every reading is a pure function of (seed, cycle), so a run cannot be reddened by
/// another suite, by ordering, or by the machine it runs on.</item>
/// <item><b>🔴 WHAT IT DOES NOT MEASURE.</b> (a) It says NOTHING about whether 400/500 N or a 1.5-point
/// warn band is physically right for a press-fit station or a functional tester. No source in this tree
/// answers that; the owner ruled that it does not have to be answered to ship. (b) The OEE figures below
/// are computed by handing <see cref="OeeCalculator"/> a synthetic aggregate built from the verdicts this
/// file counted. <b>It never opens the historian and never runs a pipeline</b>, so it pins the ARITHMETIC
/// of the shift, not an end-to-end reported number. (c) It cannot see the wire: it asserts on
/// <see cref="MetricSample"/> and <see cref="DeviceReading.Verdict"/>, not on a published payload.
/// (d) It does not exercise <c>VerdictHelper</c> directly — that type is <c>internal</c> and this assembly
/// has no <c>InternalsVisibleTo</c> to it, so every claim here is made through a simulator.</item>
/// </list></para>
/// </summary>
public class AssumedProcessBandTests
{
    private const int Cycles = 100_000;

    // ── The assumed bands, restated here so a reader sees the arithmetic without opening the sims. ──
    private const double ForceLsl = 400.0, ForceUsl = 500.0;
    private const double ForceMargin = (ForceUsl - ForceLsl) * 0.15;   // 15 N — VerdictHelper's two-sided rule
    private const double ScoreLsl = 90.0;
    private const double ScoreMargin = 1.5;                            // the one-sided margin, in score points

    private static string MachineSimulatorRoot()
    {
        var dir = new DirectoryInfo(AppContext.BaseDirectory);
        while (dir is not null)
        {
            if (File.Exists(Path.Combine(dir.FullName, "fleet.json")) && Directory.Exists(Path.Combine(dir.FullName, "mapping")))
                return dir.FullName;
            dir = dir.Parent;
        }

        throw new InvalidOperationException(
            $"Could not locate tools/machine-simulator (fleet.json + mapping/) by walking up from \"{AppContext.BaseDirectory}\"");
    }

    /// <summary>The descriptor the product actually ships for <paramref name="code"/>, read from the real
    /// <c>fleet.json</c> rather than hand-built, so these measurements are about the shipped fleet.</summary>
    /// <param name="code">A machine code present in the shipped roster.</param>
    /// <returns>That roster entry.</returns>
    private static MachineDescriptor Shipped(string code) =>
        FleetConfig.Load(Path.Combine(MachineSimulatorRoot(), "fleet.json")).Single(m => m.Code == code);

    private static List<(double Force, double Depth, Verdict Verdict)> AssemblyCycles(int seed = 11)
    {
        var sim = new AssemblySim(Shipped("ASSY-01"), seed);
        var rows = new List<(double, double, Verdict)>(Cycles);
        for (long c = 1; c <= Cycles; c++)
        {
            var r = sim.NextCycle(c);
            rows.Add((r.Metrics.Single(m => m.Name == "press_force").Value,
                      r.Metrics.Single(m => m.Name == "press_depth").Value,
                      r.Verdict));
        }

        return rows;
    }

    private static List<(double Score, Verdict Verdict)> FunctionalCycles(int seed = 11)
    {
        var sim = new FunctionalTestSim(Shipped("FCT-01"), seed);
        var rows = new List<(double, Verdict)>(Cycles);
        for (long c = 1; c <= Cycles; c++)
        {
            var r = sim.NextCycle(c);
            rows.Add((r.Metrics.Single(m => m.Name == "functional_score").Value, r.Verdict));
        }

        return rows;
    }

    /// <summary>OEE for a run whose only interesting term is Quality: planned time is exactly the cycles'
    /// nominal duration and the ideal cycle is the descriptor's own, so Availability and Performance are
    /// both 1 and the returned number IS the quality ratio. That is deliberate — the claim under test is
    /// about Quality, and letting the other two terms vary would hide it.</summary>
    /// <param name="good">Readings counted as good (<see cref="Verdict.Pass"/> or <see cref="Verdict.Warn"/>).</param>
    /// <param name="total">Readings in the denominator.</param>
    /// <param name="cycleSeconds">The descriptor's cadence.</param>
    /// <returns>The OEE figure.</returns>
    private static double OeeOf(long good, long total, double cycleSeconds)
    {
        var planned = TimeSpan.FromSeconds(total * cycleSeconds);
        var aggregate = new OeeInputAggregate("X", DateTimeOffset.UnixEpoch, DateTimeOffset.UnixEpoch, total, good, planned);
        return OeeCalculator.Calculate(aggregate, planned, cycleSeconds).Oee;
    }

    // ══════════════════════════════════════════════════════════════════════════════════════════════
    // ITEM 43 — AssemblySim. THE WITNESSES.
    // ══════════════════════════════════════════════════════════════════════════════════════════════

    /// <summary>🔴 <b>THE WITNESS, and it is the exact negation of the property the old test pinned.</b>
    /// Until 2026-08-24 <see cref="AssemblySim"/> passed neither limit to the shared judge, so its first
    /// branch answered <see cref="Verdict.Warn"/> for every reading and
    /// <c>SimulatorTests.Assembly_has_no_seeded_spec_so_verdict_is_warn_only</c> asserted precisely that.
    /// Measured then, on this same descriptor and seed: Pass 0, Warn 100 000, Fail 0. <b>Reddens by
    /// restoring <c>VerdictHelper.Evaluate(force, null, null)</c>.</b>
    ///
    /// <para>The three arms are asserted to be POPULATED rather than merely partitioned — an
    /// <c>Assert.All</c> over a partition is green when an arm is empty, which is the shape this repository
    /// keeps catching.</para></summary>
    [Fact]
    public void Item43_AllThreeVerdictsAreReachableForTheShippedAssemblyMachine()
    {
        var rows = AssemblyCycles();

        Assert.Equal(83_880, rows.Count(r => r.Verdict == Verdict.Pass));
        Assert.Equal(15_209, rows.Count(r => r.Verdict == Verdict.Warn));
        Assert.Equal(911, rows.Count(r => r.Verdict == Verdict.Fail));
        Assert.Empty(rows.Where(r => r.Verdict == Verdict.Skip));
    }

    /// <summary>🔴 <b>THE BAND STATED END TO END, so the fix cannot be half-applied.</b> Both limits, both
    /// near-edge bands and both fail boundaries, checked reading by reading against the declared edges:
    /// Fail outside <c>[385, 515]</c>; Warn inside the 15 N margin of EITHER limit, on EITHER side of it;
    /// Pass only in <c>(415, 485)</c>. <b>Reddens on the same single edit as the witness above, and
    /// additionally on any change to <c>VerdictHelper</c>'s two-sided margin rule.</b>
    ///
    /// <para><b>The near-edge band is asserted to fire on BOTH sides of BOTH limits</b> — four populations,
    /// each checked non-empty. A "warn hugs the edge" rule that only ever fired below the LSL would satisfy
    /// a looser test and would be wrong in a direction nobody would notice.</para></summary>
    [Fact]
    public void Item43_EveryReadingMatchesTheDeclaredEdges_AndTheNearEdgeBandFiresOnAllFourSides()
    {
        var rows = AssemblyCycles();

        Assert.All(rows, r => Assert.Equal(
            r.Force < ForceLsl - ForceMargin || r.Force > ForceUsl + ForceMargin ? Verdict.Fail
            : r.Force <= ForceLsl + ForceMargin || r.Force >= ForceUsl - ForceMargin ? Verdict.Warn
            : Verdict.Pass,
            r.Verdict));

        Assert.Contains(rows, r => r.Force < ForceLsl - ForceMargin);                       // fail low
        Assert.Contains(rows, r => r.Force > ForceUsl + ForceMargin);                       // fail high
        Assert.Contains(rows, r => r.Force >= ForceLsl - ForceMargin && r.Force < ForceLsl); // warn, outside the LSL
        Assert.Contains(rows, r => r.Force >= ForceLsl && r.Force <= ForceLsl + ForceMargin); // warn, inside the LSL
        Assert.Contains(rows, r => r.Force >= ForceUsl - ForceMargin && r.Force <= ForceUsl); // warn, inside the USL
        Assert.Contains(rows, r => r.Force > ForceUsl && r.Force <= ForceUsl + ForceMargin);  // warn, outside the USL
    }

    /// <summary>🔴 <b>THE OEE SHIFT, MEASURED — and this is the assertion item 43 has been owed since
    /// 2026-08-23.</b> BM-1 measured the <see cref="LeakTestSim"/> half of item 43 at <c>Δ OEE =
    /// 0.000000000000</c>, which is why the record says a reader expecting a corrected OEE number got
    /// nothing. This half is the other case: <c>ASSY-01</c> was <b>100% Warn ⇒ Quality 1.000000000000</b>
    /// because Warn counts as GOOD (item 2), and any band that makes Fail reachable takes it below 1.
    /// Measured over 100 000 cycles of the shipped descriptor: <b>Quality and OEE 0.990890000000, a shift
    /// of −0.009110000000</b>. <b>Reddens by restoring the two-null call</b>, which puts Quality back to
    /// exactly 1.
    ///
    /// <para>🔴 <b>THIS IS THE "reported OEE number" EXEMPTION BEING CROSSED, and it is crossed with
    /// permission dated 2026-08-24 for the reason the ruling gives</b> — the numbers are assumptions used
    /// for test. It is asserted here, in the test whose result shows the shift, rather than only in the
    /// record.</para></summary>
    [Fact]
    public void Item43_TheQualityOfTheShippedAssemblyMachineIsNoLongerExactlyOne()
    {
        var rows = AssemblyCycles();
        var good = rows.LongCount(r => r.Verdict is Verdict.Pass or Verdict.Warn);
        var total = rows.LongCount(r => r.Verdict != Verdict.Skip);

        Assert.Equal(99_089L, good);
        Assert.Equal(100_000L, total);
        Assert.Equal(0.99089, (double)good / total, 12);
        Assert.Equal(0.99089, OeeOf(good, total, Shipped("ASSY-01").CycleSeconds), 12);

        // The direction, stated as an assertion rather than as prose: it went DOWN, and by a measurable
        // amount rather than by a rounding artefact.
        Assert.True(1.0 - (double)good / total > 0.009, "the assembly cell is still effectively unpunishable");
    }

    /// <summary>🔴 <b>GUARD — GREEN ON BOTH SIDES OF THE FIX, and it pins something this task chose NOT to
    /// do.</b> <c>press_depth</c> is still published with no limits and still takes no part in the verdict.
    /// Item 43's direction A offered a depth band as optional; it was refused because a reading carries one
    /// verdict and folding two would need a rule this tree has no precedent for, and because declaring
    /// limits without judging them would reproduce owner-decisions item 62 — which is open, and is not in
    /// the group this ruling covers — at a second simulator.
    ///
    /// <para>What this asserts is the honest half of that decision, in a form that is true on BOTH sides of
    /// the fix: the depth metric promises nothing, and it does not DISCRIMINATE — whichever verdicts exist,
    /// each of them spans essentially the whole depth distribution, so no reader can conclude that depth
    /// influenced the answer. Before the fix there was one verdict class carrying the full depth range;
    /// after it there are three, each still carrying it. It reddens the day somebody gives depth an LSL or
    /// USL without also making it reach the verdict, or lets depth start deciding.</para></summary>
    [Fact]
    public void Item43_Guard_PressDepthStillPublishesNoLimitsAndTakesNoPartInTheVerdict()
    {
        var reading = new AssemblySim(Shipped("ASSY-01"), seed: 11).NextCycle(1);
        var depth = reading.Metrics.Single(m => m.Name == "press_depth");

        Assert.Null(depth.Lsl);
        Assert.Null(depth.Usl);
        Assert.Equal("mm", depth.Unit);

        var byVerdict = AssemblyCycles().GroupBy(r => r.Verdict).ToList();
        Assert.NotEmpty(byVerdict);
        Assert.All(byVerdict, g => Assert.True(
            g.Max(r => r.Depth) - g.Min(r => r.Depth) > 1.0,
            $"verdict {g.Key} spans only {g.Max(r => r.Depth) - g.Min(r => r.Depth):F3} mm of depth over {g.Count()} readings — depth may have started discriminating"));
    }

    // ══════════════════════════════════════════════════════════════════════════════════════════════
    // ITEM 61 — FunctionalTestSim. THE WITNESSES.
    // ══════════════════════════════════════════════════════════════════════════════════════════════

    /// <summary>🔴 <b>THE WITNESS, and it is item 61's headline sentence turned into an assertion.</b> The
    /// item is titled "a PERFECT point of <see cref="FunctionalTestSim"/> lands exactly on the USL and
    /// returns Warn". 100 is the best score this machine can report — <c>FunctionalTestSim</c> clamps to it
    /// — and it used to warn, because 100 is a SCALE CEILING that was being judged as an acceptance limit.
    /// It now passes. <b>Reddens by restoring <c>VerdictHelper.Evaluate(score, ScoreLsl, ScoreUsl)</c>.</b>
    ///
    /// <para>The population is asserted non-empty first and it is large: <b>21 123 of 100 000 cycles</b>
    /// draw above 100 and are clamped back to exactly 100, so more than a fifth of every cycle this machine
    /// publishes used to warn about a number the clamp produced.</para></summary>
    [Fact]
    public void Item61_APerfectScoreNowPasses_InsteadOfWarningAboutTheCeilingItWasClampedTo()
    {
        var rows = FunctionalCycles();
        var perfect = rows.Where(r => r.Score == 100.0).ToList();

        Assert.Equal(21_123, perfect.Count);

        // The pass-rate trial can still force a Fail on a perfect score — that is a different mechanism and
        // item 61 does not touch it — so the claim is about the SCORE PATH: no perfect score warns.
        Assert.DoesNotContain(perfect, r => r.Verdict == Verdict.Warn);
        Assert.Contains(perfect, r => r.Verdict == Verdict.Pass);
    }

    /// <summary>🔴 <b>THE BAND STATED END TO END.</b> The judged band is one-sided and the surviving side is
    /// the LOWER one: Fail below <c>90 − 1.5</c>, Warn across <c>[88.5, 91.5]</c>, Pass above it, and
    /// NOTHING warns for being high. Checked reading by reading, with the pass-rate trial's forced Fails
    /// excluded by construction — a row whose score is comfortably passing but whose verdict is Fail is the
    /// trial, not the band, and is counted separately. <b>Reddens on the same single edit as the witness
    /// above.</b>
    ///
    /// <para>🔴 <b>The margin's WIDTH is asserted, not just its side.</b> This is the half that the literal
    /// reading of direction A gets wrong: <c>VerdictHelper</c>'s one-sided branch scales the margin off the
    /// bound's own MAGNITUDE, so at the default fraction a bound of 90 yields a margin of 13.5 points and
    /// every reading would warn. The call therefore passes an explicit fraction, and this test pins the
    /// resulting width at 1.5 — the SAME width the two-sided call produced, so the only thing the fix moved
    /// is which edge the band hugs.</para></summary>
    [Fact]
    public void Item61_TheBandIsOneSidedOnTheLowerLimit_AndKeepsItsOneAndAHalfPointWidth()
    {
        var rows = FunctionalCycles();

        // Every row that the trial did NOT force to Fail must match the one-sided partition exactly.
        var scoreDriven = rows.Where(r => r.Verdict != Verdict.Fail || r.Score < ScoreLsl - ScoreMargin).ToList();
        Assert.All(scoreDriven, r => Assert.Equal(
            r.Score < ScoreLsl - ScoreMargin ? Verdict.Fail
            : r.Score <= ScoreLsl + ScoreMargin ? Verdict.Warn
            : Verdict.Pass,
            r.Verdict));

        // Both halves of the warn band are populated — below the limit and above it.
        Assert.Contains(rows, r => r.Score >= ScoreLsl - ScoreMargin && r.Score < ScoreLsl);
        Assert.Contains(rows, r => r.Score >= ScoreLsl && r.Score <= ScoreLsl + ScoreMargin);

        // Nothing warns for being high — the defect, negated. Every score above the warn band passes unless
        // the trial killed it.
        Assert.Empty(rows.Where(r => r.Score > ScoreLsl + ScoreMargin && r.Verdict == Verdict.Warn));

        // The width, pinned at exactly 1.5 points: 91.5 warns, the next representable step above it passes.
        Assert.Equal(1.5, ScoreMargin);
        Assert.DoesNotContain(rows, r => r.Score > 91.5 && r.Verdict == Verdict.Warn);
    }

    /// <summary>🔴 <b>THE SIZE OF THE MOVE, MEASURED — and it is the number item 61 states as "~42 %".</b>
    /// Over 100 000 cycles of the shipped <c>FCT-01</c> descriptor at seed 11: <b>before, Pass 55 743 /
    /// Warn 41 220 / Fail 3 037; after, Pass 96 533 / Warn 430 / Fail 3 037.</b> The verdict column moves on
    /// <b>40 790 cells = 40.790%</b> of cycles. <b>Reddens by restoring the two-sided call.</b>
    ///
    /// <para>🔴 <b>AND IT CORRECTS THE ITEM'S OWN UNIT.</b> Item 61 offers "42.07% conditional, 41.3%
    /// unconditional" for the WARN RATE. Measured: 42.041% is the rate of <i>scores at or above 98.5</i> —
    /// a statistic about the METRIC — while the unconditional WARN VERDICT rate was 41.220%, not 41.3%.
    /// The item's own caveat that the sentence "glues two different facts together" is therefore right, and
    /// the gap is a unit, not a rounding.</para>
    ///
    /// <para>🔴 <b>WHAT DID NOT MOVE, asserted because item 61 predicts it will not:</b> the Fail count is
    /// byte-identical across the fix (3 037 both sides), so Quality, PassRate and OEE do not move at all.
    /// Pass and Warn are both the GOOD column (item 2), and the fix only relabels within it. <b>Item 61's
    /// claim that no OEE number changes SURVIVES re-measurement</b>, which is worth saying in a repository
    /// where eight consecutive tasks refuted the premise of the item they were executing.</para></summary>
    [Fact]
    public void Item61_TheWarnRateFellFromFortyOnePercentToUnderOne_AndNoOeeNumberMoved()
    {
        var rows = FunctionalCycles();

        Assert.Equal(96_533, rows.Count(r => r.Verdict == Verdict.Pass));
        Assert.Equal(430, rows.Count(r => r.Verdict == Verdict.Warn));
        Assert.Equal(3_037, rows.Count(r => r.Verdict == Verdict.Fail));

        // The metric statistic the item quotes as its warn rate, measured separately so the two units
        // cannot be confused again.
        Assert.Equal(42_041, rows.Count(r => r.Score >= 98.5));

        var good = rows.LongCount(r => r.Verdict is Verdict.Pass or Verdict.Warn);
        Assert.Equal(96_963L, good);
        Assert.Equal(0.96963, (double)good / rows.Count, 12);
        Assert.Equal(0.96963, OeeOf(good, rows.Count, Shipped("FCT-01").CycleSeconds), 12);
    }

    /// <summary>🔴 <b>GUARD — GREEN ON BOTH SIDES OF THE FIX, and it pins a DIVERGENCE THIS TASK CHOSE TO
    /// LEAVE STANDING.</b> The reading still publishes <c>Lsl = 90, Usl = 100</c> while the verdict is now
    /// computed from the LSL alone, so <b>a reader who re-derives the verdict from the limits this reading
    /// declares gets the PRE-FIX answer</b>. That is exactly the residue open as owner-decisions item 62
    /// against <see cref="LeakTestSim"/>, and this fix ADDS A SECOND MEMBER to its population instead of
    /// resolving it: item 62 is not in the group the 2026-08-24 ruling covers, and dropping the published
    /// ceiling here would answer an open owner question as a side effect.
    ///
    /// <para>Keeping the published pair also means the fix moves <b>no metric value on the wire at all</b> —
    /// only the <c>result</c> field. Green before, green after; this is a statement of what was left, not
    /// evidence of what was done.</para></summary>
    [Fact]
    public void Item61_Guard_ThePublishedScoreStillDeclaresACeilingTheVerdictDoesNotUse()
    {
        var metric = new FunctionalTestSim(Shipped("FCT-01"), seed: 11).NextCycle(1).Metrics.Single(m => m.Name == "functional_score");

        Assert.Equal(90.0, metric.Lsl);
        Assert.Equal(100.0, metric.Usl);
        Assert.Equal(98.0, metric.Nominal);
        Assert.Equal("%", metric.Unit);
    }
}
