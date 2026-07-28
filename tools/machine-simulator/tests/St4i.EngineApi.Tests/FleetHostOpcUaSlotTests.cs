using System.Runtime.CompilerServices;
using St4i.Connector.Abstractions;
using St4i.EdgeCore.Drivers.OpcUa;
using St4i.EdgeCore.Infrastructure;
using St4i.EdgeCore.Models;
using St4i.Connector.Abstractions.Models;
using St4i.EdgeCore.Transport;
using St4i.EngineApi.Fleet;
using Xunit;

namespace St4i.EngineApi.Tests;

/// <summary>
/// GĐ3 sub-3 OU-1 (docs/plans/2026-07-27-giaidoan3-opcua-driver-blueprint.md task 1) — proves the REAL
/// (production) FleetHost wiring for an OPC-UA pipeline slot. GP-4
/// (.superpowers/sdd/2026-07-28-wsg-plugin-connector-seam-blueprint/task-4-brief.md) migrated this from a
/// dedicated <c>OpcUaDriverFactory? opcUaDriverFactory</c> constructor parameter onto the connector-id-keyed
/// <see cref="ConnectorRegistry"/>, mirroring <see cref="FleetHostModbusSlotTests"/> exactly: a
/// <see cref="ConnectorRegistry"/> with an OPC-UA entry registered (the exact seam Program.cs feeds a real
/// <see cref="OpcUaConnectorFactory"/> into once <c>ST4I_OPCUA_ENABLED=true</c> and a node map loads) builds
/// an ADDITIONAL "opcua" pipeline slot alongside the simulated one, and that slot gets the SAME per-slot
/// fault isolation G2-5 proved via its internal test-only seam (<c>FleetHostMultiPipelineFaultIsolationTests</c>)
/// — a fault in the OPC-UA slot must never tear down the simulated fleet. Deliberately decoupled from a
/// real OPC-UA session (that protocol-level proof lives in
/// <c>St4i.EdgeCore.Tests/Drivers/OpcUa/OpcUaDriverLoopbackTests.cs</c>) — a fake <see cref="IDeviceDriver"/>,
/// wrapped in a tiny <see cref="IConnectorFactory"/> test double, is enough to prove the WIRING, keeping
/// this suite fast/deterministic with no real sockets/certificates.
/// </summary>
public sealed class FleetHostOpcUaSlotTests
{
    private static readonly TimeSpan PollTimeout = TimeSpan.FromSeconds(10);
    private static readonly TimeSpan PollInterval = TimeSpan.FromMilliseconds(100);

    /// <summary>Same composition as <c>FleetHostModbusSlotTests.CreateHost</c> — default Demo mode, no real
    /// network call ever made by any of these tests — plus the new <c>connectorRegistry</c> ctor param
    /// under test.</summary>
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
    public async Task OpcUaRegistered_BuildsAdditionalSlot_RunsAlongsideSimulatedFleet()
    {
        var fakeDriver = new CountingFakeOpcUaDriver();
        var registry = new ConnectorRegistry();
        registry.Register(new FakeOpcUaConnectorFactory(() => fakeDriver), config: "unused");
        var host = CreateHost(registry);

        host.Start();
        try
        {
            Assert.True(host.IsRunning);
            await WaitUntilAsync(() => host.Snapshot().Kpis.Online > 0, "simulated slot online after Start");
            await WaitUntilAsync(() => fakeDriver.Count > 0, "the opc-ua-wired fake driver producing readings, proving its own pipeline slot actually runs");

            // The slot label reproduces today's exact "opcua" literal (see ConnectorRegistry's own remarks
            // on why the label is the connector id lowercased) — not a new naming scheme.
            Assert.Contains(host.GetDriverHealth(), s => s.SlotLabel == "opcua" && s.Kind == DriverKinds.OpcUa);
        }
        finally
        {
            host.Stop();
        }

        Assert.False(host.IsRunning, "Stop() must tear down every slot, including the opc-ua one");

        // Same review-fix reasoning as FleetHostModbusSlotTests: FleetHost.Stop() is synchronous and its
        // WaitAndDisposeOldPipeline teardown disposes each slot's driver BEFORE returning, so this needs no
        // bounded wait — by the time Stop() has returned, the opc-ua slot's driver must already be disposed.
        Assert.True(fakeDriver.Disposed, "Stop() must dispose the opc-ua slot's driver, not just cancel its CTS");
    }

    [Fact]
    public async Task OpcUaRegistered_ThrowingDriver_FaultsInIsolation_SimKeepsRunning()
    {
        var faultyDriver = new FaultingFakeOpcUaDriver(faultAfter: 2);
        var registry = new ConnectorRegistry();
        registry.Register(new FakeOpcUaConnectorFactory(() => faultyDriver), config: "unused");
        var host = CreateHost(registry);

        host.Start();
        try
        {
            await WaitUntilAsync(() => host.Snapshot().Kpis.Online > 0, "simulated slot online after Start");
            await WaitUntilAsync(() => faultyDriver.HasFaulted, "the opc-ua-wired fake driver to reach its simulated fault");
            await WaitUntilAsync(() => host.LastError is not null, "LastError to be set by the faulted opc-ua slot");

            // The load-bearing assertion — G2-5's isolation payoff for the OPC-UA slot: a fault there must
            // never tear down the simulated fleet.
            Assert.True(host.IsRunning, "a faulted opc-ua slot must not flip the aggregate IsRunning false while the sim slot is alive");
            Assert.True(host.Snapshot().Kpis.Online > 0, "the simulated slot must keep producing after the opc-ua slot faulted");

            await WaitUntilAsync(() => faultyDriver.Disposed, "the self-faulted opc-ua slot's own driver to be disposed by its fault-catch handler");
        }
        finally
        {
            host.Stop();
        }
    }

