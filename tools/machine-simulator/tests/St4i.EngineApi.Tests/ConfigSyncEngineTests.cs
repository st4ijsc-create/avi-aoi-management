using St4i.EdgeCore.Config;
using St4i.EdgeCore.Models;
using St4i.EngineApi.Config;
using Xunit;

namespace St4i.EngineApi.Tests;

/// <summary>
/// Task C2 — <see cref="ConfigSyncEngine"/> (Demo backend: <see cref="SimulatedEcosystem"/>). Exercises
/// check/pull/push/diff/history end-to-end against the SEEDED divergence between
/// <see cref="ProductConfigStore"/>'s local seed and <see cref="SimulatedEcosystem"/>'s own (see its doc
/// comment: MODEL-A gets +2 versions via a changed limit on P05, a tombstoned P08, and a new P09;
/// MODEL-B gets +1 via a small Q03 tweak; SCREWDRIVE-M4 gets +1 via a torque bump) — most tests need NO
/// extra local mutation to get a non-trivial diff/pull/check, exactly as the seed was designed for.
/// </summary>
public sealed class ConfigSyncEngineTests
{
    private static readonly MachineDescriptor AoiMachine = new(
        "AOI-01", "SN-AOI01", DeviceClass.AoiAvi, "AOI", "inspection", DriverKind.Simulated, "RC-AOI-A", null, 1.8);

    private static readonly MachineDescriptor ScrewMachine = new(
        "SCRW-01", "SN-SCRW01", DeviceClass.Automation, "SCREWDRIVE", "screw_tightening", DriverKind.Simulated, "RC-SCRW-A", null, 0.8);

    private static readonly MachineDescriptor IotMachine = new(
        "IOT-01", "SN-IOT01", DeviceClass.Iot, "IOT_SENSOR", "telemetry", DriverKind.Simulated, null, null, 0.4);

    private static string TempDir() => Directory.CreateTempSubdirectory("st4i-config-sync-tests-").FullName;

    private static (ProductConfigStore Local, SimulatedEcosystem Ecosystem, ConfigSyncEngine Engine) CreateHarness()
    {
        var local = new ProductConfigStore(TempDir());
        var ecosystem = new SimulatedEcosystem(TempDir());
        var engine = new ConfigSyncEngine(local, ecosystem);
        return (local, ecosystem, engine);
    }

    // ─────────────────────────────────────────────────────────────────────
    // Push basics
    // ─────────────────────────────────────────────────────────────────────

    [Fact]
    public async Task Push_a_newly_authored_point_bumps_ecosystem_version_and_point_is_present()
    {
        var (local, ecosystem, engine) = CreateHarness();
        var before = (await ecosystem.CheckPointsVersionAsync("MODEL-A", default)).Single().PointsConfigVersion;

        local.UpsertPoint("MODEL-A", new MeasurementPoint
        {
            Code = "P99", Name = "New Local Point", MeasurementType = MeasurementType.Visual,
            PositionX = 500, PositionY = 500, OrderIndex = 20, IsActive = true,
        });

        var result = await engine.PushAsync(AoiMachine, "MODEL-A", confirm: true, default);

        Assert.True(result.Success);
        Assert.True(result.NewVersion > before);
        var outcome = Assert.Single(result.Points, p => p.Code == "P99");
        Assert.Equal("created", outcome.Status);

        var ecoProduct = await ecosystem.GetPointsAsync("MODEL-A", null, default);
        Assert.Contains(ecoProduct!.Points, p => p.Code == "P99" && !p.IsDeleted);
    }

    [Fact]
    public async Task Push_without_confirm_is_a_no_op()
    {
        var (_, ecosystem, engine) = CreateHarness();
        var before = (await ecosystem.CheckPointsVersionAsync("MODEL-A", default)).Single().PointsConfigVersion;

        var result = await engine.PushAsync(AoiMachine, "MODEL-A", confirm: false, default);

        Assert.False(result.Success);
        var after = (await ecosystem.CheckPointsVersionAsync("MODEL-A", default)).Single().PointsConfigVersion;
        Assert.Equal(before, after);
    }

