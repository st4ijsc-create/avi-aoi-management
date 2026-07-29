using St4i.Connector.Abstractions;
using St4i.EdgeCore.Config;
using St4i.EdgeCore.Infrastructure;
using St4i.EdgeCore.Models;
using St4i.Connector.Abstractions.Models;
using St4i.EdgeCore.Transport;
using St4i.EngineApi.Fleet;
using Xunit;

namespace St4i.EngineApi.Tests;

/// <summary>
/// SM-1 (.superpowers/sdd/2026-07-29-dotA-single-machine-sellable-blueprint/task-1-brief.md) — "one real
/// machine, nothing else" as the normal PRODUCT state, gated by the SAME <see cref="DemoModeGate"/> seam
/// Program.cs/ModeEndpoints already use to decide demo-vs-product, never a second one invented for the
/// fleet roster specifically:
///
///  - <see cref="DemoModeGate"/> null (every pre-existing <c>FleetHost</c> test in this whole suite relies
///    on this implicit default) or <see cref="DemoModeGate.Enabled"/> keeps fleet.json's 11-machine
///    fabricated roster byte-identical — the exhibition/sales contract this task must never regress
///    (strict regression guard below).
///  - <see cref="DemoModeGate"/> present and disabled (a real product deployment) starts the roster EMPTY:
///    fleet.json/<c>BuildDefaultFleet</c> become demo-only artifacts — a malformed OR merely-present
///    fleet.json is never a backdoor to a fabricated fleet, and a roster of nothing-but-real-machines no
///    longer crashes <see cref="FleetHost.Start"/> (<c>SimulatedDriver</c>'s "at least one simulator" ctor
///    guard is never even reached once there is nothing to simulate).
/// </summary>
public sealed class FleetHostProductModeRosterTests
{
    private static readonly TimeSpan PollTimeout = TimeSpan.FromSeconds(10);
    private static readonly TimeSpan PollInterval = TimeSpan.FromMilliseconds(100);

    /// <summary>fleet.json's own 11 codes, in file order — the exhibition/demo fleet this task must never
    /// change. Pinned explicitly here (rather than trusting "some subset exists") is the STRICT regression
    /// guard the brief calls for.</summary>
    private static readonly string[] DemoFleetCodesInOrder =
    {
        "SCRW-01", "SCRW-02", "DISP-01", "WELD-01", "ASSY-01",
        "LEAK-01", "FCT-01", "IOT-01", "IOT-02", "AOI-01", "AOI-02",
    };

    private static FleetHost CreateHost(DemoModeGate? demoModeGate = null, ConnectorRegistry? connectorRegistry = null)
    {
        var demo = new DemoTransport(latencyMs: 0);
        var live = LiveTransport.ForMachine("http://localhost:1", mkKey: "", machineCode: "TEST", queuePath: null, verifyTls: true);
        var auto = new AutoTransport(live, demo);
        var switchable = new SwitchableTransport(demo);
        var coordinator = new TransportCoordinator(switchable, demo, live, auto, TransportMode.Demo);
        var eventBus = new EventBus();
        return new FleetHost(switchable, coordinator, eventBus, connectorRegistry: connectorRegistry, demoModeGate: demoModeGate);
    }

