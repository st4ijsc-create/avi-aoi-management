namespace St4i.EngineApi.Alarms;

/// <summary>Filter/paging input for <see cref="IAlarmStore.QueryHistoryAsync"/> — every field optional
/// except <see cref="Limit"/>/<see cref="Offset"/> (the caller, i.e. <c>AlarmEndpoints</c>, is expected to
/// clamp those the same way <c>AuditEndpoints.GetAuditAsync</c> clamps its own limit/offset before ever
/// reaching the store).</summary>
public sealed record AlarmHistoryFilter(
    AlarmSource? Source,
    AlarmPriority? Priority,
    DateTimeOffset? From,
    DateTimeOffset? To,
    int Limit,
    int Offset);

/// <summary>One append-only row of the <c>alarm_history</c> event log — never mutated once written (unlike
/// <c>active_alarms</c>, which IS mutated/deleted). <see cref="Event"/> is one of <c>"raised"</c>/
/// <c>"cleared"</c>/<c>"acked"</c>. <see cref="Actor"/> is the username that acked/cleared the alarm, or
/// <see langword="null"/> for a "raised" event (nobody "raises" an alarm — it's a system observation) or a
/// system-triggered clear (LC-2's evaluator, not an operator).</summary>
public sealed record AlarmHistoryEntry(
    long Seq,
    DateTimeOffset AtUtc,
    string Key,
    string Event,
    AlarmSource Source,
    string Code,
    AlarmPriority Priority,
    string Message,
    string? Actor);

/// <summary>A page of <see cref="AlarmHistoryEntry"/> rows — same shape/paging discipline as
/// <c>AuditPage</c>: <see cref="Total"/> is the FULL filtered count (ignoring <see cref="Limit"/>/
/// <see cref="Offset"/>), so a caller can page through the whole filtered set.</summary>
public sealed record AlarmHistoryPage(IReadOnlyList<AlarmHistoryEntry> Items, int Total, int Limit, int Offset);

/// <summary>
/// GĐ3 sub-4 LC-1 — the alarm backbone: a durable ISA-18.2 alarm model (raise/clear/ack/list/history) that
/// every future alarm SOURCE (today: <c>PolicyResults.DenyAsync</c>; LC-2: a periodic driver-health/NG-rate
/// evaluator) raises/clears through, and <c>AlarmEndpoints</c> reads/acks through.
///
/// <see cref="RaiseAsync"/> and <see cref="ClearAsync"/> MUST NEVER throw into their caller — the SAME
/// contract as <see cref="St4i.EngineApi.AssetRegistry.IAssetRegistry.UpsertAsync"/>: a Policy DENY handler
/// must not fail an HTTP response just because <c>alarms.db</c> hiccuped, and a future LC-2 background
/// evaluator loop must not crash just because a clear couldn't be persisted this tick. <see cref="AckAsync"/>/
/// <see cref="ListActiveAsync"/>/<see cref="QueryHistoryAsync"/> are direct, caller-invoked reads/writes
/// reachable only from <c>AlarmEndpoints</c> — a genuine failure there is allowed to surface as an ordinary
/// exception (→ the framework's default 500), same as <c>AssetRegistryStore</c>'s own
/// Get/List/SetLifecycle members.
/// </summary>
public interface IAlarmStore
{
    /// <summary>Upserts an active alarm keyed by <see cref="AlarmRaise.Key"/> (dedup) and appends a
    /// "raised" row to <c>alarm_history</c>. A same-key re-raise increments <see cref="Alarm.Count"/> and
    /// bumps <see cref="Alarm.LastRaisedUtc"/> while PRESERVING <see cref="Alarm.FirstRaisedUtc"/> and any
    /// existing ack state — see <see cref="Alarm"/>'s doc comment. NEVER throws.
    ///
    /// <para>Task C-1 — returns WHAT IT DID: <see cref="AlarmTransitionKind.Raised"/> if this call created
    /// the row, <see cref="AlarmTransitionKind.ReRaised"/> if it merely restated an already-active alarm,
    /// or <see cref="AlarmTransitionKind.None"/> if the write failed and was swallowed. The
    /// <see cref="AlarmSource.DriverHealth"/>/<see cref="AlarmSource.NgRate"/> sources call this
    /// unconditionally on every 5s evaluator tick for as long as their condition holds, so "was called" and
    /// "changed something" are wildly different questions and only the store can answer the second one
    /// without a second query that would race. Existing callers may ignore the value — <c>await</c>-ing it
    /// as a statement is legal and every pre-existing call site does exactly that.</para></summary>
    Task<AlarmTransition> RaiseAsync(AlarmRaise raise, CancellationToken ct = default);

