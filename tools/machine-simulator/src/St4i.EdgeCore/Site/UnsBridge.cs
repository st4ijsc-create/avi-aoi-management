using System.Security.Cryptography;
using System.Security.Cryptography.X509Certificates;
using System.Text.Json;
using System.Text.Json.Serialization;
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
///
/// <para><b>GĐ3 closeout WI-3 — durable backlog, not a silent drop:</b> when <paramref name="spool"/> is
/// non-<see langword="null"/> (the composition root passes a real <see cref="BridgeSpool"/> whenever
/// <c>ST4I_BRIDGE_SPOOL_ENABLED</c> is not explicitly disabled — see <see cref="BridgeSpoolOptions"/>), the
/// bounded <see cref="Channel{T}"/> above is no longer forwarded directly: a background WRITER loop
/// (<see cref="RunSpoolWriterLoopAsync"/>, same write-behind idiom as
/// <see cref="St4i.EdgeCore.Historian.HistorianWriter"/>) drains it into <see cref="IBridgeSpool.EnqueueAsync"/>,
/// and a SEPARATE forward loop (<see cref="RunSpoolForwardLoopAsync"/>) peeks/publishes/acks the durable
/// spool whenever (and ONLY while) the remote client is connected — a Site outage now backs data up on disk
/// (bounded by <see cref="BridgeSpoolOptions.MaxBytes"/>/<see cref="BridgeSpoolOptions.MaxAgeHours"/>) instead
/// of dropping it. <paramref name="spool"/> being <see langword="null"/> (the env var disabled, or a caller —
/// e.g. every pre-WI-3 test in <c>UnsBridgeTests</c> — simply doesn't pass one) reproduces PRE-WI-3 behavior
/// byte-for-byte: <see cref="RunForwardLoopAsync"/> drains the channel directly and drops whatever arrives
/// while the remote client isn't connected. See <see cref="IBridgeSpool"/>'s own doc comment for why every
/// spool call is safe to make without a defensive try/catch around it for THAT interface's own promised
/// never-throws contract — this class still wraps each loop ITERATION in a broad catch, purely so a test
/// double (or a future spool implementation) that violates that contract can never take the bridge down.</para>
/// </summary>
public sealed class UnsBridge : IAsyncDisposable
{
    private const string SparkplugTopicFilter = "spBv1.0/#";
    private const string SemanticTopicFilter = "syn/#";
    private const string SemanticNamespacePrefix = "syn/";
    private const string LoopbackHost = "127.0.0.1";
    private const int ChannelCapacity = 10_000;
    private const int SpoolPeekBatchSize = 200;

    private static readonly TimeSpan MonitorInterval = TimeSpan.FromMilliseconds(200);
    private static readonly TimeSpan InitialBackoff = TimeSpan.FromMilliseconds(250);
    private static readonly TimeSpan MaxBackoff = TimeSpan.FromSeconds(10);
    private static readonly TimeSpan DrainTimeout = TimeSpan.FromSeconds(5);

    /// <summary>How often the spool forward loop re-runs <see cref="IBridgeSpool.TrimAsync"/> to enforce the
    /// age/byte caps — independent of connectivity (a long outage is exactly when the spool most needs
    /// trimming). Short enough to be observable in a bounded test wait, cheap enough (a bounded SQLite
    /// aggregate query, see <see cref="BridgeSpool"/>'s own doc comment) to run this often in production.</summary>
    private static readonly TimeSpan TrimInterval = TimeSpan.FromSeconds(5);

    /// <summary>How long the spool forward/writer loops back off after an iteration threw (a spool
    /// implementation violating its own documented never-throws contract — see this class' own doc comment)
    /// — never a tight retry loop against a permanently broken collaborator.</summary>
    private static readonly TimeSpan FaultBackoff = TimeSpan.FromMilliseconds(500);

