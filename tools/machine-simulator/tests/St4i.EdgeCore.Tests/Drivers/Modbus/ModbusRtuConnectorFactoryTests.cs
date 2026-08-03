using St4i.Connector.Abstractions;
using St4i.Connector.Abstractions.Models;
using St4i.EdgeCore.Drivers.Modbus;
using Xunit;

namespace St4i.EdgeCore.Tests.Drivers.Modbus;

/// <summary>
/// 🔴 Task D-7a — <b><see cref="ModbusRtuConnectorFactory"/>: the first thing in <c>src/</c> that can build a
/// <see cref="ModbusRtuDriver"/> from configuration, and the place the lease leak stops being reachable.</b>
///
/// <para>D-2…D-6 all shipped saying no operator could turn any of RTU on. This type is half of ending that
/// (the other half is <c>ConnectorsJsonRegistration</c>'s RTU arm, tested in the EngineApi suite). The claims
/// that matter here are the ones a config-driven factory makes newly reachable: N devices really do share ONE
/// bus, a device that will not construct really does not cost the operator the line, and the mitigations this
/// task built are really switched on by the path that reaches production.</para>
/// </summary>
public sealed class ModbusRtuConnectorFactoryTests
{
    private static string DeviceJson(string machineCode, int unitId, int pollIntervalMs = 20, int readTimeoutMs = 300) =>
        $$"""
        {"machineCode":"{{machineCode}}","unitId":{{unitId}},"pollIntervalMs":{{pollIntervalMs}},
         "readTimeoutMs":{{readTimeoutMs}},
         "registers":[{"address":0,"type":"Holding","dataType":"UInt16","scale":1.0,"metric":"temperature","unit":"C"}]}
        """;

    private static async Task<DeviceReading> FirstReadingAsync(IDeviceDriver driver)
    {
        using var cts = new CancellationTokenSource(TimeSpan.FromSeconds(20));
        await foreach (var reading in driver.ReadAsync(cts.Token))
        {
            return reading;
        }

        throw new InvalidOperationException("the driver produced no reading before the test's own deadline");
    }

    /// <summary>Drives a driver's poll loop until <paramref name="until"/> is satisfied or the window expires,
    /// then stops it. Returns nothing: every test below observes through a callback the driver was constructed
    /// with, not through the enumeration.</summary>
    private static async Task DriveUntilAsync(IDeviceDriver driver, Func<bool> until, TimeSpan window)
    {
        using var cts = new CancellationTokenSource();
        var pump = Task.Run(
            async () =>
            {
                try { await foreach (var _ in driver.ReadAsync(cts.Token)) { } }
                catch (OperationCanceledException) { }
            },
            CancellationToken.None);

        var deadline = DateTime.UtcNow + window;
        while (DateTime.UtcNow < deadline && !until())
        {
            await Task.Delay(10);
        }

        await cts.CancelAsync();
        try { await pump; } catch (OperationCanceledException) { }
    }

    /// <summary>The end-to-end claim: a single-device document out of a bus map becomes a driver that really
    /// reads its own slave, over a real in-process NModbus RTU slave network.</summary>
    [Fact]
    public async Task ADeviceDocument_BecomesADriverThatReadsThatSlave()
    {
        await using var bus = ModbusRtuLoopbackHarness.Start(((byte)2, new ushort[] { 237, 0 }));

        var factory = new ModbusRtuConnectorFactory(
            bus.BusKey, _ => Task.FromResult<IModbusBusLink>(bus.Links.Master), bus.Registry);

        Assert.True(factory.TryCreate(DeviceJson("RTU-FAC-A", 2), out var driver, out var error));
        Assert.Null(error);

        await using (driver!)
        {
            Assert.Equal(DriverKinds.Modbus, driver.Kind);

            var reading = await FirstReadingAsync(driver);
            Assert.Equal("RTU-FAC-A", reading.MachineCode);
            Assert.Equal(237.0, reading.Telemetry!.Single(s => s.Metric == "temperature").Value);
        }
    }

