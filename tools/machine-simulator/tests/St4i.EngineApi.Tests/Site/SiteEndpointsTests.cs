using System.Net;
using System.Net.Http.Json;
using System.Security.Cryptography;
using System.Security.Cryptography.X509Certificates;
using System.Text.Json;
using Microsoft.AspNetCore.Identity;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.Extensions.DependencyInjection;
using St4i.EngineApi.Auth;
using St4i.EngineApi.Endpoints;
using St4i.EngineApi.Tests.Auth;
using Xunit;

namespace St4i.EngineApi.Tests.Site;

/// <summary>
/// GĐ3 EC-3 — real-pipeline (<c>WebApplicationFactory&lt;Program&gt;</c>) checks for <c>GET /v1/site</c>,
/// <c>PUT /v1/site</c>, and <c>GET /v1/site/identity</c>: the default (never-configured) view reports
/// <c>Enabled=false</c>/<c>Disabled</c> plus a real device fingerprint; an Engineer's <c>PUT</c> actually
/// changes what a follow-up <c>GET</c> reports (proving it drives <c>SiteBridgeManager.ApplyAsync</c>, not
/// just an in-memory echo) and writes a <c>site.link.set</c> audit row that never contains the raw PEM; an
/// Operator's <c>PUT</c> 403s; a blank host or an unparseable <c>siteTrustPem</c> 400s when enabling; and
/// with the local UNS spine disabled (<c>SiteBridgeManager</c> not registered in DI at all) <c>GET</c> still
/// returns the device identity while <c>PUT</c> 409s. Same env-var-swap-then-eager-build factory recipe as
/// <see cref="RbacPolicyTests"/>/<c>AssetEndpointsTests</c> — see <see cref="SecurityEnvVarTests"/>'s doc
/// comment for why this class carries the SAME <c>[Collection(...)]</c> tag.
/// </summary>
[Collection(SecurityEnvVarTests.CollectionName)]
public sealed class SiteEndpointsTests
{
    private static readonly SemaphoreSlim EnvLock = new(1, 1);
    private static readonly JsonSerializerOptions JsonOptions = new(JsonSerializerDefaults.Web);

