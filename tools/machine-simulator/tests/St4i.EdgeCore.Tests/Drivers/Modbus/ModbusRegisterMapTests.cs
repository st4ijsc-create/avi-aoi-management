using St4i.EdgeCore.Drivers.Modbus;
using Xunit;

namespace St4i.EdgeCore.Tests.Drivers.Modbus;

/// <summary>
/// G2-6 (WS-H) — TDD-first coverage for <see cref="ModbusRegisterMap.FromJson"/> (mirrors the sample JSON
/// shape from the task brief) and the UInt16/Int16 + Scale decode contract
/// <see cref="ModbusTcpDriver"/>'s <c>PollOnceAsync</c> implements. The decode math here is intentionally
/// duplicated (not shared via a helper — the driver's own decode is a 1-line private expression, not a
/// public API) so it's locked in independent of any live Modbus traffic; the REAL end-to-end proof through
/// the driver's own code path is <c>ModbusTcpDriverLoopbackTests</c>.
/// </summary>
public class ModbusRegisterMapTests
{
    private const string SampleJson = """
    { "machineCode": "PLC-01", "unitId": 1, "pollIntervalMs": 1000,
      "registers": [
        { "address": 0, "type": "Holding", "dataType": "UInt16", "scale": 1.0, "metric": "temperature", "unit": "C" },
        { "address": 1, "type": "Holding", "dataType": "Int16",  "scale": 0.1, "metric": "pressure",    "unit": "bar" } ] }
    """;

    [Fact]
    public void FromJson_ParsesMachineCodeUnitIdPollIntervalAndRegisters()
    {
        var map = ModbusRegisterMap.FromJson(SampleJson);

        Assert.Equal("PLC-01", map.MachineCode);
        Assert.Equal((byte)1, map.UnitId);
        Assert.Equal(1000, map.PollIntervalMs);
        Assert.Equal(2, map.Registers.Count);

        var temperature = map.Registers[0];
        Assert.Equal((ushort)0, temperature.Address);
        Assert.Equal(ModbusRegisterType.Holding, temperature.Type);
        Assert.Equal(ModbusDataType.UInt16, temperature.DataType);
        Assert.Equal(1.0, temperature.Scale);
        Assert.Equal("temperature", temperature.Metric);
        Assert.Equal("C", temperature.Unit);

        var pressure = map.Registers[1];
        Assert.Equal((ushort)1, pressure.Address);
        Assert.Equal(ModbusRegisterType.Holding, pressure.Type);
        Assert.Equal(ModbusDataType.Int16, pressure.DataType);
        Assert.Equal(0.1, pressure.Scale);
        Assert.Equal("pressure", pressure.Metric);
        Assert.Equal("bar", pressure.Unit);
    }

    [Fact]
    public void FromJson_DefaultsUnitIdAndPollIntervalMs_WhenOmitted()
    {
        const string json = """
        { "machineCode": "PLC-DEFAULTS",
          "registers": [ { "address": 5, "type": "Input", "dataType": "UInt16", "scale": 1.0, "metric": "rpm" } ] }
        """;

        var map = ModbusRegisterMap.FromJson(json);

        Assert.Equal("PLC-DEFAULTS", map.MachineCode);
        Assert.Equal((byte)1, map.UnitId);
        Assert.Equal(1000, map.PollIntervalMs);
        Assert.Single(map.Registers);
        Assert.Equal(ModbusRegisterType.Input, map.Registers[0].Type);
        Assert.Null(map.Registers[0].Unit);
    }

    [Fact]
    public void FromJson_EnumsCaseInsensitive_ParseTypeAndDataType()
    {
        const string json = """
        { "machineCode": "PLC-CASE",
          "registers": [ { "address": 0, "type": "holding", "dataType": "int16", "scale": 1.0, "metric": "m" } ] }
        """;

        var map = ModbusRegisterMap.FromJson(json);

        Assert.Equal(ModbusRegisterType.Holding, map.Registers[0].Type);
        Assert.Equal(ModbusDataType.Int16, map.Registers[0].DataType);
    }

    /// <summary>P2-3 review fix (Important) — <c>required</c> only enforces the JSON key is PRESENT, not
    /// that the value is non-blank; a blank/whitespace <c>machineCode</c> used to sail through
    /// <see cref="ModbusRegisterMap.FromJson"/> and produce a blank-Code seed descriptor that crashed
    /// engine startup downstream (<c>FleetHost.RegisterMachine</c> throws on a blank Code, called OUTSIDE
    /// any try/catch in Program.cs). Asserts <see cref="FromJson"/> itself now rejects this — the SAME
    /// method Program.cs's existing try/catch already wraps, so this turns into the graceful "Modbus
    /// disabled for this run" outcome instead of an uncaught crash.</summary>
    [Theory]
    [InlineData("")]
    [InlineData("   ")]
    public void FromJson_Throws_WhenMachineCodeBlank(string blankCode)
    {
        var json = $$"""
        { "machineCode": "{{blankCode}}",
          "registers": [ { "address": 0, "type": "Holding", "dataType": "UInt16", "scale": 1.0, "metric": "m" } ] }
        """;

        Assert.Throws<InvalidOperationException>(() => ModbusRegisterMap.FromJson(json));
    }

