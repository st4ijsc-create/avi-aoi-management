namespace St4i.EdgeCore.Models;

// GP-1 (.superpowers/sdd/2026-07-28-wsg-plugin-connector-seam-blueprint/task-1-brief.md) — ReadingKind,
// DriverKind, DeviceClass, DriverHealthState, and Verdict moved to
// St4i.Connector.Abstractions.Models.Enums (the driver contract). TransportMode stays here: it is a host
// transport concern (Live/Demo/Auto — which transport EdgeCore's own pipeline talks to), not part of what
// a third-party driver author needs.
/// <summary>
/// Which transport a host's <c>SwitchableTransport</c> is currently pointed at. The SPELLING of the
/// members below is published three times over, so renaming one is a contract change and not a refactor:
/// the EngineApi registers a string enum converter, making these words the literal bodies of
/// <c>GET /v1/mode</c> and <c>PUT /v1/mode</c> and the literal values written into the audit row for a
/// mode switch; the browser client re-declares them by hand as a TypeScript union; and the WPF shell
/// binds <c>Enum.GetValues&lt;TransportMode&gt;()</c> straight into its top-bar and Settings combo boxes,
/// which makes the DECLARATION ORDER here the order that operator sees.
///
/// <para>🔴 A value read off a transport is a property of the CLASS, not a report about connectivity:
/// <c>LiveTransport.Mode</c> answers <see cref="Live"/> whether or not a server was ever configured or is
/// reachable. And the two published <c>Mode</c> properties can disagree — <c>TransportCoordinator.Mode</c>
/// is the mode the operator chose, while <c>SwitchableTransport.Mode</c> is whatever the inner transport
/// says, and the network-outage scenario re-points the inner one without telling the coordinator (see
/// <c>ScenarioConfig.NetworkOutage</c>).</para>
/// </summary>
public enum TransportMode
{
    /// <summary>Send over HTTP to the configured ecosystem server, with the SDK's own retry and its
    /// on-disk store-and-forward queue behind it. This is the only mode in which the WAL flush pump has
    /// anything to do: both composition roots hand it a <c>getLive</c> that returns null unless the
    /// coordinator's mode is exactly this one, so a backlog left behind by an outage stops being drained
    /// the moment the operator switches away.</summary>
    Live,

    /// <summary>Fabricate the replies locally and touch no network at all — the exhibition posture. It is
    /// the only member a deployment can refuse: <c>PUT /v1/mode</c> answers 400 for this value when
    /// <c>DemoModeGate.Enabled</c> is false, which is why a host can be in a state where the operator can
    /// leave Demo but not re-enter it.
    ///
    /// <para>🔴 CORRECTED — this used to record that the refusal guarded the MODE and not the fabricator:
    /// that <c>POST /v1/scenario</c> with <c>networkOutage</c> set was not gated by <c>DemoModeGate</c> at
    /// all and pointed the running fleet's transport straight at a lossy <see cref="Demo"/> instance,
    /// audited and Engineer-only but never refused. <c>ScenarioEndpoints</c> now applies the same gate to
    /// BOTH scenario routes that can install that transport (<c>POST /v1/scenario</c> and
    /// <c>POST /v1/scenario/preset</c>), so on a deployment with Demo disabled the fleet can no longer be
    /// put behind a fabricator while <c>GET /v1/mode</c> answers <see cref="Live"/>.</para>
    ///
    /// <para>Still true, and still worth knowing: <c>GET /v1/mode</c> answers the SELECTED mode by design,
    /// not what is serving traffic. The surface that reports the outage is <c>GET /v1/scenario</c>, which
    /// carries the <c>NetworkOutage</c> flag and a status line naming it; the surface that reports the
    /// transport actually installed is <c>SwitchableTransport.Mode</c>, which the API-trace pane
    /// reads.</para>
    ///
    /// <para>🔴 CORRECTED 2026-08-22 (item 33) — the paragraph above is kept verbatim and its last clause
    /// was only ever half of a measurement. <c>GET /v1/scenario</c> reported the flag an operator had
    /// DECLARED, and three paths take the outage transport away without clearing it
    /// (<c>PUT /v1/mode</c> including a re-apply of the running mode, <c>PUT /v1/settings</c> on a
    /// Live/Auto host, and a switch to this member), so that route answered "outage" over a fleet whose
    /// readings were reaching the real server. It now reports the transport actually installed, via
    /// <c>FleetCore.NetworkOutageTransportInstalled</c>. And <see cref="Mode"/> on
    /// <c>SwitchableTransport</c> is the WEAKER of the two instruments, not the stronger: it answers this
    /// member for both the outage <c>DemoTransport</c> and the DI Demo singleton, so it cannot tell a
    /// selected exhibition posture from a scenario that dragged a Live fleet onto a fabricator. Reference
    /// identity can, and that is what the new member uses.</para></summary>
    Demo,

    /// <summary>Try live for every call and re-route to demo on a network failure, re-probing live
    /// periodically. 🔴 The two front ends disagree about whether this member exists, deliberately and in
    /// writing: WS2-T1 dropped it from the browser UI, whose top bar and Settings screen both offer a
    /// hand-written <c>["Live", "Demo"]</c>, while the WPF exhibition shell still offers whatever
    /// <c>Enum.GetValues</c> returns and therefore still offers this. <c>PUT /v1/mode</c> accepts it from
    /// either, so a deployment driven from the browser can still be put into this mode — by the other
    /// front end, by a script, or by a host that started in it.</summary>
    Auto,
}
