using System.Globalization;
using System.Text.Json;
using System.Text.RegularExpressions;
using System.Xml;
using System.Xml.Linq;
using St4i.EdgeCore.Models;

namespace St4i.EdgeCore.Drivers.HotFolder;

/// <summary>
/// Thrown whenever a doc-28 (ST4I Standard Inspection Feed) document fails any rule in
/// docs/ECOSYSTEM/28_ST4I_STANDARD_INSPECTION_FEED_SPEC.md §8. Malformed documents are rejected
/// as a whole (no partial ingest) — the hot-folder watcher moves the offending file to `error/`.
/// </summary>
public class Doc28ValidationException : Exception
{
    public Doc28ValidationException(string message) : base(message) { }

    public Doc28ValidationException(string message, Exception innerException) : base(message, innerException) { }
}

/// <summary>
/// Parses ST4I Standard Inspection Feed (doc 28) documents — JSON, CSV or XML, auto-detected from
/// content — into a <see cref="DeviceReading"/>, enforcing every rule in doc28 §8. This is the
/// format-parsing heart of the hot-folder AOI proof driver (Task 11 consumes <see cref="Parse"/>).
/// </summary>
public static class Doc28Parser
{
    private static readonly Regex TimestampRegex =
        new(@"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$", RegexOptions.Compiled);

    private static readonly Regex TypeRegex = new(@"^[a-z][a-z0-9_]*$", RegexOptions.Compiled);

    private static readonly HashSet<string> ResultTokens = new(StringComparer.Ordinal) { "OK", "NG", "NTF" };

    private static readonly HashSet<string> SeverityTokens =
        new(StringComparer.Ordinal) { "critical", "major", "minor", "cosmetic" };

    /// <summary>
    /// Auto-detects the encoding from <paramref name="content"/> (JSON starts with '{', CSV starts
    /// with the '#ST4I-INSPECTION' magic line, XML starts with '&lt;') and parses + validates it
    /// per doc28 §8, throwing <see cref="Doc28ValidationException"/> on any rule violation.
    /// </summary>
    public static DeviceReading Parse(string content, string fileName)
    {
        if (content is null)
            throw new Doc28ValidationException($"'{fileName}': content is null");

        const char bom = '﻿';
        var trimmed = content.TrimStart(bom, ' ', '\t', '\r', '\n');
        if (trimmed.Length == 0)
            throw new Doc28ValidationException($"'{fileName}': content is empty");

        if (trimmed[0] == '{')
            return ParseJson(trimmed, fileName);
        if (trimmed.StartsWith("#ST4I-INSPECTION", StringComparison.Ordinal))
            return ParseCsv(trimmed, fileName);
        if (trimmed[0] == '<')
            return ParseXml(trimmed, fileName);

        throw new Doc28ValidationException(
            $"'{fileName}': cannot detect doc28 format — content must start with '{{' (JSON), " +
            "'#ST4I-INSPECTION' (CSV) or '<' (XML)");
    }

    // ─────────────────────────────────────────────────────────────────────
    // Shared intermediate representation (populated by each encoding, then
    // validated + mapped to DeviceReading by BuildReading — doc28 §8).
    // ─────────────────────────────────────────────────────────────────────
    private sealed class RawHeader
    {
        public string? MachineCode;
        public string? SerialNumber;
        public string? ProgramName;
        public string? ProgramVersion;
        public string? LotCode;
        public string? PanelId;
        public int? BoardIndex;
        public string? OperatorId;
        public string? StartedAt;
        public string? FinishedAt;
        public double? CycleTimeSec;
        public string? Result;
    }

    private sealed class RawMeasurement
    {
        public string? PointName;
        public string? Type;
        public double? Value;
        public string? Unit;
        public double? Lsl;
        public double? Usl;
        public double? Nominal;
        public string? Result;
        public string? DefectCode;
        public string? Severity;
        public int? BboxX;
        public int? BboxY;
        public int? BboxW;
        public int? BboxH;
        public string? ImageRef;
        public string? Remark;
        public Values3d? Values3d;
    }

