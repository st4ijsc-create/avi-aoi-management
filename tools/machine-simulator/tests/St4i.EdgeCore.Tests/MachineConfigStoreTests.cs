using St4i.EdgeCore.Config;
using Xunit;

/// <summary>Machine operating-configuration feature (docs/MACHINE_CONFIG_DESIGN.md §2), Task 1 —
/// covers <see cref="MachineParameterSchema"/>'s guardrails and <see cref="MachineConfigStore"/>'s
/// 3-layer resolution (baseline ⊕ machine-scoped ⊕ machine×product-scoped), provenance, hard min/max
/// enforcement, baseline-pull-preserves-adjustments, IoT's missing product dimension, and
/// restart-survival persistence.</summary>
public class MachineConfigStoreTests
{
    private static string TempDir() => Directory.CreateTempSubdirectory("st4i-machine-config-tests-").FullName;

    private static MachineConfigStore NewStore() => new(TempDir());

    // ─────────────────────────────────────────────────────────────────────
    // Schema — sanity + the NEW aoi_inspection vocabulary
    // ─────────────────────────────────────────────────────────────────────

    [Theory]
    [InlineData("SCREWDRIVE", MachineParameterSchema.ScrewProgram)]
    [InlineData("DISPENSING", MachineParameterSchema.DispenseProgram)]
    [InlineData("WELDER", MachineParameterSchema.WeldProfile)]
    [InlineData("IOT_SENSOR", MachineParameterSchema.IotSettings)]
    [InlineData("IOT_GATEWAY", MachineParameterSchema.IotSettings)]
    [InlineData("AOI", MachineParameterSchema.AoiInspection)]
    [InlineData("AVI", MachineParameterSchema.AoiInspection)]
    public void ConfigKindForMachineType_maps_every_known_machine_type(string machineType, string expectedKind)
    {
        Assert.Equal(expectedKind, MachineParameterSchema.ConfigKindForMachineType(machineType));
    }

    [Fact]
    public void ConfigKindForMachineType_returns_null_for_an_unmapped_type()
    {
        Assert.Null(MachineParameterSchema.ConfigKindForMachineType("ASSEMBLY"));
        Assert.Null(MachineParameterSchema.ConfigKindForMachineType(null));
    }

    [Fact]
    public void Aoi_inspection_defines_exactly_the_six_new_parameters()
    {
        var keys = MachineParameterSchema.ParametersFor(MachineParameterSchema.AoiInspection).Select(d => d.Key).ToList();
        Assert.Equal(
            new[] { "exposureUs", "gain", "lightIntensity", "conveyorSpeed", "fiducialTolerance", "matchThreshold" },
            keys);
    }

    [Fact]
    public void Iot_settings_has_no_product_scope_every_other_kind_does()
    {
        Assert.False(MachineParameterSchema.SupportsProductScope(MachineParameterSchema.IotSettings));
        Assert.True(MachineParameterSchema.SupportsProductScope(MachineParameterSchema.ScrewProgram));
        Assert.True(MachineParameterSchema.SupportsProductScope(MachineParameterSchema.DispenseProgram));
        Assert.True(MachineParameterSchema.SupportsProductScope(MachineParameterSchema.WeldProfile));
        Assert.True(MachineParameterSchema.SupportsProductScope(MachineParameterSchema.AoiInspection));
    }

    [Fact]
    public void ValidateRange_out_of_range_throws_with_a_message_naming_the_allowed_range()
    {
        var def = MachineParameterSchema.ParameterFor(MachineParameterSchema.ScrewProgram, "torqueTarget")!;

        var ex = Assert.Throws<ArgumentOutOfRangeException>(() => MachineParameterSchema.ValidateRange(def, 999));
        Assert.Contains("torqueTarget", ex.Message);
        Assert.Contains("0.10", ex.Message);
        Assert.Contains("20.00", ex.Message);
        Assert.Contains("999", ex.Message);
    }

    [Fact]
    public void ValidateRange_in_range_does_not_throw()
    {
        var def = MachineParameterSchema.ParameterFor(MachineParameterSchema.ScrewProgram, "torqueTarget")!;
        MachineParameterSchema.ValidateRange(def, def.Default); // no throw
    }

