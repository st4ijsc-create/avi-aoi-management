namespace St4i.EngineApi.Auth;

// ─────────────────────────────────────────────────────────────────────────
// WS-D-D3 — GET /v1/audit + GET /v1/audit/verify wire shapes. Same flattened-scalar discipline as
// HistorianDtos (WS-A Task 8): every field here is a plain JSON-safe scalar, so no ConfigJson.Options
// detour is needed — plain minimal-API default (web/camelCase) serialization is enough. Deliberately
// mirrors IAuditStore's own AuditEntry/AuditPage/AuditVerifyResult records field-for-field rather than
// reshaping anything — there's no St4i.EdgeCore.Config enum or non-JSON-safe type on this read surface
// to flatten in the first place.
// ─────────────────────────────────────────────────────────────────────────

public sealed record AuditEntryDto(
    long Seq, DateTimeOffset AtUtc, string ActorUsername, string ActorRole, string Action,
    string? TargetType, string? TargetId, string? OldValueJson, string? NewValueJson,
    string? CorrelationId, string? ClientIp, string PrevHash, string RowHash);

public sealed record AuditPageDto(IReadOnlyList<AuditEntryDto> Items, int Total, int Limit, int Offset);

public sealed record AuditVerifyResultDto(bool Ok, long? FirstBrokenSeq, string Detail);
