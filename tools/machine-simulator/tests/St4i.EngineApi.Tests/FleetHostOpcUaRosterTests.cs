using System.Runtime.CompilerServices;
using St4i.Connector.Abstractions;
using St4i.EdgeCore.Drivers.OpcUa;
using St4i.EdgeCore.Infrastructure;
using St4i.EdgeCore.Models;
using St4i.Connector.Abstractions.Models;
using St4i.EdgeCore.Transport;
using St4i.EngineApi.AssetRegistry;
using St4i.EngineApi.Fleet;
using Xunit;

namespace St4i.EngineApi.Tests;

/// <summary>
/// GĐ3 sub-3 OU-2 PART B (docs/plans/2026-07-27-giaidoan3-opcua-driver-blueprint.md task 2) — proves a
/// configured OPC-UA (OU-1) machine becomes a first-class, UI-visible roster member instead of an
/// invisible telemetry stream, mirroring <see cref="FleetHostModbusRosterTests"/>'s P2-3 contract
/// exactly: (1) <see cref="FleetHost.StartLocked"/> must NOT build a simulator for a
/// <see cref="DriverKind.OpcUa"/> roster entry (else it's driven TWICE — once by a simulator, once by
/// the real OPC-UA pipeline slot) — proven here by registering an OPC-UA descriptor with NO
/// <see cref="OpcUaDriverFactory"/> wired and confirming it stays idle/0-cycles forever, never picked up
/// by <c>SimulatorFactory</c>'s <c>DeviceClass.Automation</c> fallback; (2) once a real (here: fake)
/// OPC-UA driver factory IS wired, the SAME registered descriptor cycles — proving it's driven by the
/// OPC-UA slot, not simulated — while the ordinary simulated roster is completely unaffected either way.
/// Uses the same <c>CreateHost</c>/<c>WaitUntilAsync</c> composition as
/// <see cref="FleetHostOpcUaSlotTests"/>/<see cref="FleetHostModbusRosterTests"/>.
/// </summary>
public sealed class FleetHostOpcUaRosterTests
{
    private static readonly TimeSpan PollTimeout = TimeSpan.FromSeconds(10);
    private static readonly TimeSpan PollInterval = TimeSpan.FromMilliseconds(100);

    private const string OpcUaCode = "OPCUA-ROSTER-01";

    private static readonly OpcUaNodeMap DummyMap = new()
    {
        MachineCode = "OPCUA-ROSTER-DUMMY",
        EndpointUrl = "opc.tcp://unused:0",
        Nodes = new List<OpcUaNode> { new("ns=2;s=Unused", "unused") },
    };

    private static FleetHost CreateHost(OpcUaDriverFactory? opcUaDriverFactory = null, IAssetRegistry? assetRegistry = null)
    {
        var demo = new DemoTransport(latencyMs: 0);
        var live = LiveTransport.ForMachine("http://localhost:1", mkKey: "", machineCode: "TEST", queuePath: null, verifyTls: true);
        var auto = new AutoTransport(live, demo);
        var switchable = new SwitchableTransport(demo);
        var coordinator = new TransportCoordinator(switchable, demo, live, auto, TransportMode.Demo);
        var eventBus = new EventBus();
        return new FleetHost(switchable, coordinator, eventBus, opcUaDriverFactory: opcUaDriverFactory, assetRegistry: assetRegistry);
    }

