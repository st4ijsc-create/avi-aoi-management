using Microsoft.Data.Sqlite;
using St4i.EngineApi.Alarms;
using Xunit;

namespace St4i.EngineApi.Tests.Alarms;

/// <summary>
/// GĐ3 sub-4 LC-1 — <see cref="AlarmStore"/>: raise/re-raise dedup (Source+Code+TargetId preserving
/// FirstRaisedUtc/ack state), ack for both ClearOnAck=true EVENT alarms (clears in one step) and
/// ClearOnAck=false CONDITION alarms (stays active, just Acked), ClearAsync, active-set ordering, history
/// append/paging/filtering, and the never-throws guarantee on RaiseAsync/ClearAsync. Each test gets its own
/// fresh temp directory (its own <c>alarms.db</c>), deleted on dispose — same idiom as
/// <c>AssetRegistryStoreTests</c>.
/// </summary>
public sealed class AlarmStoreTests : IDisposable
{
    private readonly List<string> _tempDirs = new();

    public void Dispose()
    {
        foreach (var dir in _tempDirs)
        {
            try { Directory.Delete(dir, recursive: true); } catch { /* best-effort cleanup */ }
        }
    }

    private string NewTempDir()
    {
        var dir = Directory.CreateTempSubdirectory("st4i-alarms-store-tests-").FullName;
        _tempDirs.Add(dir);
        return dir;
    }

    private static AlarmRaise NewRaise(
        AlarmSource source = AlarmSource.Policy,
        string code = "SAFETY_BLOCKED",
        AlarmPriority priority = AlarmPriority.Critical,
        string message = "E-STOP is engaged.",
        string? runbook = "Reset the E-STOP latch.",
        string? targetId = "fleet.start",
        bool clearOnAck = true) =>
        new(source, code, priority, message, runbook, targetId, clearOnAck);

    // ─────────────────────────────────────────────────────────────────────
    // 1. Raise -> shows up in ListActive with the expected fresh-alarm shape.
    // ─────────────────────────────────────────────────────────────────────

    [Fact]
    public async Task RaiseAsync_ThenListActiveAsync_ShowsTheAlarm()
    {
        var store = new AlarmStore(NewTempDir());
        await store.RaiseAsync(NewRaise());

        var active = await store.ListActiveAsync();
        var alarm = Assert.Single(active);

        Assert.Equal(AlarmSource.Policy, alarm.Source);
        Assert.Equal("SAFETY_BLOCKED", alarm.Code);
        Assert.Equal(AlarmPriority.Critical, alarm.Priority);
        Assert.Equal(AlarmState.Active, alarm.State);
        Assert.Equal("fleet.start", alarm.TargetId);
        Assert.True(alarm.ClearOnAck);
        Assert.Equal(1, alarm.Count);
        Assert.Equal(alarm.FirstRaisedUtc, alarm.LastRaisedUtc);
        Assert.Null(alarm.AckedUtc);
        Assert.Null(alarm.AckedBy);
        Assert.Equal($"{AlarmSource.Policy}:SAFETY_BLOCKED:fleet.start", alarm.Key);
    }

    // ─────────────────────────────────────────────────────────────────────
    // 2. Re-raise same key -> count++/lastRaised updated, firstRaised (and Id) preserved.
    // ─────────────────────────────────────────────────────────────────────

    [Fact]
    public async Task RaiseAsync_SameKeyTwice_IncrementsCount_UpdatesLastRaised_PreservesFirstRaisedAndId()
    {
        var store = new AlarmStore(NewTempDir());
        await store.RaiseAsync(NewRaise());
        var first = Assert.Single(await store.ListActiveAsync());

        // A real clock tick between the two writes so LastRaisedUtc is unambiguously later — the store
        // itself uses DateTimeOffset.UtcNow with no artificial floor, so back-to-back calls in a tight
        // loop could otherwise tie at typical timer resolution.
        await Task.Delay(20);
        await store.RaiseAsync(NewRaise(message: "E-STOP is engaged (again)."));

        var second = Assert.Single(await store.ListActiveAsync());
        Assert.Equal(first.Id, second.Id);
        Assert.Equal(first.Key, second.Key);
        Assert.Equal(first.FirstRaisedUtc, second.FirstRaisedUtc);
        Assert.True(second.LastRaisedUtc > first.LastRaisedUtc);
        Assert.Equal(2, second.Count);
        Assert.Equal("E-STOP is engaged (again).", second.Message);
    }

    // ─────────────────────────────────────────────────────────────────────
    // 3. Ack a ClearOnAck=true (EVENT) alarm -> clears in one step: removed from active, "cleared" (not
    //    "acked") appears in history, and the returned Alarm itself reports State=Cleared.
    // ─────────────────────────────────────────────────────────────────────

