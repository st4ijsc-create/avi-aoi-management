using System.Text.Json;
using System.Text.Json.Serialization;
using St4i.Connector.Abstractions.Models;

namespace St4i.EdgeCore.Drivers.Modbus;

/// <summary>Which Modbus function code a register is read through: FC03 (Holding, 4xxxx addresses,
/// read/write on the real device) or FC04 (Input, 3xxxx addresses, read-only). <see cref="ModbusTcpDriver"/>'s
/// own poll loop only ever READS either kind, unchanged by Task B-3 below. Task B-3
/// (.superpowers/sdd/2026-07-29-dotB-machine-control-blueprint/task-3-brief.md) lets a map DECLARE that a
/// <see cref="Holding"/> register may also be written (see <see cref="ModbusRegister.Writable"/>) — but this
/// class stays a plain, throwing parse function: it declares what MAY be written and within what bounds,
/// never performs any I/O itself. Actually executing a write against the device is B-4's job, not built
/// here. <see cref="Input"/> can never be declared writable — <see cref="ModbusRegisterMap.FromJson"/> rejects
/// that at parse time, because FC04 has no write function code at all on the wire; declaring it writable
/// would be a map that can never actually be honoured.</summary>
public enum ModbusRegisterType { Holding, Input }

/// <summary>How to decode the raw 16-bit register value <see cref="ModbusTcpDriver"/> reads. Deliberately
/// minimal for G2-6: a single 16-bit word, unsigned or two's-complement signed. 32-bit/float values (a
/// register PAIR combined per some word-order convention) are a documented follow-up — see
/// <see cref="ModbusTcpDriver"/>'s class doc comment — not built here.</summary>
public enum ModbusDataType { UInt16, Int16 }

/// <summary>
/// Task B-3 — the mandatory physical bounds a writable Modbus register must declare, in ENGINEERING units
/// (the same domain as <see cref="ModbusRegister.Scale"/>'s own output — e.g. a temperature register scaled
/// by 0.1 declares its <see cref="Min"/>/<see cref="Max"/> in °C, not raw register counts). Deliberately
/// nullable here even though <see cref="ModbusRegisterMap.FromJson"/> guarantees both are populated on any
/// <see cref="ModbusRegister"/> it returns with a non-null <see cref="ModbusRegister.Writable"/> — see that
/// method's own remarks for why the mandatory-ness is enforced by an explicit post-deserialize check (so the
/// rejection message can name the specific point) rather than by <see langword="required"/> members here.
///
/// <para><b>Why mandatory at all — this batch's own safety framing.</b> The product owner decided a
/// <c>writable</c> declaration in the map is sufficient authorization to write to a real device, with no
/// deployment-level kill switch. A writable point with no declared range would mean "no limit" — the exact
/// same defect class as an enum whose default value means success, which this batch already fixed once (see
/// <see cref="Models.WriteOutcome"/>'s own "Fix round 1" remarks). So a range is not a nicety here; it is the
/// one thing standing between a pasted vendor map and an unbounded write reaching a real machine.</para>
/// </summary>
public sealed record ModbusWritableRange(double? Min, double? Max);

