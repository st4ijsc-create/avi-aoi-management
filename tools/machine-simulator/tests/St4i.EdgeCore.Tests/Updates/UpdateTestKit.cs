using System.Text;
using System.Text.Json;
using Org.BouncyCastle.Crypto.Generators;
using Org.BouncyCastle.Crypto.Parameters;
using Org.BouncyCastle.Crypto.Signers;
using Org.BouncyCastle.Security;

namespace St4i.EdgeCore.Tests.Updates;

/// <summary>
/// 🔴 WS-F4 Task 2 — mints Ed25519 key pairs and builds signed update bundles <b>ENTIRELY IN
/// MEMORY</b>, writing only to a temporary directory the test owns.
///
/// <para><b>NO PRIVATE KEY EVER TOUCHES THIS REPOSITORY.</b> A key pair generated here lives for the
/// duration of one test method and is garbage after it. The verifier under test is constructed with the
/// PUBLIC half through <c>UpdateManifestVerifier(byte[])</c>'s injection seam — which is the entire
/// reason that seam exists — so nothing has to embed a real ST4I key or invent a fake one on disk to be
/// testable. This is <c>LicenseTestKit</c>'s shape, deliberately, because the two paths share a
/// discipline and should not drift.</para>
///
/// <para>🔴 <b>This helper can sign WRONGLY, on purpose, and can corrupt a payload by exactly one
/// byte.</b> A kit that could only build valid bundles would make every test a happy-path test, and a
/// verifier that returns <see langword="true"/> unconditionally passes every happy-path test ever
/// written. <see cref="FlipOneByteOfPayload"/> exists specifically to falsify the load-bearing negative
/// property: that <c>msiexec</c> is never invoked on bytes that do not match the signed manifest.</para>
/// </summary>
internal static class UpdateTestKit
{
    /// <summary>Generates an Ed25519 key pair in memory.</summary>
    /// <returns>The private and public halves.</returns>
    public static (Ed25519PrivateKeyParameters Private, byte[] PublicKey) NewKeyPair()
    {
        var generator = new Ed25519KeyPairGenerator();
        generator.Init(new Ed25519KeyGenerationParameters(new SecureRandom()));
        var pair = generator.GenerateKeyPair();
        return ((Ed25519PrivateKeyParameters)pair.Private, ((Ed25519PublicKeyParameters)pair.Public).GetEncoded());
    }

    /// <summary>Signs arbitrary bytes with an arbitrary key — deliberately permissive so a test can
    /// produce a signature that is valid for the WRONG key.</summary>
    /// <param name="message">The bytes to sign.</param>
    /// <param name="key">The signing key.</param>
    /// <returns>The 64-byte signature.</returns>
    public static byte[] Sign(byte[] message, Ed25519PrivateKeyParameters key)
    {
        var signer = new Ed25519Signer();
        signer.Init(forSigning: true, key);
        signer.BlockUpdate(message, 0, message.Length);
        return signer.GenerateSignature();
    }

    /// <summary>base64url without padding — the form <c>manifest.sig</c> carries.</summary>
    /// <param name="bytes">The bytes.</param>
    /// <returns>The encoded text.</returns>
    public static string Base64Url(byte[] bytes) =>
        Convert.ToBase64String(bytes).TrimEnd('=').Replace('+', '-').Replace('/', '_');

    /// <summary>Builds the manifest JSON text for a payload, with sensible defaults so each test states
    /// only the field it is about.</summary>
    /// <param name="payloadName">The artefact file name.</param>
    /// <param name="payloadBytes">The payload, whose SHA-256 the manifest will carry.</param>
    /// <param name="version">The version this bundle installs.</param>
    /// <param name="product">The product identity.</param>
    /// <param name="minUpgradableFrom">The oldest version this may be applied over.</param>
    /// <param name="v">Manifest format version.</param>
    /// <param name="channel">The release line.</param>
    /// <param name="schemaCeiling">The post-update store versions.</param>
    /// <returns>The manifest JSON.</returns>
    public static string ManifestJson(
        string payloadName,
        byte[] payloadBytes,
        string version = "1.4.0",
        string product = "st4i-machine-simulator",
        string minUpgradableFrom = "1.0.0",
        int v = 1,
        string channel = "current",
        IDictionary<string, int>? schemaCeiling = null) =>
        JsonSerializer.Serialize(new
        {
            v,
            product,
            version,
            channel,
            minUpgradableFrom,
            schemaCeiling = schemaCeiling ?? TenStoreCeilingAtThisCommit(),
            artifacts = new[]
            {
                new
                {
                    name = payloadName,
                    size = (long)payloadBytes.Length,
                    sha256 = Sha256Hex(payloadBytes),
                },
            },
            issued = "2026-09-06T00:00:00Z",
        });

