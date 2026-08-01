using St4i.EdgeCore.Identity;
using Xunit;

namespace St4i.EdgeCore.Tests.Identity;

/// <summary>
/// GĐ3 closeout WI-4 (+ fix round 1) — <see cref="DeviceIdentityProvider"/>:
/// <see cref="DeviceIdentityProvider.Current"/> starts as whatever it was constructed with,
/// <see cref="DeviceIdentityProvider.Rotate"/> actually swaps it (a DIFFERENT fingerprint, reloadable from
/// disk, same NodeId preserved), and — since fix round 1 made <see cref="DeviceIdentityProvider.Rotate"/>
/// hold its lock across the ENTIRE mint+persist+swap, not just the swap — concurrent <see cref="DeviceIdentityProvider.Rotate"/>
/// calls are now genuinely, fully serialized: no exceptions, no lost updates, and every caller's returned
/// identity is guaranteed consistent with what's on disk (see that class' own doc comment for the exact
/// race this closes).
/// </summary>
public sealed class DeviceIdentityProviderTests : IDisposable
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
        var dir = Directory.CreateTempSubdirectory("st4i-device-identity-provider-tests-").FullName;
        _tempDirs.Add(dir);
        return dir;
    }

    [Fact]
    public void Current_BeforeAnyRotate_IsTheConstructedIdentity()
    {
        var store = new DeviceIdentityStore(NewTempDir());
        var identity = store.LoadOrCreate("NODE-PROVIDER-1");
        var provider = new DeviceIdentityProvider(store, identity);

        Assert.Equal(identity.Fingerprint, provider.Current.Fingerprint);
    }

    [Fact]
    public void Rotate_ReturnsADifferentIdentity_AndCurrentReflectsIt()
    {
        var store = new DeviceIdentityStore(NewTempDir());
        var identity = store.LoadOrCreate("NODE-PROVIDER-2");
        var provider = new DeviceIdentityProvider(store, identity);

        var rotated = provider.Rotate();

        Assert.NotEqual(identity.Fingerprint, rotated.Fingerprint);
        Assert.Equal(rotated.Fingerprint, provider.Current.Fingerprint);
        Assert.NotEqual(identity.Fingerprint, provider.Current.Fingerprint);
    }

    [Fact]
    public void Rotate_PreservesTheNodeId_AcrossTheSwap()
    {
        var store = new DeviceIdentityStore(NewTempDir());
        store.LoadOrCreate("NODE-PROVIDER-3");
        var identity = store.TryLoad()!;
        var provider = new DeviceIdentityProvider(store, identity);

        var rotated = provider.Rotate();

        Assert.Equal("NODE-PROVIDER-3", rotated.NodeId);
        Assert.Equal("NODE-PROVIDER-3", provider.Current.NodeId);
    }

    [Fact]
    public void Rotate_PersistsToDisk_AFreshStoreInstanceSeesTheRotatedIdentity()
    {
        var dir = NewTempDir();
        var store = new DeviceIdentityStore(dir);
        var identity = store.LoadOrCreate("NODE-PROVIDER-4");
        var provider = new DeviceIdentityProvider(store, identity);

        var rotated = provider.Rotate();

        var reloaded = new DeviceIdentityStore(dir).TryLoad();
        Assert.NotNull(reloaded);
        Assert.Equal(rotated.Fingerprint, reloaded!.Fingerprint);
    }

    // Thread-safety smoke test — a reader spinning on Current while ONE Rotate() is in flight on another
    // thread must never observe a torn/partial identity (never throws, every read is a complete, valid
    // DeviceIdentity) — proving the lock actually protects the swap (and, since fix round 1, that holding
    // it across the WHOLE Rotate() body doesn't introduce a deadlock or torn read either).
    [Fact]
    public async Task Current_ReadConcurrentlyDuringASingleRotate_NeverTornNeverThrows()
    {
        var store = new DeviceIdentityStore(NewTempDir());
        var identity = store.LoadOrCreate("NODE-PROVIDER-5");
        var provider = new DeviceIdentityProvider(store, identity);

        using var cts = new CancellationTokenSource();
        var readerTask = Task.Run(() =>
        {
            while (!cts.IsCancellationRequested)
            {
                var current = provider.Current;
                Assert.False(string.IsNullOrWhiteSpace(current.Fingerprint));
                Assert.NotNull(current.Certificate);
            }
        });

        var rotated = provider.Rotate();
        cts.Cancel();
        await readerTask;

        Assert.Equal(rotated.Fingerprint, provider.Current.Fingerprint);
    }

    // GĐ3 closeout WI-4 fix round 1 (Important #3 / concurrency Minor) — the regression test for the exact
    // race the review caught: BEFORE this fix, Rotate() only held its lock around the final in-memory swap,
    // so two concurrent Rotate() calls could both read the SAME pre-rotation NodeId, then race
    // DeviceIdentityStore.Rotate's own file replace against each other on the real file system — genuinely
    // throwing (UnauthorizedAccessException from a concurrent File.Move) under load. Now that Rotate() holds
    // its lock across the ENTIRE mint+persist+swap, concurrent calls are fully serialized: this must
    // complete with NO exceptions, and — because each call's own return value is exactly what it wrote to
    // Current — whichever call's result matches the FINAL Current is guaranteed to actually be in that set.
    [Fact]
    public async Task Rotate_CalledConcurrently_IsFullySerialized_NeverThrows_AndCurrentIsConsistent()
    {
        var store = new DeviceIdentityStore(NewTempDir());
        var identity = store.LoadOrCreate("NODE-PROVIDER-6");
        var provider = new DeviceIdentityProvider(store, identity);

        var tasks = Enumerable.Range(0, 6).Select(_ => Task.Run(() => provider.Rotate())).ToArray();
        var results = await Task.WhenAll(tasks);

        Assert.All(results, r => Assert.False(string.IsNullOrWhiteSpace(r.Fingerprint)));
        // All 6 rotations actually ran (no silently-skipped/duplicated call) — 6 distinct fingerprints.
        Assert.Equal(6, results.Select(r => r.Fingerprint).Distinct().Count());
        Assert.Contains(results, r => r.Fingerprint == provider.Current.Fingerprint);

        // What's on disk afterward matches Current exactly — no lost-update window at all.
        var reloaded = new DeviceIdentityStore(store.RootDirectory).TryLoad();
        Assert.NotNull(reloaded);
        Assert.Equal(provider.Current.Fingerprint, reloaded!.Fingerprint);
    }
}
