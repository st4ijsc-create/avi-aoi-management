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

    private DeviceIdentityProvider NewIdentityProvider()
    {
        var store = new DeviceIdentityStore(NewTempDir());
        var identity = store.LoadOrCreate("NODE-MANAGER-TEST");
        return new DeviceIdentityProvider(store, identity);
    }

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
        var identityProvider = NewIdentityProvider();
        var store = new SiteLinkStore(NewTempDir());
        await using var manager = new SiteBridgeManager(new UnsOptions(), identityProvider, store);

        await manager.ApplyAsync(EnabledLink());

        Assert.NotEqual(BridgeState.Disabled, manager.Status().State);
    }

    [Fact]
    public async Task ApplyAsync_DisabledLink_StopsTheBridge_StatusIsDisabled()
    {
        var identityProvider = NewIdentityProvider();
        var store = new SiteLinkStore(NewTempDir());
        await using var manager = new SiteBridgeManager(new UnsOptions(), identityProvider, store);
        await manager.ApplyAsync(EnabledLink());
        Assert.NotEqual(BridgeState.Disabled, manager.Status().State);

        await manager.ApplyAsync(new PersistedSiteLink()); // Enabled = false (default)

        Assert.Equal(BridgeState.Disabled, manager.Status().State);
    }

    [Fact]
    public async Task ApplyAsync_DefaultConstructedManager_StartsWithStatusDisabled()
    {
        var identityProvider = NewIdentityProvider();
        var store = new SiteLinkStore(NewTempDir());
        await using var manager = new SiteBridgeManager(new UnsOptions(), identityProvider, store);

        Assert.Equal(BridgeState.Disabled, manager.Status().State);
        Assert.False(manager.Current.Enabled);
    }

    [Fact]
    public async Task ApplyAsync_SetsCurrent_ToTheAppliedLink()
    {
        var identityProvider = NewIdentityProvider();
        var store = new SiteLinkStore(NewTempDir());
        await using var manager = new SiteBridgeManager(new UnsOptions(), identityProvider, store);
        var link = EnabledLink();

        await manager.ApplyAsync(link);

        Assert.Equal(link.Host, manager.Current.Host);
        Assert.Equal(link.Port, manager.Current.Port);
        Assert.True(manager.Current.Enabled);
    }

    [Fact]
    public async Task ApplyAsync_Persists_ANewManagerReadingTheSameStoreSeesTheAppliedLink()
    {
        var identityProvider = NewIdentityProvider();
        var storeDir = NewTempDir();
        var link = EnabledLink();

        await using (var manager1 = new SiteBridgeManager(new UnsOptions(), identityProvider, new SiteLinkStore(storeDir)))
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

        await using var manager2 = new SiteBridgeManager(new UnsOptions(), identityProvider, reopenedStore);
        await manager2.ApplyAsync(persisted);

        Assert.NotEqual(BridgeState.Disabled, manager2.Status().State);
        Assert.Equal(link.Host, manager2.Current.Host);
    }

    [Fact]
    public async Task ApplyAsync_TwiceWithEnabledLinks_TheOldBridgeIsStoppedBeforeTheNewOneStarts()
    {
        var identityProvider = NewIdentityProvider();
        var store = new SiteLinkStore(NewTempDir());
        await using var manager = new SiteBridgeManager(new UnsOptions(), identityProvider, store);

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
        var identityProvider = NewIdentityProvider();
        var store = new SiteLinkStore(NewTempDir());
        var manager = new SiteBridgeManager(new UnsOptions(), identityProvider, store);
        await manager.ApplyAsync(EnabledLink());

        await manager.DisposeAsync();
        var exception = await Record.ExceptionAsync(() => manager.DisposeAsync().AsTask());

        Assert.Null(exception);
        Assert.Equal(BridgeState.Disabled, manager.Status().State);
    }

    [Fact]
    public async Task ApplyAsync_AfterDispose_DoesNotThrow_AndDoesNotResurrectABridge()
    {
        var identityProvider = NewIdentityProvider();
        var store = new SiteLinkStore(NewTempDir());
        var manager = new SiteBridgeManager(new UnsOptions(), identityProvider, store);
        await manager.DisposeAsync();

        var exception = await Record.ExceptionAsync(() => manager.ApplyAsync(EnabledLink()));

        Assert.Null(exception);
        Assert.Equal(BridgeState.Disabled, manager.Status().State);
    }

    // ─────────────────────────────────────────────────────────────────────
    // GĐ3 closeout WI-3 — the spool this manager is constructed with must actually reach the UnsBridge it
    // builds (not just be stored and ignored) — proven here indirectly through Status().SpoolDepth, since
    // that field is sourced from the LIVE bridge's own forward loop, not from the manager itself.
    // ─────────────────────────────────────────────────────────────────────

    [Fact]
    public async Task ApplyAsync_PassesTheSpoolThroughToTheBridge_StatusReportsItsDepth()
    {
        var identityProvider = NewIdentityProvider();
        var store = new SiteLinkStore(NewTempDir());
        var spool = new FakeBridgeSpool();
        await spool.EnqueueAsync("t/manager-wiring", new byte[] { 1 }, retain: false);

        await using var manager = new SiteBridgeManager(new UnsOptions(), identityProvider, store, spool: spool);
        await manager.ApplyAsync(EnabledLink());

        await WaitUntilAsync(() => manager.Status().SpoolDepth > 0,
            "the manager-supplied spool's depth to surface through the live bridge's own Status()");
    }

    // ─────────────────────────────────────────────────────────────────────
    // GĐ3 closeout WI-4 — DeviceIdentityProvider.Rotate() must actually re-key the LIVE bridge, not just
    // update an in-memory pointer nobody reads. Status().DeviceFingerprint is UnsBridge's own echo of
    // whatever certificate/fingerprint it was constructed with (see BridgeStatusSnapshot/UnsBridge's own
    // doc comments) — a cheap, reliable proxy for "which certificate is this bridge presenting" that
    // doesn't require a real mTLS handshake to observe.
    // ─────────────────────────────────────────────────────────────────────

    [Fact]
    public async Task ProviderRotate_Alone_DoesNotChangeTheAlreadyRunningBridge_UntilReapplyCurrentAsync()
    {
        var identityProvider = NewIdentityProvider();
        var originalFingerprint = identityProvider.Current.Fingerprint;
        var store = new SiteLinkStore(NewTempDir());
        await using var manager = new SiteBridgeManager(new UnsOptions(), identityProvider, store);

        await manager.ApplyAsync(EnabledLink());
        Assert.Equal(originalFingerprint, manager.Status().DeviceFingerprint);

        var rotated = identityProvider.Rotate();
        Assert.NotEqual(originalFingerprint, rotated.Fingerprint);

        // The provider itself already reports the new identity...
        Assert.Equal(rotated.Fingerprint, identityProvider.Current.Fingerprint);

        // ...but the ALREADY-RUNNING bridge, built before the rotation, still presents the OLD one — this
        // is exactly the trap DeviceIdentityProvider's own doc comment warns about: swapping Current alone
        // does nothing to a live bridge.
        Assert.Equal(originalFingerprint, manager.Status().DeviceFingerprint);

        await manager.ReapplyCurrentAsync();

        // Re-applying the SAME (unchanged) link tears down and rebuilds the bridge, which now reads the
        // provider's (rotated) Current — the bridge presents the NEW certificate, not the old one.
        Assert.Equal(rotated.Fingerprint, manager.Status().DeviceFingerprint);
        Assert.NotEqual(originalFingerprint, manager.Status().DeviceFingerprint);
    }

    // ─────────────────────────────────────────────────────────────────────
    // 🔴 TASK Z-1 — item 8 of docs/owner-decisions.md, decided 2026-08-18 (coordinator, under
    // delegation): BLOCK the write, same law as items 1 and 5, at the THIRD caller of ApplyAsync.
    //
    // Q-1's fix round closed the STARTUP route to the unconditional Save — Program.cs simply does not
    // call ApplyAsync when site-link.json is Unreadable — and NAMED this one as still open:
    // ReapplyCurrentAsync, reachable from POST /v1/site/identity/rotate, re-applies `Current`, which on
    // that arm is the record the PROCESS invented and never read from disk. So a rotation overwrote the
    // operator's unreadable bytes: Site broker host, port and pinned trust anchor, gone, in a request
    // that succeeded and logged nothing.
    // ─────────────────────────────────────────────────────────────────────

    /// <summary>🔴 <b>The measurement item 8 is about.</b> The file is unreadable, so nothing ever loaded
    /// it and <c>Current</c> is the field initialiser. A rotation used to persist that invented record
    /// straight over the operator's bytes.</summary>
    [Fact]
    public async Task ReapplyCurrentAsync_WithAnUnreadableSiteLinkFile_LeavesEveryByteWhereItWas()
    {
        var identityProvider = NewIdentityProvider();
        var dir = NewTempDir();
        var path = Path.Combine(dir, "site-link.json");
        var operatorBytes = "{ \"host\": \"site.example.internal\", \"port\": 8883, trustPem: broken ]";
        File.WriteAllText(path, operatorBytes);

        // Premise: this is the arm Program.cs refuses to apply on, so nothing has been read into the
        // manager and Current is the default record — the one the process invented.
        var store = new SiteLinkStore(dir);
        Assert.Equal(SiteLinkReadStatus.Unreadable, store.Read().Status);
        await using var manager = new SiteBridgeManager(new UnsOptions(), identityProvider, store);
        Assert.False(manager.Current.Enabled);

        // Exactly what POST /v1/site/identity/rotate does after the identity is rotated.
        identityProvider.Rotate();
        await manager.ReapplyCurrentAsync();

        Assert.Equal(operatorBytes, File.ReadAllText(path));

        // …and nothing was left beside it either: the store's atomic write creates a temp file in the
        // same directory, and it was never reached.
        Assert.Equal(new[] { "site-link.json" },
            Directory.GetFiles(dir).Select(Path.GetFileName).OrderBy(f => f, StringComparer.Ordinal).ToArray());
    }

    /// <summary>🔴 <b>The half that says the guarantee is STRUCTURAL rather than conditional.</b> The fix
    /// is not "do not persist when the file is unreadable" — this method establishes no value of its own
    /// on ANY arm, so it never persists at all. Here the file reads perfectly and has been changed under
    /// the manager; a re-apply must still leave it exactly as found, because a re-apply is not a request
    /// to write anything.
    ///
    /// <para>Without this, the fix would be one flag away from silently reverting the day some future
    /// arm forgot to set it.</para></summary>
    [Fact]
    public async Task ReapplyCurrentAsync_DoesNotPersist_EvenWhenTheFileReadsPerfectly()
    {
        var identityProvider = NewIdentityProvider();
        var dir = NewTempDir();
        var path = Path.Combine(dir, "site-link.json");
        var store = new SiteLinkStore(dir);
        await using var manager = new SiteBridgeManager(new UnsOptions(), identityProvider, store);

        // ApplyAsync — the operator-driven path — still persists. That is the contract this task did not
        // touch, and it is the premise of the assertion below.
        await manager.ApplyAsync(EnabledLink());
        Assert.Contains("18999", File.ReadAllText(path), StringComparison.Ordinal);

        // Somebody edits the file by hand, correctly. It is now different from what the manager holds.
        var handWritten = "{\n  \"Enabled\": false,\n  \"Host\": \"edited-by-hand\",\n  \"Port\": 1883,\n  \"SiteTrustPem\": \"\"\n}";
        File.WriteAllText(path, handWritten);

        await manager.ReapplyCurrentAsync();

        Assert.Equal(handWritten, File.ReadAllText(path));
        Assert.Equal(new[] { "site-link.json" },
            Directory.GetFiles(dir).Select(Path.GetFileName).OrderBy(f => f, StringComparer.Ordinal).ToArray());

        // And the re-apply did the thing it exists to do: the bridge is still the one Current describes,
        // not the hand-written link, because nothing re-read the file either.
        Assert.NotEqual(BridgeState.Disabled, manager.Status().State);
        Assert.Equal("127.0.0.1", manager.Current.Host);
    }

    [Fact]
    public async Task ReapplyCurrentAsync_WithNoBridgeRunning_IsANoOp_StatusStaysDisabled()
    {
        var identityProvider = NewIdentityProvider();
        var store = new SiteLinkStore(NewTempDir());
        await using var manager = new SiteBridgeManager(new UnsOptions(), identityProvider, store);

        var exception = await Record.ExceptionAsync(() => manager.ReapplyCurrentAsync());

        Assert.Null(exception);
        Assert.Equal(BridgeState.Disabled, manager.Status().State);
    }

    private static async Task WaitUntilAsync(Func<bool> predicate, string because)
    {
        var deadline = DateTime.UtcNow + TimeSpan.FromSeconds(10);
        while (DateTime.UtcNow < deadline)
        {
            if (predicate()) return;
            await Task.Delay(TimeSpan.FromMilliseconds(50));
        }

        Assert.True(predicate(), $"timed out waiting for: {because}");
    }
}
