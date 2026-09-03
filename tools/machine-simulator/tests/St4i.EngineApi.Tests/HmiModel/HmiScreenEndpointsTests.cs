using System.Net;
using System.Net.Http.Json;
using System.Text;
using System.Text.Json;
using Microsoft.AspNetCore.Http.HttpResults;
using Microsoft.AspNetCore.Identity;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.Data.Sqlite;
using Microsoft.Extensions.DependencyInjection;
using St4i.EngineApi.Auth;
using St4i.EngineApi.Endpoints;
using St4i.EngineApi.Fleet;
using St4i.EngineApi.HmiModel;
using St4i.EngineApi.Tests.Auth;
using St4i.Hmi.Contracts;
using Xunit;

namespace St4i.EngineApi.Tests.HmiModel;

/// <summary>
/// WS-HMI-2 Task 3 — the screen HTTP surface: <c>GET /v1/screens</c>, <c>GET /v1/screens/{screenId}</c>
/// (with an optional <c>?version=</c>), <c>PUT /v1/screens/{screenId}</c>, <c>GET
/// /v1/screens/{screenId}/versions</c> (all Operator), and <c>POST /v1/screens/{screenId}/rollback</c>
/// (Engineer).
///
/// <para><b>KHÔNG đo cái gì — what this file deliberately does not measure:</b>
/// <list type="number">
///   <item><description>It does NOT pin which policy STRING is attached to each route's metadata. That is
///   <c>RbacPolicyTests.EveryV1Route_CarriesExactlyTheExpectedPolicyOrAnonymous</c>, the repository's one
///   exhaustive route-policy census. What this file measures is different: a logged-in Operator/Engineer
///   over the REAL auth pipeline is genuinely 403'd or 200'd.</description></item>
///   <item><description>It does NOT validate any served document against the JSON Schema (no <c>cols</c>
///   1..48 range, no <c>rect</c> non-negative range, no <c>kind</c> enum membership) — those are gaps
///   <c>ContractInvariants</c>' own doc comment names as deliberately unchecked on the .NET side, and the
///   only schema validator in the tree is <c>web/contract-tests/validate.mjs</c>. This file's P1 sweep
///   attacks exactly those gaps to prove they degrade to "stored as-is", never a 500.</description></item>
///   <item><description>It does NOT measure concurrency in general — only the one specific contention shape
///   (<c>SQLITE_BUSY</c>) this task's brief names by name, and that test says so on itself.</description></item>
///   <item><description>It does NOT measure event publication on the HMI change lane — WS-HMI-2 Task 4's
///   job, once <c>HmiModelEvents.ScreenChanged</c> exists (see <c>HmiScreenEndpoints.cs</c>'s own doc
///   comment for why Task 3 deliberately does not publish yet).</description></item>
/// </list></para>
///
/// <para><b>Real-pipeline (<see cref="WebApplicationFactory{Program}"/>), same convention as
/// <c>HmiTagEndpointsTests</c>/<c>HmiModelEndpointsTests</c>, and the host-building helpers are duplicated
/// from those rather than shared, for the same reason those two duplicate theirs from each other: each is
/// private to its own class, and a shared helper would couple isolation requirements across suites. This
/// class isolates its own <c>ST4I_HMI_SCREENS_DIR</c> per factory because several tests here depend on a
/// screen being genuinely undeclared, and one test opens a second, raw connection directly against the
/// store's own SQLite file.</b></para>
/// </summary>
[Collection(SecurityEnvVarTests.CollectionName)]
public sealed class HmiScreenEndpointsTests
{
    private static readonly SemaphoreSlim EnvLock = new(1, 1);
    private static readonly JsonSerializerOptions JsonOptions = new(JsonSerializerDefaults.Web);

