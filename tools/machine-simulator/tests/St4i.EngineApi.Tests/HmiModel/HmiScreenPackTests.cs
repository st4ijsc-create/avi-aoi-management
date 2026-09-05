using System.Text.Json;
using Microsoft.Data.Sqlite;
using St4i.EngineApi.HmiModel;
using St4i.EngineApi.Tests.Auth;
using St4i.Hmi.Contracts;
using Xunit;

namespace St4i.EngineApi.Tests.HmiModel;

/// <summary>
/// Session 4 (HMI-5) — the screen pack: export, import, and the APPEND-ONLY boundary.
///
/// <para><b>What this class does NOT measure:</b> (1) HTTP status codes, route tiers and audit rows —
/// those are <c>HmiScreenPackEndpointsTests</c> below, against the real pipeline; (2) that
/// <see cref="HmiScreenStore"/> itself appends rather than overwrites — that is
/// <see cref="HmiScreenStoreTests"/>, and this class deliberately does not restate it. What this class
/// measures is that the PACK SERVICE, sitting on top of that store, cannot turn an append into anything
/// else.</para>
///
/// <para>🔴 <b>EVERY PROPERTY HERE IS FALSIFIED, AND EVERY PROPERTY THAT COULD PASS BY REFUSING
/// EVERYTHING CARRIES A NEGATIVE CONTROL.</b> The append-only guarantee is the sharpest case and is worth
/// naming: a test that only checks "the old versions are still there" would pass for an import that did
/// nothing at all, so <see cref="Import_over_an_existing_screen_actually_appends_a_new_version"/> sits
/// directly beside <see cref="Import_over_an_existing_screen_leaves_every_prior_version_byte_identical"/>
/// and asserts the version count GREW and the new head IS the imported document. Neither test alone is
/// sufficient; the pair is, and both must be read together.</para>
///
/// <para><b>Isolation.</b> Same pattern and same <c>[Collection]</c> reasoning as
/// <see cref="HmiScreenStoreTests"/> — see that class's own doc comment for why the process-wide SQLite
/// pool makes the collection tag necessary rather than decorative.</para>
/// </summary>
[Collection(SecurityEnvVarTests.CollectionName)]
public class HmiScreenPackTests : IDisposable
{
    readonly string _dir = Path.Combine(Path.GetTempPath(), "st4i-hmi-pack-" + Guid.NewGuid().ToString("N"));

    void IDisposable.Dispose() { try { Directory.Delete(_dir, true); } catch { } }

    HmiScreenStore NewRawStore() => new(_dir);

    /// <summary>The service under test, over the CANONICALIZING decorator — the only thing DI ever hands
    /// out (<c>Program.cs</c>, and <c>CanonicalScreenStore.cs</c>'s own doc comment for the law). Testing
    /// over the raw store would measure a composition that cannot occur in the running engine.</summary>
    static HmiScreenPackService ServiceOver(HmiScreenStore raw) =>
        new(new CanonicalizingHmiScreenStore(raw));

    // ═════════════════════════════════════════════════════════════════════
    // EXPORT
    // ═════════════════════════════════════════════════════════════════════

    [Fact]
    public async Task Export_carries_which_screens_at_which_versions_from_where_and_when()
    {
        // The brief's four facts, each asserted as a distinct claim rather than as "the pack is non-empty".
        var raw = NewRawStore();
        var store = new CanonicalizingHmiScreenStore(raw);
        await store.PutAsync(Screen("line-overview", "v1"));
        await store.PutAsync(Screen("line-overview", "v2"));
        await store.PutAsync(Screen("oven-detail", "only"));

        var before = DateTimeOffset.UtcNow.AddSeconds(-1);
        var pack = await ServiceOver(raw).ExportAsync("device-fingerprint-abc");

        Assert.Equal(ScreenPackDocument.CurrentPackVersion, pack.PackVersion);
        // WHERE.
        Assert.Equal("device-fingerprint-abc", pack.ExportedFrom);
        // WHEN — a real instant, parseable and recent, not a placeholder string.
        Assert.True(DateTimeOffset.TryParse(pack.ExportedAtUtc, out var stamp), pack.ExportedAtUtc);
        Assert.True(stamp >= before, $"{stamp:O} should be at or after {before:O}");
        // WHICH SCREENS.
        Assert.Equal(new[] { "line-overview", "oven-detail" }, pack.Screens.Select(s => s.ScreenId).ToArray());
        // AT WHICH VERSIONS — the CURRENT version of each, so line-overview is 2 and not 1.
        Assert.Equal(2, pack.Screens.Single(s => s.ScreenId == "line-overview").Version);
        Assert.Equal(1, pack.Screens.Single(s => s.ScreenId == "oven-detail").Version);
        // And the content is the CURRENT document, not the first one.
        Assert.Equal("v2", pack.Screens.Single(s => s.ScreenId == "line-overview").Document.Title);
    }

