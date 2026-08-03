using Microsoft.Extensions.Logging;
using St4i.Connector.Abstractions;
using St4i.Connector.Abstractions.Models;
using St4i.EdgeCore.Drivers.Modbus;
using St4i.EngineApi.Fleet;

namespace St4i.EngineApi.Config;

/// <summary>
/// 🔴 Task D-4 (.superpowers/sdd/2026-08-02-dotD-modbus-rtu-blueprint/task-4-brief.md) — <b>the registration
/// path that fans one multidrop map out into N connector instances, each serving exactly one machine.</b>
///
/// <para>This is the half of blueprint §7.1 that decides whether multidrop is safe. The file format alone does
/// not: the SAME document can be registered two ways, and only one of them preserves D-1's routing invariant.
/// This method builds the safe one — <c>N</c> calls to <see cref="ConnectorRegistry.Register"/>, each with its
/// own instance id, its own machine-code claim, and its own <b>single-device</b> configuration string. The
/// unsafe one — a single registration whose config is the whole bus, handed to a factory that emits N machine
/// codes — is not merely avoided here, it is unreachable from this method's output, because
/// <see cref="ModbusMultidropMap.FanOut"/> hands back one standalone single-device document per device and
/// nothing in it can declare a second machine.</para>
///
/// <para><b>Why the factory is a parameter and not constructed here.</b> An RTU connector factory has to
/// decide the transport (a serial line, or a gateway host/port) and hold the <c>ModbusBusRegistry</c> that
/// makes N drivers share one open — and that is configuration surface D-7 owns; D-2 and D-3 both shipped
/// without it deliberately. Taking the factory as an argument is what keeps D-4 out of that decision entirely
/// while still building, and testing, the fan-out itself.</para>
///
/// <para><b>One factory instance serves the whole bus, and that is the point.</b> Every device on one bus
/// registers against the SAME <see cref="IConnectorFactory"/>; what differs per instance is the configuration
/// string the registry hands back to it. That is exactly what lets the factory hold one bus registry and give
/// out N leases on one physical link — the "one open for N leases" property — without any of the N drivers
/// knowing about each other.</para>
///
/// <para><b>Shape borrowed deliberately from <see cref="ConnectorsJsonRegistration"/>:</b> an ordinary static
/// method taking already-in-hand arguments, so a test drives it with no env var, no file and no race. That
/// extraction exists because a mutation making every <c>connectors.json</c> connector register UNBOUND left the
/// whole suite green; a fan-out that registered N instances unbound, or registered one instance for N machines,
/// would be the same defect with a bigger blast radius.</para>
///
/// <para><b>🔴 Review m6 — CLOSED by Task D-7a.</b> D-4 recorded that this method was "safe to re-run only for
/// a map that GAINED or CHANGED devices, never for one that LOST one": <see cref="ConnectorRegistry"/> had no
/// removal path, so re-running it after an operator deleted a device from a bus map left a GHOST instance still
/// holding that machine's claim until the process restarted — the machine could then be served by nothing, and
/// this method's own refusal message named an instance the operator had already deleted from their file.
/// <see cref="ConnectorRegistry.Unregister"/> now exists and this method SWEEPS: every entry in this bus's own
/// derived namespace that the current map no longer declares is unregistered before the new set is registered.
/// See <see cref="RegisterAll(string,string,Func{long,IConnectorFactory},ConnectorRegistry,ILogger})"/>'s own
/// remarks for what the sweep can and cannot touch, and for why the two halves are ordered removal-first.</para>
///
/// <para><b>🔴 Review m5 — CLOSED, and not where D-4 expected.</b> The derived id <c>{bus}:unit{n}</c> was not
/// collision-free across buses (a bus named <c>X</c> and a bus named <c>X:unit1</c> derived the same id, and
/// <c>Register</c> is last-write-wins, so the second silently dropped the first device's machine claim while
/// this method still counted it registered). D-4 proposed either rejecting a bus id containing <c>":unit"</c>
/// or checking derived ids against the registry. <b>Both</b> ship, and they are not redundant:
/// <see cref="ModbusMultidropMap.ValidateBusInstanceId"/> makes the two namespaces disjoint by construction —
/// which is also what makes the ghost sweep above safe, because it is the only thing that guarantees
/// <c>X:unit1</c> can only ever have been derived by bus <c>X</c> — while the registry check below catches an
/// id that arrived from a DIFFERENT registration path (an operator naming a connector <c>X:unit1</c> through
/// <c>POST /v1/connectors</c>) and refuses to overwrite it rather than silently winning.</para>
/// </summary>
public static class ModbusMultidropRegistration
{
    /// <summary>
    /// Fans <paramref name="multidropMapJson"/> out and registers one connector instance per device.
    /// </summary>
    /// <param name="multidropMapJson">The bus's register-map document — either shape
    /// <see cref="ModbusMultidropMap"/> accepts.</param>
    /// <param name="busInstanceId">The instance id the operator named this BUS under. Each device's own id is
    /// derived from it by <see cref="ModbusMultidropMap.DeviceInstanceId"/>.</param>
    /// <param name="factory">The connector factory every device on this bus registers against — see the class
    /// doc comment.</param>
    /// <param name="registry">The registry to populate.</param>
    /// <param name="logger">Every refusal is reported here, naming the incumbent where there is one. "Visible,
    /// never silent" — the same posture as every other startup registration path.</param>
    /// <returns>How many devices were actually registered. Returned rather than inferred from the registry's
    /// contents so a caller — and a test — can tell "registered" from "silently skipped" without
    /// reconstructing it; <b>0 for a document that would not parse at all</b>, which is logged as an error and
    /// disables this connector for the run, exactly the pre-existing "a malformed map file disables that driver
    /// without crashing the host" behaviour.</returns>
    public static int RegisterAll(
        string multidropMapJson,
        string busInstanceId,
        IConnectorFactory factory,
        ConnectorRegistry registry,
        ILogger logger)
    {
        ArgumentNullException.ThrowIfNull(factory);
        return RegisterAll(multidropMapJson, busInstanceId, _ => factory, registry, logger);
    }

