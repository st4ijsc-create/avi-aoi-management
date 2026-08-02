using System.Diagnostics.CodeAnalysis;
using System.Runtime.CompilerServices;
using St4i.Connector.Abstractions;
using St4i.Connector.Abstractions.Models;
using St4i.EdgeCore.Infrastructure;
using St4i.EdgeCore.Mapping;
using St4i.EdgeCore.Models;
using St4i.EdgeCore.Transport;
using St4i.EngineApi.Fleet;
using Xunit;

namespace St4i.EngineApi.Tests;

/// <summary>
/// 🔴 Task D-1 (.superpowers/sdd/2026-08-02-dotD-modbus-rtu-blueprint/task-1-brief.md) — the routing half of
/// "connector identity moves from the protocol kind to the connector instance", and the one non-negotiable
/// the brief names: <b>with two machines configured on two connector instances, a write for machine B
/// reaches B's driver and only B's.</b>
///
/// <para><b>Why this suite exists at all, stated as the defect it descends from.</b> Đợt B found a Critical
/// with a running probe: a write for machine B reached machine A's device. The cause was structural, not a
/// slip — <c>ConnectorRegistry</c> was keyed by protocol <c>Kind</c>, so every Modbus machine in the roster
/// resolved to the ONE <c>"modbus"</c> pipeline slot, and <see cref="SetpointWriteRequest"/> carries no
/// machine code for the driver to cross-check against. Đợt B could not fix that; it could only REFUSE, which
/// is what <see cref="MachineDriverAvailability.AmbiguousDriver"/> is. D-1 removes the cause: the registry is
/// keyed per instance, an instance declares the machine code it serves, and a claim another instance already
/// holds is refused at registration.</para>
///
/// <para><b>Driven, not read.</b> Every test here stands up a real <see cref="ConnectorRegistry"/>, a real
/// <see cref="FleetHost"/>, real pipeline slots built by <c>StartLocked</c> from that registry, and real
/// <see cref="FleetHost.TryWriteSetpointAsync"/> calls — the same "stand up a fake device and drive it"
/// discipline that found all six of Đợt B's Criticals, none of which were found by reading. The load-bearing
/// assertion is never "B reported Writable"; it is always <c>driverA.WriteCallCount == 0</c> alongside
/// <c>driverB.WriteCallCount == 1</c>, because a wrong-machine write is a thing that HAPPENS to a device, not
/// a status a method returns.</para>
/// </summary>
public sealed class FleetHostConnectorInstanceRoutingTests
{
    private static readonly TimeSpan PollTimeout = TimeSpan.FromSeconds(10);
    private static readonly TimeSpan PollInterval = TimeSpan.FromMilliseconds(100);

    private static FleetHost CreateHost(ConnectorRegistry? registry)
    {
        var demo = new DemoTransport(latencyMs: 0);
        var live = LiveTransport.ForMachine("http://localhost:1", mkKey: "", machineCode: "TEST", queuePath: null, verifyTls: true);
        var auto = new AutoTransport(live, demo);
        var switchable = new SwitchableTransport(demo);
        var coordinator = new TransportCoordinator(switchable, demo, live, auto, TransportMode.Demo);
        var eventBus = new EventBus();
        return new FleetHost(switchable, coordinator, eventBus, connectorRegistry: registry);
    }

    private static MachineDescriptor ModbusMachine(string code) => new(
        code, $"SN-{code}", DeviceClass.Automation, "MODBUS_TCP", null,
        DriverKinds.Modbus, null, null, CycleSeconds: 0.2);

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
    // 🔴 THE NON-NEGOTIABLE.
    // ─────────────────────────────────────────────────────────────────────

