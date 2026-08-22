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
/// When true, the fleet orchestrator points its DI <c>SwitchableTransport</c> at a
/// <see cref="St4i.EdgeCore.Transport.DemoTransport"/> built with <c>fakeErrorRate: 0.9</c> instead of
/// whatever Live/Demo/Auto transport the current Mode normally resolves to. The fleet keeps running, and
/// restoring this to false re-points the transport at the CURRENT Mode's real instance (not necessarily
/// Demo).
///
/// 🔴 CORRECTED: this used to say acks come back "queued/failed". They do not, and no run ever produced
/// the second half of that pair. Measured on every branch of
/// <see cref="St4i.EdgeCore.Transport.DemoTransport.SendAsync"/>: the queued branch returns
/// <c>Success=true, Queued=true</c>, and the three acking branches return <c>Success=true</c> with
/// HTTP 201/201/202. NO branch of that class returns an unsuccessful ack — the class's own
/// <c>fakeErrorRate</c> doc says the same thing about itself. What <c>0.9</c> buys is the fraction of
/// sends routed into the QUEUED branch, not a failure rate; the parameter is misnamed, and the
/// misnaming is what this sentence used to repeat. So an operator running this scenario sees acks that
/// are queued, never acks that failed, and a soak or acceptance run that uses this scenario to exercise
/// failed-ack handling exercises nothing and is green for that reason.
///
/// 🔴 CORRECTED 2026-08-22 (item 33): "restoring this to false re-points the transport" is true and is
/// only half the traffic. <b>This field is a DECLARED intent, not a reading of the transport.</b> It is
/// written in one place (<c>FleetCore.ApplyScenario</c>) and nothing else ever clears it — while THREE
/// other paths replace the installed transport without going near it:
/// <c>TransportCoordinator.ApplyMode</c> (target set <c>{_live, _auto, _demo}</c>, which excludes the
/// outage instance, and which re-applies even when the mode does not change),
/// <c>TransportCoordinator.RebuildLive</c> reached from a settings edit on a Live/Auto host, and a switch
/// to Demo, which installs the DI <c>DemoTransport</c> singleton rather than this scenario's
/// <c>fakeErrorRate: 0.9</c> one. So <c>true</c> here means "an operator asked for an outage and nothing
/// has re-applied a mode since", NOT "the fleet is behind a fabricator". Anything that needs the second
/// question answered must read <c>FleetCore.NetworkOutageTransportInstalled</c>; <c>GET /v1/scenario</c>
/// now does. <b>The flag still reaches back:</b> a later <c>Burst</c> re-applies this record and
/// therefore re-installs the outage transport from a stale <c>true</c>.
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
