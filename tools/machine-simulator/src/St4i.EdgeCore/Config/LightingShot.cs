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
public sealed class LightingShot
{
    public int ShotIndex { get; set; }
    public string? Name { get; set; }
    public string? LightSource { get; set; }
    public string? Color { get; set; }
    public string? ColorHex { get; set; }
    public double? IntensityPct { get; set; }
    public double? AngleDeg { get; set; }
    public double? ExposureUs { get; set; }
    public double? Gain { get; set; }
    public double? FocusOffsetUm { get; set; }
    public string? OpticalFilter { get; set; }
    public string? Purpose { get; set; }
}
