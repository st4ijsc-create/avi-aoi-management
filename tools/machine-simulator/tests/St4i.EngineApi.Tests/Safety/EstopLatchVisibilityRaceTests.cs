using System.Runtime.CompilerServices;
using St4i.Connector.Abstractions;
using St4i.Connector.Abstractions.Models;
using St4i.EdgeCore.Infrastructure;
using St4i.EdgeCore.Mapping;
using St4i.EdgeCore.Models;
using St4i.EdgeCore.Transport;
using St4i.EngineApi.Fleet;
using St4i.EngineApi.Policy;
using St4i.EngineApi.Policy.Rules;
using Xunit;

namespace St4i.EngineApi.Tests.Safety;

/// <summary>
/// 🔴 Task E-2 (docs/plans/2026-08-04-dotE-fleet-core-extraction-blueprint.md §9.3b) — the racing test for
/// the HALT latch's visibility to concurrent readers. <b>Read the two scope notes below before changing
/// anything here; they are the whole reason this file exists as its own suite.</b>
///
/// <para><b>1. WHAT IT GUARDS — a real safety property that had no test at all.</b> The write path is gated
/// entirely by its CALLERS: <c>MachineWriteEndpoints</c> and <c>RelayNotificationChannel</c> each read
/// <see cref="FleetHost.GetSafetyStatus"/> and hand it to <see cref="EstopGuardRule"/> before ever calling
/// <see cref="FleetHost.TryWriteSetpointAsync"/> — nothing inside that method consults the latch (E-1 §5.4).
/// So the property that actually protects an operator is: <b>once <see cref="FleetHost.Estop"/> has
/// returned, EVERY guard evaluation that begins afterwards, on ANY thread, sees the latch engaged and
/// denies.</b> No window, no staleness, no matter how hard the pair is being read concurrently. Before this
/// test, nothing in 2555 tests raced <c>Estop()</c> against anything: every latch test was sequential, so a
/// latch write moved off <c>FleetCore._gate</c>, or an <c>EstopEngaged</c> getter that stopped taking the
/// lock, would have been invisible.</para>
///
/// <para>🔴 <b>2. WHAT IT DOES *NOT* GUARD — and this correction matters more than the test.</b> This test
/// does <b>NOT</b> witness E-2's cut. Blueprint §9.3 claimed splitting <c>GetSafetyStatus</c>'s single lock
/// acquisition into two reads would let a write through a HALT, and instructed E-2 to write a racing test,
/// confirm it kills that mutation, and only then move the member. §9.3b overturned the mechanism with two
/// mutations: the two-read split SURVIVED 1282/1282, and so did replacing <c>IsRunning</c> in the snapshot
/// with a hardcoded <c>true</c>. The enumeration says why — every reader of any
/// <see cref="St4i.EdgeCore.Fleet.SafetySnapshot"/> member in <c>src/</c> is
/// <c>Policy/Rules/EstopGuardRule.cs:47</c>, which reads <c>EstopEngaged</c> and NOTHING else, and
/// <c>Safety/SafetyEndpoints.cs:34</c>, which reads both but only to render <c>GET /v1/safety</c>. A torn
/// pair therefore corrupts a SCREEN, never a write decision. <b>No racing test can kill the two-read
/// mutation, because that mutation does not change anything the guard looks at.</b> This suite is written
/// so that a future reader who tries it does not spend the afternoon deciding whether the test is vacuous or
/// the mutation is harmless — it is the mutation.
///
/// <para><see cref="FleetHost.GetSafetyStatus"/> still moves with the lock, on the corrected grounds: a
/// paired read split across two acquisitions is a latent hazard from the moment ANYONE reads both fields,
/// and <c>SafetyEndpoints</c> already does. That is an argument about the shape of the seam, not about a
/// write getting through today. The separate witness that <c>SafetySnapshot.IsRunning</c> is a live value at
/// all lives in <c>Alarms/RelayNotificationChannelTests.HaltLatched_TheBeaconDoesNotLight_…</c>.</para></para>
///
/// <para>🔴 <b>3. THE RESIDUAL TOCTOU, named rather than asserted away.</b> A write whose guard decision was
/// taken microseconds BEFORE the latch engaged can still land microseconds AFTER it. That gap is between
/// <c>GetSafetyStatus()</c> returning and the driver's write completing, it exists today with one lock
/// acquisition, E-2 does not change it, and no arrangement of locks inside <c>FleetCore</c> could close it —
/// only a write path that re-checks the latch atomically at the device boundary could, which is a design
/// change and not this task's. So this suite asserts on <b>guard evaluations that BEGIN after
/// <c>Estop()</c> returns</b>, which is a property the code genuinely has, rather than on "zero writes land
/// after the latch", which is a property it genuinely does not.</para>
/// </summary>
public sealed class EstopLatchVisibilityRaceTests
{
    private const string MachineCode = "HALT-RACE-01";

