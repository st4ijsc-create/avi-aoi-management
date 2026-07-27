using System.Runtime.CompilerServices;
using St4i.EdgeCore.Drivers;
using St4i.EdgeCore.Infrastructure;
using St4i.EdgeCore.Models;
using St4i.EdgeCore.Transport;
using St4i.EngineApi.AssetRegistry;
using St4i.EngineApi.Fleet;
using Xunit;

namespace St4i.EngineApi.Tests;

/// <summary>
/// P2-1 pass-2 task P2-3 (docs/plans .../giaidoan2-pass2-blueprint task 3) — proves a configured Modbus
/// (G2-6) machine becomes a first-class, UI-visible roster member instead of an invisible telemetry
/// stream: (1) <see cref="FleetHost.StartLocked"/> must NOT build a simulator for a
/// <see cref="DriverKind.Modbus"/> roster entry (else it's driven TWICE — once by a simulator, once by the
/// real Modbus pipeline slot) — proven here by registering a Modbus descriptor with NO modbus driver
/// factory wired and confirming it stays idle/0-cycles forever, never picked up by
/// <c>SimulatorFactory</c>'s <c>DeviceClass.Automation</c> fallback (which would otherwise happily
/// simulate it as a generic Screwdrive cell); (2) once a real (here: fake) modbus driver factory IS wired,
/// the SAME registered descriptor cycles — proving it's driven by the Modbus slot, not simulated — while
/// the ordinary simulated roster is completely unaffected either way. Uses the same
/// <c>CreateHost</c>/<c>WaitUntilAsync</c> composition as <c>FleetHostModbusSlotTests</c>/
/// <c>FleetHostHealthAndRegistrationTests</c>.
/// </summary>
public sealed class FleetHostModbusRosterTests
{
    private static readonly TimeSpan PollTimeout = TimeSpan.FromSeconds(10);
    private static readonly TimeSpan PollInterval = TimeSpan.FromMilliseconds(100);

    private const string ModbusCode = "MODBUS-ROSTER-01";

    private static FleetHost CreateHost(Func<IDeviceDriver>? modbusDriverFactory = null, IAssetRegistry? assetRegistry = null)
    {
        var demo = new DemoTransport(latencyMs: 0);
        var live = LiveTransport.ForMachine("http://localhost:1", mkKey: "", machineCode: "TEST", queuePath: null, verifyTls: true);
        var auto = new AutoTransport(live, demo);
        var switchable = new SwitchableTransport(demo);
        var coordinator = new TransportCoordinator(switchable, demo, live, auto, TransportMode.Demo);
        var eventBus = new EventBus();
        return new FleetHost(switchable, coordinator, eventBus, modbusDriverFactory: modbusDriverFactory, assetRegistry: assetRegistry);
    }

