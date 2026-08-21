namespace St4i.EdgeCore.Infrastructure;

/// <summary>
/// Process-wide fan-out for <see cref="ApiTraceEvent"/>s: transports/orchestrators call
/// <see cref="Publish(ApiTraceEvent)"/> as each send completes, the WPF UI subscribes to <see cref="Traced"/> for
/// live updates, and <see cref="Recent"/> gives any late subscriber (a newly opened trace pane) the
/// last N events without having to have been listening from the start.
///
/// Bounded ring buffer — the cap is the <see cref="EventBus(int)"/> constructor's <c>capacity</c>
/// argument, defaulting to <see cref="DefaultCapacity"/> (500) — so a long-running edge service
/// doesn't grow this without bound; thread-safe since publishers (transport callbacks) and readers
/// (UI data-binding) run on different threads.
/// </summary>
public sealed class EventBus
{
    /// <summary>The ring's depth when the constructor is called without one: 500 events. This is the
    /// REPLAY depth for a late subscriber, not a delivery buffer — <see cref="Traced"/> fires synchronously
    /// regardless, so a subscriber that was already listening never misses an event by overflowing
    /// this.</summary>
    public const int DefaultCapacity = 500;

    private readonly object _gate = new();
    private readonly Queue<Entry> _ring;
    private readonly int _capacity;

    /// <summary>🔴 One ring slot holds the event AND its optional body together — task AT-1, owner item 27.
    /// They are stored as a PAIR rather than in two parallel rings on purpose: the ruling that created
    /// <see cref="ApiTraceBody"/> requires a retained body to live inside the lifetime of the trace it
    /// belongs to, and two rings with independent eviction would eventually disagree about which events
    /// still have bodies. Sharing one queue makes that impossible to get wrong rather than merely
    /// documented — a body is evicted in the same <c>Dequeue</c> as its event, always.</summary>
    private readonly record struct Entry(ApiTraceEvent Event, ApiTraceBody? Body);

    /// <summary>Creates the bus with a fixed ring depth. The depth cannot be changed afterwards.</summary>
    /// <param name="capacity">How many past events <see cref="Recent"/> can hand a late subscriber.
    /// Non-positive throws <see cref="ArgumentOutOfRangeException"/> — this is the one argument in this
    /// class that is validated, deliberately, because a zero-capacity ring would discard every event while
    /// still looking like it worked.</param>
    public EventBus(int capacity = DefaultCapacity)
    {
        if (capacity <= 0) throw new ArgumentOutOfRangeException(nameof(capacity));
        _capacity = capacity;
        _ring = new Queue<Entry>(capacity);
    }

    /// <summary>Fired synchronously on the publishing thread each time <see cref="Publish(ApiTraceEvent)"/> is called.
    /// <para>🔴 It carries the event ONLY, and that is deliberate rather than an omission — task AT-1,
    /// owner item 27. Every subscriber to this is a surface whose shape is already published: the
    /// <c>WS /v1/inspector/stream</c> frame serializes exactly what arrives here, and the WPF pane's ring
    /// feeds an Export button that writes that same shape to disk. Widening this signature would push a
    /// body into all of them, which is precisely what the ruling forbade. A body is read back through
    /// <see cref="RecentBodies"/> instead.</para></summary>
    public event Action<ApiTraceEvent>? Traced;

    /// <summary>Records the event in the ring buffer, then notifies subscribers.</summary>
    public void Publish(ApiTraceEvent e) => Publish(e, null);

    /// <summary>Records the event and its retained request body in one ring slot, then notifies
    /// subscribers — task AT-1, owner item 27.
    /// <para>The overload exists so that the body enters the ring in the SAME lock and the SAME slot as
    /// its event; see <c>Entry</c> for why that is a structural guarantee rather than a convention.
    /// <see cref="Traced"/> still fires with the event alone, so no already-published surface observes any
    /// change from a caller choosing this overload.</para></summary>
    /// <param name="e">The trace event, unchanged in shape and in what subscribers receive.</param>
    /// <param name="body">The allowlisted, capped body, or <see langword="null"/> for a caller that does
    /// not retain one. Null is the behaviour of the parameterless overload and of every caller that has not
    /// opted in.</param>
    public void Publish(ApiTraceEvent e, ApiTraceBody? body)
    {
        lock (_gate)
        {
            if (_ring.Count == _capacity) _ring.Dequeue();
            _ring.Enqueue(new Entry(e, body));
        }

        Traced?.Invoke(e);
    }

    /// <summary>The most recent <paramref name="n"/> events (oldest-first), newest last, capped at
    /// however many are currently buffered.</summary>
    public IReadOnlyList<ApiTraceEvent> Recent(int n)
    {
        if (n <= 0) return Array.Empty<ApiTraceEvent>();
        lock (_gate)
        {
            return _ring.Skip(Math.Max(0, _ring.Count - n)).Select(entry => entry.Event).ToList();
        }
    }

    /// <summary>The retained request bodies among the most recent <paramref name="n"/> ring slots,
    /// oldest-first — task AT-1, owner item 27, the read half of the separate lane.
    /// <para>🔴 The window is counted in RING SLOTS, not in bodies, and the difference is the point:
    /// asking for the last 200 slots returns the bodies belonging to those 200 events, not the last 200
    /// bodies. Slots whose caller retained no body are simply absent, so this list is normally SHORTER than
    /// <paramref name="n"/> and a reader must not treat its length as an event count.</para>
    /// <para>This is why a body can never outlive its trace: it is stored in that trace's own slot and
    /// evicted with it.</para></summary>
    /// <param name="n">How many recent ring slots to look in. Non-positive returns empty.</param>
    public IReadOnlyList<ApiTraceBody> RecentBodies(int n)
    {
        if (n <= 0) return Array.Empty<ApiTraceBody>();
        lock (_gate)
        {
            return _ring.Skip(Math.Max(0, _ring.Count - n))
                .Where(entry => entry.Body is not null)
                .Select(entry => entry.Body!)
                .ToList();
        }
    }
}
