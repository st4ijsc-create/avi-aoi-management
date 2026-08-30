using System.Text.Json.Serialization;
using Microsoft.AspNetCore.Authentication;
using Microsoft.AspNetCore.Authentication.Cookies;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Authorization.Policy;
using Microsoft.AspNetCore.DataProtection;
using Microsoft.AspNetCore.Hosting.Server;
using Microsoft.AspNetCore.Hosting.Server.Features;
using Microsoft.Extensions.FileProviders;
using St4i.EdgeCore.Config;
using St4i.EdgeCore.Infrastructure;
using St4i.EdgeCore.Models;
using St4i.Connector.Abstractions.Models;
using St4i.EdgeCore.Transport;
using St4i.EngineApi;
using St4i.EngineApi.Auth;
using St4i.EngineApi.Config;
using St4i.EngineApi.Endpoints;
using St4i.EngineApi.Fleet;
using St4i.EngineApi.Hubs;
using St4i.EngineApi.Safety;
using St4i.EngineApi.ServiceHost;

// WS-F1-T1 — install/uninstall/status verbs are handled as the VERY FIRST thing this process does,
// before WebApplication.CreateBuilder runs — a pure `St4i.EngineApi.exe --install` (say, from the
// installer's post-install step) must never spin up Kestrel, create the security/historian/WAL
// directories, or touch DPAPI, all of which CreateBuilder's downstream wiring below does. TryHandle
// returns false (with zero I/O) for every other argument shape, including plain "no args" normal
// startup, so this is a no-op for every existing caller/test.
if (ServiceInstallVerbs.TryHandle(args, out var serviceVerbExitCode))
{
    return serviceVerbExitCode;
}

// Task WI-5 (.superpowers/sdd/2026-07-28-giaidoan3-ws-i-closeout-blueprint/task-5-brief.md) — the
// out-of-band Admin-account-recovery verb (--reset-admin-password) is handled here too, for the exact same
// reason as ServiceInstallVerbs.TryHandle immediately above: it must never spin up Kestrel/DataProtection/
// the rest of the composition root below. See AdminRecoveryVerbs' own doc comment for the full rationale,
// including the honest threat-model write-up (task-5-report.md carries the complete version).
if (AdminRecoveryVerbs.TryHandle(args, out var adminRecoveryExitCode))
{
    return adminRecoveryExitCode;
}

// Task 3 — St4i.EngineApi: a thin ASP.NET host wrapping the SAME EdgeCore engine the WPF exhibition
// app drives (SimulatedDriver/ScenarioAwareDriver/EdgePipeline/SwitchableTransport/TransportCoordinator
// — the 4 WPF-independent classes this task relocated INTO EdgeCore so both apps share them
// byte-for-byte), exposed over HTTP + WebSocket so the new web UI (Tasks 4-7) can drive the fleet. No
// Go/Rust rewrite — see task-3-report.md for the full write-up.
var builder = WebApplication.CreateBuilder(args);

// WS-F1-T1 — self-gating Windows Service registration. AddWindowsService swaps in a ServiceBase-driven
// IHostLifetime, but ONLY actually activates once Microsoft.Extensions.Hosting.WindowsServices'
// WindowsServiceHelpers.IsWindowsService() detects this process was launched BY the Service Control
// Manager (parent process svchost/services.exe) — for every other launch shape this exe already
// supports (interactively via `dotnet run`/double-click, spawned as St4i.DesktopShell's child process,
// or booted in-memory under WebApplicationFactory<Program> in tests) it's a complete no-op, so this line
// is safe to add with zero behavior change for every existing caller. It only takes effect once this
// exe is actually registered as a service (ServiceInstallVerbs' `--install` verb above) and started via
// `sc start`/services.msc/a reboot.
builder.Services.AddWindowsService(o => o.ServiceName = ServiceHostConstants.ServiceName);

// Fixed default port 5199 (brief: "Serve on a fixed port... override via --urls/env") — only applied
// when the caller didn't already pin one via --urls or ASPNETCORE_URLS, so both override mechanisms
// the brief calls out keep working normally.
if (!args.Any(a => a.StartsWith("--urls", StringComparison.OrdinalIgnoreCase)) &&
    Environment.GetEnvironmentVariable("ASPNETCORE_URLS") is null)
{
    builder.WebHost.UseUrls("http://localhost:5199");
}

builder.Services.ConfigureHttpJsonOptions(options =>
{
    options.SerializerOptions.Converters.Add(new JsonStringEnumConverter());
});

const string CorsPolicy = "EngineApiCors";
builder.Services.AddCors(options =>
{
    // Vite dev origin + the Tauri webview origin the desktop-wrapped build runs under (Task 3 brief).
    // WS-D-D6 — `.AllowCredentials()` added: `/v1/auth/*` (D1) now sets a cookie-based session, and a
    // cross-origin caller (the Tauri webview's `tauri://localhost` talking to the packaged engine on
    // its own `http://…:5199`, since `VITE_ENGINE_URL` there is NOT proxied same-origin the way Vite
    // dev's own `/v1` proxy makes plain `npm run dev` requests) needs the browser to actually attach/
    // accept that cookie on a cross-origin `fetch`. That requires BOTH the request's own
    // `credentials: "include"` (`lib/api.ts`'s shared `request<T>`) AND the response carrying this
    // exact opt-in — the two are a pair; neither alone is enough. Safe to combine with the explicit
    // `WithOrigins(...)` allow-list above (never `AllowAnyOrigin()`, which the CORS spec forbids
    // pairing with `AllowCredentials()` — reflecting credentials back to literally any origin would
    // let any page on the internet ride a visitor's session).
    options.AddPolicy(CorsPolicy, policy => policy
        .WithOrigins("http://localhost:5173", "tauri://localhost")
        .AllowAnyHeader()
        .AllowAnyMethod()
        .AllowCredentials());
});

// ── WS-D-D1 — local cookie-session auth core: SQLite user store, PBKDF2 password hashing (in-box
// PasswordHasher<AppUser>, no new product NuGet), first-run bootstrap, cookie auth, and a DEFAULT-DENY
// fallback authorization policy. security.db (the user store) and the DataProtection key ring that
// encrypts the auth cookie both live under the SAME ST4I_SECURITY_DIR-overridable root — mirrors the
// "resolve once, thread everywhere, overridable for tests" idiom ST4I_HISTORIAN_DIR/ST4I_WAL_DIR already
// use above/below — so every security-related file sits together under %ProgramData%\ST4I\sim\security
// by default. Per-route ROLE policies (who besides "any authenticated user" is allowed where) are D2;
// this task only lands the foundation + the DemoModeGate auto-login that keeps a Demo-flagged deployment
// (exhibition build, Playwright test engine) working once default-deny is on everywhere else.
var securityDir = SecurityDb.ResolveRoot();
Directory.CreateDirectory(securityDir); // WS-C's Critical lesson: file I/O doesn't create parents.

// WS-D final-security-review I-1(a) — lock down the security ROOT directory's ACL BEFORE anything (the
// keys\ subdirectory below, security.db) is created inside it. %ProgramData%'s default ACL grants
// Authenticated Users read (+ inheritance), which — combined with the DataProtection key ring living here
// being plaintext XML by default — is exactly what let a local non-admin forge a role=Admin cookie (the
// original I-1 finding). Restricting the PARENT to owner+SYSTEM+Administrators-only means every child
// created after this call (keys\, security.db) inherits that restricted ACL instead. Best-effort by
// design — see SecurityDirAcl.Apply's own doc comment for exactly what this does/why it can never crash
// startup, and for the (documented, accepted) limitation that pre-existing children from an install that
// predates this fix aren't retroactively re-ACL'd by this call alone. Also covers M-2: security.db's
// PBKDF2 password hashes + hash-chained audit log live under this SAME root.
SecurityDirAcl.Apply(securityDir, msg => Console.Error.WriteLine($"[startup] {msg}"));
// No app.Logger yet this early (builder.Build() hasn't run) — Console.Error is the best available sink for
// a warning that, by definition, must be visible even if this whole hardening step silently no-ops.

var securityKeysDir = Path.Combine(securityDir, "keys");
Directory.CreateDirectory(securityKeysDir);

builder.Services.AddDataProtection()
    .PersistKeysToFileSystem(new DirectoryInfo(securityKeysDir))
    .SetApplicationName("St4i.EngineApi")
    // WS-D final-security-review I-1(b) — DEFENSE-IN-DEPTH: encrypt the key ring at rest instead of
    // leaving it plaintext XML on disk (CredentialStore uses the same in-box DPAPI API for the mk_
    // device key, see its own doc comment — and, since FF-2, the SAME LocalMachine scope this key ring
    // already used). protectToLocalMachine: true (LocalMachine scope) deliberately — CurrentUser DPAPI
    // ties the encrypted keys to whichever single Windows account is running THIS process at the moment
    // they're written; this host is meant to eventually run as a Windows Service (WS-F1), and a service's
    // logon account can differ across machines/reinstalls (or get reconfigured) in a way an
    // interactively-run desktop app's account normally doesn't — CurrentUser scope would silently
    // invalidate every outstanding cookie (and force a fresh key-ring generation) the moment that happens.
    // LocalMachine scope avoids that fragility (any process on THIS machine can decrypt, not just one
    // specific account), which is an acceptable trade specifically BECAUSE SecurityDirAcl.Apply above
    // already restricts local non-admin filesystem READ access to the key files in the first place — DPAPI
    // here is a second, independent layer (protects the key material even if the ACL is ever
    // misconfigured, bypassed, or the file is copied off by an admin process), not the only thing standing
    // between a local non-admin and the key ring. (FF-2 review applied this exact same
    // ACL-then-LocalMachine-DPAPI pairing to CredentialStore's creds directory too — see
    // CredentialStore.Save and SecurityDirAcl's doc comment.)
    .ProtectKeysWithDpapi(protectToLocalMachine: true);

builder.Services.AddSingleton<IUserStore>(_ => new SqliteUserStore(securityDir));

// WS-D-D3 — the hash-chained audit log (tamper-EVIDENT against casual/accidental/app-level modification
// only — see SqliteAuditStore's doc comment for the full threat model; SAME security.db/directory as the
// user store above — SecurityDb's migration ladder now carries both the `users` and `audit_log` tables). Singleton
// so its in-process AppendAsync lock (see SqliteAuditStore's doc comment) actually serializes every
// append across the whole app, not just within one request. AuditRecorder is the thin per-request helper
// handlers will call (wiring it into each mutating handler is D4 — this task only registers it so it's
// available to call).
builder.Services.AddSingleton<IAuditStore>(_ => new SqliteAuditStore(securityDir));
builder.Services.AddSingleton<AuditRecorder>();

// G2-4 (docs/plans/2026-07-27-giaidoan2-synapse-connect-blueprint.md task 4) — the thin default-deny
// policy layer sitting INSIDE the existing RBAC+audit boundary at the fleet-actuating HTTP endpoints (see
// FleetEndpoints.cs/ScenarioEndpoints.cs). Rules are stateless singletons; EstopGuardRule is ordered FIRST
// so a SAFETY_BLOCKED denial always wins/reports over a later RoleObligationRule denial (PolicyEngine
// itself is "any deny wins", so this ordering only matters for WHICH reason code is reported when both
// would deny — see PolicyEngine's own doc comment).
//
// Task B-6 (.superpowers/sdd/2026-07-29-dotB-machine-control-blueprint/task-6-brief.md) — CriticalAlarmGuardRule
// added SECOND, still ahead of RoleObligationRule: the same safety-first precedence reasoning applies one
// level down — if a Critical alarm is active AND the caller also lacks the required role, SAFETY_BLOCKED
// (if HALT is also engaged) or NOT_READY (the Critical-alarm gate) should be the reported reason, not a bare
// role-denial that would leave an operator believing "get the right role" is the only obstacle.
builder.Services.AddSingleton<St4i.EngineApi.Policy.PolicyEngine>(_ =>
    new St4i.EngineApi.Policy.PolicyEngine(new St4i.EngineApi.Policy.IPolicyRule[]
    {
        new St4i.EngineApi.Policy.Rules.EstopGuardRule(),          // safety-first (deny precedence)
        new St4i.EngineApi.Policy.Rules.CriticalAlarmGuardRule(),  // second — see comment above
        new St4i.EngineApi.Policy.Rules.RoleObligationRule(),
    }));

builder.Services.AddAuthentication(CookieAuthenticationDefaults.AuthenticationScheme)
    .AddCookie(options =>
    {
        options.Cookie.HttpOnly = true;
        options.Cookie.SameSite = SameSiteMode.Lax;
        options.Cookie.SecurePolicy = CookieSecurePolicy.SameAsRequest;
        options.ExpireTimeSpan = TimeSpan.FromHours(8);
        options.SlidingExpiration = true;

        // Re-reads the user row on every cookie validation: a password/role/disable change bumps
        // security_stamp (see IUserStore's doc comments), which invalidates every cookie minted before
        // that change — including one already sitting in a browser — the moment it's next presented.
        options.Events.OnValidatePrincipal = async context =>
        {
            var username = context.Principal?.Identity?.Name;
            var stamp = context.Principal?.FindFirst(AuthEndpoints.SecurityStampClaimType)?.Value;

            var userStore = context.HttpContext.RequestServices.GetRequiredService<IUserStore>();
            var user = string.IsNullOrEmpty(username)
                ? null
                : await userStore.GetByUsernameAsync(username).ConfigureAwait(false);

            if (user is null || user.Disabled || !string.Equals(user.SecurityStamp, stamp, StringComparison.Ordinal))
            {
                context.RejectPrincipal();
                await context.HttpContext.SignOutAsync(CookieAuthenticationDefaults.AuthenticationScheme).ConfigureAwait(false);
            }
        };

        // This is an API + SPA, not a page-based login flow — a 302 to a login PAGE would break every
        // JSON caller (fetch/XHR) and the SPA's own client-side router. Return the plain status code
        // instead and let the web shell react to it.
        options.Events.OnRedirectToLogin = context =>
        {
            context.Response.StatusCode = StatusCodes.Status401Unauthorized;
            return Task.CompletedTask;
        };
        options.Events.OnRedirectToAccessDenied = context =>
        {
            context.Response.StatusCode = StatusCodes.Status403Forbidden;
            return Task.CompletedTask;
        };
    });

// Task B-6 fix round 1 (review, Important I2) — a role-refused attempt at either machine-write route
// (RequireAuthorization denying BEFORE MachineWriteEndpoints' own handler ever runs) otherwise left no audit
// trace at all. Registering this replaces the DI-resolved IAuthorizationMiddlewareResultHandler the
// authorization middleware (app.UseAuthorization(), below) uses; MachineWriteRoleDenialAuditHandler's own doc
// comment explains why this is the correct seam and why it is scoped to exactly the two machine-write routes,
// delegating byte-identically to the framework's own default handler for every other route/outcome.
builder.Services.AddSingleton<IAuthorizationMiddlewareResultHandler, St4i.EngineApi.Auth.MachineWriteRoleDenialAuditHandler>();

builder.Services.AddAuthorization(options =>
{
    // DEFAULT-DENY: every route that doesn't explicitly opt out via .AllowAnonymous() now requires an
    // authenticated cookie session. Only health/capabilities/the auth endpoints themselves/the SPA
    // fallback are exempted today (see their own .AllowAnonymous() call sites) — every OTHER existing
    // route (fleet, scenario, settings, onboarding, config, historian, the inspector WS stream, …)
    // requires auth. DemoAutoLoginMiddleware is what keeps a Demo-flagged deployment usable against this
    // same policy with zero explicit login (demo-admin is minted with Roles.Admin, so it also satisfies
    // every named policy below).
    options.FallbackPolicy = new AuthorizationPolicyBuilder()
        .RequireAuthenticatedUser()
        .Build();

    // WS-D-D2 — the three named per-route policies the WS-D §2 role matrix chains onto every mapped
    // route via .RequireAuthorization(Policies.X) (see each Endpoints file). Each is a plain role-OR: a
    // higher-privileged role always satisfies a lower policy too (Admin passes Operator/Engineer/Admin;
    // Engineer passes Operator/Engineer but not Admin; Operator passes only Operator) — never the
    // opposite. The FallbackPolicy above still backstops anything that somehow ends up with neither an
    // explicit policy nor AllowAnonymous.
    options.AddPolicy(Policies.Operator, policy => policy.RequireRole(Roles.Operator, Roles.Engineer, Roles.Admin));
    options.AddPolicy(Policies.Engineer, policy => policy.RequireRole(Roles.Engineer, Roles.Admin));
    options.AddPolicy(Policies.Admin, policy => policy.RequireRole(Roles.Admin));
});

// ── EdgeCore composition root — mirrors the WPF app's App.xaml.cs ConfigureServices Live/Demo/Auto
// transport-mode wiring byte-for-byte (now possible because SwitchableTransport/TransportCoordinator
// live in EdgeCore, not the WPF project).
//
// WS2-T1 (docs/PRODUCTION_UI_DESIGN.md §2.1/§2.2) — DEFAULT MODE IS LIVE (this is a product sold to
// customers, not a demo tool first): the initial TransportMode is Demo ONLY when DemoModeGate reads
// ST4I_DEMO_ENABLED=true from the environment, matching the exhibition-packaging contract (§2.5) — a
// `.exe` shipped with that flag set beside it comes up offline with the fabricated 11-machine fleet
// already running, zero extra clicks; a customer deployment (flag absent, the default) comes up Live
// and empty until connected to a real ST4I server. DemoModeGate itself also gates whether Demo can
// EVER be switched to at runtime (see ModeEndpoints) — so a flag-off deployment can neither start in
// nor be switched into Demo.
builder.Services.AddSingleton<DemoModeGate>();
builder.Services.AddSingleton<EventBus>();
builder.Services.AddSingleton<DemoTransport>();

// WS-C-T2 — resolves the ST4I_WAL_* env knobs ONCE, threaded into both the startup LiveTransport's
// queuePath (below) and the TransportCoordinator itself (so every later RebuildLive — a settings-driven
// serverUrl/machineCode/verifyTls change — keeps resolving queue files off the SAME WalOptions). Disabled
// (ST4I_WAL_ENABLED=false) means queuePath stays null everywhere, i.e. byte-identical to pre-WS-C
// behavior (in-memory queue only, nothing written to disk).
//
// C-1 (Critical, WS-C final-review fix wave) — on a fresh install nothing has ever created
// %ProgramData%\ST4I\sim\wal; the SDK's own St4iDeviceClient.Enqueue writes with File.AppendAllText
// directly, which does NOT create missing parent directories, so without this the FIRST offline write
// after a fresh install throws DirectoryNotFoundException, which escapes LiveTransport.SendAsync
// uncaught and gets swallowed into a lost, unqueued ack (see WalOptions.EnsureDir's own remarks). Must
// run BEFORE the queuePath below is computed/handed to LiveTransport.ForMachine. Deliberately not
// try/caught: a WAL root that can't be created is a fatal misconfiguration that should stop startup, not
// silently downgrade to an in-memory-only queue.
//
// 🔴 Task J-3 — THE RULE THIS OBEYS, and it is the SAME rule the startup settings replay
// (`TryReplayStartupSettings`, far below in this file) obeys when it does the OPPOSITE. Both were defensible on their own terms and nothing reconciled them;
// FleetCore's P5 booked that, and README §15.9 now carries the reconciliation in full, for operators.
// Stated here so this site can be argued with without leaving the file:
//
//   A host refuses to start over a bad configuration only when starting would be the QUIETER failure.
//   THE TEST, and it is ONE test: would continuing HIDE the loss — would the thing that stopped working go
//   on being presented as working, with nothing on any surface saying otherwise? If yes, stopping is the
//   only channel left. If the loss can be named where somebody reads it, the host comes up and reports.
//
// DOMAIN, so a later reading cannot quietly shrink it to "relocatable roots": startup-path CONFIGURATION
// DECISIONS — every statement a composition root runs before its host serves, at which a value from outside
// the running program can fail, and where that statement decides whether the process continues. Roughly a
// third are roots; the rest are argv, a bind address, the register and node maps, connectors.json,
// fleet.json, the product/ecosystem catalogues, persisted connector rows, a broker port, an ACL step, five
// FromEnvironment factories and the replay itself.
//
// 🔴 THE SET IS ENUMERATED IN docs/startup-failure-posture.md — A LIST, NOT A COUNT, and read that before
// extending anything here. Earlier rounds of this analysis stated a scalar ("thirty-six sites, thirty-two
// agree") in five places with the members written down nowhere the tree could reach; an independent
// re-derivation then returned a different number and found two divergences the scalar had absorbed
// (ProductConfigStore and SimulatedEcosystem, both reached by the very GetRequiredService<FleetHost>() call
// this file already makes). That is §8.1's standing class — a scalar summarising a heterogeneous set — and
// the remedy is to list rather than to count. No number is staked here on purpose.
//
// Here the test says STOP: the only alternative is a null queuePath, and an in-memory queue keeps returning
// successful acks for records that die with the process — the loss is invisible in the OUTCOME, which is the
// whole reason C-1 was Critical. The settings replay below fails the same test in the other direction, which
// is why it comes up: same rule, opposite answer, neither an exception to the other.
//
// 🔴 PROVENANCE — env var here, a file the product wrote there — is the REASON the two arms feel different
// and is what an operator needs in order to repair either. It is NOT a second condition. An earlier round of
// this work made it one; over the whole enumerated set it changes exactly ONE prediction, and at the replay
// below it is refuted outright by that arm's own remedy string, which tells the operator to edit or delete
// the file and restart. Withdrawn as a test, kept as a reason.
var wal = WalOptions.FromEnvironment();
if (wal.Enabled) wal.EnsureDir();
builder.Services.AddSingleton(_ => LiveTransport.ForMachine(
    serverUrl: FleetHost.DefaultServerUrl,
    mkKey: string.Empty,
    machineCode: FleetHost.DefaultMachineCode,
    queuePath: wal.Enabled ? wal.ResolveQueueFile(FleetHost.DefaultMachineCode) : null,
    verifyTls: true));