    /// <summary>Mirrors the shape Program.cs's own seed descriptor construction builds (see the brief /
    /// Program.cs's <c>modbusSeedDescriptor</c>) — <c>MachineType: "MODBUS_TCP"</c>, <c>DeviceClass.Automation</c>,
    /// no StepType/RecipeCode/MappingProfile. CycleSeconds is irrelevant to the exclusion test (a
    /// DriverKind.Modbus descriptor is never handed to SimulatorFactory in the first place once the fix is
    /// applied) but must still be a sane positive value, matching <c>Math.Max(0.1, pollMs/1000.0)</c>.</summary>
    private static MachineDescriptor NewModbusDescriptor(string code = ModbusCode) => new(
        Code: code,
        SerialSeed: $"SN-{code}",
        DeviceClass: DeviceClass.Automation,
        MachineType: "MODBUS_TCP",
        StepType: null,
        DriverKind: DriverKind.Modbus,
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
    public async Task ModbusRosterMember_NoModbusFactory_ExcludedFromSimulation_StaysIdle_SimFleetUnaffected()
    {
        var host = CreateHost(modbusDriverFactory: null);
        var added = host.RegisterMachine(NewModbusDescriptor());
        Assert.True(added);

        host.Start();
        try
        {
            // The default (fleet.json-fallback) roster's own SCRW-01 must cycle normally — proves the
            // exclusion doesn't touch the simulated group at all.
            await WaitUntilAsync(() => (host.MachineDetail("SCRW-01")?.Cycles ?? 0) > 0, "SCRW-01 (simulated) to cycle normally");

            // The load-bearing assertion: the Modbus roster member has its OWN tile (roster-seeding worked)
            // but NO driver ever produced a reading for it (the exclusion worked) — it never left "Idle"/0
            // cycles, even though the fleet has been running and cycling for a while.
            var snapshot = host.Snapshot();
            var modbusTile = Assert.Single(snapshot.Machines, m => m.Code == ModbusCode);
            Assert.Equal(0, modbusTile.Cycles);
            Assert.Equal("Idle", modbusTile.StatusText);
            Assert.Equal(DriverKind.Modbus, modbusTile.DriverKind);

            // Double-check after a further short wait — not a one-off race where it just hasn't cycled
            // YET, but a durable "never driven" state for as long as no modbus factory is wired.
            await Task.Delay(TimeSpan.FromMilliseconds(300));
            Assert.Equal(0, host.MachineDetail(ModbusCode)?.Cycles ?? -1);
        }
        finally
        {
            host.Stop();
        }
    }

    [Fact]
    public async Task ModbusRosterMember_WithModbusFactory_DrivenBySlot_Cycles_SimFleetUnaffected()
    {
        var fakeDriver = new RosterFakeModbusDriver(ModbusCode);
        var host = CreateHost(modbusDriverFactory: () => fakeDriver);
        var added = host.RegisterMachine(NewModbusDescriptor());
        Assert.True(added);

        host.Start();
        try
        {
            // Driven by the (fake) Modbus slot, not a simulator — proves the roster member is now a
            // genuine live tile once the real pipeline slot is wired, exactly like a normal machine.
            await WaitUntilAsync(() => (host.MachineDetail(ModbusCode)?.Cycles ?? 0) > 0, "the Modbus roster member to cycle via the modbus slot");

            // The ordinary simulated roster keeps running unaffected alongside it.
            await WaitUntilAsync(() => (host.MachineDetail("SCRW-01")?.Cycles ?? 0) > 0, "SCRW-01 (simulated) to keep cycling alongside the Modbus slot");
            Assert.True(host.Snapshot().Kpis.Online > 0);
        }
        finally
        {
            host.Stop();
        }
    }

    [Fact]
    public async Task NoModbusDescriptor_NoModbusFactory_BehavesExactlyAsBeforeThisTask()
    {
        // Additive/default sanity (already covered by FleetHostHealthAndRegistrationTests /
        // FleetHostModbusSlotTests — repeated here, cheaply, as this suite's own belt-and-suspenders
        // check): a FleetHost with no Modbus roster member and no Modbus factory must behave exactly as
        // it did before this task existed.
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
    public async Task ModbusRosterMember_RegisteredWithAssetRegistry_UpsertsAssetAsModbusDriverKind()
    {
        var registry = new FakeAssetRegistry();
        var host = CreateHost(assetRegistry: registry);

        var added = host.RegisterMachine(NewModbusDescriptor());
        Assert.True(added);

        await WaitUntilAsync(() => registry.Upserted.ContainsKey(ModbusCode), "the Modbus descriptor to be upserted into the asset registry");
        Assert.Equal(DriverKind.Modbus, registry.Upserted[ModbusCode].DriverKind);
    }

    /// <summary>Test double — an <see cref="IDeviceDriver"/> that yields a Telemetry reading for
    /// <paramref name="machineCode"/> on a short interval forever (until cancelled), with a genuinely
    /// incrementing <see cref="DeviceReading.CycleCounter"/> so the registered <see cref="MachineState"/>'s
    /// own <c>Cycles</c> (derived from that counter — see <c>MachineState.ApplyReading</c>) actually climbs,
    /// unlike <c>FleetHostModbusSlotTests.CountingFakeModbusDriver</c> (which only proves the SLOT ran, not
    /// that a registered roster member's tile reflects it).</summary>
    private sealed class RosterFakeModbusDriver : IDeviceDriver
    {
        private readonly string _machineCode;
        private long _counter;

        public RosterFakeModbusDriver(string machineCode) => _machineCode = machineCode;

        public string Id => "fake-roster-modbus-test-driver";

        public DriverKind Kind => DriverKind.Modbus;

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
    /// upserted per code, exactly enough to prove <see cref="FleetHost.RegisterMachine"/> upserts a Modbus
    /// roster member the same way it does any other machine (P2-1's own contract), with no real
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
