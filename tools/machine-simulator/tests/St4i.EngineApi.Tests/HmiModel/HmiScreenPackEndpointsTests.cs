using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Microsoft.AspNetCore.Identity;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.Extensions.DependencyInjection;
using St4i.EngineApi.Auth;
using St4i.EngineApi.Endpoints;
using St4i.EngineApi.Fleet;
using St4i.EngineApi.HmiModel;
using St4i.Hmi.Contracts;
using Xunit;

namespace St4i.EngineApi.Tests.HmiModel;

/// <summary>
/// Session 4 (HMI-5) — <c>GET /v1/screens/export</c> and <c>POST /v1/screens/import</c> against the REAL
/// pipeline: real routing, real authorization, real store, real audit recorder.
///
/// <para><b>What this class measures that <see cref="HmiScreenPackTests"/> cannot:</b> that the routes are
/// reachable at the tiers the census declares, that the literal <c>export</c> segment really does win over
/// <c>{screenId}</c> in the live matcher rather than only in a comment, and that an import performed over
/// HTTP by a real Engineer session appends rather than overwrites — the boundary measured at the layer an
/// engineer actually touches, not only at the service seam.</para>
///
/// <para>Harness duplicated from <see cref="HmiScreenEndpointsTests"/> deliberately, the same way that
/// class duplicates its own from <c>HmiModelWiringTests</c>/<c>RbacPolicyTests</c>: each is private to its
/// own class, and sharing one would couple two suites' env-var lifetimes.</para>
/// </summary>
public sealed class HmiScreenPackEndpointsTests
{
    private static readonly SemaphoreSlim EnvLock = new(1, 1);
    private static readonly JsonSerializerOptions JsonOptions = new(JsonSerializerDefaults.Web);

    private static async Task<(WebApplicationFactory<Program> Factory, string ScreensDir)> CreateFactoryAsync()
    {
        var hmiScreensDir = Directory.CreateTempSubdirectory("st4i-hmi-pack-ep-").FullName;
        var securityDir = Directory.CreateTempSubdirectory("st4i-hmi-pack-ep-security-").FullName;

        await EnvLock.WaitAsync().ConfigureAwait(false);
        var prevScreensDir = Environment.GetEnvironmentVariable(HmiScreenStore.EnvVarDir);
        var prevSecurityDir = Environment.GetEnvironmentVariable("ST4I_SECURITY_DIR");
        var prevEnvironment = Environment.GetEnvironmentVariable("ASPNETCORE_ENVIRONMENT");
        try
        {
            Environment.SetEnvironmentVariable(HmiScreenStore.EnvVarDir, hmiScreensDir);
            Environment.SetEnvironmentVariable("ST4I_SECURITY_DIR", securityDir);
            // Production, not Development — see HmiScreenEndpointsTests' own comment for the Static Web
            // Assets manifest failure a bare Development host hits before a single request runs.
            Environment.SetEnvironmentVariable("ASPNETCORE_ENVIRONMENT", "Production");

            var factory = new WebApplicationFactory<Program>();
            _ = factory.Server;
            return (factory, hmiScreensDir);
        }
        finally
        {
            Environment.SetEnvironmentVariable(HmiScreenStore.EnvVarDir, prevScreensDir);
            Environment.SetEnvironmentVariable("ST4I_SECURITY_DIR", prevSecurityDir);
            Environment.SetEnvironmentVariable("ASPNETCORE_ENVIRONMENT", prevEnvironment);
            EnvLock.Release();
        }
    }

    private static async Task<(WebApplicationFactory<Program> Factory, HttpClient Engineer, HttpClient Operator)>
        NewFactoryWithUsersAsync(string suffix)
    {
        var (factory, _) = await CreateFactoryAsync().ConfigureAwait(false);

        using (var bootstrapClient = factory.CreateClient())
        {
            using var bootstrap = await bootstrapClient.PostAsJsonAsync(
                "/v1/auth/bootstrap",
                new { username = $"pk-admin-{suffix}", password = "AdminPass123!", displayName = (string?)null },
                JsonOptions).ConfigureAwait(false);
            Assert.Equal(HttpStatusCode.OK, bootstrap.StatusCode);
        }

        await CreateUserAsync(factory, $"pk-engineer-{suffix}", "EngineerPass123!", Roles.Engineer).ConfigureAwait(false);
        await CreateUserAsync(factory, $"pk-operator-{suffix}", "OperatorPass123!", Roles.Operator).ConfigureAwait(false);

        var engineer = await LoginAsAsync(factory, $"pk-engineer-{suffix}", "EngineerPass123!").ConfigureAwait(false);
        var operatorClient = await LoginAsAsync(factory, $"pk-operator-{suffix}", "OperatorPass123!").ConfigureAwait(false);

        return (factory, engineer, operatorClient);
    }

