using St4i.EdgeCore.Drivers.Simulators;
using St4i.EdgeCore.Models;
using St4i.Connector.Abstractions.Models;
using Xunit;

/// <summary>
/// 🔴 <b>OWNER'S RULING 2026-08-23 — docs/owner-decisions.md items 43 (the <c>LeakTestSim</c> half) and 44.</b>
///
/// <para><b>THE THREE LAWS THIS FILE OWES, STATED WHERE ITS RESULTS SHOW UP.</b>
/// <list type="number">
/// <item><b>IT CAN GO RED.</b> Each test below names, in its own summary, the single edit that reddens it,
/// and every one of those edits was actually made and reverted — the control pair is recorded in
/// <c>.superpowers/sdd/items-43-44-45-47/task-1-report.md</c>. The three
/// <c>Item43_…</c> tests redden by restoring the literal <c>0.0</c> that
/// <see cref="LeakTestSim"/> used to pass as its LSL; the <c>Item44_…</c> throw tests redden by restoring
/// the bare assignment and the <c>Math.Clamp</c> the two constructors used to do.</item>
/// <item><b>FALSE POSITIVES.</b> Nothing here touches the filesystem, the clock, the network or any shared
/// process state. Every simulator is constructed with an explicit seed and every reading is a pure function
/// of (seed, cycle), so a run here cannot be reddened by another suite, by ordering, or by a machine.</item>
/// <item><b>🔴 WHAT IT DOES NOT MEASURE.</b> (a) It says NOTHING about <see cref="AssemblySim"/> — and the
/// REST OF THIS CLAUSE DIED ON 2026-08-24, so it is corrected in place rather than left to be believed.
/// It used to read: <i>"Item 43's other half is NOT executed — no source in this tree states what a valid
/// <c>press_force</c> or <c>press_depth</c> is, and inventing a pair would repeat item 41's defect exactly;
/// the existing <c>SimulatorTests.Assembly_has_no_seeded_spec_so_verdict_is_warn_only</c> therefore still
/// stands unchanged and still pins one reachable verdict."</i> The owner ruled on 2026-08-24 that the
/// numbers in this product are assumptions used for test and that what must be right is the LOGIC, so item
/// 43's assembly half IS executed: <see cref="AssemblySim"/> now judges the press force against a band
/// declared as an assumption, that test was reddened by the change and rewritten, and the witness lives in
/// <c>AssumedProcessBandTests</c>. What survives of the old sentence is only its first clause — nothing in
/// THIS file measures <see cref="AssemblySim"/>. (b) It does not reach <c>OeeCalculator</c>, the
/// historian, or any report: the claim below that Quality does not move is derived from the good-count
/// PREDICATE (Pass-or-Warn), asserted here on verdicts, not from an end-to-end OEE run. (c) It cannot see
/// the wire: the published <c>MetricSample</c> still declares an LSL of 0.0 and this file asserts that it
/// does, which pins the divergence rather than resolving it.</item>
/// </list></para>
/// </summary>
public class LeakAndFunctionalVerdictDomainTests
{
    private const double DefaultMaxLeak = 20.0;
    private const double Margin = DefaultMaxLeak * 0.15;   // 3.0 Pa/s — VerdictHelper's one-sided margin.
    private const int Cycles = 4000;

    private static MachineDescriptor LeakDescriptor() => new(
        "LEAK-01", "SN-LEAK01", DeviceClass.Automation, "LEAK_TEST", "leak_test",
        DriverKinds.Simulated, "RC-LEAK-A", null, 1.4);

    private static MachineDescriptor FctDescriptor() => new(
        "FCT-01", "SN-FCT01", DeviceClass.Automation, "FUNCTIONAL_TEST", "functional_test",
        DriverKinds.Simulated, "RC-FCT-A", null, 1.3);

    private static List<(double Rate, Verdict Verdict)> LeakCycles(double maxLeak = DefaultMaxLeak, int seed = 11)
    {
        var sim = new LeakTestSim(LeakDescriptor(), seed, maxLeak);
        var rows = new List<(double, Verdict)>(Cycles);
        for (var c = 1; c <= Cycles; c++)
        {
            var r = sim.NextCycle(c);
            rows.Add((r.Metrics.Single(m => m.Name == "leak_rate").Value, r.Verdict));
        }

        return rows;
    }

    // ══════════════════════════════════════════════════════════════════════════════════════════════
    // ITEM 43 — the LeakTestSim half. THE WITNESS.
    // ══════════════════════════════════════════════════════════════════════════════════════════════

