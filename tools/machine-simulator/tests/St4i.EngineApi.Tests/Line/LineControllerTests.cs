using St4i.EdgeCore.Infrastructure;
using St4i.EdgeCore.Models;
using St4i.EdgeCore.Transport;
using St4i.EdgeCore.Uns;
using St4i.EngineApi.Fleet;
using St4i.EngineApi.Line;
using Xunit;

namespace St4i.EngineApi.Tests.Line;

/// <summary>
/// GĐ3 sub-4 LC-3 — <see cref="LineController"/> against a REAL <see cref="FleetHost"/> (same Demo-mode,
/// no-real-network composition as <c>FleetHostUnsLifecycleTests.CreateHostWithUns</c>) with a recording
/// fake <see cref="IUnsPublisher"/>: the full transition table, invalid-transition rejection, and the
/// Critical-alarm→Held gate (both the Start redirect and the Unhold rejection — see
/// <see cref="LineController"/>'s own doc comment for why those two cases differ).
/// </summary>
public sealed class LineControllerTests
{
    private static (FleetHost Host, RecordingUnsPublisher Uns) CreateHost()
    {
        var demo = new DemoTransport(latencyMs: 0);
        var live = LiveTransport.ForMachine("http://localhost:1", mkKey: "", machineCode: "TEST", queuePath: null, verifyTls: true);
        var auto = new AutoTransport(live, demo);
        var switchable = new SwitchableTransport(demo);
        var coordinator = new TransportCoordinator(switchable, demo, live, auto, TransportMode.Demo);
        var eventBus = new EventBus();

        var uns = new RecordingUnsPublisher();
        var host = new FleetHost(switchable, coordinator, eventBus, unsPublisher: uns);
        return (host, uns);
    }

    /// <summary>Records every <see cref="PublishLineState"/> call, in order; every other method is a
    /// no-op (this file never asserts on readings/birth/death).</summary>
    private sealed class RecordingUnsPublisher : IUnsPublisher
    {
        private readonly object _gate = new();
        private readonly List<string> _lineStates = new();

        public IReadOnlyList<string> LineStates
        {
            get { lock (_gate) return _lineStates.ToList(); }
        }

        public void PublishReading(DeviceReading reading, CanonicalEnvelope envelope)
        {
        }

        public void PublishBirth(string equipmentCode)
        {
        }

        public void PublishDeath(string equipmentCode)
        {
        }

        public void PublishNodeBirth()
        {
        }

        public void PublishNodeDeath()
        {
        }

        public void PublishLineState(string state)
        {
            lock (_gate) _lineStates.Add(state);
        }
    }

    // ─────────────────────────────────────────────────────────────────────
    // Transition table — the "happy path" legal transitions.
    // ─────────────────────────────────────────────────────────────────────

    [Fact]
    public void Start_FromInitialStopped_TransitionsToExecute_StartsFleet_AndPublishes()
    {
        var (host, uns) = CreateHost();
        var line = new LineController(host, uns);
        try
        {
            var result = line.Execute(LineCommand.Start, criticalAlarmActive: false);

            Assert.True(result.Accepted);
            Assert.Equal(PackMlState.Execute, result.State);
            Assert.Null(result.RejectReason);
            Assert.True(host.IsRunning);
            Assert.Equal(new[] { "Execute" }, uns.LineStates);

            var snap = line.Snapshot(criticalAlarmActive: false);
            Assert.Equal(PackMlState.Execute, snap.State);
            Assert.Null(snap.HoldReason);
            Assert.True(snap.IsRunning);
            Assert.False(snap.EstopEngaged);
        }
        finally
        {
            host.Stop();
        }
    }