    /// <summary>
    /// 🔴 The ten schema ceilings measured at this commit — the values Task 1's ladders actually carry.
    /// A manifest declaring these is what turns a 3am discovery into a daylight one.
    /// </summary>
    /// <returns>Store name to post-update <c>user_version</c>.</returns>
    public static Dictionary<string, int> TenStoreCeilingAtThisCommit() => new()
    {
        ["historian"] = 2,
        ["bridge-spool"] = 1,
        ["alarms"] = 1,
        ["notifications"] = 3,
        ["assets"] = 1,
        ["security"] = 2,
        ["connector-config"] = 5,
        ["hmi-model"] = 1,
        ["hmi-screens"] = 1,
        ["tag-namespaces"] = 1,
    };

    /// <summary>Lower-case hex SHA-256, computed independently of the production helper so the tests
    /// compare two sources rather than one source with itself.</summary>
    /// <param name="bytes">The bytes.</param>
    /// <returns>The hex digest.</returns>
    public static string Sha256Hex(byte[] bytes) =>
        Convert.ToHexString(System.Security.Cryptography.SHA256.HashData(bytes)).ToLowerInvariant();

    /// <summary>
    /// Writes a complete, VALID bundle into a fresh temporary directory: manifest, detached signature,
    /// payload, and an unsigned release-notes file.
    /// </summary>
    /// <param name="signingKey">The key to sign the manifest with.</param>
    /// <param name="payloadBytes">The payload bytes, or <see langword="null"/> for a small default.</param>
    /// <param name="manifestJsonOverride">A manifest to use instead of the generated one.</param>
    /// <param name="payloadName">The artefact file name.</param>
    /// <param name="releaseNotes">The unsigned notes text, or <see langword="null"/> for none.</param>
    /// <param name="version">The version this bundle installs.</param>
    /// <param name="product">The product identity.</param>
    /// <param name="minUpgradableFrom">The oldest version this may be applied over.</param>
    /// <param name="v">Manifest format version.</param>
    /// <returns>The bundle directory.</returns>
    public static string WriteBundle(
        Ed25519PrivateKeyParameters signingKey,
        byte[]? payloadBytes = null,
        string? manifestJsonOverride = null,
        string payloadName = "St4iMachineSimulator.msi",
        string? releaseNotes = null,
        string version = "1.4.0",
        string product = "st4i-machine-simulator",
        string minUpgradableFrom = "1.0.0",
        int v = 1)
    {
        var dir = Path.Combine(Path.GetTempPath(), "st4i-update-tests", Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(dir);

        payloadBytes ??= Encoding.UTF8.GetBytes("PRETEND-MSI-PAYLOAD-" + new string('x', 4096));
        File.WriteAllBytes(Path.Combine(dir, payloadName), payloadBytes);

        var manifestText = manifestJsonOverride
            ?? ManifestJson(payloadName, payloadBytes, version, product, minUpgradableFrom, v);
        var manifestBytes = Encoding.UTF8.GetBytes(manifestText);

        File.WriteAllBytes(Path.Combine(dir, "manifest.json"), manifestBytes);
        File.WriteAllText(Path.Combine(dir, "manifest.sig"), Base64Url(Sign(manifestBytes, signingKey)));

        if (releaseNotes is not null) File.WriteAllText(Path.Combine(dir, "RELEASE-NOTES.txt"), releaseNotes);

        return dir;
    }

    /// <summary>
    /// 🔴🔴 <b>THE FALSIFICATION INSTRUMENT.</b> Flips exactly one bit of one byte of the payload,
    /// leaving the manifest and its signature perfectly valid.
    ///
    /// <para>This is the realistic corruption: a stick pulled out mid-copy, a failing flash cell, or an
    /// attacker who can replace the payload but cannot forge ST4I's signature. The bundle still looks
    /// entirely correct — the manifest verifies, the product matches, the version moves forward — and the
    /// ONLY thing standing between those bytes and a privileged installer is the SHA-256 comparison.</para>
    /// </summary>
    /// <param name="bundleDir">The bundle directory.</param>
    /// <param name="payloadName">The artefact file name.</param>
    /// <returns>The zero-based index of the byte that was flipped.</returns>
    public static int FlipOneByteOfPayload(string bundleDir, string payloadName = "St4iMachineSimulator.msi")
    {
        var path = Path.Combine(bundleDir, payloadName);
        var bytes = File.ReadAllBytes(path);
        const int index = 17; // arbitrary, deep enough not to be a header coincidence
        bytes[index] ^= 0x01;
        File.WriteAllBytes(path, bytes);
        return index;
    }

    /// <summary>Deletes a temporary bundle directory. Never throws — a leaked temp directory must not
    /// redden a suite.</summary>
    /// <param name="bundleDir">The directory to remove.</param>
    public static void Cleanup(string bundleDir)
    {
        try
        {
            if (Directory.Exists(bundleDir)) Directory.Delete(bundleDir, recursive: true);
        }
        catch (IOException) { }
        catch (UnauthorizedAccessException) { }
    }
}
