using System.Windows;

namespace St4iMachineSimulator.Infrastructure;

/// <summary>
/// Task 19a cleanup — the single implementation of the dispatcher-marshaling pattern that used to be
/// copy-pasted as a private <c>RunOnUiThread</c> method in <c>AppShellViewModel</c>,
/// <c>FleetViewModel</c>, <c>MachineViewModel</c>, <c>InspectorViewModel</c>, and
/// <c>OnboardingViewModel</c> (five identical copies, one per ViewModel that receives callbacks from a
/// background thread — pipeline/transport callers, an <see cref="System.Net.Http.HttpClient"/> await
/// continuation, etc.) — now they all call this instead.
/// </summary>
public static class DispatcherHelper
{
    /// <summary>Runs <paramref name="action"/> on the WPF dispatcher thread — inline if already on it
    /// (avoids an unnecessary hop when called from a UI-thread command), dispatched otherwise. Falls
    /// back to running inline if there is no <see cref="Application.Current"/> yet (e.g. before the
    /// shell window is shown, or during the headless <c>--selftest</c> path, which runs before
    /// <c>Application.Run</c> starts WPF's own message loop) rather than throwing.</summary>
    public static void RunOnUiThread(Action action)
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
