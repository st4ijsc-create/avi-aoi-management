namespace St4i.EngineApi.Fleet;

/// <summary>
/// Task B-4 (.superpowers/sdd/2026-07-29-dotB-machine-control-blueprint/task-4-brief.md) — closes the
/// carried B-3 finding (fix round 1, I2 — "hard deadline"): <c>ST4I_MODBUS_MAP</c>/<c>ST4I_OPCUA_MAP</c> and
/// <c>connectors.json</c> parse a map through the SAME <c>ModbusRegisterMap.FromJson</c>/<c>OpcUaNodeMap.FromJson</c>
/// the interactive <c>POST /v1/connectors</c> path uses (mandatory limits ARE enforced identically — no
/// safety bypass) but seed the fleet roster directly, never touching <see cref="ConnectorConfigStore"/> —
/// so <c>GET /v1/connectors/configured</c> (the one endpoint meant to show which connectors can command a
/// machine) reported NOTHING for them at all. Before B-4 that silence cost nothing (nothing wrote yet); the
/// moment a real write is reachable, an operator/auditor checking that one endpoint gets a false "nothing
/// here" for the deployment shape a machine builder is most likely to use (a fixed register/node map baked
/// into the deployment, not pasted through the UI).
///
/// <para><b>What this does NOT do — deliberately.</b> This is a VISIBILITY fix, not a data-migration and not
/// a second save gate: it never applies the B-3 deliberate-confirmation gate (there is no interactive
/// request to gate — the map was already accepted as configuration for this run), and it never OVERWRITES an
/// already-persisted row for the same kind. <see cref="SeedAsync"/> is INSERT-ONLY: if
/// <see cref="ConnectorConfigStore.GetAsync"/> already returns a row for <paramref name="kind"/> (most likely
/// an operator's own earlier <c>POST /v1/connectors</c> for that kind, now shadowed by this run's env-var/
/// connectors.json source per the existing precedence rule — see Program.cs's own remarks), that row is left
/// completely untouched. Destroying an operator's own persisted configuration in the name of "visibility"
/// would be a strictly worse defect than the one being closed.</para>
///
/// <para><b>Accepted residual gap</b> (flagged explicitly, per the review discipline this whole batch follows,
/// rather than left silent): because seeding is insert-only, a row seeded on an earlier run goes STALE if the
/// env-var/connectors.json map file is later hand-edited (e.g. a writable range widened) and the process is
/// simply restarted — <c>GET /v1/connectors/configured</c> keeps showing the OLD capability until the stale
/// row is removed (<c>DELETE /v1/connectors/{kind}</c>) and this seeding runs again on the next start. Accepted
/// for a deployment shape that is provisioned once, not iterated on live — the alternative (overwrite on every
/// startup) risks silently destroying an operator's own persisted row the moment BOTH sources happen to name
/// the same kind (see above), which is the worse failure mode of the two.</para>
///
/// <para><b>Fix round 1 (review, Important #2) — a skipped seed due to an existing row now ALWAYS warns
/// loudly, naming exactly which endpoint is showing stale data.</b> Every call to <see cref="SeedAsync"/> is
/// for a <paramref name="kind"/> THIS RUN's env-var/connectors.json source is ACTIVELY driving (see
/// Program.cs's own call sites — <c>SeedAsync</c> is never called for a kind with no live non-store source
/// this run) — which, per the pre-existing precedence rule, ALWAYS wins over a persisted row for the SAME
/// kind at the live-registry level. So an existing row at this point is, BY CONSTRUCTION, ALREADY shadowed:
/// the live driver may be able to write/command the machine while the persisted row (what
/// <c>GET /v1/connectors/configured</c> actually shows) reports something else entirely — most dangerously,
/// under-reporting a writable connector as read-only (an operator's earlier read-only <c>POST</c>, now
/// shadowed by a WRITABLE env-var map). Silently skipping, as the original version of this fix did, preserves
/// EXACTLY the false report the carried B-3 finding exists to close, in the safety-relevant direction. Every
/// skip here is now reported via <paramref name="logWarning"/>, unconditionally — not just when a capability
/// mismatch is detected, since ANY difference (a different machine code, host, or capability) means the same
/// thing: the persisted row is not what is actually running. A proper fix would add a <c>source</c> column
/// (<c>"env"</c>/<c>"connectors.json"</c>/<c>"operator"</c>) so a seeded row could be told apart from an
/// operator's own and safely refreshed — scoped OUT of this task (B-4 has no endpoint-layer changes in scope);
/// this warning is the accepted minimum instead.</para>
/// </summary>
public static class ConnectorConfigVisibilitySeeder
{
    /// <summary>
    /// Seeds a visibility-only row into <paramref name="store"/> for one connector this run configured via
    /// env var / <c>connectors.json</c>, reusing the EXACT SAME <see cref="ConnectorConfigValidation.TryValidate"/>
    /// the interactive save path already uses — so the reported <c>WriteCapability</c> is never re-derived a
    /// second, possibly-inconsistent way. Never throws: a malformed map or a store failure is reported via
    /// <paramref name="logWarning"/> and otherwise ignored — seeding a "nice to have" visibility row must
    /// never be allowed to fail startup, mirroring every other startup config source in this codebase.
    /// </summary>
    /// <param name="store">The persisted connector-configuration store.</param>
    /// <param name="kind">The normalized connector kind (<see cref="St4i.Connector.Abstractions.Models.DriverKinds.Modbus"/>/
    /// <see cref="St4i.Connector.Abstractions.Models.DriverKinds.OpcUa"/>).</param>
    /// <param name="host">Modbus host (ignored for OPC-UA — see <see cref="ConnectorConfigValidation"/>'s own
    /// doc comment for why).</param>
    /// <param name="port">Modbus port (ignored for OPC-UA).</param>
    /// <param name="mapJson">The exact register-map/node-map JSON text this run already loaded and is
    /// actively using — persisted verbatim, no re-serialization.</param>
    /// <param name="pkiDir">OPC-UA's app-instance-certificate root (ignored for Modbus).</param>
    /// <param name="logWarning">Invoked at most once, naming <paramref name="kind"/>, if seeding could not
    /// complete for any reason. Optional.</param>
    public static async Task SeedAsync(
        ConnectorConfigStore store, string kind, string? host, int? port, string mapJson, string? pkiDir,
        Action<string>? logWarning = null, CancellationToken ct = default)
    {
        try
        {
            var existing = await store.GetAsync(kind, ct).ConfigureAwait(false);
            if (existing is not null)
            {
                // Fix round 1 (review, Important #2) — insert-only still (never overwrite an operator's own
                // persisted row — see this class's own doc comment), but no longer a SILENT skip: this call
                // only ever happens for a kind THIS RUN's env-var/connectors.json source is actively
                // driving, so an existing row here is, by construction, already shadowed and potentially
                // reporting something other than what the live connector can actually do.
                logWarning?.Invoke(
                    $"GET /v1/connectors/configured is showing a PERSISTED row for kind '{kind}' (machine " +
                    $"'{existing.MachineCode}'), but this run's environment-variable/connectors.json source " +
                    "is the one actually driving this connector — it takes precedence over the persisted row " +
                    "at the live-registry level. The persisted row's reported write capability may NOT " +
                    "reflect what the live connector can actually do (most dangerously, it can under-report " +
                    $"a writable connector as read-only). Delete the persisted row (DELETE /v1/connectors/{kind}) " +
                    "and restart to let this run's own configuration be seeded and reported accurately.");
                return;
            }

            if (!ConnectorConfigValidation.TryValidate(kind, host, port, mapJson, pkiDir, out var validated, out var error))
            {
                logWarning?.Invoke(
                    $"Could not seed connector-configuration visibility for kind '{kind}' — the map that " +
                    $"already validated and is actively running failed re-validation here: {error}");
                return;
            }

            await store.SaveAsync(
                    validated.Kind, validated.MachineCode, validated.Host, validated.Port, mapJson,
                    validated.WriteCapability, ct)
                .ConfigureAwait(false);
        }
        catch (Exception ex)
        {
            logWarning?.Invoke($"Failed to seed connector-configuration visibility for kind '{kind}': {ex.Message}");
        }
    }
}
