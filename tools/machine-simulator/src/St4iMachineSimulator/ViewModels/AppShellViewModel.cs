using System.Collections.ObjectModel;
using System.ComponentModel;
using CommunityToolkit.Mvvm.ComponentModel;
using CommunityToolkit.Mvvm.Input;
using St4i.EdgeCore.Infrastructure;
using St4i.EdgeCore.Models;
using St4i.EdgeCore.Transport;
using St4iMachineSimulator.Infrastructure;
using St4iMachineSimulator.Services;
using St4iMachineSimulator.Views;

namespace St4iMachineSimulator.ViewModels;

/// <summary>One row of the shell's left sidebar. <see cref="Key"/> is the stable identifier later
/// tasks (15-20) will switch on to build/cache the real screen ViewModel behind <see cref="Title"/>;
/// for Task 14 selecting an item just puts a placeholder string into <see cref="AppShellViewModel.CurrentView"/>.</summary>
public sealed record NavItem(string Title, string Key);

/// <summary>Task 20 — the Str_Nav_* resource key backing each <see cref="NavItem.Key"/>, shared between
/// <see cref="AppShellViewModel"/>'s Nav construction and its language-change refresh.</summary>
file static class NavItemLocalization
{
    public static readonly IReadOnlyDictionary<string, string> TitleKeyByNavKey = new Dictionary<string, string>
    {
        ["dashboard"] = "Str_Nav_Dashboard",
        ["machines"] = "Str_Nav_Machines",
        ["onboarding"] = "Str_Nav_Onboarding",
        ["inspector"] = "Str_Nav_Inspector",
        ["scenario"] = "Str_Nav_Scenario",
        ["settings"] = "Str_Nav_Settings",
    };
}

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
    private readonly SettingsViewModel _settingsViewModel;
    private readonly AttractModeService _attractModeService;

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

    /// <summary>Task 20 — mirrors <see cref="SettingsViewModel.Kiosk"/> (two-way, same
    /// no-op-when-equal loop-safety pattern as <see cref="Mode"/>/<see cref="TransportCoordinator"/>
    /// below). <c>ShellView</c>'s code-behind watches this property and flips the window's
    /// WindowStyle/WindowState/ResizeMode/Topmost accordingly — kept here rather than in ShellView's own
    /// state so it's reachable from both the Settings checkbox AND the F11/Esc key handlers (also in
    /// ShellView) through the SAME source of truth.</summary>
    [ObservableProperty]
    private bool isKiosk;

    /// <summary>Count of <see cref="EventBus.Traced"/> events observed since the shell started — cheap
    /// proof the EventBus wiring is live end-to-end; the API Inspector screen (Task 17) will replace
    /// this with the full trace list.</summary>
    [ObservableProperty]
    private int traceEventCount;

    /// <summary>Sidebar destinations (doc 62 §5.10). Populated once at construction from the CURRENT
    /// language's Str_Nav_* resources (Task 20) — later tasks fill in each screen's real ViewModel
    /// behind <see cref="SelectNavItem"/> — for now selecting a row just shows a placeholder in
    /// <see cref="CurrentView"/>. <see cref="OnLanguageChanged"/> keeps each item's <see cref="NavItem.Title"/>
    /// in sync with the active language (NavItem is an immutable record, so a language switch replaces
    /// each entry via <c>with</c> rather than mutating it in place — ObservableCollection's indexer
    /// setter raises a Replace notification either way, so the sidebar's ItemsControl redraws exactly
    /// the same as it would for a mutable property change).</summary>
    public ObservableCollection<NavItem> Nav { get; } = new(
    [
        new NavItem(LocalizationService.GetString("Str_Nav_Dashboard"), "dashboard"),
        new NavItem(LocalizationService.GetString("Str_Nav_Machines"), "machines"),
        new NavItem(LocalizationService.GetString("Str_Nav_Onboarding"), "onboarding"),
        new NavItem(LocalizationService.GetString("Str_Nav_Inspector"), "inspector"),
        new NavItem(LocalizationService.GetString("Str_Nav_Scenario"), "scenario"),
        new NavItem(LocalizationService.GetString("Str_Nav_Settings"), "settings"),
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
        TransportCoordinator transportCoordinator,
        SettingsViewModel settingsViewModel,
        AttractModeService attractModeService)
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
        _settingsViewModel = settingsViewModel ?? throw new ArgumentNullException(nameof(settingsViewModel));
        _attractModeService = attractModeService ?? throw new ArgumentNullException(nameof(attractModeService));
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

        // Task 20 — same mirrored-source-of-truth shape as Mode above, but for Kiosk: SettingsViewModel
        // (not this class) is where DI puts Kiosk's actual state, so the two stay in sync via
        // PropertyChanged rather than this class owning it outright — that keeps AppShellViewModel the
        // ONE place that also depends on SettingsViewModel (SettingsViewModel itself still doesn't
        // depend back on AppShellViewModel, preserving the non-circular DI shape TransportCoordinator's
        // remarks already establish for Mode).
        _settingsViewModel.PropertyChanged += OnSettingsViewModelPropertyChanged;
        IsKiosk = _settingsViewModel.Kiosk;

        // Task 20 — attract mode drives CurrentView through the SAME DispatcherHelper-marshaled path as
        // OnMachineSelected below; AttractModeService itself has no AppShellViewModel dependency (see
        // its own class remarks for why), so this is the one place that bridges the two.
        _attractModeService.ViewRequested += OnAttractViewRequested;

        LocalizationService.LanguageChanged += OnLanguageChanged;

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

    /// <summary>F11 (wired in <c>ShellView</c>'s PreviewKeyDown) — flips <see cref="IsKiosk"/>, which
    /// <see cref="OnIsKioskChanged"/> mirrors onto <see cref="SettingsViewModel.Kiosk"/> and ShellView's
    /// code-behind turns into the actual WindowStyle/WindowState/ResizeMode/Topmost change.</summary>
    [RelayCommand]
    private void ToggleKiosk() => IsKiosk = !IsKiosk;

    /// <summary>Esc (also wired in ShellView, only while <see cref="IsKiosk"/> is true) — kiosk mode is
    /// exit-only here, unlike ToggleKiosk: pressing Esc outside kiosk does nothing.</summary>
    [RelayCommand]
    private void ExitKiosk()
    {
        if (IsKiosk) IsKiosk = false;
    }

    partial void OnIsKioskChanged(bool value)
    {
        if (_settingsViewModel.Kiosk != value) _settingsViewModel.Kiosk = value;
    }

    /// <summary>The reverse direction of <see cref="OnIsKioskChanged"/> — the Settings screen's own
    /// Kiosk checkbox changed <see cref="SettingsViewModel.Kiosk"/> directly. Same equality-guarded
    /// mirror shape as <see cref="OnCoordinatorModeChanged"/>.</summary>
    private void OnSettingsViewModelPropertyChanged(object? sender, PropertyChangedEventArgs e)
    {
        if (e.PropertyName != nameof(SettingsViewModel.Kiosk)) return;
        DispatcherHelper.RunOnUiThread(() =>
        {
            if (IsKiosk != _settingsViewModel.Kiosk) IsKiosk = _settingsViewModel.Kiosk;
        });
    }

    /// <summary><see cref="AttractModeService.ViewRequested"/> handler — same marshal-then-assign shape
    /// as <see cref="OnMachineSelected"/> below (the service's DispatcherTimers already fire on the UI
    /// thread, so this is mostly defensive, but cheap and consistent).</summary>
    private void OnAttractViewRequested(object view) => DispatcherHelper.RunOnUiThread(() => CurrentView = view);

    /// <summary>Task 20 — re-titles every <see cref="Nav"/> entry (and, since NavItem is an immutable
    /// record, that means replacing each entry via <c>with</c> — see <see cref="Nav"/>'s own remarks)
    /// after a language switch.</summary>
    private void OnLanguageChanged(string _) => DispatcherHelper.RunOnUiThread(() =>
    {
        for (var i = 0; i < Nav.Count; i++)
        {
            var titleKey = NavItemLocalization.TitleKeyByNavKey[Nav[i].Key];
            Nav[i] = Nav[i] with { Title = LocalizationService.GetString(titleKey) };
        }
    });

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
