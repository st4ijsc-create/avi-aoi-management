using System.Collections.Concurrent;
using System.Text.Json;
using System.Text.Json.Serialization;
using System.Threading.Channels;
using MQTTnet;
using St4i.EdgeCore.Models;
using St4i.Connector.Abstractions.Models;
using St4i.EdgeCore.Uns.Sparkplug;

namespace St4i.EdgeCore.Uns;

/// <summary>
/// 🔴 Task AP-1 (owner decision 15, 2026-08-21) — this publisher's own classified drop accounting. Same
/// record shape, same split and the same reason as
/// <see cref="St4i.EdgeCore.Historian.HistorianWriterStats"/>: the two ways a publish is lost here mean
/// opposite things to an operator, and until this task existed neither of them was counted at all.
/// </summary>
/// <param name="Evicted">Work items the CHANNEL threw away because it was FULL — the
/// <see cref="BoundedChannelFullMode.DropOldest"/> eviction <c>TryWrite</c> performs while still returning
/// <see langword="true"/>. Counted from the channel's own <c>itemDropped</c> callback, the only place this
/// loss is observable. Non-zero means the UNS spine has permanently lost publishes: readings, device
/// birth/death, node birth/death or line state.</param>
/// <param name="DroppedAfterShutdown">Work items refused because this publisher was already disposed, or its
/// channel writer completed by <see cref="UnsPublisher.DisposeAsync"/>. Expected during a clean shutdown and
/// NOT a sign that the broker is falling behind.</param>
/// <param name="Queued">How deep the work queue is RIGHT NOW — a gauge, not a cumulative counter.</param>
public sealed record UnsPublisherStats(long Evicted, long DroppedAfterShutdown, int Queued);

/// <summary>
/// G2-2 — the dual-topic publisher for the local Unified Namespace spine: for every committed reading,
/// publishes (1) the Sparkplug B DDATA payload (hand-rolled <see cref="SparkplugPayload"/> encoding) and
/// (2) the retained semantic-mirror JSON (<c>syn/...</c>, the reading's own <see cref="CanonicalEnvelope"/>)
/// — see <see cref="UnsTopicBuilder"/> for exactly how each topic string is built.
///
/// Internal shape is COPIED from <see cref="St4i.EdgeCore.Historian.HistorianWriter"/> on purpose (the
/// task brief's explicit instruction): a bounded <see cref="Channel{T}"/> (drop-oldest when saturated) fed
/// by <see cref="PublishReading"/>/<see cref="PublishBirth"/>/<see cref="PublishDeath"/>/
/// <see cref="PublishNodeBirth"/>/<see cref="PublishNodeDeath"/> (G2-3 — the last two are the NODE-level
/// NBIRTH/NDEATH lifecycle) — all five are synchronous, non-blocking, and never throw — drained by a
/// background flush loop that does the actual (async) MQTT publish. A broker hiccup (disconnected client,
/// slow broker, ...) can therefore NEVER slow or fail
/// <see cref="St4i.EdgeCore.Engine.EdgePipeline.RunAsync"/>'s hot commit loop — at worst, one reading's UNS
/// mirror is dropped (logged via the optional <c>logWarning</c>/<c>logError</c> delegates, same "St4i.EdgeCore
/// doesn't reference Microsoft.Extensions.Logging" reasoning HistorianWriter's own doc comment gives) while
/// the ST4I HTTP path/<c>Committed</c> event carry on completely unaffected.
///
/// Connects to the broker in the BACKGROUND from the constructor (same non-blocking-ctor idiom
/// <see cref="St4i.EdgeCore.Drivers.Mqtt.MqttDriver"/> already uses) — always loopback-only
/// (<see cref="LoopbackHost"/>), matching <see cref="UnsBroker"/>'s own bind. The flush loop awaits that
/// SAME connect task once (not busy-polling) before attempting its first publish, so readings enqueued
/// immediately after construction aren't dropped purely because the TCP handshake hasn't finished yet.
/// </summary>
public sealed class UnsPublisher : IUnsPublisher, IAsyncDisposable
{
    private const string LoopbackHost = "127.0.0.1";

    private static readonly JsonSerializerOptions SemanticJsonOptions = new()
    {
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
        Converters = { new JsonStringEnumConverter(JsonNamingPolicy.CamelCase) },
    };