    private static FleetHost CreateHost()
    {
        var demo = new DemoTransport(latencyMs: 0);
        var live = LiveTransport.ForMachine("http://localhost:1", mkKey: "", machineCode: "TEST", queuePath: null, verifyTls: true);
        var auto = new AutoTransport(live, demo);
        var switchable = new SwitchableTransport(demo);
        var coordinator = new TransportCoordinator(switchable, demo, live, auto, TransportMode.Demo);
        return new FleetHost(switchable, coordinator, new EventBus());
    }

    private static MachineDescriptor ModbusStyleMachine(string code) => new(
        code, $"SN-{code}", DeviceClass.Automation, "MODBUS_TCP", null,
        DriverKinds.Modbus, null, null, CycleSeconds: 0.5);

    /// <summary>One loop iteration's verdict, recorded so the assertions run on data collected DURING the
    /// race rather than on state sampled after it.</summary>
    private readonly record struct Attempt(bool StartedAfterEstopReturned, bool GuardAllowed, bool LatchSeenByGuard);

    /// <summary>
    /// Latches HALT on one thread while another thread runs the REAL production gate-then-write loop
    /// (<see cref="EstopGuardRule"/> over <see cref="FleetHost.GetSafetyStatus"/>, then
    /// <see cref="FleetHost.TryWriteSetpointAsync"/>) as fast as it can.
    ///
    /// <para>Three assertions, and each one closes a way this test could otherwise pass while proving
    /// nothing: (a) the loop ran a meaningful number of iterations on BOTH sides of the latch, so it cannot
    /// pass by never racing; (b) at least one write actually reached the driver before the latch, so it
    /// cannot pass because the fleet was never writable; (c) NO iteration that began after
    /// <see cref="FleetHost.Estop"/> returned was allowed through — the property itself.</para>
    /// </summary>
    [Fact]
    public async Task Estop_RacedAgainstAContinuousWriteLoop_IsVisibleToEveryGuardEvaluationThatStartsAfterItReturns()
    {
        var host = CreateHost();
        var driver = new CountingWritableDriver();
        var rule = new EstopGuardRule();

        Assert.True(host.RegisterMachine(ModbusStyleMachine(MachineCode)));
        host.AdditionalPipelinesForTests = () => new List<(string Label, IDeviceDriver Driver, MappingProfile Profile)>
        {
            ("modbus", driver, new MappingProfile { Name = "modbus", DeviceClass = "Test" }),
        };
        host.Start();

        var deadline = DateTime.UtcNow.AddSeconds(15);
        while (host.GetMachineDriverAvailability(MachineCode) != MachineDriverAvailability.Writable &&
               DateTime.UtcNow < deadline)
        {
            await Task.Delay(25);
        }

        Assert.Equal(MachineDriverAvailability.Writable, host.GetMachineDriverAvailability(MachineCode));

        var attempts = new List<Attempt>();
        var estopReturned = 0;
        var stopLooping = 0;
        var writesBeforeLatch = 0;

        var loop = Task.Run(async () =>
        {
            while (Volatile.Read(ref stopLooping) == 0)
            {
                // Read the flag FIRST: an iteration counts as "started after Estop() returned" only if the
                // latching thread had already come back before this iteration read the safety snapshot.
                // Sampling it afterwards would let an iteration that genuinely began earlier be misfiled as
                // a violation, which is how a racing test turns flaky and then gets its threshold loosened
                // instead of its logic fixed.
                var startedAfterEstop = Volatile.Read(ref estopReturned) == 1;

                var safety = host.GetSafetyStatus();
                var decision = rule.Evaluate(
                    new PolicyRequest(MachineWriteGate.SetpointAction, "Operator", "tester", safety));
                var allowed = decision is null || decision.IsPermitted;

                lock (attempts) attempts.Add(new Attempt(startedAfterEstop, allowed, safety.EstopEngaged));

                if (allowed)
                {
                    await host.TryWriteSetpointAsync(
                        MachineCode, new SetpointWriteRequest("speed", 1.0), CancellationToken.None)
                        .ConfigureAwait(false);

                    if (!startedAfterEstop) Interlocked.Increment(ref writesBeforeLatch);
                }
            }
        });

        // Let the loop establish itself and land real writes before the latch is touched at all.
        var spinDeadline = DateTime.UtcNow.AddSeconds(10);
        while (Volatile.Read(ref writesBeforeLatch) < 20 && DateTime.UtcNow < spinDeadline)
        {
            await Task.Delay(5);
        }

        host.Estop();
        Volatile.Write(ref estopReturned, 1);

        // Keep racing for a while AFTER the latch so the post-latch sample is not a handful of iterations.
        var postDeadline = DateTime.UtcNow.AddSeconds(2);
        while (DateTime.UtcNow < postDeadline)
        {
            lock (attempts)
            {
                if (attempts.Count(a => a.StartedAfterEstopReturned) >= 200) break;
            }

            await Task.Delay(5);
        }

        Volatile.Write(ref stopLooping, 1);
        await loop;

        host.AdditionalPipelinesForTests = null;

        Attempt[] observed;
        lock (attempts) observed = attempts.ToArray();

        var before = observed.Count(a => !a.StartedAfterEstopReturned);
        var after = observed.Count(a => a.StartedAfterEstopReturned);

        // (a) The race actually happened, on both sides of the latch.
        Assert.True(before >= 20, $"only {before} guard evaluations ran before Estop() — the loop never got going");
        Assert.True(after >= 20, $"only {after} guard evaluations ran after Estop() returned — nothing was raced against the latch");

        // (b) The machinery was genuinely live: writes reached the driver before the latch. Without this,
        // a host that could never write would satisfy (c) trivially.
        Assert.True(driver.WriteCallCount > 0, "no setpoint write ever reached the driver — the fleet was never actually writable");
        Assert.True(Volatile.Read(ref writesBeforeLatch) >= 20, "fewer than 20 writes landed before the latch — the pre-latch sample is too thin to make (c) meaningful");

        // (c) 🔴 THE PROPERTY. Every evaluation that began after Estop() returned saw the latch and denied.
        // A latch write moved outside FleetCore._gate, or an EstopEngaged getter that stopped taking it,
        // shows up here as a non-empty list.
        var leaked = observed.Where(a => a.StartedAfterEstopReturned && a.GuardAllowed).ToArray();
        Assert.True(
            leaked.Length == 0,
            $"{leaked.Length} of {after} guard evaluations that BEGAN after Estop() returned were still " +
            "permitted — the HALT latch is not immediately visible to a concurrent reader. " +
            $"(latch seen engaged by the guard in {observed.Count(a => a.LatchSeenByGuard)} of {observed.Length} evaluations)");

        // (d) The mirror of (c), so (c) cannot pass because the guard denies unconditionally.
        //
        // 🔴 Note carefully what this is NOT, because the obvious form of it is FALSE and this test failed on
        // it first: "every evaluation before the barrier was permitted" does not hold, and it should not.
        // Estop() latches _estopEngaged INSIDE FleetCore._gate and only afterwards unwinds, tears down the
        // pipelines off-lock and returns — so there is a real, wide window in which an iteration that began
        // before `estopReturned` was set already observes the latch. That is the SAFE direction, and it is
        // stronger than the property (c) states: the latch is visible to a concurrent reader well before
        // Estop() gets back to its caller. Writing the naive mirror and then loosening (c) to accommodate it
        // is exactly how this test would have become the thing it is supposed to catch.
        //
        // What must hold is the causal version: no evaluation was ever DENIED without the latch actually
        // being engaged, on either side of the barrier — plus at least one pre-latch evaluation genuinely
        // sailed through, which is what proves the guard is not simply always-deny.
        Assert.DoesNotContain(observed, a => !a.GuardAllowed && !a.LatchSeenByGuard);
        Assert.Contains(observed, a => !a.StartedAfterEstopReturned && a.GuardAllowed);
    }

