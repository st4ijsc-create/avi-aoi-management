using NModbus;
using St4i.EdgeCore.Drivers.Modbus;

namespace St4i.EdgeCore.Tests.Drivers.Modbus;

/// <summary>
/// Task D-2 — the RTU counterpart of <see cref="ModbusLoopbackHarness"/>: stands up a REAL in-process NModbus
/// RTU slave network over an <see cref="InMemoryBusLinkPair"/>, plus the <see cref="ModbusBusRegistry"/> and
/// leases a driver needs. Real CRC, real t3.5 framing, real slave dispatch by unit id — only the copper is
/// simulated.
///
/// <para><b>🔴 The slave network's listen loop must run on its own DEDICATED thread.</b> Two separate facts,
/// both found the hard way. First, probed: <c>ListenAsync</c> does NOT yield before entering its synchronous
/// read loop, so calling it inline blocks the caller forever (it hung a probe until the probe was killed) —
/// worth recording because the failure mode, a test hanging with no output, looks exactly like a deadlock in
/// the code under test. Second, measured: a <c>Task.Run</c> is not good enough, because that thread is then
/// held for the whole lifetime of the test and several RTU test classes in parallel starve the pool — see
/// <see cref="BlockingWork"/>, which documents the five failures that diagnosed it.</para>
/// </summary>
internal static class ModbusRtuLoopbackHarness
{
    /// <summary>The same two-register shape <see cref="ModbusLoopbackHarness.BuildMap"/> uses, so the RTU and
    /// TCP loopback tests decode the identical values and any difference between them is genuinely about the
    /// transport. <paramref name="unitId"/> is the one addition: on a multidrop bus the slave address is what
    /// distinguishes two devices, and it is what D-4 will vary.</summary>
    public static ModbusRegisterMap BuildMap(
        string machineCode,
        byte unitId = 1,
        int pollIntervalMs = 50,
        int? readTimeoutMs = null) => new()
        {
            MachineCode = machineCode,
            UnitId = unitId,
            PollIntervalMs = pollIntervalMs,
            ReadTimeoutMs = readTimeoutMs,
            Registers = new List<ModbusRegister>
            {
                new(Address: 0, Type: ModbusRegisterType.Holding, DataType: ModbusDataType.UInt16, Scale: 1.0, Metric: "temperature", Unit: "C"),
                new(Address: 1, Type: ModbusRegisterType.Holding, DataType: ModbusDataType.Int16, Scale: 0.1, Metric: "pressure", Unit: "bar"),
            },
        };

    /// <summary>A single-register map — for the cancellation/resynchronisation tests, where a second register
    /// would only add a second timeout to wait out.</summary>
    public static ModbusRegisterMap BuildSingleRegisterMap(
        string machineCode,
        byte unitId = 1,
        ushort address = 0,
        int pollIntervalMs = 50,
        int? readTimeoutMs = null) => new()
        {
            MachineCode = machineCode,
            UnitId = unitId,
            PollIntervalMs = pollIntervalMs,
            ReadTimeoutMs = readTimeoutMs,
            Registers = new List<ModbusRegister>
            {
                new(Address: address, Type: ModbusRegisterType.Holding, DataType: ModbusDataType.UInt16, Scale: 1.0, Metric: "value", Unit: null),
            },
        };

    // ─────────────────────────────────────────────────────────────────────
    // 🔴 Task D-6 — the WRITABLE map shape, moved here out of ModbusRtuDriverWriteTests' own private
    // `WritableMap` so RTU has ONE of them rather than two. Behaviour-preserving: same names, same addresses,
    // same bounds, same defaults; that suite's own 40 tests are what prove it. The move is the same call D-5
    // made twice (ModbusWritePreflight off ModbusTcpDriver, RtuFrames off ModbusBusResynchronisationTests) and
    // for the same reason — D-6's conformance rig needs a real declared point AND a real declared command
    // (Check_Write_SetpointAndCommandNamespaces_AreDistinct cross-checks the two vocabularies), which is
    // exactly why B-7 introduced ModbusLoopbackHarness.BuildWritableMap on the TCP side, and a second copy
    // here would be free to drift from the one D-5's tests actually exercise.
    // ─────────────────────────────────────────────────────────────────────

