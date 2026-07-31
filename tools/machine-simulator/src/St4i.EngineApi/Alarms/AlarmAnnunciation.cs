using System.Collections.Concurrent;
using System.Threading.Channels;

namespace St4i.EngineApi.Alarms;

/// <summary>
/// Task C-5 — one alarm EDGE, rendered for a screen rather than for a machine. This is what
/// <see cref="LocalAnnunciationChannel"/> hands to <see cref="AlarmAnnunciationHub"/> and what
/// <c>GET /v1/alarms/annunciations</c> writes onto the wire as an SSE <c>annunciation</c> event.
///
/// <para><b>Structured, never pre-rendered prose.</b> Unlike C-4's e-mail — which had to be English because
/// a mail filter and a phone preview are built on the exact bytes — this payload is consumed by ONE client
/// (this product's own web UI), which already owns a Vietnamese and an English dictionary. Rendering a
/// sentence here would either force one language on both, or duplicate the translator's work in C#. So this
/// carries facts and the browser writes the sentence.</para>
///
/// <para>🔴 <b><see cref="Sequence"/> is the de-duplication key, and the client is required to use it.</b>
/// The channel publishes once per (notification, configured instance) pair — that is what keeps its
/// accounting invariant exact — so a host with two enabled local-annunciation instances emits the SAME edge
/// twice to the SAME screens. Two webhook instances mean two different destinations; two local-annunciation
/// instances mean one destination twice, which is a genuine wart of applying C-2's per-instance shape to a
/// channel with a single physical surface. <see cref="Sequence"/> is C-1's per-process ordinal, assigned
/// under the notifier's gate at the moment the edge was DECIDED, so it is identical across those duplicate
/// publishes and distinct for every real edge. It RESETS on process restart — a client that keeps a seen-set
/// across a reconnect must therefore also key on <see cref="AtUtc"/>, or simply drop the set when the stream
/// reconnects (which is what this product's client does).</para>
///
/// <para><see cref="Alarm.Id"/> is deliberately absent, for exactly C-3's reason: it is the SQLite rowid and
/// SQLite hands a deleted high-water rowid straight back to the next insert, so a client keying on it would
/// merge two unrelated alarms. <see cref="Key"/> is the stable identity.</para>
/// </summary>
/// <param name="Sequence">C-1's per-process, strictly increasing edge ordinal. See the de-duplication
/// paragraph above.</param>
/// <param name="Edge">What changed. A client that treats every annunciation as "an alarm is happening" is
/// wrong for three of the five kinds: <see cref="AlarmEdgeKind.Acked"/> and
/// <see cref="AlarmEdgeKind.Cleared"/> are the ISA-18.2 moments at which an annunciator STOPS, and
/// <see cref="AlarmEdgeKind.Restored"/> is an alarm that was already standing before this process
/// started.</param>
/// <param name="AtUtc">When the edge was detected.</param>
/// <param name="Instance">Which configured local-annunciation instance produced this. Non-secret by
/// construction — this channel has no credential of any kind.</param>
/// <param name="Key">The alarm's stable identity (<c>Source:Code:TargetId</c>). A client latches and
/// releases its annunciation on this.</param>
/// <param name="PreviousPriority">Only non-<see langword="null"/> for
/// <see cref="AlarmEdgeKind.Escalated"/> — what the key held before.</param>
/// <param name="Actor">Who acked/cleared, or <see langword="null"/> for a system-originated edge.</param>
public sealed record AlarmAnnunciation(
    long Sequence,
    AlarmEdgeKind Edge,
    DateTimeOffset AtUtc,
    string Instance,
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
    AlarmPriority? PreviousPriority,
    string? Actor)
{
    /// <summary>Projects one <see cref="NotificationJob"/> onto the wire shape.</summary>
    public static AlarmAnnunciation From(NotificationJob job, string instance)
    {
        ArgumentNullException.ThrowIfNull(job);
        var alarm = job.Alarm;
        return new AlarmAnnunciation(
            job.Sequence, job.Edge, job.AtUtc, instance,
            alarm.Key, alarm.Source, alarm.Code, alarm.Priority, alarm.State,
            alarm.Message, alarm.Runbook, alarm.TargetId, alarm.ClearOnAck, alarm.Count,
            job.PreviousPriority, job.Actor);
    }

    /// <summary>
    /// 🔴 Review round 1 (I-2) — projects an alarm that is STANDING RIGHT NOW onto the wire, for the
    /// connect-time replay in <see cref="St4i.EngineApi.Hubs.AlarmAnnunciationStreamEndpoint"/>. Not an
    /// edge: nothing changed, this alarm was already on when the page arrived.
    ///
    /// <para><see cref="AlarmEdgeKind.Restored"/> is reused rather than a sixth kind invented, because it
    /// already means exactly this — "was ALREADY standing before you started listening, this is not a new
    /// condition" — and every client that renders it already says so.</para>
    ///
    /// <para>🔴 <b><see cref="Sequence"/> is the NEGATED <see cref="Alarm.FirstRaisedUtc"/> tick count, and
    /// each of those three properties is load-bearing.</b> The client de-duplicates on this value, so a
    /// replay token must be:
    /// <list type="bullet">
    /// <item><description><b>Negative</b>, so it can never collide with <see cref="AlarmNotifier"/>'s
    /// per-process ordinals, which start at 1 and only ever increase. A replayed alarm and a live edge for
    /// the same alarm must both get through.</description></item>
    /// <item><description><b>Stable</b> for as long as the alarm is standing, so a page that reconnects
    /// after a transient blip is not sounded again for something it is already showing.
    /// <see cref="Alarm.FirstRaisedUtc"/> is preserved across re-raises by
    /// <see cref="AlarmStore"/> — that is exactly what makes it stable and
    /// <see cref="Alarm.LastRaisedUtc"/> unusable here.</description></item>
    /// <item><description><b>Free of stored state</b>, so the engine keeps no per-key table that has to be
    /// grown, bounded and expired.</description></item>
    /// </list></para>
    ///
    /// <para>🔴 <b>Two alarms sharing a <see cref="Alarm.FirstRaisedUtc"/> tick would share a token — and
    /// review round 2 (M-7) corrected both halves of what this comment used to say about that.</b></para>
    ///
    /// <para><b>What actually prevents it is NOT clock resolution.</b> The first version of this paragraph
    /// said "two alarms first raised within the same 100 ns tick", which implies the system clock ticks that
    /// finely. It does not: 200 back-to-back reads of <see cref="DateTimeOffset.UtcNow"/> produced only
    /// <b>57 distinct values</b> on this platform, so bare consecutive reads collide freely. The real
    /// protection comes from <see cref="AlarmStore.RaiseAsync"/>: every raise stamps its timestamp INSIDE
    /// <c>_writeGate</c>, immediately before a SQLite upsert, and that upsert always crosses a tick
    /// boundary. Measured through the real store, <b>60 sequential raises produced 60 distinct tokens, and
    /// 60 CONCURRENT raises also produced 60 distinct tokens</b> — a stronger guarantee than the one first
    /// claimed, but one that belongs to the store's write path rather than to this method.</para>
    ///
    /// <para>🔴 <b>Which means it would evaporate silently if a bulk or batched raise path ever stamped one
    /// timestamp across several rows.</b> That is exactly the kind of dependency this batch has learned not
    /// to leave as folklore, so it is pinned:
    /// <c>LocalAnnunciationChannelTests.EveryRaiseThroughTheRealStore_GetsADistinctReplayToken</c> asserts it
    /// for both orderings, and goes red in the same commit as any such change.</para>
    ///
    /// <para><b>And a collision would be worse than first claimed, not merely quiet.</b> The old wording
    /// said "it still appears — the client's standing set is keyed by <see cref="Key"/>, not by sequence".
    /// That is false for this client: <c>web/src/lib/annunciator.tsx</c> returns early on an
    /// already-seen sequence BEFORE its key-based merge, so a colliding alarm would be dropped from the
    /// banner <b>entirely</b> rather than shown silently. Hence the pinning test rather than a shrug.</para>
    ///
    /// <para><see cref="Alarm.Id"/> is still absent, for the reason on this record: SQLite reuses deleted
    /// rowids, so it is not an identity. It is also why the rowid is NOT used as the replay token.</para>
    /// </summary>
    /// <param name="atUtc">When the replay was served — NOT when the alarm was raised, which the client
    /// gets from the alarm's own fields. A client ordering annunciations by this sees the replay arrive
    /// when it actually arrived.</param>
    public static AlarmAnnunciation FromStanding(Alarm alarm, string instance, DateTimeOffset atUtc)
    {
        ArgumentNullException.ThrowIfNull(alarm);
        return new AlarmAnnunciation(
            -alarm.FirstRaisedUtc.UtcTicks, AlarmEdgeKind.Restored, atUtc, instance,
            alarm.Key, alarm.Source, alarm.Code, alarm.Priority, alarm.State,
            alarm.Message, alarm.Runbook, alarm.TargetId, alarm.ClearOnAck, alarm.Count,
            PreviousPriority: null, Actor: null);
    }
}

