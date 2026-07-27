using System.Security.Cryptography;
using System.Security.Cryptography.X509Certificates;
using System.Threading.Channels;
using MQTTnet;
using MQTTnet.Protocol;
using St4i.EdgeCore.Uns;

namespace St4i.EdgeCore.Site;

/// <summary>
/// GĐ3 EC-2 — the northbound bridge: subscribes the LOCAL Unified Namespace spine (the loopback
/// <see cref="UnsBroker"/> every reading already flows through via <see cref="UnsPublisher"/>) and
/// republishes every message, byte-for-byte, up to a SYNAPSE Site's MQTT broker over a trust-pinned mTLS
/// connection. OUTBOUND-only: this class's LOCAL client only ever subscribes (never publishes to the local
/// spine), and its REMOTE client only ever publishes (never subscribes) — nothing the Site sends back is
/// ever pulled down into the local spine. The local broker itself stays loopback-only regardless of this
/// class's existence; only THIS class's own remote client ever dials off-box, and only when
/// <see cref="PersistedSiteLink.Enabled"/> is <see langword="true"/> (see the ctor's own doc note on the
/// disabled no-op path).
///
/// <para><b>Shape copied from <see cref="UnsPublisher"/> on purpose</b> (same task-brief instruction EC-2
/// inherits from G2-2): non-blocking constructor (both clients connect in the BACKGROUND), a bounded
/// <see cref="Channel{T}"/> (drop-oldest when saturated, single reader) between the local subscriber
/// callback and the actual remote publish, and a never-throws-into-the-pipeline posture throughout. The
/// one thing G2-2's publisher never needed that this bridge does: BOTH clients reconnect (bounded
/// exponential backoff, capped, never a tight loop) — a Site can go down for an arbitrary length of time
/// (backhaul outage, a Site-side maintenance window, ...) and this bridge must keep quietly retrying
/// without ever spamming the network or busy-looping the CPU, while the LOCAL client (and therefore the
/// rest of this device's own UNS spine/pipeline) is completely unaffected — see <see cref="BridgeState.Degraded"/>.</para>
///
/// <para><b>Trust boundary:</b> the remote client's TLS options wire in <see cref="SiteTrustPin.IsTrusted"/>
/// as the certificate validation handler — see that class's own doc comment for the fail-closed contract.
/// The remote client ALSO presents <paramref name="deviceCert"/> (mutual TLS): the Site is expected to
/// pin/verify THIS device's certificate on its own end (out of scope here — this bridge only handles ITS
/// OWN trust decision about the Site).</para>
///
/// <para><b>Retain policy on republish:</b> <c>retain = topic starts with "syn/"</c> — mirrors the exact
/// same semantic-mirror retain policy <see cref="UnsPublisher"/> already applies locally (the retained
/// canonical-envelope mirror should stay "last known value" retained at the Site too; Sparkplug DDATA/NDATA/
/// birth-death traffic is never retained, per spec).</para>
/// </summary>
public sealed class UnsBridge : IAsyncDisposable
{
    private const string SparkplugTopicFilter = "spBv1.0/#";
    private const string SemanticTopicFilter = "syn/#";
    private const string SemanticNamespacePrefix = "syn/";
    private const string LoopbackHost = "127.0.0.1";
    private const int ChannelCapacity = 10_000;

    private static readonly TimeSpan MonitorInterval = TimeSpan.FromMilliseconds(200);
    private static readonly TimeSpan InitialBackoff = TimeSpan.FromMilliseconds(250);
    private static readonly TimeSpan MaxBackoff = TimeSpan.FromSeconds(10);
    private static readonly TimeSpan DrainTimeout = TimeSpan.FromSeconds(5);

    private readonly record struct ForwardItem(string Topic, byte[] Payload, bool Retain);

    private readonly bool _enabled;
    private readonly string _deviceFingerprint;
    private readonly Action<string>? _logWarning;
    private readonly Action<Exception, string>? _logError;

    private readonly IMqttClient? _localClient;
    private readonly IMqttClient? _remoteClient;
    private readonly Channel<ForwardItem>? _channel;
    private readonly CancellationTokenSource _cts = new();
    private readonly Task? _localConnectLoop;
    private readonly Task? _remoteConnectLoop;
    private readonly Task? _forwardLoop;

    private volatile bool _everConnectedRemote;
    private volatile string? _lastError;
    private volatile string? _siteFingerprint;
    private volatile bool _disposed;

