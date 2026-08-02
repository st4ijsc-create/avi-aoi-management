using Microsoft.Extensions.Logging;
using St4i.Connector.Abstractions;
using St4i.Connector.Abstractions.Models;
using St4i.EdgeCore.Drivers.Modbus;
using St4i.EdgeCore.Drivers.OpcUa;
using St4i.EngineApi.Fleet;

namespace St4i.EngineApi.Config;

/// <summary>
/// 🔴 D-1 review, I-3 — the <c>connectors.json</c> → <see cref="ConnectorRegistry"/> dispatch, extracted
/// verbatim out of <c>Program.cs</c>'s DI lambda so it can be tested at all.
///
/// <para><b>Why the extraction, stated as the defect it fixes.</b> This dispatch — pick a built-in factory
/// for the entry's kind, learn the machine code the entry's own settings blob declares, register the two
/// together — had NEVER been covered by any test, before or after Task D-1, and D-1 <i>added</i> code to it
/// (the <see cref="ConnectorConfigValidation.TryValidate"/> call and the <c>machineCode:</c> argument). A
/// mutation that made every <c>connectors.json</c> connector register UNBOUND left the whole suite green.
/// It was untestable for a structural reason, not an oversight: <c>Program.cs</c> reads
/// <c>connectors.json</c> from <see cref="AppContext.BaseDirectory"/>, which is ONE shared artifact in the
/// test assembly's own output directory, so a test that wrote it would race every other test in the
/// assembly.</para>
///
/// <para><b>Extraction rather than a new configuration surface.</b> The obvious alternative — an
/// <c>ST4I_CONNECTORS_CONFIG</c> path override, mirroring every store's <c>ST4I_*_DIR</c> — would also have
/// made this testable, but it ships a new operator-visible knob purely to serve a test, and a configuration
/// surface is a permanent commitment. This method takes the already-parsed entries as an argument instead,
/// so a test supplies them directly: no env var, no file, no race, nothing new for an operator to learn.
/// What remains uncovered is the single <c>Path.Combine(AppContext.BaseDirectory, "connectors.json")</c> +
/// <see cref="ConnectorsConfig.Load"/> call in <c>Program.cs</c>, which has no branching in it —
/// <see cref="ConnectorsConfig.Load"/> itself is separately and thoroughly covered by
/// <c>ConnectorsConfigTests</c> against real temp files.</para>
///
/// <para><b>This is a MOVE, not a rewrite.</b> Every warning message, every dispatch arm, the skip-with-a-
/// named-warning posture for an undispatchable kind, and the instance-id/machine-code decisions below are
/// byte-for-byte what <c>Program.cs</c> executed at <c>f57dcd95</c>; only their address changed.</para>
/// </summary>
public static class ConnectorsJsonRegistration
{
    /// <summary>
    /// Registers every entry in <paramref name="entries"/> into <paramref name="registry"/>, dispatching by
    /// (already-normalized) kind to whichever built-in factory type this build knows how to construct.
    /// </summary>
    /// <param name="entries">The entries <see cref="ConnectorsConfig.ResolveEntries"/> already resolved —
    /// env-var-wins and first-entry-per-kind-wins have both been applied by the caller, so this method takes
    /// what it is given and does not re-decide precedence.</param>
    /// <param name="modbusOptions">The ONE process-wide, env-derived <see cref="ModbusOptions"/> every
    /// <c>connectors.json</c> Modbus entry reuses — a pre-existing SM-5 limitation this task does not touch
    /// (only the register MAP is per-entry today). Also supplies the host/port
    /// <see cref="ConnectorConfigValidation.TryValidate"/> needs to parse a Modbus entry at all.</param>
    /// <param name="opcUaOptions">Supplies <see cref="OpcUaOptions.PkiDir"/>, the device-wide
    /// app-instance-certificate root.</param>
    /// <param name="registry">The registry to populate.</param>
    /// <param name="logger">Every skip/failure is reported here — "visible, never silent", the same posture
    /// as every other startup config path in <c>Program.cs</c>.</param>
    /// <returns>The number of entries actually registered. Not used by <c>Program.cs</c> (which cares only
    /// about the side effect); returned so a caller — and a test — can tell "dispatched and registered" from
    /// "silently skipped" without having to reconstruct it from the registry's contents.</returns>
    public static int RegisterAll(
        IReadOnlyList<ConnectorConfigEntry> entries,
        ModbusOptions modbusOptions,
        OpcUaOptions opcUaOptions,
        ConnectorRegistry registry,
        ILogger logger)
    {
        ArgumentNullException.ThrowIfNull(entries);
        ArgumentNullException.ThrowIfNull(registry);

        var registered = 0;

        foreach (var entry in entries)
        {
            // Dispatch by (normalized) kind to whichever built-in factory type this build knows how to
            // construct. Third-party kinds aren't dispatchable here YET — there is no in-process
            // plugin-loading mechanism in this build (that is future work, the eventual out-of-process
            // sidecar isolation model) — a `connectors.json` entry for one is skipped with a named warning
            // rather than silently ignored, same "visible, never silent" posture as every other skip.
            IConnectorFactory? factory = entry.Kind switch
            {
                DriverKinds.Modbus => new ModbusConnectorFactory(
                    modbusOptions,
                    logWarning: msg => logger.LogWarning("{ConnectorsConfigModbusMsg}", msg),
                    logError: (ex, msg) => logger.LogError(ex, "{ConnectorsConfigModbusMsg}", msg)),
                DriverKinds.OpcUa => new OpcUaConnectorFactory(
                    pkiDir: opcUaOptions.PkiDir,
                    logWarning: msg => logger.LogWarning("{ConnectorsConfigOpcUaMsg}", msg),
                    logError: (ex, msg) => logger.LogError(ex, "{ConnectorsConfigOpcUaMsg}", msg)),
                _ => null,
            };

            if (factory is null)
            {
                logger.LogWarning(
                    "connectors.json entry '{ConnectorId}': no in-process factory constructor is available for kind '{ConnectorKind}' — skipped.",
                    entry.Id, entry.Kind);
                continue;
            }

            // Task D-1 — bind this entry to the machine code its own settings blob declares, so a write for
            // that machine resolves to THIS connector rather than falling back to the pre-D-1 kind-based
            // rule. Re-validating here is the only way to learn that code (the settings blob is opaque to
            // this layer and forwarded verbatim); a blob that will not validate simply registers UNBOUND,
            // which is exactly the behaviour this path had before D-1 — the entry still registers, its
            // factory still gets the chance to accept or reject the same blob at StartLocked, and nothing
            // about that path changes.
            //
            // The INSTANCE id is deliberately left to default to the kind, NOT set to entry.Id: entry.Id is
            // documented (ConnectorConfigEntry) as naming-for-warnings only, ConnectorsConfig.ResolveEntries
            // still de-duplicates connectors.json to one entry per kind, and adopting it here would silently
            // change every connectors.json connector's pipeline slot label — and therefore its alarm
            // TargetId — for no gain this task needs. Promoting entry.Id to a real instance id (which is
            // what would let connectors.json express two RTU connectors on one bus) is a file-format change
            // with no migration behind it, and belongs with D-7's configuration work.
            ConnectorConfigValidation.TryValidate(
                entry.Kind, modbusOptions.Host, modbusOptions.Port, entry.SettingsJson, opcUaOptions.PkiDir,
                out var entryValidated, out _);

            if (!registry.Register(factory, entry.SettingsJson, machineCode: entryValidated?.MachineCode))
            {
                logger.LogWarning(
                    "connectors.json entry '{ConnectorId}' (kind '{ConnectorKind}') failed to register (its Kind getter " +
                    "threw or was blank, or machine '{MachineCode}' is already claimed by another connector instance).",
                    entry.Id, entry.Kind, entryValidated?.MachineCode);
                continue;
            }

            registered++;
        }

        return registered;
    }
}
