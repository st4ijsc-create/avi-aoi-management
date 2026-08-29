using System;
using System.Collections.Generic;
using System.IO;
using System.Runtime.CompilerServices;
using System.Threading;

namespace St4i.TestHygiene;

/// <summary>
/// 🔴 Test-hygiene batch — <b>every test assembly's disposable scratch root, installed before the first
/// test runs and removed when the host exits.</b> Linked (not copied) into all five test projects; each
/// assembly gets its own module initializer and its own root.
///
/// <para><b>The defect this closes.</b> A measurement of this developer's machine found <b>501,713</b>
/// directories matching <c>st4i-*</c> in <c>%TEMP%</c> — <b>97%</b> of every entry in the user's temp
/// directory — and <b>2,999</b> DPAPI-sealed <c>.bin</c> blobs in
/// <c>C:\ProgramData\ST4I\sim\creds</c>, the product's REAL credential directory and the one
/// <c>packaging/remove-data.ps1</c> exists to purge when a machine is decommissioned. Both were
/// produced by the test suites themselves, and both were unbounded: nothing ever deleted them.</para>
///
/// <para><b>Why this is fixed here rather than at the 263 call sites.</b> The suites call
/// <see cref="Directory.CreateTempSubdirectory(string)"/> and <see cref="Path.GetTempPath"/> in 263
/// places across 73 files, none of which delete what they create. Rewriting all 263 would fix today's
/// call sites and none of tomorrow's — the 264th would leak again, silently, and nothing would catch
/// it. Redirecting the process's own notion of "the temp directory" fixes every existing call site,
/// every future one, and every leak inside a third-party library the suites load (the OPC Foundation
/// server stack writes PKI material to temp), with no per-test discipline required.</para>
///
/// <para><b>Verified, not assumed.</b> On .NET 10 / Windows,
/// <see cref="Environment.SetEnvironmentVariable(string,string)"/> writes through to the Win32
/// environment block, and <see cref="Path.GetTempPath"/> is <c>GetTempPathW</c> — which reads that
/// block on every call, with no caching. A standalone probe confirmed all three of
/// <see cref="Path.GetTempPath"/>, <see cref="Directory.CreateTempSubdirectory(string)"/> and
/// <see cref="Path.GetTempFileName"/> follow a redirect applied at runtime. This is load-bearing: if it
/// silently stopped working, the leak would resume at full rate, which is why
/// <c>TestRunTempRootTests</c> asserts the redirect rather than trusting this comment.</para>
///
/// <para><b><see cref="CredentialStore"/> gets an explicit redirect too</b>
/// (<c>ST4I_CREDS_DIR</c>), because it is the one store whose directory is NOT under
/// <c>%TEMP%</c> — it resolves under <c>%ProgramData%</c>. Until the test-hygiene batch it had no
/// override at all, which is precisely why ~3,000 test credentials accumulated in the real one while
/// every sibling store's equivalent went to a throwaway directory.</para>
///
/// <para>🔴 <b>Task X-1 — <c>ST4I_MACHINE_CONFIG_DIR</c> is a THIRD redirect, and the store behind it is
/// in neither of the two places this file was written about.</b> <c>MachineConfigStore</c>'s default root
/// is <see cref="AppContext.BaseDirectory"/> — the test assembly's OWN OUTPUT DIRECTORY, beside the built
/// binary — so neither the <c>TMP</c>/<c>TEMP</c> redirect nor <c>ST4I_CREDS_DIR</c> ever touched it.
/// Measured on this machine before the redirect: that directory's
/// <c>machine-operating-config.json</c> held <b>240,778</b> bytes across SEVEN machine codes, of which
/// <b>165,046</b> were a single machine's <c>History</c> list at <b>624</b> entries — one appended per
/// run of <c>St4i.EngineApi.Tests</c>, forever, on a machine code that never changes. Two tests in
/// <c>AuditWiringTests</c> carry comments saying so and are written to survive it rather than to stop it.
///
/// <para><b>The two-thirds this redirect does NOT reach, named because the sentence above would
/// otherwise read as the whole store population.</b> The product roots THREE stores beside the binary
/// (<c>MachineConfigStore</c>'s own remarks enumerate them). Only this one has a relocation variable;
/// <c>ProductConfigStore</c> and <c>SimulatedEcosystem</c> have none, so no value set here can move them.
/// See <see cref="OwnOutputDirectoryWatch"/> for what that costs and how it is measured.</para>
///
/// <para>📎 <b>THE PARAGRAPH ABOVE IS RETRACTED, 2026-08-23 (BF-1), verbatim.</b> Both stores now declare a
/// seam (<c>ST4I_PRODUCTS_DIR</c>, <c>ST4I_ECOSYSTEM_DIR</c>) and both are set below, so the redirect
/// reaches all three. It is retracted rather than edited because its reasoning was right and only its
/// subject changed: the two stores had no variable because moving a store's default is a deployment
/// decision, and on 2026-08-23 the owner took that decision. 🔴 <b>The three stores are no longer beside
/// the binary at all</b> — their defaults are <c>%ProgramData%\ST4I\sim\{products,ecosystem,machine-config}</c>
/// — so what these three variables now buy is not "a file leaves this directory" but "a suite does not
/// write into a real install". That is a bigger prize and a different one.</para></para>
///
/// <para><b>The one leak this cannot close, stated honestly — and measured.</b> A root is removed on
/// <see cref="AppDomain.ProcessExit"/>, but that is not guaranteed to succeed:
/// <list type="bullet">
/// <item>A host that is KILLED (the 900 s ceiling in <c>scripts/verify-suites.sh</c>, a
/// <c>taskkill</c>, a crash) never runs the handler at all.</item>
/// <item>🔴 And a host that exits NORMALLY can still fail to delete. Observed, not hypothesised: after
/// a full suite run, <c>St4i.EngineApi.Tests</c>' root survived holding 2,078 subdirectories, because
/// <see cref="AppDomain.ProcessExit"/> runs on a SHORT runtime budget and the tree still had SQLite
/// handles closing. The identical delete succeeded instantly a minute later.</item>
/// </list>
/// So the handler is the fast path, not the guarantee. The guarantee is
/// <see cref="SweepStaleRoots"/>: it reclaims a root as soon as the process that owned it is gone,
/// identified by the PID embedded in the root's own name. The bound is therefore <b>at most one root
/// per test assembly, reclaimed at the start of that assembly's next run</b> — a fixed ceiling of five
/// on this repository, not growth. Compare the old arrangement, which added ~250 loose directories to
/// <c>%TEMP%</c> per run and removed none, ever.</para>
/// </summary>
internal static class TestRunTempRoot
{
    /// <summary>Age backstop for the PID check in <see cref="SweepStaleRoots"/> — see that method for
    /// why both tests exist. Generous enough that a CONCURRENTLY running assembly (five suites, or a
    /// developer's parallel run) is never mistaken for abandoned residue even if the PID test somehow
    /// misfires: the longest suite here runs ~4 minutes and the verify script's own hard ceiling is
    /// 900 s.</summary>
    private static readonly TimeSpan StaleAfter = TimeSpan.FromHours(2);

