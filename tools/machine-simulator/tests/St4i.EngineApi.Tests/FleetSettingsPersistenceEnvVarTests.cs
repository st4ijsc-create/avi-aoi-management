using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using System.Text.Json.Serialization;
using Microsoft.AspNetCore.Mvc.Testing;
using St4i.EdgeCore.Config;
using St4i.EngineApi.Fleet;
using St4i.EngineApi.Tests.Auth;
using Xunit;

namespace St4i.EngineApi.Tests;

/// <summary>
/// FF-1 (docs/plans/2026-07-27-ws-ff-fast-follows.md) — proves the settings PERSISTENCE this task adds
/// actually survives a process restart end-to-end through the REAL composition root (<c>Program.cs</c>),
/// and that the documented precedence — a persisted <c>fleet-settings.json</c> wins over the WS-F1
/// <c>ST4I_SERVER_URL</c>/<c>ST4I_MACHINE_CODE</c>/<c>ST4I_VERIFY_TLS</c> env-var floor whenever both are
/// present — is what's actually wired up in <c>Program.cs</c>. Same "boot the real composition root, not
/// just <see cref="FleetHost"/> in isolation" rationale as <see cref="LiveSettingsEnvVarTests"/> (WS-F1's
/// own env-var-seeding test), extended with <see cref="FleetSettingsStore.EnvVarDir"/> so two successive
/// <c>WebApplicationFactory&lt;Program&gt;</c> boots pointed at the SAME directory simulate a genuine
/// process restart (a fresh <see cref="FleetHost"/>, fresh everything, same disk).
///
/// Lower-level coverage lives alongside it: <c>FleetSettingsStoreTests</c> (St4i.EdgeCore.Tests) covers
/// the store's own Load/Save/atomic-write contract in isolation, and
/// <c>FleetHostSettingsPersistenceTests</c> (this project) covers <see cref="FleetHost.UpdateSettings"/>'s
/// persist-on-change behavior directly against two <see cref="FleetHost"/> instances, with no ASP.NET
/// host at all. This file is the one level none of those reach: proving <c>Program.cs</c>'s own
/// persisted-file-vs-env-var DECISION (not just the primitives it's built from) is wired correctly.
///
/// Same real-env-var-mutation technique/collection as <see cref="LiveSettingsEnvVarTests"/> —
/// <c>[Collection(SecurityEnvVarTests.CollectionName)]</c> is required for the same reason:
/// <c>Program.cs</c> reads every one of these env vars straight off
/// <see cref="Environment.GetEnvironmentVariable(string)"/> with no <c>IConfiguration</c> seam, so two
/// factory boots racing each other at the same wall-clock instant could cross-contaminate.
/// </summary>
[Collection(SecurityEnvVarTests.CollectionName)]
public sealed class FleetSettingsPersistenceEnvVarTests
{
    private static readonly SemaphoreSlim EnvLock = new(1, 1);

    private static readonly JsonSerializerOptions JsonOptions = new(JsonSerializerDefaults.Web)
    {
        Converters = { new JsonStringEnumConverter() },
    };

    private sealed record EnvOverrides(string? ServerUrl, string? MachineCode, string? VerifyTlsRaw, string SettingsDir);

