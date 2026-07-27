using System.Text;
using System.Text.Json;
using Microsoft.Data.Sqlite;
using MQTTnet;
using St4i.EdgeCore.Site;
using St4i.EdgeCore.Uns;
using Xunit;

namespace St4i.EdgeCore.Tests.Site;

/// <summary>
/// GĐ3 closeout WI-3 — <see cref="UnsBridge"/> wired to WI-2's durable <see cref="IBridgeSpool"/>: the
/// payoff task. A Site outage must back data up on disk instead of silently dropping it (the pre-WI-3 bug at
/// <c>UnsBridge.cs:255-257</c>, now the <c>spool is null</c> legacy branch — see
/// <see cref="SpoolDisabled_NullSpool_ItemDuringOutage_IsGenuinelyDropped_LegacyBehaviorUnchanged"/>), replay
/// in order on reconnect, tell the Site exactly how big the gap was via a retained resync record BEFORE the
/// backfill lands, and survive a process restart.
///
/// Reuses the SAME real-MQTTnet harness <c>UnsBridgeTests</c> already established (<see cref="BridgeTestNet"/>,
/// <see cref="CapturingSiteBroker"/>, <see cref="TestCertificates"/>) for everything connectivity-related —
/// no mocked <c>IMqttClient</c>. The spool collaborator itself is a hand-rolled <see cref="FakeBridgeSpool"/>
/// (same idiom as <c>HistorianWriterTests.FakeHistorianStore</c>) for every test EXCEPT the restart-durability
/// one, which needs a REAL <see cref="BridgeSpool"/> over an actual temp directory — genuine cross-instance
/// persistence is the entire point there.
///
/// <c>ST4I_BRIDGE_SPOOL_DIR</c> is isolated to a fresh temp directory around every test that could reach the
/// real <see cref="BridgeSpool"/> default root (only the restart-durability test constructs a real one, but
/// every test isolates the env var defensively — see this project's own recurring test-pollution lesson,
/// documented in this task's brief).
/// </summary>
[Collection("St4i.EdgeCore.Tests.Site")]
public sealed class UnsBridgeSpoolTests : IAsyncLifetime
{
    private readonly List<IAsyncDisposable> _disposables = new();
    private readonly List<string> _tempDirs = new();
    private string? _previousSpoolDir;

    public Task InitializeAsync()
    {
        _previousSpoolDir = Environment.GetEnvironmentVariable(BridgeSpool.EnvVarDir);
        Environment.SetEnvironmentVariable(BridgeSpool.EnvVarDir, NewTempDir());
        return Task.CompletedTask;
    }

    public async Task DisposeAsync()
    {
        Environment.SetEnvironmentVariable(BridgeSpool.EnvVarDir, _previousSpoolDir);

        foreach (var disposable in _disposables)
        {
            try { await disposable.DisposeAsync(); } catch { /* best-effort cleanup */ }
        }

        SqliteConnection.ClearAllPools();

        foreach (var dir in _tempDirs)
        {
            try { Directory.Delete(dir, recursive: true); } catch { /* best-effort cleanup */ }
        }
    }

    private T Track<T>(T disposable) where T : IAsyncDisposable
    {
        _disposables.Add(disposable);
        return disposable;
    }

    private string NewTempDir()
    {
        var dir = Directory.CreateTempSubdirectory("st4i-unsbridge-spool-tests-").FullName;
        _tempDirs.Add(dir);
        return dir;
    }

    private static int GetFreePort() => BridgeTestNet.GetFreePort();

    private static Task WaitUntilAsync(Func<bool> predicate, string because) =>
        BridgeTestNet.WaitUntilAsync(predicate, because);

    private static PersistedSiteLink BuildEnabledLink(int sitePort, string siteTrustPem) => new()
    {
        Enabled = true,
        Host = "127.0.0.1",
        Port = sitePort,
        SiteTrustPem = siteTrustPem,
    };

    private static async Task<IMqttClient> ConnectLocalPublisherAsync(int localPort)
    {
        var factory = new MqttClientFactory();
        var client = factory.CreateMqttClient();
        await client.ConnectAsync(new MqttClientOptionsBuilder().WithTcpServer("127.0.0.1", localPort).Build());
        return client;
    }