    /// <summary>FALSIFICATION of "an export names only what was asked for": the selective export must
    /// EXCLUDE a screen the caller did not name. Without this, <c>ExportAsync</c> ignoring its argument
    /// and always exporting everything would pass every other export test in this class.</summary>
    [Fact]
    public async Task Export_of_a_named_subset_excludes_every_screen_not_named()
    {
        var raw = NewRawStore();
        var store = new CanonicalizingHmiScreenStore(raw);
        await store.PutAsync(Screen("wanted", "yes"));
        await store.PutAsync(Screen("unwanted", "no"));

        var pack = await ServiceOver(raw).ExportAsync("dev", new[] { "wanted" });

        Assert.Equal(new[] { "wanted" }, pack.Screens.Select(s => s.ScreenId).ToArray());
    }

    /// <summary>NEGATIVE CONTROL for the test directly above. An <c>ExportAsync</c> that returned an empty
    /// pack for EVERY selective call — the classic "passes by refusing everything" failure — would satisfy
    /// the exclusion assertion above and be caught only here.</summary>
    [Fact]
    public async Task Export_of_a_named_subset_still_carries_the_screen_that_was_named()
    {
        var raw = NewRawStore();
        var store = new CanonicalizingHmiScreenStore(raw);
        await store.PutAsync(Screen("wanted", "yes"));
        await store.PutAsync(Screen("unwanted", "no"));

        var pack = await ServiceOver(raw).ExportAsync("dev", new[] { "wanted" });

        var entry = Assert.Single(pack.Screens);
        Assert.Equal("wanted", entry.ScreenId);
        Assert.Equal("yes", entry.Document.Title);
        Assert.True(entry.ExportValid);
    }

    [Fact]
    public async Task Export_skips_a_named_screen_that_does_not_exist_rather_than_throwing()
    {
        var raw = NewRawStore();
        await new CanonicalizingHmiScreenStore(raw).PutAsync(Screen("real", "here"));

        var pack = await ServiceOver(raw).ExportAsync("dev", new[] { "real", "never-declared" });

        Assert.Equal(new[] { "real" }, pack.Screens.Select(s => s.ScreenId).ToArray());
    }

    /// <summary>🔴 THE DOCUMENT TODAY'S VALIDATOR WOULD REJECT — EXPORT SIDE.
    ///
    /// <para>The row is seeded the ONLY honest way: a raw SQLite INSERT past every C# write door, the
    /// technique <see cref="HmiScreenStoreTests"/> already established for reproducing a legacy row (a
    /// document accepted under a rule that has since been tightened). <c>layout.cols = 999</c> is such a
    /// document — legal before WS-HMI-2 Task 3 fix round 1 closed the <c>[1..48]</c> range, illegal
    /// today — and it is CURRENT, which is exactly the case the store's no-DELETE plus
    /// non-re-validating rollback makes reachable.</para>
    ///
    /// <para>Export must carry it (refusing would strand a live screen permanently in a store with no
    /// DELETE) AND label it honestly.</para></summary>
    [Fact]
    public async Task Export_carries_a_document_todays_validator_rejects_and_labels_it_invalid()
    {
        var raw = NewRawStore();
        var legacy = Screen("legacy-layout", "written under older rules")
            with { Layout = new ScreenLayout(999, 8, "panel") };

        // Sanity: this really is a document today's validator refuses. Without this line the test could
        // pass against a document that was valid all along, measuring nothing.
        Assert.NotEmpty(ContractInvariants.Validate(legacy));
        await SeedRawRowAsync(raw.DbPath, legacy, version: 1);

        var pack = await ServiceOver(raw).ExportAsync("dev");

        var entry = Assert.Single(pack.Screens);
        // CARRIED — not refused, not omitted, and byte-for-byte the stored document.
        Assert.Equal("legacy-layout", entry.ScreenId);
        Assert.Equal(999, entry.Document.Layout.Cols);
        // LABELLED — honestly, with every violation, not just the first.
        Assert.False(entry.ExportValid);
        Assert.NotEmpty(entry.ExportViolations);
        Assert.Equal(ContractInvariants.Validate(legacy).Count, entry.ExportViolations.Count);
    }

    /// <summary>NEGATIVE CONTROL for the test above. A pack that stamped <c>exportValid: false</c> on
    /// EVERYTHING would pass it while measuring nothing about validity at all.</summary>
    [Fact]
    public async Task Export_labels_a_valid_document_valid_with_no_violations()
    {
        var raw = NewRawStore();
        await new CanonicalizingHmiScreenStore(raw).PutAsync(Screen("fine", "ordinary"));

        var entry = Assert.Single((await ServiceOver(raw).ExportAsync("dev")).Screens);

        Assert.True(entry.ExportValid);
        Assert.Empty(entry.ExportViolations);
    }

    [Fact]
    public async Task Pack_round_trip_preserves_each_document_byte_for_byte()
    {
        // A pack WRAPS frozen documents; it must never reshape one. Serialised and read back through the
        // same options every other producer in this contract family uses.
        var raw = NewRawStore();
        var rich = Screen("rich", "with optionals") with
        {
            TitleEn = "With optionals",
            Widgets = new[]
            {
                new ScreenWidget("w1", "setpoint-input", new WidgetRect(0, 0, 2, 1),
                    Component: "oven-1",
                    Bindings: new Dictionary<string, string> { ["value"] = "{component}/temp" },
                    PolicyAction: "machine.setpoint"),
            },
        };
        await new CanonicalizingHmiScreenStore(raw).PutAsync(rich);

        var pack = await ServiceOver(raw).ExportAsync("dev");
        var json = JsonSerializer.Serialize(pack, HmiContractJson.Options);
        var reread = JsonSerializer.Deserialize<ScreenPackDocument>(json, HmiContractJson.Options)!;

        var original = JsonSerializer.Serialize(pack.Screens[0].Document, HmiContractJson.Options);
        var afterTrip = JsonSerializer.Serialize(reread.Screens[0].Document, HmiContractJson.Options);
        Assert.Equal(original, afterTrip);
        // And the inner document really is the one the store holds, not a re-encoding of a re-encoding.
        Assert.Equal(
            JsonSerializer.Serialize(rich, HmiContractJson.Options),
            afterTrip);
    }

