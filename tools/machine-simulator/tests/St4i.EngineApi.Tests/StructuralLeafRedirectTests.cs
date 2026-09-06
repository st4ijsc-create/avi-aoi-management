using System;
using System.IO;
using St4i.EngineApi.Alarms;
using St4i.EngineApi.Auth;
using St4i.EngineApi.Fleet;
using St4i.TestHygiene;
using Xunit;

namespace St4i.EngineApi.Tests;

/// <summary>
/// 🔴 <b>Task CB-1, 2026-08-29 — docs/owner-decisions.md item 72, OPTION A, for the three
/// <c>%ProgramData%\ST4I\sim</c> leaves whose stores live in THIS assembly and are invisible from
/// <c>St4i.EdgeCore.Tests</c>, where the other six witnesses sit.</b>
///
/// <para><b>Why a second file rather than more cases in the existing one.</b>
/// <c>TestRunTempRootTests</c> is in <c>St4i.EdgeCore.Tests</c> and references only <c>St4i.EdgeCore</c>.
/// <see cref="SecurityDb"/>, <see cref="AlarmStore"/> and <see cref="ConnectorConfigStore"/> are declared in
/// <c>St4i.EngineApi</c>, so no test in that assembly can name them. The alternative — asserting a path
/// literal there — is the thing the sibling file deliberately avoids: a literal keeps passing after the
/// store's default moves, which is the only change that would matter.</para>
///
/// <para><b>What "structural" buys, and it is the question item 72 asks and does not answer.</b> These three
/// variables were already set by roughly eighteen classes in this suite, each by hand, each into its own
/// temporary directory. That is a CONVENTION: it covers exactly the classes someone remembered to write it
/// in. The redirect witnessed here is installed by a <c>[ModuleInitializer]</c>, so it is ambient for the
/// whole assembly and covers the class nobody has written yet — and, MEASURED at CB-1, it applies to a bare
/// <c>dotnet test</c> with no gate involved. The <c>%ProgramData%</c> bracket in
/// <c>scripts/verify-suites.sh</c> — the instrument that DETECTS a write to the real tree — runs only inside
/// that script. Prevention and detection have different reach; until CB-1 only detection's was written down.</para>
///
/// <para>🔴 <b>Why every assertion reads the INSTALLED record and never the live variable.</b> Measured at
/// CB-1: EIGHTEEN classes in this assembly set each of these three variables while other tests run, and xunit runs
/// collections in parallel by default (this repository declares no <c>xunit.runner.json</c> and no
/// assembly-level collection behaviour). A witness calling <c>ResolveRoot()</c> would be reading a value
/// another class owns at that instant — flaky by construction. A flaky leak guard is worse than no guard:
/// it teaches its readers to re-run it instead of believing it. <see cref="TestRunTempRoot.InstalledRedirects"/>
/// is a snapshot taken before the first test runs and never mutated, so these facts are deterministic under
/// any interleaving.</para>
///
/// <para><b>What this file does NOT contain, stated so its absence is not read as an oversight.</b> There is
/// no "a class that sets the variable itself still wins" fact here. That property is witnessed once, in
/// <c>TestRunTempRootTests.AClassThatSetsTheVariableItself_StillBeatsTheStructuralDefault</c>, on a variable
/// whose only other toucher shares a serialized collection with it. Writing the same flip in THIS assembly
/// would put it in a race with those eighteen classes — which is how a witness for a leak becomes the flake
/// that gets it quarantined.</para>
/// </summary>
public class StructuralLeafRedirectTests
{
    /// <summary>The real <c>%ProgramData%\ST4I\sim\&lt;leaf&gt;</c> root, taken from the STORE'S OWN
    /// <c>DefaultRoot()</c> so the assertion is pinned to the product's name for it rather than to a path
    /// rebuilt here.</summary>
    private static string RealLeafRoot(string leaf) => leaf switch
    {
        "security" => SecurityDb.DefaultRoot(),
        "alarms" => AlarmStore.DefaultRoot(),
        "connector-config" => ConnectorConfigStore.DefaultRoot(),
        "license" => St4i.EdgeCore.Licensing.LicenseStore.DefaultRoot(),
        _ => throw new ArgumentOutOfRangeException(nameof(leaf), leaf, "Unknown leaf."),
    };

    /// <summary>
    /// Two predicates, because either alone is satisfiable by the wrong thing: the redirect must point
    /// somewhere OTHER than the real leaf (or it buys nothing at all), and it must point INSIDE this run's
    /// disposable root (or it is simply a second accumulating directory — the defect wearing the fix's
    /// clothes, which is exactly what the original <c>%TEMP%</c> measurement found).
    ///
    /// <para>These three leaves are not interchangeable with the six in the sibling file:
    /// <c>connector-config</c> persists an OPC-UA node map with its password in PLAINTEXT, and
    /// <c>security</c> holds the user database, sessions and the hash-chained audit log. Both are named in
    /// <c>packaging/remove-data.ps1</c>'s purge list for that reason.</para>
    /// </summary>
    [Theory]
    [InlineData("ST4I_SECURITY_DIR", "security")]
    [InlineData("ST4I_ALARMS_DIR", "alarms")]
    [InlineData("ST4I_CONNECTOR_CONFIG_DIR", "connector-config")]
    // 🔴 WS-E (License/Edition) — the licence leaf belongs in THIS file rather than the sibling, and
    // urgently: Program.cs constructs a LicenseStore unconditionally at startup, and that ctor CREATES
    // the directory and applies SecurityDirAcl to it. Without the structural redirect, every
    // WebApplicationFactory<Program> boot in this assembly would create and ACL-lock the REAL
    // %ProgramData%\ST4I\sim\license on whatever machine runs the suite — CredentialStore's own recorded
    // defect (~3,000 DPAPI blobs written into this machine's real credential directory) reproduced exactly.
    [InlineData("ST4I_LICENSE_DIR", "license")]
    public void EveryConventionOnlyLeafInThisAssembly_IsStructurallyRedirectedAwayFromItsRealDirectory(
        string variable, string leaf)
    {
        Assert.True(TestRunTempRoot.InstalledRedirects.TryGetValue(variable, out var installed),
            $"{variable} was NOT installed by TestRunTempRoot. Item 72 option A is the claim that this leaf " +
            "is redirected STRUCTURALLY rather than by each class remembering to set it; with the line gone, " +
            "any class that does not set it by hand resolves to the REAL install directory.");

        var redirected = Path.TrimEndingDirectorySeparator(Path.GetFullPath(installed!));
        var real = Path.TrimEndingDirectorySeparator(Path.GetFullPath(RealLeafRoot(leaf)));

        Assert.NotEqual(real, redirected);
        Assert.StartsWith(
            Path.GetFullPath(TestRunTempRoot.Root!), redirected, StringComparison.OrdinalIgnoreCase);
    }
}
