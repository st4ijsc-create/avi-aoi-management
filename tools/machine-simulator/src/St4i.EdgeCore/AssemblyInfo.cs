// GĐ3 closeout WI-1 Part A (.superpowers/sdd/2026-07-28-giaidoan3-ws-i-closeout-blueprint/task-1-brief.md)
// removed this file's only InternalsVisibleTo("St4i.EdgeCore.Tests") entry: it existed solely so
// St4i.EdgeCore.Tests could reach SiteDiscovery's internal `CollectFromMessages` seam, and SiteDiscovery
// (plus its test) moved to St4i.EngineApi/St4i.EngineApi.Tests in this same task (see SiteDiscovery.cs's
// own doc comment for why). No other internal member of this assembly is consumed cross-assembly by
// St4i.EdgeCore.Tests, so this file is intentionally left with no InternalsVisibleTo at all.
