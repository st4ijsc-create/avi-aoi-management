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

    /// <summary>Builds a DISPENSING model whose parameters are the constants above. It passes neither a
    /// <c>configKind</c> nor a <c>MachineConfigStore</c> to <see cref="SimulatorBase"/> and accepts no
    /// argument that could supply either, so <c>ResolveEffectiveConfig</c> answers null for the instance's
    /// whole life and <see cref="SimulatorBase.CycleSecondsOverride"/> keeps the base's null — cadence is
    /// <see cref="MachineDescriptor.CycleSeconds"/>.
    ///
    /// <para>🔴 <b>Same shape as <see cref="WelderSim"/>, and the name collision here is sharper.</b>
    /// <c>MachineParameterSchema</c> defines a <c>dispense_program</c> kind for machine type
    /// <c>DISPENSING</c> whose four parameters are <c>volumeTarget</c>, <c>pressure</c>, <c>speed</c> and
    /// <c>temperature</c>; TWO of those keys — <c>pressure</c> and <c>temperature</c> — are spelled exactly
    /// as metric keys <see cref="NextCycle"/> publishes below, and a third, <c>volumeTarget</c>, names the
    /// quantity behind the <c>volume</c> metric without matching its key.
    /// Measured at commit <c>5e194ab0</c>: no constructor here accepts a store and
    /// <c>SimulatorFactory.Create</c>'s <c>DISPENSING</c> arm passes only <c>(d, seed)</c>, so an operator
    /// who raises <c>pressure</c> on the settings surface changes the stored record and not the
    /// <c>pressure</c> metric this machine reports.</para></summary>
    public DispensingSim(MachineDescriptor d, int seed) : base(d, seed)
    {
    }

    /// <summary>Draws a dispensed volume from <c>N(0.21, 0.01)</c> mL and an ambient temperature from
    /// <c>N(25, 1.5)</c> °C, then DERIVES the pressure from that same temperature —
    /// <c>250 + 1.5·(temperature − 25) + N(0, 3)</c> kPa. Pressure is therefore not an independent draw: it
    /// is correlated with the temperature reported in the same reading by construction, which is the
    /// "tương quan nhiệt" the class remarks name, and a consumer that treats the two as independent
    /// channels is reading a relationship this model put there on purpose.
    ///
    /// <para><b>Only the volume is judged.</b> Pressure and temperature are published with no LSL/USL and
    /// take no part in the verdict, so a batch running hot reports the same result as one at nominal.
    /// Against the band <c>[0.19, 0.23]</c> <c>VerdictHelper</c>'s margin is 0.006 mL, so a volume inside
    /// spec but at or below 0.196 or at or above 0.224 is <see cref="Verdict.Warn"/> — those cut points sit
    /// 1.4 standard deviations out, so about a sixth of cycles land there — and <see cref="Verdict.Fail"/>
    /// begins outside [0.184, 0.236].</para>
    ///
    /// <para>Step type is the descriptor's own or the literal <c>glue_dispense</c>.</para></summary>
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
