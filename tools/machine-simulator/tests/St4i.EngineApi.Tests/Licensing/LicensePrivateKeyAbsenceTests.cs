using Xunit;

namespace St4i.EngineApi.Tests.Licensing;

/// <summary>
/// 🔴🔴 WS-E — <b>NO PRIVATE KEY IS IN THIS REPOSITORY, AND THIS IS WHAT KEEPS IT THAT WAY.</b>
///
/// <para>The owner's decision to use Ed25519 puts BouncyCastle in the trust root of the revenue
/// mechanism, and that decision generated exactly one hard constraint: the signing key never enters this
/// tree, and only the 32-byte PUBLIC key is embedded. A repository that ships a licence-signing private
/// key ships the ability to mint licences, which is the whole product given away in one file.</para>
///
/// <para><b>What this measures.</b> That no PRODUCTION source under <c>src/</c> constructs an Ed25519 key
/// PAIR — the operation that produces a private key — and that no key material file has appeared in the
/// tree. Test code may and does generate pairs in memory (<c>LicenseTestKit</c>), which is the point of
/// <c>LicenseVerifier</c>'s public-key injection seam: it makes the verifier testable without a secret
/// anywhere on disk.</para>
///
/// <para>🔴 The scan reads CODE, not text — <see cref="CSharpSourceScan"/> strips comments and string
/// literals first. Both matter here: the production files this workstream added DISCUSS key generation at
/// length in their comments (explaining why they do not do it), and a naive substring scan would flag
/// every one of them, which would make the test useless and get it deleted.</para>
/// </summary>
public sealed class LicensePrivateKeyAbsenceTests
{
    /// <summary>Identifiers whose presence in production code would mean a private key is being made or
    /// held.</summary>
    private static readonly string[] ForbiddenInProductionCode =
    [
        "Ed25519KeyPairGenerator",
        "Ed25519PrivateKeyParameters",
        "Ed25519KeyGenerationParameters",
        "Ed25519Signer",
    ];

    /// <summary>
    /// 🔴 No production source constructs an Ed25519 key pair, holds an Ed25519 private key, or
    /// instantiates a SIGNER. The appliance only ever VERIFIES.
    /// </summary>
    [Fact]
    public void NoProductionSource_GeneratesOrHoldsAnEd25519PrivateKey()
    {
        var srcRoot = Path.Combine(PolicyRuleArrayPinTests.RepoRoot(), "src");
        var offenders = new List<string>();
        var scanned = 0;
        var sawTheVerifier = false;

        foreach (var file in PolicyRuleArrayPinTests.ProductSources(srcRoot))
        {
            scanned++;
            var text = File.ReadAllText(file);

            if (file.EndsWith("LicenseVerifier.cs", StringComparison.Ordinal)) sawTheVerifier = true;

            foreach (var identifier in ForbiddenInProductionCode)
            {
                // 🔴 Ed25519Signer is the one nuance: LicenseVerifier legitimately constructs one to
                // VERIFY (BouncyCastle's verifier and signer are the same type, initialised with
                // forSigning: false). So the offence is not the type — it is initialising it FOR SIGNING.
                if (identifier == "Ed25519Signer")
                {
                    var code = CSharpSourceScan.StripCommentsAndStrings(text);
                    if (code.Contains("forSigning: true", StringComparison.Ordinal)
                        || code.Contains("forSigning:true", StringComparison.Ordinal))
                    {
                        offenders.Add($"{file} initialises an Ed25519Signer FOR SIGNING");
                    }

                    continue;
                }

                var hits = CSharpSourceScan.FindIdentifierLines(text, identifier);
                if (hits.Count > 0)
                {
                    offenders.Add($"{file} references {identifier} at line(s) {string.Join(", ", hits)}");
                }
            }
        }

        // Non-vacuity, twice over: the scan must have read a real tree, and it must have reached the one
        // file that legitimately uses BouncyCastle — otherwise a scan that walked past the licensing
        // directory entirely would report a clean result while measuring nothing.
        Assert.True(scanned > 100, $"The scan only read {scanned} files; the scan, not the product, broke.");
        Assert.True(sawTheVerifier,
            "The scan never reached src/St4i.EdgeCore/Licensing/LicenseVerifier.cs, so it cannot have been " +
            "looking where a private key would appear.");

        Assert.True(offenders.Count == 0,
            "Production code must never generate or hold a licence-signing private key — the appliance only " +
            $"VERIFIES, and the signing key lives on ST4I's issuing service: {string.Join("; ", offenders)}");
    }

