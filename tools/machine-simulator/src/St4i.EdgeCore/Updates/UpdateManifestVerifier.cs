using System.Text;
using System.Text.Json;
using Org.BouncyCastle.Crypto.Parameters;
using Org.BouncyCastle.Crypto.Signers;

namespace St4i.EdgeCore.Updates;

/// <summary>
/// WS-F4 Task 2 — Ed25519 verification of an update manifest. 🔴 <b>The trust root of CODE EXECUTION on
/// every machine in every factory.</b>
///
/// <para>🔴 <b>WHY THIS IS NOT A METHOD ON <c>LicenseVerifier</c>, and it is not a style preference.</b>
/// Measured: <c>LicenseVerifier.Verify(string envelopeJson, out LicensePayload, out string)</c> takes a
/// JSON envelope and returns a <c>LicensePayload</c> — it is envelope-shaped end to end and cannot verify
/// a 200 MB <c>.msi</c>. Bending it to do so would put "this machine is paid for" and "these bytes are
/// ST4I's" behind one type whose own doc comment calls it the trust root of the revenue mechanism. That
/// coupling is how a LICENCE bug becomes a CODE-EXECUTION bug. So this type reuses the PRIMITIVE and the
/// DISCIPLINE — the same BouncyCastle <c>Ed25519Signer</c> already in <c>St4i.EdgeCore.csproj</c>, the
/// same 32/64-byte length constants, the same <c>ArgumentException</c>-on-wrong-length constructor, the
/// same injection seam, the same supported-version refusal, the same verify-bytes-then-parse order — and
/// reuses the CLASS not at all. <b>One signature stack, two keys.</b></para>
///
/// <para>🔴 <b>VERIFY BYTES, PARSE SECOND.</b> The signed bytes are the raw contents of
/// <c>manifest.json</c>, VERBATIM. This class never deserialises to a DTO and re-serialises to check a
/// signature: that would make every bundle in the field depend on JSON whitespace, member ordering and
/// the exact <c>System.Text.Json</c> version, so a framework patch could invalidate every stick ST4I has
/// ever shipped, all at once. Nothing below the <c>VerifySignature</c> call runs unless it returned
/// <see langword="true"/>.</para>
///
/// <para>🔴 <b>A SEPARATE KEY FROM THE LICENCE KEY, by the owner's ruling of 2026-09-06.</b> Three
/// reasons, in order of weight. The licence key's private half was destroyed, so an update path bound to
/// it would be dead on arrival. The licence key must be ROTATED at release, and rotating one key that
/// gates both revenue and code execution means one release step whose failure mode is either "nobody's
/// licence works" or "no machine can be patched" — and you find out which in the field. And blast radius:
/// a leaked licence key costs revenue, a leaked update key costs remote code execution on every machine
/// in every factory. Those do not belong in one secret.</para>
///
/// <para>🔴 <b>NO PRIVATE KEY IS IN THIS REPOSITORY.</b> Only <see cref="EmbeddedPublicKey"/> — 32 bytes.
/// Tests mint a pair in memory and inject its public half through
/// <see cref="UpdateManifestVerifier(byte[])"/>; that seam is the entire reason this class is testable
/// without a secret on disk, and <c>LicensePrivateKeyAbsenceTests</c> parses <c>src/</c> — all of it, not
/// just the licensing namespace — to prove no key-generation call site exists in production code.</para>
///
/// <para><b>What a test of this class must prove.</b> That a WRONG signature is REJECTED — not merely
/// that a right one is accepted. A verifier that returns <see langword="true"/> unconditionally passes
/// every happy-path test ever written against it, so the wrong-key, tampered-manifest and
/// tampered-signature tests are load-bearing here and the accept case is the negative control for THEM.</para>
/// </summary>
public sealed class UpdateManifestVerifier
{
    /// <summary>Ed25519 public keys are exactly this long; anything else is a configuration error rather
    /// than a manifest that happens not to verify.</summary>
    public const int PublicKeyLength = 32;

    /// <summary>Ed25519 signatures are exactly this long.</summary>
    public const int SignatureLength = 64;

