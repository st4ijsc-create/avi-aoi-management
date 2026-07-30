using System.Collections.Concurrent;
using System.Diagnostics;
using St4i.EngineApi.Alarms;
using Xunit;

namespace St4i.EngineApi.Tests.Alarms;

/// <summary>
/// Task C-1 — <see cref="AlarmNotifier"/> and its <see cref="AlarmStore"/> integration: edge detection
/// (the storm), the four transition sites, escalation, the restart path, never-throws, non-blocking
/// enqueue, and drop accounting.
///
/// Most tests drive a REAL <see cref="AlarmStore"/> against a throwaway temp directory rather than a fake,
/// for the same reason <c>AlarmEvaluatorTests</c> does: the thing under test is precisely whether the
/// store's own upsert/delete semantics are being read correctly, which a fake would define away.
/// <see cref="AlarmNotifier.DisposeAsync"/> drains the channel to completion, so "do the work, dispose,
/// then assert" is the deterministic observation point throughout — no sleeping on a background loop.
/// </summary>
public sealed class AlarmNotifierTests : IDisposable
{
    private readonly List<string> _tempDirs = new();

    public void Dispose()
    {
        foreach (var dir in _tempDirs)
        {
            try { Directory.Delete(dir, recursive: true); } catch { /* best-effort cleanup */ }
        }
    }

    private string NewTempDir()
    {
        var dir = Directory.CreateTempSubdirectory("st4i-alarm-notifier-tests-").FullName;
        _tempDirs.Add(dir);
        return dir;
    }

    /// <summary>A collecting dispatch delegate plus the queue it fills — the stand-in for C-3..C-6.</summary>
    private static (Func<NotificationJob, CancellationToken, Task> Dispatch, ConcurrentQueue<NotificationJob> Jobs) Collector()
    {
        var jobs = new ConcurrentQueue<NotificationJob>();
        return ((job, _) => { jobs.Enqueue(job); return Task.CompletedTask; }, jobs);
    }

    private static AlarmRaise DriverDown(string slot = "slot-1", AlarmPriority priority = AlarmPriority.Critical) =>
        new(AlarmSource.DriverHealth, "DOWN", priority, $"Driver '{slot}' is DOWN.", TargetId: slot, ClearOnAck: false);

    private static Alarm MakeAlarm(string key, AlarmPriority priority = AlarmPriority.High, AlarmState state = AlarmState.Active) =>
        new(1, key, AlarmSource.DriverHealth, "DOWN", priority, state, "synthetic", null, key, false, 1,
            DateTimeOffset.UtcNow, DateTimeOffset.UtcNow, null, null);

    // ─────────────────────────────────────────────────────────────────────
    // 1. 🔴 THE STORM TEST — the one this whole batch exists for.
    // ─────────────────────────────────────────────────────────────────────

    /// <summary>
    /// Reproduces the REAL <see cref="AlarmSource.DriverHealth"/> pattern: <see cref="AlarmEvaluator"/>
    /// calls <see cref="IAlarmStore.RaiseAsync"/> unconditionally on every 5s tick for as long as the
    /// driver stays down. 240 ticks is twenty minutes of a single unchanged alarm; a full hour is 720,
    /// which is the "720 emails an hour" number in the brief.
    ///
    /// <para>Deliberately guarded against being VACUOUS — two vacuous tests have shipped in this project
    /// before. It is not enough to assert "one notification": a test that asserted that would also pass if
    /// the notifier were never called at all, or if the store silently stopped writing. So it additionally
    /// pins (a) that every one of the 240 raises really reached the database (<see cref="Alarm.Count"/>),
    /// (b) that the store reported exactly one <see cref="AlarmTransitionKind.Raised"/> and 239
    /// <see cref="AlarmTransitionKind.ReRaised"/>, and (c) that the detector counted 239 SUPPRESSIONS —
    /// which is zero in every degenerate world, and 239 only if the suppression branch actually
    /// ran.</para>
    /// </summary>
    [Fact]
    public async Task Storm_TheSameAlarmRaisedOnEveryTick_NotifiesExactlyOnce()
    {
        const int Ticks = 240; // 20 minutes at AlarmThresholds.EvalIntervalMs (5s).

        var (dispatch, jobs) = Collector();
        var notifier = new AlarmNotifier(dispatch);
        var store = new AlarmStore(NewTempDir(), notifier: notifier);

        var kinds = new List<AlarmTransitionKind>(Ticks);
        for (var tick = 0; tick < Ticks; tick++)
        {
            kinds.Add((await store.RaiseAsync(DriverDown())).Kind);
        }

        var stats = notifier.Stats;
        await notifier.DisposeAsync();

        // (a) The alarm really was written 240 times — the test is exercising the real storm.
        var active = Assert.Single(await store.ListActiveAsync());
        Assert.Equal(Ticks, active.Count);

        // (b) The store reported the truth about each write.
        Assert.Equal(AlarmTransitionKind.Raised, kinds[0]);
        Assert.All(kinds.Skip(1), k => Assert.Equal(AlarmTransitionKind.ReRaised, k));

        // (c) The detector suppressed 239 of them — zero in any vacuous variant of this test.
        Assert.Equal(Ticks - 1, stats.Suppressed);
        Assert.Equal(1, stats.Enqueued);
        Assert.Equal(0, stats.Dropped);

        // ...and exactly ONE notification reached the channel.
        var job = Assert.Single(jobs);
        Assert.Equal(AlarmEdgeKind.Raised, job.Edge);
        Assert.Equal("DriverHealth:DOWN:slot-1", job.Alarm.Key);
    }