    /// <summary>Mirrors the shape Program.cs's own Modbus seed descriptor builds (see
    /// <c>FleetHostModbusRosterTests.NewModbusDescriptor</c>) — a real-connector-driven roster member,
    /// never simulated once registered (StartLocked's simFleet filter excludes DriverKinds.Modbus
    /// unconditionally).</summary>
    private static MachineDescriptor NewModbusDescriptor(string code) => new(
        Code: code,
        SerialSeed: $"SN-{code}",
        DeviceClass: DeviceClass.Automation,
        MachineType: "MODBUS_TCP",
        StepType: null,
        DriverKind: DriverKinds.Modbus,
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

    // ─────────────────────────────────────────────────────────────────────
    // Demo mode — the exhibition contract must stay byte-identical (strict regression guard).
    // ─────────────────────────────────────────────────────────────────────

    [Fact]
    public void DemoMode_ImplicitDefault_LoadsExactlyTheElevenFabricatedMachines_InFleetJsonOrder()
    {
        // The implicit default (no DemoModeGate passed) is what literally every pre-existing FleetHost
        // test in this whole solution already relies on — this IS the regression guard: if this ever
        // changes, every other suite's own assumption about the default roster breaks with it.
        var host = CreateHost();

        Assert.Equal(DemoFleetCodesInOrder, host.Fleet.Select(d => d.Code));
        Assert.All(host.Fleet, d => Assert.Equal(DriverKinds.Simulated, d.DriverKind));
    }

    [Fact]
    public void DemoMode_ExplicitlyEnabled_LoadsExactlyTheElevenFabricatedMachines_SameAsImplicitDefault()
    {
        var host = CreateHost(demoModeGate: new DemoModeGate("true"));

        Assert.Equal(DemoFleetCodesInOrder, host.Fleet.Select(d => d.Code));
    }

    [Fact]
    public async Task DemoMode_StartStop_UnaffectedByThisTask_AllElevenComeOnline()
    {
        var host = CreateHost(demoModeGate: new DemoModeGate("true"));

        host.Start();
        try
        {
            Assert.True(host.IsRunning);
            await WaitUntilAsync(
                () => host.Snapshot().Machines.Count(m => m.Cycles > 0) == DemoFleetCodesInOrder.Length,
                "all 11 demo machines to cycle at least once");
        }
        finally
        {
            host.Stop();
        }

        Assert.False(host.IsRunning);
    }

    [Fact]
    public void DemoMode_MalformedFleetJson_StillFallsBackToTheInCodeDefaultFleet_ForgivingBehaviourUnchanged()
    {
        var host = CreateHost();
        var tempPath = Path.Combine(Path.GetTempPath(), $"st4i-sm1-malformed-demo-{Guid.NewGuid():N}.json");
        File.WriteAllText(tempPath, "{ this is not a fleet.json array }");

        try
        {
            var result = host.ResolveFleet(tempPath, demoMode: true);

            // BuildDefaultFleet's own 10-machine in-code roster — unchanged demo-mode forgiving fallback.
            Assert.Equal(10, result.Count);
            Assert.All(result, d => Assert.Equal(DriverKinds.Simulated, d.DriverKind));
        }
        finally
        {
            File.Delete(tempPath);
        }
    }

    // ─────────────────────────────────────────────────────────────────────
    // Product mode — empty roster is a first-class, fully-supported state.
    // ─────────────────────────────────────────────────────────────────────

    [Fact]
    public void ProductMode_NoRealMachineRegistered_RosterStartsEmpty_FleetJsonContentIgnored()
    {
        // This assembly's own fleet.json (11 valid entries) sits on disk beside this test binary too —
        // exactly what the DEMO tests above rely on. The point here is that product mode ignores it
        // ANYWAY: fleet.json is a demo-only artifact now, not "empty roster because the file happens to be
        // missing".
        var host = CreateHost(demoModeGate: new DemoModeGate(""));

        Assert.Empty(host.Fleet);
    }

    [Fact]
    public void ProductMode_Start_DoesNotThrow_RosterStaysEmpty_SnapshotIsValidAndEmpty()
    {
        var host = CreateHost(demoModeGate: new DemoModeGate(""));

        var startEx = Record.Exception(() => host.Start());
        Assert.Null(startEx);

        Assert.Empty(host.Snapshot().Machines);
        Assert.Equal(0, host.Snapshot().Kpis.Online);
        Assert.Empty(host.GetDriverHealth());

        // SM-1 — an operator turning the (empty) engine ON is a coherent running state, not a silent
        // "still stopped" despite Start() reporting success: nothing crashed, nothing was fabricated,
        // there is simply nothing to pipeline yet.
        Assert.True(host.IsRunning, "Start() on an empty roster must be a real, observable running state, not a silent no-op");

        var stopEx = Record.Exception(() => host.Stop());
        Assert.Null(stopEx);
        Assert.False(host.IsRunning);
    }

    [Fact]
    public void ProductMode_StartStopRestartCycles_EmptyRoster_StableNoCrash()
    {
        var host = CreateHost(demoModeGate: new DemoModeGate(""));

        for (var i = 0; i < 3; i++)
        {
            var startEx = Record.Exception(() => host.Start());
            Assert.Null(startEx);
            Assert.True(host.IsRunning);

            var stopEx = Record.Exception(() => host.Stop());
            Assert.Null(stopEx);
            Assert.False(host.IsRunning);
        }
    }

    [Fact]
    public void ProductMode_OneModbusMachineRegistered_RosterContainsExactlyThatMachine()
    {
        var host = CreateHost(demoModeGate: new DemoModeGate(""));
        Assert.Empty(host.Fleet);

        var added = host.RegisterMachine(NewModbusDescriptor("MODBUS-01"));
        Assert.True(added);

        var only = Assert.Single(host.Fleet);
        Assert.Equal("MODBUS-01", only.Code);
        Assert.Equal(DriverKinds.Modbus, only.DriverKind);
    }

    [Fact]
    public void ProductMode_OneRealMachineOnly_StartDoesNotThrow_SimulatedDriverNeverConstructedWithZeroSimulators()
    {
        // Verified fact from the brief: a roster containing ONLY real-connector entries used to crash
        // Start() — SimulatedDriver's ctor throws "At least one simulator is required" with no try/catch
        // anywhere. StartLocked's own simFleet filter excludes DriverKinds.Modbus unconditionally (whether
        // or not a connector is actually registered for it), so this reproduces the crash with NO connector
        // wired up at all — proving the guard lives at the StartLocked call site, not a weakened
        // SimulatedDriver constructor.
        var host = CreateHost(demoModeGate: new DemoModeGate(""));
        host.RegisterMachine(NewModbusDescriptor("MODBUS-ONLY-01"));

        var ex = Record.Exception(() => host.Start());

        Assert.Null(ex);
        Assert.Empty(host.GetDriverHealth());
        host.Stop();
    }

    // ─────────────────────────────────────────────────────────────────────
    // The fallback must stop lying — a broken/ignored fleet.json is visible, never a fabricated fleet.
    // ─────────────────────────────────────────────────────────────────────

    [Fact]
    public void ProductMode_MalformedFleetJson_NeverFabricatesMachines_RosterStaysEmpty()
    {
        var host = CreateHost(demoModeGate: new DemoModeGate(""));
        var tempPath = Path.Combine(Path.GetTempPath(), $"st4i-sm1-malformed-product-{Guid.NewGuid():N}.json");
        File.WriteAllText(tempPath, "{ this is not a fleet.json array }");

        try
        {
            var result = host.ResolveFleet(tempPath, demoMode: false);

            Assert.Empty(result);
        }
        finally
        {
            File.Delete(tempPath);
        }
    }

    [Fact]
    public void ProductMode_ValidButNonEmptyFleetJson_StillIgnoredEntirely_RosterStaysEmpty()
    {
        // Even a perfectly well-formed fleet.json (the real one) must not populate a product roster —
        // fleet.json's CONTENT is never a valid way to declare a real machine in product mode, valid or
        // not; only connectors.json/env vars (via RegisterMachine) are.
        var host = CreateHost(demoModeGate: new DemoModeGate(""));
        var tempPath = Path.Combine(Path.GetTempPath(), $"st4i-sm1-valid-product-{Guid.NewGuid():N}.json");
        File.WriteAllText(tempPath, """[{"code":"SHOULD-NOT-APPEAR","serialSeed":"SN-X","deviceClass":"automation","machineType":"SCREWDRIVE","stepType":"screw_tightening","driverKind":"simulated","recipeCode":"RC","mappingProfile":null,"cycleSeconds":1.0}]""");

        try
        {
            var result = host.ResolveFleet(tempPath, demoMode: false);

            Assert.Empty(result);
        }
        finally
        {
            File.Delete(tempPath);
        }
    }
}
