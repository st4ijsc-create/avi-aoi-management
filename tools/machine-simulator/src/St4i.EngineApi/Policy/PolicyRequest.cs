using System.Security.Claims;
using St4i.EngineApi.Safety;

namespace St4i.EngineApi.Policy;

/// <summary>One command to be authorized by the <see cref="PolicyEngine"/>: the action id, the actor's
/// role/name (extracted from the auth context exactly as <c>AuditRecorder</c> does), and the current
/// read-only <see cref="SafetySnapshot"/>. Deliberately transport-agnostic so a future non-HTTP command
/// path (e.g. a UNS NCMD) can build the same request and be gated by the same rules (the "no back-door").
///
/// <para><see cref="CriticalAlarmActive"/> — Task B-6 (.superpowers/sdd/2026-07-29-dotB-machine-control-blueprint/
/// task-6-brief.md) — a SEPARATE fact from <see cref="Safety"/>: whether a Critical-priority alarm is
/// currently active anywhere in the fleet, per <see cref="St4i.EngineApi.Alarms.IAlarmStore.ListActiveAsync"/>
/// (the SAME signal <see cref="St4i.EngineApi.Line.LineController"/> already uses to redirect <c>line.start</c>
/// to Held and reject <c>line.unhold</c>). It is NOT part of <see cref="SafetySnapshot"/> deliberately —
/// <see cref="SafetySnapshot"/> is a pure, synchronous read off <see cref="St4i.EngineApi.Fleet.FleetHost"/>'s
/// own <c>_gate</c>-protected state (no I/O), whereas an alarm's priority is a fact from a completely
/// different subsystem (<c>IAlarmStore</c>, a SQLite-backed store) that requires an async round trip to
/// answer — a caller resolves it ONCE, before ever calling <see cref="PolicyEngine.Evaluate"/> (mirroring
/// exactly how <c>LineEndpoints.AnyCriticalAlarmActiveAsync</c> is resolved before <c>LineController.Execute</c>
/// is ever called), so every <see cref="IPolicyRule.Evaluate"/> implementation can stay a synchronous, I/O-free
/// function. Defaults to <see langword="false"/> so every PRE-EXISTING call site/test (which never mentions
/// this) is byte-for-byte unaffected — this fact only matters to
/// <see cref="St4i.EngineApi.Policy.Rules.CriticalAlarmGuardRule"/>, a rule that applies to none of the
/// actions any pre-existing caller evaluates.</para></summary>
public sealed record PolicyRequest(
    string Action, string ActorRole, string ActorName, SafetySnapshot Safety, bool CriticalAlarmActive = false)
{
    public static PolicyRequest For(HttpContext ctx, string action, SafetySnapshot safety) => new(
        action,
        ctx.User.FindFirstValue(ClaimTypes.Role) ?? "(none)",
        ctx.User.Identity?.Name ?? "(anonymous)",
        safety);

    /// <summary>Task B-6 — the overload a caller uses when it has ALSO already resolved
    /// <see cref="CriticalAlarmActive"/> (today: <c>MachineWriteEndpoints</c>, for the two machine-write/
    /// command actions <see cref="St4i.EngineApi.Policy.Rules.CriticalAlarmGuardRule"/> gates).</summary>
    public static PolicyRequest For(HttpContext ctx, string action, SafetySnapshot safety, bool criticalAlarmActive) => new(
        action,
        ctx.User.FindFirstValue(ClaimTypes.Role) ?? "(none)",
        ctx.User.Identity?.Name ?? "(anonymous)",
        safety,
        criticalAlarmActive);
}
