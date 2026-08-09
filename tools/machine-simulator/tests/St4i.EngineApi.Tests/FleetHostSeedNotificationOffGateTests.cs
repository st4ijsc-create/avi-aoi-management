using System.Collections.Concurrent;
using System.Diagnostics;
using St4i.Connector.Abstractions.Models;
using St4i.EdgeCore.Infrastructure;
using St4i.EdgeCore.Models;
using St4i.EdgeCore.Transport;
using St4i.EngineApi.AssetRegistry;
using St4i.EngineApi.Fleet;
using Xunit;

namespace St4i.EngineApi.Tests;

/// <summary>
/// 🔴 Task G-1 (.superpowers/sdd/gate-and-log-channel/task-1-brief.md, part 1) — the witness for blueprint
/// §9.2 violation 3, which E-2 recorded and deliberately did not fix because a fix folded into a MOVE makes
/// "behaviour unchanged" untrue.
///
/// <para><b>What the defect was.</b> <c>FleetCore.RegisterMachine</c> invoked its host-supplied
/// <c>onMachineSeeded</c> callback while holding <c>_gate</c> — the same lock <c>Estop()</c> takes.
/// <c>_ = assetRegistry.UpsertAsync(descriptor)</c> reads as fire-and-forget and is not: Microsoft.Data.Sqlite
/// does not override the async ADO.NET members, so a real <c>AssetRegistryStore</c> runs its whole open+insert
/// on the calling thread. Blueprint §9.2 MEASURED a thread merely reading <c>EstopEngaged</c> blocked up to
/// <b>12.35 ms</b> by it.
///
/// <para><b>Why the first test here is a measurement and not a shape check.</b> §8.1's fifth rule: a
/// mitigation must be verified by measuring its effect on the thing it protects, on the production path,
/// with no observer the mechanism does not itself need. What this task protects is a reader of the halt
/// latch, so that is what is timed — not "is the invoke lexically outside the lock", which is the reading
/// that D-7a proved worthless. The registry double blocks SYNCHRONOUSLY (a <c>Thread.Sleep</c>, faithful to
/// the sync-shim behaviour above) for <see cref="SeedCallbackBlockFor"/>; with the fix the
/// <c>EstopEngaged</c> read returns inside <see cref="ReaderBudget"/>, without it the read cannot return
/// until the callback does. The bound is deliberately a wide multiple of the measured 12.35 ms rather than
/// a tight one — this asserts "the lock is not held across the callback at all", which is a structural
/// property, not a latency budget that a slow CI box could shave.
///
/// <para><b>MUTATION-PROVEN, not read.</b> Reverting the fix (invoking <c>_onMachineSeeded</c> inside
/// <c>RegisterMachine</c>'s <c>lock (_gate)</c> again) turns
/// <see cref="WhileASeedCallbackIsRunning_AReaderOfTheHaltLatchIsNotBlocked_Measured"/> RED. It does not
/// hang: the callback's block is bounded, so the mutant fails on the elapsed assertion and the suite
/// completes.
///
/// <para><b>The second test is the other half, and it is the harder half.</b> Moving a call out of a lock
/// is what makes "exactly one notification per seeded machine, in fleet order, never before the machine is
/// registered" breakable. All three are pinned here — deliberately testing what changed, not what was kept.
/// </summary>
public sealed class FleetHostSeedNotificationOffGateTests
{
    /// <summary>How long the fake registry's upsert holds the calling thread for the ONE machine the
    /// measurement registers. Long enough that a lock held across it is unmistakable, short enough that the
    /// mutant fails fast instead of looking like a hang.</summary>
    private static readonly TimeSpan SeedCallbackBlockFor = TimeSpan.FromSeconds(2);

    /// <summary>The budget for a single <c>EstopEngaged</c> read taken while the callback above is running.
    /// A quarter of the block — any value below it says the gate was not held across the callback.</summary>
    private static readonly TimeSpan ReaderBudget = TimeSpan.FromMilliseconds(500);

    private const string BlockingCode = "G1-SEED-BLOCKS-01";