    // ─────────────────────────────────────────────────────────────────────
    // JSON (§4.1)
    // ─────────────────────────────────────────────────────────────────────
    private static DeviceReading ParseJson(string content, string fileName)
    {
        JsonDocument doc;
        try
        {
            doc = JsonDocument.Parse(content);
        }
        catch (JsonException ex)
        {
            throw new Doc28ValidationException($"'{fileName}': invalid JSON — {ex.Message}", ex);
        }

        using (doc)
        {
            var root = doc.RootElement;
            var specVersion = ReadJsonSpecVersion(root);

            if (!root.TryGetProperty("header", out var headerEl) || headerEl.ValueKind != JsonValueKind.Object)
                throw new Doc28ValidationException($"'{fileName}': missing 'header' object");

            var header = new RawHeader
            {
                MachineCode = GetJsonString(headerEl, "machine_code"),
                SerialNumber = GetJsonString(headerEl, "serial_number"),
                ProgramName = GetJsonString(headerEl, "program_name"),
                ProgramVersion = GetJsonString(headerEl, "program_version"),
                LotCode = GetJsonString(headerEl, "lot_code"),
                PanelId = GetJsonString(headerEl, "panel_id"),
                BoardIndex = GetJsonInt(headerEl, "board_index"),
                OperatorId = GetJsonString(headerEl, "operator_id"),
                StartedAt = GetJsonString(headerEl, "started_at"),
                FinishedAt = GetJsonString(headerEl, "finished_at"),
                CycleTimeSec = GetJsonDouble(headerEl, "cycle_time_sec"),
                Result = GetJsonString(headerEl, "result"),
            };

            var measurements = new List<RawMeasurement>();
            if (root.TryGetProperty("measurements", out var arr) && arr.ValueKind == JsonValueKind.Array)
            {
                foreach (var m in arr.EnumerateArray())
                {
                    var rm = new RawMeasurement
                    {
                        PointName = GetJsonString(m, "point_name"),
                        Type = GetJsonString(m, "type"),
                        Value = GetJsonDouble(m, "value"),
                        Unit = GetJsonString(m, "unit"),
                        Lsl = GetJsonDouble(m, "lsl"),
                        Usl = GetJsonDouble(m, "usl"),
                        Nominal = GetJsonDouble(m, "nominal"),
                        Result = GetJsonString(m, "result"),
                        DefectCode = GetJsonString(m, "defect_code"),
                        Severity = GetJsonString(m, "severity"),
                        ImageRef = GetJsonString(m, "image_ref"),
                        Remark = GetJsonString(m, "remark"),
                    };

                    if (m.TryGetProperty("bbox_px", out var bbox) && bbox.ValueKind == JsonValueKind.Object)
                    {
                        rm.BboxX = GetJsonInt(bbox, "x");
                        rm.BboxY = GetJsonInt(bbox, "y");
                        rm.BboxW = GetJsonInt(bbox, "w");
                        rm.BboxH = GetJsonInt(bbox, "h");
                    }

                    if (m.TryGetProperty("values_3d", out var v3) && v3.ValueKind == JsonValueKind.Object)
                    {
                        rm.Values3d = new Values3d(
                            HeightUm: GetJsonDouble(v3, "height_um"),
                            AreaPct: GetJsonDouble(v3, "area_pct"),
                            VolumePct: GetJsonDouble(v3, "volume_pct"),
                            VoidPct: GetJsonDouble(v3, "void_pct"),
                            CoplanarityUm: GetJsonDouble(v3, "coplanarity_um"),
                            WarpageUm: GetJsonDouble(v3, "warpage_um"),
                            OffsetXUm: GetJsonDouble(v3, "offset_x_um"),
                            OffsetYUm: GetJsonDouble(v3, "offset_y_um"),
                            TiltDeg: GetJsonDouble(v3, "tilt_deg"),
                            ThicknessUm: GetJsonDouble(v3, "thickness_um"),
                            ZUm: GetJsonDouble(v3, "z_um"));
                    }

                    measurements.Add(rm);
                }
            }

            return BuildReading(specVersion, header, measurements, fileName);
        }
    }

    private static int? ReadJsonSpecVersion(JsonElement root)
    {
        if (!root.TryGetProperty("spec_version", out var v)) return null;
        return v.ValueKind switch
        {
            JsonValueKind.Number when v.TryGetInt32(out var i) => i,
            JsonValueKind.String when int.TryParse(v.GetString(), NumberStyles.Integer, CultureInfo.InvariantCulture, out var i) => i,
            _ => (int?)null,
        };
    }

