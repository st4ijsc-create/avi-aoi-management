using System.Windows.Threading;
using St4iMachineSimulator.ViewModels;
using St4iMachineSimulator.Views;

namespace St4iMachineSimulator.Services;

/// <summary>
/// Task 20 — exhibition "attract mode": after a stretch of no visitor input, auto-cycles the shell's
/// <see cref="AppShellViewModel.CurrentView"/> through a canned tour (Dashboard → a machine's detail
/// screen → the API Inspector → back to Dashboard → …) so an unattended booth keeps showing something
/// alive rather than freezing on whatever screen the last visitor left it on. ANY input (mouse/key,
/// wired up in <c>ShellView</c>'s <c>PreviewMouseMove</c>/<c>PreviewMouseDown</c>/<c>PreviewKeyDown</c>
/// handlers) exits it immediately via <see cref="NotifyActivity"/>.
///
/// Deliberately does NOT depend on <see cref="AppShellViewModel"/> directly (that would be a circular DI
/// dependency — AppShellViewModel needs to react to this service's tour advances). Instead it raises
/// <see cref="ViewRequested"/> with the next tour stop; <c>AppShellViewModel</c>'s constructor subscribes
/// and marshals the assignment onto <see cref="Infrastructure.DispatcherHelper.RunOnUiThread"/>, the same
/// pattern it already uses for <see cref="FleetViewModel.MachineSelected"/>.
///
/// Two <see cref="DispatcherTimer"/>s, both driven off the calling thread's Dispatcher (constructed here
/// during DI resolution, which always happens on the UI thread — see <c>App.RunSelfTest</c>'s own
/// remarks on why that's safe even before <c>Application.Run</c> starts the real message loop):
/// <list type="bullet">
/// <item><c>_idleTimer</c> — a single-shot-style idle detector. Its <see cref="Tick"/> callback fires
/// only once nothing has restarted it for <see cref="IdleThresholdSeconds"/> — the standard "restart on
/// every activity" idle-timer shape (see <see cref="NotifyActivity"/>).</item>
/// <item><c>_tourTimer"/> — only running WHILE attract mode is active, advancing the tour every
/// <see cref="TourInterval"/>.</item>
/// </list>
///
/// <see cref="Tick"/>/<see cref="AdvanceTour"/>/<see cref="NotifyActivity"/> are all public specifically
/// so <c>--selftest</c> can drive this deterministically without waiting out the real 45s/10s timers —
/// see <c>App.RunAttractModeSelfTest</c>.
/// </summary>
public sealed class AttractModeService
{
    /// <summary>How long the booth must sit idle before attract mode kicks in.</summary>
    public const int IdleThresholdSeconds = 45;

    /// <summary>How often the tour advances to its next stop once active.</summary>
    public static readonly TimeSpan TourInterval = TimeSpan.FromSeconds(10);

    private readonly FleetViewModel _fleetViewModel;
    private readonly DashboardView _dashboardView;
    private readonly ApiInspectorView _apiInspectorView;

    private readonly DispatcherTimer _idleTimer;
    private readonly DispatcherTimer _tourTimer;
    private int _tourIndex;

    /// <summary>Raised with the next tour stop to show — see class remarks for why this is an event
    /// rather than a direct <see cref="AppShellViewModel"/> dependency.</summary>
    public event Action<object>? ViewRequested;

    /// <summary>Master on/off switch, mirrored from <see cref="ViewModels.SettingsViewModel.Attract"/>
    /// (defaults to <c>false</c> — matches that checkbox's own default). While <c>false</c>,
    /// <see cref="Tick"/> is a no-op regardless of how much idle time has actually elapsed.</summary>
    public bool Enabled { get; set; }

    /// <summary>Whether the tour is currently cycling (i.e. the idle threshold has been reached and no
    /// activity has exited it since).</summary>
    public bool IsActive { get; private set; }

