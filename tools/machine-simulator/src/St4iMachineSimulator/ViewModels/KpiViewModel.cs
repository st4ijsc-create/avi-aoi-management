using CommunityToolkit.Mvvm.ComponentModel;

namespace St4iMachineSimulator.ViewModels;

/// <summary>
/// One aggregate KPI tile's display state (Task 15 dashboard top row: ONLINE count / total cycles /
/// FPY). Deliberately generic/reusable rather than 3 hand-written properties on
/// <c>FleetViewModel</c> — <c>Controls/KpiTile.xaml</c> binds directly to an instance of this as its
/// DataContext (via <c>FleetViewModel.Kpis</c>), so adding a 4th KPI later is a one-line addition, not
/// a new control.
/// </summary>
public sealed partial class KpiViewModel : ObservableObject
{
    /// <summary>Task 20 — the <c>Str_Kpi_*</c> resource key this tile's <see cref="Label"/> was built
    /// from, if any. <see cref="RefreshLabel"/> re-pulls the text through it on every language switch —
    /// <see cref="Label"/> had to become a settable (not <c>{ get; }</c>) property for that to be
    /// possible, since it's assigned once from C# by <c>FleetViewModel</c>'s constructor rather than
    /// bound straight to a resource key in XAML.</summary>
    private readonly string? _labelKey;

    public KpiViewModel(string label, string? labelKey = null)
    {
        this.label = label;
        _labelKey = labelKey;
    }

    [ObservableProperty]
    private string label = string.Empty;

    /// <summary>Re-pulls <see cref="Label"/> through <paramref name="lookup"/> (in practice
    /// <see cref="LocalizationService.GetString"/>) — a no-op if this tile wasn't constructed with a
    /// <c>labelKey</c>.</summary>
    public void RefreshLabel(Func<string, string> lookup)
    {
        if (_labelKey is not null) Label = lookup(_labelKey);
    }

    [ObservableProperty]
    private string valueText = "—";

    [ObservableProperty]
    private string? subText;
}
