using System.Globalization;
using St4i.EdgeCore.Models;
using St4i.Connector.Abstractions.Models;

namespace St4i.EdgeCore.Mapping;

/// <summary>
/// Turns a raw <see cref="DeviceReading"/> into a contract-correct <see cref="CanonicalEnvelope"/>
/// matching the live ingest endpoints documented in doc61 (Machine Developer Integration Guide) and
/// implemented by the reference SDK (examples/device-client/csharp/St4iDeviceClient.cs).
/// </summary>
public static class Normalizer
{
    /// <summary>🔴 The process-result ingest route as THIS repository spells it — and no request is ever
    /// sent to it from here. It is stamped onto the envelope, and the live transport then dispatches on
    /// the envelope's kind into a typed SDK call whose URL is a literal inside the vendored SDK; the only
    /// consumer of this value in the product is the operator's API-trace row. Changing it changes what
    /// the trace pane displays and nothing about where the data goes.
    ///
    /// <para>These three are also <see langword="const"/>, so any assembly that referenced one would have
    /// BAKED IN the old text at its own compile time. Nothing outside this assembly does today.</para></summary>
    public const string ProcessResultPath = "/api/v1/ingest/process-result";

    /// <summary>The telemetry ingest route, on the same terms as
    /// <see cref="ProcessResultPath"/>: display-only, never requested from this repository.</summary>
    public const string TelemetryPath = "/api/v1/ingest/telemetry";

    /// <summary>The inspection ingest route, on the same terms as
    /// <see cref="ProcessResultPath"/>: display-only, never requested from this repository.</summary>
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

    /// <summary>
    /// The only producer of a <see cref="CanonicalEnvelope"/> in this product. Dispatches on
    /// <see cref="DeviceReading.Kind"/> to one of three private shapers and throws
    /// <see cref="ArgumentOutOfRangeException"/> for anything else — a reading is never silently dropped
    /// here, and never silently reshaped either.
    ///
    /// <para>It is pure and total for the three known kinds: no I/O, no clock, no randomness, and no
    /// validation. Given the same reading and the same profile it produces the same payload every time,
    /// which is what lets the same envelope be handed to both the HTTP transport and the UNS mirror
    /// without either being able to see a different one. The absence of validation is the deliberate
    /// half: it will happily build an envelope the ecosystem rejects, and finding that out is
    /// <see cref="St4i.EdgeCore.Transport.LiveTransport.SendAsync"/>'s job, not this one's.</para>
    ///
    /// <para>The three shapes are not symmetric and the differences are contract, not omission. Only the
    /// process-result shape consults <paramref name="p"/> for defaults — the other two use it for units
    /// alone. Only the process-result shape forwards genealogy, and it coerces <c>stationId</c> to a
    /// number because the ingest contract rejects it as text. Only the inspection shape recomputes an
    /// overall verdict from its own measurement points instead of trusting the reading's. And only
    /// telemetry carries no idempotency key into its payload, because the endpoint it targets has
    /// none.</para></summary>
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
                    ["samples"] = ToWireSampleRows(w),
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

    /// <summary>
    /// 🔴 <b>Owner decision of 2026-08-19 on <c>docs/owner-decisions.md</c> item 14, option 3: the
    /// <c>[t, v]</c> pair the published ingest contract requires is built HERE, at the boundary, and in no
    /// producer.</b> <see cref="St4i.Connector.Abstractions.Models.WaveformSeries"/>,
    /// <c>WelderSim</c> and <c>ScrewdriveSim</c> are untouched by that decision and stay upstream of this
    /// method; what changes is what LEAVES the process.
    ///
    /// <para><b>WHERE <c>t</c> COMES FROM, AND WHICH OF THE TWO CANDIDATE <c>t</c>s THIS IS.</b> It is the
    /// instant <c>RateHz</c> IMPLIES — <c>t(i) = i / RateHz</c> — and NOT the instant at which any
    /// particular producer drew its curve. Those are not the same number and the difference is measured, so
    /// the choice is stated rather than left to be inferred:
    /// <list type="bullet">
    ///   <item><description><b>Why the implied instant.</b> Everything in scope at this boundary is the four
    ///   fields of a <see cref="St4i.Connector.Abstractions.Models.WaveformSeries"/>. Reconstructing a
    ///   producer's real sample instants needs a fifth thing — the producer's own parameterisation — which
    ///   is not on the record, differs per driver, and is absent entirely for the third-party drivers this
    ///   boundary also serves. <c>t(i) = i / RateHz</c> is the only <c>t</c> the PUBLISHED meaning of
    ///   <c>rateHz</c> licenses (spec 57 §3.3: "sampling frequency (Hz) if uniform"), and it is already the
    ///   reconstruction this repository publishes to consumers on
    ///   <see cref="St4i.Connector.Abstractions.Models.WaveformSeries"/> itself.</description></item>
    ///   <item><description><b>What that costs, stated in the unfavourable direction too.</b>
    ///   <c>WelderSim</c>'s <c>rateHz</c> does not describe its own sample spacing: it emits
    ///   <c>N / duration</c> while drawing sample <c>i</c> at <c>i / (N - 1)</c> of the duration, so a
    ///   reconstructed axis is short by <c>1/N</c> (4.17% at its 24 points, one sampling period at the last
    ///   sample). This method neither creates that skew nor repairs it — it computes exactly the <c>t</c> a
    ///   contract-following consumer computes today from the same <c>rateHz</c>. It does, however, move that
    ///   <c>t</c> from IMPLICIT to WRITTEN DOWN, which is a real change in what is published and is recorded
    ///   as one in item 14. Fixing the skew means deciding what <c>rateHz</c> MEANS, which is a payload
    ///   change no ruling covers.</description></item>
    /// </list></para>
    ///
    /// <para><b>WHAT IS AND IS NOT CONVERTED, and the row-length condition is load-bearing rather than
    /// defensive.</b> A row is paired only when it holds EXACTLY ONE element and the series carries a
    /// finite, positive <c>RateHz</c>. A two-element row is ALREADY a <c>[t, v]</c> pair — spec 57 §8.1's
    /// own canonical example carries <c>rateHz: 500</c> beside pair rows — so converting on <c>RateHz</c>
    /// alone would destroy that data by pairing an abscissa that is already there. A one-element row with no
    /// usable rate is passed through untouched: there is no time base to derive one from, and inventing an
    /// index-as-time would publish a number with no unit. Rows are returned as
    /// <see langword="double"/><c>[]</c> because <c>LiveTransport.ReadSampleSeries</c> accepts a row if and
    /// only if it is one and drops anything else with no exception and no log.</para>
    /// </summary>
    private static IReadOnlyList<double[]> ToWireSampleRows(WaveformSeries w)
    {
        if (w.RateHz is not { } rate || !double.IsFinite(rate) || rate <= 0) return w.Samples;

        var anyScalarRow = false;
        for (var i = 0; i < w.Samples.Count && !anyScalarRow; i++) anyScalarRow = w.Samples[i].Length == 1;
        if (!anyScalarRow) return w.Samples;

        var rows = new List<double[]>(w.Samples.Count);
        for (var i = 0; i < w.Samples.Count; i++)
        {
            var row = w.Samples[i];
            rows.Add(row.Length == 1 ? new[] { i / rate, row[0] } : row);
        }

        return rows;
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
