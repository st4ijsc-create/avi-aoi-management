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
/// Endpoint cây linh kiện.
///
/// <para>🔴 <b>Đoạn "KHÔNG đo" dưới đây được SỬA ở vòng review 1 (MEDIUM finding: bản gốc — nguyên văn
/// theo brief — nói NGƯỢC với việc lớp này thực sự làm).</b> Bản gốc tự nhận "không đo phân quyền thật
/// đầu-cuối", trong khi <see cref="Operator_CannotPut_Gets403"/> và
/// <see cref="Operator_CanReadAllFourGetRoutes"/> đăng nhập một Operator THẬT qua pipeline auth THẬT
/// (cookie, <see cref="WebApplicationFactory{Program}"/>) và đo chính xác điều đó — đầu-cuối, không phải
/// ghim metadata. Và bản gốc tự nhận "chỉ ghim ĐÚNG policy được gắn vào từng route", trong khi không có
/// dòng nào trong file này đọc <c>EndpointDataSource</c>/<c>IAuthorizeData</c> — đó là việc của
/// <c>RbacPolicyTests</c>. Diện đo (coverage) của mười bài test không đổi; câu mô tả diện đo thì đổi để
/// khớp với nó.</para>
///
/// <para><b>KHÔNG đo cái gì (đã sửa):</b> (1) KHÔNG đo rằng đúng CHUỖI POLICY được gắn vào metadata của
/// từng route (đó là <c>RbacPolicyTests</c>'s <c>EndpointDataSource</c> sweep — nơi DUY NHẤT trong repo
/// này ghim "Engineer, never Admin" như một thuộc tính metadata). Lớp này đo điều khác, thật hơn: một
/// Operator đã đăng nhập có thực sự bị chặn (403) ở PUT và thực sự đi qua được bốn route đọc hay không —
/// qua đúng middleware auth mà production dùng; (2) không đo toàn vẹn tham chiếu sâu — chỉ đo rằng cảnh
/// báo được TRẢ RA, còn nội dung từng luật là `ModelIntegrityTests` của 0a; (3) không đo tài liệu hợp lệ
/// theo JSON Schema.</para>
///
/// <para><b>Real-pipeline (<see cref="WebApplicationFactory{Program}"/>), same convention as
/// <c>AssetEndpointsTests</c>.</b> Unlike <c>HmiModelWiringTests</c> (which relies entirely on
/// <c>TestRunTempRoot</c>'s assembly-wide redirect), this class ALSO sets its own
/// <see cref="ComponentModelStore.EnvVarDir"/>/<see cref="TagNamespaceStore.EnvVarDir"/> per factory —
/// several tests here depend on one machine code being genuinely undeclared, or on a namespace being
/// genuinely absent, and the assembly-wide redirect is shared (and therefore stateful) across every
/// class in this test process.</para>
/// </summary>
[Collection(SecurityEnvVarTests.CollectionName)]
public sealed class HmiModelEndpointsTests
{
    private static readonly SemaphoreSlim EnvLock = new(1, 1);
    private static readonly JsonSerializerOptions JsonOptions = new(JsonSerializerDefaults.Web);

