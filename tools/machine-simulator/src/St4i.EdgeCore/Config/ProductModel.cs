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
public enum ProductLifecycleStatus
{
    /// <summary>Wire value <c>"development"</c>, and the default a fresh <see cref="ProductModel"/>
    /// carries. The ONE status that is not "protected": it is the only value under which the server
    /// will accept limit-field edits pushed up from a machine (and even then only while no inspection
    /// program has been released against the product). Every other member below behaves identically
    /// for that purpose — the gate is <c>== Development</c>, not a ranking.</summary>
    Development,

    /// <summary>Wire value <c>"active"</c> — released to production. Protected: a push that changes
    /// <see cref="MeasurementPoint.LowerLimit"/>/<see cref="MeasurementPoint.UpperLimit"/>/
    /// <see cref="MeasurementPoint.NominalValue"/> on an existing point has those three fields STRIPPED
    /// server-side while the rest of the point still syncs, and comes back flagged
    /// <c>limitBlocked</c>.</summary>
    Active,

    /// <summary>Wire value <c>"eol"</c> (end-of-life, spelled as the bare three letters, NOT
    /// <c>end_of_life</c>) — no longer built, still inspectable for repair or field returns.
    /// Protected, exactly as <see cref="Active"/> is.</summary>
    Eol,

    /// <summary>Wire value <c>"archived"</c> — retired from the catalogue and kept for history.
    /// Protected, exactly as <see cref="Active"/> is; nothing here hides an archived product from
    /// lookup, so a machine can still be pointed at one.</summary>
    Archived,
}

/// <summary>Coordinate system points/fiducials are authored in — mirrors
/// <c>product_models.coordinateMode</c> (<c>pixel|mm</c>).</summary>
[JsonConverter(typeof(SnakeLowerEnumConverter))]
public enum CoordinateMode
{
    /// <summary>Wire value <c>"pixel"</c>, and the default. Absolute coordinates
    /// (<see cref="MeasurementPoint.PositionX"/>, <see cref="Fiducial.PositionX"/>,
    /// <see cref="MeasurementPoint.Radius"/>, the crop sizes) are pixels of THIS product's
    /// <see cref="ProductModel.ReferenceImageUrl"/> image, so they are only meaningful beside
    /// <see cref="ProductModel.ImageWidth"/>/<see cref="ProductModel.ImageHeight"/> — which is exactly
    /// why the normalized 0..1 twins exist.</summary>
    Pixel,

