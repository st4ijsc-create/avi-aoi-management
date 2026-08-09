using Microsoft.Extensions.Logging.Abstractions;
using St4i.Connector.Abstractions.Models;
using St4i.EdgeCore.Drivers.Modbus;
using St4i.EdgeCore.Drivers.OpcUa;
using St4i.EngineApi.Auth;
using St4i.EngineApi.Fleet;

namespace St4i.EngineApi.Endpoints;

/// <summary>
/// <c>GET /v1/connectors</c> — GP-5 (.superpowers/sdd/2026-07-28-wsg-plugin-connector-seam-blueprint/
/// task-5-brief.md item 3) — the visibility projection for a connector that is CONFIGURED (registered into
/// <see cref="ConnectorRegistry"/>) but not currently running because its most recent start attempt failed.
/// Operator-level (same policy as <c>GET /v1/assets</c>/<c>GET /v1/alarms</c> — plain fleet-visibility
/// information, not a mutation), deliberately separate from <c>GET /v1/health</c>: an optional peripheral's
/// bad config must never flip the whole host unhealthy (the GP-4 review's own judgment, unchanged by this
/// task), but an operator must still be able to SEE that it isn't running instead of discovering it only in
/// a log file.
///
/// <para><b>SM-5 (.superpowers/sdd/2026-07-29-dotA-single-machine-sellable-blueprint/task-5-brief.md) —
/// the WRITE path this whole file was missing.</b> Before this task, a real Modbus/OPC-UA connector could
/// ONLY be configured by setting <c>ST4I_MODBUS_*</c>/<c>ST4I_OPCUA_*</c> environment variables plus a
/// hand-authored map file, or by hand-editing <c>connectors.json</c> — both requiring filesystem access and
/// a restart, with no way in the product itself to add one. This task adds four routes:</para>
///
/// <list type="bullet">
/// <item><description><c>POST /v1/connectors</c> (Engineer, audited <c>connector.save</c>) — validates
/// (<see cref="ConnectorConfigValidation"/>), persists (<see cref="ConnectorConfigStore"/>), registers the
/// factory live into the SAME <see cref="ConnectorRegistry"/> singleton <see cref="FleetHost"/> already
/// polls, and seeds the roster via <see cref="FleetHost.RegisterMachine"/> — which restarts the pipeline
/// itself if it's already running (see that method's own doc comment), so a genuinely NEW machine is applied
/// live with no restart required. Re-submitting the SAME machine code updates the store + the live registry
/// entry, but <see cref="FleetHost.RegisterMachine"/> no-ops for an already-present code (by design — it only
/// ever ADDS), so that specific case needs an explicit Stop/Start (or a process restart) to actually pick up
/// the change — <see cref="ConnectorCreateResultDto.Message"/> says so plainly rather than leaving the
/// operator to wonder why nothing changed.</description></item>
/// <item><description><c>GET /v1/connectors/configured</c> (Operator) — every persisted connector
/// configuration, WITHOUT its register-map/node-map JSON (which may embed an OPC-UA username/password) —
/// see <see cref="ConnectorConfigStore"/>'s own doc comment for why that column is never even selected by
/// this projection's SQL, not merely stripped after the fact.</description></item>
/// <item><description><c>DELETE /v1/connectors/{instanceId}</c> (Engineer, audited <c>connector.delete</c>;
/// the segment was <c>{kind}</c> before Task D-1) — removes ONLY the persisted row.
/// <see cref="FleetHost.RegisterMachine"/> has no unregister (the brief's own explicit constraint) — a
/// machine already in the roster, and any connector currently running under this id, is UNAFFECTED until the
/// process is fully restarted, at which point Program.cs's startup wiring simply has nothing left to seed for
/// it. <see cref="ConnectorDeleteResultDto.Message"/> says this plainly.</description></item>
/// <item><description><c>POST /v1/connectors/test</c> (Engineer, not audited — a read-only probe that
/// mutates nothing, same posture as <c>GET /v1/site/discover</c>) — builds a THROWAWAY driver (never
/// registered into <see cref="ConnectorRegistry"/>, never touches <see cref="FleetHost"/>/its <c>_gate</c> at
/// all) and attempts exactly one bounded read, so an operator learns immediately whether a typo'd IP/endpoint
/// is wrong instead of finding out only after Start. <see cref="St4i.Connector.Abstractions.IConnectorFactory.TryCreate"/>'s
/// own "MUST NOT perform I/O" contract is upheld: the ONLY I/O this endpoint performs is
/// <see cref="St4i.Connector.Abstractions.IDeviceDriver.ReadAsync"/>, called directly by THIS handler on a
/// driver instance nothing else references — never inside <c>FleetCore.StartLocked</c>/
/// <see cref="ConnectorRegistry.TryCreateDriver"/>, so it can never block <see cref="FleetHost.Estop"/> or
/// any other <c>_gate</c>-holding call.</description></item>
/// </list>
///
/// <para><b>Scope, deliberately:</b> only <see cref="DriverKinds.Modbus"/>/<see cref="DriverKinds.OpcUa"/> —
/// the two protocols this build actually has a working driver for (see
/// <see cref="ConnectorConfigValidation"/>'s own doc comment).</para>
///
/// <para><b>Task D-1 (.superpowers/sdd/2026-08-02-dotD-modbus-rtu-blueprint/task-1-brief.md) — this used to
/// say "at most ONE persisted/live connector per kind", and that is no longer true.</b> The old sentence read
/// <i>"<see cref="ConnectorRegistry"/> itself only ever holds one factory per normalized kind (its own doc
/// comment: 'last write wins'), so this matches the brief's own single-real-machine framing exactly"</i> — an
/// accurate description of a limit D-1 removed so that RS-485 multidrop (N devices on one bus, N machines)
/// can be expressed at all. Connectors are now identified per INSTANCE:
/// <see cref="ConnectorCreateRequest.InstanceId"/> names one, and omitting it derives the id from the kind,
/// which is exactly the single-connector-per-kind behaviour every existing client already has. What has NOT
/// changed is that one machine has one connector: a save whose map names a machine another instance already
/// serves is refused with a 409 (see <see cref="CreateConnectorAsync"/>), because a machine served by two
/// connectors is a machine whose writes cannot be resolved to a single device.</para>
/// </summary>
public static class ConnectorEndpoints
{
    /// <summary>Bounded window for <c>POST /v1/connectors/test</c>'s single read attempt — generous enough
    /// for an OPC-UA session handshake on a slow/loaded PLC, short enough that an operator is never left
    /// waiting on a request that will obviously never resolve. Independent of (not reused from) any
    /// register-map/node-map <c>readTimeoutMs</c>/<c>pollIntervalMs</c> field — this is a ONE-SHOT UI
    /// affordance, not the driver's own steady-state polling budget.
    ///
    /// <para>A mutable <see langword="internal"/> property (not a <c>const</c>/<c>readonly</c>) purely as a
    /// TEST-ONLY seam — <c>ModbusTcpDriver</c>'s poll loop never THROWS on a mere connection failure, it sets
    /// <c>Health = Degraded</c> and retries after <c>pollIntervalMs</c> forever (see its own class doc
    /// comment), so a real "nothing is listening" test would otherwise have to wait out the FULL production
    /// window every time. Production never sets this (same "test-only, requires
    /// <c>InternalsVisibleTo</c>" contract as <c>FleetHost.DriverDecoratorForTests</c>).</para></summary>
    internal static TimeSpan ConnectionTestTimeout { get; set; } = TimeSpan.FromSeconds(8);

    public static void MapConnectorEndpoints(this IEndpointRouteBuilder app)
    {
        app.MapGet("/v1/connectors", (FleetHost host) => Results.Ok(host.GetConfiguredConnectorIssues()))
            .RequireAuthorization(Policies.Operator);

        app.MapGet("/v1/connectors/configured", ListConfiguredConnectorsAsync)
            .RequireAuthorization(Policies.Operator);

        app.MapPost("/v1/connectors", CreateConnectorAsync)
            .RequireAuthorization(Policies.Engineer);

        // Task D-1 — the path segment is the connector INSTANCE id, not the protocol kind. Renamed rather
        // than left misleading: with two Modbus connectors configurable, "the kind" no longer identifies
        // anything deletable. Every pre-D-1 URL keeps working unchanged, because a migrated row's instance id
        // IS its kind (see ConnectorConfigStore's migration v4) — DELETE /v1/connectors/Modbus still deletes
        // the Modbus connector an operator configured before this task.
        app.MapDelete("/v1/connectors/{instanceId}", DeleteConnectorAsync)
            .RequireAuthorization(Policies.Engineer);

        app.MapPost("/v1/connectors/test", TestConnectorAsync)
            .RequireAuthorization(Policies.Engineer);
    }

    // ─────────────────────────────────────────────────────────────────────
    // GET /v1/connectors/configured
    // ─────────────────────────────────────────────────────────────────────
    internal static async Task<IResult> ListConfiguredConnectorsAsync(ConnectorConfigStore store, CancellationToken ct)
    {
        var configured = await store.ListAsync(ct).ConfigureAwait(false);
        return Results.Ok(configured);
    }

