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
/// <c>ConnectorConfigValidation</c> (the machine-code binding a TCP entry gets there and does not get here)
/// and <c>OpcUaOptions</c>. What it no longer needs that it used to is the whole reason this paragraph was
/// once a refusal — see below.</para>
///
/// <para>🔴 <b>TASK E-5 — RS-485 RUNS HERE NOW, AND THAT IS THE REASON ĐỢT E EXISTED.</b> E-3 refused an RTU
/// entry BY NAME and recorded why: <c>ModbusMultidropRegistration</c> reached
/// <c>RtuBusConfiguration.IsInBusNamespace</c>, a rule whose own doc comment says it must be stated exactly
/// once for three callers, and <c>RtuBusConfiguration</c> is <c>St4i.EngineApi</c>'s — an assembly this host
/// cannot reference (<c>NU1605</c> + the ASP.NET publish surface). That single reference is the whole of what
/// blueprint §9.6(a) calls "the leaf that is not a leaf", and it is what kept the RS-485 port unusable on the
/// machine the port is plugged into.
/// <list type="bullet">
/// <item><c>ModbusMultidropMap.IsInBusNamespace</c> — the rule, <b>moved, not copied</b>, onto the type that
/// declares the <c>{bus}:unit{n}</c> FORMAT it decodes (<c>DeviceIdSuffixPrefix</c>,
/// <c>LooksLikeADeviceInstanceId</c>). Its third dependency, <c>DriverKinds.Normalize</c>, is
/// <c>St4i.Connector.Abstractions</c>' — see that method's own remarks, where an earlier "every fact it
/// reasons about is declared in this type" was corrected. Still exactly one statement; all three callers
/// reach it.</item>
/// <item><c>St4i.EdgeCore.Config.ModbusMultidropRegistration</c> — the fan-out and its ghost sweep, on
/// EdgeCore's callback logging convention.</item>
/// <item><c>ModbusRtuBusPlan</c> (now <c>St4i.EdgeCore.Serial</c>) — the transport switch, the one place in
/// the product that knows both a COM line and a gateway socket exist.</item>
/// </list>
/// So there is still exactly ONE fan-out and ONE answer to "which registration owns this device"; both hosts
/// call it. What E-3 refused to do — write a second, simpler fan-out here — is still refused.</para>
///
/// <para>🔴 <b>WHAT THIS HOST WILL AND WILL NOT DISPATCH, each with the reason stated where an operator
/// meets it (a skipped entry is always logged by id and kind — visible, never silent):</b>
/// <list type="bullet">
/// <item><b>Modbus TCP — YES.</b> <see cref="ModbusConnectorFactory"/> already lives in
/// <c>St4i.EdgeCore</c>; a <c>ModbusTcpDriver</c> owns a socket and no machine-wide file.</item>
/// <item><b>Modbus RTU (an entry declaring a <c>transport</c>) — YES, as of E-5.</b> One entry is a BUS and
/// becomes N connector instances, one per device, each claiming exactly one machine code; the same
/// <c>ModbusMultidropRegistration.RegisterAll</c> EngineApi calls. Both transports are dispatched — a COM
/// line and an RTU-over-TCP gateway — because <c>ModbusRtuBusPlan</c> owns that switch and this host now
/// asks it. <b>Neither one writes to any machine-wide store:</b> the serial arm opens a COM port and the
/// gateway arm opens a socket, and the shared-open bookkeeping (<see cref="ModbusBusRegistry"/>) is an
/// in-process dictionary the host owns.</item>
/// <item>🔴 <b>OPC-UA — NO, and the reason is the brief's own ruling, not a missing type.</b>
/// <see cref="St4i.EdgeCore.Drivers.OpcUa.OpcUaConnectorFactory"/> is right here in EdgeCore and would
/// compile. But an <c>OpcUaDriver</c> writes its app-instance certificate into
/// <c>OpcUaPkiPaths.ResolveRoot</c> — <c>%ProgramData%\ST4I\sim\opcua-pki</c>, <b>machine-wide, with no
/// per-process key</b>. Dispatching it here would make <c>St4i.EdgeService</c> a NEW WRITER to a
/// machine-wide store, which E-3's brief forbids outright and hands to the owner as the per-host data-root
/// decision.
/// <b>🔴 F-1: THAT DECISION IS NOW MADE, AND THIS ENTRY IS STILL REFUSED — deliberately.</b> Per-host data
/// roots are a supported deployment shape (README §15.9), and the PKI root was already parameterised
/// (<c>OpcUaConnectorFactory</c> takes <c>pkiDir</c>; <c>OpcUaPkiPaths.ResolveRoot</c> honours
/// <c>ST4I_OPCUA_PKI_DIR</c>), so the BLOCKING CONDITION is gone. What remains is work F-1 was told not to
/// do: this host has no <c>OpcUaOptions</c> of its own to resolve an endpoint, a node map and a PKI root
/// from, no <c>switch</c> arm here, and no test that two hosts pointed at two roots keep two certificate
/// stores. Until those exist the refusal stands, and it stands whether or not
/// <c>ST4I_OPCUA_PKI_DIR</c> happens to be set — the message says so, so that setting the variable and
/// seeing nothing change is not read as a bug.</item>
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
///
/// <para>🔴 <b>E-5 was told these two rules "converge for free" once the fan-out landed here. THEY DO NOT,
/// and the enumeration is short enough to settle it.</b> The two rules already AGREE on an RTU bus — both
/// hosts key it on the operator's id, and after E-5 both DISPATCHES ask the same predicate
/// (<see cref="ConnectorsConfig.IsRtuBus"/>) to decide that it is one, so that half is now shared code rather
/// than two agreeing copies. (This host's <see cref="RegistrationKeyOf"/> does not ask it and does not need
/// to — see its own remarks; the E-5 review corrected a count of four call sites to three.) They differ on
/// exactly one input class: a <b>TCP or OPC-UA</b> entry, which
/// EngineApi keys on kind and this host keys on id. Moving the fan-out changes nothing about that input
/// class. And neither direction of convergence is available:
/// <list type="bullet">
/// <item>EngineApi adopting id-keying is the slot-label/<c>TargetId</c> migration it has twice refused, with
/// a test pinning the refusal.</item>
/// <item>This host adopting kind-keying would COLLAPSE N Modbus TCP entries — N sockets, N machines — into
/// one, which is a capability E-3 shipped and which the RTU bus does not replace: an RTU bus expresses N
/// devices on ONE wire, not N independent sockets.</item>
/// </list>
/// So it stays the "acceptable divergence" the E-3 review ruled it — different for a stated, checkable
/// reason, each side pinned by its own test — and the record that predicted otherwise is corrected in
/// blueprint §14 rather than left to be re-derived.</para>
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

    /// <summary>The key an entry will actually be registered under here — see the class remarks.
    ///
    /// <para>🔴 <b>It does NOT ask <see cref="ConnectorsConfig.IsRtuBus"/>, and that absence is stronger than
    /// asking would be (E-5 review, I1).</b> EngineApi's counterpart must branch — kind for TCP/OPC-UA, id for
    /// a bus — so its dispatch and its key function have to agree about what an entry IS, and both ask the one
    /// shared predicate. Here there is no branch: every entry keys on its own id, so there is nothing that
    /// could disagree with the dispatch. Adding the branch "for symmetry" would create the hazard the shared
    /// predicate exists to close.</para>
    ///
    /// <para>A blank id cannot happen (<see cref="ConnectorsConfig.Load"/> defaults it to the kind), but
    /// normalising through
    /// <see cref="DriverKinds.Normalize"/> is what makes this comparable to
    /// <see cref="ConnectorRegistry"/>'s own keys, which are normalised on the way in.</para></summary>
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
    /// <param name="path">The <c>connectors.json</c> to read.</param>
    /// <param name="logger">Every skip and every refusal is reported here, by id.</param>
    /// <param name="modbusBusRegistry">🔴 Task E-5 — the reference-counted bus registry every RTU device's
    /// driver shares, so N devices on one line hold N leases on ONE open port. <b>Owned by the HOST and never
    /// constructed here</b>, exactly as <c>ConnectorsJsonRegistration</c> states the rule for EngineApi: its
    /// lifetime is the process's, this method is called once per process, and the physical line must outlive
    /// this call. <see langword="null"/> means this run offers no RTU transport at all — an entry declaring
    /// one is then skipped with a named warning rather than dispatched into a path that cannot work.</param>
    internal static ConnectorRegistry? Build(
        string path, ILogger logger, ModbusBusRegistry? modbusBusRegistry = null)
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
            // 🔴 Task E-5 — the RTU arm, taken BEFORE the per-entry factory dispatch below for the same
            // reason EngineApi takes it first: an RTU entry is not one connector, it is a BUS, and it fans
            // out into N registrations of its own. Everything below it is byte-for-byte what E-3 shipped.
            if (ConnectorsConfig.IsRtuBus(entry))
            {
                registered += RegisterRtuBus(entry, registry, logger, modbusBusRegistry);
                continue;
            }

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

    /// <summary>
    /// 🔴 <b>Task E-5 — one <c>connectors.json</c> entry that is an RS-485 BUS, fanned out into N connector
    /// instances on this host.</b> The same three shared pieces EngineApi uses, in the same order, for the
    /// reason blueprint §11.5 gave for refusing to write a second one: a second fan-out is a second answer to
    /// "which registration owns this device".
    ///
    /// <para><b>What is deliberately NOT here, and it is the whole difference from EngineApi's arm:</b> no
    /// <c>ConnectorConfigValidation</c> call. That call exists there to learn the machine code a TCP entry's
    /// opaque settings blob declares; a bus does not need it, because
    /// <see cref="ModbusMultidropMap.FanOut"/> has already parsed each device and hands its machine code out
    /// directly. So the 254-line validator blueprint §11.6 listed as E-5 work is not moved and is not needed —
    /// the enumeration, not the estimate.</para>
    ///
    /// <para><b>The DE limit is logged HERE and that is not a copy for tidiness.</b> Blueprint §9's
    /// automatic-direction-control limit is invisible when violated — an adapter that needs its transmit
    /// enable toggled by software does not throw, it simply never transmits — and <b>this</b> host is the one
    /// running on the machine the adapter is plugged into. Same rule as EngineApi's: after the fan-out, only
    /// if something registered, once per bus rather than once per device.</para>
    /// </summary>
    /// <returns>How many DEVICES were registered — not how many entries. 0 for a bus that could not be built
    /// at all.</returns>
    private static int RegisterRtuBus(
        ConnectorConfigEntry entry, ConnectorRegistry registry, ILogger logger, ModbusBusRegistry? modbusBusRegistry)
    {
        if (modbusBusRegistry is null)
        {
            logger.LogWarning(
                "connectors.json entry '{ConnectorId}' declares a Modbus RTU transport, but this run was " +
                "composed without a Modbus bus registry — no RTU connector can be built. Skipped.",
                entry.Id);
            return 0;
        }

        ModbusRtuBusPlan plan;
        try
        {
            plan = ModbusRtuBusPlan.Resolve(entry.SettingsJson);
        }
        catch (Exception ex)
        {
            logger.LogError(ex,
                "connectors.json entry '{ConnectorId}': its Modbus RTU bus settings could not be read — no device " +
                "on that bus is registered for this run. Every other connector is unaffected.", entry.Id);
            return 0;
        }

        // The bus id is the operator's own, untouched — the same string EngineApi passes, so the derived
        // `{bus}:unit{n}` device ids are identical in both hosts for an identical file.
        var registered = ModbusMultidropRegistration.RegisterAll(
            entry.SettingsJson,
            entry.Id.Trim(),
            busWideWorstCaseHoldMs => new ModbusRtuConnectorFactory(
                busKey: plan.BusKey,
                openLink: plan.OpenLink,
                busRegistry: modbusBusRegistry,
                writeQueueBudgetMs: busWideWorstCaseHoldMs,
                logWarning: msg => logger.LogWarning("{ModbusRtuMsg}", msg),
                logError: (ex, msg) => logger.LogError(ex, "{ModbusRtuMsg}", msg)),
            registry,
            logWarning: msg => logger.LogWarning("{ModbusMultidropMsg}", msg),
            logError: (ex, msg) => logger.LogError(ex, "{ModbusMultidropMsg}", msg));

        if (plan.LimitNotice is not null && registered > 0)
        {
            logger.LogWarning("connectors.json entry '{ConnectorId}': {ModbusRtuSerialLimit}",
                entry.Id, plan.LimitNotice);
        }

        // 🔴 Task F-1 — the one-host-per-segment constraint, and it is emitted HERE for a sharper reason than
        // symmetry with EngineApi. This host is the one an operator adds SECOND: EngineApi has driven
        // connectors since long before Đợt E, and a gateway accepts this host's connection whether or not the
        // other one is already on the segment. Not logging it here would leave the constraint stated only to
        // the host that was already there.
        if (plan.SegmentOwnershipNotice is not null && registered > 0)
        {
            logger.LogWarning("connectors.json entry '{ConnectorId}': {ModbusRtuSegmentOwnership}",
                entry.Id, plan.SegmentOwnershipNotice);
        }

        return registered;
    }

    /// <summary>The dispatch itself. Every refusal names the entry and the reason — see the class remarks for
    /// why each arm is the arm it is. The RTU arm is not here: a bus is N registrations, not one factory, so
    /// it is taken in <see cref="Build"/> before this method is reached.</summary>
    private static IConnectorFactory? TryBuildFactory(ConnectorConfigEntry entry, ModbusOptions modbusOptions, ILogger logger)
    {
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
                "%ProgramData%\\ST4I\\sim\\opcua-pki root, which has no per-process key, so dispatching it " +
                "here would make this host a NEW WRITER to a machine-wide store — and, on a deployment where " +
                "St4i.EngineApi also runs an OPC-UA connector, a second writer to the certificate store that " +
                "host already writes. Skipped. 🔴 The decision that used to block this is CLOSED — per-host data roots are " +
                "a supported deployment (README §15.9), and ST4I_OPCUA_PKI_DIR gives this host a PKI root of " +
                "its own. What is still missing is the work, not the ruling: this host must be given its own " +
                "OpcUaOptions (endpoint/map/PKI root), the switch arm here, and a test that the two hosts' " +
                "certificate stores stay separate. Setting ST4I_OPCUA_PKI_DIR alone does NOT enable this " +
                "entry — it is refused by name either way.",
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
