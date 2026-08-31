using System.Text.Json;
using System.Text.RegularExpressions;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.Extensions.DependencyInjection;
using St4i.EngineApi.HmiModel;
// 🔴 Review toàn nhánh WS-HMI-0a, Minor 9 — cái `using` này TỒN TẠI ĐỂ [Collection(...)] bên dưới viết
// được dạng NGẮN. Không gì thi hành được tư cách thành viên của collection ấy, nên khả năng TÌM THẤY
// BẰNG GREP là toàn bộ phòng tuyến: 30+ lớp trong assembly này viết
// `[Collection(SecurityEnvVarTests.CollectionName)]`, và bản đầy đủ `[Collection(St4i.EngineApi.Tests.
// Auth.SecurityEnvVarTests.CollectionName)]` mà file này từng dùng KHÔNG lọt vào phép grep tự nhiên ấy —
// một lớp boot WebApplicationFactory<Program> nhìn như đang đứng ngoài collection.
using St4i.EngineApi.Tests.Auth;
using Xunit;

namespace St4i.EngineApi.Tests.HmiModel;

/// <summary>
/// WS-HMI-0a Task 5 — pins the three things this task's brief names, plus one Step 1's own correctness
/// depends on that nothing else in the suite would catch (see the third fact's own doc comment):
///
/// <list type="number">
///   <item><description><see cref="ComponentModelStore.EnvVarDir"/>/<see cref="TagNamespaceStore.EnvVarDir"/>
///   spell the exact constants <c>web/playwright.config.ts</c>'s isolation block and
///   <c>packaging/remove-data.ps1</c> are keyed on — a typo in either constant would silently isolate/purge
///   nothing.</description></item>
///   <item><description><c>GET /v1/capabilities</c> declares the new <c>hmiModelEnabled</c> flag — the
///   seam §6 of the machine-edition skill and this task's brief both call out, for WS-E License/Edition to
///   gate later without an architecture change.</description></item>
///   <item><description><c>web/playwright.config.ts</c> isolates BOTH new stores' env vars — the step this
///   task's brief calls "not paperwork": this repository's e2e suite has previously written real
///   accounts into a production <c>security.db</c> for exactly the failure mode of a store arriving
///   without its isolation entry.</description></item>
/// </list>
///
/// <para><b>This test file does NOT measure:</b> (1) that either store's SQLite file round-trips a real
/// document (that is <c>ComponentModelStoreTests</c>/<c>TagNamespaceStoreTests</c>, Tasks 2/3's own
/// suites); (2) anything about an API surface for either store — this task's brief is explicit that no
/// endpoint exists yet (WS-HMI-0b); (3) that Playwright itself passes with the new isolation entries —
/// this task changes configuration, not a rendered component, so the full e2e suite was deliberately not
/// re-run (see this task's report for why).</para>
/// </summary>
[Collection(SecurityEnvVarTests.CollectionName)]
public sealed class HmiModelWiringTests
{
    // Same "one process, one SQLite pool, one env block" hazard SecurityEnvVarTests' own doc comment
    // describes: this class boots a real WebApplicationFactory<Program>, which opens SQLite connections
    // for every store Program.cs constructs (historian/security/assets/... and now hmi-model/hmi-tags),
    // and mutates the real ASPNETCORE_ENVIRONMENT variable around the eager build below — both are why
    // it carries the same [Collection(...)] tag every other WebApplicationFactory<Program>-booting class
    // in this assembly does.
    private static readonly SemaphoreSlim EnvLock = new(1, 1);

    private static string MachineSimulatorRoot()
    {
        var dir = new DirectoryInfo(AppContext.BaseDirectory);
        while (dir is not null)
        {
            if (File.Exists(Path.Combine(dir.FullName, "README.md")) &&
                File.Exists(Path.Combine(dir.FullName, "fleet.json")) &&
                Directory.Exists(Path.Combine(dir.FullName, "docs")))
            {
                return dir.FullName;
            }

            dir = dir.Parent;
        }

        throw new InvalidOperationException(
            "Could not locate tools/machine-simulator (README.md + fleet.json + docs/) by walking up from " +
            $"\"{AppContext.BaseDirectory}\". If the output layout changed, fix this walk — do NOT weaken " +
            "the assertions below to make the file findable.");
    }

    /// <summary>Same "force Production, eager-build while the override is live" idiom
    /// <c>AuthPipelineTests.CreateFactoryAsync</c>/<c>RbacPolicyTests.CreateFactoryAsync</c> already use —
    /// duplicated rather than shared for the same reason those two duplicate it from each other (each
    /// method is private to its own class). Unlike those two, this class does NOT also swap every
    /// ST4I_*_DIR by hand: every leaf this boot can reach — all EIGHTEEN, hmi-model/hmi-tags included —
    /// is already isolated by <c>TestRunTempRoot</c>'s module initializer (linked into this project;
    /// this task added the two new leaves to it precisely so a new test would not have to re-isolate the
    /// whole population by hand). Only ASPNETCORE_ENVIRONMENT is this class's own concern.</summary>
    private static async Task<WebApplicationFactory<Program>> CreateFactoryAsync()
    {
        await EnvLock.WaitAsync().ConfigureAwait(false);
        var prevEnvironment = Environment.GetEnvironmentVariable("ASPNETCORE_ENVIRONMENT");
        try
        {
            // A bare WebApplicationFactory<Program> defaults to the Development environment, which loads
            // the SDK's Static Web Assets manifest — baked with this PROJECT'S OWN absolute source-tree
            // wwwroot path — and throws before a single request runs. Program.cs serves wwwroot/ itself
            // via a manual WebRootFileProvider, so this app never needs that manifest; forcing Production
            // sidesteps it entirely (same fix AuthPipelineTests' own doc comment explains at length).
            Environment.SetEnvironmentVariable("ASPNETCORE_ENVIRONMENT", "Production");

            var factory = new WebApplicationFactory<Program>();
            _ = factory.Server; // force the host to build NOW, while the override above is still live.
            return factory;
        }
        finally
        {
            Environment.SetEnvironmentVariable("ASPNETCORE_ENVIRONMENT", prevEnvironment);
            EnvLock.Release();
        }
    }