    [Fact]
    public async Task OpcUaFactory_RejectsItsOwnConfig_LogsAndSkipsWithoutCrashing_SimStillStarts()
    {
        // The "malformed node map file" scenario, reproduced through the registry seam directly rather
        // than a real bad JSON file: TryCreate reports failure (never throws), FleetHost must log it, skip
        // the OPC-UA slot, and still start the simulated fleet fine — exactly today's "disables that
        // driver for this run without crashing the host" behavior.
        var registry = new ConnectorRegistry();
        registry.Register(new RejectingConnectorFactory(DriverKinds.OpcUa), config: "not a real node map");
        var host = CreateHost(registry);

        host.Start();
        try
        {
            await WaitUntilAsync(() => host.Snapshot().Kpis.Online > 0, "simulated slot online despite the rejected OPC-UA config");
            Assert.True(host.IsRunning);
            Assert.DoesNotContain(host.GetDriverHealth(), s => s.Kind == DriverKinds.OpcUa);
            Assert.Null(host.LastError); // a build-time rejection must never be mistaken for a runtime fault.
        }
        finally
        {
            host.Stop();
        }
    }

    /// <summary>Test double for <see cref="IConnectorFactory"/> — mirrors production's
    /// <see cref="OpcUaConnectorFactory"/> shape (a factory that reports <see cref="DriverKinds.OpcUa"/>
    /// and always succeeds), but hands back a caller-supplied fake driver instead of a real
    /// <c>OpcUaDriver</c>.</summary>
    private sealed class FakeOpcUaConnectorFactory : IConnectorFactory
    {
        private readonly Func<IDeviceDriver> _build;

        public FakeOpcUaConnectorFactory(Func<IDeviceDriver> build) => _build = build;

        public string Kind => DriverKinds.OpcUa;

        public bool TryCreate(string config, out IDeviceDriver? driver, out string? error)
        {
            driver = _build();
            error = null;
            return true;
        }
    }

    /// <summary>Test double for <see cref="IConnectorFactory"/> — always rejects its configuration, the
    /// documented non-throwing shape of "I could not build a driver from this config." Shared shape with
    /// <c>FleetHostModbusSlotTests</c>'s own copy (kept private per-file, same as this codebase's other
    /// small per-suite test doubles, to avoid a cross-suite production-code-shaped dependency for a
    /// two-line fake).</summary>
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
    /// opc-ua-wired slot is genuinely running", mirroring <c>FleetHostModbusSlotTests</c>'s own
    /// <c>CountingFakeModbusDriver</c> shape.</summary>
    private sealed class CountingFakeOpcUaDriver : IDeviceDriver
    {
        private int _count;
        private volatile bool _disposed;

        public int Count => Volatile.Read(ref _count);

        public bool Disposed => _disposed;

        public string Id => "fake-opcua-test-driver";

        public string Kind => DriverKinds.OpcUa;

        public DriverHealthState Health => DriverHealthState.Connected;

        public async IAsyncEnumerable<DeviceReading> ReadAsync([EnumeratorCancellation] CancellationToken ct)
        {
            while (true)
            {
                ct.ThrowIfCancellationRequested();
                Interlocked.Increment(ref _count);
                yield return new DeviceReading
                {
                    MachineCode = "OPCUA-FAKE",
                    Kind = ReadingKind.Telemetry,
                    Verdict = Verdict.Skip,
                    SerialNumber = "SN-OPCUA-FAKE",
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
    /// <c>FleetHostModbusSlotTests</c>'s own <c>FaultingFakeModbusDriver</c> — the shape a real flaky OPC-UA
    /// session fault would produce mid-run.</summary>
    private sealed class FaultingFakeOpcUaDriver : IDeviceDriver
    {
        private readonly int _faultAfter;
        private volatile bool _hasFaulted;
        private volatile bool _disposed;

        public FaultingFakeOpcUaDriver(int faultAfter) => _faultAfter = faultAfter;

        public bool HasFaulted => _hasFaulted;

        public bool Disposed => _disposed;

        public string Id => "fake-faulty-opcua-test-driver";

        public string Kind => DriverKinds.OpcUa;

        public DriverHealthState Health => DriverHealthState.Degraded;

        public async IAsyncEnumerable<DeviceReading> ReadAsync([EnumeratorCancellation] CancellationToken ct)
        {
            for (var i = 0; i < _faultAfter; i++)
            {
                ct.ThrowIfCancellationRequested();
                yield return new DeviceReading
                {
                    MachineCode = "OPCUA-FAULTY",
                    Kind = ReadingKind.Telemetry,
                    Verdict = Verdict.Skip,
                    SerialNumber = "SN-OPCUA-FAULTY",
                    Timestamp = DateTimeOffset.UtcNow,
                };
                await Task.Delay(TimeSpan.FromMilliseconds(20), ct).ConfigureAwait(false);
            }

            _hasFaulted = true;
            throw new InvalidOperationException("FaultingFakeOpcUaDriver: simulated non-cancellation fault (test double)");
        }

        public ValueTask DisposeAsync()
        {
            _disposed = true;
            return ValueTask.CompletedTask;
        }
    }
}
