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
/// <c>%ProgramData%\ST4I\sim\creds</c> found <b>613</b> files carrying the exact machine-code prefixes
/// <c>04-onboarding.spec.ts</c> mints (<c>SIM-E2E-*</c>, <c>SIM-E2E-IOT-*</c>, <c>SIM-E2E-RESET-*</c>,
/// <c>SIM-PASTE-*</c>, <c>SIM-E2E-FLAGOFF-*</c>) — one new, never-overwritten DPAPI-sealed credential per
/// run. 🔴 <b>This read "633 files" over FOUR prefixes until task K-1 re-measured it, and both halves were
/// wrong together</b>: the census counted 613, over FIVE prefixes (leak-report.md:308's regex). A count
/// and the list it is a count OF have to be corrected as one thing — fixing the number and leaving the
/// list is how a sentence stays false while looking audited.</item>
/// </list>
/// The pattern is not carelessness; it is that a hand-maintained list of stores cannot survive a store
/// being ADDED. So this test does not hold a list. It discovers every <c>ST4I_*_DIR</c> environment
/// variable the product declares in <c>src/</c> and requires the harness to set each one — the NEXT
/// store fails it until the harness isolates that too.
/// <b>🔴 That sentence used to say "a fifteenth store", and it was off by one when written</b> (branch
/// review, Minor 4): the product declared THIRTEEN variables then, so the next one was a fourteenth. It
/// is only accidentally true today, because H-1c added the fourteenth. Written as an ordinal it had to
/// rot; written as "the next" it cannot, which is the same reason every other count in this file is
/// derived rather than spelled.</para>
///
/// <para>🔴 <b>H-1c — this scan spans BOTH store populations, and that is correct rather than an
/// oversight.</b> <c>PerHostDataRootsTests</c> now partitions the <c>ST4I_*_DIR</c> set into the THIRTEEN
/// machine-wide directories under <c>%ProgramData%\ST4I\sim\&lt;name&gt;</c> and the beside-the-binary
/// stores (<c>ST4I_MACHINE_CONFIG_DIR</c> today), because the question there is per-host RELOCATABILITY
/// and only the first population answers it by mechanism. The question HERE is different: "does the
/// harness write into a real install's data?" — and a store that writes beside the engine's binary is
/// just as capable of that. So this test is population-BLIND on purpose, and the count it floors at (13)
/// is a non-vacuity floor on the scan, not a census of either population.
/// <b>H-1c is the case that proves the distinction is load-bearing:</b> adding
/// <c>ST4I_MACHINE_CONFIG_DIR</c> turned this test red until <c>playwright.config.ts</c> isolated it, and
/// the right response was to isolate it — not to narrow this scan to the machine-wide half, which would
/// have traded a real isolation guarantee for a tidier number.</para>
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
    // ─────────────────────────────────────────────────────────────────────────────────────────────
    // 🔴 BOOKED — AND THE CONSEQUENCE HALF IS NOW BUILT (task K-1), in tests/Shared/RealCredentialStoreLeakGuard.cs.
    // Kept here rather than deleted because the CASE is what the next reader needs, and because two of the
    // sentences below turned out to be false by the time they were acted on. See §8.1(h): an assertion —
    // including a SENTENCE — is evidence only for the tree state it was checked against, and this block
    // was written on a different branch.
    //
    // THE CASE, and K-1 found it is WIDER than this block stated. A census keyed on "which classes assign
    // ST4I_*_DIR" misses both measured leaks, on TWO DIFFERENT AXES:
    //   DEPTH  — OnboardingFleetJoinTests reached ST4I_CREDS_DIR two frames deep (ClaimAsync ->
    //            OnboardingService -> CredentialStore.Save) and named neither the variable nor the store.
    //            Every membership sweep on the branch that found it missed it.
    //   NAMING — StoreAndForwardRestartSurvivalTests calls CredentialStore.Save DIRECTLY (line 217), no
    //            depth at all, and still sets no ST4I_*_DIR, so the same census calls it clean. Its READ
    //            path does go through FleetHost.UpdateSettings -> CredentialStore.Load, which is what
    //            forced it into the env-var collection — but the WRITE was never at depth.
    // Both wrote real DPAPI blobs into a real %ProgramData%\ST4I\sim\creds. Widening the census along one
    // axis would still have missed the other; that is why the guard measures the consequence.
    //
    // 🔴 WHAT WAS ALREADY FALSE WHEN K-1 CHECKED IT, and both errors point the same way — the exemplar was
    // treated as the scope:
    //   (1) "OnboardingFleetJoinTests ... mentions nothing" — it does now, and did before K-1 started. Fix
    //       round 4 gave that class a per-class ST4I_CREDS_DIR override, the collection, and a paragraph
    //       naming both. The instance was remediated; the class of defect was not.
    //   (2) "It wrote ... for as long as it existed" reads as the whole story, and it is not. Measured
    //       2026-08-12 on this machine: the real creds directory holds 31 .bin files, of which 20 are
    //       SF-RESTART-<8 hex> — a prefix minted at StoreAndForwardRestartSurvivalTests.cs:216 and nowhere
    //       else in the tree — written 2026-08-01 12:57:39Z–13:04:49Z, i.e. after 208e5ccc (12:32:32Z)
    //       committed the "fixed at its mechanism" redirect. A DIFFERENT class from the one this block
    //       names, writing real credentials, is the strongest argument this file can carry for measuring
    //       the consequence instead of the naming.
    //       🔴 SCOPED, because the filesystem cannot say more than this: those timestamps establish
    //       ORDER against a commit time, NOT that the run which produced them was built from a post-fix
    //       tree. A developer iterating in that window (81e65367 lands 58 minutes later, on that very
    //       file) can run a stale binary. What is NOT in doubt is the class, the count and the fact that
    //       a naming census would have called that class clean: it sets no ST4I_*_DIR at all.
    //
    // WHY A "WHICH CLASSES SET THE VARIABLE" CENSUS IS THE WRONG INSTRUMENT, and this is the decisive
    // part: keyed on DIRECT ASSIGNMENT OF THE VARIABLE it returns GREEN over both cases above. That is
    // blueprint §8.1(f) with a completeness claim on top — a recogniser whose domain is inherited from
    // where its author was standing.
    // 🔴 That sentence said "keyed on the DIRECT half" until the branch review (Minor 8), which is the
    // word the NAMING bullet six lines up had just given a second, opposite meaning: one of the two leaks
    // IS a direct Save. "Direct" now names the assignment, never the call — a collision introduced by the
    // very paragraph that added the second axis, i.e. in the same round, which is where these land.
    //
    // WHAT IS BUILT: RealCredentialStoreLeakGuardTests asserts that the REAL creds root GAINS NO ENTRY
    // while a test process runs — a difference across an interval, never "is empty", because that
    // directory's contents are a deliberately kept evidence base and an emptiness check would be paid for
    // by deleting it. It is linked into ALL FIVE suites, not just this one, because the property is "no
    // test process writes there", and this file's own class was only ever an EXAMPLE of it. Read that
    // file's doc comment for the two holes it does NOT close (one process rather than the run; a window
    // ending when the fact runs) and for the gate-side anchor that would close both.
    //
    // WHAT IS STILL NOT BUILT: the RACE half — two classes interleaving on one variable — needs a runtime
    // fixture and its own decision, because a [Collection] omission changes SCHEDULING, not behaviour, and
    // therefore cannot be killed by a mutation (measured: dropping the attribute compiles and every test
    // passes). Named so the next person starts from the set.
    //
    // 🔴 AND THE RACE HALF HAS NOW BEEN SEEN TO FIRE, which is worth more than the argument that it could.
    // Recorded here, in the block that OWNS this item, because it was found during K-1's mutation round and
    // a finding that lives only in a report is a finding the next person does not have (branch review,
    // Minor 11). K-1's M2 mutation put a CredentialStore.Save behind a momentary
    // `SetEnvironmentVariable(ST4I_CREDS_DIR, null)` in one class. The first run of the suite reported TWO
    // failures; the immediate repeat, on the same binary, reported ONE — the guard alone. The second
    // failure did not reproduce and its name was not captured. That is exactly the shape this item
    // describes: a process-wide variable nulled by one class while another reads it, visible only as a
    // scheduling-dependent flake. It is evidence the hazard is live, NOT a measurement of which class lost
    // the race — nobody has that, and the honest gap is why this stays booked rather than closed.
    // ─────────────────────────────────────────────────────────────────────────────────────────────

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
            "and SMTP passwords (C-5), and leave 613 DPAPI-sealed machine credentials in the real creds " +
            "directory (test-hygiene batch). Add it to the webServer `env` block under `e2eDataDir`.");
    }
}
