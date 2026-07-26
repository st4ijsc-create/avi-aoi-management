namespace St4i.EngineApi.Endpoints;

// ─────────────────────────────────────────────────────────────────────────
// Task 8 (WS-A) — the historian READ surface's wire shapes. Every field here is a flattened,
// already-JSON-safe scalar (no St4i.EdgeCore.Config enum ever appears in this file, unlike
// MachineSettingsEndpoints' DTOs) — plain minimal-API default camelCase serialization is enough, no
// ConfigJson.Options detour needed. TelemetrySamples/GenealogyJson/MeasurementsJson from
// HistorianResultRecord are deliberately dropped here (per the Task 8 brief) — not needed by this
// read surface; a client wanting telemetry hits GET /v1/historian/telemetry instead.
// ─────────────────────────────────────────────────────────────────────────

public sealed record HistorianResultDto(
    long Id, string MachineCode, string DeviceClass, string MachineType, string ReadingKind,
    long CycleCounter, string SerialNumber, string Verdict, string? RecipeCode, string? RecipeVersion,
    string? KeyMetricName, double? KeyMetricValue, string? KeyMetricUnit, int NgCount, int PointCount,
    bool AckSuccess, bool AckDuplicate, bool AckQueued, DateTimeOffset EventTimeUtc, DateTimeOffset IngestedAtUtc);

public sealed record HistorianResultsPageDto(IReadOnlyList<HistorianResultDto> Items, int Total, int Limit, int Offset);

public sealed record TelemetryPointDto(DateTimeOffset At, double Value);

public sealed record HistorianStatsDto(long ResultRowCount, long TelemetryRowCount, DateTimeOffset? OldestEventTimeUtc, DateTimeOffset? NewestEventTimeUtc, long DbSizeBytes);

public sealed record PruneRequest(int OlderThanDays);

public sealed record PruneResultDto(int DeletedRows);