    /// <summary>🔴 <b>THE WITNESS.</b> The best result a leak tester can report is the LOWEST one, and it used
    /// to be a <see cref="Verdict.Warn"/>: <see cref="LeakTestSim"/> seeded an LSL of 0.0, so
    /// <c>VerdictHelper</c>'s near-edge rule warned for hugging a bound that is not an acceptance limit.
    /// <b>Reddens by putting that <c>0.0</c> back.</b>
    ///
    /// <para>It asserts on a POPULATION rather than on one lucky cycle, and it asserts the population is
    /// non-empty first — an "every low reading passes" over zero low readings would be green for the wrong
    /// reason, which is the shape this repository keeps finding.</para></summary>
    [Fact]
    public void Item43_EveryLeakRateAtOrBelowTheNearEdgeBand_IsNowPass_NotWarnForBeingTooGood()
    {
        var rows = LeakCycles();
        var best = rows.Where(r => r.Rate <= Margin).ToList();

        Assert.NotEmpty(best);                        // the population C0 check: this arm is genuinely exercised
        Assert.Contains(best, r => r.Rate == 0.0);    // including the clamped floor — the literal best case
        Assert.All(best, r => Assert.Equal(Verdict.Pass, r.Verdict));
    }

    /// <summary>🔴 The one-sided band stated end to end, so the fix cannot be half-applied: Pass below the
    /// warn edge, Warn across it, Fail past it — and NOTHING warns for being low. Reddens on the same single
    /// edit as the witness above, and additionally on any change to <c>VerdictHelper</c>'s margin rule.
    ///
    /// <para>🔴 <b>Run at TWO limits, and the second one is not decoration — it is what stops this from being
    /// a claim about an empty set.</b> Measured while writing this test: at the shipped default of 20.0 Pa/s
    /// the <see cref="Verdict.Fail"/> arm is <b>never populated</b>. Fail needs a draw above 23.0 from
    /// <c>N(8, 3)</c>, which is 5σ — about 3 in 10 million cycles — so 4000 cycles produced ZERO, and the
    /// class doc's "Fail only above 23.0" is true in the way an unreachable branch is true. The 4.0 Pa/s run
    /// exercises all three arms for real, and it does so through the very parameter item 44 kept.</para></summary>
    [Theory]
    [InlineData(DefaultMaxLeak, false)]   // shipped default: Fail is 5σ away and is NOT expected to appear
    [InlineData(4.0, true)]               // a tight limit: all three arms genuinely populated
    public void Item43_TheBandIsOneSided_PassBelow_WarnAcross_FailPast_AndNothingWarnsForBeingLow(
        double maxLeak, bool failIsReachable)
    {
        var margin = maxLeak * 0.15;
        var rows = LeakCycles(maxLeak);

        Assert.All(rows, r => Assert.Equal(
            r.Rate > maxLeak + margin ? Verdict.Fail
            : r.Rate >= maxLeak - margin ? Verdict.Warn
            : Verdict.Pass,
            r.Verdict));

        // The arms are asserted to be populated (or not) rather than assumed — an Assert.All over a set that
        // does not exist is the shape this repository keeps catching.
        Assert.Contains(rows, r => r.Verdict == Verdict.Pass);
        Assert.Contains(rows, r => r.Verdict == Verdict.Warn);
        Assert.Equal(failIsReachable, rows.Any(r => r.Verdict == Verdict.Fail));
    }

    /// <summary>🔴 <b>GUARD, NOT WITNESS — and it is the load-bearing one for item 43's OEE claim.</b> It was
    /// green before the fix and it is green after it, deliberately: what it pins is that the fix did NOT move
    /// the good/bad partition. Every good-count definition in this product counts <b>Pass OR Warn</b> as good
    /// (<c>SqliteHistorianStore.AggregateForOeeAsync</c> behind <c>OeeCalculator</c>'s Quality term,
    /// <c>MachineState.PassRate</c>, <c>MachineViewModel.PassRate</c>,
    /// <c>Normalizer.ComputeOverallResult</c>), and this change only moves readings from Warn to Pass while
    /// leaving the Fail boundary at <c>USL + margin</c>. So the good count, and therefore Quality, PassRate
    /// and OEE, are byte-identical across the fix.
    ///
    /// <para>🔴 <b>This contradicts item 43's own text</b>, which predicts that fixing <c>LeakTestSim</c>
    /// "shifts Quality too". It does not, and the reason is stated above rather than argued: Warn was already
    /// good.</para>
    ///
    /// <para><b>What it does NOT measure:</b> it asserts the PREDICATE on verdicts, not an OEE number. It
    /// never opens the historian and never calls <c>OeeCalculator</c>.</para></summary>
    [Fact]
    public void Item43_Guard_TheGoodCountDoesNotMove_BecauseWarnAndPassAreBothGood()
    {
        var rows = LeakCycles();

        var good = rows.Count(r => r.Verdict is Verdict.Pass or Verdict.Warn);
        var withinTheFailBoundary = rows.Count(r => r.Rate <= DefaultMaxLeak + Margin);

        Assert.Equal(withinTheFailBoundary, good);
        Assert.Equal(rows.Count, rows.Count(r => r.Verdict != Verdict.Skip));   // nothing left the denominator
    }

