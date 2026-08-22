using System.Net.Sockets;
using System.Runtime.CompilerServices;
using NModbus;
using St4i.Connector.Abstractions;
using St4i.Connector.Abstractions.Models;

namespace St4i.EdgeCore.Drivers.Modbus;

/// <summary>
/// G2-6 (WS-H) — the FIRST real field-protocol driver (after Task 11's
/// <see cref="Drivers.HotFolder.HotFolderAoiDriver"/> and Task 12's <see cref="Drivers.Mqtt.MqttDriver"/>):
/// a periodic POLLER (unlike those two, which are event/file-driven) that reads a fixed, ordered set of
/// registers off a Modbus TCP slave via NModbus (the maintained `rich.quackenbush` fork, NOT the abandoned
/// NModbus4), decodes each per its <see cref="ModbusRegisterMap"/> entry, and yields ONE
/// <see cref="DeviceReading"/> per poll — bridging onto the exact same <see cref="IDeviceDriver"/> seam
/// every other driver uses. Proven end-to-end (no real hardware) against an in-process NModbus TCP slave
/// in <c>ModbusTcpDriverLoopbackTests</c>.
///
/// Decode rules (deliberately minimal — see <see cref="ModbusDataType"/>): each register is ONE 16-bit
/// word, read via FC03 (<see cref="ModbusRegisterType.Holding"/>) or FC04 (<see cref="ModbusRegisterType.Input"/>),
/// decoded as unsigned (<see cref="ModbusDataType.UInt16"/>) or two's-complement signed
/// (<see cref="ModbusDataType.Int16"/>), then multiplied by <see cref="ModbusRegister.Scale"/>. 32-bit/
/// float values (a register PAIR combined per some word-order convention) and register-block batching
/// (today: one read per register) are DELIBERATE follow-ups, not built here — see task-6-report.md.
///
/// Resilience/health model: <see cref="Health"/> starts <see cref="DriverHealthState.Down"/> (ctor never
/// connects — non-blocking, like every other driver's ctor), flips to
/// <see cref="DriverHealthState.Connected"/> on a successful poll, and to
/// <see cref="DriverHealthState.Degraded"/> on ANY connect/read failure — which also force-closes the
/// underlying TCP connection so the NEXT poll iteration reconnects from scratch (<see cref="EnsureConnectedAsync"/>).
/// A transient error therefore never throws out of <see cref="ReadAsync"/> — the driver self-heals. This
/// is deliberately what makes it safe to run as its own G2-5 pipeline slot: the per-slot fault-isolation
/// catch that refactor added is the BACKSTOP for a truly fatal/unexpected throw, not this driver's normal
/// path (a flaky OT link degrades and reconnects; it doesn't tear the slot down).
///
/// <para><b>Task B-4 (.superpowers/sdd/2026-07-29-dotB-machine-control-blueprint/task-4-brief.md) — the
/// FIRST real write path in this product.</b> This class now also implements
/// <see cref="IWritableDeviceDriver"/>: <see cref="WriteSetpointAsync"/> writes a single declared Holding
/// register (<c>WriteSingleRegisterAsync</c>), <see cref="InvokeCommandAsync"/> pulses a single declared
/// coil (<c>WriteSingleCoilAsync</c> true, then false). Both call <see cref="ModbusRegister.TryComputeRawWordForWrite"/>
/// for the actual value math (declared range, finiteness, physical-type range, rounding — B-3's job, not
/// re-derived here) and reuse this class's OWN proven no-CancellationToken workaround
/// (<c>Transport.ReadTimeout</c>/<c>WriteTimeout</c> bound the call; <c>ct.Register(DisposeConnection)</c>
/// force-tears-down the connection to unblock an in-flight one — see <see cref="PollOnceAsync"/>'s own doc
/// comment, measured there at ~2ms) rather than inventing a second mechanism.</para>
///
/// <para><b>Write/poll interleaving — the concurrency decision this task had to make.</b> The read loop and
/// a write/command now contend for the SAME <see cref="_master"/>/<see cref="_tcpClient"/> — NModbus's
/// transport writes request bytes and reads response bytes on the one shared stream with no framing that
/// would survive two calls interleaving on it, so genuinely concurrent use is not an option, only a
/// question of HOW they take turns. Decision: <see cref="_ioLock"/>, a single <see cref="SemaphoreSlim"/>
/// (capacity 1), guards every access to the connection — a full poll iteration (connect + all registers)
/// and a full write/command attempt (connect + its own I/O) each acquire it as ONE atomic unit. A write that
/// lands while a poll is mid-flight WAITS for that poll to finish before it starts talking to the device
/// (never interleaves bytes with it), and vice versa — simple, correct, and easy to reason about, at the
/// cost of a write occasionally waiting up to one poll's worth of time. The write's OWN <c>ct</c>
/// (via <see cref="WriteSetpointAsync"/>/<see cref="InvokeCommandAsync"/>) is honoured even while queued
/// for the lock — <c>SemaphoreSlim.WaitAsync(ct)</c> is cancellable, so a caller never has to wait out a
/// slow/stuck poll if it gives up first.</para>
///
/// <para><b><see cref="DisposeAsync"/> deliberately does NOT acquire <see cref="_ioLock"/>.</b> Mirrors
/// <c>FleetCore</c>'s own signed-off B-2 design ("disposal never waits on an in-flight write, not even
/// boundedly" — a driver dispose can run while <c>FleetCore._gate</c>/<c>FleetCore.Estop</c> is involved,
/// and this class has no way to know that, so waiting here even briefly would recreate the exact hazard
/// that design closes). It tears the connection down UNCONDITIONALLY, out from under whichever operation
/// (a poll or a write) currently owns it — which is safe for the SAME reason <c>ct.Register(DisposeConnection)</c>
/// already is: whichever call was using the now-disposed connection gets an exception from it, and both the
/// poll's own catch (Degrades) and the write/command's own catch (Indeterminate) already treat "the
/// connection died out from under me" as a normal, handled outcome, not a special case.</para>
///
/// <para><b>No implicit retry — a real hazard this task found, not merely avoided.</b> <c>Transport.Retries</c>
/// is shared with the read path's own tuned default (<see cref="ModbusRegisterMap.EffectiveRetries"/>,
/// default 1) — probed empirically against the installed NModbus 3.0.83: with <c>Retries=1</c> a silent
/// peer receives the SAME write request TWICE before NModbus gives up (a harmless extra READ, but a
/// physical DOUBLE-ACTUATION hazard for a write/command — exactly what B-1's contract forbids). Every
/// write/command attempt therefore forces <c>Transport.Retries = 0</c> for the duration of its own call
/// only, restoring the map's configured value afterward so the read path's own tolerance is unaffected.</para>
///
/// <para><b>Failed vs. Indeterminate.</b> Only <see cref="NModbus.SlaveException"/> — the device explicitly
/// parsed the request and returned a Modbus exception response — maps to <see cref="WriteOutcome.Failed"/>
/// (a KNOWN "no"). Every other failure (a bounded timeout with no cancellation involved, an <see cref="System.IO.IOException"/>
/// from a connection <see cref="DisposeConnection"/> just tore down, a failed TCP connect, cancellation
/// itself) maps to <see cref="WriteOutcome.Indeterminate"/> — this driver never guesses "no" from mere
/// silence.</para>
///
/// <para><b>A coil "pulse" is TRUE then FALSE, not "set and leave".</b> Leaving a coil asserted high forever
/// risks a level-triggered PLC rung re-firing the action on every scan — a real hazard for something the
/// brief itself calls a "pulse". If the assert write is EXPLICITLY REJECTED by the device
/// (<see cref="NModbus.SlaveException"/>), the command never fired at all — <see cref="WriteOutcome.Failed"/>,
/// exactly like a setpoint write's own rejection. <b>Fix round 1 (review, Important #1) — this class
/// previously overclaimed the SAME "never fired" conclusion for a bare TIMEOUT on the assert write too,
/// which is false and is the COMMON case, not the rare one:</b> a timeout genuinely does not tell you
/// whether the device received and applied the assert before the connection gave up, so that case reports
/// <see cref="WriteOutcome.Indeterminate"/> with a <c>Detail</c> that explicitly names the coil and says its
/// rest state is UNCONFIRMED — the same honesty the reset-failure case below already had. If the assert
/// SUCCEEDS but the reset write does not (any reason, including an explicit device rejection), the overall
/// outcome is still <see cref="WriteOutcome.Indeterminate"/> — never <see cref="WriteOutcome.Failed"/> (the
/// command DID fire) and never <see cref="WriteOutcome.Applied"/> (the coil's final rest state is
/// unconfirmed). This driver never automatically resets a possibly-latched coil on the caller's behalf —
/// deciding what to do about an unconfirmed device state is a human's call, not this driver's.</para>
///
/// <para><b>Fix round 1 (review, Critical #1) — every non-<see cref="NModbus.SlaveException"/> write/command
/// failure now force-closes the connection too, not just a cancellation.</b> Before this fix,
/// <see cref="ExecuteRegisterWriteAsync"/>/<see cref="ExecuteCoilPulseAsync"/> only ever tore the connection
/// down via <c>ct.Register(DisposeConnection)</c> — a bare <c>Transport.WriteTimeout</c> (no cancellation
/// involved at all) left the connection OPEN and reused by the next operation, even though the device might
/// still answer the timed-out request LATE. Reproduced empirically: a first write timing out, followed by a
/// second write reusing the same connection, observed the SECOND write's own response read return the FIRST
/// write's stale, late-arriving one. Every non-<see cref="NModbus.SlaveException"/> catch now calls
/// <see cref="DisposeConnection"/> — mirroring <see cref="ReadAsync"/>'s OWN documented resilience model
/// exactly, applied to the write path for the first time.</para>
///
/// <para><b>Fix round 1 (review, Critical #2) — the <c>Transport.Retries</c> restore in each
/// write/command's own <c>finally</c> is wrapped in its OWN best-effort <c>try</c>/<c>catch</c>.</b>
/// <c>ct.Register(DisposeConnection)</c> disposing <c>master</c> mid-call (verified directly:
/// <c>IModbusMaster.Dispose()</c> nulls its own <c>Transport</c>) used to throw a bare
/// <see cref="NullReferenceException"/> out of that restore on the cancellation path — silently REPLACING a
/// correctly-produced <see cref="WriteOutcome.Indeterminate"/> result (carrying the one actionable
/// <c>Detail</c> that names a possibly-latched coil) with the outer backstop's generic "unexpected failure"
/// message. This means the outer backstop is NOT purely for "something genuinely unforeseen" — it was, until
/// this fix, ALSO the routine landing spot for every cancelled write/command, silently. It should reach it
/// only for a genuine, unanticipated failure now.</para>
/// </summary>
public sealed class ModbusTcpDriver : IWritableDeviceDriver
{
    private static readonly ModbusFactory Factory = new();

