using System.Collections.Concurrent;
using System.Net;
using System.Net.Sockets;
using System.Security.Cryptography.X509Certificates;
using MQTTnet;
using MQTTnet.Protocol;
using MQTTnet.Server;
using St4i.EdgeCore.Site;
using Xunit;

namespace St4i.EdgeCore.Tests.Site;

/// <summary>
/// GĐ3 closeout WI-3 — the real-MQTTnet test harness <c>UnsBridgeTests</c> (EC-2) originally built inline,
/// extracted so <c>UnsBridgeSpoolTests</c> can reuse the EXACT same "real local broker + real mTLS 'Site'
/// broker stand-in" approach rather than inventing a second (e.g. mocked <c>IMqttClient</c>) harness — see
/// this project's WI-3 task brief: "look at how the existing UnsBridge tests fake the MQTT clients and
/// follow that harness (do not invent a second one)". Nothing here changed behavior from the original
/// private copies in <c>UnsBridgeTests</c> except <see cref="CapturingSiteBroker.PoisonTopics"/>, added so a
/// WI-3 test can force a deterministic broker-level publish REJECTION (not a flaky socket-close race) for a
/// specific topic — see that property's own doc comment.
/// </summary>
internal static class BridgeTestNet
{
    public static readonly TimeSpan PollTimeout = TimeSpan.FromSeconds(10);
    public static readonly TimeSpan PollInterval = TimeSpan.FromMilliseconds(50);

    public static int GetFreePort()
    {
        var listener = new TcpListener(IPAddress.Loopback, 0);
        listener.Start();
        var port = ((IPEndPoint)listener.LocalEndpoint).Port;
        listener.Stop();
        return port;
    }

    public static async Task WaitUntilAsync(Func<bool> predicate, string because)
    {
        var deadline = DateTime.UtcNow + PollTimeout;
        while (DateTime.UtcNow < deadline)
        {
            if (predicate()) return;
            await Task.Delay(PollInterval);
        }

        Assert.True(predicate(), $"timed out after {PollTimeout} waiting for: {because}");
    }

    /// <summary>Publishes repeatedly (bounded) until <paramref name="observed"/> reports the message
    /// arrived — avoids a race against the bridge's own (asynchronous, background) local-subscribe
    /// completing before the very first publish attempt.</summary>
    public static async Task PublishUntilObservedAsync(IMqttClient publisher, string topic, byte[] payload, Func<bool> observed, string because)
    {
        var deadline = DateTime.UtcNow + PollTimeout;
        while (DateTime.UtcNow < deadline)
        {
            if (observed()) return;

            var message = new MqttApplicationMessageBuilder()
                .WithTopic(topic)
                .WithPayload(payload)
                .WithQualityOfServiceLevel(MqttQualityOfServiceLevel.AtLeastOnce)
                .Build();
            await publisher.PublishAsync(message);
            await Task.Delay(PollInterval);
        }

        Assert.True(observed(), $"timed out after {PollTimeout} waiting for: {because}");
    }
}

/// <summary>Stands up a real MQTTnet server as the "Site" broker: TLS + mandatory client certificate, bound
/// to loopback on a dynamic port. Captures the client certificate the Site observed during the handshake and
/// every published message it received (topic/payload/retain), for assertions.</summary>
internal sealed class CapturingSiteBroker : IAsyncDisposable
{
    private readonly MqttServer _server;

    public int Port { get; }

    public X509Certificate2? ObservedClientCertificate { get; private set; }

    public ConcurrentDictionary<string, (byte[] Payload, bool Retain)> ReceivedMessages { get; } = new();

    /// <summary>GĐ3 closeout WI-3 — every topic this broker has ever received, in ARRIVAL order (unlike
    /// <see cref="ReceivedMessages"/>, a dictionary keyed by topic that only ever remembers the LATEST
    /// payload/retain for a given topic and has no ordering guarantee at all). Needed for the
    /// resync-record/backlog-replay-ordering assertions (e.g. "the resync record arrived before any backlog
    /// item", "the backlog replayed in ascending seq order") and for duplicate-delivery assertions (at least
    /// once, not more).</summary>
    public ConcurrentQueue<string> ReceivedOrder { get; } = new();

    /// <summary>GĐ3 closeout WI-3 — topics in this set are REJECTED at the broker (PUBACK reason code
    /// <see cref="MqttPubAckReasonCode.UnspecifiedError"/>) instead of accepted, deterministically forcing
    /// <c>MqttClientPublishResult.IsSuccess == false</c> on the PUBLISHING client's side with NO reliance on
    /// socket-close timing/races — MQTTnet 5's client does not throw on a non-success PUBACK reason code (see
    /// the 4→5 upgrade notes), it just returns a result the caller must check. This is exactly the
    /// deterministic mechanism <c>UnsBridgeSpoolTests</c>' "publish fails mid-batch" test needs. A poisoned
    /// publish is still recorded in <see cref="ReceivedMessages"/> (the broker DID receive the bytes) so a
    /// test can distinguish "rejected" from "never arrived" if it needs to.</summary>
    public ConcurrentDictionary<string, byte> PoisonTopics { get; } = new();

