using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging.Abstractions;
using St4i.EdgeCore.Config;
using St4i.Connector.Abstractions.Models;
using Xunit;

namespace St4i.EdgeService.Tests;

/// <summary>
/// GP-3 (.superpowers/sdd/2026-07-28-wsg-plugin-connector-seam-blueprint/task-3-brief.md) —
/// <see cref="EdgeWorker.LoadFleet"/>. Before this task, this was the ONE of the three
/// <c>FleetConfig.Load</c> callers (<c>St4i.EngineApi</c>'s <c>FleetHost</c>, <c>St4iMachineSimulator</c>'s
/// <c>FleetService</c>, and this one) with NO <c>catch (FleetConfigException)</c> around the call at
/// all — a genuinely malformed <c>--fleet</c> file would throw straight out of
/// <see cref="EdgeWorker.ExecuteAsync"/>, which by default stops the whole Generic Host. This suite
/// proves the fix directly: a malformed file now falls back to the in-code default fleet exactly like
/// the other two loaders always have, and the (separate, GP-3-added) per-entry tolerance inside
/// <c>FleetConfig.Load</c> itself means one bad MACHINE ENTRY among otherwise-valid ones no longer even
/// reaches that fallback — the valid entries load, and the roster is never silently replaced by the demo
/// default.
///
/// <see cref="EdgeWorker.LoadFleet"/> is <c>internal</c> (not <c>private</c>) specifically so this
/// separate test project can call it directly — same "explicit, testable seam" convention as
/// <see cref="EdgeWorker.BuildTransport"/>/<see cref="EdgeWorker.ResolveGate"/> in
/// <c>EdgeWorkerBuildTransportTests</c>.
/// </summary>
public sealed class EdgeWorkerLoadFleetTests
{
    private static string FreshTempFile() =>
        Path.Combine(Path.GetTempPath(), "st4i-edgeservice-fleet-tests-" + Guid.NewGuid().ToString("N") + ".json");

    private static EdgeWorker NewWorker(string? fleetPath) =>
        new(NullLogger<EdgeWorker>.Instance, new NoOpHostApplicationLifetime(), new EdgeServiceOptions(SmokeCount: null, FleetPath: fleetPath));

    /// <summary>SM-1b (.superpowers/sdd/2026-07-29-dotA-single-machine-sellable-blueprint/task-1b-brief.md)
    /// — overload accepting an explicit demo/product gate, for the product-mode tests below. The
    /// no-gate overload above keeps every pre-existing test's implicit "demo" behavior byte-identical
    /// (see EdgeWorker's own <c>_demoModeGate</c> remarks).</summary>
    private static EdgeWorker NewWorker(string? fleetPath, DemoModeGate? demoModeGate) =>
        new(NullLogger<EdgeWorker>.Instance, new NoOpHostApplicationLifetime(),
            new EdgeServiceOptions(SmokeCount: null, FleetPath: fleetPath), demoModeGate);

    [Fact]
    public void LoadFleet_NoFleetPath_ReturnsTheInCodeDefaultFleet()
    {
        var worker = NewWorker(fleetPath: null);

        var fleet = worker.LoadFleet();

        Assert.Equal(EdgeWorker.BuildDefaultFleet().Select(d => d.Code), fleet.Select(d => d.Code));
    }

    [Fact]
    public void LoadFleet_MalformedJson_FallsBackToTheInCodeDefaultFleet_InsteadOfThrowing()
    {
        // GP-3 fix: before this task, this exact scenario threw FleetConfigException straight out of
        // LoadFleet (no catch existed) — which, called from ExecuteAsync, would have stopped the whole
        // Generic Host. It must now behave exactly like FleetHost.LoadFleet/FleetService.LoadFleet always
        // have: fall back to the in-code default, never throw.
        var path = FreshTempFile();
        File.WriteAllText(path, "{ this is not [ valid json");
        try
        {
            var worker = NewWorker(path);

            var fleet = worker.LoadFleet();

            Assert.Equal(EdgeWorker.BuildDefaultFleet().Select(d => d.Code), fleet.Select(d => d.Code));
        }
        finally
        {
            File.Delete(path);
        }
    }

