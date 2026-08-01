using System;
using System.IO;
using System.Linq;
using System.Security.AccessControl;
using System.Security.Principal;
using St4i.EdgeCore.Infrastructure;
using Xunit;

public class CredentialStoreTests
{
    [Fact]
    public void Save_then_load_roundtrips()
    {
        var code = "TEST-" + System.Guid.NewGuid().ToString("N").Substring(0, 8);
        CredentialStore.Save(code, "mk_secret_value");
        Assert.Equal("mk_secret_value", CredentialStore.Load(code));
    }

    [Fact]
    public void Load_missing_returns_null() =>
        Assert.Null(CredentialStore.Load("NOPE-" + System.Guid.NewGuid().ToString("N")));

    // Task 19a — Settings' stored-credentials view lists which machine codes have a saved mk_.
    [Fact]
    public void ListMachineCodes_includes_a_freshly_saved_code()
    {
        var code = "LIST-" + System.Guid.NewGuid().ToString("N").Substring(0, 8);
        CredentialStore.Save(code, "mk_list_test");

        var codes = CredentialStore.ListMachineCodes();

        Assert.Contains(code, codes);
    }

    // FF-2 — CredentialStore now DPAPI-protects under DataProtectionScope.LocalMachine (was
    // CurrentUser) so a Windows-Service account can decrypt what an interactive onboarding session
    // wrote. A corrupt/foreign blob (garbage bytes, or bytes DPAPI-protected under a different
    // scope/entropy — e.g. what a pre-FF-2 CurrentUser-encrypted file would look like to this build)
    // must come back as "no stored key" (null) rather than an unhandled CryptographicException, so a
    // caller's normal empty-credential path (re-claim) runs instead of crashing.
    [Fact]
    public void Load_corrupt_blob_returns_null_instead_of_throwing()
    {
        var code = "CORRUPT-" + Guid.NewGuid().ToString("N").Substring(0, 8);
        var path = PathForTest(code);
        Directory.CreateDirectory(Path.GetDirectoryName(path)!);

        // Not DPAPI-protected data at all — Unprotect must fail on this, deterministically, on any
        // machine/account.
        File.WriteAllBytes(path, new byte[] { 1, 2, 3, 4, 5, 6, 7, 8 });

        Assert.Null(CredentialStore.Load(code));
    }

    [Fact]
    public void Load_blob_protected_with_wrong_entropy_returns_null_instead_of_throwing()
    {
        var code = "FOREIGN-" + Guid.NewGuid().ToString("N").Substring(0, 8);
        var path = PathForTest(code);
        Directory.CreateDirectory(Path.GetDirectoryName(path)!);

        // Valid DPAPI-LocalMachine ciphertext, but under different entropy than CredentialStore's own
        // — simulates a blob that came from elsewhere (e.g. a foreign machine/tool), which Unprotect
        // rejects the same way it rejects plain corruption.
        var foreignEntropy = System.Text.Encoding.UTF8.GetBytes("some-other-entropy");
        var plain = System.Text.Encoding.UTF8.GetBytes("mk_should_never_come_back");
        var protectedBytes = System.Security.Cryptography.ProtectedData.Protect(
            plain, foreignEntropy, System.Security.Cryptography.DataProtectionScope.LocalMachine);
        File.WriteAllBytes(path, protectedBytes);

        Assert.Null(CredentialStore.Load(code));
    }

    // FF-2 review fix — a LocalMachine-scoped DPAPI blob is decryptable by ANY local account, so the
    // creds directory's ACL is now the entire confidentiality boundary (there's no longer a "wrong
    // Windows account" backstop the way CurrentUser scope incidentally provided). Save must apply the
    // same SYSTEM/Administrators/owner-only lock-down SecurityDirAcl already gives the security
    // directory (St4i.EngineApi/Program.cs) — mirroring SecurityDirAclTests' own inheritance/SYSTEM/
    // Administrators assertions.
    //
    // This asserts against CredentialStore's OWN resolved directory (ST4I_CREDS_DIR, pointed at a
    // throwaway root by TestRunTempRoot), NOT the real %ProgramData% one. That distinction is the
    // whole point: the assertion is now made against a directory this test run created from nothing,
    // so a passing result means Save applied the ACL on this run — where asserting against the real
    // directory would have passed on an ACL some earlier run left behind.
    [Fact]
    public void Save_locks_down_creds_directory_acl()
    {
        var code = "ACL-" + Guid.NewGuid().ToString("N").Substring(0, 8);
        CredentialStore.Save(code, "mk_acl_test");

        var credsDir = Path.GetDirectoryName(PathForTest(code))!;
        var acl = new DirectoryInfo(credsDir).GetAccessControl(AccessControlSections.Access);

        // Inheritance disabled — %ProgramData%'s default Authenticated-Users grant no longer applies.
        Assert.True(acl.AreAccessRulesProtected);

        var grantedTo = acl
            .GetAccessRules(includeExplicit: true, includeInherited: true, typeof(SecurityIdentifier))
            .Cast<FileSystemAccessRule>()
            .Select(rule => (SecurityIdentifier)rule.IdentityReference)
            .ToArray();

        var system = new SecurityIdentifier(WellKnownSidType.LocalSystemSid, domainSid: null);
        var administrators = new SecurityIdentifier(WellKnownSidType.BuiltinAdministratorsSid, domainSid: null);
        Assert.Contains(grantedTo, sid => sid.Equals(system));
        Assert.Contains(grantedTo, sid => sid.Equals(administrators));
    }

