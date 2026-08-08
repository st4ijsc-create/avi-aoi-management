using St4i.Connector.Abstractions.Models;
using St4i.EdgeCore.Fleet;
using St4i.EdgeCore.Models;

namespace St4i.EngineApi.Fleet;

// ─────────────────────────────────────────────────────────────────────────
// 🔴 Task E-2 (docs/plans/2026-08-04-dotE-fleet-core-extraction-blueprint.md §9.6(a)) — THE SPLIT.
//
// Blueprint §4 decided the DTOs stay in St4i.EngineApi and the core returns domain types. E-1's review
// then showed that decision only STANDS if two files are split rather than left alone, because
// MachineState.cs and Dtos.cs hooked into each other in BOTH directions:
//
//   MachineState  → returned FleetTileDto / MachineDetailDto, declared in Dtos.cs
//   Dtos.cs       → MachineDetailDto consumed CycleLogEntry / TelemetrySeriesDto / SpcSummaryDto /
//                   BoardPointDto, declared inside MachineState.cs
//
// Leaving that alone would have dragged four presentation records down into St4i.EdgeCore behind
// MachineState, or dragged MachineDetailDto up behind them — either way §4's decision would have been
// false in fact while true on paper. This file is where the cycle is broken: every projection RECORD and
// every projection FUNCTION for the fleet/machine read paths lives here, on the EngineApi side, and
// St4i.EdgeCore names no web shape at all. The dependency edge is now one-way and the COMPILER enforces
// it — St4i.EdgeCore cannot reference St4i.EngineApi.
//
// The rest of Dtos.cs stayed put: health, mode, capabilities, scenario, settings, onboarding, connector
// and machine-write shapes have no counterpart on the core side and no coupling to fix. (Dtos.cs is also
// not self-contained in another direction — :252/253/256/280/281 name four types declared in
// ConnectorConfigStore.cs — but that is EngineApi-to-EngineApi and needs nothing from this cut; it is
// recorded here only so the next reader does not re-derive it as a finding.)
// ─────────────────────────────────────────────────────────────────────────

/// <summary>One row of a machine's cycle log — mirrors the WPF app's <c>CycleLogRow</c> record. E-2: was
/// declared in <c>MachineState.cs</c>; the domain half it is projected from is
/// <see cref="MachineCycleRecord"/>.</summary>
public sealed record CycleLogEntry(DateTimeOffset Time, string Serial, string Verdict, string KeyMetric);

/// <summary>One named telemetry series (a metric name plus its recent values) — the wire shape for
/// <c>GET /v1/machines/{code}</c>'s <c>telemetry</c> array.</summary>
public sealed record TelemetrySeriesDto(string Metric, IReadOnlyList<double> Values);

/// <summary>I-MR-style SPC summary for <c>GET /v1/machines/{code}</c>'s <c>spc</c> object: the raw
/// recent values plus mean/UCL/LCL computed over that same window (mean ± 3·sample-stdev — the same
/// simplified individuals-chart control limit the WPF app's <c>MachineViewModel</c> uses).</summary>
public sealed record SpcSummaryDto(IReadOnlyList<double> Values, double Mean, double Ucl, double Lcl);

public sealed record BoardPointDto(string PointCode, string Result, Bbox? Bbox, string? DefectCode);

// ─────────────────────────────────────────────────────────────────────────
// GET /v1/fleet — E-2: moved here from Dtos.cs, with the projection that builds them, so the two can
// never drift apart in separate files.
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

/// <param name="HasMixedProvenance">SM-2 (.superpowers/sdd/2026-07-29-dotA-single-machine-sellable-blueprint/
/// task-2-brief.md) — true exactly when the CURRENT roster contains at least one fabricated (Simulated)
/// machine AND at least one real (non-Simulated) machine at the same time — "demo fleet plus a real
/// machine," the scenario the brief calls out. Whenever this is true, <see cref="TotalCycles"/>/
/// <see cref="Fpy"/> above already reflect ONLY the real machine(s) (see
/// <see cref="St4i.EdgeCore.Fleet.FleetCore.ReadSnapshot"/>'s own remarks) — the fabricated machines' cycles
/// are deliberately excluded, never blended — even though <see cref="FleetSnapshotDto.Machines"/> still
/// lists every one of them with their own per-tile Cycles/PassRate untouched. This is the "the UI must not
/// lie" signal: without it, an operator watching a tile list that includes fabricated machines has no way to
/// know the fleet-wide rollup above silently excludes some of what's on screen. False in a pure-demo roster
/// (nothing real to blend with — the numbers ARE the fabricated fleet's own, exactly as before this task)
/// and in a pure-product roster (nothing fabricated to blend with).</param>
public sealed record FleetKpisDto(int Online, long TotalCycles, double Fpy, bool HasMixedProvenance);

/// <summary><c>IsRunning</c> added for final-review M-3: before this, whether the fleet is actively
/// running was only ever reported back by the start/stop POST responses, so a client that reloaded the
/// page while a fleet was genuinely running had no way to recover that fact from a plain GET and its
/// Stop button stayed disabled (self-healing only once Start was clicked, a no-op server-side). Mirrors
/// <see cref="FleetHost.IsRunning"/> directly.
///
/// <c>EstopEngaged</c> added for branch-review C-2: the HALT latch used to be component-local React
/// state on the HMI panel, so a second panel/tab/reload silently forgot an active halt. It now
/// lives here — mirrors <see cref="FleetHost.EstopEngaged"/> — so every observer of this same polled
/// snapshot (every HMI panel, every tab) agrees on the latch and a reload recovers it.</summary>
public sealed record FleetSnapshotDto(IReadOnlyList<FleetTileDto> Machines, FleetKpisDto Kpis, bool IsRunning, bool EstopEngaged);

