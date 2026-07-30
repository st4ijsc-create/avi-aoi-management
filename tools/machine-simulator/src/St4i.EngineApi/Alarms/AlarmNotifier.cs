using System.Threading.Channels;

namespace St4i.EngineApi.Alarms;

/// <summary>
/// Task C-1 — a point-in-time snapshot of <see cref="AlarmNotifier"/>'s counters. Exists so an operator
/// (via C-7's endpoint) can answer "did the notifier actually do anything, and did it lose anything?"
/// without reading a log file. Every number is cumulative since process start.
/// </summary>
/// <param name="Enqueued">Jobs handed to the bounded channel (i.e. real edges that passed the
/// detector).</param>
/// <param name="Suppressed">Store transitions that were deliberately NOT an edge — overwhelmingly the
/// 5s-tick re-raises this whole class exists to absorb. A large and steadily growing number here is
/// healthy, not a fault.</param>
/// <param name="Dropped">Jobs LOST — see <see cref="AlarmNotifier"/>'s drop-accounting comment for all
/// five loss paths. Any non-zero value means a channel did not hear about something that happened. A
/// non-zero value observed only after shutdown began is expected; one that grows while the process is
/// running means a channel is not keeping up.</param>
/// <param name="Dispatched">Jobs the drain loop successfully handed to the dispatch delegate (or, with no
/// delegate configured, drained and discarded).</param>
/// <param name="DispatchFailures">Jobs whose dispatch delegate threw — INCLUDING a
/// <see cref="TaskCanceledException"/> from a delegate's own timeout (an <see cref="HttpClient"/> request
/// timeout raises one even when the drain token was never signalled). Only a genuine shutdown
/// cancellation is excluded, and that is counted under <paramref name="Dropped"/> instead. The job is not
/// retried — C-3's webhook owns its own retry/backoff policy; the seam does not second-guess it.</param>
/// <param name="Seeded">How many still-active alarms were adopted from a previous process at start (each
/// of which produced one <see cref="AlarmEdgeKind.Restored"/> job).</param>
/// <param name="TrackedKeys">How many alarm keys the edge detector currently believes are active. Should
/// track <c>active_alarms</c>' row count; a persistent divergence is a bug worth knowing about.</param>
public sealed record AlarmNotifierStats(
    long Enqueued,
    long Suppressed,
    long Dropped,
    long Dispatched,
    long DispatchFailures,
    int Seeded,
    int TrackedKeys);

