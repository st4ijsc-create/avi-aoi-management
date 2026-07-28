using System.Runtime.CompilerServices;
using St4i.Connector.Abstractions;
using St4i.EdgeCore.Infrastructure;
using St4i.EdgeCore.Models;
using St4i.Connector.Abstractions.Models;
using St4i.EdgeCore.Transport;
using St4i.EngineApi.Fleet;
using Xunit;

namespace St4i.EngineApi.Tests;

/// <summary>
/// GP-4 (.superpowers/sdd/2026-07-28-wsg-plugin-connector-seam-blueprint/task-4-brief.md) — THE actual
/// proof that the connector seam works: a completely made-up, non-built-in connector id
/// (<c>"vendor.acme.widget"</c> — nothing this codebase has ever heard of) gets its own live pipeline slot
/// by nothing more than a <see cref="ConnectorRegistry.Register"/> call, with ZERO change to
/// <see cref="FleetHost"/>'s constructor. Before this task, adding a driver kind meant editing
/// <see cref="FleetHost"/>'s constructor AND its <c>StartLocked</c> method AND <c>Program.cs</c> — this
/// suite constructs a <see cref="FleetHost"/> using only its EXISTING, unchanged
/// <c>connectorRegistry</c> parameter and proves a brand-new connector kind runs, faults in isolation, and
/// is torn down correctly, exactly like the two built-in kinds (Modbus/OPC-UA, covered by their own
/// dedicated suites) — but for an id this codebase's source code has never once mentioned.
/// </summary>
public sealed class FleetHostConnectorRegistryTests
{
    private static readonly TimeSpan PollTimeout = TimeSpan.FromSeconds(10);
    private static readonly TimeSpan PollInterval = TimeSpan.FromMilliseconds(100);
    private const string ThirdPartyKind = "vendor.acme.widget";

    private static FleetHost CreateHost(ConnectorRegistry? connectorRegistry)
    {
        var demo = new DemoTransport(latencyMs: 0);
        var live = LiveTransport.ForMachine("http://localhost:1", mkKey: "", machineCode: "TEST", queuePath: null, verifyTls: true);
        var auto = new AutoTransport(live, demo);
        var switchable = new SwitchableTransport(demo);
        var coordinator = new TransportCoordinator(switchable, demo, live, auto, TransportMode.Demo);
        var eventBus = new EventBus();
        return new FleetHost(switchable, coordinator, eventBus, connectorRegistry: connectorRegistry);
    }

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
    public async Task ThirdPartyStyleConnector_RegisteredWithNoFleetHostChange_ProducesAWorkingSlot()
    {
        // THE seam proof: FleetHost's constructor above is byte-identical to every other test in this
        // solution — no new parameter was added for "vendor.acme.widget". Onboarding this connector was
        // exactly one ConnectorRegistry.Register call.
        var fakeDriver = new CountingDriver(ThirdPartyKind, "WIDGET-01");
        var registry = new ConnectorRegistry();
        registry.Register(new FakeConnectorFactory(ThirdPartyKind, () => fakeDriver), config: "vendor-specific-config-blob");
        var host = CreateHost(registry);

        host.Start();
        try
        {
            Assert.True(host.IsRunning);
            await WaitUntilAsync(() => host.Snapshot().Kpis.Online > 0, "simulated slot online after Start");
            await WaitUntilAsync(() => fakeDriver.Count > 0, "the third-party-style connector's own pipeline slot to actually run");

            Assert.Contains(host.GetDriverHealth(), s => s.Kind == ThirdPartyKind && s.SlotLabel == "vendor.acme.widget");
        }
        finally
        {
            host.Stop();
        }

        Assert.False(host.IsRunning);
        Assert.True(fakeDriver.Disposed, "Stop() must dispose the third-party connector's driver too, same as any built-in one");
    }

    [Fact]
    public async Task TwoIndependentConnectors_BothRegistered_ProduceTwoIndependentSlots()
    {
        var driverA = new CountingDriver("vendor.acme.widget-a", "A-01");
        var driverB = new CountingDriver("vendor.acme.widget-b", "B-01");
        var registry = new ConnectorRegistry();
        registry.Register(new FakeConnectorFactory("vendor.acme.widget-a", () => driverA), config: "a");
        registry.Register(new FakeConnectorFactory("vendor.acme.widget-b", () => driverB), config: "b");
        var host = CreateHost(registry);

        host.Start();
        try
        {
            await WaitUntilAsync(() => driverA.Count > 0, "connector A's slot to run");
            await WaitUntilAsync(() => driverB.Count > 0, "connector B's slot to run");

            var health = host.GetDriverHealth();
            Assert.Contains(health, s => s.Kind == "vendor.acme.widget-a");
            Assert.Contains(health, s => s.Kind == "vendor.acme.widget-b");
            // simulated + 2 connectors = 3 independent slots.
            Assert.Equal(3, health.Count);
        }
        finally
        {
            host.Stop();
        }
    }

