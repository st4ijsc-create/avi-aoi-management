using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Net.Http;
using System.Text.Json;
using System.Threading.Tasks;
using St4i.EdgeCore.Config;
using St4i.EdgeCore.Infrastructure;
using St4i.EdgeCore.Models;
using St4i.EdgeCore.Tests.Fakes;
using St4i.EdgeCore.Transport;
using St4i.Connector.Abstractions.Models;
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
/// <c>Save_WritesToTheRedirectedDirectory_…</c> exists because exactly that was possible.</para>
///
/// <para>🔴 <b>What carries each arm, ARM BY ARM — this is an enumeration and not a summary, and the reason
/// for that is written below it.</b>
/// <list type="number">
/// <item><b>Credential arm.</b> Subject: <c>CredentialStore.Load</c> and <c>ListMachineCodes</c>, called after
/// nothing but an environment variable was changed. Both directions: B cannot read what A sealed, and A's
/// value survives B writing the same machine code. It ALSO corroborates on disk, and that half DOES compute
/// the production file name (<c>&lt;machineCode&gt;.bin</c>) under three roots — host A's, host B's, and
/// <c>CredentialStore.DefaultRoot()</c>. Named rather than hidden: the third is a negative control (the real
/// <c>%ProgramData%</c> root was not written) and earns its duplication of the naming rule; the first two sit
/// on top of the <c>Load</c> assertions above them rather than carrying them.</item>
/// <item><b>Settings arm.</b> Subject: <c>FleetSettingsStore.Load</c> on each instance — B reads
/// <see langword="null"/>, and A still reads A's triple after B has saved its own. It also asserts the two
/// roots differ, which is a PRECONDITION on values this test itself chose: it can fail only if
/// <c>CreateTempSubdirectory</c> returned the same path twice.</item>
/// <item><b>WAL arm.</b> Subject: a glob over each root after a real offline <c>SendAsync</c> — A's root holds
/// A's key and B's root is empty, then B's root holds B's key and A's is unchanged. It computes no file name
/// and asserts on no path. It does encode ONE detail the SDK chooses — that a queue file ends in
/// <c>.jsonl</c> — as the pattern it enumerates with; that is the smallest coupling that lets the observation
/// be "what appeared under this root" instead of "what appeared at this path".</item>
/// </list></para>
///
/// <para>🔴 <b>Why that is a list instead of one sentence, and it is the most useful thing in this file.</b>
/// This paragraph has been wrong TWICE, both times as a universal quantified over the arms. Fix round 1
/// replaced <i>"every assertion is an observation made through the store"</i> — false of the WAL arm, which
/// then resolved its own path and wrote it with <see cref="File.WriteAllText(string,string)"/> — and the
/// replacement was <i>"nothing here computes a file name, and nothing here asserts on a path string"</i>,
/// which was false of the credential arm on the very same day, in the same two surfaces. Ninth instance of
/// the class in four batches; third time inside the correction written for it. A third attempt at a sentence
/// beginning "every arm" or "no arm" would be the same move again, so there is no such sentence here.
/// <b>If you edit this file and reach for "every", "all" or "no arm", that is the trigger to enumerate the
/// three arms against the claim — not a summary you have earned.</b></para>
///
/// <para><b>Why the credential test flips an environment variable instead of passing a directory.</b>
/// <c>CredentialStore</c> is <see langword="static"/> — <c>Save</c>/<c>Load</c>/<c>ListMachineCodes</c> take
/// no directory and there is no construction point a fixture could hook — so the env var IS the seam, and it
/// is sufficient because two hosts are two PROCESSES with two environment blocks. Flipping it mid-test is the
/// closest model available IN ONE PROCESS, and it is a model rather than a measurement: <b>this is not a
/// two-process test, and nothing here proves anything about two real processes.</b> What makes the model
/// load-bearing rather than decorative is a verifiable property — <c>ResolveRoot</c> resolves on every call
/// and caches nothing — and the M1 mutation (memoise <c>CredsDir()</c>) is what measures that the property is
/// doing the work. F-1 deliberately did NOT add an explicit seam here: that would mean touching the type that
/// holds the DPAPI blobs, and <c>DataProtectionScope.LocalMachine</c> is not allowed to move.</para>
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
    /// 🔴 The WAL, which is the only machine-wide store <c>St4i.EdgeService</c> has ever WRITTEN
    /// (blueprint §11.4) — so it is the collision a two-host deployment hits first, and the one an
    /// operator is most likely to create by accident.
    ///
    /// <para>🔴 <b>Fix round 1 (review I-1): this arm used to resolve the queue path itself and write
    /// it with <see cref="File.WriteAllText(string,string)"/>, which made it a fact about
    /// <see cref="Path.Combine(string,string)"/> — and made this class's own "through the store" charter
    /// false of one of its three arms.</b> <c>WalOptions.ResolveQueueFile</c> says in its own doc comment that
    /// it is a pure function of (<c>Directory</c>, machineCode), so asserting that two roots give two paths
    /// asserted that function and nothing else; and writing bytes to an already-resolved path does not
    /// exercise the resolver either. It now runs on the PRODUCTION path end to end: a real
    /// <see cref="TransportCoordinator"/> — whose <c>RebuildLive</c> is the code that calls
    /// <c>EnsureDir()</c> and <c>ResolveQueueFile(machineCode)</c> and hands the result to
    /// <c>LiveTransport.ForMachine</c> — and a real offline <c>SendAsync</c> whose bytes are appended by
    /// the vendored SDK's own <c>Enqueue</c>. <b>This test never names a file.</b> It supplies a ROOT and a
    /// machine code, and then looks at what appeared under each root.</para>
    ///
    /// <para><b>No socket is opened.</b> The injected <c>CapturingHandler</c> throws
    /// <see cref="HttpRequestException"/> — the same exception type a dead socket produces, which the SDK
    /// catches and rethrows as <c>St4iNetworkException</c>, driving its real disk-Enqueue path. Same technique
    /// and same reason as <c>TransportCoordinatorWalTests</c>. A non-empty <c>mkKey</c> is required: an empty
    /// one makes the SDK refuse synchronously as "unconfigured" and never reach the queue at all.</para>
    ///
    /// <para><b>The control arm is what makes the rest say something.</b> A third send, from a coordinator on
    /// host A's SAME root with the SAME machine code, lands in host A's existing file — one file, two
    /// backlogs interleaved. That is the hazard in the operator's own terms (a shared <c>ST4I_WAL_DIR</c> plus
    /// a shared <c>ST4I_MACHINE_CODE</c>), measured rather than asserted; without it, "two roots stayed
    /// separate" would not distinguish separation from a WAL that wrote nowhere at all.</para>
    /// </summary>
    [Fact]
    public async Task TwoHostsBufferingOffline_EachWriteIntoItsOwnWalRootOnly_WhereOneSharedRootGivesThemOneFile()
    {
        const string machineCode = "LINE3-AOI-01";

        var hostARoot = Directory.CreateTempSubdirectory("st4i-f1-wal-hostA-").FullName;
        var hostBRoot = Directory.CreateTempSubdirectory("st4i-f1-wal-hostB-").FullName;

        // Host A goes offline and buffers one reading. Nothing here names a path: the coordinator resolves it
        // from the root and the machine code, and the SDK is what writes it.
        await BufferOneOfflineSendAsync(hostARoot, machineCode, "A:RC1:000001");

        Assert.Equal("A:RC1:000001", Assert.Single(QueuedKeys(hostARoot)));
        Assert.Empty(QueuedKeys(hostBRoot));

        // Host B — its own root, the SAME machine code — buffers too. Neither observes the other, and
        // B's write does not touch A's backlog.
        await BufferOneOfflineSendAsync(hostBRoot, machineCode, "B:RC1:000001");

        Assert.Equal("B:RC1:000001", Assert.Single(QueuedKeys(hostBRoot)));
        Assert.Equal("A:RC1:000001", Assert.Single(QueuedKeys(hostARoot)));

        // 🔴 THE CONTROL: a second host left on host A's root with the same machine code appends into
        // host A's file. One file, two hosts' backlogs. This is what per-host roots prevent.
        await BufferOneOfflineSendAsync(hostARoot, machineCode, "SHARED:RC1:000002");

        Assert.Equal(
            new[] { "A:RC1:000001", "SHARED:RC1:000002" },
            QueuedKeys(hostARoot).OrderBy(k => k, StringComparer.Ordinal).ToArray());
        Assert.Single(Directory.GetFiles(hostARoot, "*.jsonl", SearchOption.AllDirectories));
        Assert.Equal("B:RC1:000001", Assert.Single(QueuedKeys(hostBRoot)));
    }

    /// <summary>Drives ONE reading through a real <see cref="TransportCoordinator"/> whose server is
    /// unreachable, so the vendored SDK's own <c>Enqueue</c> appends it to whatever queue file
    /// <c>RebuildLive</c> resolved from <paramref name="walRoot"/> and <paramref name="machineCode"/>. The
    /// caller supplies a root and a machine code and never a path — that is the whole point of the
    /// helper.</summary>
    private static async Task BufferOneOfflineSendAsync(string walRoot, string machineCode, string idempotencyKey)
    {
        var wal = new WalOptions { Directory = walRoot };
        var handler = new CapturingHandler
        {
            Responder = (_, __) => throw new HttpRequestException(
                "simulated offline server (F-1) — drives the SDK's own disk Enqueue deterministically, no real socket"),
        };

        var demo = new DemoTransport(latencyMs: 0);
        var initialLive = LiveTransport.ForMachine("http://localhost:1", "", "INITIAL", null, true);
        var coordinator = new TransportCoordinator(
            new SwitchableTransport(demo), demo, initialLive, new AutoTransport(initialLive, demo),
            TransportMode.Demo, wal, handler);

        coordinator.RebuildLive("http://unit-test.invalid", machineCode, "mk_test", true);

        var ack = await coordinator.Live.SendAsync(
            new CanonicalEnvelope(
                ReadingKind.ProcessResult, machineCode, "/api/v1/ingest/process-result",
                new()
                {
                    ["serialNumber"] = "SN1",
                    ["stepType"] = "screw_tightening",
                    ["result"] = "pass",
                    ["idempotencyKey"] = idempotencyKey,
                },
                idempotencyKey),
            default);

        Assert.True(ack.Queued,
            "the send was not buffered, so this arm would prove nothing about where a backlog lands");
    }

    /// <summary>Every idempotency key sitting in ANY queue file under <paramref name="walRoot"/> — the
    /// observation half of the helper above. Deliberately enumerates the ROOT rather than a resolved file
    /// name: the test owns the root because it chose it, and the production code owns everything below it. A
    /// root that does not exist yet reads as empty, which is exactly what a host that has never run looks
    /// like.</summary>
    private static IReadOnlyList<string> QueuedKeys(string walRoot)
    {
        if (!Directory.Exists(walRoot)) return Array.Empty<string>();

        return Directory.GetFiles(walRoot, "*.jsonl", SearchOption.AllDirectories)
            .SelectMany(File.ReadAllLines)
            .Where(line => line.Trim().Length > 0)
            .Select(line => line)
            .Where(line => line.Contains("idempotencyKey", StringComparison.Ordinal))
            .Select(ExtractIdempotencyKey)
            .Where(key => key is not null)
            .Select(key => key!)
            .Distinct(StringComparer.Ordinal)
            .ToList();
    }

    /// <summary>The idempotency key out of one queued SDK line, without depending on the SDK's envelope
    /// SHAPE: it scans the parsed JSON for the first <c>idempotencyKey</c> property at any depth. The shape is
    /// the vendored SDK's to change and this test's subject is WHICH DIRECTORY the line landed in, so pinning
    /// the nesting here would make an unrelated SDK change look like a data-root regression.</summary>
    private static string? ExtractIdempotencyKey(string line)
    {
        using var doc = JsonDocument.Parse(line);
        return FindFirst(doc.RootElement);

        static string? FindFirst(JsonElement element)
        {
            switch (element.ValueKind)
            {
                case JsonValueKind.Object:
                    foreach (var property in element.EnumerateObject())
                    {
                        if (property.NameEquals("idempotencyKey") && property.Value.ValueKind == JsonValueKind.String)
                        {
                            return property.Value.GetString();
                        }

                        if (FindFirst(property.Value) is { } nested) return nested;
                    }

                    return null;

                case JsonValueKind.Array:
                    foreach (var item in element.EnumerateArray())
                    {
                        if (FindFirst(item) is { } nested) return nested;
                    }

                    return null;

                default:
                    return null;
            }
        }
    }
}
