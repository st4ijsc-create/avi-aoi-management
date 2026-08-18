using St4i.EdgeCore.Models;

namespace St4i.EdgeCore.Drivers.Simulators;

/// <summary>
/// Bắt vít (SCREWDRIVE) — doc-62 §6: torque ~N(12.0,0.4)Nm + angle ~N(350,10)°, waveform
/// torque-vs-angle (ramp). Verdict from torque vs. seeded LSL/USL.
/// </summary>
public sealed class ScrewdriveSim : SimulatorBase
{
    private const double TorqueMean = 12.0, TorqueStd = 0.4;
    private const double TorqueLsl = 10.8, TorqueUsl = 13.2;
    private const double AngleMean = 350.0, AngleStd = 10.0;
    private const int WaveformPoints = 20;

    public ScrewdriveSim(MachineDescriptor d, int seed) : base(d, seed)
    {
    }

    public override DeviceReading NextCycle(long cycle)
    {
        var rng = Rng(cycle);
        var torque = rng.NextGaussian(TorqueMean, TorqueStd);
        var angle = rng.NextGaussian(AngleMean, AngleStd);
        var waveform = BuildTorqueAngleWaveform(rng, torque, angle);

        var reading = NewReading(cycle, ReadingKind.ProcessResult, Descriptor.StepType ?? "screw_tightening");
        reading.Metrics.Add(new MetricSample("torque", torque, "Nm", TorqueLsl, TorqueUsl, TorqueMean));
        reading.Metrics.Add(new MetricSample("angle", angle, "deg", null, null, AngleMean));
        reading.Waveforms.Add(waveform);
        reading.Verdict = VerdictHelper.Evaluate(torque, TorqueLsl, TorqueUsl);
        return reading;
    }

    /// <summary>Monotonic ramp from 0 to the final (angle, torque), with small per-sample noise —
    /// stands in for the torque-vs-angle curve a real screwdriver controller streams.</summary>
    private static WaveformSeries BuildTorqueAngleWaveform(Random rng, double finalTorque, double finalAngle)
    {
        var samples = new List<double[]>(WaveformPoints);
        for (var i = 1; i <= WaveformPoints; i++)
        {
            var frac = (double)i / WaveformPoints;
            var angle = finalAngle * frac;
            var torque = finalTorque * frac + (rng.NextDouble() - 0.5) * 0.05;
            samples.Add(new[] { angle, torque });
        }

        return new WaveformSeries("torque_vs_angle", "Nm", null, samples);
    }
}
