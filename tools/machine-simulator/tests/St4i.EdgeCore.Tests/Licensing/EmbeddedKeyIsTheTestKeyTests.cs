using System.Text.Json;
using St4i.EdgeCore.Licensing;
using Xunit;

namespace St4i.EdgeCore.Tests.Licensing;

/// <summary>
/// 🔴🔴 WS-E — <b>THE RELEASE GUARD.</b> This build's embedded public key is the END-TO-END TEST key, not
/// ST4I's production key, and this file exists so that fact cannot be forgotten or discovered late.
///
/// <para><b>Why a test and not a comment.</b> A comment saying "replace this before release" is read once,
/// by the person who wrote it. The consequence of forgetting is that a shipped appliance rejects every
/// genuine customer licence with <see cref="LicenseState.Invalid"/> — a fleet that cannot be licensed at
/// all, discovered by the first customer rather than by the build. So the fact is asserted, and the
/// assertion is written to FAIL the day somebody swaps the key in, with a message telling them exactly
/// what else to do in the same commit.</para>
///
/// <para><b>What is actually safe about the current key.</b> The private half was minted out of band, used
/// once to sign <c>web/fixtures/e2e-license.json</c>, and discarded with the process that created it — no
/// copy exists on any disk. So this key can VERIFY the one committed licence and can never SIGN another.
/// An attacker who takes this key pair from the repository gets the public half, which is public by
/// definition.</para>
/// </summary>
public sealed class EmbeddedKeyIsTheTestKeyTests
{
    /// <summary>The e2e test key, spelled out independently of the constant so this is a comparison
    /// between two sources rather than a constant compared with itself.</summary>
    private static readonly byte[] KnownTestKey =
    [
        0x6E, 0xB6, 0xF7, 0x2C, 0xAC, 0x29, 0xEE, 0xF1, 0x90, 0x5C, 0xEF, 0x3A, 0x06, 0xDA, 0x06, 0xA3,
        0x55, 0xE4, 0xAF, 0xB2, 0xCD, 0x68, 0xAF, 0xF5, 0xEF, 0x75, 0x15, 0x65, 0x2F, 0xD7, 0x31, 0xEE,
    ];

    /// <summary>
    /// 🔴🔴 <b>THE RELEASE GUARD ITSELF.</b> Fails the moment the embedded key stops being the test key —
    /// i.e. the moment somebody does the release swap — and its message is the checklist for that commit.
    /// </summary>
    [Fact]
    public void TheEmbeddedKey_IsStillTheE2ETestKey_AndTheReleaseSwapHasNotHappenedYet()
    {
        Assert.True(
            KnownTestKey.SequenceEqual(LicenseVerifier.EmbeddedPublicKey),
            "LicenseVerifier.EmbeddedPublicKey is no longer the end-to-end TEST key. If you have just " +
            "swapped in ST4I's production key — good, that is the release step — then do these in THE " +
            "SAME COMMIT or the suite lies about what it covers:\n" +
            "  1. Re-sign web/fixtures/e2e-license.json with the production key, OR give the e2e host its " +
            "     own verifier seam. Right now the committed fixture verifies against the TEST key only, " +
            "     so a production key silently unlicenses the whole Playwright suite (56 tests).\n" +
            "  2. Update the KnownTestKey constant in this file and this test's name, or delete this test " +
            "     outright — a release guard that has fired and been muted is worse than none.\n" +
            "  3. Re-read LicenseVerifier.EmbeddedPublicKey's doc comment, which still describes the tree " +
            "     as carrying a test key.\n" +
            "🔴 And note what the swap costs: the key is baked into the binary, so changing it invalidates " +
            "every licence already issued against the old one. Today that set is exactly one (the unbound " +
            "e2e fixture), so the swap is free NOW and unbounded after the first customer licence ships.");
    }

    /// <summary>
    /// 🔴 The embedded key is a REAL, usable Ed25519 public key — not the all-zero non-key this tree
    /// carried before the e2e licence existed. Without this, the guard above would still pass on a build
    /// that could verify nothing at all.
    /// </summary>
    [Fact]
    public void TheEmbeddedKey_IsAUsableKey_NotTheAllZeroNonKey()
    {
        Assert.Equal(LicenseVerifier.PublicKeyLength, LicenseVerifier.EmbeddedPublicKey.Length);
        Assert.False(new LicenseVerifier().KeyIsUnconfigured);
        Assert.Contains(LicenseVerifier.EmbeddedPublicKey, b => b != 0);
    }