    private static async Task CreateUserAsync(
        WebApplicationFactory<Program> factory, string username, string password, string role)
    {
        var userStore = factory.Services.GetRequiredService<IUserStore>();
        var hasher = new PasswordHasher<AppUser>();
        var hash = hasher.HashPassword(AppUser.Instance, password);
        await userStore.CreateAsync(username, hash, role, null, "test", CancellationToken.None).ConfigureAwait(false);
    }

    private static async Task<HttpClient> LoginAsAsync(
        WebApplicationFactory<Program> factory, string username, string password)
    {
        var client = factory.CreateClient(new WebApplicationFactoryClientOptions { HandleCookies = true });
        using var login = await client.PostAsJsonAsync("/v1/auth/login", new { username, password }, JsonOptions)
            .ConfigureAwait(false);
        Assert.Equal(HttpStatusCode.OK, login.StatusCode);
        return client;
    }

    private static HmiScreenDocument Screen(string screenId, string title) => new(
        1, screenId, title, null, "isa101",
        new ScreenLayout(12, 8, "panel"),
        new[] { new ScreenWidget("w1", "label", new WidgetRect(0, 0, 2, 1)) });

    private static async Task PutOkAsync(HttpClient client, string screenId, HmiScreenDocument doc)
    {
        using var put = await client.PutAsJsonAsync($"/v1/screens/{screenId}", doc, HmiContractJson.Options)
            .ConfigureAwait(false);
        Assert.Equal(HttpStatusCode.OK, put.StatusCode);
    }

    // ═════════════════════════════════════════════════════════════════════
    // Tiers — the census's two rows, measured against the live pipeline rather than only declared.
    // ═════════════════════════════════════════════════════════════════════

    [Fact]
    public async Task Export_is_reachable_by_an_operator()
    {
        var (factory, engineer, op) = await NewFactoryWithUsersAsync("export-tier");
        await using var _f = factory;
        using var _e = engineer;
        using var _o = op;
        await PutOkAsync(engineer, "line-overview", Screen("line-overview", "hello"));

        using var export = await op.GetAsync("/v1/screens/export");

        Assert.Equal(HttpStatusCode.OK, export.StatusCode);
    }

    /// <summary>The import tier, falsified from the other side: an Operator must be REFUSED. Its negative
    /// control is <see cref="Import_by_an_engineer_appends_over_an_existing_screen"/> below, where the same
    /// request from an Engineer succeeds — so a route that refused everyone could not pass both.</summary>
    [Fact]
    public async Task Import_is_refused_for_an_operator()
    {
        var (factory, engineer, op) = await NewFactoryWithUsersAsync("import-tier");
        await using var _f = factory;
        using var _e = engineer;
        using var _o = op;

        using var import = await op.PostAsJsonAsync(
            "/v1/screens/import", Pack(Entry("new-screen", Screen("new-screen", "x"))), HmiContractJson.Options);

        Assert.Equal(HttpStatusCode.Forbidden, import.StatusCode);
    }

    /// <summary>The literal <c>export</c> segment beats <c>{screenId}</c> in the LIVE matcher. Falsified by
    /// the shape of the answer: if <c>GetAsync</c> had matched with <c>screenId == "export"</c>, this would
    /// be a 404 ApiErrorDto ("no screen is declared with id 'export'"), not a pack.</summary>
    [Fact]
    public async Task The_export_route_wins_over_the_by_id_route_in_the_live_matcher()
    {
        var (factory, engineer, op) = await NewFactoryWithUsersAsync("route-order");
        await using var _f = factory;
        using var _e = engineer;
        using var _o = op;

        using var export = await op.GetAsync("/v1/screens/export");

        Assert.Equal(HttpStatusCode.OK, export.StatusCode);
        var pack = await export.Content.ReadFromJsonAsync<ScreenPackDocument>(HmiContractJson.Options);
        Assert.NotNull(pack);
        Assert.Equal(ScreenPackDocument.CurrentPackVersion, pack!.PackVersion);
    }