    /// <summary>The writable register (declared <c>[0,500]</c>).</summary>
    public const ushort WritableSpeedRegister = 5;

    /// <summary>The coil <see cref="StartCycleCommand"/> pulses.</summary>
    public const ushort StartCycleCoil = 3;

    /// <summary>The writable point's name.</summary>
    public const string WritableSpeedPoint = "speed";

    /// <summary>A declared READ-ONLY point — the one a "this point is not writable" rejection needs.</summary>
    public const string ReadOnlyTemperaturePoint = "temperature";

    /// <summary>The zero-argument coil-pulse command's name.</summary>
    public const string StartCycleCommand = "start-cycle";

    /// <summary>One read-only register (<see cref="ReadOnlyTemperaturePoint"/>, address 0) and one writable
    /// one (<see cref="WritableSpeedPoint"/>, address <see cref="WritableSpeedRegister"/>, declared
    /// <c>[0,500]</c>), plus one coil-pulse command (<see cref="StartCycleCommand"/>, coil
    /// <see cref="StartCycleCoil"/>) — the same shape <c>ModbusTcpDriverWriteTests</c>' own
    /// <c>BuildWritableMap</c> uses, deliberately, so any difference between the two transports' write
    /// behaviour is about the transport rather than about the map.</summary>
    public static ModbusRegisterMap BuildWritableMap(
        string machineCode,
        byte unitId = 1,
        int? readTimeoutMs = null,
        int pollIntervalMs = 60_000,
        int? retries = null) => new()
        {
            MachineCode = machineCode,
            UnitId = unitId,
            PollIntervalMs = pollIntervalMs,
            ReadTimeoutMs = readTimeoutMs,
            Retries = retries,
            Registers = new List<ModbusRegister>
            {
                new(Address: 0, Type: ModbusRegisterType.Holding, DataType: ModbusDataType.UInt16, Scale: 1.0,
                    Metric: ReadOnlyTemperaturePoint, Unit: "C"),
                new(Address: WritableSpeedRegister, Type: ModbusRegisterType.Holding, DataType: ModbusDataType.UInt16,
                    Scale: 1.0, Metric: WritableSpeedPoint, Unit: "rpm", Writable: new ModbusWritableRange(0, 500)),
            },
            Commands = new List<ModbusCommand> { new(StartCycleCommand, CoilAddress: StartCycleCoil) },
        };

    /// <summary>A map declaring ONE Holding (FC03) register and ONE Input (FC04) register at the SAME
    /// address. The shared address is the point: it makes the two function codes distinguishable only by
    /// which data store the slave answers from, so a driver that sent the wrong function code returns the
    /// other store's value rather than an error. Written because a mutation collapsing the FC04 arm onto FC03
    /// survived a suite whose every map was Holding-only.</summary>
    public static ModbusRegisterMap BuildHoldingAndInputMap(
        string machineCode,
        byte unitId = 1,
        int pollIntervalMs = 50) => new()
        {
            MachineCode = machineCode,
            UnitId = unitId,
            PollIntervalMs = pollIntervalMs,
            Registers = new List<ModbusRegister>
            {
                new(Address: 4, Type: ModbusRegisterType.Holding, DataType: ModbusDataType.UInt16, Scale: 1.0, Metric: "holding-value", Unit: null),
                new(Address: 4, Type: ModbusRegisterType.Input, DataType: ModbusDataType.UInt16, Scale: 1.0, Metric: "input-value", Unit: null),
            },
        };

