using System.Diagnostics.CodeAnalysis;
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
/// GP-5 (.superpowers/sdd/2026-07-28-wsg-plugin-connector-seam-blueprint/task-5-brief.md item 1) — the
/// double-drive corruption hazard the GP-4 review traced concretely: before this task, <c>StartLocked</c>'s
/// simulation-exclusion filter only ever excluded the two BUILT-IN literals (<see cref="DriverKinds.Modbus"/>/
/// <see cref="DriverKinds.OpcUa"/>), so a <c>fleet.json</c> entry naming a THIRD-PARTY <c>driverKind</c> (e.g.
/// <c>"vendor.acme.widget"</c>) got a simulator built for it regardless of whether a real connector was ever
/// registered for that id. Once an operator registers a real factory for that id (GP-5's <c>connectors.json</c>
/// is what makes that reachable outside a code change), TWO <c>EdgePipeline</c>s would write the same
/// <c>MachineState</c> — the simulator's <c>CycleCounter</c> and the real device's fight, corrupting
/// per-machine cycles and therefore fleet KPI/OEE/FPY, silently.
///
/// This suite proves the fix is a UNION, not a substitution, from the THIRD-PARTY side specifically
/// (<c>FleetHostModbusRosterTests</c> already pins the Modbus/OPC-UA side — those two literals stay
/// unconditional regardless of registry state, and this suite does not re-test that; it exercises the NEW
/// third clause alone):
///
///  1. <see cref="ThirdPartyRosterMember_ConnectorRegistered_ExcludedFromSimulation_DrivenByRealConnector_SimFleetUnaffected"/> —
///     once a connector IS registered for a third-party id, a roster member of that id is excluded from
///     simulation and driven ONLY by the real connector (the corruption scenario, closed).
///  2. <see cref="ThirdPartyRosterMember_NoConnectorRegisteredForThatId_FallsBackToSimulation"/> — the
///     mirror image, proving the third clause is genuinely a UNION (id-scoped), not a blanket "anything
///     non-built-in is excluded" rule: with NO connector registered for this exact id, the SAME descriptor
///     shape that test 1 excludes instead falls back to simulation exactly as it always has (nothing about
///     GP-5 changes behavior for a third-party id nobody ever wired a connector for) — a lazy
///     over-generalization ("exclude everything that isn't Simulated/HotFolderAoi/Mqtt") would fail this
///     test by leaving the machine idle instead.
///  3. <see cref="ThirdPartyRosterMember_RegisteredUnderADifferentIdThanTheRosterEntrys_StillFallsBackToSimulation"/> —
///     the per-id scoping proven from the other direction: registering SOME OTHER connector id does not
///     exclude an unrelated roster entry from simulation — guards against an implementation that checks
///     "is the registry non-empty" instead of "is THIS id registered."
///  4. <see cref="RegisterMachine_NormalizesDriverKindCasing_BeforeStoringOnTheRoster"/> — the companion fix
///     (task-5-brief.md item 1's "Also needed" paragraph): a descriptor arriving through
///     <see cref="FleetHost.RegisterMachine"/> (unlike one loaded through <c>FleetConfig.Load</c>) was never
///     normalized before this task, so an operator-supplied odd casing of a built-in id could defeat every
///     later exact-string <c>DriverKind</c> comparison in this class (the union filter's own literal checks
///     included).
/// </summary>
public sealed class FleetHostThirdPartyRosterTests
{
    private static readonly TimeSpan PollTimeout = TimeSpan.FromSeconds(10);
    private static readonly TimeSpan PollInterval = TimeSpan.FromMilliseconds(100);

    private const string ThirdPartyKind = "vendor.acme.thirdpartydrive";
    private const string ThirdPartyCode = "WIDGET-ROSTER-01";

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

