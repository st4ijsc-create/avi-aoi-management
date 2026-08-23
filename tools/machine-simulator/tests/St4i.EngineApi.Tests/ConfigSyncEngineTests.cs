using St4i.EdgeCore.Config;
using St4i.EdgeCore.Models;
using St4i.Connector.Abstractions.Models;
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
        "AOI-01", "SN-AOI01", DeviceClass.AoiAvi, "AOI", "inspection", DriverKinds.Simulated, "RC-AOI-A", null, 1.8);

    private static readonly MachineDescriptor ScrewMachine = new(
        "SCRW-01", "SN-SCRW01", DeviceClass.Automation, "SCREWDRIVE", "screw_tightening", DriverKinds.Simulated, "RC-SCRW-A", null, 0.8);

    private static readonly MachineDescriptor IotMachine = new(
        "IOT-01", "SN-IOT01", DeviceClass.Iot, "IOT_SENSOR", "telemetry", DriverKinds.Simulated, null, null, 0.4);

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
    // Task review #2 — a re-push of byte-identical content (e.g. pull, then immediately push everything
    // straight back with no edits) doesn't inflate the ecosystem version or count as an "update".
    // ─────────────────────────────────────────────────────────────────────

    [Fact]
    public async Task Push_of_byte_identical_content_after_a_pull_does_not_bump_version_or_count_as_updated()
    {
        var (_, ecosystem, engine) = CreateHarness();

        await engine.PullAsync(AoiMachine, "MODEL-A", default); // local is now byte-identical to the ecosystem
        var beforeVersion = (await ecosystem.CheckPointsVersionAsync("MODEL-A", default)).Single().PointsConfigVersion;
        var historyCountBefore = engine.History("AOI-01").Count;

        var result = await engine.PushAsync(AoiMachine, "MODEL-A", confirm: true, default);

        Assert.True(result.Success);
        Assert.Equal(0, result.PointsCreated);
        Assert.Equal(0, result.PointsUpdated); // every point content-matched what was already stored
        Assert.Equal(result.PreviousVersion, result.NewVersion); // no version bump on a genuine no-op

        var afterVersion = (await ecosystem.CheckPointsVersionAsync("MODEL-A", default)).Single().PointsConfigVersion;
        Assert.Equal(beforeVersion, afterVersion);

        // A push attempt is still worth an audit trail entry (see PushPointsAsync's own remarks) — just
        // a TRUTHFUL one (0 created, 0 updated, unchanged version), never a misleading "vN->vN+1" row.
        var history = engine.History("AOI-01");
        Assert.Equal(historyCountBefore + 1, history.Count);
        Assert.Equal(history[0].FromVersion, history[0].ToVersion);
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
    // Task review #1 (Important) — full-spec diff: a point differing ONLY in a field the OLD ~13-field
    // hand-written DiffFields list never compared (3D/solder, tolerance) must show up as "changed" here,
    // in agreement with the checksum-based drift badge (CheckAsync) — never "up to date" in one and
    // "drift" in the other.
    // ─────────────────────────────────────────────────────────────────────

    [Fact]
    public async Task Diff_reports_a_solder_field_change_the_old_field_list_missed_and_agrees_with_drift_state()
    {
        var (local, _, engine) = CreateHarness();

        // Sync local to the ecosystem first so the ONLY subsequent difference is the one THIS test
        // introduces — isolates the review #1 fix from the harness's own seeded P05/P08/P09 divergence.
        await engine.PullAsync(AoiMachine, "MODEL-A", default);
        var inSync = await engine.CheckAsync(AoiMachine, "MODEL-A", default);
        Assert.Equal("in_sync", Assert.Single(inSync.Products).DriftState);

        // P02 ("Solder Joint J3 Volume") carries the 3D/solder fields the pre-fix DiffFields never
        // compared at all — change ONLY voidPctMax, nothing else.
        var p02 = local.GetAllPoints("MODEL-A").First(p => p.Code == "P02");
        Assert.Equal(25.0, p02.VoidPctMax);
        p02.VoidPctMax = 40.0;
        local.UpsertPoint("MODEL-A", p02);

        // The checksum-based drift badge (hashes the WHOLE point) already correctly says "drift".
        var check = await engine.CheckAsync(AoiMachine, "MODEL-A", default);
        Assert.Equal("drift", Assert.Single(check.Products).DriftState);

        // The diff must AGREE — pre-fix, this would have shown zero changed points ("up to date") while
        // the badge above said "drift": a direct contradiction. Post-fix it reports the exact field.
        var diff = await engine.DiffAsync(AoiMachine, "MODEL-A", default);
        var changedP02 = Assert.Single(diff.ChangedPoints, c => c.Code == "P02");
        var voidField = Assert.Single(changedP02.Fields, f => f.Field == "voidPctMax");
        Assert.NotEqual(voidField.LocalValue, voidField.EcosystemValue);
    }

    [Fact]
    public async Task Diff_reports_a_toleranceMode_only_change_the_old_field_list_missed()
    {
        var (local, _, engine) = CreateHarness();

        await engine.PullAsync(AoiMachine, "MODEL-A", default);

        // P01 ("C1 Height") seeds with ToleranceMode.Range and is untouched by the ecosystem's own seed
        // divergence — flip ONLY its toleranceMode locally.
        var p01 = local.GetAllPoints("MODEL-A").First(p => p.Code == "P01");
        Assert.Equal(ToleranceMode.Range, p01.ToleranceMode);
        p01.ToleranceMode = ToleranceMode.Bilateral;
        local.UpsertPoint("MODEL-A", p01);

        Assert.Equal("drift", Assert.Single((await engine.CheckAsync(AoiMachine, "MODEL-A", default)).Products).DriftState);

        var diff = await engine.DiffAsync(AoiMachine, "MODEL-A", default);
        var changedP01 = Assert.Single(diff.ChangedPoints, c => c.Code == "P01");
        Assert.Contains(changedP01.Fields, f => f.Field == "toleranceMode");
    }

    // ─────────────────────────────────────────────────────────────────────
    // Task review #3 (Minor) — a point present locally but entirely ABSENT from the ecosystem (never
    // pushed, never tombstoned there) must still be reported "removed": a pull's wholesale
    // UpsertProduct(ecoProduct) replace drops it locally regardless, so the diff undercounted before.
    // ─────────────────────────────────────────────────────────────────────

    [Fact]
    public async Task Diff_reports_a_local_only_point_absent_from_the_ecosystem_as_removed()
    {
        var (local, _, engine) = CreateHarness();

        local.UpsertPoint("MODEL-A", new MeasurementPoint
        {
            Code = "LOCAL-ONLY", Name = "Local-only point", MeasurementType = MeasurementType.Visual,
            PositionX = 1, PositionY = 1, OrderIndex = 99, IsActive = true,
        });

        var diff = await engine.DiffAsync(AoiMachine, "MODEL-A", default);

        Assert.Contains("LOCAL-ONLY", diff.RemovedPointCodes);
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
    // Checksum-first drift (Task C8) — fixes the real bug a pure version comparison had: two
    // independently-bumped versions that land on the SAME number but carry DIFFERENT content used to
    // read "in_sync"; conversely, byte-identical content should read "in_sync" even under a different
    // version LABEL (checksum is authoritative whenever both sides have one — mirrors the server's own
    // computeDriftState).
    // ─────────────────────────────────────────────────────────────────────

    [Fact]
    public async Task Check_reports_drift_when_versions_coincide_but_content_differs()
    {
        var (local, _, engine) = CreateHarness();

        // MODEL-B: local seed starts at v1, the ecosystem's own seed divergence is already at v2
        // (Q03's upperLimit tweaked — see SimulatedEcosystem.DivergeModelB). Editing a DIFFERENT local
        // point (Q01) bumps the LOCAL version 1 -> 2 too, so both sides land on version 2 — but the
        // actual content genuinely differs (local has an edited Q01 the ecosystem never saw; the
        // ecosystem has an edited Q03 the local copy never saw).
        var q01 = local.GetAllPoints("MODEL-B").First(p => p.Code == "Q01");
        q01.Name = "J1 Pin Pitch (local edit)";
        local.UpsertPoint("MODEL-B", q01);
        var localAfterEdit = local.GetProduct("MODEL-B")!;
        Assert.Equal(2, localAfterEdit.PointsConfigVersion);

        var check = await engine.CheckAsync(AoiMachine, "MODEL-B", default);
        var entry = Assert.Single(check.Products);

        Assert.Equal(2, entry.LocalVersion);
        Assert.Equal(2, entry.EcosystemVersion); // SAME version number on both sides...
        Assert.NotNull(entry.LocalChecksum);
        Assert.NotNull(entry.EcosystemChecksum);
        Assert.NotEqual(entry.LocalChecksum, entry.EcosystemChecksum); // ...but genuinely different content.
        Assert.Equal("drift", entry.DriftState); // a pure version comparison would have said "in_sync" here.
    }

    [Fact]
    public async Task Check_reports_in_sync_when_content_is_identical_even_under_a_different_version_label()
    {
        var (local, _, engine) = CreateHarness();

        // Pull MODEL-A so the local copy is a byte-identical clone of the ecosystem's (content AND
        // version, v5).
        await engine.PullAsync(AoiMachine, "MODEL-A", default);
        var pulled = local.GetProduct("MODEL-A")!;
        Assert.Equal(5, pulled.PointsConfigVersion);

        // Now relabel ONLY the local version number (UpsertProduct is a whole-aggregate replace that
        // deliberately leaves versioning to the caller — see its own doc comment) — the points
        // themselves are untouched, so content is still byte-identical to the ecosystem's.
        pulled.PointsConfigVersion = 999;
        local.UpsertProduct(pulled);

        var check = await engine.CheckAsync(AoiMachine, "MODEL-A", default);
        var entry = Assert.Single(check.Products);

        Assert.Equal(999, entry.LocalVersion);
        Assert.Equal(5, entry.EcosystemVersion); // version labels genuinely differ...
        Assert.NotNull(entry.LocalChecksum);
        Assert.Equal(entry.LocalChecksum, entry.EcosystemChecksum); // ...but content is identical.
        Assert.Equal("in_sync", entry.DriftState); // checksum wins over the mismatched version label.
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
    // Task review #4 — the wire-level configKind ConfigSyncEngine resolves from DeviceClass (recipe for
    // Automation, device_settings for IoT — CONFIG_SYNC_SERVER_CONTRACT.md's own "Recipe ↔ Automation
    // machines. device_settings ↔ IoT."), and the best-effort drift-shadow ack fired after a successful
    // recipe pull. RecordingConfigSyncBackend wraps a real SimulatedEcosystem so behavior stays correct
    // while recording what the engine actually sent.
    // ─────────────────────────────────────────────────────────────────────

    [Fact]
    public async Task Recipe_pull_for_an_Automation_machine_uses_recipe_configKind_and_acks_after_a_successful_pull()
    {
        var local = new ProductConfigStore(TempDir());
        var recording = new RecordingConfigSyncBackend(new SimulatedEcosystem(TempDir()));
        var engine = new ConfigSyncEngine(local, recording);

        var result = await engine.PullAsync(ScrewMachine, null, default);

        Assert.True(result.Applied);
        Assert.Equal(new[] { "recipe" }, recording.CheckRecipeConfigKinds);
        Assert.Equal(new[] { "recipe" }, recording.GetRecipeConfigKinds);
        var ack = Assert.Single(recording.Acks);
        Assert.Equal("recipe", ack.ConfigKind);
        Assert.Equal("SCREWDRIVE-M4", ack.Code);
        Assert.Equal(3, ack.Version); // pulled recipe's version, per SimulatedEcosystem's own seed divergence
    }

    [Fact]
    public async Task Recipe_check_for_an_IoT_machine_uses_device_settings_configKind()
    {
        var local = new ProductConfigStore(TempDir());
        var recording = new RecordingConfigSyncBackend(new SimulatedEcosystem(TempDir()));
        var engine = new ConfigSyncEngine(local, recording);

        await engine.CheckAsync(IotMachine, null, default);

        Assert.Equal(new[] { "device_settings" }, recording.CheckRecipeConfigKinds);
    }

    [Fact]
    public async Task Recipe_pull_with_no_matching_recipe_never_calls_Ack()
    {
        var local = new ProductConfigStore(TempDir());
        var recording = new RecordingConfigSyncBackend(new SimulatedEcosystem(TempDir()));
        var engine = new ConfigSyncEngine(local, recording);

        var pull = await engine.PullAsync(IotMachine, null, default); // no device_settings recipe seeded for IOT_SENSOR

        Assert.False(pull.Applied);
        Assert.Empty(recording.Acks);
    }

    /// <summary>Thin decorator over a real <see cref="SimulatedEcosystem"/> — delegates every call so
    /// behavior is genuinely correct (no hand-rolled fake logic to drift from the real thing), but
    /// records the <c>configKind</c> <see cref="ConfigSyncEngine"/> actually passed to
    /// <see cref="CheckRecipeAsync"/>/<see cref="GetRecipeAsync"/> and every <see cref="AckAsync"/> call,
    /// so tests can assert on DeviceClass -> configKind resolution and the post-pull ack wiring without
    /// needing a real Live server.</summary>
    private sealed class RecordingConfigSyncBackend : IConfigSyncBackend
    {
        private readonly SimulatedEcosystem _inner;

        public RecordingConfigSyncBackend(SimulatedEcosystem inner) => _inner = inner;

        public List<string> CheckRecipeConfigKinds { get; } = new();
        public List<string> GetRecipeConfigKinds { get; } = new();
        public List<(string ConfigKind, string? Code, int? Version, string? Checksum)> Acks { get; } = new();

        /// <summary>🔴 Task BN-1 — every <see cref="SyncPointsRequestDto"/> the engine actually built, so
        /// a test can read the exact token <c>ConfigSyncEngine.ToWireDto</c> put on the wire without
        /// needing a Live server or an HTTP handler.</summary>
        public List<SyncPointsRequestDto> SyncPointsRequests { get; } = new();

        public string Name => _inner.Name;

        /// <summary>🔴 Task BN-1 — SETTABLE, and that is the point: the decorator wraps a real
        /// <see cref="SimulatedEcosystem"/> (which genuinely carries a lifecycle, hence the
        /// <see langword="true"/> default), and flipping this to <see langword="false"/> reproduces
        /// exactly what <c>LiveConfigSyncBackend</c> answers while every other behaviour stays real.
        /// That is what lets both banks of the item-57 leg-2 fix be witnessed against one backend.</summary>
        public bool PullCarriesLifecycleStatus { get; set; } = true;

        public Task<IReadOnlyList<ProductVersionDto>> CheckPointsVersionAsync(string? productModelCode, CancellationToken ct) =>
            _inner.CheckPointsVersionAsync(productModelCode, ct);

        public Task<ProductModel?> GetPointsAsync(string productModelCode, string? variantCode, CancellationToken ct) =>
            _inner.GetPointsAsync(productModelCode, variantCode, ct);

        public Task<PointsDeltaResultDto> DeltaSyncPointsAsync(string productModelCode, int sinceVersion, CancellationToken ct) =>
            _inner.DeltaSyncPointsAsync(productModelCode, sinceVersion, ct);

        public Task<SyncPointsResultDto> SyncPointsAsync(string productModelCode, SyncPointsRequestDto request, CancellationToken ct)
        {
            SyncPointsRequests.Add(request);
            return _inner.SyncPointsAsync(productModelCode, request, ct);
        }

        public Task<(bool Found, string? ImageUrl)> GetProductImageAsync(string productModelCode, CancellationToken ct) =>
            _inner.GetProductImageAsync(productModelCode, ct);

        public Task<bool> SyncProductImageAsync(string productModelCode, string? imageBase64, string? imageUrl, string? imageMimeType, CancellationToken ct) =>
            _inner.SyncProductImageAsync(productModelCode, imageBase64, imageUrl, imageMimeType, ct);

        public Task<(bool Found, string? ImageUrl)> GetPointImageAsync(string productModelCode, string pointCode, CancellationToken ct) =>
            _inner.GetPointImageAsync(productModelCode, pointCode, ct);

        public Task<bool> SyncPointImageAsync(string productModelCode, string pointCode, string? imageBase64, string? imageUrl, CancellationToken ct) =>
            _inner.SyncPointImageAsync(productModelCode, pointCode, imageBase64, imageUrl, ct);

        public Task<RecipeCheckResultDto> CheckRecipeAsync(string? code, string? machineType, string configKind, CancellationToken ct)
        {
            CheckRecipeConfigKinds.Add(configKind);
            return _inner.CheckRecipeAsync(code, machineType, configKind, ct);
        }

        public Task<Recipe?> GetRecipeAsync(string code, string configKind, CancellationToken ct)
        {
            GetRecipeConfigKinds.Add(configKind);
            return _inner.GetRecipeAsync(code, configKind, ct);
        }

        public Task<AckResultDto> AckAsync(string configKind, string? code, int? version, string? checksum, CancellationToken ct)
        {
            Acks.Add((configKind, code, version, checksum));
            return _inner.AckAsync(configKind, code, version, checksum, ct);
        }

        public Task<MachineSettingsReportResultDto> ReportSettingsAsync(MachineSettingsReportRequestDto request, CancellationToken ct) =>
            _inner.ReportSettingsAsync(request, ct);
    }

    // ─────────────────────────────────────────────────────────────────────
    // 🔴 Task BN-1, 2026-08-24 — docs/owner-decisions.md item 57, legs 1 and 2, under the owner's
    // ruling of 2026-08-23.
    //
    // WHAT THESE MEASURE AND WHAT THEY DO NOT. The theory below is a measurement against the PUBLISHED
    // contract vocabulary (CONFIG_SYNC_SERVER_CONTRACT.md's
    // DIMENSION|VISUAL|ELECTRICAL|POSITION|COLOR|SURFACE|OTHER), written out as literals rather than
    // re-derived from the converter — a check that asked the converter what the converter says would be
    // an identity, not a measurement, and would have agreed with the hand-spelling it replaced too.
    // It is deliberately GREEN both before and after leg 1's edit: seven of seven tokens were measured
    // byte-identical BEFORE the change, which is the precondition the owner attached to making it, so a
    // red here would have meant the wire moved. Its standing job is the regression: it goes red if the
    // hand-spelling comes back, and red if a member's token ever stops matching the server's vocabulary.
    // ─────────────────────────────────────────────────────────────────────

    [Theory]
    [InlineData(MeasurementType.Dimension, "DIMENSION")]
    [InlineData(MeasurementType.Visual, "VISUAL")]
    [InlineData(MeasurementType.Electrical, "ELECTRICAL")]
    [InlineData(MeasurementType.Position, "POSITION")]
    [InlineData(MeasurementType.Color, "COLOR")]
    [InlineData(MeasurementType.Surface, "SURFACE")]
    [InlineData(MeasurementType.Other, "OTHER")]
    public async Task Push_spells_every_MeasurementType_member_with_the_published_contract_token(
        MeasurementType member, string expectedToken)
    {
        var local = new ProductConfigStore(TempDir());
        var recording = new RecordingConfigSyncBackend(new SimulatedEcosystem(TempDir()));
        var engine = new ConfigSyncEngine(local, recording);

        local.UpsertPoint("MODEL-A", new MeasurementPoint
        {
            Code = "P-TOKEN", Name = "Token witness", MeasurementType = member,
            PositionX = 100, PositionY = 100, OrderIndex = 99, IsActive = true,
        });

        await engine.PushAsync(AoiMachine, "MODEL-A", confirm: true, default);

        var request = Assert.Single(recording.SyncPointsRequests);
        var pushed = Assert.Single(request.Points, p => p.Code == "P-TOKEN");
        Assert.Equal(expectedToken, pushed.MeasurementType);
    }

    /// <summary>Non-vacuity floor for the theory above: it enumerates the member list by hand, so a
    /// member added without a row would be pushed by untested code. Listed, then counted.</summary>
    [Fact]
    public void Every_MeasurementType_member_has_a_row_in_the_push_token_theory()
    {
        string[] covered =
            ["Dimension", "Visual", "Electrical", "Position", "Color", "Surface", "Other"];

        var declared = Enum.GetNames<MeasurementType>();

        Assert.Equal(covered.OrderBy(n => n, StringComparer.Ordinal), declared.OrderBy(n => n, StringComparer.Ordinal));
        Assert.Equal(7, declared.Length);
    }

    /// <summary>🔴 The two answers, named rather than assumed. This is the whole of leg 2's premise:
    /// one backend carries the field and one does not, and the engine's behaviour forks on exactly
    /// that.</summary>
    [Fact]
    public void The_two_backends_disagree_about_carrying_LifecycleStatus_and_that_is_the_premise()
    {
        using var live = LiveConfigSyncBackend.ForMachine("http://synapse.local", "mk_test", "AOI-01", verifyTls: true);

        Assert.True(new SimulatedEcosystem(TempDir()).PullCarriesLifecycleStatus);
        Assert.False(live.PullCarriesLifecycleStatus);
    }

    /// <summary>🔴 Any lifecycle member that is NOT <paramref name="other"/>, derived rather than picked.
    /// The first draft of the two tests below hard-coded <c>Active</c> as "the value the ecosystem is
    /// not", and the ecosystem's own MODEL-A seed IS <c>Active</c> — so both would have compared a value
    /// against itself and passed while measuring nothing. The non-vacuity guard caught it; the guard is
    /// now unnecessary because the value cannot collide by construction.</summary>
    private static ProductLifecycleStatus DifferentFrom(ProductLifecycleStatus other) =>
        Enum.GetValues<ProductLifecycleStatus>().First(v => v != other);

    /// <summary>Bank one — a backend whose get-points carries no lifecycleStatus must not have its
    /// C# default written over the machine's value by <c>PullAsync</c>'s wholesale UpsertProduct.</summary>
    [Fact]
    public async Task Pull_from_a_backend_that_carries_no_LifecycleStatus_keeps_the_machines_own()
    {
        var local = new ProductConfigStore(TempDir());
        var ecosystem = new SimulatedEcosystem(TempDir());
        var recording = new RecordingConfigSyncBackend(ecosystem) { PullCarriesLifecycleStatus = false };
        var engine = new ConfigSyncEngine(local, recording);

        var ecoLifecycle = (await ecosystem.GetPointsAsync("MODEL-A", null, default))!.LifecycleStatus;
        var machineLifecycle = DifferentFrom(ecoLifecycle);

        var product = local.GetProduct("MODEL-A")!;
        product.LifecycleStatus = machineLifecycle;
        local.UpsertProduct(product);

        await engine.PullAsync(AoiMachine, "MODEL-A", default);

        Assert.Equal(machineLifecycle, local.GetProduct("MODEL-A")!.LifecycleStatus);
    }

    /// <summary>🔴 Bank two, and it is the one a narrow fix would have broken silently: when the value
    /// really did arrive, the ecosystem is still the authority and the pull still overwrites. A blanket
    /// "always keep the local one" would pass the test above and fail here.</summary>
    [Fact]
    public async Task Pull_from_a_backend_that_does_carry_LifecycleStatus_still_applies_the_ecosystems()
    {
        var local = new ProductConfigStore(TempDir());
        var ecosystem = new SimulatedEcosystem(TempDir());
        var engine = new ConfigSyncEngine(local, ecosystem);

        var ecoLifecycle = (await ecosystem.GetPointsAsync("MODEL-A", null, default))!.LifecycleStatus;

        var product = local.GetProduct("MODEL-A")!;
        product.LifecycleStatus = DifferentFrom(ecoLifecycle);
        local.UpsertProduct(product);

        await engine.PullAsync(AoiMachine, "MODEL-A", default);

        Assert.Equal(ecoLifecycle, local.GetProduct("MODEL-A")!.LifecycleStatus);
    }

    /// <summary>The boundary the fix has to get right in the other direction: a product this machine has
    /// never held has no value to KEEP, so the pull stores whatever the aggregate carried and "keep the
    /// local one" must not become "refuse to store anything".
    ///
    /// <para>🔴 What this asserts and what it deliberately does not. Against a REAL
    /// <c>LiveConfigSyncBackend</c> the aggregate's lifecycle is <c>Development</c>, because nothing
    /// arrives to map. This test drives a decorator that ANSWERS like Live while wrapping a real
    /// <c>SimulatedEcosystem</c> that genuinely holds one, so the honest assertion here is "the stored
    /// value is the one the backend handed over", not the literal <c>Development</c> — writing the
    /// literal would have been asserting a fact about the fake rather than about the fix, and it is how
    /// the first draft of this test failed.</para></summary>
    [Fact]
    public async Task Pull_of_a_product_the_machine_has_never_seen_stores_what_the_backend_handed_over()
    {
        var local = new ProductConfigStore(TempDir());
        var ecosystem = new SimulatedEcosystem(TempDir());
        var recording = new RecordingConfigSyncBackend(ecosystem) { PullCarriesLifecycleStatus = false };
        var engine = new ConfigSyncEngine(local, recording);

        var ecoLifecycle = (await ecosystem.GetPointsAsync("MODEL-A", null, default))!.LifecycleStatus;

        local.DeleteProduct("MODEL-A");
        Assert.Null(local.GetProduct("MODEL-A"));

        await engine.PullAsync(AoiMachine, "MODEL-A", default);

        var stored = local.GetProduct("MODEL-A");
        Assert.NotNull(stored);
        Assert.Equal(ecoLifecycle, stored!.LifecycleStatus);
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
