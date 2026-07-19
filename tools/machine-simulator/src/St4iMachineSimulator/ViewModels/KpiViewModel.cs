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
    public KpiViewModel(string label)
    {
        Label = label;
    }

    public string Label { get; }

    [ObservableProperty]
    private string valueText = "—";

    [ObservableProperty]
    private string? subText;
}