/// <summary>One register→canonical-tag mapping: which register to read, how to decode it, and the metric
/// name/unit it becomes on the resulting <see cref="Models.TelemetrySample"/>. <see cref="Scale"/>
/// multiplies the decoded raw integer to produce the telemetry value (e.g. a raw 235 with scale 0.1 →
/// 23.5) — this is the ENTIRE unit-conversion story for G2-6; anything fancier (per-register offset,
/// non-linear conversion) is out of scope.
///
/// <para><b>Task B-3 — <see cref="Writable"/>.</b> <see langword="null"/> (the default, and the ONLY value
/// every register in every map shipped before this task can ever have) means exactly what it always has:
/// this is a read-only point. A non-null value declares this Holding register as a setpoint <see cref="Metric"/>
/// names — the SAME identity a read reports under, reused deliberately rather than inventing a second "point
/// name" concept — writable within <see cref="ModbusWritableRange.Min"/>/<see cref="ModbusWritableRange.Max"/>
/// (engineering units). See <see cref="ModbusRegisterMap.FromJson"/> for everything this declaration is
/// validated against at parse time (mandatory bounds, Holding-only, non-zero <see cref="Scale"/>, and the
/// inverse-scaling overflow check), and <see cref="TryComputeRawWordForWrite"/> for the write-side math a
/// future driver (B-4) calls to actually turn an engineering-unit setpoint into the 16-bit word it writes on
/// the wire.</para>
/// </summary>
public sealed record ModbusRegister(
    ushort Address, ModbusRegisterType Type, ModbusDataType DataType, double Scale, string Metric, string? Unit = null,
    ModbusWritableRange? Writable = null)
{
    /// <summary>
    /// Task B-3 — the write-side mirror of <see cref="ModbusTcpDriver"/>'s own read-side decode
    /// (<c>raw*Scale</c>, with an Int16 register's raw word reinterpreted two's-complement BEFORE scaling):
    /// given an engineering-unit <paramref name="engineeringValue"/> ALREADY known to be within
    /// <see cref="Writable"/>'s declared <see cref="ModbusWritableRange.Min"/>/<see cref="ModbusWritableRange.Max"/>
    /// (that check is <see cref="Models.SetpointRejectionReason.OutOfRange"/>'s own job, upstream of this
    /// method — this method does not repeat it), computes the exact 16-bit word
    /// <c>WriteSingleRegisterAsync</c> would send on the wire: <c>raw = Math.Round(engineeringValue / Scale,
    /// MidpointRounding.AwayFromZero)</c>, then bit-cast into the register's own <see cref="DataType"/>.
    ///
    /// <para><b>Never silently wraps an out-of-range raw value.</b> This is the inverse-scaling overflow trap
    /// the task brief calls out by name: a value that passes the declared <see cref="ModbusWritableRange.Min"/>/
    /// <see cref="ModbusWritableRange.Max"/> can still, once divided by <see cref="Scale"/> and rounded, land
    /// outside the register's own <see cref="DataType"/> representable range (<c>UInt16</c>:
    /// 0..65535; <c>Int16</c>: -32768..32767) — e.g. a rounding/scale combination that pushes just past an
    /// endpoint. <see cref="ModbusRegisterMap.FromJson"/> already proves this can never happen for a
    /// SUCCESSFULLY PARSED map (it calls this exact method against both <see cref="ModbusWritableRange.Min"/>
    /// and <see cref="ModbusWritableRange.Max"/> at parse time and rejects the whole map if either overflows —
    /// and because raw-computation is monotonic in <paramref name="engineeringValue"/>, every value BETWEEN
    /// the two declared endpoints also stays in range). This method still performs the SAME bounds check on
    /// every call, independently of that parse-time proof, rather than assuming it can never happen —
    /// "assert the failure, don't assume it can't happen," per the brief. A naive <c>(ushort)</c> C# numeric
    /// cast from an out-of-range <see langword="double"/> would silently wrap/truncate instead of failing —
    /// this method never performs that cast without the guard immediately above it.</para>
    /// </summary>
    /// <param name="engineeringValue">The setpoint value, in the same engineering-unit domain
    /// <see cref="Scale"/> already establishes for reads.</param>
    /// <param name="rawWord">The exact 16-bit word to write on success — <see langword="default"/> on
    /// failure.</param>
    /// <param name="error">Operator-readable failure detail on failure; <see langword="null"/> on success.</param>
    /// <remarks>
    /// <b>Fix round 1 (Critical #1) — this method now ALSO enforces <see cref="Writable"/>'s own declared
    /// <see cref="ModbusWritableRange.Min"/>/<see cref="ModbusWritableRange.Max"/>, not only the register's
    /// physical <see cref="DataType"/> range.</b> The doc comment above used to say the declared-range check
    /// was "upstream of this method — this method does not repeat it" — reviewed and found wrong: NOTHING in
    /// this task actually performs that check anywhere else (it was deferred, undocumented, straight onto
    /// B-4), so a value like 60000 against a register declared <c>[0,500]</c> sailed through as
    /// <c>Applied</c>-shaped (raw=60000, no error) purely because 60000 also happens to fit in a UInt16. This
    /// method is now the ONE place that check lives, mirroring <see cref="OpcUa.OpcUaWritableSetpoint.TryNarrowForWrite"/>'s
    /// own declared-range check exactly — the two sibling "write-side math a future driver calls" helpers no
    /// longer disagree about who enforces the limit the whole task exists to make mandatory. If
    /// <see cref="Writable"/> is <see langword="null"/> (this register was never declared writable in the
    /// first place — a caller error the driver's own <see cref="Models.SetpointRejectionReason.NotWritable"/>
    /// check should have already caught before ever reaching here), there is no declared range to enforce and
    /// only the physical-type check below applies.
    ///
    /// <para><b>Fix round 1 (Critical #2) — <paramref name="engineeringValue"/> itself is now required to be
    /// finite.</b> <see cref="double.NaN"/> fails every <c>&lt;</c>/<c>&gt;</c> comparison, so BOTH the
    /// declared-range check above and the physical-range check below silently let it through — then
    /// <c>(ushort)double.NaN</c> is 0 on this runtime, so a setpoint whose safe band is e.g. <c>[100,400]</c>
    /// silently wrote (and reported success for) a raw 0. <see cref="double.PositiveInfinity"/>/
    /// <see cref="double.NegativeInfinity"/> were already correctly rejected (they fail the physical-range
    /// check honestly), so this is specifically the NaN gap.</para>
    ///
    /// <para><b>Fix round 1 — "consider" item, resolved: stays <see langword="bool"/> + <see langword="string"/>?,
    /// not <see cref="Models.SetpointRejectionReason"/>.</b> Every failure this method can produce corresponds
    /// to EXACTLY ONE <see cref="Models.SetpointRejectionReason"/> member —
    /// <see cref="Models.SetpointRejectionReason.OutOfRange"/> — never <see cref="Models.SetpointRejectionReason.UnknownPoint"/>/
    /// <see cref="Models.SetpointRejectionReason.NotWritable"/> (resolving whether a point NAME is known/writable
    /// at all is the caller's/driver's own job, before it ever reaches a specific <see cref="ModbusRegister"/>
    /// instance to call this method on). A future <c>WriteSetpointAsync</c> implementation therefore needs no
    /// translation step beyond "if this returns <see langword="false"/>, reject with
    /// <see cref="Models.SetpointRejectionReason.OutOfRange"/> and this method's own <paramref name="error"/> as
    /// <c>Detail</c>" — see <see cref="CommandArgumentDeclaration"/>'s own doc comment for the identical
    /// reasoning on the command-argument side.</para>
    /// </remarks>
    public bool TryComputeRawWordForWrite(double engineeringValue, out ushort rawWord, out string? error)
    {
        if (!double.IsFinite(engineeringValue))
        {
            rawWord = default;
            error = $"register '{Metric}' (address {Address}): value {engineeringValue} is not finite.";
            return false;
        }

        if (Writable is not null &&
            ((Writable.Min is { } declaredMin && engineeringValue < declaredMin) ||
             (Writable.Max is { } declaredMax && engineeringValue > declaredMax)))
        {
            rawWord = default;
            error = $"register '{Metric}' (address {Address}): value {engineeringValue} is outside the declared " +
                     $"[{Writable.Min},{Writable.Max}] range.";
            return false;
        }

        if (Scale == 0 || !double.IsFinite(Scale))
        {
            rawWord = default;
            error = $"register '{Metric}' (address {Address}): scale {Scale} cannot be inverted for a write.";
            return false;
        }

        var rawDouble = Math.Round(engineeringValue / Scale, MidpointRounding.AwayFromZero);

        if (DataType == ModbusDataType.UInt16)
        {
            if (rawDouble < ushort.MinValue || rawDouble > ushort.MaxValue)
            {
                rawWord = default;
                error = $"register '{Metric}' (address {Address}): {engineeringValue} ÷ {Scale} = {rawDouble}, which " +
                         $"is outside the UInt16 representable range [{ushort.MinValue},{ushort.MaxValue}].";
                return false;
            }

            rawWord = (ushort)rawDouble;
            error = null;
            return true;
        }

        // Int16 — the raw word ON THE WIRE is still an unsigned 16-bit value (NModbus's own
        // WriteSingleRegisterAsync takes a ushort regardless); this bit-casts the signed raw value into its
        // own 16-bit pattern, the exact inverse of ModbusTcpDriver's read-side `unchecked((short)raw)`.
        if (rawDouble < short.MinValue || rawDouble > short.MaxValue)
        {
            rawWord = default;
            error = $"register '{Metric}' (address {Address}): {engineeringValue} ÷ {Scale} = {rawDouble}, which " +
                     $"is outside the Int16 representable range [{short.MinValue},{short.MaxValue}].";
            return false;
        }

        rawWord = unchecked((ushort)(short)rawDouble);
        error = null;
        return true;
    }
}