    /// <summary>A roster descriptor whose <c>MachineType</c>/<c>DeviceClass</c> combination is deliberately
    /// one <c>SimulatorFactory</c> does NOT recognize (falls back on <see cref="DeviceClass.Automation"/> →
    /// <c>ScrewdriveSim</c>) — the exact shape that would otherwise "happily simulate it" per the brief's
    /// own framing of the hazard, so a test proving exclusion is proving something that would otherwise
    /// genuinely have happened, not a vacuous no-op.</summary>
    private static MachineDescriptor NewThirdPartyDescriptor(string code = ThirdPartyCode, string driverKind = ThirdPartyKind) => new(
        Code: code,
        SerialSeed: $"SN-{code}",
        DeviceClass: DeviceClass.Automation,
        MachineType: "WIDGET_TCP",
        StepType: null,
        DriverKind: driverKind,
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
    public async Task ThirdPartyRosterMember_ConnectorRegistered_ExcludedFromSimulation_DrivenByRealConnector_SimFleetUnaffected()
    {
        var fakeDriver = new RosterFakeThirdPartyDriver(ThirdPartyKind, ThirdPartyCode);
        var registry = new ConnectorRegistry();
        registry.Register(new FakeThirdPartyConnectorFactory(ThirdPartyKind, () => fakeDriver), config: "vendor-specific-config-blob");
        var host = CreateHost(registry);

        // NewThirdPartyDescriptor's MachineType/DeviceClass ("WIDGET_TCP"/Automation) is exactly the shape
        // SimulatorFactory's fallback would build a ScrewdriveSim for — a REAL torque-vs-LSL/USL inspection
        // simulator that reports Verdict.Pass/Warn/Fail, never Verdict.Skip. RosterFakeThirdPartyDriver
        // below always reports Verdict.Skip. This is deliberate: it is what makes the assertion below a
        // genuine double-drive detector, not just an "eventually cycles" check that a pre-fix substitution
        // bug (simulator ALSO built for this machine) would satisfy just as easily as the real fix does —
        // if a ScrewdriveSim were ALSO writing this MachineState (the exact corruption this task closes),
        // its Pass/Warn/Fail verdict would flip MachineState.StatusText away from "TELEMETRY" (the ONLY
        // status Verdict.Skip ever produces) within a cycle or two of this machine's own 1.0s CycleSeconds —
        // this test proved it caught exactly that when run against the pre-fix two-literal-only filter
        // (StatusText flipped to "OK"/"FAIL" within ~1-2s; see task-5-report.md).
        var added = host.RegisterMachine(NewThirdPartyDescriptor());
        Assert.True(added);

        host.Start();
        try
        {
            // The pre-existing simulated roster (fleet.json fallback) must cycle normally — proves the new
            // union clause doesn't touch the simulated group at all.
            await WaitUntilAsync(() => (host.MachineDetail("SCRW-01")?.Cycles ?? 0) > 0, "SCRW-01 (simulated) to cycle normally");

            // Driven by the REAL connector, not a simulator.
            await WaitUntilAsync(() => (host.MachineDetail(ThirdPartyCode)?.Cycles ?? 0) > 0, "the third-party roster member to cycle via its registered connector");

            Assert.Contains(host.GetDriverHealth(), s => s.Kind == ThirdPartyKind && s.SlotLabel == ThirdPartyKind);

            // The double-drive detector: poll for several seconds (multiple whole ScrewdriveSim CycleSeconds
            // periods, if one were running) and confirm StatusText NEVER leaves "TELEMETRY" — the only value
            // the connector's own always-Skip readings can ever produce. Any other value proves a SECOND
            // driver (the simulator) is also writing this exact MachineState.
            var deadline = DateTime.UtcNow + TimeSpan.FromSeconds(3);
            while (DateTime.UtcNow < deadline)
            {
                Assert.Equal("TELEMETRY", host.MachineDetail(ThirdPartyCode)?.StatusText);
                await Task.Delay(TimeSpan.FromMilliseconds(50));
            }
        }
        finally
        {
            host.Stop();
        }
    }

    [Fact]
    public async Task ThirdPartyRosterMember_NoConnectorRegisteredForThatId_FallsBackToSimulation()
    {
        // No connector registered anywhere — proves the third union clause is scoped to "a connector IS
        // registered for THIS id", not "any non-built-in id is always excluded". The exact descriptor shape
        // test 1 excludes once registered instead cycles here (SimulatorFactory's ordinary DeviceClass.Automation
        // fallback, ScrewdriveSim) — same as it always has, before this task existed.
        var host = CreateHost(connectorRegistry: null);
        var added = host.RegisterMachine(NewThirdPartyDescriptor());
        Assert.True(added);

        host.Start();
        try
        {
            await WaitUntilAsync(() => (host.MachineDetail(ThirdPartyCode)?.Cycles ?? 0) > 0,
                "the unregistered third-party roster member to fall back to simulation (not left idle)");
        }
        finally
        {
            host.Stop();
        }
    }

    [Fact]
    public async Task ThirdPartyRosterMember_RegisteredUnderADifferentIdThanTheRosterEntrys_StillFallsBackToSimulation()
    {
        // A connector IS registered — just for a DIFFERENT id than this roster entry's own DriverKind.
        // Guards against an implementation that checks "is the registry non-empty" instead of "does
        // registry.RegisteredIds contain THIS descriptor's own (normalized) DriverKind".
        var otherDriver = new RosterFakeThirdPartyDriver("vendor.acme.unrelated", "UNRELATED-01");
        var registry = new ConnectorRegistry();
        registry.Register(new FakeThirdPartyConnectorFactory("vendor.acme.unrelated", () => otherDriver), config: "x");
        var host = CreateHost(registry);

        var added = host.RegisterMachine(NewThirdPartyDescriptor());
        Assert.True(added);

        host.Start();
        try
        {
            await WaitUntilAsync(() => (host.MachineDetail(ThirdPartyCode)?.Cycles ?? 0) > 0,
                "a roster member whose OWN id has no registered connector to fall back to simulation, even though a DIFFERENT id is registered");
        }
        finally
        {
            host.Stop();
        }
    }

    [Fact]
    public async Task RegisterMachine_NormalizesDriverKindCasing_BeforeStoringOnTheRoster()
    {
        // task-5-brief.md item 1's "Also needed" fix: FleetConfig.Load already normalizes an externally
        // authored DriverKind (fleet.json); a descriptor arriving through RegisterMachine did not, before
        // this task. An odd casing of a BUILT-IN id ("MODBUS", not the canonical "Modbus") must still land
        // on the exact canonical spelling — otherwise this class's own exact-string DriverKind comparisons
        // (the union filter's two literals included) would silently fail to recognize it.
        var host = CreateHost(connectorRegistry: null);
        var descriptor = new MachineDescriptor(
            Code: "ODD-CASING-01", SerialSeed: "SN-ODD", DeviceClass: DeviceClass.Automation,
            MachineType: "MODBUS_TCP", StepType: null, DriverKind: "MODBUS", RecipeCode: null,
            MappingProfile: null, CycleSeconds: 1.0);

        var added = host.RegisterMachine(descriptor);
        Assert.True(added);

        // Normalized to the canonical PascalCase spelling on the roster (visible via the fleet snapshot's
        // DriverKind field) — exactly as FleetConfig.Load already guarantees for fleet.json entries.
        Assert.Equal(DriverKinds.Modbus, host.Fleet.Single(d => d.Code == "ODD-CASING-01").DriverKind);

        host.Start();
        try
        {
            // And, because it normalized to the canonical Modbus spelling, the union filter's own literal
            // clause excludes it from simulation and it stays idle with no connector wired — the SAME
            // invariant FleetHostModbusRosterTests pins for a descriptor built with the constant directly.
            await Task.Delay(TimeSpan.FromMilliseconds(300));
            Assert.Equal(0, host.MachineDetail("ODD-CASING-01")?.Cycles ?? -1);
        }
        finally
        {
            host.Stop();
        }
    }

    private sealed class FakeThirdPartyConnectorFactory : IConnectorFactory
    {
        private readonly Func<IDeviceDriver> _build;

        public FakeThirdPartyConnectorFactory(string kind, Func<IDeviceDriver> build)
        {
            Kind = kind;
            _build = build;
        }

        public string Kind { get; }

        public bool TryCreate(string config, [NotNullWhen(true)] out IDeviceDriver? driver, [NotNullWhen(false)] out string? error)
        {
            driver = _build();
            error = null;
            return true;
        }
    }

    private sealed class RosterFakeThirdPartyDriver : IDeviceDriver
    {
        private readonly string _machineCode;
        private long _counter;

        public RosterFakeThirdPartyDriver(string kind, string machineCode)
        {
            Kind = kind;
            _machineCode = machineCode;
        }

        public string Id => $"fake-roster-{Kind}-test-driver";

        public string Kind { get; }

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
}
