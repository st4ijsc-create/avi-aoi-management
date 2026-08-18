using System.Collections.ObjectModel;
using System.Windows;
using CommunityToolkit.Mvvm.ComponentModel;
using CommunityToolkit.Mvvm.Input;
using LiveChartsCore;
using LiveChartsCore.SkiaSharpView;
using St4i.EdgeCore.Models;
using St4i.EdgeCore.Transport;
using St4iMachineSimulator.Infrastructure;

namespace St4iMachineSimulator.ViewModels;

/// <summary>
/// One fleet tile's live state (Task 15, doc 62 §5.10 "Dashboard"): status/pass-rate/throughput for a
/// single machine, updated from each <see cref="DeviceReading"/>/<see cref="TransportAck"/> pair the
/// pipeline commits for it. Constructed once per <see cref="MachineDescriptor"/> in
/// <c>FleetViewModel</c>'s constructor and reused across Start/Stop cycles — <see cref="Cycles"/> is
/// an ASSIGNMENT from <see cref="DeviceReading.CycleCounter"/> (not an increment), so restarting the
/// fleet naturally resets a tile back to a low cycle count as fresh readings arrive rather than
/// requiring the tile itself to be recreated.
///
/// Task 16 extends this same instance (rather than a new per-screen VM) with the Machine Detail
/// screen's state: an I-MR-style SPC series for automation machines, a telemetry line for IoT
/// machines, the latest AOI inspection's board points, a config-sync command/readout, and a capped
/// cycle log — all populated from the SAME <see cref="ApplyReading"/> call the dashboard tile already
/// relies on, so there is exactly one place that reacts to a committed reading per machine.
///
/// <see cref="ApplyReading"/> MUST be called on the UI thread — callers (<c>FleetViewModel</c>) marshal
/// via <see cref="Application.Current"/>'s Dispatcher before touching this instance, since
/// <c>Committed</c> fires on a background pipeline thread.
/// </summary>
public sealed partial class MachineViewModel : ObservableObject
{
    /// <summary>Sparkline depth — enough to show a visible trend without the chart/collection growing
    /// unbounded over a long-running demo.</summary>
    private const int MaxSparkPoints = 30;

    /// <summary>SPC/telemetry chart depth (doc 16 brief: "SPC/telemetry ~50") — enough points to read
    /// a trend/control-limit breach without the chart (or the moving mean/UCL/LCL recompute cost)
    /// growing unbounded over a long exhibition run.</summary>
    private const int MaxChartPoints = 50;

    /// <summary>Cycle log depth (doc 16 brief: "CycleLog ~200") — same unbounded-growth guard as the
    /// chart buffers above, just a longer window since it's a scrollable log, not a chart.</summary>
    private const int MaxCycleLogRows = 200;

    /// <summary>Config kind passed to <see cref="ITransport.SyncConfigAsync"/> — this exhibition build
    /// only ever syncs one thing per machine (its process recipe / inspection program), so a single
    /// constant is correct; a real multi-config-kind machine would parameterize this.</summary>
    private const string ConfigKind = "recipe";

    private readonly ITransport _transport;

    private long _passCount;
    private long _judgedCount; // readings that carry a pass/fail verdict (excludes Telemetry/Skip)
    private string? _cachedConfigVersion;