    /// <summary>The resolved root for this process, or <see langword="null"/> if setup failed (in which
    /// case nothing was redirected and the suite behaves exactly as it did before).</summary>
    internal static string? Root { get; private set; }

    /// <summary>🔴 Task CB-1 — the <c>ST4I_*_DIR</c> redirects this initializer actually INSTALLED, captured
    /// at start-up, keyed by variable name.
    ///
    /// <para><b>Why a record exists rather than the witnesses reading the live environment.</b> A test that
    /// asserted the ambient state by calling <c>Environment.GetEnvironmentVariable</c> — or a store's
    /// <c>ResolveRoot()</c>, which does the same thing internally — would be reading a PROCESS-WIDE value
    /// that other test classes legitimately flip while it runs. MEASURED at CB-1: within
    /// <c>St4i.EngineApi.Tests</c> alone, SEVENTEEN OR EIGHTEEN classes set each of these variables to a
    /// per-class temporary directory — eighteen for every variable except <c>ST4I_SETTINGS_DIR</c>, which is
    /// seventeen — and several EdgeCore classes set theirs to <see langword="null"/> to assert the
    /// default arm. xunit runs collections in parallel by default and this repository declares no
    /// <c>xunit.runner.json</c> and no assembly-level collection behaviour, so those flips and a live read
    /// genuinely interleave. A witness built on a live read would therefore be FLAKY, and a flaky witness
    /// for a leak guard is worse than none: it teaches its readers to re-run it.</para>
    ///
    /// <para>This snapshot is written once, before the first test executes, and never mutated afterwards, so
    /// a witness built on it measures exactly what it claims to measure — what the HARNESS installed — and
    /// is deterministic under any interleaving. What it deliberately does NOT measure is what the variable
    /// holds at the moment a given test reads it; that is the flipping class's own business and is the
    /// property those classes' own tests already assert.</para></summary>
    internal static IReadOnlyDictionary<string, string> InstalledRedirects { get; private set; } =
        new Dictionary<string, string>(StringComparer.Ordinal);

