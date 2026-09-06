using System.Reflection;
using St4i.EdgeCore.Config;
using St4i.EdgeCore.Licensing;
using St4i.EngineApi.Fleet;
using St4i.EngineApi.Licensing;

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
        //
        // WS-HMI-0a Task 5 — HmiModelEnabled is unconditionally true: no license tier exists yet to turn
        // it off, and the two stores it names (IComponentModelStore/ITagNamespaceStore) are registered a
        // few hundred lines up in Program.cs regardless. See CapabilitiesDto's own doc comment for why
        // this is named for the MODEL layer and not shared with the API-layer flag WS-HMI-0b adds later.
        //
        // WS-HMI-0b Task 4 — HmiApiEnabled, likewise unconditionally true, and deliberately a SECOND flag
        // rather than a rename of the first: 0a shipped a released state where the stores existed and no
        // route could reach them, which is precisely the state the two flags exist to let a client tell
        // apart. The change lane (WS /v1/hmi/changes) gets NO third flag — see CapabilitiesDto's own doc
        // comment for why a flag that can never disagree with another is worse than no flag.
        //
        // 🔴 WS-E (License/Edition) — THE GATE ARRIVED, AND THE TWO LITERAL `true`s ABOVE ARE NOW READS.
        // `Fleet/Dtos.cs`'s comment named this workstream by name and set its condition: give the flags a
        // real gate "without moving where the flag is reported". The five original members keep their
        // exact names, types and order; three new members are additive (measured free — see CapabilitiesDto).
        //
        // 🔴 THIS ENDPOINT MUST BE TOTAL. It answers 200 in EVERY licence state, including Missing,
        // Corrupt and Invalid, and it stays AllowAnonymous. Three suites call it on a fixture with no
        // licence file at all (AuthPipelineTests, TagIngestionWiringTests, HmiModelWiringTests), the web
        // shell cannot boot without it, and an unlicensed appliance is a WORKING machine whose shell must
        // still render. A licence state is reported here, never enforced here — enforcement is the
        // per-route endpoint filter, and this is Layer A (advisory) of the two-layer split: a client that
        // ignores this response is still refused at the route.
        //
        // 🔴 LicenseGate IS RESOLVED OPTIONALLY (`LicenseGate?`), and that is not defensive noise. A
        // host that composes this endpoint without registering the gate must still answer 200 with the
        // honest unlicensed answer rather than throwing on a route the shell needs to boot — the same
        // reasoning SiteDiscovery's own registration comment gives for why a nullable inferred parameter
        // on a minimal-API route is a real hazard here.
        app.MapGet("/v1/capabilities", (FleetHost host, DemoModeGate demoGate, LicenseGate? license) =>
            Results.Ok(new CapabilitiesDto(
                demoGate.Enabled,
                host.Mode,
                ProductVersion,
                // Core features: free in every edition, licence or none — see CapabilitiesDto's comment
                // for the measurement (the kiosk renders through both of these) that put them there.
                HmiModelEnabled: license?.Has(LicenseFeatures.HmiModel) ?? true,
                HmiApiEnabled: license?.Has(LicenseFeatures.HmiApi) ?? true,
                LicenseEdition: license?.Edition ?? "Core",
                LicenseState: (license?.State ?? St4i.EdgeCore.Licensing.LicenseState.Missing).ToString(),
                LicenseExpiresAtUtc: license?.ExpiresAtUtc?.ToUniversalTime().ToString("O"),
                // 🔴 The flag that actually GATES, and the one a client should branch on to decide whether
                // to offer the editor. The two above are Core and therefore always true; this one is false
                // on an unlicensed, expired or wrong-machine appliance.
                HmiAuthoringEnabled: license?.Has(LicenseFeatures.HmiAuthoring) ?? false)))
            .AllowAnonymous();
    }
}
