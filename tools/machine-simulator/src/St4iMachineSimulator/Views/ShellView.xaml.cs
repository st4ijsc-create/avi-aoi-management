using System.Windows;
using St4iMachineSimulator.ViewModels;

namespace St4iMachineSimulator.Views;

/// <summary>The app's main window (replaces the Task-1 placeholder <c>MainWindow</c>). All shell
/// logic lives in <see cref="AppShellViewModel"/> — this code-behind only wires the DataContext.</summary>
public partial class ShellView : Window
{
    public ShellView(AppShellViewModel viewModel)
    {
        DataContext = viewModel ?? throw new ArgumentNullException(nameof(viewModel));
        InitializeComponent();
    }
}