builder.Services.AddSingleton(sp => new AutoTransport(sp.GetRequiredService<LiveTransport>(), sp.GetRequiredService<DemoTransport>()));
builder.Services.AddSingleton(sp => new SwitchableTransport(sp.GetRequiredService<DemoTransport>()));
builder.Services.AddSingleton<ITransport>(sp => sp.GetRequiredService<SwitchableTransport>());
builder.Services.AddSingleton(sp => new TransportCoordinator(
    sp.GetRequiredService<SwitchableTransport>(),
    sp.GetRequiredService<DemoTransport>(),
    sp.GetRequiredService<LiveTransport>(),
    sp.GetRequiredService<AutoTransport>(),
    sp.GetRequiredService<DemoModeGate>().Enabled ? TransportMode.Demo : TransportMode.Live,
    wal));

// WS-C-T4 — the idle-backlog drain the SDK's own opportunistic replay can't provide: an idle machine
// after an outage never sends anything new, so LiveTransport.SendAsync's own opportunistic flush never
// gets a chance to run. WalFlushPump re-fetches TransportCoordinator's CURRENT LiveTransport + Mode on
// every tick (so a Settings-triggered RebuildLive or a Live/Demo/Auto switch is transparent — see the
// pump's own remarks) and skips cleanly whenever Mode != Live (durability only applies in Live mode —
// see the WS-C blueprint's Auto-mode caveat). IAsyncDisposable singleton, like HistorianWriter above —
// the generic host's ServiceProvider disposes it automatically on shutdown.
builder.Services.AddSingleton(sp =>
{
    var coordinator = sp.GetRequiredService<TransportCoordinator>();
    var logger = sp.GetRequiredService<ILoggerFactory>().CreateLogger("WalFlushPump");
    return new St4i.EdgeCore.Transport.WalFlushPump(
        getLive: () => coordinator.Mode == TransportMode.Live ? coordinator.Live : null,
        // WS-C-T5 — same `wal` WalOptions instance the TransportCoordinator registration above already
        // captures, so the pump's per-tick size-guardrail trim (WalMaintenance.TrimDirectory) enforces
        // the SAME MaxBytes/Directory/Enabled knobs every RebuildLive-built LiveTransport resolves its
        // queue file against.
        walOptions: wal,
        logInfo: msg => logger.LogInformation("{WalFlushPumpMsg}", msg),
        logError: (ex, msg) => logger.LogError(ex, "{WalFlushPumpMsg}", msg));
});

builder.Services.AddSingleton<FleetHost>();
builder.Services.AddSingleton<OnboardingService>();

// ── Config-sync (Task C2) — ProductConfigStore (the MACHINE's local product-config) is separate from
// SimulatedEcosystem (Demo's "the ecosystem"); ConfigSyncEngine is registered against the SWITCHABLE
// backend, not SimulatedEcosystem directly, so Task C3 can add a Live backend and re-point it by mode
// with no changes here — see SwitchableConfigSyncBackend's doc comment.
builder.Services.AddSingleton<ProductConfigStore>();
builder.Services.AddSingleton<SimulatedEcosystem>();
builder.Services.AddSingleton(sp => new SwitchableConfigSyncBackend(sp.GetRequiredService<SimulatedEcosystem>()));
builder.Services.AddSingleton<IConfigSyncBackend>(sp => sp.GetRequiredService<SwitchableConfigSyncBackend>());

// ── Config-sync Live (Task C3) — same "eager, unconfigured instance at startup, rebuilt on Settings"
// shape as the LiveTransport/TransportCoordinator registration above. FleetHost forwards ApplyMode/
// UpdateSettings into this coordinator too (see its own ctor) so a Live/Auto mode switch or a
// serverUrl/machineCode edit re-points SwitchableConfigSyncBackend exactly like it already re-points
// SwitchableTransport.
builder.Services.AddSingleton(_ => LiveConfigSyncBackend.ForMachine(
    serverUrl: FleetHost.DefaultServerUrl,
    mkKey: string.Empty,
    machineCode: FleetHost.DefaultMachineCode,
    verifyTls: true));
builder.Services.AddSingleton(sp => new ConfigSyncCoordinator(
    sp.GetRequiredService<SwitchableConfigSyncBackend>(),
    sp.GetRequiredService<SimulatedEcosystem>(),
    sp.GetRequiredService<LiveConfigSyncBackend>()));

builder.Services.AddSingleton<ConfigSyncEngine>();

// Task 2 (docs/plans/2026-07-21-machine-config.md) — machine operating-configuration store (Task 1's
// MachineConfigStore). Deliberately a SEPARATE singleton/file from ProductConfigStore/SimulatedEcosystem
// above: this is "what this machine is actually running" (torque/exposure/speed setpoints), not product
// spec/points or the automation recipe payload those stores already own.
builder.Services.AddSingleton<MachineConfigStore>();

// WS-A-T7 — the durable historian: SqliteHistorianStore is the on-disk backend, HistorianWriter is the
// bounded-channel write-behind FleetHost forwards committed readings/run events into (see FleetHost's
// ctor — the param is optional, so DI supplying it here is what actually turns the hook on; every
// FleetHost test that constructs it directly without one keeps behaving exactly as before). Additive
// only — nothing here changes the existing in-memory MachineState path that powers the live UI.
//
// WS-A-T14 (capstone) — the historian directory is relocatable via ST4I_HISTORIAN_DIR (ops: point a
// deployment at a different disk/volume; testability: an integration test can stand up a whole engine
// against a throwaway temp dir instead of polluting %ProgramData%). Unset/empty falls back to
// SqliteHistorianStore's own default (%ProgramData%\ST4I\sim\historian) — the ctor already treats
// null/whitespace that way, so resolving here once and threading the SAME resolved value into
// OeeSettingsStore keeps every historian-adjacent file (historian.db, oee-settings.json) in one place,
// exactly like the comment below already promises.
var historianDir = Environment.GetEnvironmentVariable("ST4I_HISTORIAN_DIR");
builder.Services.AddSingleton<St4i.EdgeCore.Historian.IHistorianStore>(
    _ => new St4i.EdgeCore.Historian.SqliteHistorianStore(string.IsNullOrWhiteSpace(historianDir) ? null : historianDir));
builder.Services.AddSingleton(sp =>
{
    var logger = sp.GetRequiredService<ILoggerFactory>().CreateLogger("Historian");
    return new St4i.EdgeCore.Historian.HistorianWriter(
        sp.GetRequiredService<St4i.EdgeCore.Historian.IHistorianStore>(),
        logWarning: msg => logger.LogWarning("{HistorianMsg}", msg),
        logError: (ex, msg) => logger.LogError(ex, "{HistorianMsg}", msg));
});

// P2-1 (WS-J Asset Registry) — the persistent canonical asset registry: a durable SQLite row per roster
// machine (ISA-95 URN, lifecycle, config-checksum), auto-upserted by FleetHost (its optional
// `assetRegistry` ctor param — see FleetHost.cs) on roster-seed + RegisterMachine, read/mutated via
// AssetEndpoints (GET /v1/assets, GET /v1/assets/{code}, PUT /v1/assets/{code}/lifecycle). Registered as
// a singleton BEFORE Build() (same "resolve FleetHost's optional ctor params from DI" convention as
// HistorianWriter/MachineConfigStore/... above) and pointed at UnsOptions.FromEnvironment() for the
// URN's site/area/line/cell address — the SAME process-wide address UnsTopicBuilder already uses.
// Relocatable via ST4I_ASSETS_DIR, same ops/testability rationale as ST4I_HISTORIAN_DIR above.
var assetsDir = Environment.GetEnvironmentVariable("ST4I_ASSETS_DIR");
builder.Services.AddSingleton<St4i.EngineApi.AssetRegistry.IAssetRegistry>(sp =>
    new St4i.EngineApi.AssetRegistry.AssetRegistryStore(
        St4i.EdgeCore.Uns.UnsOptions.FromEnvironment(),
        string.IsNullOrWhiteSpace(assetsDir) ? null : assetsDir,
        logError: (ex, msg) => sp.GetRequiredService<ILoggerFactory>().CreateLogger("Assets").LogError(ex, "{AssetsMsg}", msg)));

// WS-HMI-0a Task 5 — the two stores Tasks 2/3 built (ComponentModelStore/TagNamespaceStore) registered
// behind their seams (IComponentModelStore/ITagNamespaceStore), same "resolve env var, pass explicit-or-
// null to the ctor, AddSingleton BEFORE Build()" convention as IAssetRegistry directly above. NO endpoint
// reads either seam yet — that is WS-HMI-0b's job, and this task deliberately does not add one (see this
// task's brief: "Không thêm endpoint nào — API là WS-HMI-0b"). Registering the seam now, endpoint-free, is
// what lets 0b depend on DI resolution instead of constructing its own store.
// WS-HMI-0b Task 1, fix round 3 (HIGH-A) — IComponentModelStore/ITagNamespaceStore resolve to the
// CANONICALIZING decorators (CanonicalMachineCodeStores.cs), never to ComponentModelStore/TagNamespaceStore
// directly. This is the structural half of the HIGH-A fix: every current and future caller that takes
// IComponentModelStore/ITagNamespaceStore as a parameter gets machine-code case-normalization for free,
// because there is no code path in this composition root that hands out the raw, case-sensitive-keyed
// store to an HTTP handler. See that file's own doc comment for the full rationale.
var hmiModelDir = Environment.GetEnvironmentVariable(St4i.EngineApi.HmiModel.ComponentModelStore.EnvVarDir);
builder.Services.AddSingleton<St4i.EngineApi.HmiModel.IComponentModelStore>(
    _ => new St4i.EngineApi.HmiModel.CanonicalizingComponentModelStore(
        new St4i.EngineApi.HmiModel.ComponentModelStore(
            string.IsNullOrWhiteSpace(hmiModelDir) ? null : hmiModelDir)));

var hmiTagsDir = Environment.GetEnvironmentVariable(St4i.EngineApi.HmiModel.TagNamespaceStore.EnvVarDir);
// WS-HMI-0b Task 2, fix round 2 — ONE raw TagNamespaceStore instance, shared by the canonicalizing
// decorator and by the read-only collision query, and constructed LAZILY so that merely booting the host
// still does not create the database (the previous inline `new` inside the factory had that property and
// losing it would change startup behaviour for every test that asserts a directory is untouched).
//
// 🔴 The raw store is deliberately a LOCAL, never an AddSingleton: Task 1's structural fix is that DI hands
// out ONLY the canonicalizing decorator, never the case-sensitive-keyed store, so a future handler cannot
// obtain the raw one even by asking for it by type. The collision query is registered instead — a
// read-only, SELECT-only diagnostic seam that cannot be mistaken or substituted for a store.
var rawTagNamespaceStore = new Lazy<St4i.EngineApi.HmiModel.TagNamespaceStore>(
    () => new St4i.EngineApi.HmiModel.TagNamespaceStore(
        string.IsNullOrWhiteSpace(hmiTagsDir) ? null : hmiTagsDir));

builder.Services.AddSingleton<St4i.EngineApi.HmiModel.ITagNamespaceStore>(
    _ => new St4i.EngineApi.HmiModel.CanonicalizingTagNamespaceStore(rawTagNamespaceStore.Value));

// Takes the path FROM the store rather than re-deriving the file name, so the two cannot point at
// different databases. See TagIndexCollisionQuery.cs for why a bulk SQL read exists at all and what pins
// it against the frozen store's schema.
builder.Services.AddSingleton<St4i.EngineApi.HmiModel.ITagIndexCollisionQuery>(
    _ => new St4i.EngineApi.HmiModel.SqliteTagIndexCollisionQuery(rawTagNamespaceStore.Value.DbPath));

// GĐ3 sub-4 LC-1 (.superpowers/sdd/2026-07-27-giaidoan3-alarms-linecontroller-blueprint/task-1-brief.md) —
// the alarm backbone: a durable SQLite store (alarms.db) for the ISA-18.2 alarm model (raise/clear/ack/
// list/history). Registered as a singleton BEFORE Build() (same convention as IAssetRegistry above) so
// PolicyResults.DenyAsync's ctx.RequestServices.GetService<IAlarmStore>() resolves the SAME instance every
// mutating handler's policy-deny path raises against — a singleton also matters here because AlarmStore's
// SQLite connections are short-lived-per-call, not because of any in-process lock (unlike SqliteAuditStore).
// Relocatable via ST4I_ALARMS_DIR, same ops/testability rationale as ST4I_ASSETS_DIR above.
var alarmsDir = Environment.GetEnvironmentVariable("ST4I_ALARMS_DIR");

// Task C-1 (.superpowers/sdd/2026-07-30-dotC-alarm-notification-blueprint/task-1-brief.md) — the alarm
// NOTIFICATION seam: an edge detector in front of a bounded, drop-oldest channel drained in the
// background (see AlarmNotifier). Every Đợt C channel sits behind this, and 🔴 Task C-8 corrected this
// paragraph because all four of them now EXIST and are constructed a few hundred lines below: webhook
// (C-3), SMTP (C-4), local annunciation (C-5) and the physical relay (C-6). This comment used to say
// "NONE of them exists yet, so the notifier is registered with no dispatch delegate" — true when C-1
// wrote it, false from C-3 onward. Which channels are actually built on any given boot is decided by
// what is configured in NotificationConfigStore; `implementedNotificationChannels` below is the list
// this build can construct at all.
//
// 🔴 Task C-2 (task-2-brief.md) — C-1's placeholder ST4I_ALARM_NOTIFY_ENABLED env gate IS GONE, and this
// is what replaced it. NotificationConfigStore is the ONLY thing that decides whether anything is
// DELIVERED, and each channel's own `enabled` flag decides whether that channel delivers. Two enable
// mechanisms cannot disagree if there is only one.
//
// 🔴 Task C-8 corrected the second half of that paragraph too. It used to read "the seam runs iff at
// least one channel has been configured" — which review round 1 (I5) deliberately overturned. The
// notifier is now registered UNCONDITIONALLY (see the registration below), so a fresh install with
// nothing configured DOES start one bounded channel, one drain loop and one hosted service it did not
// start before Đợt C. That is a real, accepted behaviour change, and the batch's earlier claim to be
// "additive and default-off, bit-for-bit identical when nothing is configured" is RETIRED. What is still
// true is the part that matters: with nothing configured, nothing is delivered to anybody.
//
// The failure mode that removal exists to prevent (found by C-1's own review) ran in the direction C-1 did
// not expect: an operator could configure a webhook perfectly, never learn an environment variable also
// had to be set, and get a fully configured alarm system that notified absolutely nobody with no error
// anywhere. NotificationStartupNotices now guarantees the complement of that — see the notice loop after
// app.Build() below, and that class's own exhaustively-tested invariant.
//
// Constructed as a LOCAL (not just inside AddSingleton) for exactly the reason connectorConfigStore below
// is: this file must read the channel list synchronously BEFORE app.Build() to decide whether to register
// the seam at all, and the SAME instance must be the one C-7's handlers later resolve via DI.
var notificationsDir = Environment.GetEnvironmentVariable(St4i.EngineApi.Alarms.NotificationConfigStore.EnvVarDir);
IReadOnlyList<St4i.EngineApi.Alarms.NotificationChannelSummary> notificationChannels =
    Array.Empty<St4i.EngineApi.Alarms.NotificationChannelSummary>();
St4i.EngineApi.Alarms.NotificationConfigStore? notificationConfigStore = null;
try
{
    notificationConfigStore = new St4i.EngineApi.Alarms.NotificationConfigStore(
        string.IsNullOrWhiteSpace(notificationsDir) ? null : notificationsDir,
        logError: (ex, msg) => Console.Error.WriteLine($"[notifications] {msg} ({ex.GetType().Name}: {ex.Message})"));
    // 🔴 Task C-7 closed a carried item here: AddSingleton used to sit INSIDE this try, above the read
    // below, and the registration and the local could then disagree in both directions. A throwing
    // CONSTRUCTOR left the type unregistered while every later `is not null` check still saw the local
    // (which the catch does clear — but only after the registration had already been skipped); and a throw
    // from anything AFTER the registration left the type registered while the local was nulled, so the
    // channels below were not created but a handler resolving the store found one. It is now registered
    // once, after the whole load has either succeeded or failed, so "the local is non-null" and "the
    // container has one" are the same fact. Handlers resolve it with GetService and answer honestly when it
    // is absent — see NotificationEndpoints.
    // Blocking read, same "read a startup-only store synchronously before Build()" idiom as
    // connectorConfigStore.LoadAllAsync()/deviceIdentityStore.LoadOrCreate below.
    //
    // 🔴 Task C-4 review (m-3) — this comment used to say "ListAsync is itself never-throws", which stopped
    // being true in general when C-4 made the store propagate CANCELLATION. It remains true for THIS call
    // for a reason worth stating rather than relying on: no token is passed, so there is nothing that can
    // cancel it, and the only exception it can still raise is the one the store never throws — a failure.
    // So this try/catch covers the constructor (a directory that cannot be created, a schema that cannot be
    // migrated) exactly as before. A future edit that threads a token through here would need this
    // paragraph answered first.
    notificationChannels = notificationConfigStore.ListAsync().GetAwaiter().GetResult();
}
catch (Exception ex)
{
    // Never a startup crash over a config store — same posture as every other startup config load here.
    // The consequence is loud rather than silent: with no channels, the notice block below warns that
    // nothing will be sent to anyone.
    notificationConfigStore = null;
    Console.Error.WriteLine(
        $"[startup] Failed to open the alarm notification configuration store — no notification channel " +
        $"will run this session: {ex.Message}");
}

// 🔴 Task C-7 — registered HERE, outside the try, and only when the store is genuinely usable. See the
// comment above for the two ways the previous placement could make the container and this local disagree.
if (notificationConfigStore is not null)
{
    builder.Services.AddSingleton(notificationConfigStore);
}

// 🔴 Task C-7 — the first rate limiter in this product (Đợt B's top carried item). One global bucket in
// front of POST /v1/notifications/test, which is the only route that makes this engine emit a message to a
// third party. NotificationTestRateLimiter's own doc comment argues what is deliberately NOT limited.
// Registered unconditionally: the endpoint exists whether or not the configuration store opened, and a
// limiter that vanished with the store would leave the one outbound route unbounded on exactly the hosts
// that are already degraded.
builder.Services.AddSingleton<St4i.EngineApi.Endpoints.NotificationTestRateLimiter>();

// 🔴 The ONE place "which channels can this build actually deliver?" is expressed. C-4..C-6 each add their
// own member here; BOTH the notifier's dispatch AND the startup notices below are derived from the same
// two lines, so the "configured, enabled and still silent" warning stops firing for a channel exactly when
// that channel is wired in — nobody has to remember to delete it.
//
// 🔴 Task C-3 turned C-2's `bool hasDeliveryImplementation` into this SET, and had to: with one boolean,
// the moment the webhook landed the host would have reported "Alarm notifications are ACTIVE on 1
// channel(s): Smtp" for a build that cannot send an email. See NotificationStartupNotices.
var implementedNotificationChannels = new HashSet<St4i.EngineApi.Alarms.NotificationChannel>();

// 🔴 Task C-3 (.superpowers/sdd/2026-07-30-dotC-alarm-notification-blueprint/task-3-brief.md) — the FIRST
// channel: the point at which an alarm leaves this machine. It posts a versioned, HMAC-signed JSON body to
// every configured, enabled webhook instance whose minimum priority the alarm meets.
//
// Registered only when the configuration store opened, because that store IS its configuration — with no
// store there is no destination to read, and the notice block after Build() then correctly reports that
// nothing is configured. Registering it and adding to the set happen in the same `if`, so "this build can
// deliver Webhook" and "a webhook channel exists to deliver it" cannot disagree.
//
// Factory lambda (not the raw-instance overload) for the same reason as the AlarmNotifier registration
// below: the container OWNS what a factory returns and disposes it on shutdown, which is what releases the
// channel's process-lifetime HttpClient.
if (notificationConfigStore is not null)
{
    var storeForWebhook = notificationConfigStore;
    builder.Services.AddSingleton(sp =>
    {
        var logger = sp.GetRequiredService<ILoggerFactory>().CreateLogger("AlarmWebhook");
        return new St4i.EngineApi.Alarms.WebhookNotificationChannel(
            storeForWebhook,
            logError: (ex, msg) => logger.LogError(ex, "{AlarmWebhookMsg}", msg),
            logWarning: msg => logger.LogWarning("{AlarmWebhookMsg}", msg));
    });
    implementedNotificationChannels.Add(St4i.EngineApi.Alarms.NotificationChannel.Webhook);
}

