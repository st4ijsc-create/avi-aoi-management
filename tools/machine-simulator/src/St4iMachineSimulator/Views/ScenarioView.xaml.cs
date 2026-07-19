using System.Windows.Controls;
using St4iMachineSimulator.ViewModels;

namespace St4iMachineSimulator.Views;

/// <summary>Task 19b Scenario screen — all logic lives in the bound <see cref="ScenarioViewModel"/> (a
/// DI singleton, same lifetime pattern as every other nav screen's ViewModel); this code-behind only
/// wires the DataContext.</summary>
public partial class ScenarioView : UserControl
{
    public ScenarioView(ScenarioViewModel viewModel)
    {
        DataContext = viewModel ?? throw new ArgumentNullException(nameof(viewModel));
        InitializeComponent();
    }
}
