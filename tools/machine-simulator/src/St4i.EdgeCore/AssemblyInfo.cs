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
