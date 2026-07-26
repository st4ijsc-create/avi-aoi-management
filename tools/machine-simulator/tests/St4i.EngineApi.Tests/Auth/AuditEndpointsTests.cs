using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Microsoft.AspNetCore.Identity;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.Extensions.DependencyInjection;
using St4i.EngineApi.Auth;
using Xunit;

namespace St4i.EngineApi.Tests.Auth;

/// <summary>
/// WS-D-D3 — real-pipeline (<c>WebApplicationFactory&lt;Program&gt;</c>) checks for <c>GET /v1/audit</c>
/// and <c>GET /v1/audit/verify</c>: both Admin-only (403 for an Operator, 200 for an Admin), the list
/// endpoint returns/filters seeded entries, and verify reports Ok for an untampered chain. Same
/// env-var-swap-then-eager-build factory recipe as <see cref="RbacPolicyTests"/>/<c>AuthPipelineTests</c>
/// (duplicated rather than shared, for the same reasons those classes' own doc comments give) — per the
/// brief, <c>ST4I_DEMO_ENABLED</c> stays UNSET here (no demo auto-login shortcut for these tests).
///
/// There is no write endpoint yet (wiring <see cref="AuditRecorder"/> into mutating handlers is D4), so
/// every test here seeds rows directly via the booted app's own <see cref="IAuditStore"/> singleton —
/// the same store the endpoints under test read from.
///
/// See <see cref="SecurityEnvVarTests"/>'s doc comment for why this class carries the SAME
/// <c>[Collection(...)]</c> tag as <see cref="AuthPipelineTests"/>/<see cref="RbacPolicyTests"/> — all
/// three mutate the same real process environment variables around building their own
/// <c>WebApplicationFactory&lt;Program&gt;</c>, so they must run sequentially relative to EACH OTHER, not
/// just internally against themselves.
/// </summary>
[Collection(SecurityEnvVarTests.CollectionName)]
public sealed class AuditEndpointsTests
{
    private static readonly SemaphoreSlim EnvLock = new(1, 1);
    private static readonly JsonSerializerOptions JsonOptions = new(JsonSerializerDefaults.Web);