    /// <summary>
    /// 🔴 <b>N devices, ONE open.</b> This is the property the whole D-2/D-3 bus design exists for, and the
    /// factory is what makes it true in production rather than in a test's own composition: every driver this
    /// one factory builds is handed a lease on the SAME bus key, so a COM port that can only be opened once is
    /// opened once.
    /// </summary>
    [Fact]
    public async Task ThreeDevicesFromOneFactory_ShareOneBus_AndNothingIsOpenedByTryCreateAtAll()
    {
        var opens = 0;
        await using var registry = new ModbusBusRegistry();
        var pair = InMemoryBusLinkPair.Create();

        var factory = new ModbusRtuConnectorFactory(
            "modbus-rtu-tcp:one-line:4001",
            _ => { opens++; return Task.FromResult<IModbusBusLink>(pair.Master); },
            registry);

        Assert.True(factory.TryCreate(DeviceJson("RTU-SHARE-1", 1), out var one, out _));
        Assert.True(factory.TryCreate(DeviceJson("RTU-SHARE-2", 2), out var two, out _));
        Assert.True(factory.TryCreate(DeviceJson("RTU-SHARE-3", 3), out var three, out _));

        Assert.Equal(3, registry.LeaseCount(factory.BusKey));

        // Nothing has been opened at all yet — TryCreate performs no I/O, which is IConnectorFactory's own
        // contract and is what lets FleetHost.StartLocked call it while holding its gate.
        Assert.Equal(0, opens);

        // Three distinct drivers with three distinct ids — the id carries the unit precisely so a multidrop
        // slot label (and therefore an alarm TargetId) names a device rather than a line.
        Assert.Equal(3, new[] { one!.Id, two!.Id, three!.Id }.Distinct().Count());

        await one.DisposeAsync();
        await two.DisposeAsync();
        await three.DisposeAsync();
    }

    /// <summary>
    /// 🔴 <b>THE LEASE LEAK, on the path a config-driven factory made reachable.</b> A bus of eight whose
    /// seventh device declares the broadcast address must cost the operator that device and nothing else.
    /// Before D-7a the constructor assigned <c>_lease</c> and then threw, and the reference count never came
    /// back down — so the physical link lived for the process lifetime and, on serial, the COM port stayed
    /// exclusively open.
    ///
    /// <para>This is the primary mechanism: <c>ValidateRtuUnitId</c> runs BEFORE <c>Acquire</c>, so no lease is
    /// taken at all. The discriminating proof for the OTHER mechanism — that a throw after the lease is owned
    /// still hands it back — is
    /// <see cref="ADriverConstructorThrowAfterTakingTheLease_ReleasesIt_SoTheLinkIsGenuinelyReopened"/>.</para>
    /// </summary>
    [Fact]
    public async Task AnUnbuildableDevice_TakesNoLeaseAtAll_AndItsBusMatesAreUnaffected()
    {
        var opens = 0;
        await using var registry = new ModbusBusRegistry();
        var pair = InMemoryBusLinkPair.Create();

        var factory = new ModbusRtuConnectorFactory(
            "modbus-rtu-tcp:leak-line:4001",
            _ => { opens++; return Task.FromResult<IModbusBusLink>(pair.Master); },
            registry);

        Assert.True(factory.TryCreate(DeviceJson("RTU-LEAK-OK", 1), out var healthy, out _));
        Assert.NotNull(healthy);

        // unitId 0 is the Modbus BROADCAST address: a read to it can never be answered, so ModbusRtuDriver
        // refuses it — the one construction failure that actually happens in the field.
        Assert.False(factory.TryCreate(DeviceJson("RTU-LEAK-BAD", 0), out var refused, out var error));
        Assert.Null(refused);
        Assert.Contains("BROADCAST", error);

        // A reserved address (248–255) is the other half of the same rule and goes down the same path.
        Assert.False(factory.TryCreate(DeviceJson("RTU-LEAK-RESERVED", 250), out _, out var reservedError));
        Assert.Contains("RESERVE", reservedError, StringComparison.OrdinalIgnoreCase);

        // One lease, from the one device that built. Two refusals cost the bus nothing.
        Assert.Equal(1, registry.LeaseCount(factory.BusKey));
        Assert.Equal(0, opens);

        await healthy!.DisposeAsync();
    }

