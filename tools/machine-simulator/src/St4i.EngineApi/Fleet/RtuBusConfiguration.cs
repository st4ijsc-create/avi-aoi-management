using System.Diagnostics.CodeAnalysis;
using Microsoft.Extensions.Logging;
using St4i.Connector.Abstractions.Models;
using St4i.EdgeCore.Drivers.Modbus;
using St4i.EdgeCore.Models;
using St4i.EngineApi.Config;

namespace St4i.EngineApi.Fleet;

/// <summary>
/// 🔴 Task D-7b (.superpowers/sdd/2026-08-02-dotD-modbus-rtu-blueprint/task-7b-brief.md) — <b>everything an
/// RS-485 bus needs that is NOT <c>connectors.json</c>: the persisted shape, the live registration, and the
/// roster descriptors.</b>
///
/// <para>D-7a shipped the <c>connectors.json</c> half (<see cref="ConnectorsJsonRegistration"/>) and deferred
/// the two endpoint halves with an argument: <c>POST /v1/connectors</c>'s contract is <i>1 request → 1 machine
/// → 1 audit row → 1 compensating rollback</i>, and a bus is N of each. This class is that argument's answer.
/// It is deliberately the ONLY place that knows how a bus becomes rows, so the endpoint, the visibility seeder
/// and the startup re-registration cannot describe the same bus three different ways.</para>
///
/// <para><b>🔴 The persisted shape, and the alternative that was rejected.</b> A bus becomes <b>N device
/// rows</b>, one per device, keyed <c>{bus}:unit{n}</c> — never one "bus row" plus N children. A bus row would
/// need a <c>machine_code</c> and a bus serves N machines, so that column would hold a lie in the one table
/// whose entire subject is which connector serves which machine; and <c>DELETE /v1/connectors/{instanceId}</c>
/// would then have two meanings depending on which row kind it hit. With N device rows every row is
/// self-sufficient (it carries its own line, via <see cref="ConnectorConfigRecord.BusSettingsJson"/>), the
/// table keeps one row kind, and deleting one device is a one-row delete that leaves the other seven running.
/// The cost — the line's parameters denormalised onto each device on that line — is paid once per save and is
/// the same denormalisation <c>host</c> already is.</para>
///
/// <para><b>🔴 Partial failure: the whole bus, or none of it — and the ordering is what makes that true rather
/// than merely intended.</b> Three facts, in this order:</para>
/// <list type="number">
/// <item><description><b>An invalid device fails the whole document before anything is mutated.</b>
/// <see cref="ModbusMultidropMap.FanOut"/> THROWS on the first device it cannot parse (and on a duplicate unit
/// id, and on a duplicate machine code), naming which element. So "device 5 of 8 is invalid" never reaches a
/// store write at all: 7 devices do not register, and there is nothing to roll back, because the answer is
/// computed entirely from the request. That is not a rollback policy — it is the removal of the case a
/// rollback policy would have had to cover.</description></item>
/// <item><description><b>Every remaining refusal is checked BEFORE the first mutation.</b> Machine-code claims
/// (against one <see cref="ConnectorRegistry.SnapshotBindings"/>) and fleet-roster collisions are asked for all
/// N devices up front — see <see cref="TryFindBlockedDevice"/>. A bus whose device 5 names a machine another
/// connector already serves is refused with nothing written.</description></item>
/// <item><description><b>What remains is reversible, and the one irreversible step is LAST.</b> The store
/// write is ONE transaction (<see cref="ConnectorConfigStore.SaveBusAsync"/>) and its undo is one transaction
/// (<see cref="ConnectorConfigStore.RestoreBusAsync"/>), so neither can be half-done — which is the specific
/// thing that makes a rollback worth having, because a partial rollback tells the operator the operation
/// failed while some of it stands. Registry registration is undone by
/// <see cref="ConnectorRegistry.Unregister"/>, which performs no I/O and cannot fail.
/// <see cref="FleetHost.RegisterMachine"/> — which has NO un-register, the residual this whole batch carries —
/// runs only after every reversible step has already succeeded, so the operation never has to undo
/// it.</description></item>
/// </list>
///
/// <para><b>What can still go wrong, stated rather than claimed away.</b> Between the pre-checks and the
/// registrations, a concurrent <c>POST</c> can take one of these machine codes — the exact interleaving D-1's
/// review proved reachable for the single-connector case (the pre-check, the save and the register are not one
/// atomic unit). That is the ONE path that reaches the rollback, and it is why the rollback exists at all
/// rather than being replaced by the pre-checks.</para>
/// </summary>
public static class RtuBusConfiguration
{
    /// <summary>The <c>machineType</c> a multidrop device's roster descriptor carries. Distinct from
    /// <c>MODBUS_TCP</c> deliberately: the two are different physical situations (a device that owns its own
    /// socket versus one of N sharing a wire), and the roster is where an operator looks to tell them
    /// apart.</summary>
    public const string RtuMachineType = "MODBUS_RTU";

