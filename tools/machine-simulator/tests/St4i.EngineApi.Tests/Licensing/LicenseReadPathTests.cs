using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Microsoft.AspNetCore.Identity;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;
using St4i.EdgeCore.Licensing;
// 🔴 This test file lives in St4i.EngineApi.Tests.Licensing, whose last segment shadows the production
// St4i.EngineApi.Licensing namespace for unqualified lookups. Aliased rather than fully qualified at
// every use site so the shadowing is stated once, here, instead of being worked around silently.
using LicenseGate = St4i.EngineApi.Licensing.LicenseGate;
using St4i.EngineApi.Auth;
using St4i.EngineApi.Tests.Auth;
using St4i.EngineApi.HmiModel;
using St4i.Hmi.Contracts;
using Xunit;

namespace St4i.EngineApi.Tests.Licensing;

/// <summary>
/// 🔴🔴 WS-E — <b>THE BOUNDARY, PROVEN OVER REAL HTTP AGAINST THE REAL ENGINE.</b>
///
/// <para><c>LicenseEvaluatorTests</c> proves the feature SET is right. This proves the ROUTES are: that a
/// machine with an expired licence still answers <c>200</c> on every request the operator kiosk makes to
/// render a screen, and <c>403 LICENSE_REQUIRED</c> on the authoring writes — through the actual
/// composition root, the actual endpoint filters and the actual RBAC pipeline, not a unit fixture.</para>
///
/// <para><b>How an expired licence is produced here.</b> The engine embeds an all-zero placeholder public
/// key, so no licence this test could write would verify — every state would collapse to
/// <see cref="LicenseState.Invalid"/> and the test would measure the wrong thing. Instead the
/// <see cref="LicenseGate"/> singleton is REPLACED in the test host with one built from a directly
/// constructed <see cref="LicenseEvaluation"/> carrying the state under test. That is honest about what is
/// being measured: this file measures the ROUTING consequence of a state, and
/// <c>LicenseVerifierTests</c>/<c>LicenseEvaluatorTests</c> measure how a state is REACHED. Splitting them
/// keeps each from hiding a failure in the other.</para>
/// </summary>
// 🔴 NO `.ConfigureAwait(false)` IN THE [Fact] BODIES BELOW, and the six that remain in the private
// helpers at the bottom are deliberate. xUnit1030: "Test methods should not call ConfigureAwait(false), as
// it may bypass parallelization limits." The first draft of this file carried it on all 44 awaits and
// added 38 warnings to a build pinned at 219 by scripts/verify-suites.sh — paid by removing them rather
// than by moving the pin, and removed at exactly the 38 sites the analyser named. This is the same fix,
// for the same reason, that the EXPECT_WARNINGS ledger records being applied five times before: the
// repository's prevailing idiom IS ConfigureAwait-in-helpers, and the analyser objects only where that
// idiom leaks into a test method's own body.
[Collection(SecurityEnvVarTests.CollectionName)]
public sealed class LicenseReadPathTests
{
    private static readonly SemaphoreSlim EnvLock = new(1, 1);
    private static readonly JsonSerializerOptions JsonOptions = new(JsonSerializerDefaults.Web);

    // ══════════════════════════════════════════════════════════════════════════════════════════════
    // 🔴🔴 THE HEADLINE
    // ══════════════════════════════════════════════════════════════════════════════════════════════

