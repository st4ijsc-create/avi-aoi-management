using System.Text;
using St4i.EdgeCore.Updates;
using Xunit;

namespace St4i.EdgeCore.Tests.Updates;

/// <summary>
/// 🔴🔴 WS-F4 Task 2 — <b>THE FALSIFICATION THAT DECIDES WHETHER THIS DESIGN IS HONOURED OR MERELY
/// DESCRIBED.</b>
///
/// <para>The blueprint named this test before the code existed (§6 row 1): <i>"a test that hands the
/// apply path a bundle whose MSI has one flipped byte and asserts <c>msiexec</c> was never invoked. If
/// that test cannot be written because the code reads the MSI first, the design is wrong."</i> This file
/// is that test, and it passes — so the design is honoured by measurement rather than by assertion.</para>
///
/// <para><b>Why the flipped byte is the right attack rather than a missing file.</b> A missing or
/// unsigned bundle is refused by the first gate and proves only that the first gate exists. A bundle
/// whose manifest is perfectly signed by the right key, for the right product, at a higher version, whose
/// <b>payload alone</b> differs by ONE BIT, gets all the way to the last gate — the SHA-256 comparison —
/// with everything else looking correct. It is also the realistic case: a stick pulled out mid-copy, a
/// failing flash cell, or an attacker who can swap the payload but cannot forge ST4I's signature.</para>
///
/// <para>🔴 <b>And the assertion is a NEGATIVE about a side effect</b>, which is why
/// <see cref="IMsiRunner"/> exists at all. "The installer was not invoked" is unobservable against code
/// that really launches an installer. Recording the invocation list and asserting it is empty is the only
/// shape that can catch a future edit which reads the MSI early — to populate a progress bar, or to show
/// the operator the installer's own ProductVersion on the confirmation screen — because that edit would
/// break the property while every happy-path test stayed green.</para>
/// </summary>
public sealed class MsiexecIsNeverInvokedOnUnverifiedBytesTests
{
    private const string InstalledVersion = "1.0.0";

    /// <summary>
    /// 🔴🔴 <b>THE TEST THE BLUEPRINT ASKED FOR.</b> One flipped byte in the payload, a manifest and
    /// signature that are both perfectly valid, and the installer is <b>never reached</b>.
    /// </summary>
    [Fact]
    public void OneFlippedByteInThePayload_RefusesTheUpdate_AndMsiexecIsNeverInvoked()
    {
        var (privateKey, publicKey) = UpdateTestKit.NewKeyPair();
        var bundleDir = UpdateTestKit.WriteBundle(privateKey);

        try
        {
            // The bundle is valid at this instant — proven below by the negative control, which is the
            // SAME bundle shape without the flip.
            var flippedIndex = UpdateTestKit.FlipOneByteOfPayload(bundleDir);

            Assert.True(UpdateBundle.TryOpen(bundleDir, out var bundle));
            var preflight = UpdatePreflight.Run(
                bundle!, InstalledVersion, new UpdateManifestVerifier(publicKey));

            // 🔴🔴 THE LOAD-BEARING ASSERTION, AND IT COMES FIRST ON PURPOSE. Run the whole apply path
            // against the corrupted bundle and prove the installer was never reached. This is asserted
            // BEFORE the verdict fields below so that a regression which lets corrupted bytes through
            // fails HERE — naming the actual danger, "msiexec was invoked on bytes that do not match the
            // signed manifest" — rather than failing earlier on a verdict flag, which would report the
            // symptom as a boolean and bury the consequence.
            var runner = new RecordingMsiRunner();
            var (exitCode, output) = new UpdateApplier(runner).Apply(preflight, ["MainFeature", "ServiceFeature"]);

            Assert.True(runner.Invocations.Count == 0,
                "🔴 msiexec WAS INVOKED on a payload whose bytes do not match the signed manifest. The " +
                "single byte at index " + flippedIndex + " was flipped, the manifest and its signature " +
                "were left perfectly valid, and the installer was still reached. This is remote code " +
                "execution: an attacker who can rewrite the payload on a USB stick — without being able " +
                "to forge ST4I's signature — can run arbitrary code as SYSTEM on every machine the stick " +
                "touches. Invoked with: " +
                string.Join(" ", runner.Invocations.SelectMany(i => i)));

            Assert.Equal(-1, exitCode);
            Assert.Contains("REFUSED", output, StringComparison.Ordinal);
            Assert.Contains("NOT been installed", output, StringComparison.Ordinal);

            // And the verdict is shaped the way the refusal should be. The manifest itself still verified
            // — this is NOT a signature failure, and saying so matters because "the signature is bad" and
            // "the payload is damaged" send an engineer to different places.
            Assert.Equal(UpdateVerificationState.Verified, preflight.State);
            Assert.False(preflight.Ok);
            Assert.Null(preflight.VerifiedPayloadPath);
            Assert.NotNull(preflight.Reason);
            Assert.Contains("does not match the signed manifest", preflight.Reason!, StringComparison.Ordinal);
            Assert.Contains("NOT been opened", preflight.Reason!, StringComparison.Ordinal);
        }
        finally
        {
            UpdateTestKit.Cleanup(bundleDir);
        }
    }

