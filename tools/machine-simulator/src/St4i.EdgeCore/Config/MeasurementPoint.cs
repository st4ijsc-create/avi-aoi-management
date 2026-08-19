using System.Text.Json;
using System.Text.Json.Serialization;

namespace St4i.EdgeCore.Config;

/// <summary>What kind of check this point performs — mirrors the server's
/// <c>measurementType</c> (<c>DIMENSION|VISUAL|ELECTRICAL|POSITION|COLOR|SURFACE|OTHER</c>). Spelled
/// in caps on the wire (unlike every other enum in this file) — see
/// <see cref="SnakeUpperEnumConverter"/>.</summary>
/// <remarks>
/// 🔴 THE PUSH PATH DOES NOT GO THROUGH THAT CONVERTER. <c>ConfigSyncEngine.ToWireDto</c> spells this
/// field for the outbound <c>sync-points</c> body with a plain <c>ToString().ToUpperInvariant()</c>.
/// The two agree today for one reason only, and it is a property of the member list rather than of the
/// code: every member below is a SINGLE WORD, so <c>SnakeCaseUpper</c> has no boundary to insert an
/// underscore at. Adding a two-word member (a <c>SolderJoint</c>) would make the pull say
/// <c>SOLDER_JOINT</c> and the push say <c>SOLDERJOINT</c> for the same value. This is named, not
/// fixed — no code was touched in the round that found it.
/// </remarks>
[JsonConverter(typeof(SnakeUpperEnumConverter))]
public enum MeasurementType
{
    /// <summary>Wire value <c>"DIMENSION"</c>, and the default. A geometric measurement judged against
    /// the numeric limit band — the seed uses it both for a plain 2D height in <c>mm</c> and for a
    /// solder volume in <c>mm3</c>, so it says nothing about WHICH block of limit fields
    /// applies.</summary>
    Dimension,

    /// <summary>Wire value <c>"VISUAL"</c>. Presence / appearance / OCR — a point whose verdict comes
    /// from <see cref="MeasurementPoint.Criteria"/> rather than from a numeric band, which is why the
    /// seed's label-OCR point sets no <see cref="MeasurementPoint.Unit"/> and no limits at
    /// all.</summary>
    Visual,

    /// <summary>Wire value <c>"ELECTRICAL"</c>. An in-circuit electrical reading — the seed's resistor
    /// point carries <c>Ω</c> as its unit, the non-ASCII character that forced
    /// <see cref="ConfigChecksum"/> to relax STJ's HTML-safe encoder so both ends hash the same
    /// bytes.</summary>
    Electrical,

    /// <summary>Wire value <c>"POSITION"</c>. Placement offset rather than size: the measured quantity
    /// is a displacement from nominal, which is why the seed pairs it with
    /// <see cref="ToleranceMode.MaxOnly"/> and a nominal of zero.</summary>
    Position,

    /// <summary>Wire value <c>"COLOR"</c>. Colour/chromaticity judgement — no member of this type
    /// carries the reference colour itself; that lives in
    /// <see cref="MeasurementPoint.Criteria"/>.</summary>
    Color,

    /// <summary>Wire value <c>"SURFACE"</c>. Finish/texture defects (scratch, contamination). Unused by
    /// anything this repository seeds.</summary>
    Surface,

    /// <summary>Wire value <c>"OTHER"</c>. The escape hatch that keeps this a closed C# enum against an
    /// open catalogue: a check the server has a name for and this vocabulary does not lands here, and
    /// <see cref="MeasurementPoint.MeasurementTypeCode"/> is where the real sub-type
    /// survives.</summary>
    Other,
}

