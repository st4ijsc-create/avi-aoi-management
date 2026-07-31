using System.Threading.Channels;

namespace St4i.EngineApi.Alarms;

/// <summary>
/// Task C-1 — a point-in-time snapshot of <see cref="AlarmNotifier"/>'s counters. Exists so an operator
/// (via C-7's endpoint) can answer "did the notifier actually do anything, and did it lose anything?"
/// without reading a log file. Every number is cumulative since process start.
/// </summary>
/// <param name="Enqueued">EDGES that passed the detector and were accepted by at least one channel's
/// queue. 🔴 Task C-6 kept this on the EDGE, not on the (edge, channel) pair, and the asymmetry with the
/// three counters below is deliberate: this one is a property of the DETECTOR — "how many real edges did
/// this process produce?" — which is exactly what C-1 meant by it and what the storm tests read it for, and
/// it must not change meaning when a channel is added or removed. The three delivery counters below are
/// properties of DELIVERY, which is per channel, so summing them is the only thing that adds up. See
/// <see cref="AlarmNotifier.ChannelStats"/> for the per-channel breakdown.</param>
/// <param name="Suppressed">Store transitions that were deliberately NOT an edge — overwhelmingly the
/// 5s-tick re-raises this whole class exists to absorb. A large and steadily growing number here is
/// healthy, not a fault.</param>
/// <param name="Dropped">(job, channel) pairs LOST — see <see cref="AlarmNotifier"/>'s drop-accounting
/// comment for all five loss paths. (Path 5, an internal fault in the detector, is the one exception to
/// the pair unit: the edge is lost BEFORE it reaches any queue, so it counts once regardless of how many
/// channels are wired.) Any non-zero value means a channel did not hear about something that happened. A
/// non-zero value observed only after shutdown began is expected; one that grows while the process is
/// running means a channel is not keeping up — and <see cref="AlarmNotifier.ChannelStats"/> says
/// which.</param>
/// <param name="Dispatched">(job, channel) pairs a drain loop successfully handed to a channel's dispatch
/// delegate (or, with no channel wired, drained and discarded).</param>
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
/// 🔴 Task C-6 — one channel's own share of <see cref="AlarmNotifierStats"/>, which is the whole point of
/// giving each channel its own queue: the aggregate can only say "something is falling behind", and the
/// operational question is always WHICH.
/// </summary>
/// <param name="Channel">The channel's name, as supplied to
/// <see cref="AlarmNotificationChannel"/>.</param>
/// <param name="Enqueued">Jobs written to THIS channel's queue.</param>
/// <param name="Dropped">Jobs lost on THIS channel — evicted from a full queue, refused after shutdown, or
/// abandoned by a cancelled drain. A number that grows here while its neighbours stay flat is the exact
/// signal C-1's single shared queue could not produce.</param>
/// <param name="Dispatched">Jobs THIS channel's dispatch delegate accepted without throwing.</param>
/// <param name="DispatchFailures">Jobs THIS channel's dispatch delegate threw on. Never retried.</param>
/// <param name="Queued">How deep this channel's queue is RIGHT NOW — a gauge, not a cumulative counter. A
/// persistently non-zero depth is a channel that is slower than the edge rate.</param>
public sealed record AlarmNotifierChannelStats(
    string Channel,
    long Enqueued,
    long Dropped,
    long Dispatched,
    long DispatchFailures,
    int Queued);

