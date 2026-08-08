using St4i.EngineApi.Alarms;
using St4i.EngineApi.Auth;

namespace St4i.EngineApi.Policy;

/// <summary>
/// 🔴 Task C-6 — the two ACTION IDS every machine write is evaluated under, and the one caller-resolved
/// fact <see cref="PolicyRequest.CriticalAlarmActive"/> needs, in ONE place.
///
/// <para><b>Why this type exists.</b> Đợt B built the machine-write gate for exactly one caller —
/// <see cref="St4i.EngineApi.Endpoints.MachineWriteEndpoints"/> — so the action ids were
/// <c>private const</c>s there and the Critical-alarm resolution was a <c>private static</c> next to them.
/// C-6 adds a SECOND caller (the alarm relay, an automatic write with no human in the loop), and a second
/// caller with its own copy of those two things is precisely how a gate stops being one gate:</para>
/// <list type="bullet">
/// <item><description>A copied ACTION ID that drifts by one character is not a weaker gate, it is NO gate.
/// <see cref="Rules.EstopGuardRule"/> matches its <c>ActuatingActions</c> set ordinally and returns
/// <see langword="null"/> — "this rule does not apply" — for anything outside it, so
/// <c>"machine.setpoint.Write"</c> would sail past the HALT latch. (It would then be default-denied by
/// <see cref="Rules.RoleObligationRule"/>, which is the accident that saves you; relying on that is not a
/// design.) Sharing the constant makes the relay's write literally the same action, which is the strongest
/// available form of "the same gate, intact".</description></item>
/// <item><description>A copied CRITICAL-ALARM RESOLUTION that forgot the <see cref="AlarmSource.Policy"/>
/// exclusion would reproduce B-6's review finding I1 — the self-latch where a single <c>SAFETY_BLOCKED</c>
/// denial blocks every subsequent write until somebody acknowledges it — in a caller nobody is watching.
/// <see cref="AnyCriticalAlarmActiveAsync"/> is that resolution, moved here verbatim.</description></item>
/// </list>
///
/// <para><b>What is deliberately NOT here:</b> <c>LineEndpoints</c>' own Critical-alarm helper. It answers a
/// DIFFERENT question (it counts <see cref="AlarmSource.Policy"/> alarms in, because <c>line.start</c> is
/// not the request path that wrote them) and B-6 recorded that difference explicitly. Folding the two
/// together would silently change <c>line.start</c>/<c>line.unhold</c>.</para>
/// </summary>
public static class MachineWriteGate
{
    /// <summary>Setting a pre-declared value on a named writable point. <see cref="Roles.Engineer"/> per
    /// <see cref="Rules.RoleObligationRule"/>; in <see cref="Rules.EstopGuardRule"/>'s actuating set.</summary>
    public const string SetpointAction = "machine.setpoint.write";

    /// <summary>Invoking a named command — the one that can start real, physical motion.
    /// <see cref="Roles.Admin"/> per <see cref="Rules.RoleObligationRule"/>; in
    /// <see cref="Rules.EstopGuardRule"/>'s actuating set.</summary>
    public const string CommandAction = "machine.command.invoke";

    /// <summary>The action id for one <see cref="Rules.RoleObligationRule"/>-recognised machine write,
    /// chosen by whether it is a point or a command. Exists so a caller holding a
    /// <see cref="Alarms.RelayTargetKind"/> cannot pick the wrong one by hand.</summary>
    public static string ActionFor(RelayTargetKind kind) =>
        kind == RelayTargetKind.Command ? CommandAction : SetpointAction;

