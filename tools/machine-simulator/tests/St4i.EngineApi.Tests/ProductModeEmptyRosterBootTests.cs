using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using System.Text.Json.Serialization;
using Microsoft.AspNetCore.Identity;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.Extensions.DependencyInjection;
using St4i.EdgeCore.Models;
using St4i.EngineApi.Auth;
using St4i.EngineApi.Fleet;
using St4i.EngineApi.Tests.Auth;
using Xunit;

namespace St4i.EngineApi.Tests;

/// <summary>
/// SM-3 fix round 1 (.superpowers/sdd/2026-07-29-dotA-single-machine-sellable-blueprint/task-3-brief.md,
/// review IMPORTANT 2) — the single most safety-critical claim in the task-3 report was previously only
/// verified by a one-off manual browser pass: that the REAL <c>Program.cs</c> composition root does not
/// crash in genuine product mode (<c>ST4I_DEMO_ENABLED</c> unset) with a fresh, empty roster, and reports
/// it honestly. This is exactly what <c>ConnectorEndpointsTests.CreateFactoryAsync</c> (GP-5) already
/// proved reachable for a DIFFERENT endpoint — same env-var-isolation shape, mirrored here rather than
/// shared (this codebase's own established convention: <c>LiveSettingsEnvVarTests</c>/
/// <c>ConnectorEndpointsTests</c> each keep an independent, file-local copy of this helper).
///
/// Why this matters specifically for THIS task: before the <c>FleetHost.DefaultServerUrl</c> fix
/// (placeholder "http://localhost:5000" -&gt; "") and the <c>LiveTransport.ForMachine</c> substitution
/// guard, a fresh product install with nothing ever configured would have thrown
/// <c>St4iConfigException</c> ("serverUrl là bắt buộc") straight out of the vendored SDK's ctor, during
/// the EAGER <c>LiveTransport</c> DI registration in <c>Program.cs</c> — which runs unconditionally,
/// transitively, the moment anything first resolves <c>FleetHost</c> (see this class's constructor
/// chain: <c>FleetHost</c> -&gt; <c>TransportCoordinator</c> -&gt; <c>LiveTransport</c>). Booting the REAL
/// composition root (not just constructing <see cref="FleetHost"/> directly, the way
/// <c>FleetHostSettingsPersistenceTests</c> does) is what actually exercises that full chain end to end.
/// </summary>
[Collection(SecurityEnvVarTests.CollectionName)]
public sealed class ProductModeEmptyRosterBootTests
{
    private static readonly SemaphoreSlim EnvLock = new(1, 1);
    private static readonly JsonSerializerOptions JsonOptions = new(JsonSerializerDefaults.Web)
    {
        Converters = { new JsonStringEnumConverter() },
    };

