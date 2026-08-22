using St4i.EdgeCore.Engine;
using St4i.EdgeCore.Infrastructure;
using St4i.EdgeCore.Models;
using St4i.EdgeCore.Transport;
using St4i.EngineApi.Fleet;
using Xunit;

namespace St4i.EngineApi.Tests;

/// <summary>
/// 🔴 <b>Item 33 (docs/owner-decisions.md) — the witnesses for the MIRROR of item 18.</b> Item 18 closed
/// "the gate does not guard the fabricator". This closes the opposite direction: <b>the fabricator is
/// taken away and the surface goes on reporting it</b>.
///
/// <para><b>The two states, named, because the fix depends on their being two.</b>
/// <c>FleetCore.CurrentScenario.NetworkOutage</c> is a DECLARED flag — written only by
/// <c>FleetCore.ApplyScenario</c>, never unwritten by anything. The transport actually installed is an
/// EVENT — <c>SwitchableTransport.Inner</c>. They drift because nothing connects them, and the drift is
/// one-directional: three paths replace the installed transport without touching the flag, and no path
/// clears the flag. <c>GET /v1/scenario</c> read the flag, so it answered "network outage" over a fleet
/// whose readings were reaching the real server.</para>
///
/// <para><b>Why these tests sit at the <see cref="FleetHost"/> seam rather than over HTTP.</b>
/// <c>GET /v1/scenario</c> is <c>host.CurrentScenarioDto()</c> and <c>PUT /v1/mode</c> is
/// <c>host.ApplyMode(...)</c> — one statement each, in <c>ScenarioEndpoints</c>/<c>ModeEndpoints</c>. This
/// seam is where the two states meet, so it is where a false report is produced or prevented; the route
/// wiring on top of it is witnessed once, end to end over real HTTP, in
/// <c>Auth/AuditWiringTests.ModeSwitch_AfterAnOutageScenario_LeavesNoAuditTrailOfTheClearedOutage</c>.
/// That split is deliberate: a per-path HTTP test would measure the same statement five times and the
/// route wiring zero extra times.</para>
///
/// <para><b>WITNESSES vs GUARDS, labelled from the CONTROL RUN and not from the author's intent.</b> This
/// paragraph said "three of the nine go RED at BASE" until the control pair was actually run, and the
/// measurement said <b>SIX</b>. Reverting the one-line change in <c>FleetHost.CurrentScenarioDto</c>
/// (fix removed, everything else in place) gives <c>Failed: 6, Passed: 3</c>; restoring it gives
/// <c>Passed: 9</c>. The three that were miscounted as pure guards
/// (<see cref="AfterAModeSwitch_TheThreeSimulatorKnobsAreStillReportedAsTheOperatorDeclaredThem"/>,
/// <see cref="AfterAModeSwitch_TheReportedPresetIsStillTheOneTheOperatorSelected"/>,
/// <see cref="AfterAModeSwitch_TheDeclaredFlagIsStillSet_WhichIsTheHalfTheReadSideFixDoesNotClose"/>)
/// each carry a witness assertion AND a guard assertion in one test, on purpose — the guard clause is
/// what stops the witness clause from being satisfied the wrong way. <b>The three that are GREEN ON BOTH
/// SIDES and are therefore guards and NOT witnesses</b> are
/// <see cref="WhileTheOutageTransportIsInstalled_TheReportedScenarioSaysSo"/>,
/// <see cref="WithNoScenarioEverApplied_TheReportedScenarioSaysNoOutage"/> and
/// <see cref="TheApplyResponse_ReportsWhatWasREQUESTED_NotWhatTheGetWouldDerive"/>. They exist because a
/// single "reports no outage" assertion is satisfied by a build that hard-coded <c>false</c> and by a
/// build that reset the whole scenario record on every mode change, silently discarding three
/// operator-set knobs.</para>
///
/// <para>🔴 <b>What is PINNED here rather than fixed, because it is a different decision.</b>
/// <see cref="AfterAModeSwitch_TheDeclaredFlagIsStillSet_WhichIsTheHalfTheReadSideFixDoesNotClose"/>
/// asserts that the declared flag survives. That is the residue of choosing the read-side remedy: the
/// surface stops lying, but the stale <see langword="true"/> can still reach back — <c>FleetCore.Burst</c>
/// re-applies <c>_scenario</c> and would re-install the fabricator from it. Pinning it makes a later
/// change to that behaviour a deliberate one instead of a silent one.</para>
/// </summary>
public sealed class ScenarioTransportTruthTests
{
    private const string OutagePreset = "network-outage";
    private static readonly ScenarioConfig OutageScenario = new(CycleRateMultiplier: 1.0, ExtraDefectRate: 0.0, FaultRate: 0.0, NetworkOutage: true);