    [Fact]
    public async Task TwoMachinesOnTwoConnectorInstancesOfTheSameKind_AWriteForBReachesBsDriverAndOnlyBs()
    {
        const string codeA = "D1-ROUTE-A";
        const string codeB = "D1-ROUTE-B";
        var driverA = new InstanceFakeWritableDriver(DriverKinds.Modbus, codeA);
        var driverB = new InstanceFakeWritableDriver(DriverKinds.Modbus, codeB);

        var registry = new ConnectorRegistry();
        Assert.True(registry.Register(
            new InstanceFakeConnectorFactory(DriverKinds.Modbus, () => driverA), "cfg-a",
            instanceId: "modbus-line-a", machineCode: codeA));
        Assert.True(registry.Register(
            new InstanceFakeConnectorFactory(DriverKinds.Modbus, () => driverB), "cfg-b",
            instanceId: "modbus-line-b", machineCode: codeB));

        var host = CreateHost(registry);
        Assert.True(host.RegisterMachine(ModbusMachine(codeA)));
        Assert.True(host.RegisterMachine(ModbusMachine(codeB)));

        host.Start();
        try
        {
            await WaitUntilAsync(
                () => host.GetDriverHealth().Count(s => s.SlotLabel is "modbus-line-a" or "modbus-line-b") == 2,
                "both connector instances' slots to come up");

            // Two slots, two labels, two drivers — the shape that could not exist before D-1, when the
            // second Register call silently replaced the first and one "modbus" slot was all there was.
            var labels = host.GetDriverHealth().Select(s => s.SlotLabel).ToList();
            Assert.Contains("modbus-line-a", labels);
            Assert.Contains("modbus-line-b", labels);

            // Both machines are individually resolvable. Under the pre-D-1 rule BOTH of these would be
            // AmbiguousDriver (two roster members, one Modbus slot) — the refusal Đợt B had to ship.
            Assert.Equal(MachineDriverAvailability.Writable, host.GetMachineDriverAvailability(codeA));
            Assert.Equal(MachineDriverAvailability.Writable, host.GetMachineDriverAvailability(codeB));

            // ── The write for B. ──────────────────────────────────────────
            var (availabilityB, resultB) = await host.TryWriteSetpointAsync(
                codeB, new SetpointWriteRequest("speed", 77.0), CancellationToken.None);

            Assert.Equal(MachineDriverAvailability.Writable, availabilityB);
            Assert.Equal(WriteOutcome.Applied, resultB!.Outcome);

            // 🔴 This pair is the whole test. Not "B answered Writable" — B's DEVICE got the value and A's
            // device was never touched. Delete the instance binding from ResolveWritableDriver and codeB
            // resolves to whichever slot the kind rule picks; the count on the wrong driver is what says so.
            Assert.Equal(1, driverB.WriteCallCount);
            Assert.Equal(0, driverA.WriteCallCount);
            Assert.Equal("speed", driverB.LastSetpoint?.Point);
            Assert.Equal(77.0, driverB.LastSetpoint?.Value);

            // ── And the mirror, so this cannot pass by accident of ordering. ──
            var (availabilityA, resultA) = await host.TryWriteSetpointAsync(
                codeA, new SetpointWriteRequest("speed", 11.0), CancellationToken.None);

            Assert.Equal(MachineDriverAvailability.Writable, availabilityA);
            Assert.Equal(WriteOutcome.Applied, resultA!.Outcome);
            Assert.Equal(1, driverA.WriteCallCount);
            Assert.Equal(11.0, driverA.LastSetpoint?.Value);
            Assert.Equal(1, driverB.WriteCallCount); // B was NOT called a second time
            Assert.Equal(77.0, driverB.LastSetpoint?.Value);
        }
        finally
        {
            host.Stop();
        }
    }

