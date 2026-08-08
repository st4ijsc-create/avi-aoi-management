using System.Text.RegularExpressions;
using Xunit;

namespace St4i.EngineApi.Tests;

/// <summary>
/// 🔴 <b>Task F-1 — every machine-wide directory this product creates must be RELOCATABLE, because that is
/// the entire mechanism by which two hosts on one machine stop overwriting each other's files.</b>
///
/// <para><b>Why this is a scan and not a list, for the third time in this repository.</b> Two sibling tests
/// already derive the set of <c>%ProgramData%\ST4I\sim\&lt;name&gt;</c> directories from <c>src/</c> rather
/// than restating it —
/// <c>NotificationDocumentationTests.EveryDirectoryTheEngineCreatesUnderProgramData_IsPurgedByTheDecommissioningScript</c>
/// (does a decommissioning wipe reach it?) and
/// <c>TestHarnessIsolationTests.EveryStoreTheEngineCreates_IsIsolatedByThePlaywrightHarness</c> (does the e2e
/// harness point it somewhere harmless?). Each of those exists because a HAND-KEPT list was audited, declared
/// complete, and was missing a store that had been added after the audit. This is the third face of the same
/// question and it fails the same way: a fourteenth store added without an <c>ST4I_*_DIR</c> variable would
/// be un-separable, two hosts would share it, and nothing anywhere would say so.</para>
///
/// <para>🔴 <b>The task brief that produced this file named FOUR stores. The enumeration found THIRTEEN, and
/// the brief's own instruction was to start from the SET rather than from its list</b> (blueprint §8.1: "not
/// in view" is the dangerous answer, not the safe one). The four it named all had the seam. So did the other
/// nine — but only one of the thirteen resolves its variable somewhere other than on the store itself, and
/// that asymmetry is recorded at the assertion below rather than in a report nobody re-reads.</para>
///
/// <para><b>What makes this non-vacuous</b> (the shape both sibling tests already carry): a floor on the
/// number of directories found, so a refactor that moves the constants fails loudly instead of asserting over
/// an empty set; and named controls, so a scan that silently stopped matching the credential-bearing stores
/// cannot stay green.</para>
/// </summary>
public sealed class PerHostDataRootsTests
{
    private static string MachineSimulatorRoot()
    {
        var dir = new DirectoryInfo(AppContext.BaseDirectory);
        while (dir is not null)
        {
            if (File.Exists(Path.Combine(dir.FullName, "README.md")) &&
                File.Exists(Path.Combine(dir.FullName, "fleet.json")) &&
                Directory.Exists(Path.Combine(dir.FullName, "docs")))
            {
                return dir.FullName;
            }

            dir = dir.Parent;
        }

        throw new InvalidOperationException(
            "Could not locate tools/machine-simulator (README.md + fleet.json + docs/) by walking up from " +
            $"\"{AppContext.BaseDirectory}\". If the output layout changed, fix this walk — do NOT weaken " +
            "the assertions below to make the file findable.");
    }

    /// <summary>Every non-generated <c>*.cs</c> under <c>src/</c>. <c>bin/</c> and <c>obj/</c> carry generated
    /// copies of the same literals and are not sources of truth — the identical exclusion both sibling census
    /// tests make.</summary>
    private static IEnumerable<string> ProductSources()
    {
        foreach (var file in Directory.EnumerateFiles(
                     Path.Combine(MachineSimulatorRoot(), "src"), "*.cs", SearchOption.AllDirectories))
        {
            if (file.Contains($"{Path.DirectorySeparatorChar}bin{Path.DirectorySeparatorChar}", StringComparison.Ordinal) ||
                file.Contains($"{Path.DirectorySeparatorChar}obj{Path.DirectorySeparatorChar}", StringComparison.Ordinal))
            {
                continue;
            }

            yield return file;
        }
    }