/// <summary>How <see cref="MeasurementPoint.LowerLimit"/>/<see cref="MeasurementPoint.UpperLimit"/>
/// gate a measured value — mirrors <c>measurement_point_defs.toleranceMode</c>
/// (<c>min_only|max_only|range|bilateral</c>).</summary>
/// <remarks>
/// Two things this type does NOT have. It has no gate: nothing in this solution ever compares a
/// measured value against a point's band, so every member below describes the ECOSYSTEM's intent, not
/// a rule enforced here. And it has no push: <c>sync-points</c>' request body has no
/// <c>toleranceMode</c> slot, so a mode changed at the machine moves the drift key and can never be
/// reconciled outward. Unlike <see cref="MeasurementType"/>, no spelling hazard applies here —
/// this enum is never re-spelled by hand, so <c>min_only</c>'s underscore is safe.
/// </remarks>
[JsonConverter(typeof(SnakeLowerEnumConverter))]
public enum ToleranceMode
{
    /// <summary>Wire value <c>"min_only"</c> — one of the two members in this file that gain an
    /// underscore on the wire, which is the whole reason this enum needs a snake-case converter rather
    /// than a plain lower-casing. Only <see cref="MeasurementPoint.LowerLimit"/> binds; anything above
    /// it passes.</summary>
    MinOnly,

    /// <summary>Wire value <c>"max_only"</c>. Only <see cref="MeasurementPoint.UpperLimit"/> binds —
    /// the natural mode for a defect or offset measurement, where zero is perfect and there is no
    /// "too little". The seed's placement-offset point uses it.</summary>
    MaxOnly,

    /// <summary>Wire value <c>"range"</c>. Both limits bind, stated as absolute values. This is the
    /// mode where <see cref="MeasurementPoint.NominalValue"/> is decoration for the operator rather
    /// than an input to the judgement.</summary>
    Range,

    /// <summary>Wire value <c>"bilateral"</c>. The band is meant to be read as nominal ±
    /// <see cref="MeasurementPoint.TolPlus"/>/<see cref="MeasurementPoint.TolMinus"/> rather than as
    /// two absolutes. 🔴 The seed's resistor point supplies BOTH forms and they happen to agree
    /// (5000 ± 250 against 4750..5250); nothing anywhere checks that they do, so this is the one mode
    /// under which a point can carry two contradictory statements of the same
    /// tolerance.</summary>
    Bilateral,
}

/// <summary>The ROI/marker geometry family a point's <see cref="MeasurementPoint.Geometry"/> (and,
/// for <see cref="Array"/>, <see cref="MeasurementPoint.Cells"/>) is interpreted against — mirrors
/// <c>measurement_point_defs.shape</c> (<c>circle|rect|polygon|line|ring|mask|array</c>).</summary>
/// <remarks>
/// A member here does not constrain <see cref="MeasurementPoint.Geometry"/>: nothing in this solution
/// parses that JSON, so a <see cref="Rect"/> point carrying a ring's payload persists, hashes and
/// renders without objection. The one place shape does drive behaviour is the board marker, which
/// sizes itself from <see cref="MeasurementPoint.NormalizedRadius"/> regardless of which member is set.
/// This enum IS pushed, by the same hand-written <c>ToString().ToLowerInvariant()</c> that
/// <see cref="MeasurementType"/>'s remarks describe, and is safe for the same single-word reason.
/// </remarks>
[JsonConverter(typeof(SnakeLowerEnumConverter))]
public enum PointShape
{
    /// <summary>Wire value <c>"circle"</c>, and the default every point starts at. The one shape
    /// <see cref="MeasurementPoint.Radius"/>/<see cref="MeasurementPoint.NormalizedRadius"/> describe
    /// completely, so it needs no <see cref="MeasurementPoint.Geometry"/> payload at all.</summary>
    Circle,

    /// <summary>Wire value <c>"rect"</c>. The seed's payload shape is
    /// <c>{"width":…,"height":…,"rotationDeg":…}</c>, in the product's own
    /// <see cref="ProductModel.CoordinateMode"/> units.</summary>
    Rect,

    /// <summary>Wire value <c>"polygon"</c> — an arbitrary vertex list in
    /// <see cref="MeasurementPoint.Geometry"/>. Unused by anything this repository seeds, so the
    /// payload's exact key names are the server's to define.</summary>
    Polygon,

    /// <summary>Wire value <c>"line"</c> — a one-dimensional profile rather than an area. Unused by the
    /// seed.</summary>
    Line,

    /// <summary>Wire value <c>"ring"</c> — an annulus, the natural ROI for a solder fillet. The seed's
    /// payload is <c>{"innerRadius":…,"outerRadius":…}</c>, and note that the outer radius is stated
    /// there IN ADDITION to <see cref="MeasurementPoint.Radius"/>, with nothing keeping the two
    /// equal.</summary>
    Ring,

