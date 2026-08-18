using System.Globalization;
using System.Windows;
using System.Windows.Data;
using System.Windows.Media;

namespace St4iMachineSimulator.Converters;

/// <summary>
/// Maps a result/verdict string (<c>MeasurementResult.Result</c> — "OK"/"NG"/"NTF" — or
/// <c>Verdict.ToString()</c> — "Pass"/"Warn"/"Fail"/"Skip") onto the shell's 4-color status vocabulary
/// (<c>Brush.Status.*</c> in <c>Themes/Colors.xaml</c>). Used by <c>Controls/BoardView.xaml</c> (Task
/// 16: defect bounding-box color per point) so the NG/NTF/OK → red/amber/green mapping lives in one
/// place instead of being duplicated across every <c>DataTrigger</c> that needs it.
/// </summary>
public sealed class ResultToBrushConverter : IValueConverter
{
    public object Convert(object? value, Type targetType, object? parameter, CultureInfo culture)
    {
        var key = (value as string)?.Trim().ToUpperInvariant() switch
        {
            "NG" or "FAIL" => "Brush.Status.Offline",
            "NTF" or "WARN" => "Brush.Status.Warn",
            "OK" or "PASS" => "Brush.Status.Online",
            _ => "Brush.Status.Unknown",
        };
        return Application.Current?.TryFindResource(key) as Brush ?? Brushes.Gray;
    }

    public object ConvertBack(object? value, Type targetType, object? parameter, CultureInfo culture) =>
        throw new NotSupportedException();
}
