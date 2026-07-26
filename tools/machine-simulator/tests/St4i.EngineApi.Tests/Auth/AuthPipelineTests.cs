using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Microsoft.AspNetCore.Mvc.Testing;
using St4i.EngineApi.Auth;
using Xunit;

namespace St4i.EngineApi.Tests.Auth;

/// <summary>
/// WS-D-D1 — the FIRST test in this project to boot the REAL <c>St4i.EngineApi</c> pipeline
/// (<c>Microsoft.AspNetCore.Mvc.Testing</c>'s <c>WebApplicationFactory&lt;Program&gt;</c>) instead of
/// composing <c>FleetHost</c>/etc. directly the way every other EngineApi test does — which is exactly
/// why those other tests stay green even after the default-deny fallback policy lands: they never run
/// <c>Program.cs</c>'s <c>UseAuthorization</c> at all, so there's nothing in this task that could break
/// them.
///
/// <c>Program.cs</c> reads <c>ST4I_SECURITY_DIR</c>/<c>ST4I_DEMO_ENABLED</c>/<c>ST4I_HISTORIAN_DIR</c>/
/// <c>ST4I_WAL_DIR</c> straight off <see cref="Environment.GetEnvironmentVariable(string)"/> at startup —
/// there's no <c>IConfiguration</c> seam for any of them — so <see cref="CreateFactoryAsync"/> sets the
/// REAL process environment variables, forces the host to build EAGERLY (touching <c>factory.Server</c>)
/// while they're still set, then restores the previous values immediately. Program.cs's composition root
/// only ever reads them once (at that eager build), so narrowing the mutation window to "right before/
/// during that one build call" keeps the already-accepted-elsewhere real-env-var risk (see
/// <c>DemoModeGateTests.DefaultCtor_ReadsRealEnvironmentVariable</c>, which does the same kind of thing
/// for a single env var) as small as it can be — and a process-wide <see cref="SemaphoreSlim"/> here
/// additionally serializes every factory build in THIS class against each other (methods within one xUnit
/// test class already run sequentially by default, but this also covers the (small, pre-existing) risk of
/// racing a DIFFERENT test class that touches the same real env vars).
///
/// WS-D-D3 — that "small, pre-existing risk" stopped being small once a THIRD class
/// (<c>AuditEndpointsTests</c>) started doing the same env-var swap: three classes each with their OWN
/// private <c>EnvLock</c> (xUnit runs different test classes in parallel by default — each implicit
/// per-class collection is its own thread) is enough for the race to show up in practice, not just in
/// theory. <c>[Collection(SecurityEnvVarTests.CollectionName)]</c> below puts this class in the SAME
/// xUnit collection as <see cref="RbacPolicyTests"/> and <c>AuditEndpointsTests</c> — xUnit always runs
/// every test in one collection sequentially relative to the others in that SAME collection (regardless
/// of whether a <c>[CollectionDefinition]</c> exists for the name), which is a stronger guarantee than
/// this class's own <c>EnvLock</c> could ever provide on its own (that lock only ever serialized calls
/// against ITSELF).
/// </summary>
[Collection(SecurityEnvVarTests.CollectionName)]
public sealed class AuthPipelineTests
{
    private static readonly SemaphoreSlim EnvLock = new(1, 1);
    private static readonly JsonSerializerOptions JsonOptions = new(JsonSerializerDefaults.Web);