    /// <summary>
    /// 🔴🔴 <b>THE TEST PROVING AN EXPIRED LICENCE STILL RENDERS THE OPERATOR SCREEN.</b>
    ///
    /// <para>Publishes a screen while licensed, then re-boots the engine with an EXPIRED licence and
    /// checks the exact three requests <c>web/src/routes/Hmi.tsx</c> makes to paint an operator panel:
    /// <c>GET /v1/screens/{id}</c> (line 144), <c>GET /v1/components/{code}</c> (line 169, feeding
    /// <c>ScreenRenderer</c>'s <c>components</c> prop at line 490) and <c>GET /v1/tags</c>. All three must
    /// answer <c>200</c> with the document intact. If any of them answered <c>403</c>, an expired licence
    /// would blank an operator's screen on a running machine.</para>
    ///
    /// <para>🔴 And the same request set is checked against a PUT, which must be refused — the pairing is
    /// what makes this a measurement rather than a demonstration that nothing is gated.</para>
    /// </summary>
    [Fact]
    public async Task Expired_license_still_renders_the_operator_screen()
    {
        var screensDir = Directory.CreateTempSubdirectory("st4i-lic-read-screens-").FullName;
        var securityDir = Directory.CreateTempSubdirectory("st4i-lic-read-security-").FullName;
        const string screenId = "aoi-01-main";

        // ── Phase 1: a fully licensed machine authors and publishes a screen. ──
        await using (var licensed = await BootAsync(screensDir, securityDir, Entitled()))
        {
            var engineer = await EngineerAsync(licensed, "read-a");
            using var put = await engineer.PutAsJsonAsync(
                $"/v1/screens/{screenId}", Screen(screenId), HmiContractJson.Options);
            Assert.Equal(HttpStatusCode.OK, put.StatusCode);
        }

        // ── Phase 2: the SAME data directory, re-booted with an EXPIRED licence. ──
        await using var expired = await BootAsync(screensDir, securityDir, Expired());
        var op = await OperatorAsync(expired, "read-b");

        // 🔴 The screen document the kiosk renders from.
        using (var response = await op.GetAsync($"/v1/screens/{screenId}"))
        {
            Assert.True(response.StatusCode == HttpStatusCode.OK,
                $"GET /v1/screens/{screenId} answered {(int)response.StatusCode} on a machine with an EXPIRED " +
                "licence. This is the operator kiosk's render path: gating it blanks an operator's screen on " +
                "a running machine, which is the boundary this workstream may not cross.");

            var document = await response.Content
                .ReadFromJsonAsync<HmiScreenDocument>(HmiContractJson.Options);
            Assert.NotNull(document);
            Assert.Equal(screenId, document!.ScreenId); // the screen is INTACT, not an empty 200
            Assert.NotEmpty(document.Widgets);
        }

        // 🔴 The component model every {component} binding on that screen resolves through.
        using (var response = await op.GetAsync("/v1/components/AOI-01"))
        {
            Assert.True(response.StatusCode == HttpStatusCode.OK,
                $"GET /v1/components/AOI-01 answered {(int)response.StatusCode} on an EXPIRED licence. " +
                "web/src/routes/Hmi.tsx:169 feeds this to ScreenRenderer's `components` prop at :490.");
        }

        // 🔴 The tag namespace the widgets read values through.
        using (var response = await op.GetAsync("/v1/tags?machine=AOI-01"))
        {
            Assert.True(response.StatusCode == HttpStatusCode.OK,
                $"GET /v1/tags answered {(int)response.StatusCode} on an EXPIRED licence.");
        }

        // 🔴 THE PAIRING. Without this, every assertion above would pass on an engine that gated nothing,
        // and the test would prove only that no gate exists rather than that the RIGHT gate exists.
        var engineerOnExpired = await EngineerAsync(expired, "read-c");
        using (var put = await engineerOnExpired.PutAsJsonAsync(
                   $"/v1/screens/{screenId}", Screen(screenId, "Edited"), HmiContractJson.Options))
        {
            Assert.Equal(HttpStatusCode.Forbidden, put.StatusCode);

            using var body = JsonDocument.Parse(await put.Content.ReadAsStringAsync());
            Assert.Equal("LICENSE_REQUIRED", body.RootElement.GetProperty("reason").GetString());
            Assert.Equal(LicenseFeatures.HmiAuthoring, body.RootElement.GetProperty("feature").GetString());
        }
    }

    /// <summary>
    /// 🔴 <b>NEGATIVE CONTROL FOR THE ROUTE GATE.</b> The same PUT on an ENTITLED machine must succeed. A
    /// filter that refused everything would pass the 403 assertion above; only this pair shows the filter
    /// discriminates on entitlement rather than simply blocking the route.
    /// </summary>
    [Fact]
    public async Task An_entitled_machine_can_still_author()
    {
        var screensDir = Directory.CreateTempSubdirectory("st4i-lic-write-screens-").FullName;
        var securityDir = Directory.CreateTempSubdirectory("st4i-lic-write-security-").FullName;

        await using var factory = await BootAsync(screensDir, securityDir, Entitled());
        var engineer = await EngineerAsync(factory, "write-a");

        using var put = await engineer.PutAsJsonAsync(
            "/v1/screens/entitled-screen", Screen("entitled-screen"), HmiContractJson.Options);

        Assert.Equal(HttpStatusCode.OK, put.StatusCode);
    }

