using System.Security.Cryptography;
using System.Text;
using System.Linq;

namespace St4i.EdgeCore.Infrastructure;

/// <summary>
/// Persists a machine's <c>mk_</c> API key on disk, DPAPI-encrypted to the local MACHINE
/// (<see cref="DataProtectionScope.LocalMachine"/> — FF-2) so the plaintext key never touches disk
/// and so it can be decrypted back by any principal on this same machine, not just whichever
/// Windows user originally ran <see cref="Save"/>. This matters because a machine is often
/// onboarded interactively (as a logged-in operator) but later run as a different account (e.g. a
/// Windows Service/LocalSystem) — <see cref="DataProtectionScope.CurrentUser"/> would make that
/// re-decrypt fail. The confidentiality boundary this relies on instead is filesystem ACLs on the
/// containing directory tree — same rationale as WS-D's DataProtection key-ring
/// <c>protectToLocalMachine: true</c>. A <c>LocalMachine</c>-scoped blob is decryptable by ANY local
/// account, so — unlike under the old <c>CurrentUser</c> scope, where a "wrong Windows account" was
/// itself a (accidental) backstop — the ACL on the creds directory is now the ENTIRE confidentiality
/// boundary. <see cref="Save"/> therefore applies <see cref="SecurityDirAcl.Apply"/> to the creds
/// directory every time it (re-)creates/ensures it exists (FF-2 review fix), so this class enforces its
/// own boundary rather than depending on a caller to have hardened it separately.
///
/// One file per machine under the resolved creds directory — explicit argument, else
/// <see cref="EnvVarDir"/> (<c>ST4I_CREDS_DIR</c>), else <see cref="DefaultRoot"/>
/// (<c>%ProgramData%\ST4I\sim\creds</c>) — so the WPF app/edge service can hold credentials for an
/// entire simulated fleet side by side.
///
/// <para><b>Why the directory is redirectable (test-hygiene batch).</b> This class used to resolve its
/// directory straight from <see cref="Environment.SpecialFolder.CommonApplicationData"/> with no
/// override, which made it the ONLY store in this product that a test could not point somewhere
/// harmless — every sibling (<c>AlarmStore</c>, <c>ConnectorConfigStore</c>,
/// <c>NotificationConfigStore</c>, <c>BridgeSpool</c>, <c>FleetSettingsStore</c>,
/// <c>DeviceIdentityStore</c>, ...) already resolved explicit&gt;env&gt;default. The consequence was
/// not theoretical: the xunit suites and the Playwright e2e harness between them had written ~3,000
/// DPAPI-sealed <c>.bin</c> blobs into the REAL credential directory of this machine — the exact
/// directory <c>packaging/remove-data.ps1</c> exists to purge on decommissioning, and the exact
/// directory an operator is told holds device credentials. Giving this class the same seam its
/// siblings already had is what lets a test run write somewhere disposable instead.</para>
///
/// <para><b>Resolution is per-call, not cached</b> — same as every sibling store's
/// <c>ResolveRoot</c>. A test that sets <see cref="EnvVarDir"/> after this class has already been
/// touched still gets the redirect, which matters because this is a STATIC class with no
/// construction point a fixture could hook.</para>
///
/// <para><b>Keep <see cref="DefaultRoot"/>'s <c>"ST4I", "sim", "creds"</c> literal intact:</b>
/// <c>NotificationDocumentationTests.EveryDirectoryTheEngineCreatesUnderProgramData_IsPurgedByTheDecommissioningScript</c>
/// discovers the set of directories a decommissioning wipe must purge by scanning <c>src/</c> for
/// exactly that literal shape. Inlining or computing the segment names would make this store
/// invisible to that scan and silently drop it from the wipe.</para>
///
/// NOTE (FF-2, breaking): this switches the DPAPI scope from <c>CurrentUser</c> to <c>LocalMachine</c>,
/// so a <c>.bin</c> file written by a pre-FF-2 build can no longer be decrypted here — <see cref="Load"/>
/// treats that (and any other corrupt/foreign blob) as "no stored key" rather than throwing, so the
/// caller's normal empty-credential path (re-claim) kicks in instead of a crash.
/// </summary>
public static class CredentialStore
{
    /// <summary>Relocates the whole store — the same "tests (and a decommissioning wipe) get an
    /// explicit, redirectable directory instead of the real one" seam every sibling store already
    /// exposes (<see cref="St4i.EdgeCore.Config.FleetSettingsStore.EnvVarDir"/>,
    /// <see cref="St4i.EdgeCore.Identity.DeviceIdentityStore.EnvVarDir"/>, ...). Unset or blank means
    /// "use <see cref="DefaultRoot"/>".</summary>
    public const string EnvVarDir = "ST4I_CREDS_DIR";

    private static readonly byte[] Entropy = Encoding.UTF8.GetBytes("st4i.edgecore.credentialstore.v1");