    // ═════════════════════════════════════════════════════════════════════
    // The round trip, and the boundary, over HTTP.
    // ═════════════════════════════════════════════════════════════════════

    /// <summary>🔴 THE APPEND-ONLY BOUNDARY AT THE LAYER AN ENGINEER TOUCHES. An import over an existing
    /// screen appends; version 1 is still readable and still holds its original content afterwards.</summary>
    [Fact]
    public async Task Import_by_an_engineer_appends_over_an_existing_screen()
    {
        var (factory, engineer, op) = await NewFactoryWithUsersAsync("append");
        await using var _f = factory;
        using var _e = engineer;
        using var _o = op;
        await PutOkAsync(engineer, "line-overview", Screen("line-overview", "the engineers own work"));

        using var import = await engineer.PostAsJsonAsync(
            "/v1/screens/import",
            Pack(Entry("line-overview", Screen("line-overview", "from the pack"))),
            HmiContractJson.Options);

        Assert.Equal(HttpStatusCode.OK, import.StatusCode);
        var report = await import.Content.ReadFromJsonAsync<ScreenImportReportDto>(HmiContractJson.Options);
        Assert.NotNull(report);
        Assert.Equal(1, report!.Total);
        Assert.Equal(0, report.Created);
        Assert.Equal(1, report.Appended);
        Assert.Equal(0, report.Rejected);
        Assert.Equal(nameof(ScreenImportOutcome.AppendedAsNewVersion), report.Results[0].Outcome);
        Assert.Equal(2, report.Results[0].Version);

        // The prior version is STILL THERE, and still holds what it held.
        using var old = await op.GetAsync("/v1/screens/line-overview?version=1");
        Assert.Equal(HttpStatusCode.OK, old.StatusCode);
        var oldDoc = await old.Content.ReadFromJsonAsync<HmiScreenDocument>(HmiContractJson.Options);
        Assert.Equal("the engineers own work", oldDoc!.Title);

        // And the head is the imported one.
        using var head = await op.GetAsync("/v1/screens/line-overview");
        var headDoc = await head.Content.ReadFromJsonAsync<HmiScreenDocument>(HmiContractJson.Options);
        Assert.Equal("from the pack", headDoc!.Title);
    }

    /// <summary>The import gate is the SAME gate the publish endpoint uses — an import cannot be a side
    /// door around <c>ContractInvariants</c>. Falsified by sending, over HTTP, a document
    /// <c>PUT /v1/screens/{id}</c> itself would 400, and asserting the import refuses it too and writes
    /// nothing.</summary>
    [Fact]
    public async Task Import_refuses_a_document_the_publish_endpoint_would_also_refuse()
    {
        var (factory, engineer, op) = await NewFactoryWithUsersAsync("gate");
        await using var _f = factory;
        using var _e = engineer;
        using var _o = op;
        var illegal = Screen("bad-layout", "carried in") with { Layout = new ScreenLayout(999, 8, "panel") };

        // The publish door refuses it — establishing that this document IS the invalid kind.
        using (var put = await engineer.PutAsJsonAsync("/v1/screens/bad-layout", illegal, HmiContractJson.Options))
        {
            Assert.Equal(HttpStatusCode.BadRequest, put.StatusCode);
        }

        using var import = await engineer.PostAsJsonAsync(
            "/v1/screens/import", Pack(Entry("bad-layout", illegal)), HmiContractJson.Options);

        Assert.Equal(HttpStatusCode.OK, import.StatusCode);
        var report = await import.Content.ReadFromJsonAsync<ScreenImportReportDto>(HmiContractJson.Options);
        Assert.Equal(1, report!.Rejected);
        Assert.Equal(nameof(ScreenImportOutcome.RejectedInvalid), report.Results[0].Outcome);
        Assert.Null(report.Results[0].Version);
        Assert.NotEmpty(report.Results[0].Violations);

        // Nothing written — the screen is still undeclared.
        using var get = await op.GetAsync("/v1/screens/bad-layout");
        Assert.Equal(HttpStatusCode.NotFound, get.StatusCode);
    }