    private readonly string _host;
    private readonly int _port;
    private readonly ModbusRegisterMap _map;
    private readonly Action<string>? _logWarning;
    private readonly Action<Exception, string>? _logError;

    private TcpClient? _tcpClient;
    private IModbusMaster? _master;
    private volatile bool _disposed;

    /// <summary>Task B-4 — serializes every access to <see cref="_master"/>/<see cref="_tcpClient"/> between
    /// the read poll loop and a write/command attempt. See this class's own doc comment ("Write/poll
    /// interleaving") for why a shared lock, not a second connection or genuine concurrency, is the
    /// deliberate design here. Deliberately never disposed by <see cref="DisposeAsync"/> — see that method's
    /// own remarks.</summary>
    private readonly SemaphoreSlim _ioLock = new(1, 1);

    /// <summary>Task B-4 — a snapshot taken ONCE at construction (<see cref="ModbusRegisterMap.WritablePointNames"/>
    /// never changes for the lifetime of an immutable <see cref="_map"/>), satisfying
    /// <see cref="IWritableDeviceDriver.WritablePoints"/>'s own "fixed for the lifetime of this instance,
    /// never a live view" contract without rebuilding a list on every access.</summary>
    private readonly IReadOnlyList<string> _writablePoints;

    /// <summary>Task B-4 — the <see cref="St4i.Connector.Abstractions.IWritableDeviceDriver.Commands"/> mirror of
    /// <see cref="_writablePoints"/>; see that field's own remarks.</summary>
    private readonly IReadOnlyList<string> _commands;

