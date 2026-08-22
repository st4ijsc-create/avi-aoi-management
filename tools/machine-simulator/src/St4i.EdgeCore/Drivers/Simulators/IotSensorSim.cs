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

    /// <summary>Same floor value the fleet lifecycle's own <c>FleetCore.MinCycleSeconds</c> uses.
    ///
    /// <para>🔴 <b>Task E-2 — the STATED REASON for the duplication was "mirrored, not shared: EdgeCore
    /// doesn't reference EngineApi", and that reason is now FALSE:</b> <c>FleetCore</c> moved into THIS
    /// assembly, so both constants sit side by side (E-1 §2.3 predicted exactly this and required E-2 to
    /// either collapse them or record why not). <b>Recorded, deliberately not collapsed</b>, and not merely
    /// because a move must not smuggle in a fix: the two clamps are applied at DIFFERENT points to DIFFERENT
    /// quantities. <c>FleetCore.MinCycleSeconds</c> floors a roster descriptor's <c>CycleSeconds</c> as
    /// the pipeline build pre-scales it by the active scenario multiplier (🔴 task J-1:
    /// <c>FleetCore.BuildStartPlan</c>, off <c>_gate</c>, where it was <c>StartLocked</c> under it); this one floors a cadence THIS
    /// simulator computes from its own live config, which bypasses that descriptor entirely. Sharing one
    /// symbol would tie two independent clamps together and read as a coupling that does not exist. They
    /// agree at 0.05 today by intention, not by derivation.</para></summary>
    private const double MinCycleSecondsFloor = 0.05;

    /// <summary>Builds an IOT_SENSOR model and declares its config kind as
    /// <see cref="MachineParameterSchema.IotSettings"/>. See <see cref="SimulatorBase"/>'s own constructor
    /// for what each argument does, including that supplying a <paramref name="configStore"/> makes this
    /// constructor <see cref="MachineConfigStore.Ensure"/> an <c>iot_settings</c> record — a file write on
    /// first construction — and that it throws <see cref="InvalidOperationException"/> if this machine code
    /// already carries a record of another kind.
    ///
    /// <para><b><paramref name="productCodeProvider"/> is invoked and then ignored on this machine type,
    /// and that is by design rather than by omission.</b> <c>iot_settings</c> is the one
    /// <c>configKind</c> for which <c>MachineParameterSchema.SupportsProductScope</c> answers false, so
    /// <c>MachineConfigStore.Resolve</c> drops the product code before it looks at any adjustment layer.
    /// <c>SimulatorBase.ResolveEffectiveConfig</c> still calls the delegate to obtain that code on every
    /// resolve, so a slow or throwing provider costs exactly as much here as anywhere else while its answer
    /// can change nothing.</para>
    ///
    /// <para>This is also the only machine type that reads its config kind WHOLE: <c>iot_settings</c>
    /// defines two parameters, <c>sampleRateHz</c> and <c>reportIntervalSec</c>, and
    /// <see cref="CycleSecondsOverride"/> reads both.</para></summary>
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

    /// <summary>Emits a <see cref="ReadingKind.Telemetry"/> reading carrying three channels — temperature,
    /// humidity, current — and no measurements, no metrics and no waveform. Its
    /// <see cref="DeviceReading.Verdict"/> is set to <see cref="Verdict.Skip"/> explicitly rather than left
    /// at a default, because telemetry has no pass/fail concept here. It is one of the TWO simulators in
    /// this directory that never reach <c>VerdictHelper</c> — <see cref="AoiInspectorSim"/> is the other,
    /// for the unrelated reason that a board's result is a conjunction of its points rather than a margin
    /// judgement — and it is the only one that reports <see cref="Verdict.Skip"/>.
    ///
    /// <para>The three channels are NOT independent: all three ride one phase derived from
    /// <c>cycle % 120</c>, separated by fixed offsets of π/3 and π/6, so their sinusoids are locked to each
    /// other and to the cycle index for as long as the machine runs. Only the noise term differs per
    /// channel.</para>
    ///
    /// <para>🔴 <b>The "drift event" is a 200-cycle square wave, not a transient, and it is reported on
    /// three channels while it is applied to one.</b> The state is the parity of
    /// <c>cycle / DriftEveryCycles</c>, so drift is OFF for cycles 1..199, ON for 200..399, OFF for
    /// 400..599, and so on — about half of all cycles are drifted, indefinitely. While it is on, the
    /// <c>+1.5 °C</c> offset is added to the TEMPERATURE only, but the quality flag written onto every one
    /// of the three <c>TelemetrySample</c>s flips to <c>uncertain</c>. So a consumer that trusts the
    /// humidity or current quality flag is told those readings are suspect during a temperature-only
    /// event.</para>
    ///
    /// <para>The cycle plan carries one step per channel with a null <c>Result</c> — the same "no verdict
    /// exists here" decision as above, expressed a second time rather than invented — and its duration is
    /// read from <see cref="CycleSecondsOverride"/>, which resolves the config a SECOND time inside this
    /// same cycle when a store is wired.</para></summary>
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
