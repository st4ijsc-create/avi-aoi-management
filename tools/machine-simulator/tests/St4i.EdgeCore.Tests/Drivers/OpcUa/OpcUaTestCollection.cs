using Xunit;

namespace St4i.EdgeCore.Tests.Drivers.OpcUa;

/// <summary>
/// GĐ3 sub-3 OU-1 — groups every test class under <c>tests/.../Drivers/OpcUa/</c> that stands up a real
/// in-process OPC-UA server/session into ONE xunit collection so they run SEQUENTIALLY relative to each
/// other (still in parallel with the rest of the suite, per-class default), mirroring
/// <c>St4i.EdgeCore.Tests.Site.SiteTestCollection</c>'s exact reasoning: a loopback OPC-UA session is
/// socket + certificate-store heavy (dynamic TCP listener, app-instance cert check/creation against a
/// shared pki directory, a real service-level handshake) — running several of these AT ONCE, on top of the
/// rest of the suite's own real-socket tests (Modbus's loopback slave, MQTT, Site's mDNS/mTLS), is exactly
/// the kind of peak concurrent load that has previously flipped an otherwise-reliable, unrelated test
/// flaky under CI load (see SiteTestCollection's own doc comment for the precedent). Serializing just this
/// task's own test classes against each other removes that risk with zero change to any pre-existing file.
/// </summary>
[CollectionDefinition("St4i.EdgeCore.Tests.OpcUa", DisableParallelization = true)]
public sealed class OpcUaTestCollection
{
}
