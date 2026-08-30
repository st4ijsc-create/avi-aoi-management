using St4i.EngineApi.HmiModel;
using St4i.Hmi.Contracts;
using Xunit;

namespace St4i.EngineApi.Tests.HmiModel;

/// <summary>
/// WS-HMI-0b Task 2 — the tests that PAY for <see cref="SqliteTagIndexCollisionQuery"/> reading
/// <c>tag_index</c> directly instead of going through <see cref="ITagNamespaceStore"/>.
///
/// <para>🔴 <b>This file exists because fix round 2 cited it and it did not exist</b> (re-review #2, NEW-2).
/// <c>TagIndexCollisionQuery.cs</c> pointed a reader at "<c>TagIndexCollisionQueryTests</c> drives this type
/// and the real <c>TagNamespaceStore</c> against one database and requires them to agree" as the thing that
/// justifies a new raw-SQL surface. The claim was true when measured by hand and the tests were not there —
/// which is worse than a wrong citation, because those two sentences are exactly what a reader is asked to
/// accept the concession on. Writing them was the honest repair; renaming the citation to point at
/// something weaker would have kept the concession unpaid.</para>
///
/// <para><b>The concession, stated plainly:</b> the seam has no bulk membership query and cannot gain one
/// (<see cref="TagNamespaceStore"/> is a frozen WS-HMI-0a artefact), and a per-tag probe loop is what
/// re-review #2 measured as making a collision past position 200 undiagnosable. So this type knows
/// <c>tag_index(path, machine_code)</c> — a second place holding the frozen store's schema. What pays for
/// it is <see cref="The_query_and_the_frozen_store_agree_about_which_paths_the_index_holds"/>: if the
/// schema ever moves, that test reddens instead of the diagnosis silently reporting "no collisions".</para>
///
/// <para><b>What this file does NOT measure:</b> (1) the HTTP surface — the handler's use of this type is
/// measured in <c>HmiTagEndpointsTests</c>; (2) that a collision is a 409 rather than a 500 — that is the
/// handler's job and is pinned there; (3) concurrency — every test here is sequential, and two writers
/// racing for one global path is the limitation this whole workstream has recorded.</para>
/// </summary>
public sealed class TagIndexCollisionQueryTests
{
    private static TagDescriptor Tag(string path) =>
        new(path, "float", null, null, null, null, "r", null, new TagSource("simulated"), false);

    /// <summary>A real, isolated <see cref="TagNamespaceStore"/> plus the query pointed at its own file —
    /// no host, no HTTP, no doubles anywhere in the chain.</summary>
    private static (TagNamespaceStore Store, SqliteTagIndexCollisionQuery Query) NewRealPair()
    {
        var dir = Directory.CreateTempSubdirectory("st4i-tagidx-").FullName;
        var store = new TagNamespaceStore(dir);
        return (store, new SqliteTagIndexCollisionQuery(store.DbPath));
    }

    /// <summary>🔴 <b>The cost bound, asserted against LITERALS, and pinned at ONE UNIT in both
    /// directions.</b> Fix round 1's bound test compared a call count against the very constant the
    /// production code read, so raising the constant raised the assertion with it. Round 3 replaced that
    /// with literals but asserted only the chunk COUNT, which left a green band: any
    /// <c>ChunkSize ∈ [500, 666]</c> still yields 4 chunks for 2 000 paths, so the constant could be raised
    /// 33 % — silently, with the whole 1 600-test suite green — while this test's own NAME, the constant's
    /// doc comment and the type's cost paragraph all went on saying "per 500".
    ///
    /// <para>Asserting the FIRST CHUNK'S SIZE as a literal closes the band: 501 makes it 501 and reddens,
    /// 499 makes it 499 and reddens. Both numbers are written out, so neither can be moved by editing a
    /// constant.</para>
    ///
    /// <para><b>The headroom assertion lives in its own test</b>
    /// (<see cref="No_chunk_can_exceed_the_conservative_parameter_ceiling"/>), because here it was
    /// unreachable: any chunk bigger than 999 already forces the count away from 4, so the first assertion
    /// always fired first and the headroom check guarded nothing. Round 3's doc comment claimed enlarging
    /// <c>ChunkSize</c> "reddens the headroom assertion"; it does not — at 33 000 it is
    /// <c>Expected 4 / Actual 1</c>, a different assertion entirely. Splitting them makes both
    /// reachable and makes that sentence true.</para></summary>
    [Fact]
    public void The_diagnosis_cost_is_one_statement_per_500_paths()
    {
        var paths = Enumerable.Range(0, 2_000).Select(i => $"p/{i}").ToList();

        var chunks = SqliteTagIndexCollisionQuery.Chunk(paths);

        Assert.Equal(4, chunks.Count);
        Assert.Equal(500, chunks[0].Count);            // the one-unit pin, in both directions
        Assert.Equal(2_000, chunks.Sum(c => c.Count)); // nothing dropped on the way
    }

