using System.Globalization;
using System.Text;
using System.Text.Json;
using St4i.EdgeCore.Models;

namespace St4i.EdgeCore.Drivers.HotFolder;

/// <summary>
/// The other half of the doc-28 closed loop (Task 11): serializes a <see cref="DeviceReading"/>
/// (Kind == Inspection) into a doc-28 JSON document and writes it into a hot-folder using the
/// mandatory atomic-write protocol (docs/ECOSYSTEM/28_ST4I_STANDARD_INSPECTION_FEED_SPEC.md §6.3):
/// write the full content to a sibling "*.tmp" file, flush + close, then <see cref="File.Move"/> it
/// to the final name — rename is atomic on the same volume, so the hot-folder watcher (see
/// <see cref="HotFolderAoiDriver"/>) never observes a partially-written result file.
///
/// This exists to let a simulated AOI machine (or any test) act as a REAL doc-28 producer: its
/// output is byte-for-byte the same kind of file a real machine builder's exporter would drop, and
/// is guaranteed to round-trip cleanly through <see cref="Doc28Parser.Parse"/>.
/// </summary>
public class Doc28Writer
{
    private static readonly JsonSerializerOptions JsonOptions = new() { WriteIndented = false };

    /// <summary>
    /// Serializes <paramref name="inspection"/> to a doc-28 JSON document and atomically writes it
    /// into <paramref name="dir"/>. Returns the final (non-.tmp) path.
    /// </summary>
    public string WriteAtomic(string dir, DeviceReading inspection)
    {
        if (dir is null) throw new ArgumentNullException(nameof(dir));
        if (inspection is null) throw new ArgumentNullException(nameof(inspection));

        Directory.CreateDirectory(dir);

        // §6.1: <machine_code>__<serial_number>__<finished_at compact>.st4i.json — machine_code and
        // serial_number MUST NOT contain "__" (spec constraint on the caller, not re-validated here).
        var machineCode = string.IsNullOrWhiteSpace(inspection.MachineCode) ? "UNKNOWN-MACHINE" : inspection.MachineCode;
        var serialNumber = string.IsNullOrWhiteSpace(inspection.SerialNumber) ? "UNKNOWN-SERIAL" : inspection.SerialNumber;
        var compactTs = FormatCompactTimestamp(inspection.Timestamp);

        var finalPath = Path.Combine(dir, $"{machineCode}__{serialNumber}__{compactTs}.st4i.json");
        var tmpPath = finalPath + ".tmp";

        var json = BuildJson(inspection, machineCode, serialNumber);

        // Step 1 (§6.3): write the COMPLETE file as "<final-name>.tmp" on the same folder/volume.
        using (var stream = new FileStream(tmpPath, FileMode.Create, FileAccess.Write, FileShare.None))
        using (var writer = new StreamWriter(stream, new UTF8Encoding(encoderShouldEmitUTF8Identifier: false)))
        {
            writer.Write(json);
            writer.Flush();
            // Step 2: flush + close before rename — StreamWriter/FileStream Dispose does this; force
            // an OS-level flush too so the bytes are durable before the rename that signals "done".
            stream.Flush(flushToDisk: true);
        }

        // Step 2 (cont'd): rename — atomic on the same volume. overwrite:true guards against a
        // same-second re-write of an identical machine/serial/timestamp triple colliding on retry.
        File.Move(tmpPath, finalPath, overwrite: true);

        return finalPath;
    }

    /// <summary>doc28 §6.1: `yyyyMMddTHHmmss±hhmm` with ':' removed (Windows-safe), e.g. `20260704T083012+0700`.</summary>
    private static string FormatCompactTimestamp(DateTimeOffset ts) =>
        ts.ToString("yyyyMMddTHHmmsszzz", CultureInfo.InvariantCulture).Replace(":", "", StringComparison.Ordinal);

    /// <summary>RFC 3339 with an explicit offset — required by every doc28 timestamp field (§2, §8 rule 3).</summary>
    private static string FormatTimestamp(DateTimeOffset ts) => ts.ToString("o", CultureInfo.InvariantCulture);

