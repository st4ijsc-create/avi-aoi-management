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
