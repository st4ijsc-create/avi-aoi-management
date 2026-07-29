using System.Reflection;
using System.Runtime.Versioning;
using Xunit;

namespace St4i.Connector.Abstractions.Tests;

/// <summary>
/// Task B-1 (.superpowers/sdd/2026-07-29-dotB-machine-control-blueprint/task-1-brief.md) — re-proves the
/// zero-dependency property GP-1's review first established for this assembly ("loaded the built DLL via
/// Assembly.LoadFile + GetReferencedAssemblies() -&gt; only System.Runtime + System.Collections, both BCL")
/// now that this task has added <see cref="IWritableDeviceDriver"/> and its request/result/enum types.
///
/// <para>Deliberately NOT a check against the already-loaded in-process assembly
/// (<c>typeof(IWritableDeviceDriver).Assembly</c>) — this loads the actual DLL FILE from disk fresh via
/// <see cref="Assembly.LoadFile(string)"/>, the same independent mechanism a reviewer with no test-runner
/// context would use, and inspects ITS manifest. That is the only way to prove nothing beyond the documented
/// BCL surface snuck in when the new types were added — asserting against a mock or a hand-written list
/// would prove nothing about the actual build output.</para>
///
/// <para>Precondition — same as <c>MakaretuNotShippedTests</c>: requires
/// <c>dotnet build St4iMachineSimulator.sln</c> (or at least the Abstractions project) to have run at least
/// once; the newest matching DLL under this project's own <c>bin/</c> is used, so a stale artifact from an
/// older configuration doesn't shadow a fresh one.</para>
/// </summary>
public class ZeroDependencyTests
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

    private static string AbstractionsDllPath()
    {
        var root = MachineSimulatorRoot();
        var binDir = Path.Combine(root, "src", "St4i.Connector.Abstractions", "bin");
        if (!Directory.Exists(binDir))
        {
            throw new InvalidOperationException(
                $"{binDir} does not exist — build St4iMachineSimulator.sln at least once before running this test.");
        }

        var newest = Directory.EnumerateFiles(binDir, "St4i.Connector.Abstractions.dll", SearchOption.AllDirectories)
            .OrderByDescending(File.GetLastWriteTimeUtc)
            .FirstOrDefault();

        if (newest is null)
        {
            throw new InvalidOperationException(
                $"No St4i.Connector.Abstractions.dll found under {binDir} — build the project first.");
        }

        return newest;
    }

    [Fact]
    public void BuiltDll_ReferencesOnlyBcl_NoNewDependencyIntroduced()
    {
        var assembly = Assembly.LoadFile(AbstractionsDllPath());

        var referenced = assembly.GetReferencedAssemblies()
            .Select(a => a.Name)
            .OrderBy(n => n, StringComparer.Ordinal)
            .ToArray();

        // The exact set GP-1/GP-2 pinned (System.Runtime + System.Collections from GP-1, System.Text.Json
        // added by GP-2's ConnectorJson). This task adds Task<T>-returning methods, IReadOnlyList<string>
        // properties, and Dictionary<string, object> arguments — all of which already resolve inside
        // System.Runtime/System.Collections, with NO new entry. If a future change to this assembly ever
        // pulls in a package or project reference, this assertion is what goes red.
        Assert.Equal(new[] { "System.Collections", "System.Runtime", "System.Text.Json" }, referenced);
    }

    [Fact]
    public void BuiltDll_TargetsPlainNet10_NotWindows()
    {
        var assembly = Assembly.LoadFile(AbstractionsDllPath());

        var attribute = assembly.GetCustomAttribute<TargetFrameworkAttribute>();

        Assert.NotNull(attribute);
        Assert.Equal(".NETCoreApp,Version=v10.0", attribute!.FrameworkName);
        Assert.DoesNotContain("windows", attribute.FrameworkName, StringComparison.OrdinalIgnoreCase);
    }

    [Fact]
    public void Csproj_StillDeclaresZeroPackageAndProjectReferences()
    {
        var root = MachineSimulatorRoot();
        var csprojPath = Path.Combine(root, "src", "St4i.Connector.Abstractions", "St4i.Connector.Abstractions.csproj");
        var text = File.ReadAllText(csprojPath);

        Assert.DoesNotContain("PackageReference", text, StringComparison.Ordinal);
        Assert.DoesNotContain("ProjectReference", text, StringComparison.Ordinal);
        Assert.Contains("<TargetFramework>net10.0</TargetFramework>", text, StringComparison.Ordinal);
    }
}