    private static string? GetJsonString(JsonElement obj, string name)
    {
        if (!obj.TryGetProperty(name, out var v)) return null;
        return v.ValueKind switch
        {
            JsonValueKind.String => v.GetString(),
            JsonValueKind.Null => null,
            _ => throw new Doc28ValidationException($"field '{name}' must be a JSON string (got {v.ValueKind})"),
        };
    }

    private static int? GetJsonInt(JsonElement obj, string name)
    {
        if (!obj.TryGetProperty(name, out var v)) return null;
        if (v.ValueKind == JsonValueKind.Null) return null;
        if (v.ValueKind == JsonValueKind.Number && v.TryGetInt32(out var i)) return i;
        throw new Doc28ValidationException($"field '{name}' must be a JSON integer (got {v.ValueKind})");
    }

    private static double? GetJsonDouble(JsonElement obj, string name)
    {
        if (!obj.TryGetProperty(name, out var v)) return null;
        if (v.ValueKind == JsonValueKind.Null) return null;
        if (v.ValueKind == JsonValueKind.Number) return v.GetDouble();
        throw new Doc28ValidationException($"field '{name}' must be a JSON number (got {v.ValueKind})");
    }

    // ─────────────────────────────────────────────────────────────────────
    // XML (§4.3) — XXE-hardened: DtdProcessing.Prohibit + no XmlResolver means
    // any DOCTYPE (whether or not it declares external entities) throws.
    // ─────────────────────────────────────────────────────────────────────
    private static DeviceReading ParseXml(string content, string fileName)
    {
        var settings = new XmlReaderSettings
        {
            DtdProcessing = DtdProcessing.Prohibit,
            XmlResolver = null,
        };

        XDocument xdoc;
        try
        {
            using var sr = new StringReader(content);
            using var xr = XmlReader.Create(sr, settings);
            xdoc = XDocument.Load(xr);
        }
        catch (XmlException ex)
        {
            throw new Doc28ValidationException(
                $"'{fileName}': invalid or disallowed XML (DOCTYPE/DTD is rejected — XXE hardening) — {ex.Message}", ex);
        }

        var root = xdoc.Root;
        if (root == null || root.Name.LocalName != "st4i_inspection")
            throw new Doc28ValidationException($"'{fileName}': XML root element must be <st4i_inspection>");

        var specVersion = ParseIntOrNull(root.Element("spec_version")?.Value);

        var headerEl = root.Element("header");
        var header = new RawHeader
        {
            MachineCode = XmlChild(headerEl, "machine_code"),
            SerialNumber = XmlChild(headerEl, "serial_number"),
            ProgramName = XmlChild(headerEl, "program_name"),
            ProgramVersion = XmlChild(headerEl, "program_version"),
            LotCode = XmlChild(headerEl, "lot_code"),
            PanelId = XmlChild(headerEl, "panel_id"),
            BoardIndex = XmlChildInt(headerEl, "board_index"),
            OperatorId = XmlChild(headerEl, "operator_id"),
            StartedAt = XmlChild(headerEl, "started_at"),
            FinishedAt = XmlChild(headerEl, "finished_at"),
            CycleTimeSec = XmlChildDouble(headerEl, "cycle_time_sec"),
            Result = XmlChild(headerEl, "result"),
        };

        var measurements = new List<RawMeasurement>();
        var measurementsEl = root.Element("measurements");
        if (measurementsEl != null)
        {
            foreach (var me in measurementsEl.Elements("measurement"))
            {
                var rm = new RawMeasurement
                {
                    PointName = XmlChild(me, "point_name"),
                    Type = XmlChild(me, "type"),
                    Value = XmlChildDouble(me, "value"),
                    Unit = XmlChild(me, "unit"),
                    Lsl = XmlChildDouble(me, "lsl"),
                    Usl = XmlChildDouble(me, "usl"),
                    Nominal = XmlChildDouble(me, "nominal"),
                    Result = XmlChild(me, "result"),
                    DefectCode = XmlChild(me, "defect_code"),
                    Severity = XmlChild(me, "severity"),
                    ImageRef = XmlChild(me, "image_ref"),
                    Remark = XmlChild(me, "remark"),
                };

                var bboxEl = me.Element("bbox_px");
                if (bboxEl != null)
                {
                    rm.BboxX = XmlChildInt(bboxEl, "x");
                    rm.BboxY = XmlChildInt(bboxEl, "y");
                    rm.BboxW = XmlChildInt(bboxEl, "w");
                    rm.BboxH = XmlChildInt(bboxEl, "h");
                }

                var v3El = me.Element("values_3d");
                if (v3El != null)
                {
                    rm.Values3d = new Values3d(
                        HeightUm: XmlChildDouble(v3El, "height_um"),
                        AreaPct: XmlChildDouble(v3El, "area_pct"),
                        VolumePct: XmlChildDouble(v3El, "volume_pct"),
                        VoidPct: XmlChildDouble(v3El, "void_pct"),
                        CoplanarityUm: XmlChildDouble(v3El, "coplanarity_um"),
                        WarpageUm: XmlChildDouble(v3El, "warpage_um"),
                        OffsetXUm: XmlChildDouble(v3El, "offset_x_um"),
                        OffsetYUm: XmlChildDouble(v3El, "offset_y_um"),
                        TiltDeg: XmlChildDouble(v3El, "tilt_deg"),
                        ThicknessUm: XmlChildDouble(v3El, "thickness_um"),
                        ZUm: XmlChildDouble(v3El, "z_um"));
                }

                measurements.Add(rm);
            }
        }

        return BuildReading(specVersion, header, measurements, fileName);
    }

