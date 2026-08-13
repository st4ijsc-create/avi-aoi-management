namespace St4i.Connector.Abstractions.Models;

/// <summary>
/// One named numeric measurement taken during a <see cref="ReadingKind.ProcessResult"/> cycle. Each one
/// becomes an entry of the process-result payload's <c>metrics</c> array, field for field. The FIRST entry
/// of a reading's list has a second life this type does not show — see
/// <see cref="DeviceReading.Metrics"/>.
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
/// row's length nor what its elements mean, and the built-in producers differ: the <c>weld_current</c>
/// one emits a single-element <c>[current]</c> row per sample and carries the time base in
/// <paramref name="RateHz"/>, while the <c>torque_vs_angle</c> one emits a two-element
/// <c>[angle, torque]</c> row and leaves <paramref name="RateHz"/> null. The reference device-client SDK
/// shipped alongside this product documents the same wire field as <c>[[t,v],…]</c>, which matches
/// neither exactly. A consumer must therefore not assume a row shape from this type alone.</param>
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
/// entry of the inspection payload's <c>measurements</c> array, and the normalizer derives the unit's
/// overall result from the whole array — worst wins, <c>NG</c> over <c>NTF</c> over <c>OK</c> — consulting
/// <see cref="DeviceReading.Verdict"/> only when there are no measurements at all. Elsewhere in this
/// product the same array is counted for its NG tally and point count and stored whole, on a reading of
/// any kind — see <see cref="DeviceReading.Measurements"/>.
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
/// device id or time of its own. It is also read and stored off readings of every kind, not only telemetry
/// ones — see <see cref="DeviceReading.Telemetry"/>.
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
/// reaches the telemetry payload's <c>quality</c> field unchanged, and is stored verbatim with the sample.
/// This contract does not constrain the string. Two tokens are observable in this product: the
/// <c>good</c> default, and <c>bad</c>, which its OPC-UA driver emits together with a
/// <see langword="null"/> <paramref name="Value"/> for a node whose read returned a bad or uncertain
/// status rather than failing the whole poll. The reference device-client SDK shipped alongside this
/// product documents the field's vocabulary as <c>good|bad|uncertain</c>. 🔴 What any of those three
/// ASSERT about a sample is written down nowhere in this repository — the tokens are recoverable, their
/// meaning is not, so this says which strings occur and stops.</param>
public record TelemetrySample(string Metric, object? Value, string? Unit = null, string Quality = "good");

