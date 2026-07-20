using System.Text.Json;
using System.Text.Json.Serialization;

namespace St4i.EdgeCore.Config;

/// <summary>What kind of check this point performs — mirrors the server's
/// <c>measurementType</c> (<c>DIMENSION|VISUAL|ELECTRICAL|POSITION|COLOR|SURFACE|OTHER</c>). Spelled
/// in caps on the wire (unlike every other enum in this file) — see
/// <see cref="SnakeUpperEnumConverter"/>.</summary>
[JsonConverter(typeof(SnakeUpperEnumConverter))]
public enum MeasurementType { Dimension, Visual, Electrical, Position, Color, Surface, Other }

/// <summary>How <see cref="MeasurementPoint.LowerLimit"/>/<see cref="MeasurementPoint.UpperLimit"/>
/// gate a measured value — mirrors <c>measurement_point_defs.toleranceMode</c>
/// (<c>min_only|max_only|range|bilateral</c>).</summary>
[JsonConverter(typeof(SnakeLowerEnumConverter))]
public enum ToleranceMode { MinOnly, MaxOnly, Range, Bilateral }

/// <summary>The ROI/marker geometry family a point's <see cref="MeasurementPoint.Geometry"/> (and,
/// for <see cref="Array"/>, <see cref="MeasurementPoint.Cells"/>) is interpreted against — mirrors
/// <c>measurement_point_defs.shape</c> (<c>circle|rect|polygon|line|ring|mask|array</c>).</summary>
[JsonConverter(typeof(SnakeLowerEnumConverter))]
public enum PointShape { Circle, Rect, Polygon, Line, Ring, Mask, Array }

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
public sealed class MeasurementPoint
{
    // ── Identity / description ─────────────────────────────────────────
    public string Code { get; set; } = "";
    public string Name { get; set; } = "";
    public string? Description { get; set; }

    // ── Type / unit ─────────────────────────────────────────────────────
    public MeasurementType MeasurementType { get; set; } = MeasurementType.Dimension;
    public string? MeasurementTypeCode { get; set; }
    public string? Unit { get; set; }

    // ── 2D limits + tolerance ───────────────────────────────────────────
    public double? LowerLimit { get; set; }
    public double? UpperLimit { get; set; }
    public double? NominalValue { get; set; }
    public ToleranceMode? ToleranceMode { get; set; }
    public double? TolPlus { get; set; }
    public double? TolMinus { get; set; }

    // ── Position (in the product's CoordinateMode) + normalized (0..1, resolution-independent) ──
    public double PositionX { get; set; }
    public double PositionY { get; set; }
    public double? Radius { get; set; }
    public double? NormalizedX { get; set; }
    public double? NormalizedY { get; set; }
    public double? NormalizedRadius { get; set; }

    // ── Crop / ordering / enable ────────────────────────────────────────
    public int? CropWidth { get; set; }
    public int? CropHeight { get; set; }
    public int OrderIndex { get; set; }

    /// <summary>Temporarily enable/disable this point without deleting it — distinct from the
    /// soft-delete tombstone (<see cref="DeletedAt"/>): an inactive point still exists and still
    /// syncs, it's just excluded from live inspection.</summary>
    public bool IsActive { get; set; } = true;

    // ── Shape / geometry (jsonb per shape — arbitrary JSON, so JsonElement) ────────────────────
    public PointShape Shape { get; set; } = PointShape.Circle;
    public JsonElement? Geometry { get; set; }

    /// <summary>Per-cell geometry when <see cref="Shape"/> is <see cref="PointShape.Array"/> (e.g. a
    /// BGA ball grid) — mirrors the contract's <c>cells(if shape=array)</c>. Null for every other
    /// shape.</summary>
    public JsonElement? Cells { get; set; }

    // ── 3D / solder / x-ray ─────────────────────────────────────────────
    public double? PositionZ { get; set; }

    public double? HeightMin { get; set; }
    public double? HeightMax { get; set; }
    public double? HeightNominal { get; set; }
    public string? HeightUnit { get; set; }

    public double? AreaMin { get; set; }
    public double? AreaMax { get; set; }
    public double? AreaNominal { get; set; }
    public string? AreaUnit { get; set; }

    public double? VolumeMin { get; set; }
    public double? VolumeMax { get; set; }
    public double? VolumeNominal { get; set; }
    public string? VolumeUnit { get; set; }

    public double? CoplanarityMax { get; set; }
    public double? WarpageMax { get; set; }
    public double? VoidPctMax { get; set; }
    public double? OffsetXMax { get; set; }
    public double? OffsetYMax { get; set; }
    public double? TiltMax { get; set; }
    public double? ThicknessMin { get; set; }
    public double? ThicknessMax { get; set; }

    /// <summary>Free-form pass/fail criteria beyond the typed limit fields above (jsonb on the
    /// server) — e.g. an OCR pattern + minimum confidence for a label-presence point.</summary>
    public JsonElement? Criteria { get; set; }

    /// <summary>The lighting recipe (one entry per camera shot) used to capture/inspect this point —
    /// mirrors <c>mp_lighting_profiles</c>.</summary>
    public List<LightingShot> Lighting { get; set; } = new();

    // ── Image + audit ────────────────────────────────────────────────────
    public DateTimeOffset? LastModifiedAt { get; set; }
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