    /// <summary>The highest manifest <c>v</c> this build understands. A higher value is a readable
    /// refusal (<see cref="UpdateVerificationState.Unsupported"/>), never a best-effort parse of a format
    /// that may have changed meaning. The exact twin of
    /// <c>LicenseVerifier.SupportedPayloadVersion</c>.</summary>
    public const int SupportedManifestVersion = 1;

    /// <summary>
    /// 🔴🔴 The update-signing PUBLIC key this build verifies against, 32 bytes. <b>The private half is
    /// not in this repository and never will be.</b>
    ///
    /// <para>🔴 <b>THIS IS A TEST KEY, NOT ST4I'S PRODUCTION UPDATE KEY, AND IT MUST BE REPLACED BEFORE
    /// RELEASE.</b> ST4I's real update-signing public key has never been supplied to this repository.
    /// What is here is the public half of a key pair minted out of band on 2026-09-06 — in a throwaway
    /// project in a scratch directory, never in this tree — whose private half was destroyed with the
    /// process and the directory that made it. No copy exists anywhere, including on the machine that ran
    /// it. That is a deliberate property, and it is exactly the pattern the owner ruled for: it lets the
    /// whole update path be built and tested today without anyone holding a signing secret in the
    /// repository.</para>
    ///
    /// <para><b>What this costs.</b> A build carrying this key can verify nothing ST4I signs, so it is
    /// not shippable as-is — replacing this constant is a release step, and
    /// <c>EmbeddedUpdateKeyIsTheTestKeyTests</c> exists to make that step impossible to forget. It is a
    /// SEPARATE release blocker from the licence key's, and that separation is load-bearing: a single
    /// test covering both keys is satisfied by rotating EITHER one, so it could not block the other.</para>
    ///
    /// <para>🔴 Unlike the licence key, replacing this one invalidates nothing already in the field: no
    /// update bundle has ever been signed, because no private half has ever existed for longer than one
    /// process. The swap is free now and stays free until ST4I signs its first bundle.</para>
    /// </summary>
    public static readonly byte[] EmbeddedPublicKey =
    [
        0xBF, 0x99, 0xEC, 0xA7, 0x20, 0xE8, 0xC3, 0x59, 0xD9, 0xF1, 0x9B, 0xAE, 0xE8, 0xA6, 0xA2, 0x78,
        0xFA, 0xFC, 0xCA, 0x4C, 0x1A, 0xB1, 0x75, 0x70, 0xD1, 0x8F, 0x91, 0x93, 0x9D, 0xF8, 0x02, 0xC4,
    ];

    private readonly byte[] _publicKey;

    /// <summary>Verifies against <see cref="EmbeddedPublicKey"/> — the production path.</summary>
    public UpdateManifestVerifier() : this(EmbeddedPublicKey) { }

    /// <summary>
    /// Verifies against a caller-supplied 32-byte Ed25519 public key. 🔴 This is the TEST SEAM, and it is
    /// the reason no private key has to exist in the tree: a fixture mints a pair in memory, signs a test
    /// manifest with the private half and constructs this class with the public half.
    /// </summary>
    /// <param name="publicKey">A 32-byte Ed25519 public key.</param>
    /// <exception cref="ArgumentNullException"><paramref name="publicKey"/> is <see langword="null"/>.</exception>
    /// <exception cref="ArgumentException"><paramref name="publicKey"/> is not
    /// <see cref="PublicKeyLength"/> bytes.</exception>
    public UpdateManifestVerifier(byte[] publicKey)
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
    /// is readable rather than mysterious.</summary>
    public bool KeyIsUnconfigured => _publicKey.All(b => b == 0);

