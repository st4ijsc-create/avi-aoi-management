using St4i.Connector.Abstractions.Models;
using St4i.EdgeCore.Models;
using St4i.EdgeCore.Transport;

namespace St4i.EdgeCore.Fleet;

// ─────────────────────────────────────────────────────────────────────────
// 🔴 Task E-2 (docs/plans/2026-08-04-dotE-fleet-core-extraction-blueprint.md) — the DOMAIN read-out
// shapes of the N-driver lifecycle core.
//
// WHY THESE EXIST AT ALL, since "one more record" is exactly the kind of addition a MOVE is not supposed
// to produce. Blueprint §4's decision is that the DTOs stay in St4i.EngineApi: the core returns domain
// types and the shell projects them onto the wire. Before E-2 the same members returned FleetSnapshotDto/
// MachineDetailDto/SettingsDto/ConnectorStatusDto directly, so honouring §4 means the read-out shape has
// to be restated once, on this side of the cut, in vocabulary that names no HTTP concept. Each record
// below is a field-for-field peer of exactly one DTO, and the projection that pairs with it lives in
// St4i.EngineApi.Fleet.FleetProjections — one file, so the two can never quietly drift apart.
//
// What is NOT here, deliberately: SafetySnapshot (its own file — it is read on the safety path and is
// named by EstopGuardRule, so it keeps its own home), DriverHealthSnapshot and MachineDriverAvailability
// (both declared alongside FleetCore in FleetCore.cs, exactly where they sat alongside FleetHost before
// the move — E-1 §1.5(a) judged DriverHealthSnapshot a domain type, not a projection, because it names
// only SlotLabel/Kind/DriverHealthState).
// ─────────────────────────────────────────────────────────────────────────

/// <summary>One row of a machine's cycle log — the domain peer of <c>St4i.EngineApi.Fleet.CycleLogEntry</c>,
/// and the shape <see cref="MachineState"/> has always accumulated internally.</summary>
public sealed record MachineCycleRecord(DateTimeOffset Time, string Serial, string Verdict, string KeyMetric);

/// <summary>One named telemetry series (a metric name plus its recent values) — domain peer of
/// <c>St4i.EngineApi.Fleet.TelemetrySeriesDto</c>.</summary>
public sealed record MachineTelemetrySeries(string Metric, IReadOnlyList<double> Values);

/// <summary>I-MR-style SPC summary: the raw recent values plus mean/UCL/LCL computed over that same window
/// (mean ± 3·sample-stdev — the same simplified individuals-chart control limit the WPF app's
/// <c>MachineViewModel</c> uses). Domain peer of <c>St4i.EngineApi.Fleet.SpcSummaryDto</c>.</summary>
public sealed record MachineSpcSummary(IReadOnlyList<double> Values, double Mean, double Ucl, double Lcl);

/// <summary>One machine's dashboard-row state, taken under <see cref="MachineState"/>'s own lock — domain
/// peer of <c>St4i.EngineApi.Fleet.FleetTileDto</c>.</summary>
public sealed record MachineTileSnapshot(
    string Code,
    DeviceClass DeviceClass,
    string DriverKind,
    string StatusText,
    double PassRate,
    long Cycles,
    string LastCycleSummary,
    IReadOnlyList<double> Spark);

/// <summary>One machine's full detail state, taken under <see cref="MachineState"/>'s own lock — domain
/// peer of <c>St4i.EngineApi.Fleet.MachineDetailDto</c>. <see cref="BoardPoints"/> stays as the reading's
/// own <see cref="MeasurementResult"/> (see <see cref="MachineState.SnapshotDetail"/>'s remarks).</summary>
public sealed record MachineDetailSnapshot(
    string Code,
    DeviceClass DeviceClass,
    string DriverKind,
    string StatusText,
    double PassRate,
    long Cycles,
    MachineSpcSummary Spc,
    IReadOnlyList<MachineTelemetrySeries> Telemetry,
    IReadOnlyList<MeasurementResult> BoardPoints,
    IReadOnlyList<MachineCycleRecord> CycleLog,
    string DriftState,
    CyclePlan? Plan);

/// <summary>Everything one <c>GET /v1/fleet</c> needs, resolved by <see cref="FleetCore.ReadSnapshot"/> in
/// exactly the order (and under exactly the locks) <c>FleetHost.Snapshot</c> resolved it before E-2 —
/// domain peer of <c>St4i.EngineApi.Fleet.FleetSnapshotDto</c> plus its nested <c>FleetKpisDto</c>.</summary>
public sealed record FleetRuntimeSnapshot(
    IReadOnlyList<MachineTileSnapshot> Machines,
    int Online,
    long TotalCycles,
    double Fpy,
    bool HasMixedProvenance,
    bool IsRunning,
    bool EstopEngaged);

/// <summary>The connection/identity settings a <c>PUT /v1/settings</c> mutates, read as one consistent
/// tuple under <see cref="FleetCore"/>'s own gate — domain peer of
/// <c>St4i.EngineApi.Fleet.SettingsDto</c>.</summary>
public sealed record FleetSettingsSnapshot(
    string ServerUrl, bool VerifyTls, string Language, string MachineCode, TransportMode Mode);

/// <summary>One connector id that is configured but failed its most recent start attempt — domain peer of
/// <c>St4i.EngineApi.Fleet.ConnectorStatusDto</c>. See
/// <see cref="FleetCore.GetConfiguredConnectorIssues"/> for why this is informational, never a fault.</summary>
public sealed record ConnectorStartIssue(string Id, string Error);
