using St4i.EngineApi.Auth;
using St4i.EngineApi.Fleet;

namespace St4i.EngineApi.Safety;

/// <summary>XC-R40 — the READ-ONLY safety status surface. There is intentionally NO write route here: the
/// only way to change the E-STOP latch is the existing operator <c>POST /v1/fleet/estop</c>/<c>.../reset</c>.</summary>
public static class SafetyEndpoints
{
    private const string XcR40Advisory =
        "This E-STOP latch is a SUPERVISORY software control (SYNAPSE XC-R40). It is NOT a substitute for the " +
        "machine's independent, safety-rated emergency-stop circuit and must never be relied on as a protective " +
        "safety function.";

    public static void MapSafetyEndpoints(this IEndpointRouteBuilder app)
    {
        app.MapGet("/v1/safety", (FleetHost host) =>
        {
            var s = host.GetSafetyStatus();
            return Results.Ok(new SafetyStatusDto(s.EstopEngaged, s.IsRunning, "SupervisorySoftwareLatch", XcR40Advisory));
        }).RequireAuthorization(Policies.Operator);
    }
}
