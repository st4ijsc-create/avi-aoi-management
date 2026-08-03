using System.Runtime.CompilerServices;
using NModbus;
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
///
/// <para>🔴 <b>Task D-5 — this driver now WRITES, and it is the first time in this product that a driver
/// physically changes a machine on a line it shares with other machines.</b> See
/// <see cref="WriteSetpointAsync"/> and <see cref="InvokeCommandAsync"/>. Four decisions carry the safety of
/// that, and each is stated where it is implemented rather than only here:</para>
///
/// <list type="number">
/// <item><description><b><c>retries: 0</c>, explicitly, on every write transaction</b> — see
/// <see cref="ExecuteRegisterWriteAsync"/>. Not inherited: <see cref="PollOnceAsync"/> runs at
/// <see cref="ModbusRegisterMap.EffectiveRetries"/> (<c>Retries ?? 1</c>), and probed against NModbus 3.0.83 a
/// write at <c>Retries = 1</c> puts <b>two</b> identical request frames on the wire and at NModbus's own default
/// of 3 puts <b>four</b>. On a write that is a physical double-actuation.</description></item>
/// <item><description><b>No exception ever escapes either write member</b>, per B-1: an
/// <see cref="WriteOutcome.Indeterminate"/> result is the ONLY channel that can tell a caller the device's state
/// is unknown, and a thrown exception carries no result object at all.</description></item>
/// <item><description><b>Every write goes through <see cref="ModbusBusTransaction.ExecuteAsync(Func{NModbus.IModbusMaster, Task})"/></b>,
/// never through <see cref="ModbusBusTransaction.Master"/>, so a write that does not consume a complete,
/// validated response leaves the shared bus quarantined — which is what stops the NEXT machine's read from
/// being answered by this write's late echo.</description></item>
/// <item><description><b>A coil pulse's assert and reset halves share ONE transaction</b> — see
/// <see cref="ExecuteCoilPulseAsync"/>. On TCP the equivalent lock is private to one driver; here releasing it
/// between the halves would let another machine's transaction run while a coil sits latched
/// HIGH.</description></item>
/// </list>
///
/// <para><b>🔴 What an RTU write CAN and CANNOT be fooled by — measured, not inferred.</b> A Modbus write
/// response is an ECHO of the request, and NModbus 3.0.83 validates it on four independent fields. Probed
/// directly against the shipped package: a wrong-address echo raises <c>IOException: Unexpected start address
/// in response. Expected 5, received 9.</c>; a wrong-value echo raises <c>Unexpected data in response. Expected
/// 42, received 99.</c>; an echo from another slave raises <c>Response slave address does not match request.</c>;
/// and a stale FC03 READ response answering an FC06 write fails the CRC. <b>That is strictly narrower than the
/// read hazard</b> D-2 measured, where a stale frame matching only slave address, function code and length is
/// returned as the answer with no exception: to be mistaken for a write acknowledgement a stale frame must
/// additionally match the exact register/coil address AND the exact value — i.e. it must be the echo of an
/// identical earlier write to the same point with the same value. Combined with
/// <see cref="ModbusBus"/>'s quiet window, which refuses to write until the line has been OBSERVED silent, that
/// is the answer to "can a stale frame acknowledge a write". It is a narrower residual, not a closed one, and
/// <see cref="InvokeCommandAsync"/> names the one case where the residual is not benign.</para>
/// </summary>
public sealed class ModbusRtuDriver : IWritableDeviceDriver
{
    private readonly ModbusBusLease _lease;
    private readonly ModbusRegisterMap _map;
    private readonly Action<Exception, string>? _logError;
    private volatile bool _disposed;

    /// <summary>Task D-5 — a snapshot taken ONCE at construction, satisfying
    /// <see cref="IWritableDeviceDriver.WritablePoints"/>'s "fixed for the lifetime of this instance, never a
    /// live view" contract. <c>.AsReadOnly()</c> (a genuine <see cref="System.Collections.ObjectModel.ReadOnlyCollection{T}"/>,
    /// not merely an interface-typed reference over a <see cref="List{T}"/> a caller could cast back and mutate)
    /// for the same reason <see cref="ModbusTcpDriver"/>'s own equivalent is.</summary>
    private readonly IReadOnlyList<string> _writablePoints;

    /// <inheritdoc cref="_writablePoints"/>
    private readonly IReadOnlyList<string> _commands;

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
        _writablePoints = new List<string>(_map.WritablePointNames).AsReadOnly();
        _commands = new List<string>(_map.CommandNames).AsReadOnly();
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
    ///
    /// <para>🔴 <b>Task D-5 — and this closes the question D-2 §9.1 left open: whether an RTU BROADCAST WRITE is
    /// ever permitted. It is not, and this check is why it is unreachable rather than refused later.</b> Because
    /// no <see cref="ModbusRtuDriver"/> can be constructed at unit 0, there is no write path to reach: a
    /// broadcast write would need a driver that can never read, which is a different type nobody has asked for.
    /// The reason not to build it is not the plumbing — it is that a slave never answers a broadcast, so the
    /// best possible <see cref="WriteOutcome"/> for one is <see cref="WriteOutcome.Indeterminate"/> <i>by
    /// definition, on every single call, forever</i>. A capability whose only honest outcome is "we do not know"
    /// is not one to offer for something that moves a machine. Recorded here rather than only in a report,
    /// because this is where the next person will look.</para>
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

