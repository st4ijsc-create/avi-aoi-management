using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.AspNetCore.Routing;
using Microsoft.Extensions.DependencyInjection;
using St4i.EngineApi.Auth;
using St4i.EngineApi.Policy;
using St4i.EngineApi.Safety;
using Xunit;

namespace St4i.EngineApi.Tests.Auth;

/// <summary>
/// G2-4 (WS-G Policy-core, SAFETY-CRITICAL) — real-pipeline proof that the halt latch now turns
/// <c>POST /v1/fleet/start</c> into an explicit, audited 409 <c>SAFETY_BLOCKED</c> denial instead of
/// yesterday's silent 200 no-op, and that the permitted path (not estopped) is completely unaffected.
/// Also formalizes XC-R40: <c>GET /v1/safety</c> is read-only — this class asserts there is no
/// POST/PUT/DELETE route at that path.
///
/// Same real-pipeline <see cref="WebApplicationFactory{TEntryPoint}"/> convention (env-var-swap-then-
/// eager-build, shared <see cref="SecurityEnvVarTests.CollectionName"/> collection tag) as
/// <see cref="RbacPolicyTests"/>/<see cref="AuditWiringTests"/>. <c>demoEnabled: true</c> so every request
/// auto-authenticates as demo-admin (Roles.Admin), which satisfies the Operator policy these fleet routes
/// require.
/// </summary>
[Collection(SecurityEnvVarTests.CollectionName)]
public sealed class PolicyEndpointGatingTests
{
    private static readonly SemaphoreSlim EnvLock = new(1, 1);
    private static readonly JsonSerializerOptions JsonOptions = new(JsonSerializerDefaults.Web);
    private static readonly TimeSpan PollTimeout = TimeSpan.FromSeconds(10);
    private static readonly TimeSpan PollInterval = TimeSpan.FromMilliseconds(100);