    /// <summary>Builds the poller without touching the network: no socket is opened, no
    /// <see cref="IModbusMaster"/> is created and <see cref="Health"/> is left
    /// <see cref="DriverHealthState.Down"/>, so this satisfies <see cref="IDeviceDriver"/>'s type-level
    /// "construction is non-blocking and performs no I/O" rule in the strict sense. The only real work here
    /// is snapshotting the map's writable-point and command name lists into genuine read-only collections —
    /// once, because an immutable map cannot change them, and as copies because
    /// <see cref="IWritableDeviceDriver.WritablePoints"/> forbids handing out a live view.
    ///
    /// <para><b>Only two of the five arguments are validated, and the unvalidated ones fail later in
    /// different places.</b> <paramref name="host"/> and <paramref name="map"/> raise
    /// <see cref="ArgumentNullException"/> here. <paramref name="port"/> is taken as given and surfaces, if
    /// wrong, as a connect failure inside the poll loop that degrades health instead of throwing. The two log
    /// callbacks are optional and unchecked: leaving them null is supported and silences the only report a
    /// poll failure makes.</para></summary>
    /// <param name="host">Hostname or address of the Modbus TCP slave. Non-null; not resolved or reached
    /// here.</param>
    /// <param name="port">TCP port of the slave. Unvalidated — see the summary.</param>
    /// <param name="map">The register map: which registers to read, how to decode them, the poll cadence, and
    /// the per-read timeout and retry budget. Non-null, and treated as immutable for the lifetime of this
    /// driver — the writable-point and command lists are read out of it exactly once, right here.</param>
    /// <param name="logWarning">Optional sink for non-fatal notices. <see langword="null"/> discards
    /// them.</param>
    /// <param name="logError">Optional sink for a poll, write or command failure, called with the exception and a
    /// message naming the machine code. <see langword="null"/> discards them — and since a poll failure is
    /// otherwise absorbed into <see cref="DriverHealthState.Degraded"/> without throwing, a null here leaves
    /// <see cref="Health"/> as the only remaining signal that a reconnect loop is running against a dead
    /// device, with nothing anywhere naming the exception.</param>
    public ModbusTcpDriver(
        string host, int port, ModbusRegisterMap map,
        Action<string>? logWarning = null, Action<Exception, string>? logError = null)
    {
        _host = host ?? throw new ArgumentNullException(nameof(host));
        _map = map ?? throw new ArgumentNullException(nameof(map));
        _port = port;
        _logWarning = logWarning;
        _logError = logError;

        Id = $"modbus:{host}:{port}:{map.MachineCode}";
        Health = DriverHealthState.Down;
        // Fix round 1 (Minor) — .AsReadOnly() (a genuine ReadOnlyCollection<string> wrapper, never castable
        // back to a mutable List<string>) rather than handing out ModbusRegisterMap.WritablePointNames'/
        // CommandNames' own freshly-built List<string> under an IReadOnlyList<string>-typed reference: B-1's
        // own contract requires WritablePoints/Commands be "effectively immutable... never a live view a
        // caller could observe changing" — an interface-typed reference alone does not stop an adversarial
        // (or merely careless) caller from casting back to List<string> and mutating it; a ReadOnlyCollection
        // genuinely cannot be.
        _writablePoints = new List<string>(_map.WritablePointNames).AsReadOnly();
        _commands = new List<string>(_map.CommandNames).AsReadOnly();
    }

    /// <summary>Composed once by the constructor as <c>"modbus:{host}:{port}:{machineCode}"</c> — endpoint
    /// plus the ONE machine code this driver speaks for — and fixed thereafter, as
    /// <see cref="IDeviceDriver.Id"/> requires. The machine code is what makes it distinguish two TCP drivers
    /// pointed at one gateway address, which the endpoint alone would not.</summary>
    public string Id { get; }

    /// <summary>Always <c>DriverKinds.Modbus</c>. 🔴 <b>The RTU driver reports the SAME id</b> — one id for
    /// the protocol, not one per transport — so this value distinguishes Modbus from OPC-UA or MQTT and says
    /// nothing about whether the device is on a socket or on a serial line. The one production reader is
    /// <c>FleetCore.GetDriverHealth()</c>, which copies it into <c>DriverHealthSnapshot.Kind</c>, from where
    /// <c>St4i.EngineApi.Alarms.AlarmEvaluator</c> interpolates it twice into the TEXT of a degraded/down
    /// alarm — so the sentence an operator reads says "check the Modbus connection" for a serial multidrop
    /// and for a TCP endpoint alike. The alarm's key and target are the slot label, not this.</summary>
    public string Kind => DriverKinds.Modbus;

    /// <summary>The connection state of the polled link, and the value the driver-health alarm rule is
    /// evaluated on. <see cref="DriverHealthState.Down"/> from construction until a poll succeeds;
    /// <see cref="DriverHealthState.Connected"/> only after a whole poll iteration — connect plus every
    /// declared register — has completed;
    /// <see cref="DriverHealthState.Degraded"/> on any connect or read failure, which also force-closes the
    /// socket so the next iteration redials; <see cref="DriverHealthState.Down"/> again once
    /// <see cref="DisposeAsync"/> has run.
    ///
    /// <para><b>Connected here is a statement about the LAST completed poll, not about this instant.</b>
    /// Apart from the constructor and <see cref="DisposeAsync"/>, this only moves when a poll iteration
    /// finishes, so between two polls it repeats the previous outcome; the cadence in the register map is
    /// therefore also the resolution of this signal. A device that accepts the
    /// TCP handshake and then goes silent used to freeze it at Connected indefinitely — that is what the
    /// bounded transport read/write timeouts set on every connection exist to prevent, and it is why an
    /// unbounded timeout here is a health-reporting defect and not only a latency one.</para>
    ///
    /// <para>Written from the poll loop and read from another thread with no lock, so a reader observes a
    /// value that was true at some recent moment rather than a synchronised one.
    /// <c>FleetCore.GetDriverHealth()</c>, the production reader, takes the fleet lock for its own
    /// consistency and does not make this getter atomic.</para></summary>
    public DriverHealthState Health { get; private set; }

    /// <inheritdoc/>
    public IReadOnlyList<string> WritablePoints => _writablePoints;

    /// <inheritdoc/>
    public IReadOnlyList<string> Commands => _commands;