    /// <summary>🔴🔴 <b>THIS TEST PINS AN ADJUDICATED STATE, NOT A CORRECT ONE. READ THIS BEFORE YOU
    /// "FIX" WHAT IT GUARDS.</b>
    ///
    /// <para><b>OWNER'S RULING, 2026-08-24, owner-decisions item 62 — direction B, WITH A SIGNATURE.</b> The
    /// published limit pair <c>(0.0 ; 20.0)</c> STAYS, deliberately, and this test is the lock. Until that
    /// date the pair survived by INERTIA — nobody had decided it, the residue was merely recorded. It has
    /// now been decided, on the record, with both banks of the cost written down:</para>
    /// <list type="bullet">
    /// <item><b>What keeping it costs:</b> a published assertion that has been MEASURED FALSE. Any consumer
    /// outside this product — an SPC board, an ingest gateway, a supervisor reading "lower limit 0" — who
    /// re-derives the verdict from the limits this reading declares gets the PRE-FIX answer, <c>Warn</c>
    /// where the machine emitted <c>Pass</c>, on ~4.78% of this machine's cycles. That is a published
    /// DISAGREEMENT, not an ambiguity, and this test is the reason nobody removes it by accident.</item>
    /// <item><b>What changing it would cost:</b> <c>lsl</c> would go from <c>0</c> to <b>absent</b> in the
    /// canonical record. For a typed consumer that is a WIRE-SHAPE change, not a value change, and the
    /// field leaves this product over MQTT via <c>Normalizer</c>. Two standing exemptions at once.</item>
    /// <item><b>Why the ruling went the way it did:</b> <c>0</c> is the PHYSICAL FLOOR of a leak rate and it
    /// is what a chart bands against; and this tree cannot enumerate who is reading the field, so the
    /// precedent of items 2 and 3 applies — when the third-party population cannot be counted, KEEP the
    /// behaviour and PUBLISH the fact. A set that cannot be counted is not an empty set.</item>
    /// </list>
    ///
    /// <para>🔴 <b>SO: A RED HERE IS NOT NECESSARILY A DEFECT YOU INTRODUCED.</b> If you are here because
    /// this went red, you have most likely done the LOCALLY correct thing — dropped a limit the verdict does
    /// not use — and collided with a decision that outranks it. Do not "fix" the assertion. Reopen item 62
    /// and get the ruling changed, or leave it. This test says <i>don't</i>, and now it also says
    /// <i>why</i> and <i>who decided</i>, which is the whole of what it was missing.</para>
    ///
    /// <para>🔴 <b>AND IT IS NOT THE ONLY ONE. The population of item 62 is TWO simulators, not one.</b>
    /// <c>AssumedProcessBandTests.Item61_Guard_ThePublishedScoreStillDeclaresACeilingTheVerdictDoesNotUse</c>
    /// pins the mirror shape on <see cref="FunctionalTestSim"/> — a published CEILING the verdict does not
    /// use, created by item 61's fix on the same day. Same ruling, same reasoning, opposite side of the
    /// band. Item 62's body said "LeakTestSim is the only case"; that predicate was measured again on
    /// 2026-08-24 and corrected there.</para>
    ///
    /// <para>🔴 <b>THE TEST NAME IN THE PARAGRAPH ABOVE DOES NOT EXIST — corrected 2026-08-25, dead name
    /// left standing because it is what was written.</b> The sibling guard was renamed on 2026-08-24, in
    /// the same task that wrote this paragraph, to
    /// <c>AssumedProcessBandTests.Item62_Guard_ThePublishedScoreStillDeclaresACeilingTheVerdictDoesNotUse_OwnerRuled20260824</c>.
    /// Both halves of item 62's "read the other one too" cross-reference pointed at a symbol no search
    /// resolves — this file at the line above, and <c>FunctionalTestSim</c> in its own declaration block.
    /// The pair of tests was correct; the ROUTE between them was broken, and a route nobody can follow is
    /// the item 37 defect the whole cross-reference existed to avoid.</para>
    ///
    /// <para>🔴 <b>AND THE TWO MEMBERS DO NOT DISAGREE IN THE SAME SHAPE — measured 2026-08-25, and the
    /// record had been reading them as one.</b> Both counts below are counts of "emitted Pass, published
    /// pair says Warn". For THIS machine that is the WHOLE of its disagreement: re-deriving every one of
    /// the 4000 cycles from the published pair and comparing to the emitted verdict gives <b>201</b>, the
    /// same 201 asserted below — no other cycle disagrees at all. For the functional member the same total
    /// re-derivation gives <b>43 815</b>, of which its guard asserts <b>40 790</b>; the remaining
    /// <b>3025</b> are cycles its pass-rate trial forced to Fail while the published pair says the unit was
    /// good. This class has no such trial, so it cannot have that second kind. <b>Item 62 therefore has
    /// TWO MODES, not one, and it has had them since the day the second member was created — this is not a
    /// cost of some future fix, it is an unrecorded property of the present.</b></para>
    ///
    /// <para><b>What this test does NOT measure:</b> the WIRE. <c>Normalizer</c> — the thing that copies
    /// <c>Lsl</c> into the outgoing envelope and therefore the whole reason changing it crosses an exemption
    /// — is not on its path, so a green here is not evidence about what any consumer receives.
    /// 🔴 <b>And it deliberately does NOT stay inside the published pair:</b> the second half below reads
    /// VERDICTS, because a test that only asserted four numbers would pin a limit pair and not the fact that
    /// makes the pair a ruled defect. One consequence worth naming: making the verdict path USE the floor
    /// would redden this test too, and that is a change nobody has ruled on either.</para></summary>
    [Fact]
    public void Item62_Guard_ThePublishedMetricStillDeclaresAFloorTheVerdictDoesNotUse_OwnerRuled20260824()
    {
        var metric = new LeakTestSim(LeakDescriptor(), seed: 11).NextCycle(1).Metrics.Single(m => m.Name == "leak_rate");

        Assert.Equal(0.0, metric.Lsl);
        Assert.Equal(DefaultMaxLeak, metric.Usl);
        Assert.Equal("Pa/s", metric.Unit);

        // 🔴 THE DISAGREEMENT ITSELF, MEASURED — otherwise this pins a pair of numbers and not the fact that
        // makes them a ruled defect. The re-derivation is spelled out rather than borrowed, because
        // VerdictHelper is `internal` and this assembly cannot see it — which is exactly the position a
        // third party is in: they have the two published numbers and the documented rule, nothing else.
        // The two-sided margin the published pair implies is (usl - lsl) * 0.15 = 3.0, numerically the SAME
        // width the machine's one-sided rule used. So this is a divergence of RULE, not of arithmetic.
        const double TwoSidedMargin = (DefaultMaxLeak - 0.0) * 0.15;
        Assert.Equal(Margin, TwoSidedMargin);

        var rows = LeakCycles();
        var emittedPassButThePublishedPairSaysWarn =
            rows.Count(r => r.Verdict == Verdict.Pass && r.Rate <= 0.0 + TwoSidedMargin);

        // 🔴 AND THE ITEM'S OWN SEVERITY NUMBER DID NOT SURVIVE BEING MEASURED. Item 62 §62.1 says the
        // disagreement lands on "4.78% of cycles", and derives it ANALYTICALLY as P(rate <= 3.0 | N(8;3)) =
        // 0.0478. That is the right integral of the right distribution — but it is not this simulator's
        // output. Over the 4000 cycles LEAK-01 actually draws at seed 11 the count is 201, i.e. 5.025%,
        // because a finite seeded sample is not its own limiting distribution. The item's figure is a
        // PROPERTY OF THE MODEL quoted as a property of the PRODUCT, and the gap is 0.245 points — about 5%
        // of the figure itself. Corrected in item 62's body, and pinned here so it cannot drift back.
        Assert.Equal(201, emittedPassButThePublishedPairSaysWarn);
        Assert.Equal(0.05025, (double)emittedPassButThePublishedPairSaysWarn / rows.Count, 5);
        Assert.Equal(4000, rows.Count);

        // 🔴 2026-08-25 — WHAT THE 201 ABOVE DOES NOT COUNT, MEASURED INSTEAD OF ASSUMED. The count above is
        // ONE DIRECTION of disagreement (emitted Pass, published pair says Warn). Item 62 §62.5 describes
        // both guards as counting "the cycles on which the two answers differ", which is a WIDER claim than
        // the assertion actually makes. For THIS machine the two happen to coincide, and that is a fact
        // worth pinning rather than a coincidence worth trusting: re-derive all 4000 cycles from the
        // published pair and compare verdict-to-verdict, and the total is the SAME 201. It coincides
        // because this simulator's verdict is a pure function of the metric, so the published pair can
        // always predict it. The functional member's cannot — see this test's banner — and there the two
        // numbers differ by 3025. A shared sentence over two members that do not share a shape is exactly
        // the kind of claim this file keeps catching.
        var totalDisagreements = rows.Count(r => ReDeriveFromPublishedPair(r.Rate, 0.0, DefaultMaxLeak) != r.Verdict);
        Assert.Equal(201, totalDisagreements);
        Assert.Equal(emittedPassButThePublishedPairSaysWarn, totalDisagreements);
    }

