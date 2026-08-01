using St4i.EdgeCore.Config;
using St4i.EdgeCore.Drivers;
using St4i.EdgeCore.Engine;
using St4i.EdgeCore.Infrastructure;
using St4i.EdgeCore.Models;
using St4i.Connector.Abstractions.Models;
using St4i.EdgeCore.Transport;
using St4i.EngineApi.Fleet;
using Xunit;

namespace St4i.EngineApi.Tests;

/// <summary>
/// Task 3 (docs/plans/2026-07-21-machine-config.md) — proves the "already-running fleet" half of the
/// task brief that <c>St4i.EdgeCore.Tests.MachineConfigDrivesSimulationTests</c> can't reach on its own
/// (that file drives simulators directly, with no <see cref="FleetHost"/>/pipeline in the loop):
/// mutating a live <see cref="MachineConfigStore"/> while <see cref="FleetHost"/> is running, with NO
/// call to <see cref="FleetHost.Stop"/>/<see cref="FleetHost.Start"/> in between, changes what the
/// pipeline actually commits — the same guarantee <c>ScenarioAwareDriver</c> already gives a scenario
/// slider, now extended to machine operating-configuration.
/// </summary>
public sealed class MachineConfigDrivesFleetTests
{
    private static readonly TimeSpan PollTimeout = TimeSpan.FromSeconds(60);
    private static readonly TimeSpan PollInterval = TimeSpan.FromMilliseconds(100);

    private static string TempDir() => Directory.CreateTempSubdirectory("st4i-fleet-config-tests-").FullName;

