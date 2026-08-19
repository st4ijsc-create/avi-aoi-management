namespace St4i.EdgeCore.Config;

/// <summary>
/// One camera-lighting configuration used to capture a <see cref="MeasurementPoint"/> — the
/// edge-local mirror of an <c>mp_lighting_profiles</c> row, matching the contract's
/// <c>lighting:[{shotIndex,name,lightSource,color,colorHex,intensityPct,angleDeg,exposureUs,gain,
/// focusOffsetUm,opticalFilter,purpose}]</c> exactly. A point with multiple shots (e.g. bright-field
/// + dark-field for a solder joint) has one <see cref="LightingShot"/> per <see cref="ShotIndex"/>.
/// <c>lightSource</c>/<c>color</c>/<c>opticalFilter</c>/<c>purpose</c> have no enumerated vocabulary
/// in the contract, so they stay plain nullable strings.
/// </summary>
/// <remarks>
/// Two properties of this whole type, true of every member below and stated once here rather than
/// twelve times:
/// <list type="bullet">
///   <item>NOTHING IN THIS SOLUTION READS ANY OF THESE VALUES. A lighting shot is deserialized,
///   persisted, diffed, hashed and rendered — never acted on. There is no illuminator to drive: the
///   AOI simulator (<c>AoiInspectorSim</c>) draws its verdicts from a random distribution and never
///   looks at <see cref="MeasurementPoint.Lighting"/>. So each unit named below is the unit the
///   ECOSYSTEM's optics use, carried faithfully — not a unit anything here converts or validates.
///   No member is range-checked, clamped, or required to be internally consistent with any other.</item>
///   <item>A LIGHTING EDIT MADE AT THIS MACHINE CAN NEVER REACH THE SERVER. The whole list is inside
///   <see cref="ConfigChecksum.CanonicalizePoint(MeasurementPoint)"/>'s hash, so changing any field
///   here moves the point's drift key and the operator's badge flips to <c>drift</c> — but
///   <c>sync-points</c>'s request body (CONFIG_SYNC_SERVER_CONTRACT.md §"Push up", mirrored field for
///   field by <c>ConfigSyncEngine.ToWireDto</c>) has no <c>lighting</c> slot at all. The only way that
///   drift ever clears is a PULL, which overwrites the local edit. See
///   <see cref="MeasurementPoint"/>'s own remarks for the full set of fields in that position.</item>
/// </list>
/// </remarks>
public sealed class LightingShot
{
    /// <summary>0-based position of this shot in its point's <see cref="MeasurementPoint.Lighting"/>
    /// list, and the contract's <c>shotIndex</c>. It is an IDENTITY, not an ordering hint: the seed's
    /// two-shot solder point pairs shot 0 (bright-field) with shot 1 (dark-field), and a later
    /// pull/diff matches shots up by this number. Nothing here enforces that the values are unique
    /// within a point, dense, or ascending — a list with two shots both numbered 0 persists and hashes
    /// without complaint.</summary>
    public int ShotIndex { get; set; }

    /// <summary>Operator-facing label for this shot, shown as-is wherever a shot is listed (e.g.
    /// <c>"Bright-field coax"</c>, <c>"Dark-field"</c>). Free text with no vocabulary and no bearing on
    /// behaviour — <see cref="ShotIndex"/>, not this, is what identifies a shot.</summary>
    public string? Name { get; set; }

    /// <summary>Which illuminator the ecosystem's optics should energise. The contract enumerates no
    /// vocabulary; the values this repository's own seed uses are <c>LED_RING</c>, <c>LED_BAR</c> and
    /// <c>DOME</c>, so a reader should expect SCREAMING_SNAKE hardware identifiers here rather than the
    /// lowercase words the point-level enums use.</summary>
    public string? LightSource { get; set; }

    /// <summary>Human-readable colour name (<c>"white"</c>, <c>"amber"</c>), the loose partner of the
    /// machine-readable <see cref="ColorHex"/>. The two are independent fields with nothing keeping
    /// them in agreement — a shot can carry <c>"amber"</c> beside <c>#FFFFFF</c> and no code path
    /// notices.</summary>
    public string? Color { get; set; }

    /// <summary>The colour a renderer should actually use, as the <c>#RRGGBB</c> string the seed
    /// writes. Nothing parses or validates it here, so any string round-trips; a consumer that intends
    /// to paint with it must handle malformed input itself.</summary>
    public string? ColorHex { get; set; }

    /// <summary>Illuminator brightness as a PERCENTAGE, 0–100 (the seed spans 60–90) — not the 0..1
    /// fraction the normalized geometry fields on <see cref="MeasurementPoint"/> use. Nothing clamps
    /// it; a value of 150 persists.</summary>
    public double? IntensityPct { get; set; }

    /// <summary>Angle of incidence in DEGREES, measured from the board plane, not from the optical
    /// axis: the seed's coaxial bright-field shots are <c>90</c> (straight down), its dark-field void
    /// shot is <c>25</c> (grazing), and its diffuse dome shot is <c>0</c>. That convention is readable
    /// only from those values — the contract states none.</summary>
    public double? AngleDeg { get; set; }

    /// <summary>Camera exposure in MICROSECONDS (seed range 900–3200, i.e. roughly 1–3 ms). The unit is
    /// carried in the name because the wire field is likewise <c>exposureUs</c>; nothing here converts
    /// to or from milliseconds.</summary>
    public double? ExposureUs { get; set; }

    /// <summary>Sensor gain as a DIMENSIONLESS MULTIPLIER, where <c>1.0</c> is unity — the seed raises
    /// it to <c>1.4</c> only for the dim dark-field shot. It is NOT decibels, and the contract gives no
    /// unit at all, so this reading comes from the seed's own values and should be re-checked against a
    /// real camera before anyone drives hardware from it.</summary>
    public double? Gain { get; set; }

    /// <summary>Focus offset from the product's nominal focal plane, in MICROMETRES, signed
    /// (<c>0</c> = at nominal, which is what every seed shot uses). A per-shot refocus is how a 3D
    /// solder inspection reaches a paste height a flat board's focus would miss.</summary>
    public double? FocusOffsetUm { get; set; }

    /// <summary>Optical filter in the path for this shot (polariser, bandpass, …). The contract
    /// enumerates no vocabulary and NO seed shot sets it — so it is the one member of this type for
    /// which this repository has never observed a real value, and a reader should not infer a format
    /// from its absence.</summary>
    public string? OpticalFilter { get; set; }

    /// <summary>Why this shot exists, as a free-form tag the seed writes in lowercase
    /// (<c>height</c>, <c>shape</c>, <c>void</c>, <c>placement</c>, <c>ocr</c>). It is documentation
    /// for whoever tunes the recipe, not a selector: no code branches on it, so two shots may claim the
    /// same purpose.</summary>
    public string? Purpose { get; set; }
}
