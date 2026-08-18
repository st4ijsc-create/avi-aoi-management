using System.Windows.Controls;

namespace St4iMachineSimulator.Controls;

/// <summary>Presentational-only (Task 15) — all display logic lives in the bound
/// <see cref="ViewModels.KpiViewModel"/>; see <c>KpiTile.xaml</c>'s remarks.</summary>
public partial class KpiTile : UserControl
{
    public KpiTile()
    {
        InitializeComponent();
    }
}
