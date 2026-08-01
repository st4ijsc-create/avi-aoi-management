using System.Globalization;
using St4i.Connector.Abstractions.Models;

namespace St4i.Connector.Conformance;

/// <summary>
/// GP-6 — field-by-field <see cref="DeviceReading"/> comparison used by both the round-trip check
/// (<see cref="DeviceDriverConformanceSuite.Check_Telemetry_RoundTripsLosslesslyThroughConnectorJson"/>) and
/// the no-reuse check (<see cref="DeviceDriverConformanceSuite.Check_ReadAsync_NeverReusesOrMutatesAYieldedReading"/>).
///
/// <para><b>Why not <c>DeviceReading.Equals</c>/record equality:</b> <see cref="DeviceReading"/> is a plain
/// mutable class with no <c>Equals</c> override (reference equality), and even its record-typed members
/// (<see cref="TelemetrySample"/>, <see cref="MeasurementResult"/>, ...) generate structural equality that
/// falls back to REFERENCE equality for any collection-typed field (<see cref="WaveformSeries.Samples"/>) —
/// so nothing in the model gives "are these two readings the same VALUE" for free; this class exists
/// entirely to compute that.</para>
///
/// <para><b>This repo has already been burned once by a round-trip test that only survived scrutiny because
/// it asserted CLR TYPES rather than VALUES</b> (see task-6-report.md's framing) — so <see cref="Compare"/>
/// deliberately never compares <c>GetType()</c>/uses <c>is</c> pattern matching as its final word for the
/// <c>object?</c> slots (<see cref="TelemetrySample.Value"/>, <see cref="DeviceReading.Genealogy"/> values).
/// Instead, <paramref name="allowNumericWidening"/> controls whether a numeric value is allowed to have
/// CROSSED a CLR-type boundary that GP-2's <c>ConnectorObjectConverter</c> documents as lossless (e.g. an
/// <see cref="int"/> becoming a <see cref="long"/>, a <see cref="float"/> becoming a <see cref="double"/>) —
/// <see langword="true"/> for a round-trip comparison (original CLR value vs. what came back through JSON),
/// <see langword="false"/> for a same-process snapshot comparison (a live reading vs. its own clone, where
/// no widening should ever legitimately occur, but the comparison still goes through the same numeric-VALUE
/// path rather than asserting types, for the same reason).</para>
/// </summary>
internal static class DeviceReadingEquality
{
    /// <returns><see langword="null"/> if <paramref name="expected"/> and <paramref name="actual"/> are
    /// equivalent; otherwise a human-readable description of the FIRST field that differs.</returns>
    public static string? Compare(DeviceReading expected, DeviceReading actual, bool allowNumericWidening)
    {
        if (expected.MachineCode != actual.MachineCode) return Mismatch(nameof(DeviceReading.MachineCode), expected.MachineCode, actual.MachineCode);
        if (expected.Kind != actual.Kind) return Mismatch(nameof(DeviceReading.Kind), expected.Kind, actual.Kind);
        if (expected.SerialNumber != actual.SerialNumber) return Mismatch(nameof(DeviceReading.SerialNumber), expected.SerialNumber, actual.SerialNumber);
        if (expected.StepType != actual.StepType) return Mismatch(nameof(DeviceReading.StepType), expected.StepType, actual.StepType);
        if (expected.Verdict != actual.Verdict) return Mismatch(nameof(DeviceReading.Verdict), expected.Verdict, actual.Verdict);
        if (expected.RecipeCode != actual.RecipeCode) return Mismatch(nameof(DeviceReading.RecipeCode), expected.RecipeCode, actual.RecipeCode);
        if (expected.RecipeVersion != actual.RecipeVersion) return Mismatch(nameof(DeviceReading.RecipeVersion), expected.RecipeVersion, actual.RecipeVersion);
        if (expected.CycleCounter != actual.CycleCounter) return Mismatch(nameof(DeviceReading.CycleCounter), expected.CycleCounter, actual.CycleCounter);
        if (!expected.Timestamp.Equals(actual.Timestamp)) return Mismatch(nameof(DeviceReading.Timestamp), expected.Timestamp, actual.Timestamp);

        return CompareList(expected.Metrics, actual.Metrics, nameof(DeviceReading.Metrics), CompareMetric)
            ?? CompareList(expected.Waveforms, actual.Waveforms, nameof(DeviceReading.Waveforms), CompareWaveform)
            ?? CompareList(expected.Measurements, actual.Measurements, nameof(DeviceReading.Measurements), CompareMeasurement)
            ?? CompareList(expected.Telemetry, actual.Telemetry, nameof(DeviceReading.Telemetry), (a, b) => CompareTelemetry(a, b, allowNumericWidening))
            ?? CompareGenealogy(expected.Genealogy, actual.Genealogy, allowNumericWidening)
            ?? ComparePlan(expected.Plan, actual.Plan);
    }

