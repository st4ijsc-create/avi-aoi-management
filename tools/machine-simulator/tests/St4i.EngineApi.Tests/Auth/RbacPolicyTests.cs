using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Identity;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.AspNetCore.Routing;
using Microsoft.Extensions.DependencyInjection;
using St4i.EngineApi.Auth;
using Xunit;

namespace St4i.EngineApi.Tests.Auth;

/// <summary>
/// WS-D-D2 — two test families:
///
///  1. A METADATA SWEEP (<see cref="EveryV1Route_CarriesExactlyTheExpectedPolicyOrAnonymous"/>) —
///     resolves the real, fully-mapped <see cref="EndpointDataSource"/> straight out of the booted
///     <c>St4i.EngineApi</c> composition root (same <see cref="WebApplicationFactory{TEntryPoint}"/>
///     convention <c>AuthPipelineTests</c> already established) and walks every <c>/v1/*</c>
///     <see cref="RouteEndpoint"/>'s metadata, comparing it against the WS-D §2 role matrix
///     (<c>task-2-brief.md</c>) baked into <see cref="ExpectedRoutes"/> below. This is what catches "a
///     route got mapped but somebody forgot the .RequireAuthorization(...)/.AllowAnonymous() chain" —
///     the ~300 pre-existing hand-built-<c>DefaultHttpContext</c> handler tests never boot the real
///     pipeline, so they can't see a missing policy attachment at all; this sweep is the only thing in
///     the whole suite that actually looks at endpoint metadata.
///
///  2. A FEW REAL-PIPELINE 403/200 checks (<see cref="Rbac_EnforcesPerRoleAccess_AcrossOperatorEngineerAdmin"/>)
///     — bootstraps an Admin, seeds an Operator + an Engineer directly via <see cref="IUserStore"/> (no
///     user-management endpoints exist yet — D3/D7), logs in as each, and asserts the ACTUAL 403/200
///     outcome for a representative sample of routes per role. This is the "does the policy plumbing
///     actually enforce it end to end" complement to the metadata sweep (which only proves the metadata
///     is attached, not that <c>AddAuthorization</c>'s <c>RequireRole</c> definitions are correct).
///
/// Plus the two D1-carried hardening minors: login timing equalization (unknown/disabled-user paths
/// still 401, never 500) and change-password's null/empty NewPassword 400.
///
/// WS-D-D3 — see <see cref="SecurityEnvVarTests"/>'s doc comment: this class shares its
/// <c>[Collection(...)]</c> tag with <see cref="AuthPipelineTests"/>/<c>AuditEndpointsTests</c> so xUnit
/// runs all three sequentially relative to each other, instead of racing over the same real process
/// environment variables.
/// </summary>
[Collection(SecurityEnvVarTests.CollectionName)]
public sealed class RbacPolicyTests
{
    private static readonly SemaphoreSlim EnvLock = new(1, 1);
    private static readonly JsonSerializerOptions JsonOptions = new(JsonSerializerDefaults.Web);

