using St4i.EdgeCore.Config;
using Xunit;

namespace St4i.EdgeCore.Tests;

/// <summary>
/// 🔴 <b>Task H-1c — <see cref="MachineConfigStore"/>'s new relocation seam, and the property that makes
/// it a member of the SECOND population rather than a fourteenth member of the first.</b>
///
/// <para><b>Its own class rather than three more methods on <c>MachineConfigStoreTests</c>.</b> These
/// tests mutate <c>ST4I_MACHINE_CONFIG_DIR</c>, which is PROCESS-WIDE, so they have to join
/// <c>MachineWideStoreEnvCollection</c> — the collection that serialises every class touching an
/// <c>ST4I_*_DIR</c> variable. Folding them into the existing store test class would drag that whole class
/// into the same serialised collection for no benefit.
/// <b>The collection's NAME says "MachineWide" and this store is not machine-wide</b> — that is the
/// naming, not a claim: what the collection actually owns is stated in its own doc comment as "the
/// process-wide <c>ST4I_*_DIR</c> environment variables", which is exactly the hazard here. Renaming it
/// would touch three unrelated classes to no measured end; the mismatch is recorded instead.</para>
///
/// <para><b>What this reaches that <c>PerHostDataRootsTests</c> cannot.</b> That file proves a variable is
/// DECLARED and READ at a resolution site, and says in as many words that it never executes a store, so it
/// cannot prove the resolved value is HONOURED all the way to a file. The last test below does exactly
/// that, on the env-var arm — the arm its own remarks record as the thinnest across the whole variable
/// population.</para>
/// </summary>
[Collection("St4i.EdgeCore.Tests.MachineWideStoreEnv")]
public sealed class MachineConfigStoreRootResolutionTests : IDisposable
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
        var dir = Directory.CreateTempSubdirectory("st4i-machine-config-root-").FullName;
        _tempDirs.Add(dir);
        return dir;
    }

    /// <summary>Runs <paramref name="body"/> with <c>ST4I_MACHINE_CONFIG_DIR</c> set to
    /// <paramref name="value"/> and restores whatever was there before, on every path.</summary>
    private static void WithEnvVar(string? value, Action body)
    {
        var previous = Environment.GetEnvironmentVariable(MachineConfigStore.EnvVarDir);
        try
        {
            Environment.SetEnvironmentVariable(MachineConfigStore.EnvVarDir, value);
            body();
        }
        finally
        {
            Environment.SetEnvironmentVariable(MachineConfigStore.EnvVarDir, previous);
        }
    }

    [Fact]
    public void ResolveRoot_NoOverrideAtAll_ReturnsDefaultRoot() =>
        WithEnvVar(null, () => Assert.Equal(MachineConfigStore.DefaultRoot(), MachineConfigStore.ResolveRoot()));

    [Fact]
    public void ResolveRoot_EnvOverride_ReturnsConfiguredDirectory()
    {
        var dir = NewTempDir();
        WithEnvVar(dir, () => Assert.Equal(dir, MachineConfigStore.ResolveRoot()));
    }

    [Fact]
    public void ResolveRoot_ExplicitDirectory_TakesPriorityOverEnvVar()
    {
        var explicitDir = NewTempDir();
        WithEnvVar(
            Path.Combine(Path.GetTempPath(), "st4i-machine-config-env-should-not-win"),
            () => Assert.Equal(explicitDir, MachineConfigStore.ResolveRoot(explicitDir)));
    }

    /// <summary>🔴 <b>The population marker, and the assertion that fires if someone "tidies" this default
    /// into line with the other thirteen.</b> H-1c added a seam and deliberately did NOT move the default:
    /// moving it would relocate live customer data on the next start, which is a deployment decision. This
    /// asserts the property that makes the store a second-population member — its default is beside the
    /// running binary and is NOT under <c>%ProgramData%</c> — rather than the literal path, so a legitimate
    /// change of base directory does not make it red for the wrong reason.</summary>
    [Fact]
    public void DefaultRoot_IsBesideTheBinary_AndIsNotUnderProgramData()
    {
        Assert.Equal(AppContext.BaseDirectory, MachineConfigStore.DefaultRoot());

        var programData = Environment.GetFolderPath(Environment.SpecialFolder.CommonApplicationData);
        Assert.False(
            MachineConfigStore.DefaultRoot().StartsWith(
                Path.Combine(programData, "ST4I"), StringComparison.OrdinalIgnoreCase),
            "MachineConfigStore's default root moved under %ProgramData%\\ST4I. That is a DEPLOYMENT " +
            "change, not a seam: every existing install keeps its machine-operating-config.json beside " +
            "the binary and nothing migrates it, so the next start silently reads an empty store. If it " +
            "is genuinely wanted, it needs its own %ProgramData%\\ST4I\\sim\\<name> directory constant, a " +
            "derivable variable name, a row in README §15.9's table, a -XxxDir parameter in " +
            "packaging/remove-data.ps1 and the count in every artefact that spells it — i.e. it joins the " +
            "FIRST population, and every guard in PerHostDataRootsTests then applies to it.");
    }

    /// <summary>🔴 The end-to-end arm: the resolved value is HONOURED all the way to a file. Constructs the
    /// store with NO explicit directory — the production call shape (<c>Program.cs</c> registers it as a
    /// bare singleton) — under a set <c>ST4I_MACHINE_CONFIG_DIR</c>, writes through a real
    /// <see cref="MachineConfigStore.Ensure"/>, and reads the file back off disk. A seam that resolves
    /// correctly and then writes somewhere else is the failure mode a resolution-only test cannot see.</summary>
    [Fact]
    public void TheEnvVar_IsHonouredAllTheWayToTheFile_NotJustAtResolution()
    {
        var dir = NewTempDir();
        WithEnvVar(dir, () =>
        {
            var store = new MachineConfigStore();
            Assert.Equal(dir, store.RootDirectory);

            store.Ensure("H1C-ENVVAR-01", MachineParameterSchema.ScrewProgram);

            var written = Path.Combine(dir, "machine-operating-config.json");
            Assert.True(File.Exists(written),
                $"MachineConfigStore resolved its root to \"{dir}\" and then wrote nothing there. " +
                $"Files present: {string.Join(", ", Directory.GetFiles(dir).Select(Path.GetFileName))}");
            Assert.Contains("H1C-ENVVAR-01", File.ReadAllText(written), StringComparison.Ordinal);

            // And a fresh instance pointed at the same directory sees it — the "process restarted" shape
            // this store's own restart-survival test already uses.
            Assert.NotNull(new MachineConfigStore(dir).GetConfig("H1C-ENVVAR-01"));
        });
    }
}
