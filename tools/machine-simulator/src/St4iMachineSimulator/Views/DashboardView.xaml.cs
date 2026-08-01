using System.Windows.Controls;
using St4iMachineSimulator.ViewModels;

namespace St4iMachineSimulator.Views;

/// <summary>Task 15 dashboard — all logic lives in <see cref="FleetViewModel"/>; this code-behind
/// only wires the DataContext (same pattern as <see cref="ShellView"/>).</summary>
public partial class DashboardView : UserControl
{
    public DashboardView(FleetViewModel viewModel)
    {
        DataContext = viewModel ?? throw new ArgumentNullException(nameof(viewModel));
        InitializeComponent();
    }
}