    /// <summary>The poll loop. `yield return`/`yield break` must stay OUTSIDE any try/catch (C# forbids a
    /// `yield` inside a `catch`-bearing `try`) — so each iteration's connect+read attempt is wrapped in its
    /// OWN try/catch that only ever sets <see cref="Health"/>/logs/tears down the connection, never
    /// rethrows a non-cancellation exception; the actual `yield return`/delay happen after that block has
    /// already exited.</summary>
    public async IAsyncEnumerable<DeviceReading> ReadAsync([EnumeratorCancellation] CancellationToken ct)
    {
        while (!ct.IsCancellationRequested)
        {
            // GP-6b (task-6b-report.md) — a post-dispose iteration must not rebuild a fresh TcpClient on a
            // driver DisposeAsync has already torn down: the enumeration is over the moment dispose has run.
            if (_disposed)
            {
                yield break;
            }

            DeviceReading? reading = null;
            var ioLockAcquired = false;
            try
            {
                // Task B-4 — a poll iteration and a write/command now contend for the SAME connection; see
                // this class's own doc comment ("Write/poll interleaving") for why mutual exclusion via this
                // lock, not genuine concurrency, is the deliberate design. Verified empirically (a scratch
                // repro) that a `yield break` reached from the `catch` below still runs this method's
                // `finally` first, releasing the lock before the enumeration actually ends.
                await _ioLock.WaitAsync(ct).ConfigureAwait(false);
                ioLockAcquired = true;

                await EnsureConnectedAsync(ct).ConfigureAwait(false);
                reading = await PollOnceAsync(ct).ConfigureAwait(false);
                Health = DriverHealthState.Connected;
            }
            catch (OperationCanceledException)
            {
                yield break;
            }
            catch (Exception ex)
            {
                // Resilient by design: a transient connect/read failure degrades + forces a fresh
                // reconnect NEXT iteration — it does NOT throw out of this iterator. See the class doc
                // comment's resilience/health model remarks.
                Health = DriverHealthState.Degraded;
                _logError?.Invoke(ex, $"Modbus poll failed for {_map.MachineCode}");
                DisposeConnection();
            }
            finally
            {
                if (ioLockAcquired)
                {
                    _ioLock.Release();
                }
            }

            if (reading is not null)
            {
                yield return reading;
            }

            try
            {
                await Task.Delay(_map.PollIntervalMs, ct).ConfigureAwait(false);
            }
            catch (OperationCanceledException)
            {
                yield break;
            }
        }
    }

    /// <summary>Lazily connects (or reuses an already-live connection) — a fresh <see cref="TcpClient"/> +
    /// <see cref="IModbusMaster"/> are only ever built here, reused across polls until
    /// <see cref="DisposeConnection"/> tears them down (on a poll failure, or final disposal).</summary>
    private async Task EnsureConnectedAsync(CancellationToken ct)
    {
        if (_master is not null && _tcpClient is { Connected: true })
        {
            return;
        }

        DisposeConnection();

        var tcp = new TcpClient();
        await tcp.ConnectAsync(_host, _port, ct).ConfigureAwait(false);

        var master = Factory.CreateMaster(tcp);

        // GP-6b (task-6b-report.md) — the actual production defect this closes, verified against the
        // installed NModbus 3.0.83 via a standalone probe (not inference): every IModbusMaster.Read*Async
        // overload takes NO CancellationToken, is sync-over-threadpool underneath (not a real async state
        // machine), and master.Transport.ReadTimeout/WriteTimeout default to -1 (infinite) — so does the
        // underlying NetworkStream.ReadTimeout. A device that accepts the TCP handshake but goes silent at
        // the protocol level (a stateful firewall timing out an idle polled flow, a PLC whose Modbus task
        // hung while its TCP stack stayed up, a device reset behind a switch that holds link — TCP keepalive
        // is off by default) used to pin a thread-pool thread FOREVER: Health stayed frozen at whatever it
        // last reported (Connected, for a device that HAD been talking), so AlarmEvaluator never raised
        // Degraded/Down and the operator saw a "green" connector that had silently stopped producing — see
        // this class's own doc comment. Bounding both timeouts here fixes that in NORMAL operation (no
        // cancellation involved at all — proven in ModbusTcpDriverLoopbackTests' health-freeze test);
        // PollOnceAsync's own ct.Register(DisposeConnection) (see its doc comment) separately makes an
        // in-flight read promptly CANCELLABLE, which is a distinct concern from bounding it.
        //
        // Task 9 (plant-rollout follow-up to GP-6b) — Math.Max(1000, PollIntervalMs * 4) is only the
        // DEFAULT now, not the only option: ModbusRegisterMap.ReadTimeoutMs/Retries (see their own doc
        // comments for the full "why") let a site override either directly instead of distorting
        // PollIntervalMs to game the derived value — e.g. a device fronted by a Modbus TCP→RTU gateway
        // that legitimately needs a multi-second per-register bound at a fast poll cadence. Unset (the
        // common case — ModbusTcpDriverLoopbackTests' 50ms interval, the conformance suite's 20ms one)
        // resolves to EXACTLY the same values as before this field existed: generous enough that a
        // genuinely healthy device polled quickly never has a real, succeeding read torn down mid-flight
        // (floored at 1 second so a fast poll cadence alone can't produce an unreasonably tight bound),
        // and NModbus's own retry count of 1 (this driver already reconnects from scratch on ANY poll
        // failure — see class doc comment's resilience model — so extra NModbus-level retries only
        // multiply the stall for no benefit, at the default).
        var timeoutMs = _map.EffectiveReadTimeoutMs;
        master.Transport.ReadTimeout = timeoutMs;
        master.Transport.WriteTimeout = timeoutMs;

        // NModbus retries a failed read/write up to Transport.Retries times, waiting
        // Transport.WaitToRetryMilliseconds (default 250ms, left as-is) between attempts — EACH retry is a
        // FRESH request under the SAME ReadTimeout bound above, not an extension of it (see
        // ModbusRegisterMap.ReadTimeoutMs's own remarks: the effective tolerance for a healthy-but-slow
        // device is one timeout, not Retries of them).
        master.Transport.Retries = _map.EffectiveRetries;

        // GP-6b (Fix round 1, task-6b-report.md) — tcp.ConnectAsync above already takes `ct`, but
        // DisposeAsync could still have run to completion WHILE it was in flight
        // (FleetCore.WaitDisposeOldPipeline cancels the token, waits a BOUNDED 3s for the run task, then
        // calls DisposeAsync regardless of whether that wait succeeded — there is no lock spanning both),
        // landing a live TcpClient/IModbusMaster on an already-disposed driver that would otherwise never be
        // explicitly closed again. Dispose it here instead of leaking it — same shape as
        // OpcUaDriver.EnsureSessionAsync's equivalent guard around its own Session.Create. Not airtight
        // either (a narrow CPU-only window between this check and the field assignment below remains,
        // closeable only with a lock neither driver takes anywhere else) — deliberately left as-is rather
        // than over-engineered with one.
        if (_disposed)
        {
            try { master.Dispose(); } catch { /* best-effort — see DisposeConnection's own reasoning */ }
            try { tcp.Dispose(); } catch { /* best-effort — same reasoning */ }
            throw new OperationCanceledException("ModbusTcpDriver was disposed while connecting.", ct);
        }

        _tcpClient = tcp;
        _master = master;
    }

