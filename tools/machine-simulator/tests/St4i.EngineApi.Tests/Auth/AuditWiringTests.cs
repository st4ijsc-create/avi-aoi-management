using System.Collections.Concurrent;
using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Microsoft.AspNetCore.Identity;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;
using Microsoft.Extensions.Logging;
using St4i.EngineApi.Auth;
using Xunit;

namespace St4i.EngineApi.Tests.Auth;

/// <summary>
/// WS-D-D4 — proves the audit hash-chain is actually WIRED into a representative sample of sensitive
/// mutations (one per action family, per the task-4 brief), not just that <see cref="AuditRecorder"/>/
/// <see cref="IAuditStore"/> exist in isolation (that's D3's <see cref="AuditEndpointsTests"/>, which
/// seeds rows directly since nothing wrote to the store yet). Same real-pipeline
/// <see cref="WebApplicationFactory{TEntryPoint}"/> convention as <see cref="AuthPipelineTests"/>/
/// <see cref="RbacPolicyTests"/>/<see cref="AuditEndpointsTests"/> (same env-var-swap-then-eager-build
/// recipe, same shared <see cref="SecurityEnvVarTests.CollectionName"/> collection tag).
///
/// Per test: perform the action AUTHENTICATED → <c>GET /v1/audit?action=...</c> as Admin → assert exactly
/// one matching row with the right action, actor = the LOGGED-IN user (never a client-supplied value),
/// and sensible old/new. Plus: onboarding never logs a raw <c>mk_</c> key (fingerprint only), and an
/// audit-store failure never fails the triggering mutation (WS-D-D4's "never stop production" policy).
/// </summary>
[Collection(SecurityEnvVarTests.CollectionName)]
public sealed class AuditWiringTests
{
    private static readonly SemaphoreSlim EnvLock = new(1, 1);
    private static readonly JsonSerializerOptions JsonOptions = new(JsonSerializerDefaults.Web);

    // ─────────────────────────────────────────────────────────────────────
    // Factory / user plumbing — same recipe as AuditEndpointsTests/RbacPolicyTests/AuthPipelineTests.
    // ─────────────────────────────────────────────────────────────────────

