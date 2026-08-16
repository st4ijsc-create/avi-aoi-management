using System.Text.Json;
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
///
/// <para>🔴 <b>Task Q-1 added the second block below</b>, for <see cref="FleetSettingsStore.Read"/> and its
/// three outcomes. Note what that does to the sentence above: <c>Load()</c> answering null for a corrupt
/// file is still asserted here and is still correct <i>as an answer to the question <c>Load()</c> asks</i>
/// — "is there a triple to apply" — and it is exactly why <c>Load()</c> is no longer the read anything
/// branches a WRITE on.</para>
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

    // ══ TASK Q-1 — THE THIRD OUTCOME ══════════════════════════════════════════════════════════════════
    //
    // 🔴 THE PROPERTY, and it is about the READ rather than about any one failure. A store's slot on disk
    // being EMPTY is what entitles a caller to establish a value of its own. A read that FAILED tells the
    // caller nothing about the slot except that something is in it — and that something is the last
    // surviving record of what was configured. So the read has to be able to say three things, and the
    // seven below are indexed on the boundary that matters: NOTHING HERE may ever be confused with
    // SOMETHING I COULD NOT READ.
    //
    // WHY SEVERAL CAUSES AND ONE OUTCOME. The unreadable rows differ in cause — bad syntax, no bytes at
    // all, legal JSON that yields no object, another handle refusing to share — and three of them do not
    // even throw the same type. They are one outcome because they create one obligation, and asserting
    // them separately is what makes that a measured claim about a population rather than a claim written
    // from one member of it, which is the exact failure `docs/startup-failure-posture.md` §3.1a records
    // twice against earlier rounds of this same question.
    //
    // `Load()` is asserted alongside `Read()` on the two rows where it still answers, because `Load()` is
    // now defined in terms of `Read()` and a change that broke that relation would otherwise be invisible
    // here.

    [Fact]
    public void Read_NoFileYet_ReportsAbsent()
    {
        var store = new FleetSettingsStore(NewTempDir());

        var read = store.Read();

        Assert.Equal(FleetSettingsReadStatus.Absent, read.Status);
        Assert.Null(read.Settings);
        Assert.Null(read.Reason);
        Assert.Null(store.Load());
    }

    [Fact]
    public void Read_AfterSave_ReportsLoaded_AndCarriesTheTriple()
    {
        var store = new FleetSettingsStore(NewTempDir());
        store.Save(new PersistedFleetSettings
        {
            ServerUrl = "https://q1-loaded.example.test",
            MachineCode = "Q1-LOADED-01",
            VerifyTls = false,
        });

        var read = store.Read();

        Assert.Equal(FleetSettingsReadStatus.Loaded, read.Status);
        Assert.NotNull(read.Settings);
        Assert.Equal("https://q1-loaded.example.test", read.Settings!.ServerUrl);
        Assert.Equal("Q1-LOADED-01", read.Settings.MachineCode);
        Assert.False(read.Settings.VerifyTls);
        Assert.Null(read.Reason);
        Assert.EndsWith("fleet-settings.json", read.FilePath, StringComparison.Ordinal);
    }

    /// <summary>🔴 The likeliest vector of all of them, and the one that made this a live data-loss defect
    /// rather than a theoretical one: a hand-edited file with a typo in it. This file has no schema and is
    /// meant to be repairable by hand. Before Q-1 this answered exactly as "there is no file".</summary>
    [Fact]
    public void Read_MalformedFile_ReportsUnreadable_AndNeverAbsent()
    {
        var dir = NewTempDir();
        File.WriteAllText(Path.Combine(dir, "fleet-settings.json"), "{ not valid json ]");
        var store = new FleetSettingsStore(dir);

        var read = store.Read();

        Assert.Equal(FleetSettingsReadStatus.Unreadable, read.Status);
        Assert.Null(read.Settings);
        Assert.NotNull(read.Reason);
        Assert.IsAssignableFrom<JsonException>(read.Failure);
    }

    [Fact]
    public void Read_EmptyFile_ReportsUnreadable_AndNeverAbsent()
    {
        var dir = NewTempDir();
        File.WriteAllText(Path.Combine(dir, "fleet-settings.json"), string.Empty);
        var store = new FleetSettingsStore(dir);

        var read = store.Read();

        Assert.Equal(FleetSettingsReadStatus.Unreadable, read.Status);
        Assert.Null(read.Settings);
        Assert.NotNull(read.Reason);
    }

    /// <summary>The one unreadable shape that throws NOTHING: four legal JSON bytes that deserialize to no
    /// object at all. It is asserted separately because it is the row that forces
    /// <c>FleetSettingsRead.Failure</c> to be nullable on the Unreadable outcome — a fact stated on that
    /// member and measured here rather than left as a comment.</summary>
    [Fact]
    public void Read_FileHoldingLiteralNullJson_ReportsUnreadable_WithNoException()
    {
        var dir = NewTempDir();
        File.WriteAllText(Path.Combine(dir, "fleet-settings.json"), "null");
        var store = new FleetSettingsStore(dir);

        var read = store.Read();

        Assert.Equal(FleetSettingsReadStatus.Unreadable, read.Status);
        Assert.Null(read.Settings);
        Assert.NotNull(read.Reason);
        Assert.Null(read.Failure);
    }

    /// <summary>🔴 The non-malformed vector, kept because the whole point is that these do NOT share a
    /// cause: a well-formed file whose bytes this process cannot reach because another handle refuses to
    /// share them — an editor or an AV scanner, including the editor the product's own remedy string sends
    /// an operator to open it with. Measured in task M-1: <c>FileShare.None</c> reaches the read and
    /// <c>FileShare.Read</c> does not, which is why this opens with the former.</summary>
    [Fact]
    public void Read_FileHeldWithADenyShareLock_ReportsUnreadable_WithoutThrowing()
    {
        var dir = NewTempDir();
        var path = Path.Combine(dir, "fleet-settings.json");
        var store = new FleetSettingsStore(dir);
        store.Save(new PersistedFleetSettings { ServerUrl = "https://q1-locked.example.test", MachineCode = "Q1-LOCK", VerifyTls = true });

        FleetSettingsRead read;
        using (var _ = new FileStream(path, FileMode.Open, FileAccess.Read, FileShare.None))
        {
            read = store.Read();
        }

        Assert.Equal(FleetSettingsReadStatus.Unreadable, read.Status);
        Assert.Null(read.Settings);
        Assert.NotNull(read.Reason);
        Assert.IsAssignableFrom<IOException>(read.Failure);

        // …and the lock is a property of the moment, not of the file: once the handle is gone the same
        // store reads the same file. Without this half, a Read() that simply always answered Unreadable
        // would pass everything above.
        Assert.Equal(FleetSettingsReadStatus.Loaded, store.Read().Status);
    }

    /// <summary>Q-1 removed the <c>File.Exists</c> gate <see cref="FleetSettingsStore.Delete"/> opened
    /// with — it disagreed with the operation it was guarding under a withheld-read ACL, turning the delete
    /// into a silent no-op while its caller logged that the file had been removed. This pins the behaviour
    /// the gate was there for: nothing on disk is still not an error.</summary>
    [Fact]
    public void Delete_WithNothingOnDisk_IsANoOp_AndDoesNotThrow()
    {
        var dir = NewTempDir();
        var store = new FleetSettingsStore(dir);

        store.Delete();

        Assert.Equal(FleetSettingsReadStatus.Absent, store.Read().Status);
        Assert.False(File.Exists(Path.Combine(dir, "fleet-settings.json")));
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
