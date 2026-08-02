using St4i.Connector.Abstractions.Models;
using St4i.EdgeCore.Drivers.Modbus;
using Xunit;

namespace St4i.EdgeCore.Tests.Drivers.Modbus;

/// <summary>
/// Task D-2 — the protocol-level proof for RTU, mirroring <see cref="ModbusTcpDriverLoopbackTests"/>: a real
/// <see cref="ModbusRtuDriver"/> driven against a REAL in-process NModbus RTU slave (real CRC, real framing,
/// real unit-id dispatch) over the paired in-memory link. All waits are bounded polling, never a fixed delay
/// for correctness.
/// </summary>
public class ModbusRtuDriverLoopbackTests
{
    private static readonly TimeSpan PollTimeout = TimeSpan.FromSeconds(10);
    private static readonly TimeSpan PollInterval = TimeSpan.FromMilliseconds(20);

    private static async Task WaitUntilAsync(Func<bool> predicate, string because)
    {
        var deadline = DateTime.UtcNow + PollTimeout;
        while (DateTime.UtcNow < deadline)
        {
            if (predicate()) return;
            await Task.Delay(PollInterval);
        }

        Assert.True(predicate(), $"timed out after {PollTimeout} waiting for: {because}");
    }

    [Fact]
    public async Task ReadAsync_AgainstInProcessRtuSlave_YieldsDecodedTelemetry_AndHealthReachesConnected()
    {
        // raw 235 decoded UInt16 * scale 1.0 -> 235.0 ; raw 0xFFFF decoded Int16 (-1) * scale 0.1 -> -0.1
        // Identical values and scaling to ModbusTcpDriverLoopbackTests, so any difference is about transport.
        await using var bus = ModbusRtuLoopbackHarness.Start(((byte)1, new ushort[] { 235, 0xFFFF }));
        await using var driver = new ModbusRtuDriver(bus.Lease(), ModbusRtuLoopbackHarness.BuildMap("PLC-RTU"));

        Assert.Equal(DriverHealthState.Down, driver.Health);

        using var readCts = new CancellationTokenSource(TimeSpan.FromSeconds(15));
        DeviceReading? first = null;
        var readTask = Task.Run(async () =>
        {
            await foreach (var reading in driver.ReadAsync(readCts.Token))
            {
                first = reading;
                return;
            }
        });

        try
        {
            await WaitUntilAsync(() => first is not null, "the RTU driver to yield its first decoded reading");

            Assert.NotNull(first);
            Assert.Equal("PLC-RTU", first!.MachineCode);
            Assert.Equal(ReadingKind.Telemetry, first.Kind);
            // Telemetry carries no pass/fail — a defaulted Pass would inflate fleet-wide FPY on every poll.
            Assert.Equal(Verdict.Skip, first.Verdict);
            Assert.Equal(2, first.Telemetry.Count);

            var temperature = first.Telemetry.Single(t => t.Metric == "temperature");
            Assert.Equal(235.0, (double)temperature.Value!, precision: 10);
            Assert.Equal("C", temperature.Unit);
            Assert.Equal("good", temperature.Quality);

            // The Int16 branch of the shared decode: 0xFFFF must come back as -1 * 0.1, not 65535 * 0.1.
            var pressure = first.Telemetry.Single(t => t.Metric == "pressure");
            Assert.Equal(-0.1, (double)pressure.Value!, precision: 10);
            Assert.Equal("bar", pressure.Unit);

            await WaitUntilAsync(() => driver.Health == DriverHealthState.Connected, "Health to reach Connected");
            Assert.Equal(DriverKinds.Modbus, driver.Kind);
            Assert.Contains("unit1", driver.Id);
        }
        finally
        {
            await readCts.CancelAsync();
            try { await readTask; } catch (OperationCanceledException) { }
        }
    }

