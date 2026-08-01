using St4i.EdgeCore.Config;
using St4i.EdgeCore.Models;
using St4i.Connector.Abstractions.Models;

namespace St4i.EdgeCore.Drivers.Simulators;

/// <summary>
/// AOI/AVI board inspector (AOI) — doc-62 §6: board N điểm; tiêm defect IPC-A-610
/// (INSUFFICIENT_SOLDER, BRIDGING, MISSING_COMPONENT, TOMBSTONING…) + bbox_px + values_3d,
/// NG-rate configurable. overallResult (mirrored onto <see cref="DeviceReading.Verdict"/>) is
/// OK/Pass only if every point is OK, per doc-28 §8.5 / Normalizer.ComputeOverallResult.
///
/// Task 3 (docs/plans/2026-07-21-machine-config.md §4): when constructed with a
/// <see cref="MachineConfigStore"/>, each inspection point's NG/OK call is no longer the fixed
/// <c>ngRate</c> coin-flip — it becomes a genuine threshold comparison: <c>matchScore ~
/// N(BaseMatchScoreMean, std)</c>, NG whenever <c>matchScore &lt; matchThreshold</c>. Because the SAME
/// distribution is compared against a HIGHER bar as <c>matchThreshold</c> rises, the NG rate rises
/// monotonically — design-doc §4's "siết ngưỡng → nhiều NG hơn" holds trivially by construction, verified
/// statistically by <c>MachineConfigDrivesSimulationTests</c>. <c>std</c> itself grows with how far
/// <c>exposureUs</c>/<c>lightIntensity</c> sit from their schema-default "ideal" values (badly-lit/badly-
/// exposed shots are noisier in both directions, not just "more/less light is always better" — the
/// physically correct shape for a camera/lighting setting) — this direction is intentionally NOT
/// asserted by a monotonic statistical test (a deviation-from-ideal quantity), only exercised for
/// determinism. The pre-Task-3 fixed-<c>ngRate</c> path is preserved byte-for-byte when no
/// <see cref="MachineConfigStore"/> is supplied.
/// </summary>
public sealed class AoiInspectorSim : SimulatorBase
{
    /// <summary>Schema-default "ideal" exposure/light this model treats as the zero-extra-noise point —
    /// matches <c>MachineParameterSchema</c>'s own <c>aoi_inspection</c> defaults.</summary>
    private const double IdealExposureUs = 1500, IdealLightIntensity = 75;

    /// <summary>Mean match score for a genuinely good part under ideal imaging conditions — chosen so the
    /// schema's default <c>matchThreshold</c> (0.85) yields a believable low single-digit NG rate (see
    /// class remarks / task report for the derivation).</summary>
    private const double BaseMatchScoreMean = 0.93;

    private const double BaseMatchScoreStd = 0.05;
    private const double ExposureNoiseSensitivity = 0.15;
    private const double LightNoiseSensitivity = 0.20;

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

    /// <summary>WS3-T1 — optional (defaults null so every pre-existing call site/test keeps compiling and
    /// behaving byte-for-byte) source for this machine's REAL configured measurement points. See
    /// <see cref="ResolveRealPoints"/>.</summary>
    private readonly ProductConfigStore? _productConfigStore;

    public AoiInspectorSim(
        MachineDescriptor d, int seed, int pointsPerBoard = 20, double ngRate = 0.05,
        MachineConfigStore? configStore = null, Func<string?>? productCodeProvider = null,
        ProductConfigStore? productConfigStore = null)
        : base(d, seed, MachineParameterSchema.AoiInspection, configStore, productCodeProvider)
    {
        _pointsPerBoard = Math.Max(1, pointsPerBoard);
        _ngRate = Math.Clamp(ngRate, 0.0, 1.0);
        _productConfigStore = productConfigStore;
    }

