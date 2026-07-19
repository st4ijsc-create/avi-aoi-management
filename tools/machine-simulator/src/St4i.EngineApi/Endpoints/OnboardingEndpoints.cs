using St4i.EngineApi.Fleet;

namespace St4i.EngineApi.Endpoints;

/// <summary><c>POST /v1/onboarding/{register|poll|claim|enroll|paste-key}</c> — demo fabricates the
/// whole register→approve→claim/enroll flow with no live server (default); Live mode is available via
/// <c>isDemo:false</c> + <c>serverUrl</c> in the request body. See <see cref="OnboardingService"/>.</summary>
public static class OnboardingEndpoints
{
    public static void MapOnboardingEndpoints(this IEndpointRouteBuilder app)
    {
        app.MapPost("/v1/onboarding/register", async (OnboardingRegisterRequest request, OnboardingService svc, CancellationToken ct) =>
            Results.Ok(await svc.RegisterAsync(request, ct).ConfigureAwait(false)));

        app.MapPost("/v1/onboarding/poll", async (OnboardingPollRequest request, OnboardingService svc, CancellationToken ct) =>
            Results.Ok(await svc.PollAsync(request, ct).ConfigureAwait(false)));

        app.MapPost("/v1/onboarding/claim", async (OnboardingClaimRequest request, OnboardingService svc, CancellationToken ct) =>
            Results.Ok(await svc.ClaimAsync(request, ct).ConfigureAwait(false)));

        app.MapPost("/v1/onboarding/enroll", async (OnboardingEnrollRequest request, OnboardingService svc, CancellationToken ct) =>
            Results.Ok(await svc.EnrollAsync(request, ct).ConfigureAwait(false)));

        app.MapPost("/v1/onboarding/paste-key", (OnboardingPasteKeyRequest request, OnboardingService svc) =>
            Results.Ok(svc.PasteKey(request)));
    }
}
