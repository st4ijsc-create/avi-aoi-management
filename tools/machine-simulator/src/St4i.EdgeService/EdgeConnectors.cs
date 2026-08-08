using Microsoft.Extensions.Logging;
using St4i.Connector.Abstractions;
using St4i.Connector.Abstractions.Models;
using St4i.EdgeCore.Config;
using St4i.EdgeCore.Drivers.Modbus;
using St4i.EdgeCore.Fleet;

namespace St4i.EdgeService;

/// <summary>
/// 🔴 <b>Task E-3 — this host's <c>connectors.json</c> composition root: the file, parsed by the SHARED
/// parser, dispatched to the factories THIS host can actually construct, registered one instance per
/// entry.</b>
///
/// <para>Before E-3, <c>St4i.EdgeService</c> had no connector plumbing at all — its own <c>.csproj</c>
/// comment said so, and said that giving this host a COM port "means giving this host a connector registry
/// first, which is a separate piece of work nobody has scoped". This is that registry.</para>
///
/// <para><b>The parser is SHARED, and that is the point.</b> <see cref="ConnectorsConfig"/> moved from
/// <c>St4i.EngineApi.Config</c> to <c>St4i.EdgeCore.Config</c> in E-3 so both hosts read the file, apply the
/// per-entry tolerance, and resolve precedence through ONE implementation. A second parser here would have
/// been the config-layer twin of the two-readers-of-<c>--fleet</c> hazard blueprint §9.4(1) records —
/// one file, two hosts, two ideas of what it says.</para>
///
/// <para><b>The DISPATCH is deliberately this host's own, and deliberately NARROWER than EngineApi's.</b>
/// <c>ConnectorsJsonRegistration</c> (EngineApi) is not shareable as it stands: it needs <see cref="ILogger"/>,
/// <c>ConnectorConfigValidation</c>, <c>ModbusRtuBusPlan</c> and <c>ModbusMultidropRegistration</c>, and that
/// last one calls <c>RtuBusConfiguration.IsInBusNamespace</c> — a rule its own doc comment says must be
/// stated exactly ONCE because three callers have to agree. It is not a leaf; blueprint §9.6(a) names that
/// exact shape. Moving it is real work with a real hazard, and folding it into a lifecycle task is the
/// "a fix and a sweep feel like one action but are two" trap. Recorded in blueprint §11 as E-4's.</para>
///
/// <para>🔴 <b>WHAT THIS HOST WILL AND WILL NOT DISPATCH, each with the reason stated where an operator
/// meets it (a skipped entry is always logged by id and kind — visible, never silent):</b>
/// <list type="bullet">
/// <item><b>Modbus TCP — YES.</b> <see cref="ModbusConnectorFactory"/> already lives in
/// <c>St4i.EdgeCore</c>; a <c>ModbusTcpDriver</c> owns a socket and no machine-wide file.</item>
/// <item><b>Modbus RTU (an entry declaring a <c>transport</c>) — NO, skipped with a named warning.</b> An
/// RTU entry is a BUS that fans out into N devices, and the fan-out plus its ghost sweep
/// (<c>ModbusMultidropRegistration</c>) is the non-leaf above. Refusing loudly is the honest answer: the
/// alternative — a second, simpler fan-out written here — is two implementations of the one rule that
/// decides which registration a device owns.</item>
/// <item>🔴 <b>OPC-UA — NO, and the reason is the brief's own ruling, not a missing type.</b>
/// <see cref="St4i.EdgeCore.Drivers.OpcUa.OpcUaConnectorFactory"/> is right here in EdgeCore and would
/// compile. But an <c>OpcUaDriver</c> writes its app-instance certificate into
/// <c>OpcUaPkiPaths.ResolveRoot</c> — <c>%ProgramData%\ST4I\sim\opcua-pki</c>, <b>machine-wide, with no
/// per-process key</b>. Dispatching it here would make <c>St4i.EdgeService</c> a NEW WRITER to a
/// machine-wide store, which E-3's brief forbids outright and hands to the owner as the per-host data-root
/// decision. Enabling it is one <c>switch</c> arm once that decision exists.</item>
/// <item><b>Any other kind — NO</b>, same as EngineApi: there is no in-process plugin loader in this
/// build.</item>
/// </list></para>
///
/// <para>🔴 <b>ONE DELIBERATE DIVERGENCE FROM EngineApi, stated because a silent one would be a defect:
/// every entry registers under its OWN <c>id</c>, not under its kind.</b>
/// <c>ConnectorsJsonRegistration.RegistrationKeyOf</c> answers "the kind" for a TCP/OPC-UA entry, and its
/// own doc comment says why: adopting the operator's id there would move an existing install's pipeline slot
/// label and therefore its alarm <c>TargetId</c>, "a change worth making only alongside a migration nobody
/// has asked for". <b>This host has no such legacy</b> — it has never hosted a connector at all, so there is
/// nothing to fork and no <c>TargetId</c> to move. Keying on the id is also what makes N entries mean N
/// drivers here (kind-keying collapses every Modbus entry to one). The same key is handed to
/// <see cref="ConnectorsConfig.ResolveEntries"/>, so its de-duplication compares the key an entry will
/// ACTUALLY register under — which is the entire contract of that parameter.</para>
/// </summary>
internal static class EdgeConnectors
{
    /// <summary>Same shipping convention as <c>fleet.json</c>: a loose, hand-editable file next to the exe.
    /// 🔴 Blueprint §9.4(1): <c>St4i.EdgeService.csproj</c> ships NO <c>connectors.json</c>, and E-3
    /// deliberately does not start shipping one — a shipped empty array is byte-for-byte indistinguishable
    /// from an absent file (<see cref="ConnectorsConfig.Load"/> answers an empty list either way), so it
    /// would add a deployment artifact that changes nothing. What E-3 does instead is make the LOOKUP say
    /// where it looked and what it found, so "no connectors configured" is never a silent state with no
    /// stated cause — which is the half of §9.4 that actually bites.</summary>
    internal const string ConnectorsFileName = "connectors.json";

