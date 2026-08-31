using St4i.EngineApi.HmiModel;
using St4i.Hmi.Contracts;
using Xunit;

namespace St4i.EngineApi.Tests.HmiModel;

/// <summary>
/// WS-HMI-0b Task 1, fix round 4 — <b>the enumeration, not a seventh per-method patch.</b>
///
/// <para>Rounds 1–3 each closed the case a finding used as an illustration and left the property open:
/// round 1 fixed one <c>machineCode</c> mismatch and left case-variants; round 2 fixed body case-variants
/// and left route case-variants; round 3 built the right decorator and wired it into FOUR of SIX methods.
/// Re-review #3 measured that 4-of-6 with a recording fake inner store — the answer being what the inner
/// store RECEIVED, not what the source said — and this file is that measurement turned into a permanent
/// one.</para>
///
/// <para><b>The property these tests pin, stated once:</b> every method of
/// <see cref="IComponentModelStore"/> and <see cref="ITagNamespaceStore"/> must AGREE about what a row's
/// identity is. It is not enough that each method individually does something reasonable — round 3's
/// <c>GetAsync</c> canonicalised the lookup key while <c>ListMachineCodesAsync</c> returned stored keys
/// verbatim, so the two methods of ONE decorator disagreed, and the list reported an identity the detail
/// route could not serve (a machine listed, its document invisible, and — worst — a CLEAN integrity
/// report at Operator tier for a document that was never read).</para>
///
/// <para><b>Why a disposition TABLE rather than one test per method.</b> A per-method test set is exactly
/// what shipped 4-of-6 three times running: nothing goes red when a SEVENTH method is added and quietly
/// forwards. <see cref="Every_method_of_both_store_seams_carries_a_declared_identity_disposition"/> reads
/// the interfaces by REFLECTION — <b>their own members AND every member inherited from a base interface</b>
/// (see <see cref="SeamSurface"/>: round 4 read only declared members, which was itself evadable) — and
/// fails if the seam and the table below disagree in either direction: a new method with no declared
/// disposition, or a stale disposition for a method that no longer exists. The declaration itself is not
/// trusted: every entry carries a probe that DRIVES the decorated store and asserts what the recording
/// inner store actually received.</para>
///
/// <para>📎 🔴 <b>THE SENTENCE ABOVE WAS FALSE FOR ONE ENTRY OF SIX WHEN IT WAS WRITTEN, and it is
/// corrected rather than quietly edited (fix round 5, re-review #4).</b> The
/// <c>IComponentModelStore.GetAsync</c> entry declared that the canonical-miss fallback serves a row stored
/// under a non-canonical spelling, and then seeded a CANONICAL row — so deleting the fallback outright left
/// this suite green. A declaration outrunning its own probe, inside the test whose stated job is to stop
/// declarations outrunning measurement: the round's own signature defect, one level down. Both that probe
/// and <c>ITagNamespaceStore.GetAsync</c>'s (whose output canonicalisation nothing in either suite could
/// see) now drive every clause of what they claim, and both were confirmed to redden against the unfixed
/// production code before the claim was made. <b>The lesson worth keeping: a probe that exercises the
/// method is not the same as a probe that exercises the sentence.</b></para>
///
/// <para><b>What this file does NOT measure:</b> (1) anything over HTTP — the end-to-end consequences of
/// a non-canonically-keyed row (listed, unreadable, reported clean at Operator tier) are measured in
/// <c>HmiModelEndpointsTests</c> against a real <see cref="ComponentModelStore"/> on disk; (2) that DI
/// hands out the decorator rather than the raw store — that is
/// <c>HmiModelEndpointsTests.IComponentModelStore_And_ITagNamespaceStore_ResolveToTheCanonicalizingDecorator</c>
/// and <c>HmiModelWiringTests</c>; (3) SQLite collation — the fakes below are Ordinal-keyed
/// <see cref="Dictionary{TKey,TValue}"/>s precisely BECAUSE <c>machine_code TEXT PRIMARY KEY</c> carries
/// no <c>COLLATE NOCASE</c>, so the fake reproduces the real store's case-sensitivity rather than
/// papering over it.</para>
/// </summary>
public sealed class CanonicalMachineCodeStoresTests
{
    // ─────────────────────────────────────────────────────────────────────
    // Recording fakes — case-SENSITIVE by construction (StringComparer.Ordinal), mirroring
    // `machine_code TEXT PRIMARY KEY` with no COLLATE NOCASE. `Calls` is what makes these MEASUREMENTS
    // rather than readings of the source: every assertion below is about what the inner store RECEIVED.
    // ─────────────────────────────────────────────────────────────────────

