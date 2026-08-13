namespace St4i.Connector.Abstractions.Models;

/// <summary>
/// One named numeric measurement taken during a <see cref="ReadingKind.ProcessResult"/> cycle. Each one
/// becomes an entry of the process-result payload's <c>metrics</c> array, field for field.
/// </summary>
/// <param name="Name">The metric's own name, carried through unchanged (<c>torque</c>, <c>volume</c>,
/// <c>weld_current</c> in the built-in simulators).</param>
/// <param name="Value">The measured value. Always a number — never a string, unlike
/// <see cref="TelemetrySample.Value"/>.</param>
/// <param name="Unit">The unit <paramref name="Value"/> is expressed in, or <see langword="null"/> for a
/// unitless metric. A mapping profile may rewrite it on the way out (e.g. <c>C</c> to <c>°C</c>); nothing
/// converts the value itself.</param>
/// <param name="Lsl">Lower specification limit — a value below it is out of specification. Optional: null
/// means this metric has no lower limit to be judged against.</param>
/// <param name="Usl">Upper specification limit — a value above it is out of specification. Optional, same
/// convention as <paramref name="Lsl"/>. The simulators in this product that judge on a metric derive
/// <see cref="DeviceReading.Verdict"/> from ONE metric's value and these two limits, through a shared
/// helper that returns <see cref="Verdict.Warn"/> when neither limit is present, because there is then
/// nothing to judge against.</param>
/// <param name="Nominal">The intended value for this metric — its target, not a limit. Optional, and never
/// used to judge: the built-in simulators pass the configured target (a torque target, a mean) here while
/// passing the acceptance band through <paramref name="Lsl"/>/<paramref name="Usl"/>.</param>
public record MetricSample(string Name, double Value, string? Unit = null, double? Lsl = null, double? Usl = null, double? Nominal = null);

/// <summary>
/// A named series of sampled values recorded during a <see cref="ReadingKind.ProcessResult"/> cycle — a
/// curve rather than a single number. Each one becomes an entry of the process-result payload's
/// <c>waveforms</c> array, field for field, and the array is only sent when
/// <see cref="DeviceReading.Waveforms"/> is non-empty.
/// </summary>
/// <param name="Name">The series' own name, carried through unchanged (<c>torque_vs_angle</c>,
/// <c>weld_current</c> in the built-in simulators).</param>
/// <param name="Unit">The unit the sampled values are expressed in, or <see langword="null"/>. A mapping
/// profile may rewrite it on the way out; nothing converts the values themselves.</param>
/// <param name="RateHz">The sampling rate, or <see langword="null"/> for a series that is not sampled
/// against time.</param>
/// <param name="Samples">The sample rows, passed to the wire unchanged. 🔴 This contract fixes neither a
/// row's length nor what its elements mean, and the two built-in producers differ: the time-sampled one
/// emits one value per row and carries the time base in <paramref name="RateHz"/>, while the
/// <c>torque_vs_angle</c> one emits an <c>[x, y]</c> pair per row and leaves <paramref name="RateHz"/>
/// null. A consumer must therefore not assume a row shape from this type alone.</param>
public record WaveformSeries(string Name, string? Unit, double? RateHz, IReadOnlyList<double[]> Samples);

/// <summary>
/// An axis-aligned rectangle locating something inside an inspection image, in that image's own pixels —
/// the <c>bbox_px</c> of this product's inspection document format. Optional on a
/// <see cref="MeasurementResult"/>; the built-in AOI simulator attaches one only to a point it reports as
/// defective, and the desktop board view draws it as a rectangle positioned at
/// (<see cref="X"/>, <see cref="Y"/>) and sized <see cref="W"/> by <see cref="H"/>.
/// </summary>
/// <param name="X">Left edge, in image pixels.</param>
/// <param name="Y">Top edge, in image pixels.</param>
/// <param name="W">Width, in image pixels.</param>
/// <param name="H">Height, in image pixels.</param>
public record Bbox(int X, int Y, int W, int H);

