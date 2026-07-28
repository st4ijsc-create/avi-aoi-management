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
