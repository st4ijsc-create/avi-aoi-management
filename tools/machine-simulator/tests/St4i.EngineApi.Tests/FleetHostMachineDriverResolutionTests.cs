using System.Diagnostics;
using System.Runtime.CompilerServices;
using St4i.Connector.Abstractions;
using St4i.EdgeCore.Infrastructure;
using St4i.EdgeCore.Mapping;
using St4i.EdgeCore.Models;
using St4i.Connector.Abstractions.Models;
using St4i.EdgeCore.Transport;
using St4i.EngineApi.Fleet;
using Xunit;

namespace St4i.EngineApi.Tests;

/// <summary>
/// Task B-2 (.superpowers/sdd/2026-07-29-dotB-machine-control-blueprint/task-2-brief.md) — proves the
/// machine-code -&gt; live-driver resolution path this task builds: <see cref="FleetHost.GetMachineDriverAvailability"/>
/// distinguishes the four operator-meaningful situations (machine not in the roster, in the roster but no
/// live slot, live but read-only, live and writable), and <see cref="FleetHost.TryWriteSetpointAsync"/>/
/// <see cref="FleetHost.TryInvokeCommandAsync"/> resolve the driver reference UNDER <c>_gate</c>, release it,
/// and only then perform I/O — never exposing the raw driver to a caller.
///
/// The disposal-race tests below use a REAL <see cref="SemaphoreSlim"/> with an initial count of 0 as the
/// blocking primitive: unlike the SQLite-style trap a reviewer proved elsewhere in this repo (async methods
/// that complete INLINE so a bare `await` never actually yields, making a "concurrency test" pass even with
/// the race mechanism deleted), `SemaphoreSlim.WaitAsync()` on an empty semaphore is guaranteed by the BCL to
/// suspend genuinely — it cannot complete synchronously with no one having called `Release()`.
///
/// <para>Review fix round 1 correction: the DISCRIMINATING evidence that teardown genuinely ran concurrently,
/// not sequentially, is <c>fakeDriver.DisposeStartedTask.IsCompleted</c> being <see langword="true"/>
/// immediately after the teardown call returns — that can only be true if <c>DisposeAsync</c> actually ran
/// while the write/command was still blocked on its own un-released semaphore. The companion
/// <c>Assert.False(...Task.IsCompleted, ...)</c> immediately after is NOT independent proof of concurrency (it
/// cannot fail on its own — nothing releases the semaphore until later in the same test method, so the task
/// is trivially still pending) — it stays only as a readability aid. The genuinely load-bearing checks are:
/// (1) the elapsed-time bound on the teardown call — if the teardown design instead waited for the write/
/// command to finish, this call would not just be SLOW, it would DEADLOCK (nothing ever releases the
/// semaphore before the bound is asserted), causing the test to time out rather than silently pass; and (2)
/// the mutation test described in the batch report: temporarily deleting <c>TryWriteSetpointAsync</c>'s
/// defensive catch and re-running <see cref="Estop_WhileSetpointWriteBlockedMidFlight_ReturnsPromptly_AndWriteObservesIndeterminate"/>
/// fails with the exact propagated <see cref="ObjectDisposedException"/>, proving the catch is exercised, not
/// dead code.</para>
/// </summary>
public sealed class FleetHostMachineDriverResolutionTests
{
    private static readonly TimeSpan PollTimeout = TimeSpan.FromSeconds(10);
    private static readonly TimeSpan PollInterval = TimeSpan.FromMilliseconds(100);

    /// <summary>Same composition every other FleetHost test suite in this project uses — default Demo mode,
    /// no real network call ever made.</summary>
    private static FleetHost CreateHost()
    {
        var demo = new DemoTransport(latencyMs: 0);
        var live = LiveTransport.ForMachine("http://localhost:1", mkKey: "", machineCode: "TEST", queuePath: null, verifyTls: true);
        var auto = new AutoTransport(live, demo);
        var switchable = new SwitchableTransport(demo);
        var coordinator = new TransportCoordinator(switchable, demo, live, auto, TransportMode.Demo);
        var eventBus = new EventBus();
        return new FleetHost(switchable, coordinator, eventBus);
    }

    private static MappingProfile TestProfile(string name) => new() { Name = name, DeviceClass = "Test" };

    /// <summary>A roster descriptor whose <see cref="MachineDescriptor.DriverKind"/> is
    /// <see cref="DriverKinds.Modbus"/> — StartLocked's own simFleet filter excludes Modbus/OPC-UA
    /// unconditionally (regardless of whether any <c>ConnectorRegistry</c> is wired), so this machine is
    /// never double-driven by the simulated group. Paired with <see cref="FleetHost.AdditionalPipelinesForTests"/>
    /// injecting a slot labeled "modbus" (the same legacy label <c>FleetHost.ResolveConnectorSlotLabel</c>
    /// produces for a real Modbus connector), this is the cheapest way to get a live, resolvable, WRITABLE
    /// slot into a test without standing up NModbus or a real <c>ConnectorRegistry</c>/<c>IConnectorFactory</c>.</summary>
    private static MachineDescriptor NewModbusStyleMachine(string code) => new(
        code, $"SN-{code}", DeviceClass.Automation, "MODBUS_TCP", null,
        DriverKinds.Modbus, null, null, CycleSeconds: 0.5);