    [Fact]
    public async Task ModbusAndOpcUa_BothRegistered_ProduceTwoIndependentSlots()
    {
        // The brief's own acceptance bullet, proven with the two REAL built-in ids (not made-up ones) —
        // complements FleetHostModbusSlotTests/FleetHostOpcUaSlotTests (which each prove one kind in
        // isolation) by proving both together, in the SAME registry, produce two independent slots plus
        // the simulated one — three total, none interfering with the others.
        var modbusDriver = new CountingDriver(DriverKinds.Modbus, "MODBUS-COMBO");
        var opcUaDriver = new CountingDriver(DriverKinds.OpcUa, "OPCUA-COMBO");
        var registry = new ConnectorRegistry();
        registry.Register(new FakeConnectorFactory(DriverKinds.Modbus, () => modbusDriver), config: "modbus-config");
        registry.Register(new FakeConnectorFactory(DriverKinds.OpcUa, () => opcUaDriver), config: "opcua-config");
        var host = CreateHost(registry);

        host.Start();
        try
        {
            Assert.True(host.IsRunning);
            await WaitUntilAsync(() => host.Snapshot().Kpis.Online > 0, "simulated slot online");
            await WaitUntilAsync(() => modbusDriver.Count > 0, "the Modbus slot to run");
            await WaitUntilAsync(() => opcUaDriver.Count > 0, "the OPC-UA slot to run");

            var health = host.GetDriverHealth();
            Assert.Contains(health, s => s.Kind == DriverKinds.Modbus && s.SlotLabel == "modbus");
            Assert.Contains(health, s => s.Kind == DriverKinds.OpcUa && s.SlotLabel == "opcua");
            Assert.Equal(3, health.Count); // simulated + modbus + opcua.
        }
        finally
        {
            host.Stop();
        }

        Assert.False(host.IsRunning);
        Assert.True(modbusDriver.Disposed);
        Assert.True(opcUaDriver.Disposed);
    }

    [Fact]
    public async Task ConnectorFactory_RejectsConfig_LoggedAndSkipped_HostKeepsRunning_SiblingsUnaffected()
    {
        var healthyDriver = new CountingDriver("vendor.acme.healthy", "H-01");
        var registry = new ConnectorRegistry();
        registry.Register(new RejectingConnectorFactory("vendor.acme.broken"), config: "garbage");
        registry.Register(new FakeConnectorFactory("vendor.acme.healthy", () => healthyDriver), config: "fine");
        var host = CreateHost(registry);

        host.Start();
        try
        {
            // Does not crash the host, does not prevent the sibling connector (or the sim fleet) starting.
            Assert.True(host.IsRunning);
            await WaitUntilAsync(() => host.Snapshot().Kpis.Online > 0, "simulated slot online despite a sibling connector's rejected config");
            await WaitUntilAsync(() => healthyDriver.Count > 0, "the healthy sibling connector to run despite the broken one being rejected");

            Assert.DoesNotContain(host.GetDriverHealth(), s => s.Kind == "vendor.acme.broken");
            Assert.Null(host.LastError); // rejection at build time is not a runtime fault.
        }
        finally
        {
            host.Stop();
        }
    }

    [Fact]
    public async Task ConnectorFactory_ThrowsInsteadOfReturningFalse_StillCaughtDefensively_HostKeepsRunning()
    {
        // A third party's factory violating IConnectorFactory.TryCreate's "must not throw" contract — this
        // codebase cannot force good behavior, only defend against bad behavior. FleetHost must catch this
        // itself so a rogue factory can never take down the fleet.
        var healthyDriver = new CountingDriver("vendor.acme.healthy2", "H2-01");
        var registry = new ConnectorRegistry();
        registry.Register(new ThrowingConnectorFactory("vendor.acme.rogue"), config: "anything");
        registry.Register(new FakeConnectorFactory("vendor.acme.healthy2", () => healthyDriver), config: "fine");
        var host = CreateHost(registry);

        host.Start();
        try
        {
            Assert.True(host.IsRunning);
            await WaitUntilAsync(() => host.Snapshot().Kpis.Online > 0, "simulated slot online despite a rogue connector factory throwing");
            await WaitUntilAsync(() => healthyDriver.Count > 0, "the healthy sibling connector to run despite the rogue factory throwing");

            Assert.DoesNotContain(host.GetDriverHealth(), s => s.Kind == "vendor.acme.rogue");
            Assert.Null(host.LastError);
        }
        finally
        {
            host.Stop();
        }
    }

