using System.Reflection;
using St4i.EdgeCore.Config;
using St4i.EngineApi.Fleet;

namespace St4i.EngineApi.Endpoints;

/// <summary>WS2-T1 (docs/PRODUCTION_UI_DESIGN.md §2.2) — <c>GET /v1/capabilities</c>: what this
/// deployment allows, read once at startup (<see cref="DemoModeGate"/>) and reported alongside the
/// CURRENT mode so the web shell can decide whether to render the DEMO option (topbar segmented
/// control, Settings mode selector) BEFORE ever attempting a switch, instead of discovering it only
/// from a rejected <c>PUT /v1/mode</c>.</summary>
public static class CapabilitiesEndpoints
{
    // WS-F1-T1 — the product version, read off THIS project's own built assembly rather than
    // Assembly.GetEntryAssembly(): under Microsoft.AspNetCore.Mvc.Testing's WebApplicationFactory<Program>
    // (every existing EngineApi test that boots the real pipeline), the "entry assembly" is the TEST
    // host process, not St4i.EngineApi.dll — GetExecutingAssembly()/typeof(...).Assembly always resolves
    // to St4i.EngineApi.dll regardless of what process loaded it, which is the actual assembly whose
    // AssemblyVersion tools/machine-simulator/Directory.Build.props' single <Version> controls.
    private static readonly string ProductVersion =
        typeof(CapabilitiesEndpoints).Assembly.GetName().Version?.ToString() ?? "0.0.0";

    public static void MapCapabilitiesEndpoints(this IEndpointRouteBuilder app)
    {
        // WS-D-D1 — anonymous: the web shell needs to know whether Demo is even offered (and, per D1, will
        // also need to know whether it's looking at a logged-out shell) BEFORE any login has happened —
        // same reasoning as /v1/health.
        app.MapGet("/v1/capabilities", (FleetHost host, DemoModeGate demoGate) =>
            Results.Ok(new CapabilitiesDto(demoGate.Enabled, host.Mode, ProductVersion)))
            .AllowAnonymous();
    }
}
