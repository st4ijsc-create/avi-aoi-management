using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using System.Text.Json.Serialization;
using Microsoft.AspNetCore.Identity;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.Extensions.DependencyInjection;
using St4i.EngineApi.Auth;
using St4i.EngineApi.Tests.Auth;
using Xunit;
using AssetRecordDto = St4i.EngineApi.AssetRegistry.AssetRecord;

namespace St4i.EngineApi.Tests.AssetRegistry;

/// <summary>
/// P2-1 (WS-J Asset Registry) — real-pipeline (<c>WebApplicationFactory&lt;Program&gt;</c>) checks for
/// <c>GET /v1/assets</c>, <c>GET /v1/assets/{code}</c>, and <c>PUT /v1/assets/{code}/lifecycle</c>: the
/// default roster machines show up in the list (auto-upserted by <c>FleetHost</c>'s roster-seed loop —
/// see that class's ctor), detail 200/404, the lifecycle PUT actually changes the stored state AND writes
/// an <c>asset.lifecycle.set</c> audit row, a bad state 400s, an unknown code 404s, and RBAC gates the
/// mutating route to Engineer-or-above (403 for an Operator). Same env-var-swap-then-eager-build factory
/// recipe as <see cref="RbacPolicyTests"/>/<c>AuditEndpointsTests</c> — see
/// <see cref="SecurityEnvVarTests"/>'s doc comment for why this class carries the SAME
/// <c>[Collection(...)]</c> tag (all such classes mutate the same real process environment variables
/// around building their own factory, so they must run sequentially relative to each other).
/// </summary>
[Collection(SecurityEnvVarTests.CollectionName)]
public sealed class AssetEndpointsTests
{
    private static readonly SemaphoreSlim EnvLock = new(1, 1);
    private static readonly JsonSerializerOptions JsonOptions = new(JsonSerializerDefaults.Web);
    private static readonly JsonSerializerOptions JsonOptionsWithEnums = new(JsonSerializerDefaults.Web)
    {
        Converters = { new JsonStringEnumConverter() },
    };

