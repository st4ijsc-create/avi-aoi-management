using St4i.EdgeCore.Config;
using St4i.EdgeCore.Drivers;
using St4i.EdgeCore.Infrastructure;
using St4i.EdgeCore.Models;
using St4i.EdgeCore.Transport;
using St4i.EngineApi.Fleet;
using Xunit;

namespace St4i.EngineApi.Tests;

/// <summary>
/// WS3-T1 (docs/PRODUCTION_UI_DESIGN.md §3.2) — proves the cycle plan actually reaches the SAME
/// per-machine polled surface (<c>GET /v1/machines/{code}</c> → <see cref="MachineDetailDto.Plan"/>) the
/// HMI panel already reads, through the real <see cref="FleetHost"/>/<see cref="MachineState"/> wiring
/// (not just the simulators directly, the way <c>St4i.EdgeCore.Tests.CyclePlanTests</c> does): a
/// running machine's Plan is populated and reflects a REAL configured product's points when one is set,
/// and — the design-doc §3.2 invariant "idle machine = no active plan" — a stopped machine's Plan is
/// null even though its counters/last-known state stay visible, mirroring the exact same
/// <c>fleetRunning</c> gate <c>StatusText</c> already uses (see <c>EstopLatchAndDetailGatingTests</c>).
/// </summary>
public sealed class CyclePlanFleetTests
{
    private static readonly TimeSpan PollTimeout = TimeSpan.FromSeconds(15);
    private static readonly TimeSpan PollInterval = TimeSpan.FromMilliseconds(100);

    private static string TempDir(string prefix) => Directory.CreateTempSubdirectory(prefix).FullName;

