using System.Text;
using St4i.EdgeCore.Updates;
using Xunit;

namespace St4i.EdgeCore.Tests.Updates;

/// <summary>
/// 🔴 WS-F4 Task 2 — attacks on <see cref="UpdateManifestVerifier"/>.
///
/// <para><b>The load-bearing tests here are the REJECTIONS.</b> A verifier that returned
/// <see langword="true"/> unconditionally would pass every happy-path test ever written against it, so
/// the wrong-key, tampered-manifest and tampered-signature cases carry the weight and the accept case is
/// the negative control for THEM, rather than the other way round.</para>
/// </summary>
public sealed class UpdateManifestVerifierTests
{
    /// <summary>A manifest signed by the matching key verifies. 🔴 The NEGATIVE CONTROL for every
    /// rejection below: a verifier that refused everything would pass them all.</summary>
    [Fact]
    public void AManifestSignedByTheMatchingKey_Verifies()
    {
        var (priv, pub) = UpdateTestKit.NewKeyPair();
        var manifestBytes = Encoding.UTF8.GetBytes(
            UpdateTestKit.ManifestJson("x.msi", Encoding.UTF8.GetBytes("payload")));

        var state = new UpdateManifestVerifier(pub).Verify(
            manifestBytes, UpdateTestKit.Base64Url(UpdateTestKit.Sign(manifestBytes, priv)),
            out var manifest, out var diagnostic);

        Assert.Equal(UpdateVerificationState.Verified, state);
        Assert.NotNull(manifest);
        Assert.Null(diagnostic);
        Assert.Equal("st4i-machine-simulator", manifest!.Product);
        Assert.Equal("1.4.0", manifest.Version);
    }

    /// <summary>🔴 A signature from the WRONG key is rejected. The single most important test in this
    /// file: without it, nothing here measures a signature at all.</summary>
    [Fact]
    public void ASignatureFromTheWrongKey_IsRejected()
    {
        var (forger, _) = UpdateTestKit.NewKeyPair();
        var (_, ourKey) = UpdateTestKit.NewKeyPair();
        var manifestBytes = Encoding.UTF8.GetBytes(
            UpdateTestKit.ManifestJson("x.msi", Encoding.UTF8.GetBytes("payload")));

        var state = new UpdateManifestVerifier(ourKey).Verify(
            manifestBytes, UpdateTestKit.Base64Url(UpdateTestKit.Sign(manifestBytes, forger)),
            out var manifest, out _);

        Assert.Equal(UpdateVerificationState.Invalid, state);
        Assert.Null(manifest);
    }

    /// <summary>🔴 A manifest modified after signing is rejected — one byte is enough.</summary>
    [Fact]
    public void AManifestTamperedWithAfterSigning_IsRejected()
    {
        var (priv, pub) = UpdateTestKit.NewKeyPair();
        var manifestBytes = Encoding.UTF8.GetBytes(
            UpdateTestKit.ManifestJson("x.msi", Encoding.UTF8.GetBytes("payload")));
        var signature = UpdateTestKit.Base64Url(UpdateTestKit.Sign(manifestBytes, priv));

        var tampered = (byte[])manifestBytes.Clone();
        tampered[10] ^= 0x01;

        var state = new UpdateManifestVerifier(pub).Verify(tampered, signature, out var manifest, out _);

        Assert.Equal(UpdateVerificationState.Invalid, state);
        Assert.Null(manifest);
    }

    /// <summary>🔴 A tampered SIGNATURE is rejected too — the other half of the pair, since a verifier
    /// could conceivably check the message and ignore the signature.</summary>
    [Fact]
    public void ATamperedSignature_IsRejected()
    {
        var (priv, pub) = UpdateTestKit.NewKeyPair();
        var manifestBytes = Encoding.UTF8.GetBytes(
            UpdateTestKit.ManifestJson("x.msi", Encoding.UTF8.GetBytes("payload")));

        var signature = UpdateTestKit.Sign(manifestBytes, priv);
        signature[5] ^= 0x01;

        var state = new UpdateManifestVerifier(pub).Verify(
            manifestBytes, UpdateTestKit.Base64Url(signature), out var manifest, out _);

        Assert.Equal(UpdateVerificationState.Invalid, state);
        Assert.Null(manifest);
    }

