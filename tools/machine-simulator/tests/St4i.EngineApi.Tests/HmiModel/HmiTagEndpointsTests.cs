using System.Net;
using System.Net.Http.Json;
using System.Text;
using System.Text.Json;
using Microsoft.AspNetCore.Identity;
using Microsoft.AspNetCore.Mvc.Testing;
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
/// WS-HMI-0b Task 2 — the tag-namespace HTTP surface: <c>GET /v1/tags?machine={code}</c> (Operator),
/// <c>GET /v1/tags/by-path/{**path}</c> (Operator), <c>PUT /v1/tags/{machineCode}</c> (Engineer).
///
/// <para><b>KHÔNG đo cái gì — what this file deliberately does not measure:</b>
/// <list type="number">
///   <item><description>It does NOT pin which policy STRING is attached to each route's metadata. That is
///   <c>RbacPolicyTests.EveryV1Route_CarriesExactlyTheExpectedPolicyOrAnonymous</c>, the repository's one
///   exhaustive route-policy census and the only place "Engineer, never Admin" is a property of route
///   registration. What this file measures is different and more real: a logged-in Operator over the
///   REAL auth pipeline is genuinely 403'd at the write and genuinely 200'd at both reads.</description></item>
///   <item><description>It does NOT validate any served document against the JSON Schema — the only schema
///   validator in the tree is <c>web/contract-tests/validate.mjs</c>.</description></item>
///   <item><description>It does NOT measure that a tag is actually BACKED by a driver.
///   <see cref="PutNamespaceResultDto.BackedByDriverCount"/> is a count of a declared data field here and
///   nothing more; making it a measured proposition is WS-HMI-0c's job (see this task's report).</description></item>
///   <item><description>It does NOT measure concurrency — two simultaneous PUTs of colliding namespaces
///   race in a way a sequential test cannot see. The cross-machine collision test below is sequential and
///   says so.</description></item>
/// </list></para>
///
/// <para><b>Real-pipeline (<see cref="WebApplicationFactory{Program}"/>), same convention as
/// <c>HmiModelEndpointsTests</c>/<c>AssetEndpointsTests</c>, and the host-building helpers are duplicated
/// from the former rather than shared — the same reason <c>AuthPipelineTests</c> and <c>RbacPolicyTests</c>
/// duplicate theirs from each other: each is private to its own class, and a shared helper would couple two
/// suites' isolation requirements. This class isolates its own store directories per factory because
/// several tests here depend on a machine being genuinely undeclared.</b></para>
/// </summary>
[Collection(SecurityEnvVarTests.CollectionName)]
public sealed class HmiTagEndpointsTests
{
    private static readonly SemaphoreSlim EnvLock = new(1, 1);
    private static readonly JsonSerializerOptions JsonOptions = new(JsonSerializerDefaults.Web);

    private static async Task<WebApplicationFactory<Program>> CreateFactoryAsync()
    {
        var hmiModelDir = Directory.CreateTempSubdirectory("st4i-hmi-tag-model-").FullName;
        var hmiTagsDir = Directory.CreateTempSubdirectory("st4i-hmi-tag-tags-").FullName;
        var securityDir = Directory.CreateTempSubdirectory("st4i-hmi-tag-security-").FullName;

        await EnvLock.WaitAsync().ConfigureAwait(false);
        var prevHmiModelDir = Environment.GetEnvironmentVariable(ComponentModelStore.EnvVarDir);
        var prevHmiTagsDir = Environment.GetEnvironmentVariable(TagNamespaceStore.EnvVarDir);
        var prevSecurityDir = Environment.GetEnvironmentVariable("ST4I_SECURITY_DIR");
        var prevEnvironment = Environment.GetEnvironmentVariable("ASPNETCORE_ENVIRONMENT");
        try
        {
            Environment.SetEnvironmentVariable(ComponentModelStore.EnvVarDir, hmiModelDir);
            Environment.SetEnvironmentVariable(TagNamespaceStore.EnvVarDir, hmiTagsDir);
            Environment.SetEnvironmentVariable("ST4I_SECURITY_DIR", securityDir);
            // Production, not the default Development: a bare WebApplicationFactory<Program> loads the
            // SDK's Static Web Assets manifest (baked with this project's own absolute source-tree wwwroot
            // path) and throws before a single request runs — see HmiModelWiringTests' own comment.
            Environment.SetEnvironmentVariable("ASPNETCORE_ENVIRONMENT", "Production");

            var factory = new WebApplicationFactory<Program>();
            _ = factory.Server; // force the host to build NOW, while the overrides above are still live.
            return factory;
        }
        finally
        {
            Environment.SetEnvironmentVariable(ComponentModelStore.EnvVarDir, prevHmiModelDir);
            Environment.SetEnvironmentVariable(TagNamespaceStore.EnvVarDir, prevHmiTagsDir);
            Environment.SetEnvironmentVariable("ST4I_SECURITY_DIR", prevSecurityDir);
            Environment.SetEnvironmentVariable("ASPNETCORE_ENVIRONMENT", prevEnvironment);
            EnvLock.Release();
        }
    }

