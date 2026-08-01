using St4i.EdgeCore.Models;
using St4i.Connector.Abstractions.Models;

namespace St4i.EdgeCore.Drivers.Simulators;

/// <summary>
/// Ép (ASSEMBLY, press-fit) — doc-62 §6: lực ép N + độ sâu mm. No spec has been seeded for this
/// row yet ("chưa seed spec → warn-only"), so no LSL/USL is passed to <see cref="VerdictHelper"/> —
/// it always returns <see cref="Verdict.Warn"/> until a real spec exists.
/// </summary>
public sealed class AssemblySim : SimulatorBase
{
    private const double ForceMean = 450.0, ForceStd = 25.0;
    private const double DepthMean = 8.0, DepthStd = 0.3;

    public AssemblySim(MachineDescriptor d, int seed) : base(d, seed)
    {
    }

    public override DeviceReading NextCycle(long cycle)
    {
        var rng = Rng(cycle);
        var force = rng.NextGaussian(ForceMean, ForceStd);
        var depth = rng.NextGaussian(DepthMean, DepthStd);

        var reading = NewReading(cycle, ReadingKind.ProcessResult, Descriptor.StepType ?? "press_fit");
        reading.Metrics.Add(new MetricSample("press_force", force, "N", null, null, ForceMean));
        reading.Metrics.Add(new MetricSample("press_depth", depth, "mm", null, null, DepthMean));
        reading.Verdict = VerdictHelper.Evaluate(force, null, null);
        return reading;
    }
}
