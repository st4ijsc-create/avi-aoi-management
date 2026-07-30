using System.Text.Json;
using St4i.Connector.Abstractions.Json;
using St4i.Connector.Abstractions.Models;
using St4i.EngineApi.Alarms;
using St4i.EngineApi.Auth;
using St4i.EngineApi.Fleet;
using St4i.EngineApi.Policy;

namespace St4i.EngineApi.Endpoints;

/// <summary>
/// Task B-6 (.superpowers/sdd/2026-07-29-dotB-machine-control-blueprint/task-6-brief.md) — the last thing
/// standing between an authenticated session and a moving machine: <c>POST /v1/machines/{code}/setpoint</c>
/// and <c>POST /v1/machines/{code}/command</c>, wired through B-2's <see cref="FleetHost.TryWriteSetpointAsync"/>/
/// <see cref="FleetHost.TryInvokeCommandAsync"/> resolution path, gated by BOTH <see cref="PolicyEngine"/> and
/// <c>RequireAuthorization</c> (the deliberate redundancy every policy-gated route in this codebase already
/// carries — "no back-door for a future non-HTTP command path"), and audited.
///
/// <para><b>The canonical pattern</b> (<c>FleetEndpoints</c>/<c>LineEndpoints</c>): evaluate policy →
/// <see cref="PolicyResults.DenyAsync"/> on deny → mutate → <c>recorder.RecordAsync</c>. Followed exactly,
/// with one addition <see cref="Line.LineController"/>'s own gate motivates: a Critical-alarm check
/// (<see cref="Policy.Rules.CriticalAlarmGuardRule"/>) resolved BEFORE <see cref="PolicyEngine.Evaluate"/>,
/// the same "resolve async facts once, keep every <see cref="Policy.IPolicyRule"/> synchronous" shape
/// <c>LineEndpoints.AnyCriticalAlarmActiveAsync</c> already established for <c>line.start</c>/<c>line.unhold</c>.</para>
///
/// <para><b>Commands are gated more strictly than setpoints</b> — <c>machine.setpoint.write</c> requires
/// <see cref="Policies.Engineer"/>, <c>machine.command.invoke</c> requires <see cref="Policies.Admin"/>. See
/// <see cref="Policy.Rules.RoleObligationRule"/>'s own doc comment for the full argument (setpoint sits beside
/// the config/connector mutations Engineer already gates; a command can fire real, ungoverned motion — B-5's
/// own "highest-risk surface this batch" — so it sits beside this product's other single highest-consequence
/// action, identity rotation, at Admin).</para>
///
/// <para><b><see cref="Policy.Rules.EstopGuardRule"/> covers both actions</b> (the batch's one non-negotiable
/// invariant) — both <c>machine.setpoint.write</c>/<c>machine.command.invoke</c> are in that rule's
/// <c>ActuatingActions</c> set, proven directly in <c>EstopGuardRuleTests</c> and end-to-end in
/// <c>MachineWriteEndpointsTests</c> (latch HALT, attempt both, assert <c>SAFETY_BLOCKED</c>). HALT and its
/// reset remain reachable regardless — neither is in <see cref="Policy.Rules.EstopGuardRule"/>'s
/// <c>ActuatingActions</c> set, unchanged by this task.</para>
///
/// <para><b>The four (five, counting <see cref="MachineDriverAvailability.AmbiguousDriver"/>)
/// not-available cases are distinguished, never collapsed</b>: <see cref="MachineDriverAvailability.MachineNotFound"/>
/// is a <c>404</c> (same <see cref="ApiErrorDto"/> shape <c>GET /v1/machines/{code}</c> already uses for an
/// unknown code); <see cref="MachineDriverAvailability.NoLiveDriver"/>/<see cref="MachineDriverAvailability.ReadOnly"/>/
/// <see cref="MachineDriverAvailability.AmbiguousDriver"/> are each a <c>409</c> with their OWN
/// <see cref="MachineWriteUnavailableDto.Reason"/> code and an actionable message (see
/// <see cref="NotAvailableResult"/>) — never one generic "not available" error.</para>
///
/// <para><b>Every write outcome (<see cref="WriteOutcome.Applied"/>/<see cref="WriteOutcome.Rejected"/>/
/// <see cref="WriteOutcome.Failed"/>/<see cref="WriteOutcome.Indeterminate"/>) returns <c>200 OK</c>, never a
/// 4xx/5xx — deliberately.</b> This mirrors <c>POST /v1/connectors/test</c>'s own established precedent
/// (<see cref="ConnectorTestResultDto"/>'s own doc comment: "the verdict IN the body, never an
/// exception-shaped response") for a stronger reason here than mere consistency: this batch's own carried
/// findings include a transport layer that silently RESENT an unacknowledged write (double actuation). Many
/// HTTP client stacks/proxies retry automatically on a 5xx (and some on selected 4xx) status — mapping
/// <see cref="WriteOutcome.Failed"/>/<see cref="WriteOutcome.Indeterminate"/> to such a status would invite
/// exactly that class of automatic retry AT THE HTTP LAYER, for a write whose entire contract (B-1) is "MUST
/// NOT be retried, ever, including on a timeout". <c>200</c> plus an <c>outcome</c> field IN the body is the
/// one status/shape combination no generic HTTP client/proxy is tempted to retry on its own. A genuinely
/// UNATTEMPTED write (the four/five not-available cases above, where no I/O happened at all) is the only
/// case that gets a non-200 status — retrying THAT is always safe, since nothing was ever attempted.</para>
///
/// <para><b>The Critical-alarm decision</b> — see <see cref="Policy.Rules.CriticalAlarmGuardRule"/>'s own doc
/// comment for the full argument (yes, a Critical alarm blocks a write/command, mirroring
/// <see cref="Line.LineController"/>'s existing precedent; no, this hands no alarm source new authority — the
/// Identity-expiry alarm stays capped at High specifically so it can never reach this gate either).</para>
///
/// <para><b>Fix round 1 (review) — <see cref="AlarmSource.Policy"/> is EXCLUDED from
/// <see cref="AnyCriticalAlarmActiveAsync"/>'s signal — a genuine self-latch, found by the reviewer's own
/// probe.</b> <see cref="Policy.PolicyResults.DenyAsync"/> raises a <see cref="AlarmPriority.Critical"/>,
/// <c>ClearOnAck: true</c> <see cref="AlarmSource.Policy"/> alarm for every <c>SAFETY_BLOCKED</c> denial (a
/// PRE-EXISTING behavior this task did not introduce — <c>LineEndpointsTests</c> already asserts it). Before
/// this fix, that alarm counted toward "is a Critical alarm active" here too — so ANY HALT-blocked write/
/// command/`fleet.start`/`line.start` attempt raised an alarm that then blocked EVERY subsequent write/command
/// (via <see cref="Policy.Rules.CriticalAlarmGuardRule"/>) until an operator found and acknowledged it — the
/// single most ordinary operator sequence in the product ("try something while halted, reset, try again")
/// self-disabled machine-write capability. The fix is precise, not a broad exclusion: a Policy-source alarm is
/// a RECORD OF A REFUSAL this same request path just wrote, never an independent observation about the PLANT
/// (unlike <see cref="AlarmSource.DriverHealth"/>/<see cref="AlarmSource.NgRate"/>, which describe the device/
/// process itself) — so it is the wrong kind of fact for a gate whose entire point is "is the PLANT currently
/// in a bad-enough state to refuse touching it." Excluding it by source, not by priority: lowering
/// `SAFETY_BLOCKED`'s own alarm priority to High was considered and rejected — <c>LineEndpointsTests</c>'
/// <c>PostStart_WhileEstopped_Gets409SafetyBlocked_AndRaisesACriticalAlarm</c> already asserts it stays
/// Critical, a pre-existing, unrelated behavior this task must not change. Proven both ways in
/// <c>MachineWriteEndpointsTests</c>: the reviewer's own 3-step probe (latch → deny → reset → a SECOND write
/// must succeed despite the still-unacked Policy/Critical alarm from step 1) and mutation-verified (temporarily
/// removing the exclusion reproduces the exact self-latch: the second write 409s <c>NOT_READY</c>).</para>
///
/// <para><b>Rate limiting — decided: not here, and why.</b> This codebase has zero rate-limiting
/// infrastructure anywhere (no <c>AddRateLimiter</c>, no debounce, no throttle) — the brief itself confirms
/// this is a first, not a gap in an existing pattern. This task does not add one:
/// <list type="bullet">
/// <item><description>The invariant that actually matters for a write endpoint — no implicit retry, no double
/// actuation — is already enforced at the driver layer (B-1's contract, proven at B-4/B-5) and is orthogonal to
/// REQUEST RATE; neither of this batch's two write-path Criticals were rate-shaped bugs.</description></item>
/// <item><description><b>Fix round 1 (review) — corrected: this is NOT symmetric across protocols.</b>
/// <c>ModbusTcpDriver</c>'s <c>_ioLock</c> genuinely serializes every write against every poll (one shared
/// connection, one call at a time). <c>OpcUaDriver</c> does NOT have an equivalent write-serializing lock —
/// its <c>_sessionLock</c> guards only "ensure a live session," never the actual <c>WriteAsync</c>/
/// <c>CallAsync</c> dispatch (B-5's own report: proven concurrent Read/Write/Call is safe there specifically
/// BECAUSE nothing serializes it) — so concurrent OPC-UA writes/commands from a hammering caller ARE genuinely
/// concurrent against the real device, not queued. And even where Modbus DOES queue: "slow, not unsafe" holds
/// for a setpoint (last write wins, no harm in redundant identical writes) but NOT for a command — N queued
/// `start-cycle` pulses are N real actuations, not N redundant attempts at the same one. A rate limiter would
/// not distinguish "N legitimate distinct setpoint writes across N machines" from "one stuck script re-firing
/// the SAME command," so it would not resolve this class of hazard even if added — which is why the decision
/// is "not now" rather than "not needed," a distinction this doc comment now states correctly instead of
/// overclaiming driver-level safety it does not have.</description></item>
/// <item><description>The one real hazard rate-limiting-shaped controls usually exist to prevent — a stuck
/// script or a held-down UI button firing the SAME write/command repeatedly — is a UI/workflow concern (B-8's
/// job: a confirm-before-fire affordance) rather than a server-side request-rate one.</description></item>
/// </list>
/// Documented here as a "not now, and here is why" per the brief's own instruction — not silence.</para>
///
/// <para><b>Cancellation — deliberately NOT the request's own token past the point of no return.</b> B-4's
/// carried finding: a cancelled write tears down the SAME connection the poll loop shares, which can flap
/// driver <c>Health</c> to <c>Degraded</c> exactly like a genuine device fault would. An HTTP client aborting
/// (a closed tab, a client-side timeout, a flaky mobile network) is not a rare event for a write endpoint —
/// wiring ASP.NET Core's own request-aborted token straight through to <see cref="FleetHost.TryWriteSetpointAsync"/>
/// would make that teardown ROUTINE, exactly what the brief warns against. Both handlers below therefore use
/// the bound <c>ct</c> (== <c>HttpContext.RequestAborted</c>) ONLY for the one pre-flight step that touches no
/// device and mutates nothing (the Critical-alarm read) and switch to <see cref="CancellationToken.None"/> for
/// EVERYTHING from that point on — the write/command call itself, its resulting audit row, AND (fix round 1,
/// review — a genuine contradiction of this exact reasoning, caught by the reviewer) the DENIED-path audit row
/// too. A refused attempt still WRITES an audit row and (for <c>SAFETY_BLOCKED</c>) raises an alarm — both are
/// mutations, not reads, and deserve the identical protection the applied/rejected/failed/indeterminate path
/// already got: using the request's own possibly-already-cancelled token there risks the store's
/// <c>AppendAsync</c> throwing <see cref="OperationCanceledException"/>, silently swallowed by
/// <see cref="AuditRecorder"/>'s own never-throws contract — the audit row for a refusal that GENUINELY
/// happened (who was denied, what they tried, why) would simply vanish, exactly the gap this task's audit
/// requirement exists to close, now for the denied path as much as the attempted one. The underlying driver's
/// OWN bound (Modbus <c>Transport.WriteTimeout</c>, OPC-UA <c>Session.OperationTimeout</c> — both already
/// proven at B-4/B-5) still limits how long any single call can take; nothing here can hang forever.</para>
///
/// <para><b>Carried finding, assessed and routed (not fixed here)</b> — B-5's own report flags
/// <c>OpcUaDriver.DisposeSessionAsync</c> calling <c>session.CloseAsync(CancellationToken.None)</c>, a network
/// round trip that can block up to the driver's 15s operation timeout against a hung server, on the SAME
/// dispose path <see cref="FleetHost.Estop"/> triggers. Assessed here: <c>WaitAndDisposeOldPipeline</c>
/// already bounds the CALLER's wait via <c>.Wait(RestartTeardownTimeout)</c> (3s) — a synchronous bounded wait
/// on a <see cref="Task"/> returns once the bound elapses regardless of whether the awaited task has actually
/// finished — so <see cref="FleetHost.Estop"/> itself still returns within budget; what is NOT bounded is how
/// long the background disposal keeps running afterward (up to ~12 extra seconds), a resource-hygiene
/// concern (a stale in-flight close racing a later reconnect), not a violation of "HALT must always be
/// reachable within budget". Fixing it properly means changing <c>OpcUaDriver.cs</c>'s own carefully
/// empirically-reasoned concurrency model (B-5, already reviewed and signed off) — out of this task's scope
/// (policy/RBAC/audit/endpoints, not driver internals). <b>B-8 closes this: assessment confirmed, matches
/// the identical conclusion already recorded on <c>OpcUaDriver.DisposeAsync</c>'s own doc comment (the
/// <c>_sessionLock</c> tradeoff below it) — no code change, this stays a documented, accepted tradeoff, not
/// an open item.</b></para>
///
/// <para><b>Carried finding, routed here with a clear statement — request-shape 400s run AHEAD of the
/// policy gate.</b> Both handlers below validate the request BODY (non-blank point/command, a parseable
/// value/argument) before calling <see cref="PolicyEngine.Evaluate"/> — so a malformed request from an
/// authenticated-but-role-refused caller, or one sent while HALT-latched, gets a plain <c>400</c> with no
/// audit row and no policy evaluation at all, unlike every properly-shaped attempt (permitted or denied),
/// which is always audited. Deliberately NOT reordered: (1) no device I/O and no mutation happens on
/// either path — a 400 here proves nothing about the fleet's state and grants nothing, so there is no
/// unaudited MACHINE ACTION to miss, only an unaudited malformed HTTP request, the same posture every
/// other endpoint in this codebase already takes for shape validation; (2) evaluating policy against a
/// request this class cannot even parse into a <see cref="SetpointWriteRequest"/>/<see cref="CommandRequest"/>
/// would mean auditing a decision about an action that was never actually well-formed enough to attempt,
/// which is a stranger audit row than none at all. This is "unaudited probing, no device I/O" — a genuine,
/// accepted gap (an attacker profiling exact request-shape validation leaves no trace), not a safety gap;
/// closing it would mean either running full RBAC+policy evaluation before parsing (moving the cheapest
/// check behind the most expensive one, for every caller, to protect against a probe that can't touch a
/// device) or adding a SEPARATE unconditional audit row ahead of shape validation (a new kind of audit
/// entry this codebase has nowhere else). Left as a documented tradeoff per the brief's own "fix or route
/// with a clear statement" instruction, not fixed.</para>
/// </summary>
public static class MachineWriteEndpoints
{
    private const string SetpointAction = "machine.setpoint.write";
    private const string CommandAction = "machine.command.invoke";