/// <summary>
/// Task C-1 (Đợt C blueprint §5/§6) — the spine of the whole notification batch: an EDGE DETECTOR in front
/// of a bounded, drop-oldest <see cref="Channel{T}"/> drained by a background loop.
///
/// <para>🔴 <b>Why an edge detector at all.</b> <see cref="AlarmEvaluatorService"/> ticks every
/// <see cref="AlarmThresholds.EvalIntervalMs"/> (5s), and the <see cref="AlarmSource.DriverHealth"/> and
/// <see cref="AlarmSource.NgRate"/> sources call <see cref="IAlarmStore.RaiseAsync"/> UNCONDITIONALLY on
/// every one of those ticks for as long as their condition holds (a known, documented, pre-existing shape
/// — see <see cref="AlarmEvaluator"/>). A notification hook wired naively to <c>RaiseAsync</c> therefore
/// fires 720 times an hour for ONE unchanged alarm. This repository has already been bitten by exactly
/// this once: <see cref="AlarmSource.Identity"/> re-raised every tick until it was deduped, and that fix's
/// own comment cites the ~518,000-rows-per-window problem it replaced. Same problem, one layer up, worse
/// blast radius — rows in a local SQLite file are cheap, 720 emails and 720 relay-coil pulses are
/// not.</para>
///
/// <para><b>The mapping, and the argument for each choice.</b> <see cref="AlarmStore"/> reports FACTS
/// (<see cref="AlarmTransitionKind"/>); this class decides which are EDGES:
/// <list type="bullet">
/// <item><description><see cref="AlarmTransitionKind.Raised"/> on a key this detector does not know →
/// <see cref="AlarmEdgeKind.Raised"/>. The primary edge.</description></item>
/// <item><description><see cref="AlarmTransitionKind.ReRaised"/> (or a <see cref="AlarmTransitionKind.Raised"/>
/// for a key already tracked, which is how a lost race between two concurrent first-raises presents) at
/// the SAME-or-lower severity → <b>suppressed</b>. This is the survival condition.</description></item>
/// <item><description>Either raise kind at a STRICTLY HIGHER severity than this key has held since it was
/// last cleared → <see cref="AlarmEdgeKind.Escalated"/>. Argued below.</description></item>
/// <item><description><see cref="AlarmTransitionKind.Cleared"/> for a tracked key →
/// <see cref="AlarmEdgeKind.Cleared"/>; for an untracked key → <b>suppressed</b>. A clear that removed
/// nothing is not news. Note this covers BOTH removal sites: <see cref="IAlarmStore.ClearAsync"/> and the
/// <see cref="Alarm.ClearOnAck"/>-true branch of <see cref="IAlarmStore.AckAsync"/>. The ack-clear branch
/// is NOT optional: an EVENT alarm (every <see cref="AlarmSource.Policy"/> denial) can only ever leave
/// <c>active_alarms</c> that way, so treating it as a non-edge would leave a relay latched on forever
/// after an operator acknowledged the alarm that lit it.</description></item>
/// <item><description><see cref="AlarmTransitionKind.Acked"/> on a key this detector believes is
/// <see cref="AlarmState.Active"/> → <see cref="AlarmEdgeKind.Acked"/>; on a key already believed
/// <see cref="AlarmState.Acked"/> (a repeat ack — <see cref="IAlarmStore.AckAsync"/> happily re-acks) or
/// an untracked key → <b>suppressed</b>. This is ISA-18.2's "silence the horn": the alarm is still on, but
/// a human has taken responsibility for it, and C-5/C-6 need to know that
/// exactly once.</description></item>
/// </list></para>
///
/// <para>🔴 <b>The severity-change decision, argued.</b> Escalation is an edge; de-escalation is not, and
/// the recorded priority is a HIGH-WATER MARK for the key's current raise-run (it is only reset when the
/// key actually clears). Two reasons, and the second is the load-bearing one:
/// <list type="number">
/// <item><description>A key going High → Critical is materially new information. Critical is what feeds
/// <c>LineController</c>'s alarm→hold gate and what C-6's relay will energise on; a notifier that stayed
/// silent through that would leave the relay dark for a condition that now warrants it. Nobody, by
/// contrast, needs to be woken up because a condition got LESS severe — that can wait for the
/// clear.</description></item>
/// <item><description><b>Symmetric (any-change) severity detection would re-create the exact storm this
/// class exists to prevent.</b> A source that flapped between two priorities on the same key would emit
/// an edge on every tick — 720/hour again. Escalation-only against a high-water mark is monotonic within
/// a raise-run, so severity can ratchet up at most three times (Low → Medium → High → Critical) between
/// clears: bounded by construction, not by hoping sources behave.</description></item>
/// </list>
/// Note that the concrete example from the brief — <see cref="AlarmSource.DriverHealth"/> going
/// <c>DEGRADED</c> → <c>DOWN</c> — is NOT this case: those are different <see cref="Alarm.Code"/>s and
/// therefore different <see cref="AlarmRaise.Key"/>s, so the evaluator already raises one key and clears
/// the other, producing a genuine <see cref="AlarmEdgeKind.Raised"/> + <see cref="AlarmEdgeKind.Cleared"/>
/// pair with no help from this rule. As of today NO source in this codebase can change priority on a
/// stable key (Policy's code and priority are 1:1, NgRate and Identity are fixed at High); the rule exists
/// so that the day one can, it escalates safely instead of silently.</para>
///
/// <para>🔴 <b>Restart, argued.</b> See <see cref="SeedFromActive"/>.</para>
///
/// <para><b>Locking.</b> One <see langword="lock"/> (<c>_gate</c>) covers the detector dictionary AND the
/// <c>TryWrite</c> that follows a decision. Holding it across the enqueue is deliberate, not lazy: it is
/// what guarantees that two concurrent writers for the same key cannot interleave their decisions, and
/// that a key's jobs reach the channel in the order they were decided (a <see cref="AlarmEdgeKind.Cleared"/>
/// can never overtake its own <see cref="AlarmEdgeKind.Raised"/>) — which for C-6 is the difference
/// between a coil that ends up de-energised and one that ends up stuck on. Nothing slow ever runs under
/// the gate: no I/O, no await, no user callback (the drop log is deliberately raised AFTER the lock is
/// released). The drain loop never takes the gate at all, so a hung channel cannot block
/// <see cref="Notify"/>.</para>
///
/// <para><b>Drop accounting.</b> A job can be lost in FIVE ways, and the obvious
/// <c>if (!TryWrite(...))</c> check catches only one of them — a prior finding in this repository was
/// exactly a drop counter that did not count every drop path. Under
/// <see cref="BoundedChannelFullMode.DropOldest"/>, <c>TryWrite</c> returns <see langword="true"/> and
/// silently evicts the OLDEST queued item, so the saturation case never trips that check at all. All five
/// increment <see cref="AlarmNotifierStats.Dropped"/>:
/// <list type="number">
/// <item><description>Eviction on a full channel — via <see cref="Channel"/>'s own <c>itemDropped</c>
/// callback.</description></item>
/// <item><description>A refused write (the writer is completed, which only <see cref="DisposeAsync"/>
/// does).</description></item>
/// <item><description>An enqueue arriving after <see cref="DisposeAsync"/>.</description></item>
/// <item><description>A job abandoned mid-dispatch by a shutdown cancellation, and everything still
/// queued when the drain loop ends — a truncated drain must not be invisible.</description></item>
/// <item><description>An edge lost to an internal fault in <see cref="Notify"/>/
/// <see cref="SeedFromActive"/>'s own catch-all.</description></item>
/// </list>
/// Only case 1 means "a channel is not keeping up"; cases 2-4 mean "the process is shutting down". They
/// are logged as different things, because sending an operator after a nonexistent problem during
/// shutdown is its own kind of failure.</para>
///
/// <para><b>Shape.</b> Copied from <see cref="St4i.EdgeCore.Historian.HistorianWriter"/> — bounded
/// capacity 10,000, <see cref="BoundedChannelFullMode.DropOldest"/>, <c>SingleReader</c>, background drain
/// loop that catches everything, and a <see cref="DisposeAsync"/> that DRAINS first and only cancels as a
/// bounded 5s hard-stop. Unlike the historian this loop does not batch: a notification is a discrete event
/// with its own delivery outcome, and C-3..C-6 each decide their own batching/coalescing.</para>
/// </summary>
public sealed class AlarmNotifier : IAlarmNotifier, IAsyncDisposable
{
    /// <summary>Same bound as <see cref="St4i.EdgeCore.Historian.HistorianWriter"/>/
    /// <see cref="St4i.EdgeCore.Uns.UnsPublisher"/>. At one job per real edge (not per tick) this is
    /// several days of a badly behaved fleet, so reaching it means a channel is wedged, not that alarms
    /// are frequent.</summary>
    public const int DefaultCapacity = 10_000;

