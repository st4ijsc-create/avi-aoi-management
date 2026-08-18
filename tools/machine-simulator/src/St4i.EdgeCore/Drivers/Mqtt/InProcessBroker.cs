using MQTTnet.Server;

namespace St4i.EdgeCore.Drivers.Mqtt;

/// <summary>
/// A self-contained, in-process MQTT broker (MQTTnet.Server v5) bound to <c>localhost</c> — exists
/// purely so <see cref="MqttDriver"/> can be proven against a REAL MQTT wire protocol (CONNECT →
/// SUBSCRIBE → PUBLISH → message delivery) without requiring an external broker (Mosquitto/EMQX/...)
/// to be installed in dev/CI/demo environments. Not a production broker — a factory shim over
/// <see cref="MqttServer"/> scoped to exactly what Task 12's proof needs.
/// </summary>
public sealed class InProcessBroker : IAsyncDisposable
{
    private static readonly MqttServerFactory Factory = new();

    private MqttServer? _server;
    private volatile bool _disposed;

    /// <summary>Starts the broker listening on <c>localhost:port</c>. Call at most once per instance.</summary>
    public async Task StartAsync(int port = 1883)
    {
        if (_disposed) throw new ObjectDisposedException(nameof(InProcessBroker));
        if (_server is not null) throw new InvalidOperationException("InProcessBroker is already started.");

        var options = Factory.CreateServerOptionsBuilder()
            .WithDefaultEndpoint()
            .WithDefaultEndpointPort(port)
            .Build();

        var server = Factory.CreateMqttServer(options);
        await server.StartAsync().ConfigureAwait(false);
        _server = server;
    }

    public async ValueTask DisposeAsync()
    {
        if (_disposed) return;
        _disposed = true;

        var server = _server;
        if (server is not null)
        {
            try
            {
                await server.StopAsync().ConfigureAwait(false);
            }
            catch
            {
                // best-effort shutdown — the process is tearing this broker down regardless.
            }

            server.Dispose();
        }
    }
}
