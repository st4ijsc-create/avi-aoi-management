using System.Runtime.CompilerServices;
using St4i.Connector.Abstractions;
using St4i.Connector.Abstractions.Models;

namespace St4i.EdgeCore.Drivers.Modbus;

/// <summary>
/// Task D-2 (.superpowers/sdd/2026-08-02-dotD-modbus-rtu-blueprint/task-2-brief.md) — <b>the Modbus RTU
/// driver.</b> Polls one slave address on one shared RS-485 bus and yields one <see cref="DeviceReading"/>
/// per poll, on the same <see cref="IDeviceDriver"/> seam every other driver uses. Read-only in this task;
/// the write path is D-5.
///
/// <para><b>What is reused from <see cref="ModbusTcpDriver"/>, and what could not be.</b> The protocol layer
/// is genuinely free: NModbus's <c>ModbusSerialTransport</c> owns CRC and t3.5 framing, and every read call
/// lives on <c>IModbusMaster</c>, so <c>ReadHoldingRegistersAsync</c>/<c>ReadInputRegistersAsync</c> here are
/// byte-identical to the TCP driver's. The decode math is reused literally, not copied —
/// <see cref="ModbusRegister.DecodeRawWord"/> was extracted out of <see cref="ModbusTcpDriver"/> for this
/// task and both drivers now call it, so the two cannot drift. <see cref="ModbusRegisterMap"/> is reused
/// unforked: it was already transport-agnostic and its <c>UnitId</c> is already documented as "the Modbus
/// slave address on the wire".</para>
///
/// <para>The health/reconnect state machine is reused in shape but not in code, and the reason is
/// structural: reconnection belongs to the BUS here, not to the driver, because N drivers share one link and
/// exactly one of them must own rebuilding it. So this class keeps the TCP driver's observable contract
/// verbatim — <see cref="Health"/> starts <see cref="DriverHealthState.Down"/>, the constructor performs no
/// I/O, a successful poll flips it to <see cref="DriverHealthState.Connected"/>, any failure flips it to
/// <see cref="DriverHealthState.Degraded"/> without ever throwing out of the iterator — while
/// <see cref="ModbusBus"/> owns the connect/teardown/rebuild half.</para>
///
/// <para><b>🔴 The one thing that deliberately does NOT carry over: cancellation.</b> Đợt B honours a
/// <see cref="CancellationToken"/> through NModbus by disposing the connection
/// (<c>ct.Register(DisposeConnection)</c>). This driver never does that, because the connection is not its
/// own — see <see cref="ModbusBus"/>'s doc comment for the two mechanisms that replace it and for what
/// happens to the bus after a timeout. The consequence visible from here is small and worth naming: a
/// cancellation between two registers of a poll unwinds instantly and leaves the bus CLEAN (nothing is
/// outstanding on the wire, so the next device pays nothing), whereas a cancellation during a register's read
/// unwinds within about one abort slice and leaves the bus quarantined for one quiet window.</para>
///
/// <para><b>Broadcast (slave address 0) is not supported, and is not rejected here either.</b> Modbus
/// broadcast is write-only by definition — a slave never answers a broadcast — so a READ addressed to unit 0
/// has no meaning and would simply time out. This driver deliberately does not add a validation path for it:
/// <see cref="ModbusRegisterMap"/> is the single place map validation lives and the D-2 brief is explicit that
/// a genuine insufficiency there is to be REPORTED rather than closed with a second validator. Recorded in
/// task-2-report.md as a finding for D-4/D-7; the observable behaviour today is a device that never answers,
/// which degrades honestly.</para>
/// </summary>
public sealed class ModbusRtuDriver : IDeviceDriver
{
    private readonly ModbusBusLease _lease;
    private readonly ModbusRegisterMap _map;
    private readonly Action<Exception, string>? _logError;
    private volatile bool _disposed;