    /// <summary>
    /// 🔴 <b>THE ROADMAP'S OWN ACCEPTANCE CRITERION</b> (roadmap:377, "mở khoá Line bằng license mới"):
    /// a Machine licence does not unlock Line commands, a Line licence does, and <c>GET /v1/line</c> —
    /// operator visibility — is never gated in either case.
    /// </summary>
    [Fact]
    public async Task A_line_licence_unlocks_line_commands_and_a_machine_licence_does_not()
    {
        var screensDir = Directory.CreateTempSubdirectory("st4i-lic-line-screens-").FullName;
        var securityDir = Directory.CreateTempSubdirectory("st4i-lic-line-security-").FullName;

        await using (var machineOnly = await BootAsync(
            screensDir, securityDir, Entitled(LicenseFeatures.Machine)))
        {
            var op = await OperatorAsync(machineOnly, "line-a");

            // 🔴 Reading line state is NEVER gated — a licence may not blank an operator's view of the line.
            using (var read = await op.GetAsync("/v1/line"))
            {
                Assert.NotEqual(HttpStatusCode.Forbidden, read.StatusCode);
            }

            using var command = await op.PostAsync("/v1/line/start", content: null);
            Assert.Equal(HttpStatusCode.Forbidden, command.StatusCode);

            using var body = JsonDocument.Parse(await command.Content.ReadAsStringAsync());
            Assert.Equal("LICENSE_REQUIRED", body.RootElement.GetProperty("reason").GetString());
            Assert.Equal(LicenseFeatures.LineControl, body.RootElement.GetProperty("feature").GetString());
        }

        var lineSecurity = Directory.CreateTempSubdirectory("st4i-lic-line2-security-").FullName;
        await using var lineLicensed = await BootAsync(
            screensDir, lineSecurity, Entitled(LicenseFeatures.Line));
        var lineOp = await OperatorAsync(lineLicensed, "line-b");

        using var permitted = await lineOp.PostAsync("/v1/line/start", content: null);

        // 🔴 The licence gate is out of the way. Whatever the line handler then decides (200, or a domain
        // refusal) is not this test's business — what matters is that it is NOT a LICENSE_REQUIRED 403.
        if (permitted.StatusCode == HttpStatusCode.Forbidden)
        {
            var text = await permitted.Content.ReadAsStringAsync();
            Assert.DoesNotContain("LICENSE_REQUIRED", text, StringComparison.Ordinal);
        }
    }

    // ══════════════════════════════════════════════════════════════════════════════════════════════
    // CAPABILITIES — the flag pair HmiModelWiringTests:116 predicted WS-E would revisit
    // ══════════════════════════════════════════════════════════════════════════════════════════════

    /// <summary>
    /// 🔴 <c>GET /v1/capabilities</c> is TOTAL: it answers <c>200</c> anonymously in an unentitled state,
    /// which three existing suites depend on and without which the web shell cannot boot.
    ///
    /// <para>And the flag pair does what the split decided: <c>hmiModelEnabled</c>/<c>hmiApiEnabled</c>
    /// stay <see langword="true"/> because they name CORE features the kiosk renders through, while the
    /// new <c>hmiAuthoringEnabled</c> is <see langword="false"/> — which is the flag a client should
    /// branch on to decide whether to offer the editor.</para>
    /// </summary>
    [Fact]
    public async Task Capabilities_answers_200_when_expired_and_reports_authoring_off_but_reads_on()
    {
        var screensDir = Directory.CreateTempSubdirectory("st4i-lic-caps-screens-").FullName;
        var securityDir = Directory.CreateTempSubdirectory("st4i-lic-caps-security-").FullName;

        await using var factory = await BootAsync(screensDir, securityDir, Expired());
        using var anonymous = factory.CreateClient();

        using var response = await anonymous.GetAsync("/v1/capabilities");
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);

        using var doc = JsonDocument.Parse(await response.Content.ReadAsStringAsync());
        var root = doc.RootElement;

        Assert.True(root.GetProperty("hmiModelEnabled").GetBoolean());
        Assert.True(root.GetProperty("hmiApiEnabled").GetBoolean());
        Assert.False(root.GetProperty("hmiAuthoringEnabled").GetBoolean());
        Assert.Equal("Expired", root.GetProperty("licenseState").GetString());

