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
/// <para><b>Fix round 1 (review, Important #2) — a skipped seed due to an EXISTING OPERATOR row now ALWAYS
/// warns loudly, naming exactly which endpoint is showing stale data.</b> Every call to <see cref="SeedAsync"/>
/// is for a <paramref name="kind"/> THIS RUN's env-var/connectors.json source is ACTIVELY driving (see
/// Program.cs's own call sites — <c>SeedAsync</c> is never called for a kind with no live non-store source
/// this run) — which, per the pre-existing precedence rule, ALWAYS wins over a persisted row for the SAME
/// kind at the live-registry level. So an existing OPERATOR row at this point is, BY CONSTRUCTION, ALREADY
/// shadowed: the live driver may be able to write/command the machine while the persisted row (what
/// <c>GET /v1/connectors/configured</c> actually shows) reports something else entirely — most dangerously,
/// under-reporting a writable connector as read-only (an operator's earlier read-only <c>POST</c>, now
/// shadowed by a WRITABLE env-var map). Silently skipping, as the original version of this fix did, preserves
/// EXACTLY the false report the carried B-3 finding exists to close, in the safety-relevant direction. Every
/// skip due to an OPERATOR row is now reported via <paramref name="logWarning"/>, unconditionally — not just
/// when a capability mismatch is detected, since ANY difference (a different machine code, host, or
/// capability) means the same thing: the persisted row is not what is actually running.</para>
///
/// <para><b>Task B-6 (.superpowers/sdd/2026-07-29-dotB-machine-control-blueprint/task-6-brief.md) —
/// closes the carried B-4 finding: a <see cref="ConnectorConfigSource.Seeded"/> row is now told apart from a
/// <see cref="ConnectorConfigSource.Operator"/> one, so this method can tell "an operator's own configuration,
/// now shadowed" (still insert-only, still warns loudly — behavior UNCHANGED for that case) apart from
/// "my own artifact from an earlier boot of the SAME env-var/connectors.json source" (safe to refresh in
/// place — nobody but this method could have created it, so there is no operator data to protect here). The
/// latter case is now an UPSERT, not a skip: no warning (there is nothing wrong to warn about — a fresh row
/// for a kind this run is actively driving replacing a stale one from an earlier boot of the SAME kind is
/// exactly correct), and it ALSO closes B-4's own documented "accepted residual gap" (a seeded row going
/// stale after a hand-edited map, fixable before this task only by an explicit
/// <c>DELETE /v1/connectors/{kind}</c> + restart) — every boot now re-seeds a <see cref="ConnectorConfigSource.Seeded"/>
/// row fresh, automatically.</para>
///
/// <para><b>Fix round 1 (review, Important I3) — correction: THIS fix alone did not close the carried B-4
/// "warns about its own row every boot" symptom.</b> The original B-6 submission's report claimed it did, which
/// was WRONG — there is a SEPARATE warning site, <c>Program.cs</c>'s persisted-row startup loop (the code that
/// decides which persisted rows get their machine registered into the roster, entirely independent of THIS
/// class), which reads the exact same <c>connector_configs</c> rows and had its OWN, unguarded "ignored — an
/// environment variable ... already configures this connector kind" warning with no <c>Source</c> check at
/// all. From boot 2 onward that OTHER loop's warning fired about this seeder's own row every single boot —
/// verbatim the symptom this class's own doc comment above claims is closed. Both sites needed the identical
/// one-line guard; only this one had it until fix round 1 added the same check to <c>Program.cs</c>'s loop.
/// See <c>ConnectorEndpointsEnvSeedingSideEffectsTests.PersistedRowStartupLoop_*</c> for the real-logging-
/// pipeline proof of the OTHER site now closed too.</para>
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

            // Task B-6 — only an existing OPERATOR row is protected/warned-about. A row this SAME mechanism
            // seeded on an earlier boot carries no operator data to protect — nobody but SeedAsync could have
            // created a Seeded row — so it is safe, and correct, to refresh it in place below instead of
            // treating it as a shadowed conflict.
            if (existing is not null && existing.Source == ConnectorConfigSource.Operator)
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

            // No warning here even when existing is non-null (a Seeded row from an earlier boot of this SAME
            // source) — SaveAsync's upsert (ON CONFLICT ... DO UPDATE) simply refreshes it, closing B-4's own
            // documented staleness gap for this case automatically.
            await store.SaveAsync(
                    validated.Kind, validated.MachineCode, validated.Host, validated.Port, mapJson,
                    validated.WriteCapability, source: ConnectorConfigSource.Seeded, ct: ct)
                .ConfigureAwait(false);
        }
        catch (Exception ex)
        {
            logWarning?.Invoke($"Failed to seed connector-configuration visibility for kind '{kind}': {ex.Message}");
        }
    }
}