    private abstract record WorkItem;

    private sealed record ReadingWorkItem(DeviceReading Reading, CanonicalEnvelope Envelope) : WorkItem;

    private sealed record BirthWorkItem(string EquipmentCode) : WorkItem;

    private sealed record DeathWorkItem(string EquipmentCode) : WorkItem;

    private sealed record NodeBirthWorkItem(long BdSeq) : WorkItem;

    private sealed record NodeDeathWorkItem(long BdSeq) : WorkItem;

    /// <summary>GĐ3 sub-4 LC-3 — see <see cref="PublishLineState"/>.</summary>
    private sealed record LineStateWorkItem(string State) : WorkItem;

    private const string BdSeqMetricName = "bdSeq"; // exact spec metric name (case-sensitive)

    private readonly UnsOptions _options;
    private readonly IMqttClient _client;
    private readonly Action<string>? _logWarning;
    private readonly Action<Exception, string>? _logError;
    private readonly Channel<WorkItem> _channel;
    private readonly CancellationTokenSource _cts = new();
    private readonly Task _connectTask;
    private readonly Task _flushLoop;
    private readonly SparkplugSeqTracker _seq = new();
    private readonly ConcurrentDictionary<string, SparkplugAliasTable> _aliasTables = new(StringComparer.OrdinalIgnoreCase);
    private readonly object _lifecycleGate = new();
    private long _bdSeq = -1; // first PublishNodeBirth resolves to bdSeq 0
    private bool _nodeBorn;
    private volatile bool _disposed;

    /// <summary>🔴 Task AP-1 — see <see cref="UnsPublisherStats.Evicted"/>. Incremented ONLY from the
    /// channel's <c>itemDropped</c> callback, which fires synchronously inside <c>TryWrite</c> on the calling
    /// thread. The six <c>Publish*</c> methods take no lock covering the write (the commit path must never
    /// wait on this class), so the warning is raised from inside the callback where it is exact rather than
    /// by bracketing this counter around each write.</summary>
    private long _evicted;

    /// <summary>🔴 Task AP-1 — see <see cref="UnsPublisherStats.DroppedAfterShutdown"/>.</summary>
    private long _droppedAfterShutdown;