    /// <summary>Mirrors the shape Program.cs's own seed descriptor construction builds (see the brief /
    /// Program.cs's <c>opcUaSeedDescriptor</c>) — <c>MachineType: "OPC_UA"</c>, <c>DeviceClass.Automation</c>,
    /// no StepType/RecipeCode/MappingProfile. CycleSeconds is irrelevant to the exclusion test (a
    /// DriverKind.OpcUa descriptor is never handed to SimulatorFactory in the first place once the fix is
    /// applied) but must still be a sane positive value, matching <c>Math.Max(0.1, pollMs/1000.0)</c>.</summary>
    private static MachineDescriptor NewOpcUaDescriptor(string code = OpcUaCode) => new(
        Code: code,
        SerialSeed: $"SN-{code}",
        DeviceClass: DeviceClass.Automation,
        MachineType: "OPC_UA",
        StepType: null,
        DriverKind: DriverKind.OpcUa,
        RecipeCode: null,
        MappingProfile: null,
        CycleSeconds: 1.0);

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
    public async Task OpcUaRosterMember_NoOpcUaFactory_ExcludedFromSimulation_StaysIdle_SimFleetUnaffected()
    {
        var host = CreateHost(opcUaDriverFactory: null);
        var added = host.RegisterMachine(NewOpcUaDescriptor());
        Assert.True(added);

        host.Start();
        try
        {
            // The default (fleet.json-fallback) roster's own SCRW-01 must cycle normally — proves the
            // exclusion doesn't touch the simulated group at all.
            await WaitUntilAsync(() => (host.MachineDetail("SCRW-01")?.Cycles ?? 0) > 0, "SCRW-01 (simulated) to cycle normally");

            // The load-bearing assertion: the OPC-UA roster member has its OWN tile (roster-seeding
            // worked) but NO driver ever produced a reading for it (the exclusion worked) — it never left
            // "Idle"/0 cycles, even though the fleet has been running and cycling for a while.
            var snapshot = host.Snapshot();
            var opcUaTile = Assert.Single(snapshot.Machines, m => m.Code == OpcUaCode);
            Assert.Equal(0, opcUaTile.Cycles);
            Assert.Equal("Idle", opcUaTile.StatusText);
            Assert.Equal(DriverKind.OpcUa, opcUaTile.DriverKind);

            // Double-check after a further short wait — not a one-off race where it just hasn't cycled
            // YET, but a durable "never driven" state for as long as no opc-ua factory is wired.
            await Task.Delay(TimeSpan.FromMilliseconds(300));
            Assert.Equal(0, host.MachineDetail(OpcUaCode)?.Cycles ?? -1);
        }
        finally
        {
            host.Stop();
        }
    }

    [Fact]
    public async Task OpcUaRosterMember_WithOpcUaFactory_DrivenBySlot_Cycles_SimFleetUnaffected()
    {
        var fakeDriver = new RosterFakeOpcUaDriver(OpcUaCode);
        var host = CreateHost(opcUaDriverFactory: new FakeOpcUaDriverFactory(fakeDriver));
        var added = host.RegisterMachine(NewOpcUaDescriptor());
        Assert.True(added);

        host.Start();
        try
        {
            // Driven by the (fake) OPC-UA slot, not a simulator — proves the roster member is now a
            // genuine live tile once the real pipeline slot is wired, exactly like a normal machine.
            await WaitUntilAsync(() => (host.MachineDetail(OpcUaCode)?.Cycles ?? 0) > 0, "the OPC-UA roster member to cycle via the opc-ua slot");

            // The ordinary simulated roster keeps running unaffected alongside it.
            await WaitUntilAsync(() => (host.MachineDetail("SCRW-01")?.Cycles ?? 0) > 0, "SCRW-01 (simulated) to keep cycling alongside the OPC-UA slot");
            Assert.True(host.Snapshot().Kpis.Online > 0);
        }
        finally
        {
            host.Stop();
        }
    }

    [Fact]
    public async Task NoOpcUaDescriptor_NoOpcUaFactory_BehavesExactlyAsBeforeThisTask()
    {
        // Additive/default sanity (already covered by FleetHostOpcUaSlotTests — repeated here, cheaply, as
        // this suite's own belt-and-suspenders check): a FleetHost with no OPC-UA roster member and no
        // OPC-UA factory must behave exactly as it did before this task existed.
        var host = CreateHost();

        host.Start();
        try
        {
            await WaitUntilAsync(() => host.Snapshot().Kpis.Online > 0, "simulated fleet online, unaffected by this task's changes");
            Assert.True(host.IsRunning);
        }
        finally
        {
            host.Stop();
        }

        Assert.False(host.IsRunning);
    }

