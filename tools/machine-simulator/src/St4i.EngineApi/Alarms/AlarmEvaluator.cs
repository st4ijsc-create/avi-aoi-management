using St4i.EdgeCore.Models;
using St4i.EngineApi.Fleet;

namespace St4i.EngineApi.Alarms;

/// <summary>
/// GĐ3 sub-4 LC-2 (+ GĐ3 closeout WI-4) — the PURE evaluation core for the automatic (condition-based)
/// alarm sources: per-slot driver health (<see cref="FleetHost.GetDriverHealth"/>), a windowed fleet-wide
/// NG-rate (<see cref="FleetHost.GetKpiCounters"/>), and (WI-4) the device identity certificate's own
/// expiry (<see cref="St4i.EdgeCore.Identity.DeviceIdentityStore"/>). Deliberately holds NO timer/real-time
/// dependency of its own — <see cref="EvaluateAsync"/> is a single, directly-testable evaluation pass a
/// caller invokes however often it likes (in production, <see cref="AlarmEvaluatorService"/>'s
/// <see cref="PeriodicTimer"/> loop; in tests, directly and deterministically, with synthetic snapshots/KPI
/// counters/expiry timestamps — never the wall clock, except where computing a days-to-expiry delta
/// against "now" is literally the point of the Identity source).
///
/// Every source raises/clears CONDITION alarms (<see cref="AlarmRaise.ClearOnAck"/> == <see langword="false"/>)
/// through the same <see cref="IAlarmStore"/> LC-1 built: this evaluator is the only thing that ever calls
/// <see cref="IAlarmStore.ClearAsync"/> for a <see cref="AlarmSource.DriverHealth"/>/<see cref="AlarmSource.NgRate"/>/
/// <see cref="AlarmSource.Identity"/> key — an operator's Ack only silences it (see <see cref="Alarm"/>'s own
/// doc comment), never clears it.
///
/// Each source (driver health, NG-rate, identity expiry) is evaluated inside its OWN try/catch — a fault in
/// one (e.g. a throwing <see cref="IAlarmStore"/> test double) never prevents the others from running, and
/// <see cref="EvaluateAsync"/> itself NEVER throws into its caller — the same "additive, never-crashes-the-host"
/// contract <see cref="IAlarmStore"/> itself already carries, extended one layer up so
/// <see cref="AlarmEvaluatorService"/>'s timer loop never needs its own inner try/catch around the sources
/// individually (it still wraps the call for defense in depth — see that class's own doc comment).
/// </summary>
public sealed class AlarmEvaluator
{
    private readonly IAlarmStore _alarms;
    private readonly AlarmThresholds _thresholds;
    private readonly Action<Exception, string>? _logError;

    /// <summary>Every slot label seen on the PREVIOUS pass — diffed against the current snapshot so a
    /// slot that has vanished (removed from the fleet, e.g. RegisterMachine/a fault tore its slot down)
    /// gets its lingering DriverHealth alarms cleared even though it no longer appears at all. Starts
    /// empty: the very first pass has no "previous" slots to diff against, so nothing is (spuriously)
    /// cleared for it.</summary>
    private HashSet<string> _lastSlotLabels = new(StringComparer.Ordinal);

    /// <summary>The NG-rate source's own last-poll baseline (<see langword="null"/> until the first pass
    /// seeds it — see <see cref="EvaluateNgRateAsync"/>). Both fields are set together, always.</summary>
    private long? _lastPass;
    private long? _lastJudged;

    public AlarmEvaluator(IAlarmStore alarms, AlarmThresholds thresholds, Action<Exception, string>? logError = null)
    {
        _alarms = alarms ?? throw new ArgumentNullException(nameof(alarms));
        _thresholds = thresholds ?? throw new ArgumentNullException(nameof(thresholds));
        _logError = logError;
    }

