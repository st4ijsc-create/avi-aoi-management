using System.Text.Json.Serialization;

namespace St4i.EdgeCore.Config;

/// <summary>Lifecycle stage of a product model — mirrors <c>product_models.lifecycleStatus</c>
/// exactly (<c>development|active|eol|archived</c>). Threshold governance (server-side, System B
/// push) treats anything other than <see cref="Development"/> as "protected": limit-field edits a
/// machine pushes get stripped/blocked unless <c>THRESHOLD_GATE_ENFORCED=false</c> — see
/// CONFIG_SYNC_SERVER_CONTRACT.md's "Threshold governance" section. Purely descriptive in EdgeCore;
/// C2's SimulatedEcosystem (Demo) / the real server (Live) are where that rule is actually
/// enforced.</summary>
[JsonConverter(typeof(SnakeLowerEnumConverter))]
public enum ProductLifecycleStatus { Development, Active, Eol, Archived }

/// <summary>Coordinate system points/fiducials are authored in — mirrors
/// <c>product_models.coordinateMode</c> (<c>pixel|mm</c>).</summary>
[JsonConverter(typeof(SnakeLowerEnumConverter))]
public enum CoordinateMode { Pixel, Mm }

/// <summary>
/// One AOI/AVI product's full points-config aggregate — the edge-local mirror of a
/// <c>product_models</c> row plus everything <c>GET /api/machine/get-points</c> nests under it
/// (fiducials, variants, points). <see cref="Code"/> is the natural key: it matches the server's
/// unique <c>product_models.code</c> and the <c>(productModelId, code)</c> pair <c>sync-points</c>
/// upserts by. This local model deliberately carries no server-assigned numeric id — identity
/// travels by code until a config has actually been synced, at which point a later task (C2/C3) owns
/// reconciling it against whatever id the ecosystem assigned.
/// </summary>
public sealed class ProductModel
{
    public string Code { get; set; } = "";
    public string Name { get; set; } = "";
    public ProductLifecycleStatus LifecycleStatus { get; set; } = ProductLifecycleStatus.Development;

    public string? ReferenceImageUrl { get; set; }
    public int? ImageWidth { get; set; }
    public int? ImageHeight { get; set; }

    /// <summary>sha256 of the reference image bytes — mirrors <c>product_models.imageHash</c>, which
    /// the server uses to dedupe re-uploads of an unchanged image. Null until a real image has
    /// actually been hashed (locally-authored placeholder paths don't get one).</summary>
    public string? ImageHash { get; set; }

    public CoordinateMode CoordinateMode { get; set; } = CoordinateMode.Pixel;

    /// <summary>Bumped on every points-config change (add/edit/soft-delete a point, or a successful
    /// pull/push) — mirrors <c>product_models.pointsConfigVersion</c>, the value
    /// check-points-version/get-points compare against for drift. Use <see cref="BumpVersion"/>
    /// rather than incrementing the field directly so every call site does it the same way.</summary>
    public int PointsConfigVersion { get; set; } = 1;

    public List<Fiducial> Fiducials { get; set; } = new();
    public List<ProductVariant> Variants { get; set; } = new();
    public List<MeasurementPoint> Points { get; set; } = new();

    /// <summary>Points with no soft-delete tombstone, in authoring order — what an inspection
    /// program / the points-editor canvas should actually render. Excludes anything
    /// <see cref="MeasurementPoint.IsDeleted"/>. Computed, not persisted.</summary>
    [JsonIgnore]
    public IEnumerable<MeasurementPoint> ActivePoints =>
        Points.Where(p => !p.IsDeleted).OrderBy(p => p.OrderIndex);

    public void BumpVersion() => PointsConfigVersion++;
}