    /// <summary>The verdict a third party derives from the PUBLISHED limit pair alone. Hand-rolled on
    /// purpose: <c>VerdictHelper</c> is <c>internal</c> and this assembly has no <c>InternalsVisibleTo</c>
    /// to it, which is precisely the position an outside consumer is in — two published numbers and the
    /// documented rule, nothing else. Mirrors <c>VerdictHelper.Evaluate</c>'s branch order exactly,
    /// INCLUDING the near-miss arm (a value outside a limit but within one margin of it is Warn, not Fail);
    /// an earlier draft of this helper omitted that arm and mis-counted the functional member by 47 cycles,
    /// which is why the omission is called out here rather than quietly fixed.</summary>
    /// <param name="value">The metric value the reading published.</param>
    /// <param name="lsl">The published lower limit, or null if none was published.</param>
    /// <param name="usl">The published upper limit, or null if none was published.</param>
    /// <returns>The verdict the published pair implies.</returns>
    private static Verdict ReDeriveFromPublishedPair(double value, double? lsl, double? usl)
    {
        if (lsl is null && usl is null) return Verdict.Warn;

        var margin = lsl.HasValue && usl.HasValue
            ? (usl.Value - lsl.Value) * 0.15
            : Math.Max(Math.Abs(usl ?? lsl!.Value) * 0.15, 0.01);

        if (lsl.HasValue && value < lsl.Value) return value >= lsl.Value - margin ? Verdict.Warn : Verdict.Fail;
        if (usl.HasValue && value > usl.Value) return value <= usl.Value + margin ? Verdict.Warn : Verdict.Fail;
        if (lsl.HasValue && value <= lsl.Value + margin) return Verdict.Warn;
        if (usl.HasValue && value >= usl.Value - margin) return Verdict.Warn;
        return Verdict.Pass;
    }

