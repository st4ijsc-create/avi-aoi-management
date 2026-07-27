using St4i.EdgeCore.Models;
using Xunit;

namespace St4i.EdgeCore.Tests;

/// <summary>
/// GĐ3 sub-3 OU-2 PART A (docs/plans/2026-07-27-giaidoan3-opcua-driver-blueprint.md task 2) — the
/// REQUIRED gate OU-1's review flagged: <c>OpcUaDriver.BoxValue</c> passes a non-numeric string
/// telemetry value straight through (e.g. a "status" node → "RUNNING"), and every existing numeric
/// aggregation site used to test <c>value is IConvertible</c> then unconditionally call
/// <c>c.ToDouble(null)</c> — but <see cref="string"/> IS <see cref="IConvertible"/>, so
/// <c>Convert.ToDouble("RUNNING")</c> throws a <see cref="FormatException"/>. <see cref="TelemetryNumeric.TryGet"/>
/// is the ONE shared helper that replaces all three call sites (HistorianResultRecord.From,
/// MachineState's per-metric telemetry series, MachineState's spark-value pick) with a version that
/// never throws: a non-numeric string is skipped, a numeric string is parsed, and every other
/// previously-numeric input keeps behaving exactly as it did before this task.
/// </summary>
public class TelemetryNumericTests
{
    [Theory]
    [InlineData(23.5, 23.5)]
    [InlineData(42, 42.0)]
    public void TryGet_GenuinelyNumericValue_ReturnsTrueAndTheValue(object value, double expected)
    {
        Assert.True(TelemetryNumeric.TryGet(value, out var number));
        Assert.Equal(expected, number);
    }

    [Fact]
    public void TryGet_NumericString_IsParsed()
    {
        Assert.True(TelemetryNumeric.TryGet("42.5", out var number));
        Assert.Equal(42.5, number);
    }

    [Fact]
    public void TryGet_NonNumericStatusString_ReturnsFalse_NeverThrows()
    {
        // The exact reproduction of OU-1's review finding: a status tag like "RUNNING" must be
        // skipped, not crash the caller the way `Convert.ToDouble("RUNNING")` would.
        var ex = Record.Exception(() => TelemetryNumeric.TryGet("RUNNING", out _));
        Assert.Null(ex);
        Assert.False(TelemetryNumeric.TryGet("RUNNING", out var number));
        Assert.Equal(0, number);
    }

    [Fact]
    public void TryGet_Null_ReturnsFalse()
    {
        Assert.False(TelemetryNumeric.TryGet(null, out var number));
        Assert.Equal(0, number);
    }

    [Fact]
    public void TryGet_Bool_IsConvertibleToOneOrZero()
    {
        Assert.True(TelemetryNumeric.TryGet(true, out var number));
        Assert.Equal(1, number);

        Assert.True(TelemetryNumeric.TryGet(false, out var number2));
        Assert.Equal(0, number2);
    }

    [Fact]
    public void TryGet_DateTime_IsIConvertible_ButToDoubleThrows_SoItMustBeSkipped_NeverThrow()
    {
        // DateTime IS IConvertible, but IConvertible.ToDouble is explicitly unsupported for it
        // (throws InvalidCastException) — the exact "even a non-string IConvertible can throw"
        // case TryGet's try/catch exists to guard against.
        var ex = Record.Exception(() => TelemetryNumeric.TryGet(DateTimeOffset.UtcNow.UtcDateTime, out _));
        Assert.Null(ex);
        Assert.False(TelemetryNumeric.TryGet(DateTimeOffset.UtcNow.UtcDateTime, out var number));
        Assert.Equal(0, number);
    }
}