    // ─────────────────────────────────────────────────────────────────────
    // POST /v1/connectors {kind, host?, port?, mapJson}
    // ─────────────────────────────────────────────────────────────────────
    /// <param name="busRegistry">🔴 Task D-7b — the process-wide reference-counted Modbus bus registry, needed
    /// only by the RS-485 arm below. Declared LAST, after <paramref name="ct"/>, with a
    /// <see langword="null"/> default — the SAME convention break, for the SAME reason, that
    /// <see cref="ConnectorConfigStore.SaveAsync"/>'s own <c>instanceId</c> parameter documents: every
    /// pre-existing caller passes <paramref name="ctx"/>/<paramref name="recorder"/>/<paramref name="ct"/>
    /// POSITIONALLY, so any earlier slot would have silently changed what an existing argument binds to. A
    /// convention broken visibly in one signature is cheaper than a mis-bound argument nobody notices. ASP.NET
    /// Core's own parameter binding injects it regardless of the default, because it is a registered service.
    /// <see langword="null"/> means "this host offers no RTU transport" and an RTU document is then refused
    /// with a named message — the same arm, and the same message shape,
    /// <see cref="Config.ConnectorsJsonRegistration.RegisterAll"/> already has.</param>
    /// <param name="loggerFactory">🔴 Task D-7b — where an RTU bus's driver-level warnings/errors go. Declared
    /// last for the same reason as <paramref name="busRegistry"/>; <see langword="null"/> falls back to
    /// <see cref="NullLoggerFactory"/>, so a caller that supplies none loses log output and nothing
    /// else.</param>
    internal static async Task<IResult> CreateConnectorAsync(
        ConnectorCreateRequest? body,
        ConnectorConfigStore store,
        ConnectorRegistry connectorRegistry,
        FleetHost fleetHost,
        OpcUaOptions opcUaOptions,
        HttpContext ctx,
        AuditRecorder recorder,
        CancellationToken ct,
        ModbusBusRegistry? busRegistry = null,
        ILoggerFactory? loggerFactory = null)
    {
        if (body is null)
        {
            return Results.BadRequest(new ApiErrorDto("Request body is required."));
        }

        // 🔴 Task D-7b — the RTU arm, taken BEFORE validation for the same reason
        // ConnectorsJsonRegistration.RegisterAll takes its own before the kind dispatch: a document that
        // declares a transport is not one connector at all, it is a BUS, and ConnectorConfigValidation's
        // Modbus arm would reject it (a bus document has no top-level machineCode) with a message about a
        // field the operator correctly omitted. The ONE thing that routes a request here is the same
        // predicate connectors.json uses, so the two surfaces cannot disagree about what an RTU document is.
        if (ModbusRtuBusSettings.DeclaresATransport(body.MapJson))
        {
            return await CreateRtuBusAsync(
                body, store, connectorRegistry, busRegistry, fleetHost, loggerFactory, ctx, recorder, ct)
                .ConfigureAwait(false);
        }

        if (!ConnectorConfigValidation.TryValidate(body.Kind, body.Host, body.Port, body.MapJson, opcUaOptions.PkiDir, out var validated, out var error))
        {
            return Results.BadRequest(new ApiErrorDto(error!));
        }

        // Task B-3 (.superpowers/sdd/2026-07-29-dotB-machine-control-blueprint/task-3-brief.md) — the
        // deliberate-save gate. Runs BEFORE any store/roster mutation, and before the cross-kind/same-kind
        // conflict checks below (this request is not going to save at all if the gate fails, so there is no
        // reason to spend a DB round-trip checking conflicts first). Mirrors POST /v1/site/identity/rotate's
        // own echo-back pattern exactly: 400 when the confirmation is missing/blank, 409 when it does not
        // match what THIS map currently declares (stale, or copied from a different paste) — see
        // RotateIdentityAsync's own doc comment for why an echo, not a bare boolean flag, is what makes this
        // deliberate rather than merely reachable.
        if (validated.WriteCapability.GrantsCapability)
        {
            var requiredFingerprint = validated.WriteCapability.ComputeFingerprint();
            // Fix round 1 (Important #1) — names the actual bounds/target for every grant, not just its
            // name: the review found nothing anywhere (400 body, create response, summary, audit row) ever
            // showed a writable point's limits or a command's wire target, for a task whose headline rule is
            // "limits are mandatory". This is now the FIRST place an operator can see exactly what a save
            // would grant, before it ever happens.
            var grantSummary = DescribeGrantedCapability(validated.WriteCapability);

            if (string.IsNullOrWhiteSpace(body.ConfirmedWriteCapabilityFingerprint))
            {
                return Results.BadRequest(new ApiErrorDto(
                    $"This map declares write/command capability — {grantSummary}. Saving a map that grants " +
                    "write or command capability requires deliberate confirmation: resubmit this SAME request " +
                    $"with confirmedWriteCapabilityFingerprint = \"{requiredFingerprint}\" to proceed."));
            }

            if (!string.Equals(body.ConfirmedWriteCapabilityFingerprint, requiredFingerprint, StringComparison.Ordinal))
            {
                return Results.Conflict(new ApiErrorDto(
                    $"confirmedWriteCapabilityFingerprint does not match what this map currently declares — {grantSummary}. " +
                    "It may be stale (the map was edited after the fingerprint was computed, e.g. a limit widened " +
                    "or a target re-pointed) or copied from a different map. The current required value is " +
                    $"\"{requiredFingerprint}\" — confirm the granted capability shown above and retry with that " +
                    "exact value."));
            }
        }

        // "No unregister" guard (brief's own explicit concern): this build supports exactly ONE live
        // connector per kind (see ConnectorRegistry's own "one factory per kind" invariant), so re-pointing
        // an ALREADY-CONFIGURED kind at a DIFFERENT machine code would either strand the old roster entry
        // forever (RegisterMachine has no unregister) or silently swap which physical machine a familiar
        // roster tile represents — both dishonest. An operator who genuinely wants to switch machines must
        // explicitly DELETE the old configuration first.
        //
        // Task B-6 (.superpowers/sdd/2026-07-29-dotB-machine-control-blueprint/task-6-brief.md) — closes the
        // carried B-4 finding: this guard now only fires against an existing OPERATOR row.
        // ConnectorConfigVisibilitySeederTests/ConnectorEndpointsEnvSeedingSideEffectsTests' own reviewer-
        // proved scenario — an env-var/connectors.json-SEEDED row for a DIFFERENT machine code shadowing this
        // kind — is no longer treated as "an operator already configured this kind" at all: the operator
        // never persisted that row themselves, so there is nothing of theirs to protect from being
        // overwritten. The save below proceeds normally, upserting the seeded row into an operator-owned one
        // (SaveAsync's default `source` is Operator) for the machine code THIS request actually names.
        //
        // Task D-1 (.superpowers/sdd/2026-08-02-dotD-modbus-rtu-blueprint/task-1-brief.md) — the guard is now
        // per connector INSTANCE, not per protocol kind, and the reason it survives is unchanged: re-pointing
        // an ALREADY-CONFIGURED instance at a DIFFERENT machine code would still strand the old roster entry
        // (RegisterMachine has no unregister). What D-1 removes is the OTHER half of the old message — "this
        // build supports one live connector per protocol" is no longer true, and saying it would now be a
        // lie: configuring a SECOND Modbus machine is exactly what this endpoint is supposed to allow, by
        // giving it its own instanceId rather than by deleting the first one.
        var instanceId = string.IsNullOrWhiteSpace(body.InstanceId)
            ? validated.Kind
            : DriverKinds.Normalize(body.InstanceId.Trim());

        // 🔴 Task D-7a (D-4 review m5) — the DERIVED namespace is reserved, and this is the second of the two
        // doors into it. ModbusMultidropMap.DeviceInstanceId mints "{bus}:unit{n}" for every device on a
        // multidrop bus, and ModbusMultidropMap.ValidateBusInstanceId already refuses to let a BUS be named
        // that way. This endpoint is the other way an id gets allocated, and it has to refuse the same shape
        // for the same reason plus one more: ModbusMultidropRegistration's ghost sweep identifies "the entries
        // belonging to this bus" by exactly that prefix, so a connector saved here under "line1:unit3" would be
        // unregistered by bus line1's next registration pass — a connector that vanished, with nothing
        // pointing at why. Refused in ONE place's rule (LooksLikeADeviceInstanceId), not restated here.
        if (ModbusMultidropMap.LooksLikeADeviceInstanceId(instanceId))
        {
            return Results.BadRequest(new ApiErrorDto(
                $"Connector instance id '{instanceId}' is reserved. Ids ending in ':unit<number>' name one " +
                "DEVICE's position on a Modbus multidrop bus and are allocated automatically from the bus's own " +
                "id — a connector saved under one would be silently replaced, or removed, the next time that bus " +
                "registered. Choose a different instanceId."));
        }

        var existing = await store.GetAsync(instanceId, ct).ConfigureAwait(false);
        if (existing is not null
            && existing.Source == ConnectorConfigSource.Operator
            && !string.Equals(existing.MachineCode, validated.MachineCode, StringComparison.OrdinalIgnoreCase))
        {
            return Results.Conflict(new ApiErrorDto(
                $"Connector '{instanceId}' is already configured for machine '{existing.MachineCode}'. " +
                "A connector instance stays bound to the machine it was configured for — remove this one " +
                $"first (DELETE /v1/connectors/{instanceId}) to re-point it, or give the new machine its own " +
                "connector by supplying a different instanceId."));
        }

        // Task D-1 — 🔴 the machine-code CLAIM check, and the reason a write can no longer reach the wrong
        // machine. ConnectorRegistry.Register refuses a claim another instance already holds, but refusing
        // silently AFTER the store row was written would leave a persisted connector that never registers —
        // so the same question is asked HERE, before any mutation, and answered with a 409 an operator can
        // act on. Skipped for a re-save of the SAME instance (it is allowed to keep its own claim), which is
        // the ordinary idempotent-update path.
        if (connectorRegistry.TryGetInstanceIdForMachine(validated.MachineCode, out var claimingInstanceId)
            && !string.Equals(claimingInstanceId, instanceId, StringComparison.Ordinal))
        {
            // 🔴 D-1 review, m2 — a live registry claim OUTLIVES its persisted row: DELETE removes only the
            // configuration (this class' own doc comment: there is no live "unregister" path), so a claim
            // placed earlier this session survives until the process restarts. Telling an operator to
            // "remove that connector first" when they ALREADY removed it — and can see it is gone from
            // GET /v1/connectors/configured — is the product blaming them for having done the right thing.
            // Not a regression (the same POST was equally blocked before D-1, by the roster guard) but the
            // message is now specific enough to be actively wrong, so it forks on whether the claimant still
            // has a row. Only a message change; the refusal itself is identical in both branches.
            // 🔴 Branch review I-1's SWEEP — the remedy is provenance-aware, and this is the sibling the
            // sweep found. "Remove that connector first (DELETE …)" is true of an OPERATOR-owned incumbent
            // and false of a SEEDED one, which comes straight back at the next start; the store lookup that
            // decides the outer fork was already here, so learning the provenance costs nothing.
            var claimant = await store.GetAsync(claimingInstanceId, ct).ConfigureAwait(false);
            return Results.Conflict(new ApiErrorDto(
                claimant is not null
                    ? $"Machine '{validated.MachineCode}' is already served by connector '{claimingInstanceId}'. " +
                      "Two connectors may not drive one machine — a write could not then be resolved to a " +
                      "single device. " +
                      DescribeHowToFreeTheMachine(claimingInstanceId, claimant.Source, claimant.BusInstanceId) +
                      " Or point this one at a different machine code in its register/node map."
                    : $"Machine '{validated.MachineCode}' is still held by connector '{claimingInstanceId}', " +
                      "which was already removed from the persisted configuration but is STILL RUNNING: this " +
                      "build has no live \"unregister\" path, so a connector keeps driving its machine until " +
                      "the application is fully restarted. Restart the application and save again, or point " +
                      "this connector at a different machine code in its register/node map."));
        }

        // Fix round 1 (review) — CROSS-KIND (or cross-SOURCE) machine-code collision. The check above only
        // ever compared against OUR OWN store's row for the SAME kind; it said nothing about a machine code
        // already used by a DIFFERENT kind (a second connector, e.g. an OPC-UA row reusing a Modbus row's
        // code), or by ANY other roster source at all (an env-var-configured connector, a connectors.json
        // entry, or even a demo-fabricated machine). `FleetHost.RegisterMachine`'s own duplicate-code guard
        // is CASE-INSENSITIVE and KIND-AGNOSTIC — it silently returns `false` (discarded, by design, at
        // every one of this method's OWN call sites too, until this fix) for ANY existing roster member with
        // the same code, regardless of where that member came from. Without this check, an operator could
        // create a config that is durably persisted, shown in "configured connectors", and PERMANENTLY never
        // appears in the roster — not immediately, and not after any restart — while the response/UI told
        // them it would apply on the next Stop/Start. Reject it here instead, so that broken state can never
        // be created in the first place. Skipped only when the sole roster member with this code is the
        // legitimate idempotent-update case just cleared above (same kind, same code — the one case where a
        // roster hit is expected and correct, not a collision).
        var isIdempotentUpdateOfOwnConnector =
            existing is not null && string.Equals(existing.MachineCode, validated.MachineCode, StringComparison.OrdinalIgnoreCase);
        if (!isIdempotentUpdateOfOwnConnector)
        {
            var conflictingRosterMachine = fleetHost.Fleet.FirstOrDefault(
                d => string.Equals(d.Code, validated.MachineCode, StringComparison.OrdinalIgnoreCase));
            if (conflictingRosterMachine is not null)
            {
                return Results.Conflict(new ApiErrorDto(
                    $"Machine code '{validated.MachineCode}' is already used by another machine in the fleet " +
                    $"roster (driver kind '{conflictingRosterMachine.DriverKind}'). Machine codes must be " +
                    "unique across the whole fleet — use a different code in the register/node map and save again."));
            }
        }

        var before = existing is null
            ? null
            : new { existing.MachineCode, existing.Host, existing.Port };

        var saved = await store.SaveAsync(
                validated.Kind, validated.MachineCode, validated.Host, validated.Port, body.MapJson,
                validated.WriteCapability, ct: ct, instanceId: instanceId)
            .ConfigureAwait(false);

        // Live-register BEFORE RegisterMachine — a restart-if-running triggered below must always see the
        // freshly-registered factory, never the stale one it's replacing.
        //
        // Task D-1 — registered under this INSTANCE's id and BOUND to the machine code its map declares. The
        // binding is what FleetHost routes a write on; without it this connector would fall back to the
        // pre-D-1 kind-based rule and a second same-kind machine would make both of them ambiguous.
        //
        // 🔴 D-1 review, I-1 — the return value is checked (it was discarded before this task), and the
        // failure path COMPENSATES. My first submission's comment here claimed this branch was "unreachable
        // by construction" because of the claim pre-check above. That was WRONG, and the reviewer proved it
        // by tracing the three statements: the pre-check, SaveAsync and Register are NOT one atomic unit,
        // and the store write sits between the first and the third. Two concurrent POSTs naming the same
        // machine under two different instance ids both pass the pre-check; the loser then writes its row,
        // is refused here, and — before this fix — returned 409 leaving that row behind FOREVER. This
        // method's own SM-5 comment thirty lines above says exactly that state must never be creatable: a
        // config "durably persisted, shown in configured connectors, and PERMANENTLY never appears in the
        // roster." Program.cs's startup loop refuses it again on every subsequent boot and logs; nothing
        // ever removes it. The endpoint's own message admitted the situation while leaving the wreckage.
        //
        // So the row is rolled back to whatever was there before this request: DELETED when this request
        // created it, and RESTORED from `existing` when this request overwrote a prior row. The one residue
        // is `updated_at`, which SaveAsync bumps and the restore bumps again — `created_at` survives (the
        // upsert never touches it), so the row keeps its identity and its content. Compensating rather than
        // claiming-before-saving is deliberate: reversing the two would trade a permanent orphan ROW for an
        // orphan registry CLAIM, and the registry has no unregister, so that claim would block every later
        // POST for that machine until the process restarts, with no way for an operator to clear it.
        if (!connectorRegistry.Register(validated.Factory, body.MapJson, instanceId, validated.MachineCode))
        {
            // 🔴 D-1 re-review, I-A — CancellationToken.None, deliberately, NOT the request's `ct`. A
            // compensating action must not be cancelled by the very token whose cancellation caused it. The
            // previous version passed `ct` straight through to OpenConnectionAsync, so for an ENTIRE CLASS of
            // request — any client that hung up — the rollback threw immediately at the first store call
            // while the response below claimed it had succeeded. That is not an exotic interleaving; it is
            // guaranteed for every cancelled request that reaches this branch.
            var rolledBack = await CompensateFailedLiveRegistrationAsync(
                store, instanceId, existing, CancellationToken.None).ConfigureAwait(false);

            var raceWinner = connectorRegistry.TryGetInstanceIdForMachine(validated.MachineCode, out var winner)
                ? winner
                : "(unknown)";

            return Results.Conflict(new ApiErrorDto(
                $"Connector '{instanceId}' could not be registered live — machine '{validated.MachineCode}' " +
                $"was claimed by connector '{raceWinner}' while this request was in flight. " +
                DescribeRollbackOutcome(instanceId, rolledBack, createdByThisRequest: existing is null) +
                " Re-check GET /v1/connectors/configured and retry."));
        }

        // RegisterMachine only ADDS (see this class' own doc comment) — true means a brand-new machine code
        // just joined the roster (and, if the fleet was running, RegisterMachine already restarted the
        // pipeline itself); false means this machine code was already present (an update to an existing
        // connector's settings), which this call intentionally does NOT restart — see the message below.
        var added = fleetHost.RegisterMachine(validated.Descriptor);

        // Task B-3 — the audit row itself names exactly what was granted (never just "a map was saved"),
        // mirroring RotateIdentityAsync's own audit row recording both the old and new fingerprint: a
        // point/command NAME is never a credential (see ConnectorWriteCapability's own doc comment), so this
        // is safe to record verbatim, same as MachineCode/Host/Port already are.
        // Task D-1 — the audit row's target id is the connector INSTANCE, not the kind: with two connectors
        // of one kind configurable, "connector/Modbus" would no longer identify which one an auditor is
        // reading about. `Kind` moves into the after-state so nothing is lost.
        await recorder.RecordAsync(
            ctx, "connector.save", "connector", instanceId,
            before,
            new
            {
                validated.Kind, validated.MachineCode, validated.Host, validated.Port,
                validated.WriteCapability.WritablePoints, validated.WriteCapability.Commands,
            },
            ct).ConfigureAwait(false);

        // English, deliberately — like every other server-generated message in this codebase (SiteEndpoints,
        // SettingsEndpoints, ModbusRegisterMap, ...), this is a diagnostic/API-Inspector-facing string, not
        // the bilingual UI surface itself; the web client derives its own vi/en copy from `AppliedLive`
        // (see web/src/routes/Connectors.tsx) rather than displaying this field verbatim.
        var message = added
            ? "Saved and added to the fleet. If the fleet was already running, it was restarted to apply this immediately."
            : "Saved. This machine was already in the roster — the change applies on the next Stop/Start " +
              "(or a full application restart), not immediately to an already-running fleet.";

        return Results.Ok(new ConnectorCreateResultDto(
            ConnectorWriteCapabilityDto.From(validated.WriteCapability), saved, AppliedLive: added, message));
    }