    private CapturingSiteBroker(MqttServer server, int port)
    {
        _server = server;
        Port = port;
    }

    /// <param name="serverCertificate">The broker's own TLS server certificate.</param>
    /// <param name="port">An explicit port to bind (a test that needs to reserve the port BEFORE the
    /// broker exists — e.g. to point a <c>PersistedSiteLink</c> at it ahead of time, then start the broker
    /// on that exact port later, simulating "the Site comes up after the bridge already started trying to
    /// reach it") — or <see langword="null"/> (default) to pick a fresh free port, same as every pre-WI-3
    /// caller of this method already does.</param>
    public static async Task<CapturingSiteBroker> StartAsync(X509Certificate2 serverCertificate, int? port = null)
    {
        var resolvedPort = port ?? BridgeTestNet.GetFreePort();
        var factory = new MqttServerFactory();
        var options = factory.CreateServerOptionsBuilder()
            .WithoutDefaultEndpoint()
            .WithEncryptedEndpoint()
            .WithEncryptedEndpointBoundIPAddress(IPAddress.Loopback)
            .WithEncryptedEndpointPort(resolvedPort)
            .WithEncryptionCertificate(serverCertificate)
            .WithClientCertificate((_, _, _, _) => true, checkCertificateRevocation: false)
            .Build();

        var server = factory.CreateMqttServer(options);
        var broker = new CapturingSiteBroker(server, resolvedPort);

        server.ValidatingConnectionAsync += args =>
        {
            broker.ObservedClientCertificate = args.ClientCertificate;
            return Task.CompletedTask;
        };
        server.InterceptingPublishAsync += args =>
        {
            broker.ReceivedMessages[args.ApplicationMessage.Topic] =
                (System.Buffers.BuffersExtensions.ToArray(args.ApplicationMessage.Payload), args.ApplicationMessage.Retain);
            broker.ReceivedOrder.Enqueue(args.ApplicationMessage.Topic);

            if (broker.PoisonTopics.ContainsKey(args.ApplicationMessage.Topic))
            {
                args.Response.ReasonCode = MqttPubAckReasonCode.UnspecifiedError;
            }

            return Task.CompletedTask;
        };

        await server.StartAsync().ConfigureAwait(false);
        return broker;
    }

    public Task<int> GetConnectedClientCountAsync() => CountClientsAsync();

    private async Task<int> CountClientsAsync()
    {
        var clients = await _server.GetClientsAsync().ConfigureAwait(false);
        return clients.Count;
    }

    public Task StopListeningAsync() => _server.StopAsync();

    public async ValueTask DisposeAsync()
    {
        try { await _server.StopAsync().ConfigureAwait(false); } catch { /* best-effort */ }
        _server.Dispose();
    }
}

/// <summary>
/// GĐ3 closeout WI-3 — an in-memory <see cref="IBridgeSpool"/> test double for <c>UnsBridgeSpoolTests</c>,
/// same idiom as <c>HistorianWriterTests.FakeHistorianStore</c> (a hand-rolled fake of a frozen interface,
/// injected directly — no mocking library, matching this solution's "no new NuGet" constraint). Fast/
/// deterministic (no SQLite, no disk) for the ack-ordering/partial-batch/resync-payload tests; a REAL
/// <see cref="BridgeSpool"/> is used separately (only) for the restart-durability test, where genuine
/// cross-instance persistence is the entire point. <c>ThrowOn*</c> switches let a test violate
/// <see cref="IBridgeSpool"/>'s own documented never-throws contract on purpose, to prove
/// <see cref="UnsBridge"/>'s own defense-in-depth (see that class' own doc comment) actually holds.
/// </summary>
internal sealed class FakeBridgeSpool : IBridgeSpool
{
    private readonly object _lock = new();
    private readonly List<SpooledItem> _items = new();
    private long _nextSeq;
    private long _droppedTotal;

    private readonly List<long> _ackCalls = new();

    public bool ThrowOnEnqueue { get; set; }
    public bool ThrowOnPeek { get; set; }
    public bool ThrowOnAck { get; set; }
    public bool ThrowOnStats { get; set; }
    public bool ThrowOnTrim { get; set; }

    /// <summary>WI-3 review fix round 1 (IMPORTANT 1) — when set, <see cref="AckThroughAsync"/> records the
    /// call (so a test can prove it was ATTEMPTED) but does NOT remove anything from <see cref="_items"/>,
    /// simulating a real <see cref="BridgeSpool.AckThroughAsync"/> whose DELETE silently affects zero rows
    /// (locked DB, full disk) — that method has no success signal by contract, so this is the one realistic
    /// way for an ack to "succeed" (no exception) while changing nothing.</summary>
    public bool SilentlyFailAck { get; set; }

