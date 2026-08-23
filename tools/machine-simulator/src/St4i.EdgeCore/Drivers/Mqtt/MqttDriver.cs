using System.Runtime.CompilerServices;
using System.Threading.Channels;
using MQTTnet;
using MQTTnet.Protocol;
using St4i.Connector.Abstractions;
using St4i.Connector.Abstractions.Models;
using St4i.EdgeCore.Infrastructure;

namespace St4i.EdgeCore.Drivers.Mqtt;

/// <summary>
/// The second REAL proof driver (Task 12, after Task 11's <see cref="Drivers.HotFolder.HotFolderAoiDriver"/>):
/// connects to a live MQTT broker (MQTTnet v5 client) — the <see cref="InProcessBroker"/> in tests/demo,
/// any real broker (Mosquitto/EMQX/...) in the field — subscribes to <c>topics</c> filters,
/// and hands each received (topic, payload) pair to a caller-supplied <c>map</c> function. Whatever the
/// mapper returns (or <c>null</c> to drop the message) is bridged onto the same <see cref="IDeviceDriver"/>
/// <see cref="ReadAsync"/> seam every other driver uses — the pipeline downstream never knows or cares
/// whether a reading came from MQTT, a hot folder, or the simulator.
///
/// A bounded coupling deliberately kept out of scope here: QoS/retained-message replay, wildcard
/// validation, and reconnect/backoff policy are broker/production concerns for a later task — this
/// driver's job is only to prove the wire protocol seam works end-to-end.
/// </summary>
public sealed class MqttDriver : IDeviceDriver
{
    private static readonly MqttClientFactory Factory = new();

    /// <summary>How long <see cref="DisposeAsync"/> waits for EACH of its two shutdown steps — draining the
    /// constructor's connect+subscribe task, then the graceful disconnect. One second each, and the arithmetic
    /// is the reason: <c>FleetCore.RestartTeardownTimeout</c> gives a whole driver 3 s before abandoning it,
    /// so two sequential steps at 1 s leave this method a worst case of about 2 s and keep a full second of
    /// headroom under the budget the host actually applies. A per-step ceiling equal to the host's own would
    /// have been no ceiling at all.</summary>
    private static readonly TimeSpan TeardownStepBudget = TimeSpan.FromSeconds(1);

    private readonly string[] _topics;
    private readonly Func<string, string, DeviceReading?> _map;
    private readonly IMqttClient _client;
    private readonly Channel<DeviceReading> _channel =
        Channel.CreateUnbounded<DeviceReading>(new UnboundedChannelOptions { SingleReader = false, SingleWriter = false });
    private readonly CancellationTokenSource _cts = new();
    private readonly Action<string>? _diagnostics;
    private readonly Task _connectTask;
    private volatile bool _disposed;