/// <summary>
/// 🔴 Task C-6 — one wired notification channel: a NAME (for the operator-visible accounting and for the
/// log line that says which queue saturated) and the delegate C-1's drain loop calls.
///
/// <para>C-1 shipped ONE <c>dispatch</c> delegate; C-3's review established, and C-4 confirmed, that a
/// single-reader loop in front of it lets one dead network receiver delay every other channel.
/// <c>Task.WhenAll</c> in <c>Program.cs</c> bounded that at <c>max(budget)</c> rather than <c>sum</c>, which
/// was enough while every channel was a network client — but C-6 drives HARDWARE, and the worst case is a
/// restart, which is exactly when a beacon matters most: standing alarms replay at boot, and a plant
/// restarting into a dead webhook would hold the beacon dark behind them for as long as that webhook's
/// budget, per replayed alarm. Giving each channel its own bounded queue and its own single-reader loop is
/// the only shape in which a dead network receiver <b>structurally cannot</b> delay a hardware output —
/// there is no shared resource left for it to hold.</para>
///
/// <para>Per-key ordering is preserved PER CHANNEL: <see cref="AlarmNotifier"/> decides an edge and writes
/// it to every channel's queue under one lock, so a key's <see cref="AlarmEdgeKind.Cleared"/> can never
/// overtake its own <see cref="AlarmEdgeKind.Raised"/> in ANY channel's queue. What is deliberately NOT
/// preserved is ordering BETWEEN channels — channel A may be three jobs ahead of channel B — which is the
/// entire benefit and is why it is stated rather than left to be discovered.</para>
/// </summary>
/// <param name="Name">Short, stable, operator-visible. Appears in the saturation warning and in
/// <see cref="AlarmNotifierChannelStats.Channel"/>.</param>
/// <param name="Dispatch">Runs on THIS channel's own drain thread, which holds no lock — so it MAY block
/// and it MAY call back into <see cref="IAlarmStore"/> without deadlocking. Blocking now costs only this
/// channel's own throughput, which is the property C-6 exists to buy.</param>
public sealed record AlarmNotificationChannel(
    string Name,
    Func<NotificationJob, CancellationToken, Task> Dispatch);

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
///
/// <para>🔴 <b>Task C-6 — ONE QUEUE PER CHANNEL, and this is the prerequisite that made C-6 possible at
/// all.</b> C-1 shipped exactly one queue and one drain loop, so every channel's dispatch ran on the same
/// thread and a slow one delayed the rest. <c>Program.cs</c> composed the channels with
/// <c>Task.WhenAll</c>, which bounded ONE notification's cost at <c>max(budget)</c> instead of
/// <c>sum(budget)</c> — but it could not bound the NEXT notification: the loop does not read job N+1 until
/// job N's <c>WhenAll</c> has completed, so a webhook wedged for its whole 10s budget still held every other
/// channel for 10s per edge. With a physical annunciator behind one of those channels that is a beacon held
/// dark for 10s per standing alarm at boot, which is precisely when it matters most.
///
/// <para>Now: <see cref="AlarmNotificationChannel"/> is a LIST, each entry gets its own
/// <see cref="Channel{T}"/> and its own single-reader loop, and the detector writes one decided edge into
/// all of them under the same lock. A dead channel can therefore fill and evict from its OWN queue and
/// starve its OWN drain thread, and nothing it does is observable to any other channel — the delay is
/// structurally impossible rather than merely bounded. Cost: N bounded queues and N idle loops (N is 4
/// today), and per-channel drop accounting, which is strictly more informative than the aggregate it
/// replaces (see <see cref="AlarmNotifierChannelStats"/>).</para>
///
/// <para>The single-channel constructor is kept and is byte-identical in behaviour to C-1's: one channel
/// means one queue and one loop, which is what it always was.</para></para>
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

    private readonly Action<string>? _logWarning;
    private readonly Action<Exception, string>? _logError;
    private readonly Lane[] _lanes;
    private readonly CancellationTokenSource _cts = new();

    /// <summary>🔴 Task C-6 — one channel's queue, drain loop and counters. Everything that used to be a
    /// field of the notifier and is now per-channel lives here; everything that is genuinely about the EDGE
    /// rather than about a channel (the detector dictionary, <c>_sequence</c>, <c>_suppressed</c>) stayed on
    /// the notifier, because an edge is decided once however many channels consume it.</summary>
    private sealed class Lane
    {
        public string Name { get; }
        public Func<NotificationJob, CancellationToken, Task>? Dispatch { get; }
        public Channel<NotificationJob> Queue { get; }
        public Task DrainLoop { get; set; } = Task.CompletedTask;

        /// <summary>Guarded by the notifier's <c>_gate</c> — written only from <c>EmitLocked</c>.</summary>
        public long Enqueued;

        /// <summary>Channel-full EVICTIONS on this lane only — the subset of <see cref="Dropped"/> that
        /// means "THIS channel is not keeping up" rather than "the process is shutting down". Guarded by
        /// <c>_gate</c>, not <see cref="Interlocked"/>, and that is the point: it is incremented ONLY from
        /// the <c>itemDropped</c> callback, which fires synchronously from inside <c>TryWrite</c>, which
        /// only ever runs under the gate. <c>EmitLocked</c> brackets its <c>TryWrite</c> with two reads of
        /// THIS field to decide whether it evicted anything — bracketing <see cref="Dropped"/> instead would
        /// false-positive the moment this lane's own drain loop incremented it between the two reads, and
        /// would then log "queue saturated / a channel is not keeping up" when nothing was evicted at
        /// all.</summary>
        public long Evicted;

        // Written from BOTH the enqueue path (under _gate) and this lane's drain loop (a cancelled drain
        // abandons jobs, and those must be counted too), so these are Interlocked-managed throughout.
        public long Dropped;
        public long Dispatched;
        public long DispatchFailures;

        public Lane(string name, Func<NotificationJob, CancellationToken, Task>? dispatch, int capacity)
        {
            Name = name;
            Dispatch = dispatch;
            Queue = Channel.CreateBounded<NotificationJob>(
                new BoundedChannelOptions(capacity)
                {
                    FullMode = BoundedChannelFullMode.DropOldest,
                    SingleReader = true,
                },
                // Drop path (1) of 5 — see the class doc comment's drop-accounting paragraph. This fires
                // SYNCHRONOUSLY from inside TryWrite (i.e. already under _gate), so the plain `Evicted++` is
                // correct, and no logging is done from here: EmitLocked notices Evicted moved and its caller
                // logs after releasing the gate. Evicted is what distinguishes THIS path (this channel is
                // not keeping up) from the shutdown paths, all of which share the same Dropped total.
                itemDropped: _ =>
                {
                    Evicted++;
                    Interlocked.Increment(ref Dropped);
                });
        }
    }

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

    /// <summary>🔴 Task C-6 — what one <see cref="EmitLocked"/> call did, plus WHICH channel exhibited it.
    /// With one queue, "the queue saturated" was a complete sentence; with one queue per channel it is not,
    /// and a warning that does not name the channel sends an operator looking through four of them.</summary>
    /// <param name="Outcome">The WORST outcome across the channels this edge was written to — worst wins, so
    /// a single saturated channel is still reported even when the others took the job cleanly.</param>
    /// <param name="Channel">The first channel exhibiting <paramref name="Outcome"/>, or
    /// <see langword="null"/> when nothing happened that is worth naming.</param>
    private readonly record struct EmitReport(EmitOutcome Outcome, string? Channel)
    {
        public static EmitReport Nothing => new(EmitOutcome.Enqueued, null);
    }

    private readonly object _gate = new();
    private readonly Dictionary<string, KeyState> _tracked = new(StringComparer.Ordinal);
    private bool _seeded;
    private int _seededCount;
    private long _sequence;
    private long _suppressed;

    /// <summary>🔴 Task C-6 — EDGES accepted by at least one channel's queue. Deliberately not the sum of
    /// the per-channel <c>Enqueued</c> counters: see <see cref="AlarmNotifierStats.Enqueued"/> for why the
    /// aggregate stays on the edge while the delivery counters are summed.</summary>
    private long _enqueuedEdges;

    /// <summary>🔴 Task C-6 — drop path (5) of 5, an edge lost to an internal fault in <see cref="Notify"/>/
    /// <see cref="SeedFromActive"/>'s own catch-all. This is the ONE loss whose unit is the EDGE rather than
    /// the (job, channel) pair, and it is kept on the notifier rather than on a lane for that reason: the
    /// fault happens BEFORE the edge reaches any queue, so there is no channel to attribute it to, and
    /// multiplying it by the channel count would report one lost edge as four.</summary>
    private long _faultDropped;

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
    /// the loop catches, counts and carries on.
    ///
    /// <para>Note for C-3..C-6: this runs on the DRAIN thread, which holds no lock — so unlike
    /// <see cref="IAlarmNotifier.Notify"/> it MAY block, and it may call back into
    /// <see cref="IAlarmStore"/> (an auto-acking channel is plausible) without deadlocking, since nothing
    /// holding <c>AlarmStore._writeGate</c> ever waits on this loop. It does, however, couple drain
    /// throughput to alarm-write throughput: a delegate that takes the store's gate will queue behind every
    /// evaluator tick and policy denial.</para></param>
    /// <param name="logWarning">Where a dropped job is reported. Invoked OUTSIDE the gate.</param>
    /// <param name="logError">Where a dispatch failure (or a defensive internal fault) is reported.</param>
    /// <param name="capacity">Bounded-channel capacity; see <see cref="DefaultCapacity"/>.</param>
    public AlarmNotifier(
        Func<NotificationJob, CancellationToken, Task>? dispatch = null,
        Action<string>? logWarning = null,
        Action<Exception, string>? logError = null,
        int capacity = DefaultCapacity)
        : this(
            dispatch is null
                ? Array.Empty<AlarmNotificationChannel>()
                : new[] { new AlarmNotificationChannel(DefaultChannelName, dispatch) },
            logWarning, logError, capacity)
    {
    }

    /// <summary>The name the single-delegate constructor gives its one lane, and the name the
    /// no-channel lane carries. Visible in <see cref="AlarmNotifierChannelStats.Channel"/> and in the
    /// saturation warning, so neither ever reads as if a channel were anonymous.</summary>
    public const string DefaultChannelName = "(default)";

    /// <summary>
    /// 🔴 Task C-6 — the per-channel-queue constructor. See <see cref="AlarmNotificationChannel"/> for why
    /// this shape exists and what it structurally guarantees.
    /// </summary>
    /// <param name="channels">One queue and one drain loop is created per entry. An EMPTY list is legal and
    /// means exactly what C-1's <c>dispatch: null</c> meant — one queue whose loop drains and discards, so
    /// the seam is real and observable and delivers to nobody. Names must be distinct; duplicates are
    /// tolerated but make <see cref="ChannelStats"/> ambiguous.</param>
    /// <param name="logWarning">Where a dropped job is reported. Invoked OUTSIDE the gate.</param>
    /// <param name="logError">Where a dispatch failure (or a defensive internal fault) is reported.</param>
    /// <param name="capacity">Bounded-channel capacity PER CHANNEL; see <see cref="DefaultCapacity"/>.</param>
    public AlarmNotifier(
        IReadOnlyList<AlarmNotificationChannel> channels,
        Action<string>? logWarning = null,
        Action<Exception, string>? logError = null,
        int capacity = DefaultCapacity)
    {
        ArgumentNullException.ThrowIfNull(channels);

        _logWarning = logWarning;
        _logError = logError;

        var bounded = Math.Max(1, capacity);
        _lanes = channels.Count == 0
            ? new[] { new Lane(DefaultChannelName, dispatch: null, bounded) }
            : channels.Select(c => new Lane(c.Name, c.Dispatch, bounded)).ToArray();

        foreach (var lane in _lanes)
        {
            // Captured into a local so each loop closes over its OWN lane — the classic foreach-capture
            // trap would otherwise give every loop the last lane and silently collapse the whole point of
            // this class. (C# 5+ already scopes the iteration variable per iteration; the local is kept as
            // documentation of the requirement, not as a workaround.)
            var own = lane;
            own.DrainLoop = Task.Run(() => RunDrainLoopAsync(own, _cts.Token));
        }
    }

    /// <summary>Cumulative counters — see <see cref="AlarmNotifierStats"/>. The four per-channel numbers are
    /// SUMMED across channels; <see cref="ChannelStats"/> is where they are separated. Cheap; takes the gate
    /// only long enough to copy a handful of numbers.</summary>
    public AlarmNotifierStats Stats
    {
        get
        {
            lock (_gate)
            {
                long dropped = Interlocked.Read(ref _faultDropped), dispatched = 0, failures = 0;
                foreach (var lane in _lanes)
                {
                    dropped += Interlocked.Read(ref lane.Dropped);
                    dispatched += Interlocked.Read(ref lane.Dispatched);
                    failures += Interlocked.Read(ref lane.DispatchFailures);
                }

                return new AlarmNotifierStats(
                    _enqueuedEdges, _suppressed, dropped, dispatched, failures, _seededCount, _tracked.Count);
            }
        }
    }

    /// <summary>🔴 Task C-6 — the same numbers, per channel, plus each queue's current depth. This is the
    /// read that answers "which channel is falling behind?", which the aggregate structurally cannot.</summary>
    public IReadOnlyList<AlarmNotifierChannelStats> ChannelStats
    {
        get
        {
            lock (_gate)
            {
                return _lanes.Select(lane => new AlarmNotifierChannelStats(
                    lane.Name,
                    lane.Enqueued,
                    Interlocked.Read(ref lane.Dropped),
                    Interlocked.Read(ref lane.Dispatched),
                    Interlocked.Read(ref lane.DispatchFailures),
                    lane.Queue.Reader.Count)).ToList();
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

            var report = EmitReport.Nothing;
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
                        report = OnRaiseLocked(alarm);
                        break;

                    case AlarmTransitionKind.Cleared:
                        if (_tracked.Remove(alarm.Key)) report = EmitLocked(AlarmEdgeKind.Cleared, alarm, null, actor);
                        else _suppressed++;
                        break;

                    case AlarmTransitionKind.Acked:
                        if (_tracked.TryGetValue(alarm.Key, out var acking) && acking.State == AlarmState.Active)
                        {
                            _tracked[alarm.Key] = acking with { State = AlarmState.Acked };
                            report = EmitLocked(AlarmEdgeKind.Acked, alarm, null, actor);
                        }
                        else
                        {
                            // Already acked (AckAsync will happily re-ack), or never tracked. Not news.
                            _suppressed++;
                        }
                        break;
                }
            }

            LogOutcome(report, alarm.Key);
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
            Interlocked.Increment(ref _faultDropped);
            ReportError(ex, "Alarm notifier: the edge detector faulted — this edge was lost, the alarm itself is unaffected.");
        }
    }

    /// <summary>Called AFTER the gate is released — a caller-supplied logging delegate must never run
    /// under it.</summary>
    private void LogOutcome(EmitReport report, string key)
    {
        switch (report.Outcome)
        {
            case EmitOutcome.EnqueuedAfterEviction:
                _logWarning?.Invoke(
                    $"Alarm notification queue for channel '{report.Channel}' saturated — dropped the oldest " +
                    $"queued notification(s) to make room for '{key}'. That notification channel is not keeping " +
                    "up; see its Dropped counter in AlarmNotifier.ChannelStats.");
                break;

            case EmitOutcome.DroppedShuttingDown:
                _logWarning?.Invoke(
                    $"Alarm notifier is shutting down — dropped the notification for '{key}' on channel " +
                    $"'{report.Channel}'. This is expected during shutdown and does NOT mean a channel is " +
                    "falling behind.");
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
    private EmitReport OnRaiseLocked(Alarm alarm)
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
        return EmitReport.Nothing;
    }

    /// <summary><see cref="AlarmPriority"/> is declared MOST-SEVERE-FIRST (Critical = 0 … Low = 3), the
    /// same ordering <see cref="AlarmStore.ListActiveAsync"/> sorts by — so "more severe" is a SMALLER
    /// underlying value, not a larger one.</summary>
    private static bool IsMoreSevere(AlarmPriority candidate, AlarmPriority current) => candidate < current;

    /// <summary>
    /// Caller holds <c>_gate</c>. Assigns the sequence number ONCE and writes the SAME job into EVERY
    /// channel's queue; every failure path increments that channel's own <c>Dropped</c>. Returns the worst
    /// thing that happened, and on which channel, so the caller can log it once the gate is released.
    ///
    /// <para>🔴 Task C-6 — the sequence number is assigned once per EDGE, not once per (edge, channel):
    /// C-5's browser client de-duplicates on it, and two channels seeing different ordinals for the same
    /// edge would break that and every future correlation across channels. Writing all channels under the
    /// one gate is also what preserves per-key ordering INSIDE each queue — see
    /// <see cref="AlarmNotificationChannel"/>.</para>
    ///
    /// <para>Writing to N queues under the gate stays non-blocking: <c>TryWrite</c> on a bounded
    /// <see cref="BoundedChannelFullMode.DropOldest"/> channel never waits, whatever the reader is doing, so
    /// the cost here is N pointer swaps and cannot be affected by a wedged channel.</para>
    /// </summary>
    private EmitReport EmitLocked(AlarmEdgeKind edge, Alarm alarm, AlarmPriority? previousPriority, string? actor)
    {
        if (IsDisposed)
        {
            // Drop path (3) of 5 — an edge arriving after shutdown began. Counted per channel (each one
            // genuinely missed it), not silent.
            foreach (var lane in _lanes) Interlocked.Increment(ref lane.Dropped);
            return new EmitReport(EmitOutcome.DroppedShuttingDown, _lanes[0].Name);
        }

        var job = new NotificationJob(++_sequence, edge, alarm, DateTimeOffset.UtcNow, previousPriority, actor);

        var worst = EmitOutcome.Enqueued;
        string? worstChannel = null;
        var acceptedSomewhere = false;

        foreach (var lane in _lanes)
        {
            // Bracket the lane's Evicted, NOT its Dropped. Dropped is also incremented by that lane's drain
            // loop (shutdown-abandon and its final sweep), so one of those landing between two reads of it
            // would report an eviction that never happened and log "a channel is not keeping up" during an
            // orderly shutdown — the exact wrong-operational-message failure this class already fixes
            // elsewhere. Evicted is only ever touched by the itemDropped callback, under this same gate, so
            // the bracket is exact.
            var evictedBefore = lane.Evicted;

            EmitOutcome outcome;
            if (!lane.Queue.Writer.TryWrite(job))
            {
                // Drop path (2) of 5 — the writer is completed, which only DisposeAsync ever does. Same
                // operational meaning as the check above, so it reports the same way.
                Interlocked.Increment(ref lane.Dropped);
                outcome = EmitOutcome.DroppedShuttingDown;
            }
            else
            {
                lane.Enqueued++;
                acceptedSomewhere = true;

                // TryWrite may ALSO have evicted an older job (drop path 1, counted by the itemDropped
                // callback, which fires synchronously from inside the TryWrite above) while still returning
                // true — the two are independent, so Enqueued and Dropped can both move on one call. That is
                // the honest accounting: one job went in, a different one fell out.
                outcome = lane.Evicted != evictedBefore
                    ? EmitOutcome.EnqueuedAfterEviction
                    : EmitOutcome.Enqueued;
            }

            // Worst wins, first-of-that-kind is named. EmitOutcome is ordered least-to-most severe, so a
            // single saturated channel is still reported even when the others took the job cleanly, and a
            // clean run across every channel leaves worstChannel null and LogOutcome silent.
            if (outcome > worst)
            {
                worst = outcome;
                worstChannel = lane.Name;
            }
        }

        if (acceptedSomewhere) _enqueuedEdges++;
        return new EmitReport(worst, worstChannel);
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

            var worst = EmitReport.Nothing;
            lock (_gate)
            {
                if (_seeded) return;
                _seeded = true;

                foreach (var alarm in active)
                {
                    if (alarm is null || _tracked.ContainsKey(alarm.Key)) continue;
                    _tracked[alarm.Key] = new KeyState(alarm.Priority, alarm.State);
                    _seededCount++;
                    var report = EmitLocked(AlarmEdgeKind.Restored, alarm, previousPriority: null, actor: null);
                    if (report.Outcome > worst.Outcome) worst = report;
                }
            }

            LogOutcome(worst, "<restored alarms>");
        }
        catch (Exception ex)
        {
            // Counted for the same reason Notify's catch-all is — see there.
            Interlocked.Increment(ref _faultDropped);
            ReportError(ex, "Alarm notifier: restoring alarms from a previous process faulted — the seam is running WITHOUT that history.");
        }
    }

    // ─────────────────────────────────────────────────────────────────────
    // Drain loop
    // ─────────────────────────────────────────────────────────────────────

    /// <summary>🔴 Task C-6 — ONE of these runs per channel, over that channel's OWN queue. Nothing in this
    /// method touches shared state except the caller-supplied <c>logError</c> and the lane's own counters,
    /// which is what makes "a wedged channel cannot delay another" structural rather than
    /// scheduled.</summary>
    private async Task RunDrainLoopAsync(Lane lane, CancellationToken ct)
    {
        var reader = lane.Queue.Reader;

        try
        {
            while (await reader.WaitToReadAsync(ct).ConfigureAwait(false))
            {
                while (reader.TryRead(out var job))
                {
                    try
                    {
                        if (lane.Dispatch is not null) await lane.Dispatch(job, ct).ConfigureAwait(false);
                        Interlocked.Increment(ref lane.Dispatched);
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
                        Interlocked.Increment(ref lane.Dropped);
                    }
                    catch (Exception ex)
                    {
                        Interlocked.Increment(ref lane.DispatchFailures);
                        ReportError(ex, $"Alarm notification dispatch failed on channel '{lane.Name}' for " +
                                        $"{job.Edge} '{job.Alarm.Key}' — not retried.");
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
            ReportError(ex, $"Alarm notification drain loop for channel '{lane.Name}' stopped unexpectedly — " +
                            "that channel will no longer deliver anything in this process.");
        }
        finally
        {
            // Whatever is still queued when this loop ends is never going to be delivered — on a cancelled
            // (hard-stop) shutdown, or after a fault. Count it: a truncated drain that leaves Dropped at 0
            // would tell an operator nothing was lost when something was. On a CLEAN shutdown the loop only
            // exits once the channel is empty, so this sweep finds nothing and changes no counter.
            while (reader.TryRead(out _)) Interlocked.Increment(ref lane.Dropped);
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

        foreach (var lane in _lanes) lane.Queue.Writer.TryComplete();

        // 🔴 Task C-6 — the 5s bound is over ALL channels TOGETHER, not per channel. Per channel it would
        // be 5s × N in the worst case, so adding a channel would silently lengthen shutdown; and since the
        // channels drain concurrently on their own threads, one budget is also the honest measure of how
        // long a clean drain can take.
        var allLanes = Task.WhenAll(_lanes.Select(lane => lane.DrainLoop));

        try
        {
            await allLanes.WaitAsync(TimeSpan.FromSeconds(5)).ConfigureAwait(false);
        }
        catch (TimeoutException)
        {
            _cts.Cancel();
            try
            {
                await allLanes.ConfigureAwait(false);
            }
            catch
            {
                // Best-effort shutdown — each drain loop already reports its own failures via logError.
            }
        }
        catch
        {
            // The loop faulted; it has already reported itself. Shutdown must not surface that.
        }

        _cts.Dispose();
    }
}
