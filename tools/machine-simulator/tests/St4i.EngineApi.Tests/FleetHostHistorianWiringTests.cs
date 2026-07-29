using St4i.EdgeCore.Engine;
using St4i.EdgeCore.Historian;
using St4i.EdgeCore.Infrastructure;
using St4i.EdgeCore.Models;
using St4i.Connector.Abstractions.Models;
using St4i.EdgeCore.Transport;
using St4i.EngineApi.Fleet;
using Xunit;

namespace St4i.EngineApi.Tests;

/// <summary>
/// Task 7 (WS-A) — proves the historian hook wired into <see cref="FleetHost"/> is genuinely ADDITIVE:
/// committed readings and genuine OPERATOR run-state transitions reach a real <see cref="HistorianWriter"/>
/// over a fake <see cref="IHistorianStore"/> ALONGSIDE (not instead of) the existing in-memory
/// <see cref="MachineState"/> path every other <c>FleetHost*Tests</c> file already exercises. This file
/// never touches an existing FleetHost test — every pre-existing ctor call (no <c>historianWriter</c> arg)
/// must keep compiling/behaving unchanged, which <see cref="FleetHostHealthAndRegistrationTests.CreateHost"/>
/// (constructing <see cref="FleetHost"/> with no <c>historianWriter</c> at all) already guards.
///
/// Fix round 1 (WS-A-T7 review, Important) — <see cref="FleetHost.Start"/>/<see cref="FleetHost.Stop"/> now
/// emit "Start"/"Stop" run events ONLY on a genuine not-running↔running OPERATOR transition (moved out of
/// the shared <c>StartLocked</c>/<c>StopLocked</c> helpers those two methods share with the internal restart
/// chokepoints <see cref="FleetHost.RegisterMachine"/>/<see cref="FleetHost.ApplyScenario"/>). The
/// TIMELINE-CORRECTNESS tests below are the ones that would have failed under the old (wrong) placement:
/// they drain the fake store's run-event list after an internal restart and assert no extra Stop/Start pair
/// appeared, and assert <see cref="FleetHost.Estop"/> emits "Estop" alone (no accompanying "Stop").
/// </summary>
public sealed class FleetHostHistorianWiringTests
{
    private static readonly TimeSpan PollTimeout = TimeSpan.FromSeconds(3);
    private static readonly TimeSpan PollInterval = TimeSpan.FromMilliseconds(50);

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

    /// <summary>Same composition as <see cref="FleetHostHealthAndRegistrationTests.CreateHost"/> (Demo
    /// mode, no real network) PLUS a real <see cref="HistorianWriter"/> over a fake
    /// <see cref="IHistorianStore"/> threaded into the new optional ctor param.</summary>
    private static (FleetHost Host, FakeHistorianStore Store, HistorianWriter Writer) CreateHostWithHistorian()
    {
        var demo = new DemoTransport(latencyMs: 0);
        var live = LiveTransport.ForMachine("http://localhost:1", mkKey: "", machineCode: "TEST", queuePath: null, verifyTls: true);
        var auto = new AutoTransport(live, demo);
        var switchable = new SwitchableTransport(demo);
        var coordinator = new TransportCoordinator(switchable, demo, live, auto, TransportMode.Demo);
        var eventBus = new EventBus();

        var store = new FakeHistorianStore();
        var writer = new HistorianWriter(store);

        var host = new FleetHost(switchable, coordinator, eventBus, historianWriter: writer);
        return (host, store, writer);
    }

    private static int CountOf(FakeHistorianStore store, string eventType) =>
        store.AppendedRunEventsSnapshot().Count(e => e.EventType == eventType);

    [Fact]
    public async Task StartRunStop_RecordsResultsAndRunEvents_AlongsideTheRamCycleLog()
    {
        var (host, store, writer) = CreateHostWithHistorian();
        try
        {
            host.Start();

            // "Alongside, not instead of" — the RAM path (MachineState via MachineDetail) keeps working
            // exactly like every other FleetHost test already proves, at the SAME time as the historian.
            await WaitUntilAsync(() => host.Snapshot().Kpis.Online > 0, "fleet online after Start");
            await WaitUntilAsync(
                () => (host.MachineDetail("SCRW-01")?.Cycles ?? 0) > 0,
                "SCRW-01's RAM cycle-log (MachineDetail) to populate after Start");

            // The historian received at least one result record for that SAME running machine.
            await WaitUntilAsync(
                () => store.AppendedResultsSnapshot().Any(r => r.MachineCode == "SCRW-01"),
                "the historian to receive at least one result record for SCRW-01");

            // Exactly one "Start" run event on operator start — not zero, not duplicated.
            await WaitUntilAsync(() => CountOf(store, "Start") == 1, "the historian to receive exactly one 'Start' run event");

            host.Stop();

            // Exactly one "Stop" run event on operator stop.
            await WaitUntilAsync(() => CountOf(store, "Stop") == 1, "the historian to receive exactly one 'Stop' run event after Stop()");
        }
        finally
        {
            host.Stop();
            await writer.DisposeAsync();
        }
    }

