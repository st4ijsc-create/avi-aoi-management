using St4i.EdgeCore.Config;
using St4i.EdgeCore.Drivers.Simulators;
using St4i.EdgeCore.Models;
using St4i.Connector.Abstractions.Models;
using Xunit;

/// <summary>
/// Task 3 (docs/plans/2026-07-21-machine-config.md) — proves the effective operating configuration
/// actually drives simulated machine behaviour (design doc §4), not just the resolver Tasks 1-2 already
/// cover. Every test below is DETERMINISTIC (a fixed seed + disjoint cycle ranges per regime — see each
/// test's own comment) so the statistical assertions are stable across runs, per the task brief.
///
/// The four wired mappings (see the matching production-code doc comments for the exact formulas):
///  - <see cref="ScrewdriveSim"/>: torqueTarget/torqueTolerance → torque distribution + NG rate;
///    speedRpm/clampTimeMs → cycle cadence (<see cref="IMachineSimulator.CycleSecondsOverride"/>).
///  - <see cref="IotSensorSim"/>: sampleRateHz/reportIntervalSec → telemetry cadence.
///  - <see cref="AoiInspectorSim"/>: matchThreshold (+exposureUs/lightIntensity noise) → AOI NG rate.
/// </summary>
public class MachineConfigDrivesSimulationTests
{
    private static string TempDir() => Directory.CreateTempSubdirectory("st4i-machine-config-sim-tests-").FullName;

    private static MachineConfigStore NewStore() => new(TempDir());

    private static MachineDescriptor ScrewDescriptor(string code) =>
        new(code, $"SN-{code}", DeviceClass.Automation, "SCREWDRIVE", "screw_tightening", DriverKind.Simulated, "RC1", null, 1.0);

    private static MachineDescriptor AoiDescriptor(string code) =>
        new(code, $"SN-{code}", DeviceClass.AoiAvi, "AOI", "inspection", DriverKind.Simulated, "RC1", null, 1.0);

    private static MachineDescriptor IotDescriptor(string code) =>
        new(code, $"SN-{code}", DeviceClass.Iot, "IOT_SENSOR", null, DriverKind.Simulated, null, null, 1.0);

    // ─────────────────────────────────────────────────────────────────────
    // Screwdrive — torqueTarget/torqueTolerance drive the torque distribution AND the NG rate
    // ─────────────────────────────────────────────────────────────────────

    /// <summary>Formula (ScrewdriveSim class remarks): torque ~ N(torqueTarget, torqueTarget·0.03); pass
    /// band [torqueTarget−torqueTolerance, torqueTarget+torqueTolerance]. Baseline tolerance (0.15 Nm,
    /// schema default) keeps the band many std-devs wide (NG ≈ 0%); tightened to 0.02 Nm the SAME
    /// underlying distribution runs mostly outside the now-narrow band (NG measurably higher). Seed 4242,
    /// 3000 cycles per regime, disjoint cycle ranges (1..3000 vs 3001..6000) so the two regimes never
    /// share an RNG draw.</summary>
    [Fact]
    public void Screwdrive_tightening_torqueTolerance_raises_NG_rate_significantly()
    {
        const string code = "SCRW-CFG-TOL";
        const int seed = 4242;
        const int cycles = 3000;

        var store = NewStore();
        var d = ScrewDescriptor(code);
        store.Ensure(code, MachineParameterSchema.ScrewProgram);

        var baselineFailRate = RunScrewFailRate(d, store, seed, cycles, cycleOffset: 0);

        store.SetAdjustment(code, "torqueTolerance", 0.02, AdjustmentScope.Machine, null, "test", "tight tolerance");
        var tightFailRate = RunScrewFailRate(d, store, seed, cycles, cycleOffset: cycles);

        Assert.True(baselineFailRate < 0.02,
            $"baseline (tolerance=0.15, schema default) should be a near-zero NG rate — got {baselineFailRate:P2}");
        Assert.True(tightFailRate > baselineFailRate + 0.30,
            $"tightening torqueTolerance to 0.02 should raise the NG rate by a large, measurable margin — baseline={baselineFailRate:P2}, tight={tightFailRate:P2}");
    }