    /// <summary>Builds the publisher and STARTS IT: the MQTT client is created and its connect task and
    /// flush loop are launched from inside this constructor, so an instance is live the moment it is
    /// returned and must be disposed even if nothing is ever published through it.</summary>
    /// <param name="options">The ISA-95 address and broker port every topic is built from. Required —
    /// null throws <see cref="ArgumentNullException"/>. The connection is always to loopback; only the
    /// PORT is taken from here, never a host.</param>
    /// <param name="logWarning">Optional message-only channel. Null means the corresponding failures are
    /// simply not reported anywhere — this class has no fallback sink.</param>
    /// <param name="logError">Optional exception-carrying channel, same "null means silent"
    /// consequence.</param>
    /// <param name="capacity">Depth of the bounded work queue between the caller's non-blocking
    /// <c>Publish*</c> call and the background flush loop.
    /// <para>🔴 <b>Read the queue's mode before reading the "queue saturated" warnings below it.</b> The
    /// channel is <see cref="BoundedChannelFullMode.DropOldest"/>. Under that mode a write to a FULL
    /// channel SUCCEEDS — it evicts the oldest pending item and accepts the new one — so
    /// <c>TryWrite</c> returns <see langword="true"/> and every <c>"UNS publish queue saturated"</c> branch
    /// in this class is unreachable by saturation. Those branches can only be reached by a channel that has
    /// been COMPLETED, which happens once at disposal. <b>The consequence stated plainly: a UNS spine that
    /// falls behind loses its OLDEST pending publishes, silently, with no warning and no counter.</b> There
    /// is no drop total on this class — contrast <see cref="St4i.EdgeCore.Site.BridgeSpool"/>, whose own
    /// drops are counted in durable storage precisely so the loss can be reported.</para>
    /// <para>🔴 <b>THE LAST TWO SENTENCES ABOVE ARE WITHDRAWN, 2026-08-21, task AP-1 (owner decision 15)</b>
    /// — quoted and retired in place, not deleted, because they were true when written and the finding they
    /// name is what produced the ruling. They read: <i>"The consequence stated plainly: a UNS spine that
    /// falls behind loses its OLDEST pending publishes, silently, with no warning and no counter. There is no
    /// drop total on this class — contrast BridgeSpool, whose own drops are counted in durable storage
    /// precisely so the loss can be reported."</i> Both halves are now false: eviction is counted
    /// (<see cref="UnsPublisherStats.Evicted"/>) and warned, from the channel's own <c>itemDropped</c>
    /// callback. The FIRST sentence of this block is NOT withdrawn and is still exactly right: under
    /// <see cref="BoundedChannelFullMode.DropOldest"/>, <c>TryWrite</c> still returns <see langword="true"/>
    /// on a full channel and the <c>if (!TryWrite(...))</c> branches are still unreachable by saturation.
    /// That is why the fix could not be to make those branches better — they were never on the path.
    /// <b>One asymmetry survives and is stated rather than left to be found:</b> the counter is in memory and
    /// dies with the process, whereas <see cref="St4i.EdgeCore.Site.BridgeSpool"/>'s <c>dropped_total</c>
    /// is durable. The contrast the withdrawn sentence drew is narrowed, not erased.</para></param>
    public UnsPublisher(
        UnsOptions options,
        Action<string>? logWarning = null,
        Action<Exception, string>? logError = null,
        int capacity = 10_000)
    {
        _options = options ?? throw new ArgumentNullException(nameof(options));
        _logWarning = logWarning;
        _logError = logError;

        var factory = new MqttClientFactory();
        _client = factory.CreateMqttClient();
        var clientOptions = factory.CreateClientOptionsBuilder()
            .WithTcpServer(LoopbackHost, options.BrokerPort)
            .WithClientId($"st4i-uns-publisher-{Guid.NewGuid():N}")
            .Build();

        _channel = Channel.CreateBounded<WorkItem>(
            new BoundedChannelOptions(capacity)
            {
                FullMode = BoundedChannelFullMode.DropOldest,
                SingleReader = true,
            },
            // 🔴 Task AP-1 (owner decision 15) — the only place the saturation loss is observable. Fires
            // synchronously from inside TryWrite; the item handed in is the one being THROWN AWAY, which is
            // why Describe (this class' own existing formatter, reused rather than duplicated) can name it —
            // the old per-method warnings named the ARRIVING item and still called it "oldest".
            itemDropped: dropped =>
            {
                Interlocked.Increment(ref _evicted);
                SafeLogWarning(
                    $"UNS publish queue saturated — evicted the OLDEST pending publish ({Describe(dropped)}) " +
                    "to make room. That publish is gone; the UNS spine is not keeping up. See " +
                    "UnsPublisher.Stats.Evicted.");
            });

        // Non-blocking ctor: connect kicks off in the background (MqttDriver's own idiom), the flush loop
        // (below) is what actually waits for it before publishing anything.
        _connectTask = ConnectAsync(clientOptions, _cts.Token);
        _flushLoop = Task.Run(() => RunFlushLoopAsync(_cts.Token));
    }

    /// <summary>🔴 Task AP-1 (owner decision 15) — classified drop accounting: how many publishes this class
    /// has thrown away, split by WHY. See <see cref="UnsPublisherStats"/>. Cheap: three reads, no lock.</summary>
    public UnsPublisherStats Stats => new(
        Interlocked.Read(ref _evicted),
        Interlocked.Read(ref _droppedAfterShutdown),
        _channel.Reader.Count);

    /// <summary>🔴 Task AP-1 — a caller-supplied logging delegate that throws must never escape a
    /// <c>Publish*</c> method (all documented never-throws) nor the channel's <c>itemDropped</c> callback,
    /// which runs inside <c>TryWrite</c>.</summary>
    private void SafeLogWarning(string message)
    {
        try { _logWarning?.Invoke(message); } catch { /* logging must never take the commit path down */ }
    }