    // ═════════════════════════════════════════════════════════════════════
    // IMPORT — THE APPEND-ONLY BOUNDARY
    // ═════════════════════════════════════════════════════════════════════

    /// <summary>🔴 THE APPEND-ONLY PIN, HALF ONE — every version that existed before the import still
    /// holds its ORIGINAL document afterwards.
    ///
    /// <para><b>This test goes red the instant any write path is introduced that mutates a stored row</b>,
    /// because the old bytes would no longer be there to read back. That is what it is for: it does not
    /// inspect the SQL, it measures the consequence an overwrite would have.</para>
    ///
    /// <para>Read together with <see cref="Import_over_an_existing_screen_actually_appends_a_new_version"/>
    /// — this half alone would pass for an import that did nothing at all.</para></summary>
    [Fact]
    public async Task Import_over_an_existing_screen_leaves_every_prior_version_byte_identical()
    {
        var raw = NewRawStore();
        var store = new CanonicalizingHmiScreenStore(raw);
        await store.PutAsync(Screen("line-overview", "original v1"));
        await store.PutAsync(Screen("line-overview", "original v2"));

        // Snapshot every pre-existing version's exact bytes BEFORE the import.
        var beforeBytes = new Dictionary<int, string>();
        foreach (var v in await store.ListVersionsAsync("line-overview"))
        {
            var doc = await store.GetAsync("line-overview", v.Version);
            beforeBytes[v.Version] = JsonSerializer.Serialize(doc, HmiContractJson.Options);
        }
        Assert.Equal(2, beforeBytes.Count);

        await ServiceOver(raw).ImportAsync(
            Pack(Entry("line-overview", Screen("line-overview", "IMPORTED"))));

        foreach (var (version, expected) in beforeBytes)
        {
            var after = await store.GetAsync("line-overview", version);
            Assert.NotNull(after);
            Assert.Equal(expected, JsonSerializer.Serialize(after, HmiContractJson.Options));
        }
    }

    /// <summary>🔴 THE APPEND-ONLY PIN, HALF TWO — THE NEGATIVE CONTROL. An import that refused everything,
    /// or silently did nothing, would satisfy the "prior versions untouched" half above and be caught only
    /// here: the version count must GROW and the new head must BE the imported document.</summary>
    [Fact]
    public async Task Import_over_an_existing_screen_actually_appends_a_new_version()
    {
        var raw = NewRawStore();
        var store = new CanonicalizingHmiScreenStore(raw);
        await store.PutAsync(Screen("line-overview", "original v1"));
        await store.PutAsync(Screen("line-overview", "original v2"));

        var results = await ServiceOver(raw).ImportAsync(
            Pack(Entry("line-overview", Screen("line-overview", "IMPORTED"))));

        var versions = await store.ListVersionsAsync("line-overview");
        Assert.Equal(3, versions.Count);
        Assert.Equal(3, versions.Single(v => v.IsCurrent).Version);
        Assert.Equal("IMPORTED", (await store.GetAsync("line-overview"))!.Title);
        Assert.Equal(3, Assert.Single(results).Version);
    }

    /// <summary>🔴 THE ID-COLLISION DECISION, MEASURED. A colliding import is reported as
    /// <see cref="ScreenImportOutcome.AppendedAsNewVersion"/> — a DIFFERENT value from
    /// <see cref="ScreenImportOutcome.Created"/> — so an engineer cannot mistake it for a fresh create.
    /// This is how they find out, and it is asserted rather than described.</summary>
    [Fact]
    public async Task Import_reports_an_id_collision_as_appended_not_as_created()
    {
        var raw = NewRawStore();
        await new CanonicalizingHmiScreenStore(raw).PutAsync(Screen("line-overview", "already here"));

        var results = await ServiceOver(raw).ImportAsync(
            Pack(Entry("line-overview", Screen("line-overview", "from the pack"))));

        var result = Assert.Single(results);
        Assert.Equal(ScreenImportOutcome.AppendedAsNewVersion, result.Outcome);
        Assert.Equal(2, result.Version);
    }

    /// <summary>NEGATIVE CONTROL for the collision report: an import that labelled EVERYTHING
    /// <see cref="ScreenImportOutcome.AppendedAsNewVersion"/> would pass the test above while telling an
    /// engineer nothing. A screen that did not exist must be reported as
    /// <see cref="ScreenImportOutcome.Created"/>, at version 1.</summary>
    [Fact]
    public async Task Import_of_a_screen_that_does_not_exist_is_reported_as_created_at_version_one()
    {
        var raw = NewRawStore();

        var results = await ServiceOver(raw).ImportAsync(
            Pack(Entry("brand-new", Screen("brand-new", "first time"))));

        var result = Assert.Single(results);
        Assert.Equal(ScreenImportOutcome.Created, result.Outcome);
        Assert.Equal(1, result.Version);
    }