// 🔴 Task C-4 (.superpowers/sdd/2026-07-30-dotC-alarm-notification-blueprint/task-4-brief.md) — the SECOND
// channel: e-mail, the one a customer asks for by name and the one this product can least guarantee,
// because it depends on a mail server nobody here controls.
//
// Registered on exactly the same terms as the webhook above — only when the configuration store opened
// (that store IS its configuration), and adding to `implementedNotificationChannels` happens in the same
// `if`, so "this build can deliver Smtp" and "an SMTP channel exists to deliver it" cannot disagree. Adding
// the set member is the whole of what makes the startup notices stop warning that an enabled SMTP channel
// is silently unimplemented — which is the property C-3 changed that flag from a bool to a set to get.
//
// No `using`/factory-disposal concern here, unlike the webhook: this channel holds no process-lifetime
// client. SmtpClient cannot be shared (it refuses concurrent sends and disposal is the cancellation
// mechanism), so one is constructed and disposed per attempt inside the channel.
if (notificationConfigStore is not null)
{
    var storeForSmtp = notificationConfigStore;
    builder.Services.AddSingleton(sp =>
    {
        var logger = sp.GetRequiredService<ILoggerFactory>().CreateLogger("AlarmEmail");
        return new St4i.EngineApi.Alarms.SmtpNotificationChannel(
            storeForSmtp,
            logError: (ex, msg) => logger.LogError(ex, "{AlarmEmailMsg}", msg),
            logWarning: msg => logger.LogWarning("{AlarmEmailMsg}", msg));
    });
    implementedNotificationChannels.Add(St4i.EngineApi.Alarms.NotificationChannel.Smtp);
}

// 🔴 Task C-5 (.superpowers/sdd/2026-07-30-dotC-alarm-notification-blueprint/task-5-brief.md) — the THIRD
// channel, and the only one that still works when the network is gone: local annunciation to whoever has
// this product's web UI open.
//
// The hub is registered UNCONDITIONALLY, unlike the channel below, and the two are not the same decision.
// The hub is the in-process fan-out that GET /v1/alarms/annunciations reads from; that endpoint must be
// mappable and must answer honestly ("nothing is configured") even on a host whose notification
// configuration store could not be opened at all. The CHANNEL is what publishes into it, and it is
// registered on exactly the same terms as the webhook and SMTP channels above — only when the store opened,
// with the implementedNotificationChannels member added in the same `if`, so "this build can deliver
// LocalAnnunciation" and "a local-annunciation channel exists to deliver it" cannot disagree.
builder.Services.AddSingleton<St4i.EngineApi.Alarms.AlarmAnnunciationHub>();
if (notificationConfigStore is not null)
{
    var storeForAnnunciation = notificationConfigStore;
    builder.Services.AddSingleton(sp =>
    {
        var logger = sp.GetRequiredService<ILoggerFactory>().CreateLogger("AlarmAnnunciation");
        return new St4i.EngineApi.Alarms.LocalAnnunciationChannel(
            storeForAnnunciation,
            sp.GetRequiredService<St4i.EngineApi.Alarms.AlarmAnnunciationHub>(),
            // 🔴 Review round 1 (M-1) — no logWarning, unlike the two channels above, and its absence is
            // the point: this channel has no warning path to wire, so a delegate here would be one that
            // provably never fires. See LocalAnnunciationChannel's own field comment.
            logError: (ex, msg) => logger.LogError(ex, "{AlarmAnnunciationMsg}", msg));
    });
    implementedNotificationChannels.Add(St4i.EngineApi.Alarms.NotificationChannel.LocalAnnunciation);
}

// 🔴🔴 Task C-6 (.superpowers/sdd/2026-07-30-dotC-alarm-notification-blueprint/task-6-brief.md) — the FOURTH
// and last channel, and the ONLY one in this product where a notification moves something physical: a beacon
// or a horn, driven automatically from the alarm stream with no human in the loop.
//
// 🔴 NOT A SAFETY DEVICE. It is an ordinary machine write on an ordinary software path — it goes through the
// full Đợt B gate under the SAME action ids a human uses, which means the HALT latch refuses it exactly as it
// refuses POST /v1/machines/{code}/setpoint. Anyone who needs a light or horn that works while HALT is
// engaged, or while this process is not running, must HARDWIRE it. See RelayNotificationChannel's own doc
// comment for the full argument and for every failure mode this channel decides.
//
// Registered on exactly the same terms as the three channels above — only when the configuration store
// opened, with the implementedNotificationChannels member added in the same `if` (the disagreement C-5 caught
// by mutation: deleting that one line left the host delivering perfectly while telling the operator at every
// boot that the channel is DISCARDED).
//
// DEFAULT OFF is not enforced here but by the store: nothing is driven unless an operator has explicitly
// named a machine and a declared point/command AND enabled the row.
//
// It resolves FleetHost/PolicyEngine/AuditRecorder — all singletons registered above, none of which depends
// on IAlarmStore, so registering this inside the notifier's own factory graph introduces no cycle. It
// deliberately does NOT take IAlarmStore: see the channel's own comment on why its
// PolicyRequest.CriticalAlarmActive is resolved without one.
if (notificationConfigStore is not null)
{
    var storeForRelay = notificationConfigStore;
    builder.Services.AddSingleton(sp =>
    {
        var logger = sp.GetRequiredService<ILoggerFactory>().CreateLogger("AlarmRelay");
        return new St4i.EngineApi.Alarms.RelayNotificationChannel(
            storeForRelay,
            sp.GetRequiredService<FleetHost>(),
            sp.GetRequiredService<St4i.EngineApi.Policy.PolicyEngine>(),
            sp.GetRequiredService<AuditRecorder>(),
            logError: (ex, msg) => logger.LogError(ex, "{AlarmRelayMsg}", msg),
            // 🔴 This channel has a real warning path, unlike C-5's: a refused write, a rejected value, an
            // unresolvable machine and an INDETERMINATE outcome are all things an operator standing next to
            // the machine needs to read, and none of them is an internal fault.
            logWarning: msg => logger.LogWarning("{AlarmRelayMsg}", msg));
    });
    implementedNotificationChannels.Add(St4i.EngineApi.Alarms.NotificationChannel.Relay);
}

// Registered ONLY here. The alarm engine runs only in this process — St4i.EdgeService and both WPF apps
// never host IAlarmStore — so nothing about this reaches them.
//
// 🔴 Review round 1 (I5) — registered UNCONDITIONALLY, with no gate of any kind in front of it. C-2 first
// keyed this on "is at least one channel configured", which preserved C-1's zero-cost default-off but left
// exactly one transition — the first channel ever configured on a host that booted with none — needing a
// restart, bound only by a doc comment asking C-7 to warn about it. A rule that lives in prose is a rule
// the next task can miss. The cost of always registering is one bounded channel and one idle drain loop;
// whether anything is DELIVERED is decided by NotificationConfigStore at the point of delivery, never by
// whether this object exists. That removes the whole class of "configured but never registered" rather
// than deferring it.
//
// Factory lambda (not the raw-instance overload) so the container OWNS the instance and calls its
// IAsyncDisposable.DisposeAsync on shutdown — the same reason siteBridgeManager below is registered that
// way, and the same drain-then-bounded-cancel shutdown HistorianWriter already relies on.
builder.Services.AddSingleton(sp =>
{
    var logger = sp.GetRequiredService<ILoggerFactory>().CreateLogger("AlarmNotifier");
    // 🔴 Task C-3 filled this in. GetService (not GetRequiredService): a channel is registered only when
    // the configuration store opened, and a missing one must mean "the loop drains and discards" — C-1's
    // original state — not a startup crash.
    //
    // 🔴 Task C-6 replaced C-4's `Task.WhenAll` composition with ONE QUEUE AND ONE DRAIN LOOP PER CHANNEL,
    // and had to. WhenAll bounded ONE notification's cost at max(budget) rather than sum(budget), which was
    // the right fix while every channel was a network client — but it could not bound the NEXT
    // notification: the single drain loop does not read job N+1 until job N's WhenAll has completed, so a
    // webhook wedged for its whole 10s budget still held every other channel for 10s PER EDGE. With a
    // physical annunciator behind one of those channels that is a beacon held dark for 10s per standing
    // alarm at boot — a restart into a dead webhook, which is exactly when a beacon matters most. Per
    // channel, that delay is structurally impossible rather than merely bounded: there is no shared queue
    // and no shared thread left for a dead receiver to hold.
    //
    // ORDER NO LONGER MATTERS, and C-5's "APPENDED, never inserted" note is retired with the composition it
    // was about: every channel has its own loop, so no channel is "first". AlarmNotifierWiringTests'
    // concurrency test was rewritten to discriminate the property that DOES still exist — see
    // AWedgedChannelDoesNotDelayAnotherChannelsNEXTNotification_MeasuredInElapsedTime.
    //
    // The lane names are the NotificationChannel member names, deliberately: AlarmNotifier.ChannelStats and
    // the "queue for channel 'X' saturated" warning then speak the same vocabulary as the configuration
    // store and C-7's endpoint, instead of inventing a second set of channel names.
    var channels = new List<St4i.EngineApi.Alarms.AlarmNotificationChannel>();
    if (sp.GetService<St4i.EngineApi.Alarms.WebhookNotificationChannel>() is { } webhook)
    {
        channels.Add(new St4i.EngineApi.Alarms.AlarmNotificationChannel(
            nameof(St4i.EngineApi.Alarms.NotificationChannel.Webhook), webhook.DispatchAsync));
    }
    if (sp.GetService<St4i.EngineApi.Alarms.SmtpNotificationChannel>() is { } email)
    {
        channels.Add(new St4i.EngineApi.Alarms.AlarmNotificationChannel(
            nameof(St4i.EngineApi.Alarms.NotificationChannel.Smtp), email.DispatchAsync));
    }
    if (sp.GetService<St4i.EngineApi.Alarms.LocalAnnunciationChannel>() is { } annunciation)
    {
        channels.Add(new St4i.EngineApi.Alarms.AlarmNotificationChannel(
            nameof(St4i.EngineApi.Alarms.NotificationChannel.LocalAnnunciation), annunciation.DispatchAsync));
    }
    // 🔴 Task C-6 — the FOURTH channel, and the only one in this batch that moves something physical. Its
    // own queue and its own drain thread (above) are what stop a dead webhook or an unreachable mail relay
    // from holding a beacon dark.
    if (sp.GetService<St4i.EngineApi.Alarms.RelayNotificationChannel>() is { } relay)
    {
        channels.Add(new St4i.EngineApi.Alarms.AlarmNotificationChannel(
            nameof(St4i.EngineApi.Alarms.NotificationChannel.Relay), relay.DispatchAsync));
    }

    return new St4i.EngineApi.Alarms.AlarmNotifier(
        channels,
        logWarning: msg => logger.LogWarning("{AlarmNotifyMsg}", msg),
        logError: (ex, msg) => logger.LogError(ex, "{AlarmNotifyMsg}", msg));
});
// Forwards the interface to the SAME concrete singleton (same shape as IUnsPublisher -> UnsPublisher
// below); AlarmNotifier.DisposeAsync is idempotent, which is what makes being tracked twice safe.
builder.Services.AddSingleton<St4i.EngineApi.Alarms.IAlarmNotifier>(
    sp => sp.GetRequiredService<St4i.EngineApi.Alarms.AlarmNotifier>());
builder.Services.AddHostedService<St4i.EngineApi.Alarms.AlarmNotifierSeedService>();

builder.Services.AddSingleton<St4i.EngineApi.Alarms.IAlarmStore>(sp =>
    new St4i.EngineApi.Alarms.AlarmStore(
        string.IsNullOrWhiteSpace(alarmsDir) ? null : alarmsDir,
        logError: (ex, msg) => sp.GetRequiredService<ILoggerFactory>().CreateLogger("Alarms").LogError(ex, "{AlarmsMsg}", msg),
        // GetService (not GetRequiredService): unregistered — the default — means NullAlarmNotifier.
        notifier: sp.GetService<St4i.EngineApi.Alarms.IAlarmNotifier>()));

// GĐ3 sub-4 LC-2 (.superpowers/sdd/2026-07-27-giaidoan3-alarms-linecontroller-blueprint/task-2-brief.md) —
// the automatic (condition-based) alarm SOURCES riding on top of LC-1's store above: a periodic evaluator
// that polls FleetHost.GetDriverHealth()/GetKpiCounters() and raises/clears DriverHealth + windowed
// fleet-NG-rate alarms. AlarmThresholds.FromEnvironment() resolves ST4I_ALARM_NGRATE_THRESHOLD/MINSAMPLE/
// ST4I_ALARM_EVAL_INTERVAL_MS (unparseable/unset -> built-in defaults, same posture as WalOptions above).
// AlarmEvaluator is the pure, directly-testable core (see its own doc comment); AlarmEvaluatorService is
// the FIRST IHostedService this project registers — a thin PeriodicTimer loop that never crashes the host
// even if a tick fails (see that class's own doc comment). Both singletons resolve FleetHost/IAlarmStore,
// already registered above/below as singletons themselves.
builder.Services.AddSingleton(_ => St4i.EngineApi.Alarms.AlarmThresholds.FromEnvironment());
builder.Services.AddSingleton<St4i.EngineApi.Alarms.AlarmEvaluator>(sp =>
    new St4i.EngineApi.Alarms.AlarmEvaluator(
        sp.GetRequiredService<St4i.EngineApi.Alarms.IAlarmStore>(),
        sp.GetRequiredService<St4i.EngineApi.Alarms.AlarmThresholds>(),
        logError: (ex, msg) => sp.GetRequiredService<ILoggerFactory>().CreateLogger("AlarmEvaluator").LogError(ex, "{AlarmEvaluatorMsg}", msg)));
builder.Services.AddHostedService<St4i.EngineApi.Alarms.AlarmEvaluatorService>();

// G2-2 (docs/plans/2026-07-27-giaidoan2-synapse-connect-blueprint.md task 2) — the local UNS spine: an
// always-on loopback MQTTnet broker (UnsBroker) plus the dual-topic (Sparkplug + retained semantic-mirror)
// publisher (UnsPublisher) FleetHost threads into every EdgePipeline it builds (see FleetCore.StartLocked).
// Both are registered ONLY when UnsOptions.Enabled (default true, gated off via ST4I_UNS_ENABLED=false) —
// when disabled, neither type is registered at all, so FleetHost's optional `unsPublisher` ctor param
// resolves to its own `null` default exactly like HistorianWriter/MachineConfigStore/... already do for
// every pre-existing test that constructs FleetHost directly — i.e. byte-identical to pre-G2-2 behavior.
//
// The broker is started EAGERLY, right here (synchronously, before builder.Build()), wrapped in its own
// try/catch — deliberately NOT inside a DI factory lambda: a factory that throws fails the WHOLE
// GetRequiredService<FleetHost>() resolution graph (unlike a service that's simply never registered,
// which optional ctor params fall back to null for), which would take down the entire product over
// something as recoverable as "port already in use" (e.g. a stale previous instance still releasing the
// socket, or — in a test/CI environment — another process/test host bound to the same loopback port).
// Same "additive, never allowed to fail the host it's bolted onto" philosophy as every other UNS
// guarantee in this task (see UnsPublisher's own doc comment) applied one level up, to startup itself:
// if the broker can't bind, this run simply proceeds with unsPublisher staying null (byte-identical to
// UnsOptions.Enabled being false) rather than crashing.
var unsOptions = St4i.EdgeCore.Uns.UnsOptions.FromEnvironment();
if (unsOptions.Enabled)
{
    St4i.EdgeCore.Uns.UnsBroker? unsBroker = null;
    try
    {
        unsBroker = new St4i.EdgeCore.Uns.UnsBroker(unsOptions.BrokerPort);
        unsBroker.StartAsync().GetAwaiter().GetResult();
    }
    catch (Exception ex)
    {
        // No app.Logger yet this early (same reasoning as SecurityDirAcl.Apply's own Console.Error use
        // above) — this is a warning that must be visible even though the UNS spine silently no-ops.
        Console.Error.WriteLine(
            $"[startup] UNS broker failed to start on 127.0.0.1:{unsOptions.BrokerPort} — UNS spine disabled for this run: {ex.Message}");
        unsBroker = null;
    }

    if (unsBroker is not null)
    {
        builder.Services.AddSingleton(unsBroker);
        builder.Services.AddSingleton(sp =>
        {
            var logger = sp.GetRequiredService<ILoggerFactory>().CreateLogger("Uns");
            return new St4i.EdgeCore.Uns.UnsPublisher(
                unsOptions,
                logWarning: msg => logger.LogWarning("{UnsMsg}", msg),
                logError: (ex, msg) => logger.LogError(ex, "{UnsMsg}", msg));
        });

        // G2-3 — forwards the IUnsPublisher interface to the SAME concrete UnsPublisher singleton above, so
        // FleetHost (which now depends on IUnsPublisher?, not the concrete type — see FleetHost.cs) resolves
        // the real publisher when UNS is enabled. UnsPublisher.DisposeAsync is documented idempotent
        // precisely for this dual concrete+interface registration (the DI container may dispose both).
        builder.Services.AddSingleton<St4i.EdgeCore.Uns.IUnsPublisher>(
            sp => sp.GetRequiredService<St4i.EdgeCore.Uns.UnsPublisher>());
    }
}

// GĐ3 sub-4 LC-3 (.superpowers/sdd/2026-07-27-giaidoan3-alarms-linecontroller-blueprint/task-3-brief.md) —
// the supervisory PackML/ISA-88 state machine over FleetHost (GET /v1/line, POST /v1/line/{command}).
// GetService (not GetRequiredService) for IUnsPublisher — a host with UNS disabled (unsOptions.Enabled
// false, or the broker failed to bind above) never registers it, and LineController's own ctor param is
// optional (null → PublishLineState calls are simply skipped), same "byte-identical to today" contract
// FleetHost's own optional unsPublisher ctor param already gives every UNS-adjacent collaborator.
builder.Services.AddSingleton<St4i.EngineApi.Line.LineController>(sp =>
    new St4i.EngineApi.Line.LineController(
        sp.GetRequiredService<FleetHost>(),
        sp.GetService<St4i.EdgeCore.Uns.IUnsPublisher>(),
        logError: (ex, msg) => sp.GetRequiredService<ILoggerFactory>().CreateLogger("Line").LogError(ex, "{LineMsg}", msg)));

// GĐ3 EC-2 (docs/plans .../2026-07-27-giaidoan3-ecosystem-connect-blueprint/task-2-brief.md) — the device
// identity singleton (EC-1) + the Site-link northbound bridge manager.
//
// The identity is resolved via DeviceIdentityStore.LoadOrCreate exactly ONCE, right here, and reused as a
// DI singleton for the rest of this process's life — DeviceIdentityStore's own doc comment (EC-1 review
// C-1) is explicit that PersistKeySet writes a fresh CNG key-store entry on every LoadOrCreate call, so
// this must NEVER be called again per-request/per-call. A standalone box that never configures a Site link
// still legitimately gets a device identity (one keystore entry, once, at startup) — accepted/documented
// per EC-1/EC-2 — so this happens unconditionally, unlike the Site bridge manager below.
//
// GĐ3 closeout WI-4 — deviceIdentityStore is kept around (not just the DeviceIdentity it produced) so
// DeviceIdentityProvider can re-mint through the SAME store/directory on a later rotation.
//
// GĐ3 closeout WI-6 (task-6-brief.md item 5) — corrected the paragraph that used to live here: it claimed
// deviceIdentity itself was "still registered as a plain singleton (kept for the odd direct-construction
// consumer like SiteAdvertiser below, which captures it once at startup — a rotation isn't expected to
// update mDNS TXT records live)". Both halves of that were already false by the time this task found it:
// SiteAdvertiser (below) is constructed with deviceIdentityProvider, not a captured DeviceIdentity
// snapshot; and a rotation DOES update the live mDNS TXT records — POST /v1/site/identity/rotate
// (SiteEndpoints.RotateIdentityAsync) explicitly calls ISiteAdvertiser.RestartAsync() for exactly that
// reason. Every real consumer (SiteEndpoints, SiteBridgeManager, SiteAdvertiser) resolves
// DeviceIdentityProvider, never a bare DeviceIdentity — so the plain-singleton registration this comment
// used to justify was verified dead (repo-wide search, src/ and tests/, for anything resolving a bare
// DeviceIdentity from DI: zero hits) and removed. deviceIdentity itself is still a local value here —
// it's what LoadOrCreate returns and what seeds the DeviceIdentityProvider constructed right below — it
// just no longer needs its own separate DI registration since nothing ever asked the container for it.
// 🔴 Task J-3 — NAMED, NOT CHANGED. This one statement reaches THREE failure arms with THREE outcomes, and
// nothing says so (docs/startup-failure-posture.md §3.3):
//   * the constructor's Directory.CreateDirectory is unguarded, so a root that cannot be CREATED ends the
//     process here — which the rule at wal.EnsureDir above contradicts, since the loss is not hidden;
//   * a root that exists but cannot be WRITTEN comes up on an in-memory identity with an Error, and that
//     class says in as many words that an unwritable identity directory is an operational problem to fix on
//     disk rather than a reason the device cannot come up;
//   * and MintPfxBytes is called OUTSIDE Create's own try, so a CNG/crypto-provider failure at first mint is
//     an uncaught exit out of LoadOrCreate — a method whose class doc promises it "never lets a bad file
//     crash the caller". That third arm was missed by the first two rounds of this analysis and is not
//     decided by the rule at all, because no continue-arm exists to evaluate.
// Left exactly as they are: every direction is an operator-observable startup change and the owner has
// reaffirmed stop-and-report for those.
var deviceIdentityStore = new St4i.EdgeCore.Identity.DeviceIdentityStore(
    logError: (ex, msg) => Console.Error.WriteLine($"[startup] {msg}: {ex.GetType().Name}: {ex.Message}"));
