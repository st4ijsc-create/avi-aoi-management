using Microsoft.Extensions.Logging;
using St4i.Connector.Abstractions;
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
/// <para><b>🔴 Review m6 — this method is SAFE TO RE-RUN ONLY FOR A MAP THAT GAINED OR CHANGED DEVICES, NEVER
/// FOR ONE THAT LOST ONE, and D-7 owns closing that.</b> <see cref="ConnectorRegistry"/> has no removal path at
/// all — <c>Register</c> replaces an entry under the same id and nothing ever deletes one. So calling this again
/// after an operator removes a device from a bus map leaves a GHOST instance registered under that device's id,
/// still holding that machine's claim, until the process restarts. The consequences are both silent: the
/// machine cannot be re-served by any other connector (the claim gate refuses every later registration for it,
/// which this method reports as "already served by connector instance …" naming an instance the operator has
/// already deleted from their file), and <c>FleetHost.StartLocked</c> keeps building a pipeline slot for it on
/// every restart, so an alarm <c>TargetId</c> outlives the device it named.</para>
///
/// <para>This is a pre-existing property of D-1's identity model rather than something D-4 introduced — the
/// same is true of every registration path — but multidrop makes it REACHABLE in a way one-connector-per-kind
/// did not: editing a bus map is exactly the operation that removes a device, and a bus of eight is exactly the
/// configuration an operator edits. Closing it means an unregister on the registry (and a decision about what
/// happens to the slot and its alarms), which is a change to D-1's spine and belongs with whatever D-7 builds to
/// reconfigure a connector at run time — not smuggled into a task about map shape.</para>
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

        var registered = 0;

        foreach (var device in devices)
        {
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
}
