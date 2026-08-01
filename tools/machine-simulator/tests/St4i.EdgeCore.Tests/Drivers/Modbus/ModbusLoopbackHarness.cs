using System.Net;
using System.Net.Sockets;
using NModbus;
using St4i.EdgeCore.Drivers.Modbus;

namespace St4i.EdgeCore.Tests.Drivers.Modbus;

/// <summary>
/// GP-6 (task-6-report.md) — the "stand up a real in-process NModbus TCP slave on a free port" setup,
/// extracted out of <see cref="ModbusTcpDriverLoopbackTests"/> so <c>ModbusTcpDriverConformanceTests</c> can
/// reuse the EXACT same real-server harness (task-6-brief.md: "Modbus and OPC-UA have existing in-process
/// loopback harnesses ... reuse them where the checks need real readings") instead of hand-rolling a second
/// one. Behaviour is unchanged from what <see cref="ModbusTcpDriverLoopbackTests"/> always did inline; this
/// is a mechanical extraction, not a rewrite.
/// </summary>
internal static class ModbusLoopbackHarness
{
    public static ModbusRegisterMap BuildMap(string machineCode, int pollIntervalMs = 50) => new()
    {
        MachineCode = machineCode,
        UnitId = 1,
        PollIntervalMs = pollIntervalMs,
        Registers = new List<ModbusRegister>
        {
            new(Address: 0, Type: ModbusRegisterType.Holding, DataType: ModbusDataType.UInt16, Scale: 1.0, Metric: "temperature", Unit: "C"),
            new(Address: 1, Type: ModbusRegisterType.Holding, DataType: ModbusDataType.Int16, Scale: 0.1, Metric: "pressure", Unit: "bar"),
        },
    };

    /// <summary>Task B-7 (.superpowers/sdd/2026-07-29-dotB-machine-control-blueprint/task-7-brief.md) — a
    /// purely-additive writable-shape map (one writable Holding register "speed" [0,500], one coil-pulse
    /// command "start-cycle"), mirroring <c>ModbusTcpDriverWriteTests</c>' own private <c>BuildWritableMap</c>
    /// exactly (same point/command names/addresses/bounds), so <c>ModbusTcpDriverConformanceTests</c>'s new
    /// write-contract checks share the identical, already-proven-correct shape rather than inventing a
    /// second one. <paramref name="readTimeoutMs"/> lets a caller configure a SHORT internal write timeout —
    /// see <see cref="DeviceDriverConformanceSuite.CreateUnresponsiveWritableDeviceAsync"/>'s own doc comment
    /// for why the write-contract checks need one.</summary>
    public static ModbusRegisterMap BuildWritableMap(string machineCode, int? readTimeoutMs = null, int pollIntervalMs = 5_000) => new()
    {
        MachineCode = machineCode,
        UnitId = 1,
        PollIntervalMs = pollIntervalMs,
        ReadTimeoutMs = readTimeoutMs,
        Registers = new List<ModbusRegister>
        {
            new(Address: 5, Type: ModbusRegisterType.Holding, DataType: ModbusDataType.UInt16, Scale: 1.0, Metric: "speed", Unit: "rpm",
                Writable: new ModbusWritableRange(0, 500)),
        },
        Commands = new List<ModbusCommand>
        {
            new("start-cycle", CoilAddress: 3),
        },
    };

    /// <summary>A running slave plus everything needed to tear it down. Exposes its pieces individually
    /// (rather than only a single <see cref="DisposeAsync"/>) so a caller that needs to kill the slave OUT
    /// FROM UNDER a driver mid-test (as <see cref="ModbusTcpDriverLoopbackTests"/>'s fault-injection test
    /// does) can still do so with the exact same sequencing it always used.
    ///
    /// <para>Task B-4 — <see cref="Slave"/> ADDED (a new positional parameter/property; every existing
    /// caller of <see cref="Start"/> only ever read the other four members, so this is purely additive):
    /// exposes the underlying <c>IModbusSlave</c>'s own <c>DataStore</c> so a write test can verify a value
    /// genuinely reached the "device" (read straight off the slave's own storage, independent of whatever
    /// <see cref="ModbusTcpDriver"/> itself reports) rather than trusting the driver's own return value
    /// alone.</para></summary>
    public sealed class RunningSlave(int port, TcpListener listener, IDisposable network, CancellationTokenSource listenCts, Task listenTask, IModbusSlave slave)
        : IAsyncDisposable
    {
        public int Port { get; } = port;

        public TcpListener Listener { get; } = listener;

        public IDisposable Network { get; } = network;

        public CancellationTokenSource ListenCts { get; } = listenCts;

        public Task ListenTask { get; } = listenTask;

        public IModbusSlave Slave { get; } = slave;

        public async ValueTask DisposeAsync()
        {
            try { await ListenCts.CancelAsync(); } catch { /* best-effort teardown */ }
            try { await ListenTask; } catch { /* best-effort teardown */ }
            try { Network.Dispose(); } catch { /* best-effort teardown */ }
            try { Listener.Stop(); } catch { /* best-effort teardown */ }
            ListenCts.Dispose();
        }
    }

    public static RunningSlave Start(ushort holdingReg0 = 235, ushort holdingReg1 = 0xFFFF)
    {
        var listener = new TcpListener(IPAddress.Loopback, 0);
        listener.Start();
        var port = ((IPEndPoint)listener.LocalEndpoint).Port;

        var factory = new ModbusFactory();
        var network = factory.CreateSlaveNetwork(listener);
        var slave = factory.CreateSlave(unitId: 1);
        slave.DataStore.HoldingRegisters.WritePoints(0, new[] { holdingReg0, holdingReg1 });
        network.AddSlave(slave);

        var cts = new CancellationTokenSource();
        var listenTask = network.ListenAsync(cts.Token);

        return new RunningSlave(port, listener, network, cts, listenTask, slave);
    }
}
