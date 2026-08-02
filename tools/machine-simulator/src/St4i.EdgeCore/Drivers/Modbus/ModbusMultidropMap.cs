using System.Text.Json;

namespace St4i.EdgeCore.Drivers.Modbus;

/// <summary>
/// Task D-4 (.superpowers/sdd/2026-08-02-dotD-modbus-rtu-blueprint/task-4-brief.md) — ONE device on a
/// multidrop bus, as <see cref="ModbusMultidropMap.FanOut"/> hands it to a registration path.
///
/// <para>Every field here is what a registration path needs to create ONE connector instance serving ONE
/// machine: an id to key the instance under, the machine code that instance claims, and the opaque
/// configuration string it stores. <see cref="Map"/> is the already-parsed form of <see cref="MapJson"/>,
/// carried because the fan-out has just parsed it to validate it and re-parsing at the call site would be
/// both wasteful and a second chance to disagree.</para>
/// </summary>
/// <param name="InstanceId">The connector INSTANCE id this device registers under — see
/// <see cref="ModbusMultidropMap.FanOut"/> for how it is derived and why from the unit id rather than from
/// the machine code.</param>
/// <param name="MachineCode">The machine this device serves. The registry claim D-1's routing rests on.</param>
/// <param name="UnitId">The Modbus slave address on the wire. Unique across one bus — see
/// <see cref="ModbusMultidropMap.FanOut"/>.</param>
/// <param name="MapJson">🔴 <b>A STANDALONE, single-device register-map document</b> — the exact text of this
/// device's own element, verbatim, which <see cref="ModbusRegisterMap.FromJson"/> parses on its own with no
/// surrounding context. This is the property that makes the whole fan-out safe: what a connector instance
/// stores and what its factory later re-parses is a document that <b>cannot declare a second machine</b>, so
/// the "one driver emitting N machine codes" shape blueprint §7.1 forbids is unreachable downstream by
/// construction rather than by convention.</param>
/// <param name="Map">The parsed form of <paramref name="MapJson"/>. Its
/// <see cref="ModbusRegisterMap.MachineCode"/>/<see cref="ModbusRegisterMap.UnitId"/> are the same values as
/// the two properties above, by construction — they are read off this object.</param>
public sealed record ModbusBusDevice(
    string InstanceId,
    string MachineCode,
    byte UnitId,
    string MapJson,
    ModbusRegisterMap Map);

