using St4i.EdgeCore.Models;
using St4i.EngineApi.Auth;
using St4i.EngineApi.Config;
using St4i.EngineApi.Fleet;

namespace St4i.EngineApi.Endpoints;

/// <summary><c>GET /v1/mode</c> · <c>PUT /v1/mode {mode:"Live"|"Demo"|"Auto"}</c>.
///
/// WS2-T1 (docs/PRODUCTION_UI_DESIGN.md §2.2) — Auto is no longer offered on any user-selectable
/// surface (topbar/Settings), but the wire contract still accepts it unchanged: <c>AutoTransport</c>/
/// <c>TransportMode.Auto</c> stay in EdgeCore (still used by the WPF exhibition app), so rejecting it
/// here would be surface-inconsistent with a value the enum and transport stack both still fully
/// support — removal was scoped to the UI, not the wire contract. A switch TO Demo, however, IS
/// rejected outright when <see cref="DemoModeGate.Enabled"/> is false — an honest 400 (§2.2: "trả về
/// trạng thái 'chế độ Demo chưa bật', không phải lỗi mơ hồ"), not a silent no-op or a vague failure.</summary>
public static class ModeEndpoints
{
    public static void MapModeEndpoints(this IEndpointRouteBuilder app)
    {
        app.MapGet("/v1/mode", (FleetHost host) => Results.Ok(new ModeDto(host.Mode)))
            .RequireAuthorization(Policies.Operator);

        app.MapPut("/v1/mode", (ModeDto request, FleetHost host, DemoModeGate demoGate) =>
        {
            if (request.Mode == TransportMode.Demo && !demoGate.Enabled)
            {
                return Results.BadRequest(new ApiErrorDto("Demo mode is not enabled on this deployment."));
            }

            host.ApplyMode(request.Mode);
            return Results.Ok(new ModeDto(host.Mode));
        }).RequireAuthorization(Policies.Engineer);
    }
}