    /// <summary>240 history rows are still written (this task does NOT change the pre-existing re-raise
    /// shape — it only stops those re-raises reaching a human), so the storm test above cannot be passing
    /// because something quietly stopped the evaluator's writes.</summary>
    [Fact]
    public async Task Storm_StillRecordsEveryRaiseInHistory_TheSuppressionIsOnlyAboutNotifications()
    {
        const int Ticks = 25;

        var (dispatch, jobs) = Collector();
        var notifier = new AlarmNotifier(dispatch);
        var store = new AlarmStore(NewTempDir(), notifier: notifier);

        for (var tick = 0; tick < Ticks; tick++) await store.RaiseAsync(DriverDown());
        await notifier.DisposeAsync();

        var history = await store.QueryHistoryAsync(new AlarmHistoryFilter(null, null, null, null, 1000, 0));
        Assert.Equal(Ticks, history.Total);
        Assert.Single(jobs);
    }

    // ─────────────────────────────────────────────────────────────────────
    // 2. The four transition sites — which are edges.
    // ─────────────────────────────────────────────────────────────────────

    [Fact]
    public async Task Clear_AfterAGenuineRaise_Notifies_ButAClearWithNothingActiveDoesNot()
    {
        var (dispatch, jobs) = Collector();
        var notifier = new AlarmNotifier(dispatch);
        var store = new AlarmStore(NewTempDir(), notifier: notifier);

        var raise = DriverDown();

        // A clear BEFORE anything was raised: a no-op in the store, and not news.
        Assert.Equal(AlarmTransitionKind.None, (await store.ClearAsync(raise.Key)).Kind);

        await store.RaiseAsync(raise);
        Assert.Equal(AlarmTransitionKind.Cleared, (await store.ClearAsync(raise.Key)).Kind);

        // A SECOND clear of the same key — the evaluator does exactly this on every tick for every
        // healthy slot, forever. Nothing was removed, so nothing is announced.
        Assert.Equal(AlarmTransitionKind.None, (await store.ClearAsync(raise.Key)).Kind);
        Assert.Equal(AlarmTransitionKind.None, (await store.ClearAsync(raise.Key)).Kind);

        await notifier.DisposeAsync();

        Assert.Collection(
            jobs,
            j => Assert.Equal(AlarmEdgeKind.Raised, j.Edge),
            j =>
            {
                Assert.Equal(AlarmEdgeKind.Cleared, j.Edge);
                // The channel is handed the alarm as it stood at removal, already marked Cleared — no
                // channel should have to re-query (or guess) what state it is describing.
                Assert.Equal(AlarmState.Cleared, j.Alarm.State);
                Assert.Null(j.Actor); // an evaluator clear is system-originated
            });
    }

    /// <summary>A cleared key re-arms: raising it again is a genuine new edge, not a suppressed
    /// re-raise.</summary>
    [Fact]
    public async Task Raise_Clear_Raise_IsTwoRaisedEdgesAndOneClearedEdge()
    {
        var (dispatch, jobs) = Collector();
        var notifier = new AlarmNotifier(dispatch);
        var store = new AlarmStore(NewTempDir(), notifier: notifier);

        var raise = DriverDown();
        await store.RaiseAsync(raise);
        await store.RaiseAsync(raise);
        await store.ClearAsync(raise.Key);
        await store.RaiseAsync(raise);
        await store.RaiseAsync(raise);

        await notifier.DisposeAsync();

        Assert.Equal(
            new[] { AlarmEdgeKind.Raised, AlarmEdgeKind.Cleared, AlarmEdgeKind.Raised },
            jobs.Select(j => j.Edge).ToArray());
    }

