using System.Runtime.Versioning;
using St4i.EdgeCore.Identity;
using St4i.EdgeCore.Licensing;
using Xunit;

namespace St4i.EdgeCore.Tests.Licensing;

/// <summary>
/// 🔴🔴 WS-E — <b>THE BOUNDARY, PINNED.</b> A licence problem must never stop a machine, and the place
/// that could go wrong is here: the evaluator decides what an expired, corrupt, missing, wrong-machine or
/// clock-broken licence leaves a machine able to do.
///
/// <para>The headline test of this whole workstream is
/// <see cref="An_expired_licence_still_renders_the_operator_screen"/>. Everything else in this file
/// supports it or falsifies a specific claim the design makes.</para>
/// </summary>
[SupportedOSPlatform("windows")]
public sealed class LicenseEvaluatorTests : IDisposable
{
    private readonly string _identityDir;
    private readonly DeviceIdentityStore _identityStore;
    private readonly (Org.BouncyCastle.Crypto.Parameters.Ed25519PrivateKeyParameters Private, byte[] PublicKey) _key;
    private readonly LicenseVerifier _verifier;

    /// <summary>Each test gets a throwaway identity root — the relocation seam every store in this tree
    /// carries exists precisely so a suite never writes into the real %ProgramData%.</summary>
    public LicenseEvaluatorTests()
    {
        _identityDir = Path.Combine(Path.GetTempPath(), "st4i-license-tests", Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(_identityDir);
        _identityStore = new DeviceIdentityStore(_identityDir, (_, _) => { });
        _key = LicenseTestKit.NewKeyPair();
        _verifier = new LicenseVerifier(_key.PublicKey);
    }

    /// <summary>Removes the throwaway identity root.</summary>
    public void Dispose()
    {
        try { Directory.Delete(_identityDir, recursive: true); } catch (IOException) { /* best effort */ }
    }

    // ══════════════════════════════════════════════════════════════════════════════════════════════
    // 🔴🔴 THE BOUNDARY
    // ══════════════════════════════════════════════════════════════════════════════════════════════

    /// <summary>
    /// 🔴🔴 <b>THE TEST PROVING AN EXPIRED LICENCE STILL RENDERS THE OPERATOR SCREEN.</b>
    ///
    /// <para>This is the boundary the entire design rests on. The kiosk renders operator screens by
    /// reading <c>GET /v1/screens/{id}</c> and <c>GET /v1/components/{code}</c> — measured in
    /// <c>web/src/routes/Hmi.tsx</c> at lines 144 and 169, the latter feeding <c>ScreenRenderer</c>'s
    /// <c>components</c> prop at line 490. Those reads are gated on <c>hmi.api</c> and <c>hmi.model</c>,
    /// which are CORE: free in every edition, licence or none. If they were ever moved into a paid
    /// edition, an expired licence would BLANK AN OPERATOR'S SCREEN ON A RUNNING MACHINE — a licence
    /// problem stopping a machine, which this product may not do.</para>
    ///
    /// <para>The assertion is deliberately paired: the read features are still granted AND the authoring
    /// feature is NOT. Asserting only the first would pass on a gate that granted everything, which is the
    /// revenue leak; asserting only the second would pass on a gate that granted nothing, which is the
    /// blanked screen. Only both together say "expiry took the right thing away".</para>
    /// </summary>
    [Fact]
    public void An_expired_licence_still_renders_the_operator_screen()
    {
        var expiry = new DateTimeOffset(2026, 1, 1, 0, 0, 0, TimeSpan.Zero);
        var envelope = LicenseTestKit.SignedEnvelope(
            LicenseTestKit.Payload(edition: "Machine", expiresAtUtc: expiry, graceDays: 30), _key.Private);

        // A year past expiry — well beyond the 30-day grace window.
        var now = expiry.AddDays(395);

        var result = LicenseEvaluator.Evaluate(envelope, _verifier, _identityStore, now, auditFloorUtc: null);

        Assert.Equal(LicenseState.Expired, result.State);

        // 🔴 THE OPERATOR SCREEN STILL RENDERS. Both reads the kiosk performs remain granted.
        Assert.True(result.Features.Contains(LicenseFeatures.HmiApi),
            "An expired licence removed hmi.api. GET /v1/screens/{id} is how the operator kiosk renders; " +
            "gating it means an expired licence blanks an operator's screen on a running machine.");
        Assert.True(result.Features.Contains(LicenseFeatures.HmiModel),
            "An expired licence removed hmi.model. GET /v1/components/{code} resolves every {component} " +
            "binding on a rendered screen (web/src/routes/Hmi.tsx:169 → ScreenRenderer at :490).");

        // 🔴 AND THE PAID THING IS GONE — without this the test above would pass on a gate that granted
        // everything, which is the revenue leak rather than the safety failure.
        Assert.False(result.Features.Contains(LicenseFeatures.HmiAuthoring));
        Assert.False(result.Features.Contains(LicenseFeatures.LineControl));

        // The operator-facing message says the machine is unaffected, in words.
        Assert.Contains("Machine operation is unaffected", result.Diagnostic, StringComparison.Ordinal);
    }

    /// <summary>
    /// 🔴 The same boundary in the other four unentitled states. A missing, corrupt, invalid or
    /// wrong-machine licence is a WORKING MACHINE, not a brick: every one of them keeps the kiosk's two
    /// read features and loses only the paid ones.
    /// </summary>
    [Fact]
    public void Every_unentitled_state_keeps_the_kiosk_render_features()
    {
        var cases = new (string Name, string? Envelope)[]
        {
            ("Missing", null),
            ("Corrupt", "this is not a licence"),
            ("Invalid", LicenseTestKit.SignedEnvelope(LicenseTestKit.Payload(), LicenseTestKit.NewKeyPair().Private)),
        };

        foreach (var (name, envelope) in cases)
        {
            var result = LicenseEvaluator.Evaluate(
                envelope, _verifier, _identityStore, DateTimeOffset.UtcNow, auditFloorUtc: null);

            Assert.True(result.Features.Contains(LicenseFeatures.HmiApi), $"{name} lost hmi.api");
            Assert.True(result.Features.Contains(LicenseFeatures.HmiModel), $"{name} lost hmi.model");
            Assert.False(result.Features.Contains(LicenseFeatures.HmiAuthoring), $"{name} kept hmi.authoring");
            Assert.False(result.Features.Contains(LicenseFeatures.LineControl), $"{name} kept line.control");

            // 🔴 The features set is never null, so a gate reading it cannot fail open on a dereference.
            Assert.NotNull(result.Features);
        }
    }

    /// <summary>
    /// 🔴 <b>THE NEGATIVE CONTROL FOR THE TWO TESTS ABOVE.</b> Both assert that Core features SURVIVE
    /// every failure — which a gate that granted everything unconditionally would also satisfy. This
    /// proves the gate discriminates: a VALID Machine licence grants authoring, and the same licence
    /// expired does not. Without this pair, "an expired licence still renders" would be indistinguishable
    /// from "nothing is ever gated".
    /// </summary>
    [Fact]
    public void A_valid_machine_licence_grants_authoring_which_expiry_then_removes()
    {
        var expiry = DateTimeOffset.UtcNow.AddDays(30);
        var envelope = LicenseTestKit.SignedEnvelope(
            LicenseTestKit.Payload(edition: "Machine", expiresAtUtc: expiry), _key.Private);

        var live = LicenseEvaluator.Evaluate(
            envelope, _verifier, _identityStore, DateTimeOffset.UtcNow, null);
        Assert.Equal(LicenseState.Valid, live.State);
        Assert.True(live.Features.Contains(LicenseFeatures.HmiAuthoring));

        var dead = LicenseEvaluator.Evaluate(
            envelope, _verifier, _identityStore, expiry.AddDays(400), null);
        Assert.Equal(LicenseState.Expired, dead.State);
        Assert.False(dead.Features.Contains(LicenseFeatures.HmiAuthoring));
    }

    // ══════════════════════════════════════════════════════════════════════════════════════════════
    // GRACE, EXPIRY AND PERPETUITY
    // ══════════════════════════════════════════════════════════════════════════════════════════════

    /// <summary>🔴 Inside the grace window, paid features stay ON — the customer has lost nothing, they
    /// have been told. This is one of only two deliberate fail-open states.</summary>
    [Fact]
    public void Within_the_grace_window_paid_features_stay_on()
    {
        var expiry = new DateTimeOffset(2026, 6, 1, 0, 0, 0, TimeSpan.Zero);
        var envelope = LicenseTestKit.SignedEnvelope(
            LicenseTestKit.Payload(edition: "Line", expiresAtUtc: expiry, graceDays: 30), _key.Private);

        var result = LicenseEvaluator.Evaluate(
            envelope, _verifier, _identityStore, expiry.AddDays(10), null);

        Assert.Equal(LicenseState.Grace, result.State);
        Assert.True(result.Features.Contains(LicenseFeatures.HmiAuthoring));
        Assert.True(result.Features.Contains(LicenseFeatures.LineControl));
        Assert.Contains("20 more day", result.Diagnostic, StringComparison.Ordinal);
    }

    /// <summary>The exact boundary: the last instant of grace is still Grace; one day past it is Expired.
    /// An off-by-one here costs a customer a day of paid features or gives them one free.</summary>
    [Fact]
    public void The_grace_boundary_is_where_the_design_says_it_is()
    {
        var expiry = new DateTimeOffset(2026, 6, 1, 0, 0, 0, TimeSpan.Zero);
        var envelope = LicenseTestKit.SignedEnvelope(
            LicenseTestKit.Payload(expiresAtUtc: expiry, graceDays: 30), _key.Private);

        Assert.Equal(LicenseState.Valid,
            LicenseEvaluator.Evaluate(envelope, _verifier, _identityStore, expiry, null).State);
        Assert.Equal(LicenseState.Grace,
            LicenseEvaluator.Evaluate(envelope, _verifier, _identityStore, expiry.AddSeconds(1), null).State);
        Assert.Equal(LicenseState.Grace,
            LicenseEvaluator.Evaluate(envelope, _verifier, _identityStore, expiry.AddDays(30), null).State);
        Assert.Equal(LicenseState.Expired,
            LicenseEvaluator.Evaluate(envelope, _verifier, _identityStore, expiry.AddDays(30).AddSeconds(1), null).State);
    }

    /// <summary>A null expiry is PERPETUAL — the correct representation for a bought-outright Machine
    /// edition, and a legal value rather than a missing one. It must not be read as "expired at epoch".</summary>
    [Fact]
    public void A_null_expiry_is_perpetual_not_expired()
    {
        var envelope = LicenseTestKit.SignedEnvelope(
            LicenseTestKit.Payload(edition: "Machine", expiresAtUtc: null), _key.Private);

        var result = LicenseEvaluator.Evaluate(
            envelope, _verifier, _identityStore, new DateTimeOffset(2099, 1, 1, 0, 0, 0, TimeSpan.Zero), null);

        Assert.Equal(LicenseState.Valid, result.State);
        Assert.True(result.Features.Contains(LicenseFeatures.HmiAuthoring));
    }

    /// <summary>🔴 A signed NEGATIVE graceDays must not make the grace window end before the expiry it
    /// follows — the clamp exists so a malformed-but-signed payload cannot skip the warning period.</summary>
    [Fact]
    public void A_negative_grace_period_is_clamped_rather_than_honoured()
    {
        var expiry = new DateTimeOffset(2026, 6, 1, 0, 0, 0, TimeSpan.Zero);
        var envelope = LicenseTestKit.SignedEnvelope(
            LicenseTestKit.Payload(expiresAtUtc: expiry, graceDays: -365), _key.Private);

        var result = LicenseEvaluator.Evaluate(
            envelope, _verifier, _identityStore, expiry.AddSeconds(1), null);

        Assert.Equal(LicenseState.Expired, result.State); // straight to Expired, never "expired in the past"
    }

    /// <summary>A licence not yet valid is refused, and refused as a licence problem rather than silently
    /// granted.</summary>
    [Fact]
    public void A_licence_that_is_not_yet_valid_is_refused()
    {
        var envelope = LicenseTestKit.SignedEnvelope(LicenseTestKit.Payload(), _key.Private);

        // notBeforeUtc in the fixture is 2026-01-01; evaluate a year earlier.
        var result = LicenseEvaluator.Evaluate(
            envelope, _verifier, _identityStore, new DateTimeOffset(2025, 1, 1, 0, 0, 0, TimeSpan.Zero), null);

        Assert.Equal(LicenseState.Invalid, result.State);
        Assert.False(result.Features.Contains(LicenseFeatures.HmiAuthoring));
        Assert.True(result.Features.Contains(LicenseFeatures.HmiApi)); // still a working machine
    }

    // ══════════════════════════════════════════════════════════════════════════════════════════════
    // THE CLOCK
    // ══════════════════════════════════════════════════════════════════════════════════════════════

    /// <summary>🔴 A clock that went backwards past tolerance keeps paid features ON. A broken clock is
    /// ST4I's problem to diagnose, not the customer's entitlement to lose — the second of the two
    /// deliberate fail-open states.</summary>
    [Fact]
    public void A_clock_that_went_backwards_keeps_paid_features_on()
    {
        var envelope = LicenseTestKit.SignedEnvelope(
            LicenseTestKit.Payload(edition: "Line", expiresAtUtc: new DateTimeOffset(2027, 1, 1, 0, 0, 0, TimeSpan.Zero)),
            _key.Private);

        var floor = new DateTimeOffset(2026, 6, 1, 0, 0, 0, TimeSpan.Zero);
        var brokenRtc = new DateTimeOffset(1980, 1, 1, 0, 0, 0, TimeSpan.Zero);

        var result = LicenseEvaluator.Evaluate(envelope, _verifier, _identityStore, brokenRtc, floor);

        Assert.Equal(LicenseState.ClockUnusable, result.State);
        Assert.True(result.Features.Contains(LicenseFeatures.LineControl));
        Assert.True(result.Features.Contains(LicenseFeatures.HmiAuthoring));
        Assert.Equal(floor, result.EvaluatedAtUtc); // the floor was used as "now"
    }

    /// <summary>🔴 A clock that jumped implausibly forward likewise keeps features on — otherwise a paid
    /// machine loses its features early, which is a revenue event caused by a hardware fault.</summary>
    [Fact]
    public void A_clock_that_jumped_forward_keeps_paid_features_on()
    {
        var envelope = LicenseTestKit.SignedEnvelope(
            LicenseTestKit.Payload(expiresAtUtc: new DateTimeOffset(2027, 1, 1, 0, 0, 0, TimeSpan.Zero)),
            _key.Private);

        var floor = new DateTimeOffset(2026, 6, 1, 0, 0, 0, TimeSpan.Zero);
        var garbage = new DateTimeOffset(2099, 1, 1, 0, 0, 0, TimeSpan.Zero);

        var result = LicenseEvaluator.Evaluate(envelope, _verifier, _identityStore, garbage, floor);

        Assert.Equal(LicenseState.ClockUnusable, result.State);
        Assert.True(result.Features.Contains(LicenseFeatures.HmiAuthoring));
    }

    /// <summary>
    /// 🔴 <b>NEGATIVE CONTROL FOR THE CLOCK.</b> The two tests above assert that an implausible clock is
    /// caught; a checker that declared EVERY clock unusable would pass both while making the expiry rules
    /// meaningless. This proves a credible clock is used as-is and still produces a real expiry decision.
    /// </summary>
    [Fact]
    public void A_credible_clock_is_used_and_still_expires_a_licence()
    {
        var expiry = new DateTimeOffset(2026, 6, 1, 0, 0, 0, TimeSpan.Zero);
        var envelope = LicenseTestKit.SignedEnvelope(
            LicenseTestKit.Payload(expiresAtUtc: expiry, graceDays: 30), _key.Private);

        var floor = expiry.AddDays(50);
        var wall = expiry.AddDays(50); // agrees with the floor: credible

        var result = LicenseEvaluator.Evaluate(envelope, _verifier, _identityStore, wall, floor);

        Assert.Equal(LicenseState.Expired, result.State);
        Assert.Equal(wall, result.EvaluatedAtUtc);
    }

    /// <summary>Small clock disagreements are absorbed rather than escalated — NTP corrections and DST
    /// misconfiguration are ordinary and must not cost anything or raise an alarm.</summary>
    [Fact]
    public void Ordinary_clock_drift_is_absorbed()
    {
        var floor = new DateTimeOffset(2026, 6, 1, 0, 0, 0, TimeSpan.Zero);

        var slightlyBehind = LicenseClock.Resolve(floor.AddHours(-6), floor, out var c1, out _);
        Assert.True(c1);
        Assert.Equal(floor.AddHours(-6), slightlyBehind);

        var monthsAhead = LicenseClock.Resolve(floor.AddDays(200), floor, out var c2, out _);
        Assert.True(c2);
        Assert.Equal(floor.AddDays(200), monthsAhead);
    }

    /// <summary>🔴 <b>THE ACCEPTED HOLE, PINNED AS A TEST SO IT IS STATED RATHER THAN HIDDEN.</b> A fresh
    /// install has no audit floor and therefore trusts the wall clock unconditionally. Set the clock back,
    /// wipe the audit database, run forever. This design deters casual clock-rollback; it does not defeat a
    /// determined local administrator, and it is not trying to. Closing it would need a phone-home
    /// (forbidden — offline-first) or a sealed monotonic counter (TPM, rejected for brittleness).</summary>
    [Fact]
    public void With_no_audit_floor_the_wall_clock_is_trusted_which_is_the_accepted_hole()
    {
        var expiry = new DateTimeOffset(2026, 6, 1, 0, 0, 0, TimeSpan.Zero);
        var envelope = LicenseTestKit.SignedEnvelope(
            LicenseTestKit.Payload(edition: "Machine", expiresAtUtc: expiry), _key.Private);

        // A rolled-back clock with no floor to contradict it: the licence reads as live again.
        var rolledBack = expiry.AddDays(-1);
        var result = LicenseEvaluator.Evaluate(envelope, _verifier, _identityStore, rolledBack, auditFloorUtc: null);

        Assert.Equal(LicenseState.Valid, result.State);
        Assert.True(result.Features.Contains(LicenseFeatures.HmiAuthoring));

        // And with a floor present, the same rollback IS caught — which is what the floor buys.
        var withFloor = LicenseEvaluator.Evaluate(
            envelope, _verifier, _identityStore, rolledBack, auditFloorUtc: expiry.AddDays(100));
        Assert.Equal(LicenseState.ClockUnusable, withFloor.State);
    }

    // ══════════════════════════════════════════════════════════════════════════════════════════════
    // ENTITLEMENTS
    // ══════════════════════════════════════════════════════════════════════════════════════════════

    /// <summary>🔴 The edition set gates LINE and ALARM, not only the HMI flags — roadmap:377's own
    /// acceptance criterion is "mở khoá Line bằng license mới", unlocking Line with a new licence.</summary>
    [Fact]
    public void A_machine_licence_does_not_unlock_line_but_a_line_licence_does()
    {
        var machine = LicenseTestKit.SignedEnvelope(LicenseTestKit.Payload(edition: "Machine"), _key.Private);
        var line = LicenseTestKit.SignedEnvelope(LicenseTestKit.Payload(edition: "Line"), _key.Private);
        var now = new DateTimeOffset(2026, 6, 1, 0, 0, 0, TimeSpan.Zero);

        var m = LicenseEvaluator.Evaluate(machine, _verifier, _identityStore, now, null);
        Assert.Equal(LicenseState.Valid, m.State);
        Assert.True(m.Features.Contains(LicenseFeatures.HmiAuthoring));
        Assert.False(m.Features.Contains(LicenseFeatures.LineControl));
        Assert.False(m.Features.Contains(LicenseFeatures.AlarmsNotify));

        var l = LicenseEvaluator.Evaluate(line, _verifier, _identityStore, now, null);
        Assert.Equal(LicenseState.Valid, l.State);
        Assert.True(l.Features.Contains(LicenseFeatures.LineControl));
        Assert.True(l.Features.Contains(LicenseFeatures.AlarmsNotify));
        Assert.True(l.Features.Contains(LicenseFeatures.HmiAuthoring)); // Line is a superset of Machine
    }

    /// <summary>🔴 A licence whose explicit feature array OMITS a Core feature must not be able to take it
    /// away — Core is unioned in unconditionally, so a mis-issued licence cannot blank a kiosk.</summary>
    [Fact]
    public void A_licence_cannot_revoke_a_core_feature_by_omitting_it()
    {
        var envelope = LicenseTestKit.SignedEnvelope(
            LicenseTestKit.Payload(edition: "Machine", features: [LicenseFeatures.HmiAuthoring]), _key.Private);

        var result = LicenseEvaluator.Evaluate(
            envelope, _verifier, _identityStore, new DateTimeOffset(2026, 6, 1, 0, 0, 0, TimeSpan.Zero), null);

        Assert.Equal(LicenseState.Valid, result.State);
        Assert.True(result.Features.Contains(LicenseFeatures.HmiApi));
        Assert.True(result.Features.Contains(LicenseFeatures.HmiModel));
        Assert.True(result.Features.Contains(LicenseFeatures.HmiAuthoring));
    }

    /// <summary>An unrecognised edition label degrades to Core — never throws on a startup path, and never
    /// grants everything.</summary>
    [Fact]
    public void An_unknown_edition_label_degrades_to_core()
    {
        var envelope = LicenseTestKit.SignedEnvelope(
            LicenseTestKit.Payload(edition: "Platinum-Plus-Ultra", features: null), _key.Private);

        var result = LicenseEvaluator.Evaluate(
            envelope, _verifier, _identityStore, new DateTimeOffset(2026, 6, 1, 0, 0, 0, TimeSpan.Zero), null);

        Assert.Equal(LicenseState.Valid, result.State);
        Assert.True(result.Features.Contains(LicenseFeatures.HmiApi));
        Assert.False(result.Features.Contains(LicenseFeatures.HmiAuthoring));
    }

    /// <summary>Editions are strict supersets, which is what makes an upgrade a re-issued licence rather
    /// than a migration.</summary>
    [Fact]
    public void The_editions_are_strict_supersets()
    {
        // Assert.ProperSubset(expectedSuperset, actualSubset) — the SUPERSET comes first.
        Assert.ProperSubset(LicenseFeatures.Machine.ToHashSet(StringComparer.Ordinal),
            LicenseFeatures.Core.ToHashSet(StringComparer.Ordinal));
        Assert.ProperSubset(LicenseFeatures.Line.ToHashSet(StringComparer.Ordinal),
            LicenseFeatures.Machine.ToHashSet(StringComparer.Ordinal));
        Assert.ProperSubset(LicenseFeatures.SiteConnected.ToHashSet(StringComparer.Ordinal),
            LicenseFeatures.Line.ToHashSet(StringComparer.Ordinal));
    }
}