    /// <summary>The safety half of the bound, in a test where it can actually fail. The input is large
    /// enough that an oversized <c>ChunkSize</c> does not first show up as a wrong chunk count, so this
    /// assertion is the one that fires — which is what makes it a guard rather than decoration.</summary>
    [Fact]
    public void No_chunk_can_exceed_the_conservative_parameter_ceiling()
    {
        var paths = Enumerable.Range(0, 50_000).Select(i => $"p/{i}").ToList();

        var chunks = SqliteTagIndexCollisionQuery.Chunk(paths);

        Assert.All(chunks, c => Assert.True(
            c.Count <= 999,
            $"a chunk of {c.Count} bound parameters. SQLITE_MAX_VARIABLE_NUMBER measures 32 766 on this " +
            "build but is 999 on older ones, and this statement must stay valid on either — so 999 is the " +
            "ceiling, not 32 766."));
    }

    /// <summary>🔴 <b>The test that pays for the direct-SQL concession.</b> The query and the frozen store
    /// are driven against ONE database and must agree, path by path, about what the index holds. If
    /// <c>tag_index</c>'s table or column names ever move, this reddens — rather than the collision
    /// diagnosis silently returning "no paths claimed" and the 409 quietly losing its explanation.
    ///
    /// <para><see cref="ITagNamespaceStore.FindTagAsync"/> is the oracle deliberately: it is the frozen
    /// store's OWN reader over the same index, so agreement between the two is agreement between this
    /// file's schema assumption and the schema itself.</para></summary>
    [Fact]
    public async Task The_query_and_the_frozen_store_agree_about_which_paths_the_index_holds()
    {
        var (store, query) = NewRealPair();

        await store.PutAsync(new TagNamespaceDocument(1, "AAA-01", new[] { Tag("aaa/one"), Tag("aaa/two") }));
        await store.PutAsync(new TagNamespaceDocument(1, "BBB-01", new[] { Tag("bbb/one") }));

        // A mix: two AAA paths, one BBB path, and two that were never declared at all.
        var candidates = new[] { "aaa/one", "aaa/two", "bbb/one", "never/declared", "aaa/one/deeper" };

        // The store's own view, path by path.
        var storeSaysPresent = new List<string>();
        foreach (var path in candidates)
        {
            if (await store.FindTagAsync(path) is not null) storeSaysPresent.Add(path);
        }

        // The query's view, asked as one machine that owns NONE of them, so "claimed by another machine"
        // and "present in the index" are the same set and the two answers are directly comparable.
        var querySaysClaimed = await query.ClaimedByAnotherMachineAsync("ZZZ-99", candidates);

        Assert.Equal(new[] { "aaa/one", "aaa/two", "bbb/one" }, storeSaysPresent);
        Assert.Equal(storeSaysPresent, querySaysClaimed);
    }