    /// <param name="localUns">The local UNS spine's own options — only <see cref="UnsOptions.BrokerPort"/>
    /// is used (always dialled at <see cref="LoopbackHost"/>, matching <see cref="UnsBroker"/>'s own
    /// loopback-only bind).</param>
    /// <param name="siteLink">The persisted Site link. <see cref="PersistedSiteLink.Enabled"/> = <see
    /// langword="false"/> makes this instance a permanent, harmless no-op (see remarks) rather than
    /// throwing — defense-in-depth alongside <see cref="SiteBridgeManager"/>, which should never construct
    /// a bridge for a disabled link in the first place.</param>
    /// <param name="deviceCert">This device's own certificate WITH private key (<see
    /// cref="Identity.DeviceIdentity.Certificate"/>), presented as the remote client's mTLS client
    /// certificate. Loaded with <see cref="X509KeyStorageFlags.PersistKeySet"/> upstream (EC-1) — REQUIRED
    /// for schannel to actually use the key during the handshake (an ephemeral-keyset cert fails outright,
    /// even though <c>HasPrivateKey</c> still reports <see langword="true"/>; see
    /// <see cref="Identity.DeviceIdentityStore"/>'s own doc comment).</param>
    /// <param name="deviceFingerprint">This device's own identity fingerprint (<see
    /// cref="Identity.DeviceIdentity.Fingerprint"/>), reported verbatim in every <see cref="Snapshot"/>.</param>
    public UnsBridge(
        UnsOptions localUns,
        PersistedSiteLink siteLink,
        X509Certificate2 deviceCert,
        string deviceFingerprint,
        Action<string>? logWarning = null,
        Action<Exception, string>? logError = null)
    {
        ArgumentNullException.ThrowIfNull(localUns);
        ArgumentNullException.ThrowIfNull(siteLink);
        ArgumentNullException.ThrowIfNull(deviceCert);
        ArgumentException.ThrowIfNullOrEmpty(deviceFingerprint);

        _deviceFingerprint = deviceFingerprint;
        _logWarning = logWarning;
        _logError = logError;
        _enabled = siteLink.Enabled;

        if (!_enabled)
        {
            // Defense-in-depth: even if a caller constructs an UnsBridge directly with a disabled link
            // (bypassing SiteBridgeManager, which should never do this itself), NOTHING below ever runs —
            // no client is created, no socket is ever opened, Snapshot() always reports Disabled, and
            // DisposeAsync is a trivial no-op. See BridgeState.Disabled.
            return;
        }

        var factory = new MqttClientFactory();

        _localClient = factory.CreateMqttClient();
        _localClient.ApplicationMessageReceivedAsync += OnLocalMessageReceivedAsync;
        _localClient.ConnectedAsync += OnLocalConnectedAsync;
        var localOptions = factory.CreateClientOptionsBuilder()
            .WithTcpServer(LoopbackHost, localUns.BrokerPort)
            .WithClientId($"st4i-bridge-local-{Guid.NewGuid():N}")
            .Build();

        _remoteClient = factory.CreateMqttClient();
        _remoteClient.ConnectedAsync += OnRemoteConnectedAsync;
        var remoteOptions = factory.CreateClientOptionsBuilder()
            .WithTcpServer(siteLink.Host, siteLink.Port)
            .WithClientId($"st4i-bridge-{Guid.NewGuid():N}")
            .WithTlsOptions(o =>
            {
                o.UseTls();
                o.WithClientCertificates(new X509Certificate2Collection(deviceCert));
                o.WithCertificateValidationHandler(ctx => ValidateSiteCertificate(ctx, siteLink.SiteTrustPem));
            })
            .Build();

        _channel = Channel.CreateBounded<ForwardItem>(new BoundedChannelOptions(ChannelCapacity)
        {
            FullMode = BoundedChannelFullMode.DropOldest,
            SingleReader = true,
        });

        // Non-blocking ctor (UnsPublisher's own idiom): both clients connect in the background; the
        // monitor loops own reconnect-with-backoff for as long as this bridge lives.
        _localConnectLoop = Task.Run(() => ConnectionLoopAsync(_localClient, localOptions, "local", _cts.Token));
        _remoteConnectLoop = Task.Run(() => ConnectionLoopAsync(_remoteClient, remoteOptions, "remote (Site)", _cts.Token));
        _forwardLoop = Task.Run(() => RunForwardLoopAsync(_cts.Token));
    }

