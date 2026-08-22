using St4i.EdgeCore.Config;
using St4i.EngineApi.Auth;
using St4i.EngineApi.Fleet;
using St4i.EngineApi.Policy;

namespace St4i.EngineApi.Endpoints;

/// <summary><c>POST /v1/scenario {cycleRate,defectRate,faultRate,networkOutage}</c> ·
/// <c>POST /v1/scenario/preset {name}</c> · <c>POST /v1/scenario/burst</c>. Also exposes a <c>GET
/// /v1/scenario</c> (not required by the Task 3 brief, but a natural low-cost addition — lets a client
/// read the currently-active scenario/preset without guessing).
///
/// 🔴 <b>THE DEMO GATE GUARDS THE FABRICATING TRANSPORT HERE, NOT ONLY THE MODE.</b>
/// <see cref="DemoModeGate"/>'s own doc states the purpose of its safe default as "nobody can switch this
/// machine's transport to a fabricated fleet by mistake", but until this was written only
/// <c>ModeEndpoints</c>' <c>PUT /v1/mode</c> consulted it. The scenario routes reached the SAME outcome —
/// <c>FleetCore.ApplyNetworkOutageLocked</c> calls <c>SwitchableTransport.SetInner</c> with a
/// <c>DemoTransport(fakeErrorRate: 0.9)</c>, so every reading is acked locally and nothing reaches the
/// ecosystem server — without consulting the flag at all, while <c>GET /v1/mode</c> kept answering the
/// SELECTED mode (<c>Live</c>). One surface said "Live", the other sent nothing.
///
/// <b>The gate below covers the set that was MEASURED, not one route name.</b> Two routes can install
/// that transport, not one: <c>POST /v1/scenario</c> with <c>networkOutage:true</c>, and
/// <c>POST /v1/scenario/preset</c> with a preset whose own <see cref="ScenarioPresetInfo.Config"/> carries
/// <c>NetworkOutage</c> — today the shipped <c>"network-outage"</c> entry, which is why this checks the
/// resolved preset's config rather than hard-coding that name. <c>POST /v1/scenario/burst</c> only moves
/// <c>CycleRateMultiplier</c> and is therefore NOT gated.
///
/// <b>The other three <c>ScenarioConfig</c> fields are deliberately NOT gated, and that is a measurement
/// rather than an omission.</b> The record has exactly four: <c>CycleRateMultiplier</c>,
/// <c>ExtraDefectRate</c>, <c>FaultRate</c>, <c>NetworkOutage</c>. Only the last one touches the
/// TRANSPORT, which is the axis this flag governs — the other three change what the SIMULATORS produce,
/// and the readings they produce are still sent to the real server and are still reported truthfully by
/// <c>GET /v1/scenario</c> (<see cref="ScenarioDto"/> carries all four values plus a status line). Gating
/// them would not be an extension of this flag's meaning; it would be a claim that a machine SIMULATOR
/// must not simulate, which is not what the flag says and not what turning Demo off buys.
///
/// <b>Reverse direction, because leaving it out would make this a half-truth.</b> The outage scenario is
/// a deliberate exhibition storytelling feature, and this rejection removes it from every deployment that
/// has Demo disabled — that is a real capability loss, not a free win, and it is the price of making the
/// flag mean one thing instead of two. The path being closed was never anonymous or unprivileged: it
/// already required <c>Policies.Engineer</c> and already wrote a <c>scenario.apply</c> audit row carrying
/// the whole applied scenario, and it was already reversible. What it was not, is refusable.
///
/// <b>No new field was added to any published payload.</b> The question "which surface tells the truth
/// when a scenario drags the transport away from the selected mode" already has an answer that ships:
/// <c>GET /v1/scenario</c> returns <c>NetworkOutage</c> and a status line naming the outage, under
/// <c>Policies.Operator</c>. <c>GET /v1/mode</c> continues to answer the SELECTED mode, which is what its
/// own doc on <c>TransportCoordinator.Mode</c> says it answers.
///
/// 🔴 <b>CORRECTED 2026-08-22 (item 33) — THE PARAGRAPH ABOVE IS KEPT VERBATIM AND IT WAS TRUE IN EXACTLY
/// ONE DIRECTION.</b> It closed a STOP condition ("do not add a field to a published payload") on the
/// ground that a truthful surface already shipped. Measured on the OTHER direction it was false: the
/// question that paragraph answers is "a scenario drags the transport away from the selected mode", and
/// the mirror case — <b>a MODE CHANGE drags the transport away from the scenario</b> — got the opposite
/// answer. <c>PUT /v1/mode</c> re-points <c>SwitchableTransport</c> at one of <c>{_live, _auto, _demo}</c>
/// and the outage instance is in none of them, so it silently replaced the fabricator while
/// <c>FleetCore._scenario.NetworkOutage</c> stayed <see langword="true"/> — and this route's own
/// <c>GET</c> went on answering <c>networkOutage: true</c> with a status line naming an outage, once per
/// second, over a fleet that was reaching the real server. Two further paths do the same:
/// <c>PUT /v1/settings</c> (via <c>TransportCoordinator.RebuildLive</c>, on any Live/Auto host) and a
/// <c>PUT /v1/mode</c> that does not change the value at all, which re-applies without raising
/// <c>ModeChanged</c>.
///
/// <b>The conclusion survives; its ground was replaced.</b> No field was added now either — the fix is on
/// the READ side and changes what <c>NetworkOutage</c> MEANS on this <c>GET</c>, from "declared" to
/// "installed", with the record's shape untouched. See <c>ScenarioDto</c>'s own remarks for why the three
/// <c>POST</c> routes deliberately keep answering "requested" (their value is what the audit row records),
/// and <c>FleetCore.NetworkOutageTransportInstalled</c> for why reference identity rather than
/// <c>SwitchableTransport.Mode</c> is what the <c>GET</c> now reads. <b>The gate authored below is
/// untouched by all of this</b> — it runs before <c>FleetHost.ApplyScenario</c> and decides admission,
/// and its four witnesses are unmoved.</summary>
public static class ScenarioEndpoints
{
    /// <summary>The honest 400 body, worded like <c>ModeEndpoints</c>' own Demo rejection so an operator
    /// meets one sentence rather than two dialects of the same refusal.</summary>
    private const string OutageGateMessage =
        "Demo mode is not enabled on this deployment, so the network-outage scenario cannot be applied: " +
        "it would point the running fleet at a fabricated transport and nothing would reach the server.";