    [Fact]
    public void Hold_FromExecute_TransitionsToHeld_StopsFleet_AndPublishes()
    {
        var (host, uns) = CreateHost();
        var line = new LineController(host, uns);

        line.Execute(LineCommand.Start, false);
        var result = line.Execute(LineCommand.Hold, false);

        Assert.True(result.Accepted);
        Assert.Equal(PackMlState.Held, result.State);
        Assert.False(host.IsRunning);
        Assert.Equal(new[] { "Execute", "Held" }, uns.LineStates);

        var snap = line.Snapshot(false);
        Assert.Equal(PackMlState.Held, snap.State);
        Assert.Equal("operator hold", snap.HoldReason);
    }

    [Fact]
    public void Unhold_FromHeld_TransitionsToExecute_StartsFleetAgain()
    {
        var (host, uns) = CreateHost();
        var line = new LineController(host, uns);
        line.Execute(LineCommand.Start, false);
        line.Execute(LineCommand.Hold, false);

        try
        {
            var result = line.Execute(LineCommand.Unhold, criticalAlarmActive: false);

            Assert.True(result.Accepted);
            Assert.Equal(PackMlState.Execute, result.State);
            Assert.True(host.IsRunning);
            Assert.Equal(new[] { "Execute", "Held", "Execute" }, uns.LineStates);

            var snap = line.Snapshot(false);
            Assert.Equal(PackMlState.Execute, snap.State);
            Assert.Null(snap.HoldReason);
        }
        finally
        {
            host.Stop();
        }
    }

    [Fact]
    public void Stop_FromExecute_TransitionsToStopped_StopsFleet()
    {
        var (host, uns) = CreateHost();
        var line = new LineController(host, uns);
        line.Execute(LineCommand.Start, false);

        var result = line.Execute(LineCommand.Stop, false);

        Assert.True(result.Accepted);
        Assert.Equal(PackMlState.Stopped, result.State);
        Assert.False(host.IsRunning);
        Assert.Equal(new[] { "Execute", "Stopped" }, uns.LineStates);
    }

    [Fact]
    public void Stop_FromHeld_TransitionsToStopped()
    {
        var (host, uns) = CreateHost();
        var line = new LineController(host, uns);
        line.Execute(LineCommand.Start, false);
        line.Execute(LineCommand.Hold, false);

        var result = line.Execute(LineCommand.Stop, false);

        Assert.True(result.Accepted);
        Assert.Equal(PackMlState.Stopped, result.State);
        Assert.False(host.IsRunning);
    }

    [Fact]
    public void Abort_FromExecute_TransitionsToAborted_EstopsFleet_AndLatchesEstop()
    {
        var (host, uns) = CreateHost();
        var line = new LineController(host, uns);
        line.Execute(LineCommand.Start, false);

        var result = line.Execute(LineCommand.Abort, false);

        Assert.True(result.Accepted);
        Assert.Equal(PackMlState.Aborted, result.State);
        Assert.False(host.IsRunning);
        Assert.True(host.EstopEngaged);
        Assert.Equal(new[] { "Execute", "Aborted" }, uns.LineStates);

        var snap = line.Snapshot(false);
        Assert.True(snap.EstopEngaged);
    }

    [Fact]
    public void Abort_FromInitialStopped_TransitionsToAborted_EstopsFleet()
    {
        var (host, uns) = CreateHost();
        var line = new LineController(host, uns);

        var result = line.Execute(LineCommand.Abort, false);

        Assert.True(result.Accepted);
        Assert.Equal(PackMlState.Aborted, result.State);
        Assert.True(host.EstopEngaged);
    }

    [Fact]
    public void Reset_FromAborted_TransitionsToIdle_ClearsEstopLatch()
    {
        var (host, uns) = CreateHost();
        var line = new LineController(host, uns);
        line.Execute(LineCommand.Abort, false);
        Assert.True(host.EstopEngaged);

        var result = line.Execute(LineCommand.Reset, false);

        Assert.True(result.Accepted);
        Assert.Equal(PackMlState.Idle, result.State);
        Assert.False(host.EstopEngaged);
        Assert.Equal(new[] { "Aborted", "Idle" }, uns.LineStates);
    }

