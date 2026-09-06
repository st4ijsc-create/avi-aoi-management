using St4i.EdgeCore.Licensing;
using St4i.EdgeCore.Updates;
using Xunit;

namespace St4i.EdgeCore.Tests.Updates;

/// <summary>
/// 🔴🔴 WS-F4 Task 2 — <b>THE SECOND RELEASE GUARD, and its separateness is the whole point.</b>
///
/// <para>This build's embedded UPDATE key is a TEST key, not ST4I's production update-signing key, and
/// this file exists so that fact cannot be forgotten or discovered late.</para>
///
/// <para>🔴 <b>WHY THIS IS A SEPARATE FILE FROM <c>EmbeddedKeyIsTheTestKeyTests</c> AND NOT A CASE INSIDE
/// IT.</b> One test covering both keys is satisfied the moment EITHER key is rotated. Swap the licence
/// key at release, and a combined test goes green — while the update key, which gates CODE EXECUTION on
/// every machine in every factory, is still the throwaway one. The guard would have fired, been
/// satisfied, and stopped guarding the more dangerous of the two secrets. So there are two tests, one per
/// key, and each can only be satisfied by rotating its own.</para>
///
/// <para><b>What is actually safe about the current key.</b> The private half was minted out of band on
/// 2026-09-06 — a throwaway project in a scratch directory, never in this tree — and destroyed with the
/// process and the directory that made it. No copy exists on any disk. So this key can verify nothing
/// ST4I has signed, and nothing can ever be signed for it. An attacker who takes it from the repository
/// gets a public key, which is public by definition.</para>
///
/// <para>🔴 <b>And unlike the licence key, rotating this one costs nothing.</b> The licence key's swap
/// invalidates every licence issued against it; this key has never signed a bundle, because its private
/// half never outlived one process. The swap is free now and stays free until ST4I signs its first
/// bundle — which is an argument for doing it first, not for delaying it.</para>
/// </summary>
public sealed class EmbeddedUpdateKeyIsTheTestKeyTests
{
    /// <summary>The minted test key, spelled out independently of the constant so this is a comparison
    /// between two sources rather than a constant compared with itself.</summary>
    private static readonly byte[] KnownTestKey =
    [
        0xBF, 0x99, 0xEC, 0xA7, 0x20, 0xE8, 0xC3, 0x59, 0xD9, 0xF1, 0x9B, 0xAE, 0xE8, 0xA6, 0xA2, 0x78,
        0xFA, 0xFC, 0xCA, 0x4C, 0x1A, 0xB1, 0x75, 0x70, 0xD1, 0x8F, 0x91, 0x93, 0x9D, 0xF8, 0x02, 0xC4,
    ];

    /// <summary>
    /// 🔴🔴 <b>THE RELEASE GUARD ITSELF.</b> Fails the moment the embedded UPDATE key stops being the
    /// test key — i.e. the moment somebody does the release swap — and its message is the checklist for
    /// that commit.
    /// </summary>
    [Fact]
    public void TheEmbeddedUpdateKey_IsStillTheTestKey_AndTheReleaseSwapHasNotHappenedYet()
    {
        Assert.True(
            KnownTestKey.SequenceEqual(UpdateManifestVerifier.EmbeddedPublicKey),
            "UpdateManifestVerifier.EmbeddedPublicKey is no longer the TEST key. If you have just swapped " +
            "in ST4I's production update-signing key — good, that is the release step — then do these in " +
            "THE SAME COMMIT or the suite lies about what it covers:\n" +
            "  1. Update the KnownTestKey constant in this file and this test's name, or delete this test " +
            "     outright — a release guard that has fired and been muted is worse than none.\n" +
            "  2. Re-read UpdateManifestVerifier.EmbeddedPublicKey's doc comment, which still describes " +
            "     the tree as carrying a test key whose private half was destroyed.\n" +
            "  3. Confirm the private half now lives where ST4I decided it lives — a signing service, an " +
            "     offline HSM, or a person with a hardware token — and that it has NEVER been in this " +
            "     repository, transiently or otherwise. LicensePrivateKeyAbsenceTests enforces that " +
            "     mechanically; this line is the human half.\n" +
            "🔴 Note what this swap does NOT cost: no bundle has ever been signed with the test key, " +
            "because no private half outlived the process that made it. Unlike the LICENCE key swap, this " +
            "one invalidates nothing in the field. Do it early.\n" +
            "🔴 And note what it does NOT satisfy: the licence key's guard, EmbeddedKeyIsTheTestKeyTests, " +
            "is a SEPARATE test for a SEPARATE key. Rotating this one does not and must not silence it.");
    }