    /// <summary>
    /// 🔴 <b>NEGATIVE CONTROL.</b> The test above asserts an ABSENCE, the shape that passes when the
    /// instrument is broken. This proves the detector fires by feeding it the exact text it must catch,
    /// and proves it discriminates by feeding it the legitimate verify-only usage it must NOT catch.
    /// </summary>
    [Fact]
    public void TheDetector_FlagsKeyGeneration_AndAllowsVerifyOnlyUsage()
    {
        const string offending = """
            var generator = new Ed25519KeyPairGenerator();
            generator.Init(new Ed25519KeyGenerationParameters(new SecureRandom()));
            """;

        Assert.NotEmpty(CSharpSourceScan.FindIdentifierLines(offending, "Ed25519KeyPairGenerator"));
        Assert.NotEmpty(CSharpSourceScan.FindIdentifierLines(offending, "Ed25519KeyGenerationParameters"));

        const string verifyOnly = """
            var signer = new Ed25519Signer();
            signer.Init(forSigning: false, new Ed25519PublicKeyParameters(key, 0));
            """;

        var verifyCode = CSharpSourceScan.StripCommentsAndStrings(verifyOnly);
        Assert.DoesNotContain("forSigning: true", verifyCode, StringComparison.Ordinal);
        Assert.Empty(CSharpSourceScan.FindIdentifierLines(verifyOnly, "Ed25519KeyPairGenerator"));

        const string signing = """
            signer.Init(forSigning: true, privateKey);
            """;
        Assert.Contains("forSigning: true",
            CSharpSourceScan.StripCommentsAndStrings(signing), StringComparison.Ordinal);

        // 🔴 And the deception the lexer exists for: a COMMENT saying the words must not be an offence.
        const string commentary = """
            // We deliberately never call Ed25519KeyPairGenerator here; see the header.
            var s = "Ed25519KeyPairGenerator is not used";
            """;
        Assert.Empty(CSharpSourceScan.FindIdentifierLines(commentary, "Ed25519KeyPairGenerator"));
    }

    /// <summary>
    /// 🔴 No key-material FILE has appeared anywhere in the tree — a <c>.pfx</c>, <c>.p12</c>, or a
    /// <c>.pem</c>/<c>.key</c> carrying a private half. The code scan above cannot see a key that was
    /// simply committed as a file.
    /// </summary>
    [Fact]
    public void NoKeyMaterialFile_ExistsAnywhereInTheTree()
    {
        var root = PolicyRuleArrayPinTests.RepoRoot();
        var offenders = new List<string>();
        var scanned = 0;

        foreach (var file in Directory.EnumerateFiles(root, "*", SearchOption.AllDirectories))
        {
            if (file.Contains($"{Path.DirectorySeparatorChar}bin{Path.DirectorySeparatorChar}", StringComparison.Ordinal) ||
                file.Contains($"{Path.DirectorySeparatorChar}obj{Path.DirectorySeparatorChar}", StringComparison.Ordinal) ||
                file.Contains($"{Path.DirectorySeparatorChar}node_modules{Path.DirectorySeparatorChar}", StringComparison.Ordinal) ||
                file.Contains($"{Path.DirectorySeparatorChar}.git{Path.DirectorySeparatorChar}", StringComparison.Ordinal))
            {
                continue;
            }

            scanned++;
            var extension = Path.GetExtension(file).ToLowerInvariant();
            if (extension is ".pfx" or ".p12")
            {
                offenders.Add(file);
                continue;
            }

            if (extension is not (".pem" or ".key")) continue;

            string content;
            try { content = File.ReadAllText(file); }
            catch (IOException) { continue; }

            if (content.Contains("PRIVATE KEY", StringComparison.Ordinal)) offenders.Add(file);
        }

        Assert.True(scanned > 200, $"The file scan only saw {scanned} files; the scan is what broke.");
        Assert.True(offenders.Count == 0,
            $"Private key material must never be committed to this repository: {string.Join(", ", offenders)}");
    }
}
