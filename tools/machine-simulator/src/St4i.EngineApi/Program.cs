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
    // leaving it plaintext XML on disk (CredentialStore already uses the same in-box DPAPI API for the
    // mk_ device key, see its own doc comment). protectToLocalMachine: true (LocalMachine scope, not the
    // CurrentUser scope CredentialStore uses) deliberately — CurrentUser DPAPI ties the encrypted keys to
    // whichever single Windows account is running THIS process at the moment they're written; this host is
    // meant to eventually run as a Windows Service (WS-F1), and a service's logon account can differ across
    // machines/reinstalls (or get reconfigured) in a way an interactively-run desktop app's account
    // normally doesn't — CurrentUser scope would silently invalidate every outstanding cookie (and force a
    // fresh key-ring generation) the moment that happens. LocalMachine scope avoids that fragility (any
    // process on THIS machine can decrypt, not just one specific account), which is an acceptable trade
    // specifically BECAUSE SecurityDirAcl.Apply above already restricts local non-admin filesystem READ
    // access to the key files in the first place — DPAPI here is a second, independent layer (protects the
    // key material even if the ACL is ever misconfigured, bypassed, or the file is copied off by an admin
    // process), not the only thing standing between a local non-admin and the key ring.
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

// Task 9 (WS-A) — per-machine OEE settings (ideal-cycle override + planned-production ratio), a plain
// JSON-file-backed store (WS-A-T5) that was never wired into DI until now. Pointed at the SAME resolved
// ST4I_HISTORIAN_DIR (or SqliteHistorianStore's own default when unset) so every historian-adjacent file
// lives in one place. Tests construct their own instance pointed at a temp directory instead of resolving
// this registration.
builder.Services.AddSingleton(
    _ => new St4i.EdgeCore.Historian.OeeSettingsStore(string.IsNullOrWhiteSpace(historianDir) ? null : historianDir));

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

fleetHost.UpdateSettings(new SettingsUpdateRequest(
    ServerUrl: string.IsNullOrWhiteSpace(initialLiveServerUrl) ? null : initialLiveServerUrl,
    VerifyTls: initialLiveVerifyTls,
    Language: null,
    MachineCode: string.IsNullOrWhiteSpace(initialLiveMachineCode) ? null : initialLiveMachineCode));

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
