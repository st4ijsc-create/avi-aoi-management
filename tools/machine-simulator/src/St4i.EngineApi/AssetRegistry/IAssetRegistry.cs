using St4i.EdgeCore.Models;

namespace St4i.EngineApi.AssetRegistry;

/// <summary>
/// P2-1 (WS-J Asset Registry) — the asset registry seam <see cref="St4i.EngineApi.Fleet.FleetHost"/>
/// upserts through (its roster-seed loop and <c>RegisterMachine</c> — see that class's ctor/method doc
/// comments) and <c>AssetEndpoints</c> reads/mutates through. <see cref="UpsertAsync"/> MUST NEVER throw
/// into the caller — registration/roster-seed must never fail just because <c>assets.db</c> hiccuped; the
/// implementation catches and logs internally instead (see <see cref="AssetRegistryStore"/>'s own doc
/// comment).
/// </summary>
public interface IAssetRegistry
{
    Task UpsertAsync(MachineDescriptor descriptor, CancellationToken ct = default);

    Task<AssetRecord?> GetAsync(string code, CancellationToken ct = default);

    Task<IReadOnlyList<AssetRecord>> ListAsync(CancellationToken ct = default);

    Task<AssetRecord?> SetLifecycleAsync(string code, AssetLifecycleState state, CancellationToken ct = default);
}