    /// <summary>AckAsync branch 1 — a ClearOnAck=true EVENT alarm (every Policy denial). The ack IS the
    /// resolution and is the ONLY way such an alarm ever leaves active_alarms, so it must be a Cleared
    /// edge: were it not, a relay lit by a Policy alarm would stay latched forever after an operator
    /// acknowledged it.</summary>
    [Fact]
    public async Task Ack_OfAnEventAlarm_NotifiesCleared_CarryingTheOperator()
    {
        var (dispatch, jobs) = Collector();
        var notifier = new AlarmNotifier(dispatch);
        var store = new AlarmStore(NewTempDir(), notifier: notifier);

        await store.RaiseAsync(new AlarmRaise(
            AlarmSource.Policy, "SAFETY_BLOCKED", AlarmPriority.Critical, "E-STOP is engaged.",
            TargetId: "fleet.start", ClearOnAck: true));
        var id = (await store.ListActiveAsync()).Single().Id;

        var acked = await store.AckAsync(id, "operator-1");
        Assert.NotNull(acked);
        Assert.Equal(AlarmState.Cleared, acked!.State);
        Assert.Empty(await store.ListActiveAsync());

        await notifier.DisposeAsync();

        Assert.Collection(
            jobs,
            j => Assert.Equal(AlarmEdgeKind.Raised, j.Edge),
            j =>
            {
                Assert.Equal(AlarmEdgeKind.Cleared, j.Edge);
                Assert.Equal("operator-1", j.Actor);
            });
    }

    /// <summary>AckAsync branch 2 — a ClearOnAck=false CONDITION alarm. The row stays live; the edge is
    /// ISA-18.2's "silence the horn", and it fires exactly ONCE even though AckAsync will happily re-ack
    /// an already-Acked alarm (and does, appending another history row each time).</summary>
    [Fact]
    public async Task Ack_OfAConditionAlarm_NotifiesAckedOnce_AndARepeatAckIsSilent()
    {
        var (dispatch, jobs) = Collector();
        var notifier = new AlarmNotifier(dispatch);
        var store = new AlarmStore(NewTempDir(), notifier: notifier);

        await store.RaiseAsync(DriverDown());
        var id = (await store.ListActiveAsync()).Single().Id;

        await store.AckAsync(id, "operator-1");
        await store.AckAsync(id, "operator-2"); // repeat ack — a real, reachable request-path call
        await store.AckAsync(id, "operator-3");

        // Still live, just acknowledged: only the evaluator's ClearAsync ever removes a CONDITION alarm.
        Assert.Equal(AlarmState.Acked, (await store.ListActiveAsync()).Single().State);

        var stats = notifier.Stats;
        await notifier.DisposeAsync();

        Assert.Collection(
            jobs,
            j => Assert.Equal(AlarmEdgeKind.Raised, j.Edge),
            j =>
            {
                Assert.Equal(AlarmEdgeKind.Acked, j.Edge);
                Assert.Equal("operator-1", j.Actor);
                Assert.Equal(AlarmState.Acked, j.Alarm.State);
            });
        Assert.Equal(2, stats.Suppressed); // the two repeat acks
    }

    /// <summary>A re-raise of an already-ACKED condition alarm (the evaluator keeps ticking after an
    /// operator acknowledges) must stay silent — otherwise acking an alarm would turn the storm back
    /// on.</summary>
    [Fact]
    public async Task ReRaise_OfAnAckedConditionAlarm_StaysSilent()
    {
        var (dispatch, jobs) = Collector();
        var notifier = new AlarmNotifier(dispatch);
        var store = new AlarmStore(NewTempDir(), notifier: notifier);

        await store.RaiseAsync(DriverDown());
        var id = (await store.ListActiveAsync()).Single().Id;
        await store.AckAsync(id, "operator-1");

        for (var tick = 0; tick < 20; tick++) await store.RaiseAsync(DriverDown());

        await notifier.DisposeAsync();
        Assert.Equal(new[] { AlarmEdgeKind.Raised, AlarmEdgeKind.Acked }, jobs.Select(j => j.Edge).ToArray());
    }

    // ─────────────────────────────────────────────────────────────────────
    // 3. The severity-change decision.
    // ─────────────────────────────────────────────────────────────────────

    /// <summary>Escalation on a stable key IS an edge (High -> Critical is materially new: Critical is
    /// what feeds the hold gate and, later, C-6's relay). De-escalation is NOT, and the recorded priority
    /// is a high-water mark — so a source flapping between two priorities on one key cannot re-create the
    /// 720/hour storm through the escalation door.</summary>
    [Fact]
    public async Task Escalation_IsAnEdge_DeEscalationIsSilent_AndAFlapCannotStorm()
    {
        var (dispatch, jobs) = Collector();
        var notifier = new AlarmNotifier(dispatch);
        var store = new AlarmStore(NewTempDir(), notifier: notifier);

        await store.RaiseAsync(DriverDown(priority: AlarmPriority.High));      // Raised(High)
        await store.RaiseAsync(DriverDown(priority: AlarmPriority.Critical));  // Escalated High -> Critical

        // Flap: 20 ticks alternating back and forth on the SAME key. None of them is news — Critical has
        // already been announced and nobody needs waking because it briefly looked better.
        for (var i = 0; i < 10; i++)
        {
            await store.RaiseAsync(DriverDown(priority: AlarmPriority.High));
            await store.RaiseAsync(DriverDown(priority: AlarmPriority.Critical));
        }

        await notifier.DisposeAsync();

        Assert.Collection(
            jobs,
            j =>
            {
                Assert.Equal(AlarmEdgeKind.Raised, j.Edge);
                Assert.Equal(AlarmPriority.High, j.Alarm.Priority);
                Assert.Null(j.PreviousPriority);
            },
            j =>
            {
                Assert.Equal(AlarmEdgeKind.Escalated, j.Edge);
                Assert.Equal(AlarmPriority.Critical, j.Alarm.Priority);
                Assert.Equal(AlarmPriority.High, j.PreviousPriority);
            });
    }

