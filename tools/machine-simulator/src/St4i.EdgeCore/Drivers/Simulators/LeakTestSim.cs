using St4i.EdgeCore.Models;
using St4i.Connector.Abstractions.Models;

namespace St4i.EdgeCore.Drivers.Simulators;

/// <summary>
/// Leak (LEAK_TEST) — doc-62 §6: áp suất rò Pa/s (leak/pressure-decay rate), "ngưỡng cấu hình"
/// (configurable threshold — <c>maxLeakRatePa</c> below). Lower is better: leak rate
/// is judged against [0, maxLeakRatePa].
/// </summary>
public sealed class LeakTestSim : SimulatorBase
{
    private const double LeakRateMean = 8.0, LeakRateStd = 3.0;
    private readonly double _maxLeakRatePa;

    /// <summary>Builds a LEAK_TEST model. Like <see cref="AssemblySim"/> it wires no
    /// <c>MachineConfigStore</c> and machine type <c>LEAK_TEST</c> has no <c>configKind</c> in
    /// <c>MachineParameterSchema</c>, so there is no live-config surface to miss;
    /// <see cref="SimulatorBase.CycleSecondsOverride"/> stays null and cadence is
    /// <see cref="MachineDescriptor.CycleSeconds"/>.
    ///
    /// <para>🔴 <b><paramref name="maxLeakRatePa"/> is the one tunable this whole file has, and no caller in
    /// this repository sets it.</b> Measured at commit <c>5e194ab0</c> over every <c>*.cs</c> in the tree:
    /// the identifier occurs only inside this file. <c>SimulatorFactory.Create</c>'s <c>LEAK_TEST</c> arm
    /// passes <c>(d, seed)</c> and has no parameter that could carry a third argument, and every test
    /// construction passes two arguments as well — so the acceptance limit is 20.0 Pa/s on every leak
    /// tester this product builds, and the "ngưỡng cấu hình" of the class remarks is configurable only in
    /// the C# sense.</para></summary>
    /// <param name="d">The roster entry; see <see cref="SimulatorBase.Descriptor"/>.</param>
    /// <param name="seed">Determinism seed, forwarded to <see cref="SimulatorBase"/> unchanged.</param>
    /// <param name="maxLeakRatePa">The upper acceptance limit in Pa/s, stored as given. It is NOT validated
    /// or clamped: a value of zero makes every non-zero draw <see cref="Verdict.Fail"/>, and a negative one
    /// inverts the band handed to <c>VerdictHelper</c>. Nothing supplies it today (see the summary).</param>
    public LeakTestSim(MachineDescriptor d, int seed, double maxLeakRatePa = 20.0) : base(d, seed)
    {
        _maxLeakRatePa = maxLeakRatePa;
    }

    /// <summary>Draws a leak rate from <c>N(8, 3)</c> Pa/s and floors it at zero, then judges it against the
    /// one-sided band <c>[0, maxLeakRatePa]</c>. The floor is a clamp rather than a re-draw, so the
    /// distribution is truncated and the mass below zero — about 0.4% of cycles at these constants — arrives
    /// as exactly 0.0.
    ///
    /// <para>🔴 <b>The verdict warns at BOTH ends of that band, and for this quantity one of those ends is
    /// the ideal.</b> <c>VerdictHelper</c> has no notion of "lower is better": it takes the seeded LSL of
    /// 0.0 literally and applies the same 15% near-edge rule to it, giving a margin of 3.0 Pa/s at the
    /// default limit. So a leak rate at or below 3.0 Pa/s — the best result the machine can report, and
    /// including every clamped 0.0 — is <see cref="Verdict.Warn"/>, exactly as a rate in [17.0, 23.0] is.
    /// <see cref="Verdict.Pass"/> is reachable only in (3.0, 17.0) and <see cref="Verdict.Fail"/> only above
    /// 23.0; with this distribution roughly 5% of cycles warn for being too GOOD, which is more than warn
    /// for being too leaky.</para>
    ///
    /// <para>One metric, no waveform, step type from the descriptor or the literal <c>leak_test</c>.</para></summary>
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
