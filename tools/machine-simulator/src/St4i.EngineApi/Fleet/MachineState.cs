using St4i.EdgeCore.Models;

namespace St4i.EngineApi.Fleet;

/// <summary>One row of a machine's cycle log — mirrors the WPF app's <c>CycleLogRow</c> record.</summary>
public sealed record CycleLogEntry(DateTimeOffset Time, string Serial, string Verdict, string KeyMetric);

/// <summary>One named telemetry series (a metric name plus its recent values) — the wire shape for
/// <c>GET /v1/machines/{code}</c>'s <c>telemetry</c> array.</summary>
public sealed record TelemetrySeriesDto(string Metric, IReadOnlyList<double> Values);

/// <summary>I-MR-style SPC summary for <c>GET /v1/machines/{code}</c>'s <c>spc</c> object: the raw
/// recent values plus mean/UCL/LCL computed over that same window (mean ± 3·sample-stdev — the same
/// simplified individuals-chart control limit the WPF app's <c>MachineViewModel</c> uses).</summary>
public sealed record SpcSummaryDto(IReadOnlyList<double> Values, double Mean, double Ucl, double Lcl);

public sealed record BoardPointDto(string PointCode, string Result, Bbox? Bbox, string? DefectCode);

/// <summary>
/// Thread-safe, per-machine live state accumulated from every <see cref="EdgePipeline.Committed"/>
/// reading — the headless-host analogue of the WPF app's <c>MachineViewModel</c> (Task 16), just
/// without any WPF/ObservableCollection/dispatcher dependency: every mutation happens under
/// <see cref="_gate"/>, and every read-out method (<see cref="ToTile"/>/<see cref="ToDetail"/>) takes a
/// short-lived snapshot under the same lock so a concurrent HTTP GET never observes a torn state.
/// </summary>
public sealed class MachineState
{
    /// <summary>Sparkline depth — same cap as the WPF dashboard tile's Spark collection.</summary>
    private const int MaxSparkPoints = 30;

    /// <summary>SPC/telemetry chart depth — same cap as the WPF Machine Detail screen's chart buffers.</summary>
    private const int MaxChartPoints = 50;

    /// <summary>Cycle log depth — same cap as the WPF Machine Detail screen's DataGrid.</summary>
    private const int MaxCycleLogRows = 200;

    private readonly object _gate = new();

    private readonly List<double> _spark = new();
    private readonly List<double> _spcValues = new();
    private readonly Dictionary<string, List<double>> _telemetry = new(StringComparer.OrdinalIgnoreCase);
    private IReadOnlyList<MeasurementResult> _boardPoints = Array.Empty<MeasurementResult>();
    private readonly List<CycleLogEntry> _cycleLog = new();

    private long _passCount;
    private long _judgedCount;
    private string? _cachedConfigVersion;

    public MachineState(MachineDescriptor descriptor)
    {
        Descriptor = descriptor ?? throw new ArgumentNullException(nameof(descriptor));
    }

    public MachineDescriptor Descriptor { get; }

    public string Code => Descriptor.Code;

    public string StatusText { get; private set; } = "Idle";

    /// <summary>Running pass rate in [0,1] — Pass and Warn both count as "success" (mirrors
    /// Normalizer.ComputeOverallResult treating Warn as OK); Telemetry readings are excluded entirely.</summary>
    public double PassRate { get; private set; }

    public long Cycles { get; private set; }

    public string LastCycleSummary { get; private set; } = "—";

    /// <summary>Human-readable outcome of the last sync-config call — "—" until one has run this
    /// session, same contract as the WPF app's <c>MachineViewModel.DriftState</c>.</summary>
    public string DriftState { get; private set; } = "—";

    public string? CachedConfigVersion { get { lock (_gate) return _cachedConfigVersion; } }

    /// <summary>Applies one committed reading — the SAME per-reading logic the WPF app's
    /// <c>MachineViewModel.ApplyReading</c>/<c>FleetViewModel.OnCommitted</c> apply, just under a plain
    /// lock instead of a UI-thread dispatch.</summary>
    public void ApplyReading(DeviceReading reading, TransportAck ack)
    {
        lock (_gate)
        {
            Cycles = reading.CycleCounter;

            if (reading.Verdict != Verdict.Skip)
            {
                _judgedCount++;
                if (reading.Verdict is Verdict.Pass or Verdict.Warn) _passCount++;
                PassRate = _judgedCount == 0 ? 0.0 : (double)_passCount / _judgedCount;
            }

            StatusText = reading.Verdict switch
            {
                Verdict.Fail => "FAIL",
                Verdict.Warn => "WARN",
                Verdict.Skip => "TELEMETRY",
                _ => "OK",
            };

            LastCycleSummary = BuildSummary(reading, ack);

            _spark.Add(SparkValue(reading));
            TrimFront(_spark, MaxSparkPoints);

            if (reading.Metrics.Count > 0)
            {
                _spcValues.Add(reading.Metrics[0].Value);
                TrimFront(_spcValues, MaxChartPoints);
            }

            foreach (var sample in reading.Telemetry)
            {
                if (sample.Value is not IConvertible convertible) continue;

                if (!_telemetry.TryGetValue(sample.Metric, out var series))
                {
                    series = new List<double>();
                    _telemetry[sample.Metric] = series;
                }

                series.Add(convertible.ToDouble(null));
                TrimFront(series, MaxChartPoints);
            }

            if (reading.Kind == ReadingKind.Inspection && reading.Measurements.Count > 0)
            {
                // Replaced wholesale on every inspection reading, not accumulated — mirrors
                // MachineViewModel.BoardPoints' "always exactly one board's worth" contract.
                _boardPoints = reading.Measurements.ToList();
            }

            _cycleLog.Add(new CycleLogEntry(reading.Timestamp, reading.SerialNumber, reading.Verdict.ToString(), FormatKeyMetric(reading)));
            TrimFront(_cycleLog, MaxCycleLogRows);
        }
    }

