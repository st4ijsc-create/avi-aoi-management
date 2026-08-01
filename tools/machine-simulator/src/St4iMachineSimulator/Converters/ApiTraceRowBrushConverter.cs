using System.Globalization;
using System.Windows;
using System.Windows.Data;
using System.Windows.Media;
using St4i.EdgeCore.Infrastructure;

namespace St4iMachineSimulator.Converters;

/// <summary>
/// Task 17 (API Inspector) row coloring: maps a whole <see cref="ApiTraceEvent"/> row (bound as
/// <c>{Binding}</c> on <c>DataGridRow.Background</c>, not a single property) onto the shell's status
/// color vocabulary — 2xx success = green tint, 4xx/5xx/transport-error = red tint, queued/no-round-trip
/// (HttpStatus 0, no error) = amber tint, anything else transparent. Deliberately its OWN coarse
/// grouping rather than <c>InspectorViewModel.StatusBucket</c> (which buckets by exact status code for
/// the Status filter combo's precision) — a distinct color swatch per exact status code would be
/// unreadable at a glance from across a booth.
/// </summary>
public sealed class ApiTraceRowBrushConverter : IValueConverter
{
    public object Convert(object? value, Type targetType, object? parameter, CultureInfo culture)
    {
        if (value is not ApiTraceEvent e) return Brushes.Transparent;

        string? key = e switch
        {
            { Error.Length: > 0 } => "Brush.Status.OfflineRowBg",
            { Status: >= 200 and < 300 } => "Brush.Status.OnlineRowBg",
            { Status: 0 } => "Brush.Status.WarnRowBg",
            { Status: >= 400 } => "Brush.Status.OfflineRowBg",
            _ => null,
        };

        return key is null
            ? Brushes.Transparent
            : Application.Current?.TryFindResource(key) as Brush ?? Brushes.Transparent;
    }

    public object ConvertBack(object? value, Type targetType, object? parameter, CultureInfo culture) =>
        throw new NotSupportedException();
}