    /// <summary>The ownership rule at the query itself, against a real database: a machine's own paths are
    /// never reported as somebody else's, and the same paths ARE reported to anyone else. Two assertions of
    /// one rule, so a query that simply returned nothing would fail the second.</summary>
    [Fact]
    public async Task A_machines_own_paths_are_never_reported_as_claimed_but_everyone_elses_are()
    {
        var (store, query) = NewRealPair();

        await store.PutAsync(new TagNamespaceDocument(1, "OWNER-01", new[] { Tag("own/a"), Tag("own/b") }));

        var candidates = new[] { "own/a", "own/b" };

        Assert.Empty(await query.ClaimedByAnotherMachineAsync("OWNER-01", candidates));
        Assert.Equal(candidates, await query.ClaimedByAnotherMachineAsync("SOMEONE-ELSE-01", candidates));
    }

    /// <summary>The machine code reaches this query already canonicalised — <c>HmiTagEndpoints</c> does that
    /// — so the comparison here is Ordinal and must STAY Ordinal. This pins the division of labour rather
    /// than the outcome: a non-canonical code must NOT match, because silently accepting one here would
    /// hide the caller having skipped canonicalisation, which is exactly how the handler's own
    /// <c>Canonicalize</c> lost its pin in round 2.</summary>
    [Fact]
    public async Task The_ownership_comparison_is_ordinal_so_a_caller_cannot_skip_canonicalising()
    {
        var (store, query) = NewRealPair();

        await store.PutAsync(new TagNamespaceDocument(1, "case-01", new[] { Tag("case/x") }));

        // The store canonicalises nothing on its own — the DECORATOR does — so this row is keyed exactly
        // as written. Asked with a different spelling, the query must not pretend they are the same.
        Assert.Empty(await query.ClaimedByAnotherMachineAsync("case-01", new[] { "case/x" }));
        Assert.Single(await query.ClaimedByAnotherMachineAsync("CASE-01", new[] { "case/x" }));
    }

    /// <summary>🔴 <b>Renamed and re-pinned (fix round 4, NEW-1). The previous version survived deleting the
    /// very guard it claimed to pin, and its name said the opposite of its intent.</b> It asserted an empty
    /// result and an empty chunk list — both of which hold with the guard gone, because
    /// <c>Chunk([])</c> yields zero chunks and the loop body simply never runs. Round 3's report listed it
    /// as "pinned as deliberate"; it was not pinned at all.
    ///
    /// <para><b>The guard's one live effect, now that the handle is <c>Mode=ReadOnly</c>:</b> it is what
    /// stops the query OPENING a connection it does not need. Read-only mode will not create a missing
    /// database, so opening one against a file that does not exist throws <c>SQLITE_CANTOPEN</c> — and
    /// without the early return that throw happens on a call that had nothing to ask. So the pinnable
    /// property is: <b>with no database at all, an empty candidate list still answers empty instead of
    /// throwing.</b> Delete the guard and this reddens on a real <see cref="SqliteException"/>.</para>
    ///
    /// <para>This is not a hypothetical file path: a host whose tag namespace has never been written has no
    /// <c>tag-namespaces.db</c> until the frozen store's constructor creates one, and the collision query is
    /// pointed at that path independently.</para></summary>
    [Fact]
    public async Task An_empty_candidate_list_never_opens_the_database()
    {
        var absent = Path.Combine(
            Directory.CreateTempSubdirectory("st4i-tagidx-absent-").FullName, "does-not-exist.db");
        Assert.False(File.Exists(absent));

        var query = new SqliteTagIndexCollisionQuery(absent);

        Assert.Empty(await query.ClaimedByAnotherMachineAsync("ANY-01", Array.Empty<string>()));

        // ...and the file was never created, which is the other half of "never opens it": a read-only
        // handle cannot create it, so a connection attempt would have thrown rather than succeeded.
        Assert.False(File.Exists(absent));

        // The mechanism, stated separately so a future reader can see why the early return is what does it.
        Assert.Empty(SqliteTagIndexCollisionQuery.Chunk(Array.Empty<string>()));
    }
}