    /// <summary>A point-in-time read of this bridge's health — see <see cref="BridgeState"/> for the
    /// exact state semantics.</summary>
    public BridgeStatusSnapshot Snapshot()
    {
        if (!_enabled)
        {
            return new BridgeStatusSnapshot(BridgeState.Disabled, null, null, _deviceFingerprint);
        }

        var state = !_localClient!.IsConnected
            ? BridgeState.Down
            : _remoteClient!.IsConnected
                ? BridgeState.Connected
                : _everConnectedRemote
                    ? BridgeState.Degraded
                    : BridgeState.Connecting;

        return new BridgeStatusSnapshot(state, _lastError, _siteFingerprint, _deviceFingerprint);
    }

    /// <summary>The remote client's TLS certificate-validation handler: fail-closed via
    /// <see cref="SiteTrustPin.IsTrusted"/>. Records the validated Site fingerprint (for <see cref="Snapshot"/>)
    /// only on a successful validation — a rejected/untrusted certificate never updates it.</summary>
    private bool ValidateSiteCertificate(MqttClientCertificateValidationEventArgs ctx, string siteTrustPem)
    {
        if (ctx.Certificate is null) return false;

        using var presented = new X509Certificate2(ctx.Certificate);
        var trusted = SiteTrustPin.IsTrusted(presented, siteTrustPem);
        if (trusted)
        {
            _siteFingerprint = presented.GetCertHashString(HashAlgorithmName.SHA256);
        }
        else
        {
            _logWarning?.Invoke($"Site bridge rejected an untrusted Site certificate (subject='{presented.Subject}')");
        }

        return trusted;
    }

    private Task OnRemoteConnectedAsync(MqttClientConnectedEventArgs args)
    {
        _everConnectedRemote = true;
        return Task.CompletedTask;
    }

    /// <summary>Subscriptions don't survive a reconnect under this bridge's default (clean-session)
    /// client options, so this re-subscribes on EVERY successful local connect, not just the first.</summary>
    private Task OnLocalConnectedAsync(MqttClientConnectedEventArgs args) => SubscribeLocalAsync();

    private async Task SubscribeLocalAsync()
    {
        try
        {
            await _localClient!.SubscribeAsync(
                new MqttClientSubscribeOptionsBuilder()
                    .WithTopicFilter(SparkplugTopicFilter)
                    .WithTopicFilter(SemanticTopicFilter)
                    .Build(),
                _cts.Token).ConfigureAwait(false);
        }
        catch (OperationCanceledException)
        {
            // Disposed before the subscribe completed — not a fault.
        }
        catch (Exception ex)
        {
            _logError?.Invoke(ex, "Site bridge failed to subscribe to the local UNS spine");
        }
    }

    /// <summary>Enqueues every locally-received message for forwarding — never blocks, never throws (same
    /// contract as <see cref="UnsPublisher.PublishReading"/>): a saturated channel just drops the oldest
    /// buffered item, so a slow/down Site can never back-pressure the local subscriber.</summary>
    private Task OnLocalMessageReceivedAsync(MqttApplicationMessageReceivedEventArgs args)
    {
        var topic = args.ApplicationMessage.Topic;
        var payload = System.Buffers.BuffersExtensions.ToArray(args.ApplicationMessage.Payload);
        var retain = topic.StartsWith(SemanticNamespacePrefix, StringComparison.Ordinal);

        if (!_channel!.Writer.TryWrite(new ForwardItem(topic, payload, retain)))
        {
            _logWarning?.Invoke($"Site bridge forward queue saturated — dropped {topic}");
        }

        return Task.CompletedTask;
    }