    /// <summary>Same composition FleetHost's own DI wiring in Program.cs uses, minus the ASP.NET host —
    /// default mode is Demo, so no real network call is ever made by this test. Mirrors
    /// <c>FleetHostHealthAndRegistrationTests.CreateHost</c>, plus the new optional
    /// <see cref="MachineConfigStore"/> parameter Task 3 added to <see cref="FleetHost"/>'s
    /// constructor.</summary>
    private static FleetHost CreateHost(MachineConfigStore store)
    {
        var demo = new DemoTransport(latencyMs: 0);
        var live = LiveTransport.ForMachine("http://localhost:1", mkKey: "", machineCode: "TEST", queuePath: null, verifyTls: true);
        var auto = new AutoTransport(live, demo);
        var switchable = new SwitchableTransport(demo);
        var coordinator = new TransportCoordinator(switchable, demo, live, auto, TransportMode.Demo);
        var eventBus = new EventBus();
        return new FleetHost(switchable, coordinator, eventBus, configStore: store);
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
    public async Task SetAdjustment_on_an_already_running_fleet_shifts_torque_output_with_no_restart()
    {
        var store = new MachineConfigStore(TempDir());
        var host = CreateHost(store);
        const string code = "SCRW-LIVE-01";

        var registered = host.RegisterMachine(new MachineDescriptor(
            code, "SN-LIVE", DeviceClass.Automation, "SCREWDRIVE", "screw_tightening",
            DriverKinds.Simulated, "RC-LIVE", null, CycleSeconds: 1.0));
        Assert.True(registered);

        host.Start();
        try
        {
            await WaitUntilAsync(() => (host.MachineDetail(code)?.Cycles ?? 0) >= 8, $"{code} to accumulate a baseline sample of cycles");
            var baselineMean = host.MachineDetail(code)!.Spc.Mean;

            // Baseline torqueTarget (schema default 1.35 Nm) should keep the mean well below 3 — a loose
            // sanity check before proving the live shift below.
            Assert.True(baselineMean < 3.0, $"baseline torque mean should reflect the schema-default torqueTarget (1.35), got {baselineMean}");

            var cyclesAtAdjustment = host.MachineDetail(code)!.Cycles;

            // THE ACT: mutate the SAME store the running pipeline's simulators resolve against — no
            // Stop()/Start() call anywhere in this test.
            store.SetAdjustment(code, "torqueTarget", 10.0, AdjustmentScope.Machine, null, "test", "live shift while running");

            Assert.True(host.IsRunning, "a settings write must never itself stop/restart the fleet pipeline");

            await WaitUntilAsync(
                () => (host.MachineDetail(code)?.Cycles ?? 0) >= cyclesAtAdjustment + 15,
                $"{code} to accumulate cycles after the live adjustment");
            Assert.True(host.IsRunning, "the fleet must still be running after accumulating post-adjustment cycles — this test never restarts it");

            var afterMean = host.MachineDetail(code)!.Spc.Mean;

            // The SPC buffer (cap 50) may still contain some pre-adjustment values, so this isn't
            // asserting convergence to exactly 10.0 — only that the mean has clearly, causally moved
            // toward the new torqueTarget with the pipeline never having been stopped/restarted.
            Assert.True(afterMean > baselineMean + 2.0,
                $"torque mean must shift toward the new live torqueTarget without any restart: baseline={baselineMean}, after={afterMean}");
        }
        finally
        {
            host.Stop();
        }
    }

    /// <summary>I-5 (mc-feature-review.md) — before this fix, a scenario's <c>CycleRateMultiplier</c> and a
    /// config-store cadence override fought instead of composing: the config override (present for
    /// SCREWDRIVE/IOT the instant a <see cref="MachineConfigStore"/> is wired, which production always
    /// is) always won outright, so a scenario like <c>sensor-drift</c> (5x, whose entire purpose is
    /// accelerating IOT_SENSOR) had ZERO effect once this test's own IOT machine had a config override in
    /// play. This is the "already-running fleet" proof <see cref="MachineConfigDrivesSimulationTests"/>
    /// (EdgeCore, no <see cref="FleetHost"/> in the loop) can't reach on its own — SCENARIO ×
    /// CONFIG-OVERRIDE together, through the real <c>FleetHost.StartLocked</c> → <c>SimulatorFactory.Create</c>
    /// wiring, which <see cref="SetAdjustment_on_an_already_running_fleet_shifts_torque_output_with_no_restart"/>
    /// above never exercises (it never sets a scenario).</summary>
    [Fact]
    public async Task Scenario_CycleRateMultiplier_composes_with_a_config_override_cadence_not_swallowed_by_it()
    {
        var store = new MachineConfigStore(TempDir());
        var host = CreateHost(store);
        const string code = "IOT-CFG-SCEN-01";

        var registered = host.RegisterMachine(new MachineDescriptor(
            code, "SN-IOT-SCEN", DeviceClass.Iot, "IOT_SENSOR", "telemetry",
            DriverKinds.Simulated, null, null, CycleSeconds: 5.0)); // deliberately SLOW un-configured/un-scaled descriptor
        Assert.True(registered);

        // Config override: sampleRateHz=2.0Hz -> unscaled cadence = min(1/2.0, 60) = 0.5s.
        store.Ensure(code, MachineParameterSchema.IotSettings);
        store.SetAdjustment(code, "sampleRateHz", 2.0, AdjustmentScope.Machine, null, "test", "faster sampling");

        // Scenario: sensor-drift-shaped 5x multiplier, applied BEFORE Start so StartLocked picks it up
        // immediately (no restart needed — the fleet isn't running yet).
        host.ApplyScenario(new ScenarioConfig(CycleRateMultiplier: 5.0), presetName: "test-sensor-drift");

        host.Start();
        try
        {
            // Composed cadence = 0.5s / 5.0 = 0.1s -> 60 cycles in ~6s. If the multiplier were still being
            // silently swallowed by the config override (the I-5 bug), cadence would stay at the unscaled
            // 0.5s and 60 cycles would need ~30s — a SELF-CONTAINED, short deadline (not the class's shared
            // 60s PollTimeout, which both regimes would clear) so a regression here actually fails fast
            // instead of just passing slower.
            var deadline = DateTime.UtcNow + TimeSpan.FromSeconds(8);
            while (DateTime.UtcNow < deadline && (host.MachineDetail(code)?.Cycles ?? 0) < 60)
            {
                await Task.Delay(TimeSpan.FromMilliseconds(100));
            }

            var cycles = host.MachineDetail(code)?.Cycles ?? 0;
            Assert.True(cycles >= 60,
                $"{code} should reach 60 cycles within 8s at the composed 0.1s cadence (0.5s unscaled ÷ 5x scenario multiplier) — " +
                $"only reached {cycles}. A count well under 60 here means the scenario multiplier is being swallowed by the config override again (I-5).");
            Assert.True(host.IsRunning);
        }
        finally
        {
            host.Stop();
        }
    }
}
