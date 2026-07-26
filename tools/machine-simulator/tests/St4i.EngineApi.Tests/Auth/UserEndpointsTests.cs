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
/// WS-D-D7 — <c>/v1/users/*</c> (<see cref="UserEndpoints"/>): Admin-only enforcement (403 for
/// Operator/Engineer), the create/role/disable/enable/reset-password CRUD surface itself (409 dup
/// username, 400 invalid role / weak password, 404 unknown id), the last-enabled-Admin lock-out guard
/// (both the brief's explicit "cannot disable" case AND the equivalent "cannot demote via role change"
/// case this task additionally guards — see <c>UserEndpoints.IsLastEnabledAdmin</c>'s own doc comment),
/// that every mutation writes the right <c>user.*</c> audit row with actor = the AUTHENTICATED admin and
/// NEVER a password/hash anywhere in the row, that <c>GET /v1/users</c> never serializes a password hash,
/// and that disabling a user revokes their already-signed-in session on its very next request (the
/// security_stamp bump D1 wired <c>OnValidatePrincipal</c> to enforce). Same real-pipeline
/// <see cref="WebApplicationFactory{TEntryPoint}"/> convention (env-var-swap-then-eager-build,
/// <see cref="SecurityEnvVarTests.CollectionName"/> collection tag) as every other class in this folder.
/// </summary>
[Collection(SecurityEnvVarTests.CollectionName)]
public sealed class UserEndpointsTests
{
    private static readonly SemaphoreSlim EnvLock = new(1, 1);
    private static readonly JsonSerializerOptions JsonOptions = new(JsonSerializerDefaults.Web);