    public static void MapMachineWriteEndpoints(this IEndpointRouteBuilder app)
    {
        app.MapPost("/v1/machines/{code}/setpoint", WriteSetpointAsync).RequireAuthorization(Policies.Engineer);
        app.MapPost("/v1/machines/{code}/command", InvokeCommandAsync).RequireAuthorization(Policies.Admin);
    }

    // ─────────────────────────────────────────────────────────────────────
    // POST /v1/machines/{code}/setpoint {point, value}
    // ─────────────────────────────────────────────────────────────────────
    internal static async Task<IResult> WriteSetpointAsync(
        string code, MachineSetpointWriteRequestDto? body, FleetHost host, IAlarmStore alarms,
        HttpContext context, AuditRecorder recorder, PolicyEngine policy, CancellationToken ct)
    {
        if (body is null || string.IsNullOrWhiteSpace(body.Point))
        {
            return Results.BadRequest(new ApiErrorDto("Request body with a non-blank \"point\" is required."));
        }

        if (body.Value.ValueKind == JsonValueKind.Undefined)
        {
            return Results.BadRequest(new ApiErrorDto("\"value\" is required (send an explicit JSON null if that is genuinely intended)."));
        }

        if (!TryConvertToConnectorValue(body.Value, out var value, out var conversionError))
        {
            return Results.BadRequest(new ApiErrorDto($"\"value\": {conversionError}"));
        }

        var criticalAlarmActive = await AnyCriticalAlarmActiveAsync(alarms, ct).ConfigureAwait(false);
        var decision = policy.Evaluate(PolicyRequest.For(context, SetpointAction, host.GetSafetyStatus(), criticalAlarmActive));
        if (!decision.IsPermitted)
        {
            // Fix round 1 (review) — CancellationToken.None, not ct: see this class's own doc comment,
            // "Cancellation". A denied attempt still writes an audit row (and, for SAFETY_BLOCKED, raises an
            // alarm) — both mutations deserve the same protection from an aborted client the attempted-write
            // path already has.
            return await PolicyResults.DenyAsync(
                context, recorder, SetpointAction, decision, CancellationToken.None,
                targetType: "machine", targetId: code,
                requestDetail: new { point = body.Point, value }).ConfigureAwait(false);
        }

        var request = new SetpointWriteRequest(body.Point, value);

        // Deliberately CancellationToken.None from here on — see this class's own doc comment, "Cancellation".
        var (availability, result) = await host.TryWriteSetpointAsync(code, request, CancellationToken.None).ConfigureAwait(false);
        if (result is null)
        {
            return NotAvailableResult(code, availability);
        }

        await recorder.RecordAsync(
            context, SetpointAction, "machine", code,
            null,
            new
            {
                point = result.Point,
                requestedValue = value,
                outcome = result.Outcome,
                rejectionReason = result.RejectionReason,
                detail = result.Detail,
            },
            CancellationToken.None).ConfigureAwait(false);

        return Results.Ok(new MachineSetpointWriteResponseDto(code, result));
    }