    /// <summary>A colliding import is REVERSIBLE through an operation that already exists — the argument
    /// the tier decision and the collision decision both lean on. Measured rather than asserted in prose:
    /// after an import overtakes a screen, rollback puts the previous content back, itself by appending,
    /// so nothing is lost in either direction.</summary>
    [Fact]
    public async Task An_imported_collision_is_undoable_by_rollback_which_itself_loses_nothing()
    {
        var raw = NewRawStore();
        var store = new CanonicalizingHmiScreenStore(raw);
        await store.PutAsync(Screen("line-overview", "the engineers own work"));

        await ServiceOver(raw).ImportAsync(
            Pack(Entry("line-overview", Screen("line-overview", "from the pack"))));
        Assert.Equal("from the pack", (await store.GetAsync("line-overview"))!.Title);

        var restored = await store.RollbackAsync("line-overview", 1);

        Assert.Equal(3, restored);
        Assert.Equal("the engineers own work", (await store.GetAsync("line-overview"))!.Title);
        // The import's own version is still there — the undo appended too.
        Assert.Equal("from the pack", (await store.GetAsync("line-overview", 2))!.Title);
    }

    // ═════════════════════════════════════════════════════════════════════
    // IMPORT — THE VALIDATION GATE
    // ═════════════════════════════════════════════════════════════════════

    /// <summary>🔴 THE DOCUMENT TODAY'S VALIDATOR WOULD REJECT — IMPORT SIDE. Import refuses it, and
    /// nothing is written: <c>PutAsync</c> validates before it opens a connection.</summary>
    [Fact]
    public async Task Import_refuses_a_document_todays_validator_rejects_and_writes_nothing()
    {
        var raw = NewRawStore();
        var store = new CanonicalizingHmiScreenStore(raw);
        var illegal = Screen("legacy-layout", "carried in a pack")
            with { Layout = new ScreenLayout(999, 8, "panel") };

        var results = await ServiceOver(raw).ImportAsync(Pack(Entry("legacy-layout", illegal)));

        var result = Assert.Single(results);
        Assert.Equal(ScreenImportOutcome.RejectedInvalid, result.Outcome);
        Assert.Null(result.Version);
        Assert.NotEmpty(result.Violations);
        // Nothing written — not even a row that a later read would have to skip.
        Assert.Empty(await store.ListScreenIdsAsync());
        Assert.Empty(await store.ListVersionsAsync("legacy-layout"));
    }

    /// <summary>🔴 THE SIDE-DOOR PIN — the one that decides whether import is a laundry.
    ///
    /// <para>A hand-edited pack claiming <c>exportValid: true</c> over an invalid document must still be
    /// refused, because the gate is <c>ContractInvariants</c> reached through <c>PutAsync</c>, never the
    /// pack's own label. Its NEGATIVE CONTROL is the sibling below: the same document with
    /// <c>exportValid: false</c> is also refused, so the pair shows the flag is IGNORED rather than
    /// inverted.</para></summary>
    [Fact]
    public async Task Import_ignores_a_packs_exportValid_claim_and_refuses_on_its_own_validation()
    {
        var raw = NewRawStore();
        var illegal = Screen("legacy-layout", "lying pack")
            with { Layout = new ScreenLayout(999, 8, "panel") };

        var lying = Pack(new ScreenPackEntry(
            "legacy-layout", 7, "2026-01-01T00:00:00.0000000+00:00",
            ExportValid: true, ExportViolations: Array.Empty<string>(), Document: illegal));

        var honest = Pack(new ScreenPackEntry(
            "legacy-layout", 7, "2026-01-01T00:00:00.0000000+00:00",
            ExportValid: false, ExportViolations: new[] { "whatever the exporter said" }, Document: illegal));

        var fromLying = Assert.Single(await ServiceOver(raw).ImportAsync(lying));
        var fromHonest = Assert.Single(await ServiceOver(raw).ImportAsync(honest));

        // Both refused, identically — the flag changed nothing.
        Assert.Equal(ScreenImportOutcome.RejectedInvalid, fromLying.Outcome);
        Assert.Equal(ScreenImportOutcome.RejectedInvalid, fromHonest.Outcome);
        Assert.Equal(fromHonest.Violations, fromLying.Violations);
    }

    /// <summary>NEGATIVE CONTROL for the whole validation section: an import that refused every document
    /// would pass every refusal test above. A VALID document carried with <c>exportValid: false</c> must
    /// still be ACCEPTED — proving the flag is ignored in the permissive direction too.</summary>
    [Fact]
    public async Task Import_accepts_a_valid_document_even_when_the_pack_claims_it_is_invalid()
    {
        var raw = NewRawStore();

        var result = Assert.Single(await ServiceOver(raw).ImportAsync(Pack(new ScreenPackEntry(
            "fine", 3, "2026-01-01T00:00:00.0000000+00:00",
            ExportValid: false, ExportViolations: new[] { "a claim nobody should trust" },
            Document: Screen("fine", "actually fine")))));

        Assert.Equal(ScreenImportOutcome.Created, result.Outcome);
        Assert.Equal(1, result.Version);
        Assert.Empty(result.Violations);
    }