var deviceIdentity = deviceIdentityStore.LoadOrCreate(unsOptions.Cell);
var deviceIdentityProvider = new St4i.EdgeCore.Identity.DeviceIdentityProvider(deviceIdentityStore, deviceIdentity);
builder.Services.AddSingleton(deviceIdentityProvider);

// GĐ3 sub-2 SD-1 (.superpowers/sdd/2026-07-27-giaidoan3-mdns-join-wizard-blueprint/task-1-brief.md) — the
// mDNS Site-discovery singleton backing GET /v1/site/discover. Registered UNCONDITIONALLY (unlike the
// UNS-gated SiteBridgeManager below) — browsing the LAN for a Site to join has nothing to do with whether
// THIS device's own local UNS spine happens to be enabled, and SiteEndpoints.DiscoverAsync takes a plain
// (non-nullable) ISiteDiscovery parameter, which — same [FromServices]/inferred-body-parameter hazard this
// class' own doc comment documents for SiteBridgeManager? — REQUIRES the type to always be registered, or
// minimal API's endpoint-metadata build throws at the first request touching ANY route. The singleton
// itself holds no socket (see SiteDiscovery's own doc comment: per-call ephemeral) — this registration is
// just wiring a real logger into its never-throws logError callback.
//
// GĐ3 closeout WI-1 Part A (.superpowers/sdd/2026-07-28-giaidoan3-ws-i-closeout-blueprint/task-1-brief.md)
// moved SiteDiscovery/ISiteDiscovery from St4i.EdgeCore.Site to St4i.EngineApi.Site (byte-identical
// otherwise) — see that class' own doc comment for why.
builder.Services.AddSingleton<St4i.EngineApi.Site.ISiteDiscovery>(sp =>
    new St4i.EngineApi.Site.SiteDiscovery(
        logError: (ex, msg) => sp.GetRequiredService<ILoggerFactory>().CreateLogger("SiteDiscovery").LogError(ex, "{Msg}", msg)));

// GĐ3 closeout WI-1 Part B (.superpowers/sdd/2026-07-28-giaidoan3-ws-i-closeout-blueprint/task-1-brief.md) —
// the advertise direction: the machine announces itself over mDNS (_st4i-machine._tcp) so a SYNAPSE Site's
// own join flow can find IT without an operator typing anything — the mirror image of the SiteDiscovery
// registration just above (a Site advertises _synapse-site._tcp; this device advertises a DIFFERENT
// service type, never the same one — see SiteAdvertiser's own doc comment). Deliberately
// default-ON-when-UNS-is-enabled — a signed-off, deliberate exception to this codebase's usual "off by
// default" additive idiom (see this task's own report) — independently disable-able via
// ST4I_MDNS_ADVERTISE=0. Registered as a plain singleton, exposed under BOTH St4i.EngineApi.Site.SiteAdvertiser
// and St4i.EngineApi.Site.ISiteAdvertiser, AND as the SECOND IHostedService in this project
// (AlarmEvaluatorService above is the first) — all three registrations resolve the SAME instance (same
// "factory-returned singleton IS disposed by the container on shutdown" rationale as the SiteBridgeManager
// registration below), so there is only ever one live MulticastService for this concern. The port is read
// off IServerAddressesFeature (never hard-coded 5199) — only populated once Kestrel has actually begun
// listening, which is why SiteAdvertiser.StartAsync defers its real Start() attempt to
// IHostApplicationLifetime.ApplicationStarted (same ordering constraint the WS-D-D5 binding-risk check
// further below already relies on for this exact feature) — Start() itself never throws either way (see
// that class' own doc comment), so a machine with no usable multicast-capable NIC still starts normally.
//
// 🔴 TASK AC-1 — THE READ GOES THROUGH BoundServerAddresses.Read AND MUST NOT BE INLINED BACK.
// This line used to be `… ?.Addresses as IReadOnlyCollection<string>`. IServerAddressesFeature.Addresses is
// declared ICollection<string>, and Kestrel's runtime type for it implements ICollection<string> WITHOUT
// implementing IReadOnlyCollection<string> — so that `as` produced null on every call, in every process,
// whether or not anything was bound, and the advertiser reported the timing message "No server addresses
// are bound yet" for a fault that had nothing to do with timing. The deferral above was never the problem
// and is unchanged: on the published build the failure is logged AFTER "Now listening on:" and AFTER
// "Application started.". See BoundServerAddresses' own doc comment for the measurement, and note that the
// WS-D-D5 check further below reads the SAME feature with `.ToArray()` and was therefore never blind —
// that asymmetry is why this now has one named reader instead of two spellings.
builder.Services.AddSingleton<St4i.EngineApi.Site.SiteAdvertiser>(sp =>
    new St4i.EngineApi.Site.SiteAdvertiser(
        unsOptions,
        deviceIdentityProvider,
        () => St4i.EngineApi.Site.BoundServerAddresses.Read(sp.GetRequiredService<IServer>()),
        sp.GetRequiredService<IHostApplicationLifetime>(),
        logError: (ex, msg) => sp.GetRequiredService<ILoggerFactory>().CreateLogger("SiteAdvertiser").LogError(ex, "{Msg}", msg)));
builder.Services.AddSingleton<St4i.EngineApi.Site.ISiteAdvertiser>(sp => sp.GetRequiredService<St4i.EngineApi.Site.SiteAdvertiser>());
builder.Services.AddSingleton<IHostedService>(sp => sp.GetRequiredService<St4i.EngineApi.Site.SiteAdvertiser>());

// The Site bridge manager only makes sense when there's an actual local UNS spine to bridge (a bridge with
// nothing to subscribe to is meaningless) — gated on the SAME unsOptions.Enabled this task's own UNS broker
// block above already gates on. When UNS is disabled, only the identity singleton above is registered (so
// EC-3's identity endpoint still works standalone), and no SiteLinkStore/SiteBridgeManager is constructed
// at all — byte-identical to pre-EC-2 behavior in that case.
// 🔴 TASK Q-1 FIX ROUND — carried out of the block below so the REPORT can be emitted on app.Logger once
// `app` exists, next to the settings file's own third-state report. The DECISION is taken below, where the
// read happens; only the reporting is deferred, and it is deferred for one reason: every other line in that
// block writes to Console.Error, which under AddWindowsService is NOT the Windows Event Log. The deployment
// this defect destroys data on is the headless service install, so the notice has to go on the channel that
// reaches it — the same argument §10.4 makes for the replay guard, and the same convention this file already
// uses for LogIfRegisterMachineCollided and the notification/binding notices.
St4i.EdgeCore.Site.SiteLinkRead? unreadableSiteLink = null;

if (unsOptions.Enabled)
{
    // GĐ3 closeout WI-3 — the durable northbound spool backing UnsBridge's forward path (WI-2 built the
    // store; this task wires it in). Resolved from the environment ONCE, right here, same "read env at the
    // composition root, pass the resolved collaborator down" idiom unsOptions itself already uses just
    // above — SiteBridgeManager/UnsBridge never read ST4I_BRIDGE_SPOOL_* themselves. ST4I_BRIDGE_SPOOL_ENABLED=0
    // (or a construction failure, caught the same "additive, never fails the host it's bolted onto" way
    // every other optional subsystem in this file already is) leaves bridgeSpool null, which reproduces
    // UnsBridge's PRE-WI-3 behavior byte-for-byte (drop while disconnected, no resync record).
    var spoolOptions = St4i.EdgeCore.Site.BridgeSpoolOptions.FromEnvironment();
    St4i.EdgeCore.Site.IBridgeSpool? bridgeSpool = null;
    if (spoolOptions.Enabled)
    {
        try
        {
            bridgeSpool = new St4i.EdgeCore.Site.BridgeSpool(
                spoolOptions.Directory,
                spoolOptions.MaxBytes,
                spoolOptions.MaxAgeHours,
                logError: (ex, msg) => Console.Error.WriteLine($"[startup] {msg}: {ex.GetType().Name}: {ex.Message}"));
        }
        catch (Exception ex)
        {
            Console.Error.WriteLine(
                $"[startup] Bridge spool failed to initialize — the Site bridge will run without a durable " +
                $"backlog for this run (drop-on-disconnect, same as before WI-3): {ex.Message}");
            bridgeSpool = null;
        }
    }

    var siteStore = new St4i.EdgeCore.Site.SiteLinkStore();
    // 🔴 Task Q-1 fix round — three outcomes, read once, BEFORE anything that can write. See the block
    // below the manager's construction for what each arm does and why.
    var siteLinkRead = siteStore.Read();
    var siteBridgeManager = new St4i.EdgeCore.Site.SiteBridgeManager(
        unsOptions,
        deviceIdentityProvider,
        siteStore,
        logWarning: msg => Console.Error.WriteLine($"[startup] {msg}"),
        logError: (ex, msg) => Console.Error.WriteLine($"[startup] {msg}: {ex.GetType().Name}: {ex.Message}"),
        spool: bridgeSpool);

    // 🔴 TASK Q-1 FIX ROUND — THE TWIN OF THE SETTINGS DEFECT, AND ITS PRECONDITION WAS WEAKER.
    //
    // WHAT WAS HERE: `siteBridgeManager.ApplyAsync(siteStore.Load() ?? new PersistedSiteLink())`.
    // `Load()` answered null both for "no file" and for "a file this process could not read", and
    // `ApplyAsync` calls `_store.Save(link)` UNCONDITIONALLY — before the `link.Enabled` check and outside
    // any success condition. So an unreadable site-link.json was REWRITTEN with the default record
    // (Enabled=false, Host="", Port=8883, SiteTrustPem="") on a start where nothing failed. The operator
    // lost the Site broker host, its port and the pinned trust anchor, and the device became standalone in
    // silence: `Save` SUCCEEDED, so the manager's own error path never fired and no line was written
    // anywhere. Gated on nothing — unlike the settings defect, which needed one of three ST4I_* variables
    // set, this needed only that the local UNS spine be on, and it is on by default.
    //
    // THE FIX IS TO SKIP THE CALL, and it is exactly as narrow as that. On the Unreadable arm ApplyAsync is
    // the writer, so not calling it is the whole remedy: with a default link the call disposes no bridge
    // (there is none yet), starts no bridge (Enabled is false) and sets `_current` to a value identical to
    // the field initializer it already holds. The ONLY observable it removes is the Save. The bridge is
    // Disabled either way, `GET /v1/site` reports what this process is actually running, and the file is
    // left exactly as it is.
    //
    // NOT DONE HERE, and named rather than left: `SiteBridgeManager.ReapplyCurrentAsync` (reachable from
    // POST /v1/site/identity/rotate) also reaches that unconditional Save, with a link this process
    // invented rather than read. On this arm `_current` is the default record, so a rotation would persist
    // it over the unreadable file. It is operator-INITIATED but not operator-CHOSEN, which is the
    // distinction the rule turns on, and closing it means changing when ApplyAsync persists — a change to a
    // method three callers share. Reported, not taken.
    if (siteLinkRead.Status == St4i.EdgeCore.Site.SiteLinkReadStatus.Unreadable)
    {
        unreadableSiteLink = siteLinkRead;
    }
    else
    {
        // Eager start (mirrors the UNS broker block above): ApplyAsync itself never throws (construct/connect
        // failures are caught+logged inside it, leaving the manager's Status() at Disabled/Down) — this
        // try/catch is only extra insurance so a truly unexpected failure here still can't crash startup.
        try
        {
            siteBridgeManager.ApplyAsync(siteLinkRead.Link ?? new St4i.EdgeCore.Site.PersistedSiteLink())
                .GetAwaiter().GetResult();
        }
        catch (Exception ex)
        {
            Console.Error.WriteLine($"[startup] Site bridge failed to start for this run — standalone: {ex.Message}");
        }
    }

    // Registered via a factory lambda (NOT the raw-instance AddSingleton overload) so the built-in DI
    // container actually owns/disposes this IAsyncDisposable on host shutdown — the raw-instance overload
    // does NOT get disposed by the container (verified: an externally-constructed instance handed to
    // AddSingleton(instance) is never Dispose()'d by ServiceProvider, unlike one returned from a factory).
    builder.Services.AddSingleton(_ => siteBridgeManager);
}

// G2-6 (docs/plans/2026-07-27-giaidoan2-synapse-connect-blueprint.md task 6) — the FIRST real
// field-protocol driver: a Modbus TCP poller, run as its OWN isolated FleetHost pipeline slot (the payoff
// of G2-5's per-slot fault isolation — a Modbus fault can never tear down the simulated fleet). Additive +
// env-gated OFF BY DEFAULT (ST4I_MODBUS_ENABLED unset/false, the opposite default polarity from
// ST4I_UNS_ENABLED — see ModbusOptions' own doc comment): when disabled, nothing is registered into
// `connectorRegistry` below (see the ConnectorRegistry singleton further down), so FleetHost's optional
// `connectorRegistry` ctor param has no "Modbus" entry in it — byte-identical to today, same contract as
// every other optional FleetHost dependency above. A missing/malformed register map (ST4I_MODBUS_MAP) logs
// a warning and disables Modbus for this run rather than crashing startup — same "never allowed to fail
// the host it's bolted onto" posture as the UNS broker-bind failure just above.
//
// GP-4 (.superpowers/sdd/2026-07-28-wsg-plugin-connector-seam-blueprint/task-4-brief.md) — this block's
// OWN config-loading/validation is UNCHANGED from before this task (same try/catch, same log message, same
// "disable for this run" outcome on failure): only what happens on SUCCESS changed — instead of registering
// a `Func<IDeviceDriver>` DI singleton consumed by a dedicated `FleetHost` constructor parameter, the
// already-loaded map JSON TEXT is hoisted (`modbusMapJson`, right alongside `modbusSeedDescriptor`) so the
// single `ConnectorRegistry` singleton below can register a `ModbusConnectorFactory` against it — no
// second parse, no second file read, no second validation step; the same successfully-loaded text is
// simply handed to the connector-level adapter too.
// P2-3 (docs/plans/2026-07-27-giaidoan2-pass2-blueprint.md task 3) — hoisted OUTSIDE the
// `if (modbusOptions.Enabled)` block below because `modbusMap`/`capturedMap` are scoped INSIDE it, while
// the roster-seed call (`fleetHost.RegisterMachine`, further down, well after `app.Build()`) needs to reach
// a descriptor built from that same map. Stays null (no-op) unless Modbus is enabled AND its register map
// actually loaded — additive + still default-off, same contract as before.
St4i.EdgeCore.Models.MachineDescriptor? modbusSeedDescriptor = null;
string? modbusMapJson = null;

var modbusOptions = St4i.EdgeCore.Drivers.Modbus.ModbusOptions.FromEnvironment();
if (modbusOptions.Enabled)
{
    St4i.EdgeCore.Drivers.Modbus.ModbusRegisterMap? modbusMap;
    try
    {
        if (string.IsNullOrWhiteSpace(modbusOptions.MapPath))
        {
            throw new InvalidOperationException(
                $"{St4i.EdgeCore.Drivers.Modbus.ModbusOptions.EnvVarMapPath} is not set.");
        }

        var mapJson = File.ReadAllText(modbusOptions.MapPath);
        // Task 9 — logWarning surfaces a tolerated (not fatal) readTimeoutMs/retries fallback the same
        // "visible even though nothing crashed" way the catch below already logs a fatal one.
        modbusMap = St4i.EdgeCore.Drivers.Modbus.ModbusRegisterMap.FromJson(mapJson, logWarning: msg =>
            Console.Error.WriteLine($"[startup] {msg}"));
        modbusMapJson = mapJson;
    }
    catch (Exception ex)
    {
        // No app.Logger yet this early (same reasoning as the UNS broker-bind catch above) — this is a
        // warning that must be visible even though the Modbus slot silently no-ops for this run.
        Console.Error.WriteLine(
            $"[startup] Modbus register map failed to load from '{modbusOptions.MapPath}' — Modbus driver disabled for this run: {ex.Message}");
        modbusMap = null;
    }

    if (modbusMap is not null)
    {
        var capturedMap = modbusMap;

        // P2-3 — the Modbus machine's roster descriptor, built from the SAME loaded register map (its
        // MachineCode + PollIntervalMs), so it gets a MachineState (fleet Snapshot tile + historian) and,
        // via P2-1's upsert-on-register, an Asset row — instead of being an invisible telemetry stream.
        modbusSeedDescriptor = new St4i.EdgeCore.Models.MachineDescriptor(
            Code: capturedMap.MachineCode,
            SerialSeed: $"SN-{capturedMap.MachineCode}",
            DeviceClass: St4i.Connector.Abstractions.Models.DeviceClass.Automation,
            MachineType: "MODBUS_TCP",
            StepType: null,
            DriverKind: St4i.Connector.Abstractions.Models.DriverKinds.Modbus,
            RecipeCode: null,
            MappingProfile: null,
            CycleSeconds: Math.Max(0.1, capturedMap.PollIntervalMs / 1000.0));
    }
}

// GĐ3 sub-3 OU-1 (docs/plans/2026-07-27-giaidoan3-opcua-driver-blueprint.md task 1) — the SECOND real
// field-protocol driver, mirroring the Modbus block immediately above (G2-6): an OPC-UA CLIENT poller run
// as its OWN isolated FleetHost pipeline slot (G2-5 fault isolation — an OPC-UA fault can never tear down
// the simulated fleet or the Modbus slot). Additive + env-gated OFF BY DEFAULT (ST4I_OPCUA_ENABLED
// unset/false — see OpcUaOptions' own doc comment): when disabled, nothing is registered into
// `connectorRegistry` below, so FleetHost's optional `connectorRegistry` ctor param has no "OpcUa" entry in
// it — byte-identical to today. A missing/malformed node map (ST4I_OPCUA_MAP) logs a warning and disables
// OPC-UA for this run rather than crashing startup — same posture as the Modbus/UNS blocks above.
//
// DI disambiguation, now historical (GP-4 update): Modbus's factory used to be registered as a bare
// `Func<IDeviceDriver>` singleton, and OPC-UA's factory was registered as the distinct concrete
// `OpcUaDriverFactory` type specifically so the two registrations could never collide. GP-4
// (.superpowers/sdd/2026-07-28-wsg-plugin-connector-seam-blueprint/task-4-brief.md) removed BOTH
// registrations: neither `ModbusDriverFactory`/`OpcUaDriverFactory` nor their new
// `ModbusConnectorFactory`/`OpcUaConnectorFactory` adapters are ever registered in DI at all anymore (see
// the single `ConnectorRegistry` singleton below, which constructs them directly with `new`) — the
// collision this workaround existed to avoid cannot occur even in principle now, since there is exactly
// one DI-registered type (`ConnectorRegistry`) for both connector kinds combined. See
// `OpcUaDriverFactory`'s own doc comment for the same history from that class's side.
//
// GĐ3 sub-3 OU-2 — P2-3 parity: `opcUaSeedDescriptor` is hoisted OUTSIDE the `if (opcUaOptions.Enabled)`
// block below (same reasoning as `modbusSeedDescriptor` above — `opcUaMap`/`capturedOpcUaMap` are scoped
// INSIDE it, while the roster-seed call, further down, well after `app.Build()`, needs to reach a
// descriptor built from that same map). Stays null (no-op) unless OPC-UA is enabled AND its node map
// actually loaded — additive + still default-off, same contract as before. Once seeded, this OPC-UA
// machine gets a fleet Snapshot tile/historian row/Asset row (via the roster-seed call below), not just an
// invisible telemetry stream.
St4i.EdgeCore.Models.MachineDescriptor? opcUaSeedDescriptor = null;
string? opcUaMapJson = null;

var opcUaOptions = St4i.EdgeCore.Drivers.OpcUa.OpcUaOptions.FromEnvironment();
if (opcUaOptions.Enabled)
{
    St4i.EdgeCore.Drivers.OpcUa.OpcUaNodeMap? opcUaMap;
    try
    {
        if (string.IsNullOrWhiteSpace(opcUaOptions.MapPath))
        {
            throw new InvalidOperationException(
                $"{St4i.EdgeCore.Drivers.OpcUa.OpcUaOptions.EnvVarMapPath} is not set.");
        }

        var mapJson = File.ReadAllText(opcUaOptions.MapPath);
        // 🔴 BI-1 (2026-08-23, docs/owner-decisions.md item 50 defect 3) — this call used to omit the sink
        // its Modbus twin thirty lines up has always passed, so a tolerated (non-fatal) pollIntervalMs
        // fallback on the OPC-UA map fell on the floor while the identical fallback on the Modbus map
        // printed a startup line. Same sink, same prefix, same reason: a value the operator declared and
        // the parser ignored must be visible even though nothing crashed.
        opcUaMap = St4i.EdgeCore.Drivers.OpcUa.OpcUaNodeMap.FromJson(mapJson, logWarning: msg =>
            Console.Error.WriteLine($"[startup] {msg}"));
        opcUaMapJson = mapJson;
    }
    catch (Exception ex)
    {
        // No app.Logger yet this early (same reasoning as the UNS/Modbus catches above) — this is a
        // warning that must be visible even though the OPC-UA slot silently no-ops for this run.
        Console.Error.WriteLine(
            $"[startup] OPC-UA node map failed to load from '{opcUaOptions.MapPath}' — OPC-UA driver disabled for this run: {ex.Message}");
        opcUaMap = null;
    }

    if (opcUaMap is not null)
    {
        var capturedOpcUaMap = opcUaMap;

        // GĐ3 sub-3 OU-2 — the OPC-UA machine's roster descriptor, built from the SAME loaded node map
        // (its MachineCode + PollIntervalMs), so it gets a MachineState (fleet Snapshot tile + historian)
        // and, via P2-1's upsert-on-register, an Asset row — instead of being an invisible telemetry
        // stream. Mirrors `modbusSeedDescriptor` above exactly.
        opcUaSeedDescriptor = new St4i.EdgeCore.Models.MachineDescriptor(
            Code: capturedOpcUaMap.MachineCode,
            SerialSeed: $"SN-{capturedOpcUaMap.MachineCode}",
            DeviceClass: St4i.Connector.Abstractions.Models.DeviceClass.Automation,
            MachineType: "OPC_UA",
            StepType: null,
            DriverKind: St4i.Connector.Abstractions.Models.DriverKinds.OpcUa,
            RecipeCode: null,
            MappingProfile: null,
            CycleSeconds: Math.Max(0.1, capturedOpcUaMap.PollIntervalMs / 1000.0));
    }
}

