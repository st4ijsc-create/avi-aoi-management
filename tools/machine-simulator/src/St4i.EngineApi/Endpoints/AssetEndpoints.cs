using St4i.EngineApi.AssetRegistry;
using St4i.EngineApi.Auth;
using St4i.EngineApi.Fleet;

namespace St4i.EngineApi.Endpoints;

/// <summary>
/// P2-1 (WS-J Asset Registry) — the asset registry HTTP surface: <c>GET /v1/assets</c> (list, Operator),
/// <c>GET /v1/assets/{code}</c> (detail, Operator), <c>PUT /v1/assets/{code}/lifecycle</c> (Engineer,
/// audited via <see cref="AuditRecorder"/> — same mutating-handler shape as
/// <c>HistorianEndpoints.PutOeeSettingsAsync</c>: read the "before" value, apply the mutation, THEN
/// record, per the WS-D-D4 ordering rule that a rejected/400 mutation writes no audit row). Same
/// <c>internal static</c>, method-group-bound handler shape as every other <c>Map*Endpoints</c> file in
/// this project — <c>AssetRecord</c> is returned as-is (the app's global JSON options already
/// camelCase + enum-as-string every response, see <c>JsonConfig.ApiJson</c>/<c>Program.cs</c>'s
/// <c>ConfigureHttpJsonOptions</c>).
/// </summary>
public static class AssetEndpoints
{
    public static void MapAssetEndpoints(this IEndpointRouteBuilder app)
    {
        app.MapGet("/v1/assets", ListAsync).RequireAuthorization(Policies.Operator);
        app.MapGet("/v1/assets/{code}", GetAsync).RequireAuthorization(Policies.Operator);
        app.MapPut("/v1/assets/{code}/lifecycle", SetLifecycleAsync).RequireAuthorization(Policies.Engineer);
    }

    // ─────────────────────────────────────────────────────────────────────
    // GET /v1/assets
    // ─────────────────────────────────────────────────────────────────────
    internal static async Task<IResult> ListAsync(IAssetRegistry registry)
    {
        var records = await registry.ListAsync().ConfigureAwait(false);
        return Results.Ok(records);
    }

    // ─────────────────────────────────────────────────────────────────────
    // GET /v1/assets/{code}
    // ─────────────────────────────────────────────────────────────────────
    internal static async Task<IResult> GetAsync(string code, IAssetRegistry registry)
    {
        var record = await registry.GetAsync(code).ConfigureAwait(false);
        return record is null ? AssetNotFound(code) : Results.Ok(record);
    }

    // ─────────────────────────────────────────────────────────────────────
    // PUT /v1/assets/{code}/lifecycle {state:"Maintenance"}
    // ─────────────────────────────────────────────────────────────────────
    internal static async Task<IResult> SetLifecycleAsync(
        string code, AssetLifecycleRequest body, IAssetRegistry registry, HttpContext context, AuditRecorder recorder, CancellationToken ct)
    {
        if (body is null || !Enum.TryParse<AssetLifecycleState>(body.State, ignoreCase: true, out var state) || !Enum.IsDefined(state))
        {
            return Results.BadRequest(new ApiErrorDto($"'{body?.State}' is not a valid asset lifecycle state."));
        }

        // "before" read BEFORE the mutation — the currently-effective lifecycle for this asset. A 404
        // here (unknown code) means no mutation happens and no audit row is written, matching the
        // WS-D-D4 ordering rule PutOeeSettingsAsync's own doc comment spells out for a rejected mutation.
        var before = await registry.GetAsync(code, ct).ConfigureAwait(false);
        if (before is null) return AssetNotFound(code);

        var after = await registry.SetLifecycleAsync(code, state, ct).ConfigureAwait(false);

        await recorder.RecordAsync(context, "asset.lifecycle.set", "asset", code, new { before.Lifecycle }, new { after!.Lifecycle }, ct)
            .ConfigureAwait(false);

        return Results.Ok(after);
    }

    private static IResult AssetNotFound(string code) => Results.NotFound(new ApiErrorDto($"Asset '{code}' not found."));
}

/// <summary><see cref="State"/> is the raw wire string (e.g. <c>"Maintenance"</c>) — parsed/validated
/// against <see cref="AssetLifecycleState"/> inside <see cref="AssetEndpoints.SetLifecycleAsync"/>, not
/// bound directly as the enum, so an unrecognized value 400s with a real <see cref="ApiErrorDto"/> body
/// instead of a framework-level model-binding failure.</summary>
public sealed record AssetLifecycleRequest(string State);
