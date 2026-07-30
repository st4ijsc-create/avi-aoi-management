namespace St4i.EngineApi.Policy.Rules;

/// <summary>
/// Task B-6 (.superpowers/sdd/2026-07-29-dotB-machine-control-blueprint/task-6-brief.md) — the
/// Critical-alarm decision. <see cref="St4i.EngineApi.Line.LineController"/> already redirects <c>line.start</c>
/// to Held and rejects <c>line.unhold</c> while a Critical alarm is active (see that class's own doc comment).
/// A write to a machine that is CURRENTLY in a Critical alarm state is at least as consequential — arguably
/// more, since it is a NEW capability landing directly against a device that is, right now, in the worst
/// state this product's alarm model can report — so this rule extends the same posture to the two
/// machine-write/command actions.
///
/// <para><b>Decided: YES, an active Critical alarm blocks a write/command.</b> Argued, not assumed:</para>
/// <list type="bullet">
/// <item><description>Precedent already exists and is signed off — <see cref="St4i.EngineApi.Line.LineController"/>
/// treats "Critical alarm active" as a reason to withhold resuming/starting production. A setpoint write or a
/// command invocation is a strictly narrower, more direct action against the SAME physical equipment a
/// Critical alarm is reporting on — there is no principled reason to gate the coarser action (start
/// production) but not the finer one (poke a specific point on a device already flagged Critical).</description></item>
/// <item><description>It does NOT hand any alarm source new authority the product never intended.
/// <see cref="St4i.EngineApi.Alarms.AlarmEvaluator"/>'s own Identity-expiry alarm is deliberately capped at
/// <see cref="St4i.EngineApi.Alarms.AlarmPriority.High"/> specifically so it can NEVER reach a
/// production-gating check — "an expiring certificate must never stop production". This rule only ever reads
/// <see cref="PolicyRequest.CriticalAlarmActive"/>, which a caller resolves by asking whether ANY alarm is
/// currently <see cref="St4i.EngineApi.Alarms.AlarmPriority.Critical"/> — an alarm source's own choice of
/// priority (already made once, by <see cref="St4i.EngineApi.Alarms.AlarmEvaluator"/>, before this rule ever
/// runs) is what decides whether it can reach this gate, exactly as it already decides whether it reaches
/// <see cref="St4i.EngineApi.Line.LineController"/>'s gate. Nothing here changes any alarm source's priority,
/// widens what counts as Critical, or gives Identity/DriverHealth/NgRate/Policy any NEW power — this rule
/// reuses a decision those sources already made.</description></item>
/// <item><description>Scoped fleet-wide, not per-machine, deliberately: today's <c>Alarm.TargetId</c> values
/// (a slot LABEL for DriverHealth, the literal <c>"fleet"</c> for NgRate, <c>"device"</c> for Identity) do not
/// reliably identify a single MACHINE CODE — a slot can serve more than one roster member (the same fact
/// <see cref="St4i.EngineApi.Fleet.MachineDriverAvailability.AmbiguousDriver"/> exists to guard). Filtering to
/// "only THIS machine's own Critical alarms" would require a per-machine alarm-targeting scheme that does not
/// exist yet and would risk under-blocking (missing a Critical alarm that IS about this machine's shared
/// connector but is labeled by slot, not code). This rule uses the SAME coarse, already-proven-safe signal
/// <see cref="St4i.EngineApi.Line.LineController"/> already uses (any Critical alarm anywhere in the fleet) —
/// a documented, deliberate over-approximation in the safe direction, not an oversight.</description></item>
/// </list>
///
/// <para>Never blocks HALT/reset or anything outside the two machine-write actions — returns
/// <see langword="null"/> for every other action, mirroring <see cref="EstopGuardRule"/>'s own "only ever
/// blocks, never permits" shape exactly.</para>
/// </summary>
public sealed class CriticalAlarmGuardRule : IPolicyRule
{
    private static readonly HashSet<string> WriteActions = new(StringComparer.Ordinal)
    {
        "machine.setpoint.write", "machine.command.invoke",
    };

    public PolicyDecision? Evaluate(PolicyRequest request)
    {
        if (!WriteActions.Contains(request.Action)) return null;
        if (request.CriticalAlarmActive)
        {
            return PolicyDecision.Deny(PolicyReasonCode.NotReady,
                "A Critical alarm is currently active in the fleet — writes and commands to a live machine are " +
                "blocked until it clears. Acknowledge/resolve the Critical alarm (see GET /v1/alarms) before " +
                "retrying. This is independent of the HALT latch — see GET /v1/safety for that separate state.");
        }
        return null; // no Critical alarm active -> let RoleObligation decide
    }
}