    /// <summary>
    /// The minimum role <see cref="Rules.RoleObligationRule"/> requires for
    /// <see cref="ActionFor"/>'s action — <see cref="Roles.Engineer"/> for a setpoint,
    /// <see cref="Roles.Admin"/> for a command.
    ///
    /// <para>🔴 Exposed so an automatic caller can present the LEAST privilege that its own configured
    /// target actually needs, rather than running everything at the higher tier. A relay pointed at a point
    /// is Engineer-tier and is refused if it ever tries to invoke a command; only a relay an operator
    /// explicitly configured as a <see cref="RelayTargetKind.Command"/> target presents Admin. The tier is a
    /// property of the ACT (B-6: "setting a value and starting a motion are different acts"), not of a
    /// person, which is what makes it meaningful for a non-human actor at all.</para>
    ///
    /// <para>🔴🔴 <b>Task C-6 review round 1 (I-2) — A HARD CONSTRAINT ON WHOEVER BUILDS THE RELAY-CONFIG
    /// WRITE PATH (C-7).</b> Because this method returns <see cref="Roles.Admin"/> for a
    /// <see cref="RelayTargetKind.Command"/> target and the relay presents it,
    /// <b>saving a relay row with <c>TargetKind = Command</c> makes this product perform, automatically and
    /// for as long as the row exists, an action a human needs Admin for.</b> The configuration write is
    /// therefore a privilege-granting act, not an ordinary settings change.</para>
    ///
    /// <para>Not exploitable today — no endpoint writes this configuration yet (verified: nothing under
    /// <c>Endpoints/</c> calls <c>NotificationConfigStore.SaveRelayAsync</c>) — but every other
    /// config-mutation endpoint in this product is Engineer-tier, so following that precedent would hand an
    /// Engineer Admin-tier command authority through a config row.
    /// <b>The relay-config write path must be Admin-gated, at minimum for
    /// <see cref="RelayTargetKind.Command"/> targets.</b> Lowering the role returned here instead is NOT the
    /// fix: it would make every command relay permanently denied, which is a configuration the store accepts
    /// and the channel could never honour — precisely the fault C-2 refused an <c>ImplicitTls</c> mode
    /// over.</para>
    /// </summary>
    public static string RoleFor(RelayTargetKind kind) =>
        kind == RelayTargetKind.Command ? Roles.Admin : Roles.Engineer;

    /// <summary>
    /// Resolves <see cref="PolicyRequest.CriticalAlarmActive"/> — moved here from
    /// <c>MachineWriteEndpoints.AnyCriticalAlarmActiveAsync</c> unchanged, so the ONE caller that needs it
    /// and the ONE caller that would otherwise copy it read the same code.
    ///
    /// <para>🔴 <see cref="AlarmSource.Policy"/> is EXCLUDED, and that exclusion is load-bearing rather than
    /// tidy (B-6 review finding I1, reproduced by the reviewer's own probe):
    /// <see cref="PolicyResults.DenyAsync"/> raises a <see cref="AlarmPriority.Critical"/>
    /// <see cref="AlarmSource.Policy"/> alarm for every <c>SAFETY_BLOCKED</c> denial. Counted in, ANY
    /// HALT-blocked attempt raises an alarm that then blocks EVERY subsequent write via
    /// <see cref="Rules.CriticalAlarmGuardRule"/> until an operator finds and acknowledges it — the most
    /// ordinary sequence in the product ("halt, reset, retry") self-disabling machine-write capability. A
    /// Policy-source alarm is a RECORD OF A REFUSAL this same path just wrote, never an independent
    /// observation about the plant, unlike <see cref="AlarmSource.DriverHealth"/>/
    /// <see cref="AlarmSource.NgRate"/>/<see cref="AlarmSource.Identity"/>.</para>
    /// </summary>
    public static async Task<bool> AnyCriticalAlarmActiveAsync(IAlarmStore alarms, CancellationToken ct)
    {
        ArgumentNullException.ThrowIfNull(alarms);
        var active = await alarms.ListActiveAsync(ct).ConfigureAwait(false);
        return active.Any(a => a.Priority == AlarmPriority.Critical && a.Source != AlarmSource.Policy);
    }

