using St4i.EdgeCore.Models;

namespace St4i.EdgeCore.Drivers.Simulators;

/// <summary>
/// Leak (LEAK_TEST) — doc-62 §6: áp suất rò Pa/s (leak/pressure-decay rate), "ngưỡng cấu hình"
/// (configurable threshold — <paramref name="maxLeakRatePa"/> below). Lower is better: leak rate
/// is judged against [0, maxLeakRatePa].
/// </summary>
public sealed class LeakTestSim : SimulatorBase
{
    private const double LeakRateMean = 8.0, LeakRateStd = 3.0;
    private readonly double _maxLeakRatePa;

    public LeakTestSim(MachineDescriptor d, int seed, double maxLeakRatePa = 20.0) : base(d, seed)
    {
        _maxLeakRatePa = maxLeakRatePa;
    }

    public override DeviceReading NextCycle(long cycle)
    {
        var rng = Rng(cycle);
        var leakRate = Math.Max(0.0, rng.NextGaussian(LeakRateMean, LeakRateStd));

        var reading = NewReading(cycle, ReadingKind.ProcessResult, Descriptor.StepType ?? "leak_test");
        reading.Metrics.Add(new MetricSample("leak_rate", leakRate, "Pa/s", 0.0, _maxLeakRatePa, LeakRateMean));
        reading.Verdict = VerdictHelper.Evaluate(leakRate, 0.0, _maxLeakRatePa);
        return reading;
    }
}