    private static async Task<(WebApplicationFactory<Program> Factory, HttpClient Engineer, HttpClient Operator)>
        NewFactoryWithUsersAsync(string suffix)
    {
        var factory = await CreateFactoryAsync().ConfigureAwait(false);

        using (var bootstrapClient = factory.CreateClient())
        {
            using var bootstrap = await bootstrapClient.PostAsJsonAsync(
                "/v1/auth/bootstrap",
                new { username = $"tag-admin-{suffix}", password = "AdminPass123!", displayName = (string?)null },
                JsonOptions).ConfigureAwait(false);
            Assert.Equal(HttpStatusCode.OK, bootstrap.StatusCode);
        }

        await CreateUserAsync(factory, $"tag-engineer-{suffix}", "EngineerPass123!", Roles.Engineer).ConfigureAwait(false);
        await CreateUserAsync(factory, $"tag-operator-{suffix}", "OperatorPass123!", Roles.Operator).ConfigureAwait(false);

        var engineer = await LoginAsAsync(factory, $"tag-engineer-{suffix}", "EngineerPass123!").ConfigureAwait(false);
        var operatorClient = await LoginAsAsync(factory, $"tag-operator-{suffix}", "OperatorPass123!").ConfigureAwait(false);

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

    // ─────────────────────────────────────────────────────────────────────
    // Fixtures — same shape as TagNamespaceStoreTests/HmiModelEndpointsTests.
    // ─────────────────────────────────────────────────────────────────────

    private static TagDescriptor ReadTag(string path, bool backedByDriver = false) =>
        new(path, "float", "Nm", 0, 100, null, "r", null, new TagSource("simulated"), backedByDriver);

    private static TagDescriptor WritableTag(string path, string? policyAction = "machine.setpoint") =>
        new(path, "float", "Nm", 0, 100, null, "rw", policyAction, new TagSource("simulated"), true);

    /// <summary>A minimal VALID namespace: one read tag, one writable tag that carries its policyAction,
    /// so it never trips §5 by accident.</summary>
    private static TagNamespaceDocument ValidNs(string machineCode) =>
        new(1, machineCode, new[]
        {
            ReadTag($"{machineCode}/spindle/speed"),
            WritableTag($"{machineCode}/spindle/torque"),
        });

    // ═════════════════════════════════════════════════════════════════════
    // §5-bis vs 404 — the two answers the brief says must BOTH be pinned, in ONE test, because a test that
    // only checks one side lets the other drift. Asking for a specific tag that does not exist is NOT
    // FOUND; asking for the namespace of a machine that has declared nothing is EMPTY. That difference is
    // a sellability invariant (a machine that has declared nothing is a valid product state), not a
    // stylistic choice, and it is the whole reason these two routes answer differently.
    // ═════════════════════════════════════════════════════════════════════

    [Fact]
    public async Task An_undeclared_machine_is_empty_200_while_an_unknown_tag_path_is_404()
    {
        var (factory, _, operatorClient) = await NewFactoryWithUsersAsync("empty-vs-404");
        await using var _f = factory;
        using var operatorC = operatorClient;

        using (var byMachine = await operatorC.GetAsync("/v1/tags?machine=NOPE-01"))
        {
            Assert.Equal(HttpStatusCode.OK, byMachine.StatusCode);
            var doc = await byMachine.Content.ReadFromJsonAsync<TagNamespaceDocument>(HmiContractJson.Options);
            Assert.NotNull(doc);
            Assert.Equal("NOPE-01", doc!.MachineCode);
            Assert.Empty(doc.Tags);
        }

        using (var byPath = await operatorC.GetAsync("/v1/tags/by-path/NOPE-01/spindle/speed"))
        {
            Assert.Equal(HttpStatusCode.NotFound, byPath.StatusCode);
            var error = await byPath.Content.ReadFromJsonAsync<ApiErrorDto>(HmiContractJson.Options);
            Assert.NotNull(error);
            Assert.False(string.IsNullOrWhiteSpace(error!.Error));
        }
    }

    // ═════════════════════════════════════════════════════════════════════
    // PUT → GET round trip, and the catch-all route.
    // ═════════════════════════════════════════════════════════════════════

    [Fact]
    public async Task Put_ThenGet_RoundTripsTheExactNamespace()
    {
        var (factory, engineer, operatorClient) = await NewFactoryWithUsersAsync("roundtrip");
        await using var _f = factory;
        using var engineerC = engineer;
        using var operatorC = operatorClient;

        using (var put = await engineerC.PutAsJsonAsync("/v1/tags/SCRW-01", ValidNs("SCRW-01"), HmiContractJson.Options))
        {
            Assert.Equal(HttpStatusCode.OK, put.StatusCode);
            var result = await put.Content.ReadFromJsonAsync<PutNamespaceResultDto>(HmiContractJson.Options);
            Assert.Equal("SCRW-01", result!.MachineCode);
            Assert.Equal(2, result.TagCount);
        }

        using var get = await operatorC.GetAsync("/v1/tags?machine=SCRW-01");
        Assert.Equal(HttpStatusCode.OK, get.StatusCode);
        var back = await get.Content.ReadFromJsonAsync<TagNamespaceDocument>(HmiContractJson.Options);
        Assert.Equal("SCRW-01", back!.MachineCode);
        Assert.Equal(2, back.Tags.Count);
        Assert.Contains(back.Tags, t => t.Path == "SCRW-01/spindle/torque" && t.Access == "rw");
    }

    /// <summary>🔴 The trap the brief names by name: a tag <c>path</c> CONTAINS <c>/</c>, so the route must
    /// be catch-all <c>{**path}</c>. A conventional <c>{path}</c> parameter matches a single segment and
    /// returns 404 for every tag that has more than one — i.e. for every real tag. Pinned with a genuinely
    /// THREE-segment path, because a two-segment one would pass against a <c>{a}/{b}</c> route too.</summary>
    [Fact]
    public async Task GetByPath_FindsATagWhosePathHasThreeSegments()
    {
        var (factory, engineer, operatorClient) = await NewFactoryWithUsersAsync("by-path-3seg");
        await using var _f = factory;
        using var engineerC = engineer;
        using var operatorC = operatorClient;

        Assert.Equal(
            HttpStatusCode.OK,
            (await engineerC.PutAsJsonAsync("/v1/tags/SCRW-01", ValidNs("SCRW-01"), HmiContractJson.Options)).StatusCode);

        using var get = await operatorC.GetAsync("/v1/tags/by-path/SCRW-01/spindle/torque");

        Assert.Equal(HttpStatusCode.OK, get.StatusCode);
        var tag = await get.Content.ReadFromJsonAsync<TagDescriptor>(HmiContractJson.Options);
        Assert.Equal("SCRW-01/spindle/torque", tag!.Path);
        Assert.Equal("rw", tag.Access);
        Assert.Equal("machine.setpoint", tag.PolicyAction);
    }

    /// <summary>🔴 The ruling this endpoint exists under, from fix round 5 of Task 1: <b>a tag path is NOT
    /// derivable from a machine code — look one up, never compose one.</b>
    /// <c>CanonicalizingTagNamespaceStore.FindTagAsync</c> deliberately does NOT canonicalise, because
    /// <c>tag_index.path</c> is a global primary key with no machine-code-prefix requirement and
    /// <c>ModelIntegrity.IsPathPrefix</c> is Ordinal by design. This test is that ruling made mechanical at
    /// the HTTP surface: the machine code is case-INSENSITIVE (the two <c>?machine=</c> spellings below
    /// find one namespace) while the tag path is case-SENSITIVE (the upper-cased path does NOT resolve).
    /// If a future round "helpfully" canonicalises the path's first segment, this goes red.</summary>
    [Fact]
    public async Task A_machine_code_is_case_insensitive_but_a_tag_path_is_not()
    {
        var (factory, engineer, operatorClient) = await NewFactoryWithUsersAsync("path-case");
        await using var _f = factory;
        using var engineerC = engineer;
        using var operatorC = operatorClient;

        // Declared through a LOWERCASE route, with lowercase paths.
        var ns = new TagNamespaceDocument(1, "find-01", new[] { ReadTag("find-01/spindle/speed") });
        Assert.Equal(
            HttpStatusCode.OK,
            (await engineerC.PutAsJsonAsync("/v1/tags/find-01", ns, HmiContractJson.Options)).StatusCode);

        // The MACHINE CODE resolves at any spelling — one identity, canonicalised at the store seam.
        foreach (var spelling in new[] { "find-01", "FIND-01", "FiNd-01" })
        {
            using var byMachine = await operatorC.GetAsync($"/v1/tags?machine={spelling}");
            var doc = await byMachine.Content.ReadFromJsonAsync<TagNamespaceDocument>(HmiContractJson.Options);
            Assert.Equal("FIND-01", doc!.MachineCode);
            Assert.Single(doc.Tags);
            // ...and the tag path inside it is NOT rewritten to match. The two halves disagreeing about
            // the machine's spelling is the documented, deliberate consequence (MEDIUM-3, fix round 4).
            Assert.Equal("find-01/spindle/speed", doc.Tags[0].Path);
        }

        // The PATH does not. Composing `{canonicalMachineCode}/spindle/speed` MISSES — which is exactly why
        // the rule is "look a path up, never compose one".
        using (var composed = await operatorC.GetAsync("/v1/tags/by-path/FIND-01/spindle/speed"))
        {
            Assert.Equal(HttpStatusCode.NotFound, composed.StatusCode);
        }

        using (var actual = await operatorC.GetAsync("/v1/tags/by-path/find-01/spindle/speed"))
        {
            Assert.Equal(HttpStatusCode.OK, actual.StatusCode);
        }
    }

    // ═════════════════════════════════════════════════════════════════════
    // §5 refusal, and P2 — a rejected body leaves no record.
    // ═════════════════════════════════════════════════════════════════════

    [Fact]
    public async Task Put_WritableTagWithoutPolicyAction_Gets400_AndTheMachineStaysUnloaded()
    {
        var (factory, engineer, _) = await NewFactoryWithUsersAsync("rw-no-policy");
        await using var _f = factory;
        using var engineerC = engineer;

        var bad = new TagNamespaceDocument(1, "SCRW-02", new[] { WritableTag("SCRW-02/spindle/torque", policyAction: null) });

        using (var put = await engineerC.PutAsJsonAsync("/v1/tags/SCRW-02", bad, HmiContractJson.Options))
        {
            Assert.Equal(HttpStatusCode.BadRequest, put.StatusCode);
            var error = await put.Content.ReadFromJsonAsync<ApiErrorDto>(HmiContractJson.Options);
            Assert.Contains("policyAction", error!.Error, StringComparison.Ordinal);
        }

        // P2 at BOTH read surfaces this task adds.
        using (var get = await engineerC.GetAsync("/v1/tags?machine=SCRW-02"))
        {
            Assert.Equal(HttpStatusCode.OK, get.StatusCode);
            var back = await get.Content.ReadFromJsonAsync<TagNamespaceDocument>(HmiContractJson.Options);
            Assert.Empty(back!.Tags);
        }

        using (var byPath = await engineerC.GetAsync("/v1/tags/by-path/SCRW-02/spindle/torque"))
        {
            Assert.Equal(HttpStatusCode.NotFound, byPath.StatusCode);
        }
    }

    // ═════════════════════════════════════════════════════════════════════
    // The ?machine= filter. The coordinator's pre-flight ruling: the brief MANDATES 400 when the filter is
    // missing or empty, and gives the reason — an endpoint that silently returns everything when its
    // filter is absent is how a UI accidentally drags down the whole namespace — but the brief's own test
    // list never pinned it. It is pinned here, INCLUDING the whitespace-only arm, because "" and " " are
    // different doors (fix round 4, MEDIUM-1, measured over exactly this codebase).
    // ═════════════════════════════════════════════════════════════════════

    [Theory]
    [InlineData("/v1/tags")]              // absent entirely
    [InlineData("/v1/tags?machine=")]     // present and empty
    [InlineData("/v1/tags?machine=%20")]  // present and whitespace-only
    [InlineData("/v1/tags?machine=%09")]  // present and a tab
    public async Task GetByMachine_WithoutAUsableFilter_Gets400_NeverEveryMachine(string url)
    {
        var (factory, engineer, operatorClient) = await NewFactoryWithUsersAsync($"filter-{Math.Abs(url.GetHashCode())}");
        await using var _f = factory;
        using var engineerC = engineer;
        using var operatorC = operatorClient;

        // Two machines really are loaded, so "returns everything" and "returns nothing" are distinguishable
        // outcomes rather than two shades of empty — without this the test would pass against a handler
        // that returned an empty list for a different reason.
        Assert.Equal(
            HttpStatusCode.OK,
            (await engineerC.PutAsJsonAsync("/v1/tags/BULK-01", ValidNs("BULK-01"), HmiContractJson.Options)).StatusCode);
        Assert.Equal(
            HttpStatusCode.OK,
            (await engineerC.PutAsJsonAsync("/v1/tags/BULK-02", ValidNs("BULK-02"), HmiContractJson.Options)).StatusCode);

        using var response = await operatorC.GetAsync(url);

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        var error = await response.Content.ReadFromJsonAsync<ApiErrorDto>(HmiContractJson.Options);
        Assert.NotNull(error);
        Assert.Contains("machine", error!.Error, StringComparison.OrdinalIgnoreCase);

        // And the body carried no tag data at all — not a truncated dump, not one machine's worth.
        var raw = await response.Content.ReadAsStringAsync();
        Assert.DoesNotContain("BULK-01/spindle", raw, StringComparison.Ordinal);
        Assert.DoesNotContain("BULK-02/spindle", raw, StringComparison.Ordinal);
    }

    // ═════════════════════════════════════════════════════════════════════
    // BackedByDriverCount — a COUNT OF A DATA FIELD in this task, and nothing more (see this class's
    // "does not measure" list, item 3).
    // ═════════════════════════════════════════════════════════════════════

    [Fact]
    public async Task Put_ReportsTagCountAndBackedByDriverCount()
    {
        var (factory, engineer, _) = await NewFactoryWithUsersAsync("counts");
        await using var _f = factory;
        using var engineerC = engineer;

        // Three tags, exactly two of them declaring isBackedByDriver:true — so a handler that returned
        // Tags.Count, or 0, or 1, is distinguishable from one that counts the right field.
        var ns = new TagNamespaceDocument(1, "CNT-01", new[]
        {
            ReadTag("CNT-01/a", backedByDriver: true),
            ReadTag("CNT-01/b", backedByDriver: false),
            WritableTag("CNT-01/c"), // WritableTag declares isBackedByDriver: true
        });

        using var put = await engineerC.PutAsJsonAsync("/v1/tags/CNT-01", ns, HmiContractJson.Options);

        Assert.Equal(HttpStatusCode.OK, put.StatusCode);
        var result = await put.Content.ReadFromJsonAsync<PutNamespaceResultDto>(HmiContractJson.Options);
        Assert.Equal("CNT-01", result!.MachineCode);
        Assert.Equal(3, result.TagCount);
        Assert.Equal(2, result.BackedByDriverCount);
    }

    // ═════════════════════════════════════════════════════════════════════
    // RBAC end-to-end — a REAL logged-in Operator over the REAL auth pipeline. See this class's doc comment
    // for why this is NOT the metadata census (that is RbacPolicyTests).
    // ═════════════════════════════════════════════════════════════════════

    [Fact]
    public async Task Operator_CanReadBothRoutes_ButCannotPut()
    {
        var (factory, engineer, operatorClient) = await NewFactoryWithUsersAsync("rbac");
        await using var _f = factory;
        using var engineerC = engineer;
        using var operatorC = operatorClient;

        Assert.Equal(
            HttpStatusCode.OK,
            (await engineerC.PutAsJsonAsync("/v1/tags/RBAC-01", ValidNs("RBAC-01"), HmiContractJson.Options)).StatusCode);

        Assert.Equal(HttpStatusCode.OK, (await operatorC.GetAsync("/v1/tags?machine=RBAC-01")).StatusCode);
        Assert.Equal(HttpStatusCode.OK, (await operatorC.GetAsync("/v1/tags/by-path/RBAC-01/spindle/speed")).StatusCode);

        using var put = await operatorC.PutAsJsonAsync("/v1/tags/RBAC-02", ValidNs("RBAC-02"), HmiContractJson.Options);
        Assert.Equal(HttpStatusCode.Forbidden, put.StatusCode);
    }

    // ═════════════════════════════════════════════════════════════════════
    // 🔴 P1 — NO CLIENT-AUTHORED BODY MAY PRODUCE A 500.
    //
    // Re-established for THIS document type rather than inherited from Task 1's: TagNamespaceDocument has a
    // different field set from ComponentModelDocument, and this endpoint is the FIRST HTTP traffic that
    // ContractInvariants.Validate(TagNamespaceDocument)'s element-field closure has ever received — that
    // closure was justified by this very task ("leaving this hole here would have shipped it on that
    // task's day one"), so it is probed, not assumed.
    //
    // The surface, enumerated from the frozen records rather than from memory:
    //   numeric  — schemaVersion (int), engMin/engMax (double?), source.scale (double?),
    //              source.unitId/source.register (int?)
    //   string   — machineCode, path, dataType, unit?, access, policyAction?, source.kind,
    //              source.{nodeId,topic,jsonPath,expr}?, enumValues[]
    //   struct   — tags (list) and its elements, source (object), isBackedByDriver (bool)
    // Every one of them is attacked below, as RAW JSON so System.Text.Json's own parser produces the value
    // exactly as a client would.
    // ═════════════════════════════════════════════════════════════════════

    public static TheoryData<string, string> HostileTagNamespaceBodies() => new()
    {
        // ── the three non-finite doubles this contract exposes. Reachable over HTTP for the FIRST time in
        // this task: ContractInvariants gained these checks in fix round 4 with no route to exercise them.
        { "engMin-positive-infinity", Body("\"engMin\":1e400,\"engMax\":1") },
        { "engMin-negative-infinity", Body("\"engMin\":-1e400,\"engMax\":1") },
        { "engMax-positive-infinity", Body("\"engMin\":0,\"engMax\":1e400") },
        { "engMax-overflow-decade",   Body("\"engMin\":0,\"engMax\":1e309") },
        { "scale-positive-infinity",  Body("\"source\":{\"kind\":\"modbus\",\"scale\":1e400}") },
        { "scale-negative-infinity",  Body("\"source\":{\"kind\":\"modbus\",\"scale\":-1e400}") },
        // ── integer overflow on every int the contract carries: binder rejection, not a crash.
        { "schemaVersion-overflow",   "{\"schemaVersion\":99999999999999999999,\"machineCode\":\"P1-01\",\"tags\":[]}" },
        { "unitId-overflow",          Body("\"source\":{\"kind\":\"modbus\",\"unitId\":99999999999999999999}") },
        { "register-overflow",        Body("\"source\":{\"kind\":\"modbus\",\"register\":-99999999999999999999}") },
        // ── the strings the store BINDS as SQL parameters, and the ones that gate §5.
        { "path-null",                Body("\"path\":null") },
        { "path-whitespace",          Body("\"path\":\"   \"") },
        { "access-null",              Body("\"access\":null") },
        { "access-whitespace",        Body("\"access\":\"\\t\"") },
        { "rw-policyAction-null",     Body("\"access\":\"rw\",\"policyAction\":null") },
        { "rw-policyAction-blank",    Body("\"access\":\"rw\",\"policyAction\":\" \"") },
        { "rw-policyAction-nbsp",     Body("\"access\":\"rw\",\"policyAction\":\"\\u00a0\"") },
        // ── the strings that are DECLARED non-nullable and documented as null-tolerant. These must be 200
        //    or 400 — never 500 — and the point of attacking them is that the documentation says they are
        //    safe, which is a claim, not a measurement.
        { "dataType-null",            Body("\"dataType\":null") },
        { "source-null",              Body("\"source\":null") },
        { "source-kind-null",         Body("\"source\":{\"kind\":null}") },
        { "unit-null",                Body("\"unit\":null") },
        { "enumValues-with-null",     Body("\"enumValues\":[null,\"a\"]") },
        // ── collection shapes.
        { "tags-null",                "{\"schemaVersion\":1,\"machineCode\":\"P1-01\",\"tags\":null}" },
        { "tags-element-null",        "{\"schemaVersion\":1,\"machineCode\":\"P1-01\",\"tags\":[null]}" },
        { "tags-element-empty",       "{\"schemaVersion\":1,\"machineCode\":\"P1-01\",\"tags\":[{}]}" },
        { "tags-omitted",             "{\"schemaVersion\":1,\"machineCode\":\"P1-01\"}" },
        { "tags-wrong-kind",          "{\"schemaVersion\":1,\"machineCode\":\"P1-01\",\"tags\":{}}" },
        // ── the document's own identity.
        { "machineCode-null",         "{\"schemaVersion\":1,\"machineCode\":null,\"tags\":[]}" },
        { "machineCode-blank",        "{\"schemaVersion\":1,\"machineCode\":\"  \",\"tags\":[]}" },
        { "machineCode-wrong-kind",   "{\"schemaVersion\":1,\"machineCode\":123,\"tags\":[]}" },
        // ── the duplicate-path rule, which exists precisely so a client body cannot reach SQLite and
        //    become a 500 (ContractInvariants' own doc comment says so).
        { "duplicate-path-in-one-doc",
            "{\"schemaVersion\":1,\"machineCode\":\"P1-01\",\"tags\":[" +
            "{\"path\":\"P1-01/x\",\"dataType\":\"float\",\"access\":\"r\",\"source\":{\"kind\":\"simulated\"},\"isBackedByDriver\":false}," +
            "{\"path\":\"P1-01/x\",\"dataType\":\"float\",\"access\":\"r\",\"source\":{\"kind\":\"simulated\"},\"isBackedByDriver\":false}]}" },
        // ── malformed / degenerate envelopes.
        { "empty-body",               "" },
        { "literal-null",             "null" },
        { "not-an-object",            "[]" },
        { "deep-nesting",             "{\"schemaVersion\":1,\"machineCode\":\"P1-01\",\"tags\":" + new string('[', 200) + new string(']', 200) + "}" },
        { "lone-surrogate-in-path",   Body("\"path\":\"P1-01/\\ud800\"") },
    };

    /// <summary>One hostile tag around an otherwise valid document — so each body differs from a legal one
    /// in exactly the field under attack, and a 400 can be attributed to that field rather than to some
    /// other malformation.</summary>
    private static string Body(string tagOverride)
    {
        const string baseTag =
            "\"path\":\"P1-01/spindle/torque\",\"dataType\":\"float\",\"unit\":\"Nm\"," +
            "\"engMin\":0,\"engMax\":10,\"access\":\"r\",\"policyAction\":null," +
            "\"source\":{\"kind\":\"simulated\"},\"isBackedByDriver\":false";

        // The override goes LAST so System.Text.Json's last-wins duplicate handling replaces the base value.
        return "{\"schemaVersion\":1,\"machineCode\":\"P1-01\",\"tags\":[{" + baseTag + "," + tagOverride + "}]}";
    }

    [Theory]
    [MemberData(nameof(HostileTagNamespaceBodies))]
    public async Task No_client_authored_body_produces_a_500_and_no_rejected_body_leaves_a_record(string label, string json)
    {
        var (factory, engineer, _) = await NewFactoryWithUsersAsync($"p1-{label}");
        await using var _f = factory;
        using var engineerC = engineer;

        HttpStatusCode status;
        using (var content = new StringContent(json, Encoding.UTF8, "application/json"))
        using (var put = await engineerC.PutAsync("/v1/tags/P1-01", content))
        {
            status = put.StatusCode;
        }

        // P1: any 2xx or 4xx is an ANSWER. A 5xx is the defect — and so is an escaping exception, which
        // TestServer rethrows to the caller instead of synthesising the 500 Kestrel would produce, so the
        // await above would have thrown rather than reached here.
        Assert.True((int)status < 500, $"body '{label}' produced {(int)status} — P1 says no client-authored body may.");

        // P2: if it was rejected, nothing may have been recorded — checked at BOTH read surfaces this task
        // adds, because a half-write visible through only one of them is still a half-write.
        if ((int)status >= 400)
        {
            using var byMachine = await engineerC.GetAsync("/v1/tags?machine=P1-01");
            Assert.Equal(HttpStatusCode.OK, byMachine.StatusCode);
            var doc = await byMachine.Content.ReadFromJsonAsync<TagNamespaceDocument>(HmiContractJson.Options);
            Assert.Empty(doc!.Tags);

            using var byPath = await engineerC.GetAsync("/v1/tags/by-path/P1-01/spindle/torque");
            Assert.Equal(HttpStatusCode.NotFound, byPath.StatusCode);
            return;
        }

        // 🔴 P1 DOES NOT END AT THE WRITE. Seven of these bodies are ACCEPTED (measured: dataType-null,
        // source-null, source-kind-null, unit-null, enumValues-with-null, and the two lenient
        // machineCode-null/blank arms the route/body guard fills from the route). Each is a field
        // ContractInvariants' BOUNDARY paragraph declares null-TOLERANT — which is a claim about what
        // happens LATER, not just at the door. A body that stores cleanly and then makes a subsequent GET
        // throw would be P1 broken with a delay, and it would be worse than an immediate 500 because the
        // poisoned row outlives the request that created it. So every accepted body is read back through
        // BOTH routes, and the document must still deserialise into the frozen record.
        using (var byMachine = await engineerC.GetAsync("/v1/tags?machine=P1-01"))
        {
            Assert.True((int)byMachine.StatusCode < 500,
                $"body '{label}' was accepted at {(int)status} and then made GET /v1/tags?machine= answer " +
                $"{(int)byMachine.StatusCode} — a stored row that poisons a later read is still a P1 break.");
            var doc = await byMachine.Content.ReadFromJsonAsync<TagNamespaceDocument>(HmiContractJson.Options);
            Assert.NotNull(doc);
        }

        using (var byPath = await engineerC.GetAsync("/v1/tags/by-path/P1-01/spindle/torque"))
        {
            Assert.True((int)byPath.StatusCode < 500,
                $"body '{label}' was accepted at {(int)status} and then made GET /v1/tags/by-path/ answer " +
                $"{(int)byPath.StatusCode}.");
        }
    }

    // ═════════════════════════════════════════════════════════════════════
    // 🔴 THE P1 HAZARD THIS DOCUMENT TYPE HAS AND THE COMPONENT TREE DOES NOT — and which the brief does
    // not mention.
    //
    // tag_index.path is a GLOBAL primary key across every machine, and TagNamespaceStore.PutAsync loads it
    // with a bare INSERT. ContractInvariants' duplicate-path rule is explicitly scoped to ONE document and
    // says so in its own doc comment: "Luật này KHÔNG bắt được gì: hai MÁY KHÁC NHAU cùng khai một path …
    // Trường hợp ấy vẫn ném SqliteException ở store". Before this task there was no HTTP route that could
    // reach it. Now there is, and an UNMAPPED SqliteException is a 500 on a client-authored body — P1,
    // measured false, by a body that violates no §5 rule at all.
    //
    // 409 rather than 400, matching this codebase's own established answer for a UNIQUE-constraint
    // collision (UserEndpoints.cs:106 names this exact shape: "a raw UNIQUE-constraint SqliteException (an
    // unhandled 500), not a clean 409"): the document is well-formed and the SAME body would succeed
    // against a database where the other machine had not claimed the path, so it is a conflict with
    // server state, not a malformed request.
    //
    // NOT measured here: the concurrent case. Two simultaneous PUTs claiming one path race inside SQLite,
    // and a sequential test cannot see it — the transaction still rolls back, so P2 holds either way, but
    // which of the two callers gets the 409 is not pinned.
    // ═════════════════════════════════════════════════════════════════════

    [Fact]
    public async Task Put_ANamespaceClaimingAPathAnotherMachineOwns_Gets409_NotA500_AndTheOwnerIsUntouched()
    {
        var (factory, engineer, _) = await NewFactoryWithUsersAsync("cross-machine-path");
        await using var _f = factory;
        using var engineerC = engineer;

        var owner = new TagNamespaceDocument(1, "OWNER-01", new[] { ReadTag("shared/line3/temp") });
        Assert.Equal(
            HttpStatusCode.OK,
            (await engineerC.PutAsJsonAsync("/v1/tags/OWNER-01", owner, HmiContractJson.Options)).StatusCode);

        // A DIFFERENT machine claiming the same global path. Nothing about this document violates §5.
        var claimant = new TagNamespaceDocument(1, "CLAIM-01", new[]
        {
            ReadTag("CLAIM-01/own/tag"),
            ReadTag("shared/line3/temp"),
        });

        using (var put = await engineerC.PutAsJsonAsync("/v1/tags/CLAIM-01", claimant, HmiContractJson.Options))
        {
            Assert.Equal(HttpStatusCode.Conflict, put.StatusCode);
            var error = await put.Content.ReadFromJsonAsync<ApiErrorDto>(HmiContractJson.Options);
            Assert.NotNull(error);
            Assert.Contains("shared/line3/temp", error!.Error, StringComparison.Ordinal);
        }

        // P2 — the rejected PUT wrote NOTHING for the claimant...
        using (var claimantGet = await engineerC.GetAsync("/v1/tags?machine=CLAIM-01"))
        {
            var doc = await claimantGet.Content.ReadFromJsonAsync<TagNamespaceDocument>(HmiContractJson.Options);
            Assert.Empty(doc!.Tags);
        }
        using (var claimantOwnTag = await engineerC.GetAsync("/v1/tags/by-path/CLAIM-01/own/tag"))
        {
            Assert.Equal(HttpStatusCode.NotFound, claimantOwnTag.StatusCode);
        }

        // ...and did not damage the OWNER, whose namespace and index row must be exactly as before.
        using (var ownerGet = await engineerC.GetAsync("/v1/tags?machine=OWNER-01"))
        {
            var doc = await ownerGet.Content.ReadFromJsonAsync<TagNamespaceDocument>(HmiContractJson.Options);
            Assert.Single(doc!.Tags);
            Assert.Equal("shared/line3/temp", doc.Tags[0].Path);
        }
        using (var ownerByPath = await engineerC.GetAsync("/v1/tags/by-path/shared/line3/temp"))
        {
            Assert.Equal(HttpStatusCode.OK, ownerByPath.StatusCode);
        }
    }

    /// <summary>The case that must NOT be mistaken for the collision above, and the reason the guard cannot
    /// simply be "reject any path that already exists in the index": re-declaring a machine's OWN namespace
    /// re-uses its own paths, and that is the ordinary edit path. <c>TagNamespaceStore.PutAsync</c> deletes
    /// this machine's index rows and re-inserts them inside ONE transaction, so its own paths never collide
    /// with themselves — and a retired tag genuinely disappears from the index.</summary>
    [Fact]
    public async Task Put_ReDeclaringAMachinesOwnNamespace_ReusesItsOwnPaths_AndRetiresRemovedOnes()
    {
        var (factory, engineer, _) = await NewFactoryWithUsersAsync("redeclare");
        await using var _f = factory;
        using var engineerC = engineer;

        var first = new TagNamespaceDocument(1, "REDEC-01", new[]
        {
            ReadTag("REDEC-01/keep"),
            ReadTag("REDEC-01/retire"),
        });
        Assert.Equal(
            HttpStatusCode.OK,
            (await engineerC.PutAsJsonAsync("/v1/tags/REDEC-01", first, HmiContractJson.Options)).StatusCode);

        // Same machine, same 'keep' path, 'retire' dropped, one new path added.
        var second = new TagNamespaceDocument(1, "REDEC-01", new[]
        {
            ReadTag("REDEC-01/keep"),
            ReadTag("REDEC-01/added"),
        });
        Assert.Equal(
            HttpStatusCode.OK,
            (await engineerC.PutAsJsonAsync("/v1/tags/REDEC-01", second, HmiContractJson.Options)).StatusCode);

        Assert.Equal(HttpStatusCode.OK, (await engineerC.GetAsync("/v1/tags/by-path/REDEC-01/keep")).StatusCode);
        Assert.Equal(HttpStatusCode.OK, (await engineerC.GetAsync("/v1/tags/by-path/REDEC-01/added")).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await engineerC.GetAsync("/v1/tags/by-path/REDEC-01/retire")).StatusCode);
    }

