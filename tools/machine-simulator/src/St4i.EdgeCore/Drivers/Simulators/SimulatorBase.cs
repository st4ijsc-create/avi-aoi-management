using St4i.EdgeCore.Models;

namespace St4i.EdgeCore.Drivers.Simulators;

/// <summary>
/// Shared scaffolding for the 8 per-machine-type simulators: owns <see cref="Descriptor"/>/seed and
/// the boilerplate every <see cref="IMachineSimulator.NextCycle"/> needs to fill in identically
/// (machine code, per-cycle unique serial number, recipe/step type, cycle counter, wire timestamp).
/// </summary>
public abstract class SimulatorBase : IMachineSimulator
{
    private readonly int _seed;

    public MachineDescriptor Descriptor { get; }

    protected SimulatorBase(MachineDescriptor descriptor, int seed)
    {
        Descriptor = descriptor ?? throw new ArgumentNullException(nameof(descriptor));
        _seed = seed;
    }

    public abstract DeviceReading NextCycle(long cycle);

    /// <summary>Deterministic per-cycle RNG — see <see cref="SimRng.For"/> for the determinism contract.</summary>
    protected Random Rng(long cycle) => SimRng.For(_seed, cycle);

    /// <summary>
    /// Pre-fills the fields every reading needs regardless of machine type. The SerialNumber is
    /// UNIQUE per cycle (<c>"{SerialSeed}-{cycle:D6}"</c>) — required so Normalizer's inspection
    /// idempotency key (machineCode:recipe:serialNumber:cycleCounter) never collides across
    /// distinct cycles/boards on the same machine (see the idempotency-fix commit this task
    /// follows). <see cref="DeviceReading.Timestamp"/> uses wall-clock now deliberately: it's the
    /// wire timestamp sent with the reading, not simulation state, so it is NOT part of the
    /// determinism contract.
    /// </summary>
    protected DeviceReading NewReading(long cycle, ReadingKind kind, string? stepType) => new()
    {
        MachineCode = Descriptor.Code,
        Kind = kind,
        SerialNumber = $"{Descriptor.SerialSeed}-{cycle:D6}",
        StepType = stepType,
        RecipeCode = Descriptor.RecipeCode,
        CycleCounter = cycle,
        Timestamp = DateTimeOffset.Now,
    };
}
