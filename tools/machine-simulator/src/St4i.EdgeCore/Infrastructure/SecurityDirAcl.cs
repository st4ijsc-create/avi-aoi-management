using System.Runtime.Versioning;
using System.Security.AccessControl;
using System.Security.Principal;

namespace St4i.EdgeCore.Infrastructure;

/// <summary>
/// WS-D final-security-review I-1(a) (originated in <c>St4i.EngineApi</c>; moved here under FF-2 review so
/// EVERY host that stores local secrets under <c>%ProgramData%\ST4I\sim\*</c> — not just
/// <c>St4i.EngineApi</c> — can apply the exact same lock-down with zero duplicated logic) — a best-effort
/// ACL lock-down for a "security-sensitive" leaf directory. Two current call sites:
/// <list type="bullet">
/// <item><c>St4i.EngineApi.Program.cs</c> — the security ROOT directory (<c>...\sim\security</c>, parent of
/// BOTH <c>security.db</c> — PBKDF2 password hashes + the hash-chained audit log — and the <c>keys\</c>
/// subdirectory the DataProtection key ring lives under).</item>
/// <item><see cref="CredentialStore"/> (FF-2 review fix) — the creds directory (<c>...\sim\creds</c>) that
/// holds every machine's DPAPI-protected <c>mk_</c> <c>.bin</c> file. This one matters MORE after FF-2
/// switched <see cref="CredentialStore"/> to <see cref="System.Security.Cryptography.DataProtectionScope.LocalMachine"/>:
/// a <c>LocalMachine</c>-scoped blob is decryptable by ANY local account, so the ACL on the directory
/// containing it becomes the ENTIRE confidentiality boundary (there is no longer a "wrong Windows account"
/// backstop the way <c>CurrentUser</c> scope used to provide).</item>
/// </list>
/// <c>%ProgramData%</c>'s default ACL grants <c>Authenticated Users</c> Read (+ subfolder/file
/// inheritance), so WITHOUT this fix any local non-admin account can read whatever lives under an
/// unprotected directory — the key ring (letting them forge a <c>role=Admin</c> cookie — the original I-1
/// finding), the password-hash/audit database, or a stored <c>mk_</c> credential.
///
/// Disables inheritance on the directory and replaces every inherited rule with exactly three explicit
/// FullControl grants: <c>NT AUTHORITY\SYSTEM</c>, <c>BUILTIN\Administrators</c>, and the directory's
/// current owner (normally whichever account first started this process/installed the product) — nobody
/// else, including <c>Authenticated Users</c>/<c>Everyone</c>, keeps any access at all.
///
/// Scope note: this only touches the ONE directory object passed in, not a recursive re-ACL of any files/
/// subdirectories that may already exist under it from a run before this fix shipped (Windows does not
/// propagate a parent ACL change onto already-materialized child ACEs without an explicit recursive walk,
/// which is out of scope here). On a FRESH deployment (the common case — no content exists yet the first
/// time a call site creates this directory) that's a non-issue: every child created AFTER this call
/// inherits the restricted ACL, because <see cref="FileSystemAccessRule"/> below sets container+object
/// inherit flags. An UPGRADE of an existing, previously-unprotected install still gets the root directory
/// itself locked down the next time a call site runs this (self-healing — both call sites run it
/// unconditionally every time, not just once), which is an improvement even though pre-existing children
/// keep whatever ACL they already had until they're rewritten/recreated.
/// </summary>
[SupportedOSPlatform("windows")]
public static class SecurityDirAcl
{
    /// <summary>Applies the lock-down described in this class's own doc comment to <paramref name="path"/>
    /// (which must already exist — callers create the directory first). Deliberately best-effort: ANY
    /// exception (unsupported filesystem, non-Windows CI container despite the <c>net10.0-windows</c> TFM,
    /// insufficient privilege to write a DACL, ...) is caught and reported via <paramref name="logWarning"/>
    /// instead of propagating — a local-confidentiality hardening step must never be able to crash startup
    /// or a credential save (see this method's call sites, and the I-1 fix's own "never crash startup"
    /// requirement). When that happens the directory is simply left with whatever ACL it already had
    /// (typically the permissive <c>%ProgramData%</c> default this fix exists to remove) — the warning is
    /// the operator's signal to lock it down manually (e.g. <c>icacls</c>) if this automatic path didn't
    /// work in their environment.</summary>
    public static void Apply(string path, Action<string> logWarning)
    {
        try
        {
            var dirInfo = new DirectoryInfo(path);
            var acl = dirInfo.GetAccessControl(AccessControlSections.Access | AccessControlSections.Owner);

            // Capture the current owner BEFORE stripping inherited rules, so that account (normally
            // whoever this process is running as) keeps an explicit grant instead of being locked out of
            // its own security directory.
            var owner = acl.GetOwner(typeof(SecurityIdentifier)) as SecurityIdentifier;

            // isProtected: true stops this object from inheriting any FUTURE parent ACL changes too;
            // preserveInheritance: false additionally drops the rules it just inherited (rather than
            // converting them into equivalent explicit rules) — the whole point is to remove
            // %ProgramData%'s default Authenticated-Users read, not preserve a copy of it.
            acl.SetAccessRuleProtection(isProtected: true, preserveInheritance: false);

            // Existing rules were just discarded above (preserveInheritance: false) — add back exactly the
            // three principals this directory should ever be readable/writable by.
            AddFullControl(acl, new SecurityIdentifier(WellKnownSidType.LocalSystemSid, domainSid: null));
            AddFullControl(acl, new SecurityIdentifier(WellKnownSidType.BuiltinAdministratorsSid, domainSid: null));
            if (owner is not null)
            {
                AddFullControl(acl, owner);
            }

            dirInfo.SetAccessControl(acl);
        }
        catch (Exception ex)
        {
            logWarning(
                $"Could not restrict ACL on directory '{path}' ({ex.GetType().Name}: {ex.Message}). " +
                "Its contents (e.g. security.db/the DataProtection key ring, or CredentialStore's mk_ .bin " +
                "files) may remain readable by other local accounts until this is fixed manually (e.g. via " +
                "icacls) — see SecurityDirAcl.Apply's doc comment.");
        }
    }

    private static void AddFullControl(DirectorySecurity acl, SecurityIdentifier sid) =>
        acl.AddAccessRule(new FileSystemAccessRule(
            sid,
            FileSystemRights.FullControl,
            InheritanceFlags.ContainerInherit | InheritanceFlags.ObjectInherit,
            PropagationFlags.None,
            AccessControlType.Allow));
}