    /// <summary>Reads every configured register ONE AT A TIME (block-batching is a documented follow-up —
    /// see the class doc comment) and decodes+scales each into a <see cref="TelemetrySample"/>, bundled
    /// into a single <see cref="DeviceReading"/> for this poll.</summary>
    private async Task<DeviceReading> PollOnceAsync(CancellationToken ct)
    {
        var master = _master ?? throw new InvalidOperationException("Modbus master not connected.");
        var samples = new List<TelemetrySample>(_map.Registers.Count);

        // GP-6b (task-6b-report.md) — NModbus's Read*Async overloads take no CancellationToken at all
        // (verified via a standalone probe against the installed 3.0.83 package), so this is the ONLY way to
        // interrupt an in-flight call: disposing the master/TcpClient unblocks a pending read almost
        // immediately (measured ~2ms in the probe) with an IOException, which the catch below translates
        // into the documented cancellation contract. EnsureConnectedAsync's Transport.ReadTimeout/Retries
        // bound the NON-cancelled case (the health-freeze fix); this registration is what makes an in-flight
        // read promptly cancellable on TOP of that bound, rather than only after it elapses.
        using var registration = ct.Register(DisposeConnection);

        foreach (var reg in _map.Registers)
        {
            ushort[] raw;
            try
            {
                raw = reg.Type == ModbusRegisterType.Holding
                    ? await master.ReadHoldingRegistersAsync(_map.UnitId, reg.Address, 1).ConfigureAwait(false)
                    : await master.ReadInputRegistersAsync(_map.UnitId, reg.Address, 1).ConfigureAwait(false);
            }
            catch (Exception) when (ct.IsCancellationRequested)
            {
                // The read above was unblocked by this method's own ct.Register(DisposeConnection) callback,
                // not a genuine protocol/timeout failure — surface it as cancellation, not a driver error, so
                // ReadAsync's own catch (OperationCanceledException) handles it without logging/degrading.
                throw new OperationCanceledException("Modbus read interrupted by cancellation.", ct);
            }

            // Task D-2 — this decode (UInt16 as-is; Int16 reinterpreted two's-complement BEFORE Scale) moved
            // VERBATIM to ModbusRegister.DecodeRawWord so ModbusRtuDriver reuses the identical math rather
            // than owning a second copy that could drift silently. Behaviour here is unchanged.
            var value = reg.DecodeRawWord(raw[0]);

            samples.Add(new TelemetrySample(reg.Metric, value, reg.Unit, "good"));
        }

        return new DeviceReading
        {
            MachineCode = _map.MachineCode,
            Kind = ReadingKind.Telemetry,
            // Telemetry has no pass/fail concept (same rationale as IotSensorSim's telemetry path) — Verdict
            // MUST be Skip, not the enum default (Pass). FleetCore.OnPipelineCommitted increments the
            // fleet-wide FPY/judged/pass KPIs for any reading whose Verdict != Skip, so a defaulted Pass here
            // would silently inflate the operator FPY toward 100% on every Modbus poll (whole-branch review).
            Verdict = Verdict.Skip,
            Telemetry = samples,
            Timestamp = DateTimeOffset.UtcNow,
        };
    }

    // ─────────────────────────────────────────────────────────────────────
    // Task B-4 — IWritableDeviceDriver: WriteSetpointAsync (a single Holding register) and
    // InvokeCommandAsync (a single coil "pulse"). See this class's own doc comment for the concurrency
    // (write/poll interleaving), no-retry, and Failed-vs-Indeterminate decisions both methods below share.
    // ─────────────────────────────────────────────────────────────────────

    /// <inheritdoc/>
    public async Task<SetpointWriteResult> WriteSetpointAsync(SetpointWriteRequest request, CancellationToken ct)
    {
        ArgumentNullException.ThrowIfNull(request);

        var register = ModbusWritePreflight.FindRegisterByMetric(_map, request.Point);
        if (register is null)
        {
            return new SetpointWriteResult(request.Point, WriteOutcome.Rejected, SetpointRejectionReason.UnknownPoint,
                $"'{request.Point}' does not name a register this map declares.");
        }

        if (register.Writable is null)
        {
            return new SetpointWriteResult(request.Point, WriteOutcome.Rejected, SetpointRejectionReason.NotWritable,
                $"'{request.Point}' is declared read-only in this map.");
        }

        if (!ModbusWritePreflight.TryToEngineeringValue(request.Value, out var engineeringValue, out var typeError))
        {
            return new SetpointWriteResult(request.Point, WriteOutcome.Rejected, SetpointRejectionReason.OutOfRange, typeError);
        }

        // B-3's own guarantee (ModbusRegister.TryComputeRawWordForWrite) — enforces, in order, the declared
        // [min,max], finiteness, the physical-type range after inverse scaling, and rounding. Called here,
        // never re-derived — see this class's own doc comment / the task report for why.
        if (!register.TryComputeRawWordForWrite(engineeringValue, out var rawWord, out var rangeError))
        {
            return new SetpointWriteResult(request.Point, WriteOutcome.Rejected, SetpointRejectionReason.OutOfRange, rangeError);
        }

        if (_disposed)
        {
            return new SetpointWriteResult(request.Point, WriteOutcome.Indeterminate, Detail: "this driver has already been disposed.");
        }

        try
        {
            return await ExecuteRegisterWriteAsync(request.Point, register.Address, rawWord, ct).ConfigureAwait(false);
        }
        catch (Exception ex)
        {
            // Final backstop — B-1's contract: neither write method may EVER let an exception propagate,
            // for any reason. Every specific, well-understood failure is already translated inside
            // ExecuteRegisterWriteAsync; this only catches something genuinely unforeseen.
            // Review fix (Important) — same redaction discipline FleetHost's own backstop catches document:
            // an arbitrary, genuinely-unforeseen exception's Message is not a channel this method controls
            // the contents of, so only the exception's TYPE name reaches the operator-visible Detail; the
            // full exception still reaches the logger.
            _logError?.Invoke(ex, $"Modbus setpoint write to '{request.Point}' failed unexpectedly on {_map.MachineCode}");
            return new SetpointWriteResult(request.Point, WriteOutcome.Indeterminate, Detail: $"unexpected failure: {ex.GetType().Name}");
        }
    }

