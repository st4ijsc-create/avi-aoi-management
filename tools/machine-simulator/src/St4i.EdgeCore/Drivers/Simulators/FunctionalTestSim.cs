using St4i.EdgeCore.Models;
using St4i.Connector.Abstractions.Models;

namespace St4i.EdgeCore.Drivers.Simulators;

/// <summary>
/// Functional test (FUNCTIONAL_TEST) — doc-62 §6: "pass-rate + vài metric số" ("tỉ lệ" verdict).
/// Each cycle draws a Bernoulli trial against <c>targetPassRate</c> to decide
/// pass/fail (the "tỉ lệ"), independent of — but reported alongside — a numeric functional score.
/// </summary>
public sealed class FunctionalTestSim : SimulatorBase
{
    private const double ScoreMean = 98.0, ScoreStd = 2.5;
    private const double ScoreLsl = 90.0, ScoreUsl = 100.0;
    private const double CycleTimeMeanMs = 1200.0, CycleTimeStdMs = 80.0;

    /// <summary>🔴 <b>An ASSUMED warn-band width in SCORE POINTS — owner's ruling 2026-08-24, item 61,
    /// direction A.</b> 1.5 points is not a new number: it is exactly the margin the two-sided call
    /// produced before this fix (<c>(100 − 90) × 0.15</c>), kept deliberately so that the ONLY thing this
    /// change moves is WHICH edge the band hugs. Naming it as a constant also retires a defect item 61
    /// records about the old arrangement — that 1.5 existed nowhere in the tree as a literal, so anybody
    /// searching for it concluded the claim was wrong.
    ///
    /// <para><b>Why it has to be restated at all, measured rather than assumed.</b>
    /// <c>VerdictHelper.MarginOf</c>'s one-sided branch scales the margin off the seeded bound's own
    /// MAGNITUDE — <c>max(|bound| × fraction, 0.01)</c> — which is right for a leak rate whose limit (20)
    /// is the same order as its range, and wrong for a score whose limit (90) is nine times its range (10).
    /// At the default 0.15 the one-sided margin would be 13.5 points, so the warn band would swallow
    /// <c>[90, 103.5]</c> and EVERY reading would warn. That is measured, not feared, and it is why
    /// direction A costs two arguments at the call site rather than one.</para></summary>
    private const double AssumedScoreWarnBandPoints = 1.5;

    /// <summary>The fraction <see cref="VerdictHelper.Evaluate"/> is handed so its one-sided branch yields
    /// <see cref="AssumedScoreWarnBandPoints"/> against a bound of <see cref="ScoreLsl"/>. Derived, not
    /// authored, so the two cannot drift apart: change the band width and this follows.</summary>
    private const double ScoreWarnMarginFraction = AssumedScoreWarnBandPoints / ScoreLsl;

    private readonly double _targetPassRate;

