using St4i.Connector.Abstractions.Models;
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
/// <item><description><c>DELETE /v1/connectors/{kind}</c> (Engineer, audited <c>connector.delete</c>) —
/// removes ONLY the persisted row. <see cref="FleetHost.RegisterMachine"/> has no unregister (the brief's own
/// explicit constraint) — a machine already in the roster, and any connector currently running for this
/// kind, is UNAFFECTED until the process is fully restarted, at which point Program.cs's startup wiring
/// simply has nothing left to seed for this kind. <see cref="ConnectorDeleteResultDto.Message"/> says this
/// plainly.</description></item>
/// <item><description><c>POST /v1/connectors/test</c> (Engineer, not audited — a read-only probe that
/// mutates nothing, same posture as <c>GET /v1/site/discover</c>) — builds a THROWAWAY driver (never
/// registered into <see cref="ConnectorRegistry"/>, never touches <see cref="FleetHost"/>/its <c>_gate</c> at
/// all) and attempts exactly one bounded read, so an operator learns immediately whether a typo'd IP/endpoint
/// is wrong instead of finding out only after Start. <see cref="St4i.Connector.Abstractions.IConnectorFactory.TryCreate"/>'s
/// own "MUST NOT perform I/O" contract is upheld: the ONLY I/O this endpoint performs is
/// <see cref="St4i.Connector.Abstractions.IDeviceDriver.ReadAsync"/>, called directly by THIS handler on a
/// driver instance nothing else references — never inside <see cref="FleetHost.StartLocked"/>/
/// <see cref="ConnectorRegistry.TryCreateDriver"/>, so it can never block <see cref="FleetHost.Estop"/> or
/// any other <c>_gate</c>-holding call.</description></item>
/// </list>
///
/// <para><b>Scope, deliberately:</b> only <see cref="DriverKinds.Modbus"/>/<see cref="DriverKinds.OpcUa"/> —
/// the two protocols this build actually has a working driver for (see
/// <see cref="ConnectorConfigValidation"/>'s own doc comment). At most ONE persisted/live connector per kind
/// — <see cref="ConnectorRegistry"/> itself only ever holds one factory per normalized kind (its own doc
/// comment: "last write wins"), so this matches the brief's own single-real-machine framing exactly.</para>
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

        app.MapDelete("/v1/connectors/{kind}", DeleteConnectorAsync)
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
    internal static async Task<IResult> CreateConnectorAsync(
        ConnectorCreateRequest? body,
        ConnectorConfigStore store,
        ConnectorRegistry connectorRegistry,
        FleetHost fleetHost,
        OpcUaOptions opcUaOptions,
        HttpContext ctx,
        AuditRecorder recorder,
        CancellationToken ct)
    {
        if (body is null)
        {
            return Results.BadRequest(new ApiErrorDto("Request body is required."));
        }

        if (!ConnectorConfigValidation.TryValidate(body.Kind, body.Host, body.Port, body.MapJson, opcUaOptions.PkiDir, out var validated, out var error))
        {
            return Results.BadRequest(new ApiErrorDto(error!));
        }

        // "No unregister" guard (brief's own explicit concern): this build supports exactly ONE live
        // connector per kind (see ConnectorRegistry's own "one factory per kind" invariant), so re-pointing
        // an ALREADY-CONFIGURED kind at a DIFFERENT machine code would either strand the old roster entry
        // forever (RegisterMachine has no unregister) or silently swap which physical machine a familiar
        // roster tile represents — both dishonest. An operator who genuinely wants to switch machines must
        // explicitly DELETE the old configuration first.
        var existing = await store.GetAsync(validated.Kind, ct).ConfigureAwait(false);
        if (existing is not null && !string.Equals(existing.MachineCode, validated.MachineCode, StringComparison.OrdinalIgnoreCase))
        {
            return Results.Conflict(new ApiErrorDto(
                $"A {validated.Kind} connector is already configured for machine '{existing.MachineCode}'. " +
                $"This build supports one live connector per protocol — remove the existing one first " +
                $"(DELETE /v1/connectors/{validated.Kind}) before configuring a different machine of the same kind."));
        }

        var before = existing is null
            ? null
            : new { existing.MachineCode, existing.Host, existing.Port };

        var saved = await store.SaveAsync(validated.Kind, validated.MachineCode, validated.Host, validated.Port, body.MapJson, ct)
            .ConfigureAwait(false);

        // Live-register BEFORE RegisterMachine — a restart-if-running triggered below must always see the
        // freshly-registered factory, never the stale one it's replacing.
        connectorRegistry.Register(validated.Factory, body.MapJson);

        // RegisterMachine only ADDS (see this class' own doc comment) — true means a brand-new machine code
        // just joined the roster (and, if the fleet was running, RegisterMachine already restarted the
        // pipeline itself); false means this machine code was already present (an update to an existing
        // connector's settings), which this call intentionally does NOT restart — see the message below.
        var added = fleetHost.RegisterMachine(validated.Descriptor);

        await recorder.RecordAsync(
            ctx, "connector.save", "connector", validated.Kind,
            before,
            new { validated.MachineCode, validated.Host, validated.Port },
            ct).ConfigureAwait(false);

        // English, deliberately — like every other server-generated message in this codebase (SiteEndpoints,
        // SettingsEndpoints, ModbusRegisterMap, ...), this is a diagnostic/API-Inspector-facing string, not
        // the bilingual UI surface itself; the web client derives its own vi/en copy from `AppliedLive`
        // (see web/src/routes/Connectors.tsx) rather than displaying this field verbatim.
        var message = added
            ? "Saved and added to the fleet. If the fleet was already running, it was restarted to apply this immediately."
            : "Saved. This machine was already in the roster — the change applies on the next Stop/Start " +
              "(or a full application restart), not immediately to an already-running fleet.";

        return Results.Ok(new ConnectorCreateResultDto(saved, AppliedLive: added, message));
    }

    // ─────────────────────────────────────────────────────────────────────
    // DELETE /v1/connectors/{kind}
    // ─────────────────────────────────────────────────────────────────────
    internal static async Task<IResult> DeleteConnectorAsync(
        string kind, ConnectorConfigStore store, HttpContext ctx, AuditRecorder recorder, CancellationToken ct)
    {
        var normalized = DriverKinds.Normalize(kind);
        var existing = await store.GetAsync(normalized, ct).ConfigureAwait(false);
        if (existing is null)
        {
            return Results.NotFound(new ApiErrorDto($"No persisted connector configuration exists for kind '{kind}'."));
        }

        await store.DeleteAsync(normalized, ct).ConfigureAwait(false);

        await recorder.RecordAsync(
            ctx, "connector.delete", "connector", normalized,
            new { existing.MachineCode, existing.Host, existing.Port },
            null,
            ct).ConfigureAwait(false);

        // English, deliberately — see CreateConnectorAsync's own remark on this.
        const string message =
            "Removed from the persisted configuration. This machine remains in the fleet roster and, if a " +
            "connector of this kind is currently running, keeps running until the application is fully " +
            "restarted — there is no live \"unregister\" path.";

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
        // doc comment for why that is what keeps this endpoint from ever touching FleetHost._gate.
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
}
