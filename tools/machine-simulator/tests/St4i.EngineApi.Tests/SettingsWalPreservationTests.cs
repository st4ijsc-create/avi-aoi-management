using System.Net.Http;
using St4i.EdgeCore.Infrastructure;
using St4i.EdgeCore.Models;
using St4i.EdgeCore.Transport;
using St4i.EngineApi.Fleet;
using Xunit;

namespace St4i.EngineApi.Tests;

/// <summary>
/// WS-C-T2 — thin EngineApi-level companion to
/// <see cref="St4i.EdgeCore.Tests.Transport.TransportCoordinatorWalTests"/>: proves the same
/// preserve-on-rebuild guarantee holds through the REAL production call path a <c>PUT /v1/settings</c>
/// request drives (<see cref="FleetHost.UpdateSettings"/> -&gt; <see cref="TransportCoordinator.RebuildLive"/>),
/// not just when <see cref="TransportCoordinator"/> is exercised directly.
/// <see cref="St4i.EngineApi.Endpoints.SettingsEndpoints.MapSettingsEndpoints"/>'s PUT route is a
/// one-line wrapper around <see cref="FleetHost.UpdateSettings"/> (<c>Results.Ok(host.UpdateSettings(request))</c>,
/// no other logic) — calling <see cref="FleetHost.UpdateSettings"/> directly here IS calling the
/// endpoint handler, the same "call the internal handler directly" idiom
/// <c>MachineSettingsEndpointsTests</c> already uses, with no ASP.NET plumbing needed since
/// <see cref="FleetHost.UpdateSettings"/> already takes the bound <c>SettingsUpdateRequest</c> record.
///
/// Fix round 1 (C2 review) — the original version of this test PRE-SEEDED the WAL file directly and
/// only asserted it was unchanged after <see cref="FleetHost.UpdateSettings"/>. That was NOT
/// discriminating: <see cref="TransportCoordinator.RebuildLive"/> does zero file I/O of its own (proven
/// in <c>TransportCoordinatorWalTests</c>), so that version passed even with the queuePath wiring fully
/// reverted to a hardcoded <c>null</c> — a pre-seeded file just sits there untouched either way. This
/// version instead BUFFERS BOTH before-and-after entries by actually SENDING through the real,
/// wired-up <see cref="TransportCoordinator.Live"/> (with an injected always-fails
/// <see cref="HttpMessageHandler"/> — same fake-handler technique as
/// <c>TransportCoordinatorWalTests</c>' fix round 1, no real socket, no OS-timing dependence), so a
/// revert is actually caught: with <c>queuePath: null</c> hardcoded, EITHER send would buffer to the
/// SDK's in-memory queue instead of disk, and the final "2 lines on disk" assertion below would fail.
///
/// Uses a throwaway, GUID-suffixed machineCode (rather than <see cref="FleetHost.DefaultMachineCode"/>)
/// so the <see cref="CredentialStore.Save"/> call below (needed for a NON-EMPTY mkKey — see
/// <c>TransportCoordinatorWalTests</c>' class doc for why an empty one would short-circuit before ever
/// touching the queue file) can never collide with or overwrite a real stored credential for the
/// well-known "ENGINE-API-01" identity — same precaution <c>CredentialStoreTests.cs</c> already takes.
/// </summary>
public sealed class SettingsWalPreservationTests
{
    private static string TempDir() => Directory.CreateTempSubdirectory("st4i-settings-wal-tests-").FullName;

