using Microsoft.Data.Sqlite;
using St4i.EngineApi.Auth;
using Xunit;

namespace St4i.EngineApi.Tests.Auth;

/// <summary>
/// WS-D-D3 — <see cref="SqliteAuditStore"/> over a fresh temp directory per test (same convention as
/// <see cref="SqliteUserStoreTests"/> — never the real %ProgramData% root). TDD order matters here: the
/// TAMPER-DETECTION test (<see cref="VerifyChainAsync_DetectsTamperedRow_ReturnsFirstBrokenSeq"/>) is
/// written first, before the "happy path" tests below it, per the task brief — everything else in this
/// class is what makes that test (and its broken-link/concurrency siblings) meaningful rather than
/// vacuous (an append/verify pair that always returns Ok=true would trivially "pass" a tamper test that
/// never actually mutated anything real).
/// </summary>
public sealed class SqliteAuditStoreTests
{
    private static string NewTempDir() => Directory.CreateTempSubdirectory("st4i-audit-tests-").FullName;

    private static AuditAppend Entry(
        string action, string actor = "alice", string role = Roles.Admin,
        string? targetType = null, string? targetId = null,
        string? oldJson = null, string? newJson = null,
        string? correlationId = null, string? clientIp = null) =>
        new(actor, role, action, targetType, targetId, oldJson, newJson, correlationId, clientIp, DateTimeOffset.UtcNow);

    // ─────────────────────────────────────────────────────────────────────
    // TAMPER-DETECTION — written FIRST, per the brief's TDD instruction.
    // ─────────────────────────────────────────────────────────────────────

    [Fact]
    public async Task VerifyChainAsync_DetectsTamperedRow_ReturnsFirstBrokenSeq()
    {
        var store = new SqliteAuditStore(NewTempDir());

        await store.AppendAsync(Entry("action.one"), CancellationToken.None);
        var second = await store.AppendAsync(Entry("action.two", targetType: "recipe", targetId: "R1", newJson: "{\"v\":1}"), CancellationToken.None);
        await store.AppendAsync(Entry("action.three"), CancellationToken.None);

        // Sanity: the untampered chain verifies fine BEFORE the raw mutation below.
        var beforeTamper = await store.VerifyChainAsync(CancellationToken.None);
        Assert.True(beforeTamper.Ok);
        Assert.Null(beforeTamper.FirstBrokenSeq);

        // Raw, hash-unaware mutation of the SECOND row's new_value via a second, independent
        // Microsoft.Data.Sqlite connection — simulates an attacker (or a bug) editing the DB file
        // directly, bypassing AppendAsync entirely (the only place row_hash is ever computed).
        await RawUpdateAsync(store.DbPath, "UPDATE audit_log SET new_value = @v WHERE id = @id;",
            ("@v", "{\"tampered\":true}"), ("@id", second.Seq));

        var result = await store.VerifyChainAsync(CancellationToken.None);
        Assert.False(result.Ok);
        Assert.Equal(second.Seq, result.FirstBrokenSeq);
        Assert.Contains("hash", result.Detail, StringComparison.OrdinalIgnoreCase);
    }

    [Fact]
    public async Task VerifyChainAsync_DetectsTamperedActor_ReturnsFirstBrokenSeq()
    {
        var store = new SqliteAuditStore(NewTempDir());

        var first = await store.AppendAsync(Entry("login", actor: "alice"), CancellationToken.None);
        await store.AppendAsync(Entry("logout", actor: "alice"), CancellationToken.None);

        // Tamper with actor_username on the FIRST row this time — proves the seq reported tracks
        // WHICHEVER row was actually mutated, not just "always row 2".
        await RawUpdateAsync(store.DbPath, "UPDATE audit_log SET actor_username = @v WHERE id = @id;",
            ("@v", "mallory"), ("@id", first.Seq));

        var result = await store.VerifyChainAsync(CancellationToken.None);
        Assert.False(result.Ok);
        Assert.Equal(first.Seq, result.FirstBrokenSeq);
    }

    // ─────────────────────────────────────────────────────────────────────
    // Chain-link (broken prev_hash) — a middle row is deleted out from under the chain.
    // ─────────────────────────────────────────────────────────────────────

    [Fact]
    public async Task VerifyChainAsync_DetectsBrokenPrevHashLink_WhenAMiddleRowIsDeleted()
    {
        var store = new SqliteAuditStore(NewTempDir());

        await store.AppendAsync(Entry("action.one"), CancellationToken.None);
        var second = await store.AppendAsync(Entry("action.two"), CancellationToken.None);
        var third = await store.AppendAsync(Entry("action.three"), CancellationToken.None);

        // Raw delete of the middle row — the surviving third row's stored prev_hash still points at
        // the now-gone second row's row_hash, so its own fields still recompute to a valid row_hash
        // (nothing about row 3 itself was touched) but the LINK to its predecessor is now broken.
        await RawUpdateAsync(store.DbPath, "DELETE FROM audit_log WHERE id = @id;", ("@id", second.Seq));

        var result = await store.VerifyChainAsync(CancellationToken.None);
        Assert.False(result.Ok);
        Assert.Equal(third.Seq, result.FirstBrokenSeq);
        Assert.Contains("prev_hash", result.Detail, StringComparison.OrdinalIgnoreCase);
    }

