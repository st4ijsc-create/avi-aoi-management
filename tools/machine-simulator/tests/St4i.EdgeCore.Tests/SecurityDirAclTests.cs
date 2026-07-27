using System.Security.AccessControl;
using System.Security.Principal;
using St4i.EdgeCore.Infrastructure;
using Xunit;

/// <summary>
/// WS-D final-security-review I-1(a) — unit coverage for <see cref="SecurityDirAcl.Apply"/>, extracted into
/// its own testable helper specifically so this hardening step doesn't have to be verified only "by
/// inspection". Moved here from St4i.EngineApi.Tests (FF-2 review) alongside the class itself, so it lives
/// next to its EdgeCore home — both St4i.EngineApi's security-dir startup call AND
/// <see cref="CredentialStore"/>'s creds-dir call (see <c>CredentialStoreTests</c>) now share this exact
/// same helper.
///
/// Runs for real against the filesystem (no mocking): the whole point of I-1(a) is genuine
/// <see cref="System.Security.AccessControl"/> behavior, and a normal account's own temp directory always
/// has enough privilege to set its own directory's DACL, so a real failure here would be an actual bug, not
/// an environment limitation.
/// </summary>
public sealed class SecurityDirAclTests
{
    [Fact]
    public void Apply_OnFreshDirectory_NeverThrows_DisablesInheritance_AndGrantsSystemAndAdministrators()
    {
        var dir = Directory.CreateTempSubdirectory("st4i-security-acl-test-").FullName;
        var warnings = new List<string>();

        var exception = Record.Exception(() => SecurityDirAcl.Apply(dir, warnings.Add));

        Assert.Null(exception); // Apply's own contract: never throws, regardless of outcome.
        Assert.True(Directory.Exists(dir));

        // A real failure (unsupported filesystem, no privilege to write a DACL, ...) is reported through
        // the warning callback instead of an exception — assert the ACL was ACTUALLY applied in this
        // environment, rather than accepting "no exception" alone as proof the hardening worked.
        Assert.Empty(warnings);

        var acl = new DirectoryInfo(dir).GetAccessControl(AccessControlSections.Access);

        // Inheritance disabled — %ProgramData%'s default Authenticated-Users grant no longer applies to
        // this directory.
        Assert.True(acl.AreAccessRulesProtected);

        var rules = acl.GetAccessRules(includeExplicit: true, includeInherited: true, typeof(SecurityIdentifier));
        var grantedTo = rules
            .Cast<FileSystemAccessRule>()
            .Select(rule => (SecurityIdentifier)rule.IdentityReference)
            .ToArray();

        var system = new SecurityIdentifier(WellKnownSidType.LocalSystemSid, domainSid: null);
        var administrators = new SecurityIdentifier(WellKnownSidType.BuiltinAdministratorsSid, domainSid: null);
        Assert.Contains(grantedTo, sid => sid.Equals(system));
        Assert.Contains(grantedTo, sid => sid.Equals(administrators));
    }

    [Fact]
    public void Apply_OnMissingDirectory_LogsWarning_InsteadOfThrowing()
    {
        var missingDir = Path.Combine(
            Path.GetTempPath(), "st4i-security-acl-test-missing-" + Guid.NewGuid().ToString("N"));
        var warnings = new List<string>();

        var exception = Record.Exception(() => SecurityDirAcl.Apply(missingDir, warnings.Add));

        // Best-effort per Apply's own contract: a directory that doesn't exist can't have its ACL set, but
        // that must surface as a logged warning, never an unhandled exception that could take startup down
        // with it.
        Assert.Null(exception);
        Assert.NotEmpty(warnings);
    }
}