    // ─────────────────────────────────────────────────────────────────────
    // 🔴 Test-hygiene batch — the isolation seam itself.
    //
    // These three are the guard on the mechanism that stops this suite writing DPAPI-sealed blobs into
    // the machine's REAL credential directory. Before the batch, CredentialStore resolved straight from
    // Environment.SpecialFolder.CommonApplicationData with NO override — the only store in the product
    // without the explicit > env > default seam its twelve siblings all had — and a census found 2,999
    // .bin files accumulated in %ProgramData%\ST4I\sim\creds as a result, 2,366 of them from xunit and
    // 633 from the Playwright e2e harness, growing on every run.
    //
    // If the seam regresses, the leak resumes silently and at full rate. Nothing else in the suite would
    // notice: every other test here still passes when the store writes to the real directory, which is
    // exactly how this went unobserved for as long as it did.
    // ─────────────────────────────────────────────────────────────────────

    [Fact]
    public void ResolveRoot_EnvOverride_ReturnsConfiguredDirectory()
    {
        var previous = Environment.GetEnvironmentVariable(CredentialStore.EnvVarDir);
        try
        {
            var tempDir = Path.Combine(Path.GetTempPath(), "st4i-creds-env-" + Guid.NewGuid().ToString("N"));
            Environment.SetEnvironmentVariable(CredentialStore.EnvVarDir, tempDir);

            Assert.Equal(tempDir, CredentialStore.ResolveRoot());
        }
        finally
        {
            Environment.SetEnvironmentVariable(CredentialStore.EnvVarDir, previous);
        }
    }

    [Fact]
    public void ResolveRoot_ExplicitDirectory_TakesPriorityOverEnvVar()
    {
        var previous = Environment.GetEnvironmentVariable(CredentialStore.EnvVarDir);
        try
        {
            Environment.SetEnvironmentVariable(
                CredentialStore.EnvVarDir, Path.Combine(Path.GetTempPath(), "st4i-creds-env-should-not-win"));
            var explicitDir = Path.Combine(Path.GetTempPath(), "st4i-creds-explicit-" + Guid.NewGuid().ToString("N"));

            Assert.Equal(explicitDir, CredentialStore.ResolveRoot(explicitDir));
        }
        finally
        {
            Environment.SetEnvironmentVariable(CredentialStore.EnvVarDir, previous);
        }
    }

    /// <summary>
    /// 🔴 The one that would actually have caught the leak, and the reason the two above are not
    /// sufficient on their own: <c>ResolveRoot</c> can be perfectly correct while <c>Save</c> ignores it.
    /// This asserts the OBSERVABLE outcome — that a <c>Save</c> lands in the redirected directory and
    /// that the real <c>%ProgramData%</c> credential directory is not touched at all — rather than the
    /// resolver's return value.
    ///
    /// <para>Note it asserts against <see cref="CredentialStore.DefaultRoot"/> explicitly, NOT against
    /// "wherever the store happens to resolve right now". Those are the same directory only when the
    /// redirect is broken, which is precisely the case this exists to detect.</para>
    /// </summary>
    [Fact]
    public void Save_WritesToTheRedirectedDirectory_AndNeverToTheRealProgramDataOne()
    {
        var previous = Environment.GetEnvironmentVariable(CredentialStore.EnvVarDir);
        var redirected = Path.Combine(Path.GetTempPath(), "st4i-creds-redirect-" + Guid.NewGuid().ToString("N"));
        var code = "REDIRECT-" + Guid.NewGuid().ToString("N")[..8];
        try
        {
            Environment.SetEnvironmentVariable(CredentialStore.EnvVarDir, redirected);

            CredentialStore.Save(code, "mk_redirect_test");

            Assert.True(File.Exists(Path.Combine(redirected, code + ".bin")),
                $"Save did not write into ST4I_CREDS_DIR ({redirected}) — the isolation seam is broken " +
                "and this suite is writing credentials into the machine's real credential store again.");
            Assert.Equal("mk_redirect_test", CredentialStore.Load(code));

            // The real directory must not have gained this machine code. Asserting on the specific file
            // rather than a directory count keeps this immune to whatever else is already in there on a
            // developer machine (and to concurrent suites).
            Assert.False(File.Exists(Path.Combine(CredentialStore.DefaultRoot(), code + ".bin")),
                "Save wrote into the REAL %ProgramData% creds directory despite ST4I_CREDS_DIR being set.");
        }
        finally
        {
            Environment.SetEnvironmentVariable(CredentialStore.EnvVarDir, previous);
            try { Directory.Delete(redirected, recursive: true); } catch { /* best-effort */ }
        }
    }

    // machineCode values used by these tests are already filename-safe (letters/digits/hyphens), so
    // this mirrors CredentialStore's own PathFor without needing its internal SanitizeFileName.
    //
    // 🔴 Test-hygiene batch — this used to compute the path from Environment.SpecialFolder.
    // CommonApplicationData DIRECTLY, i.e. the REAL %ProgramData%\ST4I\sim\creds, hardcoded. Two
    // consequences, both measured rather than reasoned about:
    //
    //   1. The Load_corrupt_blob/Load_blob_protected_with_wrong_entropy tests wrote their .bin files
    //      straight into the real credential directory and left them there. They are 572 of the 2,999
    //      files this batch found accumulated in it.
    //
    //   2. Worse, and only visible once CredentialStore became redirectable:
    //      Save_locks_down_creds_directory_acl would have asserted against the REAL directory while
    //      Save wrote to the redirected one — and it would still have PASSED, on the ACL a previous
    //      run had already applied to the real directory. A test that reads a different directory
    //      than the code under test writes is vacuous, and this one would have looked green forever.
    //
    // Resolving through CredentialStore.ResolveRoot keeps the test pointed at whatever directory the
    // store itself is using, which is the only arrangement that stays honest under redirection.
    private static string PathForTest(string machineCode) =>
        Path.Combine(CredentialStore.ResolveRoot(), machineCode + ".bin");
}
