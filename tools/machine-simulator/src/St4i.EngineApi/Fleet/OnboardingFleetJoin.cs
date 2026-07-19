using St4i.EdgeCore.Models;

namespace St4i.EngineApi.Fleet;

/// <summary>
/// E2 — the seam that closes the #1 onboarding complaint: a completed onboarding (Demo OR Live, Claim
/// OR Enroll) minted an <c>mk_</c> key and saved it via <c>St4i.EdgeCore.Infrastructure.CredentialStore.Save</c>
/// (unaffected — still runs exactly as before), but the new machine never showed up anywhere — not on
/// the Dashboard, not in the Machine List, nowhere — because nothing ever called
/// <see cref="FleetHost.RegisterMachine"/> for it.
///
/// Lives in <c>Endpoints/</c>'s composition layer (called from <see cref="St4i.EngineApi.Endpoints.OnboardingEndpoints"/>,
/// which already has a <see cref="FleetHost"/> available via DI) rather than being wired into
/// <see cref="OnboardingService"/> itself — <c>OnboardingService</c> stays a plain HTTP/demo-fabrication
/// service with zero FleetHost dependency, so its own unit tests don't need a fleet to construct. This
/// class is the deliberately-thin glue between the two, and is itself trivially unit-testable (pure
/// static methods over a real <see cref="FleetHost"/> instance, no HTTP involved).
/// </summary>
public static class OnboardingFleetJoin
{
    private sealed record TypeProfile(DeviceClass DeviceClass, double CycleSeconds);

    /// <summary>
    /// machineType → (DeviceClass, CycleSeconds) — mirrors the real SYNAPSE server's
    /// <c>DEVICE_CLASS_BY_TYPE</c> (server/constants/machineTypes.ts) 3-way split (aoi_avi / automation /
    /// iot), keyed on the SAME <c>MACHINE_TYPES</c> enum values so a machineType a WEB client sends
    /// (register/claim/enroll all carry it) lands on the right kind of simulator via
    /// <see cref="St4i.EdgeCore.Drivers.Simulators.SimulatorFactory.Create"/>. CycleSeconds picked to feel roughly
    /// right for that station type — same ballpark as <see cref="FleetHost"/>'s own
    /// <c>BuildDefaultFleet</c> roster (screwdrive/dispensing/weld/assembly ~0.6-1.2s, inspection
    /// ~1.5-2.0s, IoT telemetry ~0.4-0.5s) — not load-bearing precision, just "doesn't feel wrong" for a
    /// freshly onboarded demo machine.
    /// </summary>
    private static readonly IReadOnlyDictionary<string, TypeProfile> Profiles = new Dictionary<string, TypeProfile>(StringComparer.OrdinalIgnoreCase)
    {
        // ── aoi_avi ──
        ["AVI"] = new(DeviceClass.AoiAvi, 1.8),
        ["AOI"] = new(DeviceClass.AoiAvi, 1.8),
        ["SPI"] = new(DeviceClass.AoiAvi, 1.5),
        ["AXI"] = new(DeviceClass.AoiAvi, 2.0),
        // ── automation ──
        ["ICT"] = new(DeviceClass.Automation, 1.1),
        ["FCT"] = new(DeviceClass.Automation, 1.1),
        ["CMM"] = new(DeviceClass.Automation, 1.5),
        ["AUTOMATION"] = new(DeviceClass.Automation, 1.0),
        ["FEEDER"] = new(DeviceClass.Automation, 0.5),
        ["ASSEMBLY"] = new(DeviceClass.Automation, 0.7),
        ["SCREWDRIVE"] = new(DeviceClass.Automation, 0.7),
        ["DISPENSING"] = new(DeviceClass.Automation, 1.0),
        ["ICT_FUNC"] = new(DeviceClass.Automation, 1.2),
        ["ROBOT_TEST"] = new(DeviceClass.Automation, 1.3),
        ["PACKAGING"] = new(DeviceClass.Automation, 0.8),
        ["PALLETIZER"] = new(DeviceClass.Automation, 0.9),
        ["ROBOT"] = new(DeviceClass.Automation, 1.0),
        ["MOUNTER"] = new(DeviceClass.Automation, 0.3),
        ["REFLOW"] = new(DeviceClass.Automation, 2.5),
        ["STENCIL_PRINTER"] = new(DeviceClass.Automation, 0.6),
        ["WAVE_SOLDER"] = new(DeviceClass.Automation, 2.0),
        ["WELDER"] = new(DeviceClass.Automation, 0.9),
        // ── iot ──
        ["IOT_SENSOR"] = new(DeviceClass.Iot, 0.4),
        ["IOT_GATEWAY"] = new(DeviceClass.Iot, 0.5),
        // Completion-review #6: the register field is free text with placeholder hint "e.g. Automation,
        // IoT, AOI/AVI" — "AOI"/"AVI" already map above, but the bare "IoT" the placeholder itself
        // suggests wasn't in this table (only the more specific IOT_SENSOR/IOT_GATEWAY were), so it fell
        // through to the Automation fallback below. Cycle rate matches IOT_SENSOR's — closest generic
        // guess for an unqualified "IoT" entry.
        ["IOT"] = new(DeviceClass.Iot, 0.4),
    };

