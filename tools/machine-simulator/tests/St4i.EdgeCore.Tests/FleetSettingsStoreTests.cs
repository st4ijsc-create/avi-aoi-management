using St4i.EdgeCore.Config;
using Xunit;

namespace St4i.EdgeCore.Tests;

/// <summary>
/// FF-1 (docs/plans/2026-07-27-ws-ff-fast-follows.md) — <see cref="FleetSettingsStore"/>: no-file-yet
/// resolves to null (never throws), Save-then-Load round-trips, restart-survival (a fresh store instance
/// pointed at the same directory sees a previous instance's write — same technique
/// <c>MachineConfigStoreTests</c>/<c>OeeSettingsStoreTests</c> already use for their own restart-survival
/// tests), a corrupt file is tolerated (returns null, doesn't throw), and directory resolution
/// (<see cref="FleetSettingsStore.EnvVarDir"/> override, explicit-directory-wins-over-env-var, and the
/// default root being a SIBLING of the historian/WAL/security/creds roots — same "own leaf directory
/// per concern" convention <c>WalOptionsTests.DefaultRoot_IsSiblingOfHistorianDefaultDir_NotTheSameDirectory</c>
/// already covers for <c>WalOptions</c>).
/// </summary>
public sealed class FleetSettingsStoreTests : IDisposable
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
        var dir = Directory.CreateTempSubdirectory("st4i-fleet-settings-tests-").FullName;
        _tempDirs.Add(dir);
        return dir;
    }

    [Fact]
    public void Load_NoFileYet_ReturnsNull()
    {
        var store = new FleetSettingsStore(NewTempDir());

        Assert.Null(store.Load());
    }

    [Fact]
    public void Save_ThenLoad_RoundTrips()
    {
        var store = new FleetSettingsStore(NewTempDir());
        var settings = new PersistedFleetSettings
        {
            ServerUrl = "https://central.example.test:8443",
            MachineCode = "AOI-CENTRAL-01",
            VerifyTls = false,
        };

        store.Save(settings);
        var loaded = store.Load();

        Assert.NotNull(loaded);
        Assert.Equal("https://central.example.test:8443", loaded!.ServerUrl);
        Assert.Equal("AOI-CENTRAL-01", loaded.MachineCode);
        Assert.False(loaded.VerifyTls);
    }

    [Fact]
    public void Save_ThenSecondSave_OverwritesTheFirst()
    {
        var store = new FleetSettingsStore(NewTempDir());
        store.Save(new PersistedFleetSettings { ServerUrl = "https://first.example.test", MachineCode = "M1", VerifyTls = true });
        store.Save(new PersistedFleetSettings { ServerUrl = "https://second.example.test", MachineCode = "M2", VerifyTls = false });

        var loaded = store.Load();

        Assert.NotNull(loaded);
        Assert.Equal("https://second.example.test", loaded!.ServerUrl);
        Assert.Equal("M2", loaded.MachineCode);
        Assert.False(loaded.VerifyTls);
    }

    [Fact]
    public void Save_SurvivesRestart_ANewStoreInstancePointedAtSameDirectorySeesIt()
    {
        var dir = NewTempDir();
        var store = new FleetSettingsStore(dir);
        store.Save(new PersistedFleetSettings { ServerUrl = "https://restart.example.test", MachineCode = "RESTART-01", VerifyTls = false });

        var reopened = new FleetSettingsStore(dir); // simulates a process restart
        var loaded = reopened.Load();

        Assert.NotNull(loaded);
        Assert.Equal("https://restart.example.test", loaded!.ServerUrl);
        Assert.Equal("RESTART-01", loaded.MachineCode);
        Assert.False(loaded.VerifyTls);
    }

    [Fact]
    public void Load_CorruptFile_ReturnsNullRatherThanThrowing()
    {
        var dir = NewTempDir();
        File.WriteAllText(Path.Combine(dir, "fleet-settings.json"), "{ not valid json ]");
        var store = new FleetSettingsStore(dir);

        Assert.Null(store.Load());
    }

    [Fact]
    public void ResolveRoot_EnvOverride_ReturnsConfiguredDirectory()
    {
        var previous = Environment.GetEnvironmentVariable(FleetSettingsStore.EnvVarDir);
        try
        {
            var tempDir = Path.Combine(Path.GetTempPath(), "st4i-fleet-settings-env-" + Guid.NewGuid().ToString("N"));
            Environment.SetEnvironmentVariable(FleetSettingsStore.EnvVarDir, tempDir);

            Assert.Equal(tempDir, FleetSettingsStore.ResolveRoot());
        }
        finally
        {
            Environment.SetEnvironmentVariable(FleetSettingsStore.EnvVarDir, previous);
        }
    }

    [Fact]
    public void ResolveRoot_ExplicitDirectory_TakesPriorityOverEnvVar()
    {
        var previous = Environment.GetEnvironmentVariable(FleetSettingsStore.EnvVarDir);
        try
        {
            Environment.SetEnvironmentVariable(FleetSettingsStore.EnvVarDir, Path.Combine(Path.GetTempPath(), "st4i-fleet-settings-env-should-not-win"));
            var explicitDir = Path.Combine(Path.GetTempPath(), "st4i-fleet-settings-explicit-" + Guid.NewGuid().ToString("N"));

            Assert.Equal(explicitDir, FleetSettingsStore.ResolveRoot(explicitDir));
        }
        finally
        {
            Environment.SetEnvironmentVariable(FleetSettingsStore.EnvVarDir, previous);
        }
    }

    [Fact]
    public void ResolveRoot_NoOverrideAtAll_ReturnsDefaultRoot()
    {
        var previous = Environment.GetEnvironmentVariable(FleetSettingsStore.EnvVarDir);
        try
        {
            Environment.SetEnvironmentVariable(FleetSettingsStore.EnvVarDir, null);

            Assert.Equal(FleetSettingsStore.DefaultRoot(), FleetSettingsStore.ResolveRoot());
        }
        finally
        {
            Environment.SetEnvironmentVariable(FleetSettingsStore.EnvVarDir, previous);
        }
    }

    [Fact]
    public void DefaultRoot_IsSiblingOfHistorianDefaultDir_NotTheSameDirectory()
    {
        var historianDefaultRoot = Path.Combine(
            Environment.GetFolderPath(Environment.SpecialFolder.CommonApplicationData), "ST4I", "sim", "historian");

        var settingsDefaultRoot = FleetSettingsStore.DefaultRoot();

        Assert.NotEqual(historianDefaultRoot, settingsDefaultRoot);
        // Sibling: same parent ("ST4I\sim"), different leaf directory.
        Assert.Equal(Path.GetDirectoryName(historianDefaultRoot), Path.GetDirectoryName(settingsDefaultRoot));
    }

    [Fact]
    public void DefaultRoot_IsNeverTheCredsDirectory()
    {
        // FF-1's whole "never persist secrets" guarantee would be undermined on disk (even though the
        // code never writes an mk_ here) if this store's default root ever collided with CredentialStore's
        // own — keeping them physically separate makes the invariant obvious without reading any code.
        var credsDefaultRoot = Path.Combine(
            Environment.GetFolderPath(Environment.SpecialFolder.CommonApplicationData), "ST4I", "sim", "creds");

        Assert.NotEqual(credsDefaultRoot, FleetSettingsStore.DefaultRoot());
    }

    [Fact]
    public void Ctor_CreatesTheDirectoryIfItDoesNotExistYet()
    {
        var root = Directory.CreateTempSubdirectory("st4i-fleet-settings-ctor-tests-").FullName;
        _tempDirs.Add(root);
        var freshDir = Path.Combine(root, "not-created-yet");
        Assert.False(Directory.Exists(freshDir));

        _ = new FleetSettingsStore(freshDir);

        Assert.True(Directory.Exists(freshDir));
    }
}
