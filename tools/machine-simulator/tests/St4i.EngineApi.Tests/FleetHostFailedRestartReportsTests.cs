using System.Collections.Concurrent;
using Microsoft.Extensions.Logging;
using St4i.Connector.Abstractions;
using St4i.Connector.Abstractions.Models;
using St4i.EdgeCore.Config;
using St4i.EdgeCore.Engine;
using St4i.EdgeCore.Infrastructure;
using St4i.EdgeCore.Mapping;
using St4i.EdgeCore.Models;
using St4i.EdgeCore.Transport;
using St4i.EngineApi.Fleet;
using Xunit;

namespace St4i.EngineApi.Tests;

/// <summary>
/// 🔴 Task U-1 — <c>docs/owner-decisions.md</c> item 7, the second half of the S-set's <b>S4</b>: what state
/// a fleet is left in by a restart that FAILED, and how anyone finds out.
///
/// <para><b>The state, and why it needed a ruling rather than a repair.</b> An internal restart
/// (<c>RegisterMachine</c>, <c>ApplyScenario</c>, and <c>Burst</c>'s scheduled revert through
/// <c>ApplyScenario</c>) commits its roster/scenario write under <c>FleetCore._gate</c>, tears the pipeline
/// down, and rebuilds off the lock. If the REBUILD throws, no <c>finally</c> can start a fleet that failed to
/// start: the commit stands, the pipeline is gone, and the fleet stays stopped.</para>
///
/// <para><b>What was actually wrong was not any single field.</b> Every per-field surface was truthful about
/// that state — <c>IsRunning</c> said stopped, <c>GetDriverHealth</c> listed exactly the slots the install
/// had left behind (none when the BUILD threw, the partial set when the INSTALL did — S3's residual (2)),
/// and <c>Fleet</c>/<c>CurrentScenario</c> reported what had been committed. The surface that was NOT truthful is the one that
/// SUMMARISES them: <c>GET /v1/health</c> is literally <c>LastError is null</c>, so it answered <b>healthy</b>
/// for a fleet an internal restart had torn down and could not rebuild. The owner's ruling keeps the state
/// (stopped, commit standing) and records the fault on that field, from the one <c>catch</c> in
/// <c>RebuildPipelineOffLock</c> that all three entry paths reach.</para>
///
/// <para><b>The throw sites these tests use, and the difference between them.</b> The first test drives a
/// <b>REAL</b> P5 throw against a real <see cref="MachineConfigStore"/> — a machine whose record already
/// carries a different <c>configKind</c>, so <c>SimulatorFactory.Create</c> →
/// <c>SimulatorBase</c>'s ctor → <c>MachineConfigStore.Ensure</c> throws
/// <see cref="InvalidOperationException"/> inside <c>BuildStartPlan</c>. That is the production-reachable
/// site the whole item is about, and it is the one that pins the ruling. The remaining tests use the
/// <c>AdditionalPipelinesForTests</c> seam — the same deterministic <c>StartLocked</c> stand-in the S-set
/// tests use — because the real P5 site cannot be armed twice against one roster: <c>Ensure</c> seeds a
/// record on the first successful build, and a machine that already has a matching record never throws
/// again. The property under test is the same on either site; only the frame the throw comes from differs.
/// </para>
///
/// <para><b>What is deliberately NOT asserted here.</b> That the fleet comes back — it does not, and that is
/// the ruling rather than a gap. S4 keeps its <c>PARTLY OPEN</c> status as an S-set row for exactly that
/// reason; see the banner at <c>FleetCore._gate</c> for the divergences that remain and their reasons.</para>
/// </summary>
public sealed class FleetHostFailedRestartReportsTests
{
    private static readonly TimeSpan PollTimeout = TimeSpan.FromSeconds(20);
    private static readonly TimeSpan PollInterval = TimeSpan.FromMilliseconds(100);

    /// <summary>Marker carried by every INJECTED exception, so no assertion can be satisfied by an unrelated
    /// fault the harness produced. The real-P5 test asserts on the store's own message instead, which is the
    /// point of it being real.</summary>
    private const string InjectedMarker = "u1-injected";

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