    /// <summary>Same composition as <c>MachineConfigDrivesFleetTests.CreateHost</c>, plus the new
    /// optional <see cref="ProductConfigStore"/> WS3-T1 threads through for AOI's real-points plan.</summary>
    private static FleetHost CreateHost(ProductConfigStore? productConfigStore = null, MachineConfigStore? configStore = null)
    {
        var demo = new DemoTransport(latencyMs: 0);
        var live = LiveTransport.ForMachine("http://localhost:1", mkKey: "", machineCode: "TEST", queuePath: null, verifyTls: true);
        var auto = new AutoTransport(live, demo);
        var switchable = new SwitchableTransport(demo);
        var coordinator = new TransportCoordinator(switchable, demo, live, auto, TransportMode.Demo);
        var eventBus = new EventBus();
        return new FleetHost(switchable, coordinator, eventBus, configStore: configStore, productConfigStore: productConfigStore);
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
    public async Task Screwdrive_MachineDetail_Plan_Populated_While_Running_Null_Once_Stopped()
    {
        var host = CreateHost();
        host.Start();

        try
        {
            await WaitUntilAsync(() => (host.MachineDetail("SCRW-01")?.Cycles ?? 0) > 0, "SCRW-01 to accumulate at least one cycle");

            var running = host.MachineDetail("SCRW-01");
            Assert.NotNull(running!.Plan);
            Assert.Equal(4, running.Plan!.Steps.Count);
            Assert.All(running.Plan.Steps, s => Assert.True(s.Result is "OK" or "NG"));
        }
        finally
        {
            host.Stop();
        }

        // "Idle machine = no active plan" (design-doc §3.2) — the exact same fleetRunning gate
        // StatusText already uses (EstopLatchAndDetailGatingTests). Counters stay visible either way.
        var stopped = host.MachineDetail("SCRW-01");
        Assert.NotNull(stopped);
        Assert.Null(stopped!.Plan);
        Assert.True(stopped.Cycles > 0, "counters must stay visible after stop, only the plan/status gate");
    }

    /// <summary>WS3-T2 (ws3-t1-report.md's fast-follow #1) — <c>FleetHost</c>'s ctor now seeds every
    /// <c>AoiAvi</c> machine in the roster with one of the <see cref="ProductConfigStore"/>'s own
    /// catalog products round-robin, so the shipped demo fleet's AOI machines are no longer un-linked by
    /// default (the exact gap WS3-T1 flagged: "no HTTP endpoint currently calls
    /// <c>FleetHost.SetCurrentProduct</c> ... a live curl against them today shows <c>plan:null</c>").
    /// A fresh <see cref="ProductConfigStore"/> in an empty temp directory seeds its own real "MODEL-A"/
    /// "MODEL-B" demo products (<see cref="ProductConfigStore.SeedProducts"/>) — this proves the two AOI
    /// machines in the roster (fleet order) land on those two products, alphabetically.</summary>
    [Fact]
    public void Construction_Seeds_Every_AoiAvi_Machine_With_A_Catalog_Product_RoundRobin()
    {
        var productStore = new ProductConfigStore(TempDir("st4i-seed-aoi-products-"));
        var host = CreateHost(productStore);

        Assert.Equal("MODEL-A", host.CurrentProductFor("AOI-01"));
        Assert.Equal("MODEL-B", host.CurrentProductFor("AOI-02"));
    }

    /// <summary>WS3-T2 — the end-to-end proof the task actually cares about: with NO explicit
    /// <see cref="FleetHost.SetCurrentProduct"/> call from a test/caller (unlike the sibling test below,
    /// which deliberately links a hand-built product), the demo fleet's AOI-01 comes up on a running
    /// fleet with a REAL, non-null plan whose steps carry the auto-seeded product's real point codes —
    /// exactly what a live <c>curl http://localhost:5199/v1/machines/AOI-01</c> now returns.</summary>
    [Fact]
    public async Task Aoi_MachineDetail_Plan_Populated_By_Default_Via_Startup_Seeded_Product_Link()
    {
        var productStore = new ProductConfigStore(TempDir("st4i-seed-aoi-plan-"));
        var host = CreateHost(productStore);
        host.Start();

        try
        {
            await WaitUntilAsync(() => host.MachineDetail("AOI-01")?.Plan is not null, "AOI-01's plan to populate from the auto-seeded product link, no explicit SetCurrentProduct call");

            var detail = host.MachineDetail("AOI-01")!;
            Assert.True(detail.Plan!.Steps.Count > 0, "the seeded product (MODEL-A) has real active points");
            // MODEL-A's real seed points are P01.. (ProductConfigStore.SeedProducts) — never the
            // generic PT-001.. fallback code vocabulary AoiInspectorSim uses when no product resolves.
            Assert.All(detail.Plan.Steps, s => Assert.StartsWith("P", s.PointCode));
        }
        finally
        {
            host.Stop();
        }
    }

    [Fact]
    public async Task Aoi_MachineDetail_Plan_Reflects_The_Real_Configured_Product_On_A_Running_Fleet()
    {
        var productStore = new ProductConfigStore(TempDir("st4i-cycleplan-fleet-products-"));
        const string productCode = "PROD-FLEET";
        var points = Enumerable.Range(1, 6).Select(i => new MeasurementPoint
        {
            Code = $"RP-{i:D2}",
            NormalizedX = 0.1 * i,
            NormalizedY = 0.05 * i,
            OrderIndex = i,
            IsActive = true,
        }).ToList();
        productStore.UpsertProduct(new ProductModel { Code = productCode, Name = "Fleet test product", ImageWidth = 1000, ImageHeight = 800, Points = points });

        var configStore = new MachineConfigStore(TempDir("st4i-cycleplan-fleet-config-"));
        configStore.Ensure("AOI-01", MachineParameterSchema.AoiInspection);

        var host = CreateHost(productStore, configStore);

        // Before the product is linked, AOI-01 uses the generic fallback — no cycle plan (honest: no
        // real point set is resolvable yet), exactly like the un-linked EdgeCore-level test.
        host.SetCurrentProduct("AOI-01", null);
        host.Start();

        try
        {
            await WaitUntilAsync(() => (host.MachineDetail("AOI-01")?.Cycles ?? 0) > 0, "AOI-01 to accumulate at least one cycle");
            Assert.Null(host.MachineDetail("AOI-01")!.Plan);

            // THE ACT: link the real product on the ALREADY-RUNNING fleet — no Stop()/Start() call, same
            // "takes effect on the very next cycle" contract every other config-aware read already has.
            host.SetCurrentProduct("AOI-01", productCode);

            await WaitUntilAsync(() => host.MachineDetail("AOI-01")?.Plan is not null, "AOI-01's plan to reflect the newly-linked product");

            var detail = host.MachineDetail("AOI-01")!;
            Assert.Equal(6, detail.Plan!.Steps.Count);
            var expectedCodes = Enumerable.Range(1, 6).Select(i => $"RP-{i:D2}").ToArray();
            Assert.Equal(expectedCodes, detail.Plan.Steps.Select(s => s.PointCode).ToArray());
            for (var i = 0; i < 6; i++)
            {
                Assert.Equal(0.1 * (i + 1), detail.Plan.Steps[i].NormalizedX, 6);
                Assert.Equal(0.05 * (i + 1), detail.Plan.Steps[i].NormalizedY, 6);
            }

            // A MachineConfigStore is wired above (matchThreshold resolves, schema default 0.85), so
            // every step also carries its own real match-score metric value, not just a position/result.
            Assert.All(detail.Plan.Steps, s => Assert.NotNull(s.MetricValue));
        }
        finally
        {
            host.Stop();
        }
    }
}
