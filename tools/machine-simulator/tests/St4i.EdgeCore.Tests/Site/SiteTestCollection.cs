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
/// collection was added. Serializing just THIS task's own 4 test classes against each other removes a
/// meaningful chunk of that added peak load with zero change to any pre-existing file.</para>
/// </summary>
[CollectionDefinition("St4i.EdgeCore.Tests.Site", DisableParallelization = true)]
public sealed class SiteTestCollection
{
}