// GP-5 (.superpowers/sdd/2026-07-28-wsg-plugin-connector-seam-blueprint/task-5-brief.md item 2) —
// connectors.json: the config source that makes "configuring a connector is configuration, not a code
// change" actually true, alongside the four ST4I_MODBUS_*/ST4I_OPCUA_* env vars above (which keep working
// completely unchanged — see ConnectorsConfig's own doc comment for the full settings-representation
// write-up). Same shipping convention as fleet.json: a loose file next to the exe, hand-editable
// post-publish. Loaded here (hoisted, same "no app.Logger yet this early" reasoning as modbusMapJson/
// opcUaMapJson above) so a genuinely unparseable file logs a warning and falls back to "no connectors.json
// entries" (Console.Error, same posture as every other startup-time config failure above) rather than
// crashing startup — absent file ⇒ empty list ⇒ byte-identical to today, by construction.
var connectorsConfigPath = Path.Combine(AppContext.BaseDirectory, "connectors.json");
IReadOnlyList<St4i.EdgeCore.Config.ConnectorConfigEntry> connectorConfigEntries;
try
{
    connectorConfigEntries = St4i.EdgeCore.Config.ConnectorsConfig.Load(
        connectorsConfigPath,
        logWarning: msg => Console.Error.WriteLine($"[startup] {msg}"));
}
catch (St4i.EdgeCore.Config.ConnectorsConfigException ex)
{
    Console.Error.WriteLine(
        $"[startup] Malformed connectors.json at '{connectorsConfigPath}' — no connectors.json entries will be configured for this run: {ex.Message}");
    connectorConfigEntries = Array.Empty<St4i.EdgeCore.Config.ConnectorConfigEntry>();
}

// SM-5 (.superpowers/sdd/2026-07-29-dotA-single-machine-sellable-blueprint/task-5-brief.md) — the
// persisted-connector-configuration store: the write path connectors.json never had (POST /v1/connectors,
// see ConnectorEndpoints' own doc comment). Constructed as a LOCAL (not just inside AddSingleton) for the
// same reason `settingsStore`/`deviceIdentityStore` above are: this file needs to read its rows synchronously
// (LoadAllAsync, immediately below) BEFORE `app.Build()`, and the SAME instance must also be the one
// ConnectorEndpoints' handlers resolve via DI later — `builder.Services.AddSingleton(connectorConfigStore)`
// (the raw-instance overload) is exactly what makes that the same object, not a second store pointed at the
// same directory. Relocatable via ST4I_CONNECTOR_CONFIG_DIR, same ops/testability rationale as
// ST4I_ASSETS_DIR/ST4I_ALARMS_DIR above.
//
// 🔴 Task J-3 — NAMED, NOT CHANGED, and the SYMMETRIC SITE is the `NotificationConfigStore` construction
// earlier in this file.
// That one wraps its constructor, and the comment at that wrap says the posture is shared by "every other
// startup config load here". It is not: this constructor creates a directory and migrates a SQLite schema,
// unguarded, so a store that cannot be opened ends the process.
//
// 🔴 THIS IS AN §8.1(h4) SYMMETRY FINDING, NOT A YIELD OF THE STARTUP RULE — corrected here, because an
// earlier round presented it as the rule's yield and needed a second conjunct to get there. By the rule's
// actual test (would continuing hide the loss? — a store that never opened is an absence nothing announces)
// this site AGREES. The finding stands without the rule: a guarded structural twin, plus a completeness
// claim at that twin which this very line falsifies. Checkable by reading; independent of whether the rule
// is right. See docs/startup-failure-posture.md §3.2.
//
// The reason for the asymmetry is worth more than the asymmetry and is why this is not a one-line fix:
// NotificationEndpoints resolves its store with GetService and answers honestly when it is absent, while
// ConnectorEndpoints takes this one as a NON-NULLABLE handler parameter (7 such parameter sites in src/, 4
// of them route handlers), so minimal API's metadata requires the type to always be registered — there is no
// "absent" state for this store to fail into. Guarding it means building that state first. Recorded rather
// than attempted: it is an operator-observable startup change.
//
// A SECOND completeness claim of exactly this shape exists in this file and is named rather than rewritten:
// the roster-seed block below says "one bad source disables only itself" is the posture "every other startup
// config load in this file already has". Also false. Rewriting either would settle a rule this task is not
// authorised to settle.
var connectorConfigDir = Environment.GetEnvironmentVariable(St4i.EngineApi.Fleet.ConnectorConfigStore.EnvVarDir);
var connectorConfigStore = new St4i.EngineApi.Fleet.ConnectorConfigStore(
    string.IsNullOrWhiteSpace(connectorConfigDir) ? null : connectorConfigDir);
builder.Services.AddSingleton(connectorConfigStore);

// Loaded here (blocking, same "read a startup-only store synchronously before Build()" idiom
// `deviceIdentityStore.LoadOrCreate`/`unsBroker.StartAsync().GetAwaiter().GetResult()` already use above) so
// a genuinely corrupt store logs a warning and falls back to "no persisted connectors" — additive, never a
// startup crash — rather than a load failure ever preventing every OTHER config source (env vars,
// connectors.json) from working. Dispatched into the registry AND validated inside the ConnectorRegistry
// factory lambda below (same precedence-checking + Program.cs-owns-the-kind-dispatch shape connectors.json's
// own resolution already uses); the resulting seed descriptors are collected into this list so the
// roster-seed block after `app.Build()` can register each one, mirroring modbusSeedDescriptor/
// opcUaSeedDescriptor's own "computed inside a conditional, consumed after Build()" shape exactly.
IReadOnlyList<St4i.EngineApi.Fleet.ConnectorConfigRecord> persistedConnectorRows;
try
{
    persistedConnectorRows = connectorConfigStore.LoadAllAsync().GetAwaiter().GetResult();
}
catch (Exception ex)
{
    Console.Error.WriteLine(
        $"[startup] Failed to load persisted connector configuration — no operator-added connectors will be configured for this run: {ex.Message}");
    persistedConnectorRows = Array.Empty<St4i.EngineApi.Fleet.ConnectorConfigRecord>();
}

var persistedConnectorSeeds = new List<St4i.EdgeCore.Models.MachineDescriptor>();

// Task B-4 (.superpowers/sdd/2026-07-29-dotB-machine-control-blueprint/task-4-brief.md) — closes the carried
// B-3 finding (fix round 1, I2, hard deadline): ST4I_MODBUS_MAP/ST4I_OPCUA_MAP and connectors.json enforce a
// map's mandatory limits correctly (no safety bypass — same FromJson as everything else) but never touch
// ConnectorConfigStore, so GET /v1/connectors/configured showed NOTHING for them — invisible today because
// nothing wrote yet, a real false "nothing here" the moment this same build ships a real write (this task).
// See ConnectorConfigVisibilitySeeder's own doc comment for the exact contract (insert-only — never
// overwrites an operator's own persisted row; the one accepted residual gap). connectors.json's own
// resolution (env-var-wins, first-entry-per-kind-wins) is recomputed here, purely for this seeding pass —
// the REAL warning-worthy logging for that resolution already happens exactly once below, inside the
// ConnectorRegistry DI factory lambda, so `logWarning: null` here avoids a duplicate warning without losing
// any operator-visible signal.
{
    var alreadyConfiguredKindsForSeeding = new HashSet<string>(StringComparer.Ordinal);
    if (modbusMapJson is not null) alreadyConfiguredKindsForSeeding.Add(St4i.Connector.Abstractions.Models.DriverKinds.Modbus);
    if (opcUaMapJson is not null) alreadyConfiguredKindsForSeeding.Add(St4i.Connector.Abstractions.Models.DriverKinds.OpcUa);

    var resolvedConnectorEntriesForSeeding = St4i.EdgeCore.Config.ConnectorsConfig.ResolveEntries(
        connectorConfigEntries, alreadyConfiguredKindsForSeeding, logWarning: null,
        // 🔴 Task D-7a — the SAME registration-key rule the real resolution below uses. A recomputation that
        // resolved differently from the thing it is recomputing would seed visibility rows for a set of
        // connectors that never registers, which is precisely the "persisted, listed, and permanently never
        // running" state ConnectorEndpoints' own SM-5 comment says must never be creatable.
        registrationKeyOf: St4i.EngineApi.Config.ConnectorsJsonRegistration.RegistrationKeyOf);

    void SeedVisibility(string kind, string? seedHost, int? seedPort, string seedMapJson) =>
        St4i.EngineApi.Fleet.ConnectorConfigVisibilitySeeder.SeedAsync(
                connectorConfigStore, kind, seedHost, seedPort, seedMapJson, opcUaOptions.PkiDir,
                logWarning: msg => Console.Error.WriteLine($"[startup] {msg}"))
            .GetAwaiter().GetResult();

    if (modbusMapJson is not null)
    {
        SeedVisibility(St4i.Connector.Abstractions.Models.DriverKinds.Modbus, modbusOptions.Host, modbusOptions.Port, modbusMapJson);
    }

    if (opcUaMapJson is not null)
    {
        SeedVisibility(St4i.Connector.Abstractions.Models.DriverKinds.OpcUa, null, null, opcUaMapJson);
    }

    foreach (var entry in resolvedConnectorEntriesForSeeding)
    {
        // 🔴 Task D-7b — a Modbus RTU entry is a BUS, not a connector: it fans out into N registered
        // instances, and SeedVisibility above seeds exactly ONE row from ONE single-device map. D-7a skipped
        // this case explicitly, with the reason written at the skip, because seeding N rows was the UI half
        // of the feature; that placeholder is removed here. The bus is seeded through the arm that knows what
        // a bus is — N device rows in one transaction, keyed under the SAME id
        // ConnectorsJsonRegistration.RegistrationKeyOf registers this entry under, so the visibility rows and
        // the live registrations share one namespace by construction.
        if (St4i.EdgeCore.Drivers.Modbus.ModbusRtuBusSettings.DeclaresATransport(entry.SettingsJson))
        {
            St4i.EngineApi.Fleet.ConnectorConfigVisibilitySeeder.SeedBusAsync(
                    connectorConfigStore,
                    St4i.EngineApi.Config.ConnectorsJsonRegistration.RegistrationKeyOf(entry),
                    entry.SettingsJson,
                    logWarning: msg => Console.Error.WriteLine($"[startup] {msg}"))
                .GetAwaiter().GetResult();
            continue;
        }

        if (entry.Kind == St4i.Connector.Abstractions.Models.DriverKinds.Modbus)
        {
            SeedVisibility(entry.Kind, modbusOptions.Host, modbusOptions.Port, entry.SettingsJson);
        }
        else if (entry.Kind == St4i.Connector.Abstractions.Models.DriverKinds.OpcUa)
        {
            SeedVisibility(entry.Kind, null, null, entry.SettingsJson);
        }
        // Any other kind has no in-process factory/validator (same "no in-process constructor available"
        // gap the DI lambda below already warns about for the live-registration path) — nothing to seed.
    }
}

// GP-4 — the ONE DI singleton both connector kinds resolve through now, replacing the two separate
// registrations above (a bare `Func<IDeviceDriver>` for Modbus, `OpcUaDriverFactory` itself for OPC-UA).
// Lazily built (same "needs `ILoggerFactory` from `sp`, so it can't be a plain pre-`Build()` local" reason
// the old registrations were lambdas too) — populated with whichever of Modbus/OPC-UA actually finished
// loading their config above; either, both, or neither may be present, and `FleetCore.StartLocked` asks
// this registry fresh, on every call, for the current full set. `ConnectorRegistry` requires no ASP.NET
// Core service itself, so this factory only reaches into `sp` for the per-connector `ILogger`.
// 🔴 Task D-7a (.superpowers/sdd/2026-08-02-dotD-modbus-rtu-blueprint/task-7a-brief.md) — the ONE
// reference-counted Modbus bus registry for this process, and the first time anything in src/ has held one.
// It is what makes "N devices on one RS-485 line" physically work: the first driver on a bus key opens the
// link, every later one rides the SAME open and the SAME arbitration lock, and the last release closes it.
//
// Registered as a plain DI singleton rather than constructed inside the ConnectorRegistry lambda below for
// one reason that matters: it is IAsyncDisposable, and the host disposes its singletons on shutdown — so a
// gateway socket (and, if a future build ever references St4i.EdgeCore.Serial, a COM port) is closed on the
// way out instead of being left to the finalizer. Constructing it inside another factory's closure would
// have made it invisible to that disposal.
//
// Costs nothing when unused: the constructor allocates a dictionary and a lock, and NOTHING opens a link
// until a driver begins its first transaction. An install with no RTU connector configured pays for one
// empty object, which is why this is unconditional rather than gated on configuration that is read later.
builder.Services.AddSingleton<St4i.EdgeCore.Drivers.Modbus.ModbusBusRegistry>();

builder.Services.AddSingleton(sp =>
{
    // 🔴 E-2 — ConnectorRegistry moved to St4i.EdgeCore.Fleet (blueprint §9.1: FleetCore.StartLocked builds
    // one slot per registered instance from it and ResolveWritableDriver routes every write off its
    // bindings, so a lifecycle core that cannot see it is not a lifecycle core). Only this one fully
    // qualified name had to change; every other reference in this project resolves by simple name.
    var registry = new St4i.EdgeCore.Fleet.ConnectorRegistry();

    if (modbusMapJson is not null)
    {
        var logger = sp.GetRequiredService<ILoggerFactory>().CreateLogger("Modbus");
        // GP-4 fix round 1 (review) — Register now returns false (never throws) instead of crashing
        // GetRequiredService<FleetHost>() if a vendor-implemented Kind getter misbehaves; not reachable
        // for this built-in factory (Kind is a trivial constant return), but checked here anyway so a
        // future regression is visible rather than silently swallowed.
        //
        // Task D-1 (.superpowers/sdd/2026-08-02-dotD-modbus-rtu-blueprint/task-1-brief.md) — bound to the
        // machine code the loaded register map declares (modbusSeedDescriptor is built from that same map,
        // so this is the SAME code the roster seed uses; deriving it twice from two places is exactly the
        // drift Đợt B's review caught elsewhere). The instance id is left to default to the kind, which is
        // the id this env-var connector has always effectively had — an env-var deployment configures one
        // Modbus connector and gets the same slot label, alarm TargetId and DELETE URL it had before.
        if (!registry.Register(
            new St4i.EdgeCore.Drivers.Modbus.ModbusConnectorFactory(
                modbusOptions,
                logWarning: msg => logger.LogWarning("{ModbusMsg}", msg),
                logError: (ex, msg) => logger.LogError(ex, "{ModbusMsg}", msg)),
            modbusMapJson,
            machineCode: modbusSeedDescriptor?.Code))
        {
            logger.LogWarning(
                "Modbus connector factory failed to register (unexpected — its Kind getter threw or was blank, " +
                "or machine '{MachineCode}' is already claimed by another connector instance)",
                modbusSeedDescriptor?.Code);
        }
    }

    if (opcUaMapJson is not null)
    {
        var logger = sp.GetRequiredService<ILoggerFactory>().CreateLogger("OpcUa");
        // Task D-1 — see the Modbus registration above for the machine-binding rationale; identical here.
        if (!registry.Register(
            new St4i.EdgeCore.Drivers.OpcUa.OpcUaConnectorFactory(
                pkiDir: opcUaOptions.PkiDir,
                logWarning: msg => logger.LogWarning("{OpcUaMsg}", msg),
                logError: (ex, msg) => logger.LogError(ex, "{OpcUaMsg}", msg)),
            opcUaMapJson,
            machineCode: opcUaSeedDescriptor?.Code))
        {
            logger.LogWarning(
                "OPC-UA connector factory failed to register (unexpected — its Kind getter threw or was blank, " +
                "or machine '{MachineCode}' is already claimed by another connector instance)",
                opcUaSeedDescriptor?.Code);
        }
    }

    // GP-5 (task-5-brief.md item 2) — connectors.json wiring, layered on TOP of the two env-var
    // registrations just above: `alreadyConfiguredKinds` is exactly the set of kinds this run already
    // wired via env vars (`modbusMapJson`/`opcUaMapJson` non-null — i.e. the env var was enabled AND its
    // map actually loaded), so ConnectorsConfig.ResolveEntries can enforce "env var wins any conflict"
    // (see that method's own doc comment for why) BEFORE any connectors.json entry is dispatched.
    var connectorsLogger = sp.GetRequiredService<ILoggerFactory>().CreateLogger("Connectors");
    var alreadyConfiguredKinds = new HashSet<string>(StringComparer.Ordinal);
    if (modbusMapJson is not null) alreadyConfiguredKinds.Add(St4i.Connector.Abstractions.Models.DriverKinds.Modbus);
    if (opcUaMapJson is not null) alreadyConfiguredKinds.Add(St4i.Connector.Abstractions.Models.DriverKinds.OpcUa);

    var resolvedConnectorEntries = St4i.EdgeCore.Config.ConnectorsConfig.ResolveEntries(
        connectorConfigEntries,
        alreadyConfiguredKinds,
        logWarning: msg => connectorsLogger.LogWarning("{ConnectorsConfigMsg}", msg),
        // 🔴 Task D-7a — see ConnectorsJsonRegistration.RegistrationKeyOf. Without this, an RTU BUS (which
        // registers under its own instance id, not under "Modbus") would be suppressed by an unrelated
        // env-var-configured Modbus TCP connector, and a second RS-485 line in the same file would be called a
        // duplicate of the first.
        registrationKeyOf: St4i.EngineApi.Config.ConnectorsJsonRegistration.RegistrationKeyOf);

    // 🔴 D-1 review, I-3 — this ~40-line dispatch used to live inline here, inside this DI lambda, where no
    // test could reach it: connectors.json is read from AppContext.BaseDirectory, one shared artifact in the
    // test assembly's own output directory, so a test that wrote it would race the whole assembly. It had
    // never been covered, before or after D-1, and D-1 ADDED code to it — a mutation making every
    // connectors.json connector register UNBOUND left the entire suite green. Moved verbatim to
    // ConnectorsJsonRegistration (see that class' own doc comment for why extraction, and not a new
    // ST4I_CONNECTORS_CONFIG path override, is the right shape). All that remains uncovered here is the
    // Path.Combine + ConnectorsConfig.Load call above, which has no branching in it.
    St4i.EngineApi.Config.ConnectorsJsonRegistration.RegisterAll(
        resolvedConnectorEntries, modbusOptions, opcUaOptions, registry, connectorsLogger,
        // 🔴 Task D-7a — the ONE bus registry every RTU connector in this process shares. Resolved from `sp`
        // rather than captured, so the singleton the DI container owns (and disposes on shutdown) is the same
        // object every bus leases from: two registries would mean two opens of one gateway socket, which is
        // the exact failure ModbusBusRegistry exists to prevent.
        sp.GetRequiredService<St4i.EdgeCore.Drivers.Modbus.ModbusBusRegistry>());

    // SM-5 (task-5-brief.md) — the persisted-store layer (POST /v1/connectors), a THIRD config source
    // layered on top of the two above with the SAME "an established source always wins" precedence rule
    // ConnectorsConfig.ResolveEntries already applies between env vars and connectors.json — extended one
    // level further rather than inventing a second rule. `alreadyConfiguredKinds` now also includes every
    // kind connectors.json itself just accepted (resolvedConnectorEntries is already de-duplicated to at
    // most one entry per kind — ConnectorsConfig.ResolveEntries' own "first entry per kind wins" contract),
    // so a persisted row can ONLY ever fill a genuine gap — it can never shadow or silently reconfigure an
    // env-var- or connectors.json-configured kind. This is what keeps "existing env-var and hand-edited-
    // connectors.json deployments must keep working byte-identically" true even after this task.
    // 🔴 Task D-7a — the REGISTRATION KEY, not the kind. For every entry that existed before this task these
    // are the same string (both built-in arms register under the kind), so this is byte-identical for them.
    // For an RTU bus it is the bus's own instance id — which is what keeps a persisted Modbus TCP row from
    // being suppressed by an unrelated RS-485 line, and keeps a persisted row named after a bus device from
    // shadowing that device.
    alreadyConfiguredKinds.UnionWith(
        resolvedConnectorEntries.Select(St4i.EngineApi.Config.ConnectorsJsonRegistration.RegistrationKeyOf));

    // 🔴 Task D-7b — the persisted RS-485 buses, registered BEFORE the single-connector loop below and never
    // through it. A device row is not independently registerable: it carries its own single-device map and its
    // own line (see ConnectorConfigRecord.BusSettingsJson), but the ONE ModbusRtuConnectorFactory a bus needs
    // is built from a bus-wide number (the largest WorstCaseBusHoldMs on the line) and holds the one bus key
    // its N drivers share — so the unit of registration is the bus, not the row. Handing a device row to the
    // loop below would register it as a Modbus TCP connector against a host it does not have.
    var persistedBusGroups = persistedConnectorRows
        .Where(r => !string.IsNullOrWhiteSpace(r.BusInstanceId))
        .GroupBy(r => r.BusInstanceId!, StringComparer.Ordinal);

    foreach (var group in persistedBusGroups)
    {
        if (alreadyConfiguredKinds.Contains(St4i.Connector.Abstractions.Models.DriverKinds.Normalize(group.Key)))
        {
            // A connectors.json entry already registered this same bus id this run and wins, exactly as it
            // does for a single connector. Only an OPERATOR-owned bus is worth warning about — a Seeded one is
            // this run's own visibility artifact for the very entry that just won (Task B-6 fix round 1, I3).
            if (group.Any(r => r.Source == St4i.EngineApi.Fleet.ConnectorConfigSource.Operator))
            {
                connectorsLogger.LogWarning(
                    "Persisted Modbus RTU bus '{BusInstanceId}' ({DeviceCount} device(s)) ignored — a " +
                    "connectors.json entry already configures a connector under this same id for this run; that " +
                    "source takes precedence.", group.Key, group.Count());
            }
            continue;
        }

        var busRows = group.OrderBy(r => r.EffectiveInstanceId, StringComparer.Ordinal).ToList();

        // Every row of one bus was written by ONE SaveBusAsync transaction, so their bus documents are the
        // same string. Taking the first (by instance id, so the choice is deterministic rather than
        // dictionary-ordered) is therefore reading the bus's document, not picking between candidates.
        var busSettingsJson = busRows[0].BusSettingsJson;
        if (!St4i.EngineApi.Fleet.RtuBusConfiguration.TryResolve(
                group.Key, busSettingsJson,
                logWarning: msg => connectorsLogger.LogWarning("{ModbusRtuMsg}", msg),
                out var persistedBus, out var busError))
        {
            connectorsLogger.LogWarning(
                "Persisted Modbus RTU bus '{BusInstanceId}' failed to validate at startup and was skipped — no " +
                "device on that line runs this session: {Error}", group.Key, busError);
            continue;
        }

        var busRegistration = St4i.EngineApi.Fleet.RtuBusConfiguration.TryRegisterAll(
            persistedBus, sp.GetRequiredService<St4i.EdgeCore.Drivers.Modbus.ModbusBusRegistry>(),
            registry, connectorsLogger);
        if (!busRegistration.Succeeded)
        {
            connectorsLogger.LogWarning(
                "Persisted Modbus RTU bus '{BusInstanceId}' did not register and no device on that line runs " +
                "this session: {Refusal}", group.Key, busRegistration.Refusal);
            continue;
        }

        if (persistedBus.Plan.LimitNotice is not null)
        {
            connectorsLogger.LogWarning("Modbus RTU bus '{BusInstanceId}': {ModbusRtuSerialLimit}",
                group.Key, persistedBus.Plan.LimitNotice);
        }

        // 🔴 Task F-1 — the one-host-per-segment constraint, on the persisted-bus startup path too. A bus
        // saved through POST /v1/connectors is re-registered from the store on every subsequent boot and
        // never passes through the connectors.json path, so a notice emitted only there would be said once,
        // to whoever happened to be watching the console during the save, and never again.
        if (persistedBus.Plan.SegmentOwnershipNotice is not null)
        {
            connectorsLogger.LogWarning("Modbus RTU bus '{BusInstanceId}': {ModbusRtuSegmentOwnership}",
                group.Key, persistedBus.Plan.SegmentOwnershipNotice);
        }

        foreach (var device in persistedBus.Devices)
        {
            persistedConnectorSeeds.Add(St4i.EngineApi.Fleet.RtuBusConfiguration.DescriptorFor(device));
        }
    }

    foreach (var row in persistedConnectorRows)
    {
        // 🔴 Task D-7b — a bus DEVICE row was already handled, as part of its bus, above.
        if (!string.IsNullOrWhiteSpace(row.BusInstanceId)) continue;

        // Task D-1 — matched on the row's INSTANCE id, not its kind. `alreadyConfiguredKinds` is also
        // precisely the set of instance ids the two sources above registered under, because both of them
        // deliberately leave the instance id to default to the kind (see their own notes) — so for every row
        // that exists today, and every row a pre-D-1 build could have written, this comparison is
        // byte-identical to the kind comparison it replaces. What it stops doing is shadowing a genuinely
        // DIFFERENT connector instance that merely shares a protocol with an env-var-configured one: a
        // second Modbus connector, persisted under its own id, is no longer suppressed by ST4I_MODBUS_MAP
        // being set — which is the whole point of instance identity, and would otherwise have left the store
        // unable to express the multidrop shape it was just migrated to hold.
        if (alreadyConfiguredKinds.Contains(row.EffectiveInstanceId))
        {
            // Task B-6 fix round 1 (review, Important I3) — a row THIS RUN's own ConnectorConfigVisibilitySeeder
            // inserted (Source == Seeded) is, by construction, ALWAYS going to land in this branch: it exists
            // ONLY BECAUSE the very env-var/connectors.json source that "wins" here is active. Warning about it
            // is pure self-referential noise repeating on every single boot — the exact carried B-4 symptom
            // ("startup log a warning about the seeder's own row every boot") this task was assigned to close.
            // An OPERATOR row genuinely being shadowed here is still worth the warning below, unchanged.
            if (row.Source == St4i.EngineApi.Fleet.ConnectorConfigSource.Operator)
            {
                connectorsLogger.LogWarning(
                    "Persisted connector configuration '{ConnectorInstanceId}' (kind '{ConnectorKind}', machine " +
                    "'{MachineCode}') ignored — an environment variable or a connectors.json entry already " +
                    "configures a connector under this same id for this run; that source takes precedence.",
                    row.EffectiveInstanceId, row.Kind, row.MachineCode);
            }
            continue;
        }

        // Re-validated at startup exactly like a fresh POST would be (same ConnectorConfigValidation call) —
        // a row that was valid when saved but can no longer be parsed (e.g. this build's driver contract
        // changed) is skipped with a warning, never a startup crash, mirroring every other "a bad config
        // source disables itself for this run" posture in this file.
        if (!St4i.EngineApi.Fleet.ConnectorConfigValidation.TryValidate(
                row.Kind, row.Host, row.Port, row.MapJson, opcUaOptions.PkiDir, out var validated, out var validationError))
        {
            connectorsLogger.LogWarning(
                "Persisted connector configuration for kind '{ConnectorKind}' (machine '{MachineCode}') failed " +
                "to validate at startup and was skipped: {Error}",
                row.Kind, row.MachineCode, validationError);
            continue;
        }

        // Task D-1 — registered under the row's OWN instance id (its primary key) and bound to the machine
        // its map declares. A refusal here is now a MEANINGFUL outcome, not just "unexpected": it is how a
        // second connector claiming a machine another one already serves is stopped from ever going live,
        // and the descriptor is deliberately NOT added to persistedConnectorSeeds in that case — seeding a
        // roster tile for a connector that is not running is exactly the false "this machine is configured"
        // signal Đợt A/B spent two batches removing.
        if (!registry.Register(validated.Factory, row.MapJson, row.EffectiveInstanceId, validated.MachineCode))
        {
            connectorsLogger.LogWarning(
                "Persisted connector configuration '{ConnectorInstanceId}' (kind '{ConnectorKind}') failed to " +
                "register — machine '{MachineCode}' is already served by connector '{ClaimingInstanceId}'. This " +
                "connector will not run this session; remove one of the two configurations so a write for that " +
                "machine can resolve to a single device.",
                row.EffectiveInstanceId, row.Kind, validated.MachineCode,
                registry.TryGetInstanceIdForMachine(validated.MachineCode, out var claimant) ? claimant : "(unknown)");
            continue;
        }

        persistedConnectorSeeds.Add(validated.Descriptor);
    }

    return registry;
});