    // ─────────────────────────────────────────────────────────────────────
    // 1. Disconnected ⇒ items are NOT lost; they land in the spool.
    // ─────────────────────────────────────────────────────────────────────

    [Fact]
    public async Task Disconnected_ItemsAreNotLost_TheyLandInTheSpool()
    {
        using var deviceCert = TestCertificates.Persist(TestCertificates.CreateSelfSignedLeaf("wi3-disconnected"));

        var localPort = GetFreePort();
        var localUns = new UnsOptions { BrokerPort = localPort };
        await using var localBroker = Track(new UnsBroker(localPort));
        await localBroker.StartAsync();

        // Nothing listens on this port — the remote client will keep retrying (with backoff) and failing.
        var unreachableSitePort = GetFreePort();
        var siteLink = BuildEnabledLink(unreachableSitePort, "-----BEGIN CERTIFICATE-----\nFAKE\n-----END CERTIFICATE-----");

        var spool = new FakeBridgeSpool();
        await using var bridge = Track(new UnsBridge(localUns, siteLink, deviceCert, "FP-DISCONNECTED", spool: spool));

        using var localPublisher = await ConnectLocalPublisherAsync(localPort);
        const string topic = "syn/wi3/disconnected/probe";
        var payload = Encoding.UTF8.GetBytes("must-not-be-lost");

        await BridgeTestNet.PublishUntilObservedAsync(
            localPublisher, topic, payload,
            () => spool.Snapshot().Any(i => i.Topic == topic),
            "the message published while the Site is unreachable to land in the spool instead of being dropped");

        var item = spool.Snapshot().Single(i => i.Topic == topic);
        Assert.Equal(payload, item.Payload);
        Assert.True(item.Retain, "syn/ topics keep the pre-existing retain=true rule even through the spool path");
        Assert.NotEqual(BridgeState.Connected, bridge.Snapshot().State);

        await localPublisher.DisconnectAsync();
    }

    // ─────────────────────────────────────────────────────────────────────
    // 2. Reconnect ⇒ replay in ascending seq order, backlog BEFORE newly-arriving items.
    // ─────────────────────────────────────────────────────────────────────

    [Fact]
    public async Task Reconnect_ReplaysBacklogInAscendingSeqOrder_BeforeNewlyArrivingItems()
    {
        using var siteCa = TestCertificates.CreateCa("Test Site CA WI3-2");
        using var siteServerCertEphemeral = TestCertificates.CreateLeaf("127.0.0.1", siteCa);
        using var siteServerCert = TestCertificates.Persist(siteServerCertEphemeral);
        using var deviceCert = TestCertificates.Persist(TestCertificates.CreateSelfSignedLeaf("wi3-reconnect"));

        var localPort = GetFreePort();
        var localUns = new UnsOptions { BrokerPort = localPort };
        await using var localBroker = Track(new UnsBroker(localPort));
        await localBroker.StartAsync();

        var spool = new FakeBridgeSpool();
        // Pre-seed a backlog BEFORE the Site broker (and therefore the bridge's remote connection) exists —
        // simulates "these accumulated during a prior outage".
        var seq1 = await spool.EnqueueAsync("t/backlog/1", new byte[] { 1 }, retain: false);
        var seq2 = await spool.EnqueueAsync("t/backlog/2", new byte[] { 2 }, retain: false);
        var seq3 = await spool.EnqueueAsync("t/backlog/3", new byte[] { 3 }, retain: false);
        Assert.True(seq1 < seq2 && seq2 < seq3);

        await using var siteBroker = Track(await CapturingSiteBroker.StartAsync(siteServerCert));
        var siteLink = BuildEnabledLink(siteBroker.Port, siteCa.ExportCertificatePem());
        await using var bridge = Track(new UnsBridge(localUns, siteLink, deviceCert, "FP-RECONNECT", spool: spool));

        await WaitUntilAsync(() => siteBroker.ReceivedMessages.ContainsKey("t/backlog/3"),
            "all three backlog items to have been replayed to the Site broker");

        // Ascending seq order: the FIRST three topics the broker ever saw (arrival order, not just presence)
        // must be exactly backlog 1, 2, 3, in that order.
        var order = siteBroker.ReceivedOrder.ToArray();
        var backlogIndex1 = Array.IndexOf(order, "t/backlog/1");
        var backlogIndex2 = Array.IndexOf(order, "t/backlog/2");
        var backlogIndex3 = Array.IndexOf(order, "t/backlog/3");
        Assert.True(backlogIndex1 >= 0 && backlogIndex1 < backlogIndex2, "backlog/1 must arrive before backlog/2");
        Assert.True(backlogIndex2 < backlogIndex3, "backlog/2 must arrive before backlog/3");

        // A NEW item published locally only AFTER the backlog has fully drained must arrive strictly after it.
        using var localPublisher = await ConnectLocalPublisherAsync(localPort);
        const string newTopic = "syn/wi3/reconnect/new-item";
        await BridgeTestNet.PublishUntilObservedAsync(
            localPublisher, newTopic, new byte[] { 9 },
            () => siteBroker.ReceivedMessages.ContainsKey(newTopic),
            "the newly-published item to arrive at the Site broker");

        var newItemIndex = Array.IndexOf(siteBroker.ReceivedOrder.ToArray(), newTopic);
        Assert.True(newItemIndex > backlogIndex3, "the new item must arrive strictly AFTER the full backlog replay");

        await localPublisher.DisconnectAsync();
    }