    /// <summary>Wire value <c>"mask"</c> — an arbitrary bitmap/region of interest. Unused by the
    /// seed.</summary>
    Mask,

    /// <summary>Wire value <c>"array"</c> — a repeated grid such as a BGA ball field, and the ONLY
    /// member that gives <see cref="MeasurementPoint.Cells"/> a meaning (that property's own doc says
    /// it is null for every other shape). Nothing enforces the pairing in either
    /// direction.</summary>
    Array,
}

/// <summary>
/// One inspection point's full spec — the edge-local mirror of a <c>measurement_point_defs</c> row,
/// FULL depth per docs/plans/2026-07-20-config-sync.md's Global Constraints: 2D limits + tolerance
/// mode, 3D/solder/x-ray fields, geometry/shape, criteria, per-point lighting recipe, per-point
/// image, and the soft-delete tombstone. Field names are the exact camelCase-capitalized form of
/// CONFIG_SYNC_SERVER_CONTRACT.md's <c>&lt;POINT&gt;</c> shape (e.g. <c>lowerLimit</c> →
/// <see cref="LowerLimit"/>) so a later wire-DTO layer (C2/C3) can map 1:1 or just serialize this
/// type with <c>JsonNamingPolicy.CamelCase</c> — no renaming needed. <see cref="Code"/> is the
/// natural key (unique within a product, matches the server's upsert-by-(productModelId, code));
/// like <see cref="ProductModel"/>, no server-assigned numeric id lives here.
/// </summary>
/// <remarks>
/// 🔴 THIS TYPE IS ASYMMETRIC ACROSS THE WIRE, AND MOST OF IT IS PULL-ONLY. Every property is inside
/// the drift key — <see cref="ConfigChecksum.CanonicalizePoint(MeasurementPoint)"/> hashes the whole
/// serialized point and removes only the three audit fields — but <c>sync-points</c>' REQUEST body
/// (CONFIG_SYNC_SERVER_CONTRACT.md §"Push up", mirrored field for field by
/// <c>ConfigSyncEngine.ToWireDto</c>) has no slot for: <see cref="MeasurementTypeCode"/>,
/// <see cref="ToleranceMode"/>, <see cref="TolPlus"/>, <see cref="TolMinus"/>, <see cref="Cells"/>,
/// <see cref="PositionZ"/>, the four <c>Height*</c>, the four <c>Area*</c>, the four <c>Volume*</c>,
/// <see cref="CoplanarityMax"/>, <see cref="WarpageMax"/>, <see cref="VoidPctMax"/>,
/// <see cref="OffsetXMax"/>, <see cref="OffsetYMax"/>, <see cref="TiltMax"/>,
/// <see cref="ThicknessMin"/>, <see cref="ThicknessMax"/>, <see cref="Criteria"/> or
/// <see cref="Lighting"/>. The consequence is concrete: the HMI's point form lets an operator edit all
/// of them, the drift badge duly turns amber, and the only thing that ever clears it is a PULL, which
/// discards the edit. Where a member below says "never pushed", that is what it means, and the
/// asymmetry belongs to the ecosystem's contract — this repository mirrors it rather than causing it.
///
/// A second boundary worth stating once: NOTHING IN THIS SOLUTION JUDGES A MEASUREMENT AGAINST THESE
/// FIELDS. <c>AoiInspectorSim</c> reads a point's code and its normalized position to build a cycle
/// plan and draws its verdicts from a random distribution; no limit, tolerance, criterion or lighting
/// value is ever an input to a pass/fail. Every "the ecosystem uses this to…" sentence below is
/// therefore a statement about the far end, checked against the contract document, not about
/// behaviour observable here.
/// </remarks>
public sealed class MeasurementPoint
{
    // ── Identity / description ─────────────────────────────────────────