    /// <summary>Same eager-build-under-mutated-real-env-vars technique as
    /// <see cref="LiveSettingsEnvVarTests"/>'s own <c>CreateFactoryAsync</c>, plus
    /// <see cref="FleetSettingsStore.EnvVarDir"/> (<c>ST4I_SETTINGS_DIR</c>) so each test controls exactly
    /// which directory <c>Program.cs</c>'s <c>FleetSettingsStore</c> resolves to.</summary>
    private static async Task<WebApplicationFactory<Program>> CreateFactoryAsync(EnvOverrides overrides)
    {
        var securityDir = Directory.CreateTempSubdirectory("st4i-ff1-security-").FullName;
        var historianDir = Directory.CreateTempSubdirectory("st4i-ff1-historian-").FullName;
        var walDir = Directory.CreateTempSubdirectory("st4i-ff1-wal-").FullName;
        // EC-3 review follow-up — see SiteEndpointsTests' own doc comment: without these, every
        // WebApplicationFactory<Program> boot below (UNS defaults ON) resolves DeviceIdentityStore/
        // SiteLinkStore to the REAL %ProgramData%\ST4I\sim\identity\ / ...\sitelink\.
        var identityDir = Directory.CreateTempSubdirectory("st4i-ff1-identity-").FullName;
        var siteLinkDir = Directory.CreateTempSubdirectory("st4i-ff1-sitelink-").FullName;
        // GĐ3 sub-4 LC-1 review follow-up — isolated the same way as every other per-concern directory
        // above: without this, a real Policy DENY occurring anywhere in this class's requests
        // (PolicyResults.DenyAsync now resolves IAlarmStore and raises an alarm) would resolve AlarmStore
        // against the REAL %ProgramData%\ST4I\sim\alarms\alarms.db instead of a throwaway temp dir.
        var alarmsDir = Directory.CreateTempSubdirectory("st4i-ff1-alarms-").FullName;
        // GĐ3 closeout WI-3 — without this, every WebApplicationFactory<Program> boot below (UNS defaults
        // ON) has Program.cs construct a REAL BridgeSpool against %ProgramData%\ST4I\sim\bridge-spool\.
        var bridgeSpoolDir = Directory.CreateTempSubdirectory("st4i-ff1-bridgespool-").FullName;

        await EnvLock.WaitAsync().ConfigureAwait(false);
        var prevSecurityDir = Environment.GetEnvironmentVariable("ST4I_SECURITY_DIR");
        var prevDemoEnabled = Environment.GetEnvironmentVariable("ST4I_DEMO_ENABLED");
        var prevHistorianDir = Environment.GetEnvironmentVariable("ST4I_HISTORIAN_DIR");
        var prevWalDir = Environment.GetEnvironmentVariable("ST4I_WAL_DIR");
        var prevEnvironment = Environment.GetEnvironmentVariable("ASPNETCORE_ENVIRONMENT");
        var prevServerUrl = Environment.GetEnvironmentVariable("ST4I_SERVER_URL");
        var prevMachineCode = Environment.GetEnvironmentVariable("ST4I_MACHINE_CODE");
        var prevVerifyTls = Environment.GetEnvironmentVariable("ST4I_VERIFY_TLS");
        var prevSettingsDir = Environment.GetEnvironmentVariable(FleetSettingsStore.EnvVarDir);
        var prevIdentityDir = Environment.GetEnvironmentVariable("ST4I_IDENTITY_DIR");
        var prevSiteLinkDir = Environment.GetEnvironmentVariable("ST4I_SITELINK_DIR");
        var prevAlarmsDir = Environment.GetEnvironmentVariable("ST4I_ALARMS_DIR");
        var prevBridgeSpoolDir = Environment.GetEnvironmentVariable("ST4I_BRIDGE_SPOOL_DIR");
        try
        {
            Environment.SetEnvironmentVariable("ST4I_SECURITY_DIR", securityDir);
            Environment.SetEnvironmentVariable("ST4I_DEMO_ENABLED", "true");
            Environment.SetEnvironmentVariable("ST4I_HISTORIAN_DIR", historianDir);
            Environment.SetEnvironmentVariable("ST4I_WAL_DIR", walDir);
            Environment.SetEnvironmentVariable("ASPNETCORE_ENVIRONMENT", "Production");
            Environment.SetEnvironmentVariable("ST4I_SERVER_URL", overrides.ServerUrl);
            Environment.SetEnvironmentVariable("ST4I_MACHINE_CODE", overrides.MachineCode);
            Environment.SetEnvironmentVariable("ST4I_VERIFY_TLS", overrides.VerifyTlsRaw);
            Environment.SetEnvironmentVariable(FleetSettingsStore.EnvVarDir, overrides.SettingsDir);
            Environment.SetEnvironmentVariable("ST4I_IDENTITY_DIR", identityDir);
            Environment.SetEnvironmentVariable("ST4I_SITELINK_DIR", siteLinkDir);
            Environment.SetEnvironmentVariable("ST4I_ALARMS_DIR", alarmsDir);
            Environment.SetEnvironmentVariable("ST4I_BRIDGE_SPOOL_DIR", bridgeSpoolDir);

            var factory = new WebApplicationFactory<Program>();
            _ = factory.Server; // force the host to build NOW, while the env vars above are still set.
            return factory;
        }
        finally
        {
            Environment.SetEnvironmentVariable("ST4I_SECURITY_DIR", prevSecurityDir);
            Environment.SetEnvironmentVariable("ST4I_DEMO_ENABLED", prevDemoEnabled);
            Environment.SetEnvironmentVariable("ST4I_HISTORIAN_DIR", prevHistorianDir);
            Environment.SetEnvironmentVariable("ST4I_WAL_DIR", prevWalDir);
            Environment.SetEnvironmentVariable("ASPNETCORE_ENVIRONMENT", prevEnvironment);
            Environment.SetEnvironmentVariable("ST4I_SERVER_URL", prevServerUrl);
            Environment.SetEnvironmentVariable("ST4I_MACHINE_CODE", prevMachineCode);
            Environment.SetEnvironmentVariable("ST4I_VERIFY_TLS", prevVerifyTls);
            Environment.SetEnvironmentVariable(FleetSettingsStore.EnvVarDir, prevSettingsDir);
            Environment.SetEnvironmentVariable("ST4I_IDENTITY_DIR", prevIdentityDir);
            Environment.SetEnvironmentVariable("ST4I_SITELINK_DIR", prevSiteLinkDir);
            Environment.SetEnvironmentVariable("ST4I_ALARMS_DIR", prevAlarmsDir);
            Environment.SetEnvironmentVariable("ST4I_BRIDGE_SPOOL_DIR", prevBridgeSpoolDir);
            EnvLock.Release();
        }
    }

    private static string TempSettingsDir() => Directory.CreateTempSubdirectory("st4i-ff1-settings-").FullName;