    private static string? XmlChild(XElement? parent, string name) => parent?.Element(name)?.Value;

    private static int? XmlChildInt(XElement? parent, string name) =>
        ParseIntOrNull(XmlChild(parent, name), $"'{name}'");

    private static double? XmlChildDouble(XElement? parent, string name) =>
        ParseDoubleOrNull(XmlChild(parent, name), $"'{name}'");

    private static int? ParseIntOrNull(string? s, string? field = null)
    {
        if (string.IsNullOrWhiteSpace(s)) return null;
        if (int.TryParse(s, NumberStyles.Integer, CultureInfo.InvariantCulture, out var i)) return i;
        if (field == null) return null; // spec_version: unparsable -> treated as missing/unsupported downstream
        throw new Doc28ValidationException($"field {field} must be an integer (got '{s}')");
    }

    private static double? ParseDoubleOrNull(string? s, string field)
    {
        if (string.IsNullOrWhiteSpace(s)) return null;
        if (double.TryParse(s, NumberStyles.Float, CultureInfo.InvariantCulture, out var d)) return d;
        throw new Doc28ValidationException($"field {field} must be a number (got '{s}')");
    }

    // ─────────────────────────────────────────────────────────────────────
    // CSV (§4.2) — magic line + H,/M, rows, fixed 27-column measurement order.
    // ─────────────────────────────────────────────────────────────────────
    private static DeviceReading ParseCsv(string content, string fileName)
    {
        var rows = ParseCsvRows(content);
        if (rows.Count == 0 || rows[0].Count < 2 || rows[0][0] != "#ST4I-INSPECTION")
            throw new Doc28ValidationException(
                $"'{fileName}': CSV must start with the magic line '#ST4I-INSPECTION,<version>'");

        int? specVersion = int.TryParse(rows[0][1], NumberStyles.Integer, CultureInfo.InvariantCulture, out var sv)
            ? sv
            : null;

        var headerFields = new Dictionary<string, string>(StringComparer.Ordinal);
        var measurements = new List<RawMeasurement>();

        for (var i = 1; i < rows.Count; i++)
        {
            var row = rows[i];
            if (row.Count == 0) continue;
            var tag = row[0];

            if (tag == "H")
            {
                if (row.Count < 3)
                    throw new Doc28ValidationException($"'{fileName}': CSV row {i + 1} must be 'H,<field>,<value>'");
                var field = row[1];
                var value = row.Count > 3 ? string.Join(",", row.Skip(2)) : row[2];
                headerFields[field] = value;
            }
            else if (tag == "M")
            {
                var dataCols = row.Skip(1).ToList();
                if (dataCols.Count > 27)
                    throw new Doc28ValidationException(
                        $"'{fileName}': CSV measurement row {i + 1} has more than 27 data columns");
                measurements.Add(ParseCsvMeasurementRow(dataCols));
            }
            else
            {
                throw new Doc28ValidationException(
                    $"'{fileName}': CSV row {i + 1} has an unknown record tag '{tag}' (expected 'H' or 'M')");
            }
        }

        var header = new RawHeader
        {
            MachineCode = GetOrNull(headerFields, "machine_code"),
            SerialNumber = GetOrNull(headerFields, "serial_number"),
            ProgramName = GetOrNull(headerFields, "program_name"),
            ProgramVersion = GetOrNull(headerFields, "program_version"),
            LotCode = GetOrNull(headerFields, "lot_code"),
            PanelId = GetOrNull(headerFields, "panel_id"),
            BoardIndex = ParseIntOrNull(GetOrNull(headerFields, "board_index"), "'header.board_index'"),
            OperatorId = GetOrNull(headerFields, "operator_id"),
            StartedAt = GetOrNull(headerFields, "started_at"),
            FinishedAt = GetOrNull(headerFields, "finished_at"),
            CycleTimeSec = ParseDoubleOrNull(GetOrNull(headerFields, "cycle_time_sec"), "'header.cycle_time_sec'"),
            Result = GetOrNull(headerFields, "result"),
        };

        return BuildReading(specVersion, header, measurements, fileName);
    }

