using System.Text;
using System.Text.Json;
using Org.BouncyCastle.Crypto.Parameters;
using Org.BouncyCastle.Crypto.Signers;

namespace St4i.EdgeCore.Licensing;

/// <summary>
/// WS-E — Ed25519 signature verification for a licence envelope. <b>The trust root of the revenue
/// mechanism.</b>
///
/// <para>🔴 <b>VERIFY BYTES, PARSE SECOND.</b> The signed bytes are the base64url-decoded <c>payload</c>
/// blob VERBATIM. This class never deserialises to a DTO and re-serialises to check a signature: that
/// would make every licence in the field depend on JSON whitespace, member ordering and the exact
/// <c>System.Text.Json</c> version, so a framework patch could invalidate a whole fleet at once. Nothing
/// below the <see cref="Ed25519Signer.VerifySignature"/> call runs unless it returned
/// <see langword="true"/>, and <see cref="LicenseEvaluation.Payload"/> being non-null is therefore proof
/// the signature checked out.</para>
///
/// <para>🔴 <b>Why Ed25519 via BouncyCastle rather than the BCL.</b> Measured: .NET 10's
/// <c>System.Security.Cryptography</c> exports the post-quantum suite (MLDsa, SlhDsa, CompositeMLDsa) and
/// ECDsa, and has no Ed25519 or EdDsa type at all. The roadmap names Ed25519 (roadmap:136, :305, :342)
/// and the owner ruled on 2026-09-06 to keep the spec's letter rather than substitute ECDSA P-256.</para>
///
/// <para>🔴 <b>NO PRIVATE KEY IS IN THIS REPOSITORY.</b> Only <see cref="EmbeddedPublicKey"/> — 32 bytes.
/// The signing key lives on ST4I's own issuing service and never comes near this tree. Tests generate a
/// key pair in memory and inject its public half through <see cref="LicenseVerifier(byte[])"/>; that seam
/// is the entire reason this class is testable without a secret on disk, and
/// <c>LicensePrivateKeyAbsenceTests</c> parses <c>src/</c> to prove no key-generation call site exists in
/// production code.</para>
///
/// <para><b>What a test of this class must prove.</b> That a WRONG signature is REJECTED — not merely
/// that a right one is accepted. A verifier that returns <see langword="true"/> unconditionally passes
/// every happy-path test ever written against it, which is why
/// <c>LicenseVerifierTests.A_signature_from_the_wrong_key_is_rejected</c> and its tampered-payload and
/// tampered-signature siblings are the load-bearing tests here and the accept case is the negative
/// control for THEM, rather than the other way round.</para>
/// </summary>
public sealed class LicenseVerifier
{
    /// <summary>Ed25519 public keys are exactly this long; anything else is a configuration error rather
    /// than a licence that happens not to verify.</summary>
    public const int PublicKeyLength = 32;

    /// <summary>Ed25519 signatures are exactly this long.</summary>
    public const int SignatureLength = 64;

    /// <summary>The highest payload <c>v</c> this build understands. A higher value is a readable refusal
    /// (<see cref="LicenseState.Unsupported"/>), never a best-effort parse of a format that may have
    /// changed meaning.</summary>
    public const int SupportedPayloadVersion = 1;

    /// <summary>
    /// 🔴🔴 The licence-signing PUBLIC key this build verifies against, 32 bytes. <b>The private half is
    /// not in this repository and never will be.</b>
    ///
    /// <para>🔴 <b>THIS IS THE END-TO-END TEST KEY, NOT ST4I'S PRODUCTION KEY, AND IT MUST BE REPLACED
    /// BEFORE RELEASE.</b> ST4I's real public key has never been supplied to this repository. What is
    /// here is the public half of a key pair minted out of band (in the session scratchpad, never in the
    /// tree), used once to sign <c>web/fixtures/e2e-license.json</c>, and then discarded with the process
    /// that made it — no copy of the private half exists anywhere, including on the machine that ran it.
    /// That is a deliberate property: this key can verify the committed e2e licence and can never sign
    /// another one.</para>
    ///
    /// <para><b>What this costs and why it was still the right trade.</b> A build carrying this key
    /// cannot verify a licence signed by ST4I, so it is not shippable as-is — replacing this constant is
    /// a release step, and <c>EmbeddedKeyIsTheTestKeyTests</c> exists to make that step impossible to
    /// forget. The alternative — leaving the all-zero placeholder that was here before — meant the
    /// end-to-end suite could not exercise the paid authoring surface at all (56 Playwright tests), and
    /// the two rejected alternatives were worse: unlocking on <c>ST4I_DEMO_ENABLED</c> would ship a
    /// licence bypass inside an installable MSI feature, and a build-configuration key seam would split
    /// the trust root in two.</para>
    ///
    /// <para>🔴 <b>Replacing this key at release invalidates every licence already in the field</b>,
    /// because the key is baked into the binary. Today that set is exactly one licence — the unbound e2e
    /// fixture — so the cost of the swap is zero if it happens before any customer licence is issued, and
    /// unbounded afterwards. Do it first.</para>
    /// </summary>
    public static readonly byte[] EmbeddedPublicKey =
    [
        0x6E, 0xB6, 0xF7, 0x2C, 0xAC, 0x29, 0xEE, 0xF1, 0x90, 0x5C, 0xEF, 0x3A, 0x06, 0xDA, 0x06, 0xA3,
        0x55, 0xE4, 0xAF, 0xB2, 0xCD, 0x68, 0xAF, 0xF5, 0xEF, 0x75, 0x15, 0x65, 0x2F, 0xD7, 0x31, 0xEE,
    ];

