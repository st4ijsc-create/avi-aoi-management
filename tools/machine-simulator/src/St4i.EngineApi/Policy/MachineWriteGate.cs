using St4i.EngineApi.Alarms;
using St4i.EngineApi.Auth;

namespace St4i.EngineApi.Policy;

/// <summary>
/// 🔴 Task C-6 — the two ACTION IDS every machine write is evaluated under, and the one caller-resolved
/// fact <see cref="PolicyRequest.CriticalAlarmActive"/> needs, in ONE place.
///
/// <para><b>Why this type exists.</b> Đợt B built the machine-write gate for exactly one caller —
/// <see cref="St4i.EngineApi.Endpoints.MachineWriteEndpoints"/> — so the action ids were
/// <c>private const</c>s there and the Critical-alarm resolution was a <c>private static</c> next to them.
/// C-6 adds a SECOND caller (the alarm relay, an automatic write with no human in the loop), and a second
/// caller with its own copy of those two things is precisely how a gate stops being one gate:</para>
/// <list type="bullet">
/// <item><description>A copied ACTION ID that drifts by one character is not a weaker gate, it is NO gate.
/// <see cref="Rules.EstopGuardRule"/> matches its <c>ActuatingActions</c> set ordinally and returns
/// <see langword="null"/> — "this rule does not apply" — for anything outside it, so
/// <c>"machine.setpoint.Write"</c> would sail past the HALT latch. (It would then be default-denied by
/// <see cref="Rules.RoleObligationRule"/>, which is the accident that saves you; relying on that is not a
/// design.) Sharing the constant makes the relay's write literally the same action, which is the strongest
/// available form of "the same gate, intact".</description></item>
/// <item><description>A copied CRITICAL-ALARM RESOLUTION that forgot the <see cref="AlarmSource.Policy"/>
/// exclusion would reproduce B-6's review finding I1 — the self-latch where a single <c>SAFETY_BLOCKED</c>
/// denial blocks every subsequent write until somebody acknowledges it — in a caller nobody is watching.
/// <see cref="AnyCriticalAlarmActiveAsync"/> is that resolution, moved here verbatim.</description></item>
/// </list>
///
/// <para><b>What is deliberately NOT here:</b> <c>LineEndpoints</c>' own Critical-alarm helper. It answers a
/// DIFFERENT question (it counts <see cref="AlarmSource.Policy"/> alarms in, because <c>line.start</c> is
/// not the request path that wrote them) and B-6 recorded that difference explicitly. Folding the two
/// together would silently change <c>line.start</c>/<c>line.unhold</c>.</para>
/// </summary>
public static class MachineWriteGate
{
    /// <summary>Setting a pre-declared value on a named writable point. <see cref="Roles.Engineer"/> per
    /// <see cref="Rules.RoleObligationRule"/>; in <see cref="Rules.EstopGuardRule"/>'s actuating set.</summary>
    public const string SetpointAction = "machine.setpoint.write";

    /// <summary>Invoking a named command — the one that can start real, physical motion.
    /// <see cref="Roles.Admin"/> per <see cref="Rules.RoleObligationRule"/>; in
    /// <see cref="Rules.EstopGuardRule"/>'s actuating set.</summary>
    public const string CommandAction = "machine.command.invoke";

    /// <summary>The action id for one <see cref="Rules.RoleObligationRule"/>-recognised machine write,
    /// chosen by whether it is a point or a command. Exists so a caller holding a
    /// <see cref="Alarms.RelayTargetKind"/> cannot pick the wrong one by hand.</summary>
    public static string ActionFor(RelayTargetKind kind) =>
        kind == RelayTargetKind.Command ? CommandAction : SetpointAction;

    /// <summary>
    /// The minimum role <see cref="Rules.RoleObligationRule"/> requires for
    /// <see cref="ActionFor"/>'s action — <see cref="Roles.Engineer"/> for a setpoint,
    /// <see cref="Roles.Admin"/> for a command.
    ///
    /// <para>🔴 Exposed so an automatic caller can present the LEAST privilege that its own configured
    /// target actually needs, rather than running everything at the higher tier. A relay pointed at a point
    /// is Engineer-tier and is refused if it ever tries to invoke a command; only a relay an operator
    /// explicitly configured as a <see cref="RelayTargetKind.Command"/> target presents Admin. The tier is a
    /// property of the ACT (B-6: "setting a value and starting a motion are different acts"), not of a
    /// person, which is what makes it meaningful for a non-human actor at all.</para>
    /// </summary>
    public static string RoleFor(RelayTargetKind kind) =>
        kind == RelayTargetKind.Command ? Roles.Admin : Roles.Engineer;

    /// <summary>
    /// Resolves <see cref="PolicyRequest.CriticalAlarmActive"/> — moved here from
    /// <c>MachineWriteEndpoints.AnyCriticalAlarmActiveAsync</c> unchanged, so the ONE caller that needs it
    /// and the ONE caller that would otherwise copy it read the same code.
    ///
    /// <para>🔴 <see cref="AlarmSource.Policy"/> is EXCLUDED, and that exclusion is load-bearing rather than
    /// tidy (B-6 review finding I1, reproduced by the reviewer's own probe):
    /// <see cref="PolicyResults.DenyAsync"/> raises a <see cref="AlarmPriority.Critical"/>
    /// <see cref="AlarmSource.Policy"/> alarm for every <c>SAFETY_BLOCKED</c> denial. Counted in, ANY
    /// HALT-blocked attempt raises an alarm that then blocks EVERY subsequent write via
    /// <see cref="Rules.CriticalAlarmGuardRule"/> until an operator finds and acknowledges it — the most
    /// ordinary sequence in the product ("halt, reset, retry") self-disabling machine-write capability. A
    /// Policy-source alarm is a RECORD OF A REFUSAL this same path just wrote, never an independent
    /// observation about the plant, unlike <see cref="AlarmSource.DriverHealth"/>/
    /// <see cref="AlarmSource.NgRate"/>/<see cref="AlarmSource.Identity"/>.</para>
    /// </summary>
    public static async Task<bool> AnyCriticalAlarmActiveAsync(IAlarmStore alarms, CancellationToken ct)
    {
        ArgumentNullException.ThrowIfNull(alarms);
        var active = await alarms.ListActiveAsync(ct).ConfigureAwait(false);
        return active.Any(a => a.Priority == AlarmPriority.Critical && a.Source != AlarmSource.Policy);
    }
}
