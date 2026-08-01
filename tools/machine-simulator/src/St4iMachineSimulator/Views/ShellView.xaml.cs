using System.ComponentModel;
using System.Windows;
using System.Windows.Input;
using St4iMachineSimulator.Services;
using St4iMachineSimulator.ViewModels;

namespace St4iMachineSimulator.Views;

/// <summary>The app's main window (replaces the Task-1 placeholder <c>MainWindow</c>). Most shell logic
/// lives in <see cref="AppShellViewModel"/> — this code-behind only wires the DataContext, plus two
/// things that genuinely belong at the Window level rather than in a ViewModel (Task 20):
/// <list type="bullet">
/// <item>Kiosk mode — flipping the actual <see cref="Window.WindowStyle"/>/<see cref="Window.WindowState"/>/
/// <see cref="Window.ResizeMode"/>/<see cref="Window.Topmost"/> in response to
/// <see cref="AppShellViewModel.IsKiosk"/>, and the F11 (toggle)/Esc (exit-only) key bindings that drive
/// it — these are Window properties, not something a ViewModel can bind to directly without its own
/// View-layer plumbing anyway.</item>
/// <item>Forwarding raw input (mouse move/click, key press) to <see cref="AttractModeService.NotifyActivity"/>
/// — attract mode needs to know about EVERY visitor interaction, not just the ones that happen to route
/// through a bound Command.</item>
/// </list>
/// </summary>
public partial class ShellView : Window
{
    private readonly AppShellViewModel _viewModel;
    private readonly AttractModeService _attractModeService;

    private WindowStyle _preKioskStyle;
    private WindowState _preKioskState;
    private ResizeMode _preKioskResize;
    private bool _preKioskTopmost;

    public ShellView(AppShellViewModel viewModel, AttractModeService attractModeService)
    {
        _viewModel = viewModel ?? throw new ArgumentNullException(nameof(viewModel));
        _attractModeService = attractModeService ?? throw new ArgumentNullException(nameof(attractModeService));
        DataContext = _viewModel;
        InitializeComponent();

        _viewModel.PropertyChanged += OnViewModelPropertyChanged;
        PreviewKeyDown += OnPreviewKeyDown;
        PreviewMouseMove += (_, _) => _attractModeService.NotifyActivity();
        PreviewMouseDown += (_, _) => _attractModeService.NotifyActivity();
    }

    private void OnViewModelPropertyChanged(object? sender, PropertyChangedEventArgs e)
    {
        if (e.PropertyName == nameof(AppShellViewModel.IsKiosk)) ApplyKiosk(_viewModel.IsKiosk);
    }

    /// <summary>Saves the window's pre-kiosk chrome before overriding it, and restores exactly that
    /// (not hardcoded "normal" defaults) on exit — so kiosk mode round-trips correctly regardless of
    /// what state the window happened to be in when it was entered.</summary>
    private void ApplyKiosk(bool enabled)
    {
        if (enabled)
        {
            _preKioskStyle = WindowStyle;
            _preKioskState = WindowState;
            _preKioskResize = ResizeMode;
            _preKioskTopmost = Topmost;

            WindowStyle = WindowStyle.None;
            ResizeMode = ResizeMode.NoResize;
            Topmost = true;
            WindowState = WindowState.Maximized;
        }
        else
        {
            WindowStyle = _preKioskStyle;
            ResizeMode = _preKioskResize;
            Topmost = _preKioskTopmost;
            WindowState = _preKioskState;
        }
    }

    private void OnPreviewKeyDown(object sender, KeyEventArgs e)
    {
        _attractModeService.NotifyActivity();

        switch (e.Key)
        {
            case Key.F11:
                _viewModel.ToggleKioskCommand.Execute(null);
                e.Handled = true;
                break;
            case Key.Escape when _viewModel.IsKiosk:
                _viewModel.ExitKioskCommand.Execute(null);
                e.Handled = true;
                break;
        }
    }
}