    // ─────────────────────────────────────────────────────────────────────
    // Ensure — baseline seeded from schema defaults
    // ─────────────────────────────────────────────────────────────────────

    [Fact]
    public void Ensure_first_call_seeds_baseline_from_schema_defaults_at_version_1()
    {
        var store = NewStore();
        var cfg = store.Ensure("AOI-01", MachineParameterSchema.AoiInspection);

        Assert.Equal(1, cfg.Baseline.Version);
        Assert.Equal(1500, cfg.Baseline.Values["exposureUs"]);
        Assert.Equal(0.85, cfg.Baseline.Values["matchThreshold"]);
        Assert.NotNull(cfg.Baseline.Checksum);
        Assert.Empty(cfg.MachineAdjustments);
        Assert.Empty(cfg.ProductAdjustments);
    }

    [Fact]
    public void Ensure_is_idempotent_and_does_not_reseed()
    {
        var store = NewStore();
        store.Ensure("AOI-01", MachineParameterSchema.AoiInspection);
        store.SetAdjustment("AOI-01", "gain", 2.0, AdjustmentScope.Machine, null, "tech1", null);

        var second = store.Ensure("AOI-01", MachineParameterSchema.AoiInspection);
        Assert.Single(second.MachineAdjustments); // untouched by the second Ensure call
    }

    [Fact]
    public void Ensure_with_a_different_config_kind_for_an_already_configured_machine_throws()
    {
        var store = NewStore();
        store.Ensure("AOI-01", MachineParameterSchema.AoiInspection);

        Assert.Throws<InvalidOperationException>(() => store.Ensure("AOI-01", MachineParameterSchema.ScrewProgram));
    }

    // ─────────────────────────────────────────────────────────────────────
    // Resolve — 3-layer order + provenance
    // ─────────────────────────────────────────────────────────────────────

    [Fact]
    public void Resolve_with_no_adjustments_returns_baseline_values_with_baseline_provenance()
    {
        var store = NewStore();
        store.Ensure("SCRW-01", MachineParameterSchema.ScrewProgram);

        var effective = store.Resolve("SCRW-01", null);

        var torque = effective.Parameters.Single(p => p.Def.Key == "torqueTarget");
        Assert.Equal(1.35, torque.Value);
        Assert.Equal(1.35, torque.BaselineValue);
        Assert.Equal(ConfigProvenance.Baseline, torque.Source);
        Assert.Null(torque.MachineAdjustment);
        Assert.Null(torque.ProductAdjustment);
    }

    [Fact]
    public void Machine_scoped_adjustment_overrides_baseline_and_applies_to_every_product()
    {
        var store = NewStore();
        store.Ensure("SCRW-01", MachineParameterSchema.ScrewProgram);
        store.SetAdjustment("SCRW-01", "torqueTarget", 1.60, AdjustmentScope.Machine, null, "tech1", "sensor reads 2% low");

        var forProductA = store.Resolve("SCRW-01", "MODEL-A");
        var forProductB = store.Resolve("SCRW-01", "MODEL-B");
        var forNoProduct = store.Resolve("SCRW-01", null);

        foreach (var effective in new[] { forProductA, forProductB, forNoProduct })
        {
            var torque = effective.Parameters.Single(p => p.Def.Key == "torqueTarget");
            Assert.Equal(1.60, torque.Value);
            Assert.Equal(ConfigProvenance.Machine, torque.Source);
            Assert.Equal(1.35, torque.BaselineValue); // recommendation still visible even though overridden
            Assert.NotNull(torque.MachineAdjustment);
            Assert.Equal("tech1", torque.MachineAdjustment!.By);
        }
    }