    private static FleetHost CreateHost(IAssetRegistry? assetRegistry)
    {
        var demo = new DemoTransport(latencyMs: 0);
        var live = LiveTransport.ForMachine("http://localhost:1", mkKey: "", machineCode: "TEST", queuePath: null, verifyTls: true);
        var auto = new AutoTransport(live, demo);
        var switchable = new SwitchableTransport(demo);
        var coordinator = new TransportCoordinator(switchable, demo, live, auto, TransportMode.Demo);
        var eventBus = new EventBus();
        return new FleetHost(switchable, coordinator, eventBus, assetRegistry: assetRegistry);
    }

    private static MachineDescriptor NewDescriptor(string code) => new(
        Code: code,
        SerialSeed: $"SN-{code}",
        DeviceClass: DeviceClass.Automation,
        MachineType: "MODBUS_TCP",
        StepType: null,
        DriverKind: DriverKinds.Modbus,
        RecipeCode: null,
        MappingProfile: null,
        CycleSeconds: 1.0);

    /// <summary>Runs <paramref name="work"/> on a DEDICATED thread rather than <see cref="Task.Run"/>.
    ///
    /// <para>🔴 This is not style. The whole point of the measurement below is that the calling thread is
    /// consumed for seconds; on a thread-pool thread that is <b>thread-pool starvation injected into a
    /// 1,300-test suite that xUnit runs classes of in parallel</b> — a side effect of the harness, not of
    /// anything under test, and the kind that surfaces as an unrelated suite's intermittent failure. A
    /// dedicated thread blocks nothing but itself, and the assertion is identical either way.</para></summary>
    private static Thread RunOnItsOwnThread(Action work, string name)
    {
        var thread = new Thread(() => work()) { IsBackground = true, Name = name };
        thread.Start();
        return thread;
    }

    [Fact]
    public void WhileASeedCallbackIsRunning_AReaderOfTheHaltLatchIsNotBlocked_Measured()
    {
        var registry = new BlockingAssetRegistry(BlockingCode, SeedCallbackBlockFor);
        var host = CreateHost(registry);

        // The fleet is deliberately NOT started: this isolates the seed notification from the restart path,
        // so a green result cannot be explained by anything but where the callback runs.
        Assert.False(host.IsRunning);

        var registered = false;
        Exception? registrationFault = null;
        var worker = RunOnItsOwnThread(
            () =>
            {
                try { registered = host.RegisterMachine(NewDescriptor(BlockingCode)); }
                catch (Exception ex) { registrationFault = ex; }
            },
            "g1-seed-register");

        Assert.True(
            registry.CallbackEntered.Wait(TimeSpan.FromSeconds(10)),
            "the seed callback should have been invoked for the registered machine");

        // THE MEASUREMENT. EstopEngaged is a `lock (_gate) return _estopEngaged` getter — the very reader
        // blueprint §9.2 timed at 12.35 ms — and Estop() takes that same lock.
        var stopwatch = Stopwatch.StartNew();
        var latched = host.EstopEngaged;
        stopwatch.Stop();

        Assert.True(worker.Join(TimeSpan.FromSeconds(30)), "the registering thread should have finished");
        Assert.Null(registrationFault);
        Assert.True(
            registered,
            "the registration itself must still succeed — a fast read of a machine that was never registered proves nothing");
        Assert.True(registry.Upserted.Contains(BlockingCode), "the callback must actually have run for this machine");
        Assert.False(latched);

        Assert.True(
            stopwatch.Elapsed < ReaderBudget,
            $"a reader of the HALT latch waited {stopwatch.Elapsed.TotalMilliseconds:F1} ms while a seed " +
            $"callback ran; budget is {ReaderBudget.TotalMilliseconds:F0} ms and the callback blocks for " +
            $"{SeedCallbackBlockFor.TotalMilliseconds:F0} ms — _gate is being held across the callback again");
    }