    /// <summary>Wire value <c>"mm"</c> (millimetres) — the same absolute fields read as real-world
    /// board dimensions instead of image pixels. 🔴 Switching a product to this does NOT reinterpret
    /// anything on this side: the normalized twins are still divided by
    /// <see cref="ProductModel.ImageWidth"/>/<see cref="ProductModel.ImageHeight"/> by every consumer
    /// that derives them (<c>AoiInspectorSim.ResolveRealPoints</c>, <c>Hmi.tsx</c>), so a millimetre
    /// product whose image dimensions are pixels will place points wrongly unless the authored
    /// normalized values are supplied directly.</summary>
    Mm,
}

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
    /// <summary>Natural key, matching the server's unique <c>product_models.code</c> and the
    /// <c>(productModelId, code)</c> pair <c>sync-points</c> upserts by (see this type's summary).
    /// <see cref="ProductConfigStore"/> keys its dictionary on it case-INSENSITIVELY, so
    /// <c>MODEL-A</c> and <c>model-a</c> are one product locally — a narrower identity than the
    /// server's, which is where a case-varying re-pull would first show up as trouble.</summary>
    public string Code { get; set; } = "";

    /// <summary>Human-readable product name. 🔴 This is one of the places where "the property name IS
    /// the wire field name" does NOT hold: <c>get-points</c> spells it <c>productModelName</c>, and
    /// <c>LiveConfigSyncBackend.ToProductModel</c> is what re-seats it here. Unlike
    /// <see cref="MeasurementPoint"/> and <see cref="Fiducial"/>, which are deserialized straight off
    /// the wire, this aggregate always passes through that hand-written mapping — so renaming a member
    /// of THIS type breaks a local file format, while renaming one of theirs breaks a live
    /// integration.</summary>
    public string Name { get; set; } = "";

    /// <summary>Where the product sits in its life cycle — the input to the server's threshold
    /// governance, spelled out on each <see cref="ProductLifecycleStatus"/> member. 🔴 A Live pull can
    /// never populate it truthfully: <c>get-points</c>' response shape carries no
    /// <c>lifecycleStatus</c> at all, and the wire record it deserializes into has no member for one
    /// either, so <c>LiveConfigSyncBackend.ToProductModel</c> leaves every pulled product at the
    /// <see cref="ProductLifecycleStatus.Development"/> default. That is not a mapping that forgot a
    /// field — there is nothing arriving to map. Reading this as "so limit edits will be accepted" is
    /// therefore unsafe: locally it reads <c>Development</c> for products the ecosystem may hold as
    /// released, and the real verdict arrives only as <c>limitBlocked</c> on the sync-points
    /// response.</summary>
    public ProductLifecycleStatus LifecycleStatus { get; set; } = ProductLifecycleStatus.Development;

    /// <summary>The board image points are authored against. Three different kinds of string land here
    /// and nothing distinguishes them: a path RELATIVE to the web bundle's assets (what this
    /// repository seeds — <c>assets/products/model-a-board.png</c>, resolved by the web's
    /// <c>resolveProductImageUrl</c>), an absolute URL, or a base64 <c>data:</c> URL, which is what the
    /// ecosystem returns when its <c>STORAGE_MODE</c> is local. Null renders as the honest "no image"
    /// state rather than a broken image.</summary>
    public string? ReferenceImageUrl { get; set; }

    /// <summary>Pixel width of <see cref="ReferenceImageUrl"/>'s image, mirroring
    /// <c>product_models.imageWidth</c>. Its real job is to be the DENOMINATOR that turns an absolute
    /// <see cref="MeasurementPoint.PositionX"/> into a normalized 0..1 one; consumers that do that
    /// treat a null or non-positive value as "unknown" and fall back to centring the point
    /// (<c>AoiInspectorSim.ResolveRealPoints</c> tests <c>is &gt; 0</c> before dividing). 🔴 It is NOT
    /// the divisor for <see cref="MeasurementPoint.NormalizedRadius"/> in any code path — no code in
    /// this solution derives that value at all; it is authored by hand and only range-checked to
    /// [0,1] by the web's point form. Width is nonetheless the frame the AUTHOR is expected to use
    /// (see that member's own doc for the arithmetic the seed makes checkable), which is a convention
    /// nothing enforces.</summary>
    public int? ImageWidth { get; set; }

    /// <summary>Pixel height of the same image, and the denominator for the Y axis only. Same
    /// null/non-positive handling as <see cref="ImageWidth"/>.</summary>
    public int? ImageHeight { get; set; }

    /// <summary>sha256 of the reference image bytes — mirrors <c>product_models.imageHash</c>, which
    /// the server uses to dedupe re-uploads of an unchanged image. Null until a real image has
    /// actually been hashed (locally-authored placeholder paths don't get one).</summary>
    public string? ImageHash { get; set; }

    /// <summary>Which frame the absolute coordinates on this product's points and fiducials are
    /// expressed in — the two readings, and the fact that nothing here converts between them, are on
    /// the <see cref="Config.CoordinateMode"/> members themselves.</summary>
    public CoordinateMode CoordinateMode { get; set; } = CoordinateMode.Pixel;

    /// <summary>Bumped on every points-config change (add/edit/soft-delete a point, or a successful
    /// pull/push) — mirrors <c>product_models.pointsConfigVersion</c>, the value
    /// check-points-version/get-points compare against for drift. Use <see cref="BumpVersion"/>
    /// rather than incrementing the field directly so every call site does it the same way.</summary>
    public int PointsConfigVersion { get; set; } = 1;

    /// <summary>Alignment marks for this board, in list order (see <see cref="Fiducial"/>, whose
    /// remarks explain why editing this list moves neither drift signal). A Live pull replaces the
    /// whole list at once; there is no per-fiducial endpoint, so every fiducial change is a
    /// whole-product write.</summary>
    public List<Fiducial> Fiducials { get; set; } = new();

    /// <summary>This product's variants (see <see cref="ProductVariant"/>). 🔴 ALWAYS EMPTY after a
    /// Live pull: <c>get-points</c>' product shape has no variants array and
    /// <c>LiveConfigSyncBackend.ToProductModel</c> assigns nothing here, so a non-empty list means the
    /// variants were authored locally or seeded — never that the ecosystem told us about
    /// them.</summary>
    public List<ProductVariant> Variants { get; set; } = new();

    /// <summary>EVERY point this product has ever had, tombstones included — not the inspectable set.
    /// <see cref="ActivePoints"/> is the filtered, ordered view a program should render, and
    /// <see cref="ConfigChecksum.ComputePointsChecksum(IEnumerable{MeasurementPoint})"/> likewise drops
    /// tombstoned points before hashing. Iterating this list directly is how a soft-deleted point
    /// silently comes back into an inspection.</summary>
    public List<MeasurementPoint> Points { get; set; } = new();

    /// <summary>Points with no soft-delete tombstone, in authoring order — what an inspection
    /// program / the points-editor canvas should actually render. Excludes anything
    /// <see cref="MeasurementPoint.IsDeleted"/>. Computed, not persisted.</summary>
    [JsonIgnore]
    public IEnumerable<MeasurementPoint> ActivePoints =>
        Points.Where(p => !p.IsDeleted).OrderBy(p => p.OrderIndex);

    /// <summary>Increments <see cref="PointsConfigVersion"/> by one — the single sanctioned way to move
    /// it, which is why the field's own doc points here. 🔴 What it does NOT do is decide WHEN, and the
    /// callers are in TWO different assemblies: <see cref="ProductConfigStore.UpsertPoint"/> and
    /// <see cref="ProductConfigStore.SoftDeletePoint"/> here, plus the Demo ecosystem's own
    /// <c>St4i.EngineApi.Config.SimulatedEcosystem.SyncPointsAsync</c>, which bumps the ECOSYSTEM-side
    /// copy of a product when a push actually changed content. Two stores, two independently moving
    /// versions of the same product code — which is precisely the pair the drift comparison exists to
    /// compare, so a reader must not take this counter for a single global sequence.
    /// Saving a product through <see cref="ProductConfigStore.UpsertProduct"/> — the path every
    /// fiducial, variant, image and name edit takes — does not call it at all, so those edits leave the
    /// version and the points checksum both unmoved.</summary>
    public void BumpVersion() => PointsConfigVersion++;
}
