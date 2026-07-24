using St4i.EdgeCore.Models;
using St4i.EngineApi.Fleet;

namespace St4i.EngineApi.Endpoints;

/// <summary><c>POST /v1/onboarding/{register|poll|claim|enroll|paste-key}</c> — demo fabricates the
/// whole register→approve→claim/enroll flow with no live server; Live mode is available via
/// <c>isDemo:false</c> + <c>serverUrl</c> in the request body. See <see cref="OnboardingService"/>.
///
/// E2: Claim/Enroll are the two steps that can actually provision a machine (mint an <c>mk_</c> key), so
/// after either succeeds this layer calls <see cref="OnboardingFleetJoin.JoinFleetIfProvisioned"/> —
/// with <see cref="FleetHost"/> already available here via DI, this is the "cleaner seam" than injecting
/// FleetHost into <see cref="OnboardingService"/> itself: OnboardingService stays a plain, fleet-free,
/// independently-testable HTTP/demo service, and the endpoint layer is where the fleet-join glue lives —
/// symmetrically for BOTH Demo and Live, since either mode can produce a freshly-provisioned machine.
///
/// WS2-T1 (docs/PRODUCTION_UI_DESIGN.md §2.1) — a request that OMITS <c>isDemo</c> entirely no longer
/// silently fabricates: <see cref="ResolveIsDemo"/> now derives it from <see cref="FleetHost.Mode"/>,
/// the engine's OWN active transport mode (Live by default post-WS2-T1, Demo on an exhibition/
/// <c>ST4I_DEMO_ENABLED</c> deployment — see <c>St4i.EngineApi.Config.DemoModeGate</c>), the SAME
/// FleetHost already injected here for the fleet-join glue above. The web wizard
/// (<c>Onboarding.tsx</c>) always sends an explicit <c>isDemo</c> today, so this resolution only
/// matters for OTHER callers (SDKs, curl, a future integration) that don't.</summary>
public static class OnboardingEndpoints
{
    public static void MapOnboardingEndpoints(this IEndpointRouteBuilder app)
    {
        app.MapPost("/v1/onboarding/register", async (OnboardingRegisterRequest request, OnboardingService svc, FleetHost fleetHost, CancellationToken ct) =>
        {
            var resolved = request with { IsDemo = ResolveIsDemo(request.IsDemo, fleetHost) };
            return Results.Ok(await svc.RegisterAsync(resolved, ct).ConfigureAwait(false));
        });

        app.MapPost("/v1/onboarding/poll", async (OnboardingPollRequest request, OnboardingService svc, FleetHost fleetHost, CancellationToken ct) =>
        {
            var resolved = request with { IsDemo = ResolveIsDemo(request.IsDemo, fleetHost) };
            return Results.Ok(await svc.PollAsync(resolved, ct).ConfigureAwait(false));
        });

        app.MapPost("/v1/onboarding/claim", async (OnboardingClaimRequest request, OnboardingService svc, FleetHost fleetHost, CancellationToken ct) =>
        {
            var resolved = request with { IsDemo = ResolveIsDemo(request.IsDemo, fleetHost) };
            var result = await svc.ClaimAsync(resolved, ct).ConfigureAwait(false);
            result = OnboardingFleetJoin.JoinFleetIfProvisioned(fleetHost, result, request.SerialNumber, request.MachineType);
            return Results.Ok(result);
        });

        app.MapPost("/v1/onboarding/enroll", async (OnboardingEnrollRequest request, OnboardingService svc, FleetHost fleetHost, CancellationToken ct) =>
        {
            var resolved = request with { IsDemo = ResolveIsDemo(request.IsDemo, fleetHost) };
            var result = await svc.EnrollAsync(resolved, ct).ConfigureAwait(false);
            result = OnboardingFleetJoin.JoinFleetIfProvisioned(fleetHost, result, request.SerialNumber, request.MachineType);
            return Results.Ok(result);
        });

        app.MapPost("/v1/onboarding/paste-key", (OnboardingPasteKeyRequest request, OnboardingService svc) =>
            Results.Ok(svc.PasteKey(request)));
    }

    private static bool ResolveIsDemo(bool? requested, FleetHost fleetHost) =>
        requested ?? fleetHost.Mode == TransportMode.Demo;
}
