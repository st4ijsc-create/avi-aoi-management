using System;
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