    private static string Mismatch(string field, object? expected, object? actual) =>
        $"{field}: expected <{Describe(expected)}> but got <{Describe(actual)}>";

    private static string Describe(object? v) => v switch
    {
        null => "null",
        string s => $"\"{s}\"",
        _ => v.ToString() ?? "null",
    };

    private static string? CompareList<T>(IReadOnlyList<T> expected, IReadOnlyList<T> actual, string field, Func<T, T, string?> compareItem)
    {
        if (expected.Count != actual.Count)
        {
            return $"{field}: expected {expected.Count} item(s) but got {actual.Count}";
        }

        for (var i = 0; i < expected.Count; i++)
        {
            var itemDiff = compareItem(expected[i], actual[i]);
            if (itemDiff is not null) return $"{field}[{i}].{itemDiff}";
        }

        return null;
    }

    private static string? CompareMetric(MetricSample a, MetricSample b)
    {
        if (a.Name != b.Name) return Mismatch(nameof(MetricSample.Name), a.Name, b.Name);
        if (!ExactDoubleEquals(a.Value, b.Value)) return Mismatch(nameof(MetricSample.Value), a.Value, b.Value);
        if (a.Unit != b.Unit) return Mismatch(nameof(MetricSample.Unit), a.Unit, b.Unit);
        if (!NullableDoubleEquals(a.Lsl, b.Lsl)) return Mismatch(nameof(MetricSample.Lsl), a.Lsl, b.Lsl);
        if (!NullableDoubleEquals(a.Usl, b.Usl)) return Mismatch(nameof(MetricSample.Usl), a.Usl, b.Usl);
        if (!NullableDoubleEquals(a.Nominal, b.Nominal)) return Mismatch(nameof(MetricSample.Nominal), a.Nominal, b.Nominal);
        return null;
    }

    private static string? CompareWaveform(WaveformSeries a, WaveformSeries b)
    {
        if (a.Name != b.Name) return Mismatch(nameof(WaveformSeries.Name), a.Name, b.Name);
        if (a.Unit != b.Unit) return Mismatch(nameof(WaveformSeries.Unit), a.Unit, b.Unit);
        if (!NullableDoubleEquals(a.RateHz, b.RateHz)) return Mismatch(nameof(WaveformSeries.RateHz), a.RateHz, b.RateHz);

        if (a.Samples.Count != b.Samples.Count)
        {
            return $"{nameof(WaveformSeries.Samples)}: expected {a.Samples.Count} series but got {b.Samples.Count}";
        }

        for (var i = 0; i < a.Samples.Count; i++)
        {
            if (!a.Samples[i].SequenceEqual(b.Samples[i])) return $"{nameof(WaveformSeries.Samples)}[{i}]: values differ";
        }

        return null;
    }