    /// <summary>One resolved bus: its transport/line (<see cref="Plan"/>) and its devices, already fanned out
    /// and parsed.</summary>
    public sealed record ResolvedBus(
        string BusInstanceId, string SettingsJson, ModbusRtuBusPlan Plan, IReadOnlyList<ModbusBusDevice> Devices);

    /// <summary>
    /// Turns one RTU bus document into a <see cref="ResolvedBus"/>, or into an operator-readable rejection.
    /// Never throws — every parse failure either side of the document (the bus-level transport half and the
    /// device half) is caught and reported through <paramref name="error"/>, the same non-throwing contract
    /// <see cref="ConnectorConfigValidation.TryValidate"/> is held to.
    /// </summary>
    /// <param name="busInstanceId">The id the operator named this BUS under. Validated against the derived
    /// <c>{bus}:unit{n}</c> namespace (<see cref="ModbusMultidropMap.ValidateBusInstanceId"/>) — a bus named
    /// like a device position would have its own registration swept by the bus it appears to belong
    /// to.</param>
    /// <param name="logWarning">The fan-out's own bus-monopoly warnings
    /// (<c>WarnAboutDevicesThatCanMonopoliseTheBus</c>) and any per-device map warnings. Optional.</param>
    public static bool TryResolve(
        string? busInstanceId,
        string? settingsJson,
        Action<string>? logWarning,
        [NotNullWhen(true)] out ResolvedBus? bus,
        [NotNullWhen(false)] out string? error)
    {
        bus = null;

        if (string.IsNullOrWhiteSpace(busInstanceId))
        {
            error = "instanceId is required for a Modbus RTU bus — a bus is N connectors sharing one line, so " +
                    "it cannot fall back to the protocol kind the way a single Modbus TCP connector does. Give " +
                    "the line a name an operator would recognise (e.g. 'line1-rs485').";
            return false;
        }

        if (string.IsNullOrWhiteSpace(settingsJson))
        {
            error = "mapJson is required — paste or upload the RS-485 bus document (its transport, its line " +
                    "parameters, and its 'devices' array).";
            return false;
        }

        var busId = busInstanceId.Trim();

        try
        {
            ModbusMultidropMap.ValidateBusInstanceId(busId);
        }
        catch (Exception ex)
        {
            error = ex.Message;
            return false;
        }

        ModbusRtuBusPlan plan;
        try
        {
            plan = ModbusRtuBusPlan.Resolve(settingsJson);
        }
        catch (Exception ex)
        {
            error = $"Invalid Modbus RTU bus settings: {ex.Message}";
            return false;
        }

        IReadOnlyList<ModbusBusDevice> devices;
        try
        {
            // 🔴 This call is the partial-failure policy. FanOut throws on the FIRST device it cannot parse,
            // naming which element of 'devices' it was — so an eight-device bus with a typo in device 5
            // registers ZERO devices, and does so before this method has written anything anywhere. The
            // alternative shape (register the 7 that parsed, report the 8th) was rejected: it leaves the
            // operator with a bus that is silently one device short of the file they are reading, and no way
            // to tell that state from a device that is merely unplugged.
            devices = ModbusMultidropMap.FanOut(settingsJson, busId, logWarning);
        }
        catch (Exception ex)
        {
            error = $"Invalid Modbus RTU bus: {ex.Message}";
            return false;
        }

        bus = new ResolvedBus(busId, settingsJson, plan, devices);
        error = null;
        return true;
    }