    // ─────────────────────────────────────────────────────────────────────
    // 3. Publish fails mid-batch ⇒ only the successful prefix is acked; the remainder is republished on the
    //    next pass — no loss, no duplication beyond at-least-once.
    // ─────────────────────────────────────────────────────────────────────

    [Fact]
    public async Task PublishFailsMidBatch_OnlySuccessfulPrefixIsAcked_RemainderRepublishedOnNextPass()
    {
        using var siteCa = TestCertificates.CreateCa("Test Site CA WI3-3");
        using var siteServerCertEphemeral = TestCertificates.CreateLeaf("127.0.0.1", siteCa);
        using var siteServerCert = TestCertificates.Persist(siteServerCertEphemeral);
        using var deviceCert = TestCertificates.Persist(TestCertificates.CreateSelfSignedLeaf("wi3-midbatch"));

        var localPort = GetFreePort();
        var localUns = new UnsOptions { BrokerPort = localPort };
        await using var localBroker = Track(new UnsBroker(localPort));
        await localBroker.StartAsync();

        var spool = new FakeBridgeSpool();
        var seq1 = await spool.EnqueueAsync("t/mid/1", new byte[] { 1 }, retain: false);
        var seq2 = await spool.EnqueueAsync("t/mid/2-poison", new byte[] { 2 }, retain: false);
        var seq3 = await spool.EnqueueAsync("t/mid/3", new byte[] { 3 }, retain: false);

        await using var siteBroker = Track(await CapturingSiteBroker.StartAsync(siteServerCert));
        siteBroker.PoisonTopics["t/mid/2-poison"] = 0;

        var siteLink = BuildEnabledLink(siteBroker.Port, siteCa.ExportCertificatePem());
        await using var bridge = Track(new UnsBridge(localUns, siteLink, deviceCert, "FP-MIDBATCH", spool: spool));

        // Wait for the batch to have been attempted: item 1 succeeded, item 2 was rejected — the broker still
        // SEES item 2 (it reached the wire), but item 3 must never even be attempted this pass.
        await WaitUntilAsync(() => siteBroker.ReceivedMessages.ContainsKey("t/mid/2-poison"),
            "the poisoned item to have been attempted (and rejected) by the Site broker");
        await Task.Delay(TimeSpan.FromMilliseconds(300)); // settle window — item 3 must still not show up.

        Assert.False(siteBroker.ReceivedMessages.ContainsKey("t/mid/3"),
            "the item AFTER the poisoned one must not be attempted until the poisoned one succeeds");
        Assert.Contains(seq1, spool.AckCalls);
        Assert.DoesNotContain(seq2, spool.AckCalls);
        Assert.DoesNotContain(seq3, spool.AckCalls);
        Assert.Contains(spool.Snapshot(), i => i.Seq == seq2);
        Assert.Contains(spool.Snapshot(), i => i.Seq == seq3);

        // Un-poison — the NEXT pass must deliver both the previously-rejected item and the one after it.
        siteBroker.PoisonTopics.TryRemove("t/mid/2-poison", out _);

        await WaitUntilAsync(() => siteBroker.ReceivedMessages.ContainsKey("t/mid/3"),
            "the remainder to be republished and delivered once the Site broker stops rejecting");
        await WaitUntilAsync(() => spool.Snapshot().Count == 0, "the spool to fully drain once everything succeeds");

        // No duplication beyond at-least-once: item 1 (never poisoned) must have been published exactly once.
        Assert.Equal(1, siteBroker.ReceivedOrder.Count(t => t == "t/mid/1"));
    }

