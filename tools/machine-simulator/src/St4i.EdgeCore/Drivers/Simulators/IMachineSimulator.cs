using St4i.EdgeCore.Models;
using St4i.Connector.Abstractions.Models;

namespace St4i.EdgeCore.Drivers.Simulators;

/// <summary>
/// One machine's physics model (doc-62 §6). Pure value-generation seam: given a cycle index it
/// returns the reading that cycle WOULD have produced — no I/O, no wall-clock dependency in the
/// value logic, so the same (seed, cycle) pair always reproduces the same reading (exhibition
/// demo determinism + testability). <see cref="SimulatedDriver"/> is the only thing that adds the
/// real-time pacing on top of this.
/// </summary>
public interface IMachineSimulator
{
    /// <summary>The roster entry this model speaks for. It is an INPUT that was already consumed before the
    /// simulator existed: <see cref="SimulatorFactory.Create"/> switched on
    /// <see cref="MachineDescriptor.MachineType"/> (then <see cref="MachineDescriptor.DeviceClass"/>) to
    /// decide which implementation to build, and nothing in this seam re-reads either field afterwards — so
    /// the type of physics running is fixed at construction. (Both fields are read elsewhere in the product,
    /// by the config-kind lookup and by the historian; this says only that no simulator consults them
    /// again.)
    ///
    /// <para>Measured over every <c>.cs</c> under <c>src/</c> at commit <c>5e194ab0</c>, exactly two things
    /// outside this seam read it, both in <see cref="SimulatedDriver"/>: the driver's
    /// <see cref="SimulatedDriver.Id"/> is composed from every simulator's <see cref="MachineDescriptor.Code"/>,
    /// and <see cref="MachineDescriptor.CycleSeconds"/> is the pacing fallback used on every pass where
    /// <see cref="CycleSecondsOverride"/> is <see langword="null"/> — corrected rather than validated there
    /// (a value at or below zero is read as 1.0 s and anything under 0.05 s is raised to 0.05 s). Inside the
    /// seam, <c>SimulatorBase.NewReading</c> copies <see cref="MachineDescriptor.Code"/>,
    /// <see cref="MachineDescriptor.SerialSeed"/> and <see cref="MachineDescriptor.RecipeCode"/> onto every
    /// reading, and each implementation decides for itself what to do with
    /// <see cref="MachineDescriptor.StepType"/>.</para>
    ///
    /// <para>This interface does not oblige an implementation to keep the value stable, and nothing in this
    /// repository asserts that it does; <see cref="SimulatorBase"/> — the base every implementation here
    /// derives from — makes it get-only and assigns it once.</para></summary>
    MachineDescriptor Descriptor { get; }

    /// <summary>Produces the reading for the given 1-based cycle index. Deterministic in (seed, cycle).</summary>
    DeviceReading NextCycle(long cycle);

    /// <summary>
    /// Task 3 (docs/plans/2026-07-21-machine-config.md) — optional per-cycle cadence override, consulted
    /// fresh by <see cref="SimulatedDriver"/> on every scheduling decision (never cached at pipeline
    /// construction), so a live <c>speedRpm</c>/<c>clampTimeMs</c>/<c>sampleRateHz</c>/<c>reportIntervalSec</c>
    /// edit takes effect on the very next cycle with no fleet restart. <see langword="null"/> (every
    /// simulator's default via <see cref="SimulatorBase"/>) means "fall back to
    /// <see cref="MachineDescriptor.CycleSeconds"/>, exactly the pre-Task-3 behaviour" — a
    /// simulator this task doesn't wire for cadence is completely unaffected.
    /// </summary>
    double? CycleSecondsOverride { get; }
}
