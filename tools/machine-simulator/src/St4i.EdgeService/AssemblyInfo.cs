using System.Runtime.CompilerServices;

// Task F1-2 — lets St4i.EdgeService.Tests reach this project's `internal` test-only seams
// (EdgeWorker.LoadFleet/BuildTransport/ResolveGate/SmokeEmptyRosterExitCode) without making any of them
// public API. Mirrors St4i.EngineApi's own AssemblyInfo.cs InternalsVisibleTo convention (see that
// file's remarks) — keep this attribute scoped to the one test project, not a wildcard.
//
// SM-1b fix round 1 — the gate's own `internal` raw-value ctor (formerly this project's own
// TransportModeGate, now St4i.EdgeCore.Config.DemoModeGate) no longer needs an entry HERE:
// St4i.EdgeCore's own AssemblyInfo.cs grants St4i.EdgeService.Tests that access directly.
[assembly: InternalsVisibleTo("St4i.EdgeService.Tests")]