    // ─────────────────────────────────────────────────────────────────────
    // 4. Resync record: retained, published BEFORE the replay, droppedTotal matches what the spool reports.
    // ─────────────────────────────────────────────────────────────────────

    [Fact]
    public async Task ResyncRecord_PublishedRetained_BeforeReplay_WithCorrectDroppedTotal()
    {
        using var siteCa = TestCertificates.CreateCa("Test Site CA WI3-4");
        using var siteServerCertEphemeral = TestCertificates.CreateLeaf("127.0.0.1", siteCa);
        using var siteServerCert = TestCertificates.Persist(siteServerCertEphemeral);
        using var deviceCert = TestCertificates.Persist(TestCertificates.CreateSelfSignedLeaf("wi3-resync"));

        var localPort = GetFreePort();
        var localUns = new UnsOptions { BrokerPort = localPort };
        await using var localBroker = Track(new UnsBroker(localPort));
        await localBroker.StartAsync();

        var spool = new FakeBridgeSpool { DroppedTotal = 7 };
        var seq1 = await spool.EnqueueAsync("t/resync/1", new byte[] { 1 }, retain: false);
        await spool.EnqueueAsync("t/resync/2", new byte[] { 2 }, retain: false);

        await using var siteBroker = Track(await CapturingSiteBroker.StartAsync(siteServerCert));
        var siteLink = BuildEnabledLink(siteBroker.Port, siteCa.ExportCertificatePem());
        await using var bridge = Track(new UnsBridge(localUns, siteLink, deviceCert, "FP-RESYNC", spool: spool));

        var resyncTopic = UnsTopicBuilder.BuildBridgeResyncTopic(localUns);
        await WaitUntilAsync(() => siteBroker.ReceivedMessages.ContainsKey(resyncTopic),
            "the retained resync record to be published after the reconnect");
        await WaitUntilAsync(() => siteBroker.ReceivedMessages.ContainsKey("t/resync/2"),
            "the backlog to have fully replayed");

        var (payload, retain) = siteBroker.ReceivedMessages[resyncTopic];
        Assert.True(retain, "the resync record must be published retained");

        var order = siteBroker.ReceivedOrder.ToArray();
        var resyncIndex = Array.IndexOf(order, resyncTopic);
        var firstBacklogIndex = Array.IndexOf(order, "t/resync/1");
        Assert.True(resyncIndex >= 0 && resyncIndex < firstBacklogIndex,
            "the resync record must be published BEFORE any backlog item replays");

        using var doc = JsonDocument.Parse(payload);
        var root = doc.RootElement;
        Assert.Equal(7, root.GetProperty("droppedTotal").GetInt64());
        Assert.Equal(2, root.GetProperty("backlogDepth").GetInt64());
        Assert.Equal(seq1, root.GetProperty("firstSeq").GetInt64());
        Assert.True(root.TryGetProperty("resumedAtUtc", out _));
        Assert.True(root.TryGetProperty("oldestUtc", out _));
        Assert.True(root.TryGetProperty("lastAckedSeq", out _));
    }

    // ─────────────────────────────────────────────────────────────────────
    // 5. ST4I_BRIDGE_SPOOL_ENABLED=0 (no spool injected at all) ⇒ today's behavior exactly: an item that
    //    arrives while disconnected is genuinely dropped, never delivered even after a later reconnect.
    // ─────────────────────────────────────────────────────────────────────

