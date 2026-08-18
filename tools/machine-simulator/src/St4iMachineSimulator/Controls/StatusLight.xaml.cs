using System.Windows;
using System.Windows.Controls;

namespace St4iMachineSimulator.Controls;

/// <summary>
/// Small status-light dot for the shell's top bar. Exposes a single boolean dependency property so
/// ShellView can data-bind it straight to <c>AppShellViewModel.IsFallingBack</c> — all the color logic
/// lives in <c>StatusLight.xaml</c>'s own style trigger, not here.
/// </summary>
public partial class StatusLight : UserControl
{
    public static readonly DependencyProperty IsFallbackProperty =
        DependencyProperty.Register(
            nameof(IsFallback),
            typeof(bool),
            typeof(StatusLight),
            new PropertyMetadata(false));

    public bool IsFallback
    {
        get => (bool)GetValue(IsFallbackProperty);
        set => SetValue(IsFallbackProperty, value);
    }

    public StatusLight()
    {
        InitializeComponent();
    }
}