    /// <summary>An ordinary simulated roster addition — used as the "bystander" registration in the
    /// restart-triggered disposal-race test, so the test reads as the realistic case (onboarding a brand new
    /// machine mid-run) rather than implying two live Modbus connectors ever coexist (the scoped facts are
    /// explicit that at most one does).</summary>
    private static MachineDescriptor NewFastSimulatedMachine(string code) => new(
        code, $"SN-{code}", DeviceClass.Automation, "SCREWDRIVE", "screw_tightening",
        DriverKinds.Simulated, "RC-TEST-A", null, CycleSeconds: 0.1);

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
    // Resolution: the four distinguishable "not available" / "available" cases.
    // ─────────────────────────────────────────────────────────────────────

    [Fact]
    public void GetMachineDriverAvailability_UnknownCode_ReturnsMachineNotFound()
    {
        var host = CreateHost();

        Assert.Equal(MachineDriverAvailability.MachineNotFound, host.GetMachineDriverAvailability("DOES-NOT-EXIST"));
    }

    [Fact]
    public void GetMachineDriverAvailability_KnownMachine_FleetNeverStarted_ReturnsNoLiveDriver()
    {
        var host = CreateHost();

        // SCRW-01 is part of BuildDefaultFleet's demo roster (Simulated) — known to the roster, but the
        // fleet was never Start()ed, so no PipelineSlot exists for it yet.
        Assert.Equal(MachineDriverAvailability.NoLiveDriver, host.GetMachineDriverAvailability("SCRW-01"));
    }

    [Fact]
    public async Task GetMachineDriverAvailability_KnownMachine_FleetStoppedAfterRunning_ReturnsNoLiveDriver()
    {
        var host = CreateHost();
        host.Start();
        try
        {
            await WaitUntilAsync(() => host.Snapshot().Kpis.Online > 0, "simulated slot online after Start");
        }
        finally
        {
            host.Stop();
        }

        Assert.Equal(MachineDriverAvailability.NoLiveDriver, host.GetMachineDriverAvailability("SCRW-01"));
    }

    [Fact]
    public async Task GetMachineDriverAvailability_SimulatedMachineWhileRunning_ReturnsReadOnly()
    {
        var host = CreateHost();
        host.Start();
        try
        {
            await WaitUntilAsync(() => host.Snapshot().Kpis.Online > 0, "simulated slot online after Start");

            // The built-in simulated group's driver (ScenarioAwareDriver wrapping SimulatedDriver) never
            // implements IWritableDeviceDriver — every demo machine must resolve to ReadOnly, never Writable.
            Assert.Equal(MachineDriverAvailability.ReadOnly, host.GetMachineDriverAvailability("SCRW-01"));
        }
        finally
        {
            host.Stop();
        }
    }

    [Fact]
    public async Task GetMachineDriverAvailability_MachineWithLiveWritableDriver_ReturnsWritable()
    {
        var host = CreateHost();
        const string code = "WRITE-RES-01";
        var fakeDriver = new FakeWritableDriver();

        Assert.True(host.RegisterMachine(NewModbusStyleMachine(code)));
        host.AdditionalPipelinesForTests = () => new List<(string Label, IDeviceDriver Driver, MappingProfile Profile)>
        {
            ("modbus", fakeDriver, TestProfile("modbus")),
        };

        host.Start();
        try
        {
            await WaitUntilAsync(
                () => host.GetMachineDriverAvailability(code) == MachineDriverAvailability.Writable,
                "the injected writable driver's slot to come up");
        }
        finally
        {
            host.AdditionalPipelinesForTests = null;
            host.Stop();
        }
    }

    /// <summary>Review fix round 1 (Important, I1) — regression pin for the bug the reviewer's running probe
    /// found: <c>ResolveWritableDriver</c> used to re-derive its OWN, simpler approximation of
    /// <c>StartLocked</c>'s slot-label rule, which didn't know that a third-party-kind roster machine with NO
    /// connector currently registered for its kind falls back to being driven by the built-in simulated group
    /// (a real, pre-existing, tested behavior — <c>FleetHostThirdPartyRosterTests.ThirdPartyRosterMember_NoConnectorRegisteredForThatId_FallsBackToSimulation</c>).
    /// The old approximation instead looked for a slot LABELED with the machine's own third-party kind, found
    /// none, and reported <see cref="MachineDriverAvailability.NoLiveDriver"/> for a machine that was actually
    /// live and cycling under the simulated group. No <c>ConnectorRegistry</c> is passed to <see cref="CreateHost"/>
    /// here (null, the common no-connectors-configured case), so this machine's kind is guaranteed unregistered
    /// — exactly the fallback case.</summary>
    [Fact]
    public async Task GetMachineDriverAvailability_ThirdPartyKindWithNoRegisteredConnector_FallsBackToSimulated_ReturnsReadOnly_NotNoLiveDriver()
    {
        var host = CreateHost();
        const string code = "THIRDPARTY-NO-CONNECTOR-01";
        var descriptor = new MachineDescriptor(
            code, $"SN-{code}", DeviceClass.Automation, "SCREWDRIVE", "screw_tightening",
            "vendor.acme.unregistered", "RC-TEST-A", null, CycleSeconds: 0.1);

        Assert.True(host.RegisterMachine(descriptor));

        host.Start();
        try
        {
            await WaitUntilAsync(() => (host.MachineDetail(code)?.Cycles ?? 0) > 0, $"{code} to cycle under the simulated-group fallback");

            // The load-bearing assertion: this machine IS live (cycling, under the simulated group's shared
            // driver) — the correct answer is ReadOnly (that shared driver never implements
            // IWritableDeviceDriver), never NoLiveDriver.
            Assert.Equal(MachineDriverAvailability.ReadOnly, host.GetMachineDriverAvailability(code));
        }
        finally
        {
            host.Stop();
        }
    }

