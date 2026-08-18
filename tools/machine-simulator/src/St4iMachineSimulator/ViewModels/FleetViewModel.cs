using System.Collections.ObjectModel;
using CommunityToolkit.Mvvm.ComponentModel;
using CommunityToolkit.Mvvm.Input;
using St4i.EdgeCore.Models;
using St4iMachineSimulator.Infrastructure;
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
            _fleetService.Fleet.Select(d => new MachineViewModel(d, _fleetService.Transport)));
        _byCode = Machines.ToDictionary(m => m.Code);

        // Task 20 — each tile's Label is built from the CURRENT language's Str_Kpi_* resource, and
        // carries its own key so OnLanguageChanged (below) can re-pull it after a language switch —
        // see KpiViewModel.RefreshLabel's remarks.
        OnlineKpi = new KpiViewModel(LocalizationService.GetString("Str_Kpi_Online"), "Str_Kpi_Online");
        CyclesKpi = new KpiViewModel(LocalizationService.GetString("Str_Kpi_TotalCycles"), "Str_Kpi_TotalCycles");
        FpyKpi = new KpiViewModel(LocalizationService.GetString("Str_Kpi_Fpy"), "Str_Kpi_Fpy");
        Kpis = new ObservableCollection<KpiViewModel> { OnlineKpi, CyclesKpi, FpyKpi };
        RefreshKpiDisplay();

        _fleetService.Committed += OnCommitted;
        LocalizationService.LanguageChanged += OnLanguageChanged;
    }

    public ObservableCollection<MachineViewModel> Machines { get; }

    /// <summary>Ordered [ONLINE, TOTAL CYCLES, FPY] — what the dashboard's top KPI row binds to.</summary>
    public ObservableCollection<KpiViewModel> Kpis { get; }

    public KpiViewModel OnlineKpi { get; }

    public KpiViewModel CyclesKpi { get; }

    public KpiViewModel FpyKpi { get; }

    /// <summary>Task 16 — fired when the user clicks a machine tile on the dashboard.
    /// <c>AppShellViewModel</c> subscribes to this (not a direct reference back from
    /// <see cref="MachineViewModel"/>, which stays navigation-agnostic) and opens that machine's
    /// <c>MachineDetailView</c>. Always raised on whatever thread invoked <see cref="SelectMachineCommand"/>
    /// — a real tile click is already on the UI thread, so no marshaling happens here.</summary>
    public event Action<MachineViewModel>? MachineSelected;

    [RelayCommand]
    private void SelectMachine(MachineViewModel? machine)
    {
        if (machine is null) return;
        MachineSelected?.Invoke(machine);
    }

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
    private void OnCommitted(DeviceReading reading, TransportAck ack) => DispatcherHelper.RunOnUiThread(() =>
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

        // Unconditional (not driven off OnFpyChanged) — see RefreshFpySubText remarks: Fpy lands on
        // the bit-exact same double (1.0) for every reading during an all-Pass/all-Warn streak, so
        // the ObservableProperty change-notification (and OnFpyChanged with it) stops firing even
        // though _totalPass/_totalJudged keep advancing underneath. Refreshing here, every committed
        // reading, keeps the "X/Y judged" text honest regardless of whether the ratio's floating-point
        // value happened to change.
        RefreshFpySubText();

        OnlineCount = Machines.Count(m => m.Cycles > 0);
    });

    partial void OnOnlineCountChanged(int value) => OnlineKpi.ValueText = $"{value}/{Machines.Count}";

    partial void OnTotalCyclesChanged(long value) => CyclesKpi.ValueText = value.ToString("N0");

    /// <summary>Only the formatted percentage — deliberately NOT the "X/Y judged" subtext (that's
    /// <see cref="RefreshFpySubText"/>, called unconditionally from <see cref="OnCommitted"/>; see its
    /// remarks for why relying on this change-notification hook alone freezes it).</summary>
    partial void OnFpyChanged(double value) => FpyKpi.ValueText = value.ToString("P1");

    /// <summary>Bug fix (post-review): during any all-Pass or all-Warn streak, n/n is the bit-exact
    /// same <see cref="double"/> (1.0) every cycle, so CommunityToolkit.Mvvm's generated
    /// <c>Fpy</c> setter sees no value change and never invokes <see cref="OnFpyChanged"/> — while
    /// <see cref="_totalPass"/>/<see cref="_totalJudged"/> keep incrementing underneath. Relying on
    /// <see cref="OnFpyChanged"/> alone therefore froze this subtext (observed: stuck at "3/3 judged"
    /// while the real count kept climbing). Called unconditionally from <see cref="OnCommitted"/>
    /// instead, so it always reflects the current counters regardless of whether the ratio's
    /// floating-point value changed.</summary>
    private void RefreshFpySubText() =>
        FpyKpi.SubText = _totalJudged == 0 ? "no data yet" : $"{_totalPass}/{_totalJudged} judged";

    private void RefreshKpiDisplay()
    {
        OnOnlineCountChanged(OnlineCount);
        OnTotalCyclesChanged(TotalCycles);
        OnFpyChanged(Fpy);
        RefreshFpySubText();
    }

    /// <summary>Task 20 — <see cref="LocalizationService.LanguageChanged"/> handler: re-pulls all 3 Kpi
    /// tiles' labels through the newly-active language's resources. FleetViewModel is a DI singleton
    /// that outlives the whole app, so this subscription (added in the constructor) is never
    /// unsubscribed — same lifetime pattern as every other cross-component event this class/its peers
    /// subscribe to (e.g. AppShellViewModel's EventBus.Traced).</summary>
    private void OnLanguageChanged(string _) => DispatcherHelper.RunOnUiThread(() =>
    {
        OnlineKpi.RefreshLabel(LocalizationService.GetString);
        CyclesKpi.RefreshLabel(LocalizationService.GetString);
        FpyKpi.RefreshLabel(LocalizationService.GetString);
    });
}
