using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using System.Text.Json.Serialization;
using Microsoft.AspNetCore.Identity;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.Extensions.DependencyInjection;
using St4i.EngineApi.Alarms;
using St4i.EngineApi.Auth;
using St4i.EngineApi.Line;
using St4i.EngineApi.Policy;
using St4i.EngineApi.Tests.Auth;
using Xunit;

namespace St4i.EngineApi.Tests.Line;

/// <summary>
/// GĐ3 sub-4 LC-3 — real-pipeline (<c>WebApplicationFactory&lt;Program&gt;</c>) proof of the
/// <c>/v1/line</c> HTTP surface: <c>GET /v1/line</c> reports the fresh (never-commanded) Stopped state;
/// <c>POST /v1/line/start</c> drives a real transition to Execute and writes a <c>line.start</c> audit
/// row; an illegal transition 409s with no audit row; an unknown command 400s; <c>line.start</c> while
/// halted is denied by the SAME policy layer <c>/v1/fleet/start</c> already goes through (409
/// SAFETY_BLOCKED, which ALSO raises a Critical Policy alarm — LC-1's <c>PolicyResults.DenyAsync</c> hook,
/// unchanged by this task); RBAC (401 unauthenticated, 403 for a role with no obligation). Same
/// env-var-swap-then-eager-build factory recipe as <c>AlarmEndpointsTests</c>/<c>RbacPolicyTests</c>
/// (duplicated rather than shared, for the same reasons those classes' own doc comments give) — see
/// <see cref="SecurityEnvVarTests"/>'s doc comment for why this class carries the SAME
/// <c>[Collection(...)]</c> tag.
/// </summary>
[Collection(SecurityEnvVarTests.CollectionName)]
public sealed class LineEndpointsTests
{
    private static readonly SemaphoreSlim EnvLock = new(1, 1);
    private static readonly JsonSerializerOptions JsonOptions = new(JsonSerializerDefaults.Web);

    // LineStatus carries a PackMlState enum, wire-serialized as a string by the app's own
    // ConfigureHttpJsonOptions (Program.cs adds a JsonStringEnumConverter globally) — the plain JsonOptions
    // above has no such converter, so deserializing it on the CLIENT side needs its own enum-aware options,
    // same idiom as AlarmEndpointsTests' JsonOptionsWithEnums.
    private static readonly JsonSerializerOptions JsonOptionsWithEnums = new(JsonSerializerDefaults.Web)
    {
        Converters = { new JsonStringEnumConverter() },
    };