    // ─────────────────────────────────────────────────────────────────────
    // C1 (Critical, review round 1) — a slot shared by more than one roster member must never report
    // Writable: ConnectorRegistry keeps at most one live driver per protocol Kind for the whole fleet, and
    // neither SetpointWriteRequest nor CommandRequest carries a machine code, so a write for machine B could
    // otherwise be silently delivered to machine A's device.
    // ─────────────────────────────────────────────────────────────────────

    [Fact]
    public async Task GetMachineDriverAvailability_TwoRosterMembersShareSameConnectorKind_ReturnsAmbiguousDriver_NotWritable()
    {
        var host = CreateHost();
        const string codeA = "MODBUS-REAL-01";
        const string codeB = "MODBUS-OTHER-02";
        var fakeDriver = new FakeWritableDriver();

        // The reviewer's own probe shape: two roster members declaring the SAME DriverKind (Modbus), one
        // single injected "modbus" slot — reachable in production via a hand-edited fleet.json with two
        // "driverKind": "Modbus" entries (FleetConfig.Load has no per-kind uniqueness guard) or two
        // RegisterMachine calls for the same kind.
        Assert.True(host.RegisterMachine(NewModbusStyleMachine(codeA)));
        Assert.True(host.RegisterMachine(NewModbusStyleMachine(codeB)));
        host.AdditionalPipelinesForTests = () => new List<(string Label, IDeviceDriver Driver, MappingProfile Profile)>
        {
            ("modbus", fakeDriver, TestProfile("modbus")),
        };

        host.Start();
        try
        {
            await WaitUntilAsync(
                () => host.GetDriverHealth().Any(s => s.SlotLabel == "modbus"),
                "the shared modbus slot to come up");

            // BOTH machine codes resolve to the SAME live, writable slot — neither may be reported Writable.
            Assert.Equal(MachineDriverAvailability.AmbiguousDriver, host.GetMachineDriverAvailability(codeA));
            Assert.Equal(MachineDriverAvailability.AmbiguousDriver, host.GetMachineDriverAvailability(codeB));
        }
        finally
        {
            host.AdditionalPipelinesForTests = null;
            host.Stop();
        }
    }

    [Fact]
    public async Task TryWriteSetpointAsync_TwoRosterMembersShareSameConnectorKind_ReturnsAmbiguousDriver_NullResult_NoIoAttempted()
    {
        var host = CreateHost();
        const string codeA = "MODBUS-REAL-03";
        const string codeB = "MODBUS-OTHER-04";
        var fakeDriver = new FakeWritableDriver();

        Assert.True(host.RegisterMachine(NewModbusStyleMachine(codeA)));
        Assert.True(host.RegisterMachine(NewModbusStyleMachine(codeB)));
        host.AdditionalPipelinesForTests = () => new List<(string Label, IDeviceDriver Driver, MappingProfile Profile)>
        {
            ("modbus", fakeDriver, TestProfile("modbus")),
        };

        host.Start();
        try
        {
            await WaitUntilAsync(
                () => host.GetDriverHealth().Any(s => s.SlotLabel == "modbus"),
                "the shared modbus slot to come up");

            // The load-bearing assertion from the reviewer's probe: a write aimed at codeB must NOT reach the
            // driver at all (WriteCallCount stays 0) — the exact "wrong machine" hazard C1 closes.
            var (availability, result) = await host.TryWriteSetpointAsync(
                codeB, new SetpointWriteRequest("speed", 99.0), CancellationToken.None);

            Assert.Equal(MachineDriverAvailability.AmbiguousDriver, availability);
            Assert.Null(result);
            Assert.Equal(0, fakeDriver.WriteCallCount);
        }
        finally
        {
            host.AdditionalPipelinesForTests = null;
            host.Stop();
        }
    }

    // ─────────────────────────────────────────────────────────────────────
    // TryWriteSetpointAsync / TryInvokeCommandAsync — resolution short-circuits (no I/O attempted).
    // ─────────────────────────────────────────────────────────────────────

    [Fact]
    public async Task TryWriteSetpointAsync_UnknownMachine_ReturnsMachineNotFound_NullResult_NoIoAttempted()
    {
        var host = CreateHost();

        var (availability, result) = await host.TryWriteSetpointAsync(
            "DOES-NOT-EXIST", new SetpointWriteRequest("speed", 1.0), CancellationToken.None);

        Assert.Equal(MachineDriverAvailability.MachineNotFound, availability);
        Assert.Null(result);
    }

    [Fact]
    public async Task TryWriteSetpointAsync_FleetStopped_ReturnsNoLiveDriver_NullResult()
    {
        var host = CreateHost();

        var (availability, result) = await host.TryWriteSetpointAsync(
            "SCRW-01", new SetpointWriteRequest("speed", 1.0), CancellationToken.None);

        Assert.Equal(MachineDriverAvailability.NoLiveDriver, availability);
        Assert.Null(result);
    }

    [Fact]
    public async Task TryWriteSetpointAsync_ReadOnlyDriver_ReturnsReadOnly_NullResult()
    {
        var host = CreateHost();
        host.Start();
        try
        {
            await WaitUntilAsync(() => host.Snapshot().Kpis.Online > 0, "simulated slot online after Start");

            var (availability, result) = await host.TryWriteSetpointAsync(
                "SCRW-01", new SetpointWriteRequest("speed", 1.0), CancellationToken.None);

            Assert.Equal(MachineDriverAvailability.ReadOnly, availability);
            Assert.Null(result);
        }
        finally
        {
            host.Stop();
        }
    }

