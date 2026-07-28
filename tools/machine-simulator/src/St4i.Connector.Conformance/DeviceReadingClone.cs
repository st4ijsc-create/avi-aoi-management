using St4i.Connector.Abstractions.Models;

namespace St4i.Connector.Conformance;

/// <summary>
/// GP-6 — a deep-enough copy of a <see cref="DeviceReading"/> to detect in-place mutation of a
/// previously-yielded instance (see <see cref="DeviceDriverConformanceSuite.Check_ReadAsync_NeverReusesOrMutatesAYieldedReading"/>).
///
/// <para><b>Why not just <c>reading with { }</c>/a shallow copy:</b> <see cref="DeviceReading"/> is a plain
/// mutable class (not a record) — a shallow copy would still share every list/dictionary reference with the
/// original, so a driver that reuses the SAME <c>List&lt;TelemetrySample&gt;</c> instance across cycles
/// (wrapping it in a fresh <see cref="DeviceReading"/> each time) would corrupt this "snapshot" right along
/// with the original the moment the next cycle mutates that shared list — defeating the whole point of
/// snapshotting. Every collection-typed member below is copied into a NEW container so a later cycle's
/// mutation of the ORIGINAL cannot reach back into a snapshot taken earlier.</para>
///
/// <para>The record-typed ELEMENTS inside those containers (<see cref="MetricSample"/>,
/// <see cref="WaveformSeries"/>, <see cref="MeasurementResult"/>, <see cref="TelemetrySample"/>,
/// <see cref="CyclePlanStep"/>) are themselves immutable (positional records — <c>{ get; init; }</c>
/// properties only) and safe to share by reference, with ONE exception: <see cref="WaveformSeries.Samples"/>
/// is an <c>IReadOnlyList&lt;double[]&gt;</c> — the ARRAYS inside are ordinary mutable CLR arrays, so those
/// are cloned element-by-element too.</para>
/// </summary>
internal static class DeviceReadingClone
{
    public static DeviceReading Clone(DeviceReading r) => new()
    {
        MachineCode = r.MachineCode,
        Kind = r.Kind,
        SerialNumber = r.SerialNumber,
        StepType = r.StepType,
        Verdict = r.Verdict,
        RecipeCode = r.RecipeCode,
        RecipeVersion = r.RecipeVersion,
        Metrics = new List<MetricSample>(r.Metrics),
        Waveforms = r.Waveforms
            .Select(w => w with { Samples = w.Samples.Select(s => (double[])s.Clone()).ToList() })
            .ToList(),
        Measurements = new List<MeasurementResult>(r.Measurements),
        Telemetry = new List<TelemetrySample>(r.Telemetry),
        CycleCounter = r.CycleCounter,
        Timestamp = r.Timestamp,
        Genealogy = r.Genealogy is null ? null : new Dictionary<string, object>(r.Genealogy),
        Plan = r.Plan is null ? null : r.Plan with { Steps = new List<CyclePlanStep>(r.Plan.Steps) },
    };
}
