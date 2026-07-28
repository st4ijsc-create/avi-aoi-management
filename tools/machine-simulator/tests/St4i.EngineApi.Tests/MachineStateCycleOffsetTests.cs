using St4i.EdgeCore.Models;
using St4i.Connector.Abstractions.Models;
using St4i.EngineApi.Fleet;
using Xunit;

namespace St4i.EngineApi.Tests;

/// <summary>
/// Final-review I-1 — proves <see cref="MachineState.ApplyReading"/>'s displayed <c>Cycles</c> stays
/// monotonic across a driver restart (a speed-slider/scenario change in <c>FleetHost.ApplyScenario</c>
/// does <c>StopLocked()+StartLocked()</c>, which builds a brand-new <c>SimulatedDriver</c> whose RAW
/// per-machine cycle counter resets to 0/1) — the rewind a visitor would otherwise see on the dashboard
/// tile even while the fleet-wide KPI total keeps climbing.
/// </summary>
public sealed class MachineStateCycleOffsetTests
{
    private static readonly MachineDescriptor Descriptor = new(
        "SCRW-01", "SN-SCRW01", DeviceClass.Automation, "SCREWDRIVE", "screw_tightening",
        DriverKinds.Simulated, "RC-SCRW-A", null, CycleSeconds: 0.6);

    private static readonly TransportAck Ack = new(Success: true, Accepted: 1, HttpStatus: 201);

    private static DeviceReading Reading(long cycleCounter) => new()
    {
        MachineCode = Descriptor.Code,
        Kind = ReadingKind.ProcessResult,
        SerialNumber = $"SN-{cycleCounter}",
        Verdict = Verdict.Pass,
        CycleCounter = cycleCounter,
        Timestamp = DateTimeOffset.UtcNow,
    };

    [Fact]
    public void ApplyReading_NormalClimb_CyclesTracksRawCounterExactly()
    {
        var state = new MachineState(Descriptor);

        state.ApplyReading(Reading(1), Ack);
        Assert.Equal(1, state.Cycles);

        state.ApplyReading(Reading(2), Ack);
        Assert.Equal(2, state.Cycles);

        state.ApplyReading(Reading(3), Ack);
        Assert.Equal(3, state.Cycles);
    }

    [Fact]
    public void ApplyReading_RawCounterResetByDriverRestart_DisplayedCyclesKeepsClimbing()
    {
        var state = new MachineState(Descriptor);

        // Pre-restart: climbs to a real high-water mark, same as a machine that's been running a while.
        state.ApplyReading(Reading(1), Ack);
        state.ApplyReading(Reading(2), Ack);
        state.ApplyReading(Reading(47), Ack);
        Assert.Equal(47, state.Cycles);

        // Restart: FleetHost.ApplyScenario rebuilds SimulatedDriver, whose _cycleCounters start back at
        // 0 — the very next committed reading for this machine carries RAW CycleCounter=1 again.
        state.ApplyReading(Reading(1), Ack);

        // The bug this guards against: naively assigning `Cycles = reading.CycleCounter` here would
        // make the dashboard tile show "1" right after showing "47" — a visible rewind. The displayed
        // count must instead continue climbing from where it was.
        Assert.Equal(48, state.Cycles);
        Assert.True(state.Cycles > 47, "displayed Cycles must never rewind below its pre-restart value");

        // And it keeps climbing normally post-restart, offset intact.
        state.ApplyReading(Reading(2), Ack);
        Assert.Equal(49, state.Cycles);

        state.ApplyReading(Reading(3), Ack);
        Assert.Equal(50, state.Cycles);
    }

    [Fact]
    public void ApplyReading_TwoRestarts_OffsetsAccumulateAndCyclesNeverDecreases()
    {
        var state = new MachineState(Descriptor);
        long previous = 0;

        void ApplyAndAssertMonotonic(long rawCounter)
        {
            state.ApplyReading(Reading(rawCounter), Ack);
            Assert.True(state.Cycles >= previous, $"Cycles regressed: {previous} -> {state.Cycles}");
            previous = state.Cycles;
        }

        // First run: climbs to 10.
        for (long i = 1; i <= 10; i++) ApplyAndAssertMonotonic(i);
        Assert.Equal(10, state.Cycles);

        // First restart: raw resets to 1..5.
        for (long i = 1; i <= 5; i++) ApplyAndAssertMonotonic(i);
        Assert.Equal(15, state.Cycles);

        // Second restart: raw resets to 1..3.
        for (long i = 1; i <= 3; i++) ApplyAndAssertMonotonic(i);
        Assert.Equal(18, state.Cycles);
    }

    [Fact]
    public void ToTile_ReflectsOffsetAdjustedCycles_ConsistentWithEverGrowingFleetTotal()
    {
        // FleetHost's fleet-wide KPI (_totalCycles) is an Interlocked counter incremented once per
        // OnPipelineCommitted call and NEVER reset by Stop/Start — this test doesn't reach into
        // FleetHost, but it does prove the per-machine snapshot surfaced to the client
        // (ToTile/ToDetail) reflects the SAME offset-adjusted, monotonic Cycles value, so a fleet total
        // built by summing per-machine deltas stays coherent across a restart instead of diverging from
        // it the way the raw (pre-fix) counter would.
        var state = new MachineState(Descriptor);

        state.ApplyReading(Reading(1), Ack);
        state.ApplyReading(Reading(20), Ack);
        Assert.Equal(20, state.ToTile().Cycles);
        Assert.Equal(20, state.ToDetail().Cycles);

        // restart
        state.ApplyReading(Reading(1), Ack);
        Assert.Equal(21, state.ToTile().Cycles);
        Assert.Equal(21, state.ToDetail().Cycles);
    }
}
