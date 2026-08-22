namespace St4i.EdgeCore.Uns.Sparkplug;

/// <summary>
/// G2-2 — per-equipment Sparkplug B metric name&lt;-&gt;alias table. Per spec, a device's (D)BIRTH
/// declares each metric's <c>name</c> together with a numeric <c>alias</c>; every subsequent (D)DATA for
/// that device is then allowed to carry ONLY the alias (cheaper on the wire) instead of repeating the
/// name.
///
/// <para>🔴 <b>RETRACTED 2026-08-22 (owner-decisions.md item 35). The two sentences that stood here were
/// forward-looking and both have since become false, in OPPOSITE directions.</b> They read: <i>"G2-2 does
/// not yet emit NBIRTH/DBIRTH … that sequencing is G2-3 … <c>Reset</c> is what a genuine (D)BIRTH (G2-3)
/// will call to start a device's aliasing over from scratch"</i>. Measured today:
/// <list type="bullet">
///   <item><b>NBIRTH IS emitted.</b> <c>UnsPublisher.PublishNodeBirthCoreAsync</c> publishes it, driven by
///     <c>FleetCore</c>'s Start transition; NDEATH likewise on Stop / E-stop. G2-3 landed that half.</item>
///   <item><b>No (D)BIRTH will call <see cref="Reset"/>, because the DBIRTH path was REMOVED.</b> On
///     2026-08-21 the owner ruled <c>IUnsPublisher.PublishBirth</c>/<c>PublishDeath</c> deleted
///     (owner-decisions.md item 23), and that publisher was this method's only production caller. What is
///     measurable now, repo-wide at <c>cfcfae42</c> including <c>server/</c> and <c>client/</c>: exactly
///     ONE call site for <see cref="Reset"/>, and it is
///     <c>SparkplugAliasTableTests.Reset_ClearsAssignmentsAndRestartsNumberingAtOne</c> — a unit test.</item>
/// </list>
/// So the standing state, rather than a plan: <see cref="GetOrAssign"/> runs on each metric of each
/// reading this spine publishes, nothing clears the table for the life of the process, and its clearing
/// half has no production caller. Aliases therefore survive a Start→Stop→Start cycle, which is harmless
/// because <c>SparkplugPayload.EncodeMetric</c> writes both <c>Name</c> and <c>Alias</c> on a metric
/// unconditionally (measured 2026-08-22 at its two <c>WriteTag</c> pairs, not inferred) — so a subscriber
/// has no alias to resolve that it was not also handed the name for. Restoring a real
/// DBIRTH would put a new message on the wire and is NOT a decision this file may take — see item 35.</para>
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

    /// <summary>Clears every assigned alias and restarts numbering at 1.
    /// <para>🔴 <b>RETRACTED 2026-08-22 (item 35): this used to call itself "the G2-3 (D)BIRTH hook".</b>
    /// There is no DBIRTH hook — the path that would have called this was removed on 2026-08-21 under the
    /// owner's item-23 ruling. Measured repo-wide at <c>cfcfae42</c>, the one caller of this method is
    /// <c>SparkplugAliasTableTests</c>. It is kept, not deleted, because deleting a member of a published
    /// type is a second contract change that no ruling covers (the same reasoning that kept
    /// <c>SparkplugMsgType.DBIRTH</c>) — but a reader should not infer a live mechanism from its
    /// existence.</para></summary>
    public void Reset()
    {
        lock (_gate)
        {
            _byName.Clear();
            _nextAlias = 1;
        }
    }
}
