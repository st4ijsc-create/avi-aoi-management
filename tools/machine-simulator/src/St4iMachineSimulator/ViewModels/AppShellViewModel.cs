using System.Collections.ObjectModel;
using System.Windows;
using CommunityToolkit.Mvvm.ComponentModel;
using CommunityToolkit.Mvvm.Input;
using St4i.EdgeCore.Infrastructure;
using St4i.EdgeCore.Models;

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

    [ObservableProperty]
    private TransportMode mode = TransportMode.Auto;

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

    public AppShellViewModel(EventBus eventBus)
    {
        _eventBus = eventBus ?? throw new ArgumentNullException(nameof(eventBus));
        _eventBus.Traced += OnTraced;

        CurrentView = $"{Nav[0].Title} — chưa triển khai (Task 15-20)";
    }

    /// <summary>Explicit alternative to two-way-binding <see cref="Mode"/> directly from the
    /// ComboBox — used by anything that wants to switch mode programmatically (e.g. Settings' "kiểm
    /// cờ" probe in a later task, or the headless <c>--selftest</c> path).</summary>
    [RelayCommand]
    private void SetMode(TransportMode newMode) => Mode = newMode;

    [RelayCommand]
    private void SelectNavItem(NavItem? item)
    {
        if (item is null) return;
        CurrentView = $"{item.Title} — chưa triển khai (Task 15-20)";
    }

    [RelayCommand]
    private void StartFleet()
    {
        if (IsFleetRunning) return;
        IsFleetRunning = true;
        RefreshServerStatus();
    }

    [RelayCommand]
    private void StopFleet()
    {
        if (!IsFleetRunning) return;
        IsFleetRunning = false;
        RefreshServerStatus();
    }

    /// <summary>
    /// Wired by the composition root (<c>App.xaml.cs</c>) to <c>AutoTransport.FallbackChanged</c>,
    /// which fires on whatever thread happened to be running the send/heartbeat/config-sync call that
    /// triggered the transition — never guaranteed to be the UI thread. Marshals onto the dispatcher
    /// before touching any bound property, per the shell's threading rule (background callbacks must
    /// not set bound properties directly).
    /// </summary>
    public void HandleFallbackChanged(bool isFallingBack) => RunOnUiThread(() =>
    {
        IsFallingBack = isFallingBack;
        RefreshServerStatus();
    });

    /// <summary><see cref="EventBus.Traced"/> handler — same cross-thread caveat as
    /// <see cref="HandleFallbackChanged"/> (publishers are transport/pipeline callbacks, not the UI
    /// thread).</summary>
    private void OnTraced(ApiTraceEvent e) => RunOnUiThread(() => TraceEventCount++);

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

    /// <summary>Runs <paramref name="action"/> on the WPF dispatcher thread, inline if already on it
    /// (avoids an unnecessary hop when called from a UI-thread command like <see cref="StartFleet"/>),
    /// dispatched otherwise. Falls back to running inline if there is no <see cref="Application.Current"/>
    /// yet (e.g. called before the shell window is shown) rather than throwing.</summary>
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