    public AttractModeService(FleetViewModel fleetViewModel, DashboardView dashboardView, ApiInspectorView apiInspectorView)
    {
        _fleetViewModel = fleetViewModel ?? throw new ArgumentNullException(nameof(fleetViewModel));
        _dashboardView = dashboardView ?? throw new ArgumentNullException(nameof(dashboardView));
        _apiInspectorView = apiInspectorView ?? throw new ArgumentNullException(nameof(apiInspectorView));

        _idleTimer = new DispatcherTimer { Interval = TimeSpan.FromSeconds(IdleThresholdSeconds) };
        _idleTimer.Tick += (_, _) => Tick();
        _idleTimer.Start();

        _tourTimer = new DispatcherTimer { Interval = TourInterval };
        _tourTimer.Tick += (_, _) => AdvanceTour();
    }

    /// <summary>The idle timer's own callback in real usage (fires once <see cref="IdleThresholdSeconds"/>
    /// has elapsed with no intervening <see cref="NotifyActivity"/> call) — also directly callable from
    /// <c>--selftest</c> to simulate "the booth has been idle long enough" without waiting out the real
    /// 45s <see cref="DispatcherTimer"/>. A no-op if <see cref="Enabled"/> is false or attract mode is
    /// already active (the idle timer is stopped for the duration of an active tour — see
    /// <see cref="StartAttract"/> — so a stray extra call here is harmless either way).</summary>
    public void Tick()
    {
        if (!Enabled || IsActive) return;
        StartAttract();
    }

    private void StartAttract()
    {
        IsActive = true;
        _idleTimer.Stop();
        // AdvanceTour below moves from index 0 to index 1 — deliberately SKIPPING stop 0 (Dashboard) as
        // the first move: stop 0 is also where the booth is presumably already sitting (Dashboard is
        // both the app's own default CurrentView and this tour's first stop), so starting the tour by
        // "advancing" to the same place it's already showing would be a visible no-op the first time
        // attract mode kicks in.
        _tourIndex = 0;
        AdvanceTour();
        _tourTimer.Start();
    }

    /// <summary>Moves <see cref="AppShellViewModel.CurrentView"/> (via <see cref="ViewRequested"/>) to the
    /// next stop in the tour — Dashboard → a machine's detail screen (the fleet's first machine, if any
    /// have been loaded — see <see cref="BuildTourStops"/>) → API Inspector → back to Dashboard → …
    /// Public (not gated on <see cref="Enabled"/>/<see cref="IsActive"/>) specifically so
    /// <c>--selftest</c> can call it directly to prove the tour actually cycles, independent of the idle
    /// timer's own state machine.</summary>
    public void AdvanceTour()
    {
        var stops = BuildTourStops();
        if (stops.Count == 0) return;
        _tourIndex = (_tourIndex + 1) % stops.Count;
        ViewRequested?.Invoke(stops[_tourIndex]);
    }

    /// <summary>Rebuilt on every call (cheap — at most 3 entries) rather than cached, so a machine-detail
    /// stop always reflects the CURRENT fleet roster (e.g. after Onboarding's LoadFleet replaces it)
    /// instead of a stale snapshot from whenever attract mode first started. Builds a fresh
    /// <see cref="MachineDetailView"/> around the fleet's first machine — same "one View per navigation,
    /// same long-lived MachineViewModel underneath" shape as <c>AppShellViewModel.OnMachineSelected</c>.
    /// </summary>
    private List<object> BuildTourStops()
    {
        var stops = new List<object> { _dashboardView };
        var firstMachine = _fleetViewModel.Machines.FirstOrDefault();
        if (firstMachine is not null) stops.Add(new MachineDetailView(firstMachine));
        stops.Add(_apiInspectorView);
        return stops;
    }

    /// <summary>Any visitor input (mouse move/click, key press) calls this — see <c>ShellView</c>'s
    /// Preview* handlers. ALWAYS restarts the idle countdown (whether or not attract mode is currently
    /// active — an idle timer that only reset while inactive would let the countdown keep running
    /// underneath an active tour and immediately re-fire the moment the tour is exited). If attract mode
    /// WAS active, this also exits it: stops the tour timer and returns <see cref="AppShellViewModel"/>
    /// to Dashboard (a sane, known starting point — better than leaving the visitor on whatever tour
    /// stop happened to be showing) via <see cref="ViewRequested"/>.</summary>
    public void NotifyActivity()
    {
        _idleTimer.Stop();
        _idleTimer.Start();

        if (!IsActive) return;

        IsActive = false;
        _tourTimer.Stop();
        ViewRequested?.Invoke(_dashboardView);
    }
}
