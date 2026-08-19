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
    /// vocabulary; the seed's fifteen shots use exactly four values — <c>LED_RING</c>, <c>LED_BAR</c>,
    /// <c>DOME</c> and <c>XRAY</c> — so a reader should expect SCREAMING_SNAKE hardware identifiers
    /// here rather than the lowercase words the point-level enums use. <c>XRAY</c> is worth noticing
    /// separately: it is not a lamp, and the shot that carries it sets no <see cref="Color"/> or
    /// <see cref="ColorHex"/> at all, so those two being null is a legitimate state rather than a gap
    /// to fill.</summary>
    public string? LightSource { get; set; }

    /// <summary>Human-readable colour name (the seed uses only <c>"white"</c> and <c>"amber"</c>), the
    /// loose partner of the machine-readable <see cref="ColorHex"/>. The two are independent fields
    /// with nothing keeping them in agreement — a shot can carry <c>"amber"</c> beside <c>#FFFFFF</c>
    /// and no code path notices. Null is a real state, not an oversight: the X-ray shot sets neither
    /// this nor <see cref="ColorHex"/>, because it has no visible-light colour to state.</summary>
    public string? Color { get; set; }

    /// <summary>The colour a renderer should actually use, as an uppercase <c>#RRGGBB</c> string —
    /// which is a convention of the seed's two values, not a rule: nothing parses or validates this,
    /// so any string round-trips, and a consumer that intends to paint with it must handle malformed
    /// input itself.</summary>
    public string? ColorHex { get; set; }

    /// <summary>Illuminator brightness as a PERCENTAGE, 0–100 — not the 0..1 fraction the normalized
    /// geometry fields on <see cref="MeasurementPoint"/> use. The seed's fifteen shots run from 55 to
    /// 100 and every one of them sets it, so this is the one lighting field for which no shot in this
    /// repository demonstrates the null case. Nothing clamps it; a value of 150 persists.</summary>
    public double? IntensityPct { get; set; }

    /// <summary>Angle of incidence in DEGREES, measured from the board plane rather than from the
    /// optical axis. That convention is stated nowhere in the contract and is readable only from the
    /// seed's own six values — <c>90</c> for coaxial bright-field (straight down), <c>0</c> for a
    /// diffuse dome, and <c>15</c>/<c>25</c>/<c>30</c>/<c>45</c> for the grazing and oblique shots.
    /// A reader who assumed the other convention would read the dome shot as vertical and the coaxial
    /// shot as horizontal, i.e. exactly inverted.</summary>
    public double? AngleDeg { get; set; }

    /// <summary>Camera exposure in MICROSECONDS. The unit is carried in the name because the wire field
    /// is likewise <c>exposureUs</c>, and nothing here converts to or from milliseconds — so the seed's
    /// span, 900 up to 8000, is just under 1 ms to 8 ms, and the top of it belongs to the X-ray shot
    /// rather than to any lamp.</summary>
    public double? ExposureUs { get; set; }

    /// <summary>Sensor gain as a DIMENSIONLESS MULTIPLIER, where <c>1.0</c> is unity. It is NOT
    /// decibels — on a dB reading the seed's span of 1.0 to 2.0 would be a 100× spread rather than a
    /// 2× one — and the contract gives no unit at all, so this reading comes from the seed's own values
    /// and should be re-checked against a real camera before anyone drives hardware from it. The values
    /// track darkness rather than shot type: unity for the well-lit shots, and the six above it climb
    /// with the dark-field, grazing and X-ray captures.</summary>
    public double? Gain { get; set; }

    /// <summary>Focus offset from the product's nominal focal plane, in MICROMETRES, signed. 🔴 One
    /// shot of the seed's fifteen sets it, and sets it to <c>0</c>; the other fourteen leave it NULL,
    /// which for a <see cref="double"/>? is not the same statement — "no offset requested" versus
    /// "offset requested, and it is zero" are distinguishable here and nothing collapses them. A
    /// per-shot refocus is how a 3D solder inspection reaches a paste height a flat board's focus would
    /// miss.</summary>
    public double? FocusOffsetUm { get; set; }

    /// <summary>Optical filter in the path for this shot (polariser, bandpass, …). The contract
    /// enumerates no vocabulary and NO seed shot sets it — so it is the one member of this type for
    /// which this repository has never observed a real value, and a reader should not infer a format
    /// from its absence.</summary>
    public string? OpticalFilter { get; set; }

    /// <summary>Why this shot exists, as a free-form tag. The load-bearing observation is the CASING,
    /// not the vocabulary: all twelve distinct values the seed's fifteen shots use are lowercase, and
    /// two of them (<c>void_detection</c>, <c>orientation</c>) show the tag is not drawn from any
    /// closed list — it tracks the inspection's intent, so it grows with the catalogue. It is
    /// documentation for whoever tunes the recipe, not a selector: no code branches on it, so two shots
    /// may claim the same purpose.</summary>
    public string? Purpose { get; set; }
}
