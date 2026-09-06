using System.Text.Json.Serialization;

namespace St4i.EdgeCore.Licensing;

/// <summary>
/// WS-E — the outcome of evaluating this machine's licence, and the single value every feature gate
/// branches on.
///
/// <para>🔴 <b>THE BOUNDARY THIS ENUM EXISTS INSIDE.</b> None of these states may stop a machine. Expiry,
/// a corrupt file, a missing file, a clock jump and a broken fingerprint each degrade <i>paid features</i>
/// and nothing else: HALT, E-stop and its reset, kiosk rendering, data collection, historian writes and
/// alarm annunciation never consult a licence at all. Fail-closed for FEATURES, fail-open for OPERATION.
/// The mechanism that makes that structural rather than aspirational is that licence gating is an ASP.NET
/// endpoint filter attached route by route, never an <c>IPolicyRule</c> — see
/// <c>St4i.EngineApi.Licensing.LicenseFeatureFilter</c> and the structural pin
/// <c>PolicyRuleArrayPinTests</c> for why that distinction is load-bearing rather than stylistic.</para>
///
/// <para><b>The deliberate asymmetry.</b> <see cref="Grace"/> and <see cref="ClockUnusable"/> keep paid
/// features ON; every genuine failure turns them OFF. Those are the only two fail-open cases, and they
/// share one property: the customer has already paid and the fault is TIME, not entitlement. A machine
/// whose clock is wrong has an unknown licence state, and unknown-but-paid degrades to "keep working and
/// complain loudly", never to "switch off".</para>
/// </summary>
public enum LicenseState
{
    /// <summary>Signature verified, fingerprint matched, inside its validity window. Paid features ON.</summary>
    Valid,

    /// <summary>Past <c>expiresAtUtc</c> but within <c>graceDays</c>. Paid features stay <b>ON</b> — the
    /// customer has lost nothing, they have been told. Amber banner with a day count.</summary>
    Grace,

    /// <summary>Past <c>expiresAtUtc</c> + <c>graceDays</c>. Paid features OFF; machine operation
    /// untouched. The operator banner is AMBER, never red: red is this product's colour for "the machine
    /// has a problem", and the machine does not have one.</summary>
    Expired,

    /// <summary>No licence file. This is the honest state of an unlicensed install and it is a
    /// <i>working machine</i>, just not an authorable one — Core features only.</summary>
    Missing,

    /// <summary>The envelope or its base64url members could not be parsed. Core features only.</summary>
    Corrupt,

    /// <summary>The Ed25519 signature did not verify against the embedded public key. Core features only.
    /// This is the state a forged or edited licence lands in.</summary>
    Invalid,

    /// <summary>Fewer fingerprint components matched than the signed <c>fingerprintPolicy</c> requires.
    /// Core features only, and the engineer surface names WHICH components mismatched so support can act
    /// without guessing.</summary>
    WrongMachine,

    /// <summary>The payload's <c>v</c> is newer than this build understands. A readable refusal rather
    /// than a mis-parse — which is the entire reason <c>v</c> is in the payload.</summary>
    Unsupported,

    /// <summary>The wall clock disagrees with the monotonic floor beyond tolerance (see
    /// <see cref="LicenseClock"/>). Treated as <see cref="Grace"/>: paid features stay <b>ON</b>.</summary>
    ClockUnusable,
}

/// <summary>
/// 🔴 WS-E — the THREE outcomes of reading the licence file, kept distinct because collapsing two of them
/// is a named defect class in this tree.
///
/// <para>A store that answers the same value for "there is nothing here" and "there is something here I
/// could not read" leaves its caller unable to branch, and the host then comes up saying nothing — the
/// mechanism that destroyed <c>fleet-settings.json</c> and <c>site-link.json</c> before task Q-1 and
/// <c>oee-settings.json</c> before V-1. <c>OperatorDataRemovalCensusTests</c> polices it as a law, and
/// <see cref="LicenseStore"/> obeys the law rather than taking a named exception to it.</para>
/// </summary>
public enum LicenseFileRead
{
    /// <summary>No licence file exists. → <see cref="LicenseState.Missing"/>, an unlicensed but WORKING
    /// machine, and the honest state of a fresh install.</summary>
    Absent,

    /// <summary>A licence file exists and its bytes were read.</summary>
    Present,