    /// <summary>What the detector believes about one key RIGHT NOW. <see cref="Priority"/> is a
    /// high-water mark within the key's current raise-run (see the class doc comment's escalation
    /// argument); <see cref="State"/> tracks only the <see cref="AlarmState.Active"/> →
    /// <see cref="AlarmState.Acked"/> step, since a key leaving <see cref="AlarmState.Cleared"/> leaves
    /// the dictionary entirely.</summary>
    private readonly record struct KeyState(AlarmPriority Priority, AlarmState State);

    private readonly Func<NotificationJob, CancellationToken, Task>? _dispatch;
    private readonly Action<string>? _logWarning;
    private readonly Action<Exception, string>? _logError;
    private readonly Channel<NotificationJob> _channel;
    private readonly CancellationTokenSource _cts = new();
    private readonly Task _drainLoop;

    /// <summary>What one <see cref="EmitLocked"/> call actually did — so the caller can log the RIGHT
    /// thing after releasing the gate. A drop during shutdown and a drop from saturation are different
    /// operational events: telling an operator "a channel is not keeping up" while the process is simply
    /// exiting sends them after a problem that does not exist (the same distinction
    /// <see cref="St4i.EdgeCore.Historian.HistorianWriter.Enqueue"/> already draws).</summary>
    private enum EmitOutcome
    {
        Enqueued,
        EnqueuedAfterEviction,
        DroppedShuttingDown,
    }