    /// <summary>
    /// 🔴 The multidrop shape D-4 is built on, proven at D-2 rather than assumed: two drivers, two slave
    /// addresses, ONE bus, ONE link, ONE arbitration lock. The load-bearing assertion is not that both
    /// succeeded — it is that each got ITS OWN device's values, which is the thing a shared bus can get wrong
    /// and a per-driver connection cannot.
    /// </summary>
    [Fact]
    public async Task TwoDriversOnOneBus_EachReadTheirOwnSlave_AndNeitherSeesTheOthersValues()
    {
        await using var bus = ModbusRtuLoopbackHarness.Start(
            ((byte)1, new ushort[] { 111, 0 }),
            ((byte)7, new ushort[] { 777, 0 }));

        var leaseA = bus.Lease();
        var leaseB = bus.Lease();

        // Both leases must be the SAME bus object — that is what "shared" means, and what makes the
        // per-device assertions below meaningful rather than two independent links happening to work.
        Assert.Same(leaseA.Bus, leaseB.Bus);
        Assert.Equal(2, bus.Registry.LeaseCount(bus.BusKey));

        await using var driverA = new ModbusRtuDriver(leaseA, ModbusRtuLoopbackHarness.BuildSingleRegisterMap("MACHINE-A", unitId: 1));
        await using var driverB = new ModbusRtuDriver(leaseB, ModbusRtuLoopbackHarness.BuildSingleRegisterMap("MACHINE-B", unitId: 7));

        using var cts = new CancellationTokenSource(TimeSpan.FromSeconds(20));
        DeviceReading? fromA = null;
        DeviceReading? fromB = null;

        var taskA = Task.Run(async () =>
        {
            await foreach (var r in driverA.ReadAsync(cts.Token)) { fromA = r; return; }
        });
        var taskB = Task.Run(async () =>
        {
            await foreach (var r in driverB.ReadAsync(cts.Token)) { fromB = r; return; }
        });

        try
        {
            await WaitUntilAsync(() => fromA is not null && fromB is not null, "both drivers to yield a reading off the shared bus");

            Assert.Equal("MACHINE-A", fromA!.MachineCode);
            Assert.Equal(111.0, (double)fromA.Telemetry.Single().Value!, precision: 10);

            Assert.Equal("MACHINE-B", fromB!.MachineCode);
            Assert.Equal(777.0, (double)fromB.Telemetry.Single().Value!, precision: 10);

            // One physical link served both. If arbitration had failed and a rebuild had papered over it,
            // this would be higher than 1.
            Assert.Equal(1, leaseA.Bus.LinkGeneration);
        }
        finally
        {
            await cts.CancelAsync();
            try { await taskA; } catch (OperationCanceledException) { }
            try { await taskB; } catch (OperationCanceledException) { }
        }
    }

    /// <summary>Health-on-fault, mirroring <see cref="ModbusTcpDriverLoopbackTests"/>' equivalent: the device
    /// stops answering out from under a running driver. The load-bearing assertion is that the iterator is
    /// STILL RUNNING — a resilient driver must never throw a non-cancellation exception out of
    /// <see cref="ModbusRtuDriver.ReadAsync"/>.</summary>
    [Fact]
    public async Task ReadAsync_DeviceStopsAnswering_HealthDegrades_AndTheIteratorKeepsRunning()
    {
        await using var bus = ModbusRtuLoopbackHarness.Start(((byte)1, new ushort[] { 42, 0 }));
        await using var driver = new ModbusRtuDriver(
            bus.Lease(),
            ModbusRtuLoopbackHarness.BuildSingleRegisterMap("PLC-RTU-FAULT", readTimeoutMs: 300));

        using var cts = new CancellationTokenSource(TimeSpan.FromSeconds(25));
        var readings = 0;
        var readTask = Task.Run(async () =>
        {
            await foreach (var _ in driver.ReadAsync(cts.Token)) { Interlocked.Increment(ref readings); }
        });

        try
        {
            await WaitUntilAsync(() => Volatile.Read(ref readings) > 0, "one good reading before the device goes quiet");
            Assert.Equal(DriverHealthState.Connected, driver.Health);

            // The device is still on the bus and still computing — it just never delivers.
            bus.Links.Device.HoldWrites = true;

            await WaitUntilAsync(() => driver.Health == DriverHealthState.Degraded, "Health to degrade once the device stops answering");

            Assert.False(readTask.IsCompleted, "the poll iterator must keep running through a transient bus failure, never fault out of it");
            Assert.False(readTask.IsFaulted);
        }
        finally
        {
            await cts.CancelAsync();
            bus.Links.Device.ReleaseHeldWrites();
            try { await readTask; } catch (OperationCanceledException) { }
        }
    }