    /// <summary>Same recipe the other FleetHost-seam suites in this project use, with two deliberate
    /// differences: <paramref name="initialMode"/> is a parameter because
    /// <c>TransportCoordinator.RebuildLive</c> only re-points the switchable when the mode is Live or
    /// Auto, and the WAL is DISABLED so <c>RebuildLive</c> resolves no queue file and creates no directory
    /// — this suite is about which transport instance is installed, not about persistence.</summary>
    private static (FleetHost Host, TransportCoordinator Coordinator, SwitchableTransport Switchable, DemoTransport Demo)
        CreateHost(TransportMode initialMode)
    {
        var demo = new DemoTransport(latencyMs: 0);
        var live = LiveTransport.ForMachine("http://localhost:1", mkKey: "", machineCode: "TEST", queuePath: null, verifyTls: true);
        var auto = new AutoTransport(live, demo);
        var switchable = new SwitchableTransport(demo);
        var coordinator = new TransportCoordinator(
            switchable, demo, live, auto, initialMode, walOptions: new WalOptions { Enabled = false });
        var host = new FleetHost(switchable, coordinator, new EventBus());
        return (host, coordinator, switchable, demo);
    }

    // ─────────────────────────────────────────────────────────────────────
    // GUARD — the feature still works. Without this half, a build that deleted the outage scenario
    // outright, or one that hard-coded `networkOutage: false`, would satisfy every witness below.
    // ─────────────────────────────────────────────────────────────────────

    [Fact]
    public void WhileTheOutageTransportIsInstalled_TheReportedScenarioSaysSo()
    {
        var (host, _, switchable, demo) = CreateHost(TransportMode.Live);

        host.ApplyScenario(OutageScenario, OutagePreset);

        var dto = host.CurrentScenarioDto();
        Assert.True(dto.NetworkOutage);
        Assert.Contains("network outage", dto.StatusLine, StringComparison.Ordinal);
        // And it really is a DIFFERENT instance from the DI Demo singleton — the property this whole fix
        // rests on. A mode comparison cannot see this: both answer TransportMode.Demo.
        Assert.NotSame(demo, switchable.Inner);
        Assert.Equal(TransportMode.Demo, switchable.Mode);
    }

    [Fact]
    public void WithNoScenarioEverApplied_TheReportedScenarioSaysNoOutage()
    {
        var (host, _, _, _) = CreateHost(TransportMode.Live);

        var dto = host.CurrentScenarioDto();
        Assert.False(dto.NetworkOutage);
        Assert.Contains("network normal", dto.StatusLine, StringComparison.Ordinal);
    }

    // ─────────────────────────────────────────────────────────────────────
    // WITNESSES — each is one of the three measured paths that replace the outage transport without
    // going near the declared flag. All three are RED at BASE e6faec60.
    // ─────────────────────────────────────────────────────────────────────

    [Fact]
    public void AfterAModeSwitchTookTheOutageTransportAway_TheReportedScenarioSaysNoOutage()
    {
        // The operator's own path: Scenario screen sets the outage, then anyone flips the TopBar mode.
        var (host, _, switchable, _) = CreateHost(TransportMode.Live);
        host.ApplyScenario(OutageScenario, OutagePreset);
        Assert.True(host.CurrentScenarioDto().NetworkOutage);

        host.ApplyMode(TransportMode.Auto);

        Assert.False(host.CurrentScenarioDto().NetworkOutage);
        Assert.Contains("network normal", host.CurrentScenarioDto().StatusLine, StringComparison.Ordinal);
        Assert.Equal(TransportMode.Auto, switchable.Mode);
    }

    [Fact]
    public void AfterAModeReApplyThatChangedNothing_TheReportedScenarioSaysNoOutage()
    {
        // TransportCoordinator.ApplyMode documents itself as "Idempotent — always re-applies", and raises
        // ModeChanged only when the value differs. So setting the mode to the value it ALREADY has swaps
        // the transport back and fires no event at all: no listener, no audit consumer and no log line can
        // see it happen. This is the quietest of the three paths and the reason a "listen for ModeChanged"
        // remedy would not have worked.
        var (host, coordinator, _, _) = CreateHost(TransportMode.Live);
        host.ApplyScenario(OutageScenario, OutagePreset);
        var events = 0;
        coordinator.ModeChanged += _ => events++;

        host.ApplyMode(TransportMode.Live);

        Assert.Equal(0, events);
        Assert.False(host.CurrentScenarioDto().NetworkOutage);
    }