    /// <summary>Drains the forward channel and republishes each item to the Site broker whenever the
    /// remote client is currently connected; if it isn't (a Site outage, still connecting, ...) the item is
    /// simply dropped — the point of the bounded drop-oldest channel is precisely that the LOCAL
    /// subscriber must never wait on the Site.</summary>
    private async Task RunForwardLoopAsync(CancellationToken ct)
    {
        try
        {
            var reader = _channel!.Reader;
            while (await reader.WaitToReadAsync(ct).ConfigureAwait(false))
            {
                while (reader.TryRead(out var item))
                {
                    if (!_remoteClient!.IsConnected)
                    {
                        continue; // Site down/slow/still connecting — drop, never block the local side.
                    }

                    try
                    {
                        var message = new MqttApplicationMessageBuilder()
                            .WithTopic(item.Topic)
                            .WithPayload(item.Payload)
                            .WithRetainFlag(item.Retain)
                            .WithQualityOfServiceLevel(MqttQualityOfServiceLevel.AtLeastOnce)
                            .Build();
                        await _remoteClient.PublishAsync(message, ct).ConfigureAwait(false);
                    }
                    catch (OperationCanceledException)
                    {
                        // Shutdown in progress.
                    }
                    catch (Exception ex)
                    {
                        _lastError = ex.Message;
                        _logWarning?.Invoke($"Site bridge failed to forward {item.Topic} to the Site broker: {ex.Message}");
                    }
                }
            }
        }
        catch (OperationCanceledException)
        {
            // Expected on shutdown.
        }
    }

    /// <summary>Owns reconnect-with-bounded-backoff for ONE client (local or remote): polls
    /// <see cref="IMqttClient.IsConnected"/> every <see cref="MonitorInterval"/>; whenever disconnected,
    /// attempts to reconnect, doubling the backoff (capped at <see cref="MaxBackoff"/>, reset to
    /// <see cref="InitialBackoff"/> on the next success) between failed attempts — never a tight loop
    /// (every iteration awaits a real delay), never lets a connect failure propagate anywhere but this
    /// bridge's own <see cref="Snapshot"/>/log callbacks.</summary>
    private async Task ConnectionLoopAsync(IMqttClient client, MqttClientOptions options, string label, CancellationToken ct)
    {
        var backoff = InitialBackoff;
        while (!ct.IsCancellationRequested)
        {
            if (!client.IsConnected)
            {
                try
                {
                    await client.ConnectAsync(options, ct).ConfigureAwait(false);
                    backoff = InitialBackoff;
                }
                catch (OperationCanceledException)
                {
                    break;
                }
                catch (Exception ex)
                {
                    _lastError = ex.Message;
                    _logError?.Invoke(ex, $"Site bridge {label} client failed to connect");
                    try
                    {
                        await Task.Delay(backoff, ct).ConfigureAwait(false);
                    }
                    catch (OperationCanceledException)
                    {
                        break;
                    }

                    backoff = TimeSpan.FromSeconds(Math.Min(backoff.TotalSeconds * 2, MaxBackoff.TotalSeconds));
                    continue;
                }
            }

            try
            {
                await Task.Delay(MonitorInterval, ct).ConfigureAwait(false);
            }
            catch (OperationCanceledException)
            {
                break;
            }
        }
    }

    /// <summary>Drain-first-then-hard-stop, same shape as <see cref="UnsPublisher.DisposeAsync"/>: complete
    /// the forward channel, give the forward loop up to <see cref="DrainTimeout"/> to flush whatever the
    /// remote client can currently accept, THEN cancel both connect loops and disconnect/dispose both
    /// clients. Idempotent (guarded by <see cref="_disposed"/>) and a trivial no-op for a disabled link
    /// (nothing was ever created).</summary>
    public async ValueTask DisposeAsync()
    {
        if (_disposed) return;
        _disposed = true;

        if (!_enabled)
        {
            return;
        }

        _channel!.Writer.TryComplete();

        try
        {
            await _forwardLoop!.WaitAsync(DrainTimeout).ConfigureAwait(false);
        }
        catch (TimeoutException)
        {
            // Fall through to the hard cancel below.
        }

        _cts.Cancel();

        try
        {
            await _forwardLoop!.ConfigureAwait(false);
        }
        catch
        {
            // Best-effort — already reported (if it failed) inside RunForwardLoopAsync.
        }

        try
        {
            await _localConnectLoop!.ConfigureAwait(false);
        }
        catch
        {
            // Best-effort shutdown.
        }

        try
        {
            await _remoteConnectLoop!.ConfigureAwait(false);
        }
        catch
        {
            // Best-effort shutdown.
        }

        foreach (var client in new[] { _localClient, _remoteClient })
        {
            try
            {
                if (client is { IsConnected: true })
                {
                    await client.DisconnectAsync(new MqttClientDisconnectOptions(), CancellationToken.None).ConfigureAwait(false);
                }
            }
            catch
            {
                // Best-effort shutdown.
            }

            client?.Dispose();
        }

        _cts.Dispose();
    }
}