    [Fact]
    public async Task Push_unknown_local_product_throws_KeyNotFoundException()
    {
        var (_, _, engine) = CreateHarness();
        await Assert.ThrowsAsync<KeyNotFoundException>(() => engine.PushAsync(AoiMachine, "NOPE", confirm: true, default));
    }

    // ─────────────────────────────────────────────────────────────────────
    // Pull applies the seeded divergence
    // ─────────────────────────────────────────────────────────────────────

    [Fact]
    public async Task Pull_applies_ecosystem_divergence_into_local_store()
    {
        var (local, _, engine) = CreateHarness();

        var localBefore = local.GetProduct("MODEL-A")!;
        Assert.Equal(3, localBefore.PointsConfigVersion);
        Assert.DoesNotContain(localBefore.Points, p => p.Code == "P09");

        var result = await engine.PullAsync(AoiMachine, "MODEL-A", default);

        Assert.True(result.Applied);
        Assert.Equal(3, result.FromVersion);
        Assert.Equal(5, result.ToVersion);
        Assert.NotNull(result.Diff);
        Assert.Contains("P09", result.Diff!.AddedPointCodes);
        Assert.Contains("P08", result.Diff.RemovedPointCodes);
        Assert.Contains(result.Diff.ChangedPoints, c => c.Code == "P05");

        var localAfter = local.GetProduct("MODEL-A")!;
        Assert.Equal(5, localAfter.PointsConfigVersion);
        Assert.Contains(localAfter.ActivePoints, p => p.Code == "P09");
        Assert.DoesNotContain(localAfter.ActivePoints, p => p.Code == "P08");
        var p05 = localAfter.Points.First(p => p.Code == "P05");
        Assert.Equal(4700, p05.LowerLimit);
        Assert.Equal(5300, p05.UpperLimit);
    }

    [Fact]
    public async Task Pull_without_productCode_for_an_AoiAvi_machine_throws_ArgumentException()
    {
        var (_, _, engine) = CreateHarness();
        await Assert.ThrowsAsync<ArgumentException>(() => engine.PullAsync(AoiMachine, null, default));
    }

    // ─────────────────────────────────────────────────────────────────────
    // Diff — no local mutation needed, pure seed divergence.
    // ─────────────────────────────────────────────────────────────────────

    [Fact]
    public async Task Diff_detects_added_removed_changed_and_version_delta()
    {
        var (_, _, engine) = CreateHarness();

        var diff = await engine.DiffAsync(AoiMachine, "MODEL-A", default);

        Assert.Equal(3, diff.LocalVersion);
        Assert.Equal(5, diff.EcosystemVersion);
        Assert.Equal(2, diff.VersionDelta);
        Assert.Contains("P09", diff.AddedPointCodes);
        Assert.Contains("P08", diff.RemovedPointCodes);
        var changedP05 = Assert.Single(diff.ChangedPoints, c => c.Code == "P05");
        Assert.Contains(changedP05.Fields, f => f.Field == "lowerLimit");
        Assert.Contains(changedP05.Fields, f => f.Field == "upperLimit");
    }

    [Fact]
    public async Task Diff_on_a_recipe_machine_throws_InvalidOperationException()
    {
        var (_, _, engine) = CreateHarness();
        await Assert.ThrowsAsync<InvalidOperationException>(() => engine.DiffAsync(ScrewMachine, "MODEL-A", default));
    }

    // ─────────────────────────────────────────────────────────────────────
    // Check — drift before/after a pull.
    // ─────────────────────────────────────────────────────────────────────

    [Fact]
    public async Task Check_reports_drift_for_a_specific_product_and_in_sync_after_pull()
    {
        var (_, _, engine) = CreateHarness();

        var before = await engine.CheckAsync(AoiMachine, "MODEL-A", default);
        var driftEntry = Assert.Single(before.Products);
        Assert.Equal("drift", driftEntry.DriftState);
        Assert.Equal(3, driftEntry.LocalVersion);
        Assert.Equal(5, driftEntry.EcosystemVersion);

        await engine.PullAsync(AoiMachine, "MODEL-A", default);

        var after = await engine.CheckAsync(AoiMachine, "MODEL-A", default);
        var afterEntry = Assert.Single(after.Products);
        Assert.Equal("in_sync", afterEntry.DriftState);
    }

