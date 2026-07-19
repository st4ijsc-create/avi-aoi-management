using System.Collections.ObjectModel;
using CommunityToolkit.Mvvm.ComponentModel;
using CommunityToolkit.Mvvm.Input;
using St4i.EdgeCore.Infrastructure;
using St4i.EdgeCore.Models;
using St4iMachineSimulator.Infrastructure;
using St4iMachineSimulator.Services;
using St4iMachineSimulator.Views;

namespace St4iMachineSimulator.ViewModels;

/// <summary>One row of the shell's left sidebar. <see cref="Key"/> is the stable identifier later
/// tasks (15-20) will switch on to build/cache the real screen ViewModel behind <see cref="Title"/>;
/// for Task 14 selecting an item just puts a placeholder string into <see cref="AppShellViewModel.CurrentView"/>.</summary>
public sealed record NavItem(string Title, string Key);

/// <summary>
/// The composition-root ViewModel for the WPF shell (doc 62 §5.10 "Shell" row): sidebar nav, the
/// Live/Demo/Auto transport-mode toggle, fleet Start/Stop, server status text, and the DEMO FALLBACK
/// badge. Deliberately holds real, inspectable/testable logic (state transitions, dispatcher
/// marshaling) rather than pushing it into XAML — <c>ShellView.xaml</c> only binds to what's here.
/// </summary>
public partial class AppShellViewModel : ObservableObject
{
    private readonly EventBus _eventBus;
    private readonly FleetService _fleetService;
    private readonly DashboardView _dashboardView;
    private readonly FleetViewModel _fleetViewModel;
    private readonly ApiInspectorView _apiInspectorView;
    private readonly OnboardingView _onboardingView;
    private readonly SettingsView _settingsView;
    private readonly ScenarioView _scenarioView;
    private readonly TransportCoordinator _transportCoordinator;

    /// <summary>Task 19a — DEFAULTS TO DEMO (was Auto): the out-of-box exhibition run must need no
    /// server at all and never show an error/status-0 row (see <c>TransportCoordinator</c>'s class
    /// remarks + this task's brief "bulletproof" requirement). Re-synced from
    /// <see cref="TransportCoordinator.Mode"/> in the constructor below — that call is a no-op unless a
    /// caller constructed the coordinator with a non-Demo initial mode, but keeps this field the single
    /// source of truth for what --selftest observes as the starting value.</summary>
    [ObservableProperty]
    private TransportMode mode = TransportMode.Demo;

    [ObservableProperty]
    private object? currentView;

    [ObservableProperty]
    private string serverStatus = "Idle";

    [ObservableProperty]
    private bool isFallingBack;

    [ObservableProperty]
    private bool isFleetRunning;

    /// <summary>Count of <see cref="EventBus.Traced"/> events observed since the shell started — cheap
    /// proof the EventBus wiring is live end-to-end; the API Inspector screen (Task 17) will replace
    /// this with the full trace list.</summary>
    [ObservableProperty]
    private int traceEventCount;

    /// <summary>Sidebar destinations (doc 62 §5.10). Populated once at construction; later tasks fill
    /// in each screen's real ViewModel behind <see cref="SelectNavItem"/> — for now selecting a row
    /// just shows a placeholder in <see cref="CurrentView"/>.</summary>
    public ObservableCollection<NavItem> Nav { get; } = new(
    [
        new NavItem("Dashboard", "dashboard"),
        new NavItem("Machines", "machines"),
        new NavItem("Onboarding", "onboarding"),
        new NavItem("API Inspector", "inspector"),
        new NavItem("Scenario", "scenario"),
        new NavItem("Settings", "settings"),
    ]);

    /// <summary>Values for the top-bar mode <c>ComboBox</c>.</summary>
    public IReadOnlyList<TransportMode> AvailableModes { get; } = Enum.GetValues<TransportMode>();

