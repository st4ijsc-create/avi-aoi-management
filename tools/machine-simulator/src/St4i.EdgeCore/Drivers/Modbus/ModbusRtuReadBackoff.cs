namespace St4i.EdgeCore.Drivers.Modbus;

/// <summary>
/// 🔴 Task D-7a (.superpowers/sdd/2026-08-02-dotD-modbus-rtu-blueprint/task-7a-brief.md) — <b>the per-device
/// READ backoff, and only the read path.</b>
///
/// <para><b>What it fixes, and what it provably does not.</b> D-4 measured that ONE device that never answers
/// collapses every healthy device's read throughput on the same line, because a dead device holds the shared
/// arbitration lock for its ENTIRE <see cref="ModbusRegisterMap.WorstCaseBusHoldMs"/> on <b>every</b> poll and
/// everyone else waits behind it. This makes it stop taking its full turn every cycle. It does <b>NOT</b>
/// improve a WRITE's worst case, and that is not an omission — D-5's review verified it structurally: the hold
/// is <i>inside</i> the arbitration lock, a backoff changes a <see cref="Task.Delay(int, CancellationToken)"/>
/// <i>outside</i> it, so the longest a write can queue behind one dead sibling is identical either way. The
/// bound that fixes THAT is a different mechanism — see <see cref="ModbusRtuDriver.WriteSetpointAsync"/>'s
/// queue budget and <see cref="ModbusMultidropMap.MaxWorstCaseBusHoldMs"/>.</para>
///
/// <para><b>🔴 The base interval is the device's own <see cref="ModbusRegisterMap.WorstCaseBusHoldMs"/>, not a
/// constant, and that choice is the whole design.</b> The obvious shape — "back off from
/// <see cref="ModbusRegisterMap.PollIntervalMs"/>" — is useless for exactly the configuration that hurts most:
/// a fast-cadence device (<c>pollIntervalMs: 100</c>) whose read timeout is 4 000 ms costs the bus 8 000 ms per
/// failed poll and would back off from 100 ms, so it would still be re-taking the line essentially
/// continuously. Scaling from the hold makes the wait proportional to the HARM the device just did: a device
/// that cost the bus H ms waits at least H ms before it may cost it again (a 50% duty cycle), then 2H (33%),
/// then 4H (20%), up to <see cref="MaxIntervalMs"/>. It needs no magic number, it needs no new configuration
/// field, and it self-scales to whatever the operator actually declared.</para>
///
/// <para><b>What an operator sees while a device is backed off, and how they tell it from merely quiet.</b>
/// Three things, none of them new surface:
/// <list type="number">
/// <item><description>The driver's <see cref="St4i.Connector.Abstractions.Models.DriverHealthState"/> is
/// <c>Degraded</c> — unchanged from before this type existed — which <c>AlarmEvaluator</c> already raises a
/// degraded alarm for, keyed on the pipeline slot label. For a multidrop device that label is
/// <c>{bus}:unit{n}</c>, so the alarm names the exact device rather than "the Modbus connector".</description></item>
/// <item><description>Every failed poll already logs through <c>ModbusRtuDriver</c>'s <c>logError</c>
/// callback; from D-7a that message also carries <b>how many consecutive polls have failed and how long this
/// device is now waiting between attempts</b>. "Quiet" and "backed off" are different sentences, so an
/// operator reading a log can tell which one they have.</description></item>
/// <item><description>Recovery is logged too, once, naming the failure streak that just ended and the cadence
/// being restored. A device that comes back silently would leave the operator unable to tell "it recovered"
/// from "the log stopped".</description></item>
/// </list>
/// The one thing an operator does NOT get is a per-device "backed off" flag on an HTTP projection, because
/// <see cref="St4i.Connector.Abstractions.IDeviceDriver"/> has no such member and inventing one for a single
/// transport would put a Modbus concept on the seam every driver implements. Stated rather than left to be
/// discovered.</para>
/// </summary>
/// <param name="Multiplier">How much the wait grows per additional consecutive failure. <c>1.0</c> (or less)
/// disables the backoff entirely — see <see cref="Disabled"/>.</param>
/// <param name="MaxIntervalMs">The ceiling. A device that has been dead for hours must still be retried
/// occasionally, or a repaired device would never be noticed; <c>0</c> (or less) disables the backoff.</param>
public sealed record ModbusRtuReadBackoff(double Multiplier, int MaxIntervalMs)
{
    /// <summary>The production default: double the wait per consecutive failure, up to one minute. A device
    /// that has failed 7 consecutive polls at a 1 000 ms hold is being retried once a minute, i.e. it is taking
    /// ~1.6% of the line instead of ~100% of it — and a repaired device is noticed within that minute.</summary>
    public static ModbusRtuReadBackoff Default { get; } = new(Multiplier: 2.0, MaxIntervalMs: 60_000);

