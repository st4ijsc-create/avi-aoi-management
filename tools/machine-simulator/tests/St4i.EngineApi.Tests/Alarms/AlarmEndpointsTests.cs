using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using System.Text.Json.Serialization;
using Microsoft.AspNetCore.Identity;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.Extensions.DependencyInjection;
using St4i.EngineApi.Alarms;
using St4i.EngineApi.Auth;
using St4i.EngineApi.Tests.Auth;
using Xunit;

namespace St4i.EngineApi.Tests.Alarms;

/// <summary>
/// GĐ3 sub-4 LC-1 — real-pipeline (<c>WebApplicationFactory&lt;Program&gt;</c>) proof that the FIRST alarm
/// SOURCE (<c>PolicyResults.DenyAsync</c>) is wired end to end: E-STOP the fleet, then a
/// SAFETY_BLOCKED-denied <c>POST /v1/fleet/start</c> raises a Critical Policy alarm an Operator can see via
/// <c>GET /v1/alarms</c>; <c>POST /v1/alarms/{id}/ack</c> both clears it (ClearOnAck=true) AND writes an
/// <c>alarm.ack</c> audit row; <c>GET /v1/alarms/history</c> shows the "raised" and "cleared" events. Also
/// covers plain RBAC (401/403) on all three routes. Same env-var-swap-then-eager-build factory recipe as
/// <c>AssetEndpointsTests</c>/<c>RbacPolicyTests</c> (duplicated rather than shared, for the same reasons
/// those classes' own doc comments give) — see <see cref="SecurityEnvVarTests"/>'s doc comment for why this
/// class carries the SAME <c>[Collection(...)]</c> tag.
/// </summary>
[Collection(SecurityEnvVarTests.CollectionName)]
public sealed class AlarmEndpointsTests
{
    private static readonly SemaphoreSlim EnvLock = new(1, 1);
    private static readonly JsonSerializerOptions JsonOptions = new(JsonSerializerDefaults.Web);

    // Alarm/AlarmHistoryEntry carry AlarmSource/AlarmPriority/AlarmState enums, wire-serialized as strings
    // by the app's own ConfigureHttpJsonOptions (Program.cs adds a JsonStringEnumConverter globally) — the
    // plain JsonOptions above has no such converter, so deserializing those two response shapes on the
    // CLIENT side needs its own enum-aware options, same idiom as AssetEndpointsTests' JsonOptionsWithEnums.
    private static readonly JsonSerializerOptions JsonOptionsWithEnums = new(JsonSerializerDefaults.Web)
    {
        Converters = { new JsonStringEnumConverter() },
    };

