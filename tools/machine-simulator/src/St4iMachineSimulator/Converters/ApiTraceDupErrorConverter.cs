using System.Globalization;
using System.Windows.Data;
using St4i.EdgeCore.Infrastructure;

namespace St4iMachineSimulator.Converters;

/// <summary>
/// Task 17 (API Inspector) "Dup/Error" column text: a transport-level <see cref="ApiTraceEvent.Error"/>
/// (if any) wins over the <see cref="ApiTraceEvent.Duplicate"/> flag — mirrors
/// <c>MachineViewModel.BuildSummary</c>'s ack:ERR-before-dup priority — otherwise "DUP" for a
/// deduplicated idempotency-key resend, otherwise an em-dash for a plain success.
/// </summary>
public sealed class ApiTraceDupErrorConverter : IValueConverter
{
    public object Convert(object? value, Type targetType, object? parameter, CultureInfo culture) => value switch
    {
        ApiTraceEvent { Error.Length: > 0 } e => e.Error!,
        ApiTraceEvent { Duplicate: true } => "DUP",
        _ => "—",
    };

    public object ConvertBack(object? value, Type targetType, object? parameter, CultureInfo culture) =>
        throw new NotSupportedException();
}