    public sealed class RunningRtuBus : IAsyncDisposable
    {
        internal RunningRtuBus(
            InMemoryBusLinkPair links,
            IModbusSlaveNetwork network,
            IReadOnlyDictionary<byte, IModbusSlave> slaves,
            CancellationTokenSource listenCts,
            Task listenTask,
            ModbusBusRegistry registry,
            string busKey)
        {
            Links = links;
            Network = network;
            Slaves = slaves;
            ListenCts = listenCts;
            ListenTask = listenTask;
            Registry = registry;
            BusKey = busKey;
        }

        public InMemoryBusLinkPair Links { get; }

        public IModbusSlaveNetwork Network { get; }

        /// <summary>Every slave on the bus, by unit id — so a test can read a value straight off the device's
        /// own data store rather than trusting the driver's report of it.</summary>
        public IReadOnlyDictionary<byte, IModbusSlave> Slaves { get; }

        public CancellationTokenSource ListenCts { get; }

        public Task ListenTask { get; }

        public ModbusBusRegistry Registry { get; }

        public string BusKey { get; }

        /// <summary>Takes a lease on the one bus this harness set up. The opener hands out the master end of
        /// the in-memory pair; note it is only ever invoked for the FIRST lease, exactly as production's is,
        /// and a rebuild after a fault would hand out the SAME end again — deliberate, because there is no
        /// second in-memory link to give and a serial port re-open is likewise the same physical port.</summary>
        public ModbusBusLease Lease(ModbusBusSettings? settings = null) =>
            Registry.Acquire(BusKey, _ => Task.FromResult<IModbusBusLink>(Links.Master), settings);

        public async ValueTask DisposeAsync()
        {
            try { await ListenCts.CancelAsync(); } catch { /* best-effort teardown */ }
            try { Links.Device.Dispose(); } catch { /* best-effort — unblocks the listen loop's blocking read */ }
            try { await ListenTask.WaitAsync(TimeSpan.FromSeconds(5)); } catch { /* best-effort teardown */ }
            try { Network.Dispose(); } catch { /* best-effort teardown */ }
            try { await Registry.DisposeAsync(); } catch { /* best-effort teardown */ }
            ListenCts.Dispose();
        }
    }

    /// <summary>Starts an RTU slave network carrying one slave per entry in <paramref name="slaves"/>, each
    /// with its holding registers pre-loaded from address 0.</summary>
    public static RunningRtuBus Start(params (byte UnitId, ushort[] HoldingRegisters)[] slaves)
        => Start(inputRegisters: null, slaves);

    /// <summary>As <see cref="Start(ValueTuple{byte, ushort[]}[])"/>, plus a set of INPUT (FC04) registers
    /// written to every slave from address 0. Separate overload rather than a widened tuple so every existing
    /// caller is untouched.</summary>
    public static RunningRtuBus Start(ushort[]? inputRegisters, params (byte UnitId, ushort[] HoldingRegisters)[] slaves)
    {
        if (slaves.Length == 0)
        {
            slaves = new[] { ((byte)1, new ushort[] { 235, 0xFFFF }) };
        }

        var links = InMemoryBusLinkPair.Create();
        var factory = new ModbusFactory();

        var network = factory.CreateRtuSlaveNetwork(links.Device);
        var built = new Dictionary<byte, IModbusSlave>();
        foreach (var (unitId, registers) in slaves)
        {
            var slave = factory.CreateSlave(unitId);
            slave.DataStore.HoldingRegisters.WritePoints(0, registers);
            if (inputRegisters is { Length: > 0 })
            {
                slave.DataStore.InputRegisters.WritePoints(0, inputRegisters);
            }
            network.AddSlave(slave);
            built[unitId] = slave;
        }

        var cts = new CancellationTokenSource();
        // See this class's doc comment: ListenAsync blocks its caller synchronously — and see BlockingWork's
        // for why that thread must not come from the pool.
        var listenTask = BlockingWork.RunAsync(() => network.ListenAsync(cts.Token), "rtu-slave-listen");

        return new RunningRtuBus(
            links, network, built, cts, listenTask,
            new ModbusBusRegistry(),
            busKey: "modbus-rtu-inmemory:test");
    }
}
