using St4i.EdgeCore.Identity;
using St4i.EdgeCore.Site;
using St4i.EdgeCore.Uns;
using Xunit;

namespace St4i.EdgeCore.Tests.Site;

/// <summary>
/// GĐ3 EC-2 — <see cref="SiteBridgeManager"/>: the lifecycle seam EC-3's <c>PUT /v1/site</c> will drive.
/// <see cref="SiteBridgeManager.ApplyAsync"/> with an enabled link starts a bridge (status leaves
/// <see cref="BridgeState.Disabled"/>); applying a disabled link stops it (status returns to
/// <see cref="BridgeState.Disabled"/>); the applied link survives a simulated restart (a brand-new manager
/// reading the SAME <see cref="SiteLinkStore"/> directory sees it); disposal is clean and idempotent.
///
/// Deliberately does NOT stand up real local/Site brokers — <c>UnsBridgeTests</c> already proves the full
/// mTLS forwarding path; these tests only need to observe the MANAGER's own state-machine contract
/// (bridge constructed vs. not, persisted vs. not), which holds regardless of whether the bridge's own
/// background connect loops ever succeed against anything real.
/// </summary>
[Collection("St4i.EdgeCore.Tests.Site")]
public sealed class SiteBridgeManagerTests : IDisposable
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
        var dir = Directory.CreateTempSubdirectory("st4i-sitebridgemanager-tests-").FullName;
        _tempDirs.Add(dir);
        return dir;
    }

    private DeviceIdentity NewIdentity() => new DeviceIdentityStore(NewTempDir()).LoadOrCreate("NODE-MANAGER-TEST");

    private static PersistedSiteLink EnabledLink() => new()
    {
        Enabled = true,
        Host = "127.0.0.1",
        Port = 18999, // nothing needs to actually be listening here — see this class's own doc comment
        SiteTrustPem = "-----BEGIN CERTIFICATE-----\nFAKE\n-----END CERTIFICATE-----",
    };

    [Fact]
    public async Task ApplyAsync_EnabledLink_StartsABridge_StatusIsNotDisabled()
    {
        var identity = NewIdentity();
        var store = new SiteLinkStore(NewTempDir());
        await using var manager = new SiteBridgeManager(new UnsOptions(), identity, store);

        await manager.ApplyAsync(EnabledLink());

        Assert.NotEqual(BridgeState.Disabled, manager.Status().State);
    }

    [Fact]
    public async Task ApplyAsync_DisabledLink_StopsTheBridge_StatusIsDisabled()
    {
        var identity = NewIdentity();
        var store = new SiteLinkStore(NewTempDir());
        await using var manager = new SiteBridgeManager(new UnsOptions(), identity, store);
        await manager.ApplyAsync(EnabledLink());
        Assert.NotEqual(BridgeState.Disabled, manager.Status().State);

        await manager.ApplyAsync(new PersistedSiteLink()); // Enabled = false (default)

        Assert.Equal(BridgeState.Disabled, manager.Status().State);
    }

    [Fact]
    public async Task ApplyAsync_DefaultConstructedManager_StartsWithStatusDisabled()
    {
        var identity = NewIdentity();
        var store = new SiteLinkStore(NewTempDir());
        await using var manager = new SiteBridgeManager(new UnsOptions(), identity, store);

        Assert.Equal(BridgeState.Disabled, manager.Status().State);
        Assert.False(manager.Current.Enabled);
    }

    [Fact]
    public async Task ApplyAsync_SetsCurrent_ToTheAppliedLink()
    {
        var identity = NewIdentity();
        var store = new SiteLinkStore(NewTempDir());
        await using var manager = new SiteBridgeManager(new UnsOptions(), identity, store);
        var link = EnabledLink();

        await manager.ApplyAsync(link);

        Assert.Equal(link.Host, manager.Current.Host);
        Assert.Equal(link.Port, manager.Current.Port);
        Assert.True(manager.Current.Enabled);
    }

    [Fact]
    public async Task ApplyAsync_Persists_ANewManagerReadingTheSameStoreSeesTheAppliedLink()
    {
        var identity = NewIdentity();
        var storeDir = NewTempDir();
        var link = EnabledLink();

        await using (var manager1 = new SiteBridgeManager(new UnsOptions(), identity, new SiteLinkStore(storeDir)))
        {
            await manager1.ApplyAsync(link);
        }

        // Simulates a process restart: a brand-new manager + store instance pointed at the SAME directory.
        var reopenedStore = new SiteLinkStore(storeDir);
        var persisted = reopenedStore.Load();
        Assert.NotNull(persisted);
        Assert.True(persisted!.Enabled);
        Assert.Equal(link.Host, persisted.Host);
        Assert.Equal(link.Port, persisted.Port);

        await using var manager2 = new SiteBridgeManager(new UnsOptions(), identity, reopenedStore);
        await manager2.ApplyAsync(persisted);

        Assert.NotEqual(BridgeState.Disabled, manager2.Status().State);
        Assert.Equal(link.Host, manager2.Current.Host);
    }

    [Fact]
    public async Task ApplyAsync_TwiceWithEnabledLinks_TheOldBridgeIsStoppedBeforeTheNewOneStarts()
    {
        var identity = NewIdentity();
        var store = new SiteLinkStore(NewTempDir());
        await using var manager = new SiteBridgeManager(new UnsOptions(), identity, store);

        await manager.ApplyAsync(EnabledLink());
        var firstStatus = manager.Status();
        Assert.NotEqual(BridgeState.Disabled, firstStatus.State);

        var secondLink = EnabledLink() with { Host = "127.0.0.1", Port = 19000 };
        var exception = await Record.ExceptionAsync(() => manager.ApplyAsync(secondLink));

        Assert.Null(exception);
        Assert.Equal(secondLink.Port, manager.Current.Port);
        Assert.NotEqual(BridgeState.Disabled, manager.Status().State);
    }

    [Fact]
    public async Task DisposeAsync_IsIdempotent_AndLeavesStatusDisabled()
    {
        var identity = NewIdentity();
        var store = new SiteLinkStore(NewTempDir());
        var manager = new SiteBridgeManager(new UnsOptions(), identity, store);
        await manager.ApplyAsync(EnabledLink());

        await manager.DisposeAsync();
        var exception = await Record.ExceptionAsync(() => manager.DisposeAsync().AsTask());

        Assert.Null(exception);
        Assert.Equal(BridgeState.Disabled, manager.Status().State);
    }

    [Fact]
    public async Task ApplyAsync_AfterDispose_DoesNotThrow_AndDoesNotResurrectABridge()
    {
        var identity = NewIdentity();
        var store = new SiteLinkStore(NewTempDir());
        var manager = new SiteBridgeManager(new UnsOptions(), identity, store);
        await manager.DisposeAsync();

        var exception = await Record.ExceptionAsync(() => manager.ApplyAsync(EnabledLink()));

        Assert.Null(exception);
        Assert.Equal(BridgeState.Disabled, manager.Status().State);
    }
}