    private static MachineDescriptor Descriptor(string code) =>
        new(code, $"SN-{code}", DeviceClass.Automation, "SCREWDRIVE", "screw_tightening",
            DriverKinds.Simulated, "RC-U1", null, CycleSeconds: 0.05);

    private static string NewTempDir()
    {
        var dir = Path.Combine(Path.GetTempPath(), "st4i-u1-" + Guid.NewGuid().ToString("N"));
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

        Assert.True(predicate(), $"timed out after {PollTimeout} waiting for: {because}");
    }

    // ─────────────────────────────────────────────────────────────────────
    // Entry path 1 — RegisterMachine, against a REAL P5 throw.
    // ─────────────────────────────────────────────────────────────────────

    /// <summary>🔴 <b>The control-pair test, and the only one here whose throw is production-reachable
    /// end to end.</b> A running fleet, a machine registered into it, and a
    /// <see cref="MachineConfigStore"/> that already holds that machine's record under a different
    /// <c>configKind</c> — so the restart's <c>BuildStartPlan</c> reaches <c>Ensure</c> and throws exactly
    /// where the enumeration's P5 says it can.
    ///
    /// <para><b>Both halves of the ruling are asserted, and the second is what moved.</b> The fleet is left
    /// STOPPED with the roster write standing (unchanged, and asserted so it cannot drift), and the exception
    /// the caller receives is <b>the same object</b> now sitting on the field <c>GET /v1/health</c> answers
    /// from. <see cref="Assert.Same"/> rather than a message match is deliberate: it is what makes "the HTTP
    /// 500 and the health surface cannot disagree about what failed" a measurement instead of a
    /// claim.</para>
    ///
    /// <para>At this branch's base the last two assertions fail on <c>LastError</c> being
    /// <see langword="null"/> — a stopped, un-rebuildable fleet reporting healthy, permanently, because
    /// nothing else sets that field.</para></summary>
    [Fact]
    public void ARegisterWhoseRebuildReallyThrows_LeavesTheFleetStopped_AndPutsTheSameExceptionOnTheHealthSurface()
    {
        var dir = NewTempDir();
        var store = new MachineConfigStore(dir);
        var host = CreateHost(configStore: store);
        const string code = "U1-P5-POISONED-01";

        try
        {
            host.Start();
            Assert.True(host.IsRunning, "the fleet must be running so RegisterMachine takes the restart path");
            Assert.Null(host.LastError);

            // The poison, and it is the store's own documented refusal rather than anything this test
            // invents: a record for this code already exists under a different configKind, and a SCREWDRIVE
            // descriptor's simulator Ensures MachineParameterSchema.ScrewProgram.
            store.Ensure(code, MachineParameterSchema.IotSettings);

            var thrown = Assert.Throws<InvalidOperationException>(() => host.RegisterMachine(Descriptor(code)));
            Assert.Contains("cannot re-ensure", thrown.Message, StringComparison.OrdinalIgnoreCase);

            // The decided state: stopped, with the commit standing.
            Assert.False(host.IsRunning);
            Assert.Contains(host.Fleet, d => string.Equals(d.Code, code, StringComparison.OrdinalIgnoreCase));

            // Empty because the throw is inside the BUILD: StopLocked already cleared `_slots` and no slot
            // was installed. NOT a general property of a failed restart — an install that throws mid-loop
            // leaves the slots it managed to install (S3's residual (2)). Asserted here because on THIS arm
            // it is what "the fleet is down" means.
            Assert.Empty(host.GetDriverHealth());

            // The reported state — `host.LastError is null` is the whole of GET /v1/health.
            Assert.False(host.LastError is null, "a failed restart must not leave GET /v1/health reporting healthy");
            Assert.Same(thrown, host.LastError);
        }
        finally
        {
            try { host.Stop(); } catch (Exception) { /* best-effort */ }
            try { Directory.Delete(dir, recursive: true); } catch (IOException) { }
        }
    }

    // ─────────────────────────────────────────────────────────────────────
    // Entry path 2 — the scenario endpoint.
    // ─────────────────────────────────────────────────────────────────────

