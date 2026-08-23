using System.Globalization;
using System.Text.Json;
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
        // Deliberately no Writable at all (pure physical-decode math, independent of any declared range —
        // Fix round 1's Critical #1 makes TryComputeRawWordForWrite ALSO enforce a declared range when one
        // exists, so a register WITH Writable set here would need a range wide enough to cover every
        // [InlineData] value, which is exactly what the declared-range-specific tests below cover instead).
        var register = new ModbusRegister(0, ModbusRegisterType.Holding, dataType, scale, "m");

        Assert.True(register.TryComputeRawWordForWrite(engineeringValue, out var raw, out var error));
        Assert.Null(error);
        Assert.Equal(expectedRaw, raw);
    }

    // ─────────────────────────────────────────────────────────────────────
    // Fix round 1, Critical #1 — TryComputeRawWordForWrite must ALSO enforce Writable's own declared
    // Min/Max, not only the register's physical DataType range. Before this fix, a register declared
    // [0,500] happily computed a raw word for 60000 (fits UInt16) and for -0.4 (rounds to 0, "succeeds").
    // ─────────────────────────────────────────────────────────────────────

    [Fact]
    public void TryComputeRawWordForWrite_EnforcesDeclaredRange_NotOnlyThePhysicalType()
    {
        var register = new ModbusRegister(0, ModbusRegisterType.Holding, ModbusDataType.UInt16, 1.0, "speed",
            Writable: new ModbusWritableRange(0, 500));

        // 60000 fits comfortably inside UInt16's own physical range (0..65535) but is WAY outside the
        // register's own declared [0,500] — the exact reviewer-reproduced defect.
        Assert.False(register.TryComputeRawWordForWrite(60000, out var raw, out var error));
        Assert.Equal(default, raw);
        Assert.Contains("declared", error);
    }

    [Fact]
    public void TryComputeRawWordForWrite_BelowDeclaredMin_Rejected_EvenWhenPhysicallyRepresentable()
    {
        var register = new ModbusRegister(0, ModbusRegisterType.Holding, ModbusDataType.Int16, 1.0, "speed",
            Writable: new ModbusWritableRange(0, 500));

        // -0.4 rounds to raw 0, which fits Int16 fine — but the ENGINEERING value -0.4 is below the
        // declared min of 0 and must be rejected on that basis, not silently accepted because its rounded
        // raw word happens to look in-range.
        Assert.False(register.TryComputeRawWordForWrite(-0.4, out var raw, out var error));
        Assert.Equal(default, raw);
        Assert.Contains("declared", error);
    }

    [Fact]
    public void TryComputeRawWordForWrite_WithinDeclaredRange_StillSucceeds()
    {
        var register = new ModbusRegister(0, ModbusRegisterType.Holding, ModbusDataType.UInt16, 1.0, "speed",
            Writable: new ModbusWritableRange(0, 500));

        Assert.True(register.TryComputeRawWordForWrite(250, out var raw, out var error));
        Assert.Null(error);
        Assert.Equal((ushort)250, raw);
    }

    [Fact]
    public void TryComputeRawWordForWrite_NoWritableDeclared_DeclaredRangeCheckSkipped_OnlyPhysicalTypeApplies()
    {
        // A register that was never declared writable at all has no declared range to enforce — this
        // method still applies its own physical-type check (a caller reaching this method on a non-writable
        // register is itself a caller error the driver's own NotWritable check should have already caught).
        var register = new ModbusRegister(0, ModbusRegisterType.Holding, ModbusDataType.UInt16, 1.0, "speed");

        Assert.True(register.TryComputeRawWordForWrite(60000, out var raw, out var error));
        Assert.Null(error);
        Assert.Equal((ushort)60000, raw);
    }

    // ─────────────────────────────────────────────────────────────────────
    // Fix round 1, Critical #2 — NaN fails every </> comparison, so it silently sailed past both the
    // declared-range and physical-range checks, then (ushort)double.NaN produced a live raw 0.
    // ─────────────────────────────────────────────────────────────────────

    [Fact]
    public void TryComputeRawWordForWrite_NaN_Rejected_NeverSilentlyWritesZero()
    {
        var register = new ModbusRegister(0, ModbusRegisterType.Holding, ModbusDataType.UInt16, 1.0, "speed",
            Writable: new ModbusWritableRange(100, 400));

        Assert.False(register.TryComputeRawWordForWrite(double.NaN, out var raw, out var error));
        Assert.Equal(default, raw);
        Assert.Contains("not finite", error);
    }

    [Theory]
    [InlineData(ModbusDataType.UInt16)]
    [InlineData(ModbusDataType.Int16)]
    public void TryComputeRawWordForWrite_NaN_Rejected_BothDataTypes(ModbusDataType dataType)
    {
        var register = new ModbusRegister(0, ModbusRegisterType.Holding, dataType, 1.0, "speed");

        Assert.False(register.TryComputeRawWordForWrite(double.NaN, out var raw, out _));
        Assert.Equal(default, raw);
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

    /// <summary>Fix round 1, scope call (a) (accepted, with a gap closed) — a Modbus command that declares
    /// ANY argument is now rejected outright at parse time: a map that could otherwise pass the gate, be
    /// confirmed, be persisted, and be listed as granted capability while being un-executable by any driver
    /// this codebase could ship is exactly the "declares a capability the product cannot honour" dishonesty
    /// this batch exists to remove. See <see cref="ModbusRegisterMap"/>'s own <c>ValidateCommands</c> remarks.
    /// (Argument narrowing itself is proven directly against <see cref="CommandArgumentDeclaration"/> in
    /// <c>CommandArgumentDeclarationTests</c>, and end-to-end through a real map via OPC-UA's own
    /// <c>Commands_WithDeclaredArgument_NarrowsCorrectly_TheExactGapB1Names</c> — OPC-UA commands are NOT
    /// restricted this way.)</summary>
    [Fact]
    public void Commands_WithAnyDeclaredArgument_Rejected_NotYetSupportedForModbus()
    {
        const string json = """
        { "machineCode": "PLC-CMD-ARGS", "registers": [
            { "address": 0, "type": "Holding", "dataType": "UInt16", "scale": 1.0, "metric": "m" } ],
          "commands": [ { "name": "SetMode", "coilAddress": 6,
            "arguments": [ { "name": "mode", "type": "UInt16", "min": 0, "max": 3 } ] } ] }
        """;

        var ex = Assert.Throws<InvalidOperationException>(() => ModbusRegisterMap.FromJson(json));
        Assert.Contains("SetMode", ex.Message);
    }

    /// <summary>An explicit empty <c>arguments: []</c> (as opposed to one or more entries) is NOT rejected —
    /// only a NON-empty declaration trips the "not yet supported" rule.</summary>
    [Fact]
    public void Commands_EmptyArgumentsArray_Accepted()
    {
        const string json = """
        { "machineCode": "PLC-CMD-EMPTYARGS", "registers": [
            { "address": 0, "type": "Holding", "dataType": "UInt16", "scale": 1.0, "metric": "m" } ],
          "commands": [ { "name": "StartCycle", "coilAddress": 6, "arguments": [] } ] }
        """;

        var map = ModbusRegisterMap.FromJson(json);
        var command = Assert.Single(map.Commands);
        Assert.Empty(command.Arguments!);
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

    /// <summary>Fix round 1 — a Modbus command's blanket "any argument at all" rejection fires regardless of
    /// whether the argument itself would ALSO have failed its own schema-shape check; the per-argument
    /// validation loop below it is dead code for Modbus today (kept in place, ready to reactivate, for when
    /// B-4 defines the wire-mapping convention and this restriction is relaxed — see <see cref="ModbusCommand"/>'s
    /// own doc comment) but this test pins that the BLANKET check is what actually fires first.</summary>
    [Fact]
    public void Commands_ArgumentWithMinMaxOnBoolType_Rejected_ByTheBlanketArgumentsRule()
    {
        const string json = """
        { "machineCode": "PLC-BADARG", "registers": [
            { "address": 0, "type": "Holding", "dataType": "UInt16", "scale": 1.0, "metric": "m" } ],
          "commands": [ { "name": "Start", "coilAddress": 1,
            "arguments": [ { "name": "enable", "type": "Bool", "min": 0, "max": 1 } ] } ] }
        """;

        var ex = Assert.Throws<InvalidOperationException>(() => ModbusRegisterMap.FromJson(json));
        Assert.Contains("Start", ex.Message);
    }

    // ─────────────────────────────────────────────────────────────────────
    // Fix round 1, Critical #3 — a Modbus command with no coilAddress used to parse and silently target
    // REAL coil 0 (a live, valid address, not a sentinel) — the exact "forgotten field arms a live default"
    // defect class this task's own headline rule already closed for setpoint limits, just relocated to a
    // command's write TARGET, which is worse (commands trigger real motion).
    // ─────────────────────────────────────────────────────────────────────

    [Fact]
    public void Commands_MissingCoilAddress_Rejected_NeverDefaultsToCoilZero()
    {
        const string json = """
        { "machineCode": "PLC-NOCOIL", "registers": [
            { "address": 0, "type": "Holding", "dataType": "UInt16", "scale": 1.0, "metric": "m" } ],
          "commands": [ { "name": "StartCycle" } ] }
        """;

        var ex = Assert.Throws<InvalidOperationException>(() => ModbusRegisterMap.FromJson(json));
        Assert.Contains("StartCycle", ex.Message);
        Assert.Contains("coilAddress", ex.Message);
    }

    [Fact]
    public void Commands_ExplicitCoilZero_Accepted_ADistinctCaseFromOmitted()
    {
        // Coil 0 is a genuinely valid address — this must NOT be confused with "omitted".
        const string json = """
        { "machineCode": "PLC-COILZERO", "registers": [
            { "address": 0, "type": "Holding", "dataType": "UInt16", "scale": 1.0, "metric": "m" } ],
          "commands": [ { "name": "StartCycle", "coilAddress": 0 } ] }
        """;

        var map = ModbusRegisterMap.FromJson(json);
        Assert.Equal((ushort)0, Assert.Single(map.Commands).CoilAddress);
    }

    // ─────────────────────────────────────────────────────────────────────
    // Fix round 1, Critical #3 (writable-register half) — a writable register with an omitted
    // address/type/dataType used to silently bind to 0/Holding/UInt16, all of which happen to look like a
    // perfectly legitimate writable point.
    // ─────────────────────────────────────────────────────────────────────

    [Fact]
    public void Writable_MissingAddress_Rejected_NeverDefaultsToZero()
    {
        const string json = """
        { "machineCode": "PLC-NOADDR", "registers": [
            { "type": "Holding", "dataType": "UInt16", "scale": 1.0, "metric": "speed",
              "writable": { "min": 0, "max": 500 } } ] }
        """;

        var ex = Assert.Throws<InvalidOperationException>(() => ModbusRegisterMap.FromJson(json));
        Assert.Contains("speed", ex.Message);
        Assert.Contains("address", ex.Message, StringComparison.OrdinalIgnoreCase);
    }

    [Fact]
    public void Writable_MissingType_Rejected_NeverDefaultsToHolding()
    {
        const string json = """
        { "machineCode": "PLC-NOTYPE", "registers": [
            { "address": 10, "dataType": "UInt16", "scale": 1.0, "metric": "speed",
              "writable": { "min": 0, "max": 500 } } ] }
        """;

        var ex = Assert.Throws<InvalidOperationException>(() => ModbusRegisterMap.FromJson(json));
        Assert.Contains("speed", ex.Message);
        Assert.Contains("'type'", ex.Message);
    }

    [Fact]
    public void Writable_MissingDataType_Rejected_NeverDefaultsToUInt16()
    {
        const string json = """
        { "machineCode": "PLC-NODATATYPE", "registers": [
            { "address": 10, "type": "Holding", "scale": 1.0, "metric": "speed",
              "writable": { "min": 0, "max": 500 } } ] }
        """;

        var ex = Assert.Throws<InvalidOperationException>(() => ModbusRegisterMap.FromJson(json));
        Assert.Contains("speed", ex.Message);
        Assert.Contains("'dataType'", ex.Message);
    }

    /// <summary>A NON-writable register missing address/type/dataType is unaffected by this new rule
    /// (pre-existing, unrelated behavior — the presence probe only runs for writable registers) — proven
    /// against the exact same omitted-address shape that IS rejected above, just without <c>writable</c>.</summary>
    [Fact]
    public void NonWritableRegister_MissingAddress_StillDefaultsSilently_UnaffectedByThisTask()
    {
        const string json = """
        { "machineCode": "PLC-READONLY-NOADDR", "registers": [
            { "type": "Holding", "dataType": "UInt16", "scale": 1.0, "metric": "temperature" } ] }
        """;

        var map = ModbusRegisterMap.FromJson(json);
        Assert.Equal((ushort)0, Assert.Single(map.Registers).Address);
    }

    // ─────────────────────────────────────────────────────────────────────
    // Fix round 1, I4 — a writable point's own name (Metric) is the write identity per B-1; it must not be
    // blank.
    // ─────────────────────────────────────────────────────────────────────

    [Theory]
    [InlineData("")]
    [InlineData("   ")]
    public void Writable_BlankMetric_Rejected(string blankMetric)
    {
        var json = $$"""
        { "machineCode": "PLC-BLANKMETRIC", "registers": [
            { "address": 10, "type": "Holding", "dataType": "UInt16", "scale": 1.0, "metric": "{{blankMetric}}",
              "writable": { "min": 0, "max": 500 } } ] }
        """;

        Assert.Throws<InvalidOperationException>(() => ModbusRegisterMap.FromJson(json));
    }

    // ─────────────────────────────────────────────────────────────────────
    // Fix round 1, minor — explicit JSON "commands": null must not throw a bare NullReferenceException.
    // ─────────────────────────────────────────────────────────────────────

    [Fact]
    public void Commands_ExplicitJsonNull_TreatedSameAsOmitted_NoThrow()
    {
        const string json = """
        { "machineCode": "PLC-NULLCMDS", "registers": [
            { "address": 0, "type": "Holding", "dataType": "UInt16", "scale": 1.0, "metric": "m" } ],
          "commands": null }
        """;

        var map = ModbusRegisterMap.FromJson(json);
        Assert.Empty(map.Commands);
    }

    // ─────────────────────────────────────────────────────────────────────
    // Fix round 1, I1 — WritablePointBounds/CommandTargets: the richer accessors the deliberate-save-gate's
    // confirmation fingerprint is built from, so a widened limit or a re-pointed coil changes the required
    // confirmation value.
    // ─────────────────────────────────────────────────────────────────────

    [Fact]
    public void WritablePointBounds_ReflectsDeclaredMinMaxAndTargetAddress()
    {
        const string json = """
        { "machineCode": "PLC-BOUNDS", "registers": [
            { "address": 0, "type": "Holding", "dataType": "UInt16", "scale": 1.0, "metric": "temperature" },
            { "address": 1, "type": "Holding", "dataType": "UInt16", "scale": 1.0, "metric": "speed",
              "writable": { "min": 0, "max": 5000 } } ] }
        """;

        var map = ModbusRegisterMap.FromJson(json);
        var bounds = Assert.Single(map.WritablePointBounds);
        Assert.Equal("speed", bounds.Metric);
        Assert.Equal("address:1", bounds.Target);
        Assert.Equal(0, bounds.Min);
        Assert.Equal(5000, bounds.Max);
    }

    /// <summary>Re-pointing a writable register to a DIFFERENT address produces a DIFFERENT target string,
    /// with the SAME declared bounds — the whole reason the target is folded into this accessor at all (so
    /// the save-gate's confirmation fingerprint changes when a writable point is re-pointed, not only when
    /// its limits are widened).</summary>
    [Fact]
    public void WritablePointBounds_DifferentAddress_ProducesDifferentTarget_SameBounds()
    {
        const string jsonAddr1 = """
        { "machineCode": "PLC-A1", "registers": [
            { "address": 1, "type": "Holding", "dataType": "UInt16", "scale": 1.0, "metric": "speed",
              "writable": { "min": 0, "max": 5000 } } ] }
        """;
        const string jsonAddr9 = """
        { "machineCode": "PLC-A9", "registers": [
            { "address": 9, "type": "Holding", "dataType": "UInt16", "scale": 1.0, "metric": "speed",
              "writable": { "min": 0, "max": 5000 } } ] }
        """;

        var bounds1 = Assert.Single(ModbusRegisterMap.FromJson(jsonAddr1).WritablePointBounds);
        var bounds9 = Assert.Single(ModbusRegisterMap.FromJson(jsonAddr9).WritablePointBounds);

        Assert.NotEqual(bounds1.Target, bounds9.Target);
        Assert.Equal(bounds1.Min, bounds9.Min);
        Assert.Equal(bounds1.Max, bounds9.Max);
    }

    [Fact]
    public void CommandTargets_ReflectsCoilAddress_FormattedDeterministically()
    {
        const string json = """
        { "machineCode": "PLC-TARGETS", "registers": [
            { "address": 0, "type": "Holding", "dataType": "UInt16", "scale": 1.0, "metric": "m" } ],
          "commands": [ { "name": "StartCycle", "coilAddress": 5 } ] }
        """;

        var map = ModbusRegisterMap.FromJson(json);
        var target = Assert.Single(map.CommandTargets);
        Assert.Equal("StartCycle", target.Name);
        Assert.Equal("coil:5", target.Target);
    }

    /// <summary>Re-pointing a command to a DIFFERENT coil produces a DIFFERENT target string — the whole
    /// reason this accessor exists (so the save-gate's confirmation fingerprint changes too).</summary>
    [Fact]
    public void CommandTargets_DifferentCoilAddress_ProducesDifferentTarget()
    {
        const string json5 = """
        { "machineCode": "PLC-T5", "registers": [
            { "address": 0, "type": "Holding", "dataType": "UInt16", "scale": 1.0, "metric": "m" } ],
          "commands": [ { "name": "StartCycle", "coilAddress": 5 } ] }
        """;
        const string json99 = """
        { "machineCode": "PLC-T99", "registers": [
            { "address": 0, "type": "Holding", "dataType": "UInt16", "scale": 1.0, "metric": "m" } ],
          "commands": [ { "name": "StartCycle", "coilAddress": 99 } ] }
        """;

        var target5 = Assert.Single(ModbusRegisterMap.FromJson(json5).CommandTargets);
        var target99 = Assert.Single(ModbusRegisterMap.FromJson(json99).CommandTargets);

        Assert.NotEqual(target5.Target, target99.Target);
    }

    // ─────────────────────────────────────────────────────────────────────────────────────────────
    // 🔴 docs/owner-decisions.md ITEM 38 — pollIntervalMs was the one cadence key with no domain
    // check, beside two that had one. These are the witnesses; each one FAILS against the parse
    // path as it stood at 889c72ab, where every value below was stored exactly as declared.
    // ─────────────────────────────────────────────────────────────────────────────────────────────

    private static string MapWithPollInterval(string rawJsonValue, string machineCode = "PLC-CADENCE") => $$"""
    { "machineCode": "{{machineCode}}", "pollIntervalMs": {{rawJsonValue}},
      "registers": [ { "address": 0, "type": "Holding", "dataType": "UInt16", "scale": 1.0, "metric": "v" } ] }
    """;

    /// <summary>
    /// 🔴 <b>The three measured failure shapes, refused at the parse boundary — and the third one is why
    /// this item was worth paying.</b> <c>0</c> gives an unthrottled poll loop and <c>≤ -2</c> throws
    /// <see cref="ArgumentOutOfRangeException"/> out of a <c>catch</c> that only handles cancellation:
    /// both are LOUD. <c>-1</c> is <c>Timeout.Infinite</c> — the device is polled exactly once and then
    /// goes quiet with Health frozen at whatever the first poll produced, which from outside is
    /// indistinguishable from a healthy device on a slow cadence. A plant can see the other two. It
    /// cannot see that one, which is why "store it as declared" was never a safe default.
    /// </summary>
    [Theory]
    [InlineData("0")]
    [InlineData("-1")]
    [InlineData("-2")]
    [InlineData("-2147483648")]
    public void FromJson_RefusesNonPositivePollIntervalMs_WarnsAndFallsBackToTheDefault(string declared)
    {
        var warnings = new List<string>();

        var map = ModbusRegisterMap.FromJson(MapWithPollInterval(declared), logWarning: warnings.Add);

        Assert.Equal(ModbusRegisterMap.DefaultPollIntervalMs, map.PollIntervalMs);
        var warning = Assert.Single(warnings);
        Assert.Contains("pollIntervalMs", warning, StringComparison.Ordinal);
        Assert.Contains(declared, warning, StringComparison.Ordinal);
    }

    /// <summary>The upper half of the domain. Item 38 deliberately puts this ceiling where the type stops
    /// being able to describe itself rather than at a hand-picked round number — see
    /// <see cref="ModbusRegisterMap.MaxPollIntervalMs"/>.</summary>
    [Fact]
    public void FromJson_RefusesPollIntervalMsAboveTheCeiling_WarnsAndFallsBackToTheDefault()
    {
        var warnings = new List<string>();
        var tooLarge = ModbusRegisterMap.MaxPollIntervalMs + 1;

        var map = ModbusRegisterMap.FromJson(MapWithPollInterval(tooLarge.ToString(CultureInfo.InvariantCulture)), logWarning: warnings.Add);

        Assert.Equal(ModbusRegisterMap.DefaultPollIntervalMs, map.PollIntervalMs);
        var warning = Assert.Single(warnings);
        Assert.Contains("pollIntervalMs", warning, StringComparison.Ordinal);
    }

    /// <summary>
    /// 🔴 <b>The ceiling is DERIVED, and this is the derivation — an assertion, not a sentence about
    /// one.</b> <see cref="ModbusRegisterMap.EffectiveReadTimeoutMs"/> computes
    /// <c>PollIntervalMs * 4</c> in <see langword="int"/>. At the ceiling that product is still positive;
    /// one millisecond above it, the multiplication wraps negative and <c>Math.Max(1000, …)</c> quietly
    /// returns the floor, so the derived per-attempt timeout stops having anything to do with the declared
    /// cadence. That is the measured reason the line sits exactly here.
    /// </summary>
    [Fact]
    public void MaxPollIntervalMs_IsTheLargestValueEffectiveReadTimeoutMsCanMultiplyWithoutOverflow()
    {
        Assert.True(ModbusRegisterMap.MaxPollIntervalMs * 4 > 0);
        Assert.True(unchecked((ModbusRegisterMap.MaxPollIntervalMs + 1) * 4) < 0);

        var atCeiling = new ModbusRegisterMap
        {
            MachineCode = "PLC-CEILING",
            PollIntervalMs = ModbusRegisterMap.MaxPollIntervalMs,
            Registers = new List<ModbusRegister>
            {
                new(Address: 0, Type: ModbusRegisterType.Holding, DataType: ModbusDataType.UInt16, Scale: 1.0, Metric: "v", Unit: null),
            },
        };

        Assert.Equal(ModbusRegisterMap.MaxPollIntervalMs * 4, atCeiling.EffectiveReadTimeoutMs);
    }

    /// <summary>
    /// 🔴 <b>A regression this fix's own first draft would have shipped, kept as a standing witness.</b>
    /// The binder matches property names case-INSENSITIVELY; an ordinal <c>TryGetProperty</c> does not.
    /// The first draft read the raw element the way <c>readTimeoutMs</c>/<c>retries</c> do — which are
    /// <c>[JsonIgnore]</c>d and have no bound value to disagree with — and so would have missed this
    /// document entirely and silently replaced a perfectly valid declared cadence with the default. An
    /// in-domain value must survive every spelling the product already accepts.
    /// </summary>
    [Theory]
    [InlineData("pollIntervalMs")]
    [InlineData("PollIntervalMs")]
    [InlineData("pollintervalms")]
    [InlineData("POLLINTERVALMS")]
    public void FromJson_KeepsAnInDomainPollIntervalMs_UnderEverySpellingTheBinderAccepts(string key)
    {
        var json = $$"""
        { "machineCode": "PLC-SPELLING", "{{key}}": 250,
          "registers": [ { "address": 0, "type": "Holding", "dataType": "UInt16", "scale": 1.0, "metric": "v" } ] }
        """;

        var warnings = new List<string>();
        var map = ModbusRegisterMap.FromJson(json, logWarning: warnings.Add);

        Assert.Equal(250, map.PollIntervalMs);
        Assert.Empty(warnings);
    }

    /// <summary>The one intentional <c>0</c> measured anywhere in this product — three maps built flat-out
    /// by <c>ModbusMultidropBusTests.ASlowPollerIsNotStarved_ByThreeDevicesPollingFlatOut</c> — is built
    /// through an object initializer, not through <see cref="ModbusRegisterMap.FromJson"/>. Item 38 put
    /// the check at the parse boundary, where its two neighbours put theirs, precisely so that construction
    /// stays legal. This asserts the boundary, so that moving the check onto the property (which would
    /// break that suite) fails here first and explains itself.</summary>
    [Fact]
    public void ProgrammaticConstruction_IsNotSubjectToTheParseTimeDomainCheck()
    {
        var flatOut = new ModbusRegisterMap
        {
            MachineCode = "FAIR-F1",
            PollIntervalMs = 0,
            Registers = new List<ModbusRegister>
            {
                new(Address: 0, Type: ModbusRegisterType.Holding, DataType: ModbusDataType.UInt16, Scale: 1.0, Metric: "v", Unit: null),
            },
        };

        Assert.Equal(0, flatOut.PollIntervalMs);
    }

    // ─────────────────────────────────────────────────────────────────────────────────────────────
    // 🔴 docs/owner-decisions.md ITEM 39 — `"registers": null` satisfied `required`, bound a genuine
    // null, and threw a BARE NullReferenceException. TWO cases, measured separately: an explicit null
    // and an ABSENT key are different inputs with different mechanisms, and only one of them was broken.
    // ─────────────────────────────────────────────────────────────────────────────────────────────

    /// <summary>
    /// 🔴 <b>Case 1 — explicit <c>null</c>.</b> <c>required</c> is satisfied by the KEY BEING PRESENT, so
    /// an explicit null passes the binder's required-property check and binds through into a property
    /// declared non-nullable. Before this fix the next statement dereferenced it and the operator received
    /// <c>"Object reference not set to an instance of an object."</c> — no field, no machine code, nothing
    /// to act on — passed out verbatim by <c>ModbusConnectorFactory.TryCreate</c> as its <c>error</c>.
    /// </summary>
    [Fact]
    public void FromJson_ExplicitNullRegisters_ThrowsNamingTheFieldAndTheMachine_NotABareNullReference()
    {
        const string json = """{ "machineCode": "PLC-NULLREG", "registers": null }""";

        var ex = Assert.Throws<InvalidOperationException>(() => ModbusRegisterMap.FromJson(json));

        Assert.Contains("registers", ex.Message, StringComparison.Ordinal);
        Assert.Contains("PLC-NULLREG", ex.Message, StringComparison.Ordinal);
        Assert.DoesNotContain("Object reference not set", ex.Message, StringComparison.Ordinal);
    }

    /// <summary>
    /// <b>Case 2 — the key is ABSENT.</b> A different mechanism entirely: the binder's required-property
    /// enforcement fires and never constructs the object. This case was already correct before item 39 and
    /// is asserted here so the fix for case 1 cannot quietly swallow it — a null check placed after a
    /// successful bind must not change what happens when there is no bind at all. Item 39's own text named
    /// only case 1; both are measured here.
    /// </summary>
    [Fact]
    public void FromJson_AbsentRegistersKey_StillFailsInTheBinderNamingTheProperty()
    {
        const string json = """{ "machineCode": "PLC-NOREG" }""";

        var ex = Assert.Throws<JsonException>(() => ModbusRegisterMap.FromJson(json));

        Assert.Contains("Registers", ex.Message, StringComparison.Ordinal);
    }

    /// <summary>The third neighbour in the same family, asserted so the set is closed rather than
    /// sampled: a present-but-EMPTY array is refused by this method's own check, naming the field. Three
    /// inputs, three distinct outcomes, and after item 39 none of them is a bare CLR message.</summary>
    [Fact]
    public void FromJson_EmptyRegistersArray_IsRefusedByThisMethodNamingTheField()
    {
        const string json = """{ "machineCode": "PLC-EMPTYREG", "registers": [] }""";

        var ex = Assert.Throws<InvalidOperationException>(() => ModbusRegisterMap.FromJson(json));

        Assert.Contains("registers", ex.Message, StringComparison.Ordinal);
    }
}