    [Fact]
    public void SeedNotifications_AreOncePerMachine_InRosterOrder_AndNeverBeforeTheMachineIsInTheRoster()
    {
        var registry = new OrderRecordingAssetRegistry();
        var host = CreateHost(registry);

        // (a) CONSTRUCTOR SEEDING — one notification per roster machine, in fleet order. Asserted against
        //     the host's own roster rather than a hardcoded list, and asserted non-empty so the equality
        //     below cannot pass vacuously on two empty sequences.
        var rosterAtConstruction = host.Fleet.Select(d => d.Code).ToList();
        Assert.NotEmpty(rosterAtConstruction);
        Assert.Equal(rosterAtConstruction, registry.Order);

        // (b) From here on, every upsert also answers "was this machine already in the roster when I was
        //     told about it?" — the invariant that taking the call out of the lock could have inverted.
        registry.RosterProbe = code => host.Fleet.Any(d => string.Equals(d.Code, code, StringComparison.OrdinalIgnoreCase));

        Assert.True(host.RegisterMachine(NewDescriptor("G1-ORDER-A")));
        Assert.True(host.RegisterMachine(NewDescriptor("G1-ORDER-B")));

        // (c) A REFUSED registration owes no notification — the enqueue sits after both failure returns.
        Assert.False(host.RegisterMachine(NewDescriptor("G1-ORDER-A")));

        Assert.Equal(
            rosterAtConstruction.Concat(new[] { "G1-ORDER-A", "G1-ORDER-B" }).ToList(),
            registry.Order);
        Assert.Empty(registry.NotifiedBeforeRegistered);
    }

