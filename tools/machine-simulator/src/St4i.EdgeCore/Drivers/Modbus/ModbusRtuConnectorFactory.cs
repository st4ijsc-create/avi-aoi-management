using System.Diagnostics.CodeAnalysis;
using St4i.Connector.Abstractions;
using St4i.Connector.Abstractions.Models;

namespace St4i.EdgeCore.Drivers.Modbus;

/// <summary>
/// 🔴 Task D-7a (.superpowers/sdd/2026-08-02-dotD-modbus-rtu-blueprint/task-7a-brief.md) — <b>the
/// <see cref="IConnectorFactory"/> that makes Modbus RTU reachable from configuration at all.</b> Until this
/// type existed, nothing in <c>src/</c> constructed a <see cref="ModbusRtuDriver"/>, opened a
/// <see cref="ModbusBus"/> or took a <see cref="ModbusBusLease"/> — D-2 through D-6 all shipped saying so.
///
/// <para><b>One factory instance serves ONE BUS, and every device on it.</b> That is D-4's own fan-out
/// contract (<c>ModbusMultidropRegistration</c>: "every device on one bus registers against the SAME
/// <see cref="IConnectorFactory"/>; what differs per instance is the configuration string the registry hands
/// back to it"). It is what makes the "one open for N leases" property work: this factory holds the bus key
/// and the opener, so N <see cref="TryCreate"/> calls produce N drivers sharing ONE
/// <see cref="ModbusBus"/> — one physical link, one arbitration lock — without any of the N knowing about
/// each other.</para>
///
/// <para><b>The transport is a delegate, not a switch, and that is what keeps the serial dependency
/// scoped.</b> This type never names a COM port or a socket: it takes a bus key plus a
/// <c>Func&lt;CancellationToken, Task&lt;IModbusBusLink&gt;&gt;</c>. <see cref="GatewayTcpBusLink.Opener"/>
/// supplies one with no new dependency; <c>SerialPortBusLink.Opener</c> would supply one from
/// <c>St4i.EdgeCore.Serial</c>, which this assembly must not reference (Đợt D §6, pinned by
/// <c>SerialDependencyScopingTests</c>). Whoever composes the host chooses; this class cannot leak the choice
/// into <c>St4i.EdgeCore</c> even by accident, because it has no type from either transport in its signature.</para>
///
/// <para>🔴 <b>THE LEASE LEAK, and why this class is where it is closed.</b>
/// <see cref="ModbusRtuDriver"/>'s constructor assigns <c>_lease</c> and <i>then</i> validates the unit id.
/// A throw after that point leaks the lease permanently: the reference count never reaches zero, so the
/// <see cref="ModbusBus"/> — and the physical link under it — lives for the rest of the process, and D-3
/// measured that <c>System.IO.Ports.SerialPort</c> opens a COM port EXCLUSIVELY. <b>The port is then unusable
/// until restart, and it presents as an unrelated connector failing to start.</b> Until D-7a only tests
/// constructed these drivers; a config-driven factory is the production path that makes it reachable, and a
/// bus of eight whose seventh device has a typo must not cost the operator the line. Two independent
/// mechanisms close it, and the second exists because the first is a list:</para>
///
/// <list type="number">
/// <item><description><b>Validate before <see cref="ModbusBusRegistry.Acquire"/>, here.</b>
/// <see cref="ModbusRtuDriver.ValidateRtuUnitId"/> was extracted for exactly this in D-4's review (I-5), and
/// D-6 closed it the same way at its own call site. A map that cannot produce a driver never causes a lease
/// to be taken at all — not taking one is cheaper than handing one back, and this is the failure that
/// actually happens in the field.</description></item>
/// <item><description>🔴 <b>And <see cref="ModbusRtuDriver"/>'s own constructor releases the lease if
/// construction throws ANYWAY.</b> Mechanism 1 is a list of the failures known today; that is the rule behind
/// it. The check does not live here as well, deliberately: two statements of one remedy drift, and the one
/// that belongs downstream is the one that covers <b>every</b> construction site rather than every site this
/// factory happens to be. See that constructor's <c>ArgumentOutOfRangeException</c> remarks for the reachable
/// counterexample that decided it — <c>new ModbusRtuDriver(lease, null!)</c> throws with the lease already
/// owned — and for the trace showing the release path is synchronous.</description></item>
/// </list>
/// </summary>
public sealed class ModbusRtuConnectorFactory : IConnectorFactory
{
    private readonly string _busKey;
    private readonly Func<CancellationToken, Task<IModbusBusLink>> _openLink;
    private readonly ModbusBusRegistry _busRegistry;
    private readonly ModbusBusSettings? _busSettings;
    private readonly ModbusRtuReadBackoff _readBackoff;
    private readonly long? _writeQueueBudgetMs;
    private readonly Action<string>? _logWarning;
    private readonly Action<Exception, string>? _logError;