    [Fact]
    public async Task TryWriteSetpointAsync_WritableDriver_CallsThroughAndReturnsDriverResult()
    {
        var host = CreateHost();
        const string code = "WRITE-OK-01";
        var fakeDriver = new FakeWritableDriver();

        Assert.True(host.RegisterMachine(NewModbusStyleMachine(code)));
        host.AdditionalPipelinesForTests = () => new List<(string Label, IDeviceDriver Driver, MappingProfile Profile)>
        {
            ("modbus", fakeDriver, TestProfile("modbus")),
        };

        host.Start();
        try
        {
            await WaitUntilAsync(
                () => host.GetMachineDriverAvailability(code) == MachineDriverAvailability.Writable,
                "the injected writable driver's slot to come up");

            var request = new SetpointWriteRequest("speed", 42.0);
            var (availability, result) = await host.TryWriteSetpointAsync(code, request, CancellationToken.None);

            Assert.Equal(MachineDriverAvailability.Writable, availability);
            Assert.NotNull(result);
            Assert.Equal(WriteOutcome.Applied, result!.Outcome);
            Assert.Equal(1, fakeDriver.WriteCallCount);
            Assert.Equal("speed", fakeDriver.LastRequest?.Point);
            Assert.Equal(42.0, fakeDriver.LastRequest?.Value);
        }
        finally
        {
            host.AdditionalPipelinesForTests = null;
            host.Stop();
        }
    }

    [Fact]
    public async Task TryInvokeCommandAsync_UnknownMachine_ReturnsMachineNotFound_NullResult()
    {
        var host = CreateHost();

        var (availability, result) = await host.TryInvokeCommandAsync(
            "DOES-NOT-EXIST", new CommandRequest("start-cycle"), CancellationToken.None);

        Assert.Equal(MachineDriverAvailability.MachineNotFound, availability);
        Assert.Null(result);
    }

    /// <summary>Review fix round 1 (I2) — the command-side mirror of <see cref="TryWriteSetpointAsync_FleetStopped_ReturnsNoLiveDriver_NullResult"/>,
    /// previously untested: before this fix, deleting <see cref="FleetHost.TryInvokeCommandAsync"/>'s
    /// resolution short-circuit entirely would still have passed the suite.</summary>
    [Fact]
    public async Task TryInvokeCommandAsync_FleetStopped_ReturnsNoLiveDriver_NullResult()
    {
        var host = CreateHost();

        var (availability, result) = await host.TryInvokeCommandAsync(
            "SCRW-01", new CommandRequest("start-cycle"), CancellationToken.None);

        Assert.Equal(MachineDriverAvailability.NoLiveDriver, availability);
        Assert.Null(result);
    }

    /// <summary>Review fix round 1 (I2) — the command-side mirror of <see cref="TryWriteSetpointAsync_ReadOnlyDriver_ReturnsReadOnly_NullResult"/>.</summary>
    [Fact]
    public async Task TryInvokeCommandAsync_ReadOnlyDriver_ReturnsReadOnly_NullResult()
    {
        var host = CreateHost();
        host.Start();
        try
        {
            await WaitUntilAsync(() => host.Snapshot().Kpis.Online > 0, "simulated slot online after Start");

            var (availability, result) = await host.TryInvokeCommandAsync(
                "SCRW-01", new CommandRequest("start-cycle"), CancellationToken.None);

            Assert.Equal(MachineDriverAvailability.ReadOnly, availability);
            Assert.Null(result);
        }
        finally
        {
            host.Stop();
        }
    }

    [Fact]
    public async Task TryInvokeCommandAsync_WritableDriver_CallsThroughAndReturnsDriverResult()
    {
        var host = CreateHost();
        const string code = "CMD-OK-01";
        var fakeDriver = new FakeWritableDriver();

        Assert.True(host.RegisterMachine(NewModbusStyleMachine(code)));
        host.AdditionalPipelinesForTests = () => new List<(string Label, IDeviceDriver Driver, MappingProfile Profile)>
        {
            ("modbus", fakeDriver, TestProfile("modbus")),
        };

        host.Start();
        try
        {
            await WaitUntilAsync(
                () => host.GetMachineDriverAvailability(code) == MachineDriverAvailability.Writable,
                "the injected writable driver's slot to come up");

            var (availability, result) = await host.TryInvokeCommandAsync(
                code, new CommandRequest("start-cycle"), CancellationToken.None);

            Assert.Equal(MachineDriverAvailability.Writable, availability);
            Assert.NotNull(result);
            Assert.Equal(WriteOutcome.Applied, result!.Outcome);
            Assert.Equal(1, fakeDriver.CommandCallCount);
        }
        finally
        {
            host.AdditionalPipelinesForTests = null;
            host.Stop();
        }
    }

    // ─────────────────────────────────────────────────────────────────────
    // THE DISPOSAL RACE — the substance of this task.
    // ─────────────────────────────────────────────────────────────────────