    private readonly object _gate = new();
    private readonly Dictionary<string, KeyState> _tracked = new(StringComparer.Ordinal);
    private bool _seeded;
    private int _seededCount;
    private long _sequence;
    private long _enqueued;
    private long _suppressed;

    // Written from BOTH the enqueue path (under _gate) and the drain loop (a cancelled drain abandons
    // jobs, and those must be counted too — see RunDrainLoopAsync), so this one is Interlocked-managed
    // throughout rather than gate-guarded like its neighbours above.
    private long _dropped;

    private long _dispatched;
    private long _dispatchFailures;

    /// <summary>0 = live, 1 = disposed. An <see cref="int"/> rather than a <see langword="bool"/> so
    /// <see cref="DisposeAsync"/>'s "have I already run?" check-and-set is a single
    /// <see cref="Interlocked.Exchange(ref int, int)"/> — the doc there sells idempotency as a safety
    /// property (the container tracks this instance twice), and a non-atomic check-then-set would only be
    /// idempotent by luck.</summary>
    private int _disposed;

    private bool IsDisposed => Volatile.Read(ref _disposed) != 0;

    /// <param name="dispatch">Where a drained job goes. <see langword="null"/> (the default) means the
    /// loop drains and discards — which is precisely the C-1 state of the world: the seam is real and
    /// provably working, and NO channel exists yet. C-3..C-6 supply this (C-7 fans out to several). A
    /// plain delegate rather than an interface deliberately: inventing the channel abstraction is C-3's
    /// decision to make, not this task's, and <see cref="St4i.EdgeCore.Historian.HistorianWriter"/>
    /// already establishes plain delegates as this codebase's shape for an optional hook. It may throw —
    /// the loop catches, counts and carries on.</param>
    /// <param name="logWarning">Where a dropped job is reported. Invoked OUTSIDE the gate.</param>
    /// <param name="logError">Where a dispatch failure (or a defensive internal fault) is reported.</param>
    /// <param name="capacity">Bounded-channel capacity; see <see cref="DefaultCapacity"/>.</param>
    public AlarmNotifier(
        Func<NotificationJob, CancellationToken, Task>? dispatch = null,
        Action<string>? logWarning = null,
        Action<Exception, string>? logError = null,
        int capacity = DefaultCapacity)
    {
        _dispatch = dispatch;
        _logWarning = logWarning;
        _logError = logError;

        _channel = Channel.CreateBounded<NotificationJob>(
            new BoundedChannelOptions(Math.Max(1, capacity))
            {
                FullMode = BoundedChannelFullMode.DropOldest,
                SingleReader = true,
            },
            // Drop path (1) of 3 — see the class doc comment's drop-accounting paragraph. This fires
            // SYNCHRONOUSLY from inside TryWrite (i.e. already under _gate), so a plain increment is
            // correct here and no logging is done from it: Notify/SeedFromActive notice the counter moved
            // and log after releasing the gate.
            itemDropped: _ => Interlocked.Increment(ref _dropped));

        _drainLoop = Task.Run(() => RunDrainLoopAsync(_cts.Token));
    }

    /// <summary>Cumulative counters — see <see cref="AlarmNotifierStats"/>. Cheap; takes the gate only
    /// long enough to copy six numbers.</summary>
    public AlarmNotifierStats Stats
    {
        get
        {
            lock (_gate)
            {
                return new AlarmNotifierStats(
                    _enqueued, _suppressed, Interlocked.Read(ref _dropped),
                    Interlocked.Read(ref _dispatched), Interlocked.Read(ref _dispatchFailures),
                    _seededCount, _tracked.Count);
            }
        }
    }