    /// <summary>The pack's provenance version is PROVENANCE, never a write target. A pack claiming
    /// version 7 lands at version 1 in an empty store — writing "at" a version number is exactly the
    /// in-place write the boundary forbids, and this measures that it does not happen.</summary>
    [Fact]
    public async Task Import_ignores_the_packs_version_number_and_appends_at_the_targets_own_next_number()
    {
        var raw = NewRawStore();
        var store = new CanonicalizingHmiScreenStore(raw);

        var result = Assert.Single(await ServiceOver(raw).ImportAsync(Pack(new ScreenPackEntry(
            "line-overview", 7, "2026-01-01T00:00:00.0000000+00:00",
            ExportValid: true, ExportViolations: Array.Empty<string>(),
            Document: Screen("line-overview", "came from version 7 elsewhere")))));

        Assert.Equal(1, result.Version);
        var versions = await store.ListVersionsAsync("line-overview");
        Assert.Equal(new[] { 1 }, versions.Select(v => v.Version).ToArray());
    }

    [Fact]
    public async Task Import_refuses_an_entry_whose_envelope_and_document_name_different_screens()
    {
        var raw = NewRawStore();
        var store = new CanonicalizingHmiScreenStore(raw);

        var result = Assert.Single(await ServiceOver(raw).ImportAsync(
            Pack(Entry("envelope-says-this", Screen("document-says-that", "conflicted")))));

        Assert.Equal(ScreenImportOutcome.RejectedIdentityConflict, result.Outcome);
        Assert.Null(result.Version);
        // Neither identity was written — refused, not resolved in favour of one.
        Assert.Empty(await store.ListScreenIdsAsync());
    }

    /// <summary>One refusal does not abort the batch, and the entries that were fine still land. This is
    /// also the negative control for the identity-conflict refusal above: a service that aborted the whole
    /// import on the first bad entry would pass that test while silently dropping good screens.</summary>
    [Fact]
    public async Task One_refused_entry_does_not_stop_the_others_from_landing()
    {
        var raw = NewRawStore();
        var store = new CanonicalizingHmiScreenStore(raw);

        var results = await ServiceOver(raw).ImportAsync(new ScreenPackDocument(
            ScreenPackDocument.CurrentPackVersion, "dev", "2026-01-01T00:00:00.0000000+00:00",
            new[]
            {
                Entry("good-one", Screen("good-one", "fine")),
                Entry("bad-one", Screen("bad-one", "bad") with { Layout = new ScreenLayout(999, 8, "panel") }),
                Entry("good-two", Screen("good-two", "also fine")),
            }));

        Assert.Equal(3, results.Count);
        Assert.Equal(ScreenImportOutcome.Created, results[0].Outcome);
        Assert.Equal(ScreenImportOutcome.RejectedInvalid, results[1].Outcome);
        Assert.Equal(ScreenImportOutcome.Created, results[2].Outcome);
        Assert.Equal(new[] { "good-one", "good-two" }, (await store.ListScreenIdsAsync()).ToArray());
    }

    [Fact]
    public async Task Import_refuses_a_pack_whose_wrapper_version_is_unknown_before_examining_any_entry()
    {
        var raw = NewRawStore();
        var store = new CanonicalizingHmiScreenStore(raw);

        var unknown = new ScreenPackDocument(
            ScreenPackDocument.CurrentPackVersion + 1, "dev", "2026-01-01T00:00:00.0000000+00:00",
            new[] { Entry("perfectly-fine", Screen("perfectly-fine", "would have imported")) });

        await Assert.ThrowsAsync<ArgumentOutOfRangeException>(() => ServiceOver(raw).ImportAsync(unknown));

        // Refused WHOLE — the valid entry inside it did not half-import.
        Assert.Empty(await store.ListScreenIdsAsync());
    }

    // ═════════════════════════════════════════════════════════════════════
    // SECURITY REVIEW H-1 — THE WHOLE-PACK CEILINGS, FALSIFIED AT THE BOUNDARY IN BOTH DIRECTIONS
    //
    // Each ceiling gets a pack EXACTLY AT the cap (must be accepted) and a pack ONE ENTRY OVER (must be
    // refused). At-the-cap is the negative control that matters most here: a service that refused every
    // large pack — or that got the comparison off by one and refused at the cap — would pass every
    // "too big is refused" test while breaking the largest legal import.
    // ═════════════════════════════════════════════════════════════════════

    [Fact]
    public async Task A_pack_with_exactly_the_maximum_screen_count_is_accepted()
    {
        var raw = NewRawStore();
        var store = new CanonicalizingHmiScreenStore(raw);
        var entries = Enumerable.Range(0, ScreenPackDocument.MaxScreensPerPack)
            .Select(i => Entry($"screen-{i}", Screen($"screen-{i}", $"s{i}")))
            .ToArray();

        var results = await ServiceOver(raw).ImportAsync(Pack(entries));

        Assert.Equal(ScreenPackDocument.MaxScreensPerPack, results.Count);
        Assert.All(results, r => Assert.Equal(ScreenImportOutcome.Created, r.Outcome));
        Assert.Equal(ScreenPackDocument.MaxScreensPerPack, (await store.ListScreenIdsAsync()).Count);
    }

