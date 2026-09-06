using System.Runtime.Versioning;
using St4i.EdgeCore.Identity;

namespace St4i.EdgeCore.Licensing;

/// <summary>
/// WS-E — composes <see cref="LicenseVerifier"/>, <see cref="MachineFingerprint"/> and
/// <see cref="LicenseClock"/> into the single <see cref="LicenseEvaluation"/> every gate reads.
///
/// <para><b>Evaluation order, and it must be this order:</b> read the file (I/O failure →
/// <see cref="LicenseState.Missing"/>); verify the SIGNATURE over the raw payload bytes (false →
/// <see cref="LicenseState.Invalid"/>, and nothing below runs); match the fingerprint (below threshold →
/// <see cref="LicenseState.WrongMachine"/>); evaluate the clock windows. A signature check that happened
/// after any content-dependent branch would be a signature check an attacker could route around.</para>
///
/// <para>🔴 <b>Every state's effect on OPERATION is the same value: unchanged.</b> HALT, E-stop and its
/// reset, kiosk rendering, data collection, historian writes, alarm annunciation and mode switching never
/// consult a licence at all — not "are permitted by every state", but are unreachable from licence code
/// by construction. See <c>PolicyRuleArrayPinTests</c> for the structural pin that keeps it that way.</para>
/// </summary>
[SupportedOSPlatform("windows")]
public static class LicenseEvaluator
{
    /// <summary>
    /// Evaluates a licence envelope against this machine and this clock. Never throws.
    /// </summary>
    /// <param name="envelopeJson">The licence file's contents, or <see langword="null"/> when there is no
    /// file — which is <see cref="LicenseState.Missing"/>, a legal state and a working machine.</param>
    /// <param name="verifier">The signature verifier (production key, or a test-injected one).</param>
    /// <param name="identityStore">The device-identity store for fingerprint component #1, or
    /// <see langword="null"/> to resolve one at the default root.</param>
    /// <param name="wallClockUtc">What the machine believes the time is.</param>
    /// <param name="auditFloorUtc">The newest <c>audit_log.at_utc</c>, or <see langword="null"/>.</param>
    /// <returns>The evaluation; <see cref="LicenseEvaluation.Features"/> is never <see langword="null"/>.</returns>
    public static LicenseEvaluation Evaluate(
        string? envelopeJson,
        LicenseVerifier verifier,
        DeviceIdentityStore? identityStore,
        DateTimeOffset wallClockUtc,
        DateTimeOffset? auditFloorUtc)
    {
        ArgumentNullException.ThrowIfNull(verifier);

        var observed = MachineFingerprint.Read(identityStore, out var regenerated);

        if (envelopeJson is null)
        {
            return Core(LicenseState.Missing,
                "No licence is installed on this machine. Core features are available; authoring, line " +
                "control and notification dispatch require a licence.",
                observed, 0, regenerated, wallClockUtc);
        }

        var verdict = verifier.Verify(envelopeJson, out var payload, out var verifyDiagnostic);
        if (verdict != LicenseState.Valid || payload is null)
        {
            // 🔴 Corrupt / Invalid / Unsupported all land here and all degrade to Core. The state is kept
            // DISTINCT rather than collapsed to one "bad licence" because the three send a support
            // engineer to three different places: a file to re-copy, a licence to re-issue, a product to
            // upgrade.
            return Core(verdict, verifyDiagnostic, observed, 0, regenerated, wallClockUtc);
        }

        var matches = MachineFingerprint.CountMatches(payload.Fingerprint, observed, out var mismatched);
        var required = MachineFingerprint.RequiredMatches(payload.FingerprintPolicy);

        // 🔴🔴 THE ONE PLACE THE FINGERPRINT CHECK MAY BE SKIPPED, and it is skipped only for a licence
        // whose SIGNED payload names LicenseBindingMode.Unbound in words. Owner ruling 2026-09-06 (round
        // 2): the relaxed binding must be an explicitly named mode with its own test, never a silent
        // branch, because an unbound licence accepted quietly is a back door with a friendly name.
        //
        // Three things keep this honest and each is pinned by UnboundBindingModeTests:
        //   * it is inside the SIGNATURE, so only ST4I can mint one and a customer cannot edit a bound
        //     licence into an unbound one;
        //   * the comparison is ORDINAL and case-sensitive against one exact string, so no missing,
        //     empty, differently-cased or unrecognised policy can reach it by accident;
        //   * a BOUND licence still refuses a wrong machine — the negative control without which
        //     "unbound works" would be indistinguishable from "the fingerprint check does nothing".
        var unbound = LicenseBindingMode.IsUnbound(payload.FingerprintPolicy);

        if (!unbound && matches < required)
        {
            var drift = string.Join(", ", mismatched);
            return Core(LicenseState.WrongMachine,
                $"This licence was issued for a different machine: {matches} of " +
                $"{MachineFingerprint.ComponentNames.Count} identity components match and {required} are " +
                $"required. Components that do not match: {drift}. Quote this machine's current " +
                "fingerprint (GET /v1/license/fingerprint) to ST4I to have the licence re-issued." +
                (regenerated
                    ? " ⚠ This machine's device identity was REGENERATED during this boot, so the " +
                      "deviceIdentity component may have changed without any hardware change."
                    : string.Empty),
                observed, matches, regenerated, wallClockUtc);
        }

        var now = LicenseClock.Resolve(wallClockUtc, auditFloorUtc, out var clockCredible, out var clockDiagnostic);
        var entitled = Entitlements(payload);

        if (!clockCredible)
        {
            // 🔴 Features stay ON. The customer has paid; the fault is TIME.
            return new LicenseEvaluation(
                LicenseState.ClockUnusable, payload, entitled, clockDiagnostic, observed, matches, regenerated, now);
        }

        if (payload.NotBeforeUtc is { } notBefore && now < notBefore)
        {
            return Core(LicenseState.Invalid,
                $"This licence is not valid until {notBefore:u}; the evaluated time is {now:u}.",
                observed, matches, regenerated, now);
        }

        // A null ExpiresAtUtc is PERPETUAL — the correct representation for a bought-outright Machine
        // edition, and a legal value rather than a missing one.
        if (payload.ExpiresAtUtc is not { } expires)
        {
            return new LicenseEvaluation(
                LicenseState.Valid, payload, entitled, DriftNote(matches, regenerated), observed, matches, regenerated, now);
        }

        if (now <= expires)
        {
            return new LicenseEvaluation(
                LicenseState.Valid, payload, entitled, DriftNote(matches, regenerated), observed, matches, regenerated, now);
        }

        // 🔴 Grace clamps at zero rather than trusting a signed negative: a payload with graceDays < 0
        // would otherwise make the grace window END BEFORE the expiry it follows, so a licence would jump
        // straight from Valid to Expired with no warning period at all.
        var graceEnd = expires.AddDays(Math.Max(0, payload.GraceDays));
        if (now <= graceEnd)
        {
            var daysLeft = Math.Max(0, (int)Math.Ceiling((graceEnd - now).TotalDays));
            return new LicenseEvaluation(
                LicenseState.Grace, payload, entitled,
                $"This licence expired on {expires:u}. Paid features remain available for {daysLeft} more " +
                $"day(s), until {graceEnd:u}. Renew before then.",
                observed, matches, regenerated, now);
        }

        return Core(LicenseState.Expired,
            $"This licence expired on {expires:u} and its {payload.GraceDays}-day grace period ended on " +
            $"{graceEnd:u}. Authoring, line control and notification dispatch are locked. " +
            "Machine operation is unaffected.",
            observed, matches, regenerated, now);
    }