    /// <summary>Entry path 2. A cycle-rate multiplier change on a running fleet restarts the pipeline; when
    /// that rebuild throws, the caller gets the exception (an HTTP 500 at the endpoint) and the SAME object
    /// reaches the health surface — one state, one report, whichever door the restart came through.</summary>
    [Fact]
    public void AScenarioChangeWhoseRebuildThrows_ReportsTheSameFaultOnTheSameSurface()
    {
        var host = CreateHost();
        var throwOnBuild = false;

        host.AdditionalPipelinesForTests = () => throwOnBuild
            ? throw new InvalidOperationException($"{InjectedMarker}: rebuild stand-in for enumeration item P5")
            : new List<(string, IDeviceDriver, MappingProfile)>();

        try
        {
            host.Start();
            Assert.True(host.IsRunning);
            Assert.Null(host.LastError);

            throwOnBuild = true;
            var thrown = Assert.Throws<InvalidOperationException>(
                () => host.ApplyScenario(new ScenarioConfig(3.0, 0.0, 0.0, false), "u1-faster"));
            Assert.Contains(InjectedMarker, thrown.Message, StringComparison.Ordinal);

            Assert.False(host.IsRunning);
            Assert.Equal(3.0, host.CurrentScenario.CycleRateMultiplier);
            Assert.Same(thrown, host.LastError);
        }
        finally
        {
            throwOnBuild = false;
            host.AdditionalPipelinesForTests = null;
            try { host.Stop(); } catch (Exception) { /* best-effort */ }
        }
    }

    // ─────────────────────────────────────────────────────────────────────
    // Entry path 3 — Burst's scheduled revert. The one with no caller at all.
    // ─────────────────────────────────────────────────────────────────────

    /// <summary>🔴 <b>Entry path 3, and the reason this item could not be answered with an exception.</b>
    /// <c>Burst</c> starts its revert as <c>_ = RevertBurstAfterDelayAsync(...)</c>, so the Task is never
    /// observed and nothing in this tree subscribes to <c>TaskScheduler.UnobservedTaskException</c>. G-2 gave
    /// that failure one log line; U-1 puts the same fleet state on the same surface as the other two paths,
    /// which is what makes "the operator learns the restart failed" true on all three rather than on two.
    ///
    /// <para>Both reports are asserted together on purpose: the line and the field are different channels
    /// with different lifetimes, and the log line's own text now says so — the clause claiming it was "the
    /// only report of it" was true at base and is not any more.</para></summary>
    [Fact]
    public async Task AFailedBurstRevert_ReportsOnTheHealthSurface_ThoughNoCallerEverSeesTheException()
    {
        var logger = new RecordingLogger();
        var host = CreateHost(logger);
        var throwOnBuild = false;

        host.AdditionalPipelinesForTests = () => throwOnBuild
            ? throw new InvalidOperationException($"{InjectedMarker}: rebuild stand-in for enumeration item P5")
            : new List<(string, IDeviceDriver, MappingProfile)>();

        try
        {
            host.Start();
            Assert.True(host.IsRunning);

            // A clean burst: the fleet restarts at the burst multiplier and the revert is scheduled.
            host.Burst();
            Assert.True(host.IsRunning);
            Assert.Null(host.LastError);

            // Arm the failure so it is the REVERT's own restart that throws, on the unobserved task.
            throwOnBuild = true;

            await WaitUntilAsync(
                () => logger.Has(LogLevel.Error, "burst revert failed"),
                "the failed burst revert to report itself on the error channel");

            await WaitUntilAsync(
                () => host.LastError is not null,
                "the failed burst revert to reach the field GET /v1/health answers from");

            Assert.Contains(InjectedMarker, host.LastError!.Message, StringComparison.Ordinal);
            Assert.False(host.IsRunning);
        }
        finally
        {
            throwOnBuild = false;
            host.AdditionalPipelinesForTests = null;
            try { host.Stop(); } catch (Exception) { /* best-effort */ }
        }
    }

    // ─────────────────────────────────────────────────────────────────────
    // The halt path — still silent, and pinned rather than asserted in prose.
    // ─────────────────────────────────────────────────────────────────────