    /// <summary>Natural key within the product — the server upserts by
    /// <c>(productModelId, code)</c> and <see cref="ProductConfigStore.UpsertPoint"/> matches it
    /// case-INSENSITIVELY, so <c>P01</c> and <c>p01</c> are one point locally. Two further things ride
    /// on this string: the points checksum sorts by it ORDINALLY before hashing, so a re-cased code
    /// changes a product's drift key; and it is what leaves the machine as
    /// <c>CyclePlanStep.PointCode</c>, which is the identity an operator watching the live twin sees.
    /// Nothing here rejects a duplicate or an empty code on the way in — only the store's own
    /// <c>ThrowIfNullOrEmpty</c> guard at the upsert.</summary>
    public string Code { get; set; } = "";

    /// <summary>Short operator-facing label (<c>"C1 Height"</c>) shown beside the point in the editor
    /// and on the board. It is pushed, and on a protected product it is one of the fields that still
    /// syncs while the limit fields are being stripped — so a name change is a way to touch a
    /// released product's spec that threshold governance does not block.</summary>
    public string Name { get; set; } = "";

    /// <summary>Longer prose about what this point checks, written in the operator's own language (the
    /// seed's are Vietnamese). Never parsed, never matched on — its only constraint is that it travels
    /// through <see cref="ConfigChecksum"/>, which is why that class relaxes STJ's HTML-safe encoder:
    /// otherwise a non-ASCII description would hash differently here than on the server for no reason
    /// but over-escaping.</summary>
    public string? Description { get; set; }

    // ── Type / unit ─────────────────────────────────────────────────────

    /// <summary>The CLOSED half of this point's classification (see <see cref="Config.MeasurementType"/>
    /// for each wire spelling, and for the one spelling hazard on the push path). Defaults to
    /// <see cref="Config.MeasurementType.Dimension"/>, so a point that never sets it claims to be a
    /// dimensional check rather than admitting it is unclassified.</summary>
    public MeasurementType MeasurementType { get; set; } = MeasurementType.Dimension;

    /// <summary>The OPEN half, beside the closed enum above: the ecosystem's own sub-type identifier,
    /// which the seed spells in SCREAMING_SNAKE (<c>HEIGHT_2D</c>, <c>SOLDER_3D</c>,
    /// <c>PLACEMENT_OFFSET</c>, <c>LABEL_OCR</c>, <c>RESISTANCE</c>). This is where a check that
    /// <see cref="Config.MeasurementType"/> can only call <c>Other</c> keeps its real name. 🔴 Never
    /// pushed — see this type's remarks.</summary>
    public string? MeasurementTypeCode { get; set; }

    /// <summary>Unit for the 2D block ONLY — <see cref="LowerLimit"/>, <see cref="UpperLimit"/>,
    /// <see cref="NominalValue"/>, <see cref="TolPlus"/>, <see cref="TolMinus"/>. The 3D block carries
    /// its own <see cref="HeightUnit"/>/<see cref="AreaUnit"/>/<see cref="VolumeUnit"/> and does not
    /// read this one, so a single point can legitimately state several units at once (the seed's solder
    /// point is <c>mm3</c> here and <c>mm</c> for height). Free text with no vocabulary: the seed uses
    /// <c>mm</c>, <c>mm3</c> and <c>Ω</c>, and null is the honest value for a check with no measured
    /// quantity, as the label-OCR point shows.</summary>
    public string? Unit { get; set; }

    // ── 2D limits + tolerance ───────────────────────────────────────────

    /// <summary>Lower bound of the acceptance band, in <see cref="Unit"/>. 🔴 One of the three
    /// THRESHOLD-GOVERNED fields: pushing a change to it against a product whose
    /// <see cref="ProductModel.LifecycleStatus"/> is anything but
    /// <see cref="ProductLifecycleStatus.Development"/> gets this field silently STRIPPED server-side
    /// while the rest of the point still syncs, and the response marks the point
    /// <c>limitBlocked</c> — a partial success that a caller has to read per point to notice. Null
    /// means the band is open below, which is what <see cref="Config.ToleranceMode.MaxOnly"/>
    /// expects.</summary>
    public double? LowerLimit { get; set; }

    /// <summary>Upper bound of the acceptance band, in <see cref="Unit"/>. Governed exactly as
    /// <see cref="LowerLimit"/> is. Null means the band is open above.</summary>
    public double? UpperLimit { get; set; }