    public MachineViewModel(MachineDescriptor descriptor, ITransport transport)
    {
        Code = descriptor.Code;
        MachineType = descriptor.MachineType;
        DriverKind = descriptor.DriverKind;
        Class = descriptor.DeviceClass;
        _transport = transport ?? throw new ArgumentNullException(nameof(transport));

        SparkSeries = new ISeries[]
        {
            new LineSeries<double>
            {
                Values = Spark,
                GeometrySize = 0,
                LineSmoothness = 0.3,
                Fill = null,
            },
        };

        // I-MR-style SPC approximation: the raw value line plus 3 constant reference lines
        // (mean/UCL/LCL) recomputed by RecomputeSpcReferenceLines every time SpcValues changes — see
        // its remarks for why they're kept as their own ObservableCollections (matching SpcValues'
        // length) rather than a single fixed pair of X/Y points.
        SpcSeries = new ISeries[]
        {
            new LineSeries<double> { Values = SpcValues, Name = "Value", GeometrySize = 4, LineSmoothness = 0, Fill = null },
            new LineSeries<double> { Values = SpcMeanLine, Name = "Mean", GeometrySize = 0, LineSmoothness = 0, Fill = null },
            new LineSeries<double> { Values = SpcUclLine, Name = "UCL", GeometrySize = 0, LineSmoothness = 0, Fill = null },
            new LineSeries<double> { Values = SpcLclLine, Name = "LCL", GeometrySize = 0, LineSmoothness = 0, Fill = null },
        };

        TelemetrySeries = new ISeries[]
        {
            new LineSeries<double>
            {
                Values = TelemetryValues,
                Name = "Value",
                GeometrySize = 0,
                LineSmoothness = 0.3,
                Fill = null,
            },
        };
    }

    public string Code { get; }

    public string MachineType { get; }

    public DriverKind DriverKind { get; }

    public DeviceClass Class { get; }

    [ObservableProperty]
    private string statusText = "Idle";

    /// <summary>Running pass rate in [0,1] — Pass and Warn both count as "success" (Warn means judged
    /// but marginal, not rejected; mirrors Normalizer.ComputeOverallResult treating Warn as OK), Fail
    /// does not, and Telemetry readings (Verdict.Skip, no pass/fail concept) are excluded entirely
    /// rather than counted against the rate.</summary>
    [ObservableProperty]
    private double passRate;

    /// <summary>The machine's own cycle counter as of the last committed reading (assigned straight
    /// from <see cref="DeviceReading.CycleCounter"/>, which <c>SimulatedDriver</c> already tracks
    /// per-sim) — NOT incremented independently, so it self-corrects across fleet restarts.</summary>
    [ObservableProperty]
    private long cycles;

    [ObservableProperty]
    private string lastCycleSummary = "—";

    /// <summary>Recent throughput/quality signal, oldest-first, capped at <see cref="MaxSparkPoints"/>
    /// — the values backing <see cref="SparkSeries"/>'s <see cref="LineSeries{TModel}"/>.</summary>
    public ObservableCollection<double> Spark { get; } = new();

    /// <summary>Ready-to-bind series for a <c>CartesianChart</c> in the machine tile — wraps
    /// <see cref="Spark"/>, which LiveCharts observes directly via its <see cref="INotifyCollectionChanged"/>.</summary>
    public ISeries[] SparkSeries { get; }

    // ─────────────────────────────────────────────────────────────────────
    // TASK 16 — MACHINE DETAIL: SPC (automation), telemetry (IoT), board (AOI)
    // ─────────────────────────────────────────────────────────────────────

    /// <summary>Raw recent values of the machine's primary process metric (its first
    /// <see cref="MetricSample"/> per reading — same "primary metric" choice <see cref="SparkValue"/>
    /// already makes for the dashboard sparkline), oldest-first, capped at <see cref="MaxChartPoints"/>.
    /// Only ever populated for automation machines (process readings carry Metrics; IoT/AOI don't).</summary>
    public ObservableCollection<double> SpcValues { get; } = new();

    /// <summary>Constant-value line spanning <see cref="SpcValues"/>'s current length at its mean —
    /// kept as a same-length collection (rather than a 2-point line) purely so the simplest possible
    /// <see cref="LineSeries{TModel}"/> binding draws a flat reference line across the full visible
    /// chart width with no extra XAML/converter work.</summary>
    public ObservableCollection<double> SpcMeanLine { get; } = new();

    /// <summary>Upper control limit: mean + 3·σ over the values currently in <see cref="SpcValues"/> —
    /// a standard (if simplified — a textbook I-MR chart derives σ from the moving range, not a
    /// direct sample stdev) individuals-chart control limit, recomputed on every new value.</summary>
    public ObservableCollection<double> SpcUclLine { get; } = new();