    // ─────────────────────────────────────────────────────────────────────
    // POST /v1/connectors — the RS-485 BUS arm
    // ─────────────────────────────────────────────────────────────────────

    /// <summary>
    /// 🔴 <b>Task D-7b — <c>POST /v1/connectors</c> creating a Modbus RTU bus, which D-7a deferred with an
    /// argument this method exists to answer.</b>
    ///
    /// <para>The argument was: this endpoint's contract is <i>1 request → 1 machine → 1 audit row → 1
    /// compensating rollback</i>, and a bus is N of each. The answers, in the order a reader will want them:</para>
    ///
    /// <list type="bullet">
    /// <item><description><b>N machines, and the whole bus is one unit.</b> A bus with an invalid device
    /// registers NOTHING — see <see cref="RtuBusConfiguration"/>, whose class doc carries the full ordering
    /// argument. "7 of 8 register" was rejected: it leaves the operator with a bus silently one device short
    /// of the file they are reading, indistinguishable from a device that is merely unplugged.</description></item>
    /// <item><description><b>ONE audit row, targeted at the BUS.</b> N rows would be N records of one operator
    /// action, and an auditor reading them could not tell one save of eight devices from eight saves. Its
    /// after-state enumerates every device (instance id, unit id, machine code) and names the physical line, so
    /// nothing about what was granted is lost by collapsing the count — and its target id is the bus, which is
    /// the thing the operator actually named. Recorded AFTER the roster seeding, so a row exists only for a
    /// request that fully succeeded.</description></item>
    /// <item><description><b>The rollback undoes the store and the registry, and it cannot be interrupted into
    /// a half state.</b> The store write and its undo are each ONE SQLite transaction
    /// (<see cref="ConnectorConfigStore.SaveBusAsync"/>/<see cref="ConnectorConfigStore.RestoreBusAsync"/>);
    /// the registry undo is a set of <see cref="ConnectorRegistry.Unregister"/> calls, which perform no I/O and
    /// cannot fail. <see cref="FleetHost.RegisterMachine"/> — the one irreversible step, because the roster has
    /// no removal path — runs only after every reversible step has succeeded, so no failure this method can
    /// see ever has to undo it.</description></item>
    /// </list>
    ///
    /// <para><b>Two costs, stated rather than discovered.</b> (1) <see cref="FleetHost.RegisterMachine"/>
    /// restarts a running pipeline per NEW machine, so a bus of eight new machines restarts it eight times.
    /// Batching that needs a plural roster API, and roster surgery is explicitly not this task's
    /// (the N-driver lifecycle is <c>St4i.EdgeCore.Fleet.FleetCore</c>, ~2 400 lines, and its removal path is
    /// a named future batch; <c>FleetHost</c> itself is now a ~410-line shell over it — whole-branch review
    /// M1 corrected the figure, which had been left attached to the wrong type by E-2's move). (2) A re-save of an
    /// existing bus that then fails restores the STORE exactly but cannot restore the registry entries it had
    /// already released — <see cref="RtuBusConfiguration.ReleaseOwnNamespace"/> runs before the register pass
    /// (fix round 1, I-2: without it, re-addressing two devices on a line was a permanent dead end), and
    /// <see cref="ConnectorRegistry.Register"/> is last-write-wins besides. The store is authoritative and the
    /// registry is rebuilt from it at the next start. <see cref="DescribeBusRollbackOutcome"/> reports this
    /// from the released COUNT rather than asserting it whenever the bus happened to have rows — which is
    /// exactly what it used to do, and what made it false on the path this task's own headline test drives.</para>
    ///
    /// <para><b>The write-capability save gate is applied per DEVICE, and the fingerprint is over the whole
    /// bus.</b> A bus is one deliberate act; making an operator confirm eight fingerprints for one paste would
    /// train them to paste whatever the error message printed, which is the failure mode the gate exists to
    /// avoid. The bus's fingerprint is computed over the union of every device's grants, so re-pointing ONE
    /// device's command still changes what has to be confirmed.</para>
    /// </summary>
    internal static async Task<IResult> CreateRtuBusAsync(
        ConnectorCreateRequest body,
        ConnectorConfigStore store,
        ConnectorRegistry connectorRegistry,
        ModbusBusRegistry? busRegistry,
        FleetHost fleetHost,
        ILoggerFactory? loggerFactory,
        HttpContext ctx,
        AuditRecorder recorder,
        CancellationToken ct)
    {
        if (busRegistry is null)
        {
            // Same arm, and the same shape of message, ConnectorsJsonRegistration.RegisterAll already has for
            // a host composed without a bus registry: refuse by NAME rather than dispatch into a path that
            // cannot work. Unreachable through the HTTP surface (Program.cs registers the singleton
            // unconditionally — it costs one empty object) and answered anyway, because the alternative is a
            // NullReferenceException reported to an operator as a 500.
            return Results.BadRequest(new ApiErrorDto(
                "This document declares a Modbus RTU transport, but this host was composed without a Modbus bus " +
                "registry — no RTU connector can be built in this process."));
        }

        var logger = (loggerFactory ?? NullLoggerFactory.Instance).CreateLogger("ModbusRtu");

        // The warnings the fan-out raises (a device whose worst-case hold can monopolise the line, a map
        // falling back on a derived readTimeoutMs) are collected rather than dropped: they are exactly the
        // sentences an operator needs while they still have the paste in front of them, and the startup path
        // already logs them for a connectors.json bus.
        var notices = new List<string>();
        if (!RtuBusConfiguration.TryResolve(body.InstanceId, body.MapJson, notices.Add, out var bus, out var resolveError))
        {
            return Results.BadRequest(new ApiErrorDto(resolveError));
        }

        if (ModbusMultidropMap.LooksLikeADeviceInstanceId(bus.BusInstanceId))
        {
            // Unreachable — ValidateBusInstanceId inside TryResolve already refuses this shape — and checked
            // anyway, because this is the endpoint that owns the OTHER door into the derived namespace (see
            // the single-connector path's own guard thirty lines up) and a reader comparing the two arms must
            // not find one of them missing the rule.
            return Results.BadRequest(new ApiErrorDto(
                $"Connector instance id '{bus.BusInstanceId}' is reserved for a device position on a bus."));
        }

        var rows = RtuBusConfiguration.BuildRows(bus);

        // Task B-3's deliberate-save gate, over the UNION of every device's grants — see this method's own
        // remarks for why one fingerprint per bus rather than one per device.
        var busCapability = UnionCapability(rows);
        if (busCapability.GrantsCapability)
        {
            var required = busCapability.ComputeFingerprint();
            var summary = DescribeGrantedCapability(busCapability);

            if (string.IsNullOrWhiteSpace(body.ConfirmedWriteCapabilityFingerprint))
            {
                return Results.BadRequest(new ApiErrorDto(
                    $"This bus declares write/command capability across its {rows.Count} device(s) — {summary}. " +
                    "Saving a map that grants write or command capability requires deliberate confirmation: " +
                    $"resubmit this SAME request with confirmedWriteCapabilityFingerprint = \"{required}\" to proceed."));
            }

            if (!string.Equals(body.ConfirmedWriteCapabilityFingerprint, required, StringComparison.Ordinal))
            {
                return Results.Conflict(new ApiErrorDto(
                    $"confirmedWriteCapabilityFingerprint does not match what this bus currently declares — {summary}. " +
                    "It may be stale (a device was edited after the fingerprint was computed, e.g. a limit widened " +
                    "or a command re-pointed) or copied from a different bus. The current required value is " +
                    $"\"{required}\" — confirm the granted capability shown above and retry with that exact value."));
            }
        }

        // 🔴 Every refusal that is decidable from the current state is decided HERE, before the first
        // mutation — one snapshot, one roster read, all N devices. See RtuBusConfiguration.TryFindBlockedDevice.
        if (RtuBusConfiguration.TryFindBlockedDevice(
                bus, connectorRegistry.SnapshotBindings(), fleetHost.Fleet, out var blocked, out var incumbentId))
        {
            // 🔴 Fix round 4 (branch review) — the remedy is appended HERE because this is the first
            // frame that can see the store, and therefore the first that can tell an operator-saved incumbent
            // from a connectors.json-seeded one. TryFindBlockedDevice states the problem and hands the
            // incumbent out; it cannot state the remedy, because the field the remedy depends on is not in
            // its scope and never was. Null incumbent = the ROSTER arm, whose advice needs no field.
            if (incumbentId is not null)
            {
                var incumbent = await store.GetAsync(incumbentId, ct).ConfigureAwait(false);
                blocked += " " + DescribeHowToFreeTheMachine(incumbentId, incumbent?.Source, incumbent?.BusInstanceId) +
                           " Or give this device a different machine code and save the bus again.";
            }

            return Results.Conflict(new ApiErrorDto(blocked));
        }

        // What the store held for THIS bus before the request — the unit the rollback restores.
        var previousRows = await store.ListBusAsync(bus.BusInstanceId, ct).ConfigureAwait(false);

        var savedRows = await store.SaveBusAsync(
            bus.BusInstanceId, rows, ConnectorConfigSource.Operator, ct).ConfigureAwait(false);

        var registration = RtuBusConfiguration.TryRegisterAll(bus, busRegistry, connectorRegistry, logger);
        if (!registration.Succeeded)
        {
            // CancellationToken.None, deliberately — D-1's re-review finding I-A, unchanged in force here: a
            // compensating action must not be cancelled by the very token whose cancellation caused it.
            var rolledBack = true;
            try
            {
                await store.RestoreBusAsync(bus.BusInstanceId, previousRows, CancellationToken.None).ConfigureAwait(false);
            }
            catch (Exception ex)
            {
                rolledBack = false;
                logger.LogError(ex,
                    "Rolling back the persisted rows for Modbus RTU bus '{BusInstanceId}' failed after its live " +
                    "registration was refused.", bus.BusInstanceId);
            }

            return Results.Conflict(new ApiErrorDto(
                $"Modbus RTU bus '{bus.BusInstanceId}' was not saved. {registration.Refusal} " +
                DescribeBusRollbackOutcome(
                    bus.BusInstanceId, rolledBack, previousRows.Count, registration.IncumbentsReleased)));
        }

        // 🔴 The only irreversible step, and it is last. RegisterMachine restarts a RUNNING pipeline per new
        // machine (see its own doc comment), so a bus of N new machines restarts it N times — the cost of not
        // having a plural roster API, stated in this method's remarks rather than hidden.
        var addedMachines = new List<string>();
        foreach (var device in bus.Devices)
        {
            if (fleetHost.RegisterMachine(RtuBusConfiguration.DescriptorFor(device)))
            {
                addedMachines.Add(device.MachineCode);
            }
        }

        var deviceAudit = bus.Devices
            .Select(d => new { d.InstanceId, d.UnitId, d.MachineCode })
            .ToList();

        await recorder.RecordAsync(
            ctx, "connector.save", "connector", bus.BusInstanceId,
            previousRows.Count == 0
                ? null
                : new
                {
                    Devices = previousRows.Select(r => new { InstanceId = r.EffectiveInstanceId, r.MachineCode }).ToList(),
                },
            new
            {
                Kind = DriverKinds.Modbus,
                bus.Plan.Transport,
                Line = bus.Plan.DescribeLine(),
                DeviceCount = bus.Devices.Count,
                Devices = deviceAudit,
                busCapability.WritablePoints,
                busCapability.Commands,
            },
            ct).ConfigureAwait(false);

        // English, deliberately — see CreateConnectorAsync's own remark on this; the web client derives its
        // own vi/en copy from AppliedLive rather than displaying this verbatim.
        var message =
            $"Saved {bus.Devices.Count} device(s) on Modbus RTU bus '{bus.BusInstanceId}' ({bus.Plan.Transport}, " +
            $"line {bus.Plan.DescribeLine()}). " +
            (addedMachines.Count > 0
                ? $"{addedMachines.Count} machine(s) joined the fleet: {string.Join(", ", addedMachines)}. If the " +
                  "fleet was already running, it was restarted to apply this immediately."
                : "Every machine on this bus was already in the roster — the change applies on the next " +
                  "Stop/Start (or a full application restart), not immediately to an already-running fleet.") +
            (bus.Plan.LimitNotice is null ? string.Empty : " " + bus.Plan.LimitNotice) +
            // 🔴 Task F-1 — the one-host-per-segment constraint travels with the save response, on the same
            // terms as the DE limit beside it: the operator who just typed a gateway host:port is the one who
            // has to decide whether another host already names it, and this is the only surface that answers
            // them without reading a log file.
            (bus.Plan.SegmentOwnershipNotice is null ? string.Empty : " " + bus.Plan.SegmentOwnershipNotice) +
            (notices.Count == 0 ? string.Empty : " " + string.Join(" ", notices));

        return Results.Ok(new ConnectorCreateResultDto(
            ConnectorWriteCapabilityDto.From(busCapability),
            savedRows[0],
            AppliedLive: addedMachines.Count > 0,
            message,
            Devices: savedRows));
    }

