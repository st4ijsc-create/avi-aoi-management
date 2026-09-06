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

    private static async Task<WebApplicationFactory<Program>> CreateFactoryAsync() =>
        (await CreateFactoryWithDirsAsync().ConfigureAwait(false)).Factory;

    /// <summary>Same factory, but also handing back the two store directories it isolated. Fix round 4
    /// needs them: reproducing a row that was NOT written through the canonicalizing decorator — a direct
    /// <c>new ComponentModelStore(dir)</c> caller, or this branch two commits ago, whose row survives under
    /// <c>%ProgramData%</c> across a redeploy — requires constructing the raw store over the SAME directory
    /// the running host resolved, and the host reads that directory from an env var this method restores
    /// before returning.</summary>
    private static async Task<(WebApplicationFactory<Program> Factory, string ModelDir, string TagsDir)> CreateFactoryWithDirsAsync()
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

            // 🔴 WS-E (License/Edition) — an ENTITLED host, because this suite exercises
            // the HMI component-model PUT routes, which WS-E made a PAID feature. A bare host has no
            // licence, so every write here would answer 403 LICENSE_REQUIRED — the gate working,
            // not a defect, and not something to fix by weakening the gate. See LicensedTestHost
            // for what was rejected (an ST4I_LICENSE_DISABLED escape hatch would be a documented
            // bypass shipped inside the revenue mechanism) and for where the UNLICENSED behaviour
            // of these same routes is asserted instead (LicenseReadPathTests).
            var factory = St4i.EngineApi.Tests.Licensing.LicensedTestHost.Create();
            _ = factory.Server; // force the host to build NOW, while the overrides above are still live.
            return (factory, hmiModelDir, hmiTagsDir);
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
        var (factory, engineer, operatorClient, _, _) = await NewFactoryWithUsersAndDirsAsync(suffix).ConfigureAwait(false);
        return (factory, engineer, operatorClient);
    }

    /// <summary>As <see cref="NewFactoryWithUsersAsync"/>, plus the isolated store directories — see
    /// <see cref="CreateFactoryWithDirsAsync"/> for why fix round 4 needs them.</summary>
    private static async Task<(WebApplicationFactory<Program> Factory, HttpClient Engineer, HttpClient Operator, string ModelDir, string TagsDir)>
        NewFactoryWithUsersAndDirsAsync(string suffix)
    {
        var (factory, modelDir, tagsDir) = await CreateFactoryWithDirsAsync().ConfigureAwait(false);
        await BootstrapAdminAsync(factory, $"hmi-admin-{suffix}", "AdminPass123!").ConfigureAwait(false);
        await CreateUserAsync(factory, $"hmi-engineer-{suffix}", "EngineerPass123!", Roles.Engineer).ConfigureAwait(false);
        await CreateUserAsync(factory, $"hmi-operator-{suffix}", "OperatorPass123!", Roles.Operator).ConfigureAwait(false);

        var engineer = await LoginAsAsync(factory, $"hmi-engineer-{suffix}", "EngineerPass123!").ConfigureAwait(false);
        var operatorClient = await LoginAsAsync(factory, $"hmi-operator-{suffix}", "OperatorPass123!").ConfigureAwait(false);

        return (factory, engineer, operatorClient, modelDir, tagsDir);
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

    // ─────────────────────────────────────────────────────────────────────
    // Fix round 2 → round 3, HIGH-A — the mismatch guard compared case-insensitively but round 2 only
    // normalised THIS handler's own body, leaving three other handlers (GetAsync, GetIntegrityAsync, and
    // ITagNamespaceStore.GetAsync) passing the raw route string to a case-SENSITIVE `machine_code TEXT
    // PRIMARY KEY`. Round 3 closes it STRUCTURALLY — see CanonicalMachineCodeStores.cs — so the canonical
    // persisted spelling is now `ToUpperInvariant()`, applied at the store seam regardless of which handler
    // or which of body/route supplied which casing. These tests assert the CANONICAL (uppercase) spelling
    // throughout, not "the route's original casing" (round 2's now-superseded claim).
    // ─────────────────────────────────────────────────────────────────────

    [Fact]
    public async Task Put_BodyMachineCodeCaseVariant_NormalizesToOneCanonicalSpelling_NoDuplicateRow()
    {
        var (factory, engineer, _) = await NewFactoryWithUsersAsync("case-variant");
        await using var _f = factory;
        using var engineerC = engineer;

        var first = ValidDoc("case-11", typeId: "st4i.original.type");
        Assert.Equal(
            HttpStatusCode.OK,
            (await engineerC.PutAsJsonAsync("/v1/components/case-11", first, HmiContractJson.Options)).StatusCode);

        // Second PUT to the SAME route — but the BODY spells the machine code in a DIFFERENT case.
        var second = ValidDoc("CASE-11", typeId: "st4i.shadow.type");
        Assert.Equal(
            HttpStatusCode.OK,
            (await engineerC.PutAsJsonAsync("/v1/components/case-11", second, HmiContractJson.Options)).StatusCode);

        // No duplicate row: exactly ONE machine code exists, spelled in the ONE canonical (uppercase) form —
        // never two entries, regardless of what casing either write used.
        using (var list = await engineerC.GetAsync("/v1/components"))
        {
            var codes = await list.Content.ReadFromJsonAsync<List<string>>(HmiContractJson.Options);
            Assert.Equal(new[] { "CASE-11" }, codes);
        }

        // The second write actually landed on the SAME row (last-writer-wins) rather than being silently
        // lost onto a shadow row that nobody reading "case-11" would ever see.
        using (var get = await engineerC.GetAsync("/v1/components/case-11"))
        {
            var back = await get.Content.ReadFromJsonAsync<ComponentModelDocument>(HmiContractJson.Options);
            Assert.Equal("CASE-11", back!.MachineCode);
            Assert.Single(back.Types);
            Assert.Equal("st4i.shadow.type", back.Types[0].TypeId);
        }
    }

    // ─────────────────────────────────────────────────────────────────────
    // Fix round 3, HIGH-A — re-review #2's own exact reproduction, driven from the ROUTE this time (round
    // 2's fix normalised only the body). Two PUTs whose BODY matches its OWN route's case each time —
    // exactly the shape that survived round 2 unfixed.
    // ─────────────────────────────────────────────────────────────────────

    [Fact]
    public async Task Put_RouteCaseVariant_NormalizesToOneRow_NotTwo()
    {
        var (factory, engineer, _) = await NewFactoryWithUsersAsync("route-case-variant");
        await using var _f = factory;
        using var engineerC = engineer;

        // First PUT via a lowercase ROUTE, body matching that route's case.
        var first = ValidDoc("case-21", typeId: "st4i.original.type");
        Assert.Equal(
            HttpStatusCode.OK,
            (await engineerC.PutAsJsonAsync("/v1/components/case-21", first, HmiContractJson.Options)).StatusCode);

        // Second PUT via an UPPERCASE route, body matching THAT route's case — re-review #2's exact probe.
        var second = ValidDoc("CASE-21", typeId: "st4i.shadow.type");
        Assert.Equal(
            HttpStatusCode.OK,
            (await engineerC.PutAsJsonAsync("/v1/components/CASE-21", second, HmiContractJson.Options)).StatusCode);

        using (var list = await engineerC.GetAsync("/v1/components"))
        {
            var codes = await list.Content.ReadFromJsonAsync<List<string>>(HmiContractJson.Options);
            Assert.Equal(new[] { "CASE-21" }, codes);
        }

        // The second write is visible via EITHER case — one row, not a shadow the first spelling can't see.
        using (var get = await engineerC.GetAsync("/v1/components/case-21"))
        {
            var back = await get.Content.ReadFromJsonAsync<ComponentModelDocument>(HmiContractJson.Options);
            Assert.Single(back!.Types);
            Assert.Equal("st4i.shadow.type", back.Types[0].TypeId);
        }
    }

    [Fact]
    public async Task Put_RouteCaseVariant_WithBodyMachineCodeOmitted_StillNormalizesToOneRow()
    {
        var (factory, engineer, _) = await NewFactoryWithUsersAsync("route-case-variant-omitted");
        await using var _f = factory;
        using var engineerC = engineer;

        var first = ValidDoc("case-22", typeId: "st4i.original.type");
        Assert.Equal(
            HttpStatusCode.OK,
            (await engineerC.PutAsJsonAsync("/v1/components/case-22", first, HmiContractJson.Options)).StatusCode);

        // Second PUT via an UPPERCASE route — body omits machineCode entirely (the lenient arm the guard
        // deliberately preserves), exercising re-review #2's "lenient arm" reproduction.
        var second = ValidDoc("case-22", typeId: "st4i.shadow.type") with { MachineCode = "" };
        Assert.Equal(
            HttpStatusCode.OK,
            (await engineerC.PutAsJsonAsync("/v1/components/CASE-22", second, HmiContractJson.Options)).StatusCode);

        using var list = await engineerC.GetAsync("/v1/components");
        var codes = await list.Content.ReadFromJsonAsync<List<string>>(HmiContractJson.Options);
        Assert.Equal(new[] { "CASE-22" }, codes);
    }

    // ─────────────────────────────────────────────────────────────────────
    // Fix round 3, HIGH-A — the READ side, exhaustively. Re-review #2's single worst-named consequence:
    // GET .../integrity (Operator tier) returned a CLEAN report — namespaceLoaded:false, zero violations —
    // for a document and namespace it never actually read, because both lookups missed on a case-sensitive
    // key. This test loads a REAL namespace that deliberately does NOT match the component's tagPrefix, so
    // "the integrity route actually read the real data" and "the integrity route silently read nothing" are
    // DISTINGUISHABLE outcomes (namespaceLoaded:true + a real violation, vs. the old namespaceLoaded:false
    // + zero violations) — not just two shades of "empty".
    // ─────────────────────────────────────────────────────────────────────

    [Fact]
    public async Task Get_And_GetIntegrity_And_List_FindTheSameRow_RegardlessOfRouteCase()
    {
        var (factory, engineer, operatorClient) = await NewFactoryWithUsersAsync("read-side-case-variant");
        await using var _f = factory;
        using var engineerC = engineer;
        using var operatorC = operatorClient;

        // A namespace whose tags do NOT match the component's tagPrefix, loaded directly via the store seam
        // (DI-resolved, so it goes through the SAME canonicalizing decorator a real connector would).
        var tagsStore = factory.Services.GetRequiredService<ITagNamespaceStore>();
        await tagsStore.PutAsync(NamespaceThatDoesNotMatch("case-23"));

        Assert.Equal(
            HttpStatusCode.OK,
            (await engineerC.PutAsJsonAsync("/v1/components/case-23", ValidDoc("case-23"), HmiContractJson.Options)).StatusCode);

        // GET via an UPPERCASE route must find the REAL document — not the §5-bis empty fallback, which is
        // indistinguishable from "never declared" and is exactly what made this defect invisible.
        using (var get = await operatorC.GetAsync("/v1/components/CASE-23"))
        {
            Assert.Equal(HttpStatusCode.OK, get.StatusCode);
            var back = await get.Content.ReadFromJsonAsync<ComponentModelDocument>(HmiContractJson.Options);
            Assert.NotEmpty(back!.Components);
        }

        // GET .../integrity via an UPPERCASE route must reflect the REAL document AND the REAL namespace —
        // namespaceLoaded:true (found the namespace) and a NON-EMPTY violation list (the real tagPrefix
        // mismatch), not the old "clean bill of health for a document it never read".
        using (var integrity = await operatorC.GetAsync("/v1/components/CASE-23/integrity"))
        {
            Assert.Equal(HttpStatusCode.OK, integrity.StatusCode);
            var report = await integrity.Content.ReadFromJsonAsync<IntegrityReportDto>(HmiContractJson.Options);
            Assert.True(report!.NamespaceLoaded);
            Assert.NotEmpty(report.Violations);
        }

        // GET /v1/components (list) shows exactly one canonical entry, never a route-case-driven second row.
        using (var list = await operatorC.GetAsync("/v1/components"))
        {
            var codes = await list.Content.ReadFromJsonAsync<List<string>>(HmiContractJson.Options);
            Assert.Equal(new[] { "CASE-23" }, codes);
        }

        // GET /v1/component-types (merged catalogue) reflects the one row's type, reachable regardless of
        // which case populated it.
        using (var types = await operatorC.GetAsync("/v1/component-types"))
        {
            var typeDefs = await types.Content.ReadFromJsonAsync<List<ComponentTypeDef>>(HmiContractJson.Options);
            Assert.Contains(typeDefs!, t => t.TypeId == "st4i.motor.spindle");
        }
    }

    // ─────────────────────────────────────────────────────────────────────
    // Fix round 3, HIGH-A — the structural half, pinned directly: IComponentModelStore/ITagNamespaceStore
    // resolve to the canonicalizing decorators, not to ComponentModelStore/TagNamespaceStore. This is the
    // property that makes "no fifth path can be added without normalizing" true by construction — DI is the
    // ONLY way any handler (existing or future) obtains either interface (see this class's own doc comment:
    // "a plain constructor parameter ASP.NET's minimal-API model binder resolves from DI, no manual
    // GetRequiredService anywhere in this file"), so a handler cannot reach the case-sensitive store even by
    // omission. Same DI-resolution-assertion shape HmiModelWiringTests already uses for the un-decorated
    // registration.
    // ─────────────────────────────────────────────────────────────────────

    [Fact]
    public async Task IComponentModelStore_And_ITagNamespaceStore_ResolveToTheCanonicalizingDecorator()
    {
        var factory = await CreateFactoryAsync();
        await using var _f = factory;

        Assert.IsType<CanonicalizingComponentModelStore>(factory.Services.GetRequiredService<IComponentModelStore>());
        Assert.IsType<CanonicalizingTagNamespaceStore>(factory.Services.GetRequiredService<ITagNamespaceStore>());
    }

    // ─────────────────────────────────────────────────────────────────────
    // Fix round 3, LOW — re-review #2's A18: id/tagPrefix of " " (whitespace-only) is not a usable identity
    // any more than null/empty is. Endpoint-level companion to ContractInvariantsTests' unit-level pin.
    // ─────────────────────────────────────────────────────────────────────

    [Fact]
    public async Task Put_ComponentWithWhitespaceOnlyIdAndTagPrefix_Gets400()
    {
        var (factory, engineer, _) = await NewFactoryWithUsersAsync("whitespace-id");
        await using var _f = factory;
        using var engineerC = engineer;

        const string json = "{\"schemaVersion\":1,\"machineCode\":\"WS-01\"," +
                             "\"components\":[{\"id\":\" \",\"typeId\":\"t\",\"label\":\"L\",\"tagPrefix\":\" \"}],\"types\":[]}";
        using var content = new StringContent(json, Encoding.UTF8, "application/json");
        using var put = await engineerC.PutAsync("/v1/components/WS-01", content);

        Assert.Equal(HttpStatusCode.BadRequest, put.StatusCode);
        var error = await put.Content.ReadFromJsonAsync<ApiErrorDto>(HmiContractJson.Options);
        Assert.NotNull(error);
        Assert.Contains("id", error!.Error, StringComparison.OrdinalIgnoreCase);
        Assert.Contains("tagPrefix", error.Error, StringComparison.OrdinalIgnoreCase);
    }

    // ─────────────────────────────────────────────────────────────────────
    // Fix round 2, HIGH-B — Validate(ComponentModelDocument) checked the two COLLECTIONS for null but
    // never read a single ELEMENT. `{"components":[{}]}` (an empty component object) passed the §5 door,
    // was WRITTEN, and crashed inside ModelIntegrity.Check with ArgumentNullException — reproducing every
    // consequence of the original HIGH-2 finding through an element-level null instead of a top-level one.
    // Fixed by validating each element of `components`/`types` (and each element of a type's own `tags`)
    // for null, plus each ComponentNode's `id`/`tagPrefix` — the two fields whose null-ness is what
    // actually crashes ModelIntegrity.Check (a Dictionary key and a Substring bound, respectively).
    // ─────────────────────────────────────────────────────────────────────

    [Fact]
    public async Task Put_ComponentElementWithNullRequiredFields_Gets400_LeavesNoHalfRecord_AndIntegrityStaysReadable()
    {
        var (factory, engineer, _) = await NewFactoryWithUsersAsync("null-component-element");
        await using var _f = factory;
        using var engineerC = engineer;

        const string json = "{\"schemaVersion\":1,\"machineCode\":\"NULLID-01\",\"components\":[{}],\"types\":[]}";
        using (var content = new StringContent(json, Encoding.UTF8, "application/json"))
        using (var put = await engineerC.PutAsync("/v1/components/NULLID-01", content))
        {
            Assert.Equal(HttpStatusCode.BadRequest, put.StatusCode);
            var error = await put.Content.ReadFromJsonAsync<ApiErrorDto>(HmiContractJson.Options);
            Assert.NotNull(error);
            Assert.False(string.IsNullOrWhiteSpace(error!.Error));
        }

        // No half-record — NOT just an empty document at the detail route (§5-bis's normal empty state),
        // but genuinely ABSENT from the machine-code list too.
        using (var get = await engineerC.GetAsync("/v1/components/NULLID-01"))
        {
            Assert.Equal(HttpStatusCode.OK, get.StatusCode);
            var back = await get.Content.ReadFromJsonAsync<ComponentModelDocument>(HmiContractJson.Options);
            Assert.Empty(back!.Components);
        }

        using (var list = await engineerC.GetAsync("/v1/components"))
        {
            var codes = await list.Content.ReadFromJsonAsync<List<string>>(HmiContractJson.Options);
            Assert.NotNull(codes);
            Assert.DoesNotContain("NULLID-01", codes);
        }

        // The integrity route must not become a permanent poison pill for this machine.
        using (var integrity = await engineerC.GetAsync("/v1/components/NULLID-01/integrity"))
        {
            Assert.Equal(HttpStatusCode.OK, integrity.StatusCode);
        }
    }

    [Fact]
    public async Task Put_TypeElementWithOmittedTags_Gets400_NotA500()
    {
        var (factory, engineer, _) = await NewFactoryWithUsersAsync("null-type-tags");
        await using var _f = factory;
        using var engineerC = engineer;

        // The TYPE's own `tags` array omitted — the sibling shape review found surviving at
        // ContractInvariants.cs:176, two lines below the fix that was supposed to have closed it.
        const string json = "{\"schemaVersion\":1,\"machineCode\":\"OMIT-TAGS-01\",\"components\":[]," +
                             "\"types\":[{\"typeId\":\"t1\",\"label\":\"T\",\"states\":[],\"defaultFaceplate\":\"fp\"}]}";
        using var content = new StringContent(json, Encoding.UTF8, "application/json");
        using var put = await engineerC.PutAsync("/v1/components/OMIT-TAGS-01", content);

        Assert.Equal(HttpStatusCode.BadRequest, put.StatusCode);
        var error = await put.Content.ReadFromJsonAsync<ApiErrorDto>(HmiContractJson.Options);
        Assert.NotNull(error);
        Assert.False(string.IsNullOrWhiteSpace(error!.Error));

        using var list = await engineerC.GetAsync("/v1/components");
        var codes = await list.Content.ReadFromJsonAsync<List<string>>(HmiContractJson.Options);
        Assert.NotNull(codes);
        Assert.DoesNotContain("OMIT-TAGS-01", codes);
    }

    // ─────────────────────────────────────────────────────────────────────
    // Fix round 4, HIGH-1 — re-review #3's own reproduction, end to end. Round 3 canonicalised what went
    // INTO the store and not what came OUT: `ListMachineCodesAsync` forwarded stored keys verbatim while
    // `GetAsync` canonicalised its lookup key, so the two methods of ONE decorator disagreed about the
    // identity of a row that was already on disk. The row below is written through the RAW, still-public
    // `new ComponentModelStore(dir)` — the same thing a direct store caller does, the same thing WS-HMI-0c
    // does, and the same shape rounds 1 and 2 of this branch persisted for a lowercase route into a
    // %ProgramData% database that survives a redeploy.
    //
    // Before this fix the four reads below returned, in order: ["legacy-01"] · the §5-bis EMPTY document ·
    // {"namespaceLoaded":false,"violations":[]} (A CLEAN BILL OF HEALTH, AT OPERATOR TIER, FOR A DOCUMENT
    // IT NEVER READ — re-review #2's own condemnation of round 2, verbatim) · [].
    // ─────────────────────────────────────────────────────────────────────

    [Fact]
    public async Task A_row_written_directly_to_the_store_is_listed_readable_and_honestly_reported()
    {
        var (factory, engineer, operatorClient, modelDir, tagsDir) =
            await NewFactoryWithUsersAndDirsAsync("legacy-row");
        await using var _f = factory;
        using var engineerC = engineer;
        using var operatorC = operatorClient;

        // A row keyed 'legacy-01' — NOT written through the canonicalizing decorator, and not reachable
        // through any HTTP route that would have canonicalised it.
        var raw = new ComponentModelStore(modelDir);
        await raw.PutAsync(ValidDoc("legacy-01", typeId: "st4i.legacy.type"));

        // ...and a real namespace for the same machine, so "read the real namespace" and "read nothing"
        // are DISTINGUISHABLE outcomes at the integrity route rather than two shades of empty. Its tags
        // deliberately do not match the tree's tagPrefix. Loaded through the DI-resolved seam (the
        // decorator) rather than raw, because that is the only supported way a namespace is ever written —
        // the raw, non-canonically-keyed case is a declared residue with no resolution mechanism available,
        // measured separately and by name in
        // A_namespace_written_directly_under_a_non_canonical_key_is_reported_as_unloaded_not_as_clean.
        _ = tagsDir;
        await factory.Services.GetRequiredService<ITagNamespaceStore>()
            .PutAsync(NamespaceThatDoesNotMatch("legacy-01"));

        // 1. The list reports the ONE canonical identity — not the stored spelling, and never both.
        using (var list = await operatorC.GetAsync("/v1/components"))
        {
            var codes = await list.Content.ReadFromJsonAsync<List<string>>(HmiContractJson.Options);
            Assert.Equal(new[] { "LEGACY-01" }, codes);
        }

        // 2. The detail route serves the REAL document at every spelling of that identity — including the
        //    spelling the list handed out. An empty document here is indistinguishable from "never
        //    declared" (§5-bis), which is exactly what made this defect invisible.
        foreach (var spelling in new[] { "legacy-01", "LEGACY-01", "LeGaCy-01" })
        {
            using var get = await operatorC.GetAsync($"/v1/components/{spelling}");
            Assert.Equal(HttpStatusCode.OK, get.StatusCode);
            var back = await get.Content.ReadFromJsonAsync<ComponentModelDocument>(HmiContractJson.Options);
            Assert.Equal("LEGACY-01", back!.MachineCode);
            Assert.Single(back.Types);
            Assert.Equal("st4i.legacy.type", back.Types[0].TypeId);
        }

        // 3. The Operator-tier integrity route reports the REAL document against the REAL namespace —
        //    namespaceLoaded:true and a non-empty violation list, not a clean bill of health.
        using (var integrity = await operatorC.GetAsync("/v1/components/legacy-01/integrity"))
        {
            var report = await integrity.Content.ReadFromJsonAsync<IntegrityReportDto>(HmiContractJson.Options);
            Assert.Equal("LEGACY-01", report!.MachineCode);
            Assert.True(report.NamespaceLoaded);
            Assert.NotEmpty(report.Violations);
        }

        // 4. The merged catalogue does not silently drop this machine's types.
        using (var types = await operatorC.GetAsync("/v1/component-types"))
        {
            var typeDefs = await types.Content.ReadFromJsonAsync<List<ComponentTypeDef>>(HmiContractJson.Options);
            Assert.Contains(typeDefs!, t => t.TypeId == "st4i.legacy.type");
        }

        // 5. And an Engineer PUT at the spelling the list handed out lands on the SAME identity — never
        //    ["LEGACY-01","legacy-01"], two rows for one machine with the old one orphaned.
        Assert.Equal(
            HttpStatusCode.OK,
            (await engineerC.PutAsJsonAsync(
                "/v1/components/LEGACY-01", ValidDoc("LEGACY-01", typeId: "st4i.new.type"), HmiContractJson.Options)).StatusCode);

        using (var list = await operatorC.GetAsync("/v1/components"))
        {
            var codes = await list.Content.ReadFromJsonAsync<List<string>>(HmiContractJson.Options);
            Assert.Equal(new[] { "LEGACY-01" }, codes);
        }

        using (var get = await operatorC.GetAsync("/v1/components/legacy-01"))
        {
            var back = await get.Content.ReadFromJsonAsync<ComponentModelDocument>(HmiContractJson.Options);
            Assert.Equal("st4i.new.type", back!.Types[0].TypeId);
        }
    }

    /// <summary>🔴 <b>THE ONE RESIDUE OF THE HIGH-1 FIX, MEASURED RATHER THAN MERELY DISCLOSED.</b>
    /// <c>CanonicalizingComponentModelStore.GetAsync</c> resolves a non-canonically-keyed row by
    /// ENUMERATING stored keys; <see cref="ITagNamespaceStore"/> exposes no enumeration, and
    /// <see cref="TagNamespaceStore"/> is frozen, so the same resolution is unavailable there. A namespace
    /// written by a direct <c>new TagNamespaceStore(dir)</c> caller under a non-canonical spelling is
    /// therefore invisible to this seam.
    ///
    /// <para><b>What this test pins is that the invisibility is REPORTED HONESTLY rather than as health.</b>
    /// The condemned shape was a CLEAN BILL OF HEALTH for a document it never read; here the DOCUMENT is
    /// read (the component-tree fallback works), and the namespace's absence is declared through the field
    /// that exists to declare exactly that — <c>namespaceLoaded:false</c>, which
    /// <see cref="IntegrityReportDto"/>'s own doc comment defines as "not loaded" and distinguishes from
    /// "loaded and empty". No supported path can create this state: every DI caller, and Task 2's
    /// <c>PUT /v1/tags/{machineCode}</c>, writes through the decorator and therefore canonically.</para>
    ///
    /// <para><b>If a later round closes this</b> — by giving <see cref="ITagNamespaceStore"/> an
    /// enumeration, or by a migration — this test goes red, which is the point: the residue is pinned, so
    /// it cannot be closed silently or widened silently.</para></summary>
    [Fact]
    public async Task A_namespace_written_directly_under_a_non_canonical_key_is_reported_as_unloaded_not_as_clean()
    {
        var (factory, engineer, operatorClient, _, tagsDir) =
            await NewFactoryWithUsersAndDirsAsync("raw-namespace-residue");
        await using var _f = factory;
        using var engineerC = engineer;
        using var operatorC = operatorClient;

        var rawTags = new TagNamespaceStore(tagsDir);
        await rawTags.PutAsync(NamespaceThatDoesNotMatch("resid-01"));

        Assert.Equal(
            HttpStatusCode.OK,
            (await engineerC.PutAsJsonAsync(
                "/v1/components/RESID-01", ValidDoc("RESID-01"), HmiContractJson.Options)).StatusCode);

        using var integrity = await operatorC.GetAsync("/v1/components/RESID-01/integrity");
        var report = await integrity.Content.ReadFromJsonAsync<IntegrityReportDto>(HmiContractJson.Options);

        // The residue: this seam cannot see that namespace...
        Assert.False(report!.NamespaceLoaded);

        // ...and says so, instead of reporting a namespace it never read as matched. `violations` being
        // empty here means "check 4 was SKIPPED", which namespaceLoaded:false is the field that says.
        Assert.Empty(report.Violations);

        // And the component tree itself — the half that IS resolvable — was genuinely read: not the
        // §5-bis empty document.
        using var get = await operatorC.GetAsync("/v1/components/RESID-01");
        var back = await get.Content.ReadFromJsonAsync<ComponentModelDocument>(HmiContractJson.Options);
        Assert.Single(back!.Components);
    }

    // ─────────────────────────────────────────────────────────────────────
    // Fix round 4, HIGH-2 — P1 ("no client-authored body may produce a 500") measured FALSE by re-review
    // #3. `1e400` deserializes to double.PositiveInfinity; it passes every §5 rule (min present, max
    // present, policyAction present), and then JsonSerializer.Serialize throws ArgumentException inside
    // ComponentModelStore.PutAsync — NOT a ContractViolationException, so it escapes the handler's catch
    // and becomes a bare 500 (Program.cs installs no UseExceptionHandler/AddProblemDetails).
    //
    // Raw JSON, not the record's constructor: `1e400` is what a client actually sends, and it is
    // System.Text.Json's number parser that turns it into a non-finite double.
    // ─────────────────────────────────────────────────────────────────────

    public static TheoryData<string, string> NonFiniteSetpointBands() => new()
    {
        { "min-positive-infinity", "\"min\":1e400,\"max\":2" },
        { "min-negative-infinity", "\"min\":-1e400,\"max\":2" },
        { "max-positive-infinity", "\"min\":0,\"max\":1e400" },
        { "both-infinite", "\"min\":-1e400,\"max\":1e400" },
    };

    [Theory]
    [MemberData(nameof(NonFiniteSetpointBands))]
    public async Task Put_SetpointWithANonFiniteBand_Gets400_NotA500_AndWritesNothing(string label, string band)
    {
        var (factory, engineer, _) = await NewFactoryWithUsersAsync($"nonfinite-{label}");
        await using var _f = factory;
        using var engineerC = engineer;

        var code = $"NF-{label}";
        var json = "{\"schemaVersion\":1,\"components\":[],\"types\":[{\"typeId\":\"t\",\"label\":\"T\"," +
                   "\"tags\":[{\"name\":\"x\",\"role\":\"setpoint\",\"dataType\":\"float\"," + band +
                   ",\"policyAction\":\"p\"}],\"states\":[],\"defaultFaceplate\":\"f\"}]}";

        using (var content = new StringContent(json, Encoding.UTF8, "application/json"))
        using (var put = await engineerC.PutAsync($"/v1/components/{code}", content))
        {
            Assert.Equal(HttpStatusCode.BadRequest, put.StatusCode);
            var error = await put.Content.ReadFromJsonAsync<ApiErrorDto>(HmiContractJson.Options);
            Assert.NotNull(error);
            Assert.False(string.IsNullOrWhiteSpace(error!.Error));
        }

        // P2 must keep holding — serialisation precedes the connection, so nothing was ever written, and
        // it must stay that way now that the rejection happens even earlier (at the §5 door).
        using (var get = await engineerC.GetAsync($"/v1/components/{code}"))
        {
            Assert.Equal(HttpStatusCode.OK, get.StatusCode);
            var back = await get.Content.ReadFromJsonAsync<ComponentModelDocument>(HmiContractJson.Options);
            Assert.Empty(back!.Components);
            Assert.Empty(back.Types);
        }

        using (var list = await engineerC.GetAsync("/v1/components"))
        {
            var codes = await list.Content.ReadFromJsonAsync<List<string>>(HmiContractJson.Options);
            Assert.DoesNotContain(code.ToUpperInvariant(), codes!);
        }

        using (var integrity = await engineerC.GetAsync($"/v1/components/{code}/integrity"))
        {
            Assert.Equal(HttpStatusCode.OK, integrity.StatusCode);
        }
    }

    // ─────────────────────────────────────────────────────────────────────
    // Fix round 4, MEDIUM-1 — re-review #3's own measurement: `policyAction: " "` returned 200 AND WAS
    // STORED, while `policyAction: ""` correctly 400'd. Empty rejected, whitespace accepted — on the §5
    // safety gate itself, i.e. an ungated write door reported as gated. Both arms are asserted here so
    // the two can never drift apart again.
    // ─────────────────────────────────────────────────────────────────────

    [Theory]
    [InlineData("WSP-01", " ")]
    [InlineData("WSP-02", "")]
    [InlineData("WSP-03", "\t")]
    public async Task Put_SetpointWithABlankPolicyAction_Gets400_AndIsNotStored(string code, string policyAction)
    {
        var (factory, engineer, _) = await NewFactoryWithUsersAsync($"blank-policy-{code}");
        await using var _f = factory;
        using var engineerC = engineer;

        var json = "{\"schemaVersion\":1,\"components\":[],\"types\":[{\"typeId\":\"t\",\"label\":\"T\"," +
                   "\"tags\":[{\"name\":\"torque\",\"role\":\"setpoint\",\"dataType\":\"float\"," +
                   "\"min\":0,\"max\":10,\"policyAction\":\"" + policyAction.Replace("\t", "\\t", StringComparison.Ordinal) +
                   "\"}],\"states\":[],\"defaultFaceplate\":\"f\"}]}";

        using (var content = new StringContent(json, Encoding.UTF8, "application/json"))
        using (var put = await engineerC.PutAsync($"/v1/components/{code}", content))
        {
            Assert.Equal(HttpStatusCode.BadRequest, put.StatusCode);
            var error = await put.Content.ReadFromJsonAsync<ApiErrorDto>(HmiContractJson.Options);
            Assert.Contains("policyAction", error!.Error, StringComparison.Ordinal);
        }

        using var list = await engineerC.GetAsync("/v1/components");
        var codes = await list.Content.ReadFromJsonAsync<List<string>>(HmiContractJson.Options);
        Assert.DoesNotContain(code, codes!);
    }
}