/// <summary>
/// 🔴 Task D-4 — <b>how a bus of N devices is declared, and how it fans out into N connector instances.</b>
///
/// <para><b>The shape, and why the other one is unsafe.</b> Blueprint §7.1 records that the same file format
/// has two implementations, indistinguishable in a spec sentence and opposite on safety: the registration path
/// either fans the file out into <b>N connector instances, each serving one machine</b> (this class), or hands
/// one blob to one factory that produces <b>one driver emitting N machine codes</b>. The second is refused
/// because <see cref="St4i.Connector.Abstractions.Models.SetpointWriteRequest"/> and
/// <see cref="St4i.Connector.Abstractions.Models.CommandRequest"/> carry no machine code: a driver serving N
/// machines has no way to route a write to the right one, which is verbatim the hole that produced Đợt B's
/// <see cref="St4i.Connector.Abstractions.Models.MachineDriverAvailability.AmbiguousDriver"/> guard after a
/// write for machine B reached machine A's device.</para>
///
/// <para><b>The register map is reused, NOT forked.</b> <see cref="ModbusRegisterMap"/> stays exactly 1:1 with
/// one machine code and one unit id — which is correct for one device and is the property the routing rests
/// on. There is no second map type and no second validation path: every device element below is parsed by
/// <see cref="ModbusRegisterMap.FromJson"/>, the same method the Modbus TCP driver's configuration goes
/// through, so every rule that method enforces (mandatory writable bounds, Holding-only writes, unique
/// writable metrics, the inverse-scaling overflow check, the tolerant
/// <c>readTimeoutMs</c>/<c>retries</c> fallbacks) applies to a multidrop device unchanged and cannot drift.
/// What this class adds is exactly the rules that only exist once several devices share one line.</para>
///
/// <para><b>The document.</b> Two accepted shapes, and the first is today's file unchanged:</para>
/// <code>
/// // Legacy / single device — byte-identical to every map shipped before D-4:
/// { "machineCode": "M1", "unitId": 1, "pollIntervalMs": 1000, "registers": [ ... ] }
///
/// // Multidrop — a bus of N devices:
/// { "devices": [
///     { "machineCode": "M1", "unitId": 1, "pollIntervalMs": 1000, "registers": [ ... ] },
///     { "machineCode": "M2", "unitId": 2, "pollIntervalMs": 1000, "registers": [ ... ] }
///   ] }
/// </code>
///
/// <para><b>🔴 A device element is a COMPLETE single-device document, and nothing is inherited from the bus
/// level.</b> No shared <c>pollIntervalMs</c>, no shared <c>readTimeoutMs</c>, no shared <c>retries</c>. The
/// convenience is real and it was rejected for a specific reason: the fanned-out
/// <see cref="ModbusBusDevice.MapJson"/> is the text a connector instance stores verbatim and its factory
/// later re-parses, so inheritance would mean the registration path <b>synthesises</b> a document the operator
/// never wrote — and the file on disk and the configuration actually running would then be two different
/// things that have to be reconciled by hand every time either is read. Taking the element's own
/// <c>GetRawText()</c> keeps them identical. The cost, stated: a bus whose devices genuinely share a cadence
/// repeats it per device.</para>
///
/// <para><b>🔴 What is deliberately NOT validated here, and why each omission is the safe direction.</b></para>
/// <list type="bullet">
/// <item><description><b>Unit id 0 (broadcast) and 248–255 (reserved by the Modbus specification).</b> These
/// are RTU rules, and this document is transport-agnostic by design: the identical single-device shape drives
/// <see cref="ModbusTcpDriver"/>, where unit 0 is entirely legal and common (a TCP device that ignores the
/// unit id, or a TCP→RTU gateway that uses it to select the serial slave). D-2 reported this as an
/// insufficiency rather than closing it, and its own correction (task-2-report.md §10b, m-9) is that the
/// refusal belongs at the RTU CONSTRUCTION boundary — which is <see cref="ModbusRtuDriver"/>'s constructor,
/// where it now lives and where it covers <b>every</b> RTU path including a single-device map that never came
/// through this class. Putting it here would reproduce exactly that regression one layer up, because
/// <see cref="FanOut"/>'s degenerate single-device case IS the TCP driver's own document.</description></item>
/// <item><description><b>A device-count cap, as a constant.</b> There is no arbitrary number to enforce: the
/// address space already caps a bus at 247 individually addressable slaves (unit ids 1–247), enforced per
/// device at the RTU boundary, and 256 distinct <see cref="byte"/> values here. The conventional RS-485
/// electrical limit of 32 unit loads is a property of the transceivers on the segment — 1/8-unit-load parts
/// allow 256 nodes — so enforcing 32 would refuse a physically valid bus. The limit that actually binds is
/// throughput, which is not decidable from this document: it needs the line rate, which lives on
/// <c>SerialLineSettings</c> (per bus, deliberately not on the map — D-3 §2.2) and does not exist at all for a
/// gateway transport. The arithmetic and the numbers are in task-4-report.md §5.</description></item>
/// <item><description><b>Poll cadence feasibility.</b> Same reason. What happens instead when a bus is
/// oversubscribed is stated rather than guessed at: <see cref="ModbusRtuDriver"/> delays for
/// <see cref="ModbusRegisterMap.PollIntervalMs"/> <b>after</b> each poll completes, so an oversubscribed bus
/// stretches every device's cadence uniformly and no device silently misses an interval or accumulates a
/// backlog — and each reading carries its own timestamp, so the stretch is visible in the data rather than
/// hidden. See task-4-report.md §6.</description></item>
/// </list>
/// </summary>
public static class ModbusMultidropMap
{
    /// <summary>The JSON property that turns a single-device document into a bus declaration.</summary>
    public const string DevicesProperty = "devices";