    [Fact]
    public void Product_scoped_adjustment_wins_over_machine_scoped_for_that_product_only()
    {
        var store = NewStore();
        store.Ensure("AOI-01", MachineParameterSchema.AoiInspection);
        store.SetAdjustment("AOI-01", "exposureUs", 1800, AdjustmentScope.Machine, null, "tech1", "cell near a window, brighter");
        store.SetAdjustment("AOI-01", "exposureUs", 3200, AdjustmentScope.Product, "MODEL-B", "tech2", "MODEL-B substrate is darker");

        var forModelB = store.Resolve("AOI-01", "MODEL-B");
        var forModelA = store.Resolve("AOI-01", "MODEL-A");
        var forNoProduct = store.Resolve("AOI-01", null);

        var exposureB = forModelB.Parameters.Single(p => p.Def.Key == "exposureUs");
        Assert.Equal(3200, exposureB.Value);
        Assert.Equal(ConfigProvenance.MachineProduct, exposureB.Source);
        Assert.NotNull(exposureB.MachineAdjustment); // machine-scoped entry still surfaced even though it lost
        Assert.Equal(1800, exposureB.MachineAdjustment!.Value);
        Assert.NotNull(exposureB.ProductAdjustment);
        Assert.Equal(3200, exposureB.ProductAdjustment!.Value);

        var exposureA = forModelA.Parameters.Single(p => p.Def.Key == "exposureUs");
        Assert.Equal(1800, exposureA.Value); // MODEL-A only sees the machine-scoped layer
        Assert.Equal(ConfigProvenance.Machine, exposureA.Source);

        var exposureNone = forNoProduct.Parameters.Single(p => p.Def.Key == "exposureUs");
        Assert.Equal(1800, exposureNone.Value);
        Assert.Equal(ConfigProvenance.Machine, exposureNone.Source);
    }

    [Fact]
    public void Removing_an_adjustment_falls_back_to_the_layer_below()
    {
        var store = NewStore();
        store.Ensure("AOI-01", MachineParameterSchema.AoiInspection);
        store.SetAdjustment("AOI-01", "gain", 2.0, AdjustmentScope.Machine, null, "tech1", null);
        store.SetAdjustment("AOI-01", "gain", 3.0, AdjustmentScope.Product, "MODEL-A", "tech1", null);

        store.RemoveAdjustment("AOI-01", "gain", AdjustmentScope.Product, "MODEL-A", "tech1");
        var afterProductRemoved = store.Resolve("AOI-01", "MODEL-A").Parameters.Single(p => p.Def.Key == "gain");
        Assert.Equal(2.0, afterProductRemoved.Value);
        Assert.Equal(ConfigProvenance.Machine, afterProductRemoved.Source);

        store.RemoveAdjustment("AOI-01", "gain", AdjustmentScope.Machine, null, "tech1");
        var afterMachineRemoved = store.Resolve("AOI-01", "MODEL-A").Parameters.Single(p => p.Def.Key == "gain");
        Assert.Equal(1.0, afterMachineRemoved.Value); // schema default
        Assert.Equal(ConfigProvenance.Baseline, afterMachineRemoved.Source);
    }

    // ─────────────────────────────────────────────────────────────────────
    // Hard min/max enforcement on write — rejected, never clamped
    // ─────────────────────────────────────────────────────────────────────

    [Fact]
    public void SetAdjustment_out_of_range_is_rejected_and_leaves_the_store_untouched()
    {
        var store = NewStore();
        store.Ensure("SCRW-01", MachineParameterSchema.ScrewProgram);

        var ex = Assert.Throws<ArgumentOutOfRangeException>(() =>
            store.SetAdjustment("SCRW-01", "torqueTarget", 500, AdjustmentScope.Machine, null, "tech1", null));

        Assert.Contains("torqueTarget", ex.Message);
        Assert.Contains("must be between", ex.Message);

        var effective = store.Resolve("SCRW-01", null).Parameters.Single(p => p.Def.Key == "torqueTarget");
        Assert.Equal(ConfigProvenance.Baseline, effective.Source); // untouched — not silently clamped
        Assert.Equal(1.35, effective.Value);
    }

    [Fact]
    public void SetAdjustment_unknown_key_throws_KeyNotFoundException()
    {
        var store = NewStore();
        store.Ensure("SCRW-01", MachineParameterSchema.ScrewProgram);

        Assert.Throws<KeyNotFoundException>(() =>
            store.SetAdjustment("SCRW-01", "notARealKey", 1.0, AdjustmentScope.Machine, null, "tech1", null));
    }

