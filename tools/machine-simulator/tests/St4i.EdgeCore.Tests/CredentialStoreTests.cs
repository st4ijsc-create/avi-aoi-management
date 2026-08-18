using System;
using System.Globalization;
using System.IO;
using System.Linq;
using System.Security.AccessControl;
using System.Security.Principal;
using St4i.EdgeCore.Infrastructure;
using Xunit;

// 🔴 Task F-1 — three tests below flip the PROCESS-WIDE ST4I_CREDS_DIR. So does
// PerHostDataRootIsolationTests. Sharing one collection is what keeps them from interleaving; see
// MachineWideStoreEnvCollection for what that guarantee is and is not.
[Collection("St4i.EdgeCore.Tests.MachineWideStoreEnv")]
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
    // .bin files accumulated in %ProgramData%\ST4I\sim\creds as a result, growing on every run. That
    // total decomposes exactly, and it is worth carrying whole rather than as two of its four parts:
    // 2,366 xunit + 613 Playwright e2e + 9 named-and-traced + 11 untraceable (kept) = 2,999
    // (backlog-test-hygiene/leak-report.md:13 for the measured total, §2a/§2b for the split).
    // 🔴 The e2e share read 633 here and in four other places until task K-1 re-measured it; the census
    // says 613 in both places it counts. 633 is not a variant reading of anything — it is 613 + the 20
    // files (9 named + 11 kept) that belong to the other two parts, which is why the wrong number still
    // added up to 2,999 and survived unchallenged.
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

    // ─────────────────────────────────────────────────────────────────────
    // 🔴 TASK Z-1 — item 10 of docs/owner-decisions.md, decided by the OWNER on 2026-08-18:
    // KEEP THE OLD BLOB UNDER ANOTHER NAME rather than overwrite it.
    //
    // What was measured before this: Load answers null both for "no file" and for "a file this process
    // cannot unprotect", the caller cannot branch, so it takes the re-claim path, and the re-claim path
    // calls Save — which overwrote. A blob sealed under a different DPAPI scope or copied from another
    // machine is READABLE AGAIN once the environment is repaired, while it still exists. So a
    // recoverable environment fault became an unrecoverable loss, silently.
    //
    // These five are the fix, measured at the three outcomes Save now distinguishes plus the two
    // properties an operator depends on: that the kept file is findable, and that it is never reported
    // as a stored credential.
    // ─────────────────────────────────────────────────────────────────────

    /// <summary>🔴 <b>The one the decision is about.</b> A blob is present, this process cannot decrypt
    /// it, and a re-claim arrives. The new credential must land AND the old bytes must still be on disk
    /// afterwards, byte for byte, under a name that says what they are.</summary>
    [Fact]
    public void Save_OverABlobThisProcessCannotDecrypt_KeepsTheOldBytesAside_UnderANameThatSaysWhy()
    {
        var previous = Environment.GetEnvironmentVariable(CredentialStore.EnvVarDir);
        var root = Path.Combine(Path.GetTempPath(), "st4i-creds-keepaside-" + Guid.NewGuid().ToString("N"));
        try
        {
            Environment.SetEnvironmentVariable(CredentialStore.EnvVarDir, root);
            Directory.CreateDirectory(root);

            var code = "Z1-UNUSABLE-" + Guid.NewGuid().ToString("N")[..8];
            var live = Path.Combine(root, code + ".bin");
            var unusable = "these bytes are not a DPAPI envelope this machine can unprotect"u8.ToArray();
            File.WriteAllBytes(live, unusable);

            // Premise, in both directions: the bytes are where the store looks, and the store really
            // cannot use them — so the caller really is on the re-claim path.
            Assert.True(File.Exists(live));
            Assert.Null(CredentialStore.Load(code));

            CredentialStore.Save(code, "mk_reclaimed_after_the_unreadable_blob_was_kept");

            // The re-claim still works — this is a data MOVE, not a refusal. Refusing here would leave a
            // machine unable to onboard over a blob nobody can read, which is a worse end than the one
            // the decision was taken to prevent.
            Assert.Equal("mk_reclaimed_after_the_unreadable_blob_was_kept", CredentialStore.Load(code));

            // 🔴 The measurement: the old bytes are still on disk, byte for byte, beside the live blob.
            var names = Directory.GetFiles(root).Select(Path.GetFileName)
                .OrderBy(n => n, StringComparer.Ordinal).ToList();
            var kept = Assert.Single(
                names, n => n!.StartsWith(code + ".bin.unreadable-", StringComparison.Ordinal));
            Assert.Equal(unusable, File.ReadAllBytes(Path.Combine(root, kept!)));

            // …and the directory holds exactly those two files, so nothing was deleted on the way.
            Assert.Equal(
                new[] { code + ".bin", kept }.OrderBy(n => n, StringComparer.Ordinal).ToList(), names);
        }
        finally
        {
            Environment.SetEnvironmentVariable(CredentialStore.EnvVarDir, previous);
            try { Directory.Delete(root, recursive: true); } catch { /* best-effort */ }
        }
    }

    /// <summary>🔴 The half that stops the fix from being a sweep: a blob this process CAN unprotect is
    /// still replaced, and nothing is kept aside. That is an ordinary re-key, the caller holds the new
    /// key, and no recoverable bytes are at stake — keeping a copy of every superseded credential would
    /// be an accumulating pile of live secrets nobody asked for.</summary>
    [Fact]
    public void Save_OverAUsableBlob_ReplacesIt_AndKeepsNothingAside()
    {
        var previous = Environment.GetEnvironmentVariable(CredentialStore.EnvVarDir);
        var root = Path.Combine(Path.GetTempPath(), "st4i-creds-rekey-" + Guid.NewGuid().ToString("N"));
        try
        {
            Environment.SetEnvironmentVariable(CredentialStore.EnvVarDir, root);

            var code = "Z1-REKEY-" + Guid.NewGuid().ToString("N")[..8];
            CredentialStore.Save(code, "mk_first");
            Assert.Equal("mk_first", CredentialStore.Load(code));

            CredentialStore.Save(code, "mk_second");

            Assert.Equal("mk_second", CredentialStore.Load(code));
            Assert.Equal(new[] { code + ".bin" },
                Directory.GetFiles(root).Select(Path.GetFileName).ToArray());
        }
        finally
        {
            Environment.SetEnvironmentVariable(CredentialStore.EnvVarDir, previous);
            try { Directory.Delete(root, recursive: true); } catch { /* best-effort */ }
        }
    }

    /// <summary>The third outcome, and the one a first onboarding takes: nothing at the path, so nothing
    /// to keep. Without this the two above would both be consistent with a Save that keeps something
    /// aside on every call.</summary>
    [Fact]
    public void Save_WithNothingAtThePath_WritesTheOneFile_AndKeepsNothingAside()
    {
        var previous = Environment.GetEnvironmentVariable(CredentialStore.EnvVarDir);
        var root = Path.Combine(Path.GetTempPath(), "st4i-creds-firstsave-" + Guid.NewGuid().ToString("N"));
        try
        {
            Environment.SetEnvironmentVariable(CredentialStore.EnvVarDir, root);

            var code = "Z1-FIRST-" + Guid.NewGuid().ToString("N")[..8];
            CredentialStore.Save(code, "mk_first_ever");

            Assert.Equal(new[] { code + ".bin" },
                Directory.GetFiles(root).Select(Path.GetFileName).ToArray());
        }
        finally
        {
            Environment.SetEnvironmentVariable(CredentialStore.EnvVarDir, previous);
            try { Directory.Delete(root, recursive: true); } catch { /* best-effort */ }
        }
    }

    /// <summary>🔴 <b>Pinned rather than reasoned about, because the reasoning is wrong on Windows often
    /// enough to matter.</b> <c>ListMachineCodes</c> enumerates <c>*.bin</c>, and a three-character
    /// extension makes Win32 pattern matching return names whose extension merely BEGINS with it
    /// (<c>*.xls</c> famously returns <c>book.xlsx</c>). A kept-aside blob reported as a stored
    /// credential would tell the Settings view that a machine still has a key it cannot use.</summary>
    [Fact]
    public void ListMachineCodes_DoesNotReportABlobThatWasKeptAside()
    {
        var previous = Environment.GetEnvironmentVariable(CredentialStore.EnvVarDir);
        var root = Path.Combine(Path.GetTempPath(), "st4i-creds-listing-" + Guid.NewGuid().ToString("N"));
        try
        {
            Environment.SetEnvironmentVariable(CredentialStore.EnvVarDir, root);
            Directory.CreateDirectory(root);

            var code = "Z1-LISTING-" + Guid.NewGuid().ToString("N")[..8];
            File.WriteAllBytes(Path.Combine(root, code + ".bin"), "not a DPAPI envelope"u8.ToArray());
            CredentialStore.Save(code, "mk_after_the_keep_aside");

            var kept = Directory.GetFiles(root)
                .Select(Path.GetFileName)
                .Where(f => f!.Contains(".bin.unreadable-", StringComparison.Ordinal))
                .ToList();
            Assert.Single(kept);

            // The live blob is listed ONCE, under the machine code, and the kept-aside file contributes
            // no entry of its own — not under a stem ending in ".bin" and not under any other.
            var listed = CredentialStore.ListMachineCodes();
            Assert.Single(listed, c => string.Equals(c, code, StringComparison.OrdinalIgnoreCase));
            Assert.DoesNotContain(listed, c => c.Contains("unreadable", StringComparison.OrdinalIgnoreCase));
        }
        finally
        {
            Environment.SetEnvironmentVariable(CredentialStore.EnvVarDir, previous);
            try { Directory.Delete(root, recursive: true); } catch { /* best-effort */ }
        }
    }

    /// <summary>🔴 <b>The name collision the decision explicitly left to this task, forced rather than
    /// hoped for.</b> The kept-aside name carries a UTC stamp to the SECOND, so two keeps inside one
    /// second would land on the same name; running two saves back to back and hoping the clock cooperates
    /// would be a test whose subject depends on how fast the machine is. So the colliding names are
    /// PRE-CREATED — both the current second and the next one, which closes the roll-over between
    /// computing the stamp here and <c>Save</c> computing its own — and the assertion is that neither
    /// pre-created file changed by one byte.
    ///
    /// <para>The guarantee underneath is structural, not arithmetic: the move uses the
    /// <c>File.Move</c> overload WITHOUT the overwrite flag, which throws rather than replaces. The
    /// free-name search only decides how readable the result is.</para></summary>
    [Fact]
    public void Save_KeepingABlobAside_NeverOverwritesAKeptBlobThatIsAlreadyThere()
    {
        var previous = Environment.GetEnvironmentVariable(CredentialStore.EnvVarDir);
        var root = Path.Combine(Path.GetTempPath(), "st4i-creds-collide-" + Guid.NewGuid().ToString("N"));
        try
        {
            Environment.SetEnvironmentVariable(CredentialStore.EnvVarDir, root);
            Directory.CreateDirectory(root);

            var code = "Z1-COLLIDE-" + Guid.NewGuid().ToString("N")[..8];
            var live = Path.Combine(root, code + ".bin");

            // Both candidate stamps, so the collision happens whichever side of a second boundary Save
            // lands on. The sentinel content is what proves neither was touched.
            var now = DateTime.UtcNow;
            var occupied = new[] { now, now.AddSeconds(1) }
                .Select(t => Path.Combine(
                    root,
                    code + ".bin.unreadable-" + t.ToString("yyyyMMdd'T'HHmmss'Z'", CultureInfo.InvariantCulture)))
                .ToList();
            var sentinel = "AN EARLIER KEPT BLOB THAT MUST SURVIVE"u8.ToArray();
            foreach (var taken in occupied) File.WriteAllBytes(taken, sentinel);

            var unusable = "the blob being kept aside now"u8.ToArray();
            File.WriteAllBytes(live, unusable);

            CredentialStore.Save(code, "mk_after_a_collision");

            // Neither pre-existing kept blob moved by a byte.
            foreach (var taken in occupied) Assert.Equal(sentinel, File.ReadAllBytes(taken));

            // …and this keep found a free name of its own and holds the bytes it was given.
            var fresh = Directory.GetFiles(root)
                .Where(f => Path.GetFileName(f)!.StartsWith(code + ".bin.unreadable-", StringComparison.Ordinal)
                         && !occupied.Contains(f, StringComparer.OrdinalIgnoreCase))
                .ToList();
            Assert.Equal(unusable, File.ReadAllBytes(Assert.Single(fresh)));
            Assert.Equal("mk_after_a_collision", CredentialStore.Load(code));
        }
        finally
        {
            Environment.SetEnvironmentVariable(CredentialStore.EnvVarDir, previous);
            try { Directory.Delete(root, recursive: true); } catch { /* best-effort */ }
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