    /// <summary>
    /// 🔴 <b>Fix round 1, review I-1 — the operator-facing sentence describing what a failed bus save left
    /// behind, and it is a PURE FUNCTION for exactly the reason <see cref="DescribeRollbackOutcome"/> is.</b>
    ///
    /// <para>The branch that produces it is reachable only under a concurrent registration, so no test drives
    /// the handler into it. <b>What the code does when it happens anyway</b> (§8.1 principle 1's own
    /// requirement of any sentence like the previous one): this function is called with
    /// <see cref="RtuBusConfiguration.BusRegistrationOutcome.IncumbentsReleased"/> and the previous row count
    /// and is exercised directly, over all four combinations, by
    /// <c>ConnectorRtuBusEndpointTests.TheBusRollbackSentence_…</c> — code a test cannot reach is code nothing
    /// ever asks a consequence question about, so the sentence is moved to where the question can be asked.
    /// That is precisely how the previous version shipped a false sentence: it appended
    /// <i>"the LIVE registry entries for the devices that did register were replaced before the refusal and
    /// cannot be put back"</i> <b>unconditionally whenever the bus already had rows</b>, while on the path the
    /// task's own headline test drives the FIRST device was refused, nothing had been registered, and the
    /// registry was byte-identical to before. The operator was told their live configuration had diverged from
    /// the store and needed a restart, about a system that had not been touched. Pulled out here, all four
    /// outcomes are ordinary unit-testable arguments.</para>
    ///
    /// <para>Three facts vary independently and each changes what an operator should do: whether the rollback
    /// completed, whether this bus had any persisted rows before the request, and whether any LIVE registration
    /// of this bus was actually released (fix round 1's I-2 releases the bus's own namespace before the
    /// register pass, so this is now a real count rather than an inference from "some rows existed").</para>
    /// </summary>
    /// <param name="previousDeviceCount">How many rows this bus had before the request. 0 means the request
    /// created it, so a completed rollback leaves nothing at all.</param>
    /// <param name="incumbentsReleased"><see cref="RtuBusConfiguration.BusRegistrationOutcome.IncumbentsReleased"/>
    /// — never an assumption about it. 0 means the registry was not disturbed and must not be described as
    /// though it were.</param>
    internal static string DescribeBusRollbackOutcome(
        string busInstanceId, bool rolledBack, int previousDeviceCount, int incumbentsReleased)
    {
        if (!rolledBack)
        {
            // Stated as a possibility rather than a certainty, for the same reason the single-connector
            // version is: the compensation can fail either before or after doing its work, and this method is
            // not in a position to know which. Pointing at the endpoint that would SHOW it is the actionable
            // part.
            return $"⚠ The rollback did NOT complete, so rows for '{busInstanceId}' may have been left behind " +
                   "that will never run: they would be listed by GET /v1/connectors/configured and refused " +
                   "again at every restart. Check that endpoint and remove them with " +
                   "DELETE /v1/connectors/{instanceId} if they are there.";
        }

        var stored = previousDeviceCount == 0
            ? "Nothing was persisted for this bus: its rows were rolled back in one transaction, so there is " +
              "no leftover configuration to clean up."
            : $"Its persisted rows were restored, in one transaction, to the {previousDeviceCount} device(s) " +
              "this bus had before the request — including their original creation timestamps.";

        if (incumbentsReleased == 0)
        {
            // 🔴 The half that used to be asserted unconditionally and was false. Say plainly that nothing
            // live changed, because "your registry is now inconsistent and needs a restart" sends an operator
            // to restart a machine for no reason.
            return stored + " No live connector on this bus was disturbed, so the running configuration is " +
                   "exactly what it was before this request.";
        }

        return stored + $" Note that the {incumbentsReleased} live registration(s) this bus already held were " +
               "released before the register pass and cannot be put back — the persisted configuration is " +
               "authoritative and is rebuilt into the registry at the next application start. Until then, a " +
               "write for one of those machines is refused rather than sent to the wrong device.";
    }