    [ModuleInitializer]
    internal static void Initialize()
    {
        // A throw here would fault the module's static constructor and fail the ENTIRE assembly before a
        // single test ran, turning a hygiene measure into an outage. Nothing below is allowed to escape.
        try
        {
            var realTemp = Path.GetTempPath();

            SweepStaleRoots(realTemp);

            var root = Path.Combine(
                realTemp,
                $"st4i-testrun-{SafeAssemblyName()}-{Environment.ProcessId}-{Guid.NewGuid():N}");
            Directory.CreateDirectory(root);

            // TMP is what GetTempPathW consults first, TEMP second. Set both so the redirect holds no
            // matter which the runtime or a loaded library reaches for.
            Environment.SetEnvironmentVariable("TMP", root);
            Environment.SetEnvironmentVariable("TEMP", root);

            // CredentialStore resolves under %ProgramData%, not %TEMP%, so redirecting the temp
            // directory does nothing for it — it needs its own seam (added by this batch). Honour a
            // value an outer harness already set rather than overriding a deliberate choice.
            if (string.IsNullOrWhiteSpace(Environment.GetEnvironmentVariable("ST4I_CREDS_DIR")))
            {
                Environment.SetEnvironmentVariable("ST4I_CREDS_DIR", Path.Combine(root, "creds"));
            }

            // 🔴 Task X-1 — MachineConfigStore is the OTHER direction of the same miss, and it is the one
            // this file left open for eight tasks. Its default root is neither %TEMP% nor %ProgramData%:
            // it is AppContext.BaseDirectory, i.e. THIS ASSEMBLY'S OWN OUTPUT DIRECTORY, so the two
            // redirects above reach it exactly as far as they reached CredentialStore before it got a
            // seam of its own — not at all. Spelled as a literal rather than as
            // MachineConfigStore.EnvVarDir because two of the five projects this file is linked into
            // reference only their own contract assembly and cannot see that constant;
            // TestRunTempRootTests.MachineConfigStore_ResolvesAwayFromThisAssembliesOwnOutputDirectory
            // is what pins the literal to the product's own name for it.
            //
            // WHAT THIS DOES NOT REACH, and it is two thirds of the population: ProductConfigStore
            // (products.json, recipes.json) and St4i.EngineApi.Config.SimulatedEcosystem
            // (ecosystem/ecosystem-*.json) resolve to the SAME directory and have NO relocation variable
            // at all, so there is nothing here to set for them. Giving them one is a change to src/ and
            // therefore out of this task's bounds. OwnOutputDirectoryGuard is where that gap is measured
            // and named rather than asserted away.
            if (string.IsNullOrWhiteSpace(Environment.GetEnvironmentVariable("ST4I_MACHINE_CONFIG_DIR")))
            {
                Environment.SetEnvironmentVariable(
                    "ST4I_MACHINE_CONFIG_DIR", Path.Combine(root, "machine-config"));
            }

            // 🔴 Task BF-1 — the "two thirds this redirect does not reach" is now zero thirds, and the two
            // lines below are the whole of what changed here. The owner's 2026-08-23(a) ruling moved
            // ProductConfigStore's and SimulatedEcosystem's defaults to %ProgramData%\ST4I\sim\{products,
            // ecosystem}, which forced both stores to grow a seam: twenty WebApplicationFactory<Program>
            // classes resolve them through the real DI graph, so without these two variables every suite
            // would write into a REAL install's data instead of into its own output directory. That would
            // have been strictly WORSE than the leak it replaced — the output-directory bracket watches
            // bin/, and nothing at all watches %ProgramData%\ST4I\sim\products.
            //
            // Spelled as literals for the same reason ST4I_MACHINE_CONFIG_DIR is: two of the five projects
            // this file is linked into reference only their own contract assembly and cannot see the
            // constants. TestRunTempRootTests pins each literal to the product's own name for it.
            if (string.IsNullOrWhiteSpace(Environment.GetEnvironmentVariable("ST4I_PRODUCTS_DIR")))
            {
                Environment.SetEnvironmentVariable("ST4I_PRODUCTS_DIR", Path.Combine(root, "products"));
            }

            if (string.IsNullOrWhiteSpace(Environment.GetEnvironmentVariable("ST4I_ECOSYSTEM_DIR")))
            {
                Environment.SetEnvironmentVariable("ST4I_ECOSYSTEM_DIR", Path.Combine(root, "ecosystem"));
            }

            // 🔴 Task BK-1 — THESE TWO ARE NOT SPECULATIVE COVERAGE. They close a leak that was OBSERVED,
            // four separate times, into a REAL install's data: BJ-1 measured C:\ProgramData\ST4I\sim\assets\
            // assets.db rewritten at 16:55:04 and again at 18:30:16 on 2026-08-23 — two independent gate
            // windows, with the notifications leaf's directory mtime moving alongside both — and this task
            // reproduced it a third and fourth time on the same day. So it is a PROPERTY of running the gate,
            // not an incident. The reason it was invisible for so long is exactly what docs/owner-decisions.md
            // item 51 sub-item 5 is about: assets and notifications are two of the leaves nothing watches, so
            // the one guarded leaf (creds) stayed green through every one of those writes.
            //
            // 🔴 AND THE HALF THAT IS NOT A FIX, said here rather than left to be discovered: this redirects
            // where the TEST SUITE writes. It does not give the product a new default, does not touch either
            // store, and settles nothing about the sixteen %ProgramData% roots as a product question. The
            // stores' own EnvVarDir seams already existed; nothing in src/ changed for this.
            //
            // Spelled as literals for the same reason the four above are: two of the five projects this file
            // is linked into reference only their own contract assembly and cannot see
            // AssetRegistryStore.EnvVarDir or NotificationConfigStore.EnvVarDir. RealProgramDataLeakGuard is
            // what now measures the CONSEQUENCE, which is the assertion that does not depend on the spelling.
            //
            // 🔴 THE LAST SENTENCE ABOVE IS RETRACTED, 2026-08-24 (task BW-1, docs/owner-decisions.md item 72
            // §72.2(ii)). It is kept verbatim rather than edited, because the retraction is the record.
            // RealProgramDataLeakGuard.cs DOES NOT EXIST and has not existed since the commit that wrote that
            // sentence: BK-1 built it, its own control pair refuted it — with the redirects removed the suite
            // rewrote the real assets.db and the guard stayed GREEN, because a [Fact]'s window ends when xunit
            // schedules it — and it was deleted in that same commit. scripts/verify-suites.sh records the
            // deletion in the PAST tense; this line did not, so for three tasks it sent a reader of tests/Shared/
            // to a file that was never there. Re-measured at BW-1, 2026-08-24: tests/Shared/ holds exactly three
            // files (OwnOutputDirectoryGuard.cs, RealCredentialStoreLeakGuard.cs, this one), and the three places
            // that still spell the name are docs/owner-decisions.md, scripts/verify-suites.sh and this comment.
            // WHAT ACTUALLY MEASURES THE CONSEQUENCE is the %ProgramData% bracket in scripts/verify-suites.sh
            // (sim_snapshot), which spans all five suite PROCESSES — the thing a [Fact] cannot do. Its own reach
            // is stated where it is read; two limits belong here because this comment is what sends people to it:
            // the bracket runs ONLY inside verify-suites.sh, so a plain `dotnet test` has no witness at all, and
            // it enumerates `-type f`, so a leak that moves only a DIRECTORY's mtime is invisible to it. (It is
            // not blind to a file REWRITE: its printf records path, size and mtime per file. Item 72 §72.2(i)
            // quotes the command without that printf and reads narrower than the instrument is.)
            if (string.IsNullOrWhiteSpace(Environment.GetEnvironmentVariable("ST4I_ASSETS_DIR")))
            {
                Environment.SetEnvironmentVariable("ST4I_ASSETS_DIR", Path.Combine(root, "assets"));
            }

            if (string.IsNullOrWhiteSpace(Environment.GetEnvironmentVariable("ST4I_NOTIFICATIONS_DIR")))
            {
                Environment.SetEnvironmentVariable("ST4I_NOTIFICATIONS_DIR", Path.Combine(root, "notifications"));
            }

            // 🔴 Task BW-1, 2026-08-24 — docs/owner-decisions.md item 72, OPTION B under the owner's ruling of
            // that date. This is the SEVENTH redirect, and it is the one leaf where the item's own number did
            // not survive re-measurement — in the alarming direction.
            //
            // ITEM 72's TABLE says ST4I_OPCUA_PKI_DIR is set by "exactly ONE test file", against 20-24 files for
            // each of the other nine %ProgramData% leaves, and calls that the reason it is the worst leaf.
            // RE-COUNTED AT BW-1 over tests/: ONE file MENTIONS the literal and ZERO files SET it. Both mentions
            // are inside a doc comment in tests/St4i.EngineApi.Tests/PerHostDataRootsTests.cs, and one of them
            // states the conclusion outright — "the true residual is narrower: nothing exercises
            // ST4I_OPCUA_PKI_DIR, the env var". scripts/verify-suites.sh carries the same sentence. So the
            // column heading "the file that SETS it" was measured with an instrument that cannot produce it —
            // a literal count over tests/ — and PerHostDataRootsTests' own F-8 note says that instrument cannot
            // produce those rows. The seam existed, the product read it, and no suite drove it.
            //
            // WHAT THAT MEANT ON DISK. OpcUaDriver's constructor resolves explicit > env > default
            // (OpcUaPkiPaths.ResolveRoot, OpcUaDriver.cs:208). OpcUaDriverConformanceTests,
            // OpcUaDriverLoopbackTests and OpcUaDriverWriteTests each pass a real temporary root, so they take
            // the EXPLICIT arm. Any class that does not — including the one nobody has written yet — took the
            // DEFAULT arm, and the default arm is %ProgramData%\ST4I\sim\opcua-pki: the OPC-UA app-instance
            // certificate, ITS PRIVATE KEY, and the trusted-peer store of a real installation.
            //
            // 🔴 WHAT THIS IS NOT, said here rather than left to be inferred. (1) It redirects where the TEST
            // SUITE writes. It gives the product no new default, changes no line under src/, and settles
            // nothing about the sixteen %ProgramData% roots as a product question — the same boundary the two
            // BK-1 variables above carry. (2) It is not evidence of a leak. Measured 2026-08-24:
            // C:\ProgramData\ST4I\sim\opcua-pki holds 3 files whose newest mtime is 2026-07-29 15:42:07, and
            // the directory's own mtime is the same instant. What is closed here is a CAPABILITY, not an
            // observed write, and item 72 says so in its own words.
            // (3) 🔴 A PRICE THIS ONE HAS THAT THE OTHER SIX DO NOT, measured rather than assumed:
            // OpcUaPkiPaths' class doc records that the OPC Foundation Directory certificate store round-trips
            // a just-created cert through native Windows crypto that fails once the FULL file path approaches
            // legacy MAX_PATH, and that a deeply-nested scratch root once tripped it. A run root here is
            // ~120 characters and a cert file adds ~55, so ~175 of 260 on this machine — inside the limit with
            // headroom, and the headroom is a property of THIS machine's %TEMP%, not of this code. It is stated
            // and deliberately NOT asserted: a threshold invented here would be a false positive with no
            // measurement behind it. A machine with a deep %TEMP% is where to expect this to bite.
            //
            // Spelled as a literal for the same reason the six above are: two of the five projects this file is
            // linked into reference only their own contract assembly and cannot see OpcUaOptions.EnvVarPkiDir.
            // TestRunTempRootTests.OpcUaPkiStore_ResolvesAwayFromTheRealProgramDataPkiDirectory pins the literal
            // to the product's own name for it, and is what goes red if this block is deleted.
            if (string.IsNullOrWhiteSpace(Environment.GetEnvironmentVariable("ST4I_OPCUA_PKI_DIR")))
            {
                Environment.SetEnvironmentVariable("ST4I_OPCUA_PKI_DIR", Path.Combine(root, "opcua-pki"));
            }

            // 🔴 Task CB-1, 2026-08-29 — docs/owner-decisions.md item 72, OPTION A under the owner's ruling of
            // 2026-08-25: the REMAINING %ProgramData%\ST4I\sim leaves go from CONVENTION to STRUCTURE, so that a
            // class nobody has written yet cannot forget. These nine move as ONE batch and share one rationale,
            // which is why they are a table rather than nine hand-written blocks like the seven above; those seven
            // each carry a rationale of their own that collapsing them would destroy.
            //
            // THE POPULATION, RE-COUNTED AT CB-1 RATHER THAN INHERITED, because item 72 has now had a number
            // refuted twice by the very tasks executing it. Counted by the `"ST4I", "sim", "<leaf>"` literal over
            // src/ — the same instrument NotificationDocumentationTests uses, so the two agree by construction:
            // SIXTEEN leaves exist, SEVEN were already structural (creds, machine-config, products, ecosystem,
            // assets, notifications, opcua-pki — the seven blocks above), and NINE remain. The item's "nine" is
            // therefore CORRECT as a count of LEAVES. It is not correct as a count of anything else, and the unit
            // is where this item keeps going wrong:
            //   9 leaves · 9 variables · but only EIGHT store-level seams · and TEN producer classes,
            // because `historian` has TWO producers and NO seam on either of them. See the block below.
            //
            // WHAT THIS BUYS THAT THE CONVENTION DID NOT, measured rather than argued (item 72 asks the question
            // and this is the answer): the redirect is a [ModuleInitializer], so it is ambient for the whole
            // assembly and applies to a BARE `dotnet test` with no gate involved. MEASURED at CB-1 by running
            // this file's own witnesses under `dotnet test --filter` outside scripts/verify-suites.sh. The
            // %ProgramData% BRACKET in that script — the thing that DETECTS a leak — is gate-only, and that is
            // the limit already recorded above. Prevention and detection have different reach, and until now
            // only detection's reach had been written down.
            //
            // WHAT IT DOES NOT BUY, said here rather than left to be discovered. (1) It redirects where the TEST
            // SUITE writes; it gives the product no new default and changes no line under src/. (2) It is not
            // evidence of a leak: measured 2026-08-29, none of these nine real leaves had been written by a bare
            // `dotnet test` of St4i.EdgeCore.Tests, because the per-class convention was in fact holding. What is
            // closed is the CAPABILITY that convention leaves open for the class nobody has written yet — item 72
            // says "capability, not event" in its own words and this does not upgrade it. (3) It does NOT close
            // the directory-MTIME hole: that is a property of the gate bracket's `find -type f`, not of this file,
            // and nothing here changes it.
            //
            // EACH CLASS THAT SETS ITS OWN VARIABLE STILL WINS — the primary regression risk of this batch, and
            // the reason every line below is guarded by the same IsNullOrWhiteSpace check the seven above use
            // rather than an unconditional Set. A test class that assigns its variable at RUNTIME overwrites this
            // start-up default and is unaffected; a class that saves-sets-restores now restores to this root
            // instead of to null, which is strictly better. TestRunTempRootTests.EveryStructuralRedirect_*
            // is the red-able witness for the winning arm specifically, not merely for the root existing.
            var installed = new Dictionary<string, string>(StringComparer.Ordinal);
            foreach (var (variable, leaf) in new[]
                     {
                         ("ST4I_SECURITY_DIR", "security"),
                         ("ST4I_ALARMS_DIR", "alarms"),
                         ("ST4I_CONNECTOR_CONFIG_DIR", "connector-config"),
                         ("ST4I_SETTINGS_DIR", "settings"),
                         ("ST4I_IDENTITY_DIR", "identity"),
                         ("ST4I_SITELINK_DIR", "sitelink"),
                         ("ST4I_BRIDGE_SPOOL_DIR", "bridge-spool"),
                         ("ST4I_WAL_DIR", "wal"),

                         // 🔴 THE NINTH IS NOT LIKE THE OTHER EIGHT, and this is the measurement item 72 does not
                         // contain. The eight above each have a store-level seam — a public ResolveRoot (or
                         // FromEnvironment) that reads the variable — so setting it here reaches EVERY caller,
                         // including one constructing the store with no argument. `historian` has NO such seam:
                         // SqliteHistorianStore.DefaultRoot() and OeeSettingsStore.DefaultRoot() are both PRIVATE,
                         // both hardcode the ProgramData path, and NEITHER reads an environment variable
                         // (GetEnvironmentVariable count in both files: zero, measured at CB-1). The variable is
                         // read in exactly one place, Program.cs:412, as a bare string literal with no const
                         // behind it — the composition root, which then threads the resolved value into both
                         // stores. So this line closes the WebApplicationFactory<Program> path and NOT
                         // `new SqliteHistorianStore()`. Direct construction with no argument still resolves to
                         // the REAL %ProgramData%\ST4I\sim\historian, and no value set here can change that.
                         // Giving those two stores a seam is a change to src/ — it alters how the SHIPPING
                         // product resolves its historian directory — which this task's brief forbids outright.
                         // It is therefore STOPPED AND REPORTED rather than fixed here, and item 72 stays PARTIAL
                         // on this leaf for a reason that is measured rather than asserted.
                         ("ST4I_HISTORIAN_DIR", "historian"),
                     })
            {
                if (string.IsNullOrWhiteSpace(Environment.GetEnvironmentVariable(variable)))
                {
                    var target = Path.Combine(root, leaf);
                    Environment.SetEnvironmentVariable(variable, target);
                    installed[variable] = target;
                }
            }

            // Only the redirects this run actually INSTALLED are recorded. A variable an outer harness had
            // already set is deliberately absent rather than recorded with the inherited value: the record
            // exists to witness what this file did, and an entry it did not write would make a deliberate
            // outer choice read as this initializer's own work.
            InstalledRedirects = installed;

            Root = root;
            AppDomain.CurrentDomain.ProcessExit += (_, _) => TryDeleteTree(root);
        }
        catch
        {
            // Leave Root null and every env var untouched: the suite runs exactly as before, leaking as
            // before, rather than failing to run at all.
        }
    }

