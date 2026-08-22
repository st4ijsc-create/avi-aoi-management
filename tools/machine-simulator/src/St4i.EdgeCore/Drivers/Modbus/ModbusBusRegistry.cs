namespace St4i.EdgeCore.Drivers.Modbus;

/// <summary>
/// Task D-2 — <b>the sharing/reference-count contract, as D-4 will consume it.</b> Hands out
/// <see cref="ModbusBusLease"/>s keyed by a bus key: the first lease for a key creates the
/// <see cref="ModbusBus"/>, every later lease for that key rides on the SAME one, and the last release
/// disposes it.
///
/// <para><b>Why reference counting is mandatory rather than tidy.</b> D-1's review established that a
/// <c>System.IO.Ports.SerialPort</c> opens a COM port EXCLUSIVELY, so N driver instances each constructing
/// their own port object leaves N-1 of them unable to open at all. The identity model D-1 landed makes "N
/// connectors naming COM3" perfectly expressible; this class is what makes it physically work. D-2 registers
/// only ONE device on a bus — the shape is built here anyway, because a seam retro-fitted for sharing after
/// something is already sitting on it is a seam that gets bent to fit.</para>
///
/// <para><b>The rule the key must satisfy — the one obligation this class pushes onto its callers.</b> The key
/// must uniquely determine the link's physical parameters, because two callers passing the same key get the
/// SAME link and the second one's <c>openLink</c> delegate is never invoked. <see cref="GatewayTcpBusLink.CreateBusKey"/>
/// is the only supported way to build one for the RTU-over-TCP transport, and D-3's serial link must supply
/// the equivalent — including baud rate, parity, data bits and stop bits, not merely the port name, because
/// two connectors that disagree about baud rate are not two views of one bus. A caller that invents its own
/// key format is the one hazard this design cannot close for it: delegates cannot be compared, so a mismatch
/// cannot be detected here. It CAN be made impossible upstream by never building a key by hand, which is why
/// the key builders are static methods on the link types rather than string interpolation at the call site.
/// <b>And when it happens anyway</b> — because the rule above is a convention, not a type — the second caller
/// silently rides on the first caller's link: same key, same bus, same arbitration lock, the second one's
/// <c>openLink</c> never invoked. The observable result is a connector talking to a device server it was not
/// configured for, which surfaces either as a device that never answers (no such unit id over there) or, worse,
/// as a device that answers wrongly (a matching unit id on the wrong bus). Nothing at this layer reports it,
/// so the mitigation has to stay upstream.</para>
///
/// <para><b>Thread safety.</b> Every member is safe to call concurrently. <see cref="Acquire"/> and the
/// release path both run under one lock, so "the last release disposes" cannot race an "acquire" into
/// resurrecting a bus that is already being torn down: the entry is removed from the map under the same lock
/// that decrements it, and the disposal itself happens after the lock is dropped so a slow socket close never
/// blocks another bus's acquire.</para>
/// </summary>
public sealed class ModbusBusRegistry : IAsyncDisposable
{
    private sealed class Entry(ModbusBus bus)
    {
        public ModbusBus Bus { get; } = bus;
        public int Leases { get; set; }
    }

    private readonly object _gate = new();
    private readonly Dictionary<string, Entry> _buses = new(StringComparer.Ordinal);
    private bool _disposed;

    /// <summary>
    /// Returns a lease on the bus identified by <paramref name="busKey"/>, creating it on first use.
    /// <b>Performs no I/O</b> — the link is opened lazily, inside the first transaction — so this is safe to
    /// call from a driver constructor, which <see cref="St4i.Connector.Abstractions.IDeviceDriver"/>'s own
    /// contract requires be non-blocking.
    /// </summary>
    /// <param name="busKey">See this class's doc comment for the rule this must satisfy.</param>
    /// <param name="openLink">Opens a fresh physical link. Called on first use and again whenever the bus
    /// faults its link and must rebuild. Invoked only for the caller that CREATES the bus — see the key rule.</param>
    /// <param name="settings">Recovery tuning; <see langword="null"/> takes <see cref="ModbusBusSettings.Default"/>.
    /// Applied only when this call creates the bus, for the same reason as <paramref name="openLink"/>.</param>
    public ModbusBusLease Acquire(
        string busKey,
        Func<CancellationToken, Task<IModbusBusLink>> openLink,
        ModbusBusSettings? settings = null)
    {
        // settings is a nullable REFERENCE here (ModbusBusSettings is a record class, deliberately — see its
        // own remarks for the zero-initialisation trap that made it one), so `null` genuinely means "not
        // supplied" and can never be confused with a supplied all-zero value.
        ArgumentException.ThrowIfNullOrWhiteSpace(busKey);
        ArgumentNullException.ThrowIfNull(openLink);

        lock (_gate)
        {
            ObjectDisposedException.ThrowIf(_disposed, this);

            if (!_buses.TryGetValue(busKey, out var entry))
            {
                entry = new Entry(new ModbusBus(busKey, openLink, settings ?? ModbusBusSettings.Default));
                _buses[busKey] = entry;
            }

            entry.Leases++;
            return new ModbusBusLease(this, entry.Bus);
        }
    }