    /// <summary>🔴 Task AP-1 — the shared tail of all six <c>Publish*</c> methods. Saturation does NOT come
    /// here (see the constructor's <c>itemDropped</c> callback); a <see langword="false"/> return means the
    /// writer has been COMPLETED, i.e. a call raced past the <c>_disposed</c> check during
    /// <see cref="DisposeAsync"/>. Counted, and worded as shutdown rather than as saturation.</summary>
    /// <param name="item">The work item that was offered to the queue.</param>
    /// <param name="what">Operator-facing description of <paramref name="item"/>, used only in the log.</param>
    private void Enqueue(WorkItem item, string what)
    {
        if (!_channel.Writer.TryWrite(item))
        {
            Interlocked.Increment(ref _droppedAfterShutdown);
            SafeLogWarning(
                $"UNS publisher is shutting down (queue closed) — dropped {what}. Expected during shutdown; " +
                "this does NOT mean the UNS spine is falling behind.");
        }
    }

    /// <summary>🔴 Task AP-1 — the shared shape of all six <c>_disposed</c> early-returns: counted, and
    /// worded as shutdown.</summary>
    /// <param name="what">Operator-facing description of the publish that was refused.</param>
    private void DropAfterDispose(string what)
    {
        Interlocked.Increment(ref _droppedAfterShutdown);
        SafeLogWarning(
            $"UNS publisher already disposed — dropped {what}. Expected during shutdown; this does NOT mean " +
            "the UNS spine is falling behind.");
    }

    /// <inheritdoc/>
    public void PublishReading(DeviceReading reading, CanonicalEnvelope envelope)
    {
        if (_disposed)
        {
            DropAfterDispose($"reading for {reading.MachineCode}");
            return;
        }

        Enqueue(new ReadingWorkItem(reading, envelope), $"reading for {reading.MachineCode}");
    }

    /// <inheritdoc/>
    public void PublishBirth(string equipmentCode)
    {
        if (_disposed)
        {
            DropAfterDispose($"birth for {equipmentCode}");
            return;
        }

        Enqueue(new BirthWorkItem(equipmentCode), $"birth for {equipmentCode}");
    }

    /// <inheritdoc/>
    public void PublishDeath(string equipmentCode)
    {
        if (_disposed)
        {
            DropAfterDispose($"death for {equipmentCode}");
            return;
        }

        Enqueue(new DeathWorkItem(equipmentCode), $"death for {equipmentCode}");
    }

    /// <inheritdoc/>
    public void PublishNodeBirth()
    {
        if (_disposed)
        {
            DropAfterDispose("node birth");
            return;
        }

        long bd;
        lock (_lifecycleGate)
        {
            bd = ++_bdSeq;
            _nodeBorn = true;
        }

        Enqueue(new NodeBirthWorkItem(bd), $"node birth bdSeq {bd}");
    }

    /// <inheritdoc/>
    public void PublishNodeDeath()
    {
        if (_disposed)
        {
            DropAfterDispose("node death");
            return;
        }

        long bd;
        lock (_lifecycleGate)
        {
            if (!_nodeBorn) return; // no NDEATH without a matching NBIRTH — idempotent stop / halt-while-idle no-op
            _nodeBorn = false;
            bd = _bdSeq;
        }

        Enqueue(new NodeDeathWorkItem(bd), $"node death bdSeq {bd}");
    }

    /// <inheritdoc/>
    public void PublishLineState(string state)
    {
        if (_disposed)
        {
            DropAfterDispose($"line state '{state}'");
            return;
        }

        Enqueue(new LineStateWorkItem(state), $"line state '{state}'");
    }

    private async Task ConnectAsync(MqttClientOptions options, CancellationToken ct)
    {
        try
        {
            await _client.ConnectAsync(options, ct).ConfigureAwait(false);
        }
        catch (OperationCanceledException)
        {
            // Disposed before connect finished — not a fault; RunFlushLoopAsync/DisposeAsync both await
            // this task in their own try/catch, so this never surfaces as an unobserved exception.
        }
    }

