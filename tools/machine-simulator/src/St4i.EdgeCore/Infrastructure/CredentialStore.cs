using System.Security.Cryptography;
using System.Text;

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

    private static string PathFor(string machineCode)
    {
        var root = Environment.GetFolderPath(Environment.SpecialFolder.CommonApplicationData);
        var dir = Path.Combine(root, "ST4I", "sim", "creds");
        return Path.Combine(dir, SanitizeFileName(machineCode) + ".bin");
    }

    /// <summary>Strips characters that aren't valid in a Windows filename so an arbitrary
    /// <c>machineCode</c> can't escape the creds directory or collide with reserved names.</summary>
    private static string SanitizeFileName(string machineCode)
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