    // ─────────────────────────────────────────────────────────────────────
    // Notify — the edge detector. Synchronous, non-blocking, never throws.
    // ─────────────────────────────────────────────────────────────────────

    /// <inheritdoc/>
    public void Notify(AlarmTransition transition, string? actor = null)
    {
        try
        {
            if (transition.Kind == AlarmTransitionKind.None || transition.Alarm is not { } alarm) return;

            var outcome = EmitOutcome.Enqueued;
            lock (_gate)
            {
                switch (transition.Kind)
                {
                    case AlarmTransitionKind.Raised:
                    case AlarmTransitionKind.ReRaised:
                        // Both kinds go through the SAME path on purpose. The store's Raised/ReRaised
                        // report is authoritative about the DB, but this dictionary is authoritative
                        // about what has been NOTIFIED — and only the latter is right after a process
                        // restart (see SeedFromActive) or when two concurrent raises of one key both
                        // observed the row as absent. Trusting the store's label alone would emit two
                        // "Raised" edges for that race; trusting the dictionary emits exactly one.
                        outcome = OnRaiseLocked(alarm);
                        break;

                    case AlarmTransitionKind.Cleared:
                        if (_tracked.Remove(alarm.Key)) outcome = EmitLocked(AlarmEdgeKind.Cleared, alarm, null, actor);
                        else _suppressed++;
                        break;

                    case AlarmTransitionKind.Acked:
                        if (_tracked.TryGetValue(alarm.Key, out var acking) && acking.State == AlarmState.Active)
                        {
                            _tracked[alarm.Key] = acking with { State = AlarmState.Acked };
                            outcome = EmitLocked(AlarmEdgeKind.Acked, alarm, null, actor);
                        }
                        else
                        {
                            // Already acked (AckAsync will happily re-ack), or never tracked. Not news.
                            _suppressed++;
                        }
                        break;
                }
            }

            LogOutcome(outcome, alarm.Key);
        }
        catch (Exception ex)
        {
            // IAlarmNotifier.Notify is contractually never-throws (AlarmStore.RaiseAsync/ClearAsync are
            // never-throws and call straight into it). Nothing above should be able to throw, but this
            // guard is what makes that a guarantee rather than a code review.
            //
            // Counted, not just logged: reaching here means an edge really was lost, and
            // AlarmNotifierStats.Dropped is documented as "jobs LOST … any non-zero value means a channel
            // did not hear about something that happened". Leaving it at 0 while logging a lost edge would
            // make the counter say the opposite of the log. (A fault AFTER EmitLocked already counted a
            // drop would double-count — over-reporting a loss is strictly safer than under-reporting one.)
            Interlocked.Increment(ref _dropped);
            ReportError(ex, "Alarm notifier: the edge detector faulted — this edge was lost, the alarm itself is unaffected.");
        }
    }

    /// <summary>Called AFTER the gate is released — a caller-supplied logging delegate must never run
    /// under it.</summary>
    private void LogOutcome(EmitOutcome outcome, string key)
    {
        switch (outcome)
        {
            case EmitOutcome.EnqueuedAfterEviction:
                _logWarning?.Invoke(
                    "Alarm notification queue saturated — dropped the oldest queued notification(s) to make room " +
                    $"for '{key}'. A notification channel is not keeping up; see the notifier's Dropped counter.");
                break;

            case EmitOutcome.DroppedShuttingDown:
                _logWarning?.Invoke(
                    $"Alarm notifier is shutting down — dropped the notification for '{key}'. This is expected " +
                    "during shutdown and does NOT mean a channel is falling behind.");
                break;
        }
    }