/// <summary>
/// The unit of everything a driver produces: one reading, streamed from
/// <see cref="IDeviceDriver.ReadAsync"/>, that this product normalizes into exactly one ingest call.
/// <see cref="Kind"/> is the discriminator the NORMALIZER switches on: it decides which endpoint the
/// reading goes to and which of the collections below that one consumer reads.
///
/// <para>🔴 <b>Which consumers honour that gate is NOT uniform, and a driver author who reads it as "the
/// collections this kind does not name are inert" ships data they believe is being ignored.</b> Behaviour
/// that depends on WHICH member this value holds is not confined to code holding a
/// <see cref="ReadingKind"/>:
/// it happens ON THIS OBJECT — the normalizer's endpoint and key shape, the Sparkplug metric arms, the
/// fault injector, the live board view, the display label; on a TYPED COPY of it — the transports route on
/// the normalized envelope's copy, the desktop trace inspector filters on a trace event's copy; and 🔴 <b>on
/// a STRINGIFIED or SERIALIZED copy, after the value has left the type system and then this process
/// altogether</b> — see the <see cref="Kind"/> member itself.</para>
///
/// <para>Nothing here is offered as an exhaustive list of readers, and on a published contract nothing
/// can be: a reader may be added wherever the value is carried to, including outside the process that
/// produced it. What each member below DOES state is where its content is carried to, so that a consumer
/// can finish the enumeration on their own side.</para>
///
/// <para>The consumer that writes to disk checks nothing: it takes
/// <see cref="Metrics"/>, <see cref="Telemetry"/>, <see cref="Measurements"/>,
/// <see cref="Genealogy"/> and <see cref="Verdict"/> off whatever reading it is handed, with no check on
/// this value, and stores them. The live-state reader takes <see cref="Metrics"/>,
/// <see cref="Telemetry"/> and <see cref="Verdict"/> ungated, gates <see cref="Measurements"/> for the
/// live BOARD VIEW only, reads <see cref="Measurements"/> ungated again for the cycle-log key metric, and
/// never reads <see cref="Genealogy"/> at all.</para>
///
/// <para>🔴 So the same misplaced content can be stored and not published, and a claim about one consumer
/// is not a claim about another. Each member below names ITS readers on both sides of that split; where
/// one says "carried to the wire by the normalizer only when", that is a claim about the normalizer and
/// nothing wider.</para>
///
/// <para>One consumer needs unpicking because it is really two, and reading it as one is how the split
/// above gets missed: the UNS publisher emits TWO messages per reading. The retained semantic mirror is
/// the NORMALIZED envelope serialized whole, so it can only ever contain what the normalizer already
/// selected; the Sparkplug data message is built by re-reading THIS object and has its own
/// <see cref="Kind"/> switch. Only the second can disagree with the readers above, and it does.</para>
///
/// <para>This is a full point-in-time snapshot, not a partial update: a null member means "null", never
/// "unchanged". It is also a mutable class, and <see cref="IDeviceDriver.ReadAsync"/> requires each yielded
/// instance to be distinct and never touched again afterwards — consumers keep the reference they were
/// handed, with no defensive copy.</para>
/// </summary>
public class DeviceReading
{
    /// <summary>Which machine this reading is from. It opens the idempotency key for every kind, is a
    /// top-level field of the process-result and inspection payloads, and is the device id stamped onto
    /// each <see cref="TelemetrySample"/> — the telemetry payload has no machine field of its own.</summary>
    public string MachineCode { get; set; } = "";

    /// <summary>Which of the three ingest shapes this reading carries — see
    /// <see cref="ReadingKind"/>.
    ///
    /// <para>🔴 <b>This value outlives its own type, and part of what branches on it does so only after
    /// it has become a string.</b> Every stored result records it as its CLR member name,
    /// and this product's OEE aggregate then selects rows with a hard-coded
    /// <c>reading_kind = 'ProcessResult'</c> before it counts anything. So a cycle a driver ships under
    /// any other kind is stored, is returned by the results query and the CSV export, and contributes
    /// NOTHING to that machine's OEE — not a zero, but absent from both the numerator and the
    /// denominator — on the API, the fleet OEE list and the report PDF alike. Nothing rejects it and no
    /// warning is produced.</para>
    ///
    /// <para>🔴 <b>It then outlives this process.</b> It is serialized under its CLR member name into this
    /// product's own API JSON — including the inspector trace stream, where the browser client picks each
    /// trace row's colour from it and offers it as one of that screen's filters — and it is carried,
    /// renamed, as an aspect segment of the retained MQTT topic, whose subscribers are outside this
    /// repository altogether. A colour map in a web client and a broker subscription are both readers this
    /// contract can neither enforce nor enumerate.</para>
    ///
    /// <para>Choosing this value is therefore not only a choice of endpoint. It decides what the machine's
    /// OEE is computed from, permanently, for every row already written, and it is read by consumers on
    /// the far side of a serialization boundary that this type cannot see across.</para></summary>
    public ReadingKind Kind { get; set; }

    /// <summary>The unit this reading is about: the serial number of the part produced or the board
    /// inspected. It is part of an inspection reading's idempotency key, which is what keeps two boards
    /// inspected on the same machine and program from being deduplicated into one.</summary>
    public string SerialNumber { get; set; } = "";

    /// <summary>Which process step produced this reading (<c>screw_tightening</c>, <c>glue_dispense</c> in
    /// the built-in simulators), or <see langword="null"/>. Null is filled in by the normalizer only, from
    /// the machine's mapping profile and then a literal fallback; every other consumer sees the null as
    /// given. It also buckets the idempotency key when <see cref="RecipeCode"/> is null — but only on the
    /// process-result and telemetry branch: the inspection branch buckets on <see cref="RecipeCode"/> or a
    /// literal and never consults this.</summary>
    public string? StepType { get; set; }

