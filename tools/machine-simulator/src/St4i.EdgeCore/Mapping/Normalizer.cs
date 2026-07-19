using System.Globalization;
using St4i.EdgeCore.Models;

namespace St4i.EdgeCore.Mapping;

/// <summary>
/// Turns a raw <see cref="DeviceReading"/> into a contract-correct <see cref="CanonicalEnvelope"/>
/// matching the live ingest endpoints documented in doc61 (Machine Developer Integration Guide) and
/// implemented by the reference SDK (examples/device-client/csharp/St4iDeviceClient.cs).
/// </summary>
public static class Normalizer
{
    public const string ProcessResultPath = "/api/v1/ingest/process-result";
    public const string TelemetryPath = "/api/v1/ingest/telemetry";
    public const string InspectionPath = "/api/v1/ingest/inspection";

    private const string ProcessSchemaVersion = "1.0";
    private const string InspectionSchemaVersion = "1.1";

    /// <summary>
    /// Stable idempotency key: "{machineCode}:{recipeCode ?? stepType ?? "cycle"}:{cycleCounter:D6}".
    /// Always >= 8 chars given a non-empty machine code (":cycle:" + 6-digit counter alone is 13 chars).
    /// For Inspection readings, CycleCounter is always 0 (doc-28 files carry no cycle counter), so the
    /// SerialNumber is included to keep the key unique per board — otherwise two different boards
    /// inspected on the same machine+program would collide and the server's (machineId, idempotencyKey)
    /// dedup would silently drop the second board, destroying per-serial traceability/FPY.
    /// </summary>
    public static string BuildIdempotencyKey(DeviceReading r)
    {
        if (r.Kind == ReadingKind.Inspection)
        {
            var insBucket = r.RecipeCode ?? "insp";
            return $"{r.MachineCode}:{insBucket}:{r.SerialNumber}:{r.CycleCounter:D6}";
        }

        var bucket = r.RecipeCode ?? r.StepType ?? "cycle";
        return $"{r.MachineCode}:{bucket}:{r.CycleCounter:D6}";
    }

    public static CanonicalEnvelope Normalize(DeviceReading r, MappingProfile p)
    {
        return r.Kind switch
        {
            ReadingKind.ProcessResult => NormalizeProcessResult(r, p),
            ReadingKind.Telemetry => NormalizeTelemetry(r, p),
            ReadingKind.Inspection => NormalizeInspection(r, p),
            _ => throw new ArgumentOutOfRangeException(nameof(r), r.Kind, "Unknown ReadingKind"),
        };
    }

    // ─────────────────────────────────────────────────────────────────────
    // RESULT — POST /api/v1/ingest/process-result
    // ─────────────────────────────────────────────────────────────────────
    private static CanonicalEnvelope NormalizeProcessResult(DeviceReading r, MappingProfile p)
    {
        var key = BuildIdempotencyKey(r);
        var stepType = r.StepType ?? p.DefaultStepType ?? "process";
        var recipeCode = r.RecipeCode ?? p.DefaultRecipeCode;

        var metrics = r.Metrics
            .Select(m => (object)new Dictionary<string, object?>
            {
                ["name"] = m.Name,
                ["value"] = m.Value, // MetricSample.Value is already a numeric double — never a string
                ["unit"] = MapUnit(p, m.Unit),
                ["lsl"] = m.Lsl,
                ["usl"] = m.Usl,
                ["nominal"] = m.Nominal,
            })
            .ToList();

        var payload = new Dictionary<string, object>
        {
            ["schemaVersion"] = ProcessSchemaVersion,
            ["machineCode"] = r.MachineCode,
            ["serialNumber"] = r.SerialNumber,
            ["stepType"] = stepType,
            ["result"] = VerdictToResult(r.Verdict),
            ["ts"] = FormatTs(r.Timestamp),
            ["idempotencyKey"] = key,
            ["metrics"] = metrics,
        };

        if (!string.IsNullOrEmpty(recipeCode))
        {
            payload["recipe"] = new Dictionary<string, object?>
            {
                ["code"] = recipeCode,
                ["version"] = r.RecipeVersion,
            };
        }

        if (r.Waveforms.Count > 0)
        {
            payload["waveforms"] = r.Waveforms
                .Select(w => (object)new Dictionary<string, object?>
                {
                    ["name"] = w.Name,
                    ["unit"] = MapUnit(p, w.Unit),
                    ["rateHz"] = w.RateHz,
                    ["samples"] = w.Samples,
                })
                .ToList();
        }

        if (r.Genealogy is { Count: > 0 })
        {
            foreach (var kv in r.Genealogy)
            {
                // stationId travels through many hot-folder/CSV drivers as text; the ingest contract
                // requires it as a number (doc61 GOTCHA: stationId phải SỐ, chuỗi -> 400).
                payload[kv.Key] = string.Equals(kv.Key, "stationId", StringComparison.OrdinalIgnoreCase)
                    ? CoerceToNumber(kv.Value)
                    : kv.Value;
            }
        }

        return new CanonicalEnvelope(ReadingKind.ProcessResult, r.MachineCode, ProcessResultPath, payload, key);
    }