/// <summary>
/// Task B-3 — a Modbus command: a single coil this map declares by name, so
/// <see cref="Models.IWritableDeviceDriver.Commands"/> can list it and
/// <see cref="Models.IWritableDeviceDriver.InvokeCommandAsync"/> (B-4) can pulse it without re-deriving which
/// coil a name refers to. Deliberately minimal, mirroring this file's own "deliberately minimal for G2-6"
/// idiom (see <see cref="ModbusDataType"/>'s own doc comment): a command is a single coil address, matching
/// B-1's own illustrative example ("a Modbus coil pulse") exactly. A command that instead writes a VALUE into
/// a holding "command register" is a documented, deferred follow-up — not built here — same posture as the
/// 32-bit/float register-pair follow-up <see cref="ModbusTcpDriver"/>'s own class doc comment already
/// documents for reads.
///
/// <para><see cref="Arguments"/> is declared (and narrowed via <see cref="CommandArgumentDeclaration.TryNarrow"/>,
/// same as OPC-UA's own <see cref="OpcUa.OpcUaCommand"/>) for schema symmetry across both protocols, even
/// though a plain coil pulse takes none in practice — how a narrowed argument value would map onto the wire
/// for a Modbus command (which register, if any) is left to B-4 to decide when it actually executes one;
/// this map only declares the argument's name/type/bounds and proves it narrows correctly.</para>
/// </summary>
/// <param name="Name">The command's name — see <see cref="Models.IWritableDeviceDriver.Commands"/>.</param>
/// <param name="CoilAddress">The single coil this command pulses. Nullable — Fix round 1 (Critical #3) — an
/// omitted <c>"coilAddress"</c> used to bind silently to <see langword="default"/>(<see cref="ushort"/>) = 0,
/// a REAL, valid coil address, indistinguishable from a map author who genuinely targets coil 0. Since
/// commands trigger real motion, "forgotten field arms a live wire target" is strictly worse than the
/// equivalent hazard for a setpoint's limits — <see cref="ModbusRegisterMap.FromJson"/> now rejects a command
/// with no <see cref="CoilAddress"/> at parse time, naming the command; a validated map's <see cref="CoilAddress"/>
/// is therefore always non-null.</param>
/// <param name="Arguments">Optional named arguments this command accepts — <see langword="null"/>/empty for a
/// command that takes none (the common case). Fix round 1 — <see cref="ModbusRegisterMap.FromJson"/> now
/// REJECTS a Modbus command that declares any argument at all (see that method's own remarks): this property
/// is retained on the type for schema symmetry with OPC-UA and so <see cref="CommandArgumentDeclaration"/>'s
/// narrowing stays exercised/tested against a Modbus-shaped declaration, but a map that actually tries to use
/// it is rejected until B-4 defines where a Modbus command's argument value would be written on the wire.</param>
public sealed record ModbusCommand(string Name, ushort? CoilAddress, IReadOnlyList<CommandArgumentDeclaration>? Arguments = null);

