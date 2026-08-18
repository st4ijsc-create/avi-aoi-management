using System.Globalization;
using System.Windows;
using System.Windows.Data;

namespace St4iMachineSimulator.Converters;

/// <summary>
/// Collapses a bound element when the source string is null/empty — used by
/// <c>Controls/KpiTile.xaml</c> to hide its optional SubText line for KPIs that don't set one (e.g.
/// ONLINE/TOTAL CYCLES currently leave <c>KpiViewModel.SubText</c> null; only FPY sets it).
/// </summary>
public sealed class NullOrEmptyToVisibilityConverter : IValueConverter
{
    public object Convert(object? value, Type targetType, object? parameter, CultureInfo culture) =>
        string.IsNullOrEmpty(value as string) ? Visibility.Collapsed : Visibility.Visible;

    public object ConvertBack(object? value, Type targetType, object? parameter, CultureInfo culture) =>
        throw new NotSupportedException();
}
