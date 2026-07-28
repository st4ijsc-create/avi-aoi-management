using System.Runtime.CompilerServices;
using St4i.Connector.Abstractions;
using St4i.EdgeCore.Drivers.Modbus;
using St4i.EdgeCore.Infrastructure;
using St4i.EdgeCore.Models;
using St4i.Connector.Abstractions.Models;
using St4i.EdgeCore.Transport;
using St4i.EngineApi.Fleet;
using Xunit;

namespace St4i.EngineApi.Tests;

/// <summary>
/// G2-6 (WS-H, docs/plans/2026-07-27-giaidoan2-synapse-connect-blueprint.md task 6) — proves the REAL
/// (production) FleetHost wiring for a Modbus pipeline slot. GP-4
/// (.superpowers/sdd/2026-07-28-wsg-plugin-connector-seam-blueprint/task-4-brief.md) migrated this from a
/// dedicated <c>Func&lt;IDeviceDriver&gt;? modbusDriverFactory</c> constructor parameter onto the
/// connector-id-keyed <see cref="ConnectorRegistry"/> (the exact seam Program.cs feeds a real
/// <see cref="ModbusConnectorFactory"/> into once <c>ST4I_MODBUS_ENABLED=true</c> and a register map
/// loads): a <see cref="ConnectorRegistry"/> with a Modbus entry registered builds an ADDITIONAL "modbus"
/// pipeline slot alongside the simulated one, and that slot gets the SAME per-slot fault isolation G2-5
/// proved via its internal test-only seam (<c>FleetHostMultiPipelineFaultIsolationTests</c>) — a fault in
/// the Modbus slot must never tear down the simulated fleet. Deliberately decoupled from NModbus/the real
/// loopback slave (that protocol-level proof lives in
/// <c>St4i.EdgeCore.Tests/Drivers/Modbus/ModbusTcpDriverLoopbackTests.cs</c>) — a fake
/// <see cref="IDeviceDriver"/>, wrapped in a tiny <see cref="IConnectorFactory"/> test double, is enough to
/// prove the WIRING, keeping this suite fast/deterministic with no real sockets.
/// </summary>
public sealed class FleetHostModbusSlotTests
{
    private static readonly TimeSpan PollTimeout = TimeSpan.FromSeconds(10);
    private static readonly TimeSpan PollInterval = TimeSpan.FromMilliseconds(100);

    /// <summary>Same composition as <c>FleetHostHealthAndRegistrationTests.CreateHost</c>/
    /// <c>FleetHostMultiPipelineFaultIsolationTests.CreateHost</c> — default Demo mode, no real network
    /// call ever made by any of these tests — plus the new <c>connectorRegistry</c> ctor param under test.</summary>
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
    public async Task NoConnectorRegistry_BehavesByteIdentical_NoExtraSlot()
    {
        // The additive/default-off contract: a FleetHost built exactly like every pre-existing test builds
        // one (connectorRegistry left at its default null) must behave exactly as before this task — no
        // extra slot, sim fleet online, clean stop.
        var host = CreateHost(connectorRegistry: null);

        host.Start();
        try
        {
            await WaitUntilAsync(() => host.Snapshot().Kpis.Online > 0, "simulated slot online after Start with no connector registry wired");
            Assert.True(host.IsRunning);
        }
        finally
        {
            host.Stop();
        }

        Assert.False(host.IsRunning);
    }

    [Fact]
    public async Task EmptyConnectorRegistry_BehavesByteIdentical_NoExtraSlot()
    {
        // A registry that exists but has nothing registered in it must ALSO behave exactly as before —
        // the registry itself is never the thing that turns Modbus "on"; a registered entry is.
        var host = CreateHost(new ConnectorRegistry());

        host.Start();
        try
        {
            await WaitUntilAsync(() => host.Snapshot().Kpis.Online > 0, "simulated slot online with an empty connector registry wired");
            Assert.True(host.IsRunning);
            Assert.DoesNotContain(host.GetDriverHealth(), s => s.Kind == DriverKinds.Modbus);
        }
        finally
        {
            host.Stop();
        }

        Assert.False(host.IsRunning);
    }