    /// <summary>
    /// 🔴 Task E-4 (docs/plans/2026-08-04-dotE-fleet-core-extraction-blueprint.md §12) — <b>the operator's
    /// explanation for a write that was never attempted, stated ONCE for both surfaces that have to give
    /// one.</b>
    ///
    /// <para><b>Why this is here rather than inline at each site.</b> Enumerating the RETURNS rather than
    /// starting from a type name turned up TWO places that render a
    /// <see cref="MachineDriverAvailability"/> into operator-facing prose, not one:
    /// <c>MachineWriteEndpoints.NotAvailableResult</c> (the HTTP 404/409 body the web UI shows verbatim —
    /// see <c>web/src/lib/api.ts</c>'s <c>MachineWriteApiError</c>) and
    /// <c>RelayNotificationChannel.UnavailableAsync</c> (the warning an operator reads when the annunciator
    /// did not light). They had drifted into two independent copies of the same cause list, and BOTH copies
    /// were wrong in the same way. Same reasoning as <see cref="SetpointAction"/>/
    /// <see cref="AnyCriticalAlarmActiveAsync"/> living here: a second private copy is how one statement
    /// quietly becomes two.</para>
    ///
    /// <para>🔴 <b>What was wrong — stated per string, because the unifying sentence this comment first
    /// carried was itself a false universal.</b> It read *"every one of the old strings presupposed that a
    /// connector exists"*, and the E-4 review checked all eight pre-E-4 copies and found that is true of
    /// <b>two</b> of them. Restating it correctly rather than tidying it away, because a sentence covering
    /// several strings and true of only some IS the defect this method exists to fix:
    /// <list type="bullet">
    /// <item><b><c>READ_ONLY</c> (both copies) — genuinely presupposed a connector.</b> "this connector
    /// declares no writable points or commands", when its commonest producer is a machine driven by the
    /// built-in simulated group, which has no connector at all.</item>
    /// <item><b><c>NO_LIVE_DRIVER</c> (both copies) — a DISJUNCTION, and only its third disjunct presupposed
    /// a connector.</b> The defect is that the disjunction was not exhaustive: no branch of "the fleet may be
    /// stopped, the HALT latch may be engaged, or this machine's connector failed to start this run" covers a
    /// machine with no connector configured here at all. Its <i>advice</i> was the sharper fault — see the
    /// paragraph below.</item>
    /// <item><b>The <c>404</c> at the endpoint — literally TRUE, and uninformative.</b> "machine X not found"
    /// presupposes nothing; it simply names none of the paths an operator needs, and an edge-held machine is
    /// real, running and correctly configured somewhere else. The relay's <c>MachineNotFound</c> copy is the
    /// one with a defect, and again it is the ADVICE: "check the code, or onboard the machine" — onboarding
    /// an edge-held machine here creates exactly the duplicate roster entry that makes the engine's picture
    /// of the plant wrong.</item>
    /// <item><b><c>AMBIGUOUS_DRIVER</c> — correct.</b> One producing path, one true string. Kept, reworded
    /// only for "this engine's roster".</item>
    /// </list>
    /// The class is the one the brief named: <b>an operator-facing string covering several producing paths
    /// and true of only some.</b> It is not one property all four shared.</para>
    ///
    /// <para>🔴 <b>The edge-agent path, and the honest limit.</b> A machine driven by a
    /// <c>St4i.EdgeService</c> edge agent is <b>read-only from this engine</b> (blueprint §3 —
    /// <c>ITransport</c> is upload-only, so there is no downlink for a write command), and this engine
    /// <b>cannot detect that state</b>: an edge agent pushes its readings NORTHBOUND to the platform
    /// (<c>ST4I_SERVER_URL</c>) and never calls this engine at all, so nothing here ever learns that an edge
    /// agent exists, let alone which machines it holds. These strings therefore do NOT claim to distinguish
    /// "no connector configured" from "held by an edge agent" — they NAME both, which is the true statement.
    /// Narrowing further would need a second fact read beside the availability, and blueprint §10.1 forbids
    /// exactly that shape; the fact does not exist to read anyway. README §24 states what a downlink would
    /// cost.</para>
    ///
    /// <para><b>The advice is part of the correctness, not decoration.</b> The old <c>NO_LIVE_DRIVER</c>
    /// string ended "…then retry", which for an edge-held device is advice that can never work — and the
    /// obvious next move it invites (configure a connector for that machine HERE) puts a SECOND process on
    /// a device another one already drives. Over a TCP gateway nothing at all prevents that (blueprint §2's
    /// own measurement: both processes connect normally, and the machine-code claim is a per-process
    /// dictionary), so the string says so.</para>
    ///
    /// <para>Never called for <see cref="MachineDriverAvailability.Writable"/> — that value means a write
    /// MAY be attempted, so there is nothing to explain; it throws rather than returning a soothing default,
    /// and a future enum member with no arm here is a build-visible <c>switch</c> warning plus a red test
    /// (<c>MachineWriteUnavailableMessageTests</c>) rather than a silent generic string.</para>
    ///
    /// <para>🔴 <b>E-4 review — the <paramref name="machineCode"/> guard is unreachable because of guards
    /// ELSEWHERE, not by construction, and the difference is worth writing down.</b> Two call sites, two
    /// different reasons: the HTTP one cannot bind a blank <c>{code}</c> route segment at all; the alarm
    /// relay's is unreachable because <c>FleetCore.TryWriteSetpointAsync</c>/<c>TryInvokeCommandAsync</c>
    /// carry their OWN <c>ArgumentException.ThrowIfNullOrEmpty(machineCode)</c> and run BEFORE
    /// <c>UnavailableAsync</c> is ever entered — so a relay row with a blank machine code throws at the
    /// resolve call, two batches older than this method. <c>NotificationEndpoints.SaveRelayAsync</c>'s
    /// save-time "A machine code is required" is a third layer, not the load-bearing one. What all three
    /// share is that a hand-edited SQLite relay row still degrades an honest
    /// <see cref="MachineDriverAvailability.MachineNotFound"/> warning into <c>RelayOutcome.Lost</c> plus an
    /// error report — a real, pre-existing sharp edge on that channel, named here because "unreachable" was
    /// about to be recorded as if it were structural.</para>
    ///
    /// <para><b>Known, routed, not fixed: these strings are LONG and English-only.</b> Measured on the
    /// arms below with a 13-character machine code — <c>MachineNotFound</c> 526, <b><c>NoLiveDriver</c>
    /// 827</b>, <c>ReadOnly</c> 661, <c>AmbiguousDriver</c> 269 characters — and the web UI renders them
    /// unwrapped in its not-available banner. (🔴 Whole-branch review M2: this said "~730", which was a
    /// GUESS stated in the voice of a measurement and low by ~12%, the same instrument error that got the
    /// "seven times" count removed one round earlier. The figures above are counted from these literals; they
    /// move with the machine code's own length, which is why the input is named.) Correctness came first deliberately — a short string is what
    /// produced the defect — but "true, and hard to read at the point of use" is not finished. Shortening it
    /// means either dropping a producing path (no) or giving the banner progressive disclosure (a UI change,
    /// and this task touched no file under <c>web/</c>); translating it means an i18n decision this product's
    /// entirely-English HTTP error surface has never taken. Both are recorded in blueprint §12 as items, not
    /// as follow-ups somebody will remember.</para>
    /// </summary>
    public static string ExplainUnavailable(MachineDriverAvailability availability, string machineCode)
    {
        ArgumentException.ThrowIfNullOrEmpty(machineCode);

        return availability switch
        {
            MachineDriverAvailability.MachineNotFound =>
                $"No machine in this engine's roster carries the code '{machineCode}'. That is a mistyped " +
                "code, a machine that was never onboarded here — or a machine that is real and running but " +
                "is driven by a SEPARATE process: a St4i.EdgeService edge agent pushes its readings " +
                "northbound and never registers a machine in this engine, so a machine an edge agent holds " +
                "never appears in this roster and cannot be written to from here at all (README §24). This " +
                "engine cannot tell those apart, because nothing reports an edge agent's roster to it.",

            MachineDriverAvailability.NoLiveDriver =>
                $"Nothing in this engine is driving machine '{machineCode}' right now. Any of these " +
                "produces this message: (1) the fleet is stopped or the HALT latch is engaged — check " +
                "GET /v1/fleet and GET /v1/safety; (2) a connector IS configured for this machine but " +
                "failed to start this run — check GET /v1/connectors; (3) NO connector for this machine is " +
                "configured in this engine at all, which includes the case where the device is genuinely " +
                "being driven by a separate process such as a St4i.EdgeService edge agent (README §24) — " +
                "this engine cannot see that and cannot write to it. Retrying only helps for (1) and (2). " +
                "Do NOT add a connector here for a device another process is already driving: over a TCP " +
                "gateway nothing stops two processes commanding one device, and on a directly-attached COM " +
                "port the second one simply cannot open it.",

            MachineDriverAvailability.ReadOnly =>
                $"The live driver for machine '{machineCode}' is not a writable one, so nothing can be " +
                "written to it right now. In this build that means the machine is driven by something this " +
                "product builds OUTSIDE the connector path — the built-in simulated group (where a " +
                "'simulated' roster machine, or a third-party-kind machine with no connector registered for " +
                "its kind, ends up) or the hot-folder AOI demo pipeline. Neither has a write path at all. " +
                "Note this is NOT what a connector with no writable points reports: every connector factory " +
                "in this build produces a writable driver, so such a machine resolves as writable and the " +
                "write comes back rejected, naming the point.",

            MachineDriverAvailability.AmbiguousDriver =>
                $"More than one machine in this engine's roster resolves to the same live connector as " +
                $"'{machineCode}' — refusing to write, to avoid the risk of delivering it to the wrong " +
                "physical device. Give this machine its own connector, or remove the other roster member " +
                "sharing it.",

            _ => throw new ArgumentOutOfRangeException(
                nameof(availability), availability,
                "Only the not-available values have an explanation; Writable means a write may be attempted."),
        };
    }
}