    /// <summary>P2-3 review fix (Important, "consider while you're there") — a map with zero registers is
    /// useless (the driver would poll nothing); rejected the same way a blank <c>machineCode</c> is.</summary>
    [Fact]
    public void FromJson_Throws_WhenRegistersEmpty()
    {
        const string json = """
        { "machineCode": "PLC-EMPTY", "registers": [] }
        """;

        Assert.Throws<InvalidOperationException>(() => ModbusRegisterMap.FromJson(json));
    }

    // ─────────────────────────────────────────────────────────────────────
    // Task 9 — ReadTimeoutMs/Retries: optional overrides for the GP-6b health-freeze fix's derived
    // Math.Max(1000, PollIntervalMs * 4)/Retries=1 bound. Unset must stay byte-identical to before these
    // fields existed; a malformed value must fall back to that same default (never throw the whole map
    // out) with a logged warning, never silently.
    // ─────────────────────────────────────────────────────────────────────

    [Fact]
    public void EffectiveReadTimeoutMsAndRetries_DefaultToTheOriginalDerivedFormula_WhenFieldsOmitted()
    {
        const string json = """
        { "machineCode": "PLC-01", "pollIntervalMs": 200,
          "registers": [ { "address": 0, "type": "Holding", "dataType": "UInt16", "scale": 1.0, "metric": "m" } ] }
        """;

        var map = ModbusRegisterMap.FromJson(json);

        Assert.Null(map.ReadTimeoutMs);
        Assert.Null(map.Retries);
        // Math.Max(1000, 200 * 4) = 1000 (floored) — unchanged from before these fields existed.
        Assert.Equal(1000, map.EffectiveReadTimeoutMs);
        Assert.Equal(1, map.EffectiveRetries);
    }

    [Fact]
    public void EffectiveReadTimeoutMsAndRetries_DefaultFormula_ScalesWithPollIntervalMs_WhenAboveTheFloor()
    {
        const string json = """
        { "machineCode": "PLC-01", "pollIntervalMs": 2000,
          "registers": [ { "address": 0, "type": "Holding", "dataType": "UInt16", "scale": 1.0, "metric": "m" } ] }
        """;

        var map = ModbusRegisterMap.FromJson(json);

        // Math.Max(1000, 2000 * 4) = 8000 — the 1s floor no longer binds once pollIntervalMs is large enough.
        Assert.Equal(8000, map.EffectiveReadTimeoutMs);
    }

    [Fact]
    public void ReadTimeoutMsAndRetries_ExplicitValidValues_OverrideTheDerivedDefault_NoWarning()
    {
        const string json = """
        { "machineCode": "PLC-GATEWAY", "pollIntervalMs": 200, "readTimeoutMs": 3000, "retries": 2,
          "registers": [ { "address": 0, "type": "Holding", "dataType": "UInt16", "scale": 1.0, "metric": "m" } ] }
        """;

        var warnings = new List<string>();
        var map = ModbusRegisterMap.FromJson(json, logWarning: warnings.Add);

        Assert.Equal(3000, map.ReadTimeoutMs);
        Assert.Equal(2, map.Retries);
        Assert.Equal(3000, map.EffectiveReadTimeoutMs);
        Assert.Equal(2, map.EffectiveRetries);
        Assert.Empty(warnings);
    }

    [Theory]
    [InlineData("\"readTimeoutMs\": 0")]
    [InlineData("\"readTimeoutMs\": -500")]
    [InlineData("\"readTimeoutMs\": \"not-a-number\"")]
    [InlineData("\"readTimeoutMs\": 12.5")]
    public void ReadTimeoutMs_Malformed_FallsBackToDefault_WarnsInsteadOfThrowing(string malformedField)
    {
        var json = $$"""
        { "machineCode": "PLC-BAD-TIMEOUT", "pollIntervalMs": 200, {{malformedField}},
          "registers": [ { "address": 0, "type": "Holding", "dataType": "UInt16", "scale": 1.0, "metric": "m" } ] }
        """;

        var warnings = new List<string>();
        var map = ModbusRegisterMap.FromJson(json, logWarning: warnings.Add);

        // Never throws — the whole map still loads. The malformed field is ignored (falls back to the
        // derived default), and the operator is warned it was ignored.
        Assert.Null(map.ReadTimeoutMs);
        Assert.Equal(1000, map.EffectiveReadTimeoutMs);
        var warning = Assert.Single(warnings);
        Assert.Contains("readTimeoutMs", warning);
    }

