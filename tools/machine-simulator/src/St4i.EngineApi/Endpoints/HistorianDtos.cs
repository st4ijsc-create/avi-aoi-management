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

public sealed record OeeResultDto(
    string MachineCode, DateTimeOffset From, DateTimeOffset To,
    double Availability, double Performance, double Quality, double Oee,
    double PlannedProductionSeconds, double RunSeconds,
    double DowntimeLossSeconds, double SpeedLossSeconds, double QualityLossSeconds,
    long TotalCount, long GoodCount, double IdealCycleSeconds);

public sealed record OeeSettingsDto(string MachineCode, double IdealCycleSeconds, bool IsOverridden, double PlannedProductionRatio);

public sealed record OeeSettingsUpdateRequest(double? IdealCycleSecondsOverride, double? PlannedProductionRatio);
