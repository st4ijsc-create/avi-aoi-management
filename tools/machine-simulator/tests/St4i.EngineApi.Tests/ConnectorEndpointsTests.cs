using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Microsoft.AspNetCore.Identity;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.Extensions.DependencyInjection;
using St4i.Connector.Abstractions.Models;
using St4i.EngineApi.Auth;
using St4i.EngineApi.Endpoints;
using St4i.EngineApi.Fleet;
using St4i.EngineApi.Tests.Auth;
using Xunit;

namespace St4i.EngineApi.Tests;

/// <summary>
/// GP-5 (.superpowers/sdd/2026-07-28-wsg-plugin-connector-seam-blueprint/task-5-brief.md item 3) —
/// real-pipeline (<c>WebApplicationFactory&lt;Program&gt;</c>) check for <c>GET /v1/connectors</c>: it is
/// mapped, Operator-reachable (see <c>RbacPolicyTests.ExpectedRoutes</c> for the metadata sweep proving its
/// exact policy), and returns an empty list in a bare test boot where no connector is configured — the
/// FleetHost-level behavior (an issue actually appearing once a registered connector fails to start, and
/// never flipping <c>/v1/health</c>) is covered directly against <see cref="FleetHost"/> by
/// <c>FleetHostConnectorVisibilityTests</c>, which doesn't need a full ASP.NET boot to exercise.
/// </summary>
[Collection(SecurityEnvVarTests.CollectionName)]
public sealed class ConnectorEndpointsTests
{
    private static readonly SemaphoreSlim EnvLock = new(1, 1);

    // JsonStringEnumConverter — the server's own ConfigureHttpJsonOptions registers this too (Program.cs), so
    // an enum field (FleetTileDto.DeviceClass) round-trips as its wire string ("Automation", ...) rather than
    // this client trying to bind it back as a number and throwing.
    private static readonly JsonSerializerOptions JsonOptions = new(JsonSerializerDefaults.Web)
    {
        Converters = { new System.Text.Json.Serialization.JsonStringEnumConverter() },
    };

