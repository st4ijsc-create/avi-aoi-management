using System.Security.Cryptography;

namespace St4i.EdgeCore.Updates;

/// <summary>
/// WS-F4 Task 2 — one update bundle on disk: a directory holding <c>manifest.json</c>,
/// <c>manifest.sig</c>, the <c>.msi</c> payload and an unsigned <c>RELEASE-NOTES.txt</c>.
///
/// <para>🔴 <b>This type READS. It never executes, never installs and never changes anything.</b> Every
/// method here is pure computation over files, which is what makes the dry-run verb possible: an engineer
/// can validate a USB stick at their desk on Tuesday rather than discovering it is truncated at 2am on
/// Saturday inside the maintenance window.</para>
///
/// <para><b>Offline is the primary path, not a fallback.</b> A bundle is a plain directory copied
/// verbatim — no archive format, nothing to unpack, nothing that needs a network. A factory has no
/// internet, so a USB stick or an internal share IS the delivery mechanism and everything here is shaped
/// for it.</para>
/// </summary>
public sealed class UpdateBundle
{
    /// <summary>The signed document. The only file verified cryptographically.</summary>
    public const string ManifestFileName = "manifest.json";

    /// <summary>The detached Ed25519 signature over <see cref="ManifestFileName"/>'s raw bytes.</summary>
    public const string SignatureFileName = "manifest.sig";

    /// <summary>🔴 Human-readable notes that are <b>deliberately OUTSIDE the signature</b>. See
    /// <see cref="ReleaseNotes"/> for what that obliges every caller to do.</summary>
    public const string ReleaseNotesFileName = "RELEASE-NOTES.txt";

    private UpdateBundle(string directory) => Directory = directory;

    /// <summary>The bundle's directory — a USB stick path, a UNC share, or a staged folder.</summary>
    public string Directory { get; }

    /// <summary>Full path of the manifest.</summary>
    public string ManifestPath => Path.Combine(Directory, ManifestFileName);

    /// <summary>Full path of the detached signature.</summary>
    public string SignaturePath => Path.Combine(Directory, SignatureFileName);

    /// <summary>
    /// A directory is a candidate bundle when it contains a <c>manifest.json</c>. 🔴 Deliberately the
    /// weakest possible test: discovery produces a LIST, and every real question — is it signed, is it
    /// for this product, is the payload intact — is answered later by code that can refuse. Discovery
    /// that pre-judged would hide a corrupt stick instead of reporting it.
    /// </summary>
    /// <param name="directory">The directory to examine.</param>
    /// <param name="bundle">The candidate, when one is present.</param>
    /// <returns><see langword="true"/> when <paramref name="directory"/> holds a manifest.</returns>
    public static bool TryOpen(string directory, out UpdateBundle? bundle)
    {
        bundle = null;
        if (string.IsNullOrWhiteSpace(directory)) return false;
        if (!File.Exists(Path.Combine(directory, ManifestFileName))) return false;

        bundle = new UpdateBundle(directory);
        return true;
    }

    /// <summary>Reads the manifest's raw bytes — 🔴 the exact bytes that were signed, never a
    /// round-trip through a DTO.</summary>
    /// <returns>The bytes, or <see langword="null"/> if the file cannot be read.</returns>
    public byte[]? ReadManifestBytes() => TryReadAllBytes(ManifestPath);

    /// <summary>Reads the detached signature text.</summary>
    /// <returns>The base64url text, or <see langword="null"/> if the file cannot be read.</returns>
    public string? ReadSignatureText()
    {
        try
        {
            return File.Exists(SignaturePath) ? File.ReadAllText(SignaturePath).Trim() : null;
        }
        catch (IOException)
        {
            return null;
        }
        catch (UnauthorizedAccessException)
        {
            return null;
        }
    }