    private async Task RunFlushLoopAsync(CancellationToken ct)
    {
        try
        {
            // Wait for the ONE connect attempt to finish (success or failure) before processing the first
            // item — otherwise every reading published in the brief window before the TCP handshake
            // completes would be dropped as "not connected" for no good reason. If connect itself failed,
            // this just swallows it here (logged once, below) and every subsequent publish attempt will
            // fail (and be logged/dropped) on its own — never a busy-loop, never a retry storm.
            try
            {
                await _connectTask.ConfigureAwait(false);
            }
            catch (Exception ex)
            {
                _logError?.Invoke(ex, "UNS publisher failed to connect to the loopback broker");
            }

            var reader = _channel.Reader;
            while (await reader.WaitToReadAsync(ct).ConfigureAwait(false))
            {
                while (reader.TryRead(out var item))
                {
                    try
                    {
                        await ProcessAsync(item, ct).ConfigureAwait(false);
                    }
                    catch (OperationCanceledException)
                    {
                        // Shutdown in progress — nothing to report, the outer loop condition ends shortly.
                    }
                    catch (Exception ex)
                    {
                        _logError?.Invoke(ex, $"UNS publish failed for {Describe(item)}");
                    }
                }
            }
        }
        catch (OperationCanceledException)
        {
            // Expected on shutdown: DisposeAsync cancels the token while WaitToReadAsync may be pending.
        }
    }

    private static string Describe(WorkItem item) => item switch
    {
        ReadingWorkItem r => $"reading({r.Reading.MachineCode})",
        BirthWorkItem b => $"birth({b.EquipmentCode})",
        DeathWorkItem d => $"death({d.EquipmentCode})",
        NodeBirthWorkItem nb => $"nodeBirth(bdSeq={nb.BdSeq})",
        NodeDeathWorkItem nd => $"nodeDeath(bdSeq={nd.BdSeq})",
        LineStateWorkItem l => $"lineState({l.State})",
        _ => "unknown",
    };

    private Task ProcessAsync(WorkItem item, CancellationToken ct) => item switch
    {
        ReadingWorkItem r => PublishReadingCoreAsync(r.Reading, r.Envelope, ct),
        BirthWorkItem b => PublishBirthCoreAsync(b.EquipmentCode, ct),
        DeathWorkItem d => PublishDeathCoreAsync(d.EquipmentCode, ct),
        NodeBirthWorkItem nb => PublishNodeBirthCoreAsync(nb.BdSeq, ct),
        NodeDeathWorkItem nd => PublishNodeDeathCoreAsync(nd.BdSeq, ct),
        LineStateWorkItem l => PublishLineStateCoreAsync(l.State, ct),
        _ => Task.CompletedTask,
    };

    private async Task PublishReadingCoreAsync(DeviceReading reading, CanonicalEnvelope envelope, CancellationToken ct)
    {
        // (1) Retained semantic mirror — the canonical envelope itself, as JSON.
        var semanticTopic = UnsTopicBuilder.BuildSemanticTopic(_options, reading.MachineCode, reading.Kind);
        var json = JsonSerializer.Serialize(envelope, SemanticJsonOptions);
        var semanticMessage = new MqttApplicationMessageBuilder()
            .WithTopic(semanticTopic)
            .WithPayload(json)
            .WithRetainFlag(true)
            .Build();
        await _client.PublishAsync(semanticMessage, ct).ConfigureAwait(false);

        // (2) Sparkplug DDATA.
        var aliasTable = _aliasTables.GetOrAdd(reading.MachineCode, static _ => new SparkplugAliasTable());
        var metrics = BuildSparkplugMetrics(reading, aliasTable);
        var payload = new SparkplugPayloadMessage(
            (ulong)reading.Timestamp.ToUnixTimeMilliseconds(), _seq.Next(), metrics);
        var sparkplugTopic = UnsTopicBuilder.BuildSparkplugDataTopic(_options, reading.MachineCode);
        var sparkplugMessage = new MqttApplicationMessageBuilder()
            .WithTopic(sparkplugTopic)
            .WithPayload(SparkplugPayload.Encode(payload))
            .Build();
        await _client.PublishAsync(sparkplugMessage, ct).ConfigureAwait(false);
    }