// SM-5 — the OpcUaOptions instance every ConnectorEndpoints handler needs (for its PkiDir — see
// ConnectorConfigValidation's own doc comment on why OPC-UA's endpoint/credentials live inside the
// node-map JSON while Modbus's host/port do not). The SAME instance the ConnectorRegistry factory lambda
// above already closes over — registering it here just makes it DI-resolvable too.
builder.Services.AddSingleton(opcUaOptions);

// Task 9 (WS-A) — per-machine OEE settings (ideal-cycle override + planned-production ratio), a plain
// JSON-file-backed store (WS-A-T5) that was never wired into DI until now. Pointed at the SAME resolved
// ST4I_HISTORIAN_DIR (or SqliteHistorianStore's own default when unset) so every historian-adjacent file
// lives in one place. Tests construct their own instance pointed at a temp directory instead of resolving
// this registration.
//
// 🔴 TASK V-1 — the logError callback is new, and it is the channel an unreadable `oee-settings.json` is
// named on at Error. Same shape as the HistorianWriter registration above. This store is resolved LAZILY
// (nothing constructs it before the host serves), so that line lands on the first request that touches OEE,
// not at boot — which is why it is not a row in docs/startup-failure-posture.md's startup set and why the
// PUT's own 409 is the surface that matters most: it reaches the person who would otherwise have destroyed
// the file, at the moment they would have destroyed it.
builder.Services.AddSingleton(sp =>
{
    var logger = sp.GetRequiredService<ILoggerFactory>().CreateLogger("Historian");
    return new St4i.EdgeCore.Historian.OeeSettingsStore(
        string.IsNullOrWhiteSpace(historianDir) ? null : historianDir,
        (ex, message) => logger.LogError(ex, "{OeeSettingsMsg}", message));
});

// FF-1 (docs/plans/2026-07-27-ws-ff-fast-follows.md) — atomic-JSON-backed persistence for FleetHost's
// serverUrl/machineCode/verifyTls (see FleetSettingsStore's own doc comment for the full precedence
// this enables against the WS-F1 env vars read just below). A SEPARATE directory/file from every store
// above — never mixed with historian.db/oee-settings.json (a different concern) or CredentialStore's
// creds/ (this file only ever holds non-secret fields, but keeps that invariant obvious on disk too).
// Relocatable via ST4I_SETTINGS_DIR (FleetSettingsStore.EnvVarDir), same ops/testability rationale as
// ST4I_HISTORIAN_DIR above. Constructed as a local (not just `_ => new ...` inside AddSingleton) because
// the startup wiring further down needs to call Load() on this SAME instance BEFORE the first
// FleetHost.UpdateSettings call, to decide the persisted-file-vs-env-var precedence.
var settingsStore = new St4i.EdgeCore.Config.FleetSettingsStore();
builder.Services.AddSingleton(settingsStore);

// WS-F1 final-review fix F1 — a headless Windows Service install has no interactive Settings UI to
// type a real serverUrl/machineCode into, and FleetHost's `_serverUrl`/`_machineCode`/`_verifyTls`
// fields (see FleetHost.cs:142-145's DefaultServerUrl/DefaultMachineCode/`true`) are plain in-memory
// fields that reset to those placeholder defaults on EVERY process start — so before this fix, a
// headless Live deployment silently fell back to http://localhost:5000/ENGINE-API-01 on every restart
// no matter what an operator PUT into `/v1/settings` at runtime (README §15.2/§15.8(a) claimed these
// three env vars already covered this, but St4i.EngineApi read none of them — only St4i.EdgeService's
// EdgeWorker did). Resolved here the SAME way ST4I_HISTORIAN_DIR is above (a plain
// `Environment.GetEnvironmentVariable` read, no `IConfiguration` seam) and applied further down, once
// FleetHost itself exists, via `FleetHost.UpdateSettings` — the exact same mechanism a runtime
// `PUT /v1/settings` already uses, so the values chosen here take effect (rebuilding the Live
// transport/config-sync backends) exactly like an operator's own settings edit would. Never logged —
// none of these three are secrets, but there's no reason to echo config back into a log sink either.
// FF-1 update — these three env vars are now only a FLOOR: settingsStore.Load() (right before the
// FleetHost.UpdateSettings call further down) takes priority whenever fleet-settings.json already
// exists, so a real operator PUT (or even this very env-seeded boot, on the NEXT restart) is what
// actually wins from then on. See FleetSettingsStore's own doc comment for the full precedence writeup.
var initialLiveServerUrl = Environment.GetEnvironmentVariable("ST4I_SERVER_URL");
var initialLiveMachineCode = Environment.GetEnvironmentVariable("ST4I_MACHINE_CODE");
var initialLiveVerifyTlsRaw = Environment.GetEnvironmentVariable("ST4I_VERIFY_TLS");

// H4 job 1 fix — WebApplicationBuilder's default WebRootPath is `{ContentRootPath}/wwwroot`, and
// ContentRootPath defaults to the CURRENT WORKING DIRECTORY, which under `dotnet run` is the PROJECT
// SOURCE directory (confirmed via the "Content root path:" startup log line) — NOT the build output
// directory the St4i.EngineApi.csproj Content/None items above actually copy `wwwroot/` into. That
// mismatch is exactly why the seeded products' `assets/products/model-a-board.png` etc. 404'd under
// `npm run dev` + `dotnet run` even after being added to the csproj: the files were sitting in
// `bin/<config>/<tfm>/wwwroot/`, a directory this host was never looking in. Repointing WebRootPath at
// `AppContext.BaseDirectory` (always the directory containing the loaded assembly — bin output for
// `dotnet run`, the publish directory for the published single-file build; SAME convention FleetHost
// already uses for fleet.json/mapping/*.json, see its own AppContext.BaseDirectory doc comment) makes
// both modes resolve the SAME physical wwwroot the build actually populates. Setting the STRING alone
// is not enough — `WebApplication.CreateBuilder` already constructed `WebRootFileProvider` from the
// default path before this line runs, and `UseStaticFiles`/`UseDefaultFiles` read that file provider,
// not the path string, so it has to be rebuilt against the corrected path too (verified live: without
// this second line, Kestrel logs "The WebRootPath was not found" for the CORRECT path and 404s anyway).
var webRootPath = Path.Combine(AppContext.BaseDirectory, "wwwroot");
Directory.CreateDirectory(webRootPath); // PhysicalFileProvider throws if the root doesn't exist yet (a
                                         // truly fresh build output before any Content items have run).
builder.Environment.WebRootPath = webRootPath;
builder.Environment.WebRootFileProvider = new PhysicalFileProvider(webRootPath);

var app = builder.Build();

// Task 9 — serve the built web UI (`web/dist`, copied into `wwwroot/` at build time — see the
// St4i.EngineApi.csproj Content item) from this SAME host as the API/WebSocket, so a single process +
// single port is the whole standalone offline app (no separate static file server, no CORS needed for
// same-origin requests). `UseDefaultFiles` resolves `/` → `index.html`; `UseStaticFiles` serves the
// hashed JS/CSS/asset files vite emitted; `MapFallbackToFile` (registered after the API endpoints below,
// lowest routing priority) sends any other GET that doesn't match an API route or a real static file to
// `index.html` too, so the SPA's client-side router (wouter) handles deep links / refreshes on routes
// like `/machines/aoi-01` instead of 404ing. In dev, `wwwroot/index.html` itself still won't exist
// unless `npm run build` has already run once (Vite serves the UI on :5173 instead, per Task 3/9's
// dev-mode split) — but `wwwroot/assets/products/*.png` (the WebRootPath fix above) is copied
// unconditionally, so the reference board images resolve from THIS engine (:5199, where
// `resolveProductImageUrl` points in dev too) even on a bare `dotnet run` with no prior web build.
app.UseDefaultFiles();
app.UseStaticFiles();

app.UseCors(CorsPolicy);

// WS-D-D1 — UseAuthentication (reads/validates the cookie into HttpContext.User) then the demo
// auto-login middleware (signs in a real demo-admin for THIS request when DemoModeGate is enabled and
// nothing is authenticated yet — a no-op otherwise) then UseAuthorization (enforces the default-deny
// FallbackPolicy above). Must run after routing is available and BEFORE UseWebSockets/the endpoint maps
// below, so both the WS upgrade and every mapped route are actually covered by it.
app.UseAuthentication();
app.UseDemoAutoLogin();
app.UseAuthorization();

app.UseWebSockets();

app.MapAuthEndpoints();
app.MapFleetEndpoints();
// G2-4 — XC-R40: the read-only safety status surface (GET /v1/safety). No write route exists here —
// see SafetyEndpoints' own doc comment.
app.MapSafetyEndpoints();
app.MapModeEndpoints();
app.MapCapabilitiesEndpoints();
app.MapScenarioEndpoints();
app.MapSettingsEndpoints();
app.MapOnboardingEndpoints();
app.MapConfigEndpoints();
app.MapMachineSettingsEndpoints();
app.MapHistorianEndpoints();
app.MapAuditEndpoints();
app.MapUserEndpoints();
app.MapAssetEndpoints();
// WS-HMI-0b Task 1 — the component-tree HTTP surface over WS-HMI-0a's IComponentModelStore/
// ITagNamespaceStore (both registered above, WS-HMI-0a Task 5). Same "store-backed resource, Operator
// reads / Engineer writes" shape as MapAssetEndpoints directly above.
app.MapHmiModelEndpoints();
// WS-HMI-0b Task 2 — the tag-namespace HTTP surface over the same ITagNamespaceStore seam (GET /v1/tags,
// GET /v1/tags/by-path/{**path}, PUT /v1/tags/{machineCode}). Registered next to MapHmiModelEndpoints
// because the two share the seam and the Operator-reads/Engineer-writes tier; see HmiTagEndpoints.cs for
// why its two read routes answer "I don't have that" differently (§5-bis empty vs 404).
app.MapHmiTagEndpoints();
// GP-5 (task-5-brief.md item 3) — GET /v1/connectors: visibility for a configured-but-not-started connector.
app.MapConnectorEndpoints();
app.MapMachineWriteEndpoints();
// GĐ3 sub-4 LC-1 — the alarm HTTP surface (GET /v1/alarms(+/history), POST /v1/alarms/{id}/ack).
app.MapAlarmEndpoints();
// 🔴 Task C-5 — GET /v1/alarms/annunciations: the SSE stream C-5's local-annunciation channel publishes
// onto, and the only way an alarm reaches an open page in less time than the 4s alarm-table poll (and at
// all, rather than a minute late, in a background tab a browser has throttled). Mapped unconditionally —
// with nothing configured it opens, says so in its `ready` frame and stays quiet.
app.MapAlarmAnnunciationStream();
// 🔴 Task C-7 — the notification CONFIGURATION surface: eleven routes that finally let the four channels
// C-3..C-6 built be configured without hand-editing a SQLite file, plus the stats those channels have been
// producing for nobody. Mapped unconditionally — the store may be unavailable, and a route that answers
// "the configuration store could not be opened" is worth strictly more than one that is not there.
//
// 🔴🔴 PUT/DELETE /v1/notifications/relay are ADMIN and every other route here is not: saving a relay row
// with TargetKind = Command makes this engine perform an Admin-tier machine command automatically, for as
// long as the row exists. See NotificationEndpoints' doc comment and MachineWriteGate.RoleFor.
app.MapNotificationEndpoints();
// GĐ3 sub-4 LC-3 — the LineController HTTP surface (GET /v1/line, POST /v1/line/{command}).
app.MapLineEndpoints();
// GĐ3 EC-3 — the Site-link status/config + device-identity HTTP surface over EC-2's SiteBridgeManager.
app.MapSiteEndpoints();
app.MapInspectorStream();
// AT-1, owner item 27 — the separate lane for request bodies. Registered next to the stream because it is
// the same pane's data under the same Engineer policy, and kept a distinct route because the ruling froze
// the stream's frame shape.
app.MapInspectorBodies();

// WS-D-D1 — ENDPOINT, so it inherits the FallbackPolicy above like every other mapped route; without
// AllowAnonymous the SPA shell (index.html) itself would 401 while logged out, and a logged-out user
// could never even reach a login screen. AllowAnonymous is safe here specifically because this only ever
// serves the static shell, not any API data — the SPA's own API calls still hit the auth-gated /v1/*
// routes above.
app.MapFallbackToFile("index.html").AllowAnonymous();

// Force-touch FleetHost now (rather than lazily on the first request) so its fleet.json/default-roster
// resolution — and any FleetConfigException it might swallow — happens at startup, where a log line is
// actually useful, not silently on whichever request happens to hit it first.
//
// 🔴 Task J-3 — NAMED, NOT CHANGED: this ONE statement is also where TWO operator-editable catalogues end
// the process, and they are the divergences an earlier round of this analysis absorbed into a count.
// ProductConfigStore and SimulatedEcosystem are both FleetHost constructor parameters, so both are built
// here; both do Directory.CreateDirectory(...) then Load(), and Load() deserializes JSON from beside the
// binary with NO catch of any kind. A malformed products.json — hand-editable, beside the exe, with no
// schema published to whoever edits it — ends the process. (Both also Save() on first run when a file is
// absent, so a read-only install directory is a second fatal arm.)
//
// THE SYMMETRIC SITES ARE TWO MEMBERS THAT ARE TOLERATED: connectors.json (guarded above) and fleet.json
// (guarded via FleetConfigException, with a per-entry skip added precisely so "one operator typo destroys
// the whole fleet" stopped being true). All four are operator-editable JSON beside the binary; two are
// tolerated, two are fatal. By the rule at wal.EnsureDir above these two should come up — nothing claims a
// product catalogue is loaded that is not. Recorded, not changed: operator-observable startup change. See
// docs/startup-failure-posture.md §3.5.
var fleetHost = app.Services.GetRequiredService<FleetHost>();