    private sealed class RecordingComponentModelStore : IComponentModelStore
    {
        private readonly Dictionary<string, ComponentModelDocument> _rows = new(StringComparer.Ordinal);

        public List<string> Calls { get; } = new();

        /// <summary>Seeds a row at a VERBATIM key — the only way to reproduce a row written by a direct
        /// <c>new ComponentModelStore(dir)</c> caller (or by this branch before the decorator existed).</summary>
        public void SeedRaw(string storedKey, ComponentModelDocument doc) => _rows[storedKey] = doc;

        public Task PutAsync(ComponentModelDocument doc, CancellationToken ct = default)
        {
            Calls.Add($"Put:{doc.MachineCode}");
            _rows[doc.MachineCode] = doc;
            return Task.CompletedTask;
        }

        public Task<ComponentModelDocument?> GetAsync(string machineCode, CancellationToken ct = default)
        {
            Calls.Add($"Get:{machineCode}");
            return Task.FromResult(_rows.TryGetValue(machineCode, out var doc) ? doc : null);
        }

        public Task<IReadOnlyList<string>> ListMachineCodesAsync(CancellationToken ct = default)
        {
            Calls.Add("List:");
            return Task.FromResult<IReadOnlyList<string>>(
                _rows.Keys.OrderBy(k => k, StringComparer.Ordinal).ToList());
        }
    }

    private sealed class RecordingTagNamespaceStore : ITagNamespaceStore
    {
        private readonly Dictionary<string, TagNamespaceDocument> _rows = new(StringComparer.Ordinal);

        public List<string> Calls { get; } = new();

        public void SeedRaw(string storedKey, TagNamespaceDocument doc) => _rows[storedKey] = doc;

        public Task PutAsync(TagNamespaceDocument doc, CancellationToken ct = default)
        {
            Calls.Add($"Put:{doc.MachineCode}");
            _rows[doc.MachineCode] = doc;
            return Task.CompletedTask;
        }

        public Task<TagNamespaceDocument?> GetAsync(string machineCode, CancellationToken ct = default)
        {
            Calls.Add($"Get:{machineCode}");
            return Task.FromResult(_rows.TryGetValue(machineCode, out var doc) ? doc : null);
        }

        public Task<TagDescriptor?> FindTagAsync(string path, CancellationToken ct = default)
        {
            Calls.Add($"Find:{path}");
            return Task.FromResult<TagDescriptor?>(
                _rows.Values.SelectMany(d => d.Tags).FirstOrDefault(t => string.Equals(t.Path, path, StringComparison.Ordinal)));
        }
    }

    // ─────────────────────────────────────────────────────────────────────
    // Fixtures
    // ─────────────────────────────────────────────────────────────────────

    private static ComponentModelDocument Model(string machineCode, string typeId = "st4i.motor.spindle") =>
        new(1, machineCode,
            new[] { new ComponentNode("spindle", typeId, "Spindle", null, $"{machineCode}/spindle") },
            new[] { new ComponentTypeDef(typeId, typeId, Array.Empty<ComponentTagDef>(), Array.Empty<ComponentStateDef>(), "fp.x") });

    private static TagNamespaceDocument Namespace(string machineCode, string? path = null) =>
        new(1, machineCode, new[]
        {
            new TagDescriptor(
                path ?? $"{machineCode}/spindle/speed", "float", null, null, null, null, "r", null, new TagSource("simulated"), false),
        });

