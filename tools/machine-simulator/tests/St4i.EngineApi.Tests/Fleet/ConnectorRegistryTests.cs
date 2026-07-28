using St4i.Connector.Abstractions;
using St4i.Connector.Abstractions.Models;
using St4i.EngineApi.Fleet;
using Xunit;

namespace St4i.EngineApi.Tests.Fleet;

/// <summary>
/// GP-4 (.superpowers/sdd/2026-07-28-wsg-plugin-connector-seam-blueprint/task-4-brief.md) — unit-level
/// proof of <see cref="ConnectorRegistry"/> itself, independent of <see cref="FleetHost"/> (which has its
/// own integration-level coverage in <c>FleetHostModbusSlotTests</c>/<c>FleetHostOpcUaSlotTests</c>/
/// <c>FleetHostConnectorRegistryTests</c>). Covers exactly the three things the brief calls out as design
/// decisions this class has to get right: (1) id comparison semantics reuse GP-3's
/// <see cref="DriverKinds.Normalize"/> rule verbatim, not a second casing rule; (2) an unregistered id is a
/// visible, non-throwing failure, never a silent no-op or a crash; (3) the configuration string handed to
/// <see cref="Register"/> is genuinely opaque — stored and forwarded verbatim, never inspected.
/// </summary>
public sealed class ConnectorRegistryTests
{
    private sealed class FakeFactory : IConnectorFactory
    {
        private readonly Func<string, (bool Ok, IDeviceDriver? Driver, string? Error)> _behavior;

        public FakeFactory(string kind, Func<string, (bool Ok, IDeviceDriver? Driver, string? Error)> behavior)
        {
            Kind = kind;
            _behavior = behavior;
        }

        public string Kind { get; }

        public string? LastConfigSeen { get; private set; }

        public int CallCount { get; private set; }

        public bool TryCreate(string config, out IDeviceDriver? driver, out string? error)
        {
            CallCount++;
            LastConfigSeen = config;
            var (ok, d, e) = _behavior(config);
            driver = d;
            error = e;
            return ok;
        }
    }

    private sealed class FakeDriver : IDeviceDriver
    {
        public string Id => "fake-driver";
        public string Kind => "irrelevant-for-this-test";
        public DriverHealthState Health => DriverHealthState.Connected;
        public IAsyncEnumerable<DeviceReading> ReadAsync(CancellationToken ct) => throw new NotSupportedException();
        public ValueTask DisposeAsync() => ValueTask.CompletedTask;
    }

    // ─────────────────────────────────────────────────────────────────────
    // Basic register/lookup round trip.
    // ─────────────────────────────────────────────────────────────────────

    [Fact]
    public void Register_ThenTryCreateDriver_ReturnsTheFactorysDriver()
    {
        var fakeDriver = new FakeDriver();
        var factory = new FakeFactory("vendor.acme.widget", _ => (true, fakeDriver, null));
        var registry = new ConnectorRegistry();

        registry.Register(factory, config: "{}");

        var ok = registry.TryCreateDriver("vendor.acme.widget", out var driver, out var error);

        Assert.True(ok);
        Assert.Same(fakeDriver, driver);
        Assert.Null(error);
    }

    [Fact]
    public void RegisteredIds_ReflectsEveryRegisteredConnector()
    {
        var registry = new ConnectorRegistry();
        registry.Register(new FakeFactory(DriverKinds.Modbus, _ => (true, new FakeDriver(), null)), config: "{}");
        registry.Register(new FakeFactory(DriverKinds.OpcUa, _ => (true, new FakeDriver(), null)), config: "{}");

        Assert.Equal(new[] { DriverKinds.Modbus, DriverKinds.OpcUa }, registry.RegisteredIds.OrderBy(x => x, StringComparer.Ordinal));
    }

    [Fact]
    public void Register_CalledTwiceForTheSameId_ReplacesThePreviousEntry()
    {
        var registry = new ConnectorRegistry();
        var firstDriver = new FakeDriver();
        var secondDriver = new FakeDriver();

        registry.Register(new FakeFactory("vendor.acme.widget", _ => (true, firstDriver, null)), config: "first");
        registry.Register(new FakeFactory("vendor.acme.widget", _ => (true, secondDriver, null)), config: "second");

        Assert.Single(registry.RegisteredIds);
        registry.TryCreateDriver("vendor.acme.widget", out var driver, out _);
        Assert.Same(secondDriver, driver);
    }

    // ─────────────────────────────────────────────────────────────────────
    // Id comparison semantics — reuses DriverKinds.Normalize verbatim.
    // ─────────────────────────────────────────────────────────────────────

    [Theory]
    [InlineData("modbus")]
    [InlineData("MODBUS")]
    [InlineData("Modbus")]
    [InlineData("mOdBuS")]
    public void TryCreateDriver_AnyCasingOfABuiltInId_ResolvesToTheSameRegisteredEntry(string lookupId)
    {
        // Registered under the lowercase spelling on purpose — proves normalization is applied on BOTH
        // Register and TryCreateDriver, not just one side.
        var registry = new ConnectorRegistry();
        var fakeDriver = new FakeDriver();
        registry.Register(new FakeFactory("modbus", _ => (true, fakeDriver, null)), config: "{}");

        var ok = registry.TryCreateDriver(lookupId, out var driver, out _);

        Assert.True(ok);
        Assert.Same(fakeDriver, driver);
    }