    [Fact]
    public async Task TwoMachinesOnTwoConnectorInstances_ACommandForBReachesBsDriverAndOnlyBs()
    {
        // The command path gets its own proof rather than resting on "same resolution helper": per Đợt B,
        // InvokeCommandAsync is the HIGHER-risk member — it can trigger real physical motion — and Đợt B's
        // own review round 1 found exactly this gap (the setpoint path tested, the command path assumed).
        const string codeA = "D1-CMD-A";
        const string codeB = "D1-CMD-B";
        var driverA = new InstanceFakeWritableDriver(DriverKinds.Modbus, codeA);
        var driverB = new InstanceFakeWritableDriver(DriverKinds.Modbus, codeB);

        var registry = new ConnectorRegistry();
        registry.Register(new InstanceFakeConnectorFactory(DriverKinds.Modbus, () => driverA), "a", "modbus-line-a", codeA);
        registry.Register(new InstanceFakeConnectorFactory(DriverKinds.Modbus, () => driverB), "b", "modbus-line-b", codeB);

        var host = CreateHost(registry);
        Assert.True(host.RegisterMachine(ModbusMachine(codeA)));
        Assert.True(host.RegisterMachine(ModbusMachine(codeB)));

        host.Start();
        try
        {
            await WaitUntilAsync(
                () => host.GetMachineDriverAvailability(codeB) == MachineDriverAvailability.Writable,
                "machine B's own connector slot to come up");

            var (availability, result) = await host.TryInvokeCommandAsync(
                codeB, new CommandRequest("start-cycle"), CancellationToken.None);

            Assert.Equal(MachineDriverAvailability.Writable, availability);
            Assert.Equal(WriteOutcome.Applied, result!.Outcome);
            Assert.Equal(1, driverB.CommandCallCount);
            Assert.Equal(0, driverA.CommandCallCount);
        }
        finally
        {
            host.Stop();
        }
    }

    [Fact]
    public async Task TwoConnectorInstances_EachDrivesOnlyItsOwnMachine_NeitherIsSimulated()
    {
        // The other half of "independently addressable": each machine must actually be CYCLING off its own
        // connector's readings, and neither may be double-driven by the simulated group (the double-drive
        // corruption GP-5 closed for third-party kinds — two EdgePipelines writing one MachineState silently
        // corrupts per-machine cycles and therefore fleet OEE/FPY). The always-Skip verdict these fakes emit
        // produces StatusText "TELEMETRY" and nothing else; a ScrewdriveSim also driving the machine would
        // flip it to OK/FAIL within a cycle or two.
        const string codeA = "D1-DRIVE-A";
        const string codeB = "D1-DRIVE-B";
        var driverA = new InstanceFakeWritableDriver(DriverKinds.Modbus, codeA) { EmitReadings = true };
        var driverB = new InstanceFakeWritableDriver(DriverKinds.Modbus, codeB) { EmitReadings = true };

        var registry = new ConnectorRegistry();
        registry.Register(new InstanceFakeConnectorFactory(DriverKinds.Modbus, () => driverA), "a", "modbus-line-a", codeA);
        registry.Register(new InstanceFakeConnectorFactory(DriverKinds.Modbus, () => driverB), "b", "modbus-line-b", codeB);

        var host = CreateHost(registry);
        Assert.True(host.RegisterMachine(ModbusMachine(codeA)));
        Assert.True(host.RegisterMachine(ModbusMachine(codeB)));

        host.Start();
        try
        {
            await WaitUntilAsync(() => (host.MachineDetail(codeA)?.Cycles ?? 0) > 0, $"{codeA} to cycle off its own connector");
            await WaitUntilAsync(() => (host.MachineDetail(codeB)?.Cycles ?? 0) > 0, $"{codeB} to cycle off its own connector");

            // The pre-existing simulated roster is untouched by any of this.
            await WaitUntilAsync(() => (host.MachineDetail("SCRW-01")?.Cycles ?? 0) > 0, "SCRW-01 (simulated) to cycle normally");

            var deadline = DateTime.UtcNow + TimeSpan.FromSeconds(2);
            while (DateTime.UtcNow < deadline)
            {
                Assert.Equal("TELEMETRY", host.MachineDetail(codeA)?.StatusText);
                Assert.Equal("TELEMETRY", host.MachineDetail(codeB)?.StatusText);
                await Task.Delay(TimeSpan.FromMilliseconds(50));
            }
        }
        finally
        {
            host.Stop();
        }
    }

