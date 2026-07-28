using St4i.EdgeCore.Engine;
using St4i.EdgeCore.Models;
using St4i.Connector.Abstractions.Models;

namespace St4i.EngineApi.Fleet;

// ─────────────────────────────────────────────────────────────────────────
// GET /v1/health
// ─────────────────────────────────────────────────────────────────────────
public sealed record HealthDto(bool Ok, TransportMode Mode);

// ─────────────────────────────────────────────────────────────────────────
// GET /v1/fleet
// ─────────────────────────────────────────────────────────────────────────
public sealed record FleetTileDto(
    string Code,
    DeviceClass DeviceClass,
    string DriverKind,
    string StatusText,
    double PassRate,
    long Cycles,
    string LastCycleSummary,
    IReadOnlyList<double> Spark);

public sealed record FleetKpisDto(int Online, long TotalCycles, double Fpy);

/// <summary><c>IsRunning</c> added for final-review M-3: before this, whether the fleet is actively
/// running was only ever reported back by the start/stop POST responses, so a client that reloaded the
/// page while a fleet was genuinely running had no way to recover that fact from a plain GET and its
/// Stop button stayed disabled (self-healing only once Start was clicked, a no-op server-side). Mirrors
/// <see cref="FleetHost.IsRunning"/> directly.
///
/// <c>EstopEngaged</c> added for branch-review C-2: the E-STOP latch used to be component-local React
/// state on the HMI panel, so a second panel/tab/reload silently forgot an active emergency stop. It now
/// lives here — mirrors <see cref="FleetHost.EstopEngaged"/> — so every observer of this same polled
/// snapshot (every HMI panel, every tab) agrees on the latch and a reload recovers it.</summary>
public sealed record FleetSnapshotDto(IReadOnlyList<FleetTileDto> Machines, FleetKpisDto Kpis, bool IsRunning, bool EstopEngaged);

public sealed record FleetActionResultDto(bool Running, string Mode);

// ─────────────────────────────────────────────────────────────────────────
// GET /v1/machines/{code}
// ─────────────────────────────────────────────────────────────────────────
/// <param name="Plan">WS3-T1 (docs/PRODUCTION_UI_DESIGN.md §3.2) — the latest cycle's ordered per-step
/// plan (point sequence + per-step results + timing) for a "living twin" web animation, or null when the
/// fleet isn't running ("idle machine = no active plan") or this machine's simulator doesn't wire a plan.
/// Purely additive — every other field above is unchanged by this task.</param>
public sealed record MachineDetailDto(
    string Code,
    DeviceClass Class,
    string DriverKind,
    string StatusText,
    double PassRate,
    long Cycles,
    SpcSummaryDto Spc,
    IReadOnlyList<TelemetrySeriesDto> Telemetry,
    IReadOnlyList<BoardPointDto> BoardPoints,
    IReadOnlyList<CycleLogEntry> CycleLog,
    string DriftState,
    CyclePlan? Plan = null);

// ─────────────────────────────────────────────────────────────────────────
// GET/PUT /v1/mode
// ─────────────────────────────────────────────────────────────────────────
public sealed record ModeDto(TransportMode Mode);

// ─────────────────────────────────────────────────────────────────────────
// GET /v1/capabilities — WS2-T1: what this deployment allows, so the web shell knows whether to even
// render the DEMO option (topbar segmented control, Settings mode selector) instead of discovering it
// only after a rejected PUT /v1/mode. `Mode` is included too so a single fetch can seed both the
// capability AND the current mode on first paint without a second round trip.
//
// WS-F1-T1 — `Version` added: the product version (tools/machine-simulator/Directory.Build.props'
// single <Version>/<AssemblyVersion>, the same value the installer will read for upgrade-vs-fresh-install
// decisions), read back off this running assembly at request time. Web can surface it (e.g. an "About"
// panel, a support-ticket footer) later; no web change required by this task.
// ─────────────────────────────────────────────────────────────────────────
public sealed record CapabilitiesDto(bool DemoEnabled, TransportMode Mode, string Version);

// ─────────────────────────────────────────────────────────────────────────
// POST /v1/scenario, /v1/scenario/preset, /v1/scenario/burst
// ─────────────────────────────────────────────────────────────────────────
public sealed record ScenarioRequest(double CycleRate = 1.0, double DefectRate = 0.0, double FaultRate = 0.0, bool NetworkOutage = false)
{
    public ScenarioConfig ToScenarioConfig() => new(CycleRate, DefectRate, FaultRate, NetworkOutage);
}

public sealed record ScenarioPresetRequest(string Name);