    // ─────────────────────────────────────────────────────────────────────
    // IoT — no product dimension
    // ─────────────────────────────────────────────────────────────────────

    [Fact]
    public void Iot_machine_product_scoped_write_is_rejected()
    {
        var store = NewStore();
        store.Ensure("IOT-01", MachineParameterSchema.IotSettings);

        var ex = Assert.Throws<InvalidOperationException>(() =>
            store.SetAdjustment("IOT-01", "sampleRateHz", 5.0, AdjustmentScope.Product, "MODEL-A", "tech1", null));
        Assert.Contains("no product dimension", ex.Message);
    }

    [Fact]
    public void Iot_machine_resolve_ignores_a_supplied_product_code()
    {
        var store = NewStore();
        store.Ensure("IOT-01", MachineParameterSchema.IotSettings);
        store.SetAdjustment("IOT-01", "sampleRateHz", 5.0, AdjustmentScope.Machine, null, "tech1", null);

        var effective = store.Resolve("IOT-01", "MODEL-A"); // a product code that shouldn't matter
        Assert.Null(effective.ProductCode);
        Assert.Equal(5.0, effective.Parameters.Single(p => p.Def.Key == "sampleRateHz").Value);
    }

    // ─────────────────────────────────────────────────────────────────────
    // Pull — never discards adjustments
    // ─────────────────────────────────────────────────────────────────────

    [Fact]
    public void PullBaseline_preserves_machine_and_product_adjustments_and_bumps_version()
    {
        var store = NewStore();
        store.Ensure("AOI-01", MachineParameterSchema.AoiInspection);
        store.SetAdjustment("AOI-01", "exposureUs", 1800, AdjustmentScope.Machine, null, "tech1", null);
        store.SetAdjustment("AOI-01", "exposureUs", 3200, AdjustmentScope.Product, "MODEL-B", "tech2", null);

        var pulled = store.PullBaseline("AOI-01", MachineParameterSchema.AoiInspection, newValues: null, by: "system");

        Assert.Equal(2, pulled.Baseline.Version);
        Assert.Single(pulled.MachineAdjustments);
        Assert.Equal(1800, pulled.MachineAdjustments["exposureUs"].Value);
        Assert.Single(pulled.ProductAdjustments);
        Assert.Equal(3200, pulled.ProductAdjustments["MODEL-B"]["exposureUs"].Value);

        // Effective config for MODEL-B is unaffected by the pull — still the product-scoped value.
        var effective = store.Resolve("AOI-01", "MODEL-B").Parameters.Single(p => p.Def.Key == "exposureUs");
        Assert.Equal(3200, effective.Value);
        Assert.Equal(ConfigProvenance.MachineProduct, effective.Source);
    }

    [Fact]
    public void PullBaseline_with_new_values_updates_baseline_recommendations()
    {
        var store = NewStore();
        store.Ensure("SCRW-01", MachineParameterSchema.ScrewProgram);

        var pulled = store.PullBaseline("SCRW-01", MachineParameterSchema.ScrewProgram,
            newValues: new Dictionary<string, double> { ["torqueTarget"] = 1.50 }, by: "system");

        Assert.Equal(1.50, pulled.Baseline.Values["torqueTarget"]);
        Assert.Equal(2, pulled.Baseline.Version);
    }

    [Fact]
    public void PullBaseline_on_an_unconfigured_machine_creates_it()
    {
        var store = NewStore();
        var pulled = store.PullBaseline("WELD-01", MachineParameterSchema.WeldProfile, newValues: null, by: "system");

        Assert.Equal(1, pulled.Baseline.Version);
        Assert.Equal(120, pulled.Baseline.Values["current"]);
    }

    // ─────────────────────────────────────────────────────────────────────
    // I-2 (mc-feature-review.md) — an out-of-range server baseline must never silently
    // become the effective/driving value; it is rejected and flagged, schema default used instead.
    // ─────────────────────────────────────────────────────────────────────