    [Fact]
    public void Reset_FromStopped_TransitionsToIdle()
    {
        var (host, uns) = CreateHost();
        var line = new LineController(host, uns);
        line.Execute(LineCommand.Start, false);
        line.Execute(LineCommand.Stop, false);

        var result = line.Execute(LineCommand.Reset, false);

        Assert.True(result.Accepted);
        Assert.Equal(PackMlState.Idle, result.State);
        Assert.False(host.EstopEngaged);
    }

    [Fact]
    public void Start_FromIdle_AfterReset_TransitionsToExecuteAgain()
    {
        var (host, uns) = CreateHost();
        var line = new LineController(host, uns);
        line.Execute(LineCommand.Abort, false);
        line.Execute(LineCommand.Reset, false);

        try
        {
            var result = line.Execute(LineCommand.Start, false);

            Assert.True(result.Accepted);
            Assert.Equal(PackMlState.Execute, result.State);
            Assert.True(host.IsRunning);
        }
        finally
        {
            host.Stop();
        }
    }

    // ─────────────────────────────────────────────────────────────────────
    // Invalid transitions — rejected (Accepted=false), current state unchanged, no publish.
    // ─────────────────────────────────────────────────────────────────────

    [Fact]
    public void Hold_FromInitialStopped_IsRejected()
    {
        var (host, uns) = CreateHost();
        var line = new LineController(host, uns);

        var result = line.Execute(LineCommand.Hold, false);

        Assert.False(result.Accepted);
        Assert.Equal(PackMlState.Stopped, result.State);
        Assert.NotNull(result.RejectReason);
        Assert.Empty(uns.LineStates);
    }

    [Fact]
    public void Unhold_FromExecute_IsRejected()
    {
        var (host, uns) = CreateHost();
        var line = new LineController(host, uns);
        line.Execute(LineCommand.Start, false);
        var publishedBeforeAttempt = uns.LineStates.Count;

        try
        {
            var result = line.Execute(LineCommand.Unhold, false);

            Assert.False(result.Accepted);
            Assert.Equal(PackMlState.Execute, result.State);
            Assert.NotNull(result.RejectReason);
            Assert.Equal(publishedBeforeAttempt, uns.LineStates.Count);
        }
        finally
        {
            host.Stop();
        }
    }

    [Fact]
    public void Start_FromExecute_IsRejected()
    {
        var (host, uns) = CreateHost();
        var line = new LineController(host, uns);
        line.Execute(LineCommand.Start, false);

        try
        {
            var result = line.Execute(LineCommand.Start, false);

            Assert.False(result.Accepted);
            Assert.Equal(PackMlState.Execute, result.State);
        }
        finally
        {
            host.Stop();
        }
    }

    [Fact]
    public void Start_FromHeld_IsRejected()
    {
        var (host, uns) = CreateHost();
        var line = new LineController(host, uns);
        line.Execute(LineCommand.Start, false);
        line.Execute(LineCommand.Hold, false);

        var result = line.Execute(LineCommand.Start, false);

        Assert.False(result.Accepted);
        Assert.Equal(PackMlState.Held, result.State);
    }

    [Fact]
    public void Stop_FromInitialStopped_IsRejected()
    {
        var (host, uns) = CreateHost();
        var line = new LineController(host, uns);

        var result = line.Execute(LineCommand.Stop, false);

        Assert.False(result.Accepted);
        Assert.Equal(PackMlState.Stopped, result.State);
    }

    [Fact]
    public void Reset_FromExecute_IsRejected()
    {
        var (host, uns) = CreateHost();
        var line = new LineController(host, uns);
        line.Execute(LineCommand.Start, false);

        try
        {
            var result = line.Execute(LineCommand.Reset, false);

            Assert.False(result.Accepted);
            Assert.Equal(PackMlState.Execute, result.State);
        }
        finally
        {
            host.Stop();
        }
    }