    /// <summary>
    /// THE core proof this task exists to deliver: a setpoint write genuinely in flight (blocked mid-call,
    /// on a real <see cref="SemaphoreSlim"/>, on a SEPARATE <see cref="Task.Run(Action)"/>) while
    /// <see cref="FleetHost.Estop"/> tears the slot down concurrently.
    ///
    /// Two things are asserted, both load-bearing:
    /// <list type="number">
    /// <item><description><b>HALT is not delayed</b> — timed the same way an earlier task proved the
    /// orphan-connector-disposal fix (<c>FleetHostConnectorRegistryTests</c>'
    /// <c>Estop_DuringSlowOrphanedConnectorDisposal_ReturnsPromptly</c>): call <see cref="FleetHost.Estop"/>
    /// on THIS thread while the write is still blocked on the far side of a real <c>Task.Run</c>, and assert
    /// it returns in well under a second. <see cref="FleetHost.Estop"/> disposes <see cref="fakeDriver"/>
    /// unconditionally — it does NOT wait for the semaphore the write is blocked on — so this passing proves
    /// disposal never waits on an in-flight write.</description></item>
    /// <item><description><b>The in-flight write observes <see cref="WriteOutcome.Indeterminate"/></b>, never
    /// a crash and never a false <see cref="WriteOutcome.Applied"/>: released only AFTER Estop() has already
    /// disposed the driver, <see cref="FakeWritableDriver.WriteSetpointAsync"/> throws
    /// <see cref="ObjectDisposedException"/> (misbehaving relative to <c>IWritableDeviceDriver</c>'s own
    /// "never let it propagate" contract, on purpose) — <see cref="FleetHost.TryWriteSetpointAsync"/>'s own
    /// defensive catch is what converts that into <see cref="WriteOutcome.Indeterminate"/>. Removing that
    /// catch would turn this exact test into an unhandled-exception failure, which is how this test proves the
    /// backstop is load-bearing, not decorative.</description></item>
    /// </list>
    ///
    /// Genuine concurrency, not a sequential approximation: <c>fakeDriver.DisposeStartedTask.IsCompleted</c>
    /// being true immediately after <see cref="FleetHost.Estop"/> returns is the discriminating fact — it can
    /// only be true if <c>DisposeAsync</c> genuinely ran while <see cref="FakeWritableDriver.WriteSetpointAsync"/>
    /// was still suspended on its own un-released <see cref="SemaphoreSlim"/>. A sequential/synchronously-
    /// completing stand-in (the exact SQLite-style trap this repo has shipped before) could not produce this:
    /// either the write would finish before <see cref="FleetHost.Estop"/> ever ran, or — if the disposal design
    /// instead waited for the write — <see cref="FleetHost.Estop"/> would DEADLOCK on the still-unreleased
    /// semaphore rather than return within the 1-second bound asserted below, so the test would time out, never
    /// silently pass. Verified directly: temporarily deleting <see cref="FleetHost.TryWriteSetpointAsync"/>'s
    /// defensive catch and re-running this test fails with the exact propagated
    /// <see cref="ObjectDisposedException"/> — see the batch report's fix-round-1 section.
    /// </summary>
    [Fact]
    public async Task Estop_WhileSetpointWriteBlockedMidFlight_ReturnsPromptly_AndWriteObservesIndeterminate()
    {
        var host = CreateHost();
        const string code = "WRITE-RACE-ESTOP-01";
        var fakeDriver = new FakeWritableDriver { BlockOnWrite = true, ThrowIfDisposedWhenReleased = true };

        Assert.True(host.RegisterMachine(NewModbusStyleMachine(code)));
        host.AdditionalPipelinesForTests = () => new List<(string Label, IDeviceDriver Driver, MappingProfile Profile)>
        {
            ("modbus", fakeDriver, TestProfile("modbus")),
        };

        // 🔴 backlog-test-deadlines — `writeTask` is hoisted out of the `try` so the `finally` can JOIN it.
        // Every assertion between its launch and `await writeTask` used to be able to skip both
        // `fakeDriver.ReleaseWrite()` and the join, leaving the task suspended on an empty semaphore that
        // nothing in the process would ever release. `CancelPendingWaitsForTeardown()` is the seam that ends
        // it; on the green path it runs after the write has already returned and is a no-op.
        Task<(MachineDriverAvailability, SetpointWriteResult?)>? writeTask = null;
        host.Start();
        try
        {
            await WaitUntilAsync(
                () => host.GetMachineDriverAvailability(code) == MachineDriverAvailability.Writable,
                "the injected writable driver's slot to come up");

            writeTask = Task.Run(() => host.TryWriteSetpointAsync(
                code, new SetpointWriteRequest("speed", 42.0), CancellationToken.None));

            await WaitUntilAsync(() => fakeDriver.WriteStarted, "the fake driver's WriteSetpointAsync to actually begin executing");

            // At this instant the write is genuinely blocked on fakeDriver's semaphore, on its own Task.Run
            // thread. Time a concurrent Estop() — it must not be stuck waiting for that write to finish.
            var stopwatch = Stopwatch.StartNew();
            host.Estop();
            stopwatch.Stop();

            Assert.True(
                stopwatch.Elapsed < TimeSpan.FromSeconds(1),
                $"Estop() took {stopwatch.Elapsed} while a setpoint write was still blocked mid-flight — " +
                "HALT must never be delayed by an in-flight write.");

            // Proof this is a genuine race, not a sequential illusion: Estop() has ALREADY disposed the
            // driver (off-lock teardown runs synchronously inside Estop(), see WaitAndDisposeOldPipeline),
            // yet the write task is STILL not complete — it is well and truly suspended on the semaphore,
            // not finished-and-forgotten.
            Assert.True(fakeDriver.DisposeStartedTask.IsCompleted, "Estop() must have disposed the driver by the time it returns");
            Assert.False(writeTask.IsCompleted, "the write must still be genuinely in flight immediately after Estop() returns");

            // Now let the blocked write resume — it will observe _disposed == true and (per this fake's
            // ThrowIfDisposedWhenReleased setting) throw, exercising TryWriteSetpointAsync's own defensive
            // catch rather than a well-behaved driver's own Indeterminate return.
            fakeDriver.ReleaseWrite();

            var completed = await Task.WhenAny(writeTask, Task.Delay(TimeSpan.FromSeconds(5)));
            Assert.Same(writeTask, completed);

            var (availability, result) = await writeTask;
            Assert.Equal(MachineDriverAvailability.Writable, availability);
            Assert.NotNull(result);
            Assert.Equal(WriteOutcome.Indeterminate, result!.Outcome);
            Assert.Null(result.RejectionReason);
            Assert.NotNull(result.Detail);
        }
        finally
        {
            fakeDriver.CancelPendingWaitsForTeardown();
            if (writeTask is not null)
            {
                try { await writeTask; } catch { /* teardown */ }
            }

            host.AdditionalPipelinesForTests = null;
            host.Stop();
        }
    }