    [Fact]
    public async Task SpoolDisabled_NullSpool_ItemDuringOutage_IsGenuinelyDropped_LegacyBehaviorUnchanged()
    {
        using var siteCa = TestCertificates.CreateCa("Test Site CA WI3-5");
        using var siteServerCertEphemeral = TestCertificates.CreateLeaf("127.0.0.1", siteCa);
        using var siteServerCert = TestCertificates.Persist(siteServerCertEphemeral);
        using var deviceCert = TestCertificates.Persist(TestCertificates.CreateSelfSignedLeaf("wi3-legacy"));

        var localPort = GetFreePort();
        var localUns = new UnsOptions { BrokerPort = localPort };
        await using var localBroker = Track(new UnsBroker(localPort));
        await localBroker.StartAsync();

        // Reserve the port the Site broker will use LATER — nothing listens on it yet.
        var sitePort = GetFreePort();
        var siteLink = BuildEnabledLink(sitePort, siteCa.ExportCertificatePem());

        // spool: null (the default) — the ST4I_BRIDGE_SPOOL_ENABLED=0 wire-up path (Program.cs never
        // constructs a BridgeSpool at all in that case, so UnsBridge simply never receives one).
        await using var bridge = Track(new UnsBridge(localUns, siteLink, deviceCert, "FP-LEGACY"));

        using var localPublisher = await ConnectLocalPublisherAsync(localPort);
        const string droppedTopic = "syn/wi3/legacy/dropped-during-outage";
        await localPublisher.PublishAsync(new MqttApplicationMessageBuilder()
            .WithTopic(droppedTopic).WithPayload(new byte[] { 1 }).Build());

        // Give the (non-existent, spool-less) forward loop ample opportunity to have "handled" it — it can
        // only have dropped it, since nothing is listening on sitePort yet.
        await Task.Delay(TimeSpan.FromMilliseconds(500));

        // NOW bring the Site broker up on the SAME port the bridge has been retrying against.
        await using var siteBroker = Track(await CapturingSiteBroker.StartAsync(siteServerCert, port: sitePort));
        await WaitUntilAsync(() => bridge.Snapshot().State == BridgeState.Connected, "the bridge to eventually reconnect");

        const string afterTopic = "syn/wi3/legacy/after-reconnect";
        await BridgeTestNet.PublishUntilObservedAsync(
            localPublisher, afterTopic, new byte[] { 2 },
            () => siteBroker.ReceivedMessages.ContainsKey(afterTopic),
            "a message published AFTER reconnect to arrive normally");

        Assert.False(siteBroker.ReceivedMessages.ContainsKey(droppedTopic),
            "with no spool, the item published during the outage must be genuinely lost — never replayed, matching pre-WI-3 behavior");

        await localPublisher.DisconnectAsync();
    }

    // ─────────────────────────────────────────────────────────────────────
    // 6. A spool whose methods throw/fail (violating IBridgeSpool's own never-throws contract) ⇒ the bridge
    //    stays alive and the local side is unaffected.
    // ─────────────────────────────────────────────────────────────────────

    [Fact]
    public async Task SpoolThrowsOnEveryCall_BridgeStaysAlive_AndLocalSideIsUnaffected()
    {
        using var deviceCert = TestCertificates.Persist(TestCertificates.CreateSelfSignedLeaf("wi3-throws"));

        var localPort = GetFreePort();
        var localUns = new UnsOptions { BrokerPort = localPort };
        await using var localBroker = Track(new UnsBroker(localPort));
        await localBroker.StartAsync();

        var unreachableSitePort = GetFreePort();
        var siteLink = BuildEnabledLink(unreachableSitePort, "-----BEGIN CERTIFICATE-----\nFAKE\n-----END CERTIFICATE-----");

        var spool = new FakeBridgeSpool { ThrowEverything = true };
        var warnings = new List<string>();
        var bridge = new UnsBridge(localUns, siteLink, deviceCert, "FP-THROWS", spool: spool, logWarning: w =>
        {
            lock (warnings) warnings.Add(w);
        });

        using var localPublisher = await ConnectLocalPublisherAsync(localPort);
        for (var i = 0; i < 5; i++)
        {
            var exception = await Record.ExceptionAsync(async () =>
                await localPublisher.PublishAsync(new MqttApplicationMessageBuilder()
                    .WithTopic($"syn/wi3/throws/{i}").WithPayload(new byte[] { (byte)i }).Build()));
            Assert.Null(exception);
        }

        await WaitUntilAsync(() => { lock (warnings) return warnings.Count > 0; },
            "the throwing spool's failures to be logged rather than silently swallowed or crashing the bridge");

        // The bridge itself must still be alive/queryable and dispose cleanly despite a permanently-broken
        // spool collaborator.
        var snapshotException = Record.Exception(() => bridge.Snapshot());
        Assert.Null(snapshotException);

        var disposeException = await Record.ExceptionAsync(async () => await bridge.DisposeAsync());
        Assert.Null(disposeException);

        await localPublisher.DisconnectAsync();
    }

