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

    /// <summary>Wire value <c>"ELECTRICAL"</c>. An in-circuit electrical reading — and the type that
    /// makes <see cref="MeasurementPoint.Unit"/>'s free-text nature load-bearing: the seed's two
    /// electrical points carry <c>Ω</c> and <c>µF</c>, both non-ASCII, which is exactly the input that
    /// forced <see cref="ConfigChecksum"/> to relax STJ's HTML-safe encoder so both ends hash the same
    /// bytes.</summary>
    Electrical,

    /// <summary>Wire value <c>"POSITION"</c>. Placement offset rather than size: the measured quantity
    /// is a displacement from nominal, so <see cref="ToleranceMode.MaxOnly"/> is its natural pairing.
    /// The seed's two POSITION points show the nominal is NOT implied by that pairing — one states
    /// <c>0.0</c> explicitly, the other leaves <see cref="MeasurementPoint.NominalValue"/> null and
    /// carries only the ceiling.</summary>
    Position,

    /// <summary>Wire value <c>"COLOR"</c>. Colour/chromaticity judgement. 🔴 Nothing on this type
    /// carries the reference colour, and nothing in THIS repository supplies one either — the seed's
    /// colour point states its intent through <see cref="MeasurementPoint.MeasurementTypeCode"/>
    /// (<c>COLOR_DELTA_E</c>) and a <c>ΔE</c> unit on the ordinary limit band, and leaves
    /// <see cref="MeasurementPoint.Criteria"/> null. Where a reference colour would live is therefore
    /// an open question here, not a documented slot.</summary>
    Color,

    /// <summary>Wire value <c>"SURFACE"</c>. Finish/texture defects — the seed's two SURFACE points are
    /// a scratch-length check and a coating-gap check, both of which measure a LENGTH against the
    /// ordinary limit band rather than anything surface-specific. Nothing on this type distinguishes
    /// them from a <see cref="Dimension"/> point except this word.</summary>
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

    /// <summary>Wire value <c>"rect"</c>. 🔴 The seed's four rectangles are the clearest evidence that
    /// a shape does NOT fix a payload schema: two spell <c>{"width":…,"height":…,"rotationDeg":…}</c>
    /// and two spell <c>{"width":…,"height":…}</c> with no rotation key at all — and two further
    /// <c>rect</c> points carry no <see cref="MeasurementPoint.Geometry"/> whatsoever. All six persist
    /// and hash identically well. Dimensions are in the product's own
    /// <see cref="ProductModel.CoordinateMode"/> units; a missing <c>rotationDeg</c> is not defined
    /// anywhere to mean zero.</summary>
    Rect,

    /// <summary>Wire value <c>"polygon"</c> — an arbitrary vertex list. The seed's two polygons agree
    /// on a payload of <c>{"points":[[x,y],…]}</c> in absolute
    /// <see cref="ProductModel.CoordinateMode"/> units, and both close the ring implicitly (four
    /// vertices for a rectangle, no repeated first point), which is a convention nothing here
    /// enforces or even reads.</summary>
    Polygon,

    /// <summary>Wire value <c>"line"</c> — a one-dimensional profile rather than an area, and the
    /// natural shape for a width or gap measured ACROSS something. The seed's trace-width point spells
    /// its payload <c>{"x1":…,"y1":…,"x2":…,"y2":…}</c>: note that this is the only shape family whose
    /// geometry carries absolute endpoints rather than an extent around
    /// <see cref="MeasurementPoint.PositionX"/>, so the two coordinate statements can disagree and
    /// nothing reconciles them.</summary>
    Line,

    /// <summary>Wire value <c>"ring"</c> — an annulus, the natural ROI for a solder fillet. The seed's
    /// payload is <c>{"innerRadius":…,"outerRadius":…}</c>, and note that the outer radius is stated
    /// there IN ADDITION to <see cref="MeasurementPoint.Radius"/>, with nothing keeping the two
    /// equal.</summary>
    Ring,

    /// <summary>Wire value <c>"mask"</c> — an arbitrary bitmap/region of interest, and the ONE member
    /// of this enum that no seeded point uses (the other six all appear). So it is also the one shape
    /// for which this repository shows no example payload at all, and its
    /// <see cref="MeasurementPoint.Geometry"/> encoding — a path? an image reference? — is the
    /// server's to define.</summary>
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
    /// which the seed spells in SCREAMING_SNAKE across all fourteen of its points, one distinct value
    /// each (<c>HEIGHT_2D</c>, <c>SOLDER_3D</c>, <c>BGA_XRAY</c>, <c>COLOR_DELTA_E</c>,
    /// <c>ROTATION_OFFSET</c>, …). This is where a check that <see cref="Config.MeasurementType"/> can
    /// only call <c>Other</c> keeps its real name — and note that the seed never needs
    /// <c>Other</c>: fourteen sub-types map onto six of the seven closed members, so the open field is
    /// doing the discriminating work while the closed one stays coarse. 🔴 Never pushed — see this
    /// type's remarks.</summary>
    public string? MeasurementTypeCode { get; set; }

    /// <summary>Unit for the 2D block ONLY — <see cref="LowerLimit"/>, <see cref="UpperLimit"/>,
    /// <see cref="NominalValue"/>, <see cref="TolPlus"/>, <see cref="TolMinus"/>. The 3D block carries
    /// its own <see cref="HeightUnit"/>/<see cref="AreaUnit"/>/<see cref="VolumeUnit"/> and does not
    /// read this one, so a single point can legitimately state several units at once (the seed's solder
    /// point is <c>mm3</c> here and <c>mm</c> for height). Free text with no vocabulary, and the seed's
    /// six values show how wide that is: <c>mm</c>, <c>mm3</c>, <c>deg</c>, <c>Ω</c>, <c>µF</c> and
    /// <c>ΔE</c> — three of them non-ASCII, one of them (<c>ΔE</c>) not a physical unit at all but a
    /// colour-difference metric. Null is the honest value for a check with no measured quantity, as the
    /// label-OCR and presence points show.</summary>
    public string? Unit { get; set; }

    // ── 2D limits + tolerance ───────────────────────────────────────────

    /// <summary>Lower bound of the acceptance band, in <see cref="Unit"/>. 🔴 One of the three
    /// THRESHOLD-GOVERNED fields: pushing a change to it against a product whose
    /// <see cref="ProductModel.LifecycleStatus"/> is anything but
    /// <see cref="ProductLifecycleStatus.Development"/> gets this field silently STRIPPED server-side
    /// while the rest of the point still syncs, and the response marks the point
    /// <c>limitBlocked</c> — a partial success that a caller has to read per point to notice. Null
    /// means the band is open below, which is what <see cref="Config.ToleranceMode.MaxOnly"/>
    /// expects. 🔴 The ordering <c>LowerLimit ≤ NominalValue ≤ UpperLimit</c> is checked in exactly
    /// ONE place, the web's point form, and nothing rejects a violation on the way into
    /// <see cref="ProductConfigStore"/> — a point with the band inverted persists, hashes and
    /// syncs.</summary>
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
    /// absolute units (the seed's fourteen points are all pixel-mode, and span 24 to 140). It is a
    /// capture instruction, not a judgement bound, and is independent of <see cref="Radius"/>: every
    /// seeded point crops a box wider than twice the ROI radius it measures, and the widest crop
    /// belongs to a point with no radius at all.</summary>
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

    /// <summary>Height of the feature above the board datum, in the product's absolute
    /// <see cref="ProductModel.CoordinateMode"/> units — the third coordinate the 2D
    /// <see cref="PositionX"/>/<see cref="PositionY"/> pair cannot carry, so a 3D sensor knows where to
    /// focus. It is a POSITION, not a limit: the acceptance band for height is
    /// <see cref="HeightMin"/>/<see cref="HeightMax"/> below.
    /// <para>This member opens the 3D/solder/x-ray block, and two properties hold for ALL of it:
    /// every field in the block is pull-only (see this type's remarks), and each sub-group carries its
    /// own unit convention instead of reading <see cref="Unit"/>. Exactly two of the seed's fourteen
    /// points populate any of it — a solder-volume point and a BGA X-ray point — and they populate
    /// DIFFERENT subsets, so neither is a complete worked example on its own: the X-ray point is the
    /// only one with <c>Area*</c>, <see cref="WarpageMax"/> or <c>Thickness*</c>, and it is also the
    /// only point in the repository that fills the block end to end.</para></summary>
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
    /// spread. Exactly ONE seeded point populates the <c>Area*</c> group (the BGA X-ray point), and it
    /// is worth reading beside its <c>Volume*</c> values: area <c>0.15..0.35</c> against volume
    /// <c>0.05..0.18</c> in the same point, i.e. the two groups are independent criteria on one joint,
    /// not two views of one number.</summary>
    public double? AreaMin { get; set; }

    /// <summary>Maximum acceptable area, in <see cref="AreaUnit"/> — bridging or excess spread. 🔴 The
    /// pairing with <see cref="AreaMin"/> is a CONVENTION, not a constraint: nothing here checks that
    /// this exceeds it, nothing requires both to be present, and a point stating only this one is a
    /// perfectly ordinary one-sided ceiling.</summary>
    public double? AreaMax { get; set; }

    /// <summary>Target area, in <see cref="AreaUnit"/> — and, like every <c>*Nominal</c> in this block,
    /// it is decoration for the operator rather than an input to any judgement: it is not pushed
    /// (see this type's remarks), no code here reads it, and it is not required to lie between
    /// <see cref="AreaMin"/> and <see cref="AreaMax"/>.</summary>
    public double? AreaNominal { get; set; }

    /// <summary>Unit for the three <c>Area*</c> values only. The seed writes <c>mm2</c> — ASCII digit,
    /// no superscript, matching <see cref="VolumeUnit"/>'s <c>mm3</c> — so all three unit fields on
    /// this type follow the same spelling rule, and anything comparing these strings should expect it.
    /// It is still free text: nothing rejects <c>mm²</c>, and the two would not compare
    /// equal.</summary>
    public string? AreaUnit { get; set; }

    /// <summary>Minimum acceptable solder VOLUME, in <see cref="VolumeUnit"/> — the primary
    /// insufficient-solder criterion for a 3D joint inspection, and the field both of the seed's 3D
    /// points set even though they disagree about everything else in this block. Note the trap in the
    /// pairing with <see cref="Unit"/>: a volume point's <see cref="Unit"/> may itself read
    /// <c>mm3</c>, which makes the two look interchangeable — they are not, and only this one governs
    /// the three <c>Volume*</c> numbers.</summary>
    public double? VolumeMin { get; set; }

    /// <summary>Maximum acceptable volume, in <see cref="VolumeUnit"/> — excess solder, which is a real
    /// defect rather than a harmless surplus because it is what bridges neighbouring pads. Both seeded
    /// 3D points set it, and both state a CLOSED band — unlike the 2D limits, where the seed's
    /// commonest shape is a lone ceiling with nothing below it.</summary>
    public double? VolumeMax { get; set; }

    /// <summary>Target volume, in <see cref="VolumeUnit"/>. Same standing as
    /// <see cref="AreaNominal"/>: never pushed, never read here, and not checked against the
    /// surrounding band — both seeded points place it inside theirs, and nothing would have stopped
    /// them putting it outside.</summary>
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
    /// terminations disagreeing about where the plane is — a distinction from the SMT domain rather
    /// than one this repository encodes. Only the BGA X-ray point sets it, and it sets it TIGHTER than
    /// that point's own coplanarity ceiling, which is the ordering the two names would not have
    /// predicted.</summary>
    public double? WarpageMax { get; set; }

    /// <summary>Maximum void fraction inside a joint, as a PERCENTAGE 0–100 — the seed's two values are
    /// <c>25.0</c> and <c>15.0</c>, and the tighter one belongs to the X-ray point, i.e. to the
    /// inspection that can actually see inside the ball. The <c>Pct</c> in the name is the only place
    /// that unit is stated; it does not follow <see cref="Unit"/> or any of the three unit fields
    /// above.</summary>
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
    /// tombstoned or lifted component. No other member of this block is angular, so there is no shared
    /// unit field for it. 🔴 The degree reading is CONFIRMED by the seed rather than assumed, and by a
    /// point that states the same angle twice: the rotation-offset point sets
    /// <see cref="UpperLimit"/> <c>5.0</c> with <see cref="Unit"/> <c>"deg"</c> AND
    /// <see cref="TiltMax"/> <c>5.0</c> — one number, two fields, one of which names its unit and one
    /// of which cannot. Nothing keeps the pair in step, so that duplication is the strongest evidence
    /// available here and a live inconsistency waiting to happen.</summary>
    public double? TiltMax { get; set; }

    /// <summary>Minimum acceptable material thickness (paste deposit, plating, conformal coating).
    /// 🔴 It has NO unit field of its own: <see cref="HeightUnit"/>, <see cref="AreaUnit"/> and
    /// <see cref="VolumeUnit"/> each govern their own trio, and this pair governs nothing — so a reader
    /// has to infer the frame from the point's other 3D values. The one seeded example makes that
    /// inference concrete rather than safe: it states <c>0.02</c> beside heights in <c>mm</c>, so
    /// millimetres is the reading, and it is a reading rather than a declaration.</summary>
    public double? ThicknessMin { get; set; }

    /// <summary>Maximum acceptable thickness, with the same unit-less standing as
    /// <see cref="ThicknessMin"/>. Together they form a CLOSED band in the one seeded example
    /// (<c>0.02</c>–<c>0.10</c>), which is what separates them from the single-sided ceilings
    /// (<see cref="CoplanarityMax"/>, <see cref="WarpageMax"/>, <see cref="TiltMax"/>) that make up
    /// most of this block.</summary>
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