    private static async Task<WebApplicationFactory<Program>> CreateFactoryAsync()
    {
        var securityDir = Directory.CreateTempSubdirectory("st4i-audit-ep-security-").FullName;
        var historianDir = Directory.CreateTempSubdirectory("st4i-audit-ep-historian-").FullName;
        var walDir = Directory.CreateTempSubdirectory("st4i-audit-ep-wal-").FullName;

        await EnvLock.WaitAsync().ConfigureAwait(false);
        var prevSecurityDir = Environment.GetEnvironmentVariable("ST4I_SECURITY_DIR");
        var prevDemoEnabled = Environment.GetEnvironmentVariable("ST4I_DEMO_ENABLED");
        var prevHistorianDir = Environment.GetEnvironmentVariable("ST4I_HISTORIAN_DIR");
        var prevWalDir = Environment.GetEnvironmentVariable("ST4I_WAL_DIR");
        var prevEnvironment = Environment.GetEnvironmentVariable("ASPNETCORE_ENVIRONMENT");
        try
        {
            Environment.SetEnvironmentVariable("ST4I_SECURITY_DIR", securityDir);
            // Brief: "ST4I_DEMO_ENABLED unset" — explicitly cleared (not just "left as whatever the
            // process happened to have") so these tests never accidentally ride the demo auto-login path.
            Environment.SetEnvironmentVariable("ST4I_DEMO_ENABLED", null);
            Environment.SetEnvironmentVariable("ST4I_HISTORIAN_DIR", historianDir);
            Environment.SetEnvironmentVariable("ST4I_WAL_DIR", walDir);
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
    // Admin-only enforcement.
    // ─────────────────────────────────────────────────────────────────────

    [Fact]
    public async Task NonAdmin_Gets403_OnAuditListAndVerify()
    {
        await using var factory = await CreateFactoryAsync();
        await BootstrapAdminAsync(factory, "audit-admin-1", "AdminPass123!");
        await CreateUserAsync(factory, "audit-operator-1", "OperatorPass123!", Roles.Operator);
        await CreateUserAsync(factory, "audit-engineer-1", "EngineerPass123!", Roles.Engineer);

        using (var operatorClient = await LoginAsAsync(factory, "audit-operator-1", "OperatorPass123!"))
        {
            using var list = await operatorClient.GetAsync("/v1/audit");
            Assert.Equal(HttpStatusCode.Forbidden, list.StatusCode);

            using var verify = await operatorClient.GetAsync("/v1/audit/verify");
            Assert.Equal(HttpStatusCode.Forbidden, verify.StatusCode);
        }

        // Engineer is ALSO not enough — this is Admin-only, not Engineer-or-above.
        using (var engineerClient = await LoginAsAsync(factory, "audit-engineer-1", "EngineerPass123!"))
        {
            using var list = await engineerClient.GetAsync("/v1/audit");
            Assert.Equal(HttpStatusCode.Forbidden, list.StatusCode);

            using var verify = await engineerClient.GetAsync("/v1/audit/verify");
            Assert.Equal(HttpStatusCode.Forbidden, verify.StatusCode);
        }
    }

    [Fact]
    public async Task Unauthenticated_Gets401_OnAuditListAndVerify()
    {
        await using var factory = await CreateFactoryAsync();
        using var client = factory.CreateClient();

        using var list = await client.GetAsync("/v1/audit");
        Assert.Equal(HttpStatusCode.Unauthorized, list.StatusCode);

        using var verify = await client.GetAsync("/v1/audit/verify");
        Assert.Equal(HttpStatusCode.Unauthorized, verify.StatusCode);
    }

    // ─────────────────────────────────────────────────────────────────────
    // Admin 200s: seeded entries returned + filtered; verify reports Ok.
    // ─────────────────────────────────────────────────────────────────────

    [Fact]
    public async Task Admin_Gets200_AndSeesSeededEntries_FilteredByActorAndAction()
    {
        await using var factory = await CreateFactoryAsync();
        await BootstrapAdminAsync(factory, "audit-admin-2", "AdminPass123!");

        var auditStore = factory.Services.GetRequiredService<IAuditStore>();
        await auditStore.AppendAsync(
            new AuditAppend("alice", Roles.Engineer, "recipe.update", "recipe", "R1", null, "{\"v\":1}", "corr-1", "127.0.0.1", DateTimeOffset.UtcNow),
            CancellationToken.None);
        await auditStore.AppendAsync(
            new AuditAppend("bob", Roles.Admin, "user.disable", "user", "U9", null, null, "corr-2", "127.0.0.2", DateTimeOffset.UtcNow),
            CancellationToken.None);

        using var adminClient = await LoginAsAsync(factory, "audit-admin-2", "AdminPass123!");

        using (var listResp = await adminClient.GetAsync("/v1/audit"))
        {
            Assert.Equal(HttpStatusCode.OK, listResp.StatusCode);
            var page = await listResp.Content.ReadFromJsonAsync<AuditPageDto>(JsonOptions);
            Assert.Equal(2, page!.Total);
            // Newest-first — bob's row (appended second) leads.
            Assert.Equal("bob", page.Items[0].ActorUsername);
            Assert.Equal("alice", page.Items[1].ActorUsername);
        }

        using (var byActor = await adminClient.GetAsync("/v1/audit?actor=alice"))
        {
            Assert.Equal(HttpStatusCode.OK, byActor.StatusCode);
            var page = await byActor.Content.ReadFromJsonAsync<AuditPageDto>(JsonOptions);
            Assert.Equal(1, page!.Total);
            Assert.Equal("alice", page.Items[0].ActorUsername);
            Assert.Equal("recipe.update", page.Items[0].Action);
        }

        using (var byAction = await adminClient.GetAsync("/v1/audit?action=user.disable"))
        {
            Assert.Equal(HttpStatusCode.OK, byAction.StatusCode);
            var page = await byAction.Content.ReadFromJsonAsync<AuditPageDto>(JsonOptions);
            Assert.Equal(1, page!.Total);
            Assert.Equal("bob", page.Items[0].ActorUsername);
        }

        using (var byTarget = await adminClient.GetAsync("/v1/audit?target=R1"))
        {
            Assert.Equal(HttpStatusCode.OK, byTarget.StatusCode);
            var page = await byTarget.Content.ReadFromJsonAsync<AuditPageDto>(JsonOptions);
            Assert.Equal(1, page!.Total);
            Assert.Equal("R1", page.Items[0].TargetId);
        }
    }

    [Fact]
    public async Task Admin_Verify_ReportsOk_ForAnUntamperedChain()
    {
        await using var factory = await CreateFactoryAsync();
        await BootstrapAdminAsync(factory, "audit-admin-3", "AdminPass123!");

        var auditStore = factory.Services.GetRequiredService<IAuditStore>();
        await auditStore.AppendAsync(
            new AuditAppend("carol", Roles.Admin, "settings.update", null, null, null, null, null, null, DateTimeOffset.UtcNow),
            CancellationToken.None);

        using var adminClient = await LoginAsAsync(factory, "audit-admin-3", "AdminPass123!");

        using var verifyResp = await adminClient.GetAsync("/v1/audit/verify");
        Assert.Equal(HttpStatusCode.OK, verifyResp.StatusCode);
        var verify = await verifyResp.Content.ReadFromJsonAsync<AuditVerifyResultDto>(JsonOptions);
        Assert.True(verify!.Ok);
        Assert.Null(verify.FirstBrokenSeq);
    }

    [Fact]
    public async Task Admin_BadFromDate_Gets400()
    {
        await using var factory = await CreateFactoryAsync();
        await BootstrapAdminAsync(factory, "audit-admin-4", "AdminPass123!");

        using var adminClient = await LoginAsAsync(factory, "audit-admin-4", "AdminPass123!");

        using var resp = await adminClient.GetAsync("/v1/audit?from=not-a-date");
        Assert.Equal(HttpStatusCode.BadRequest, resp.StatusCode);
    }
}
