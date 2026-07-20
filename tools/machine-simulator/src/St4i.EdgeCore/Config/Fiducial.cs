namespace St4i.EdgeCore.Config;

/// <summary>
/// An alignment/registration mark used to locate a board before points are measured — the edge-local
/// mirror of a <c>fiducial_marks</c> row, matching the shape <c>get-points</c> nests under
/// <c>productModels[].fiducials[]</c>. <c>type</c> has no enumerated vocabulary in the contract (it's
/// a free-form marker-shape label, e.g. <c>"cross"</c>/<c>"dot"</c>), so it stays a plain nullable
/// string rather than a closed C# enum.
/// </summary>
public sealed class Fiducial
{
    public string Code { get; set; } = "";
    public string? Name { get; set; }
    public string? Type { get; set; }

    public double PositionX { get; set; }
    public double PositionY { get; set; }
    public double? NormalizedX { get; set; }
    public double? NormalizedY { get; set; }

    public double? SearchWindowW { get; set; }
    public double? SearchWindowH { get; set; }
    public string? TemplateImageUrl { get; set; }

    public int OrderIndex { get; set; }
}
