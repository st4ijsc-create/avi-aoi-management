// 🔴 Task E-2 (docs/plans/2026-08-04-dotE-fleet-core-extraction-blueprint.md) — the test-side twin of
// src/St4i.EngineApi/GlobalUsings.cs; see that file for the full reasoning.
//
// Six names moved from St4i.EngineApi.Fleet to St4i.EdgeCore.Fleet (FleetCore, ConnectorRegistry +
// ConnectorBinding, MachineState, SafetySnapshot, DriverHealthSnapshot, MachineDriverAvailability). They
// are referenced by simple name from ~39 files in this project. This one namespace import is what keeps
// E-2's diff a MOVE — the gate's per-suite totals are the check that nothing else changed, and 39 files
// of `using` churn would have made that check much harder to read.
global using St4i.EdgeCore.Fleet;