    [Fact]
    public async Task AMachineClaimedByAnInstanceWhoseIdIsNotItsDriverKind_IsExcludedFromSimulation_NotDoubleDriven()
    {
        // The simulation-exclusion filter had to learn the SAME finer rule the write path did, and this is
        // the shape that proves it: a third-party machine whose DriverKind is "vendor.acme.press" served by
        // a connector instance named "press-line-1". The pre-D-1 filter asks only "is this machine's KIND a
        // registered connector id" — under instance identity that answer is NO ("press-line-1" is what is
        // registered), so the machine would be simulated AND driven by its real connector at the same time:
        // two EdgePipelines writing one MachineState, corrupting per-machine cycles and therefore fleet
        // OEE/FPY, silently. That is the exact corruption GP-5 closed for the kind-keyed world; instance
        // identity reopens it for anyone who does not carry the rule across.
        //
        // The detector is the same one GP-5 used: this fake always reports Verdict.Skip, which produces
        // StatusText "TELEMETRY" and nothing else, while the ScrewdriveSim that WOULD be built for this
        // Automation/"PRESS_TCP" descriptor reports Pass/Warn/Fail and flips StatusText to OK/FAIL within a
        // cycle or two.
        const string kind = "vendor.acme.press";
        const string code = "D1-SIMEXCL-01";
        var driver = new InstanceFakeWritableDriver(kind, code) { EmitReadings = true };

        var registry = new ConnectorRegistry();
        Assert.True(registry.Register(
            new InstanceFakeConnectorFactory(kind, () => driver), "cfg",
            instanceId: "press-line-1", machineCode: code));

        var host = CreateHost(registry);
        Assert.True(host.RegisterMachine(new MachineDescriptor(
            code, $"SN-{code}", DeviceClass.Automation, "PRESS_TCP", null, kind, null, null, CycleSeconds: 0.2)));

        host.Start();
        try
        {
            await WaitUntilAsync(() => (host.MachineDetail(code)?.Cycles ?? 0) > 0, "the machine to cycle off its connector");
            Assert.Contains(host.GetDriverHealth(), s => s.SlotLabel == "press-line-1");

            var deadline = DateTime.UtcNow + TimeSpan.FromSeconds(3);
            while (DateTime.UtcNow < deadline)
            {
                Assert.Equal("TELEMETRY", host.MachineDetail(code)?.StatusText);
                await Task.Delay(TimeSpan.FromMilliseconds(50));
            }

            // And it resolves for writing to its own connector, not to the simulated group.
            Assert.Equal(MachineDriverAvailability.Writable, host.GetMachineDriverAvailability(code));
        }
        finally
        {
            host.Stop();
        }
    }

    [Fact]
    public async Task AMachineWhoseRosterCodeDiffersOnlyInCaseFromItsConnectorsClaim_StillResolvesToThatConnector()
    {
        // 🔴 D-1 review follow-up, found by mutation: making the snapshot binding lookup case-SENSITIVE left
        // every routing test green, because they all happened to spell the code identically on both sides.
        // The two sides are authored independently in production — the roster code comes from fleet.json or
        // a RegisterMachine caller, the claim comes from the register/node map — and EVERY other machine-code
        // comparison in this codebase is ordinal-ignore-case (FleetHost.RegisterMachine's duplicate guard,
        // ResolveWritableDriver's own roster lookup, ConnectorEndpoints' collision checks). A case-sensitive
        // lookup here would silently un-bind the machine: it would fall back to the kind rule, be reported
        // NoLiveDriver or ambiguous, and the operator's connector would look dead for a reason nothing named.
        const string rosterCode = "D1-CASE-Machine-01";
        const string claimedCode = "d1-case-machine-01";
        var driver = new InstanceFakeWritableDriver(DriverKinds.Modbus, rosterCode);

        var registry = new ConnectorRegistry();
        Assert.True(registry.Register(
            new InstanceFakeConnectorFactory(DriverKinds.Modbus, () => driver), "cfg",
            instanceId: "modbus-line-cased", machineCode: claimedCode));

        var host = CreateHost(registry);
        Assert.True(host.RegisterMachine(ModbusMachine(rosterCode)));

        host.Start();
        try
        {
            await WaitUntilAsync(
                () => host.GetDriverHealth().Any(s => s.SlotLabel == "modbus-line-cased"),
                "the connector's slot to come up");

            Assert.Equal(MachineDriverAvailability.Writable, host.GetMachineDriverAvailability(rosterCode));

            var (availability, result) = await host.TryWriteSetpointAsync(
                rosterCode, new SetpointWriteRequest("speed", 3.0), CancellationToken.None);

            Assert.Equal(MachineDriverAvailability.Writable, availability);
            Assert.Equal(WriteOutcome.Applied, result!.Outcome);
            Assert.Equal(1, driver.WriteCallCount);
        }
        finally
        {
            host.Stop();
        }
    }