    /// <summary>The target value the band is centred on, in <see cref="Unit"/>, and the third
    /// threshold-governed field. For <see cref="Config.ToleranceMode.MaxOnly"/> points it is the
    /// perfect-score value rather than a midpoint — the seed's placement-offset point sets it to
    /// zero.</summary>
    public double? NominalValue { get; set; }

    /// <summary>How the two limits are meant to be read (see <see cref="Config.ToleranceMode"/>). Null
    /// is common and carries no default: a point with limits and no mode is a point whose reader must
    /// decide. 🔴 Never pushed, so unlike the three limit fields it is not merely governed — there is
    /// no channel for it at all.</summary>
    public ToleranceMode? ToleranceMode { get; set; }

    /// <summary>Positive half-width of a <see cref="Config.ToleranceMode.Bilateral"/> band, in
    /// <see cref="Unit"/> — a SECOND statement of the same tolerance the limits already express, with
    /// nothing reconciling the two (see that member's own doc). Never pushed.</summary>
    public double? TolPlus { get; set; }

    /// <summary>Negative half-width, stated as a POSITIVE magnitude — the seed writes <c>250</c>, not
    /// <c>-250</c>, for a 5000 Ω nominal with a 4750 lower limit. Same duplication and same
    /// pull-only status as <see cref="TolPlus"/>.</summary>
    public double? TolMinus { get; set; }

    // ── Position (in the product's CoordinateMode) + normalized (0..1, resolution-independent) ──

    /// <summary>Absolute horizontal position in the owning product's
    /// <see cref="ProductModel.CoordinateMode"/> — pixels of its reference image, or millimetres.
    /// Non-nullable because the contract lists it unconditionally. Consumers prefer
    /// <see cref="NormalizedX"/> and fall back to <c>PositionX / ImageWidth</c> only when that is null,
    /// so this value is load-bearing exactly when the normalized twin is absent — and it is the twin,
    /// not this, that a renderer clamps.</summary>
    public double PositionX { get; set; }

    /// <summary>Absolute vertical position, same frame and same fallback role as
    /// <see cref="PositionX"/>, divided by <see cref="ProductModel.ImageHeight"/> when it is used that
    /// way.</summary>
    public double PositionY { get; set; }

    /// <summary>ROI radius in the same absolute units as <see cref="PositionX"/>. Meaningful for the
    /// round shapes (<see cref="PointShape.Circle"/>, <see cref="PointShape.Ring"/>); for a
    /// <see cref="PointShape.Ring"/> the seed ALSO restates it as the geometry payload's
    /// <c>outerRadius</c>, and nothing keeps the two in step.</summary>
    public double? Radius { get; set; }

    /// <summary>Resolution-independent horizontal position, 0..1 across the reference image. This is
    /// the value every renderer actually wants, and the reason both the AOI simulator and the HMI
    /// derive it identically: <c>NormalizedX</c> when authored, else
    /// <c>PositionX / ImageWidth</c>, clamped to [0,1] either way. Because of that fallback — unlike
    /// <see cref="Fiducial.NormalizedX"/>, which has none — a point with only absolute coordinates
    /// still places correctly.</summary>
    public double? NormalizedX { get; set; }

    /// <summary>Resolution-independent vertical position, 0..1 down the reference image, derived and
    /// clamped exactly as <see cref="NormalizedX"/> is.</summary>
    public double? NormalizedY { get; set; }

    /// <summary>ROI radius as a fraction of the image's WIDTH — on both axes, never against height.
    /// The seed makes the convention checkable: a 10-unit radius on a 1600-wide board is
    /// <c>0.00625</c>. The board canvas turns it back into pixels as
    /// <c>containerWidth × normalizedRadius × 2</c> and then clamps the result into a legible marker
    /// range, so a real ROI that is genuinely tiny still draws at the minimum marker size rather than
    /// vanishing — the drawn dot is deliberately NOT to scale.</summary>
    public double? NormalizedRadius { get; set; }

    // ── Crop / ordering / enable ────────────────────────────────────────

