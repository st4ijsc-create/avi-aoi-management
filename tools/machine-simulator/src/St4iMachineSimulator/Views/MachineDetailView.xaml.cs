using System.Windows.Controls;
using St4iMachineSimulator.ViewModels;

namespace St4iMachineSimulator.Views;

/// <summary>Task 16 Machine Detail screen — all logic lives in the bound <see cref="MachineViewModel"/>
/// (extended in place from Task 15, not a new per-screen VM); this code-behind only wires the
/// DataContext, same pattern as <see cref="DashboardView"/>/<see cref="ShellView"/>. A new instance is
/// created per tile click (see <c>AppShellViewModel.OnMachineSelected</c>) around the SAME, long-lived
/// <see cref="MachineViewModel"/> — only this View wrapper is transient.</summary>
public partial class MachineDetailView : UserControl
{
    public MachineDetailView(MachineViewModel viewModel)
    {
        DataContext = viewModel ?? throw new ArgumentNullException(nameof(viewModel));
        InitializeComponent();
    }
}
