using System.Runtime.Versioning;
using St4i.EdgeCore.Identity;
using St4i.EdgeCore.Licensing;
using Xunit;

namespace St4i.EdgeCore.Tests.Licensing;

/// <summary>
/// 🔴🔴 WS-E — <b>THE UNBOUND BINDING MODE, PINNED FROM BOTH DIRECTIONS.</b>
///
/// <para>Owner ruling 2026-09-06 (round 2): the relaxed fingerprint binding that lets the end-to-end
/// fixture run must be <b>an explicitly named mode with its own test, never a silent branch</b> — because
/// "an unbound licence that is accepted quietly is a back door with a friendly name".</para>
///
/// <para><b>Both directions, because either alone is satisfiable by the wrong thing.</b> Proving that an
/// unbound licence is accepted would also pass if the fingerprint check did nothing at all — that is the
/// back door, and it is why <see cref="A_bound_licence_still_refuses_the_wrong_machine"/> is the
/// load-bearing test here rather than an afterthought. Proving that a bound licence refuses would pass on
/// a verifier that refused everything, so the unbound case is that test's own control.</para>
///
/// <para><b>And the reachability half.</b> The mode must not be arrivable by accident. Every near-miss a
/// real payload could plausibly carry — absent policy, absent mode, empty, whitespace, wrong case, padded,
/// a plausible synonym, and the old <c>required: 0</c> shape this replaced — must land on
/// <see cref="LicenseBindingMode.Machine"/>, i.e. still bound.</para>
/// </summary>
[SupportedOSPlatform("windows")]
public sealed class UnboundBindingModeTests : IDisposable
{
    private readonly string _identityDir;
    private readonly DeviceIdentityStore _identityStore;
    private readonly (Org.BouncyCastle.Crypto.Parameters.Ed25519PrivateKeyParameters Private, byte[] PublicKey) _key;
    private readonly LicenseVerifier _verifier;