    /// <summary>docs/plans Task 3 VERIFY bullet: "resetting a parameter back to baseline returns
    /// behaviour to the baseline rate". Same tight-tolerance shift as the test above, then
    /// <see cref="MachineConfigStore.RemoveAdjustment"/> falls the key back to the (unchanged) baseline
    /// layer, and a THIRD disjoint cycle range confirms the NG rate returns to a near-zero baseline
    /// rate.</summary>
    [Fact]
    public void Screwdrive_resetting_torqueTolerance_to_baseline_returns_NG_rate_to_baseline()
    {
        const string code = "SCRW-CFG-RESET";
        const int seed = 9001;
        const int cycles = 2000;

        var store = NewStore();
        var d = ScrewDescriptor(code);
        store.Ensure(code, MachineParameterSchema.ScrewProgram);

        var beforeFailRate = RunScrewFailRate(d, store, seed, cycles, cycleOffset: 0);

        store.SetAdjustment(code, "torqueTolerance", 0.02, AdjustmentScope.Machine, null, "test", "tight tolerance");
        var tightFailRate = RunScrewFailRate(d, store, seed, cycles, cycleOffset: cycles);

        store.RemoveAdjustment(code, "torqueTolerance", AdjustmentScope.Machine, null, by: "test");
        var afterResetFailRate = RunScrewFailRate(d, store, seed, cycles, cycleOffset: cycles * 2);

        Assert.True(tightFailRate > beforeFailRate + 0.30, "sanity: the tightened regime must actually have shown the NG spike");
        Assert.True(afterResetFailRate < 0.02,
            $"resetting torqueTolerance must return the NG rate to near the baseline — before={beforeFailRate:P2}, tight={tightFailRate:P2}, afterReset={afterResetFailRate:P2}");
    }

    /// <summary>Formula (ScrewdriveSim class remarks): cycleSeconds = 0.2 (fixed handling overhead) +
    /// 3 revolutions ÷ (speedRpm÷60) + clampTimeMs÷1000. Faster speedRpm must shorten the cadence;
    /// longer clampTimeMs must lengthen it — both directions an operator expects.</summary>
    [Fact]
    public void Screwdrive_speedRpm_and_clampTimeMs_change_cadence_in_expected_direction()
    {
        const string code = "SCRW-CFG-CADENCE";
        var store = NewStore();
        var d = ScrewDescriptor(code);
        store.Ensure(code, MachineParameterSchema.ScrewProgram);
        var sim = new ScrewdriveSim(d, seed: 1, store, () => null);

        // Baseline (schema defaults): speedRpm=450, clampTimeMs=250 -> 0.2 + 3*60/450 + 0.25 = 0.85s.
        var baseline = sim.CycleSecondsOverride;
        Assert.NotNull(baseline);
        Assert.Equal(0.85, baseline!.Value, 3);

        store.SetAdjustment(code, "speedRpm", 1800, AdjustmentScope.Machine, null, "test", "much faster spin");
        var faster = sim.CycleSecondsOverride;
        Assert.True(faster < baseline, $"raising speedRpm must shorten cadence: baseline={baseline}, faster={faster}");

        store.RemoveAdjustment(code, "speedRpm", AdjustmentScope.Machine, null, by: "test");
        store.SetAdjustment(code, "clampTimeMs", 4000, AdjustmentScope.Machine, null, "test", "much longer dwell");
        var slower = sim.CycleSecondsOverride;
        Assert.True(slower > baseline, $"raising clampTimeMs must lengthen cadence: baseline={baseline}, slower={slower}");
    }