    /// <summary>The bound the argument rests on: severity can ratchet up at most three times per
    /// raise-run, and a clear re-arms it.</summary>
    [Fact]
    public async Task Escalation_IsBoundedToThreeEdgesPerRaiseRun_AndAClearReArmsIt()
    {
        var (dispatch, jobs) = Collector();
        var notifier = new AlarmNotifier(dispatch);
        var store = new AlarmStore(NewTempDir(), notifier: notifier);

        var key = DriverDown().Key;
        foreach (var p in new[] { AlarmPriority.Low, AlarmPriority.Medium, AlarmPriority.High, AlarmPriority.Critical })
        {
            await store.RaiseAsync(DriverDown(priority: p));
        }

        await store.ClearAsync(key);
        await store.RaiseAsync(DriverDown(priority: AlarmPriority.Low)); // re-armed: a fresh Raised, not an edge-less Low

        await notifier.DisposeAsync();

        Assert.Equal(
            new[]
            {
                AlarmEdgeKind.Raised, AlarmEdgeKind.Escalated, AlarmEdgeKind.Escalated, AlarmEdgeKind.Escalated,
                AlarmEdgeKind.Cleared, AlarmEdgeKind.Raised,
            },
            jobs.Select(j => j.Edge).ToArray());
    }

    // ─────────────────────────────────────────────────────────────────────
    // 4. The restart path.
    // ─────────────────────────────────────────────────────────────────────

    /// <summary>The process restarts with rows still in <c>active_alarms</c>. The new notifier adopts them
    /// (one <see cref="AlarmEdgeKind.Restored"/> each — NOT a fresh <see cref="AlarmEdgeKind.Raised"/>),
    /// their continuing re-raises stay silent, and their eventual clear is still a correct edge.</summary>
    [Fact]
    public async Task Restart_AdoptsStillActiveAlarms_AsRestored_ThenSuppressesTheirReRaises()
    {
        var dir = NewTempDir();

        // ── Process 1: two alarms go active and are announced.
        var (dispatch1, jobs1) = Collector();
        var notifier1 = new AlarmNotifier(dispatch1);
        var store1 = new AlarmStore(dir, notifier: notifier1);
        await store1.RaiseAsync(DriverDown("slot-1"));
        await store1.RaiseAsync(DriverDown("slot-2"));
        await notifier1.DisposeAsync();
        Assert.Equal(2, jobs1.Count);
        Assert.All(jobs1, j => Assert.Equal(AlarmEdgeKind.Raised, j.Edge));

        // ── Process 2: fresh, empty edge memory; the DB still holds both alarms.
        var (dispatch2, jobs2) = Collector();
        var notifier2 = new AlarmNotifier(dispatch2);
        var store2 = new AlarmStore(dir, notifier: notifier2);
        await new AlarmNotifierSeedService(store2, notifier2).StartAsync(CancellationToken.None);

        // The evaluator keeps ticking on both still-true conditions...
        for (var tick = 0; tick < 30; tick++)
        {
            await store2.RaiseAsync(DriverDown("slot-1"));
            await store2.RaiseAsync(DriverDown("slot-2"));
        }
        // ...and one of them finally recovers.
        await store2.ClearAsync(DriverDown("slot-1").Key);

        var stats = notifier2.Stats;
        await notifier2.DisposeAsync();

        Assert.Equal(
            new[] { AlarmEdgeKind.Restored, AlarmEdgeKind.Restored, AlarmEdgeKind.Cleared },
            jobs2.Select(j => j.Edge).ToArray());
        Assert.Equal(60, stats.Suppressed); // every single post-restart re-raise
        Assert.Equal(2, stats.Seeded);      // observable after the fact, not just in a log line
    }