    /// <summary>Caller holds <c>_gate</c>. See the class doc comment for the escalation argument.
    ///
    /// <para>This method assumes transitions are delivered in the order their database writes committed —
    /// which <see cref="AlarmStore"/> guarantees by holding its own write gate across write-then-notify
    /// (see <c>AlarmStore._writeGate</c>). Without that guarantee a raise whose row a concurrent ack had
    /// already deleted would arrive here as an untracked key and be emitted as a fresh
    /// <see cref="AlarmEdgeKind.Raised"/> for a row that no longer exists — which for a
    /// <see cref="AlarmSource.Policy"/> key never heals, because nothing periodically re-raises those.
    /// The ordering is enforced at the source rather than reconstructed here on purpose; see
    /// <c>AlarmStore</c>'s own comment for why <see cref="Alarm.Id"/>+<see cref="Alarm.Count"/> cannot
    /// reconstruct it.</para></summary>
    private EmitOutcome OnRaiseLocked(Alarm alarm)
    {
        if (!_tracked.TryGetValue(alarm.Key, out var state))
        {
            _tracked[alarm.Key] = new KeyState(alarm.Priority, alarm.State);
            return EmitLocked(AlarmEdgeKind.Raised, alarm, previousPriority: null, actor: null);
        }

        if (IsMoreSevere(alarm.Priority, state.Priority))
        {
            // High-water mark: only ever ratchets UP, and is discarded wholesale when the key clears.
            _tracked[alarm.Key] = state with { Priority = alarm.Priority };
            return EmitLocked(AlarmEdgeKind.Escalated, alarm, previousPriority: state.Priority, actor: null);
        }

        // 🔴 THE line this whole task exists for: a restatement of an alarm that is already known is not
        // news, no matter how many times the 5s evaluator restates it.
        _suppressed++;
        return EmitOutcome.Enqueued;
    }

    /// <summary><see cref="AlarmPriority"/> is declared MOST-SEVERE-FIRST (Critical = 0 … Low = 3), the
    /// same ordering <see cref="AlarmStore.ListActiveAsync"/> sorts by — so "more severe" is a SMALLER
    /// underlying value, not a larger one.</summary>
    private static bool IsMoreSevere(AlarmPriority candidate, AlarmPriority current) => candidate < current;

    /// <summary>Caller holds <c>_gate</c>. Assigns the sequence number and enqueues; every failure path
    /// increments <c>_dropped</c>. Returns what happened so the caller can log it once the gate is
    /// released.</summary>
    private EmitOutcome EmitLocked(AlarmEdgeKind edge, Alarm alarm, AlarmPriority? previousPriority, string? actor)
    {
        if (IsDisposed)
        {
            // Drop path (3) of 3 — an edge arriving after shutdown began. Counted, not silent.
            Interlocked.Increment(ref _dropped);
            return EmitOutcome.DroppedShuttingDown;
        }

        var job = new NotificationJob(++_sequence, edge, alarm, DateTimeOffset.UtcNow, previousPriority, actor);

        var droppedBefore = Interlocked.Read(ref _dropped);
        if (!_channel.Writer.TryWrite(job))
        {
            // Drop path (2) of 3 — the writer is completed, which only DisposeAsync ever does. Same
            // operational meaning as the check above, so it reports the same way.
            Interlocked.Increment(ref _dropped);
            return EmitOutcome.DroppedShuttingDown;
        }

        _enqueued++;

        // TryWrite may ALSO have evicted an older job (drop path 1, counted by the itemDropped callback,
        // which fires synchronously from inside the TryWrite above) while still returning true — the two
        // are independent, so Enqueued and Dropped can both move on one call. That is the honest
        // accounting: one job went in, a different one fell out.
        return Interlocked.Read(ref _dropped) != droppedBefore
            ? EmitOutcome.EnqueuedAfterEviction
            : EmitOutcome.Enqueued;
    }

    // ─────────────────────────────────────────────────────────────────────
    // SeedFromActive — the restart decision.
    // ─────────────────────────────────────────────────────────────────────