    /// <summary>Same disposal race, different trigger: <see cref="FleetHost.RegisterMachine"/> restarting the
    /// pipeline mid-run — one of the four teardown triggers the brief calls out by name (alongside
    /// <see cref="FleetHost.Stop"/>/<see cref="FleetHost.Estop"/>/a per-slot fault). Proves the same
    /// resolve-under-gate/write-off-gate design is not special-cased to Estop() alone: nothing in
    /// <see cref="FleetHost.TryWriteSetpointAsync"/> knows or cares which of the four triggers tore its
    /// resolved driver down.</summary>
    [Fact]
    public async Task RegisterMachineRestart_WhileSetpointWriteBlockedMidFlight_WriteObservesIndeterminate_NeverCrashes()
    {
        var host = CreateHost();
        const string code = "WRITE-RACE-RESTART-01";
        var fakeDriver = new FakeWritableDriver { BlockOnWrite = true, ThrowIfDisposedWhenReleased = false };

        Assert.True(host.RegisterMachine(NewModbusStyleMachine(code)));
        host.AdditionalPipelinesForTests = () => new List<(string Label, IDeviceDriver Driver, MappingProfile Profile)>
        {
            ("modbus", fakeDriver, TestProfile("modbus")),
        };

        // 🔴 backlog-test-deadlines — see the sibling Estop test above for why `writeTask` is hoisted.
        Task<(MachineDriverAvailability, SetpointWriteResult?)>? writeTask = null;
        host.Start();
        try
        {
            await WaitUntilAsync(
                () => host.GetMachineDriverAvailability(code) == MachineDriverAvailability.Writable,
                "the injected writable driver's slot to come up");

            writeTask = Task.Run(() => host.TryWriteSetpointAsync(
                code, new SetpointWriteRequest("speed", 7.0), CancellationToken.None));

            await WaitUntilAsync(() => fakeDriver.WriteStarted, "the fake driver's WriteSetpointAsync to actually begin executing");

            // RegisterMachine with a brand-new code triggers StopLocked -> WaitAndDisposeOldPipeline ->
            // StartLocked on the CURRENT roster (including fakeDriver's slot, rebuilt fresh) while the write
            // above is still blocked against the OLD fakeDriver instance.
            var restartStopwatch = Stopwatch.StartNew();
            Assert.True(host.RegisterMachine(NewFastSimulatedMachine("WRITE-RACE-RESTART-BYSTANDER-01")));
            restartStopwatch.Stop();

            // 🔴 backlog-test-deadlines — `restartStopwatch` used to be started, stopped and NEVER READ, so the
            // timing half of this test's own premise ("the restart is not delayed by the in-flight write") was
            // asserted only by its sibling Estop test, one trigger away. It now says what it measures.
            //
            // The bound is NOT a new tunable: it is the 1 s floor the sibling Estop test already uses, and the
            // measurement says the floor is what applies. RegisterMachine's restart under exactly this
            // interleaving was measured at 1.9 ms / 2.8 ms / 3.0 ms across three runs (taken by asserting an
            // impossible bound and reading the reported elapsed), so 4x the slowest observation is 12 ms —
            // two orders of magnitude below the floor. What the bound discriminates is "did not wait for the
            // write" from "waited for the write", and a restart that DID wait could not merely be slow: it
            // would deadlock, because nothing releases the write's semaphore until ReleaseWrite() below.
            Assert.True(
                restartStopwatch.Elapsed < TimeSpan.FromSeconds(1),
                $"RegisterMachine's restart took {restartStopwatch.Elapsed} while a setpoint write was still " +
                "blocked mid-flight — a pipeline restart must never be delayed by an in-flight write.");

            Assert.True(fakeDriver.DisposeStartedTask.IsCompleted, "the restart must have disposed the OLD driver instance");
            Assert.False(writeTask.IsCompleted, "the write must still be genuinely in flight when the restart's dispose happens");

            // This fake is contract-compliant here (ThrowIfDisposedWhenReleased = false): it notices the
            // concurrent dispose itself and returns Indeterminate, proving the well-behaved path forwards
            // through FleetHost untouched, distinct from the other test's defensive-catch path.
            fakeDriver.ReleaseWrite();

            var completed = await Task.WhenAny(writeTask, Task.Delay(TimeSpan.FromSeconds(5)));
            Assert.Same(writeTask, completed);

            var (availability, result) = await writeTask;
            Assert.Equal(MachineDriverAvailability.Writable, availability);
            Assert.NotNull(result);
            Assert.Equal(WriteOutcome.Indeterminate, result!.Outcome);
        }
        finally
        {
            fakeDriver.CancelPendingWaitsForTeardown();
            if (writeTask is not null)
            {
                try { await writeTask; } catch { /* teardown */ }
            }

            host.AdditionalPipelinesForTests = null;
            host.Stop();
        }
    }

