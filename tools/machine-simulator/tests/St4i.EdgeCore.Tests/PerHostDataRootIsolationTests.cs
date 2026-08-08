using System;
using System.IO;
using St4i.EdgeCore.Config;
using St4i.EdgeCore.Infrastructure;
using St4i.EdgeCore.Transport;
using Xunit;

/// <summary>
/// 🔴 <b>Task F-1 — TWO HOSTS ON ONE MACHINE, TWO DATA ROOTS: neither observes the other's data.</b>
///
/// <para><b>What this is for.</b> Since Đợt E it is a normal deployment to run <c>St4i.EngineApi</c> and
/// <c>St4i.EdgeService</c> on the same Windows box (README §24). By default they share one set of files under
/// <c>%ProgramData%\ST4I\sim\…</c>. The relocation mechanism — explicit path &gt; <c>ST4I_*_DIR</c> &gt;
/// default — already existed on every store before this task; <b>what did not exist was a demonstration that
/// it actually separates two hosts.</b> That gap is the reason this file is not another
/// <c>ResolveRoot</c> test.</para>
///
/// <para>🔴 <b>Reading <c>ResolveRoot</c> is NOT what is asserted here, deliberately.</b> A resolver can be
/// perfectly correct while the store it belongs to ignores it — <c>CredentialStoreTests</c>' own
/// <c>Save_WritesToTheRedirectedDirectory_…</c> exists because exactly that was possible. Every assertion
/// below is on an OBSERVATION MADE THROUGH THE STORE: a write is performed as host A, and host B is then
/// asked, through the store's own public read, whether it can see it. Both directions are asserted, because
/// "B cannot see A" and "B did not overwrite A" are two different failures and a one-directional test sees
/// only the first.</para>
///
/// <para><b>Why the credential test flips an environment variable instead of passing a directory.</b>
/// <c>CredentialStore</c> is <see langword="static"/> — <c>Save</c>/<c>Load</c>/<c>ListMachineCodes</c> take
/// no directory and there is no construction point a fixture could hook — so the env var IS the seam, and it
/// is sufficient because two hosts are two PROCESSES with two environment blocks. Flipping it mid-test models
/// that faithfully precisely because resolution is per call and nothing is cached. F-1 deliberately did NOT
/// add an explicit seam to it: doing so would mean touching the type that holds the DPAPI blobs, and
/// <c>DataProtectionScope.LocalMachine</c> is not allowed to move.</para>
///
/// <para><b>The three stores below are not a sample; they are the three that matter today.</b>
/// <c>CredentialStore</c> is the one both hosts touch (the engine writes it at onboarding, the edge agent
/// reads it to go Live). The WAL is the only machine-wide store the edge agent has ever WRITTEN. And
/// <c>FleetSettingsStore</c> holds exactly one <c>(ServerUrl, MachineCode, VerifyTls)</c> triple, so two hosts
/// sharing it is a last-writer-wins collision rather than a merge. The other ten directories share the
/// identical idiom; that the idiom is UNIVERSAL is asserted by enumeration in
/// <c>St4i.EngineApi.Tests.PerHostDataRootsTests</c>, which is a different question and belongs with the
/// other scan-derived census tests.</para>
/// </summary>
[Collection("St4i.EdgeCore.Tests.MachineWideStoreEnv")]
public sealed class PerHostDataRootIsolationTests
{
    /// <summary>
    /// 🔴 <b>THE LOAD-BEARING ONE.</b> One machine code, two hosts, two creds roots: host B cannot read,
    /// cannot list, and cannot clobber what host A sealed.
    ///
    /// <para>The same machine code on both sides is the point. Two different codes would be separated by the
    /// FILENAME even inside one shared directory, so such a test would pass on a build where the redirect did
    /// nothing at all — the vacuity this project keeps finding by mutation. With one code, the only thing that
    /// can separate the two is the directory.</para>
    ///
    /// <para>Asserted last, and it is the assertion a caching regression dies on: after B has written its own
    /// value, A still reads A's. A store that resolved its root ONCE — first call wins, which is what a
    /// perfectly reasonable-looking memoisation of <c>CredsDir()</c> would produce — passes every
    /// single-direction check and fails this one.</para>
    /// </summary>
    [Fact]
    public void TwoHostsOnTwoCredsRoots_NeitherReadsTheOthersCredential_AndNeitherOverwritesIt()
    {
        var previous = Environment.GetEnvironmentVariable(CredentialStore.EnvVarDir);
        var hostA = Directory.CreateTempSubdirectory("st4i-f1-creds-hostA-").FullName;
        var hostB = Directory.CreateTempSubdirectory("st4i-f1-creds-hostB-").FullName;

        // ONE machine code, both hosts. See the remarks — two codes would be separated by the filename.
        var code = "F1-SHARED-" + Guid.NewGuid().ToString("N")[..8];

        try
        {
            Environment.SetEnvironmentVariable(CredentialStore.EnvVarDir, hostA);
            CredentialStore.Save(code, "mk_host_a");

            // Host B: a second process, its own environment block, its own root.
            Environment.SetEnvironmentVariable(CredentialStore.EnvVarDir, hostB);
            Assert.Null(CredentialStore.Load(code));
            Assert.DoesNotContain(code, CredentialStore.ListMachineCodes());

            CredentialStore.Save(code, "mk_host_b");
            Assert.Equal("mk_host_b", CredentialStore.Load(code));

            // Back to host A. Its credential is untouched — B's write went somewhere else entirely.
            Environment.SetEnvironmentVariable(CredentialStore.EnvVarDir, hostA);
            Assert.Equal("mk_host_a", CredentialStore.Load(code));

            // And on disk: two files, one per root, and neither root is the real %ProgramData% one.
            Assert.True(File.Exists(Path.Combine(hostA, code + ".bin")));
            Assert.True(File.Exists(Path.Combine(hostB, code + ".bin")));
            Assert.False(File.Exists(Path.Combine(CredentialStore.DefaultRoot(), code + ".bin")),
                "A credential landed in the REAL %ProgramData% creds directory despite ST4I_CREDS_DIR " +
                "naming a per-host root — per-host roots are not separating anything.");
        }
        finally
        {
            Environment.SetEnvironmentVariable(CredentialStore.EnvVarDir, previous);
            try { Directory.Delete(hostA, recursive: true); } catch { /* best-effort */ }
            try { Directory.Delete(hostB, recursive: true); } catch { /* best-effort */ }
        }
    }

