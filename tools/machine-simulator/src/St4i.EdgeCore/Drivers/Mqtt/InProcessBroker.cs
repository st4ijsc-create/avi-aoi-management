using MQTTnet.Server;
using St4i.EdgeCore.Infrastructure;

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

    /// <summary>How long <see cref="DisposeAsync"/> waits for <c>MqttServer.StopAsync</c> before detaching
    /// it. Not derived from <c>FleetCore.RestartTeardownTimeout</c> — this class is not a driver and no fleet
    /// host ever disposes it; its consumers are test and demo processes, where the failure this bounds is a
    /// suite that never finishes (this assembly has been wedged for 900 s at a time by exactly that shape —
    /// see <c>HotFolderAoiDriver.DisposeAsync</c>'s own remarks). Two seconds is far longer than a local
    /// listener needs to close and far shorter than a human waits before killing the run.</summary>
    private static readonly TimeSpan StopBudget = TimeSpan.FromSeconds(2);

    private readonly Action<string>? _diagnostics;

    private MqttServer? _server;
    private volatile bool _disposed;

    /// <summary>Builds a broker that has not started listening yet. No socket is opened and no port is
    /// claimed until <see cref="StartAsync(int)"/> is called.
    ///
    /// <para>🔴 <b>The sink is the whole of what <c>docs/owner-decisions.md</c> item 48 defect 4 called
    /// "deliberately blind".</b> Before it, <see cref="DisposeAsync"/> swallowed any shutdown failure into an
    /// empty <see langword="catch"/> in a class that held nowhere to put it, so a broker that failed to
    /// release its port was indistinguishable from one that shut down cleanly. Supplying a sink makes the
    /// difference readable; leaving it <see langword="null"/> reproduces the old silence, which is why every
    /// existing <c>new InProcessBroker()</c> keeps compiling and keeps behaving as it did.</para></summary>
    /// <param name="diagnostics">Where teardown outcomes are reported, one line per step, in the shape
    /// <see cref="BoundedTeardown"/> emits. Called on whatever thread completes the shutdown; it must be
    /// prompt and must not throw (a throw is contained and discarded, not surfaced).</param>
    public InProcessBroker(Action<string>? diagnostics = null)
    {
        _diagnostics = diagnostics;
    }

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
    /// <para>🔴 <b>"Best-effort, and deliberately blind" AND "not bounded by anything this class controls"
    /// ARE BOTH RETRACTED, 2026-08-23, BK-1</b> (<c>docs/owner-decisions.md</c> item 48 defect 4, measured
    /// first by BB-1 on 2026-08-22). Quoted and retired in place, the style this repository uses for a
    /// published claim that has stopped being true. What they described was real: the stop was issued with no
    /// token and no timeout, and any exception out of it went into an empty <see langword="catch"/> in a class
    /// that held no sink — so a broker that failed to release its port could not be told apart from one that
    /// shut down cleanly, and the symptom surfaced later as the NEXT <see cref="StartAsync(int)"/> on the same
    /// port failing instead. Both halves now go through <see cref="BoundedTeardown"/>: the stop is issued with
    /// a token that fires at <c>StopBudget</c>, the wait is also raced against that budget so a stop which
    /// ignores its token cannot hold this method, and the outcome — completed, overran, or failed — is handed
    /// to the sink the constructor was given.</para>
    ///
    /// <para>🔴 <b>What did NOT change, said plainly because a bound reads like a fix.</b> A detached stop is
    /// still running and still holds whatever it held; this method returning does not mean the port came back.
    /// A broker built with no sink still reports nowhere — the silence is now the CALLER's choice rather than
    /// this class's incapacity, which is a different thing but is not louder. And the server is disposed
    /// either way, exactly as before.</para>
    ///
    /// <para>Calling this on an instance that was never started is legal and does nothing but set the flag —
    /// there is no server to stop, and the null check says so.</para></summary>
    /// <returns>A task that completes once the server has been stopped (or the stop attempt has overrun its
    /// budget and been detached, or failed and been reported) and disposed.</returns>
    public async ValueTask DisposeAsync()
    {
        if (_disposed) return;
        _disposed = true;

        var server = _server;
        if (server is not null)
        {
            // The token is DISCARDED on purpose and the discard is the point: MqttServer.StopAsync takes no
            // CancellationToken at all, so the cooperative half of BoundedTeardown has nothing to hand it and
            // the race is the ONLY thing bounding this call. Written as `_` rather than as an unused `ct` so
            // a reader is not left thinking the token reaches MQTTnet.
            await BoundedTeardown.RunAsync(
                "InProcessBroker.StopAsync",
                _ => server.StopAsync(),
                StopBudget,
                _diagnostics).ConfigureAwait(false);

            server.Dispose();
        }
    }
}