    /// <summary>A licence file exists but could not be read — an ACL, a disconnected mount, a locked file.
    /// → <see cref="LicenseState.Corrupt"/>, NOT <see cref="LicenseState.Missing"/>: the two send a
    /// support engineer to different places, and reporting this one as "no licence installed" would have
    /// them installing a second licence beside a first one they cannot see.</summary>
    Unreadable,
}

/// <summary>
/// WS-E — the signed licence payload, exactly as it appears inside the base64url <c>payload</c> member.
///
/// <para>🔴 <b>THIS TYPE IS NEVER RE-SERIALISED TO CHECK A SIGNATURE.</b> The signed bytes are the
/// base64url-decoded <c>payload</c> blob verbatim; this record is what those bytes are parsed INTO, and
/// only after they have already verified. Deserialise-then-reserialise would make every licence in the
/// field depend on JSON whitespace, member ordering and the exact <c>System.Text.Json</c> version — a
/// fleet-wide outage triggered by a framework patch. <see cref="LicenseVerifier"/> verifies bytes and
/// parses second, in that order, and <c>LicenseVerifierTests</c> pins the ordering with a payload whose
/// whitespace differs from anything this type would emit.</para>
/// </summary>
/// <param name="V">Payload format version. Unknown (higher) values produce
/// <see cref="LicenseState.Unsupported"/> rather than a best-effort parse.</param>
/// <param name="LicenseId">ST4I's own issue identifier, quoted on support calls.</param>
/// <param name="Customer">Display name of the entitled customer.</param>
/// <param name="Edition">The invoice label. <b>Not</b> what the gate reads — see <paramref name="Features"/>.</param>
/// <param name="Features">🔴 The truth. Feature strings, not the edition name, are what every gate
/// consults, which is what makes "license-credit nâng cấp" (roadmap:136) a re-issued licence with more
/// strings rather than a migration.</param>
/// <param name="Fingerprint">The four component hashes this licence was issued against.</param>
/// <param name="FingerprintPolicy">How many of those must match. In the signed payload, so ST4I can issue
/// a looser licence to a customer with a documented hardware quirk without shipping a new binary — and so
/// that it cannot be loosened by editing the file.</param>
/// <param name="IssuedAtUtc">When ST4I issued it.</param>
/// <param name="NotBeforeUtc">Start of the validity window.</param>
/// <param name="ExpiresAtUtc"><see langword="null"/> means PERPETUAL — the correct representation for a
/// bought-outright Machine edition, and a legal value rather than a missing one.</param>
/// <param name="GraceDays">Days past <paramref name="ExpiresAtUtc"/> during which features stay ON.</param>
/// <param name="Seats">Reserved for multi-seat editions; 1 for a per-machine licence.</param>
/// <param name="Notes">Free text (a PO number, typically).</param>
public sealed record LicensePayload(
    [property: JsonPropertyName("v")] int V,
    [property: JsonPropertyName("licenseId")] string? LicenseId,
    [property: JsonPropertyName("customer")] string? Customer,
    [property: JsonPropertyName("edition")] string? Edition,
    [property: JsonPropertyName("features")] IReadOnlyList<string>? Features,
    [property: JsonPropertyName("fingerprint")] LicenseFingerprint? Fingerprint,
    [property: JsonPropertyName("fingerprintPolicy")] LicenseFingerprintPolicy? FingerprintPolicy,
    [property: JsonPropertyName("issuedAtUtc")] DateTimeOffset? IssuedAtUtc,
    [property: JsonPropertyName("notBeforeUtc")] DateTimeOffset? NotBeforeUtc,
    [property: JsonPropertyName("expiresAtUtc")] DateTimeOffset? ExpiresAtUtc,
    [property: JsonPropertyName("graceDays")] int GraceDays,
    [property: JsonPropertyName("seats")] int Seats,
    [property: JsonPropertyName("notes")] string? Notes);

