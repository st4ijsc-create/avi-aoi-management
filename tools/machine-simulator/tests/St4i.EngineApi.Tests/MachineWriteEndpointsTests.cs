using System.Net;
using System.Net.Http.Json;
using System.Runtime.CompilerServices;
using System.Security.Claims;
using System.Text.Json;
using System.Text.Json.Serialization;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Identity;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.Extensions.DependencyInjection;
using St4i.Connector.Abstractions;
using St4i.Connector.Abstractions.Models;
using St4i.EdgeCore.Mapping;
using St4i.EdgeCore.Models;
using St4i.EngineApi.Alarms;
using St4i.EngineApi.Auth;
using St4i.EngineApi.Endpoints;
using St4i.EngineApi.Fleet;
using St4i.EngineApi.Policy;
using St4i.EngineApi.Tests.Auth;
using Xunit;

namespace St4i.EngineApi.Tests;

/// <summary>
/// Task B-6 (.superpowers/sdd/2026-07-29-dotB-machine-control-blueprint/task-6-brief.md) — real-pipeline
/// (<c>WebApplicationFactory&lt;Program&gt;</c>) proof of the two new machine-write routes: the batch's one
/// non-negotiable invariant (<c>EstopGuardRule</c> covers both), HALT/reset remaining reachable regardless,
/// commands gated strictly more strictly than setpoints, every not-available case distinguished, every
/// attempted-write outcome audited (including <c>Indeterminate</c> surviving as itself), and the
/// Critical-alarm gate (and the fact a High-priority alarm — e.g. Identity's own, deliberately capped there —
/// does NOT reach it).
///
/// Same env-var-swap-then-eager-build factory recipe as <c>LineEndpointsTests</c>/<c>RbacPolicyTests</c>
/// (duplicated rather than shared, for the same reasons those classes' own doc comments give) — carries the
/// same <c>[Collection(...)]</c> tag so xUnit runs this class sequentially relative to every other class that
/// swaps the same real process environment variables.
/// </summary>
[Collection(SecurityEnvVarTests.CollectionName)]
public sealed class MachineWriteEndpointsTests
{
    private static readonly SemaphoreSlim EnvLock = new(1, 1);
    private static readonly JsonSerializerOptions JsonOptions = new(JsonSerializerDefaults.Web);

    private static readonly JsonSerializerOptions JsonOptionsWithEnums = new(JsonSerializerDefaults.Web)
    {
        Converters = { new JsonStringEnumConverter() },
    };

    private static readonly TimeSpan PollTimeout = TimeSpan.FromSeconds(10);
    private static readonly TimeSpan PollInterval = TimeSpan.FromMilliseconds(100);