    /// <summary>NEGATIVE CONTROL for the gate test above: a route that 400'd or rejected every import
    /// would pass it. A VALID document over the same route must land.</summary>
    [Fact]
    public async Task Import_accepts_a_document_the_publish_endpoint_would_also_accept()
    {
        var (factory, engineer, op) = await NewFactoryWithUsersAsync("gate-control");
        await using var _f = factory;
        using var _e = engineer;
        using var _o = op;

        using var import = await engineer.PostAsJsonAsync(
            "/v1/screens/import", Pack(Entry("fine-screen", Screen("fine-screen", "ok"))), HmiContractJson.Options);

        Assert.Equal(HttpStatusCode.OK, import.StatusCode);
        var report = await import.Content.ReadFromJsonAsync<ScreenImportReportDto>(HmiContractJson.Options);
        Assert.Equal(1, report!.Created);
        Assert.Equal(0, report.Rejected);
        Assert.Equal(1, report.Results[0].Version);

        using var get = await op.GetAsync("/v1/screens/fine-screen");
        Assert.Equal(HttpStatusCode.OK, get.StatusCode);
    }

    [Fact]
    public async Task An_unknown_pack_version_is_a_400_and_imports_nothing()
    {
        var (factory, engineer, op) = await NewFactoryWithUsersAsync("wrapper");
        await using var _f = factory;
        using var _e = engineer;
        using var _o = op;

        var unknown = new ScreenPackDocument(
            ScreenPackDocument.CurrentPackVersion + 1, "elsewhere", "2026-01-01T00:00:00.0000000+00:00",
            new[] { Entry("would-have-worked", Screen("would-have-worked", "x")) });

        using var import = await engineer.PostAsJsonAsync("/v1/screens/import", unknown, HmiContractJson.Options);

        Assert.Equal(HttpStatusCode.BadRequest, import.StatusCode);
        var error = await import.Content.ReadFromJsonAsync<ApiErrorDto>(HmiContractJson.Options);
        Assert.NotNull(error);
        Assert.Contains("packVersion", error!.Error, StringComparison.Ordinal);

        using var get = await op.GetAsync("/v1/screens/would-have-worked");
        Assert.Equal(HttpStatusCode.NotFound, get.StatusCode);
    }

    /// <summary>Export → import round trip over HTTP, end to end: what an Operator exports is what an
    /// Engineer can import, with no hand-editing in between.</summary>
    [Fact]
    public async Task A_pack_exported_over_http_is_importable_over_http_unchanged()
    {
        var (factory, engineer, op) = await NewFactoryWithUsersAsync("round-trip");
        await using var _f = factory;
        using var _e = engineer;
        using var _o = op;
        await PutOkAsync(engineer, "line-overview", Screen("line-overview", "authored here"));

        ScreenPackDocument pack;
        using (var export = await op.GetAsync("/v1/screens/export"))
        {
            Assert.Equal(HttpStatusCode.OK, export.StatusCode);
            pack = (await export.Content.ReadFromJsonAsync<ScreenPackDocument>(HmiContractJson.Options))!;
        }

        Assert.Equal("line-overview", Assert.Single(pack.Screens).ScreenId);
        Assert.True(pack.Screens[0].ExportValid);
        // Provenance is present and real, not a placeholder.
        Assert.False(string.IsNullOrWhiteSpace(pack.ExportedFrom));
        Assert.True(DateTimeOffset.TryParse(pack.ExportedAtUtc, out _));

        using var import = await engineer.PostAsJsonAsync("/v1/screens/import", pack, HmiContractJson.Options);

        Assert.Equal(HttpStatusCode.OK, import.StatusCode);
        var report = await import.Content.ReadFromJsonAsync<ScreenImportReportDto>(HmiContractJson.Options);
        Assert.Equal(1, report!.Appended);
        Assert.Equal(2, report.Results[0].Version);
    }

    private static ScreenPackDocument Pack(params ScreenPackEntry[] entries) => new(
        ScreenPackDocument.CurrentPackVersion, "test-device", "2026-01-01T00:00:00.0000000+00:00", entries);

    private static ScreenPackEntry Entry(string screenId, HmiScreenDocument doc) => new(
        screenId, 1, "2026-01-01T00:00:00.0000000+00:00",
        ExportValid: ContractInvariants.Validate(doc).Count == 0,
        ExportViolations: ContractInvariants.Validate(doc),
        Document: doc);
}