/// <summary>
/// The optional 3D/height measurements an inspection may report for one measured point, alongside that
/// point's own <see cref="MeasurementResult.MeasuredValue"/>. Every member is independently optional:
/// <see langword="null"/> means this inspection did not report that quantity for this point, and each one
/// travels to its own named field of the inspection payload's measurement entry.
///
/// <para>Each member carries its unit in its own name: <c>Um</c> for micrometres, <c>Pct</c> for per cent,
/// <c>Deg</c> for degrees. Nothing here converts or validates a value — the numbers reach the wire exactly
/// as the driver supplied them.</para>
/// </summary>
/// <param name="HeightUm">Height at the point. Wire field <c>valueHeight</c>.</param>
/// <param name="AreaPct">Area at the point, as a percentage. Wire field <c>valueArea</c>.</param>
/// <param name="VolumePct">Volume at the point, as a percentage. Wire field <c>valueVolume</c>.</param>
/// <param name="VoidPct">Void proportion at the point, as a percentage. Wire field
/// <c>valueVoidPct</c>.</param>
/// <param name="CoplanarityUm">Coplanarity at the point. Wire field <c>valueCoplanarity</c>.</param>
/// <param name="WarpageUm">Warpage at the point. Wire field <c>valueWarpage</c>.</param>
/// <param name="OffsetXUm">Offset along X at the point. Wire field <c>valueOffsetX</c>.</param>
/// <param name="OffsetYUm">Offset along Y at the point. Wire field <c>valueOffsetY</c>.</param>
/// <param name="TiltDeg">Tilt at the point, in degrees. Wire field <c>valueTilt</c>.</param>
/// <param name="ThicknessUm">Thickness at the point. Wire field <c>valueThickness</c>.</param>
/// <param name="ZUm">Z at the point. Wire field <c>valueZ</c>.</param>
public record Values3d(
    double? HeightUm = null,
    double? AreaPct = null,
    double? VolumePct = null,
    double? VoidPct = null,
    double? CoplanarityUm = null,
    double? WarpageUm = null,
    double? OffsetXUm = null,
    double? OffsetYUm = null,
    double? TiltDeg = null,
    double? ThicknessUm = null,
    double? ZUm = null);

/// <summary>
/// The outcome at ONE measured point of a <see cref="ReadingKind.Inspection"/> reading. Each one becomes an
/// entry of the inspection payload's <c>measurements</c> array, and this product derives the unit's overall
/// result from the whole array — worst wins, <c>NG</c> over <c>NTF</c> over <c>OK</c> — consulting
/// <see cref="DeviceReading.Verdict"/> only when there are no measurements at all.
/// </summary>
/// <param name="PointCode">Which point on the unit this result is for — the same point identity
/// <see cref="CyclePlanStep.PointCode"/> uses.</param>
/// <param name="Result">This point's own pass/fail token: <c>OK</c>, <c>NG</c>, or <c>NTF</c>. Trimmed and
/// upper-cased on the way to the wire, and this product's own inspection-document reader accepts those
/// three and no others.</param>
/// <param name="MeasuredValue">The value measured at this point, or <see langword="null"/> for a point with
/// no single measured number.</param>
/// <param name="DefectCatalogCode">The catalogue code of the defect found here, or <see langword="null"/>
/// when none was. The built-in AOI simulator sets it only for a point it reports <c>NG</c>.</param>
/// <param name="DefectSeverity">How serious that defect is: <c>critical</c>, <c>major</c>, <c>minor</c> or
/// <c>cosmetic</c> — the four tokens this product's own inspection-document reader accepts. Null when no
/// defect was found.</param>
/// <param name="Unit">The unit <paramref name="MeasuredValue"/> is expressed in, or <see langword="null"/>.
/// A mapping profile may rewrite it on the way out; nothing converts the value itself.</param>
/// <param name="Bbox">Where on the inspection image this result is, or <see langword="null"/> if it is not
/// located. See the <c>Bbox</c> record's own doc comment.</param>
/// <param name="Values3d">The optional 3D/height quantities measured at this point, or
/// <see langword="null"/> if none were. See the <c>Values3d</c> record's own doc comment.</param>
public record MeasurementResult(
    string PointCode,
    string Result,
    double? MeasuredValue = null,
    string? DefectCatalogCode = null,
    string? DefectSeverity = null,
    string? Unit = null,
    Bbox? Bbox = null,
    Values3d? Values3d = null);

/// <summary>
/// One point-in-time sample of one device signal, carried by a <see cref="ReadingKind.Telemetry"/> reading.
/// Each one becomes an entry of the telemetry payload's <c>samples</c> array, stamped with the reading's own
/// <see cref="DeviceReading.MachineCode"/> and <see cref="DeviceReading.Timestamp"/> — a sample carries no
/// device id or time of its own.
/// </summary>
/// <param name="Metric">The signal's own name, carried through unchanged.</param>
/// <param name="Value">The sampled value. Unlike <see cref="MetricSample.Value"/> this is untyped: a
/// telemetry signal may legitimately be a number, a boolean or a status string (this product's OPC-UA
/// driver passes a status tag such as <c>"RUNNING"</c> through as a string). See
/// <see cref="Json.ConnectorObjectConverter"/> for the exact accepted domain, and
/// <see cref="TelemetryNumeric.TryGet"/> for how a consumer that wants a number treats a value that is not
/// one.</param>
/// <param name="Unit">The unit <paramref name="Value"/> is expressed in, or <see langword="null"/>. A
/// mapping profile may rewrite it on the way out; nothing converts the value itself.</param>
/// <param name="Quality">How much the sample is to be trusted, defaulting to <c>good</c> — the value
/// reaches the telemetry payload's <c>quality</c> field unchanged.</param>
public record TelemetrySample(string Metric, object? Value, string? Unit = null, string Quality = "good");