    /// <summary>WI-3 review fix round 1 (CRITICAL) — the starting/ceiling backoff for a replay PASS that
    /// makes zero forward progress on a NON-empty batch (the oldest spooled item is being persistently
    /// rejected by the Site broker, e.g. MQTT reason code 0x87 Not Authorized or 0x97 Quota Exceeded, or
    /// <see cref="IBridgeSpool.AckThroughAsync"/> silently failing to actually delete the row — see
    /// <see cref="TryReplayOneBatchAsync"/>'s own doc comment). Without this, the loop would retry the SAME
    /// rejected publish at zero delay, forever: sustained 100% CPU/disk I/O on an unattended edge device, and
    /// the same message hammering the Site thousands of times a second. Same doubling-with-cap shape as
    /// <see cref="ConnectionLoopAsync"/>'s own <see cref="InitialBackoff"/>/<see cref="MaxBackoff"/>, kept as
    /// separate constants because a replay stall and a transport-level reconnect are different failure modes
    /// with no reason to share a cadence.</summary>
    private static readonly TimeSpan ReplayStallInitialBackoff = TimeSpan.FromMilliseconds(500);
    private static readonly TimeSpan ReplayStallMaxBackoff = TimeSpan.FromSeconds(30);

    private static readonly JsonSerializerOptions ResyncJsonOptions = new()
    {
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
        Converters = { new JsonStringEnumConverter(JsonNamingPolicy.CamelCase) },
    };

    private readonly record struct ForwardItem(string Topic, byte[] Payload, bool Retain);

    /// <summary>WI-3 review fix round 1 (CRITICAL) — the outcome of one <see cref="TryReplayOneBatchAsync"/>
    /// pass, distinguishing "nothing to do" from "tried and made zero progress" — the caller
    /// (<see cref="RunSpoolForwardLoopAsync"/>) treats these very differently: <see cref="Empty"/> is a
    /// healthy idle state (poll at the normal cadence); <see cref="NoProgress"/> means the Site broker (or
    /// the spool's own ack) is stuck and MUST back off, escalating, or it spins.</summary>
    private enum ReplayBatchOutcome
    {
        Empty,
        Progress,
        NoProgress,
    }

    /// <summary>GĐ3 closeout WI-3 — the retained record published to
    /// <see cref="UnsTopicBuilder.BuildBridgeResyncTopic"/> immediately after a successful remote reconnect
    /// and BEFORE replaying any backlog, so the Site learns a gap exists (and exactly how big) before the
    /// backfill itself arrives. Property names are exactly the brief's wire shape via
    /// <see cref="ResyncJsonOptions"/>'s camelCase policy.</summary>
    private sealed record ResyncRecord(
        DateTimeOffset ResumedAtUtc,
        long BacklogDepth,
        DateTimeOffset? OldestUtc,
        long FirstSeq,
        long LastAckedSeq,
        long DroppedTotal);

    private readonly bool _enabled;
    private readonly string _deviceFingerprint;
    private readonly Action<string>? _logWarning;
    private readonly Action<Exception, string>? _logError;
    private readonly UnsOptions? _localUns;
    private readonly IBridgeSpool? _spool;

    private readonly IMqttClient? _localClient;
    private readonly IMqttClient? _remoteClient;
    private readonly Channel<ForwardItem>? _channel;
    private readonly CancellationTokenSource _cts = new();
    private readonly Task? _localConnectLoop;
    private readonly Task? _remoteConnectLoop;
    private readonly Task? _forwardLoop;
    private readonly Task? _spoolWriterLoop;

    private volatile bool _everConnectedRemote;
    private volatile string? _lastError;
    private volatile string? _siteFingerprint;
    private volatile bool _disposed;
    private volatile BridgeSpoolStats? _lastSpoolStats;
    private long _lastAckedSeq;

