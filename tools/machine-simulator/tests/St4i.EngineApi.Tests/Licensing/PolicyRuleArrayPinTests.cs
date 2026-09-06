using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.Extensions.DependencyInjection;
using St4i.EngineApi.Policy;
using St4i.EngineApi.Tests.Auth;
using St4i.EngineApi.Policy.Rules;
using Xunit;

namespace St4i.EngineApi.Tests.Licensing;

/// <summary>
/// 🔴🔴 WS-E — <b>THE SAFETY TRAP, CLOSED BY A FAILING TEST RATHER THAN BY A PARAGRAPH.</b>
///
/// <para><b>The trap, and why it is a trap rather than merely a hazard.</b>
/// <see cref="PolicyEngine"/> is DEFAULT-DENY — its own doc comment: "an action that no rule permits is
/// DENIED" — and <c>FleetEndpoints.cs</c> calls <c>policy.Evaluate</c> for <c>fleet.estop</c> and
/// <c>fleet.estop_reset</c>. Adding a rule to the <c>IPolicyRule[]</c> in <c>Program.cs</c> is the
/// OBVIOUS way to add a gate in this codebase, and that is exactly what makes it dangerous. A
/// <c>LicenseRule</c> registered there would be evaluated on the E-stop path, and any bug in it that
/// returned a deny — a null licence during a startup race, an exception surfacing as a deny, a
/// copy-pasted action list — would make <b>HALT UNREACHABLE ON A RUNNING MACHINE</b>. That is a licence
/// problem stopping a machine, the one outcome this workstream may never cause.</para>
///
/// <para><see cref="EstopGuardRule"/> was written with this in mind — "a halt and its reset must ALWAYS
/// be reachable" — but that is a property of THAT rule, enforced by its own action allow-list, not a
/// property the engine guarantees to a NEW rule. Nothing structural stopped the mistake before this file
/// existed.</para>
///
/// <para><b>Three legs, measuring three different things.</b> (1) the RUNTIME fact — the real engine from
/// the booted composition root holds exactly three rules; (2) the SOURCE fact — no type anywhere in
/// <c>src/</c> implements <c>IPolicyRule</c> from a licence namespace, so an implementation is caught the
/// day it is WRITTEN rather than the day it is wired in; (3) a NEGATIVE CONTROL proving the detector in
/// (2) actually fires, because every claim in (2) is an ABSENCE claim and an absence claim is exactly the
/// shape that passes when the instrument is broken.</para>
///
/// <para>🔴 The source side uses <see cref="CSharpSourceScan"/>, which strips comments and string
/// literals before matching. A raw text scan would be wrong twice: it cannot tell a live
/// <c>new LicenseRule()</c> from the words "LicenseRule" inside this very doc comment, and this programme
/// has been burned three times by regex source-matchers — most recently by a <c>//</c> inside a URL
/// string hiding a declaration from its own census.</para>
/// </summary>
// 🔴 Joins the serialized security-env-var collection for the same reason AuthPipelineTests/
// RbacPolicyTests/AuditEndpointsTests do: the runtime leg below boots a real
// WebApplicationFactory<Program>, which reads the process-wide ST4I_*_DIR and ASPNETCORE_ENVIRONMENT
// variables that those suites SWAP while running. Without this tag the boot races them and fails inside
// an unrelated composition-root singleton, which is a flake that looks like a licence defect and is not.
[Collection(SecurityEnvVarTests.CollectionName)]
public sealed class PolicyRuleArrayPinTests
{
    /// <summary>The exact three rule types the engine may hold. Growing this list is a SAFETY decision
    /// about what may be evaluated on the E-stop path, not a formality.</summary>
    private static readonly string[] AllowedRuleTypeNames =
        [nameof(CriticalAlarmGuardRule), nameof(EstopGuardRule), nameof(RoleObligationRule)];

