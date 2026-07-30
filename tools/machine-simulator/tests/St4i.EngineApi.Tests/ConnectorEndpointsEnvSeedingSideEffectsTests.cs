using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Microsoft.AspNetCore.Identity;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging;
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
/// second, provenance-tracking table) had real side effects on those existing endpoints, deliberately NOT
/// fixed by B-4 (out of that task's scope — "Endpoints/policy/RBAC/audit (B-6)").
///
/// <para><b>Task B-6 (.superpowers/sdd/2026-07-29-dotB-machine-control-blueprint/task-6-brief.md) — closes
/// the carried finding.</b> <see cref="ConnectorConfigStore"/> now has its own
/// <see cref="ConnectorConfigSource"/> column (<see cref="ConnectorConfigSource.Operator"/> vs.
/// <see cref="ConnectorConfigSource.Seeded"/>), so:</para>
///
/// <list type="bullet">
/// <item><description><c>POST /v1/connectors</c> for a DIFFERENT machine of an env-var-seeded kind no longer
/// 409s — the seeded row is not something an operator ever persisted, so there is nothing of theirs to
/// protect; the save proceeds, upserting the operator's own configuration over the seeded visibility row
/// (see <see cref="PostConnector_ForADifferentMachine_SucceedsOverwritingTheSeededRow_NoLongerFalsely409s"/>).
/// The pre-existing protection for a GENUINE operator row is unchanged and still proven
/// (<see cref="PostConnector_ForADifferentMachine_OfAnOperatorOwnedKind_Still409s_ProtectionIntact"/>).</description></item>
/// <item><description><c>DELETE /v1/connectors/{kind}</c> still succeeds against a seeded row (unchanged,
/// intentional — see <see cref="ConnectorConfigVisibilitySeeder"/>'s own doc comment: the documented recovery
/// workflow IS "delete + restart to reseed"), and its response now says PLAINLY that the row was not
/// operator-created and will simply reappear if the same source config is still active next boot — see
/// <see cref="DeleteConnector_SucceedsAgainstASeededRow_ButDoesNotStick_NextBootWithSameEnvVarReseedsIt"/>.</description></item>
/// <item><description>The startup loop's own "ignored — an environment variable already configures this
/// connector kind" self-referential warning about the seeder's own row is unaffected by THIS file (still not
/// captured here — see the original note below), but the seeder itself no longer warns about its OWN prior
/// row at all (see <c>ConnectorConfigVisibilitySeederTests</c>'s new test) — the third named symptom, closed
/// one layer down from where this file's tests look.</description></item>
/// </list>
///
/// <para><b>NOT covered here, documented instead</b> (kept from the original file — capturing Program.cs's
/// <c>Console.Error</c> output across a real host boot is disproportionate to what remains to verify once the
/// seeder's own behavior is unit-tested directly).</para>
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
    /// copy rather than exposing that file's internals, so this file's addition stays fully self-contained.
    /// <paramref name="capturedLogLines"/> (Task B-6 fix round 1, review Important I3) is <see langword="null"/>
    /// for every pre-existing call site (byte-identical behavior); when supplied, a custom
    /// <see cref="ILoggerProvider"/> is registered via <see cref="WebApplicationFactory{TEntryPoint}.WithWebHostBuilder"/>
    /// so a test can assert on exactly what the real startup logging pipeline emitted, rather than only on
    /// observable application STATE (needed here because the finding under test — Program.cs's persisted-row
    /// startup loop warning about its own seeded row on every subsequent boot — has no state-level symptom at
    /// all; the row's data is correct either way, only the LOG TEXT differs).</summary>
    private static async Task<WebApplicationFactory<Program>> CreateFactoryAsync(
        string? connectorConfigDirOverride = null, string? modbusEnvMapPath = null, List<string>? capturedLogLines = null)
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

            var factory = capturedLogLines is null
                ? new WebApplicationFactory<Program>()
                : new WebApplicationFactory<Program>().WithWebHostBuilder(b =>
                    b.ConfigureServices(services =>
                        services.AddSingleton<ILoggerProvider>(new CapturingLoggerProvider(capturedLogLines))));
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

    /// <summary>Task B-6 — the provenance fix, proven directly: renamed from the pre-fix
    /// <c>...409sNamingTheSeededMachine_OperatorNeverPersistedIt</c> (this exact scenario is what the
    /// carried finding named). Before B-6, this exact request 409'd, naming a machine code the operator never
    /// persisted themselves — the load-bearing assertion below is now the OPPOSITE: the save SUCCEEDS,
    /// because a <see cref="ConnectorConfigSource.Seeded"/> row is no longer treated as "an operator already
    /// configured this kind".</summary>
    [Fact]
    public async Task PostConnector_ForADifferentMachine_SucceedsOverwritingTheSeededRow_NoLongerFalsely409s()
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
                // by anyone through this endpoint — and it is correctly tagged Seeded, not Operator.
                using var configuredBefore = await engineer.GetAsync("/v1/connectors/configured");
                var before = await configuredBefore.Content.ReadFromJsonAsync<List<ConnectorConfigSummary>>(JsonOptions);
                var seededRow = Assert.Single(before!, s => s.Kind == "Modbus" && s.MachineCode == envCode);
                Assert.Equal(ConnectorConfigSource.Seeded, seededRow.Source);

                // The load-bearing assertion (Task B-6, closing Fix round 1 Important #3): an Engineer
                // configuring a genuinely DIFFERENT Modbus machine through the normal UI path now SUCCEEDS —
                // the seeded row is not an operator's own configuration, so it is not protected from being
                // overwritten by one.
                var otherCode = "ENVSEED-OTHER-" + Guid.NewGuid().ToString("N")[..8];
                using var create = await engineer.PostAsJsonAsync(
                    "/v1/connectors",
                    new ConnectorCreateRequest("Modbus", "10.0.0.99", 502, ValidModbusMap(otherCode)),
                    JsonOptions);

                Assert.Equal(HttpStatusCode.OK, create.StatusCode);

                // The store now reports the OPERATOR's own row (the seeded one was upserted over) — Source
                // flips to Operator, since this row now genuinely IS an operator's own persisted config.
                using var configuredAfter = await engineer.GetAsync("/v1/connectors/configured");
                var after = await configuredAfter.Content.ReadFromJsonAsync<List<ConnectorConfigSummary>>(JsonOptions);
                var operatorRow = Assert.Single(after!, s => s.Kind == "Modbus");
                Assert.Equal(otherCode, operatorRow.MachineCode);
                Assert.Equal(ConnectorConfigSource.Operator, operatorRow.Source);
            }
        }
        finally
        {
            File.Delete(envMapPath);
        }
    }

    /// <summary>Task B-6 — the OTHER half of the provenance fix: relaxing the guard for a Seeded row must NOT
    /// remove the pre-existing protection for a GENUINE operator row. No env-var seeding involved at all here
    /// — two plain <c>POST /v1/connectors</c> calls, same kind, different machine codes; the second must still
    /// 409 exactly as it always has.</summary>
    [Fact]
    public async Task PostConnector_ForADifferentMachine_OfAnOperatorOwnedKind_Still409s_ProtectionIntact()
    {
        await using var factory = await CreateFactoryAsync();
        var (admin, engineer) = await SetUpAdminAndEngineerAsync(factory);
        using (admin) using (engineer)
        {
            var firstCode = "OPERATOR-OWN-" + Guid.NewGuid().ToString("N")[..8];
            using (var createFirst = await engineer.PostAsJsonAsync(
                       "/v1/connectors",
                       new ConnectorCreateRequest("Modbus", "10.0.0.50", 502, ValidModbusMap(firstCode)),
                       JsonOptions))
            {
                Assert.Equal(HttpStatusCode.OK, createFirst.StatusCode);
            }

            var secondCode = "OPERATOR-OTHER-" + Guid.NewGuid().ToString("N")[..8];
            using var createSecond = await engineer.PostAsJsonAsync(
                "/v1/connectors",
                new ConnectorCreateRequest("Modbus", "10.0.0.51", 502, ValidModbusMap(secondCode)),
                JsonOptions);

            Assert.Equal(HttpStatusCode.Conflict, createSecond.StatusCode);
            var body = await createSecond.Content.ReadAsStringAsync();
            Assert.Contains(firstCode, body, StringComparison.Ordinal);

            // Still exactly the operator's original row — never overwritten.
            using var configured = await engineer.GetAsync("/v1/connectors/configured");
            var summaries = await configured.Content.ReadFromJsonAsync<List<ConnectorConfigSummary>>(JsonOptions);
            var row = Assert.Single(summaries!, s => s.Kind == "Modbus");
            Assert.Equal(firstCode, row.MachineCode);
            Assert.Equal(ConnectorConfigSource.Operator, row.Source);
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
                    var seededRow = Assert.Single(before!, s => s.Kind == "Modbus" && s.MachineCode == envCode);
                    Assert.Equal(ConnectorConfigSource.Seeded, seededRow.Source);

                    // DELETE succeeds (200) against a row the operator never created themselves — Task B-6:
                    // the response now says so plainly, instead of the generic "keeps running" message a
                    // genuine operator row gets.
                    using var delete = await engineer1.DeleteAsync("/v1/connectors/Modbus");
                    Assert.Equal(HttpStatusCode.OK, delete.StatusCode);
                    var deleteResult = await delete.Content.ReadFromJsonAsync<ConnectorDeleteResultDto>(JsonOptions);
                    Assert.NotNull(deleteResult);
                    Assert.Contains("not created by an operator", deleteResult!.Message, StringComparison.Ordinal);
                    Assert.Contains("reappear", deleteResult.Message, StringComparison.Ordinal);

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

    // ─────────────────────────────────────────────────────────────────────
    // Task B-6 fix round 1 (review, Important I3) — the SEPARATE warning site the original submission missed:
    // Program.cs's persisted-row startup loop (distinct from ConnectorConfigVisibilitySeeder's OWN warning,
    // already fixed) also names "ignored — an environment variable ... already configures this connector kind"
    // with no Source check at all, so from boot 2 onward it fires about the seeder's own row on EVERY boot —
    // verbatim the carried B-4 symptom. No state-level difference exists between the warned and silent case
    // (the row's data is correct either way), so these tests capture the REAL logging pipeline's output via a
    // custom ILoggerProvider rather than asserting on HTTP responses.
    // ─────────────────────────────────────────────────────────────────────

    [Fact]
    public async Task PersistedRowStartupLoop_SeededRowsOwnKind_NeverWarns_AcrossMultipleBoots()
    {
        var sharedConnectorConfigDir = Directory.CreateTempSubdirectory("st4i-envseed-i3-seeded-").FullName;
        var envCode = "ENVSEED-I3-SEEDED-" + Guid.NewGuid().ToString("N")[..8];
        var envMapPath = Path.Combine(Path.GetTempPath(), $"st4i-envseed-map-{Guid.NewGuid():N}.json");
        await File.WriteAllTextAsync(envMapPath, ValidModbusMap(envCode));
        try
        {
            // Boot 1 — seeds the row for the first time. persistedConnectorRows is loaded BEFORE the seeding
            // pass runs (Program.cs's own ordering), so boot 1's own freshly-seeded row can never appear in
            // THIS boot's loop at all — nothing to warn about yet, on either side of the fix.
            await using (var factory1 = await CreateFactoryAsync(connectorConfigDirOverride: sharedConnectorConfigDir, modbusEnvMapPath: envMapPath))
            {
                _ = factory1.Server;
            }

            // Boot 2 — SAME store directory, SAME env var still active. This run's persistedConnectorRows NOW
            // includes the row seeded during boot 1 (tagged Seeded) — exactly the scenario the carried B-4
            // finding named ("the seeder's own row" showing up on the NEXT boot).
            var capturedLogLines = new List<string>();
            await using var factory2 = await CreateFactoryAsync(
                connectorConfigDirOverride: sharedConnectorConfigDir, modbusEnvMapPath: envMapPath, capturedLogLines: capturedLogLines);
            _ = factory2.Server;

            // The load-bearing assertion: no "ignored" warning naming this env-configured machine fired.
            Assert.DoesNotContain(capturedLogLines, line =>
                line.Contains("ignored", StringComparison.OrdinalIgnoreCase) && line.Contains(envCode, StringComparison.Ordinal));
        }
        finally
        {
            File.Delete(envMapPath);
        }
    }

    [Fact]
    public async Task PersistedRowStartupLoop_OperatorRow_StillWarnsWhenShadowedByEnvVar()
    {
        var sharedConnectorConfigDir = Directory.CreateTempSubdirectory("st4i-envseed-i3-operator-").FullName;
        var operatorCode = "ENVSEED-I3-OPERATOR-" + Guid.NewGuid().ToString("N")[..8];
        var envCode = "ENVSEED-I3-ENV-" + Guid.NewGuid().ToString("N")[..8];

        // Pre-seed an OPERATOR row directly (SaveAsync's default source is Operator) for the SAME kind the
        // env var below will also configure — simulating a genuine earlier POST /v1/connectors, now shadowed.
        var preSeedStore = new ConnectorConfigStore(sharedConnectorConfigDir);
        await preSeedStore.SaveAsync("Modbus", operatorCode, "10.0.0.77", 502, ValidModbusMap(operatorCode));

        var envMapPath = Path.Combine(Path.GetTempPath(), $"st4i-envseed-map-{Guid.NewGuid():N}.json");
        await File.WriteAllTextAsync(envMapPath, ValidModbusMap(envCode));
        try
        {
            var capturedLogLines = new List<string>();
            await using var factory = await CreateFactoryAsync(
                connectorConfigDirOverride: sharedConnectorConfigDir, modbusEnvMapPath: envMapPath, capturedLogLines: capturedLogLines);
            _ = factory.Server;

            // The contrast case — unchanged behavior: a genuine operator row being shadowed still warns.
            Assert.Contains(capturedLogLines, line =>
                line.Contains("ignored", StringComparison.OrdinalIgnoreCase) && line.Contains(operatorCode, StringComparison.Ordinal));
        }
        finally
        {
            File.Delete(envMapPath);
        }
    }

    /// <summary>Captures every formatted log line across every category into a shared list — deliberately
    /// minimal (no level filtering, no scopes) since these tests only need to assert on message TEXT.</summary>
    private sealed class CapturingLoggerProvider : ILoggerProvider
    {
        private readonly List<string> _lines;
        public CapturingLoggerProvider(List<string> lines) => _lines = lines;
        public ILogger CreateLogger(string categoryName) => new CapturingLogger(_lines);
        public void Dispose() { }

        private sealed class CapturingLogger : ILogger
        {
            private readonly List<string> _lines;
            public CapturingLogger(List<string> lines) => _lines = lines;
            public IDisposable? BeginScope<TState>(TState state) where TState : notnull => null;
            public bool IsEnabled(LogLevel logLevel) => true;

            public void Log<TState>(
                LogLevel logLevel, EventId eventId, TState state, Exception? exception,
                Func<TState, Exception?, string> formatter)
            {
                lock (_lines) _lines.Add(formatter(state, exception));
            }
        }
    }
}