    /// <inheritdoc/>
    public async Task<CommandResult> InvokeCommandAsync(CommandRequest request, CancellationToken ct)
    {
        ArgumentNullException.ThrowIfNull(request);

        var command = ModbusWritePreflight.FindCommandByName(_map, request.Command);
        if (command is null)
        {
            return new CommandResult(request.Command, WriteOutcome.Rejected, CommandRejectionReason.UnknownCommand,
                $"'{request.Command}' does not name a command this map declares.");
        }

        // B-3 rejects any Modbus command that declares an argument at parse time (ModbusRegisterMap.FromJson),
        // so a validated map's own command.Arguments is always null/empty — this build has no wire mapping
        // for a Modbus command argument's value yet (see this class's own doc comment / ModbusCommand's).
        // Checked here too, defensively, rather than assumed unreachable.
        if (request.Arguments is { Count: > 0 })
        {
            return new CommandResult(request.Command, WriteOutcome.Rejected, CommandRejectionReason.InvalidArgument,
                $"'{request.Command}' takes no arguments — Modbus commands in this build are zero-argument coil pulses.");
        }

        if (command.CoilAddress is not { } coilAddress)
        {
            // Fix round 1 (Minor) — this used to be `?? throw new InvalidOperationException(...)`: unreachable
            // via any map that went through ModbusRegisterMap.FromJson's own mandatory-coilAddress
            // validation, but reachable via direct construction (exactly what this class's own tests, and
            // any other in-process caller, can do) — which falsified this method's "never throws" posture.
            // Converted to an ordinary pre-flight Rejected instead: cheap, no I/O attempted, consistent with
            // every other validation failure above.
            return new CommandResult(request.Command, WriteOutcome.Rejected, CommandRejectionReason.InvalidArgument,
                $"'{request.Command}' has no declared coil address — a malformed command declaration that could " +
                "only be reached by constructing a ModbusCommand directly, bypassing ModbusRegisterMap.FromJson's " +
                "own mandatory-coilAddress check.");
        }

        if (_disposed)
        {
            return new CommandResult(request.Command, WriteOutcome.Indeterminate, Detail: "this driver has already been disposed.");
        }

        try
        {
            return await ExecuteCoilPulseAsync(request.Command, coilAddress, ct).ConfigureAwait(false);
        }
        catch (Exception ex)
        {
            // Final backstop — see WriteSetpointAsync's own remarks; identical reasoning, including the
            // redaction discipline (Review fix, Important): TYPE name only in Detail, full exception logged.
            _logError?.Invoke(ex, $"Modbus command '{request.Command}' failed unexpectedly on {_map.MachineCode}");
            return new CommandResult(request.Command, WriteOutcome.Indeterminate, Detail: $"unexpected failure: {ex.GetType().Name}");
        }
    }

    // 🔴 Task D-5 — FindRegisterByMetric, FindCommandByName, TryToEngineeringValue, DescribeRuntimeType and
    // DescribeSlaveException were all `private static` here and are now on ModbusWritePreflight, VERBATIM, so
    // ModbusRtuDriver reuses the identical implementations instead of owning a second copy. Same move D-2 made
    // with ModbusRegister.DecodeRawWord, for the same reason: a copy is not a reuse, and the drift would be
    // silent — a wrong operator-visible string is still a string. Behaviour here is unchanged, and
    // ModbusTcpDriverWriteTests is what proves it: its total must not move, and a moved total there would mean
    // this extraction did more than move code. (Deliberately no number here — D-3's review M-6 found a
    // hand-kept test count that had drifted, and the runner is the only place that knows.)

    /// <summary>Task B-4 — the actual I/O for <see cref="WriteSetpointAsync"/>: acquires <see cref="_ioLock"/>
    /// (see the class doc comment's "Write/poll interleaving" remarks), connects if needed, forces exactly
    /// ONE attempt at the transport level (see the class doc comment's "No implicit retry" remarks), and
    /// translates every failure shape into the documented outcome — never lets anything propagate.</summary>
    private async Task<SetpointWriteResult> ExecuteRegisterWriteAsync(string point, ushort address, ushort rawWord, CancellationToken ct)
    {
        try
        {
            await _ioLock.WaitAsync(ct).ConfigureAwait(false);
        }
        catch (OperationCanceledException)
        {
            return new SetpointWriteResult(point, WriteOutcome.Indeterminate,
                Detail: "cancelled while waiting for the device connection (a poll was in flight).");
        }

        try
        {
            // Same proven workaround as PollOnceAsync's own — see this class's doc comment: NModbus's write
            // methods take no CancellationToken at all, so disposing the connection is the only way to
            // interrupt one in flight (measured ~2ms on the read path; re-measured for writes in this task's
            // own tests).
            using var registration = ct.Register(DisposeConnection);

            try
            {
                await EnsureConnectedAsync(ct).ConfigureAwait(false);
            }
            catch (Exception) when (ct.IsCancellationRequested)
            {
                return new SetpointWriteResult(point, WriteOutcome.Indeterminate,
                    Detail: "cancelled before the device connection could be established.");
            }
            catch (Exception ex)
            {
                // Review fix (Important) — same redaction discipline as this class's own outer backstop
                // catches (and FleetHost's): ex.Message dropped from the operator-visible Detail, full
                // exception still logged.
                _logError?.Invoke(ex, $"Modbus device unreachable while writing '{point}' on {_map.MachineCode}");
                return new SetpointWriteResult(point, WriteOutcome.Indeterminate, Detail: $"could not reach the device ({ex.GetType().Name}).");
            }

            var master = _master ?? throw new InvalidOperationException("Modbus master not connected.");

            var previousRetries = master.Transport.Retries;
            master.Transport.Retries = 0;
            try
            {
                await master.WriteSingleRegisterAsync(_map.UnitId, address, rawWord).ConfigureAwait(false);
                return new SetpointWriteResult(point, WriteOutcome.Applied);
            }
            catch (SlaveException ex)
            {
                // The device was reached and explicitly said no — a KNOWN "no", not an unknown one. The
                // connection itself stays healthy (a full, valid response arrived and parsed) — no reason to
                // force a reconnect.
                // Review fix round 2 (Important) — the deliberate exception to this class's redaction
                // discipline: a SlaveException is a structured device-reported protocol code, not arbitrary
                // text, and the single most useful message on the commissioning path — see
                // DescribeSlaveException's own doc comment for why this one stays un-redacted while every
                // other Detail site in this class does not. Full exception still logged too.
                _logError?.Invoke(ex, $"Modbus device rejected the write to '{point}' on {_map.MachineCode}");
                return new SetpointWriteResult(point, WriteOutcome.Failed, Detail: $"device rejected the write: {ModbusWritePreflight.DescribeSlaveException(ex)}.");
            }
            catch (Exception) when (ct.IsCancellationRequested)
            {
                // Fix round 1 (Critical #1) — ct.Register(DisposeConnection) already tore the connection
                // down to unblock this call; DisposeConnection() is idempotent, so calling it again here is
                // harmless and keeps this catch self-contained rather than relying on the registration
                // callback alone.
                DisposeConnection();
                return new SetpointWriteResult(point, WriteOutcome.Indeterminate,
                    Detail: "cancelled before a definitive response arrived — the connection was torn down to unblock the in-flight write.");
            }
            catch (Exception ex)
            {
                // Fix round 1 (Critical #1) — Transport.WriteTimeout elapsed with NO cancellation involved:
                // NModbus gave up waiting for a response, but the CONNECTION ITSELF was left exactly as it
                // was. The device may still be processing (or may already have applied) this write and
                // answer LATE, after this call already gave up — left alone, that late response sits on the
                // stream and is misread as the response to whatever operation (a poll, or the NEXT write)
                // uses this SAME connection next: a genuine socket-desync hazard, reproduced empirically
                // (see the task report's "Fix round 1" section — a reviewer-constructed repro showed a
                // SECOND write's response matching the FIRST write's stale value). Mirrors ReadAsync's OWN
                // documented resilience model exactly ("force-closes the underlying TCP connection so the
                // NEXT poll iteration reconnects from scratch") — applied here to the write/command path,
                // which never had it before this fix.
                DisposeConnection();
                // Review fix (Important) — same redaction discipline as this class's other Detail sites:
                // ex.Message dropped from the operator-visible Detail, full exception still logged.
                _logError?.Invoke(ex, $"Modbus write to '{point}' did not complete on {_map.MachineCode}");
                return new SetpointWriteResult(point, WriteOutcome.Indeterminate, Detail: $"write did not complete ({ex.GetType().Name}).");
            }
            finally
            {
                // Fix round 1 (Critical #2) — best-effort ONLY: ct.Register(DisposeConnection) may already
                // have disposed `master` (verified directly: IModbusMaster.Dispose() nulls its own
                // Transport) WHILE this call was in flight — exactly the cancellation path this method
                // exists to handle. Restoring Retries is pure housekeeping (the NEXT EnsureConnectedAsync
                // builds a brand-new master/Transport pair regardless of whether this restore ran) — it must
                // never be allowed to throw and destroy the real return value produced above. Before this
                // fix, a NullReferenceException here silently replaced a correctly-produced Indeterminate
                // result (carrying an actionable Detail) with the outer backstop's generic "unexpected
                // failure: Object reference not set to an instance of an object." — losing the one message
                // that told an operator anything at all.
                try { master.Transport.Retries = previousRetries; } catch { /* best-effort restore only */ }
            }
        }
        finally
        {
            _ioLock.Release();
        }
    }