    /// <summary>
    /// Parses <paramref name="json"/> — either shape (see this class's doc comment) — and fans it out into one
    /// <see cref="ModbusBusDevice"/> per device on the bus, in document order.
    ///
    /// <para><b>Throws, exactly like <see cref="ModbusRegisterMap.FromJson"/> does</b>
    /// (<see cref="JsonException"/>/<see cref="InvalidOperationException"/>), and for the same reason: the
    /// caller is the one that decides whether a malformed map disables this connector for the run or crashes
    /// the host, and every existing caller of the parse path already makes that decision. This method itself
    /// stays a plain, throwing parse function.</para>
    ///
    /// <para><b>The cross-device rules, and the consequence each one refuses.</b></para>
    /// <list type="number">
    /// <item><description><b>Duplicate unit id.</b> Two devices at one slave address on one line is not a
    /// configuration, it is a collision: both answer every request, the frames overlap, and what the master
    /// decodes is whatever survived — a plausible wrong number rather than an error. Refused.</description></item>
    /// <item><description><b>Duplicate machine code.</b> Ordinal-ignore-case, matching every other machine-code
    /// comparison in this codebase. Two devices claiming one machine cannot both register —
    /// <c>ConnectorRegistry.Register</c> refuses the second claim — so without this check the fan-out would
    /// silently produce a device that never comes up, with the reason buried in a startup log.</description></item>
    /// <item><description><b>Both <c>devices</c> and a device-level field at the root.</b> A document that
    /// declares a bus AND a device is two contradictory declarations; picking either one silently is worse than
    /// refusing both.</description></item>
    /// <item><description><b>An empty <c>devices</c> array.</b> A bus with no devices is a connector that
    /// registers nothing, which looks exactly like a connector that failed for some other reason.</description></item>
    /// </list>
    /// </summary>
    /// <param name="json">The register-map document.</param>
    /// <param name="busInstanceId">The connector instance id the operator named this BUS under — the id
    /// <c>POST /v1/connectors</c>, <c>connectors.json</c> or the seeding path already has in hand. Each device's
    /// own instance id is derived from it (see the return value's remarks).</param>
    /// <param name="logWarning">Forwarded verbatim to <see cref="ModbusRegisterMap.FromJson"/> for each device,
    /// so a malformed <c>readTimeoutMs</c>/<c>retries</c> on device 3 is reported the same way it is for a
    /// single-device map.</param>
    /// <returns>
    /// One entry per device, in document order.
    ///
    /// <para><b>🔴 How each device's instance id is derived, and the cost of the choice.</b> A multidrop
    /// document produces <c>{busInstanceId}:unit{unitId}</c>; a legacy single-device document produces
    /// <paramref name="busInstanceId"/> <b>verbatim</b>, so a map that exists today keeps its exact instance
    /// id, its pipeline slot label and therefore its alarm <c>TargetId</c> when a registration path starts
    /// calling this method instead of <see cref="ModbusRegisterMap.FromJson"/>.</para>
    ///
    /// <para>The unit id rather than the machine code, because the instance IS a position on the bus: an
    /// operator who renames a machine keeps their alarm history, which is the more common edit. The cost,
    /// stated rather than discovered later: re-addressing a device (changing its slave address — a physical
    /// change) moves its slot label, and so does converting a single-device map to the <c>devices</c> form
    /// (<c>Modbus</c> → <c>Modbus:unit1</c>). Both fork an operator's acknowledged alarms for that connector.
    /// D-7 owns saying so where an operator reads it.</para>
    /// </returns>
    public static IReadOnlyList<ModbusBusDevice> FanOut(
        string json, string busInstanceId, Action<string>? logWarning = null)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(busInstanceId);

        using var document = JsonDocument.Parse(json);
        var root = document.RootElement;

        if (root.ValueKind != JsonValueKind.Object)
        {
            throw new InvalidOperationException(
                $"Modbus register map: the document root must be a JSON object (got {root.ValueKind}).");
        }

        if (!root.TryGetProperty(DevicesProperty, out var devices))
        {
            // The degenerate bus: one device, parsed by exactly the method every single-device map already
            // goes through, keyed under exactly the instance id it already had.
            var single = ModbusRegisterMap.FromJson(json, logWarning);
            return new[] { new ModbusBusDevice(busInstanceId, single.MachineCode, single.UnitId, json, single) };
        }

        if (devices.ValueKind != JsonValueKind.Array)
        {
            throw new InvalidOperationException(
                $"Modbus register map: '{DevicesProperty}' must be an array of single-device maps (got {devices.ValueKind}).");
        }

