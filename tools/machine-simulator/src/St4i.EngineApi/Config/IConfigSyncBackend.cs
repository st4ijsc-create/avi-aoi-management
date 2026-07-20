using St4i.EdgeCore.Config;

namespace St4i.EngineApi.Config;

/// <summary>
/// The single seam between <see cref="ConfigSyncEngine"/> (orchestration: local-store bookkeeping,
/// diff computation, history) and "how config actually leaves/enters the building" — mirrors
/// <c>St4i.EdgeCore.Transport.ITransport</c>'s role for readings/acks exactly, one layer up in the
/// config-sync stack.
///
/// Task C2 ships exactly one implementation, <see cref="SimulatedEcosystem"/> (Demo: in-process,
/// JSON-persisted, works fully offline). Task C3 adds a Live implementation (real HTTP calls to
/// CONFIG_SYNC_SERVER_CONTRACT.md's System A/B endpoints via the machine's <c>mk_</c> key) and wires
/// it into <see cref="SwitchableConfigSyncBackend"/> — selected by the app's Live/Demo/Auto transport
/// mode — the same way <c>TransportCoordinator</c> re-points <c>SwitchableTransport</c> today. Every
/// method here is already async so a Live implementation slots in with no signature changes.
/// </summary>
public interface IConfigSyncBackend
{
    /// <summary>"Demo" / "Live" — informational only (Task C7's per-machine panel surfaces this as a
    /// Demo-vs-Live indicator next to the sync controls).</summary>
    string Name { get; }

    // ── System B: points (AOI/AVI) — always-live, true 2-way ───────────────────────────────────
    Task<IReadOnlyList<ProductVersionDto>> CheckPointsVersionAsync(string? productModelCode, CancellationToken ct);

    /// <summary>Full product aggregate (points+fiducials+variants) or null if unknown. <paramref
    /// name="variantCode"/> is accepted for contract-shape parity but variant-override merging is not
    /// implemented in Task C2 — the BASE product is always returned regardless.</summary>
    Task<ProductModel?> GetPointsAsync(string productModelCode, string? variantCode, CancellationToken ct);

    Task<PointsDeltaResultDto> DeltaSyncPointsAsync(string productModelCode, int sinceVersion, CancellationToken ct);

    /// <summary>Throws <see cref="KeyNotFoundException"/> if <paramref name="productModelCode"/> isn't
    /// already known to the ecosystem (a machine can push points TO an existing product; it cannot
    /// create a brand-new product this way — that's SYNAPSE-UI-authored, matches the real contract).</summary>
    Task<SyncPointsResultDto> SyncPointsAsync(string productModelCode, SyncPointsRequestDto request, CancellationToken ct);

    Task<(bool Found, string? ImageUrl)> GetProductImageAsync(string productModelCode, CancellationToken ct);

    Task<bool> SyncProductImageAsync(string productModelCode, string? imageBase64, string? imageUrl, string? imageMimeType, CancellationToken ct);

    Task<(bool Found, string? ImageUrl)> GetPointImageAsync(string productModelCode, string pointCode, CancellationToken ct);

    Task<bool> SyncPointImageAsync(string productModelCode, string pointCode, string? imageBase64, string? imageUrl, CancellationToken ct);

    // ── System A: recipe / device_settings — pull-only, flag-gated on a real server ────────────
    Task<RecipeCheckResultDto> CheckRecipeAsync(string? code, string? machineType, CancellationToken ct);

    Task<Recipe?> GetRecipeAsync(string code, CancellationToken ct);
}