    /// <inheritdoc/>
    public IReadOnlyList<string> WritablePoints => _writablePoints;

    /// <inheritdoc/>
    public IReadOnlyList<string> Commands => _commands;

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

    // ─────────────────────────────────────────────────────────────────────
    // 🔴 Task D-5 — IWritableDeviceDriver on a SHARED bus. See this class's own doc comment for the four
    // decisions these members rest on; see each method for the one it owns.
    // ─────────────────────────────────────────────────────────────────────

    /// <summary>
    /// Writes one declared Holding register. Every rejection below happens BEFORE any byte reaches the shared
    /// line — B-1 requires it, and on a multidrop bus it matters more than it does at 1:1, because a rejected
    /// write that still took the arbitration lock would tax every other machine for a caller's typo.
    ///
    /// <para><b><see cref="ModbusRegister.TryComputeRawWordForWrite"/> is CALLED, not re-derived.</b> It is the
    /// one place the declared <c>[min,max]</c>, finiteness (<see cref="double.NaN"/> silently wrote a raw 0
    /// before B-3 caught it), the physical-type range after inverse scaling, and the rounding live. This driver
    /// adds no second validation path — confirmed by reading the doc block attached to that method's own body
    /// rather than the one above it, because D-3's review found a doc block on that type had been re-parented
    /// onto the wrong member once already.</para>
    ///
    /// <para>🔴 <b>Review I-3 — the caller's obligation, recorded on the member rather than only in a
    /// report.</b> <b>Never call this with an unbounded <see cref="CancellationToken"/>.</b> On a shared bus
    /// this call can queue behind another device's whole hold — <c>registers × (retries+1) × readTimeoutMs</c>,
    /// which is 16 000 ms at map defaults and about two hours at the map's own accepted maxima
    /// (<see cref="ModbusRegisterMap.WorstCaseBusHoldMs"/> computes it). The wait IS cancellable and a caller
    /// that gives up is told the device is provably untouched — but only if someone supplies the bound. Size it
    /// against the LARGEST <see cref="ModbusRegisterMap.WorstCaseBusHoldMs"/> among the devices sharing this
    /// bus, not this device's own. This is the standing reason the per-device backoff was deferred rather than
    /// built (task-5-report.md §7): a backoff changes how OFTEN a dead device takes the line, never how long it
    /// holds it, so it would not move this number at all.</para>
    ///
    /// <para>🔴 <b>And the same caveat <see cref="InvokeCommandAsync"/> carries, in its weaker form:</b> an
    /// <see cref="WriteOutcome.Applied"/> here means a frame came back matching this request on slave address,
    /// function code, register address and value — an acknowledgement, not an observation. For a setpoint the
    /// residual is benign (an echo that matches the value is the echo of a write that would have left the
    /// register at that value anyway); for a command it is not, which is why the full statement lives
    /// there.</para>
    /// </summary>
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

        if (!register.TryComputeRawWordForWrite(engineeringValue, out var rawWord, out var rangeError))
        {
            return new SetpointWriteResult(request.Point, WriteOutcome.Rejected, SetpointRejectionReason.OutOfRange, rangeError);
        }

        if (_disposed)
        {
            return new SetpointWriteResult(request.Point, WriteOutcome.Indeterminate,
                Detail: "this driver has already been disposed — its lease on the shared RTU bus is released.");
        }