    private sealed class NetworkDownHandler : HttpMessageHandler
    {
        // Always throws HttpRequestException — the SAME exception type a real dead socket produces,
        // which St4iDeviceClient.HttpSendAsync catches and converts to St4iNetworkException, driving
        // its own retry-exhaustion-then-Enqueue-to-disk path. No real socket ever touched.
        protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken) =>
            throw new HttpRequestException("simulated offline server (WS-C-T2 fix round 1)");
    }

    [Fact]
    public async Task Put_settings_serverUrl_change_triggers_RebuildLive_but_preserves_the_machines_WAL_file()
    {
        var wal = new WalOptions { Directory = TempDir() };
        var machineCode = "SETTINGS-WAL-TEST-" + Guid.NewGuid().ToString("N").Substring(0, 8);
        CredentialStore.Save(machineCode, "mk_test"); // non-empty mkKey — see class doc

        var demo = new DemoTransport(latencyMs: 0);
        // Placeholder initial LiveTransport — replaced (and disposed) by the first UpdateSettings call
        // below, never itself under test.
        var placeholderLive = LiveTransport.ForMachine("http://localhost:1", "", "PLACEHOLDER", null, true);
        var auto = new AutoTransport(placeholderLive, demo);
        var switchable = new SwitchableTransport(demo);
        var coordinator = new TransportCoordinator(switchable, demo, placeholderLive, auto, TransportMode.Demo, wal, new NetworkDownHandler());
        var host = new FleetHost(switchable, coordinator, new EventBus());

        // Adopt machineCode (mirrors an operator's first-time Settings save) — this is itself a
        // RebuildLive, wiring coordinator.Live to a LiveTransport for `machineCode` with the injected
        // handler and (if WAL wiring is correct) queuePath == wal.ResolveQueueFile(machineCode).
        host.UpdateSettings(new SettingsUpdateRequest(ServerUrl: null, VerifyTls: null, Language: null, MachineCode: machineCode));

        var envelope1 = ProcessResultEnvelope(machineCode, $"{machineCode}:RC1:000001");
        var ack1 = await coordinator.Live.SendAsync(envelope1, default);
        Assert.True(ack1.Queued);

        var walFile = wal.ResolveQueueFile(machineCode);
        Assert.True(File.Exists(walFile));
        var linesAfterFirstSend = File.ReadAllLines(walFile).Where(l => l.Trim().Length > 0).ToArray();
        Assert.Single(linesAfterFirstSend);

        // The Settings change under test: ServerUrl only (machineCode unchanged) — this is exactly what
        // PUT /v1/settings {serverUrl:...} drives (SettingsEndpoints.MapSettingsEndpoints' PUT route is
        // a bare Results.Ok(host.UpdateSettings(request)) wrapper).
        var updated = host.UpdateSettings(new SettingsUpdateRequest(
            ServerUrl: "http://localhost:5999", VerifyTls: null, Language: null, MachineCode: null));
        Assert.Equal("http://localhost:5999", updated.ServerUrl);
        Assert.Equal(machineCode, updated.MachineCode); // sanity: still the same machine identity

        // Send a SECOND record through the REBUILT coordinator.Live. If RebuildLive's queuePath wiring
        // were reverted to a hardcoded null, this would buffer into the rebuilt LiveTransport's own
        // in-memory queue instead of disk, and the file would still show only the FIRST entry below —
        // this is what makes the test fail-if-reverted rather than trivially passing.
        var envelope2 = ProcessResultEnvelope(machineCode, $"{machineCode}:RC1:000002");
        var ack2 = await coordinator.Live.SendAsync(envelope2, default);
        Assert.True(ack2.Queued);

        // NOT a byte-exact comparison against linesAfterFirstSend[0]: St4iDeviceClient.SendWithRetryAsync
        // opportunistically flushes the existing on-disk queue at the START of every send (QueueLen() > 0
        // here, since the first entry is still sitting in the file) — since the injected handler always
        // fails, that flush attempt re-queues the SAME first entry with a freshly-stamped internal
        // `queuedAt` wrapper field (see St4iDeviceClient.Enqueue/FlushQueueAsync), so its raw bytes
        // legitimately shift by a few milliseconds even though nothing about WAL preservation broke.
        // What actually matters — and IS reverted-sensitive — is that BOTH idempotencyKeys still show up
        // on disk after the rebuild: if queuePath had reverted to null, envelope2 would land in the
        // rebuilt transport's own private in-memory queue instead, and "000002" would never reach the file.
        var linesAfterSecondSend = File.ReadAllLines(walFile).Where(l => l.Trim().Length > 0).ToArray();
        Assert.Equal(2, linesAfterSecondSend.Length);
        Assert.Contains(linesAfterSecondSend, l => l.Contains($"{machineCode}:RC1:000001"));
        Assert.Contains(linesAfterSecondSend, l => l.Contains($"{machineCode}:RC1:000002"));
    }

    private static CanonicalEnvelope ProcessResultEnvelope(string machineCode, string idempotencyKey) => new(
        ReadingKind.ProcessResult, machineCode, "/api/v1/ingest/process-result",
        new()
        {
            ["serialNumber"] = "SN1",
            ["stepType"] = "screw_tightening",
            ["result"] = "pass",
            ["idempotencyKey"] = idempotencyKey,
        }, idempotencyKey);
}