/// <summary>
/// 🔴 Task C-5 — the in-process fan-out between <see cref="LocalAnnunciationChannel"/> (which runs on C-1's
/// drain thread) and every open <c>GET /v1/alarms/annunciations</c> response.
///
/// <para><b>Why this exists as its own object, and why it is the whole reason this channel can count
/// honestly.</b> Webhook and SMTP learn whether a message landed from a remote answer. A local annunciation
/// has no remote — so the ONLY fact available anywhere about whether anything was annunciated is "how many
/// browser sessions are attached to this process right now", and that fact lives here. Without a listener
/// registry this channel would have nothing to report but "we tried", which is precisely the
/// report-success-unconditionally shape the C-5 brief forbids.</para>
///
/// <para>🔴 <b>What <see cref="Publish"/>'s return value does and does NOT prove.</b> It is the number of
/// listeners that ACCEPTED the annunciation into their own queue. Each listener registers itself only AFTER
/// its SSE response has written and flushed its opening frame, so a registered listener is one whose bytes
/// have already reached a client — not merely one whose request handler has started. That is as strong a
/// claim as this seam can make, and it is deliberately weaker than "a human was annunciated at": a page can
/// be in a background tab, its sound can be blocked by the browser's autoplay policy, and nobody may be in
/// the room. <see cref="LocalAnnunciationChannel"/>'s counters say exactly this and no more, and the browser
/// surface is what makes the muted case visible to whoever IS at the screen.</para>
///
/// <para><b>Publishing never blocks the drain thread.</b> Every listener has its OWN bounded queue and the
/// publisher only ever <c>TryWrite</c>s. <see cref="BoundedChannelFullMode.Wait"/> is chosen for the
/// FAILURE semantic rather than the waiting one: it is the only mode whose <c>TryWrite</c> returns
/// <see langword="false"/> on a full queue. <see cref="BoundedChannelFullMode.DropWrite"/> would return
/// <see langword="true"/> and silently discard — a channel that reports success while nothing annunciates,
/// one layer down. A listener that cannot keep up is counted (<see cref="Overflowed"/>) and skipped, never
/// waited for.</para>
/// </summary>
public sealed class AlarmAnnunciationHub
{
    /// <summary>
    /// Per-listener queue depth. An annunciation is an EDGE, not a tick (C-1 absorbs the 5 s re-raise storm
    /// before this channel ever sees anything), and a live browser drains within a frame — so a listener
    /// that has fallen 64 behind is wedged, not busy.
    ///
    /// <para>🔴 <b>Review round 1 (I-2) corrected the justification, which named a burst no listener could
    /// ever receive.</b> This used to read "the one legitimate burst is <see cref="AlarmEdgeKind.Restored"/>
    /// at engine start, which emits one job per standing alarm". Those jobs are emitted by
    /// <see cref="AlarmNotifierSeedService"/> milliseconds after boot, before any browser can possibly have
    /// connected, so they always publish to ZERO listeners and this queue never sees them. The standing set
    /// now reaches a page through
    /// <see cref="St4i.EngineApi.Hubs.AlarmAnnunciationStreamEndpoint"/>'s connect-time replay, which writes
    /// straight to that connection's response and does not pass through here either.</para>
    ///
    /// <para>What 64 actually covers is a burst of LIVE edges — a fleet going down a machine at a time, or a
    /// wave of policy denials — arriving faster than one browser can drain. Beyond that the loss is counted
    /// rather than hidden.</para></summary>
    public const int DefaultListenerCapacity = 64;

