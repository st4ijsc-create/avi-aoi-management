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
/// The disposal-race tests below (<see cref="Estop_WhileSetpointWriteBlockedMidFlight_ReturnsPromptly_AndWriteObservesIndeterminate"/>,
/// <see cref="RegisterMachineRestart_WhileSetpointWriteBlockedMidFlight_WriteObservesIndeterminate_NeverCrashes"/>)
/// use a REAL <see cref="SemaphoreSlim"/> with an initial count of 0 as the blocking primitive: unlike the
/// SQLite-style trap a reviewer proved elsewhere in this repo (async methods that complete INLINE so a bare
/// `await` never actually yields, making a "concurrency test" pass even with the race mechanism deleted),
/// `SemaphoreSlim.WaitAsync()` on an empty semaphore is guaranteed by the BCL to suspend genuinely — it
/// cannot complete synchronously with no one having called `Release()`. Each race test asserts, BEFORE
/// releasing the semaphore, that the in-flight write task is still NOT completed — a fact that could only be
/// observed if the write genuinely suspended while the teardown ran concurrently on a separate
/// <see cref="Task.Run(Action)"/>; if the two ran sequentially instead, that assertion would fail (or, if the
/// dispose path waited on the write instead of tearing down independently, the test would hang and time out —
/// never silently pass).
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
    /// Genuine concurrency, not a sequential approximation: the write task's completion is checked (and
    /// asserted NOT complete) BEFORE the semaphore is released — a fact only observable if the write body
    /// truly suspended on <see cref="SemaphoreSlim.WaitAsync(CancellationToken)"/> while <see cref="FleetHost.Estop"/>
    /// ran on a different thread. A sequential/synchronously-completing stand-in (the exact SQLite-style trap
    /// this repo has shipped before) could not produce this interleaving — it would either finish the write
    /// before Estop() ever ran, or deadlock waiting for a Release() that never comes.
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

        host.Start();
        try
        {
            await WaitUntilAsync(
                () => host.GetMachineDriverAvailability(code) == MachineDriverAvailability.Writable,
                "the injected writable driver's slot to come up");

            var writeTask = Task.Run(() => host.TryWriteSetpointAsync(
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

        host.Start();
        try
        {
            await WaitUntilAsync(
                () => host.GetMachineDriverAvailability(code) == MachineDriverAvailability.Writable,
                "the injected writable driver's slot to come up");

            var writeTask = Task.Run(() => host.TryWriteSetpointAsync(
                code, new SetpointWriteRequest("speed", 7.0), CancellationToken.None));

            await WaitUntilAsync(() => fakeDriver.WriteStarted, "the fake driver's WriteSetpointAsync to actually begin executing");

            // RegisterMachine with a brand-new code triggers StopLocked -> WaitAndDisposeOldPipeline ->
            // StartLocked on the CURRENT roster (including fakeDriver's slot, rebuilt fresh) while the write
            // above is still blocked against the OLD fakeDriver instance.
            var restartStopwatch = Stopwatch.StartNew();
            Assert.True(host.RegisterMachine(NewFastSimulatedMachine("WRITE-RACE-RESTART-BYSTANDER-01")));
            restartStopwatch.Stop();

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
        private readonly TaskCompletionSource _writeStarted = new(TaskCreationOptions.RunContinuationsAsynchronously);
        private readonly TaskCompletionSource _disposeStarted = new(TaskCreationOptions.RunContinuationsAsynchronously);
        private volatile bool _disposed;
        private int _writeCallCount;
        private int _commandCallCount;

        /// <summary>When true, <see cref="WriteSetpointAsync"/> suspends on <see cref="_writeGate"/> until
        /// <see cref="ReleaseWrite"/> is called — the mid-flight blocking point the race tests exploit.</summary>
        public bool BlockOnWrite { get; init; }

        /// <summary>When the write resumes and observes <see cref="_disposed"/> is true: <see langword="true"/>
        /// throws <see cref="ObjectDisposedException"/> (misbehaving relative to <c>IWritableDeviceDriver</c>'s
        /// own contract, on purpose — exercises <see cref="FleetHost.TryWriteSetpointAsync"/>'s defensive
        /// catch); <see langword="false"/> returns <see cref="WriteOutcome.Indeterminate"/> itself (the
        /// contract-compliant path).</summary>
        public bool ThrowIfDisposedWhenReleased { get; init; }

        public bool WriteStarted => _writeStarted.Task.IsCompleted;

        public Task DisposeStartedTask => _disposeStarted.Task;

        public int WriteCallCount => Volatile.Read(ref _writeCallCount);

        public int CommandCallCount => Volatile.Read(ref _commandCallCount);

        public SetpointWriteRequest? LastRequest { get; private set; }

        public void ReleaseWrite() => _writeGate.Release();

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
                await _writeGate.WaitAsync(CancellationToken.None).ConfigureAwait(false);
            }

            if (_disposed)
            {
                return ThrowIfDisposedWhenReleased
                    ? throw new ObjectDisposedException(nameof(FakeWritableDriver), "simulated concurrent teardown (test double)")
                    : new SetpointWriteResult(request.Point, WriteOutcome.Indeterminate, Detail: "observed concurrent dispose (test double, contract-compliant)");
            }

            return new SetpointWriteResult(request.Point, WriteOutcome.Applied);
        }

        public Task<CommandResult> InvokeCommandAsync(CommandRequest request, CancellationToken ct)
        {
            Interlocked.Increment(ref _commandCallCount);
            return Task.FromResult(new CommandResult(request.Command, WriteOutcome.Applied));
        }
    }
}