    /// <summary>Root cause of a DirectoryNotFoundException this test class hit while under development
    /// (worth documenting — it's not obvious): the SDK bakes a Static Web Assets manifest into the build
    /// (<c>obj\...\staticwebassets.build.json</c>) that records this PROJECT'S OWN "self" wwwroot content
    /// root as the literal, hardcoded, absolute SOURCE path
    /// <c>&lt;repo&gt;\src\St4i.EngineApi\wwwroot\</c> — not a runtime-relative placeholder, and not
    /// something a runtime <c>ContentRootPath</c>/<c>UseContentRoot</c> override can redirect. ASP.NET Core
    /// only ever LOADS that manifest (<c>StaticWebAssetsLoader.UseStaticWebAssets</c>) when
    /// <c>IWebHostEnvironment.EnvironmentName == "Development"</c> — the default for a bare
    /// <c>WebApplicationFactory&lt;TEntryPoint&gt;</c>, but NOT for a normal packaged/published run
    /// (unset <c>ASPNETCORE_ENVIRONMENT</c> defaults to "Production", which is what every other run mode
    /// of this app already uses, hence this bug had never surfaced before this task's first use of
    /// <c>WebApplicationFactory</c>). This app doesn't use the SDK's dev-time Static Web Assets feature at
    /// all — Program.cs serves <c>wwwroot/</c> itself via a manually-set <c>WebRootFileProvider</c> — so
    /// forcing a non-Development environment name for the test host sidesteps the whole manifest-loading
    /// code path (and its hardcoded source-tree path) entirely, with no behavior loss.</summary>
    private static async Task<WebApplicationFactory<Program>> CreateFactoryAsync(bool demoEnabled)
    {
        var securityDir = Directory.CreateTempSubdirectory("st4i-auth-pipeline-security-").FullName;
        var historianDir = Directory.CreateTempSubdirectory("st4i-auth-pipeline-historian-").FullName;
        var walDir = Directory.CreateTempSubdirectory("st4i-auth-pipeline-wal-").FullName;

        await EnvLock.WaitAsync().ConfigureAwait(false);
        var prevSecurityDir = Environment.GetEnvironmentVariable("ST4I_SECURITY_DIR");
        var prevDemoEnabled = Environment.GetEnvironmentVariable("ST4I_DEMO_ENABLED");
        var prevHistorianDir = Environment.GetEnvironmentVariable("ST4I_HISTORIAN_DIR");
        var prevWalDir = Environment.GetEnvironmentVariable("ST4I_WAL_DIR");
        var prevEnvironment = Environment.GetEnvironmentVariable("ASPNETCORE_ENVIRONMENT");
        try
        {
            Environment.SetEnvironmentVariable("ST4I_SECURITY_DIR", securityDir);
            Environment.SetEnvironmentVariable("ST4I_DEMO_ENABLED", demoEnabled ? "true" : null);
            // Not this task's concern, but every WebApplicationFactory<Program> instance boots the WHOLE
            // composition root, historian/WAL included — pointing those at throwaway temp dirs too keeps
            // this test isolated from (and not contending with) a real %ProgramData%\ST4I\sim install on
            // whatever machine runs the suite, exactly like WS-A-T14/WS-C already designed those env vars
            // to allow.
            Environment.SetEnvironmentVariable("ST4I_HISTORIAN_DIR", historianDir);
            Environment.SetEnvironmentVariable("ST4I_WAL_DIR", walDir);
            // See this method's doc comment — sidesteps the Static Web Assets manifest's hardcoded
            // source-tree wwwroot path, which is only ever loaded in Development.
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

    [Fact]
    public async Task UnauthenticatedRequest_ToANonAnonymousRoute_Gets401_DefaultDenyFallbackWorks()
    {
        await using var factory = await CreateFactoryAsync(demoEnabled: false);
        using var client = factory.CreateClient();

        using var response = await client.GetAsync("/v1/fleet");
        Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
    }

    [Fact]
    public async Task HealthAndCapabilities_AreAnonymous_Return200_WithoutLogin()
    {
        await using var factory = await CreateFactoryAsync(demoEnabled: false);
        using var client = factory.CreateClient();

        using var health = await client.GetAsync("/v1/health");
        Assert.Equal(HttpStatusCode.OK, health.StatusCode);

        using var caps = await client.GetAsync("/v1/capabilities");
        Assert.Equal(HttpStatusCode.OK, caps.StatusCode);
    }

    [Fact]
    public async Task BootstrapStatus_TrueOnEmptyStore_ThenBootstrapLoginMeAllWork_AndSecondBootstrapConflicts()
    {
        await using var factory = await CreateFactoryAsync(demoEnabled: false);
        using var client = factory.CreateClient(new WebApplicationFactoryClientOptions { HandleCookies = true });

        using (var status = await client.GetAsync("/v1/auth/bootstrap-status"))
        {
            Assert.Equal(HttpStatusCode.OK, status.StatusCode);
            var body = await status.Content.ReadFromJsonAsync<BootstrapStatusDto>(JsonOptions);
            Assert.True(body!.NeedsBootstrap);
        }

        using (var bootstrap = await client.PostAsJsonAsync(
                   "/v1/auth/bootstrap",
                   new { username = "admin", password = "Sup3rSecret!", displayName = "Admin" },
                   JsonOptions))
        {
            Assert.Equal(HttpStatusCode.OK, bootstrap.StatusCode);
            var body = await bootstrap.Content.ReadFromJsonAsync<AuthUserDto>(JsonOptions);
            Assert.Equal("admin", body!.Username);
            Assert.Equal(Roles.Admin, body.Role);
        }

        using (var statusAfter = await client.GetAsync("/v1/auth/bootstrap-status"))
        {
            var body = await statusAfter.Content.ReadFromJsonAsync<BootstrapStatusDto>(JsonOptions);
            Assert.False(body!.NeedsBootstrap);
        }

        // Bootstrap already SignInAsync'd — /v1/auth/me should already succeed off that same cookie.
        using (var me = await client.GetAsync("/v1/auth/me"))
        {
            Assert.Equal(HttpStatusCode.OK, me.StatusCode);
            var body = await me.Content.ReadFromJsonAsync<AuthUserDto>(JsonOptions);
            Assert.Equal("admin", body!.Username);
            Assert.Equal(Roles.Admin, body.Role);
        }

        using var secondBootstrap = await client.PostAsJsonAsync(
            "/v1/auth/bootstrap",
            new { username = "someoneelse", password = "whatever123", displayName = (string?)null },
            JsonOptions);
        Assert.Equal(HttpStatusCode.Conflict, secondBootstrap.StatusCode);
    }

    [Fact]
    public async Task Login_WithWrongPassword_Gets401_WithRightPassword_SignsIn_AndMeWorks()
    {
        await using var factory = await CreateFactoryAsync(demoEnabled: false);

        using (var bootstrapClient = factory.CreateClient())
        using (var bootstrap = await bootstrapClient.PostAsJsonAsync(
                   "/v1/auth/bootstrap",
                   new { username = "op1", password = "correct-horse-battery", displayName = (string?)null },
                   JsonOptions))
        {
            Assert.Equal(HttpStatusCode.OK, bootstrap.StatusCode);
        }

        using var client = factory.CreateClient(new WebApplicationFactoryClientOptions { HandleCookies = true });

        using (var badLogin = await client.PostAsJsonAsync(
                   "/v1/auth/login", new { username = "op1", password = "wrong" }, JsonOptions))
        {
            Assert.Equal(HttpStatusCode.Unauthorized, badLogin.StatusCode);
        }

        using (var goodLogin = await client.PostAsJsonAsync(
                   "/v1/auth/login", new { username = "op1", password = "correct-horse-battery" }, JsonOptions))
        {
            Assert.Equal(HttpStatusCode.OK, goodLogin.StatusCode);
        }

        using var me = await client.GetAsync("/v1/auth/me");
        Assert.Equal(HttpStatusCode.OK, me.StatusCode);
    }

    [Fact]
    public async Task DemoModeEnabled_AllowsFleetAccess_WithoutAnyExplicitLogin()
    {
        await using var factory = await CreateFactoryAsync(demoEnabled: true);
        using var client = factory.CreateClient(new WebApplicationFactoryClientOptions { HandleCookies = true });

        using var response = await client.GetAsync("/v1/fleet");
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
    }
}