    /// <summary>Builds the driver and STARTS the connect+subscribe attempt on a background task before
    /// returning. Construction itself neither blocks nor waits for the broker — which is what
    /// <see cref="IDeviceDriver"/>'s type-level rule requires — but it is not inert either: by the time this
    /// returns, an attempt against <paramref name="host"/>:<paramref name="port"/> is already in flight, and
    /// <see cref="Health"/> can move off <see cref="DriverHealthState.Down"/> with the caller having called
    /// nothing.
    ///
    /// <para><b>What is validated here, and what is not.</b> <paramref name="host"/>,
    /// <paramref name="topics"/> and <paramref name="map"/> are null-checked and raise
    /// <see cref="ArgumentNullException"/>. <paramref name="port"/> is not checked at all: an out-of-range or
    /// nonsense port is accepted, fails inside the background attempt, is swallowed there, and surfaces only
    /// as <see cref="Health"/> staying <see cref="DriverHealthState.Down"/> with no exception reaching any
    /// caller. A topic filter is likewise not validated — a malformed filter fails at
    /// <c>SubscribeAsync</c> on that same background task, and the failure lands in the same silent
    /// place.</para></summary>
    /// <param name="host">Broker hostname or address, passed straight to the MQTTnet TCP client
    /// options.</param>
    /// <param name="port">Broker TCP port. Unvalidated — see the summary for where a bad value
    /// surfaces.</param>
    /// <param name="topics">The filters to subscribe to, in order, each at QoS 1
    /// (<c>AtLeastOnce</c>). The ARRAY is stored by reference and read later on the background
    /// connect task, so mutating it after this constructor returns races that read; hand over an array
    /// nobody else still holds. Subscription is NOT atomic: the loop stops at the first filter that fails,
    /// the filters after it are never subscribed, and no caller is told which.</param>
    /// <param name="map">Turns one received <c>(topic, payload)</c> pair into a reading, or
    /// <see langword="null"/> to drop the message. It runs ON THE MQTTnet RECEIVE CALLBACK and is awaited
    /// there, so it must be prompt — a slow mapper delays the messages queued behind it. It may throw: an
    /// exception is caught, that one message is dropped, and the subscription survives.</param>
    /// <param name="diagnostics">Optional sink for TEARDOWN outcomes only — one line per shutdown step, in
    /// the shape <see cref="BoundedTeardown"/> emits. It is deliberately NOT a general log for this class:
    /// the connect, subscribe and mapper failures described above are still swallowed exactly where they
    /// were, and wiring a sink does not make any of them visible. Added by BK-1 on 2026-08-23 for
    /// <c>docs/owner-decisions.md</c> item 48 defect 2; <see langword="null"/> — every call site that predates
    /// it — behaves as before except that the disposal is now bounded.</param>
    public MqttDriver(
        string host,
        int port,
        string[] topics,
        Func<string, string, DeviceReading?> map,
        Action<string>? diagnostics = null)
    {
        if (host is null) throw new ArgumentNullException(nameof(host));
        if (topics is null) throw new ArgumentNullException(nameof(topics));
        if (map is null) throw new ArgumentNullException(nameof(map));

        _topics = topics;
        _map = map;
        _diagnostics = diagnostics;

        Id = $"mqtt:{host}:{port}";
        Health = DriverHealthState.Down;

        _client = Factory.CreateMqttClient();
        _client.ApplicationMessageReceivedAsync += OnApplicationMessageReceivedAsync;
        _client.DisconnectedAsync += OnDisconnectedAsync;

        var options = Factory.CreateClientOptionsBuilder()
            .WithTcpServer(host, port)
            .WithClientId($"st4i-mqttdriver-{Guid.NewGuid():N}")
            .Build();

        // Connect + subscribe kick off in the background rather than blocking the constructor (which
        // must stay synchronous) — ReadAsync/Health simply observe whatever state this reaches.
        _connectTask = ConnectAndSubscribeAsync(options, _cts.Token);
    }

    /// <summary>Composed once by the constructor as <c>"mqtt:{host}:{port}"</c> and fixed thereafter, as
    /// <see cref="IDeviceDriver.Id"/> requires.
    ///
    /// <para>🔴 <b>It identifies the BROKER, not this subscription.</b> Neither the topic filters nor the
    /// generated MQTT client id enters the string, so two <see cref="MqttDriver"/> instances pointed at one
    /// broker with disjoint filter sets report the SAME <see cref="Id"/> — a caller that needs to tell two
    /// live subscriptions apart cannot do it with this. The instances are still distinct to the broker: each
    /// constructor builds its own <c>st4i-mqttdriver-{guid}</c> client id, and that guid is deliberately not
    /// exposed here, so the value that IS unique per instance is the one no reader can see.</para></summary>
    public string Id { get; }

    /// <summary>Always <c>DriverKinds.Mqtt</c>, one of the five ids this codebase reserves. The one
    /// production reader of this property is <c>FleetCore.GetDriverHealth()</c>, which copies it into
    /// <c>DriverHealthSnapshot.Kind</c>; <c>St4i.EngineApi.Alarms.AlarmEvaluator</c> then interpolates it
    /// twice into the TEXT of a degraded/down alarm. It is not the alarm's key or target — those are the slot
    /// label — so this value is read by an operator and not branched on.</summary>
    public string Kind => DriverKinds.Mqtt;

