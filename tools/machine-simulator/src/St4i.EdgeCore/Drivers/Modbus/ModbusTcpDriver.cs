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
/// </summary>
public sealed class ModbusTcpDriver : IDeviceDriver
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
    }

    public string Id { get; }

    public string Kind => DriverKinds.Modbus;

    public DriverHealthState Health { get; private set; }

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
            try
            {
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
