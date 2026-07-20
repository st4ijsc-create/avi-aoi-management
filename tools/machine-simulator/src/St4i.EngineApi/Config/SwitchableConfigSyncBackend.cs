using St4i.EdgeCore.Config;

namespace St4i.EngineApi.Config;

/// <summary>
/// Mode-switchable <see cref="IConfigSyncBackend"/> — the config-sync analogue of
/// <c>St4i.EdgeCore.Transport.SwitchableTransport</c> (identical "one gate, one field, atomic swap"
/// shape). <see cref="ConfigSyncEngine"/> is registered against THIS type (not directly against
/// <see cref="SimulatedEcosystem"/>) — Task C3 can construct a Live backend, call <see cref="SetInner"/>
/// to point this at it whenever the app's transport mode flips to Live/Auto (e.g. from a
/// <c>TransportCoordinator.ModeChanged</c> subscriber, exactly like Settings' Live/Demo rebuild today),
/// and every existing endpoint/engine call site keeps working with zero changes.
///
/// Defaults to — and, as of Task C2, only ever holds — <see cref="SimulatedEcosystem"/>; no Live
/// backend exists yet.
/// </summary>
public sealed class SwitchableConfigSyncBackend : IConfigSyncBackend
{
    private readonly object _gate = new();
    private IConfigSyncBackend _inner;

    public SwitchableConfigSyncBackend(IConfigSyncBackend initial)
    {
        _inner = initial ?? throw new ArgumentNullException(nameof(initial));
    }

    /// <summary>Atomically swaps the backend every subsequent call is forwarded to.</summary>
    public void SetInner(IConfigSyncBackend backend)
    {
        ArgumentNullException.ThrowIfNull(backend);
        lock (_gate)
        {
            _inner = backend;
        }
    }

    /// <summary>The backend every call is currently forwarded to — exposed so callers (e.g. a future
    /// Settings-driven rebuild, or a diagnostics endpoint) can inspect what's active.</summary>
    public IConfigSyncBackend Inner
    {
        get { lock (_gate) return _inner; }
    }

    public string Name => Inner.Name;

    public Task<IReadOnlyList<ProductVersionDto>> CheckPointsVersionAsync(string? productModelCode, CancellationToken ct) =>
        Inner.CheckPointsVersionAsync(productModelCode, ct);

    public Task<ProductModel?> GetPointsAsync(string productModelCode, string? variantCode, CancellationToken ct) =>
        Inner.GetPointsAsync(productModelCode, variantCode, ct);

    public Task<PointsDeltaResultDto> DeltaSyncPointsAsync(string productModelCode, int sinceVersion, CancellationToken ct) =>
        Inner.DeltaSyncPointsAsync(productModelCode, sinceVersion, ct);

    public Task<SyncPointsResultDto> SyncPointsAsync(string productModelCode, SyncPointsRequestDto request, CancellationToken ct) =>
        Inner.SyncPointsAsync(productModelCode, request, ct);

    public Task<(bool Found, string? ImageUrl)> GetProductImageAsync(string productModelCode, CancellationToken ct) =>
        Inner.GetProductImageAsync(productModelCode, ct);

    public Task<bool> SyncProductImageAsync(string productModelCode, string? imageBase64, string? imageUrl, string? imageMimeType, CancellationToken ct) =>
        Inner.SyncProductImageAsync(productModelCode, imageBase64, imageUrl, imageMimeType, ct);

    public Task<(bool Found, string? ImageUrl)> GetPointImageAsync(string productModelCode, string pointCode, CancellationToken ct) =>
        Inner.GetPointImageAsync(productModelCode, pointCode, ct);

    public Task<bool> SyncPointImageAsync(string productModelCode, string pointCode, string? imageBase64, string? imageUrl, CancellationToken ct) =>
        Inner.SyncPointImageAsync(productModelCode, pointCode, imageBase64, imageUrl, ct);

    public Task<RecipeCheckResultDto> CheckRecipeAsync(string? code, string? machineType, CancellationToken ct) =>
        Inner.CheckRecipeAsync(code, machineType, ct);

    public Task<Recipe?> GetRecipeAsync(string code, CancellationToken ct) =>
        Inner.GetRecipeAsync(code, ct);
}
