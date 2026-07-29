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
}