    /// <summary>Same env-var-isolation shape as <c>ConnectorEndpointsTests.CreateFactoryAsync</c>,
    /// including its defining choice: <c>ST4I_DEMO_ENABLED</c> is explicitly set to <see langword="null"/>
    /// (unset), not merely left alone — a genuine product/Live-mode boot, never Demo's fabricated
    /// 11-machine fleet, and no <c>fleet.json</c>/<c>--fleet</c> path involved either (product mode
    /// ignores <c>fleet.json</c> outright per SM-1 — see <c>FleetHost.LoadFleet</c>'s own remarks).</summary>
    private static async Task<WebApplicationFactory<Program>> CreateFactoryAsync()
    {
        var securityDir = Directory.CreateTempSubdirectory("st4i-empty-roster-boot-security-").FullName;
        var historianDir = Directory.CreateTempSubdirectory("st4i-empty-roster-boot-historian-").FullName;
        var walDir = Directory.CreateTempSubdirectory("st4i-empty-roster-boot-wal-").FullName;
        var settingsDir = Directory.CreateTempSubdirectory("st4i-empty-roster-boot-settings-").FullName;
        var assetsDir = Directory.CreateTempSubdirectory("st4i-empty-roster-boot-assets-").FullName;
        var identityDir = Directory.CreateTempSubdirectory("st4i-empty-roster-boot-identity-").FullName;
        var siteLinkDir = Directory.CreateTempSubdirectory("st4i-empty-roster-boot-sitelink-").FullName;
        var alarmsDir = Directory.CreateTempSubdirectory("st4i-empty-roster-boot-alarms-").FullName;
        var bridgeSpoolDir = Directory.CreateTempSubdirectory("st4i-empty-roster-boot-bridgespool-").FullName;
        var connectorConfigDir = Directory.CreateTempSubdirectory("st4i-empty-roster-boot-connectorconfig-").FullName;

        await EnvLock.WaitAsync().ConfigureAwait(false);
        var prevSecurityDir = Environment.GetEnvironmentVariable("ST4I_SECURITY_DIR");
        var prevDemoEnabled = Environment.GetEnvironmentVariable("ST4I_DEMO_ENABLED");
        var prevHistorianDir = Environment.GetEnvironmentVariable("ST4I_HISTORIAN_DIR");
        var prevWalDir = Environment.GetEnvironmentVariable("ST4I_WAL_DIR");
        var prevSettingsDir = Environment.GetEnvironmentVariable("ST4I_SETTINGS_DIR");
        var prevAssetsDir = Environment.GetEnvironmentVariable("ST4I_ASSETS_DIR");
        var prevIdentityDir = Environment.GetEnvironmentVariable("ST4I_IDENTITY_DIR");
        var prevSiteLinkDir = Environment.GetEnvironmentVariable("ST4I_SITELINK_DIR");
        var prevAlarmsDir = Environment.GetEnvironmentVariable("ST4I_ALARMS_DIR");
        var prevBridgeSpoolDir = Environment.GetEnvironmentVariable("ST4I_BRIDGE_SPOOL_DIR");
        var prevConnectorConfigDir = Environment.GetEnvironmentVariable("ST4I_CONNECTOR_CONFIG_DIR");
        var prevEnvironment = Environment.GetEnvironmentVariable("ASPNETCORE_ENVIRONMENT");
        var prevServerUrl = Environment.GetEnvironmentVariable("ST4I_SERVER_URL");
        var prevMachineCode = Environment.GetEnvironmentVariable("ST4I_MACHINE_CODE");
        var prevVerifyTls = Environment.GetEnvironmentVariable("ST4I_VERIFY_TLS");
        try
        {
            Environment.SetEnvironmentVariable("ST4I_SECURITY_DIR", securityDir);
            Environment.SetEnvironmentVariable("ST4I_DEMO_ENABLED", null);
            Environment.SetEnvironmentVariable("ST4I_HISTORIAN_DIR", historianDir);
            Environment.SetEnvironmentVariable("ST4I_WAL_DIR", walDir);
            Environment.SetEnvironmentVariable("ST4I_SETTINGS_DIR", settingsDir);
            Environment.SetEnvironmentVariable("ST4I_ASSETS_DIR", assetsDir);
            Environment.SetEnvironmentVariable("ST4I_IDENTITY_DIR", identityDir);
            Environment.SetEnvironmentVariable("ST4I_SITELINK_DIR", siteLinkDir);
            Environment.SetEnvironmentVariable("ST4I_ALARMS_DIR", alarmsDir);
            Environment.SetEnvironmentVariable("ST4I_BRIDGE_SPOOL_DIR", bridgeSpoolDir);
            Environment.SetEnvironmentVariable("ST4I_CONNECTOR_CONFIG_DIR", connectorConfigDir);
            Environment.SetEnvironmentVariable("ASPNETCORE_ENVIRONMENT", "Production");
            // Explicitly null (never set), not merely inherited — this is the fresh-install case: no
            // operator PUT has ever happened, no env-var floor either, so FleetHost's own built-in
            // DefaultServerUrl ("") is what actually reaches LiveTransport.ForMachine.
            Environment.SetEnvironmentVariable("ST4I_SERVER_URL", null);
            Environment.SetEnvironmentVariable("ST4I_MACHINE_CODE", null);
            Environment.SetEnvironmentVariable("ST4I_VERIFY_TLS", null);

            var factory = new WebApplicationFactory<Program>();
            _ = factory.Server; // force the host to build NOW, while the env vars above are still set —
                                 // this is the line that would have thrown St4iConfigException pre-fix.
            return factory;
        }
        finally
        {
            Environment.SetEnvironmentVariable("ST4I_SECURITY_DIR", prevSecurityDir);
            Environment.SetEnvironmentVariable("ST4I_DEMO_ENABLED", prevDemoEnabled);
            Environment.SetEnvironmentVariable("ST4I_HISTORIAN_DIR", prevHistorianDir);
            Environment.SetEnvironmentVariable("ST4I_WAL_DIR", prevWalDir);
            Environment.SetEnvironmentVariable("ST4I_SETTINGS_DIR", prevSettingsDir);
            Environment.SetEnvironmentVariable("ST4I_ASSETS_DIR", prevAssetsDir);
            Environment.SetEnvironmentVariable("ST4I_IDENTITY_DIR", prevIdentityDir);
            Environment.SetEnvironmentVariable("ST4I_SITELINK_DIR", prevSiteLinkDir);
            Environment.SetEnvironmentVariable("ST4I_ALARMS_DIR", prevAlarmsDir);
            Environment.SetEnvironmentVariable("ST4I_BRIDGE_SPOOL_DIR", prevBridgeSpoolDir);
            Environment.SetEnvironmentVariable("ST4I_CONNECTOR_CONFIG_DIR", prevConnectorConfigDir);
            Environment.SetEnvironmentVariable("ASPNETCORE_ENVIRONMENT", prevEnvironment);
            Environment.SetEnvironmentVariable("ST4I_SERVER_URL", prevServerUrl);
            Environment.SetEnvironmentVariable("ST4I_MACHINE_CODE", prevMachineCode);
            Environment.SetEnvironmentVariable("ST4I_VERIFY_TLS", prevVerifyTls);
            EnvLock.Release();
        }
    }

