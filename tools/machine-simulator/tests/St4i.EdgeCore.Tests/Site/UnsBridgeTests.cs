using System.Collections.Concurrent;
using System.Net;
using System.Net.Sockets;
using System.Security.Cryptography.X509Certificates;
using System.Text;
using MQTTnet;
using MQTTnet.Protocol;
using MQTTnet.Server;
using St4i.EdgeCore.Site;
using St4i.EdgeCore.Uns;
using Xunit;

namespace St4i.EdgeCore.Tests.Site;

/// <summary>
/// GĐ3 EC-2 — <see cref="UnsBridge"/>: the loopback-Site forwarding proof. This is the FULL mTLS path (not
/// the documented fallback): a second, real MQTTnet server stands in for "the Site's MQTT broker" on a
/// dynamic loopback port, configured with a genuine TLS server certificate AND
/// <c>ClientCertificateRequired</c> (mutual TLS) — proven feasible ahead of writing this file via a scratch
/// probe (both the "Site" server certificate and the device client certificate had to be reloaded through
/// a PFX export/<see cref="X509KeyStorageFlags.PersistKeySet"/> round-trip first; an ephemeral-keyed
/// certificate fails schannel outright on EITHER side of a real handshake — same finding as
/// <see cref="St4i.EdgeCore.Identity.DeviceIdentityStore"/>'s own EC-1 doc comment. See
/// <see cref="TestCertificates.Persist"/>). A message published directly to the LOCAL loopback
/// <see cref="UnsBroker"/> is asserted to arrive at the "Site" broker AND the Site broker is asserted to
/// have actually seen the device's own client certificate during the handshake — real mTLS, end to end, not
/// a mocked trust decision.
///
/// Deterministic: dynamic ports (<see cref="GetFreePort"/>, the same "bind a listener to port 0, read back
/// the assigned port, stop it" idiom <c>DeviceIdentityStoreTests</c>/<c>ModbusTcpDriverLoopbackTests</c>
/// already use), bounded polling (no fixed <c>Task.Delay</c> synchronization waits) throughout.
/// </summary>
[Collection("St4i.EdgeCore.Tests.Site")]
public sealed class UnsBridgeTests : IAsyncLifetime
{
    private static readonly TimeSpan PollTimeout = TimeSpan.FromSeconds(10);
    private static readonly TimeSpan PollInterval = TimeSpan.FromMilliseconds(50);

    private readonly List<IAsyncDisposable> _disposables = new();

    public Task InitializeAsync() => Task.CompletedTask;

    public async Task DisposeAsync()
    {
        foreach (var disposable in _disposables)
        {
            try { await disposable.DisposeAsync(); } catch { /* best-effort cleanup */ }
        }
    }

    private T Track<T>(T disposable) where T : IAsyncDisposable
    {
        _disposables.Add(disposable);
        return disposable;
    }

    private static int GetFreePort()
    {
        var listener = new TcpListener(IPAddress.Loopback, 0);
        listener.Start();
        var port = ((IPEndPoint)listener.LocalEndpoint).Port;
        listener.Stop();
        return port;
    }

    private static async Task WaitUntilAsync(Func<bool> predicate, string because)
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
    private static async Task PublishUntilObservedAsync(IMqttClient publisher, string topic, byte[] payload, Func<bool> observed, string because)
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

    /// <summary>Stands up a real MQTTnet server as the "Site" broker: TLS + mandatory client certificate,
    /// bound to loopback on a dynamic port. Captures the client certificate the Site observed during the
    /// handshake and every published message it received (topic/payload/retain), for assertions.</summary>
    private sealed class CapturingSiteBroker : IAsyncDisposable
    {
        private readonly MqttServer _server;

        public int Port { get; }

        public X509Certificate2? ObservedClientCertificate { get; private set; }

        public ConcurrentDictionary<string, (byte[] Payload, bool Retain)> ReceivedMessages { get; } = new();

        private CapturingSiteBroker(MqttServer server, int port)
        {
            _server = server;
            Port = port;
        }

