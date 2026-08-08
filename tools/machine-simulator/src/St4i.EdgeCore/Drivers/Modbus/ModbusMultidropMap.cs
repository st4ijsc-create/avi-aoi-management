using System.Text.Json;
using St4i.Connector.Abstractions.Models;

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
    /// 🔴 Task D-4 review, I-2 — <b>the COMPLETE set of keys <see cref="ModbusRegisterMap.FromJson"/> reads,
    /// none of which may appear beside <see cref="DevicesProperty"/> at the root.</b>
    ///
    /// <para>The first version of this list held only <c>machineCode</c> and <c>registers</c> — the two fields
    /// <see cref="ModbusRegisterMap.FromJson"/> REQUIRES — on the reasoning that a root declaring either of them
    /// is obviously declaring a device. That was the wrong test, and the gap it left is precisely the failure
    /// this class's own no-inheritance decision exists to prevent: <c>{"pollIntervalMs": 5000, "devices": […]}</c>
    /// parsed cleanly and every device silently ran its own value or the default, so <b>the file on disk and the
    /// configuration actually running were two different things</b> — the exact sentence used to justify the
    /// decision, left reachable by the check written to enforce it.
    ///
    /// <para>The right test is not "is this field required" but "could a reader believe this field applies to
    /// the bus". That set is finite and knowable: it is every key the per-device parse consumes. Listed
    /// exhaustively here, in <see cref="ModbusRegisterMap"/>'s own declaration order, so the next person to add
    /// a map field has one obvious place to add it too.</para>
    /// </summary>
    private static readonly string[] DeviceLevelKeys =
    {
        "machineCode", "unitId", "pollIntervalMs", "registers", "commands", "readTimeoutMs", "retries",
    };

    /// <summary>
    /// 🔴 Task D-7c fix round 1, review I-2 — <b>the mirror of <see cref="DeviceLevelKeys"/>: every key that
    /// belongs to the BUS, none of which may appear inside a <see cref="DevicesProperty"/> element.</b>
    ///
    /// <para><b>The leak this closes, measured.</b> A device element carrying <c>"portName":"COM99"</c> (or
    /// <c>baudRate</c>, <c>parity</c>, <c>transport</c>, …) was accepted by every parser, did nothing, and was
    /// copied <b>verbatim into that device's <c>MapJson</c></b> — because a device's stored configuration is its
    /// own array element's raw text. Two separate defects in one: the file on disk and the configuration
    /// actually running were different (D-4's I-2 exactly, one level down), and a machine-identifying port path
    /// ended up inside the very column D-7a's projection decision keeps it out of.</para>
    ///
    /// <para><b>Why this direction is the one the new schema created.</b> <see cref="DeviceLevelKeys"/> asks
    /// "could a reader believe this field applies to the bus"; this list asks the converse, and it is the MORE
    /// likely operator error, because <c>portName</c> is the one field the serial schema teaches an operator to
    /// write and nothing in the document says which level owns it.</para>
    ///
    /// <para>🔴 <b>Why these are string literals rather than the parsers' own constants.</b> Half of them are
    /// declared in <c>ModbusRtuSerialBusSettings</c>, which lives in <c>St4i.EdgeCore.Serial</c> — an assembly
    /// that references THIS one, so naming it here is a circular reference and pushing
    /// <c>System.IO.Ports</c> into the RTU framing layer, which is the exact migration
    /// <c>SerialDependencyScopingTests.TheRtuFramingLayersOwnAssembly_…</c> forbids. The document is one schema
    /// even though its two bus-level parsers cannot see each other, and this is the price. <b>The drift guard is
    /// a test, not a type:</b> <c>ModbusRtuSerialBusSettingsTests.EveryBusLevelKeyOfBothTransports_IsRefused…</c>
    /// is a [Theory] whose rows are the parsers' own <c>const</c> fields, so renaming one breaks the test's
    /// compilation. <b>ADDING a bus-level key is NOT caught automatically</b> — whoever adds one adds a row
    /// here and a row there, and this sentence is the only thing that will tell them so.</para>
    /// </summary>
    private static readonly string[] BusLevelKeys =
    {
        // Shared by both transports.
        "transport",
        // rtu-gateway (ModbusRtuBusSettings).
        "host", "port",
        // rtu-serial (ModbusRtuSerialBusSettings, in St4i.EdgeCore.Serial).
        "portName", "baudRate", "parity", "dataBits", "stopBits",
    };

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
        ValidateBusInstanceId(busInstanceId);

        using var document = JsonDocument.Parse(json);
        var root = document.RootElement;

        if (root.ValueKind != JsonValueKind.Object)
        {
            throw new InvalidOperationException(
                $"Modbus register map: the document root must be a JSON object (got {root.ValueKind}).");
        }

        if (!root.TryGetProperty(DevicesProperty, out var devices))
        {
            // 🔴 Task D-7c fix round 1 — the SAME rule as the per-element check below, applied to the degenerate
            // form, and it closes review I-2's leak in its purest shape. Here the root IS the device, so its raw
            // text becomes that device's MapJson verbatim: a document like
            // {"transport":"rtu-serial","portName":"COM3","machineCode":"M1",…} therefore stored the port path
            // inside the device's own configuration — the exact thing the per-element check below refuses one
            // level down, reachable without any malformed element at all.
            //
            // Refusing costs nothing that exists: this branch is the LEGACY single-device map (a pre-D-4 Modbus
            // TCP document), which carries no bus-level key, and RTU has no legacy at all — nothing in src/
            // could construct an RTU driver before D-7a. So an RTU bus declares `devices`, even for one device,
            // and no shipped instance id moves.
            foreach (var busLevel in BusLevelKeys)
            {
                if (!root.TryGetProperty(busLevel, out _)) continue;

                throw new InvalidOperationException(
                    $"Modbus register map: the document declares '{busLevel}' — a BUS-level key — but has no " +
                    $"'{DevicesProperty}' array, so its root is simultaneously the bus and its only device and " +
                    $"that key would be stored as part of the DEVICE's configuration. Put the device inside " +
                    $"'{DevicesProperty}': [ … ], even when there is only one: a bus of one is still a bus.");
            }

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

        // A document that declares a bus AND a device field at the root is two contradictory declarations, and
        // the SILENT half is the dangerous one: a root `pollIntervalMs` looks like it governs the bus and does
        // nothing at all. Checked against the COMPLETE device-level key set (see DeviceLevelKeys), naming what
        // it found rather than listing the whole set back at the operator.
        foreach (var conflicting in DeviceLevelKeys)
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

            // 🔴 Fix round 1, review I-2 — the MIRROR of the DeviceLevelKeys check above, and the direction the
            // D-7c schema created. See BusLevelKeys for the full argument and for the leak this closes.
            foreach (var busLevel in BusLevelKeys)
            {
                if (!element.TryGetProperty(busLevel, out _)) continue;

                throw new InvalidOperationException(
                    $"Modbus register map: '{DevicesProperty}[{position}]' declares '{busLevel}', which is a " +
                    "BUS-level key and does nothing inside a device. Line parameters and the transport belong to " +
                    "the whole segment — every device on one wire shares them by physics — so they go beside " +
                    $"'{DevicesProperty}', not inside it. Left accepted it would be silently ignored AND copied " +
                    "verbatim into this device's stored configuration.");
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

        WarnAboutDevicesThatCanMonopoliseTheBus(fanned, logWarning);
        return fanned;
    }

    /// <summary>
    /// 🔴 Task D-4 review, I-1 — <b>the one bus-wide cost that IS decidable from this document, computed and
    /// reported.</b>
    ///
    /// <para><see cref="ModbusRegisterMap.WorstCaseBusHoldMs"/> is how long one device can hold the shared
    /// arbitration lock for a single poll, and every input to it is in the map. A device declaring
    /// <c>readTimeoutMs: 60000</c> with <c>retries: 5</c> over 20 registers holds the line for about TWO HOURS
    /// per poll cycle — accepted by every check above, and stalling every other device on the bus for all of
    /// it. Saying nothing about that while this class's own report argues "refuse what is decidable" was the
    /// gap the review found.</para>
    ///
    /// <para><b>The threshold, and why it is this one.</b> A device's hold is compared against the SUM of the
    /// OTHER devices' poll intervals — i.e. against the time the rest of the bus collectively expects to get.
    /// The obvious alternative, "the hold exceeds this device's own poll interval", is useless: the derived
    /// default is already <c>PollIntervalMs × 4</c>, so it is true of every device on every correctly
    /// configured bus. This threshold uses only values already in the same document, and a bus whose devices
    /// declare a read timeout sized for their actual round trip does not trip it (eight 8-register devices at
    /// a 1 s cadence with <c>readTimeoutMs: 300</c>: hold 4 800 ms against 7 000 ms of siblings' cadence).</para>
    ///
    /// <para><b>🔴 It WARNS rather than refuses, and the distinction is the product's own default.</b> With no
    /// <c>readTimeoutMs</c> declared, <see cref="ModbusRegisterMap.EffectiveReadTimeoutMs"/> derives
    /// <c>max(1000, PollIntervalMs × 4)</c> — a value THIS PRODUCT chose, reasoned for a dedicated TCP socket
    /// where a stalled read costs only its own device (see that property's own remarks) — and on a multidrop bus
    /// that default alone trips this check. <b>Refusing would reject a bus whose operator wrote nothing wrong,
    /// on account of a default the product supplied</b>, which is a worse failure than a loud warning: the
    /// operator has no way to prove the product wrong, whereas a warning naming the number and the fix is
    /// directly actionable. Refusal stays for what the operator actually declared and which cannot work at all —
    /// a duplicate slave address, an unanswerable unit id. This is the same line §6 of task-4-report.md draws;
    /// what the review corrected is that this quantity falls on the "decidable" side of it and was not being
    /// computed at all.</para>
    ///
    /// <para>Single-device documents are skipped entirely: with no siblings there is no one to stall, and the
    /// hold is exactly the private cost <see cref="ModbusTcpDriver"/> has always paid.</para>
    /// </summary>
    private static void WarnAboutDevicesThatCanMonopoliseTheBus(
        IReadOnlyList<ModbusBusDevice> devices, Action<string>? logWarning)
    {
        if (logWarning is null || devices.Count < 2)
        {
            return;
        }

        long siblingCadenceMs = 0;
        foreach (var device in devices)
        {
            siblingCadenceMs += device.Map.PollIntervalMs;
        }

        foreach (var device in devices)
        {
            var othersCadenceMs = siblingCadenceMs - device.Map.PollIntervalMs;
            var hold = device.Map.WorstCaseBusHoldMs;
            if (hold <= othersCadenceMs)
            {
                continue;
            }

            // Name the dominant term, because the fix differs: a DERIVED timeout is the product's own default
            // and the operator simply has to declare one, whereas a DECLARED one is a number they chose.
            var timeoutSource = device.Map.ReadTimeoutMs is null
                ? $"its read timeout is DERIVED from its poll cadence (max(1000, {device.Map.PollIntervalMs} × 4) = " +
                  $"{device.Map.EffectiveReadTimeoutMs} ms), a default sized for a dedicated connection rather than a " +
                  "shared line — declare 'readTimeoutMs' for this device, sized for its slowest legitimate single " +
                  "round trip"
                : $"it declares 'readTimeoutMs' {device.Map.EffectiveReadTimeoutMs}";

            logWarning(
                $"Modbus multidrop bus: device '{device.MachineCode}' (unit {device.UnitId}) can hold the shared " +
                $"bus for up to {hold} ms in one poll — {device.Map.Registers.Count} register(s) × " +
                $"{device.Map.EffectiveRetries + 1} attempt(s) × {device.Map.EffectiveReadTimeoutMs} ms — which " +
                $"exceeds the {othersCadenceMs} ms of poll cadence every OTHER device on this bus is asking for " +
                $"combined. While this device is not answering, they all wait. Cause: {timeoutSource}.");
        }
    }

    /// <summary>The instance id one device on <paramref name="busInstanceId"/> registers under. Exposed so a
    /// caller (and a test) names the same string this class does instead of restating the format — the same
    /// reason D-2 puts bus-key construction on the link types rather than at call sites.
    ///
    /// <para><b>Review m5 — this derivation was not collision-free across BUSES, and 🔴 Task D-7a closes it at
    /// the only place it can be closed: by refusing the bus name, not by detecting the collision.</b> A bus
    /// named <c>X</c> with a device at unit 1 and a bus named <c>X:unit1</c> with a legacy single-device map
    /// both derive the instance id <c>X:unit1</c>, and <c>ConnectorRegistry.Register</c> is last-write-wins on
    /// the id — so the second silently replaced the first while <c>RegisterAll</c> still counted it registered.
    /// D-4 could not close it because it saw ONE bus and the collision is between two; the fix is therefore not
    /// a check between two buses but a rule that makes the two namespaces disjoint —
    /// <see cref="ValidateBusInstanceId"/> refuses any bus id that already looks like a device position. After
    /// that, <c>{bus}:unit{n}</c> can only ever have been derived, by exactly one bus, and the collision is
    /// unconstructible rather than merely reported.</para>
    ///
    /// <para>🔴 <b>Whole-branch review M-1's sweep — that sentence is TRUE, and here is what it does NOT
    /// license, because a downstream predicate read it as licensing exactly this and was wrong for two
    /// tasks.</b> "Exactly one bus derives a given id" is a statement about the id's <b>full</b> shape: the
    /// deriving bus is everything before the <b>final</b> <see cref="DeviceIdSuffixPrefix"/>. It does NOT say
    /// that an id merely <i>beginning</i> with <c>{X}:unit</c> and ending in digits was derived by <c>X</c> —
    /// <see cref="ValidateBusInstanceId"/> reserves only an all-<b>digit</b> suffix, so <c>line1:unitA</c> is a
    /// legal bus name and <c>line1:unitA:unit3</c> is its device, derived by <c>line1:unitA</c> and by nothing
    /// else. A namespace test written as "starts with, ends in digits" therefore hands one bus another's
    /// devices; see <see cref="IsInBusNamespace"/> for the test that does not. (🔴 Task E-5 moved that
    /// predicate here from <c>RtuBusConfiguration</c>; it is still stated exactly once.)</para></summary>
    public static string DeviceInstanceId(string busInstanceId, byte unitId) => $"{busInstanceId}{DeviceIdSuffixPrefix}{unitId}";

    /// <summary>The literal that separates a bus id from a device's unit id in
    /// <see cref="DeviceInstanceId"/>. A constant rather than three copies of <c>":unit"</c> across the
    /// derivation, the reservation check and the namespace test, for the reason every other shared literal in
    /// this file is one: two statements of one format drift, and the version that drifts here either reserves
    /// a name nothing derives or fails to reserve one that something does.</summary>
    public const string DeviceIdSuffixPrefix = ":unit";

    /// <summary>
    /// 🔴 Task D-7a (D-4 review m5) — <b>refuses a bus instance id that a device instance id could also be.</b>
    /// Called by <see cref="FanOut"/>, so every path that derives device ids goes through it.
    ///
    /// <para>The rule is one sentence: <b>no bus may be named <c>…:unit&lt;digits&gt;</c></b>, because that is
    /// precisely the shape <see cref="DeviceInstanceId"/> mints. Refusing the NAME rather than detecting the
    /// COLLISION is what makes the two namespaces disjoint by construction — and disjointness is what a second
    /// thing depends on: <c>ModbusMultidropRegistration</c>'s ghost sweep identifies "the entries belonging to
    /// this bus" by exactly this prefix, and a bus legitimately named <c>X:unit1</c> would make that sweep
    /// delete another connector's registration.</para>
    ///
    /// <para>The cost, stated: an operator who genuinely wants a connector called <c>press:unit3</c> must pick
    /// another name, and is told so with the reason. That is a strictly better outcome than the alternative it
    /// replaces, which was a connector that silently vanished.</para>
    /// </summary>
    /// <exception cref="InvalidOperationException"><paramref name="busInstanceId"/> ends in
    /// <c>:unit</c> followed by one or more digits.</exception>
    public static void ValidateBusInstanceId(string busInstanceId)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(busInstanceId);

        if (!LooksLikeADeviceInstanceId(busInstanceId)) return;

        throw new InvalidOperationException(
            $"Modbus multidrop bus: '{busInstanceId}' cannot be used as a connector instance id — ids ending " +
            $"in '{DeviceIdSuffixPrefix}<number>' are reserved for one DEVICE's position on a bus of that name " +
            $"(a bus called '{busInstanceId[..busInstanceId.LastIndexOf(DeviceIdSuffixPrefix, StringComparison.Ordinal)]}' " +
            "derives exactly this id for one of its devices). Two things would then share one identity: the " +
            "later registration would silently replace the earlier one's machine claim, and removing devices " +
            "from either bus could unregister the other. Rename this connector.");
    }

    /// <summary>Whether <paramref name="instanceId"/> has the shape <see cref="DeviceInstanceId"/> mints —
    /// i.e. whether it belongs to the DERIVED namespace rather than the operator-chosen one. Hand-scanned
    /// rather than a regular expression, deliberately: this runs on a startup path with no regex cache warmed,
    /// and the predicate is four lines.</summary>
    public static bool LooksLikeADeviceInstanceId(string? instanceId)
    {
        if (string.IsNullOrWhiteSpace(instanceId)) return false;

        var at = instanceId.LastIndexOf(DeviceIdSuffixPrefix, StringComparison.Ordinal);
        // `at <= 0` rejects both "no separator" and a separator at position 0 — ":unit1" has no bus half at
        // all, so nothing could ever have derived it and reserving it would refuse a name for no reason.
        if (at <= 0) return false;

        var digits = instanceId.AsSpan(at + DeviceIdSuffixPrefix.Length);
        if (digits.IsEmpty) return false;

        foreach (var c in digits)
        {
            if (c is < '0' or > '9') return false;
        }

        return true;
    }

    /// <summary>
    /// 🔴 Fix round 1 (D-7b I-2/I-3), corrected in fix round 2 (N-2/N-3), <b>moved here by Task E-5</b> —
    /// <b>whether an instance id is one that bus <paramref name="busInstanceId"/> could itself have
    /// derived</b>: the bus id (the degenerate single-device form) or <c>{bus}:unit{n}</c> for a decimal
    /// <c>n</c>.
    ///
    /// <para><b>Stated ONCE because THREE callers must agree exactly:</b>
    /// <c>RtuBusConfiguration.TryFindBlockedDevice</c> exempts this set from its collision check,
    /// <c>RtuBusConfiguration.ReleaseOwnNamespace</c> removes it, and
    /// <c>ModbusMultidropRegistration.SweepGhosts</c> — the <c>connectors.json</c> path — sweeps it. Fix round
    /// 1 said "two callers" and left <c>SweepGhosts</c>'s inline copy in place, on the very fix that cited it
    /// as sharing the rule; principle 3's own point, missed on the fix that quoted it. A drift between them is
    /// either a refused edit the register pass was about to make work, or a claim let through to a refusal
    /// after the store has been written, or one bus deleting another's registration.</para>
    ///
    /// <para>🔴 <b>Why it lives HERE and not on <c>RtuBusConfiguration</c>, where D-7b put it — Task E-5.</b>
    /// <c>RtuBusConfiguration</c> is <c>St4i.EngineApi</c>'s, and <c>St4i.EdgeService</c> cannot reference that
    /// assembly (blueprint §1: <c>NU1605</c> plus EngineApi's ASP.NET publish surface). That single reference
    /// is what made <c>ModbusMultidropRegistration</c> a non-leaf and kept RS-485 out of the edge agent for the
    /// whole of Đợt E — blueprint §9.6(a)'s shape exactly. It is NOT copied and there is no second version to
    /// drift: the rule moved, and the three callers above all reach this one method. The move is downhill in
    /// the reference graph, so nothing that could call it before has lost the ability.</para>
    ///
    /// <para>🔴 <b>Why it belongs here — and the E-5 REVIEW corrected this paragraph, which was a false
    /// universal wrong at BOTH ends.</b> It read: <i>"every fact it reasons about — the separator
    /// <see cref="DeviceIdSuffixPrefix"/>, the derived shape <see cref="LooksLikeADeviceInstanceId"/>, the
    /// minting rule <see cref="DeviceInstanceId"/> — is declared in this type."</i> Enumerate the method
    /// instead of reading it: it depends on <b>three</b> project symbols, and
    /// <see cref="DriverKinds.Normalize"/> — called TWICE, and first — is declared in
    /// <c>St4i.Connector.Abstractions</c>, not here. Meanwhile <see cref="DeviceInstanceId"/>, which that list
    /// named, <b>is not called at all</b>. Over-inclusive and under-inclusive in one sentence.</para>
    ///
    /// <para><b>The accurate statement is narrower and still sufficient.</b> The two symbols that encode the
    /// <c>{bus}:unit{n}</c> FORMAT this predicate decodes — <see cref="DeviceIdSuffixPrefix"/> and
    /// <see cref="LooksLikeADeviceInstanceId"/> — are declared here, beside <see cref="DeviceInstanceId"/>,
    /// which MINTS that same format. A predicate about a format belongs with the format. What made the move
    /// <i>safe</i> is a different fact and must not be confused with it: the third symbol lives in the
    /// contract assembly at the bottom of the reference graph, which every project in this solution already
    /// references — so nothing that could call this before has lost the ability.</para>
    ///
    /// <para>🔴 <b>Fix round 2, N-2 — the earlier version was OVER-BROAD, and the doc that described it called
    /// the property "a guarantee rather than a hope". It was neither.</b> It asked only that the id START with
    /// <c>{bus}:unit</c> and END in digits, so bus <c>line1</c> claimed <c>line1:unitA:unit3</c> — which is a
    /// legitimate device of the DIFFERENT bus <c>line1:unitA</c>, a legal bus name because
    /// <see cref="ValidateBusInstanceId"/> reserves only an all-DIGIT suffix. Saving <c>line1</c> released that
    /// device's machine claim while its driver kept polling and its store row stayed, with nothing said until a
    /// restart.</para>
    ///
    /// <para><b>What the predicate actually promises now, stated as the arithmetic instead of as a
    /// guarantee:</b> the separator must be the LAST <see cref="DeviceIdSuffixPrefix"/> in the string AND must
    /// sit exactly where this bus's name ends, so an id can belong to at most one bus — the longest name that
    /// can precede its final <c>:unit</c>. That is a property of this function, checkable by reading it, rather
    /// than a property of a naming rule elsewhere that happens not to cover the case. The old wording rested on
    /// <see cref="ValidateBusInstanceId"/> making <c>line1:unit3</c> underivable by anything but <c>line1</c>,
    /// which is true, and then generalised it to a shape the rule never covered.</para>
    ///
    /// <para><b>Inherited, not invented:</b> the over-broad form was byte-identical to D-7a's
    /// <c>SweepGhosts</c>, which is why N-3's redirection was part of that fix — closing it in one place and
    /// leaving the original is the exact half-sweep principle 3 exists to refuse.</para>
    /// </summary>
    public static bool IsInBusNamespace(string busInstanceId, string instanceId)
    {
        var normalizedBus = DriverKinds.Normalize(busInstanceId);
        var normalized = DriverKinds.Normalize(instanceId);

        if (string.Equals(normalized, normalizedBus, StringComparison.Ordinal)) return true;

        // The derived shape at all (a non-empty, all-decimal suffix after the LAST ":unit").
        if (!LooksLikeADeviceInstanceId(normalized)) return false;

        // 🔴 N-2 — and the separator must be THIS bus's, not any earlier one. `LastIndexOf` rather than
        // `IndexOf`: DeviceInstanceId appends, so the separator a device's own bus contributed is always the
        // last one. StartsWith stays because position alone does not prove the prefix matches (bus "abcde" and
        // id "xyzab:unit3" agree on length and on nothing else).
        return normalized.LastIndexOf(DeviceIdSuffixPrefix, StringComparison.Ordinal) == normalizedBus.Length
               && normalized.StartsWith(normalizedBus, StringComparison.Ordinal);
    }

    /// <summary>
    /// 🔴 Task D-7a — <b>the bound blueprint §10 item 2 requires a write to be sized against: the LARGEST
    /// <see cref="ModbusRegisterMap.WorstCaseBusHoldMs"/> among the devices sharing one bus, not the writing
    /// device's own.</b>
    ///
    /// <para>A write queues behind whichever device currently holds the arbitration lock, and the worst case is
    /// therefore the worst case of the WORST sibling — 16 000 ms at the map's defaults, about two hours at the
    /// maxima the map itself accepts. Computed here, over the same fanned-out device list
    /// <see cref="WarnAboutDevicesThatCanMonopoliseTheBus"/> already warns from, so the number an operator is
    /// warned with and the number a write is bounded by are the same arithmetic on the same inputs rather than
    /// two derivations that can disagree.</para>
    ///
    /// <para>0 for an empty list, which <see cref="FanOut"/> can never return (an empty <c>devices</c> array is
    /// refused) — stated so a caller does not have to guess what a degenerate input means.</para>
    /// </summary>
    public static long MaxWorstCaseBusHoldMs(IReadOnlyList<ModbusBusDevice> devices)
    {
        ArgumentNullException.ThrowIfNull(devices);

        long worst = 0;
        foreach (var device in devices)
        {
            if (device.Map.WorstCaseBusHoldMs > worst) worst = device.Map.WorstCaseBusHoldMs;
        }

        return worst;
    }
}