    /// <summary>🔴 <b>The halt path says nothing here, and the mechanism is a RETURN rather than a
    /// condition.</b> An <c>Estop</c> landing inside a restart's off-lock build is refused by
    /// <c>StartLocked</c>'s latch, which RETURNS — so it never reaches the <c>catch</c> that records, and no
    /// test of <c>_estopEngaged</c> exists on that path to get wrong. This pins that: the fleet ends halted
    /// and stopped, and <c>GET /v1/health</c> is untouched.
    ///
    /// <para>Deleting the <c>if (!_running)</c> guard leaves this green — the guard is about a concurrent
    /// START, not about the latch. What turns this red is recording from anywhere other than the fault
    /// path.</para></summary>
    [Fact]
    public void ARebuildRefusedByTheHaltLatch_LeavesTheHealthSurfaceUntouched()
    {
        var host = CreateHost();

        try
        {
            host.Start();
            Assert.True(host.IsRunning);
            Assert.Null(host.LastError);

            var observations = 0;
            var halted = false;
            host.StartBuildObserverForTests = () =>
            {
                if (Interlocked.Increment(ref observations) > 1) return;
                halted = Task.Run(host.Estop).Wait(PollTimeout);
            };

            Assert.True(host.RegisterMachine(Descriptor("U1-HALTED-REBUILD-01")));

            Assert.Equal(1, Volatile.Read(ref observations));
            Assert.True(halted, "the mid-build Estop must have completed");
            Assert.True(host.EstopEngaged);
            Assert.False(host.IsRunning);
            Assert.Null(host.LastError);
        }
        finally
        {
            host.StartBuildObserverForTests = null;
            try { host.ResetEstop(); } catch (Exception) { /* best-effort */ }
            try { host.Stop(); } catch (Exception) { /* best-effort */ }
        }
    }

    // ─────────────────────────────────────────────────────────────────────
    // Recovery — the report is not permanent, and the clearing rule is inherited, not new.
    // ─────────────────────────────────────────────────────────────────────

    /// <summary>The report clears itself when a start actually installs, because U-1 added no clearing rule
    /// of its own: <c>StartLocked</c>'s pre-existing <c>LastError = null</c> sits PAST its latch, so a start
    /// that installs clears the field and one the latch refuses does not. Without this, "stopped and
    /// unhealthy" would be an absorbing state and the ruling would have shipped a fleet no operator could
    /// return to healthy.</summary>
    [Fact]
    public void AStartThatInstallsAfterAFailedRestart_ClearsTheHealthSurfaceAgain()
    {
        var host = CreateHost();
        var throwOnBuild = false;

        host.AdditionalPipelinesForTests = () => throwOnBuild
            ? throw new InvalidOperationException($"{InjectedMarker}: rebuild stand-in for enumeration item P5")
            : new List<(string, IDeviceDriver, MappingProfile)>();

        try
        {
            host.Start();
            Assert.True(host.IsRunning);

            throwOnBuild = true;
            Assert.Throws<InvalidOperationException>(() => host.RegisterMachine(Descriptor("U1-RECOVERY-01")));
            Assert.False(host.IsRunning);
            Assert.NotNull(host.LastError);

            throwOnBuild = false;
            host.Start();

            Assert.True(host.IsRunning);
            Assert.Null(host.LastError);
        }
        finally
        {
            throwOnBuild = false;
            host.AdditionalPipelinesForTests = null;
            try { host.Stop(); } catch (Exception) { /* best-effort */ }
        }
    }

    // ─────────────────────────────────────────────────────────────────────
    // Fixtures
    // ─────────────────────────────────────────────────────────────────────

    /// <summary>Records level + rendered message. No throwing seam — nothing here tests a failing host
    /// logger, and a fixture that can do more than a test needs is a fixture that gets reused wrongly.</summary>
    private sealed class RecordingLogger : ILogger<FleetHost>
    {
        public ConcurrentQueue<(LogLevel Level, string Message)> Entries { get; } = new();

        public bool Has(LogLevel level, string fragment) =>
            Entries.Any(e => e.Level == level && e.Message.Contains(fragment, StringComparison.Ordinal));

        IDisposable? ILogger.BeginScope<TState>(TState state) => null;

        public bool IsEnabled(LogLevel logLevel) => true;

        public void Log<TState>(
            LogLevel logLevel,
            EventId eventId,
            TState state,
            Exception? exception,
            Func<TState, Exception?, string> formatter) =>
            Entries.Enqueue((logLevel, formatter(state, exception)));
    }
}