/// <summary>
/// WS-E — the four fingerprint components, <b>stored separately rather than combined into one hash</b>.
///
/// <para>That separation is the whole tolerance mechanism: a combined hash can only answer "same machine
/// or not", which forces 4-of-4 matching, which means any single routine maintenance event — a NIC swap,
/// a warranty disk replacement — bricks the paid features. Four independent values let the rule be
/// "at least N of 4" (<see cref="LicenseFingerprintPolicy"/>) and let
/// <c>GET /v1/license/fingerprint</c> show support WHICH component moved.</para>
/// </summary>
/// <param name="DeviceIdentity">SHA-256 over the device identity certificate thumbprint
/// (<see cref="St4i.EdgeCore.Identity.DeviceIdentityStore"/>). Survives every hardware change — and is
/// the riskiest of the four, because that store regenerates silently on any read failure. See
/// <see cref="MachineFingerprint"/> for how that risk is surfaced rather than absorbed.</param>
/// <param name="MachineGuid">SHA-256 over <c>HKLM\SOFTWARE\Microsoft\Cryptography\MachineGuid</c> —
/// survives disk, NIC, RAM, GPU and motherboard swaps; changes only on OS reinstall or sysprep.</param>
/// <param name="VolumeSerial">SHA-256 over the volume serial of the drive holding <c>%ProgramData%</c> —
/// cheap, and the component that distinguishes two cloned VMs sharing a MachineGuid.</param>
/// <param name="PrimaryMac">SHA-256 over the lowest-index physical, non-virtual, non-loopback NIC's MAC.</param>
public sealed record LicenseFingerprint(
    [property: JsonPropertyName("deviceIdentity")] string? DeviceIdentity,
    [property: JsonPropertyName("machineGuid")] string? MachineGuid,
    [property: JsonPropertyName("volumeSerial")] string? VolumeSerial,
    [property: JsonPropertyName("primaryMac")] string? PrimaryMac);

/// <summary>
/// WS-E — how many fingerprint components must match, carried INSIDE the signature.
///
/// <para>The default is 3-of-4, and the arithmetic is deliberate. 4-of-4 is unshippable: one warranty
/// disk replacement bricks a paid machine. 2-of-4 is a revenue leak: the device-identity and MachineGuid
/// components BOTH survive a full disk-image restore onto different hardware, so 2-of-4 would let one
/// licence run on unlimited clones. 3-of-4 tolerates exactly one hardware event at a time — a disk swap
/// breaks the volume serial alone, a NIC swap breaks the MAC alone, both survive — while a disk-image
/// clone onto new hardware breaks BOTH of those together and is correctly refused.</para>
/// </summary>
/// <param name="Required">Minimum matching components. Signed, so it cannot be loosened by editing the file.</param>
/// <param name="Of">The component names <paramref name="Required"/> counts over.</param>
/// <param name="Mode">🔴 <b>THE BINDING MODE, NAMED IN WORDS.</b> See
/// <see cref="LicenseBindingMode"/>. Absent or unrecognised means
/// <see cref="LicenseBindingMode.Machine"/> — the bound default — so an unbound licence can only ever
/// come from a payload that SAYS SO, and says so inside the signature.</param>
public sealed record LicenseFingerprintPolicy(
    [property: JsonPropertyName("required")] int Required,
    [property: JsonPropertyName("of")] IReadOnlyList<string>? Of,
    [property: JsonPropertyName("mode")] string? Mode = null);

/// <summary>
/// 🔴🔴 WS-E — how tightly a licence is bound to one machine. <b>An explicitly named mode, never a
/// silent branch</b> (owner ruling 2026-09-06, round 2).
///
/// <para><b>Why this is a named string and not simply <c>required: 0</c>.</b> An unbound licence that is
/// accepted quietly is a back door with a friendly name. A reader of a licence file, a support engineer
/// on a call, and an auditor reading this enum must all be able to see that a licence is unbound by
/// LOOKING at it — not by noticing that a threshold happens to be zero and inferring what the verifier
/// will do with that. The mode is inside the signature, so it cannot be added to a bound licence by
/// editing the file.</para>
/// </summary>
public static class LicenseBindingMode
{
    /// <summary>🔴 <b>THE DEFAULT, and the only mode any customer licence may use.</b> The licence is
    /// bound to one machine and the fingerprint must match to the signed threshold. Reached whenever the
    /// payload does not explicitly name another mode — including when it names one this build does not
    /// recognise, so a future mode name cannot silently loosen an old build.</summary>
    public const string Machine = "machine";