    /// <summary>One evaluation pass: given the CURRENT driver-health snapshot and CURRENT (cumulative)
    /// KPI counters, raises/clears every DriverHealth + NG-rate alarm whose condition changed since the
    /// last call. Idempotent (calling it twice with the same inputs is a no-op the second time, since
    /// raising/clearing an already-raised/already-clear alarm is itself a no-op — see
    /// <see cref="IAlarmStore"/>) and NEVER throws. Call once per tick from
    /// <see cref="AlarmEvaluatorService"/>, or directly (and only ever this way) from a test.
    ///
    /// <para><paramref name="identityNotAfterUtc"/> (GĐ3 closeout WI-4) is deliberately the LAST parameter,
    /// AFTER <paramref name="ct"/> rather than before it — this method predates the Identity source, and
    /// every pre-existing caller (this whole file's own tests, <see cref="AlarmEvaluatorService"/>) invokes
    /// it positionally as <c>(health, kpi, ct)</c>; inserting a new parameter ahead of <paramref name="ct"/>
    /// would silently break every one of those call sites' argument-to-parameter binding. Optional +
    /// trailing keeps them all compiling unchanged; a caller that has an identity to evaluate passes it by
    /// name (<c>identityNotAfterUtc: ...</c>), same as <see cref="AlarmEvaluatorService"/> does.
    /// <see langword="null"/> (the default) means "no identity to evaluate this pass" — raises/clears
    /// nothing for <see cref="AlarmSource.Identity"/>, rather than treating a missing value as an
    /// already-expired certificate.</para></summary>
    public async Task EvaluateAsync(
        IReadOnlyList<DriverHealthSnapshot> health, (long TotalPass, long TotalJudged) kpi,
        CancellationToken ct = default, DateTimeOffset? identityNotAfterUtc = null)
    {
        await EvaluateDriverHealthAsync(health, ct).ConfigureAwait(false);
        await EvaluateNgRateAsync(kpi, ct).ConfigureAwait(false);
        await EvaluateIdentityExpiryAsync(identityNotAfterUtc, ct).ConfigureAwait(false);
    }

    // ─────────────────────────────────────────────────────────────────────
    // DriverHealth source
    // ─────────────────────────────────────────────────────────────────────

    private async Task EvaluateDriverHealthAsync(IReadOnlyList<DriverHealthSnapshot> health, CancellationToken ct)
    {
        try
        {
            var currentLabels = new HashSet<string>(StringComparer.Ordinal);

            foreach (var slot in health)
            {
                currentLabels.Add(slot.SlotLabel);

                switch (slot.Health)
                {
                    case DriverHealthState.Degraded:
                        await _alarms.RaiseAsync(
                            new AlarmRaise(
                                AlarmSource.DriverHealth,
                                "DEGRADED",
                                AlarmPriority.High,
                                $"Driver '{slot.SlotLabel}' ({slot.Kind}) is degraded — check the {slot.Kind} connection.",
                                TargetId: slot.SlotLabel,
                                ClearOnAck: false),
                            ct).ConfigureAwait(false);
                        // The condition escalated FROM Down (or never was) — either way DOWN no longer
                        // holds, so it must not linger active alongside the fresh DEGRADED alarm.
                        await _alarms.ClearAsync(DownKey(slot.SlotLabel), ct).ConfigureAwait(false);
                        break;

                    case DriverHealthState.Down:
                        await _alarms.RaiseAsync(
                            new AlarmRaise(
                                AlarmSource.DriverHealth,
                                "DOWN",
                                AlarmPriority.Critical,
                                $"Driver '{slot.SlotLabel}' ({slot.Kind}) is DOWN — the {slot.Kind} device is unreachable.",
                                TargetId: slot.SlotLabel,
                                ClearOnAck: false),
                            ct).ConfigureAwait(false);
                        await _alarms.ClearAsync(DegradedKey(slot.SlotLabel), ct).ConfigureAwait(false);
                        break;

                    case DriverHealthState.Connected:
                    default:
                        await _alarms.ClearAsync(DegradedKey(slot.SlotLabel), ct).ConfigureAwait(false);
                        await _alarms.ClearAsync(DownKey(slot.SlotLabel), ct).ConfigureAwait(false);
                        break;
                }
            }

            // A slot present last pass but absent now (removed from the fleet) can't report Connected to
            // clear its own alarms — do it on its behalf, once, right when it disappears.
            foreach (var vanishedLabel in _lastSlotLabels)
            {
                if (currentLabels.Contains(vanishedLabel)) continue;
                await _alarms.ClearAsync(DegradedKey(vanishedLabel), ct).ConfigureAwait(false);
                await _alarms.ClearAsync(DownKey(vanishedLabel), ct).ConfigureAwait(false);
            }

            _lastSlotLabels = currentLabels;
        }
        catch (Exception ex)
        {
            _logError?.Invoke(ex, "AlarmEvaluator: the DriverHealth source failed this pass — its alarms were left as they were.");
        }
    }

    private static string DegradedKey(string label) => $"{AlarmSource.DriverHealth}:DEGRADED:{label}";

    private static string DownKey(string label) => $"{AlarmSource.DriverHealth}:DOWN:{label}";

    // ─────────────────────────────────────────────────────────────────────
    // NG-rate source — windowed DELTA since the last pass, not a cumulative fleet-lifetime rate.
    // ─────────────────────────────────────────────────────────────────────

    private const string NgRateKey = $"{nameof(AlarmSource.NgRate)}:HIGH:fleet";

