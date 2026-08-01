namespace St4i.EngineApi.Alarms;

/// <summary>
/// Task C-1 — what a store write ACTUALLY did to <c>active_alarms</c>, as opposed to what its caller asked
/// for. This distinction is the whole point: <see cref="IAlarmStore.RaiseAsync"/> is called
/// UNCONDITIONALLY on every <see cref="AlarmEvaluatorService"/> tick (every 5s) by the
/// <see cref="AlarmSource.DriverHealth"/>/<see cref="AlarmSource.NgRate"/> sources for as long as their
/// condition holds — a pre-existing, deliberate shape — so "RaiseAsync was called" says nothing at all
/// about whether anything CHANGED. <see cref="ReRaised"/> vs <see cref="Raised"/> is the difference
/// between 720 notifications an hour and one.
///
/// These are FACTS about the database write, not notification policy. Deciding which of them is worth
/// telling a human about (and de-duplicating them across concurrent callers and across process restarts)
/// is <see cref="AlarmNotifier"/>'s job, not the store's — see that class's own doc comment.
/// </summary>
public enum AlarmTransitionKind
{
    /// <summary>Nothing happened. Either the write failed and was swallowed (see
    /// <see cref="IAlarmStore"/>'s never-throws contract), or the call was a genuine no-op — a
    /// <see cref="IAlarmStore.ClearAsync"/> for a key that no active alarm carries.</summary>
    None,

    /// <summary>The key was NOT in <c>active_alarms</c> before this call and IS now — a first raise (or
    /// the first raise since the key was last cleared). Detected from the upserted row's own
    /// <see cref="Alarm.Count"/>: the INSERT path seeds it to 1, the <c>DO UPDATE</c> path only ever
    /// increments it, so <c>Count == 1</c> is exactly "this row was just created".</summary>
    Raised,

    /// <summary>The key was ALREADY active — the upsert took its <c>DO UPDATE</c> path, bumping
    /// <see cref="Alarm.Count"/>/<see cref="Alarm.LastRaisedUtc"/> (and possibly
    /// <see cref="Alarm.Message"/>/<see cref="Alarm.Priority"/>) while preserving
    /// <see cref="Alarm.FirstRaisedUtc"/> and ack state. The overwhelmingly common outcome in production:
    /// one per tick, per still-true condition, forever.</summary>
    ReRaised,

    /// <summary>The key WAS active (in either <see cref="AlarmState.Active"/> or
    /// <see cref="AlarmState.Acked"/>) and has been removed from <c>active_alarms</c> — by
    /// <see cref="IAlarmStore.ClearAsync"/> (the evaluator noticing the condition ended) or by
    /// <see cref="IAlarmStore.AckAsync"/> on a <see cref="Alarm.ClearOnAck"/> EVENT alarm (the Ack IS the
    /// resolution). <see cref="AlarmTransition.Alarm"/> carries the alarm as it stood at the moment of
    /// removal, with <see cref="Alarm.State"/> set to <see cref="AlarmState.Cleared"/>.</summary>
    Cleared,

    /// <summary><see cref="IAlarmStore.AckAsync"/> acknowledged a <see cref="Alarm.ClearOnAck"/>
    /// == <see langword="false"/> CONDITION alarm IN PLACE: the row stays in <c>active_alarms</c> with
    /// <see cref="Alarm.State"/> == <see cref="AlarmState.Acked"/>. Reported on every such ack, including
    /// a repeat ack of an already-Acked alarm (the store does not remember whether it was already
    /// acked — deduplicating that is <see cref="AlarmNotifier"/>'s job, see its doc comment).</summary>
    Acked,
}

/// <summary>
/// Task C-1 — <see cref="IAlarmStore.RaiseAsync"/>/<see cref="IAlarmStore.ClearAsync"/>'s return value:
/// what the write did (<see cref="Kind"/>) and the resulting alarm row (<see cref="Alarm"/>).
///
/// A <see langword="struct"/> deliberately: <see cref="IAlarmStore.RaiseAsync"/> sits on the request path
/// of EVERY policy denial (<c>PolicyResults.DenyAsync</c>) and on a 5s background tick — neither should
/// allocate a wrapper object just to report an outcome most callers ignore.
///
/// <see cref="Alarm"/> is <see langword="null"/> if and only if <see cref="Kind"/> is
/// <see cref="AlarmTransitionKind.None"/>. Returning the FULL alarm (not just its key) is what lets the
/// notification layer hand a channel everything it needs without ever going back to the store — see
/// <see cref="NotificationJob"/>.
/// </summary>
public readonly record struct AlarmTransition(AlarmTransitionKind Kind, Alarm? Alarm)
{
    /// <summary>The "nothing happened" outcome — also <c>default(AlarmTransition)</c>.</summary>
    public static AlarmTransition None => default;
}