    /// <summary>Builds a FUNCTIONAL_TEST model. It wires no <c>MachineConfigStore</c>, and machine type
    /// <c>FUNCTIONAL_TEST</c> has no <c>configKind</c> in <c>MachineParameterSchema</c> either, so — as with
    /// <see cref="AssemblySim"/> and <see cref="LeakTestSim"/> — there is no operator surface this
    /// constructor is failing to read; <see cref="SimulatorBase.CycleSecondsOverride"/> stays null and
    /// cadence is <see cref="MachineDescriptor.CycleSeconds"/>.
    ///
    /// <para>🔴 <b><paramref name="targetPassRate"/> has no supplier in this repository.</b> Measured at
    /// commit <c>5e194ab0</c> over every <c>*.cs</c> in the tree: the identifier occurs only inside this
    /// file. <c>SimulatorFactory.Create</c>'s <c>FUNCTIONAL_TEST</c> arm passes <c>(d, seed)</c> and has no
    /// parameter that could carry a third argument, so the trial runs at 0.97 on every functional tester
    /// this product builds. Same shape as <see cref="LeakTestSim"/>'s own third parameter.</para>
    ///
    /// <para>🔴 <b>OWNER'S RULING 2026-08-23, item 44: KEEP THE PARAMETER, RANGE-CHECK IT — and the item's
    /// own wording made a narrower claim about this one than about its sibling.</b> Item 44 asserts only
    /// that <c>LeakTestSim.maxLeakRatePa</c> is unchecked; it says nothing about this parameter, and the
    /// re-measurement is why. This constructor was never unguarded: it clamped. But
    /// <see cref="Math.Clamp(double,double,double)"/> compares with <c>&lt;</c> and <c>&gt;</c>, and
    /// <b>every ordered comparison against NaN is false</b> — so <c>double.NaN</c> passed straight through
    /// the clamp unchanged, and <c>passRoll &lt;= NaN</c> is false for every roll, forcing
    /// <see cref="Verdict.Fail"/> on 100% of this machine's cycles with no error anywhere. <b>A silent
    /// correction with a hole in it, not an absence of one.</b> The clamp is now a check: out of domain
    /// throws, naming the parameter and the value.</para></summary>
    /// <param name="d">The roster entry; see <see cref="SimulatorBase.Descriptor"/>.</param>
    /// <param name="seed">Determinism seed, forwarded to <see cref="SimulatorBase"/> unchanged.</param>
    /// <param name="targetPassRate">Probability, in [0, 1], that a cycle is allowed to be judged on its score
    /// at all. 🔴 <b>Since the owner's ruling of 2026-08-23 it is REFUSED rather than corrected</b> — a value
    /// outside [0, 1], or NaN, throws <see cref="ArgumentOutOfRangeException"/> from this constructor instead
    /// of being pulled silently to the nearest bound. The two ends stay meaningful and are still worth
    /// stating because they are legal: at 0 the trial rejects every roll above zero, which is every roll in
    /// practice — <see cref="Random.NextDouble"/> can return exactly 0.0 and the comparison is inclusive, so
    /// <see cref="Verdict.Fail"/> is forced with probability 1 rather than by construction; at 1 the trial is
    /// disabled entirely and the score alone decides. Nothing supplies it today (see the summary).
    ///
    /// <para><b>The cost of refusing rather than correcting, stated:</b> a caller that passed <c>1.5</c> used
    /// to get a working simulator at 1.0 and now gets an exception. No such caller exists in this repository
    /// — that is item 44's own measurement, re-run at <c>47862d2a</c> — so the blast radius today is zero and
    /// the change is a promise about tomorrow, not a repair of something breaking now.</para></param>
    /// <exception cref="ArgumentOutOfRangeException"><paramref name="targetPassRate"/> is NaN or lies outside
    /// [0, 1].</exception>
    public FunctionalTestSim(MachineDescriptor d, int seed, double targetPassRate = 0.97) : base(d, seed)
    {
        // Written as a negated range rather than as two ordered tests, for the same reason the NaN paragraph
        // above gives: `!(x >= 0 && x <= 1)` is true for NaN, while `x < 0 || x > 1` is false for it — which
        // is precisely the hole the clamp had. Item 39's shape: the message names the parameter and the
        // value, and ArgumentOutOfRangeException carries both structurally so neither can drift.
        if (!(targetPassRate >= 0.0 && targetPassRate <= 1.0))
        {
            throw new ArgumentOutOfRangeException(
                nameof(targetPassRate), targetPassRate,
                $"targetPassRate must be a probability in [0, 1]; got {targetPassRate.ToString(System.Globalization.CultureInfo.InvariantCulture)}. " +
                "NaN is refused here specifically: it survives Math.Clamp untouched and then makes every " +
                "pass-rate comparison false, which forces Verdict.Fail on every cycle with no error.");
        }

        _targetPassRate = targetPassRate;
    }

