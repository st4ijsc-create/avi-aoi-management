namespace St4i.EdgeCore.Engine;

/// <summary>
/// The knobs a scenario/exhibition control surface tunes, applied at runtime via a fleet
/// orchestrator's own "apply scenario" method (the WPF app's <c>FleetService.ApplyScenario</c>; the
/// headless EngineApi host's <c>FleetHost.ApplyScenario</c>). An immutable record (not a mutable
/// class): every change replaces the whole value via <c>with</c>, so the current scenario can be read
/// from any thread as a single atomic snapshot with no locking required on the reader's side.
///
/// Relocated from the WPF app's <c>St4iMachineSimulator.Services.ScenarioConfig</c> into EdgeCore
/// (Task 3, ASP.NET EngineApi host) — this record only ever depended on EdgeCore types.
/// </summary>
/// <param name="CycleRateMultiplier">
/// Speed multiplier applied to every machine's <see cref="St4i.EdgeCore.Models.MachineDescriptor.CycleSeconds"/>
/// (baked into the descriptors the fleet builds sims from — restarts a running fleet when changed).
/// 1.0 = each sim's own authored cadence; &gt;1.0 = faster (shorter interval); &lt;1.0 = slower.
/// </param>
/// <param name="ExtraDefectRate">
/// Extra probability [0,1], on top of whatever a sim's own physics already produces, that
/// <see cref="ScenarioAwareDriver"/> flips a reading to <see cref="St4i.Connector.Abstractions.Models.Verdict.Fail"/>
/// (and, for AOI/Inspection readings, marks one measurement NG) — sim-agnostic post-processing, not a
/// per-simulator parameter, so it works identically across every
/// <see cref="St4i.EdgeCore.Drivers.Simulators.IMachineSimulator"/> type in the fleet.
/// </param>
/// <param name="FaultRate">
/// A second injected-failure probability [0,1], combined with <see cref="ExtraDefectRate"/> by
/// <see cref="ScenarioAwareDriver"/> — kept as its own slider/preset knob for demo storytelling
/// ("intermittent faults" vs. "a bad lot") even though today it drives the same injection path.
/// </param>
/// <param name="NetworkOutage">
/// When true, the fleet orchestrator points its DI <c>SwitchableTransport</c> at a lossy
/// <see cref="St4i.EdgeCore.Transport.DemoTransport"/> (high <c>fakeErrorRate</c>) instead of whatever
/// Live/Demo/Auto transport the current Mode normally resolves to — acks come back queued/failed while
/// the fleet keeps running, and restoring this to false re-points the transport at the CURRENT Mode's
/// real instance (not necessarily Demo).
/// </param>
public sealed record ScenarioConfig(
    double CycleRateMultiplier = 1.0,
    double ExtraDefectRate = 0.0,
    double FaultRate = 0.0,
    bool NetworkOutage = false)
{
    /// <summary>The fleet's un-tuned baseline, and this record's own default field values. Named so
    /// call sites read as intent rather than a bare <c>new ScenarioConfig()</c>.</summary>
    public static readonly ScenarioConfig Normal = new();
}
