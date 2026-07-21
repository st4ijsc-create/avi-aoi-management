using St4i.EdgeCore.Config;
using St4i.EdgeCore.Drivers.Simulators;
using St4i.EdgeCore.Models;
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

    /// <summary>docs/plans Task 3 VERIFY bullet: "a machine-scoped adjustment affects every product, and
    /// a product-scoped one affects only that product — proven through actual simulated output, not just
    /// the resolver." Reads <c>DeviceReading.Metrics[0].Nominal</c> (the torqueTarget actually fed into
    /// the Gaussian draw for that cycle) across a single long-lived simulator instance while flipping a
    /// closure-captured "current product" between cycles — the exact seam EngineApi's <c>FleetHost</c>
    /// uses in production (<c>CurrentProductFor</c>), just driven directly here for a pure-EdgeCore
    /// test.</summary>
    [Fact]
    public void Screwdrive_machine_scoped_adjustment_affects_every_product_product_scoped_affects_only_that_product()
    {
        const string code = "SCRW-CFG-SCOPE";
        const double machineValue = 5.0;
        const double productValue = 9.0;

        var store = NewStore();
        var d = ScrewDescriptor(code);
        store.Ensure(code, MachineParameterSchema.ScrewProgram);

        string? currentProduct = null;
        var sim = new ScrewdriveSim(d, seed: 55, store, () => currentProduct);

        store.SetAdjustment(code, "torqueTarget", machineValue, AdjustmentScope.Machine, null, "test", "machine-wide shift");

        currentProduct = "MODEL-A";
        Assert.Equal(machineValue, sim.NextCycle(1).Metrics[0].Nominal);
        currentProduct = "MODEL-B";
        Assert.Equal(machineValue, sim.NextCycle(2).Metrics[0].Nominal);
        currentProduct = null;
        Assert.Equal(machineValue, sim.NextCycle(3).Metrics[0].Nominal);

        // Layer a product-scoped override for MODEL-A only — must win ONLY while MODEL-A is running.
        store.SetAdjustment(code, "torqueTarget", productValue, AdjustmentScope.Product, "MODEL-A", "test", "MODEL-A needs more torque");

        currentProduct = "MODEL-A";
        Assert.Equal(productValue, sim.NextCycle(4).Metrics[0].Nominal);

        currentProduct = "MODEL-B";
        Assert.Equal(machineValue, sim.NextCycle(5).Metrics[0].Nominal);

        currentProduct = null;
        Assert.Equal(machineValue, sim.NextCycle(6).Metrics[0].Nominal);
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