    private static async Task<WebApplicationFactory<Program>> CreateFactoryAsync(
        bool demoEnabled = false, Action<IServiceCollection>? configureServices = null)
    {
        var securityDir = Directory.CreateTempSubdirectory("st4i-audit-wiring-security-").FullName;
        var historianDir = Directory.CreateTempSubdirectory("st4i-audit-wiring-historian-").FullName;
        var walDir = Directory.CreateTempSubdirectory("st4i-audit-wiring-wal-").FullName;
        // FF-1 — isolated the same way as every other per-concern directory above: without this,
        // FleetHost.UpdateSettings' new persist-on-change behavior would read/write the REAL
        // %ProgramData%\ST4I\sim\settings\fleet-settings.json, leaking state across test runs (and across
        // the whole test suite, since it's a real file on disk) — this class's own settings.update tests
        // below would be especially prone to false pass/fail from stale persisted state.
        var settingsDir = Directory.CreateTempSubdirectory("st4i-audit-wiring-settings-").FullName;
        // EC-3 review follow-up — see SiteEndpointsTests' own doc comment: without these, every
        // WebApplicationFactory<Program> boot below (UNS defaults ON) resolves DeviceIdentityStore/
        // SiteLinkStore to the REAL %ProgramData%\ST4I\sim\identity\ / ...\sitelink\.
        var identityDir = Directory.CreateTempSubdirectory("st4i-audit-wiring-identity-").FullName;
        var siteLinkDir = Directory.CreateTempSubdirectory("st4i-audit-wiring-sitelink-").FullName;

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
            if (configureServices is not null)
            {
                factory = factory.WithWebHostBuilder(builder => builder.ConfigureServices(configureServices));
            }

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

    private static async Task<HttpClient> BootstrapAdminAsync(WebApplicationFactory<Program> factory, string username, string password)
    {
        var client = factory.CreateClient(new WebApplicationFactoryClientOptions { HandleCookies = true });
        using var bootstrap = await client.PostAsJsonAsync(
            "/v1/auth/bootstrap", new { username, password, displayName = (string?)null }, JsonOptions).ConfigureAwait(false);
        Assert.Equal(HttpStatusCode.OK, bootstrap.StatusCode);
        return client;
    }

    /// <summary>Queries <c>GET /v1/audit?action=</c> as the given (Admin) client and returns every
    /// matching row — the ONE shared read path every test below uses to check what actually got written.</summary>
    private static async Task<IReadOnlyList<AuditEntryDto>> GetAuditEntriesAsync(HttpClient adminClient, string action)
    {
        using var resp = await adminClient.GetAsync($"/v1/audit?action={Uri.EscapeDataString(action)}&limit=1000").ConfigureAwait(false);
        Assert.Equal(HttpStatusCode.OK, resp.StatusCode);
        var page = await resp.Content.ReadFromJsonAsync<AuditPageDto>(JsonOptions).ConfigureAwait(false);
        return page!.Items;
    }

    // ─────────────────────────────────────────────────────────────────────
    // mode.switch
    // ─────────────────────────────────────────────────────────────────────

    [Fact]
    public async Task ModeSwitch_WrittenByEngineer_RecordsActorAndOldNewMode()
    {
        await using var factory = await CreateFactoryAsync();
        using var adminClient = await BootstrapAdminAsync(factory, "aw-mode-admin", "AdminPass123!");
        await CreateUserAsync(factory, "aw-mode-engineer", "EngineerPass123!", Roles.Engineer);
        using var engineerClient = await LoginAsAsync(factory, "aw-mode-engineer", "EngineerPass123!");

        using var put = await engineerClient.PutAsJsonAsync("/v1/mode", new { mode = "Auto" }, JsonOptions);
        Assert.Equal(HttpStatusCode.OK, put.StatusCode);

        var entries = await GetAuditEntriesAsync(adminClient, "mode.switch");
        var entry = Assert.Single(entries);
        Assert.Equal("aw-mode-engineer", entry.ActorUsername);
        Assert.Equal("Live", entry.OldValueJson?.Trim('"'));
        Assert.Equal("Auto", entry.NewValueJson?.Trim('"'));
    }

    // ─────────────────────────────────────────────────────────────────────
    // settings.update + settings.verifyTls_disabled
    // ─────────────────────────────────────────────────────────────────────

    [Fact]
    public async Task SettingsUpdate_VerifyTlsTrueToFalse_AsAdmin_RecordsBothActions()
    {
        await using var factory = await CreateFactoryAsync();
        using var adminClient = await BootstrapAdminAsync(factory, "aw-settings-admin", "AdminPass123!");

        using var put = await adminClient.PutAsJsonAsync("/v1/settings", new { verifyTls = false }, JsonOptions);
        Assert.Equal(HttpStatusCode.OK, put.StatusCode);

        var updateEntries = await GetAuditEntriesAsync(adminClient, "settings.update");
        var updateEntry = Assert.Single(updateEntries);
        Assert.Equal("aw-settings-admin", updateEntry.ActorUsername);
        Assert.Contains("verifyTls", updateEntry.NewValueJson);

        var disabledEntries = await GetAuditEntriesAsync(adminClient, "settings.verifyTls_disabled");
        var disabledEntry = Assert.Single(disabledEntries);
        Assert.Equal("aw-settings-admin", disabledEntry.ActorUsername);
        Assert.Equal("true", disabledEntry.OldValueJson);
        Assert.Equal("false", disabledEntry.NewValueJson);
    }

    [Fact]
    public async Task SettingsUpdate_LanguageOnly_DoesNotRecordVerifyTlsDisabled()
    {
        await using var factory = await CreateFactoryAsync();
        using var adminClient = await BootstrapAdminAsync(factory, "aw-settings-admin-2", "AdminPass123!");

        using var put = await adminClient.PutAsJsonAsync("/v1/settings", new { language = "vi" }, JsonOptions);
        Assert.Equal(HttpStatusCode.OK, put.StatusCode);

        var updateEntries = await GetAuditEntriesAsync(adminClient, "settings.update");
        Assert.Single(updateEntries);

        var disabledEntries = await GetAuditEntriesAsync(adminClient, "settings.verifyTls_disabled");
        Assert.Empty(disabledEntries);
    }

    // ─────────────────────────────────────────────────────────────────────
    // product.upsert (a config-family upsert)
    // ─────────────────────────────────────────────────────────────────────

    [Fact]
    public async Task ProductUpsert_AsEngineer_RecordsNullOldAndTheSavedProductAsNew()
    {
        await using var factory = await CreateFactoryAsync();
        using var adminClient = await BootstrapAdminAsync(factory, "aw-product-admin", "AdminPass123!");
        await CreateUserAsync(factory, "aw-product-engineer", "EngineerPass123!", Roles.Engineer);
        using var engineerClient = await LoginAsAsync(factory, "aw-product-engineer", "EngineerPass123!");

        // ProductConfigStore (unlike OeeSettingsStore/the historian stores) has no per-test directory
        // override in Program.cs — it persists beside the test binary across EVERY run of this suite, not
        // just within one process. A GUID-suffixed code (never reused) is what keeps "old is null" a
        // reliable assertion regardless of what any earlier run of this same test already wrote to disk.
        var code = "AUDIT-MODEL-" + Guid.NewGuid().ToString("N")[..8].ToUpperInvariant();
        var body = new
        {
            code,
            name = "Audit Wiring Test Product",
            lifecycleStatus = "development",
            coordinateMode = "mm",
            pointsConfigVersion = 1,
            points = Array.Empty<object>(),
        };
        using var put = await engineerClient.PutAsJsonAsync($"/v1/products/{code}", body, JsonOptions);
        Assert.Equal(HttpStatusCode.OK, put.StatusCode);

        var entries = await GetAuditEntriesAsync(adminClient, "product.upsert");
        var entry = Assert.Single(entries);
        Assert.Equal("aw-product-engineer", entry.ActorUsername);
        Assert.Equal(code, entry.TargetId);
        Assert.Null(entry.OldValueJson); // brand-new product — no "before" state
        Assert.Contains(code, entry.NewValueJson);
    }

    // ─────────────────────────────────────────────────────────────────────
    // machine.settings.set — the `by` replacement: actor is the AUTHENTICATED user, never body.by.
    // ─────────────────────────────────────────────────────────────────────

    [Fact]
    public async Task MachineSettingsSet_AsEngineer_RecordsAuthenticatedActor_NotClientSuppliedBy()
    {
        await using var factory = await CreateFactoryAsync();
        using var adminClient = await BootstrapAdminAsync(factory, "aw-msettings-admin", "AdminPass123!");
        await CreateUserAsync(factory, "aw-msettings-engineer", "EngineerPass123!", Roles.Engineer);
        using var engineerClient = await LoginAsAsync(factory, "aw-msettings-engineer", "EngineerPass123!");

        // Read the CURRENT effective value first — MachineConfigStore persists beside the test binary
        // (no per-test directory override exists for it), so a fresh WebApplicationFactory can still
        // inherit state from an earlier run; reading before writing keeps this test correct regardless.
        using var getResp = await engineerClient.GetAsync("/v1/machines/AOI-01/settings");
        Assert.Equal(HttpStatusCode.OK, getResp.StatusCode);
        var before = ExtractExposureUs(await getResp.Content.ReadAsStringAsync());
        var newValue = Math.Clamp(before + 50, 50, 20000);

        // The wire DTO's `by` field is populated with an OBVIOUSLY-different, untrusted value — proving
        // the server ignores it in favor of the authenticated identity, not just that it happens to match.
        using var put = await engineerClient.PutAsJsonAsync(
            "/v1/machines/AOI-01/settings/exposureUs",
            new { value = newValue, scope = "machine", by = "someone-else-entirely" },
            JsonOptions);
        Assert.Equal(HttpStatusCode.OK, put.StatusCode);

        var entries = await GetAuditEntriesAsync(adminClient, "machine.settings.set");
        var entry = Assert.Single(entries);
        Assert.Equal("aw-msettings-engineer", entry.ActorUsername);
        Assert.NotEqual("someone-else-entirely", entry.ActorUsername);
        Assert.Equal("AOI-01:exposureUs", entry.TargetId);
        Assert.Equal(before, double.Parse(entry.OldValueJson!, System.Globalization.CultureInfo.InvariantCulture), 6);
        Assert.Equal(newValue, double.Parse(entry.NewValueJson!, System.Globalization.CultureInfo.InvariantCulture), 6);
    }

    private static double ExtractExposureUs(string settingsResponseJson)
    {
        using var doc = JsonDocument.Parse(settingsResponseJson);
        foreach (var p in doc.RootElement.GetProperty("effective").EnumerateArray())
        {
            if (p.GetProperty("def").GetProperty("key").GetString() == "exposureUs")
            {
                return p.GetProperty("value").GetDouble();
            }
        }

        throw new InvalidOperationException("exposureUs not found in /settings response — schema changed?");
    }

    // ─────────────────────────────────────────────────────────────────────
    // scenario.apply
    // ─────────────────────────────────────────────────────────────────────

    [Fact]
    public async Task ScenarioApply_AsEngineer_RecordsAppliedParams()
    {
        await using var factory = await CreateFactoryAsync();
        using var adminClient = await BootstrapAdminAsync(factory, "aw-scenario-admin", "AdminPass123!");
        await CreateUserAsync(factory, "aw-scenario-engineer", "EngineerPass123!", Roles.Engineer);
        using var engineerClient = await LoginAsAsync(factory, "aw-scenario-engineer", "EngineerPass123!");

        using var post = await engineerClient.PostAsJsonAsync("/v1/scenario", new { cycleRate = 1.5, defectRate = 0.02 }, JsonOptions);
        Assert.Equal(HttpStatusCode.OK, post.StatusCode);

        var entries = await GetAuditEntriesAsync(adminClient, "scenario.apply");
        var entry = Assert.Single(entries);
        Assert.Equal("aw-scenario-engineer", entry.ActorUsername);
        Assert.Contains("cycleRate", entry.NewValueJson);
    }

    // ─────────────────────────────────────────────────────────────────────
    // fleet.estop — "who pressed E-STOP", even though Operator-reachable.
    // ─────────────────────────────────────────────────────────────────────

    [Fact]
    public async Task FleetEstop_AsOperator_RecordsActor()
    {
        await using var factory = await CreateFactoryAsync();
        using var adminClient = await BootstrapAdminAsync(factory, "aw-estop-admin", "AdminPass123!");
        await CreateUserAsync(factory, "aw-estop-operator", "OperatorPass123!", Roles.Operator);
        using var operatorClient = await LoginAsAsync(factory, "aw-estop-operator", "OperatorPass123!");

        using var post = await operatorClient.PostAsync("/v1/fleet/estop", null);
        Assert.Equal(HttpStatusCode.OK, post.StatusCode);

        var entries = await GetAuditEntriesAsync(adminClient, "fleet.estop");
        var entry = Assert.Single(entries);
        Assert.Equal("aw-estop-operator", entry.ActorUsername);
    }

    // ─────────────────────────────────────────────────────────────────────
    // historian.prune
    // ─────────────────────────────────────────────────────────────────────

    [Fact]
    public async Task HistorianPrune_AsAdmin_RecordsCutoffAndDeletedCount()
    {
        await using var factory = await CreateFactoryAsync();
        using var adminClient = await BootstrapAdminAsync(factory, "aw-prune-admin", "AdminPass123!");

        using var post = await adminClient.PostAsJsonAsync("/v1/historian/prune", new { olderThanDays = 9999 }, JsonOptions);
        Assert.Equal(HttpStatusCode.OK, post.StatusCode);

        var entries = await GetAuditEntriesAsync(adminClient, "historian.prune");
        var entry = Assert.Single(entries);
        Assert.Equal("aw-prune-admin", entry.ActorUsername);
        Assert.Contains("cutoffUtc", entry.NewValueJson);
        Assert.Contains("deletedCount", entry.NewValueJson);
    }

    // ─────────────────────────────────────────────────────────────────────
    // historian.oee_settings.update
    // ─────────────────────────────────────────────────────────────────────

    [Fact]
    public async Task OeeSettingsUpdate_AsEngineer_RecordsOldAndNewForTheMachine()
    {
        await using var factory = await CreateFactoryAsync();
        using var adminClient = await BootstrapAdminAsync(factory, "aw-oee-admin", "AdminPass123!");
        await CreateUserAsync(factory, "aw-oee-engineer", "EngineerPass123!", Roles.Engineer);
        using var engineerClient = await LoginAsAsync(factory, "aw-oee-engineer", "EngineerPass123!");

        using var put = await engineerClient.PutAsJsonAsync(
            "/v1/historian/oee/settings?machine=SCRW-01",
            new { idealCycleSecondsOverride = 0.5, plannedProductionRatio = 0.75 },
            JsonOptions);
        Assert.Equal(HttpStatusCode.OK, put.StatusCode);

        var entries = await GetAuditEntriesAsync(adminClient, "historian.oee_settings.update");
        var entry = Assert.Single(entries);
        Assert.Equal("aw-oee-engineer", entry.ActorUsername);
        Assert.Equal("SCRW-01", entry.TargetId);
        Assert.Contains("0.5", entry.NewValueJson);
    }

    // ─────────────────────────────────────────────────────────────────────
    // auth.login_success / auth.login_failed
    // ─────────────────────────────────────────────────────────────────────

    [Fact]
    public async Task Login_SuccessAndFailure_BothRecorded()
    {
        await using var factory = await CreateFactoryAsync();
        using var adminClient = await BootstrapAdminAsync(factory, "aw-login-admin", "AdminPass123!");

        // The bootstrap call itself signs in — that's a login_success-shaped event captured by
        // auth.bootstrap, not auth.login_success. A SEPARATE, explicit login below is what this test
        // is actually about.
        using (var goodLogin = await factory.CreateClient(new WebApplicationFactoryClientOptions { HandleCookies = true })
                   .PostAsJsonAsync("/v1/auth/login", new { username = "aw-login-admin", password = "AdminPass123!" }, JsonOptions))
        {
            Assert.Equal(HttpStatusCode.OK, goodLogin.StatusCode);
        }

        using (var badLogin = await factory.CreateClient()
                   .PostAsJsonAsync("/v1/auth/login", new { username = "aw-login-admin", password = "WrongPassword!" }, JsonOptions))
        {
            Assert.Equal(HttpStatusCode.Unauthorized, badLogin.StatusCode);
        }

        var successEntries = await GetAuditEntriesAsync(adminClient, "auth.login_success");
        Assert.Single(successEntries, e => e.ActorUsername == "aw-login-admin");

        var failedEntries = await GetAuditEntriesAsync(adminClient, "auth.login_failed");
        var failedEntry = Assert.Single(failedEntries);
        Assert.Equal("aw-login-admin", failedEntry.TargetId);
    }

    // ─────────────────────────────────────────────────────────────────────
    // onboarding — fingerprint only, NEVER the raw mk_ key.
    // ─────────────────────────────────────────────────────────────────────

    [Fact]
    public async Task OnboardingClaim_RecordsKeyFingerprint_NeverTheRawKey()
    {
        // demoEnabled:true means DemoAutoLoginMiddleware auto-creates + signs in "demo-admin" (Roles.Admin)
        // on the VERY FIRST request that reaches the pipeline — before any handler runs. Bootstrapping a
        // SECOND admin on top of that would 409 (the store is no longer empty) — so this test uses the
        // auto-logged-in demo-admin directly for BOTH the onboarding call (Admin satisfies the Engineer
        // policy too) and the audit read, exactly like AuthPipelineTests.DemoModeEnabled_... already does.
        await using var factory = await CreateFactoryAsync(demoEnabled: true);
        using var client = factory.CreateClient(new WebApplicationFactoryClientOptions { HandleCookies = true });

        using var claim = await client.PostAsJsonAsync(
            "/v1/onboarding/claim", new { serialNumber = "AUDIT-SIM-1", isDemo = true }, JsonOptions);
        Assert.Equal(HttpStatusCode.OK, claim.StatusCode);
        var claimBody = await claim.Content.ReadAsStringAsync();
        using var claimDoc = JsonDocument.Parse(claimBody);
        var rawKey = claimDoc.RootElement.GetProperty("mkKey").GetString();
        Assert.NotNull(rawKey);
        Assert.StartsWith("mk_", rawKey);

        var entries = await GetAuditEntriesAsync(client, "onboarding.claim");
        var entry = Assert.Single(entries);
        Assert.Equal(DemoAutoLoginMiddleware.DemoUsername, entry.ActorUsername);

        // NEVER the raw key, anywhere in the row. (The onboarding result's own descriptive `message`
        // legitimately mentions the PHRASE "mk_ key fabricated" in prose — that's fine, it's the concept,
        // not the secret; only the actual key VALUE is what must never appear.)
        Assert.DoesNotContain(rawKey!, entry.NewValueJson);

        // Fingerprint present instead — first 8 lowercase hex chars of the key's own SHA-256.
        using var newDoc = JsonDocument.Parse(entry.NewValueJson!);
        var fingerprint = newDoc.RootElement.GetProperty("keyFingerprint").GetString();
        Assert.NotNull(fingerprint);
        Assert.Equal(8, fingerprint!.Length);
        Assert.Matches("^[0-9a-f]{8}$", fingerprint);

        var expectedFingerprint = Convert.ToHexString(
            System.Security.Cryptography.SHA256.HashData(System.Text.Encoding.UTF8.GetBytes(rawKey!)))[..8].ToLowerInvariant();
        Assert.Equal(expectedFingerprint, fingerprint);
    }

    // ─────────────────────────────────────────────────────────────────────
    // machine.config.sync — the D4-review-flagged gap this task (D5) closes.
    // ─────────────────────────────────────────────────────────────────────

    [Fact]
    public async Task MachineConfigSync_AsEngineer_RecordsAuthenticatedActorAndResultSummary()
    {
        await using var factory = await CreateFactoryAsync();
        using var adminClient = await BootstrapAdminAsync(factory, "aw-sync-admin", "AdminPass123!");
        await CreateUserAsync(factory, "aw-sync-engineer", "EngineerPass123!", Roles.Engineer);
        using var engineerClient = await LoginAsAsync(factory, "aw-sync-engineer", "EngineerPass123!");

        using var post = await engineerClient.PostAsync("/v1/machines/AOI-01/sync-config", null);
        Assert.Equal(HttpStatusCode.OK, post.StatusCode);

        var entries = await GetAuditEntriesAsync(adminClient, "machine.config.sync");
        var entry = Assert.Single(entries);
        Assert.Equal("aw-sync-engineer", entry.ActorUsername);
        Assert.Equal("AOI-01", entry.TargetId);
        Assert.Null(entry.OldValueJson); // a version CHECK, not an old->new field edit — nothing "before" to record.
        Assert.Contains("driftState", entry.NewValueJson);
        Assert.Contains("changed", entry.NewValueJson);
    }

    // ─────────────────────────────────────────────────────────────────────
    // system.startup — WS-D-D5's loopback-exposure startup check writes this row regardless of risk;
    // BindingRiskTests covers the risk-detection LOGIC itself (pure, fully unit-tested in isolation) — this
    // just proves the row actually gets written when a real host starts. `_ = factory.Server` inside
    // CreateFactoryAsync already forced the host to build+start (and ApplicationStarted to fire) before
    // this test ever runs a request, so the row is guaranteed to exist by the time it queries for it.
    // ─────────────────────────────────────────────────────────────────────

    [Fact]
    public async Task SystemStartup_RecordedWhenHostStarts()
    {
        await using var factory = await CreateFactoryAsync();
        using var adminClient = await BootstrapAdminAsync(factory, "aw-startup-admin", "AdminPass123!");

        var entries = await GetAuditEntriesAsync(adminClient, "system.startup");
        var entry = Assert.Single(entries);
        Assert.Equal("(system)", entry.ActorUsername);
        Assert.Equal("(system)", entry.ActorRole);
        Assert.Contains("boundUrls", entry.NewValueJson);

        // The Mvc.Testing host binds an ephemeral loopback TestServer address — risk should be null here,
        // but per the brief this test's real job is just proving the row is written; the risk-detection
        // logic itself is BindingRiskTests' job.
        Assert.Contains("risk", entry.NewValueJson);
    }

    // ─────────────────────────────────────────────────────────────────────
    // WS-D-D4 failure policy — an audit-store failure must NEVER fail the triggering mutation.
    // ─────────────────────────────────────────────────────────────────────

    private sealed class ThrowingAuditStore : IAuditStore
    {
        public Task<AuditEntry> AppendAsync(AuditAppend e, CancellationToken ct) =>
            throw new InvalidOperationException("simulated audit store failure (WS-D-D4 failure-policy test)");

        public Task<AuditPage> QueryAsync(
            DateTimeOffset? from, DateTimeOffset? to, string? actor, string? action, string? target, int limit, int offset, CancellationToken ct) =>
            Task.FromResult(new AuditPage(Array.Empty<AuditEntry>(), 0, limit, offset));

        public Task<AuditVerifyResult> VerifyChainAsync(CancellationToken ct) =>
            Task.FromResult(new AuditVerifyResult(true, null, "n/a — ThrowingAuditStore never appends anything real."));
    }

    /// <summary>Captures every log entry emitted through the DI-registered <see cref="ILoggerFactory"/> —
    /// used here to prove <see cref="AuditRecorder"/> actually LOGS the swallowed exception (not just
    /// "doesn't throw", which a no-op catch could also satisfy).</summary>
    private sealed class CapturingLoggerProvider : ILoggerProvider
    {
        public readonly ConcurrentBag<(LogLevel Level, string Message)> Entries = new();

        public ILogger CreateLogger(string categoryName) => new CapturingLogger(this);

        public void Dispose()
        {
        }

        private sealed class CapturingLogger : ILogger
        {
            private readonly CapturingLoggerProvider _owner;
            public CapturingLogger(CapturingLoggerProvider owner) => _owner = owner;

            public IDisposable? BeginScope<TState>(TState state) where TState : notnull => null;

            public bool IsEnabled(LogLevel logLevel) => true;

            public void Log<TState>(
                LogLevel logLevel, EventId eventId, TState state, Exception? exception, Func<TState, Exception?, string> formatter) =>
                _owner.Entries.Add((logLevel, formatter(state, exception)));
        }
    }

    [Fact]
    public async Task AuditStoreFailure_DoesNotFailTheMutation_AndLogsAnError()
    {
        var capturingLogger = new CapturingLoggerProvider();

        await using var factory = await CreateFactoryAsync(configureServices: services =>
        {
            services.RemoveAll<IAuditStore>();
            services.AddSingleton<IAuditStore>(new ThrowingAuditStore());
            services.AddLogging(lb =>
            {
                lb.SetMinimumLevel(LogLevel.Trace);
                lb.AddProvider(capturingLogger);
            });
        });

        using var adminClient = await BootstrapAdminAsync(factory, "aw-failure-admin", "AdminPass123!");

        // Any mutation that calls recorder.RecordAsync exercises the failure path — mode.switch is the
        // simplest one available to an Admin with no extra setup.
        using var put = await adminClient.PutAsJsonAsync("/v1/mode", new { mode = "Auto" }, JsonOptions);

        // The mutation itself MUST still succeed — "never stop production for a support subsystem".
        Assert.Equal(HttpStatusCode.OK, put.StatusCode);
        using var modeDoc = JsonDocument.Parse(await put.Content.ReadAsStringAsync());
        Assert.Equal("Auto", modeDoc.RootElement.GetProperty("mode").GetString());

        // And the failure must have been logged (not silently no-op'd) — at least one Error-level entry
        // mentioning the swallowed exception's audit-specific message.
        Assert.Contains(
            capturingLogger.Entries,
            e => e.Level == LogLevel.Error && e.Message.Contains("Audit append failed", StringComparison.Ordinal));
    }
}