    // ─────────────────────────────────────────────────────────────────────
    // POST /v1/machines/{code}/command {command, arguments?}
    // ─────────────────────────────────────────────────────────────────────
    internal static async Task<IResult> InvokeCommandAsync(
        string code, MachineCommandRequestDto? body, FleetHost host, IAlarmStore alarms,
        HttpContext context, AuditRecorder recorder, PolicyEngine policy, CancellationToken ct)
    {
        if (body is null || string.IsNullOrWhiteSpace(body.Command))
        {
            return Results.BadRequest(new ApiErrorDto("Request body with a non-blank \"command\" is required."));
        }

        Dictionary<string, object>? arguments = null;
        if (body.Arguments is { Count: > 0 })
        {
            arguments = new Dictionary<string, object>(body.Arguments.Count);
            foreach (var (argName, element) in body.Arguments)
            {
                if (!TryConvertToConnectorValue(element, out var argValue, out var conversionError))
                {
                    return Results.BadRequest(new ApiErrorDto($"argument '{argName}': {conversionError}"));
                }

                if (argValue is null)
                {
                    return Results.BadRequest(new ApiErrorDto(
                        $"argument '{argName}': cannot be explicitly null — omit it entirely to leave it unset."));
                }

                arguments[argName] = argValue;
            }
        }

        var criticalAlarmActive = await AnyCriticalAlarmActiveAsync(alarms, ct).ConfigureAwait(false);
        var decision = policy.Evaluate(PolicyRequest.For(context, CommandAction, host.GetSafetyStatus(), criticalAlarmActive));
        if (!decision.IsPermitted)
        {
            // Fix round 1 (review) — CancellationToken.None, not ct: same reasoning as WriteSetpointAsync's
            // own deny path above.
            return await PolicyResults.DenyAsync(
                context, recorder, CommandAction, decision, CancellationToken.None,
                targetType: "machine", targetId: code,
                requestDetail: new { command = body.Command, arguments }).ConfigureAwait(false);
        }

        var request = new CommandRequest(body.Command, arguments);

        // Deliberately CancellationToken.None from here on — see this class's own doc comment, "Cancellation".
        var (availability, result) = await host.TryInvokeCommandAsync(code, request, CancellationToken.None).ConfigureAwait(false);
        if (result is null)
        {
            return NotAvailableResult(code, availability);
        }

        await recorder.RecordAsync(
            context, CommandAction, "machine", code,
            null,
            new
            {
                command = result.Command,
                arguments,
                outcome = result.Outcome,
                rejectionReason = result.RejectionReason,
                detail = result.Detail,
            },
            CancellationToken.None).ConfigureAwait(false);

        return Results.Ok(new MachineCommandInvokeResponseDto(code, result));
    }

