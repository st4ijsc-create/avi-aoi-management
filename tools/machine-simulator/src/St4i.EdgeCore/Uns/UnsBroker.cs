using System.Net;
using MQTTnet.Server;

namespace St4i.EdgeCore.Uns;

/// <summary>
/// G2-2 — the always-on embedded MQTT broker the local Unified Namespace spine runs on: evolves
/// <see cref="St4i.EdgeCore.Drivers.Mqtt.InProcessBroker"/> (Task 12's test-only shim) into a broker meant
/// to stay up for the whole process lifetime, explicitly bound to <see cref="IPAddress.Loopback"/>
/// (127.0.0.1) rather than <c>InProcessBroker</c>'s any-address default — LAN exposure is deliberately out
/// of scope until mTLS lands (see the task brief), so this never listens on anything reachable off-box.
///
/// Same MQTTnet.Server v5 API (<see cref="MqttServerFactory"/>) <c>InProcessBroker</c> already proved out
/// in <c>MqttDriverTests</c> — zero new MQTT dependency, per the task brief.
/// </summary>
public sealed class UnsBroker : IAsyncDisposable
{
    private static readonly MqttServerFactory Factory = new();

    private readonly int _port;
    private MqttServer? _server;
    private volatile bool _disposed;

    public UnsBroker(int port)
    {
        _port = port;
    }

    /// <summary>Whether <see cref="StartAsync"/> has completed successfully.</summary>
    public bool IsStarted => _server is not null;

    /// <summary>Starts the broker listening on <c>127.0.0.1:{port}</c>. Call at most once per instance —
    /// same contract as <see cref="St4i.EdgeCore.Drivers.Mqtt.InProcessBroker.StartAsync"/>.</summary>
    public async Task StartAsync(CancellationToken ct = default)
    {
        if (_disposed) throw new ObjectDisposedException(nameof(UnsBroker));
        if (_server is not null) throw new InvalidOperationException("UnsBroker is already started.");

        var options = Factory.CreateServerOptionsBuilder()
            .WithDefaultEndpoint()
            .WithDefaultEndpointBoundIPAddress(IPAddress.Loopback)
            .WithDefaultEndpointPort(_port)
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
