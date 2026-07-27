using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Identity;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.AspNetCore.Routing;
using Microsoft.Extensions.DependencyInjection;
using St4i.EngineApi.Auth;
using Xunit;

namespace St4i.EngineApi.Tests.Auth;

/// <summary>
/// WS-D-D2 — two test families:
///
///  1. A METADATA SWEEP (<see cref="EveryV1Route_CarriesExactlyTheExpectedPolicyOrAnonymous"/>) —
///     resolves the real, fully-mapped <see cref="EndpointDataSource"/> straight out of the booted
///     <c>St4i.EngineApi</c> composition root (same <see cref="WebApplicationFactory{TEntryPoint}"/>
///     convention <c>AuthPipelineTests</c> already established) and walks every <c>/v1/*</c>
///     <see cref="RouteEndpoint"/>'s metadata, comparing it against the WS-D §2 role matrix
///     (<c>task-2-brief.md</c>) baked into <see cref="ExpectedRoutes"/> below. This is what catches "a
///     route got mapped but somebody forgot the .RequireAuthorization(...)/.AllowAnonymous() chain" —
///     the ~300 pre-existing hand-built-<c>DefaultHttpContext</c> handler tests never boot the real
///     pipeline, so they can't see a missing policy attachment at all; this sweep is the only thing in
///     the whole suite that actually looks at endpoint metadata.
///
///  2. A FEW REAL-PIPELINE 403/200 checks (<see cref="Rbac_EnforcesPerRoleAccess_AcrossOperatorEngineerAdmin"/>)
///     — bootstraps an Admin, seeds an Operator + an Engineer directly via <see cref="IUserStore"/> (no
///     user-management endpoints exist yet — D3/D7), logs in as each, and asserts the ACTUAL 403/200
///     outcome for a representative sample of routes per role. This is the "does the policy plumbing
///     actually enforce it end to end" complement to the metadata sweep (which only proves the metadata
///     is attached, not that <c>AddAuthorization</c>'s <c>RequireRole</c> definitions are correct).
///
/// Plus the two D1-carried hardening minors: login timing equalization (unknown/disabled-user paths
/// still 401, never 500) and change-password's null/empty NewPassword 400.
///
/// WS-D-D3 — see <see cref="SecurityEnvVarTests"/>'s doc comment: this class shares its
/// <c>[Collection(...)]</c> tag with <see cref="AuthPipelineTests"/>/<c>AuditEndpointsTests</c> so xUnit
/// runs all three sequentially relative to each other, instead of racing over the same real process
/// environment variables.
/// </summary>
[Collection(SecurityEnvVarTests.CollectionName)]
public sealed class RbacPolicyTests
{
    private static readonly SemaphoreSlim EnvLock = new(1, 1);
    private static readonly JsonSerializerOptions JsonOptions = new(JsonSerializerDefaults.Web);

