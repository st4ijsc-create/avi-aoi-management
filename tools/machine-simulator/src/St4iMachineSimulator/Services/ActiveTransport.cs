using St4i.EdgeCore.Models;
using St4i.EdgeCore.Transport;

namespace St4iMachineSimulator.Services;

/// <summary>
/// Task 19a — the seam that makes the shell's Live/Demo/Auto toggle actually switch the transport the
/// running fleet sends through. Registered as the DI <see cref="ITransport"/> singleton (so
/// <c>FleetService</c>/<c>EdgePipeline</c> and every <c>MachineViewModel</c> hold this ONE stable
/// reference for the app's whole lifetime), it just forwards every call to whatever inner
/// <see cref="ITransport"/> is currently set — <see cref="SetInner"/> atomically swaps it, so a mode
/// change never requires re-resolving/re-wiring any consumer, and any in-flight call started against
/// the old inner keeps running against exactly that instance (only calls made AFTER the swap observe
/// the new one).
/// </summary>
public sealed class SwitchableTransport : ITransport
{
    private readonly object _gate = new();
    private ITransport _inner;

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

    public TransportMode Mode => Inner.Mode;

    public Task<TransportAck> SendAsync(CanonicalEnvelope env, CancellationToken ct) => Inner.SendAsync(env, ct);

    public Task<HeartbeatResult> HeartbeatAsync(string machineCode, CancellationToken ct) => Inner.HeartbeatAsync(machineCode, ct);

    public Task<ConfigSyncResult> SyncConfigAsync(string machineCode, string configKind, string? cachedVersion, CancellationToken ct) =>
        Inner.SyncConfigAsync(machineCode, configKind, cachedVersion, ct);
}
