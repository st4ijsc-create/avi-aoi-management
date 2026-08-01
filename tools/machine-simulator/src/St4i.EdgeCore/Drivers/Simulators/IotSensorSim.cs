using St4i.EdgeCore.Config;
using St4i.EdgeCore.Models;
using St4i.Connector.Abstractions.Models;

namespace St4i.EdgeCore.Drivers.Simulators;

/// <summary>
/// IoT sensor hub (IOT_SENSOR) — doc-62 §6: temperature/humidity/current dạng sin+nhiễu (sinusoid +
/// noise), sự kiện drift (periodic calibration-drift events), quality good/uncertain. TELEMETRY
/// kind carries no pass/fail verdict (doc-62 §6: "(telemetry, không verdict)").
///
/// Task 3 (docs/plans/2026-07-21-machine-config.md §4): <c>sampleRateHz</c>/<c>reportIntervalSec</c>
/// drive telemetry CADENCE (<see cref="CycleSecondsOverride"/>), not the sensor value physics above,
/// which are unchanged. <b>Cadence model</b> — <c>cadence = min(1 ÷ sampleRateHz, reportIntervalSec)</c>:
/// a sensor emits every <c>1/sampleRateHz</c> seconds by definition, but a report is never held back
/// longer than <c>reportIntervalSec</c> even if the configured sample rate is very slow — so whichever of
/// the two is the tighter constraint wins. Monotonic in the direction an operator expects: raising
/// <c>sampleRateHz</c> (holding <c>reportIntervalSec</c> above <c>1/sampleRateHz</c> so it isn't the
/// binding constraint) shortens the cadence; lowering <c>reportIntervalSec</c> below <c>1/sampleRateHz</c>
/// also shortens it.
/// </summary>
public sealed class IotSensorSim : SimulatorBase
{
    private const double TempBaseC = 24.0, TempAmplitudeC = 3.0, TempNoiseStd = 0.3;
    private const double HumidityBasePct = 55.0, HumidityAmplitudePct = 8.0, HumidityNoiseStd = 1.0;
    private const double CurrentBaseA = 1.2, CurrentAmplitudeA = 0.15, CurrentNoiseStd = 0.02;

    private const double PeriodCycles = 120.0; // one full sinusoidal cycle every 120 samples
    private const long DriftEveryCycles = 200; // a slow calibration-drift "event" every N cycles
    private const double DriftMagnitudeC = 1.5;

    /// <summary>Same floor value EngineApi's own <c>FleetHost.MinCycleSeconds</c> uses (mirrored, not
    /// shared — EdgeCore doesn't reference EngineApi).</summary>
    private const double MinCycleSecondsFloor = 0.05;

    public IotSensorSim(MachineDescriptor d, int seed, MachineConfigStore? configStore = null, Func<string?>? productCodeProvider = null, double cycleRateMultiplier = 1.0)
        : base(d, seed, MachineParameterSchema.IotSettings, configStore, productCodeProvider, cycleRateMultiplier)
    {
    }

    /// <summary>Task 3 cadence model — see class remarks. Null (no override) when this instance has no
    /// <see cref="MachineConfigStore"/> wired.
    ///
    /// I-5 (mc-feature-review.md) — divided by <see cref="SimulatorBase.CycleRateMultiplier"/> before the
    /// floor, same composition <see cref="ScrewdriveSim.CycleSecondsOverride"/> applies — without this, a
    /// scenario like <c>sensor-drift</c> (whose whole purpose is accelerating IOT_SENSOR) had no effect on
    /// this machine type at all once a config store was wired (which production always is).</summary>
    public override double? CycleSecondsOverride
    {
        get
        {
            var cfg = ResolveEffectiveConfig();
            if (cfg is null) return null;

            var sampleRateHz = GetValue(cfg, "sampleRateHz", 1.0);
            var reportIntervalSec = GetValue(cfg, "reportIntervalSec", 60.0);
            var cadence = Math.Min(1.0 / Math.Max(sampleRateHz, 1e-6), reportIntervalSec) / CycleRateMultiplier;
            return Math.Max(cadence, MinCycleSecondsFloor);
        }
    }

    public override DeviceReading NextCycle(long cycle)
    {
        var rng = Rng(cycle);
        var phase = 2.0 * Math.PI * (cycle % (long)PeriodCycles) / PeriodCycles;

        // Drift: a deterministic, index-driven offset that "sticks" for a block of cycles once
        // every DriftEveryCycles — simulates sensor calibration drift without any wall-clock input.
        var driftBucket = cycle / DriftEveryCycles;
        var isDriftEvent = driftBucket % 2 == 1;
        var drift = isDriftEvent ? DriftMagnitudeC : 0.0;
        var quality = isDriftEvent ? "uncertain" : "good";

        var temperature = TempBaseC + drift + TempAmplitudeC * Math.Sin(phase) + rng.NextGaussian(0, TempNoiseStd);
        var humidity = HumidityBasePct + HumidityAmplitudePct * Math.Sin(phase + Math.PI / 3) + rng.NextGaussian(0, HumidityNoiseStd);
        var current = CurrentBaseA + CurrentAmplitudeA * Math.Sin(phase + Math.PI / 6) + rng.NextGaussian(0, CurrentNoiseStd);

        var reading = NewReading(cycle, ReadingKind.Telemetry, Descriptor.StepType);
        reading.Verdict = Verdict.Skip; // no pass/fail concept applies to telemetry
        reading.Telemetry.Add(new TelemetrySample("temperature", Math.Round(temperature, 2), "C", quality));
        reading.Telemetry.Add(new TelemetrySample("humidity", Math.Round(humidity, 2), "%RH", quality));
        reading.Telemetry.Add(new TelemetrySample("current", Math.Round(current, 3), "A", quality));

        // WS3-T1 — one plan step per telemetry channel THIS SAME tick reported above (never a separate
        // draw): "IoT to sample ticks" (design-doc §3.2/§3.4) — a web twin can trace a moving point along
        // each channel's own waveform arc, paced by this sensor's real report cadence
        // (CycleSecondsOverride below), instead of a decorative CSS loop. No per-step Result — telemetry
        // carries no pass/fail concept (see reading.Verdict above), mirrored here as a null Result on
        // every step rather than inventing one.
        reading.Plan = new CyclePlan(cycle, reading.Timestamp, CycleSecondsOverride ?? Descriptor.CycleSeconds,
        [
            new CyclePlanStep(0, "temperature", 0.25, 0.5, Result: null, Math.Round(temperature, 2), "C"),
            new CyclePlanStep(1, "humidity", 0.50, 0.5, Result: null, Math.Round(humidity, 2), "%RH"),
            new CyclePlanStep(2, "current", 0.75, 0.5, Result: null, Math.Round(current, 3), "A"),
        ]);

        return reading;
    }
}
