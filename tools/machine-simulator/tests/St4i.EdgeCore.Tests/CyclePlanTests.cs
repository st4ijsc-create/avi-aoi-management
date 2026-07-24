using St4i.EdgeCore.Config;
using St4i.EdgeCore.Drivers.Simulators;
using St4i.EdgeCore.Models;
using Xunit;

/// <summary>
/// WS3-T1 (docs/PRODUCTION_UI_DESIGN.md §3.2) — proves the engine's new per-cycle <see cref="CyclePlan"/>
/// (ordered steps, per-step results, timing) actually gives a web twin what it needs: the right step
/// count per machine class, AOI steps tied to a product's REAL configured measurement points (never a
/// fabricated position), config (torqueTolerance/matchThreshold) driving the NG-step count in the same
/// direction the aggregate pass rate already moves, and — the core "don't double-count" contract — the
/// plan's own per-step tally always agreeing with <see cref="DeviceReading.Verdict"/>, never a second,
/// independently-drawn narrative.
/// </summary>
public class CyclePlanTests
{
    private static string TempDir(string prefix) => Directory.CreateTempSubdirectory(prefix).FullName;

    private static MachineDescriptor ScrewDescriptor(string code) =>
        new(code, $"SN-{code}", DeviceClass.Automation, "SCREWDRIVE", "screw_tightening", DriverKind.Simulated, "RC1", null, 1.0);

    private static MachineDescriptor AoiDescriptor(string code) =>
        new(code, $"SN-{code}", DeviceClass.AoiAvi, "AOI", "inspection", DriverKind.Simulated, "RC1", null, 1.0);

    private static MachineDescriptor IotDescriptor(string code) =>
        new(code, $"SN-{code}", DeviceClass.Iot, "IOT_SENSOR", null, DriverKind.Simulated, null, null, 1.0);

    private static ProductConfigStore NewProductStore() => new(TempDir("st4i-cycleplan-products-"));

    private static MachineConfigStore NewConfigStore() => new(TempDir("st4i-cycleplan-config-"));

    /// <summary>A product with <paramref name="activeCount"/> active, non-deleted points at deterministic
    /// normalized positions, PLUS one disabled (<c>IsActive=false</c>) and one soft-deleted point — so
    /// tests can prove both are excluded from the plan/inspection, not just that active points appear.</summary>
    private static ProductModel BuildTestProduct(string code, int activeCount)
    {
        var points = new List<MeasurementPoint>();
        for (var i = 0; i < activeCount; i++)
        {
            points.Add(new MeasurementPoint
            {
                Code = $"RP-{i + 1:D2}",
                Name = $"Real point {i + 1}",
                NormalizedX = 0.1 + i * 0.05,
                NormalizedY = 0.2 + i * 0.03,
                OrderIndex = i,
                IsActive = true,
            });
        }

        points.Add(new MeasurementPoint { Code = "INACTIVE-1", NormalizedX = 0.9, NormalizedY = 0.9, OrderIndex = activeCount, IsActive = false });
        points.Add(new MeasurementPoint
        {
            Code = "DELETED-1", NormalizedX = 0.5, NormalizedY = 0.5, OrderIndex = activeCount + 1, IsActive = true,
            DeletedAt = DateTimeOffset.UtcNow, DeletedAtVersion = 1,
        });

        return new ProductModel { Code = code, Name = "Test product", ImageWidth = 1000, ImageHeight = 800, Points = points };
    }

    // ─────────────────────────────────────────────────────────────────────
    // Step count per machine class
    // ─────────────────────────────────────────────────────────────────────

    [Fact]
    public void Screwdrive_plan_has_four_ordered_fastening_steps_and_step0_reuses_the_primary_draw()
    {
        var d = ScrewDescriptor("SCRW-PLAN-SHAPE");
        var reading = new ScrewdriveSim(d, seed: 17).NextCycle(1);

        Assert.NotNull(reading.Plan);
        Assert.Equal(4, reading.Plan!.Steps.Count);
        Assert.Equal(new[] { 0, 1, 2, 3 }, reading.Plan.Steps.Select(s => s.Index));
        Assert.Equal(1, reading.Plan.CycleCounter);

        // Step 0 must be the EXACT SAME torque draw already reported in Metrics — never a second,
        // independently-drawn value for the same physical position.
        Assert.Equal(reading.Metrics[0].Value, reading.Plan.Steps[0].MetricValue!.Value, 3);
        Assert.All(reading.Plan.Steps, s => Assert.Equal("Nm", s.Unit));
        Assert.All(reading.Plan.Steps, s => Assert.True(s.Result is "OK" or "NG"));
    }