    /// <summary>Removes the alarm identified by <paramref name="key"/> from the live (<c>active_alarms</c>)
    /// set — regardless of whether it was <see cref="AlarmState.Active"/> or <see cref="AlarmState.Acked"/>
    /// — and appends a "cleared" row to <c>alarm_history</c>. A no-op (not an error) if no active alarm
    /// currently carries that key. This is LC-2's evaluator's call: a CONDITION alarm (<see cref="Alarm.ClearOnAck"/>
    /// == <see langword="false"/>) is only ever removed once the underlying condition itself ends, never by
    /// an operator's Ack alone. NEVER throws.
    ///
    /// <para>Task C-1 — returns <see cref="AlarmTransitionKind.Cleared"/> (carrying the alarm as it stood
    /// at removal, with <see cref="Alarm.State"/> == <see cref="AlarmState.Cleared"/>) when a row was
    /// actually removed, and <see cref="AlarmTransitionKind.None"/> when the call was a no-op or the write
    /// failed. The evaluator calls this on EVERY tick for every healthy slot, so the vast majority of calls
    /// are no-ops and must be distinguishable from a genuine clear.</para></summary>
    Task<AlarmTransition> ClearAsync(string key, CancellationToken ct = default);

    /// <summary>Acknowledges the active alarm identified by its <see cref="Alarm.Id"/>. If
    /// <see cref="Alarm.ClearOnAck"/> is <see langword="true"/> (an EVENT alarm), this BOTH acks and clears
    /// it in one step (removed from <c>active_alarms</c>, a single "cleared" history row — no separate
    /// "acked" row) — the Ack itself IS the resolution. Otherwise (a CONDITION alarm), the row stays in
    /// <c>active_alarms</c> with <see cref="Alarm.State"/> set to <see cref="AlarmState.Acked"/> and an
    /// "acked" history row is appended. Returns the alarm as it now stands (its <see cref="Alarm.State"/>
    /// reflecting whichever of the two outcomes above applied), or <see langword="null"/> if no active alarm
    /// has that id (unknown, or already cleared).
    ///
    /// <para>Task C-1 — unlike <see cref="RaiseAsync"/>/<see cref="ClearAsync"/> this signature is
    /// UNCHANGED: it already returns the resulting alarm, and it is not a never-throws member (it is an
    /// ordinary request-path call reachable only from <c>AlarmEndpoints</c>, allowed to surface a failure
    /// as a 500). Both of its branches still reach the notification seam internally — the ClearOnAck=true
    /// branch as a <see cref="AlarmTransitionKind.Cleared"/>, the ClearOnAck=false branch as a
    /// <see cref="AlarmTransitionKind.Acked"/> — but that hook is not permitted to add a new way for this
    /// method to throw.</para></summary>
    Task<Alarm?> AckAsync(long id, string by, CancellationToken ct = default);

    /// <summary>Every alarm currently in <c>active_alarms</c> (i.e. every alarm whose <see cref="Alarm.State"/>
    /// is <see cref="AlarmState.Active"/> or <see cref="AlarmState.Acked"/> — a <see cref="AlarmState.Cleared"/>
    /// alarm has already been deleted from this set), ordered by <see cref="Alarm.Priority"/> severity
    /// DESCENDING (Critical first) then <see cref="Alarm.LastRaisedUtc"/> DESCENDING (most recently raised/
    /// re-raised first within the same priority).</summary>
    Task<IReadOnlyList<Alarm>> ListActiveAsync(CancellationToken ct = default);

    /// <summary>Filtered/paged read of the append-only <c>alarm_history</c> log, newest-first (same
    /// ordering discipline as <c>SqliteAuditStore.QueryAsync</c>).</summary>
    Task<AlarmHistoryPage> QueryHistoryAsync(AlarmHistoryFilter filter, CancellationToken ct = default);
}
