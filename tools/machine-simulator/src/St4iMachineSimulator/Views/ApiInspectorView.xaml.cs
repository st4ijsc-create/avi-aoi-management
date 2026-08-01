using System.Windows.Controls;
using St4iMachineSimulator.ViewModels;

namespace St4iMachineSimulator.Views;

/// <summary>Task 17 API Inspector screen — all logic lives in the bound <see cref="InspectorViewModel"/>
/// (a DI singleton, same lifetime as <c>AppShellViewModel</c>/<c>FleetViewModel</c>); this code-behind
/// only wires the DataContext, same pattern as <see cref="DashboardView"/>/<see cref="MachineDetailView"/>.</summary>
public partial class ApiInspectorView : UserControl
{
    public ApiInspectorView(InspectorViewModel viewModel)
    {
        DataContext = viewModel ?? throw new ArgumentNullException(nameof(viewModel));
        InitializeComponent();
    }
}