    [Fact]
    public void IotSensor_plan_has_one_step_per_telemetry_channel_with_no_pass_fail_result()
    {
        var d = IotDescriptor("IOT-PLAN-SHAPE");
        var reading = new IotSensorSim(d, seed: 3).NextCycle(1);

        Assert.NotNull(reading.Plan);
        Assert.Equal(3, reading.Plan!.Steps.Count);
        Assert.All(reading.Plan.Steps, s => Assert.Null(s.Result)); // telemetry has no pass/fail concept

        Assert.Equal((double)reading.Telemetry[0].Value!, reading.Plan.Steps[0].MetricValue!.Value, 3);
        Assert.Equal((double)reading.Telemetry[1].Value!, reading.Plan.Steps[1].MetricValue!.Value, 3);
        Assert.Equal((double)reading.Telemetry[2].Value!, reading.Plan.Steps[2].MetricValue!.Value, 3);
    }

    [Fact]
    public void Simulators_this_task_does_not_wire_a_plan_for_report_null_Plan()
    {
        var d = new MachineDescriptor("MC-01", "SN", DeviceClass.Automation, "TYPE", "step", DriverKind.Simulated, "RC1", null, 1.0);
        Assert.Null(new DispensingSim(d, 11).NextCycle(1).Plan);
        Assert.Null(new WelderSim(d, 11).NextCycle(1).Plan);
        Assert.Null(new AssemblySim(d, 11).NextCycle(1).Plan);
        Assert.Null(new LeakTestSim(d, 11).NextCycle(1).Plan);
        Assert.Null(new FunctionalTestSim(d, 11).NextCycle(1).Plan);
    }

    [Fact]
    public void Screwdrive_plan_is_deterministic_for_same_seed_and_cycle()
    {
        var d = ScrewDescriptor("SCRW-DET");
        var a = new ScrewdriveSim(d, seed: 42).NextCycle(5).Plan;
        var b = new ScrewdriveSim(d, seed: 42).NextCycle(5).Plan;

        Assert.Equal(a!.Steps.Select(s => s.MetricValue), b!.Steps.Select(s => s.MetricValue));
        Assert.Equal(a.Steps.Select(s => s.Result), b.Steps.Select(s => s.Result));
    }

    // ─────────────────────────────────────────────────────────────────────
    // AOI — real product points, or an honest null plan when none are resolvable
    // ─────────────────────────────────────────────────────────────────────

    [Fact]
    public void Aoi_with_real_product_maps_plan_steps_to_the_products_active_points_only()
    {
        var store = NewProductStore();
        const string productCode = "PROD-RP";
        store.UpsertProduct(BuildTestProduct(productCode, activeCount: 5));

        var d = AoiDescriptor("AOI-RP");
        var sim = new AoiInspectorSim(d, seed: 21, productCodeProvider: () => productCode, productConfigStore: store);
        var reading = sim.NextCycle(1);

        Assert.NotNull(reading.Plan);
        Assert.Equal(5, reading.Plan!.Steps.Count);
        Assert.Equal(5, reading.Measurements.Count); // Measurements are driven by the SAME real point set

        var expectedCodes = Enumerable.Range(1, 5).Select(i => $"RP-{i:D2}").ToArray();
        Assert.Equal(expectedCodes, reading.Plan.Steps.Select(s => s.PointCode).ToArray());
        Assert.Equal(expectedCodes, reading.Measurements.Select(m => m.PointCode).ToArray());

        // Positions are the product's own normalized coordinates exactly — never fabricated.
        for (var i = 0; i < 5; i++)
        {
            Assert.Equal(0.1 + i * 0.05, reading.Plan.Steps[i].NormalizedX, 6);
            Assert.Equal(0.2 + i * 0.03, reading.Plan.Steps[i].NormalizedY, 6);
        }

        // The disabled and soft-deleted points never appear, in either list.
        Assert.DoesNotContain(reading.Plan.Steps, s => s.PointCode is "INACTIVE-1" or "DELETED-1");
        Assert.DoesNotContain(reading.Measurements, m => m.PointCode is "INACTIVE-1" or "DELETED-1");
    }

