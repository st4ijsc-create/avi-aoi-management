using System.Security.Claims;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Authorization.Policy;
using Microsoft.AspNetCore.Routing;
using Microsoft.Extensions.DependencyInjection;

namespace St4i.EngineApi.Auth;

/// <summary>
/// Task B-6 fix round 1 (review, Important I2) — closes a real gap the review found by running a probe: an
/// Engineer <c>POST /v1/machines/{code}/command</c> (requires <see cref="Policies.Admin"/>) gets <c>403</c>
/// from ASP.NET Core's own authorization MIDDLEWARE, which runs and denies the request BEFORE
/// <see cref="Endpoints.MachineWriteEndpoints"/>'s handler — and therefore before any of this task's own
/// <c>PolicyResults.DenyAsync</c>/<c>AuditRecorder.RecordAsync</c> code — ever runs. The original submission
/// correctly identified this as "nothing for MachineWriteEndpoints to audit" but drew the wrong conclusion:
/// the right one is "therefore an unauthenticated-but-identified attempt to command a physical machine goes
/// completely unrecorded" — the first question an investigator asks after any incident involving an
/// unauthorized command.
///
/// <para><b>Why here, not inside the handler.</b> The route's own <c>RequireAuthorization(Policies.X)</c> is
/// enforced by the authorization MIDDLEWARE (<c>app.UseAuthorization()</c>), which sits structurally BEFORE
/// routing ever reaches an endpoint's handler delegate — there is no code inside
/// <see cref="Endpoints.MachineWriteEndpoints.WriteSetpointAsync"/>/<see cref="Endpoints.MachineWriteEndpoints.InvokeCommandAsync"/>
/// a 403 from that middleware could ever reach. The one seam ASP.NET Core exposes for observing an
/// authorization OUTCOME before the framework turns it into a response is
/// <see cref="IAuthorizationMiddlewareResultHandler"/> — registering a custom one is how this gap gets closed
/// without touching the route's own <c>RequireAuthorization</c> declaration or moving authorization logic into
/// the handler (which a role-denial would never reach in the first place).</para>
///
/// <para><b>Scoped deliberately to the two machine-write routes, not the whole API.</b> The reviewer's own
/// framing: "structurally pre-existing across the API, but this is a new consequence class — a machine
/// command, not a config read." Every other <c>RequireAuthorization</c>-gated route in this app has the exact
/// same structural gap (a role-denied GET/PUT never gets an audit row either), and generalizing this fix to
/// every route is a materially larger, separate architectural decision (what should "an unauthorized attempt
/// to read historian data" even look like as an audit row?) that this task does not take on. This handler
/// checks the CURRENT endpoint's route pattern and is a complete no-op — delegating to the ordinary default
/// handler — for every route except the two this task owns.</para>
///
/// <para><b>Only a genuine ROLE denial is audited, not an anonymous one.</b> <see cref="PolicyAuthorizationResult.Forbidden"/>
/// is true precisely when the caller IS authenticated but fails the policy (the framework's own
/// <c>AuthorizationMiddleware</c> already distinguishes this from <see cref="PolicyAuthorizationResult.Challenged"/>,
/// the anonymous-caller case, which still becomes the existing <c>401</c> via
/// <c>CookieAuthenticationOptions.Events.OnRedirectToLogin</c>, untouched) — exactly the "an identified user
/// attempted something they are not allowed to do" case an investigator needs, and the one the review's own
/// probe demonstrated (an Engineer, not an anonymous caller, attempting <c>/command</c>).</para>
///
/// <para>Uses the SAME <c>"{action}.denied"</c> action-naming convention <see cref="Policy.PolicyResults.DenyAsync"/>
/// already established, and the SAME <c>targetType: "machine"</c>/<c>targetId: &lt;code&gt;</c> shape — an
/// investigator querying <c>GET /v1/audit?action=machine.command.invoke.denied</c> sees BOTH a role-denied
/// attempt (from here) and a policy-engine-denied one (from <c>MachineWriteEndpoints</c>) in the same place,
/// with the same field names, distinguishable only by <c>reason</c> (<c>"ROLE_DENIED"</c> here vs.
/// <c>SAFETY_BLOCKED</c>/<c>NOT_READY</c>/<c>POLICY_DENIED</c> from the policy engine).</para>
/// </summary>
public sealed class MachineWriteRoleDenialAuditHandler : IAuthorizationMiddlewareResultHandler
{
    private readonly IAuthorizationMiddlewareResultHandler _default = new AuthorizationMiddlewareResultHandler();

    public async Task HandleAsync(
        RequestDelegate next, HttpContext context, AuthorizationPolicy policy, PolicyAuthorizationResult authorizeResult)
    {
        if (authorizeResult.Forbidden)
        {
            var action = RouteDeniedAction(context);
            if (action is not null)
            {
                await RecordRoleDenialAsync(context, action).ConfigureAwait(false);
            }
        }

        // Every other case (permitted, anonymous-challenge, or a non-machine-write route) is handled
        // byte-identically to the framework's own default — this handler is additive, never a replacement of
        // the app's overall authorization behavior.
        await _default.HandleAsync(next, context, policy, authorizeResult).ConfigureAwait(false);
    }

    /// <summary>Returns the canonical <c>"{action}.denied"</c> string for the two machine-write routes this
    /// class owns, or <see langword="null"/> for every other route (the no-op case).</summary>
    private static string? RouteDeniedAction(HttpContext context)
    {
        if (context.GetEndpoint() is not RouteEndpoint endpoint) return null;
        return endpoint.RoutePattern.RawText switch
        {
            "/v1/machines/{code}/setpoint" => "machine.setpoint.write.denied",
            "/v1/machines/{code}/command" => "machine.command.invoke.denied",
            _ => null,
        };
    }

    private static async Task RecordRoleDenialAsync(HttpContext context, string action)
    {
        // Best-effort, mirroring AuditRecorder's own never-throws contract for this same reason: a denied
        // machine command must still be REJECTED even if, for whatever reason, no AuditRecorder is
        // resolvable (should not happen in production — defensive only, same posture as
        // PolicyResults.DenyAsync's own null-safe IAlarmStore resolution).
        var recorder = context.RequestServices.GetService<AuditRecorder>();
        if (recorder is null) return;

        var code = context.Request.RouteValues.TryGetValue("code", out var codeValue) ? codeValue?.ToString() : null;
        var attemptedRole = context.User.FindFirstValue(ClaimTypes.Role) ?? "(none)";

        await recorder.RecordAsync(
            context, action, "machine", code,
            null,
            new
            {
                reason = "ROLE_DENIED",
                message = $"Caller (role '{attemptedRole}') does not satisfy the role required for this route.",
            },
            CancellationToken.None).ConfigureAwait(false);
    }
}
