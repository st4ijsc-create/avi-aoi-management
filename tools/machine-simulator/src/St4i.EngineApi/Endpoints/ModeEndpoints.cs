using St4i.EngineApi.Fleet;

namespace St4i.EngineApi.Endpoints;

/// <summary><c>GET /v1/mode</c> · <c>PUT /v1/mode {mode:"Live"|"Demo"|"Auto"}</c>.</summary>
public static class ModeEndpoints
{
    public static void MapModeEndpoints(this IEndpointRouteBuilder app)
    {
        app.MapGet("/v1/mode", (FleetHost host) => Results.Ok(new ModeDto(host.Mode)));

        app.MapPut("/v1/mode", (ModeDto request, FleetHost host) =>
        {
            host.ApplyMode(request.Mode);
            return Results.Ok(new ModeDto(host.Mode));
        });
    }
}