    // ─────────────────────────────────────────────────────────────────────
    // Shared helpers
    // ─────────────────────────────────────────────────────────────────────

    /// <summary>The four cases <see cref="FleetHost.TryWriteSetpointAsync"/>/<see cref="FleetHost.TryInvokeCommandAsync"/>
    /// return a <see langword="null"/> result for — no I/O was ever attempted, so a caller retrying is always
    /// safe, unlike the four attempted-write outcomes (see this class's own doc comment for why those all
    /// stay <c>200</c>). Each case gets its OWN reason code and an actionable message — never one generic
    /// "not available" error, per the brief's explicit requirement.</summary>
    private static IResult NotAvailableResult(string code, MachineDriverAvailability availability) => availability switch
    {
        MachineDriverAvailability.MachineNotFound =>
            Results.NotFound(new ApiErrorDto($"machine \"{code}\" not found")),

        MachineDriverAvailability.NoLiveDriver =>
            Results.Json(
                new MachineWriteUnavailableDto(
                    $"No live driver is currently running for machine '{code}' — the fleet may be stopped, the " +
                    "HALT latch may be engaged, or this machine's connector failed to start this run. Check " +
                    "GET /v1/fleet, GET /v1/safety, and GET /v1/connectors, then retry.",
                    "NO_LIVE_DRIVER"),
                statusCode: StatusCodes.Status409Conflict),

        MachineDriverAvailability.ReadOnly =>
            Results.Json(
                new MachineWriteUnavailableDto(
                    $"The live driver for machine '{code}' does not support writing — this connector declares no " +
                    "writable points or commands (or predates write support entirely). This machine cannot be " +
                    "written to right now.",
                    "READ_ONLY"),
                statusCode: StatusCodes.Status409Conflict),

        MachineDriverAvailability.AmbiguousDriver =>
            Results.Json(
                new MachineWriteUnavailableDto(
                    $"More than one machine in the fleet roster resolves to the same live connector as '{code}' — " +
                    "refusing to write, to avoid the risk of delivering it to the wrong physical device. Give " +
                    "this machine its own connector, or remove the other roster member sharing it.",
                    "AMBIGUOUS_DRIVER"),
                statusCode: StatusCodes.Status409Conflict),

        // MachineDriverAvailability.Writable never reaches here — TryWriteSetpointAsync/TryInvokeCommandAsync
        // only return a null Result for the four cases above (see those methods' own doc comments).
        _ => throw new ArgumentOutOfRangeException(nameof(availability), availability, "Unreachable: Writable always returns a non-null result."),
    };

