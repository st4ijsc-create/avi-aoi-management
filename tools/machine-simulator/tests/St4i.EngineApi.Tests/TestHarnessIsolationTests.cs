using System.Text.RegularExpressions;
using Xunit;

namespace St4i.EngineApi.Tests;

/// <summary>
/// 🔴 Test-hygiene batch — <b>the Playwright harness must isolate EVERY store the engine can write to,
/// and this derives that list from the source rather than restating it.</b>
///
/// <para><b>Why a derived list and not a checked one.</b> Three separate audits each declared
/// <c>web/playwright.config.ts</c>'s isolation list complete, and each was missing at least one store:
/// <list type="bullet">
/// <item>SM-6 audited "all 12" and left <c>historian</c> un-isolated deliberately, on reasoning that
/// turned out to be masking a Critical product bug (task-7 fixed both).</item>
/// <item>Task C-5 found <c>ST4I_NOTIFICATIONS_DIR</c> had never been isolated because C-2 added the store
/// AFTER SM-6's audit ran — so every <c>npm run test:e2e</c>/<c>npm run dev</c> since had been reading and
/// writing a real install's webhook URLs and SMTP passwords.</item>
/// <item>This batch found <c>creds</c> still un-isolated. The config's own note claimed "this suite never
/// calls anything that writes there"; a census of the real
/// <c>%ProgramData%\ST4I\sim\creds</c> found 633 files carrying the exact machine-code prefixes
/// <c>04-onboarding.spec.ts</c> mints (<c>SIM-E2E-*</c>, <c>SIM-E2E-IOT-*</c>, <c>SIM-E2E-RESET-*</c>,
/// <c>SIM-PASTE-*</c>) — one new, never-overwritten DPAPI-sealed credential per run.</item>
/// </list>
/// The pattern is not carelessness; it is that a hand-maintained list of stores cannot survive a store
/// being ADDED. So this test does not hold a list. It discovers every <c>ST4I_*_DIR</c> environment
/// variable the product declares in <c>src/</c> and requires the harness to set each one — a fifteenth
/// store fails it until the harness isolates that too.</para>
///
/// <para>This is the isolation counterpart to
/// <c>NotificationDocumentationTests.EveryDirectoryTheEngineCreatesUnderProgramData_IsPurgedByTheDecommissioningScript</c>,
/// which derives the same set for the DECOMMISSIONING side. The two failure modes are different — a store
/// that is never wiped, and a store that is written to by tests — but the cause is identical, so both are
/// guarded the same way.</para>
///
/// <para>Reads repository files by walking up from the test binary's own output directory, the idiom
/// <c>PackagingFleetJsonTests.MachineSimulatorRoot</c> established, so nothing here depends on the
/// working directory.</para>
/// </summary>
public sealed class TestHarnessIsolationTests
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

    /// <summary>Every <c>ST4I_*_DIR</c> env-var name declared as a string literal anywhere under
    /// <c>src/</c> — the one place a store names its own relocation variable. <c>bin/</c> and <c>obj/</c>
    /// carry generated copies of the same literals and are not sources of truth.</summary>
    private static SortedSet<string> DeclaredDirEnvVars()
    {
        var declared = new SortedSet<string>(StringComparer.Ordinal);
        var pattern = new Regex("\"(?<name>ST4I_[A-Z0-9_]*_DIR)\"", RegexOptions.None);

        foreach (var file in Directory.EnumerateFiles(
                     Path.Combine(MachineSimulatorRoot(), "src"), "*.cs", SearchOption.AllDirectories))
        {
            if (file.Contains($"{Path.DirectorySeparatorChar}bin{Path.DirectorySeparatorChar}", StringComparison.Ordinal) ||
                file.Contains($"{Path.DirectorySeparatorChar}obj{Path.DirectorySeparatorChar}", StringComparison.Ordinal))
            {
                continue;
            }

            foreach (Match m in pattern.Matches(File.ReadAllText(file)))
            {
                declared.Add(m.Groups["name"].Value);
            }
        }

        return declared;
    }

    [Fact]
    public void EveryStoreTheEngineCreates_IsIsolatedByThePlaywrightHarness()
    {
        var declared = DeclaredDirEnvVars();

        // Non-vacuity: if the scan finds nothing (a refactor moved the constants), this must fail loudly
        // rather than pass by asserting over an empty set — the exact shape of a vacuous test.
        Assert.True(declared.Count >= 13,
            $"Only {declared.Count} ST4I_*_DIR constant(s) were found in src/ ({string.Join(", ", declared)}). " +
            "The scan, not the harness, is what broke — fix the scan rather than deleting this assertion.");

        // The controls, named explicitly so a scan that silently stopped matching the credential-bearing
        // stores cannot leave this test green. These are the three that were actually found un-isolated.
        foreach (var mustFind in new[] { "ST4I_CREDS_DIR", "ST4I_NOTIFICATIONS_DIR", "ST4I_HISTORIAN_DIR" })
        {
            Assert.Contains(mustFind, declared);
        }

        var config = File.ReadAllText(
            Path.Combine(MachineSimulatorRoot(), "web", "playwright.config.ts"));

        // A mention in a comment is not isolation — require the assignment form the webServer env block
        // actually uses (`ST4I_XXX_DIR: join(e2eDataDir, "...")`). The three stores this test exists
        // because of were each DISCUSSED at length in that file's comments while remaining un-isolated.
        var missing = declared
            .Where(name => !Regex.IsMatch(config, $@"^\s*{Regex.Escape(name)}\s*:", RegexOptions.Multiline))
            .ToList();

        Assert.True(missing.Count == 0,
            "web/playwright.config.ts does not isolate every store the engine writes to. Missing: " +
            $"{string.Join(", ", missing)}. Every `npm run test:e2e` and `npm run dev` therefore reads and " +
            "writes a REAL install's data for those stores — which is how this harness came to create " +
            "login-capable accounts in a production security.db (SM-6), read and write real webhook URLs " +
            "and SMTP passwords (C-5), and leave 633 DPAPI-sealed machine credentials in the real creds " +
            "directory (test-hygiene batch). Add it to the webServer `env` block under `e2eDataDir`.");
    }
}