    [Fact]
    public void Aoi_without_a_resolvable_product_falls_back_to_generic_points_and_emits_no_plan()
    {
        var d = AoiDescriptor("AOI-GEN");

        // No ProductConfigStore at all — the pre-Task-3/pre-WS3-T1 construction path.
        var readingA = new AoiInspectorSim(d, seed: 5, pointsPerBoard: 12).NextCycle(1);
        Assert.Null(readingA.Plan);
        Assert.Equal(12, readingA.Measurements.Count);
        Assert.All(readingA.Measurements, m => Assert.StartsWith("PT-", m.PointCode));

        var store = NewProductStore();

        // ProductConfigStore wired, but no product currently resolved for this machine.
        var readingB = new AoiInspectorSim(d, seed: 5, pointsPerBoard: 12, productCodeProvider: () => null, productConfigStore: store).NextCycle(1);
        Assert.Null(readingB.Plan);

        // ProductConfigStore wired, provider returns a code that doesn't exist in the store.
        var readingC = new AoiInspectorSim(d, seed: 5, pointsPerBoard: 12, productCodeProvider: () => "NO-SUCH-PRODUCT", productConfigStore: store).NextCycle(1);
        Assert.Null(readingC.Plan);
    }

    // ─────────────────────────────────────────────────────────────────────
    // "Aggregate == per-step tally" — no double-counting, no disagreeing narrative
    // ─────────────────────────────────────────────────────────────────────

    [Fact]
    public void Screwdrive_plan_step_NG_tally_matches_the_aggregate_verdict_every_cycle()
    {
        var store = NewConfigStore();
        const string code = "SCRW-TALLY";
        store.Ensure(code, MachineParameterSchema.ScrewProgram);
        store.SetAdjustment(code, "torqueTolerance", 0.05, AdjustmentScope.Machine, null, "test", "moderate tolerance for a believable mix");

        var d = ScrewDescriptor(code);
        var sim = new ScrewdriveSim(d, seed: 606, store, () => null);

        var sawFail = false;
        var sawPass = false;
        for (var c = 1; c <= 500; c++)
        {
            var reading = sim.NextCycle(c);
            Assert.NotNull(reading.Plan);
            var anyStepNg = reading.Plan!.Steps.Any(s => s.Result == "NG");
            Assert.Equal(anyStepNg, reading.Verdict == Verdict.Fail);
            if (reading.Verdict == Verdict.Fail) sawFail = true; else sawPass = true;
        }

        Assert.True(sawFail, "sanity: a moderately tight tolerance across 4 fastening positions/cycle over 500 cycles should produce at least one NG cycle");
        Assert.True(sawPass, "sanity: should still produce at least one clean cycle");
    }

    [Fact]
    public void Aoi_plan_step_NG_tally_matches_the_aggregate_verdict_every_cycle()
    {
        var productStore = NewProductStore();
        const string productCode = "PROD-TALLY";
        productStore.UpsertProduct(BuildTestProduct(productCode, activeCount: 10));

        var configStore = NewConfigStore();
        const string code = "AOI-TALLY";
        configStore.Ensure(code, MachineParameterSchema.AoiInspection);
        configStore.SetAdjustment(code, "matchThreshold", 0.82, AdjustmentScope.Machine, null, "test", "force a believable pass/fail mix");

        var d = AoiDescriptor(code);
        var sim = new AoiInspectorSim(d, seed: 99, configStore: configStore, productCodeProvider: () => productCode, productConfigStore: productStore);

        var sawFail = false;
        var sawPass = false;
        for (var c = 1; c <= 300; c++)
        {
            var reading = sim.NextCycle(c);
            Assert.NotNull(reading.Plan);
            var anyStepNg = reading.Plan!.Steps.Any(s => s.Result == "NG");
            var aggregateFail = reading.Verdict == Verdict.Fail;
            Assert.Equal(anyStepNg, aggregateFail);

            // No double counting: the plan's NG tally and the (separately-shaped) Measurements' NG tally
            // must agree exactly, cycle by cycle — they're built from the SAME per-point draw, never two.
            Assert.Equal(reading.Measurements.Count(m => m.Result == "NG"), reading.Plan!.Steps.Count(s => s.Result == "NG"));

            if (aggregateFail) sawFail = true; else sawPass = true;
        }

        Assert.True(sawFail, "sanity: matchThreshold=0.82 across 300 boards of 10 real points should produce at least one NG board");
        Assert.True(sawPass, "sanity: should still produce at least one clean board");
    }

