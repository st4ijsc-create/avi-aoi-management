using System.Runtime.CompilerServices;

// Task F1-2 — lets St4i.EdgeService.Tests reach this project's `internal` test-only seams
// (TransportModeGate's raw-value ctor, EdgeWorker.BuildTransport/ResolveGate) without making any of
// them public API. Mirrors St4i.EngineApi's own AssemblyInfo.cs InternalsVisibleTo convention (see that
// file's remarks) — keep this attribute scoped to the one test project, not a wildcard.
[assembly: InternalsVisibleTo("St4i.EdgeService.Tests")]