    private async Task EvaluateNgRateAsync((long TotalPass, long TotalJudged) kpi, CancellationToken ct)
    {
        try
        {
            if (_lastPass is null || _lastJudged is null)
            {
                // First pass ever — nothing to diff against yet. Seed the baseline; never raise on it.
                _lastPass = kpi.TotalPass;
                _lastJudged = kpi.TotalJudged;
                return;
            }

            var dPass = kpi.TotalPass - _lastPass.Value;
            var dJudged = kpi.TotalJudged - _lastJudged.Value;

            if (dJudged < 0 || dPass < 0)
            {
                // The cumulative counters went BACKWARDS (e.g. the process/fleet counters were reset) —
                // there is no valid window to evaluate. Reset the baseline to the new reality and skip
                // this pass entirely (no raise, no clear) rather than compute a nonsense negative rate.
                _lastPass = kpi.TotalPass;
                _lastJudged = kpi.TotalJudged;
                return;
            }

            _lastPass = kpi.TotalPass;
            _lastJudged = kpi.TotalJudged;

            if (dJudged < _thresholds.NgRateMinSample)
            {
                // Not enough judged units in this window to trust a rate off of — do nothing (neither
                // raise nor clear) so a slow trickle of cycles can't flap the alarm in and out.
                return;
            }

            var ngRate = dJudged == 0 ? 0.0 : (double)(dJudged - dPass) / dJudged;

            if (ngRate > _thresholds.NgRateThreshold)
            {
                await _alarms.RaiseAsync(
                    new AlarmRaise(
                        AlarmSource.NgRate,
                        "HIGH",
                        AlarmPriority.High,
                        $"Fleet NG-rate {ngRate:P0} over the last window exceeds the {_thresholds.NgRateThreshold:P0} limit.",
                        TargetId: "fleet",
                        ClearOnAck: false),
                    ct).ConfigureAwait(false);
            }
            else
            {
                await _alarms.ClearAsync(NgRateKey, ct).ConfigureAwait(false);
            }
        }
        catch (Exception ex)
        {
            _logError?.Invoke(ex, "AlarmEvaluator: the NG-rate source failed this pass — its alarm was left as it was.");
        }
    }

    // ─────────────────────────────────────────────────────────────────────
    // Identity-expiry source (GĐ3 closeout WI-4) — condition alarm (ClearOnAck: false), same as
    // DriverHealth/NG-rate above: an operator's Ack silences it, but only THIS evaluator noticing the
    // condition has ended (the cert's NotAfter is now further than the warn window away — in practice,
    // after a rotation mints a fresh ~10-year cert) actually clears it.
    // ─────────────────────────────────────────────────────────────────────

    private const string IdentityExpiryKey = $"{nameof(AlarmSource.Identity)}:EXPIRING:device";

    private async Task EvaluateIdentityExpiryAsync(DateTimeOffset? notAfterUtc, CancellationToken ct)
    {
        try
        {
            if (notAfterUtc is null)
            {
                // No identity to evaluate this pass (a caller/test that doesn't supply one) — do nothing,
                // rather than treating "unknown" as "already expired" and raising a bogus alarm.
                return;
            }

            var daysToExpiry = (notAfterUtc.Value - DateTimeOffset.UtcNow).TotalDays;

            if (daysToExpiry <= _thresholds.IdentityExpiryWarnDays)
            {
                await _alarms.RaiseAsync(
                    new AlarmRaise(
                        AlarmSource.Identity,
                        "EXPIRING",
                        // 🔴 Priority ceiling — High, NEVER Critical. This is a deliberate product decision,
                        // not an oversight (GĐ3 closeout WI-4 brief). A Critical alarm feeds LineController's
                        // alarm→hold gate (LC-3 — see LineController.cs), which blocks line.start/
                        // line.unhold. An expiring device certificate must NEVER stop production — the same
                        // "không bao giờ dừng sản xuất vì license" principle the roadmap states for
                        // licensing: there is no safety justification for halting a line over a credential
                        // nearing end-of-life. Do NOT "upgrade" this to Critical — AlarmEvaluatorTests has a
                        // regression test asserting exactly this.
                        AlarmPriority.High,
                        $"Device identity certificate expires in {Math.Floor(daysToExpiry):0} day(s) " +
                        $"(NotAfter {notAfterUtc.Value:O}) — rotate it via POST /v1/site/identity/rotate " +
                        "before it lapses.",
                        TargetId: "device",
                        ClearOnAck: false),
                    ct).ConfigureAwait(false);
            }
            else
            {
                await _alarms.ClearAsync(IdentityExpiryKey, ct).ConfigureAwait(false);
            }
        }
        catch (Exception ex)
        {
            _logError?.Invoke(ex, "AlarmEvaluator: the Identity source failed this pass — its alarm was left as it was.");
        }
    }
}