    /// <param name="busKey">The shared bus's key. <b>Must be built by the link type's own
    /// <c>CreateBusKey</c></b> — see <see cref="ModbusBusRegistry"/>'s doc comment for the one obligation it
    /// pushes onto callers and what happens when a caller invents a key format.</param>
    /// <param name="openLink">Opens a fresh physical link. Invoked only for the caller that CREATES the bus,
    /// and again whenever the bus faults its link and must rebuild.</param>
    /// <param name="busRegistry">The reference-counted registry that makes N drivers share one open. Owned by
    /// the host, not by this factory — several factories (several buses) share one registry.</param>
    /// <param name="writeQueueBudgetMs">🔴 Blueprint §10 items 1+2 — the bound every driver this factory builds
    /// gives a write's WAIT FOR THE BUS, sized against the largest
    /// <see cref="ModbusRegisterMap.WorstCaseBusHoldMs"/> among the devices on this bus
    /// (<see cref="ModbusMultidropMap.MaxWorstCaseBusHoldMs"/>). Passing this per-BUS rather than letting each
    /// driver derive it from its own map is the whole point of item 2: a write queues behind whichever sibling
    /// holds the line, so the writing device's own number is the wrong one.</param>
    /// <param name="readBackoff">🔴 The per-device read backoff. <see langword="null"/> takes
    /// <see cref="ModbusRtuReadBackoff.Default"/> — the OPPOSITE polarity from
    /// <see cref="ModbusRtuDriver"/>'s own constructor default, deliberately: a directly-constructed driver
    /// keeps its pre-D-7a cadence so D-2…D-6's measurements stay comparable, while every driver that reaches
    /// production comes through here and gets the mitigation.</param>
    public ModbusRtuConnectorFactory(
        string busKey,
        Func<CancellationToken, Task<IModbusBusLink>> openLink,
        ModbusBusRegistry busRegistry,
        long? writeQueueBudgetMs = null,
        ModbusBusSettings? busSettings = null,
        ModbusRtuReadBackoff? readBackoff = null,
        Action<string>? logWarning = null,
        Action<Exception, string>? logError = null)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(busKey);
        ArgumentNullException.ThrowIfNull(openLink);
        ArgumentNullException.ThrowIfNull(busRegistry);