    /// <summary>Review fix round 1 (Important, I2) — the command-path disposal race, mirroring
    /// <see cref="Estop_WhileSetpointWriteBlockedMidFlight_ReturnsPromptly_AndWriteObservesIndeterminate"/>
    /// exactly, but for <see cref="FleetHost.TryInvokeCommandAsync"/>. Before this fix, both race tests
    /// exercised ONLY the setpoint path — <see cref="FakeWritableDriver.InvokeCommandAsync"/> never blocked and
    /// never checked <c>_disposed</c>, so deleting <see cref="FleetHost.TryInvokeCommandAsync"/>'s own
    /// defensive catch would have failed no test. Per B-1, <c>InvokeCommandAsync</c> is the HIGHER-risk member
    /// (it can trigger real physical motion), so it gets the same mutation-provable coverage as the setpoint
    /// path, not a weaker claim of "same handling" resting on an untested assumption.</summary>
    [Fact]
    public async Task Estop_WhileCommandInvocationBlockedMidFlight_ReturnsPromptly_AndCommandObservesIndeterminate()
    {
        var host = CreateHost();
        const string code = "CMD-RACE-ESTOP-01";
        var fakeDriver = new FakeWritableDriver { BlockOnCommand = true, ThrowIfDisposedWhenReleased = true };

        Assert.True(host.RegisterMachine(NewModbusStyleMachine(code)));
        host.AdditionalPipelinesForTests = () => new List<(string Label, IDeviceDriver Driver, MappingProfile Profile)>
        {
            ("modbus", fakeDriver, TestProfile("modbus")),
        };

        // 🔴 backlog-test-deadlines — see the Estop setpoint test above for why `commandTask` is hoisted.
        Task<(MachineDriverAvailability, CommandResult?)>? commandTask = null;
        host.Start();
        try
        {
            await WaitUntilAsync(
                () => host.GetMachineDriverAvailability(code) == MachineDriverAvailability.Writable,
                "the injected writable driver's slot to come up");

            commandTask = Task.Run(() => host.TryInvokeCommandAsync(
                code, new CommandRequest("start-cycle"), CancellationToken.None));

            await WaitUntilAsync(() => fakeDriver.CommandStarted, "the fake driver's InvokeCommandAsync to actually begin executing");

            var stopwatch = Stopwatch.StartNew();
            host.Estop();
            stopwatch.Stop();

            Assert.True(
                stopwatch.Elapsed < TimeSpan.FromSeconds(1),
                $"Estop() took {stopwatch.Elapsed} while a command invocation was still blocked mid-flight — " +
                "HALT must never be delayed by an in-flight command.");

            Assert.True(fakeDriver.DisposeStartedTask.IsCompleted, "Estop() must have disposed the driver by the time it returns");

            // Same throwing-on-release shape as the setpoint race test — exercises TryInvokeCommandAsync's
            // OWN defensive catch, proving it (not just the setpoint path's) is load-bearing.
            fakeDriver.ReleaseCommand();

            var completed = await Task.WhenAny(commandTask, Task.Delay(TimeSpan.FromSeconds(5)));
            Assert.Same(commandTask, completed);

            var (availability, result) = await commandTask;
            Assert.Equal(MachineDriverAvailability.Writable, availability);
            Assert.NotNull(result);
            Assert.Equal(WriteOutcome.Indeterminate, result!.Outcome);
            Assert.Null(result.RejectionReason);
            Assert.NotNull(result.Detail);
        }
        finally
        {
            fakeDriver.CancelPendingWaitsForTeardown();
            if (commandTask is not null)
            {
                try { await commandTask; } catch { /* teardown */ }
            }

            host.AdditionalPipelinesForTests = null;
            host.Stop();
        }
    }

    // ─────────────────────────────────────────────────────────────────────
    // Test double
    // ─────────────────────────────────────────────────────────────────────

    /// <summary>Test double implementing both halves of <see cref="IWritableDeviceDriver"/>. Its
    /// <see cref="ReadAsync"/> never yields anything (a real machine-code-scoped write driver in production
    /// would still poll for readings the same way ModbusTcpDriver does; this fake only needs to satisfy
    /// <see cref="EdgePipeline"/>'s enumeration contract long enough to be cancelled cleanly on teardown).
    /// <see cref="WriteSetpointAsync"/> optionally BLOCKS (<see cref="BlockOnWrite"/>) on a real
    /// <see cref="SemaphoreSlim"/> until <see cref="ReleaseWrite"/> is called from a test's own thread — this
    /// is what makes the disposal-race tests above genuinely concurrent rather than a sequential
    /// approximation.</summary>
    private sealed class FakeWritableDriver : IWritableDeviceDriver
    {
        private readonly SemaphoreSlim _writeGate = new(0, 1);
        private readonly SemaphoreSlim _commandGate = new(0, 1);

        /// <summary>🔴 backlog-test-deadlines — the teardown seam for the two gates below, and the ONLY thing
        /// that can end a wait <see cref="ReleaseWrite"/>/<see cref="ReleaseCommand"/> never got to release.
        ///
        /// <para>The gates deliberately ignore the CALLER's token (that is the point: the write must stay
        /// suspended while teardown races it), so before this existed a failed assertion anywhere between
        /// launching the write and releasing it left the task suspended on an empty semaphore with nothing in
        /// the process able to complete it — permanently, since <see cref="FleetHost.Stop"/> does not touch
        /// this fake's gates. Cancelled ONLY from a test's own <c>finally</c>, never from
        /// <see cref="DisposeAsync"/>: FleetHost disposes this driver as part of the very race under test, so
        /// releasing the block there would destroy what the test measures.</para></summary>
        private readonly CancellationTokenSource _teardown = new();
        private readonly TaskCompletionSource _writeStarted = new(TaskCreationOptions.RunContinuationsAsynchronously);
        private readonly TaskCompletionSource _commandStarted = new(TaskCreationOptions.RunContinuationsAsynchronously);
        private readonly TaskCompletionSource _disposeStarted = new(TaskCreationOptions.RunContinuationsAsynchronously);
        private volatile bool _disposed;
        private int _writeCallCount;
        private int _commandCallCount;

