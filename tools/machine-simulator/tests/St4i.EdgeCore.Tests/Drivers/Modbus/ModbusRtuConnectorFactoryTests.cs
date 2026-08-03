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
    /// 🔴 <b>Review I-2 — the counterexample that overturns D-7a's own "no test can tell the two lease-leak
    /// mechanisms apart" claim, and review I-1's "never throws" in the same assertion.</b>
    ///
    /// <para>The report argued that validating before <c>Acquire</c> is unobservable once the constructor
    /// releases the lease, because both orderings take and return a lease with no I/O either way. That reasoned
    /// about the LEASE. The observable property is at the public seam and is about the OPERATOR: <b>a device
    /// that cannot produce a driver must be refused by its own map's error, and must never touch the bus
    /// registry at all.</b> Give the factory a disposed registry — a host shutdown racing a fleet start, which
    /// <c>FleetHost.StartLocked</c> can genuinely produce — and the two orderings diverge on what the operator
    /// is told about their own configuration.</para>
    ///
    /// <para><b>Why this survives the I-1 fix, which is the reason it is worth keeping rather than a one-round
    /// artefact.</b> With <c>Acquire</c> unguarded, removing the validation makes <c>TryCreate</c> THROW. With
    /// <c>Acquire</c> inside the guard (as it now is), removing the validation makes <c>TryCreate</c> return
    /// <see langword="false"/> with <i>"Cannot access a disposed object"</i> — still a failure, still contained,
    /// and still the wrong sentence: the operator is told about the host's shutdown instead of about the
    /// broadcast address they typed. The assertion below is on the message's IDENTITY, so it discriminates in
    /// both trees.</para>
    /// </summary>
    [Fact]
    public async Task AnUnbuildableDevice_IsRefusedByItsOwnMapsError_WithoutEverTouchingTheBusRegistry()
    {
        var registry = new ModbusBusRegistry();
        var opens = 0;
        var factory = new ModbusRtuConnectorFactory(
            "modbus-rtu-tcp:m5-counterexample:4001",
            _ => { opens++; return Task.FromResult<IModbusBusLink>(InMemoryBusLinkPair.Create().Master); },
            registry);

        // The registry is gone — the state that makes "did this reach the registry at all?" observable.
        await registry.DisposeAsync();

        Assert.False(factory.TryCreate(DeviceJson("RTU-M5-CE", 0), out var driver, out var error));
        Assert.Null(driver);

        // 🔴 The device's OWN configuration error, not the host's teardown. This is the whole discriminator.
        Assert.Contains("BROADCAST", error);
        Assert.DoesNotContain("disposed", error, StringComparison.OrdinalIgnoreCase);
        Assert.Equal(0, opens);

        // 🔴 Review I-1 — and it did not THROW getting there, which the doc comment claims unconditionally and
        // which was false on HEAD: Acquire sat outside the guard and ObjectDisposedException escaped. Asserted
        // for a VALID map too, because that is the path the guard has to cover once validation stops
        // short-circuiting it.
        Assert.False(factory.TryCreate(DeviceJson("RTU-M5-CE-OK", 1), out var valid, out var validError));
        Assert.Null(valid);
        Assert.NotNull(validError);
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

    /// <summary>
    /// 🔴 <b>Review M-1 — a backed-off device whose bus hold is SMALLER than its poll interval must still say
    /// it is backed off.</b>
    ///
    /// <para>The message used to branch on the computed delay (<c>next &gt; PollIntervalMs</c>), and
    /// <c>DelayMsFor</c> returns <c>max(poll, hold) × mult^(n-1)</c> — so on the FIRST failure of any device
    /// whose <c>WorstCaseBusHoldMs</c> is at or below its poll interval the two are equal and the driver told
    /// the operator <i>"no read backoff is configured for this driver"</i> while running one. The
    /// configuration below is deliberately ordinary rather than contrived: 1 register, default retries,
    /// <c>readTimeoutMs: 100</c>, <c>pollIntervalMs: 1000</c> → a 200 ms hold against a 1 000 ms cadence.</para>
    ///
    /// <para>This is the pair that makes the fix a RULE rather than a patch: the same driver, the same first
    /// failure, and the discriminating assertion is that it does not claim to be unconfigured.</para>
    /// </summary>
    [Fact]
    public async Task ADeviceWhoseHoldIsSmallerThanItsCadence_StillSaysItIsBackedOff_OnTheFirstFailure()
    {
        await using var bus = ModbusRtuLoopbackHarness.Start(((byte)1, new ushort[] { 1, 2 }));

        var messages = new List<string>();
        var factory = new ModbusRtuConnectorFactory(
            bus.BusKey, _ => Task.FromResult<IModbusBusLink>(bus.Links.Master), bus.Registry,
            logError: (_, msg) => { lock (messages) messages.Add(msg); });

        // Unit 7 is absent, so the poll fails. hold = 1 x 2 x 100 = 200 ms; cadence = 1000 ms.
        Assert.True(factory.TryCreate(
            DeviceJson("RTU-M1-SMALLHOLD", 7, pollIntervalMs: 1000, readTimeoutMs: 100), out var built, out _));
        await using var driver = built!;

        await DriveUntilAsync(driver, () => { lock (messages) return messages.Count > 0; }, TimeSpan.FromSeconds(20));

        Assert.NotEmpty(messages);
        var first = messages[0];

        // 🔴 The regression, stated as the operator reads it.
        Assert.DoesNotContain("no read backoff is configured", first);
        Assert.Contains("backing off", first);
        Assert.Contains("1 consecutive failure(s)", first);
        // The declared cadence is still named — that number is what an operator acts on; it just no longer
        // decides the branch.
        Assert.Contains("1000 ms", first);
    }

    /// <summary>
    /// 🔴 <b>Review M-1, the SWEEP rather than the instance: the RECOVERY notice had the same defect one
    /// method away.</b> It asserted "its read backoff is cleared" unconditionally, so a driver constructed
    /// with <see cref="ModbusRtuReadBackoff.Disabled"/> told an operator about a mechanism that had never been
    /// running. Driven as a pair — the same failure-then-recovery sequence on the same bus, differing only in
    /// the backoff object — because "true of only one of the two producing paths" is exactly the shape a
    /// single-path test cannot see.
    /// </summary>
    [Fact]
    public async Task TheRecoveryNotice_OnlyClaimsABackoffWasCleared_WhenOneWasConfigured()
    {
        await using var bus = ModbusRtuLoopbackHarness.Start(((byte)5, new ushort[] { 42, 0 }));

        // 🔴 Holds the bus alive across BOTH phases. Without it, phase one's driver is the LAST lease, so its
        // disposal disposes the bus AND the shared in-memory link, and phase two rides a dead pipe — it never
        // transmits, never recovers, and reports "no recovery notice", which reads as the notice being broken.
        // The same trap D-4 §7.8 recorded and the same one ModbusMultidropBusTests guards against; this test
        // walked into it on its second run, and the self-diagnosing assertion below is what named it
        // (`readings 0, frames silenced 2` — the 2 being phase one's, cumulative).
        await using var keepAlive = bus.Lease();

        // One driver against a REAL slave that is silenced for a while and then allowed to answer: the failure
        // streak and the recovery both happen for the reason the production path produces them, rather than by
        // poking the driver's state.
        async Task<string> RecoveryNoticeAsync(ModbusRtuReadBackoff backoff, string machineCode)
        {
            var notices = new List<string>();
            await using var driver = new ModbusRtuDriver(
                bus.Lease(),
                ModbusRtuLoopbackHarness.BuildSingleRegisterMap(machineCode, unitId: 5, pollIntervalMs: 5, readTimeoutMs: 300),
                logError: null,
                readBackoff: backoff,
                writeQueueBudgetMs: null,
                logRecovery: msg => { lock (notices) notices.Add(msg); });

            bus.Links.Device.SilentUnitId = 5;

            var readings = 0;
            using var cts = new CancellationTokenSource(TimeSpan.FromSeconds(25));
            var pump = Task.Run(
                async () =>
                {
                    try { await foreach (var _ in driver.ReadAsync(cts.Token)) Interlocked.Increment(ref readings); }
                    catch (OperationCanceledException) { }
                },
                CancellationToken.None);

            // 🔴 Wait for a whole POLL to fail (Health flips to Degraded), not for the first silenced FRAME.
            // The map declares the default retry count of 1, so a poll is TWO frames — un-silencing after the
            // first one lets the retry succeed, the poll completes, no failure streak ever forms and no
            // recovery notice is ever due. That is what this test did on its first run, and the symptom (an
            // empty notice) looks exactly like the notice being broken.
            var deadline = DateTime.UtcNow + TimeSpan.FromSeconds(10);
            while (DateTime.UtcNow < deadline && driver.Health != DriverHealthState.Degraded)
            {
                await Task.Delay(10);
            }

            Assert.Equal(DriverHealthState.Degraded, driver.Health);
            bus.Links.Device.SilentUnitId = null;

            deadline = DateTime.UtcNow + TimeSpan.FromSeconds(15);
            while (DateTime.UtcNow < deadline)
            {
                lock (notices) { if (notices.Count > 0) break; }
                await Task.Delay(10);
            }

            await cts.CancelAsync();
            try { await pump; } catch (OperationCanceledException) { }

            lock (notices)
            {
                // A self-diagnosing failure: an empty notice can mean "the notice is broken" OR "no streak ever
                // formed" OR "it never recovered", and those need different fixes.
                Assert.True(
                    notices.Count > 0,
                    $"{machineCode}: no recovery notice within the window — final health {driver.Health}, " +
                    $"readings {readings}, frames silenced {bus.Links.Device.FramesSilenced}");
                return notices[0];
            }
        }

        var withBackoff = await RecoveryNoticeAsync(ModbusRtuReadBackoff.Default, "REC-ON");
        var withoutBackoff = await RecoveryNoticeAsync(ModbusRtuReadBackoff.Disabled, "REC-OFF");

        // 🔴 The discriminating pair. Both recovered; only one of them had a backoff to clear.
        Assert.Contains("read backoff is cleared", withBackoff);
        Assert.DoesNotContain("read backoff is cleared", withoutBackoff);

        // Both still say the thing the notice exists for: this device answered again, after a streak.
        Assert.Contains("answered again", withBackoff);
        Assert.Contains("answered again", withoutBackoff);
    }
}