    [Fact]
    public void The_two_stores_declare_the_exact_env_var_constants_the_isolation_config_is_keyed_on()
    {
        // Pure — no disk, no host. If either constant drifted, web/playwright.config.ts's isolation
        // block and packaging/remove-data.ps1's -XxxDir resolution would both silently stop matching it.
        Assert.Equal("ST4I_HMI_MODEL_DIR", ComponentModelStore.EnvVarDir);
        Assert.Equal("ST4I_HMI_TAGS_DIR", TagNamespaceStore.EnvVarDir);
    }

    [Fact]
    public async Task Capabilities_declares_the_HmiModelEnabled_flag_true()
    {
        await using var factory = await CreateFactoryAsync().ConfigureAwait(false);
        using var client = factory.CreateClient();

        using var response = await client.GetAsync("/v1/capabilities");
        response.EnsureSuccessStatusCode();

        using var doc = JsonDocument.Parse(await response.Content.ReadAsStringAsync());
        Assert.True(doc.RootElement.GetProperty("hmiModelEnabled").GetBoolean());

        // 🔴 WS-HMI-0b Task 4 — the API-layer flag, and it is asserted as a SEPARATE property rather than
        // folded into the line above, because the whole point of two flags is that a client can see them
        // disagree. WS-HMI-0a shipped a released state where `hmiModelEnabled` was true and no route could
        // reach the stores; a test that only checked one would not have noticed the second never arrived.
        //
        // What this does NOT measure: that either flag can ever be FALSE. Neither can today — no license
        // tier exists to turn them off, which CapabilitiesDto's own doc comment states. This pins that both
        // are REPORTED, which is what a client branches on, not that the gate works.
        Assert.True(doc.RootElement.GetProperty("hmiApiEnabled").GetBoolean());

        // 🔴 Step 1's own correctness, which nothing else in this suite would catch: at the time this test
        // was written, no endpoint read IComponentModelStore/ITagNamespaceStore yet (WS-HMI-0a Task 5's own
        // brief was explicit that adding one was WS-HMI-0b's job), so a broken/typo'd DI registration would
        // have left every other test in this project green while the seam quietly resolved nothing.
        //
        // 🔴 WS-HMI-0b Task 1, fix round 3 (HIGH-A) — the assertion below is UPDATED, not the premise above:
        // HmiModelEndpoints now reads both seams, so a broken registration would ALSO be caught by
        // HmiModelEndpointsTests today. What changed is WHAT Program.cs registers these interfaces AS —
        // CanonicalizingComponentModelStore/CanonicalizingTagNamespaceStore (CanonicalMachineCodeStores.cs),
        // not the bare stores — because the structural fix for machine-code case-identity is that DI hands
        // out ONLY the canonicalizing decorator, never the raw, case-sensitive-keyed store, to any handler.
        // HmiModelEndpointsTests.IComponentModelStore_And_ITagNamespaceStore_ResolveToTheCanonicalizingDecorator
        // pins the same fact from the WS-HMI-0b side; kept here too so this file's own claim about what
        // Program.cs registers does not go stale silently.
        Assert.IsType<CanonicalizingComponentModelStore>(factory.Services.GetRequiredService<IComponentModelStore>());
        Assert.IsType<CanonicalizingTagNamespaceStore>(factory.Services.GetRequiredService<ITagNamespaceStore>());
    }

    [Fact]
    public void PlaywrightConfig_isolates_both_new_stores_env_vars()
    {
        var configPath = Path.Combine(MachineSimulatorRoot(), "web", "playwright.config.ts");
        var raw = File.ReadAllText(configPath);

        // core.autocrlf=true on this repository, so a fresh checkout on Windows reads this file with
        // \r\n line endings. This task's own brief names the exact failure a file scan that forgets this
        // produces: the Milestone 0 contract gate went red on every new checkout because a `^...$`-anchored
        // Multiline regex never matched a line ending in \r. Normalize before matching, not after.
        var config = raw.Replace("\r\n", "\n", StringComparison.Ordinal);

        foreach (var name in new[] { ComponentModelStore.EnvVarDir, TagNamespaceStore.EnvVarDir })
        {
            Assert.True(
                Regex.IsMatch(config, $@"^\s*{Regex.Escape(name)}\s*:", RegexOptions.Multiline),
                $"web/playwright.config.ts does not isolate {name} in its webServer env block — every " +
                "npm run test:e2e/npm run dev would read and write a REAL install's data for this store.");
        }
    }
}
