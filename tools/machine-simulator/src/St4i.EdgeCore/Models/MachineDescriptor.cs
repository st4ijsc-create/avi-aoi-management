using St4i.Connector.Abstractions.Models;

namespace St4i.EdgeCore.Models;

/// <param name="DriverKind">The connector's own id — GP-3 opened this from a closed enum into a
/// free-form string (see <see cref="St4i.Connector.Abstractions.Models.DriverKinds"/> for the five
/// built-in ids and the casing/normalization rule). <see cref="St4i.EdgeCore.Infrastructure.FleetConfig.Load"/>
/// is the one place an externally-authored (<c>fleet.json</c>) value is normalized against the
/// built-ins; every other constructor of a <see cref="MachineDescriptor"/> in this codebase already
/// passes one of the canonical <see cref="St4i.Connector.Abstractions.Models.DriverKinds"/> constants
/// directly.</param>
public record MachineDescriptor(
    string Code,
    string SerialSeed,
    DeviceClass DeviceClass,
    string MachineType,
    string? StepType,
    string DriverKind,
    string? RecipeCode,
    string? MappingProfile,
    double CycleSeconds);
