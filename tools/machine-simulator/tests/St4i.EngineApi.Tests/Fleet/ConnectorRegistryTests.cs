using System.Diagnostics.CodeAnalysis;
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

        public bool TryCreate(string config, [NotNullWhen(true)] out IDeviceDriver? driver, [NotNullWhen(false)] out string? error)
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

    /// <summary>🔴 <b>THE ITEM 47 WITNESS — and it is a REPLACEMENT of an assertion, not an addition beside
    /// one.</b> This method used to be
    /// <c>Register_CalledTwiceForTheSameId_ReplacesThePreviousEntry</c>, and it read: register two different
    /// factories under one defaulted key, then <c>Assert.Same(secondDriver, driver)</c>. That assertion
    /// PINNED the defect — the silent retirement item 47 is about — so under the owner's ruling of
    /// 2026-08-23 it could not merely be joined by a new test; it had to stop being true. It is quoted here
    /// rather than deleted, the way this repository retires any published claim.
    ///
    /// <para><b>It goes red on the pre-fix tree.</b> Measured, not assumed: reverting the single
    /// <c>keyWasDefaulted</c> block in <see cref="ConnectorRegistry.Register"/> makes
    /// <c>Assert.Throws</c> fail with "no exception was thrown", and restoring it makes it pass. The control
    /// pair is recorded in the task report.</para>
    ///
    /// <para><b>What it does NOT measure.</b> It does not reach either shipped composition root — see
    /// <see cref="ConnectorRegistry.Register"/>'s own "what this check does not measure" paragraph for the
    /// measurement that says no shipped wiring can reach this throw today. It says nothing about two
    /// registrations under the same EXPLICIT id (those still replace; the sibling test below pins that), and
    /// nothing about whether the surviving connector was the RIGHT one — the whole point is that the question
    /// is no longer asked.</para></summary>
    [Fact]
    public void TwoDefaultKeyedRegistrations_ThrowNamingBothConnectors_RatherThanSilentlyRetiringOne()
    {
        var registry = new ConnectorRegistry();
        var firstDriver = new FakeDriver();
        var secondDriver = new FakeDriver();

        registry.Register(new FakeFactory("vendor.acme.widget", _ => (true, firstDriver, null)), config: "first");

        var ex = Assert.Throws<InvalidOperationException>(() =>
            registry.Register(new FakeFactory("vendor.acme.widget", _ => (true, secondDriver, null)), config: "second"));

        // "nêu tên CẢ HAI" — both sides have to be in the message, or an operator reading a startup crash
        // learns only that something collided.
        Assert.Contains("vendor.acme.widget", ex.Message, StringComparison.Ordinal);
        Assert.Contains("INCUMBENT", ex.Message, StringComparison.Ordinal);
        Assert.Contains("REJECTED", ex.Message, StringComparison.Ordinal);
        Assert.Contains(typeof(FakeFactory).FullName!, ex.Message, StringComparison.Ordinal);
        Assert.Contains("item 47", ex.Message, StringComparison.Ordinal);

        // NOTHING was mutated: the incumbent is still the one that answers, so a caller that catches this
        // exception is left with a consistent registry rather than a half-applied one.
        Assert.Single(registry.RegisteredIds);
        Assert.True(registry.TryCreateDriver("vendor.acme.widget", out var driver, out _));
        Assert.Same(firstDriver, driver);
    }

    /// <summary>🔴 Item 47's other half, and it is the GUARD rather than the witness: it was green before the
    /// fix and is green after it. An EXPLICITLY NAMED id still replaces, because naming an id is the caller
    /// saying which connector it means — <c>ConnectorEndpoints</c>' upsert,
    /// <c>RtuBusConfiguration.TryRegisterAll</c> and <c>ModbusMultidropRegistration.RegisterAll</c> all rest
    /// on that, and the ruling was about the key nobody chose.</summary>
    [Fact]
    public void ANamedInstanceId_StillReplaces_BecauseTheCallerSaidWhichConnectorItMeant()
    {
        var registry = new ConnectorRegistry();
        var firstDriver = new FakeDriver();
        var secondDriver = new FakeDriver();

        registry.Register(
            new FakeFactory("vendor.acme.widget", _ => (true, firstDriver, null)), "first", instanceId: "line-a");
        registry.Register(
            new FakeFactory("vendor.acme.widget", _ => (true, secondDriver, null)), "second", instanceId: "line-a");

        Assert.Equal(new[] { "line-a" }, registry.RegisteredIds);
        Assert.True(registry.TryCreateDriver("line-a", out var driver, out _));
        Assert.Same(secondDriver, driver);
    }

    /// <summary>🔴 <b>Item 47's SUBJECT, measured on the real factory types rather than restated as prose —
    /// and the POPULATION IS LISTED BEFORE IT IS COUNTED.</b> The list comes from the assembly, not from this
    /// file: every non-abstract <see cref="IConnectorFactory"/> implementation <c>St4i.EdgeCore</c> ships. If
    /// a fourth arrives, or if a future task splits <c>modbus</c> into two ids, this goes red and whoever did
    /// it has to come back and read the ruling.
    ///
    /// <para><b>What it does NOT measure:</b> nothing about WIRING. It never touches a composition root, so
    /// it cannot tell you whether any host actually registers two of these with a defaulted key — see
    /// <see cref="ConnectorRegistry.Register"/>'s own remarks for that measurement, which says no shipped host
    /// does. It also ignores test doubles and any third-party factory, which live in other assemblies.</para></summary>
    [Fact]
    public void TheEdgeCoreConnectorFactories_AreThree_AndTheTwoModbusOnesShareOneDefaultKey()
    {
        var factoryTypes = typeof(ConnectorRegistry).Assembly
            .GetTypes()
            .Where(t => typeof(IConnectorFactory).IsAssignableFrom(t) && t is { IsAbstract: false, IsInterface: false })
            .Select(t => t.FullName!)
            .OrderBy(n => n, StringComparer.Ordinal)
            .ToArray();

        Assert.Equal(
            new[]
            {
                "St4i.EdgeCore.Drivers.Modbus.ModbusConnectorFactory",
                "St4i.EdgeCore.Drivers.Modbus.ModbusRtuConnectorFactory",
                "St4i.EdgeCore.Drivers.OpcUa.OpcUaConnectorFactory",
            },
            factoryTypes);

        var tcp = new St4i.EdgeCore.Drivers.Modbus.ModbusConnectorFactory(new St4i.EdgeCore.Drivers.Modbus.ModbusOptions());
        var rtu = new St4i.EdgeCore.Drivers.Modbus.ModbusRtuConnectorFactory(
            busKey: "COM9:19200:8E1",
            openLink: _ => throw new NotSupportedException("this test never opens a link"),
            busRegistry: new St4i.EdgeCore.Drivers.Modbus.ModbusBusRegistry());

        // The collision itself: two DIFFERENT factory types, one Kind, therefore one default key.
        Assert.Equal(DriverKinds.Modbus, tcp.Kind);
        Assert.Equal(DriverKinds.Modbus, rtu.Kind);
        Assert.NotSame(tcp.GetType(), rtu.GetType());

        // And what that used to do, driven through the real registry rather than argued about.
        var registry = new ConnectorRegistry();
        Assert.True(registry.Register(tcp, "{}"));

        var ex = Assert.Throws<InvalidOperationException>(() => registry.Register(rtu, "{}"));
        Assert.Contains("ModbusConnectorFactory", ex.Message, StringComparison.Ordinal);
        Assert.Contains("ModbusRtuConnectorFactory", ex.Message, StringComparison.Ordinal);
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
        // request, so a host asking for a fresh driver on every restart (FleetCore.StartLocked) gets
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
    public void Register_ValidFactory_ReturnsTrue()
    {
        var registry = new ConnectorRegistry();
        var ok = registry.Register(new FakeFactory("vendor.acme.widget", _ => (true, new FakeDriver(), null)), "{}");

        Assert.True(ok);
        Assert.Contains("vendor.acme.widget", registry.RegisteredIds);
    }

    [Fact]
    public void Register_NullFactory_Throws()
    {
        // Distinct from a bad Kind getter below: this is the HOST's own code passing a literal null — an
        // ordinary local-caller bug, not something a vendor's IConnectorFactory implementation can trigger
        // — so it still throws, same as any other .NET API's ArgumentNullException.ThrowIfNull.
        var registry = new ConnectorRegistry();
        Assert.Throws<ArgumentNullException>(() => registry.Register(null!, "{}"));
    }

    [Theory]
    [InlineData("")]
    [InlineData("   ")]
    public void Register_BlankKind_ReturnsFalse_DoesNotRegisterAnything_DoesNotThrow(string blankKind)
    {
        // Review finding (fix round 1): Register used to throw ArgumentException here — reading a
        // vendor-implemented Kind getter's RESULT and rejecting it is still fine to report loudly, but the
        // shape must be non-throwing (a bool return), because this method is called from inside
        // Program.cs's DI singleton lambda: an uncaught exception here would fault
        // GetRequiredService<FleetHost>() into a startup crash, not a disabled connector.
        var registry = new ConnectorRegistry();
        var factory = new FakeFactory(blankKind, _ => (true, new FakeDriver(), null));

        var exception = Record.Exception(() =>
        {
            var ok = registry.Register(factory, "{}");
            Assert.False(ok);
        });

        Assert.Null(exception);
        Assert.Empty(registry.RegisteredIds);
    }

    [Fact]
    public void Register_KindGetterThrows_ReturnsFalse_DoesNotRegisterAnything_DoesNotPropagate()
    {
        // The load-bearing case: Kind is a vendor-implemented property getter, read here with no guard in
        // the original version of this method. A throwing Kind getter must not propagate out of Register —
        // production calls this from inside a DI singleton lambda, so an uncaught exception here would
        // fault GetRequiredService<FleetHost>() into a startup crash. Not reachable via env vars today
        // (both built-in factories' Kind getters are trivial constant returns), but GP-5's connectors.json
        // makes a vendor-supplied factory reachable here.
        var registry = new ConnectorRegistry();
        var factory = new ThrowingKindFactory();

        var exception = Record.Exception(() =>
        {
            var ok = registry.Register(factory, "{}");
            Assert.False(ok);
        });

        Assert.Null(exception);
        Assert.Empty(registry.RegisteredIds);
    }

    private sealed class ThrowingKindFactory : IConnectorFactory
    {
        public string Kind => throw new InvalidOperationException("ThrowingKindFactory: simulated vendor bug (test double) — Kind must never do this.");

        public bool TryCreate(string config, [NotNullWhen(true)] out IDeviceDriver? driver, [NotNullWhen(false)] out string? error)
        {
            driver = null;
            error = "unreachable — Kind already threw";
            return false;
        }
    }

    // ─────────────────────────────────────────────────────────────────────
    // 🔴 Task D-1 (.superpowers/sdd/2026-08-02-dotD-modbus-rtu-blueprint/task-1-brief.md) — connector
    // identity: from "the protocol kind" to "this instance". These are the unit-level half; the routing
    // half (a write for machine B reaching B's driver and only B's) is
    // FleetHostConnectorInstanceRoutingTests.
    // ─────────────────────────────────────────────────────────────────────

    [Fact]
    public void TwoInstancesOfTheSameKind_CoexistUnderDistinctIds_AndEachBuildsItsOwnDriver()
    {
        // The single fact this whole task exists to make true, at its smallest: before D-1 the SECOND of
        // these two calls silently replaced the first (Register keyed on IConnectorFactory.Kind, and both
        // factories report DriverKinds.Modbus), so RegisteredIds held ONE entry and driverA was
        // unreachable — which is why RS-485 multidrop could not be expressed at all.
        var driverA = new FakeDriver();
        var driverB = new FakeDriver();
        var registry = new ConnectorRegistry();

        Assert.True(registry.Register(
            new FakeFactory(DriverKinds.Modbus, _ => (true, driverA, null)), "config-a",
            instanceId: "modbus-line-a", machineCode: "MB-A"));
        Assert.True(registry.Register(
            new FakeFactory(DriverKinds.Modbus, _ => (true, driverB, null)), "config-b",
            instanceId: "modbus-line-b", machineCode: "MB-B"));

        Assert.Equal(2, registry.RegisteredIds.Count);
        Assert.Contains("modbus-line-a", registry.RegisteredIds);
        Assert.Contains("modbus-line-b", registry.RegisteredIds);

        // Both report the SAME protocol kind while being two distinct instances — the separation of
        // identity from protocol is the whole change.
        Assert.Equal(DriverKinds.Modbus, registry.KindOf("modbus-line-a"));
        Assert.Equal(DriverKinds.Modbus, registry.KindOf("modbus-line-b"));

        Assert.True(registry.TryCreateDriver("modbus-line-a", out var builtA, out _));
        Assert.True(registry.TryCreateDriver("modbus-line-b", out var builtB, out _));
        Assert.Same(driverA, builtA);
        Assert.Same(driverB, builtB);
        Assert.NotSame(builtA, builtB);
    }

    [Fact]
    public void OmittingTheInstanceId_KeysOnTheFactorysKind_ByteIdenticalToNamingItExplicitly()
    {
        // The compatibility guarantee the whole migration story rests on: "no instance id" means "the kind",
        // both in this registry and in ConnectorConfigStore's migration v4. If these two ever diverged, an
        // upgraded install's persisted row (instance_id = kind) would not find the factory Program.cs
        // registered for it, and the connector would simply stop existing after an upgrade.
        var implicitRegistry = new ConnectorRegistry();
        var explicitRegistry = new ConnectorRegistry();

        implicitRegistry.Register(new FakeFactory(DriverKinds.Modbus, _ => (true, new FakeDriver(), null)), "{}");
        explicitRegistry.Register(
            new FakeFactory(DriverKinds.Modbus, _ => (true, new FakeDriver(), null)), "{}",
            instanceId: DriverKinds.Modbus);

        Assert.Equal(implicitRegistry.RegisteredIds, explicitRegistry.RegisteredIds);
        Assert.Equal(new[] { DriverKinds.Modbus }, implicitRegistry.RegisteredIds);
    }

    [Fact]
    public void InstanceId_IsNormalizedTheSameWayEveryOtherIdIs_SoACasingVariantOfABuiltInIsNotASecondEntry()
    {
        // DriverKinds.Normalize is applied to the instance id too, not just to the factory's Kind — so an
        // operator who types "modbus" as an instance id gets the ONE built-in Modbus entry rather than a
        // second, shadow connector that would collide with it at the slot-label level.
        var registry = new ConnectorRegistry();

        registry.Register(new FakeFactory(DriverKinds.Modbus, _ => (true, new FakeDriver(), null)), "a", instanceId: "modbus");
        registry.Register(new FakeFactory(DriverKinds.Modbus, _ => (true, new FakeDriver(), null)), "b", instanceId: "MODBUS");

        Assert.Equal(new[] { DriverKinds.Modbus }, registry.RegisteredIds);
    }

    [Fact]
    public void BlankInstanceId_FallsBackToTheKind_RatherThanKeyingOnAnEmptyString()
    {
        var registry = new ConnectorRegistry();

        Assert.True(registry.Register(
            new FakeFactory(DriverKinds.OpcUa, _ => (true, new FakeDriver(), null)), "{}", instanceId: "   "));

        Assert.Equal(new[] { DriverKinds.OpcUa }, registry.RegisteredIds);
    }

    // ─────────────────────────────────────────────────────────────────────
    // 🔴 The machine-code claim — the structural gate that makes
    // MachineDriverAvailability.AmbiguousDriver unreachable through this registry.
    // ─────────────────────────────────────────────────────────────────────

    [Fact]
    public void ASecondInstanceClaimingAnAlreadyClaimedMachineCode_IsRefused_AndNothingIsMutated()
    {
        var incumbentDriver = new FakeDriver();
        var usurperDriver = new FakeDriver();
        var registry = new ConnectorRegistry();

        Assert.True(registry.Register(
            new FakeFactory(DriverKinds.Modbus, _ => (true, incumbentDriver, null)), "incumbent-config",
            instanceId: "modbus-line-a", machineCode: "MB-SHARED"));

        // A DIFFERENT instance naming the SAME machine. Refused — two live connectors driving one machine
        // is precisely the state a write cannot be resolved in, and refusing the registration is what makes
        // it unconstructible rather than merely detected-and-refused-later.
        Assert.False(registry.Register(
            new FakeFactory(DriverKinds.Modbus, _ => (true, usurperDriver, null)), "usurper-config",
            instanceId: "modbus-line-b", machineCode: "MB-SHARED"));

        // Nothing mutated: the incumbent still owns the claim, the loser is not in the registry at all, and
        // the incumbent's own config was not overwritten by the rejected one.
        Assert.Equal(new[] { "modbus-line-a" }, registry.RegisteredIds);
        Assert.True(registry.TryGetInstanceIdForMachine("MB-SHARED", out var claimant));
        Assert.Equal("modbus-line-a", claimant);
        Assert.True(registry.TryCreateDriver("modbus-line-a", out var built, out _));
        Assert.Same(incumbentDriver, built);
        Assert.False(registry.TryCreateDriver("modbus-line-b", out _, out _));
    }

    [Fact]
    public void AClaimThatDiffersOnlyByCasing_IsStillTheSameClaim_AndIsStillRefused()
    {
        // Every machine-code comparison in this codebase is ordinal-ignore-case (FleetHost.RegisterMachine's
        // duplicate guard, ResolveWritableDriver's roster lookup, ConnectorEndpoints' collision checks). A
        // case-sensitive claim check here would have let "mb-shared" slip past "MB-SHARED" and reintroduce
        // exactly the two-connectors-one-machine ambiguity this gate exists to prevent.
        var registry = new ConnectorRegistry();

        Assert.True(registry.Register(
            new FakeFactory(DriverKinds.Modbus, _ => (true, new FakeDriver(), null)), "a",
            instanceId: "modbus-line-a", machineCode: "MB-SHARED"));
        Assert.False(registry.Register(
            new FakeFactory(DriverKinds.Modbus, _ => (true, new FakeDriver(), null)), "b",
            instanceId: "modbus-line-b", machineCode: "mb-shared"));

        Assert.True(registry.TryGetInstanceIdForMachine("Mb-Shared", out var claimant));
        Assert.Equal("modbus-line-a", claimant);
    }

    [Fact]
    public void ReRegisteringTheSameInstance_KeepsItsOwnClaim_SoAnOrdinaryReconfigureStillWorks()
    {
        // The claim gate must reject only OTHER instances. A connector being reconfigured (POST
        // /v1/connectors for a connector that already exists, or a restart re-registering the same row) is
        // the ordinary case and must not be refused by its own prior claim.
        var secondDriver = new FakeDriver();
        var registry = new ConnectorRegistry();

        Assert.True(registry.Register(
            new FakeFactory(DriverKinds.Modbus, _ => (true, new FakeDriver(), null)), "v1",
            instanceId: "modbus-line-a", machineCode: "MB-A"));
        Assert.True(registry.Register(
            new FakeFactory(DriverKinds.Modbus, _ => (true, secondDriver, null)), "v2",
            instanceId: "modbus-line-a", machineCode: "MB-A"));

        Assert.Equal(new[] { "modbus-line-a" }, registry.RegisteredIds);
        Assert.True(registry.TryCreateDriver("modbus-line-a", out var built, out _));
        Assert.Same(secondDriver, built);
    }

    [Fact]
    public void AnUnboundInstance_ClaimsNothing_AndDoesNotBlockAnyoneElsesClaim()
    {
        // Every pre-D-1 call site omits machineCode, and every one of them must keep behaving exactly as it
        // did. An unbound instance is invisible to the claim gate in BOTH directions: it blocks nobody, and
        // TryGetInstanceIdForMachine never names it (there is nothing it declared to match on).
        var registry = new ConnectorRegistry();

        Assert.True(registry.Register(new FakeFactory(DriverKinds.Modbus, _ => (true, new FakeDriver(), null)), "{}"));
        Assert.False(registry.TryGetInstanceIdForMachine("MB-A", out _));
        Assert.False(registry.IsBoundToAMachine(DriverKinds.Modbus));

        Assert.True(registry.Register(
            new FakeFactory(DriverKinds.OpcUa, _ => (true, new FakeDriver(), null)), "{}",
            instanceId: "opcua-cell-1", machineCode: "MB-A"));
        Assert.True(registry.TryGetInstanceIdForMachine("MB-A", out var claimant));
        Assert.Equal("opcua-cell-1", claimant);
        Assert.True(registry.IsBoundToAMachine("opcua-cell-1"));
    }

    [Fact]
    public void ConcurrentRegistrationsForOneMachineCode_ProduceExactlyOneWinner()
    {
        // The claim is a CROSS-ENTRY invariant, which a ConcurrentDictionary's own per-key atomicity cannot
        // supply: without ConnectorRegistry's registration lock, N threads each scan, each find no claim and
        // each write, leaving N instances all claiming one machine — the exact state the gate exists to make
        // unconstructible, reachable by timing alone. Twenty racers on a real Barrier so they genuinely
        // overlap rather than running one after another.
        var registry = new ConnectorRegistry();
        const int racers = 20;
        using var barrier = new Barrier(racers);
        var accepted = 0;

        var threads = Enumerable.Range(0, racers).Select(i => new Thread(() =>
        {
            barrier.SignalAndWait();
            if (registry.Register(
                    new FakeFactory(DriverKinds.Modbus, _ => (true, new FakeDriver(), null)), "{}",
                    instanceId: $"modbus-racer-{i}", machineCode: "MB-CONTESTED"))
            {
                Interlocked.Increment(ref accepted);
            }
        })).ToList();

        foreach (var t in threads) t.Start();
        foreach (var t in threads) Assert.True(t.Join(TimeSpan.FromSeconds(30)), "a racer thread did not finish");

        Assert.Equal(1, Volatile.Read(ref accepted));
        Assert.Single(registry.RegisteredIds);
        Assert.True(registry.TryGetInstanceIdForMachine("MB-CONTESTED", out var claimant));
        Assert.Equal(registry.RegisteredIds[0], claimant);
    }

    // ─────────────────────────────────────────────────────────────────────
    // 🔴 Task D-7a — the removal path. See ConnectorRegistry.Unregister for the design, and for why it
    // performs no I/O and disposes nothing.
    // ─────────────────────────────────────────────────────────────────────

    /// <summary>
    /// 🔴 <b>The whole point of the removal path: a machine code is FREE afterwards.</b>
    ///
    /// <para><see cref="ConnectorRegistry.Register"/> refuses a second claim on a machine code, and that
    /// refusal is the structural gate <c>FleetCore.ResolveWritableDriver</c> rests on. With no removal, a
    /// deleted connector's claim survived until the process restarted — the machine could then be served by
    /// nothing at all. The assertion below is deliberately NOT "Unregister returned true": that is a claim
    /// about a method. The claim that matters is about the CLAIM, and the only way to prove a claim was
    /// released is to have something else take it.</para>
    /// </summary>
    [Fact]
    public void Unregister_ReleasesTheMachineClaim_SoAnotherInstanceCanThenTakeIt()
    {
        var registry = new ConnectorRegistry();

        Assert.True(registry.Register(
            new FakeFactory(DriverKinds.Modbus, _ => (true, new FakeDriver(), null)), "{}",
            instanceId: "line1:unit4", machineCode: "MB-HANDOVER"));

        // The gate is real before the removal — otherwise the pass below proves nothing.
        Assert.False(registry.Register(
            new FakeFactory(DriverKinds.Modbus, _ => (true, new FakeDriver(), null)), "{}",
            instanceId: "replacement", machineCode: "MB-HANDOVER"));

        Assert.True(registry.Unregister("line1:unit4"));

        Assert.Empty(registry.RegisteredIds);
        Assert.False(registry.TryGetInstanceIdForMachine("MB-HANDOVER", out _));
        Assert.Null(registry.KindOf("line1:unit4"));
        Assert.False(registry.IsBoundToAMachine("line1:unit4"));
        Assert.DoesNotContain(registry.SnapshotBindings(), b => b.InstanceId == "line1:unit4");

        // 🔴 THE PROOF.
        Assert.True(registry.Register(
            new FakeFactory(DriverKinds.Modbus, _ => (true, new FakeDriver(), null)), "{}",
            instanceId: "replacement", machineCode: "MB-HANDOVER"));
        Assert.True(registry.TryGetInstanceIdForMachine("MB-HANDOVER", out var owner));
        Assert.Equal("replacement", owner);
    }

    /// <summary>An id nothing is registered under, and the two blank shapes, are ordinary
    /// <see langword="false"/> answers that mutate nothing — never a throw, because this runs on an HTTP
    /// deletion path and on a startup registration pass, and neither may be turned into a 500 by a stale
    /// id.</summary>
    [Theory]
    [InlineData("nothing-registered-here")]
    [InlineData("")]
    [InlineData("   ")]
    [InlineData(null)]
    public void Unregister_AnIdNothingIsRegisteredUnder_IsFalseAndMutatesNothing(string? instanceId)
    {
        var registry = new ConnectorRegistry();
        Assert.True(registry.Register(
            new FakeFactory(DriverKinds.Modbus, _ => (true, new FakeDriver(), null)), "{}",
            instanceId: "survivor", machineCode: "MB-SURVIVOR"));

        Assert.False(registry.Unregister(instanceId));

        Assert.Equal(new[] { "survivor" }, registry.RegisteredIds);
        Assert.True(registry.TryGetInstanceIdForMachine("MB-SURVIVOR", out _));
    }

    /// <summary>Removal folds its id through the SAME <see cref="DriverKinds.Normalize"/> every other id in
    /// this class goes through — so <c>DELETE /v1/connectors/modbus</c> removes the <c>Modbus</c> entry, and a
    /// third-party id stays byte-for-byte case-sensitive. A second casing rule here would make an id
    /// registrable but not removable, which is the worst of both.</summary>
    [Fact]
    public void Unregister_UsesTheSameIdNormalizationAsEverythingElse()
    {
        var registry = new ConnectorRegistry();

        registry.Register(new FakeFactory(DriverKinds.Modbus, _ => (true, new FakeDriver(), null)), "{}");
        Assert.True(registry.Unregister("modbus"));
        Assert.Empty(registry.RegisteredIds);

        // …and a third-party id is NOT folded: "vendor.acme.weld" must not remove "Vendor.Acme.Weld".
        registry.Register(
            new FakeFactory("Vendor.Acme.Weld", _ => (true, new FakeDriver(), null)), "{}",
            instanceId: "Vendor.Acme.Weld");
        Assert.False(registry.Unregister("vendor.acme.weld"));
        Assert.Single(registry.RegisteredIds);
        Assert.True(registry.Unregister("Vendor.Acme.Weld"));
        Assert.Empty(registry.RegisteredIds);
    }

    /// <summary>An id removed between <see cref="ConnectorRegistry.RegisteredIds"/> and
    /// <see cref="ConnectorRegistry.TryCreateDriver"/> is exactly the shape that method was already built for —
    /// <see langword="false"/> plus a descriptive error, never a throw and never a silent no-op. This is the
    /// consequence question the old "this task never removes entries" comment let nobody ask, asked.</summary>
    [Fact]
    public void ACreateForAnIdThatWasJustUnregistered_IsAVisibleFailure_NotAThrow()
    {
        var registry = new ConnectorRegistry();
        registry.Register(
            new FakeFactory(DriverKinds.Modbus, _ => (true, new FakeDriver(), null)), "{}",
            instanceId: "gone-by-then", machineCode: "MB-GONE");

        var idsAsAHostWouldHaveSnapshotted = registry.RegisteredIds;
        Assert.True(registry.Unregister("gone-by-then"));

        Assert.False(registry.TryCreateDriver(idsAsAHostWouldHaveSnapshotted[0], out var driver, out var error));
        Assert.Null(driver);
        Assert.Contains("gone-by-then", error);
    }

    // ═══════════════════════════════════════════════════════════════════════════════════════════════
    // 🔴 Task BP-1, 2026-08-24 — docs/owner-decisions.md item 63, MEASURED AND NOT EXECUTED.
    //
    // Item 63's premise is that ModbusMultidropRegistration.OwnedBySomethingElse — "refuse when the
    // incumbent under this explicit id serves a DIFFERENT machine", taken OUTSIDE _registerGate — is a
    // LOCAL mitigation for a GLOBAL property, and that ConnectorRegistry should therefore adopt it. Both
    // candidate shapes were built and priced against the full suite before this file was written:
    //
    //   * THROW on any duplicate explicit id (the literal reading of "turn a collision into an error"):
    //     ConnectorEndpoints reaches Register with an explicit id on the path its own comment calls "the
    //     ordinary idempotent-update path", so this turns every connector EDIT into a 500.
    //   * REFUSE (return false) narrowed to the latch's own rule: this reddens
    //     ConnectorEndpointsEnvSeedingSideEffectsTests.
    //     PostConnector_ForADifferentMachine_SucceedsOverwritingTheSeededRow_NoLongerFalsely409s. Task
    //     B-6 built that behaviour deliberately and that test exists to keep it.
    //
    // So ModbusMultidropRegistration REFUSES the shape ConnectorEndpoints REQUIRES, and what separates the
    // two is PROVENANCE (Seeded vs Operator) — a fact this registry does not hold. The latch is a
    // per-caller POLICY, not a global invariant with one local implementation, and it cannot be made
    // redundant here. The three tests below are the measurement, not a fix: all three are GREEN on the
    // unchanged code and are labelled that way rather than left to look like evidence of a change.
    //
    // 🔴 What they do NOT measure: reachability of the window between the latch's snapshot and its
    // Register calls, and RtuBusConfiguration.TryRegisterAll, which fans out over derived device ids with
    // no equivalent check at all. Both stay open, and both are named in item 63's record.
    // ═══════════════════════════════════════════════════════════════════════════════════════════════

    /// <summary>🔴 <b>GUARD, self-labelled: green before this task and after it, and the whole of why item
    /// 63's fix was refused.</b> An explicit id whose incumbent serves a DIFFERENT machine still replaces,
    /// and the incumbent's claim moves with it. That is the <c>POST /v1/connectors</c> behaviour task B-6
    /// deliberately created for an env-var-seeded row, read at the registry level rather than through the
    /// endpoint — so the constraint is visible to whoever next reads item 63 and reaches for the obvious
    /// fix.</summary>
    [Fact]
    public void AnExplicitId_WhoseIncumbentServesADifferentMachine_StillReplaces_AndTaskB6RequiresThat()
    {
        var registry = new ConnectorRegistry();
        var secondDriver = new FakeDriver();

        Assert.True(registry.Register(
            new FakeFactory("vendor.acme.widget", _ => (true, new FakeDriver(), null)), "first",
            instanceId: "line-a", machineCode: "M-OLD"));
        Assert.True(registry.Register(
            new FakeFactory("vendor.acme.widget", _ => (true, secondDriver, null)), "second",
            instanceId: "line-a", machineCode: "M-NEW"));

        Assert.Equal(new[] { "line-a" }, registry.RegisteredIds);
        Assert.True(registry.TryCreateDriver("line-a", out var driver, out _));
        Assert.Same(secondDriver, driver);

        // 🔴 And the claim MOVED, which is the half item 63 is right about: M-OLD is now served by nothing
        // and nothing said so. The item's remedy is refused; the consequence it names is real.
        Assert.True(registry.TryGetInstanceIdForMachine("M-NEW", out var nowServing));
        Assert.Equal("line-a", nowServing);
        Assert.False(registry.TryGetInstanceIdForMachine("M-OLD", out _));
    }

    /// <summary>🔴 <b>GUARD, self-labelled: green both sides.</b> The ordinary idempotent-update path — an
    /// operator re-saving a connector's register map under the same id for the same machine. This is what
    /// the THROW candidate would have turned into a 500.</summary>
    [Fact]
    public void AnExplicitId_WhoseIncumbentServesTheSameMachine_StillReplaces_TheIdempotentUpdatePath()
    {
        var registry = new ConnectorRegistry();
        var secondDriver = new FakeDriver();

        Assert.True(registry.Register(
            new FakeFactory("vendor.acme.widget", _ => (true, new FakeDriver(), null)), "first",
            instanceId: "line-a", machineCode: "M-SAME"));
        Assert.True(registry.Register(
            new FakeFactory("vendor.acme.widget", _ => (true, secondDriver, null)), "second",
            instanceId: "line-a", machineCode: "m-same"));

        Assert.Equal(new[] { "line-a" }, registry.RegisteredIds);
        Assert.True(registry.TryCreateDriver("line-a", out var driver, out _));
        Assert.Same(secondDriver, driver);
    }

    /// <summary>🔴 <b>The registry's answer for every incumbent shape the out-of-lock latch distinguishes
    /// — listed before counted, so "the latch is not redundant" is a reading rather than an opinion.</b>
    /// The latch answers refuse / allow / allow for different-machine / same-machine / unbound; the
    /// registry answers allow / allow / allow. They disagree on exactly one row, and that row is the one
    /// task B-6 pinned. The fourth row — an incoming registration with NO claim landing on an incumbent
    /// that holds one — is a claim-drop NEITHER instrument refuses, and it is listed here because a
    /// three-row table would have read as an exhaustive one.</summary>
    [Fact]
    public void TheRegistryAndTheOutOfLockLatch_DisagreeOnExactlyOneIncumbentShape()
    {
        // incumbent claim, incoming claim, what Register does, what OwnedBySomethingElse would say
        (string? Incumbent, string? Incoming, bool RegistryAccepts, bool LatchWouldRefuse)[] cases =
        [
            ("M-OLD", "M-NEW", true,  true),   // the one disagreement — B-6 requires the accept
            ("M-OLD", "M-OLD", true,  false),  // ordinary update      — both allow
            (null,    "M-NEW", true,  false),  // unbound incumbent    — both allow
            ("M-OLD", null,    true,  false),  // claim-drop neither refuses
        ];

        foreach (var (incumbent, incoming, registryAccepts, _) in cases)
        {
            var registry = new ConnectorRegistry();
            Assert.True(registry.Register(
                new FakeFactory("vendor.acme.widget", _ => (true, new FakeDriver(), null)), "first",
                instanceId: "line-a", machineCode: incumbent));

            var actual = registry.Register(
                new FakeFactory("vendor.acme.widget", _ => (true, new FakeDriver(), null)), "second",
                instanceId: "line-a", machineCode: incoming);

            Assert.Equal(registryAccepts, actual);
        }

        Assert.Equal(4, cases.Length);
        Assert.Equal(1, cases.Count(c => c.RegistryAccepts && c.LatchWouldRefuse));
    }
}