    /// <summary>Width of the image patch the ecosystem should cut around this point, in the product's
    /// absolute units (the seed's values are pixels, 40–100). It is a capture instruction, not a
    /// judgement bound, and is independent of <see cref="Radius"/>: the seed's points routinely crop a
    /// larger box than the ROI they measure.</summary>
    public int? CropWidth { get; set; }

    /// <summary>Height of the same patch, and independently settable — the seed's rectangular label and
    /// connector points crop non-square boxes (100×60, 72×36).</summary>
    public int? CropHeight { get; set; }

    /// <summary>Authoring order, and the sequence <see cref="ProductModel.ActivePoints"/> sorts by —
    /// so this, not list position, is what decides the order a camera visits points and the order the
    /// steps appear in a cycle plan. 🔴 It does NOT decide the drift key's ordering: the points
    /// checksum sorts by <see cref="Code"/> instead. Its VALUE is still hashed like any other field, so
    /// re-ordering points does move the drift key — just not by re-ordering the hash.</summary>
    public int OrderIndex { get; set; }

    /// <summary>Temporarily enable/disable this point without deleting it — distinct from the
    /// soft-delete tombstone (<see cref="DeletedAt"/>): an inactive point still exists and still
    /// syncs, it's just excluded from live inspection.</summary>
    public bool IsActive { get; set; } = true;

    // ── Shape / geometry (jsonb per shape — arbitrary JSON, so JsonElement) ────────────────────

    /// <summary>Which geometry family <see cref="Geometry"/> should be read as (see
    /// <see cref="PointShape"/>, including why nothing here enforces the pairing). Defaults to
    /// <see cref="PointShape.Circle"/>, the one family that needs no payload — so an unset shape is
    /// self-consistent rather than merely unset.</summary>
    public PointShape Shape { get; set; } = PointShape.Circle;

    /// <summary>The shape's own parameters, as whatever JSON the ecosystem's <c>jsonb</c> column holds
    /// — <c>{"innerRadius":6,"outerRadius":14}</c> for a ring, <c>{"width":36,"height":18,
    /// "rotationDeg":0}</c> for a rect. Deliberately a raw <see cref="JsonElement"/> rather than a
    /// typed union: this side never reads a key out of it, so binding it to C# shapes would invent a
    /// schema nobody here is entitled to define, and a future shape would break the round trip. It is
    /// one of the few pull-only exceptions' opposites: it IS pushed. Key order and whitespace inside
    /// the payload do not reach the drift key — <see cref="ConfigChecksum"/>'s stable-stringify walks
    /// nested objects and sorts their keys ordinally — so a re-formatted payload is correctly not
    /// drift. The field-level DIFF is the surface that does show raw text, via
    /// <see cref="JsonElement.GetRawText"/>.</summary>
    public JsonElement? Geometry { get; set; }

    /// <summary>Per-cell geometry when <see cref="Shape"/> is <see cref="PointShape.Array"/> (e.g. a
    /// BGA ball grid) — mirrors the contract's <c>cells(if shape=array)</c>. Null for every other
    /// shape.</summary>
    public JsonElement? Cells { get; set; }

    // ── 3D / solder / x-ray ─────────────────────────────────────────────
    // Every member in this block is pull-only (see this type's remarks) and carries its own unit
    // convention rather than reading Unit. The seed's P02 solder point is the one worked example in
    // this repository of the block being populated at all.

    /// <summary>Height of the feature above the board datum, in the product's absolute
    /// <see cref="ProductModel.CoordinateMode"/> units — the third coordinate the 2D
    /// <see cref="PositionX"/>/<see cref="PositionY"/> pair cannot carry, so a 3D sensor knows where to
    /// focus. It is a POSITION, not a limit: the acceptance band for height is
    /// <see cref="HeightMin"/>/<see cref="HeightMax"/> below.</summary>
    public double? PositionZ { get; set; }

    /// <summary>Minimum acceptable feature height, in <see cref="HeightUnit"/> — a starved solder joint
    /// falls below this. Not in <see cref="Unit"/>: the seed's P02 is a volume point measured in
    /// <c>mm3</c> whose heights are nonetheless <c>mm</c>.</summary>
    public double? HeightMin { get; set; }

    /// <summary>Maximum acceptable feature height, in <see cref="HeightUnit"/> — an excess-solder or
    /// lifted-component condition exceeds it.</summary>
    public double? HeightMax { get; set; }