    [Fact]
    public async Task OpcUaRosterMember_RegisteredWithAssetRegistry_UpsertsAssetAsOpcUaDriverKind()
    {
        var registry = new FakeAssetRegistry();
        var host = CreateHost(assetRegistry: registry);

        var added = host.RegisterMachine(NewOpcUaDescriptor());
        Assert.True(added);

        await WaitUntilAsync(() => registry.Upserted.ContainsKey(OpcUaCode), "the OPC-UA descriptor to be upserted into the asset registry");
        Assert.Equal(DriverKind.OpcUa, registry.Upserted[OpcUaCode].DriverKind);
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

    /// <summary>Test double — an <see cref="IDeviceDriver"/> that yields a Telemetry reading for
    /// <paramref name="machineCode"/> on a short interval forever (until cancelled), with a genuinely
    /// incrementing <see cref="DeviceReading.CycleCounter"/> so the registered <see cref="MachineState"/>'s
    /// own <c>Cycles</c> (derived from that counter — see <c>MachineState.ApplyReading</c>) actually climbs,
    /// unlike <c>FleetHostOpcUaSlotTests.CountingFakeOpcUaDriver</c> (which only proves the SLOT ran, not
    /// that a registered roster member's tile reflects it).</summary>
    private sealed class RosterFakeOpcUaDriver : IDeviceDriver
    {
        private readonly string _machineCode;
        private long _counter;

        public RosterFakeOpcUaDriver(string machineCode) => _machineCode = machineCode;

        public string Id => "fake-roster-opcua-test-driver";

        public DriverKind Kind => DriverKind.OpcUa;

        public DriverHealthState Health => DriverHealthState.Connected;

        public async IAsyncEnumerable<DeviceReading> ReadAsync([EnumeratorCancellation] CancellationToken ct)
        {
            while (true)
            {
                ct.ThrowIfCancellationRequested();
                yield return new DeviceReading
                {
                    MachineCode = _machineCode,
                    Kind = ReadingKind.Telemetry,
                    SerialNumber = $"SN-{_machineCode}",
                    Verdict = Verdict.Skip,
                    CycleCounter = Interlocked.Increment(ref _counter),
                    Timestamp = DateTimeOffset.UtcNow,
                };
                await Task.Delay(TimeSpan.FromMilliseconds(20), ct).ConfigureAwait(false);
            }
        }

        public ValueTask DisposeAsync() => ValueTask.CompletedTask;
    }

    /// <summary>Minimal in-memory <see cref="IAssetRegistry"/> fake — just records the last descriptor
    /// upserted per code, exactly enough to prove <see cref="FleetHost.RegisterMachine"/> upserts an
    /// OPC-UA roster member the same way it does any other machine (P2-1's own contract), with no real
    /// SQLite/assets.db involved.</summary>
    private sealed class FakeAssetRegistry : IAssetRegistry
    {
        public System.Collections.Concurrent.ConcurrentDictionary<string, MachineDescriptor> Upserted { get; } = new(StringComparer.OrdinalIgnoreCase);

        public Task UpsertAsync(MachineDescriptor descriptor, CancellationToken ct = default)
        {
            Upserted[descriptor.Code] = descriptor;
            return Task.CompletedTask;
        }

        public Task<AssetRecord?> GetAsync(string code, CancellationToken ct = default) => Task.FromResult<AssetRecord?>(null);

        public Task<IReadOnlyList<AssetRecord>> ListAsync(CancellationToken ct = default) =>
            Task.FromResult<IReadOnlyList<AssetRecord>>(Array.Empty<AssetRecord>());

        public Task<AssetRecord?> SetLifecycleAsync(string code, AssetLifecycleState state, CancellationToken ct = default) =>
            Task.FromResult<AssetRecord?>(null);
    }
}
