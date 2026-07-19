using System.Collections.ObjectModel;
using System.Windows;
using CommunityToolkit.Mvvm.ComponentModel;
using St4i.EdgeCore.Models;
using St4iMachineSimulator.Services;

namespace St4iMachineSimulator.ViewModels;

/// <summary>
/// The Task 15 Dashboard's ViewModel: one <see cref="MachineViewModel"/> tile per machine in
/// <see cref="FleetService.Fleet"/> (built once, at construction — the roster is fixed for this
/// build) plus 3 fleet-wide KPIs (ONLINE count / total cycles / running FPY), all driven by
/// subscribing to <see cref="FleetService.Committed"/>. Start/Stop themselves are NOT this class's
/// job — <c>AppShellViewModel</c>'s top-bar commands call <see cref="FleetService"/> directly; this
/// ViewModel only reacts to whatever readings that produces.
/// </summary>
public sealed partial class FleetViewModel : ObservableObject
{
    private readonly FleetService _fleetService;
    private readonly Dictionary<string, MachineViewModel> _byCode;

    private long _totalPass;
    private long _totalJudged;

    public FleetViewModel(FleetService fleetService)
    {
        _fleetService = fleetService ?? throw new ArgumentNullException(nameof(fleetService));

        Machines = new ObservableCollection<MachineViewModel>(
            _fleetService.Fleet.Select(d => new MachineViewModel(d)));
        _byCode = Machines.ToDictionary(m => m.Code);

        OnlineKpi = new KpiViewModel("ONLINE");
        CyclesKpi = new KpiViewModel("TOTAL CYCLES");
        FpyKpi = new KpiViewModel("FPY");
        Kpis = new ObservableCollection<KpiViewModel> { OnlineKpi, CyclesKpi, FpyKpi };
        RefreshKpiDisplay();

        _fleetService.Committed += OnCommitted;
    }

    public ObservableCollection<MachineViewModel> Machines { get; }

    /// <summary>Ordered [ONLINE, TOTAL CYCLES, FPY] — what the dashboard's top KPI row binds to.</summary>
    public ObservableCollection<KpiViewModel> Kpis { get; }

    public KpiViewModel OnlineKpi { get; }

    public KpiViewModel CyclesKpi { get; }

    public KpiViewModel FpyKpi { get; }

    /// <summary>Machines that have committed at least one reading. Frozen at its last value once the
    /// fleet is stopped (no more readings arrive to update it) rather than snapping to 0 — mirrors a
    /// real fleet's "last known online" behavior instead of implying the machines vanished.</summary>
    [ObservableProperty]
    private int onlineCount;

    /// <summary>Cumulative count of every reading committed through the pipeline across the
    /// dashboard's lifetime (spans multiple Start/Stop sessions — a running production total, not a
    /// per-session one).</summary>
    [ObservableProperty]
    private long totalCycles;

    /// <summary>Running first-pass-yield in [0,1] across all process/inspection readings (Telemetry
    /// excluded — see <see cref="MachineViewModel.PassRate"/> remarks for the same Pass-or-Warn=success
    /// rule applied fleet-wide).</summary>
    [ObservableProperty]
    private double fpy;

    /// <summary>
    /// <see cref="FleetService.Committed"/> handler — fires on the background pipeline thread. Marshals
    /// to the UI thread before touching any bound property (this class's own KPIs, or the target
    /// <see cref="MachineViewModel"/>'s), per the shell's threading rule.
    /// </summary>
    private void OnCommitted(DeviceReading reading, TransportAck ack) => RunOnUiThread(() =>
    {
        if (_byCode.TryGetValue(reading.MachineCode, out var machine))
        {
            machine.ApplyReading(reading, ack);
        }

        TotalCycles++;

        if (reading.Verdict != Verdict.Skip)
        {
            _totalJudged++;
            if (reading.Verdict is Verdict.Pass or Verdict.Warn) _totalPass++;
            Fpy = _totalJudged == 0 ? 0.0 : (double)_totalPass / _totalJudged;
        }

        OnlineCount = Machines.Count(m => m.Cycles > 0);
    });

    partial void OnOnlineCountChanged(int value) => OnlineKpi.ValueText = $"{value}/{Machines.Count}";

    partial void OnTotalCyclesChanged(long value) => CyclesKpi.ValueText = value.ToString("N0");

    partial void OnFpyChanged(double value)
    {
        FpyKpi.ValueText = value.ToString("P1");
        FpyKpi.SubText = _totalJudged == 0 ? "no data yet" : $"{_totalPass}/{_totalJudged} judged";
    }

    private void RefreshKpiDisplay()
    {
        OnOnlineCountChanged(OnlineCount);
        OnTotalCyclesChanged(TotalCycles);
        OnFpyChanged(Fpy);
    }

    /// <summary>Same dispatcher-marshaling pattern as <c>AppShellViewModel.RunOnUiThread</c> (Task 14):
    /// inline if already on the UI thread, dispatched otherwise, inline if there is no
    /// <see cref="Application.Current"/> yet.</summary>
    private static void RunOnUiThread(Action action)
    {
        var dispatcher = Application.Current?.Dispatcher;
        if (dispatcher is null || dispatcher.CheckAccess())
        {
            action();
        }
        else
        {
            dispatcher.Invoke(action);
        }
    }
}
