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
}