    /// <summary>Task B-4 — the actual I/O for <see cref="InvokeCommandAsync"/>: asserts <paramref name="coilAddress"/>
    /// TRUE, then FALSE, under the SAME lock/connection/cancellation-registration/no-retry umbrella as
    /// <see cref="ExecuteRegisterWriteAsync"/> — see the class doc comment's "coil pulse" remarks for the
    /// outcome-composition rule once the assert and reset halves can disagree.</summary>
    private async Task<CommandResult> ExecuteCoilPulseAsync(string commandName, ushort coilAddress, CancellationToken ct)
    {
        try
        {
            await _ioLock.WaitAsync(ct).ConfigureAwait(false);
        }
        catch (OperationCanceledException)
        {
            return new CommandResult(commandName, WriteOutcome.Indeterminate,
                Detail: "cancelled while waiting for the device connection (a poll was in flight).");
        }

        try
        {
            using var registration = ct.Register(DisposeConnection);

            try
            {
                await EnsureConnectedAsync(ct).ConfigureAwait(false);
            }
            catch (Exception) when (ct.IsCancellationRequested)
            {
                return new CommandResult(commandName, WriteOutcome.Indeterminate,
                    Detail: "cancelled before the device connection could be established.");
            }
            catch (Exception ex)
            {
                // Review fix (Important) — same redaction discipline as this class's own outer backstop
                // catches (and FleetHost's): ex.Message dropped from the operator-visible Detail, full
                // exception still logged.
                _logError?.Invoke(ex, $"Modbus device unreachable while invoking '{commandName}' on {_map.MachineCode}");
                return new CommandResult(commandName, WriteOutcome.Indeterminate, Detail: $"could not reach the device ({ex.GetType().Name}).");
            }

            var master = _master ?? throw new InvalidOperationException("Modbus master not connected.");

            var previousRetries = master.Transport.Retries;
            master.Transport.Retries = 0;
            try
            {
                try
                {
                    await master.WriteSingleCoilAsync(_map.UnitId, coilAddress, true).ConfigureAwait(false);
                }
                catch (SlaveException ex)
                {
                    // The command never fired at all — a KNOWN "no" from the device itself. The connection
                    // stays healthy (a full response arrived) — no reason to force a reconnect.
                    // Review fix round 2 (Important) — deliberately un-redacted, same reasoning as
                    // ExecuteRegisterWriteAsync's own SlaveException catch (see DescribeSlaveException's own
                    // doc comment). Full exception still logged too.
                    _logError?.Invoke(ex, $"Modbus device rejected command '{commandName}' on {_map.MachineCode}");
                    return new CommandResult(commandName, WriteOutcome.Failed, Detail: $"device rejected the command: {ModbusWritePreflight.DescribeSlaveException(ex)}.");
                }
                catch (Exception) when (ct.IsCancellationRequested)
                {
                    // Fix round 1 (Critical #1 + Important #1) — same socket-desync hazard as
                    // ExecuteRegisterWriteAsync's own generic catch (force a reconnect); ALSO names the coil
                    // and its unconfirmed rest state explicitly (Important #1) — cancellation during the
                    // ASSERT half means this driver does not even know whether the coil is now stuck high.
                    DisposeConnection();
                    return new CommandResult(commandName, WriteOutcome.Indeterminate,
                        Detail: $"cancelled before a definitive response arrived for coil {coilAddress}'s assert write — the connection was torn down to unblock the in-flight command; whether the coil was asserted is unconfirmed.");
                }
                catch (Exception ex)
                {
                    // Fix round 1 (Critical #1 + Important #1) — Transport.WriteTimeout elapsed with no
                    // cancellation: the SAME desync hazard as the setpoint path's own generic catch, so the
                    // connection is force-closed here too. Important #1 — this is the COMMON timeout case,
                    // not the rare SlaveException one above: the assert write may or may not have reached
                    // the device before the connection gave up, so the coil's rest state is UNCONFIRMED,
                    // never "did not fire at all" (this class's doc comment previously overclaimed the
                    // latter for every assert-write failure — corrected: that claim only ever held for an
                    // explicit SlaveException).
                    DisposeConnection();
                    // Review fix (Important) — same redaction discipline as this class's other Detail sites:
                    // ex.Message dropped from the operator-visible Detail, full exception still logged.
                    _logError?.Invoke(ex, $"Modbus coil {coilAddress}'s assert write did not complete for command '{commandName}' on {_map.MachineCode}");
                    return new CommandResult(commandName, WriteOutcome.Indeterminate,
                        Detail: $"coil {coilAddress}'s assert write did not complete — whether it was asserted before the connection gave up is unconfirmed ({ex.GetType().Name}).");
                }

                // The coil is now CONFIRMED asserted — the command's physical effect has already happened.
                // Everything below can only affect whether the RESET half also lands cleanly, never whether
                // the command fired — see this method's own doc comment for why every failure from here on
                // still reports Indeterminate, never Failed/Applied.
                if (ct.IsCancellationRequested)
                {
                    return new CommandResult(commandName, WriteOutcome.Indeterminate,
                        Detail: $"coil {coilAddress} was asserted, but cancellation was requested before it could be reset — device state is unconfirmed.");
                }

                try
                {
                    await master.WriteSingleCoilAsync(_map.UnitId, coilAddress, false).ConfigureAwait(false);
                    return new CommandResult(commandName, WriteOutcome.Applied);
                }
                catch (SlaveException ex)
                {
                    // The device is reached and responded (connection healthy, no desync risk) — it just
                    // explicitly refused the RESET half. Still Indeterminate, never Failed/Applied (this
                    // method's own doc comment) — the pulse's primary effect already happened.
                    // Review fix round 2 (Important) — deliberately un-redacted, same reasoning as
                    // ExecuteRegisterWriteAsync's own SlaveException catch (see DescribeSlaveException's own
                    // doc comment). Full exception still logged too.
                    _logError?.Invoke(ex, $"Modbus coil {coilAddress}'s reset write rejected for command '{commandName}' on {_map.MachineCode}");
                    return new CommandResult(commandName, WriteOutcome.Indeterminate,
                        Detail: $"coil {coilAddress} was asserted but the device rejected the reset write: {ModbusWritePreflight.DescribeSlaveException(ex)}.");
                }
                catch (Exception ex)
                {
                    // Fix round 1 (Critical #1) — same socket-desync hazard as every other non-SlaveException
                    // failure in this class; force a reconnect for whatever uses this connection next.
                    // Whatever went wrong resetting the coil (a timeout, a cancellation) — the pulse's
                    // PRIMARY effect already happened. Reporting Failed here would wrongly imply the command
                    // never fired; reporting Applied would wrongly claim a fully-confirmed clean rest state.
                    // Indeterminate is the only honest answer.
                    DisposeConnection();
                    // Review fix (Important) — same redaction discipline as this class's other Detail sites:
                    // ex.Message dropped from the operator-visible Detail, full exception still logged.
                    _logError?.Invoke(ex, $"Modbus coil {coilAddress}'s reset write did not complete for command '{commandName}' on {_map.MachineCode}");
                    return new CommandResult(commandName, WriteOutcome.Indeterminate,
                        Detail: $"coil {coilAddress} was asserted but the reset write did not complete — its final rest state is unconfirmed ({ex.GetType().Name}).");
                }
            }
            finally
            {
                // Fix round 1 (Critical #2) — see ExecuteRegisterWriteAsync's own remarks on this exact
                // fix; identical hazard, identical reasoning (this is the branch the reviewer's own repro
                // targeted: a command cancelled mid-pulse used to lose its "coil left latched ON, unconfirmed"
                // Detail to a NullReferenceException from this exact line).
                try { master.Transport.Retries = previousRetries; } catch { /* best-effort restore only */ }
            }
        }
        finally
        {
            _ioLock.Release();
        }
    }

