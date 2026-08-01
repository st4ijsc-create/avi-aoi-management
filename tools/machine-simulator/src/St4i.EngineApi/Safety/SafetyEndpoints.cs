using St4i.EngineApi.Auth;
using St4i.EngineApi.Fleet;

namespace St4i.EngineApi.Safety;

/// <summary>XC-R40 — the READ-ONLY safety status surface. There is intentionally NO write route here: the
/// only way to change the HALT latch is the existing operator <c>POST /v1/fleet/estop</c>/<c>.../reset</c>.</summary>
public static class SafetyEndpoints
{
    // SM-4/B-8 — this string is the one advisory an integrator evaluating this product against a real
    // machine is most likely to actually read (it rides GET /v1/safety's own wire response). It must say
    // plainly, not just hedge, two things that are BOTH still true at once even though they sound like
    // they should contradict: (1) this halt is not a safety device, and (2) this product now has a real
    // write path to a device (Modbus/OPC-UA setpoints and commands — POST /v1/machines/{code}/setpoint|
    // command). Those two facts do not cancel each other out — see the string's own last paragraph for
    // the direct answer to "you can write now, why doesn't HALT stop my machine?", which is the question
    // this advisory exists to pre-empt now that the reason Đợt A gave (no write path existed) is gone.
    private const string XcR40Advisory =
        "This halt is a SUPERVISORY software latch (SYNAPSE XC-R40): it stops this software's own data " +
        "collection and disconnects from the configured device(s). It is NOT a substitute for the machine's " +
        "own independent, safety-rated emergency-stop circuit (a hardwired circuit per ISO 13849) and must " +
        "never be relied on as a protective safety function. This product CAN write to a device now " +
        "(Modbus TCP and OPC-UA setpoints/commands, gated by role and by this same halt latch) — but this " +
        "halt itself does not, and will not be made to: a software \"emergency stop\" that talks to a PLC " +
        "would look even more like a safety device while still not being one, which is worse, not safer. A " +
        "real emergency stop must be a hardwired Cat 3/4 circuit per ISO 13849, wired directly to the " +
        "machine, independent of this or any other software.";

    public static void MapSafetyEndpoints(this IEndpointRouteBuilder app)
    {
        app.MapGet("/v1/safety", (FleetHost host) =>
        {
            var s = host.GetSafetyStatus();
            return Results.Ok(new SafetyStatusDto(s.EstopEngaged, s.IsRunning, "SupervisorySoftwareLatch", XcR40Advisory));
        }).RequireAuthorization(Policies.Operator);
    }
}