/// <summary>A minimal Modbus register map for one machine: its equipment code, unit id (the Modbus slave
/// address on the wire, NOT related to <see cref="MachineCode"/>), poll cadence, and the ordered registers
/// <see cref="ModbusTcpDriver"/> reads each poll (one register per poll, per register — block/batch reads
/// are a documented follow-up, see the driver's own remarks). Loaded from JSON via <see cref="FromJson"/>,
/// the same idiom as <see cref="St4i.EdgeCore.Mapping.MappingProfile.FromJson"/>.</summary>
public sealed class ModbusRegisterMap
{
    /// <summary>Upper guard for <see cref="ReadTimeoutMs"/>: 60 seconds. Generous relative to the
    /// gateway-fronted-slave scenario that motivates letting an operator set this at all (a Modbus
    /// TCP→RTU gateway with its own internal retry budget legitimately taking a few seconds per
    /// register) — this exists only to catch a fat-fingered config (an extra zero or two) that would
    /// otherwise recreate the exact "pinned thread, frozen Health, no alarm" hazard
    /// <see cref="ModbusTcpDriver"/>'s class doc comment describes, just with a very long fuse instead
    /// of none.</summary>
    public const int MaxReadTimeoutMs = 60_000;

    /// <summary>Upper guard for <see cref="Retries"/>. NModbus retries are a fresh request each, so
    /// worst-case per-register stall is roughly <c>Retries × ReadTimeoutMs</c> — a handful is enough to
    /// absorb a couple of bad frames on a noisy link; there is no legitimate reason to need more, and
    /// letting it run unbounded would let one config value multiply <see cref="MaxReadTimeoutMs"/> into
    /// an unreasonable worst case.</summary>
    public const int MaxRetries = 5;

    private static readonly JsonSerializerOptions JsonOptions = new()
    {
        PropertyNameCaseInsensitive = true,
        Converters = { new JsonStringEnumConverter() },
    };

    public required string MachineCode { get; init; }

    public byte UnitId { get; init; } = 1;

    public int PollIntervalMs { get; init; } = 1000;

    public required IReadOnlyList<ModbusRegister> Registers { get; init; }

    /// <summary>Task B-3 — the coil-pulse commands this map declares, by name. Defaults to empty (every map
    /// shipped before this task, and every map that never sets this key, parses identically — a read-only
    /// connector, exactly as today). See <see cref="ModbusCommand"/>'s own doc comment for the shape.</summary>
    public IReadOnlyList<ModbusCommand> Commands { get; init; } = Array.Empty<ModbusCommand>();

    /// <summary>Task B-3 — the exact vocabulary a driver hands back through
    /// <see cref="Models.IWritableDeviceDriver.WritablePoints"/>: every <see cref="Registers"/> entry whose
    /// <see cref="ModbusRegister.Writable"/> is non-null, by <see cref="ModbusRegister.Metric"/>. Empty for a
    /// map that declares no writable points — the additive default this task guarantees for every existing
    /// map.</summary>
    public IReadOnlyList<string> WritablePointNames
    {
        get
        {
            var names = new List<string>();
            foreach (var register in Registers)
            {
                if (register.Writable is not null)
                {
                    names.Add(register.Metric);
                }
            }

            return names;
        }
    }

    /// <summary>Task B-3 — the exact vocabulary a driver hands back through
    /// <see cref="Models.IWritableDeviceDriver.Commands"/>: every <see cref="Commands"/> entry's own
    /// <see cref="ModbusCommand.Name"/>.</summary>
    public IReadOnlyList<string> CommandNames
    {
        get
        {
            var names = new List<string>(Commands.Count);
            foreach (var command in Commands)
            {
                names.Add(command.Name);
            }

            return names;
        }
    }

    /// <summary>
    /// Task B-3 fix round 1 (Important #1) — the RICHER counterpart to <see cref="WritablePointNames"/>: not
    /// just which points are writable, but the exact bounds each one is writable WITHIN (in the same
    /// engineering-unit domain as <see cref="ModbusRegister.Scale"/>'s own reads) AND which register address
    /// it actually targets, formatted deterministically (<c>"address:&lt;n&gt;"</c>). Consumed by
    /// <c>St4i.EngineApi.Fleet.ConnectorConfigValidation</c> to build the deliberate-save-gate's confirmation
    /// fingerprint, so WIDENING a limit or RE-POINTING a writable register to a different address (not just
    /// adding/removing a point by name) produces a different, un-confirmable fingerprint — the exact gap the
    /// review found: a name-only fingerprint let either kind of edit silently ride through an
    /// already-confirmed save.
    /// </summary>
    public IReadOnlyList<(string Metric, string Target, double Min, double Max)> WritablePointBounds
    {
        get
        {
            var bounds = new List<(string, string, double, double)>();
            foreach (var register in Registers)
            {
                if (register.Writable is { Min: { } min, Max: { } max })
                {
                    bounds.Add((register.Metric, $"address:{register.Address}", min, max));
                }
            }

            return bounds;
        }
    }

