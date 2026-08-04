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
/// <para>🔴 <b>Fix round 1, review I-2 — a bus RE-CLAIMS ITS OWN NAMESPACE BEFORE it registers, and that is a
/// correctness fix rather than a message fix.</b> Until this round, re-addressing two devices on a line (unit 2
/// and unit 3 swapping machine codes — routine RS-485 maintenance) was a <b>permanent dead end</b>:
/// <see cref="TryFindBlockedDevice"/> correctly let it through, <see cref="ConnectorRegistry.Register"/> then
/// refused the first device against this same bus's own previous registration, the store was rolled back, the
/// registry was left exactly as it was — so <b>retrying the identical request failed identically, forever</b>,
/// and the only exit was a <c>DELETE</c> the refusal never mentioned. <see cref="ReleaseOwnNamespace"/> now
/// removes every registration in this bus's namespace immediately before the register pass, so the edit simply
/// works. The message that described the dead end is gone with the dead end.</para>
///
/// <para><b>What that changes about the rollback, said plainly because it is a coverage loss as well as a
/// correctness win.</b> With the namespace released first, every refusal that a single request can produce on
/// its own is now caught by <see cref="TryFindBlockedDevice"/> before anything is written. What remains for the
/// rollback is exactly what D-1's review proved reachable for the single-connector case and no more: a
/// CONCURRENT <c>POST</c> taking one of these machine codes between the pre-check and the register pass (the
/// pre-check, the save and the register are not one atomic unit). That is now a true statement where before
/// this round it was a false one — the swap reached it deterministically — and the price is that the endpoint's
/// own composition of store-rollback + registry-rollback has no deterministic test. Both halves are proved at
/// the seam instead: <see cref="TryRegisterAll"/> driven directly against an outside claim, and
/// <see cref="ConnectorConfigStore.RestoreBusAsync"/> driven directly. See the fix-round section of
/// <c>task-7b-report.md</c> for the mutation evidence and for what that leaves unpinned.</para>
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
/// <para>🔴 <b>Fix round 4 (branch review) — this method states the PROBLEM and never the REMEDY for
    /// the claim arm, and the reason is a fact about this signature.</b> "Remove that connector
    /// (DELETE /v1/connectors/{id})" is correct for an incumbent an operator saved and WRONG for one
    /// <see cref="ConnectorConfigVisibilitySeeder"/> wrote — that row is re-created at every start, so the
    /// DELETE frees the machine until the next restart and no longer. Deciding between those needs
    /// <see cref="ConnectorConfigRecord.Source"/>, and this method takes <paramref name="bindings"/> and
    /// <paramref name="roster"/> and <b>never the store</b>: the field is not in scope here and cannot be.
    /// So the incumbent's id goes OUT through <paramref name="incumbentInstanceId"/> and the caller — which
    /// does have the store — appends
    /// <see cref="Endpoints.ConnectorEndpoints.DescribeHowToFreeTheMachine"/>. Guessing a remedy from a type
    /// that cannot see what decides it is exactly how this sentence was wrong on two paths already.</para>
    /// </summary>
    /// <param name="incumbentInstanceId">The connector instance holding the contested machine, when one
    /// does — so the caller can look up its provenance and say how to free it. <see langword="null"/> for the
    /// ROSTER arm, which has no incumbent connector at all: a roster entry cannot be removed by any endpoint
    /// (<see cref="FleetHost.RegisterMachine"/> has no un-register — the residual this batch carries), so the
    /// only advice that arm can honestly give is "use a different machine code", and that advice is the same
    /// whatever wrote the row. A remedy that needs no field is better than a fork that cannot be built.</param>
    /// <returns><see langword="true"/> if some device cannot be registered, with
    /// <paramref name="reason"/> naming it and why.</returns>
    public static bool TryFindBlockedDevice(
        ResolvedBus bus,
        IReadOnlyList<ConnectorRegistry.ConnectorBinding> bindings,
        IReadOnlyList<MachineDescriptor> roster,
        [NotNullWhen(true)] out string? reason,
        out string? incumbentInstanceId)
    {
        incumbentInstanceId = null;
        ArgumentNullException.ThrowIfNull(bus);
        ArgumentNullException.ThrowIfNull(bindings);
        ArgumentNullException.ThrowIfNull(roster);

        foreach (var device in bus.Devices)
        {
            var wantedId = DriverKinds.Normalize(device.InstanceId);

            foreach (var binding in bindings)
            {
                if (binding.MachineCode is null) continue;
                if (!string.Equals(binding.MachineCode, device.MachineCode, StringComparison.OrdinalIgnoreCase)) continue;
                if (string.Equals(binding.InstanceId, wantedId, StringComparison.Ordinal)) continue;
                // 🔴 Fix round 1, I-2 — exempt on THIS BUS'S NAMESPACE, not on the new device set. The two must
                // be the same rule, because ReleaseOwnNamespace below removes exactly the namespace: exempting
                // a narrower set here would refuse an edit the register pass was about to make possible (a
                // device DROPPED at unit 5 whose machine moves to unit 1 is not in the new set, but its
                // registration is about to be released), and exempting a wider one would let a genuine outside
                // claim through to a refusal after the store had been written.
                if (IsInBusNamespace(bus.BusInstanceId, binding.InstanceId)) continue;

                incumbentInstanceId = binding.InstanceId;
                reason =
                    $"Device at unit {device.UnitId} serves machine '{device.MachineCode}', which is already " +
                    $"served by connector instance '{binding.InstanceId}'. Two connectors may not drive one " +
                    "machine — a write could not then be resolved to a single device. NOTHING was saved: a bus " +
                    "is saved whole or not at all, so no device on this line was registered.";
                return true;
            }

            // The bus's OWN devices are exempt from the roster check for the same reason they are exempt from
            // the claim check: re-saving a bus finds its own machines in the roster, every time, and that is
            // the ordinary update path rather than a collision. `RegisterMachine` will simply answer false for
            // them, which is the documented "already present" outcome and not a failure.
            if (bindings.Any(b => IsInBusNamespace(bus.BusInstanceId, b.InstanceId)
                                  && string.Equals(b.MachineCode, device.MachineCode, StringComparison.OrdinalIgnoreCase)))
            {
                continue;
            }

            var rosterHit = roster.FirstOrDefault(
                d => string.Equals(d.Code, device.MachineCode, StringComparison.OrdinalIgnoreCase));
            if (rosterHit is not null)
            {
                // 🔴 Fix round 4's sweep — no provenance fork here, and that is a finding rather than an
                // omission: nothing removes a machine from the roster (FleetHost.RegisterMachine has no
                // un-register), so "use a different machine code" is the only honest advice regardless of what
                // put the machine there. The sentence is true without the field, which is better than a fork
                // this method could not build.
                reason =
                    $"Device at unit {device.UnitId} serves machine '{device.MachineCode}', which is already in " +
                    $"the fleet roster under driver kind '{rosterHit.DriverKind}'. Machine codes must be unique " +
                    "across the whole fleet, and nothing can remove a machine from the roster while the " +
                    "application is running. NOTHING was saved: a bus is saved whole or not at all. Use a " +
                    "different machine code for this device and save the bus again.";
                return true;
            }
        }

        reason = null;
        return false;
    }

    /// <summary>
    /// 🔴 Fix round 1 (I-2/I-3), corrected in fix round 2 (N-2/N-3) — <b>whether an instance id is one that
    /// bus <paramref name="busInstanceId"/> could itself have derived</b>: the bus id (the degenerate
    /// single-device form) or <c>{bus}:unit{n}</c> for a decimal <c>n</c>.
    ///
    /// <para><b>Stated ONCE because THREE callers must agree exactly:</b> <see cref="TryFindBlockedDevice"/>
    /// exempts this set from its collision check, <see cref="ReleaseOwnNamespace"/> removes it, and
    /// <c>ModbusMultidropRegistration.SweepGhosts</c> — the <c>connectors.json</c> path — sweeps it. Fix round
    /// 1 said "two callers" and left <c>SweepGhosts</c>'s inline copy in place, on the very fix that cited it
    /// as sharing the rule; principle 3's own point, missed on the fix that quoted it. All three now call
    /// here. A drift between them is either a refused edit the register pass was about to make work, or a
    /// claim let through to a refusal after the store has been written, or one bus deleting another's
    /// registration.</para>
    ///
    /// <para>🔴 <b>Fix round 2, N-2 — the earlier version was OVER-BROAD, and the doc that described it called
    /// the property "a guarantee rather than a hope". It was neither.</b> It asked only that the id START with
    /// <c>{bus}:unit</c> and END in digits, so bus <c>line1</c> claimed <c>line1:unitA:unit3</c> — which is a
    /// legitimate device of the DIFFERENT bus <c>line1:unitA</c>, a legal bus name because
    /// <see cref="ModbusMultidropMap.ValidateBusInstanceId"/> reserves only an all-DIGIT suffix. Saving
    /// <c>line1</c> released that device's machine claim while its driver kept polling and its store row
    /// stayed, with nothing said until a restart.</para>
    ///
    /// <para><b>What the predicate actually promises now, stated as the arithmetic instead of as a
    /// guarantee:</b> the separator must be the LAST <c>:unit</c> in the string AND must sit exactly where
    /// this bus's name ends, so an id can belong to at most one bus — the longest name that can precede its
    /// final <c>:unit</c>. That is a property of this function, checkable by reading it, rather than a
    /// property of a naming rule elsewhere that happens not to cover the case. The old wording rested on
    /// <c>ValidateBusInstanceId</c> making <c>line1:unit3</c> underivable by anything but <c>line1</c>, which
    /// is true, and then generalised it to a shape the rule never covered.</para>
    ///
    /// <para><b>Inherited, not invented:</b> the over-broad form was byte-identical to D-7a's
    /// <c>SweepGhosts</c>, which is why N-3's redirection is part of this fix — closing it in one place and
    /// leaving the original is the exact half-sweep principle 3 exists to refuse.</para>
    /// </summary>
    public static bool IsInBusNamespace(string busInstanceId, string instanceId)
    {
        var normalizedBus = DriverKinds.Normalize(busInstanceId);
        var normalized = DriverKinds.Normalize(instanceId);

        if (string.Equals(normalized, normalizedBus, StringComparison.Ordinal)) return true;

        // The derived shape at all (a non-empty, all-decimal suffix after the LAST ":unit").
        if (!ModbusMultidropMap.LooksLikeADeviceInstanceId(normalized)) return false;

        // 🔴 N-2 — and the separator must be THIS bus's, not any earlier one. `LastIndexOf` rather than
        // `IndexOf`: `ModbusMultidropMap.DeviceInstanceId` appends, so the separator a device's own bus
        // contributed is always the last one. StartsWith stays because position alone does not prove the
        // prefix matches (bus "abcde" and id "xyzab:unit3" agree on length and on nothing else).
        return normalized.LastIndexOf(ModbusMultidropMap.DeviceIdSuffixPrefix, StringComparison.Ordinal) == normalizedBus.Length
               && normalized.StartsWith(normalizedBus, StringComparison.Ordinal);
    }

    /// <summary>
    /// 🔴 <b>Fix round 1, review I-2 — releases every registration in this bus's own namespace, immediately
    /// before the register pass, and this is what turns routine RS-485 maintenance from a permanent dead end
    /// into an ordinary save.</b>
    ///
    /// <para>Two devices trading slave addresses (unit 2 ⇄ unit 3) is the ordinary re-addressing edit. Without
    /// this, the new <c>line1:unit2</c> was refused against the OLD <c>line1:unit3</c>'s surviving claim, the
    /// store was rolled back and the registry was left untouched — so the identical retry failed identically,
    /// forever, and the only exit was a <c>DELETE</c> the refusal never named. Releasing first removes the
    /// incumbent that the edit is replacing, which is the only thing that was ever in the way.</para>
    ///
    /// <para><b>It also closes the persisted half of D-4's own <c>m6</c> for this path:</b> a device DROPPED
    /// from the map has its store row deleted by <see cref="ConnectorConfigStore.SaveBusAsync"/> but used to
    /// keep its registry claim until the process restarted, so the machine could be served by nothing.
    /// <c>ModbusMultidropRegistration.SweepGhosts</c> already did this for the <c>connectors.json</c> path;
    /// this is the same rule for the endpoint path, sharing <see cref="IsInBusNamespace"/> rather than
    /// restating it.</para>
    ///
    /// <para><b>Cost, stated:</b> a save that later fails cannot put these entries back — the store is
    /// authoritative and the registry is rebuilt from it at the next start. That was already true of every
    /// entry a successful <c>Register</c> replaced (last-write-wins destroys the previous one at that moment),
    /// so this widens an existing limit rather than creating one, and
    /// <see cref="Endpoints.ConnectorEndpoints.DescribeBusRollbackOutcome"/> reports it from the COUNT this
    /// method returns instead of asserting it unconditionally.</para>
    /// </summary>
    /// <returns>How many registrations were released. 0 means this bus had none live in this process — an
    /// ordinary outcome (a first save, or rows persisted by an earlier process run), not a failure.</returns>
    public static int ReleaseOwnNamespace(string busInstanceId, ConnectorRegistry registry)
    {
        ArgumentNullException.ThrowIfNull(registry);

        var released = 0;
        foreach (var binding in registry.SnapshotBindings())
        {
            if (!IsInBusNamespace(busInstanceId, binding.InstanceId)) continue;
            if (registry.Unregister(binding.InstanceId)) released++;
        }

        return released;
    }

    /// <summary>🔴 Fix round 1, review I-1 — what <see cref="TryRegisterAll"/> actually DID, because the
    /// endpoint's 409 used to assert the registry had been disturbed on a path where it had not been touched
    /// at all. A message that branches on a fact has to be given the fact.</summary>
    /// <param name="Succeeded"><see langword="true"/> when every device registered.</param>
    /// <param name="Registered">🔴 Fix round 2, N-4 — how many of this bus's devices are registered <b>when
    /// this call returns</b>, which on the failure path is necessarily <c>0</c>: the undo has already run, so
    /// "how many it registered before it stopped" (what this said) described a moment that no longer exists by
    /// the time a caller can read it. The end state is the useful fact and the only one that stays true.</param>
    /// <param name="IncumbentsReleased"><see cref="ReleaseOwnNamespace"/>'s own return value — how many live
    /// registrations of THIS bus were released before the register pass, and therefore how many the rollback
    /// cannot put back.</param>
    /// <param name="Refusal">Operator-readable, <see langword="null"/> on success.</param>
    public readonly record struct BusRegistrationOutcome(
        bool Succeeded, int Registered, int IncumbentsReleased, string? Refusal);

    /// <summary>
    /// 🔴 Task D-7b — registers every device on <paramref name="bus"/> into <paramref name="registry"/>, and
    /// UNDOES ITSELF COMPLETELY if any one of them is refused.
    ///
    /// <para><b>What reaches the failure branch, stated accurately after fix round 1's I-2.</b> With
    /// <see cref="ReleaseOwnNamespace"/> running first, every refusal a single request can produce on its own
    /// is caught by <see cref="TryFindBlockedDevice"/> before anything is written; what is left is a
    /// CONCURRENT registration taking one of these machine codes between the pre-check and this call — the
    /// interleaving D-1's review proved reachable for the single-connector case. Before that fix this
    /// paragraph was FALSE (a device swap reached the branch deterministically, and the message it printed
    /// named a cause that had not happened); it is written this way now because the fix removed the path, not
    /// because the path was re-argued away. This method is still driven directly by a test against an outside
    /// claim rather than left to a comment — see <c>RtuBusRegistrationTests</c>.</para>
    ///
    /// <para>The undo cannot itself be partial: <see cref="ConnectorRegistry.Unregister"/> is a dictionary
    /// mutation that performs no I/O and never throws. What it cannot do is put back an entry this call
    /// destroyed — the ones <see cref="ReleaseOwnNamespace"/> released, and any that a successful
    /// <c>Register</c> replaced (last-write-wins). <see cref="BusRegistrationOutcome.IncumbentsReleased"/>
    /// carries that count out so the caller's message can be true instead of assuming.</para>
    /// </summary>
    public static BusRegistrationOutcome TryRegisterAll(
        ResolvedBus bus,
        ModbusBusRegistry busRegistry,
        ConnectorRegistry registry,
        ILogger logger)
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

        // 🔴 I-2 — first, so the edit this bus is making is never blocked by the state this bus is replacing.
        var incumbentsReleased = ReleaseOwnNamespace(bus.BusInstanceId, registry);

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
            return new BusRegistrationOutcome(
                Succeeded: false,
                Registered: 0,
                IncumbentsReleased: incumbentsReleased,
                Refusal:
                    $"Device at unit {device.UnitId} (machine '{device.MachineCode}') could not be registered — " +
                    $"machine '{device.MachineCode}' is served by connector instance " +
                    $"'{incumbent ?? "(unknown)"}', which is not part of this bus and took that claim after this " +
                    "request had already been checked. Every device this request had registered has been " +
                    "unregistered, so no part of this bus is live.");
        }

        return new BusRegistrationOutcome(true, registered.Count, incumbentsReleased, null);
    }
}
