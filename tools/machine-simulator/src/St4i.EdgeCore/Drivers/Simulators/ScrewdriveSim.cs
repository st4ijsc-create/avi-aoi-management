using St4i.EdgeCore.Config;
using St4i.EdgeCore.Models;

namespace St4i.EdgeCore.Drivers.Simulators;

/// <summary>
/// Bắt vít (SCREWDRIVE) — doc-62 §6: torque ~N(12.0,0.4)Nm + angle ~N(350,10)°, waveform
/// torque-vs-angle (ramp). Verdict from torque vs. seeded LSL/USL.
///
/// Task 3 (docs/plans/2026-07-21-machine-config.md §4): when constructed with a
/// <see cref="MachineConfigStore"/>, the fixed constants below are only the FALLBACK used until a config
/// is wired — <see cref="NextCycle"/> instead re-resolves <c>torqueTarget</c>/<c>torqueTolerance</c> on
/// every cycle (see class remarks on the formula), and <see cref="CycleSecondsOverride"/> re-resolves
/// <c>speedRpm</c>/<c>clampTimeMs</c> into a cadence.
///
/// <b>Torque model</b> — <c>torque ~ N(torqueTarget, torqueTarget·ProcessNoiseFraction)</c>: the mean
/// tracks the operator's target directly; the standard deviation is a FIXED FRACTION of the target
/// (representing the tool's own inherent mechanical repeatability, e.g. rated as "±3% of reading" the
/// way real torque drivers are), deliberately NOT derived from <c>torqueTolerance</c> — physically, an
/// operator tightening the ACCEPTANCE window does not make the tool itself more repeatable. The pass/fail
/// band is <c>[torqueTarget − torqueTolerance, torqueTarget + torqueTolerance]</c>. Because the process
/// std stays fixed while the band narrows, tightening <c>torqueTolerance</c> shrinks the band's z-score
/// (band ÷ std) and therefore monotonically raises the NG rate — the exact "siết dung sai ⇒ nhiều NG hơn"
/// design-doc §4 requirement, verified statistically by <c>MachineConfigDrivesSimulationTests</c>.
///
/// <b>Cadence model</b> — <c>cycleSeconds = HandlingOverheadSeconds + (SpinRevolutions ÷ (speedRpm÷60)) +
/// clampTimeMs÷1000</c>: a fixed pick/place/tool-positioning overhead, plus how long a fixed number of
/// screw revolutions takes to spin at the configured rpm, plus the configured clamp dwell. Monotonic in
/// both directions an operator expects: faster <c>speedRpm</c> ⇒ shorter cycle; longer <c>clampTimeMs</c>
/// ⇒ longer cycle.
/// </summary>
public sealed class ScrewdriveSim : SimulatorBase
{
    private const double TorqueMean = 12.0, TorqueStd = 0.4;
    private const double TorqueLsl = 10.8, TorqueUsl = 13.2;
    private const double AngleMean = 350.0, AngleStd = 10.0;
    private const int WaveformPoints = 20;

    /// <summary>Fraction of <c>torqueTarget</c> used as the generated torque's standard deviation — the
    /// tool's own fixed mechanical repeatability, independent of the operator-set tolerance band. See
    /// class remarks.</summary>
    private const double ProcessNoiseFraction = 0.03;

    /// <summary>Fixed number of screw revolutions the cadence model spins through at <c>speedRpm</c>.</summary>
    private const double SpinRevolutions = 3.0;

    /// <summary>Fixed pick/place/tool-positioning overhead the cadence model adds regardless of config.</summary>
    private const double HandlingOverheadSeconds = 0.2;

    /// <summary>Same floor value EngineApi's own <c>FleetHost.MinCycleSeconds</c> uses (mirrored, not
    /// shared, since EdgeCore doesn't reference EngineApi) — a cadence must never reach zero/negative
    /// even at extreme config values.</summary>
    private const double MinCycleSecondsFloor = 0.05;

    public ScrewdriveSim(MachineDescriptor d, int seed, MachineConfigStore? configStore = null, Func<string?>? productCodeProvider = null, double cycleRateMultiplier = 1.0)
        : base(d, seed, MachineParameterSchema.ScrewProgram, configStore, productCodeProvider, cycleRateMultiplier)
    {
    }

    public override DeviceReading NextCycle(long cycle)
    {
        var rng = Rng(cycle);
        var cfg = ResolveEffectiveConfig();

        var torqueTarget = GetValue(cfg, "torqueTarget", TorqueMean);
        var torqueTolerance = GetValue(cfg, "torqueTolerance", TorqueUsl - TorqueMean);
        var torqueStd = cfg is null ? TorqueStd : Math.Max(torqueTarget * ProcessNoiseFraction, 1e-6);
        var lsl = cfg is null ? TorqueLsl : torqueTarget - torqueTolerance;
        var usl = cfg is null ? TorqueUsl : torqueTarget + torqueTolerance;

        var torque = rng.NextGaussian(torqueTarget, torqueStd);
        var angle = rng.NextGaussian(AngleMean, AngleStd);
        var waveform = BuildTorqueAngleWaveform(rng, torque, angle);

        var reading = NewReading(cycle, ReadingKind.ProcessResult, Descriptor.StepType ?? "screw_tightening");
        reading.Metrics.Add(new MetricSample("torque", torque, "Nm", lsl, usl, torqueTarget));
        reading.Metrics.Add(new MetricSample("angle", angle, "deg", null, null, AngleMean));
        reading.Waveforms.Add(waveform);
        reading.Verdict = VerdictHelper.Evaluate(torque, lsl, usl);
        return reading;
    }

    /// <summary>Task 3 cadence model — see class remarks. Returns null (no override — the driver falls
    /// back to <see cref="MachineDescriptor.CycleSeconds"/>) when this instance has no
    /// <see cref="MachineConfigStore"/> wired.
    ///
    /// I-5 (mc-feature-review.md) — the config-derived cadence is divided by <see cref="SimulatorBase.CycleRateMultiplier"/>
    /// before the floor is applied, composing it with whichever scenario is active instead of silently
    /// ignoring it (a config override used to always win outright over the descriptor-baked multiplier —
    /// see that property's doc comment). A multiplier &gt;1 (e.g. <c>sensor-drift</c>'s 5x, Burst's 6x)
    /// shortens the resulting cadence, exactly as it already does for every un-wired simulator.</summary>
    public override double? CycleSecondsOverride
    {
        get
        {
            var cfg = ResolveEffectiveConfig();
            if (cfg is null) return null;

            var speedRpm = GetValue(cfg, "speedRpm", 450);
            var clampTimeMs = GetValue(cfg, "clampTimeMs", 250);
            var spinSeconds = SpinRevolutions * 60.0 / Math.Max(speedRpm, 1e-6);
            var cycleSeconds = (HandlingOverheadSeconds + spinSeconds + clampTimeMs / 1000.0) / CycleRateMultiplier;
            return Math.Max(cycleSeconds, MinCycleSecondsFloor);
        }
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
