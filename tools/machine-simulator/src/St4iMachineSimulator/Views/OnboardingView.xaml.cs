using System.Windows.Controls;
using St4iMachineSimulator.ViewModels;

namespace St4iMachineSimulator.Views;

/// <summary>Task 18 Onboarding wizard screen — all logic lives in the bound
/// <see cref="OnboardingViewModel"/> (a DI singleton, same lifetime as <c>AppShellViewModel</c>/
/// <c>FleetViewModel</c>/<c>InspectorViewModel</c>, so wizard state survives navigating away and back);
/// this code-behind only wires the DataContext, same pattern as every other screen in this app.</summary>
public partial class OnboardingView : UserControl
{
    public OnboardingView(OnboardingViewModel viewModel)
    {
        DataContext = viewModel ?? throw new ArgumentNullException(nameof(viewModel));
        InitializeComponent();
    }
}