        /// <summary>When true, <see cref="WriteSetpointAsync"/> suspends on <see cref="_writeGate"/> until
        /// <see cref="ReleaseWrite"/> is called — the mid-flight blocking point the race tests exploit.</summary>
        public bool BlockOnWrite { get; init; }

        /// <summary>Review fix round 1 (I2) — the command-side mirror of <see cref="BlockOnWrite"/>:
        /// <see cref="InvokeCommandAsync"/> suspends on <see cref="_commandGate"/> until
        /// <see cref="ReleaseCommand"/> is called. Added specifically so the command path — B-1's HIGHER-risk
        /// member — gets the same genuinely-concurrent disposal-race coverage the setpoint path already had,
        /// rather than resting on an untested "same handling" assumption.</summary>
        public bool BlockOnCommand { get; init; }

        /// <summary>When a blocked write/command resumes and observes <see cref="_disposed"/> is true:
        /// <see langword="true"/> throws <see cref="ObjectDisposedException"/> (misbehaving relative to
        /// <c>IWritableDeviceDriver</c>'s own contract, on purpose — exercises <see cref="FleetHost.TryWriteSetpointAsync"/>/
        /// <see cref="FleetHost.TryInvokeCommandAsync"/>'s own defensive catch); <see langword="false"/> returns
        /// <see cref="WriteOutcome.Indeterminate"/> itself (the contract-compliant path). Applies uniformly to
        /// whichever operation a given test exercises.</summary>
        public bool ThrowIfDisposedWhenReleased { get; init; }

        public bool WriteStarted => _writeStarted.Task.IsCompleted;

        public bool CommandStarted => _commandStarted.Task.IsCompleted;

        public Task DisposeStartedTask => _disposeStarted.Task;

        public int WriteCallCount => Volatile.Read(ref _writeCallCount);

        public int CommandCallCount => Volatile.Read(ref _commandCallCount);

        public SetpointWriteRequest? LastRequest { get; private set; }

        public void ReleaseWrite() => _writeGate.Release();

        public void ReleaseCommand() => _commandGate.Release();

        /// <summary>Ends any wait still parked on either gate, so a test's <c>finally</c> can JOIN the task it
        /// launched instead of abandoning it. Idempotent, and a no-op on the green path (by then the gate has
        /// already been released and the operation has already returned).</summary>
        public void CancelPendingWaitsForTeardown()
        {
            try { _teardown.Cancel(); } catch { /* teardown */ }
        }

        public string Id => "fake-writable-test-driver";

        public string Kind => DriverKinds.Modbus;

        public DriverHealthState Health => DriverHealthState.Connected;

        public IReadOnlyList<string> WritablePoints { get; } = new[] { "speed" };

        public IReadOnlyList<string> Commands { get; } = new[] { "start-cycle" };

        public async IAsyncEnumerable<DeviceReading> ReadAsync([EnumeratorCancellation] CancellationToken ct)
        {
            await Task.Delay(Timeout.Infinite, ct).ConfigureAwait(false);
            yield break; // unreachable — Task.Delay(Infinite, ct) only ever completes by throwing on cancel
        }

        public ValueTask DisposeAsync()
        {
            _disposed = true;
            _disposeStarted.TrySetResult();
            return ValueTask.CompletedTask;
        }

        public async Task<SetpointWriteResult> WriteSetpointAsync(SetpointWriteRequest request, CancellationToken ct)
        {
            Interlocked.Increment(ref _writeCallCount);
            LastRequest = request;
            _writeStarted.TrySetResult();

            if (BlockOnWrite)
            {
                // Still ignores the CALLER's `ct` on purpose — the write must stay suspended while teardown
                // races it. `_teardown` is a test-harness seam only (see its own remarks); on the green path it
                // is never signalled and this is a plain, genuinely-suspending WaitAsync.
                await _writeGate.WaitAsync(_teardown.Token).ConfigureAwait(false);
            }

            if (_disposed)
            {
                return ThrowIfDisposedWhenReleased
                    ? throw new ObjectDisposedException(nameof(FakeWritableDriver), "simulated concurrent teardown (test double)")
                    : new SetpointWriteResult(request.Point, WriteOutcome.Indeterminate, Detail: "observed concurrent dispose (test double, contract-compliant)");
            }

            return new SetpointWriteResult(request.Point, WriteOutcome.Applied);
        }

        public async Task<CommandResult> InvokeCommandAsync(CommandRequest request, CancellationToken ct)
        {
            Interlocked.Increment(ref _commandCallCount);
            _commandStarted.TrySetResult();

            if (BlockOnCommand)
            {
                // See WriteSetpointAsync's own remarks — the caller's `ct` is still deliberately ignored.
                await _commandGate.WaitAsync(_teardown.Token).ConfigureAwait(false);
            }

            if (_disposed)
            {
                return ThrowIfDisposedWhenReleased
                    ? throw new ObjectDisposedException(nameof(FakeWritableDriver), "simulated concurrent teardown (test double)")
                    : new CommandResult(request.Command, WriteOutcome.Indeterminate, Detail: "observed concurrent dispose (test double, contract-compliant)");
            }

            return new CommandResult(request.Command, WriteOutcome.Applied);
        }
    }
}
