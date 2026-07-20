using System.Text.Json.Serialization;
using St4i.EdgeCore.Config;
using St4i.EdgeCore.Infrastructure;
using St4i.EdgeCore.Models;
using St4i.EdgeCore.Transport;
using St4i.EngineApi;
using St4i.EngineApi.Config;
using St4i.EngineApi.Endpoints;
using St4i.EngineApi.Fleet;
using St4i.EngineApi.Hubs;

// Task 3 — St4i.EngineApi: a thin ASP.NET host wrapping the SAME EdgeCore engine the WPF exhibition
// app drives (SimulatedDriver/ScenarioAwareDriver/EdgePipeline/SwitchableTransport/TransportCoordinator
// — the 4 WPF-independent classes this task relocated INTO EdgeCore so both apps share them
// byte-for-byte), exposed over HTTP + WebSocket so the new web UI (Tasks 4-7) can drive the fleet. No
// Go/Rust rewrite — see task-3-report.md for the full write-up.
var builder = WebApplication.CreateBuilder(args);

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
    options.AddPolicy(CorsPolicy, policy => policy
        .WithOrigins("http://localhost:5173", "tauri://localhost")
        .AllowAnyHeader()
        .AllowAnyMethod());
});

// ── EdgeCore composition root — mirrors the WPF app's App.xaml.cs ConfigureServices Live/Demo/Auto
// transport-mode wiring byte-for-byte (now possible because SwitchableTransport/TransportCoordinator
// live in EdgeCore, not the WPF project). DEFAULT MODE IS DEMO — bulletproof offline out of the box,
// per the Task 3 brief.
builder.Services.AddSingleton<EventBus>();
builder.Services.AddSingleton<DemoTransport>();
builder.Services.AddSingleton(_ => LiveTransport.ForMachine(
    serverUrl: FleetHost.DefaultServerUrl,
    mkKey: string.Empty,
    machineCode: FleetHost.DefaultMachineCode,
    queuePath: null,
    verifyTls: true));
builder.Services.AddSingleton(sp => new AutoTransport(sp.GetRequiredService<LiveTransport>(), sp.GetRequiredService<DemoTransport>()));
builder.Services.AddSingleton(sp => new SwitchableTransport(sp.GetRequiredService<DemoTransport>()));
builder.Services.AddSingleton<ITransport>(sp => sp.GetRequiredService<SwitchableTransport>());
builder.Services.AddSingleton(sp => new TransportCoordinator(
    sp.GetRequiredService<SwitchableTransport>(),
    sp.GetRequiredService<DemoTransport>(),
    sp.GetRequiredService<LiveTransport>(),
    sp.GetRequiredService<AutoTransport>(),
    TransportMode.Demo));

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

var app = builder.Build();

// Task 9 — serve the built web UI (`web/dist`, copied into `wwwroot/` at build time — see the
// St4i.EngineApi.csproj Content item) from this SAME host as the API/WebSocket, so a single process +
// single port is the whole standalone offline app (no separate static file server, no CORS needed for
// same-origin requests). `UseDefaultFiles` resolves `/` → `index.html`; `UseStaticFiles` serves the
// hashed JS/CSS/asset files vite emitted; `MapFallbackToFile` (registered after the API endpoints below,
// lowest routing priority) sends any other GET that doesn't match an API route or a real static file to
// `index.html` too, so the SPA's client-side router (wouter) handles deep links / refreshes on routes
// like `/machines/aoi-01` instead of 404ing. Harmless no-op in dev (`wwwroot` doesn't exist there — Vite
// serves the UI on :5173 instead, per Task 3/9's dev-mode split).
app.UseDefaultFiles();
app.UseStaticFiles();

app.UseCors(CorsPolicy);
app.UseWebSockets();

app.MapFleetEndpoints();
app.MapModeEndpoints();
app.MapScenarioEndpoints();
app.MapSettingsEndpoints();
app.MapOnboardingEndpoints();
app.MapConfigEndpoints();
app.MapInspectorStream();

app.MapFallbackToFile("index.html");

// Force-touch FleetHost now (rather than lazily on the first request) so its fleet.json/default-roster
// resolution — and any FleetConfigException it might swallow — happens at startup, where a log line is
// actually useful, not silently on whichever request happens to hit it first.
var fleetHost = app.Services.GetRequiredService<FleetHost>();
app.Logger.LogInformation(
    "St4i.EngineApi ready — {Count} machine(s) in the fleet roster: {Codes} (mode={Mode})",
    fleetHost.Fleet.Count,
    string.Join(", ", fleetHost.Fleet.Select(d => d.Code)),
    fleetHost.Mode);

app.Run();
