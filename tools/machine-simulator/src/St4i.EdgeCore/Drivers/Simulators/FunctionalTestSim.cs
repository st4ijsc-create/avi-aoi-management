using St4i.EdgeCore.Models;
using St4i.Connector.Abstractions.Models;

namespace St4i.EdgeCore.Drivers.Simulators;

/// <summary>
/// Functional test (FUNCTIONAL_TEST) — doc-62 §6: "pass-rate + vài metric số" ("tỉ lệ" verdict).
/// Each cycle draws a Bernoulli trial against <paramref name="targetPassRate"/> to decide
/// pass/fail (the "tỉ lệ"), independent of — but reported alongside — a numeric functional score.
/// </summary>
public sealed class FunctionalTestSim : SimulatorBase
{
    private const double ScoreMean = 98.0, ScoreStd = 2.5;
    private const double ScoreLsl = 90.0, ScoreUsl = 100.0;
    private const double CycleTimeMeanMs = 1200.0, CycleTimeStdMs = 80.0;

    private readonly double _targetPassRate;

    public FunctionalTestSim(MachineDescriptor d, int seed, double targetPassRate = 0.97) : base(d, seed)
    {
        _targetPassRate = Math.Clamp(targetPassRate, 0.0, 1.0);
    }

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