    private static async Task<WebApplicationFactory<Program>> CreateFactoryAsync()
    {
        var securityDir = Directory.CreateTempSubdirectory("st4i-users-ep-security-").FullName;
        var historianDir = Directory.CreateTempSubdirectory("st4i-users-ep-historian-").FullName;
        var walDir = Directory.CreateTempSubdirectory("st4i-users-ep-wal-").FullName;

        await EnvLock.WaitAsync().ConfigureAwait(false);
        var prevSecurityDir = Environment.GetEnvironmentVariable("ST4I_SECURITY_DIR");
        var prevDemoEnabled = Environment.GetEnvironmentVariable("ST4I_DEMO_ENABLED");
        var prevHistorianDir = Environment.GetEnvironmentVariable("ST4I_HISTORIAN_DIR");
        var prevWalDir = Environment.GetEnvironmentVariable("ST4I_WAL_DIR");
        var prevEnvironment = Environment.GetEnvironmentVariable("ASPNETCORE_ENVIRONMENT");
        try
        {
            Environment.SetEnvironmentVariable("ST4I_SECURITY_DIR", securityDir);
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

    private static async Task<UserRecord> SeedUserAsync(WebApplicationFactory<Program> factory, string username, string password, string role)
    {
        var userStore = factory.Services.GetRequiredService<IUserStore>();
        var hasher = new PasswordHasher<AppUser>();
        var hash = hasher.HashPassword(AppUser.Instance, password);
        return await userStore.CreateAsync(username, hash, role, null, "test", CancellationToken.None).ConfigureAwait(false);
    }

    private static async Task<HttpClient> LoginAsAsync(WebApplicationFactory<Program> factory, string username, string password)
    {
        var client = factory.CreateClient(new WebApplicationFactoryClientOptions { HandleCookies = true });
        using var login = await client.PostAsJsonAsync("/v1/auth/login", new { username, password }, JsonOptions).ConfigureAwait(false);
        Assert.Equal(HttpStatusCode.OK, login.StatusCode);
        return client;
    }

    private static async Task<HttpClient> BootstrapAdminAsync(WebApplicationFactory<Program> factory, string username, string password)
    {
        var client = factory.CreateClient(new WebApplicationFactoryClientOptions { HandleCookies = true });
        using var bootstrap = await client.PostAsJsonAsync(
            "/v1/auth/bootstrap", new { username, password, displayName = (string?)null }, JsonOptions).ConfigureAwait(false);
        Assert.Equal(HttpStatusCode.OK, bootstrap.StatusCode);
        return client;
    }

    private static async Task<IReadOnlyList<AuditEntryDto>> GetAuditEntriesAsync(HttpClient adminClient, string action)
    {
        using var resp = await adminClient.GetAsync($"/v1/audit?action={Uri.EscapeDataString(action)}&limit=1000").ConfigureAwait(false);
        Assert.Equal(HttpStatusCode.OK, resp.StatusCode);
        var page = await resp.Content.ReadFromJsonAsync<AuditPageDto>(JsonOptions).ConfigureAwait(false);
        return page!.Items;
    }

    // ─────────────────────────────────────────────────────────────────────
    // Admin-only enforcement — every route, Operator AND Engineer both 403.
    // ─────────────────────────────────────────────────────────────────────

    [Fact]
    public async Task NonAdmin_Gets403_OnEveryUsersRoute()
    {
        await using var factory = await CreateFactoryAsync();
        using var adminClient = await BootstrapAdminAsync(factory, "ue-admin-1", "AdminPass123!");
        var target = await SeedUserAsync(factory, "ue-target-1", "TargetPass123!", Roles.Operator);
        await SeedUserAsync(factory, "ue-operator-1", "OperatorPass123!", Roles.Operator);
        await SeedUserAsync(factory, "ue-engineer-1", "EngineerPass123!", Roles.Engineer);

        foreach (var (username, password) in new[] { ("ue-operator-1", "OperatorPass123!"), ("ue-engineer-1", "EngineerPass123!") })
        {
            using var client = await LoginAsAsync(factory, username, password);

            using var list = await client.GetAsync("/v1/users");
            Assert.Equal(HttpStatusCode.Forbidden, list.StatusCode);

            using var create = await client.PostAsJsonAsync(
                "/v1/users", new { username = "whoever", password = "WhoeverPass123!", role = Roles.Operator }, JsonOptions);
            Assert.Equal(HttpStatusCode.Forbidden, create.StatusCode);

            using var role = await client.PutAsJsonAsync($"/v1/users/{target.Id}/role", new { role = Roles.Engineer }, JsonOptions);
            Assert.Equal(HttpStatusCode.Forbidden, role.StatusCode);

            using var disable = await client.PostAsync($"/v1/users/{target.Id}/disable", null);
            Assert.Equal(HttpStatusCode.Forbidden, disable.StatusCode);

            using var enable = await client.PostAsync($"/v1/users/{target.Id}/enable", null);
            Assert.Equal(HttpStatusCode.Forbidden, enable.StatusCode);

            using var reset = await client.PostAsJsonAsync(
                $"/v1/users/{target.Id}/reset-password", new { newPassword = "NewPassword123!" }, JsonOptions);
            Assert.Equal(HttpStatusCode.Forbidden, reset.StatusCode);
        }
    }

    [Fact]
    public async Task Unauthenticated_Gets401_OnUsersList()
    {
        await using var factory = await CreateFactoryAsync();
        using var client = factory.CreateClient();

        using var list = await client.GetAsync("/v1/users");
        Assert.Equal(HttpStatusCode.Unauthorized, list.StatusCode);
    }

    // ─────────────────────────────────────────────────────────────────────
    // Admin CRUD — the happy paths.
    // ─────────────────────────────────────────────────────────────────────

    [Fact]
    public async Task Admin_CanListCreateRoleDisableEnableReset()
    {
        await using var factory = await CreateFactoryAsync();
        using var adminClient = await BootstrapAdminAsync(factory, "ue-admin-2", "AdminPass123!");

        using (var create = await adminClient.PostAsJsonAsync(
                   "/v1/users", new { username = "ue-newop", password = "NewOpPass123!", role = Roles.Operator, displayName = "New Op" }, JsonOptions))
        {
            Assert.Equal(HttpStatusCode.OK, create.StatusCode);
            var created = await create.Content.ReadFromJsonAsync<UserDto>(JsonOptions);
            Assert.Equal("ue-newop", created!.Username);
            Assert.Equal(Roles.Operator, created.Role);
            Assert.False(created.Disabled);

            using (var list = await adminClient.GetAsync("/v1/users"))
            {
                Assert.Equal(HttpStatusCode.OK, list.StatusCode);
                var users = await list.Content.ReadFromJsonAsync<UserDto[]>(JsonOptions);
                Assert.Contains(users!, u => u.Username == "ue-newop" && u.Role == Roles.Operator);
            }

            using (var role = await adminClient.PutAsJsonAsync($"/v1/users/{created.Id}/role", new { role = Roles.Engineer }, JsonOptions))
            {
                Assert.Equal(HttpStatusCode.OK, role.StatusCode);
                var updated = await role.Content.ReadFromJsonAsync<UserDto>(JsonOptions);
                Assert.Equal(Roles.Engineer, updated!.Role);
            }

            using (var disable = await adminClient.PostAsync($"/v1/users/{created.Id}/disable", null))
            {
                Assert.Equal(HttpStatusCode.OK, disable.StatusCode);
                var updated = await disable.Content.ReadFromJsonAsync<UserDto>(JsonOptions);
                Assert.True(updated!.Disabled);
            }

            using (var enable = await adminClient.PostAsync($"/v1/users/{created.Id}/enable", null))
            {
                Assert.Equal(HttpStatusCode.OK, enable.StatusCode);
                var updated = await enable.Content.ReadFromJsonAsync<UserDto>(JsonOptions);
                Assert.False(updated!.Disabled);
            }

            using (var reset = await adminClient.PostAsJsonAsync(
                       $"/v1/users/{created.Id}/reset-password", new { newPassword = "BrandNewPass456!" }, JsonOptions))
            {
                Assert.Equal(HttpStatusCode.OK, reset.StatusCode);
            }

            // The reset password actually took effect — the new one logs in.
            using var relogin = await LoginAsAsync(factory, "ue-newop", "BrandNewPass456!");
        }
    }

    // ─────────────────────────────────────────────────────────────────────
    // Validation: duplicate username (409), invalid role (400), weak password (400 — create + reset).
    // ─────────────────────────────────────────────────────────────────────

    [Fact]
    public async Task Create_DuplicateUsername_Gets409()
    {
        await using var factory = await CreateFactoryAsync();
        using var adminClient = await BootstrapAdminAsync(factory, "ue-admin-3", "AdminPass123!");
        await SeedUserAsync(factory, "ue-dup", "DupPass123!", Roles.Operator);

        using var create = await adminClient.PostAsJsonAsync(
            "/v1/users", new { username = "ue-dup", password = "AnotherPass123!", role = Roles.Operator }, JsonOptions);
        Assert.Equal(HttpStatusCode.Conflict, create.StatusCode);

        // Case-insensitive too — the store's own COLLATE NOCASE contract.
        using var createCased = await adminClient.PostAsJsonAsync(
            "/v1/users", new { username = "UE-DUP", password = "AnotherPass123!", role = Roles.Operator }, JsonOptions);
        Assert.Equal(HttpStatusCode.Conflict, createCased.StatusCode);
    }

    [Fact]
    public async Task Create_InvalidRole_Gets400()
    {
        await using var factory = await CreateFactoryAsync();
        using var adminClient = await BootstrapAdminAsync(factory, "ue-admin-4", "AdminPass123!");

        using var create = await adminClient.PostAsJsonAsync(
            "/v1/users", new { username = "ue-badrole", password = "GoodPass123!", role = "SuperUser" }, JsonOptions);
        Assert.Equal(HttpStatusCode.BadRequest, create.StatusCode);
    }

    [Fact]
    public async Task Create_WeakPassword_Gets400()
    {
        await using var factory = await CreateFactoryAsync();
        using var adminClient = await BootstrapAdminAsync(factory, "ue-admin-5", "AdminPass123!");

        using var create = await adminClient.PostAsJsonAsync(
            "/v1/users", new { username = "ue-weakpw", password = "short", role = Roles.Operator }, JsonOptions);
        Assert.Equal(HttpStatusCode.BadRequest, create.StatusCode);
    }

    [Fact]
    public async Task RoleChange_InvalidRole_Gets400()
    {
        await using var factory = await CreateFactoryAsync();
        using var adminClient = await BootstrapAdminAsync(factory, "ue-admin-6", "AdminPass123!");
        var target = await SeedUserAsync(factory, "ue-role-target", "TargetPass123!", Roles.Operator);

        using var role = await adminClient.PutAsJsonAsync($"/v1/users/{target.Id}/role", new { role = "NotARole" }, JsonOptions);
        Assert.Equal(HttpStatusCode.BadRequest, role.StatusCode);
    }

    [Fact]
    public async Task ResetPassword_WeakPassword_Gets400()
    {
        await using var factory = await CreateFactoryAsync();
        using var adminClient = await BootstrapAdminAsync(factory, "ue-admin-7", "AdminPass123!");
        var target = await SeedUserAsync(factory, "ue-reset-target", "TargetPass123!", Roles.Operator);

        using var reset = await adminClient.PostAsJsonAsync(
            $"/v1/users/{target.Id}/reset-password", new { newPassword = "short" }, JsonOptions);
        Assert.Equal(HttpStatusCode.BadRequest, reset.StatusCode);
    }

    [Fact]
    public async Task UnknownId_Gets404_OnRoleDisableEnableReset()
    {
        await using var factory = await CreateFactoryAsync();
        using var adminClient = await BootstrapAdminAsync(factory, "ue-admin-8", "AdminPass123!");
        const int unknownId = 999_999;

        using var role = await adminClient.PutAsJsonAsync($"/v1/users/{unknownId}/role", new { role = Roles.Operator }, JsonOptions);
        Assert.Equal(HttpStatusCode.NotFound, role.StatusCode);

        using var disable = await adminClient.PostAsync($"/v1/users/{unknownId}/disable", null);
        Assert.Equal(HttpStatusCode.NotFound, disable.StatusCode);

        using var enable = await adminClient.PostAsync($"/v1/users/{unknownId}/enable", null);
        Assert.Equal(HttpStatusCode.NotFound, enable.StatusCode);

        using var reset = await adminClient.PostAsJsonAsync(
            $"/v1/users/{unknownId}/reset-password", new { newPassword = "SomePassword123!" }, JsonOptions);
        Assert.Equal(HttpStatusCode.NotFound, reset.StatusCode);
    }

    // ─────────────────────────────────────────────────────────────────────
    // Last-enabled-Admin lock-out guard.
    // ─────────────────────────────────────────────────────────────────────

    [Fact]
    public async Task CannotDisable_TheLastEnabledAdmin()
    {
        await using var factory = await CreateFactoryAsync();
        using var adminClient = await BootstrapAdminAsync(factory, "ue-lastadmin-1", "AdminPass123!");

        var self = await GetSelfAsync(adminClient);

        using var disable = await adminClient.PostAsync($"/v1/users/{self.Id}/disable", null);
        Assert.Equal(HttpStatusCode.BadRequest, disable.StatusCode);

        // Still enabled — the guard actually blocked the mutation, not just the response code.
        using var list = await adminClient.GetAsync("/v1/users");
        var users = await list.Content.ReadFromJsonAsync<UserDto[]>(JsonOptions);
        Assert.False(Assert.Single(users!, u => u.Id == self.Id).Disabled);
    }

    [Fact]
    public async Task CanDisable_AnAdmin_WhenAnotherEnabledAdminRemains()
    {
        await using var factory = await CreateFactoryAsync();
        using var adminClient = await BootstrapAdminAsync(factory, "ue-lastadmin-2", "AdminPass123!");
        var secondAdmin = await SeedUserAsync(factory, "ue-lastadmin-2b", "SecondPass123!", Roles.Admin);

        using var disable = await adminClient.PostAsJsonAsync($"/v1/users/{secondAdmin.Id}/disable", (object?)null, JsonOptions);
        // secondAdmin is disabled by the FIRST admin — the mutation is fine since the first admin
        // remains enabled.
        Assert.True(disable.StatusCode is HttpStatusCode.OK, $"expected OK, got {disable.StatusCode}");
    }

    [Fact]
    public async Task CannotChangeRole_OfTheLastEnabledAdmin_AwayFromAdmin()
    {
        await using var factory = await CreateFactoryAsync();
        using var adminClient = await BootstrapAdminAsync(factory, "ue-lastadmin-3", "AdminPass123!");

        var self = await GetSelfAsync(adminClient);

        using var role = await adminClient.PutAsJsonAsync($"/v1/users/{self.Id}/role", new { role = Roles.Operator }, JsonOptions);
        Assert.Equal(HttpStatusCode.BadRequest, role.StatusCode);
    }

    [Fact]
    public async Task CanChangeRole_OfAnAdmin_WhenAnotherEnabledAdminRemains()
    {
        await using var factory = await CreateFactoryAsync();
        using var adminClient = await BootstrapAdminAsync(factory, "ue-lastadmin-4", "AdminPass123!");
        var secondAdmin = await SeedUserAsync(factory, "ue-lastadmin-4b", "SecondPass123!", Roles.Admin);

        using var role = await adminClient.PutAsJsonAsync($"/v1/users/{secondAdmin.Id}/role", new { role = Roles.Operator }, JsonOptions);
        Assert.Equal(HttpStatusCode.OK, role.StatusCode);
    }

    /// <summary>A DISABLED Admin never counts toward "an enabled Admin remains" — disabling/demoting the
    /// one REMAINING enabled Admin must still be blocked even if a second, already-disabled Admin row
    /// exists on the roster.</summary>
    [Fact]
    public async Task CannotDisable_TheLastEnabledAdmin_EvenWhenADisabledAdminRowAlsoExists()
    {
        await using var factory = await CreateFactoryAsync();
        using var adminClient = await BootstrapAdminAsync(factory, "ue-lastadmin-5", "AdminPass123!");
        var disabledAdmin = await SeedUserAsync(factory, "ue-lastadmin-5b", "DisabledPass123!", Roles.Admin);

        using var preDisable = await adminClient.PostAsync($"/v1/users/{disabledAdmin.Id}/disable", null);
        Assert.Equal(HttpStatusCode.OK, preDisable.StatusCode);

        var self = await GetSelfAsync(adminClient);
        using var disableSelf = await adminClient.PostAsync($"/v1/users/{self.Id}/disable", null);
        Assert.Equal(HttpStatusCode.BadRequest, disableSelf.StatusCode);
    }

    private static async Task<UserDto> GetSelfAsync(HttpClient adminClient)
    {
        using var me = await adminClient.GetAsync("/v1/auth/me");
        Assert.Equal(HttpStatusCode.OK, me.StatusCode);
        var meDto = await me.Content.ReadFromJsonAsync<JsonElement>();
        var username = meDto.GetProperty("username").GetString();

        using var list = await adminClient.GetAsync("/v1/users");
        var users = await list.Content.ReadFromJsonAsync<UserDto[]>(JsonOptions);
        return Assert.Single(users!, u => u.Username == username);
    }

    // ─────────────────────────────────────────────────────────────────────
    // Audit — right action/actor/old-new per mutation, NEVER a password anywhere.
    // ─────────────────────────────────────────────────────────────────────

    [Fact]
    public async Task Create_Audited_WithNewUsernameAndRole_NeverThePassword()
    {
        await using var factory = await CreateFactoryAsync();
        using var adminClient = await BootstrapAdminAsync(factory, "ue-audit-admin-1", "AdminPass123!");

        using var create = await adminClient.PostAsJsonAsync(
            "/v1/users", new { username = "ue-audit-created", password = "CreatedPass123!", role = Roles.Engineer }, JsonOptions);
        Assert.Equal(HttpStatusCode.OK, create.StatusCode);

        var entries = await GetAuditEntriesAsync(adminClient, "user.create");
        var entry = Assert.Single(entries, e => e.TargetId != null && e.NewValueJson != null && e.NewValueJson.Contains("ue-audit-created"));
        Assert.Equal("ue-audit-admin-1", entry.ActorUsername);
        Assert.Null(entry.OldValueJson);
        Assert.Contains("ue-audit-created", entry.NewValueJson);
        Assert.Contains(Roles.Engineer, entry.NewValueJson);
        Assert.DoesNotContain("CreatedPass123!", entry.NewValueJson);

        // NEVER a password anywhere across the whole action's audit trail (belt-and-suspenders — checks
        // every row this action ever wrote, not just the one entry asserted on above).
        Assert.All(entries, e =>
        {
            Assert.DoesNotContain("CreatedPass123!", e.OldValueJson ?? string.Empty);
            Assert.DoesNotContain("CreatedPass123!", e.NewValueJson ?? string.Empty);
        });
    }

    [Fact]
    public async Task RoleChange_Audited_WithOldAndNewRole()
    {
        await using var factory = await CreateFactoryAsync();
        using var adminClient = await BootstrapAdminAsync(factory, "ue-audit-admin-2", "AdminPass123!");
        var target = await SeedUserAsync(factory, "ue-audit-role-target", "TargetPass123!", Roles.Operator);

        using var role = await adminClient.PutAsJsonAsync($"/v1/users/{target.Id}/role", new { role = Roles.Engineer }, JsonOptions);
        Assert.Equal(HttpStatusCode.OK, role.StatusCode);

        var entries = await GetAuditEntriesAsync(adminClient, "user.role_change");
        var entry = Assert.Single(entries, e => e.TargetId == target.Id.ToString());
        Assert.Equal("ue-audit-admin-2", entry.ActorUsername);
        Assert.Equal(Roles.Operator, entry.OldValueJson?.Trim('"'));
        Assert.Equal(Roles.Engineer, entry.NewValueJson?.Trim('"'));
    }

    [Fact]
    public async Task DisableAndEnable_Audited_AsDistinctActions_ByTheAuthenticatedAdmin()
    {
        await using var factory = await CreateFactoryAsync();
        using var adminClient = await BootstrapAdminAsync(factory, "ue-audit-admin-3", "AdminPass123!");
        var target = await SeedUserAsync(factory, "ue-audit-disable-target", "TargetPass123!", Roles.Operator);

        using var disable = await adminClient.PostAsync($"/v1/users/{target.Id}/disable", null);
        Assert.Equal(HttpStatusCode.OK, disable.StatusCode);

        using var enable = await adminClient.PostAsync($"/v1/users/{target.Id}/enable", null);
        Assert.Equal(HttpStatusCode.OK, enable.StatusCode);

        var disableEntries = await GetAuditEntriesAsync(adminClient, "user.disable");
        var disableEntry = Assert.Single(disableEntries, e => e.TargetId == target.Id.ToString());
        Assert.Equal("ue-audit-admin-3", disableEntry.ActorUsername);

        var enableEntries = await GetAuditEntriesAsync(adminClient, "user.enable");
        var enableEntry = Assert.Single(enableEntries, e => e.TargetId == target.Id.ToString());
        Assert.Equal("ue-audit-admin-3", enableEntry.ActorUsername);
    }

    [Fact]
    public async Task PasswordReset_Audited_WithNoOldOrNewValue_NeverThePassword()
    {
        await using var factory = await CreateFactoryAsync();
        using var adminClient = await BootstrapAdminAsync(factory, "ue-audit-admin-4", "AdminPass123!");
        var target = await SeedUserAsync(factory, "ue-audit-reset-target", "TargetPass123!", Roles.Operator);

        using var reset = await adminClient.PostAsJsonAsync(
            $"/v1/users/{target.Id}/reset-password", new { newPassword = "BrandNewSecret789!" }, JsonOptions);
        Assert.Equal(HttpStatusCode.OK, reset.StatusCode);

        var entries = await GetAuditEntriesAsync(adminClient, "user.password_reset");
        var entry = Assert.Single(entries, e => e.TargetId == target.Id.ToString());
        Assert.Equal("ue-audit-admin-4", entry.ActorUsername);
        Assert.Null(entry.OldValueJson);
        Assert.Null(entry.NewValueJson);
    }

    [Fact]
    public async Task GetUsers_NeverSerializesAPasswordHashOrSecurityStamp()
    {
        await using var factory = await CreateFactoryAsync();
        using var adminClient = await BootstrapAdminAsync(factory, "ue-shape-admin", "AdminPass123!");
        await SeedUserAsync(factory, "ue-shape-target", "TargetPass123!", Roles.Operator);

        using var list = await adminClient.GetAsync("/v1/users");
        Assert.Equal(HttpStatusCode.OK, list.StatusCode);
        var raw = await list.Content.ReadAsStringAsync();

        Assert.DoesNotContain("passwordHash", raw, StringComparison.OrdinalIgnoreCase);
        Assert.DoesNotContain("securityStamp", raw, StringComparison.OrdinalIgnoreCase);
        Assert.DoesNotContain("TargetPass123!", raw);
    }

    // ─────────────────────────────────────────────────────────────────────
    // security_stamp bump → the target's existing session is revoked on its NEXT request (D1's
    // OnValidatePrincipal). Disable is the mutation under test — role change/reset-password bump the
    // exact same stamp via the exact same IUserStore calls, so this one case stands in for all three.
    // ─────────────────────────────────────────────────────────────────────

    [Fact]
    public async Task DisablingAUser_RevokesTheirExistingSession_OnItsNextRequest()
    {
        await using var factory = await CreateFactoryAsync();
        using var adminClient = await BootstrapAdminAsync(factory, "ue-revoke-admin", "AdminPass123!");
        var target = await SeedUserAsync(factory, "ue-revoke-target", "TargetPass123!", Roles.Operator);

        using var targetClient = await LoginAsAsync(factory, "ue-revoke-target", "TargetPass123!");
        using (var me = await targetClient.GetAsync("/v1/auth/me"))
        {
            Assert.Equal(HttpStatusCode.OK, me.StatusCode); // session genuinely live before the disable.
        }

        using var disable = await adminClient.PostAsync($"/v1/users/{target.Id}/disable", null);
        Assert.Equal(HttpStatusCode.OK, disable.StatusCode);

        using var meAfter = await targetClient.GetAsync("/v1/auth/me");
        Assert.Equal(HttpStatusCode.Unauthorized, meAfter.StatusCode);
    }
}