    /// <summary>Seeding is idempotent (a second call cannot double-announce) and its effect is visible on
    /// <see cref="AlarmNotifier.Stats"/> — the brief's "an operator must be able to find out what the
    /// system did".</summary>
    [Fact]
    public async Task Restart_SeedingIsIdempotent_AndIsObservableOnStats()
    {
        var dir = NewTempDir();
        var seedStore = new AlarmStore(dir);
        await seedStore.RaiseAsync(DriverDown("slot-1"));
        await seedStore.RaiseAsync(DriverDown("slot-2"));
        await seedStore.RaiseAsync(DriverDown("slot-3"));

        var (dispatch, jobs) = Collector();
        var notifier = new AlarmNotifier(dispatch);
        var active = await seedStore.ListActiveAsync();

        notifier.SeedFromActive(active);
        notifier.SeedFromActive(active);
        notifier.SeedFromActive(active);

        var stats = notifier.Stats;
        await notifier.DisposeAsync();

        Assert.Equal(3, jobs.Count);
        Assert.All(jobs, j => Assert.Equal(AlarmEdgeKind.Restored, j.Edge));
        Assert.Equal(3, stats.Seeded);
        Assert.Equal(3, stats.TrackedKeys);
    }

    /// <summary>Nothing standing at start means nothing announced — a restart of a healthy line is
    /// completely silent.</summary>
    [Fact]
    public async Task Restart_WithNothingActive_AnnouncesNothing()
    {
        var (dispatch, jobs) = Collector();
        var notifier = new AlarmNotifier(dispatch);
        var store = new AlarmStore(NewTempDir(), notifier: notifier);
        await new AlarmNotifierSeedService(store, notifier).StartAsync(CancellationToken.None);

        var stats = notifier.Stats;
        await notifier.DisposeAsync();

        Assert.Empty(jobs);
        Assert.Equal(0, stats.Seeded);
        Assert.Equal(0, stats.Enqueued);
    }

    /// <summary>The seeding service must never take the host down — the generic host stops the ENTIRE
    /// process on an exception escaping StartAsync.</summary>
    [Fact]
    public async Task Restart_SeedServiceNeverThrows_EvenWhenTheStoreDoes()
    {
        var notifier = new AlarmNotifier();
        var service = new AlarmNotifierSeedService(new ThrowingListStore(), notifier);

        await service.StartAsync(CancellationToken.None); // must not throw
        await service.StopAsync(CancellationToken.None);
        await notifier.DisposeAsync();
    }

    // ─────────────────────────────────────────────────────────────────────
    // 5. Never-throws is load-bearing.
    // ─────────────────────────────────────────────────────────────────────

    /// <summary>🔴 A notifier that throws on EVERY call must not break
    /// <see cref="IAlarmStore.RaiseAsync"/>/<see cref="IAlarmStore.ClearAsync"/>'s documented never-throws
    /// contract, and — the part that actually matters — must not stop the alarm being RECORDED. An alarm
    /// has to be written even when everything else is failing.</summary>
    [Fact]
    public async Task NeverThrows_AHostileNotifierBreaksNeitherRaiseNorClear_AndTheAlarmIsStillRecorded()
    {
        var logged = new List<string>();
        var store = new AlarmStore(
            NewTempDir(),
            logError: (_, msg) => logged.Add(msg),
            notifier: new ThrowingNotifier());

        var raise = DriverDown();

        var raised = await store.RaiseAsync(raise); // must not throw
        Assert.Equal(AlarmTransitionKind.Raised, raised.Kind);
        var active = Assert.Single(await store.ListActiveAsync());
        Assert.Equal(raise.Key, active.Key);

        var cleared = await store.ClearAsync(raise.Key); // must not throw
        Assert.Equal(AlarmTransitionKind.Cleared, cleared.Kind);
        Assert.Empty(await store.ListActiveAsync());

        // The failure is REPORTED, and reported honestly: the store must not tell an operator the alarm
        // was lost when only its notification was.
        Assert.Equal(2, logged.Count);
        Assert.All(logged, msg =>
        {
            Assert.Contains("notification hook threw", msg, StringComparison.Ordinal);
            Assert.Contains("WAS recorded", msg, StringComparison.Ordinal);
            Assert.DoesNotContain("was not recorded", msg, StringComparison.Ordinal);
        });
    }

    /// <summary>AckAsync is deliberately NOT a never-throws member (it is an ordinary request-path call
    /// allowed to surface a 500) — but the notification hook must not become a NEW reason for it to
    /// throw, on either branch.</summary>
    [Fact]
    public async Task NeverThrows_AHostileNotifierBreaksNeitherAckBranch()
    {
        var store = new AlarmStore(NewTempDir(), notifier: new ThrowingNotifier());

        await store.RaiseAsync(new AlarmRaise(
            AlarmSource.Policy, "SAFETY_BLOCKED", AlarmPriority.Critical, "m", TargetId: "t", ClearOnAck: true));
        await store.RaiseAsync(DriverDown());

        foreach (var alarm in await store.ListActiveAsync())
        {
            var result = await store.AckAsync(alarm.Id, "operator-1"); // must not throw on either branch
            Assert.NotNull(result);
        }

        // The ClearOnAck=false alarm is still live and Acked; the ClearOnAck=true one is gone.
        var remaining = Assert.Single(await store.ListActiveAsync());
        Assert.Equal(AlarmState.Acked, remaining.State);
    }