    /// <summary>
    /// 🔴 Task D-7a — the same fan-out, but the factory is built <b>from</b> a bus-wide fact the caller cannot
    /// know until the document has been parsed.
    /// </summary>
    /// <param name="factoryForBus">Invoked exactly once, after a successful fan-out, with the LARGEST
    /// <see cref="ModbusRegisterMap.WorstCaseBusHoldMs"/> among the devices on this bus
    /// (<see cref="ModbusMultidropMap.MaxWorstCaseBusHoldMs"/>). That number is blueprint §10 item 2's
    /// write-queue bound, and it is a property of the BUS — a write queues behind whichever sibling holds the
    /// line, so no single device's document contains it. Threading it through here rather than making the
    /// caller fan out a second time to compute it is what keeps the number a write is bounded by and the number
    /// <see cref="ModbusMultidropMap.FanOut"/> already warns with the same arithmetic on the same parse, rather
    /// than two derivations that can disagree.</param>
    /// <inheritdoc cref="RegisterAll(string,string,IConnectorFactory,ConnectorRegistry,ILogger)"/>
    public static int RegisterAll(
        string multidropMapJson,
        string busInstanceId,
        Func<long, IConnectorFactory> factoryForBus,
        ConnectorRegistry registry,
        ILogger logger)
    {
        ArgumentNullException.ThrowIfNull(factoryForBus);
        ArgumentNullException.ThrowIfNull(registry);
        ArgumentNullException.ThrowIfNull(logger);

        IReadOnlyList<ModbusBusDevice> devices;
        try
        {
            devices = ModbusMultidropMap.FanOut(
                multidropMapJson, busInstanceId,
                logWarning: msg => logger.LogWarning("{MultidropMapMsg}", msg));
        }
        catch (Exception ex)
        {
            logger.LogError(ex,
                "Modbus multidrop map for connector '{BusInstanceId}' failed to load — no device on that bus is " +
                "registered for this run.", busInstanceId);
            return 0;
        }

        var factory = factoryForBus(ModbusMultidropMap.MaxWorstCaseBusHoldMs(devices));
        if (factory is null)
        {
            logger.LogError(
                "Modbus multidrop bus '{BusInstanceId}': no connector factory could be built for it — no device " +
                "on that bus is registered for this run.", busInstanceId);
            return 0;
        }

        // 🔴 ONE snapshot for the whole pass, taken BEFORE anything mutates — D-1 review m3's rule, applied for
        // the same reason FleetHost.ResolveWritableDriver takes one: the sweep and the collision check are two
        // questions about the same moment, and asking them separately would let a registration land between
        // them. Stale is fine and is the point; internally inconsistent is not.
        var before = registry.SnapshotBindings();

        // Removal FIRST, and the order is load-bearing. A device that MOVED from unit 3 to unit 4 (a
        // re-addressing — the ordinary reason a bus map changes) is a new instance id claiming a machine code
        // the OLD instance id still holds. Registering before sweeping would refuse it against a ghost this
        // same call is about to delete, and the operator would see one device missing with a message naming an
        // instance that no longer exists in their file.
        SweepGhosts(devices, busInstanceId, registry, before, logger);

        var registered = 0;

        foreach (var device in devices)
        {
            // 🔴 Review m5's second half — refuse to overwrite an entry that is NOT this bus's to overwrite.
            // ModbusMultidropMap.ValidateBusInstanceId already makes it impossible for another BUS to own this
            // derived id, but a connector registered from another path entirely (POST /v1/connectors naming an
            // instance "line1:unit3") can. Register is last-write-wins on the id, so without this the fan-out
            // would silently drop that connector's machine claim while still counting this device registered —
            // which is exactly the shape D-4's review named.
            if (OwnedBySomethingElse(before, device, out var incumbentMachine))
            {
                logger.LogWarning(
                    "Modbus multidrop bus '{BusInstanceId}': device at unit {UnitId} (machine '{MachineCode}') " +
                    "was NOT registered — connector instance '{InstanceId}' already exists and serves a DIFFERENT " +
                    "machine ('{IncumbentMachine}'). Registering would have silently replaced it and dropped that " +
                    "machine's claim. Rename that connector or re-address this device; every other device on this " +
                    "bus is unaffected.",
                    busInstanceId, device.UnitId, device.MachineCode, device.InstanceId, incumbentMachine);
                continue;
            }

            // 🔴 The whole invariant, in one call. instanceId is per DEVICE, so N devices are N registry
            // entries and N pipeline slots; machineCode is the single machine THIS device serves, so
            // ConnectorRegistry's claim gate makes it impossible for a second instance to claim it; and the
            // config is this device's own standalone single-device document, so the driver the factory later
            // builds from it emits exactly one machine code.
            if (registry.Register(
                    factory, device.MapJson, instanceId: device.InstanceId, machineCode: device.MachineCode))
            {
                registered++;
                continue;
            }

            // The refusal that actually happens in the field: another connector instance — on this bus or a
            // different one — already claims this machine. Naming the incumbent is what makes it actionable;
            // without it an operator sees one device on a bus of eight quietly missing, with no way to tell
            // which configuration is fighting which. (Register also returns false for a factory whose Kind
            // getter throws or is blank, which is why the message does not assert the claim is the cause.)
            registry.TryGetInstanceIdForMachine(device.MachineCode, out var incumbent);
            logger.LogWarning(
                "Modbus multidrop bus '{BusInstanceId}': device at unit {UnitId} (machine '{MachineCode}', " +
                "instance '{InstanceId}') was NOT registered — machine '{MachineCode}' is already served by " +
                "connector instance '{Incumbent}', or the factory's Kind is unusable. That device will not be " +
                "polled; every other device on this bus is unaffected.",
                busInstanceId, device.UnitId, device.MachineCode, device.InstanceId, device.MachineCode,
                incumbent ?? "(none)");
        }

        return registered;
    }

