using St4i.EdgeCore.Infrastructure;
using St4i.EdgeCore.Models;
using St4i.Connector.Abstractions.Models;
using St4i.EdgeCore.Transport;
using St4i.EdgeCore.Uns;
using St4i.EngineApi.Fleet;
using Xunit;

namespace St4i.EngineApi.Tests;

/// <summary>
/// G2-3 (WS-B Phase B1) — proves the WIRING (not the born-guard/pairing semantics, which
/// <c>St4i.EdgeCore.Tests.Uns.UnsNodeLifecycleTests</c> already covers against a real publisher/broker):
/// <see cref="FleetHost.Start"/>/<see cref="FleetHost.Stop"/>/<see cref="FleetHost.Estop"/>/
/// <see cref="FleetHost.ResetEstop"/> call <see cref="IUnsPublisher.PublishNodeBirth"/>/
/// <see cref="IUnsPublisher.PublishNodeDeath"/> at exactly the same guarded, real-transition sites as the
/// existing historian run-events (see <c>FleetHostHistorianWiringTests</c>) — via a fake
/// <see cref="IUnsPublisher"/> injected through FleetHost's now-<see cref="IUnsPublisher"/>-typed optional
/// ctor param, so this file needs no real MQTT broker at all.
/// </summary>
public sealed class FleetHostUnsLifecycleTests
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

    /// <summary>Same composition as <c>FleetHostHealthAndRegistrationTests.CreateHost</c> (Demo mode, no
    /// real network) PLUS a fake <see cref="IUnsPublisher"/> threaded into the new optional ctor param.</summary>
    private static (FleetHost Host, FakeUnsPublisher Publisher) CreateHostWithUns()
    {
        var demo = new DemoTransport(latencyMs: 0);
        var live = LiveTransport.ForMachine("http://localhost:1", mkKey: "", machineCode: "TEST", queuePath: null, verifyTls: true);
        var auto = new AutoTransport(live, demo);
        var switchable = new SwitchableTransport(demo);
        var coordinator = new TransportCoordinator(switchable, demo, live, auto, TransportMode.Demo);
        var eventBus = new EventBus();

        var publisher = new FakeUnsPublisher();
        var host = new FleetHost(switchable, coordinator, eventBus, unsPublisher: publisher);
        return (host, publisher);
    }

    [Fact]
    public async Task Start_OnStoppedFleet_PublishesNodeBirthOnce_AndSecondStartOnRunningFleetDoesNotDuplicate()
    {
        var (host, publisher) = CreateHostWithUns();
        try
        {
            host.Start();
            await WaitUntilAsync(() => host.Snapshot().Kpis.Online > 0, "fleet online after Start");
            await WaitUntilAsync(() => publisher.NodeBirthCount == 1, "exactly one node birth published on Start");

            // FleetHost calls PublishNodeBirth synchronously, in-line, still inside its own _gate (review
            // fix) — so by the time this second Start() returns, the fake's counter already reflects
            // whether it fired again. No wait needed to prove "no second birth": assert directly.
            host.Start(); // already running — StartLocked no-ops, so no second birth

            Assert.Equal(1, publisher.NodeBirthCount);
            Assert.Equal(0, publisher.NodeDeathCount);
        }
        finally
        {
            host.Stop();
        }
    }

    [Fact]
    public async Task Stop_OnRunningFleet_PublishesNodeDeathOnce_AndSecondStopOnStoppedFleetDoesNotDuplicate()
    {
        var (host, publisher) = CreateHostWithUns();

        // 🔴 backlog-test-deadlines — both `WaitUntilAsync` calls above the first `host.Stop()` assert on
        // their deadline, and this test's only teardown was that Stop(). A red wait therefore left the fleet
        // running for the rest of the process. Two siblings in this same file already used try/finally.
        host.Start();
        try
        {
            await WaitUntilAsync(() => host.Snapshot().Kpis.Online > 0, "fleet online after Start");
            await WaitUntilAsync(() => publisher.NodeBirthCount == 1, "node birth published on Start");

            host.Stop();
            await WaitUntilAsync(() => publisher.NodeDeathCount == 1, "exactly one node death published on Stop");

            // Same synchronous, in-line, still-under-_gate call as Start()'s — no wait needed to prove "no
            // second death": assert directly.
            host.Stop(); // already stopped — StopLocked no-ops, so no second death

            Assert.Equal(1, publisher.NodeDeathCount);
        }
        finally
        {
            host.Stop();
        }
    }

    [Fact]
    public async Task Estop_OnRunningFleet_PublishesNodeDeathOnce()
    {
        var (host, publisher) = CreateHostWithUns();
        try
        {
            host.Start();
            await WaitUntilAsync(() => host.Snapshot().Kpis.Online > 0, "fleet online after Start");
            await WaitUntilAsync(() => publisher.NodeBirthCount == 1, "node birth published on Start");

            host.Estop();
            await WaitUntilAsync(() => publisher.NodeDeathCount == 1, "exactly one node death published on Estop");

            Assert.Equal(1, publisher.NodeDeathCount);
        }
        finally
        {
            host.ResetEstop();
            host.Stop();
        }
    }

    [Fact]
    public void ResetEstop_DoesNotPublishNodeBirthOrNodeDeath()
    {
        var (host, publisher) = CreateHostWithUns();

        host.ResetEstop();

        Assert.Equal(0, publisher.NodeBirthCount);
        Assert.Equal(0, publisher.NodeDeathCount);
    }

    /// <summary>Minimal fake of <see cref="IUnsPublisher"/> — only counts calls; never touches a network.</summary>
    private sealed class FakeUnsPublisher : IUnsPublisher
    {
        private int _nodeBirths;
        private int _nodeDeaths;
        private int _readings;

        public int NodeBirthCount => Volatile.Read(ref _nodeBirths);

        public int NodeDeathCount => Volatile.Read(ref _nodeDeaths);

        public int ReadingCount => Volatile.Read(ref _readings);

        public void PublishReading(DeviceReading reading, CanonicalEnvelope envelope) => Interlocked.Increment(ref _readings);

        public void PublishBirth(string equipmentCode)
        {
        }

        public void PublishDeath(string equipmentCode)
        {
        }

        public void PublishNodeBirth() => Interlocked.Increment(ref _nodeBirths);

        public void PublishNodeDeath() => Interlocked.Increment(ref _nodeDeaths);

        public void PublishLineState(string state)
        {
        }
    }
}