    /// <summary>Fail-safe default for an unrecognized/blank machineType — mirrors the real server's
    /// <c>deviceClassOf</c> ("unknown → automation, never throws"): a spec-drifted or future machineType
    /// the WEB sends onboards as a generic automation cell instead of rejecting the whole flow.
    /// <see cref="St4i.EdgeCore.Drivers.Simulators.SimulatorFactory"/> independently falls back the same way by
    /// <see cref="DeviceClass"/> if it doesn't recognize the type string either.</summary>
    private static readonly TypeProfile FallbackProfile = new(DeviceClass.Automation, 1.0);

    /// <summary>Builds the <see cref="MachineDescriptor"/> a freshly-claimed/enrolled machine needs to
    /// join the live simulated fleet. <paramref name="code"/> is the machine's CANONICAL code — for Demo
    /// that's the serial number (or "SIM-DEMO"); for Live it's whatever code the SYNAPSE server assigned
    /// (<c>SN-&lt;serial&gt;</c> at register time, possibly renamed by the admin at approval) — NOT
    /// necessarily <paramref name="serialNumber"/> itself. <c>RecipeCode</c> is left <see langword="null"/>
    /// (an onboarding-time machine has no recipe assigned yet — no reason to fabricate one) and
    /// <c>StepType</c> is left <see langword="null"/> too — every simulator already has its own sane
    /// per-type StepType default (see e.g. <c>ScrewdriveSim</c>'s <c>Descriptor.StepType ?? "screw_tightening"</c>),
    /// so duplicating that table here would just be a second place for it to drift.</summary>
    public static MachineDescriptor BuildDescriptor(string code, string serialNumber, string? machineType)
    {
        var type = string.IsNullOrWhiteSpace(machineType) ? "AUTOMATION" : machineType.Trim().ToUpperInvariant();
        var profile = Profiles.TryGetValue(type, out var p) ? p : FallbackProfile;

        return new MachineDescriptor(
            Code: code,
            SerialSeed: serialNumber,
            DeviceClass: profile.DeviceClass,
            MachineType: type,
            StepType: null,
            DriverKind: DriverKind.Simulated,
            RecipeCode: null,
            MappingProfile: null,
            CycleSeconds: profile.CycleSeconds);
    }

    /// <summary>Call after a Claim/Enroll step (Demo or Live) — if it actually provisioned a machine
    /// (<see cref="OnboardingStepResult.Step"/> is <c>"Claimed"</c>/<c>"Enrolled"</c> and it carries a
    /// <see cref="OnboardingStepResult.MachineCode"/>), joins it into <paramref name="fleetHost"/> so it
    /// appears on Dashboard/Machine List/Detail and starts producing cycles the next time the fleet runs.
    /// A <c>false</c> from <see cref="FleetHost.RegisterMachine"/> (dupe code — e.g. the operator re-ran
    /// onboarding for a serial that's already in the fleet) is surfaced as a friendly "already in the
    /// fleet" note appended to the message, never as an error — RegisterMachine's dupe-safety is designed
    /// for exactly this speculative call. Any other step (Idle/Pending/Approved, or a step with no
    /// MachineCode) passes the result through untouched.</summary>
    public static OnboardingStepResult JoinFleetIfProvisioned(FleetHost fleetHost, OnboardingStepResult result, string serialNumber, string? machineType)
    {
        ArgumentNullException.ThrowIfNull(fleetHost);
        ArgumentNullException.ThrowIfNull(result);

        if (result.Step is not ("Claimed" or "Enrolled") || string.IsNullOrWhiteSpace(result.MachineCode))
            return result;

        var descriptor = BuildDescriptor(result.MachineCode, serialNumber, machineType);
        var joined = fleetHost.RegisterMachine(descriptor);

        var suffix = joined
            ? $" — đã tham gia đội máy mô phỏng ({descriptor.Code})."
            : $" — máy đã có trong đội máy mô phỏng ({descriptor.Code}), không tạo trùng.";

        return result with { Message = result.Message + suffix };
    }
}
