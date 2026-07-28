using System.Text.Json;
using System.Text.Json.Serialization;

namespace St4i.EdgeCore.Drivers.Modbus;

/// <summary>Which Modbus function code a register is read through: FC03 (Holding, 4xxxx addresses,
/// read/write on the real device) or FC04 (Input, 3xxxx addresses, read-only). This map only ever READS
/// either kind — writing is out of scope for this driver.</summary>
public enum ModbusRegisterType { Holding, Input }

/// <summary>How to decode the raw 16-bit register value <see cref="ModbusTcpDriver"/> reads. Deliberately
/// minimal for G2-6: a single 16-bit word, unsigned or two's-complement signed. 32-bit/float values (a
/// register PAIR combined per some word-order convention) are a documented follow-up — see
/// <see cref="ModbusTcpDriver"/>'s class doc comment — not built here.</summary>
public enum ModbusDataType { UInt16, Int16 }

/// <summary>One register→canonical-tag mapping: which register to read, how to decode it, and the metric
/// name/unit it becomes on the resulting <see cref="Models.TelemetrySample"/>. <see cref="Scale"/>
/// multiplies the decoded raw integer to produce the telemetry value (e.g. a raw 235 with scale 0.1 →
/// 23.5) — this is the ENTIRE unit-conversion story for G2-6; anything fancier (per-register offset,
/// non-linear conversion) is out of scope.</summary>
public sealed record ModbusRegister(
    ushort Address, ModbusRegisterType Type, ModbusDataType DataType, double Scale, string Metric, string? Unit = null);

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

        return new ModbusRegisterMap
        {
            MachineCode = map.MachineCode,
            UnitId = map.UnitId,
            PollIntervalMs = map.PollIntervalMs,
            Registers = map.Registers,
            ReadTimeoutMs = ParseOptionalPositiveInt(document.RootElement, "readTimeoutMs", MaxReadTimeoutMs, logWarning),
            Retries = ParseOptionalPositiveInt(document.RootElement, "retries", MaxRetries, logWarning),
        };
    }

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
}