    /// <summary>A dispatch delegate that throws is counted, not swallowed silently, and does not kill the
    /// drain loop — the job AFTER the failure is still delivered.</summary>
    [Fact]
    public async Task ADispatchDelegateThatThrows_IsCounted_AndTheLoopKeepsGoing()
    {
        var delivered = new ConcurrentQueue<string>();
        var errors = new List<string>();
        var notifier = new AlarmNotifier(
            dispatch: (job, _) => job.Alarm.Key.Contains("bad", StringComparison.Ordinal)
                ? throw new InvalidOperationException("dispatch blew up (test double)")
                : Task.Run(() => delivered.Enqueue(job.Alarm.Key)),
            logError: (_, msg) => { lock (errors) errors.Add(msg); });

        notifier.Notify(new AlarmTransition(AlarmTransitionKind.Raised, MakeAlarm("good-1")));
        notifier.Notify(new AlarmTransition(AlarmTransitionKind.Raised, MakeAlarm("bad-1")));
        notifier.Notify(new AlarmTransition(AlarmTransitionKind.Raised, MakeAlarm("good-2")));

        await notifier.DisposeAsync();
        var stats = notifier.Stats;

        Assert.Equal(new[] { "good-1", "good-2" }, delivered.OrderBy(k => k, StringComparer.Ordinal).ToArray());
        Assert.Equal(1, stats.DispatchFailures);
        Assert.Equal(2, stats.Dispatched);
        Assert.Single(errors);
    }

    // ─────────────────────────────────────────────────────────────────────
    // 6. Non-blocking enqueue.
    // ─────────────────────────────────────────────────────────────────────

    /// <summary>🔴 <see cref="IAlarmNotifier.Notify"/> sits on the request path of every policy denial. A
    /// wedged channel must not slow it down. 30,000 enqueues against a drain loop that is parked inside a
    /// dispatch delegate that never returns — three times the channel capacity, so two thirds of them also
    /// take the drop-oldest eviction path — must still complete in well under a second. A blocking
    /// implementation would simply never finish.</summary>
    [Fact]
    public async Task Enqueue_IsNonBlocking_EvenWithAStalledDrainLoopAndAnOverflowingChannel()
    {
        var release = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
        var notifier = new AlarmNotifier(dispatch: async (_, _) => await release.Task);

        const int Enqueues = 30_000; // 3x DefaultCapacity
        var sw = Stopwatch.StartNew();
        for (var i = 0; i < Enqueues; i++)
        {
            notifier.Notify(new AlarmTransition(AlarmTransitionKind.Raised, MakeAlarm($"key-{i}")));
        }
        sw.Stop();

        release.TrySetResult();
        await notifier.DisposeAsync();

        Assert.Equal(Enqueues, notifier.Stats.Enqueued);
        Assert.True(
            sw.ElapsedMilliseconds < 2_000,
            $"Notify must be non-blocking: {Enqueues} enqueues against a stalled drain loop took {sw.ElapsedMilliseconds} ms.");
    }

    /// <summary>The same guarantee one layer up: a stalled notification channel must not be able to hang
    /// <see cref="IAlarmStore.RaiseAsync"/>. Capacity 1 so the channel is saturated almost immediately.</summary>
    [Fact]
    public async Task RaiseAsync_StillCompletes_WhenTheDrainLoopIsStalledAndTheChannelIsFull()
    {
        var release = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
        var notifier = new AlarmNotifier(dispatch: async (_, _) => await release.Task, capacity: 1);
        var store = new AlarmStore(NewTempDir(), notifier: notifier);

        using var cts = new CancellationTokenSource(TimeSpan.FromSeconds(30));
        for (var i = 0; i < 60; i++)
        {
            var transition = await store.RaiseAsync(DriverDown($"slot-{i}"), cts.Token);
            Assert.Equal(AlarmTransitionKind.Raised, transition.Kind);
        }

        Assert.Equal(60, (await store.ListActiveAsync()).Count);

        release.TrySetResult();
        await notifier.DisposeAsync();
    }

    // ─────────────────────────────────────────────────────────────────────
    // 7. Drop accounting — every loss path counted, including the silent one.
    // ─────────────────────────────────────────────────────────────────────