    /// <summary>
    /// The same proof for a store with an EXPLICIT directory seam, and it needs no environment variable at
    /// all — two live instances, two roots, in one process.
    ///
    /// <para><c>FleetSettingsStore</c> holds exactly ONE
    /// <c>(ServerUrl, MachineCode, VerifyTls)</c> triple in one file, so two hosts sharing its root is a
    /// last-writer-wins overwrite: whichever host restarts second silently adopts the other's server URL and
    /// machine identity. That is the failure this separation prevents, and it is why the final assertion
    /// re-reads A AFTER B has written.</para>
    ///
    /// <para>The <c>Load</c> on the untouched root asserts <see langword="null"/> rather than a default
    /// object: <c>null</c> is this store's "fresh install, nothing persisted" answer, which is exactly what a
    /// host on a brand-new root must see.</para>
    /// </summary>
    [Fact]
    public void TwoHostsOnTwoSettingsRoots_NeitherReadsTheOthersFleetSettings_AndNeitherOverwritesIt()
    {
        var hostA = new FleetSettingsStore(Directory.CreateTempSubdirectory("st4i-f1-settings-hostA-").FullName);
        var hostB = new FleetSettingsStore(Directory.CreateTempSubdirectory("st4i-f1-settings-hostB-").FullName);

        Assert.NotEqual(hostA.RootDirectory, hostB.RootDirectory);

        hostA.Save(new PersistedFleetSettings
        {
            ServerUrl = "https://engine.example.com",
            MachineCode = "LINE3-ENGINE-01",
            VerifyTls = true,
        });

        Assert.Null(hostB.Load());

        hostB.Save(new PersistedFleetSettings
        {
            ServerUrl = "https://edge.example.com",
            MachineCode = "LINE3-EDGE-01",
            VerifyTls = false,
        });

        var a = hostA.Load();
        Assert.NotNull(a);
        Assert.Equal("https://engine.example.com", a!.ServerUrl);
        Assert.Equal("LINE3-ENGINE-01", a.MachineCode);
        Assert.True(a.VerifyTls);
    }

    /// <summary>
    /// 🔴 The WAL, which is the only machine-wide store <c>St4i.EdgeService</c> has ever WRITTEN (blueprint
    /// §11.4) — so it is the collision a two-host deployment hits first, and the one an operator is most
    /// likely to create by accident.
    ///
    /// <para><b>The control arm is what makes this test say something.</b> The queue file is
    /// <c>&lt;dir&gt;\&lt;machineCode&gt;.jsonl</c>, a pure function of two inputs, so the first assertion
    /// below states the HAZARD in the same terms as the fix: same root plus same machine code IS one file,
    /// and both hosts would append to it. Without that arm, "two roots give two paths" is a fact about
    /// <c>Path.Combine</c> rather than about this deployment.</para>
    ///
    /// <para>Bytes are actually written rather than paths merely compared, for the same reason the credential
    /// test reads through the store: a path that differs proves nothing if something downstream resolves it
    /// again.</para>
    /// </summary>
    [Fact]
    public void TwoHostsOnTwoWalRoots_GetTwoQueueFiles_WhereOneSharedRootWouldGiveThemOne()
    {
        const string machineCode = "LINE3-AOI-01";

        var hostA = new WalOptions { Directory = Directory.CreateTempSubdirectory("st4i-f1-wal-hostA-").FullName };
        var hostB = new WalOptions { Directory = Directory.CreateTempSubdirectory("st4i-f1-wal-hostB-").FullName };

        // The hazard, stated as arithmetic: a SECOND host left on host A's root, with the same machine code,
        // resolves the identical file. This is the control — without it the assertions below are about
        // Path.Combine rather than about two hosts.
        var sharedRoot = new WalOptions { Directory = hostA.Directory };
        Assert.Equal(hostA.ResolveQueueFile(machineCode), sharedRoot.ResolveQueueFile(machineCode));

        hostA.EnsureDir();
        hostB.EnsureDir();

        var queueA = hostA.ResolveQueueFile(machineCode);
        var queueB = hostB.ResolveQueueFile(machineCode);
        Assert.NotEqual(queueA, queueB);

        File.WriteAllText(queueA, "{\"host\":\"engine\"}\n");

        Assert.False(File.Exists(queueB),
            "Host B's WAL queue file exists after only host A wrote — the two hosts are appending to one " +
            "backlog file, which is what a shared ST4I_WAL_DIR plus a shared ST4I_MACHINE_CODE produces.");
        Assert.Empty(Directory.GetFiles(hostB.EnsureDir()));
    }
}