    [Fact]
    public void LoadFleet_OneMalformedEntryAmongValidOnes_LoadsTheValidEntries_RosterNotReplacedByDefault()
    {
        // The load-bearing scenario the brief calls out: an operator's fleet.json has one typo'd entry
        // (an unrecognized deviceClass — GP-3 already made an unrecognized driverKind a non-error, so
        // deviceClass is what still exercises the per-entry catch inside FleetConfig.Load) among several
        // valid ones. The valid entries must load, using distinctive codes that do NOT appear anywhere in
        // BuildDefaultFleet's own roster, so a passing "count > 0" assertion can't be accidentally
        // satisfied by the demo fallback instead of the operator's real (partial) roster.
        var path = FreshTempFile();
        File.WriteAllText(path, """
        [
          { "code": "CUSTOM-01", "serialSeed": "C1", "deviceClass": "Automation", "machineType": "screwdriver",
            "stepType": "screw_tightening", "driverKind": "Simulated", "recipeCode": null,
            "mappingProfile": null, "cycleSeconds": 1.0 },
          { "code": "CUSTOM-BAD", "serialSeed": "CB", "deviceClass": "NotARealDeviceClass", "machineType": "bad",
            "stepType": null, "driverKind": "Simulated", "recipeCode": null,
            "mappingProfile": null, "cycleSeconds": 1.0 },
          { "code": "CUSTOM-02", "serialSeed": "C2", "deviceClass": "Iot", "machineType": "sensor",
            "stepType": null, "driverKind": "Mqtt", "recipeCode": null,
            "mappingProfile": null, "cycleSeconds": 1.0 }
        ]
        """);
        try
        {
            var worker = NewWorker(path);

            var fleet = worker.LoadFleet();

            Assert.Equal(new[] { "CUSTOM-01", "CUSTOM-02" }, fleet.Select(d => d.Code));
            Assert.DoesNotContain(fleet, d => EdgeWorker.BuildDefaultFleet().Select(def => def.Code).Contains(d.Code));
            Assert.Equal(DriverKinds.Mqtt, fleet.Single(d => d.Code == "CUSTOM-02").DriverKind);
        }
        finally
        {
            File.Delete(path);
        }
    }

    // ── SM-1b: product mode never fabricates machines ──────────────────────────────────────────────

    [Fact]
    public void LoadFleet_ProductMode_NoFleetPath_ReturnsEmptyRoster_NoFabricatedMachine()
    {
        var worker = NewWorker(fleetPath: null, demoModeGate: new DemoModeGate("false"));

        var fleet = worker.LoadFleet();

        Assert.Empty(fleet);
    }

    [Fact]
    public void LoadFleet_ProductMode_FleetPathDoesNotExist_ReturnsEmptyRoster_NoFabricatedMachine()
    {
        var missingPath = Path.Combine(Path.GetTempPath(), "st4i-edgeservice-does-not-exist-" + Guid.NewGuid().ToString("N") + ".json");
        var worker = NewWorker(missingPath, demoModeGate: new DemoModeGate("false"));

        var fleet = worker.LoadFleet();

        Assert.Empty(fleet);
    }

    [Fact]
    public void LoadFleet_ProductMode_MalformedJson_ReturnsEmptyRoster_NoFabricatedMachine()
    {
        var path = FreshTempFile();
        File.WriteAllText(path, "{ this is not [ valid json");
        try
        {
            var worker = NewWorker(path, demoModeGate: new DemoModeGate("false"));

            var fleet = worker.LoadFleet();

            Assert.Empty(fleet);
        }
        finally
        {
            File.Delete(path);
        }
    }

    [Fact]
    public void LoadFleet_ProductMode_ValidFleetFileWithEntries_IsHonored_NotIgnored()
    {
        // SM-1b — deliberately DIFFERENT from St4i.EngineApi's FleetHost, which treats a valid fleet.json
        // as demo-only in product mode because it has a second, genuinely-real-machine path
        // (connectors.json + RegisterMachine). EdgeService has no such second path — --fleet is the ONLY
        // roster input this project has — so a real, valid --fleet file must still be honored in product
        // mode, or a product deployment could never run any machine at all. Only the FABRICATION
        // fallback (blank/missing/malformed/empty) is gated by demo mode; real content never is.
        var path = FreshTempFile();
        File.WriteAllText(path, """
        [
          { "code": "REAL-01", "serialSeed": "R1", "deviceClass": "Automation", "machineType": "screwdriver",
            "stepType": "screw_tightening", "driverKind": "Simulated", "recipeCode": null,
            "mappingProfile": null, "cycleSeconds": 1.0 }
        ]
        """);
        try
        {
            var worker = NewWorker(path, demoModeGate: new DemoModeGate("false"));

            var fleet = worker.LoadFleet();

            Assert.Equal(new[] { "REAL-01" }, fleet.Select(d => d.Code));
        }
        finally
        {
            File.Delete(path);
        }
    }

    [Fact]
    public void LoadFleet_ProductMode_ValidFleetFileWithZeroEntries_ReturnsEmptyRoster()
    {
        var path = FreshTempFile();
        File.WriteAllText(path, "[]");
        try
        {
            var worker = NewWorker(path, demoModeGate: new DemoModeGate("false"));

            var fleet = worker.LoadFleet();

            Assert.Empty(fleet);
        }
        finally
        {
            File.Delete(path);
        }
    }

    // ── SM-1b: demo mode stays byte-identical — strict regression, exact codes in file order ───────

