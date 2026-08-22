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

    /// <summary>Builds an ASSEMBLY model with no tuning surface at all. It passes neither a
    /// <c>configKind</c> nor a <c>MachineConfigStore</c> to <see cref="SimulatorBase"/> and accepts no
    /// argument that could supply either, so <c>ResolveEffectiveConfig</c> answers null for this instance's
    /// whole life and <see cref="SimulatorBase.CycleSecondsOverride"/> keeps the base's null — cadence is
    /// <see cref="MachineDescriptor.CycleSeconds"/>.
    ///
    /// <para>Unlike <see cref="WelderSim"/> and <see cref="DispensingSim"/>, that is not a gap here: machine
    /// type <c>ASSEMBLY</c> has no <c>configKind</c> in <c>MachineParameterSchema</c> at all — that class
    /// names <c>ASSEMBLY</c>, <c>LEAK_TEST</c> and <c>FUNCTIONAL_TEST</c> in its own remarks as types with no
    /// operating-configuration parameter set — so there is nothing an operator could set that this
    /// constructor is failing to read.</para></summary>
    public AssemblySim(MachineDescriptor d, int seed) : base(d, seed)
    {
    }

    /// <summary>Draws a press force from <c>N(450, 25)</c> N and a depth from <c>N(8, 0.3)</c> mm and
    /// publishes both with no LSL and no USL.
    ///
    /// <para>🔴 <b>The consequence is that this simulator has ONE reachable verdict.</b>
    /// <c>VerdictHelper.Evaluate</c> is called with both limits null, and its first branch answers
    /// <see cref="Verdict.Warn"/> whenever neither limit is seeded — so every reading this simulator
    /// produces is Warn, and <see cref="Verdict.Pass"/> and <see cref="Verdict.Fail"/> are unreachable from
    /// it until a spec exists. (That is a statement about this class, not about ASSEMBLY machines: one
    /// driven by a real connector is judged by whatever that connector reports.) This is the "chưa seed spec → warn-only" row of doc-62 §6 behaving as
    /// designed, but it is worth reading in the other direction too: downstream, Warn counts as GOOD for
    /// OEE (owner-decisions item 2), so an assembly cell is never quality-penalised by this model rather
    /// than being flagged as unjudged.</para>
    ///
    /// <para><c>press_depth</c> is published and never judged even in principle — only the force is passed
    /// to the verdict call. Step type is the descriptor's own or the literal <c>press_fit</c>.</para></summary>
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