    /// <summary>
    /// The features a verified, in-date licence grants: the payload's own <c>features</c> array when it
    /// has one, else the set its edition label implies. 🔴 Core is UNIONED in unconditionally, because
    /// <see cref="LicenseFeatures.Core"/> is free in every edition and a licence that happened to omit
    /// <c>hmi.api</c> from its array must not be able to take a kiosk's screen away.
    /// </summary>
    /// <param name="payload">The verified payload.</param>
    /// <returns>The effective feature set.</returns>
    private static IReadOnlySet<string> Entitlements(LicensePayload payload)
    {
        var set = new HashSet<string>(LicenseFeatures.Core, StringComparer.Ordinal);
        if (payload.Features is { Count: > 0 })
        {
            foreach (var f in payload.Features)
            {
                if (!string.IsNullOrWhiteSpace(f)) set.Add(f.Trim());
            }
        }
        else
        {
            set.UnionWith(LicenseFeatures.ForEdition(payload.Edition));
        }

        return set;
    }

    /// <summary>
    /// The §2.3 drift note: a machine matching fewer than all four components is ONE event away from
    /// refusing, and that must be visible BEFORE it refuses rather than after.
    /// </summary>
    /// <param name="matches">How many components matched.</param>
    /// <param name="regenerated">Whether the device identity was regenerated this boot.</param>
    /// <returns>The note, or <see langword="null"/> when nothing has drifted.</returns>
    private static string? DriftNote(int matches, bool regenerated)
    {
        if (matches >= MachineFingerprint.ComponentNames.Count && !regenerated) return null;

        var note = matches < MachineFingerprint.ComponentNames.Count
            ? $"Licence valid. Note: {matches} of {MachineFingerprint.ComponentNames.Count} machine " +
              "identity components match — this machine has drifted from the hardware the licence was " +
              "issued against and is closer to the refusal threshold than a freshly issued machine."
            : "Licence valid.";

        return regenerated
            ? note + " ⚠ The device identity was REGENERATED during this boot (see DeviceIdentityStore." +
                     "WasRegenerated): the deviceIdentity component may have changed with no hardware change."
            : note;
    }

    /// <summary>Builds a Core-only evaluation — every unentitled state's shared shape.</summary>
    /// <param name="state">The state.</param>
    /// <param name="diagnostic">Engineer-facing detail.</param>
    /// <param name="observed">This machine's fingerprint.</param>
    /// <param name="matches">Matching component count.</param>
    /// <param name="regenerated">Whether identity was regenerated this boot.</param>
    /// <param name="at">The evaluated instant.</param>
    /// <returns>The evaluation, with <see cref="LicenseFeatures.Core"/> as the feature set.</returns>
    private static LicenseEvaluation Core(
        LicenseState state, string? diagnostic, LicenseFingerprint observed,
        int matches, bool regenerated, DateTimeOffset at) =>
        new(state, null, LicenseFeatures.Core, diagnostic, observed, matches, regenerated, at);
}