    /// <summary>Target height, in <see cref="HeightUnit"/>. As with the 2D block, nothing here checks
    /// that it lies between <see cref="HeightMin"/> and <see cref="HeightMax"/>.</summary>
    public double? HeightNominal { get; set; }

    /// <summary>Unit for the three <c>Height*</c> values, and for them alone — the seed writes
    /// <c>mm</c>. Free text, so <c>um</c>/<c>µm</c> would also be accepted with no conversion anywhere;
    /// a consumer must read this string rather than assume millimetres.</summary>
    public string? HeightUnit { get; set; }

    /// <summary>Minimum acceptable wetted/covered AREA, in <see cref="AreaUnit"/> — insufficient solder
    /// spread. Unpopulated by every point this repository seeds, so the shape of a real value here
    /// comes from the ecosystem, not from any example in this tree.</summary>
    public double? AreaMin { get; set; }

    /// <summary>Maximum acceptable area, in <see cref="AreaUnit"/> — bridging or excess spread.</summary>
    public double? AreaMax { get; set; }

    /// <summary>Target area, in <see cref="AreaUnit"/>.</summary>
    public double? AreaNominal { get; set; }

    /// <summary>Unit for the three <c>Area*</c> values only. No seed point sets it, so unlike
    /// <see cref="HeightUnit"/> (<c>mm</c>) and <see cref="VolumeUnit"/> (<c>mm3</c>) there is no
    /// observed convention here — <c>mm2</c> is the expectation the sibling fields imply, not something
    /// this repository has ever written.</summary>
    public string? AreaUnit { get; set; }

    /// <summary>Minimum acceptable solder VOLUME, in <see cref="VolumeUnit"/> — the primary
    /// insufficient-solder criterion for a 3D joint inspection, and the reason the seed's P02 exists at
    /// all.</summary>
    public double? VolumeMin { get; set; }

    /// <summary>Maximum acceptable volume, in <see cref="VolumeUnit"/>.</summary>
    public double? VolumeMax { get; set; }

    /// <summary>Target volume, in <see cref="VolumeUnit"/>.</summary>
    public double? VolumeNominal { get; set; }

    /// <summary>Unit for the three <c>Volume*</c> values only — the seed writes <c>mm3</c>, in ASCII
    /// digits rather than a superscript, which is the spelling anything comparing this string should
    /// expect.</summary>
    public string? VolumeUnit { get; set; }

    /// <summary>Maximum permitted COPLANARITY deviation, in <see cref="HeightUnit"/>'s frame: how far
    /// out of a common plane a set of leads or balls may sit before the part cannot seat. A
    /// single-sided ceiling — there is no matching minimum, because zero deviation is perfect.</summary>
    public double? CoplanarityMax { get; set; }

    /// <summary>Maximum permitted board WARPAGE over this point's region, in the same length frame.
    /// Distinct from <see cref="CoplanarityMax"/>: warpage is the substrate bending, coplanarity is the
    /// terminations disagreeing about where the plane is.</summary>
    public double? WarpageMax { get; set; }

    /// <summary>Maximum void fraction inside a joint, as a PERCENTAGE 0–100 — the seed writes
    /// <c>25.0</c>, meaning a quarter. The <c>Pct</c> in the name is the only place that unit is
    /// stated; it does not follow <see cref="Unit"/> or any of the three unit fields above. This is the
    /// classic x-ray criterion for a BGA ball.</summary>
    public double? VoidPctMax { get; set; }

    /// <summary>Maximum permitted placement offset along X from nominal, in the product's absolute
    /// units, as a MAGNITUDE — a ±band expressed once. Note the overlap with a
    /// <see cref="Config.MeasurementType.Position"/> point's
    /// <see cref="UpperLimit"/>/<see cref="Config.ToleranceMode.MaxOnly"/> pair, which states the same
    /// idea in the 2D block; the seed's P03 populates BOTH, and nothing reconciles them.</summary>
    public double? OffsetXMax { get; set; }