    /// <summary>How many live leases a key currently has — 0 for a key with no bus. Observable so a test can
    /// assert the COUNT rather than infer it from whether a later read happened to work: "the bus still
    /// works" and "the bus was never released" look identical from the outside, and only one of them is what
    /// reference counting promises.</summary>
    public int LeaseCount(string busKey)
    {
        lock (_gate)
        {
            return _buses.TryGetValue(busKey, out var entry) ? entry.Leases : 0;
        }
    }

    /// <summary>Whether a bus currently exists for this key. Distinct from
    /// <see cref="LeaseCount"/> == 0 only in intent: this is the question "did the last release actually
    /// dispose it".</summary>
    public bool HasBus(string busKey)
    {
        lock (_gate)
        {
            return _buses.ContainsKey(busKey);
        }
    }

    internal async ValueTask ReleaseAsync(ModbusBusLease lease)
    {
        ModbusBus? toDispose = null;

        lock (_gate)
        {
            if (!_buses.TryGetValue(lease.Bus.Key, out var entry) || !ReferenceEquals(entry.Bus, lease.Bus))
            {
                // The registry was disposed, or this bus was already torn down. Nothing to decrement, and
                // nothing to repair — a lease outliving its registry is a teardown-ordering detail, not an
                // error worth throwing at a driver that is itself being disposed.
                return;
            }

            entry.Leases--;
            if (entry.Leases <= 0)
            {
                _buses.Remove(lease.Bus.Key);
                toDispose = entry.Bus;
            }
        }

        // Outside the lock deliberately: closing a socket (or, in D-3, a COM port) must not block another
        // bus's Acquire.
        if (toDispose is not null)
        {
            await toDispose.DisposeAsync().ConfigureAwait(false);
        }
    }

    /// <summary>Disposes every bus this registry still holds, regardless of outstanding leases — the
    /// process-wide teardown path. A lease released afterwards is a harmless no-op (see
    /// <see cref="ReleaseAsync"/>).</summary>
    public async ValueTask DisposeAsync()
    {
        List<ModbusBus> buses;
        lock (_gate)
        {
            if (_disposed) return;
            _disposed = true;
            buses = _buses.Values.Select(e => e.Bus).ToList();
            _buses.Clear();
        }

        foreach (var bus in buses)
        {
            try { await bus.DisposeAsync().ConfigureAwait(false); }
            catch { /* best-effort teardown — one stuck link must not strand the rest */ }
        }
    }
}

/// <summary>
/// Task D-2 — one holder's claim on a <see cref="ModbusBus"/>. One driver instance holds exactly one, for
/// its whole lifetime, and releases it on disposal; that is what makes the reference count track driver
/// lifetime rather than transaction lifetime.
///
/// <para><b>Release is idempotent.</b> Disposing a lease twice decrements once. This is not defensive
/// tidiness: <c>FleetHost</c> best-effort disposes drivers on fault AND on restart under a bounded budget, so
/// a driver's <c>DisposeAsync</c> genuinely can run twice, and a double decrement would dispose a bus other
/// drivers are still using — a fault that would show up as an unrelated device's reads failing, with nothing
/// pointing back here.</para>
/// </summary>
public sealed class ModbusBusLease : IAsyncDisposable
{
    private readonly ModbusBusRegistry _registry;
    private int _released;

    internal ModbusBusLease(ModbusBusRegistry registry, ModbusBus bus)
    {
        _registry = registry;
        Bus = bus;
    }

    /// <summary>The shared bus. Several leases return the same instance by design — that is what "shared"
    /// means here.</summary>
    public ModbusBus Bus { get; }

    /// <summary>Whether this lease has already been released. Observable so a double-release test asserts the
    /// LEASE's own state as well as the registry's count.</summary>
    public bool IsReleased => Volatile.Read(ref _released) != 0;

    /// <summary>Hands this claim back. The FIRST call decrements the key's reference count and, if that
    /// takes it to zero, disposes the <see cref="ModbusBus"/> and with it the physical link; every later call
    /// returns without touching the count. That is the idempotence this type's own remarks argue for, and
    /// <see cref="IsReleased"/> is how a test sees which of the two happened.
    ///
    /// <para><b>All three paths through it complete synchronously today, and one caller leans on that —
    /// under a guard.</b> <see cref="ModbusBusRegistry.ReleaseAsync"/> takes a lock, decrements, and awaits
    /// <see cref="ModbusBus.DisposeAsync"/> only at zero — and that method sets a flag, tears a link down and
    /// returns a completed <see cref="ValueTask"/>. <see cref="ModbusRtuDriver"/>'s constructor relies on
    /// exactly this to release a lease it took before a later argument check threw, and guards the
    /// assumption with a <see cref="ValueTask.IsCompleted"/> test rather than assuming it forever.</para>
    ///
    /// <para><b>Releasing a lease whose registry is already gone is a no-op, not an error.</b> Process
    /// teardown disposes the registry, which disposes every bus regardless of outstanding leases; a driver
    /// disposed afterwards still calls this, finds no matching entry, and returns. Deciding otherwise would
    /// mean throwing at a driver that is itself being torn down, over an ordering it did not
    /// choose.</para></summary>
    public ValueTask DisposeAsync()
    {
        if (Interlocked.Exchange(ref _released, 1) != 0)
        {
            return ValueTask.CompletedTask;
        }

        return _registry.ReleaseAsync(this);
    }
}
