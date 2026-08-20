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
/// <para>🔴 <b>"EVERY RATIO CLAMPED" IS WITHDRAWN for ONE of the three, 2026-08-20, task AL-1 (owner item
/// 12, stage 6)</b> — quoted and retired in place, the style this repository uses for a published claim that
/// is narrower than it reads. It holds for Availability and Performance, which are both wrapped in
/// <see cref="Math.Clamp(double, double, double)"/>. It does NOT hold for Quality: that one is a bare
/// <c>GoodCount / TotalCount</c>, so it exceeds 1 — and carries <see cref="OeeResult.Oee"/> with it —
/// for any input whose good count exceeds its total. The three conditions the sentence names as what it is
/// regardless OF are all genuinely guarded, and the unguarded case is a fourth it does not name.
/// <see cref="Calculate"/>'s own doc comment states where the missing bound actually comes from. Retired
/// rather than corrected: the guard is a code change and this task writes prose only.</para>
/// </summary>
public static class OeeCalculator
{
    /// <summary>
    /// The whole of the OEE definition this product ships. It is worth stating as a definition rather than
    /// as a calculation, because every one of the three factors is a CHOICE this method makes and none of
    /// them is forced by the inputs.
    /// <list type="bullet">
    ///   <item><description>Availability is run time over PLANNED time, so an unscheduled window does not
    ///   score 1 for being idle-by-design — it scores 0, because
    ///   <paramref name="plannedProductionTime"/> of zero is treated as "no availability" rather than as
    ///   "not applicable". A window a caller did not intend to measure therefore drags the number down
    ///   instead of being excluded from it.</description></item>
    ///   <item><description>Performance compares the ideal time the counted units SHOULD have taken against
    ///   the run time they actually occupied. A machine that produced nothing at all in a window it was
    ///   running scores 0 here, not 1.</description></item>
    ///   <item><description>Quality is the good count over the total count, and both of those words are
    ///   defined by the SQL in
    ///   <see cref="St4i.EdgeCore.Historian.SqliteHistorianStore.AggregateForOeeAsync"/>, not here — good
    ///   means a verdict of Pass or Warn, total means every verdict except Skip. So a warned cycle counts
    ///   as good in this number even though the verdict's own definition does not promise it was within
    ///   specification.</description></item>
    /// </list>
    /// <para>🔴 The bound on Quality does not live in this method. Availability and Performance are clamped
    /// here; Quality is not, and its value stays at or below 1 only because the two counts it divides come
    /// from nested SQL predicates in the aggregate above — <c>Pass, Warn</c> is a subset of
    /// <c>not Skip</c>. Hand this method an <see cref="St4i.EdgeCore.Historian.OeeInputAggregate"/> built
    /// any other way, which nothing prevents since both types are public, and the result can carry a
    /// Quality and an <see cref="OeeResult.Oee"/> above 1.</para>
    /// <para>The three loss buckets are reported in TIME and they do not sum to the gap between planned time
    /// and run time — they are three independent readings of the same window, computed from different
    /// quantities, and adding them is not meaningful. This method has no state, no I/O and no clock: the
    /// same inputs always produce the same result.</para>
    /// </summary>
    /// <param name="input">One machine's counts and run time over one window, as measured by the historian.
    /// Its <c>MachineCode</c>, <c>From</c> and <c>To</c> are carried through to the result untouched — this
    /// method never checks that the window in the aggregate is the window the caller meant.</param>
    /// <param name="plannedProductionTime">How much of that window the machine was SCHEDULED to run. It is
    /// not the window length: the caller derives it, and the shipped caller multiplies the window by
    /// <see cref="St4i.EdgeCore.Historian.OeeMachineSettings.PlannedProductionRatio"/>. Zero or negative
    /// yields an Availability of 0. A value smaller than the observed run time is not rejected — Availability
    /// clamps to 1 and the downtime bucket floors at zero, so over-running the schedule is absorbed
    /// silently rather than reported.</param>
    /// <param name="idealCycleSeconds">Seconds per unit at nominal speed — the denominator of the
    /// performance term. The shipped caller resolves it as
    /// <see cref="St4i.EdgeCore.Historian.OeeMachineSettings.IdealCycleSecondsOverride"/> when one is stored
    /// and <see cref="St4i.EdgeCore.Models.MachineDescriptor.CycleSeconds"/> otherwise, which means the same
    /// number that sets a simulated machine's cadence also sets its OEE target unless somebody overrode
    /// it.</param>
    /// <returns>The three factors, their product, and the three loss buckets — a value object with no
    /// reference back to the store or the window's source.</returns>
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