    /// <summary>
    /// 🔴 <b>Whole-branch review I-1 — what an operator is told when they delete ONE device off an RS-485
    /// bus, and it forks on the row's PROVENANCE because the two answers are opposite.</b>
    ///
    /// <para>The previous version selected on <see cref="ConnectorConfigRecord.BusInstanceId"/> alone and
    /// never consulted <see cref="ConnectorConfigRecord.Source"/>, so for a bus declared in
    /// <c>connectors.json</c> — which §23.1 makes the PRIMARY way an RS-485 line is declared — it said
    /// <i>"That was the last device on that line, so the bus is no longer configured at all."</i> That bus is
    /// still configured: <see cref="ConnectorConfigVisibilitySeeder.SeedBusAsync"/> persists its rows as
    /// <see cref="ConnectorConfigSource.Seeded"/> and re-seeds on <b>every boot</b>, so the line and its live
    /// connector come straight back at the next start. The standalone-connector branch directly below has
    /// carried exactly this caveat since B-6, and is pinned by a test; the bus branch had neither.</para>
    ///
    /// <para><b>This is the sixth instance of one operator-facing string covering two producing paths, true
    /// of only one — the third in THIS file.</b> Extracted as a pure function rather than fixed in place, for
    /// the reason the previous two extractions in this file give: the arms are otherwise reachable only by
    /// constructing a specific store state at a specific endpoint, so nobody ever asks them a consequence
    /// question. All four combinations are now ordinary arguments.</para>
    /// </summary>
    /// <param name="remainingDeviceCount">Rows still on this bus AFTER the delete. 0 means this was the last
    /// one — the case whose honest answer differs most between the two provenances.</param>
    internal static string DescribeBusDeviceDeletion(
        string instanceId, string machineCode, string busInstanceId, ConnectorConfigSource source,
        int remainingDeviceCount, bool claimReleased)
    {
        var opening =
            $"Removed device '{instanceId}' (machine '{machineCode}') from Modbus RTU bus '{busInstanceId}'. ";

        var line = source == ConnectorConfigSource.Seeded
            // 🔴 The arm I-1 found missing. NOT "the bus is no longer configured": this row was never
            // something an operator asked this product to persist — it was auto-populated for visibility from
            // this run's connectors.json — and the seeding pass re-creates the WHOLE bus on every start.
            ? (remainingDeviceCount > 0
                ? $"{remainingDeviceCount} device(s) remain listed on that line. "
                : "That was the last row listed for that line. ") +
              "⚠ This row was not created by an operator — it was auto-populated for visibility from this " +
              $"run's connectors.json entry for bus '{busInstanceId}', and that entry is unaffected. The bus " +
              "is STILL CONFIGURED: this row (and the live connector it describes) reappears the next time " +
              "this process starts, and the whole bus is re-seeded with it. Change or remove the " +
              "connectors.json entry itself to stop that."
            : remainingDeviceCount > 0
                ? $"{remainingDeviceCount} device(s) remain configured on that line and are unaffected — the " +
                  "bus itself is still configured. "
                : "That was the last device on that line, so the bus is no longer configured at all. ";

        var claim = claimReleased
            ? $"This device's live claim on machine '{machineCode}' was released. "
            : "Nothing was registered live under this device id in this process, so there was no machine " +
              "claim to release. ";

        return opening + line + (source == ConnectorConfigSource.Seeded ? " " : string.Empty) + claim +
               "Two things are unchanged and are worth knowing: the driver that was already polling this " +
               "slave address keeps polling until the fleet is stopped and started (there is no way to stop " +
               "one mid-run), and the machine itself REMAINS IN THE FLEET ROSTER — the roster has no removal " +
               "path, so a replacement connector for this same machine code is still refused until the " +
               "application is restarted.";
    }