    /// <summary>Makes three draws every cycle — a functional score from <c>N(98, 2.5)</c> clamped to
    /// [0, 100], a cycle time from <c>N(1200, 80)</c> ms floored at 1, and a uniform roll for the pass-rate
    /// trial — and makes all three unconditionally, so the branch taken below never changes the draw
    /// sequence and the reading stays a function of (seed, cycle).
    ///
    /// <para><b>The trial is a gate, not a tie-break.</b> A roll above <c>targetPassRate</c> forces
    /// <see cref="Verdict.Fail"/> whatever the score was; only a roll at or below it lets the score decide.
    /// So a reading can carry a 99% functional score and a Fail verdict, and the metric a reader would use
    /// to explain the failure is the one the failure did not come from.</para>
    ///
    /// <para>🔴 <b>OWNER'S RULING 2026-08-24, item 61 — DIRECTION A: THE SCORE IS JUDGED AGAINST A
    /// ONE-SIDED BAND, AND THE SIDE THAT SURVIVES IS THE LOWER ONE.</b> Quoted verbatim from the ruling:
    /// <i>"Các còn số đang có đều là giả định và dùng để test nên ko cần quan tâm tính chính xác của nó,
    /// hãy đảm bảo rằng logic code của chức năng trong các trường hợp là đúng là được"</i>. Until this fix
    /// the call passed <c>[90, 100]</c>, so the margin was 1.5 and any score at or above 98.5 warned for
    /// hugging the UPPER limit — including the clamp at exactly 100, which is the best result the machine
    /// can report. Measured before the fix on the shipped <c>FCT-01</c> descriptor, seed 11, 100 000
    /// cycles: <b>Warn on 41 220 cycles = 41.220%</b>, of which the clamp at 100 accounted for 21.123% of
    /// all cycles. 100 is a SCALE CEILING, not an acceptance limit; 90 is the acceptance limit. So the
    /// verdict now seeds only the LSL, exactly as <see cref="LeakTestSim"/>'s fix seeds only the USL — the
    /// same rule ("drop the bound that is physics, keep the bound that is spec"), applied by ROLE rather
    /// than by side.</para>
    ///
    /// <para>🔴 <b>WHICH EXEMPTION THIS TOUCHES, NAMED RATHER THAN WALKED PAST.</b> One of the three
    /// standing exemptions is crossed, WITH PERMISSION granted 2026-08-24, for the reason the ruling gives:
    /// <b>the MQTT payload</b>. <c>Normalizer.VerdictToResult</c> carries the verdict out as <c>result</c>,
    /// so that field moves on this machine. It moves NO OEE number (item 2: Pass and Warn are both the GOOD
    /// column, and the trial-driven Fail rate is untouched) and it does NOT touch the third exemption, the
    /// SHAPE of the data on the wire — no field is added, removed or retyped, and the published
    /// <c>MetricSample</c> below is byte-identical to what it was.</para>
    ///
    /// <para>🔴 <b>AND HERE IS WHAT THE FIX DELIBERATELY LEAVES STANDING, because removing it would decide
    /// an item that is still on the owner's shelf.</b> The published metric still declares
    /// <c>Lsl = 90, Usl = 100</c> while the verdict is computed from ONE of them, so a reader who
    /// re-derives the verdict from the limits this reading publishes gets the PRE-FIX answer. That is
    /// precisely the residue open as owner-decisions item 62 against <see cref="LeakTestSim"/>, and this
    /// fix ADDS A SECOND MEMBER to its population rather than resolving it: item 62 is not in the group
    /// this ruling covers, and dropping the published ceiling here would answer it by side effect. Pinned,
    /// not hidden, by
    /// <c>AssumedProcessBandTests.Item61_Guard_ThePublishedScoreStillDeclaresACeilingTheVerdictDoesNotUse</c>.</para>
    ///
    /// <para>🔴 <b>THE NAME ON THE LINE ABOVE POINTS AT A METHOD THAT NO LONGER EXISTS — corrected
    /// 2026-08-25, and the dead name is left standing because it is what was written.</b> That guard was
    /// renamed on 2026-08-24, when the owner ruled item 62, to
    /// <c>AssumedProcessBandTests.Item62_Guard_ThePublishedScoreStillDeclaresACeilingTheVerdictDoesNotUse_OwnerRuled20260824</c>.
    /// This is not a cosmetic slip. This paragraph exists for exactly one purpose — to route a reader who
    /// is about to "fix" the published ceiling to the test that will stop them and explain why — and for a
    /// day it routed them to a symbol no search resolves. <b>An instruction that names a thing which is not
    /// there is the item 37 defect, and it is the ROUTING that had failed here, not the content.</b></para>
    ///
    /// <para>🔴 <b>THE OWNER'S RULING OF 2026-08-25 ON THIS EXACT QUESTION: "khong can phan lai, can toi uu"
    /// — the ruling STANDS, the work is to OPTIMISE inside it.</b> Direction B (keep the published pair,
    /// deliberately, with a signature) is unchanged and no published value on this line moves. The obvious
    /// cheap optimisation — drop this orphan ceiling, since this member is one day old and can have
    /// accumulated almost no reported history — WAS MEASURED AND REFUSED. Dropping it sets
    /// <c>MetricSample.Usl</c> to null, and <c>Mapping/Normalizer.cs</c> copies that field into the outgoing
    /// envelope unconditionally: on the retained MQTT mirror it becomes <c>"usl": null</c>, and on the HTTP
    /// ingest body the vendored client serialises with <c>JsonIgnoreCondition.WhenWritingNull</c> so the KEY
    /// DISAPPEARS. That is exemption (a) and exemption (b) together — the SAME two the leak-test member
    /// crosses, through the SAME line of the SAME file. <b>The age of a member does not decide which
    /// exemption a change crosses; those are two different predicates, and only the second one was ever the
    /// question.</b> "Optimise" is not a licence to exceed an exemption, so this stops here and is
    /// reported.</para>
    ///
    /// <para><b>What the score path answers now.</b> Fail below 88.5, Warn in <c>[88.5, 91.5]</c>, Pass
    /// above 91.5 — so a perfect 100 passes, and a score-driven Fail is still the rare event it was (3.8
    /// standard deviations out). Essentially every Fail this simulator emits still comes from the trial,
    /// not from the score, and that half of the old sentence is unchanged and still true.</para>
    ///
    /// <para><c>cycle_time</c> is published with no limits and takes no part in either path. Step type is
    /// the descriptor's own or the literal <c>functional_test</c>.</para></summary>
    public override DeviceReading NextCycle(long cycle)
    {
        var rng = Rng(cycle);
        var score = Math.Clamp(rng.NextGaussian(ScoreMean, ScoreStd), 0.0, 100.0);
        var cycleTimeMs = Math.Max(1.0, rng.NextGaussian(CycleTimeMeanMs, CycleTimeStdMs));
        var passRoll = rng.NextDouble();

        var reading = NewReading(cycle, ReadingKind.ProcessResult, Descriptor.StepType ?? "functional_test");
        reading.Metrics.Add(new MetricSample("functional_score", score, "%", ScoreLsl, ScoreUsl, ScoreMean));
        reading.Metrics.Add(new MetricSample("cycle_time", cycleTimeMs, "ms", null, null));

        // The pass-rate trial gates the outcome: if the unit "should" fail per the configured rate,
        // that wins even if the score itself looks fine — mirrors a functional tester whose overall
        // result depends on many discrete sub-checks (booleans), not just one continuous metric.
        reading.Verdict = passRoll <= _targetPassRate
            ? VerdictHelper.Evaluate(score, ScoreLsl, usl: null, warnMarginFraction: ScoreWarnMarginFraction)
            : Verdict.Fail;
        return reading;
    }
}
