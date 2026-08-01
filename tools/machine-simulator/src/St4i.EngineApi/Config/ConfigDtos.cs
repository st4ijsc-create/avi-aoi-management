using System.Text.Json;
using St4i.EdgeCore.Config;

namespace St4i.EngineApi.Config;

// ─────────────────────────────────────────────────────────────────────────
// Task C2 — wire DTOs for the config-sync engine + /v1 endpoints.
//
// Two families:
//  1. Authoring (products/points/recipes CRUD, /v1/products·/v1/recipes) — these just pass the C1
//     EdgeCore.Config domain types (ProductModel/MeasurementPoint/Recipe) straight through as request/
//     response bodies (they're already JSON-serializable with the right wire casing via their own
//     [JsonConverter] attributes — no need to re-shape them). ProductSummaryDto/RecipeSummaryDto below
//     are the only "list view" exception (lighter payload than the full aggregate).
//  2. Sync (per-machine check/pull/push/diff/history + the IConfigSyncBackend seam) — these DO need
//     dedicated DTOs: SyncPointDto in particular mirrors CONFIG_SYNC_SERVER_CONTRACT.md's sync-points
//     wire shape byte-for-byte (a reduced field set vs. the full <POINT> shape — see its own doc
//     comment) so Task C3's Live backend can reuse it unchanged for the real HTTP call.
// ─────────────────────────────────────────────────────────────────────────

// ── Authoring: list views ───────────────────────────────────────────────
public sealed record ProductSummaryDto(
    string Code, string Name, ProductLifecycleStatus LifecycleStatus,
    int PointsConfigVersion, int PointCount, string? ReferenceImageUrl)
{
    public static ProductSummaryDto From(ProductModel p) =>
        new(p.Code, p.Name, p.LifecycleStatus, p.PointsConfigVersion, p.ActivePoints.Count(), p.ReferenceImageUrl);
}

public sealed record RecipeSummaryDto(string Code, string Name, string? MachineType, int Version, RecipeStatus Status, string? Checksum)
{
    public static RecipeSummaryDto From(Recipe r) => new(r.Code, r.Name, r.MachineType, r.Version, r.Status, r.Checksum);
}

// ── Sync: the machine→ecosystem sync-points wire point (contract-faithful, reduced field set) ──────
/// <summary>Mirrors CONFIG_SYNC_SERVER_CONTRACT.md's <c>POST /api/machine/sync-points</c> per-point
/// shape EXACTLY — deliberately a SMALLER field set than the full <c>&lt;POINT&gt;</c> get-points shape
/// (<see cref="MeasurementPoint"/> has the full one): no toleranceMode/tolPlus/tolMinus, no 3D/solder/
/// x-ray fields, no criteria/lighting. Real machines only push back what they actually observe/measure
/// (geometry, position, limits, image) — the richer spec fields are SYNAPSE-UI-authored only. Kept
/// byte-shape-identical to the contract on purpose so Task C3's Live backend can serialize this SAME
/// type straight onto the real HTTP request body with no translation layer.</summary>
public sealed record SyncPointDto(
    string Code,
    string Name,
    string? Description,
    string MeasurementType,
    string? Unit,
    double? LowerLimit,
    double? UpperLimit,
    double? NominalValue,
    double PositionX,
    double PositionY,
    double? Radius,
    double? NormalizedX,
    double? NormalizedY,
    double? NormalizedRadius,
    int? CropWidth,
    int? CropHeight,
    int? OrderIndex,
    string? WorkstationCode,
    bool? IsActive,
    string? ImageBase64,
    string? ImageMimeType,
    string? ImageUrl,
    string? Shape,
    JsonElement? Geometry,
    /// <summary>Opt-in per-point optimistic lock — the LastModifiedAt this caller last knew about for
    /// this point. Null = blind write (contract default, MACHINE_SYNC_OPTIMISTIC_LOCK off).</summary>
    DateTimeOffset? ExpectedUpdatedAt);

public sealed record SyncPointsRequestDto(
    string? MachineCode,
    string ProductModelCode,
    int? SourceImageWidth,
    int? SourceImageHeight,
    int? ClientVersion,
    string? VariantCode,
    IReadOnlyList<SyncPointDto> Points);

public sealed record SyncPointOutcomeDto(string Code, string Status, bool LimitBlocked, string? Message);

/// <summary><c>Status</c> is one of <c>created|updated|conflict|failed</c>.</summary>
public sealed record SyncPointsResultDto(
    bool Success,
    string ProductModelCode,
    int PreviousVersion,
    int NewVersion,
    int PointsCreated,
    int PointsUpdated,
    int PointsFailed,
    int StaleConflicts,
    int BlindOverwrites,
    bool LimitChangesBlocked,
    IReadOnlyList<SyncPointOutcomeDto> Points);

// ── Sync: check-points-version ──────────────────────────────────────────
/// <summary><see cref="PointsChecksum"/> (Task C8) is the ecosystem's <c>ConfigChecksum.ComputePointsChecksum</c>
/// over its ACTIVE points for this product — null when the backend can't produce one (the real
/// server's <c>check-points-version</c> endpoint per CONFIG_SYNC_SERVER_CONTRACT.md returns version
/// only, no checksum, so <see cref="LiveConfigSyncBackend"/> always leaves this null; only
/// <see cref="SimulatedEcosystem"/> (Demo) computes a real one). See <see cref="ProductDriftDto"/>'s
/// doc comment for how this feeds the checksum-first drift decision.</summary>
public sealed record ProductVersionDto(string ProductModelCode, int PointsConfigVersion, int? ImageWidth, int? ImageHeight, string? PointsChecksum = null);