    /// <summary>Same env-var-swap-then-eager-build protocol as <c>RbacPolicyTests.CreateFactoryAsync</c>.</summary>
    private static async Task<WebApplicationFactory<Program>> CreateFactoryAsync(bool demoEnabled)
    {
        var securityDir = Directory.CreateTempSubdirectory("st4i-policy-security-").FullName;
        var historianDir = Directory.CreateTempSubdirectory("st4i-policy-historian-").FullName;
        var walDir = Directory.CreateTempSubdirectory("st4i-policy-wal-").FullName;
        var settingsDir = Directory.CreateTempSubdirectory("st4i-policy-settings-").FullName;
        // EC-3 review follow-up — see SiteEndpointsTests' own doc comment: without these, every
        // WebApplicationFactory<Program> boot below (UNS defaults ON) resolves DeviceIdentityStore/
        // SiteLinkStore to the REAL %ProgramData%\ST4I\sim\identity\ / ...\sitelink\.
        var identityDir = Directory.CreateTempSubdirectory("st4i-policy-identity-").FullName;
        var siteLinkDir = Directory.CreateTempSubdirectory("st4i-policy-sitelink-").FullName;
        // GĐ3 sub-4 LC-1 review follow-up — isolated the same way as every other per-concern directory
        // above. This class's own EstopThenStart_Is409SafetyBlocked_... test fires a real SAFETY_BLOCKED
        // DENY DETERMINISTICALLY on every run — PolicyResults.DenyAsync now resolves IAlarmStore and
        // raises an alarm on every such DENY — so without this, EVERY run of this class would write to
        // the REAL %ProgramData%\ST4I\sim\alarms\alarms.db instead of a throwaway temp dir.
        var alarmsDir = Directory.CreateTempSubdirectory("st4i-policy-alarms-").FullName;
        // GĐ3 closeout WI-3 — without this, every WebApplicationFactory<Program> boot below (UNS defaults
        // ON) has Program.cs construct a REAL BridgeSpool against %ProgramData%\ST4I\sim\bridge-spool\.
        var bridgeSpoolDir = Directory.CreateTempSubdirectory("st4i-policy-bridgespool-").FullName;
        var connectorConfigDir = Directory.CreateTempSubdirectory("st4i-policy-connectorconfig-").FullName;

        await EnvLock.WaitAsync().ConfigureAwait(false);
        var prevSecurityDir = Environment.GetEnvironmentVariable("ST4I_SECURITY_DIR");
        var prevDemoEnabled = Environment.GetEnvironmentVariable("ST4I_DEMO_ENABLED");
        var prevHistorianDir = Environment.GetEnvironmentVariable("ST4I_HISTORIAN_DIR");
        var prevWalDir = Environment.GetEnvironmentVariable("ST4I_WAL_DIR");
        var prevSettingsDir = Environment.GetEnvironmentVariable("ST4I_SETTINGS_DIR");
        var prevIdentityDir = Environment.GetEnvironmentVariable("ST4I_IDENTITY_DIR");
        var prevSiteLinkDir = Environment.GetEnvironmentVariable("ST4I_SITELINK_DIR");
        var prevAlarmsDir = Environment.GetEnvironmentVariable("ST4I_ALARMS_DIR");
        var prevBridgeSpoolDir = Environment.GetEnvironmentVariable("ST4I_BRIDGE_SPOOL_DIR");
        var prevConnectorConfigDir = Environment.GetEnvironmentVariable("ST4I_CONNECTOR_CONFIG_DIR");
        var prevEnvironment = Environment.GetEnvironmentVariable("ASPNETCORE_ENVIRONMENT");
        try
        {
            Environment.SetEnvironmentVariable("ST4I_SECURITY_DIR", securityDir);
            Environment.SetEnvironmentVariable("ST4I_DEMO_ENABLED", demoEnabled ? "true" : null);
            Environment.SetEnvironmentVariable("ST4I_HISTORIAN_DIR", historianDir);
            Environment.SetEnvironmentVariable("ST4I_WAL_DIR", walDir);
            Environment.SetEnvironmentVariable("ST4I_SETTINGS_DIR", settingsDir);
            Environment.SetEnvironmentVariable("ST4I_IDENTITY_DIR", identityDir);
            Environment.SetEnvironmentVariable("ST4I_SITELINK_DIR", siteLinkDir);
            Environment.SetEnvironmentVariable("ST4I_ALARMS_DIR", alarmsDir);
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
            Environment.SetEnvironmentVariable("ST4I_IDENTITY_DIR", prevIdentityDir);
            Environment.SetEnvironmentVariable("ST4I_SITELINK_DIR", prevSiteLinkDir);
            Environment.SetEnvironmentVariable("ST4I_ALARMS_DIR", prevAlarmsDir);
            Environment.SetEnvironmentVariable("ST4I_BRIDGE_SPOOL_DIR", prevBridgeSpoolDir);
            Environment.SetEnvironmentVariable("ST4I_CONNECTOR_CONFIG_DIR", prevConnectorConfigDir);
            Environment.SetEnvironmentVariable("ASPNETCORE_ENVIRONMENT", prevEnvironment);
            EnvLock.Release();
        }
    }

    private static async Task WaitUntilAsync(Func<Task<bool>> predicate, string because)
    {
        var deadline = DateTime.UtcNow + PollTimeout;
        while (DateTime.UtcNow < deadline)
        {
            if (await predicate().ConfigureAwait(false)) return;
            await Task.Delay(PollInterval).ConfigureAwait(false);
        }

        Assert.True(await predicate().ConfigureAwait(false), $"timed out after {PollTimeout} waiting for: {because}");
    }

    // ─────────────────────────────────────────────────────────────────────
    // The core SAFETY_BLOCKED promotion: estop → start denied 409 → audited → reset → start permitted again.
    // ─────────────────────────────────────────────────────────────────────