    // ─────────────────────────────────────────────────────────────────────
    // 7. Restart durability at the BRIDGE level: spool some items, tear the bridge down, build a new one
    //    over the SAME (real, on-disk) spool directory, connect ⇒ the pre-restart items are delivered.
    // ─────────────────────────────────────────────────────────────────────

    [Fact]
    public async Task RestartDurability_BridgeLevel_PreRestartItemsSurviveAndAreDelivered()
    {
        var spoolDir = NewTempDir();

        using var siteCa = TestCertificates.CreateCa("Test Site CA WI3-7");
        using var siteServerCertEphemeral = TestCertificates.CreateLeaf("127.0.0.1", siteCa);
        using var siteServerCert = TestCertificates.Persist(siteServerCertEphemeral);
        using var deviceCert = TestCertificates.Persist(TestCertificates.CreateSelfSignedLeaf("wi3-restart"));

        var localPort = GetFreePort();
        var localUns = new UnsOptions { BrokerPort = localPort };
        await using var localBroker = Track(new UnsBroker(localPort));
        await localBroker.StartAsync();

        // --- "before restart": bridge A, remote unreachable, items accumulate durably on disk. ---
        var unreachableSitePort = GetFreePort();
        var preRestartLink = BuildEnabledLink(unreachableSitePort, siteCa.ExportCertificatePem());

        var spoolA = new BridgeSpool(spoolDir);
        var bridgeA = new UnsBridge(localUns, preRestartLink, deviceCert, "FP-RESTART-A", spool: spoolA);

        using (var localPublisher = await ConnectLocalPublisherAsync(localPort))
        {
            const string topic1 = "syn/wi3/restart/1";
            const string topic2 = "syn/wi3/restart/2";
            await BridgeTestNet.PublishUntilObservedAsync(
                localPublisher, topic1, new byte[] { 11 },
                () => spoolA.StatsAsync().GetAwaiter().GetResult().Depth >= 1,
                "the first pre-restart item to be spooled durably");
            await localPublisher.PublishAsync(new MqttApplicationMessageBuilder().WithTopic(topic2).WithPayload(new byte[] { 22 }).Build());
            await WaitUntilAsync(() => spoolA.StatsAsync().GetAwaiter().GetResult().Depth >= 2,
                "both pre-restart items to be spooled durably");

            await localPublisher.DisconnectAsync();
        }

        // --- simulate a process restart: tear the bridge down, drop pooled connections, reopen the SAME
        //     on-disk spool directory from a brand-new BridgeSpool instance. ---
        await bridgeA.DisposeAsync();
        SqliteConnection.ClearAllPools();

        var spoolB = new BridgeSpool(spoolDir);
        var statsAfterRestart = await spoolB.StatsAsync();
        Assert.Equal(2, statsAfterRestart.Depth);

        await using var siteBroker = Track(await CapturingSiteBroker.StartAsync(siteServerCert));
        var postRestartLink = BuildEnabledLink(siteBroker.Port, siteCa.ExportCertificatePem());
        await using var bridgeB = Track(new UnsBridge(localUns, postRestartLink, deviceCert, "FP-RESTART-B", spool: spoolB));

        await WaitUntilAsync(() => siteBroker.ReceivedMessages.ContainsKey("syn/wi3/restart/1")
                                    && siteBroker.ReceivedMessages.ContainsKey("syn/wi3/restart/2"),
            "both pre-restart items to be delivered by the NEW bridge instance over the SAME durable spool");

        Assert.Equal(new byte[] { 11 }, siteBroker.ReceivedMessages["syn/wi3/restart/1"].Payload);
        Assert.Equal(new byte[] { 22 }, siteBroker.ReceivedMessages["syn/wi3/restart/2"].Payload);
    }
}
