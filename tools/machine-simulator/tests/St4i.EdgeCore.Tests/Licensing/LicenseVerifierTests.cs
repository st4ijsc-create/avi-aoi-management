using System.Text;
using St4i.EdgeCore.Licensing;
using Xunit;

namespace St4i.EdgeCore.Tests.Licensing;

/// <summary>
/// 🔴🔴 WS-E — <b>the trust root of the revenue mechanism, attacked rather than demonstrated.</b>
///
/// <para><b>The rule these tests are built around.</b> A verifier that returns <see langword="true"/>
/// unconditionally passes every happy-path test ever written against it. So the load-bearing tests here
/// are the REJECTIONS — a wrong key, a tampered payload, a tampered signature, a swapped signature — and
/// the acceptance test is their NEGATIVE CONTROL, not the other way round: without it, a verifier that
/// rejected everything would also pass every rejection test, and the suite would be equally blind in the
/// opposite direction.</para>
///
/// <para>🔴 <b>No private key is in this repository.</b> Every key pair below is generated in memory by
/// <see cref="LicenseTestKit"/> and dies with the test method. The verifier is constructed with the
/// public half through <see cref="LicenseVerifier(byte[])"/> — the seam that exists precisely so this
/// class is testable without a secret on disk.</para>
/// </summary>
public sealed class LicenseVerifierTests
{
    // ══════════════════════════════════════════════════════════════════════════════════════════════
    // THE LOAD-BEARING REJECTIONS
    // ══════════════════════════════════════════════════════════════════════════════════════════════

    /// <summary>
    /// 🔴🔴 <b>THE TEST PROVING A WRONG SIGNATURE IS REJECTED.</b> A licence signed by a DIFFERENT,
    /// perfectly valid Ed25519 key — i.e. a genuinely well-formed signature that simply is not ST4I's —
    /// must not verify. This is what stops anybody with a keyboard minting their own licences.
    /// </summary>
    [Fact]
    public void A_signature_from_the_wrong_key_is_rejected()
    {
        var st4i = LicenseTestKit.NewKeyPair();
        var forger = LicenseTestKit.NewKeyPair();

        // Signed by the forger; the appliance verifies against ST4I's public key.
        var envelope = LicenseTestKit.SignedEnvelope(LicenseTestKit.Payload(), forger.Private);
        var verifier = new LicenseVerifier(st4i.PublicKey);

        var state = verifier.Verify(envelope, out var payload, out var diagnostic);

        Assert.Equal(LicenseState.Invalid, state);
        Assert.Null(payload); // 🔴 a non-null payload would mean unverified content reached a caller
        Assert.NotNull(diagnostic);
    }

    /// <summary>
    /// 🔴 A payload edited after signing — the "change my expiry date" attack — must be rejected. The
    /// signature is genuine and ST4I's own; only the bytes it covers have changed.
    /// </summary>
    [Fact]
    public void A_payload_tampered_with_after_signing_is_rejected()
    {
        var st4i = LicenseTestKit.NewKeyPair();

        var original = LicenseTestKit.PayloadBytes(
            LicenseTestKit.Payload(expiresAtUtc: new DateTimeOffset(2026, 1, 1, 0, 0, 0, TimeSpan.Zero)));
        var signature = LicenseTestKit.Sign(original, st4i.Private);

        // Genuine signature, edited payload: push the expiry out by a decade.
        var tampered = Encoding.UTF8.GetBytes(
            Encoding.UTF8.GetString(original).Replace("2026-01-01", "2036-01-01", StringComparison.Ordinal));
        Assert.NotEqual(Convert.ToHexString(original), Convert.ToHexString(tampered)); // the edit landed

        var state = new LicenseVerifier(st4i.PublicKey)
            .Verify(LicenseTestKit.Envelope(tampered, signature), out var payload, out _);

        Assert.Equal(LicenseState.Invalid, state);
        Assert.Null(payload);
    }

    /// <summary>🔴 A signature with a single flipped bit must be rejected.</summary>
    [Fact]
    public void A_signature_with_one_flipped_bit_is_rejected()
    {
        var st4i = LicenseTestKit.NewKeyPair();
        var bytes = LicenseTestKit.PayloadBytes(LicenseTestKit.Payload());
        var signature = LicenseTestKit.Sign(bytes, st4i.Private);

        signature[0] ^= 0x01;

        var state = new LicenseVerifier(st4i.PublicKey)
            .Verify(LicenseTestKit.Envelope(bytes, signature), out var payload, out _);

        Assert.Equal(LicenseState.Invalid, state);
        Assert.Null(payload);
    }