    /// <summary>
    /// 🔴 <b>An Input register (FC04) is read through FC04, not FC03.</b> Found by a surviving mutation:
    /// collapsing the driver's function-code choice so both arms sent <c>ReadHoldingRegistersAsync</c> left
    /// every test green, because every RTU map in this suite declared Holding registers only. The two
    /// registers here share address 4 deliberately — that makes the function codes distinguishable ONLY by
    /// which of the slave's two data stores answers, so a wrong function code returns the other store's value
    /// rather than a convenient error.
    /// </summary>
    [Fact]
    public async Task ReadAsync_ReadsInputRegistersThroughFc04_NotFc03()
    {
        // Same address, different stores, different values.
        await using var bus = ModbusRtuLoopbackHarness.Start(
            inputRegisters: new ushort[] { 0, 0, 0, 0, 4004 },
            ((byte)1, new ushort[] { 0, 0, 0, 0, 3003 }));

        await using var driver = new ModbusRtuDriver(bus.Lease(), ModbusRtuLoopbackHarness.BuildHoldingAndInputMap("PLC-FC04"));

        using var cts = new CancellationTokenSource(TimeSpan.FromSeconds(15));
        DeviceReading? first = null;
        var readTask = Task.Run(async () =>
        {
            await foreach (var reading in driver.ReadAsync(cts.Token)) { first = reading; return; }
        });

        try
        {
            await WaitUntilAsync(() => first is not null, "a reading covering both a Holding and an Input register");

            Assert.Equal(3003.0, (double)first!.Telemetry.Single(t => t.Metric == "holding-value").Value!, precision: 10);
            Assert.Equal(4004.0, (double)first.Telemetry.Single(t => t.Metric == "input-value").Value!, precision: 10);
        }
        finally
        {
            await cts.CancelAsync();
            try { await readTask; } catch (OperationCanceledException) { }
        }
    }

