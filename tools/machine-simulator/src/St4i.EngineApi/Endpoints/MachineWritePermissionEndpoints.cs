using St4i.EngineApi.Alarms;
using St4i.EngineApi.Auth;
using St4i.EngineApi.Fleet;
using St4i.EngineApi.Policy;
using St4i.Hmi.Contracts;

namespace St4i.EngineApi.Endpoints;

/// <summary>
/// 🔴 Session S1 (S-6) — <c>GET /v1/machines/{code}/write-permissions</c>: the one READ that lets an HMI
/// screen find out, per session and per action, whether a write widget should render enabled.
///
/// <para><b>The defect this closes.</b> Before S1, <c>policyGate</c> (<c>web/src/hmi-runtime/widgets/
/// shared.ts</c>) looked at exactly one input — whether <c>widget.policyAction</c> was a member of the
/// frozen screen vocabulary — and knew nothing of role, HALT or any engine fact. An Operator opening a
/// screen carrying a <c>command-button</c> therefore saw an ENABLED button for an action that requires
/// <see cref="Roles.Admin"/>. The HMI told an operator a control was available when it was not.</para>
///
/// <para><b>Why the ENGINE answers rather than the document carrying the verdict.</b> Four measured
/// grounds, from the S1 survey: (1) one <c>HmiScreenDocument</c> is served to EVERY viewer of a machine,
/// so a baked-in answer is an answer for nobody in particular; (2) the answer is not static —
/// <see cref="Policy.Rules.EstopGuardRule"/> denies while the HALT latch is engaged and
/// <see cref="Policy.Rules.CriticalAlarmGuardRule"/> denies while a Critical alarm is active, neither
/// knowable at authoring time, and a stale verdict is stale in the PERMISSIVE direction; (3) a document
/// reaching the runtime is not guaranteed schema-valid, so a verdict field inside one would be an
/// attacker- or corruption-controlled grant; (4) <c>HmiScreenStore.RollbackAsync</c> deliberately does not
/// re-validate, so a stored verdict would be resurrected verbatim with no gate in its path.</para>
///
/// <para><b>🔴🔴 THIS ENDPOINT MUST NOT MUTATE. It deliberately does NOT call
/// <see cref="PolicyResults.DenyAsync"/>.</b> That helper writes an audit row and, for a
/// <see cref="PolicyReasonCode.SafetyBlocked"/> denial, raises a Critical <see cref="AlarmSource.Policy"/>
/// alarm — both correct for an ATTEMPTED WRITE, both catastrophic here. This route is a read that any
/// authenticated session may call on every screen render; routing it through <c>DenyAsync</c> would let a
/// page refresh flood the alarm store, and (via <see cref="MachineWriteGate.AnyCriticalAlarmActiveAsync"/>'s
/// deliberate <see cref="AlarmSource.Policy"/> exclusion NOT applying to
/// <see cref="Policy.Rules.CriticalAlarmGuardRule"/>) could self-latch machine writes for the whole site.
/// The raw <see cref="PolicyEngine.Evaluate"/> verdict is returned instead. No audit row, no alarm, no
/// device I/O, no store write of any kind.</para>
///
/// <para><b>🔴 ADVISORY ONLY — this is not an authorisation.</b> The real enforcement stays exactly where
/// it was, at <see cref="MachineWriteEndpoints"/>' own <c>RequireAuthorization</c> plus its own
/// <see cref="PolicyEngine.Evaluate"/> call. A "permitted" answer that has gone stale between this query
/// and an actual write (the latch engages, a Critical alarm fires, the session's role is changed) is
/// refused at the write door, which is the correct place for it. Nothing may treat this response as a
/// grant; its ONLY legitimate consumer is a decision about whether to render a control enabled. That is
/// the same posture <c>web/src/components/MachineControlPanel.tsx</c> already takes for its own
/// client-side check ("only a UX gate; this is the real enforcement").</para>
///
/// <para><b><see cref="Policies.Operator"/>, not Engineer or Admin.</b> Every authenticated role must be
/// able to ASK, because the entire point is that the DENIED role learns it is denied — gating the question
/// at the tier of the answer would mean an Operator could not discover they are an Operator. Asking is a
/// read and touches no device, which is the same reasoning the five HMI screen routes already carry.</para>
///
/// <para><b>Its domain is exactly <see cref="ContractInvariants.KnownPolicyActions"/> — the two machine-write
/// SCREEN actions and nothing else.</b> No <c>fleet.*</c> and no <c>line.*</c> action appears here, ever.
/// HALT and E-stop are never behind a screen concern (skill §3, spec §5 item 2): they stay reachable while
/// latched precisely because <see cref="Policy.Rules.EstopGuardRule"/> returns "does not apply" for them,
/// and nothing in this response may make a HALT control's enabled state depend on a permissions query.</para>
/// </summary>
public static class MachineWritePermissionEndpoints
{
    public static void MapMachineWritePermissionEndpoints(this IEndpointRouteBuilder app)
    {
        app.MapGet("/v1/machines/{code}/write-permissions", GetWritePermissionsAsync)
            .RequireAuthorization(Policies.Operator);
    }

