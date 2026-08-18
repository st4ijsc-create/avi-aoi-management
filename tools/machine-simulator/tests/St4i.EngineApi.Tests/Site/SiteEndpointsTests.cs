using System.Net;
using System.Net.Http.Json;
using System.Security.Cryptography;
using System.Security.Cryptography.X509Certificates;
using System.Text.Json;
using System.Text.RegularExpressions;
using Microsoft.AspNetCore.Identity;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging;
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
    /// <param name="unsEnabled">See this method's own doc comment.</param>
    /// <param name="siteLinkDirOverride">🔴 Task Q-1 fix round — lets a caller point the boot at a
    /// <c>ST4I_SITELINK_DIR</c> it has already populated, which is the only way to observe what the
    /// composition root does to a <c>site-link.json</c> that is ALREADY on disk when the host starts. Every
    /// other test here starts from an empty directory.</param>
    /// <param name="capturedLog">🔴 Task Q-1 fix round — captures LEVEL as well as text, for the same
    /// reason <c>StartupSettingsReplayHardeningTests</c> does it: a demoted log call would leave every
    /// string assertion green while the operator learned nothing.</param>
    private static async Task<WebApplicationFactory<Program>> CreateFactoryAsync(
        bool unsEnabled = true,
        string? siteLinkDirOverride = null,
        List<(LogLevel Level, string Message)>? capturedLog = null)
    {
        var securityDir = Directory.CreateTempSubdirectory("st4i-site-ep-security-").FullName;
        var historianDir = Directory.CreateTempSubdirectory("st4i-site-ep-historian-").FullName;
        var walDir = Directory.CreateTempSubdirectory("st4i-site-ep-wal-").FullName;
        var settingsDir = Directory.CreateTempSubdirectory("st4i-site-ep-settings-").FullName;
        var siteLinkDir = siteLinkDirOverride ?? Directory.CreateTempSubdirectory("st4i-site-ep-sitelink-").FullName;
        var identityDir = Directory.CreateTempSubdirectory("st4i-site-ep-identity-").FullName;
        // GĐ3 sub-4 LC-1 review follow-up — isolated the same way as every other per-concern directory
        // above: without this, a real Policy DENY occurring anywhere in this class's requests
        // (PolicyResults.DenyAsync now resolves IAlarmStore and raises an alarm) would resolve AlarmStore
        // against the REAL %ProgramData%\ST4I\sim\alarms\alarms.db instead of a throwaway temp dir.
        var alarmsDir = Directory.CreateTempSubdirectory("st4i-site-ep-alarms-").FullName;
        // GĐ3 closeout WI-3 — without this, every WebApplicationFactory<Program> boot below with UNS enabled
        // has Program.cs construct a REAL BridgeSpool against %ProgramData%\ST4I\sim\bridge-spool\ — this
        // class in particular actually mutates the Site link via PUT, driving real UnsBridge construction.
        var bridgeSpoolDir = Directory.CreateTempSubdirectory("st4i-site-ep-bridgespool-").FullName;
        var connectorConfigDir = Directory.CreateTempSubdirectory("st4i-site-ep-connectorconfig-").FullName;

        await EnvLock.WaitAsync().ConfigureAwait(false);
        var prevSecurityDir = Environment.GetEnvironmentVariable("ST4I_SECURITY_DIR");
        var prevDemoEnabled = Environment.GetEnvironmentVariable("ST4I_DEMO_ENABLED");
        var prevHistorianDir = Environment.GetEnvironmentVariable("ST4I_HISTORIAN_DIR");
        var prevWalDir = Environment.GetEnvironmentVariable("ST4I_WAL_DIR");
        var prevSettingsDir = Environment.GetEnvironmentVariable("ST4I_SETTINGS_DIR");
        var prevSiteLinkDir = Environment.GetEnvironmentVariable("ST4I_SITELINK_DIR");
        var prevIdentityDir = Environment.GetEnvironmentVariable("ST4I_IDENTITY_DIR");
        var prevUnsEnabled = Environment.GetEnvironmentVariable("ST4I_UNS_ENABLED");
        var prevAlarmsDir = Environment.GetEnvironmentVariable("ST4I_ALARMS_DIR");
        var prevBridgeSpoolDir = Environment.GetEnvironmentVariable("ST4I_BRIDGE_SPOOL_DIR");
        var prevConnectorConfigDir = Environment.GetEnvironmentVariable("ST4I_CONNECTOR_CONFIG_DIR");
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
            Environment.SetEnvironmentVariable("ST4I_ALARMS_DIR", alarmsDir);
            Environment.SetEnvironmentVariable("ST4I_BRIDGE_SPOOL_DIR", bridgeSpoolDir);
            Environment.SetEnvironmentVariable("ST4I_CONNECTOR_CONFIG_DIR", connectorConfigDir);
            Environment.SetEnvironmentVariable("ASPNETCORE_ENVIRONMENT", "Production");

            var factory = capturedLog is null
                ? new WebApplicationFactory<Program>()
                : new WebApplicationFactory<Program>().WithWebHostBuilder(b =>
                    b.ConfigureServices(services =>
                        services.AddSingleton<ILoggerProvider>(new CapturingLoggerProvider(capturedLog))));
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
            Environment.SetEnvironmentVariable("ST4I_ALARMS_DIR", prevAlarmsDir);
            Environment.SetEnvironmentVariable("ST4I_BRIDGE_SPOOL_DIR", prevBridgeSpoolDir);
            Environment.SetEnvironmentVariable("ST4I_CONNECTOR_CONFIG_DIR", prevConnectorConfigDir);
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
    // 🔴 Task Q-1 fix round — the third state for site-link.json.
    // ─────────────────────────────────────────────────────────────────────

    /// <summary>
    /// 🔴 <b>Task Q-1 fix round — an ordinary, successful start must not destroy a <c>site-link.json</c>
    /// it could not read. The control-pair witness for the twin: it FAILS at <c>d83194bd</c> and passes
    /// after the fix, and what it reads is the bytes on disk.</b>
    ///
    /// <para><b>The defect.</b> <c>SiteLinkStore.Load()</c> answered null both for "no file" and for "a file
    /// this process could not read". <c>Program.cs</c> turned that null into
    /// <c>new PersistedSiteLink()</c> and handed it to <c>SiteBridgeManager.ApplyAsync</c>, which calls
    /// <c>_store.Save(link)</c> <b>unconditionally</b> — before the <c>link.Enabled</c> check and outside any
    /// success condition. So an unreadable file was rewritten with <c>Enabled=false, Host="", Port=8883,
    /// SiteTrustPem=""</c> on a start where nothing failed. The Site broker host, its port and the pinned
    /// trust anchor were gone and the device was silently standalone; because <c>Save</c> SUCCEEDED, the
    /// manager's <c>_logError</c> never fired either.</para>
    ///
    /// <para>🔴 <b>Its precondition was WEAKER than the settings defect this task first fixed.</b> That one
    /// needed at least one of three <c>ST4I_*</c> variables to be set. This one needs nothing an operator
    /// has to have done: <c>UnsOptions.Enabled</c> defaults to <see langword="true"/>, which is why this
    /// test sets no environment variable to provoke it and passes <c>unsEnabled</c> at its default.</para>
    ///
    /// <para><b>It reads the bytes, not <c>Load()</c>.</b> <c>Load()</c> answers null for a malformed file,
    /// so a witness written through it would pass whether the file were intact, rewritten with the default
    /// record, or deleted.</para>
    /// </summary>
    [Fact]
    public async Task AMalformedSiteLinkFile_SurvivesAnOrdinarySuccessfulStart_AndTheHostSaysSo()
    {
        var siteLinkDir = Directory.CreateTempSubdirectory("st4i-q1-sitelink-unreadable-").FullName;
        var siteLinkFile = Path.Combine(siteLinkDir, "site-link.json");

        // A hand-edit with one typo in it — a missing closing brace. Every field is still legible, which is
        // exactly why destroying it is a loss: these bytes are the only remaining record of the link.
        const string OperatorsOwnBytes =
            "{\n  \"Enabled\": true,\n  \"Host\": \"q1-site-operators-own.example.test\",\n" +
            "  \"Port\": 8885,\n  \"SiteTrustPem\": \"-----BEGIN CERTIFICATE-----\\nQ1PIN\\n-----END CERTIFICATE-----\",\n";
        File.WriteAllText(siteLinkFile, OperatorsOwnBytes);

        var log = new List<(LogLevel Level, string Message)>();
        await using var factory = await CreateFactoryAsync(siteLinkDirOverride: siteLinkDir, capturedLog: log);

        // The host is UP — this arm reports, it does not stop.
        await BootstrapAdminAsync(factory, "site-q1-admin", "AdminPass123!");
        await CreateUserAsync(factory, "site-q1-operator", "OperatorPass123!", Roles.Operator);
        using var operatorClient = await LoginAsAsync(factory, "site-q1-operator", "OperatorPass123!");
        using var get = await operatorClient.GetAsync("/v1/site");
        Assert.Equal(HttpStatusCode.OK, get.StatusCode);

        // (1) THE DATA-LOSS ASSERTION. The bytes are the operator's, unchanged, still there.
        Assert.True(File.Exists(siteLinkFile), "site-link.json is GONE after a start in which nothing failed.");
        Assert.Equal(OperatorsOwnBytes, File.ReadAllText(siteLinkFile));

        // (2) And the process is honest about what it is running: standalone, no bridge. This is NOT the
        // operator's link being reported back — it is the absence of one, which is the truth here.
        var status = await get.Content.ReadFromJsonAsync<SiteStatusDto>(JsonOptions);
        Assert.NotNull(status);
        Assert.False(status!.Enabled);
        Assert.Equal("Disabled", status.BridgeState);

        // (3) It was said, at a level the framework's default filter emits, and it names the file.
        List<(LogLevel Level, string Message)> notices;
        lock (log) notices = log.Where(e => e.Message.Contains(UnreadableSiteLinkMarker, StringComparison.Ordinal)).ToList();

        Assert.True(notices.Count > 0,
            "The host booted, refused to apply a Site link it could not read, and said NOTHING — which is " +
            "the whole defect: a device that has quietly stopped federating looks identical to one that was " +
            "never configured. Captured lines: " +
            string.Join(" | ", log.Select(e => $"[{e.Level}] {e.Message}")));
        Assert.All(notices, entry => Assert.Equal(LogLevel.Error, entry.Level));
        Assert.Contains(notices, e => e.Message.Contains("site-link.json", StringComparison.Ordinal));
    }

    private const string UnreadableSiteLinkMarker = "SITE LINK FILE COULD NOT BE READ";

    /// <summary>
    /// 🔴 <b>Fix round 2 (review N3) — the claim "<c>ApplyAsync</c> holds the only <c>Save</c> of this file
    /// in the whole product" was load-bearing and had no census. This is it.</b>
    ///
    /// <para><b>Why it is load-bearing rather than decoration.</b> The <c>Error</c> message this task added
    /// tells an operator the file *"was NOT overwritten or deleted by this start"*. That sentence is only
    /// true because the composition root skipping <c>ApplyAsync</c> skips the **only** writer. A second
    /// writer anywhere in <c>src/</c> makes the product tell the operator something false at the exact
    /// moment they are deciding whether their configuration still exists. Its settings counterpart has had
    /// a census since fix round 2 of H-1a
    /// (<c>StartupSettingsReplayHardeningTests.TheStartupReplayHasExactlyOneArm_…</c>); this one did not,
    /// and an enumeration is verified by the check that could refute it, never by re-reading the members it
    /// names.</para>
    ///
    /// <para><b>TWO populations, asserted apart, because they fail differently.</b> (1) A writer that goes
    /// <i>through the store</i> must name the type <c>SiteLinkStore</c> somewhere in its file in order to
    /// obtain one — as a field type, a parameter type, a <c>new</c>, or a <c>GetRequiredService&lt;&gt;</c>
    /// — so the file set is indexed on the TYPE NAME and the <c>.Save(</c> count is taken inside it.
    /// (2) A writer that <i>bypasses the store</i> would not name the type at all; it would name the FILE,
    /// so the literal <c>site-link.json</c> is swept separately across all of <c>src/</c>. Neither sweep
    /// can see the other's population, which is why a single number would have been the weaker check.</para>
    ///
    /// <para>🔴 <b>Task Z-1 — RENAMED from <c>…_AndItIsApplyAsync</c>, because that name became false in
    /// the same diff that made it false.</b> Owner-decisions item 8 moved the persist decision to the
    /// caller, so the one <c>.Save(</c> now lives in <c>ApplyCoreAsync</c> and <c>ApplyAsync</c> contains
    /// none. The first round of Z-1 corrected the failure MESSAGE and left the member name — which is the
    /// exact defect class Z-1 itself invoked (P-2: a member's spelling is a published string) to justify
    /// adding a whole exception base rather than widening one type's meaning. Same law, same task, two
    /// answers, until review I-4 caught it. The property being measured is unchanged: ONE writer in
    /// <c>src/</c>, and skipping the entry point that reaches it skips the only writer.</para>
    ///
    /// <para>🔴 <b>What it cannot reach, stated rather than left to be discovered.</b> It is a source scan.
    /// It cannot see a writer that obtains a <c>SiteLinkStore</c> without its file ever spelling the type
    /// (through a non-generic factory or an untyped service locator), and it cannot see a path that
    /// composes the file name from fragments. Those are the same stated non-reaches the settings census
    /// carries, and the answer there is the same: the end-to-end witness above asserts a property of the
    /// FILE, so a second writer of ANY shape fails it whatever it is called.</para>
    /// </summary>
    [Fact]
    public void TheSiteLinkFileHasExactlyOneWriterInSrc_AndItIsTheSharedApplyBody()
    {
        var root = MachineSimulatorRoot();
        var srcFiles = Directory
            .EnumerateFiles(Path.Combine(root, "src"), "*.cs", SearchOption.AllDirectories)
            .Where(f => !f.Contains($"{Path.DirectorySeparatorChar}bin{Path.DirectorySeparatorChar}", StringComparison.Ordinal)
                     && !f.Contains($"{Path.DirectorySeparatorChar}obj{Path.DirectorySeparatorChar}", StringComparison.Ordinal))
            .ToList();

        // (1) Through the store: every file that names the type at all, then every `.Save(` inside it.
        var writeSites = srcFiles
            .Select(f => (Path: f, Lines: File.ReadAllLines(f)))
            .Where(x => x.Lines.Any(l => l.Contains("SiteLinkStore", StringComparison.Ordinal)))
            .SelectMany(x => x.Lines
                .Select((line, n) => (File: Path.GetRelativePath(root, x.Path).Replace('\\', '/'), Line: n + 1, Text: line.Trim()))
                .Where(y => Regex.IsMatch(y.Text, @"\.Save\s*\(") && !y.Text.StartsWith("//", StringComparison.Ordinal)))
            .Select(y => $"{y.File}:{y.Line}")
            .OrderBy(x => x, StringComparer.Ordinal)
            .ToList();

        Assert.True(writeSites.Count == 1,
            $"site-link.json has {writeSites.Count} writer(s) in src/: {string.Join(", ", writeSites)}. " +
            "There must be exactly ONE, in SiteBridgeManager's shared apply body (ApplyCoreAsync), reached " +
            "with persist:true from ApplyAsync and NOT reached at all from ReapplyCurrentAsync — task Z-1, " +
            "owner-decisions item 8. Program.cs's unreadable arm tells " +
            "the operator the file 'was NOT overwritten or deleted by this start', and that sentence is " +
            "true only because skipping ApplyAsync skips the only writer. A second writer makes the " +
            "product lie at the moment an operator is deciding whether their Site configuration still " +
            "exists. If a second one is deliberate, the Error message in Program.cs has to be rewritten in " +
            "the same commit.");
        Assert.Contains("SiteBridgeManager.cs", writeSites[0], StringComparison.Ordinal);

        // (2) Bypassing the store: anything in src/ that names the FILE itself. The store owns the name and
        // keeps it private, so the only legitimate occurrence is that private constant.
        var fileNameSites = srcFiles
            .SelectMany(f => File.ReadAllLines(f)
                .Select((line, n) => (File: Path.GetRelativePath(root, f).Replace('\\', '/'), Line: n + 1, Text: line.Trim()))
                .Where(x => x.Text.Contains("site-link.json", StringComparison.Ordinal)
                         && !x.Text.StartsWith("//", StringComparison.Ordinal)
                         && !x.Text.StartsWith("///", StringComparison.Ordinal)
                         && !x.Text.StartsWith("*", StringComparison.Ordinal)))
            .Select(x => $"{x.File}:{x.Line}")
            .OrderBy(x => x, StringComparer.Ordinal)
            .ToList();

        Assert.True(fileNameSites.Count == 1,
            $"The literal \"site-link.json\" appears at {fileNameSites.Count} non-comment site(s) in src/: " +
            string.Join(", ", fileNameSites) + ". SiteLinkStore owns that name and keeps it private, so the " +
            "only one should be its own FileName constant. A second occurrence is a path composed outside " +
            "the store — which the writer census above cannot see, because such a caller need never name " +
            "the type.");
        Assert.Contains("SiteLinkStore.cs", fileNameSites[0], StringComparison.Ordinal);
    }

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
            "Could not locate tools/machine-simulator by walking up from " +
            $"\"{AppContext.BaseDirectory}\". Fix this walk — do NOT weaken the assertions above.");
    }

    /// <summary>Captures LEVEL as well as text; <c>IsEnabled</c> is deliberately unconditional so a demoted
    /// call is still captured and caught by the level assertion rather than vanishing into an empty list
    /// that reads identically to "the code path never ran". Same shape as
    /// <c>StartupSettingsReplayHardeningTests</c>' own provider, duplicated rather than shared because the
    /// two suites are separate assemblies with no common test-helper project between them.</summary>
    private sealed class CapturingLoggerProvider : ILoggerProvider
    {
        private readonly List<(LogLevel Level, string Message)> _entries;
        public CapturingLoggerProvider(List<(LogLevel Level, string Message)> entries) => _entries = entries;
        public ILogger CreateLogger(string categoryName) => new CapturingLogger(_entries);
        public void Dispose() { }

        private sealed class CapturingLogger : ILogger
        {
            private readonly List<(LogLevel Level, string Message)> _entries;
            public CapturingLogger(List<(LogLevel Level, string Message)> entries) => _entries = entries;
            public IDisposable? BeginScope<TState>(TState state) where TState : notnull => null;
            public bool IsEnabled(LogLevel logLevel) => true;

            public void Log<TState>(
                LogLevel logLevel, EventId eventId, TState state, Exception? exception,
                Func<TState, Exception?, string> formatter)
            {
                lock (_entries) _entries.Add((logLevel, formatter(state, exception)));
            }
        }
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

        // GĐ3 closeout WI-4 — a freshly-minted identity (LoadOrCreate, ~10-year validity) is FAR outside
        // the default 30-day expiry-warn window: NotAfterUtc years out, DaysToExpiry a large positive number.
        Assert.True(identity.NotAfterUtc > DateTimeOffset.UtcNow.AddYears(5));
        Assert.True(identity.DaysToExpiry > 3000);

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

    // ─────────────────────────────────────────────────────────────────────
    // POST /v1/site/identity/rotate — GĐ3 closeout WI-4 (+ fix round 1, Important #3). Admin only; 200 + a
    // new fingerprint + an audited "site.identity.rotate" row for Admin; works even with UNS disabled
    // (nothing to re-apply, but the identity itself still rotates — see RotateIdentityAsync's own doc
    // comment). Fix round 1 changed the request contract: the caller must now echo the device's CURRENT
    // fingerprint as { currentFingerprint } — 400 if missing/blank, 409 on a mismatch (see
    // RotateIdentityRequest's own doc comment for why).
    // ─────────────────────────────────────────────────────────────────────

    [Fact]
    public async Task Operator_PostsRotate_Gets403()
    {
        await using var factory = await CreateFactoryAsync();
        await BootstrapAdminAsync(factory, "site-admin-15", "AdminPass123!");
        await CreateUserAsync(factory, "site-operator-15", "OperatorPass123!", Roles.Operator);

        using var operatorClient = await LoginAsAsync(factory, "site-operator-15", "OperatorPass123!");

        // 403 happens in the authorization middleware, BEFORE the handler ever parses a body — an empty
        // body is fine here; a non-Admin is rejected regardless of what (if anything) it would have sent.
        using var rotate = await operatorClient.PostAsync("/v1/site/identity/rotate", null);
        Assert.Equal(HttpStatusCode.Forbidden, rotate.StatusCode);
    }

    [Fact]
    public async Task Engineer_PostsRotate_Gets403()
    {
        await using var factory = await CreateFactoryAsync();
        await BootstrapAdminAsync(factory, "site-admin-16", "AdminPass123!");
        await CreateUserAsync(factory, "site-engineer-16", "EngineerPass123!", Roles.Engineer);

        using var engineerClient = await LoginAsAsync(factory, "site-engineer-16", "EngineerPass123!");

        using var rotate = await engineerClient.PostAsync("/v1/site/identity/rotate", null);
        Assert.Equal(HttpStatusCode.Forbidden, rotate.StatusCode);
    }

    [Fact]
    public async Task Admin_PostsRotate_MissingOrBlankCurrentFingerprint_Gets400()
    {
        await using var factory = await CreateFactoryAsync();
        await BootstrapAdminAsync(factory, "site-admin-19", "AdminPass123!");
        using var adminClient = await LoginAsAsync(factory, "site-admin-19", "AdminPass123!");

        using var noBody = await adminClient.PostAsync("/v1/site/identity/rotate", null);
        Assert.Equal(HttpStatusCode.BadRequest, noBody.StatusCode);

        using var nullField = await adminClient.PostAsJsonAsync(
            "/v1/site/identity/rotate", new { currentFingerprint = (string?)null }, JsonOptions);
        Assert.Equal(HttpStatusCode.BadRequest, nullField.StatusCode);

        using var blankField = await adminClient.PostAsJsonAsync(
            "/v1/site/identity/rotate", new { currentFingerprint = "   " }, JsonOptions);
        Assert.Equal(HttpStatusCode.BadRequest, blankField.StatusCode);
    }

    [Fact]
    public async Task Admin_PostsRotate_MismatchedCurrentFingerprint_Gets409_AndDoesNotRotate()
    {
        await using var factory = await CreateFactoryAsync();
        await BootstrapAdminAsync(factory, "site-admin-20", "AdminPass123!");
        using var adminClient = await LoginAsAsync(factory, "site-admin-20", "AdminPass123!");

        using var beforeResp = await adminClient.GetAsync("/v1/site/identity");
        var before = await beforeResp.Content.ReadFromJsonAsync<SiteIdentityDto>(JsonOptions);

        using var rotate = await adminClient.PostAsJsonAsync(
            "/v1/site/identity/rotate", new { currentFingerprint = "NOT-THE-REAL-FINGERPRINT" }, JsonOptions);
        Assert.Equal(HttpStatusCode.Conflict, rotate.StatusCode);

        // The rejected mismatch must not have rotated anything — the identity is unchanged.
        using var afterResp = await adminClient.GetAsync("/v1/site/identity");
        var after = await afterResp.Content.ReadFromJsonAsync<SiteIdentityDto>(JsonOptions);
        Assert.Equal(before!.DeviceFingerprint, after!.DeviceFingerprint);
    }

    [Fact]
    public async Task Admin_PostsRotate_Gets200_NewFingerprint_AuditRow_AndGetSiteReflectsIt()
    {
        await using var factory = await CreateFactoryAsync();
        await BootstrapAdminAsync(factory, "site-admin-17", "AdminPass123!");
        using var adminClient = await LoginAsAsync(factory, "site-admin-17", "AdminPass123!");

        using var beforeResp = await adminClient.GetAsync("/v1/site/identity");
        var before = await beforeResp.Content.ReadFromJsonAsync<SiteIdentityDto>(JsonOptions);
        Assert.NotNull(before);

        using var rotate = await adminClient.PostAsJsonAsync(
            "/v1/site/identity/rotate", new { currentFingerprint = before!.DeviceFingerprint }, JsonOptions);
        Assert.Equal(HttpStatusCode.OK, rotate.StatusCode);
        var after = await rotate.Content.ReadFromJsonAsync<SiteIdentityDto>(JsonOptions);
        Assert.NotNull(after);
        Assert.False(string.IsNullOrWhiteSpace(after!.DeviceFingerprint));
        Assert.NotEqual(before.DeviceFingerprint, after.DeviceFingerprint);
        Assert.Contains("-----BEGIN CERTIFICATE-----", after.DeviceCertPem);

        // A follow-up GET /v1/site/identity sees the SAME rotated fingerprint (not the pre-rotation one) —
        // proves GetIdentityAsync reads through DeviceIdentityProvider.Current, not a stale capture.
        using var afterGet = await adminClient.GetAsync("/v1/site/identity");
        var afterGetDto = await afterGet.Content.ReadFromJsonAsync<SiteIdentityDto>(JsonOptions);
        Assert.Equal(after.DeviceFingerprint, afterGetDto!.DeviceFingerprint);

        // GetSiteAsync's DeviceFingerprint also reflects the rotation (same provider, different handler).
        using var getSite = await adminClient.GetAsync("/v1/site");
        var status = await getSite.Content.ReadFromJsonAsync<SiteStatusDto>(JsonOptions);
        Assert.Equal(after.DeviceFingerprint, status!.DeviceFingerprint);

        using var audit = await adminClient.GetAsync("/v1/audit?action=site.identity.rotate");
        Assert.Equal(HttpStatusCode.OK, audit.StatusCode);
        var page = await audit.Content.ReadFromJsonAsync<AuditPageDto>(JsonOptions);
        Assert.NotNull(page);
        Assert.True(page!.Total >= 1);
        var row = page.Items[0];
        Assert.Equal("site.identity.rotate", row.Action);
        Assert.Equal(after.DeviceFingerprint, row.TargetId);
        Assert.Contains(after.DeviceFingerprint, row.NewValueJson ?? "");
        Assert.Contains(before.DeviceFingerprint, row.OldValueJson ?? "");
    }

    [Fact]
    public async Task UnsDisabled_AdminPostsRotate_StillRotatesTheIdentity_Gets200()
    {
        await using var factory = await CreateFactoryAsync(unsEnabled: false);
        await BootstrapAdminAsync(factory, "site-admin-18", "AdminPass123!");
        using var adminClient = await LoginAsAsync(factory, "site-admin-18", "AdminPass123!");

        using var beforeResp = await adminClient.GetAsync("/v1/site/identity");
        var before = await beforeResp.Content.ReadFromJsonAsync<SiteIdentityDto>(JsonOptions);

        using var rotate = await adminClient.PostAsJsonAsync(
            "/v1/site/identity/rotate", new { currentFingerprint = before!.DeviceFingerprint }, JsonOptions);

        Assert.Equal(HttpStatusCode.OK, rotate.StatusCode);
        var after = await rotate.Content.ReadFromJsonAsync<SiteIdentityDto>(JsonOptions);
        Assert.NotNull(after);
        Assert.NotEqual(before!.DeviceFingerprint, after!.DeviceFingerprint);
    }

    // ─────────────────────────────────────────────────────────────────────
    // Fix round 1 (M-3a) — the seam the earlier rotate tests above didn't cover: they all run with NO
    // enabled Site link, so mgr.Status() takes the DISABLED branch (reads the provider directly) and never
    // actually exercises the LIVE UnsBridge's own Status()/Snapshot(). This test enables a real Site link
    // FIRST (so a genuine bridge is running, BridgeState != Disabled) and only THEN rotates — proving the
    // endpoint's ReapplyCurrentAsync call reaches the BRIDGE, not just the in-memory provider.
    // ─────────────────────────────────────────────────────────────────────

    [Fact]
    public async Task Admin_RotatesWhileASiteLinkIsEnabled_TheLiveBridgeReflectsTheNewFingerprint()
    {
        await using var factory = await CreateFactoryAsync();
        await BootstrapAdminAsync(factory, "site-admin-22", "AdminPass123!");
        await CreateUserAsync(factory, "site-engineer-22", "EngineerPass123!", Roles.Engineer);

        using (var engineerClient = await LoginAsAsync(factory, "site-engineer-22", "EngineerPass123!"))
        using (var put = await engineerClient.PutAsJsonAsync(
                   "/v1/site", new { enabled = true, host = "127.0.0.1", port = 18886, siteTrustPem = NewValidTrustPem() }, JsonOptions))
        {
            Assert.Equal(HttpStatusCode.OK, put.StatusCode);
            var putStatus = await put.Content.ReadFromJsonAsync<SiteStatusDto>(JsonOptions);
            Assert.NotEqual("Disabled", putStatus!.BridgeState); // a genuine bridge is now running.
        }

        using var adminClient = await LoginAsAsync(factory, "site-admin-22", "AdminPass123!");

        using var beforeResp = await adminClient.GetAsync("/v1/site/identity");
        var before = await beforeResp.Content.ReadFromJsonAsync<SiteIdentityDto>(JsonOptions);

        using var rotate = await adminClient.PostAsJsonAsync(
            "/v1/site/identity/rotate", new { currentFingerprint = before!.DeviceFingerprint }, JsonOptions);
        Assert.Equal(HttpStatusCode.OK, rotate.StatusCode);
        var rotated = await rotate.Content.ReadFromJsonAsync<SiteIdentityDto>(JsonOptions);
        Assert.NotEqual(before.DeviceFingerprint, rotated!.DeviceFingerprint);

        using var getSite = await adminClient.GetAsync("/v1/site");
        var status = await getSite.Content.ReadFromJsonAsync<SiteStatusDto>(JsonOptions);
        // Still a live bridge (ReapplyCurrentAsync rebuilds it, doesn't just tear it down) — its own
        // Status()/Snapshot() is what DeviceFingerprint below actually comes from, not the disabled fallback.
        Assert.NotEqual("Disabled", status!.BridgeState);
        Assert.Equal(rotated.DeviceFingerprint, status.DeviceFingerprint);
        Assert.NotEqual(before.DeviceFingerprint, status.DeviceFingerprint);
    }
}