    /// <summary>WI-3 review fix round 1 (IMPORTANT 2) — set (and never cleared) the moment either spool
    /// background loop terminates for any reason OTHER than this bridge's own shutdown cancellation. Checked
    /// by <see cref="Snapshot"/> so a dead loop is never silently reported as <see cref="BridgeState.Connected"/>/
    /// <see cref="BridgeState.Degraded"/> — see <see cref="BridgeState.Faulted"/>'s own doc comment.</summary>
    private volatile bool _spoolWriterFaulted;
    private volatile bool _spoolForwardFaulted;

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
    /// <param name="logWarning">Optional recoverable-condition logger (same delegate shape as every other
    /// GĐ3 UNS-adjacent type — see <see cref="UnsPublisher"/>'s own doc comment for why a plain delegate,
    /// not <c>ILogger</c>).</param>
    /// <param name="logError">Optional fault logger.</param>
    /// <param name="spool">GĐ3 closeout WI-3 — the durable northbound spool backing the forward path, or
    /// <see langword="null"/> to reproduce this bridge's PRE-WI-3 behavior exactly (drop whatever arrives
    /// while the remote client isn't connected — see this class' own doc comment). The composition root
    /// (<c>SiteBridgeManager</c>/<c>Program.cs</c>) decides which by consulting
    /// <see cref="BridgeSpoolOptions.Enabled"/> — this constructor never reads the environment itself, same
    /// "resolve options once at the composition root, take the resolved collaborator as a plain constructor
    /// parameter" idiom <see cref="St4i.EdgeCore.Historian.HistorianWriter"/> already uses for
    /// <see cref="St4i.EdgeCore.Historian.IHistorianStore"/>.</param>
    public UnsBridge(
        UnsOptions localUns,
        PersistedSiteLink siteLink,
        X509Certificate2 deviceCert,
        string deviceFingerprint,
        Action<string>? logWarning = null,
        Action<Exception, string>? logError = null,
        IBridgeSpool? spool = null)
    {
        ArgumentNullException.ThrowIfNull(localUns);
        ArgumentNullException.ThrowIfNull(siteLink);
        ArgumentNullException.ThrowIfNull(deviceCert);
        ArgumentException.ThrowIfNullOrEmpty(deviceFingerprint);

        _deviceFingerprint = deviceFingerprint;
        _logWarning = logWarning;
        _logError = logError;
        _enabled = siteLink.Enabled;
        _localUns = localUns;
        _spool = spool;

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

        // GĐ3 closeout WI-3 — spool present ⇒ the NEW write-behind-writer + spool-backed-forward topology;
        // spool null (env-disabled, or a caller that simply doesn't pass one) ⇒ the ORIGINAL single loop
        // that drains the channel directly and drops while disconnected, completely unchanged.
        if (_spool is not null)
        {
            _spoolWriterLoop = Task.Run(() => RunSpoolWriterLoopAsync(_cts.Token));
            _forwardLoop = Task.Run(() => RunSpoolForwardLoopAsync(_cts.Token));
        }
        else
        {
            _forwardLoop = Task.Run(() => RunForwardLoopAsync(_cts.Token));
        }
    }