    /// <summary>I-5 (mc-feature-review.md) — before this fix, a config override ALWAYS won outright over
    /// the scenario's CycleRateMultiplier (which only ever scaled MachineDescriptor.CycleSeconds, a value
    /// this override ignores entirely), so a scenario like sensor-drift (5x) or Burst (6x) had ZERO effect
    /// on a SCREWDRIVE machine once a config store was wired — which production always does. The
    /// multiplier must now divide the config-derived cadence, composing with it instead of being silently
    /// swallowed by it.</summary>
    [Fact]
    public void Screwdrive_CycleRateMultiplier_composes_with_the_config_derived_cadence_instead_of_being_ignored()
    {
        const string code = "SCRW-CFG-MULT";
        var store = NewStore();
        var d = ScrewDescriptor(code);
        store.Ensure(code, MachineParameterSchema.ScrewProgram);

        var unscaled = new ScrewdriveSim(d, seed: 1, store, () => null); // cycleRateMultiplier defaults to 1.0
        var baseline = unscaled.CycleSecondsOverride;
        Assert.NotNull(baseline);
        Assert.Equal(0.85, baseline!.Value, 3); // schema defaults, same formula as the test above

        var scaled5x = new ScrewdriveSim(d, seed: 1, store, () => null, cycleRateMultiplier: 5.0);
        var fiveX = scaled5x.CycleSecondsOverride;
        Assert.NotNull(fiveX);
        Assert.Equal(baseline.Value / 5.0, fiveX!.Value, 3);

        var scaled6x = new ScrewdriveSim(d, seed: 1, store, () => null, cycleRateMultiplier: 6.0); // Burst's own multiplier
        var sixX = scaled6x.CycleSecondsOverride;
        Assert.NotNull(sixX);
        Assert.Equal(baseline.Value / 6.0, sixX!.Value, 3);

        // A config adjustment (speedRpm) and the multiplier compose TOGETHER — not one replacing the other.
        store.SetAdjustment(code, "speedRpm", 1800, AdjustmentScope.Machine, null, "test", "much faster spin");
        var adjustedUnscaled = unscaled.CycleSecondsOverride!.Value;
        var adjustedScaled = scaled5x.CycleSecondsOverride!.Value;
        Assert.Equal(adjustedUnscaled / 5.0, adjustedScaled, 3);
    }

    /// <summary>docs/plans Task 3 VERIFY bullet: "a machine-scoped adjustment affects every product, and
    /// a product-scoped one affects only that product — proven through actual simulated output, not just
    /// the resolver."
    ///
    /// M-7 (mc-feature-review.md) — this used to read <c>Metrics[0].Nominal</c>, which
    /// <see cref="ScrewdriveSim.NextCycle"/> sets DIRECTLY to the resolved <c>torqueTarget</c>
    /// (<c>new MetricSample("torque", torque, "Nm", lsl, usl, torqueTarget)</c>) — it never passes through
    /// the Gaussian draw (<c>torque = rng.NextGaussian(torqueTarget, torqueStd)</c>, the class's own doc
    /// comment) at all. A regression that made the ACTUAL drawn torque ignore config entirely (while the
    /// resolver still worked) would leave <c>Nominal == torqueTarget</c> and this test green — a resolver-
    /// surfacing test wearing a "proven through actual simulated output" label. Reading <c>Metrics[0].Value</c>
    /// instead (the real draw) with a tolerance wide enough to absorb the draw's own noise
    /// (<c>torqueTarget·ProcessNoiseFraction</c> = 3% of target — well under 1.0 Nm here) but far narrower
    /// than the gap to the WRONG value (schema default 1.35 vs machineValue 5.0/productValue 9.0, a
    /// 3.65+/7.65+ Nm gap) makes this a genuine behavioral proof: a config-ignoring regression would miss
    /// by multiple Nm, not by noise.</summary>
    [Fact]
    public void Screwdrive_machine_scoped_adjustment_affects_every_product_product_scoped_affects_only_that_product()
    {
        const string code = "SCRW-CFG-SCOPE";
        const double machineValue = 5.0;
        const double productValue = 9.0;
        const double tolerance = 1.0; // >> draw noise (~0.15-0.27 Nm here), << gap to a wrong/default value

        var store = NewStore();
        var d = ScrewDescriptor(code);
        store.Ensure(code, MachineParameterSchema.ScrewProgram);

        string? currentProduct = null;
        var sim = new ScrewdriveSim(d, seed: 55, store, () => currentProduct);

        store.SetAdjustment(code, "torqueTarget", machineValue, AdjustmentScope.Machine, null, "test", "machine-wide shift");

        currentProduct = "MODEL-A";
        AssertActualTorqueNear(machineValue, sim.NextCycle(1), tolerance);
        currentProduct = "MODEL-B";
        AssertActualTorqueNear(machineValue, sim.NextCycle(2), tolerance);
        currentProduct = null;
        AssertActualTorqueNear(machineValue, sim.NextCycle(3), tolerance);

        // Layer a product-scoped override for MODEL-A only — must win ONLY while MODEL-A is running.
        store.SetAdjustment(code, "torqueTarget", productValue, AdjustmentScope.Product, "MODEL-A", "test", "MODEL-A needs more torque");

        currentProduct = "MODEL-A";
        AssertActualTorqueNear(productValue, sim.NextCycle(4), tolerance);

        currentProduct = "MODEL-B";
        AssertActualTorqueNear(machineValue, sim.NextCycle(5), tolerance);

        currentProduct = null;
        AssertActualTorqueNear(machineValue, sim.NextCycle(6), tolerance);
    }

