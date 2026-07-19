using St4i.EngineApi.Fleet;

namespace St4i.EngineApi.Endpoints;

/// <summary><c>GET /v1/settings</c> · <c>PUT /v1/settings {serverUrl,verifyTls,language}</c> ·
/// <c>POST /v1/settings/probe {serverUrl}</c> → <c>ProbeResult</c> (<c>{reachable,status,paths}</c>).</summary>
public static class SettingsEndpoints
{
    public static void MapSettingsEndpoints(this IEndpointRouteBuilder app)
    {
        app.MapGet("/v1/settings", (FleetHost host) => Results.Ok(host.GetSettings()));

        app.MapPut("/v1/settings", (SettingsUpdateRequest request, FleetHost host) =>
            Results.Ok(host.UpdateSettings(request)));

        app.MapPost("/v1/settings/probe", async (ProbeRequest request, FleetHost host, CancellationToken ct) =>
        {
            if (string.IsNullOrWhiteSpace(request.ServerUrl))
                return Results.BadRequest(new ApiErrorDto("serverUrl is required"));

            // ResilienceProbe.ProbeAsync never throws on a connectivity failure — it reports
            // Reachable=false with its own bounded (5s) HttpClient timeout, so this never hangs the
            // caller regardless of whether serverUrl is unreachable/refused/DNS-fails.
            var result = await host.ProbeAsync(request.ServerUrl, ct).ConfigureAwait(false);
            return Results.Ok(result);
        });
    }
}
