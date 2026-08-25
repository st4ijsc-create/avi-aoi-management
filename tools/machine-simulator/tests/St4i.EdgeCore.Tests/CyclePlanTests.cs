using St4i.EdgeCore.Config;
using St4i.EdgeCore.Drivers.Simulators;
using St4i.EdgeCore.Historian;
using St4i.EdgeCore.Infrastructure;
using St4i.EdgeCore.Metrics;
using St4i.EdgeCore.Models;
using St4i.Connector.Abstractions.Models;
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

    /// <summary>Cycles per machine for the item 70 direction-B OEE witness. Matches
    /// <c>AssumedProcessBandTests.Cycles</c> so the two item-62/item-70 measurement families are read at the
    /// same resolution.</summary>
    private const long OeeCycles = 100_000;

    private static string MachineSimulatorRoot()
    {
        var dir = new DirectoryInfo(AppContext.BaseDirectory);
        while (dir is not null)
        {
            if (File.Exists(Path.Combine(dir.FullName, "fleet.json")) && Directory.Exists(Path.Combine(dir.FullName, "mapping")))
                return dir.FullName;
            dir = dir.Parent;
        }

        throw new InvalidOperationException(
            $"Could not locate tools/machine-simulator (fleet.json + mapping/) by walking up from \"{AppContext.BaseDirectory}\"");
    }

    /// <summary>The descriptor the product actually ships for <paramref name="code"/>, read from the real
    /// <c>fleet.json</c> rather than hand-built — the item 70 OEE measurement is a claim about the DEMO
    /// FLEET, so it must not be made against a descriptor invented by the test.</summary>
    /// <param name="code">A SCREWDRIVE machine code present in the shipped roster.</param>
    /// <returns>That roster entry, including its declared <c>screwTorque</c> band.</returns>
    private static MachineDescriptor ShippedScrew(string code) =>
        FleetConfig.Load(Path.Combine(MachineSimulatorRoot(), "fleet.json")).Single(m => m.Code == code);

    private static MachineDescriptor ScrewDescriptor(string code) =>
        new(code, $"SN-{code}", DeviceClass.Automation, "SCREWDRIVE", "screw_tightening", DriverKinds.Simulated, "RC1", null, 1.0);

    private static MachineDescriptor AoiDescriptor(string code) =>
        new(code, $"SN-{code}", DeviceClass.AoiAvi, "AOI", "inspection", DriverKinds.Simulated, "RC1", null, 1.0);

    private static MachineDescriptor IotDescriptor(string code) =>
        new(code, $"SN-{code}", DeviceClass.Iot, "IOT_SENSOR", null, DriverKinds.Simulated, null, null, 1.0);

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
        // 🔴 This assertion carried a precision argument of 3 and therefore could not tell a shared draw
        // from a ROUNDED COPY of one, which is the whole of item 70's first claim. Owner's ruling
        // 2026-08-24, direction A: exact now. See Item70_… below for the witness that says why.
        Assert.Equal(reading.Metrics[0].Value, reading.Plan.Steps[0].MetricValue!.Value);
        Assert.All(reading.Plan.Steps, s => Assert.Equal("Nm", s.Unit));

        // 🔴 OWNER'S RULING 2026-08-25, item 70 — DIRECTION B. The assertion that stood here was:
        //     Assert.All(reading.Plan.Steps, s => Assert.True(s.Result is "OK" or "NG"));
        // It is retracted, not deleted, because it was TRUE and was the right assertion for as long as
        // every step carried its own draw. Direction B removed the three extra draws, so steps 1..3 are
        // now positions with no measurement and say so with a null Result — the same convention
        // IotSensorSim's steps have always used. Step 0 still carries a real pass/fail, and that is now
        // asserted separately rather than being averaged into an "all steps" claim that no longer holds.
        Assert.True(reading.Plan.Steps[0].Result is "OK" or "NG");
        Assert.All(reading.Plan.Steps.Skip(1), s => Assert.Null(s.Result));
    }

    /// <summary>🔴 <b>WITNESS for owner item 70, direction A — 2026-08-24. Reddens by restoring
    /// <c>MetricValue: Math.Round(torque, 3)</c> in <c>ScrewdriveSim.BuildFasteningPlan</c>.</b>
    ///
    /// <para><b>The claim being pinned, and its unit.</b> Item 70 §70.1 says <c>GET /v1/machines/{code}</c>
    /// carried "two numbers for one torque", and re-measures the gap between them as "≤ 5·10⁻⁴ Nm" — the
    /// worst case of a round to three decimals. Direction A removes the rounding, so the gap is now exactly
    /// zero, and that is asserted here as an EXACT equality of two doubles rather than a tolerance, because
    /// a tolerance is what let the old shape sit unnoticed.</para>
    ///
    /// <para>🔴 <b>AND THE PART OF ITEM 70 THIS DOES NOT CLOSE, ASSERTED RATHER THAN SAID — because the
    /// ruling was told, before it chose, that direction A "does not buy anything material".</b> Two facts
    /// below carry that:</para>
    /// <list type="number">
    /// <item><b>The response still ships FOUR torque numbers for ONE cycle.</b> Steps 1..3 are fresh
    /// independent draws, they are not in <c>Metrics</c>, so they reach neither SPC nor the ingest payload
    /// nor the historian — and they still decide the reading's verdict. That is item 70's actual headline
    /// and direction A does not touch it. Directions B and C were not authorised.</item>
    /// <item><b>A rounded rendering of the same draw survives elsewhere in the same response.</b>
    /// <c>MachineState.FormatKeyMetric</c> formats <c>Metrics[0]</c> with <c>"0.###"</c>, so
    /// <c>cycleLog[].keyMetric</c> still disagrees with <c>spc.values[]</c> in the same digit
    /// <c>Math.Round</c> used to. Direction A moved the discrepancy; it did not remove it from the
    /// response.</item>
    /// </list>
    ///
    /// <para><b>What this does NOT measure:</b> the endpoint or the DTO. It reads the simulator's own
    /// reading, so it says nothing about what <c>FleetProjections.ToDetailDto</c> does with either
    /// field.</para></summary>
    [Fact]
    public void Item70_DirectionB_TheThreeExtraDrawsAreGone_ButTheRoundedStringStillSurvives()
    {
        var d = ScrewDescriptor("SCRW-ITEM70");
        var reading = new ScrewdriveSim(d, seed: 17).NextCycle(1);

        var torque = reading.Metrics[0].Value;
        Assert.Equal("torque", reading.Metrics[0].Name);

        // (A) Direction A itself, UNCHANGED by direction B: the SAME double, not a rendering of it.
        Assert.NotNull(reading.Plan);
        Assert.Equal(torque, reading.Plan!.Steps[0].MetricValue!.Value);

        // (A2) The unit of the claim item 70 makes, pinned: what direction A removed was bounded by 5e-4 Nm.
        Assert.True(Math.Abs(Math.Round(torque, 3) - torque) <= 5e-4);

        // (B) 🔴 DIRECTION B — THE HEADLINE IS CLOSED. The assertions that stood here were:
        //         Assert.Equal(4, reading.Plan.Steps.Count);
        //         Assert.Equal(3, reading.Plan.Steps.Skip(1).Count(s => s.MetricValue!.Value != torque));
        //     and they pinned the defect: FOUR torque numbers for ONE cycle. The first is KEPT — the four
        //     positions are deliberately still four, because direction B deletes the extra DRAWS, not the
        //     extra POSITIONS, and changing the array length would move a published payload's cardinality
        //     for no reason the owner gave. The second is REPLACED by its negation, below.
        Assert.Equal(4, reading.Plan.Steps.Count);
        Assert.Equal(3, reading.Plan.Steps.Skip(1).Count(s => s.MetricValue is null));
        Assert.All(reading.Plan.Steps.Skip(1), s => Assert.Null(s.Result));
        Assert.Single(reading.Metrics, m => m.Name == "torque");

        // (B2) ONE torque number now leaves this cycle, and it is the one every other surface also carries.
        Assert.Single(reading.Plan.Steps, s => s.MetricValue is not null);

        // (C) 🔴 WHAT DIRECTION B DOES **NOT** CLOSE, asserted rather than said. `MachineState.FormatKeyMetric`
        // renders Metrics[0] with "0.###" — three decimals — so `cycleLog[].keyMetric` still disagrees with
        // `spc.values[]` in exactly the digit direction A was chosen to remove. B did not touch that file.
        // Measured 2026-08-25 over 100 000 cycles on each shipped SCREWDRIVE: the two renderings differ on
        // 100 000 of 100 000 — 100.00% of cycles. The response is one number closer to honest and is still
        // not self-consistent.
        var keyMetric = $"{reading.Metrics[0].Name}={torque:0.###}{reading.Metrics[0].Unit}";
        Assert.Equal($"torque={torque:0.###}Nm", keyMetric);
        Assert.NotEqual(torque.ToString("R", System.Globalization.CultureInfo.InvariantCulture), torque.ToString("0.###", System.Globalization.CultureInfo.InvariantCulture));
    }

    /// <summary>🔴 <b>THE OEE WITNESS for owner item 70, direction B — 2026-08-25. Reddens by restoring the
    /// two retired lines in <c>ScrewdriveSim.BuildFasteningPlan</c>'s <c>else</c> arm.</b>
    ///
    /// <para><b>Why this test exists at all.</b> Direction B was authorised knowing it crosses the standing
    /// "a REPORTED OEE NUMBER" exemption. An exemption crossed without a measurement of what it bought is
    /// the shape item 43 was opened about, so the size of the shift is pinned here rather than described.
    /// <b>If this number were zero, the change would not have done the thing it was authorised to do.</b></para>
    ///
    /// <para><b>The measurement, stated with its units.</b> The demo roster's own two SCREWDRIVE machines,
    /// read from the real <c>fleet.json</c>, at <c>FleetCore</c>'s own seed rule (<c>1000 + rosterIndex</c>,
    /// so SCRW-01 → 1000 and SCRW-02 → 1001), 100 000 cycles each, the SAME seed and the SAME cycle count on
    /// both sides of the change. Determinism makes this a genuine controlled comparison rather than two
    /// samples: <c>SimRng.For</c> is a pure function of (seed, cycle) and the extra draws were taken LAST in
    /// the cycle, so removing them cannot shift the primary draw of this or any later cycle. Before → after:
    /// SCRW-01 3 → 1 failing cycles, SCRW-02 9 → 3. Pooled 12 → 4 of 200 000.</para>
    ///
    /// <para>🔴 <b>THE OTHER DIRECTION, because a truth written only one way is half a truth.</b> Eight of
    /// twelve reported failures disappearing is the favourable reading. The unfavourable one is that anyone
    /// comparing a window before 2026-08-25 with a window after it sees a STEP UP IN OEE THAT NO PRODUCTION
    /// IMPROVEMENT CAUSED, and nothing in the product labels that discontinuity.</para>
    ///
    /// <para><b>What this does NOT measure:</b> a real OEE as a customer would see it. Availability and
    /// Performance are pinned at exactly 1 here (planned time = nominal cycle time, ideal cycle = the
    /// descriptor's own), which is the shipped DEFAULT <c>OeeMachineSettings</c> but not every install's.
    /// Under any other settings the same Quality shift is multiplied by A×P and is therefore SMALLER, never
    /// larger. It also does not measure the historian, the endpoint, or any window a user actually
    /// selects.</para></summary>
    [Fact]
    public void Item70_DirectionB_RemovingTheExtraDrawsMovesTheReportedOeeQualityNumber()
    {
        (long Fail, long Total, double Oee) Run(string code, int seed)
        {
            var sim = new ScrewdriveSim(ShippedScrew(code), seed);
            long fail = 0;
            for (long c = 1; c <= OeeCycles; c++)
                if (sim.NextCycle(c).Verdict == Verdict.Fail) fail++;

            var cycleSeconds = ShippedScrew(code).CycleSeconds;
            var planned = TimeSpan.FromSeconds(OeeCycles * cycleSeconds);
            var agg = new OeeInputAggregate(code, DateTimeOffset.UnixEpoch, DateTimeOffset.UnixEpoch, OeeCycles, OeeCycles - fail, planned);
            return (fail, OeeCycles, OeeCalculator.Calculate(agg, planned, cycleSeconds).Oee);
        }

        var one = Run("SCRW-01", 1000);
        var two = Run("SCRW-02", 1001);

        // 🔴 The post-B counts. Before direction B these were 3 and 9; restoring the two retired draw lines
        // reddens exactly here, which is what makes this a witness and not a description.
        Assert.Equal(1, one.Fail);
        Assert.Equal(3, two.Fail);

        // The shift, in the unit the exemption is written in — a reported OEE number, not a rate of draws.
        Assert.Equal(0.999990, one.Oee, 6);
        Assert.Equal(0.999970, two.Oee, 6);

        // 🔴 dOEE != 0 — asserted as the pooled figure so the claim is about the demo FLEET, not one machine.
        const long PooledFailBeforeDirectionB = 12;
        var pooledAfter = one.Fail + two.Fail;
        Assert.Equal(4, pooledAfter);
        var dQuality = (double)(PooledFailBeforeDirectionB - pooledAfter) / (one.Total + two.Total);
        Assert.Equal(0.00004, dQuality, 8);
        Assert.True(dQuality > 0, "a direction-B fix that moved no OEE number would not have done what it was authorised to do");
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
        var d = new MachineDescriptor("MC-01", "SN", DeviceClass.Automation, "TYPE", "step", DriverKinds.Simulated, "RC1", null, 1.0);
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

                // 🔴 OWNER'S RULING 2026-08-25, item 70 — DIRECTION B. This line used to read:
                //     totalSteps += reading.Plan!.Steps.Count;
                // and it must change, for a reason worth stating rather than patching around. The rate this
                // test is about is "how often does a MEASURED fastening come out NG", and until direction B
                // every one of the four steps was measured, so Steps.Count was the right denominator. After
                // B only step 0 carries a measurement; leaving Steps.Count in place would have divided a
                // real rate by four and quietly turned a genuine property into a false one.
                // MEASURED 2026-08-25, tolerance 0.02 vs the 0.15 default, 1000 cycles, seed 2024:
                //   denominator Steps.Count (4)  -> baseline 0.0000%, tight 13.0750%, diff 13.08 pts -> the
                //                                   `+0.30` assertion below would have gone RED;
                //   denominator MEASURED steps   -> baseline 0.0000%, tight 52.3000%, diff 52.30 pts -> green,
                //                                   and materially the same figure as the 51.88 pts this
                //                                   test measured before direction B existed.
                // So the change of denominator RESTORES the quantity the test always meant; it does not
                // relax it. A red here still means config stopped driving the NG rate.
                totalSteps += reading.Plan!.Steps.Count(s => s.Result is not null);
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