    private static async Task<WebApplicationFactory<Program>> CreateFactoryAsync()
    {
        var securityDir = Directory.CreateTempSubdirectory("st4i-alarms-ep-security-").FullName;
        var historianDir = Directory.CreateTempSubdirectory("st4i-alarms-ep-historian-").FullName;
        var walDir = Directory.CreateTempSubdirectory("st4i-alarms-ep-wal-").FullName;
        var settingsDir = Directory.CreateTempSubdirectory("st4i-alarms-ep-settings-").FullName;
        var assetsDir = Directory.CreateTempSubdirectory("st4i-alarms-ep-assets-").FullName;
        var alarmsDir = Directory.CreateTempSubdirectory("st4i-alarms-ep-alarms-").FullName;
        // EC-3 review follow-up — see SiteEndpointsTests' own doc comment: without these, every
        // WebApplicationFactory<Program> boot below (UNS defaults ON) resolves DeviceIdentityStore/
        // SiteLinkStore to the REAL %ProgramData%\ST4I\sim\identity\ / ...\sitelink\.
        var identityDir = Directory.CreateTempSubdirectory("st4i-alarms-ep-identity-").FullName;
        var siteLinkDir = Directory.CreateTempSubdirectory("st4i-alarms-ep-sitelink-").FullName;
        // GĐ3 closeout WI-3 — without this, every WebApplicationFactory<Program> boot below (UNS defaults
        // ON) has Program.cs construct a REAL BridgeSpool against %ProgramData%\ST4I\sim\bridge-spool\.
        var bridgeSpoolDir = Directory.CreateTempSubdirectory("st4i-alarms-ep-bridgespool-").FullName;

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

    // ─────────────────────────────────────────────────────────────────────
    // The core end-to-end proof: real E-STOP → real SAFETY_BLOCKED DENY → alarm raised → ack clears it
    // → both events show up in history → the ack itself is audited.
    // ─────────────────────────────────────────────────────────────────────

    [Fact]
    public async Task RealPolicyDeny_RaisesACriticalAlarm_AckClearsIt_HistoryShowsRaisedAndCleared_AckIsAudited()
    {
        await using var factory = await CreateFactoryAsync();
        await BootstrapAdminAsync(factory, "alarms-admin-1", "AdminPass123!");
        await CreateUserAsync(factory, "alarms-operator-1", "OperatorPass123!", Roles.Operator);

        using var operatorClient = await LoginAsAsync(factory, "alarms-operator-1", "OperatorPass123!");

        using (var estop = await operatorClient.PostAsync("/v1/fleet/estop", null))
        {
            Assert.Equal(HttpStatusCode.OK, estop.StatusCode);
        }

        using (var start = await operatorClient.PostAsync("/v1/fleet/start", null))
        {
            Assert.Equal(HttpStatusCode.Conflict, start.StatusCode);
        }

        Alarm alarm;
        using (var listResp = await operatorClient.GetAsync("/v1/alarms"))
        {
            Assert.Equal(HttpStatusCode.OK, listResp.StatusCode);
            var alarms = await listResp.Content.ReadFromJsonAsync<List<Alarm>>(JsonOptionsWithEnums);
            Assert.NotNull(alarms);
            alarm = Assert.Single(alarms!, a => a.Source == AlarmSource.Policy && a.Code == "SAFETY_BLOCKED");
            Assert.Equal(AlarmPriority.Critical, alarm.Priority);
            Assert.Equal(AlarmState.Active, alarm.State);
            Assert.Equal("fleet.start", alarm.TargetId);
            Assert.True(alarm.ClearOnAck);
            Assert.False(string.IsNullOrWhiteSpace(alarm.Runbook));
            // SM-4 — the runbook text was reworded to stop saying "E-STOP"/implying a machine-level
            // effect (it now says plainly this only stopped this software's own data collection, not
            // any machine); this assertion follows that wording, not the old literal string.
            Assert.Contains("halt", alarm.Runbook, StringComparison.OrdinalIgnoreCase);
        }

        using (var ack = await operatorClient.PostAsync($"/v1/alarms/{alarm.Id}/ack", null))
        {
            Assert.Equal(HttpStatusCode.OK, ack.StatusCode);
            var acked = await ack.Content.ReadFromJsonAsync<Alarm>(JsonOptionsWithEnums);
            Assert.NotNull(acked);
            Assert.Equal(AlarmState.Cleared, acked!.State);
            Assert.Equal("alarms-operator-1", acked.AckedBy);
        }

        using (var listAfter = await operatorClient.GetAsync("/v1/alarms"))
        {
            var alarms = await listAfter.Content.ReadFromJsonAsync<List<Alarm>>(JsonOptionsWithEnums);
            Assert.DoesNotContain(alarms!, a => a.Id == alarm.Id);
        }

        using (var historyResp = await operatorClient.GetAsync("/v1/alarms/history"))
        {
            Assert.Equal(HttpStatusCode.OK, historyResp.StatusCode);
            var history = await historyResp.Content.ReadFromJsonAsync<AlarmHistoryPage>(JsonOptionsWithEnums);
            Assert.NotNull(history);
            Assert.Contains(history!.Items, h => h.Event == "raised" && h.Key == alarm.Key);
            Assert.Contains(history.Items, h => h.Event == "cleared" && h.Key == alarm.Key && h.Actor == "alarms-operator-1");
        }

        using var adminClient = await LoginAsAsync(factory, "alarms-admin-1", "AdminPass123!");
        using (var auditResp = await adminClient.GetAsync("/v1/audit?action=alarm.ack&limit=1000"))
        {
            Assert.Equal(HttpStatusCode.OK, auditResp.StatusCode);
            var page = await auditResp.Content.ReadFromJsonAsync<AuditPageDto>(JsonOptions);
            var entry = Assert.Single(page!.Items);
            Assert.Equal("alarms-operator-1", entry.ActorUsername);
            Assert.Equal(alarm.Key, entry.TargetId);
        }
    }

    // ─────────────────────────────────────────────────────────────────────
    // Ack of an unknown/already-cleared id -> 404, no audit row written.
    // ─────────────────────────────────────────────────────────────────────

    [Fact]
    public async Task Ack_UnknownId_Gets404_AndWritesNoAuditRow()
    {
        await using var factory = await CreateFactoryAsync();
        await BootstrapAdminAsync(factory, "alarms-admin-2", "AdminPass123!");
        await CreateUserAsync(factory, "alarms-operator-2", "OperatorPass123!", Roles.Operator);

        using var operatorClient = await LoginAsAsync(factory, "alarms-operator-2", "OperatorPass123!");

        using var ack = await operatorClient.PostAsync("/v1/alarms/999999/ack", null);
        Assert.Equal(HttpStatusCode.NotFound, ack.StatusCode);

        using var adminClient = await LoginAsAsync(factory, "alarms-admin-2", "AdminPass123!");
        using var auditResp = await adminClient.GetAsync("/v1/audit?action=alarm.ack&limit=1000");
        var page = await auditResp.Content.ReadFromJsonAsync<AuditPageDto>(JsonOptions);
        Assert.Empty(page!.Items);
    }

    // ─────────────────────────────────────────────────────────────────────
    // RBAC: unauthenticated 401, Operator can read/ack.
    // ─────────────────────────────────────────────────────────────────────

    [Fact]
    public async Task Unauthenticated_Gets401_OnAllThreeAlarmRoutes()
    {
        await using var factory = await CreateFactoryAsync();
        using var client = factory.CreateClient();

        using (var list = await client.GetAsync("/v1/alarms"))
        {
            Assert.Equal(HttpStatusCode.Unauthorized, list.StatusCode);
        }

        using (var history = await client.GetAsync("/v1/alarms/history"))
        {
            Assert.Equal(HttpStatusCode.Unauthorized, history.StatusCode);
        }

        using (var ack = await client.PostAsync("/v1/alarms/1/ack", null))
        {
            Assert.Equal(HttpStatusCode.Unauthorized, ack.StatusCode);
        }
    }

    [Fact]
    public async Task Operator_CanListAlarms_WhenNoneAreRaised_EmptyArray()
    {
        await using var factory = await CreateFactoryAsync();
        await BootstrapAdminAsync(factory, "alarms-admin-3", "AdminPass123!");
        await CreateUserAsync(factory, "alarms-operator-3", "OperatorPass123!", Roles.Operator);

        using var operatorClient = await LoginAsAsync(factory, "alarms-operator-3", "OperatorPass123!");

        using var list = await operatorClient.GetAsync("/v1/alarms");
        Assert.Equal(HttpStatusCode.OK, list.StatusCode);
        var alarms = await list.Content.ReadFromJsonAsync<List<Alarm>>(JsonOptionsWithEnums);
        Assert.NotNull(alarms);
        Assert.Empty(alarms!);
    }

    // ─────────────────────────────────────────────────────────────────────
    // GET /v1/alarms/history — bad source/priority/date query params 400 rather than 500.
    // ─────────────────────────────────────────────────────────────────────

    [Fact]
    public async Task History_BadSourceOrPriorityOrFromDate_Gets400()
    {
        await using var factory = await CreateFactoryAsync();
        await BootstrapAdminAsync(factory, "alarms-admin-4", "AdminPass123!");
        await CreateUserAsync(factory, "alarms-operator-4", "OperatorPass123!", Roles.Operator);

        using var operatorClient = await LoginAsAsync(factory, "alarms-operator-4", "OperatorPass123!");

        using (var badSource = await operatorClient.GetAsync("/v1/alarms/history?source=NotAReal"))
        {
            Assert.Equal(HttpStatusCode.BadRequest, badSource.StatusCode);
        }

        using (var badPriority = await operatorClient.GetAsync("/v1/alarms/history?priority=NotAReal"))
        {
            Assert.Equal(HttpStatusCode.BadRequest, badPriority.StatusCode);
        }

        using (var badFrom = await operatorClient.GetAsync("/v1/alarms/history?from=not-a-date"))
        {
            Assert.Equal(HttpStatusCode.BadRequest, badFrom.StatusCode);
        }
    }
}
