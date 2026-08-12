using Xunit;

namespace St4i.EdgeCore.Tests.Site;

/// <summary>
/// GĐ3 EC-2 — groups every test class under <c>tests/.../Site/</c> into ONE xunit collection so they run
/// SEQUENTIALLY relative to each other (still in parallel with the rest of the suite, per-class default).
///
/// <para><b>Why:</b> xunit parallelizes different test CLASSES against each other by default (each
/// unmarked class is its own implicit collection). <c>UnsBridgeTests</c> alone stands up 2 real MQTTnet
/// brokers (one with a genuine TLS + mutual-auth handshake) per <c>[Fact]</c>; left unmarked, its 4 tests
/// plus <c>SiteBridgeManagerTests</c>' background reconnect-loop tasks plus <c>SiteTrustPinTests</c>'/
/// <c>SiteLinkStoreTests</c>' own (lighter) work could all run AT ONCE, on top of the REST of the existing
/// suite's own real-socket tests (<c>MqttDriverTests</c>, <c>UnsPublisherIntegrationTests</c>,
/// <c>DeviceIdentityStoreTests</c>' own raw mTLS handshake test, ...). Empirically, that peak concurrent
/// socket/TLS/thread-pool load was enough to occasionally flip a PRE-EXISTING, otherwise-reliable test
/// (<c>DeviceIdentityStoreTests.Certificate_LoadedFromStore_CanCompleteARealMutualTlsHandshake</c>) from
/// "always green" to "flakes under load" — confirmed via repeated isolated vs. full-suite runs before this
/// collection was added. Serializing just THIS task's own test classes against each other removes a
/// meaningful chunk of that added peak load with zero change to any pre-existing file.</para>
///
/// <para><b>WI-3 review fix round 2 (cheap hardening 3):</b> <c>BridgeSpoolTests</c> joined this collection
/// too — it mutates the SAME process-wide <c>ST4I_BRIDGE_SPOOL_DIR</c>/<c>ST4I_BRIDGE_SPOOL_ENABLED</c>
/// environment variables <c>UnsBridgeSpoolTests</c> holds for the several seconds a broker-boot-and-reconnect
/// test takes, and was NOT in this collection despite that overlap — a real (not theoretical) interleaving
/// hazard this collection's own <c>DisableParallelization</c> does nothing to prevent for a class sitting
/// OUTSIDE it. <b>This is the actual guarantee to understand:</b> <c>DisableParallelization = true</c> only
/// serializes test classes that are THEMSELVES tagged into this same collection against each other — it has
/// no effect whatsoever on any other collection (including every unmarked/default-collection class in this
/// assembly), which keeps running fully in parallel with this one. Any future test class that reads or
/// writes an environment variable another class in THIS collection also touches needs to join this same
/// collection, or the same class of race recurs silently.</para>
///
/// <para>🔴 <b>Task L-1 — the membership rule is now stated by PROPERTY, and this collection's name only
/// describes where it started.</b> The rule is not "is a Site test" and not "mutates an environment
/// variable". It is: <b>a class belongs here if it PERTURBS state whose lifetime is the test PROCESS rather
/// than the test instance, or if it OBSERVES state another class in this assembly perturbs.</b> Both halves
/// are required — serializing the perturbers against each other only, while the observers keep running in
/// parallel, leaves the race alive and makes the assembly LOOK serialized.</para>
///
/// <para>The second instance, added by L-1: <b>the process-wide SQLite connection pool.</b>
/// <c>BridgeSpoolTests</c> and <c>UnsBridgeSpoolTests</c> — already here, for the env-var reason above —
/// call <c>SqliteConnection.ClearAllPools()</c>, which by its own contract clears EVERY pool in the process,
/// not just the caller's database. The three <c>SqliteHistorianStore*Tests</c> classes hold
/// <c>Microsoft.Data.Sqlite</c> connections and were in no collection at all, so they ran in parallel with
/// those calls. They join here now, because the same-collection guarantee is the only one xUnit gives:
/// classes in ONE collection never run concurrently. (<c>DisableParallelization</c> above is NOT what is
/// being relied on — see the paragraph above for what it does and does not buy.)</para>
///
/// <para><b>Two things L-1 did NOT establish, said plainly.</b> (1) It did not reproduce any failure caused
/// by this pairing, and it did not establish the disposal path inside Microsoft.Data.Sqlite that a
/// concurrent <c>ClearAllPools</c> would have to take to hurt a connection another class holds. What it
/// established is the pairing itself, by census. (2) Nothing can TEST this membership: dropping a
/// <c>[Collection]</c> attribute changes scheduling, not behaviour, so it compiles and every test still
/// passes — mutation cannot kill it and neither can the gate. The instrument is a scripted census over the
/// parsed sources plus a read of its output, and it is only as complete as its list of process-scope state
/// kinds.</para>
/// </summary>
[CollectionDefinition("St4i.EdgeCore.Tests.Site", DisableParallelization = true)]
public sealed class SiteTestCollection
{
}