    private static async Task<WebApplicationFactory<Program>> CreateFactoryAsync(bool demoEnabled = false)
    {
        var securityDir = Directory.CreateTempSubdirectory("st4i-assets-ep-security-").FullName;
        var historianDir = Directory.CreateTempSubdirectory("st4i-assets-ep-historian-").FullName;
        var walDir = Directory.CreateTempSubdirectory("st4i-assets-ep-wal-").FullName;
        var settingsDir = Directory.CreateTempSubdirectory("st4i-assets-ep-settings-").FullName;
        var assetsDir = Directory.CreateTempSubdirectory("st4i-assets-ep-assets-").FullName;
        // EC-3 review follow-up — see SiteEndpointsTests' own doc comment: without these, every
        // WebApplicationFactory<Program> boot below (UNS defaults ON) resolves DeviceIdentityStore/
        // SiteLinkStore to the REAL %ProgramData%\ST4I\sim\identity\ / ...\sitelink\.
        var identityDir = Directory.CreateTempSubdirectory("st4i-assets-ep-identity-").FullName;
        var siteLinkDir = Directory.CreateTempSubdirectory("st4i-assets-ep-sitelink-").FullName;
        // GĐ3 sub-4 LC-1 review follow-up — isolated the same way as every other per-concern directory
        // above: without this, a real Policy DENY occurring anywhere in this class's requests
        // (PolicyResults.DenyAsync now resolves IAlarmStore and raises an alarm) would resolve AlarmStore
        // against the REAL %ProgramData%\ST4I\sim\alarms\alarms.db instead of a throwaway temp dir.
        var alarmsDir = Directory.CreateTempSubdirectory("st4i-assets-ep-alarms-").FullName;
        // GĐ3 closeout WI-3 — without this, every WebApplicationFactory<Program> boot below (UNS defaults
        // ON) has Program.cs construct a REAL BridgeSpool against %ProgramData%\ST4I\sim\bridge-spool\.
        var bridgeSpoolDir = Directory.CreateTempSubdirectory("st4i-assets-ep-bridgespool-").FullName;
        var connectorConfigDir = Directory.CreateTempSubdirectory("st4i-assets-ep-connectorconfig-").FullName;

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
        try
        {
            Environment.SetEnvironmentVariable("ST4I_SECURITY_DIR", securityDir);
            // SM-1 (.superpowers/sdd/2026-07-29-dotA-single-machine-sellable-blueprint/task-1-brief.md) —
            // product mode (the previous unconditional null here) now starts FleetHost's roster EMPTY;
            // this class's whole premise is "the default roster's machines show up" (see the class doc
            // comment), so any test that needs AOI-01/SCRW-01 to actually exist must opt into demoEnabled,
            // same convention AuditWiringTests/AuthPipelineTests already use.
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
    // GET /v1/assets — Operator 200, default roster present.
    // ─────────────────────────────────────────────────────────────────────

    /// <summary>Task-7 (whole-batch review) — renamed from <c>Operator_ListsAssets_...</c>: this test
    /// authenticates as the auto-logged-in "demo-admin" (<c>Roles.Admin</c>), never an actual Operator
    /// account, so the old name overclaimed which RBAC tier it exercises. See the body comment below for
    /// why demo-admin is used here. <b>Known gap, said plainly rather than left silent:</b> this file has
    /// NO test that logs in as a genuine Operator-role user and asserts the GET /v1/assets 200 positive
    /// path — every test here that needs the demo roster seeded (AOI-01/SCRW-01) uses demo-admin instead,
    /// because <c>demoEnabled: true</c> auto-signs-in demo-admin before this test's first request. Nothing
    /// technically prevents ALSO calling <c>CreateUserAsync(..., Roles.Operator)</c> + <c>LoginAsAsync</c>
    /// on top of a demo-enabled factory (that helper talks to <c>IUserStore</c> directly, not the
    /// bootstrap endpoint the 409 concern below is actually about) — this task did not add that test;
    /// flagging the gap here rather than silently leaving it unstated.</summary>
    [Fact]
    public async Task DemoAdmin_ListsAssets_AndSeesTheDefaultRosterMachines()
    {
        // SM-1 (.superpowers/sdd/2026-07-29-dotA-single-machine-sellable-blueprint/task-1-brief.md) —
        // "the default roster" this test names is now specifically the DEMO roster; a product
        // deployment's default is an empty one (see FleetHostProductModeRosterTests). demoEnabled: true
        // is what actually seeds AOI-01/SCRW-01 for this test to find — and it also means
        // DemoAutoLoginMiddleware auto-creates + signs in "demo-admin" on the very first request, so
        // bootstrapping a SEPARATE admin/operator on top of that would 409 (the user store is no longer
        // empty). This test isn't about proving Operator-specific RBAC (that's covered elsewhere), just
        // that the roster is listable, so the auto-logged-in demo-admin is used directly.
        await using var factory = await CreateFactoryAsync(demoEnabled: true);
        using var client = factory.CreateClient(new WebApplicationFactoryClientOptions { HandleCookies = true });

        using var listResp = await client.GetAsync("/v1/assets");
        Assert.Equal(HttpStatusCode.OK, listResp.StatusCode);

        var assets = await listResp.Content.ReadFromJsonAsync<List<AssetRecordDto>>(JsonOptionsWithEnums);
        Assert.NotNull(assets);
        // FleetHost's roster-seed loop upserts every default-fleet machine at startup (see FleetHost.cs's
        // ctor) — AOI-01/SCRW-01 are two of the fixed default roster's codes.
        Assert.Contains(assets!, a => a.Code == "AOI-01");
        Assert.Contains(assets!, a => a.Code == "SCRW-01");
        Assert.All(assets!, a => Assert.StartsWith("urn:isa95:", a.Urn));
    }

    // ─────────────────────────────────────────────────────────────────────
    // GET /v1/assets/{code} — 200 for a known code, 404 for an unknown one.
    // ─────────────────────────────────────────────────────────────────────

    /// <summary>Task-7 — renamed from <c>Operator_GetsAssetDetail_...</c>; same demo-admin identity as
    /// <see cref="DemoAdmin_ListsAssets_AndSeesTheDefaultRosterMachines"/>, not a genuine Operator
    /// account.</summary>
    [Fact]
    public async Task DemoAdmin_GetsAssetDetail_200ForKnownCode_404ForUnknownCode()
    {
        // SM-1 — AOI-01 is a demo-fleet code; see DemoAdmin_ListsAssets_AndSeesTheDefaultRosterMachines
        // for why this uses the auto-logged-in demo-admin directly instead of bootstrapping a separate
        // admin/operator.
        await using var factory = await CreateFactoryAsync(demoEnabled: true);
        using var client = factory.CreateClient(new WebApplicationFactoryClientOptions { HandleCookies = true });

        using (var known = await client.GetAsync("/v1/assets/AOI-01"))
        {
            Assert.Equal(HttpStatusCode.OK, known.StatusCode);
            var asset = await known.Content.ReadFromJsonAsync<AssetRecordDto>(JsonOptionsWithEnums);
            Assert.Equal("AOI-01", asset!.Code);
        }

        using (var unknown = await client.GetAsync("/v1/assets/NO-SUCH-MACHINE"))
        {
            Assert.Equal(HttpStatusCode.NotFound, unknown.StatusCode);
        }
    }

    // ─────────────────────────────────────────────────────────────────────
    // PUT /v1/assets/{code}/lifecycle — Engineer 200 + state changed + audited; bad state 400;
    // unknown code 404; Operator 403.
    // ─────────────────────────────────────────────────────────────────────

    /// <summary>Task-7 — renamed from <c>Engineer_SetsLifecycle_...</c>: this authenticates as
    /// demo-admin (<c>Roles.Admin</c>, which satisfies the Engineer-gated route too), not a genuine
    /// bootstrapped Engineer account — unlike, e.g., <c>AuditWiringTests.ProductUpsert_AsEngineer_...</c>,
    /// which does use a real Engineer login. The genuine Engineer-tier RBAC path is still covered
    /// separately by <see cref="Engineer_SetLifecycle_BadState_Gets400"/>/<see cref="Engineer_SetLifecycle_UnknownCode_Gets404"/>
    /// below (both log in as a real, bootstrapped Engineer) — only the "changes stored state and audits
    /// it" happy path used demo-admin, because it also needed the demo roster's SCRW-01 to exist.</summary>
    [Fact]
    public async Task DemoAdmin_SetsLifecycle_ChangesStoredState_AndWritesAuditRow()
    {
        // SM-1 — SCRW-01 is a demo-fleet code; see DemoAdmin_ListsAssets_AndSeesTheDefaultRosterMachines
        // for why this uses the auto-logged-in demo-admin directly instead of bootstrapping a separate
        // admin/engineer (demo-admin's Admin role satisfies the Engineer-gated route below too).
        await using var factory = await CreateFactoryAsync(demoEnabled: true);
        using var client = factory.CreateClient(new WebApplicationFactoryClientOptions { HandleCookies = true });

        using (var put = await client.PutAsJsonAsync(
                   "/v1/assets/SCRW-01/lifecycle", new { state = "Maintenance" }, JsonOptions))
        {
            Assert.Equal(HttpStatusCode.OK, put.StatusCode);
            var updated = await put.Content.ReadFromJsonAsync<AssetRecordDto>(JsonOptionsWithEnums);
            Assert.Equal("Maintenance", updated!.Lifecycle.ToString());
        }

        // Confirms the PUT above genuinely persisted (not just an in-memory echo).
        using (var get = await client.GetAsync("/v1/assets/SCRW-01"))
        {
            var asset = await get.Content.ReadFromJsonAsync<AssetRecordDto>(JsonOptionsWithEnums);
            Assert.Equal("Maintenance", asset!.Lifecycle.ToString());
        }

        var auditStore = factory.Services.GetRequiredService<IAuditStore>();
        var auditPage = await auditStore.QueryAsync(
            from: null, to: null, actor: null, action: "asset.lifecycle.set", target: "SCRW-01",
            limit: 10, offset: 0, CancellationToken.None);
        Assert.True(auditPage.Total >= 1);
        Assert.Equal("SCRW-01", auditPage.Items[0].TargetId);
        Assert.Equal("asset.lifecycle.set", auditPage.Items[0].Action);
    }

    [Fact]
    public async Task Engineer_SetLifecycle_BadState_Gets400()
    {
        await using var factory = await CreateFactoryAsync();
        await BootstrapAdminAsync(factory, "assets-admin-4", "AdminPass123!");
        await CreateUserAsync(factory, "assets-engineer-4", "EngineerPass123!", Roles.Engineer);

        using var engineerClient = await LoginAsAsync(factory, "assets-engineer-4", "EngineerPass123!");

        using var put = await engineerClient.PutAsJsonAsync(
            "/v1/assets/SCRW-01/lifecycle", new { state = "NotARealState" }, JsonOptions);
        Assert.Equal(HttpStatusCode.BadRequest, put.StatusCode);
    }

    [Fact]
    public async Task Engineer_SetLifecycle_UnknownCode_Gets404()
    {
        await using var factory = await CreateFactoryAsync();
        await BootstrapAdminAsync(factory, "assets-admin-5", "AdminPass123!");
        await CreateUserAsync(factory, "assets-engineer-5", "EngineerPass123!", Roles.Engineer);

        using var engineerClient = await LoginAsAsync(factory, "assets-engineer-5", "EngineerPass123!");

        using var put = await engineerClient.PutAsJsonAsync(
            "/v1/assets/NO-SUCH-MACHINE/lifecycle", new { state = "Maintenance" }, JsonOptions);
        Assert.Equal(HttpStatusCode.NotFound, put.StatusCode);
    }

    [Fact]
    public async Task Operator_SetLifecycle_Gets403()
    {
        await using var factory = await CreateFactoryAsync();
        await BootstrapAdminAsync(factory, "assets-admin-6", "AdminPass123!");
        await CreateUserAsync(factory, "assets-operator-6", "OperatorPass123!", Roles.Operator);

        using var operatorClient = await LoginAsAsync(factory, "assets-operator-6", "OperatorPass123!");

        using var put = await operatorClient.PutAsJsonAsync(
            "/v1/assets/SCRW-01/lifecycle", new { state = "Maintenance" }, JsonOptions);
        Assert.Equal(HttpStatusCode.Forbidden, put.StatusCode);
    }
}