    [Fact]
    public async Task AMachineWhoseDriverKindIsSimulated_ButWhichAConnectorInstanceClaims_LeavesTheSimulatedGroup()
    {
        // 🔴 D-1 review — a hazard this task SILENTLY FIXES, recorded as a test so it is not rediscovered as
        // a bug later. Before D-1 the sim-exclusion filter asked only about a machine's DriverKind, and
        // DriverKinds.Simulated was carved out of the registry clause FIRST (so that a third party
        // registering under the id "Simulated" could not reclassify every demo machine). Consequence: a
        // connector whose map named a machine that was already in the roster as Simulated got BOTH a
        // simulator and its own real connector slot — two EdgePipelines writing one MachineState, the
        // double-drive corruption GP-5 closed for third-party kinds, silently corrupting per-machine cycles
        // and therefore fleet OEE/FPY. Reachable in practice: fleet.json ships a demo roster, and an
        // operator saving a connector for a code that happens to already be there hits it.
        //
        // The per-MACHINE rule closes it by construction — a claimed machine belongs to its claimant's slot
        // regardless of what its DriverKind says. Same always-Skip detector as the sibling tests: a
        // ScrewdriveSim also driving this machine reports Pass/Warn/Fail and would flip StatusText off
        // "TELEMETRY" within a cycle or two.
        const string code = "D1-SIMKIND-CLAIMED";
        var driver = new InstanceFakeWritableDriver(DriverKinds.Modbus, code) { EmitReadings = true };

        var registry = new ConnectorRegistry();
        Assert.True(registry.Register(
            new InstanceFakeConnectorFactory(DriverKinds.Modbus, () => driver), "cfg",
            instanceId: "modbus-claims-a-sim-machine", machineCode: code));

        var host = CreateHost(registry);
        // DriverKind Simulated, MachineType/DeviceClass that SimulatorFactory happily builds a ScrewdriveSim
        // for — i.e. a machine the pre-D-1 filter would certainly have simulated.
        Assert.True(host.RegisterMachine(new MachineDescriptor(
            code, $"SN-{code}", DeviceClass.Automation, "SCREWDRIVE", "screw_tightening",
            DriverKinds.Simulated, "RC-TEST-A", null, CycleSeconds: 0.1)));

        host.Start();
        try
        {
            await WaitUntilAsync(() => (host.MachineDetail(code)?.Cycles ?? 0) > 0, "the machine to cycle off its connector");
            Assert.Contains(host.GetDriverHealth(), s => s.SlotLabel == "modbus-claims-a-sim-machine");

            var deadline = DateTime.UtcNow + TimeSpan.FromSeconds(3);
            while (DateTime.UtcNow < deadline)
            {
                Assert.Equal("TELEMETRY", host.MachineDetail(code)?.StatusText);
                await Task.Delay(TimeSpan.FromMilliseconds(50));
            }

            // The rest of the demo roster is untouched — the fix is per-machine, not a blanket change to how
            // Simulated machines are treated.
            await WaitUntilAsync(() => (host.MachineDetail("SCRW-01")?.Cycles ?? 0) > 0, "SCRW-01 to keep cycling normally");
            Assert.Equal(MachineDriverAvailability.ReadOnly, host.GetMachineDriverAvailability("SCRW-01"));
        }
        finally
        {
            host.Stop();
        }
    }