    /// <summary>The route/body machine-code guard, matching <c>HmiModelEndpoints.PutAsync</c>'s and
    /// <c>ConfigEndpoints</c>' established shape rather than inventing a fourth spelling: fill the identity
    /// in when the body omits it, REJECT when the body names a materially different machine. Without the
    /// rejection arm, a PUT to <c>/v1/tags/INTENDED</c> carrying <c>machineCode: "VICTIM"</c> silently
    /// overwrites VICTIM's whole namespace while reporting success — HIGH-1 of Task 1, one contract over.</summary>
    [Fact]
    public async Task Put_BodyMachineCodeMismatchingTheRoute_Gets400_AndTheVictimIsUntouched()
    {
        var (factory, engineer, _) = await NewFactoryWithUsersAsync("route-body-guard");
        await using var _f = factory;
        using var engineerC = engineer;

        Assert.Equal(
            HttpStatusCode.OK,
            (await engineerC.PutAsJsonAsync("/v1/tags/VICTIM-01", ValidNs("VICTIM-01"), HmiContractJson.Options)).StatusCode);

        var attack = new TagNamespaceDocument(1, "VICTIM-01", new[] { ReadTag("VICTIM-01/attacker") });
        using (var put = await engineerC.PutAsJsonAsync("/v1/tags/INTENDED-01", attack, HmiContractJson.Options))
        {
            Assert.Equal(HttpStatusCode.BadRequest, put.StatusCode);
        }

        using (var victim = await engineerC.GetAsync("/v1/tags?machine=VICTIM-01"))
        {
            var doc = await victim.Content.ReadFromJsonAsync<TagNamespaceDocument>(HmiContractJson.Options);
            Assert.Equal(2, doc!.Tags.Count); // untouched — still ValidNs's two tags
        }
        using (var intended = await engineerC.GetAsync("/v1/tags?machine=INTENDED-01"))
        {
            var doc = await intended.Content.ReadFromJsonAsync<TagNamespaceDocument>(HmiContractJson.Options);
            Assert.Empty(doc!.Tags);
        }
    }