    /// <summary>
    /// 🔴🔴 <b>THE COMMITTED E2E LICENCE ACTUALLY VERIFIES AGAINST THE SHIPPED KEY.</b> This is what makes
    /// the Playwright suite's licensing real rather than nominal: the fixture goes through the SAME
    /// <see cref="LicenseVerifier"/> a customer licence would, with no test seam and no injected key.
    ///
    /// <para>It also fails loudly if the fixture is edited by hand — which it must never be, because any
    /// edit breaks the signature and no private key exists to re-sign it.</para>
    /// </summary>
    [Fact]
    public void TheCommittedE2ELicence_VerifiesAgainstTheEmbeddedKey_AndIsUnbound()
    {
        var fixturePath = Path.Combine(RepoRoot(), "web", "fixtures", "e2e-license.json");
        Assert.True(File.Exists(fixturePath),
            $"The e2e licence fixture is missing at {fixturePath}. reset-engine-state.mjs seeds it into " +
            "the isolated e2e licence directory; without it every Playwright authoring test fails with a " +
            "403 that looks like a product defect.");

        // 🔴 The PRODUCTION verifier — parameterless ctor, embedded key. No seam.
        var state = new LicenseVerifier().Verify(File.ReadAllText(fixturePath), out var payload, out var diag);

        Assert.True(state == LicenseState.Valid,
            $"The committed e2e licence does not verify against the embedded key ({state}: {diag}). " +
            "Either the fixture was edited by hand — which breaks the signature irrecoverably, since no " +
            "private key exists to re-sign it — or the embedded key was swapped without re-signing it.");
        Assert.NotNull(payload);

        // 🔴 And it is the UNBOUND mode, in words, inside the signature — so this fixture works on any CI
        // machine, and could never be mistaken for a customer licence.
        Assert.True(LicenseBindingMode.IsUnbound(payload!.FingerprintPolicy),
            "The e2e licence is not in the unbound mode. It has to be: the e2e machine is whatever CI or " +
            "a developer laptop happens to be, so no fingerprint could be issued against it in advance.");
        Assert.Equal("ST4I-E2E-000001", payload.LicenseId);
        Assert.Null(payload.ExpiresAtUtc); // perpetual — a test fixture must not expire and redden CI
    }

    /// <summary>
    /// 🔴 <b>NEGATIVE CONTROL.</b> The test above proves the fixture verifies; a verifier that accepted
    /// everything would also pass it. This proves the same production verifier still refuses a licence
    /// signed by a different key — so the fixture's acceptance is a signature check, not a formality.
    /// </summary>
    [Fact]
    public void TheProductionVerifier_StillRefusesALicenceSignedByAnotherKey()
    {
        var forger = LicenseTestKit.NewKeyPair();
        var envelope = LicenseTestKit.SignedEnvelope(
            LicenseTestKit.Payload(edition: "Site-Connected", bindingMode: LicenseBindingMode.Unbound),
            forger.Private);

        var state = new LicenseVerifier().Verify(envelope, out var payload, out _);

        Assert.Equal(LicenseState.Invalid, state);
        Assert.Null(payload);
    }

    /// <summary>
    /// 🔴 <b>NO PRIVATE KEY ACCOMPANIES THE FIXTURE.</b> The signed licence is public data; a private key
    /// beside it would make the whole scheme a formality. Scans the fixture directory rather than trusting
    /// that nobody dropped one there.
    /// </summary>
    [Fact]
    public void NoPrivateKeyMaterialSitsBesideTheFixture()
    {
        var fixtureDir = Path.Combine(RepoRoot(), "web", "fixtures");
        Assert.True(Directory.Exists(fixtureDir));

        var files = Directory.GetFiles(fixtureDir, "*", SearchOption.AllDirectories);
        Assert.NotEmpty(files); // non-vacuity: an empty directory would pass every claim below

        foreach (var file in files)
        {
            var extension = Path.GetExtension(file).ToLowerInvariant();
            Assert.True(extension is not (".pfx" or ".p12" or ".key" or ".pem"),
                $"Key material must never sit beside the licence fixture: {file}");

            var text = File.ReadAllText(file);
            Assert.DoesNotContain("PRIVATE KEY", text, StringComparison.OrdinalIgnoreCase);
        }
    }

    /// <summary>Walks up to <c>tools/machine-simulator</c>.</summary>
    /// <returns>The directory holding <c>web/</c> and <c>src/</c>.</returns>
    private static string RepoRoot()
    {
        var dir = new DirectoryInfo(AppContext.BaseDirectory);
        while (dir is not null)
        {
            if (File.Exists(Path.Combine(dir.FullName, "St4iMachineSimulator.sln"))) return dir.FullName;
            dir = dir.Parent;
        }

        throw new InvalidOperationException("Could not locate St4iMachineSimulator.sln above the test assembly.");
    }

    /// <summary>The fixture is valid JSON with exactly the two envelope members — so a support engineer,
    /// or a future signer, can read it.</summary>
    [Fact]
    public void TheFixtureIsATwoMemberEnvelope()
    {
        var fixturePath = Path.Combine(RepoRoot(), "web", "fixtures", "e2e-license.json");
        using var doc = JsonDocument.Parse(File.ReadAllText(fixturePath));

        Assert.Equal(JsonValueKind.Object, doc.RootElement.ValueKind);
        Assert.True(doc.RootElement.TryGetProperty("payload", out _));
        Assert.True(doc.RootElement.TryGetProperty("signature", out _));
        Assert.Equal(2, doc.RootElement.EnumerateObject().Count());
    }
}
