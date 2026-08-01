namespace St4i.EngineApi.Alarms;

/// <summary>
/// Task C-1 — the alarm-state EDGES worth telling a human about. Deliberately NOT the same set as
/// <see cref="AlarmTransitionKind"/>: that enum reports what the DATABASE did (including
/// <see cref="AlarmTransitionKind.ReRaised"/>, which happens every 5s forever and is exactly what must
/// NOT reach anybody), this one reports what CHANGED. See <see cref="AlarmNotifier"/> for the mapping and
/// the argument behind each choice.
/// </summary>
public enum AlarmEdgeKind
{
    /// <summary>An alarm key that was not active is now active. The primary edge — one per condition, no
    /// matter how many times the source restates it.</summary>
    Raised,

    /// <summary>An already-active key got STRICTLY more severe (e.g. High → Critical) without ever
    /// clearing in between. Emitted at most three times per raise-run (Low → Medium → High → Critical) —
    /// see <see cref="AlarmNotifier"/>'s high-water-mark comment for why de-escalation is deliberately
    /// silent and why that bound holds. <see cref="NotificationJob.PreviousPriority"/> carries what it
    /// escalated FROM.</summary>
    Escalated,

    /// <summary>An operator acknowledged a still-active CONDITION alarm
    /// (<see cref="Alarm.ClearOnAck"/> == <see langword="false"/>): <see cref="AlarmState.Active"/> →
    /// <see cref="AlarmState.Acked"/>, the row stays live. The ISA-18.2 "silence the horn" moment — a
    /// local annunciation channel (C-5) stops making noise here, but the alarm itself is still on.
    /// <see cref="NotificationJob.Actor"/> carries who acked it.</summary>
    Acked,

    /// <summary>An active alarm left <c>active_alarms</c> — either the evaluator noticed the condition
    /// ended (<see cref="NotificationJob.Actor"/> <see langword="null"/>) or an operator acked a
    /// <see cref="Alarm.ClearOnAck"/> EVENT alarm (<see cref="NotificationJob.Actor"/> = the
    /// username).</summary>
    Cleared,

    /// <summary>🔴 The restart edge. This alarm was ALREADY in <c>active_alarms</c> when this process
    /// started — it was raised by a PREVIOUS process, was very possibly notified an hour ago, and no
    /// <see cref="Raised"/> edge for it will ever arrive in this process's lifetime. Emitted exactly once
    /// per still-active alarm, once per process start (never per tick). See
    /// <see cref="AlarmNotifier.SeedFromActive"/> for the full argument — briefly: replaying these as
    /// <see cref="Raised"/> would spam every recipient (and, once C-6 lands, pulse a relay coil) on every
    /// restart, while emitting nothing would leave a channel with no way to learn that a Critical alarm
    /// is standing right now. A distinct kind is neither: a webhook can ignore it, a relay/annunciator
    /// MUST honour it or it will sit dark through a real outage.</summary>
    Restored,
}

/// <summary>
/// Task C-1 — one unit of work handed to the notification channels (C-3..C-6) through
/// <see cref="AlarmNotifier"/>'s bounded channel. Carries EVERYTHING a channel needs to render and route
/// a message, deliberately so that no channel ever has to go back and re-query
/// <see cref="IAlarmStore"/>: by the time a job is drained the alarm it describes may well have been
/// cleared, acked or re-raised, so a re-query would render a message that contradicts the edge that
/// caused it.
/// </summary>
/// <param name="Sequence">Per-process, strictly increasing, gap-free-at-the-emitter ordinal assigned
/// under <see cref="AlarmNotifier"/>'s gate at the moment the edge was DECIDED — so a channel can order
/// two jobs for the same key (a Raised and its Cleared) without trusting timestamps, and C-7's rate
/// limiter can tell "the same job seen twice" from "two edges". Resets to 0 on process restart; a channel
/// that needs cross-restart identity should use <see cref="Alarm.Key"/> + <paramref name="AtUtc"/>.</param>
/// <param name="Edge">What changed.</param>
/// <param name="Alarm">The alarm as it stood AT the edge — for <see cref="AlarmEdgeKind.Cleared"/> its
/// <see cref="Alarm.State"/> is <see cref="AlarmState.Cleared"/>, for <see cref="AlarmEdgeKind.Acked"/>
/// it is <see cref="AlarmState.Acked"/>. Never <see langword="null"/>.</param>
/// <param name="AtUtc">When the edge was detected (UTC). Distinct from <see cref="Alarm.LastRaisedUtc"/>,
/// which is when the store last wrote the row.</param>
/// <param name="PreviousPriority">Only non-<see langword="null"/> for
/// <see cref="AlarmEdgeKind.Escalated"/>: the severity the key held before this raise.</param>
/// <param name="Actor">The username that acked/cleared, or <see langword="null"/> for a system-originated
/// edge (a raise, an evaluator clear, a restart restore) — the SAME actor discipline
/// <see cref="AlarmHistoryEntry.Actor"/> already uses.</param>
public sealed record NotificationJob(
    long Sequence,
    AlarmEdgeKind Edge,
    Alarm Alarm,
    DateTimeOffset AtUtc,
    AlarmPriority? PreviousPriority = null,
    string? Actor = null);