    /// <summary>Throwaway identity root, so nothing touches the real %ProgramData%.</summary>
    public UnboundBindingModeTests()
    {
        _identityDir = Path.Combine(Path.GetTempPath(), "st4i-unbound-tests", Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(_identityDir);
        _identityStore = new DeviceIdentityStore(_identityDir, (_, _) => { });
        _key = LicenseTestKit.NewKeyPair();
        _verifier = new LicenseVerifier(_key.PublicKey);
    }

    /// <summary>Removes the throwaway root.</summary>
    public void Dispose()
    {
        try { Directory.Delete(_identityDir, recursive: true); } catch (IOException) { /* best effort */ }
    }

    /// <summary>A fingerprint that matches no real machine — four components of pure nonsense.</summary>
    private static LicenseFingerprint AnotherMachine() =>
        new("not-this-machine-1", "not-this-machine-2", "not-this-machine-3", "not-this-machine-4");

    // ══════════════════════════════════════════════════════════════════════════════════════════════
    // 🔴🔴 THE LOAD-BEARING HALF — a BOUND licence still refuses a wrong machine
    // ══════════════════════════════════════════════════════════════════════════════════════════════

    /// <summary>
    /// 🔴🔴 <b>THE TEST THAT STOPS THE UNBOUND MODE BEING A BACK DOOR.</b> A licence bound to a DIFFERENT
    /// machine must still be refused with <see cref="LicenseState.WrongMachine"/> after the unbound mode
    /// exists. If this ever goes green-by-accident, the fingerprint check has stopped working and every
    /// "unbound is accepted" test in this file would go on passing while the product gave its paid
    /// features to anyone holding any licence.
    /// </summary>
    [Fact]
    public void A_bound_licence_still_refuses_the_wrong_machine()
    {
        var envelope = LicenseTestKit.SignedEnvelope(
            LicenseTestKit.Payload(edition: "Machine", fingerprint: AnotherMachine()), _key.Private);

        var result = LicenseEvaluator.Evaluate(
            envelope, _verifier, _identityStore, new DateTimeOffset(2026, 6, 1, 0, 0, 0, TimeSpan.Zero), null);

        Assert.Equal(LicenseState.WrongMachine, result.State);
        Assert.False(result.Features.Contains(LicenseFeatures.HmiAuthoring));

        // Still a WORKING machine — the boundary holds even here.
        Assert.True(result.Features.Contains(LicenseFeatures.HmiApi));
    }

    /// <summary>
    /// 🔴 And the same wrong-machine licence is STILL refused when it carries an unrecognised mode string.
    /// A future mode name must not loosen an old build: anything this build does not recognise is bound.
    /// </summary>
    [Fact]
    public void An_unrecognised_mode_does_not_loosen_a_bound_licence()
    {
        var envelope = LicenseTestKit.SignedEnvelope(
            LicenseTestKit.Payload(
                edition: "Machine", fingerprint: AnotherMachine(), bindingMode: "some-future-mode"),
            _key.Private);

        var result = LicenseEvaluator.Evaluate(
            envelope, _verifier, _identityStore, new DateTimeOffset(2026, 6, 1, 0, 0, 0, TimeSpan.Zero), null);

        Assert.Equal(LicenseState.WrongMachine, result.State);
    }

    // ══════════════════════════════════════════════════════════════════════════════════════════════
    // THE MODE ITSELF — and it is the CONTROL for the two tests above
    // ══════════════════════════════════════════════════════════════════════════════════════════════

    /// <summary>
    /// 🔴 The named unbound mode is honoured: a licence bound to a completely different machine is
    /// accepted when — and only when — its SIGNED payload says <c>unbound-test-only</c> in words.
    ///
    /// <para>This is also the negative control for the two tests above: without it, a fingerprint check
    /// that refused every licence unconditionally would pass both of them.</para>
    /// </summary>
    [Fact]
    public void An_explicitly_unbound_licence_is_accepted_on_any_machine()
    {
        var envelope = LicenseTestKit.SignedEnvelope(
            LicenseTestKit.Payload(
                edition: "Site-Connected",
                fingerprint: AnotherMachine(),
                bindingMode: LicenseBindingMode.Unbound),
            _key.Private);

        var result = LicenseEvaluator.Evaluate(
            envelope, _verifier, _identityStore, new DateTimeOffset(2026, 6, 1, 0, 0, 0, TimeSpan.Zero), null);

        Assert.Equal(LicenseState.Valid, result.State);
        Assert.True(result.Features.Contains(LicenseFeatures.HmiAuthoring));
    }

    /// <summary>
    /// 🔴 <b>THE MODE IS INSIDE THE SIGNATURE.</b> Editing a bound licence's payload to add the unbound
    /// mode breaks the signature, so a customer cannot unbind their own licence — only ST4I can mint one.
    /// This is what makes the mode a controlled artefact rather than a flag anybody can set.
    /// </summary>
    [Fact]
    public void Editing_a_bound_licence_into_an_unbound_one_breaks_the_signature()
    {
        var boundBytes = LicenseTestKit.PayloadBytes(
            LicenseTestKit.Payload(edition: "Machine", fingerprint: AnotherMachine()));
        var genuineSignature = LicenseTestKit.Sign(boundBytes, _key.Private);

        // The attack: keep ST4I's genuine signature, edit the payload to claim the unbound mode.
        var tampered = System.Text.Encoding.UTF8.GetBytes(
            System.Text.Encoding.UTF8.GetString(boundBytes)
                .Replace($"\"mode\":\"{LicenseBindingMode.Machine}\"",
                         $"\"mode\":\"{LicenseBindingMode.Unbound}\"", StringComparison.Ordinal));
        Assert.NotEqual(Convert.ToHexString(boundBytes), Convert.ToHexString(tampered)); // the edit landed

        var result = LicenseEvaluator.Evaluate(
            LicenseTestKit.Envelope(tampered, genuineSignature), _verifier, _identityStore,
            new DateTimeOffset(2026, 6, 1, 0, 0, 0, TimeSpan.Zero), null);

        Assert.Equal(LicenseState.Invalid, result.State);
        Assert.False(result.Features.Contains(LicenseFeatures.HmiAuthoring));
    }

    // ══════════════════════════════════════════════════════════════════════════════════════════════
    // REACHABILITY — the mode must not be arrivable by accident
    // ══════════════════════════════════════════════════════════════════════════════════════════════

    /// <summary>
    /// 🔴 <b>THE UNBOUND MODE CANNOT BE REACHED BY ACCIDENT.</b> Every near-miss a real payload could
    /// plausibly carry resolves to BOUND. Case matters, whitespace matters, and a plausible synonym is not
    /// the name — because every string that unbinds a licence is a string an attacker or a careless
    /// issuer can aim at, and this is the one place in the product where a narrower match is safer.
    /// </summary>
    /// <param name="mode">The mode string a payload might carry.</param>
    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData("   ")]
    [InlineData("machine")]
    [InlineData("Machine")]
    [InlineData("unbound")]
    [InlineData("Unbound-Test-Only")]
    [InlineData("UNBOUND-TEST-ONLY")]
    [InlineData(" unbound-test-only")]
    [InlineData("unbound-test-only ")]
    [InlineData("unbound_test_only")]
    [InlineData("test-only")]
    [InlineData("none")]
    [InlineData("any")]
    public void No_near_miss_reaches_the_unbound_mode(string? mode)
    {
        var policy = new LicenseFingerprintPolicy(3, MachineFingerprint.ComponentNames, mode);
        Assert.False(LicenseBindingMode.IsUnbound(policy),
            $"The mode string {mode ?? "(null)"} unbound a licence. Only the exact ordinal string " +
            $"\"{LicenseBindingMode.Unbound}\" may, or the named mode stops being a named mode.");
    }

