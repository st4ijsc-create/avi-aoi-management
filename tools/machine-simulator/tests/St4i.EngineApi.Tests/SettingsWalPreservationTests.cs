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
/// Buffering is PRE-SEEDED directly onto disk here (rather than forced via a real SDK retry-exhaustion,
/// as <c>TransportCoordinatorWalTests</c> does) — this test's job is only to prove
/// <see cref="FleetHost.UpdateSettings"/>'s rebuild never relocates/empties the file for the SAME
/// machineCode; the actual disk-append mechanics belong to the SDK and are already covered end-to-end
/// there.
/// </summary>
public sealed class SettingsWalPreservationTests
{
    private static string TempDir() => Directory.CreateTempSubdirectory("st4i-settings-wal-tests-").FullName;

    [Fact]
    public void Put_settings_serverUrl_change_triggers_RebuildLive_but_preserves_the_startup_machines_WAL_file()
    {
        var wal = new WalOptions { Directory = TempDir() };
        var demo = new DemoTransport(latencyMs: 0);
        var live = LiveTransport.ForMachine(FleetHost.DefaultServerUrl, mkKey: "", FleetHost.DefaultMachineCode, queuePath: null, verifyTls: true);
        var auto = new AutoTransport(live, demo);
        var switchable = new SwitchableTransport(demo);
        var coordinator = new TransportCoordinator(switchable, demo, live, auto, TransportMode.Demo, wal);
        var host = new FleetHost(switchable, coordinator, new EventBus());

        // Simulate a backlog a real offline LiveTransport would already have appended for the startup
        // machineCode BEFORE this Settings change ever happens.
        var walFile = wal.ResolveQueueFile(FleetHost.DefaultMachineCode);
        Directory.CreateDirectory(Path.GetDirectoryName(walFile)!);
        File.WriteAllText(walFile, "{\"kind\":\"process\",\"path\":\"/api/v1/ingest/process-result\"}\n");

        var updated = host.UpdateSettings(new SettingsUpdateRequest(
            ServerUrl: "http://localhost:5999", VerifyTls: null, Language: null, MachineCode: null));

        // Sanity: the settings change (and therefore RebuildLive) actually happened.
        Assert.Equal("http://localhost:5999", updated.ServerUrl);
        Assert.Equal(FleetHost.DefaultMachineCode, updated.MachineCode);

        Assert.True(File.Exists(walFile));
        Assert.Equal("{\"kind\":\"process\",\"path\":\"/api/v1/ingest/process-result\"}\n", File.ReadAllText(walFile));
    }
}