    /// <summary>No backoff at all: every poll is followed by exactly
    /// <see cref="ModbusRegisterMap.PollIntervalMs"/>, which is the behaviour every
    /// <see cref="ModbusRtuDriver"/> had before D-7a. Exists so a measurement can run the SAME harness with the
    /// mechanism off and on in one process — a before/after pair on one machine is evidence; a number from
    /// another task's report compared against a number from this one is not.</summary>
    public static ModbusRtuReadBackoff Disabled { get; } = new(Multiplier: 1.0, MaxIntervalMs: 0);

    /// <summary>Whether this instance actually delays anything. Both fields have to be meaningful: a
    /// multiplier of 1 never grows, and a ceiling of 0 clamps every growth back to the poll interval, so either
    /// one on its own is already "off" and saying so once here keeps
    /// <see cref="DelayMsFor"/> from having to re-derive it.</summary>
    public bool IsEnabled => Multiplier > 1.0 && MaxIntervalMs > 0;

    /// <summary>
    /// The wait to observe before the next poll attempt.
    /// </summary>
    /// <param name="pollIntervalMs">The device's declared cadence — the answer for a healthy device, and the
    /// FLOOR for every other answer. A backoff may never make a device poll FASTER than it was configured
    /// to.</param>
    /// <param name="worstCaseBusHoldMs">This device's <see cref="ModbusRegisterMap.WorstCaseBusHoldMs"/> — the
    /// cost it imposes on every sibling for one failed poll, and the base the growth scales from.</param>
    /// <param name="consecutiveFailures">How many polls in a row have failed. <c>0</c> means the last poll
    /// succeeded, and the answer is always <paramref name="pollIntervalMs"/> unchanged.</param>
    /// <returns>A wait in milliseconds, never below <paramref name="pollIntervalMs"/> and never above
    /// <see cref="MaxIntervalMs"/> once the backoff is engaged.</returns>
    public int DelayMsFor(int pollIntervalMs, long worstCaseBusHoldMs, int consecutiveFailures)
    {
        if (consecutiveFailures <= 0 || !IsEnabled)
        {
            return pollIntervalMs;
        }

        // The first failure already waits a full hold: a device that just cost every sibling H ms does not get
        // to do it again immediately. Growth starts from there, so failure 1 -> H, 2 -> 2H, 3 -> 4H.
        var baseMs = Math.Max((double)pollIntervalMs, worstCaseBusHoldMs);

        // Math.Pow in double, deliberately, and clamped before the cast: at Multiplier 2 and 60 consecutive
        // failures the un-clamped product overflows every integer type in the language, and an overflowed
        // negative delay would make a dead device poll in a tight loop — the exact opposite of this type's
        // purpose, reached by the arithmetic meant to serve it.
        var scaled = baseMs * Math.Pow(Multiplier, consecutiveFailures - 1);

        if (double.IsNaN(scaled) || scaled >= MaxIntervalMs)
        {
            return Math.Max(pollIntervalMs, MaxIntervalMs);
        }

        return Math.Max(pollIntervalMs, (int)scaled);
    }
}
