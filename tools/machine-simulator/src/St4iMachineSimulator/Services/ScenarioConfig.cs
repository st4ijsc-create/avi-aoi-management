namespace St4iMachineSimulator.Services;

/// <summary>
/// Task 19b — the knobs the Scenario screen's sliders/presets tune, applied at runtime via
/// <see cref="FleetService.ApplyScenario"/>. An immutable record (not a mutable class): every change
/// replaces the whole value via <c>with</c> (see <c>ScenarioViewModel</c> and
/// <see cref="FleetService.Burst"/>), so <see cref="FleetService.Scenario"/> can be read from any
/// thread as a single atomic snapshot with no locking required on the reader's side.
/// </summary>
/// <param name="CycleRateMultiplier">
/// Speed multiplier applied to every machine's <see cref="St4i.EdgeCore.Models.MachineDescriptor.CycleSeconds"/>
/// (baked into the descriptors <see cref="FleetService"/> builds sims from — see its remarks for why
/// this is the one knob that restarts a running fleet). 1.0 = each sim's own authored cadence;
/// &gt;1.0 = faster (shorter interval); &lt;1.0 = slower.
/// </param>
/// <param name="ExtraDefectRate">
/// Extra probability [0,1], on top of whatever a sim's own physics already produces, that
/// <see cref="Services.ScenarioAwareDriver"/> flips a reading to <see cref="St4i.EdgeCore.Models.Verdict.Fail"/>
/// (and, for AOI/Inspection readings, marks one measurement NG) — sim-agnostic post-processing, not a
/// per-simulator parameter, so it works identically across every <see cref="St4i.EdgeCore.Drivers.Simulators.IMachineSimulator"/>
/// type in the fleet.
/// </param>
/// <param name="FaultRate">
/// A second injected-failure probability [0,1], combined with <see cref="ExtraDefectRate"/> by
/// <see cref="Services.ScenarioAwareDriver"/> (doc 19b brief: fold FaultRate into ExtraDefectRate's
/// mechanism when a distinct "faulted machine" visual isn't worth the extra plumbing) — kept as its own
/// slider/preset knob for demo storytelling ("intermittent faults" vs. "a bad lot") even though today
/// it drives the same injection path.
/// </param>
/// <param name="NetworkOutage">
/// When true, <see cref="FleetService"/> points the DI <c>SwitchableTransport</c> at a lossy
/// <see cref="St4i.EdgeCore.Transport.DemoTransport"/> (high <c>fakeErrorRate</c>) instead of whatever
/// Live/Demo/Auto transport the shell's Mode selector normally resolves to — acks come back
/// queued/failed while the fleet keeps running, and restoring this to false re-points the transport at
/// the CURRENT Mode's real instance (not necessarily Demo — see <see cref="FleetService.ApplyScenario"/>).
/// </param>
public sealed record ScenarioConfig(
    double CycleRateMultiplier = 1.0,
    double ExtraDefectRate = 0.0,
    double FaultRate = 0.0,
    bool NetworkOutage = false)
{
    /// <summary>"Ca bình thường" — the fleet's un-tuned baseline, and this record's own default field
    /// values. Named so call sites (<see cref="FleetService"/>'s field initializer, the preset list)
    /// read as intent rather than a bare <c>new ScenarioConfig()</c>.</summary>
    public static readonly ScenarioConfig Normal = new();
}