    /// <summary>🔴 Review I-5 — the property <see cref="FleetCore"/>'s private seed-notify lock exists to
    /// provide, and the one thing record-then-drain could break that the in-lock invocation could not.
    /// Before this test it rested on reading, which is the distinction the whole method section is built on.
    ///
    /// <para>🔴 <b>Which assertion is load-bearing was MEASURED, after a round of this report got it wrong
    /// in both directions.</b> The mutation is <c>lock (_seedNotifyGate)</c> removed from
    /// <c>DrainSeedNotifications</c>; the result, six runs out of six, is
    /// <c>Assert.Equal(1, MaxConcurrentCallbacks)</c> failing with <b>Expected: 1, Actual: 8</b> — all eight
    /// callbacks in flight simultaneously. The overlap assertion is what kills, and it kills deterministically
    /// on this harness. (The prior report claimed the mutant "failed on the ordering assertion"; that was
    /// written from a run whose captured output never named an assertion, and it was wrong. Review then
    /// reasoned CORRECTLY from that wrong premise to the conclusion that overlap must be the weak witness.
    /// One re-run settled it. Neither of us could have got there by reading.)</para>
    ///
    /// <para><b>Both assertions stay, and neither is redundant — they catch different schedules.</b> Review's
    /// mechanism argument is real even though its conclusion was not: with the lock gone, two drainers can
    /// interleave <i>at the dequeue point</i> — T1 dequeues A and is preempted before entering the callback,
    /// T2 dequeues B and completes, then T1 runs A's — which mis-orders delivery with <b>zero</b> overlap.
    /// That schedule is invisible to the high-water mark and visible only to the order assertion. It is not
    /// the schedule this harness produces (the dwell below makes all eight overlap instead), but it is a
    /// schedule the production code permits. So: overlap is what fires here; order covers the case overlap
    /// structurally cannot see. <b>Do not trim either one.</b></para>
    ///
    /// <para>🔴 <b>And a PASSIVE contention witness, because all three assertions above are satisfied by a run
    /// in which the property was never exercised.</b> If the eight threads happen to serialise — each
    /// finishing before the next starts — then the high-water mark is legitimately 1, order is trivially
    /// right, and the test is green having tested nothing. The witness only OBSERVES; it does not force a
    /// schedule. Refusing a <i>synchronising</i> hook is right — a barrier inside the callback would make
    /// this assert an interleaving production never guarantees — but refusing an observation was not, and it
    /// is what let the test degrade silently.</para>
    ///
    /// <para>🔴 <b>The FIRST witness written for this was wrong, and the mutation round is what caught it —
    /// worth recording because it is a trap the shape invites.</b> It asked "was any descriptor delivered by
    /// a thread other than its registrant", which sounds like a question about the schedule and is in fact a
    /// question about <b>what the lock did</b>: a drainer holding the gate picks up other threads' work,
    /// so cross-thread delivery is the lock working. Under the lock-removed mutant every thread drains only
    /// its own descriptor — so that witness fired FIRST and announced "no contention was observed" on a run
    /// that was maximally contended, sending a reader to the harness instead of the lock. <b>A vacuity guard
    /// must be independent of the code under test</b>; this one is now wall-clock overlap of the
    /// <c>RegisterMachine</c> calls, recorded by the test about the test.</para></summary>
    [Fact]
    public void ConcurrentRegistrations_NeverRunTwoSeedCallbacksAtOnce_AndDeliverInRosterOrder()
    {
        const int threads = 8;

        var registry = new OrderRecordingAssetRegistry { CallbackDwell = TimeSpan.FromMilliseconds(15) };
        var host = CreateHost(registry);
        var seededByCtor = registry.Order.Count;

        using var readyToGo = new CountdownEvent(threads);
        using var go = new ManualResetEventSlim(false);
        var faults = new ConcurrentBag<Exception>();

        // Each worker times its OWN RegisterMachine call. Those intervals are the contention witness. See (a)
        // for what they do and do not establish.
        var windows = new (long Start, long End)[threads];
        var workers = Enumerable.Range(0, threads).Select(i => RunOnItsOwnThread(
            () =>
            {
                try
                {
                    readyToGo.Signal();
                    go.Wait(TimeSpan.FromSeconds(10));
                    var start = Stopwatch.GetTimestamp();
                    host.RegisterMachine(NewDescriptor($"G1-RACE-{i:D2}"));
                    windows[i] = (start, Stopwatch.GetTimestamp());
                }
                catch (Exception ex) { faults.Add(ex); }
            },
            $"G1-RACE-{i:D2}")).ToList();

        Assert.True(readyToGo.Wait(TimeSpan.FromSeconds(10)), "every registering thread should have reached the start line");
        go.Set();
        foreach (var w in workers) Assert.True(w.Join(TimeSpan.FromSeconds(60)), "every registering thread should finish");
        Assert.Empty(faults);

        var deliveries = registry.Deliveries.Skip(seededByCtor).ToList();
        var delivered = deliveries.Select(d => d.Code).ToList();

        // (a) THE RUN WAS ACTUALLY CONTENDED — checked FIRST, because every assertion after it is satisfied
        //     by a serialised run in which nothing was ever concurrent.
        //
        //     🔴 It asks whether two RegisterMachine CALLS overlapped in wall-clock time. The first version
        //     of this witness asked instead whether any descriptor was delivered by a non-registrant thread
        //     — a fact about what the LOCK did, not about whether the run was contended: under the
        //     lock-removed mutant every thread drains only its own descriptor, so that witness fired FIRST
        //     and reported "no contention" for a run that was fully contended. A guard that INVERTS under
        //     the mutation it guards is not a guard; it is a second, worse assertion about the product
        //     wearing the guard's name. Delivering threads are still recorded, but only for the diagnostic
        //     in the message below.
        //
        //     🔴 What this guard does and does not establish, stated at the size it actually is (review
        //     NEW-5 — the first wording claimed "nothing the product does can move it", which is stronger
        //     than the mechanism supports):
        //       - MEASURED, and the load-bearing property: it does NOT invert under the mutation it guards.
        //         Re-run against the lock-removed mutant, the witness passes and (b) fires, 5 of 5.
        //       - NOT independent of the product: the window is [before RegisterMachine, after
        //         RegisterMachine], and how long that call holds the calling thread is a product property.
        //         A change that made the call return promptly would narrow every window.
        //       - COARSER than the property it stands in for: it guards "two CALLS overlapped", not "two
        //         DRAINS contended". The direction is the safe one — drain contention implies call overlap,
        //         so no overlap implies certainly no drain contention and the guard fires — so it can never
        //         let a fully serialised run through. But calls can overlap while the drains do not (one
        //         thread still inside lock (_gate) while another drains), so a green witness does not PROVE
        //         the drain was contended. With CallbackDwell inside the drain and eight threads, the gap is
        //         small; it is a caveat, not a defect.
        var overlapping = (
            from i in Enumerable.Range(0, threads)
            from j in Enumerable.Range(i + 1, threads - i - 1)
            where windows[i].Start < windows[j].End && windows[j].Start < windows[i].End
            select 1).Any();
        Assert.True(
            overlapping,
            $"no two RegisterMachine calls overlapped in time, so this run never exercised concurrent " +
            $"registration and (b)-(d) below prove nothing on it. Distinct delivering threads: " +
            $"{deliveries.Select(d => d.ThreadName).Distinct(StringComparer.Ordinal).Count()}.");

        // (b) MUTUAL EXCLUSION — measured to be the assertion that kills the lock-removed mutant
        //     (Expected: 1, Actual: 8, six runs of six). Two host callbacks in flight at once means a
        //     drainer entered while another was mid-callback.
        Assert.Equal(1, registry.MaxConcurrentCallbacks);

        // (c) EXACTLY ONCE — no descriptor delivered twice, none dropped.
        Assert.Equal(threads, delivered.Count);
        Assert.Equal(threads, delivered.Distinct(StringComparer.OrdinalIgnoreCase).Count());

        // (d) ROSTER ORDER — the enqueue happens under _gate, so the queue's FIFO order IS the order the
        //     machines entered _fleet. Asserted against the roster the host itself ended up with, so it
        //     holds whichever way the threads raced. This is the one that catches an interleave at the
        //     DEQUEUE point, which produces zero overlap and is therefore invisible to (b).
        //
        //     🔴 UNPROVEN, and recorded as such (review NEW-3): (d) is DEFENSIVE. No mutation in any round
        //     has ever killed through it — the lock-removed mutant is caught by (b) first, and the schedule
        //     (d) exists for is one this harness does not produce. So (d) has never been demonstrated
        //     capable of failing. It is kept because the schedule is real in production code, not because
        //     it is evidenced; treat it as an unwitnessed assertion, not a proven one. The mutant that
        //     would witness it would have to remove the lock AND move the dwell so the dequeue-point
        //     interleave becomes the produced schedule — not attempted.
        Assert.Equal(host.Fleet.Select(d => d.Code).Skip(seededByCtor).ToList(), delivered);
    }