        _busKey = busKey;
        _openLink = openLink;
        _busRegistry = busRegistry;
        _busSettings = busSettings;
        _readBackoff = readBackoff ?? ModbusRtuReadBackoff.Default;
        _writeQueueBudgetMs = writeQueueBudgetMs is > 0 ? writeQueueBudgetMs : null;
        _logWarning = logWarning;
        _logError = logError;
    }

    /// <summary>The bus key every driver this factory builds shares. Exposed so a test names the same string
    /// the factory does rather than restating the format, and so a host can assert two connectors it believes
    /// are on one line really are.</summary>
    public string BusKey => _busKey;

    /// <summary>The SAME connector kind as Modbus TCP. RTU and TCP are two transports for one protocol, and
    /// <see cref="DriverKinds"/>' own contract is that those five strings are already on the wire and in real
    /// installs' <c>assets.db</c>; minting a sixth would fork the operator-visible vocabulary for a distinction
    /// the operator does not make. Identical to <see cref="ModbusRtuDriver.Kind"/>, which is what makes the
    /// registry's kind bookkeeping agree with the driver's.</summary>
    public string Kind => DriverKinds.Modbus;

    /// <summary><paramref name="config"/> is ONE DEVICE's standalone single-device register-map document —
    /// exactly what <see cref="ModbusMultidropMap.FanOut"/> hands a registration path as
    /// <see cref="ModbusBusDevice.MapJson"/>, i.e. a document that <b>cannot declare a second machine</b>.
    /// That is the property blueprint §7.1 rests on and it is preserved here by this method having no way to
    /// read a <c>devices</c> array: it calls <see cref="ModbusRegisterMap.FromJson"/>, which parses one device
    /// and nothing else.
    ///
    /// <para>Never throws (<see cref="IConnectorFactory.TryCreate"/>'s contract) and performs no I/O — the
    /// link is opened lazily inside the first transaction, so a bus whose gateway is unplugged still
    /// constructs here and degrades honestly at poll time, exactly as
    /// <see cref="ModbusConnectorFactory.TryCreate"/> does for TCP.</para>
    ///
    /// <para>🔴 <b>Review I-1 — that sentence used to be FALSE, and it was false on HEAD with no mutant
    /// applied.</b> <see cref="ModbusBusRegistry.Acquire"/> throws <see cref="ObjectDisposedException"/> for a
    /// registry that has already been torn down (a host shutdown racing a fleet start, which
    /// <c>FleetHost.StartLocked</c> can genuinely produce), and the call sat <b>outside</b> the guard. The
    /// runtime blast radius was contained — <c>ConnectorRegistry.TryCreateDriver</c> has its own catch and
    /// forwards <c>ex.Message</c> — but the operator's start issue then read <i>"Cannot access a disposed
    /// object"</i> instead of anything they could act on, and a doc comment claiming a contract the method
    /// does not keep is a false record on a source file, which this batch treats as a defect in itself.</para>
    ///
    /// <para>The whole body is now inside ONE guard, so the claim is made true rather than qualified. That is
    /// the shape to keep: a "never throws" that has to enumerate its exceptions has stopped being a
    /// contract.</para></summary>
    public bool TryCreate(string config, [NotNullWhen(true)] out IDeviceDriver? driver, [NotNullWhen(false)] out string? error)
    {
        driver = null;

        try
        {
            var map = ModbusRegisterMap.FromJson(config, _logWarning);

            // 🔴 Mechanism 1 — see this class's doc comment. BEFORE Acquire, so the failure this rule actually
            // catches in the field (a device addressed at the broadcast address, or in the reserved 248–255
            // range) never causes a lease to be taken in the first place.
            //
            // 🔴 Review I-2 — and this ordering is OBSERVABLE at this seam, which is what overturns D-7a's own
            // "no test can tell the two mechanisms apart" claim. Validation first means a device that cannot
            // produce a driver is refused BY ITS OWN MESSAGE and never touches the bus registry at all; with
            // it removed, the same map on a disposed registry is refused by the REGISTRY's message instead, so
            // the operator is told about the host's shutdown rather than about their own map. The counterexample
            // is AnUnbuildableDevice_IsRefusedByItsOwnMapsError_WithoutEverTouchingTheBusRegistry.
            ModbusRtuDriver.ValidateRtuUnitId(map);

            var lease = _busRegistry.Acquire(_busKey, _openLink, _busSettings);

            driver = new ModbusRtuDriver(
                lease, map, _logError, _readBackoff, _writeQueueBudgetMs,
                logRecovery: _logWarning);
            error = null;
            return true;
        }
        catch (Exception ex)
        {
            // Translates every throw into IConnectorFactory.TryCreate's non-throwing contract — and does NOT
            // release the lease on the construction path, because ModbusRtuDriver's constructor already did on
            // its way out. Releasing again here would be harmless (ModbusBusLease.DisposeAsync is idempotent by
            // Interlocked.Exchange) and would still be wrong: it would be a second statement of one remedy, and
            // the next person to change either would have no way to know the other existed.
            driver = null;
            error = ex.Message;
            return false;
        }
    }
}
