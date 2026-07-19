using System.Collections.ObjectModel;
using CommunityToolkit.Mvvm.ComponentModel;
using LiveChartsCore;
using LiveChartsCore.SkiaSharpView;
using St4i.EdgeCore.Models;

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
/// <see cref="ApplyReading"/> MUST be called on the UI thread — callers (<c>FleetViewModel</c>) marshal
/// via <see cref="Application.Current"/>'s Dispatcher before touching this instance, since
/// <c>Committed</c> fires on a background pipeline thread.
/// </summary>
public sealed partial class MachineViewModel : ObservableObject
{
    /// <summary>Sparkline depth — enough to show a visible trend without the chart/collection growing
    /// unbounded over a long-running demo.</summary>
    private const int MaxSparkPoints = 30;

    private long _passCount;
    private long _judgedCount; // readings that carry a pass/fail verdict (excludes Telemetry/Skip)

    public MachineViewModel(MachineDescriptor descriptor)
    {
        Code = descriptor.Code;
        MachineType = descriptor.MachineType;
        DriverKind = descriptor.DriverKind;
        Class = descriptor.DeviceClass;

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