    /// <summary>🔴 Review I-5 — the path that CHANGED most and had no seed-notification assertion at all:
    /// registering into a RUNNING fleet, where the drain moved past <c>StopLocked</c> +
    /// <c>WaitAndDisposeOldPipeline</c> + <c>StartLocked</c>. Both other tests here deliberately leave the
    /// fleet stopped.</summary>
    [Fact]
    public async Task RegisteringIntoARunningFleet_StillNotifiesExactlyOnce_AfterTheRestart()
    {
        var registry = new OrderRecordingAssetRegistry();
        var host = CreateHost(registry);
        var seededByCtor = registry.Order.Count;

        host.Start();
        try
        {
            var deadline = DateTime.UtcNow + TimeSpan.FromSeconds(10);
            while (!host.IsRunning && DateTime.UtcNow < deadline) await Task.Delay(50);
            Assert.True(host.IsRunning, "the fleet should be running before the registration under test");

            registry.RosterProbe = code => host.Fleet.Any(d => string.Equals(d.Code, code, StringComparison.OrdinalIgnoreCase));
            Assert.True(host.RegisterMachine(NewDescriptor("G1-RUNNING-01")));

            Assert.Equal(new[] { "G1-RUNNING-01" }, registry.Order.Skip(seededByCtor).ToArray());
            Assert.Empty(registry.NotifiedBeforeRegistered);
        }
        finally
        {
            host.Stop();
        }
    }