    /// <summary>🔴 Task D-7b — the persisted rows one bus becomes. <c>host</c>/<c>port</c> carry the LINE (see
    /// <see cref="ModbusRtuBusPlan"/>), <c>map_json</c> carries this device's own element verbatim (see
    /// <see cref="ModbusBusDevice.MapJson"/>) and <c>bus_settings_json</c> carries the document the line came
    /// from. Nothing is synthesised: every string here already existed in the operator's file.</summary>
    public static IReadOnlyList<ConnectorBusDeviceRow> BuildRows(ResolvedBus bus)
    {
        ArgumentNullException.ThrowIfNull(bus);

        var rows = new List<ConnectorBusDeviceRow>(bus.Devices.Count);
        foreach (var device in bus.Devices)
        {
            rows.Add(new ConnectorBusDeviceRow(
                InstanceId: device.InstanceId,
                Kind: DriverKinds.Modbus,
                MachineCode: device.MachineCode,
                Host: bus.Plan.Host,
                Port: bus.Plan.Port,
                MapJson: device.MapJson,
                BusSettingsJson: bus.SettingsJson,
                WriteCapability: ConnectorConfigValidation.CapabilityOf(device.Map)));
        }
        return rows;
    }

    /// <summary>🔴 Task D-7b — one device's roster descriptor. Built here rather than by
    /// <see cref="ConnectorConfigValidation"/> because that class's Modbus arm needs a host/port to validate at
    /// all, and an RTU device has neither: its address is a slave number on a line.</summary>
    public static MachineDescriptor DescriptorFor(ModbusBusDevice device)
    {
        ArgumentNullException.ThrowIfNull(device);

        var pollIntervalSeconds = Math.Max(0.1, device.Map.PollIntervalMs / 1000.0);
        return new MachineDescriptor(
            Code: device.MachineCode,
            SerialSeed: $"SN-{device.MachineCode}",
            DeviceClass: DeviceClass.Automation,
            MachineType: RtuMachineType,
            StepType: null,
            DriverKind: DriverKinds.Modbus,
            RecipeCode: null,
            MappingProfile: null,
            CycleSeconds: pollIntervalSeconds);
    }

    /// <summary>
    /// 🔴 Task D-7b — the pre-mutation refusal check, asked for EVERY device against ONE snapshot.
    ///
    /// <para>One snapshot, not N reads, for the same reason
    /// <see cref="ModbusMultidropRegistration"/> takes one: the answers are questions about a single moment,
    /// and asking them one at a time would let a registration land between two of them and produce a verdict
    /// no single instant of the system ever had. Stale is fine and is the point; internally inconsistent is
    /// not.</para>
    ///
    /// <para>The roster half is asked too, and it is the half a reader is most likely to think redundant:
    /// <see cref="FleetHost.RegisterMachine"/>'s duplicate-code guard is case-insensitive and KIND-AGNOSTIC and
    /// silently returns <see langword="false"/>, so without this check a bus could persist eight rows, register
    /// eight connectors, and have one of its machines permanently absent from the roster — the exact
    /// "persisted, listed, and permanently never running" state <c>ConnectorEndpoints</c>' own SM-5 comment
    /// says must never be creatable.</para>
    /// </summary>
    /// <param name="ownBusInstanceIds">The set of instance ids this same bus is about to (re-)register.
    /// A device whose machine is claimed by one of THOSE is an ordinary re-save of the bus's own device, not a
    /// collision — without this the second save of any bus would refuse itself.</param>
    /// <returns><see langword="true"/> if some device cannot be registered, with
    /// <paramref name="reason"/> naming it and why.</returns>
    public static bool TryFindBlockedDevice(
        ResolvedBus bus,
        IReadOnlyList<ConnectorRegistry.ConnectorBinding> bindings,
        IReadOnlyList<MachineDescriptor> roster,
        [NotNullWhen(true)] out string? reason)
    {
        ArgumentNullException.ThrowIfNull(bus);
        ArgumentNullException.ThrowIfNull(bindings);
        ArgumentNullException.ThrowIfNull(roster);

        var ownBusInstanceIds = new HashSet<string>(StringComparer.Ordinal);
        foreach (var device in bus.Devices)
        {
            ownBusInstanceIds.Add(DriverKinds.Normalize(device.InstanceId));
        }

        foreach (var device in bus.Devices)
        {
            var wantedId = DriverKinds.Normalize(device.InstanceId);

            foreach (var binding in bindings)
            {
                if (binding.MachineCode is null) continue;
                if (!string.Equals(binding.MachineCode, device.MachineCode, StringComparison.OrdinalIgnoreCase)) continue;
                if (string.Equals(binding.InstanceId, wantedId, StringComparison.Ordinal)) continue;
                if (ownBusInstanceIds.Contains(binding.InstanceId)) continue;

                reason =
                    $"Device at unit {device.UnitId} serves machine '{device.MachineCode}', which is already " +
                    $"served by connector instance '{binding.InstanceId}'. Two connectors may not drive one " +
                    "machine — a write could not then be resolved to a single device. NOTHING was saved: a bus " +
                    "is saved whole or not at all, so no device on this line was registered. Remove that " +
                    $"connector (DELETE /v1/connectors/{binding.InstanceId}) or give this device a different " +
                    "machine code, then save the bus again.";
                return true;
            }

            // The bus's OWN devices are exempt from the roster check for the same reason they are exempt from
            // the claim check: re-saving a bus finds its own machines in the roster, every time, and that is
            // the ordinary update path rather than a collision. `RegisterMachine` will simply answer false for
            // them, which is the documented "already present" outcome and not a failure.
            if (bindings.Any(b => ownBusInstanceIds.Contains(b.InstanceId)
                                  && string.Equals(b.MachineCode, device.MachineCode, StringComparison.OrdinalIgnoreCase)))
            {
                continue;
            }

            var rosterHit = roster.FirstOrDefault(
                d => string.Equals(d.Code, device.MachineCode, StringComparison.OrdinalIgnoreCase));
            if (rosterHit is not null)
            {
                reason =
                    $"Device at unit {device.UnitId} serves machine '{device.MachineCode}', which is already in " +
                    $"the fleet roster under driver kind '{rosterHit.DriverKind}'. Machine codes must be unique " +
                    "across the whole fleet. NOTHING was saved: a bus is saved whole or not at all. Use a " +
                    "different machine code for this device and save the bus again.";
                return true;
            }
        }

        reason = null;
        return false;
    }

