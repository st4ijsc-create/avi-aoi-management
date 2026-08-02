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
/// <para><b>🔴 Task D-4 — broadcast (slave address 0) and the reserved addresses are now REFUSED, and this
/// constructor is where that lives.</b> D-2 reported this as a finding rather than closing it, and its own
/// correction (task-2-report.md §10b, m-9) is the reason the check is here and not in
/// <see cref="ModbusRegisterMap.FromJson"/>: that method is shared with <see cref="ModbusTcpDriver"/>, where
/// unit 0 is entirely legal and common (a TCP device that ignores the unit id, or a TCP→RTU gateway that uses
/// it to select the serial slave), so a parse-time rejection would break deployments to fix a problem they do
/// not have. The constraint is RTU's, so it belongs at the RTU CONSTRUCTION boundary — which is this
/// constructor, and which covers every RTU path including a single-device map that never went through
/// <see cref="ModbusMultidropMap.FanOut"/>. See <see cref="ModbusMultidropMap"/> for why the multidrop
/// fan-out deliberately does not duplicate it.</para>
/// </summary>
public sealed class ModbusRtuDriver : IDeviceDriver
{
    private readonly ModbusBusLease _lease;
    private readonly ModbusRegisterMap _map;
    private readonly Action<Exception, string>? _logError;
    private volatile bool _disposed;

    /// <summary>The lowest and highest slave address a Modbus RTU master can address individually.
    /// <c>MODBUS over Serial Line V1.02</c> §2.2: address 0 is the broadcast address, 1–247 address one slave
    /// each, and 248–255 are reserved. Constants rather than literals in the two checks below so the range and
    /// the message can never drift apart, and so a test names the same boundary this class does instead of
    /// restating it.</summary>
    public const byte MinUnitId = 1;

    /// <inheritdoc cref="MinUnitId"/>
    public const byte MaxUnitId = 247;

    /// <param name="lease">This driver's own claim on the shared bus. The driver OWNS it and releases it in
    /// <see cref="DisposeAsync"/> — that is what makes the reference count track driver lifetime, which is
    /// what D-4 needs when N drivers share one link. A caller that wants the bus to outlive this driver takes
    /// its own second lease; it must not hand this one out twice.</param>
    /// <exception cref="ArgumentOutOfRangeException">🔴 Task D-4 — <paramref name="map"/>'s
    /// <see cref="ModbusRegisterMap.UnitId"/> is 0 (broadcast) or 248–255 (reserved). <b>The RTU construction
    /// boundary is where this rule lives</b> — see the class doc comment for why not in the shared parse path.
    /// Refused rather than allowed to degrade honestly: a read addressed to unit 0 can never be answered (a
    /// slave never replies to a broadcast, by definition), so the device would time out forever while looking
    /// exactly like a wiring fault — and on a MULTIDROP bus that is not a private failure, because every one of
    /// those timeouts holds the shared arbitration lock for a full read timeout and taxes every other device on
    /// the line. A configuration that cannot work is refused where an operator gets told, not left to present
    /// itself as a dead device.
    ///
    /// <para>🔴 <b>Review I-5 — a caller that already acquired <paramref name="lease"/> must dispose it when
    /// this throws, and the cheapest way not to need to is <see cref="ValidateRtuUnitId"/> BEFORE
    /// <c>ModbusBusRegistry.Acquire</c>.</b> A leaked lease is not a tidy-up nicety: the reference count never
    /// reaches zero, so the bus — and the physical link under it — lives for the rest of the process, and D-3
    /// measured that <c>System.IO.Ports.SerialPort</c> opens a COM port EXCLUSIVELY. The port stays unusable
    /// until restart, and it presents as an unrelated connector failing to start.</para>
    ///
    /// <para><b>The first version of this remark gave the wrong reason</b> — *"there is no way for this class to
    /// do it, because it cannot tell a lease it was handed from one it created"* — and it contradicted the
    /// <c>lease</c> parameter's own doc one line above, which says <b>the driver OWNS it</b>. Ownership
    /// transfers at the call, so provenance is irrelevant and disposing on constructor failure would have been
    /// perfectly correct; <see cref="ModbusBusLease.DisposeAsync"/> is idempotent by <c>Interlocked.Exchange</c>,
    /// so even a double release is harmless. What makes validating FIRST the better answer is not that this
    /// class cannot dispose — it is that a constructor cannot dispose ASYNCHRONOUSLY without blocking, and the
    /// failure is fully knowable before any lease is taken. Recorded rather than quietly reworded, because two
    /// artefacts disagreeing about ownership is how the next author picks the wrong one.</para></exception>
    public ModbusRtuDriver(
        ModbusBusLease lease,
        ModbusRegisterMap map,
        Action<Exception, string>? logError = null)
    {
        _lease = lease ?? throw new ArgumentNullException(nameof(lease));
        _map = map ?? throw new ArgumentNullException(nameof(map));
        _logError = logError;

        ValidateRtuUnitId(map);

        // Includes the unit id, unlike the TCP driver's — on a multidrop bus the endpoint alone does not
        // identify a device, and this string keys slot labels and therefore alarm TargetIds.
        Id = $"modbus-rtu:{lease.Bus.Key}:unit{map.UnitId}:{map.MachineCode}";
        Health = DriverHealthState.Down;
    }