    // ─────────────────────────────────────────────────────────────────────
    // THE ENUMERATION. One row per interface method, with the disposition DECLARED and a probe that
    // MEASURES it. A method missing from a table, or a table entry naming a method that no longer exists,
    // is a failure — that is what makes a seventh method impossible to add silently.
    // ─────────────────────────────────────────────────────────────────────

    /// <summary><c>true</c> = this method takes part in machine-code identity and must canonicalise;
    /// <c>false</c> = a DELIBERATE, named pass-through of a DIFFERENT identity.</summary>
    private sealed record Disposition(bool ParticipatesInMachineCodeIdentity, string Rationale, Func<Task> Probe);

    private static IReadOnlyDictionary<string, Disposition> ComponentModelDispositions() =>
        new Dictionary<string, Disposition>(StringComparer.Ordinal)
        {
            ["PutAsync"] = new(true,
                "the document's MachineCode IS the SQLite primary key — writing it verbatim is how two " +
                "spellings become two rows",
                async () =>
                {
                    var inner = new RecordingComponentModelStore();
                    var store = new CanonicalizingComponentModelStore(inner);
                    await store.PutAsync(Model(" case-90 "));
                    Assert.Equal(new[] { "Put:CASE-90" }, inner.Calls);
                }),

            // 🔴 Fix round 5, item 3a — this probe used to seed a CANONICAL row only, so it measured the
            // first clause of its own rationale and not the second: re-review #4 measured that DELETING THE
            // FALLBACK ENTIRELY left this test GREEN, and I reproduced that before changing it. A
            // declaration outrunning its probe, inside the test whose stated job is to stop declarations
            // outrunning measurement. All three clauses are now driven, and the inner CALL TRACE is
            // asserted exactly — `Get` miss, `List`, `Get` at the stored spelling — so the fallback cannot
            // be removed, short-circuited, or replaced by a second canonical lookup without this reddening.
            ["GetAsync"] = new(true,
                "the lookup key must name the same identity PutAsync wrote; a row already stored under a " +
                "non-canonical spelling must still be SERVED (otherwise the list reports an identity this " +
                "method cannot answer); and the document handed back must name its machine canonically",
                async () =>
                {
                    var inner = new RecordingComponentModelStore();
                    var store = new CanonicalizingComponentModelStore(inner);
                    inner.SeedRaw("CASE-90", Model("CASE-90"));
                    Assert.NotNull(await store.GetAsync("case-90"));
                    Assert.Equal(new[] { "Get:CASE-90" }, inner.Calls); // canonical hit: no fallback needed

                    var legacy = new RecordingComponentModelStore();
                    var overLegacy = new CanonicalizingComponentModelStore(legacy);
                    legacy.SeedRaw("legacy-90", Model("legacy-90", typeId: "st4i.legacy.type"));

                    var served = await overLegacy.GetAsync("LEGACY-90");
                    Assert.True(served is not null, "the canonical-miss fallback did not serve the row");
                    Assert.Equal("st4i.legacy.type", served!.Types[0].TypeId);
                    Assert.Equal("LEGACY-90", served.MachineCode); // output canonicalised
                    Assert.Equal(new[] { "Get:LEGACY-90", "List:", "Get:legacy-90" }, legacy.Calls);
                }),

            ["ListMachineCodesAsync"] = new(true,
                "machine codes are exactly what this method RETURNS; forwarding stored keys verbatim is how " +
                "round 3 made the list disagree with GetAsync about a row's identity",
                async () =>
                {
                    var inner = new RecordingComponentModelStore();
                    var store = new CanonicalizingComponentModelStore(inner);
                    inner.SeedRaw("legacy-01", Model("legacy-01"));
                    inner.SeedRaw("LEGACY-01", Model("LEGACY-01"));
                    Assert.Equal(new[] { "LEGACY-01" }, await store.ListMachineCodesAsync());
                }),
        };