    /// <summary>Task B-3 fix round 1 (Important #1) — the RICHER counterpart to <see cref="CommandNames"/>:
    /// each command's name AND the coil it actually pulses, formatted as one human-readable, deterministic
    /// string (<c>"coil:&lt;address&gt;"</c>) — so RE-POINTING a command to a different coil also changes the
    /// confirmation fingerprint, not just adding/removing a command by name.</summary>
    public IReadOnlyList<(string Name, string Target)> CommandTargets
    {
        get
        {
            var targets = new List<(string, string)>(Commands.Count);
            foreach (var command in Commands)
            {
                targets.Add((command.Name, $"coil:{command.CoilAddress}"));
            }

            return targets;
        }
    }

    /// <summary>Optional override for <c>NModbus</c>'s <c>Transport.ReadTimeout</c>/<c>WriteTimeout</c>
    /// (milliseconds) — <see langword="null"/> (omitted/explicit JSON <c>null</c>/a malformed value, see
    /// <see cref="FromJson"/>'s own remarks) means "derive it exactly like before this field existed":
    /// <c>Math.Max(1000, PollIntervalMs * 4)</c>, unchanged, byte-identical default behaviour for every
    /// deployment that never sets this. <see cref="EffectiveReadTimeoutMs"/> below is what actually
    /// resolves the value <see cref="ModbusTcpDriver"/> applies.
    ///
    /// <para><b>Set this directly, don't fight it via <see cref="PollIntervalMs"/>.</b> The derived
    /// default COUPLES timeout tolerance to poll cadence — the only way to buy more tolerance from it is
    /// to poll slower, which a site that genuinely needs both a fast cadence AND a generous timeout
    /// (typically one whose Modbus TCP slave is actually a TCP→RTU gateway: the gateway's own internal
    /// retry budget against a dropped RTU frame can legitimately take a few seconds to answer ONE
    /// register, regardless of how often this driver asks) cannot express at all under the 1-second
    /// floor. Set this field instead of lowering <see cref="PollIntervalMs"/> to game the derived
    /// value.</para>
    ///
    /// <para><b>The effective tolerance for a healthy-but-slow device is ONE timeout, not
    /// <see cref="Retries"/> of them.</b> A retry is a brand-new request under the exact same per-attempt
    /// bound — it does not extend how late a single reply is allowed to be. A device that consistently
    /// answers even slightly past this value fails EVERY attempt identically, not just the first, so size
    /// this for the slowest legitimate single round-trip you actually expect, not some multiple of it.</para>
    /// </summary>
    [JsonIgnore]
    public int? ReadTimeoutMs { get; init; }

    /// <summary>Optional override for <c>NModbus</c>'s <c>Transport.Retries</c> — <see langword="null"/>
    /// (omitted/explicit JSON <c>null</c>/a malformed value) means "1", unchanged from before this field
    /// existed: this driver already reconnects from scratch on ANY poll failure (see
    /// <see cref="ModbusTcpDriver"/>'s class doc comment), so extra NModbus-level retries only ever help
    /// absorb a handful of genuinely transient protocol/CRC glitches on a noisy link (e.g. RS-485 behind
    /// a gateway) — at the cost of multiplying the worst-case per-register stall by roughly this many
    /// times <see cref="ReadTimeoutMs"/>'s effective value.</summary>
    [JsonIgnore]
    public int? Retries { get; init; }

    /// <summary>The value <see cref="ModbusTcpDriver"/> actually applies to
    /// <c>Transport.ReadTimeout</c>/<c>WriteTimeout</c>: <see cref="ReadTimeoutMs"/> if the register map
    /// set one, else the original derived default.</summary>
    public int EffectiveReadTimeoutMs => ReadTimeoutMs ?? Math.Max(1000, PollIntervalMs * 4);

    /// <summary>The value <see cref="ModbusTcpDriver"/> actually applies to <c>Transport.Retries</c>:
    /// <see cref="Retries"/> if the register map set one, else the original default of 1.</summary>
    public int EffectiveRetries => Retries ?? 1;