    /// <summary>Deliberately NOT identical to <c>LineEndpoints.AnyCriticalAlarmActiveAsync</c> — same tiny-
    /// helper-per-file idiom as <c>RbacPolicyTests</c>' own duplicated factory recipe, but this one additionally
    /// EXCLUDES <see cref="AlarmSource.Policy"/> (fix round 1, review finding I1 — a genuine self-latch,
    /// reproduced by the reviewer's own probe: a <c>SAFETY_BLOCKED</c> denial raises a Critical Policy alarm —
    /// see <see cref="Policy.PolicyResults.DenyAsync"/> — which, left uncounted-out, then blocked EVERY
    /// subsequent write/command via <see cref="Policy.Rules.CriticalAlarmGuardRule"/> until an operator found
    /// and acknowledged that specific alarm — the most ordinary operator sequence in the product,
    /// "halt, reset, retry," self-disabled machine-write capability). A Policy-source alarm records a REFUSAL
    /// this same request path just wrote — not an independent observation about the plant — so it is
    /// structurally the wrong kind of fact for a gate whose entire point is "is the PLANT in a bad enough state
    /// to refuse touching it," unlike <see cref="AlarmSource.DriverHealth"/>/<see cref="AlarmSource.NgRate"/>/
    /// <see cref="AlarmSource.Identity"/> (each is an observation about the device/process itself). See
    /// <c>MachineWriteEndpoints</c>' own class doc comment, "The Critical-alarm decision," for why lowering
    /// <c>SAFETY_BLOCKED</c>'s alarm priority instead was rejected (an existing, unrelated
    /// <c>LineEndpointsTests</c> assertion already pins it Critical).</summary>
    private static async Task<bool> AnyCriticalAlarmActiveAsync(IAlarmStore alarms, CancellationToken ct)
    {
        var active = await alarms.ListActiveAsync(ct).ConfigureAwait(false);
        return active.Any(a => a.Priority == AlarmPriority.Critical && a.Source != AlarmSource.Policy);
    }

    /// <summary>Re-parses a bound <see cref="JsonElement"/> through <see cref="ConnectorJson.Options"/>'s own
    /// registered <c>object?</c> converter — the SAME already-hardened <c>double | bool | string | null</c>
    /// domain <see cref="IWritableDeviceDriver.WriteSetpointAsync"/>/<see cref="IWritableDeviceDriver.InvokeCommandAsync"/>
    /// expect (see <see cref="MachineSetpointWriteRequestDto"/>'s own doc comment for why this, rather than a
    /// second narrowing rule invented at the HTTP boundary, or a global change to this host's own JSON
    /// options). Never throws — a <see cref="JsonException"/> (an array/object/decimal/etc. — out of domain)
    /// is caught and reported as a 400, never an unhandled exception.</summary>
    private static bool TryConvertToConnectorValue(JsonElement element, out object? value, out string? error)
    {
        try
        {
            value = JsonSerializer.Deserialize<object?>(element.GetRawText(), ConnectorJson.Options);
            error = null;
            return true;
        }
        catch (JsonException ex)
        {
            value = null;
            error = ex.Message;
            return false;
        }
    }
}