    public bool ThrowEverything
    {
        set => ThrowOnEnqueue = ThrowOnPeek = ThrowOnAck = ThrowOnStats = ThrowOnTrim = value;
    }

    /// <summary>Set directly by a test to simulate a spool whose age/byte-cap trimming has ALREADY dropped
    /// some historical count — <see cref="StatsAsync"/> reports it verbatim, exactly like the real
    /// <see cref="BridgeSpool"/>'s own <c>dropped_total</c> meta row.</summary>
    public long DroppedTotal
    {
        get => Interlocked.Read(ref _droppedTotal);
        set => Interlocked.Exchange(ref _droppedTotal, value);
    }

    /// <summary>WI-3 review fix round 1 — a locked SNAPSHOT of every <c>seq</c> argument
    /// <see cref="AckThroughAsync"/> was ever called with, in call order (the direct proof of the
    /// partial-batch-ack rule under test). Was previously a directly-exposed <c>List&lt;long&gt;</c> read by
    /// test code on one thread while <see cref="AckThroughAsync"/> mutated it under <see cref="_lock"/> on
    /// the bridge's own forward-loop thread — a latent "collection was modified" race. <see cref="Snapshot"/>
    /// already got this right; this now matches it.</summary>
    public IReadOnlyList<long> AckCallsSnapshot()
    {
        lock (_lock) return _ackCalls.ToList();
    }

    public int TrimCallCount => _trimCallCount;
    private int _trimCallCount;

    public IReadOnlyList<SpooledItem> Snapshot()
    {
        lock (_lock) return _items.OrderBy(i => i.Seq).ToList();
    }

    /// <summary>Pre-seeds a backlog item with an EXPLICIT seq (bypassing the normal auto-increment) — for
    /// tests that need a specific, known ordering in place BEFORE the bridge/forward loop ever runs.
    /// Advances the internal seq counter so a subsequent real <see cref="EnqueueAsync"/> call still only
    /// ever goes up, same monotonic-seq invariant the real <see cref="BridgeSpool"/> upholds.</summary>
    public void Seed(SpooledItem item)
    {
        lock (_lock)
        {
            _items.Add(item);
            if (item.Seq > _nextSeq) _nextSeq = item.Seq;
        }
    }

    public Task<long> EnqueueAsync(string topic, byte[] payload, bool retain, CancellationToken ct = default)
    {
        if (ThrowOnEnqueue) throw new InvalidOperationException("FakeBridgeSpool: induced enqueue failure.");

        lock (_lock)
        {
            var seq = ++_nextSeq;
            _items.Add(new SpooledItem(seq, topic, payload, retain, DateTimeOffset.UtcNow));
            return Task.FromResult(seq);
        }
    }

    public Task<IReadOnlyList<SpooledItem>> PeekBatchAsync(int max, CancellationToken ct = default)
    {
        if (ThrowOnPeek) throw new InvalidOperationException("FakeBridgeSpool: induced peek failure.");

        lock (_lock)
        {
            IReadOnlyList<SpooledItem> result = _items.OrderBy(i => i.Seq).Take(max).ToList();
            return Task.FromResult(result);
        }
    }

    public Task AckThroughAsync(long seq, CancellationToken ct = default)
    {
        if (ThrowOnAck) throw new InvalidOperationException("FakeBridgeSpool: induced ack failure.");

        lock (_lock)
        {
            _ackCalls.Add(seq);
            if (!SilentlyFailAck)
            {
                _items.RemoveAll(i => i.Seq <= seq);
            }
        }

        return Task.CompletedTask;
    }

    public Task<BridgeSpoolStats> StatsAsync(CancellationToken ct = default)
    {
        if (ThrowOnStats) throw new InvalidOperationException("FakeBridgeSpool: induced stats failure.");

        lock (_lock)
        {
            if (_items.Count == 0)
            {
                return Task.FromResult(new BridgeSpoolStats(0, 0, 0, DroppedTotal, null));
            }

            var minSeq = _items.Min(i => i.Seq);
            var maxSeq = _items.Max(i => i.Seq);
            var oldest = _items.Min(i => i.EnqueuedUtc);
            return Task.FromResult(new BridgeSpoolStats(_items.Count, minSeq, maxSeq, DroppedTotal, oldest));
        }
    }

    public Task<int> TrimAsync(CancellationToken ct = default)
    {
        Interlocked.Increment(ref _trimCallCount);
        if (ThrowOnTrim) throw new InvalidOperationException("FakeBridgeSpool: induced trim failure.");
        return Task.FromResult(0);
    }
}
