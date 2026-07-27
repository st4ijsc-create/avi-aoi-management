using System.Text.Json.Serialization;
using Microsoft.AspNetCore.Authentication;
using Microsoft.AspNetCore.Authentication.Cookies;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.DataProtection;
using Microsoft.AspNetCore.Hosting.Server;
using Microsoft.AspNetCore.Hosting.Server.Features;
using Microsoft.Extensions.FileProviders;
using St4i.EdgeCore.Config;
using St4i.EdgeCore.Infrastructure;
using St4i.EdgeCore.Models;
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
builder.Services.AddSingleton<St4i.EngineApi.Policy.PolicyEngine>(_ =>
    new St4i.EngineApi.Policy.PolicyEngine(new St4i.EngineApi.Policy.IPolicyRule[]
    {
        new St4i.EngineApi.Policy.Rules.EstopGuardRule(),   // safety-first (deny precedence)
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

// GĐ3 sub-4 LC-1 (.superpowers/sdd/2026-07-27-giaidoan3-alarms-linecontroller-blueprint/task-1-brief.md) —
// the alarm backbone: a durable SQLite store (alarms.db) for the ISA-18.2 alarm model (raise/clear/ack/
// list/history). Registered as a singleton BEFORE Build() (same convention as IAssetRegistry above) so
// PolicyResults.DenyAsync's ctx.RequestServices.GetService<IAlarmStore>() resolves the SAME instance every
// mutating handler's policy-deny path raises against — a singleton also matters here because AlarmStore's
// SQLite connections are short-lived-per-call, not because of any in-process lock (unlike SqliteAuditStore).
// Relocatable via ST4I_ALARMS_DIR, same ops/testability rationale as ST4I_ASSETS_DIR above.
var alarmsDir = Environment.GetEnvironmentVariable("ST4I_ALARMS_DIR");
builder.Services.AddSingleton<St4i.EngineApi.Alarms.IAlarmStore>(sp =>
    new St4i.EngineApi.Alarms.AlarmStore(
        string.IsNullOrWhiteSpace(alarmsDir) ? null : alarmsDir,
        logError: (ex, msg) => sp.GetRequiredService<ILoggerFactory>().CreateLogger("Alarms").LogError(ex, "{AlarmsMsg}", msg)));

// G2-2 (docs/plans/2026-07-27-giaidoan2-synapse-connect-blueprint.md task 2) — the local UNS spine: an
// always-on loopback MQTTnet broker (UnsBroker) plus the dual-topic (Sparkplug + retained semantic-mirror)
// publisher (UnsPublisher) FleetHost threads into every EdgePipeline it builds (see FleetHost.StartLocked).
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

// GĐ3 EC-2 (docs/plans .../2026-07-27-giaidoan3-ecosystem-connect-blueprint/task-2-brief.md) — the device
// identity singleton (EC-1) + the Site-link northbound bridge manager.
//
// The identity is resolved via DeviceIdentityStore.LoadOrCreate exactly ONCE, right here, and reused as a
// DI singleton for the rest of this process's life — DeviceIdentityStore's own doc comment (EC-1 review
// C-1) is explicit that PersistKeySet writes a fresh CNG key-store entry on every LoadOrCreate call, so
// this must NEVER be called again per-request/per-call. A standalone box that never configures a Site link
// still legitimately gets a device identity (one keystore entry, once, at startup) — accepted/documented
// per EC-1/EC-2 — so this happens unconditionally, unlike the Site bridge manager below.
var deviceIdentity = new St4i.EdgeCore.Identity.DeviceIdentityStore(
        logError: (ex, msg) => Console.Error.WriteLine($"[startup] {msg}: {ex.GetType().Name}: {ex.Message}"))
    .LoadOrCreate(unsOptions.Cell);
builder.Services.AddSingleton(deviceIdentity);

// GĐ3 sub-2 SD-1 (.superpowers/sdd/2026-07-27-giaidoan3-mdns-join-wizard-blueprint/task-1-brief.md) — the
// mDNS Site-discovery singleton backing GET /v1/site/discover. Registered UNCONDITIONALLY (unlike the
// UNS-gated SiteBridgeManager below) — browsing the LAN for a Site to join has nothing to do with whether
// THIS device's own local UNS spine happens to be enabled, and SiteEndpoints.DiscoverAsync takes a plain
// (non-nullable) ISiteDiscovery parameter, which — same [FromServices]/inferred-body-parameter hazard this
// class' own doc comment documents for SiteBridgeManager? — REQUIRES the type to always be registered, or
// minimal API's endpoint-metadata build throws at the first request touching ANY route. The singleton
// itself holds no socket (see SiteDiscovery's own doc comment: per-call ephemeral) — this registration is
// just wiring a real logger into its never-throws logError callback.
builder.Services.AddSingleton<St4i.EdgeCore.Site.ISiteDiscovery>(sp =>
    new St4i.EdgeCore.Site.SiteDiscovery(
        logError: (ex, msg) => sp.GetRequiredService<ILoggerFactory>().CreateLogger("SiteDiscovery").LogError(ex, "{Msg}", msg)));

// The Site bridge manager only makes sense when there's an actual local UNS spine to bridge (a bridge with
// nothing to subscribe to is meaningless) — gated on the SAME unsOptions.Enabled this task's own UNS broker
// block above already gates on. When UNS is disabled, only the identity singleton above is registered (so
// EC-3's identity endpoint still works standalone), and no SiteLinkStore/SiteBridgeManager is constructed
// at all — byte-identical to pre-EC-2 behavior in that case.
if (unsOptions.Enabled)
{
    var siteStore = new St4i.EdgeCore.Site.SiteLinkStore();
    var siteBridgeManager = new St4i.EdgeCore.Site.SiteBridgeManager(
        unsOptions,
        deviceIdentity,
        siteStore,
        logWarning: msg => Console.Error.WriteLine($"[startup] {msg}"),
        logError: (ex, msg) => Console.Error.WriteLine($"[startup] {msg}: {ex.GetType().Name}: {ex.Message}"));

    // Eager start (mirrors the UNS broker block above): ApplyAsync itself never throws (construct/connect
    // failures are caught+logged inside it, leaving the manager's Status() at Disabled/Down) — this
    // try/catch is only extra insurance so a truly unexpected failure here still can't crash startup.
    try
    {
        siteBridgeManager.ApplyAsync(siteStore.Load() ?? new St4i.EdgeCore.Site.PersistedSiteLink())
            .GetAwaiter().GetResult();
    }
    catch (Exception ex)
    {
        Console.Error.WriteLine($"[startup] Site bridge failed to start for this run — standalone: {ex.Message}");
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
// ST4I_UNS_ENABLED — see ModbusOptions' own doc comment): when disabled, the Func<IDeviceDriver> below is
// never registered, so FleetHost's optional `modbusDriverFactory` ctor param resolves to its own `null`
// default — byte-identical to today, same contract as every other optional FleetHost dependency above. A
// missing/malformed register map (ST4I_MODBUS_MAP) logs a warning and disables Modbus for this run rather
// than crashing startup — same "never allowed to fail the host it's bolted onto" posture as the UNS
// broker-bind failure just above.
// P2-3 (docs/plans/2026-07-27-giaidoan2-pass2-blueprint.md task 3) — hoisted OUTSIDE the
// `if (modbusOptions.Enabled)` block below because `modbusMap`/`capturedMap` are scoped INSIDE it, while
// the roster-seed call (`fleetHost.RegisterMachine`, further down, well after `app.Build()`) needs to reach
// a descriptor built from that same map. Stays null (no-op) unless Modbus is enabled AND its register map
// actually loaded — additive + still default-off, same contract as `_modbusDriverFactory` above.
St4i.EdgeCore.Models.MachineDescriptor? modbusSeedDescriptor = null;

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
        modbusMap = St4i.EdgeCore.Drivers.Modbus.ModbusRegisterMap.FromJson(mapJson);
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
        builder.Services.AddSingleton<Func<St4i.EdgeCore.Drivers.IDeviceDriver>>(sp =>
        {
            var logger = sp.GetRequiredService<ILoggerFactory>().CreateLogger("Modbus");
            var factory = new St4i.EdgeCore.Drivers.Modbus.ModbusDriverFactory(
                modbusOptions, capturedMap,
                logWarning: msg => logger.LogWarning("{ModbusMsg}", msg),
                logError: (ex, msg) => logger.LogError(ex, "{ModbusMsg}", msg));
            return factory.Create;
        });

        // P2-3 — the Modbus machine's roster descriptor, built from the SAME loaded register map (its
        // MachineCode + PollIntervalMs), so it gets a MachineState (fleet Snapshot tile + historian) and,
        // via P2-1's upsert-on-register, an Asset row — instead of being an invisible telemetry stream.
        modbusSeedDescriptor = new St4i.EdgeCore.Models.MachineDescriptor(
            Code: capturedMap.MachineCode,
            SerialSeed: $"SN-{capturedMap.MachineCode}",
            DeviceClass: St4i.EdgeCore.Models.DeviceClass.Automation,
            MachineType: "MODBUS_TCP",
            StepType: null,
            DriverKind: St4i.EdgeCore.Models.DriverKind.Modbus,
            RecipeCode: null,
            MappingProfile: null,
            CycleSeconds: Math.Max(0.1, capturedMap.PollIntervalMs / 1000.0));
    }
}

// GĐ3 sub-3 OU-1 (docs/plans/2026-07-27-giaidoan3-opcua-driver-blueprint.md task 1) — the SECOND real
// field-protocol driver, mirroring the Modbus block immediately above (G2-6): an OPC-UA CLIENT poller run
// as its OWN isolated FleetHost pipeline slot (G2-5 fault isolation — an OPC-UA fault can never tear down
// the simulated fleet or the Modbus slot). Additive + env-gated OFF BY DEFAULT (ST4I_OPCUA_ENABLED
// unset/false — see OpcUaOptions' own doc comment): when disabled, no OpcUaDriverFactory is registered, so
// FleetHost's optional `opcUaDriverFactory` ctor param resolves to its own `null` default — byte-identical
// to today. A missing/malformed node map (ST4I_OPCUA_MAP) logs a warning and disables OPC-UA for this run
// rather than crashing startup — same posture as the Modbus/UNS blocks above.
//
// DI disambiguation (the brief's explicit call-out): Modbus's factory is registered as a bare
// `Func<IDeviceDriver>` singleton above — registering OPC-UA's factory the SAME way would collide with
// that exact registration. Registering `OpcUaDriverFactory` AS ITSELF (a distinct concrete type) instead
// means the two optional dependencies resolve independently; see OpcUaDriverFactory's own "DI
// disambiguation" doc comment.
//
// GĐ3 sub-3 OU-2 — P2-3 parity: `opcUaSeedDescriptor` is hoisted OUTSIDE the `if (opcUaOptions.Enabled)`
// block below (same reasoning as `modbusSeedDescriptor` above — `opcUaMap`/`capturedOpcUaMap` are scoped
// INSIDE it, while the roster-seed call, further down, well after `app.Build()`, needs to reach a
// descriptor built from that same map). Stays null (no-op) unless OPC-UA is enabled AND its node map
// actually loaded — additive + still default-off, same contract as `_opcUaDriverFactory` above. Once
// seeded, this OPC-UA machine gets a fleet Snapshot tile/historian row/Asset row (via the roster-seed
// call below), not just an invisible telemetry stream.
St4i.EdgeCore.Models.MachineDescriptor? opcUaSeedDescriptor = null;

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
        opcUaMap = St4i.EdgeCore.Drivers.OpcUa.OpcUaNodeMap.FromJson(mapJson);
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
        builder.Services.AddSingleton(sp =>
        {
            var logger = sp.GetRequiredService<ILoggerFactory>().CreateLogger("OpcUa");
            return new St4i.EdgeCore.Drivers.OpcUa.OpcUaDriverFactory(
                capturedOpcUaMap,
                pkiDir: opcUaOptions.PkiDir,
                logWarning: msg => logger.LogWarning("{OpcUaMsg}", msg),
                logError: (ex, msg) => logger.LogError(ex, "{OpcUaMsg}", msg));
        });

        // GĐ3 sub-3 OU-2 — the OPC-UA machine's roster descriptor, built from the SAME loaded node map
        // (its MachineCode + PollIntervalMs), so it gets a MachineState (fleet Snapshot tile + historian)
        // and, via P2-1's upsert-on-register, an Asset row — instead of being an invisible telemetry
        // stream. Mirrors `modbusSeedDescriptor` above exactly.
        opcUaSeedDescriptor = new St4i.EdgeCore.Models.MachineDescriptor(
            Code: capturedOpcUaMap.MachineCode,
            SerialSeed: $"SN-{capturedOpcUaMap.MachineCode}",
            DeviceClass: St4i.EdgeCore.Models.DeviceClass.Automation,
            MachineType: "OPC_UA",
            StepType: null,
            DriverKind: St4i.EdgeCore.Models.DriverKind.OpcUa,
            RecipeCode: null,
            MappingProfile: null,
            CycleSeconds: Math.Max(0.1, capturedOpcUaMap.PollIntervalMs / 1000.0));
    }
}

// Task 9 (WS-A) — per-machine OEE settings (ideal-cycle override + planned-production ratio), a plain
// JSON-file-backed store (WS-A-T5) that was never wired into DI until now. Pointed at the SAME resolved
// ST4I_HISTORIAN_DIR (or SqliteHistorianStore's own default when unset) so every historian-adjacent file
// lives in one place. Tests construct their own instance pointed at a temp directory instead of resolving
// this registration.
builder.Services.AddSingleton(
    _ => new St4i.EdgeCore.Historian.OeeSettingsStore(string.IsNullOrWhiteSpace(historianDir) ? null : historianDir));

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
// GĐ3 sub-4 LC-1 — the alarm HTTP surface (GET /v1/alarms(+/history), POST /v1/alarms/{id}/ack).
app.MapAlarmEndpoints();
// GĐ3 EC-3 — the Site-link status/config + device-identity HTTP surface over EC-2's SiteBridgeManager.
app.MapSiteEndpoints();
app.MapInspectorStream();

// WS-D-D1 — ENDPOINT, so it inherits the FallbackPolicy above like every other mapped route; without
// AllowAnonymous the SPA shell (index.html) itself would 401 while logged out, and a logged-out user
// could never even reach a login screen. AllowAnonymous is safe here specifically because this only ever
// serves the static shell, not any API data — the SPA's own API calls still hit the auth-gated /v1/*
// routes above.
app.MapFallbackToFile("index.html").AllowAnonymous();

// Force-touch FleetHost now (rather than lazily on the first request) so its fleet.json/default-roster
// resolution — and any FleetConfigException it might swallow — happens at startup, where a log line is
// actually useful, not silently on whichever request happens to hit it first.
var fleetHost = app.Services.GetRequiredService<FleetHost>();

// P2-3 — register the configured Modbus machine as a first-class roster member so it gets a MachineState
// (fleet Snapshot tile + historian) and, via the asset registry, an Asset row. Idempotent: RegisterMachine
// returns false (benign) if it's already present. StartLocked excludes DriverKind.Modbus from simulation, so
// this machine is driven ONLY by the real Modbus pipeline slot, never double-driven.
if (modbusSeedDescriptor is not null)
{
    fleetHost.RegisterMachine(modbusSeedDescriptor);
}

// GĐ3 sub-3 OU-2 — register the configured OPC-UA machine as a first-class roster member, mirroring the
// Modbus P2-3 seed immediately above: it gets a MachineState (fleet Snapshot tile + historian) and, via
// the asset registry, an Asset row. Idempotent: RegisterMachine returns false (benign) if it's already
// present. StartLocked excludes DriverKind.OpcUa from simulation, so this machine is driven ONLY by the
// real OPC-UA pipeline slot, never double-driven.
if (opcUaSeedDescriptor is not null)
{
    fleetHost.RegisterMachine(opcUaSeedDescriptor);
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
var persistedSettings = settingsStore.Load();
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

fleetHost.UpdateSettings(initialSettingsRequest);

app.Logger.LogInformation(
    "St4i.EngineApi ready — {Count} machine(s) in the fleet roster: {Codes} (mode={Mode})",
    fleetHost.Fleet.Count,
    string.Join(", ", fleetHost.Fleet.Select(d => d.Code)),
    fleetHost.Mode);

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
