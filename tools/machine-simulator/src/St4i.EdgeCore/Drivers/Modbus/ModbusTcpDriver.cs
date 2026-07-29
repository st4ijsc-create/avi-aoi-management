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
/// cost of a write occasionally waiting up to one poll's worth of time. The write's OWN <paramref name="ct"/>
/// (via <see cref="WriteSetpointAsync"/>/<see cref="InvokeCommandAsync"/>) is honoured even while queued
/// for the lock — <c>SemaphoreSlim.WaitAsync(ct)</c> is cancellable, so a caller never has to wait out a
/// slow/stuck poll if it gives up first.</para>
///
/// <para><b><see cref="DisposeAsync"/> deliberately does NOT acquire <see cref="_ioLock"/>.</b> Mirrors
/// <c>FleetHost</c>'s own signed-off B-2 design ("disposal never waits on an in-flight write, not even
/// boundedly" — a driver dispose can run while <c>FleetHost._gate</c>/<c>FleetHost.Estop</c> is involved,
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
/// brief itself calls a "pulse". If the assert write fails, the command never fired at all
/// (<see cref="Models.CommandRejectionReason"/> aside, this is Failed/Indeterminate exactly like a setpoint
/// write). If the assert SUCCEEDS but the reset write does not (any reason, including an explicit device
/// rejection), the overall outcome is still <see cref="WriteOutcome.Indeterminate"/> — never
/// <see cref="WriteOutcome.Failed"/> (the command DID fire) and never <see cref="WriteOutcome.Applied"/>
/// (the coil's final rest state is unconfirmed).</para>
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

    /// <summary>Task B-4 — the <see cref="Models.IWritableDeviceDriver.Commands"/> mirror of
    /// <see cref="_writablePoints"/>; see that field's own remarks.</summary>
    private readonly IReadOnlyList<string> _commands;

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
        _writablePoints = _map.WritablePointNames;
        _commands = _map.CommandNames;
    }

    public string Id { get; }

    public string Kind => DriverKinds.Modbus;

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
        // (FleetHost.WaitDisposeOldPipeline cancels the token, waits a BOUNDED 3s for the run task, then
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

            // UInt16 keeps the raw 16-bit word as-is; Int16 reinterprets the SAME bits as two's-complement
            // signed (e.g. raw 0xFFFF -> -1) BEFORE Scale is applied — see ModbusDataType's doc comment.
            double decoded = reg.DataType == ModbusDataType.UInt16 ? raw[0] : unchecked((short)raw[0]);
            var value = decoded * reg.Scale;

            samples.Add(new TelemetrySample(reg.Metric, value, reg.Unit, "good"));
        }

        return new DeviceReading
        {
            MachineCode = _map.MachineCode,
            Kind = ReadingKind.Telemetry,
            // Telemetry has no pass/fail concept (same rationale as IotSensorSim's telemetry path) — Verdict
            // MUST be Skip, not the enum default (Pass). FleetHost.OnPipelineCommitted increments the
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

        var register = FindRegisterByMetric(request.Point);
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

        if (!TryToEngineeringValue(request.Value, out var engineeringValue, out var typeError))
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
            return new SetpointWriteResult(request.Point, WriteOutcome.Indeterminate, Detail: $"unexpected failure: {ex.Message}");
        }
    }

    /// <inheritdoc/>
    public async Task<CommandResult> InvokeCommandAsync(CommandRequest request, CancellationToken ct)
    {
        ArgumentNullException.ThrowIfNull(request);

        var command = FindCommandByName(request.Command);
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

        var coilAddress = command.CoilAddress
            ?? throw new InvalidOperationException(
                $"Modbus command '{request.Command}' has no declared coil address — should have been rejected at " +
                "map parse time (ModbusRegisterMap.FromJson).");

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
            // Final backstop — see WriteSetpointAsync's own remarks; identical reasoning.
            return new CommandResult(request.Command, WriteOutcome.Indeterminate, Detail: $"unexpected failure: {ex.Message}");
        }
    }

    private ModbusRegister? FindRegisterByMetric(string metric)
    {
        foreach (var register in _map.Registers)
        {
            if (string.Equals(register.Metric, metric, StringComparison.Ordinal))
            {
                return register;
            }
        }

        return null;
    }

    private ModbusCommand? FindCommandByName(string name)
    {
        foreach (var command in _map.Commands)
        {
            if (string.Equals(command.Name, name, StringComparison.Ordinal))
            {
                return command;
            }
        }

        return null;
    }

    /// <summary>Narrows <see cref="SetpointWriteRequest.Value"/>'s object? domain (double|bool|string|null,
    /// widened at deserialization — see that property's own doc comment) down to the <see langword="double"/>
    /// <see cref="ModbusRegister.TryComputeRawWordForWrite"/> needs, mirroring the numeric branch of
    /// <c>OpcUaNodeMap.TryNarrowForWrite</c> exactly (double|long accepted; a JSON integral number arrives as
    /// <see langword="long"/> — see <c>Json.ConnectorObjectConverter</c>'s own doc comment). Every Modbus
    /// register is numeric, so a <see langword="bool"/>/<see langword="string"/>/<see langword="null"/>
    /// value has no legitimate meaning here; per B-3's own precedent (every failure
    /// <c>TryComputeRawWordForWrite</c> itself can produce maps to EXACTLY ONE <see cref="SetpointRejectionReason"/>
    /// member — <see cref="SetpointRejectionReason.OutOfRange"/>), a wrong-type value is rejected the same
    /// way: there is no separate "wrong type" rejection reason in this contract, and treating "not a number"
    /// as a range failure is the closest honest fit.</summary>
    private static bool TryToEngineeringValue(object? value, out double engineeringValue, out string? error)
    {
        switch (value)
        {
            case double d:
                engineeringValue = d;
                error = null;
                return true;
            case long l:
                engineeringValue = l;
                error = null;
                return true;
            default:
                engineeringValue = default;
                error = $"expected a numeric value, got {DescribeRuntimeType(value)}.";
                return false;
        }
    }

    private static string DescribeRuntimeType(object? value) => value switch
    {
        null => "null",
        bool => "a bool",
        string => "a string",
        long => "an integral number",
        double => "a floating-point number",
        _ => value.GetType().Name,
    };

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
                return new SetpointWriteResult(point, WriteOutcome.Indeterminate, Detail: $"could not reach the device: {ex.Message}");
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
                // The device was reached and explicitly said no — a KNOWN "no", not an unknown one.
                return new SetpointWriteResult(point, WriteOutcome.Failed, Detail: $"device rejected the write: {ex.Message}");
            }
            catch (Exception) when (ct.IsCancellationRequested)
            {
                return new SetpointWriteResult(point, WriteOutcome.Indeterminate,
                    Detail: "cancelled before a definitive response arrived — the connection was torn down to unblock the in-flight write.");
            }
            catch (Exception ex)
            {
                // Transport.WriteTimeout elapsed with no cancellation involved, or some other transport-level
                // failure (IOException/SocketException) — we genuinely do not know whether the device applied
                // this before the connection gave up.
                return new SetpointWriteResult(point, WriteOutcome.Indeterminate, Detail: $"write did not complete: {ex.Message}");
            }
            finally
            {
                master.Transport.Retries = previousRetries;
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
                return new CommandResult(commandName, WriteOutcome.Indeterminate, Detail: $"could not reach the device: {ex.Message}");
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
                    // The command never fired at all — a KNOWN "no" from the device itself.
                    return new CommandResult(commandName, WriteOutcome.Failed, Detail: $"device rejected the command: {ex.Message}");
                }
                catch (Exception) when (ct.IsCancellationRequested)
                {
                    return new CommandResult(commandName, WriteOutcome.Indeterminate,
                        Detail: "cancelled before a definitive response arrived — the connection was torn down to unblock the in-flight command.");
                }
                catch (Exception ex)
                {
                    return new CommandResult(commandName, WriteOutcome.Indeterminate, Detail: $"command did not complete: {ex.Message}");
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
                catch (Exception ex)
                {
                    // Whatever went wrong resetting the coil (an explicit device rejection, a timeout, a
                    // cancellation) — the pulse's PRIMARY effect already happened. Reporting Failed here
                    // would wrongly imply the command never fired; reporting Applied would wrongly claim a
                    // fully-confirmed clean rest state. Indeterminate is the only honest answer.
                    return new CommandResult(commandName, WriteOutcome.Indeterminate,
                        Detail: $"coil {coilAddress} was asserted but the reset write did not complete: {ex.Message}");
                }
            }
            finally
            {
                master.Transport.Retries = previousRetries;
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

    public ValueTask DisposeAsync()
    {
        if (_disposed) return ValueTask.CompletedTask;
        _disposed = true;
        Health = DriverHealthState.Down;
        DisposeConnection();
        return ValueTask.CompletedTask;
    }
}