    private static async Task<(WebApplicationFactory<Program> Factory, string ScreensDir)> CreateFactoryAsync()
    {
        var hmiScreensDir = Directory.CreateTempSubdirectory("st4i-hmi-screen-ep-").FullName;
        var securityDir = Directory.CreateTempSubdirectory("st4i-hmi-screen-ep-security-").FullName;

        await EnvLock.WaitAsync().ConfigureAwait(false);
        var prevScreensDir = Environment.GetEnvironmentVariable(HmiScreenStore.EnvVarDir);
        var prevSecurityDir = Environment.GetEnvironmentVariable("ST4I_SECURITY_DIR");
        var prevEnvironment = Environment.GetEnvironmentVariable("ASPNETCORE_ENVIRONMENT");
        try
        {
            Environment.SetEnvironmentVariable(HmiScreenStore.EnvVarDir, hmiScreensDir);
            Environment.SetEnvironmentVariable("ST4I_SECURITY_DIR", securityDir);
            // Production, not the default Development — a bare WebApplicationFactory<Program> loads the
            // SDK's Static Web Assets manifest (baked with this project's own absolute source-tree wwwroot
            // path) and throws before a single request runs — see HmiModelWiringTests' own comment.
            Environment.SetEnvironmentVariable("ASPNETCORE_ENVIRONMENT", "Production");

            var factory = new WebApplicationFactory<Program>();
            _ = factory.Server; // force the host to build NOW, while the overrides above are still live.
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

    private static async Task<(WebApplicationFactory<Program> Factory, string ScreensDir, HttpClient Engineer, HttpClient Operator)>
        NewFactoryWithUsersAsync(string suffix)
    {
        var (factory, screensDir) = await CreateFactoryAsync().ConfigureAwait(false);

        using (var bootstrapClient = factory.CreateClient())
        {
            using var bootstrap = await bootstrapClient.PostAsJsonAsync(
                "/v1/auth/bootstrap",
                new { username = $"scr-admin-{suffix}", password = "AdminPass123!", displayName = (string?)null },
                JsonOptions).ConfigureAwait(false);
            Assert.Equal(HttpStatusCode.OK, bootstrap.StatusCode);
        }

        await CreateUserAsync(factory, $"scr-engineer-{suffix}", "EngineerPass123!", Roles.Engineer).ConfigureAwait(false);
        await CreateUserAsync(factory, $"scr-operator-{suffix}", "OperatorPass123!", Roles.Operator).ConfigureAwait(false);

        var engineer = await LoginAsAsync(factory, $"scr-engineer-{suffix}", "EngineerPass123!").ConfigureAwait(false);
        var operatorClient = await LoginAsAsync(factory, $"scr-operator-{suffix}", "OperatorPass123!").ConfigureAwait(false);

        return (factory, screensDir, engineer, operatorClient);
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

    // ─────────────────────────────────────────────────────────────────────
    // Fixtures.
    // ─────────────────────────────────────────────────────────────────────

    private static WidgetRect Rect(int col = 0, int row = 0, int colSpan = 2, int rowSpan = 1) =>
        new(col, row, colSpan, rowSpan);

    private static HmiScreenDocument Screen(string screenId, string title) => new(
        1, screenId, title, null, "isa101",
        new ScreenLayout(12, 8, "panel"),
        new[] { new ScreenWidget("w1", "label", Rect()) });

    private static async Task<PutScreenResultDto> PutOkAsync(HttpClient client, string screenId, HmiScreenDocument doc)
    {
        using var put = await client.PutAsJsonAsync($"/v1/screens/{screenId}", doc, HmiContractJson.Options).ConfigureAwait(false);
        Assert.Equal(HttpStatusCode.OK, put.StatusCode);
        var result = await put.Content.ReadFromJsonAsync<PutScreenResultDto>(HmiContractJson.Options).ConfigureAwait(false);
        Assert.NotNull(result);
        return result!;
    }

    // ═════════════════════════════════════════════════════════════════════
    // Step 1's ruling, pinned: an undeclared screen is 404, never the empty-200 §5-bis gives
    // /v1/components/{code} and /v1/tags?machine=.
    // ═════════════════════════════════════════════════════════════════════

    [Fact]
    public async Task Get_ForAScreenNobodyDeclared_Gets404_NotEmpty200()
    {
        var (factory, _, _, operatorClient) = await NewFactoryWithUsersAsync("never-declared");
        await using var _f = factory;
        using var op = operatorClient;

        using var get = await op.GetAsync("/v1/screens/never-declared");

        Assert.Equal(HttpStatusCode.NotFound, get.StatusCode);
        var error = await get.Content.ReadFromJsonAsync<ApiErrorDto>(HmiContractJson.Options);
        Assert.NotNull(error);
        Assert.False(string.IsNullOrWhiteSpace(error!.Error));
    }

    // ═════════════════════════════════════════════════════════════════════
    // PUT → GET round trip, versioning, and rollback.
    // ═════════════════════════════════════════════════════════════════════

    [Fact]
    public async Task Put_ThenGet_RoundTripsTheDocument_AndVersionIsOne()
    {
        var (factory, _, engineerC, operatorClient) = await NewFactoryWithUsersAsync("roundtrip");
        await using var _f = factory;
        using var eng = engineerC;
        using var op = operatorClient;

        var result = await PutOkAsync(eng, "line-overview", Screen("line-overview", "Overview v1"));
        Assert.Equal("line-overview", result.ScreenId);
        Assert.Equal(1, result.Version);
        Assert.Equal(1, result.WidgetCount);

        using var get = await op.GetAsync("/v1/screens/line-overview");
        Assert.Equal(HttpStatusCode.OK, get.StatusCode);
        var back = await get.Content.ReadFromJsonAsync<HmiScreenDocument>(HmiContractJson.Options);
        Assert.NotNull(back);
        Assert.Equal("Overview v1", back!.Title);
        Assert.Single(back.Widgets);
    }

    [Fact]
    public async Task Put_ASecondTime_VersionIsTwo_AndGetWithoutVersionServesTheLatest()
    {
        var (factory, _, engineerC, operatorClient) = await NewFactoryWithUsersAsync("second-put");
        await using var _f = factory;
        using var eng = engineerC;
        using var op = operatorClient;

        var v1 = await PutOkAsync(eng, "second-line", Screen("second-line", "one"));
        Assert.Equal(1, v1.Version);
        var v2 = await PutOkAsync(eng, "second-line", Screen("second-line", "two"));
        Assert.Equal(2, v2.Version);

        using var get = await op.GetAsync("/v1/screens/second-line");
        var back = await get.Content.ReadFromJsonAsync<HmiScreenDocument>(HmiContractJson.Options);
        Assert.Equal("two", back!.Title);
    }

    [Fact]
    public async Task Get_WithAnExplicitVersion_ServesTheOldDocument_NotTheLatest()
    {
        var (factory, _, engineerC, operatorClient) = await NewFactoryWithUsersAsync("explicit-version");
        await using var _f = factory;
        using var eng = engineerC;
        using var op = operatorClient;

        await PutOkAsync(eng, "vers-line", Screen("vers-line", "one"));
        await PutOkAsync(eng, "vers-line", Screen("vers-line", "two"));

        using var get = await op.GetAsync("/v1/screens/vers-line?version=1");
        Assert.Equal(HttpStatusCode.OK, get.StatusCode);
        var old = await get.Content.ReadFromJsonAsync<HmiScreenDocument>(HmiContractJson.Options);
        Assert.Equal("one", old!.Title);
    }

    [Fact]
    public async Task Get_WithAVersionThatNeverExisted_Gets404()
    {
        var (factory, _, engineerC, operatorClient) = await NewFactoryWithUsersAsync("missing-version");
        await using var _f = factory;
        using var eng = engineerC;
        using var op = operatorClient;

        await PutOkAsync(eng, "one-version", Screen("one-version", "solo"));

        using var get = await op.GetAsync("/v1/screens/one-version?version=99");
        Assert.Equal(HttpStatusCode.NotFound, get.StatusCode);
    }

    [Fact]
    public async Task Rollback_ToVersion1_AppendsAsVersion3_AndGetServesItsContent()
    {
        var (factory, _, engineerC, operatorClient) = await NewFactoryWithUsersAsync("rollback-basic");
        await using var _f = factory;
        using var eng = engineerC;
        using var op = operatorClient;

        await PutOkAsync(eng, "rb-line", Screen("rb-line", "one"));
        await PutOkAsync(eng, "rb-line", Screen("rb-line", "two"));

        using var rollback = await eng.PostAsJsonAsync(
            "/v1/screens/rb-line/rollback", new RollbackRequestDto(1), HmiContractJson.Options);
        Assert.Equal(HttpStatusCode.OK, rollback.StatusCode);
        var result = await rollback.Content.ReadFromJsonAsync<PutScreenResultDto>(HmiContractJson.Options);
        Assert.Equal(3, result!.Version);

        using var get = await op.GetAsync("/v1/screens/rb-line");
        var back = await get.Content.ReadFromJsonAsync<HmiScreenDocument>(HmiContractJson.Options);
        Assert.Equal("one", back!.Title);

        // History is never dropped by a rollback — three rows, exactly one current.
        using var versions = await op.GetAsync("/v1/screens/rb-line/versions");
        var list = await versions.Content.ReadFromJsonAsync<List<ScreenVersionInfo>>(HmiContractJson.Options);
        Assert.Equal(new[] { 1, 2, 3 }, list!.Select(v => v.Version).ToArray());
        var current = Assert.Single(list, v => v.IsCurrent);
        Assert.Equal(3, current.Version);
    }

    [Fact]
    public async Task Rollback_ToANonexistentVersion_Gets404_AndCurrentVersionStaysUnchanged()
    {
        var (factory, _, engineerC, operatorClient) = await NewFactoryWithUsersAsync("rollback-404");
        await using var _f = factory;
        using var eng = engineerC;
        using var op = operatorClient;

        await PutOkAsync(eng, "rb-404-line", Screen("rb-404-line", "only version"));

        using (var rollback = await eng.PostAsJsonAsync(
                   "/v1/screens/rb-404-line/rollback", new RollbackRequestDto(99), HmiContractJson.Options))
        {
            Assert.Equal(HttpStatusCode.NotFound, rollback.StatusCode);
            var error = await rollback.Content.ReadFromJsonAsync<ApiErrorDto>(HmiContractJson.Options);
            Assert.False(string.IsNullOrWhiteSpace(error!.Error));
            // The store's own authored sentence survives (names the real version numbers)...
            Assert.Contains("99", error.Error, StringComparison.Ordinal);
            Assert.Contains("1", error.Error, StringComparison.Ordinal);
            // ...but WS-HMI-2 Task 3 fix round 1 (review LOW-4) strips .NET's own runtime-appended
            // framing — a raw ArgumentOutOfRangeException.Message reads like a leaked stack-trace
            // fragment (measured live: ".\r\nActual value was 99." tacked on the end).
            Assert.DoesNotContain("Parameter", error.Error, StringComparison.Ordinal);
            Assert.DoesNotContain("Actual value", error.Error, StringComparison.Ordinal);
        }

        // The current version pointer did not move — still version 1, still the only row.
        using var get = await op.GetAsync("/v1/screens/rb-404-line");
        var back = await get.Content.ReadFromJsonAsync<HmiScreenDocument>(HmiContractJson.Options);
        Assert.Equal("only version", back!.Title);

        using var versions = await op.GetAsync("/v1/screens/rb-404-line/versions");
        var list = await versions.Content.ReadFromJsonAsync<List<ScreenVersionInfo>>(HmiContractJson.Options);
        Assert.Equal(new[] { 1 }, list!.Select(v => v.Version).ToArray());
    }

    [Fact]
    public async Task Rollback_OnAScreenNobodyDeclared_Gets404()
    {
        var (factory, _, engineerC, _) = await NewFactoryWithUsersAsync("rollback-undeclared");
        await using var _f = factory;
        using var eng = engineerC;

        using var rollback = await eng.PostAsJsonAsync(
            "/v1/screens/never-declared/rollback", new RollbackRequestDto(1), HmiContractJson.Options);

        Assert.Equal(HttpStatusCode.NotFound, rollback.StatusCode);
    }

    // ═════════════════════════════════════════════════════════════════════
    // PUT route-vs-body screenId mismatch — 409, naming both values, WS-HMI-0b HIGH-1 one contract over.
    // ═════════════════════════════════════════════════════════════════════

    [Fact]
    public async Task Put_WithScreenIdInBodyDifferentFromRoute_Gets409_NamingBothValues_AndVictimUnchanged()
    {
        var (factory, _, engineerC, operatorClient) = await NewFactoryWithUsersAsync("mismatch");
        await using var _f = factory;
        using var eng = engineerC;
        using var op = operatorClient;

        // The victim already has a real document at version 1.
        await PutOkAsync(eng, "victim-screen", Screen("victim-screen", "victim v1"));

        // A PUT to a DIFFERENT route names the victim's id inside its own body.
        var attack = Screen("victim-screen", "attack payload");
        using (var put = await eng.PutAsJsonAsync("/v1/screens/intended-screen", attack, HmiContractJson.Options))
        {
            Assert.Equal(HttpStatusCode.Conflict, put.StatusCode);
            var error = await put.Content.ReadFromJsonAsync<ApiErrorDto>(HmiContractJson.Options);
            Assert.Contains("victim-screen", error!.Error, StringComparison.Ordinal);
            Assert.Contains("intended-screen", error.Error, StringComparison.Ordinal);
        }

        // The victim's document is untouched — still version 1, still its original title.
        using (var get = await op.GetAsync("/v1/screens/victim-screen"))
        {
            Assert.Equal(HttpStatusCode.OK, get.StatusCode);
            var back = await get.Content.ReadFromJsonAsync<HmiScreenDocument>(HmiContractJson.Options);
            Assert.Equal("victim v1", back!.Title);
        }
        using (var versions = await op.GetAsync("/v1/screens/victim-screen/versions"))
        {
            var list = await versions.Content.ReadFromJsonAsync<List<ScreenVersionInfo>>(HmiContractJson.Options);
            Assert.Equal(new[] { 1 }, list!.Select(v => v.Version).ToArray());
        }

        // And the route the caller actually named was never created either — no third identity appeared.
        using (var get = await op.GetAsync("/v1/screens/intended-screen"))
        {
            Assert.Equal(HttpStatusCode.NotFound, get.StatusCode);
        }
    }

    // ═════════════════════════════════════════════════════════════════════
    // §5 refusal, and P2 — a rejected body leaves no record, GET afterward still 404.
    // ═════════════════════════════════════════════════════════════════════

    [Fact]
    public async Task Put_ASection5ViolatingScreen_Gets400_WithAllViolations_AndGetStays404()
    {
        var (factory, _, engineerC, operatorClient) = await NewFactoryWithUsersAsync("section5");
        await using var _f = factory;
        using var eng = engineerC;
        using var op = operatorClient;

        // TWO violations in one document, deliberately: screenId "Bad-Screen" fails the frozen
        // ^[a-z0-9-]+$ pattern (uppercase 'B'), and the command-button widget omits policyAction (§5's own
        // rule). ex.Message must carry BOTH, per ContractViolationException's own contract.
        const string body = """
            {"schemaVersion":1,"screenId":"Bad-Screen","title":"x","theme":"isa101",
             "layout":{"cols":12,"rows":8,"breakpoint":"panel"},
             "widgets":[{"id":"w1","kind":"command-button","rect":{"col":0,"row":0,"colSpan":2,"rowSpan":1}}]}
            """;

        using (var put = await eng.PutAsync("/v1/screens/Bad-Screen",
                   new StringContent(body, Encoding.UTF8, "application/json")))
        {
            Assert.Equal(HttpStatusCode.BadRequest, put.StatusCode);
            var text = await put.Content.ReadAsStringAsync();
            Assert.Contains("screenId", text, StringComparison.Ordinal);
            Assert.Contains("policyAction", text, StringComparison.Ordinal);
        }

        // P2 — rejected, so still nowhere to be found.
        using var get = await op.GetAsync("/v1/screens/Bad-Screen");
        Assert.Equal(HttpStatusCode.NotFound, get.StatusCode);
    }

    // ═════════════════════════════════════════════════════════════════════
    // RBAC end-to-end — a REAL logged-in Operator/Engineer over the REAL auth pipeline. NOT the metadata
    // census (RbacPolicyTests). No route here ever needs Admin.
    // ═════════════════════════════════════════════════════════════════════

    [Fact]
    public async Task Operator_CanReadAllFourReadRoutes_ButCannotPutOrRollback()
    {
        var (factory, _, engineerC, operatorClient) = await NewFactoryWithUsersAsync("rbac");
        await using var _f = factory;
        using var eng = engineerC;
        using var op = operatorClient;

        await PutOkAsync(eng, "rbac-screen", Screen("rbac-screen", "v1"));
        await PutOkAsync(eng, "rbac-screen", Screen("rbac-screen", "v2"));

        Assert.Equal(HttpStatusCode.OK, (await op.GetAsync("/v1/screens")).StatusCode);
        Assert.Equal(HttpStatusCode.OK, (await op.GetAsync("/v1/screens/rbac-screen")).StatusCode);
        Assert.Equal(HttpStatusCode.OK, (await op.GetAsync("/v1/screens/rbac-screen?version=1")).StatusCode);
        Assert.Equal(HttpStatusCode.OK, (await op.GetAsync("/v1/screens/rbac-screen/versions")).StatusCode);

        using (var put = await op.PutAsJsonAsync("/v1/screens/rbac-screen-2", Screen("rbac-screen-2", "x"), HmiContractJson.Options))
        {
            Assert.Equal(HttpStatusCode.Forbidden, put.StatusCode);
        }

        using (var rollback = await op.PostAsJsonAsync(
                   "/v1/screens/rbac-screen/rollback", new RollbackRequestDto(1), HmiContractJson.Options))
        {
            Assert.Equal(HttpStatusCode.Forbidden, rollback.StatusCode);
        }

        // The refused writes left nothing behind either.
        using var stillMissing = await op.GetAsync("/v1/screens/rbac-screen-2");
        Assert.Equal(HttpStatusCode.NotFound, stillMissing.StatusCode);
    }

    // ═════════════════════════════════════════════════════════════════════
    // 🔴 P1 — NO CLIENT-AUTHORED BODY MAY PRODUCE A 500.
    //
    // The surface, enumerated from the frozen records rather than from memory:
    //   numeric  — schemaVersion (int), layout.cols/rows (int), widget.rect.{col,row,colSpan,rowSpan} (int).
    //              No floating-point field exists on this contract at all (ContractInvariants' own doc
    //              comment says so, verified by reflection in St4i.Hmi.Contracts.Tests) — so there is no
    //              non-finite attack here, unlike the tag-namespace/component-tree surfaces.
    //   string   — screenId, title, titleEn?, theme, layout.breakpoint, widget.id, widget.kind,
    //              widget.component?, widget.policyAction?, bindings values (string→string dict).
    //   struct   — widgets (list) and its elements, layout (object), rect (object), bindings (dict),
    //              props (dict of raw JSON).
    // Every one of them is attacked below, as RAW JSON so System.Text.Json's own parser produces the value
    // exactly as a client would — including the exact four the brief names by name: rect negative, colSpan
    // 0, cols above 48, an unknown kind — plus widgets:null, an absent layout, malformed JSON and a bare
    // null, also named by the brief.
    // ═════════════════════════════════════════════════════════════════════

    private const string BaseWidget =
        "\"id\":\"w1\",\"kind\":\"label\",\"rect\":{\"col\":0,\"row\":0,\"colSpan\":2,\"rowSpan\":1}";

    /// <summary>A full, otherwise-valid document with ONE widget, that widget carrying <paramref name="widgetOverride"/>
    /// as extra JSON appended AFTER the base widget fields — System.Text.Json's last-property-wins duplicate
    /// handling makes the override replace the base value it names.</summary>
    private static string WidgetOverride(string widgetOverride) =>
        "{\"schemaVersion\":1,\"screenId\":\"p1-screen\",\"title\":\"P1\",\"theme\":\"isa101\"," +
        "\"layout\":{\"cols\":12,\"rows\":8,\"breakpoint\":\"panel\"}," +
        "\"widgets\":[{" + BaseWidget + "," + widgetOverride + "}]}";

    /// <summary>A full, otherwise-valid document carrying <paramref name="docOverride"/> as an extra
    /// TOP-LEVEL field appended last, same last-wins mechanism as <see cref="WidgetOverride"/> but at the
    /// document level.</summary>
    private static string DocOverride(string docOverride) =>
        "{\"schemaVersion\":1,\"screenId\":\"p1-screen\",\"title\":\"P1\",\"theme\":\"isa101\"," +
        "\"layout\":{\"cols\":12,\"rows\":8,\"breakpoint\":\"panel\"}," +
        "\"widgets\":[{" + BaseWidget + "}]," + docOverride + "}";

    public static TheoryData<string, string> HostileScreenBodies() => new()
    {
        // ── the four the brief names by name.
        { "rect-col-negative",        WidgetOverride("\"rect\":{\"col\":-1,\"row\":0,\"colSpan\":2,\"rowSpan\":1}") },
        { "rect-row-negative",        WidgetOverride("\"rect\":{\"col\":0,\"row\":-5,\"colSpan\":2,\"rowSpan\":1}") },
        { "colSpan-zero",             WidgetOverride("\"rect\":{\"col\":0,\"row\":0,\"colSpan\":0,\"rowSpan\":1}") },
        { "colSpan-negative",         WidgetOverride("\"rect\":{\"col\":0,\"row\":0,\"colSpan\":-3,\"rowSpan\":1}") },
        { "rowSpan-zero",             WidgetOverride("\"rect\":{\"col\":0,\"row\":0,\"colSpan\":2,\"rowSpan\":0}") },
        { "cols-above-48",            DocOverride("\"layout\":{\"cols\":1000,\"rows\":8,\"breakpoint\":\"panel\"}") },
        { "rows-above-48",            DocOverride("\"layout\":{\"cols\":12,\"rows\":9000,\"breakpoint\":\"panel\"}") },
        { "cols-zero",                DocOverride("\"layout\":{\"cols\":0,\"rows\":8,\"breakpoint\":\"panel\"}") },
        { "kind-unrecognised",        WidgetOverride("\"kind\":\"widget-from-the-future\"") },
        { "widgets-null",             DocOverride("\"widgets\":null") },
        { "layout-absent",
            "{\"schemaVersion\":1,\"screenId\":\"p1-screen\",\"title\":\"P1\",\"theme\":\"isa101\"," +
            "\"widgets\":[{" + BaseWidget + "}]}" },
        { "malformed-json",           "{ this is not valid json" },
        { "literal-null",             "null" },
        // ── envelope shapes beyond the four named explicitly.
        { "empty-body",               "" },
        { "not-an-object",            "[]" },
        { "deep-nesting",
            "{\"schemaVersion\":1,\"screenId\":\"p1-screen\",\"title\":\"P1\",\"theme\":\"isa101\"," +
            "\"layout\":{\"cols\":12,\"rows\":8,\"breakpoint\":\"panel\"}," +
            "\"widgets\":" + new string('[', 200) + new string(']', 200) + "}" },
        // ── integer overflow on ints this contract carries: binder rejection, not a crash.
        { "schemaVersion-overflow",
            "{\"schemaVersion\":99999999999999999999,\"screenId\":\"p1-screen\",\"title\":\"P1\"," +
            "\"theme\":\"isa101\",\"layout\":{\"cols\":12,\"rows\":8,\"breakpoint\":\"panel\"}," +
            "\"widgets\":[{" + BaseWidget + "}]}" },
        { "cols-overflow",            DocOverride("\"layout\":{\"cols\":99999999999999999999,\"rows\":8,\"breakpoint\":\"panel\"}") },
        { "rect-col-overflow",        WidgetOverride("\"rect\":{\"col\":99999999999999999999,\"row\":0,\"colSpan\":2,\"rowSpan\":1}") },
        // ── the document's own identity.
        { "screenId-null",            DocOverride("\"screenId\":null") },
        { "screenId-blank",           DocOverride("\"screenId\":\"   \"") },
        { "screenId-wrong-kind",      DocOverride("\"screenId\":123") },
        // ── the strings DECLARED non-nullable but documented as null-tolerant (must be 200 or 400, never
        //    500 — the whole point of attacking a field the documentation calls "safe" is that the claim is
        //    a claim, not a measurement).
        { "title-null",               DocOverride("\"title\":null") },
        { "theme-null",               DocOverride("\"theme\":null") },
        { "titleEn-null",             DocOverride("\"titleEn\":null") },
        { "breakpoint-null",          DocOverride("\"layout\":{\"cols\":12,\"rows\":8,\"breakpoint\":null}") },
        { "widget-id-null",           WidgetOverride("\"id\":null") },
        { "widget-kind-null",         WidgetOverride("\"kind\":null") },
        { "widget-rect-absent",
            "{\"schemaVersion\":1,\"screenId\":\"p1-screen\",\"title\":\"P1\",\"theme\":\"isa101\"," +
            "\"layout\":{\"cols\":12,\"rows\":8,\"breakpoint\":\"panel\"}," +
            "\"widgets\":[{\"id\":\"w1\",\"kind\":\"label\"}]}" },
        { "component-null",           WidgetOverride("\"component\":null") },
        { "bindings-null",            WidgetOverride("\"bindings\":null") },
        { "bindings-value-null",      WidgetOverride("\"bindings\":{\"state\":null}") },
        { "props-nested",             WidgetOverride("\"props\":{\"a\":{\"b\":[1,2,3]}}") },
        // ── §5's own gate, reachable over HTTP for the first time by this task (ContractInvariants gained
        //    this check in WS-HMI-0a fix round 4 with no route to exercise it until now).
        { "rw-policyAction-null",     WidgetOverride("\"kind\":\"command-button\",\"policyAction\":null") },
        { "rw-policyAction-blank",    WidgetOverride("\"kind\":\"setpoint-input\",\"policyAction\":\" \"") },
        // ── collection shapes.
        { "widgets-element-null",
            "{\"schemaVersion\":1,\"screenId\":\"p1-screen\",\"title\":\"P1\",\"theme\":\"isa101\"," +
            "\"layout\":{\"cols\":12,\"rows\":8,\"breakpoint\":\"panel\"},\"widgets\":[null]}" },
        { "widgets-element-empty",
            "{\"schemaVersion\":1,\"screenId\":\"p1-screen\",\"title\":\"P1\",\"theme\":\"isa101\"," +
            "\"layout\":{\"cols\":12,\"rows\":8,\"breakpoint\":\"panel\"},\"widgets\":[{}]}" },
        { "widgets-omitted",
            "{\"schemaVersion\":1,\"screenId\":\"p1-screen\",\"title\":\"P1\",\"theme\":\"isa101\"," +
            "\"layout\":{\"cols\":12,\"rows\":8,\"breakpoint\":\"panel\"}}" },
        { "widgets-wrong-kind",
            "{\"schemaVersion\":1,\"screenId\":\"p1-screen\",\"title\":\"P1\",\"theme\":\"isa101\"," +
            "\"layout\":{\"cols\":12,\"rows\":8,\"breakpoint\":\"panel\"},\"widgets\":{}}" },
        // ── a lone UTF-16 surrogate, the same Unicode edge HmiTagEndpointsTests attacks its own string
        //    surface with.
        { "lone-surrogate-in-title",  DocOverride("\"title\":\"P1 \\ud800\"") },
    };

    /// <summary>P1 (no client-authored body produces a 5xx) AND P2 (no rejected body leaves a record),
    /// checked together on every one of the bodies above — checked after EVERY entry, not once, per the
    /// brief's own wording for P2.
    ///
    /// <para>Does NOT measure that every 400 above is 400 FOR THE REASON its label suggests — several
    /// labels (screenId-null/blank, title-null, titleEn-null, component-null, bindings-null) are documented
    /// null-tolerant fields the route/body guard or ContractInvariants' own boundary accepts, so they are
    /// expected to come back 200, not 400; this test's own status assertion accepts either, and only
    /// verifies neither is ever 5xx.</para></summary>
    [Theory]
    [MemberData(nameof(HostileScreenBodies))]
    public async Task No_client_authored_body_produces_a_500_and_no_rejected_body_leaves_a_record(string label, string json)
    {
        var (factory, _, engineerC, operatorClient) = await NewFactoryWithUsersAsync($"p1-{label}");
        await using var _f = factory;
        using var eng = engineerC;
        using var op = operatorClient;

        HttpStatusCode status;
        string responseText;
        using (var content = new StringContent(json, Encoding.UTF8, "application/json"))
        using (var put = await eng.PutAsync("/v1/screens/p1-screen", content))
        {
            status = put.StatusCode;
            responseText = await put.Content.ReadAsStringAsync();
        }

        Assert.True(
            status is HttpStatusCode.OK or HttpStatusCode.BadRequest,
            $"body '{label}' produced {(int)status}: {responseText}. P1 says no client-authored body may " +
            "produce a 5xx.");

        // P2 — if it was rejected, nothing may have been recorded.
        if ((int)status >= 400)
        {
            using var get = await op.GetAsync("/v1/screens/p1-screen");
            Assert.Equal(HttpStatusCode.NotFound, get.StatusCode);
            return;
        }

        // P1 does not end at the write: an accepted body that then poisons a later read is P1 broken with
        // a delay, and worse than an immediate 500 because the row outlives the request that created it.
        using (var getAfter = await op.GetAsync("/v1/screens/p1-screen"))
        {
            Assert.True((int)getAfter.StatusCode < 500,
                $"body '{label}' was accepted at 200 and then made GET answer {(int)getAfter.StatusCode}.");
            var doc = await getAfter.Content.ReadFromJsonAsync<HmiScreenDocument>(HmiContractJson.Options);
            Assert.NotNull(doc);
        }

        using (var versions = await op.GetAsync("/v1/screens/p1-screen/versions"))
        {
            Assert.True((int)versions.StatusCode < 500,
                $"body '{label}' was accepted at 200 and then made GET .../versions answer {(int)versions.StatusCode}.");
        }
    }

    // ═════════════════════════════════════════════════════════════════════
    // 🔴 SQLITE_BUSY (SqliteErrorCode == 5) — see HmiScreenEndpoints.cs's own doc comment for the
    // measurement this reproduces (Task 1: ~34s, ~7x the configured busy_timeout=5000) and the reasoning
    // behind mapping it to 503 rather than the primary-key 409 HmiTagEndpoints.cs uses for a different
    // SqliteErrorCode entirely.
    // ═════════════════════════════════════════════════════════════════════

    /// <summary>Reproduces write-lock contention over a REAL HTTP request: a second, raw connection to the
    /// SAME <c>hmi-screens.db</c> file holds the write lock (<c>BEGIN IMMEDIATE</c>, never committed) while
    /// a genuine <c>PUT</c> runs concurrently. Not a unit test of the catch clause in isolation — this is
    /// the actual mechanism <see cref="HmiScreenStore.AppendVersionAsync"/> hits, driven through the real
    /// store and the real HTTP pipeline.
    ///
    /// <para>Does NOT measure the exact wait duration. How long <see cref="HmiScreenStore"/>'s connection
    /// blocks before <c>SqliteException(SqliteErrorCode=5)</c> is thrown is an artifact of SQLite's own
    /// busy-retry loop under the store's frozen <c>busy_timeout=5000</c> pragma (Task 1's own file,
    /// untouched here) — this test only asserts WHAT the caller sees once the store gives up, bounded by a
    /// generous 90-second budget so a genuine regression fails loudly instead of hanging the suite.</para></summary>
    [Fact]
    public async Task Put_WhileAnotherConnectionHoldsTheWriteLock_Gets503_NotA500_AfterTheStoreGivesUp()
    {
        var (factory, screensDir, engineerC, _) = await NewFactoryWithUsersAsync("busy");
        await using var _f = factory;
        using var eng = engineerC;

        // Force IHmiScreenStore's lazy DI factory to run now, so hmi-screens.db exists on disk before a raw
        // connection is opened against it below.
        Assert.Equal(HttpStatusCode.OK, (await eng.GetAsync("/v1/screens")).StatusCode);

        var dbPath = Path.Combine(screensDir, "hmi-screens.db");
        using var blocker = new SqliteConnection($"Data Source={dbPath}");
        await blocker.OpenAsync();
        // Parameterless BeginTransaction() is BEGIN IMMEDIATE (Microsoft.Data.Sqlite's own resolution,
        // measured in HmiScreenStoreTests.cs) — takes the write lock immediately, held until Rollback()
        // below, deliberately never committed.
        using var blockTx = blocker.BeginTransaction();

        using var cts = new CancellationTokenSource(TimeSpan.FromSeconds(90));
        HttpResponseMessage response;
        try
        {
            response = await eng.PutAsJsonAsync(
                "/v1/screens/busy-screen", Screen("busy-screen", "x"), HmiContractJson.Options, cts.Token);
        }
        finally
        {
            // Release the lock regardless of outcome, so the database is left usable for the P2 check below
            // and for whatever runs after this test.
            blockTx.Rollback();
        }

        using (response)
        {
            Assert.Equal(HttpStatusCode.ServiceUnavailable, response.StatusCode);
            var error = await response.Content.ReadFromJsonAsync<ApiErrorDto>(HmiContractJson.Options);
            Assert.NotNull(error);
            Assert.False(string.IsNullOrWhiteSpace(error!.Error));
        }

        // P2 — the contended write left nothing behind either.
        using var get = await eng.GetAsync("/v1/screens/busy-screen");
        Assert.Equal(HttpStatusCode.NotFound, get.StatusCode);
    }

    // ═════════════════════════════════════════════════════════════════════
    // WS-HMI-2 Task 3 fix round 1 (review MED-1) — the route/body screenId-mismatch guard compares via
    // ScreenIdentity.SameIdentity (Ordinal, no case fold), and this task's own review measured that
    // widening it to StringComparison.OrdinalIgnoreCase leaves all 52 tests from round 0 green: a
    // case-differing body silently stopped being a 409 and became a 400 §5 pattern violation instead —
    // WS-HMI-0b HIGH-1's "two identities were named" signal lost with no red test. Case-differing was the
    // one gap in the mismatch coverage: every existing test used either the SAME spelling or a WHOLLY
    // DIFFERENT id, never two spellings of what OrdinalIgnoreCase would call "the same" identity.
    // ═════════════════════════════════════════════════════════════════════

    [Fact]
    public async Task Put_WithScreenIdInBodyDifferingOnlyByCaseFromRoute_Gets409_NotACasefoldedMatch()
    {
        var (factory, _, engineerC, _) = await NewFactoryWithUsersAsync("case-mismatch");
        await using var _f = factory;
        using var eng = engineerC;

        // A body ScreenId that differs from the route ONLY in case. screenId identity does not fold case
        // (unlike machine-code identity) — see CanonicalScreenStore.cs's own doc comment for the measured
        // reason — so this must be refused as a genuine mismatch, exactly like a wholly different id would
        // be, not silently treated as "the same screen, different spelling".
        var body = Screen("case-line", "x") with { ScreenId = "CASE-LINE" };

        using var put = await eng.PutAsJsonAsync("/v1/screens/case-line", body, HmiContractJson.Options);

        Assert.Equal(HttpStatusCode.Conflict, put.StatusCode);
        var error = await put.Content.ReadFromJsonAsync<ApiErrorDto>(HmiContractJson.Options);
        Assert.Contains("CASE-LINE", error!.Error, StringComparison.Ordinal);
        Assert.Contains("case-line", error.Error, StringComparison.Ordinal);

        // Nothing was written under either spelling.
        using var get = await eng.GetAsync("/v1/screens/case-line");
        Assert.Equal(HttpStatusCode.NotFound, get.StatusCode);
    }

    // ═════════════════════════════════════════════════════════════════════
    // WS-HMI-2 Task 3 fix round 1 (review MED-2) — rollback's WidgetCount is read from the CONTENT of the
    // version just appended. The review measured TWO ways this could be unpinned and stay green: (M11)
    // reading a HARDCODED version instead of the one RollbackAsync actually returned, and (M12) a hardcoded
    // constant. Both survived because the round-0 rollback test happened to roll back TO version 1 — the
    // one number a hardcoded read could coincidentally match — and rolled a 1-widget document back onto a
    // 1-widget document, so the two candidate widget counts were indistinguishable by construction. This
    // test uses THREE versions with THREE different widget counts, none of them 1, and rolls back to the
    // MIDDLE one — so a hardcoded "read version 1" answers wrong, a hardcoded "-1" answers wrong, and only
    // "read the CONTENT of the version actually restored" answers right.
    // ═════════════════════════════════════════════════════════════════════

    private static HmiScreenDocument ScreenWithWidgets(string screenId, string title, int widgetCount) => new(
        1, screenId, title, null, "isa101", new ScreenLayout(12, 8, "panel"),
        Enumerable.Range(0, widgetCount).Select(i => new ScreenWidget($"w{i}", "label", Rect(row: i))).ToArray());

    [Fact]
    public async Task Rollback_ToANonLatestVersion_WidgetCountReflectsTheRestoredContent()
    {
        var (factory, _, engineerC, operatorClient) = await NewFactoryWithUsersAsync("rollback-count");
        await using var _f = factory;
        using var eng = engineerC;
        using var op = operatorClient;

        await PutOkAsync(eng, "wc-line", ScreenWithWidgets("wc-line", "v1", widgetCount: 1));
        await PutOkAsync(eng, "wc-line", ScreenWithWidgets("wc-line", "v2", widgetCount: 2));
        await PutOkAsync(eng, "wc-line", ScreenWithWidgets("wc-line", "v3", widgetCount: 3));

        // Roll back to version 2 (2 widgets) — appended as version 4. A hardcoded "read version 1" would
        // report 1; a hardcoded constant would report something fixed; only the real content of version 2
        // reports 2.
        using var rollback = await eng.PostAsJsonAsync(
            "/v1/screens/wc-line/rollback", new RollbackRequestDto(2), HmiContractJson.Options);
        Assert.Equal(HttpStatusCode.OK, rollback.StatusCode);
        var result = await rollback.Content.ReadFromJsonAsync<PutScreenResultDto>(HmiContractJson.Options);
        Assert.Equal(4, result!.Version);
        Assert.Equal(2, result.WidgetCount);

        using var get = await op.GetAsync("/v1/screens/wc-line");
        var back = await get.Content.ReadFromJsonAsync<HmiScreenDocument>(HmiContractJson.Options);
        Assert.Equal("v2", back!.Title);
        Assert.Equal(2, back.Widgets.Count);
    }

    // ═════════════════════════════════════════════════════════════════════
    // WS-HMI-2 Task 3 fix round 1 (review LOW-1) — PUT with no screenId in the body fills it from the
    // route and stores a real document at 200. The review measured that deleting this fill-in leaves round-
    // 0's suite green, because the P1 theory's own doc comment declares its screenId-null/blank rows
    // "accept 200 or 400" — an intentionally loose assertion for a sweep whose job is "never 500", not a
    // pin of this specific behaviour. Pinned directly here.
    // ═════════════════════════════════════════════════════════════════════

    [Fact]
    public async Task Put_WithNoScreenIdInTheBody_Gets200_AndIsStoredUnderTheRouteId()
    {
        var (factory, _, engineerC, operatorClient) = await NewFactoryWithUsersAsync("noid");
        await using var _f = factory;
        using var eng = engineerC;
        using var op = operatorClient;

        const string body = """
            {"schemaVersion":1,"title":"filled from route","theme":"isa101",
             "layout":{"cols":12,"rows":8,"breakpoint":"panel"},
             "widgets":[{"id":"w1","kind":"label","rect":{"col":0,"row":0,"colSpan":2,"rowSpan":1}}]}
            """;

        using (var put = await eng.PutAsync("/v1/screens/noid-line",
                   new StringContent(body, Encoding.UTF8, "application/json")))
        {
            Assert.Equal(HttpStatusCode.OK, put.StatusCode);
            var result = await put.Content.ReadFromJsonAsync<PutScreenResultDto>(HmiContractJson.Options);
            Assert.Equal("noid-line", result!.ScreenId);
            Assert.Equal(1, result.Version);
        }

        using var get = await op.GetAsync("/v1/screens/noid-line");
        Assert.Equal(HttpStatusCode.OK, get.StatusCode);
        var back = await get.Content.ReadFromJsonAsync<HmiScreenDocument>(HmiContractJson.Options);
        Assert.Equal("noid-line", back!.ScreenId);
        Assert.Equal("filled from route", back.Title);
    }

    // ═════════════════════════════════════════════════════════════════════
    // WS-HMI-2 Task 3 fix round 1 (review MED-3) — SqliteErrorCode == 5 (SQLITE_BUSY) specificity, direct.
    // The review's finding: widening the predicate to `>= 0` (or any wider set) left the HTTP-level busy
    // test green, because that test only proves "busy → 503"; nothing on the HTTP surface can prove
    // "not-busy → not-503" without corrupting a real database file on demand. IsWriteLockBusy is now
    // internal specifically so this can be asserted directly, against constructed SqliteException values —
    // Microsoft.Data.Sqlite.SqliteException(string, int) and (string, int, int) are public constructors,
    // confirmed by a standalone compile probe before writing this test.
    // ═════════════════════════════════════════════════════════════════════

    [Theory]
    [InlineData(5, true)]    // SQLITE_BUSY — the one code this predicate must accept.
    [InlineData(19, false)]  // SQLITE_CONSTRAINT — HmiTagEndpoints.IsPathAlreadyClaimed's code, a DIFFERENT hazard.
    [InlineData(11, false)]  // SQLITE_CORRUPT — the exact "laundered into a transient status" hazard the review named.
    [InlineData(8, false)]   // SQLITE_READONLY — named alongside SQLITE_CORRUPT in the review's finding.
    [InlineData(0, false)]   // SQLITE_OK — the boundary a `>= 0` mutation would wrongly accept.
    public void IsWriteLockBusy_IsTrueOnlyForSqliteErrorCode5(int sqliteErrorCode, bool expected)
    {
        var ex = new SqliteException("probe", sqliteErrorCode);

        Assert.Equal(expected, HmiScreenEndpoints.IsWriteLockBusy(ex));
    }

    // ═════════════════════════════════════════════════════════════════════
    // WS-HMI-2 Task 3 fix round 1 (review LOW-3) — the post-commit GetAsync inside RollbackAsync sits
    // OUTSIDE both catches. The rollback itself has already committed by the time that read runs; a throw
    // from it must not turn a write that succeeded into a response reporting failure. Not reachable through
    // the real store in normal operation (the row RollbackAsync just appended is always readable a moment
    // later) — this is the ONE double in this file, and deliberately so: proving the wrap actually works
    // requires a store that fails exactly where the real one cannot be made to on demand. Calls the handler
    // DIRECTLY (internal, this assembly has InternalsVisibleTo — see AssemblyInfo.cs) rather than through
    // HTTP: no factory, no auth pipeline, because the property under test is entirely inside this one
    // method and everything else in this file already proves the real store/pipeline/decorator end to end.
    // ═════════════════════════════════════════════════════════════════════

    private sealed class RollbackSucceedsButReadThrowsStore : IHmiScreenStore
    {
        public Task<HmiScreenDocument?> GetAsync(string screenId, int? version = null, CancellationToken ct = default) =>
            throw new InvalidOperationException("simulated post-commit read failure");

        public Task<int> PutAsync(HmiScreenDocument doc, CancellationToken ct = default) =>
            throw new NotSupportedException("not exercised by this test");

        public Task<IReadOnlyList<string>> ListScreenIdsAsync(CancellationToken ct = default) =>
            throw new NotSupportedException("not exercised by this test");

        public Task<IReadOnlyList<ScreenVersionInfo>> ListVersionsAsync(string screenId, CancellationToken ct = default) =>
            throw new NotSupportedException("not exercised by this test");

        // The rollback itself succeeds — this is what "already committed" means for this test.
        public Task<int> RollbackAsync(string screenId, int toVersion, CancellationToken ct = default) =>
            Task.FromResult(7);
    }

    [Fact]
    public async Task Rollback_WhenThePostCommitReadThrows_StillReturns200WithTheRealVersion_NotA500()
    {
        var store = new RollbackSucceedsButReadThrowsStore();

        var result = await HmiScreenEndpoints.RollbackAsync(
            "whatever-screen", new RollbackRequestDto(1), store, CancellationToken.None);

        var ok = Assert.IsType<Ok<PutScreenResultDto>>(result);
        Assert.NotNull(ok.Value);
        // The version RollbackAsync actually returned survives — the fact that matters most, even though
        // the read that would have named the widget count failed.
        Assert.Equal(7, ok.Value!.Version);
        Assert.Equal(0, ok.Value.WidgetCount);
    }

    [Fact]
    public async Task Rollback_WhenThePostCommitReadIsCancelled_StillPropagatesTheCancellation()
    {
        // The negative control LOW-3's fix needs: OperationCanceledException must NOT be swallowed into a
        // degraded 200 the way every other exception is — a cancelled caller gets no response at all, same
        // as every other cancelled request in this codebase.
        var store = new ThrowsOperationCanceledOnGetStore();

        await Assert.ThrowsAsync<OperationCanceledException>(() =>
            HmiScreenEndpoints.RollbackAsync("whatever-screen", new RollbackRequestDto(1), store, CancellationToken.None));
    }

    private sealed class ThrowsOperationCanceledOnGetStore : IHmiScreenStore
    {
        public Task<HmiScreenDocument?> GetAsync(string screenId, int? version = null, CancellationToken ct = default) =>
            throw new OperationCanceledException("simulated caller-went-away");

        public Task<int> PutAsync(HmiScreenDocument doc, CancellationToken ct = default) =>
            throw new NotSupportedException("not exercised by this test");

        public Task<IReadOnlyList<string>> ListScreenIdsAsync(CancellationToken ct = default) =>
            throw new NotSupportedException("not exercised by this test");

        public Task<IReadOnlyList<ScreenVersionInfo>> ListVersionsAsync(string screenId, CancellationToken ct = default) =>
            throw new NotSupportedException("not exercised by this test");

        public Task<int> RollbackAsync(string screenId, int toVersion, CancellationToken ct = default) =>
            Task.FromResult(7);
    }
}
