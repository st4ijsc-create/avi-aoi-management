using St4i.EdgeCore.Historian;

namespace St4i.EdgeCore.Metrics;

/// <summary>
/// WS-A-T4 — pure, dependency-free OEE math: <see cref="OeeInputAggregate"/> + planned production time +
/// ideal cycle time in, <see cref="OeeResult"/> out. No I/O, no <c>IHistorianStore</c>.
/// <para>
/// Loss is split into exactly THREE buckets — Downtime, Speed, Quality — never a finer six-way split.
/// Reason codes (why a machine was down, why a cycle ran slow) don't exist yet; that taxonomy arrives with
/// Alarm/Andon in GĐ2. Inventing extra buckets now would mean guessing at a classification the domain
/// hasn't defined, so this calculator deliberately stops at the three that today's inputs can honestly
/// support.
/// </para>
/// <para>
/// Every division is guarded and every ratio clamped to <c>[0, 1]</c> so the result can never contain NaN,
/// Infinity, or a component above 1 — regardless of zero planned time, zero counts, or an ideal cycle that
/// implies more "ideal" time than actually elapsed.
/// </para>
/// </summary>
public static class OeeCalculator
{
    public static OeeResult Calculate(OeeInputAggregate input, TimeSpan plannedProductionTime, double idealCycleSeconds)
    {
        var availability = plannedProductionTime > TimeSpan.Zero
            ? Math.Clamp(input.RunTime / plannedProductionTime, 0.0, 1.0)
            : 0.0;

        var idealRunSeconds = idealCycleSeconds * input.TotalCount;

        var performance = input.RunTime > TimeSpan.Zero && input.TotalCount > 0
            ? Math.Clamp(idealRunSeconds / input.RunTime.TotalSeconds, 0.0, 1.0)
            : 0.0;

        var quality = input.TotalCount > 0
            ? (double)input.GoodCount / input.TotalCount
            : 0.0;

        var oee = availability * performance * quality;

        var downtimeLossTime = plannedProductionTime - input.RunTime;
        if (downtimeLossTime < TimeSpan.Zero)
        {
            downtimeLossTime = TimeSpan.Zero;
        }

        var speedLossSeconds = Math.Max(0.0, input.RunTime.TotalSeconds - idealRunSeconds);
        var qualityLossSeconds = Math.Max(0.0, (input.TotalCount - input.GoodCount) * idealCycleSeconds);

        return new OeeResult(
            input.MachineCode, input.From, input.To,
            availability, performance, quality, oee,
            plannedProductionTime, input.RunTime,
            downtimeLossTime, TimeSpan.FromSeconds(speedLossSeconds), TimeSpan.FromSeconds(qualityLossSeconds),
            input.TotalCount, input.GoodCount, idealCycleSeconds);
    }
}