    // ─────────────────────────────────────────────────────────────────────
    // Governance — threshold gate blocks limit edits on non-development products.
    // ─────────────────────────────────────────────────────────────────────

    [Fact]
    public async Task Push_limit_change_on_active_product_is_blocked_but_other_fields_apply()
    {
        var (local, ecosystem, engine) = CreateHarness();

        var p01 = local.GetAllPoints("MODEL-A").First(p => p.Code == "P01");
        p01.LowerLimit = 0.40; // was 0.35 — a real limit change
        p01.Name = "C1 Height (rev)"; // a non-limit change on the SAME point
        local.UpsertPoint("MODEL-A", p01);

        var result = await engine.PushAsync(AoiMachine, "MODEL-A", confirm: true, default);

        var outcome = Assert.Single(result.Points, p => p.Code == "P01");
        Assert.True(outcome.LimitBlocked);
        Assert.True(result.LimitChangesBlocked);

        var ecoProduct = await ecosystem.GetPointsAsync("MODEL-A", null, default);
        var ecoP01 = ecoProduct!.Points.First(p => p.Code == "P01");
        Assert.Equal(0.35, ecoP01.LowerLimit); // unchanged — governed
        Assert.Equal("C1 Height (rev)", ecoP01.Name); // still applied
    }

    [Fact]
    public async Task Push_limit_change_on_development_product_applies()
    {
        var (local, ecosystem, engine) = CreateHarness();

        var q01 = local.GetAllPoints("MODEL-B").First(p => p.Code == "Q01");
        q01.LowerLimit = 2.00; // was 1.95
        local.UpsertPoint("MODEL-B", q01);

        var result = await engine.PushAsync(AoiMachine, "MODEL-B", confirm: true, default);

        var outcome = Assert.Single(result.Points, p => p.Code == "Q01");
        Assert.False(outcome.LimitBlocked);
        Assert.False(result.LimitChangesBlocked);

        var ecoProduct = await ecosystem.GetPointsAsync("MODEL-B", null, default);
        var ecoQ01 = ecoProduct!.Points.First(p => p.Code == "Q01");
        Assert.Equal(2.00, ecoQ01.LowerLimit);
    }

    // ─────────────────────────────────────────────────────────────────────
    // Optimistic lock — opt-in via expectedUpdatedAt.
    // ─────────────────────────────────────────────────────────────────────

    [Fact]
    public async Task PushPoints_stale_expectedUpdatedAt_conflicts_and_does_not_overwrite_fresh_token_applies()
    {
        var (_, ecosystem, engine) = CreateHarness();

        var ecoBefore = await ecosystem.GetPointsAsync("MODEL-A", null, default);
        var p01 = ecoBefore!.Points.First(p => p.Code == "P01");
        var realToken = p01.LastModifiedAt!.Value;
        var staleToken = realToken.AddSeconds(-30);

        SyncPointDto BuildDto(string name, DateTimeOffset? token) => new(
            "P01", name, null, "DIMENSION", p01.Unit,
            null, null, null, // no limit fields touched — isolates lock behavior from governance
            p01.PositionX, p01.PositionY, p01.Radius,
            p01.NormalizedX, p01.NormalizedY, p01.NormalizedRadius,
            p01.CropWidth, p01.CropHeight, p01.OrderIndex, null, true,
            null, null, null, "circle", null, token);

        var staleResult = await engine.PushPointsAsync(
            AoiMachine, "MODEL-A", new[] { BuildDto("C1 Height (stale attempt)", staleToken) }, confirm: true, default);
        var staleOutcome = Assert.Single(staleResult.Points);
        Assert.Equal("conflict", staleOutcome.Status);
        Assert.Equal(1, staleResult.StaleConflicts);

        var afterStale = await ecosystem.GetPointsAsync("MODEL-A", null, default);
        Assert.Equal("C1 Height", afterStale!.Points.First(p => p.Code == "P01").Name); // untouched

        var freshResult = await engine.PushPointsAsync(
            AoiMachine, "MODEL-A", new[] { BuildDto("C1 Height (verified)", realToken) }, confirm: true, default);
        var freshOutcome = Assert.Single(freshResult.Points);
        Assert.Equal("updated", freshOutcome.Status);

        var afterFresh = await ecosystem.GetPointsAsync("MODEL-A", null, default);
        Assert.Equal("C1 Height (verified)", afterFresh!.Points.First(p => p.Code == "P01").Name);
    }

