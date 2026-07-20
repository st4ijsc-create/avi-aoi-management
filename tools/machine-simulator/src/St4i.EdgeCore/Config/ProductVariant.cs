namespace St4i.EdgeCore.Config;

/// <summary>
/// One product variant — the edge-local mirror of a <c>product_variants</c> row. Every product has
/// an implicit base variant (server convention: <c>code='BASE'</c>, <see cref="IsBase"/>); additional
/// variants layer <see cref="Overrides"/> on top of the base product's
/// <see cref="ProductModel.Points"/> (exclude a point, or patch specific fields on it) rather than
/// duplicating the whole point set.
/// </summary>
public sealed class ProductVariant
{
    public string Code { get; set; } = "";
    public string? Name { get; set; }
    public bool IsBase { get; set; }

    /// <summary>Mirrors the base product's <see cref="ProductModel.PointsConfigVersion"/> — the
    /// contract notes variants track (not independently version) the base's points-config
    /// version.</summary>
    public int PointsConfigVersion { get; set; } = 1;

    /// <summary>Null = inherit the base product's <see cref="ProductModel.ReferenceImageUrl"/>; set
    /// to override it for this variant only.</summary>
    public string? ReferenceImageUrl { get; set; }

    /// <summary>Null = inherit the base product's <see cref="ProductModel.CoordinateMode"/>.</summary>
    public CoordinateMode? CoordinateMode { get; set; }

    public List<VariantPointOverride> Overrides { get; set; } = new();
}
