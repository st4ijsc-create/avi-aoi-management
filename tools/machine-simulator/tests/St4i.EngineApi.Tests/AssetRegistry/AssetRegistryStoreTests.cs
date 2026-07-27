using Microsoft.Data.Sqlite;
using St4i.EdgeCore.Models;
using St4i.EdgeCore.Uns;
using St4i.EngineApi.AssetRegistry;
using Xunit;

namespace St4i.EngineApi.Tests.AssetRegistry;

/// <summary>
/// P2-1 (WS-J Asset Registry) — <see cref="AssetRegistryStore"/>: the ISA-95 URN is built from the
/// SAME <see cref="UnsOptions"/> address every call site uses, a fresh upsert reports
/// <see cref="AssetLifecycleState.Active"/> with <c>created==updated</c>, and — the one load-bearing
/// correctness guarantee of this whole task — a RE-upsert of an already-transitioned asset preserves its
/// lifecycle and original creation time even though everything else about the row refreshes. Each test
/// gets its own fresh temp directory (its own <c>assets.db</c>), deleted on dispose.
/// </summary>
public sealed class AssetRegistryStoreTests : IDisposable
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
        var dir = Directory.CreateTempSubdirectory("st4i-assets-store-tests-").FullName;
        _tempDirs.Add(dir);
        return dir;
    }

    private static readonly UnsOptions KnownAddress = new()
    {
        Site = "site-x",
        Area = "area-x",
        Line = "line-x",
        Cell = "cell-x",
    };

    private static MachineDescriptor NewDescriptor(string code, double cycleSeconds = 1.0) => new(
        code, $"SN-{code}", DeviceClass.Automation, "SCREWDRIVE", "screw_tightening",
        DriverKind.Simulated, "RC-TEST-A", null, cycleSeconds);

    // ─────────────────────────────────────────────────────────────────────
    // 1. Fresh upsert: URN, lifecycle=Active, non-null checksum, created==updated.
    // ─────────────────────────────────────────────────────────────────────

    [Fact]
    public async Task UpsertAsync_ThenGetAsync_ReturnsExpectedUrn_ActiveLifecycle_AndCreatedEqualsUpdated()
    {
        var store = new AssetRegistryStore(KnownAddress, NewTempDir());
        var descriptor = NewDescriptor("AST-01");

        await store.UpsertAsync(descriptor);
        var record = await store.GetAsync("AST-01");

        Assert.NotNull(record);
        Assert.Equal("urn:isa95:site-x:area-x:line-x:cell-x:AST-01", record!.Urn);
        Assert.Equal("AST-01", record.Code);
        Assert.Equal("Automation", record.DeviceClass);
        Assert.Equal("Simulated", record.DriverKind);
        Assert.Equal("SCREWDRIVE", record.MachineType);
        Assert.Equal(AssetLifecycleState.Active, record.Lifecycle);
        Assert.False(string.IsNullOrWhiteSpace(record.ConfigChecksum));
        Assert.Equal(record.CreatedAtUtc, record.UpdatedAtUtc);
    }

    // ─────────────────────────────────────────────────────────────────────
    // 2. THE critical guarantee: re-upsert after an operator lifecycle transition preserves
    //    lifecycle + created_at, while everything else (checksum, updated_at) still refreshes.
    // ─────────────────────────────────────────────────────────────────────

    [Fact]
    public async Task UpsertAsync_Reregistering_PreservesLifecycleAndCreatedAt_ButRefreshesChecksumAndUpdatedAt()
    {
        var store = new AssetRegistryStore(KnownAddress, NewTempDir());
        var descriptor = NewDescriptor("AST-02", cycleSeconds: 1.0);

        await store.UpsertAsync(descriptor);
        var first = await store.GetAsync("AST-02");
        Assert.NotNull(first);

        var afterTransition = await store.SetLifecycleAsync("AST-02", AssetLifecycleState.Maintenance);
        Assert.NotNull(afterTransition);
        Assert.Equal(AssetLifecycleState.Maintenance, afterTransition!.Lifecycle);

        // A real clock tick between the two writes so UpdatedAtUtc is unambiguously later — the store
        // itself uses DateTimeOffset.UtcNow with no artificial floor, so back-to-back calls in a tight
        // loop could otherwise tie at typical timer resolution.
        await Task.Delay(20);

        // Simulate the machine's descriptor having actually changed since it last registered (a realistic
        // re-register, not a byte-identical no-op) so the checksum is expected to differ too.
        var changedDescriptor = descriptor with { CycleSeconds = 2.0 };
        await store.UpsertAsync(changedDescriptor);

        var second = await store.GetAsync("AST-02");
        Assert.NotNull(second);

        // Preserved:
        Assert.Equal(AssetLifecycleState.Maintenance, second!.Lifecycle);
        Assert.Equal(first!.CreatedAtUtc, second.CreatedAtUtc);

        // Refreshed:
        Assert.True(second.UpdatedAtUtc > first.UpdatedAtUtc);
        Assert.NotEqual(first.ConfigChecksum, second.ConfigChecksum);
    }

    // ─────────────────────────────────────────────────────────────────────
    // 3. ListAsync ordered by code; unknown code -> null for Get/SetLifecycle.
    // ─────────────────────────────────────────────────────────────────────

    [Fact]
    public async Task ListAsync_ReturnsAllOrderedByCode_AndUnknownCode_ReturnsNullForGetAndSetLifecycle()
    {
        var store = new AssetRegistryStore(KnownAddress, NewTempDir());
        await store.UpsertAsync(NewDescriptor("ZZZ-01"));
        await store.UpsertAsync(NewDescriptor("AAA-01"));
        await store.UpsertAsync(NewDescriptor("MMM-01"));

        var all = await store.ListAsync();

        Assert.Equal(3, all.Count);
        Assert.Equal(new[] { "AAA-01", "MMM-01", "ZZZ-01" }, all.Select(a => a.Code).ToArray());

        Assert.Null(await store.GetAsync("NOPE-01"));
        Assert.Null(await store.SetLifecycleAsync("NOPE-01", AssetLifecycleState.Commissioning));
    }

    // ─────────────────────────────────────────────────────────────────────
    // 4. UpsertAsync never throws — even when the underlying directory has vanished out from under it.
    // ─────────────────────────────────────────────────────────────────────

    [Fact]
    public async Task UpsertAsync_NeverThrows_WhenTheDbDirectoryIsGone()
    {
        var dir = NewTempDir();
        Exception? captured = null;
        var store = new AssetRegistryStore(KnownAddress, dir, logError: (ex, _) => captured = ex);

        // The ctor's EnsureSchema() already opened (and Microsoft.Data.Sqlite pools, per
        // SqliteHistorianStore's own doc comment) a native connection against this exact file — clear the
        // pool first so the OS doesn't still consider assets.db "in use" when we delete its directory below.
        SqliteConnection.ClearAllPools();

        // Simulate a hostile environment (deleted volume, revoked permissions, ...): the directory the
        // store was constructed against no longer exists by the time it tries to upsert.
        Directory.Delete(dir, recursive: true);

        // Must not throw — if it does, this test fails on the unhandled exception alone.
        await store.UpsertAsync(NewDescriptor("BAD-01"));

        Assert.NotNull(captured);
    }
}