        // The five original members are all still present and correctly typed — "without moving where the
        // flag is reported", pinned rather than trusted.
        Assert.True(root.TryGetProperty("demoEnabled", out _));
        Assert.True(root.TryGetProperty("mode", out _));
        Assert.False(string.IsNullOrWhiteSpace(root.GetProperty("version").GetString()));
    }

    /// <summary>
    /// 🔴 <b>NEGATIVE CONTROL FOR THE FLAG.</b> The test above asserts <c>hmiAuthoringEnabled</c> is
    /// <see langword="false"/>; a flag hardwired to <see langword="false"/> would pass it. This shows it
    /// is <see langword="true"/> on an entitled machine, so the flag reports the gate rather than a
    /// constant.
    /// </summary>
    [Fact]
    public async Task Capabilities_reports_authoring_on_for_an_entitled_machine()
    {
        var screensDir = Directory.CreateTempSubdirectory("st4i-lic-caps2-screens-").FullName;
        var securityDir = Directory.CreateTempSubdirectory("st4i-lic-caps2-security-").FullName;

        await using var factory = await BootAsync(screensDir, securityDir, Entitled());
        using var anonymous = factory.CreateClient();

        using var response = await anonymous.GetAsync("/v1/capabilities");
        using var doc = JsonDocument.Parse(await response.Content.ReadAsStringAsync());

        Assert.True(doc.RootElement.GetProperty("hmiAuthoringEnabled").GetBoolean());
        Assert.Equal("Valid", doc.RootElement.GetProperty("licenseState").GetString());
    }

    /// <summary>
    /// 🔴 <c>GET /v1/license/fingerprint</c> MUST work on an unlicensed machine — it is what a customer
    /// sends ST4I to have a licence issued, so gating it would make offline activation impossible. And it
    /// returns the four components SEPARATELY, so support can see which one moved.
    /// </summary>
    [Fact]
    public async Task The_fingerprint_endpoint_works_on_an_unlicensed_machine()
    {
        var screensDir = Directory.CreateTempSubdirectory("st4i-lic-fp-screens-").FullName;
        var securityDir = Directory.CreateTempSubdirectory("st4i-lic-fp-security-").FullName;

        await using var factory = await BootAsync(screensDir, securityDir, Unlicensed());
        var engineer = await EngineerAsync(factory, "fp-a");

        using var response = await engineer.GetAsync("/v1/license/fingerprint");
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);

        using var doc = JsonDocument.Parse(await response.Content.ReadAsStringAsync());
        foreach (var component in new[] { "deviceIdentity", "machineGuid", "volumeSerial", "primaryMac" })
        {
            Assert.True(doc.RootElement.TryGetProperty(component, out _),
                $"The fingerprint response is missing '{component}'. Support cannot tell which component " +
                "moved from a single combined hash, which is why the four are reported separately.");
        }
    }

    /// <summary>
    /// 🔴 <c>GET /v1/license</c> works when the licence is BROKEN — which is exactly when a support
    /// engineer needs it — and states in words that machine operation is unaffected.
    /// </summary>
    [Fact]
    public async Task The_diagnostic_endpoint_works_when_the_licence_is_broken()
    {
        var screensDir = Directory.CreateTempSubdirectory("st4i-lic-diag-screens-").FullName;
        var securityDir = Directory.CreateTempSubdirectory("st4i-lic-diag-security-").FullName;

        await using var factory = await BootAsync(screensDir, securityDir, Unlicensed());
        var engineer = await EngineerAsync(factory, "diag-a");

        using var response = await engineer.GetAsync("/v1/license");
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);

        using var doc = JsonDocument.Parse(await response.Content.ReadAsStringAsync());
        Assert.Equal("Missing", doc.RootElement.GetProperty("state").GetString());
        Assert.Equal("Core", doc.RootElement.GetProperty("edition").GetString());
        Assert.Contains("never affects HALT",
            doc.RootElement.GetProperty("operationImpact").GetString(), StringComparison.Ordinal);
    }

    // ══════════════════════════════════════════════════════════════════════════════════════════════
    // Fixtures
    // ══════════════════════════════════════════════════════════════════════════════════════════════

    private static LicenseGate Entitled(IReadOnlySet<string>? features = null) =>
        new(new LicenseEvaluation(
            LicenseState.Valid,
            new LicensePayload(1, "ST4I-TEST-1", "Test Co", "Machine", null, null, null,
                DateTimeOffset.UtcNow, DateTimeOffset.UtcNow, DateTimeOffset.UtcNow.AddYears(1), 30, 1, null),
            features ?? LicenseFeatures.Machine, null, null, 4, false, DateTimeOffset.UtcNow));

    private static LicenseGate Expired() =>
        new(new LicenseEvaluation(
            LicenseState.Expired, null, LicenseFeatures.Core,
            "This licence expired. Authoring, line control and notification dispatch are locked. " +
            "Machine operation is unaffected.",
            null, 4, false, DateTimeOffset.UtcNow));

    private static LicenseGate Unlicensed() =>
        new(new LicenseEvaluation(
            LicenseState.Missing, null, LicenseFeatures.Core,
            "No licence is installed on this machine.", null, 0, false, DateTimeOffset.UtcNow));

    /// <summary>Boots the real engine with the supplied <see cref="LicenseGate"/> replacing the one the
    /// composition root builds.</summary>
    private static async Task<WebApplicationFactory<Program>> BootAsync(
        string screensDir, string securityDir, LicenseGate gate)
    {
        await EnvLock.WaitAsync().ConfigureAwait(false);
        var prevScreensDir = Environment.GetEnvironmentVariable(HmiScreenStore.EnvVarDir);
        var prevSecurityDir = Environment.GetEnvironmentVariable("ST4I_SECURITY_DIR");
        var prevEnvironment = Environment.GetEnvironmentVariable("ASPNETCORE_ENVIRONMENT");
        try
        {
            Environment.SetEnvironmentVariable(HmiScreenStore.EnvVarDir, screensDir);
            Environment.SetEnvironmentVariable("ST4I_SECURITY_DIR", securityDir);
            // Production, not Development — see HmiModelWiringTests' own comment on the Static Web Assets
            // manifest that a bare WebApplicationFactory<Program> would otherwise try to load.
            Environment.SetEnvironmentVariable("ASPNETCORE_ENVIRONMENT", "Production");

            var factory = new WebApplicationFactory<Program>()
                .WithWebHostBuilder(builder => builder.ConfigureServices(services =>
                {
                    services.RemoveAll<LicenseGate>();
                    services.AddSingleton(gate);
                }));

            _ = factory.Server;
            return factory;
        }
        finally
        {
            Environment.SetEnvironmentVariable(HmiScreenStore.EnvVarDir, prevScreensDir);
            Environment.SetEnvironmentVariable("ST4I_SECURITY_DIR", prevSecurityDir);
            Environment.SetEnvironmentVariable("ASPNETCORE_ENVIRONMENT", prevEnvironment);
            EnvLock.Release();
        }
    }

    private static async Task<HttpClient> EngineerAsync(WebApplicationFactory<Program> factory, string suffix) =>
        await UserAsync(factory, factory.Services, $"lic-eng-{suffix}", "EngineerPass123!", Roles.Engineer)
            .ConfigureAwait(false);

    private static async Task<HttpClient> OperatorAsync(WebApplicationFactory<Program> factory, string suffix) =>
        await UserAsync(factory, factory.Services, $"lic-op-{suffix}", "OperatorPass123!", Roles.Operator)
            .ConfigureAwait(false);

    private static async Task<HttpClient> UserAsync(
        WebApplicationFactory<Program> factory, IServiceProvider services,
        string username, string password, string role)
    {
        // Bootstrap only once per security directory; a second call answers non-200 and that is fine.
        using (var bootstrapClient = factory.CreateClient())
        {
            using var _ = await bootstrapClient.PostAsJsonAsync(
                "/v1/auth/bootstrap",
                new { username = $"{username}-admin", password = "AdminPass123!", displayName = (string?)null },
                JsonOptions).ConfigureAwait(false);
        }

        var userStore = services.GetRequiredService<IUserStore>();
        var hash = new PasswordHasher<AppUser>().HashPassword(AppUser.Instance, password);
        await userStore.CreateAsync(username, hash, role, null, "test", CancellationToken.None).ConfigureAwait(false);

        var client = factory.CreateClient(new WebApplicationFactoryClientOptions { HandleCookies = true });
        using var login = await client.PostAsJsonAsync(
            "/v1/auth/login", new { username, password }, JsonOptions).ConfigureAwait(false);
        Assert.Equal(HttpStatusCode.OK, login.StatusCode);
        return client;
    }

    private static HmiScreenDocument Screen(string screenId, string title = "Operator Panel") => new(
        1, screenId, title, null, "isa101",
        new ScreenLayout(12, 8, "panel"),
        new[] { new ScreenWidget("w1", "label", new WidgetRect(0, 0, 2, 1)) });
}