    private static string? GetOrNull(Dictionary<string, string> d, string key) =>
        d.TryGetValue(key, out var v) ? v : null;

    /// <summary>Fixed column order per doc28 §4.2 (27 data columns after the 'M' record tag).</summary>
    private static RawMeasurement ParseCsvMeasurementRow(List<string> c)
    {
        string? Cell(int idx) => idx < c.Count && c[idx].Length > 0 ? c[idx] : null;

        var m = new RawMeasurement
        {
            PointName = Cell(0),
            Type = Cell(1),
            Value = ParseDoubleOrNull(Cell(2), "'measurements[].value'"),
            Unit = Cell(3),
            Lsl = ParseDoubleOrNull(Cell(4), "'measurements[].lsl'"),
            Usl = ParseDoubleOrNull(Cell(5), "'measurements[].usl'"),
            Nominal = ParseDoubleOrNull(Cell(6), "'measurements[].nominal'"),
            Result = Cell(7),
            DefectCode = Cell(8),
            Severity = Cell(9),
            BboxX = ParseIntOrNull(Cell(10), "'measurements[].bbox_px.x'"),
            BboxY = ParseIntOrNull(Cell(11), "'measurements[].bbox_px.y'"),
            BboxW = ParseIntOrNull(Cell(12), "'measurements[].bbox_px.w'"),
            BboxH = ParseIntOrNull(Cell(13), "'measurements[].bbox_px.h'"),
            ImageRef = Cell(14),
            Remark = Cell(15),
        };

        var height = ParseDoubleOrNull(Cell(16), "'measurements[].values_3d.height_um'");
        var area = ParseDoubleOrNull(Cell(17), "'measurements[].values_3d.area_pct'");
        var volume = ParseDoubleOrNull(Cell(18), "'measurements[].values_3d.volume_pct'");
        var voidPct = ParseDoubleOrNull(Cell(19), "'measurements[].values_3d.void_pct'");
        var coplanarity = ParseDoubleOrNull(Cell(20), "'measurements[].values_3d.coplanarity_um'");
        var warpage = ParseDoubleOrNull(Cell(21), "'measurements[].values_3d.warpage_um'");
        var offsetX = ParseDoubleOrNull(Cell(22), "'measurements[].values_3d.offset_x_um'");
        var offsetY = ParseDoubleOrNull(Cell(23), "'measurements[].values_3d.offset_y_um'");
        var tilt = ParseDoubleOrNull(Cell(24), "'measurements[].values_3d.tilt_deg'");
        var thickness = ParseDoubleOrNull(Cell(25), "'measurements[].values_3d.thickness_um'");
        var z = ParseDoubleOrNull(Cell(26), "'measurements[].values_3d.z_um'");

        if (height != null || area != null || volume != null || voidPct != null || coplanarity != null ||
            warpage != null || offsetX != null || offsetY != null || tilt != null || thickness != null || z != null)
        {
            m.Values3d = new Values3d(height, area, volume, voidPct, coplanarity, warpage, offsetX, offsetY, tilt, thickness, z);
        }

        return m;
    }