    private static IReadOnlyDictionary<string, Disposition> TagNamespaceDispositions() =>
        new Dictionary<string, Disposition>(StringComparer.Ordinal)
        {
            ["PutAsync"] = new(true,
                "same key, same reason as IComponentModelStore.PutAsync — tag_namespaces.machine_code is a " +
                "case-sensitive PRIMARY KEY",
                async () =>
                {
                    var inner = new RecordingTagNamespaceStore();
                    var store = new CanonicalizingTagNamespaceStore(inner);
                    await store.PutAsync(Namespace(" case-92 "));
                    Assert.Equal(new[] { "Put:CASE-92" }, inner.Calls);
                }),

            // 🔴 Fix round 5, item 3b — the output half of this method was a production change NOTHING
            // measured: re-review #4 removed `return doc is null ? null : Canonical(doc)` and the entire
            // suite stayed green, and I reproduced that (62/62) before writing the seed below.
            // `A_namespace_read_back_reports_the_canonical_machine_code` looks like it covers it but is
            // satisfied by PutAsync alone, because PutAsync canonicalises the field before the frozen store
            // binds its key FROM that field — so every row a real store can hold already has key ≡ field,
            // and the output half is invisible through any row a writer can create.
            //
            // The seed below is therefore deliberately a state no real writer produces: key CANONICAL,
            // field NOT. That is not a contrived shape, it is the exact assumption the decorator does not
            // own — `ComponentModelStore.cs:192` and `TagNamespaceStore.cs:219` bind `@machine_code` from
            // `doc.MachineCode`, and the guarantee "a caller who read the list and a caller who read a
            // document never hold two different names for one machine" silently rests on that. The output
            // canonicalisation is what keeps the guarantee true if a future store ever accepts a key
            // independent of the field, and this is the probe that stops it being deleted as dead weight.
            ["GetAsync"] = new(true,
                "GetIntegrityAsync reads the namespace through this method with a route-derived code; a miss " +
                "here is a CLEAN integrity report for a namespace that was never read. The document handed " +
                "back also names its machine canonically, so the guarantee does not depend on an invariant " +
                "of a store this decorator does not own",
                async () =>
                {
                    var inner = new RecordingTagNamespaceStore();
                    var store = new CanonicalizingTagNamespaceStore(inner);
                    inner.SeedRaw("CASE-92", Namespace("CASE-92"));
                    Assert.NotNull(await store.GetAsync("case-92"));
                    Assert.Equal(new[] { "Get:CASE-92" }, inner.Calls);

                    var skewed = new RecordingTagNamespaceStore();
                    var overSkewed = new CanonicalizingTagNamespaceStore(skewed);
                    skewed.SeedRaw("CASE-93", Namespace("case-93"));

                    var doc = await overSkewed.GetAsync("case-93");
                    Assert.True(doc is not null, "the canonical key did not reach the inner store");
                    Assert.Equal("CASE-93", doc!.MachineCode);
                }),

            ["FindTagAsync"] = new(false,
                "a tag PATH is a DIFFERENT identity from a machine code — tag_index.path is a global primary " +
                "key with no machine-code-prefix requirement (ContractInvariants' own doc comment says so) " +
                "and ModelIntegrity.IsPathPrefix is Ordinal by design, so canonicalising a leading segment " +
                "would corrupt every path that does not begin with a machine code. Judged CORRECT by " +
                "re-review #3 §2.3 and left alone deliberately",
                async () =>
                {
                    var inner = new RecordingTagNamespaceStore();
                    var store = new CanonicalizingTagNamespaceStore(inner);
                    await store.FindTagAsync("case-92/spindle/speed");
                    Assert.Equal(new[] { "Find:case-92/spindle/speed" }, inner.Calls);
                }),
        };

    [Fact]
    public void Every_method_of_both_store_seams_carries_a_declared_identity_disposition()
    {
        AssertDispositionsCoverExactly(typeof(IComponentModelStore), ComponentModelDispositions());
        AssertDispositionsCoverExactly(typeof(ITagNamespaceStore), TagNamespaceDispositions());
    }

