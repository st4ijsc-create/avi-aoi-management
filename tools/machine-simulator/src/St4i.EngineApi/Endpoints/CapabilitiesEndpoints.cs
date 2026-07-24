using St4i.EngineApi.Config;
using St4i.EngineApi.Fleet;

namespace St4i.EngineApi.Endpoints;

/// <summary>WS2-T1 (docs/PRODUCTION_UI_DESIGN.md §2.2) — <c>GET /v1/capabilities</c>: what this
/// deployment allows, read once at startup (<see cref="DemoModeGate"/>) and reported alongside the
/// CURRENT mode so the web shell can decide whether to render the DEMO option (topbar segmented
/// control, Settings mode selector) BEFORE ever attempting a switch, instead of discovering it only
/// from a rejected <c>PUT /v1/mode</c>.</summary>
public static class CapabilitiesEndpoints
{
    public static void MapCapabilitiesEndpoints(this IEndpointRouteBuilder app)
    {
        app.MapGet("/v1/capabilities", (FleetHost host, DemoModeGate demoGate) =>
            Results.Ok(new CapabilitiesDto(demoGate.Enabled, host.Mode)));
    }
}