    [Fact]
    public async Task A_pack_one_screen_over_the_maximum_is_refused_whole_and_imports_nothing()
    {
        var raw = NewRawStore();
        var store = new CanonicalizingHmiScreenStore(raw);
        var entries = Enumerable.Range(0, ScreenPackDocument.MaxScreensPerPack + 1)
            .Select(i => Entry($"screen-{i}", Screen($"screen-{i}", $"s{i}")))
            .ToArray();

        var ex = await Assert.ThrowsAsync<ArgumentOutOfRangeException>(
            () => ServiceOver(raw).ImportAsync(Pack(entries)));

        // The refusal NAMES the limit and the actual size — "too large" without either is unactionable.
        Assert.Contains(ScreenPackDocument.MaxScreensPerPack.ToString(), ex.Message, StringComparison.Ordinal);
        Assert.Contains((ScreenPackDocument.MaxScreensPerPack + 1).ToString(), ex.Message, StringComparison.Ordinal);
        // 🔴 REFUSED WHOLE — not one screen landed. This is the property that matters in a store with no
        // DELETE: a partial import could not be undone.
        Assert.Empty(await store.ListScreenIdsAsync());
    }

    [Fact]
    public async Task A_pack_over_the_aggregate_widget_ceiling_is_refused_even_though_every_entry_is_legal()
    {
        // The reviewer's measured shape, scaled down: many screens, each individually FAR under
        // ContractInvariants.MaxWidgetsPerScreen, whose SUM crosses the pack ceiling. This is the exact
        // hole H-1 named — the per-document cap binds each entry and nothing bound their sum.
        var raw = NewRawStore();
        var store = new CanonicalizingHmiScreenStore(raw);

        const int widgetsEach = ContractInvariants.MaxWidgetsPerScreen; // legal for a single document
        var screensNeeded = (ScreenPackDocument.MaxWidgetsPerPack / widgetsEach) + 1;
        Assert.True(
            screensNeeded <= ScreenPackDocument.MaxScreensPerPack,
            "this fixture must cross the WIDGET ceiling while staying under the SCREEN ceiling, so the " +
            "refusal it measures is unambiguously the aggregate-widget one");

        var entries = Enumerable.Range(0, screensNeeded)
            .Select(i => Entry($"screen-{i}", Fat($"screen-{i}", widgetsEach)))
            .ToArray();
        // Every entry is individually legal — otherwise this measures the per-document cap, not the new one.
        Assert.All(entries, e => Assert.Empty(ContractInvariants.Validate(e.Document)));

        var ex = await Assert.ThrowsAsync<ArgumentOutOfRangeException>(
            () => ServiceOver(raw).ImportAsync(Pack(entries)));

        Assert.Contains(ScreenPackDocument.MaxWidgetsPerPack.ToString(), ex.Message, StringComparison.Ordinal);
        Assert.Empty(await store.ListScreenIdsAsync());
    }

    [Fact]
    public async Task A_pack_at_exactly_the_aggregate_widget_ceiling_is_accepted()
    {
        // NEGATIVE CONTROL for the ceiling above, and the one an off-by-one would fail: the largest legal
        // aggregate must still import.
        var raw = NewRawStore();
        var store = new CanonicalizingHmiScreenStore(raw);

        const int widgetsEach = ContractInvariants.MaxWidgetsPerScreen;
        var screensNeeded = ScreenPackDocument.MaxWidgetsPerPack / widgetsEach;
        var entries = Enumerable.Range(0, screensNeeded)
            .Select(i => Entry($"screen-{i}", Fat($"screen-{i}", widgetsEach)))
            .ToArray();
        Assert.Equal(ScreenPackDocument.MaxWidgetsPerPack, entries.Sum(e => (long)e.Document.Widgets.Count));

        var results = await ServiceOver(raw).ImportAsync(Pack(entries));

        Assert.All(results, r => Assert.Equal(ScreenImportOutcome.Created, r.Outcome));
        Assert.Equal(screensNeeded, (await store.ListScreenIdsAsync()).Count);
    }

    /// <summary>The aggregate ceiling is DERIVED from the frozen contract, not typed. If someone retypes
    /// either constant as a literal, this reddens — the same discipline
    /// <c>ContractInvariants.MaxWidgetsPerScreen</c> is held to by <c>SchemaEnumGuardPinTests</c>.</summary>
    [Fact]
    public void The_pack_ceilings_are_derived_from_the_frozen_per_document_cap()
    {
        Assert.Equal(
            ContractInvariants.LayoutDimensionMax * ContractInvariants.MaxWidgetsPerScreen,
            ScreenPackDocument.MaxWidgetsPerPack);
        // And the per-document cap is itself still the grid-derived number, so the chain back to the
        // frozen schema is unbroken rather than merely asserted one link up.
        Assert.Equal(
            ContractInvariants.LayoutDimensionMax * ContractInvariants.LayoutDimensionMax,
            ContractInvariants.MaxWidgetsPerScreen);
    }