    /// <summary>DPAPI-protects <paramref name="mkKey"/> and writes it to this machine's credential file
    /// (creating the containing directory tree if needed, and locking down its ACL — see this class's
    /// own doc comment and <see cref="SecurityDirAcl"/> — every time, so an install upgraded from a
    /// pre-FF-2 build gets self-healed on the very next credential save, not just a fresh one).</summary>
    public static void Save(string machineCode, string mkKey)
    {
        ArgumentException.ThrowIfNullOrEmpty(machineCode);
        ArgumentException.ThrowIfNullOrEmpty(mkKey);

        var path = PathFor(machineCode);
        var dir = Path.GetDirectoryName(path)!;
        Directory.CreateDirectory(dir);

        // FF-2 review fix — restrict the creds directory to SYSTEM/Administrators/owner only, the exact
        // same lock-down St4i.EngineApi's Program.cs already applies to the security directory. Runs
        // unconditionally on every Save (self-healing, best-effort, never throws — see
        // SecurityDirAcl.Apply's own doc comment), not just when the directory is first created.
        SecurityDirAcl.Apply(dir, msg => Console.Error.WriteLine($"[credentialstore] {msg}"));

        var plain = Encoding.UTF8.GetBytes(mkKey);
        var protectedBytes = ProtectedData.Protect(plain, Entropy, DataProtectionScope.LocalMachine);
        File.WriteAllBytes(path, protectedBytes);
    }

    /// <summary>Lists the machine codes that currently have a saved credential file — the raw filename
    /// stems under the creds directory (Task 19a: Settings' stored-credentials view), NOT their
    /// decrypted mk_ values. Returns an empty list (not an exception) if the creds directory doesn't
    /// exist yet, e.g. a fresh install that has never called <see cref="Save"/>.</summary>
    public static IReadOnlyList<string> ListMachineCodes()
    {
        var dir = CredsDir();
        if (!Directory.Exists(dir)) return Array.Empty<string>();

        return Directory.EnumerateFiles(dir, "*.bin")
            .Select(Path.GetFileNameWithoutExtension)
            .Where(name => !string.IsNullOrEmpty(name))
            .Select(name => name!)
            .OrderBy(name => name, StringComparer.OrdinalIgnoreCase)
            .ToList();
    }

    /// <summary>Reads and DPAPI-unprotects the stored key for <paramref name="machineCode"/>, or
    /// <c>null</c> if no credential file exists for it OR its bytes can't be unprotected (FF-2: a
    /// corrupt file, one encrypted under a different DPAPI scope/entropy — e.g. a pre-FF-2
    /// <c>CurrentUser</c>-encrypted <c>.bin</c> — or one copied in from a different machine all throw
    /// <see cref="CryptographicException"/> from <see cref="ProtectedData.Unprotect"/>; all of those are
    /// treated the same as "no stored key" so a caller's normal empty-credential path (forcing a
    /// re-claim) runs instead of an unhandled crash).</summary>
    public static string? Load(string machineCode)
    {
        ArgumentException.ThrowIfNullOrEmpty(machineCode);

        var path = PathFor(machineCode);
        if (!File.Exists(path)) return null;

        var protectedBytes = File.ReadAllBytes(path);
        byte[] plain;
        try
        {
            plain = ProtectedData.Unprotect(protectedBytes, Entropy, DataProtectionScope.LocalMachine);
        }
        catch (CryptographicException)
        {
            return null;
        }
        return Encoding.UTF8.GetString(plain);
    }

    private static string PathFor(string machineCode) =>
        Path.Combine(CredsDir(), SanitizeFileName(machineCode) + ".bin");

    private static string CredsDir() => ResolveRoot();

    /// <summary>The default creds root: <c>%ProgramData%\ST4I\sim\creds</c> — a SIBLING of
    /// <c>...\sim\identity</c>/<c>...\sim\settings</c>/<c>...\sim\alarms</c>, never the same directory
    /// as any of those. See this class's own doc comment before changing the literal.</summary>
    public static string DefaultRoot() => Path.Combine(
        Environment.GetFolderPath(Environment.SpecialFolder.CommonApplicationData), "ST4I", "sim", "creds");

    /// <summary>Resolves the effective creds directory: <paramref name="directory"/> if given, else
    /// <see cref="EnvVarDir"/> if set, else <see cref="DefaultRoot"/>. Pure path arithmetic — does not
    /// create anything on disk (<see cref="Save"/> does that). Identical shape to every sibling store's
    /// <c>ResolveRoot</c>, deliberately, so there is one idiom to learn rather than two.</summary>
    public static string ResolveRoot(string? directory = null)
    {
        if (!string.IsNullOrWhiteSpace(directory)) return directory;
        var env = Environment.GetEnvironmentVariable(EnvVarDir);
        return string.IsNullOrWhiteSpace(env) ? DefaultRoot() : env;
    }

    /// <summary>Strips characters that aren't valid in a Windows filename so an arbitrary
    /// <c>machineCode</c> can't escape the creds directory or collide with reserved names.
    /// <c>internal</c> (not <c>private</c>) so other St4i.EdgeCore path-resolution code — e.g.
    /// WS-C's <see cref="St4i.EdgeCore.Transport.WalOptions.ResolveQueueFile"/> — can reuse the exact
    /// same sanitization instead of re-implementing it; behavior is unchanged.</summary>
    internal static string SanitizeFileName(string machineCode)
    {
        var invalid = Path.GetInvalidFileNameChars();
        var sb = new StringBuilder(machineCode.Length);
        foreach (var c in machineCode)
        {
            sb.Append(invalid.Contains(c) ? '_' : c);
        }
        return sb.ToString();
    }
}