    // ══════════════════════════════════════════════════════════════════════════════════════════════
    // ITEM 44 — keep both parameters, range-check them.
    // ══════════════════════════════════════════════════════════════════════════════════════════════

    /// <summary>🔴 <b>WITNESS.</b> <c>maxLeakRatePa</c> is refused for every value item 44 names as breaking
    /// the model, plus the one it does not name (NaN, which passed every comparison and made every reading
    /// a <see cref="Verdict.Pass"/>). <b>Reddens by restoring the bare <c>_maxLeakRatePa = maxLeakRatePa;</c>
    /// assignment.</b> The message must NAME the parameter and the VALUE — item 39's standard, and the twelfth
    /// round counted six throw sites that did neither.</summary>
    [Theory]
    [InlineData(0.0)]
    [InlineData(-1.0)]
    [InlineData(double.NaN)]
    [InlineData(double.PositiveInfinity)]
    [InlineData(double.NegativeInfinity)]
    public void Item44_MaxLeakRatePa_OutOfDomain_ThrowsNamingTheParameterAndTheValue(double bad)
    {
        var ex = Assert.Throws<ArgumentOutOfRangeException>(() => new LeakTestSim(LeakDescriptor(), 11, bad));

        Assert.Equal("maxLeakRatePa", ex.ParamName);
        Assert.Equal(bad, Assert.IsType<double>(ex.ActualValue));
        Assert.Contains("maxLeakRatePa", ex.Message, StringComparison.Ordinal);
    }