public sealed record ScenarioDto(double CycleRate, double DefectRate, double FaultRate, bool NetworkOutage, string ActivePreset, string StatusLine)
{
    public static ScenarioDto From(ScenarioConfig config, string activePreset) => new(
        config.CycleRateMultiplier,
        config.ExtraDefectRate,
        config.FaultRate,
        config.NetworkOutage,
        activePreset,
        BuildStatusLine(config, activePreset));

    private static string BuildStatusLine(ScenarioConfig config, string activePreset)
    {
        var outageText = config.NetworkOutage ? "network outage (acks queued/failing)" : "network normal";
        return $"{activePreset} — cycleRate={config.CycleRateMultiplier:0.00}x, defect={config.ExtraDefectRate:P0}, fault={config.FaultRate:P0}, {outageText}.";
    }
}

/// <summary>One named scenario preset — kebab-case <see cref="Name"/> keys (an API ergonomics choice;
/// the WPF app's own preset picker uses Vietnamese display names instead) that <c>POST
/// /v1/scenario/preset</c> matches case-insensitively.</summary>
public sealed record ScenarioPresetInfo(string Name, string Description, ScenarioConfig Config, bool TriggersHotFolderDemo = false);

// ─────────────────────────────────────────────────────────────────────────
// GET/PUT /v1/settings, POST /v1/settings/probe
// ─────────────────────────────────────────────────────────────────────────
public sealed record SettingsDto(string ServerUrl, bool VerifyTls, string Language, string MachineCode, TransportMode Mode);

/// <summary>All fields optional — an omitted field leaves that setting unchanged (a PUT that only wants
/// to flip <c>language</c>, say, doesn't need to also resend <c>serverUrl</c>).</summary>
public sealed record SettingsUpdateRequest(string? ServerUrl, bool? VerifyTls, string? Language, string? MachineCode);

public sealed record ProbeRequest(string ServerUrl);

// ─────────────────────────────────────────────────────────────────────────
// POST /v1/onboarding/*
//
// WS2-T1 — `IsDemo` changed from a hardcoded `= true` default to `bool?` (default `null` = "caller
// didn't say"). A `true`/`false` sent on the wire always wins unchanged. An OMITTED field used to
// silently resolve to Demo unconditionally; it now can't distinguish "unset" from "false" at the DTO
// level at all — that's deliberate, so `OnboardingEndpoints` can resolve the null case from the
// engine's ACTIVE transport mode (Live by default post-WS2-T1, Demo on an exhibition/flagged
// deployment) instead of a fact baked into the wire contract. `OnboardingService` itself (still
// fleet/mode-free by design, see its own class doc) falls back to demo-fabrication (`req.IsDemo ??
// true`) ONLY when constructed and called directly with no resolution step at all — the shape every
// pre-existing unit test in this repo already uses — never reachable from the real HTTP endpoints,
// which always resolve the null case before calling in.
// ─────────────────────────────────────────────────────────────────────────
public sealed record OnboardingRegisterRequest(string SerialNumber, string? Name, string? MachineType, bool? IsDemo = null, string? ServerUrl = null);

public sealed record OnboardingPollRequest(string SerialNumber, bool? IsDemo = null, string? ServerUrl = null);

/// <summary>E2: <c>Name</c>/<c>MachineType</c> added (optional — a client that doesn't send them still
/// works, falling back to a generic Automation profile) so a successful claim can build the
/// <see cref="MachineDescriptor"/> needed to join the sim fleet (see
/// <see cref="OnboardingFleetJoin"/>) without OnboardingService having to remember state from the
/// earlier Register call keyed by serialNumber. The WEB wizard already tracks both at the top of its
/// onboarding flow (used by Register/Enroll already) — E2 just needs it threaded into the Claim POST
/// body too.</summary>
public sealed record OnboardingClaimRequest(string SerialNumber, string? ClaimToken, bool? IsDemo = null, string? ServerUrl = null, string? Name = null, string? MachineType = null);

public sealed record OnboardingEnrollRequest(string SerialNumber, string? EnrollToken, string? Name, string? MachineType, bool? IsDemo = null, string? ServerUrl = null);

public sealed record OnboardingPasteKeyRequest(string MachineCode, string MkKey);

public sealed record OnboardingStepResult(string Step, string? MachineCode, string? MkKey, bool IsApproved, string Message);

// ─────────────────────────────────────────────────────────────────────────
// POST /v1/machines/{code}/sync-config
// ─────────────────────────────────────────────────────────────────────────
public sealed record SyncConfigResponse(string Code, bool Changed, string? Version, string? DriftState, bool Applied, string DriftStateText);

public sealed record ApiErrorDto(string Error);