    /// <summary>Two-directional, and combined into ONE failure on purpose: two consecutive
    /// <c>Assert</c>s would report only the first drift per run, so half of every mismatch would stay
    /// invisible until the other half was fixed (the same reasoning <c>SchemaPin.AssertSameNames</c>
    /// states for the schema pins).</summary>
    private static void AssertDispositionsCoverExactly(Type seam, IReadOnlyDictionary<string, Disposition> declared)
    {
        var onInterface = SeamSurface(seam).Select(m => m.Name).ToHashSet(StringComparer.Ordinal);

        var undeclared = onInterface.Except(declared.Keys).OrderBy(n => n, StringComparer.Ordinal).ToList();
        var stale = declared.Keys.Except(onInterface).OrderBy(n => n, StringComparer.Ordinal).ToList();

        if (undeclared.Count == 0 && stale.Count == 0) return;

        var parts = new List<string>();
        if (undeclared.Count > 0)
        {
            parts.Add(
                $"{seam.Name}'s surface — its own members AND every member inherited from a base " +
                $"interface — carries method(s) with NO identity disposition: {string.Join(", ", undeclared)}. " +
                "Decide — does this method see a machine code? If yes, canonicalise it in the decorator and " +
                "add a `true` entry with a probe that measures what the inner store receives. If no, add a " +
                "`false` entry NAMING the other identity, and name it in CanonicalMachineCodeStores.cs's " +
                "\"What this does NOT canonicalise\" paragraph too. Do NOT delete this test to make it pass: " +
                "forwarding an unhandled method is the exact defect it exists to catch (fix rounds 1-3, " +
                "three consecutive instances)");
        }
        if (stale.Count > 0)
        {
            parts.Add($"{seam.Name}'s surface no longer carries: {string.Join(", ", stale)} — remove the stale disposition");
        }

        Assert.Fail(string.Join(" | ", parts));
    }

    /// <summary>🔴 <b>Fix round 5, item 1 — the guard's OWN evasion, closed.</b> This used to be
    /// <c>seam.GetMethods()</c>, and on an interface type that returns <b>declared</b> members only, never
    /// inherited interface members. Re-review #4 measured the hole: a seventh method
    /// (<c>Task&lt;bool&gt; ExistsAsync(string machineCode, …)</c>) on <see cref="IComponentModelStore"/>
    /// itself → guard RED as designed; the SAME method moved up into a base
    /// <c>interface IMachineCodeKeyedStore</c> that <see cref="IComponentModelStore"/> extends →
    /// guard <b>GREEN, 8/8</b>. Reproduced here before fixing it, with a default interface implementation
    /// so that not one implementer — frozen store included — has to notice the method exists. That is
    /// precisely the variant a future "factor the shared members up into a base seam" refactor produces,
    /// and it is the variant that would have slipped past a guard whose own failure message says
    /// <i>"Do NOT delete this test to make it pass"</i> — because it would have passed undeleted.
    ///
    /// <para>Neither seam has a base interface today, so this closes a LATENT hole. It is closed anyway,
    /// because "latent" is what <c>ListMachineCodesAsync</c> was called for three rounds.</para>
    ///
    /// <para><b>Deliberately not filtered:</b> property accessors (<c>get_X</c>) and members inherited from
    /// an unrelated base such as <see cref="IDisposable"/> both land in this set and both demand a
    /// disposition entry. That is the intended answer, not noise — a property returning machine codes is
    /// exactly the shape <c>ListMachineCodesAsync</c> had, and anything on the seam is something the
    /// decorator forwards.</para></summary>
    private static IEnumerable<System.Reflection.MethodInfo> SeamSurface(Type seam) =>
        new[] { seam }.Concat(seam.GetInterfaces()).SelectMany(t => t.GetMethods()).Distinct();

    [Fact]
    public async Task Every_declared_disposition_is_measured_against_a_recording_inner_store()
    {
        foreach (var (name, disposition) in ComponentModelDispositions())
        {
            await RunProbe(nameof(IComponentModelStore), name, disposition);
        }

        foreach (var (name, disposition) in TagNamespaceDispositions())
        {
            await RunProbe(nameof(ITagNamespaceStore), name, disposition);
        }
    }