    /// <param name="connectorConfigDirOverride">SM-5 restart-survival tests pass the SAME directory to two
    /// successive <see cref="CreateFactoryAsync"/> calls (a fresh <see cref="WebApplicationFactory{TEntryPoint}"/>
    /// is the in-process analogue of a real process restart — same technique
    /// <c>FleetHostSettingsPersistenceTests</c> already uses at the <see cref="FleetHost"/> level). Every
    /// other test gets its own fresh temp directory, exactly like before.</param>
    /// <param name="demoEnabled">SM-5 — proves an operator-added connector is ADDITIVE to the demo roster,
    /// never a replacement for it (mirrors how <c>modbusSeedDescriptor</c>/<c>opcUaSeedDescriptor</c> already
    /// behave regardless of demo mode).</param>
    /// <param name="modbusEnvMapPath">SM-5 — when set, also enables <c>ST4I_MODBUS_ENABLED</c>/
    /// <c>ST4I_MODBUS_MAP</c> pointed at this path, proving the persisted-store layer never shadows an
    /// existing env-var-configured Modbus connector (the SAME "an established source always wins" rule
    /// <c>ConnectorsConfig.ResolveEntries</c> already applies between env vars and <c>connectors.json</c>).</param>
    private static async Task<WebApplicationFactory<Program>> CreateFactoryAsync(
        string? connectorConfigDirOverride = null, bool demoEnabled = false, string? modbusEnvMapPath = null)
    {
        var securityDir = Directory.CreateTempSubdirectory("st4i-connectors-ep-security-").FullName;
        var historianDir = Directory.CreateTempSubdirectory("st4i-connectors-ep-historian-").FullName;
        var walDir = Directory.CreateTempSubdirectory("st4i-connectors-ep-wal-").FullName;
        var settingsDir = Directory.CreateTempSubdirectory("st4i-connectors-ep-settings-").FullName;
        var assetsDir = Directory.CreateTempSubdirectory("st4i-connectors-ep-assets-").FullName;
        var identityDir = Directory.CreateTempSubdirectory("st4i-connectors-ep-identity-").FullName;
        var siteLinkDir = Directory.CreateTempSubdirectory("st4i-connectors-ep-sitelink-").FullName;
        var alarmsDir = Directory.CreateTempSubdirectory("st4i-connectors-ep-alarms-").FullName;
        var bridgeSpoolDir = Directory.CreateTempSubdirectory("st4i-connectors-ep-bridgespool-").FullName;
        var connectorConfigDir = connectorConfigDirOverride
            ?? Directory.CreateTempSubdirectory("st4i-connectors-ep-connectorconfig-").FullName;

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
        var prevModbusEnabled = Environment.GetEnvironmentVariable("ST4I_MODBUS_ENABLED");
        var prevModbusMap = Environment.GetEnvironmentVariable("ST4I_MODBUS_MAP");
        var prevEnvironment = Environment.GetEnvironmentVariable("ASPNETCORE_ENVIRONMENT");
        try
        {
            Environment.SetEnvironmentVariable("ST4I_SECURITY_DIR", securityDir);
            Environment.SetEnvironmentVariable("ST4I_DEMO_ENABLED", demoEnabled ? "true" : null);
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

    [Fact]
    public async Task Operator_GetsConnectors_200_EmptyByDefault_NoConnectorConfigured()
    {
        await using var factory = await CreateFactoryAsync();

        using (var bootstrapClient = factory.CreateClient())
        using (var bootstrap = await bootstrapClient.PostAsJsonAsync(
                   "/v1/auth/bootstrap", new { username = "conn-admin", password = "AdminPass123!", displayName = (string?)null }, JsonOptions))
        {
            Assert.Equal(HttpStatusCode.OK, bootstrap.StatusCode);
        }

        await CreateUserAsync(factory, "conn-operator", "OperatorPass123!", Roles.Operator);
        using var operatorClient = await LoginAsAsync(factory, "conn-operator", "OperatorPass123!");

        using var response = await operatorClient.GetAsync("/v1/connectors");
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);

        var issues = await response.Content.ReadFromJsonAsync<List<ConnectorStatusDto>>(JsonOptions);
        Assert.NotNull(issues);
        // Env-gated Modbus/OPC-UA default OFF, and this test's temp dirs never seed a connectors.json entry
        // — a bare boot has nothing configured to report as not-started.
        Assert.Empty(issues!);
    }

    // ─────────────────────────────────────────────────────────────────────
    // SM-5 (.superpowers/sdd/2026-07-29-dotA-single-machine-sellable-blueprint/task-5-brief.md) —
    // the write path: POST/DELETE /v1/connectors, GET /v1/connectors/configured, POST /v1/connectors/test.
    // ─────────────────────────────────────────────────────────────────────

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

    private static string ValidOpcUaMap(string machineCode, string? username = null, string? password = null) => $$"""
        {
          "machineCode": "{{machineCode}}",
          "endpointUrl": "opc.tcp://127.0.0.1:4840",
          "pollIntervalMs": 50,
          "username": {{(username is null ? "null" : $"\"{username}\"")}},
          "password": {{(password is null ? "null" : $"\"{password}\"")}},
          "nodes": [
            { "nodeId": "ns=2;s=Temperature", "metric": "temperature", "unit": "C" }
          ]
        }
        """;

    private static async Task<(HttpClient Admin, HttpClient Engineer, HttpClient Operator)> SetUpAllRolesAsync(WebApplicationFactory<Program> factory)
    {
        using (var bootstrapClient = factory.CreateClient())
        using (var bootstrap = await bootstrapClient.PostAsJsonAsync(
                   "/v1/auth/bootstrap", new { username = "conn-admin", password = "AdminPass123!", displayName = (string?)null }, JsonOptions))
        {
            Assert.Equal(HttpStatusCode.OK, bootstrap.StatusCode);
        }

        await CreateUserAsync(factory, "conn-engineer", "EngineerPass123!", Roles.Engineer);
        await CreateUserAsync(factory, "conn-operator", "OperatorPass123!", Roles.Operator);

        var admin = await LoginAsAsync(factory, "conn-admin", "AdminPass123!");
        var engineer = await LoginAsAsync(factory, "conn-engineer", "EngineerPass123!");
        var operatorClient = await LoginAsAsync(factory, "conn-operator", "OperatorPass123!");
        return (admin, engineer, operatorClient);
    }

    [Fact]
    public async Task Engineer_AddsModbusConnector_Persisted_AppearsInRoster_ClassifiedReal()
    {
        await using var factory = await CreateFactoryAsync();
        var (admin, engineer, operatorClient) = await SetUpAllRolesAsync(factory);
        using (admin) using (engineer) using (operatorClient)
        {
            var code = "SM5-MODBUS-" + Guid.NewGuid().ToString("N")[..8];
            using var create = await engineer.PostAsJsonAsync(
                "/v1/connectors",
                new ConnectorCreateRequest("Modbus", "10.20.30.40", 502, ValidModbusMap(code)),
                JsonOptions);
            Assert.Equal(HttpStatusCode.OK, create.StatusCode);
            var result = await create.Content.ReadFromJsonAsync<ConnectorCreateResultDto>(JsonOptions);
            Assert.NotNull(result);
            Assert.True(result!.AppliedLive);
            Assert.Equal("Modbus", result.Config.Kind);
            Assert.Equal(code, result.Config.MachineCode);
            Assert.Equal("10.20.30.40", result.Config.Host);
            Assert.Equal(502, result.Config.Port);

            // Appears in the roster, classified REAL (SM-2's provenance mechanism — DriverKind is Modbus,
            // never Simulated).
            using var fleet = await operatorClient.GetAsync("/v1/fleet");
            Assert.Equal(HttpStatusCode.OK, fleet.StatusCode);
            var snapshot = await fleet.Content.ReadFromJsonAsync<FleetSnapshotDto>(JsonOptions);
            var tile = Assert.Single(snapshot!.Machines, m => m.Code == code);
            Assert.Equal(DriverKinds.Modbus, tile.DriverKind);
            Assert.False(DriverKinds.IsFabricated(tile.DriverKind));

            // Configured-list projection (Operator-visible) shows it too, host/port intact.
            using var configured = await operatorClient.GetAsync("/v1/connectors/configured");
            var summaries = await configured.Content.ReadFromJsonAsync<List<ConnectorConfigSummary>>(JsonOptions);
            Assert.Contains(summaries!, s => s.Kind == "Modbus" && s.MachineCode == code && s.Host == "10.20.30.40" && s.Port == 502);
        }
    }

    [Fact]
    public async Task Engineer_AddsOpcUaConnector_Persisted_AppearsInRoster_ClassifiedReal_NoHostPortStored()
    {
        await using var factory = await CreateFactoryAsync();
        var (admin, engineer, operatorClient) = await SetUpAllRolesAsync(factory);
        using (admin) using (engineer) using (operatorClient)
        {
            var code = "SM5-OPCUA-" + Guid.NewGuid().ToString("N")[..8];
            using var create = await engineer.PostAsJsonAsync(
                "/v1/connectors",
                new ConnectorCreateRequest("OpcUa", null, null, ValidOpcUaMap(code)),
                JsonOptions);
            Assert.Equal(HttpStatusCode.OK, create.StatusCode);
            var result = await create.Content.ReadFromJsonAsync<ConnectorCreateResultDto>(JsonOptions);
            Assert.NotNull(result);
            Assert.Equal("OpcUa", result!.Config.Kind);
            Assert.Null(result.Config.Host);
            Assert.Null(result.Config.Port);

            using var fleet = await operatorClient.GetAsync("/v1/fleet");
            var snapshot = await fleet.Content.ReadFromJsonAsync<FleetSnapshotDto>(JsonOptions);
            var tile = Assert.Single(snapshot!.Machines, m => m.Code == code);
            Assert.Equal(DriverKinds.OpcUa, tile.DriverKind);
            Assert.False(DriverKinds.IsFabricated(tile.DriverKind));
        }
    }

    [Fact]
    public async Task Engineer_AddsMalformedMap_400_NothingPersisted_HostUnaffected()
    {
        await using var factory = await CreateFactoryAsync();
        var (admin, engineer, operatorClient) = await SetUpAllRolesAsync(factory);
        using (admin) using (engineer) using (operatorClient)
        {
            using var create = await engineer.PostAsJsonAsync(
                "/v1/connectors",
                new ConnectorCreateRequest("Modbus", "10.20.30.40", 502, "{ not valid json"),
                JsonOptions);
            Assert.Equal(HttpStatusCode.BadRequest, create.StatusCode);
            var error = await create.Content.ReadFromJsonAsync<ApiErrorDto>(JsonOptions);
            Assert.False(string.IsNullOrWhiteSpace(error?.Error));

            using var configured = await operatorClient.GetAsync("/v1/connectors/configured");
            var summaries = await configured.Content.ReadFromJsonAsync<List<ConnectorConfigSummary>>(JsonOptions);
            Assert.Empty(summaries!);

            using var fleet = await operatorClient.GetAsync("/v1/fleet");
            Assert.Equal(HttpStatusCode.OK, fleet.StatusCode); // host itself is unaffected — still answers normally.
        }
    }

    [Fact]
    public async Task Engineer_AddsModbus_MissingHost_400_NothingPersisted()
    {
        await using var factory = await CreateFactoryAsync();
        var (admin, engineer, operatorClient) = await SetUpAllRolesAsync(factory);
        using (admin) using (engineer) using (operatorClient)
        {
            using var create = await engineer.PostAsJsonAsync(
                "/v1/connectors",
                new ConnectorCreateRequest("Modbus", null, null, ValidModbusMap("SM5-SHOULD-NOT-EXIST")),
                JsonOptions);
            Assert.Equal(HttpStatusCode.BadRequest, create.StatusCode);

            using var configured = await operatorClient.GetAsync("/v1/connectors/configured");
            var summaries = await configured.Content.ReadFromJsonAsync<List<ConnectorConfigSummary>>(JsonOptions);
            Assert.Empty(summaries!);
        }
    }

    [Fact]
    public async Task Operator_CannotCreateOrDeleteOrTestConnectors_403_ButCanListConfigured()
    {
        await using var factory = await CreateFactoryAsync();
        var (admin, engineer, operatorClient) = await SetUpAllRolesAsync(factory);
        using (admin) using (engineer) using (operatorClient)
        {
            using var create = await operatorClient.PostAsJsonAsync(
                "/v1/connectors", new ConnectorCreateRequest("Modbus", "10.0.0.1", 502, ValidModbusMap("SM5-RBAC")), JsonOptions);
            Assert.Equal(HttpStatusCode.Forbidden, create.StatusCode);

            using var delete = await operatorClient.DeleteAsync("/v1/connectors/Modbus");
            Assert.Equal(HttpStatusCode.Forbidden, delete.StatusCode);

            using var test = await operatorClient.PostAsJsonAsync(
                "/v1/connectors/test", new ConnectorTestRequest("Modbus", "10.0.0.1", 502, ValidModbusMap("SM5-RBAC")), JsonOptions);
            Assert.Equal(HttpStatusCode.Forbidden, test.StatusCode);

            using var list = await operatorClient.GetAsync("/v1/connectors/configured");
            Assert.Equal(HttpStatusCode.OK, list.StatusCode);
        }
    }

    [Fact]
    public async Task CredentialsNeverAppearInAnyGetResponse()
    {
        await using var factory = await CreateFactoryAsync();
        var (admin, engineer, operatorClient) = await SetUpAllRolesAsync(factory);
        using (admin) using (engineer) using (operatorClient)
        {
            var code = "SM5-CREDS-" + Guid.NewGuid().ToString("N")[..8];
            const string secretPassword = "sup3r-secret-device-password";
            using var create = await engineer.PostAsJsonAsync(
                "/v1/connectors",
                new ConnectorCreateRequest("OpcUa", null, null, ValidOpcUaMap(code, username: "admin", password: secretPassword)),
                JsonOptions);
            Assert.Equal(HttpStatusCode.OK, create.StatusCode);
            var createBody = await create.Content.ReadAsStringAsync();
            Assert.DoesNotContain(secretPassword, createBody);

            using var configured = await operatorClient.GetAsync("/v1/connectors/configured");
            var configuredBody = await configured.Content.ReadAsStringAsync();
            Assert.DoesNotContain(secretPassword, configuredBody);

            using var connectors = await operatorClient.GetAsync("/v1/connectors");
            var connectorsBody = await connectors.Content.ReadAsStringAsync();
            Assert.DoesNotContain(secretPassword, connectorsBody);
        }
    }

    [Fact]
    public async Task Engineer_DeletesConnector_RemovesFromConfiguredList_ButRosterMemberRemains_NoUnregister()
    {
        await using var factory = await CreateFactoryAsync();
        var (admin, engineer, operatorClient) = await SetUpAllRolesAsync(factory);
        using (admin) using (engineer) using (operatorClient)
        {
            var code = "SM5-DELETE-" + Guid.NewGuid().ToString("N")[..8];
            using (await engineer.PostAsJsonAsync("/v1/connectors", new ConnectorCreateRequest("Modbus", "10.0.0.9", 502, ValidModbusMap(code)), JsonOptions))
            {
            }

            using var delete = await engineer.DeleteAsync("/v1/connectors/Modbus");
            Assert.Equal(HttpStatusCode.OK, delete.StatusCode);
            var deleteResult = await delete.Content.ReadFromJsonAsync<ConnectorDeleteResultDto>(JsonOptions);
            Assert.Equal("Modbus", deleteResult!.Kind);

            using var configured = await operatorClient.GetAsync("/v1/connectors/configured");
            var summaries = await configured.Content.ReadFromJsonAsync<List<ConnectorConfigSummary>>(JsonOptions);
            Assert.Empty(summaries!);

            // "No unregister" — the roster member RegisterMachine already added is still there. This is the
            // documented, honest limitation (see ConnectorEndpoints' own doc comment): removal is
            // config-only until a full process restart.
            using var fleet = await operatorClient.GetAsync("/v1/fleet");
            var snapshot = await fleet.Content.ReadFromJsonAsync<FleetSnapshotDto>(JsonOptions);
            Assert.Contains(snapshot!.Machines, m => m.Code == code);

            // A second delete of the same (now-absent) kind is a 404, not a silent 200.
            using var secondDelete = await engineer.DeleteAsync("/v1/connectors/Modbus");
            Assert.Equal(HttpStatusCode.NotFound, secondDelete.StatusCode);
        }
    }

    [Fact]
    public async Task DeleteUnknownKind_404()
    {
        await using var factory = await CreateFactoryAsync();
        var (admin, engineer, operatorClient) = await SetUpAllRolesAsync(factory);
        using (admin) using (engineer) using (operatorClient)
        {
            using var delete = await engineer.DeleteAsync("/v1/connectors/OpcUa");
            Assert.Equal(HttpStatusCode.NotFound, delete.StatusCode);
        }
    }

    [Fact]
    public async Task PersistedConnector_SurvivesARestart_AppearsInRosterAndConfiguredList_OnAFreshBoot()
    {
        var sharedConnectorConfigDir = Directory.CreateTempSubdirectory("st4i-connectors-ep-restart-shared-").FullName;
        var code = "SM5-RESTART-" + Guid.NewGuid().ToString("N")[..8];

        await using (var factory1 = await CreateFactoryAsync(connectorConfigDirOverride: sharedConnectorConfigDir))
        {
            var (admin1, engineer1, _) = await SetUpAllRolesAsync(factory1);
            using (admin1) using (engineer1)
            {
                using var create = await engineer1.PostAsJsonAsync(
                    "/v1/connectors", new ConnectorCreateRequest("Modbus", "10.5.5.5", 502, ValidModbusMap(code)), JsonOptions);
                Assert.Equal(HttpStatusCode.OK, create.StatusCode);
            }
        }

        // A FRESH WebApplicationFactory<Program> pointed at the SAME connector-config directory — the
        // in-process analogue of a real process restart (same technique FleetHostSettingsPersistenceTests
        // already uses at the FleetHost level). No second POST — Program.cs's own startup wiring must be
        // what re-registers the factory AND re-seeds the roster from the persisted store alone.
        await using var factory2 = await CreateFactoryAsync(connectorConfigDirOverride: sharedConnectorConfigDir);
        var (admin2, engineer2, operator2) = await SetUpAllRolesAsync(factory2);
        using (admin2) using (engineer2) using (operator2)
        {
            using var fleet = await operator2.GetAsync("/v1/fleet");
            var snapshot = await fleet.Content.ReadFromJsonAsync<FleetSnapshotDto>(JsonOptions);
            var tile = Assert.Single(snapshot!.Machines, m => m.Code == code);
            Assert.Equal(DriverKinds.Modbus, tile.DriverKind);

            using var configured = await operator2.GetAsync("/v1/connectors/configured");
            var summaries = await configured.Content.ReadFromJsonAsync<List<ConnectorConfigSummary>>(JsonOptions);
            Assert.Contains(summaries!, s => s.Kind == "Modbus" && s.MachineCode == code && s.Host == "10.5.5.5" && s.Port == 502);
        }
    }

    [Fact]
    public async Task PersistedConnector_NeverShadowsAnEnvVarConfiguredConnectorOfTheSameKind()
    {
        var sharedConnectorConfigDir = Directory.CreateTempSubdirectory("st4i-connectors-ep-precedence-").FullName;
        var uiCode = "SM5-UI-SHADOWED-" + Guid.NewGuid().ToString("N")[..8];
        var envCode = "SM5-ENV-WINNER-" + Guid.NewGuid().ToString("N")[..8];

        // Persist a UI-added Modbus connector first (no env var involved yet).
        await using (var factory1 = await CreateFactoryAsync(connectorConfigDirOverride: sharedConnectorConfigDir))
        {
            var (admin1, engineer1, _) = await SetUpAllRolesAsync(factory1);
            using (admin1) using (engineer1)
            {
                using var create = await engineer1.PostAsJsonAsync(
                    "/v1/connectors", new ConnectorCreateRequest("Modbus", "10.9.9.9", 502, ValidModbusMap(uiCode)), JsonOptions);
                Assert.Equal(HttpStatusCode.OK, create.StatusCode);
            }
        }

        // Now boot with the SAME persisted store PLUS an env-var-configured Modbus connector for a
        // DIFFERENT machine code — the "existing env-var deployment must keep working byte-identically"
        // guarantee this task's brief requires.
        var envMapPath = Path.Combine(Path.GetTempPath(), $"st4i-sm5-envmap-{Guid.NewGuid():N}.json");
        await File.WriteAllTextAsync(envMapPath, ValidModbusMap(envCode));
        try
        {
            await using var factory2 = await CreateFactoryAsync(connectorConfigDirOverride: sharedConnectorConfigDir, modbusEnvMapPath: envMapPath);
            var (admin2, engineer2, operator2) = await SetUpAllRolesAsync(factory2);
            using (admin2) using (engineer2) using (operator2)
            {
                using var fleet = await operator2.GetAsync("/v1/fleet");
                var snapshot = await fleet.Content.ReadFromJsonAsync<FleetSnapshotDto>(JsonOptions);

                // The env var wins unconditionally (ConnectorsConfig.ResolveEntries' own rule, extended one
                // layer further by this task) — the env-configured machine is present...
                Assert.Contains(snapshot!.Machines, m => m.Code == envCode);
                // ...and the persisted UI connector for the SAME kind is skipped, never silently
                // reconfiguring/shadowing the working env-var deployment.
                Assert.DoesNotContain(snapshot.Machines, m => m.Code == uiCode);
            }
        }
        finally
        {
            File.Delete(envMapPath);
        }
    }

    [Fact]
    public async Task DemoMode_Unchanged_PersistedConnectorIsPurelyAdditive()
    {
        var code = "SM5-DEMO-ADD-" + Guid.NewGuid().ToString("N")[..8];

        // demoEnabled: true means DemoAutoLoginMiddleware auto-creates + signs in "demo-admin" (Roles.Admin)
        // on the very first request — bootstrapping a SEPARATE admin on top of that would 409 (the user
        // store is no longer empty), same reasoning AssetEndpointsTests' own demo-mode tests already
        // document. Admin satisfies the Engineer-gated POST /v1/connectors too, so the single auto-logged-in
        // client is used for everything.
        await using var factory = await CreateFactoryAsync(demoEnabled: true);
        using var client = factory.CreateClient(new WebApplicationFactoryClientOptions { HandleCookies = true });

        using var fleetBefore = await client.GetAsync("/v1/fleet");
        var before = await fleetBefore.Content.ReadFromJsonAsync<FleetSnapshotDto>(JsonOptions);
        var demoCountBefore = before!.Machines.Count;
        Assert.True(demoCountBefore > 0, "demo mode must still seed its own fabricated fleet, unchanged");
        Assert.Contains(before.Machines, m => DriverKinds.IsFabricated(m.DriverKind));

        using var create = await client.PostAsJsonAsync(
            "/v1/connectors", new ConnectorCreateRequest("Modbus", "10.1.1.1", 502, ValidModbusMap(code)), JsonOptions);
        Assert.Equal(HttpStatusCode.OK, create.StatusCode);

        using var fleetAfter = await client.GetAsync("/v1/fleet");
        var after = await fleetAfter.Content.ReadFromJsonAsync<FleetSnapshotDto>(JsonOptions);

        // Purely additive: every demo machine is still there, PLUS the one real machine just added.
        Assert.Equal(demoCountBefore + 1, after!.Machines.Count);
        Assert.Contains(after.Machines, m => m.Code == code && m.DriverKind == DriverKinds.Modbus);
    }

    [Fact]
    public async Task AuditRecordsCreateAndDelete_NeverIncludingCredentials()
    {
        await using var factory = await CreateFactoryAsync();
        var (admin, engineer, operatorClient) = await SetUpAllRolesAsync(factory);
        using (admin) using (engineer) using (operatorClient)
        {
            var code = "SM5-AUDIT-" + Guid.NewGuid().ToString("N")[..8];
            const string secretPassword = "audit-should-never-see-this";
            using (await engineer.PostAsJsonAsync(
                       "/v1/connectors", new ConnectorCreateRequest("OpcUa", null, null, ValidOpcUaMap(code, "admin", secretPassword)), JsonOptions))
            {
            }
            using (await engineer.DeleteAsync("/v1/connectors/OpcUa"))
            {
            }

            var auditStore = factory.Services.GetRequiredService<IAuditStore>();
            var page = await auditStore.QueryAsync(from: null, to: null, actor: null, action: null, target: "OpcUa", limit: 50, offset: 0, CancellationToken.None);

            var saveRow = Assert.Single(page.Items, e => e.Action == "connector.save");
            Assert.Equal("conn-engineer", saveRow.ActorUsername);
            Assert.DoesNotContain(secretPassword, saveRow.NewValueJson ?? "");
            Assert.DoesNotContain(secretPassword, saveRow.OldValueJson ?? "");

            var deleteRow = Assert.Single(page.Items, e => e.Action == "connector.delete");
            Assert.DoesNotContain(secretPassword, deleteRow.NewValueJson ?? "");
            Assert.DoesNotContain(secretPassword, deleteRow.OldValueJson ?? "");
        }
    }

    [Fact]
    public async Task TestConnector_MalformedRequest_400()
    {
        await using var factory = await CreateFactoryAsync();
        var (admin, engineer, operatorClient) = await SetUpAllRolesAsync(factory);
        using (admin) using (engineer) using (operatorClient)
        {
            using var test = await engineer.PostAsJsonAsync(
                "/v1/connectors/test", new ConnectorTestRequest("Modbus", null, null, ValidModbusMap("X")), JsonOptions);
            Assert.Equal(HttpStatusCode.BadRequest, test.StatusCode);
        }
    }

    [Fact]
    public async Task TestConnector_UnreachableTarget_BoundedTime_NeverHangs_ReturnsOkFalse()
    {
        await using var factory = await CreateFactoryAsync();
        var (admin, engineer, operatorClient) = await SetUpAllRolesAsync(factory);
        using (admin) using (engineer) using (operatorClient)
        {
            var previousTimeout = ConnectorEndpoints.ConnectionTestTimeout;
            ConnectorEndpoints.ConnectionTestTimeout = TimeSpan.FromMilliseconds(400);
            try
            {
                var sw = System.Diagnostics.Stopwatch.StartNew();
                using var test = await engineer.PostAsJsonAsync(
                    "/v1/connectors/test",
                    new ConnectorTestRequest("Modbus", "127.0.0.1", 1, ValidModbusMap("SM5-TEST-UNREACHABLE")),
                    JsonOptions);
                sw.Stop();

                Assert.Equal(HttpStatusCode.OK, test.StatusCode);
                var result = await test.Content.ReadFromJsonAsync<ConnectorTestResultDto>(JsonOptions);
                Assert.False(result!.Ok);
                Assert.False(string.IsNullOrWhiteSpace(result.Error));
                // Bounded — never hangs past the (test-shortened) timeout by more than a generous margin.
                Assert.True(sw.Elapsed < TimeSpan.FromSeconds(5), $"connection test took {sw.Elapsed}, expected well under 5s");
            }
            finally
            {
                ConnectorEndpoints.ConnectionTestTimeout = previousTimeout;
            }
        }
    }
}