    /// <summary>Parses a register-map JSON document (see the class doc comment for the expected shape;
    /// property names are matched case-insensitively, enum values as their C# member names — "Holding"/
    /// "Input", "UInt16"/"Int16" — also matched case-insensitively). Throws
    /// <see cref="JsonException"/>/<see cref="InvalidOperationException"/> straight through on malformed
    /// JSON, a missing required field (<see cref="MachineCode"/>/<see cref="Registers"/>), a
    /// blank/whitespace-only <see cref="MachineCode"/>, or an empty <see cref="Registers"/> list — the
    /// caller (Program.cs's startup wiring) is the one that decides "log + disable Modbus for this run"
    /// rather than crash, exactly like the UNS broker-bind failure already does; this method itself stays
    /// a plain, throwing parse function, same as <c>MappingProfile.FromJson</c>.
    ///
    /// P2-3 review fix (Important) — <c>required</c> only enforces the JSON KEY is present, not that its
    /// value is non-blank/non-empty: a map with <c>"machineCode": ""</c> used to sail through this method,
    /// producing a <see cref="MachineDescriptor"/>-shaped seed with a blank Code that
    /// <c>FleetHost.RegisterMachine</c> (called post-<c>app.Build()</c>, OUTSIDE any try/catch) then
    /// rejected with an uncaught <see cref="ArgumentException"/> — crashing the whole engine at startup.
    /// Validating here, INSIDE the one throwing parse function every malformed-map case already funnels
    /// through, means Program.cs's existing try/catch around this call (which logs "Modbus register map
    /// failed to load ... — Modbus driver disabled for this run" and sets its map variable to null) now
    /// also catches this case — no seed descriptor is ever built from a blank/absent-registers map, and
    /// the host never crashes.
    ///
    /// <b>Task 9 fix — <see cref="ReadTimeoutMs"/>/<see cref="Retries"/> are the ONE deliberate exception
    /// to "malformed input throws":</b> unlike every field above, a bad value for either of these two
    /// (wrong JSON type, non-positive, above <see cref="MaxReadTimeoutMs"/>/<see cref="MaxRetries"/>) does
    /// NOT fail this whole method — it is reported via <paramref name="logWarning"/> and the field falls
    /// back to its computed default, same as if it had been omitted. Deliberately so: these are two small,
    /// purely-additive optional knobs, and letting a typo in either one disable the ENTIRE Modbus driver
    /// for the run (this method's normal "one throw fails the whole map" contract, via Program.cs's
    /// try/catch) would be a wildly disproportionate blast radius for what's wrong. This is why they are
    /// NOT ordinary <see cref="JsonSerializer"/>-bound properties (see their <c>[JsonIgnore]</c>) — they
    /// are read straight off the raw <see cref="JsonElement"/> below, independently of the strongly-typed
    /// deserialize above, specifically so a malformed VALUE for one never throws out of the automatic
    /// binding in the first place.</summary>
    /// <param name="json">The register-map JSON document.</param>
    /// <param name="logWarning">Invoked once per malformed <see cref="ReadTimeoutMs"/>/<see cref="Retries"/>
    /// value that was ignored in favour of its computed default. Optional — a <see langword="null"/>
    /// callback just means the fallback isn't surfaced anywhere (it still happens either way).</param>
    public static ModbusRegisterMap FromJson(string json, Action<string>? logWarning = null)
    {
        using var document = JsonDocument.Parse(json);

        var map = document.RootElement.Deserialize<ModbusRegisterMap>(JsonOptions);
        if (map is null)
        {
            throw new InvalidOperationException("ModbusRegisterMap.FromJson: JSON deserialized to null.");
        }

        if (string.IsNullOrWhiteSpace(map.MachineCode))
        {
            throw new InvalidOperationException("Modbus register map: 'machineCode' must be a non-blank string.");
        }

        if (map.Registers.Count == 0)
        {
            throw new InvalidOperationException("Modbus register map: 'registers' must contain at least one entry.");
        }

        // Fix round 1 (minor) — an explicit JSON `"commands": null` used to bind Commands to a genuine null
        // (an explicit JSON null OVERRIDES a property's initializer default, unlike an OMITTED key), so
        // ValidateCommands's own `foreach (var command in commands)` threw a bare NullReferenceException —
        // the one parse failure in this method that didn't name what was wrong. Treated identically to
        // omitted, same precedent as ReadTimeoutMs/Retries's own "omitted and explicit null are the same"
        // rule elsewhere in this class.
        var commands = map.Commands ?? Array.Empty<ModbusCommand>();

        // Fix round 1 (Critical #3) — a writable register's own address/type/dataType must actually be
        // PRESENT in the JSON, not merely bound to whatever CLR default an omitted key produces (ushort 0 /
        // ModbusRegisterType.Holding / ModbusDataType.UInt16 — Holding and UInt16 are BOTH ordinal 0, so an
        // omitted type/dataType looks identical, once bound, to a register that explicitly declared the
        // writable-capable Holding/UInt16 combination). Needs the RAW JSON alongside the already-bound
        // objects because the strongly-typed Registers list has no way to tell "explicitly 0/Holding/UInt16"
        // from "never mentioned" — see ValidateWritableRegisters's own remarks.
        var rawRegistersElement = document.RootElement.TryGetProperty("registers", out var registersElement)
            ? registersElement
            : default;

        ValidateWritableRegisters(map.Registers, rawRegistersElement);
        ValidateCommands(commands);

        return new ModbusRegisterMap
        {
            MachineCode = map.MachineCode,
            UnitId = map.UnitId,
            PollIntervalMs = map.PollIntervalMs,
            Registers = map.Registers,
            Commands = commands,
            ReadTimeoutMs = ParseOptionalPositiveInt(document.RootElement, "readTimeoutMs", MaxReadTimeoutMs, logWarning),
            Retries = ParseOptionalPositiveInt(document.RootElement, "retries", MaxRetries, logWarning),
        };
    }

    /// <summary>Task B-3 fix round 1 (Critical #3) — a nullable-everything mirror of <see cref="ModbusRegister"/>'s
    /// own address/type/dataType fields, deserialized from ONE raw register's <see cref="JsonElement"/> using
    /// the SAME <see cref="JsonOptions"/> (case-insensitive names, the same enum converter) as the main
    /// strongly-typed bind — so this reuses the identical case/enum-parsing rules rather than hand-rolling a
    /// second, potentially-inconsistent property-name matcher. A <see langword="null"/> field here means the
    /// JSON key was genuinely absent (or explicit JSON <c>null</c>) — the ONLY thing the strongly-typed
    /// <see cref="ModbusRegister"/> binding cannot tell apart from an explicitly-given value that happens to
    /// equal the CLR default.</summary>
    private sealed record RegisterFieldPresenceProbe(ushort? Address, ModbusRegisterType? Type, ModbusDataType? DataType);