    // ─────────────────────────────────────────────────────────────────────
    // 🔴 AmbiguousDriver: the precondition removed, the guard left standing.
    // ─────────────────────────────────────────────────────────────────────

    [Fact]
    public async Task TheDotBAmbiguityRecipe_WithAnInstanceKeyedConnector_NoLongerRefusesTheClaimedMachine_AndNeverWritesToTheUnclaimedOne()
    {
        // Đợt B's exact recipe, replayed: TWO roster members declaring the SAME DriverKind (Modbus), ONE
        // live Modbus connector. Before D-1 this produced AmbiguousDriver for BOTH — the refusal was all
        // that stood between a write and the wrong device. The connector instance here is registered under
        // the DEFAULT instance id (the kind), which is the real upgrade shape: an ST4I_MODBUS_MAP
        // deployment for MB-A, with a second Modbus entry sitting in fleet.json.
        const string claimed = "D1-AMBIG-CLAIMED";
        const string unclaimed = "D1-AMBIG-UNCLAIMED";
        var driver = new InstanceFakeWritableDriver(DriverKinds.Modbus, claimed);

        var registry = new ConnectorRegistry();
        Assert.True(registry.Register(
            new InstanceFakeConnectorFactory(DriverKinds.Modbus, () => driver), "cfg",
            instanceId: null, machineCode: claimed));

        var host = CreateHost(registry);
        Assert.True(host.RegisterMachine(ModbusMachine(claimed)));
        Assert.True(host.RegisterMachine(ModbusMachine(unclaimed)));

        host.Start();
        try
        {
            await WaitUntilAsync(
                () => host.GetDriverHealth().Any(s => s.SlotLabel == "modbus"),
                "the Modbus connector's slot to come up");

            // The machine the connector actually serves resolves to exactly one identifiable driver.
            Assert.Equal(MachineDriverAvailability.Writable, host.GetMachineDriverAvailability(claimed));

            // The machine nothing serves is reported as what it genuinely is: nothing is driving it. NOT
            // AmbiguousDriver — the ambiguity is gone, not merely refused — and emphatically not Writable.
            Assert.Equal(MachineDriverAvailability.NoLiveDriver, host.GetMachineDriverAvailability(unclaimed));

            // 🔴 The safety assertion, which is about the DEVICE and not about a status code: a write aimed
            // at the unclaimed machine must not reach the claimed machine's driver. This is the Đợt B
            // Critical itself, re-run against the new resolution rule.
            var (availability, result) = await host.TryWriteSetpointAsync(
                unclaimed, new SetpointWriteRequest("speed", 99.0), CancellationToken.None);

            Assert.Equal(MachineDriverAvailability.NoLiveDriver, availability);
            Assert.Null(result);
            Assert.Equal(0, driver.WriteCallCount);

            // And the claimed machine still works, so the rule above is a routing fix rather than a blanket
            // refusal dressed up as one.
            var (okAvailability, okResult) = await host.TryWriteSetpointAsync(
                claimed, new SetpointWriteRequest("speed", 5.0), CancellationToken.None);
            Assert.Equal(MachineDriverAvailability.Writable, okAvailability);
            Assert.Equal(WriteOutcome.Applied, okResult!.Outcome);
            Assert.Equal(1, driver.WriteCallCount);
        }
        finally
        {
            host.Stop();
        }
    }

