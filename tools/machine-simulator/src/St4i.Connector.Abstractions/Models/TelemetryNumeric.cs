namespace St4i.Connector.Abstractions.Models;

/// <summary>
/// GĐ3 sub-3 OU-2 PART A (docs/plans/2026-07-27-giaidoan3-opcua-driver-blueprint.md task 2) — the ONE
/// shared helper every numeric-telemetry aggregation site in this app now goes through, replacing the
/// THREE independently-hand-rolled <c>value is IConvertible c ? ... : continue</c> patterns that used to
/// live in <c>St4i.EdgeCore.Historian.HistorianResultRecord.From</c>,
/// <c>St4i.EngineApi.Fleet.MachineState.ApplyReading</c>'s per-metric telemetry series, and
/// <c>St4i.EngineApi.Fleet.MachineState.SparkValue</c>'s spark-value pick.
///
/// <para><b>Why this exists (the OU-1 review's REQUIRED gate):</b> a configured OPC-UA machine can emit a
/// non-numeric string telemetry tag (e.g. a "status" node → <c>"RUNNING"</c> — see
/// <c>St4i.EdgeCore.Drivers.OpcUa.OpcUaDriver.BoxValue</c>, which passes a <see cref="string"/> value
/// through as-is). Every one of the three sites above used to test only <c>value is IConvertible</c> and
/// then unconditionally call <c>.ToDouble(null)</c> — but <see cref="string"/> genuinely IS
/// <see cref="IConvertible"/>, so <c>Convert.ToDouble("RUNNING")</c> throws a
/// <see cref="FormatException"/> straight out of the caller. For <c>MachineState</c>'s two sites in
/// particular, that call happens synchronously inside <c>FleetHost.OnPipelineCommitted</c> (an inline
/// <c>EdgePipeline.Committed</c> event handler invoked from the pipeline's own run-task) — an unhandled
/// exception there propagates up through <c>EdgePipeline.RunAsync</c> and is caught by
/// <c>FleetHost.StartSlot</c>'s PER-SLOT fault catch, which removes (kills) that entire pipeline slot.
/// I.e. before this helper existed, a single string OPC-UA tag would silently kill the whole OPC-UA slot
/// on its very first poll, the moment that machine had a <c>MachineState</c> (which OU-2's roster wiring
/// is what actually creates).</para>
///
/// <para><b>Contract:</b> true + the parsed value for a genuinely-numeric input (any numeric
/// <see cref="IConvertible"/> primitive, or a numeric <see cref="string"/> like <c>"42.5"</c>); false
/// (never throws) for anything else — including a non-numeric string (a status tag like
/// <c>"RUNNING"</c>), <see langword="null"/>, and any other <see cref="IConvertible"/> whose own
/// <c>ToDouble</c> implementation throws (e.g. <see cref="DateTime"/> — <see cref="IConvertible.ToDouble"/>
/// is explicitly unsupported for it and throws <see cref="InvalidCastException"/>). Existing numeric
/// behavior (a <see cref="double"/>/<see langword="int"/>/etc. value) is preserved byte-for-byte — this
/// helper only ever ADDS a non-throwing fallback, it never changes what a genuinely-numeric value
/// resolves to.</para>
/// </summary>
public static class TelemetryNumeric
{
    /// <summary>Attempts to resolve <paramref name="value"/> (typically a
    /// <see cref="TelemetrySample.Value"/> or a
    /// <see cref="MetricSample.Value"/>) to a numeric <see cref="double"/>. See the
    /// class doc comment for the full contract — in short: numeric in, numeric out; anything
    /// non-numeric (most notably a status-style string) is skipped, never thrown.</summary>
    public static bool TryGet(object? value, out double number)
    {
        number = 0;
        switch (value)
        {
            case null:
                return false;
            case string s:
                return double.TryParse(s, System.Globalization.NumberStyles.Any, System.Globalization.CultureInfo.InvariantCulture, out number);
            case IConvertible c:
                try
                {
                    number = c.ToDouble(System.Globalization.CultureInfo.InvariantCulture);
                    return true;
                }
                catch
                {
                    // e.g. DateTime.ToDouble throws InvalidCastException — skip, never crash the caller.
                    return false;
                }
            default:
                return false;
        }
    }
}