    /// <param name="lease">This driver's own claim on the shared bus. The driver OWNS it and releases it in
    /// <see cref="DisposeAsync"/> — that is what makes the reference count track driver lifetime, which is
    /// what D-4 needs when N drivers share one link. A caller that wants the bus to outlive this driver takes
    /// its own second lease; it must not hand this one out twice.</param>
    public ModbusRtuDriver(
        ModbusBusLease lease,
        ModbusRegisterMap map,
        Action<Exception, string>? logError = null)
    {
        _lease = lease ?? throw new ArgumentNullException(nameof(lease));
        _map = map ?? throw new ArgumentNullException(nameof(map));
        _logError = logError;

        // Includes the unit id, unlike the TCP driver's — on a multidrop bus the endpoint alone does not
        // identify a device, and this string keys slot labels and therefore alarm TargetIds.
        Id = $"modbus-rtu:{lease.Bus.Key}:unit{map.UnitId}:{map.MachineCode}";
        Health = DriverHealthState.Down;
    }

    public string Id { get; }

    /// <summary>The same connector id as the TCP driver. RTU and TCP are two transports for ONE protocol, and
    /// <see cref="DriverKinds"/>' own contract is that these five strings are already on the wire and in real
    /// installs' <c>assets.db</c>; minting a sixth would fork the operator-visible vocabulary for a
    /// distinction the operator does not make. Which transport an instance uses is a property of its
    /// configuration, and is visible in <see cref="Id"/>.</summary>
    public string Kind => DriverKinds.Modbus;

    public DriverHealthState Health { get; private set; }