    [Fact]
    public async Task ModbusRegistered_BuildsAdditionalSlot_RunsAlongsideSimulatedFleet()
    {
        var fakeDriver = new CountingFakeModbusDriver();
        var registry = new ConnectorRegistry();
        registry.Register(new FakeModbusConnectorFactory(() => fakeDriver), config: "unused");
        var host = CreateHost(registry);

        host.Start();
        try
        {
            Assert.True(host.IsRunning);
            await WaitUntilAsync(() => host.Snapshot().Kpis.Online > 0, "simulated slot online after Start");
            await WaitUntilAsync(() => fakeDriver.Count > 0, "the modbus-wired fake driver producing readings, proving its own pipeline slot actually runs");

            // The slot label reproduces today's exact "modbus" literal (see ConnectorRegistry's own
            // remarks on why the label is the connector id lowercased) — not a new naming scheme.
            Assert.Contains(host.GetDriverHealth(), s => s.SlotLabel == "modbus" && s.Kind == DriverKinds.Modbus);
        }
        finally
        {
            host.Stop();
        }

        Assert.False(host.IsRunning, "Stop() must tear down every slot, including the modbus one");

        // Review fix (the driver-disposal socket leak — ModbusTcpDriver is the first slot driver that owns
        // a live resource cancelling the slot's CTS alone doesn't release): FleetHost.Stop() is synchronous
        // and its WaitAndDisposeOldPipeline teardown disposes each slot's driver BEFORE returning, so this
        // needs no bounded wait — by the time Stop() has returned, the modbus slot's driver must already be
        // disposed.
        Assert.True(fakeDriver.Disposed, "Stop() must dispose the modbus slot's driver, not just cancel its CTS");
    }

    [Fact]
    public async Task ModbusRegistered_ThrowingDriver_FaultsInIsolation_SimKeepsRunning()
    {
        var faultyDriver = new FaultingFakeModbusDriver(faultAfter: 2);
        var registry = new ConnectorRegistry();
        registry.Register(new FakeModbusConnectorFactory(() => faultyDriver), config: "unused");
        var host = CreateHost(registry);

        host.Start();
        try
        {
            await WaitUntilAsync(() => host.Snapshot().Kpis.Online > 0, "simulated slot online after Start");
            await WaitUntilAsync(() => faultyDriver.HasFaulted, "the modbus-wired fake driver to reach its simulated fault");
            await WaitUntilAsync(() => host.LastError is not null, "LastError to be set by the faulted modbus slot");

            // The load-bearing assertion — G2-5's isolation payoff for a real second driver kind: a fault
            // in the Modbus slot must never tear down the simulated fleet.
            Assert.True(host.IsRunning, "a faulted modbus slot must not flip the aggregate IsRunning false while the sim slot is alive");
            Assert.True(host.Snapshot().Kpis.Online > 0, "the simulated slot must keep producing after the modbus slot faulted");

            // Review fix — the self-faulted slot's own catch handler (StartSlot) must ALSO dispose its
            // driver (not just remove it from _slots), same leak-closing fix as the Stop()/restart path.
            // That dispose runs on the background fault-catch task, off-lock, AFTER LastError is observed —
            // so this needs the bounded wait, unlike the synchronous Stop() path in the sibling test above.
            await WaitUntilAsync(() => faultyDriver.Disposed, "the self-faulted modbus slot's own driver to be disposed by its fault-catch handler");
        }
        finally
        {
            host.Stop();
        }
    }

    [Fact]
    public async Task ModbusFactory_RejectsItsOwnConfig_LogsAndSkipsWithoutCrashing_SimStillStarts()
    {
        // The "malformed map file" scenario, reproduced through the registry seam directly rather than a
        // real bad JSON file: TryCreate reports failure (never throws), FleetHost must log it, skip the
        // Modbus slot, and still start the simulated fleet fine — exactly today's "disables that driver
        // for this run without crashing the host" behavior.
        var registry = new ConnectorRegistry();
        registry.Register(new RejectingConnectorFactory(DriverKinds.Modbus), config: "not a real register map");
        var host = CreateHost(registry);

        host.Start();
        try
        {
            await WaitUntilAsync(() => host.Snapshot().Kpis.Online > 0, "simulated slot online despite the rejected Modbus config");
            Assert.True(host.IsRunning);
            Assert.DoesNotContain(host.GetDriverHealth(), s => s.Kind == DriverKinds.Modbus);
            Assert.Null(host.LastError); // a build-time rejection must never be mistaken for a runtime fault.
        }
        finally
        {
            host.Stop();
        }
    }

    /// <summary>Test double for <see cref="IConnectorFactory"/> — mirrors production's
    /// <see cref="ModbusConnectorFactory"/> shape (a factory that reports <see cref="DriverKinds.Modbus"/>
    /// and always succeeds), but hands back a caller-supplied fake driver instead of a real
    /// <c>ModbusTcpDriver</c>.</summary>
    private sealed class FakeModbusConnectorFactory : IConnectorFactory
    {
        private readonly Func<IDeviceDriver> _build;