    /// <summary>A point-in-time read of this bridge's health — see <see cref="BridgeState"/> for the
    /// exact state semantics.</summary>
    public BridgeStatusSnapshot Snapshot()
    {
        if (!_enabled)
        {
            return new BridgeStatusSnapshot(BridgeState.Disabled, null, null, _deviceFingerprint, 0, 0, 0);
        }

        var state = !_localClient!.IsConnected
            ? BridgeState.Down
            : _remoteClient!.IsConnected
                ? BridgeState.Connected
                : _everConnectedRemote
                    ? BridgeState.Degraded
                    : BridgeState.Connecting;

        // WI-3 review fix round 1 (IMPORTANT 2) — a dead spool loop takes priority over whatever the MQTT
        // clients otherwise look like: the clients can be perfectly Connected while the writer loop has
        // stopped persisting messages, or the forward loop has stopped replaying/acking them — silently
        // reporting Connected in that case is exactly the "fails silently" failure mode this task exists to
        // eliminate. See BridgeState.Faulted's own doc comment.
        if (_spoolWriterFaulted || _spoolForwardFaulted)
        {
            state = BridgeState.Faulted;
        }

        // GĐ3 closeout WI-3 — a snapshot of the spool forward loop's own last-seen stats/bookkeeping. All
        // zero when there's no spool at all (ST4I_BRIDGE_SPOOL_ENABLED=0) — never garbage; see
        // BridgeStatusSnapshot's own doc comment.
        var stats = _lastSpoolStats;
        return new BridgeStatusSnapshot(
            state, _lastError, _siteFingerprint, _deviceFingerprint,
            SpoolDepth: stats?.Depth ?? 0,
            LastAckedSeq: Interlocked.Read(ref _lastAckedSeq),
            DroppedTotal: stats?.DroppedTotal ?? 0);
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

    // ─────────────────────────────────────────────────────────────────────
    // GĐ3 closeout WI-3 — the spool-backed writer + forward loops (active only when _spool is non-null).
    // ─────────────────────────────────────────────────────────────────────

    /// <summary>WI-3 review fix round 1 (IMPORTANT 2) — invokes <see cref="_logWarning"/>, if any, inside its
    /// OWN try/catch: a throwing log delegate (e.g. <c>Console.Error.WriteLine</c> on a closed stderr pipe —
    /// exactly how <c>Program.cs</c> wires this) must never itself take a background loop down. Swallowed
    /// silently on failure — there is nowhere left to report a broken logger to.</summary>
    private void SafeLogWarning(string message)
    {
        try { _logWarning?.Invoke(message); } catch { /* logging must never take a loop down */ }
    }

    /// <summary>Same rationale as <see cref="SafeLogWarning"/>, for <see cref="_logError"/>.</summary>
    private void SafeLogError(Exception ex, string message)
    {
        try { _logError?.Invoke(ex, message); } catch { /* logging must never take a loop down */ }
    }

    /// <summary>Write-behind: drains the SAME bounded channel <see cref="OnLocalMessageReceivedAsync"/>
    /// feeds into <see cref="IBridgeSpool.EnqueueAsync"/> — the local subscriber callback still never touches
    /// SQLite; only this background task does. NOTE: <see cref="IBridgeSpool"/> has no batch-insert overload
    /// (WI-2's own contract), so despite the "write-behind" idiom name this is one full
    /// open-connection/PRAGMAs/INSERT/<c>last_insert_rowid()</c> round trip PER MESSAGE, not a real batch
    /// write — a forced consequence of the interface this task consumes, worth knowing for throughput
    /// planning. A <c>-1</c> return (the spool's OWN documented safe failure — never throws) means the item
    /// was NOT persisted: logged and moved on, the same "message is simply lost" outcome as this bridge's
    /// pre-WI-3 silent drop, just no longer invisible. Each item is wrapped in its own broad catch purely as
    /// defense-in-depth against a spool implementation that violates its documented never-throws contract
    /// (e.g. a test double) — a real <see cref="BridgeSpool"/> never takes that branch. If this loop itself
    /// ever terminates for a reason OTHER than this bridge's own shutdown cancellation, that is a FAULT (see
    /// <see cref="_spoolWriterFaulted"/>) — messages silently stop being persisted otherwise, with nothing to
    /// show for it.</summary>
    private async Task RunSpoolWriterLoopAsync(CancellationToken ct)
    {
        try
        {
            var reader = _channel!.Reader;
            while (await reader.WaitToReadAsync(ct).ConfigureAwait(false))
            {
                while (reader.TryRead(out var item))
                {
                    try
                    {
                        var seq = await _spool!.EnqueueAsync(item.Topic, item.Payload, item.Retain, ct).ConfigureAwait(false);
                        if (seq < 0)
                        {
                            SafeLogWarning($"Site bridge could not spool {item.Topic} — the message was not persisted and is lost.");
                        }
                    }
                    catch (OperationCanceledException) when (ct.IsCancellationRequested)
                    {
                        throw;
                    }
                    catch (Exception ex)
                    {
                        SafeLogWarning($"Site bridge spool writer failed for {item.Topic}: {ex.Message}");
                        await Task.Delay(FaultBackoff, ct).ConfigureAwait(false);
                    }
                }
            }
        }
        catch (OperationCanceledException) when (ct.IsCancellationRequested)
        {
            // Expected on shutdown.
        }
        catch (Exception ex)
        {
            // WI-3 review fix round 1 (IMPORTANT 2) — anything else — including an OperationCanceledException
            // NOT caused by our own shutdown token, or an exception a throwing log delegate raised despite
            // SafeLogWarning above (belt-and-braces) — means this loop is now DEAD: no channel item will ever
            // be persisted again. Never silently swallow this.
            _spoolWriterFaulted = true;
            _lastError = $"Site bridge spool writer loop terminated unexpectedly: {ex.Message}";
            SafeLogError(ex, "Site bridge spool writer loop terminated unexpectedly — messages are no longer being persisted to the spool");
        }
    }

    /// <summary>The durable-spool forward loop: while the remote client is connected, peeks/publishes/acks
    /// the spool; while disconnected, idles (no peek, no ack — the spool is the only place backlog
    /// accumulates). Publishes the retained resync record on every transition INTO "connected" (including
    /// this bridge's very first connect) BEFORE attempting any replay — see <see cref="PublishResyncRecordAsync"/>'s
    /// own doc comment for why that ordering is deliberate. Runs <see cref="IBridgeSpool.TrimAsync"/> on its
    /// own independent cadence (<see cref="TrimInterval"/>) regardless of connectivity: a long outage is
    /// exactly when the spool most needs its age/byte caps enforced.
    ///
    /// <para>WI-3 review fix round 1 (CRITICAL) — a replay pass that publishes NOTHING off a NON-empty batch
    /// (<see cref="ReplayBatchOutcome.NoProgress"/>) is treated as a STALL, not as "caught up": it backs off
    /// on its own escalating <c>replayStallBackoff</c> (reset on any real progress or a genuinely empty
    /// batch), instead of looping at zero delay against a persistently-rejecting Site broker or a silently
    /// failing ack forever.</para></summary>
    private async Task RunSpoolForwardLoopAsync(CancellationToken ct)
    {
        var wasConnected = false;
        var lastTrimUtc = DateTimeOffset.MinValue;
        var replayStallBackoff = ReplayStallInitialBackoff;

        try
        {
            while (!ct.IsCancellationRequested)
            {
                BridgeSpoolStats stats;
                try
                {
                    stats = await _spool!.StatsAsync(ct).ConfigureAwait(false);
                    _lastSpoolStats = stats;
                }
                catch (OperationCanceledException) when (ct.IsCancellationRequested)
                {
                    throw;
                }
                catch (Exception ex)
                {
                    SafeLogWarning($"Site bridge spool StatsAsync failed: {ex.Message}");
                    await Task.Delay(FaultBackoff, ct).ConfigureAwait(false);
                    continue;
                }

                var isConnected = _remoteClient!.IsConnected;

                if (isConnected && !wasConnected)
                {
                    // BEFORE any replay — deliberate: the Site must learn a gap MIGHT exist before the
                    // backfill itself starts arriving (see PublishResyncRecordAsync's own doc comment).
                    await PublishResyncRecordAsync(stats, ct).ConfigureAwait(false);
                }

                wasConnected = isConnected;

                if (isConnected)
                {
                    var outcome = await TryReplayOneBatchAsync(ct).ConfigureAwait(false);
                    switch (outcome)
                    {
                        case ReplayBatchOutcome.Progress:
                            // Real progress — reset the stall backoff and loop again immediately; there is
                            // likely more behind it.
                            replayStallBackoff = ReplayStallInitialBackoff;
                            break;

                        case ReplayBatchOutcome.Empty:
                            // Caught up — a healthy idle state, not a stall. Reset the backoff too (a prior
                            // stall is over) and poll at the normal cadence rather than busy-polling.
                            replayStallBackoff = ReplayStallInitialBackoff;
                            await Task.Delay(MonitorInterval, ct).ConfigureAwait(false);
                            break;

                        case ReplayBatchOutcome.NoProgress:
                        default:
                            // CRITICAL fix: a non-empty batch that published NOTHING — see this method's own
                            // doc comment and ReplayStallInitialBackoff's. Escalating backoff, never a spin.
                            // Deliberately does NOT overwrite _lastError here: TryReplayOneBatchAsync (via
                            // TryPublishToRemoteAsync, or its own ack-verification guard) already recorded
                            // the SPECIFIC reason (publish rejected vs. an ack that silently didn't stick) —
                            // clobbering it with a generic message here would throw away exactly the detail
                            // an operator needs to tell those two failure modes apart.
                            SafeLogWarning($"Site bridge replay made no progress this pass; backing off {replayStallBackoff}.");
                            await Task.Delay(replayStallBackoff, ct).ConfigureAwait(false);
                            replayStallBackoff = TimeSpan.FromMilliseconds(
                                Math.Min(replayStallBackoff.TotalMilliseconds * 2, ReplayStallMaxBackoff.TotalMilliseconds));
                            break;
                    }
                }
                else
                {
                    replayStallBackoff = ReplayStallInitialBackoff;
                    await Task.Delay(MonitorInterval, ct).ConfigureAwait(false);
                }

                if (DateTimeOffset.UtcNow - lastTrimUtc >= TrimInterval)
                {
                    try
                    {
                        await _spool!.TrimAsync(ct).ConfigureAwait(false);
                    }
                    catch (OperationCanceledException) when (ct.IsCancellationRequested)
                    {
                        throw;
                    }
                    catch (Exception ex)
                    {
                        SafeLogWarning($"Site bridge spool TrimAsync failed: {ex.Message}");
                    }

                    lastTrimUtc = DateTimeOffset.UtcNow;
                }
            }
        }
        catch (OperationCanceledException) when (ct.IsCancellationRequested)
        {
            // Expected on shutdown.
        }
        catch (Exception ex)
        {
            // WI-3 review fix round 1 (IMPORTANT 2) — see RunSpoolWriterLoopAsync's matching catch for the
            // full rationale. This loop dying silently would mean replay/ack has stopped while Snapshot()
            // keeps reporting Connected/Degraded as if everything were fine.
            _spoolForwardFaulted = true;
            _lastError = $"Site bridge spool forward loop terminated unexpectedly: {ex.Message}";
            SafeLogError(ex, "Site bridge spool forward loop terminated unexpectedly — replay/ack has stopped");
        }
    }

    /// <summary>One <see cref="IBridgeSpool.PeekBatchAsync"/> → publish-each → <see
    /// cref="IBridgeSpool.AckThroughAsync"/>(last success) pass. Returns <see cref="ReplayBatchOutcome.Empty"/>
    /// when there was nothing to replay, <see cref="ReplayBatchOutcome.Progress"/> when at least one item was
    /// published AND verifiably acked, and <see cref="ReplayBatchOutcome.NoProgress"/> when the batch was
    /// non-empty but nothing actually advanced.
    ///
    /// <para>WI-3 review fix round 1 (IMPORTANT 1) — <see cref="IBridgeSpool.AckThroughAsync"/> has NO
    /// success signal by contract: it swallows every exception and returns normally either way, so a locked
    /// DB or a full disk make the DELETE a silent no-op that looks identical to success. Blindly trusting it
    /// would set <see cref="_lastAckedSeq"/> (and the resync record's <c>lastAckedSeq</c>) to a seq that was
    /// never actually removed, and the SAME rows would republish forever. This method re-peeks (a cheap
    /// 1-row read) after every ack to verify the row is actually gone before advancing anything.</para></summary>
    private async Task<ReplayBatchOutcome> TryReplayOneBatchAsync(CancellationToken ct)
    {
        IReadOnlyList<SpooledItem> batch;
        try
        {
            batch = await _spool!.PeekBatchAsync(SpoolPeekBatchSize, ct).ConfigureAwait(false);
        }
        catch (OperationCanceledException) when (ct.IsCancellationRequested)
        {
            throw;
        }
        catch (Exception ex)
        {
            SafeLogWarning($"Site bridge spool PeekBatchAsync failed: {ex.Message}");
            await Task.Delay(FaultBackoff, ct).ConfigureAwait(false);
            return ReplayBatchOutcome.Empty;
        }

        if (batch.Count == 0) return ReplayBatchOutcome.Empty;

        // THE partial-batch ack rule this task exists to get right: the first publish that fails stops the
        // batch right there. Everything from that item onward — never attempted — stays in the spool
        // exactly as is, for the next pass. Acking the whole batch would lose data; acking nothing would
        // re-send the prefix that already succeeded forever (at-least-once, not at-least-once-forever).
        long? lastSuccessSeq = null;
        foreach (var item in batch)
        {
            var published = await TryPublishToRemoteAsync(item, ct).ConfigureAwait(false);
            if (!published)
            {
                break;
            }

            lastSuccessSeq = item.Seq;
        }

        if (lastSuccessSeq is not { } seq)
        {
            // The very first item in the batch failed — this whole pass made zero progress. CRITICAL fix:
            // the caller must back off, not spin.
            return ReplayBatchOutcome.NoProgress;
        }

        try
        {
            await _spool!.AckThroughAsync(seq, ct).ConfigureAwait(false);
        }
        catch (OperationCanceledException) when (ct.IsCancellationRequested)
        {
            throw;
        }
        catch (Exception ex)
        {
            _lastError = $"Site bridge spool AckThroughAsync failed for seq {seq}: {ex.Message}";
            SafeLogWarning(_lastError);
            return ReplayBatchOutcome.NoProgress;
        }

        // IMPORTANT 1 guard: verify the ack actually took effect (see this method's own doc comment) rather
        // than trusting a call that has no success signal at all.
        IReadOnlyList<SpooledItem> verify;
        try
        {
            verify = await _spool!.PeekBatchAsync(1, ct).ConfigureAwait(false);
        }
        catch (OperationCanceledException) when (ct.IsCancellationRequested)
        {
            throw;
        }
        catch (Exception)
        {
            // Can't verify right now — the ack call itself didn't throw, so don't punish it on top of an
            // unrelated peek hiccup; a genuinely stuck ack will still be caught on the NEXT pass's own
            // verification.
            verify = Array.Empty<SpooledItem>();
        }

        if (verify.Count > 0 && verify[0].Seq <= seq)
        {
            _lastError = $"Site bridge ack for seq {seq} did not take effect (row still present after " +
                         "AckThroughAsync) — the spool store may be failing writes.";
            SafeLogWarning(_lastError);
            return ReplayBatchOutcome.NoProgress; // do NOT advance _lastAckedSeq on an ack that didn't stick.
        }

        Interlocked.Exchange(ref _lastAckedSeq, seq);
        return ReplayBatchOutcome.Progress;
    }

    /// <summary>Publishes one spooled item to the remote client (QoS AtLeastOnce, retain per the
    /// pre-existing "syn/" rule). Returns whether it succeeded — "failed" covers BOTH a socket-level
    /// exception (the connection dropped mid-batch) AND a broker-level rejection surfaced through
    /// <c>MqttClientPublishResult.IsSuccess</c>/<c>ReasonCode</c>: MQTTnet 5's client does NOT throw merely
    /// because the broker returned a non-success PUBACK reason code (only genuine socket/connectivity
    /// failures throw — see the MQTTnet 4→5 upgrade notes, "less exceptions when connecting"/publishing), so
    /// <c>IsSuccess</c> must be checked explicitly or a broker-rejected publish would be silently counted as
    /// delivered and its seq would be acked/deleted despite never having arrived.</summary>
    private async Task<bool> TryPublishToRemoteAsync(SpooledItem item, CancellationToken ct)
    {
        try
        {
            var message = new MqttApplicationMessageBuilder()
                .WithTopic(item.Topic)
                .WithPayload(item.Payload)
                .WithRetainFlag(item.Retain)
                .WithQualityOfServiceLevel(MqttQualityOfServiceLevel.AtLeastOnce)
                .Build();
            var result = await _remoteClient!.PublishAsync(message, ct).ConfigureAwait(false);
            if (result.IsSuccess) return true;

            _lastError = $"seq {item.Seq} ({item.Topic}) rejected: {result.ReasonCode}";
            SafeLogWarning($"Site bridge publish rejected by the Site broker for spooled seq {item.Seq} ({item.Topic}): {result.ReasonCode} — retrying on the next pass.");
            return false;
        }
        catch (OperationCanceledException)
        {
            throw;
        }
        catch (Exception ex)
        {
            _lastError = ex.Message;
            SafeLogWarning($"Site bridge failed to forward spooled seq {item.Seq} ({item.Topic}) to the Site broker: {ex.Message} — retrying on the next pass.");
            return false;
        }
    }

    /// <summary>Publishes, RETAINED, to <see cref="UnsTopicBuilder.BuildBridgeResyncTopic"/> — immediately
    /// after a successful remote reconnect and deliberately BEFORE any backlog replay is attempted (the
    /// caller, <see cref="RunSpoolForwardLoopAsync"/>, guarantees that ordering), so the Site learns a gap
    /// might exist — and exactly how big — before the backfill itself starts arriving. Uses the same
    /// camelCase JSON convention <see cref="UnsPublisher"/>'s own semantic-mirror publishes already use (see
    /// <see cref="ResyncJsonOptions"/>). Never throws into the forward loop — a failure here (including a
    /// broker rejection) is logged and does NOT block the replay that follows; the resync record is
    /// best-effort telemetry, not a gate.
    ///
    /// <para>WI-3 review fix round 1 (IMPORTANT 3) — published at QoS <c>AtLeastOnce</c>, matching every
    /// backlog item. The original version omitted the QoS builder call entirely, defaulting to
    /// <c>AtMostOnce</c>: with no PUBACK at all, <c>result.IsSuccess</c> is unconditionally <see
    /// langword="true"/>, so the "rejected by the broker" check could never fire — the one message whose
    /// entire purpose is telling the Site a gap exists would have been the LEAST reliably delivered thing in
    /// the whole design.</para></summary>
    private async Task PublishResyncRecordAsync(BridgeSpoolStats stats, CancellationToken ct)
    {
        try
        {
            var record = new ResyncRecord(
                ResumedAtUtc: DateTimeOffset.UtcNow,
                BacklogDepth: stats.Depth,
                OldestUtc: stats.OldestUtc,
                FirstSeq: stats.MinSeq,
                LastAckedSeq: Interlocked.Read(ref _lastAckedSeq),
                DroppedTotal: stats.DroppedTotal);
            var json = JsonSerializer.Serialize(record, ResyncJsonOptions);
            var topic = UnsTopicBuilder.BuildBridgeResyncTopic(_localUns!);
            var message = new MqttApplicationMessageBuilder()
                .WithTopic(topic)
                .WithPayload(json)
                .WithRetainFlag(true)
                .WithQualityOfServiceLevel(MqttQualityOfServiceLevel.AtLeastOnce)
                .Build();
            var result = await _remoteClient!.PublishAsync(message, ct).ConfigureAwait(false);
            if (!result.IsSuccess)
            {
                SafeLogWarning($"Site bridge resync record was rejected by the Site broker: {result.ReasonCode}");
            }
        }
        catch (OperationCanceledException)
        {
            throw;
        }
        catch (Exception ex)
        {
            SafeLogWarning($"Site bridge failed to publish the resync record: {ex.Message}");
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
    /// the forward channel, give the (spool writer, when present, else the legacy forward loop) up to
    /// <see cref="DrainTimeout"/> to flush whatever's still buffered, THEN cancel both connect loops AND the
    /// spool forward loop (it has no natural "drained" signal of its own — it's a polling loop over the
    /// spool, not the channel) and disconnect/dispose both clients. Idempotent (guarded by
    /// <see cref="_disposed"/>) and a trivial no-op for a disabled link (nothing was ever created).</summary>
    public async ValueTask DisposeAsync()
    {
        if (_disposed) return;
        _disposed = true;

        if (!_enabled)
        {
            return;
        }

        _channel!.Writer.TryComplete();

        // GĐ3 closeout WI-3 — when a spool is present, it's the WRITER loop (draining the channel into
        // EnqueueAsync) whose drain matters here, not the forward loop (which never reads the channel at
        // all in that mode — see this class' own doc comment).
        var channelDrainTarget = _spoolWriterLoop ?? _forwardLoop;
        try
        {
            await channelDrainTarget!.WaitAsync(DrainTimeout).ConfigureAwait(false);
        }
        catch (TimeoutException)
        {
            // Fall through to the hard cancel below.
        }

        _cts.Cancel();

        foreach (var loop in new[] { _forwardLoop, _spoolWriterLoop })
        {
            if (loop is null) continue;

            try
            {
                await loop.ConfigureAwait(false);
            }
            catch
            {
                // Best-effort — already reported (if it failed) inside the loop itself.
            }
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
