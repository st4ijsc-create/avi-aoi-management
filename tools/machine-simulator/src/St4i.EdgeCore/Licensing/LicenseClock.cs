namespace St4i.EdgeCore.Licensing;

/// <summary>
/// WS-E — decides what "now" is for licence-window arithmetic on an appliance whose clock may be wrong.
///
/// <para><b>Why this exists.</b> An appliance whose RTC reset to 1980, or drifted forward two years, is
/// real. A naive <c>DateTimeOffset.UtcNow</c> comparison gives "not yet valid" (a working machine
/// refusing paid features it owns — a support call) or "expired" (a paid machine losing features early —
/// a revenue event). Both are wrong. There is no <c>TimeProvider</c>/<c>IClock</c> abstraction anywhere
/// in this tree, so this is built on something the appliance cannot lie to itself about.</para>
///
/// <para><b>The monotonic floor.</b> <c>audit_log</c> is append-only and hash-chained
/// (<c>prev_hash</c>/<c>row_hash</c>), described in-tree as tamper-EVIDENT. Its maximum <c>at_utc</c> is
/// therefore a timestamp this machine has already committed to, in a chain it cannot rewrite without
/// detection. That is the floor.</para>
///
/// <para>🔴 <b>THE HOLE, STATED RATHER THAN HIDDEN.</b> A fresh install has an EMPTY audit log, so there
/// is no floor and the wall clock is trusted unconditionally. Set the clock back, wipe the audit
/// database, run forever. This is ACCEPTED, not overlooked. Closing it needs either a phone-home
/// (forbidden — this product is offline-first) or a sealed monotonic counter (TPM, rejected in
/// <see cref="MachineFingerprint"/> for brittleness). Wiping a hash-chained audit log is itself a
/// detectable, deliberate act against a tamper-evident structure, and this product's threat model already
/// accepts that a local administrator with disk access can do damage. The honest statement: <i>this
/// design deters casual clock-rollback; it does not defeat a determined local administrator, and it is
/// not trying to.</i> A scheme that tried would generate false positives against honest customers on the
/// way and would still fail.</para>
/// </summary>
public static class LicenseClock
{
    /// <summary>
    /// How far the wall clock may sit BEHIND the floor before it stops being credible. Absorbs an NTP
    /// correction and a DST/timezone misconfiguration, both of which are ordinary and neither of which
    /// should cost a customer anything.
    /// </summary>
    public static readonly TimeSpan BackwardTolerance = TimeSpan.FromHours(24);

    /// <summary>
    /// How far the wall clock may sit AHEAD of the floor before it stops being credible. 400 days absorbs
    /// a machine genuinely powered off for a year while still catching a 1980→2099 RTC garbage value.
    /// </summary>
    public static readonly TimeSpan ForwardTolerance = TimeSpan.FromDays(400);

    /// <summary>
    /// Resolves the instant to evaluate a licence at.
    /// </summary>
    /// <param name="wallClockUtc">What the machine believes the time is.</param>
    /// <param name="auditFloorUtc">The newest <c>audit_log.at_utc</c>, or <see langword="null"/> on a
    /// fresh install with no rows — in which case the wall clock is trusted, per the hole stated above.</param>
    /// <param name="credible"><see langword="false"/> when the wall clock disagreed with the floor beyond
    /// tolerance. 🔴 The caller must then treat the licence as <see cref="LicenseState.ClockUnusable"/>,
    /// which keeps paid features <b>ON</b>: a broken clock is ST4I's problem to diagnose, not the
    /// customer's entitlement to lose.</param>
    /// <param name="diagnostic">Both readings side by side when the clock was not credible, so the fix is
    /// obvious to an engineer, else <see langword="null"/>.</param>
    /// <returns>The instant to use as "now" — the wall clock when credible, else the floor.</returns>
    public static DateTimeOffset Resolve(
        DateTimeOffset wallClockUtc,
        DateTimeOffset? auditFloorUtc,
        out bool credible,
        out string? diagnostic)
    {
        credible = true;
        diagnostic = null;

        if (auditFloorUtc is not { } floor) return wallClockUtc;

        if (wallClockUtc < floor - BackwardTolerance)
        {
            credible = false;
            diagnostic =
                $"The system clock reads {wallClockUtc:u} but this machine has already recorded audit " +
                $"activity at {floor:u} — the clock has gone backwards by more than " +
                $"{BackwardTolerance.TotalHours:0} hours and needs setting. Paid features are unaffected.";
            return floor;
        }

        if (wallClockUtc > floor + ForwardTolerance)
        {
            credible = false;
            diagnostic =
                $"The system clock reads {wallClockUtc:u} but this machine's newest audit entry is " +
                $"{floor:u} — the clock has jumped forward by more than {ForwardTolerance.TotalDays:0} " +
                "days and needs setting. Paid features are unaffected.";
            return floor;
        }

        return wallClockUtc;
    }
}