    /// <summary>Same env-var-swap-then-eager-build protocol as <c>AuthPipelineTests.CreateFactoryAsync</c>
    /// (duplicated here rather than shared — that method is <c>private</c> to its own class, and this
    /// class needs the identical "throwaway temp dirs + force Production environment" recipe for the same
    /// reasons documented there).</summary>
    private static async Task<WebApplicationFactory<Program>> CreateFactoryAsync(bool demoEnabled)
    {
        var securityDir = Directory.CreateTempSubdirectory("st4i-rbac-security-").FullName;
        var historianDir = Directory.CreateTempSubdirectory("st4i-rbac-historian-").FullName;
        var walDir = Directory.CreateTempSubdirectory("st4i-rbac-wal-").FullName;
        // FF-1 — isolated the same way as historian/WAL above: without this, FleetHost.UpdateSettings' new
        // persist-on-change behavior would read/write the REAL %ProgramData%\ST4I\sim\settings\
        // fleet-settings.json, leaking state across test runs (and across the whole test suite).
        var settingsDir = Directory.CreateTempSubdirectory("st4i-rbac-settings-").FullName;
        // EC-3 review follow-up — without these, every WebApplicationFactory<Program> boot below (UNS
        // defaults ON) resolves DeviceIdentityStore/SiteLinkStore to the REAL %ProgramData%\ST4I\sim\
        // identity\ / ...\sitelink\, minting a real CNG keystore entry (PersistKeySet) and writing a real
        // site-link.json on every single test run, with no cleanup — see SiteEndpointsTests' own doc
        // comment for the full rationale (that class isolates these two; this one hadn't, until now).
        var identityDir = Directory.CreateTempSubdirectory("st4i-rbac-identity-").FullName;
        var siteLinkDir = Directory.CreateTempSubdirectory("st4i-rbac-sitelink-").FullName;
        // GĐ3 sub-4 LC-1 — isolated the same way as every other per-concern directory above: without
        // this, a real Policy DENY occurring anywhere in this class's requests (PolicyResults.DenyAsync
        // now resolves IAlarmStore and raises an alarm) would resolve AlarmStore against the REAL
        // %ProgramData%\ST4I\sim\alarms\alarms.db instead of a throwaway temp dir.
        var alarmsDir = Directory.CreateTempSubdirectory("st4i-rbac-alarms-").FullName;
        // GĐ3 closeout WI-3 — without this, every WebApplicationFactory<Program> boot below (UNS defaults
        // ON) has Program.cs construct a REAL BridgeSpool against %ProgramData%\ST4I\sim\bridge-spool\.
        var bridgeSpoolDir = Directory.CreateTempSubdirectory("st4i-rbac-bridgespool-").FullName;
        var connectorConfigDir = Directory.CreateTempSubdirectory("st4i-rbac-connectorconfig-").FullName;
        // 🔴 Task C-7 — isolated for the same reason as every directory above, and this one had been
        // leaking since C-2: without it every WebApplicationFactory<Program> boot in this class opens the
        // REAL %ProgramData%\ST4I\sim\notifications\notifications.db, and C-7's tests below now WRITE
        // configuration through it — so a test run would have persisted a relay configuration onto the
        // developer's own machine.
        var notificationsDir = Directory.CreateTempSubdirectory("st4i-rbac-notifications-").FullName;

        await EnvLock.WaitAsync().ConfigureAwait(false);
        var prevSecurityDir = Environment.GetEnvironmentVariable("ST4I_SECURITY_DIR");
        var prevDemoEnabled = Environment.GetEnvironmentVariable("ST4I_DEMO_ENABLED");
        var prevHistorianDir = Environment.GetEnvironmentVariable("ST4I_HISTORIAN_DIR");
        var prevWalDir = Environment.GetEnvironmentVariable("ST4I_WAL_DIR");
        var prevSettingsDir = Environment.GetEnvironmentVariable("ST4I_SETTINGS_DIR");
        var prevIdentityDir = Environment.GetEnvironmentVariable("ST4I_IDENTITY_DIR");
        var prevSiteLinkDir = Environment.GetEnvironmentVariable("ST4I_SITELINK_DIR");
        var prevAlarmsDir = Environment.GetEnvironmentVariable("ST4I_ALARMS_DIR");
        var prevBridgeSpoolDir = Environment.GetEnvironmentVariable("ST4I_BRIDGE_SPOOL_DIR");
        var prevConnectorConfigDir = Environment.GetEnvironmentVariable("ST4I_CONNECTOR_CONFIG_DIR");
        var prevNotificationsDir = Environment.GetEnvironmentVariable("ST4I_NOTIFICATIONS_DIR");
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
            Environment.SetEnvironmentVariable("ST4I_ALARMS_DIR", alarmsDir);
            Environment.SetEnvironmentVariable("ST4I_BRIDGE_SPOOL_DIR", bridgeSpoolDir);
            Environment.SetEnvironmentVariable("ST4I_CONNECTOR_CONFIG_DIR", connectorConfigDir);
            Environment.SetEnvironmentVariable("ST4I_NOTIFICATIONS_DIR", notificationsDir);
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
            Environment.SetEnvironmentVariable("ST4I_IDENTITY_DIR", prevIdentityDir);
            Environment.SetEnvironmentVariable("ST4I_SITELINK_DIR", prevSiteLinkDir);
            Environment.SetEnvironmentVariable("ST4I_ALARMS_DIR", prevAlarmsDir);
            Environment.SetEnvironmentVariable("ST4I_BRIDGE_SPOOL_DIR", prevBridgeSpoolDir);
            Environment.SetEnvironmentVariable("ST4I_CONNECTOR_CONFIG_DIR", prevConnectorConfigDir);
            Environment.SetEnvironmentVariable("ST4I_NOTIFICATIONS_DIR", prevNotificationsDir);
            Environment.SetEnvironmentVariable("ASPNETCORE_ENVIRONMENT", prevEnvironment);
            EnvLock.Release();
        }
    }

    /// <summary>Seeds a user directly via <see cref="IUserStore"/> (the same seam a future D3/D7
    /// user-management endpoint would call) — there is no <c>POST /v1/users</c> yet, so tests that need an
    /// Operator/Engineer account go straight to the store, exactly like the brief calls for.</summary>
    private static async Task CreateUserAsync(WebApplicationFactory<Program> factory, string username, string password, string role)
    {
        var userStore = factory.Services.GetRequiredService<IUserStore>();
        var hasher = new PasswordHasher<AppUser>();
        var hash = hasher.HashPassword(AppUser.Instance, password);
        await userStore.CreateAsync(username, hash, role, null, "test", CancellationToken.None)
            .ConfigureAwait(false);
    }

    private static async Task<HttpClient> LoginAsAsync(WebApplicationFactory<Program> factory, string username, string password)
    {
        var client = factory.CreateClient(new WebApplicationFactoryClientOptions { HandleCookies = true });
        using var login = await client.PostAsJsonAsync("/v1/auth/login", new { username, password }, JsonOptions).ConfigureAwait(false);
        Assert.Equal(HttpStatusCode.OK, login.StatusCode);
        return client;
    }

    // ─────────────────────────────────────────────────────────────────────
    // 1) Metadata sweep — every /v1/* route carries exactly the matrix's policy (or AllowAnonymous).
    // ─────────────────────────────────────────────────────────────────────

    /// <summary><c>Methods</c> empty means "no HTTP-method restriction at all" — only the inspector WS
    /// route (a bare <c>app.Map(...)</c>, not <c>MapGet</c>/etc.) matches that shape.
    /// <c>Policy</c> null means <c>AllowAnonymous</c> (D1, unchanged by this task).</summary>
    private sealed record RouteExpectation(string Pattern, string[] Methods, string? Policy);

    private static readonly RouteExpectation[] ExpectedRoutes =
    {
        // AllowAnonymous (D1 — untouched by this task)
        new("/v1/capabilities", new[] { "GET" }, null),
        new("/v1/health", new[] { "GET" }, null),
        new("/v1/auth/bootstrap-status", new[] { "GET" }, null),
        new("/v1/auth/bootstrap", new[] { "POST" }, null),
        new("/v1/auth/login", new[] { "POST" }, null),

        // Operator
        new("/v1/fleet", new[] { "GET" }, Policies.Operator),
        new("/v1/machines/{code}", new[] { "GET" }, Policies.Operator),
        new("/v1/fleet/start", new[] { "POST" }, Policies.Operator),
        new("/v1/fleet/stop", new[] { "POST" }, Policies.Operator),
        new("/v1/fleet/estop", new[] { "POST" }, Policies.Operator),
        new("/v1/fleet/estop/reset", new[] { "POST" }, Policies.Operator),
        new("/v1/mode", new[] { "GET" }, Policies.Operator),
        new("/v1/safety", new[] { "GET" }, Policies.Operator),
        new("/v1/products", new[] { "GET" }, Policies.Operator),
        new("/v1/products/{code}", new[] { "GET" }, Policies.Operator),
        new("/v1/products/{code}/points", new[] { "GET" }, Policies.Operator),
        new("/v1/products/{code}/points/{pointCode}", new[] { "GET" }, Policies.Operator),
        new("/v1/recipes", new[] { "GET" }, Policies.Operator),
        new("/v1/recipes/{code}", new[] { "GET" }, Policies.Operator),
        new("/v1/machines/{code}/config/check", new[] { "GET" }, Policies.Operator),
        new("/v1/machines/{code}/config/diff", new[] { "GET" }, Policies.Operator),
        new("/v1/machines/{code}/config/history", new[] { "GET" }, Policies.Operator),
        new("/v1/machines/{code}/settings", new[] { "GET" }, Policies.Operator),
        new("/v1/machines/{code}/settings/history", new[] { "GET" }, Policies.Operator),
        new("/v1/scenario", new[] { "GET" }, Policies.Operator),
        new("/v1/historian/results", new[] { "GET" }, Policies.Operator),
        new("/v1/historian/results/export.csv", new[] { "GET" }, Policies.Operator),
        new("/v1/historian/serial/{serial}", new[] { "GET" }, Policies.Operator),
        new("/v1/historian/telemetry", new[] { "GET" }, Policies.Operator),
        new("/v1/historian/stats", new[] { "GET" }, Policies.Operator),
        new("/v1/historian/oee", new[] { "GET" }, Policies.Operator),
        new("/v1/historian/oee/fleet", new[] { "GET" }, Policies.Operator),
        new("/v1/historian/oee/settings", new[] { "GET" }, Policies.Operator),
        new("/v1/historian/report.pdf", new[] { "GET" }, Policies.Operator),
        new("/v1/auth/logout", new[] { "POST" }, Policies.Operator),
        new("/v1/auth/me", new[] { "GET" }, Policies.Operator),
        new("/v1/auth/change-password", new[] { "POST" }, Policies.Operator),
        new("/v1/assets", new[] { "GET" }, Policies.Operator),
        new("/v1/assets/{code}", new[] { "GET" }, Policies.Operator),
        new("/v1/site", new[] { "GET" }, Policies.Operator),
        new("/v1/site/identity", new[] { "GET" }, Policies.Operator),
        new("/v1/alarms", new[] { "GET" }, Policies.Operator),
        new("/v1/alarms/history", new[] { "GET" }, Policies.Operator),
        new("/v1/alarms/{id}/ack", new[] { "POST" }, Policies.Operator),
        // 🔴 Task C-5 — the local-annunciation SSE stream. Operator, NOT Engineer like the inspector
        // stream next door: it carries alarm content, and GET /v1/alarms — the same content in table form
        // — is already Operator. A push channel that skipped the gate the pull channel enforces would be a
        // way to read alarms without the session that reading them requires.
        new("/v1/alarms/annunciations", new[] { "GET" }, Policies.Operator),
        new("/v1/line", new[] { "GET" }, Policies.Operator),
        new("/v1/line/{command}", new[] { "POST" }, Policies.Operator),
        // GP-5 (task-5-brief.md item 3) — configured-but-not-started connector visibility.
        new("/v1/connectors", new[] { "GET" }, Policies.Operator),
        // SM-5 (.superpowers/sdd/2026-07-29-dotA-single-machine-sellable-blueprint/task-5-brief.md) — the
        // persisted-connector-configuration write path. GET (visibility) is Operator, same tier as
        // GET /v1/assets/GET /v1/site above; the two mutations (create/delete) are Engineer below, same tier
        // as PUT /v1/site and PUT /v1/assets/{code}/lifecycle.
        new("/v1/connectors/configured", new[] { "GET" }, Policies.Operator),

        // Engineer
        // Task B-6 (.superpowers/sdd/2026-07-29-dotB-machine-control-blueprint/task-6-brief.md) — a setpoint
        // write physically changes a live machine, a different kind of authority from a config-row change,
        // but sits beside the OTHER Engineer-gated connector/config mutations (including the one that
        // declares a point writable at all — POST /v1/connectors' own save gate) rather than the lower
        // Operator tier (whose existing actions never touch a device at all).
        new("/v1/machines/{code}/setpoint", new[] { "POST" }, Policies.Engineer),
        new("/v1/machines/{code}/sync-config", new[] { "POST" }, Policies.Engineer),
        new("/v1/mode", new[] { "PUT" }, Policies.Engineer),
        new("/v1/settings", new[] { "GET" }, Policies.Engineer),
        new("/v1/settings", new[] { "PUT" }, Policies.Engineer),
        new("/v1/settings/probe", new[] { "POST" }, Policies.Engineer),
        new("/v1/onboarding/register", new[] { "POST" }, Policies.Engineer),
        new("/v1/onboarding/poll", new[] { "POST" }, Policies.Engineer),
        new("/v1/onboarding/claim", new[] { "POST" }, Policies.Engineer),
        new("/v1/onboarding/enroll", new[] { "POST" }, Policies.Engineer),
        new("/v1/onboarding/paste-key", new[] { "POST" }, Policies.Engineer),
        new("/v1/products/{code}", new[] { "POST", "PUT" }, Policies.Engineer),
        new("/v1/products/{code}", new[] { "DELETE" }, Policies.Engineer),
        new("/v1/products/{code}/points/{pointCode}", new[] { "POST", "PUT" }, Policies.Engineer),
        new("/v1/products/{code}/points/{pointCode}", new[] { "DELETE" }, Policies.Engineer),
        new("/v1/recipes/{code}", new[] { "PUT" }, Policies.Engineer),
        new("/v1/recipes/{code}", new[] { "DELETE" }, Policies.Engineer),
        new("/v1/machines/{code}/config/pull", new[] { "POST" }, Policies.Engineer),
        new("/v1/machines/{code}/config/push", new[] { "POST" }, Policies.Engineer),
        new("/v1/machines/{code}/settings/{key}", new[] { "PUT" }, Policies.Engineer),
        new("/v1/machines/{code}/settings/{key}", new[] { "DELETE" }, Policies.Engineer),
        new("/v1/machines/{code}/settings/pull", new[] { "POST" }, Policies.Engineer),
        new("/v1/machines/{code}/settings/push", new[] { "POST" }, Policies.Engineer),
        new("/v1/scenario", new[] { "POST" }, Policies.Engineer),
        new("/v1/scenario/preset", new[] { "POST" }, Policies.Engineer),
        new("/v1/scenario/burst", new[] { "POST" }, Policies.Engineer),
        new("/v1/historian/oee/settings", new[] { "PUT" }, Policies.Engineer),
        new("/v1/assets/{code}/lifecycle", new[] { "PUT" }, Policies.Engineer),
        new("/v1/site", new[] { "PUT" }, Policies.Engineer),
        new("/v1/site/discover", new[] { "GET" }, Policies.Engineer),
        // SM-5 — writes device connection settings (host/port, and for OPC-UA potentially a
        // username/password embedded in its map JSON) — same tier as PUT /v1/site above.
        new("/v1/connectors", new[] { "POST" }, Policies.Engineer),
        new("/v1/connectors/{kind}", new[] { "DELETE" }, Policies.Engineer),
        new("/v1/connectors/test", new[] { "POST" }, Policies.Engineer),
        new("/v1/inspector/stream", Array.Empty<string>(), Policies.Engineer),

        // 🔴 Task C-7 (.superpowers/sdd/2026-07-30-dotC-alarm-notification-blueprint/task-7-brief.md) — the
        // alarm-notification configuration surface. Engineer for the three channels that reach a person
        // through software; see the Admin block below for the fourth, which drives hardware.
        //
        // The two READS are Engineer rather than Operator: they carry the whole notification configuration
        // — SMTP usernames, every alarm recipient's e-mail address, webhook endpoints, and the machine and
        // point the relay may energise — which is the same tier of material as GET /v1/settings. The
        // Operator-tier notification surface is deliberately narrower and already exists: the `ready` frame
        // of GET /v1/alarms/annunciations above, and — 🔴 task C-8 — /v1/notifications/annunciator below.
        new("/v1/notifications/channels", new[] { "GET" }, Policies.Engineer),
        new("/v1/notifications/status", new[] { "GET" }, Policies.Engineer),

        // 🔴 Task C-8 (task-8-brief.md) — the Operator-tier annunciator read. It is a NEW, NARROWER ROUTE
        // rather than a role change on /v1/notifications/status, which stays Engineer above because it
        // carries every alarm recipient's e-mail address. This one carries the beacon's believed state and
        // the annunciation hub's listener gauges, and its handler never calls
        // NotificationConfigStore.ListAsync at all — so no channel configuration can reach it.
        new("/v1/notifications/annunciator", new[] { "GET" }, Policies.Operator),
        new("/v1/notifications/webhook", new[] { "PUT" }, Policies.Engineer),
        new("/v1/notifications/webhook", new[] { "DELETE" }, Policies.Engineer),
        new("/v1/notifications/smtp", new[] { "PUT" }, Policies.Engineer),
        new("/v1/notifications/smtp", new[] { "DELETE" }, Policies.Engineer),
        new("/v1/notifications/local-annunciation", new[] { "PUT" }, Policies.Engineer),
        new("/v1/notifications/local-annunciation", new[] { "DELETE" }, Policies.Engineer),
        // Engineer: it reaches a third party but changes nothing here, same tier as POST /v1/connectors/test.
        // It is the one rate-limited route in this product — see NotificationTestRateLimiter.
        new("/v1/notifications/test", new[] { "POST" }, Policies.Engineer),

        // Admin
        new("/v1/historian/prune", new[] { "POST" }, Policies.Admin),
        new("/v1/audit", new[] { "GET" }, Policies.Admin),
        new("/v1/audit/verify", new[] { "GET" }, Policies.Admin),

        // Admin — GĐ3 closeout WI-4 (device-identity rotation — see SiteEndpoints.RotateIdentityAsync)
        new("/v1/site/identity/rotate", new[] { "POST" }, Policies.Admin),

        // Admin — Task B-6: a command can fire real, ungoverned motion (a coil pulse, an OPC-UA CallAsync) —
        // this batch's own highest-risk actuation surface (B-5's report: "the highest-risk surface this
        // batch"). Gated strictly ABOVE the setpoint-write tier — see RoleObligationRule's own doc comment
        // for the full argument, and MachineWriteEndpointsTests for the proof that an Engineer (setpoint-
        // authorised) caller cannot invoke a command.
        new("/v1/machines/{code}/command", new[] { "POST" }, Policies.Admin),

        // 🔴🔴 Admin — Task C-7, and this is the whole point of the task's RBAC decision.
        // MachineWriteGate.RoleFor returns Roles.Admin for a RelayTargetKind.Command target and
        // RelayNotificationChannel presents it, so saving a relay row with targetKind = Command makes this
        // engine perform, automatically and for as long as the row exists, an action a human needs Admin
        // for. Every OTHER config-mutation endpoint in this repository is Engineer — including the three
        // notification channels above — so following that precedent here would have handed an Engineer
        // Admin-tier command authority through a config row (C-6 review I-2).
        //
        // The gate is the ROUTE rather than a body check, deliberately: a body check would put the
        // privilege boundary inside a handler, after model binding, where THIS SWEEP CANNOT SEE IT. Here it
        // is metadata, and the sweep asserts it in both directions.
        new("/v1/notifications/relay", new[] { "PUT" }, Policies.Admin),
        new("/v1/notifications/relay", new[] { "DELETE" }, Policies.Admin),

        // Admin — WS-D-D7 user management (UserEndpoints.cs)
        new("/v1/users", new[] { "GET" }, Policies.Admin),
        new("/v1/users", new[] { "POST" }, Policies.Admin),
        new("/v1/users/{id}/role", new[] { "PUT" }, Policies.Admin),
        new("/v1/users/{id}/disable", new[] { "POST" }, Policies.Admin),
        new("/v1/users/{id}/enable", new[] { "POST" }, Policies.Admin),
        new("/v1/users/{id}/reset-password", new[] { "POST" }, Policies.Admin),
    };

    [Fact]
    public async Task EveryV1Route_CarriesExactlyTheExpectedPolicyOrAnonymous()
    {
        await using var factory = await CreateFactoryAsync(demoEnabled: false);
        var dataSource = factory.Services.GetRequiredService<EndpointDataSource>();

        var actualV1Routes = dataSource.Endpoints
            .OfType<RouteEndpoint>()
            .Where(e => e.RoutePattern.RawText is { } text && text.StartsWith("/v1", StringComparison.Ordinal))
            .ToList();

        // Catches BOTH directions: a route in the matrix that's no longer mapped, AND a route mapped
        // that's missing from the matrix entirely (an unreviewed new endpoint) — not just "the ones we
        // remembered to check line up".
        Assert.Equal(ExpectedRoutes.Length, actualV1Routes.Count);

        foreach (var expectation in ExpectedRoutes)
        {
            var candidates = actualV1Routes.Where(e => e.RoutePattern.RawText == expectation.Pattern).ToList();

            var match = expectation.Methods.Length == 0
                ? candidates.FirstOrDefault(e => e.Metadata.GetMetadata<IHttpMethodMetadata>() is null)
                : candidates.FirstOrDefault(e =>
                {
                    var methods = e.Metadata.GetMetadata<IHttpMethodMetadata>()?.HttpMethods;
                    return methods is not null
                        && methods.Count == expectation.Methods.Length
                        && methods.OrderBy(m => m, StringComparer.Ordinal)
                            .SequenceEqual(expectation.Methods.OrderBy(m => m, StringComparer.Ordinal));
                });

            Assert.True(
                match is not null,
                $"No mapped endpoint found for [{string.Join(",", expectation.Methods)}] {expectation.Pattern} " +
                "— a route in the WS-D §2 matrix is missing from the app (or its HTTP method(s) changed).");

            var allowAnonymous = match!.Metadata.GetMetadata<IAllowAnonymous>() is not null;

            if (expectation.Policy is null)
            {
                Assert.True(allowAnonymous, $"{expectation.Pattern} was expected to be AllowAnonymous but isn't.");
                continue;
            }

            Assert.False(allowAnonymous, $"{expectation.Pattern} was expected to require {expectation.Policy} but is AllowAnonymous.");

            var policyNames = match.Metadata.OfType<IAuthorizeData>()
                .Select(a => a.Policy)
                .Where(p => p is not null)
                .Distinct()
                .ToList();

            Assert.True(
                policyNames.Count == 1 && policyNames[0] == expectation.Policy,
                $"{expectation.Pattern} [{string.Join(",", expectation.Methods)}] expected policy " +
                $"\"{expectation.Policy}\" but found [{string.Join(",", policyNames)}].");
        }
    }

    [Fact]
    public async Task FallbackToFile_IsTheOnlyNonV1Endpoint_AndStaysAllowAnonymous()
    {
        await using var factory = await CreateFactoryAsync(demoEnabled: false);
        var dataSource = factory.Services.GetRequiredService<EndpointDataSource>();

        var nonV1Routes = dataSource.Endpoints
            .OfType<RouteEndpoint>()
            .Where(e => e.RoutePattern.RawText is { } text && !text.StartsWith("/v1", StringComparison.Ordinal))
            .ToList();

        Assert.Single(nonV1Routes);
        Assert.NotNull(nonV1Routes[0].Metadata.GetMetadata<IAllowAnonymous>());
    }

    // ─────────────────────────────────────────────────────────────────────
    // 2) Real-pipeline 403/200 enforcement across Operator/Engineer/Admin.
    // ─────────────────────────────────────────────────────────────────────

    [Fact]
    public async Task Rbac_EnforcesPerRoleAccess_AcrossOperatorEngineerAdmin()
    {
        await using var factory = await CreateFactoryAsync(demoEnabled: false);

        // Bootstrap mints the FIRST user as Admin (AuthEndpoints.MapAuthEndpoints — unconditionally Roles.Admin).
        using (var bootstrapClient = factory.CreateClient())
        using (var bootstrap = await bootstrapClient.PostAsJsonAsync(
                   "/v1/auth/bootstrap",
                   new { username = "rbac-admin", password = "AdminPass123!", displayName = (string?)null },
                   JsonOptions))
        {
            Assert.Equal(HttpStatusCode.OK, bootstrap.StatusCode);
        }

        await CreateUserAsync(factory, "rbac-operator", "OperatorPass123!", Roles.Operator);
        await CreateUserAsync(factory, "rbac-engineer", "EngineerPass123!", Roles.Engineer);

        // ── Operator: can read the fleet, cannot switch mode.
        using (var operatorClient = await LoginAsAsync(factory, "rbac-operator", "OperatorPass123!"))
        {
            using var fleet = await operatorClient.GetAsync("/v1/fleet");
            Assert.Equal(HttpStatusCode.OK, fleet.StatusCode);

            using var putMode = await operatorClient.PutAsJsonAsync("/v1/mode", new { mode = "Live" }, JsonOptions);
            Assert.Equal(HttpStatusCode.Forbidden, putMode.StatusCode);
        }

        // ── Engineer: can switch mode, cannot prune the historian, cannot disable TLS verification.
        using (var engineerClient = await LoginAsAsync(factory, "rbac-engineer", "EngineerPass123!"))
        {
            using var putMode = await engineerClient.PutAsJsonAsync("/v1/mode", new { mode = "Live" }, JsonOptions);
            Assert.Equal(HttpStatusCode.OK, putMode.StatusCode);

            using var prune = await engineerClient.PostAsJsonAsync("/v1/historian/prune", new { olderThanDays = 9999 }, JsonOptions);
            Assert.Equal(HttpStatusCode.Forbidden, prune.StatusCode);

            using var verifyTlsOff = await engineerClient.PutAsJsonAsync(
                "/v1/settings", new { verifyTls = false }, JsonOptions);
            Assert.Equal(HttpStatusCode.Forbidden, verifyTlsOff.StatusCode);
        }

        // ── Admin: all of the above succeed.
        using (var adminClient = await LoginAsAsync(factory, "rbac-admin", "AdminPass123!"))
        {
            using var putMode = await adminClient.PutAsJsonAsync("/v1/mode", new { mode = "Live" }, JsonOptions);
            Assert.Equal(HttpStatusCode.OK, putMode.StatusCode);

            using var prune = await adminClient.PostAsJsonAsync("/v1/historian/prune", new { olderThanDays = 9999 }, JsonOptions);
            Assert.Equal(HttpStatusCode.OK, prune.StatusCode);

            using var verifyTlsOff = await adminClient.PutAsJsonAsync(
                "/v1/settings", new { verifyTls = false }, JsonOptions);
            Assert.Equal(HttpStatusCode.OK, verifyTlsOff.StatusCode);
        }
    }

    // ─────────────────────────────────────────────────────────────────────
    // 🔴🔴 2b) Task C-7's non-negotiable: an Engineer cannot configure the alarm relay.
    // ─────────────────────────────────────────────────────────────────────

    /// <summary>
    /// 🔴🔴 <b>The privilege escalation C-6's review found (I-2), closed and proved through the real
    /// pipeline.</b>
    ///
    /// <para><c>MachineWriteGate.RoleFor</c> returns <c>Roles.Admin</c> for a <c>RelayTargetKind.Command</c>
    /// target and <c>RelayNotificationChannel</c> presents it — so a relay row with
    /// <c>targetKind = Command</c> makes this engine perform, automatically and for as long as the row
    /// exists, an action a human needs Admin for. Every OTHER config-mutation endpoint in this repository is
    /// Engineer-tier, so following that precedent would have handed an Engineer Admin-tier command authority
    /// through a config row.</para>
    ///
    /// <para><b>What this test asserts that the metadata sweep cannot:</b> the sweep proves the policy is
    /// ATTACHED; this proves it ENFORCES — and, more importantly, that the refusal has the consequence that
    /// matters. A 403 that still left a row in the store would be a passing test and an open escalation, so
    /// the store's own state is read back through the API after each refusal.</para>
    ///
    /// <para>The Engineer's successful WEBHOOK save is the control. Without it, this test would also pass on
    /// a build where the Engineer role were broken outright, or where the whole notification surface were
    /// Admin — neither of which is the property being claimed.</para>
    /// </summary>
    [Fact]
    public async Task RelayNotificationConfig_IsAdminOnly_SoAnEngineerCannotGrantThisEngineCommandAuthority()
    {
        await using var factory = await CreateFactoryAsync(demoEnabled: false);

        using (var bootstrapClient = factory.CreateClient())
        using (var bootstrap = await bootstrapClient.PostAsJsonAsync(
                   "/v1/auth/bootstrap",
                   new { username = "relay-admin", password = "AdminPass123!", displayName = (string?)null },
                   JsonOptions))
        {
            Assert.Equal(HttpStatusCode.OK, bootstrap.StatusCode);
        }

        await CreateUserAsync(factory, "relay-engineer", "EngineerPass123!", Roles.Engineer);

        var commandRelay = new
        {
            enabled = true,
            minPriority = "Critical",
            machineCode = "AOI-01",
            targetKind = "Command",
            targetName = "pulse_beacon",
        };
        var pointRelay = new
        {
            enabled = true,
            minPriority = "Critical",
            machineCode = "AOI-01",
            targetKind = "Point",
            targetName = "beacon",
            onValueJson = "1",
            offValueJson = "0",
        };

        using (var engineer = await LoginAsAsync(factory, "relay-engineer", "EngineerPass123!"))
        {
            // 🔴 The headline: the Command target — the one that grants Admin-tier authority — is refused.
            using (var command = await engineer.PutAsJsonAsync("/v1/notifications/relay", commandRelay, JsonOptions))
            {
                Assert.Equal(HttpStatusCode.Forbidden, command.StatusCode);
            }

            // And so is the Point target: the WHOLE route is Admin, deliberately. Gating on the body would
            // have put the boundary inside a handler where the metadata sweep cannot see it.
            using (var point = await engineer.PutAsJsonAsync("/v1/notifications/relay", pointRelay, JsonOptions))
            {
                Assert.Equal(HttpStatusCode.Forbidden, point.StatusCode);
            }

            // 🔴 The consequence, not just the status: nothing was created. A 403 that still wrote a row
            // would leave the escalation open while this test passed.
            using (var channels = await engineer.GetAsync("/v1/notifications/channels"))
            {
                Assert.Equal(HttpStatusCode.OK, channels.StatusCode);
                var body = await channels.Content.ReadAsStringAsync();
                Assert.DoesNotContain("\"Relay\"", body, StringComparison.Ordinal);
            }

            // The CONTROL. An Engineer configures a webhook perfectly well, so the two 403s above are about
            // the relay route specifically — not about a broken Engineer role or an all-Admin surface.
            using (var webhook = await engineer.PutAsJsonAsync(
                       "/v1/notifications/webhook",
                       new { enabled = true, minPriority = "High", url = "https://hooks.example.test/svc/abc" },
                       JsonOptions))
            {
                Assert.Equal(HttpStatusCode.OK, webhook.StatusCode);
            }
        }

        using (var admin = await LoginAsAsync(factory, "relay-admin", "AdminPass123!"))
        {
            using (var command = await admin.PutAsJsonAsync("/v1/notifications/relay", commandRelay, JsonOptions))
            {
                Assert.Equal(HttpStatusCode.OK, command.StatusCode);
            }

            using var channels = await admin.GetAsync("/v1/notifications/channels");
            Assert.Contains("pulse_beacon", await channels.Content.ReadAsStringAsync(), StringComparison.Ordinal);
        }

        // Deleting it is Admin too: an Engineer who could remove the relay row could silently un-configure
        // the plant's beacon and could not put it back, since the save is Admin.
        using (var engineer = await LoginAsAsync(factory, "relay-engineer", "EngineerPass123!"))
        {
            using var delete = await engineer.DeleteAsync("/v1/notifications/relay");
            Assert.Equal(HttpStatusCode.Forbidden, delete.StatusCode);

            using var channels = await engineer.GetAsync("/v1/notifications/channels");
            Assert.Contains("pulse_beacon", await channels.Content.ReadAsStringAsync(), StringComparison.Ordinal);
        }

        using (var admin = await LoginAsAsync(factory, "relay-admin", "AdminPass123!"))
        {
            using var delete = await admin.DeleteAsync("/v1/notifications/relay");
            Assert.Equal(HttpStatusCode.OK, delete.StatusCode);
        }
    }

    /// <summary>
    /// 🔴 Task C-7 — the notification READS are Engineer, so an Operator (who can see the alarms themselves)
    /// cannot read the alarm recipients' e-mail addresses, the SMTP account or the relay's machine and point.
    /// </summary>
    [Fact]
    public async Task NotificationConfiguration_IsNotReadableByAnOperator()
    {
        await using var factory = await CreateFactoryAsync(demoEnabled: false);

        using (var bootstrapClient = factory.CreateClient())
        using (var bootstrap = await bootstrapClient.PostAsJsonAsync(
                   "/v1/auth/bootstrap",
                   new { username = "notif-admin", password = "AdminPass123!", displayName = (string?)null },
                   JsonOptions))
        {
            Assert.Equal(HttpStatusCode.OK, bootstrap.StatusCode);
        }

        await CreateUserAsync(factory, "notif-operator", "OperatorPass123!", Roles.Operator);

        using var operatorClient = await LoginAsAsync(factory, "notif-operator", "OperatorPass123!");

        using (var channels = await operatorClient.GetAsync("/v1/notifications/channels"))
        {
            Assert.Equal(HttpStatusCode.Forbidden, channels.StatusCode);
        }

        using (var status = await operatorClient.GetAsync("/v1/notifications/status"))
        {
            Assert.Equal(HttpStatusCode.Forbidden, status.StatusCode);
        }

        // The control: the Operator-tier notification surface an operator DOES need still works — the alarm
        // list itself. So this is about the configuration, not about the operator being locked out.
        using (var alarms = await operatorClient.GetAsync("/v1/alarms"))
        {
            Assert.Equal(HttpStatusCode.OK, alarms.StatusCode);
        }
    }

    // ─────────────────────────────────────────────────────────────────────
    // 3) D1-carried hardening minor #1 — login timing equalization.
    // ─────────────────────────────────────────────────────────────────────

    [Fact]
    public async Task Login_UnknownUser_And_DisabledUser_Both401_NeverThrow()
    {
        await using var factory = await CreateFactoryAsync(demoEnabled: false);

        // Unknown username — never hit the store's user row at all.
        using (var client = factory.CreateClient())
        using (var response = await client.PostAsJsonAsync(
                   "/v1/auth/login", new { username = "nobody-such-user", password = "whatever123" }, JsonOptions))
        {
            Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
        }

        // Disabled user — a real row that fails the `user.Disabled` check.
        var userStore = factory.Services.GetRequiredService<IUserStore>();
        var hasher = new PasswordHasher<AppUser>();
        var hash = hasher.HashPassword(AppUser.Instance, "RealPassword123!");
        var created = await userStore.CreateAsync("rbac-disabled", hash, Roles.Operator, null, "test", CancellationToken.None);
        await userStore.SetDisabledAsync(created.Id, disabled: true, CancellationToken.None);

        using (var client = factory.CreateClient())
        using (var response = await client.PostAsJsonAsync(
                   "/v1/auth/login", new { username = "rbac-disabled", password = "RealPassword123!" }, JsonOptions))
        {
            Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
        }
    }

    // ─────────────────────────────────────────────────────────────────────
    // 4) D1-carried hardening minor #2 — change-password rejects null/empty NewPassword with 400.
    // ─────────────────────────────────────────────────────────────────────

    [Fact]
    public async Task ChangePassword_NullOrEmptyNewPassword_Gets400_NotA500()
    {
        await using var factory = await CreateFactoryAsync(demoEnabled: false);

        using (var bootstrapClient = factory.CreateClient())
        using (var bootstrap = await bootstrapClient.PostAsJsonAsync(
                   "/v1/auth/bootstrap",
                   new { username = "cp-admin", password = "AdminPass123!", displayName = (string?)null },
                   JsonOptions))
        {
            Assert.Equal(HttpStatusCode.OK, bootstrap.StatusCode);
        }

        using var client = await LoginAsAsync(factory, "cp-admin", "AdminPass123!");

        using (var nullNew = await client.PostAsJsonAsync(
                   "/v1/auth/change-password",
                   new { currentPassword = "AdminPass123!", newPassword = (string?)null },
                   JsonOptions))
        {
            Assert.Equal(HttpStatusCode.BadRequest, nullNew.StatusCode);
        }

        using (var emptyNew = await client.PostAsJsonAsync(
                   "/v1/auth/change-password",
                   new { currentPassword = "AdminPass123!", newPassword = "" },
                   JsonOptions))
        {
            Assert.Equal(HttpStatusCode.BadRequest, emptyNew.StatusCode);
        }

        using (var whitespaceNew = await client.PostAsJsonAsync(
                   "/v1/auth/change-password",
                   new { currentPassword = "AdminPass123!", newPassword = "   " },
                   JsonOptions))
        {
            Assert.Equal(HttpStatusCode.BadRequest, whitespaceNew.StatusCode);
        }

        // Still logged in / account untouched — a legitimate change with a real NewPassword still works.
        using var goodChange = await client.PostAsJsonAsync(
            "/v1/auth/change-password",
            new { currentPassword = "AdminPass123!", newPassword = "BrandNewPass456!" },
            JsonOptions);
        Assert.Equal(HttpStatusCode.OK, goodChange.StatusCode);
    }
}