    [Fact]
    public void AfterASettingsRebuildOnALiveHost_TheReportedScenarioSaysNoOutage()
    {
        // PUT /v1/settings -> FleetCore.UpdateSettings -> TransportCoordinator.RebuildLive, which ends in
        // `if (Mode is Live or Auto) ApplyModeInternal(Mode)` — the same SetInner call, reached without
        // any mode ever being chosen. Driven at the coordinator here, not through UpdateSettings, so the
        // test needs no credential store, no settings file and no fleet-settings root: RebuildLive is the
        // statement that moves the transport, and everything UpdateSettings does around it is persistence.
        var (host, coordinator, _, _) = CreateHost(TransportMode.Live);
        host.ApplyScenario(OutageScenario, OutagePreset);
        Assert.True(host.CurrentScenarioDto().NetworkOutage);

        coordinator.RebuildLive("http://localhost:2", machineCode: "TEST", mkKey: null, verifyTls: true);

        Assert.False(host.CurrentScenarioDto().NetworkOutage);
    }

    // ─────────────────────────────────────────────────────────────────────
    // GUARDS on the SHAPE of the fix — the two ways to satisfy the witnesses above and still be wrong.
    // ─────────────────────────────────────────────────────────────────────

    [Fact]
    public void AfterAModeSwitch_TheThreeSimulatorKnobsAreStillReportedAsTheOperatorDeclaredThem()
    {
        // The blind-sync mistake, caught on the axis it would show up on. A fix that cleared or re-derived
        // the whole ScenarioConfig on a mode change would pass every witness above while silently
        // discarding an Engineer's applied, audited cycle/defect/fault settings. Only the transport field
        // is derived; the other three are what they were declared to be, because they change what the
        // SIMULATORS produce and no mode switch touches that.
        var (host, _, _, _) = CreateHost(TransportMode.Live);
        host.ApplyScenario(new ScenarioConfig(CycleRateMultiplier: 2.5, ExtraDefectRate: 0.35, FaultRate: 0.05, NetworkOutage: true), "custom");

        host.ApplyMode(TransportMode.Demo);

        var dto = host.CurrentScenarioDto();
        Assert.False(dto.NetworkOutage);
        Assert.Equal(2.5, dto.CycleRate, 3);
        Assert.Equal(0.35, dto.DefectRate, 3);
        Assert.Equal(0.05, dto.FaultRate, 3);
    }

    [Fact]
    public void AfterAModeSwitch_TheReportedPresetIsStillTheOneTheOperatorSelected()
    {
        // Deliberate residue, pinned so it is a decision and not an oversight: ActivePreset reports the
        // operator's SELECTION, which stays true after the transport moves — only the transport clause was
        // ever a claim about the wire. The pair therefore renders as two true statements rather than one
        // lie, and anyone who later wants ActivePreset derived too has to move this assertion to do it.
        var (host, _, _, _) = CreateHost(TransportMode.Live);
        host.ApplyScenario(OutageScenario, OutagePreset);

        host.ApplyMode(TransportMode.Auto);

        var dto = host.CurrentScenarioDto();
        Assert.Equal(OutagePreset, dto.ActivePreset);
        Assert.Equal(
            "network-outage — cycleRate=1.00x, defect=0%, fault=0%, network normal.",
            dto.StatusLine);
    }

    [Fact]
    public void TheApplyResponse_ReportsWhatWasREQUESTED_NotWhatTheGetWouldDerive()
    {
        // The POST/GET split, asserted rather than left to a doc comment. ScenarioEndpoints hands this
        // exact instance to AuditRecorder as the scenario.apply payload, and an audit row answers "who
        // asked for what". Deriving it there would let a mode switch racing the apply record an operator
        // as having asked for something they did not.
        var (host, _, _, _) = CreateHost(TransportMode.Live);

        var applied = host.ApplyScenario(OutageScenario, OutagePreset);

        Assert.True(applied.NetworkOutage);
        Assert.Contains("network outage", applied.StatusLine, StringComparison.Ordinal);
    }

    // ─────────────────────────────────────────────────────────────────────
    // PINNED RESIDUE — what the read-side remedy does NOT close.
    // ─────────────────────────────────────────────────────────────────────

    [Fact]
    public void AfterAModeSwitch_TheDeclaredFlagIsStillSet_WhichIsTheHalfTheReadSideFixDoesNotClose()
    {
        // Both halves in one assertion pair, because stating either alone is the half-truth this whole
        // item is about. The REPORTED value is now the installed transport (false). The DECLARED value is
        // untouched (true) — nothing in the product clears it — so it can still reach back: FleetCore.Burst
        // re-applies `_scenario with { CycleRateMultiplier = 6.0 }`, which runs ApplyNetworkOutageLocked
        // (true) and re-installs the fabricator. Reconciling the two is a WRITE-side change whose price is
        // recorded in item 33; this test exists so that change is deliberate when someone makes it.
        var (host, _, _, _) = CreateHost(TransportMode.Live);
        host.ApplyScenario(OutageScenario, OutagePreset);

        host.ApplyMode(TransportMode.Auto);

        Assert.False(host.CurrentScenarioDto().NetworkOutage);
        Assert.True(host.CurrentScenario.NetworkOutage);
    }
}
