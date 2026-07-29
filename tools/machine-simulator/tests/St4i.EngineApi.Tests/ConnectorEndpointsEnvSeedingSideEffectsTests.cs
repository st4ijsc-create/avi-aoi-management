using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Microsoft.AspNetCore.Identity;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.Extensions.DependencyInjection;
using St4i.EngineApi.Auth;
using St4i.EngineApi.Fleet;
using St4i.EngineApi.Tests.Auth;
using Xunit;

namespace St4i.EngineApi.Tests;

/// <summary>
/// Task B-4 (.superpowers/sdd/2026-07-29-dotB-machine-control-blueprint/task-4-brief.md) — review fix round
/// 1, Important #3: <see cref="ConnectorConfigVisibilitySeeder"/> seeds a row into the SAME
/// <see cref="ConnectorConfigStore"/> table <c>POST</c>/<c>DELETE /v1/connectors</c> and the persisted-row
/// startup loop already read from — closing the write-capability visibility gap this way (rather than a
/// second, provenance-tracking table) has real, DELIBERATELY-NOT-FIXED side effects on those existing
/// endpoints, since B-4's own brief scopes endpoint changes OUT ("Deliberately NOT in scope: ...
/// Endpoints/policy/RBAC/audit (B-6)"). Per the review's own instruction ("fix the behaviour or ... cover it
/// with tests and say so explicitly"), this file covers the two side effects that are reachable and testable
/// without a second boot-cycle simulation beyond what this project's OWN restart-survival tests
/// (<c>ConnectorEndpointsTests</c>) already do:
///
/// <list type="bullet">
/// <item><description><c>POST /v1/connectors</c> for a DIFFERENT machine of an env-var-seeded kind now 409s,
/// naming a machine code the operator never actually persisted themselves.</description></item>
/// <item><description><c>DELETE /v1/connectors/{kind}</c> succeeds against a seeded row, but the deletion does
/// NOT stick across a restart while the SAME env var stays active — the next boot's seeding pass simply
/// recreates an equivalent row, since it only ever checks "does a row already exist", not "did an operator
/// delete one before".</description></item>
/// </list>
///
/// <para><b>NOT covered here, documented instead</b> (the review's own alternative): the persisted-row
/// startup loop's own "ignored — an environment variable already configures this connector kind" warning
/// fires, every subsequent boot, about the SEEDER's OWN row — self-referential log noise. Verifying this
/// would require capturing Program.cs's <c>Console.Error</c> output across a real host boot, disproportionate
/// to what this fix is worth; the class doc comment on <see cref="ConnectorConfigVisibilitySeeder"/> and the
/// task report both name it explicitly instead.</para>
///
/// <para>A proper fix for all three is a <c>source</c> column distinguishing a seeded row from an operator's
/// own — explicitly scoped OUT of this task (no endpoint-layer changes) and left as a named follow-up.</para>
/// </summary>
[Collection(SecurityEnvVarTests.CollectionName)]
public sealed class ConnectorEndpointsEnvSeedingSideEffectsTests
{
    private static readonly SemaphoreSlim EnvLock = new(1, 1);

    private static readonly JsonSerializerOptions JsonOptions = new(JsonSerializerDefaults.Web)
    {
        Converters = { new System.Text.Json.Serialization.JsonStringEnumConverter() },
    };

    private static string ValidModbusMap(string machineCode) => $$"""
        {
          "machineCode": "{{machineCode}}",
          "unitId": 1,
          "pollIntervalMs": 50,
          "registers": [
            { "address": 0, "type": "Holding", "dataType": "UInt16", "scale": 1.0, "metric": "temperature", "unit": "C" }
          ]
        }
        """;

