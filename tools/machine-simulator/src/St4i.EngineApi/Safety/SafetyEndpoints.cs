using St4i.EngineApi.Auth;
using St4i.EngineApi.Fleet;

namespace St4i.EngineApi.Safety;

/// <summary>XC-R40 — the READ-ONLY safety status surface. There is intentionally NO write route here: the
/// only way to change the HALT latch is the existing operator <c>POST /v1/fleet/estop</c>/<c>.../reset</c>.</summary>
public static class SafetyEndpoints
{
    // SM-4 — this string is the one advisory an integrator evaluating this product against a real
    // machine is most likely to actually read (it rides GET /v1/safety's own wire response). It must
    // say plainly, not just hedge: this is not a safety device, and this product cannot write to any
    // device at all.
    private const string XcR40Advisory =
        "This halt is a SUPERVISORY software latch (SYNAPSE XC-R40): it stops this software's own data " +
        "collection and disconnects from the configured device(s). It is NOT a substitute for the machine's " +
        "own independent, safety-rated emergency-stop circuit (a hardwired circuit per ISO 13849) and must " +
        "never be relied on as a protective safety function. This product has no write path to any device " +
        "at all.";

    public static void MapSafetyEndpoints(this IEndpointRouteBuilder app)
    {
        app.MapGet("/v1/safety", (FleetHost host) =>
        {
            var s = host.GetSafetyStatus();
            return Results.Ok(new SafetyStatusDto(s.EstopEngaged, s.IsRunning, "SupervisorySoftwareLatch", XcR40Advisory));
        }).RequireAuthorization(Policies.Operator);
    }
}