    private async Task PublishBirthCoreAsync(string equipmentCode, CancellationToken ct)
    {
        // G2-3: NBIRTH now owns the sequence reset (see PublishNodeBirthCoreAsync) — per Sparkplug B spec,
        // ONLY an NBIRTH resets the edge node's sequence; a DBIRTH must NOT (fixed from G2-2, which
        // incorrectly reset here too).
        var aliasTable = _aliasTables.GetOrAdd(equipmentCode, static _ => new SparkplugAliasTable());
        aliasTable.Reset();

        var topic = UnsTopicBuilder.BuildSparkplugTopic(_options, SparkplugMsgType.DBIRTH, equipmentCode);
        var payload = new SparkplugPayloadMessage(
            (ulong)DateTimeOffset.UtcNow.ToUnixTimeMilliseconds(), _seq.Next(), Array.Empty<SparkplugMetric>());
        var message = new MqttApplicationMessageBuilder()
            .WithTopic(topic)
            .WithPayload(SparkplugPayload.Encode(payload))
            .Build();
        await _client.PublishAsync(message, ct).ConfigureAwait(false);
    }

    private async Task PublishDeathCoreAsync(string equipmentCode, CancellationToken ct)
    {
        var topic = UnsTopicBuilder.BuildSparkplugTopic(_options, SparkplugMsgType.DDEATH, equipmentCode);
        var payload = new SparkplugPayloadMessage(
            (ulong)DateTimeOffset.UtcNow.ToUnixTimeMilliseconds(), _seq.Next(), Array.Empty<SparkplugMetric>());
        var message = new MqttApplicationMessageBuilder()
            .WithTopic(topic)
            .WithPayload(SparkplugPayload.Encode(payload))
            .Build();
        await _client.PublishAsync(message, ct).ConfigureAwait(false);
    }

    private async Task PublishNodeBirthCoreAsync(long bdSeq, CancellationToken ct)
    {
        _seq.ResetOnBirth(); // NBIRTH is the ONLY sequence-resetting message (per spec)
        var now = (ulong)DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
        var metrics = new[] { new SparkplugMetric(BdSeqMetricName, 0, now, SparkplugDataType.Int64, bdSeq) };
        var topic = UnsTopicBuilder.BuildSparkplugTopic(_options, SparkplugMsgType.NBIRTH);
        var payload = new SparkplugPayloadMessage(now, _seq.Next(), metrics); // Next() == 0 right after reset
        var message = new MqttApplicationMessageBuilder().WithTopic(topic)
            .WithPayload(SparkplugPayload.Encode(payload)).Build();
        await _client.PublishAsync(message, ct).ConfigureAwait(false);
    }

    private async Task PublishNodeDeathCoreAsync(long bdSeq, CancellationToken ct)
    {
        var now = (ulong)DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
        var metrics = new[] { new SparkplugMetric(BdSeqMetricName, 0, now, SparkplugDataType.Int64, bdSeq) };
        var topic = UnsTopicBuilder.BuildSparkplugTopic(_options, SparkplugMsgType.NDEATH);
        var payload = new SparkplugPayloadMessage(now, _seq.Next(), metrics); // hosts don't gate on NDEATH seq; kept for the single-seq invariant
        var message = new MqttApplicationMessageBuilder().WithTopic(topic)
            .WithPayload(SparkplugPayload.Encode(payload)).Build();
        await _client.PublishAsync(message, ct).ConfigureAwait(false);
    }

    /// <summary>GĐ3 sub-4 LC-3 — retained JSON <c>{ state, atUtc }</c> on
    /// <see cref="UnsTopicBuilder.BuildLineStateTopic"/>, reusing the SAME <see cref="SemanticJsonOptions"/>
    /// serializer every other semantic-mirror publish in this class already uses (camelCase, string enums —
    /// though <paramref name="state"/> here is already a plain string, not an enum, per
    /// <see cref="IUnsPublisher.PublishLineState"/>'s own doc comment on why).</summary>
    private async Task PublishLineStateCoreAsync(string state, CancellationToken ct)
    {
        var topic = UnsTopicBuilder.BuildLineStateTopic(_options);
        var payload = new LineStatePayload(state, DateTimeOffset.UtcNow);
        var json = JsonSerializer.Serialize(payload, SemanticJsonOptions);
        var message = new MqttApplicationMessageBuilder()
            .WithTopic(topic)
            .WithPayload(json)
            .WithRetainFlag(true)
            .Build();
        await _client.PublishAsync(message, ct).ConfigureAwait(false);
    }