    /// <summary>
    /// 🔴 <b>NEGATIVE CONTROL, and this suite is worthless without it.</b> The test above asserts that
    /// nothing happened. An applier that refused EVERYTHING — or a pre-flight that never passed anything
    /// — would satisfy it perfectly while making the product incapable of ever installing an update.
    ///
    /// <para>So: the same bundle, the same key, the same applier, <b>without the flipped byte</b> — and
    /// the installer IS invoked, exactly once.</para>
    /// </summary>
    [Fact]
    public void TheSameBundleWithoutTheFlippedByte_Passes_AndMsiexecIsInvokedExactlyOnce()
    {
        var (privateKey, publicKey) = UpdateTestKit.NewKeyPair();
        var bundleDir = UpdateTestKit.WriteBundle(privateKey);

        try
        {
            Assert.True(UpdateBundle.TryOpen(bundleDir, out var bundle));
            var preflight = UpdatePreflight.Run(
                bundle!, InstalledVersion, new UpdateManifestVerifier(publicKey));

            Assert.True(preflight.Ok, $"The unmodified bundle should verify: {preflight.Reason}");
            Assert.NotNull(preflight.VerifiedPayloadPath);

            var runner = new RecordingMsiRunner();
            var (exitCode, _) = new UpdateApplier(runner).Apply(preflight, ["MainFeature", "ServiceFeature"]);

            Assert.Single(runner.Invocations);
            Assert.Equal(0, exitCode);
            Assert.Contains(preflight.VerifiedPayloadPath!, runner.Invocations[0]);
        }
        finally
        {
            UpdateTestKit.Cleanup(bundleDir);
        }
    }