        // A document that declares a bus AND a device at the root is two contradictory declarations. Checked
        // against the two fields FromJson itself requires, so the message can name what it found rather than
        // listing every property a device element may carry.
        foreach (var conflicting in new[] { "machineCode", "registers" })
        {
            if (root.TryGetProperty(conflicting, out _))
            {
                throw new InvalidOperationException(
                    $"Modbus register map: the document declares both '{DevicesProperty}' and a top-level " +
                    $"'{conflicting}'. A multidrop map declares a BUS of devices; every device's own fields " +
                    $"belong inside its '{DevicesProperty}' element, and nothing is inherited from the bus level.");
            }
        }

        if (devices.GetArrayLength() == 0)
        {
            throw new InvalidOperationException(
                $"Modbus register map: '{DevicesProperty}' is empty — a bus with no devices registers no " +
                "connector at all, which is indistinguishable from a connector that failed to start.");
        }

        var fanned = new List<ModbusBusDevice>(devices.GetArrayLength());
        var unitIds = new Dictionary<byte, string>();
        var machineCodes = new Dictionary<string, byte>(StringComparer.OrdinalIgnoreCase);
        var index = 0;

        foreach (var element in devices.EnumerateArray())
        {
            var position = index++;

            if (element.ValueKind != JsonValueKind.Object)
            {
                throw new InvalidOperationException(
                    $"Modbus register map: '{DevicesProperty}[{position}]' must be a single-device map object " +
                    $"(got {element.ValueKind}).");
            }

            if (element.TryGetProperty(DevicesProperty, out _))
            {
                throw new InvalidOperationException(
                    $"Modbus register map: '{DevicesProperty}[{position}]' itself declares '{DevicesProperty}' — " +
                    "a bus of buses is not a shape this format has; each element is one device.");
            }

            // 🔴 The element's own text, verbatim — this is what the connector instance stores and what its
            // factory re-parses, and it is a document that cannot declare a second machine.
            var deviceJson = element.GetRawText();

            ModbusRegisterMap map;
            try
            {
                map = ModbusRegisterMap.FromJson(deviceJson, logWarning);
            }
            catch (Exception ex)
            {
                // Name WHICH device failed. Without this the operator gets a message about a missing
                // 'registers' key with nothing saying which of eight devices on the bus is missing it.
                throw new InvalidOperationException(
                    $"Modbus register map: '{DevicesProperty}[{position}]' is not a valid single-device map — {ex.Message}",
                    ex);
            }

            if (unitIds.TryGetValue(map.UnitId, out var incumbentCode))
            {
                throw new InvalidOperationException(
                    $"Modbus register map: unit id {map.UnitId} is declared twice on this bus — by machine " +
                    $"'{incumbentCode}' and by machine '{map.MachineCode}'. Two devices at one slave address on " +
                    "one line both answer every request, and the master decodes whichever frame survives the " +
                    "collision — a plausible wrong number, not an error. Slave addresses must be unique per bus.");
            }

            if (machineCodes.TryGetValue(map.MachineCode, out var incumbentUnit))
            {
                throw new InvalidOperationException(
                    $"Modbus register map: machine code '{map.MachineCode}' is declared twice on this bus — by " +
                    $"unit {incumbentUnit} and by unit {map.UnitId}. At most one connector instance can serve a " +
                    "machine, so the second device would silently never register.");
            }

            unitIds[map.UnitId] = map.MachineCode;
            machineCodes[map.MachineCode] = map.UnitId;

            fanned.Add(new ModbusBusDevice(
                InstanceId: DeviceInstanceId(busInstanceId, map.UnitId),
                MachineCode: map.MachineCode,
                UnitId: map.UnitId,
                MapJson: deviceJson,
                Map: map));
        }

        return fanned;
    }

    /// <summary>The instance id one device on <paramref name="busInstanceId"/> registers under. Exposed so a
    /// caller (and a test) names the same string this class does instead of restating the format — the same
    /// reason D-2 puts bus-key construction on the link types rather than at call sites.</summary>
    public static string DeviceInstanceId(string busInstanceId, byte unitId) => $"{busInstanceId}:unit{unitId}";
}
