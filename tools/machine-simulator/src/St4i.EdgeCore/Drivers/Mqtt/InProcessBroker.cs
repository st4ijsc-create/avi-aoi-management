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

    /// <summary>Stops the listener and releases the underlying <see cref="MqttServer"/>. Idempotent, and by
    /// a stronger mechanism than a re-entrancy check: the <see langword="volatile"/> disposed flag is set
    /// BEFORE any await, so a second call returns immediately and also closes
    /// <see cref="StartAsync(int)"/> — a broker torn down can never be restarted, and attempting it raises
    /// <see cref="ObjectDisposedException"/> rather than silently binding a second listener.
    ///
    /// <para><b>Best-effort, and deliberately blind.</b> Any exception out of <c>StopAsync</c> is swallowed
    /// with no log sink and no rethrow — this class holds none — and the server is disposed regardless. So a
    /// broker that failed to release its port is indistinguishable from one that shut down cleanly, and the
    /// symptom surfaces later as the NEXT <see cref="StartAsync(int)"/> on the same port failing instead.</para>
    ///
    /// <para><b>It is not bounded by anything this class controls.</b> The <c>StopAsync</c> call carries no
    /// <see cref="System.Threading.CancellationToken"/> and no timeout, and this method exposes no way to
    /// pass one, so how long a stop can take is decided entirely inside MQTTnet. Being wrapped in
    /// <see langword="try"/>/<see langword="catch"/> bounds the OUTCOME, not the duration.</para>
    ///
    /// <para>Calling this on an instance that was never started is legal and does nothing but set the flag —
    /// there is no server to stop, and the null check says so.</para></summary>
    /// <returns>A task that completes once the server has been stopped (or the stop attempt has failed and
    /// been discarded) and disposed.</returns>
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