    /// <summary>🔴 Review I-3 — the regression G-1 introduced and this test is the witness for.
    ///
    /// <para>The descriptor is committed to the roster under <c>_gate</c> and never rolled back, so from
    /// the moment the lock is released the machine EXISTS and owes exactly one notification. G-1 moved the
    /// notification to the end of the method, past the restart — so a throw in the restart left the machine
    /// registered with its notification still sitting in the queue, delivered only if some LATER
    /// <c>RegisterMachine</c> happened to drain it. Pre-G-1 the callback had already run by then, which is
    /// what makes this a regression rather than an inherited gap. The fix is a <c>finally</c>.</para>
    ///
    /// <para>The throw is injected through the pipeline-injection seam because it is deterministic; the
    /// REAL reachable throw is path 5 of the <c>_gate</c> enumeration (<c>MachineConfigStore.Ensure</c>'s
    /// config-kind mismatch, and its <c>File.WriteAllText</c>/<c>File.Move</c> on a full or read-only data
    /// root), which needs a poisoned data root to reproduce and would test the same
    /// statement.</para></summary>
    [Fact]
    public async Task WhenTheRestartThrows_TheSeedNotificationIsStillDelivered_NotStrandedInTheQueue()
    {
        var registry = new OrderRecordingAssetRegistry();
        var host = CreateHost(registry);
        var seededByCtor = registry.Order.Count;

        host.Start();
        try
        {
            var deadline = DateTime.UtcNow + TimeSpan.FromSeconds(10);
            while (!host.IsRunning && DateTime.UtcNow < deadline) await Task.Delay(50);
            Assert.True(host.IsRunning, "the fleet should be running so RegisterMachine takes the restart path");

            // Poison the rebuild: StartLocked invokes this seam, so the restart half of RegisterMachine
            // throws AFTER the roster write has already committed.
            host.AdditionalPipelinesForTests = () => throw new InvalidOperationException("g1: injected restart failure");

            Assert.Throws<InvalidOperationException>(() => host.RegisterMachine(NewDescriptor("G1-STRANDED-01")));

            // The machine is in the roster — the write committed under the lock and is never rolled back.
            Assert.Contains(host.Fleet, d => string.Equals(d.Code, "G1-STRANDED-01", StringComparison.OrdinalIgnoreCase));

            // …so it owes exactly one notification, and it must already have been delivered rather than
            // waiting for some future registration to flush it.
            Assert.Equal(new[] { "G1-STRANDED-01" }, registry.Order.Skip(seededByCtor).ToArray());
        }
        finally
        {
            host.AdditionalPipelinesForTests = null;
            host.Stop();
        }
    }

    /// <summary>Test double that reproduces the ONE property of a real <c>AssetRegistryStore</c> that
    /// matters here and that <c>FakeAssetRegistry</c> (a <c>ConcurrentDictionary</c> returning
    /// <see cref="Task.CompletedTask"/>) cannot: the upsert consumes the CALLING thread. Blueprint §9.2's
    /// own review correction says exactly this — the existing fakes "cannot tell synchronous from
    /// asynchronous apart", which is why a defect measured on a real store had no witness for four batches.
    ///
    /// <para>Blocks only for <paramref name="blockingCode"/>: the constructor seeds the whole demo roster
    /// through this same callback, and blocking there would cost N × the delay for no added evidence.</para>
    /// </summary>
    private sealed class BlockingAssetRegistry : IAssetRegistry
    {
        private readonly string _blockingCode;
        private readonly TimeSpan _blockFor;

        public BlockingAssetRegistry(string blockingCode, TimeSpan blockFor)
        {
            _blockingCode = blockingCode;
            _blockFor = blockFor;
        }

        public ManualResetEventSlim CallbackEntered { get; } = new(false);

        public ConcurrentBag<string> Upserted { get; } = new();

        public Task UpsertAsync(MachineDescriptor descriptor, CancellationToken ct = default)
        {
            Upserted.Add(descriptor.Code);

            if (string.Equals(descriptor.Code, _blockingCode, StringComparison.OrdinalIgnoreCase))
            {
                CallbackEntered.Set();
                Thread.Sleep(_blockFor);
            }

            return Task.CompletedTask;
        }

        public Task<AssetRecord?> GetAsync(string code, CancellationToken ct = default) => Task.FromResult<AssetRecord?>(null);

        public Task<IReadOnlyList<AssetRecord>> ListAsync(CancellationToken ct = default) =>
            Task.FromResult<IReadOnlyList<AssetRecord>>(Array.Empty<AssetRecord>());

        public Task<AssetRecord?> SetLifecycleAsync(string code, AssetLifecycleState state, CancellationToken ct = default) =>
            Task.FromResult<AssetRecord?>(null);
    }

    /// <summary>One delivered notification: which machine, and which thread actually ran the callback.
    ///
    /// <para>🔴 <b><see cref="ThreadName"/> is a DIAGNOSTIC, not the contention guard</b> — it was the guard
    /// for one commit and that framing was measured to be wrong. The worker threads are named for the
    /// machines they register, so <c>ThreadName != Code</c> does soundly imply that two registrations
    /// overlapped; what a guard needs is the CONVERSE, and the converse is false. Under the lock-removed
    /// mutant every thread drains only its own descriptor, so cross-thread delivery goes to zero on a run
    /// where overlap is maximal — cross-thread delivery is a fact about what the lock DID, not about the
    /// schedule. The guard is now wall-clock overlap of the <c>RegisterMachine</c> calls, in the test body;
    /// this field only feeds the "distinct delivering threads" figure in that guard's failure
    /// message.</para></summary>
    private readonly record struct SeedDelivery(string Code, string? ThreadName);