    /// <summary>The file this run reads: <c>--connectors &lt;path&gt;</c> when given, else
    /// <c>connectors.json</c> beside the exe. A separate flag from <c>--fleet</c> on purpose — they name two
    /// different files, and blueprint §9.4(1) is a record of what happens when one flag has two readers.</summary>
    internal static string ResolvePath(string? explicitPath) =>
        string.IsNullOrWhiteSpace(explicitPath)
            ? Path.Combine(AppContext.BaseDirectory, ConnectorsFileName)
            : explicitPath;

    /// <summary>The key an entry will actually be registered under here — see the class remarks. A blank id
    /// cannot happen (<see cref="ConnectorsConfig.Load"/> defaults it to the kind), but normalising through
    /// <see cref="DriverKinds.Normalize"/> is what makes this comparable to
    /// <see cref="ConnectorRegistry"/>'s own keys, which are normalised on the way in.</summary>
    internal static string RegistrationKeyOf(ConnectorConfigEntry entry)
    {
        ArgumentNullException.ThrowIfNull(entry);
        return DriverKinds.Normalize(entry.Id.Trim());
    }

    /// <summary>
    /// Reads <paramref name="path"/> and registers every dispatchable entry.
    /// </summary>
    /// <returns>A populated <see cref="ConnectorRegistry"/>, or <see langword="null"/> when this run has no
    /// connectors at all — an absent file, an empty array, or a file whose every entry was skipped.
    /// <see langword="null"/> rather than an empty registry so the caller's "this deployment has no
    /// connectors.json" path is reached by the SAME value in all three cases, and so
    /// <see cref="St4i.EdgeCore.Engine.EdgeAgentPipelines"/> is handed exactly what it was handed before this
    /// file existed.</returns>
    internal static ConnectorRegistry? Build(string path, ILogger logger)
    {
        ArgumentException.ThrowIfNullOrEmpty(path);
        ArgumentNullException.ThrowIfNull(logger);

        IReadOnlyList<ConnectorConfigEntry> parsed;
        try
        {
            parsed = ConnectorsConfig.Load(path, msg => logger.LogWarning("{ConnectorsConfigWarning}", msg));
        }
        catch (ConnectorsConfigException ex)
        {
            // Same posture as every other startup config path in this product, and the same one
            // EdgeWorker.LoadFleet already takes for a malformed fleet.json: a hand-editing mistake disables
            // the connectors for this run, loudly, and never takes the process down.
            logger.LogError(ex,
                "connectors.json at '{ConnectorsPath}' could not be read — no connector is configured for this " +
                "run. The simulated fleet is unaffected.", path);
            return null;
        }

        if (parsed.Count == 0)
        {
            // 🔴 The §9.4(1) half that matters: say WHERE we looked. An empty roster with no stated cause is
            // the defect class that blueprint calls the frightening one.
            logger.LogInformation(
                "No connectors configured: '{ConnectorsPath}' is absent or declares no entries.", path);
            return null;
        }

        // This host has NO environment-variable connector route at all — it has never read
        // ST4I_MODBUS_ENABLED/ST4I_OPCUA_ENABLED, unlike EngineApi's Program.cs — so the env-precedence set
        // is genuinely empty here rather than "empty for now". What ResolveEntries still does for us is its
        // OTHER rule: first-entry-per-registration-key wins, which with this host's id-keying means a
        // duplicated id is skipped with a warning naming both, never silently last-write-wins into the
        // registry.
        var resolved = ConnectorsConfig.ResolveEntries(
            parsed,
            alreadyConfiguredKinds: new HashSet<string>(StringComparer.Ordinal),
            logWarning: msg => logger.LogWarning("{ConnectorsConfigWarning}", msg),
            registrationKeyOf: RegistrationKeyOf);

        var modbusOptions = ModbusOptions.FromEnvironment();
        var registry = new ConnectorRegistry();
        var registered = 0;

        foreach (var entry in resolved)
        {
            var factory = TryBuildFactory(entry, modbusOptions, logger);
            if (factory is null) continue;

            if (!registry.Register(factory, entry.SettingsJson, instanceId: RegistrationKeyOf(entry)))
            {
                logger.LogWarning(
                    "connectors.json entry '{ConnectorId}' (kind '{ConnectorKind}') failed to register — its " +
                    "factory's Kind getter threw or was blank. That entry will not be polled; every other entry " +
                    "is unaffected.",
                    entry.Id, entry.Kind);
                continue;
            }

            registered++;
        }

        if (registered == 0)
        {
            logger.LogWarning(
                "connectors.json at '{ConnectorsPath}' declares {EntryCount} entry(ies) but none of them could be " +
                "dispatched by this host — no connector is configured for this run.", path, parsed.Count);
            return null;
        }

        logger.LogInformation(
            "connectors.json at '{ConnectorsPath}': {RegisteredCount} connector instance(s) registered.",
            path, registered);
        return registry;
    }