    /// <summary>🔴 A <see cref="System.Threading.Channels.BoundedChannelFullMode.DropOldest"/> channel
    /// evicts the OLDEST item while <c>TryWrite</c> still returns <see langword="true"/>, so the obvious
    /// <c>if (!TryWrite(...))</c> check never fires on saturation — a prior finding in this repository was
    /// exactly a drop counter that missed a drop path. This pins the eviction count EXACTLY, and pins that
    /// it is the oldest jobs that were lost.
    ///
    /// <para>Deterministic, not timing-based: the drain loop is first parked inside the dispatch delegate
    /// (which signals on entry) so it is guaranteed not to consume anything else while the channel is
    /// filled and overfilled.</para></summary>
    [Fact]
    public async Task Overflow_DropsOldest_AndEveryEvictionIsCounted()
    {
        const int Capacity = 8;
        const int Extra = 5;

        var entered = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
        var release = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
        var delivered = new ConcurrentQueue<NotificationJob>();

        var notifier = new AlarmNotifier(
            dispatch: async (job, _) =>
            {
                delivered.Enqueue(job);
                entered.TrySetResult();
                await release.Task;
            },
            capacity: Capacity);

        // Park the reader inside dispatch (job seq 1), so the channel below is genuinely untouched.
        notifier.Notify(new AlarmTransition(AlarmTransitionKind.Raised, MakeAlarm("prime")));
        await entered.Task.WaitAsync(TimeSpan.FromSeconds(10));

        for (var i = 0; i < Capacity + Extra; i++)
        {
            notifier.Notify(new AlarmTransition(AlarmTransitionKind.Raised, MakeAlarm($"key-{i}")));
        }

        var stats = notifier.Stats;
        Assert.Equal(Extra, stats.Dropped);                    // every eviction counted...
        Assert.Equal(1 + Capacity + Extra, stats.Enqueued);    // ...even though every write was ACCEPTED

        release.TrySetResult();
        await notifier.DisposeAsync();

        // Oldest-first: the primed job (already out of the channel) plus the LAST `Capacity` writes.
        Assert.Equal(
            new[] { "prime" }.Concat(Enumerable.Range(Extra, Capacity).Select(i => $"key-{i}")).ToArray(),
            delivered.Select(j => j.Alarm.Key).ToArray());
    }

    /// <summary>Drop path 3 of 3: an edge arriving after shutdown. Counted, not silent.</summary>
    [Fact]
    public async Task Enqueue_AfterDispose_IsCountedAsADrop()
    {
        var (dispatch, jobs) = Collector();
        var notifier = new AlarmNotifier(dispatch);

        notifier.Notify(new AlarmTransition(AlarmTransitionKind.Raised, MakeAlarm("before")));
        await notifier.DisposeAsync();

        notifier.Notify(new AlarmTransition(AlarmTransitionKind.Raised, MakeAlarm("after-1")));
        notifier.Notify(new AlarmTransition(AlarmTransitionKind.Raised, MakeAlarm("after-2")));

        var stats = notifier.Stats;
        Assert.Equal(2, stats.Dropped);
        Assert.Equal(1, stats.Enqueued);
        Assert.Single(jobs);
    }

    // ─────────────────────────────────────────────────────────────────────
    // 8. Concurrency.
    // ─────────────────────────────────────────────────────────────────────

    /// <summary>The evaluator's timer thread and a request-path policy denial genuinely can raise the same
    /// key at the same instant. The store's single-statement upsert makes exactly one of them the INSERT,
    /// and the detector's own gate makes exactly one of them the EDGE — belt and braces, because a
    /// duplicate here becomes a duplicate coil pulse once C-6 lands.</summary>
    [Fact]
    public async Task ConcurrentRaisesOfTheSameKey_ProduceExactlyOneEdge()
    {
        const int Racers = 32;

        var (dispatch, jobs) = Collector();
        var notifier = new AlarmNotifier(dispatch);
        var store = new AlarmStore(NewTempDir(), notifier: notifier);

        var gate = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
        var racers = Enumerable.Range(0, Racers).Select(_ => Task.Run(async () =>
        {
            await gate.Task;
            await store.RaiseAsync(DriverDown());
        })).ToArray();

        gate.SetResult();
        await Task.WhenAll(racers);

        var stats = notifier.Stats;
        await notifier.DisposeAsync();

        var job = Assert.Single(jobs);
        Assert.Equal(AlarmEdgeKind.Raised, job.Edge);
        Assert.Equal(Racers - 1, stats.Suppressed);
        Assert.Equal(Racers, (await store.ListActiveAsync()).Single().Count);
    }

    /// <summary>Jobs reach the channel in the order their edges were DECIDED — a Cleared can never overtake
    /// its own Raised. For C-6 that is the difference between a coil that ends up off and one stuck on.</summary>
    [Fact]
    public async Task EdgesAreEnqueuedInDecisionOrder_WithGapFreeSequenceNumbers()
    {
        var (dispatch, jobs) = Collector();
        var notifier = new AlarmNotifier(dispatch);
        var store = new AlarmStore(NewTempDir(), notifier: notifier);

        for (var i = 0; i < 25; i++)
        {
            await store.RaiseAsync(DriverDown($"slot-{i}"));
            await store.ClearAsync(DriverDown($"slot-{i}").Key);
        }

        await notifier.DisposeAsync();

        Assert.Equal(Enumerable.Range(1, 50).Select(i => (long)i).ToArray(), jobs.Select(j => j.Sequence).ToArray());
        for (var i = 0; i < 50; i += 2)
        {
            Assert.Equal(AlarmEdgeKind.Raised, jobs.ElementAt(i).Edge);
            Assert.Equal(AlarmEdgeKind.Cleared, jobs.ElementAt(i + 1).Edge);
        }
    }