    /// <summary>
    /// 🔴 A manifest from the FUTURE is a readable refusal, not a best-effort parse — the exact
    /// <c>LicenseState.Unsupported</c> pattern, and the same discipline Task 1 gave the ten SQLite
    /// stores. Note the state: the signature DID verify, so this says "ST4I sent this, and this build
    /// cannot read it", which is a different sentence from "this is not ST4I's".
    /// </summary>
    [Fact]
    public void AManifestFromTheFuture_IsUnsupported_NotInvalid()
    {
        var (priv, pub) = UpdateTestKit.NewKeyPair();
        var manifestBytes = Encoding.UTF8.GetBytes(UpdateTestKit.ManifestJson(
            "x.msi", Encoding.UTF8.GetBytes("payload"), v: UpdateManifestVerifier.SupportedManifestVersion + 1));

        var state = new UpdateManifestVerifier(pub).Verify(
            manifestBytes, UpdateTestKit.Base64Url(UpdateTestKit.Sign(manifestBytes, priv)),
            out var manifest, out var diagnostic);

        Assert.Equal(UpdateVerificationState.Unsupported, state);
        Assert.Null(manifest);
        Assert.Contains("understands up to", diagnostic!, StringComparison.Ordinal);
    }

    /// <summary>🔴 A manifest at exactly the supported version is accepted — the boundary control for the
    /// test above, which would also pass on a verifier that refused every version.</summary>
    [Fact]
    public void AManifestAtExactlyTheSupportedVersion_IsAccepted()
    {
        var (priv, pub) = UpdateTestKit.NewKeyPair();
        var manifestBytes = Encoding.UTF8.GetBytes(UpdateTestKit.ManifestJson(
            "x.msi", Encoding.UTF8.GetBytes("payload"), v: UpdateManifestVerifier.SupportedManifestVersion));

        var state = new UpdateManifestVerifier(pub).Verify(
            manifestBytes, UpdateTestKit.Base64Url(UpdateTestKit.Sign(manifestBytes, priv)), out var m, out _);

        Assert.Equal(UpdateVerificationState.Verified, state);
        Assert.NotNull(m);
    }

    /// <summary>Malformed inputs produce a state and a diagnostic, never an exception — this reads a file
    /// anyone on a factory floor could have written.</summary>
    /// <param name="signature">The signature text under test.</param>
    [Theory]
    [InlineData("")]
    [InlineData("   ")]
    [InlineData("not-base64!!!")]
    public void AMalformedSignature_IsCorrupt_AndNeverThrows(string signature)
    {
        var (_, pub) = UpdateTestKit.NewKeyPair();
        var state = new UpdateManifestVerifier(pub).Verify(
            Encoding.UTF8.GetBytes("{}"), signature, out var manifest, out var diagnostic);

        Assert.Equal(UpdateVerificationState.Corrupt, state);
        Assert.Null(manifest);
        Assert.NotNull(diagnostic);
    }

    /// <summary>A signature of the wrong LENGTH is named as such, so the diagnostic points at the real
    /// problem rather than at "the signature did not verify".</summary>
    [Fact]
    public void ASignatureOfTheWrongLength_NamesTheLength()
    {
        var (_, pub) = UpdateTestKit.NewKeyPair();
        var state = new UpdateManifestVerifier(pub).Verify(
            Encoding.UTF8.GetBytes("{}"), UpdateTestKit.Base64Url(new byte[10]), out _, out var diagnostic);

        Assert.Equal(UpdateVerificationState.Invalid, state);
        Assert.Contains("64 bytes", diagnostic!, StringComparison.Ordinal);
        Assert.Contains("10", diagnostic!, StringComparison.Ordinal);
    }

    /// <summary>An empty manifest is Corrupt, and specifically not an exception on a path that reads
    /// removable media.</summary>
    [Fact]
    public void AnEmptyManifest_IsCorrupt()
    {
        var (_, pub) = UpdateTestKit.NewKeyPair();
        Assert.Equal(
            UpdateVerificationState.Corrupt,
            new UpdateManifestVerifier(pub).Verify([], "abc", out _, out _));
    }

