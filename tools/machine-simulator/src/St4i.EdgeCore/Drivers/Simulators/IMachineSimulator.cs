using St4i.EdgeCore.Models;

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
}
