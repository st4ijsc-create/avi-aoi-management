using System.Text.Json;
using St4i.EdgeCore.Config;

namespace St4i.EngineApi.Config;

// ─────────────────────────────────────────────────────────────────────────
// Task C3 — wire-shape DTOs for the REAL server's System B/A REST responses, per
// docs/CONFIG_SYNC_SERVER_CONTRACT.md. Kept separate from ConfigDtos.cs (C2's engine-internal /v1 DTOs)
// because these mirror the ECOSYSTEM's own envelope shapes (top-level "success", "productModels[]", the
// System A "check"/"get" shape, ...) rather than this engine's own REST surface —
// LiveConfigSyncBackend deserializes straight into these, then maps into the SAME EdgeCore.Config domain
// types / ConfigDtos records SimulatedEcosystem (C2's Demo backend) already returns, so
// ConfigSyncEngine/ConfigEndpoints never have to know which backend is actually talking.
//
// All deserialized with ConfigJson.Options (camelCase naming policy, no enum-converter override) — every
// EdgeCore.Config enum embedded here (MeasurementType/ToleranceMode/PointShape/CoordinateMode/...) keeps
// its own type-level [JsonConverter] casing (e.g. "DIMENSION", "range") exactly as C2's GOTCHA writeup
// describes for the /v1 response path; this is the same mechanism applied to the INBOUND Live side.
//
// The request-body shapes for sync-points/sync-product-image/sync-point-image reuse C2's OWN
// SyncPointsRequestDto/SyncPointDto (ConfigDtos.cs) unchanged — those were deliberately built
// contract-byte-identical for exactly this purpose (see that file's own doc comment) — so only the two
// image-sync request bodies (which C2 had no DTO for) are declared here.
// ─────────────────────────────────────────────────────────────────────────

// ── GET /api/machine/check-points-version ───────────────────────────────
internal sealed record CheckPointsVersionWire(bool Success, IReadOnlyList<ProductVersionWire>? ProductModels);

internal sealed record ProductVersionWire(string ProductModelCode, int PointsConfigVersion, int? ImageWidth, int? ImageHeight);

// ── GET /api/machine/get-points ──────────────────────────────────────────
internal sealed record GetPointsWire(bool Success, long? MachineId, string? MachineCode, IReadOnlyList<GetPointsProductWire>? ProductModels);

internal sealed record GetPointsProductWire(
    long? ProductModelId,
    string ProductModelCode,
    string ProductModelName,
    string? ReferenceImageUrl,
    int? ImageWidth,
    int? ImageHeight,
    int PointsConfigVersion,
    CoordinateMode CoordinateMode,
    IReadOnlyList<Fiducial>? Fiducials,
    int TotalPoints,
    IReadOnlyList<MeasurementPoint>? Points);

// ── GET /api/machine/delta-sync-points ───────────────────────────────────
internal sealed record DeltaSyncWire(
    bool HasChanges,
    IReadOnlyList<MeasurementPoint>? Points,
    IReadOnlyList<string>? DeletedCodes,
    IReadOnlyList<DeletedPointWire>? DeletedPoints);

internal sealed record DeletedPointWire(long? Id, string Code, DateTimeOffset DeletedAt, int? DeletedAtVersion);

// ── GET /api/machine/product-image · GET /api/machine/point-image ──────
internal sealed record ImageWire(bool Success, string? ImageUrl);

// ── POST /api/machine/sync-points response ───────────────────────────────
/// <summary>Field names mirror <see cref="SyncPointsResultDto"/> (C2's Demo response, built to match the
/// contract's own prose description of the sync-points response: "per-point results, limitBlocked (per
/// point), aggregate limitChangesBlocked, staleConflicts, blindOverwrites, pointsCreated/Updated/Failed,
/// new version"). The contract doc doesn't give sync-points' response an explicit JSON block (unlike
/// check-points-version/get-points, which do) — this is the best-effort mapping from that prose,
/// cross-checked against C2's own response DTO; flagged in the C3 report for a real-server smoke check.</summary>
internal sealed record SyncPointsResponseWire(
    bool Success,
    string? ProductModelCode,
    int? PreviousVersion,
    int? NewVersion,
    int PointsCreated,
    int PointsUpdated,
    int PointsFailed,
    int StaleConflicts,
    int BlindOverwrites,
    bool LimitChangesBlocked,
    IReadOnlyList<SyncPointOutcomeWire>? Points);

internal sealed record SyncPointOutcomeWire(string Code, string Status, bool LimitBlocked, string? Message);

// ── System A: GET /api/machine/config-sync/check · GET .../config-sync/get ─────────────────────────
internal sealed record ConfigSyncCheckWire(bool Success, string? ConfigKind, string? Code, string? Version, string? Checksum, string? ResolvedBy);

internal sealed record ConfigSyncGetWire(
    bool Success, string? ConfigKind, string? Code, string? Name, string? Version, string? Checksum, string? ResolvedBy, JsonElement? Payload);

// ── POST /api/machine/sync-product-image · POST /api/machine/sync-point-image request bodies ──────
internal sealed record SyncProductImageWire(string ProductModelCode, string? ImageBase64, string? ImageUrl, string? ImageMimeType, int? ImageWidth, int? ImageHeight);

internal sealed record SyncPointImageWire(string ProductModelCode, string PointCode, string? ImageBase64, string? ImageUrl);

// ── POST /api/machine/config-sync/ack request/response (Task review #4, drift-shadow only) ────────
internal sealed record AckRequestWire(string ConfigKind, string? MachineCode, string? Code, int? Version, string? Checksum);

internal sealed record AckResponseWire(bool Success, long? MachineId, string? ConfigKind, string? DriftState);

// ── POST /api/machine/config-sync/report-settings request/response (Task 7 — machine operating-config
// report-up, docs/MACHINE_CONFIG_DESIGN.md §6, mirrors server/routers/machineApiRouters.ts's
// `reportSettings` input/output 1:1). Field names match the server's zod input exactly (camelCase via
// LiveConfigSyncBackend.RequestOptions); `apiKey`/`machineCode` are NOT sent in the body — auth goes out
// via the X-API-Key/Bearer headers ApplyAuth already attaches (same as every other Live call), and the
// Express proxy layer (server/_core/index.ts) reads the header itself before ever constructing the tRPC
// input, so a body-less machineCode still satisfies the procedure's own `apiKey || machineCode` refine
// once the header is present. `machineCode` IS still sent (some deployments may proxy this endpoint
// without extracting the header) — see ReportSettingsWire.MachineCode.
internal sealed record ReportSettingsWire(
    string ConfigKind,
    string? MachineCode,
    string? ProductModelCode,
    string? BaselineVersion,
    IReadOnlyDictionary<string, ReportAdjustmentWire>? Adjustments,
    IReadOnlyList<ReportEffectiveWire>? Effective,
    string? Checksum,
    string? ReportedBy);

internal sealed record ReportAdjustmentWire(double Value, string? By, string? At, string? Note);

internal sealed record ReportEffectiveWire(string Key, double Value, string? Source, double? BaselineValue);

internal sealed record ReportSettingsResponseWire(
    bool Success,
    long? Id,
    long? MachineId,
    string? ConfigKind,
    string? Scope,
    long? ProductModelId,
    string? Checksum,
    DateTimeOffset? ReportedAt);