    [Fact]
    public async Task NoConfigurationOfInstanceKeyedConnectors_CanProduceAmbiguousDriver()
    {
        // The structural claim, driven rather than argued. Every registered instance below is BOUND (which
        // every production registration path is — env vars, connectors.json and persisted rows all derive
        // the machine code from a parsed map where it is a required field), and the roster is deliberately
        // the adversarial shape: more Modbus machines than connectors, a machine claimed by an instance
        // whose id is the kind, a machine claimed by an instance whose id is not, and a machine claimed by
        // nobody. AmbiguousDriver requires two roster members resolving to ONE writable slot; a claim is
        // 1:1 and a second claim on one code is refused at registration, so the precondition cannot be
        // assembled here at all.
        const string viaDefaultId = "D1-UNREACH-DEFAULT";
        const string viaNamedId = "D1-UNREACH-NAMED";
        const string orphan = "D1-UNREACH-ORPHAN";

        var driverDefault = new InstanceFakeWritableDriver(DriverKinds.Modbus, viaDefaultId);
        var driverNamed = new InstanceFakeWritableDriver(DriverKinds.Modbus, viaNamedId);

        var registry = new ConnectorRegistry();
        Assert.True(registry.Register(
            new InstanceFakeConnectorFactory(DriverKinds.Modbus, () => driverDefault), "d", machineCode: viaDefaultId));
        Assert.True(registry.Register(
            new InstanceFakeConnectorFactory(DriverKinds.Modbus, () => driverNamed), "n", "modbus-line-2", viaNamedId));
        // A third instance trying to claim a machine already served is refused outright — this is the gate
        // that makes the sentence above true, asserted here rather than assumed.
        Assert.False(registry.Register(
            new InstanceFakeConnectorFactory(DriverKinds.Modbus, () => new InstanceFakeWritableDriver(DriverKinds.Modbus, viaNamedId)),
            "dup", "modbus-line-3", viaNamedId));

        var host = CreateHost(registry);
        Assert.True(host.RegisterMachine(ModbusMachine(viaDefaultId)));
        Assert.True(host.RegisterMachine(ModbusMachine(viaNamedId)));
        Assert.True(host.RegisterMachine(ModbusMachine(orphan)));

        host.Start();
        try
        {
            await WaitUntilAsync(
                () => host.GetDriverHealth().Count(s => s.SlotLabel is "modbus" or "modbus-line-2") == 2,
                "both bound connector slots to come up");

            // Every machine in the roster — connector-backed, orphaned and simulated alike — and not one of
            // them lands on AmbiguousDriver.
            foreach (var machine in host.Fleet)
            {
                var availability = host.GetMachineDriverAvailability(machine.Code);
                Assert.True(
                    availability != MachineDriverAvailability.AmbiguousDriver,
                    $"machine '{machine.Code}' (driverKind '{machine.DriverKind}') resolved to AmbiguousDriver — " +
                    "instance-keyed connectors must make that state unconstructible.");
            }

            Assert.Equal(MachineDriverAvailability.Writable, host.GetMachineDriverAvailability(viaDefaultId));
            Assert.Equal(MachineDriverAvailability.Writable, host.GetMachineDriverAvailability(viaNamedId));
            Assert.Equal(MachineDriverAvailability.NoLiveDriver, host.GetMachineDriverAvailability(orphan));

            // Each write lands on its own device and nowhere else.
            await host.TryWriteSetpointAsync(viaNamedId, new SetpointWriteRequest("speed", 1.0), CancellationToken.None);
            Assert.Equal(1, driverNamed.WriteCallCount);
            Assert.Equal(0, driverDefault.WriteCallCount);
        }
        finally
        {
            host.Stop();
        }
    }