    /// <summary>
    /// 🔴 Task D-4, review I-5 — <b>the RTU addressing rule, callable BEFORE a lease exists.</b> Extracted out of
    /// the constructor so D-7's connector factory can refuse a bad map without first calling
    /// <c>ModbusBusRegistry.Acquire</c> — see the constructor's <c>ArgumentOutOfRangeException</c> remarks for
    /// what a leaked lease costs (an exclusively-opened COM port, unusable for the process lifetime, presenting
    /// as an unrelated connector failing to start).
    ///
    /// <para>Extracting it rather than telling D-7 to restate the checks matters for the usual reason: two
    /// statements of one rule drift, and the version that drifts here would either let a broadcast address
    /// through or refuse a legitimate one. The constructor calls THIS method, so there is exactly one
    /// implementation and one pair of messages.</para>
    ///
    /// <para>Unit 0 is the Modbus BROADCAST address — write-only by definition, so a read addressed to it can
    /// never be answered — and 248–255 are RESERVED by <c>MODBUS over Serial Line V1.02</c> §2.2. Both are legal
    /// values for <see cref="ModbusRegisterMap.UnitId"/> and one of them (0) is legal and common over Modbus
    /// TCP, which is why this rule lives here and not in the shared parse path.</para>
    /// </summary>
    /// <exception cref="ArgumentOutOfRangeException">The map's unit id is 0 or 248–255.</exception>
    public static void ValidateRtuUnitId(ModbusRegisterMap map)
    {
        ArgumentNullException.ThrowIfNull(map);

        if (map.UnitId < MinUnitId)
        {
            throw new ArgumentOutOfRangeException(nameof(map), map.UnitId,
                $"Modbus RTU: machine '{map.MachineCode}' declares unit id 0, the Modbus BROADCAST address. " +
                "Broadcast is write-only by definition — a slave never answers one — so a read addressed to it " +
                "can never be answered and this device would time out forever, holding the shared bus for a full " +
                "read timeout on every poll. Unit 0 is legal for Modbus TCP and is rejected only here, at the RTU " +
                $"boundary; give this device its own address in [{MinUnitId},{MaxUnitId}].");
        }

        if (map.UnitId > MaxUnitId)
        {
            throw new ArgumentOutOfRangeException(nameof(map), map.UnitId,
                $"Modbus RTU: machine '{map.MachineCode}' declares unit id {map.UnitId}, which MODBUS over Serial " +
                $"Line V1.02 §2.2 RESERVES (248–255). No slave may be configured to answer it, so this device " +
                $"would time out forever and tax every other device on the bus. Individually addressable slaves " +
                $"are [{MinUnitId},{MaxUnitId}].");
        }
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