    [Fact]
    public async Task Put_BodyMachineCodeOmitted_IsFilledFromTheRoute()
    {
        var (factory, engineer, _) = await NewFactoryWithUsersAsync("omitted-code");
        await using var _f = factory;
        using var engineerC = engineer;

        const string json = "{\"schemaVersion\":1,\"tags\":[{\"path\":\"FILLED-01/x\",\"dataType\":\"float\"," +
                            "\"access\":\"r\",\"source\":{\"kind\":\"simulated\"},\"isBackedByDriver\":false}]}";
        using var content = new StringContent(json, Encoding.UTF8, "application/json");
        using var put = await engineerC.PutAsync("/v1/tags/FILLED-01", content);

        Assert.Equal(HttpStatusCode.OK, put.StatusCode);
        var result = await put.Content.ReadFromJsonAsync<PutNamespaceResultDto>(HmiContractJson.Options);
        Assert.Equal("FILLED-01", result!.MachineCode);

        // Not just the echo — the write actually landed under FILLED-01 rather than under "".
        using var get = await engineerC.GetAsync("/v1/tags?machine=FILLED-01");
        var doc = await get.Content.ReadFromJsonAsync<TagNamespaceDocument>(HmiContractJson.Options);
        Assert.Single(doc!.Tags);
    }