        try
        {
            return await ExecuteRegisterWriteAsync(request.Point, register.Address, rawWord, ct).ConfigureAwait(false);
        }
        catch (Exception ex)
        {
            // Final backstop — B-1: neither write member may EVER let an exception propagate, for any reason.
            // Every well-understood failure is already translated inside ExecuteRegisterWriteAsync; this only
            // catches something genuinely unforeseen. Same redaction discipline as ModbusTcpDriver's: only the
            // TYPE name reaches the operator-visible Detail, the full exception reaches the logger.
            _logError?.Invoke(ex, $"Modbus RTU setpoint write to '{request.Point}' failed unexpectedly on {_map.MachineCode} (unit {_map.UnitId}) on bus {_lease.Bus.Key}");
            return new SetpointWriteResult(request.Point, WriteOutcome.Indeterminate, Detail: $"unexpected failure: {ex.GetType().Name}");
        }
    }

    /// <summary>
    /// Pulses one declared coil TRUE then FALSE. Same pre-flight discipline as
    /// <see cref="WriteSetpointAsync"/>; the outcome-composition rule once the two halves can disagree is
    /// <see cref="ExecuteCoilPulseAsync"/>'s.
    ///
    /// <para>🔴 <b>The one place this transport's residual stale-frame hazard is NOT benign.</b> A write echo
    /// must match slave address, function code, coil address and value to be accepted (see this class's doc
    /// comment for the probe). For a SETPOINT that residual is benign — an echo that matches the value is an
    /// echo of a write that would have left the register at the value being written anyway. For a COIL it is
    /// not: an <c>FC05 coil 3 = ON</c> echo left over from an earlier pulse matches a NEW pulse's assert half
    /// exactly, so a new pulse whose request never reached the device could be acknowledged by the old one's
    /// answer. What narrows it is <see cref="ModbusBus"/>'s quiet window — that stale echo must arrive later
    /// than the previous transaction's own read timeout PLUS a full window of observed silence — and what would
    /// close it does not exist in the protocol: an RTU frame carries nothing to correlate it with a request.
    /// Named rather than left for a commissioning engineer to find.</para>
    ///
    /// <para>🔴 <b>Review I-2(a) — and it is worse than the paragraph above said, because a pulse leaves TWO
    /// echoes, not one.</b> A previously COMPLETED pulse on this coil emits an <c>FC05 = ON</c> echo and an
    /// <c>FC05 = OFF</c> echo, in that order. If a whole pulse's request frames reach a device that has gone
    /// away, and that earlier pair arrives late, in order, inside this transaction's two reads, then <b>both
    /// halves are acknowledged and this method returns <see cref="WriteOutcome.Applied"/> with nothing having
    /// reached the machine at all</b> — the one outcome that is supposed to mean the device confirmed it. The
    /// earlier wording described only the assert half being fooled, which understated the residual; and since
    /// the residual's entire mitigation is that it is documented, understating it was the defect.</para>
    ///
    /// <para>What still has to be true for it: the pair must survive
    /// <see cref="ModbusBus.ResynchroniseAsync"/>'s observed-silent window, then NModbus's own
    /// <c>DiscardInBuffer</c> immediately before each request, then arrive in assert-then-reset order. That is a
    /// narrow window, and it is narrow rather than closed. <b>See task-5-report.md §15 for the discriminator
    /// that was weighed for this and declined, and why</b> — the short form is that the only signal available
    /// (bytes discarded by this transaction's entry resynchronisation) is unattributable to a unit id, so on a
    /// shared line it fires mostly on another device's debris, which NModbus's slave-address validation has
    /// already ruled out as an acknowledgement.</para>
    ///
    /// <para>🔴 <b>Task D-6 — blueprint §10 item 4 made that a question for THIS task, and the answer is on the
    /// seam rather than in a report: see <see cref="IModbusBusLink.DrainBufferedInput"/>.</b> Its precondition
    /// (a drain that can attribute discarded bytes to a unit id) is still not met by either shipping link, so
    /// the discriminator remains unbuildable and D-5's refusal stands unchanged. The full check, and what
    /// building it would cost, is recorded once — there — because two statements of one rule drift.</para>
    ///
    /// <para>🔴 <b>Consequence for D-6 and D-7, stated here because this is the member they gate:</b> an
    /// <see cref="WriteOutcome.Applied"/> from this method is <b>an acknowledgement, not an observation.</b> It
    /// means a frame arrived that matched this request on slave address, function code, coil address and value.
    /// It is not proof that a machine moved. A conformance check must not assert physical effect from it, and an
    /// audit row must not present it to an operator as one.</para>
    ///
    /// <para>🔴 <b>Review I-3 — the caller's obligation, recorded on the member rather than only in a
    /// report.</b> <b>Never call this with an unbounded <see cref="CancellationToken"/>.</b> On a shared bus
    /// this call can queue behind another device's whole hold — <c>registers × (retries+1) × readTimeoutMs</c>,
    /// which is 16 000 ms at map defaults and about two hours at the map's own accepted maxima
    /// (<see cref="ModbusRegisterMap.WorstCaseBusHoldMs"/> computes it). The wait IS cancellable and a caller
    /// that gives up is told the device is provably untouched — but only if someone supplies the bound. Size it
    /// against the LARGEST <see cref="ModbusRegisterMap.WorstCaseBusHoldMs"/> among the devices sharing this
    /// bus, not this device's own. This is the standing reason the per-device backoff was deferred rather than
    /// built (task-5-report.md §7): a backoff changes how OFTEN a dead device takes the line, never how long it
    /// holds it, so it would not move this number at all.</para>
    /// </summary>
    public async Task<CommandResult> InvokeCommandAsync(CommandRequest request, CancellationToken ct)
    {
        ArgumentNullException.ThrowIfNull(request);

        var command = ModbusWritePreflight.FindCommandByName(_map, request.Command);
        if (command is null)
        {
            return new CommandResult(request.Command, WriteOutcome.Rejected, CommandRejectionReason.UnknownCommand,
                $"'{request.Command}' does not name a command this map declares.");
        }

        // B-3 rejects any Modbus command that declares an argument at parse time, so a validated map's own
        // command.Arguments is always null/empty. Checked here too, defensively, rather than assumed
        // unreachable — the same reason ModbusTcpDriver checks it.
        if (request.Arguments is { Count: > 0 })
        {
            return new CommandResult(request.Command, WriteOutcome.Rejected, CommandRejectionReason.InvalidArgument,
                $"'{request.Command}' takes no arguments — Modbus commands in this build are zero-argument coil pulses.");
        }

        if (command.CoilAddress is not { } coilAddress)
        {
            // Unreachable via ModbusRegisterMap.FromJson's own mandatory-coilAddress validation; reachable via
            // direct construction, which is exactly what this driver's own tests (and any in-process caller)
            // can do. An ordinary pre-flight Rejected rather than a throw, so the "never throws" posture holds.
            return new CommandResult(request.Command, WriteOutcome.Rejected, CommandRejectionReason.InvalidArgument,
                $"'{request.Command}' has no declared coil address — a malformed command declaration that could " +
                "only be reached by constructing a ModbusCommand directly, bypassing ModbusRegisterMap.FromJson's " +
                "own mandatory-coilAddress check.");
        }

        if (_disposed)
        {
            return new CommandResult(request.Command, WriteOutcome.Indeterminate,
                Detail: "this driver has already been disposed — its lease on the shared RTU bus is released.");
        }

        try
        {
            return await ExecuteCoilPulseAsync(request.Command, coilAddress, ct).ConfigureAwait(false);
        }
        catch (Exception ex)
        {
            // See WriteSetpointAsync's own backstop remarks; identical reasoning and identical redaction.
            _logError?.Invoke(ex, $"Modbus RTU command '{request.Command}' failed unexpectedly on {_map.MachineCode} (unit {_map.UnitId}) on bus {_lease.Bus.Key}");
            return new CommandResult(request.Command, WriteOutcome.Indeterminate, Detail: $"unexpected failure: {ex.GetType().Name}");
        }
    }

    /// <summary>
    /// 🔴 <b>Takes the shared bus for ONE write, with <c>retries: 0</c> passed EXPLICITLY.</b>
    ///
    /// <para><b>Why the retry count is written here rather than inherited.</b>
    /// <see cref="PollOnceAsync"/> hands the bus <see cref="ModbusRegisterMap.EffectiveRetries"/>, which is
    /// <c>Retries ?? 1</c>, and <see cref="ModbusBus.BeginTransactionAsync"/> applies whatever it is given and
    /// forces nothing on the caller's behalf. Measured against NModbus 3.0.83 for a WRITE specifically (not
    /// inferred from the read-path measurement): one FC06 request frame at <c>Retries = 0</c>, <b>two</b> at
    /// <c>Retries = 1</c>, <b>four</b> at NModbus's own default of 3. Two identical FC06 frames against a
    /// device that answered the first one late is a register written twice; two identical FC05 frames is a
    /// machine started twice.</para>
    ///
    /// <para><b>Why the read timeout is the map's own, and what that costs.</b>
    /// <see cref="ModbusRegisterMap.EffectiveReadTimeoutMs"/> is the one bound the map declares for how long
    /// this device may take to answer, and a write echo comes back on the same round trip a read response does
    /// — inventing a second bound would mean a read and a write disagreed about a fact belonging to the device.
    /// The cost is real and is stated rather than tuned away: with no <c>readTimeoutMs</c> declared that value
    /// is <c>max(1000, PollIntervalMs × 4)</c>, a default D-4's review established was reasoned for a DEDICATED
    /// connection, so a write to a silent device holds the shared line for it — 4 s at a 1 s cadence, 240 s at
    /// a 60 s one. The caller's own <paramref name="ct"/> is what bounds an operator's wait — the full
    /// obligation, including the sizing rule, is on the two PUBLIC members
    /// (<see cref="WriteSetpointAsync"/>/<see cref="InvokeCommandAsync"/>) where a caller will actually be
    /// standing. Review I-3: it used to live only here, on a private method, on the setpoint path, and in a
    /// report — three places D-7 does not read.</para>
    ///
    /// <para><b>What happens to the BUS, and how the next machine's transaction knows it is safe.</b> The write
    /// runs inside <see cref="ModbusBusTransaction.ExecuteAsync(Func{NModbus.IModbusMaster, Task})"/>, which
    /// marks the bus dirty before the request goes out and clean only when the call returns normally. So a
    /// timeout, an aborted read, a CRC failure, an echo whose address or value does not match, or a disposal
    /// out from under it all leave the bus <see cref="ModbusBus.IsDesynchronised"/> — and the NEXT transaction,
    /// which belongs to a DIFFERENT machine, is forced to drain the line and observe
    /// <see cref="ModbusBusSettings.QuietWindowMs"/> of real silence before it may write a byte. It does not
    /// have to know anything; it is structurally prevented from proceeding on a line that has not gone quiet.
    /// A device rejection (<see cref="SlaveException"/>) quarantines the bus too, which costs one quiet window
    /// for a line that is provably clean — deliberately not special-cased, because teaching the transaction to
    /// classify a third-party exception type is the "trust the name" move this batch has already paid for
    /// twice.</para>
    /// </summary>
    private async Task<SetpointWriteResult> ExecuteRegisterWriteAsync(string point, ushort address, ushort rawWord, CancellationToken ct)
    {
        ModbusBusTransaction transaction;
        try
        {
            transaction = await _lease.Bus
                .BeginTransactionAsync(_map.EffectiveReadTimeoutMs, retries: 0, ct)
                .ConfigureAwait(false);
        }
        catch (OperationCanceledException)
        {
            return new SetpointWriteResult(point, WriteOutcome.Indeterminate, Detail: NotOnTheWireDetail("queued"));
        }
        catch (ModbusBusResynchronisationException ex)
        {
            _logError?.Invoke(ex, $"Modbus RTU bus '{_lease.Bus.Key}' refused a write to '{point}' on {_map.MachineCode}");
            return new SetpointWriteResult(point, WriteOutcome.Failed, Detail: BusRefusedDetail(ex));
        }
        catch (ObjectDisposedException)
        {
            return new SetpointWriteResult(point, WriteOutcome.Indeterminate, Detail: BusDisposedDetail());
        }
        catch (Exception ex)
        {
            _logError?.Invoke(ex, $"Modbus RTU bus '{_lease.Bus.Key}' unavailable while writing '{point}' on {_map.MachineCode}");
            return new SetpointWriteResult(point, WriteOutcome.Indeterminate, Detail: $"could not reach the device ({ex.GetType().Name}).");
        }

        await using (transaction.ConfigureAwait(false))
        {
            if (ct.IsCancellationRequested)
            {
                // Narrows the window in which a cancellation that has ALREADY happened still puts a request on
                // a shared line. It does not close it — the token can fire one instruction later — which is why
                // the in-flight catch below reports the honest "unknown", not this one.
                return new SetpointWriteResult(point, WriteOutcome.Indeterminate, Detail: NotOnTheWireDetail("holding"));
            }

            try
            {
                await transaction.ExecuteAsync(master => master.WriteSingleRegisterAsync(_map.UnitId, address, rawWord)).ConfigureAwait(false);
                return new SetpointWriteResult(point, WriteOutcome.Applied);
            }
            catch (SlaveException ex)
            {
                // The device was reached and explicitly said no — a KNOWN "no". A complete, valid response
                // arrived and parsed, so the LINE is clean; the bus is quarantined anyway (see this method's own
                // doc comment) and that costs one quiet window, not correctness.
                _logError?.Invoke(ex, $"Modbus RTU device rejected the write to '{point}' on {_map.MachineCode} (unit {_map.UnitId})");
                return new SetpointWriteResult(point, WriteOutcome.Failed,
                    Detail: $"device rejected the write: {ModbusWritePreflight.DescribeSlaveException(ex)}.");
            }
            catch (Exception) when (ct.IsCancellationRequested)
            {
                // Unblocked by this transaction's own AbortPendingRead registration — the request IS on the wire
                // and the link is still open (that is the whole point of the abort: Đợt B's teardown would take
                // every other machine on this bus down with it).
                return new SetpointWriteResult(point, WriteOutcome.Indeterminate,
                    Detail: "cancelled before a definitive response arrived — the request had already been written to " +
                            $"the shared RTU bus, so whether unit {_map.UnitId} applied it is unknown. The bus itself was " +
                            "left open and is quarantined until it has been observed silent.");
            }
            catch (Exception ex)
            {
                _logError?.Invoke(ex, $"Modbus RTU write to '{point}' did not complete on {_map.MachineCode} (unit {_map.UnitId})");
                return new SetpointWriteResult(point, WriteOutcome.Indeterminate, Detail: WriteDidNotCompleteDetail(ex));
            }
        }
    }

    /// <summary>
    /// 🔴 <b>The coil pulse — assert TRUE then reset FALSE, both inside ONE transaction.</b>
    ///
    /// <para><b>Why one transaction, and why that differs from <see cref="ModbusTcpDriver"/> in consequence
    /// rather than in shape.</b> The TCP driver holds its own private <c>_ioLock</c> across both halves; the
    /// only thing it delays is its own poll. Here the lock is the whole bus's arbitration lock, so holding it
    /// across the pulse makes every other machine on the line wait two round trips. Releasing it between the
    /// halves would be cheaper for them and worse for everyone: a coil would sit LATCHED HIGH while another
    /// device's transaction ran — and on a bus with a slow or dead device that is not microseconds, it is up to
    /// that device's whole read timeout. A level-triggered PLC rung re-fires its action every scan for as long
    /// as the coil is high, which is exactly the hazard "pulse" means to avoid. Two round trips of other
    /// machines' latency is the cheaper of the two costs, and it is bounded by this device's own
    /// <c>readTimeoutMs</c>.</para>
    ///
    /// <para><b>The outcome composition, unchanged from B-4 because the reasoning is about the device rather
    /// than the transport:</b> an explicit device rejection of the ASSERT is the only case in which the command
    /// provably never fired (<see cref="WriteOutcome.Failed"/>). Anything else that goes wrong on the assert
    /// half is <see cref="WriteOutcome.Indeterminate"/> with the coil NAMED and its state called unconfirmed —
    /// a timeout does not tell you whether the device latched it. Once the assert is confirmed, the command's
    /// physical effect has already happened, so nothing after it may report
    /// <see cref="WriteOutcome.Failed"/> (it did fire) and nothing but a clean reset may report
    /// <see cref="WriteOutcome.Applied"/> (the rest state is unconfirmed). This driver never resets a
    /// possibly-latched coil on the caller's behalf: deciding what to do about an unconfirmed device state is a
    /// human's call, and on a shared bus a second uninstructed write is also everyone else's problem.</para>
    /// </summary>
    private async Task<CommandResult> ExecuteCoilPulseAsync(string commandName, ushort coilAddress, CancellationToken ct)
    {
        ModbusBusTransaction transaction;
        try
        {
            transaction = await _lease.Bus
                .BeginTransactionAsync(_map.EffectiveReadTimeoutMs, retries: 0, ct)
                .ConfigureAwait(false);
        }
        catch (OperationCanceledException)
        {
            return new CommandResult(commandName, WriteOutcome.Indeterminate, Detail: NotOnTheWireDetail("queued"));
        }
        catch (ModbusBusResynchronisationException ex)
        {
            _logError?.Invoke(ex, $"Modbus RTU bus '{_lease.Bus.Key}' refused command '{commandName}' on {_map.MachineCode}");
            return new CommandResult(commandName, WriteOutcome.Failed, Detail: BusRefusedDetail(ex));
        }
        catch (ObjectDisposedException)
        {
            return new CommandResult(commandName, WriteOutcome.Indeterminate, Detail: BusDisposedDetail());
        }
        catch (Exception ex)
        {
            _logError?.Invoke(ex, $"Modbus RTU bus '{_lease.Bus.Key}' unavailable while invoking '{commandName}' on {_map.MachineCode}");
            return new CommandResult(commandName, WriteOutcome.Indeterminate, Detail: $"could not reach the device ({ex.GetType().Name}).");
        }

        await using (transaction.ConfigureAwait(false))
        {
            if (ct.IsCancellationRequested)
            {
                return new CommandResult(commandName, WriteOutcome.Indeterminate, Detail: NotOnTheWireDetail("holding"));
            }

            try
            {
                await transaction.ExecuteAsync(master => master.WriteSingleCoilAsync(_map.UnitId, coilAddress, true)).ConfigureAwait(false);
            }
            catch (SlaveException ex)
            {
                _logError?.Invoke(ex, $"Modbus RTU device rejected command '{commandName}' on {_map.MachineCode} (unit {_map.UnitId})");
                return new CommandResult(commandName, WriteOutcome.Failed,
                    Detail: $"device rejected the command: {ModbusWritePreflight.DescribeSlaveException(ex)}.");
            }
            catch (Exception) when (ct.IsCancellationRequested)
            {
                return new CommandResult(commandName, WriteOutcome.Indeterminate, Detail: AssertHalfUnknownDetail(
                    coilAddress,
                    "cancelled before a definitive response arrived",
                    "the request had already been written to the shared RTU bus"));
            }
            catch (Exception ex)
            {
                _logError?.Invoke(ex, $"Modbus RTU coil {coilAddress}'s assert write did not complete for command '{commandName}' on {_map.MachineCode}");
                return new CommandResult(commandName, WriteOutcome.Indeterminate, Detail: AssertHalfUnknownDetail(
                    coilAddress,
                    $"command did not complete ({ex.GetType().Name})",
                    $"the request reached the shared RTU bus and no valid acknowledgement came back within {_map.EffectiveReadTimeoutMs} ms"));
            }

            // The coil is now CONFIRMED asserted — NModbus validated an echo carrying this exact coil address and
            // this exact value, so the command's physical effect has already happened. Nothing below can change
            // that; it can only change whether the RESET half lands.
            if (ct.IsCancellationRequested)
            {
                return new CommandResult(commandName, WriteOutcome.Indeterminate,
                    Detail: $"coil {coilAddress} was asserted, but cancellation was requested before it could be reset — " +
                            "device state is unconfirmed and the coil may be latched.");
            }

            try
            {
                await transaction.ExecuteAsync(master => master.WriteSingleCoilAsync(_map.UnitId, coilAddress, false)).ConfigureAwait(false);
                return new CommandResult(commandName, WriteOutcome.Applied);
            }
            catch (SlaveException ex)
            {
                _logError?.Invoke(ex, $"Modbus RTU coil {coilAddress}'s reset write rejected for command '{commandName}' on {_map.MachineCode}");
                return new CommandResult(commandName, WriteOutcome.Indeterminate,
                    Detail: $"coil {coilAddress} was asserted but the device rejected the reset write: " +
                            $"{ModbusWritePreflight.DescribeSlaveException(ex)}. The coil may be latched.");
            }
            catch (Exception ex)
            {
                _logError?.Invoke(ex, $"Modbus RTU coil {coilAddress}'s reset write did not complete for command '{commandName}' on {_map.MachineCode}");
                return new CommandResult(commandName, WriteOutcome.Indeterminate,
                    Detail: $"coil {coilAddress} was asserted but the reset write did not complete — its final rest state " +
                            $"is unconfirmed and it may be latched ({ex.GetType().Name}).");
            }
        }
    }

    /// <summary>The <c>Detail</c> for the two cancellation shapes in which the request PROVABLY never reached
    /// the line: cancelled before <see cref="ModbusBus.BeginTransactionAsync"/> returned, and cancelled while
    /// holding the bus but before the first operation started. Both say the device is untouched, because they
    /// can — and saying so is the whole point: on a bus where a dead device can hold the line for its entire
    /// read timeout, "I gave up waiting" is the common way a write ends, and an operator who is told only
    /// "indeterminate" would go and inspect a machine nothing was sent to.
    ///
    /// <para><b>The first branch deliberately does NOT claim "the arbitration lock was never taken",</b> which
    /// an earlier draft of this string did. <see cref="ModbusBus.BeginTransactionAsync"/> can also throw
    /// <see cref="OperationCanceledException"/> from INSIDE the lock — a cancellation landing during the
    /// post-timeout resynchronisation, or while the link is being opened. The claim that survives every one of
    /// those paths is the one that matters and is the only one made: <b>no byte of this request reached the
    /// line.</b> A `Detail` an operator acts on has to be true of the path they are actually on.</para>
    ///
    /// <para>The outcome is still <see cref="WriteOutcome.Indeterminate"/> rather than
    /// <see cref="WriteOutcome.Failed"/>, and that is B-1's own instruction taken literally: a cancellation
    /// before a definitive applied/failed answer MUST return <see cref="WriteOutcome.Indeterminate"/>. The
    /// certainty lives in the <c>Detail</c>, which is where a four-value enum cannot go.</para></summary>
    private string NotOnTheWireDetail(string stage) => stage == "queued"
        ? $"cancelled while queued for the shared RTU bus '{_lease.Bus.Key}' — this write was still waiting its " +
          "turn (or waiting for the line to go quiet after another device's timeout), so no byte of it reached " +
          $"the line and unit {_map.UnitId} ({_map.MachineCode}) is untouched. Retrying is safe."
        : $"cancelled after taking the shared RTU bus '{_lease.Bus.Key}' but before any byte of the request was " +
          $"written, so unit {_map.UnitId} ({_map.MachineCode}) is untouched. Retrying is safe.";

    /// <summary>The <c>Detail</c> for a bus that refused the transaction. <see cref="WriteOutcome.Failed"/>
    /// rather than <see cref="WriteOutcome.Indeterminate"/>, deliberately, and the contract's own words are what
    /// decide it: <see cref="WriteOutcome.Failed"/> is "the device <b>(or the transport talking to it)</b> was
    /// reached and explicitly reported failure — the write did NOT apply", and that is exactly what happened.
    /// <see cref="ModbusBus.ResynchroniseAsync"/> refuses the transaction BEFORE
    /// <see cref="ModbusBus.BeginTransactionAsync"/> configures the transport, so no request frame of this write
    /// exists, and <see cref="WriteOutcome.Indeterminate"/> — "the caller does NOT know whether the device
    /// applied the write" — would be factually false. Reporting "we don't know" for a case we do know is how the
    /// one outcome this contract exists to preserve gets discounted by the people it was written for.
    ///
    /// <para>🔴 <b>Review I-1 — this method used to STATE A CAUSE, and the cause was false on one of the two
    /// paths that produce it.</b> <see cref="ModbusBusResynchronisationException"/> is thrown from exactly two
    /// places (verified by grep, both in <see cref="ModbusBus"/>): the link would not go quiet, and <b>the drain
    /// itself failed</b> — which is live and intentional, because <see cref="GatewayTcpBusLink.DrainBufferedInput"/>
    /// deliberately lets an <see cref="System.IO.IOException"/>/<c>SocketException</c> escape on the strength of
    /// <see cref="ModbusBus.ResynchroniseAsync"/>'s catch "tearing it down AND SAYING SO". Hard-coding "would not
    /// go quiet" made that second path say the opposite of the truth and sent an operator hunting a babbling
    /// device while the fault was a dead link. It is the rule <see cref="NotOnTheWireDetail"/>'s own doc block
    /// states one method above — <i>a <c>Detail</c> an operator acts on has to be true of the path they are
    /// actually on</i> — broken inside the commit that articulates it, which is blueprint §8.1's point that a
    /// fix for one instance of a defect class buys no immunity to the class.</para>
    ///
    /// <para><b>The cause now comes from the exception, which already words both paths correctly, and that is
    /// safe to surface here</b> — checked rather than assumed. Both messages are built by
    /// <see cref="ModbusBus"/> itself out of the bus key, the two window/budget numbers, a discarded-byte count
    /// and an exception TYPE name; neither interpolates an inner <c>ex.Message</c>, and Modbus has no
    /// credentials for a map to carry. The bus key is already in this method's own first sentence, so surfacing
    /// it adds no exposure. What stays this driver's own is the part the transport cannot know: WHICH unit, that
    /// it is untouched, and that retrying is safe.</para></summary>
    /// <remarks>
    /// 🔴 <b>The rationale sentence this method used to carry is GONE, and a surviving mutation is what found
    /// it.</b> A fix-round mutation deleting <i>"…so the next answer on that line could be any of them"</i>
    /// survived a green suite. The first reading is "a test is missing"; the consequence question gives a
    /// different answer. Both <see cref="ModbusBusResynchronisationException"/> messages ALREADY say it —
    /// <c>"an RTU response carries nothing to correlate it with a request, so the next answer could be any of
    /// them"</c> — so the moment I-1 started appending <c>ex.Message</c>, this method's copy became the SECOND
    /// copy of one sentence in one string. Adding an assertion would have frozen a duplicate into a contract;
    /// deleting it removes a second thing that can drift from the first, which is the same argument that put
    /// <see cref="ModbusWritePreflight.DescribeSlaveException"/> in one place.
    ///
    /// <para>What is left is exactly what the transport cannot know, and every clause of it is now pinned by a
    /// test: the refusal happened <b>before any byte reached the line</b>, WHICH unit and machine, that it is
    /// <b>untouched</b>, and that <b>retrying is safe</b> once the bus recovers — the two an operator acts on
    /// being the last two.</para>
    ///
    /// <para>🔴 <b>Re-review N-2 — the bus key is NOT repeated here, and that is deliberate.</b> Every
    /// <see cref="ModbusBusResynchronisationException"/> message opens with <c>Modbus bus '{Key}':</c>, so
    /// naming it in this prefix too put the same key twice in one string — introduced by the very fix whose
    /// justification was removing a duplicate. The key is carried once, by the cause. What this prefix owns is
    /// only what the transport cannot know: the unit, the machine, and the two facts an operator acts
    /// on.</para>
    /// </remarks>
    private string BusRefusedDetail(ModbusBusResynchronisationException ex) =>
        "refused before any byte reached the line: the shared RTU bus could not be made trustworthy again, so it " +
        $"cannot be written to safely. Unit {_map.UnitId} ({_map.MachineCode}) is untouched and retrying is safe " +
        $"once the bus recovers. Cause: {ex.Message}";

    /// <summary>The <c>Detail</c> for a bus that was disposed before this write could start — the connector is
    /// being torn down. Makes the same provable claim as <see cref="NotOnTheWireDetail"/> (no byte reached the
    /// line) but is NOT an <c>&lt;inheritdoc&gt;</c> of it, deliberately: that method's summary is about
    /// CANCELLATION, and pointing this one at it would attach the wrong explanation to the right conclusion.
    /// D-3's review found a doc block on <see cref="ModbusRegister"/> re-parented onto the wrong member once
    /// already, and nothing in this repository's build catches it — <c>GenerateDocumentationFile</c> is not
    /// set anywhere, so no warning fires for a doc comment that describes something else.</summary>
    private string BusDisposedDetail() =>
        $"the shared RTU bus '{_lease.Bus.Key}' was disposed before this write could start, so no byte reached the " +
        $"line and unit {_map.UnitId} ({_map.MachineCode}) is untouched. The connector is being torn down.";

    /// <summary>The <c>Detail</c> for a write that reached the line and got no usable answer — the honest
    /// unknown. Names the unit, because on a multidrop bus "the device" is not a sufficient identifier, and
    /// names the bound that elapsed, because that is the number an operator changes. Redacted to the exception
    /// TYPE, per this driver's discipline; the full exception goes to the logger.
    ///
    /// <para>The wrong-echo case lands here too, and is worth naming: NModbus validates a write echo's start
    /// address and value, so an <see cref="System.IO.IOException"/> here can mean "a frame came back that was
    /// not this write's answer". That is still <see cref="WriteOutcome.Indeterminate"/> — a stale frame on the
    /// line says nothing about whether the device applied the request.</para></summary>
    /// <summary>
    /// 🔴 <b>Review CRITICAL — the <c>Detail</c> for an assert half that got no usable answer, brought to parity
    /// with <see cref="WriteDidNotCompleteDetail"/> and then past it.</b>
    ///
    /// <para>The two shapes that reach here — a bounded timeout and a cancellation — used to produce a message
    /// that was materially thinner than the setpoint path's: no machine code, no elapsed bound, no "it was NOT
    /// retried", no note that the bus is quarantined. <b>And it talked about a coil.</b> An operator reading
    /// "coil 3's assert write did not complete" has to know the map to translate that into the only question
    /// this member actually answers, which is <i>did a machine cycle start?</i> That is the one message on the
    /// whole write path where the reader is standing next to something that may now be moving.</para>
    ///
    /// <para>So this says the cycle may have started, in those words, first — and then the coil, the unit, the
    /// machine, the bound that elapsed, that nothing was resent, and that the bus is quarantined. The coil
    /// address stays because it is what a commissioning engineer puts on a meter; it is no longer the headline.
    /// The review found this branch unguarded by any content assertion at all, which is why the wording is now
    /// pinned by tests on BOTH producing paths rather than only described here.</para>
    /// </summary>
    private string AssertHalfUnknownDetail(ushort coilAddress, string what, string howFarItGot) =>
        $"{what} — THE CYCLE MAY HAVE STARTED: {howFarItGot}, so whether unit {_map.UnitId} ({_map.MachineCode}) " +
        $"asserted coil {coilAddress} is unknown, and so is the coil's rest state — it may be latched. It was NOT " +
        "retried; the bus is quarantined until the line has been observed silent.";

    private string WriteDidNotCompleteDetail(Exception ex) =>
        $"write did not complete ({ex.GetType().Name}) — the request reached the shared RTU bus and no valid " +
        $"acknowledgement came back within {_map.EffectiveReadTimeoutMs} ms, so whether unit {_map.UnitId} " +
        $"({_map.MachineCode}) applied it is unknown. It was NOT retried; the bus is quarantined until the line has " +
        "been observed silent.";

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