    [Fact]
    public void Abort_FromAborted_IsRejected()
    {
        var (host, uns) = CreateHost();
        var line = new LineController(host, uns);
        line.Execute(LineCommand.Abort, false);

        var result = line.Execute(LineCommand.Abort, false);

        Assert.False(result.Accepted);
        Assert.Equal(PackMlState.Aborted, result.State);
    }

    // ─────────────────────────────────────────────────────────────────────
    // Alarm gate — a Critical alarm holds the line.
    // ─────────────────────────────────────────────────────────────────────

    [Fact]
    public void Start_WithCriticalAlarmActive_RedirectsToHeld_FleetNotStarted_ButIsAccepted()
    {
        var (host, uns) = CreateHost();
        var line = new LineController(host, uns);

        var result = line.Execute(LineCommand.Start, criticalAlarmActive: true);

        Assert.True(result.Accepted);
        Assert.Equal(PackMlState.Held, result.State);
        Assert.Null(result.RejectReason);
        Assert.False(host.IsRunning); // fleet.Start() must NOT have been called
        Assert.Equal(new[] { "Held" }, uns.LineStates);

        var snap = line.Snapshot(criticalAlarmActive: true);
        Assert.Equal(PackMlState.Held, snap.State);
        Assert.Equal("critical alarm active", snap.HoldReason);
    }

    [Fact]
    public void Unhold_WithCriticalAlarmActive_StaysHeld_IsRejected_NoAdditionalPublish()
    {
        var (host, uns) = CreateHost();
        var line = new LineController(host, uns);
        line.Execute(LineCommand.Start, false);
        line.Execute(LineCommand.Hold, false);
        var publishedBeforeAttempt = uns.LineStates.Count;

        var result = line.Execute(LineCommand.Unhold, criticalAlarmActive: true);

        Assert.False(result.Accepted);
        Assert.Equal(PackMlState.Held, result.State);
        Assert.Equal("critical alarm active", result.RejectReason);
        Assert.False(host.IsRunning);
        Assert.Equal(publishedBeforeAttempt, uns.LineStates.Count);
    }

    [Fact]
    public void Snapshot_ShowsHeld_WhenCommandedExecute_AndCriticalAlarmActive()
    {
        var (host, uns) = CreateHost();
        var line = new LineController(host, uns);

        try
        {
            line.Execute(LineCommand.Start, criticalAlarmActive: false);

            var withAlarm = line.Snapshot(criticalAlarmActive: true);
            Assert.Equal(PackMlState.Held, withAlarm.State);
            Assert.Equal("critical alarm active", withAlarm.HoldReason);
            Assert.True(withAlarm.IsRunning); // FleetHost is genuinely still running underneath

            // The alarm gate is a pure Snapshot-time OVERRIDE — the commanded state itself never
            // changed, so once the alarm clears the effective state reverts with no new command needed.
            var withoutAlarm = line.Snapshot(criticalAlarmActive: false);
            Assert.Equal(PackMlState.Execute, withoutAlarm.State);
            Assert.Null(withoutAlarm.HoldReason);
        }
        finally
        {
            host.Stop();
        }
    }

    // ─────────────────────────────────────────────────────────────────────
    // Optional-dependency defaults — a LineController with no IUnsPublisher/logError must behave
    // byte-identically otherwise (same "additive optional ctor param" contract as every other
    // FleetHost-adjacent collaborator in this codebase).
    // ─────────────────────────────────────────────────────────────────────

    [Fact]
    public void Execute_WithNoUnsPublisherOrLogError_StillDrivesFleetCorrectly()
    {
        var (host, _) = CreateHost();
        var line = new LineController(host);

        try
        {
            var result = line.Execute(LineCommand.Start, false);

            Assert.True(result.Accepted);
            Assert.Equal(PackMlState.Execute, result.State);
            Assert.True(host.IsRunning);
        }
        finally
        {
            host.Stop();
        }
    }
}
