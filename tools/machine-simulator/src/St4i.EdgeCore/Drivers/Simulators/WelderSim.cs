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

    public WelderSim(MachineDescriptor d, int seed) : base(d, seed)
    {
    }

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