    /// <summary>
    /// 🔴 <b>Whole-branch review, I-1's sweep — how an operator actually frees a machine an incumbent
    /// connector is holding, which depends on WHERE that connector came from.</b>
    ///
    /// <para>"Remove that connector first (<c>DELETE /v1/connectors/{id}</c>)" is true of a row an operator
    /// saved and <b>false</b> of one <see cref="ConnectorConfigVisibilitySeeder"/> wrote: that row is a
    /// visibility artifact of an env-var/<c>connectors.json</c> source that is re-seeded on <i>every</i> boot,
    /// so deleting it frees the machine until the next start and no longer. Sending an operator to a
    /// <c>DELETE</c> that will silently undo itself is the same defect class as the message this method was
    /// extracted to fix — one sentence covering two producing paths, true of only one.</para>
    ///
    /// <para>A pure function taking the provenance rather than the store, so every arm is an ordinary
    /// unit-testable argument — the same shape <see cref="DescribeRollbackOutcome"/> and
    /// <see cref="DescribeBusRollbackOutcome"/> already have, and for the same reason: two of these three arms
    /// are otherwise reachable only by constructing a specific store state at a specific endpoint.</para>
    /// </summary>
    /// <param name="incumbentSource"><see langword="null"/> when nothing is persisted under this id at all —
    /// a live claim with no configuration behind it, which only a restart clears.</param>
    /// <param name="incumbentBusInstanceId">Non-null when the incumbent is one DEVICE on an RS-485 bus, in
    /// which case naming the bus is what makes the <c>connectors.json</c> entry findable.</param>
    internal static string DescribeHowToFreeTheMachine(
        string incumbentInstanceId, ConnectorConfigSource? incumbentSource, string? incumbentBusInstanceId)
    {
        if (incumbentSource is null)
        {
            return $"Connector '{incumbentInstanceId}' has no persisted configuration — it is a live claim " +
                   "left by a connector that was already removed, and this build has no way to stop one " +
                   "mid-run, so only restarting the application clears it.";
        }

        if (incumbentSource == ConnectorConfigSource.Seeded)
        {
            var where = string.IsNullOrWhiteSpace(incumbentBusInstanceId)
                ? $"the environment-variable/connectors.json entry that configures '{incumbentInstanceId}'"
                : $"the connectors.json entry for Modbus RTU bus '{incumbentBusInstanceId}'";

            return $"Connector '{incumbentInstanceId}' was NOT saved by an operator — it is a visibility row " +
                   $"auto-populated from this run's own configuration, and it is re-created on every start. " +
                   $"DELETE /v1/connectors/{incumbentInstanceId} therefore frees the machine only until the " +
                   $"next restart: change or remove {where} instead.";
        }

        return $"Remove that connector first (DELETE /v1/connectors/{incumbentInstanceId}).";
    }

    /// <summary>🔴 Task D-7b — every grant declared anywhere on one bus, as ONE capability. Used for the
    /// deliberate-save fingerprint (see <see cref="CreateRtuBusAsync"/>'s own remarks) and for the response's
    /// headline <c>writeCapability</c>. Order-independent by construction —
    /// <see cref="ConnectorWriteCapability.ComputeFingerprint"/> sorts its material — so reordering the
    /// <c>devices</c> array does not change what has to be confirmed, while re-pointing any one device's
    /// command does.</summary>
    internal static ConnectorWriteCapability UnionCapability(IReadOnlyList<ConnectorBusDeviceRow> rows)
    {
        var points = new List<ConnectorWritablePointGrant>();
        var commands = new List<ConnectorCommandGrant>();
        foreach (var row in rows)
        {
            if (row.WriteCapability is null) continue;
            points.AddRange(row.WriteCapability.WritablePoints);
            commands.AddRange(row.WriteCapability.Commands);
        }

        return points.Count == 0 && commands.Count == 0
            ? ConnectorWriteCapability.None
            : new ConnectorWriteCapability(points, commands);
    }