    private readonly byte[] _publicKey;

    /// <summary>Verifies against <see cref="EmbeddedPublicKey"/> — the production path.</summary>
    public LicenseVerifier() : this(EmbeddedPublicKey) { }

    /// <summary>
    /// Verifies against a caller-supplied 32-byte Ed25519 public key. 🔴 This is the TEST SEAM, and it is
    /// the reason no private key or generated key pair has to exist in the tree: a fixture mints a pair in
    /// memory, signs a test licence with the private half and constructs this class with the public half.
    /// </summary>
    /// <param name="publicKey">A 32-byte Ed25519 public key.</param>
    /// <exception cref="ArgumentNullException"><paramref name="publicKey"/> is <see langword="null"/>.</exception>
    /// <exception cref="ArgumentException"><paramref name="publicKey"/> is not
    /// <see cref="PublicKeyLength"/> bytes.</exception>
    public LicenseVerifier(byte[] publicKey)
    {
        ArgumentNullException.ThrowIfNull(publicKey);
        if (publicKey.Length != PublicKeyLength)
        {
            throw new ArgumentException(
                $"An Ed25519 public key is {PublicKeyLength} bytes; got {publicKey.Length}.", nameof(publicKey));
        }

        _publicKey = (byte[])publicKey.Clone();
    }

    /// <summary>🔴 <see langword="true"/> when this verifier holds the all-zero non-key — not a valid
    /// Ed25519 public key at all, so nothing can verify against it. Surfaced in diagnostics so that state
    /// is readable rather than mysterious. Note this is NOT the same question as "is this the production
    /// key": <see cref="EmbeddedPublicKey"/> is currently the E2E TEST key, which is perfectly valid and
    /// still must be replaced before release — <c>EmbeddedKeyIsTheTestKeyTests</c> is what says so.</summary>
    public bool KeyIsUnconfigured => _publicKey.All(b => b == 0);

    /// <summary>
    /// Parses an envelope and verifies its signature. Returns the payload only when verification
    /// succeeded.
    ///
    /// <para>Order, and it must be this order: parse the envelope; base64url-decode both members;
    /// <b>verify the decoded payload bytes</b>; only then parse the payload JSON. A failure at any step
    /// produces a state and a diagnostic, never an exception — this runs on a startup path and a licence
    /// file is attacker-influenced input.</para>
    /// </summary>
    /// <param name="envelopeJson">The raw contents of <c>license.json</c>.</param>
    /// <param name="payload">The parsed payload when the signature verified, else <see langword="null"/>.</param>
    /// <param name="diagnostic">Engineer-facing detail on failure, else <see langword="null"/>.</param>
    /// <returns><see cref="LicenseState.Valid"/> when the signature verified and the payload parsed at a
    /// supported version — <b>this does not mean the licence is in date or on the right machine</b>, which
    /// <see cref="LicenseEvaluator"/> decides. Otherwise <see cref="LicenseState.Corrupt"/>,
    /// <see cref="LicenseState.Invalid"/> or <see cref="LicenseState.Unsupported"/>.</returns>
    public LicenseState Verify(string? envelopeJson, out LicensePayload? payload, out string? diagnostic)
    {
        payload = null;
        diagnostic = null;

        if (string.IsNullOrWhiteSpace(envelopeJson))
        {
            diagnostic = "The licence file is empty.";
            return LicenseState.Corrupt;
        }

        LicenseEnvelope? envelope;
        try
        {
            envelope = JsonSerializer.Deserialize<LicenseEnvelope>(envelopeJson);
        }
        catch (JsonException ex)
        {
            diagnostic = $"The licence envelope is not valid JSON: {ex.Message}";
            return LicenseState.Corrupt;
        }

        if (envelope?.Payload is null || envelope.Signature is null)
        {
            diagnostic = "The licence envelope must carry both a 'payload' and a 'signature' member.";
            return LicenseState.Corrupt;
        }

        if (!TryDecodeBase64Url(envelope.Payload, out var payloadBytes))
        {
            diagnostic = "The licence 'payload' member is not valid base64url.";
            return LicenseState.Corrupt;
        }

        if (!TryDecodeBase64Url(envelope.Signature, out var signatureBytes))
        {
            diagnostic = "The licence 'signature' member is not valid base64url.";
            return LicenseState.Corrupt;
        }

        if (signatureBytes.Length != SignatureLength)
        {
            // 🔴 A length check, NOT a shortcut past verification: BouncyCastle's verifier would reject a
            // wrong-length signature anyway. This exists only so the diagnostic names the real problem.
            diagnostic =
                $"An Ed25519 signature is {SignatureLength} bytes; this licence carries {signatureBytes.Length}.";
            return LicenseState.Invalid;
        }

        if (!VerifySignature(payloadBytes, signatureBytes))
        {
            diagnostic = KeyIsUnconfigured
                ? "This build has no licence-signing public key configured (LicenseVerifier.EmbeddedPublicKey " +
                  "is still the all-zero placeholder), so no licence can verify against it."
                : "The licence signature is not valid for this product.";
            return LicenseState.Invalid;
        }

        // ── Nothing above this line trusted the payload's CONTENT; nothing below it doubts the bytes. ──

        LicensePayload? parsed;
        try
        {
            parsed = JsonSerializer.Deserialize<LicensePayload>(Encoding.UTF8.GetString(payloadBytes));
        }
        catch (JsonException ex)
        {
            // A signed payload that will not parse means ST4I issued something this build cannot read —
            // reported as Corrupt rather than Invalid, because the SIGNATURE was fine and pointing an
            // engineer at "the signature is bad" would send them down the wrong path entirely.
            diagnostic = $"The licence payload verified but is not valid JSON: {ex.Message}";
            return LicenseState.Corrupt;
        }

        if (parsed is null)
        {
            diagnostic = "The licence payload verified but decoded to nothing.";
            return LicenseState.Corrupt;
        }

        if (parsed.V > SupportedPayloadVersion)
        {
            diagnostic =
                $"This licence is format version {parsed.V}; this build understands up to " +
                $"{SupportedPayloadVersion}. A newer version of the product is required.";
            return LicenseState.Unsupported;
        }

        payload = parsed;
        return LicenseState.Valid;
    }