    /// <summary>
    /// 🔴 <b>The rule behind the list, with the counterexample that proves the rule was needed.</b>
    ///
    /// <para>"Validate the unit id before <c>Acquire</c>" closes the failure known today. It is a list. The rule
    /// is <i>anything between taking the lease and returning can throw</i>, and this constructor has a
    /// reachable member of that class one line below the lease assignment — the map's own null check. So
    /// <see cref="ModbusRtuDriver"/>'s constructor releases the lease on its way out, and this is that
    /// property.</para>
    ///
    /// <para><b>The observation is the OPENER being invoked a second time, which is what "the port is reusable"
    /// means when the port is an in-memory pipe.</b> A lease count would not discriminate: had the failed
    /// construction leaked, a later <c>Acquire</c> on the same key would silently ride the leaked bus and every
    /// read would still work — the leak's whole signature is that everything looks fine until the process needs
    /// the port again. Only "the last release genuinely disposed the bus, so the next acquire had to OPEN THE
    /// LINK AGAIN" separates the two, and the sequence below is built so that a leak changes that answer.</para>
    /// </summary>
    [Fact]
    public async Task ADriverConstructorThrowAfterTakingTheLease_ReleasesIt_SoTheLinkIsGenuinelyReopened()
    {
        var opened = new List<InMemoryBusLink>();
        await using var registry = new ModbusBusRegistry();
        const string busKey = "modbus-rtu-tcp:ctor-throw-line:4001";

        Task<IModbusBusLink> Open(CancellationToken _)
        {
            var link = InMemoryBusLinkPair.Create().Master;
            opened.Add(link);
            return Task.FromResult<IModbusBusLink>(link);
        }

        // 1. One healthy driver, and a transaction so the link is actually OPEN. Everything below is about
        //    whether this one open is the only one that ever happens.
        var healthyLease = registry.Acquire(busKey, Open);
        var healthy = new ModbusRtuDriver(
            healthyLease, ModbusRtuLoopbackHarness.BuildSingleRegisterMap("CTOR-OK", 1));
        await using (await healthyLease.Bus.BeginTransactionAsync(50, 0, CancellationToken.None)) { }
        Assert.Single(opened);

        // 2. A SECOND lease whose driver construction throws AFTER the lease is owned. `null!` for the map is
        //    the reachable counterexample: ModbusRtuDriver assigns _lease and only then checks the map.
        var doomed = registry.Acquire(busKey, Open);
        Assert.Throws<ArgumentNullException>(() => new ModbusRtuDriver(doomed, null!));

        // Back to one lease. (Secondary — the discriminating assertion is step 4.)
        Assert.Equal(1, registry.LeaseCount(busKey));

        // 3. The healthy driver goes away, which should be the LAST release and should dispose the bus.
        await healthy.DisposeAsync();
        Assert.False(registry.HasBus(busKey));

        // 4. 🔴 THE PROOF. Acquire again and transact: the link is opened a SECOND time, because the first bus
        //    was genuinely torn down. Had the doomed construction leaked its lease, step 3 would have left the
        //    count at 1, the bus would still exist, and this acquire would have ridden the ORIGINAL link with
        //    the opener never invoked again — which is precisely the state in which a COM port stays taken.
        var reused = registry.Acquire(busKey, Open);
        await using (await reused.Bus.BeginTransactionAsync(50, 0, CancellationToken.None)) { }

        Assert.Equal(2, opened.Count);
        Assert.NotSame(opened[0], opened[1]);
        Assert.False(opened[0].IsOpen, "the first link should have been disposed with the bus that owned it");
        Assert.True(opened[1].IsOpen);

        await reused.DisposeAsync();
    }