    // ─────────────────────────────────────────────────────────────────────
    // DELETE /v1/connectors/{instanceId}
    // ─────────────────────────────────────────────────────────────────────
    /// <summary>
    /// 🔴 <b>Task D-7a — this now also RELEASES THE LIVE CLAIM, and that closes a defect this file used to
    /// apologise for in prose.</b>
    ///
    /// <para>Before D-7a, DELETE removed only the persisted row. <see cref="ConnectorRegistry"/> had no
    /// removal path at all, so the deleted connector's machine-code CLAIM survived until the process
    /// restarted — and <see cref="CreateConnectorAsync"/> had to grow a whole second 409 message for the
    /// state that produced: <i>"still held by connector X, which was already removed from the persisted
    /// configuration but is STILL RUNNING … restart the application and save again."</i> D-1's own review
    /// (m2) called that out as "the product blaming the operator for having done the right thing".
    /// <see cref="ConnectorRegistry.Unregister"/> exists now, so the claim goes with the row and the operator
    /// can immediately configure a replacement.</para>
    ///
    /// <para><b>What is still true, and is still said in the response:</b> a driver already RUNNING under this
    /// id keeps running until the fleet is next started. Unregistering is a registry mutation — it disposes
    /// nothing and performs no I/O, deliberately (see <see cref="ConnectorRegistry.Unregister"/>), because
    /// disposal belongs to <see cref="FleetCore"/>, which does it outside its own <c>_gate</c> under a bounded
    /// budget. So a write for that machine in the window between this call and the next start resolves to
    /// whatever NEW connector claimed it, finds no live slot for it, and is refused with
    /// <see cref="MachineDriverAvailability.NoLiveDriver"/>. It is never handed to the orphaned driver, which
    /// is the property that had to survive this change.</para>
    ///
    /// <para>🔴 <b>And the limit, measured rather than assumed — the first draft of this method's response
    /// claimed the operator could "save the replacement immediately", and a test proved that false.</b>
    /// <see cref="FleetHost.RegisterMachine"/> has no un-register either, so the deleted connector's MACHINE is
    /// still in the roster — and <see cref="CreateConnectorAsync"/>'s cross-kind roster-collision guard refuses
    /// any later save naming that code, whatever this registry now says. Releasing the claim therefore does
    /// NOT make a same-machine replacement savable without a restart; what it does is make the refusal the
    /// ROSTER's, naming a machine that genuinely is in the fleet, instead of a ghost connector's, naming an
    /// instance the operator had already deleted. Removing a machine from the roster reaches pipeline slots,
    /// alarm <c>TargetId</c>s, the historian and the asset registry, and is not this task's. The response says
    /// all of this rather than letting an operator find it by trying.</para>
    ///
    /// <para><b>Order: store first, registry second.</b> If the store delete fails the request already 500s
    /// and nothing has been released; releasing first would leave a machine claimable while the row that
    /// describes it still exists, which is the same "persisted but never running" asymmetry
    /// <see cref="CompensateFailedLiveRegistrationAsync"/> exists to prevent from the other direction.</para>
    ///
    /// <para><b>The registry is unregistered even when no row existed?</b> No — the 404 above returns first,
    /// unchanged. A live claim with no persisted row is reachable (an env-var or <c>connectors.json</c>
    /// connector), and clearing it through an endpoint whose whole subject is "the persisted configuration"
    /// would be a second, undocumented way to disable a connector the operator configured in a file. That
    /// remains a restart, and <see cref="CreateConnectorAsync"/>'s second 409 branch — which is why it is
    /// kept — is still the message for it.</para>
    /// </summary>
    internal static async Task<IResult> DeleteConnectorAsync(
        string instanceId, ConnectorConfigStore store, ConnectorRegistry connectorRegistry,
        HttpContext ctx, AuditRecorder recorder, CancellationToken ct)
    {
        // Task D-1 — normalized through the SAME DriverKinds.Normalize every other id in this codebase goes
        // through (ConnectorRegistry.Register, ConnectorConfigStore.SaveAsync), so "modbus" still addresses
        // the "Modbus" instance and a third-party id stays case-sensitive exactly as DriverKinds documents.
        var normalized = DriverKinds.Normalize(instanceId);
        var existing = await store.GetAsync(normalized, ct).ConfigureAwait(false);
        if (existing is null)
        {
            return Results.NotFound(new ApiErrorDto($"No persisted connector configuration exists for connector '{instanceId}'."));
        }

        await store.DeleteAsync(normalized, ct).ConfigureAwait(false);

        // 🔴 Task D-7a — see this method's own remarks. Returns false when nothing was registered live under
        // this id (a row persisted by an earlier process run, this one having never registered it), which is
        // an ordinary outcome and not a failure; it changes only what the response says.
        var claimReleased = connectorRegistry.Unregister(normalized);

        await recorder.RecordAsync(
            ctx, "connector.delete", "connector", normalized,
            new { existing.MachineCode, existing.Host, existing.Port, existing.Source, existing.BusInstanceId },
            new { liveClaimReleased = claimReleased },
            ct).ConfigureAwait(false);

        // 🔴 Task D-7b — a DEVICE on a shared RS-485 line. The delete itself is already exactly right (one
        // row, one claim, keyed on the primary key — its seven siblings are untouched, which is the property
        // D-1's per-instance identity bought and which the web UI could not express until this task). What
        // changes is only what the operator is TOLD: they deleted one device off a bus, not "the Modbus
        // connector", and the line keeps running for the rest of the devices on it.
        if (!string.IsNullOrWhiteSpace(existing.BusInstanceId))
        {
            var remaining = await store.ListBusAsync(existing.BusInstanceId, ct).ConfigureAwait(false);
            return Results.Ok(new ConnectorDeleteResultDto(
                normalized,
                DescribeBusDeviceDeletion(
                    normalized, existing.MachineCode, existing.BusInstanceId!, existing.Source,
                    remaining.Count, claimReleased)));
        }

        // English, deliberately — see CreateConnectorAsync's own remark on this.
        //
        // Task B-6 — provenance-aware: deleting a SEEDED row (never something an operator explicitly asked
        // this product to persist — see ConnectorConfigVisibilitySeeder's own doc comment) removes the
        // visibility row but says so plainly, including the one thing the generic message would otherwise
        // leave an operator to discover by surprise — that it comes right back the next time this process
        // starts, as long as the SAME environment-variable/connectors.json configuration is still active.
        var message = existing.Source == ConnectorConfigSource.Seeded
            ? "Removed from the persisted configuration. This row was not created by an operator — it was " +
              "auto-populated for visibility from this run's environment-variable/connectors.json " +
              "configuration. That underlying configuration is unaffected: if it is still active, this row " +
              "(and the live connector it describes) will simply reappear the next time this process starts. " +
              "Remove/change the environment variable or connectors.json entry itself to stop that."
            // 🔴 Task D-7a — the second half of this sentence used to read "there is no live \"unregister\"
            // path", which is no longer true and was the thing that made the operator's next POST fail with a
            // 409 naming a connector they had just deleted. What survives is the part that is still true and
            // that they still have to know: the DRIVER keeps polling until the fleet restarts.
            : claimReleased
                ? $"Removed from the persisted configuration, and this connector's live claim on machine " +
                  $"'{existing.MachineCode}' was released — no connector holds that machine now. Two things " +
                  "are unchanged and are worth knowing: the driver that was already running keeps polling " +
                  "until the fleet is stopped and started (there is no way to stop one mid-run), and the " +
                  "machine itself REMAINS IN THE FLEET ROSTER — the roster has no removal path either, so a " +
                  "replacement connector for this same machine code is still refused until the application is " +
                  "restarted. What the released claim buys today is that the refusal you get is the roster's " +
                  "and not this connector's ghost."
                : "Removed from the persisted configuration. Nothing was registered live under this connector " +
                  "id in this process, so there was no machine claim to release. This machine remains in the " +
                  "fleet roster.";

        return Results.Ok(new ConnectorDeleteResultDto(normalized, message));
    }

