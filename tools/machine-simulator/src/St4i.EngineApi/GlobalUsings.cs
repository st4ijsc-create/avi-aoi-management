// 🔴 Task E-2 (docs/plans/2026-08-04-dotE-fleet-core-extraction-blueprint.md) — one line, so a move does
// not become a rename.
//
// The N-driver lifecycle core moved from St4i.EngineApi.Fleet to St4i.EdgeCore.Fleet: FleetCore (was
// FleetHost's whole body), ConnectorRegistry + ConnectorBinding, MachineState, SafetySnapshot,
// DriverHealthSnapshot and MachineDriverAvailability. Those six names are referenced by simple name from
// ~19 files in this project and ~39 test files; a per-file `using` would have put a one-line diff on every
// one of them and buried the real change. A single global namespace import is the smallest honest
// mechanism: it is a plain `using`, not a type ALIAS, so nothing here disguises where a type now lives —
// go-to-definition still lands in St4i.EdgeCore/Fleet/, and a name collision between the two namespaces
// would be a compile error rather than a silent resolution (there is none: every one of the six names
// LEFT St4i.EngineApi.Fleet, none was duplicated).
global using St4i.EdgeCore.Fleet;