    [Fact]
    public void LoadFleet_DemoModeExplicit_NoFleetPath_ReturnsExactlyTheEightFabricatedMachines_InFileOrder()
    {
        var worker = NewWorker(fleetPath: null, demoModeGate: new DemoModeGate("true"));

        var fleet = worker.LoadFleet();

        Assert.Equal(
            new[] { "SCRW-01", "DISP-01", "WELD-01", "ASSY-01", "LEAK-01", "FCT-01", "IOT-01", "AOI-01" },
            fleet.Select(d => d.Code));
    }

    [Fact]
    public void LoadFleet_DemoModeNullGate_NoFleetPath_ReturnsExactlyTheEightFabricatedMachines_InFileOrder()
    {
        // Same assertion as LoadFleet_NoFleetPath_ReturnsTheInCodeDefaultFleet above, but pinned against
        // the literal codes (not BuildDefaultFleet() itself) so a future accidental change to
        // BuildDefaultFleet can't silently satisfy a tautological comparison.
        var worker = NewWorker(fleetPath: null);

        var fleet = worker.LoadFleet();

        Assert.Equal(
            new[] { "SCRW-01", "DISP-01", "WELD-01", "ASSY-01", "LEAK-01", "FCT-01", "IOT-01", "AOI-01" },
            fleet.Select(d => d.Code));
    }

    [Fact]
    public void LoadFleet_DemoMode_MalformedJson_StillFallsBackToTheInCodeDefaultFleet()
    {
        var path = FreshTempFile();
        File.WriteAllText(path, "{ this is not [ valid json");
        try
        {
            var worker = NewWorker(path, demoModeGate: new DemoModeGate("true"));

            var fleet = worker.LoadFleet();

            Assert.Equal(
                new[] { "SCRW-01", "DISP-01", "WELD-01", "ASSY-01", "LEAK-01", "FCT-01", "IOT-01", "AOI-01" },
                fleet.Select(d => d.Code));
        }
        finally
        {
            File.Delete(path);
        }
    }

    // ── Fix round 1 (review, Critical): a validly-parsed-to-zero --fleet file must NOT fabricate ────
    // machines in demo mode either — pre-SM-1b, LoadFleet had no Count>0 check at all and simply
    // returned FleetConfig.Load's result directly, so this exact case already yielded an empty roster
    // before this task existed. The first cut of the SM-1b fix wrongly routed it through the same
    // fallback as a missing/malformed file, regressing demo mode's byte-identical contract.

    [Fact]
    public void LoadFleet_DemoModeExplicit_ValidFleetFileWithZeroEntries_ReturnsEmptyRoster_NotFabricated()
    {
        var path = FreshTempFile();
        File.WriteAllText(path, "[]");
        try
        {
            var worker = NewWorker(path, demoModeGate: new DemoModeGate("true"));

            var fleet = worker.LoadFleet();

            Assert.Empty(fleet);
        }
        finally
        {
            File.Delete(path);
        }
    }

    [Fact]
    public void LoadFleet_DemoModeNullGate_ValidFleetFileWithZeroEntries_ReturnsEmptyRoster_NotFabricated()
    {
        // Same scenario as above but with the implicit null gate (every pre-existing call site's
        // default) — the exact combination the review's reflection-harness repro used to demonstrate
        // the regression against the built DLL.
        var path = FreshTempFile();
        File.WriteAllText(path, "[]");
        try
        {
            var worker = NewWorker(path); // null gate = demo

            var fleet = worker.LoadFleet();

            Assert.Empty(fleet);
        }
        finally
        {
            File.Delete(path);
        }
    }

    [Fact]
    public void LoadFleet_DemoMode_JsonNullRoot_ReturnsEmptyRoster_NotFabricated()
    {
        // FleetConfig.Load's own documented legacy behavior: a literal JSON `null` root parses to an
        // empty list without throwing (preserved for backward compatibility with the old
        // JsonSerializer.Deserialize-based implementation) — another real, reachable "parses fine to
        // zero entries" input distinct from "[]".
        var path = FreshTempFile();
        File.WriteAllText(path, "null");
        try
        {
            var worker = NewWorker(path, demoModeGate: new DemoModeGate("true"));

            var fleet = worker.LoadFleet();

            Assert.Empty(fleet);
        }
        finally
        {
            File.Delete(path);
        }
    }

    /// <summary>Minimal no-op <see cref="IHostApplicationLifetime"/> — <see cref="EdgeWorker.LoadFleet"/>
    /// never calls any of these members, but constructing an <see cref="EdgeWorker"/> at all requires one.</summary>
    private sealed class NoOpHostApplicationLifetime : IHostApplicationLifetime
    {
        public CancellationToken ApplicationStarted => CancellationToken.None;
        public CancellationToken ApplicationStopping => CancellationToken.None;
        public CancellationToken ApplicationStopped => CancellationToken.None;
        public void StopApplication() { }
    }
}