    private static async Task CreateUserAsync(WebApplicationFactory<Program> factory, string username, string password, string role)
    {
        var userStore = factory.Services.GetRequiredService<IUserStore>();
        var hasher = new PasswordHasher<AppUser>();
        var hash = hasher.HashPassword(AppUser.Instance, password);
        await userStore.CreateAsync(username, hash, role, null, "test", CancellationToken.None).ConfigureAwait(false);
    }

    private static async Task<HttpClient> LoginAsAsync(WebApplicationFactory<Program> factory, string username, string password)
    {
        var client = factory.CreateClient(new WebApplicationFactoryClientOptions { HandleCookies = true });
        using var login = await client.PostAsJsonAsync("/v1/auth/login", new { username, password }, JsonOptions).ConfigureAwait(false);
        Assert.Equal(HttpStatusCode.OK, login.StatusCode);
        return client;
    }

    [Fact]
    public async Task FreshProductBoot_DoesNotCrash_ReportsLiveModeAndAnEmptyRoster()
    {
        await using var factory = await CreateFactoryAsync();

        // GET /v1/health is AllowAnonymous — proves the host is up AND reports Mode BEFORE any auth
        // dance, the same way a real load balancer / readiness probe would.
        using var healthClient = factory.CreateClient();
        using var health = await healthClient.GetAsync("/v1/health");
        Assert.Equal(HttpStatusCode.OK, health.StatusCode);
        var healthDto = await health.Content.ReadFromJsonAsync<HealthDto>(JsonOptions);
        Assert.NotNull(healthDto);
        Assert.True(healthDto!.Ok);
        Assert.Equal(TransportMode.Live, healthDto.Mode);

        // GET /v1/fleet requires Operator — real bootstrap-admin + create-operator + login flow, same
        // technique ConnectorEndpointsTests already established for this exact composition root.
        using (var bootstrapClient = factory.CreateClient())
        using (var bootstrap = await bootstrapClient.PostAsJsonAsync(
                   "/v1/auth/bootstrap", new { username = "empty-roster-admin", password = "AdminPass123!", displayName = (string?)null }, JsonOptions))
        {
            Assert.Equal(HttpStatusCode.OK, bootstrap.StatusCode);
        }

        await CreateUserAsync(factory, "empty-roster-operator", "OperatorPass123!", Roles.Operator);
        using var operatorClient = await LoginAsAsync(factory, "empty-roster-operator", "OperatorPass123!");

        using var fleet = await operatorClient.GetAsync("/v1/fleet");
        Assert.Equal(HttpStatusCode.OK, fleet.StatusCode);

        var snapshot = await fleet.Content.ReadFromJsonAsync<FleetSnapshotDto>(JsonOptions);
        Assert.NotNull(snapshot);
        // The actual point of this test: product mode ignores fleet.json entirely (SM-1) and there is no
        // ST4I_SERVER_URL/persisted settings floor here, so FleetHost.DefaultServerUrl’s own blank value
        // is what the engine boots with — and it boots, empty, rather than throwing.
        Assert.Empty(snapshot!.Machines);
    }
}