    // ─────────────────────────────────────────────────────────────────────
    // TELEMETRY — POST /api/v1/ingest/telemetry
    // ─────────────────────────────────────────────────────────────────────
    private static CanonicalEnvelope NormalizeTelemetry(DeviceReading r, MappingProfile p)
    {
        var key = BuildIdempotencyKey(r);
        var ts = FormatTs(r.Timestamp);

        var samples = r.Telemetry
            .Select(t => (object)new Dictionary<string, object?>
            {
                ["deviceId"] = r.MachineCode,
                ["metric"] = t.Metric,
                ["value"] = t.Value,
                ["unit"] = MapUnit(p, t.Unit),
                ["quality"] = t.Quality,
                ["ts"] = ts,
            })
            .ToList();

        var payload = new Dictionary<string, object> { ["samples"] = samples };

        return new CanonicalEnvelope(ReadingKind.Telemetry, r.MachineCode, TelemetryPath, payload, key);
    }

    // ─────────────────────────────────────────────────────────────────────
    // INSPECTION — POST /api/v1/ingest/inspection (AOI/AVI, doc61 §5 / doc28 v1.1)
    // ─────────────────────────────────────────────────────────────────────
    private static CanonicalEnvelope NormalizeInspection(DeviceReading r, MappingProfile p)
    {
        var key = BuildIdempotencyKey(r);
        var ts = FormatTs(r.Timestamp);

        var measurements = r.Measurements
            .Select(m => (object)new Dictionary<string, object?>
            {
                ["pointCode"] = m.PointCode,
                ["result"] = (m.Result ?? "").Trim().ToUpperInvariant(),
                ["measuredValue"] = m.MeasuredValue,
                ["unit"] = MapUnit(p, m.Unit),
                ["defectCatalogCode"] = m.DefectCatalogCode,
                ["defectSeverity"] = m.DefectSeverity,
                ["valueHeight"] = m.Values3d?.HeightUm,
                ["valueArea"] = m.Values3d?.AreaPct,
                ["valueVolume"] = m.Values3d?.VolumePct,
                ["valueVoidPct"] = m.Values3d?.VoidPct,
                ["valueCoplanarity"] = m.Values3d?.CoplanarityUm,
                ["valueWarpage"] = m.Values3d?.WarpageUm,
                ["valueOffsetX"] = m.Values3d?.OffsetXUm,
                ["valueOffsetY"] = m.Values3d?.OffsetYUm,
                ["valueTilt"] = m.Values3d?.TiltDeg,
                ["valueThickness"] = m.Values3d?.ThicknessUm,
                ["valueZ"] = m.Values3d?.ZUm,
            })
            .ToList();

        var payload = new Dictionary<string, object>
        {
            ["schemaVersion"] = InspectionSchemaVersion,
            ["machineCode"] = r.MachineCode,
            ["serialNumber"] = r.SerialNumber,
            ["overallResult"] = ComputeOverallResult(r).ToUpperInvariant(),
            ["inspectionTime"] = ts,
            ["idempotencyKey"] = key,
            ["measurements"] = measurements,
        };

        return new CanonicalEnvelope(ReadingKind.Inspection, r.MachineCode, InspectionPath, payload, key);
    }

    /// <summary>
    /// Aggregates point-level results (worst-wins: NG > NTF > OK) when measurements are present;
    /// falls back to the reading's coarse Verdict otherwise. Contract requires OK|NG|NTF (uppercase).
    /// </summary>
    private static string ComputeOverallResult(DeviceReading r)
    {
        if (r.Measurements.Count > 0)
        {
            var results = r.Measurements.Select(m => (m.Result ?? "").Trim().ToUpperInvariant()).ToList();
            if (results.Any(x => x == "NG")) return "NG";
            if (results.Any(x => x == "NTF")) return "NTF";
            return "OK";
        }

        return r.Verdict switch
        {
            Verdict.Fail => "NG",
            Verdict.Skip => "NTF",
            _ => "OK", // Pass, Warn
        };
    }

    private static string VerdictToResult(Verdict v) => v switch
    {
        Verdict.Pass => "pass",
        Verdict.Warn => "warn",
        Verdict.Fail => "fail",
        Verdict.Skip => "skip",
        _ => "skip",
    };

    private static string FormatTs(DateTimeOffset ts) =>
        ts.ToString("yyyy-MM-dd'T'HH:mm:ss.fffzzz", CultureInfo.InvariantCulture);

    private static string? MapUnit(MappingProfile p, string? unit)
    {
        if (unit == null) return null;
        return p.UnitMap.TryGetValue(unit, out var mapped) ? mapped : unit;
    }

    /// <summary>Coerces a genealogy value (often text from CSV/hot-folder drivers) into a numeric type.</summary>
    private static object CoerceToNumber(object? value)
    {
        switch (value)
        {
            case null:
                return 0d;
            case double or float or int or long or short or decimal:
                return value;
            case string s when double.TryParse(s, NumberStyles.Float, CultureInfo.InvariantCulture, out var parsed):
                return parsed;
            default:
                return value is IConvertible conv &&
                       double.TryParse(Convert.ToString(conv, CultureInfo.InvariantCulture), NumberStyles.Float, CultureInfo.InvariantCulture, out var fallback)
                    ? fallback
                    : value!;
        }
    }
}