    /// <summary>Asserts the ACTUAL drawn metric value (never <c>Nominal</c> — see M-7 doc comment above)
    /// lands within <paramref name="tolerance"/> of <paramref name="expectedTarget"/>.</summary>
    private static void AssertActualTorqueNear(double expectedTarget, DeviceReading reading, double tolerance)
    {
        var actual = reading.Metrics[0].Value;
        Assert.True(Math.Abs(actual - expectedTarget) < tolerance,
            $"actual drawn torque {actual} should be within {tolerance} Nm of the resolved torqueTarget {expectedTarget} (draw noise is a few tenths of a Nm here — a miss this large means the ACTUAL output isn't tracking config, not just noise).");
    }

    // ─────────────────────────────────────────────────────────────────────
    // IoT sensor — sampleRateHz/reportIntervalSec drive telemetry cadence
    // ─────────────────────────────────────────────────────────────────────

    /// <summary>Formula (IotSensorSim class remarks): cadence = min(1÷sampleRateHz, reportIntervalSec).
    /// Raising sampleRateHz shortens cadence while reportIntervalSec stays the non-binding constraint;
    /// lowering reportIntervalSec below 1÷sampleRateHz then makes IT the binding (and also shortening)
    /// constraint.</summary>
    [Fact]
    public void IotSensor_sampleRateHz_and_reportIntervalSec_change_cadence_in_expected_direction()
    {
        const string code = "IOT-CFG-CADENCE";
        var store = NewStore();
        var d = IotDescriptor(code);
        store.Ensure(code, MachineParameterSchema.IotSettings);
        var sim = new IotSensorSim(d, seed: 1, store, () => null);

        // Baseline (schema defaults): sampleRateHz=1.0, reportIntervalSec=60 -> min(1, 60) = 1s.
        var baseline = sim.CycleSecondsOverride;
        Assert.NotNull(baseline);
        Assert.Equal(1.0, baseline!.Value, 3);

        store.SetAdjustment(code, "sampleRateHz", 10.0, AdjustmentScope.Machine, null, "test", "faster sampling");
        var fasterSampling = sim.CycleSecondsOverride;
        Assert.True(fasterSampling < baseline, $"raising sampleRateHz must shorten cadence: baseline={baseline}, faster={fasterSampling}");
        Assert.Equal(0.1, fasterSampling!.Value, 3);

        // Now make sampleRateHz very slow (1/0.01 = 100s) so it's clearly NOT the binding constraint,
        // and observe that cadence with reportIntervalSec still at its 60s default.
        store.RemoveAdjustment(code, "sampleRateHz", AdjustmentScope.Machine, null, by: "test");
        store.SetAdjustment(code, "sampleRateHz", 0.01, AdjustmentScope.Machine, null, "test", "very slow sampling");
        var slowSamplingOnly = sim.CycleSecondsOverride;
        Assert.Equal(60.0, slowSamplingOnly!.Value, 3); // reportIntervalSec (60s default) is the binding constraint already

        // Tightening reportIntervalSec to 5s (holding the slow sampleRateHz) must shorten cadence
        // further — reportIntervalSec becoming an even TIGHTER binding constraint.
        store.SetAdjustment(code, "reportIntervalSec", 5, AdjustmentScope.Machine, null, "test", "reports must still go out at least every 5s");
        var reportBound = sim.CycleSecondsOverride;
        Assert.True(reportBound < slowSamplingOnly, $"lowering reportIntervalSec must shorten cadence when it's the binding constraint: before={slowSamplingOnly}, after={reportBound}");
        Assert.Equal(5.0, reportBound!.Value, 3);
    }

