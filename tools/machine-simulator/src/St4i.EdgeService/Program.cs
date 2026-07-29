using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using St4i.EdgeService;

// Task 21 — headless composition root: a plain Microsoft.Extensions.Hosting Generic Host running
// EdgeWorker (a BackgroundService) that drives the SAME EdgeCore driver→normalize→transport pipeline
// the WPF app's FleetService drives, with no UI at all. Proves EdgeCore can run as unattended
// production middleware (e.g. a Windows service), not just behind the exhibition kiosk.
//
// Args (both optional):
//   --smoke <N>     bounded run: stop the host after exactly N EdgePipeline.Committed events, exit 0.
//   --fleet <path>  load the fleet roster from a fleet.json-shaped file via FleetConfig.Load instead
//                    of EdgeWorker's small in-code default roster (silently falls back to the default
//                    if the path doesn't exist — see EdgeWorker.LoadFleet).
var options = ParseArgs(args);

var builder = Host.CreateApplicationBuilder(args);
builder.Services.AddSingleton(options);
// SM-1b (.superpowers/sdd/2026-07-29-dotA-single-machine-sellable-blueprint/task-1b-brief.md) — the SAME
// resolved demo/product gate (raw ST4I_DEMO_ENABLED env var + EdgeWorker.ResolveGate's existing --smoke
// CI-path default) now decides BOTH the transport (EdgeWorker.BuildLiveOrDemoTransport) AND the fleet
// source (EdgeWorker.LoadFleet) — resolved exactly once, here, so the two can never disagree for a
// single run. A bare `--smoke N` CI run (README §9, no env var set) keeps getting the demo fleet + Demo
// transport it always has; a real product deployment (env var absent, no --smoke) never fabricates one.
builder.Services.AddSingleton(EdgeWorker.ResolveGate(
    options.SmokeCount, Environment.GetEnvironmentVariable(TransportModeGate.EnvVarName)));
builder.Services.AddHostedService<EdgeWorker>();

using var host = builder.Build();

// A normal Generic Host: with no --smoke, this simply runs until externally cancelled (Ctrl-C /
// service stop signal) and RunAsync returns once shutdown completes — no bespoke lifetime handling
// needed beyond what EdgeWorker.ExecuteAsync already does with the stoppingToken it's given.
await host.RunAsync();

// SM-1b — a --smoke run against an empty product roster sets Environment.ExitCode to a non-zero value
// (EdgeWorker.SmokeEmptyRosterExitCode) before asking the host to stop, rather than hanging or reporting
// a false pass — see EdgeWorker.ExecuteAsync's empty-roster branch. Every other path never touches
// Environment.ExitCode, which defaults to 0, so this is byte-identical to the old hardcoded `return 0`
// for every case except that new one.
return Environment.ExitCode;

static EdgeServiceOptions ParseArgs(string[] args)
{
    int? smoke = null;
    string? fleet = null;

    for (var i = 0; i < args.Length; i++)
    {
        if (string.Equals(args[i], "--smoke", StringComparison.OrdinalIgnoreCase))
        {
            if (i + 1 < args.Length && int.TryParse(args[i + 1], out var n) && n > 0)
            {
                smoke = n;
                i++;
            }
        }
        else if (string.Equals(args[i], "--fleet", StringComparison.OrdinalIgnoreCase))
        {
            if (i + 1 < args.Length)
            {
                fleet = args[i + 1];
                i++;
            }
        }
    }

    return new EdgeServiceOptions(smoke, fleet);
}