    private static string? CompareMeasurement(MeasurementResult a, MeasurementResult b)
    {
        if (a.PointCode != b.PointCode) return Mismatch(nameof(MeasurementResult.PointCode), a.PointCode, b.PointCode);
        if (a.Result != b.Result) return Mismatch(nameof(MeasurementResult.Result), a.Result, b.Result);
        if (!NullableDoubleEquals(a.MeasuredValue, b.MeasuredValue)) return Mismatch(nameof(MeasurementResult.MeasuredValue), a.MeasuredValue, b.MeasuredValue);
        if (a.DefectCatalogCode != b.DefectCatalogCode) return Mismatch(nameof(MeasurementResult.DefectCatalogCode), a.DefectCatalogCode, b.DefectCatalogCode);
        if (a.DefectSeverity != b.DefectSeverity) return Mismatch(nameof(MeasurementResult.DefectSeverity), a.DefectSeverity, b.DefectSeverity);
        if (a.Unit != b.Unit) return Mismatch(nameof(MeasurementResult.Unit), a.Unit, b.Unit);
        if (a.Bbox != b.Bbox) return Mismatch(nameof(MeasurementResult.Bbox), a.Bbox, b.Bbox);
        if (!Values3dEquals(a.Values3d, b.Values3d)) return Mismatch(nameof(MeasurementResult.Values3d), a.Values3d, b.Values3d);
        return null;
    }

    private static bool Values3dEquals(Values3d? a, Values3d? b)
    {
        if (a is null || b is null) return a is null && b is null;
        return NullableDoubleEquals(a.HeightUm, b.HeightUm)
            && NullableDoubleEquals(a.AreaPct, b.AreaPct)
            && NullableDoubleEquals(a.VolumePct, b.VolumePct)
            && NullableDoubleEquals(a.VoidPct, b.VoidPct)
            && NullableDoubleEquals(a.CoplanarityUm, b.CoplanarityUm)
            && NullableDoubleEquals(a.WarpageUm, b.WarpageUm)
            && NullableDoubleEquals(a.OffsetXUm, b.OffsetXUm)
            && NullableDoubleEquals(a.OffsetYUm, b.OffsetYUm)
            && NullableDoubleEquals(a.TiltDeg, b.TiltDeg)
            && NullableDoubleEquals(a.ThicknessUm, b.ThicknessUm)
            && NullableDoubleEquals(a.ZUm, b.ZUm);
    }

    private static string? CompareTelemetry(TelemetrySample a, TelemetrySample b, bool allowNumericWidening)
    {
        if (a.Metric != b.Metric) return Mismatch(nameof(TelemetrySample.Metric), a.Metric, b.Metric);
        if (!ObjectValueEquals(a.Value, b.Value, allowNumericWidening)) return Mismatch(nameof(TelemetrySample.Value), a.Value, b.Value);
        if (a.Unit != b.Unit) return Mismatch(nameof(TelemetrySample.Unit), a.Unit, b.Unit);
        if (a.Quality != b.Quality) return Mismatch(nameof(TelemetrySample.Quality), a.Quality, b.Quality);
        return null;
    }

    private static string? CompareGenealogy(Dictionary<string, object>? expected, Dictionary<string, object>? actual, bool allowNumericWidening)
    {
        if (expected is null || actual is null)
        {
            return (expected is null) == (actual is null) ? null : Mismatch(nameof(DeviceReading.Genealogy), expected, actual);
        }

        if (expected.Count != actual.Count)
        {
            return $"{nameof(DeviceReading.Genealogy)}: expected {expected.Count} key(s) but got {actual.Count}";
        }

        foreach (var (key, value) in expected)
        {
            if (!actual.TryGetValue(key, out var otherValue))
            {
                return $"{nameof(DeviceReading.Genealogy)}[\"{key}\"]: missing after round trip";
            }

            if (!ObjectValueEquals(value, otherValue, allowNumericWidening))
            {
                return Mismatch($"{nameof(DeviceReading.Genealogy)}[\"{key}\"]", value, otherValue);
            }
        }

        return null;
    }

    private static string? ComparePlan(CyclePlan? expected, CyclePlan? actual)
    {
        if (expected is null || actual is null)
        {
            return (expected is null) == (actual is null) ? null : Mismatch(nameof(DeviceReading.Plan), expected, actual);
        }

        if (expected.CycleCounter != actual.CycleCounter) return Mismatch("Plan.CycleCounter", expected.CycleCounter, actual.CycleCounter);
        if (!expected.StartedAt.Equals(actual.StartedAt)) return Mismatch("Plan.StartedAt", expected.StartedAt, actual.StartedAt);
        if (!ExactDoubleEquals(expected.DurationSeconds, actual.DurationSeconds)) return Mismatch("Plan.DurationSeconds", expected.DurationSeconds, actual.DurationSeconds);

        return CompareList(expected.Steps, actual.Steps, "Plan.Steps", CompareStep);
    }

