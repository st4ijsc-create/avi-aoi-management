using St4i.Connector.Abstractions.Models;

namespace St4i.EdgeCore.Models;

/// <summary>
/// One roster entry: everything this product knows about a machine BEFORE that machine has produced
/// anything. It is the input side of the fleet — read from <c>fleet.json</c> by
/// <see cref="St4i.EdgeCore.Infrastructure.FleetConfig.Load"/>, or built in code by a host that onboards a
/// machine at runtime — and it is immutable for the lifetime of the running machine: nothing in this
/// codebase mutates a descriptor, a change means a new descriptor and a re-registration.
///
/// <para>Three of its members are dispatch signals rather than data, and they are consulted in a fixed
/// order that this record's field order does not show: <paramref name="MachineType"/> first
/// (<c>SimulatorFactory.Create</c> switches on it), <paramref name="DeviceClass"/> only as the fallback for
/// a type string a build does not recognise, and <paramref name="MappingProfile"/> independently of both
/// for the normalizer. Four more (<paramref name="Code"/>, <paramref name="DeviceClass"/>,
/// <paramref name="MachineType"/>, <paramref name="DriverKind"/>) are copied onto every historian row this
/// machine ever writes by <see cref="St4i.EdgeCore.Historian.HistorianResultRecord.From"/>, which is why a
/// descriptor edit does not retroactively change history: the row keeps the values that were in force when
/// it was written.</para>
/// </summary>
/// <param name="Code">The machine's identity everywhere in this product — the value stamped onto every
/// reading as <c>DeviceReading.MachineCode</c>, sent to the ecosystem server, and stored in the historian's
/// <c>machine_code</c> column. Every lookup keyed on it in this codebase is
/// <see cref="StringComparer.OrdinalIgnoreCase"/> (the fleet's live state map, the mapping-profile map
/// <see cref="St4i.EdgeCore.Mapping.MappingProfileResolver.Build"/> builds, the OEE settings table), so two
/// roster entries whose codes differ only in case are ONE machine to this product and the second silently
/// replaces the first in those maps.</param>
/// <param name="SerialSeed">A serial PREFIX, not a serial number. <c>SimulatorBase.NewReading</c> composes
/// the reading's serial as <c>"{SerialSeed}-{cycle:D6}"</c>, so the six-digit part distinguishes cycles of
/// one machine and this value is the only thing that distinguishes the serials of two machines — the cycle
/// counter is per-machine and starts again for each. Hosts that onboard a machine in code derive it as
/// <c>"SN-" + machineCode</c>; a roster that repeats a seed produces serials two machines both claim, and
/// nothing here detects that.</param>
/// <param name="DeviceClass">The FALLBACK dispatch signal, not the primary one. <c>SimulatorFactory</c>
/// reaches for it only when <paramref name="MachineType"/> is a string that build does not recognise, and
/// <see cref="St4i.EdgeCore.Mapping.MappingProfileResolver"/> uses it for
/// <c>MappingProfile.ForClass</c> whenever <paramref name="MappingProfile"/> is absent OR names a file that
/// is missing or unreadable. So it is what the machine falls back to being, which is why a wrong value here
/// is silent rather than fatal.</param>
/// <param name="MachineType">A FREE STRING and the primary dispatch signal — deliberately not an enum, so a
/// build can carry types it has no simulator for. The values in this tree are upper-snake
/// (<c>SCREWDRIVE</c>, <c>IOT_SENSOR</c>, <c>AOI</c>, <c>MODBUS_TCP</c>, <c>OPC_UA</c>); it is also the key
/// <c>MachineParameterSchema</c> maps to a config kind, and it is written verbatim into the historian's
/// <c>machine_type</c> column, so it reaches reports as typed.</param>
/// <param name="StepType">The process step every reading of this machine declares, or
/// <see langword="null"/> to mean "the simulator decides". Null is not "no step": each metric-judging
/// simulator substitutes its own literal (<c>press_fit</c>, <c>glue_dispense</c>, <c>weld_spot</c>,
/// <c>leak_test</c>, <c>screw_tightening</c>, <c>functional_test</c>), while the AOI and IoT simulators pass
/// it through unchanged including the null. Downstream, the normalizer falls back further still —
/// <c>StepType</c>, then the profile's own default, then the literal <c>process</c>.</param>
/// <param name="DriverKind">The connector's own id — GP-3 opened this from a closed enum into a
/// free-form string (see <see cref="St4i.Connector.Abstractions.Models.DriverKinds"/> for the five
/// built-in ids and the casing/normalization rule). <see cref="St4i.EdgeCore.Infrastructure.FleetConfig.Load"/>
/// is the one place an externally-authored (<c>fleet.json</c>) value is normalized against the
/// built-ins; every other constructor of a <see cref="MachineDescriptor"/> in this codebase already
/// passes one of the canonical <see cref="St4i.Connector.Abstractions.Models.DriverKinds"/> constants
/// directly.</param>
/// <param name="RecipeCode">The recipe this machine runs when its driver does not name one per reading —
/// <c>SimulatorBase.NewReading</c> copies it onto every reading it builds. <see langword="null"/> is a real
/// state and it is handled differently at each stage downstream: the normalizer substitutes the mapping
/// profile's own default recipe, the idempotency bucket it feeds degrades to the step type and then to the
/// literal <c>cycle</c>, and the doc-28 file writer emits <c>UNSPECIFIED</c>. It is a code, never a
/// version — the version travels on the reading.</param>
/// <param name="MappingProfile">A profile NAME, not a path and not the profile itself:
/// <see cref="St4i.EdgeCore.Mapping.MappingProfileResolver"/> loads
/// <c>{mappingDir}/{MappingProfile}.json</c>. <see langword="null"/> selects the built-in profile for
/// <paramref name="DeviceClass"/>, and so does a name whose file is missing, unreadable or not valid JSON —
/// those two failures are logged and then fall back to exactly the same profile the null case gets, so a
/// typo here degrades to the class default rather than stopping the machine.</param>
/// <param name="CycleSeconds">The machine's nominal cycle, in SECONDS, and it is used for two unrelated
/// purposes. As a cadence it is what <c>SimulatedDriver</c> waits between cycles, but only after two
/// corrections it applies rather than validates: a simulator's own <c>CycleSecondsOverride</c> wins
/// outright, a value of zero or less is read as 1.0, and anything below 0.05 s is raised to 0.05 s. As a
/// rate it is the ideal-cycle input to the OEE performance term whenever
/// <see cref="St4i.EdgeCore.Historian.OeeMachineSettings.IdealCycleSecondsOverride"/> is null — so a
/// descriptor whose cadence was chosen to make a demo look busy also sets that machine's OEE
/// denominator.</param>
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