    [Fact]
    public async Task AckAsync_ClearOnAckTrue_ClearsInOneStep_RemovedFromActive_HistoryShowsClearedNotAcked()
    {
        var store = new AlarmStore(NewTempDir());
        await store.RaiseAsync(NewRaise(clearOnAck: true));
        var raised = Assert.Single(await store.ListActiveAsync());

        var acked = await store.AckAsync(raised.Id, "alice");

        Assert.NotNull(acked);
        Assert.Equal(AlarmState.Cleared, acked!.State);
        Assert.Equal("alice", acked.AckedBy);
        Assert.NotNull(acked.AckedUtc);

        Assert.Empty(await store.ListActiveAsync());

        var history = await store.QueryHistoryAsync(new AlarmHistoryFilter(null, null, null, null, 100, 0));
        Assert.Contains(history.Items, h => h.Event == "raised" && h.Key == raised.Key);
        Assert.Contains(history.Items, h => h.Event == "cleared" && h.Key == raised.Key && h.Actor == "alice");
        Assert.DoesNotContain(history.Items, h => h.Event == "acked");
    }

    // ─────────────────────────────────────────────────────────────────────
    // 3b. Ack a ClearOnAck=false (CONDITION) alarm -> stays active as Acked; an evaluator's ClearAsync is
    //     what eventually removes it, never the operator's Ack alone.
    // ─────────────────────────────────────────────────────────────────────

    [Fact]
    public async Task AckAsync_ClearOnAckFalse_StaysActiveAsAcked_HistoryShowsAckedNotCleared()
    {
        var store = new AlarmStore(NewTempDir());
        await store.RaiseAsync(NewRaise(
            source: AlarmSource.DriverHealth, code: "DRIVER_UNREACHABLE", priority: AlarmPriority.High,
            message: "AOI-01 driver unreachable.", runbook: null, targetId: "AOI-01", clearOnAck: false));
        var raised = Assert.Single(await store.ListActiveAsync());

        var acked = await store.AckAsync(raised.Id, "bob");

        Assert.NotNull(acked);
        Assert.Equal(AlarmState.Acked, acked!.State);
        Assert.Equal("bob", acked.AckedBy);

        var stillActive = Assert.Single(await store.ListActiveAsync());
        Assert.Equal(raised.Id, stillActive.Id);
        Assert.Equal(AlarmState.Acked, stillActive.State);
        Assert.Equal("bob", stillActive.AckedBy);

        var history = await store.QueryHistoryAsync(new AlarmHistoryFilter(null, null, null, null, 100, 0));
        Assert.Contains(history.Items, h => h.Event == "acked" && h.Key == raised.Key && h.Actor == "bob");
        Assert.DoesNotContain(history.Items, h => h.Event == "cleared");
    }

    [Fact]
    public async Task AckAsync_UnknownId_ReturnsNull()
    {
        var store = new AlarmStore(NewTempDir());
        Assert.Null(await store.AckAsync(999_999, "nobody"));
    }

    // ─────────────────────────────────────────────────────────────────────
    // 4. ClearAsync -> removed from active, "cleared" in history; no-op (never throws) for an absent key.
    // ─────────────────────────────────────────────────────────────────────

    [Fact]
    public async Task ClearAsync_RemovesFromActive_RecordsHistory_AndIsANoOpForAnAbsentKey()
    {
        var store = new AlarmStore(NewTempDir());
        var raise = NewRaise(source: AlarmSource.NgRate, code: "NG_RATE_HIGH", priority: AlarmPriority.Medium, targetId: "SCRW-01", clearOnAck: false);
        await store.RaiseAsync(raise);

        await store.ClearAsync(raise.Key);
        Assert.Empty(await store.ListActiveAsync());

        var history = await store.QueryHistoryAsync(new AlarmHistoryFilter(null, null, null, null, 100, 0));
        Assert.Contains(history.Items, h => h.Event == "cleared" && h.Key == raise.Key);

        // No-op / never throws for a key that was never raised (or already cleared) — must not throw.
        await store.ClearAsync("no-such-key-ever-raised");
    }

    // ─────────────────────────────────────────────────────────────────────
    // 5. Distinct keys (different Source/Code/TargetId) never collide.
    // ─────────────────────────────────────────────────────────────────────

    [Fact]
    public async Task RaiseAsync_DifferentKeys_AreDistinctAlarms()
    {
        var store = new AlarmStore(NewTempDir());
        await store.RaiseAsync(NewRaise(targetId: "fleet.start"));
        await store.RaiseAsync(NewRaise(targetId: "fleet.stop"));
        await store.RaiseAsync(NewRaise(code: "POLICY_DENIED", targetId: "fleet.start"));

        var active = await store.ListActiveAsync();
        Assert.Equal(3, active.Count);
    }