// Fix round 1 (SM-5 review) — RegisterMachine returning false used to be discarded silently at every one
// of the three call sites below: "benign" is true for the ordinary idempotent-restart case (this exact
// descriptor was already registered earlier in THIS SAME startup, which cannot actually happen today since
// each of the three seed sources below runs exactly once) but FALSE for a genuine machine-code collision
// (this code already belongs to a DIFFERENT roster member — the demo fleet, another env-var/connectors.json/
// persisted-store connector) — that case is silent, permanent data loss (the descriptor is discarded and
// NEVER retried), exactly the failure mode the review found reachable via a cross-kind machineCode reuse
// that POST /v1/connectors now rejects at save time (see ConnectorEndpoints.CreateConnectorAsync's own
// remarks) — but connectors.json/env vars are hand-edited outside that endpoint entirely, so this
// startup-time trace is the only backstop for a collision introduced that way. Logged, never thrown — a
// bad seed must still leave every OTHER seed source (and the demo/product roster itself) completely
// unaffected, same "one bad source disables only itself" posture every other startup config load in this
// file already has.
static void LogIfRegisterMachineCollided(ILogger logger, FleetHost host, St4i.EdgeCore.Models.MachineDescriptor descriptor, bool added, string sourceLabel)
{
    if (added) return;

    var conflict = host.Fleet.FirstOrDefault(d => string.Equals(d.Code, descriptor.Code, StringComparison.OrdinalIgnoreCase));
    logger.LogWarning(
        "{Source} machine code '{Code}' was NOT added to the fleet roster — a machine with this exact code " +
        "already exists in the roster (driver kind '{ConflictingKind}'). Machine codes must be unique across " +
        "the whole fleet; this connector will never appear in the roster (not now, and not after any restart) " +
        "until the code collision is resolved.",
        sourceLabel, descriptor.Code, conflict?.DriverKind ?? "unknown");
}

// P2-3 — register the configured Modbus machine as a first-class roster member so it gets a MachineState
// (fleet Snapshot tile + historian) and, via the asset registry, an Asset row. StartLocked excludes
// DriverKinds.Modbus from simulation, so this machine is driven ONLY by the real Modbus pipeline slot,
// never double-driven.
if (modbusSeedDescriptor is not null)
{
    LogIfRegisterMachineCollided(app.Logger, fleetHost, modbusSeedDescriptor, fleetHost.RegisterMachine(modbusSeedDescriptor), "ST4I_MODBUS_* env-var-configured");
}

// GĐ3 sub-3 OU-2 — register the configured OPC-UA machine as a first-class roster member, mirroring the
// Modbus P2-3 seed immediately above: it gets a MachineState (fleet Snapshot tile + historian) and, via
// the asset registry, an Asset row. StartLocked excludes DriverKinds.OpcUa from simulation, so this
// machine is driven ONLY by the real OPC-UA pipeline slot, never double-driven.
if (opcUaSeedDescriptor is not null)
{
    LogIfRegisterMachineCollided(app.Logger, fleetHost, opcUaSeedDescriptor, fleetHost.RegisterMachine(opcUaSeedDescriptor), "ST4I_OPCUA_* env-var-configured");
}

// SM-5 (task-5-brief.md) — register every ACCEPTED persisted connector configuration (POST /v1/connectors,
// stored via ConnectorConfigStore) as a first-class roster member, mirroring the Modbus/OPC-UA env-var seeds
// immediately above exactly: MachineState (fleet Snapshot tile + historian) and, via the asset registry, an
// Asset row classified real (DriverKind is Modbus/OpcUa, never Simulated — see ConnectorConfigValidation).
// Each descriptor here was already validated + registered into the SAME ConnectorRegistry singleton above
// (see that factory lambda's own persisted-store loop) — this is just the roster-seed half of that same
// source. `POST /v1/connectors` itself now rejects a cross-kind machine-code collision at save time (fix
// round 1), so this SHOULD be unreachable for anything saved through the API from now on — but a persisted
// row saved before that fix existed, or one that now collides with a code freshly introduced via a hand-
// edited connectors.json/env var on THIS restart, is still possible, hence the same logged trace here.
foreach (var persistedSeed in persistedConnectorSeeds)
{
    LogIfRegisterMachineCollided(app.Logger, fleetHost, persistedSeed, fleetHost.RegisterMachine(persistedSeed), "Persisted (ConnectorConfigStore)");
}

// WS-F1 final-review fix F1 — apply the env-resolved (see the ST4I_SERVER_URL/ST4I_MACHINE_CODE/
// ST4I_VERIFY_TLS reads above) settings as this instance's INITIAL Live config, now that FleetHost
// exists to apply them to. `SettingsUpdateRequest`'s nullable fields mean an absent/blank env var
// leaves the corresponding field at FleetHost's own built-in default (DefaultServerUrl/
// DefaultMachineCode/verifyTls=true) — ST4I_VERIFY_TLS parses the same "false"/"0" (case-insensitive)
// opt-out idiom EdgeWorker's own ParseVerifyTls already uses, `null` (unset) meaning "don't touch it".
// `UpdateSettings` itself is a no-op (no transport rebuild, no CredentialStore disk read) whenever
// every field ends up null — i.e. byte-identical startup behavior for the common case where none of
// these three env vars are set at all (the desktop/exhibition launch path).
bool? initialLiveVerifyTls = null;
if (!string.IsNullOrWhiteSpace(initialLiveVerifyTlsRaw))
{
    var trimmed = initialLiveVerifyTlsRaw.Trim();
    initialLiveVerifyTls = !(trimmed == "0" || string.Equals(trimmed, "false", StringComparison.OrdinalIgnoreCase));
}

// FF-1 (docs/plans/2026-07-27-ws-ff-fast-follows.md) — a persisted fleet-settings.json, if one already
// exists, is the source of truth for serverUrl/machineCode/verifyTls and wins over the env vars above
// outright (they're only ever the FLOOR for a machine that has never had these three set before). Either
// branch below goes through this exact same FleetHost.UpdateSettings call, so the transport/config-sync
// rebuild + (new) persistence-on-change both happen identically regardless of which source won.
//
// 🔴 TASK Q-1 — THIS READ HAS THREE OUTCOMES NOW, AND THE THIRD ONE IS WHY THE TASK EXISTED.
//
// WHAT WAS HERE, AND WHAT IT COST. `settingsStore.Load()` answered a triple or null, and null covered two
// situations: no file on disk, and a file on disk this process could not turn into a triple. The branch
// below reads null as the first one, so the second one selected the SEED arm — the environment floor,
// applied through FleetHost.UpdateSettings, which persists in a `finally`. On an ordinary SUCCESSFUL start,
// with no failure anywhere and no log line of any kind, fleet-settings.json was rewritten with the floor
// merged with FleetHost's built-in defaults and the operator's content was gone. Measured both ways: with
// none of ST4I_SERVER_URL/ST4I_MACHINE_CODE/ST4I_VERIFY_TLS set nothing is written and the file survives;
// with any ONE of them set it is overwritten. Those three variables exist for the headless service install
// (WS-F1 fix F1, above) — the deployment with no UI to retype the triple into.
//
// THE RULE, and it is about the read rather than about this file: a store's slot on disk being EMPTY is
// what entitles a caller to establish a value of its own. A read that FAILED says nothing about the slot
// except that something is in it, and whatever is in it is the last surviving record of what somebody
// configured. So "could not read" is its own outcome, it is never the empty case, and nothing writes on it.
//
// WHICH SIDE OF THE J-3 RULE THIS FALLS ON — the same side as the replay guard below, POSTURE B, and the
// test is the one in docs/startup-failure-posture.md §1: would continuing HIDE the loss? It does not. The
// Error line below names the file and says it was not applied; GET /v1/settings goes on truthfully
// reporting the triple this process actually holds; and nothing left running claims the persisted triple
// was applied or the Live transport rebuilt from it. Stopping would additionally remove PUT /v1/settings,
// the only in-product correction, from a machine whose sole fault is a text file it is perfectly able to
// ignore. The unguarded `wal.EnsureDir()` near the top of this file fails that same test the other way and
// stops; both arms choose the louder failure. Row 36 of that file's set moves S -> U and its ✗ becomes ✓.
//
// WHAT THIS ARM DELIBERATELY DOES NOT DO: it does not apply the environment floor in memory either. FF-1's
// precedence says the file wins whenever there is one, and there IS one — this process simply cannot read
// it. Applying the floor would put a triple in front of the operator that they never set, on a machine that
// has a configuration, and GET /v1/settings would report it as though it were theirs.
//
// The three deletions tabulated in docs/startup-failure-posture.md §3.1a are answered by the same change
// rather than by a second guard: every one of them is gated on reaching the seed arm, and the seed arm is
// now selected only on Absent — an outcome a present file cannot produce, because the read is an open
// attempt and not an existence probe.
//
// THE VECTORS, KEPT BECAUSE THEY ARE WHY ONE OUTCOME COVERS A POPULATION WHOSE CAUSES DIFFER. Task M-1 ran
// tools/settings-acl-probe (committed, re-runnable) against the store that used to sit behind this line, and
// what it found is that "unreadable" was never one state: a deny-share lock (FileShare.None reaches the
// read; FileShare.Read does not), a Windows ACL withholding read rights on the FILE, and an ACL reaching
// BOTH the directory and the file each produced a DIFFERENT pair of answers out of the store's two surfaces.
// The last one is the one that mattered: File.Exists answered FALSE with the operator's file present, so the
// seed arm was selected — not by tolerating a failure, but by asking a second surface a question the read
// itself could answer. The full table is in docs/startup-failure-posture.md §3.1a.
// Q-1's read does not consult a second surface at all, so those three vectors and a malformed file now reach
// one outcome by construction rather than by an enumeration somebody has to keep complete.
//
// TWO MEASUREMENTS FROM M-1 THAT ARE STILL LIVE AND ARE NOT ABOUT THIS LINE: none of the six read-denying
// shapes fails the `new FleetSettingsStore()` construction above — Directory.CreateDirectory succeeded on an
// existing but unreadable directory in every one — while that constructor DOES throw on a WRITE denial with
// the root absent, which is a different arm (row 27) and is untouched here.
var settingsRead = settingsStore.Read();
var persistedSettings = settingsRead.Settings;
var initialSettingsRequest = persistedSettings is not null
    ? new SettingsUpdateRequest(
        ServerUrl: persistedSettings.ServerUrl,
        VerifyTls: persistedSettings.VerifyTls,
        Language: null,
        MachineCode: persistedSettings.MachineCode)
    : new SettingsUpdateRequest(
        ServerUrl: string.IsNullOrWhiteSpace(initialLiveServerUrl) ? null : initialLiveServerUrl,
        VerifyTls: initialLiveVerifyTls,
        Language: null,
        MachineCode: string.IsNullOrWhiteSpace(initialLiveMachineCode) ? null : initialLiveMachineCode);

// 🔴 TASK AJ-1 — WHETHER THERE IS AN ENVIRONMENT FLOOR AT ALL, AND IT SELECTS BETWEEN THE TWO SENTENCES
// BELOW. It is `FleetCore.UpdateSettings`' own `rebuildNeeded` evaluated one statement early: that method
// commits — and therefore persists — only when at least one of the three fields is non-null. On the
// Unreadable arm `persistedSettings` is null, so this triple IS the `ST4I_*` floor, and this predicate is
// exactly "is there a floor to apply". `Language` is excluded for the same reason `UpdateSettings` excludes
// it: it does not set `rebuildNeeded`, so it neither applies nor persists anything. It is DERIVED from the
// request rather than re-read from the environment, so it cannot drift from what is actually replayed.
var envFloorHasAValue = initialSettingsRequest.ServerUrl is not null
                     || initialSettingsRequest.MachineCode is not null
                     || initialSettingsRequest.VerifyTls is not null;

// 🔴 TASK Q-1 — THE THIRD ARM, AND 🔴 TASK AJ-1 CHANGED WHAT IT DOES ON THE OWNER'S DECISION OF 2026-08-19
// (item 9 of docs/owner-decisions.md, option (b): APPLY THE FLOOR AND PERSIST IT). Q-1 applied nothing,
// wrote nothing and deleted nothing here; the owner weighed that against a headless install coming up on
// `DefaultServerUrl = ""` while its service definition supplied a triple, and decided the floor wins.
//
// WHO HAS TO SEE THIS, answered rather than assumed. The deployment this defect destroys data on is the
// headless Windows-Service install — the one with no UI. `LogError` is the channel that reaches it: this
// product ships no appsettings.json (§10.4), so the framework's own default minimum applies, and under
// AddWindowsService this level is a Windows Event Log entry an operator on shift can find. It is the same
// channel and the same level the replay guard below already uses, for the same stated reason.
// NOT ALSO PUT ON GET /v1/settings, and the reason is a boundary rather than an oversight: that response is
// a published shape the browser client and third-party callers read, and widening it is the class of change
// the owner reserved to himself in decisions 3 and 4. What that endpoint already does is the half that
// matters — it reports the triple THIS PROCESS HOLDS, truthfully, and never claims the persisted one was
// applied. A field naming this condition on the operating surface is worth having and is somebody's
// decision, not this task's.
//
// 🔴 THE MESSAGE'S SCOPE, BECAUSE A DATA-PRESERVATION CLAIM HAS TO CARRY ONE — AND IT NOW HAS TO CARRY THE
// OPPOSITE CLAIM, WHICH IS WHY THERE ARE TWO SENTENCES AND NOT ONE. Until AJ-1 this said the file "was NOT
// overwritten or deleted by this start", which was exactly what the skipped replay guaranteed. Under (b)
// that sentence is FALSE on the arm it was written for, and a preservation promise that has gone false is
// the worst shape a log line can take. It cannot be repaired by softening: the two cases genuinely differ.
//   * NO floor set — `rebuildNeeded` is false, so `UpdateSettings` skips the whole `if`, so the `finally`
//     that persists is never reached: nothing is applied and nothing is written, exactly as before.
//   * A floor IS set — it is applied and the `finally` writes it OVER these bytes. The message says so in
//     the future tense on purpose: this line is emitted before the replay runs, and the one thing that can
//     still stop the write is the write itself failing, which emits its own STARTUP SETTINGS REPLAY FAILED
//     line carrying the exception. Claiming a completed outcome here would be claiming a thing still in
//     motion.
// Neither sentence says anything about later: a PUT /v1/settings will overwrite the file, and that is the
// remedy rather than a loss.
if (settingsRead.Status == FleetSettingsReadStatus.Unreadable && envFloorHasAValue)
{
    app.Logger.LogError(
        settingsRead.Failure,
        "STARTUP SETTINGS FILE COULD NOT BE READ — \"{SettingsFile}\" is present and this start could not " +
        "turn it into settings ({Reason}). ITS CONTENT IS BEING OVERWRITTEN BY THIS START, on the owner's " +
        "decision of 2026-08-19 (item 9 of docs/owner-decisions.md): the ST4I_SERVER_URL/" +
        "ST4I_MACHINE_CODE/ST4I_VERIFY_TLS environment floor is applied instead and then persisted over " +
        "this file, so the unreadable bytes stop being the record of what was configured here. If those " +
        "bytes matter they must come from a backup — this start does not keep a copy of them. The host is " +
        "UP and every endpoint works, the Live transport is rebuilt from the floor, and GET /v1/settings " +
        "reports the values this process is actually running on.",
        settingsRead.FilePath,
        settingsRead.Reason);
}
else if (settingsRead.Status == FleetSettingsReadStatus.Unreadable)
{
    app.Logger.LogError(
        settingsRead.Failure,
        "STARTUP SETTINGS FILE COULD NOT BE READ — \"{SettingsFile}\" is present and this start could not " +
        "turn it into settings ({Reason}). It was NOT applied, and it was NOT overwritten or deleted by " +
        "this start — NOT because the file is protected, but because no ST4I_SERVER_URL/" +
        "ST4I_MACHINE_CODE/ST4I_VERIFY_TLS is set, so there is no environment floor to apply and nothing " +
        "to write. Set any one of them and the next start WILL overwrite this file (owner decision item 9, " +
        "2026-08-19). The host is UP and every endpoint works; the Live transport was NOT rebuilt, and " +
        "GET /v1/settings reports the values this process is actually running on. Repair or move the file " +
        "aside and restart, or set the values with PUT /v1/settings.",
        settingsRead.FilePath,
        settingsRead.Reason);
}

// 🔴 TASK Q-1 FIX ROUND — the same arm for site-link.json, reported here rather than at the site block far
// above, because that block writes to Console.Error and this level reaches the Windows Event Log under
// AddWindowsService. The DECISION was taken there, beside the read; only the sentence is here.
// The scope of the preservation claim is the same and is the same guarantee: the composition root did not
// call ApplyAsync on this arm, and ApplyAsync holds the only Save of this file in the whole product, so
// nothing wrote to it during this start.
if (unreadableSiteLink is not null)
{
    app.Logger.LogError(
        // 🔴 Fix round 2 (review N4) — the exception is passed, exactly as the settings arm above passes
        // `settingsRead.Failure`. It was omitted only because `SiteLinkRead` had no such member, which made
        // two arms deliberately built to be identical differ on the one thing a log sink can structure.
        unreadableSiteLink.Failure,
        "SITE LINK FILE COULD NOT BE READ — \"{SiteLinkFile}\" is present and this start could not turn it " +
        "into a Site link ({Reason}). It was NOT applied, and it was NOT overwritten or deleted by this " +
        "start: unreadable content is the only remaining record of the Site broker host, port and pinned " +
        "trust anchor that were configured here, so the default standalone record was deliberately NOT " +
        "written over it. THIS DEVICE IS RUNNING STANDALONE — no Site bridge was started, and " +
        "GET /v1/site reports that truthfully rather than claiming a link. Repair or move the file aside " +
        "and restart, or set the link with PUT /v1/site.",
        unreadableSiteLink.FilePath,
        unreadableSiteLink.Reason);
}

