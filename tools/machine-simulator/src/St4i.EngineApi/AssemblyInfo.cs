using System.Runtime.CompilerServices;

// Completion-review #1/#7 (see FleetHost.DriverDecoratorForTests) — lets St4i.EngineApi.Tests reach the
// one `internal` test-only seam FleetHost exposes, so the restart-race identity guard can be reproduced
// deterministically instead of relying on real non-determinism. Nothing else in St4i.EngineApi is meant
// to be consumed this way; keep this attribute scoped to the one test project, not a wildcard.
[assembly: InternalsVisibleTo("St4i.EngineApi.Tests")]