    [Fact]
    public void PullBaseline_rejects_an_out_of_range_server_value_on_a_baseline_REFRESH_and_falls_back_to_the_schema_default()
    {
        var store = NewStore();
        store.Ensure("SCRW-01", MachineParameterSchema.ScrewProgram); // schema torqueTarget range: 0.10-20.00, default 1.35

        var pulled = store.PullBaseline("SCRW-01", MachineParameterSchema.ScrewProgram,
            newValues: new Dictionary<string, double> { ["torqueTarget"] = 50.0, ["torqueTolerance"] = 0.20 }, by: "system");

        // Out-of-range value REJECTED — schema default used, never the raw 50.0.
        Assert.Equal(1.35, pulled.Baseline.Values["torqueTarget"]);
        Assert.True(pulled.Baseline.OutOfRangeRejected.ContainsKey("torqueTarget"));
        Assert.Equal(50.0, pulled.Baseline.OutOfRangeRejected["torqueTarget"]);

        // The IN-range sibling value in the SAME pull is unaffected — only the offending key is rejected.
        Assert.Equal(0.20, pulled.Baseline.Values["torqueTolerance"]);
        Assert.False(pulled.Baseline.OutOfRangeRejected.ContainsKey("torqueTolerance"));

        // The rejected value never becomes the effective/driving value either.
        var effective = store.Resolve("SCRW-01", null).Parameters.Single(p => p.Def.Key == "torqueTarget");
        Assert.Equal(1.35, effective.Value);
        Assert.Equal(ConfigProvenance.Baseline, effective.Source);
    }

    [Fact]
    public void PullBaseline_rejects_an_out_of_range_server_value_on_the_FIRST_ever_pull_for_a_brand_new_machine()
    {
        var store = NewStore();

        // WELD-01 has never been seen — this is the SeedConfig+newValues branch, a separate code path
        // from the refresh branch above (both must be guarded).
        var pulled = store.PullBaseline("WELD-01", MachineParameterSchema.WeldProfile,
            newValues: new Dictionary<string, double> { ["current"] = 99_999.0 }, by: "system"); // schema range 1-500

        Assert.Equal(120, pulled.Baseline.Values["current"]); // schema default, not the rejected 99999
        Assert.Equal(99_999.0, pulled.Baseline.OutOfRangeRejected["current"]);

        var effective = store.Resolve("WELD-01", null).Parameters.Single(p => p.Def.Key == "current");
        Assert.Equal(120, effective.Value);
    }

    [Fact]
    public void PullBaseline_with_all_in_range_values_leaves_OutOfRangeRejected_empty()
    {
        var store = NewStore();
        store.Ensure("SCRW-01", MachineParameterSchema.ScrewProgram);

        var pulled = store.PullBaseline("SCRW-01", MachineParameterSchema.ScrewProgram,
            newValues: new Dictionary<string, double> { ["torqueTarget"] = 1.50 }, by: "system");

        Assert.Empty(pulled.Baseline.OutOfRangeRejected);
    }

    // ─────────────────────────────────────────────────────────────────────
    // Push — reports actual config, never touches baseline
    // ─────────────────────────────────────────────────────────────────────

    [Fact]
    public void RecordPush_does_not_change_baseline_or_adjustments()
    {
        var store = NewStore();
        store.Ensure("SCRW-01", MachineParameterSchema.ScrewProgram);
        store.SetAdjustment("SCRW-01", "torqueTarget", 1.60, AdjustmentScope.Machine, null, "tech1", null);
        var before = store.GetConfig("SCRW-01")!;

        store.RecordPush("SCRW-01", null, "tech1", "reported actual config");
        var after = store.GetConfig("SCRW-01")!;

        Assert.Equal(before.Baseline.Version, after.Baseline.Version);
        Assert.Equal(before.Baseline.Checksum, after.Baseline.Checksum);
        Assert.Equal(before.MachineAdjustments["torqueTarget"].Value, after.MachineAdjustments["torqueTarget"].Value);
        Assert.Contains(after.History, h => h.Op == "push");
    }

    // ─────────────────────────────────────────────────────────────────────
    // Checksum
    // ─────────────────────────────────────────────────────────────────────