    private static string? CompareStep(CyclePlanStep a, CyclePlanStep b)
    {
        if (a.Index != b.Index) return Mismatch(nameof(CyclePlanStep.Index), a.Index, b.Index);
        if (a.PointCode != b.PointCode) return Mismatch(nameof(CyclePlanStep.PointCode), a.PointCode, b.PointCode);
        if (!ExactDoubleEquals(a.NormalizedX, b.NormalizedX)) return Mismatch(nameof(CyclePlanStep.NormalizedX), a.NormalizedX, b.NormalizedX);
        if (!ExactDoubleEquals(a.NormalizedY, b.NormalizedY)) return Mismatch(nameof(CyclePlanStep.NormalizedY), a.NormalizedY, b.NormalizedY);
        if (a.Result != b.Result) return Mismatch(nameof(CyclePlanStep.Result), a.Result, b.Result);
        if (!NullableDoubleEquals(a.MetricValue, b.MetricValue)) return Mismatch(nameof(CyclePlanStep.MetricValue), a.MetricValue, b.MetricValue);
        if (a.Unit != b.Unit) return Mismatch(nameof(CyclePlanStep.Unit), a.Unit, b.Unit);
        return null;
    }

    private static bool ExactDoubleEquals(double a, double b) => a.Equals(b);

    private static bool NullableDoubleEquals(double? a, double? b) =>
        a is null || b is null ? a is null && b is null : ExactDoubleEquals(a.Value, b.Value);

    /// <summary>Compares the connector wire contract's <c>object?</c> domain (null|bool|string|numeric —
    /// see <c>ConnectorObjectConverter</c>'s own class doc comment) by VALUE, never by CLR type — see this
    /// class's own doc comment for why that distinction is load-bearing here.</summary>
    private static bool ObjectValueEquals(object? a, object? b, bool allowNumericWidening)
    {
        if (a is null || b is null) return a is null && b is null;

        // bool and string are exact-domain members with no widening story at all (decision (a) only ever
        // discusses NUMERIC widening) — either both sides are that exact kind with equal value, or it's a
        // mismatch, full stop.
        if (a is bool || b is bool) return a is bool ba && b is bool bb && ba == bb;
        if (a is string || b is string) return a is string sa && b is string sb && sa == sb;

        // Whatever remains must be one of the numeric primitives the domain accepts. allowNumericWidening
        // doesn't change the COMPARISON here — it only documents, at the call site, whether a type
        // difference between `a` and `b` is expected (round trip) or not (same-process snapshot); either
        // way the right question is "same numeric value", never "same CLR type".
        _ = allowNumericWidening;
        return NumericEquals(a, b);
    }

    private static bool NumericEquals(object a, object b)
    {
        var aIntegral = IsIntegral(a);
        var bIntegral = IsIntegral(b);
        var aFloating = a is float or double;
        var bFloating = b is float or double;

        if (!(aIntegral || aFloating) || !(bIntegral || bFloating))
        {
            return false;
        }

        // Decision (a) (ConnectorObjectConverter): every integral CLR primitive this domain accepts widens
        // losslessly to long, so two integral-shaped values compare via Int64. Anything involving a
        // float/double compares via Double (a float always widens losslessly to double).
        if (aIntegral && bIntegral)
        {
            return Convert.ToInt64(a, CultureInfo.InvariantCulture) == Convert.ToInt64(b, CultureInfo.InvariantCulture);
        }

        return Convert.ToDouble(a, CultureInfo.InvariantCulture) == Convert.ToDouble(b, CultureInfo.InvariantCulture);
    }

    private static bool IsIntegral(object v) => v is sbyte or byte or short or ushort or int or uint or long or ulong;
}
