using System.Collections.Concurrent;
using Microsoft.Extensions.Logging;
using St4i.Connector.Abstractions;
using St4i.Connector.Abstractions.Models;
using St4i.EdgeCore.Config;
using St4i.EdgeCore.Engine;
using St4i.EdgeCore.Infrastructure;
using St4i.EdgeCore.Models;
using St4i.EdgeCore.Transport;
using St4i.EngineApi.Fleet;
using Xunit;

namespace St4i.EngineApi.Tests;

/// <summary>
/// 🔴 Task J-1 (.superpowers/sdd/restart-chokepoint/task-1-brief.md) — the witnesses for taking the
/// enumeration's <b>P4</b> and <b>P5</b> off <c>FleetCore._gate</c>, the lock <c>Estop()</c> takes.
///
/// <para><b>P4</b> is <c>MappingProfileResolver.Build</c> → <c>File.Exists</c>/<c>File.ReadAllText</c>, once
/// per roster machine, measured at 2.39 ms held with 50 machines on a local SSD. <b>P5</b> is a WRITE:
/// <c>SimulatorFactory.Create</c> → <c>SimulatorBase</c>'s ctor → <c>MachineConfigStore.Ensure</c> →
/// <c>File.WriteAllText</c> + <c>File.Move</c>, plus that store's own lock taken while this one is held —
/// and since H-1c its root is relocatable, so it can be a network filesystem write. Both now happen in
/// <c>FleetCore.BuildStartPlan</c>, with the gate released.</para>
///
/// <para><b>Why these tests are shaped as CONSEQUENCE probes rather than structure assertions.</b> Every
/// claim J-1 makes is about where work runs relative to a lock, and about what a concurrent roster change
/// does to the pipeline that comes out. Neither is visible to an assertion about which method a call sits
/// in. So: the gate is probed FROM ANOTHER THREAD at the moment the build is running (a lock that is held
/// cannot be granted, so there is no timing assumption in the passing direction — only in the failing one,
/// which is a genuine block, not a slow machine); the roster window is probed by mutating the roster from
/// inside the build and then asserting the machine that was added is CYCLING; and the halt latch is probed
/// by engaging it inside the same window and asserting the fleet did not come up.</para>
///
/// <para><b>The seam.</b> <c>StartBuildObserverForTests</c> fires as the last statement of the hoisted
/// build, off the gate. It had to be a third seam: <c>DriverDecoratorForTests</c> and
/// <c>AdditionalPipelinesForTests</c> both fire INSIDE <c>StartLocked</c> under the lock, which is what
/// makes them good throw sites for the S-set tests and useless here. Note also that a same-thread callback
/// would prove nothing about the lock — <c>Monitor</c> is re-entrant, so a re-entrant <c>Estop()</c> would
/// be granted whether or not the build held the gate. That is why every probe below runs on
/// <see cref="Task.Run(Action)"/> and is awaited with a bound.</para>
///
/// <para><b>What these tests do NOT prove.</b> That P4/P5 are unreachable under the gate — they are not,
/// and the design says so: a machine whose descriptor entered the roster after the snapshot is built under
/// the lock, for that machine only. <c>ALateMachineWithAnUnknownMappingProfile_...</c> below is the witness
/// that that arm is live code rather than an unreachable branch. Nothing here measures the 2.39 ms figure
/// itself; the quantity this file's instrument reports is "was the gate grantable to another thread while
/// the build ran", which is a different and stronger question than "how long was it held".</para>
/// </summary>
public sealed class FleetHostStartBuildHoistTests
{
    /// <summary>Bound for every cross-thread probe. A pass takes microseconds; only a genuinely HELD lock
    /// can exhaust this, so the constant buys tolerance in the failing direction and nothing in the passing
    /// one.</summary>
    private static readonly TimeSpan ProbeTimeout = TimeSpan.FromSeconds(20);

    private static readonly TimeSpan PollTimeout = TimeSpan.FromSeconds(8);
    private static readonly TimeSpan PollInterval = TimeSpan.FromMilliseconds(50);

    private static FleetHost CreateHost(RecordingLogger? logger = null, MachineConfigStore? configStore = null)
    {
        var demo = new DemoTransport(latencyMs: 0);
        var live = LiveTransport.ForMachine("http://localhost:1", mkKey: "", machineCode: "TEST", queuePath: null, verifyTls: true);
        var auto = new AutoTransport(live, demo);
        var switchable = new SwitchableTransport(demo);
        var coordinator = new TransportCoordinator(switchable, demo, live, auto, TransportMode.Demo);
        var eventBus = new EventBus();
        return new FleetHost(switchable, coordinator, eventBus, logger: logger, configStore: configStore);
    }