    /// <summary>The same "absence IS null, never written explicitly" rule Task 1 pins for the component
    /// tree: both read routes must serialise through <see cref="HmiContractJson.Options"/> and not through
    /// the app's ambient per-request options, which do NOT drop nulls on write.
    /// <see cref="TagDescriptor"/> carries four optional fields and <see cref="TagSource"/> seven.</summary>
    [Fact]
    public async Task BothReadRoutes_NeverWriteExplicitNullsForUnsetOptionalFields()
    {
        var (factory, engineer, _) = await NewFactoryWithUsersAsync("no-explicit-nulls");
        await using var _f = factory;
        using var engineerC = engineer;

        var ns = new TagNamespaceDocument(1, "NULLS-01", new[]
        {
            new TagDescriptor("NULLS-01/x", "bool", null, null, null, null, "r", null, new TagSource("simulated"), false),
        });
        Assert.Equal(
            HttpStatusCode.OK,
            (await engineerC.PutAsJsonAsync("/v1/tags/NULLS-01", ns, HmiContractJson.Options)).StatusCode);

        foreach (var url in new[] { "/v1/tags?machine=NULLS-01", "/v1/tags/by-path/NULLS-01/x" })
        {
            using var response = await engineerC.GetAsync(url);
            var raw = await response.Content.ReadAsStringAsync();

            foreach (var field in new[] { "unit", "engMin", "engMax", "enumValues", "policyAction", "register", "scale", "topic" })
            {
                Assert.DoesNotContain($"\"{field}\":null", raw, StringComparison.Ordinal);
            }
        }
    }
}