    /// <summary>Records the ORDER and MULTIPLICITY of seed notifications, and — through
    /// <see cref="RosterProbe"/> — whether the roster already contained each machine at the moment it was
    /// announced.</summary>
    private sealed class OrderRecordingAssetRegistry : IAssetRegistry
    {
        private readonly List<SeedDelivery> _deliveries = new();
        private readonly object _gate = new();
        private int _inCallback;
        private int _maxInCallback;

        /// <summary>Set AFTER construction (the host reference does not exist during its own ctor). Null
        /// means "do not probe", which is how the constructor-seeding pass is allowed to run.</summary>
        public Func<string, bool>? RosterProbe { get; set; }

        /// <summary>How long each callback holds its calling thread. Zero (the default) for the
        /// single-threaded tests; non-zero widens the window in which a second drainer would be observed if
        /// the seed-notify lock were removed, which is what makes
        /// <see cref="MaxConcurrentCallbacks"/> a sharp assertion rather than a lucky one.
        ///
        /// <para>🔴 <b>It is load-bearing for the CONTENTION GUARD too, and that is easy to miss because the
        /// guard lives in the test body while this lives here.</b> The guard asserts that two
        /// <c>RegisterMachine</c> calls overlapped in wall-clock time, and this dwell is most of what each
        /// call's window is made of — zero it and the windows collapse to microseconds, at which point the
        /// guard becomes exactly the flaky assertion it was added to avoid being. Do not trim this as
        /// belonging only to <see cref="MaxConcurrentCallbacks"/>.</para></summary>
        public TimeSpan CallbackDwell { get; set; } = TimeSpan.Zero;

        /// <summary>The high-water mark of callbacks in flight simultaneously. MUST be 1: the drain is
        /// serialized, so two host callbacks can never overlap.</summary>
        public int MaxConcurrentCallbacks => Volatile.Read(ref _maxInCallback);

        public List<string> NotifiedBeforeRegistered { get; } = new();

        /// <summary>Every delivery in order, with the thread that ran it. <see cref="Order"/> is the codes
        /// alone, kept because most callers only care about those.</summary>
        public IReadOnlyList<SeedDelivery> Deliveries
        {
            get { lock (_gate) return _deliveries.ToList(); }
        }

        public IReadOnlyList<string> Order
        {
            get { lock (_gate) return _deliveries.Select(d => d.Code).ToList(); }
        }

        public Task UpsertAsync(MachineDescriptor descriptor, CancellationToken ct = default)
        {
            var live = Interlocked.Increment(ref _inCallback);
            int seen;
            while (live > (seen = Volatile.Read(ref _maxInCallback))
                   && Interlocked.CompareExchange(ref _maxInCallback, live, seen) != seen)
            {
                // retry: another thread raised the high-water mark between the read and the exchange
            }

            try
            {
                var probe = RosterProbe;
                var registered = probe is null || probe(descriptor.Code);

                if (CallbackDwell > TimeSpan.Zero) Thread.Sleep(CallbackDwell);

                lock (_gate)
                {
                    _deliveries.Add(new SeedDelivery(descriptor.Code, Thread.CurrentThread.Name));
                    if (!registered) NotifiedBeforeRegistered.Add(descriptor.Code);
                }

                return Task.CompletedTask;
            }
            finally
            {
                Interlocked.Decrement(ref _inCallback);
            }
        }

        public Task<AssetRecord?> GetAsync(string code, CancellationToken ct = default) => Task.FromResult<AssetRecord?>(null);

        public Task<IReadOnlyList<AssetRecord>> ListAsync(CancellationToken ct = default) =>
            Task.FromResult<IReadOnlyList<AssetRecord>>(Array.Empty<AssetRecord>());

        public Task<AssetRecord?> SetLifecycleAsync(string code, AssetLifecycleState state, CancellationToken ct = default) =>
            Task.FromResult<AssetRecord?>(null);
    }
}