    /// <summary>I-5 (mc-feature-review.md) — same composition proof as
    /// <see cref="Screwdrive_CycleRateMultiplier_composes_with_the_config_derived_cadence_instead_of_being_ignored"/>,
    /// for IOT_SENSOR specifically — this is the machine type <c>sensor-drift</c>'s entire 5x multiplier
    /// exists to accelerate (FleetHost preset comment: "tăng tốc chu kỳ để lộ sự kiện trôi hiệu chuẩn định
    /// kỳ của IOT_SENSOR"), which was silently broken before this fix.</summary>
    [Fact]
    public void IotSensor_CycleRateMultiplier_composes_with_the_config_derived_cadence_instead_of_being_ignored()
    {
        const string code = "IOT-CFG-MULT";
        var store = NewStore();
        var d = IotDescriptor(code);
        store.Ensure(code, MachineParameterSchema.IotSettings);

        var unscaled = new IotSensorSim(d, seed: 1, store, () => null);
        var baseline = unscaled.CycleSecondsOverride;
        Assert.NotNull(baseline);
        Assert.Equal(1.0, baseline!.Value, 3); // schema defaults, same as the test above

        var sensorDrift = new IotSensorSim(d, seed: 1, store, () => null, cycleRateMultiplier: 5.0); // sensor-drift preset
        var scaled = sensorDrift.CycleSecondsOverride;
        Assert.NotNull(scaled);
        Assert.Equal(baseline.Value / 5.0, scaled!.Value, 3);
        Assert.Equal(0.2, scaled.Value, 3);
    }

    // ─────────────────────────────────────────────────────────────────────
    // AOI — matchThreshold drives the false-call (NG) rate
    // ─────────────────────────────────────────────────────────────────────

    /// <summary>Formula (AoiInspectorSim class remarks): each point's matchScore ~ N(0.93, ~0.05); NG
    /// whenever matchScore &lt; matchThreshold. The SAME distribution compared against a HIGHER bar
    /// necessarily fails more often — monotonic by construction. Seed 777, 500 boards (20 points/board =
    /// 10,000 points) per regime, disjoint cycle ranges so no shared RNG draw between regimes.</summary>
    [Fact]
    public void Aoi_tightening_matchThreshold_raises_NG_rate_significantly()
    {
        const string code = "AOI-CFG-THRESH";
        const int seed = 777;
        const int boards = 500;

        var store = NewStore();
        var d = AoiDescriptor(code);
        store.Ensure(code, MachineParameterSchema.AoiInspection);

        var baselineNgRate = RunAoiPointNgRate(d, store, seed, boards, cycleOffset: 0);

        store.SetAdjustment(code, "matchThreshold", 0.95, AdjustmentScope.Machine, null, "test", "tight match threshold");
        var tightNgRate = RunAoiPointNgRate(d, store, seed, boards, cycleOffset: boards);

        Assert.True(baselineNgRate is > 0.01 and < 0.15,
            $"baseline (matchThreshold=0.85, schema default) should be a believable low single-digit NG rate — got {baselineNgRate:P2}");
        Assert.True(tightNgRate > baselineNgRate + 0.30,
            $"tightening matchThreshold to 0.95 should raise the NG rate by a large, measurable margin — baseline={baselineNgRate:P2}, tight={tightNgRate:P2}");
    }

    // ─────────────────────────────────────────────────────────────────────
    // Pre-Task-3 behaviour untouched when no ConfigStore is wired
    // ─────────────────────────────────────────────────────────────────────

    [Fact]
    public void Simulators_without_a_ConfigStore_report_null_CycleSecondsOverride_and_ignore_config()
    {
        var screw = new ScrewdriveSim(ScrewDescriptor("SCRW-NOCFG"), seed: 1);
        var iot = new IotSensorSim(IotDescriptor("IOT-NOCFG"), seed: 1);
        Assert.Null(screw.CycleSecondsOverride);
        Assert.Null(iot.CycleSecondsOverride);
    }

    // ─────────────────────────────────────────────────────────────────────
    // Helpers
    // ─────────────────────────────────────────────────────────────────────

    private static double RunScrewFailRate(MachineDescriptor d, MachineConfigStore store, int seed, int cycles, int cycleOffset)
    {
        var sim = new ScrewdriveSim(d, seed, store, () => null);
        var failCount = 0;
        for (var c = 1; c <= cycles; c++)
        {
            if (sim.NextCycle(cycleOffset + c).Verdict == Verdict.Fail) failCount++;
        }

        return (double)failCount / cycles;
    }

    private static double RunAoiPointNgRate(MachineDescriptor d, MachineConfigStore store, int seed, int boards, int cycleOffset)
    {
        var sim = new AoiInspectorSim(d, seed, pointsPerBoard: 20, configStore: store, productCodeProvider: () => null);
        var ngPoints = 0;
        var totalPoints = 0;
        for (var c = 1; c <= boards; c++)
        {
            var reading = sim.NextCycle(cycleOffset + c);
            totalPoints += reading.Measurements.Count;
            ngPoints += reading.Measurements.Count(m => m.Result == "NG");
        }

        return (double)ngPoints / totalPoints;
    }
}