    /// <summary>
    /// 🔴 <b>Health never reports <see cref="DriverHealthState.Connected"/> — not even transiently — while no
    /// device is answering.</b> This is <see cref="St4i.Connector.Abstractions.IDeviceDriver.Health"/>'s own
    /// conformance rule, verbatim: "must never report Connected while no such device is actually reachable —
    /// including only TRANSIENTLY reporting Connected partway through an attempt that ultimately never reaches
    /// a real device."
    ///
    /// <para>Found by a surviving mutation. Moving <c>Health = Connected</c> to BEFORE the poll instead of
    /// after it left every other test green, because they all assert the END state — and the end state is
    /// <see cref="DriverHealthState.Degraded"/> either way, since the failure's own catch sets it. What
    /// changes is a ~one-read-timeout window in which a dead device reports green, which is exactly the
    /// "operator sees a green connector that has silently stopped producing" defect GP-6b closed for the TCP
    /// driver. Sampling is what catches it, so this test samples rather than checking afterwards.</para>
    /// </summary>
    [Fact]
    public async Task ReadAsync_AgainstADeviceThatNeverAnswers_NeverReportsConnected_NotEvenTransiently()
    {
        await using var bus = ModbusRtuLoopbackHarness.Start(((byte)1, new ushort[] { 1, 0 }));

        // On the bus, computing, never delivering — the shape that makes a transient "Connected" possible at
        // all, because the request genuinely goes out.
        bus.Links.Device.HoldWrites = true;

        await using var driver = new ModbusRtuDriver(
            bus.Lease(),
            ModbusRtuLoopbackHarness.BuildSingleRegisterMap("PLC-NEVER-ANSWERS", pollIntervalMs: 20, readTimeoutMs: 500));

        Assert.Equal(DriverHealthState.Down, driver.Health);

        using var cts = new CancellationTokenSource();
        var readTask = Task.Run(async () =>
        {
            await foreach (var _ in driver.ReadAsync(cts.Token)) { }
        });

        try
        {
            // Sample far more often than the 500 ms window a mutation would open.
            var observed = new HashSet<DriverHealthState>();
            var deadline = DateTime.UtcNow + TimeSpan.FromSeconds(3);
            while (DateTime.UtcNow < deadline)
            {
                observed.Add(driver.Health);
                await Task.Delay(10);
            }

            Assert.DoesNotContain(DriverHealthState.Connected, observed);
            Assert.Contains(DriverHealthState.Degraded, observed);
        }
        finally
        {
            await cts.CancelAsync();
            bus.Links.Device.ReleaseHeldWrites();
            try { await readTask; } catch (OperationCanceledException) { }
        }
    }

    /// <summary>
    /// 🔴 <b>The driver hands the bus ITS OWN map's read timeout and retry count</b> — asserted on the values
    /// the bus actually applied to the shared transport, not on values this test supplied.
    ///
    /// <para>Found by a surviving mutation, and it is the one with a safety consequence.
    /// <c>ATimedOutTransaction_PutsExactlyOneRequestOnTheWire_NeverARetry</c> passes <c>retries: 0</c>
    /// itself, so it proves the plumbing HONOURS 0 and says nothing about what the driver passes —
    /// hardcoding <c>Retries = 3</c> inside <see cref="ModbusRtuDriver"/> left all 153 Modbus tests green.
    /// The retry count is a physical double-actuation hazard on the write path D-5 builds here, so "the
    /// driver's own configuration reached the wire" has to be a tested property rather than an inspected
    /// one.</para>
    ///
    /// <para>Both cases matter and are asserted separately. <b>Explicit</b>: a map that sets both fields must
    /// see exactly those values. <b>Default</b>: a map that sets neither must see
    /// <see cref="ModbusRegisterMap.EffectiveRetries"/> == <b>1</b>, not 0 — which pins the behaviour this
    /// task's own report originally described incorrectly, and which is deliberate (an extra READ is
    /// harmless and absorbs a CRC glitch; a write must force 0 per call, exactly as
    /// <see cref="ModbusTcpDriver"/> does).</para>
    /// </summary>
    [Fact]
    public async Task ReadAsync_HandsTheBusItsOwnMapsReadTimeoutAndRetryCount()
    {
        await using var bus = ModbusRtuLoopbackHarness.Start(((byte)1, new ushort[] { 12, 0 }));
        var lease = bus.Lease();

        var explicitMap = new ModbusRegisterMap
        {
            MachineCode = "PLC-ARGS",
            UnitId = 1,
            PollIntervalMs = 20,
            ReadTimeoutMs = 4_321,
            Retries = 3,
            Registers = new List<ModbusRegister>
            {
                new(Address: 0, Type: ModbusRegisterType.Holding, DataType: ModbusDataType.UInt16, Scale: 1.0, Metric: "value"),
            },
        };
        Assert.Equal(4_321, explicitMap.EffectiveReadTimeoutMs);
        Assert.Equal(3, explicitMap.EffectiveRetries);

        await using (var driver = new ModbusRtuDriver(lease, explicitMap))
        {
            using var cts = new CancellationTokenSource(TimeSpan.FromSeconds(15));
            var readTask = Task.Run(async () =>
            {
                await foreach (var _ in driver.ReadAsync(cts.Token)) { return; }
            });
            await WaitUntilAsync(() => lease.Bus.LastTransactionRetries >= 0, "the driver to open a transaction");
            await cts.CancelAsync();
            try { await readTask; } catch (OperationCanceledException) { }

            Assert.Equal(4_321, lease.Bus.LastTransactionReadTimeoutMs);
            Assert.Equal(3, lease.Bus.LastTransactionRetries);
        }

        // The DEFAULT arm, on a second bus so the assertions cannot read the first driver's leftovers.
        await using var defaultBus = ModbusRtuLoopbackHarness.Start(((byte)1, new ushort[] { 12, 0 }));
        var defaultLease = defaultBus.Lease();
        var defaultMap = ModbusRtuLoopbackHarness.BuildSingleRegisterMap("PLC-ARGS-DEFAULT", pollIntervalMs: 20);
        Assert.Equal(1, defaultMap.EffectiveRetries);                       // NOT 0 — see this test's remarks
        Assert.Equal(1_000, defaultMap.EffectiveReadTimeoutMs);             // Math.Max(1000, 20 * 4)

        await using var defaultDriver = new ModbusRtuDriver(defaultLease, defaultMap);
        using var defaultCts = new CancellationTokenSource(TimeSpan.FromSeconds(15));
        var defaultRead = Task.Run(async () =>
        {
            await foreach (var _ in defaultDriver.ReadAsync(defaultCts.Token)) { return; }
        });
        await WaitUntilAsync(() => defaultLease.Bus.LastTransactionRetries >= 0, "the default-map driver to open a transaction");
        await defaultCts.CancelAsync();
        try { await defaultRead; } catch (OperationCanceledException) { }

        Assert.Equal(1_000, defaultLease.Bus.LastTransactionReadTimeoutMs);
        Assert.Equal(1, defaultLease.Bus.LastTransactionRetries);
    }