    /// <summary>The dispatch itself. Every refusal names the entry and the reason — see the class remarks for
    /// why each arm is the arm it is.</summary>
    private static IConnectorFactory? TryBuildFactory(ConnectorConfigEntry entry, ModbusOptions modbusOptions, ILogger logger)
    {
        if (entry.Kind == DriverKinds.Modbus && ModbusRtuBusSettings.DeclaresATransport(entry.SettingsJson))
        {
            logger.LogWarning(
                "connectors.json entry '{ConnectorId}' declares a Modbus RTU transport. This host cannot build an " +
                "RTU bus yet: the multidrop fan-out and its ghost sweep still live in St4i.EngineApi and are not " +
                "reachable from this process (see EdgeConnectors' own remarks and blueprint §11). Skipped — " +
                "refusing is deliberate, because a second fan-out written here would be a second answer to " +
                "'which registration owns this device'.",
                entry.Id);
            return null;
        }

        if (entry.Kind == DriverKinds.Modbus)
        {
            return new ModbusConnectorFactory(
                modbusOptions,
                logWarning: msg => logger.LogWarning("{ConnectorsConfigModbusMsg}", msg),
                logError: (ex, msg) => logger.LogError(ex, "{ConnectorsConfigModbusMsg}", msg));
        }

        if (entry.Kind == DriverKinds.OpcUa)
        {
            logger.LogWarning(
                "connectors.json entry '{ConnectorId}' declares OPC-UA. This host does not dispatch it: an " +
                "OpcUaDriver writes its app-instance certificate into the machine-wide " +
                "%ProgramData%\\ST4I\\sim\\opcua-pki root, which has no per-process key, and Task E-3 is not " +
                "allowed to add a new writer to a machine-wide store. Skipped.",
                entry.Id);
            return null;
        }

        logger.LogWarning(
            "connectors.json entry '{ConnectorId}': no in-process factory constructor is available for kind " +
            "'{ConnectorKind}' — skipped.",
            entry.Id, entry.Kind);
        return null;
    }
}
