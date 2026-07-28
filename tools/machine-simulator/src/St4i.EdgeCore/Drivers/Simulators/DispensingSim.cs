using St4i.EdgeCore.Models;
using St4i.Connector.Abstractions.Models;

namespace St4i.EdgeCore.Drivers.Simulators;

/// <summary>
/// Điểm keo (DISPENSING) — doc-62 §6: volume ~N(0.21,0.01)mL + pressure kPa, "tương quan nhiệt"
/// (pressure correlates with ambient temperature). Verdict from volume vs. LSL/USL.
/// </summary>
public sealed class DispensingSim : SimulatorBase
{
    private const double VolumeMean = 0.21, VolumeStd = 0.01;
    private const double VolumeLsl = 0.19, VolumeUsl = 0.23;
    private const double TempMean = 25.0, TempStd = 1.5;
    private const double PressureBase = 250.0, PressureTempCoeffKPaPerC = 1.5, PressureNoiseStd = 3.0;

    public DispensingSim(MachineDescriptor d, int seed) : base(d, seed)
    {
    }

    public override DeviceReading NextCycle(long cycle)
    {
        var rng = Rng(cycle);
        var volume = rng.NextGaussian(VolumeMean, VolumeStd);
        var temperature = rng.NextGaussian(TempMean, TempStd);
        var pressure = PressureBase + PressureTempCoeffKPaPerC * (temperature - TempMean) + rng.NextGaussian(0, PressureNoiseStd);

        var reading = NewReading(cycle, ReadingKind.ProcessResult, Descriptor.StepType ?? "glue_dispense");
        reading.Metrics.Add(new MetricSample("volume", volume, "mL", VolumeLsl, VolumeUsl, VolumeMean));
        reading.Metrics.Add(new MetricSample("pressure", pressure, "kPa", null, null));
        reading.Metrics.Add(new MetricSample("temperature", temperature, "C", null, null, TempMean));
        reading.Verdict = VerdictHelper.Evaluate(volume, VolumeLsl, VolumeUsl);
        return reading;
    }
}