    public AppShellViewModel(
        EventBus eventBus,
        FleetService fleetService,
        DashboardView dashboardView,
        FleetViewModel fleetViewModel,
        ApiInspectorView apiInspectorView,
        OnboardingView onboardingView,
        SettingsView settingsView,
        ScenarioView scenarioView,
        TransportCoordinator transportCoordinator)
    {
        _eventBus = eventBus ?? throw new ArgumentNullException(nameof(eventBus));
        _fleetService = fleetService ?? throw new ArgumentNullException(nameof(fleetService));
        _dashboardView = dashboardView ?? throw new ArgumentNullException(nameof(dashboardView));
        _fleetViewModel = fleetViewModel ?? throw new ArgumentNullException(nameof(fleetViewModel));
        _apiInspectorView = apiInspectorView ?? throw new ArgumentNullException(nameof(apiInspectorView));
        _onboardingView = onboardingView ?? throw new ArgumentNullException(nameof(onboardingView));
        _settingsView = settingsView ?? throw new ArgumentNullException(nameof(settingsView));
        _scenarioView = scenarioView ?? throw new ArgumentNullException(nameof(scenarioView));
        _transportCoordinator = transportCoordinator ?? throw new ArgumentNullException(nameof(transportCoordinator));
        _eventBus.Traced += OnTraced;
        _fleetViewModel.MachineSelected += OnMachineSelected;

        // Task 19a — the shell no longer owns Mode in isolation: TransportCoordinator is the actual
        // source of truth (SettingsViewModel depends on it too, independently, to avoid a circular
        // AppShellViewModel<->SettingsViewModel DI dependency — see TransportCoordinator's class
        // remarks). Mirror its current value now (matches this class's own Demo default unless a
        // caller wired the coordinator up differently) and stay in sync via ModeChanged for as long as
        // this instance lives — including when Settings changes Mode, not just this shell's own combo.
        _transportCoordinator.FallbackChanged += HandleFallbackChanged;
        _transportCoordinator.ModeChanged += OnCoordinatorModeChanged;
        Mode = _transportCoordinator.Mode;

        // Nav[0] is Dashboard (Task 15), Nav[2] is Onboarding (Task 18), Nav[3] is API Inspector
        // (Task 17), Nav[4] is Scenario (Task 19b), Nav[5] is Settings (Task 19a) — the only real
        // screens wired up so far; "Machines" still falls back to SelectNavItem's placeholder text
        // until its own task lands.
        CurrentView = _dashboardView;
    }

    /// <summary>Explicit alternative to two-way-binding <see cref="Mode"/> directly from the
    /// ComboBox — used by anything that wants to switch mode programmatically (e.g. the headless
    /// <c>--selftest</c> path).</summary>
    [RelayCommand]
    private void SetMode(TransportMode newMode) => Mode = newMode;

    [RelayCommand]
    private void SelectNavItem(NavItem? item)
    {
        if (item is null) return;
        CurrentView = item.Key switch
        {
            "dashboard" => _dashboardView,
            "onboarding" => _onboardingView,
            "inspector" => _apiInspectorView,
            "scenario" => _scenarioView,
            "settings" => _settingsView,
            _ => $"{item.Title} — chưa triển khai (Task 20)",
        };
    }

    /// <summary>Two-way binding on <see cref="Mode"/> (the top-bar ComboBox) pushes every change
    /// straight through to <see cref="TransportCoordinator.ApplyMode"/>, which re-points the DI
    /// <c>SwitchableTransport</c> at the matching Demo/Live/Auto instance. Only called by
    /// CommunityToolkit.Mvvm's generated setter when the value actually changes (see
    /// <see cref="OnCoordinatorModeChanged"/>'s matching guard for why this doesn't loop).</summary>
    partial void OnModeChanged(TransportMode value) => _transportCoordinator.ApplyMode(value);

