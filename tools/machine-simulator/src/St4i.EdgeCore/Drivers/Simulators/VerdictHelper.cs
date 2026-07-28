using St4i.Connector.Abstractions.Models;

namespace St4i.EdgeCore.Drivers.Simulators;

/// <summary>
/// Shared pass/warn/fail judgment used by every process-result simulator (doc-62 §6: "pass nếu
/// LSL≤value≤USL, warn cận biên, fail ngoài"). Centralized so every sim applies the identical
/// near-boundary "warn" band instead of each hand-rolling its own threshold math.
/// </summary>
internal static class VerdictHelper
{
    /// <summary>
    /// When neither limit is seeded, there is nothing to judge against — <see cref="Verdict.Warn"/>
    /// is returned (doc-62 §6 ASSEMBLY row: "chưa seed spec → warn-only").
    /// </summary>
    public static Verdict Evaluate(double value, double? lsl, double? usl, double warnMarginFraction = 0.15)
    {
        if (lsl is null && usl is null)
            return Verdict.Warn;

        var margin = MarginOf(lsl, usl, warnMarginFraction);

        if (lsl.HasValue && value < lsl.Value)
            return value >= lsl.Value - margin ? Verdict.Warn : Verdict.Fail;

        if (usl.HasValue && value > usl.Value)
            return value <= usl.Value + margin ? Verdict.Warn : Verdict.Fail;

        // Inside [lsl, usl] (or inside the single seeded bound): still warn if hugging the edge.
        if (lsl.HasValue && value <= lsl.Value + margin) return Verdict.Warn;
        if (usl.HasValue && value >= usl.Value - margin) return Verdict.Warn;
        return Verdict.Pass;
    }

    private static double MarginOf(double? lsl, double? usl, double fraction)
    {
        if (lsl.HasValue && usl.HasValue)
            return (usl.Value - lsl.Value) * fraction;

        // One-sided spec (e.g. leak rate has only a USL): scale the margin off the seeded bound's
        // own magnitude, with a small floor so a near-zero bound still has a usable warn band.
        var anchor = Math.Abs(usl ?? lsl!.Value);
        return Math.Max(anchor * fraction, 0.01);
    }
}
