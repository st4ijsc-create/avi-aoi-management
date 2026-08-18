using St4i.EdgeCore.Models;

namespace St4i.EdgeCore.Drivers.Simulators;

/// <summary>
/// AOI/AVI board inspector (AOI) — doc-62 §6: board N điểm; tiêm defect IPC-A-610
/// (INSUFFICIENT_SOLDER, BRIDGING, MISSING_COMPONENT, TOMBSTONING…) + bbox_px + values_3d,
/// NG-rate configurable. overallResult (mirrored onto <see cref="DeviceReading.Verdict"/>) is
/// OK/Pass only if every point is OK, per doc-28 §8.5 / Normalizer.ComputeOverallResult.
/// </summary>
public sealed class AoiInspectorSim : SimulatorBase
{
    /// <summary>IPC-A-610 solder-joint/placement defect categories this simulator injects — the 4
    /// doc-62 §6 examples plus 2 more common SMT categories for variety.</summary>
    private static readonly (string Code, string Severity)[] DefectCatalog =
    {
        ("INSUFFICIENT_SOLDER", "major"),
        ("BRIDGING", "major"),
        ("MISSING_COMPONENT", "critical"),
        ("TOMBSTONING", "major"),
        ("LIFTED_LEAD", "major"),
        ("COLD_SOLDER_JOINT", "minor"),
    };

    private const int BoardWidthPx = 1600, BoardHeightPx = 1200;
    private const int DefectBoxMinPx = 20, DefectBoxMaxPx = 120;

    private readonly int _pointsPerBoard;
    private readonly double _ngRate;

    public AoiInspectorSim(MachineDescriptor d, int seed, int pointsPerBoard = 20, double ngRate = 0.05) : base(d, seed)
    {
        _pointsPerBoard = Math.Max(1, pointsPerBoard);
        _ngRate = Math.Clamp(ngRate, 0.0, 1.0);
    }

    public override DeviceReading NextCycle(long cycle)
    {
        var rng = Rng(cycle);
        var reading = NewReading(cycle, ReadingKind.Inspection, Descriptor.StepType);
        var anyNg = false;

        for (var i = 1; i <= _pointsPerBoard; i++)
        {
            var pointCode = $"PT-{i:D3}";
            var isNg = rng.NextDouble() < _ngRate;
            reading.Measurements.Add(isNg ? BuildNgMeasurement(rng, pointCode) : BuildOkMeasurement(rng, pointCode));
            anyNg |= isNg;
        }

        reading.Verdict = anyNg ? Verdict.Fail : Verdict.Pass;
        return reading;
    }

    private static MeasurementResult BuildOkMeasurement(Random rng, string pointCode) =>
        new(pointCode, "OK", MeasuredValue: Math.Round(rng.NextGaussian(1.0, 0.05), 3), Unit: "score");

    private static MeasurementResult BuildNgMeasurement(Random rng, string pointCode)
    {
        var (code, severity) = DefectCatalog[rng.Next(DefectCatalog.Length)];
        var bbox = new Bbox(
            X: rng.Next(0, BoardWidthPx),
            Y: rng.Next(0, BoardHeightPx),
            W: rng.Next(DefectBoxMinPx, DefectBoxMaxPx),
            H: rng.Next(DefectBoxMinPx, DefectBoxMaxPx));
        var values3d = new Values3d(
            HeightUm: Math.Round(rng.NextGaussian(120, 30), 1),
            AreaPct: Math.Round(Math.Clamp(rng.NextGaussian(70, 15), 0, 100), 1),
            VolumePct: Math.Round(Math.Clamp(rng.NextGaussian(65, 20), 0, 100), 1));

        return new MeasurementResult(
            pointCode, "NG",
            MeasuredValue: Math.Round(rng.NextGaussian(0.4, 0.1), 3),
            DefectCatalogCode: code,
            DefectSeverity: severity,
            Unit: "score",
            Bbox: bbox,
            Values3d: values3d);
    }
}