    private readonly int _capacity;
    private readonly ConcurrentDictionary<long, Listener> _listeners = new();
    private long _nextListenerId;
    private long _published;
    private long _fannedOut;
    private long _overflowed;

    public AlarmAnnunciationHub(int listenerCapacity = DefaultListenerCapacity)
    {
        _capacity = Math.Max(1, listenerCapacity);
    }

    /// <summary>How many browser sessions are attached RIGHT NOW. A gauge, not a counter.</summary>
    public int ListenerCount => _listeners.Count;

    /// <summary>Annunciations offered to the hub, whether or not anybody was listening.</summary>
    public long Published => Interlocked.Read(ref _published);

    /// <summary>(annunciation, listener) pairs a listener accepted.</summary>
    public long FannedOut => Interlocked.Read(ref _fannedOut);

    /// <summary>🔴 (annunciation, listener) pairs REFUSED because that listener's queue was full — the one
    /// loss path inside the hub. Counted separately from "nobody was listening" because they are different
    /// operational facts: nobody listening is a quiet control room, a full queue is a wedged browser
    /// session.</summary>
    public long Overflowed => Interlocked.Read(ref _overflowed);

    /// <summary>Registers a listener. The caller MUST dispose it (the SSE handler does so in a
    /// <c>finally</c>), which both unregisters it and completes its reader so a pending read returns.</summary>
    public Listener Subscribe()
    {
        var id = Interlocked.Increment(ref _nextListenerId);
        var listener = new Listener(this, id, _capacity);
        _listeners[id] = listener;
        return listener;
    }

