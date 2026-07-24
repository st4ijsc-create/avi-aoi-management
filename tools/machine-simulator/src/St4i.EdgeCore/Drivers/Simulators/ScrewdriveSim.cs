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

    /// <summary>WS3-T1 — fixed number of physical fastening positions this cycle's plan visits: a
    /// plausible small-board layout (matches the flavor of the seeded automation recipe's own
    /// <c>screwCount</c>, see <c>ProductConfigStore.SeedRecipes</c>), on the same "fixed constant"
    /// footing as <see cref="SpinRevolutions"/>/<see cref="WaveformPoints"/> above — the schema has no
    /// per-board screw-count parameter to drive this from.</summary>
    private const int FasteningPositionsPerCycle = 4;

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

        // WS3-T1 — the fastening-sequence plan for the twin. Step 0 reuses THIS SAME torque draw/verdict
        // (never a second, independently-drawn "claim" about the primary screw); steps 1..N-1 draw fresh
        // from the identical resolved distribution. Any step's own NG is then folded into the reading's
        // aggregate Verdict below — "aggregate == per-step tally" (design-doc §3.4/§4), not a second,
        // disagreeing narrative. With the schema-default torqueTolerance this almost never fires (the
        // baseline NG rate stays near zero, same as before this task); a tightened torqueTolerance makes
        // it fire far more often, exactly the "siết dung sai ⇒ nhiều điểm đỏ hơn trên bản vẽ" WS3-T1
        // exists to expose.
        var plan = BuildFasteningPlan(
            rng, cycle, reading.Timestamp, CycleSecondsOverride ?? Descriptor.CycleSeconds,
            torqueTarget, torqueStd, lsl, usl, torque, reading.Verdict);
        if (plan.Steps.Any(s => s.Result == "NG")) reading.Verdict = Verdict.Fail;
        reading.Plan = plan;

        return reading;
    }

    /// <summary>See <see cref="FasteningPositionsPerCycle"/> and this method's call site for the
    /// "aggregate == per-step tally" contract. Positions are evenly spaced along the board's normalized
    /// width at a fixed centreline height — pure data (this task makes no web change), for a future twin
    /// build to place the head along.</summary>
    private static CyclePlan BuildFasteningPlan(
        Random rng, long cycle, DateTimeOffset startedAt, double durationSeconds,
        double torqueTarget, double torqueStd, double lsl, double usl,
        double primaryTorque, Verdict primaryVerdict)
    {
        var steps = new List<CyclePlanStep>(FasteningPositionsPerCycle);
        for (var i = 0; i < FasteningPositionsPerCycle; i++)
        {
            double torque;
            Verdict verdict;
            if (i == 0)
            {
                // The exact same draw/verdict already computed above — not a second, disagreeing sample.
                torque = primaryTorque;
                verdict = primaryVerdict;
            }
            else
            {
                torque = rng.NextGaussian(torqueTarget, torqueStd);
                verdict = VerdictHelper.Evaluate(torque, lsl, usl);
            }

            var nx = FasteningPositionsPerCycle == 1
                ? 0.5
                : 0.2 + i * (0.6 / (FasteningPositionsPerCycle - 1));

            steps.Add(new CyclePlanStep(
                Index: i,
                PointCode: $"FSTN-{i + 1:D2}",
                NormalizedX: nx,
                NormalizedY: 0.5,
                Result: verdict == Verdict.Fail ? "NG" : "OK",
                MetricValue: Math.Round(torque, 3),
                Unit: "Nm"));
        }

        return new CyclePlan(cycle, startedAt, durationSeconds, steps);
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