    /// <summary>A malformed device document is an ordinary factory rejection, never a throw — the contract
    /// every <see cref="IConnectorFactory"/> is held to, and the reason a bad map disables one connector
    /// instead of crashing the host.</summary>
    [Fact]
    public async Task AMalformedDeviceDocument_IsRejected_NeverThrown()
    {
        await using var registry = new ModbusBusRegistry();
        var factory = new ModbusRtuConnectorFactory(
            "modbus-rtu-tcp:malformed:4001",
            _ => Task.FromResult<IModbusBusLink>(InMemoryBusLinkPair.Create().Master),
            registry);

        Assert.False(factory.TryCreate("{ not json", out var driver, out var error));
        Assert.Null(driver);
        Assert.NotNull(error);

        // A document that parses but declares nothing to poll — the map's own validation, reported as an
        // ordinary rejection rather than escaping as an exception.
        Assert.False(factory.TryCreate("""{"machineCode":"M1","unitId":1,"registers":[]}""", out _, out var noRegisters));
        Assert.Contains("registers", noRegisters);

        Assert.Equal(0, registry.LeaseCount(factory.BusKey));
    }

    /// <summary>
    /// 🔴 <b>The production path really does turn the read backoff on</b> — the one thing a "the default is
    /// off" decision has to be paired with, or the default silently becomes the behaviour.
    ///
    /// <para><see cref="ModbusRtuDriver"/> defaults its read backoff to
    /// <see cref="ModbusRtuReadBackoff.Disabled"/> so that D-2…D-6's directly-constructed measurements keep
    /// measuring what they measured. This factory defaults it to <see cref="ModbusRtuReadBackoff.Default"/>.
    /// Asserted through the two drivers' own failed-poll messages, which is also the operator-visible
    /// difference this task claims: a backed-off device SAYS it is backed off and says by how much, so an
    /// operator can tell it from a device that has merely gone quiet.</para>
    /// </summary>
    [Fact]
    public async Task ADriverBuiltByTheFactory_SaysItIsBackingOff_WhereADirectlyConstructedOneSaysItIsNot()
    {
        // Unit 9 is not on this slave network, so every poll fails inside its own read timeout. One register at
        // the default retry count of 1 makes the hold 1 x 2 x 200 = 400 ms.
        await using var bus = ModbusRtuLoopbackHarness.Start(((byte)1, new ushort[] { 1, 2 }));

        var factoryMessages = new List<string>();
        var factory = new ModbusRtuConnectorFactory(
            bus.BusKey, _ => Task.FromResult<IModbusBusLink>(bus.Links.Master), bus.Registry,
            logError: (_, msg) => { lock (factoryMessages) factoryMessages.Add(msg); });

        Assert.True(factory.TryCreate(DeviceJson("RTU-BACKOFF-ABSENT", 9, pollIntervalMs: 5, readTimeoutMs: 200), out var built, out _));
        await using var fromFactory = built!;

        var directMessages = new List<string>();
        await using var direct = new ModbusRtuDriver(
            bus.Lease(),
            ModbusRegisterMap.FromJson(DeviceJson("RTU-NOBACKOFF-ABSENT", 8, pollIntervalMs: 5, readTimeoutMs: 200)),
            logError: (_, msg) => { lock (directMessages) directMessages.Add(msg); });

        await DriveUntilAsync(
            fromFactory, () => { lock (factoryMessages) return factoryMessages.Count > 0; }, TimeSpan.FromSeconds(20));
        await DriveUntilAsync(
            direct, () => { lock (directMessages) return directMessages.Count > 0; }, TimeSpan.FromSeconds(20));

        Assert.NotEmpty(factoryMessages);
        Assert.NotEmpty(directMessages);
        var fromFactoryMessage = factoryMessages[0];
        var directMessage = directMessages[0];

        // 🔴 The discriminating pair. Both drivers failed the same way on the same bus in the same test; the
        // ONLY difference is which backoff their construction path handed them.
        Assert.Contains("backing off", fromFactoryMessage);
        Assert.Contains("400 ms", fromFactoryMessage);
        Assert.DoesNotContain("no read backoff is configured", fromFactoryMessage);

        Assert.Contains("no read backoff is configured", directMessage);
        Assert.DoesNotContain("backing off", directMessage);

        // And the fact that distinguishes "backed off" from "merely quiet" for whoever is reading the log.
        Assert.Contains("1 consecutive failure(s)", fromFactoryMessage);
    }
}