    private static async Task<WebApplicationFactory<Program>> CreateFactoryAsync()
    {
        var securityDir = Directory.CreateTempSubdirectory("st4i-line-ep-security-").FullName;
        var historianDir = Directory.CreateTempSubdirectory("st4i-line-ep-historian-").FullName;
        var walDir = Directory.CreateTempSubdirectory("st4i-line-ep-wal-").FullName;
        var settingsDir = Directory.CreateTempSubdirectory("st4i-line-ep-settings-").FullName;
        var assetsDir = Directory.CreateTempSubdirectory("st4i-line-ep-assets-").FullName;
        // GĐ3 sub-4 LC-1/LC-3 — isolated the same way as every other per-concern directory here: without
        // this, this class's real Policy DENYs (the halt-while-line.start case below) would resolve
        // AlarmStore against the REAL %ProgramData%\ST4I\sim\alarms\alarms.db instead of a throwaway dir.
        var alarmsDir = Directory.CreateTempSubdirectory("st4i-line-ep-alarms-").FullName;
        // EC-3 review follow-up — see SiteEndpointsTests' own doc comment: without these, every
        // WebApplicationFactory<Program> boot below (UNS defaults ON) resolves DeviceIdentityStore/
        // SiteLinkStore to the REAL %ProgramData%\ST4I\sim\identity\ / ...\sitelink\.
        var identityDir = Directory.CreateTempSubdirectory("st4i-line-ep-identity-").FullName;
        var siteLinkDir = Directory.CreateTempSubdirectory("st4i-line-ep-sitelink-").FullName;
        // GĐ3 closeout WI-3 — without this, every WebApplicationFactory<Program> boot below (UNS defaults
        // ON) has Program.cs construct a REAL BridgeSpool against %ProgramData%\ST4I\sim\bridge-spool\.
        var bridgeSpoolDir = Directory.CreateTempSubdirectory("st4i-line-ep-bridgespool-").FullName;

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
    // RBAC: unauthenticated 401 on both routes.
    // ─────────────────────────────────────────────────────────────────────

    [Fact]
    public async Task Unauthenticated_Gets401_OnBothLineRoutes()
    {
        await using var factory = await CreateFactoryAsync();
        using var client = factory.CreateClient();

        using (var get = await client.GetAsync("/v1/line"))
        {
            Assert.Equal(HttpStatusCode.Unauthorized, get.StatusCode);
        }

        using (var post = await client.PostAsync("/v1/line/start", null))
        {
            Assert.Equal(HttpStatusCode.Unauthorized, post.StatusCode);
        }
    }

    // ─────────────────────────────────────────────────────────────────────
    // RBAC: a role with no obligation (not one of Operator/Engineer/Admin) is denied.
    // ─────────────────────────────────────────────────────────────────────

    [Fact]
    public async Task PostStart_AsUnauthorizedRole_Gets403()
    {
        await using var factory = await CreateFactoryAsync();
        await BootstrapAdminAsync(factory, "line-admin-rbac", "AdminPass123!");
        // A role string outside {Operator, Engineer, Admin} — IUserStore.CreateAsync takes a free-form
        // role string; RequireRole(Roles.Operator, Roles.Engineer, Roles.Admin) on the /v1/line route
        // policy rejects anything else, same as it would any other unrecognized role.
        await CreateUserAsync(factory, "line-guest-rbac", "GuestPass123!", "Guest");

        using var guestClient = await LoginAsAsync(factory, "line-guest-rbac", "GuestPass123!");

        using var get = await guestClient.GetAsync("/v1/line");
        Assert.Equal(HttpStatusCode.Forbidden, get.StatusCode);

        using var post = await guestClient.PostAsync("/v1/line/start", null);
        Assert.Equal(HttpStatusCode.Forbidden, post.StatusCode);
    }

    // ─────────────────────────────────────────────────────────────────────
    // GET /v1/line — a never-commanded line reports the fresh Stopped state.
    // ─────────────────────────────────────────────────────────────────────

    [Fact]
    public async Task GetLine_Operator_ReturnsFreshStoppedState()
    {
        await using var factory = await CreateFactoryAsync();
        await BootstrapAdminAsync(factory, "line-admin-1", "AdminPass123!");
        await CreateUserAsync(factory, "line-operator-1", "OperatorPass123!", Roles.Operator);

        using var operatorClient = await LoginAsAsync(factory, "line-operator-1", "OperatorPass123!");

        using var get = await operatorClient.GetAsync("/v1/line");
        Assert.Equal(HttpStatusCode.OK, get.StatusCode);

        var status = await get.Content.ReadFromJsonAsync<LineStatus>(JsonOptionsWithEnums);
        Assert.NotNull(status);
        Assert.Equal(PackMlState.Stopped, status!.State);
        Assert.Null(status.HoldReason);
        Assert.False(status.IsRunning);
        Assert.False(status.EstopEngaged);
    }

    // ─────────────────────────────────────────────────────────────────────
    // POST /v1/line/start — a real transition to Execute + an audited line.start row.
    // ─────────────────────────────────────────────────────────────────────

    [Fact]
    public async Task PostStart_Operator_FromFreshState_Returns200Execute_AndWritesAnAuditRow()
    {
        await using var factory = await CreateFactoryAsync();
        await BootstrapAdminAsync(factory, "line-admin-2", "AdminPass123!");
        await CreateUserAsync(factory, "line-operator-2", "OperatorPass123!", Roles.Operator);

        using var operatorClient = await LoginAsAsync(factory, "line-operator-2", "OperatorPass123!");

        using (var post = await operatorClient.PostAsync("/v1/line/start", null))
        {
            Assert.Equal(HttpStatusCode.OK, post.StatusCode);
            var status = await post.Content.ReadFromJsonAsync<LineStatus>(JsonOptionsWithEnums);
            Assert.NotNull(status);
            Assert.Equal(PackMlState.Execute, status!.State);
            Assert.True(status.IsRunning);
        }

        using (var get = await operatorClient.GetAsync("/v1/line"))
        {
            var status = await get.Content.ReadFromJsonAsync<LineStatus>(JsonOptionsWithEnums);
            Assert.Equal(PackMlState.Execute, status!.State);
        }

        using var adminClient = await LoginAsAsync(factory, "line-admin-2", "AdminPass123!");
        using var auditResp = await adminClient.GetAsync("/v1/audit?action=line.start&limit=1000");
        Assert.Equal(HttpStatusCode.OK, auditResp.StatusCode);
        var page = await auditResp.Content.ReadFromJsonAsync<AuditPageDto>(JsonOptions);
        var entry = Assert.Single(page!.Items);
        Assert.Equal("line-operator-2", entry.ActorUsername);
        Assert.Equal("line", entry.TargetType);
    }

    // ─────────────────────────────────────────────────────────────────────
    // An illegal transition 409s, no audit row.
    // ─────────────────────────────────────────────────────────────────────

    [Fact]
    public async Task PostHold_FromFreshStoppedState_Gets409_AndWritesNoAuditRow()
    {
        await using var factory = await CreateFactoryAsync();
        await BootstrapAdminAsync(factory, "line-admin-3", "AdminPass123!");
        await CreateUserAsync(factory, "line-operator-3", "OperatorPass123!", Roles.Operator);

        using var operatorClient = await LoginAsAsync(factory, "line-operator-3", "OperatorPass123!");

        // Hold is only legal from Execute — a fresh line is Stopped.
        using var post = await operatorClient.PostAsync("/v1/line/hold", null);
        Assert.Equal(HttpStatusCode.Conflict, post.StatusCode);

        using var adminClient = await LoginAsAsync(factory, "line-admin-3", "AdminPass123!");
        using var auditResp = await adminClient.GetAsync("/v1/audit?action=line.hold&limit=1000");
        var page = await auditResp.Content.ReadFromJsonAsync<AuditPageDto>(JsonOptions);
        Assert.Empty(page!.Items);
    }

    // ─────────────────────────────────────────────────────────────────────
    // An unknown command 400s.
    // ─────────────────────────────────────────────────────────────────────

    [Fact]
    public async Task PostUnknownCommand_Gets400()
    {
        await using var factory = await CreateFactoryAsync();
        await BootstrapAdminAsync(factory, "line-admin-4", "AdminPass123!");
        await CreateUserAsync(factory, "line-operator-4", "OperatorPass123!", Roles.Operator);

        using var operatorClient = await LoginAsAsync(factory, "line-operator-4", "OperatorPass123!");

        using var post = await operatorClient.PostAsync("/v1/line/not-a-real-command", null);
        Assert.Equal(HttpStatusCode.BadRequest, post.StatusCode);
    }

    // ─────────────────────────────────────────────────────────────────────
    // line.start while halted is denied by the SAME policy layer fleet.start already goes through —
    // 409 SAFETY_BLOCKED, and that denial ALSO raises a Critical Policy alarm (LC-1's DenyAsync hook,
    // unchanged by this task).
    // ─────────────────────────────────────────────────────────────────────

    [Fact]
    public async Task PostStart_WhileEstopped_Gets409SafetyBlocked_AndRaisesACriticalAlarm()
    {
        await using var factory = await CreateFactoryAsync();
        await BootstrapAdminAsync(factory, "line-admin-5", "AdminPass123!");
        await CreateUserAsync(factory, "line-operator-5", "OperatorPass123!", Roles.Operator);

        using var operatorClient = await LoginAsAsync(factory, "line-operator-5", "OperatorPass123!");

        using (var estop = await operatorClient.PostAsync("/v1/fleet/estop", null))
        {
            Assert.Equal(HttpStatusCode.OK, estop.StatusCode);
        }

        using (var start = await operatorClient.PostAsync("/v1/line/start", null))
        {
            Assert.Equal(HttpStatusCode.Conflict, start.StatusCode);
            var deny = await start.Content.ReadFromJsonAsync<PolicyDenyDto>(JsonOptions);
            Assert.NotNull(deny);
            Assert.Equal("SAFETY_BLOCKED", deny!.Reason);
        }

        using (var listResp = await operatorClient.GetAsync("/v1/alarms"))
        {
            Assert.Equal(HttpStatusCode.OK, listResp.StatusCode);
            var alarms = await listResp.Content.ReadFromJsonAsync<List<Alarm>>(JsonOptionsWithEnums);
            Assert.NotNull(alarms);
            var alarm = Assert.Single(alarms!, a => a.Source == AlarmSource.Policy && a.TargetId == "line.start");
            Assert.Equal(AlarmPriority.Critical, alarm.Priority);
        }

        // Reset for a clean slate — the line's own commanded state must still be Stopped (Execute was
        // never actually reached, since the policy DENY happens before LineController.Execute is called).
        using (var resetEstop = await operatorClient.PostAsync("/v1/fleet/estop/reset", null))
        {
            Assert.Equal(HttpStatusCode.OK, resetEstop.StatusCode);
        }

        using (var get = await operatorClient.GetAsync("/v1/line"))
        {
            var status = await get.Content.ReadFromJsonAsync<LineStatus>(JsonOptionsWithEnums);
            Assert.Equal(PackMlState.Stopped, status!.State);
        }
    }
}