    [Fact]
    public async Task AmbiguousDriver_StillExists_AndStillRefusesTheWrite_WhenASlotCannotBeAttributedToOneMachine()
    {
        // The guard is left STANDING, not deleted — and this proves it is still wired, not merely still
        // declared. The only remaining way to build the precondition is a pipeline slot with no connector
        // instance behind it, which is what AdditionalPipelinesForTests injects (the same seam Đợt B's own
        // regression test uses, which is why that test still passes unchanged).
        //
        // "We removed the guard because we think it can't happen" and "we proved it can't happen and left
        // the guard standing" are indistinguishable in a green run; this is the difference, executable.
        Assert.True(Enum.IsDefined(MachineDriverAvailability.AmbiguousDriver));

        const string codeA = "D1-GUARD-A";
        const string codeB = "D1-GUARD-B";
        var unattributableDriver = new InstanceFakeWritableDriver(DriverKinds.Modbus, codeA);

        var host = CreateHost(registry: null);
        Assert.True(host.RegisterMachine(ModbusMachine(codeA)));
        Assert.True(host.RegisterMachine(ModbusMachine(codeB)));
        host.AdditionalPipelinesForTests = () => new List<(string Label, IDeviceDriver Driver, MappingProfile Profile)>
        {
            ("modbus", unattributableDriver, new MappingProfile { Name = "modbus", DeviceClass = "Test" }),
        };

        host.Start();
        try
        {
            await WaitUntilAsync(
                () => host.GetDriverHealth().Any(s => s.SlotLabel == "modbus"),
                "the unattributable writable slot to come up");

            Assert.Equal(MachineDriverAvailability.AmbiguousDriver, host.GetMachineDriverAvailability(codeA));
            Assert.Equal(MachineDriverAvailability.AmbiguousDriver, host.GetMachineDriverAvailability(codeB));

            var (availability, result) = await host.TryWriteSetpointAsync(
                codeB, new SetpointWriteRequest("speed", 42.0), CancellationToken.None);

            Assert.Equal(MachineDriverAvailability.AmbiguousDriver, availability);
            Assert.Null(result);
            Assert.Equal(0, unattributableDriver.WriteCallCount);
        }
        finally
        {
            host.AdditionalPipelinesForTests = null;
            host.Stop();
        }
    }

    // ─────────────────────────────────────────────────────────────────────
    // Test doubles
    // ─────────────────────────────────────────────────────────────────────

    private sealed class InstanceFakeConnectorFactory : IConnectorFactory
    {
        private readonly Func<IDeviceDriver> _build;

        public InstanceFakeConnectorFactory(string kind, Func<IDeviceDriver> build)
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

    /// <summary>A writable driver that knows which machine it serves — which is the point: every assertion
    /// in this suite is about whether the RIGHT one of these was called, so each instance counts its own
    /// calls and records what it was asked to do.</summary>
    private sealed class InstanceFakeWritableDriver : IWritableDeviceDriver
    {
        private readonly string _machineCode;
        private long _counter;
        private int _writeCallCount;
        private int _commandCallCount;

        public InstanceFakeWritableDriver(string kind, string machineCode)
        {
            Kind = kind;
            _machineCode = machineCode;
        }

        /// <summary>Off by default so a resolution-only test does not pay for a reading loop; on for the
        /// test that proves each machine genuinely cycles off its OWN connector.</summary>
        public bool EmitReadings { get; init; }

        public string Id => $"fake-instance-{_machineCode}";

        public string Kind { get; }

        public DriverHealthState Health => DriverHealthState.Connected;

        public IReadOnlyList<string> WritablePoints { get; } = new[] { "speed" };

        public IReadOnlyList<string> Commands { get; } = new[] { "start-cycle" };

        public int WriteCallCount => Volatile.Read(ref _writeCallCount);

        public int CommandCallCount => Volatile.Read(ref _commandCallCount);

        public SetpointWriteRequest? LastSetpoint { get; private set; }

        public CommandRequest? LastCommand { get; private set; }

        public async IAsyncEnumerable<DeviceReading> ReadAsync([EnumeratorCancellation] CancellationToken ct)
        {
            if (!EmitReadings)
            {
                await Task.Delay(Timeout.Infinite, ct).ConfigureAwait(false);
                yield break; // unreachable — Task.Delay(Infinite, ct) only completes by throwing on cancel
            }

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

        public Task<SetpointWriteResult> WriteSetpointAsync(SetpointWriteRequest request, CancellationToken ct)
        {
            Interlocked.Increment(ref _writeCallCount);
            LastSetpoint = request;
            return Task.FromResult(new SetpointWriteResult(request.Point, WriteOutcome.Applied));
        }

        public Task<CommandResult> InvokeCommandAsync(CommandRequest request, CancellationToken ct)
        {
            Interlocked.Increment(ref _commandCallCount);
            LastCommand = request;
            return Task.FromResult(new CommandResult(request.Command, WriteOutcome.Applied));
        }
    }
}
