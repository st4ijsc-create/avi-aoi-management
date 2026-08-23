using St4i.EdgeCore.Config;
using Xunit;

namespace St4i.EdgeCore.Tests;

/// <summary>
/// 🔴 <b>Task BF-1 — the two witnesses for the owner's ruling of 2026-08-23(a): the new default root is what
/// an un-overridden process resolves, and the one-time carry-over is a COPY that runs once and deletes
/// nothing.</b>
///
/// <para><b>Why the root half is a RESOLUTION test and never a construction test, said before anybody reads
/// it as timidity.</b> Constructing any of the three stores with no override would create and write
/// <c>%ProgramData%\ST4I\sim\&lt;leaf&gt;</c> on the machine running the suite — the real one. That is
/// exactly the leak the redirects in <c>tests/Shared/TestRunTempRoot.cs</c> exist to prevent, and a witness
/// that has to commit it in order to observe it is not a witness, it is the defect wearing a badge.
/// <c>ResolveRoot</c> is documented as pure path arithmetic that creates nothing, so the property can be
/// measured without touching a disk that does not belong to this run.</para>
///
/// <para>🔴 <b>What that costs, in the honest direction.</b> These facts prove the ARITHMETIC lands on
/// <c>%ProgramData%</c>; they do not prove the resolved value is honoured all the way to a file for the two
/// stores that gained a seam today. That last step IS measured, on the explicit-path arm, by every existing
/// store test that hands in a temp directory, and on the env-var arm by
/// <c>MachineConfigStoreRootResolutionTests.TheEnvVar_IsHonouredAllTheWayToTheFile_NotJustAtResolution</c>
/// for the third. The residual is that no fact anywhere executes a store over its DEFAULT root, and none
/// can without writing to a real install.</para>
///
/// <para>These mutate process-wide <c>ST4I_*_DIR</c> variables, so they join the collection that serialises
/// every class which does.</para>
/// </summary>
[Collection("St4i.EdgeCore.Tests.MachineWideStoreEnv")]
public sealed class LegacyRootMigrationTests : IDisposable
{
    private readonly List<string> _tempDirs = new();

    public void Dispose()
    {
        foreach (var dir in _tempDirs)
        {
            try { Directory.Delete(dir, recursive: true); } catch { /* best-effort cleanup */ }
        }
    }

    private string NewTempDir()
    {
        var dir = Directory.CreateTempSubdirectory("st4i-legacy-migration-").FullName;
        _tempDirs.Add(dir);
        return dir;
    }

    private static void WithoutAnyRootOverride(Action body)
    {
        string[] names = ["ST4I_PRODUCTS_DIR", "ST4I_ECOSYSTEM_DIR", "ST4I_MACHINE_CONFIG_DIR"];
        var previous = names.Select(Environment.GetEnvironmentVariable).ToArray();
        try
        {
            foreach (var name in names) Environment.SetEnvironmentVariable(name, null);
            body();
        }
        finally
        {
            for (var i = 0; i < names.Length; i++)
            {
                Environment.SetEnvironmentVariable(names[i], previous[i]);
            }
        }
    }

    /// <summary>🔴 <b>WITNESS (i) — with no <c>ST4I_*_DIR</c> set at all, every one of the three stores
    /// resolves under <c>%ProgramData%\ST4I\sim</c>, at the leaf its own variable name is derived from.</b>
    ///
    /// <para>Both halves are asserted, because either alone is satisfiable by the wrong thing: the leaf must
    /// be right (a store landing on a sibling's directory would share files with it), and the root must not
    /// be the pre-BF-1 one (which is the whole subject of the ruling).</para></summary>
    [Fact]
    public void WithNoEnvironmentOverride_AllThreeStoresResolveUnderProgramData_AtTheirDerivedLeaf()
    {
        var sim = Path.Combine(
            Environment.GetFolderPath(Environment.SpecialFolder.CommonApplicationData), "ST4I", "sim");

        WithoutAnyRootOverride(() =>
        {
            Assert.Equal(Path.Combine(sim, "products"), ProductConfigStore.ResolveRoot());
            Assert.Equal(Path.Combine(sim, "machine-config"), MachineConfigStore.ResolveRoot());

            // The three defaults and the three resolutions must agree, or `explicit > env > default` has a
            // fourth arm nobody wrote down.
            Assert.Equal(ProductConfigStore.DefaultRoot(), ProductConfigStore.ResolveRoot());
            Assert.Equal(MachineConfigStore.DefaultRoot(), MachineConfigStore.ResolveRoot());

            // And NOT the pre-BF-1 root. Asserted in this direction too because "starts with %ProgramData%"
            // would still hold for a machine whose base directory happened to sit there.
            var besideBinary = Path.TrimEndingDirectorySeparator(Path.GetFullPath(AppContext.BaseDirectory));
            Assert.NotEqual(besideBinary,
                Path.TrimEndingDirectorySeparator(Path.GetFullPath(ProductConfigStore.ResolveRoot())));
            Assert.NotEqual(besideBinary,
                Path.TrimEndingDirectorySeparator(Path.GetFullPath(MachineConfigStore.ResolveRoot())));
        });

        // 🔴 The env var still WINS when it is set — the arm TestRunTempRoot depends on for all five
        // suites. Without this, a "default root" fact would pass just as well over a store that had
        // stopped reading its variable at all, and every suite would be writing into a real install.
        var redirect = NewTempDir();
        var previous = Environment.GetEnvironmentVariable(ProductConfigStore.EnvVarDir);
        try
        {
            Environment.SetEnvironmentVariable(ProductConfigStore.EnvVarDir, redirect);
            Assert.Equal(redirect, ProductConfigStore.ResolveRoot());
            Assert.NotEqual(ProductConfigStore.DefaultRoot(), ProductConfigStore.ResolveRoot());
        }
        finally
        {
            Environment.SetEnvironmentVariable(ProductConfigStore.EnvVarDir, previous);
        }
    }