    /// <summary>Lower control limit: mean − 3·σ — see <see cref="SpcUclLine"/> remarks.</summary>
    public ObservableCollection<double> SpcLclLine { get; } = new();

    /// <summary>Ready-to-bind series for the Machine Detail screen's automation-class chart: index 0
    /// is the raw value line, 1-3 are the mean/UCL/LCL reference lines.</summary>
    public ISeries[] SpcSeries { get; }

    /// <summary>Raw recent telemetry values (the reading's first <see cref="TelemetrySample"/> — same
    /// "primary signal" choice <see cref="SparkValue"/> makes), oldest-first, capped at
    /// <see cref="MaxChartPoints"/>. Only ever populated for IoT machines.</summary>
    public ObservableCollection<double> TelemetryValues { get; } = new();

    /// <summary>Ready-to-bind series for the Machine Detail screen's IoT-class chart.</summary>
    public ISeries[] TelemetrySeries { get; }

    /// <summary>The latest AOI inspection reading's per-point results (doc 16: "BoardPoints ... from
    /// the latest AOI inspection reading") — REPLACED wholesale on every inspection reading, not
    /// accumulated across cycles, so <c>Controls/BoardView</c> always shows exactly one board's worth
    /// of defects at a time. Only NG points carry a <see cref="MeasurementResult.Bbox"/> in this
    /// build's simulator (<c>AoiInspectorSim</c> doesn't stamp one for OK points) — BoardView is
    /// responsible for not drawing a rectangle for points with no Bbox.</summary>
    public ObservableCollection<MeasurementResult> BoardPoints { get; } = new();

    /// <summary>Human-readable outcome of the last <see cref="SyncConfigCommand"/> run — starts at
    /// "—" (never synced this session) and is overwritten on both success (drift state + version) and
    /// failure ("ERROR: ...") so the config-sync panel always shows *something* meaningful.</summary>
    [ObservableProperty]
    private string driftState = "—";

    /// <summary>Append-only cycle log, oldest-first, capped at <see cref="MaxCycleLogRows"/> — backs
    /// the Machine Detail screen's <c>DataGrid</c>.</summary>
    public ObservableCollection<CycleLogRow> CycleLog { get; } = new();

    /// <summary>
    /// "Sync recipe" button on the Machine Detail screen's config-sync panel: check→get→apply→ack in
    /// one call, per <see cref="ITransport.SyncConfigAsync"/>'s contract (<c>DemoTransport</c>/
    /// <c>AutoTransport</c> resolve check+get+apply server-side; there is no separate client-side step
    /// for this exhibition build). Runs on whatever thread the command was invoked from (the UI thread
    /// for a real button click) and marshals the RESULT back onto the UI thread explicitly before
    /// touching any bound property — required because <c>DemoTransport</c>'s internal await has no
    /// <c>ConfigureAwait(false)</c>, so its continuation's thread depends on whatever
    /// <see cref="SynchronizationContext"/> (if any) was captured at the await point, which this class
    /// does not control.
    /// </summary>
    [RelayCommand]
    private async Task SyncConfigAsync()
    {
        try
        {
            var result = await _transport.SyncConfigAsync(Code, ConfigKind, _cachedConfigVersion, CancellationToken.None);
            DispatcherHelper.RunOnUiThread(() =>
            {
                _cachedConfigVersion = result.Version;
                DriftState = BuildDriftState(result);
            });
        }
        catch (Exception ex)
        {
            DispatcherHelper.RunOnUiThread(() => DriftState = $"ERROR: {ex.Message}");
        }
    }

    private static string BuildDriftState(ConfigSyncResult result)
    {
        var drift = result.DriftState ?? (result.Changed ? "changed" : "none");
        return $"{drift} · v{result.Version ?? "?"} · applied={result.Applied}";
    }

    /// <summary>Applies one committed reading. Caller's responsibility to already be on the UI thread
    /// (see class remarks).</summary>
    public void ApplyReading(DeviceReading reading, TransportAck ack)
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

