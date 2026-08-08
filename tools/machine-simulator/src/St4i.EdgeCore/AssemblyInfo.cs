// GĐ3 closeout WI-1 Part A (.superpowers/sdd/2026-07-28-giaidoan3-ws-i-closeout-blueprint/task-1-brief.md)
// removed this file's only InternalsVisibleTo("St4i.EdgeCore.Tests") entry: it existed solely so
// St4i.EdgeCore.Tests could reach SiteDiscovery's internal `CollectFromMessages` seam, and SiteDiscovery
// (plus its test) moved to St4i.EngineApi/St4i.EngineApi.Tests in this same task (see SiteDiscovery.cs's
// own doc comment for why). No other internal member of this assembly is consumed cross-assembly by
// St4i.EdgeCore.Tests, so this file is intentionally left with no InternalsVisibleTo at all.
//
// SM-1b fix round 1 (.superpowers/sdd/2026-07-29-dotA-single-machine-sellable-blueprint/task-1b-brief.md,
// review) — St4i.EdgeCore.Config.DemoModeGate moved here from St4i.EngineApi.Config, collapsing two of
// the three env-var-gate duplicates the codebase had accumulated (see that class's own doc comment for
// the full history). Its explicit-raw-value ctor is `public` (not `internal`) specifically so this stays
// true: St4i.EdgeService.EdgeWorker.ResolveGate is a genuine PRODUCTION caller of that ctor, not just a
// test — granting a PEER PRODUCTION assembly InternalsVisibleTo access for a non-test reason would be the
// wrong tool here, so no new InternalsVisibleTo entry was added for it (or for the three test projects
// that also now construct DemoModeGate directly through the same public ctor).
//
// 🔴 Task E-2 (docs/plans/2026-08-04-dotE-fleet-core-extraction-blueprint.md) — the entry below is the first
// InternalsVisibleTo this assembly has carried since the note above was written, and it IS to a peer
// production assembly. Stating the reasoning rather than quietly contradicting the paragraph above:
//
//   WHAT NEEDS THEM. FleetCore carries three seams that were `internal` on FleetHost before the move and
//   must stay reachable: DriverDecoratorForTests, AdditionalPipelinesForTests (60 references across 11 test
//   files — they are how FleetHostConnectorInstanceRoutingTests reaches the AmbiguousDriver state at all,
//   i.e. how blueprint §5's "AmbiguousDriver is structurally unreachable" invariant is PROVED), and
//   ResolveFleet (the malformed-fleet.json branch). E-1 §5.1 predicted exactly this break: EngineApi's own
//   `InternalsVisibleTo("St4i.EngineApi.Tests")` stops reaching them the moment the core changes assembly.
//
//   WHY NOT JUST MAKE THEM PUBLIC. That is the alternative the note above would prefer, and it is the
//   STRICTLY WIDER one: public on St4i.EdgeCore exposes three test-only seams to St4i.EdgeService, the WPF
//   app, and every future host — including E-3's, which is the one host that must NOT be handed a way to
//   inject pipeline slots. Two scoped InternalsVisibleTo entries keep the seams invisible to all of them.
//   The DemoModeGate case is genuinely different: there, a PUBLIC ctor already existed and served a real
//   production caller, so InternalsVisibleTo would have been a shortcut around an API that was already
//   right. Here there is no public API to reach for, and creating one would widen access rather than
//   narrow it.
//
//   WHY St4i.EngineApi AND WHY THAT IS THE WHOLE LIST. FleetHost forwards the three seams (it is a shell
//   over FleetCore), so the shell itself has to see them; the tests then reach them through FleetHost's own
//   `internal` forwarders exactly as before, covered by St4i.EngineApi's own existing
//   InternalsVisibleTo("St4i.EngineApi.Tests"). So ONE entry is sufficient and a second one to the test
//   assembly was written here, found to be reachable by nothing, and deleted — an unused IVT is the same
//   speculative widening this file argues against, just harder to notice.
using System.Runtime.CompilerServices;

[assembly: InternalsVisibleTo("St4i.EngineApi")]