    [Fact]
    public void ComputeAdjustmentsChecksum_is_stable_and_changes_only_when_adjustments_change()
    {
        var store = NewStore();
        store.Ensure("SCRW-01", MachineParameterSchema.ScrewProgram);
        var emptyChecksum1 = store.ComputeAdjustmentsChecksum("SCRW-01");
        var emptyChecksum2 = store.ComputeAdjustmentsChecksum("SCRW-01");
        Assert.Equal(emptyChecksum1, emptyChecksum2);

        store.SetAdjustment("SCRW-01", "torqueTarget", 1.60, AdjustmentScope.Machine, null, "tech1", null);
        var afterSet = store.ComputeAdjustmentsChecksum("SCRW-01");
        Assert.NotEqual(emptyChecksum1, afterSet);

        // A no-op note-only touch doesn't change VALUE, so the checksum should be stable across it too.
        store.SetAdjustment("SCRW-01", "torqueTarget", 1.60, AdjustmentScope.Machine, null, "tech2", "same value, different author");
        Assert.Equal(afterSet, store.ComputeAdjustmentsChecksum("SCRW-01"));
    }

    // ─────────────────────────────────────────────────────────────────────
    // Persistence — survives restart
    // ─────────────────────────────────────────────────────────────────────

    [Fact]
    public void State_survives_a_fresh_store_instance_pointed_at_the_same_directory()
    {
        var dir = TempDir();
        var store1 = new MachineConfigStore(dir);
        store1.Ensure("AOI-01", MachineParameterSchema.AoiInspection);
        store1.SetAdjustment("AOI-01", "exposureUs", 1800, AdjustmentScope.Machine, null, "tech1", "window glare");
        store1.SetAdjustment("AOI-01", "exposureUs", 3200, AdjustmentScope.Product, "MODEL-B", "tech2", "dark substrate");
        store1.PullBaseline("AOI-01", MachineParameterSchema.AoiInspection, null, "system");

        var store2 = new MachineConfigStore(dir); // simulates a process restart
        var cfg = store2.GetConfig("AOI-01");

        Assert.NotNull(cfg);
        Assert.Equal(2, cfg!.Baseline.Version);
        Assert.Equal(1800, cfg.MachineAdjustments["exposureUs"].Value);
        Assert.Equal(3200, cfg.ProductAdjustments["MODEL-B"]["exposureUs"].Value);

        var effective = store2.Resolve("AOI-01", "MODEL-B").Parameters.Single(p => p.Def.Key == "exposureUs");
        Assert.Equal(3200, effective.Value);
        Assert.Equal(ConfigProvenance.MachineProduct, effective.Source);
    }

    [Fact]
    public void Reload_re_reads_the_same_in_process_instance_from_disk()
    {
        var dir = TempDir();
        var store = new MachineConfigStore(dir);
        store.Ensure("SCRW-01", MachineParameterSchema.ScrewProgram);
        store.SetAdjustment("SCRW-01", "torqueTarget", 1.60, AdjustmentScope.Machine, null, "tech1", null);

        store.Reload();

        var cfg = store.GetConfig("SCRW-01");
        Assert.NotNull(cfg);
        Assert.Equal(1.60, cfg!.MachineAdjustments["torqueTarget"].Value);
    }

    // ─────────────────────────────────────────────────────────────────────
    // History
    // ─────────────────────────────────────────────────────────────────────

    [Fact]
    public void History_records_set_delete_pull_and_push_newest_first()
    {
        var store = NewStore();
        store.Ensure("SCRW-01", MachineParameterSchema.ScrewProgram); // does not itself add a history row
        store.SetAdjustment("SCRW-01", "torqueTarget", 1.60, AdjustmentScope.Machine, null, "tech1", null);
        store.RemoveAdjustment("SCRW-01", "torqueTarget", AdjustmentScope.Machine, null, "tech1");
        store.PullBaseline("SCRW-01", MachineParameterSchema.ScrewProgram, null, "system");
        store.RecordPush("SCRW-01", null, "tech1", "reported");

        var history = store.History("SCRW-01");
        Assert.Equal(new[] { "push", "pull", "delete", "set" }, history.Select(h => h.Op).ToArray());
        Assert.Equal(new long[] { 4, 3, 2, 1 }, history.Select(h => h.Seq).ToArray());
    }
}