    private static async Task<WebApplicationFactory<Program>> CreateFactoryAsync()
    {
        var securityDir = Directory.CreateTempSubdirectory("st4i-machwrite-security-").FullName;
        var historianDir = Directory.CreateTempSubdirectory("st4i-machwrite-historian-").FullName;
        var walDir = Directory.CreateTempSubdirectory("st4i-machwrite-wal-").FullName;
        var settingsDir = Directory.CreateTempSubdirectory("st4i-machwrite-settings-").FullName;
        var assetsDir = Directory.CreateTempSubdirectory("st4i-machwrite-assets-").FullName;
        var alarmsDir = Directory.CreateTempSubdirectory("st4i-machwrite-alarms-").FullName;
        var identityDir = Directory.CreateTempSubdirectory("st4i-machwrite-identity-").FullName;
        var siteLinkDir = Directory.CreateTempSubdirectory("st4i-machwrite-sitelink-").FullName;
        var bridgeSpoolDir = Directory.CreateTempSubdirectory("st4i-machwrite-bridgespool-").FullName;
        var connectorConfigDir = Directory.CreateTempSubdirectory("st4i-machwrite-connectorconfig-").FullName;

        await EnvLock.WaitAsync().ConfigureAwait(false);
        var prevSecurityDir = Environment.GetEnvironmentVariable("ST4I_SECURITY_DIR");
        var prevDemoEnabled = Environment.GetEnvironmentVariable("ST4I_DEMO_ENABLED");
        var prevHistorianDir = Environment.GetEnvironmentVariable("ST4I_HISTORIAN_DIR");
        var prevWalDir = Environment.GetEnvironmentVariable("ST4I_WAL_DIR");
        var prevSettingsDir = Environment.GetEnvironmentVariable("ST4I_SETTINGS_DIR");
        var prevAssetsDir = Environment.GetEnvironmentVariable("ST4I_ASSETS_DIR");
        var prevAlarmsDir = Environment.GetEnvironmentVariable("ST4I_ALARMS_DIR");
        var prevIdentityDir = Environment.GetEnvironmentVariable("ST4I_IDENTITY_DIR");
        var prevSiteLinkDir = Environment.GetEnvironmentVariable("ST4I_SITELINK_DIR");
        var prevBridgeSpoolDir = Environment.GetEnvironmentVariable("ST4I_BRIDGE_SPOOL_DIR");
        var prevConnectorConfigDir = Environment.GetEnvironmentVariable("ST4I_CONNECTOR_CONFIG_DIR");
        var prevEnvironment = Environment.GetEnvironmentVariable("ASPNETCORE_ENVIRONMENT");
        try
        {
            Environment.SetEnvironmentVariable("ST4I_SECURITY_DIR", securityDir);
            Environment.SetEnvironmentVariable("ST4I_DEMO_ENABLED", null);
            Environment.SetEnvironmentVariable("ST4I_HISTORIAN_DIR", historianDir);
            Environment.SetEnvironmentVariable("ST4I_WAL_DIR", walDir);
            Environment.SetEnvironmentVariable("ST4I_SETTINGS_DIR", settingsDir);
            Environment.SetEnvironmentVariable("ST4I_ASSETS_DIR", assetsDir);
            Environment.SetEnvironmentVariable("ST4I_ALARMS_DIR", alarmsDir);
            Environment.SetEnvironmentVariable("ST4I_IDENTITY_DIR", identityDir);
            Environment.SetEnvironmentVariable("ST4I_SITELINK_DIR", siteLinkDir);
            Environment.SetEnvironmentVariable("ST4I_BRIDGE_SPOOL_DIR", bridgeSpoolDir);
            Environment.SetEnvironmentVariable("ST4I_CONNECTOR_CONFIG_DIR", connectorConfigDir);
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
            Environment.SetEnvironmentVariable("ST4I_ALARMS_DIR", prevAlarmsDir);
            Environment.SetEnvironmentVariable("ST4I_IDENTITY_DIR", prevIdentityDir);
            Environment.SetEnvironmentVariable("ST4I_SITELINK_DIR", prevSiteLinkDir);
            Environment.SetEnvironmentVariable("ST4I_BRIDGE_SPOOL_DIR", prevBridgeSpoolDir);
            Environment.SetEnvironmentVariable("ST4I_CONNECTOR_CONFIG_DIR", prevConnectorConfigDir);
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

    private static async Task BootstrapAdminAsync(WebApplicationFactory<Program> factory, string username, string password)
    {
        using var bootstrapClient = factory.CreateClient();
        using var bootstrap = await bootstrapClient.PostAsJsonAsync(
            "/v1/auth/bootstrap", new { username, password, displayName = (string?)null }, JsonOptions).ConfigureAwait(false);
        Assert.Equal(HttpStatusCode.OK, bootstrap.StatusCode);
    }

    /// <summary>Bootstraps a fixed Admin/Engineer/Operator trio and returns their logged-in clients — the
    /// same shape most tests below need.</summary>
    private static async Task<(HttpClient Admin, HttpClient Engineer, HttpClient Operator)> SetUpAllRolesAsync(
        WebApplicationFactory<Program> factory, string suffix)
    {
        await BootstrapAdminAsync(factory, $"mw-admin-{suffix}", "AdminPass123!");
        await CreateUserAsync(factory, $"mw-engineer-{suffix}", "EngineerPass123!", Roles.Engineer);
        await CreateUserAsync(factory, $"mw-operator-{suffix}", "OperatorPass123!", Roles.Operator);

        var admin = await LoginAsAsync(factory, $"mw-admin-{suffix}", "AdminPass123!");
        var engineer = await LoginAsAsync(factory, $"mw-engineer-{suffix}", "EngineerPass123!");
        var operatorClient = await LoginAsAsync(factory, $"mw-operator-{suffix}", "OperatorPass123!");
        return (admin, engineer, operatorClient);
    }

    private static async Task WaitUntilAsync(Func<bool> predicate, string because)
    {
        var deadline = DateTime.UtcNow + PollTimeout;
        while (DateTime.UtcNow < deadline)
        {
            if (predicate()) return;
            await Task.Delay(PollInterval);
        }

        Assert.True(predicate(), $"timed out after {PollTimeout} waiting for: {because}");
    }

    private static MachineDescriptor NewModbusStyleMachine(string code) => new(
        code, $"SN-{code}", DeviceClass.Automation, "MODBUS_TCP", null,
        DriverKinds.Modbus, null, null, CycleSeconds: 0.5);

    private static MappingProfile TestProfile(string name) => new() { Name = name, DeviceClass = "Test" };

    /// <summary>Registers <paramref name="code"/> as a Modbus-kind roster machine, injects
    /// <paramref name="fakeDriver"/> as its live "modbus" slot (the same cheapest-writable-slot technique
    /// <c>FleetHostMachineDriverResolutionTests</c> already established — no real NModbus/OPC-UA server
    /// needed), starts the fleet, and waits until the machine reports <see cref="MachineDriverAvailability.Writable"/>.</summary>
    private static async Task<FleetHost> SetUpWritableMachineAsync(WebApplicationFactory<Program> factory, string code, FakeWritableDriver fakeDriver)
    {
        var host = factory.Services.GetRequiredService<FleetHost>();
        Assert.True(host.RegisterMachine(NewModbusStyleMachine(code)));
        host.AdditionalPipelinesForTests = () => new List<(string Label, IDeviceDriver Driver, MappingProfile Profile)>
        {
            ("modbus", fakeDriver, TestProfile("modbus")),
        };
        host.Start();
        await WaitUntilAsync(
            () => host.GetMachineDriverAvailability(code) == MachineDriverAvailability.Writable,
            "the injected writable driver's slot to come up");
        return host;
    }

    // ─────────────────────────────────────────────────────────────────────
    // RBAC: unauthenticated 401 on both routes.
    // ─────────────────────────────────────────────────────────────────────

    [Fact]
    public async Task Unauthenticated_Gets401_OnBothRoutes()
    {
        await using var factory = await CreateFactoryAsync();
        using var client = factory.CreateClient();

        using (var post = await client.PostAsJsonAsync("/v1/machines/ANY/setpoint", new { point = "speed", value = 1.0 }, JsonOptions))
        {
            Assert.Equal(HttpStatusCode.Unauthorized, post.StatusCode);
        }

        using (var post = await client.PostAsJsonAsync("/v1/machines/ANY/command", new { command = "start-cycle" }, JsonOptions))
        {
            Assert.Equal(HttpStatusCode.Unauthorized, post.StatusCode);
        }
    }

    // ─────────────────────────────────────────────────────────────────────
    // THE non-negotiable invariant: HALT latched -> both refused, unmistakably, SAFETY_BLOCKED. No live
    // driver needed at all — the policy gate refuses BEFORE any machine resolution is ever attempted, which
    // is itself part of the proof (the gate covers the ACTION, not something specific to one machine's setup).
    // ─────────────────────────────────────────────────────────────────────

    [Fact]
    public async Task Setpoint_HaltLatched_Refused_SafetyBlocked()
    {
        await using var factory = await CreateFactoryAsync();
        var (admin, engineer, _) = await SetUpAllRolesAsync(factory, "halt-sp");
        using (admin) using (engineer)
        {
            using (var estop = await admin.PostAsync("/v1/fleet/estop", null))
            {
                Assert.Equal(HttpStatusCode.OK, estop.StatusCode);
            }

            using var write = await engineer.PostAsJsonAsync(
                "/v1/machines/DOES-NOT-EVEN-EXIST/setpoint", new { point = "speed", value = 42.0 }, JsonOptions);

            Assert.Equal(HttpStatusCode.Conflict, write.StatusCode);
            var deny = await write.Content.ReadFromJsonAsync<PolicyDenyDto>(JsonOptions);
            Assert.NotNull(deny);
            Assert.Equal("SAFETY_BLOCKED", deny!.Reason);
        }
    }

    [Fact]
    public async Task Command_HaltLatched_Refused_SafetyBlocked()
    {
        await using var factory = await CreateFactoryAsync();
        var (admin, _, _) = await SetUpAllRolesAsync(factory, "halt-cmd");
        using (admin)
        {
            using (var estop = await admin.PostAsync("/v1/fleet/estop", null))
            {
                Assert.Equal(HttpStatusCode.OK, estop.StatusCode);
            }

            using var invoke = await admin.PostAsJsonAsync(
                "/v1/machines/DOES-NOT-EVEN-EXIST/command", new { command = "start-cycle" }, JsonOptions);

            Assert.Equal(HttpStatusCode.Conflict, invoke.StatusCode);
            var deny = await invoke.Content.ReadFromJsonAsync<PolicyDenyDto>(JsonOptions);
            Assert.NotNull(deny);
            Assert.Equal("SAFETY_BLOCKED", deny!.Reason);
        }
    }

    /// <summary>The other half of the invariant: a halt and its reset must always be reachable, regardless of
    /// what else is going on (here: a Critical alarm ALSO active, proving the two gates are independent and
    /// neither blocks the other's escape hatch).</summary>
    [Fact]
    public async Task HaltAndReset_RemainReachable_EvenWithACriticalAlarmActive()
    {
        await using var factory = await CreateFactoryAsync();
        var (admin, _, _) = await SetUpAllRolesAsync(factory, "halt-reachable");
        using (admin)
        {
            var alarms = factory.Services.GetRequiredService<IAlarmStore>();
            await alarms.RaiseAsync(new AlarmRaise(
                AlarmSource.DriverHealth, "TEST_CRITICAL_REACHABLE", AlarmPriority.Critical,
                "test-induced critical alarm", TargetId: "test-reachable"));

            using (var estop = await admin.PostAsync("/v1/fleet/estop", null))
            {
                Assert.Equal(HttpStatusCode.OK, estop.StatusCode);
            }

            using (var reset = await admin.PostAsync("/v1/fleet/estop/reset", null))
            {
                Assert.Equal(HttpStatusCode.OK, reset.StatusCode);
            }
        }
    }

    // ─────────────────────────────────────────────────────────────────────
    // Commands are gated strictly more strictly than setpoints: an Engineer can write a setpoint but is
    // refused a command (403); Admin can do both.
    // ─────────────────────────────────────────────────────────────────────

    [Fact]
    public async Task Command_EngineerForbidden_AdminSucceeds_SetpointAuthorisedCallerCannotInvokeACommand()
    {
        await using var factory = await CreateFactoryAsync();
        var (admin, engineer, _) = await SetUpAllRolesAsync(factory, "stricter-role");
        using (admin) using (engineer)
        {
            const string code = "MW-STRICTROLE-01";
            var fakeDriver = new FakeWritableDriver();
            var host = await SetUpWritableMachineAsync(factory, code, fakeDriver);
            try
            {
                // The Engineer CAN write a setpoint (Engineer-or-higher obligation).
                using (var write = await engineer.PostAsJsonAsync(
                           $"/v1/machines/{code}/setpoint", new { point = "speed", value = 1.0 }, JsonOptions))
                {
                    Assert.Equal(HttpStatusCode.OK, write.StatusCode);
                }

                // The SAME Engineer is refused a command — 403, never allowed to invoke it.
                using (var invoke = await engineer.PostAsJsonAsync(
                           $"/v1/machines/{code}/command", new { command = "start-cycle" }, JsonOptions))
                {
                    Assert.Equal(HttpStatusCode.Forbidden, invoke.StatusCode);
                }

                Assert.Equal(0, fakeDriver.CommandCallCount); // never reached the driver.

                // Admin CAN invoke the command.
                using (var invoke = await admin.PostAsJsonAsync(
                           $"/v1/machines/{code}/command", new { command = "start-cycle" }, JsonOptions))
                {
                    Assert.Equal(HttpStatusCode.OK, invoke.StatusCode);
                }

                Assert.Equal(1, fakeDriver.CommandCallCount);
            }
            finally
            {
                host.AdditionalPipelinesForTests = null;
                host.Stop();
            }
        }
    }

    [Fact]
    public async Task Setpoint_OperatorForbidden_403()
    {
        await using var factory = await CreateFactoryAsync();
        var (admin, _, operatorClient) = await SetUpAllRolesAsync(factory, "operator-forbidden");
        using (admin) using (operatorClient)
        {
            using var write = await operatorClient.PostAsJsonAsync(
                "/v1/machines/ANY/setpoint", new { point = "speed", value = 1.0 }, JsonOptions);
            Assert.Equal(HttpStatusCode.Forbidden, write.StatusCode);
        }
    }

    /// <summary>Fix round 1 (review, Important I2) — a role-refused attempt is audited, not silently dropped.
    /// Before the fix, ASP.NET Core's authorization middleware denied this request (403) BEFORE
    /// <c>MachineWriteEndpoints.InvokeCommandAsync</c> ever ran — nothing in this task's own code path was ever
    /// reached, so no audit row existed at all for "an Engineer tried to command a physical machine and was
    /// refused." <see cref="MachineWriteRoleDenialAuditHandler"/> closes this at the one seam that CAN observe
    /// the denial (the authorization middleware result handler), independent of and before any endpoint
    /// handler code.</summary>
    [Fact]
    public async Task Command_EngineerForbidden_RoleDenialIsAudited()
    {
        await using var factory = await CreateFactoryAsync();
        var (admin, engineer, _) = await SetUpAllRolesAsync(factory, "role-denial-audit");
        using (admin) using (engineer)
        {
            const string code = "MW-ROLEDENIAL-01";

            using (var invoke = await engineer.PostAsJsonAsync(
                       $"/v1/machines/{code}/command", new { command = "start-cycle" }, JsonOptions))
            {
                Assert.Equal(HttpStatusCode.Forbidden, invoke.StatusCode);
            }

            using var auditResp = await admin.GetAsync("/v1/audit?action=machine.command.invoke.denied&limit=1000");
            var page = await auditResp.Content.ReadFromJsonAsync<AuditPageDto>(JsonOptions);
            var entry = Assert.Single(page!.Items, e => e.TargetId == code);
            Assert.Equal("machine", entry.TargetType);
            Assert.Contains("ROLE_DENIED", entry.NewValueJson, StringComparison.Ordinal);
            Assert.Contains("Engineer", entry.NewValueJson, StringComparison.Ordinal);
        }
    }

    /// <summary>The setpoint-route mirror — an Operator lacks Engineer, refused by the SAME middleware seam.</summary>
    [Fact]
    public async Task Setpoint_OperatorForbidden_RoleDenialIsAudited()
    {
        await using var factory = await CreateFactoryAsync();
        var (admin, _, operatorClient) = await SetUpAllRolesAsync(factory, "role-denial-audit-sp");
        using (admin) using (operatorClient)
        {
            const string code = "MW-ROLEDENIAL-SP-01";

            using (var write = await operatorClient.PostAsJsonAsync(
                       $"/v1/machines/{code}/setpoint", new { point = "speed", value = 1.0 }, JsonOptions))
            {
                Assert.Equal(HttpStatusCode.Forbidden, write.StatusCode);
            }

            using var auditResp = await admin.GetAsync("/v1/audit?action=machine.setpoint.write.denied&limit=1000");
            var page = await auditResp.Content.ReadFromJsonAsync<AuditPageDto>(JsonOptions);
            var entry = Assert.Single(page!.Items, e => e.TargetId == code);
            Assert.Equal("machine", entry.TargetType);
            Assert.Contains("ROLE_DENIED", entry.NewValueJson, StringComparison.Ordinal);
            Assert.Contains("Operator", entry.NewValueJson, StringComparison.Ordinal);
        }
    }

    /// <summary>An anonymous (unauthenticated) caller is NOT audited by this handler — that is a 401
    /// Challenge, not a Forbid; <see cref="Microsoft.AspNetCore.Authorization.PolicyAuthorizationResult.Forbidden"/>
    /// is specifically false for that case (see <see cref="MachineWriteRoleDenialAuditHandler"/>'s own doc
    /// comment for why only an IDENTIFIED, insufficiently-privileged caller is the case worth recording here).</summary>
    [Fact]
    public async Task Command_Unauthenticated_401_NeverAudited()
    {
        await using var factory = await CreateFactoryAsync();
        var (admin, _, _) = await SetUpAllRolesAsync(factory, "anon-not-audited");
        using (admin)
        {
            const string code = "MW-ANON-01";
            using var anonymous = factory.CreateClient();

            using (var invoke = await anonymous.PostAsJsonAsync(
                       $"/v1/machines/{code}/command", new { command = "start-cycle" }, JsonOptions))
            {
                Assert.Equal(HttpStatusCode.Unauthorized, invoke.StatusCode);
            }

            using var auditResp = await admin.GetAsync("/v1/audit?action=machine.command.invoke.denied&limit=1000");
            var page = await auditResp.Content.ReadFromJsonAsync<AuditPageDto>(JsonOptions);
            Assert.Empty(page!.Items.Where(e => e.TargetId == code));
        }
    }

    // ─────────────────────────────────────────────────────────────────────
    // Every not-available case, distinguished — never one generic error.
    // ─────────────────────────────────────────────────────────────────────

    [Fact]
    public async Task Setpoint_UnknownMachine_404()
    {
        await using var factory = await CreateFactoryAsync();
        var (admin, engineer, _) = await SetUpAllRolesAsync(factory, "notfound");
        using (admin) using (engineer)
        {
            using var write = await engineer.PostAsJsonAsync(
                "/v1/machines/NO-SUCH-MACHINE/setpoint", new { point = "speed", value = 1.0 }, JsonOptions);
            Assert.Equal(HttpStatusCode.NotFound, write.StatusCode);
        }
    }

    [Fact]
    public async Task Setpoint_MachineKnownButFleetNeverStarted_409_NoLiveDriver()
    {
        await using var factory = await CreateFactoryAsync();
        var (admin, engineer, _) = await SetUpAllRolesAsync(factory, "nolivedriver");
        using (admin) using (engineer)
        {
            var host = factory.Services.GetRequiredService<FleetHost>();
            const string code = "MW-NOLIVE-01";
            Assert.True(host.RegisterMachine(NewModbusStyleMachine(code)));
            // Deliberately never Start()ed.

            using var write = await engineer.PostAsJsonAsync(
                $"/v1/machines/{code}/setpoint", new { point = "speed", value = 1.0 }, JsonOptions);

            Assert.Equal(HttpStatusCode.Conflict, write.StatusCode);
            var body = await write.Content.ReadFromJsonAsync<MachineWriteUnavailableDto>(JsonOptions);
            Assert.NotNull(body);
            Assert.Equal("NO_LIVE_DRIVER", body!.Reason);
            Assert.False(string.IsNullOrWhiteSpace(body.Error));
        }
    }

    [Fact]
    public async Task Setpoint_ReadOnlyDriver_409_ReadOnly()
    {
        await using var factory = await CreateFactoryAsync();
        var (admin, engineer, _) = await SetUpAllRolesAsync(factory, "readonly");
        using (admin) using (engineer)
        {
            // No ST4I_DEMO_ENABLED in this test harness (Live mode, matching LineEndpointsTests' own
            // CreateFactoryAsync) — the built-in demo roster is NOT auto-populated (LoadFleet's own
            // demoMode-gated fallback to BuildDefaultFleet), so this test registers its OWN Simulated-kind
            // machine directly rather than depending on "SCRW-01" existing at all.
            var host = factory.Services.GetRequiredService<FleetHost>();
            const string code = "MW-READONLY-01";
            var descriptor = new MachineDescriptor(
                code, $"SN-{code}", DeviceClass.Automation, "SCREWDRIVE", "screw_tightening",
                DriverKinds.Simulated, "RC-TEST-A", null, CycleSeconds: 0.1);
            Assert.True(host.RegisterMachine(descriptor));

            host.Start();
            try
            {
                await WaitUntilAsync(
                    () => host.GetMachineDriverAvailability(code) == MachineDriverAvailability.ReadOnly,
                    "the simulated machine to come online as ReadOnly");

                // The simulated group's own driver (ScenarioAwareDriver wrapping SimulatedDriver) never
                // implements IWritableDeviceDriver.
                using var write = await engineer.PostAsJsonAsync(
                    $"/v1/machines/{code}/setpoint", new { point = "speed", value = 1.0 }, JsonOptions);

                Assert.Equal(HttpStatusCode.Conflict, write.StatusCode);
                var body = await write.Content.ReadFromJsonAsync<MachineWriteUnavailableDto>(JsonOptions);
                Assert.NotNull(body);
                Assert.Equal("READ_ONLY", body!.Reason);
            }
            finally
            {
                host.Stop();
            }
        }
    }

    [Fact]
    public async Task Setpoint_AmbiguousDriver_409_AmbiguousDriver()
    {
        await using var factory = await CreateFactoryAsync();
        var (admin, engineer, _) = await SetUpAllRolesAsync(factory, "ambiguous");
        using (admin) using (engineer)
        {
            var host = factory.Services.GetRequiredService<FleetHost>();
            const string codeA = "MW-AMBIG-A-01";
            const string codeB = "MW-AMBIG-B-01";
            var fakeDriver = new FakeWritableDriver();

            Assert.True(host.RegisterMachine(NewModbusStyleMachine(codeA)));
            Assert.True(host.RegisterMachine(NewModbusStyleMachine(codeB)));
            host.AdditionalPipelinesForTests = () => new List<(string Label, IDeviceDriver Driver, MappingProfile Profile)>
            {
                ("modbus", fakeDriver, TestProfile("modbus")),
            };
            host.Start();
            try
            {
                await WaitUntilAsync(
                    () => host.GetDriverHealth().Any(s => s.SlotLabel == "modbus"),
                    "the shared modbus slot to come up");

                using var write = await engineer.PostAsJsonAsync(
                    $"/v1/machines/{codeA}/setpoint", new { point = "speed", value = 1.0 }, JsonOptions);

                Assert.Equal(HttpStatusCode.Conflict, write.StatusCode);
                var body = await write.Content.ReadFromJsonAsync<MachineWriteUnavailableDto>(JsonOptions);
                Assert.NotNull(body);
                Assert.Equal("AMBIGUOUS_DRIVER", body!.Reason);
                Assert.Equal(0, fakeDriver.WriteCallCount); // never reached the driver — the wrong-machine hazard.
            }
            finally
            {
                host.AdditionalPipelinesForTests = null;
                host.Stop();
            }
        }
    }

    // ─────────────────────────────────────────────────────────────────────
    // Audit rows: applied, rejected, failed, indeterminate, policy-denied. The Indeterminate row must not
    // read as success or failure.
    // ─────────────────────────────────────────────────────────────────────

    [Fact]
    public async Task Setpoint_Applied_Returns200_AndAuditRowRecordsApplied()
    {
        await using var factory = await CreateFactoryAsync();
        var (admin, engineer, _) = await SetUpAllRolesAsync(factory, "applied");
        using (admin) using (engineer)
        {
            const string code = "MW-APPLIED-01";
            var fakeDriver = new FakeWritableDriver();
            var host = await SetUpWritableMachineAsync(factory, code, fakeDriver);
            try
            {
                using var write = await engineer.PostAsJsonAsync(
                    $"/v1/machines/{code}/setpoint", new { point = "speed", value = 42.5 }, JsonOptions);
                Assert.Equal(HttpStatusCode.OK, write.StatusCode);

                var result = await write.Content.ReadFromJsonAsync<MachineSetpointWriteResponseDto>(JsonOptionsWithEnums);
                Assert.NotNull(result);
                Assert.Equal(code, result!.MachineCode);
                Assert.Equal(WriteOutcome.Applied, result.Result.Outcome);
                Assert.Equal(1, fakeDriver.WriteCallCount);
                Assert.Equal(42.5, fakeDriver.LastWriteRequest?.Value);

                using var auditResp = await admin.GetAsync($"/v1/audit?action=machine.setpoint.write&limit=1000");
                var page = await auditResp.Content.ReadFromJsonAsync<AuditPageDto>(JsonOptions);
                var entry = Assert.Single(page!.Items, e => e.TargetId == code);
                Assert.Equal("machine", entry.TargetType);
                Assert.Contains("42.5", entry.NewValueJson);
                Assert.Contains("Applied", entry.NewValueJson, StringComparison.OrdinalIgnoreCase);
            }
            finally
            {
                host.AdditionalPipelinesForTests = null;
                host.Stop();
            }
        }
    }

    [Fact]
    public async Task Setpoint_Rejected_Returns200_AndAuditRowRecordsRejected()
    {
        await using var factory = await CreateFactoryAsync();
        var (admin, engineer, _) = await SetUpAllRolesAsync(factory, "rejected");
        using (admin) using (engineer)
        {
            const string code = "MW-REJECTED-01";
            var fakeDriver = new FakeWritableDriver
            {
                OnWrite = req => new SetpointWriteResult(req.Point, WriteOutcome.Rejected, SetpointRejectionReason.OutOfRange, "99999 exceeds declared max 500"),
            };
            var host = await SetUpWritableMachineAsync(factory, code, fakeDriver);
            try
            {
                using var write = await engineer.PostAsJsonAsync(
                    $"/v1/machines/{code}/setpoint", new { point = "speed", value = 99999.0 }, JsonOptions);
                Assert.Equal(HttpStatusCode.OK, write.StatusCode); // deliberately 200 — see MachineWriteEndpoints' own doc comment.

                var result = await write.Content.ReadFromJsonAsync<MachineSetpointWriteResponseDto>(JsonOptionsWithEnums);
                Assert.Equal(WriteOutcome.Rejected, result!.Result.Outcome);
                Assert.Equal(SetpointRejectionReason.OutOfRange, result.Result.RejectionReason);

                using var auditResp = await admin.GetAsync("/v1/audit?action=machine.setpoint.write&limit=1000");
                var page = await auditResp.Content.ReadFromJsonAsync<AuditPageDto>(JsonOptions);
                var entry = Assert.Single(page!.Items, e => e.TargetId == code);
                Assert.Contains("Rejected", entry.NewValueJson, StringComparison.OrdinalIgnoreCase);
                Assert.Contains("OutOfRange", entry.NewValueJson, StringComparison.OrdinalIgnoreCase);
            }
            finally
            {
                host.AdditionalPipelinesForTests = null;
                host.Stop();
            }
        }
    }

    [Fact]
    public async Task Setpoint_Failed_Returns200_AndAuditRowRecordsFailed()
    {
        await using var factory = await CreateFactoryAsync();
        var (admin, engineer, _) = await SetUpAllRolesAsync(factory, "failed");
        using (admin) using (engineer)
        {
            const string code = "MW-FAILED-01";
            var fakeDriver = new FakeWritableDriver
            {
                OnWrite = req => new SetpointWriteResult(req.Point, WriteOutcome.Failed, Detail: "device returned NAK"),
            };
            var host = await SetUpWritableMachineAsync(factory, code, fakeDriver);
            try
            {
                using var write = await engineer.PostAsJsonAsync(
                    $"/v1/machines/{code}/setpoint", new { point = "speed", value = 10.0 }, JsonOptions);
                Assert.Equal(HttpStatusCode.OK, write.StatusCode);

                var result = await write.Content.ReadFromJsonAsync<MachineSetpointWriteResponseDto>(JsonOptionsWithEnums);
                Assert.Equal(WriteOutcome.Failed, result!.Result.Outcome);

                using var auditResp = await admin.GetAsync("/v1/audit?action=machine.setpoint.write&limit=1000");
                var page = await auditResp.Content.ReadFromJsonAsync<AuditPageDto>(JsonOptions);
                var entry = Assert.Single(page!.Items, e => e.TargetId == code);
                Assert.Contains("Failed", entry.NewValueJson, StringComparison.OrdinalIgnoreCase);
                Assert.Contains("NAK", entry.NewValueJson, StringComparison.Ordinal);
            }
            finally
            {
                host.AdditionalPipelinesForTests = null;
                host.Stop();
            }
        }
    }

    /// <summary>The load-bearing "Indeterminate must not read as success or failure" proof. Verified two
    /// ways: (1) the strongly-typed response/audit deserialization proves the OUTCOME ITSELF is
    /// <see cref="WriteOutcome.Indeterminate"/>, a distinct enum member from <see cref="WriteOutcome.Applied"/>/
    /// <see cref="WriteOutcome.Failed"/> — not something a caller could mistake for either by construction; (2)
    /// the raw audit JSON text is asserted to contain "Indeterminate" and to NOT contain "Applied"/"Failed" as
    /// the outcome value — proving the row does not ALSO carry a conflicting/flattened success-or-failure
    /// signal alongside it.</summary>
    [Fact]
    public async Task Setpoint_Indeterminate_Returns200_AuditRowRecordsIndeterminate_NeverFlattenedToSuccessOrFailure()
    {
        await using var factory = await CreateFactoryAsync();
        var (admin, engineer, _) = await SetUpAllRolesAsync(factory, "indeterminate");
        using (admin) using (engineer)
        {
            const string code = "MW-INDETERMINATE-01";
            var fakeDriver = new FakeWritableDriver
            {
                OnWrite = req => new SetpointWriteResult(req.Point, WriteOutcome.Indeterminate, Detail: "write timed out after 3000ms — device state unconfirmed"),
            };
            var host = await SetUpWritableMachineAsync(factory, code, fakeDriver);
            try
            {
                using var write = await engineer.PostAsJsonAsync(
                    $"/v1/machines/{code}/setpoint", new { point = "speed", value = 10.0 }, JsonOptions);
                Assert.Equal(HttpStatusCode.OK, write.StatusCode);

                var result = await write.Content.ReadFromJsonAsync<MachineSetpointWriteResponseDto>(JsonOptionsWithEnums);
                Assert.NotNull(result);
                Assert.Equal(WriteOutcome.Indeterminate, result!.Result.Outcome);
                Assert.NotEqual(WriteOutcome.Applied, result.Result.Outcome);
                Assert.NotEqual(WriteOutcome.Failed, result.Result.Outcome);
                Assert.Contains("unconfirmed", result.Result.Detail);

                using var auditResp = await admin.GetAsync("/v1/audit?action=machine.setpoint.write&limit=1000");
                var page = await auditResp.Content.ReadFromJsonAsync<AuditPageDto>(JsonOptions);
                var entry = Assert.Single(page!.Items, e => e.TargetId == code);

                using var doc = JsonDocument.Parse(entry.NewValueJson!);
                var outcomeText = doc.RootElement.GetProperty("outcome").GetString();
                Assert.Equal("Indeterminate", outcomeText, ignoreCase: true);
                Assert.NotEqual("Applied", outcomeText, StringComparer.OrdinalIgnoreCase);
                Assert.NotEqual("Failed", outcomeText, StringComparer.OrdinalIgnoreCase);
                Assert.Contains("unconfirmed", entry.NewValueJson, StringComparison.OrdinalIgnoreCase);
            }
            finally
            {
                host.AdditionalPipelinesForTests = null;
                host.Stop();
            }
        }
    }

    /// <summary>The command-side mirror — B-1's higher-risk member gets the same coverage, not a weaker
    /// "same handling" assumption.</summary>
    [Fact]
    public async Task Command_Indeterminate_Returns200_AuditRowRecordsIndeterminate()
    {
        await using var factory = await CreateFactoryAsync();
        var (admin, _, _) = await SetUpAllRolesAsync(factory, "cmd-indeterminate");
        using (admin)
        {
            const string code = "MW-CMD-INDETERMINATE-01";
            var fakeDriver = new FakeWritableDriver
            {
                OnCommand = req => new CommandResult(req.Command, WriteOutcome.Indeterminate, Detail: "did not complete — unconfirmed; check the machine before retrying"),
            };
            var host = await SetUpWritableMachineAsync(factory, code, fakeDriver);
            try
            {
                using var invoke = await admin.PostAsJsonAsync(
                    $"/v1/machines/{code}/command", new { command = "start-cycle" }, JsonOptions);
                Assert.Equal(HttpStatusCode.OK, invoke.StatusCode);

                var result = await invoke.Content.ReadFromJsonAsync<MachineCommandInvokeResponseDto>(JsonOptionsWithEnums);
                Assert.Equal(WriteOutcome.Indeterminate, result!.Result.Outcome);

                using var auditResp = await admin.GetAsync("/v1/audit?action=machine.command.invoke&limit=1000");
                var page = await auditResp.Content.ReadFromJsonAsync<AuditPageDto>(JsonOptions);
                var entry = Assert.Single(page!.Items, e => e.TargetId == code);
                using var doc = JsonDocument.Parse(entry.NewValueJson!);
                Assert.Equal("Indeterminate", doc.RootElement.GetProperty("outcome").GetString(), ignoreCase: true);
            }
            finally
            {
                host.AdditionalPipelinesForTests = null;
                host.Stop();
            }
        }
    }

    /// <summary>Policy-denied is audited too — the "who, when, which machine, which point, the requested
    /// value" investigator requirement applied to the refused path, not just the applied/rejected/failed/
    /// indeterminate one. Uses the HALT-engaged denial specifically (not a bare role mismatch): a role-based
    /// inner <c>PolicyEngine</c> denial for either machine-write action is UNREACHABLE over HTTP by
    /// construction — the OUTER <c>RequireAuthorization</c> gate on the route already carries the identical
    /// role threshold <c>RoleObligationRule</c> would apply (RbacPolicyTests enforces the two stay in sync),
    /// so a caller lacking that role never reaches this handler at all (403 from the framework, before any
    /// of this class's own code runs — nothing for THIS class to audit). SAFETY_BLOCKED, by contrast, is
    /// reachable by an Engineer who fully satisfies the route's own RBAC — proving the "policy-denied" audit
    /// path itself carries the requested point/value, regardless of WHICH rule produced the denial.</summary>
    [Fact]
    public async Task Setpoint_PolicyDenied_HaltEngaged_AuditRowRecordsMachineAndRequestedValue()
    {
        await using var factory = await CreateFactoryAsync();
        var (admin, engineer, _) = await SetUpAllRolesAsync(factory, "denied-audit");
        using (admin) using (engineer)
        {
            const string code = "MW-DENIED-AUDIT-01";

            using (var estop = await admin.PostAsync("/v1/fleet/estop", null))
            {
                Assert.Equal(HttpStatusCode.OK, estop.StatusCode);
            }

            using (var write = await engineer.PostAsJsonAsync(
                       $"/v1/machines/{code}/setpoint", new { point = "speed", value = 77.0 }, JsonOptions))
            {
                Assert.Equal(HttpStatusCode.Conflict, write.StatusCode);
            }

            using var auditResp = await admin.GetAsync("/v1/audit?action=machine.setpoint.write.denied&limit=1000");
            var page = await auditResp.Content.ReadFromJsonAsync<AuditPageDto>(JsonOptions);
            var entry = Assert.Single(page!.Items, e => e.TargetId == code);
            Assert.Equal("machine", entry.TargetType);
            Assert.Contains("SAFETY_BLOCKED", entry.NewValueJson, StringComparison.Ordinal);
            Assert.Contains("77", entry.NewValueJson, StringComparison.Ordinal);
            Assert.Contains("speed", entry.NewValueJson, StringComparison.Ordinal);
        }
    }

    /// <summary>Fix round 1 (review) — a genuine contradiction the reviewer caught: the applied/rejected/
    /// failed/indeterminate path deliberately uses <see cref="CancellationToken.None"/> so an aborted client
    /// cannot make its audit row vanish, but the DENIED path was still passing the request's own (possibly
    /// already-cancelled) token into <see cref="PolicyResults.DenyAsync"/> — the identical hazard, unfixed, one
    /// branch over.
    ///
    /// <para>Proven directly, not via HTTP (a genuinely-aborted HTTP request cannot be observed from the test
    /// side): calls <see cref="MachineWriteEndpoints.WriteSetpointAsync"/> — the real, shipped, <c>internal</c>
    /// handler (<c>InternalsVisibleTo</c>) — with a <see cref="CancelingAlarmStore"/> test double standing in
    /// for the pre-flight Critical-alarm read. That read is DELIBERATELY still cancellable (see this class's
    /// own doc comment, "Cancellation" — it's a read, safe to abort) and completes successfully, but as a SIDE
    /// EFFECT of completing, it cancels the SAME token the request is using — modeling "the client disconnected
    /// at the exact moment its pre-flight read finished, right before the deny/audit step." HALT is engaged so
    /// the outcome is a deterministic <c>SAFETY_BLOCKED</c> deny. Asserts (1) the call completes without
    /// throwing despite the now-cancelled token and (2) the resulting audit row genuinely exists in the real,
    /// SQLite-backed store afterward — before this fix, <c>recorder.RecordAsync(ctx, ..., ct)</c> would have
    /// received the cancelled token, <c>SqliteAuditStore.AppendAsync</c> would have thrown
    /// <see cref="OperationCanceledException"/>, and <see cref="AuditRecorder"/>'s own never-throws catch would
    /// have silently swallowed it — no row, no exception, nothing visible at all.</para></summary>
    [Fact]
    public async Task Setpoint_DeniedPath_AuditRowSurvives_EvenWhenTheClientDisconnectsRightBeforeTheDenyIsRecorded()
    {
        await using var factory = await CreateFactoryAsync();
        var (admin, _, _) = await SetUpAllRolesAsync(factory, "cancel-survives-deny");
        using (admin)
        {
            const string code = "MW-CANCEL-DENY-01";

            var host = factory.Services.GetRequiredService<FleetHost>();
            host.Estop(); // guarantees a deterministic SAFETY_BLOCKED deny below.

            var recorder = factory.Services.GetRequiredService<AuditRecorder>();
            var policy = factory.Services.GetRequiredService<PolicyEngine>();

            var ctx = new DefaultHttpContext { RequestServices = factory.Services };
            ctx.User = new ClaimsPrincipal(new ClaimsIdentity(
                new[]
                {
                    new Claim(ClaimTypes.Name, "cancel-survives-engineer"),
                    new Claim(ClaimTypes.Role, Roles.Engineer),
                },
                authenticationType: "TestAuth"));

            using var cts = new CancellationTokenSource();
            var fakeAlarms = new CancelingAlarmStore(cts);

            var body = new MachineSetpointWriteRequestDto("speed", JsonSerializer.SerializeToElement(1.0));

            // The load-bearing assertion, part 1: does not throw despite the token being cancelled mid-call.
            var result = await MachineWriteEndpoints.WriteSetpointAsync(
                code, body, host, fakeAlarms, ctx, recorder, policy, cts.Token);
            Assert.NotNull(result);
            Assert.True(cts.IsCancellationRequested); // sanity — the cancellation genuinely happened.

            // The load-bearing assertion, part 2: the denial was still audited — a real, persisted row.
            using var auditResp = await admin.GetAsync("/v1/audit?action=machine.setpoint.write.denied&limit=1000");
            var page = await auditResp.Content.ReadFromJsonAsync<AuditPageDto>(JsonOptions);
            Assert.Contains(page!.Items, e => e.TargetId == code);
        }
    }

    /// <summary>A real <see cref="IAlarmStore"/> stand-in whose <see cref="ListActiveAsync"/> reports no active
    /// alarms (so <c>EstopGuardRule</c>'s <c>SAFETY_BLOCKED</c> is the only thing denying) but, as a side
    /// effect of completing, cancels the SAME token the caller is using — see
    /// <see cref="Setpoint_DeniedPath_AuditRowSurvives_EvenWhenTheClientDisconnectsRightBeforeTheDenyIsRecorded"/>'s
    /// own doc comment for exactly what race this models.</summary>
    private sealed class CancelingAlarmStore : IAlarmStore
    {
        private readonly CancellationTokenSource _cts;
        public CancelingAlarmStore(CancellationTokenSource cts) => _cts = cts;

        public Task<AlarmTransition> RaiseAsync(AlarmRaise raise, CancellationToken ct = default) =>
            Task.FromResult(AlarmTransition.None);

        public Task<AlarmTransition> ClearAsync(string key, CancellationToken ct = default) =>
            Task.FromResult(AlarmTransition.None);
        public Task<Alarm?> AckAsync(long id, string by, CancellationToken ct = default) => Task.FromResult<Alarm?>(null);

        public Task<IReadOnlyList<Alarm>> ListActiveAsync(CancellationToken ct = default)
        {
            _cts.Cancel();
            return Task.FromResult<IReadOnlyList<Alarm>>(Array.Empty<Alarm>());
        }

        public Task<AlarmHistoryPage> QueryHistoryAsync(AlarmHistoryFilter filter, CancellationToken ct = default) =>
            Task.FromResult(new AlarmHistoryPage(Array.Empty<AlarmHistoryEntry>(), 0, filter.Limit, filter.Offset));
    }

    // ─────────────────────────────────────────────────────────────────────
    // The Critical-alarm decision: blocks a write/command; a High-priority alarm (e.g. Identity's own,
    // deliberately capped there) does NOT.
    // ─────────────────────────────────────────────────────────────────────

    [Fact]
    public async Task Setpoint_CriticalAlarmActive_Refused_NotReady()
    {
        await using var factory = await CreateFactoryAsync();
        var (admin, engineer, _) = await SetUpAllRolesAsync(factory, "critical-blocks");
        using (admin) using (engineer)
        {
            const string code = "MW-CRITICAL-01";
            var fakeDriver = new FakeWritableDriver();
            var host = await SetUpWritableMachineAsync(factory, code, fakeDriver);
            try
            {
                var alarms = factory.Services.GetRequiredService<IAlarmStore>();
                await alarms.RaiseAsync(new AlarmRaise(
                    AlarmSource.DriverHealth, "TEST_CRITICAL", AlarmPriority.Critical, "test-induced critical alarm",
                    TargetId: "test-critical"));

                using var write = await engineer.PostAsJsonAsync(
                    $"/v1/machines/{code}/setpoint", new { point = "speed", value = 1.0 }, JsonOptions);

                Assert.Equal(HttpStatusCode.Conflict, write.StatusCode);
                var deny = await write.Content.ReadFromJsonAsync<PolicyDenyDto>(JsonOptions);
                Assert.NotNull(deny);
                Assert.Equal("NOT_READY", deny!.Reason);
                Assert.Equal(0, fakeDriver.WriteCallCount); // never reached the driver.
            }
            finally
            {
                host.AdditionalPipelinesForTests = null;
                host.Stop();
            }
        }
    }

    [Fact]
    public async Task Command_CriticalAlarmActive_Refused_NotReady()
    {
        await using var factory = await CreateFactoryAsync();
        var (admin, _, _) = await SetUpAllRolesAsync(factory, "critical-blocks-cmd");
        using (admin)
        {
            const string code = "MW-CRITICAL-CMD-01";
            var fakeDriver = new FakeWritableDriver();
            var host = await SetUpWritableMachineAsync(factory, code, fakeDriver);
            try
            {
                var alarms = factory.Services.GetRequiredService<IAlarmStore>();
                await alarms.RaiseAsync(new AlarmRaise(
                    AlarmSource.DriverHealth, "TEST_CRITICAL_CMD", AlarmPriority.Critical, "test-induced critical alarm",
                    TargetId: "test-critical-cmd"));

                using var invoke = await admin.PostAsJsonAsync(
                    $"/v1/machines/{code}/command", new { command = "start-cycle" }, JsonOptions);

                Assert.Equal(HttpStatusCode.Conflict, invoke.StatusCode);
                var deny = await invoke.Content.ReadFromJsonAsync<PolicyDenyDto>(JsonOptions);
                Assert.Equal("NOT_READY", deny!.Reason);
                Assert.Equal(0, fakeDriver.CommandCallCount);
            }
            finally
            {
                host.AdditionalPipelinesForTests = null;
                host.Stop();
            }
        }
    }

    /// <summary>Fix round 1 (review, Important I1) — reproduces the reviewer's exact 3-step probe proving the
    /// self-latch is closed: a HALT-blocked write raises a Critical <c>Policy</c> alarm (pre-existing,
    /// unrelated behavior — <c>LineEndpointsTests</c> already pins it); before the fix, that very alarm then
    /// blocked EVERY subsequent write with <c>NOT_READY</c> until an operator found and acknowledged it — the
    /// most ordinary operator sequence in the product ("halt, reset, retry") self-disabled machine-write
    /// capability. This test proves step 3 (retry after reset) succeeds DESPITE the step-1 alarm remaining
    /// active/unacknowledged the whole time — the fix must hold without anyone touching that alarm at
    /// all.</summary>
    [Fact]
    public async Task Setpoint_AfterAHaltBlockedAttemptThenReset_SecondWriteSucceeds_DespiteTheUnackedPolicyAlarmFromTheFirst()
    {
        await using var factory = await CreateFactoryAsync();
        var (admin, engineer, _) = await SetUpAllRolesAsync(factory, "no-self-latch");
        using (admin) using (engineer)
        {
            const string code = "MW-NOSELFLATCH-01";
            var fakeDriver = new FakeWritableDriver();
            var host = await SetUpWritableMachineAsync(factory, code, fakeDriver);
            try
            {
                // Step 0 (latch clear) — sanity: the write path genuinely works before any of this.
                using (var baseline = await engineer.PostAsJsonAsync(
                           $"/v1/machines/{code}/setpoint", new { point = "speed", value = 1.0 }, JsonOptions))
                {
                    Assert.Equal(HttpStatusCode.OK, baseline.StatusCode);
                }

                // Step 1 (HALT latched) — the write is refused SAFETY_BLOCKED, which raises a Critical Policy alarm.
                using (var estop = await admin.PostAsync("/v1/fleet/estop", null))
                {
                    Assert.Equal(HttpStatusCode.OK, estop.StatusCode);
                }

                using (var blocked = await engineer.PostAsJsonAsync(
                           $"/v1/machines/{code}/setpoint", new { point = "speed", value = 2.0 }, JsonOptions))
                {
                    Assert.Equal(HttpStatusCode.Conflict, blocked.StatusCode);
                    var deny = await blocked.Content.ReadFromJsonAsync<PolicyDenyDto>(JsonOptions);
                    Assert.Equal("SAFETY_BLOCKED", deny!.Reason);
                }

                // Step 2 (HALT reset) — the latch clears, but the Policy/Critical alarm from step 1 is still
                // active and UNACKNOWLEDGED (nobody has hit /v1/alarms/{id}/ack). ResetEstop only clears the
                // latch (PackML Reset -> Idle, not Execute) — the pipeline itself was torn down by Estop(), so
                // Start() must be called again before the machine has a live driver to write to at all (a
                // separate, unrelated fact from the alarm/policy question this test is actually about).
                using (var reset = await admin.PostAsync("/v1/fleet/estop/reset", null))
                {
                    Assert.Equal(HttpStatusCode.OK, reset.StatusCode);
                }

                using (var activeAlarms = await admin.GetAsync("/v1/alarms"))
                {
                    var alarms = await activeAlarms.Content.ReadFromJsonAsync<List<Alarm>>(JsonOptionsWithEnums);
                    Assert.Contains(alarms!, a => a.Source == AlarmSource.Policy && a.Priority == AlarmPriority.Critical && a.State != AlarmState.Cleared);
                }

                host.Start();
                await WaitUntilAsync(
                    () => host.GetMachineDriverAvailability(code) == MachineDriverAvailability.Writable,
                    "the writable driver's slot to come back up after the HALT/reset cycle");

                // Step 3 — THE LOAD-BEARING ASSERTION: a second write now succeeds, even though the step-1
                // Policy/Critical alarm is still sitting there, unacknowledged. Before this fix, this returned
                // 409 NOT_READY (the self-latch).
                using (var retried = await engineer.PostAsJsonAsync(
                           $"/v1/machines/{code}/setpoint", new { point = "speed", value = 3.0 }, JsonOptions))
                {
                    Assert.Equal(HttpStatusCode.OK, retried.StatusCode);
                }

                Assert.Equal(2, fakeDriver.WriteCallCount); // step 0 + step 3 reached the driver; step 1's did not (denied pre-flight).
            }
            finally
            {
                host.AdditionalPipelinesForTests = null;
                host.Stop();
            }
        }
    }

    /// <summary>The other half of the Critical-alarm decision, proven empirically rather than assumed: a
    /// High-priority alarm (mirroring the Identity-expiry alarm's own deliberate cap — "an expiring
    /// certificate must never stop production") does NOT reach this gate. If <see cref="Policy.Rules.CriticalAlarmGuardRule"/>
    /// were accidentally written to check "any active alarm" instead of specifically Critical priority, this
    /// test would fail (409 instead of 200).</summary>
    [Fact]
    public async Task Setpoint_OnlyHighPriorityAlarmActive_NeverBlocked_OnlyCriticalDoes()
    {
        await using var factory = await CreateFactoryAsync();
        var (admin, engineer, _) = await SetUpAllRolesAsync(factory, "high-not-blocking");
        using (admin) using (engineer)
        {
            const string code = "MW-HIGHALARM-01";
            var fakeDriver = new FakeWritableDriver();
            var host = await SetUpWritableMachineAsync(factory, code, fakeDriver);
            try
            {
                var alarms = factory.Services.GetRequiredService<IAlarmStore>();
                // Mirrors the ACTUAL Identity-expiry alarm's own shape (AlarmSource.Identity, capped at High)
                // — see AlarmEvaluator's own doc comment for why it is deliberately never Critical.
                await alarms.RaiseAsync(new AlarmRaise(
                    AlarmSource.Identity, "EXPIRING", AlarmPriority.High,
                    "device identity certificate expires soon", TargetId: "device"));

                using var write = await engineer.PostAsJsonAsync(
                    $"/v1/machines/{code}/setpoint", new { point = "speed", value = 5.0 }, JsonOptions);

                Assert.Equal(HttpStatusCode.OK, write.StatusCode);
                Assert.Equal(1, fakeDriver.WriteCallCount);
            }
            finally
            {
                host.AdditionalPipelinesForTests = null;
                host.Stop();
            }
        }
    }

    // ─────────────────────────────────────────────────────────────────────
    // Request-shape validation and value narrowing at the wire boundary.
    // ─────────────────────────────────────────────────────────────────────

    [Fact]
    public async Task Setpoint_MissingPoint_400()
    {
        await using var factory = await CreateFactoryAsync();
        var (admin, engineer, _) = await SetUpAllRolesAsync(factory, "missing-point");
        using (admin) using (engineer)
        {
            using var write = await engineer.PostAsJsonAsync("/v1/machines/ANY/setpoint", new { value = 1.0 }, JsonOptions);
            Assert.Equal(HttpStatusCode.BadRequest, write.StatusCode);
        }
    }

    [Fact]
    public async Task Setpoint_MissingValue_400()
    {
        await using var factory = await CreateFactoryAsync();
        var (admin, engineer, _) = await SetUpAllRolesAsync(factory, "missing-value");
        using (admin) using (engineer)
        {
            using var write = await engineer.PostAsJsonAsync("/v1/machines/ANY/setpoint", new { point = "speed" }, JsonOptions);
            Assert.Equal(HttpStatusCode.BadRequest, write.StatusCode);
        }
    }

    [Fact]
    public async Task Setpoint_ExplicitNullValue_IsAccepted_AsARealButUnusualWriteAttempt()
    {
        await using var factory = await CreateFactoryAsync();
        var (admin, engineer, _) = await SetUpAllRolesAsync(factory, "null-value");
        using (admin) using (engineer)
        {
            const string code = "MW-NULLVALUE-01";
            var fakeDriver = new FakeWritableDriver();
            var host = await SetUpWritableMachineAsync(factory, code, fakeDriver);
            try
            {
                using var write = await engineer.PostAsJsonAsync(
                    $"/v1/machines/{code}/setpoint", new { point = "speed", value = (double?)null }, JsonOptions);

                // Distinguishable from "value omitted entirely" (400) — an explicit null is a real write
                // attempt (the driver decides what to do with it), never silently rejected as a bad request.
                Assert.Equal(HttpStatusCode.OK, write.StatusCode);
                Assert.Equal(1, fakeDriver.WriteCallCount);
                Assert.Null(fakeDriver.LastWriteRequest?.Value);
            }
            finally
            {
                host.AdditionalPipelinesForTests = null;
                host.Stop();
            }
        }
    }

    [Fact]
    public async Task Setpoint_ValueIsAJsonArray_400_OutOfDomain_NeverReachesTheDriver()
    {
        await using var factory = await CreateFactoryAsync();
        var (admin, engineer, _) = await SetUpAllRolesAsync(factory, "array-value");
        using (admin) using (engineer)
        {
            const string code = "MW-ARRAYVALUE-01";
            var fakeDriver = new FakeWritableDriver();
            var host = await SetUpWritableMachineAsync(factory, code, fakeDriver);
            try
            {
                using var write = await engineer.PostAsJsonAsync(
                    $"/v1/machines/{code}/setpoint", new { point = "speed", value = new[] { 1, 2, 3 } }, JsonOptions);

                Assert.Equal(HttpStatusCode.BadRequest, write.StatusCode);
                Assert.Equal(0, fakeDriver.WriteCallCount);
            }
            finally
            {
                host.AdditionalPipelinesForTests = null;
                host.Stop();
            }
        }
    }

    [Fact]
    public async Task Command_MissingCommand_400()
    {
        await using var factory = await CreateFactoryAsync();
        var (admin, _, _) = await SetUpAllRolesAsync(factory, "missing-command");
        using (admin)
        {
            using var invoke = await admin.PostAsJsonAsync("/v1/machines/ANY/command", new { }, JsonOptions);
            Assert.Equal(HttpStatusCode.BadRequest, invoke.StatusCode);
        }
    }

    [Fact]
    public async Task Command_WithArguments_NarrowedAndForwardedToTheDriver()
    {
        await using var factory = await CreateFactoryAsync();
        var (admin, _, _) = await SetUpAllRolesAsync(factory, "cmd-args");
        using (admin)
        {
            const string code = "MW-CMDARGS-01";
            var fakeDriver = new FakeWritableDriver();
            var host = await SetUpWritableMachineAsync(factory, code, fakeDriver);
            try
            {
                using var invoke = await admin.PostAsJsonAsync(
                    $"/v1/machines/{code}/command",
                    new { command = "start-cycle", arguments = new Dictionary<string, object> { ["speed"] = 12.5, ["enabled"] = true } },
                    JsonOptions);

                Assert.Equal(HttpStatusCode.OK, invoke.StatusCode);
                Assert.Equal(1, fakeDriver.CommandCallCount);
                Assert.NotNull(fakeDriver.LastCommandRequest?.Arguments);
                Assert.Equal(12.5, fakeDriver.LastCommandRequest!.Arguments!["speed"]);
                Assert.Equal(true, fakeDriver.LastCommandRequest.Arguments["enabled"]);
            }
            finally
            {
                host.AdditionalPipelinesForTests = null;
                host.Stop();
            }
        }
    }

    // ─────────────────────────────────────────────────────────────────────
    // Test double
    // ─────────────────────────────────────────────────────────────────────

    /// <summary>A minimal, fully test-controlled <see cref="IWritableDeviceDriver"/> — unlike
    /// <c>FleetHostMachineDriverResolutionTests</c>'s own fake (built to prove the disposal RACE), this one
    /// exists purely to inject a DETERMINISTIC outcome per call (<see cref="OnWrite"/>/<see cref="OnCommand"/>),
    /// so every audit-row test above can assert an exact, chosen <see cref="WriteOutcome"/> without any timing
    /// dependency.</summary>
    private sealed class FakeWritableDriver : IWritableDeviceDriver
    {
        public Func<SetpointWriteRequest, SetpointWriteResult>? OnWrite { get; set; }

        public Func<CommandRequest, CommandResult>? OnCommand { get; set; }

        public int WriteCallCount { get; private set; }

        public int CommandCallCount { get; private set; }

        public SetpointWriteRequest? LastWriteRequest { get; private set; }

        public CommandRequest? LastCommandRequest { get; private set; }

        public string Id => "fake-writable-http-test-driver";

        public string Kind => DriverKinds.Modbus;

        public DriverHealthState Health => DriverHealthState.Connected;

        public IReadOnlyList<string> WritablePoints { get; } = new[] { "speed" };

        public IReadOnlyList<string> Commands { get; } = new[] { "start-cycle" };

        public async IAsyncEnumerable<DeviceReading> ReadAsync([EnumeratorCancellation] CancellationToken ct)
        {
            await Task.Delay(Timeout.Infinite, ct).ConfigureAwait(false);
            yield break; // unreachable — Task.Delay(Infinite, ct) only ever completes by throwing on cancel.
        }

        public ValueTask DisposeAsync() => ValueTask.CompletedTask;

        public Task<SetpointWriteResult> WriteSetpointAsync(SetpointWriteRequest request, CancellationToken ct)
        {
            WriteCallCount++;
            LastWriteRequest = request;
            var result = OnWrite?.Invoke(request) ?? new SetpointWriteResult(request.Point, WriteOutcome.Applied);
            return Task.FromResult(result);
        }

        public Task<CommandResult> InvokeCommandAsync(CommandRequest request, CancellationToken ct)
        {
            CommandCallCount++;
            LastCommandRequest = request;
            var result = OnCommand?.Invoke(request) ?? new CommandResult(request.Command, WriteOutcome.Applied);
            return Task.FromResult(result);
        }
    }
}