    /// <summary>Reclaims roots whose owning host is gone — see this class's own doc comment for why the
    /// <see cref="AppDomain.ProcessExit"/> handler is a fast path rather than a guarantee.
    ///
    /// <para>A root is swept when EITHER test holds:</para>
    /// <list type="number">
    /// <item><b>Its owning process is no longer alive.</b> The PID is embedded in the root's own name,
    /// so this is precise and immediate — a root abandoned by a killed or slow-exiting host is
    /// reclaimed by the very next run rather than waiting out a timer. A CONCURRENTLY running assembly
    /// is never touched, because its process is by definition still alive.</item>
    /// <item><b>Or it is older than <see cref="StaleAfter"/>.</b> The backstop for the one case test 1
    /// gets wrong: Windows reuses PIDs, so a dead host's number may belong to some unrelated live
    /// process, which would make test 1 skip the root forever. Age catches it. (The reverse error —
    /// deleting a LIVE assembly's root — is not possible from either test.)</item>
    /// </list>
    ///
    /// Best-effort and silent: a root that fails to delete is simply retried by whichever run comes
    /// next.</summary>
    private static void SweepStaleRoots(string realTemp)
    {
        try
        {
            var cutoff = DateTime.UtcNow - StaleAfter;
            foreach (var dir in Directory.EnumerateDirectories(realTemp, "st4i-testrun-*"))
            {
                try
                {
                    if (OwningProcessIsGone(dir) || Directory.GetCreationTimeUtc(dir) < cutoff)
                    {
                        TryDeleteTree(dir);
                    }
                }
                catch
                {
                    // A single unreadable entry must not stop the sweep.
                }
            }
        }
        catch
        {
            // No sweep is strictly required for correctness; never let it break startup.
        }
    }

