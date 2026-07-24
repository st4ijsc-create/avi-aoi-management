using St4i.EdgeCore.Models;
using St4i.EngineApi.Config;
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
/// silently fabricates: <see cref="TryResolveIsDemo"/> now derives it from <see cref="FleetHost.Mode"/>,
/// the engine's OWN active transport mode (Live by default post-WS2-T1, Demo on an exhibition/
/// <c>ST4I_DEMO_ENABLED</c> deployment — see <c>St4i.EngineApi.Config.DemoModeGate</c>), the SAME
/// FleetHost already injected here for the fleet-join glue above. The web wizard
/// (<c>Onboarding.tsx</c>) always sends an explicit <c>isDemo</c> today, so this resolution only
/// matters for OTHER callers (SDKs, curl, a future integration) that don't.
///
/// I-1 (prod-ui review, defense in depth) — WS2-T1's web gate (<c>Onboarding.tsx</c> reading
/// <c>useCapabilities().demoEnabled</c>) is the primary fix, but this endpoint used to honour an
/// EXPLICIT <c>isDemo:true</c> unconditionally, with no <see cref="DemoModeGate"/> check at all — a
/// stale page (cached before a redeploy flipped the flag off), a hand-written SDK call, or a bare curl
/// against a flag-off deployment could still fabricate a whole onboarding run. <see cref="TryResolveIsDemo"/>
/// now refuses an explicit <c>isDemo:true</c> outright (returns <see langword="null"/>) when
/// <see cref="DemoModeGate.Enabled"/> is false, and each handler turns that into an honest 400 —
/// the SAME choice and the SAME message <see cref="ModeEndpoints"/> already makes for the parallel
/// case (<c>PUT /v1/mode {Demo}</c> on a flag-off deployment). Coercing silently to Live instead was
/// considered and rejected: a caller that explicitly asked for Demo almost certainly omitted
/// <c>serverUrl</c> too, so silently running it as Live would either hit the unconfigured default
/// server URL or produce a confusing downstream failure with no indication WHY — a loud, immediate,
/// on-brand-with-ModeEndpoints 400 is more honest and easier to diagnose. A request that OMITS
/// <c>isDemo</c> is unaffected either way: it already resolves off <c>FleetHost.Mode</c>, which is Live
/// on a flag-off deployment (<c>Program.cs</c>), so it was never able to fabricate anything.</summary>
public static class OnboardingEndpoints
{
    private static readonly ApiErrorDto DemoNotEnabled = new("Demo mode is not enabled on this deployment.");

    public static void MapOnboardingEndpoints(this IEndpointRouteBuilder app)
    {
        app.MapPost("/v1/onboarding/register", async (OnboardingRegisterRequest request, OnboardingService svc, FleetHost fleetHost, DemoModeGate demoGate, CancellationToken ct) =>
        {
            if (TryResolveIsDemo(request.IsDemo, fleetHost, demoGate) is not { } isDemo) return Results.BadRequest(DemoNotEnabled);
            var resolved = request with { IsDemo = isDemo };
            return Results.Ok(await svc.RegisterAsync(resolved, ct).ConfigureAwait(false));
        });

        app.MapPost("/v1/onboarding/poll", async (OnboardingPollRequest request, OnboardingService svc, FleetHost fleetHost, DemoModeGate demoGate, CancellationToken ct) =>
        {
            if (TryResolveIsDemo(request.IsDemo, fleetHost, demoGate) is not { } isDemo) return Results.BadRequest(DemoNotEnabled);
            var resolved = request with { IsDemo = isDemo };
            return Results.Ok(await svc.PollAsync(resolved, ct).ConfigureAwait(false));
        });

        app.MapPost("/v1/onboarding/claim", async (OnboardingClaimRequest request, OnboardingService svc, FleetHost fleetHost, DemoModeGate demoGate, CancellationToken ct) =>
        {
            if (TryResolveIsDemo(request.IsDemo, fleetHost, demoGate) is not { } isDemo) return Results.BadRequest(DemoNotEnabled);
            var resolved = request with { IsDemo = isDemo };
            var result = await svc.ClaimAsync(resolved, ct).ConfigureAwait(false);
            result = OnboardingFleetJoin.JoinFleetIfProvisioned(fleetHost, result, request.SerialNumber, request.MachineType);
            return Results.Ok(result);
        });

        app.MapPost("/v1/onboarding/enroll", async (OnboardingEnrollRequest request, OnboardingService svc, FleetHost fleetHost, DemoModeGate demoGate, CancellationToken ct) =>
        {
            if (TryResolveIsDemo(request.IsDemo, fleetHost, demoGate) is not { } isDemo) return Results.BadRequest(DemoNotEnabled);
            var resolved = request with { IsDemo = isDemo };
            var result = await svc.EnrollAsync(resolved, ct).ConfigureAwait(false);
            result = OnboardingFleetJoin.JoinFleetIfProvisioned(fleetHost, result, request.SerialNumber, request.MachineType);
            return Results.Ok(result);
        });

        app.MapPost("/v1/onboarding/paste-key", (OnboardingPasteKeyRequest request, OnboardingService svc) =>
            Results.Ok(svc.PasteKey(request)));
    }

    /// <summary>Returns the resolved <c>isDemo</c>, or <see langword="null"/> to signal "refuse this
    /// request" (an explicit <c>isDemo:true</c> against a flag-off deployment — see the class doc
    /// comment). <c>internal</c> (not <c>private</c>) so <c>St4i.EngineApi.Tests</c> can exercise the
    /// resolution rules directly against a real <see cref="FleetHost"/>/<see cref="DemoModeGate"/>
    /// without spinning up the ASP.NET host.</summary>
    internal static bool? TryResolveIsDemo(bool? requested, FleetHost fleetHost, DemoModeGate demoGate)
    {
        if (requested == true && !demoGate.Enabled) return null;
        return requested ?? fleetHost.Mode == TransportMode.Demo;
    }
}