        Spark.Add(SparkValue(reading));
        while (Spark.Count > MaxSparkPoints) Spark.RemoveAt(0);

        // ── Task 16: per-class detail state ─────────────────────────────────────────────────
        if (reading.Metrics.Count > 0)
        {
            SpcValues.Add(reading.Metrics[0].Value);
            while (SpcValues.Count > MaxChartPoints) SpcValues.RemoveAt(0);
            RecomputeSpcReferenceLines();
        }

        if (reading.Telemetry.Count > 0 && reading.Telemetry[0].Value is IConvertible telemetryValue)
        {
            TelemetryValues.Add(telemetryValue.ToDouble(null));
            while (TelemetryValues.Count > MaxChartPoints) TelemetryValues.RemoveAt(0);
        }

        if (reading.Kind == ReadingKind.Inspection && reading.Measurements.Count > 0)
        {
            BoardPoints.Clear();
            foreach (var measurement in reading.Measurements) BoardPoints.Add(measurement);
        }

        CycleLog.Add(new CycleLogRow(reading.Timestamp, reading.SerialNumber, reading.Verdict.ToString(), FormatKeyMetric(reading)));
        while (CycleLog.Count > MaxCycleLogRows) CycleLog.RemoveAt(0);
    }

    /// <summary>Recomputes <see cref="SpcMeanLine"/>/<see cref="SpcUclLine"/>/<see cref="SpcLclLine"/>
    /// from the values currently in <see cref="SpcValues"/> — mean ± 3·(sample stdev). Called after
    /// every new <see cref="SpcValues"/> entry so the reference lines always match its current length
    /// and stay centered on its current window (not the whole machine's lifetime history, since
    /// <see cref="SpcValues"/> itself is capped/rolling).</summary>
    private void RecomputeSpcReferenceLines()
    {
        var count = SpcValues.Count;
        if (count == 0) return;

        var mean = SpcValues.Average();
        var stdDev = count > 1
            ? Math.Sqrt(SpcValues.Sum(v => (v - mean) * (v - mean)) / (count - 1))
            : 0.0;
        var ucl = mean + 3 * stdDev;
        var lcl = mean - 3 * stdDev;

        ResizeConstant(SpcMeanLine, count, mean);
        ResizeConstant(SpcUclLine, count, ucl);
        ResizeConstant(SpcLclLine, count, lcl);
    }

    /// <summary>Makes <paramref name="target"/> exactly <paramref name="count"/> entries long, all set
    /// to <paramref name="value"/> — used to keep the SPC reference lines the same length as
    /// <see cref="SpcValues"/> without rebuilding the whole collection (and firing a
    /// CollectionChanged Reset) on every single-value update once the two are already the same
    /// length.</summary>
    private static void ResizeConstant(ObservableCollection<double> target, int count, double value)
    {
        if (target.Count != count)
        {
            target.Clear();
            for (var i = 0; i < count; i++) target.Add(value);
        }
        else
        {
            for (var i = 0; i < count; i++) target[i] = value;
        }
    }

    /// <summary>A single representative number per cycle for the sparkline: the reading's first
    /// metric (process machines), first telemetry sample (IoT), or a 1/0 pass-fail step for
    /// inspection readings (AOI has no scalar Metrics — Measurements are per-point, not a single
    /// per-cycle number).</summary>
    private static double SparkValue(DeviceReading reading)
    {
        if (reading.Metrics.Count > 0) return reading.Metrics[0].Value;
        if (reading.Telemetry.Count > 0 && reading.Telemetry[0].Value is IConvertible c) return c.ToDouble(null);
        return reading.Verdict == Verdict.Fail ? 0.0 : 1.0;
    }

    /// <summary>One representative key-metric string per cycle for the cycle log — mirrors
    /// <see cref="SparkValue"/>'s per-class fallback chain but renders a label, not a bare number,
    /// since the log is a text column rather than a chart axis.</summary>
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
}
