using System.Diagnostics;
using System.Text.RegularExpressions;
using Xunit;

namespace St4i.EngineApi.Tests;

/// <summary>
/// 🔴 <b>Task BF-1, WITNESS (iii) for the owner's ruling of 2026-08-23(b) — <c>packaging/remove-data.ps1</c>
/// really does delete the historian, the credential store and the audit-log database, and really does LEAVE
/// the four operator-authored configuration files where they are.</b>
///
/// <para><b>Why this RUNS the script instead of reading it.</b> Its sibling in
/// <c>NotificationDocumentationTests</c> is a census over the script's TEXT: every declared leaf appears in
/// exactly one of two lists. That is the right instrument for "a new store arrived and nobody noticed", and
/// it is the wrong instrument for "the ruling is actually honoured" — a <c>$keptByDesign</c> array that the
/// deletion loop happened to iterate would satisfy every text assertion while deleting the very files the
/// ruling protects. The two are complementary and neither replaces the other.</para>
///
/// <para>🔴 <b>THE SAFETY ARRANGEMENT, because this fact executes a script whose whole purpose is
/// irreversible deletion, and it must never reach a real machine's data.</b> Two independent measures, and
/// each is asserted rather than trusted:
/// <list type="number">
/// <item><b>Every leaf is redirected, and the leaf list is DERIVED from <c>src/</c> rather than typed.</b>
/// A seventeenth store added tomorrow is redirected by this fact automatically; a typed list would have
/// pointed the seventeenth at a real <c>%ProgramData%</c> directory and deleted it. The redirect goes in
/// through the child process's own environment block, which is the same
/// <c>-XxxDir &gt; env var &gt; %ProgramData%</c> order the script documents.</item>
/// <item><b>The Windows service step is neutralised by shadowing <c>Get-Service</c> with a function that
/// returns <see langword="null"/>.</b> PowerShell resolves functions ahead of cmdlets, so the script takes
/// its "not installed - nothing to stop/delete" branch and <c>sc.exe delete</c> is never reached. Without
/// this, a developer machine with the real <c>St4iEngineApi</c> service installed would have that service
/// stopped and deleted by a test run. <c>-NonInteractive</c> is set as well, so any confirmation prompt
/// this arrangement failed to suppress errors out instead of hanging the suite.</item>
/// </list>
/// The redirect is then CHECKED after the fact: the temp root must still exist and the script's own output
/// must name paths inside it. A redirect that silently failed would otherwise look exactly like a
/// successful run, and this is the one fact in the repository where that mistake is unrecoverable.</para>
/// </summary>
public sealed class OperatorConfigSurvivesDecommissioningTests
{
    /// <summary>
    /// The leaves a decommissioning wipe KEEPS: two by the owner's 2026-08-23(b) ruling (holding the four
    /// operator-authored configuration files between them), and 🔴 <c>license</c> by the ruling of
    /// 2026-09-06.
    ///
    /// <para><b>Why the licence joined them.</b> The first two hold configuration an operator AUTHORED;
    /// the licence holds property the customer BOUGHT, which is the same argument one step on. Purging it
    /// would make a routine reinstall force offline reactivation — a fingerprint read off the appliance,
    /// an e-mail to ST4I, a wait, a paste — which on the offline machines this product targets is a trip
    /// to the factory. WS-E's implementer hit the pin that forbade a third member, purged the licence
    /// instead, wrote the argument beside it and escalated; the owner then ruled.</para>
    /// </summary>
    private static readonly string[] KeptLeaves = ["ecosystem", "license", "products"];

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
            "Could not locate tools/machine-simulator by walking up from " +
            $"\"{AppContext.BaseDirectory}\". Fix the walk — do NOT weaken the assertions below, and above " +
            "all do not let this fact run without its redirect.");
    }

    /// <summary>Every <c>%ProgramData%\ST4I\sim\&lt;leaf&gt;</c> name declared in <c>src/</c> — the same scan
    /// the two census facts use, repeated here rather than shared because this fact lives or dies on the
    /// list being complete and a shared helper is one more place it could be narrowed.</summary>
    private static SortedSet<string> DeclaredLeaves()
    {
        var leaves = new SortedSet<string>(StringComparer.Ordinal);
        var constant = new Regex("\"ST4I\"\\s*,\\s*\"sim\"\\s*,\\s*\"(?<name>[A-Za-z0-9._-]+)\"");

        foreach (var file in Directory.EnumerateFiles(
                     Path.Combine(MachineSimulatorRoot(), "src"), "*.cs", SearchOption.AllDirectories))
        {
            if (file.Contains($"{Path.DirectorySeparatorChar}bin{Path.DirectorySeparatorChar}", StringComparison.Ordinal) ||
                file.Contains($"{Path.DirectorySeparatorChar}obj{Path.DirectorySeparatorChar}", StringComparison.Ordinal))
            {
                continue;
            }

            foreach (Match m in constant.Matches(File.ReadAllText(file)))
            {
                leaves.Add(m.Groups["name"].Value);
            }
        }

        return leaves;
    }

    private static string EnvVarFor(string leaf) =>
        "ST4I_" + leaf.ToUpperInvariant().Replace('-', '_') + "_DIR";

    [Fact]
    public void TheDecommissioningWipe_DeletesHistorianCredsAndTheAuditLog_AndKEEPSTheFourConfigFiles()
    {
        var leaves = DeclaredLeaves();

        // Non-vacuity, and it is load-bearing twice over: an empty or short list would make every assertion
        // below trivially true AND would leave un-redirected leaves pointing at real %ProgramData%.
        Assert.True(leaves.Count >= 16,
            $"Only {leaves.Count} data-directory constant(s) were found in src/ ({string.Join(", ", leaves)}). " +
            "The scan is what broke — and until it is fixed this fact MUST NOT run, because an unlisted " +
            "leaf is a leaf this run would let the script delete for real.");
        foreach (var control in new[] { "historian", "creds", "security", "products", "ecosystem", "machine-config" })
        {
            Assert.Contains(control, leaves);
        }

        var sandbox = Directory.CreateTempSubdirectory("st4i-decommission-witness-").FullName;
        try
        {
            // One directory per leaf, each holding a file whose bytes are recognisable, so "survived" is
            // measured on CONTENT rather than on a directory entry that an empty re-creation would satisfy.
            foreach (var leaf in leaves)
            {
                Directory.CreateDirectory(Path.Combine(sandbox, leaf));
                File.WriteAllText(Path.Combine(sandbox, leaf, $"{leaf}.marker"), $"bytes-for-{leaf}");
            }

            // The four files the ruling is actually about, written where their stores would write them.
            File.WriteAllText(Path.Combine(sandbox, "products", "products.json"), "[{\"code\":\"OPERATOR\"}]");
            File.WriteAllText(Path.Combine(sandbox, "products", "recipes.json"), "[{\"code\":\"OPERATOR-R\"}]");
            File.WriteAllText(
                Path.Combine(sandbox, "ecosystem", "ecosystem-products.json"), "[{\"code\":\"ECO\"}]");
            File.WriteAllText(
                Path.Combine(sandbox, "ecosystem", "ecosystem-recipes.json"), "[{\"code\":\"ECO-R\"}]");

            // 🔴 WS-E — the licence, written where LicenseStore would write it, so its survival is
            // measured on BYTES rather than on a directory entry an empty re-creation would satisfy.
            File.WriteAllText(
                Path.Combine(sandbox, "license", "license.json"), "{\"payload\":\"OPERATOR-LICENCE\"}");

            var script = Path.Combine(MachineSimulatorRoot(), "packaging", "remove-data.ps1");
            Assert.True(File.Exists(script), $"packaging/remove-data.ps1 not found at \"{script}\".");

            var psi = new ProcessStartInfo("powershell.exe")
            {
                RedirectStandardOutput = true,
                RedirectStandardError = true,
                UseShellExecute = false,
                WorkingDirectory = MachineSimulatorRoot(),
            };
            psi.ArgumentList.Add("-NoProfile");
            psi.ArgumentList.Add("-NonInteractive");
            psi.ArgumentList.Add("-ExecutionPolicy");
            psi.ArgumentList.Add("Bypass");
            psi.ArgumentList.Add("-Command");
            psi.ArgumentList.Add($"function Get-Service {{ return $null }}; & '{script.Replace("'", "''")}' -Force");

            foreach (var leaf in leaves)
            {
                psi.Environment[EnvVarFor(leaf)] = Path.Combine(sandbox, leaf);
            }

            using var process = Process.Start(psi)!;
            var stdout = process.StandardOutput.ReadToEnd();
            var stderr = process.StandardError.ReadToEnd();
            Assert.True(process.WaitForExit(120_000),
                "packaging/remove-data.ps1 did not finish within 120 s. It is almost certainly waiting on a " +
                "confirmation prompt that -Force and -NonInteractive failed to suppress — which means the " +
                "safety arrangement described in this class's remarks has a hole in it.");

            Assert.True(process.ExitCode == 0,
                $"packaging/remove-data.ps1 exited {process.ExitCode}.\nSTDOUT:\n{stdout}\nSTDERR:\n{stderr}");

            // 🔴 The redirect really took. Asserted BEFORE the deletion assertions, because if it did not
            // take then everything below is measuring an untouched sandbox while the script was deleting a
            // real machine's data, and every assertion would still pass.
            Assert.Contains(sandbox, stdout, StringComparison.OrdinalIgnoreCase);

            // ── The purge half ────────────────────────────────────────────────────────────────────────
            // Named controls first, in the words the ruling used: the historian, the credential store and
            // the audit-log database must be GONE.
            foreach (var purged in new[] { "historian", "creds", "security" })
            {
                Assert.False(Directory.Exists(Path.Combine(sandbox, purged)),
                    $"\"{purged}\" survived the decommissioning wipe. That is the outcome this script " +
                    "exists to prevent, and `creds` and `security` hold bearer credentials and the " +
                    $"hash-chained audit log respectively.\nSTDOUT:\n{stdout}");
            }

            // Then the derived remainder, so a leaf silently dropped from $subdirs cannot hide behind the
            // three controls above.
            var survivedButShouldNotHave = leaves
                .Where(leaf => !KeptLeaves.Contains(leaf, StringComparer.Ordinal))
                .Where(leaf => Directory.Exists(Path.Combine(sandbox, leaf)))
                .ToList();
            Assert.True(survivedButShouldNotHave.Count == 0,
                "These directories survived a wipe that is supposed to remove them: " +
                $"{string.Join(", ", survivedButShouldNotHave)}.\nSTDOUT:\n{stdout}");

            // ── The KEEP half — owner ruling 2026-08-23(b) ────────────────────────────────────────────
            // Measured on BYTES, not on the directory entry: a script that deleted the contents and left
            // the folder would satisfy Directory.Exists and would still have destroyed the ruling's
            // subject.
            var kept = new (string Leaf, string File, string Bytes)[]
            {
                ("products", "products.json", "[{\"code\":\"OPERATOR\"}]"),
                ("products", "recipes.json", "[{\"code\":\"OPERATOR-R\"}]"),
                ("ecosystem", "ecosystem-products.json", "[{\"code\":\"ECO\"}]"),
                ("ecosystem", "ecosystem-recipes.json", "[{\"code\":\"ECO-R\"}]"),
                // 🔴 WS-E, owner ruling 2026-09-06 — the licence survives, byte for byte. A wipe that
                // deleted this would force offline reactivation after a routine reinstall.
                ("license", "license.json", "{\"payload\":\"OPERATOR-LICENCE\"}"),
            };

            foreach (var (leaf, name, bytes) in kept)
            {
                var path = Path.Combine(sandbox, leaf, name);
                Assert.True(File.Exists(path),
                    $"\"{leaf}\\{name}\" was DELETED by packaging/remove-data.ps1. The owner ruled on " +
                    "2026-08-23(b) that the four operator-authored configuration files are exempt from " +
                    "this wipe — configuration an operator authored is not operational data. If that " +
                    "ruling has been reversed, the reversal belongs in docs/owner-decisions.md item 30 " +
                    $"with a date, not in a $subdirs entry.\nSTDOUT:\n{stdout}");
                Assert.Equal(bytes, File.ReadAllText(path));
            }

            // And the script must SAY so where an operator reads, rather than keeping them silently — a
            // survival nobody is told about is the mirror image of the deletion nobody asked for.
            Assert.Matches(new Regex(@"KEPT\s+BY\s+DESIGN", RegexOptions.IgnoreCase), stdout);
        }
        finally
        {
            try { Directory.Delete(sandbox, recursive: true); } catch { /* best-effort cleanup */ }
        }
    }
}
