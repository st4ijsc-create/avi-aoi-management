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
    /// this product builds. Same shape as <see cref="LeakTestSim"/>'s own third parameter.</para></summary>
    /// <param name="d">The roster entry; see <see cref="SimulatorBase.Descriptor"/>.</param>
    /// <param name="seed">Determinism seed, forwarded to <see cref="SimulatorBase"/> unchanged.</param>
    /// <param name="targetPassRate">Probability, in [0, 1], that a cycle is allowed to be judged on its
    /// score at all. Unlike <see cref="LeakTestSim"/>'s limit this one IS corrected rather than trusted —
    /// <see cref="Math.Clamp(double,double,double)"/> pulls anything outside [0, 1] to the nearest bound.
    /// At 0 the trial rejects every roll above zero, which is every roll in practice —
    /// <see cref="Random.NextDouble"/> can return exactly 0.0 and the comparison is inclusive, so
    /// <see cref="Verdict.Fail"/> is forced with probability 1 rather than by construction. Any value at or
    /// above 1 disables the trial entirely. Nothing supplies it today (see the summary).</param>
    public FunctionalTestSim(MachineDescriptor d, int seed, double targetPassRate = 0.97) : base(d, seed)
    {
        _targetPassRate = Math.Clamp(targetPassRate, 0.0, 1.0);
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
