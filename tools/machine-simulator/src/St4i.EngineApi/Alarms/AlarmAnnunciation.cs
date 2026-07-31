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
    /// <summary>Per-listener queue depth. An annunciation is an EDGE, not a tick (C-1 absorbs the 5 s
    /// re-raise storm before this channel ever sees anything), and a live browser drains within a frame —
    /// so a listener that has fallen 64 behind is wedged, not busy. The one legitimate burst is
    /// <see cref="AlarmEdgeKind.Restored"/> at engine start, which emits one job per standing alarm; 64
    /// covers a fleet in a genuinely bad state, and beyond that the loss is counted rather than hidden.</summary>
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