    /// <summary>
    /// 🔴 <b>The restart decision, argued.</b> Edge detection needs to remember what has already been
    /// notified; that memory is in-process and dies with the process. On restart, <c>active_alarms</c> can
    /// hold rows that were notified an hour ago, and no <see cref="AlarmEdgeKind.Raised"/> edge for them
    /// will EVER arrive in this process (the sources re-raise, and every one of those re-raises is
    /// correctly suppressed).
    ///
    /// <para>Both naive answers are wrong. Re-notifying everything as a fresh
    /// <see cref="AlarmEdgeKind.Raised"/> spams every recipient on every restart and — once C-6 lands —
    /// pulses a relay coil, which is the failure mode that makes a crash-looping process actively
    /// dangerous. Notifying nothing silently swallows the alarm a real outage caused, at exactly the
    /// moment somebody needs to know, AND leaves a stateful channel (annunciator, relay) unable to ever
    /// reach the right state: it would sit dark through a standing Critical alarm until that alarm
    /// cleared.</para>
    ///
    /// <para><b>Chosen: adopt-and-announce.</b> Every still-active alarm is adopted into the detector (so
    /// it will never produce a spurious <see cref="AlarmEdgeKind.Raised"/>, and its eventual clear/ack
    /// WILL produce a correct edge) and emits exactly one job under a DISTINCT kind,
    /// <see cref="AlarmEdgeKind.Restored"/>. That is neither naive answer: a webhook or SMTP channel can
    /// ignore <see cref="AlarmEdgeKind.Restored"/> outright and never spam anyone, while a relay or local
    /// annunciator can use it to re-establish its own state — and neither has to guess. The cost is
    /// bounded by the number of standing alarms, once per process start, never per tick.</para>
    ///
    /// <para><b>How an operator finds out what the system did:</b> the count is logged at start by
    /// <see cref="AlarmNotifierSeedService"/> and is permanently visible as
    /// <see cref="AlarmNotifierStats.Seeded"/> on <see cref="Stats"/> — so "did this process replay 40
    /// alarms at 03:12?" is answerable after the fact, not just at the moment it happened.</para>
    ///
    /// <para>Idempotent: only the FIRST call seeds. Order-safe: an alarm already tracked (because a live
    /// edge beat the seed) is skipped rather than double-emitted.</para>
    /// </summary>
    public void SeedFromActive(IReadOnlyList<Alarm> active)
    {
        try
        {
            if (active is null) return;

            var worstOutcome = EmitOutcome.Enqueued;
            lock (_gate)
            {
                if (_seeded) return;
                _seeded = true;

                foreach (var alarm in active)
                {
                    if (alarm is null || _tracked.ContainsKey(alarm.Key)) continue;
                    _tracked[alarm.Key] = new KeyState(alarm.Priority, alarm.State);
                    _seededCount++;
                    var outcome = EmitLocked(AlarmEdgeKind.Restored, alarm, previousPriority: null, actor: null);
                    if (outcome > worstOutcome) worstOutcome = outcome;
                }
            }

            LogOutcome(worstOutcome, "<restored alarms>");
        }
        catch (Exception ex)
        {
            // Counted for the same reason Notify's catch-all is — see there.
            Interlocked.Increment(ref _dropped);
            ReportError(ex, "Alarm notifier: restoring alarms from a previous process faulted — the seam is running WITHOUT that history.");
        }
    }

    // ─────────────────────────────────────────────────────────────────────
    // Drain loop
    // ─────────────────────────────────────────────────────────────────────