    /// <summary>Maximum permitted placement offset along Y, same convention as
    /// <see cref="OffsetXMax"/>. The two are independent ceilings, not a radius: a part may be at the
    /// limit on both axes simultaneously.</summary>
    public double? OffsetYMax { get; set; }

    /// <summary>Maximum permitted TILT, in DEGREES — the rotation out of the board plane that makes a
    /// tombstoned or lifted component. Degrees is what the seed's <c>5.0</c> means; no other member of
    /// this block is angular, so there is no shared unit field for it.</summary>
    public double? TiltMax { get; set; }

    /// <summary>Minimum acceptable material thickness (paste deposit, plating, conformal coating), in
    /// <see cref="HeightUnit"/>'s frame. Unpopulated by the seed.</summary>
    public double? ThicknessMin { get; set; }

    /// <summary>Maximum acceptable thickness, same frame as <see cref="ThicknessMin"/>. Unpopulated by
    /// the seed.</summary>
    public double? ThicknessMax { get; set; }

    /// <summary>Free-form pass/fail criteria beyond the typed limit fields above (jsonb on the
    /// server) — e.g. an OCR pattern + minimum confidence for a label-presence point.</summary>
    public JsonElement? Criteria { get; set; }

    /// <summary>The lighting recipe (one entry per camera shot) used to capture/inspect this point —
    /// mirrors <c>mp_lighting_profiles</c>.</summary>
    public List<LightingShot> Lighting { get; set; } = new();

    // ── Image + audit ────────────────────────────────────────────────────

    /// <summary>When this point's spec last changed. 🔴 It is the ONE field that is not spec:
    /// <see cref="ProductConfigStore.UpsertPoint"/> overwrites it with <c>UtcNow</c> on EVERY write,
    /// including a byte-identical re-save, so it moves when nothing observable did. That is exactly why
    /// both content comparisons strip it — the drift checksum
    /// (<see cref="ConfigChecksum.CanonicalizePoint(MeasurementPoint)"/>) and the "did this push
    /// actually change anything" test (<see cref="ConfigChecksum.PointContentEquals"/>) — and why the
    /// second one strips it and NOTHING ELSE, since a tombstone appearing or clearing IS a real change
    /// for that question. Never pushed; a caller reading it is reading local edit history, not the
    /// ecosystem's.</summary>
    public DateTimeOffset? LastModifiedAt { get; set; }

    /// <summary>Image of THIS point's own region — a cropped reference patch, distinct from the
    /// product-level board image in <see cref="ProductModel.ReferenceImageUrl"/>. Accepts the same
    /// three string kinds as that one (asset-relative path, absolute URL, base64 <c>data:</c> URL). 🔴
    /// Null in every seeded point on purpose: M-9 removed paths that pointed at
    /// <c>assets/products/model-*/points/*.png</c> files that never existed, so the UI shows its honest
    /// empty state instead of failing a request forever — see
    /// <see cref="ProductConfigStore.SeedProducts"/>'s own remarks. It has its own dedicated push
    /// channel (<c>sync-point-image</c>) which the contract states is NEVER limit-gated, so it is the
    /// one part of a protected product's spec a machine can always update.</summary>
    public string? ReferenceImageUrl { get; set; }

    // ── Soft-delete tombstone ────────────────────────────────────────────
    /// <summary>Set (alongside <see cref="DeletedAtVersion"/>) instead of removing the row — mirrors
    /// <c>measurement_point_defs.deletedAt</c>. A tombstoned point stays retrievable (so delta-sync
    /// can tell a pulling machine "this code is gone") but is excluded from
    /// <see cref="ProductModel.ActivePoints"/>.</summary>
    public DateTimeOffset? DeletedAt { get; set; }

    /// <summary>The product's <see cref="ProductModel.PointsConfigVersion"/> at the moment this point
    /// was tombstoned — mirrors <c>measurement_point_defs.deletedAtVersion</c>, what a delta-sync
    /// consumer compares its own <c>sinceVersion</c> against to decide whether it still needs to
    /// apply this deletion.</summary>
    public int? DeletedAtVersion { get; set; }

    /// <summary>True once <see cref="DeletedAt"/> is set. Computed, not persisted.</summary>
    [JsonIgnore]
    public bool IsDeleted => DeletedAt is not null;
}