    /// <summary>Best-effort, idempotent teardown of the current TCP connection/master — called both on a
    /// poll failure (forces a fresh reconnect next iteration) and from <see cref="DisposeAsync"/>.</summary>
    private void DisposeConnection()
    {
        try
        {
            _master?.Dispose();
        }
        catch
        {
            // best-effort — a master whose underlying socket already faulted must not block teardown.
        }

        try
        {
            _tcpClient?.Dispose();
        }
        catch
        {
            // best-effort — same reasoning as above.
        }

        _master = null;
        _tcpClient = null;
    }

    /// <summary>Latches the disposed flag, sets <see cref="Health"/> to
    /// <see cref="DriverHealthState.Down"/> and force-closes the current socket and master through the same
    /// best-effort teardown a failed poll uses. Idempotent through the flag it sets first, and synchronous —
    /// it returns an already-completed task and awaits nothing, which is what makes it safe for the bounded
    /// disposal budget the fleet host gives it.
    ///
    /// <para>🔴 <b>It does NOT wait for an in-flight poll, write or command, and does not take
    /// <see cref="_ioLock"/>.</b> That is the deliberate design, and it is the reason the lock is never
    /// disposed here — the remarks <see cref="_ioLock"/>'s own comment refers to, written down at last.
    /// Disposing a <see cref="SemaphoreSlim"/> out from under a parked
    /// <see cref="SemaphoreSlim.WaitAsync(CancellationToken)"/> strands that waiter permanently instead of
    /// cancelling it — the mechanism measured in full on
    /// <c>HotFolderAoiDriver.DisposeAsync</c> — so disposing it would trade a bounded teardown for an
    /// unbounded one. The socket and master this class does own are torn down above; the lock is the ONLY
    /// other disposable it holds, and a <see cref="SemaphoreSlim"/> that is only ever waited on and released
    /// has no handle to free.</para>
    ///
    /// <para><b>What that leaves for a caller to expect.</b> An operation already talking to the device sees
    /// its socket disposed underneath it and fails; the poll loop's own guard ends the enumeration at its
    /// next pass rather than rebuilding a connection on a disposed driver. Disposing while a write is
    /// unconfirmed does not make its outcome known — that stays the operator's call, per this class's own
    /// indeterminate-write model.</para></summary>
    /// <returns>An already-completed <see cref="ValueTask"/>.</returns>
    public ValueTask DisposeAsync()
    {
        if (_disposed) return ValueTask.CompletedTask;
        _disposed = true;
        Health = DriverHealthState.Down;
        DisposeConnection();
        return ValueTask.CompletedTask;
    }
}
