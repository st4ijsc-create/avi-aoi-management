using St4i.EdgeCore.Historian;
using St4i.EdgeCore.Infrastructure;
using St4i.EdgeCore.Models;
using St4i.EdgeCore.Transport;
using St4i.EngineApi.Fleet;
using Xunit;

namespace St4i.EngineApi.Tests;

/// <summary>
/// Task 7 (WS-A) — proves the historian hook wired into <see cref="FleetHost"/> is genuinely ADDITIVE:
/// committed readings and Start/Stop run-state transitions reach a real <see cref="HistorianWriter"/> over
/// a fake <see cref="IHistorianStore"/> ALONGSIDE (not instead of) the existing in-memory
/// <see cref="MachineState"/> path every other <c>FleetHost*Tests</c> file already exercises. This file
/// never touches an existing FleetHost test — every pre-existing ctor call (no <c>historianWriter</c> arg)
/// must keep compiling/behaving unchanged, which <see cref="FleetHostHealthAndRegistrationTests.CreateHost"/>
/// (constructing <see cref="FleetHost"/> with no <c>historianWriter</c> at all) already guards.
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

    private static MachineDescriptor NewFastMachine(string code) => new(
        code, $"SN-{code}", DeviceClass.Automation, "SCREWDRIVE", "screw_tightening",
        DriverKind.Simulated, "RC-TEST-A", null, CycleSeconds: 0.1);

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

            // And a "Start" run event.
            await WaitUntilAsync(
                () => store.AppendedRunEventsSnapshot().Any(e => e.EventType == "Start"),
                "the historian to receive a 'Start' run event");

            host.Stop();

            await WaitUntilAsync(
                () => store.AppendedRunEventsSnapshot().Any(e => e.EventType == "Stop"),
                "the historian to receive a 'Stop' run event after Stop()");
        }
        finally
        {
            host.Stop();
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

        public Task<IReadOnlyList<HistorianResultRow>> QueryBySerialAsync(string serialNumber, CancellationToken ct) =>
            throw new NotSupportedException();

        public Task<IReadOnlyList<TelemetrySamplePoint>> QueryTelemetryAsync(string machineCode, string metric, DateTimeOffset from, DateTimeOffset to, CancellationToken ct) =>
            throw new NotSupportedException();

        public Task<OeeInputAggregate> AggregateForOeeAsync(string machineCode, DateTimeOffset from, DateTimeOffset to, CancellationToken ct) =>
            throw new NotSupportedException();

        public Task<IReadOnlyList<HistorianRunEvent>> QueryRunEventsAsync(DateTimeOffset from, DateTimeOffset to, CancellationToken ct) =>
            throw new NotSupportedException();

        public Task<int> PruneOlderThanAsync(DateTimeOffset cutoffUtc, CancellationToken ct) =>
            throw new NotSupportedException();

        public Task<HistorianStats> GetStatsAsync(CancellationToken ct) =>
            throw new NotSupportedException();
    }
}