    private async Task RunDrainLoopAsync(CancellationToken ct)
    {
        var reader = _channel.Reader;

        try
        {
            while (await reader.WaitToReadAsync(ct).ConfigureAwait(false))
            {
                while (reader.TryRead(out var job))
                {
                    try
                    {
                        if (_dispatch is not null) await _dispatch(job, ct).ConfigureAwait(false);
                        Interlocked.Increment(ref _dispatched);
                    }
                    catch (OperationCanceledException) when (ct.IsCancellationRequested)
                    {
                        // 🔴 The `when` filter is load-bearing, not decoration — same idiom as
                        // AlarmEvaluatorService's own loop. TaskCanceledException DERIVES from
                        // OperationCanceledException, and that is precisely what HttpClient throws on its
                        // OWN request timeout even when `ct` was never signalled — so C-3's webhook and
                        // C-4's SMTP will both produce one routinely. Caught unguarded, such a job would
                        // skip the _dispatched increment above AND the _dispatchFailures increment below
                        // and vanish from every counter, while AlarmNotifierStats.DispatchFailures claims
                        // to count "jobs whose dispatch delegate threw". With the filter, only a genuine
                        // shutdown lands here; anything else falls through to the counted handler.
                        //
                        // Even a genuine shutdown loses this job, so count it: a truncated drain must not
                        // be invisible.
                        Interlocked.Increment(ref _dropped);
                    }
                    catch (Exception ex)
                    {
                        Interlocked.Increment(ref _dispatchFailures);
                        ReportError(ex, $"Alarm notification dispatch failed for {job.Edge} '{job.Alarm.Key}' — not retried.");
                    }
                }
            }
        }
        catch (OperationCanceledException) when (ct.IsCancellationRequested)
        {
            // Expected on shutdown: DisposeAsync cancels the token while WaitToReadAsync may be pending.
        }
        catch (Exception ex)
        {
            // Defensive, and one step beyond HistorianWriter's own loop: if the loop dies, every later
            // notification is silently lost with nothing to show for it, so say so loudly. (The inner
            // try/catch above already absorbs everything a dispatch delegate can do; reaching here means
            // the channel plumbing itself faulted.) An OperationCanceledException that is NOT a shutdown
            // lands here too, rather than being swallowed by the filter above.
            ReportError(ex, "Alarm notification drain loop stopped unexpectedly — notifications will no longer be delivered in this process.");
        }
        finally
        {
            // Whatever is still queued when this loop ends is never going to be delivered — on a cancelled
            // (hard-stop) shutdown, or after a fault. Count it: a truncated drain that leaves Dropped at 0
            // would tell an operator nothing was lost when something was. On a CLEAN shutdown the loop only
            // exits once the channel is empty, so this sweep finds nothing and changes no counter.
            while (reader.TryRead(out _)) Interlocked.Increment(ref _dropped);
        }
    }

    /// <summary>Reporting a failure must never itself become a failure — <c>logError</c> is caller-supplied
    /// and reached from inside never-throws paths.</summary>
    private void ReportError(Exception ex, string message)
    {
        try
        {
            _logError?.Invoke(ex, message);
        }
        catch
        {
            // Nothing left to report it to.
        }
    }

    // ─────────────────────────────────────────────────────────────────────
    // Shutdown
    // ─────────────────────────────────────────────────────────────────────

    /// <summary>Completes the writer and awaits the drain loop DRAINING — deliberately does NOT cancel
    /// first, for exactly the reason <see cref="St4i.EdgeCore.Historian.HistorianWriter.DisposeAsync"/>
    /// spells out: <c>WaitToReadAsync(ct)</c> prioritises an already-cancelled token over buffered items,
    /// so cancelling up front would abandon queued notifications with no log. Cancellation is only a
    /// bounded (5s) hard-stop for a dispatch delegate that hangs. Never throws, never hangs past that
    /// bound, and is IDEMPOTENT — the DI container tracks this instance under both its concrete type and
    /// <see cref="IAlarmNotifier"/> (the same forwarding-registration shape
    /// <see cref="St4i.EdgeCore.Uns.UnsPublisher"/> already uses), so it can be disposed twice.</summary>
    public async ValueTask DisposeAsync()
    {
        // Atomic check-and-set, not check-then-set: two containers/threads disposing concurrently must not
        // both proceed, or the second could TryComplete/Dispose the CTS while the first is still awaiting
        // the loop. Idempotency here is a safety property, so it must not be idempotent only by luck.
        if (Interlocked.Exchange(ref _disposed, 1) != 0) return;

        _channel.Writer.TryComplete();

        try
        {
            await _drainLoop.WaitAsync(TimeSpan.FromSeconds(5)).ConfigureAwait(false);
        }
        catch (TimeoutException)
        {
            _cts.Cancel();
            try
            {
                await _drainLoop.ConfigureAwait(false);
            }
            catch
            {
                // Best-effort shutdown — the drain loop already reports its own failures via logError.
            }
        }
        catch
        {
            // The loop faulted; it has already reported itself. Shutdown must not surface that.
        }

        _cts.Dispose();
    }
}
