namespace St4i.EngineApi.Alarms;

/// <summary>Where this alarm condition originates. <see cref="Policy"/> is LC-1 (this task) — every
/// <c>PolicyResults.DenyAsync</c> denial; <see cref="DriverHealth"/>/<see cref="NgRate"/> are LC-2 (the
/// periodic health/NG-rate evaluator) — reserved here so <see cref="Alarm.Key"/> stays stable once LC-2
/// lands, not retrofitted later.</summary>
public enum AlarmSource { Policy, DriverHealth, NgRate }

/// <summary>ISA-18.2 alarm priority, most-severe first (the same ordering <see cref="AlarmStore.ListActiveAsync"/>
/// sorts by).</summary>
public enum AlarmPriority { Critical, High, Medium, Low }

/// <summary>An alarm's lifecycle state. <see cref="Cleared"/> is transient in the sense that a
/// <see cref="AlarmStore"/>-backed alarm in that state has already been DELETED from the live
/// (<c>active_alarms</c>) set — it only ever appears as the state carried on the in-memory <see cref="Alarm"/>
/// returned from the call that just cleared it (<see cref="IAlarmStore.AckAsync"/>) or as the "cleared"
/// event in <c>alarm_history</c>.</summary>
public enum AlarmState { Active, Acked, Cleared }

/// <summary>
/// One alarm condition. Identity/dedup key = <see cref="Source"/>+<see cref="Code"/>+<see cref="TargetId"/>
/// (see <see cref="AlarmRaise.Key"/>) — a re-raise of the same key UPDATEs <see cref="LastRaisedUtc"/> +
/// <see cref="Count"/> and PRESERVES <see cref="FirstRaisedUtc"/> + ack state (<see cref="State"/>,
/// <see cref="AckedUtc"/>, <see cref="AckedBy"/>), never resets them back to "freshly raised".
///
/// <see cref="ClearOnAck"/> is the EVENT-vs-CONDITION distinction this whole model hinges on:
/// <list type="bullet">
/// <item><description><b>true</b> — a transient EVENT alarm (LC-1's only source today: a Policy DENY).
/// The triggering event has no lingering state of its own to watch — there is nothing for a periodic
/// evaluator to later decide is "resolved". An operator's Ack IS the resolution, so
/// <see cref="IAlarmStore.AckAsync"/> both acks AND clears it in one step.</description></item>
/// <item><description><b>false</b> — a CONDITION alarm (LC-2: DriverHealth/NgRate). The condition
/// (a driver unreachable, an NG-rate threshold breached) can still be true after an operator acknowledges
/// it — Ack only silences/acknowledges the alarm (moves <see cref="AlarmState.Active"/> →
/// <see cref="AlarmState.Acked"/>), it does NOT clear it. Only the periodic evaluator calling
/// <see cref="IAlarmStore.ClearAsync"/> once the condition itself ends actually removes it from the live
/// set.</description></item>
/// </list>
/// </summary>
public sealed record Alarm(
    long Id,
    string Key,
    AlarmSource Source,
    string Code,
    AlarmPriority Priority,
    AlarmState State,
    string Message,
    string? Runbook,
    string? TargetId,
    bool ClearOnAck,
    int Count,
    DateTimeOffset FirstRaisedUtc,
    DateTimeOffset LastRaisedUtc,
    DateTimeOffset? AckedUtc,
    string? AckedBy);