    /// <summary>The constructor performs no I/O — <see cref="St4i.Connector.Abstractions.IDeviceDriver"/>'s
    /// own conformance rule, and the reason <see cref="ModbusBusRegistry.Acquire"/> opens nothing. Asserted
    /// against the bus's own link counter rather than by timing the constructor, because a fast constructor
    /// and a non-connecting one are different claims.</summary>
    [Fact]
    public async Task Construction_OpensNoLink()
    {
        await using var bus = ModbusRtuLoopbackHarness.Start();
        var lease = bus.Lease();

        await using var driver = new ModbusRtuDriver(lease, ModbusRtuLoopbackHarness.BuildMap("PLC-LAZY"));

        Assert.Equal(0, lease.Bus.LinkGeneration);
        Assert.Equal(DriverHealthState.Down, driver.Health);
    }

    /// <summary>Disposal releases the driver's lease — that is what makes the reference count track driver
    /// lifetime — and does so exactly once even when disposed twice, which <c>FleetHost</c> genuinely
    /// does.</summary>
    [Fact]
    public async Task DisposeAsync_ReleasesTheLease_Once_EvenWhenCalledTwice()
    {
        await using var bus = ModbusRtuLoopbackHarness.Start();
        var keepAlive = bus.Lease();
        var driverLease = bus.Lease();
        Assert.Equal(2, bus.Registry.LeaseCount(bus.BusKey));

        var driver = new ModbusRtuDriver(driverLease, ModbusRtuLoopbackHarness.BuildMap("PLC-DISPOSE"));

        await driver.DisposeAsync();
        await driver.DisposeAsync();

        Assert.True(driverLease.IsReleased);
        Assert.Equal(1, bus.Registry.LeaseCount(bus.BusKey));
        Assert.True(bus.Registry.HasBus(bus.BusKey));

        await keepAlive.DisposeAsync();
    }
}