    /// <summary>
    /// 🔴 The gate is on the VERDICT, not on a path the caller happens to pass — so a refusal built by
    /// any route cannot reach the installer. This attacks the applier directly rather than through a
    /// bundle, which is the shape a future refactor is most likely to break.
    /// </summary>
    [Fact]
    public void ARefusedVerdict_NeverReachesTheInstaller_EvenWhenHandedDirectlyToTheApplier()
    {
        var runner = new RecordingMsiRunner();

        // A bundle that does not exist at all: the weakest possible input, refused before any file is read.
        var missingDir = Path.Combine(Path.GetTempPath(), "st4i-update-tests", Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(missingDir);
        try
        {
            Assert.False(UpdateBundle.TryOpen(missingDir, out _),
                "A directory with no manifest.json is not a candidate bundle.");

            // And a manifest that is present but signed by a DIFFERENT key — the forgery case.
            var (forgerKey, _) = UpdateTestKit.NewKeyPair();
            var (_, ourPublicKey) = UpdateTestKit.NewKeyPair();
            var forged = UpdateTestKit.WriteBundle(forgerKey);
            try
            {
                Assert.True(UpdateBundle.TryOpen(forged, out var bundle));
                var preflight = UpdatePreflight.Run(
                    bundle!, InstalledVersion, new UpdateManifestVerifier(ourPublicKey));

                Assert.Equal(UpdateVerificationState.Invalid, preflight.State);
                Assert.False(preflight.Ok);

                var (exitCode, _) = new UpdateApplier(runner).Apply(preflight, ["MainFeature"]);
                Assert.Empty(runner.Invocations);
                Assert.Equal(-1, exitCode);
            }
            finally
            {
                UpdateTestKit.Cleanup(forged);
            }
        }
        finally
        {
            UpdateTestKit.Cleanup(missingDir);
        }
    }

    /// <summary>
    /// 🔴 A truncated payload — the single most likely corruption in this product's real life, a stick
    /// pulled out mid-copy — is refused with a message that names truncation rather than a hash mismatch,
    /// and the installer is never reached.
    /// </summary>
    [Fact]
    public void ATruncatedPayload_IsDiagnosedAsTruncation_AndMsiexecIsNeverInvoked()
    {
        var (privateKey, publicKey) = UpdateTestKit.NewKeyPair();
        var bundleDir = UpdateTestKit.WriteBundle(privateKey);

        try
        {
            var payloadPath = Path.Combine(bundleDir, "St4iMachineSimulator.msi");
            var bytes = File.ReadAllBytes(payloadPath);
            File.WriteAllBytes(payloadPath, bytes[..(bytes.Length / 2)]);

            Assert.True(UpdateBundle.TryOpen(bundleDir, out var bundle));
            var preflight = UpdatePreflight.Run(
                bundle!, InstalledVersion, new UpdateManifestVerifier(publicKey));

            Assert.False(preflight.Ok);
            Assert.Contains("truncated", preflight.Reason!, StringComparison.OrdinalIgnoreCase);

            var runner = new RecordingMsiRunner();
            new UpdateApplier(runner).Apply(preflight, ["MainFeature"]);
            Assert.Empty(runner.Invocations);
        }
        finally
        {
            UpdateTestKit.Cleanup(bundleDir);
        }
    }

    /// <summary>
    /// 🔴 A manifest naming a payload OUTSIDE the bundle is refused. Even a correctly-signed manifest is
    /// a file an operator carried in on a stick, and a name like <c>..\..\payload.msi</c> would point the
    /// installer at bytes the manifest never covered — verification of the wrong file is not verification.
    /// </summary>
    [Fact]
    public void AManifestNamingAPayloadOutsideTheBundle_IsRefused_AndMsiexecIsNeverInvoked()
    {
        var (privateKey, publicKey) = UpdateTestKit.NewKeyPair();
        var payload = Encoding.UTF8.GetBytes("PRETEND-MSI");

        // A perfectly signed manifest whose artefact name tries to escape the bundle directory.
        var manifest = UpdateTestKit.ManifestJson(@"..\..\elsewhere.msi", payload);
        var bundleDir = UpdateTestKit.WriteBundle(privateKey, payload, manifestJsonOverride: manifest);

        try
        {
            Assert.True(UpdateBundle.TryOpen(bundleDir, out var bundle));
            var preflight = UpdatePreflight.Run(
                bundle!, InstalledVersion, new UpdateManifestVerifier(publicKey));

            Assert.Equal(UpdateVerificationState.Verified, preflight.State); // the SIGNATURE was fine
            Assert.False(preflight.Ok);
            Assert.Contains("not a plain file name", preflight.Reason!, StringComparison.Ordinal);

            var runner = new RecordingMsiRunner();
            new UpdateApplier(runner).Apply(preflight, ["MainFeature"]);
            Assert.Empty(runner.Invocations);
        }
        finally
        {
            UpdateTestKit.Cleanup(bundleDir);
        }
    }
}