// ─────────────────────────────────────────────────────────────────────────
// GET /v1/machines/{code} — E-2: moved here from Dtos.cs, same reasoning.
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

/// <summary>
/// 🔴 E-2 — the one place a <see cref="St4i.EdgeCore.Fleet"/> read-out record becomes a wire DTO.
///
/// <para><b>These are pure functions and they must stay pure.</b> Each one takes a record the core already
/// resolved under the right lock and reshapes it, field for field, with no second read of anything. The
/// per-field GATING (a stopped fleet reporting idle rather than the last real verdict) happens where it
/// always did — inside <see cref="MachineState.SnapshotTile"/>/<see cref="MachineState.SnapshotDetail"/>,
/// under that machine's own lock — never here, because a gate applied after the snapshot would be reading
/// <c>fleetRunning</c> at a different instant than the fields it gates.</para>
///
/// <para>The <c>ToTile</c>/<c>ToDetail</c> names survive as EXTENSION METHODS on
/// <see cref="MachineState"/> rather than being renamed: they were public API on that class before the cut,
/// with a no-argument back-compat overload each, and keeping them means every existing call site — the
/// engine's own and every test's — compiles unchanged. That is a deliberate choice to keep the move's
/// blast radius at the type boundary instead of spraying it across call sites.</para>
/// </summary>
public static class FleetProjections
{
    /// <summary>Snapshot for one <c>GET /v1/fleet</c> row, reporting the machine's real last-observed
    /// status. Equivalent to <see cref="ToTile(MachineState, bool)"/> with <c>fleetRunning: true</c> — kept
    /// for existing callers/tests that don't care about the running/stopped distinction.</summary>
    public static FleetTileDto ToTile(this MachineState state) => state.ToTile(fleetRunning: true);

    /// <summary>Snapshot for one <c>GET /v1/fleet</c> row. E1 (health-truth): when the fleet pipeline is NOT
    /// running the reported status is forced to idle regardless of the last real verdict — otherwise a
    /// stopped fleet keeps showing every tile as whatever it last was (e.g. "OK"/green), the "always healthy
    /// after Stop" bug this gate exists to fix. Cycles/PassRate/LastCycleSummary/the spark line are left
    /// untouched either way.</summary>
    public static FleetTileDto ToTile(this MachineState state, bool fleetRunning) =>
        ToTileDto(state.SnapshotTile(fleetRunning));

    /// <summary>Snapshot for <c>GET /v1/machines/{code}</c>, reporting the machine's real last-observed
    /// status unconditionally. Mirrors <see cref="ToTile(MachineState)"/>'s back-compat overload.</summary>
    public static MachineDetailDto ToDetail(this MachineState state) => state.ToDetail(fleetRunning: true);

    /// <summary>Snapshot for <c>GET /v1/machines/{code}</c>. Branch-review I-9: the SAME idle gate
    /// <see cref="ToTile(MachineState, bool)"/> applies. Before that fix, <c>ToDetail()</c> was the one
    /// snapshot that skipped it, so a stopped machine kept reporting its last real verdict to this endpoint
    /// while <c>GET /v1/fleet</c> correctly reported it idle — reproduced live as a stopped machine's HMI
    /// panel rendering a green "ĐẠT" pass badge.</summary>
    public static MachineDetailDto ToDetail(this MachineState state, bool fleetRunning) =>
        ToDetailDto(state.SnapshotDetail(fleetRunning));

    /// <summary>Field-for-field reshape of the core's tile record. Named (rather than inlined into
    /// <see cref="ToTile(MachineState, bool)"/>) so <see cref="FleetHost.Snapshot"/> can pass it as a method
    /// group over the list the core already built — one projection function, two call sites, no second
    /// statement of the mapping.</summary>
    public static FleetTileDto ToTileDto(MachineTileSnapshot tile) => new(
        tile.Code,
        tile.DeviceClass,
        tile.DriverKind,
        tile.StatusText,
        tile.PassRate,
        tile.Cycles,
        tile.LastCycleSummary,
        tile.Spark);

    /// <summary>Field-for-field reshape of the core's detail record. The board points are narrowed from the
    /// reading's own <see cref="MeasurementResult"/> to the four fields the wire carries — the same
    /// narrowing <c>MachineState.ToDetail</c> performed inline before the cut.</summary>
    public static MachineDetailDto ToDetailDto(MachineDetailSnapshot detail) => new(
        detail.Code,
        detail.DeviceClass,
        detail.DriverKind,
        detail.StatusText,
        detail.PassRate,
        detail.Cycles,
        new SpcSummaryDto(detail.Spc.Values, detail.Spc.Mean, detail.Spc.Ucl, detail.Spc.Lcl),
        detail.Telemetry.Select(t => new TelemetrySeriesDto(t.Metric, t.Values)).ToArray(),
        detail.BoardPoints.Select(m => new BoardPointDto(m.PointCode, m.Result, m.Bbox, m.DefectCatalogCode)).ToArray(),
        detail.CycleLog.Select(c => new CycleLogEntry(c.Time, c.Serial, c.Verdict, c.KeyMetric)).ToArray(),
        detail.DriftState,
        detail.Plan);

    /// <summary>Field-for-field reshape of the core's settings record.</summary>
    public static SettingsDto ToSettingsDto(FleetSettingsSnapshot settings) => new(
        settings.ServerUrl, settings.VerifyTls, settings.Language, settings.MachineCode, settings.Mode);
}
