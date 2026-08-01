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
    // directory (St4i.EngineApi/Program.cs) — asserted here directly against the real creds directory
    // (there's no ST4I_CREDS_DIR override to redirect this to a temp dir, same as every other test in
    // this file), mirroring SecurityDirAclTests' own inheritance/SYSTEM/Administrators assertions.
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

    // machineCode values used by these tests are already filename-safe (letters/digits/hyphens), so
    // this mirrors CredentialStore's own PathFor without needing its internal SanitizeFileName.
    private static string PathForTest(string machineCode)
    {
        var root = Environment.GetFolderPath(Environment.SpecialFolder.CommonApplicationData);
        return Path.Combine(root, "ST4I", "sim", "creds", machineCode + ".bin");
    }
}