    public override DeviceReading NextCycle(long cycle)
    {
        var rng = Rng(cycle);
        var cfg = ResolveEffectiveConfig();
        var reading = NewReading(cycle, ReadingKind.Inspection, Descriptor.StepType);
        var anyNg = false;

        // Task 3: cfg is null on the pre-Task-3 construction path — matchThreshold stays null and every
        // point below falls back to the original fixed-ngRate coin-flip, byte-for-byte.
        double? matchThreshold = cfg is null ? null : GetValue(cfg, "matchThreshold", 0.85);
        var matchScoreStd = BaseMatchScoreStd;
        if (cfg is not null)
        {
            var exposureUs = GetValue(cfg, "exposureUs", IdealExposureUs);
            var lightIntensity = GetValue(cfg, "lightIntensity", IdealLightIntensity);
            var exposureDeviation = Math.Abs(exposureUs - IdealExposureUs) / IdealExposureUs;
            var lightDeviation = Math.Abs(lightIntensity - IdealLightIntensity) / 100.0;
            matchScoreStd += ExposureNoiseSensitivity * exposureDeviation + LightNoiseSensitivity * lightDeviation;
        }

        // WS3-T1 — when this machine has a REAL configured product (ProductConfigStore wired + a
        // product resolved + it has at least one active/enabled point), inspect THOSE real points
        // instead of the generic PT-001.. fallback, and build the cycle plan from the EXACT SAME
        // per-point draws below — never a second, independently-resolved point set (this closes the gap
        // AoiSchematic.tsx's own header comment documents: an earlier web build zipped a generic result
        // list onto real product points BY ARRAY INDEX and painted a real NG verdict on the wrong
        // physical point — the fix belongs at the SOURCE, not left to a caller to reconcile two
        // disagreeing lists). Null (no product resolvable) falls back to the pre-Task-3/pre-WS3-T1
        // generic PT-001.. behaviour byte-for-byte, including NO cycle plan (idle-equivalent for the
        // twin — an honest "nothing real to show" rather than a fabricated position).
        var realPoints = ResolveRealPoints();
        var pointCount = realPoints?.Count ?? _pointsPerBoard;
        var planSteps = realPoints is null ? null : new List<CyclePlanStep>(pointCount);

        for (var i = 0; i < pointCount; i++)
        {
            var pointCode = realPoints is null ? $"PT-{i + 1:D3}" : realPoints[i].Code;
            bool isNg;
            double? matchScore = null;

            if (matchThreshold is null)
            {
                isNg = rng.NextDouble() < _ngRate;
            }
            else
            {
                matchScore = rng.NextGaussian(BaseMatchScoreMean, matchScoreStd);
                isNg = matchScore.Value < matchThreshold.Value;
            }

            reading.Measurements.Add(isNg ? BuildNgMeasurement(rng, pointCode, matchScore) : BuildOkMeasurement(rng, pointCode, matchScore));
            anyNg |= isNg;

            if (planSteps is not null)
            {
                var real = realPoints![i];
                planSteps.Add(new CyclePlanStep(
                    Index: i,
                    PointCode: pointCode,
                    NormalizedX: real.Nx,
                    NormalizedY: real.Ny,
                    Result: isNg ? "NG" : "OK",
                    MetricValue: matchScore.HasValue ? Math.Round(matchScore.Value, 3) : null,
                    Unit: "score"));
            }
        }

        reading.Verdict = anyNg ? Verdict.Fail : Verdict.Pass;
        if (planSteps is not null)
        {
            // AOI has no cadence override (class remarks) — its cadence, and so its plan's duration,
            // comes entirely from Descriptor.CycleSeconds.
            reading.Plan = new CyclePlan(cycle, reading.Timestamp, Descriptor.CycleSeconds, planSteps);
        }

        return reading;
    }

    /// <summary>WS3-T1 — one real, currently-active, enabled measurement point, normalized 0..1 (mirrors
    /// the web's own derivation in <c>Hmi.tsx</c>: <c>NormalizedX</c> when authored, else
    /// <c>PositionX/ImageWidth</c>, clamped to [0,1] either way).</summary>
    private sealed record RealPoint(string Code, double Nx, double Ny);

    /// <summary>This machine's REAL configured measurement points, or null when no
    /// <see cref="ProductConfigStore"/> is wired, no product is currently resolved for this machine, the
    /// product code doesn't exist in the store, or the resolved product has zero active/enabled points —
    /// every one of those is an ORDINARY case ("this machine isn't linked to a real product board right
    /// now"), never an error; <see cref="NextCycle"/> falls back to the generic PT-001.. inspection (and
    /// emits no cycle plan) in every one of them, exactly as it always has when no product config is in
    /// play.</summary>
    private IReadOnlyList<RealPoint>? ResolveRealPoints()
    {
        if (_productConfigStore is null) return null;

        var productCode = CurrentProductCode;
        if (string.IsNullOrWhiteSpace(productCode)) return null;

        var product = _productConfigStore.GetProduct(productCode);
        if (product is null) return null;

        var imgW = product.ImageWidth is > 0 ? (double?)product.ImageWidth : null;
        var imgH = product.ImageHeight is > 0 ? (double?)product.ImageHeight : null;

        var points = product.ActivePoints
            .Where(p => p.IsActive)
            .Select(p => new RealPoint(
                p.Code,
                Clamp01(p.NormalizedX ?? (imgW.HasValue ? p.PositionX / imgW.Value : 0.5)),
                Clamp01(p.NormalizedY ?? (imgH.HasValue ? p.PositionY / imgH.Value : 0.5))))
            .ToList();

        return points.Count > 0 ? points : null;
    }

    private static double Clamp01(double v) => Math.Clamp(v, 0.0, 1.0);

    private static MeasurementResult BuildOkMeasurement(Random rng, string pointCode, double? matchScore) =>
        new(pointCode, "OK", MeasuredValue: Math.Round(matchScore ?? rng.NextGaussian(1.0, 0.05), 3), Unit: "score");

    private static MeasurementResult BuildNgMeasurement(Random rng, string pointCode, double? matchScore)
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
            MeasuredValue: Math.Round(matchScore ?? rng.NextGaussian(0.4, 0.1), 3),
            DefectCatalogCode: code,
            DefectSeverity: severity,
            Unit: "score",
            Bbox: bbox,
            Values3d: values3d);
    }
}
