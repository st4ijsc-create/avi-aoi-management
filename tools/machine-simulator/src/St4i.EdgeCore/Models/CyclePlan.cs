namespace St4i.EdgeCore.Models;

/// <summary>
/// WS3-T1 (docs/PRODUCTION_UI_DESIGN.md §3.2) — one ordered step within a single cycle's
/// <see cref="CyclePlan"/>: a real point/target this cycle actually visits, in order, carrying ITS OWN
/// result. Every simulator that builds a <see cref="CyclePlan"/> derives each step's <see cref="Result"/>
/// from the EXACT SAME per-point/per-step draw that already feeds <see cref="DeviceReading.Verdict"/> —
/// never a second, independently-drawn narrative that could disagree with the aggregate (design-doc
/// §3.4/§4: "the aggregate should equal the per-step tally, don't double-count"). See
/// <c>AoiInspectorSim</c>/<c>ScrewdriveSim</c>/<c>IotSensorSim</c>'s own remarks for exactly how each
/// machine class's steps are built.
/// </summary>
/// <param name="Index">0-based position in <see cref="CyclePlan.Steps"/> — the order the head/camera
/// actually visits this cycle. A web twin uses this (plus <see cref="CyclePlan.StartedAt"/>/
/// <see cref="CyclePlan.DurationSeconds"/>) to interpolate the head's motion locally, with no per-frame
/// socket traffic.</param>
/// <param name="PointCode">The real point/target identity this step visits — a product
/// <c>MeasurementPoint.Code</c> for AOI when a product is configured on the machine, a fastening-position
/// code for SCREWDRIVE, or a telemetry channel name for IOT_SENSOR. Never a fabricated code with no real
/// referent behind it (see <c>AoiInspectorSim</c>'s remarks on why a plan is only emitted once a REAL
/// point set is resolvable).</param>
/// <param name="NormalizedX">0..1 position within the machine's own drawing surface (a product's
/// reference image for AOI, a synthetic fastening/sensor layout otherwise) — so a web twin can place the
/// head without knowing pixel dimensions.</param>
/// <param name="NormalizedY">0..1 position, same convention as <see cref="NormalizedX"/>.</param>
/// <param name="Result">This step's OWN pass/fail outcome — <c>"OK"</c> or <c>"NG"</c>, the same 2-token
/// vocabulary <see cref="MeasurementResult.Result"/> already uses — or <see langword="null"/> for a step
/// with no pass/fail concept (IOT_SENSOR telemetry has no verdict, mirroring
/// <see cref="DeviceReading.Verdict"/>'s own <see cref="Verdict.Skip"/> convention for that reading
/// kind).</param>
/// <param name="MetricValue">This step's own measured value (torque, match score, sensor reading —
/// whatever <see cref="Unit"/> names), or null if none applies.</param>
/// <param name="Unit">Unit for <see cref="MetricValue"/>, or null.</param>
public sealed record CyclePlanStep(
    int Index,
    string PointCode,
    double NormalizedX,
    double NormalizedY,
    string? Result,
    double? MetricValue,
    string? Unit);

/// <summary>
/// WS3-T1 — the ordered list of steps ONE cycle visits, plus the wall-clock start and expected duration a
/// web twin paces its own LOCAL interpolation against: the engine produces this once per cycle (alongside
/// the <see cref="DeviceReading"/> it describes), and a browser can animate smoothly between
/// <see cref="Steps"/> using <see cref="StartedAt"/>/<see cref="DurationSeconds"/> — no high-frequency
/// socket needed for smooth motion (design-doc §3.2: "engine sends the plan at cycle start + cycle
/// timing; the web animates locally"). <see langword="null"/> on <see cref="DeviceReading.Plan"/> for any
/// simulator this task doesn't wire a plan for (WELDER/DISPENSING/ASSEMBLY/LEAK_TEST/FUNCTIONAL_TEST),
/// and cleared to null on the <c>GET /v1/machines/{code}</c> surface whenever the fleet isn't actually
/// running (<c>MachineState.ToDetail</c>'s own idle gate) — "idle machine = no active plan, twin renders
/// static."
/// </summary>
public sealed record CyclePlan(
    long CycleCounter,
    DateTimeOffset StartedAt,
    double DurationSeconds,
    IReadOnlyList<CyclePlanStep> Steps);