    /// <summary>
    /// 🔴 <b>The fifth-store guard.</b> The set of machine-wide directories and the set of relocation
    /// variables are both derived from <c>src/</c>, and every member of the first must have a member of the
    /// second whose name is derivable from it: <c>ST4I_</c> + the directory name uppercased with <c>-</c> →
    /// <c>_</c> + <c>_DIR</c>.
    ///
    /// <para><b>Why the derivable NAME and not merely "some variable exists".</b> Requiring only that thirteen
    /// directories and thirteen variables both exist would pass while a store's directory and its variable
    /// referred to different things — and an operator following README §15.9 sets variables by reading the
    /// directory name off a path. The rule they are told is the rule this asserts.</para>
    ///
    /// <para>🔴 <b>One store resolves its variable somewhere other than on the store, and the enumeration is
    /// how that was found rather than assumed.</b> <c>ST4I_HISTORIAN_DIR</c> is read by
    /// <c>St4i.EngineApi/Program.cs</c> and threaded into <c>SqliteHistorianStore</c>/<c>OeeSettingsStore</c>
    /// as a constructor argument; those two types have no <c>EnvVarDir</c> and no <c>ResolveRoot</c> of their
    /// own, unlike their twelve siblings. That is why this test scans for the LITERAL anywhere in <c>src/</c>
    /// rather than for a <c>public const string EnvVarDir</c> on a store type: a scan shaped like the twelve
    /// would have reported the thirteenth as unrelocatable and sent someone to "fix" a store that is already
    /// relocatable. The consequence that IS real and is recorded here rather than silently accepted: a host
    /// that constructs a historian store WITHOUT going through that composition root gets the machine-wide
    /// default with no env-var step. No host does today (only <c>St4i.EngineApi</c> has a historian at all),
    /// which is exactly the kind of "not in view" answer §8.1 calls dangerous — so it is written down.</para>
    /// </summary>
    [Fact]
    public void EveryMachineWideDirectory_IsRelocatable_ByADerivableEnvVarName()
    {
        var directories = new SortedSet<string>(StringComparer.Ordinal);
        var variables = new SortedSet<string>(StringComparer.Ordinal);

        // The `"ST4I", "sim", "<name>"` default-path constant every store declares, and every ST4I_*_DIR
        // literal anywhere in src/ — the same two patterns the two sibling census tests already use, asked
        // here against each other rather than each against a hand-maintained artefact.
        var directoryConstant = new Regex("\"ST4I\"\\s*,\\s*\"sim\"\\s*,\\s*\"(?<name>[A-Za-z0-9._-]+)\"");
        var variableLiteral = new Regex("\"(?<name>ST4I_[A-Z0-9_]*_DIR)\"");

        foreach (var file in ProductSources())
        {
            var text = File.ReadAllText(file);
            foreach (Match m in directoryConstant.Matches(text)) directories.Add(m.Groups["name"].Value);
            foreach (Match m in variableLiteral.Matches(text)) variables.Add(m.Groups["name"].Value);
        }

        // Non-vacuity, both halves. An empty (or collapsed) set on either side must fail loudly rather than
        // pass by asserting over nothing.
        Assert.True(directories.Count >= 13,
            $"Only {directories.Count} data directory constant(s) were found in src/ " +
            $"({string.Join(", ", directories)}). The scan, not the product, is what broke — fix the scan " +
            "rather than deleting this assertion.");
        Assert.True(variables.Count >= 13,
            $"Only {variables.Count} ST4I_*_DIR literal(s) were found in src/ " +
            $"({string.Join(", ", variables)}). The scan, not the product, is what broke.");

        // Controls, named explicitly: the credential-bearing stores plus the one whose variable is read at a
        // composition root rather than on the store. A scan that silently stopped matching any of these could
        // otherwise leave this test green.
        foreach (var mustFind in new[] { "creds", "identity", "connector-config", "notifications", "historian" })
        {
            Assert.Contains(mustFind, directories);
        }

        var missing = directories
            .Select(name => (Directory: name, Variable: "ST4I_" + name.ToUpperInvariant().Replace('-', '_') + "_DIR"))
            .Where(pair => !variables.Contains(pair.Variable))
            .ToList();

        Assert.True(missing.Count == 0,
            "These machine-wide data directories have NO relocation environment variable, so two ST4I hosts " +
            "on one machine cannot be given separate roots for them and will share one set of files: " +
            $"{string.Join(", ", missing.Select(p => $"{p.Directory} (expected {p.Variable})"))}. " +
            "Declare the variable on the store the way its twelve siblings do (explicit path > env var > " +
            "default), add it to README §15.9's table, and add a -XxxDir parameter to " +
            "packaging/remove-data.ps1 — a directory a decommissioning wipe cannot find is worse than one " +
            "that was never relocatable.");
    }

    /// <summary>
    /// 🔴 <b>The no-migration warning must exist where an OPERATOR reads, not only in a report.</b>
    ///
    /// <para>Blueprint §8.1's fourth census tier: a rule stated to a programmer and a rule stated to an
    /// operator are two different populations of text, and the second is the one where a missing sentence
    /// costs somebody an hour on shift. Relocating a root on a RUNNING deployment silently orphans that
    /// store's data — a host that can no longer read its own saved credential looks exactly like a host that
    /// was never onboarded — so silence about it is the worst available outcome, and F-1's brief says so in
    /// as many words.</para>
    ///
    /// <para>This asserts the CLAIM, not the prose: that §15.9 exists, that it says nothing is migrated, and
    /// that it names the credential consequence specifically. Deliberately loose about wording and
    /// deliberately strict about the three facts — a doc test that pins sentences rots on the first honest
    /// edit, and a doc test that pins nothing is decoration.</para>
    /// </summary>
    [Fact]
    public void TheReadme_TellsAnOperatorThatRelocatingARootDoesNotMigrateTheOldData()
    {
        var readme = File.ReadAllText(Path.Combine(MachineSimulatorRoot(), "README.md"));

        Assert.Matches(new Regex(@"###\s*15\.9\b", RegexOptions.None), readme);
        Assert.Contains("NOTHING IS MIGRATED", readme, StringComparison.Ordinal);
        Assert.Contains("KHÔNG CÓ DI TRÚ", readme, StringComparison.Ordinal);

        // The consequence an operator actually meets first: a relocated host is not onboarded any more.
        Assert.Matches(
            new Regex(@"ST4I_CREDS_DIR", RegexOptions.None), readme);
        Assert.Matches(
            new Regex(@"not onboarded", RegexOptions.IgnoreCase), readme);
    }
}