    /// <summary>🔴 THE TWO CEILINGS MUST BE INDEPENDENT, OR ONE OF THEM IS DEAD CODE.
    ///
    /// <para>The first derivation of <see cref="ScreenPackDocument.MaxWidgetsPerPack"/> was
    /// <c>MaxScreensPerPack * MaxWidgetsPerScreen</c>, which made the widget ceiling UNREACHABLE — crossing
    /// it needed more screens than the screen ceiling allows, and the screen ceiling is checked first. A
    /// bound that can never fire reports safety nobody measured. This asserts the property that was
    /// violated, so the same mistake cannot return under a different arithmetic: it must be possible to
    /// cross the widget ceiling while staying within the screen ceiling.</para></summary>
    [Fact]
    public void Each_pack_ceiling_is_reachable_without_first_crossing_the_other()
    {
        // A pack of MaxScreensPerPack full-grid screens must be OVER the widget ceiling — i.e. the widget
        // ceiling bites strictly before the screen ceiling for heavy screens.
        var widgetsIfScreenCeilingFull =
            (long)ScreenPackDocument.MaxScreensPerPack * ContractInvariants.MaxWidgetsPerScreen;
        Assert.True(
            widgetsIfScreenCeilingFull > ScreenPackDocument.MaxWidgetsPerPack,
            "the widget ceiling must be crossable within the screen ceiling, else it is dead code");

        // And the converse: the screen ceiling must be crossable while staying under the widget ceiling,
        // i.e. by many LIGHT screens — the reviewer's 20,000 × 1 shape.
        Assert.True(
            ScreenPackDocument.MaxScreensPerPack < ScreenPackDocument.MaxWidgetsPerPack,
            "a pack of one-widget screens must hit the screen ceiling before the widget ceiling");
    }

    // ═════════════════════════════════════════════════════════════════════
    // SECURITY REVIEW L-1 — A DUPLICATE ID INSIDE ONE PACK
    // ═════════════════════════════════════════════════════════════════════

    /// <summary>🔴 The reviewer measured 1,000 entries of one id landing as 1,000 permanent versions in a
    /// store with no DELETE. The first entry imports; every later entry with that id is refused.</summary>
    [Fact]
    public async Task A_screen_id_repeated_inside_one_pack_lands_once_and_the_rest_are_refused()
    {
        var raw = NewRawStore();
        var store = new CanonicalizingHmiScreenStore(raw);

        var results = await ServiceOver(raw).ImportAsync(Pack(
            Entry("line-overview", Screen("line-overview", "first")),
            Entry("line-overview", Screen("line-overview", "second")),
            Entry("line-overview", Screen("line-overview", "third"))));

        Assert.Equal(ScreenImportOutcome.Created, results[0].Outcome);
        Assert.Equal(ScreenImportOutcome.RejectedDuplicateInPack, results[1].Outcome);
        Assert.Equal(ScreenImportOutcome.RejectedDuplicateInPack, results[2].Outcome);
        Assert.Null(results[1].Version);
        Assert.NotEmpty(results[1].Violations);

        // 🔴 ONE version, not three. This is the measurement, not the outcome labels.
        var versions = await store.ListVersionsAsync("line-overview");
        Assert.Single(versions);
        // And it is the FIRST entry that survived — the decision is "first wins", stated and pinned, not
        // array order picking a silent winner.
        Assert.Equal("first", (await store.GetAsync("line-overview"))!.Title);
    }

    /// <summary>NEGATIVE CONTROL for the de-duplication: a service that refused every entry after the first,
    /// regardless of id, would pass the test above. Three DISTINCT ids in one pack must all land.</summary>
    [Fact]
    public async Task Three_distinct_ids_in_one_pack_all_land()
    {
        var raw = NewRawStore();
        var store = new CanonicalizingHmiScreenStore(raw);

        var results = await ServiceOver(raw).ImportAsync(Pack(
            Entry("one", Screen("one", "a")),
            Entry("two", Screen("two", "b")),
            Entry("three", Screen("three", "c"))));

        Assert.All(results, r => Assert.Equal(ScreenImportOutcome.Created, r.Outcome));
        Assert.Equal(3, (await store.ListScreenIdsAsync()).Count);
    }

    /// <summary>The two ends agree: export cannot PRODUCE a pack import would refuse for duplication. This
    /// is the property L-1 is really about — a format that means different things at each end.</summary>
    [Fact]
    public async Task Export_never_produces_a_pack_that_import_would_refuse_as_duplicated()
    {
        var raw = NewRawStore();
        await new CanonicalizingHmiScreenStore(raw).PutAsync(Screen("line-overview", "x"));

        // Ask for the same screen three times, and in two spellings that canonicalise to one identity.
        var pack = await ServiceOver(raw).ExportAsync(
            "dev", new[] { "line-overview", "line-overview", "  line-overview  " });

        Assert.Single(pack.Screens);
        var results = await ServiceOver(new HmiScreenStore(Path.Combine(_dir, "target"))).ImportAsync(pack);
        Assert.Equal(ScreenImportOutcome.Created, Assert.Single(results).Outcome);
    }

    // ═════════════════════════════════════════════════════════════════════
    // THE ROUND TRIP THE FEATURE EXISTS FOR
    // ═════════════════════════════════════════════════════════════════════