    /// <summary>
    /// 🔴 <b>THE PIN.</b> The real <see cref="PolicyEngine"/> from the booted app holds exactly the three
    /// permitted rule types and nothing from any licence namespace.
    /// </summary>
    [Fact]
    public void ThePolicyEngine_HoldsExactlyItsThreeSafetyRules_AndNothingFromTheLicenceNamespace()
    {
        var prevEnvironment = Environment.GetEnvironmentVariable("ASPNETCORE_ENVIRONMENT");
        WebApplicationFactory<Program> factory;
        try
        {
            // Same Production-forcing recipe every suite in this project uses to dodge the Development
            // static-web-assets manifest; see AuthPipelineTests' own doc comment for the full reasoning.
            Environment.SetEnvironmentVariable("ASPNETCORE_ENVIRONMENT", "Production");
            factory = new WebApplicationFactory<Program>();
            _ = factory.Server;
        }
        finally
        {
            Environment.SetEnvironmentVariable("ASPNETCORE_ENVIRONMENT", prevEnvironment);
        }

        using (factory)
        {
            var engine = factory.Services.GetRequiredService<PolicyEngine>();

            var rulesField = typeof(PolicyEngine).GetField("_rules",
                System.Reflection.BindingFlags.Instance | System.Reflection.BindingFlags.NonPublic);
            Assert.True(rulesField is not null,
                "PolicyEngine._rules was not found by reflection. This test cannot see what the engine " +
                "holds, so it must fail rather than pass — fix the reflection, do not delete the pin.");

            var rules = ((IEnumerable<IPolicyRule>)rulesField!.GetValue(engine)!).ToList();

            // 🔴 NEGATIVE CONTROL, and the reason the assertion below is not vacuous: if reflection
            // silently returned an EMPTY list, "no licence rule is present" would be trivially true and
            // this test would go on passing while measuring nothing. Pinning the COUNT makes empty a fail.
            Assert.Equal(3, rules.Count);

            var actual = rules.Select(r => r.GetType().Name).OrderBy(n => n, StringComparer.Ordinal).ToArray();
            Assert.Equal(AllowedRuleTypeNames.OrderBy(n => n, StringComparer.Ordinal).ToArray(), actual);

            // Stated separately from the equality above so a failure message says WHY rather than merely
            // showing two lists that differ.
            foreach (var rule in rules)
            {
                var ns = rule.GetType().Namespace ?? string.Empty;
                Assert.False(
                    ns.Contains("Licens", StringComparison.OrdinalIgnoreCase),
                    $"{rule.GetType().FullName} is registered as an IPolicyRule. PolicyEngine is DEFAULT-DENY " +
                    "and FleetEndpoints evaluates it for fleet.estop and fleet.estop_reset, so a licence rule " +
                    "here can make HALT unreachable. Licence gating is an ENDPOINT FILTER " +
                    "(LicenseFilterExtensions.RequireLicense), attached route by route, never a policy rule.");
            }
        }
    }

    /// <summary>
    /// 🔴 The SOURCE leg: no type declared anywhere under <c>src/</c> implements <c>IPolicyRule</c> from a
    /// licence namespace — so the mistake is caught the day it is written, not the day it is registered.
    /// </summary>
    [Fact]
    public void NoTypeInAnyLicenceNamespace_ImplementsIPolicyRule()
    {
        var srcRoot = Path.Combine(RepoRoot(), "src");
        var offenders = new List<string>();
        var scanned = 0;

        foreach (var file in ProductSources(srcRoot))
        {
            scanned++;
            var text = File.ReadAllText(file);

            // Only licence-namespaced files can offend, and the namespace is read from CODE rather than
            // from the path — a file's directory is not its namespace.
            var code = CSharpSourceScan.StripCommentsAndStrings(text);
            if (!MentionsLicenceNamespace(code)) continue;

            // `IPolicyRule` appearing in CODE inside a licence-namespaced file is the offence. A comment
            // discussing IPolicyRule — of which this branch's production files contain several, by design
            // — is invisible here, which is the whole reason the text is stripped first.
            var hits = CSharpSourceScan.FindIdentifierLines(text, "IPolicyRule");
            if (hits.Count > 0)
            {
                offenders.Add($"{file} (line(s) {string.Join(", ", hits)})");
            }
        }

        // Non-vacuity: a scan that walked no files would report no offenders and pass.
        Assert.True(scanned > 100,
            $"The source scan only read {scanned} .cs files under {srcRoot}; the scan, not the product, is " +
            "what broke.");

        Assert.True(offenders.Count == 0,
            "These licence-namespaced sources reference IPolicyRule in code, which would put licence logic " +
            "on the default-deny path FleetEndpoints evaluates for fleet.estop and fleet.estop_reset — a " +
            $"deny there makes HALT unreachable: {string.Join("; ", offenders)}. Use an endpoint filter.");
    }