    private static MachineDescriptor Descriptor(string code, string? mappingProfile = null) =>
        new(code, $"SN-{code}", DeviceClass.Automation, "SCREWDRIVE", "screw_tightening",
            DriverKinds.Simulated, "RC-J1", mappingProfile, CycleSeconds: 0.05);

    private static string NewTempDir()
    {
        var dir = Path.Combine(Path.GetTempPath(), "st4i-j1-" + Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(dir);
        return dir;
    }

    private static async Task WaitUntilAsync(Func<bool> predicate, string because)
    {
        var deadline = DateTime.UtcNow + PollTimeout;
        while (DateTime.UtcNow < deadline)
        {
            if (predicate()) return;
            await Task.Delay(PollInterval);
        }

        Assert.Fail($"Timed out after {PollTimeout.TotalSeconds:F0}s waiting for {because}.");
    }

    /// <summary>Runs <paramref name="probe"/> on a DIFFERENT thread and returns whether it completed inside
    /// <see cref="ProbeTimeout"/>. The different thread is the whole instrument: <c>Monitor</c> is
    /// re-entrant, so the same thread would be granted <c>_gate</c> even if the build held it.</summary>
    private static bool CompletesOnAnotherThread(Action probe) => Task.Run(probe).Wait(ProbeTimeout);

    // ─────────────────────────────────────────────────────────────────────
    // P4 / P5 — the work happens with the gate RELEASED.
    // ─────────────────────────────────────────────────────────────────────

    /// <summary>The load-bearing measurement of this task, and it answers both halves at one instant: by the
    /// time the build's last statement runs, P5's write has ALREADY happened (the store's file is on disk),
    /// and <c>_gate</c> is grantable to another thread. Before J-1 both were true only of a moment when the
    /// gate was HELD — that is what the 2.39 ms figure measured, and what every <c>EstopEngaged</c> reader
    /// paid.
    ///
    /// <para>The store's file is the right witness for P5 rather than a call count, because the file is
    /// exactly the thing the hazard is about: a <c>File.WriteAllText</c> + <c>File.Move</c> that H-1c made
    /// relocatable onto a UNC share. A test that counted <c>Ensure</c> calls would stay green if the write
    /// moved back under the lock.</para></summary>
    [Fact]
    public void TheHoistedBuild_HasAlreadyDoneP5sWrite_AndRunsWithTheGateGrantableToAnotherThread()
    {
        var dir = NewTempDir();
        var store = new MachineConfigStore(dir);
        var host = CreateHost(configStore: store);
        var storeFile = Path.Combine(dir, "machine-operating-config.json");

        Assert.True(host.RegisterMachine(Descriptor("J1-HOIST-GATEFREE-01")));
        Assert.False(File.Exists(storeFile), "the store must not have been written before the first Start");

        var observations = 0;
        var p5Done = false;
        var gateGrantable = false;
        host.StartBuildObserverForTests = () =>
        {
            if (Interlocked.Increment(ref observations) > 1) return;
            p5Done = File.Exists(storeFile);
            gateGrantable = CompletesOnAnotherThread(() => { _ = host.EstopEngaged; });
        };

        host.Start();
        try
        {
            Assert.Equal(1, Volatile.Read(ref observations));
            Assert.True(p5Done, "P5's MachineConfigStore write must have completed inside the hoisted build");
            Assert.True(
                gateGrantable,
                "another thread must be able to take FleetCore._gate while the hoisted build is running");
        }
        finally
        {
            host.Stop();
            try { Directory.Delete(dir, recursive: true); } catch (IOException) { }
        }
    }

    /// <summary>P4's witness, and it is a COUNT rather than a timing: the mapping file for a profile name
    /// that does not exist produces exactly one warning per <c>MappingProfileResolver.Build</c> over that
    /// descriptor. One warning means the install phase resolved nothing — it consumed the plan. Two would
    /// mean the hoist bought nothing, because the same per-machine <c>File.Exists</c> would still be running
    /// under the gate; and a count is immune to the "it was fast enough" reading a duration invites.</summary>
    [Fact]
    public void AMappingProfileTheBuildAlreadyResolved_IsNotResolvedAgainByTheInstall()
    {
        var logger = new RecordingLogger();
        var host = CreateHost(logger: logger);
        const string code = "J1-MISSING-MAPPING-01";

        Assert.True(host.RegisterMachine(Descriptor(code, mappingProfile: "j1-no-such-profile")));

        host.Start();
        try
        {
            // Start()'s own finally flushes the deferred lines before it returns, so this needs no wait.
            Assert.Equal(1, logger.CountContaining(code));
        }
        finally
        {
            host.Stop();
        }
    }

    // ─────────────────────────────────────────────────────────────────────
    // The roster-changed-underneath window — EXCLUDED, not merely detected.
    // ─────────────────────────────────────────────────────────────────────

    /// <summary>The window the nine-path banner named as the reason this hoist was deferred six times. A
    /// machine registered from another thread WHILE the build is running is not in the plan — and must still
    /// be driven by the start that was in flight, because that registration saw <c>IsRunning == false</c>
    /// and therefore scheduled no restart of its own. Nothing else will ever come back for it.
    ///
    /// <para>The assertion is <c>Cycles &gt; 0</c>, not "appears in the roster": a machine can be in
    /// <c>_fleet</c> and <c>_states</c>, visible in every snapshot as idle with zero cycles, and simply
    /// never driven. That is the silent outcome, and a roster-membership assertion would pass on it.</para></summary>
    [Fact]
    public async Task AMachineRegisteredWhileTheHoistedBuildIsRunning_IsDrivenByThatSameStart()
    {
        var host = CreateHost();
        const string late = "J1-LATE-ROSTER-01";

        var observations = 0;
        var registered = false;
        host.StartBuildObserverForTests = () =>
        {
            if (Interlocked.Increment(ref observations) > 1) return;
            registered = CompletesOnAnotherThread(() => Assert.True(host.RegisterMachine(Descriptor(late))));
        };

        host.Start();
        try
        {
            Assert.Equal(1, Volatile.Read(ref observations));
            Assert.True(registered, "the mid-build registration must have completed");
            await WaitUntilAsync(
                () => (host.MachineDetail(late)?.Cycles ?? 0) > 0,
                $"{late} — registered inside the build window — to be driven by the start that was in flight");
        }
        finally
        {
            host.Stop();
        }
    }

    /// <summary>The other half of the same window, and the witness that the install's own resolve arm is
    /// LIVE CODE rather than an unreachable branch. A machine that arrives mid-build carries a mapping
    /// profile the plan never saw, so its profile has to be resolved under the gate — once, for that machine
    /// alone. Exactly one warning: not zero (which would mean the late machine's mapping was never resolved
    /// at all and it silently inherited the group's shared fleet-mixed profile), and not two (which would
    /// mean the install re-resolved the whole roster).</summary>
    [Fact]
    public async Task AMachineRegisteredMidBuild_HasItsOwnMappingProfileResolvedByTheInstall()
    {
        var logger = new RecordingLogger();
        var host = CreateHost(logger: logger);
        const string late = "J1-LATE-MAPPING-01";

        var observations = 0;
        host.StartBuildObserverForTests = () =>
        {
            if (Interlocked.Increment(ref observations) > 1) return;
            Assert.True(CompletesOnAnotherThread(
                () => Assert.True(host.RegisterMachine(Descriptor(late, mappingProfile: "j1-no-such-profile")))));
        };

        host.Start();
        try
        {
            Assert.Equal(1, logger.CountContaining(late));
            await WaitUntilAsync(
                () => (host.MachineDetail(late)?.Cycles ?? 0) > 0, $"{late} to be driven");
        }
        finally
        {
            host.Stop();
        }
    }

    /// <summary>The third input a plan can go stale on, and the only one a descriptor comparison cannot
    /// see. A simulator is a function of (descriptor, index, <b>multiplier</b>), and the descriptor carries
    /// the multiplier only through its pre-scaled <c>CycleSeconds</c> — which <c>MinCycleSeconds</c>
    /// CLAMPS. So for a machine already at the floor, two very different multipliers produce byte-identical
    /// descriptors, and only <c>StartPlan.Multiplier</c> distinguishes them. Without that check a
    /// scenario change landing mid-build would leave a config-aware simulator baked at the OLD rate while
    /// <c>GetScenario</c> reports the new one, until some later restart.
    ///
    /// <para><b>The separation is structural, not a race against the clock.</b> The machine's descriptor
    /// sits at the 0.05 s floor, so it is identical under both multipliers; its config-derived cadence is
    /// driven to the schema's slowest legal setting (<c>speedRpm</c> 50, <c>clampTimeMs</c> 5000 — the
    /// documented <c>Min</c>/<c>Max</c> of <c>MachineParameterSchema</c>, giving 0.2 + 3.6 + 5.0 = 8.8 s),
    /// and the mid-build scenario drives the multiplier to 200, which floors the override at 0.05 s. Three
    /// cycles therefore take 0.15 s when the simulator is rebuilt and 26.4 s when a stale one is reused, so
    /// the bound below has ~50x headroom on the passing side and is exceeded by 3x on the failing one. If a
    /// future schema change moves either bound, this test gets slower or louder — never quieter.</para>
    ///
    /// <para>A non-config-aware simulator cannot witness this at all, and that is a property rather than a
    /// gap: for those the multiplier reaches the pipeline ONLY through the descriptor's
    /// <c>CycleSeconds</c>, which the clamp has already made identical — so a reused instance is
    /// indistinguishable from a rebuilt one, by construction.</para></summary>
    [Fact]
    public async Task AScenarioMultiplierChangedMidBuild_RebuildsTheSimulators_EvenWhenTheDescriptorsAreIdentical()
    {
        var dir = NewTempDir();
        var store = new MachineConfigStore(dir);
        var host = CreateHost(configStore: store);
        const string code = "J1-MULTIPLIER-CLAMPED-01";

        // CycleSeconds AT the floor: 0.05/1 and 0.05/200 both clamp to 0.05, so the two descriptors are
        // byte-identical and the descriptor comparison cannot tell the two plans apart.
        Assert.True(host.RegisterMachine(new MachineDescriptor(
            code, $"SN-{code}", DeviceClass.Automation, "SCREWDRIVE", "screw_tightening",
            DriverKinds.Simulated, "RC-J1", null, CycleSeconds: 0.05)));

        // One start/stop purely to let the config store seed this machine, so the adjustments below have a
        // config to attach to. Nothing about the pipeline that start builds is under test.
        host.Start();
        host.Stop();
        store.SetAdjustment(code, "speedRpm", 50, AdjustmentScope.Machine, null, "j1", null);
        store.SetAdjustment(code, "clampTimeMs", 5000, AdjustmentScope.Machine, null, "j1", null);

        var observations = 0;
        host.StartBuildObserverForTests = () =>
        {
            if (Interlocked.Increment(ref observations) > 1) return;
            Assert.True(CompletesOnAnotherThread(
                () => host.ApplyScenario(new ScenarioConfig(200.0, 0.0, 0.0, false), "j1-fast")));
        };

        host.Start();
        try
        {
            Assert.Equal(1, Volatile.Read(ref observations));
            await WaitUntilAsync(
                () => (host.MachineDetail(code)?.Cycles ?? 0) >= 3,
                $"{code} to cycle at the multiplier this start committed, not the one its plan was built with");
        }
        finally
        {
            host.Stop();
            try { Directory.Delete(dir, recursive: true); } catch (IOException) { }
        }
    }

    // ─────────────────────────────────────────────────────────────────────
    // The HALT latch — the most dangerous part of the hoist, per the brief.
    // ─────────────────────────────────────────────────────────────────────

    /// <summary>An <c>Estop()</c> landing in <c>Start()</c>'s off-lock build window must leave the fleet
    /// halted and not running.
    ///
    /// <para>🔴 <b>BRANCH REVIEW, Critical — WHAT THIS TEST ACTUALLY EXERCISES CHANGED UNDER IT, and its
    /// own doc went on claiming otherwise.</b> It read "this is the test that makes deleting that check
    /// red", meaning <c>StartLocked</c>'s latch. That was true when written and FALSE from fix round 1
    /// onward: once <c>Estop()</c> began incrementing <c>_stopRequests</c>, <c>Start()</c>'s abandon check
    /// started returning before <c>StartLocked</c> was ever called, so this test has been passing through
    /// the COUNTER. Measured rather than argued — with the latch deleted at the branch tip, all 1330 tests
    /// stayed green. The latch's own witnesses are the two tests at the top of this file; this one is the
    /// witness for the counter on the Estop path, which is a real guarantee and a different one.</para></summary>
    [Fact]
    public void AnEstopLandingDuringTheHoistedBuild_IsStillRefusedByTheLatchInsideTheLock()
    {
        var host = CreateHost();

        var observations = 0;
        var halted = false;
        host.StartBuildObserverForTests = () =>
        {
            if (Interlocked.Increment(ref observations) > 1) return;
            halted = CompletesOnAnotherThread(host.Estop);
        };

        host.Start();

        Assert.Equal(1, Volatile.Read(ref observations));
        Assert.True(halted, "the mid-build Estop must have completed");
        Assert.True(host.EstopEngaged);
        Assert.False(host.IsRunning);
        Assert.Empty(host.GetDriverHealth());
    }

    /// <summary>🔴 BRANCH REVIEW, Critical — <b>the witness for the HALT latch itself, and it exists because
    /// the latch had none.</b>
    ///
    /// <para><b>What happened, because the shape matters more than the fix.</b> Round 1 made
    /// <c>Estop()</c> increment <c>_stopRequests</c>. From that moment <c>Start()</c>'s abandon check
    /// returned <i>before</i> <c>StartLocked</c> was ever called, so
    /// <c>AnEstopLandingDuringTheHoistedBuild_…</c> below stopped exercising the latch and started
    /// exercising the counter — while its own name, three comments and the task report all went on claiming
    /// it covered the latch. The mutation that had proved the latch (M1) was run at <c>39f1fb38</c>, BEFORE
    /// the counter existed, and was never re-run. <b>Re-run against the branch tip it SURVIVES the entire
    /// 1330-test suite.</b> A mutation result taken before the mechanism changed, cited afterwards as
    /// current evidence: the inverse of "no failures is not evidence of a repair", one layer up.</para>
    ///
    /// <para><b>Why this test reaches the latch when <c>Start()</c> no longer can.</b> A roster change on a
    /// RUNNING fleet restarts through <c>RebuildPipelineOffLock</c>, which reads no <c>_stopRequests</c>. So
    /// an <c>Estop()</c> landing in that rebuild's off-lock build window meets the latch and nothing else.
    /// This is the <c>_estopEngaged</c> arm; the sibling test below covers the <c>IsRunning</c> arm, which is
    /// still reachable from <c>Start()</c>.</para>
    ///
    /// <para>🔴 <b>Task J-1b — that method now has a pre-check too, and this test still reaches the latch.
    /// Stated as a measurement rather than as an argument, because the argument is what §8.1(h) says not to
    /// trust.</b> The pre-check is sited BEFORE <c>BuildStartPlan</c> and the <c>Estop()</c> below is injected
    /// at the END of it, so the check has already passed when the halt lands. The whole HALT-latch mutation
    /// cluster was re-run on the post-J-1b tree for exactly this reason — see
    /// <c>.superpowers/sdd/symmetric-precheck/task-1-report.md</c> — rather than reasoning about which
    /// mutations still applied, which is the judgement that failed the first time.</para></summary>
    [Fact]
    public void AnEstopLandingDuringARestartsRebuild_IsRefusedByTheLatchInsideTheLock()
    {
        var host = CreateHost();
        Assert.True(host.RegisterMachine(Descriptor("J1-RESTART-LATCH-01")));

        host.Start();
        Assert.True(host.IsRunning);

        // Armed only now, so the initial start's own build does not consume the one-shot.
        var observations = 0;
        var halted = false;
        host.StartBuildObserverForTests = () =>
        {
            if (Interlocked.Increment(ref observations) > 1) return;
            halted = CompletesOnAnotherThread(host.Estop);
        };

        // Restarts the running fleet: StopLocked under the gate, teardown off it, then the rebuild whose
        // build window the Estop above lands in.
        Assert.True(host.RegisterMachine(Descriptor("J1-RESTART-LATCH-02")));

        Assert.Equal(1, Volatile.Read(ref observations));
        Assert.True(halted, "the mid-rebuild Estop must have completed");
        Assert.True(host.EstopEngaged);
        Assert.False(host.IsRunning);
        Assert.Empty(host.GetDriverHealth());
    }

    /// <summary>The latch's OTHER arm, and the one that is still live on <c>Start()</c>'s own path: a second
    /// start winning the race while this one is building. <c>_stopRequests</c> does not move — nobody asked
    /// for a stop — so the abandon check passes and <c>IsRunning</c> is what refuses the install.
    ///
    /// <para>The assertion is the SLOT COUNT rather than a flag, because the flag is true either way. What
    /// the latch prevents here is a SECOND set of pipeline slots over the same roster: two simulated groups
    /// writing the same <c>MachineState</c>, which is the double-drive that corrupts per-machine cycles and
    /// therefore fleet KPI/OEE/FPY, silently.</para></summary>
    [Fact]
    public void ASecondStartWinningTheRace_LeavesTheLoserRefusedByTheLatch_NotASecondSetOfSlots()
    {
        var host = CreateHost();
        Assert.True(host.RegisterMachine(Descriptor("J1-DOUBLE-START-01")));

        var observations = 0;
        var innerStarted = false;
        host.StartBuildObserverForTests = () =>
        {
            if (Interlocked.Increment(ref observations) > 1) return;
            innerStarted = CompletesOnAnotherThread(host.Start);
        };

        host.Start();
        try
        {
            Assert.True(innerStarted, "the racing Start must have completed");
            Assert.True(host.IsRunning);
            Assert.Single(host.GetDriverHealth());
        }
        finally
        {
            host.Stop();
        }
    }

    /// <summary>🔴 Fix round 1 (review I-1) — a <c>Stop()</c> that lands in the off-lock build window must
    /// WIN, and this is the witness that it does.
    ///
    /// <para>The hoist opened an interval in the middle of <c>Start()</c> that did not exist before it. A
    /// <c>Stop()</c> arriving there acquires the gate, finds the fleet not running (this start has not
    /// installed yet) and <c>StopLocked</c> returns on its own <c>!_running</c> guard — so the request left
    /// no state behind and the start went on to complete. A <c>Start</c>‖<c>Stop</c> race that pre-J-1 could
    /// end STOPPED could then only end RUNNING. That is why the fix counts REQUESTS rather than reading
    /// state: at install time <c>IsRunning</c> and <c>_estopEngaged</c> are both false either way, so the
    /// latch cannot see the difference and no amount of re-reading would have found it.</para>
    ///
    /// <para>The assertion is the END STATE, not the mechanism — <c>IsRunning == false</c> is what an
    /// operator who pressed Stop is owed. It also pins that the halt latch was NOT used to achieve it
    /// (<c>EstopEngaged</c> stays false): a stop must leave the fleet stoppable-and-restartable, not
    /// latched.</para></summary>
    [Fact]
    public void AStopLandingDuringTheHoistedBuild_WinsTheRace_TheStartIsAbandoned()
    {
        var host = CreateHost();

        var observations = 0;
        var stopped = false;
        host.StartBuildObserverForTests = () =>
        {
            if (Interlocked.Increment(ref observations) > 1) return;
            stopped = CompletesOnAnotherThread(host.Stop);
        };

        host.Start();

        Assert.Equal(1, Volatile.Read(ref observations));
        Assert.True(stopped, "the mid-build Stop must have completed");
        Assert.False(host.IsRunning);
        Assert.False(host.EstopEngaged);
        Assert.Empty(host.GetDriverHealth());
    }

    /// <summary>The complement of the test above, and it is what stops the fix from being a blunt "any Stop
    /// ever seen cancels the next Start". A <c>Stop()</c> that completes BEFORE the start begins is not in
    /// the window at all: the snapshot reads the request count after it, so the counts match at install time
    /// and the start proceeds. Without this, a counter that was compared against the wrong baseline — or
    /// never re-read — would make every fleet permanently unstartable after its first Stop, and the test
    /// above alone would not notice.</summary>
    [Fact]
    public async Task AStopThatCompletedBeforeTheStartBegan_DoesNotCancelIt()
    {
        var host = CreateHost();
        const string code = "J1-STOP-BEFORE-START-01";
        Assert.True(host.RegisterMachine(Descriptor(code)));

        host.Stop();
        host.Stop();

        host.Start();
        try
        {
            Assert.True(host.IsRunning);
            await WaitUntilAsync(() => (host.MachineDetail(code)?.Cycles ?? 0) > 0, $"{code} to cycle");
        }
        finally
        {
            host.Stop();
        }
    }

    /// <summary>The brief's own acceptance line: a direct restart call made while the latch is engaged must
    /// still be refused. It ALSO pins that such a call does no I/O at all — before J-1 it could not, because
    /// the latch ran before any build; the cheap pre-check in <c>Start()</c> is what preserves that, and
    /// this observation count is what makes deleting it red rather than merely wasteful.</summary>
    [Fact]
    public void AStartMadeWhileTheLatchIsEngaged_NeitherStartsNorBuilds()
    {
        var host = CreateHost();
        host.Estop();

        var observations = 0;
        host.StartBuildObserverForTests = () => Interlocked.Increment(ref observations);

        host.Start();

        Assert.False(host.IsRunning);
        Assert.True(host.EstopEngaged);
        Assert.Equal(0, Volatile.Read(ref observations));
    }

    // ─────────────────────────────────────────────────────────────────────
    // 🔴 Task J-1b — the pre-check on the RESTART path, and the measurement that says what it is worth.
    // ─────────────────────────────────────────────────────────────────────

    /// <summary>🔴 <b>Task J-1b (.superpowers/sdd/symmetric-precheck/task-1-brief.md) — the witness for the
    /// pre-check <c>RebuildPipelineOffLock</c> now carries, and the window it actually covers.</b>
    ///
    /// <para>A restart's gap runs: the caller's locked section (roster write + <c>StopLocked</c>) → gate
    /// released → <c>WaitAndDisposeOldPipeline</c> (a bounded wait per old slot at the private
    /// <c>RestartTeardownTimeout</c>, then each driver's own <c>DisposeAsync</c> — third-party code) → the
    /// rebuild. An <c>Estop()</c> landing in the TEARDOWN part of that gap is what this pre-check exists for:
    /// before it, the rebuild went on to run <c>BuildStartPlan</c> — P4's <c>File.Exists</c>/
    /// <c>File.ReadAllText</c> per mapping-profile-carrying descriptor and P5's whole-file rewrite of
    /// <c>machine-operating-config.json</c> per machine not yet stored, against a root
    /// <c>ST4I_MACHINE_CONFIG_DIR</c> may point at a UNC share — and only then met the latch.</para>
    ///
    /// <para><b>The seam is the OLD driver's disposal</b>, because that is where the teardown actually
    /// spends its time and it is the one place in this gap a test can stand. <c>DriverDecoratorForTests</c>
    /// wraps the driver of the pipeline that is already running; its <c>DisposeAsync</c> runs inside
    /// <c>WaitAndDisposeOldPipeline</c>, off the gate, so an <c>Estop()</c> raised from there lands strictly
    /// between the caller's lock release and the pre-check.</para>
    ///
    /// <para><b>Two assertions, because they fail differently.</b> The build-observation count is what makes
    /// deleting the pre-check RED — it says no plan was built at all. The store is the consequence probe: the
    /// machine registered by the call that triggered this restart must have NO entry, which is P5's write not
    /// happening rather than merely a call not being counted. The END STATE is deliberately identical to what
    /// it was before the pre-check existed (halted, not running, no slots): this change is about work not
    /// done, never about a different outcome.</para></summary>
    [Fact]
    public void AnEstopLandingInTheRestartTeardown_IsRefusedBeforeTheRebuildBuildsAnything()
    {
        var dir = NewTempDir();
        var store = new MachineConfigStore(dir);
        var host = CreateHost(configStore: store);
        var storeFile = Path.Combine(dir, "machine-operating-config.json");
        const string running = "J1B-TEARDOWN-ESTOP-01";
        const string late = "J1B-TEARDOWN-ESTOP-02";

        var halted = false;
        host.DriverDecoratorForTests = driver => new EstopWhenDisposedDriver(
            driver, () => halted = CompletesOnAnotherThread(host.Estop));

        Assert.True(host.RegisterMachine(Descriptor(running)));
        host.Start();
        try
        {
            Assert.True(host.IsRunning);
            // The instrument reads what it claims to: a machine the build DID see is in the store.
            Assert.NotNull(store.GetConfig(running));

            // Armed only now, so the initial start's own build is not counted.
            var observations = 0;
            host.StartBuildObserverForTests = () => Interlocked.Increment(ref observations);

            // Restarts the running fleet. The Estop lands inside the teardown, i.e. before the rebuild's
            // pre-check, never inside its build.
            Assert.True(host.RegisterMachine(Descriptor(late)));

            Assert.True(halted, "the Estop raised from the old driver's disposal must have completed");
            Assert.Equal(0, Volatile.Read(ref observations));
            Assert.Null(store.GetConfig(late));
            Assert.DoesNotContain(late, File.ReadAllText(storeFile), StringComparison.Ordinal);

            // Unchanged outcome: refused, halted, nothing running — exactly as it was refused before.
            Assert.True(host.EstopEngaged);
            Assert.False(host.IsRunning);
            Assert.Empty(host.GetDriverHealth());
        }
        finally
        {
            host.DriverDecoratorForTests = null;
            host.Stop();
            try { Directory.Delete(dir, recursive: true); } catch (IOException) { }
        }
    }

    /// <summary>🔴 <b>Task J-1b — the ZERO, pinned. This is the measurement that contradicted the task's own
    /// motivating case, so it is committed rather than reported.</b>
    ///
    /// <para>The intuition a symmetric pre-check invites is "a roster or scenario change made while the fleet
    /// is halted reads every mapping file and writes every machine config, and only then refuses". On this
    /// codebase it does neither, and not because of the new pre-check: <c>RegisterMachine</c> rebuilds only
    /// <c>if (IsRunning)</c> and <c>ApplyScenario</c> only <c>if (IsRunning &amp;&amp; multiplierChanged)</c>,
    /// while <c>Estop()</c> tears the pipeline down before latching — so an already-halted fleet is not
    /// running and the rebuild is never entered. Zero builds, zero reads, zero writes.</para>
    ///
    /// <para>What this test protects is therefore not the pre-check but the CLAIM: if a later change ever
    /// makes a restart unconditional, the halted case starts doing filesystem work on the halt path again and
    /// this goes red at the observation count. It also covers <c>ApplyScenario</c>, which the sibling tests in
    /// this file do not exercise on the halt path at all.</para></summary>
    [Fact]
    public void ARegisterOrScenarioChangeMadeWhileTheLatchIsEngaged_NeverReachesTheRebuild()
    {
        var dir = NewTempDir();
        var store = new MachineConfigStore(dir);
        var host = CreateHost(configStore: store);
        const string running = "J1B-LATCHED-NOOP-01";
        const string added = "J1B-LATCHED-NOOP-02";

        Assert.True(host.RegisterMachine(Descriptor(running)));
        host.Start();
        try
        {
            Assert.True(host.IsRunning);
            Assert.NotNull(store.GetConfig(running));

            host.Estop();
            Assert.True(host.EstopEngaged);
            Assert.False(host.IsRunning);

            var observations = 0;
            host.StartBuildObserverForTests = () => Interlocked.Increment(ref observations);

            Assert.True(host.RegisterMachine(Descriptor(added, mappingProfile: "j1b-no-such-profile")));
            host.ApplyScenario(new ScenarioConfig(7.0, 0.0, 0.0, false), "j1b-latched");

            Assert.Equal(0, Volatile.Read(ref observations));
            Assert.Null(store.GetConfig(added));
            Assert.True(host.EstopEngaged);
            Assert.False(host.IsRunning);
            Assert.Empty(host.GetDriverHealth());
        }
        finally
        {
            host.Stop();
            try { Directory.Delete(dir, recursive: true); } catch (IOException) { }
        }
    }

    // ─────────────────────────────────────────────────────────────────────
    // Fixtures
    // ─────────────────────────────────────────────────────────────────────

    /// <summary>🔴 Task J-1b — runs <paramref name="onFirstDispose"/> the first time this driver is disposed,
    /// then delegates. Everything else is pass-through: the wrapped driver is the real one, so the pipeline
    /// under test is the production one and only the MOMENT is borrowed.
    ///
    /// <para>One-shot on purpose. The decorator is installed before the first <c>Start</c> so that the
    /// RUNNING pipeline's driver carries it — that is the driver <c>WaitAndDisposeOldPipeline</c> disposes
    /// during a restart's teardown, which is the window under test — and a second firing (a later teardown,
    /// or a rebuild that did happen) would make the test measure something else.</para></summary>
    private sealed class EstopWhenDisposedDriver : IDeviceDriver
    {
        private readonly IDeviceDriver _inner;
        private readonly Action _onFirstDispose;
        private int _fired;

        public EstopWhenDisposedDriver(IDeviceDriver inner, Action onFirstDispose)
        {
            _inner = inner;
            _onFirstDispose = onFirstDispose;
        }

        public string Id => _inner.Id;

        public string Kind => _inner.Kind;

        public DriverHealthState Health => _inner.Health;

        public IAsyncEnumerable<DeviceReading> ReadAsync(CancellationToken ct) => _inner.ReadAsync(ct);

        public ValueTask DisposeAsync()
        {
            if (Interlocked.Exchange(ref _fired, 1) == 0)
            {
                _onFirstDispose();
            }

            return _inner.DisposeAsync();
        }
    }

    /// <summary>Minimal message recorder. Deliberately its own copy rather than a shared helper — the two
    /// existing copies in this suite each carry a throw seam this file does not want, and a shared base
    /// would couple three unrelated test classes to one fixture's evolution.</summary>
    private sealed class RecordingLogger : ILogger<FleetHost>
    {
        private readonly ConcurrentQueue<string> _messages = new();

        public int CountContaining(string fragment) =>
            _messages.Count(m => m.Contains(fragment, StringComparison.Ordinal));

        IDisposable? ILogger.BeginScope<TState>(TState state) => null;

        public bool IsEnabled(LogLevel logLevel) => true;

        public void Log<TState>(
            LogLevel logLevel, EventId eventId, TState state, Exception? exception,
            Func<TState, Exception?, string> formatter) =>
            _messages.Enqueue(formatter(state, exception));
    }
}