    // ─────────────────────────────────────────────────────────────────────
    // Config drives the NG-step count (design-doc §3.4/§4) — before/after with the same seed
    // ─────────────────────────────────────────────────────────────────────

    [Fact]
    public void Screwdrive_tightening_torqueTolerance_raises_NG_step_rate_in_the_plan()
    {
        const string code = "SCRW-PLAN-TOL";
        const int seed = 2024;
        const int cycles = 1000;
        var store = NewConfigStore();
        var d = ScrewDescriptor(code);
        store.Ensure(code, MachineParameterSchema.ScrewProgram);

        double RunNgStepRate(int cycleOffset)
        {
            var sim = new ScrewdriveSim(d, seed, store, () => null);
            var ngSteps = 0;
            var totalSteps = 0;
            for (var c = 1; c <= cycles; c++)
            {
                var reading = sim.NextCycle(cycleOffset + c);
                totalSteps += reading.Plan!.Steps.Count;
                ngSteps += reading.Plan.Steps.Count(s => s.Result == "NG");
            }

            return (double)ngSteps / totalSteps;
        }

        var baselineRate = RunNgStepRate(cycleOffset: 0); // schema default torqueTolerance = 0.15

        store.SetAdjustment(code, "torqueTolerance", 0.02, AdjustmentScope.Machine, null, "test", "tight tolerance");
        var tightRate = RunNgStepRate(cycleOffset: cycles);

        Assert.True(baselineRate < 0.02, $"baseline NG-step rate (tolerance=0.15) should be near zero — got {baselineRate:P2}");
        Assert.True(tightRate > baselineRate + 0.30,
            $"tightening torqueTolerance to 0.02 should raise the plan's NG-step rate by a large margin — baseline={baselineRate:P2}, tight={tightRate:P2}");
    }

    [Fact]
    public void Aoi_tightening_matchThreshold_raises_NG_step_rate_in_the_real_points_plan()
    {
        var productStore = NewProductStore();
        const string productCode = "PROD-TIGHT";
        productStore.UpsertProduct(BuildTestProduct(productCode, activeCount: 10));

        var configStore = NewConfigStore();
        const string code = "AOI-PLAN-TIGHT";
        const int seed = 4141;
        const int boards = 300;
        configStore.Ensure(code, MachineParameterSchema.AoiInspection);

        var d = AoiDescriptor(code);

        double RunNgStepRate(int cycleOffset)
        {
            var sim = new AoiInspectorSim(d, seed, configStore: configStore, productCodeProvider: () => productCode, productConfigStore: productStore);
            var ngSteps = 0;
            var totalSteps = 0;
            for (var c = 1; c <= boards; c++)
            {
                var reading = sim.NextCycle(cycleOffset + c);
                totalSteps += reading.Plan!.Steps.Count;
                ngSteps += reading.Plan.Steps.Count(s => s.Result == "NG");
            }

            return (double)ngSteps / totalSteps;
        }

        var baselineRate = RunNgStepRate(cycleOffset: 0); // schema default matchThreshold = 0.85

        configStore.SetAdjustment(code, "matchThreshold", 0.97, AdjustmentScope.Machine, null, "test", "tight match threshold");
        var tightRate = RunNgStepRate(cycleOffset: boards);

        Assert.True(baselineRate is > 0.005 and < 0.20, $"baseline NG-step rate (matchThreshold=0.85) should be a believable low rate — got {baselineRate:P2}");
        Assert.True(tightRate > baselineRate + 0.20,
            $"tightening matchThreshold to 0.97 should raise the plan's NG-step rate by a large margin — baseline={baselineRate:P2}, tight={tightRate:P2}");
    }
}