    /// <summary>Reports the state of the connection to the BROKER, and it is worth reading that literally:
    /// <see cref="DriverHealthState.Connected"/> here means the TCP/MQTT session was established, not that
    /// any filter has been subscribed or that any device is publishing. The constructor sets
    /// <see cref="DriverHealthState.Down"/>; the background attempt sets
    /// <see cref="DriverHealthState.Connected"/> the instant <c>ConnectAsync</c> returns and BEFORE the
    /// subscribe loop runs, so there is a real window in which this reads Connected while nothing is
    /// subscribed yet.
    ///
    /// <para>🔴 <b>Once that single attempt has finished, <see cref="DriverHealthState.Degraded"/> is
    /// terminal for the life of the instance.</b> The only assignment of
    /// <see cref="DriverHealthState.Connected"/> is inside the connect+subscribe attempt the constructor
    /// starts, and that attempt runs exactly ONCE — this driver has no reconnect or backoff policy, by the
    /// deliberate scope decision recorded on the class. A broker disconnect after it therefore moves this to
    /// Degraded and it stays there until
    /// <see cref="DisposeAsync"/> moves it to Down; a rebuilt driver is the only way back to Connected. A
    /// reader that treats Degraded as "will recover shortly" would be wrong about this
    /// implementation.</para></summary>
    public DriverHealthState Health { get; private set; }

    /// <summary>Drains the buffer the MQTT receive callback fills. This method does no network work of its
    /// own — connecting and subscribing belong to the background task the constructor started, and this call
    /// neither waits for that task nor learns whether it succeeded. Messages that arrive before the first
    /// enumeration are held rather than lost.
    ///
    /// <para>🔴 <b>That buffer is UNBOUNDED, and the write side cannot fail.</b> The callback pushes with
    /// <c>TryWrite</c> onto an unbounded channel, so a consumer slower than the broker's publish rate is
    /// absorbed as memory growth rather than as backpressure or as a dropped message. This is the opposite
    /// choice from the bounded <c>DropOldest</c> channels elsewhere in this codebase, and it is the shape to
    /// weigh before pointing this at a high-rate topic.</para>
    ///
    /// <para><b>How it ends.</b> Cancelling <paramref name="ct"/> throws
    /// <see cref="OperationCanceledException"/> out of the enumerator.
    /// <see cref="DisposeAsync"/> both cancels an internal token and completes the buffer, in that order,
    /// so an in-flight enumeration may end either way — by returning normally when the completion is observed
    /// first, or by throwing <see cref="OperationCanceledException"/> when the cancellation is; readings
    /// already sitting in the buffer at that moment are not guaranteed to be delivered. Enumerating a driver
    /// that has ALREADY been disposed is the one case that is neither: the first step of this method reads a
    /// token off the internal source <see cref="DisposeAsync"/> has disposed, which raises
    /// <see cref="ObjectDisposedException"/> (measured on this SDK, 2026-08-22) rather than yielding an empty
    /// sequence.</para></summary>
    /// <param name="ct">Ends the enumeration by throwing when cancelled. It is linked with the driver's own
    /// internal token, so either source ends the stream.</param>
    /// <returns>Whatever the caller-supplied mapper produced, in the order the broker delivered it, with
    /// dropped (<see langword="null"/>-mapped) and mapper-throwing messages already removed.</returns>
    public async IAsyncEnumerable<DeviceReading> ReadAsync([EnumeratorCancellation] CancellationToken ct)
    {
        using var linked = CancellationTokenSource.CreateLinkedTokenSource(ct, _cts.Token);
        while (await _channel.Reader.WaitToReadAsync(linked.Token).ConfigureAwait(false))
        {
            while (_channel.Reader.TryRead(out var reading))
            {
                yield return reading;
            }
        }
    }

    private async Task ConnectAndSubscribeAsync(MqttClientOptions options, CancellationToken ct)
    {
        try
        {
            await _client.ConnectAsync(options, ct).ConfigureAwait(false);
            Health = DriverHealthState.Connected;

            foreach (var topic in _topics)
            {
                await _client.SubscribeAsync(topic, MqttQualityOfServiceLevel.AtLeastOnce, ct).ConfigureAwait(false);
            }
        }
        catch (OperationCanceledException)
        {
            // Disposed before connect/subscribe finished — not a driver fault.
        }
        catch
        {
            Health = DriverHealthState.Down;
        }
    }

