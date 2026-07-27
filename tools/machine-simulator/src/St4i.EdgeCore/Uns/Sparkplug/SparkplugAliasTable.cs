namespace St4i.EdgeCore.Uns.Sparkplug;

/// <summary>
/// G2-2 — per-equipment Sparkplug B metric name&lt;-&gt;alias table. Per spec, a device's (D)BIRTH
/// declares each metric's <c>name</c> together with a numeric <c>alias</c>; every subsequent (D)DATA for
/// that device is then allowed to carry ONLY the alias (cheaper on the wire) instead of repeating the
/// name. G2-2 does not yet emit NBIRTH/DBIRTH (see <see cref="UnsTopicBuilder.SparkplugMsgType"/>'s doc
/// comment — that sequencing is G2-3), so today every metric this table hands out an alias for is a
/// first-seen name assigned lazily on first (D)DATA rather than at a real BIRTH; <see cref="Reset"/> is
/// what a genuine (D)BIRTH (G2-3) will call to start a device's aliasing over from scratch, matching the
/// spec's "aliases are only valid for the current BIRTH/DEATH session" rule.
///
/// One instance = one equipment/device's alias space; <see cref="UnsPublisher"/> keeps one per device
/// code (never shared across devices — two machines each own metric named e.g. "temperature" must not
/// collide on the same alias number). Thread-safe.
/// </summary>
public sealed class SparkplugAliasTable
{
    private readonly object _gate = new();
    private readonly Dictionary<string, ulong> _byName = new(StringComparer.Ordinal);
    private ulong _nextAlias = 1;

    /// <summary>Returns the existing alias for <paramref name="name"/> if one was already assigned;
    /// otherwise assigns the next sequential alias (starting at 1) and returns that.</summary>
    public ulong GetOrAssign(string name)
    {
        ArgumentException.ThrowIfNullOrEmpty(name);
        lock (_gate)
        {
            if (_byName.TryGetValue(name, out var alias))
            {
                return alias;
            }

            alias = _nextAlias++;
            _byName[name] = alias;
            return alias;
        }
    }

    /// <summary>Non-assigning lookup — does not mutate the table when <paramref name="name"/> is unknown.</summary>
    public bool TryGet(string name, out ulong alias)
    {
        lock (_gate)
        {
            return _byName.TryGetValue(name, out alias);
        }
    }

    /// <summary>Clears every assigned alias and restarts numbering at 1 — the G2-3 (D)BIRTH hook (see the
    /// class doc comment).</summary>
    public void Reset()
    {
        lock (_gate)
        {
            _byName.Clear();
            _nextAlias = 1;
        }
    }
}