    private static async Task RunProbe(string seam, string method, Disposition disposition)
    {
        try
        {
            await disposition.Probe();
        }
        catch (Exception ex)
        {
            Assert.Fail(
                $"{seam}.{method} does not behave as its declared disposition says " +
                $"(participates in machine-code identity: {disposition.ParticipatesInMachineCodeIdentity}; " +
                $"rationale: {disposition.Rationale}). Measured failure: {ex.Message}");
        }
    }

    // ─────────────────────────────────────────────────────────────────────
    // The property itself, stated as a property rather than as six cases.
    // ─────────────────────────────────────────────────────────────────────

    /// <summary>Re-review #3's HIGH: <c>GET /v1/components</c> returned <c>legacy-01</c> while
    /// <c>GET /v1/components/legacy-01</c> returned the §5-bis EMPTY document — the list handing out an
    /// identity the detail route could not serve, which then made the Operator-tier integrity route report
    /// a clean bill of health for a document it never read.</summary>
    [Fact]
    public async Task Every_code_the_list_reports_is_a_code_GetAsync_can_actually_serve()
    {
        var inner = new RecordingComponentModelStore();
        var store = new CanonicalizingComponentModelStore(inner);

        // Three raw rows, none of them written through the decorator: a legacy lowercase row (a direct
        // `new ComponentModelStore(dir)` caller, or this branch two commits ago — %ProgramData% persists),
        // a mixed-case one, and an already-canonical one.
        inner.SeedRaw("legacy-01", Model("legacy-01"));
        inner.SeedRaw("MiXeD-02", Model("MiXeD-02"));
        inner.SeedRaw("CANON-03", Model("CANON-03"));

        var codes = await store.ListMachineCodesAsync();

        Assert.Equal(new[] { "CANON-03", "LEGACY-01", "MIXED-02" }, codes);
        foreach (var code in codes)
        {
            Assert.True(await store.GetAsync(code) is not null,
                $"GET /v1/components listed '{code}' and GetAsync could not serve it — the list and the " +
                "detail route disagree about what a row's identity is (re-review #3, HIGH-1)");
        }
    }

    /// <summary>The second half of the same disagreement: the identity a caller supplies must reach the
    /// same row no matter which spelling they use, INCLUDING the non-canonical spelling the list used to
    /// hand out. Before fix round 4 this returned <see langword="null"/> for a row stored as
    /// <c>legacy-01</c>, which the HTTP layer turned into a §5-bis empty document indistinguishable from
    /// "never declared".</summary>
    [Fact]
    public async Task A_row_stored_under_a_non_canonical_key_is_served_at_every_spelling_of_its_identity()
    {
        var inner = new RecordingComponentModelStore();
        var store = new CanonicalizingComponentModelStore(inner);
        inner.SeedRaw("legacy-01", Model("legacy-01", typeId: "st4i.legacy.type"));

        foreach (var spelling in new[] { "legacy-01", "LEGACY-01", "Legacy-01", " legacy-01 " })
        {
            var doc = await store.GetAsync(spelling);
            Assert.True(doc is not null, $"GetAsync(\"{spelling}\") found nothing for a row stored as 'legacy-01'");
            Assert.Equal("st4i.legacy.type", doc!.Types[0].TypeId);

            // ...and the identity it reports back is the canonical one, so the document a caller reads
            // never disagrees with the list they read it from.
            Assert.Equal("LEGACY-01", doc.MachineCode);
        }
    }