    /// <summary>Records the outcome of a <c>POST /v1/machines/{code}/sync-config</c> call — mirrors
    /// <c>MachineViewModel.SyncConfigAsync</c>'s success path.</summary>
    public void ApplyConfigSync(ConfigSyncResult result)
    {
        lock (_gate)
        {
            _cachedConfigVersion = result.Version;
            DriftState = BuildDriftStateText(result);
        }
    }

    public void ApplyConfigSyncError(string message)
    {
        lock (_gate)
        {
            DriftState = $"ERROR: {message}";
        }
    }

    /// <summary>Snapshot for one <c>GET /v1/fleet</c> row.</summary>
    public FleetTileDto ToTile()
    {
        lock (_gate)
        {
            return new FleetTileDto(
                Code,
                Descriptor.DeviceClass,
                Descriptor.DriverKind,
                StatusText,
                PassRate,
                Cycles,
                LastCycleSummary,
                _spark.ToArray());
        }
    }

    /// <summary>Snapshot for <c>GET /v1/machines/{code}</c>.</summary>
    public MachineDetailDto ToDetail()
    {
        lock (_gate)
        {
            var spc = BuildSpcSummary(_spcValues);
            var telemetry = _telemetry.Count == 0
                ? Array.Empty<TelemetrySeriesDto>()
                : _telemetry.Select(kv => new TelemetrySeriesDto(kv.Key, kv.Value.ToArray())).ToArray();
            var boardPoints = _boardPoints
                .Select(m => new BoardPointDto(m.PointCode, m.Result, m.Bbox, m.DefectCatalogCode))
                .ToArray();

            return new MachineDetailDto(
                Code,
                Descriptor.DeviceClass,
                Descriptor.DriverKind,
                StatusText,
                PassRate,
                Cycles,
                spc,
                telemetry,
                boardPoints,
                _cycleLog.ToArray(),
                DriftState);
        }
    }

    private static SpcSummaryDto BuildSpcSummary(List<double> values)
    {
        if (values.Count == 0) return new SpcSummaryDto(Array.Empty<double>(), 0.0, 0.0, 0.0);

        var mean = values.Average();
        var stdDev = values.Count > 1
            ? Math.Sqrt(values.Sum(v => (v - mean) * (v - mean)) / (values.Count - 1))
            : 0.0;
        return new SpcSummaryDto(values.ToArray(), mean, mean + 3 * stdDev, mean - 3 * stdDev);
    }

    private static void TrimFront<T>(List<T> list, int max)
    {
        while (list.Count > max) list.RemoveAt(0);
    }

    /// <summary>Same per-class fallback chain as the WPF app's <c>MachineViewModel.SparkValue</c>: first
    /// metric (process machines), first telemetry sample (IoT), else a 1/0 pass-fail step (AOI has no
    /// scalar Metrics).</summary>
    private static double SparkValue(DeviceReading reading)
    {
        if (reading.Metrics.Count > 0) return reading.Metrics[0].Value;
        if (reading.Telemetry.Count > 0 && reading.Telemetry[0].Value is IConvertible c) return c.ToDouble(null);
        return reading.Verdict == Verdict.Fail ? 0.0 : 1.0;
    }

    private static string FormatKeyMetric(DeviceReading reading)
    {
        if (reading.Metrics.Count > 0)
        {
            var m = reading.Metrics[0];
            return $"{m.Name}={m.Value:0.###}{m.Unit}";
        }

        if (reading.Telemetry.Count > 0)
        {
            var t = reading.Telemetry[0];
            return $"{t.Metric}={t.Value}{t.Unit}";
        }

        if (reading.Measurements.Count > 0)
        {
            var ngCount = reading.Measurements.Count(m => m.Result == "NG");
            return $"{reading.Measurements.Count} pts, {ngCount} NG";
        }

        return "—";
    }

    private static string BuildSummary(DeviceReading reading, TransportAck ack)
    {
        var kindLabel = reading.Kind switch
        {
            ReadingKind.Inspection => "Inspection",
            ReadingKind.Telemetry => "Telemetry",
            _ => "Process",
        };
        var ackLabel = !ack.Success ? "ERR" : ack.Duplicate ? "dup" : ack.Queued ? "queued" : "ok";
        return $"#{reading.CycleCounter} {kindLabel} · {reading.Verdict} · ack:{ackLabel}";
    }

    private static string BuildDriftStateText(ConfigSyncResult result)
    {
        var drift = result.DriftState ?? (result.Changed ? "changed" : "none");
        return $"{drift} · v{result.Version ?? "?"} · applied={result.Applied}";
    }
}