    /// <summary>TIMELINE-CORRECTNESS (fix round 1) — an internal restart triggered by
    /// <see cref="FleetHost.ApplyScenario"/> (a changed <see cref="ScenarioConfig.CycleRateMultiplier"/>
    /// while running forces <c>StopLocked</c>+<c>StartLocked</c> under the hood) must be INVISIBLE to the
    /// historian's run-event timeline — no extra "Stop"/"Start" beyond the single operator "Start" that
    /// began the run. Before the fix (emits living inside <c>StartLocked</c>/<c>StopLocked</c>), this test
    /// would have failed: the restart would have appended a spurious Stop+Start pair.</summary>
    [Fact]
    public async Task ApplyScenarioRestart_WhileRunning_DoesNotEmitExtraStopOrStartEvents()
    {
        var (host, store, writer) = CreateHostWithHistorian();
        try
        {
            host.Start();
            await WaitUntilAsync(() => host.Snapshot().Kpis.Online > 0, "fleet online after Start");
            await WaitUntilAsync(() => CountOf(store, "Start") == 1, "exactly one 'Start' event recorded before the restart");

            // A changed CycleRateMultiplier while running forces FleetHost's internal StopLocked+StartLocked
            // restart (see ApplyScenario's multiplierChanged check) — this is an INTERNAL restart, never an
            // operator Stop/Start.
            host.ApplyScenario(new ScenarioConfig(CycleRateMultiplier: 3.0));

            await WaitUntilAsync(() => host.Snapshot().Kpis.Online > 0, "fleet back online after the scenario-triggered restart");

            // Give any (incorrectly-placed) spurious emit a moment to land before asserting its absence.
            await Task.Delay(200);

            Assert.Equal(1, CountOf(store, "Start"));
            Assert.Equal(0, CountOf(store, "Stop"));
        }
        finally
        {
            host.Stop();
            await writer.DisposeAsync();
        }
    }

    /// <summary>TIMELINE-CORRECTNESS (fix round 1) — <see cref="FleetHost.RegisterMachine"/> restarting an
    /// already-running fleet (to fold the new machine into the pipeline) must likewise be invisible to the
    /// run-event timeline.</summary>
    [Fact]
    public async Task RegisterMachine_WhileRunning_DoesNotEmitExtraStopOrStartEvents()
    {
        var (host, store, writer) = CreateHostWithHistorian();
        try
        {
            host.Start();
            await WaitUntilAsync(() => host.Snapshot().Kpis.Online > 0, "fleet online after Start");
            await WaitUntilAsync(() => CountOf(store, "Start") == 1, "exactly one 'Start' event recorded before registering");

            const string code = "T7-FIX-01";
            var descriptor = new MachineDescriptor(
                code, $"SN-{code}", DeviceClass.Automation, "SCREWDRIVE", "screw_tightening",
                DriverKinds.Simulated, "RC-TEST-A", null, CycleSeconds: 0.1);

            var added = host.RegisterMachine(descriptor);
            Assert.True(added);

            await WaitUntilAsync(() => (host.MachineDetail(code)?.Cycles ?? 0) > 0, $"{code} to cycle after being registered while running");

            await Task.Delay(200);

            Assert.Equal(1, CountOf(store, "Start"));
            Assert.Equal(0, CountOf(store, "Stop"));
        }
        finally
        {
            host.Stop();
            await writer.DisposeAsync();
        }
    }

    /// <summary>TIMELINE-CORRECTNESS (fix round 1) — <see cref="FleetHost.Estop"/> must emit "Estop" ALONE:
    /// before the fix, <c>Estop</c>'s call into <c>StopLocked</c> also emitted "Stop" from inside that
    /// helper, double-recording the same teardown as two distinct events.</summary>
    [Fact]
    public async Task Estop_WhileRunning_EmitsExactlyOneEstopAndZeroStopEvents()
    {
        var (host, store, writer) = CreateHostWithHistorian();
        try
        {
            host.Start();
            await WaitUntilAsync(() => host.Snapshot().Kpis.Online > 0, "fleet online after Start");
            await WaitUntilAsync(() => CountOf(store, "Start") == 1, "exactly one 'Start' event recorded before Estop");

            host.Estop();

            await WaitUntilAsync(() => CountOf(store, "Estop") == 1, "exactly one 'Estop' run event recorded");

            await Task.Delay(200);

            Assert.Equal(0, CountOf(store, "Stop"));
            Assert.True(host.EstopEngaged);
        }
        finally
        {
            host.ResetEstop();
            host.Stop();
            await writer.DisposeAsync();
        }
    }