    [Fact]
    public void ReadTimeoutMs_AboveTheMaxGuard_FallsBackToDefault_WarnsInsteadOfThrowing()
    {
        // Computed at runtime (not an [InlineData] literal) so this stays locked to
        // ModbusRegisterMap.MaxReadTimeoutMs even if that constant's value ever changes.
        var json = $$"""
        { "machineCode": "PLC-TOO-SLOW", "pollIntervalMs": 200, "readTimeoutMs": {{ModbusRegisterMap.MaxReadTimeoutMs + 1}},
          "registers": [ { "address": 0, "type": "Holding", "dataType": "UInt16", "scale": 1.0, "metric": "m" } ] }
        """;

        var warnings = new List<string>();
        var map = ModbusRegisterMap.FromJson(json, logWarning: warnings.Add);

        Assert.Null(map.ReadTimeoutMs);
        Assert.Equal(1000, map.EffectiveReadTimeoutMs);
        var warning = Assert.Single(warnings);
        Assert.Contains("readTimeoutMs", warning);
    }

    [Theory]
    [InlineData("\"retries\": 0")]
    [InlineData("\"retries\": -1")]
    [InlineData("\"retries\": \"two\"")]
    public void Retries_Malformed_FallsBackToDefault_WarnsInsteadOfThrowing(string malformedField)
    {
        var json = $$"""
        { "machineCode": "PLC-BAD-RETRIES", "pollIntervalMs": 200, {{malformedField}},
          "registers": [ { "address": 0, "type": "Holding", "dataType": "UInt16", "scale": 1.0, "metric": "m" } ] }
        """;

        var warnings = new List<string>();
        var map = ModbusRegisterMap.FromJson(json, logWarning: warnings.Add);

        Assert.Null(map.Retries);
        Assert.Equal(1, map.EffectiveRetries);
        var warning = Assert.Single(warnings);
        Assert.Contains("retries", warning);
    }

    [Fact]
    public void Retries_AboveTheMaxGuard_FallsBackToDefault_WarnsInsteadOfThrowing()
    {
        var json = $$"""
        { "machineCode": "PLC-TOO-MANY-RETRIES", "pollIntervalMs": 200, "retries": {{ModbusRegisterMap.MaxRetries + 1}},
          "registers": [ { "address": 0, "type": "Holding", "dataType": "UInt16", "scale": 1.0, "metric": "m" } ] }
        """;

        var warnings = new List<string>();
        var map = ModbusRegisterMap.FromJson(json, logWarning: warnings.Add);

        Assert.Null(map.Retries);
        Assert.Equal(1, map.EffectiveRetries);
        var warning = Assert.Single(warnings);
        Assert.Contains("retries", warning);
    }

    [Fact]
    public void ReadTimeoutMs_ExplicitJsonNull_TreatedSameAsOmitted_NoWarning()
    {
        const string json = """
        { "machineCode": "PLC-NULL-TIMEOUT", "pollIntervalMs": 200, "readTimeoutMs": null,
          "registers": [ { "address": 0, "type": "Holding", "dataType": "UInt16", "scale": 1.0, "metric": "m" } ] }
        """;

        var warnings = new List<string>();
        var map = ModbusRegisterMap.FromJson(json, logWarning: warnings.Add);

        Assert.Null(map.ReadTimeoutMs);
        Assert.Empty(warnings);
    }

    [Fact]
    public void ReadTimeoutMs_AtTheMaxGuard_IsAccepted_NotRejected()
    {
        var json = $$"""
        { "machineCode": "PLC-AT-MAX", "pollIntervalMs": 200, "readTimeoutMs": {{ModbusRegisterMap.MaxReadTimeoutMs}},
          "registers": [ { "address": 0, "type": "Holding", "dataType": "UInt16", "scale": 1.0, "metric": "m" } ] }
        """;

        var warnings = new List<string>();
        var map = ModbusRegisterMap.FromJson(json, logWarning: warnings.Add);

        Assert.Equal(ModbusRegisterMap.MaxReadTimeoutMs, map.ReadTimeoutMs);
        Assert.Empty(warnings);
    }

    [Theory]
    [InlineData(0xFFFF, ModbusDataType.Int16, 0.1, -0.1)]
    [InlineData(0xFFFF, ModbusDataType.UInt16, 1.0, 65535.0)]
    [InlineData(235, ModbusDataType.UInt16, 0.1, 23.5)]
    [InlineData(0, ModbusDataType.Int16, 1.0, 0.0)]
    [InlineData(32767, ModbusDataType.Int16, 1.0, 32767.0)]
    [InlineData(32768, ModbusDataType.Int16, 1.0, -32768.0)]
    public void Decode_UInt16VsInt16_WithScale_ProducesExpectedValue(int rawInt, ModbusDataType dataType, double scale, double expected)
    {
        var raw = (ushort)rawInt;

        // Mirrors ModbusTcpDriver.PollOnceAsync's decode expression exactly: UInt16 keeps the raw word
        // as-is; Int16 reinterprets the SAME bits as two's-complement signed BEFORE Scale is applied.
        double decoded = dataType == ModbusDataType.UInt16 ? raw : unchecked((short)raw);
        var actual = decoded * scale;

        Assert.Equal(expected, actual, precision: 10);
    }
}