        public static async Task<CapturingSiteBroker> StartAsync(X509Certificate2 serverCertificate)
        {
            var port = GetFreePort();
            var factory = new MqttServerFactory();
            var options = factory.CreateServerOptionsBuilder()
                .WithoutDefaultEndpoint()
                .WithEncryptedEndpoint()
                .WithEncryptedEndpointBoundIPAddress(IPAddress.Loopback)
                .WithEncryptedEndpointPort(port)
                .WithEncryptionCertificate(serverCertificate)
                .WithClientCertificate((_, _, _, _) => true, checkCertificateRevocation: false)
                .Build();

            var server = factory.CreateMqttServer(options);
            var broker = new CapturingSiteBroker(server, port);

            server.ValidatingConnectionAsync += args =>
            {
                broker.ObservedClientCertificate = args.ClientCertificate;
                return Task.CompletedTask;
            };
            server.InterceptingPublishAsync += args =>
            {
                broker.ReceivedMessages[args.ApplicationMessage.Topic] =
                    (System.Buffers.BuffersExtensions.ToArray(args.ApplicationMessage.Payload), args.ApplicationMessage.Retain);
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

    private static PersistedSiteLink BuildEnabledLink(int sitePort, string siteTrustPem) => new()
    {
        Enabled = true,
        Host = "127.0.0.1",
        Port = sitePort,
        SiteTrustPem = siteTrustPem,
    };

    [Fact]
    public async Task Enabled_PublishToLocalBroker_ForwardsToTheSiteBrokerOverRealMtls_AndSiteObservesTheDeviceCertificate()
    {
        using var siteCa = TestCertificates.CreateCa("Test Site CA");
        using var siteServerCertEphemeral = TestCertificates.CreateLeaf("127.0.0.1", siteCa);
        using var siteServerCert = TestCertificates.Persist(siteServerCertEphemeral);
        using var deviceCertEphemeral = TestCertificates.CreateSelfSignedLeaf("device-under-test");
        using var deviceCert = TestCertificates.Persist(deviceCertEphemeral);

        var localPort = GetFreePort();
        var localUns = new UnsOptions { BrokerPort = localPort };
        await using var localBroker = Track(new UnsBroker(localPort));
        await localBroker.StartAsync();

        await using var siteBroker = Track(await CapturingSiteBroker.StartAsync(siteServerCert));

        var siteLink = BuildEnabledLink(siteBroker.Port, siteCa.ExportCertificatePem());
        var warnings = new List<string>();
        var errors = new List<string>();
        await using var bridge = Track(new UnsBridge(
            localUns, siteLink, deviceCert, "TEST-DEVICE-FINGERPRINT",
            logWarning: w => warnings.Add(w),
            logError: (ex, msg) => errors.Add($"{msg}: {ex.Message}")));

        // Wait for the mTLS handshake to complete (the Site observed SOME client certificate) before
        // publishing — proves the bridge's remote client actually connects with mutual TLS.
        await WaitUntilAsync(() => siteBroker.ObservedClientCertificate is not null, "the Site broker to observe the device's mTLS client certificate");
        Assert.Equal(deviceCert.Thumbprint, siteBroker.ObservedClientCertificate!.Thumbprint);
        Assert.Equal(BridgeState.Connected, bridge.Snapshot().State);

        var factory = new MqttClientFactory();
        using var localPublisher = factory.CreateMqttClient();
        await localPublisher.ConnectAsync(new MqttClientOptionsBuilder().WithTcpServer("127.0.0.1", localPort).Build());

        const string topic = "syn/test/site/forward/probe";
        var payload = Encoding.UTF8.GetBytes("hello-from-local-uns");

        await PublishUntilObservedAsync(
            localPublisher, topic, payload,
            () => siteBroker.ReceivedMessages.ContainsKey(topic),
            "the message published on the LOCAL broker to be forwarded to the Site broker");

        var (received, retain) = siteBroker.ReceivedMessages[topic];
        Assert.Equal(payload, received);
        Assert.True(retain, "syn/ topics must be forwarded with retain=true (mirrors UnsPublisher's own semantic-mirror retain policy)");

        // Site fingerprint reported in the snapshot must be the validated Site server certificate's own hash.
        var snapshot = bridge.Snapshot();
        Assert.Equal(BridgeState.Connected, snapshot.State);
        Assert.Equal("TEST-DEVICE-FINGERPRINT", snapshot.DeviceFingerprint);
        Assert.NotNull(snapshot.SiteFingerprint);

        await localPublisher.DisconnectAsync();
    }

    [Fact]
    public async Task Enabled_SparkplugTopic_IsForwardedWithoutRetain()
    {
        using var siteCa = TestCertificates.CreateCa("Test Site CA");
        using var siteServerCertEphemeral = TestCertificates.CreateLeaf("127.0.0.1", siteCa);
        using var siteServerCert = TestCertificates.Persist(siteServerCertEphemeral);
        using var deviceCertEphemeral = TestCertificates.CreateSelfSignedLeaf("device-under-test-2");
        using var deviceCert = TestCertificates.Persist(deviceCertEphemeral);

        var localPort = GetFreePort();
        var localUns = new UnsOptions { BrokerPort = localPort };
        await using var localBroker = Track(new UnsBroker(localPort));
        await localBroker.StartAsync();

        await using var siteBroker = Track(await CapturingSiteBroker.StartAsync(siteServerCert));
        var siteLink = BuildEnabledLink(siteBroker.Port, siteCa.ExportCertificatePem());
        await using var bridge = Track(new UnsBridge(localUns, siteLink, deviceCert, "FP"));

        await WaitUntilAsync(() => siteBroker.ObservedClientCertificate is not null, "the Site broker to observe the mTLS handshake");

        var factory = new MqttClientFactory();
        using var localPublisher = factory.CreateMqttClient();
        await localPublisher.ConnectAsync(new MqttClientOptionsBuilder().WithTcpServer("127.0.0.1", localPort).Build());

        const string topic = "spBv1.0/s.a.l/DDATA/cell/EQ-1";
        var payload = Encoding.UTF8.GetBytes("sparkplug-payload");

        await PublishUntilObservedAsync(
            localPublisher, topic, payload,
            () => siteBroker.ReceivedMessages.ContainsKey(topic),
            "the Sparkplug DDATA message to be forwarded to the Site broker");

        var (_, retain) = siteBroker.ReceivedMessages[topic];
        Assert.False(retain, "Sparkplug topics must NOT be forwarded retained");

        await localPublisher.DisconnectAsync();
    }

    [Fact]
    public async Task Disabled_MakesNoRemoteConnection()
    {
        // A bare TCP listener stands in for "the Site" here — a disabled bridge must never even attempt a
        // TCP connection, so there's nothing MQTT-specific to assert beyond "no connection ever arrives".
        var siteStandIn = new TcpListener(IPAddress.Loopback, 0);
        siteStandIn.Start();
        var sitePort = ((IPEndPoint)siteStandIn.LocalEndpoint).Port;

        try
        {
            var localPort = GetFreePort();
            var localUns = new UnsOptions { BrokerPort = localPort };
            await using var localBroker = Track(new UnsBroker(localPort));
            await localBroker.StartAsync();

            using var deviceCert = TestCertificates.Persist(TestCertificates.CreateSelfSignedLeaf("device-disabled-test"));
            var disabledLink = new PersistedSiteLink { Enabled = false, Host = "127.0.0.1", Port = sitePort, SiteTrustPem = "" };

            await using var bridge = Track(new UnsBridge(localUns, disabledLink, deviceCert, "FP-DISABLED"));

            Assert.Equal(BridgeState.Disabled, bridge.Snapshot().State);

            // Bounded wait covering multiple multiples of the bridge's own connect-monitor interval —
            // if the bridge were (incorrectly) attempting to connect, this is ample time for it to have
            // shown up as a pending connection on the stand-in listener.
            await Task.Delay(TimeSpan.FromSeconds(1));
            Assert.False(siteStandIn.Pending(), "a disabled Site link must never cause any remote TCP connection attempt");
            Assert.Equal(BridgeState.Disabled, bridge.Snapshot().State);
        }
        finally
        {
            siteStandIn.Stop();
        }
    }

    [Fact]
    public async Task SiteOutage_TransitionsToDegraded_AndTheLocalBrokerKeepsWorking()
    {
        using var siteCa = TestCertificates.CreateCa("Test Site CA");
        using var siteServerCertEphemeral = TestCertificates.CreateLeaf("127.0.0.1", siteCa);
        using var siteServerCert = TestCertificates.Persist(siteServerCertEphemeral);
        using var deviceCertEphemeral = TestCertificates.CreateSelfSignedLeaf("device-outage-test");
        using var deviceCert = TestCertificates.Persist(deviceCertEphemeral);

        var localPort = GetFreePort();
        var localUns = new UnsOptions { BrokerPort = localPort };
        await using var localBroker = Track(new UnsBroker(localPort));
        await localBroker.StartAsync();

        var siteBroker = await CapturingSiteBroker.StartAsync(siteServerCert); // NOT tracked — stopped manually below
        var siteLink = BuildEnabledLink(siteBroker.Port, siteCa.ExportCertificatePem());
        await using var bridge = Track(new UnsBridge(localUns, siteLink, deviceCert, "FP-OUTAGE"));

        await WaitUntilAsync(() => bridge.Snapshot().State == BridgeState.Connected, "the bridge to reach Connected before the simulated outage");

        // Simulate a Site-side outage.
        await siteBroker.StopListeningAsync();
        try
        {
            await WaitUntilAsync(() => bridge.Snapshot().State == BridgeState.Degraded, "the bridge to report Degraded after the Site broker goes down");

            // The local UNS spine/pipeline must be completely unaffected: an independent subscriber
            // connected directly to the LOCAL broker still gets messages, and publishing doesn't throw.
            var factory = new MqttClientFactory();
            using var localSubscriber = factory.CreateMqttClient();
            await localSubscriber.ConnectAsync(new MqttClientOptionsBuilder().WithTcpServer("127.0.0.1", localPort).Build());
            var received = new ConcurrentDictionary<string, bool>();
            localSubscriber.ApplicationMessageReceivedAsync += args =>
            {
                received[args.ApplicationMessage.Topic] = true;
                return Task.CompletedTask;
            };
            await localSubscriber.SubscribeAsync(new MqttClientSubscribeOptionsBuilder().WithTopicFilter("syn/#").Build());

            using var localPublisher = factory.CreateMqttClient();
            await localPublisher.ConnectAsync(new MqttClientOptionsBuilder().WithTcpServer("127.0.0.1", localPort).Build());
            const string topic = "syn/test/during-outage";
            var exception = await Record.ExceptionAsync(async () =>
                await localPublisher.PublishAsync(new MqttApplicationMessageBuilder().WithTopic(topic).WithPayload("still-alive").Build()));

            Assert.Null(exception);
            await WaitUntilAsync(() => received.ContainsKey(topic), "the local broker to keep delivering messages to an independent subscriber during a Site outage");

            await localPublisher.DisconnectAsync();
            await localSubscriber.DisconnectAsync();
        }
        finally
        {
            await siteBroker.DisposeAsync();
        }
    }
}