/// <summary>
/// The unit of everything a driver produces: one reading, streamed from
/// <see cref="IDeviceDriver.ReadAsync"/>, that this product normalizes into exactly one ingest call.
/// <see cref="Kind"/> is the discriminator — it decides which endpoint the reading goes to and which of the
/// collections below is read.
///
/// <para>This is a full point-in-time snapshot, not a partial update: a null member means "null", never
/// "unchanged". It is also a mutable class, and <see cref="IDeviceDriver.ReadAsync"/> requires each yielded
/// instance to be distinct and never touched again afterwards — consumers keep the reference they were
/// handed, with no defensive copy.</para>
/// </summary>
public class DeviceReading
{
    /// <summary>Which machine this reading is from. Identifies the machine to every ingest endpoint, keys
    /// the idempotency key, and is the device id stamped onto each <see cref="TelemetrySample"/>.</summary>
    public string MachineCode { get; set; } = "";

    /// <summary>Which of the three ingest shapes this reading carries — see
    /// <see cref="ReadingKind"/>.</summary>
    public ReadingKind Kind { get; set; }

    /// <summary>The unit this reading is about: the serial number of the part produced or the board
    /// inspected. It is part of an inspection reading's idempotency key, which is what keeps two boards
    /// inspected on the same machine and program from being deduplicated into one.</summary>
    public string SerialNumber { get; set; } = "";

    /// <summary>Which process step produced this reading (<c>screw_tightening</c>, <c>glue_dispense</c> in
    /// the built-in simulators), or <see langword="null"/> to let the machine's mapping profile supply its
    /// default.</summary>
    public string? StepType { get; set; }

    /// <summary>This cycle's coarse pass/fail as a whole — see the <c>Verdict</c> enum's own doc comment
    /// for what each value means and for the one case where an inspection reading consults it.</summary>
    public Verdict Verdict { get; set; }

    /// <summary>Which recipe/program was running, or <see langword="null"/> to let the machine's mapping
    /// profile supply its default. It also buckets the idempotency key, so two cycles of different recipes
    /// cannot collide.</summary>
    public string? RecipeCode { get; set; }

    /// <summary>That recipe's version, or <see langword="null"/>. Only reaches the wire alongside a
    /// resolved <see cref="RecipeCode"/>.</summary>
    public string? RecipeVersion { get; set; }

    /// <summary>The named numeric measurements of a cycle. Read only when <see cref="Kind"/> is
    /// <see cref="ReadingKind.ProcessResult"/> — nothing here stops a driver filling it on another kind,
    /// and nothing carries it to the wire if one does.</summary>
    public List<MetricSample> Metrics { get; set; } = new();

    /// <summary>The sampled curves of a cycle. Read only when <see cref="Kind"/> is
    /// <see cref="ReadingKind.ProcessResult"/>, and omitted from the payload entirely when empty — unlike
    /// <see cref="Metrics"/>, which is always sent.</summary>
    public List<WaveformSeries> Waveforms { get; set; } = new();

    /// <summary>The per-point results of an inspection. Read only when <see cref="Kind"/> is
    /// <see cref="ReadingKind.Inspection"/>, and an empty list is what makes an inspection fall back to
    /// <see cref="Verdict"/> for its overall result.</summary>
    public List<MeasurementResult> Measurements { get; set; } = new();

    /// <summary>The samples of a telemetry reading. Read only when <see cref="Kind"/> is
    /// <see cref="ReadingKind.Telemetry"/>.</summary>
    public List<TelemetrySample> Telemetry { get; set; } = new();

    /// <summary>Which cycle of this machine this is. It is part of the idempotency key (zero-padded to six
    /// digits), so a driver that leaves it at 0 for every cycle makes every cycle look like a repeat of the
    /// same one — this product's inspection path is the one deliberate case, because the document format it
    /// reads carries no cycle counter, and its key uses <see cref="SerialNumber"/> instead.</summary>
    public long CycleCounter { get; set; }

    /// <summary>When this reading happened — the time that reaches the wire for the cycle, and for every
    /// <see cref="TelemetrySample"/> in it. The offset is carried rather than normalized away: it is part
    /// of the formatted timestamp on the wire, and it survives a round trip through
    /// <see cref="Json.ConnectorJson"/>.</summary>
    public DateTimeOffset Timestamp { get; set; }

    /// <summary>Free-form traceability context to travel with the reading — lot code, panel id, board
    /// index, operator id and the like — or <see langword="null"/> for none. Carried ONLY on a
    /// process-result payload, where each entry is added as a top-level field of its own, so a key here
    /// can shadow one of the fields above; the telemetry and inspection payloads do not take it at all.
    /// Values are limited to the same domain as <see cref="TelemetrySample.Value"/> (see
    /// <see cref="Json.ConnectorObjectConverter"/>); in practice this product's own producers put strings,
    /// integers and doubles here.</summary>
    public Dictionary<string, object>? Genealogy { get; set; }

    /// <summary>WS3-T1 (docs/PRODUCTION_UI_DESIGN.md §3.2) — this cycle's ordered per-step plan (point
    /// sequence + per-step results + timing) for a "living twin" web animation, or null for a simulator
    /// this task doesn't wire a plan for. Purely additive: every pre-existing field above keeps its
    /// exact pre-Task-3/pre-WS3-T1 value regardless of whether this is populated.</summary>
    public CyclePlan? Plan { get; set; }
}