    /// <summary>
    /// Minimal RFC-4180 tokenizer: LF/CRLF row separators, '"' quoting (embedded commas/newlines/'""'
    /// escapes supported). Blank lines are dropped.
    /// </summary>
    private static List<List<string>> ParseCsvRows(string content)
    {
        var rows = new List<List<string>>();
        var row = new List<string>();
        var field = new System.Text.StringBuilder();
        var inQuotes = false;
        var i = 0;
        var n = content.Length;

        while (i < n)
        {
            var ch = content[i];
            if (inQuotes)
            {
                if (ch == '"')
                {
                    if (i + 1 < n && content[i + 1] == '"') { field.Append('"'); i += 2; continue; }
                    inQuotes = false; i++; continue;
                }
                field.Append(ch); i++; continue;
            }

            switch (ch)
            {
                case '"':
                    inQuotes = true; i++; break;
                case ',':
                    row.Add(field.ToString()); field.Clear(); i++; break;
                case '\r':
                    i++; break;
                case '\n':
                    row.Add(field.ToString()); field.Clear();
                    rows.Add(row); row = new List<string>();
                    i++; break;
                default:
                    field.Append(ch); i++; break;
            }
        }

        if (field.Length > 0 || row.Count > 0)
        {
            row.Add(field.ToString());
            rows.Add(row);
        }

        rows.RemoveAll(r => r.Count == 1 && r[0].Length == 0);
        return rows;
    }

    // ─────────────────────────────────────────────────────────────────────
    // Shared validation + mapping (doc28 §8) — applied identically regardless
    // of source encoding.
    // ─────────────────────────────────────────────────────────────────────
    private static DeviceReading BuildReading(int? specVersion, RawHeader h, List<RawMeasurement> measurements, string fileName)
    {
        if (specVersion != 1)
            throw new Doc28ValidationException(
                $"'{fileName}': unsupported or missing spec_version (only version 1 is supported, got '{specVersion?.ToString() ?? "<none>"}')");

        var machineCode = RequireNonBlank(h.MachineCode, "header.machine_code", fileName);
        var serialNumber = RequireNonBlank(h.SerialNumber, "header.serial_number", fileName);
        var programName = RequireNonBlank(h.ProgramName, "header.program_name", fileName);

        var startedAt = RequireTimestamp(h.StartedAt, "header.started_at", fileName);
        var finishedAt = RequireTimestamp(h.FinishedAt, "header.finished_at", fileName);
        if (finishedAt < startedAt)
            throw new Doc28ValidationException($"'{fileName}': header.finished_at must be >= header.started_at");

        var headerResult = RequireResultToken(h.Result, "header.result", fileName);

        if (h.CycleTimeSec is { } cts && (!double.IsFinite(cts) || cts < 0))
            throw new Doc28ValidationException($"'{fileName}': header.cycle_time_sec must be a finite number >= 0");

        if (h.BoardIndex is { } bi && bi < 1)
            throw new Doc28ValidationException($"'{fileName}': header.board_index must be an integer >= 1");

        var mapped = new List<MeasurementResult>(measurements.Count);
        var anyNg = false;

        foreach (var m in measurements)
        {
            var pointName = RequireNonBlank(m.PointName, "measurements[].point_name", fileName);
            var result = RequireResultToken(m.Result, $"measurements[{pointName}].result", fileName);
            if (result == "NG") anyNg = true;

            RequireFinite(m.Value, $"measurements[{pointName}].value", fileName);
            RequireFinite(m.Lsl, $"measurements[{pointName}].lsl", fileName);
            RequireFinite(m.Usl, $"measurements[{pointName}].usl", fileName);
            RequireFinite(m.Nominal, $"measurements[{pointName}].nominal", fileName);

            if (m.Type != null && !TypeRegex.IsMatch(m.Type))
                throw new Doc28ValidationException(
                    $"'{fileName}': measurements[{pointName}].type must match ^[a-z][a-z0-9_]*$ (got '{m.Type}')");

            if (m.Severity != null && !SeverityTokens.Contains(m.Severity))
                throw new Doc28ValidationException(
                    $"'{fileName}': measurements[{pointName}].severity must be one of critical|major|minor|cosmetic (got '{m.Severity}')");

            Bbox? bbox = null;
            var presentCount = new[] { m.BboxX, m.BboxY, m.BboxW, m.BboxH }.Count(x => x.HasValue);
            if (presentCount > 0)
            {
                if (presentCount != 4)
                    throw new Doc28ValidationException(
                        $"'{fileName}': measurements[{pointName}].bbox_px requires x, y, w, h all present together");
                if (m.BboxX!.Value < 0 || m.BboxY!.Value < 0)
                    throw new Doc28ValidationException($"'{fileName}': measurements[{pointName}].bbox_px x,y must be >= 0");
                if (m.BboxW!.Value < 1 || m.BboxH!.Value < 1)
                    throw new Doc28ValidationException($"'{fileName}': measurements[{pointName}].bbox_px w,h must be >= 1");
                bbox = new Bbox(m.BboxX.Value, m.BboxY.Value, m.BboxW.Value, m.BboxH.Value);
            }

            mapped.Add(new MeasurementResult(
                PointCode: pointName,
                Result: result,
                MeasuredValue: m.Value,
                DefectCatalogCode: m.DefectCode,
                DefectSeverity: m.Severity,
                Unit: m.Unit,
                Bbox: bbox,
                Values3d: m.Values3d));
        }

        // Rule 5: header.result==OK forbids any NG measurement.
        if (headerResult == "OK" && anyNg)
            throw new Doc28ValidationException(
                $"'{fileName}': header.result is OK but one or more measurements are NG");

        var reading = new DeviceReading
        {
            Kind = ReadingKind.Inspection,
            MachineCode = machineCode,
            SerialNumber = serialNumber,
            RecipeCode = programName, // header.program_name — doc28 §9: maps to platform product model
            RecipeVersion = h.ProgramVersion,
            Verdict = MapVerdict(headerResult),
            Timestamp = finishedAt,
            Measurements = mapped,
        };

        // doc28 §9: program_version/panel_id/board_index/lot_code/operator_id -> rawExtras (lossless passthrough).
        var extras = new Dictionary<string, object>();
        if (!string.IsNullOrEmpty(h.LotCode)) extras["lotCode"] = h.LotCode;
        if (!string.IsNullOrEmpty(h.PanelId)) extras["panelId"] = h.PanelId;
        if (h.BoardIndex is { } bidx) extras["boardIndex"] = bidx;
        if (!string.IsNullOrEmpty(h.OperatorId)) extras["operatorId"] = h.OperatorId;
        if (h.CycleTimeSec is { } ctsVal) extras["cycleTimeSec"] = ctsVal;
        if (extras.Count > 0) reading.Genealogy = extras;

        return reading;
    }