        public FakeModbusConnectorFactory(Func<IDeviceDriver> build) => _build = build;

        public string Kind => DriverKinds.Modbus;

        public bool TryCreate(string config, out IDeviceDriver? driver, out string? error)
        {
            driver = _build();
            error = null;
            return true;
        }
    }

    /// <summary>Test double for <see cref="IConnectorFactory"/> — always rejects its configuration, the
    /// documented non-throwing shape of "I could not build a driver from this config."</summary>
    private sealed class RejectingConnectorFactory : IConnectorFactory
    {
        public RejectingConnectorFactory(string kind) => Kind = kind;

        public string Kind { get; }

        public bool TryCreate(string config, out IDeviceDriver? driver, out string? error)
        {
            driver = null;
            error = $"RejectingConnectorFactory: '{config}' is not a valid configuration (test double).";
            return false;
        }
    }

    /// <summary>Test double — an <see cref="IDeviceDriver"/> that yields a Telemetry reading on a short
    /// interval forever (until cancelled), incrementing a thread-safe counter so a test can observe "the
    /// modbus-wired slot is genuinely running", mirroring <c>FleetHostMultiPipelineFaultIsolationTests</c>'s
    /// own <c>HealthyCountingDriver</c> shape.</summary>
    private sealed class CountingFakeModbusDriver : IDeviceDriver
    {
        private int _count;
        private volatile bool _disposed;

        public int Count => Volatile.Read(ref _count);

        /// <summary>Review fix — set by <see cref="DisposeAsync"/>, so a test can prove FleetHost actually
        /// calls it (not just cancels the slot's CTS) on Stop()/restart.</summary>
        public bool Disposed => _disposed;

        public string Id => "fake-modbus-test-driver";

        public string Kind => DriverKinds.Modbus;

        public DriverHealthState Health => DriverHealthState.Connected;

        public async IAsyncEnumerable<DeviceReading> ReadAsync([EnumeratorCancellation] CancellationToken ct)
        {
            while (true)
            {
                ct.ThrowIfCancellationRequested();
                Interlocked.Increment(ref _count);
                yield return new DeviceReading
                {
                    MachineCode = "MODBUS-FAKE",
                    Kind = ReadingKind.Telemetry,
                    SerialNumber = "SN-MODBUS-FAKE",
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

    /// <summary>Test double — yields <paramref name="faultAfter"/>-worth of Telemetry readings then throws
    /// a plain (non-<see cref="OperationCanceledException"/>) exception, mirroring
    /// <c>FleetHostMultiPipelineFaultIsolationTests</c>'s own <c>FaultingAfterNDriver</c> — the shape a real
    /// flaky OT driver would produce mid-run.</summary>
    private sealed class FaultingFakeModbusDriver : IDeviceDriver
    {
        private readonly int _faultAfter;
        private volatile bool _hasFaulted;
        private volatile bool _disposed;

        public FaultingFakeModbusDriver(int faultAfter) => _faultAfter = faultAfter;

        public bool HasFaulted => _hasFaulted;

        /// <summary>Review fix — set by <see cref="DisposeAsync"/>, so a test can prove the slot's own
        /// fault-catch handler (not just <c>Stop()</c>/restart) disposes the driver too.</summary>
        public bool Disposed => _disposed;

        public string Id => "fake-faulty-modbus-test-driver";

        public string Kind => DriverKinds.Modbus;

        public DriverHealthState Health => DriverHealthState.Degraded;

        public async IAsyncEnumerable<DeviceReading> ReadAsync([EnumeratorCancellation] CancellationToken ct)
        {
            for (var i = 0; i < _faultAfter; i++)
            {
                ct.ThrowIfCancellationRequested();
                yield return new DeviceReading
                {
                    MachineCode = "MODBUS-FAULTY",
                    Kind = ReadingKind.Telemetry,
                    SerialNumber = "SN-MODBUS-FAULTY",
                    Timestamp = DateTimeOffset.UtcNow,
                };
                await Task.Delay(TimeSpan.FromMilliseconds(20), ct).ConfigureAwait(false);
            }

            _hasFaulted = true;
            throw new InvalidOperationException("FaultingFakeModbusDriver: simulated non-cancellation fault (test double)");
        }

        public ValueTask DisposeAsync()
        {
            _disposed = true;
            return ValueTask.CompletedTask;
        }
    }
}