    /// <summary>🔴 <b>WITNESS, and it is the half item 44 does NOT claim.</b> Item 44 asserts only that
    /// <c>maxLeakRatePa</c> is unchecked; <c>targetPassRate</c> was never unchecked — it CLAMPED. The
    /// re-measurement is that the clamp had a hole: <see cref="Math.Clamp(double,double,double)"/> compares
    /// with <c>&lt;</c> and <c>&gt;</c>, every ordered comparison against NaN is false, so NaN passed through
    /// untouched and <c>passRoll &lt;= NaN</c> then forced <see cref="Verdict.Fail"/> on 100% of cycles with
    /// no error anywhere. <b>Reddens by restoring <c>Math.Clamp(targetPassRate, 0.0, 1.0)</c>.</b></summary>
    [Theory]
    [InlineData(double.NaN)]
    [InlineData(-0.001)]
    [InlineData(1.001)]
    [InlineData(double.PositiveInfinity)]
    [InlineData(double.NegativeInfinity)]
    public void Item44_TargetPassRate_OutOfDomain_ThrowsNamingTheParameterAndTheValue(double bad)
    {
        var ex = Assert.Throws<ArgumentOutOfRangeException>(() => new FunctionalTestSim(FctDescriptor(), 11, bad));

        Assert.Equal("targetPassRate", ex.ParamName);
        Assert.Equal(bad, Assert.IsType<double>(ex.ActualValue));
        Assert.Contains("targetPassRate", ex.Message, StringComparison.Ordinal);
    }

    /// <summary>🔴 The measurement behind the NaN arm above, kept as an assertion so nobody has to take the
    /// paragraph on trust: <see cref="Math.Clamp(double,double,double)"/> really does return NaN, and a
    /// comparison against that NaN really is false. This is a fact about the BCL and about IEEE 754, not
    /// about this product — it is here because the two constructors' doc comments now rest on it.</summary>
    [Fact]
    public void Item44_TheHoleInTheOldClamp_IsRealAndIsNotAnArgument()
    {
        Assert.True(double.IsNaN(Math.Clamp(double.NaN, 0.0, 1.0)));
        Assert.False(0.5 <= Math.Clamp(double.NaN, 0.0, 1.0));
        Assert.False(0.0 <= Math.Clamp(double.NaN, 0.0, 1.0));
    }

    /// <summary>🔴 <b>GUARD, self-labelled.</b> Green on both sides of the fix. Both parameters are KEPT —
    /// the owner's ruling was "range-check and keep", not "remove a public name" — so every in-domain value,
    /// INCLUDING both endpoints, still constructs and still behaves the way the doc comments describe.</summary>
    [Theory]
    [InlineData(0.0)]
    [InlineData(0.97)]
    [InlineData(1.0)]
    public void Item44_Guard_TargetPassRate_InDomain_IsKept_IncludingBothEndpoints(double ok)
    {
        var reading = new FunctionalTestSim(FctDescriptor(), 11, ok).NextCycle(1);

        Assert.Equal(ReadingKind.ProcessResult, reading.Kind);
        Assert.Contains(reading.Metrics, m => m.Name == "functional_score");
    }

    /// <summary>🔴 <b>GUARD, self-labelled.</b> The shipped defaults are untouched by item 44 — nothing in
    /// this repository supplies either parameter, so the default-constructed simulators must be byte-for-byte
    /// what they were. This is what makes "no caller changes behaviour" an assertion instead of a claim.</summary>
    [Fact]
    public void Item44_Guard_TheDefaultsAreUnchanged_WhichIsWhyNoCallerMoves()
    {
        var leak = new LeakTestSim(LeakDescriptor(), 11).NextCycle(7);
        var explicitLeak = new LeakTestSim(LeakDescriptor(), 11, 20.0).NextCycle(7);
        Assert.Equal(explicitLeak.Verdict, leak.Verdict);
        Assert.Equal(
            explicitLeak.Metrics.Single(m => m.Name == "leak_rate").Usl,
            leak.Metrics.Single(m => m.Name == "leak_rate").Usl);

        var fct = new FunctionalTestSim(FctDescriptor(), 11).NextCycle(7);
        var explicitFct = new FunctionalTestSim(FctDescriptor(), 11, 0.97).NextCycle(7);
        Assert.Equal(explicitFct.Verdict, fct.Verdict);
    }
}
