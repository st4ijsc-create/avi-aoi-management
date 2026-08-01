using Xunit;

namespace St4i.EdgeCore.Tests;

/// <summary>
/// GĐ3 closeout WI-1 Part A (<c>.superpowers/sdd/2026-07-28-giaidoan3-ws-i-closeout-blueprint/task-1-brief.md</c>)
/// — the actual proof that moving <c>SiteDiscovery</c>'s <c>Makaretu.Dns.Multicast.New</c>
/// <c>PackageReference</c> out of <c>St4i.EdgeCore.csproj</c> and into <c>St4i.EngineApi.csproj</c> stopped
/// the package's DLLs from leaking into the two build outputs that only ever <c>ProjectReference</c>
/// EdgeCore (never EngineApi): <c>St4i.EdgeService</c> (the Windows Service host) and
/// <c>St4iMachineSimulator</c> (the WPF exhibition app). Confirmed via this exact reflex before the fix:
/// both projects' <c>bin/</c> output physically contained <c>Makaretu.Dns.dll</c>,
/// <c>Makaretu.Dns.Multicast.New.dll</c>, and the transitive <c>Common.Logging.dll</c> — despite neither
/// project's own code ever touching mDNS.
///
/// <para><b>Why the build-OUTPUT-directory check, not <c>Assembly.GetReferencedAssemblies()</c>:</b>
/// neither <c>St4i.EdgeService</c>'s nor <c>St4iMachineSimulator</c>'s own compiled code has EVER called
/// into a Makaretu type directly (only <c>SiteDiscovery</c>/<c>SiteEndpoints</c> in EngineApi do) — so
/// asserting <c>typeof(SomeEdgeServiceType).Assembly.GetReferencedAssemblies()</c> contains no Makaretu*
/// would report a clean result BOTH before and after this task's fix, because the C# compiler only emits
/// an <c>AssemblyRef</c> for a referenced assembly whose types a project's OWN code actually uses, never
/// for the full transitive NuGet restore graph. That assertion would pass vacuously and prove nothing.
/// What NuGet's project-reference-transitive-package-copy actually does — and what this task's fix stops —
/// is copy EVERY restored package's runtime assets into the output directory of every project that
/// (transitively, via <c>ProjectReference</c>) restores it, regardless of whether that project's own IL
/// ever references a single type from it. THAT's the actual "Makaretu leaks into EdgeService/WPF outputs"
/// problem the task brief calls out, so the only deterministic proof is inspecting those two projects' own
/// build output folders for the absence of <c>Makaretu*.dll</c>/<c>Common.Logging.dll</c> — which is what
/// this class does.</para>
///
/// <para><b>Positive control:</b> <see cref="EngineApi_OwnBuildOutput_DoesContainMakaretu"/> asserts the
/// OPPOSITE for <c>St4i.EngineApi</c>'s own output (which DOES now carry the <c>PackageReference</c>) —
/// proving this class' file-search logic can actually detect the DLL when it is genuinely present, so the
/// two "must NOT contain" assertions below aren't silently vacuous just because nobody built anything.</para>
///
/// <para><b>Precondition — build the solution first:</b> requires <c>dotnet build St4iMachineSimulator.sln</c>
/// (any configuration; searched recursively under each project's own <c>bin/</c>) to have already run at
/// least once — the same precondition the task brief's own global constraints already impose on this whole
/// task. If a project has never been built at all, the relevant test fails LOUDLY with an explicit
/// "build first" message rather than silently reporting a false pass. Conversely, an INCREMENTAL build
/// that never ran `dotnet clean` after this fix could still show a stale Makaretu*.dll left over from
/// before the fix (NuGet/MSBuild do not always prune orphaned output files on an incremental build) — a
/// clean rebuild is what actually proves the fix, not just re-running this test.</para>
/// </summary>
public sealed class MakaretuNotShippedTests
{
    private static string MachineSimulatorRoot()
    {
        var dir = new DirectoryInfo(AppContext.BaseDirectory);
        while (dir is not null)
        {
            if (File.Exists(Path.Combine(dir.FullName, "St4iMachineSimulator.sln")))
            {
                return dir.FullName;
            }

            dir = dir.Parent;
        }

        throw new InvalidOperationException(
            $"Could not locate St4iMachineSimulator.sln by walking up from \"{AppContext.BaseDirectory}\"");
    }