    [Fact]
    public async Task PutSettings_ThenRestart_PersistsAcrossRestart()
    {
        var settingsDir = TempSettingsDir();
        var machineCode = "FF1-RESTART-" + Guid.NewGuid().ToString("N")[..8];

        await using (var factory1 = await CreateFactoryAsync(new EnvOverrides(null, null, null, settingsDir)))
        {
            using var client1 = factory1.CreateClient(new WebApplicationFactoryClientOptions { HandleCookies = true });
            using var putResponse = await client1.PutAsJsonAsync("/v1/settings", new
            {
                serverUrl = "https://ff1-restart.example.test:9443",
                verifyTls = false,
                machineCode,
            }, JsonOptions);
            Assert.Equal(HttpStatusCode.OK, putResponse.StatusCode);
        }

        // A fresh factory (fresh FleetHost, fresh everything EXCEPT settingsDir) simulates a real process
        // restart — no ST4I_SERVER_URL/MACHINE_CODE/VERIFY_TLS env vars set this time, so if the value
        // survived it can only be because fleet-settings.json (not the env floor) supplied it.
        await using var factory2 = await CreateFactoryAsync(new EnvOverrides(null, null, null, settingsDir));
        using var client2 = factory2.CreateClient(new WebApplicationFactoryClientOptions { HandleCookies = true });
        using var response = await client2.GetAsync("/v1/settings");
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);

        var settings = await response.Content.ReadFromJsonAsync<SettingsDto>(JsonOptions);
        Assert.NotNull(settings);
        Assert.Equal("https://ff1-restart.example.test:9443", settings!.ServerUrl);
        Assert.Equal(machineCode, settings.MachineCode);
        Assert.False(settings.VerifyTls);
    }

    [Fact]
    public async Task NoPersistedFile_EnvVarsAlone_StillSeedInitialSettings()
    {
        var settingsDir = TempSettingsDir(); // empty — no fleet-settings.json written yet
        var machineCode = "FF1-ENVONLY-" + Guid.NewGuid().ToString("N")[..8];

        await using var factory = await CreateFactoryAsync(new EnvOverrides(
            "https://ff1-env-only.example.test", machineCode, "false", settingsDir));
        using var client = factory.CreateClient(new WebApplicationFactoryClientOptions { HandleCookies = true });

        using var response = await client.GetAsync("/v1/settings");
        var settings = await response.Content.ReadFromJsonAsync<SettingsDto>(JsonOptions);
        Assert.NotNull(settings);
        Assert.Equal("https://ff1-env-only.example.test", settings!.ServerUrl);
        Assert.Equal(machineCode, settings.MachineCode);
        Assert.False(settings.VerifyTls);

        // The env-seeded boot itself goes through FleetHost.UpdateSettings, which always persists any
        // change it makes — so fleet-settings.json must now exist too, even though nothing wrote it
        // explicitly via PUT this time. Read it back through a SEPARATE FleetSettingsStore instance
        // pointed at the same directory (not the factory's own DI instance) to prove it's really on disk.
        var persisted = new FleetSettingsStore(settingsDir).Load();
        Assert.NotNull(persisted);
        Assert.Equal("https://ff1-env-only.example.test", persisted!.ServerUrl);
        Assert.Equal(machineCode, persisted.MachineCode);
        Assert.False(persisted.VerifyTls);
    }

    [Fact]
    public async Task PersistedFile_TakesPrecedenceOver_DifferentEnvVars()
    {
        var settingsDir = TempSettingsDir();
        var fileMachineCode = "FF1-FILE-WINS-" + Guid.NewGuid().ToString("N")[..8];

        // Seed a persisted file with one set of values (A) via a real PUT, same as the restart test.
        await using (var factory1 = await CreateFactoryAsync(new EnvOverrides(null, null, null, settingsDir)))
        {
            using var client1 = factory1.CreateClient(new WebApplicationFactoryClientOptions { HandleCookies = true });
            using var putResponse = await client1.PutAsJsonAsync("/v1/settings", new
            {
                serverUrl = "https://ff1-file-wins.example.test",
                verifyTls = false,
                machineCode = fileMachineCode,
            }, JsonOptions);
            Assert.Equal(HttpStatusCode.OK, putResponse.StatusCode);
        }

        // Boot a SECOND factory pointed at the SAME settingsDir, but this time with DIFFERENT env vars
        // (B) set too. If env ever won over the persisted file, GET /v1/settings below would report B.
        await using var factory2 = await CreateFactoryAsync(new EnvOverrides(
            "https://should-not-win.example.test", "FF1-SHOULD-NOT-WIN", "true", settingsDir));
        using var client2 = factory2.CreateClient(new WebApplicationFactoryClientOptions { HandleCookies = true });
        using var response = await client2.GetAsync("/v1/settings");

        var settings = await response.Content.ReadFromJsonAsync<SettingsDto>(JsonOptions);
        Assert.NotNull(settings);
        Assert.Equal("https://ff1-file-wins.example.test", settings!.ServerUrl); // A, not B
        Assert.Equal(fileMachineCode, settings.MachineCode);
        Assert.False(settings.VerifyTls);
    }
}
