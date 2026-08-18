namespace St4i.EngineApi.Endpoints;

// ─────────────────────────────────────────────────────────────────────────
// Task 8 (WS-A) — the historian READ surface's wire shapes. Every field here is a flattened,
// already-JSON-safe scalar (no St4i.EdgeCore.Config enum ever appears in this file, unlike
// MachineSettingsEndpoints' DTOs) — plain minimal-API default camelCase serialization is enough, no
// ConfigJson.Options detour needed. TelemetrySamples/GenealogyJson/MeasurementsJson from
// HistorianResultRecord are deliberately dropped here (per the Task 8 brief) — not needed by this
// read surface; a client wanting telemetry hits GET /v1/historian/telemetry instead.
// ─────────────────────────────────────────────────────────────────────────

/// <param name="IsFabricated">SM-2 (.superpowers/sdd/2026-07-29-dotA-single-machine-sellable-blueprint/
/// task-2-brief.md) — this row's data lineage, straight off <see cref="St4i.EdgeCore.Historian.HistorianResultRecord.IsFabricated"/>:
/// <see langword="true"/> fabricated (simulated/demo), <see langword="false"/> real,
/// <see langword="null"/> Unknown (a row written before this column existed). Every row this read
/// surface returns already carries its own explicit label — a "must not lie" requirement even when a
/// caller opts into seeing mixed data via <c>includeFabricated=true</c>.</param>
public sealed record HistorianResultDto(
    long Id, string MachineCode, string DeviceClass, string MachineType, string ReadingKind,
    long CycleCounter, string SerialNumber, string Verdict, string? RecipeCode, string? RecipeVersion,
    string? KeyMetricName, double? KeyMetricValue, string? KeyMetricUnit, int NgCount, int PointCount,
    bool AckSuccess, bool AckDuplicate, bool AckQueued, DateTimeOffset EventTimeUtc, DateTimeOffset IngestedAtUtc,
    bool? IsFabricated = null);

public sealed record HistorianResultsPageDto(IReadOnlyList<HistorianResultDto> Items, int Total, int Limit, int Offset);

public sealed record TelemetryPointDto(DateTimeOffset At, double Value);

public sealed record HistorianStatsDto(long ResultRowCount, long TelemetryRowCount, DateTimeOffset? OldestEventTimeUtc, DateTimeOffset? NewestEventTimeUtc, long DbSizeBytes);

public sealed record PruneRequest(int OlderThanDays);

public sealed record PruneResultDto(int DeletedRows);

// ─────────────────────────────────────────────────────────────────────────
// Task 9 (WS-A) — the OEE surface's wire shapes. Same flattened-scalar discipline as the rest of this
// file: <see cref="St4i.EdgeCore.Metrics.OeeResult"/>'s <see cref="TimeSpan"/> fields are converted to
// plain seconds (<c>.TotalSeconds</c>) here rather than serialized as .NET's own "d.hh:mm:ss" TimeSpan
// wire format, and <see cref="St4i.EdgeCore.Historian.OeeMachineSettings"/>'s raw nullable override is
// flattened into an always-populated <c>IdealCycleSeconds</c> (override ?? the fleet roster's
// <c>MachineDescriptor.CycleSeconds</c>) plus a separate <c>IsOverridden</c> flag, so a caller never has
// to know the fallback rule itself.
// ─────────────────────────────────────────────────────────────────────────

/// <summary>
/// 🔴 <b>WHAT THE NUMBERS IN THIS SHAPE COUNT — owner decision of 2026-08-16
/// (<c>docs/owner-decisions.md</c> item 2), written here because this is the shape a person HOLDING an OEE
/// number receives, and the same rule stated on the <c>Verdict</c> enum is where a DRIVER AUTHOR reads.</b>
/// Nothing about the calculation changed when this was written down; only the silence did.
///
/// <para><b>The rule, in the three counts this shape publishes:</b>
/// <list type="bullet">
///   <item><description><c>TotalCount</c> is the DENOMINATOR — every cycle this machine recorded in the
///   window as a process result whose stored verdict is anything other than <c>Skip</c>.</description></item>
///   <item><description><c>GoodCount</c> is the NUMERATOR — of those, the ones whose stored verdict is
///   <c>Pass</c> or <c>Warn</c>. A <c>Fail</c> cycle is in <c>TotalCount</c> and not in
///   <c>GoodCount</c>.</description></item>
///   <item><description>A <c>Skip</c> cycle is in NEITHER count. It does not lower the number; it is
///   absent from it.</description></item>
/// </list>
/// <c>Quality</c> is <c>GoodCount / TotalCount</c> (zero when <c>TotalCount</c> is zero), and
/// <c>Oee</c> is <c>Availability * Performance * Quality</c>. 🔴 So <b>a cycle judged <c>Warn</c> counts as
/// GOOD here</b> — deliberately, and by the same rule this product's live pass-rate tally already applies
/// in-process. The word "warn" on a screen and the number in this shape do not disagree by accident.</para>
///
/// <para>🔴 <b>AND THIS FORMULA CARRIES NO VERSION.</b> Nothing in this shape, and nothing anywhere else in
/// the response that carries it, records WHICH definition of good produced these counts — there is no
/// formula id, no revision, no date of the rule. Two <c>Oee</c> values obtained months apart are therefore
/// not known to be comparable, and a value already exported cannot be re-attributed to a formula later.
/// That is precisely why the owner's decision was to publish the definition rather than change it: changing
/// it would rewrite every OEE number already reported, including ones printed to PDF and sent out, with
/// nothing on either copy to tell the two apart. Any future change to what counts as good needs a VERSIONED
/// formula and a field here to carry the version — not an edit in place.</para>
///
/// <para><b>The scope of the counts, which is not visible from this shape either — and it is TWO filters,
/// not one.</b>
/// <list type="bullet">
///   <item><description><b>Reading kind.</b> Only rows stored under the <c>ProcessResult</c> kind are
///   counted at all. A cycle a driver shipped under another kind is stored and returned by the results
///   query, and contributes nothing to either count — not a zero, absent. See the
///   <c>DeviceReading.Kind</c> member's own doc comment in <c>St4i.Connector.Abstractions</c>.</description></item>
///   <item><description>🔴 <b>Provenance, and on THIS product it is usually the decisive one.</b> By
///   default a row recorded as FABRICATED (simulated or demo data) is excluded from both counts. If the
///   window holds at least one row recorded as real, only real rows are counted; if it holds none, rows
///   written before that column existed are counted as well — but a fabricated row is never counted
///   unless the caller passes <c>includeFabricated=true</c> or the install is in demo mode. Since this
///   product is a SIMULATOR, a machine whose cycles are all simulated therefore reports
///   <c>TotalCount</c> 0, <c>GoodCount</c> 0 and — because zero over zero is defined as zero here —
///   <c>Quality</c> and <c>Oee</c> of 0, which is not the same fact as "this machine ran
///   nothing".</description></item>
/// </list></para>
/// </summary>
public sealed record OeeResultDto(
    string MachineCode, DateTimeOffset From, DateTimeOffset To,
    double Availability, double Performance, double Quality, double Oee,
    double PlannedProductionSeconds, double RunSeconds,
    double DowntimeLossSeconds, double SpeedLossSeconds, double QualityLossSeconds,
    long TotalCount, long GoodCount, double IdealCycleSeconds);

public sealed record OeeSettingsDto(string MachineCode, double IdealCycleSeconds, bool IsOverridden, double PlannedProductionRatio);

public sealed record OeeSettingsUpdateRequest(double? IdealCycleSecondsOverride, double? PlannedProductionRatio);