    /// <summary>This cycle's coarse pass/fail as a whole — see the <c>Verdict</c> enum's own doc comment
    /// for what each value means, for the one case where an inspection payload consults it, and for the
    /// in-process readers that consult it on EVERY kind. It has no "unset": the CLR default is ordinal 0,
    /// which is a pass.</summary>
    public Verdict Verdict { get; set; }

    /// <summary>Which recipe/program was running, or <see langword="null"/>. Same rule as
    /// <see cref="StepType"/>: the mapping-profile default is the normalizer's substitution, not a
    /// property of this field — a stored result keeps the null, and this product's own inspection-document
    /// WRITER substitutes a different literal again. It buckets the idempotency key ahead of
    /// <see cref="StepType"/>, so two cycles of different recipes cannot collide.</summary>
    public string? RecipeCode { get; set; }

    /// <summary>That recipe's version, or <see langword="null"/>. It reaches the ingest payload only
    /// alongside a resolved <see cref="RecipeCode"/> — but it is stored and served back on its own, so
    /// null here is not the same as absent everywhere.</summary>
    public string? RecipeVersion { get; set; }

    /// <summary>The named numeric measurements of a cycle. The consumers that GATE on <see cref="Kind"/>
    /// and take this only for <see cref="ReadingKind.ProcessResult"/> are the normalizer, which carries it
    /// to the wire, and the Sparkplug metric builder, which turns each entry into a published metric. The
    /// rest do NOT gate. Those that reduce this list to one number single out the FIRST entry — it becomes
    /// the machine's SPC point and its spark value, and it is stored and served back as that result's key
    /// metric (name, value and unit) — while the conformance harness a third-party author runs copies and
    /// compares EVERY entry, also without checking <see cref="Kind"/>. So a stale entry left here on a
    /// reading of another kind is neither sent nor published, and IS recorded, shown, and
    /// compared.</summary>
    public List<MetricSample> Metrics { get; set; } = new();

    /// <summary>The sampled curves of a cycle. Carried to the wire by the normalizer only when
    /// <see cref="Kind"/> is <see cref="ReadingKind.ProcessResult"/>, and omitted from that payload
    /// entirely when empty — unlike <see cref="Metrics"/>, which is always sent. Nothing persists it and
    /// nothing derives live machine state from it. The Sparkplug metric builder has no arm for it either,
    /// on any kind, so it never becomes a published metric. It does still travel inside the retained
    /// semantic mirror, because that message is the normalized envelope itself rather than a re-read of
    /// this object.
    ///
    /// <para>🔴 It is NOT unexamined, though, and the reader that examines it is the conformance harness a
    /// third-party author runs against their own driver: that harness deep-copies every
    /// <see cref="WaveformSeries.Samples"/> row and then compares <see cref="WaveformSeries.Name"/>,
    /// <see cref="WaveformSeries.Unit"/>, <see cref="WaveformSeries.RateHz"/> and every sample ELEMENT —
    /// not the row count. So the same reused-buffer mistake this contract warns about elsewhere is caught
    /// here rather than tolerated: a driver that recycles one <see langword="double"/>[] across cycles
    /// fails the no-reuse check and the round-trip check, on element values.</para></summary>
    public List<WaveformSeries> Waveforms { get; set; } = new();

