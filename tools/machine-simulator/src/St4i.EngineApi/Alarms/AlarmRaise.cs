namespace St4i.EngineApi.Alarms;

/// <summary>
/// Everything a caller supplies to <see cref="IAlarmStore.RaiseAsync"/> — deliberately excludes every
/// field <see cref="AlarmStore"/> itself computes/owns (<see cref="Alarm.Id"/>, <see cref="Alarm.State"/>,
/// <see cref="Alarm.Count"/>, the raised/acked timestamps) the same way <c>AuditAppend</c> excludes
/// <c>AuditEntry</c>'s store-computed fields.
///
/// <see cref="Key"/> is the dedup identity <see cref="AlarmStore.RaiseAsync"/> upserts on — see
/// <see cref="Alarm"/>'s doc comment for exactly what a same-key re-raise does and does not overwrite.
/// </summary>
public sealed record AlarmRaise(
    AlarmSource Source,
    string Code,
    AlarmPriority Priority,
    string Message,
    string? Runbook = null,
    string? TargetId = null,
    bool ClearOnAck = false)
{
    public string Key => $"{Source}:{Code}:{TargetId}";
}
