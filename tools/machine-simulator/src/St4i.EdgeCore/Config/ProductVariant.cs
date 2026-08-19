namespace St4i.EdgeCore.Config;

/// <summary>
/// One product variant — the edge-local mirror of a <c>product_variants</c> row. Every product has
/// an implicit base variant (server convention: <c>code='BASE'</c>, <see cref="IsBase"/>); additional
/// variants layer <see cref="Overrides"/> on top of the base product's
/// <see cref="ProductModel.Points"/> (exclude a point, or patch specific fields on it) rather than
/// duplicating the whole point set.
/// </summary>
/// <remarks>
/// 🔴 WHO DOES THE LAYERING IS NOT THIS ASSEMBLY, and the summary above deliberately does not say it
/// is. Nothing under <c>St4i.EdgeCore</c> or <c>St4i.EngineApi</c> ever merges an
/// <see cref="Overrides"/> entry into a point: variant resolution is the SERVER's, requested through
/// <c>get-points?variantCode=</c>. The two backends behave differently and a reader has to know which
/// one is wired — <c>LiveConfigSyncBackend</c> forwards <c>variantCode</c> to the real server, which
/// resolves it; <c>SimulatedEcosystem</c> (Demo) accepts the argument and ignores it, returning the
/// BASE product every time, which <c>St4i.EngineApi.Config.IConfigSyncBackend.GetPointsAsync</c>
/// states in its own doc comment as a named parity gap rather than a hidden one. A variant stored here
/// is therefore AUTHORING DATA held for the ecosystem, never an instruction this side executes.
/// Like <see cref="Fiducial"/>, a variant also sits outside both drift signals — see that type's
/// remarks for the mechanism.
/// </remarks>
public sealed class ProductVariant
{
    /// <summary>Natural key within the product, mirroring <c>product_variants.code</c>. The server's
    /// convention spells the implicit base variant <c>BASE</c> (see this type's summary); nothing here
    /// enforces that spelling, nor uniqueness within <see cref="ProductModel.Variants"/>.</summary>
    public string Code { get; set; } = "";

    /// <summary>Operator-facing label for the variant, e.g. a customer or revision name. Null is
    /// normal — <see cref="Code"/> is what identifies a variant everywhere.</summary>
    public string? Name { get; set; }

    /// <summary>True on the one variant that IS the base product rather than a patch of it, mirroring
    /// <c>product_variants.isBase</c>. It is a flag this side only records: no invariant here keeps at
    /// most one variant marked base, keeps a base variant's <see cref="Overrides"/> empty, or ties the
    /// flag to <see cref="Code"/> being <c>BASE</c> — a product carrying two bases, or none, persists
    /// and round-trips without complaint.</summary>
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

    /// <summary>This variant's patches against the base product's points, mirroring
    /// <c>variant_point_overrides</c>. 🔴 NOTHING IN THIS SOLUTION EVER APPLIES THEM — the list is
    /// deserialized, persisted to <c>products.json</c>, deep-cloned in and out of
    /// <see cref="ProductConfigStore"/>, and read back unchanged; see this type's remarks for who does
    /// the merging and why. Consequently a caller reading
    /// <see cref="ProductModel.ActivePoints"/> is always looking at BASE points, whatever variant it
    /// believes it selected. Empty is the normal state for a base variant.</summary>
    public List<VariantPointOverride> Overrides { get; set; } = new();
}