    [Fact]
    public void TryCreateDriver_DifferentCasingOfAThirdPartyId_DoesNotResolve()
    {
        // The failure mode GP-3's own casing rule specifically preserves: a third-party id is
        // case-SENSITIVE, so registering "Vendor.Acme.Weld" must NOT be found under "vendor.acme.weld" —
        // reusing DriverKinds.Normalize (rather than, say, an OrdinalIgnoreCase dictionary) is what keeps
        // this behavior identical to every other id-comparison in the codebase.
        var registry = new ConnectorRegistry();
        registry.Register(new FakeFactory("Vendor.Acme.Weld", _ => (true, new FakeDriver(), null)), config: "{}");

        var ok = registry.TryCreateDriver("vendor.acme.weld", out var driver, out var error);

        Assert.False(ok);
        Assert.Null(driver);
        Assert.NotNull(error);
    }

    // ─────────────────────────────────────────────────────────────────────
    // Unknown-id behavior — visible, non-throwing failure.
    // ─────────────────────────────────────────────────────────────────────

    [Fact]
    public void TryCreateDriver_UnregisteredId_ReturnsFalseWithADescriptiveError_NeverThrows()
    {
        var registry = new ConnectorRegistry();

        var ok = registry.TryCreateDriver("nobody-ever-registered-this-id", out var driver, out var error);

        Assert.False(ok);
        Assert.Null(driver);
        Assert.False(string.IsNullOrWhiteSpace(error));
        Assert.Contains("nobody-ever-registered-this-id", error);
    }

    [Fact]
    public void TryCreateDriver_EmptyRegistry_NeverThrows()
    {
        var registry = new ConnectorRegistry();

        var exception = Record.Exception(() => registry.TryCreateDriver("anything", out _, out _));

        Assert.Null(exception);
    }

    // ─────────────────────────────────────────────────────────────────────
    // Configuration opacity.
    // ─────────────────────────────────────────────────────────────────────

    [Fact]
    public void TryCreateDriver_ForwardsTheExactConfigStringGivenAtRegistration_Unparsed()
    {
        // Deliberately not valid JSON, not valid anything — the registry must never try to interpret it,
        // only pass it through byte-for-byte to whichever factory owns this id.
        const string opaqueConfig = "this is not json, not xml, not anything the registry should care about {{{ ] not";
        var factory = new FakeFactory("vendor.acme.widget", cfg => (true, new FakeDriver(), null));
        var registry = new ConnectorRegistry();
        registry.Register(factory, opaqueConfig);

        registry.TryCreateDriver("vendor.acme.widget", out _, out _);

        Assert.Equal(opaqueConfig, factory.LastConfigSeen);
    }

    [Fact]
    public void TryCreateDriver_CalledMultipleTimes_InvokesTheFactoryFreshEveryTime()
    {
        // A driver instance is never cached/reused by the registry — TryCreate is called anew on every
        // request, so a host asking for a fresh driver on every restart (FleetHost.StartLocked) gets
        // exactly that.
        var factory = new FakeFactory("vendor.acme.widget", _ => (true, new FakeDriver(), null));
        var registry = new ConnectorRegistry();
        registry.Register(factory, "{}");

        registry.TryCreateDriver("vendor.acme.widget", out var first, out _);
        registry.TryCreateDriver("vendor.acme.widget", out var second, out _);

        Assert.Equal(2, factory.CallCount);
        Assert.NotSame(first, second);
    }

    [Fact]
    public void TryCreateDriver_FactoryRejectsItsConfig_PropagatesFalseAndErrorVerbatim()
    {
        var registry = new ConnectorRegistry();
        registry.Register(new FakeFactory("vendor.acme.widget", _ => (false, null, "bad config: missing field 'x'")), config: "{}");

        var ok = registry.TryCreateDriver("vendor.acme.widget", out var driver, out var error);

        Assert.False(ok);
        Assert.Null(driver);
        Assert.Equal("bad config: missing field 'x'", error);
    }

    // ─────────────────────────────────────────────────────────────────────
    // Register argument validation.
    // ─────────────────────────────────────────────────────────────────────

    [Fact]
    public void Register_NullFactory_Throws()
    {
        var registry = new ConnectorRegistry();
        Assert.Throws<ArgumentNullException>(() => registry.Register(null!, "{}"));
    }

    [Theory]
    [InlineData("")]
    [InlineData("   ")]
    public void Register_BlankKind_Throws(string blankKind)
    {
        var registry = new ConnectorRegistry();
        var factory = new FakeFactory(blankKind, _ => (true, new FakeDriver(), null));
        Assert.Throws<ArgumentException>(() => registry.Register(factory, "{}"));
    }
}