    private static string BuildJson(DeviceReading r, string machineCode, string serialNumber)
    {
        // DeviceReading only carries one instant (Timestamp == doc28 finished_at per Doc28Parser's
        // own mapping — see BuildReading). Without a separately-tracked "started at", started_at is
        // set equal to finished_at: doc28 §8 rule 3 requires finished_at >= started_at, and equality
        // satisfies that while staying honest (we don't fabricate a fake inspection duration).
        var finishedAt = r.Timestamp;
        var startedAt = r.Timestamp;

        var measurementDocs = r.Measurements.Select(BuildMeasurement).ToList();

        // doc28 §8 rule 5: header.result == OK forbids any NG measurement. Normalize defensively so
        // Doc28Writer output ALWAYS round-trips even if a caller's Verdict/Measurements ever drift
        // out of sync (the reference producer, AoiInspectorSim, keeps them in sync, but this keeps
        // the writer's contract — "output is always Doc28Parser.Parse-able" — unconditional).
        var headerResult = MapVerdict(r.Verdict);
        if (headerResult == "OK" && measurementDocs.Any(m => (string)m["result"]! == "NG"))
            headerResult = "NG";

        var header = new Dictionary<string, object?>
        {
            ["machine_code"] = machineCode,
            ["serial_number"] = serialNumber,
            ["program_name"] = string.IsNullOrWhiteSpace(r.RecipeCode) ? "UNSPECIFIED" : r.RecipeCode,
            ["started_at"] = FormatTimestamp(startedAt),
            ["finished_at"] = FormatTimestamp(finishedAt),
            ["result"] = headerResult,
        };
        AddIfNotNull(header, "program_version", r.RecipeVersion);

        // doc28 §9 reverse mapping — Doc28Parser stashes lot_code/panel_id/board_index/operator_id/
        // cycle_time_sec into Genealogy under these exact keys; write them back if present so a
        // reading that WAS produced by parsing a doc28 file (or hand-built with the same keys)
        // round-trips those optional fields too, not just the required ones.
        if (r.Genealogy is { } g)
        {
            if (g.TryGetValue("lotCode", out var lot)) AddIfNotNull(header, "lot_code", lot as string);
            if (g.TryGetValue("panelId", out var panel)) AddIfNotNull(header, "panel_id", panel as string);
            if (g.TryGetValue("operatorId", out var op)) AddIfNotNull(header, "operator_id", op as string);
            if (g.TryGetValue("boardIndex", out var bi) && bi is int biVal) header["board_index"] = biVal;
            if (g.TryGetValue("cycleTimeSec", out var cts) && cts is double ctsVal) header["cycle_time_sec"] = ctsVal;
        }

        var root = new Dictionary<string, object?>
        {
            ["spec_version"] = 1,
            ["header"] = header,
            ["measurements"] = measurementDocs,
        };

        return JsonSerializer.Serialize(root, JsonOptions);
    }

    private static Dictionary<string, object?> BuildMeasurement(MeasurementResult m)
    {
        var doc = new Dictionary<string, object?>
        {
            ["point_name"] = m.PointCode,
            ["result"] = NormalizeResultToken(m.Result),
        };
        AddIfNotNull(doc, "unit", m.Unit);
        AddIfNotNull(doc, "defect_code", m.DefectCatalogCode);
        AddIfNotNull(doc, "severity", m.DefectSeverity);
        if (m.MeasuredValue is { } v && double.IsFinite(v)) doc["value"] = v;

        if (m.Bbox is { } b)
        {
            doc["bbox_px"] = new Dictionary<string, object?> { ["x"] = b.X, ["y"] = b.Y, ["w"] = b.W, ["h"] = b.H };
        }

        if (m.Values3d is { } v3)
        {
            var v3doc = new Dictionary<string, object?>();
            AddIfNotNull(v3doc, "height_um", v3.HeightUm);
            AddIfNotNull(v3doc, "area_pct", v3.AreaPct);
            AddIfNotNull(v3doc, "volume_pct", v3.VolumePct);
            AddIfNotNull(v3doc, "void_pct", v3.VoidPct);
            AddIfNotNull(v3doc, "coplanarity_um", v3.CoplanarityUm);
            AddIfNotNull(v3doc, "warpage_um", v3.WarpageUm);
            AddIfNotNull(v3doc, "offset_x_um", v3.OffsetXUm);
            AddIfNotNull(v3doc, "offset_y_um", v3.OffsetYUm);
            AddIfNotNull(v3doc, "tilt_deg", v3.TiltDeg);
            AddIfNotNull(v3doc, "thickness_um", v3.ThicknessUm);
            AddIfNotNull(v3doc, "z_um", v3.ZUm);
            if (v3doc.Count > 0) doc["values_3d"] = v3doc;
        }

        return doc;
    }

    /// <summary>
    /// <see cref="MeasurementResult.Result"/> is a free-form string on the shared model (not an
    /// enum), but doc28 requires exactly OK|NG|NTF (uppercase). Trust well-formed input (every
    /// in-repo producer — the simulators, Doc28Parser itself — already emits one of the three
    /// tokens); anything else falls back to NTF rather than silently claiming a false OK or NG, so
    /// Doc28Writer's output never fails Doc28Parser's own token check.
    /// </summary>
    private static string NormalizeResultToken(string? result)
    {
        var token = result?.Trim().ToUpperInvariant();
        return token is "OK" or "NG" or "NTF" ? token : "NTF";
    }

    private static string MapVerdict(Verdict v) => v switch
    {
        Verdict.Pass => "OK",
        Verdict.Fail => "NG",
        Verdict.Skip => "NTF",
        Verdict.Warn => "NTF", // doc28 has no "warn" token; NTF ("flagged, judged not a true defect") is the closest fit.
        _ => "NTF",
    };

    private static void AddIfNotNull(Dictionary<string, object?> doc, string key, object? value)
    {
        if (value is null) return;
        if (value is string s && s.Length == 0) return;
        doc[key] = value;
    }
}