    [Fact]
    public async Task ConnectorFromRegistry_ThrowingDriver_FaultsInIsolation_SimAndSiblingConnectorKeepRunning()
    {
        // Per-slot fault isolation (G2-5) proven for a NON-built-in connector id — confirms nothing about
        // the isolation mechanism is special-cased to "modbus"/"opcua" literals anywhere.
        var healthyDriver = new CountingDriver("vendor.acme.healthy3", "H3-01");
        var faultyDriver = new FaultingDriver("vendor.acme.faulty", faultAfter: 2);
        var registry = new ConnectorRegistry();
        registry.Register(new FakeConnectorFactory("vendor.acme.healthy3", () => healthyDriver), config: "fine");
        registry.Register(new FakeConnectorFactory("vendor.acme.faulty", () => faultyDriver), config: "fine");
        var host = CreateHost(registry);

        host.Start();
        try
        {
            await WaitUntilAsync(() => host.Snapshot().Kpis.Online > 0, "simulated slot online");
            await WaitUntilAsync(() => faultyDriver.HasFaulted, "the faulty connector to reach its simulated fault");
            await WaitUntilAsync(() => host.LastError is not null, "LastError to be set by the faulted connector");

            Assert.True(host.IsRunning, "a faulted connector slot must not flip the aggregate IsRunning false");
            await WaitUntilAsync(() => healthyDriver.Count > 0, "the healthy sibling connector to keep running after the faulty one died");
            Assert.True(host.Snapshot().Kpis.Online > 0);

            Assert.DoesNotContain(host.GetDriverHealth(), s => s.Kind == "vendor.acme.faulty");
            Assert.Contains(host.GetDriverHealth(), s => s.Kind == "vendor.acme.healthy3");
        }
        finally
        {
            host.Stop();
        }
    }

    private sealed class FakeConnectorFactory : IConnectorFactory
    {
        private readonly Func<IDeviceDriver> _build;

        public FakeConnectorFactory(string kind, Func<IDeviceDriver> build)
        {
            Kind = kind;
            _build = build;
        }

        public string Kind { get; }

        public bool TryCreate(string config, out IDeviceDriver? driver, out string? error)
        {
            driver = _build();
            error = null;
            return true;
        }
    }

    private sealed class RejectingConnectorFactory : IConnectorFactory
    {
        public RejectingConnectorFactory(string kind) => Kind = kind;

        public string Kind { get; }

        public bool TryCreate(string config, out IDeviceDriver? driver, out string? error)
        {
            driver = null;
            error = $"RejectingConnectorFactory: '{config}' rejected (test double).";
            return false;
        }
    }

    private sealed class ThrowingConnectorFactory : IConnectorFactory
    {
        public ThrowingConnectorFactory(string kind) => Kind = kind;

        public string Kind { get; }

        public bool TryCreate(string config, out IDeviceDriver? driver, out string? error) =>
            throw new InvalidOperationException("ThrowingConnectorFactory: simulated contract violation (test double) — a real IConnectorFactory must never do this.");
    }

    private sealed class CountingDriver : IDeviceDriver
    {
        private readonly string _machineCode;
        private int _count;
        private volatile bool _disposed;

        public CountingDriver(string kind, string machineCode)
        {
            Kind = kind;
            _machineCode = machineCode;
        }

        public int Count => Volatile.Read(ref _count);
        public bool Disposed => _disposed;
        public string Id => $"fake-{Kind}-driver";
        public string Kind { get; }
        public DriverHealthState Health => DriverHealthState.Connected;

        public async IAsyncEnumerable<DeviceReading> ReadAsync([EnumeratorCancellation] CancellationToken ct)
        {
            while (true)
            {
                ct.ThrowIfCancellationRequested();
                Interlocked.Increment(ref _count);
                yield return new DeviceReading
                {
                    MachineCode = _machineCode,
                    Kind = ReadingKind.Telemetry,
                    SerialNumber = $"SN-{_machineCode}",
                    Timestamp = DateTimeOffset.UtcNow,
                };
                await Task.Delay(TimeSpan.FromMilliseconds(20), ct).ConfigureAwait(false);
            }
        }

        public ValueTask DisposeAsync()
        {
            _disposed = true;
            return ValueTask.CompletedTask;
        }
    }

    private sealed class FaultingDriver : IDeviceDriver
    {
        private readonly int _faultAfter;
        private volatile bool _hasFaulted;

        public FaultingDriver(string kind, int faultAfter)
        {
            Kind = kind;
            _faultAfter = faultAfter;
        }

        public bool HasFaulted => _hasFaulted;
        public string Id => $"faulty-{Kind}-driver";
        public string Kind { get; }
        public DriverHealthState Health => DriverHealthState.Degraded;

        public async IAsyncEnumerable<DeviceReading> ReadAsync([EnumeratorCancellation] CancellationToken ct)
        {
            for (var i = 0; i < _faultAfter; i++)
            {
                ct.ThrowIfCancellationRequested();
                yield return new DeviceReading
                {
                    MachineCode = "VENDOR-FAULTY",
                    Kind = ReadingKind.Telemetry,
                    SerialNumber = "SN-VENDOR-FAULTY",
                    Timestamp = DateTimeOffset.UtcNow,
                };
                await Task.Delay(TimeSpan.FromMilliseconds(20), ct).ConfigureAwait(false);
            }

            _hasFaulted = true;
            throw new InvalidOperationException("FaultingDriver: simulated non-cancellation fault (test double)");
        }

        public ValueTask DisposeAsync() => ValueTask.CompletedTask;
    }
}