/// <summary>
/// <c>DriftState</c> is one of <c>in_sync|drift|unknown</c> (<c>unknown</c> = the local machine has
/// never seen this product at all).
///
/// Task C8: <see cref="LocalChecksum"/>/<see cref="EcosystemChecksum"/> are the points-content
/// checksums (<c>ConfigChecksum.ComputePointsChecksum</c>) each side computed — surfaced here so the
/// panel can show WHY a given <see cref="DriftState"/> was reached, and so a byte-exact content match
/// is visible even when <see cref="LocalVersion"/>/<see cref="EcosystemVersion"/> differ (checksum is
/// authoritative over version whenever both sides have one — see <c>ConfigSyncEngine.CheckAsync</c>'s
/// own remarks). Null on either side when a checksum wasn't available (no local copy yet, or a Live
/// backend whose check-points-version response doesn't carry one) — <see cref="DriftState"/> then
/// falls back to plain version equality, exactly like this project's own server-side
/// <c>computeDriftState</c>.
/// </summary>
public sealed record ProductDriftDto(
    string ProductModelCode, int? LocalVersion, int EcosystemVersion, string DriftState,
    string? LocalChecksum = null, string? EcosystemChecksum = null);

/// <summary><c>ResolvedBy</c> mirrors the contract's System A <c>resolvedBy:"machine|machineType|none"</c>.</summary>
public sealed record RecipeDriftDto(string Code, int? LocalVersion, int EcosystemVersion, string DriftState, string ResolvedBy);

/// <summary><c>ConfigKind</c> is <c>points</c> (AOI/AVI machines) or <c>recipe</c> (Automation/IoT).
/// Exactly one of <see cref="Products"/>/<see cref="Recipe"/> is populated, matching <see cref="ConfigKind"/>.</summary>
public sealed record MachineConfigCheckDto(string MachineCode, string ConfigKind, IReadOnlyList<ProductDriftDto> Products, RecipeDriftDto? Recipe);

// ── Sync: diff ───────────────────────────────────────────────────────────
public sealed record PointFieldChangeDto(string Field, string? LocalValue, string? EcosystemValue);

public sealed record ChangedPointDto(string Code, string Name, IReadOnlyList<PointFieldChangeDto> Fields);

/// <summary>Direction is "what would applying a PULL do" — <see cref="AddedPointCodes"/> = active in the
/// ecosystem, absent locally (pull would ADD them); <see cref="RemovedPointCodes"/> = active locally,
/// tombstoned in the ecosystem (pull would REMOVE/tombstone them locally too); <see cref="ChangedPoints"/>
/// = active in both, field-level differences.</summary>
public sealed record MachineConfigDiffDto(
    string MachineCode,
    string ProductModelCode,
    int? LocalVersion,
    int EcosystemVersion,
    int VersionDelta,
    IReadOnlyList<string> AddedPointCodes,
    IReadOnlyList<string> RemovedPointCodes,
    IReadOnlyList<ChangedPointDto> ChangedPoints);

// ── Sync: pull / push results ───────────────────────────────────────────
public sealed record MachineConfigPullResultDto(
    string MachineCode,
    string ConfigKind,
    string Code,
    bool Applied,
    int? FromVersion,
    int? ToVersion,
    int PointsApplied,
    int PointsRemoved,
    MachineConfigDiffDto? Diff,
    string Message);

public sealed record MachineConfigPushResultDto(
    string MachineCode,
    string ProductModelCode,
    bool Success,
    int? PreviousVersion,
    int? NewVersion,
    int PointsCreated,
    int PointsUpdated,
    int PointsFailed,
    int StaleConflicts,
    int BlindOverwrites,
    bool LimitChangesBlocked,
    IReadOnlyList<SyncPointOutcomeDto> Points,
    string Message);

// ── Sync: history ────────────────────────────────────────────────────────
/// <summary><c>Op</c> is <c>pull|push</c>; <c>Status</c> is <c>success|failed</c>. <see cref="Seq"/> is
/// the authoritative ordering key (a plain incrementing counter — never wall-clock-derived, so history
/// ordering stays deterministic/testable); <see cref="OccurredAt"/> is real wall-clock time for display
/// only.</summary>
public sealed record ConfigSyncHistoryEntryDto(
    long Seq, DateTimeOffset OccurredAt, string MachineCode, string Op, string Status,
    string Code, int? FromVersion, int? ToVersion, string Summary);

// ── Sync: recipe check (System A) ───────────────────────────────────────
/// <summary><c>ResolvedBy</c> is <c>machine|machineType|none</c> per the contract.</summary>
public sealed record RecipeCheckResultDto(bool Success, string? Code, int Version, string? Checksum, string ResolvedBy);

/// <summary>Task review #4 — response shape of the contract's <c>POST /api/machine/config-sync/ack</c>
/// drift-shadow endpoint. <c>DriftState</c> is <c>in_sync|drift|unknown</c> per the contract when
/// present; <see cref="SimulatedEcosystem"/>'s Demo backend (no real drift-shadow to compute) always
/// reports <c>unknown</c> — an honest "don't know", not a fabricated verdict.</summary>
public sealed record AckResultDto(bool Success, string? MachineId, string ConfigKind, string? DriftState);

public sealed record PointsDeltaResultDto(
    bool HasChanges,
    IReadOnlyList<MeasurementPoint> Points,
    IReadOnlyList<string> DeletedCodes,
    IReadOnlyList<DeletedPointDto> DeletedPoints);

public sealed record DeletedPointDto(string Code, DateTimeOffset DeletedAt, int? DeletedAtVersion);

// ── Per-machine request bodies ──────────────────────────────────────────
public sealed record ConfigPullRequest(string? ProductCode);

public sealed record ConfigPushRequest(string ProductCode, bool Confirm);