    /// <summary>The per-point results of an inspection. Carried to the wire by the normalizer only when
    /// <see cref="Kind"/> is <see cref="ReadingKind.Inspection"/>, where an empty list is what makes an
    /// inspection fall back to <see cref="Verdict"/> for its overall result. The Sparkplug metric builder,
    /// the live board view and the fault injector all check <see cref="Kind"/> before touching it.
    ///
    /// <para>🔴 The rest do NOT, and some of them are person-facing. The NG tally and point count
    /// written with every stored result of every kind are counted off this list, it is serialized whole
    /// into that row, and both counts are returned by the results query and the CSV export. The
    /// live cycle log's key-metric column falls back to this list — <c>"{n} pts, {ng} NG"</c> — whenever a
    /// reading has no <see cref="Metrics"/> and no <see cref="Telemetry"/>, with no check on
    /// <see cref="Kind"/> at all: a process-result cycle carrying a stale list from the last board will
    /// display it, in the browser client and in the desktop one alike. And the conformance harness a
    /// third-party author runs against their own driver copies this list and compares every point of it,
    /// also without checking <see cref="Kind"/>. So a stale list here is hidden exactly where a
    /// <see cref="Kind"/> gate stands — off the wire, out of the Sparkplug message, past the fault
    /// injector, and off the board view in either client — and is recorded, served, displayed and
    /// compared everywhere else. It is the board view's gate that suggests it would be hidden
    /// everywhere.</para></summary>
    public List<MeasurementResult> Measurements { get; set; } = new();

    /// <summary>The samples of a telemetry reading. Same split as <see cref="Metrics"/>, in the opposite
    /// direction: the normalizer and the Sparkplug metric builder both GATE on <see cref="Kind"/> and take
    /// this only for <see cref="ReadingKind.Telemetry"/>, while the live-state reader and the one that
    /// writes to disk do not gate at all.
    ///
    /// <para>🔴 Here two consumers of this one field disagree, and a driver author can see the effect in
    /// both directions at once. On a reading of ANY kind, every numerically-resolvable sample
    /// here is appended to that machine's live per-metric series and written as a stored telemetry row —
    /// and on a reading that is not <see cref="ReadingKind.Telemetry"/>, NONE of them is published to the
    /// Sparkplug data message. A driver that reuses a builder and leaves last cycle's samples attached to a
    /// process-result reading therefore does not send them, does not publish them, and does persist
    /// them.</para></summary>
    public List<TelemetrySample> Telemetry { get; set; } = new();

    /// <summary>Which cycle of this machine this is. It is the trailing component of the idempotency key
    /// (zero-padded to six digits), so a driver that leaves it at 0 for every cycle makes every cycle look
    /// like a repeat of the same one. This product's inspection path is a deliberate exception: the
    /// document format it reads carries no cycle counter, so the counter stays 0 there and
    /// <see cref="SerialNumber"/> is ADDED to the key ahead of it — the counter is not removed — which is
    /// what keeps two boards apart.</summary>
    public long CycleCounter { get; set; }

    /// <summary>When this reading happened — the time that reaches the wire for the cycle, and for every
    /// <see cref="TelemetrySample"/> in it. The offset is carried rather than normalized away: it is part
    /// of the formatted timestamp on the wire, and it survives a round trip through
    /// <see cref="Json.ConnectorJson"/>.</summary>
    public DateTimeOffset Timestamp { get; set; }

    /// <summary>Free-form traceability context to travel with the reading — lot code, panel id, board
    /// index, operator id and the like — or <see langword="null"/> for none. Values are limited to the same
    /// domain as <see cref="TelemetrySample.Value"/> (see <see cref="Json.ConnectorObjectConverter"/>); in
    /// practice this product's own producers put strings, integers and doubles here.
    ///
    /// <para>The normalizer carries it on the PROCESS-RESULT payload only, where each entry is added as a
    /// top-level field of its own — so a key here can shadow one of the fields above — and with one
    /// exception to that pass-through: a key matching <c>stationId</c> (case-insensitively) is coerced to
    /// a number first, because the ingest contract requires that one numeric. The telemetry and inspection
    /// payloads do not take it at all. It is nonetheless serialized and stored with the result on EVERY
    /// kind, so "not on the wire" is not "not recorded".</para></summary>
    public Dictionary<string, object>? Genealogy { get; set; }

    /// <summary>WS3-T1 (docs/PRODUCTION_UI_DESIGN.md §3.2) — this cycle's ordered per-step plan (point
    /// sequence + per-step results + timing) for a "living twin" web animation, or null for a simulator
    /// this task doesn't wire a plan for. Purely additive: every pre-existing field above keeps its
    /// exact pre-Task-3/pre-WS3-T1 value regardless of whether this is populated.</summary>
    public CyclePlan? Plan { get; set; }
}