// ═══════════════════════════════════════════════════════════════════════════════════════════════════
// 🔴 H-1a — THE STARTUP REPLAY IS HARDENED HERE, AND IT IS HARDENED **FIRST**.
//
// 🔴 Task J-3 — WHY THIS AND THE UNGUARDED `wal.EnsureDir()` NEAR THE TOP OF THIS FILE ARE ONE RULE, NOT TWO
// POSTURES. Both sit before app.Run(), both are about configuration, and they do opposite things; that
// contradiction was booked at FleetCore's P5 and is reconciled in README §15.9, which is the artefact and
// the operator-facing half. The rule:
//
//   A host refuses to start over a bad configuration only when starting would be the QUIETER failure.
//   THE TEST, and it is ONE test: would continuing HIDE the loss? If the loss can be named where somebody
//   reads it, and nothing left running claims the lost thing still works, the host comes up and reports.
//
// DOMAIN: startup-path CONFIGURATION DECISIONS, not roots and not settings — every statement a composition
// root runs before its host serves, at which a value from outside the running program can fail and that
// statement decides whether the process continues. 🔴 The set is ENUMERATED, not counted, in
// docs/startup-failure-posture.md; read the list before extending the rule.
//
// This arm comes up because the test says so: the loss is exactly what the LogError below names, and
// GET /v1/settings goes on truthfully reporting the triple this process is holding — nothing left running
// claims the Live transport was rebuilt. The WAL ruling above fails the same test the other way, and stops.
//
// 🔴 A CORRECTION THAT BELONGS HERE, because the withdrawn claim was stated at this site. An earlier round
// wrote that this arm "fails BOTH conditions independently", making it "over-determined" — a second
// condition being "the value can be corrected WITHOUT this process". That is FALSE HERE, and the refutation
// is the RESTORE-arm remedy string passed to that same helper below: it tells the operator to "edit/delete
// fleet-settings.json … and restart". So the value CAN be corrected without this process, by the route the
// product itself names. What survives is the narrower true statement — PUT /v1/settings is the only
// IN-PRODUCT correction, and a dead service says nothing about which of three fields is wrong. Provenance is
// therefore recorded as the REASON the two arms feel different, not as a second test: across the whole
// enumerated set it changes exactly one prediction, and the one it changes is a symmetry defect that is
// visible without any rule at all (see the note at the `ConnectorConfigStore` construction above).
//
// Read the order, because reversing it ships the boot loop G-2 refused: this guard is the PRECONDITION
// for FleetCore.UpdateSettings persisting unconditionally, not a consequence of it. Until this `try`
// existed, the uniform S-set remedy (`Save` in a `finally`) was strictly worse than the defect.
//
// WHAT IT PREVENTS. `FleetHost.UpdateSettings` commits serverUrl/machineCode/verifyTls under FleetCore's
// lock and THEN activates them: `CredentialStore.Load` (which throws `ArgumentException` at its very
// first statement on an empty machine code), `TransportCoordinator.RebuildLive`, and an arbitrary host
// callback. Every one of those can throw, and this call sits BEFORE `app.Run()`. Unwrapped, a persisted
// triple that cannot be activated took the whole service down on EVERY subsequent start, with no running
// process left to correct it through.
//
// AND VALIDATING THE ENDPOINT WOULD NOT HAVE CLOSED IT. `fleet-settings.json` is a plain JSON file in a
// known, relocatable directory: a bad triple can arrive without passing through any `PUT /v1/settings`.
// Input validation at the endpoint is a good thing to have and is NOT this fix.
//
// WHAT IT DOES INSTEAD: the host STARTS, and SAYS SO. The LEVEL is load-bearing and is §10.4 stated as a
// requirement rather than as a lesson — this product ships no `appsettings.json`, so the framework's own
// default minimum applies and a `LogDebug` line here would not be quiet, it would be SILENT. `LogError`
// reaches the console, and under `AddWindowsService` it is a Windows Event Log entry an operator on shift
// can actually find.
//
// 🔴 THERE IS EXACTLY ONE REPLAY, AND NO ENV-VAR FALLBACK — a deliberate departure from the remedy as it
// was SKETCHED, and the reason is the whole of §8.1(d): a mechanism that arrives with a task is a CLAIM,
// not a premise. Run it before building on it.
//
// The sketch (recorded at FleetCore.UpdateSettings, from G-2's report) read: "wrap the boot-time
// UpdateSettings call, log, and fall back to the env-var branch". Fix round 1 implemented exactly that,
// and the branch review measured what it composes into. `UpdateSettings` persists UNCONDITIONALLY now —
// that is H-1a's own second half — so replaying the env floor here does not merely configure this
// process, it OVERWRITES `fleet-settings.json` with the floor. Consequences, all of them silent:
//
//   * a merely ENVIRONMENTAL failure (a full or read-only WAL root, a throwing host callback) fails a
//     PERFECTLY GOOD persisted triple and then destroys it. The next start has nothing to retry — which
//     falsifies, in this very branch, the "the next start retries and succeeds" rationale that argues for
//     the unconditional persist at FleetCore.UpdateSettings;
//   * it INVERTS FF-1's precedence, asserted two hundred lines above: the env vars are "only ever the
//     FLOOR for a machine that has never had these three set before". One failed activation and the floor
//     becomes the file, permanently;
//   * a PARTIAL floor (say only ST4I_SERVER_URL) commits the floor's serverUrl over the failed machine
//     code, throws again, and the `finally` persists a TORN triple no operator ever wrote;
//   * and the log line below would be stale as it was read: it tells an operator to edit or delete the
//     file, which no longer holds what failed.
//
// A compensating restore (save the floor, then write the operator's triple back) was considered and
// REJECTED: it leaves a crash window in which the operator's configuration is already gone, and it makes
// the file's correctness depend on a second write rather than on there being only one writer. The defect
// is that the hardening introduced a SECOND WRITER of this file and the unconditional persist made it
// authoritative. So the second writer is removed rather than compensated for.
//
// What that costs, stated rather than glossed: a host whose persisted triple cannot be activated does NOT
// get a Live transport built from the env vars this boot. It comes up on its startup default, reports the
// triple it is holding, and says at Error what happened. FF-1's precedence stays literally true, the file
// still holds exactly what the operator wrote, and the next start retries it.
//
// 🔴 WHAT THIS DOES **NOT** DO, said here rather than left to be discovered. It does not roll the
// committed fields back. After a failed replay FleetCore's fields hold the triple that failed to
// activate, so `GET /v1/settings` reports it — truthfully, as the configuration this process is holding —
// while the transport stays on whatever it had. Rolling back is remedy (b) at `FleetCore.UpdateSettings`:
// it changes what a failed call MEANS to its caller and needs an arbitration rule for a rollback racing a
// concurrent second `UpdateSettings`. Out of scope here, and named there.
// ═══════════════════════════════════════════════════════════════════════════════════════════════════
static bool TryReplayStartupSettings(
    FleetHost host, ILogger logger, SettingsUpdateRequest request, string source, string settingsDir,
    string remedy)
{
    try
    {
        host.UpdateSettings(request);
        return true;
    }
    catch (Exception ex)
    {
        // Never the mk_ key: these three fields are exactly what GET /v1/settings already returns.
        // The DIRECTORY rather than the full path, so this does not restate FleetSettingsStore's own
        // private file-name constant and cannot drift from it.
        logger.LogError(
            ex,
            "STARTUP SETTINGS REPLAY FAILED — {Source} could not be applied and the service is starting " +
            "WITHOUT it (serverUrl={ServerUrl}, machineCode=\"{MachineCode}\", verifyTls={VerifyTls}). " +
            "The host is UP and every endpoint works; the Live transport was NOT rebuilt from these " +
            "values. {Remedy}",
            source,
            request.ServerUrl,
            request.MachineCode,
            request.VerifyTls,
            remedy);
        return false;
    }
}

var replayRestoredAFile = persistedSettings is not null;

// 🔴 TASK Q-1 — the helper below must keep exactly ONE call in this file: a second replay arm goes through
// UpdateSettings, which persists in a `finally`, which is how branch review C1 destroyed the operator's file
// the first time. StartupSettingsReplayHardeningTests counts that from src/ — and it counted THIS PARAGRAPH
// when the sentence above spelled the helper's name followed by an open parenthesis, which is worth leaving
// on the record: the census reads TEXT and cannot tell a comment from a call, that ceiling is stated in its
// own doc, and the answer is to write the prose differently rather than to teach it to skip comments.
//
// 🔴 TASK AJ-1 — Q-1's SHORT-CIRCUIT IS GONE, ON THE OWNER'S DECISION OF 2026-08-19 (item 9, option (b)),
// AND THE SHAPE OF THAT REMOVAL IS THE POINT. The guard read `settingsRead.Status != Unreadable &&`. On the
// Unreadable arm `FleetSettingsRead.ForUnreadable` carries no Settings, so `persistedSettings` is null, so
// `initialSettingsRequest` above is ALREADY the ST4I_* floor — which means (b) is executed by DELETING one
// expression, with no new call site, and the one-call census above therefore does NOT move. That is worth
// saying out loud rather than leaving to be rediscovered: the census still holds the property it was built
// for (no second arm that persists a triple behind the operator's back), and it was never going to be the
// instrument that saw this change. The instrument that sees it is a BEHAVIOUR test —
// StartupSettingsReplayHardeningTests.AMalformedSettingsFile_IsOverwrittenByTheEnvironmentFloor_AndTheHostSaysSo
// — which asserts the FILE's bytes and the response, and therefore cannot be satisfied by writing this
// differently.
//
// WHAT THIS COSTS, STATED RATHER THAN GLOSSED, BECAUSE IT RUNS AGAINST FIVE EARLIER DECISIONS (1, 5, 8, 10,
// 11) THAT ALL FORBADE WRITING OVER BYTES THIS PROCESS COULD NOT READ. The reconciling reading, recorded at
// item 9 with its date: in those five the bytes overwritten were the OPERATOR'S OWN DATA and the value
// written was one this process INVENTED. Here the value written is the deployment's own declared
// configuration, arriving through ST4I_* — the process restores a declared value rather than inventing one.
// That is the owner's reading and not this task's; the tension is recorded next to it so a later reader can
// check it instead of guessing.
//
// The discard block further down is UNCHANGED and still cannot be entered from this arm: its condition is
// `Status == Absent`, and Absent is not Unreadable. That is deliberate and is the boundary this task was
// forbidden to cross — an in-place overwrite was decided; MOVING or DELETING the old bytes was not.
//
// 🔴 AND ONE CONSEQUENCE OF DELETING THE GUARD THAT IS NOT ABOUT THE FILE AT ALL, WRITTEN DOWN BECAUSE
// "nothing else changed on that arm" IS A CLAIM ABOUT A SET AND WHAT WAS MEASURED IS A POINT.
// On the Unreadable arm with NO ST4I_* set, the observable effect is the same as before this task — nothing
// is applied and nothing is written, because `rebuildNeeded` stays false. But the CONTROL FLOW is not the
// same: the guard used to short-circuit the call away entirely, and now `TryReplayStartupSettings` really
// runs, `UpdateSettings(null, null, null, null)` does not throw, and `replaySucceeded` therefore moves from
// `false` to TRUE on that arm. That is harmless TODAY, and only for one checkable reason: `replaySucceeded`
// has exactly one reader — the discard block below — and that reader is gated on `Status == Absent`, which
// this arm is not. Widen that condition and this arm changes silently. The next person to touch it is being
// told here rather than left to find out, which is the same rule Q-1 applied to the sentence it falsified.
var replaySucceeded = TryReplayStartupSettings(
    fleetHost,
    app.Logger,
    initialSettingsRequest,
    replayRestoredAFile
        ? "the persisted fleet-settings.json"
        : "the ST4I_SERVER_URL/ST4I_MACHINE_CODE/ST4I_VERIFY_TLS environment floor",
    settingsStore.RootDirectory,
    // 🔴 The remedy differs per ARM, and saying so is branch re-review Minor 6. The restore arm's advice
    // is to repair the file; the SEED arm's advice must NOT be, because the block below is about to
    // delete that file — an operator who read the Error line alone would be sent to a path that no
    // longer exists. Passed in rather than branched inside the helper so the two sentences sit next to
    // the condition that chooses between them.
    //
    // 🔴 TASK AJ-1 — THERE ARE NOW THREE ARMS AND THE SELECTOR HAD TO CHANGE WITH THEM, BECAUSE THE SEED
    // SENTENCE WAS A PUBLISHED STRING THAT (b) MADE FALSE. It was chosen by `replayRestoredAFile`, i.e. by
    // "there is no persisted triple" — which is true on Absent AND on Unreadable, and it says "NO settings
    // file existed before this start". On the Unreadable arm a file exists; this start simply cannot read
    // it. Selecting on the READ OUTCOME rather than on the presence of a triple is what makes each of the
    // three sentences true of the arm it is used on. Same defect class as the log line above, one branch
    // apart, and both are fixed in this commit rather than one of them.
    settingsRead.Status switch
    {
        FleetSettingsReadStatus.Loaded =>
            $"Correct them with PUT /v1/settings, or edit/delete fleet-settings.json in " +
            $"\"{settingsStore.RootDirectory}\" and restart.",

        FleetSettingsReadStatus.Absent =>
            "These came from the ST4I_* environment variables and NO settings file existed before this " +
            "start. Correct those variables and restart, or set the values with PUT /v1/settings. Do not " +
            "go looking for a settings file — see the next line for what happened to the one this start " +
            "would otherwise have left behind.",

        _ =>
            "These came from the ST4I_* environment variables. A fleet-settings.json DID exist before " +
            "this start and this start could not read it — see the STARTUP SETTINGS FILE COULD NOT BE " +
            "READ line above — so the floor was applied in its place, and it is being written over that " +
            "file rather than kept beside it (owner decision item 9, 2026-08-19). Correct those variables " +
            $"and restart, or set the values with PUT /v1/settings; the file in \"{settingsStore.RootDirectory}\" " +
            "no longer holds what an operator put there.",
    });

// ═══════════════════════════════════════════════════════════════════════════════════════════════════
// 🔴 WHOLE-BRANCH REVIEW I-3 — A FAILED **SEED** MUST NOT BECOME THE SOURCE OF TRUTH.
//
// Read the condition, because the OTHER arm is branch-review C1 and this must not become it: this runs
// only when there was NO `fleet-settings.json` before. A failed RESTORE never deletes anything — the
// operator's file is exactly what C1 exists to protect.
//
// THE DEFECT IT CLOSES. With no persisted file, the replay seeds FleetCore from the env-var floor. Any
// non-null field makes `rebuildNeeded` true, and `UpdateSettings` now persists UNCONDITIONALLY (H-1a's
// own second half, which is what closed S6). So a throw during activation still reaches the `finally`,
// and `fleet-settings.json` is CREATED — holding the floor merged with FleetHost's built-in defaults
// (`DefaultServerUrl = ""`, `DefaultMachineCode = "ENGINE-API-01"`) for whichever variables were unset.
// From the next boot that file WINS over the env vars, per FF-1's precedence. The env vars have stopped
// being the floor, permanently, on the strength of a triple that never activated — and an operator who
// reads the Error line, corrects ST4I_SERVER_URL and restarts finds the correction ignored.
//
// This is bullets 2 and 3 of the argument printed above for removing the fix-round-1 fallback ("it
// INVERTS FF-1's precedence" and "a PARTIAL floor persists a TORN triple"), surviving on the arm that was
// KEPT — because those two are properties of the `finally`, not of the fallback. The paragraph above
// attributed all four to the fallback; that accounting was wrong and this is the half it missed.
//
// WHY A DELETE IS ACCEPTABLE HERE WHEN A COMPENSATING WRITE WAS NOT (the C1 reasoning, re-derived rather
// than reused): C1's rejected save-then-restore had a crash window in which the operator's OWN
// configuration was already gone. Here the file did not exist a moment ago, so the worst a crash between
// the `finally` and this line can do is leave the state this branch is fixing — a failure to clean up,
// never a loss of customer data. Different risk class, and that difference is the whole argument.
//
// WHAT IT DOES NOT DO: it does not retry, and it does not roll FleetCore's in-memory fields back. The
// process keeps running on the triple it committed and `GET /v1/settings` reports it — the same honest
// divergence the primary arm carries.
//
// 🔴 HOW REACHABLE IS THIS ARM TODAY — stated here, because this is where someone decides whether the
// guard earns its keep (branch re-review, Minor 7). The RESTORE arm is demonstrably reachable: a
// hand-edited `machineCode: ""` throws out of `CredentialStore.Load`'s first statement, and that is the
// tested case S6's closure rests on. This SEED arm is different: enumerated rather than assumed, NO
// env-var-only route reaches an activation throw here today. `CredentialStore.Load` throws only on an
// empty machine code, which this arm cannot produce (a blank ST4I_MACHINE_CODE resolves to null and the
// 🔴 Task J-3 — THE "~1550" IN THE NEXT PARAGRAPH IS KNOWN STALE AND IS DELIBERATELY NOT RE-FITTED. Read
// this before "correcting" it. Measured statement-to-statement at commit 670a3e8f — BEFORE this task changed
// anything — the real distance was 1616, so the pointer was already stale by 66 lines with nothing that moved
// it having been about it. It has grown since and will keep growing; no current figure is recorded here on
// purpose, because a second decaying number is not evidence, it is the same defect twice. Measure it, if you
// ever need it, between the two SYMBOLS: the `wal.EnsureDir()` call near the top of this file and the
// `TryReplayStartupSettings` call above. FleetCore's own settings paragraph has recorded
// distance-shaped pointers as "wrong three times running"; this is a fourth instance, and it is the
// STRONGEST form of that evidence precisely because no one touched the pointer. Re-fitting the number
// silently would erase the evidence and leave the next drift undetectable. The honest repair is to stop
// expressing this pointer as a distance at all — which is H-1a's prose to change, not J-3's, so the
// disposition is: NAMED, NOT CHANGED, and named HERE rather than only in a report so it is checkable by
// diff (§8.1(h4): silence is not a disposition). The statement it points at is the `wal.EnsureDir()` call
// near the top of this file; that pointer, not the number, is what to follow.
// built-in default is kept); `RebuildLive`'s WAL arm is pre-empted ~1550 lines above by an unguarded
// `wal.EnsureDir()` on the same options, MEASURED, which stops the host before this line; and neither
// the vendored SDK client nor `LiveConfigSyncBackend` parses a URL. What remains is
// `_onLiveSettingsRebuilt`, documented as an ARBITRARY host callback — so this guard rests on a contract
// rather than on a demonstrated variable, deliberately. "Benign today" is a property of the current
// callee, which is the sentence pattern this codebase refuses to rely on everywhere else. The test
// injects the throw through a real TransportCoordinator holding different WalOptions, which is the same
// call from options the early EnsureDir never saw.
// ═══════════════════════════════════════════════════════════════════════════════════════════════════
// 🔴 TASK Q-1 CHANGED THIS CONDITION, AND THE CHANGE IS THE POINT. It read `!replaySucceeded &&
// !replayRestoredAFile`, and `!replayRestoredAFile` meant "Load() returned null", which covered BOTH no file
// and a file that could not be read. That is how a Delete() written for a file this start had just created
// became reachable with the operator's own file present — measured, and tabulated as the three deletion
// shapes in docs/startup-failure-posture.md §3.1a. Gating on Absent says what was always meant: there was
// nothing here before this start, so the only thing that can be on disk now is what this start wrote.
// It is strictly narrower than what it replaces — Absent implies !replayRestoredAFile, never the reverse —
// so no arm that used to be excluded is now included.
if (settingsRead.Status == FleetSettingsReadStatus.Absent && !replaySucceeded)
{
    try
    {
        settingsStore.Delete();
        app.Logger.LogWarning(
            "STARTUP SETTINGS SEED DISCARDED — the environment floor could not be activated, so the " +
            "fleet-settings.json it would have created in {SettingsDir} was removed. The " +
            "ST4I_SERVER_URL/ST4I_MACHINE_CODE/ST4I_VERIFY_TLS variables therefore REMAIN the floor and " +
            "the next start retries them; had the file been left, it would have won over them from now " +
            "on. Nothing an operator wrote was deleted — no settings file existed before this start.",
            settingsStore.RootDirectory);
    }
    catch (Exception ex)
    {
        app.Logger.LogError(
            ex,
            "STARTUP SETTINGS SEED COULD NOT BE DISCARDED — the environment floor failed to activate and " +
            "the fleet-settings.json written from it in {SettingsDir} could NOT be removed. That file " +
            "now WINS over ST4I_SERVER_URL/ST4I_MACHINE_CODE/ST4I_VERIFY_TLS on every subsequent start, " +
            "so correcting those variables will have no effect until it is deleted by hand.",
            settingsStore.RootDirectory);
    }
}

app.Logger.LogInformation(
    "St4i.EngineApi ready — {Count} machine(s) in the fleet roster: {Codes} (mode={Mode})",
    fleetHost.Fleet.Count,
    string.Join(", ", fleetHost.Fleet.Select(d => d.Code)),
    fleetHost.Mode);

// 🔴 Task C-2 — the replacement for C-1's single "the env var is not set" warning, and the guarantee that
// no configuration can be silently inert. NotificationStartupNotices.Describe is a pure function whose
// invariant — "if nothing will be delivered, at least one Warning is produced" — is asserted exhaustively
// over its whole input space (see NotificationStartupNoticesTests), rather than by the handful of examples
// an inline `if` here could cover. Wiring it is these three lines, which cannot be got wrong; the same
// split BindingRisk.Describe already uses below.
foreach (var notice in St4i.EngineApi.Alarms.NotificationStartupNotices.Describe(
             notificationChannels, implementedNotificationChannels))
{
    if (notice.Severity == St4i.EngineApi.Alarms.NotificationNoticeSeverity.Warning)
    {
        app.Logger.LogWarning("{AlarmNotifyNotice}", notice.Message);
    }
    else
    {
        app.Logger.LogInformation("{AlarmNotifyNotice}", notice.Message);
    }
}

// WS-C-T4 — force-touch WalFlushPump now (same reasoning as FleetHost above): constructing it starts
// its background Task.Run loop immediately, rather than leaving it dormant until something happens to
// resolve the singleton on its own (nothing else in the DI graph depends on it).
_ = app.Services.GetRequiredService<St4i.EdgeCore.Transport.WalFlushPump>();

// WS-D-D5 — loopback-exposure startup check. IServerAddressesFeature is only populated once the server
// has actually begun listening (empty/absent beforehand), so this runs on the ApplicationStarted lifetime
// event rather than right here — registering the callback now, before app.Run() starts the host, is what
// guarantees it actually fires (ApplicationStarted has usually already been raised by the time
// app.Services is even reachable under Mvc.Testing's WebApplicationFactory, which builds+starts the host
// eagerly — see BindingRiskTests'/AuditWiringTests' system.startup coverage). BindingRisk.Describe itself
// is a pure function (fully unit-tested in isolation) — this registration is just the I/O wiring around
// it: read the addresses, log a warning if risky, and ALWAYS write a system.startup audit row (risk: null
// on a safe binding is itself a useful "the host came up, and here's what it was actually bound to"
// marker in the trail — not just a marker for the risky case).
app.Lifetime.ApplicationStarted.Register(() =>
{
    var addressesFeature = app.Services.GetRequiredService<IServer>().Features.Get<IServerAddressesFeature>();
    var boundUrls = addressesFeature?.Addresses.ToArray() ?? Array.Empty<string>();
    var risk = BindingRisk.Describe(boundUrls);

    if (risk is not null)
    {
        app.Logger.LogWarning("{BindingRisk}", risk);
    }

    // WS-D-D4's audit failure policy applies here too — RecordSystemAsync never throws (see
    // AuditRecorder), so a local security.db hiccup at the exact moment of startup still can't fail
    // startup itself. Blocked (not fire-and-forget) so the row is guaranteed written before this
    // ApplicationStarted callback returns — the same "eager, deterministic, no race with the first test/
    // request that goes looking for it" reasoning as the FleetHost/WalFlushPump force-touches above.
    var recorder = app.Services.GetRequiredService<AuditRecorder>();
    recorder.RecordSystemAsync("system.startup", newValue: new { boundUrls, risk }).GetAwaiter().GetResult();
});

app.Run();
return 0;

// WS-F1-T1 — the early `return serviceVerbExitCode;` above (an install/uninstall/status verb) is what
// makes the compiler infer an `int`-returning top-level-statements Main in the first place; that means
// EVERY path through this file must now return an int, including normal startup falling out the bottom
// of app.Run() (which blocks until shutdown, but the compiler can't know that statically) — hence this
// explicit `return 0;`, which didn't need to exist before this task.
//
// WS-D-D1 — top-level statements generate an IMPLICIT `Program` class; declaring it explicitly here
// (merged via `partial`, zero behavior change) is what lets AuthPipelineTests use
// Microsoft.AspNetCore.Mvc.Testing's WebApplicationFactory&lt;Program&gt; to boot this exact composition
// root in-memory instead of hand-duplicating it.
public partial class Program;