    // ─────────────────────────────────────────────────────────────────────
    // Happy path — append + verify + query/filter.
    // ─────────────────────────────────────────────────────────────────────

    [Fact]
    public async Task AppendAsync_ThreeEntries_ChainVerifiesOk()
    {
        var store = new SqliteAuditStore(NewTempDir());

        var e1 = await store.AppendAsync(Entry("a"), CancellationToken.None);
        var e2 = await store.AppendAsync(Entry("b"), CancellationToken.None);
        var e3 = await store.AppendAsync(Entry("c"), CancellationToken.None);

        Assert.Equal(1, e1.Seq);
        Assert.Equal(2, e2.Seq);
        Assert.Equal(3, e3.Seq);
        Assert.Equal(new string('0', 64), e1.PrevHash);
        Assert.Equal(e1.RowHash, e2.PrevHash);
        Assert.Equal(e2.RowHash, e3.PrevHash);
        Assert.Equal(64, e1.RowHash.Length);
        Assert.True(e1.RowHash.All(c => "0123456789abcdef".Contains(c)));

        var result = await store.VerifyChainAsync(CancellationToken.None);
        Assert.True(result.Ok);
        Assert.Null(result.FirstBrokenSeq);
    }

    [Fact]
    public async Task VerifyChainAsync_OnAnEmptyStore_IsOk()
    {
        var store = new SqliteAuditStore(NewTempDir());

        var result = await store.VerifyChainAsync(CancellationToken.None);
        Assert.True(result.Ok);
        Assert.Null(result.FirstBrokenSeq);
    }

    [Fact]
    public async Task QueryAsync_ReturnsEntries_NewestFirst()
    {
        var store = new SqliteAuditStore(NewTempDir());

        var e1 = await store.AppendAsync(Entry("a"), CancellationToken.None);
        var e2 = await store.AppendAsync(Entry("b"), CancellationToken.None);
        var e3 = await store.AppendAsync(Entry("c"), CancellationToken.None);

        var page = await store.QueryAsync(null, null, null, null, null, 200, 0, CancellationToken.None);

        Assert.Equal(3, page.Total);
        Assert.Equal(200, page.Limit);
        Assert.Equal(0, page.Offset);
        Assert.Equal(new[] { e3.Seq, e2.Seq, e1.Seq }, page.Items.Select(i => i.Seq).ToArray());
    }

    [Fact]
    public async Task QueryAsync_FiltersByActorAndAction()
    {
        var store = new SqliteAuditStore(NewTempDir());

        await store.AppendAsync(Entry("login", actor: "alice"), CancellationToken.None);
        await store.AppendAsync(Entry("logout", actor: "alice"), CancellationToken.None);
        await store.AppendAsync(Entry("login", actor: "bob"), CancellationToken.None);

        var byActor = await store.QueryAsync(null, null, "alice", null, null, 200, 0, CancellationToken.None);
        Assert.Equal(2, byActor.Total);
        Assert.All(byActor.Items, i => Assert.Equal("alice", i.ActorUsername));

        var byAction = await store.QueryAsync(null, null, null, "login", null, 200, 0, CancellationToken.None);
        Assert.Equal(2, byAction.Total);
        Assert.All(byAction.Items, i => Assert.Equal("login", i.Action));

        var byBoth = await store.QueryAsync(null, null, "bob", "login", null, 200, 0, CancellationToken.None);
        Assert.Equal(1, byBoth.Total);
        Assert.Equal("bob", byBoth.Items[0].ActorUsername);
    }

    [Fact]
    public async Task QueryAsync_FiltersByTarget()
    {
        var store = new SqliteAuditStore(NewTempDir());

        await store.AppendAsync(Entry("recipe.update", targetType: "recipe", targetId: "R1"), CancellationToken.None);
        await store.AppendAsync(Entry("recipe.update", targetType: "recipe", targetId: "R2"), CancellationToken.None);

        var page = await store.QueryAsync(null, null, null, null, "R1", 200, 0, CancellationToken.None);
        Assert.Equal(1, page.Total);
        Assert.Equal("R1", page.Items[0].TargetId);
    }

    [Fact]
    public async Task QueryAsync_FiltersByDateRange()
    {
        var store = new SqliteAuditStore(NewTempDir());

        var old = await store.AppendAsync(
            new AuditAppend("alice", Roles.Admin, "old.action", null, null, null, null, null, null, DateTimeOffset.UtcNow.AddDays(-10)),
            CancellationToken.None);
        var recent = await store.AppendAsync(Entry("recent.action"), CancellationToken.None);

        var page = await store.QueryAsync(DateTimeOffset.UtcNow.AddDays(-1), null, null, null, null, 200, 0, CancellationToken.None);
        Assert.Equal(1, page.Total);
        Assert.Equal(recent.Seq, page.Items[0].Seq);
        Assert.NotEqual(old.Seq, page.Items[0].Seq);
    }

