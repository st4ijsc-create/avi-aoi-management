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
                // Insert-only — see this class's own doc comment for why an existing row (most likely an
                // operator's own persisted configuration) is never overwritten here.
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