    /// <summary>Reads the PID out of a root's name (<c>st4i-testrun-&lt;assembly&gt;-&lt;pid&gt;-&lt;guid&gt;</c>)
    /// and reports whether that process is still running. Returns <see langword="false"/> — "assume
    /// alive, do not sweep" — whenever the name cannot be parsed or the answer cannot be determined, so
    /// an unexpected name shape can never cause a live run's root to be deleted out from under it.</summary>
    private static bool OwningProcessIsGone(string dir)
    {
        var name = Path.GetFileName(dir);
        var parts = name.Split('-');

        // Layout: st4i | testrun | <assembly-with-hyphens...> | <pid> | <guid>
        if (parts.Length < 5) return false;
        if (!int.TryParse(parts[^2], out var pid) || pid <= 0) return false;

        // Never sweep our own root via this path.
        if (pid == Environment.ProcessId) return false;

        try
        {
            using var _ = System.Diagnostics.Process.GetProcessById(pid);
            return false; // still running
        }
        catch (ArgumentException)
        {
            return true; // no such process — the owner is gone
        }
        catch
        {
            return false; // cannot tell (access denied, ...) — leave it to the age rule
        }
    }

    /// <summary>Recursive best-effort delete with a short retry. The retry is not superstition: SQLite
    /// connections, OPC-UA PKI handles and <see cref="System.Diagnostics.Process"/> exits can all hold a
    /// file open for a few milliseconds past the last test, and a single failed attempt would strand the
    /// whole tree.
    ///
    /// <para>Deliberately kept SHORT (3 attempts, ~200 ms of waiting) rather than made stubborn: on the
    /// <see cref="AppDomain.ProcessExit"/> path this runs against a limited runtime budget, and a
    /// handler that overruns it is cut off having achieved nothing. Giving up quickly is correct here
    /// because <see cref="SweepStaleRoots"/>, not this method, is what guarantees the root is
    /// eventually reclaimed.</para></summary>
    private static void TryDeleteTree(string path)
    {
        for (var attempt = 0; attempt < 3; attempt++)
        {
            try
            {
                if (!Directory.Exists(path)) return;
                Directory.Delete(path, recursive: true);
                return;
            }
            catch (Exception) when (attempt < 2)
            {
                Thread.Sleep(100);
            }
            catch
            {
                // Still locked after three attempts — leave it. SweepStaleRoots reclaims it on the next
                // run of this assembly, as soon as this process is gone.
                return;
            }
        }
    }

    private static string SafeAssemblyName()
    {
        var name = typeof(TestRunTempRoot).Assembly.GetName().Name ?? "tests";
        Span<char> buffer = stackalloc char[name.Length];
        for (var i = 0; i < name.Length; i++)
        {
            buffer[i] = char.IsLetterOrDigit(name[i]) ? char.ToLowerInvariant(name[i]) : '-';
        }
        return new string(buffer);
    }
}
