using System.Windows;

namespace St4i.DesktopShell;

/// <summary>No app-level state — see App.xaml's remarks on why there's no DI composition root here
/// (unlike St4iMachineSimulator.App). MainWindow.xaml.cs owns the entire engine-spawn/WebView2 lifecycle.</summary>
public partial class App : Application
{
}