    /// <summary>Same env-var-swap-then-eager-build protocol as <c>AuthPipelineTests.CreateFactoryAsync</c>
    /// (duplicated here rather than shared — that method is <c>private</c> to its own class, and this
    /// class needs the identical "throwaway temp dirs + force Production environment" recipe for the same
    /// reasons documented there).</summary>
    private static async Task<WebApplicationFactory<Program>> CreateFactoryAsync(bool demoEnabled)
    {
        var securityDir = Directory.CreateTempSubdirectory("st4i-rbac-security-").FullName;
        var historianDir = Directory.CreateTempSubdirectory("st4i-rbac-historian-").FullName;
        var walDir = Directory.CreateTempSubdirectory("st4i-rbac-wal-").FullName;
        // FF-1 — isolated the same way as historian/WAL above: without this, FleetHost.UpdateSettings' new
        // persist-on-change behavior would read/write the REAL %ProgramData%\ST4I\sim\settings\
        // fleet-settings.json, leaking state across test runs (and across the whole test suite).
        var settingsDir = Directory.CreateTempSubdirectory("st4i-rbac-settings-").FullName;
        // EC-3 review follow-up — without these, every WebApplicationFactory<Program> boot below (UNS
        // defaults ON) resolves DeviceIdentityStore/SiteLinkStore to the REAL %ProgramData%\ST4I\sim\
        // identity\ / ...\sitelink\, minting a real CNG keystore entry (PersistKeySet) and writing a real
        // site-link.json on every single test run, with no cleanup — see SiteEndpointsTests' own doc
        // comment for the full rationale (that class isolates these two; this one hadn't, until now).
        var identityDir = Directory.CreateTempSubdirectory("st4i-rbac-identity-").FullName;
        var siteLinkDir = Directory.CreateTempSubdirectory("st4i-rbac-sitelink-").FullName;

        await EnvLock.WaitAsync().ConfigureAwait(false);
        var prevSecurityDir = Environment.GetEnvironmentVariable("ST4I_SECURITY_DIR");
        var prevDemoEnabled = Environment.GetEnvironmentVariable("ST4I_DEMO_ENABLED");
        var prevHistorianDir = Environment.GetEnvironmentVariable("ST4I_HISTORIAN_DIR");
        var prevWalDir = Environment.GetEnvironmentVariable("ST4I_WAL_DIR");
        var prevSettingsDir = Environment.GetEnvironmentVariable("ST4I_SETTINGS_DIR");
        var prevIdentityDir = Environment.GetEnvironmentVariable("ST4I_IDENTITY_DIR");
        var prevSiteLinkDir = Environment.GetEnvironmentVariable("ST4I_SITELINK_DIR");
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
            Environment.SetEnvironmentVariable("ASPNETCORE_ENVIRONMENT", prevEnvironment);
            EnvLock.Release();
        }
    }

    /// <summary>Seeds a user directly via <see cref="IUserStore"/> (the same seam a future D3/D7
    /// user-management endpoint would call) — there is no <c>POST /v1/users</c> yet, so tests that need an
    /// Operator/Engineer account go straight to the store, exactly like the brief calls for.</summary>
    private static async Task CreateUserAsync(WebApplicationFactory<Program> factory, string username, string password, string role)
    {
        var userStore = factory.Services.GetRequiredService<IUserStore>();
        var hasher = new PasswordHasher<AppUser>();
        var hash = hasher.HashPassword(AppUser.Instance, password);
        await userStore.CreateAsync(username, hash, role, null, "test", CancellationToken.None)
            .ConfigureAwait(false);
    }

    private static async Task<HttpClient> LoginAsAsync(WebApplicationFactory<Program> factory, string username, string password)
    {
        var client = factory.CreateClient(new WebApplicationFactoryClientOptions { HandleCookies = true });
        using var login = await client.PostAsJsonAsync("/v1/auth/login", new { username, password }, JsonOptions).ConfigureAwait(false);
        Assert.Equal(HttpStatusCode.OK, login.StatusCode);
        return client;
    }

    // ─────────────────────────────────────────────────────────────────────
    // 1) Metadata sweep — every /v1/* route carries exactly the matrix's policy (or AllowAnonymous).
    // ─────────────────────────────────────────────────────────────────────

    /// <summary><c>Methods</c> empty means "no HTTP-method restriction at all" — only the inspector WS
    /// route (a bare <c>app.Map(...)</c>, not <c>MapGet</c>/etc.) matches that shape.
    /// <c>Policy</c> null means <c>AllowAnonymous</c> (D1, unchanged by this task).</summary>
    private sealed record RouteExpectation(string Pattern, string[] Methods, string? Policy);

    private static readonly RouteExpectation[] ExpectedRoutes =
    {
        // AllowAnonymous (D1 — untouched by this task)
        new("/v1/capabilities", new[] { "GET" }, null),
        new("/v1/health", new[] { "GET" }, null),
        new("/v1/auth/bootstrap-status", new[] { "GET" }, null),
        new("/v1/auth/bootstrap", new[] { "POST" }, null),
        new("/v1/auth/login", new[] { "POST" }, null),

        // Operator
        new("/v1/fleet", new[] { "GET" }, Policies.Operator),
        new("/v1/machines/{code}", new[] { "GET" }, Policies.Operator),
        new("/v1/fleet/start", new[] { "POST" }, Policies.Operator),
        new("/v1/fleet/stop", new[] { "POST" }, Policies.Operator),
        new("/v1/fleet/estop", new[] { "POST" }, Policies.Operator),
        new("/v1/fleet/estop/reset", new[] { "POST" }, Policies.Operator),
        new("/v1/mode", new[] { "GET" }, Policies.Operator),
        new("/v1/safety", new[] { "GET" }, Policies.Operator),
        new("/v1/products", new[] { "GET" }, Policies.Operator),
        new("/v1/products/{code}", new[] { "GET" }, Policies.Operator),
        new("/v1/products/{code}/points", new[] { "GET" }, Policies.Operator),
        new("/v1/products/{code}/points/{pointCode}", new[] { "GET" }, Policies.Operator),
        new("/v1/recipes", new[] { "GET" }, Policies.Operator),
        new("/v1/recipes/{code}", new[] { "GET" }, Policies.Operator),
        new("/v1/machines/{code}/config/check", new[] { "GET" }, Policies.Operator),
        new("/v1/machines/{code}/config/diff", new[] { "GET" }, Policies.Operator),
        new("/v1/machines/{code}/config/history", new[] { "GET" }, Policies.Operator),
        new("/v1/machines/{code}/settings", new[] { "GET" }, Policies.Operator),
        new("/v1/machines/{code}/settings/history", new[] { "GET" }, Policies.Operator),
        new("/v1/scenario", new[] { "GET" }, Policies.Operator),
        new("/v1/historian/results", new[] { "GET" }, Policies.Operator),
        new("/v1/historian/results/export.csv", new[] { "GET" }, Policies.Operator),
        new("/v1/historian/serial/{serial}", new[] { "GET" }, Policies.Operator),
        new("/v1/historian/telemetry", new[] { "GET" }, Policies.Operator),
        new("/v1/historian/stats", new[] { "GET" }, Policies.Operator),
        new("/v1/historian/oee", new[] { "GET" }, Policies.Operator),
        new("/v1/historian/oee/fleet", new[] { "GET" }, Policies.Operator),
        new("/v1/historian/oee/settings", new[] { "GET" }, Policies.Operator),
        new("/v1/historian/report.pdf", new[] { "GET" }, Policies.Operator),
        new("/v1/auth/logout", new[] { "POST" }, Policies.Operator),
        new("/v1/auth/me", new[] { "GET" }, Policies.Operator),
        new("/v1/auth/change-password", new[] { "POST" }, Policies.Operator),
        new("/v1/assets", new[] { "GET" }, Policies.Operator),
        new("/v1/assets/{code}", new[] { "GET" }, Policies.Operator),
        new("/v1/site", new[] { "GET" }, Policies.Operator),
        new("/v1/site/identity", new[] { "GET" }, Policies.Operator),

        // Engineer
        new("/v1/machines/{code}/sync-config", new[] { "POST" }, Policies.Engineer),
        new("/v1/mode", new[] { "PUT" }, Policies.Engineer),
        new("/v1/settings", new[] { "GET" }, Policies.Engineer),
        new("/v1/settings", new[] { "PUT" }, Policies.Engineer),
        new("/v1/settings/probe", new[] { "POST" }, Policies.Engineer),
        new("/v1/onboarding/register", new[] { "POST" }, Policies.Engineer),
        new("/v1/onboarding/poll", new[] { "POST" }, Policies.Engineer),
        new("/v1/onboarding/claim", new[] { "POST" }, Policies.Engineer),
        new("/v1/onboarding/enroll", new[] { "POST" }, Policies.Engineer),
        new("/v1/onboarding/paste-key", new[] { "POST" }, Policies.Engineer),
        new("/v1/products/{code}", new[] { "POST", "PUT" }, Policies.Engineer),
        new("/v1/products/{code}", new[] { "DELETE" }, Policies.Engineer),
        new("/v1/products/{code}/points/{pointCode}", new[] { "POST", "PUT" }, Policies.Engineer),
        new("/v1/products/{code}/points/{pointCode}", new[] { "DELETE" }, Policies.Engineer),
        new("/v1/recipes/{code}", new[] { "PUT" }, Policies.Engineer),
        new("/v1/recipes/{code}", new[] { "DELETE" }, Policies.Engineer),
        new("/v1/machines/{code}/config/pull", new[] { "POST" }, Policies.Engineer),
        new("/v1/machines/{code}/config/push", new[] { "POST" }, Policies.Engineer),
        new("/v1/machines/{code}/settings/{key}", new[] { "PUT" }, Policies.Engineer),
        new("/v1/machines/{code}/settings/{key}", new[] { "DELETE" }, Policies.Engineer),
        new("/v1/machines/{code}/settings/pull", new[] { "POST" }, Policies.Engineer),
        new("/v1/machines/{code}/settings/push", new[] { "POST" }, Policies.Engineer),
        new("/v1/scenario", new[] { "POST" }, Policies.Engineer),
        new("/v1/scenario/preset", new[] { "POST" }, Policies.Engineer),
        new("/v1/scenario/burst", new[] { "POST" }, Policies.Engineer),
        new("/v1/historian/oee/settings", new[] { "PUT" }, Policies.Engineer),
        new("/v1/assets/{code}/lifecycle", new[] { "PUT" }, Policies.Engineer),
        new("/v1/site", new[] { "PUT" }, Policies.Engineer),
        new("/v1/inspector/stream", Array.Empty<string>(), Policies.Engineer),

        // Admin
        new("/v1/historian/prune", new[] { "POST" }, Policies.Admin),
        new("/v1/audit", new[] { "GET" }, Policies.Admin),
        new("/v1/audit/verify", new[] { "GET" }, Policies.Admin),

        // Admin — WS-D-D7 user management (UserEndpoints.cs)
        new("/v1/users", new[] { "GET" }, Policies.Admin),
        new("/v1/users", new[] { "POST" }, Policies.Admin),
        new("/v1/users/{id}/role", new[] { "PUT" }, Policies.Admin),
        new("/v1/users/{id}/disable", new[] { "POST" }, Policies.Admin),
        new("/v1/users/{id}/enable", new[] { "POST" }, Policies.Admin),
        new("/v1/users/{id}/reset-password", new[] { "POST" }, Policies.Admin),
    };

    [Fact]
    public async Task EveryV1Route_CarriesExactlyTheExpectedPolicyOrAnonymous()
    {
        await using var factory = await CreateFactoryAsync(demoEnabled: false);
        var dataSource = factory.Services.GetRequiredService<EndpointDataSource>();

        var actualV1Routes = dataSource.Endpoints
            .OfType<RouteEndpoint>()
            .Where(e => e.RoutePattern.RawText is { } text && text.StartsWith("/v1", StringComparison.Ordinal))
            .ToList();

        // Catches BOTH directions: a route in the matrix that's no longer mapped, AND a route mapped
        // that's missing from the matrix entirely (an unreviewed new endpoint) — not just "the ones we
        // remembered to check line up".
        Assert.Equal(ExpectedRoutes.Length, actualV1Routes.Count);

        foreach (var expectation in ExpectedRoutes)
        {
            var candidates = actualV1Routes.Where(e => e.RoutePattern.RawText == expectation.Pattern).ToList();

            var match = expectation.Methods.Length == 0
                ? candidates.FirstOrDefault(e => e.Metadata.GetMetadata<IHttpMethodMetadata>() is null)
                : candidates.FirstOrDefault(e =>
                {
                    var methods = e.Metadata.GetMetadata<IHttpMethodMetadata>()?.HttpMethods;
                    return methods is not null
                        && methods.Count == expectation.Methods.Length
                        && methods.OrderBy(m => m, StringComparer.Ordinal)
                            .SequenceEqual(expectation.Methods.OrderBy(m => m, StringComparer.Ordinal));
                });

            Assert.True(
                match is not null,
                $"No mapped endpoint found for [{string.Join(",", expectation.Methods)}] {expectation.Pattern} " +
                "— a route in the WS-D §2 matrix is missing from the app (or its HTTP method(s) changed).");

            var allowAnonymous = match!.Metadata.GetMetadata<IAllowAnonymous>() is not null;

            if (expectation.Policy is null)
            {
                Assert.True(allowAnonymous, $"{expectation.Pattern} was expected to be AllowAnonymous but isn't.");
                continue;
            }

            Assert.False(allowAnonymous, $"{expectation.Pattern} was expected to require {expectation.Policy} but is AllowAnonymous.");

            var policyNames = match.Metadata.OfType<IAuthorizeData>()
                .Select(a => a.Policy)
                .Where(p => p is not null)
                .Distinct()
                .ToList();

            Assert.True(
                policyNames.Count == 1 && policyNames[0] == expectation.Policy,
                $"{expectation.Pattern} [{string.Join(",", expectation.Methods)}] expected policy " +
                $"\"{expectation.Policy}\" but found [{string.Join(",", policyNames)}].");
        }
    }

    [Fact]
    public async Task FallbackToFile_IsTheOnlyNonV1Endpoint_AndStaysAllowAnonymous()
    {
        await using var factory = await CreateFactoryAsync(demoEnabled: false);
        var dataSource = factory.Services.GetRequiredService<EndpointDataSource>();

        var nonV1Routes = dataSource.Endpoints
            .OfType<RouteEndpoint>()
            .Where(e => e.RoutePattern.RawText is { } text && !text.StartsWith("/v1", StringComparison.Ordinal))
            .ToList();

        Assert.Single(nonV1Routes);
        Assert.NotNull(nonV1Routes[0].Metadata.GetMetadata<IAllowAnonymous>());
    }

    // ─────────────────────────────────────────────────────────────────────
    // 2) Real-pipeline 403/200 enforcement across Operator/Engineer/Admin.
    // ─────────────────────────────────────────────────────────────────────

    [Fact]
    public async Task Rbac_EnforcesPerRoleAccess_AcrossOperatorEngineerAdmin()
    {
        await using var factory = await CreateFactoryAsync(demoEnabled: false);

        // Bootstrap mints the FIRST user as Admin (AuthEndpoints.MapAuthEndpoints — unconditionally Roles.Admin).
        using (var bootstrapClient = factory.CreateClient())
        using (var bootstrap = await bootstrapClient.PostAsJsonAsync(
                   "/v1/auth/bootstrap",
                   new { username = "rbac-admin", password = "AdminPass123!", displayName = (string?)null },
                   JsonOptions))
        {
            Assert.Equal(HttpStatusCode.OK, bootstrap.StatusCode);
        }

        await CreateUserAsync(factory, "rbac-operator", "OperatorPass123!", Roles.Operator);
        await CreateUserAsync(factory, "rbac-engineer", "EngineerPass123!", Roles.Engineer);

        // ── Operator: can read the fleet, cannot switch mode.
        using (var operatorClient = await LoginAsAsync(factory, "rbac-operator", "OperatorPass123!"))
        {
            using var fleet = await operatorClient.GetAsync("/v1/fleet");
            Assert.Equal(HttpStatusCode.OK, fleet.StatusCode);

            using var putMode = await operatorClient.PutAsJsonAsync("/v1/mode", new { mode = "Live" }, JsonOptions);
            Assert.Equal(HttpStatusCode.Forbidden, putMode.StatusCode);
        }

        // ── Engineer: can switch mode, cannot prune the historian, cannot disable TLS verification.
        using (var engineerClient = await LoginAsAsync(factory, "rbac-engineer", "EngineerPass123!"))
        {
            using var putMode = await engineerClient.PutAsJsonAsync("/v1/mode", new { mode = "Live" }, JsonOptions);
            Assert.Equal(HttpStatusCode.OK, putMode.StatusCode);

            using var prune = await engineerClient.PostAsJsonAsync("/v1/historian/prune", new { olderThanDays = 9999 }, JsonOptions);
            Assert.Equal(HttpStatusCode.Forbidden, prune.StatusCode);

            using var verifyTlsOff = await engineerClient.PutAsJsonAsync(
                "/v1/settings", new { verifyTls = false }, JsonOptions);
            Assert.Equal(HttpStatusCode.Forbidden, verifyTlsOff.StatusCode);
        }

        // ── Admin: all of the above succeed.
        using (var adminClient = await LoginAsAsync(factory, "rbac-admin", "AdminPass123!"))
        {
            using var putMode = await adminClient.PutAsJsonAsync("/v1/mode", new { mode = "Live" }, JsonOptions);
            Assert.Equal(HttpStatusCode.OK, putMode.StatusCode);

            using var prune = await adminClient.PostAsJsonAsync("/v1/historian/prune", new { olderThanDays = 9999 }, JsonOptions);
            Assert.Equal(HttpStatusCode.OK, prune.StatusCode);

            using var verifyTlsOff = await adminClient.PutAsJsonAsync(
                "/v1/settings", new { verifyTls = false }, JsonOptions);
            Assert.Equal(HttpStatusCode.OK, verifyTlsOff.StatusCode);
        }
    }

    // ─────────────────────────────────────────────────────────────────────
    // 3) D1-carried hardening minor #1 — login timing equalization.
    // ─────────────────────────────────────────────────────────────────────

    [Fact]
    public async Task Login_UnknownUser_And_DisabledUser_Both401_NeverThrow()
    {
        await using var factory = await CreateFactoryAsync(demoEnabled: false);

        // Unknown username — never hit the store's user row at all.
        using (var client = factory.CreateClient())
        using (var response = await client.PostAsJsonAsync(
                   "/v1/auth/login", new { username = "nobody-such-user", password = "whatever123" }, JsonOptions))
        {
            Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
        }

        // Disabled user — a real row that fails the `user.Disabled` check.
        var userStore = factory.Services.GetRequiredService<IUserStore>();
        var hasher = new PasswordHasher<AppUser>();
        var hash = hasher.HashPassword(AppUser.Instance, "RealPassword123!");
        var created = await userStore.CreateAsync("rbac-disabled", hash, Roles.Operator, null, "test", CancellationToken.None);
        await userStore.SetDisabledAsync(created.Id, disabled: true, CancellationToken.None);

        using (var client = factory.CreateClient())
        using (var response = await client.PostAsJsonAsync(
                   "/v1/auth/login", new { username = "rbac-disabled", password = "RealPassword123!" }, JsonOptions))
        {
            Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
        }
    }

    // ─────────────────────────────────────────────────────────────────────
    // 4) D1-carried hardening minor #2 — change-password rejects null/empty NewPassword with 400.
    // ─────────────────────────────────────────────────────────────────────

    [Fact]
    public async Task ChangePassword_NullOrEmptyNewPassword_Gets400_NotA500()
    {
        await using var factory = await CreateFactoryAsync(demoEnabled: false);

        using (var bootstrapClient = factory.CreateClient())
        using (var bootstrap = await bootstrapClient.PostAsJsonAsync(
                   "/v1/auth/bootstrap",
                   new { username = "cp-admin", password = "AdminPass123!", displayName = (string?)null },
                   JsonOptions))
        {
            Assert.Equal(HttpStatusCode.OK, bootstrap.StatusCode);
        }

        using var client = await LoginAsAsync(factory, "cp-admin", "AdminPass123!");

        using (var nullNew = await client.PostAsJsonAsync(
                   "/v1/auth/change-password",
                   new { currentPassword = "AdminPass123!", newPassword = (string?)null },
                   JsonOptions))
        {
            Assert.Equal(HttpStatusCode.BadRequest, nullNew.StatusCode);
        }

        using (var emptyNew = await client.PostAsJsonAsync(
                   "/v1/auth/change-password",
                   new { currentPassword = "AdminPass123!", newPassword = "" },
                   JsonOptions))
        {
            Assert.Equal(HttpStatusCode.BadRequest, emptyNew.StatusCode);
        }

        using (var whitespaceNew = await client.PostAsJsonAsync(
                   "/v1/auth/change-password",
                   new { currentPassword = "AdminPass123!", newPassword = "   " },
                   JsonOptions))
        {
            Assert.Equal(HttpStatusCode.BadRequest, whitespaceNew.StatusCode);
        }

        // Still logged in / account untouched — a legitimate change with a real NewPassword still works.
        using var goodChange = await client.PostAsJsonAsync(
            "/v1/auth/change-password",
            new { currentPassword = "AdminPass123!", newPassword = "BrandNewPass456!" },
            JsonOptions);
        Assert.Equal(HttpStatusCode.OK, goodChange.StatusCode);
    }
}