    /// <summary>Machine A's screens land on machine B, identically. Two SEPARATE stores in two separate
    /// directories — the actual scenario the brief describes, not a same-store simulation of it.</summary>
    [Fact]
    public async Task Screens_exported_from_one_store_arrive_identical_in_another()
    {
        var dirA = Path.Combine(_dir, "machine-a");
        var dirB = Path.Combine(_dir, "machine-b");
        var rawA = new HmiScreenStore(dirA);
        var rawB = new HmiScreenStore(dirB);
        var storeA = new CanonicalizingHmiScreenStore(rawA);
        var storeB = new CanonicalizingHmiScreenStore(rawB);

        await storeA.PutAsync(Screen("line-overview", "A's overview"));
        await storeA.PutAsync(Screen("oven-detail", "A's oven"));

        var pack = await ServiceOver(rawA).ExportAsync("machine-a-fingerprint");
        var results = await ServiceOver(rawB).ImportAsync(pack);

        Assert.All(results, r => Assert.Equal(ScreenImportOutcome.Created, r.Outcome));
        Assert.Equal(new[] { "line-overview", "oven-detail" }, (await storeB.ListScreenIdsAsync()).ToArray());
        foreach (var entry in pack.Screens)
        {
            var landed = await storeB.GetAsync(entry.ScreenId);
            Assert.Equal(
                JsonSerializer.Serialize(entry.Document, HmiContractJson.Options),
                JsonSerializer.Serialize(landed, HmiContractJson.Options));
        }
    }

    // ═════════════════════════════════════════════════════════════════════
    // Fixtures
    // ═════════════════════════════════════════════════════════════════════

    static ScreenPackDocument Pack(params ScreenPackEntry[] entries) => new(
        ScreenPackDocument.CurrentPackVersion, "test-device", "2026-01-01T00:00:00.0000000+00:00", entries);

    static ScreenPackEntry Entry(string screenId, HmiScreenDocument doc) => new(
        screenId, 1, "2026-01-01T00:00:00.0000000+00:00",
        ExportValid: ContractInvariants.Validate(doc).Count == 0,
        ExportViolations: ContractInvariants.Validate(doc),
        Document: doc);

    static HmiScreenDocument Screen(string id, string title) => new(
        1, id, title, null, "isa101",
        new ScreenLayout(12, 8, "panel"),
        new[] { new ScreenWidget("w1", "label", new WidgetRect(0, 0, 2, 1)) });

    /// <summary>A document with <paramref name="widgetCount"/> widgets, on the largest grid the frozen
    /// schema allows so the document stays VALID at the per-document cap. Used by the aggregate-ceiling
    /// tests, which need entries that are individually legal and collectively over the pack ceiling — the
    /// exact shape security review H-1 measured.</summary>
    static HmiScreenDocument Fat(string id, int widgetCount) => new(
        1, id, id, null, "isa101",
        new ScreenLayout(ContractInvariants.LayoutDimensionMax, ContractInvariants.LayoutDimensionMax, "panel"),
        Enumerable.Range(0, widgetCount)
            .Select(i => new ScreenWidget($"w{i}", "label", new WidgetRect(0, 0, 1, 1)))
            .ToArray());

    /// <summary>Writes a version row and moves the pointer by RAW SQLite INSERT, bypassing
    /// <see cref="HmiScreenStore.PutAsync"/> — and therefore <see cref="ContractInvariants"/> — entirely.
    /// The same technique and the same reasoning as <see cref="HmiScreenStoreTests"/>'s own seeder: it is
    /// the only honest way to reproduce a row written under older rules, because every C# door refuses it
    /// today. Mirrors <see cref="HmiScreenStore"/>'s migration schema exactly, so a drift there breaks this
    /// helper loudly rather than silently seeding a shape the real store no longer matches.</summary>
    static async Task SeedRawRowAsync(string dbPath, HmiScreenDocument doc, int version)
    {
        using var connection = new SqliteConnection($"Data Source={dbPath}");
        await connection.OpenAsync();

        using (var insert = connection.CreateCommand())
        {
            insert.CommandText = """
                INSERT INTO screens (screen_id, version, document, saved_at)
                VALUES (@screen_id, @version, @document, @saved_at);
                """;
            insert.Parameters.AddWithValue("@screen_id", doc.ScreenId);
            insert.Parameters.AddWithValue("@version", version);
            insert.Parameters.AddWithValue("@document", JsonSerializer.Serialize(doc, HmiContractJson.Options));
            insert.Parameters.AddWithValue("@saved_at", DateTimeOffset.UtcNow.ToString("O"));
            await insert.ExecuteNonQueryAsync();
        }

        using (var upsertCurrent = connection.CreateCommand())
        {
            upsertCurrent.CommandText = """
                INSERT INTO screen_current (screen_id, version)
                VALUES (@screen_id, @version)
                ON CONFLICT(screen_id) DO UPDATE SET version = excluded.version;
                """;
            upsertCurrent.Parameters.AddWithValue("@screen_id", doc.ScreenId);
            upsertCurrent.Parameters.AddWithValue("@version", version);
            await upsertCurrent.ExecuteNonQueryAsync();
        }
    }
}