    // ─────────────────────────────────────────────────────────────────────
    // 9. The no-op default — additive and default-off.
    // ─────────────────────────────────────────────────────────────────────

    /// <summary>A store built the way every pre-existing site builds it (no notifier at all) behaves
    /// exactly as it did before Đợt C. The real proof of this is that all 1,720 pre-existing tests pass
    /// untouched; this just pins the intent locally.</summary>
    [Fact]
    public async Task NoOpDefault_AStoreWithNoNotifierRaisesClearsAndAcksNormally()
    {
        var store = new AlarmStore(NewTempDir()); // no notifier argument — the default

        var raise = DriverDown();
        Assert.Equal(AlarmTransitionKind.Raised, (await store.RaiseAsync(raise)).Kind);
        Assert.Equal(AlarmTransitionKind.ReRaised, (await store.RaiseAsync(raise)).Kind);
        Assert.Single(await store.ListActiveAsync());
        Assert.Equal(AlarmTransitionKind.Cleared, (await store.ClearAsync(raise.Key)).Kind);
        Assert.Equal(AlarmTransitionKind.None, (await store.ClearAsync(raise.Key)).Kind);
        Assert.Empty(await store.ListActiveAsync());
    }

    [Fact]
    public void NoOpDefault_NullAlarmNotifierDoesNothingAndNeverThrows()
    {
        NullAlarmNotifier.Instance.Notify(new AlarmTransition(AlarmTransitionKind.Raised, MakeAlarm("k")));
        NullAlarmNotifier.Instance.Notify(AlarmTransition.None);
        NullAlarmNotifier.Instance.SeedFromActive(new[] { MakeAlarm("k") });
        Assert.Same(NullAlarmNotifier.Instance, NullAlarmNotifier.Instance);
    }

    /// <summary>Disposal drains what is queued rather than discarding it, and is idempotent — the DI
    /// container tracks this instance under both its concrete type and <see cref="IAlarmNotifier"/>.</summary>
    [Fact]
    public async Task Dispose_DrainsWhatIsQueued_AndIsIdempotent()
    {
        var (dispatch, jobs) = Collector();
        var notifier = new AlarmNotifier(dispatch);

        for (var i = 0; i < 50; i++)
        {
            notifier.Notify(new AlarmTransition(AlarmTransitionKind.Raised, MakeAlarm($"key-{i}")));
        }

        await notifier.DisposeAsync();
        await notifier.DisposeAsync(); // must not throw
        await notifier.DisposeAsync();

        Assert.Equal(50, jobs.Count);
    }

    // ─────────────────────────────────────────────────────────────────────
    // Test doubles
    // ─────────────────────────────────────────────────────────────────────

    /// <summary>Deliberately VIOLATES <see cref="IAlarmNotifier"/>'s never-throws contract, to prove that
    /// <see cref="AlarmStore"/>'s own guard — not a well-behaved implementation — is what keeps
    /// <see cref="IAlarmStore.RaiseAsync"/>/<see cref="IAlarmStore.ClearAsync"/> never-throwing.</summary>
    private sealed class ThrowingNotifier : IAlarmNotifier
    {
        public void Notify(AlarmTransition transition, string? actor = null) =>
            throw new InvalidOperationException("ThrowingNotifier: simulated notifier failure (test double).");

        public void SeedFromActive(IReadOnlyList<Alarm> active) =>
            throw new InvalidOperationException("ThrowingNotifier: simulated seed failure (test double).");
    }

    /// <summary>A store whose <see cref="ListActiveAsync"/> fails — the failure
    /// <see cref="AlarmNotifierSeedService"/> must survive without stopping the host.</summary>
    private sealed class ThrowingListStore : IAlarmStore
    {
        public Task<AlarmTransition> RaiseAsync(AlarmRaise raise, CancellationToken ct = default) =>
            Task.FromResult(AlarmTransition.None);

        public Task<AlarmTransition> ClearAsync(string key, CancellationToken ct = default) =>
            Task.FromResult(AlarmTransition.None);

        public Task<Alarm?> AckAsync(long id, string by, CancellationToken ct = default) =>
            Task.FromResult<Alarm?>(null);

        public Task<IReadOnlyList<Alarm>> ListActiveAsync(CancellationToken ct = default) =>
            throw new InvalidOperationException("ThrowingListStore: simulated alarms.db failure (test double).");

        public Task<AlarmHistoryPage> QueryHistoryAsync(AlarmHistoryFilter filter, CancellationToken ct = default) =>
            Task.FromResult(new AlarmHistoryPage(Array.Empty<AlarmHistoryEntry>(), 0, filter.Limit, filter.Offset));
    }
}
