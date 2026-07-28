using St4i.Connector.Abstractions.Models;

namespace St4i.EdgeCore.Models;

public record MachineDescriptor(
    string Code,
    string SerialSeed,
    DeviceClass DeviceClass,
    string MachineType,
    string? StepType,
    DriverKind DriverKind,
    string? RecipeCode,
    string? MappingProfile,
    double CycleSeconds);