    // ─────────────────────────────────────────────────────────────────────
    // 6. RaiseAsync/ClearAsync never throw even when the underlying directory has vanished.
    // ─────────────────────────────────────────────────────────────────────

    [Fact]
    public async Task RaiseAsync_NeverThrows_WhenTheDbDirectoryIsGone()
    {
        var dir = NewTempDir();
        Exception? captured = null;
        var store = new AlarmStore(dir, logError: (ex, _) => captured = ex);

        // The ctor's EnsureSchema() already opened (and Microsoft.Data.Sqlite pools) a native connection
        // against this exact file — clear the pool first so the OS doesn't still consider alarms.db "in
        // use" when we delete its directory below.
        SqliteConnection.ClearAllPools();
        Directory.Delete(dir, recursive: true);

        // Must not throw — if it does, this test fails on the unhandled exception alone.
        await store.RaiseAsync(NewRaise());

        Assert.NotNull(captured);
    }

    [Fact]
    public async Task ClearAsync_NeverThrows_WhenTheDbDirectoryIsGone()
    {
        var dir = NewTempDir();
        Exception? captured = null;
        var store = new AlarmStore(dir, logError: (ex, _) => captured = ex);
        var raise = NewRaise();
        await store.RaiseAsync(raise);

        SqliteConnection.ClearAllPools();
        Directory.Delete(dir, recursive: true);

        // Must not throw.
        await store.ClearAsync(raise.Key);

        Assert.NotNull(captured);
    }

    // ─────────────────────────────────────────────────────────────────────
    // 🔴 6b. Closeout round (I-4) — never-throws must survive a logError that ITSELF throws.
    //
    // The two tests above prove the never-throws contract holds when the DATABASE fails. They cannot see
    // the hole that was in it, because their own logError delegate succeeds: the last statement of the
    // catch that IMPLEMENTS never-throws was an unguarded `_logError?.Invoke(...)`, so a reporting failure
    // escaped the very handler written to stop failures escaping. (NotifySafely wrapped the IDENTICAL call
    // in its own try/catch, with a comment explaining why — the two sites disagreed.)
    //
    // 🔴 This is reachable in production, and specifically during shutdown. Program.cs binds logError to
    // `sp.GetRequiredService<ILoggerFactory>()...` — a SERVICE RESOLUTION on the error path — which throws
    // ObjectDisposedException once the root provider is disposed. That is also when alarms.db is most
    // likely to be failing, so both halves arrive together rather than independently.
    //
    // Scope, stated honestly: PolicyResults.DenyAsync has no try/catch around RaiseAsync, so the escape
    // surfaced there — but DenyAsync never performs the denied write, so the SAFETY GATE IS NOT BYPASSED.
    // The action stayed refused; a SAFETY_BLOCKED 409 became a framework 500. Fail-closed, worse
    // diagnostics.
    //
    // Both tests fail (the throw propagates out of RaiseAsync/ClearAsync) with ReportSafely's catch
    // removed — which is the mutation, and is why they are written as two rather than one: the two catch
    // blocks are separate statements and a fix applied to only one would still pass a single test.
    // ─────────────────────────────────────────────────────────────────────

    /// <summary>The exact production shape: the report path throws the same exception type a disposed
    /// root <c>IServiceProvider</c> throws from <c>GetRequiredService</c>.</summary>
    private static Action<Exception, string> ThrowingLogError() =>
        (_, _) => throw new ObjectDisposedException("IServiceProvider");

    [Fact]
    public async Task RaiseAsync_StillNeverThrows_WhenTheLogErrorDelegateItselfThrows()
    {
        var dir = NewTempDir();
        var store = new AlarmStore(dir, logError: ThrowingLogError());

        SqliteConnection.ClearAllPools();
        Directory.Delete(dir, recursive: true);

        // Both failures at once, which is the production case: the database is gone AND the reporter is
        // dead. Must still not throw, and must still report the transition it could not make.
        var transition = await store.RaiseAsync(NewRaise());

        Assert.Equal(AlarmTransition.None, transition);
    }

    [Fact]
    public async Task ClearAsync_StillNeverThrows_WhenTheLogErrorDelegateItselfThrows()
    {
        var dir = NewTempDir();
        var raise = NewRaise();

        // Raised while the store is healthy and the reporter is silent, so the failure below is genuinely
        // the clear path's own and not left over from setup.
        var seed = new AlarmStore(dir);
        await seed.RaiseAsync(raise);

        var store = new AlarmStore(dir, logError: ThrowingLogError());

        SqliteConnection.ClearAllPools();
        Directory.Delete(dir, recursive: true);

        var transition = await store.ClearAsync(raise.Key);

        Assert.Equal(AlarmTransition.None, transition);
    }