    // ─────────────────────────────────────────────────────────────────────
    // Delta sync / tombstones.
    // ─────────────────────────────────────────────────────────────────────

    [Fact]
    public async Task DeltaSync_returns_tombstone_for_a_point_deleted_since_the_given_version()
    {
        var ecosystem = new SimulatedEcosystem(TempDir());

        var noChange = await ecosystem.DeltaSyncPointsAsync("MODEL-A", sinceVersion: 5, default);
        Assert.False(noChange.HasChanges);

        var delta = await ecosystem.DeltaSyncPointsAsync("MODEL-A", sinceVersion: 3, default);
        Assert.True(delta.HasChanges);
        Assert.Contains("P08", delta.DeletedCodes);
        Assert.Contains(delta.DeletedPoints, d => d.Code == "P08" && d.DeletedAtVersion == 5);
        Assert.Contains(delta.Points, p => p.Code == "P09");
        Assert.DoesNotContain(delta.Points, p => p.Code == "P08"); // tombstoned points aren't in the active list
    }

    // ─────────────────────────────────────────────────────────────────────
    // Recipe (System A) check/pull.
    // ─────────────────────────────────────────────────────────────────────

    [Fact]
    public async Task Recipe_check_and_pull_work_for_an_automation_machine()
    {
        var (local, _, engine) = CreateHarness();

        var localBefore = local.GetRecipe("SCREWDRIVE-M4")!;
        Assert.Equal(2, localBefore.Version);

        var check = await engine.CheckAsync(ScrewMachine, null, default);
        Assert.Equal("recipe", check.ConfigKind);
        Assert.NotNull(check.Recipe);
        Assert.Equal("SCREWDRIVE-M4", check.Recipe!.Code);
        Assert.Equal("drift", check.Recipe.DriftState);
        Assert.Equal("machineType", check.Recipe.ResolvedBy);

        var pull = await engine.PullAsync(ScrewMachine, null, default);
        Assert.True(pull.Applied);
        Assert.Equal("recipe", pull.ConfigKind);
        Assert.Equal(3, pull.ToVersion);

        var localAfter = local.GetRecipe("SCREWDRIVE-M4")!;
        Assert.Equal(3, localAfter.Version);
    }

    [Fact]
    public async Task Recipe_check_for_a_machine_type_with_no_matching_recipe_returns_none_gracefully()
    {
        var (_, _, engine) = CreateHarness();

        var check = await engine.CheckAsync(IotMachine, null, default);
        Assert.Equal("recipe", check.ConfigKind);
        Assert.Null(check.Recipe);

        var pull = await engine.PullAsync(IotMachine, null, default);
        Assert.False(pull.Applied);
    }

    // ─────────────────────────────────────────────────────────────────────
    // History.
    // ─────────────────────────────────────────────────────────────────────

    [Fact]
    public async Task History_records_pull_and_push_operations_most_recent_first()
    {
        var (_, _, engine) = CreateHarness();

        await engine.PullAsync(AoiMachine, "MODEL-A", default);
        await engine.PushAsync(AoiMachine, "MODEL-A", confirm: true, default);

        var history = engine.History("AOI-01");
        Assert.Equal(2, history.Count);
        Assert.Equal("push", history[0].Op);
        Assert.Equal("pull", history[1].Op);
        Assert.True(history[0].Seq > history[1].Seq);
    }

    [Fact]
    public void History_for_a_machine_with_no_activity_is_empty()
    {
        var (_, _, engine) = CreateHarness();
        Assert.Empty(engine.History("NEVER-SYNCED"));
    }
}
