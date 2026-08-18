using System.Runtime.CompilerServices;
using System.Threading.Channels;
using MQTTnet;
using MQTTnet.Protocol;
using St4i.EdgeCore.Models;

namespace St4i.EdgeCore.Drivers.Mqtt;

/// <summary>
/// The second REAL proof driver (Task 12, after Task 11's <see cref="Drivers.HotFolder.HotFolderAoiDriver"/>):
/// connects to a live MQTT broker (MQTTnet v5 client) — the <see cref="InProcessBroker"/> in tests/demo,
/// any real broker (Mosquitto/EMQX/...) in the field — subscribes to <paramref name="topics"/> filters,
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

    private readonly string[] _topics;
    private readonly Func<string, string, DeviceReading?> _map;
    private readonly IMqttClient _client;
    private readonly Channel<DeviceReading> _channel =
        Channel.CreateUnbounded<DeviceReading>(new UnboundedChannelOptions { SingleReader = false, SingleWriter = false });
    private readonly CancellationTokenSource _cts = new();
    private readonly Task _connectTask;
    private volatile bool _disposed;

    public MqttDriver(string host, int port, string[] topics, Func<string, string, DeviceReading?> map)
    {
        if (host is null) throw new ArgumentNullException(nameof(host));
        if (topics is null) throw new ArgumentNullException(nameof(topics));
        if (map is null) throw new ArgumentNullException(nameof(map));

        _topics = topics;
        _map = map;

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

    public string Id { get; }

    public DriverKind Kind => DriverKind.Mqtt;

    public DriverHealthState Health { get; private set; }

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

    public async ValueTask DisposeAsync()
    {
        if (_disposed) return;
        _disposed = true;
        Health = DriverHealthState.Down;

        _cts.Cancel();
        _channel.Writer.TryComplete();

        try
        {
            await _connectTask.ConfigureAwait(false);
        }
        catch
        {
            // best-effort — connect/subscribe was already cancelled above.
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