    // ─────────────────────────────────────────────────────────────────────
    // 7. ListActiveAsync ordering: priority severity desc (Critical first), then last-raised desc.
    // ─────────────────────────────────────────────────────────────────────

    [Fact]
    public async Task ListActiveAsync_OrdersByPrioritySeverityDesc_ThenLastRaisedDesc()
    {
        var store = new AlarmStore(NewTempDir());
        await store.RaiseAsync(NewRaise(code: "LOW1", priority: AlarmPriority.Low, targetId: "t-low", clearOnAck: false));
        await Task.Delay(10);
        await store.RaiseAsync(NewRaise(code: "CRIT1", priority: AlarmPriority.Critical, targetId: "t-crit"));
        await Task.Delay(10);
        await store.RaiseAsync(NewRaise(code: "HIGH1", priority: AlarmPriority.High, targetId: "t-high", clearOnAck: false));
        await Task.Delay(10);
        await store.RaiseAsync(NewRaise(code: "MED1", priority: AlarmPriority.Medium, targetId: "t-med", clearOnAck: false));

        var active = await store.ListActiveAsync();
        Assert.Equal(new[] { "CRIT1", "HIGH1", "MED1", "LOW1" }, active.Select(a => a.Code).ToArray());
    }

    // ─────────────────────────────────────────────────────────────────────
    // 8. QueryHistoryAsync — paging + filter by source/priority, newest-first.
    // ─────────────────────────────────────────────────────────────────────

    [Fact]
    public async Task QueryHistoryAsync_PagesAndFiltersBySourceAndPriority_NewestFirst()
    {
        var store = new AlarmStore(NewTempDir());
        await store.RaiseAsync(new AlarmRaise(AlarmSource.Policy, "SAFETY_BLOCKED", AlarmPriority.Critical, "m1", null, "t1", true));
        await Task.Delay(10);
        await store.RaiseAsync(new AlarmRaise(AlarmSource.Policy, "POLICY_DENIED", AlarmPriority.High, "m2", null, "t2", true));
        await Task.Delay(10);
        await store.RaiseAsync(new AlarmRaise(AlarmSource.DriverHealth, "DRIVER_UNREACHABLE", AlarmPriority.Medium, "m3", null, "t3", false));

        var all = await store.QueryHistoryAsync(new AlarmHistoryFilter(null, null, null, null, 100, 0));
        Assert.Equal(3, all.Total);
        Assert.Equal(3, all.Items.Count);
        Assert.Equal("DRIVER_UNREACHABLE", all.Items[0].Code); // newest-first

        var policyOnly = await store.QueryHistoryAsync(new AlarmHistoryFilter(AlarmSource.Policy, null, null, null, 100, 0));
        Assert.Equal(2, policyOnly.Total);
        Assert.All(policyOnly.Items, h => Assert.Equal(AlarmSource.Policy, h.Source));

        var criticalOnly = await store.QueryHistoryAsync(new AlarmHistoryFilter(null, AlarmPriority.Critical, null, null, 100, 0));
        var criticalEntry = Assert.Single(criticalOnly.Items);
        Assert.Equal("SAFETY_BLOCKED", criticalEntry.Code);

        var page1 = await store.QueryHistoryAsync(new AlarmHistoryFilter(null, null, null, null, 1, 0));
        Assert.Equal(3, page1.Total);
        var onlyItem = Assert.Single(page1.Items);
        Assert.Equal("DRIVER_UNREACHABLE", onlyItem.Code);

        var page2 = await store.QueryHistoryAsync(new AlarmHistoryFilter(null, null, null, null, 1, 1));
        Assert.Equal(3, page2.Total);
        Assert.Equal("POLICY_DENIED", Assert.Single(page2.Items).Code);
    }

    [Fact]
    public async Task QueryHistoryAsync_FiltersByFromTo()
    {
        var store = new AlarmStore(NewTempDir());
        await store.RaiseAsync(NewRaise(code: "OLD-ONE"));

        var future = DateTimeOffset.UtcNow.AddMinutes(5);
        var futureOnly = await store.QueryHistoryAsync(new AlarmHistoryFilter(null, null, future, null, 100, 0));
        Assert.Equal(0, futureOnly.Total);

        var past = DateTimeOffset.UtcNow.AddMinutes(-5);
        var sinceThePast = await store.QueryHistoryAsync(new AlarmHistoryFilter(null, null, past, null, 100, 0));
        Assert.Equal(1, sinceThePast.Total);
    }
}