    /// <summary>The reverse direction of <see cref="OnModeChanged"/>: fires when <em>anything else</em>
    /// (Settings' own Mode selector) changed <see cref="TransportCoordinator.Mode"/> — mirrors it onto
    /// this shell's own <see cref="Mode"/> so the top-bar combo stays in sync. The equality guard
    /// prevents the obvious call cycle: <see cref="Mode"/>'s setter no-ops (CommunityToolkit's
    /// generated <c>SetProperty</c> already skips assignment/notification when the new value equals the
    /// old one) so setting it to what it already is here never re-invokes <see cref="OnModeChanged"/>.</summary>
    private void OnCoordinatorModeChanged(TransportMode newMode) => DispatcherHelper.RunOnUiThread(() =>
    {
        if (Mode != newMode) Mode = newMode;
    });

    [RelayCommand]
    private void StartFleet()
    {
        if (IsFleetRunning) return;
        _fleetService.Start();
        IsFleetRunning = true;
        RefreshServerStatus();
    }

    [RelayCommand]
    private void StopFleet()
    {
        if (!IsFleetRunning) return;
        _fleetService.Stop();
        IsFleetRunning = false;
        RefreshServerStatus();
    }

    /// <summary>
    /// Wired in the constructor to <see cref="TransportCoordinator.FallbackChanged"/> (itself forwarded
    /// from whichever <c>AutoTransport</c> instance is currently active — survives Settings rebuilding
    /// it), which fires on whatever thread happened to be running the send/heartbeat/config-sync call
    /// that triggered the transition — never guaranteed to be the UI thread. Marshals onto the
    /// dispatcher before touching any bound property, per the shell's threading rule (background
    /// callbacks must not set bound properties directly).
    /// </summary>
    private void HandleFallbackChanged(bool isFallingBack) => DispatcherHelper.RunOnUiThread(() =>
    {
        IsFallingBack = isFallingBack;
        RefreshServerStatus();
    });

    /// <summary><see cref="EventBus.Traced"/> handler — same cross-thread caveat as
    /// <see cref="HandleFallbackChanged"/> (publishers are transport/pipeline callbacks, not the UI
    /// thread).</summary>
    private void OnTraced(ApiTraceEvent e) => DispatcherHelper.RunOnUiThread(() => TraceEventCount++);

    /// <summary>
    /// Task 16 — <see cref="FleetViewModel.MachineSelected"/> handler: a dashboard tile click. Builds
    /// a fresh <see cref="MachineDetailView"/> around the clicked <see cref="MachineViewModel"/> (the
    /// VM itself is a long-lived singleton owned by <c>FleetViewModel.Machines</c> — only the View
    /// wrapper is created per-navigation, so re-opening the same machine later picks its state back up
    /// exactly where it left off) and swaps it into <see cref="CurrentView"/>. Marshaled defensively
    /// even though a real tile click already runs on the UI thread (see the event's own remarks) —
    /// cheap and keeps this handler safe regardless of how it's invoked (e.g. from a future automated
    /// scenario driver).
    /// </summary>
    private void OnMachineSelected(MachineViewModel machine) => DispatcherHelper.RunOnUiThread(() =>
    {
        CurrentView = new MachineDetailView(machine);
    });

    /// <summary>"← Dashboard" affordance on <c>MachineDetailView</c> — bound via
    /// <c>RelativeSource AncestorType=Window</c> since that view's own DataContext is the selected
    /// <see cref="MachineViewModel"/>, not this shell.</summary>
    [RelayCommand]
    private void BackToDashboard() => CurrentView = _dashboardView;

    private void RefreshServerStatus()
    {
        ServerStatus = (IsFallingBack, IsFleetRunning) switch
        {
            (true, true) => $"DEMO (fallback) — fleet running ({Mode})",
            (true, false) => "DEMO (fallback)",
            (false, true) => $"Fleet running ({Mode})",
            (false, false) => "Idle",
        };
    }
}
