namespace St4i.EdgeCore.Models;

public record MetricSample(string Name, double Value, string? Unit = null, double? Lsl = null, double? Usl = null, double? Nominal = null);

public record WaveformSeries(string Name, string? Unit, double? RateHz, IReadOnlyList<double[]> Samples);

public record Bbox(int X, int Y, int W, int H);

public record Values3d(
    double? HeightUm = null,
    double? AreaPct = null,
    double? VolumePct = null,
    double? VoidPct = null,
    double? CoplanarityUm = null,
    double? WarpageUm = null,
    double? OffsetXUm = null,
    double? OffsetYUm = null,
    double? TiltDeg = null,
    double? ThicknessUm = null,
    double? ZUm = null);

public record MeasurementResult(
    string PointCode,
    string Result,
    double? MeasuredValue = null,
    string? DefectCatalogCode = null,
    string? DefectSeverity = null,
    string? Unit = null,
    Bbox? Bbox = null,
    Values3d? Values3d = null);

public record TelemetrySample(string Metric, object? Value, string? Unit = null, string Quality = "good");

public class DeviceReading
{
    public string MachineCode { get; set; } = "";
    public ReadingKind Kind { get; set; }
    public string SerialNumber { get; set; } = "";
    public string? StepType { get; set; }
    public Verdict Verdict { get; set; }
    public string? RecipeCode { get; set; }
    public string? RecipeVersion { get; set; }
    public List<MetricSample> Metrics { get; set; } = new();
    public List<WaveformSeries> Waveforms { get; set; } = new();
    public List<MeasurementResult> Measurements { get; set; } = new();
    public List<TelemetrySample> Telemetry { get; set; } = new();
    public long CycleCounter { get; set; }
    public DateTimeOffset Timestamp { get; set; }
    public Dictionary<string, object>? Genealogy { get; set; }
}