    /// <summary>Tolerantly reads an optional positive-integer field directly off the raw JSON element —
    /// see <see cref="FromJson"/>'s own remarks for why <see cref="ReadTimeoutMs"/>/<see cref="Retries"/>
    /// are parsed this way instead of through the ordinary strongly-typed deserialize. Omitted, explicit
    /// JSON <c>null</c>, wrong JSON type, non-positive, or above <paramref name="maxValue"/> all resolve
    /// the SAME way: <see langword="null"/> (the caller's computed default applies) — the first case
    /// silently (nothing was wrong), every other case via <paramref name="logWarning"/> (a value WAS
    /// given and it was ignored).</summary>
    private static int? ParseOptionalPositiveInt(JsonElement root, string propertyName, int maxValue, Action<string>? logWarning)
    {
        if (!root.TryGetProperty(propertyName, out var prop) || prop.ValueKind == JsonValueKind.Null)
        {
            return null;
        }

        if (prop.ValueKind != JsonValueKind.Number || !prop.TryGetInt32(out var value))
        {
            logWarning?.Invoke($"Modbus register map: '{propertyName}' must be a positive whole number — ignoring the malformed value and using the default instead.");
            return null;
        }

        if (value <= 0)
        {
            logWarning?.Invoke($"Modbus register map: '{propertyName}' must be > 0 (got {value}) — ignoring and using the default instead.");
            return null;
        }

        if (value > maxValue)
        {
            logWarning?.Invoke($"Modbus register map: '{propertyName}' {value} exceeds the maximum of {maxValue} — ignoring and using the default instead.");
            return null;
        }

        return value;
    }

    /// <summary>
    /// Task B-3 — the mandatory-limits gate the task brief requires: "a writable point with no declared
    /// range must be rejected at parse time, not defaulted to unbounded." Runs for every
    /// <see cref="ModbusRegister"/> whose <see cref="ModbusRegister.Writable"/> is non-null; every check
    /// below throws <see cref="InvalidOperationException"/> naming the offending register's
    /// <see cref="ModbusRegister.Metric"/> and <see cref="ModbusRegister.Address"/>, so this is
    /// deliberately NOT folded into a single generic "invalid writable register" message.
    ///
    /// <para><paramref name="rawRegisters"/> — Fix round 1 (Critical #3) — the SAME JSON array, unparsed,
    /// walked in lockstep with <paramref name="registers"/> (JSON array order is preserved by
    /// <see cref="System.Text.Json.JsonSerializer"/>, so the Nth raw element always corresponds to the Nth
    /// bound <see cref="ModbusRegister"/>) purely to detect whether a WRITABLE register's own
    /// <c>address</c>/<c>type</c>/<c>dataType</c> were actually present, rather than silently bound to a CLR
    /// default that happens to look like a legitimate writable Holding/UInt16 register at address 0.</para>
    /// </summary>
    private static void ValidateWritableRegisters(IReadOnlyList<ModbusRegister> registers, JsonElement rawRegisters)
    {
        var writableMetrics = new HashSet<string>(StringComparer.Ordinal);
        var rawIndex = 0;
        var hasRawRegisters = rawRegisters.ValueKind == JsonValueKind.Array;

        foreach (var register in registers)
        {
            JsonElement? rawRegister = null;
            if (hasRawRegisters && rawIndex < rawRegisters.GetArrayLength())
            {
                rawRegister = rawRegisters[rawIndex];
            }
            rawIndex++;

            if (register.Writable is null)
            {
                continue;
            }

            var pointLabel = $"'{register.Metric}' (address {register.Address})";

            if (string.IsNullOrWhiteSpace(register.Metric))
            {
                throw new InvalidOperationException(
                    $"Modbus register map: a writable register at address {register.Address} has a blank " +
                    "'metric' — a writable point's name must be non-blank; it is the identity a write targets by name.");
            }

            if (rawRegister is { } raw)
            {
                var probe = raw.Deserialize<RegisterFieldPresenceProbe>(JsonOptions);
                if (probe?.Address is null)
                {
                    throw new InvalidOperationException(
                        $"Modbus register map: writable register {pointLabel} is missing mandatory 'address' — " +
                        "never defaulted to 0 for a writable point (commands trigger real writes to this address).");
                }

                if (probe.Type is null)
                {
                    throw new InvalidOperationException(
                        $"Modbus register map: writable register {pointLabel} is missing mandatory 'type' — " +
                        "never defaulted to 'Holding' for a writable point.");
                }

                if (probe.DataType is null)
                {
                    throw new InvalidOperationException(
                        $"Modbus register map: writable register {pointLabel} is missing mandatory 'dataType' — " +
                        "never defaulted to 'UInt16' for a writable point.");
                }
            }

            if (register.Type != ModbusRegisterType.Holding)
            {
                throw new InvalidOperationException(
                    $"Modbus register map: writable register {pointLabel} has type '{register.Type}' — only " +
                    "'Holding' registers (FC03, read/write) can be declared writable; 'Input' (FC04) has no " +
                    "write function code on the wire at all.");
            }

            if (register.Writable.Min is null || register.Writable.Max is null)
            {
                throw new InvalidOperationException(
                    $"Modbus register map: writable register {pointLabel} is missing mandatory 'min'/'max' " +
                    "limits — a writable point must declare both bounds explicitly; this is never defaulted " +
                    "to unbounded.");
            }

            var min = register.Writable.Min.Value;
            var max = register.Writable.Max.Value;

            if (!double.IsFinite(min) || !double.IsFinite(max))
            {
                throw new InvalidOperationException(
                    $"Modbus register map: writable register {pointLabel} declares a non-finite 'min'/'max' limit.");
            }

            if (min > max)
            {
                throw new InvalidOperationException(
                    $"Modbus register map: writable register {pointLabel} declares min ({min}) greater than max ({max}).");
            }

            if (register.Scale == 0 || !double.IsFinite(register.Scale))
            {
                throw new InvalidOperationException(
                    $"Modbus register map: writable register {pointLabel} has scale {register.Scale}, which cannot " +
                    "be inverted for a write — a writable register must have a nonzero, finite scale.");
            }

            // The inverse-scaling overflow case the task brief calls out by name: Min/Max are declared in
            // ENGINEERING units, but the register on the wire is a fixed-width DataType. Checking both
            // endpoints through the exact same rounding function TryComputeRawWordForWrite uses at write
            // time is sufficient to prove EVERY value in between also stays in range too — raw computation
            // is a monotonic function of the engineering value (division by a fixed nonzero scale, then a
            // monotonic rounding function), so if both endpoints land inside the DataType's representable
            // range, nothing strictly between them can land outside it.
            if (!register.TryComputeRawWordForWrite(min, out _, out var minError))
            {
                throw new InvalidOperationException(
                    $"Modbus register map: writable register {pointLabel} declares a range whose MIN, once " +
                    $"inverse-scaled, overflows the register's own physical type: {minError}");
            }

            if (!register.TryComputeRawWordForWrite(max, out _, out var maxError))
            {
                throw new InvalidOperationException(
                    $"Modbus register map: writable register {pointLabel} declares a range whose MAX, once " +
                    $"inverse-scaled, overflows the register's own physical type: {maxError}");
            }

            if (!writableMetrics.Add(register.Metric))
            {
                throw new InvalidOperationException(
                    $"Modbus register map: more than one writable register declares metric '{register.Metric}' — " +
                    "a writable point's name must be unique (it is the identity a write targets by name, " +
                    "and two registers sharing it would make a write's target ambiguous).");
            }
        }
    }

