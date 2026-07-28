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
/// (production) FleetHost wiring for an OPC-UA pipeline slot, mirroring
/// <see cref="FleetHostModbusSlotTests"/> exactly: the public <c>OpcUaDriverFactory? opcUaDriverFactory</c>
/// ctor param (the exact seam Program.cs feeds a real <c>OpcUaDriverFactory</c> into once
/// <c>ST4I_OPCUA_ENABLED=true</c> and a node map loads) builds an ADDITIONAL "opcua" pipeline slot alongside
/// the simulated one, and that slot gets the SAME per-slot fault isolation G2-5 proved via its internal
/// test-only seam (<c>FleetHostMultiPipelineFaultIsolationTests</c>) — a fault in the OPC-UA slot must never
/// tear down the simulated fleet. Deliberately decoupled from a real OPC-UA session (that protocol-level
/// proof lives in <c>St4i.EdgeCore.Tests/Drivers/OpcUa/OpcUaDriverLoopbackTests.cs</c>) — a fake
/// <see cref="IDeviceDriver"/>, injected via a small <see cref="OpcUaDriverFactory"/> test subclass (see
/// that class's own "Testability" doc comment for why a subclass, not a bare lambda, is needed here), is
/// enough to prove the WIRING, keeping this suite fast/deterministic with no real sockets/certificates.
/// </summary>
public sealed class FleetHostOpcUaSlotTests
{
    private static readonly TimeSpan PollTimeout = TimeSpan.FromSeconds(10);
    private static readonly TimeSpan PollInterval = TimeSpan.FromMilliseconds(100);

    private static readonly OpcUaNodeMap DummyMap = new()
    {
        MachineCode = "OPCUA-FAKE",
        EndpointUrl = "opc.tcp://unused:0",
        Nodes = new List<OpcUaNode> { new("ns=2;s=Unused", "unused") },
    };

    /// <summary>Same composition as <c>FleetHostModbusSlotTests.CreateHost</c> — default Demo mode, no real
    /// network call ever made by any of these tests — plus the new <c>opcUaDriverFactory</c> ctor param
    /// under test.</summary>
    private static FleetHost CreateHost(OpcUaDriverFactory? opcUaDriverFactory)
    {
        var demo = new DemoTransport(latencyMs: 0);
        var live = LiveTransport.ForMachine("http://localhost:1", mkKey: "", machineCode: "TEST", queuePath: null, verifyTls: true);
        var auto = new AutoTransport(live, demo);
        var switchable = new SwitchableTransport(demo);
        var coordinator = new TransportCoordinator(switchable, demo, live, auto, TransportMode.Demo);
        var eventBus = new EventBus();
        return new FleetHost(switchable, coordinator, eventBus, opcUaDriverFactory: opcUaDriverFactory);
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
    public async Task NoOpcUaDriverFactory_BehavesByteIdentical_NoExtraSlot()
    {
        // The additive/default-off contract: a FleetHost built exactly like every pre-existing test builds
        // one (opcUaDriverFactory left at its default null) must behave exactly as before this task — no
        // extra slot, sim fleet online, clean stop.
        var host = CreateHost(opcUaDriverFactory: null);

        host.Start();
        try
        {
            await WaitUntilAsync(() => host.Snapshot().Kpis.Online > 0, "simulated slot online after Start with no opc-ua factory wired");
            Assert.True(host.IsRunning);
        }
        finally
        {
            host.Stop();
        }

        Assert.False(host.IsRunning);
    }

    [Fact]
    public async Task OpcUaDriverFactory_BuildsAdditionalSlot_RunsAlongsideSimulatedFleet()
    {
        var fakeDriver = new CountingFakeOpcUaDriver();
        var host = CreateHost(new FakeOpcUaDriverFactory(fakeDriver));

        host.Start();
        try
        {
            Assert.True(host.IsRunning);
            await WaitUntilAsync(() => host.Snapshot().Kpis.Online > 0, "simulated slot online after Start");
            await WaitUntilAsync(() => fakeDriver.Count > 0, "the opc-ua-wired fake driver producing readings, proving its own pipeline slot actually runs");
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
    public async Task OpcUaDriverFactory_ThrowingDriver_FaultsInIsolation_SimKeepsRunning()
    {
        var faultyDriver = new FaultingFakeOpcUaDriver(faultAfter: 2);
        var host = CreateHost(new FakeOpcUaDriverFactory(faultyDriver));

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

    /// <summary>Test double for <see cref="OpcUaDriverFactory"/> — see that class's own "Testability" doc
    /// comment: <see cref="OpcUaDriverFactory.Create"/> is <see langword="virtual"/> specifically so this
    /// subclass can return a fake driver instead of a real <see cref="OpcUaDriver"/>.</summary>
    private sealed class FakeOpcUaDriverFactory : OpcUaDriverFactory
    {
        private readonly IDeviceDriver _driver;

        public FakeOpcUaDriverFactory(IDeviceDriver driver) : base(DummyMap) => _driver = driver;

        public override IDeviceDriver Create() => _driver;
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
