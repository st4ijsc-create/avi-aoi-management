using St4i.Connector.Abstractions.Models;
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

    // ─────────────────────────────────────────────────────────────────────
    // Task B-3 (.superpowers/sdd/2026-07-29-dotB-machine-control-blueprint/task-3-brief.md) — writable
    // setpoints: mandatory limits enforced at parse time, Holding-only, inverse-scaling + its overflow trap.
    // ─────────────────────────────────────────────────────────────────────

    [Fact]
    public void Writable_DeclaredWithMinMax_Parses_AppearsInWritablePointNames()
    {
        const string json = """
        { "machineCode": "PLC-WRITE", "registers": [
            { "address": 10, "type": "Holding", "dataType": "UInt16", "scale": 0.1, "metric": "speed",
              "writable": { "min": 0, "max": 500 } } ] }
        """;

        var map = ModbusRegisterMap.FromJson(json);

        var register = Assert.Single(map.Registers);
        Assert.NotNull(register.Writable);
        Assert.Equal(0, register.Writable!.Min);
        Assert.Equal(500, register.Writable.Max);
        Assert.Equal(new[] { "speed" }, map.WritablePointNames);
    }

    [Fact]
    public void NonWritableRegister_WritableIsNull_NotInWritablePointNames_ByteIdenticalToBeforeThisTask()
    {
        var map = ModbusRegisterMap.FromJson(SampleJson);

        Assert.All(map.Registers, r => Assert.Null(r.Writable));
        Assert.Empty(map.WritablePointNames);
        Assert.Empty(map.Commands);
        Assert.Empty(map.CommandNames);
    }

    [Fact]
    public void Writable_MissingMinAndMax_RejectedAtParseTime_MessageNamesThePoint()
    {
        const string json = """
        { "machineCode": "PLC-NOLIMIT", "registers": [
            { "address": 10, "type": "Holding", "dataType": "UInt16", "scale": 1.0, "metric": "speed",
              "writable": { } } ] }
        """;

        var ex = Assert.Throws<InvalidOperationException>(() => ModbusRegisterMap.FromJson(json));
        Assert.Contains("speed", ex.Message);
        Assert.Contains("min", ex.Message);
    }

    [Theory]
    [InlineData("""{ "min": 0 }""")]
    [InlineData("""{ "max": 500 }""")]
    public void Writable_MissingEitherBound_RejectedAtParseTime(string writableJson)
    {
        var json = $$"""
        { "machineCode": "PLC-HALFLIMIT", "registers": [
            { "address": 10, "type": "Holding", "dataType": "UInt16", "scale": 1.0, "metric": "speed",
              "writable": {{writableJson}} } ] }
        """;

        var ex = Assert.Throws<InvalidOperationException>(() => ModbusRegisterMap.FromJson(json));
        Assert.Contains("speed", ex.Message);
    }

    [Fact]
    public void Writable_MinGreaterThanMax_Rejected()
    {
        const string json = """
        { "machineCode": "PLC-BADRANGE", "registers": [
            { "address": 10, "type": "Holding", "dataType": "UInt16", "scale": 1.0, "metric": "speed",
              "writable": { "min": 500, "max": 0 } } ] }
        """;

        var ex = Assert.Throws<InvalidOperationException>(() => ModbusRegisterMap.FromJson(json));
        Assert.Contains("speed", ex.Message);
        Assert.Contains("greater than", ex.Message);
    }

    [Fact]
    public void Writable_OnInputRegister_Rejected_InputHasNoWriteFunctionCode()
    {
        const string json = """
        { "machineCode": "PLC-INPUTWRITE", "registers": [
            { "address": 10, "type": "Input", "dataType": "UInt16", "scale": 1.0, "metric": "speed",
              "writable": { "min": 0, "max": 500 } } ] }
        """;

        var ex = Assert.Throws<InvalidOperationException>(() => ModbusRegisterMap.FromJson(json));
        Assert.Contains("speed", ex.Message);
        Assert.Contains("Holding", ex.Message);
    }

    [Fact]
    public void Writable_ZeroScale_Rejected_CannotBeInverted()
    {
        const string json = """
        { "machineCode": "PLC-ZEROSCALE", "registers": [
            { "address": 10, "type": "Holding", "dataType": "UInt16", "scale": 0.0, "metric": "speed",
              "writable": { "min": 0, "max": 500 } } ] }
        """;

        var ex = Assert.Throws<InvalidOperationException>(() => ModbusRegisterMap.FromJson(json));
        Assert.Contains("speed", ex.Message);
        Assert.Contains("scale", ex.Message, StringComparison.OrdinalIgnoreCase);
    }

    [Fact]
    public void Writable_DuplicateMetricAmongWritableRegisters_Rejected_AmbiguousWriteTarget()
    {
        const string json = """
        { "machineCode": "PLC-DUP", "registers": [
            { "address": 10, "type": "Holding", "dataType": "UInt16", "scale": 1.0, "metric": "speed",
              "writable": { "min": 0, "max": 500 } },
            { "address": 11, "type": "Holding", "dataType": "UInt16", "scale": 1.0, "metric": "speed",
              "writable": { "min": 0, "max": 100 } } ] }
        """;

        var ex = Assert.Throws<InvalidOperationException>(() => ModbusRegisterMap.FromJson(json));
        Assert.Contains("speed", ex.Message);
    }

    /// <summary>Two non-writable registers sharing a metric is pre-existing, unaffected behavior — this new
    /// uniqueness rule applies ONLY to writable points (the new identity this task introduces).</summary>
    [Fact]
    public void DuplicateMetricAmongNonWritableRegisters_StillAllowed_UnaffectedByThisTask()
    {
        const string json = """
        { "machineCode": "PLC-DUP-READONLY", "registers": [
            { "address": 10, "type": "Holding", "dataType": "UInt16", "scale": 1.0, "metric": "speed" },
            { "address": 11, "type": "Holding", "dataType": "UInt16", "scale": 1.0, "metric": "speed" } ] }
        """;

        var map = ModbusRegisterMap.FromJson(json);
        Assert.Equal(2, map.Registers.Count);
    }

    // ─────────────────────────────────────────────────────────────────────
    // Inverse scaling — TryComputeRawWordForWrite, including the overflow trap.
    // ─────────────────────────────────────────────────────────────────────

    [Theory]
    [InlineData(23.5, 0.1, ModbusDataType.UInt16, (ushort)235)]
    [InlineData(0.0, 1.0, ModbusDataType.Int16, (ushort)0)]
    [InlineData(-0.1, 0.1, ModbusDataType.Int16, (ushort)0xFFFF)] // -1 raw, bit-cast to its UInt16 pattern.
    [InlineData(32767.0, 1.0, ModbusDataType.Int16, (ushort)32767)]
    [InlineData(-32768.0, 1.0, ModbusDataType.Int16, (ushort)32768)]
    [InlineData(65535.0, 1.0, ModbusDataType.UInt16, (ushort)65535)]
    public void TryComputeRawWordForWrite_RoundTrips_InverseOfTheReadSideDecode(
        double engineeringValue, double scale, ModbusDataType dataType, ushort expectedRaw)
    {
        var register = new ModbusRegister(0, ModbusRegisterType.Holding, dataType, scale, "m",
            Writable: new ModbusWritableRange(-40000, 40000));

        Assert.True(register.TryComputeRawWordForWrite(engineeringValue, out var raw, out var error));
        Assert.Null(error);
        Assert.Equal(expectedRaw, raw);
    }

    [Fact]
    public void TryComputeRawWordForWrite_RoundsToNearest_AwayFromZero()
    {
        var register = new ModbusRegister(0, ModbusRegisterType.Holding, ModbusDataType.UInt16, 0.1, "m",
            Writable: new ModbusWritableRange(0, 100));

        // 23.46 / 0.1 = 234.6 -> rounds to 235.
        Assert.True(register.TryComputeRawWordForWrite(23.46, out var raw, out _));
        Assert.Equal((ushort)235, raw);
    }

    /// <summary>The exact trap the task brief calls out by name: a value that passes a (hypothetical, wide)
    /// declared min/max can still overflow the register's own physical type once inverse-scaled — this must
    /// be asserted as a failure, never silently wrapped/truncated by a naive numeric cast.</summary>
    [Theory]
    [InlineData(ModbusDataType.UInt16, 70000.0, 1.0)] // 70000 raw > ushort.MaxValue (65535).
    [InlineData(ModbusDataType.UInt16, -1.0, 1.0)] // -1 raw < ushort.MinValue (0).
    [InlineData(ModbusDataType.Int16, 40000.0, 1.0)] // 40000 raw > short.MaxValue (32767).
    [InlineData(ModbusDataType.Int16, -40000.0, 1.0)] // -40000 raw < short.MinValue (-32768).
    public void TryComputeRawWordForWrite_OverflowsThePhysicalType_Rejected_NeverWraps(
        ModbusDataType dataType, double engineeringValue, double scale)
    {
        var register = new ModbusRegister(0, ModbusRegisterType.Holding, dataType, scale, "m");

        Assert.False(register.TryComputeRawWordForWrite(engineeringValue, out var raw, out var error));
        Assert.Equal(default, raw);
        Assert.Contains("representable range", error);
    }

    /// <summary>The parse-time side of the same overflow trap: a declared min/max range that, once
    /// inverse-scaled, would overflow the register's own DataType must be rejected at MAP-LOAD time — never
    /// deferred to a future write attempt that could otherwise silently wrap/truncate.</summary>
    [Fact]
    public void Writable_DeclaredRangeOverflowsPhysicalTypeOnceInverseScaled_RejectedAtParseTime()
    {
        // scale 0.1, UInt16 (max raw 65535) => max representable engineering value is 6553.5. Declaring
        // max=7000 requests a raw of 70000, which overflows UInt16.
        const string json = """
        { "machineCode": "PLC-OVERFLOW", "registers": [
            { "address": 10, "type": "Holding", "dataType": "UInt16", "scale": 0.1, "metric": "speed",
              "writable": { "min": 0, "max": 7000 } } ] }
        """;

        var ex = Assert.Throws<InvalidOperationException>(() => ModbusRegisterMap.FromJson(json));
        Assert.Contains("speed", ex.Message);
        Assert.Contains("overflow", ex.Message, StringComparison.OrdinalIgnoreCase);
    }

    // ─────────────────────────────────────────────────────────────────────
    // Commands.
    // ─────────────────────────────────────────────────────────────────────

    [Fact]
    public void Commands_DeclaredWithCoilAddress_Parses_AppearsInCommandNames()
    {
        const string json = """
        { "machineCode": "PLC-CMD", "registers": [
            { "address": 0, "type": "Holding", "dataType": "UInt16", "scale": 1.0, "metric": "m" } ],
          "commands": [ { "name": "StartCycle", "coilAddress": 5 } ] }
        """;

        var map = ModbusRegisterMap.FromJson(json);

        var command = Assert.Single(map.Commands);
        Assert.Equal("StartCycle", command.Name);
        Assert.Equal((ushort)5, command.CoilAddress);
        Assert.Equal(new[] { "StartCycle" }, map.CommandNames);
    }

    [Fact]
    public void Commands_WithDeclaredArgument_NarrowsCorrectly()
    {
        const string json = """
        { "machineCode": "PLC-CMD-ARGS", "registers": [
            { "address": 0, "type": "Holding", "dataType": "UInt16", "scale": 1.0, "metric": "m" } ],
          "commands": [ { "name": "SetMode", "coilAddress": 6,
            "arguments": [ { "name": "mode", "type": "UInt16", "min": 0, "max": 3 } ] } ] }
        """;

        var map = ModbusRegisterMap.FromJson(json);

        var command = Assert.Single(map.Commands);
        var argument = Assert.Single(command.Arguments!);
        Assert.Equal("mode", argument.Name);
        Assert.Equal(CommandArgumentType.UInt16, argument.Type);

        Assert.True(argument.TryNarrow(2L, out var narrowed, out _));
        Assert.Equal((ushort)2, narrowed);
        Assert.False(argument.TryNarrow(10L, out _, out var error)); // outside declared [0,3].
        Assert.NotNull(error);
    }

    [Fact]
    public void Commands_DuplicateName_Rejected()
    {
        const string json = """
        { "machineCode": "PLC-DUPCMD", "registers": [
            { "address": 0, "type": "Holding", "dataType": "UInt16", "scale": 1.0, "metric": "m" } ],
          "commands": [ { "name": "Start", "coilAddress": 1 }, { "name": "Start", "coilAddress": 2 } ] }
        """;

        var ex = Assert.Throws<InvalidOperationException>(() => ModbusRegisterMap.FromJson(json));
        Assert.Contains("Start", ex.Message);
    }

    [Fact]
    public void Commands_BlankName_Rejected()
    {
        const string json = """
        { "machineCode": "PLC-BLANKCMD", "registers": [
            { "address": 0, "type": "Holding", "dataType": "UInt16", "scale": 1.0, "metric": "m" } ],
          "commands": [ { "name": "  ", "coilAddress": 1 } ] }
        """;

        Assert.Throws<InvalidOperationException>(() => ModbusRegisterMap.FromJson(json));
    }

    [Fact]
    public void Commands_ArgumentWithMinMaxOnBoolType_Rejected_SchemaShapeCheck()
    {
        const string json = """
        { "machineCode": "PLC-BADARG", "registers": [
            { "address": 0, "type": "Holding", "dataType": "UInt16", "scale": 1.0, "metric": "m" } ],
          "commands": [ { "name": "Start", "coilAddress": 1,
            "arguments": [ { "name": "enable", "type": "Bool", "min": 0, "max": 1 } ] } ] }
        """;

        var ex = Assert.Throws<InvalidOperationException>(() => ModbusRegisterMap.FromJson(json));
        Assert.Contains("Start", ex.Message);
        Assert.Contains("enable", ex.Message);
    }

    [Fact]
    public void Commands_DuplicateArgumentNameWithinOneCommand_Rejected()
    {
        const string json = """
        { "machineCode": "PLC-DUPARG", "registers": [
            { "address": 0, "type": "Holding", "dataType": "UInt16", "scale": 1.0, "metric": "m" } ],
          "commands": [ { "name": "Start", "coilAddress": 1,
            "arguments": [ { "name": "mode", "type": "UInt16" }, { "name": "mode", "type": "Int16" } ] } ] }
        """;

        var ex = Assert.Throws<InvalidOperationException>(() => ModbusRegisterMap.FromJson(json));
        Assert.Contains("Start", ex.Message);
        Assert.Contains("mode", ex.Message);
    }
}