    /// <summary>Calling <see cref="FleetHost.Start"/> again on an already-running fleet is a no-op in
    /// <c>StartLocked</c> — must not emit a second "Start".</summary>
    [Fact]
    public async Task Start_WhenAlreadyRunning_DoesNotEmitDuplicateStartEvent()
    {
        var (host, store, writer) = CreateHostWithHistorian();
        try
        {
            host.Start();
            await WaitUntilAsync(() => CountOf(store, "Start") == 1, "exactly one 'Start' event recorded");

            host.Start(); // already running — no-op
            await Task.Delay(200);

            Assert.Equal(1, CountOf(store, "Start"));
        }
        finally
        {
            host.Stop();
            await writer.DisposeAsync();
        }
    }

    /// <summary>Calling <see cref="FleetHost.Stop"/> on an already-stopped fleet is a no-op in
    /// <c>StopLocked</c> — must not emit a "Stop" event at all.</summary>
    [Fact]
    public async Task Stop_WhenAlreadyStopped_DoesNotEmitStopEvent()
    {
        var (host, store, writer) = CreateHostWithHistorian();
        try
        {
            Assert.False(host.IsRunning);

            host.Stop(); // never started — no-op

            await Task.Delay(200);

            Assert.Equal(0, CountOf(store, "Stop"));
        }
        finally
        {
            await writer.DisposeAsync();
        }
    }

    /// <summary>Minimal fake of the frozen <see cref="IHistorianStore"/> contract, same shape as
    /// <c>St4i.EdgeCore.Tests.Historian.HistorianWriterTests.FakeHistorianStore</c> — only the two members
    /// <see cref="HistorianWriter"/> actually calls are implemented for real; everything else throws
    /// <see cref="NotSupportedException"/> because it is unused by the writer under test.</summary>
    private sealed class FakeHistorianStore : IHistorianStore
    {
        private readonly object _lock = new();
        private readonly List<HistorianResultRecord> _appendedResults = new();
        private readonly List<HistorianRunEvent> _appendedRunEvents = new();

        public IReadOnlyList<HistorianResultRecord> AppendedResultsSnapshot()
        {
            lock (_lock) return _appendedResults.ToList();
        }

        public IReadOnlyList<HistorianRunEvent> AppendedRunEventsSnapshot()
        {
            lock (_lock) return _appendedRunEvents.ToList();
        }

        public Task AppendResultsAsync(IReadOnlyList<HistorianResultRecord> records, CancellationToken ct)
        {
            lock (_lock) _appendedResults.AddRange(records);
            return Task.CompletedTask;
        }

        public Task AppendRunEventAsync(HistorianRunEvent runEvent, CancellationToken ct)
        {
            lock (_lock) _appendedRunEvents.Add(runEvent);
            return Task.CompletedTask;
        }

        public Task<HistorianResultsPage> QueryResultsAsync(HistorianResultQuery query, CancellationToken ct) =>
            throw new NotSupportedException();

        public Task<IReadOnlyList<HistorianResultRow>> QueryBySerialAsync(string serialNumber, CancellationToken ct, bool includeFabricated = false) =>
            throw new NotSupportedException();

        public Task<IReadOnlyList<TelemetrySamplePoint>> QueryTelemetryAsync(string machineCode, string metric, DateTimeOffset from, DateTimeOffset to, CancellationToken ct) =>
            throw new NotSupportedException();

        public Task<OeeInputAggregate> AggregateForOeeAsync(string machineCode, DateTimeOffset from, DateTimeOffset to, CancellationToken ct, bool includeFabricated = false) =>
            throw new NotSupportedException();

        public Task<IReadOnlyList<HistorianRunEvent>> QueryRunEventsAsync(DateTimeOffset from, DateTimeOffset to, CancellationToken ct) =>
            throw new NotSupportedException();

        public Task<int> PruneOlderThanAsync(DateTimeOffset cutoffUtc, CancellationToken ct) =>
            throw new NotSupportedException();

        public Task<HistorianStats> GetStatsAsync(CancellationToken ct) =>
            throw new NotSupportedException();
    }
}