    /// <summary>A writable driver that only counts — no blocking, no faults. The race under test is between
    /// <see cref="FleetHost.Estop"/> and the GUARD, not between teardown and an in-flight write (that one is
    /// already covered, genuinely concurrently, by
    /// <c>FleetHostMachineDriverResolutionTests.Estop_WhileSetpointWriteBlockedMidFlight_…</c>).</summary>
    private sealed class CountingWritableDriver : IWritableDeviceDriver
    {
        private int _writeCallCount;

        public int WriteCallCount => Volatile.Read(ref _writeCallCount);

        public string Id => "halt-race-counting-driver";

        public string Kind => DriverKinds.Modbus;

        public DriverHealthState Health => DriverHealthState.Connected;

        public IReadOnlyList<string> WritablePoints { get; } = new[] { "speed" };

        public IReadOnlyList<string> Commands { get; } = Array.Empty<string>();

        public async IAsyncEnumerable<DeviceReading> ReadAsync([EnumeratorCancellation] CancellationToken ct)
        {
            await Task.Delay(Timeout.Infinite, ct).ConfigureAwait(false);
            yield break; // unreachable — Task.Delay(Infinite, ct) only ever completes by throwing on cancel
        }

        public ValueTask DisposeAsync() => ValueTask.CompletedTask;

        public Task<SetpointWriteResult> WriteSetpointAsync(SetpointWriteRequest request, CancellationToken ct)
        {
            Interlocked.Increment(ref _writeCallCount);
            return Task.FromResult(new SetpointWriteResult(request.Point, WriteOutcome.Applied));
        }

        public Task<CommandResult> InvokeCommandAsync(CommandRequest request, CancellationToken ct) =>
            Task.FromResult(new CommandResult(request.Command, WriteOutcome.Rejected));
    }
}