    /// <summary>
    /// 🔴 Task D-7a (D-4 review m6) — <b>unregisters the entries this bus left behind.</b>
    ///
    /// <para><b>What it touches, and why that set is exactly right.</b> Only ids in THIS bus's own namespace:
    /// the bus id itself (the degenerate single-device form) and <c>{bus}:unit{n}</c>. Nothing else can be in
    /// that namespace, and that is a guarantee rather than a hope —
    /// <see cref="ModbusMultidropMap.ValidateBusInstanceId"/> refuses to let any bus be NAMED like a device
    /// position, so <c>line1:unit3</c> can only ever have been derived by <c>line1</c>. Without that rule this
    /// sweep would be the most dangerous method in the file: a bus legitimately named <c>line1:unit3</c> would
    /// see its own registration deleted by bus <c>line1</c>'s sweep.</para>
    ///
    /// <para><b>The one id in the namespace it will NOT remove</b> is one whose machine code the CURRENT map
    /// still declares under a different unit — i.e. a device that was re-addressed. It is unregistered (the old
    /// position is genuinely gone) and its machine claim is what the new position needs, which is why removal
    /// runs before registration. Stated because the alternative reading — "leave anything whose machine still
    /// exists" — is the one that reproduces the ghost.</para>
    ///
    /// <para><b>What it deliberately does NOT do: stop anything.</b> Removal is a registry mutation and nothing
    /// more. A driver already running under a removed id keeps its lease on the shared RTU bus and finishes its
    /// in-flight read normally; <c>FleetHost</c> reclaims it on the next pipeline restart, disposing it OUTSIDE
    /// its own <c>_gate</c> under a bounded budget, which is the constraint that predates this batch and is
    /// absolute. See <see cref="ConnectorRegistry.Unregister"/> for the full statement of what an operator sees
    /// in that window.</para>
    ///
    /// <para>🔴 <b>Review M-4 — the ONE re-run shape this does NOT handle, named rather than left to be
    /// found: a machine REASSIGNED at the same bus position.</b> This method skips any id the new map still
    /// declares, so renaming unit 3 from <c>M3</c> to <c>M9</c> (or swapping two devices' positions) leaves the
    /// old registration in place — and <see cref="OwnedBySomethingElse"/> then refuses the new one, because the
    /// incumbent under that id serves a different machine. The refusal is safe (nothing is silently
    /// overwritten) but its MESSAGE is wrong for this case: it says the id "already exists and serves a
    /// DIFFERENT machine … Rename that connector or re-address this device", and the incumbent is <b>this
    /// bus's own previous registration</b>, so neither remedy applies.</para>
    ///
    /// <para><b>Why it is not fixed here.</b> It is unreachable in production:
    /// <c>ConnectorsJsonRegistration.RegisterAll</c> is called exactly once per process, from the
    /// <c>ConnectorRegistry</c> DI singleton lambda, so a "second run" only exists in a test or in whatever
    /// future feature re-reads configuration at run time. Closing it properly means this method distinguishing
    /// "an id in MY namespace whose machine changed" from "an id someone else owns" — which is a two-pass
    /// sweep (unregister every id in the namespace whose binding does not match the new map, then register),
    /// and a wider change than a fix round should make to the one method that can delete another connector's
    /// registration. <b>Whoever builds run-time reconfiguration owns it, and the two-pass shape above is the
    /// answer.</b> Recorded here because m6's closure is stated as re-run safety, and this is the corner of
    /// re-run safety it does not reach.</para>
    /// </summary>
    private static void SweepGhosts(
        IReadOnlyList<ModbusBusDevice> devices,
        string busInstanceId,
        ConnectorRegistry registry,
        IReadOnlyList<ConnectorRegistry.ConnectorBinding> before,
        ILogger logger)
    {
        // 🔴 NORMALIZED on both sides. ConnectorRegistry keys on DriverKinds.Normalize(id) and
        // SnapshotBindings hands back those normalized keys, while ModbusMultidropMap.DeviceInstanceId mints
        // the RAW derived string — so comparing the two directly would, for any bus whose name normalizes to
        // something else, fail to recognise this bus's own devices and sweep every one of them on every
        // re-registration. Folding both through the SAME method the registry uses is the only comparison that
        // can be right, and it is the same rule ConnectorRegistry's own doc comment states: casing tolerance is
        // DriverKinds.Normalize's job alone, applied once on the way in and once on the way out.
        var stillDeclared = new HashSet<string>(devices.Count, StringComparer.Ordinal);
        foreach (var device in devices)
        {
            stillDeclared.Add(DriverKinds.Normalize(device.InstanceId));
        }

        var busNamespacePrefix = DriverKinds.Normalize(busInstanceId) + ModbusMultidropMap.DeviceIdSuffixPrefix;
        var normalizedBusId = DriverKinds.Normalize(busInstanceId);

        foreach (var binding in before)
        {
            if (stillDeclared.Contains(binding.InstanceId)) continue;

            var isThisBus =
                string.Equals(binding.InstanceId, normalizedBusId, StringComparison.Ordinal)
                || (binding.InstanceId.StartsWith(busNamespacePrefix, StringComparison.Ordinal)
                    && ModbusMultidropMap.LooksLikeADeviceInstanceId(binding.InstanceId));

            if (!isThisBus) continue;

            if (!registry.Unregister(binding.InstanceId)) continue;

            logger.LogWarning(
                "Modbus multidrop bus '{BusInstanceId}': connector instance '{InstanceId}' (machine " +
                "'{MachineCode}') is no longer declared by this bus's map and has been unregistered — machine " +
                "'{MachineCode}' is free for another connector to serve. Any driver still running under that id " +
                "keeps polling until the fleet is next started; it is not stopped by this.",
                busInstanceId, binding.InstanceId, binding.MachineCode ?? "(unbound)", binding.MachineCode ?? "(unbound)");
        }
    }

    /// <summary>Whether <paramref name="device"/>'s derived instance id is already held by a registration that
    /// serves a DIFFERENT machine — the m5 collision, asked against the one pre-pass snapshot so it cannot see
    /// a half-mutated registry. A same-machine incumbent is an ORDINARY UPDATE of this device's own
    /// registration (the map's registers changed, say) and must be allowed through; an unbound incumbent
    /// (<c>MachineCode is null</c>) is one nothing can route a write to, so replacing it strands nothing.</summary>
    private static bool OwnedBySomethingElse(
        IReadOnlyList<ConnectorRegistry.ConnectorBinding> before, ModbusBusDevice device, out string incumbentMachine)
    {
        incumbentMachine = string.Empty;

        // Normalized for the same reason SweepGhosts normalizes — see its own remarks.
        var wanted = DriverKinds.Normalize(device.InstanceId);

        foreach (var binding in before)
        {
            if (!string.Equals(binding.InstanceId, wanted, StringComparison.Ordinal)) continue;
            if (binding.MachineCode is null) return false;
            if (string.Equals(binding.MachineCode, device.MachineCode, StringComparison.OrdinalIgnoreCase)) return false;

            incumbentMachine = binding.MachineCode;
            return true;
        }

        return false;
    }
}