    /// <summary>🔴 <b>WITNESS (ii) — the carry-over runs ONCE, carries the operator's bytes, and NEVER
    /// deletes the original.</b>
    ///
    /// <para>The "never deletes" half is the one the owner's ruling turns on, so it is asserted on BYTES and
    /// not on existence: a move re-implemented as copy-then-delete, or a copy that truncated the source,
    /// both fail here. The "once" half is asserted by mutating the destination and re-running: a second
    /// pass that re-copied would overwrite the mutation, which is precisely how a migration turns into a
    /// recurring overwrite of an operator's edits — the shape items 1/5/11/13 are all about.</para></summary>
    [Fact]
    public void CopyOnce_CarriesTheLegacyBytes_LeavesTheOriginalIntact_AndDoesNotRunASecondTime()
    {
        var legacy = NewTempDir();
        var fresh = NewTempDir();
        const string operatorBytes = "[{\"code\":\"OPERATOR-TYPED\"}]";

        File.WriteAllText(Path.Combine(legacy, "products.json"), operatorBytes);
        // recipes.json deliberately absent: a store whose legacy root holds ONE of its two files must carry
        // that one and not invent the other.
        var before = File.GetLastWriteTimeUtc(Path.Combine(legacy, "products.json"));

        var firstPass = LegacyRootMigration.CopyOnce(
            legacy, fresh, ["products.json", "recipes.json"], "witness");

        Assert.Equal(new[] { "products.json" }, firstPass.ToArray());
        Assert.Equal(operatorBytes, File.ReadAllText(Path.Combine(fresh, "products.json")));
        Assert.False(File.Exists(Path.Combine(fresh, "recipes.json")));

        // 🔴 THE ORIGINAL SURVIVES, BYTE FOR BYTE. This is the assertion that separates the owner's chosen
        // direction (a) — copy — from the direction item 10's exemption would have allowed, and item 10's
        // exemption applies to item 10 only.
        Assert.True(File.Exists(Path.Combine(legacy, "products.json")));
        Assert.Equal(operatorBytes, File.ReadAllText(Path.Combine(legacy, "products.json")));
        Assert.Equal(before, File.GetLastWriteTimeUtc(Path.Combine(legacy, "products.json")));

        // 🔴 ONCE. The destination is edited the way an operator would edit it, and the second pass must
        // leave that edit alone and report that it carried nothing.
        const string edited = "[{\"code\":\"EDITED-AFTER-MIGRATION\"}]";
        File.WriteAllText(Path.Combine(fresh, "products.json"), edited);

        var secondPass = LegacyRootMigration.CopyOnce(
            legacy, fresh, ["products.json", "recipes.json"], "witness");

        Assert.Empty(secondPass);
        Assert.Equal(edited, File.ReadAllText(Path.Combine(fresh, "products.json")));

        // A legacy root that IS the new root is a no-op rather than a self-copy, and a legacy root that
        // does not exist is silence rather than a failure. Both are reachable on a real machine.
        Assert.Empty(LegacyRootMigration.CopyOnce(fresh, fresh, ["products.json"], "witness"));
        Assert.Empty(LegacyRootMigration.CopyOnce(
            Path.Combine(legacy, "no-such-root"), fresh, ["products.json"], "witness"));
    }
}