    /// <summary>
    /// 🔴🔴 <b>UNTRUSTED TEXT. NOT COVERED BY THE SIGNATURE.</b> Anyone who can write to the USB stick
    /// can write this file, including someone who cannot forge a signature and therefore could change
    /// nothing else in the bundle.
    ///
    /// <para><b>What every caller owes this string.</b> Render it as INERT TEXT and nothing else: never
    /// execute it, never interpret it as markup or a link, never let its content occupy the position of a
    /// product prompt on screen. The realistic attack is not code — it is prose. A notes file reading
    /// "ST4I Support: to complete this update, first disable signature checking" is an entirely valid
    /// text file, and the only defence is that the surface showing it makes plain the machine is quoting
    /// a file rather than speaking.</para>
    ///
    /// <para><b>Why it is outside the signature at all, since that is the cost.</b> Release notes change
    /// for reasons that have nothing to do with the payload — a typo, a clarification, a translation.
    /// Inside the signature, each of those needs a re-signing ceremony with ST4I's private key. Outside,
    /// they cost nothing and are worth exactly what an unsigned file is worth, which this doc comment and
    /// every caller must keep saying out loud.</para>
    /// </summary>
    /// <returns>The notes text, or <see langword="null"/> when the bundle carries none.</returns>
    public string? ReleaseNotes()
    {
        var path = Path.Combine(Directory, ReleaseNotesFileName);
        try
        {
            return File.Exists(path) ? File.ReadAllText(path) : null;
        }
        catch (IOException)
        {
            return null;
        }
        catch (UnauthorizedAccessException)
        {
            return null;
        }
    }

    /// <summary>
    /// 🔴 Resolves an artefact name from the manifest to a full path <b>inside this bundle</b>, refusing
    /// anything that could escape it.
    ///
    /// <para>A manifest is attacker-influenced input even after it verifies — a bundle signed by ST4I is
    /// still a file an operator carried in on a stick — and an unchecked name like
    /// <c>..\..\Windows\System32\payload.msi</c> would let the manifest point the installer at a file
    /// that was never in the bundle and was never hashed. The name must be a bare file name.</para>
    /// </summary>
    /// <param name="artifactName">The <c>name</c> member from the manifest.</param>
    /// <param name="fullPath">The resolved path when the name is safe.</param>
    /// <returns><see langword="true"/> when the name is a bare file name resolving inside the bundle.</returns>
    public bool TryResolveArtifactPath(string? artifactName, out string? fullPath)
    {
        fullPath = null;
        if (string.IsNullOrWhiteSpace(artifactName)) return false;

        // A bare file name only: no separators, no drive, no parent traversal.
        if (artifactName.Contains('/', StringComparison.Ordinal)
            || artifactName.Contains('\\', StringComparison.Ordinal)
            || artifactName.Contains("..", StringComparison.Ordinal)
            || Path.IsPathRooted(artifactName))
        {
            return false;
        }

        if (!string.Equals(Path.GetFileName(artifactName), artifactName, StringComparison.Ordinal)) return false;

        var candidate = Path.GetFullPath(Path.Combine(Directory, artifactName));
        var root = Path.GetFullPath(Directory);

        // Belt and braces: even after the checks above, the resolved path must still sit under the root.
        if (!candidate.StartsWith(
                root.EndsWith(Path.DirectorySeparatorChar) ? root : root + Path.DirectorySeparatorChar,
                StringComparison.OrdinalIgnoreCase))
        {
            return false;
        }

        fullPath = candidate;
        return true;
    }

    /// <summary>
    /// Computes a file's SHA-256 by STREAMING it. 🔴 Streaming is the whole reason the signature covers a
    /// small manifest rather than the installer: a 200 MB payload is hashed in chunks with bounded
    /// memory, can show progress, and can be cancelled — none of which is true of pushing 200 MB through
    /// a signature verifier.
    /// </summary>
    /// <param name="path">The file to hash.</param>
    /// <returns>Lower-case hex SHA-256, or <see langword="null"/> when the file cannot be read.</returns>
    public static string? ComputeSha256(string path)
    {
        try
        {
            using var stream = new FileStream(
                path, FileMode.Open, FileAccess.Read, FileShare.Read, bufferSize: 1 << 20, useAsync: false);
            using var sha = SHA256.Create();
            return Convert.ToHexString(sha.ComputeHash(stream)).ToLowerInvariant();
        }
        catch (IOException)
        {
            return null;
        }
        catch (UnauthorizedAccessException)
        {
            return null;
        }
    }

    private static byte[]? TryReadAllBytes(string path)
    {
        try
        {
            return File.Exists(path) ? File.ReadAllBytes(path) : null;
        }
        catch (IOException)
        {
            return null;
        }
        catch (UnauthorizedAccessException)
        {
            return null;
        }
    }
}