    private static async Task<WebApplicationFactory<Program>> CreateFactoryAsync()
    {
        var hmiModelDir = Directory.CreateTempSubdirectory("st4i-hmi-ep-model-").FullName;
        var hmiTagsDir = Directory.CreateTempSubdirectory("st4i-hmi-ep-tags-").FullName;
        // Every test method here calls BootstrapAdminAsync (POST /v1/auth/bootstrap, which only ever
        // succeeds ONCE against a given security.db — every later call 409s). Without isolating this too,
        // every WebApplicationFactory<Program> in this class would share the ONE security.db
        // TestRunTempRoot's assembly-wide redirect installs, and every test after the first would 409 on
        // its own bootstrap call — exactly the failure this override exists to prevent.
        var securityDir = Directory.CreateTempSubdirectory("st4i-hmi-ep-security-").FullName;

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
            // A bare WebApplicationFactory<Program> defaults to Development, which loads the SDK's Static
            // Web Assets manifest (baked with this project's own absolute source-tree wwwroot path) and
            // throws before a single request runs — see HmiModelWiringTests' own comment for the same fix.
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

    private static async Task BootstrapAdminAsync(WebApplicationFactory<Program> factory, string username, string password)
    {
        using var bootstrapClient = factory.CreateClient();
        using var bootstrap = await bootstrapClient.PostAsJsonAsync(
            "/v1/auth/bootstrap", new { username, password, displayName = (string?)null }, JsonOptions).ConfigureAwait(false);
        Assert.Equal(HttpStatusCode.OK, bootstrap.StatusCode);
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

    /// <summary>Stands up one Engineer client (can PUT and GET) and one Operator client (can only GET) on
    /// the SAME factory/store — most tests here only need one of the two, but several need both against the
    /// same backing SQLite file.</summary>
    private static async Task<(WebApplicationFactory<Program> Factory, HttpClient Engineer, HttpClient Operator)> NewFactoryWithUsersAsync(
        string suffix)
    {
        var factory = await CreateFactoryAsync().ConfigureAwait(false);
        await BootstrapAdminAsync(factory, $"hmi-admin-{suffix}", "AdminPass123!").ConfigureAwait(false);
        await CreateUserAsync(factory, $"hmi-engineer-{suffix}", "EngineerPass123!", Roles.Engineer).ConfigureAwait(false);
        await CreateUserAsync(factory, $"hmi-operator-{suffix}", "OperatorPass123!", Roles.Operator).ConfigureAwait(false);

        var engineer = await LoginAsAsync(factory, $"hmi-engineer-{suffix}", "EngineerPass123!").ConfigureAwait(false);
        var operatorClient = await LoginAsAsync(factory, $"hmi-operator-{suffix}", "OperatorPass123!").ConfigureAwait(false);

        return (factory, engineer, operatorClient);
    }

    // ─────────────────────────────────────────────────────────────────────
    // Fixtures — same shape as ComponentModelStoreTests/TagNamespaceStoreTests.
    // ─────────────────────────────────────────────────────────────────────

    private static ComponentTagDef SimpleTag(string name = "running") =>
        new(name, "in", "bool", null, null, null, null, null);

    private static ComponentTypeDef SimpleType(string typeId) =>
        new(typeId, typeId, new[] { SimpleTag() }, new[] { new ComponentStateDef("running", "running == true", "run") }, "fp.x");

    /// <summary>A minimal, VALID document: one component, one type, no setpoint (so it never trips §5).</summary>
    private static ComponentModelDocument ValidDoc(string machineCode, string typeId = "st4i.motor.spindle") =>
        new(1, machineCode,
            new[] { new ComponentNode("spindle", typeId, "Trục vít", null, $"{machineCode}/spindle") },
            new[] { SimpleType(typeId) });

    /// <summary>A document whose one <c>setpoint</c> tag has neither <c>min</c> nor <c>max</c> — the exact
    /// §5 violation the brief names (<c>ContractInvariants.Validate(ComponentModelDocument)</c>'s
    /// <c>HardBandComponentTagRoles</c> rule).</summary>
    private static ComponentModelDocument DocMissingSetpointBounds(string machineCode)
    {
        var badTag = new ComponentTagDef("torque", "setpoint", "float", null, "Nm", null, null, "machine.setpoint");
        var type = new ComponentTypeDef("st4i.motor.spindle", "Spindle", new[] { badTag }, Array.Empty<ComponentStateDef>(), "fp.x");
        return new ComponentModelDocument(1, machineCode,
            new[] { new ComponentNode("spindle", "st4i.motor.spindle", "Trục vít", null, $"{machineCode}/spindle") },
            new[] { type });
    }

    private static TagNamespaceDocument NamespaceThatDoesNotMatch(string machineCode) =>
        new(1, machineCode, new[]
        {
            new TagDescriptor(
                $"{machineCode}/unrelated/temp", "float", "C", null, null, null, "r", null, new TagSource("simulated"), false),
        });

    // ─────────────────────────────────────────────────────────────────────
    // GET /v1/components/{code} — §5-bis: undeclared is 200 + empty, never 404.
    // ─────────────────────────────────────────────────────────────────────

    [Fact]
    public async Task Get_UnknownMachine_Returns200WithAnEmptyDocument_NotNotFound()
    {
        var (factory, _, operatorClient) = await NewFactoryWithUsersAsync("get-unknown");
        await using var _f = factory;
        using var operatorC = operatorClient;

        using var response = await operatorC.GetAsync("/v1/components/NOPE-01");

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var doc = await response.Content.ReadFromJsonAsync<ComponentModelDocument>(HmiContractJson.Options);
        Assert.NotNull(doc);
        Assert.Equal("NOPE-01", doc!.MachineCode);
        Assert.Empty(doc.Components);
        Assert.Empty(doc.Types);
    }

    // ─────────────────────────────────────────────────────────────────────
    // PUT then GET — round trip.
    // ─────────────────────────────────────────────────────────────────────

    [Fact]
    public async Task Put_ThenGet_RoundTripsTheExactDocument()
    {
        var (factory, engineer, operatorClient) = await NewFactoryWithUsersAsync("roundtrip");
        await using var _f = factory;
        using var engineerC = engineer;
        using var operatorC = operatorClient;

        var doc = ValidDoc("SCRW-01");

        using (var put = await engineerC.PutAsJsonAsync("/v1/components/SCRW-01", doc, HmiContractJson.Options))
        {
            Assert.Equal(HttpStatusCode.OK, put.StatusCode);
            var result = await put.Content.ReadFromJsonAsync<PutModelResultDto>(HmiContractJson.Options);
            Assert.Equal("SCRW-01", result!.MachineCode);
            Assert.Equal(1, result.ComponentCount);
        }

        using (var get = await operatorC.GetAsync("/v1/components/SCRW-01"))
        {
            Assert.Equal(HttpStatusCode.OK, get.StatusCode);
            var back = await get.Content.ReadFromJsonAsync<ComponentModelDocument>(HmiContractJson.Options);
            Assert.Equal("SCRW-01", back!.MachineCode);
            Assert.Single(back.Components);
            Assert.Equal("spindle", back.Components[0].Id);
            Assert.Equal("st4i.motor.spindle", back.Types[0].TypeId);
        }
    }

    // ─────────────────────────────────────────────────────────────────────
    // PUT a §5-invalid document — 400 ApiErrorDto, and the rejection leaves no half-record: a subsequent
    // GET must still come back empty.
    // ─────────────────────────────────────────────────────────────────────

    [Fact]
    public async Task Put_SetpointMissingMinMax_Gets400_AndTheMachineStaysUndeclared()
    {
        var (factory, engineer, _) = await NewFactoryWithUsersAsync("bad-doc");
        await using var _f = factory;
        using var engineerC = engineer;

        var doc = DocMissingSetpointBounds("SCRW-02");

        using (var put = await engineerC.PutAsJsonAsync("/v1/components/SCRW-02", doc, HmiContractJson.Options))
        {
            Assert.Equal(HttpStatusCode.BadRequest, put.StatusCode);
            var error = await put.Content.ReadFromJsonAsync<ApiErrorDto>(HmiContractJson.Options);
            Assert.NotNull(error);
            Assert.False(string.IsNullOrWhiteSpace(error!.Error));

            // Fix round 1, MEDIUM-2 — DocMissingSetpointBounds's one tag trips TWO §5 rules at once (missing
            // `min` AND missing `max`), and the body must carry BOTH, not just the first. Without this pair
            // of assertions, HmiModelEndpoints.PutAsync's `new ApiErrorDto(ex.Message)` could regress to
            // `new ApiErrorDto(ex.Violations[0])` (first violation only) and every test in this file would
            // still pass — this is the assertion that actually makes "every violation, not just the first"
            // load-bearing rather than merely implemented.
            Assert.Contains("thiếu min", error.Error, StringComparison.Ordinal);
            Assert.Contains("thiếu max", error.Error, StringComparison.Ordinal);
        }

        // The rejected PUT must not leave a half-written record behind — the machine is still undeclared.
        using (var get = await engineerC.GetAsync("/v1/components/SCRW-02"))
        {
            Assert.Equal(HttpStatusCode.OK, get.StatusCode);
            var back = await get.Content.ReadFromJsonAsync<ComponentModelDocument>(HmiContractJson.Options);
            Assert.Empty(back!.Components);
        }
    }

    // ─────────────────────────────────────────────────────────────────────
    // PUT a valid document whose tagPrefix matches no tag, WHEN a namespace IS loaded — 200, non-empty
    // Warnings. Losing referential integrity is a WARNING, not a rejection.
    // ─────────────────────────────────────────────────────────────────────

    [Fact]
    public async Task Put_TagPrefixMatchesNoTag_WithNamespaceLoaded_Returns200WithNonEmptyWarnings()
    {
        var (factory, engineer, _) = await NewFactoryWithUsersAsync("warn-loaded");
        await using var _f = factory;
        using var engineerC = engineer;

        // Load a namespace for this machine FIRST — directly through ITagNamespaceStore, the same seam a
        // connector would use (there is no HTTP surface for tag namespaces in this task).
        var tagsStore = factory.Services.GetRequiredService<ITagNamespaceStore>();
        await tagsStore.PutAsync(NamespaceThatDoesNotMatch("SCRW-03"));

        var doc = ValidDoc("SCRW-03"); // tagPrefix "SCRW-03/spindle" — matches nothing in the namespace above.

        using var put = await engineerC.PutAsJsonAsync("/v1/components/SCRW-03", doc, HmiContractJson.Options);

        Assert.Equal(HttpStatusCode.OK, put.StatusCode);
        var result = await put.Content.ReadFromJsonAsync<PutModelResultDto>(HmiContractJson.Options);
        Assert.NotEmpty(result!.Warnings);
    }

    // ─────────────────────────────────────────────────────────────────────
    // PUT the SAME document when the namespace is NOT loaded — 200, EMPTY Warnings. Declaration order is
    // not a constraint (ModelIntegrity.Check's own contract: ns == null silences the tagPrefix check).
    // ─────────────────────────────────────────────────────────────────────

    [Fact]
    public async Task Put_TagPrefixMatchesNoTag_WithNoNamespaceLoaded_Returns200WithEmptyWarnings()
    {
        var (factory, engineer, _) = await NewFactoryWithUsersAsync("warn-unloaded");
        await using var _f = factory;
        using var engineerC = engineer;

        // Deliberately no ITagNamespaceStore.PutAsync call — SCRW-04 has no namespace loaded at all.
        var doc = ValidDoc("SCRW-04");

        using var put = await engineerC.PutAsJsonAsync("/v1/components/SCRW-04", doc, HmiContractJson.Options);

        Assert.Equal(HttpStatusCode.OK, put.StatusCode);
        var result = await put.Content.ReadFromJsonAsync<PutModelResultDto>(HmiContractJson.Options);
        Assert.Empty(result!.Warnings);
    }

    // ─────────────────────────────────────────────────────────────────────
    // GET /v1/component-types — merges Types across every declared machine, one entry per TypeId.
    // ─────────────────────────────────────────────────────────────────────

    [Fact]
    public async Task GetComponentTypes_MergesTypesAcrossMachines_OneEntryPerTypeId()
    {
        var (factory, engineer, operatorClient) = await NewFactoryWithUsersAsync("merge-types");
        await using var _f = factory;
        using var engineerC = engineer;
        using var operatorC = operatorClient;

        // Two machines, sharing ONE typeId ("st4i.motor.spindle" — the shared/common type) plus one typeId
        // unique to each machine, so both "shared, seen once" and "the union of the unique ones" are pinned
        // by a single test.
        var docA = new ComponentModelDocument(1, "SCRW-05",
            new[] { new ComponentNode("spindle", "st4i.motor.spindle", "A", null, "SCRW-05/spindle") },
            new[] { SimpleType("st4i.motor.spindle"), SimpleType("st4i.only.a") });
        var docB = new ComponentModelDocument(1, "SCRW-06",
            new[] { new ComponentNode("spindle", "st4i.motor.spindle", "B", null, "SCRW-06/spindle") },
            new[] { SimpleType("st4i.motor.spindle"), SimpleType("st4i.only.b") });

        Assert.Equal(HttpStatusCode.OK, (await engineerC.PutAsJsonAsync("/v1/components/SCRW-05", docA, HmiContractJson.Options)).StatusCode);
        Assert.Equal(HttpStatusCode.OK, (await engineerC.PutAsJsonAsync("/v1/components/SCRW-06", docB, HmiContractJson.Options)).StatusCode);

        using var get = await operatorC.GetAsync("/v1/component-types");
        Assert.Equal(HttpStatusCode.OK, get.StatusCode);

        var types = await get.Content.ReadFromJsonAsync<List<ComponentTypeDef>>(HmiContractJson.Options);
        Assert.NotNull(types);

        var typeIds = types!.Select(t => t.TypeId).ToList();
        Assert.Equal(typeIds.Count, typeIds.Distinct(StringComparer.Ordinal).Count()); // no typeId twice
        Assert.Contains("st4i.motor.spindle", typeIds);
        Assert.Contains("st4i.only.a", typeIds);
        Assert.Contains("st4i.only.b", typeIds);
        Assert.Equal(1, typeIds.Count(id => id == "st4i.motor.spindle")); // the shared one appears ONCE
    }

    // ─────────────────────────────────────────────────────────────────────
    // PUT is last-writer-wins — the ruling this task's brief does not carry but the dispatcher's own
    // instructions do: no concurrency token exists on the frozen contract, so the second PUT to land simply
    // overwrites the first with no conflict reported to either caller. Pinned here rather than left as a
    // doc-comment-only claim.
    // ─────────────────────────────────────────────────────────────────────

    [Fact]
    public async Task Put_TwiceToTheSameMachine_TheSecondWriteWins_LastWriterWins()
    {
        var (factory, engineer, _) = await NewFactoryWithUsersAsync("last-writer");
        await using var _f = factory;
        using var engineerC = engineer;

        var first = ValidDoc("SCRW-07", typeId: "st4i.first.type");
        var second = ValidDoc("SCRW-07", typeId: "st4i.second.type");

        Assert.Equal(HttpStatusCode.OK, (await engineerC.PutAsJsonAsync("/v1/components/SCRW-07", first, HmiContractJson.Options)).StatusCode);
        Assert.Equal(HttpStatusCode.OK, (await engineerC.PutAsJsonAsync("/v1/components/SCRW-07", second, HmiContractJson.Options)).StatusCode);

        using var get = await engineerC.GetAsync("/v1/components/SCRW-07");
        var back = await get.Content.ReadFromJsonAsync<ComponentModelDocument>(HmiContractJson.Options);

        Assert.Single(back!.Types);
        Assert.Equal("st4i.second.type", back.Types[0].TypeId); // the SECOND write survives — the first is gone.
    }

    // ─────────────────────────────────────────────────────────────────────
    // RBAC end-to-end (fixed at review round 1 — the section header used to say "RBAC metadata" and claim
    // this pins the policy STRING attached to each route; it does not, and never did). These two tests log
    // in as a REAL Operator over the REAL auth pipeline and assert the REAL outcome: 403 on the one write,
    // 200 on all four reads. That is end-to-end enforcement, not metadata. The metadata sweep — the thing
    // that actually inspects EndpointDataSource/IAuthorizeData and pins "Engineer, never Admin" as a
    // property of route registration — is RbacPolicyTests.EveryV1Route_CarriesExactlyTheExpectedPolicyOrAnonymous;
    // that is the ONE place in this repository doing that measurement, and it is not this file.
    // ─────────────────────────────────────────────────────────────────────

    [Fact]
    public async Task Operator_CannotPut_Gets403()
    {
        var (factory, _, operatorClient) = await NewFactoryWithUsersAsync("rbac-put");
        await using var _f = factory;
        using var operatorC = operatorClient;

        using var put = await operatorC.PutAsJsonAsync("/v1/components/SCRW-08", ValidDoc("SCRW-08"), HmiContractJson.Options);
        Assert.Equal(HttpStatusCode.Forbidden, put.StatusCode);
    }

    [Fact]
    public async Task Operator_CanReadAllFourGetRoutes()
    {
        var (factory, engineer, operatorClient) = await NewFactoryWithUsersAsync("rbac-get");
        await using var _f = factory;
        using var engineerC = engineer;
        using var operatorC = operatorClient;

        // Declare something first so the routes have real content to answer with, not just the empty case.
        Assert.Equal(
            HttpStatusCode.OK,
            (await engineerC.PutAsJsonAsync("/v1/components/SCRW-09", ValidDoc("SCRW-09"), HmiContractJson.Options)).StatusCode);

        Assert.Equal(HttpStatusCode.OK, (await operatorC.GetAsync("/v1/components")).StatusCode);
        Assert.Equal(HttpStatusCode.OK, (await operatorC.GetAsync("/v1/components/SCRW-09")).StatusCode);
        Assert.Equal(HttpStatusCode.OK, (await operatorC.GetAsync("/v1/components/SCRW-09/integrity")).StatusCode);
        Assert.Equal(HttpStatusCode.OK, (await operatorC.GetAsync("/v1/component-types")).StatusCode);
    }

    // ─────────────────────────────────────────────────────────────────────
    // No explicit nulls — a global constraint on every HMI contract producer in this codebase (both stores
    // already serialize with HmiContractJson.Options, which drops a null on write; the app's AMBIENT
    // per-request JSON options, Program.cs's ConfigureHttpJsonOptions, do NOT). ComponentTagDef has five
    // optional fields; a component whose tags never set any of them is exactly the case that would leak
    // "unit":null / "min":null / etc. if either GET route fell back to the ambient options instead of
    // HmiContractJson.Options.
    // ─────────────────────────────────────────────────────────────────────

    [Fact]
    public async Task GetDocument_AndGetComponentTypes_NeverWriteExplicitNullsForUnsetOptionalFields()
    {
        var (factory, engineer, _) = await NewFactoryWithUsersAsync("no-explicit-nulls");
        await using var _f = factory;
        using var engineerC = engineer;

        // SimpleTag/SimpleType leave EnumValues/Unit/Min/Max/PolicyAction all null — exactly the fields
        // HmiContractJson.Options is responsible for omitting rather than writing as `null`.
        Assert.Equal(
            HttpStatusCode.OK,
            (await engineerC.PutAsJsonAsync("/v1/components/SCRW-10", ValidDoc("SCRW-10"), HmiContractJson.Options)).StatusCode);

        using (var getDoc = await engineerC.GetAsync("/v1/components/SCRW-10"))
        {
            var raw = await getDoc.Content.ReadAsStringAsync();
            Assert.DoesNotContain("\"unit\":null", raw, StringComparison.Ordinal);
            Assert.DoesNotContain("\"min\":null", raw, StringComparison.Ordinal);
            Assert.DoesNotContain("\"max\":null", raw, StringComparison.Ordinal);
            Assert.DoesNotContain("\"enumValues\":null", raw, StringComparison.Ordinal);
            Assert.DoesNotContain("\"policyAction\":null", raw, StringComparison.Ordinal);
            Assert.DoesNotContain("\"parentId\":null", raw, StringComparison.Ordinal);
        }

        using (var getTypes = await engineerC.GetAsync("/v1/component-types"))
        {
            var raw = await getTypes.Content.ReadAsStringAsync();
            Assert.DoesNotContain("\"unit\":null", raw, StringComparison.Ordinal);
            Assert.DoesNotContain("\"min\":null", raw, StringComparison.Ordinal);
            Assert.DoesNotContain("\"max\":null", raw, StringComparison.Ordinal);
            Assert.DoesNotContain("\"enumValues\":null", raw, StringComparison.Ordinal);
            Assert.DoesNotContain("\"policyAction\":null", raw, StringComparison.Ordinal);
        }
    }

    // ─────────────────────────────────────────────────────────────────────
    // Fix round 1, HIGH-1 — PUT must not trust the body's machineCode over the route's. Reviewer's own
    // measurement: PUT /v1/components/INTENDED-01 with body.machineCode = "VICTIM-99" returned 200 and
    // silently overwrote VICTIM-99's entire tree, while GET /v1/components/INTENDED-01 kept coming back
    // 200 + empty (§5-bis makes that indistinguishable from "never declared" — the failure was invisible).
    // Decided REJECT (400), matching the reviewer's steer and ConfigEndpoints.cs's own
    // UpsertProductAsync/UpsertPointAsync/UpsertRecipeAsync guard shape (fill-if-omitted,
    // reject-if-mismatched) — see HmiModelEndpoints.PutAsync's own doc comment for the full reasoning.
    // ─────────────────────────────────────────────────────────────────────

    [Fact]
    public async Task Put_BodyMachineCodeMismatchesRoute_Gets400_AndTheVictimMachineIsUntouched()
    {
        var (factory, engineer, _) = await NewFactoryWithUsersAsync("mismatch-guard");
        await using var _f = factory;
        using var engineerC = engineer;

        // VICTIM-99 already has a real, distinguishable tree declared — the thing the mismatch guard has
        // to keep safe from a PUT aimed at a DIFFERENT route.
        var victimDoc = ValidDoc("VICTIM-99", typeId: "st4i.victim.type");
        Assert.Equal(
            HttpStatusCode.OK,
            (await engineerC.PutAsJsonAsync("/v1/components/VICTIM-99", victimDoc, HmiContractJson.Options)).StatusCode);

        // A PUT to a DIFFERENT route (INTENDED-01) whose BODY claims to be VICTIM-99 — exactly the
        // reviewer's probe shape.
        var attackDoc = ValidDoc("VICTIM-99", typeId: "st4i.attacker.type");
        using (var put = await engineerC.PutAsJsonAsync("/v1/components/INTENDED-01", attackDoc, HmiContractJson.Options))
        {
            Assert.Equal(HttpStatusCode.BadRequest, put.StatusCode);
            var error = await put.Content.ReadFromJsonAsync<ApiErrorDto>(HmiContractJson.Options);
            Assert.False(string.IsNullOrWhiteSpace(error!.Error));
        }

        // INTENDED-01 — the route actually addressed — must still be undeclared: the rejected PUT wrote
        // nothing anywhere.
        using (var getIntended = await engineerC.GetAsync("/v1/components/INTENDED-01"))
        {
            var doc = await getIntended.Content.ReadFromJsonAsync<ComponentModelDocument>(HmiContractJson.Options);
            Assert.Empty(doc!.Components);
        }

        // VICTIM-99's tree must be EXACTLY as it was before the attack PUT — untouched, not overwritten by
        // "st4i.attacker.type".
        using (var getVictim = await engineerC.GetAsync("/v1/components/VICTIM-99"))
        {
            var back = await getVictim.Content.ReadFromJsonAsync<ComponentModelDocument>(HmiContractJson.Options);
            Assert.Single(back!.Types);
            Assert.Equal("st4i.victim.type", back.Types[0].TypeId);
        }
    }

    [Fact]
    public async Task Put_BodyMachineCodeOmitted_IsFilledFromTheRoute()
    {
        var (factory, engineer, _) = await NewFactoryWithUsersAsync("omitted-code");
        await using var _f = factory;
        using var engineerC = engineer;

        // machineCode explicitly blank — the "or be omitted" leniency ConfigEndpoints.cs's own
        // route/body-code guards grant (fill from the route rather than reject), preserved here for
        // consistency with that established pattern.
        var doc = ValidDoc("IGNORED-VALUE") with { MachineCode = "" };

        using var put = await engineerC.PutAsJsonAsync("/v1/components/FILLED-01", doc, HmiContractJson.Options);
        Assert.Equal(HttpStatusCode.OK, put.StatusCode);
        var result = await put.Content.ReadFromJsonAsync<PutModelResultDto>(HmiContractJson.Options);
        Assert.Equal("FILLED-01", result!.MachineCode);

        // NOT just that the response echoes the route's code (both the §5-bis empty-document fallback and
        // the response DTO always do that regardless) — that the write itself actually landed under
        // "FILLED-01", not under "" (the empty string a naive pass-through would have keyed the store on).
        using var get = await engineerC.GetAsync("/v1/components/FILLED-01");
        var back = await get.Content.ReadFromJsonAsync<ComponentModelDocument>(HmiContractJson.Options);
        Assert.Equal("FILLED-01", back!.MachineCode);
        Assert.Single(back.Components);
    }

    // ─────────────────────────────────────────────────────────────────────
    // Fix round 1, HIGH-2 — a body omitting `components` must not be written before it is validated.
    // Reviewer's own measurement: `{"schemaVersion":1,"machineCode":"OMIT-01","types":[]}` (no "components"
    // key) passed the old §5 door (ContractInvariants.Validate only read doc.Types), was WRITTEN, and only
    // then threw ArgumentNullException inside ModelIntegrity.Check — after the half-record already existed.
    // Constructed via raw JSON (StringContent), not ComponentModelDocument's own constructor: C#'s
    // non-nullable annotation on `Components` does not survive System.Text.Json deserializing a MISSING
    // field (neither RespectNullableAnnotations nor RespectRequiredConstructorParameters is enabled
    // anywhere in this solution), so this is the only way to reproduce what a real malformed request sends.
    // ─────────────────────────────────────────────────────────────────────

    [Fact]
    public async Task Put_ComponentsOmittedFromRawJson_Gets400_LeavesNoHalfRecord_AndIntegrityStaysReadable()
    {
        var (factory, engineer, _) = await NewFactoryWithUsersAsync("omit-components");
        await using var _f = factory;
        using var engineerC = engineer;

        const string json = "{\"schemaVersion\":1,\"machineCode\":\"OMIT-01\",\"types\":[]}";
        using (var content = new StringContent(json, Encoding.UTF8, "application/json"))
        using (var put = await engineerC.PutAsync("/v1/components/OMIT-01", content))
        {
            Assert.Equal(HttpStatusCode.BadRequest, put.StatusCode);
            var error = await put.Content.ReadFromJsonAsync<ApiErrorDto>(HmiContractJson.Options);
            Assert.NotNull(error);
            Assert.False(string.IsNullOrWhiteSpace(error!.Error));
        }

        // No half-record: OMIT-01 must still read back as undeclared, not as a document with a missing
        // `components` field.
        using (var get = await engineerC.GetAsync("/v1/components/OMIT-01"))
        {
            Assert.Equal(HttpStatusCode.OK, get.StatusCode);
            var back = await get.Content.ReadFromJsonAsync<ComponentModelDocument>(HmiContractJson.Options);
            Assert.Empty(back!.Components);
        }

        // The integrity route must not become a permanent poison pill for this machine.
        using (var integrity = await engineerC.GetAsync("/v1/components/OMIT-01/integrity"))
        {
            Assert.Equal(HttpStatusCode.OK, integrity.StatusCode);
        }
    }
}