    /// <summary>Same env-var-swap-then-eager-build protocol as <c>AssetEndpointsTests.CreateFactoryAsync</c>,
    /// PLUS two isolation vars those classes don't need: <c>ST4I_SITELINK_DIR</c>/<c>ST4I_IDENTITY_DIR</c>
    /// (EC-2's <c>SiteLinkStore</c>/<c>DeviceIdentityStore</c> default to real <c>%ProgramData%</c>
    /// directories otherwise — this class actually MUTATES the Site link via <c>PUT</c>, so it must not
    /// touch that real, shared location), and <c>ST4I_UNS_ENABLED</c> (so the UNS-off variant can prove
    /// <see cref="St4i.EdgeCore.Site.SiteBridgeManager"/> is genuinely absent from DI, not just disabled).</summary>
    private static async Task<WebApplicationFactory<Program>> CreateFactoryAsync(bool unsEnabled = true)
    {
        var securityDir = Directory.CreateTempSubdirectory("st4i-site-ep-security-").FullName;
        var historianDir = Directory.CreateTempSubdirectory("st4i-site-ep-historian-").FullName;
        var walDir = Directory.CreateTempSubdirectory("st4i-site-ep-wal-").FullName;
        var settingsDir = Directory.CreateTempSubdirectory("st4i-site-ep-settings-").FullName;
        var siteLinkDir = Directory.CreateTempSubdirectory("st4i-site-ep-sitelink-").FullName;
        var identityDir = Directory.CreateTempSubdirectory("st4i-site-ep-identity-").FullName;

        await EnvLock.WaitAsync().ConfigureAwait(false);
        var prevSecurityDir = Environment.GetEnvironmentVariable("ST4I_SECURITY_DIR");
        var prevDemoEnabled = Environment.GetEnvironmentVariable("ST4I_DEMO_ENABLED");
        var prevHistorianDir = Environment.GetEnvironmentVariable("ST4I_HISTORIAN_DIR");
        var prevWalDir = Environment.GetEnvironmentVariable("ST4I_WAL_DIR");
        var prevSettingsDir = Environment.GetEnvironmentVariable("ST4I_SETTINGS_DIR");
        var prevSiteLinkDir = Environment.GetEnvironmentVariable("ST4I_SITELINK_DIR");
        var prevIdentityDir = Environment.GetEnvironmentVariable("ST4I_IDENTITY_DIR");
        var prevUnsEnabled = Environment.GetEnvironmentVariable("ST4I_UNS_ENABLED");
        var prevEnvironment = Environment.GetEnvironmentVariable("ASPNETCORE_ENVIRONMENT");
        try
        {
            Environment.SetEnvironmentVariable("ST4I_SECURITY_DIR", securityDir);
            Environment.SetEnvironmentVariable("ST4I_DEMO_ENABLED", null);
            Environment.SetEnvironmentVariable("ST4I_HISTORIAN_DIR", historianDir);
            Environment.SetEnvironmentVariable("ST4I_WAL_DIR", walDir);
            Environment.SetEnvironmentVariable("ST4I_SETTINGS_DIR", settingsDir);
            Environment.SetEnvironmentVariable("ST4I_SITELINK_DIR", siteLinkDir);
            Environment.SetEnvironmentVariable("ST4I_IDENTITY_DIR", identityDir);
            Environment.SetEnvironmentVariable("ST4I_UNS_ENABLED", unsEnabled ? null : "false");
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
            Environment.SetEnvironmentVariable("ST4I_SITELINK_DIR", prevSiteLinkDir);
            Environment.SetEnvironmentVariable("ST4I_IDENTITY_DIR", prevIdentityDir);
            Environment.SetEnvironmentVariable("ST4I_UNS_ENABLED", prevUnsEnabled);
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

    /// <summary>A fresh, valid, self-signed leaf certificate PEM (public cert only — no private key
    /// exported) — enough to satisfy <c>SiteEndpoints</c>'s fail-closed
    /// <c>X509Certificate2Collection.ImportFromPem</c> parse check for a <c>PUT /v1/site</c> body.</summary>
    private static string NewValidTrustPem()
    {
        using var ecdsa = ECDsa.Create(ECCurve.NamedCurves.nistP256);
        var request = new CertificateRequest("CN=st4i-site-endpoints-tests", ecdsa, HashAlgorithmName.SHA256);
        using var cert = request.CreateSelfSigned(DateTimeOffset.UtcNow.AddDays(-1), DateTimeOffset.UtcNow.AddYears(1));
        return cert.ExportCertificatePem();
    }

    // ─────────────────────────────────────────────────────────────────────
    // GET /v1/site — default (never-configured) view.
    // ─────────────────────────────────────────────────────────────────────

    [Fact]
    public async Task Operator_GetsSite_DefaultView_DisabledWithRealDeviceFingerprint()
    {
        await using var factory = await CreateFactoryAsync();
        await BootstrapAdminAsync(factory, "site-admin-1", "AdminPass123!");
        await CreateUserAsync(factory, "site-operator-1", "OperatorPass123!", Roles.Operator);

        using var operatorClient = await LoginAsAsync(factory, "site-operator-1", "OperatorPass123!");

        using var get = await operatorClient.GetAsync("/v1/site");
        Assert.Equal(HttpStatusCode.OK, get.StatusCode);

        var status = await get.Content.ReadFromJsonAsync<SiteStatusDto>(JsonOptions);
        Assert.NotNull(status);
        Assert.False(status!.Enabled);
        Assert.Equal("Disabled", status.BridgeState);
        Assert.True(status.UnsEnabled);
        Assert.False(string.IsNullOrWhiteSpace(status.DeviceFingerprint));
    }

    // ─────────────────────────────────────────────────────────────────────
    // GET /v1/site/identity — the cached device identity, cert PEM + fingerprint matching /v1/site's.
    // ─────────────────────────────────────────────────────────────────────

    [Fact]
    public async Task Operator_GetsIdentity_ReturnsPemAndFingerprint_MatchingSiteStatus()
    {
        await using var factory = await CreateFactoryAsync();
        await BootstrapAdminAsync(factory, "site-admin-2", "AdminPass123!");
        await CreateUserAsync(factory, "site-operator-2", "OperatorPass123!", Roles.Operator);

        using var operatorClient = await LoginAsAsync(factory, "site-operator-2", "OperatorPass123!");

        using var identityResp = await operatorClient.GetAsync("/v1/site/identity");
        Assert.Equal(HttpStatusCode.OK, identityResp.StatusCode);
        var identity = await identityResp.Content.ReadFromJsonAsync<SiteIdentityDto>(JsonOptions);
        Assert.NotNull(identity);
        Assert.Contains("-----BEGIN CERTIFICATE-----", identity!.DeviceCertPem);
        Assert.False(string.IsNullOrWhiteSpace(identity.DeviceFingerprint));

        using var siteResp = await operatorClient.GetAsync("/v1/site");
        var status = await siteResp.Content.ReadFromJsonAsync<SiteStatusDto>(JsonOptions);
        Assert.Equal(status!.DeviceFingerprint, identity.DeviceFingerprint);
    }

    // ─────────────────────────────────────────────────────────────────────
    // PUT /v1/site — Engineer 200, config actually applied (GET reflects it), audited without the raw PEM.
    // ─────────────────────────────────────────────────────────────────────

    [Fact]
    public async Task Engineer_EnablesSiteLink_AppliesConfig_AndWritesAuditRow_WithoutTheRawPem()
    {
        await using var factory = await CreateFactoryAsync();
        await BootstrapAdminAsync(factory, "site-admin-3", "AdminPass123!");
        await CreateUserAsync(factory, "site-engineer-3", "EngineerPass123!", Roles.Engineer);

        using var engineerClient = await LoginAsAsync(factory, "site-engineer-3", "EngineerPass123!");
        var pem = NewValidTrustPem();

        using (var put = await engineerClient.PutAsJsonAsync(
                   "/v1/site", new { enabled = true, host = "127.0.0.1", port = 18884, siteTrustPem = pem }, JsonOptions))
        {
            Assert.Equal(HttpStatusCode.OK, put.StatusCode);
            var putStatus = await put.Content.ReadFromJsonAsync<SiteStatusDto>(JsonOptions);
            Assert.True(putStatus!.Enabled);
            Assert.Equal("127.0.0.1", putStatus.Host);
            Assert.Equal(18884, putStatus.Port);
        }

        // Confirms the PUT above genuinely drove SiteBridgeManager.ApplyAsync (not just an in-memory
        // echo of the request) — a follow-up GET, synchronous, sees the applied config.
        using (var get = await engineerClient.GetAsync("/v1/site"))
        {
            var status = await get.Content.ReadFromJsonAsync<SiteStatusDto>(JsonOptions);
            Assert.True(status!.Enabled);
            Assert.Equal("127.0.0.1", status.Host);
            Assert.Equal(18884, status.Port);
            Assert.NotEqual("Disabled", status.BridgeState); // ApplyAsync started a bridge (Connecting/Degraded/...).
        }

        using var adminClient = await LoginAsAsync(factory, "site-admin-3", "AdminPass123!");
        using var audit = await adminClient.GetAsync("/v1/audit?action=site.link.set&target=127.0.0.1");
        Assert.Equal(HttpStatusCode.OK, audit.StatusCode);
        var page = await audit.Content.ReadFromJsonAsync<AuditPageDto>(JsonOptions);
        Assert.NotNull(page);
        Assert.True(page!.Total >= 1);
        var row = page.Items[0];
        Assert.Equal("site.link.set", row.Action);
        Assert.Equal("127.0.0.1", row.TargetId);
        // The raw PEM must never appear in the audit trail — only a length/fingerprint of it.
        Assert.DoesNotContain("BEGIN CERTIFICATE", row.OldValueJson ?? "");
        Assert.DoesNotContain("BEGIN CERTIFICATE", row.NewValueJson ?? "");
        Assert.DoesNotContain(pem, row.NewValueJson ?? "");
        Assert.Contains("pemLen", row.NewValueJson ?? "", StringComparison.OrdinalIgnoreCase);
    }

    [Fact]
    public async Task Operator_PutSite_Gets403()
    {
        await using var factory = await CreateFactoryAsync();
        await BootstrapAdminAsync(factory, "site-admin-4", "AdminPass123!");
        await CreateUserAsync(factory, "site-operator-4", "OperatorPass123!", Roles.Operator);

        using var operatorClient = await LoginAsAsync(factory, "site-operator-4", "OperatorPass123!");

        using var put = await operatorClient.PutAsJsonAsync(
            "/v1/site", new { enabled = true, host = "127.0.0.1", port = 18884, siteTrustPem = NewValidTrustPem() }, JsonOptions);
        Assert.Equal(HttpStatusCode.Forbidden, put.StatusCode);
    }

    // ─────────────────────────────────────────────────────────────────────
    // PUT /v1/site — validation: blank host / bad PEM 400 when enabling; disable needs neither.
    // ─────────────────────────────────────────────────────────────────────

    [Fact]
    public async Task Engineer_EnableWithBlankHost_Gets400()
    {
        await using var factory = await CreateFactoryAsync();
        await BootstrapAdminAsync(factory, "site-admin-5", "AdminPass123!");
        await CreateUserAsync(factory, "site-engineer-5", "EngineerPass123!", Roles.Engineer);

        using var engineerClient = await LoginAsAsync(factory, "site-engineer-5", "EngineerPass123!");

        using var put = await engineerClient.PutAsJsonAsync(
            "/v1/site", new { enabled = true, host = "", port = 18884, siteTrustPem = NewValidTrustPem() }, JsonOptions);
        Assert.Equal(HttpStatusCode.BadRequest, put.StatusCode);
    }

    [Fact]
    public async Task Engineer_EnableWithBadPem_Gets400()
    {
        await using var factory = await CreateFactoryAsync();
        await BootstrapAdminAsync(factory, "site-admin-6", "AdminPass123!");
        await CreateUserAsync(factory, "site-engineer-6", "EngineerPass123!", Roles.Engineer);

        using var engineerClient = await LoginAsAsync(factory, "site-engineer-6", "EngineerPass123!");

        using var put = await engineerClient.PutAsJsonAsync(
            "/v1/site", new { enabled = true, host = "127.0.0.1", port = 18884, siteTrustPem = "not a pem" }, JsonOptions);
        Assert.Equal(HttpStatusCode.BadRequest, put.StatusCode);
    }

    [Fact]
    public async Task Engineer_EnableWithPortOutOfRange_Gets400()
    {
        await using var factory = await CreateFactoryAsync();
        await BootstrapAdminAsync(factory, "site-admin-7", "AdminPass123!");
        await CreateUserAsync(factory, "site-engineer-7", "EngineerPass123!", Roles.Engineer);

        using var engineerClient = await LoginAsAsync(factory, "site-engineer-7", "EngineerPass123!");

        using var put = await engineerClient.PutAsJsonAsync(
            "/v1/site", new { enabled = true, host = "127.0.0.1", port = 70000, siteTrustPem = NewValidTrustPem() }, JsonOptions);
        Assert.Equal(HttpStatusCode.BadRequest, put.StatusCode);
    }

    [Fact]
    public async Task Engineer_DisableWithBlankFields_Gets200()
    {
        await using var factory = await CreateFactoryAsync();
        await BootstrapAdminAsync(factory, "site-admin-8", "AdminPass123!");
        await CreateUserAsync(factory, "site-engineer-8", "EngineerPass123!", Roles.Engineer);

        using var engineerClient = await LoginAsAsync(factory, "site-engineer-8", "EngineerPass123!");

        using var put = await engineerClient.PutAsJsonAsync("/v1/site", new { enabled = false }, JsonOptions);
        Assert.Equal(HttpStatusCode.OK, put.StatusCode);

        var status = await put.Content.ReadFromJsonAsync<SiteStatusDto>(JsonOptions);
        Assert.False(status!.Enabled);
        Assert.Equal("Disabled", status.BridgeState);
    }

    // ─────────────────────────────────────────────────────────────────────
    // GET /v1/site/discover — GĐ3 sub-2 SD-1 (mDNS LAN browse). Engineer 200 with an array (empty is fine
    // — no real Site advertising in the test env); Operator 403 (an ACTIVE network scan is Engineer, one
    // step up from the read-only Operator-level GET /v1/site above — see SiteEndpoints' own doc comment).
    // ─────────────────────────────────────────────────────────────────────

    [Fact]
    public async Task Engineer_GetsDiscover_Returns200WithAnArray()
    {
        await using var factory = await CreateFactoryAsync();
        await BootstrapAdminAsync(factory, "site-admin-11", "AdminPass123!");
        await CreateUserAsync(factory, "site-engineer-11", "EngineerPass123!", Roles.Engineer);

        using var engineerClient = await LoginAsAsync(factory, "site-engineer-11", "EngineerPass123!");

        using var discover = await engineerClient.GetAsync("/v1/site/discover");
        Assert.Equal(HttpStatusCode.OK, discover.StatusCode);

        var sites = await discover.Content.ReadFromJsonAsync<JsonElement>(JsonOptions);
        Assert.Equal(JsonValueKind.Array, sites.ValueKind);
    }

    [Fact]
    public async Task Operator_GetsDiscover_Gets403()
    {
        await using var factory = await CreateFactoryAsync();
        await BootstrapAdminAsync(factory, "site-admin-12", "AdminPass123!");
        await CreateUserAsync(factory, "site-operator-12", "OperatorPass123!", Roles.Operator);

        using var operatorClient = await LoginAsAsync(factory, "site-operator-12", "OperatorPass123!");

        using var discover = await operatorClient.GetAsync("/v1/site/discover");
        Assert.Equal(HttpStatusCode.Forbidden, discover.StatusCode);
    }

    // ─────────────────────────────────────────────────────────────────────
    // UNS disabled — SiteBridgeManager is not registered at all: GET still returns identity; PUT 409s.
    // ─────────────────────────────────────────────────────────────────────

    [Fact]
    public async Task UnsDisabled_GetSite_StillReturnsIdentity_ButUnsEnabledIsFalse()
    {
        await using var factory = await CreateFactoryAsync(unsEnabled: false);
        await BootstrapAdminAsync(factory, "site-admin-9", "AdminPass123!");
        await CreateUserAsync(factory, "site-operator-9", "OperatorPass123!", Roles.Operator);

        using var operatorClient = await LoginAsAsync(factory, "site-operator-9", "OperatorPass123!");

        using var get = await operatorClient.GetAsync("/v1/site");
        Assert.Equal(HttpStatusCode.OK, get.StatusCode);
        var status = await get.Content.ReadFromJsonAsync<SiteStatusDto>(JsonOptions);
        Assert.NotNull(status);
        Assert.False(status!.UnsEnabled);
        Assert.False(string.IsNullOrWhiteSpace(status.DeviceFingerprint));

        using var identity = await operatorClient.GetAsync("/v1/site/identity");
        Assert.Equal(HttpStatusCode.OK, identity.StatusCode);
        var identityDto = await identity.Content.ReadFromJsonAsync<SiteIdentityDto>(JsonOptions);
        Assert.Equal(status.DeviceFingerprint, identityDto!.DeviceFingerprint);
    }

    [Fact]
    public async Task UnsDisabled_PutSite_Gets409()
    {
        await using var factory = await CreateFactoryAsync(unsEnabled: false);
        await BootstrapAdminAsync(factory, "site-admin-10", "AdminPass123!");
        await CreateUserAsync(factory, "site-engineer-10", "EngineerPass123!", Roles.Engineer);

        using var engineerClient = await LoginAsAsync(factory, "site-engineer-10", "EngineerPass123!");

        using var put = await engineerClient.PutAsJsonAsync(
            "/v1/site", new { enabled = true, host = "127.0.0.1", port = 18884, siteTrustPem = NewValidTrustPem() }, JsonOptions);
        Assert.Equal(HttpStatusCode.Conflict, put.StatusCode);
    }
}