    /// <summary>Re-review #3's own screenshot, at the decorator: one Engineer PUT at the spelling the list
    /// handed out used to yield <c>["LEGACY-01","legacy-01"]</c> — two rows, one machine.</summary>
    [Fact]
    public async Task A_write_at_the_spelling_the_list_handed_out_never_produces_a_second_identity()
    {
        var inner = new RecordingComponentModelStore();
        var store = new CanonicalizingComponentModelStore(inner);
        inner.SeedRaw("legacy-01", Model("legacy-01", typeId: "st4i.legacy.type"));

        var listed = await store.ListMachineCodesAsync();
        await store.PutAsync(Model(listed[0], typeId: "st4i.new.type"));

        Assert.Equal(new[] { "LEGACY-01" }, await store.ListMachineCodesAsync());

        var back = await store.GetAsync("legacy-01");
        Assert.Equal("st4i.new.type", back!.Types[0].TypeId);
    }

    /// <summary>The tag-namespace twin of the read-side rule: whatever spelling reaches
    /// <see cref="ITagNamespaceStore.GetAsync"/>, the document it returns names its machine in the ONE
    /// canonical spelling, so a caller that read <c>GET /v1/components</c> and a caller that read the
    /// namespace never hold two different names for one machine.</summary>
    [Fact]
    public async Task A_namespace_read_back_reports_the_canonical_machine_code()
    {
        var inner = new RecordingTagNamespaceStore();
        var store = new CanonicalizingTagNamespaceStore(inner);

        await store.PutAsync(Namespace("find-01"));

        var doc = await store.GetAsync("FIND-01");
        Assert.NotNull(doc);
        Assert.Equal("FIND-01", doc!.MachineCode);
    }

    /// <summary>🔴 MEDIUM-3, DECIDED AND PINNED rather than left as a doc comment. The decorator rewrites a
    /// document's <c>machineCode</c> (it has no choice: the frozen store derives its primary key from that
    /// field, so a canonical KEY is unobtainable without a canonical FIELD) and does NOT rewrite tag paths
    /// (it must not: <c>tag_index.path</c> is a global primary key with no machine-code-prefix requirement).
    /// So a namespace authored as <c>find-01</c> persists as <c>FIND-01</c> with paths <c>find-01/…</c>,
    /// and <b>a tag path is therefore NOT derivable from a machine code</b> — look one up, never compose
    /// one. This test IS that rule: it fails if a future round starts rewriting path segments, and it is
    /// what WS-HMI-0c and Task 2's <c>PUT /v1/tags/{machineCode}</c> are meant to read.</summary>
    [Fact]
    public async Task A_tag_path_is_not_derivable_from_a_machine_code_and_is_never_rewritten()
    {
        var inner = new RecordingTagNamespaceStore();
        var store = new CanonicalizingTagNamespaceStore(inner);

        await store.PutAsync(Namespace("find-01", path: "find-01/spindle/speed"));

        // The machine code was canonicalised; the path was not.
        var doc = await store.GetAsync("find-01");
        Assert.Equal("FIND-01", doc!.MachineCode);
        Assert.Equal("find-01/spindle/speed", doc.Tags[0].Path);

        // Composing `{machineCode}/…` from the canonical code MISSES — that is the documented consequence,
        // not a bug to be fixed by rewriting the path.
        Assert.Null(await store.FindTagAsync("FIND-01/spindle/speed"));
        Assert.NotNull(await store.FindTagAsync("find-01/spindle/speed"));
    }

    /// <summary>...and the consequence of that decision is REPORTED, not silent: a component tree authored
    /// at the canonical spelling against a namespace whose paths use the other one produces an ordinary
    /// <c>ModelIntegrity</c> warning (check 4 is Ordinal by design), which is exactly this task's central
    /// rule — losing integrity WARNS, losing safety REFUSES. This is the mechanism that makes the
    /// desynchronisation visible to an engineer instead of leaving it to be discovered downstream.</summary>
    [Fact]
    public void A_machineCode_tagPath_case_desynchronisation_surfaces_as_an_integrity_warning()
    {
        var model = Model("FIND-01"); // tagPrefix "FIND-01/spindle"
        var ns = Namespace("FIND-01", path: "find-01/spindle/speed"); // paths spelled the other way

        var violations = ModelIntegrity.Check(model, ns);

        Assert.Contains(violations, v => v.Contains("FIND-01/spindle", StringComparison.Ordinal));
    }
}