    /// <summary>Task B-3 — command-declaration validation: unique names, and every declared argument's own
    /// schema-shape check (<see cref="CommandArgumentDeclaration.ValidateSelf"/>).
    ///
    /// <para><b>Fix round 1 (Critical #3) — <see cref="ModbusCommand.CoilAddress"/> is now mandatory,
    /// enforced here.</b> An omitted <c>"coilAddress"</c> used to parse successfully and target REAL coil 0 —
    /// see <see cref="ModbusCommand"/>'s own doc comment.</para>
    ///
    /// <para><b>Fix round 1 (scope call (a), accepted) — a Modbus command with any declared <c>Arguments</c>
    /// is now REJECTED outright.</b> The review agreed inventing an unproven wire-mapping convention for a
    /// Modbus command argument would be worse than deferring it — but a map that declares one, gets confirmed
    /// through the save gate, and is listed as GRANTED capability, while being un-executable by any driver
    /// this codebase could plausibly ship, is exactly the "map declares a capability the product cannot
    /// honour" dishonesty this whole batch exists to remove. So: not a hole to leave half-open — a Modbus
    /// command with one or more declared arguments fails the whole map at parse time, naming the command,
    /// until B-4 defines the convention and this rule is relaxed.</para>
    /// </summary>
    private static void ValidateCommands(IReadOnlyList<ModbusCommand> commands)
    {
        var names = new HashSet<string>(StringComparer.Ordinal);

        foreach (var command in commands)
        {
            if (string.IsNullOrWhiteSpace(command.Name))
            {
                throw new InvalidOperationException("Modbus register map: a command's 'name' must be a non-blank string.");
            }

            if (!names.Add(command.Name))
            {
                throw new InvalidOperationException(
                    $"Modbus register map: more than one command declares name '{command.Name}' — command names must be unique.");
            }

            if (command.CoilAddress is null)
            {
                throw new InvalidOperationException(
                    $"Modbus register map: command '{command.Name}' is missing mandatory 'coilAddress' — never " +
                    "defaulted to coil 0; commands trigger real writes to this address.");
            }

            if (command.Arguments is not null && command.Arguments.Count > 0)
            {
                throw new InvalidOperationException(
                    $"Modbus register map: command '{command.Name}' declares {command.Arguments.Count} argument(s) — " +
                    "argument-taking Modbus commands are not yet supported (the wire mapping for where an " +
                    "argument's value would be written is deferred to B-4); remove 'arguments' or leave it empty.");
            }

            if (command.Arguments is null)
            {
                continue;
            }

            var argumentNames = new HashSet<string>(StringComparer.Ordinal);
            foreach (var argument in command.Arguments)
            {
                var argumentError = argument.ValidateSelf();
                if (argumentError is not null)
                {
                    throw new InvalidOperationException(
                        $"Modbus register map: command '{command.Name}' declares an invalid argument — {argumentError}");
                }

                if (!argumentNames.Add(argument.Name))
                {
                    throw new InvalidOperationException(
                        $"Modbus register map: command '{command.Name}' declares more than one argument named '{argument.Name}'.");
                }
            }
        }
    }
}
