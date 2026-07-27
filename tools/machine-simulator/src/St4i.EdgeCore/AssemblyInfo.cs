using System.Runtime.CompilerServices;

// GĐ3 sub-2 SD-1 (task-1-brief.md) — lets St4i.EdgeCore.Tests reach SiteDiscovery's internal
// `CollectFromMessages` seam, so the PTR/SRV/TXT/A correlation + dedup logic has a pure unit test that
// feeds synthetic Makaretu.Dns records (no real multicast socket) alongside the real loopback
// advertise->browse integration test — see SiteDiscoveryTests' own doc comment. Same "one narrow,
// documented test seam, not a wildcard" scoping as St4i.EngineApi/AssemblyInfo.cs's own precedent.
[assembly: InternalsVisibleTo("St4i.EdgeCore.Tests")]