    /// <summary>
    /// 🔴 A SIGNED manifest that will not parse as JSON is Corrupt, not Invalid. The distinction is for
    /// the engineer: telling them "the signature is bad" when the signature was fine sends them to
    /// replace the media instead of calling ST4I about a malformed release.
    /// </summary>
    [Fact]
    public void ASignedButUnparseableManifest_IsCorrupt_NotInvalid()
    {
        var (priv, pub) = UpdateTestKit.NewKeyPair();
        var garbage = Encoding.UTF8.GetBytes("{ this is not json ");

        var state = new UpdateManifestVerifier(pub).Verify(
            garbage, UpdateTestKit.Base64Url(UpdateTestKit.Sign(garbage, priv)), out var m, out var diagnostic);

        Assert.Equal(UpdateVerificationState.Corrupt, state);
        Assert.Null(m);
        Assert.Contains("verified but is not valid JSON", diagnostic!, StringComparison.Ordinal);
    }

    /// <summary>A wrong-length public key is a configuration error at construction, not a manifest that
    /// happens not to verify — matching <c>LicenseVerifier</c>'s constructor discipline exactly.</summary>
    [Fact]
    public void AWrongLengthPublicKey_IsRejectedAtConstruction()
    {
        Assert.Throws<ArgumentException>(() => new UpdateManifestVerifier(new byte[31]));
        Assert.Throws<ArgumentException>(() => new UpdateManifestVerifier(new byte[33]));
        Assert.Throws<ArgumentNullException>(() => new UpdateManifestVerifier(null!));
    }

    /// <summary>🔴 The all-zero non-key is reported as unconfigured and verifies nothing — an exception
    /// out of BouncyCastle must be a REJECTION, never a crash and never an acceptance.</summary>
    [Fact]
    public void TheAllZeroNonKey_IsReportedUnconfigured_AndVerifiesNothing()
    {
        var verifier = new UpdateManifestVerifier(new byte[32]);
        Assert.True(verifier.KeyIsUnconfigured);

        var (priv, _) = UpdateTestKit.NewKeyPair();
        var bytes = Encoding.UTF8.GetBytes("{}");
        var state = verifier.Verify(
            bytes, UpdateTestKit.Base64Url(UpdateTestKit.Sign(bytes, priv)), out _, out var diagnostic);

        Assert.Equal(UpdateVerificationState.Invalid, state);
        Assert.Contains("no update-signing public key configured", diagnostic!, StringComparison.Ordinal);
    }

    /// <summary>
    /// 🔴 <b>VERIFY BYTES, PARSE SECOND — demonstrated rather than asserted.</b> Two manifests that are
    /// semantically identical but differ in whitespace produce DIFFERENT signatures, and each signature
    /// validates only against its own bytes.
    ///
    /// <para>That is the property that makes a re-serialising verifier wrong: if this class deserialised
    /// and re-serialised to check a signature, a <c>System.Text.Json</c> patch that changed spacing by one
    /// character would invalidate every bundle ST4I had ever shipped, all at once and in the field.</para>
    /// </summary>
    [Fact]
    public void TheSignatureCoversTheEXACTBytes_NotTheParsedMeaning()
    {
        var (priv, pub) = UpdateTestKit.NewKeyPair();
        var verifier = new UpdateManifestVerifier(pub);

        var compact = Encoding.UTF8.GetBytes("""{"v":1,"product":"st4i-machine-simulator"}""");
        var spaced = Encoding.UTF8.GetBytes("""{ "v": 1, "product": "st4i-machine-simulator" }""");

        var compactSig = UpdateTestKit.Base64Url(UpdateTestKit.Sign(compact, priv));

        // Same meaning, different bytes: the compact signature does NOT validate the spaced form.
        Assert.Equal(UpdateVerificationState.Verified, verifier.Verify(compact, compactSig, out _, out _));
        Assert.Equal(UpdateVerificationState.Invalid, verifier.Verify(spaced, compactSig, out _, out _));
    }
}
