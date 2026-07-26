using System.Security.Cryptography;
using System.Text;
using System.Linq;

namespace St4i.EdgeCore.Infrastructure;

/// <summary>
/// Persists a machine's <c>mk_</c> API key on disk, DPAPI-encrypted to the current Windows user
/// (<see cref="DataProtectionScope.CurrentUser"/>) so the plaintext key never touches disk — only
/// a principal logged in as this same Windows user (on this same machine) can decrypt it back.
///
/// One file per machine under <c>%ProgramData%\ST4I\sim\creds\&lt;machineCode&gt;.bin</c>, so the
/// WPF app/edge service can hold credentials for an entire simulated fleet side by side.
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
        var protectedBytes = ProtectedData.Protect(plain, Entropy, DataProtectionScope.CurrentUser);
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
    /// <c>null</c> if no credential file exists for it.</summary>
    public static string? Load(string machineCode)
    {
        ArgumentException.ThrowIfNullOrEmpty(machineCode);

        var path = PathFor(machineCode);
        if (!File.Exists(path)) return null;

        var protectedBytes = File.ReadAllBytes(path);
        var plain = ProtectedData.Unprotect(protectedBytes, Entropy, DataProtectionScope.CurrentUser);
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