    private Task OnApplicationMessageReceivedAsync(MqttApplicationMessageReceivedEventArgs args)
    {
        var topic = args.ApplicationMessage.Topic;
        var payload = args.ApplicationMessage.ConvertPayloadToString() ?? string.Empty;

        DeviceReading? reading;
        try
        {
            reading = _map(topic, payload);
        }
        catch
        {
            // A mapper failure on one message must not tear down the whole subscription — drop it.
            return Task.CompletedTask;
        }

        if (reading is not null)
        {
            _channel.Writer.TryWrite(reading);
        }

        return Task.CompletedTask;
    }

    private Task OnDisconnectedAsync(MqttClientDisconnectedEventArgs args)
    {
        if (!_disposed)
        {
            Health = DriverHealthState.Degraded;
        }

        return Task.CompletedTask;
    }

    /// <summary>Tears the subscription down in a fixed order: latch <see cref="Health"/> to
    /// <see cref="DriverHealthState.Down"/>, cancel the internal token, complete the reading buffer, await
    /// the constructor's connect+subscribe task, then disconnect and dispose the MQTT client. Idempotent
    /// through the same flag it sets first, so a second call returns immediately — which is what
    /// <see cref="IDeviceDriver"/>'s type-level rule asks for.
    ///
    /// <para>🔴 <b>"Its two waits are not equally bounded, and the second one is the gap" IS RETRACTED,
    /// 2026-08-23, BK-1</b> (<c>docs/owner-decisions.md</c> item 48 defect 2, measured first by BB-1 on
    /// 2026-08-22). Quoted and retired in place. It was true: <c>DisconnectAsync</c> was issued with
    /// <see cref="CancellationToken.None"/>, so a broker that accepted the socket and stopped answering held
    /// teardown here for whatever the MQTT client's own internal timeout happened to be — a value this class
    /// neither set nor asserted. BOTH waits now go through <see cref="BoundedTeardown"/> at
    /// <c>TeardownStepBudget</c> each, and both report to the constructor's sink. The first wait was already
    /// ended by the cancellation one line earlier; it was routed anyway, because "a cancelled token will end
    /// it" is a statement about a cooperative callee and the whole defect was trusting one.</para>
    ///
    /// <para>🔴 <b>What is still NOT bounded, named rather than left for a reader to discover.</b> A step
    /// that overruns is DETACHED, not stopped — a client that never finishes disconnecting keeps its socket
    /// for as long as it likes, and this method returning says only that THIS caller stopped waiting.
    /// <c>_client.Dispose()</c> then runs against a client with a disconnect still in flight, which is the
    /// same thing that happened before when the host abandoned the whole disposal.</para>
    ///
    /// <para>🔴 <b>The internal cancellation source is disposed at the end, and that closes the driver to
    /// re-enumeration rather than merely ending it.</b> See <see cref="ReadAsync"/>: a call made after this
    /// method completes raises <see cref="ObjectDisposedException"/> instead of returning an empty
    /// sequence.</para></summary>
    /// <returns>A task that completes once the client has been disconnected (best effort) and disposed.
    /// Nothing here waits on a consumer, so an abandoned enumeration does not delay it.</returns>
    public async ValueTask DisposeAsync()
    {
        if (_disposed) return;
        _disposed = true;
        Health = DriverHealthState.Down;

        _cts.Cancel();
        _channel.Writer.TryComplete();

        // The token is DISCARDED here and the discard is deliberate: _connectTask was created with _cts.Token,
        // which is already cancelled, so handing it a second token would add a source it does not observe.
        // What this call buys is the RACE — the ceiling that holds if the task ignores the cancellation.
        await BoundedTeardown.RunAsync(
            "MqttDriver.connect+subscribe drain",
            _ => _connectTask,
            TeardownStepBudget,
            _diagnostics).ConfigureAwait(false);

        if (_client.IsConnected)
        {
            await BoundedTeardown.RunAsync(
                "MqttDriver.DisconnectAsync",
                ct => _client.DisconnectAsync(new MqttClientDisconnectOptions(), ct),
                TeardownStepBudget,
                _diagnostics).ConfigureAwait(false);
        }

        _client.Dispose();
        _cts.Dispose();
    }
}
