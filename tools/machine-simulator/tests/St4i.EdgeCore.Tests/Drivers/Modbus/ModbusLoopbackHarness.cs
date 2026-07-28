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

    /// <summary>A running slave plus everything needed to tear it down. Exposes its pieces individually
    /// (rather than only a single <see cref="DisposeAsync"/>) so a caller that needs to kill the slave OUT
    /// FROM UNDER a driver mid-test (as <see cref="ModbusTcpDriverLoopbackTests"/>'s fault-injection test
    /// does) can still do so with the exact same sequencing it always used.</summary>
    public sealed class RunningSlave(int port, TcpListener listener, IDisposable network, CancellationTokenSource listenCts, Task listenTask)
        : IAsyncDisposable
    {
        public int Port { get; } = port;

        public TcpListener Listener { get; } = listener;

        public IDisposable Network { get; } = network;

        public CancellationTokenSource ListenCts { get; } = listenCts;

        public Task ListenTask { get; } = listenTask;

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

        return new RunningSlave(port, listener, network, cts, listenTask);
    }
}