    /// <summary>
    /// The raw Ed25519 check. Separated so <c>LicenseVerifierTests</c> can attack it directly with a
    /// wrong key, a tampered payload and a tampered signature, rather than only through the envelope.
    /// </summary>
    /// <param name="message">The exact bytes that were signed.</param>
    /// <param name="signature">The 64-byte signature.</param>
    /// <returns><see langword="true"/> only when the signature is valid for this verifier's public key.</returns>
    public bool VerifySignature(byte[] message, byte[] signature)
    {
        ArgumentNullException.ThrowIfNull(message);
        ArgumentNullException.ThrowIfNull(signature);

        try
        {
            var signer = new Ed25519Signer();
            signer.Init(forSigning: false, new Ed25519PublicKeyParameters(_publicKey, 0));
            signer.BlockUpdate(message, 0, message.Length);
            return signer.VerifySignature(signature);
        }
        catch (Exception ex) when (ex is ArgumentException or FormatException or InvalidOperationException)
        {
            // 🔴 An exception out of the verifier is a REJECTION, never an acceptance and never a crash.
            // An all-zero placeholder key is one way to get here; a malformed key point is another. Both
            // mean "this signature did not verify", which is the fail-closed answer for a FEATURE gate.
            return false;
        }
    }

    /// <summary>
    /// base64url (RFC 4648 §5) with optional padding — the encoding the envelope uses so a licence can be
    /// pasted into a form, an email or a URL without escaping. Never throws.
    /// </summary>
    /// <param name="value">The encoded text.</param>
    /// <param name="bytes">The decoded bytes, or an empty array on failure.</param>
    /// <returns><see langword="true"/> when <paramref name="value"/> decoded.</returns>
    /// <remarks>🔴 <c>public</c> rather than <c>internal</c> deliberately: this assembly grants no
    /// <c>InternalsVisibleTo</c> to its test project (see <c>AssemblyInfo.cs</c>, which states that
    /// position and its history), and the licence envelope's encoding is part of the FORMAT — anything
    /// that reads or writes a licence needs exactly this decoder, so hiding it would force a second,
    /// divergent copy, which is the failure this method exists to prevent.</remarks>
    public static bool TryDecodeBase64Url(string value, out byte[] bytes)
    {
        bytes = [];
        var normalised = value.Trim().Replace('-', '+').Replace('_', '/');
        switch (normalised.Length % 4)
        {
            case 2: normalised += "=="; break;
            case 3: normalised += "="; break;
            case 1: return false; // never a valid base64 length
        }

        try
        {
            bytes = Convert.FromBase64String(normalised);
            return true;
        }
        catch (FormatException)
        {
            return false;
        }
    }

    /// <summary>base64url-encodes without padding — the form the envelope carries.</summary>
    /// <param name="bytes">The bytes to encode.</param>
    /// <returns>The base64url text.</returns>
    /// <remarks><c>public</c> for the same reason as <see cref="TryDecodeBase64Url"/>.</remarks>
    public static string EncodeBase64Url(byte[] bytes) =>
        Convert.ToBase64String(bytes).TrimEnd('=').Replace('+', '-').Replace('/', '_');
}
