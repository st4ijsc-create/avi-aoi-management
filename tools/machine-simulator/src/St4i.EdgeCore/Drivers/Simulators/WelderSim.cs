using St4i.EdgeCore.Models;
using St4i.Connector.Abstractions.Models;

namespace St4i.EdgeCore.Drivers.Simulators;

/// <summary>
/// Hàn (WELDER) — doc-62 §6: weld_current A + weld_time ms, waveform dòng hàn (weld-current
/// curve). Verdict from current vs. LSL/USL.
/// </summary>
public sealed class WelderSim : SimulatorBase
{
    private const double CurrentMean = 180.0, CurrentStd = 6.0;
    private const double CurrentLsl = 165.0, CurrentUsl = 195.0;
    private const double TimeMeanMs = 120.0, TimeStdMs = 5.0;
    private const int WaveformPoints = 24;

    /// <summary>Builds a WELDER model whose parameters are the constants above and nothing else. It passes
    /// neither a <c>configKind</c> nor a <c>MachineConfigStore</c> to <see cref="SimulatorBase"/> and takes
    /// no argument that could supply either, so <c>SimulatorBase.ConfigStore</c> is null for the instance's
    /// whole life, <c>ResolveEffectiveConfig</c> answers null, and <see cref="SimulatorBase.CycleSecondsOverride"/>
    /// keeps the base's null — this machine's cadence is <see cref="MachineDescriptor.CycleSeconds"/> and
    /// its limits are <c>CurrentLsl</c>/<c>CurrentUsl</c>, whatever an operator has configured.
    ///
    /// <para>🔴 <b>An operator CAN configure this machine, and the values do not arrive here.</b>
    /// <c>MachineParameterSchema</c> defines a <c>weld_profile</c> kind for machine type
    /// <c>WELDER</c> with four parameters — <c>current</c>, <c>time</c>, <c>tempMax</c>, <c>voltage</c> —
    /// range-checked on write and served over the machine-settings API. Two of those four name the very
    /// quantities <see cref="NextCycle"/> draws, which it publishes under the keys <c>weld_current</c> and
    /// <c>weld_time</c>. Measured at commit <c>5e194ab0</c>: no constructor in this
    /// class accepts a store, and <c>SimulatorFactory.Create</c>'s <c>WELDER</c> arm passes only
    /// <c>(d, seed)</c>, so nothing carries a <c>weld_profile</c> value into a draw.</para></summary>
    public WelderSim(MachineDescriptor d, int seed) : base(d, seed)
    {
    }

    /// <summary>Draws a weld current from <c>N(180, 6)</c> A and a weld time from <c>N(120, 5)</c> ms floored
    /// at 1 ms, then emits both as metrics plus a 24-point current waveform whose sample rate is derived
    /// from the drawn duration rather than fixed.
    ///
    /// <para><b>The verdict is decided by the CURRENT alone.</b> <c>weld_time</c> is published with no
    /// LSL/USL and takes no part in it, so a weld that ran for an implausible duration at a good current
    /// reports the same result as a normal one. <c>VerdictHelper</c> also warns NEAR the limits, not only
    /// outside them: with the band <c>[165, 195]</c> its margin is 4.5 A, so a current inside spec but at or
    /// below 169.5 A or at or above 190.5 A is <see cref="Verdict.Warn"/>, and
    /// <see cref="Verdict.Fail"/> begins below 160.5 A or above 199.5 A.</para>
    ///
    /// <para>The step type is the descriptor's own, or the literal <c>weld_spot</c> when it is null — this
    /// class substitutes rather than passing null through. Every value comes from
    /// <c>SimulatorBase.Rng(cycle)</c>, including the waveform's per-sample noise, so the whole reading is a
    /// function of (seed, cycle) with no wall-clock input except the timestamp
    /// <c>SimulatorBase.NewReading</c> stamps.</para></summary>
    public override DeviceReading NextCycle(long cycle)
    {
        var rng = Rng(cycle);
        var current = rng.NextGaussian(CurrentMean, CurrentStd);
        var timeMs = Math.Max(1.0, rng.NextGaussian(TimeMeanMs, TimeStdMs));
        var waveform = BuildCurrentWaveform(rng, current, timeMs);

        var reading = NewReading(cycle, ReadingKind.ProcessResult, Descriptor.StepType ?? "weld_spot");
        reading.Metrics.Add(new MetricSample("weld_current", current, "A", CurrentLsl, CurrentUsl, CurrentMean));
        reading.Metrics.Add(new MetricSample("weld_time", timeMs, "ms", null, null, TimeMeanMs));
        reading.Waveforms.Add(waveform);
        reading.Verdict = VerdictHelper.Evaluate(current, CurrentLsl, CurrentUsl);
        return reading;
    }

    /// <summary>Fast rise / flat-top / short decay envelope over the weld duration — a stand-in for
    /// the current-vs-time trace a real weld controller streams.</summary>
    private static WaveformSeries BuildCurrentWaveform(Random rng, double peakCurrent, double durationMs)
    {
        var rateHz = WaveformPoints / (durationMs / 1000.0);
        var samples = new List<double[]>(WaveformPoints);
        for (var i = 0; i < WaveformPoints; i++)
        {
            var t = i / (double)(WaveformPoints - 1);
            var envelope = Math.Sin(Math.PI * Math.Min(t * 1.4, 1.0));
            var current = peakCurrent * envelope + (rng.NextDouble() - 0.5) * (peakCurrent * 0.02);
            samples.Add(new[] { current });
        }

        return new WaveformSeries("weld_current", "A", rateHz, samples);
    }
}