    /// <summary>
    /// 🔴 A signature lifted from ANOTHER licence signed by the same real key must not validate this one —
    /// the cut-and-paste attack, which a verifier that only checked "is this a well-formed signature by
    /// ST4I" rather than "over THESE bytes" would let through.
    /// </summary>
    [Fact]
    public void A_valid_signature_over_a_different_payload_is_rejected()
    {
        var st4i = LicenseTestKit.NewKeyPair();

        var machineBytes = LicenseTestKit.PayloadBytes(LicenseTestKit.Payload(edition: "Machine"));
        var siteBytes = LicenseTestKit.PayloadBytes(LicenseTestKit.Payload(edition: "Site-Connected"));
        var siteSignature = LicenseTestKit.Sign(siteBytes, st4i.Private);

        var state = new LicenseVerifier(st4i.PublicKey)
            .Verify(LicenseTestKit.Envelope(machineBytes, siteSignature), out var payload, out _);

        Assert.Equal(LicenseState.Invalid, state);
        Assert.Null(payload);
    }

    /// <summary>
    /// 🔴 An all-zero non-key must reject every licence and SAY SO readably — never accept anything, and
    /// never throw on a startup path. BouncyCastle will not verify against a point of all zeroes, and the
    /// diagnostic must name the unconfigured key rather than blaming the licence.
    ///
    /// <para>📎 This tested <see cref="LicenseVerifier.EmbeddedPublicKey"/> itself until WS-E's e2e
    /// licence landed, because the embedded key WAS all zeroes then. It now holds a real (test) key, so
    /// the zero key is constructed explicitly here. The property is unchanged and still worth pinning:
    /// this is the state a half-configured build lands in, and it must be readable.</para>
    /// </summary>
    [Fact]
    public void An_all_zero_non_key_rejects_everything_and_says_so()
    {
        var signer = LicenseTestKit.NewKeyPair();
        var envelope = LicenseTestKit.SignedEnvelope(LicenseTestKit.Payload(), signer.Private);

        var verifier = new LicenseVerifier(new byte[LicenseVerifier.PublicKeyLength]);
        Assert.True(verifier.KeyIsUnconfigured);

        var state = verifier.Verify(envelope, out var payload, out var diagnostic);

        Assert.Equal(LicenseState.Invalid, state);
        Assert.Null(payload);
        Assert.Contains("public key", diagnostic, StringComparison.OrdinalIgnoreCase);
    }

    // ══════════════════════════════════════════════════════════════════════════════════════════════
    // THE NEGATIVE CONTROL FOR ALL OF THE ABOVE
    // ══════════════════════════════════════════════════════════════════════════════════════════════

    /// <summary>
    /// 🔴 <b>THE NEGATIVE CONTROL.</b> Every test above asserts a REJECTION, and a verifier that rejected
    /// everything unconditionally would pass all of them. This proves the verifier can still say yes to
    /// the real thing — so the rejections above are discrimination rather than blanket refusal.
    /// </summary>
    [Fact]
    public void A_correctly_signed_licence_is_accepted()
    {
        var st4i = LicenseTestKit.NewKeyPair();
        var envelope = LicenseTestKit.SignedEnvelope(LicenseTestKit.Payload(edition: "Machine"), st4i.Private);

        var state = new LicenseVerifier(st4i.PublicKey).Verify(envelope, out var payload, out var diagnostic);

        Assert.Equal(LicenseState.Valid, state);
        Assert.NotNull(payload);
        Assert.Equal("Machine", payload!.Edition);
        Assert.Null(diagnostic);
    }

    // ══════════════════════════════════════════════════════════════════════════════════════════════
    // STRUCTURE — the canonical-bytes rule, and the malformed-input states
    // ══════════════════════════════════════════════════════════════════════════════════════════════

    /// <summary>
    /// 🔴🔴 <b>THE CANONICAL-BYTES RULE, PINNED.</b> The signature covers the base64url-decoded payload
    /// bytes VERBATIM, never a re-serialisation of the parsed object. This signs a payload whose JSON
    /// carries whitespace and a member order that <c>System.Text.Json</c> would never emit for the DTO —
    /// so a verifier that deserialised and re-serialised before checking would fail this, while the
    /// correct one passes. That failure mode matters because it would be a FLEET-WIDE outage triggered by
    /// a framework patch, not a single bad licence.
    /// </summary>
    [Fact]
    public void The_signature_covers_the_raw_bytes_not_a_reserialisation()
    {
        var st4i = LicenseTestKit.NewKeyPair();

        // Deliberately non-canonical: pretty-printed, members in an order the record would not emit, and
        // a member the DTO does not declare at all.
        const string oddlyFormatted = """
            {
                "notes"       : "PO 4500123987",
                "seats": 1,
                "unknownFutureMember": {"nested": [1, 2, 3]},
                "graceDays" :   30,
                "edition":"Machine",
                "customer" : "Acme Precision Co., Ltd.",
                "licenseId": "ST4I-2026-000137",
                "v":1
            }
            """;

        var bytes = Encoding.UTF8.GetBytes(oddlyFormatted);
        var envelope = LicenseTestKit.Envelope(bytes, LicenseTestKit.Sign(bytes, st4i.Private));

        var state = new LicenseVerifier(st4i.PublicKey).Verify(envelope, out var payload, out _);

        Assert.Equal(LicenseState.Valid, state);
        Assert.NotNull(payload);
        Assert.Equal("Machine", payload!.Edition);
        Assert.Equal("ST4I-2026-000137", payload.LicenseId);
    }

