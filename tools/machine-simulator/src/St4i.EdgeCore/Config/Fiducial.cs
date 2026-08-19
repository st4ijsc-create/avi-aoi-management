namespace St4i.EdgeCore.Config;

/// <summary>
/// An alignment/registration mark used to locate a board before points are measured — the edge-local
/// mirror of a <c>fiducial_marks</c> row, matching the shape <c>get-points</c> nests under
/// <c>productModels[].fiducials[]</c>. <c>type</c> has no enumerated vocabulary in the contract (it's
/// a free-form marker-shape label, e.g. <c>"cross"</c>/<c>"dot"</c>), so it stays a plain nullable
/// string rather than a closed C# enum.
/// </summary>
/// <remarks>
/// 🔴 A FIDUCIAL IS OUTSIDE BOTH DRIFT SIGNALS, and every member below inherits that. The
/// checksum-based drift key hashes POINTS only
/// (<see cref="ConfigChecksum.ComputePointsChecksum(IEnumerable{MeasurementPoint})"/> takes
/// <see cref="ProductModel.Points"/>), and <see cref="ProductModel.BumpVersion"/> is reached only from
/// <see cref="ProductConfigStore.UpsertPoint"/>/<see cref="ProductConfigStore.SoftDeletePoint"/> — a
/// fiducial edit arrives through the whole-product upsert, which bumps nothing. So changing anything
/// here leaves the product reading <c>in_sync</c> at an unchanged <c>pointsConfigVersion</c>. That is
/// consistent rather than broken: <c>sync-points</c>'s request body has no fiducial-authoring slot
/// either (its one fiducial field, <c>observedFiducials</c>, is runtime alignment FEEDBACK, and this
/// repository never sends it), so there is no channel a fiducial edit could have travelled on.
/// Fiducials here are pulled, persisted, and drawn — never authored outward.
/// </remarks>
public sealed class Fiducial
{
    /// <summary>Natural key of this mark within its product, mirroring <c>fiducial_marks.code</c>.
    /// Nothing enforces uniqueness — neither <see cref="ProductConfigStore"/> nor the whole-product
    /// upsert de-duplicates the list — while <c>BoardCanvas.tsx</c> uses it as its React key, so a
    /// duplicated code degrades the board render rather than being rejected at the store.</summary>
    public string Code { get; set; } = "";

    /// <summary>Operator-facing label. <c>BoardCanvas.tsx</c> renders <c>name ?? code</c> as the
    /// marker's tooltip, so leaving this null is a supported choice, not a missing value.</summary>
    public string? Name { get; set; }

    /// <summary>Marker shape as free text — the contract enumerates no vocabulary (see this type's
    /// summary), and <c>ProductFiducialsPanel.tsx</c> pre-fills <c>"cross"</c> for a newly added mark.
    /// Nothing branches on it: every fiducial draws with the same marker glyph regardless.</summary>
    public string? Type { get; set; }

    /// <summary>Absolute position in the OWNING PRODUCT's <see cref="ProductModel.CoordinateMode"/> —
    /// pixels of the reference image, or millimetres — the same frame as
    /// <see cref="MeasurementPoint.PositionX"/>, and NOT the 0..1 frame of
    /// <see cref="NormalizedX"/>. Non-nullable here (unlike the normalized pair) because the contract
    /// lists it unconditionally, but nothing in this solution reads it: the board draws from the
    /// normalized pair alone, and the HMI's fiducial dialog does not offer this field for
    /// editing.</summary>
    public double PositionX { get; set; }

    /// <summary>Absolute position, same frame and same caveats as <see cref="PositionX"/>.</summary>
    public double PositionY { get; set; }

    /// <summary>Resolution-independent position, 0..1 across the reference image's WIDTH — the only
    /// geometry any renderer here actually consumes, and the only one
    /// <c>ProductFiducialsPanel.tsx</c> lets an operator author (it defaults a new mark to
    /// <c>0.5</c>). 🔴 Null is not treated as "derive it from <see cref="PositionX"/>": unlike
    /// <c>AoiInspectorSim</c>, which falls back to <c>PositionX/ImageWidth</c> for a POINT,
    /// <c>BoardCanvas.tsx</c> DROPS a fiducial whose normalized pair is null. A pulled mark carrying
    /// only absolute coordinates therefore does not appear on the board at all.</summary>
    public double? NormalizedX { get; set; }

    /// <summary>Resolution-independent position, 0..1 down the reference image's HEIGHT. Same
    /// null-handling as <see cref="NormalizedX"/> — the canvas requires BOTH to be non-null before it
    /// places the mark, so setting only one is equivalent to setting neither.</summary>
    public double? NormalizedY { get; set; }

    /// <summary>Half-window the ecosystem's aligner should search for this mark, expressed in the same
    /// <see cref="ProductModel.CoordinateMode"/> units as <see cref="PositionX"/> — the tolerance for
    /// how far the board may have shifted in the fixture. Carried only: no code in this solution reads
    /// it, and the HMI does not expose it, so a Live-pulled value survives a local round trip
    /// unchanged.</summary>
    public double? SearchWindowW { get; set; }

    /// <summary>Search-window extent on the other axis, same units and same carry-only status as
    /// <see cref="SearchWindowW"/>.</summary>
    public double? SearchWindowH { get; set; }

    /// <summary>URL of the template patch the aligner correlates against. 🔴 Null in every product
    /// this repository seeds, deliberately: the seed used to point these at
    /// <c>assets/products/model-*/fid*.png</c> files that never existed, and M-9 nulled them so the UI
    /// shows its honest "no image" state instead of a permanent 404 (see
    /// <see cref="ProductConfigStore.SeedProducts"/>'s own remarks). A real value only ever arrives
    /// from the ecosystem.</summary>
    public string? TemplateImageUrl { get; set; }

    /// <summary>Authoring order, mirroring <c>fiducial_marks.orderIndex</c>. Unlike
    /// <see cref="MeasurementPoint.OrderIndex"/> — which <see cref="ProductModel.ActivePoints"/>
    /// actively sorts by — nothing here ever orders by this: fiducials are consumed in whatever
    /// sequence the list happens to hold, so this is data preserved for the server's benefit, not a
    /// sequence anything on this side honours.</summary>
    public int OrderIndex { get; set; }
}