    public static void MapScenarioEndpoints(this IEndpointRouteBuilder app)
    {
        app.MapGet("/v1/scenario", (FleetHost host) => Results.Ok(new
        {
            current = host.CurrentScenarioDto(),
            presets = host.ListPresets(),
        })).RequireAuthorization(Policies.Operator);

        app.MapPost("/v1/scenario", async (
            ScenarioRequest request, FleetHost host, DemoModeGate demoGate, HttpContext context, AuditRecorder recorder, CancellationToken ct) =>
        {
            var config = request.ToScenarioConfig();
            if (config.NetworkOutage && !demoGate.Enabled)
            {
                // Rejected mutation (400) — per the WS-D-D4 ordering rule, no audit row is written here,
                // exactly like ModeEndpoints' own Demo rejection. Nothing has been applied at this point:
                // the check runs BEFORE host.ApplyScenario, so a refused request leaves the running fleet's
                // scenario and transport byte-for-byte where they were.
                return Results.BadRequest(new ApiErrorDto(OutageGateMessage));
            }

            var applied = host.ApplyScenario(config);
            await recorder.RecordAsync(context, "scenario.apply", null, null, null, applied, ct).ConfigureAwait(false);
            return Results.Ok(applied);
        }).RequireAuthorization(Policies.Engineer);

        app.MapPost("/v1/scenario/preset", async (
            ScenarioPresetRequest request, FleetHost host, DemoModeGate demoGate, HttpContext context, AuditRecorder recorder, CancellationToken ct) =>
        {
            // The SECOND route into the same transport swap, which is why the gate is applied to the
            // resolved preset's own config rather than to a route name or a hard-coded preset name: any
            // future catalogue entry carrying NetworkOutage is covered without editing this line. Matched
            // with the SAME case-insensitive rule FleetHost.ApplyPresetAsync uses, so a name that would
            // resolve there resolves here; an unknown name falls through untouched and still gets the
            // pre-existing 404 below rather than being masked by this 400.
            var candidate = host.ListPresets()
                .FirstOrDefault(p => string.Equals(p.Name, request.Name, StringComparison.OrdinalIgnoreCase));
            if (candidate is not null && candidate.Config.NetworkOutage && !demoGate.Enabled)
            {
                return Results.BadRequest(new ApiErrorDto(OutageGateMessage));
            }

            var (preset, applied, hotFolderStatus) = await host.ApplyPresetAsync(request.Name, ct).ConfigureAwait(false);
            if (preset is null)
            {
                // Rejected mutation (404 — unknown preset) — per the WS-D-D4 ordering rule, no audit row.
                var known = string.Join(", ", host.ListPresets().Select(p => p.Name));
                return Results.NotFound(new ApiErrorDto($"unknown preset \"{request.Name}\" — known: {known}"));
            }

            await recorder.RecordAsync(context, "scenario.preset", null, request.Name, null, new { scenario = applied, hotFolderStatus }, ct)
                .ConfigureAwait(false);
            return Results.Ok(new { scenario = applied, hotFolderStatus });
        }).RequireAuthorization(Policies.Engineer);

        app.MapPost("/v1/scenario/burst", async (FleetHost host, HttpContext context, AuditRecorder recorder, PolicyEngine policy, CancellationToken ct) =>
        {
            var decision = policy.Evaluate(PolicyRequest.For(context, "scenario.burst", host.GetSafetyStatus()));
            if (!decision.IsPermitted)
                return await PolicyResults.DenyAsync(context, recorder, "scenario.burst", decision, ct).ConfigureAwait(false);

            var applied = host.Burst();
            await recorder.RecordAsync(context, "scenario.burst", null, null, null, applied, ct).ConfigureAwait(false);
            return Results.Ok(applied);
        }).RequireAuthorization(Policies.Engineer);
    }
}
