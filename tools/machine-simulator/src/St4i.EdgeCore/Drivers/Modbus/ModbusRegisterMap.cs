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
    private static readonly JsonSerializerOptions JsonOptions = new()
    {
        PropertyNameCaseInsensitive = true,
        Converters = { new JsonStringEnumConverter() },
    };

    public required string MachineCode { get; init; }

    public byte UnitId { get; init; } = 1;

    public int PollIntervalMs { get; init; } = 1000;

    public required IReadOnlyList<ModbusRegister> Registers { get; init; }

    /// <summary>Parses a register-map JSON document (see the class doc comment for the expected shape;
    /// property names are matched case-insensitively, enum values as their C# member names — "Holding"/
    /// "Input", "UInt16"/"Int16" — also matched case-insensitively). Throws
    /// <see cref="JsonException"/>/<see cref="InvalidOperationException"/> straight through on malformed
    /// JSON or a missing required field (<see cref="MachineCode"/>/<see cref="Registers"/>) — the caller
    /// (Program.cs's startup wiring) is the one that decides "log + disable Modbus for this run" rather
    /// than crash, exactly like the UNS broker-bind failure already does; this method itself stays a
    /// plain, throwing parse function, same as <c>MappingProfile.FromJson</c>.</summary>
    public static ModbusRegisterMap FromJson(string json)
    {
        var map = JsonSerializer.Deserialize<ModbusRegisterMap>(json, JsonOptions);
        return map ?? throw new InvalidOperationException("ModbusRegisterMap.FromJson: JSON deserialized to null.");
    }
}