    /// <summary>
    /// 🔴 <b>THE NEGATIVE CONTROL FOR THE LEG ABOVE.</b> The test above asserts an ABSENCE, which is the
    /// shape that passes when the instrument is broken. This proves the detector fires: fed a synthetic
    /// licence-namespaced <c>IPolicyRule</c> implementation, it must flag it — and fed the same
    /// implementation in a NON-licence namespace, it must not, so the predicate discriminates rather than
    /// flagging everything it sees.
    /// </summary>
    [Fact]
    public void TheDetector_FlagsALicenceNamespacedPolicyRule_AndNotABenignOne()
    {
        const string offending = """
            namespace St4i.EngineApi.Licensing;
            public sealed class LicenseRule : IPolicyRule
            {
                public PolicyDecision? Evaluate(PolicyRequest request) => null;
            }
            """;

        var offendingCode = CSharpSourceScan.StripCommentsAndStrings(offending);
        Assert.True(MentionsLicenceNamespace(offendingCode));
        Assert.NotEmpty(CSharpSourceScan.FindIdentifierLines(offending, "IPolicyRule"));

        const string benign = """
            namespace St4i.EngineApi.Policy.Rules;
            public sealed class SomeGuardRule : IPolicyRule
            {
                public PolicyDecision? Evaluate(PolicyRequest request) => null;
            }
            """;

        Assert.False(MentionsLicenceNamespace(CSharpSourceScan.StripCommentsAndStrings(benign)));

        // 🔴 And the deception that motivated the lexer in the first place: a licence file whose ONLY
        // mention of IPolicyRule is inside a comment and a string must NOT be flagged. Every production
        // file this workstream added contains exactly that, deliberately — the comments explaining why
        // licence code is not a policy rule would otherwise trip the very test that enforces it.
        const string commentaryOnly = """
            namespace St4i.EngineApi.Licensing;
            // This type is deliberately NOT an IPolicyRule — see the header.
            /* IPolicyRule would put it on the E-stop path. */
            public sealed class LicenseGateLike
            {
                public string Why => "not an IPolicyRule; PolicyEngine is default-deny";
                public string More => @"IPolicyRule in a verbatim string // with a comment marker too";
            }
            """;

        Assert.True(MentionsLicenceNamespace(CSharpSourceScan.StripCommentsAndStrings(commentaryOnly)));
        Assert.Empty(CSharpSourceScan.FindIdentifierLines(commentaryOnly, "IPolicyRule"));
    }

    /// <summary>Whether the stripped code declares a namespace containing "Licens".</summary>
    /// <param name="strippedCode">Source with comments and strings already blanked.</param>
    /// <returns><see langword="true"/> when a licence namespace is declared.</returns>
    private static bool MentionsLicenceNamespace(string strippedCode)
    {
        foreach (var line in strippedCode.Split('\n'))
        {
            var trimmed = line.TrimStart();
            if (!trimmed.StartsWith("namespace ", StringComparison.Ordinal)) continue;
            if (trimmed.Contains("Licens", StringComparison.OrdinalIgnoreCase)) return true;
        }

        return false;
    }

    /// <summary>Every non-generated <c>.cs</c> file under <paramref name="srcRoot"/>.</summary>
    /// <param name="srcRoot">The <c>src/</c> directory.</param>
    /// <returns>The file paths.</returns>
    internal static IEnumerable<string> ProductSources(string srcRoot) =>
        Directory.EnumerateFiles(srcRoot, "*.cs", SearchOption.AllDirectories)
            .Where(f => !f.Contains($"{Path.DirectorySeparatorChar}bin{Path.DirectorySeparatorChar}", StringComparison.Ordinal)
                     && !f.Contains($"{Path.DirectorySeparatorChar}obj{Path.DirectorySeparatorChar}", StringComparison.Ordinal));

    /// <summary>Walks up from the test assembly to the <c>tools/machine-simulator</c> root.</summary>
    /// <returns>The sub-root containing <c>src/</c> and <c>tests/</c>.</returns>
    internal static string RepoRoot()
    {
        var dir = new DirectoryInfo(AppContext.BaseDirectory);
        while (dir is not null)
        {
            if (File.Exists(Path.Combine(dir.FullName, "St4iMachineSimulator.sln"))) return dir.FullName;
            dir = dir.Parent;
        }

        throw new InvalidOperationException("Could not locate St4iMachineSimulator.sln above the test assembly.");
    }
}