    // ─────────────────────────────────────────────────────────────────────
    // POST /v1/connectors/test {kind, host?, port?, mapJson}
    // ─────────────────────────────────────────────────────────────────────
    internal static async Task<IResult> TestConnectorAsync(
        ConnectorTestRequest? body, OpcUaOptions opcUaOptions, CancellationToken ct)
    {
        if (body is null)
        {
            return Results.BadRequest(new ApiErrorDto("Request body is required."));
        }

        // A request-SHAPE problem (bad kind, missing host/port, malformed map) is a 400 — mirrors
        // `POST /v1/settings/probe`'s own precedent (a missing serverUrl is a 400 too). Only a request that
        // parses fine but can't actually reach a device resolves to a 200 with Ok=false (below).
        if (!ConnectorConfigValidation.TryValidate(body.Kind, body.Host, body.Port, body.MapJson, opcUaOptions.PkiDir, out var validated, out var error))
        {
            return Results.BadRequest(new ApiErrorDto(error!));
        }

        // A FRESH TryCreate call, deliberately not reusing anything TryValidate built: this driver is
        // THROWAWAY (never registered into ConnectorRegistry, never seen by FleetHost) — see this class' own
        // doc comment for why that is what keeps this endpoint from ever touching FleetCore._gate (the lock
        // moved with the lifecycle in E-2; FleetHost has none).
        if (!validated.Factory.TryCreate(body.MapJson, out var driver, out var factoryError))
        {
            return Results.Ok(new ConnectorTestResultDto(false, factoryError ?? "The connector factory rejected this configuration."));
        }

        using var timeoutCts = CancellationTokenSource.CreateLinkedTokenSource(ct);
        timeoutCts.CancelAfter(ConnectionTestTimeout);

        var timeoutMessage =
            $"No response within {ConnectionTestTimeout.TotalSeconds:0}s — check the host/port/endpoint and " +
            "that the device is powered on and reachable.";

        try
        {
            await using var enumerator = driver.ReadAsync(timeoutCts.Token).GetAsyncEnumerator(timeoutCts.Token);

            // IDeviceDriver.ReadAsync's own contract permits EITHER of two shapes when cancelled: throw
            // OperationCanceledException from the enumerator (caught below), OR — the built-in Modbus/OPC-UA
            // drivers' own choice — swallow it internally and end the enumeration gracefully (a plain
            // `yield break`, no exception at all). MoveNextAsync's returned bool is what actually
            // distinguishes "a reading came back" (true) from BOTH of those failure shapes (false) — a
            // review-caught bug in an earlier draft of this method ignored this return value entirely and
            // reported every graceful-timeout case as a false "connected".
            var gotReading = await enumerator.MoveNextAsync().ConfigureAwait(false);
            return gotReading
                ? Results.Ok(new ConnectorTestResultDto(true, null))
                : Results.Ok(new ConnectorTestResultDto(false, timeoutMessage));
        }
        catch (OperationCanceledException) when (!ct.IsCancellationRequested)
        {
            return Results.Ok(new ConnectorTestResultDto(false, timeoutMessage));
        }
        catch (Exception ex)
        {
            return Results.Ok(new ConnectorTestResultDto(false, ex.Message));
        }
        finally
        {
            await driver.DisposeAsync().ConfigureAwait(false);
        }
    }

    /// <summary>
    /// 🔴 D-1 re-review, I-A — the operator-facing sentence describing what the rollback actually did.
    ///
    /// <para><b>A pure function, extracted rather than left inline, for exactly the reason I-3's dispatch
    /// loop was.</b> The branch that produces it is only reachable under a concurrent registration, so a
    /// test cannot drive the handler into it — and code a test cannot reach is code nothing ever asks a
    /// consequence question about. That is precisely how the previous version shipped a sentence that
    /// contradicted this file's own test: it said "its configuration was rolled back, so there is no
    /// leftover row to clean up" UNCONDITIONALLY, while
    /// <c>CompensatingAFailedRegistration_NeverThrows_WhenTheStoreCallItselfFails</c> pins that a failed
    /// compensation leaves the row. Pulled out here, all three outcomes are ordinary unit-testable
    /// arguments.</para>
    ///
    /// <para>Three outcomes, because two facts vary independently and both change what an operator should
    /// do: whether the rollback succeeded, and whether this request CREATED the row or overwrote one. The
    /// second matters even on success — a restored row still exists at this instance id, so "there is no
    /// leftover row" would be imprecise there.</para>
    /// </summary>
    /// <param name="rolledBack"><see cref="CompensateFailedLiveRegistrationAsync"/>'s own return value —
    /// never an assumption about it.</param>
    /// <param name="createdByThisRequest"><see langword="true"/> when no row existed before this request, so
    /// rolling back meant deleting.</param>
    internal static string DescribeRollbackOutcome(string instanceId, bool rolledBack, bool createdByThisRequest)
    {
        if (!rolledBack)
        {
            // Stated as a possibility ("may have been left behind") rather than a certainty: the
            // compensation can fail either before or after doing its work, and this method is not in a
            // position to know which. Pointing at the endpoint that would SHOW it is the actionable part.
            return $"⚠ The rollback did NOT complete, so a configuration row for '{instanceId}' may have been " +
                   "left behind that will never run: it would be listed by GET /v1/connectors/configured and " +
                   $"refused again at every restart. Check that endpoint and remove it with " +
                   $"DELETE /v1/connectors/{instanceId} if it is there.";
        }

        return createdByThisRequest
            ? "Nothing was persisted for this connector: its configuration was rolled back, so there is no " +
              "leftover row to clean up."
            : $"The configuration connector '{instanceId}' had BEFORE this request was restored unchanged " +
              "(only its last-updated timestamp moved), so this request left nothing new behind — note that " +
              "a row for this connector does still exist, exactly as it did before.";
    }

    /// <summary>
    /// 🔴 D-1 review, I-1 — undoes <see cref="CreateConnectorAsync"/>'s own <c>SaveAsync</c> when the live
    /// registration that follows it is refused, so a refused save never leaves a persisted connector that
    /// can never go live (see that method's own remarks for the concurrent interleaving that reaches this).
    ///
    /// <para>Two arms, because "roll back" means two different things:
    /// <list type="bullet">
    /// <item><description><paramref name="previous"/> is <see langword="null"/> — this request CREATED the
    /// row, so removing it restores the store exactly.</description></item>
    /// <item><description><paramref name="previous"/> is non-null — this request OVERWROTE a row, so the
    /// previous one is written back field for field, provenance (<see cref="ConnectorConfigSource"/>)
    /// included. Deleting instead would destroy a configuration the operator did not ask to remove, which is
    /// a strictly worse outcome than the orphan this method exists to prevent.</description></item>
    /// </list></para>
    ///
    /// <para><b>Own failure is swallowed, deliberately — and REPORTED.</b> This runs on an error path that is
    /// already returning a 409; letting a second store failure throw would convert an honest "your connector
    /// was not registered" into an opaque 500 AND still leave the row. So the exception is caught — but
    /// 🔴 D-1 re-review (I-A) the method now RETURNS whether the rollback actually happened, because the
    /// caller's 409 previously told the operator "its configuration was rolled back" unconditionally, which
    /// directly contradicted this method's own test pinning that a failed compensation leaves the row. A
    /// message that is false in the direction of "nothing to check here" is worse than no message: it stops
    /// the one person who could clean up from looking.</para>
    ///
    /// <para><b>Pass <see cref="CancellationToken.None"/>, not the request's token</b> (I-A). A compensating
    /// action must not be cancelled by the very token whose cancellation caused it. Threading the request's
    /// <c>ct</c> in here made the rollback fail at its first store call for an entire CLASS of request — any
    /// client that hung up — rather than for some rare interleaving. The parameter is kept so a caller can
    /// still bound this if it ever needs to, but the one production call site passes
    /// <see cref="CancellationToken.None"/> and the reason is written at that call site too.</para>
    ///
    /// <para><b>Residue even on the happy path:</b> <c>updated_at</c> moves (SaveAsync bumped it, the
    /// restore bumps it again). <c>created_at</c> does NOT — <c>SaveAsync</c>'s upsert never updates it — so
    /// a restored row keeps its identity and its full content, and only its "last touched" timestamp lies by
    /// the duration of the failed request.</para>
    /// </summary>
    /// <returns><see langword="true"/> if the store was actually put back the way it was;
    /// <see langword="false"/> if the compensating call itself failed, in which case the row this request
    /// wrote is still there and the caller MUST say so.</returns>
    internal static async Task<bool> CompensateFailedLiveRegistrationAsync(
        ConnectorConfigStore store, string instanceId, ConnectorConfigRecord? previous, CancellationToken ct)
    {
        try
        {
            if (previous is null)
            {
                await store.DeleteAsync(instanceId, ct).ConfigureAwait(false);
                return true;
            }

            await store.SaveAsync(
                    previous.Kind, previous.MachineCode, previous.Host, previous.Port, previous.MapJson,
                    previous.WriteCapability, previous.Source, ct, previous.EffectiveInstanceId)
                .ConfigureAwait(false);
            return true;
        }
        catch
        {
            // See this method's own remarks: an error-path failure must not replace a truthful 409 with a
            // 500. Deliberately not rethrown — but deliberately not hidden either; `false` is what makes the
            // caller's message tell the truth instead of guessing.
            return false;
        }
    }

    /// <summary>Task B-3 fix round 1 (Important #1) — a human-readable rendering of every grant
    /// <paramref name="capability"/> carries, INCLUDING each writable point's declared bounds and each
    /// command's actual wire target — never just names. Used by both the save-gate's 400 (missing
    /// confirmation) and 409 (stale/mismatched confirmation) bodies, so an operator sees exactly what is
    /// being granted before ever confirming it, not merely that "something" is.</summary>
    private static string DescribeGrantedCapability(ConnectorWriteCapability capability)
    {
        var points = new List<string>(capability.WritablePoints.Count);
        foreach (var point in capability.WritablePoints)
        {
            points.Add($"{point.Name}@{point.Target} [{point.Min?.ToString() ?? "n/a"},{point.Max?.ToString() ?? "n/a"}]");
        }

        var commands = new List<string>(capability.Commands.Count);
        foreach (var command in capability.Commands)
        {
            commands.Add($"{command.Name}@{command.Target}");
        }

        return $"writable points: [{string.Join(", ", points)}]; commands: [{string.Join(", ", commands)}]";
    }
}
