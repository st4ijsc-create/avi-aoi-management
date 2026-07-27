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
/// <c>protectToLocalMachine: true</c> (see <c>St4i.EngineApi.Auth.SecurityDirAcl</c>) — restricting
/// this directory to admins is a deployment-hardening step, not something this class enforces itself.
///
/// One file per machine under <c>%ProgramData%\ST4I\sim\creds\&lt;machineCode&gt;.bin</c>, so the
/// WPF app/edge service can hold credentials for an entire simulated fleet side by side.
///
/// NOTE (FF-2, breaking): this switches the DPAPI scope from <c>CurrentUser</c> to <c>LocalMachine</c>,
/// so a <c>.bin</c> file written by a pre-FF-2 build can no longer be decrypted here — <see cref="Load"/>
/// treats that (and any other corrupt/foreign blob) as "no stored key" rather than throwing, so the
/// caller's normal empty-credential path (re-claim) kicks in instead of a crash.
/// </summary>
public static class CredentialStore
{
    private static readonly byte[] Entropy = Encoding.UTF8.GetBytes("st4i.edgecore.credentialstore.v1");

    /// <summary>DPAPI-protects <paramref name="mkKey"/> and writes it to this machine's credential file
    /// (creating the containing directory tree if needed).</summary>
    public static void Save(string machineCode, string mkKey)
    {
        ArgumentException.ThrowIfNullOrEmpty(machineCode);
        ArgumentException.ThrowIfNullOrEmpty(mkKey);

        var path = PathFor(machineCode);
        Directory.CreateDirectory(Path.GetDirectoryName(path)!);

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

    private static string CredsDir()
    {
        var root = Environment.GetFolderPath(Environment.SpecialFolder.CommonApplicationData);
        return Path.Combine(root, "ST4I", "sim", "creds");
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
