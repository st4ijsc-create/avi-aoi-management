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
    /// <param name="configKind">Task review #4 — the contract's own <c>recipe|device_settings</c>
    /// distinction (CONFIG_SYNC_SERVER_CONTRACT.md: "Recipe ↔ Automation machines. device_settings ↔
    /// IoT."), resolved by <c>ConfigSyncEngine.ResolveConfigKind</c> from the calling
    /// <see cref="St4i.EdgeCore.Models.MachineDescriptor.DeviceClass"/>. Only meaningful to
    /// <see cref="LiveConfigSyncBackend"/> (goes out as the real <c>configKind</c> query param);
    /// <see cref="SimulatedEcosystem"/>'s Demo store doesn't distinguish the two — all "recipes" there
    /// regardless of the calling machine's device class.</param>
    Task<RecipeCheckResultDto> CheckRecipeAsync(string? code, string? machineType, string configKind, CancellationToken ct);

    /// <param name="configKind">See <see cref="CheckRecipeAsync"/>'s own doc comment.</param>
    Task<Recipe?> GetRecipeAsync(string code, string configKind, CancellationToken ct);

    /// <summary>Task review #4 — the contract's drift-shadow endpoint: <c>POST
    /// /api/machine/config-sync/ack {configKind, machineCode|apiKey, code?, version?, checksum?}</c> →
    /// <c>{success, machineId, configKind, driftState}</c> ("writes drift-shadow only, never real
    /// config" per CONFIG_SYNC_SERVER_CONTRACT.md). Lets the server know what a machine currently
    /// believes its resolved recipe/device_settings state is, independent of any actual pull —
    /// <see cref="ConfigSyncEngine"/> calls this best-effort right after a successful recipe pull.
    /// <see cref="SimulatedEcosystem"/>'s Demo implementation is a friendly no-op (there's no real
    /// drift-shadow to write locally); <see cref="LiveConfigSyncBackend"/> POSTs it for real, "friendly,
    /// never throws" like every other Live read/report call.</summary>
    Task<AckResultDto> AckAsync(string configKind, string? code, int? version, string? checksum, CancellationToken ct);
}