    /// <summary>
    /// Evaluates every member of the frozen screen vocabulary for the CALLING session, using the identical
    /// construction <see cref="MachineWriteEndpoints.WriteSetpointAsync"/> performs — same
    /// <see cref="PolicyRequest.For(HttpContext, string, Safety.SafetySnapshot, bool)"/> overload, same
    /// <see cref="FleetHost.GetSafetyStatus"/> snapshot, same pre-resolved
    /// <see cref="MachineWriteGate.AnyCriticalAlarmActiveAsync"/> fact — so the answer this reports and the
    /// verdict the write door will reach are produced by the same inputs through the same engine, not by a
    /// re-description of it.
    ///
    /// <para>The Critical-alarm fact is resolved ONCE for the whole response rather than per action, both
    /// because it cannot differ between the two actions and because two reads of the alarm store could
    /// straddle a change and return a self-inconsistent answer.</para>
    ///
    /// <para><b>404 for an unknown machine code</b>, matching <c>GET /v1/machines/{code}</c>'s existing
    /// shape. Answering 200-with-denials for a machine that does not exist would tell an operator their
    /// role was the problem when the code was.</para>
    /// </summary>
    internal static async Task<IResult> GetWritePermissionsAsync(
        string code, FleetHost host, IAlarmStore alarms, HttpContext context, PolicyEngine policy,
        CancellationToken ct)
    {
        if (host.MachineDetail(code) is null)
        {
            return Results.NotFound(new ApiErrorDto($"Machine '{code}' not found."));
        }

        var safety = host.GetSafetyStatus();
        var criticalAlarmActive = await MachineWriteGate.AnyCriticalAlarmActiveAsync(alarms, ct).ConfigureAwait(false);

        var permissions = new List<MachineWritePermissionDto>();

        // Ordered for a stable response body. The set itself is the frozen contract vocabulary, reached
        // through its owner rather than retyped here.
        foreach (var policyAction in ContractInvariants.KnownPolicyActions.OrderBy(a => a, StringComparer.Ordinal))
        {
            var engineAction = MachineWriteGate.ActionForPolicyAction(policyAction);

            if (engineAction is null)
            {
                // Unreachable while MachineWriteGateActionMappingTests' totality pin is green — a screen
                // action with no engine action reddens THERE, by name. Handled rather than asserted anyway:
                // this is a read endpoint whose whole job is failing closed, and "not permitted, because I
                // have no engine action for that word" is a strictly better answer than a 500.
                permissions.Add(new MachineWritePermissionDto(
                    policyAction,
                    Permitted: false,
                    ReasonCode: PolicyReasonCode.Unsupported.ToWireCode(),
                    Message: $"'{policyAction}' maps to no engine action; this control cannot be granted.",
                    RequiredRole: null));
                continue;
            }

            var decision = policy.Evaluate(PolicyRequest.For(context, engineAction, safety, criticalAlarmActive));

            permissions.Add(new MachineWritePermissionDto(
                policyAction,
                decision.IsPermitted,
                decision.Reason.ToWireCode(),
                decision.Message,
                MachineWriteGate.RequiredRoleForAction(engineAction)));
        }

        return Results.Ok(new MachineWritePermissionsDto(code, permissions));
    }
}

/// <summary>One action's verdict for the calling session. <paramref name="PolicyAction"/> is the SCREEN
/// word (what a widget declares), never the engine's action id — the engine vocabulary deliberately does
/// not cross this wire, so the web tier never gains a copy of it.</summary>
/// <param name="PolicyAction">The screen-contract action, e.g. <c>machine.command</c>.</param>
/// <param name="Permitted">Whether the calling session may perform it RIGHT NOW. Advisory — see this
/// file's type doc comment.</param>
/// <param name="ReasonCode">The engine's own <see cref="PolicyReasonCode"/>, on the wire, so the client
/// can distinguish a role denial from a HALT block without parsing prose.</param>
/// <param name="Message">The engine's own human-readable explanation.</param>
/// <param name="RequiredRole">The minimum role this action needs, so a denied operator can be told WHO
/// can do it. <see langword="null"/> only when the action maps to nothing.</param>
public sealed record MachineWritePermissionDto(
    string PolicyAction, bool Permitted, string ReasonCode, string Message, string? RequiredRole);

/// <summary>The full per-session answer for one machine.</summary>
public sealed record MachineWritePermissionsDto(
    string MachineCode, IReadOnlyList<MachineWritePermissionDto> Permissions);