    /// <summary>Trimmed copy of <c>ConnectorEndpointsTests.CreateFactoryAsync</c> — kept as its own private
    /// copy rather than exposing that file's internals, so this file's addition stays fully self-contained.</summary>
    private static async Task<WebApplicationFactory<Program>> CreateFactoryAsync(
        string? connectorConfigDirOverride = null, string? modbusEnvMapPath = null)
    {
        var securityDir = Directory.CreateTempSubdirectory("st4i-connectors-envseed-security-").FullName;
        var historianDir = Directory.CreateTempSubdirectory("st4i-connectors-envseed-historian-").FullName;
        var walDir = Directory.CreateTempSubdirectory("st4i-connectors-envseed-wal-").FullName;
        var settingsDir = Directory.CreateTempSubdirectory("st4i-connectors-envseed-settings-").FullName;
        var assetsDir = Directory.CreateTempSubdirectory("st4i-connectors-envseed-assets-").FullName;
        var identityDir = Directory.CreateTempSubdirectory("st4i-connectors-envseed-identity-").FullName;
        var siteLinkDir = Directory.CreateTempSubdirectory("st4i-connectors-envseed-sitelink-").FullName;
        var alarmsDir = Directory.CreateTempSubdirectory("st4i-connectors-envseed-alarms-").FullName;
        var bridgeSpoolDir = Directory.CreateTempSubdirectory("st4i-connectors-envseed-bridgespool-").FullName;
        var connectorConfigDir = connectorConfigDirOverride
            ?? Directory.CreateTempSubdirectory("st4i-connectors-envseed-connectorconfig-").FullName;

        await EnvLock.WaitAsync().ConfigureAwait(false);
        var prevSecurityDir = Environment.GetEnvironmentVariable("ST4I_SECURITY_DIR");
        var prevHistorianDir = Environment.GetEnvironmentVariable("ST4I_HISTORIAN_DIR");
        var prevWalDir = Environment.GetEnvironmentVariable("ST4I_WAL_DIR");
        var prevSettingsDir = Environment.GetEnvironmentVariable("ST4I_SETTINGS_DIR");
        var prevAssetsDir = Environment.GetEnvironmentVariable("ST4I_ASSETS_DIR");
        var prevIdentityDir = Environment.GetEnvironmentVariable("ST4I_IDENTITY_DIR");
        var prevSiteLinkDir = Environment.GetEnvironmentVariable("ST4I_SITELINK_DIR");
        var prevAlarmsDir = Environment.GetEnvironmentVariable("ST4I_ALARMS_DIR");
        var prevBridgeSpoolDir = Environment.GetEnvironmentVariable("ST4I_BRIDGE_SPOOL_DIR");
        var prevConnectorConfigDir = Environment.GetEnvironmentVariable("ST4I_CONNECTOR_CONFIG_DIR");
        var prevModbusEnabled = Environment.GetEnvironmentVariable("ST4I_MODBUS_ENABLED");
        var prevModbusMap = Environment.GetEnvironmentVariable("ST4I_MODBUS_MAP");
        var prevEnvironment = Environment.GetEnvironmentVariable("ASPNETCORE_ENVIRONMENT");
        try
        {
            Environment.SetEnvironmentVariable("ST4I_SECURITY_DIR", securityDir);
            Environment.SetEnvironmentVariable("ST4I_HISTORIAN_DIR", historianDir);
            Environment.SetEnvironmentVariable("ST4I_WAL_DIR", walDir);
            Environment.SetEnvironmentVariable("ST4I_SETTINGS_DIR", settingsDir);
            Environment.SetEnvironmentVariable("ST4I_ASSETS_DIR", assetsDir);
            Environment.SetEnvironmentVariable("ST4I_IDENTITY_DIR", identityDir);
            Environment.SetEnvironmentVariable("ST4I_SITELINK_DIR", siteLinkDir);
            Environment.SetEnvironmentVariable("ST4I_ALARMS_DIR", alarmsDir);
            Environment.SetEnvironmentVariable("ST4I_BRIDGE_SPOOL_DIR", bridgeSpoolDir);
            Environment.SetEnvironmentVariable("ST4I_CONNECTOR_CONFIG_DIR", connectorConfigDir);
            Environment.SetEnvironmentVariable("ST4I_MODBUS_ENABLED", modbusEnvMapPath is null ? null : "true");
            Environment.SetEnvironmentVariable("ST4I_MODBUS_MAP", modbusEnvMapPath);
            Environment.SetEnvironmentVariable("ASPNETCORE_ENVIRONMENT", "Production");

            var factory = new WebApplicationFactory<Program>();
            _ = factory.Server; // force the host to build NOW, while the env vars above are still set.
            return factory;
        }
        finally
        {
            Environment.SetEnvironmentVariable("ST4I_SECURITY_DIR", prevSecurityDir);
            Environment.SetEnvironmentVariable("ST4I_HISTORIAN_DIR", prevHistorianDir);
            Environment.SetEnvironmentVariable("ST4I_WAL_DIR", prevWalDir);
            Environment.SetEnvironmentVariable("ST4I_SETTINGS_DIR", prevSettingsDir);
            Environment.SetEnvironmentVariable("ST4I_ASSETS_DIR", prevAssetsDir);
            Environment.SetEnvironmentVariable("ST4I_IDENTITY_DIR", prevIdentityDir);
            Environment.SetEnvironmentVariable("ST4I_SITELINK_DIR", prevSiteLinkDir);
            Environment.SetEnvironmentVariable("ST4I_ALARMS_DIR", prevAlarmsDir);
            Environment.SetEnvironmentVariable("ST4I_BRIDGE_SPOOL_DIR", prevBridgeSpoolDir);
            Environment.SetEnvironmentVariable("ST4I_CONNECTOR_CONFIG_DIR", prevConnectorConfigDir);
            Environment.SetEnvironmentVariable("ST4I_MODBUS_ENABLED", prevModbusEnabled);
            Environment.SetEnvironmentVariable("ST4I_MODBUS_MAP", prevModbusMap);
            Environment.SetEnvironmentVariable("ASPNETCORE_ENVIRONMENT", prevEnvironment);
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

    private static async Task<(HttpClient Admin, HttpClient Engineer)> SetUpAdminAndEngineerAsync(WebApplicationFactory<Program> factory)
    {
        using (var bootstrapClient = factory.CreateClient())
        using (var bootstrap = await bootstrapClient.PostAsJsonAsync(
                   "/v1/auth/bootstrap", new { username = "envseed-admin", password = "AdminPass123!", displayName = (string?)null }, JsonOptions))
        {
            Assert.Equal(HttpStatusCode.OK, bootstrap.StatusCode);
        }

        await CreateUserAsync(factory, "envseed-engineer", "EngineerPass123!", Roles.Engineer);

        var admin = await LoginAsAsync(factory, "envseed-admin", "AdminPass123!");
        var engineer = await LoginAsAsync(factory, "envseed-engineer", "EngineerPass123!");
        return (admin, engineer);
    }

    [Fact]
    public async Task PostConnector_ForADifferentMachine_409sNamingTheSeededMachine_OperatorNeverPersistedIt()
    {
        var envCode = "ENVSEED-SHADOW-" + Guid.NewGuid().ToString("N")[..8];
        var envMapPath = Path.Combine(Path.GetTempPath(), $"st4i-envseed-map-{Guid.NewGuid():N}.json");
        await File.WriteAllTextAsync(envMapPath, ValidModbusMap(envCode));
        try
        {
            await using var factory = await CreateFactoryAsync(modbusEnvMapPath: envMapPath);
            var (admin, engineer) = await SetUpAdminAndEngineerAsync(factory);
            using (admin) using (engineer)
            {
                // Sanity: the seeding pass DID create a row for the env-var machine — never explicitly saved
                // by anyone through this endpoint.
                using var configuredBefore = await engineer.GetAsync("/v1/connectors/configured");
                var before = await configuredBefore.Content.ReadFromJsonAsync<List<ConnectorConfigSummary>>(JsonOptions);
                Assert.Contains(before!, s => s.Kind == "Modbus" && s.MachineCode == envCode);

                // The load-bearing assertion (Fix round 1, Important #3): an Engineer trying to configure a
                // genuinely DIFFERENT Modbus machine through the normal UI path is blocked — 409, naming the
                // ENV-SEEDED machine code as "already configured", even though no operator ever persisted it
                // through this endpoint themselves.
                var otherCode = "ENVSEED-OTHER-" + Guid.NewGuid().ToString("N")[..8];
                using var create = await engineer.PostAsJsonAsync(
                    "/v1/connectors",
                    new ConnectorCreateRequest("Modbus", "10.0.0.99", 502, ValidModbusMap(otherCode)),
                    JsonOptions);

                Assert.Equal(HttpStatusCode.Conflict, create.StatusCode);
                var body = await create.Content.ReadAsStringAsync();
                Assert.Contains(envCode, body, StringComparison.Ordinal);
            }
        }
        finally
        {
            File.Delete(envMapPath);
        }
    }

    [Fact]
    public async Task DeleteConnector_SucceedsAgainstASeededRow_ButDoesNotStick_NextBootWithSameEnvVarReseedsIt()
    {
        var sharedConnectorConfigDir = Directory.CreateTempSubdirectory("st4i-envseed-persistence-").FullName;
        var envCode = "ENVSEED-DELETE-" + Guid.NewGuid().ToString("N")[..8];
        var envMapPath = Path.Combine(Path.GetTempPath(), $"st4i-envseed-map-{Guid.NewGuid():N}.json");
        await File.WriteAllTextAsync(envMapPath, ValidModbusMap(envCode));
        try
        {
            // Boot 1 — seeds a row for the env-configured machine, then DELETE it.
            await using (var factory1 = await CreateFactoryAsync(connectorConfigDirOverride: sharedConnectorConfigDir, modbusEnvMapPath: envMapPath))
            {
                var (admin1, engineer1) = await SetUpAdminAndEngineerAsync(factory1);
                using (admin1) using (engineer1)
                {
                    using var configuredBefore = await engineer1.GetAsync("/v1/connectors/configured");
                    var before = await configuredBefore.Content.ReadFromJsonAsync<List<ConnectorConfigSummary>>(JsonOptions);
                    Assert.Contains(before!, s => s.Kind == "Modbus" && s.MachineCode == envCode);

                    // DELETE succeeds (200) against a row the operator never created themselves.
                    using var delete = await engineer1.DeleteAsync("/v1/connectors/Modbus");
                    Assert.Equal(HttpStatusCode.OK, delete.StatusCode);

                    using var configuredAfterDelete = await engineer1.GetAsync("/v1/connectors/configured");
                    var afterDelete = await configuredAfterDelete.Content.ReadFromJsonAsync<List<ConnectorConfigSummary>>(JsonOptions);
                    Assert.DoesNotContain(afterDelete!, s => s.Kind == "Modbus");
                }
            }

            // Boot 2 — SAME persisted store directory, SAME env var still active. The load-bearing assertion
            // (Fix round 1, Important #3): the DELETE above did not stick — this run's seeding pass sees NO
            // existing row (insert-only) and recreates an equivalent one, exactly as if the DELETE had never
            // happened, because seeding cannot tell "an operator deleted this on purpose" apart from "this row
            // was never seeded yet".
            await using var factory2 = await CreateFactoryAsync(connectorConfigDirOverride: sharedConnectorConfigDir, modbusEnvMapPath: envMapPath);
            var (admin2, engineer2) = await SetUpAdminAndEngineerAsync(factory2);
            using (admin2) using (engineer2)
            {
                using var configuredAfterReboot = await engineer2.GetAsync("/v1/connectors/configured");
                var afterReboot = await configuredAfterReboot.Content.ReadFromJsonAsync<List<ConnectorConfigSummary>>(JsonOptions);
                Assert.Contains(afterReboot!, s => s.Kind == "Modbus" && s.MachineCode == envCode);
            }
        }
        finally
        {
            File.Delete(envMapPath);
        }
    }
}