    [Fact]
    public async Task QueryAsync_RespectsLimitAndOffset()
    {
        var store = new SqliteAuditStore(NewTempDir());
        for (var i = 0; i < 5; i++)
        {
            await store.AppendAsync(Entry($"action.{i}"), CancellationToken.None);
        }

        var page1 = await store.QueryAsync(null, null, null, null, null, 2, 0, CancellationToken.None);
        Assert.Equal(5, page1.Total);
        Assert.Equal(2, page1.Items.Count);

        var page2 = await store.QueryAsync(null, null, null, null, null, 2, 2, CancellationToken.None);
        Assert.Equal(2, page2.Items.Count);
        Assert.NotEqual(page1.Items[0].Seq, page2.Items[0].Seq);
    }

    // ─────────────────────────────────────────────────────────────────────
    // Concurrency — proves the in-process append lock serializes the read-last -> compute -> insert
    // straddle (see SqliteAuditStore's doc comment for why SQLite's own transactions alone don't cover
    // this).
    // ─────────────────────────────────────────────────────────────────────

    [Fact]
    public async Task AppendAsync_ManyConcurrentCalls_AllPersisted_ContiguousSeqs_ChainVerifiesOk()
    {
        var store = new SqliteAuditStore(NewTempDir());
        const int n = 50;

        // Fired "at once" via Task.WhenAll (not awaited one at a time) — if AppendAsync's lock did NOT
        // cover the whole read-last-row -> compute-seq/hash -> insert sequence, two overlapping calls
        // could read the same "last row", compute the SAME would-be next seq/prev_hash, and race to
        // insert two DIFFERENT rows both claiming it — either a duplicate-id failure (caught by "all
        // persisted"/"contiguous" below) or, if ids somehow didn't collide, two rows chained off the
        // SAME prev_hash (a fork the final VerifyChainAsync would catch as either a broken link or a
        // hash mismatch). Getting a clean contiguous 1..N AND a green VerifyChainAsync out of this is
        // only possible if every append was fully serialized end to end.
        var tasks = new Task<AuditEntry>[n];
        for (var i = 0; i < n; i++)
        {
            var idx = i;
            tasks[idx] = store.AppendAsync(Entry($"concurrent.action.{idx}"), CancellationToken.None);
        }

        var results = await Task.WhenAll(tasks);

        var seqs = results.Select(r => r.Seq).OrderBy(s => s).ToArray();
        Assert.Equal(Enumerable.Range(1, n).Select(i => (long)i).ToArray(), seqs);

        var page = await store.QueryAsync(null, null, null, null, null, n, 0, CancellationToken.None);
        Assert.Equal(n, page.Total);

        var verify = await store.VerifyChainAsync(CancellationToken.None);
        Assert.True(verify.Ok);
        Assert.Null(verify.FirstBrokenSeq);
    }

    // ─────────────────────────────────────────────────────────────────────
    // Restart survival — a new store instance pointed at the same directory sees the chain the first
    // instance wrote, and still verifies (mirrors SqliteUserStoreTests' own restart-survival test).
    // ─────────────────────────────────────────────────────────────────────

    [Fact]
    public async Task ANewStore_PointedAtTheSameDirectory_SeesEntriesFromAnEarlierStore_AndVerifies()
    {
        var dir = NewTempDir();
        var store1 = new SqliteAuditStore(dir);
        await store1.AppendAsync(Entry("a"), CancellationToken.None);
        await store1.AppendAsync(Entry("b"), CancellationToken.None);

        var store2 = new SqliteAuditStore(dir);
        var page = await store2.QueryAsync(null, null, null, null, null, 200, 0, CancellationToken.None);
        Assert.Equal(2, page.Total);

        var verify = await store2.VerifyChainAsync(CancellationToken.None);
        Assert.True(verify.Ok);
    }

    // ─────────────────────────────────────────────────────────────────────
    // Raw-SQL helper — a SECOND, independent Microsoft.Data.Sqlite connection to the SAME db file, used
    // only by the tamper/broken-link tests above to mutate rows WITHOUT going through the store (which
    // would recompute hashes correctly and defeat the whole point of these tests).
    // ─────────────────────────────────────────────────────────────────────
    private static async Task RawUpdateAsync(string dbPath, string commandText, params (string Name, object Value)[] parameters)
    {
        using var connection = new SqliteConnection($"Data Source={dbPath}");
        await connection.OpenAsync();
        using var cmd = connection.CreateCommand();
        cmd.CommandText = commandText;
        foreach (var (name, value) in parameters)
        {
            cmd.Parameters.AddWithValue(name, value);
        }
        await cmd.ExecuteNonQueryAsync();
    }
}