    /// <summary>
    /// Verifies a manifest's signature over its RAW BYTES, then parses it.
    ///
    /// <para>🔴 Order, and it must be this order: decode the signature; <b>verify the manifest bytes
    /// exactly as they were read from disk</b>; only then deserialise. A failure at any step produces a
    /// state and a diagnostic, never an exception — this runs against a file on a USB stick that anyone
    /// on a factory floor could have written.</para>
    /// </summary>
    /// <param name="manifestBytes">The raw bytes of <c>manifest.json</c>, exactly as read from disk.</param>
    /// <param name="signatureB64">The contents of <c>manifest.sig</c> — base64url, padded or not.</param>
    /// <param name="manifest">The parsed manifest when the signature verified, else <see langword="null"/>.</param>
    /// <param name="diagnostic">Engineer-facing detail on failure, else <see langword="null"/>.</param>
    /// <returns><see cref="UpdateVerificationState.Verified"/> when the signature verified and the
    /// manifest parsed at a supported version — <b>this does not mean the bundle is applicable to this
    /// machine</b>, which <see cref="UpdatePreflight"/> decides. Otherwise
    /// <see cref="UpdateVerificationState.Corrupt"/>, <see cref="UpdateVerificationState.Invalid"/> or
    /// <see cref="UpdateVerificationState.Unsupported"/>.</returns>
    public UpdateVerificationState Verify(
        byte[]? manifestBytes, string? signatureB64, out UpdateManifest? manifest, out string? diagnostic)
    {
        manifest = null;
        diagnostic = null;

        if (manifestBytes is null || manifestBytes.Length == 0)
        {
            diagnostic = "The update manifest is empty.";
            return UpdateVerificationState.Corrupt;
        }

        if (string.IsNullOrWhiteSpace(signatureB64))
        {
            diagnostic = "The update bundle carries no signature (manifest.sig is empty or missing).";
            return UpdateVerificationState.Corrupt;
        }

        // 🔴 The SAME base64url decoder the licence envelope uses, reached through the licensing type
        // rather than copied. A second, subtly different decoder is how two formats that were meant to be
        // identical drift apart, and the licensing one is already attacked by its own tests.
        if (!Licensing.LicenseVerifier.TryDecodeBase64Url(signatureB64, out var signatureBytes))
        {
            diagnostic = "The update signature (manifest.sig) is not valid base64url.";
            return UpdateVerificationState.Corrupt;
        }

        if (signatureBytes.Length != SignatureLength)
        {
            // 🔴 A length check, NOT a shortcut past verification: BouncyCastle's verifier would reject a
            // wrong-length signature anyway. This exists only so the diagnostic names the real problem.
            diagnostic =
                $"An Ed25519 signature is {SignatureLength} bytes; this bundle carries {signatureBytes.Length}.";
            return UpdateVerificationState.Invalid;
        }

        if (!VerifySignature(manifestBytes, signatureBytes))
        {
            diagnostic = KeyIsUnconfigured
                ? "This build has no update-signing public key configured " +
                  "(UpdateManifestVerifier.EmbeddedPublicKey is still the all-zero placeholder), so no " +
                  "update bundle can verify against it."
                : "The update manifest's signature is not valid for this product. This bundle was not " +
                  "signed by ST4I, or it has been modified since it was signed. NOTHING has been " +
                  "installed and nothing on this machine has been changed.";
            return UpdateVerificationState.Invalid;
        }

        // ── Nothing above this line trusted the manifest's CONTENT; nothing below it doubts the bytes. ──

        UpdateManifest? parsed;
        try
        {
            parsed = JsonSerializer.Deserialize<UpdateManifest>(Encoding.UTF8.GetString(manifestBytes));
        }
        catch (JsonException ex)
        {
            // A SIGNED manifest that will not parse means ST4I issued something this build cannot read —
            // reported as Corrupt rather than Invalid, because the SIGNATURE was fine and telling an
            // engineer "the signature is bad" would send them down entirely the wrong path.
            diagnostic = $"The update manifest verified but is not valid JSON: {ex.Message}";
            return UpdateVerificationState.Corrupt;
        }

        if (parsed is null)
        {
            diagnostic = "The update manifest verified but decoded to nothing.";
            return UpdateVerificationState.Corrupt;
        }

        if (parsed.V > SupportedManifestVersion)
        {
            diagnostic =
                $"This update bundle is manifest format version {parsed.V}; this build understands up to " +
                $"{SupportedManifestVersion}. Install an intermediate version of the product first, or " +
                "obtain a bundle this version can read.";
            return UpdateVerificationState.Unsupported;
        }

        manifest = parsed;
        return UpdateVerificationState.Verified;
    }

    /// <summary>
    /// The raw Ed25519 check. Separated so tests can attack it directly with a wrong key, a tampered
    /// manifest and a tampered signature, rather than only through the file layer.
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
            // Fail-closed is the only acceptable direction when the question is "may these bytes run".
            return false;
        }
    }
}
