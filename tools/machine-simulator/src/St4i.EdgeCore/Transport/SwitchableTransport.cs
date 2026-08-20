using St4i.EdgeCore.Models;

namespace St4i.EdgeCore.Transport;

/// <summary>
/// The seam that makes a Live/Demo/Auto toggle actually switch the transport a running fleet sends
/// through. Registered as the DI <see cref="ITransport"/> singleton (so a fleet's pipeline and every
/// per-machine consumer hold this ONE stable reference for the whole process lifetime), it just
/// forwards every call to whatever inner <see cref="ITransport"/> is currently set — <see cref="SetInner"/>
/// atomically swaps it, so a mode change never requires re-resolving/re-wiring any consumer, and any
/// in-flight call started against the old inner keeps running against exactly that instance (only calls
/// made AFTER the swap observe the new one).
///
/// Relocated from the WPF app's <c>St4iMachineSimulator.Services.SwitchableTransport</c> into EdgeCore
/// (Task 3, ASP.NET EngineApi host) — this class only ever depended on EdgeCore types, so both the WPF
/// exhibition app and the headless EngineApi host can now share the exact same implementation.
/// </summary>
public sealed class SwitchableTransport : ITransport
{
    private readonly object _gate = new();
    private ITransport _inner;

    /// <summary>Builds the singleton around the transport it should forward to until something calls
    /// <see cref="SetInner"/>. The argument is required — there is no "unset" state and no null inner to
    /// guard against anywhere else in this class — and it is NOT owned: this class is not
    /// <see cref="IDisposable"/> and never disposes an inner, neither the one handed in here nor one it is
    /// later pointed away from. The instances it forwards to outlive it and are shared with
    /// <see cref="TransportCoordinator"/>, and only ONE of them is ever disposed by anybody: the
    /// coordinator disposes a <see cref="LiveTransport"/> it replaces on a rebuild.
    /// <see cref="DemoTransport"/> and <see cref="AutoTransport"/> are not disposable at all.</summary>
    public SwitchableTransport(ITransport initial)
    {
        _inner = initial ?? throw new ArgumentNullException(nameof(initial));
    }

    /// <summary>Atomically swaps the transport every subsequent call is forwarded to. Cheap/lock-free
    /// reads (a single field reference read) — the lock only guards the write itself.</summary>
    public void SetInner(ITransport transport)
    {
        ArgumentNullException.ThrowIfNull(transport);
        lock (_gate)
        {
            _inner = transport;
        }
    }

    /// <summary>The transport every call is currently forwarded to — exposed so callers (e.g. Settings'
    /// probe/rebuild flow) can inspect what's active without maintaining a second copy of that state.</summary>
    public ITransport Inner
    {
        get
        {
            lock (_gate)
            {
                return _inner;
            }
        }
    }

    /// <summary>🔴 Whatever the CURRENT inner says, which makes this the only <c>Mode</c> in the product
    /// that can contradict the one the operator selected. <see cref="TransportCoordinator.Mode"/> records
    /// the choice; this one records the wiring, and the fleet's network-outage scenario moves the wiring
    /// without touching the choice — it points this transport straight at a lossy
    /// <see cref="DemoTransport"/> through <see cref="SetInner"/>, so while that scenario runs this reads
    /// <see cref="TransportMode.Demo"/> for a host whose coordinator still reads
    /// <see cref="TransportMode.Live"/>. Since <c>EdgePipeline</c> stamps THIS value on every API-trace
    /// event, that disagreement is visible to the operator in the trace pane and nowhere else.</summary>
    public TransportMode Mode => Inner.Mode;

    /// <summary>Forwards to whichever inner is set at the instant of the call. The inner is resolved once,
    /// under the lock, before the call starts, so a <see cref="SetInner"/> racing this send cannot
    /// redirect it: the call finishes against the instance it began on. The inner's task is returned
    /// directly rather than awaited, so an exception an inner throws reaches the caller unwrapped and
    /// this class adds no ack, no timeout and no retry of its own.</summary>
    public Task<TransportAck> SendAsync(CanonicalEnvelope env, CancellationToken ct) => Inner.SendAsync(env, ct);

    /// <summary>Forwards on the same terms as <see cref="SendAsync"/> — one inner resolved at call time,
    /// task returned unwrapped. Worth stating separately because the three forwards are independent: a
    /// heartbeat and a send issued around the same swap can legitimately run against DIFFERENT inners,
    /// and this class makes no attempt to keep a burst of calls on one transport.</summary>
    public Task<HeartbeatResult> HeartbeatAsync(string machineCode, CancellationToken ct) => Inner.HeartbeatAsync(machineCode, ct);

    /// <summary>Forwards on the same terms as <see cref="SendAsync"/> — and it is not the only config
    /// seam a host has. The EngineApi keeps a SECOND switchable, for the full check-get-apply loop, and
    /// points it with its own coordinator on the same <see cref="TransportMode"/>. The two do not resolve
    /// that mode identically: <see cref="TransportMode.Auto"/> here means an
    /// <see cref="AutoTransport"/> that tries live and falls back per call, while on the other seam it
    /// means a one-shot choice made from whether the live backend is configured at all.</summary>
    public Task<ConfigSyncResult> SyncConfigAsync(string machineCode, string configKind, string? cachedVersion, CancellationToken ct) =>
        Inner.SyncConfigAsync(machineCode, configKind, cachedVersion, ct);
}