    /// <summary>Offers one annunciation to every attached listener.</summary>
    /// <returns>How many listeners accepted it. <c>0</c> means it annunciated NOWHERE — either nobody had
    /// the UI open, or every attached session was too far behind to take it.</returns>
    public int Publish(AlarmAnnunciation annunciation)
    {
        ArgumentNullException.ThrowIfNull(annunciation);
        Interlocked.Increment(ref _published);

        var accepted = 0;
        foreach (var listener in _listeners.Values)
        {
            if (listener.TryOffer(annunciation))
            {
                accepted++;
                Interlocked.Increment(ref _fannedOut);
            }
            else
            {
                Interlocked.Increment(ref _overflowed);
            }
        }

        return accepted;
    }

    private void Remove(long id) => _listeners.TryRemove(id, out _);

    /// <summary>One attached browser session's queue. Disposal is idempotent — the SSE handler's
    /// <c>finally</c> can run after the connection has already faulted.</summary>
    public sealed class Listener : IDisposable
    {
        private readonly AlarmAnnunciationHub _hub;
        private readonly long _id;
        private readonly Channel<AlarmAnnunciation> _queue;
        private int _disposed;

        internal Listener(AlarmAnnunciationHub hub, long id, int capacity)
        {
            _hub = hub;
            _id = id;
            _queue = Channel.CreateBounded<AlarmAnnunciation>(new BoundedChannelOptions(capacity)
            {
                // See the class doc comment: Wait is chosen for TryWrite's FALSE-on-full semantic, never
                // because anything here ever waits.
                FullMode = BoundedChannelFullMode.Wait,
                SingleReader = true,
                SingleWriter = false,
            });
        }

        public ChannelReader<AlarmAnnunciation> Reader => _queue.Reader;

        internal bool TryOffer(AlarmAnnunciation annunciation) =>
            Volatile.Read(ref _disposed) == 0 && _queue.Writer.TryWrite(annunciation);

        public void Dispose()
        {
            if (Interlocked.Exchange(ref _disposed, 1) != 0) return;
            _hub.Remove(_id);
            _queue.Writer.TryComplete();
        }
    }
}
