namespace St4i.EdgeCore.Infrastructure;

/// <summary>
/// Process-wide fan-out for <see cref="ApiTraceEvent"/>s: transports/orchestrators call
/// <see cref="Publish"/> as each send completes, the WPF UI subscribes to <see cref="Traced"/> for
/// live updates, and <see cref="Recent"/> gives any late subscriber (a newly opened trace pane) the
/// last N events without having to have been listening from the start.
///
/// Bounded ring buffer (cap <see cref="Capacity"/>, default 500) so a long-running edge service
/// doesn't grow this without bound; thread-safe since publishers (transport callbacks) and readers
/// (UI data-binding) run on different threads.
/// </summary>
public sealed class EventBus
{
    public const int DefaultCapacity = 500;

    private readonly object _gate = new();
    private readonly Queue<ApiTraceEvent> _ring;
    private readonly int _capacity;

    public EventBus(int capacity = DefaultCapacity)
    {
        if (capacity <= 0) throw new ArgumentOutOfRangeException(nameof(capacity));
        _capacity = capacity;
        _ring = new Queue<ApiTraceEvent>(capacity);
    }

    /// <summary>Fired synchronously on the publishing thread each time <see cref="Publish"/> is called.</summary>
    public event Action<ApiTraceEvent>? Traced;

    /// <summary>Records the event in the ring buffer, then notifies subscribers.</summary>
    public void Publish(ApiTraceEvent e)
    {
        lock (_gate)
        {
            if (_ring.Count == _capacity) _ring.Dequeue();
            _ring.Enqueue(e);
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
            return _ring.Skip(Math.Max(0, _ring.Count - n)).ToList();
        }
    }
}