    [Fact]
    public async Task EstopThenStart_Is409SafetyBlocked_Audited_ThenPermittedAgainAfterReset()
    {
        await using var factory = await CreateFactoryAsync(demoEnabled: true);
        using var client = factory.CreateClient(new WebApplicationFactoryClientOptions { HandleCookies = true });

        using (var estop = await client.PostAsync("/v1/fleet/estop", null))
        {
            Assert.Equal(HttpStatusCode.OK, estop.StatusCode);
        }

        // Confirm the latch actually landed before asserting the gated behavior it causes.
        await WaitUntilAsync(async () =>
        {
            using var safety = await client.GetAsync("/v1/safety");
            var body = await safety.Content.ReadFromJsonAsync<JsonElement>();
            return body.GetProperty("estopEngaged").GetBoolean();
        }, "the E-STOP latch to report engaged via GET /v1/safety");

        using (var start = await client.PostAsync("/v1/fleet/start", null))
        {
            Assert.Equal(HttpStatusCode.Conflict, start.StatusCode);
            var deny = await start.Content.ReadFromJsonAsync<PolicyDenyDto>(JsonOptions);
            Assert.NotNull(deny);
            Assert.Equal("SAFETY_BLOCKED", deny!.Reason);
            Assert.False(string.IsNullOrWhiteSpace(deny.Error));
        }

        // The denial itself is audited (deliberate departure from "no audit on pre-mutation rejection").
        using (var audit = await client.GetAsync("/v1/audit?action=fleet.start.denied&limit=1000"))
        {
            Assert.Equal(HttpStatusCode.OK, audit.StatusCode);
            var page = await audit.Content.ReadFromJsonAsync<AuditPageDto>(JsonOptions);
            var entry = Assert.Single(page!.Items);
            Assert.Contains("SAFETY_BLOCKED", entry.NewValueJson);
        }

        using (var reset = await client.PostAsync("/v1/fleet/estop/reset", null))
        {
            Assert.Equal(HttpStatusCode.OK, reset.StatusCode);
        }

        await WaitUntilAsync(async () =>
        {
            using var safety = await client.GetAsync("/v1/safety");
            var body = await safety.Content.ReadFromJsonAsync<JsonElement>();
            return !body.GetProperty("estopEngaged").GetBoolean();
        }, "the E-STOP latch to clear via GET /v1/safety");

        using (var startAgain = await client.PostAsync("/v1/fleet/start", null))
        {
            Assert.Equal(HttpStatusCode.OK, startAgain.StatusCode);
        }
    }

    // ─────────────────────────────────────────────────────────────────────
    // Regression: the permitted path (not estopped) is byte-identical to today — plain 200.
    // ─────────────────────────────────────────────────────────────────────

    [Fact]
    public async Task Start_WhileNotEstopped_Still200_PermittedPathUnchanged()
    {
        await using var factory = await CreateFactoryAsync(demoEnabled: true);
        using var client = factory.CreateClient(new WebApplicationFactoryClientOptions { HandleCookies = true });

        using var start = await client.PostAsync("/v1/fleet/start", null);
        Assert.Equal(HttpStatusCode.OK, start.StatusCode);
    }

    // ─────────────────────────────────────────────────────────────────────
    // XC-R40 — GET /v1/safety: read-only surface, correct payload, and NO write route at this path.
    // ─────────────────────────────────────────────────────────────────────

    [Fact]
    public async Task GetSafety_ReportsLatchAndSupervisoryAdvisory()
    {
        await using var factory = await CreateFactoryAsync(demoEnabled: true);
        using var client = factory.CreateClient(new WebApplicationFactoryClientOptions { HandleCookies = true });

        using (var estop = await client.PostAsync("/v1/fleet/estop", null))
        {
            Assert.Equal(HttpStatusCode.OK, estop.StatusCode);
        }

        await WaitUntilAsync(async () =>
        {
            using var safety = await client.GetAsync("/v1/safety");
            Assert.Equal(HttpStatusCode.OK, safety.StatusCode);
            var dto = await safety.Content.ReadFromJsonAsync<SafetyStatusDto>(JsonOptions);
            return dto is not null && dto.EstopEngaged;
        }, "GET /v1/safety to reflect the just-engaged latch");

        using var final = await client.GetAsync("/v1/safety");
        var body = await final.Content.ReadFromJsonAsync<SafetyStatusDto>(JsonOptions);
        Assert.NotNull(body);
        Assert.True(body!.EstopEngaged);
        Assert.Equal("SupervisorySoftwareLatch", body.SafetyClass);
        Assert.False(string.IsNullOrWhiteSpace(body.Advisory));
    }

    [Fact]
    public async Task SafetyRoute_HasNoWritePath_OnlyGetIsMapped()
    {
        await using var factory = await CreateFactoryAsync(demoEnabled: false);
        var dataSource = factory.Services.GetRequiredService<EndpointDataSource>();

        var safetyRoutes = dataSource.Endpoints
            .OfType<RouteEndpoint>()
            .Where(e => e.RoutePattern.RawText == "/v1/safety")
            .ToList();

        Assert.Single(safetyRoutes);
        var methods = safetyRoutes[0].Metadata.GetMetadata<IHttpMethodMetadata>()?.HttpMethods;
        Assert.NotNull(methods);
        Assert.Single(methods!);
        Assert.Equal("GET", methods![0]);
    }
}
