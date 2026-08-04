namespace St4i.EdgeCore.Tests;

/// <summary>
/// The shared "what actually landed in a project's build output" probe, extracted in Task D-3 from
/// <see cref="MakaretuNotShippedTests"/> when <c>Drivers/Modbus/SerialDependencyScopingTests</c> needed the
/// identical walk for <c>System.IO.Ports.dll</c>.
///
/// <para><b>Why this exists as one helper rather than two copies.</b> Both callers ask the same question —
/// "did NuGet's project-reference-transitive-package-copy put a package's DLLs into a deployment that has no
/// business carrying them" — and the answer depends on a solution-root walk and a recursive
/// configuration-agnostic search that are easy to write two slightly different ways. Two copies drift, and the
/// drift here is silent in the worst direction: a search that quietly stops finding things reports a clean
/// deployment. Every consumer therefore shares one walk and one search, and every consumer carries its own
/// POSITIVE CONTROL asserting the search can still find a DLL that IS present.</para>
///
/// <para><b>This extraction is deliberately behaviour-preserving and adds no test</b> — the same posture D-2
/// took when it consolidated two conformance suites onto <c>Drivers/ClosedLoopbackPort</c>. A moved total in
/// <c>EXPECT_EDGECORE</c> attributable to <see cref="MakaretuNotShippedTests"/> would mean it was not.</para>
///
/// <para><b>Precondition — build the solution first.</b> Every method below fails LOUDLY with an explicit
/// "build first" message when a project has never been built, rather than reporting a false clean result.
/// Note also that an incremental build does not always prune orphaned output files, so a clean rebuild is
/// what actually proves an absence claim — which is what <c>scripts/verify-suites.sh</c> runs
/// (<c>dotnet build -t:Rebuild</c>).</para>
/// </summary>
internal static class BuildOutputProbe
{
    /// <summary>Walks up from the test assembly's own location to the directory holding
    /// <c>St4iMachineSimulator.sln</c>, so nothing here depends on the process working directory.</summary>
    public static string MachineSimulatorRoot()
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

    public static string BinDirFor(string projectRelativeDir) =>
        Path.Combine(MachineSimulatorRoot(), projectRelativeDir, "bin");

    /// <summary>Whether the project's own primary output exists at all — the guard that turns "never built"
    /// into a loud failure instead of a vacuously empty search result.</summary>
    public static bool PrimaryOutputExists(string projectRelativeDir, string primaryOutputFileName)
    {
        var binDir = BinDirFor(projectRelativeDir);
        return Directory.Exists(binDir) &&
               Directory.EnumerateFiles(binDir, primaryOutputFileName, SearchOption.AllDirectories).Any();
    }

    /// <summary>Every file anywhere under the given project's own <c>bin/</c> matching any of
    /// <paramref name="fileNamePatterns"/> — searched recursively
    /// (<see cref="SearchOption.AllDirectories"/>) so this does not care which configuration (Debug/Release),
    /// RID-specific subfolder (<c>win-x64</c>) or <c>runtimes/</c> sub-tree the file landed in. A package's
    /// assets routinely land in three places at once, and a search that only looked at the flat output
    /// directory would miss two of them.</summary>
    public static IReadOnlyList<string> FindInOutput(string projectRelativeDir, params string[] fileNamePatterns)
    {
        var binDir = BinDirFor(projectRelativeDir);
        if (!Directory.Exists(binDir))
        {
            throw new InvalidOperationException(
                $"{binDir} does not exist — build St4iMachineSimulator.sln at least once before running this test.");
        }

        return fileNamePatterns
            .SelectMany(pattern => Directory.EnumerateFiles(binDir, pattern, SearchOption.AllDirectories))
            .ToList();
    }
}