    /// <summary>The poll loop. Structurally identical to <see cref="ModbusTcpDriver.ReadAsync"/>, including
    /// the C# constraint that forces its shape: `yield` cannot appear inside a try that has a catch, so each
    /// iteration's attempt is wrapped in its own try/catch that only sets <see cref="Health"/>/logs and never
    /// rethrows a non-cancellation exception, and the `yield return`/delay happen after that block exits.
    ///
    /// <para>The arbitration wait is INSIDE the try, not around it: on a busy bus a poll can spend most of its
    /// time queued, and a cancellation landing there must end the enumeration rather than degrade the
    /// driver — a device waiting its turn is not a device that is failing.</para></summary>
    public async IAsyncEnumerable<DeviceReading> ReadAsync([EnumeratorCancellation] CancellationToken ct)
    {
        while (!ct.IsCancellationRequested)
        {
            // Mirrors ModbusTcpDriver's own GP-6b guard: a post-dispose iteration must not reach for a lease
            // this driver has already released.
            if (_disposed)
            {
                yield break;
            }

            DeviceReading? reading = null;
            try
            {
                reading = await PollOnceAsync(ct).ConfigureAwait(false);
                Health = DriverHealthState.Connected;
            }
            catch (OperationCanceledException)
            {
                yield break;
            }
            catch (Exception ex)
            {
                // Resilient by design, same as the TCP driver: a transient bus failure degrades and is retried
                // next iteration; it never throws out of this iterator. There is nothing to tear down here —
                // ModbusBus already decided whether its link is faulted (rebuild next time) or merely
                // desynchronised (resynchronise next time), and this driver must not second-guess that on a
                // link it shares.
                Health = DriverHealthState.Degraded;
                _logError?.Invoke(ex, $"Modbus RTU poll failed for {_map.MachineCode} (unit {_map.UnitId}) on bus {_lease.Bus.Key}");
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

    /// <summary>One poll: take the bus, read every configured register one at a time, decode each, and hand
    /// the bus back. Block-batching is the same documented follow-up it is for the TCP driver.
    ///
    /// <para>🔴 <b>The retry count handed to the bus is the READ path's, which defaults to 1 — NOT 0.</b>
    /// <see cref="ModbusRegisterMap.EffectiveRetries"/> is <c>Retries ?? 1</c>, and probing confirmed
    /// <c>Retries = 1</c> makes NModbus write the whole request TWICE. That is deliberate and matches
    /// <see cref="ModbusTcpDriver"/> exactly: an extra READ is harmless and absorbs a CRC glitch on a noisy
    /// RS-485 line, which is the case this default exists for.
    ///
    /// <b>D-5 must not inherit it.</b> Đợt B's "no implicit retry" rule is a WRITE-path rule, and the TCP
    /// driver implements it by forcing <c>Transport.Retries = 0</c> around each individual write and
    /// restoring the map's value afterwards — the connection does not do it on the caller's behalf, and
    /// neither does <see cref="ModbusBus"/>. A write path that simply opens a transaction and writes will
    /// send the request twice against a silent device, which is a physical DOUBLE-ACTUATION. Pass
    /// <c>retries: 0</c> explicitly for every write, per
    /// <see cref="ModbusBus.BeginTransactionAsync"/>'s own <c>retries</c> parameter documentation.</para></summary>
    private async Task<DeviceReading> PollOnceAsync(CancellationToken ct)
    {
        await using var transaction = await _lease.Bus
            .BeginTransactionAsync(_map.EffectiveReadTimeoutMs, _map.EffectiveRetries, ct)
            .ConfigureAwait(false);

        var samples = new List<TelemetrySample>(_map.Registers.Count);

        foreach (var register in _map.Registers)
        {
            // Between registers the bus is clean — the previous response was consumed whole — so a
            // cancellation here costs the bus nothing at all. Checked explicitly rather than relying on the
            // in-flight abort, which is the more expensive of the two paths.
            ct.ThrowIfCancellationRequested();

            ushort[] raw;
            try
            {
                raw = await transaction.ExecuteAsync(master => register.Type == ModbusRegisterType.Holding
                    ? master.ReadHoldingRegistersAsync(_map.UnitId, register.Address, 1)
                    : master.ReadInputRegistersAsync(_map.UnitId, register.Address, 1)).ConfigureAwait(false);
            }
            catch (Exception) when (ct.IsCancellationRequested)
            {
                // The read was unblocked by this transaction's own AbortPendingRead registration, not by a
                // genuine protocol failure — surface it as cancellation so ReadAsync's catch ends the
                // enumeration instead of logging and degrading. The transaction's disposal (already scheduled
                // by `await using`) quarantines the bus, because an aborted read leaves it in exactly the
                // state a timeout does.
                throw new OperationCanceledException("Modbus RTU read interrupted by cancellation.", ct);
            }

            // The identical decode the TCP driver performs — one implementation, called twice.
            samples.Add(new TelemetrySample(register.Metric, register.DecodeRawWord(raw[0]), register.Unit, "good"));
        }

        return new DeviceReading
        {
            MachineCode = _map.MachineCode,
            Kind = ReadingKind.Telemetry,
            // Telemetry has no pass/fail concept. Verdict MUST be Skip, not the enum default (Pass):
            // FleetHost.OnPipelineCommitted counts any reading whose Verdict != Skip toward the fleet-wide
            // FPY/judged/pass KPIs, so a defaulted Pass would silently inflate operator FPY on every poll.
            // Same reasoning, and the same defect already found once, as ModbusTcpDriver.PollOnceAsync.
            Verdict = Verdict.Skip,
            Telemetry = samples,
            Timestamp = DateTimeOffset.UtcNow,
        };
    }

    /// <summary>Releases this driver's lease. Idempotent (both because of this method's own guard and because
    /// <see cref="ModbusBusLease.DisposeAsync"/> is itself idempotent — <c>FleetHost</c> can genuinely dispose
    /// a driver twice, and a double decrement would dispose a bus other drivers are still using). Does NOT
    /// wait for an in-flight poll: the same rule <see cref="ModbusTcpDriver.DisposeAsync"/> follows, for the
    /// same reason.</summary>
    public async ValueTask DisposeAsync()
    {
        if (_disposed) return;
        _disposed = true;
        Health = DriverHealthState.Down;
        await _lease.DisposeAsync().ConfigureAwait(false);
    }
}