    /// <summary>A payload version newer than this build understands is a READABLE REFUSAL, not a
    /// mis-parse — which is the whole reason <c>v</c> is in the payload.</summary>
    [Fact]
    public void A_future_payload_version_is_unsupported_rather_than_misparsed()
    {
        var st4i = LicenseTestKit.NewKeyPair();
        var envelope = LicenseTestKit.SignedEnvelope(
            LicenseTestKit.Payload(v: LicenseVerifier.SupportedPayloadVersion + 1), st4i.Private);

        var state = new LicenseVerifier(st4i.PublicKey).Verify(envelope, out var payload, out var diagnostic);

        Assert.Equal(LicenseState.Unsupported, state);
        Assert.Null(payload);
        Assert.Contains("newer version", diagnostic, StringComparison.OrdinalIgnoreCase);
    }

    /// <summary>Malformed input never throws — this runs on a startup path and the file is
    /// attacker-influenced.</summary>
    /// <param name="input">The malformed envelope.</param>
    [Theory]
    [InlineData("")]
    [InlineData("   ")]
    [InlineData("not json at all")]
    [InlineData("{}")]
    [InlineData("""{"payload":"!!!not base64!!!","signature":"AAAA"}""")]
    [InlineData("""{"payload":"eyJ2IjoxfQ"}""")]
    [InlineData("[1,2,3]")]
    public void Malformed_input_produces_a_state_never_an_exception(string input)
    {
        var st4i = LicenseTestKit.NewKeyPair();
        var verifier = new LicenseVerifier(st4i.PublicKey);

        var state = verifier.Verify(input, out var payload, out var diagnostic);

        Assert.True(state is LicenseState.Corrupt or LicenseState.Invalid,
            $"Malformed input produced {state}; expected Corrupt or Invalid.");
        Assert.Null(payload);
        Assert.NotNull(diagnostic);
    }

    /// <summary>A signature of the wrong LENGTH is refused with a diagnostic that names the real problem
    /// rather than "not valid for this product", which would send an engineer hunting the wrong thing.</summary>
    [Fact]
    public void A_wrong_length_signature_is_refused_with_a_length_diagnostic()
    {
        var st4i = LicenseTestKit.NewKeyPair();
        var bytes = LicenseTestKit.PayloadBytes(LicenseTestKit.Payload());

        var state = new LicenseVerifier(st4i.PublicKey)
            .Verify(LicenseTestKit.Envelope(bytes, [1, 2, 3]), out var payload, out var diagnostic);

        Assert.Equal(LicenseState.Invalid, state);
        Assert.Null(payload);
        Assert.Contains("64 bytes", diagnostic, StringComparison.OrdinalIgnoreCase);
    }

    /// <summary>A public key of the wrong size is a CONFIGURATION error and must be loud, not a licence
    /// that quietly never verifies.</summary>
    [Fact]
    public void A_public_key_of_the_wrong_length_is_rejected_at_construction()
    {
        Assert.Throws<ArgumentException>(() => new LicenseVerifier(new byte[31]));
        Assert.Throws<ArgumentException>(() => new LicenseVerifier(new byte[33]));
        Assert.Throws<ArgumentNullException>(() => new LicenseVerifier(null!));
    }

    /// <summary>The owner's measured facts, re-measured here so they are pinned rather than remembered:
    /// an Ed25519 public key is 32 bytes and a signature is 64.</summary>
    [Fact]
    public void Ed25519_key_and_signature_sizes_are_what_the_design_assumed()
    {
        var pair = LicenseTestKit.NewKeyPair();
        Assert.Equal(32, pair.PublicKey.Length);
        Assert.Equal(64, LicenseTestKit.Sign(Encoding.UTF8.GetBytes("x"), pair.Private).Length);
        Assert.Equal(32, LicenseVerifier.PublicKeyLength);
        Assert.Equal(64, LicenseVerifier.SignatureLength);
    }

    /// <summary>base64url round-trips, including the padding-free forms the envelope carries.</summary>
    [Fact]
    public void Base64Url_roundtrips_and_refuses_impossible_lengths()
    {
        foreach (var length in new[] { 1, 2, 3, 31, 32, 64, 100 })
        {
            var bytes = new byte[length];
            Random.Shared.NextBytes(bytes);

            var encoded = LicenseVerifier.EncodeBase64Url(bytes);
            Assert.DoesNotContain('=', encoded);
            Assert.DoesNotContain('+', encoded);
            Assert.DoesNotContain('/', encoded);

            Assert.True(LicenseVerifier.TryDecodeBase64Url(encoded, out var decoded));
            Assert.Equal(bytes, decoded);
        }

        // A length ≡ 1 (mod 4) can never be valid base64.
        Assert.False(LicenseVerifier.TryDecodeBase64Url("AAAAA", out _));
    }
}