    /// <summary>GĐ3 sub-4 LC-3 — the exact <c>{ state, atUtc }</c> wire shape the brief calls for; a named
    /// record (not an anonymous type) so <see cref="SemanticJsonOptions"/>'s camelCase policy has a stable
    /// property set to serialize.</summary>
    private sealed record LineStatePayload(string State, DateTimeOffset AtUtc);

    /// <summary>Maps a <see cref="DeviceReading"/>'s own fields onto Sparkplug metrics, covering the
    /// codec's full datatype set (Int64/Double/Boolean/String) across the three <see cref="ReadingKind"/>
    /// shapes. Each metric's alias is assigned/reused via <paramref name="aliasTable"/> (per spec: stable
    /// for the equipment's current BIRTH/DEATH session).</summary>
    private static List<SparkplugMetric> BuildSparkplugMetrics(DeviceReading reading, SparkplugAliasTable aliasTable)
    {
        var metrics = new List<SparkplugMetric>();
        var ts = (ulong)reading.Timestamp.ToUnixTimeMilliseconds();

        void Add(string name, SparkplugDataType type, object value) =>
            metrics.Add(new SparkplugMetric(name, aliasTable.GetOrAssign(name), ts, type, value));

        switch (reading.Kind)
        {
            case ReadingKind.ProcessResult:
                foreach (var m in reading.Metrics)
                {
                    Add(m.Name, SparkplugDataType.Double, m.Value);
                }

                Add("verdict", SparkplugDataType.String, reading.Verdict.ToString());
                Add("cycleCounter", SparkplugDataType.Int64, reading.CycleCounter);
                break;

            case ReadingKind.Telemetry:
                foreach (var t in reading.Telemetry)
                {
                    switch (t.Value)
                    {
                        case bool b:
                            Add(t.Metric, SparkplugDataType.Boolean, b);
                            break;
                        case double d:
                            Add(t.Metric, SparkplugDataType.Double, d);
                            break;
                        case float f:
                            Add(t.Metric, SparkplugDataType.Double, (double)f);
                            break;
                        case int i:
                            Add(t.Metric, SparkplugDataType.Int64, (long)i);
                            break;
                        case long l:
                            Add(t.Metric, SparkplugDataType.Int64, l);
                            break;
                        case null:
                            break;
                        default:
                            Add(t.Metric, SparkplugDataType.String, t.Value.ToString() ?? string.Empty);
                            break;
                    }
                }

                break;

            case ReadingKind.Inspection:
                foreach (var m in reading.Measurements)
                {
                    Add(m.PointCode, SparkplugDataType.String, m.Result);
                }

                Add("overallResult", SparkplugDataType.String, reading.Verdict.ToString());
                break;
        }

        return metrics;
    }

    /// <summary>Completes the channel (no more enqueues accepted), waits (bounded, 5s) for the flush loop
    /// to drain, then disconnects/disposes the MQTT client. Same drain-first-then-hard-stop shape as
    /// <see cref="St4i.EdgeCore.Historian.HistorianWriter.DisposeAsync"/> — see its doc comment for the
    /// full "why not cancel first" reasoning. Idempotent: safe to call more than once (guarded by
    /// <see cref="_disposed"/>), which matters because production DI wiring may resolve this singleton
    /// under both its concrete type and forwarded interface registrations.</summary>
    public async ValueTask DisposeAsync()
    {
        if (_disposed) return;
        _disposed = true;
        _channel.Writer.TryComplete();

        try
        {
            await _flushLoop.WaitAsync(TimeSpan.FromSeconds(5));
        }
        catch (TimeoutException)
        {
            _cts.Cancel();
            try
            {
                await _flushLoop;
            }
            catch
            {
                // Best-effort shutdown — the flush loop already reports its own failures via logError.
            }
        }

        try
        {
            await _connectTask.ConfigureAwait(false);
        }
        catch
        {
            // Already reported (if it failed) inside RunFlushLoopAsync.
        }

        try
        {
            if (_client.IsConnected)
            {
                await _client.DisconnectAsync(new MqttClientDisconnectOptions(), CancellationToken.None).ConfigureAwait(false);
            }
        }
        catch
        {
            // best-effort shutdown.
        }

        _client.Dispose();
        _cts.Dispose();
    }
}