    private static string BinDirFor(string projectRelativeDir) =>
        Path.Combine(MachineSimulatorRoot(), projectRelativeDir, "bin");

    /// <summary>Every file anywhere under the given project's own <c>bin/</c> directory whose name matches
    /// <c>Makaretu*.dll</c> or <c>Common.Logging.dll</c> — searched recursively (<see
    /// cref="SearchOption.AllDirectories"/>) so this doesn't care which configuration (Debug/Release) or
    /// RID-specific subfolder (e.g. <c>win-x64</c> for the WPF app) actually got built.</summary>
    private static IReadOnlyList<string> FindLeakedDlls(string projectRelativeDir)
    {
        var binDir = BinDirFor(projectRelativeDir);
        if (!Directory.Exists(binDir))
        {
            throw new InvalidOperationException(
                $"{binDir} does not exist — build St4iMachineSimulator.sln at least once before running this test.");
        }

        return Directory.EnumerateFiles(binDir, "Makaretu*.dll", SearchOption.AllDirectories)
            .Concat(Directory.EnumerateFiles(binDir, "Common.Logging.dll", SearchOption.AllDirectories))
            .ToList();
    }

    private static bool PrimaryOutputExists(string projectRelativeDir, string primaryOutputFileName)
    {
        var binDir = BinDirFor(projectRelativeDir);
        return Directory.Exists(binDir) &&
               Directory.EnumerateFiles(binDir, primaryOutputFileName, SearchOption.AllDirectories).Any();
    }

    [Fact]
    public void EdgeService_BuildOutput_NeverContainsMakaretuOrCommonLogging()
    {
        var projectDir = Path.Combine("src", "St4i.EdgeService");
        Assert.True(
            PrimaryOutputExists(projectDir, "St4i.EdgeService.dll"),
            "St4i.EdgeService has never been built — run `dotnet build St4iMachineSimulator.sln` first.");

        var leaked = FindLeakedDlls(projectDir);
        Assert.True(leaked.Count == 0,
            "St4i.EdgeService build output leaked Makaretu/Common.Logging: " + string.Join(", ", leaked));
    }

    [Fact]
    public void St4iMachineSimulatorWpf_BuildOutput_NeverContainsMakaretuOrCommonLogging()
    {
        var projectDir = Path.Combine("src", "St4iMachineSimulator");
        Assert.True(
            PrimaryOutputExists(projectDir, "St4iMachineSimulator.exe"),
            "St4iMachineSimulator (WPF) has never been built — run `dotnet build St4iMachineSimulator.sln` first.");

        var leaked = FindLeakedDlls(projectDir);
        Assert.True(leaked.Count == 0,
            "St4iMachineSimulator build output leaked Makaretu/Common.Logging: " + string.Join(", ", leaked));
    }

    [Fact]
    public void EngineApi_OwnBuildOutput_DoesContainMakaretu()
    {
        var projectDir = Path.Combine("src", "St4i.EngineApi");
        Assert.True(
            PrimaryOutputExists(projectDir, "St4i.EngineApi.dll"),
            "St4i.EngineApi has never been built — run `dotnet build St4iMachineSimulator.sln` first.");

        var found = FindLeakedDlls(projectDir)
            .Where(p => Path.GetFileName(p).StartsWith("Makaretu", StringComparison.OrdinalIgnoreCase))
            .ToList();
        Assert.True(found.Count > 0,
            "Sanity/positive-control failed: St4i.EngineApi's own build output should contain " +
            "Makaretu*.dll (it now owns the PackageReference) — if this fails, the file-search logic " +
            "itself is broken, which would make the two 'must not leak' tests above meaningless.");
    }
}
