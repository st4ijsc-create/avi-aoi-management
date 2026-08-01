using St4i.EdgeCore.Site;
using Xunit;

namespace St4i.EdgeCore.Tests.Site;

/// <summary>
/// GĐ3 EC-2 — <see cref="SiteLinkStore"/>: no-file-yet resolves to null (never throws), Save-then-Load
/// round-trips, restart-survival (a fresh store instance pointed at the same directory sees a previous
/// instance's write), a corrupt file is tolerated (returns null, doesn't throw), atomic overwrite (a
/// second Save fully replaces the first, never a merge/partial write), and directory resolution (env
/// override, explicit-directory-wins-over-env, default root is a sibling leaf under
/// <c>%ProgramData%\ST4I\sim</c>) — the exact same test shape <c>FleetSettingsStoreTests</c> already
/// proves out for its own store, since <see cref="SiteLinkStore"/> is a deliberate copy of that idiom.
/// </summary>
[Collection("St4i.EdgeCore.Tests.Site")]
public sealed class SiteLinkStoreTests : IDisposable
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
        var dir = Directory.CreateTempSubdirectory("st4i-sitelink-tests-").FullName;
        _tempDirs.Add(dir);
        return dir;
    }

    [Fact]
    public void Load_NoFileYet_ReturnsNull()
    {
        var store = new SiteLinkStore(NewTempDir());

        Assert.Null(store.Load());
    }

    [Fact]
    public void Save_ThenLoad_RoundTrips()
    {
        var store = new SiteLinkStore(NewTempDir());
        var link = new PersistedSiteLink
        {
            Enabled = true,
            Host = "site.example.test",
            Port = 8883,
            SiteTrustPem = "-----BEGIN CERTIFICATE-----\nFAKE\n-----END CERTIFICATE-----",
        };

        store.Save(link);
        var loaded = store.Load();

        Assert.NotNull(loaded);
        Assert.True(loaded!.Enabled);
        Assert.Equal("site.example.test", loaded.Host);
        Assert.Equal(8883, loaded.Port);
        Assert.Equal(link.SiteTrustPem, loaded.SiteTrustPem);
    }

    [Fact]
    public void Save_ThenSecondSave_OverwritesTheFirst_AtomicNotMerged()
    {
        var store = new SiteLinkStore(NewTempDir());
        store.Save(new PersistedSiteLink { Enabled = true, Host = "first.example.test", Port = 1111, SiteTrustPem = "PEM-1" });
        store.Save(new PersistedSiteLink { Enabled = false, Host = "second.example.test", Port = 2222, SiteTrustPem = "PEM-2" });

        var loaded = store.Load();

        Assert.NotNull(loaded);
        Assert.False(loaded!.Enabled);
        Assert.Equal("second.example.test", loaded.Host);
        Assert.Equal(2222, loaded.Port);
        Assert.Equal("PEM-2", loaded.SiteTrustPem);
    }

    [Fact]
    public void Save_SurvivesRestart_ANewStoreInstancePointedAtSameDirectorySeesIt()
    {
        var dir = NewTempDir();
        var store = new SiteLinkStore(dir);
        store.Save(new PersistedSiteLink { Enabled = true, Host = "restart.example.test", Port = 8883, SiteTrustPem = "PEM" });

        var reopened = new SiteLinkStore(dir); // simulates a process restart
        var loaded = reopened.Load();

        Assert.NotNull(loaded);
        Assert.True(loaded!.Enabled);
        Assert.Equal("restart.example.test", loaded.Host);
    }

    [Fact]
    public void Load_CorruptFile_ReturnsNullRatherThanThrowing()
    {
        var dir = NewTempDir();
        File.WriteAllText(Path.Combine(dir, "site-link.json"), "{ not valid json ]");
        var store = new SiteLinkStore(dir);

        Assert.Null(store.Load());
    }

    [Fact]
    public void ResolveRoot_EnvOverride_ReturnsConfiguredDirectory()
    {
        var previous = Environment.GetEnvironmentVariable(SiteLinkStore.EnvVarDir);
        try
        {
            var tempDir = Path.Combine(Path.GetTempPath(), "st4i-sitelink-env-" + Guid.NewGuid().ToString("N"));
            Environment.SetEnvironmentVariable(SiteLinkStore.EnvVarDir, tempDir);

            Assert.Equal(tempDir, SiteLinkStore.ResolveRoot());
        }
        finally
        {
            Environment.SetEnvironmentVariable(SiteLinkStore.EnvVarDir, previous);
        }
    }

    [Fact]
    public void ResolveRoot_ExplicitDirectory_TakesPriorityOverEnvVar()
    {
        var previous = Environment.GetEnvironmentVariable(SiteLinkStore.EnvVarDir);
        try
        {
            Environment.SetEnvironmentVariable(SiteLinkStore.EnvVarDir, Path.Combine(Path.GetTempPath(), "st4i-sitelink-env-should-not-win"));
            var explicitDir = Path.Combine(Path.GetTempPath(), "st4i-sitelink-explicit-" + Guid.NewGuid().ToString("N"));

            Assert.Equal(explicitDir, SiteLinkStore.ResolveRoot(explicitDir));
        }
        finally
        {
            Environment.SetEnvironmentVariable(SiteLinkStore.EnvVarDir, previous);
        }
    }

    [Fact]
    public void ResolveRoot_NoOverrideAtAll_ReturnsDefaultRoot()
    {
        var previous = Environment.GetEnvironmentVariable(SiteLinkStore.EnvVarDir);
        try
        {
            Environment.SetEnvironmentVariable(SiteLinkStore.EnvVarDir, null);

            Assert.Equal(SiteLinkStore.DefaultRoot(), SiteLinkStore.ResolveRoot());
        }
        finally
        {
            Environment.SetEnvironmentVariable(SiteLinkStore.EnvVarDir, previous);
        }
    }

    [Fact]
    public void DefaultRoot_IsSiblingOfSettingsDefaultDir_NotTheSameDirectory()
    {
        var settingsDefaultRoot = Path.Combine(
            Environment.GetFolderPath(Environment.SpecialFolder.CommonApplicationData), "ST4I", "sim", "settings");

        var sitelinkDefaultRoot = SiteLinkStore.DefaultRoot();

        Assert.NotEqual(settingsDefaultRoot, sitelinkDefaultRoot);
        Assert.Equal(Path.GetDirectoryName(settingsDefaultRoot), Path.GetDirectoryName(sitelinkDefaultRoot));
    }

    [Fact]
    public void Ctor_CreatesTheDirectoryIfItDoesNotExistYet()
    {
        var root = Directory.CreateTempSubdirectory("st4i-sitelink-ctor-tests-").FullName;
        _tempDirs.Add(root);
        var freshDir = Path.Combine(root, "not-created-yet");
        Assert.False(Directory.Exists(freshDir));

        _ = new SiteLinkStore(freshDir);

        Assert.True(Directory.Exists(freshDir));
    }

    [Fact]
    public void Load_DefaultDisabledLink_NeverConfigured_MatchesFreshPersistedSiteLinkDefault()
    {
        // No file at all yet == exactly the same effective config as `new PersistedSiteLink()` — the
        // caller (SiteBridgeManager's startup ApplyAsync(store.Load() ?? new PersistedSiteLink())) must
        // land on Enabled=false either way.
        var store = new SiteLinkStore(NewTempDir());

        Assert.Null(store.Load());
        Assert.False(new PersistedSiteLink().Enabled);
    }
}