    /// <summary>
    /// 🔴🔴 <b>UNBOUND — NOT FOR ANY CUSTOMER MACHINE.</b> The fingerprint is not checked at all. This
    /// exists for exactly one purpose: the end-to-end test fixture, whose machine is whatever CI or a
    /// developer laptop happens to be, so no fingerprint could be issued against it in advance.
    ///
    /// <para><b>What makes this not a back door.</b> It is inside the SIGNATURE, so only ST4I can mint
    /// one — a customer cannot edit a bound licence into an unbound one. It is NAMED, so it is visible in
    /// the file, in <c>GET /v1/license</c>, and in this enum. And it is pinned from both directions by
    /// <c>UnboundBindingModeTests</c>: that a bound licence still refuses a wrong machine, and that the
    /// unbound mode cannot be reached by accident from a missing, empty, differently-cased or
    /// unrecognised policy.</para>
    ///
    /// <para>🔴 If a licence in this mode is ever observed on a customer machine, it was issued in error
    /// and must be revoked — there is no legitimate reason for one to leave ST4I.</para>
    /// </summary>
    public const string Unbound = "unbound-test-only";

    /// <summary>
    /// Resolves a payload's mode. 🔴 Anything that is not EXACTLY <see cref="Unbound"/>, compared
    /// ordinally, is <see cref="Machine"/>. Ordinal and case-SENSITIVE on purpose: a case-insensitive or
    /// trimming comparison widens the set of strings that unbind a licence, and this is the one place in
    /// the product where a wider match is strictly worse.
    /// </summary>
    /// <param name="policy">The signed policy, or <see langword="null"/>.</param>
    /// <returns><see langword="true"/> only for an explicit, exact unbound declaration.</returns>
    public static bool IsUnbound(LicenseFingerprintPolicy? policy) =>
        policy?.Mode is not null && string.Equals(policy.Mode, Unbound, StringComparison.Ordinal);
}

/// <summary>
/// WS-E — the licence envelope on disk: plain UTF-8 JSON with exactly two members, so a support engineer
/// can read a licence over the phone and so the signed bytes are unambiguous.
/// </summary>
/// <param name="Payload">base64url of the canonical payload bytes. <b>These bytes, verbatim, are what the
/// signature covers</b> — never a re-serialisation of the parsed <see cref="LicensePayload"/>.</param>
/// <param name="Signature">base64url of the 64-byte Ed25519 signature over exactly those bytes.</param>
public sealed record LicenseEnvelope(
    [property: JsonPropertyName("payload")] string? Payload,
    [property: JsonPropertyName("signature")] string? Signature);

/// <summary>
/// WS-E — the evaluated licence: one <see cref="LicenseState"/>, the payload if (and only if) the
/// signature verified, and the diagnostics a support engineer needs on a call.
/// </summary>
/// <param name="State">The outcome. Every gate branches on this and nothing else.</param>
/// <param name="Payload">The parsed payload, or <see langword="null"/> when the bytes never verified.
/// 🔴 A non-null payload is therefore proof the signature checked out — no caller has to remember to ask.</param>
/// <param name="Features">The effective feature set: the payload's features when they are entitled, or
/// the Core set when they are not. Never <see langword="null"/>, so a gate cannot fail open by
/// dereferencing nothing.</param>
/// <param name="Diagnostic">Engineer-facing detail — which component mismatched, which clock readings
/// disagreed, why a file would not parse. Never shown to an operator.</param>
/// <param name="ObservedFingerprint">This machine's fingerprint as measured at evaluation time, so
/// support can compare it against the licence's without a second round trip.</param>
/// <param name="FingerprintMatches">How many of the four components matched.</param>
/// <param name="IdentityWasRegenerated">🔴 <see langword="true"/> when the device-identity component was
/// read from a store that had just regenerated it — i.e. the fingerprint may have moved with no hardware
/// change at all. See <see cref="MachineFingerprint"/>.</param>
/// <param name="EvaluatedAtUtc">The instant used for the window arithmetic — the wall clock, or the
/// audit-log floor when the wall clock was not credible.</param>
public sealed record LicenseEvaluation(
    LicenseState State,
    LicensePayload? Payload,
    IReadOnlySet<string> Features,
    string? Diagnostic,
    LicenseFingerprint? ObservedFingerprint,
    int FingerprintMatches,
    bool IdentityWasRegenerated,
    DateTimeOffset EvaluatedAtUtc);