    /// <summary>
    /// 🔴 Task D-7b — registers every device on <paramref name="bus"/> into
    /// <paramref name="registry"/>, and UNDOES ITSELF COMPLETELY if any one of them is refused.
    ///
    /// <para>Reachable only under a concurrent registration (every ordinary refusal is caught by
    /// <see cref="TryFindBlockedDevice"/> before anything is mutated) — which is precisely why the undo is
    /// written as an operation rather than as a comment claiming the branch cannot happen. D-1's review proved
    /// this exact class of branch reachable after its author had claimed otherwise.</para>
    ///
    /// <para>The undo cannot itself be partial: <see cref="ConnectorRegistry.Unregister"/> is a dictionary
    /// mutation that performs no I/O, never throws, and is applied only to the ids THIS call registered — so a
    /// re-save that is rolled back leaves the incumbent bus registration it replaced... <b>gone</b>, which is
    /// the one honest limit here and is stated in <paramref name="refusal"/> rather than hidden: replacing a
    /// registration is last-write-wins, so the previous entry for an id is destroyed at the moment of the
    /// successful <c>Register</c>, before any later device could fail. The rollback restores the STORE
    /// exactly, and the registry is rebuilt from the store at the next start.</para>
    /// </summary>
    /// <returns><see langword="true"/> when every device registered.</returns>
    public static bool TryRegisterAll(
        ResolvedBus bus,
        ModbusBusRegistry busRegistry,
        ConnectorRegistry registry,
        ILogger logger,
        [NotNullWhen(false)] out string? refusal)
    {
        ArgumentNullException.ThrowIfNull(bus);
        ArgumentNullException.ThrowIfNull(busRegistry);
        ArgumentNullException.ThrowIfNull(registry);

        var factory = new ModbusRtuConnectorFactory(
            busKey: bus.Plan.BusKey,
            openLink: bus.Plan.OpenLink,
            busRegistry: busRegistry,
            writeQueueBudgetMs: ModbusMultidropMap.MaxWorstCaseBusHoldMs(bus.Devices),
            logWarning: msg => logger.LogWarning("{ModbusRtuMsg}", msg),
            logError: (ex, msg) => logger.LogError(ex, "{ModbusRtuMsg}", msg));

        var registered = new List<string>(bus.Devices.Count);

        foreach (var device in bus.Devices)
        {
            if (registry.Register(factory, device.MapJson, instanceId: device.InstanceId, machineCode: device.MachineCode))
            {
                registered.Add(device.InstanceId);
                continue;
            }

            foreach (var id in registered)
            {
                registry.Unregister(id);
            }

            registry.TryGetInstanceIdForMachine(device.MachineCode, out var incumbent);
            refusal =
                $"Device at unit {device.UnitId} (machine '{device.MachineCode}') could not be registered — " +
                $"machine '{device.MachineCode}' was claimed by connector instance '{incumbent ?? "(unknown)"}' " +
                "while this request was in flight. Every device this request had already registered has been " +
                "unregistered, so no part of this bus is live.";
            return false;
        }

        refusal = null;
        return true;
    }
}