    /// <summary>
    /// 🔴 The embedded update key is a REAL, usable Ed25519 public key — not an all-zero placeholder.
    /// Without this, the guard above would still pass on a build that could verify nothing at all.
    /// </summary>
    [Fact]
    public void TheEmbeddedUpdateKey_IsAUsableKey_NotTheAllZeroNonKey()
    {
        Assert.Equal(UpdateManifestVerifier.PublicKeyLength, UpdateManifestVerifier.EmbeddedPublicKey.Length);
        Assert.False(new UpdateManifestVerifier().KeyIsUnconfigured);
        Assert.Contains(UpdateManifestVerifier.EmbeddedPublicKey, b => b != 0);
    }

    /// <summary>
    /// 🔴🔴 <b>THE TWO KEYS ARE DIFFERENT KEYS.</b> The owner's ruling of 2026-09-06 was that revenue and
    /// code execution must not share a secret: a leaked licence key costs money, a leaked update key costs
    /// remote code execution on every machine in every factory.
    ///
    /// <para>Asserted rather than assumed, because the failure mode is a copy-paste that nobody would
    /// notice in review — two 32-byte hex blocks look alike, and a build where they were accidentally the
    /// same would pass every other test in this file and in the licensing suite.</para>
    /// </summary>
    [Fact]
    public void TheUpdateKeyAndTheLicenceKey_AreNotTheSameKey()
    {
        Assert.False(
            UpdateManifestVerifier.EmbeddedPublicKey.SequenceEqual(LicenseVerifier.EmbeddedPublicKey),
            "The update-signing key and the licence-signing key are the SAME 32 bytes. The owner ruled on " +
            "2026-09-06 that they must be separate: binding revenue and code execution to one secret means " +
            "leaking one loses both, and rotating one becomes a single release step whose failure mode is " +
            "either 'nobody's licence works' or 'no machine can be patched' — and you find out which in " +
            "the field.");
    }

    /// <summary>
    /// 🔴🔴 <b>THE TWO RELEASE GUARDS ARE SEPARATELY SATISFIABLE, AND THIS PROVES IT MECHANICALLY.</b>
    ///
    /// <para>The controller's requirement was that rotating one key must not silence the other guard. The
    /// argument for that is easy to state and easy to get wrong, so it is measured: each guard compares
    /// its OWN constant against its OWN independently-spelled expectation, and neither reads the other's.
    /// Demonstrated by showing that the two known-key constants differ — so a rotation that changed one
    /// production constant could only ever redden one of the two guards, leaving the other still
    /// guarding.</para>
    /// </summary>
    [Fact]
    public void RotatingOneKey_CannotSatisfyTheOtherKeysGuard()
    {
        // This file's expectation is the UPDATE key and nothing else.
        Assert.True(KnownTestKey.SequenceEqual(UpdateManifestVerifier.EmbeddedPublicKey));
        Assert.False(KnownTestKey.SequenceEqual(LicenseVerifier.EmbeddedPublicKey));

        // So a hypothetical rotation of the LICENCE key leaves this guard's comparison untouched: it
        // never reads LicenseVerifier.EmbeddedPublicKey at all, and the two constants are different
        // values, so no single edit can turn both guards green at once.
        Assert.NotEqual(
            Convert.ToHexString(UpdateManifestVerifier.EmbeddedPublicKey),
            Convert.ToHexString(LicenseVerifier.EmbeddedPublicKey));
    }

    /// <summary>
    /// 🔴 <b>NEGATIVE CONTROL for the whole file.</b> Every test above asserts something about a
    /// CONSTANT, and a constant can be correct in a build whose verifier does not work at all. This
    /// proves the production verifier — parameterless constructor, embedded key, no seam — actually
    /// refuses a manifest signed by someone else.
    ///
    /// <para>There is deliberately no positive counterpart: nothing in this repository can produce a
    /// bundle the embedded key accepts, because the matching private half was destroyed. That absence is
    /// the property, not a gap.</para>
    /// </summary>
    [Fact]
    public void TheProductionUpdateVerifier_RefusesAManifestSignedByAnotherKey()
    {
        var (forgerKey, _) = UpdateTestKit.NewKeyPair();
        var bundleDir = UpdateTestKit.WriteBundle(forgerKey);

        try
        {
            Assert.True(UpdateBundle.TryOpen(bundleDir, out var bundle));

            // 🔴 The PRODUCTION verifier — parameterless ctor, embedded key. No seam.
            var state = new UpdateManifestVerifier().Verify(
                bundle!.ReadManifestBytes(), bundle.ReadSignatureText(), out var manifest, out var diagnostic);

            Assert.Equal(UpdateVerificationState.Invalid, state);
            Assert.Null(manifest);
            Assert.NotNull(diagnostic);
            Assert.Contains("not valid for this product", diagnostic!, StringComparison.Ordinal);
        }
        finally
        {
            UpdateTestKit.Cleanup(bundleDir);
        }
    }
}