    private static string RequireNonBlank(string? value, string field, string fileName)
    {
        if (string.IsNullOrWhiteSpace(value))
            throw new Doc28ValidationException($"'{fileName}': {field} is required and must be non-empty");
        return value.Trim();
    }

    private static DateTimeOffset RequireTimestamp(string? value, string field, string fileName)
    {
        if (string.IsNullOrWhiteSpace(value))
            throw new Doc28ValidationException($"'{fileName}': {field} is required");
        if (!TimestampRegex.IsMatch(value))
            throw new Doc28ValidationException(
                $"'{fileName}': {field} must be RFC3339 with an explicit UTC offset (got '{value}')");
        if (!DateTimeOffset.TryParse(value, CultureInfo.InvariantCulture, DateTimeStyles.None, out var dto))
            throw new Doc28ValidationException($"'{fileName}': {field} is not a valid timestamp (got '{value}')");
        return dto;
    }

    private static string RequireResultToken(string? value, string field, string fileName)
    {
        if (string.IsNullOrWhiteSpace(value))
            throw new Doc28ValidationException($"'{fileName}': {field} is required");
        if (!ResultTokens.Contains(value))
            throw new Doc28ValidationException($"'{fileName}': {field} must be exactly OK|NG|NTF (got '{value}')");
        return value;
    }

    private static void RequireFinite(double? value, string field, string fileName)
    {
        if (value is { } v && !double.IsFinite(v))
            throw new Doc28ValidationException($"'{fileName}': {field} must be a finite number (got '{v}')");
    }

    private static Verdict MapVerdict(string headerResult) => headerResult switch
    {
        "OK" => Verdict.Pass,
        "NG" => Verdict.Fail,
        "NTF" => Verdict.Skip,
        _ => throw new Doc28ValidationException($"header.result must be OK|NG|NTF (got '{headerResult}')"),
    };
}
