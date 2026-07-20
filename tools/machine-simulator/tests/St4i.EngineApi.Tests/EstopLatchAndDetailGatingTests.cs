using St4i.EdgeCore.Drivers;
using St4i.EdgeCore.Infrastructure;
using St4i.EdgeCore.Models;
using St4i.EdgeCore.Transport;
using St4i.EngineApi.Fleet;
using Xunit;

namespace St4i.EngineApi.Tests;

/// <summary>
/// Branch-review C-2/C-3/I-9 — proves the E-STOP latch is now a real engine-owned, confirmed
/// transition (not client React state a second panel/reload could silently forget), and that
/// <see cref="FleetHost.MachineDetail"/> is gated by the fleet's running state exactly like
/// <see cref="FleetHost.Snapshot"/> already gates <c>ToTile</c> — the specific bug reproduced live by
/// the review: a stopped machine's <c>GET /v1/machines/{code}</c> kept reporting its last real verdict
/// (e.g. "OK") while <c>GET /v1/fleet</c> correctly reported the machine idle.
/// </summary>
public sealed class EstopLatchAndDetailGatingTests
{
    private static readonly TimeSpan PollTimeout = TimeSpan.FromSeconds(10);
    private static readonly TimeSpan PollInterval = TimeSpan.FromMilliseconds(100);

    /// <summary>Same composition as <c>FleetHostHealthAndRegistrationTests.CreateHost</c> — default
    /// Demo mode, no real network call.</summary>
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

    [Fact]
    public async Task Estop_StopsFleetForReal_AndLatchesEstopEngagedOnEverySnapshot()
    {
        var host = CreateHost();

        host.Start();
        await WaitUntilAsync(() => host.Snapshot().Kpis.Online > 0, "fleet online before E-STOP");

        Assert.False(host.Snapshot().EstopEngaged);

        host.Estop();

        // A real stop, not a cosmetic flag — Estop() itself is the confirmation (C-3).
        Assert.False(host.IsRunning);
        var snapshot = host.Snapshot();
        Assert.False(snapshot.IsRunning);
        Assert.True(snapshot.EstopEngaged);
        Assert.True(host.EstopEngaged);
    }

    [Fact]
    public async Task Estop_ThenStart_IsRefusedByTheEngineWhileLatched()
    {
        var host = CreateHost();
        host.Start();
        await WaitUntilAsync(() => host.Snapshot().Kpis.Online > 0, "fleet online before E-STOP");

        host.Estop();
        Assert.False(host.IsRunning);

        // Defense in depth: even if a stale client (or a second panel that never saw the latch) calls
        // Start directly, the engine itself must refuse while EstopEngaged — this is the server-side
        // half of C-2 ("a second panel can restart a fleet that is latched-out").
        host.Start();
        Assert.False(host.IsRunning, "Start() must be a no-op while EstopEngaged, regardless of caller");
        Assert.True(host.EstopEngaged);
    }

    [Fact]
    public async Task ResetEstop_ClearsTheLatch_ButDoesNotAutoRestartTheFleet()
    {
        var host = CreateHost();
        host.Start();
        await WaitUntilAsync(() => host.Snapshot().Kpis.Online > 0, "fleet online before E-STOP");

        host.Estop();
        Assert.True(host.EstopEngaged);

        host.ResetEstop();

        Assert.False(host.EstopEngaged);
        Assert.False(host.Snapshot().EstopEngaged);
        // Honest, explicit design (spec/C-2): RESET clears the fault but an operator must press START
        // again — it must not silently resume production.
        Assert.False(host.IsRunning, "ResetEstop must not itself restart the fleet");

        // And Start() genuinely works again now that the latch is clear.
        host.Start();
        try
        {
            Assert.True(host.IsRunning);
        }
        finally
        {
            host.Stop();
        }
    }

    [Fact]
    public async Task MachineDetail_AfterStop_ReportsIdle_EvenThoughLastRealVerdictWasNotIdle()
    {
        var host = CreateHost();
        host.Start();

        try
        {
            await WaitUntilAsync(
                () => (host.MachineDetail("SCRW-01")?.Cycles ?? 0) > 0 && host.MachineDetail("SCRW-01")!.StatusText != "Idle",
                "SCRW-01 to report a real (non-idle) verdict while running");
        }
        finally
        {
            host.Stop();
        }

        // I-9 — the live-reproduced bug: GET /v1/machines/{code} (MachineDetail) kept echoing the last
        // real verdict (e.g. "OK") after Stop() even though GET /v1/fleet (ToTile) correctly forced
        // "Idle". Both must now agree.
        var afterStop = host.MachineDetail("SCRW-01");
        Assert.NotNull(afterStop);
        Assert.Equal("Idle", afterStop!.StatusText);
        Assert.True(afterStop.Cycles > 0, "counters must stay visible after stop, only the status gates");

        var snapshotTile = host.Snapshot().Machines.Single(m => m.Code == "SCRW-01");
        Assert.Equal("Idle", snapshotTile.StatusText);
    }
}