    /// <summary>🔴 A null POLICY — the shape most payloads that predate this mode will have — is bound.</summary>
    [Fact]
    public void A_missing_policy_is_bound()
    {
        Assert.False(LicenseBindingMode.IsUnbound(null));
    }

    /// <summary>
    /// 🔴 <b>POSITIVE CONTROL for the reachability theory above.</b> Every case in it asserts
    /// <see langword="false"/>, which a predicate hardwired to <see langword="false"/> would also satisfy —
    /// and that predicate would silently make the e2e licence stop working rather than fail loudly. This
    /// proves the exact string does unbind.
    /// </summary>
    [Fact]
    public void The_exact_mode_string_does_unbind()
    {
        Assert.True(LicenseBindingMode.IsUnbound(
            new LicenseFingerprintPolicy(3, MachineFingerprint.ComponentNames, LicenseBindingMode.Unbound)));
    }

    /// <summary>
    /// 🔴 The old <c>required: 0</c> shape this mode REPLACED does not unbind anything. That was the
    /// silent branch the owner refused: a threshold of zero looks like a number and behaves like a policy.
    /// It is now clamped to 1 and is not a way in.
    /// </summary>
    [Fact]
    public void A_zero_threshold_is_not_a_way_to_unbind()
    {
        var policy = new LicenseFingerprintPolicy(0, MachineFingerprint.ComponentNames, null);

        Assert.False(LicenseBindingMode.IsUnbound(policy));
        Assert.Equal(1, MachineFingerprint.RequiredMatches(policy));

        // And end to end: a wrong-machine licence with required:0 is still refused.
        var envelope = LicenseTestKit.SignedEnvelope(
            LicenseTestKit.Payload(fingerprint: AnotherMachine(), required: 0), _key.Private);

        var result = LicenseEvaluator.Evaluate(
            envelope, _verifier, _identityStore, new DateTimeOffset(2026, 6, 1, 0, 0, 0, TimeSpan.Zero), null);

        Assert.Equal(LicenseState.WrongMachine, result.State);
    }

    /// <summary>The two mode names are the exact strings the issuing side and the e2e seed depend on.
    /// Pinned so a rename cannot silently orphan a signed licence already in the tree.</summary>
    [Fact]
    public void The_mode_names_are_exactly_these()
    {
        Assert.Equal("machine", LicenseBindingMode.Machine);
        Assert.Equal("unbound-test-only", LicenseBindingMode.Unbound);
    }
}
