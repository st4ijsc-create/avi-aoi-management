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
    /// <para>🔴 <b>On the score path, Warn is the ordinary outcome rather than the exceptional one.</b> The
    /// band is <c>[90, 100]</c>, so <c>VerdictHelper</c>'s margin is 1.5 and any score at or above 98.5
    /// warns for hugging the upper limit — with a mean of 98 that is about 42% of the cycles the trial lets
    /// through, and the clamp at 100 lands exactly on the USL, which warns rather than fails. A score-driven
    /// Fail needs to fall below 88.5, which is 3.8 standard deviations out; in practice essentially every
    /// Fail this simulator emits comes from the trial, not from the score.</para>
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
            ? VerdictHelper.Evaluate(score, ScoreLsl, ScoreUsl)
            : Verdict.Fail;
        return reading;
    }
}
