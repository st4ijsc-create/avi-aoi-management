using System.Text.Json;

namespace St4i.EdgeCore.Drivers.Modbus;

/// <summary>
/// 🔴 Task D-7a (.superpowers/sdd/2026-08-02-dotD-modbus-rtu-blueprint/task-7a-brief.md) — <b>how a
/// configuration file declares a Modbus RTU BUS, and the one field that tells RTU from TCP.</b>
///
/// <para>Before this type, <c>connectors.json</c> could not express multidrop at all: a Modbus entry's
/// <c>settings</c> was a register map and nothing else, the transport came from process-wide environment
/// variables, and the only reachable driver was <see cref="ModbusTcpDriver"/>. This is the schema half of
/// closing that; <c>St4i.EngineApi.Config.ConnectorsJsonRegistration</c> is the dispatch half and
/// <c>ModbusMultidropRegistration</c> is the fan-out.</para>
///
/// <para><b>The document.</b> One <c>connectors.json</c> entry, whose <c>settings</c> value is a bus:</para>
/// <code>
/// {
///   "id": "line1",                      // 🔴 the BUS's connector instance id — each device derives its own
///   "kind": "Modbus",                   //    from it, {id}:unit{n}
///   "settings": {
///     "transport": "rtu-gateway",       // 🔴 THE DISCRIMINATOR — absent means Modbus TCP, exactly as today
///     "host": "192.168.1.50",
///     "port": 4001,
///     "devices": [
///       { "machineCode": "M1", "unitId": 1, "pollIntervalMs": 1000, "readTimeoutMs": 300, "registers": [ … ] },
///       { "machineCode": "M2", "unitId": 2, "pollIntervalMs": 1000, "readTimeoutMs": 300, "registers": [ … ] }
///     ]
///   }
/// }
/// </code>
///
/// <para><b>🔴 Why the discriminator is a NEW OPTIONAL FIELD rather than a new <c>kind</c>.</b> A
/// <c>"kind": "ModbusRtu"</c> would have been simpler to dispatch and is wrong for a reason
/// <see cref="ModbusRtuDriver.Kind"/> already records: <see cref="St4i.Connector.Abstractions.Models.DriverKinds"/>'
/// five strings are already on the wire, in real installs' <c>assets.db</c>, in slot labels and therefore in
/// alarm <c>TargetId</c>s. RTU and TCP are two transports for ONE protocol; minting a sixth kind would fork the
/// operator-visible vocabulary for a distinction the operator does not make, and would need a store migration
/// for a value no row has ever held. Making the field OPTIONAL is what makes the compatibility rule literally
/// true rather than argued: a <c>settings</c> document with no <c>transport</c> takes byte-for-byte the path it
/// took before this task, and there is exactly one <c>if</c> between the two.</para>
///
/// <para><b>🔴 What a partial failure does, stated because the brief requires it.</b> Three independent
/// levels, and each one contains the damage at its own level:
/// <list type="bullet">
/// <item><description>A malformed <b>entry</b> in <c>connectors.json</c> (bad <c>kind</c>, missing
/// <c>settings</c>) is skipped by <c>ConnectorsConfig.Load</c> with a named warning; every other entry still
/// loads. Pre-existing, unchanged.</description></item>
/// <item><description>A malformed <b>bus</b> — this type refusing, or <see cref="ModbusMultidropMap.FanOut"/>
/// throwing on a duplicate slave address, a duplicate machine code, a bus-level field beside <c>devices</c>, or
/// any single device's map — disables <b>that whole bus</b> for the run and logs why. Not that one device: a
/// bus whose addressing is ambiguous cannot be partially trusted, because the failure modes it refuses
/// (two devices at one address) are precisely the ones that produce a plausible wrong number rather than an
/// error. Every OTHER connector, including another RTU bus in the same file, is unaffected.</description></item>
/// <item><description>A <b>device</b> that parses but cannot register (its machine is already claimed) is
/// skipped with a warning naming the incumbent; every other device on the same bus registers and polls. That
/// is D-4's fan-out contract, unchanged.</description></item>
/// </list></para>
/// </summary>
/// <param name="Transport">The normalised transport token — always <see cref="GatewayTransport"/> for a value
/// this type returns, because it is the only one this build can open (see <see cref="Parse"/>).</param>
/// <param name="Host">The RTU-over-TCP gateway's host. NOT a Modbus TCP endpoint: the device on the far side
/// speaks RTU framing over a serial line the gateway owns.</param>
/// <param name="Port">The gateway's TCP port. Serial device servers conventionally expose 4001, 4002, … one
/// per physical line; this product has no default for it and requires it explicitly, because guessing which
/// line an operator meant is exactly the mistake that puts a write on the wrong bus.</param>
public sealed record ModbusRtuBusSettings(string Transport, string Host, int Port)
{
    /// <summary>The property whose mere PRESENCE routes a Modbus entry to the RTU path. Named once here so the
    /// parser, the "is this an RTU entry" peek and every message about it cannot drift.</summary>
    public const string TransportProperty = "transport";

    /// <summary>RTU framing over a TCP socket to a serial device server (Moxa/USR-class gateway). The one
    /// transport this build can actually open — see <see cref="Parse"/>.</summary>
    public const string GatewayTransport = "rtu-gateway";

    /// <summary>🔴 RTU framing over a directly-attached COM port. <b>Accepted by the schema and REFUSED by this
    /// build, with the reason</b> — see <see cref="Parse"/>. Named as a constant rather than left as a magic
    /// string in one error message because the message has to be able to say what the operator wrote.</summary>
    public const string SerialTransport = "rtu-serial";

    /// <summary>
    /// Whether <paramref name="settingsJson"/> declares a transport at all — i.e. whether this Modbus entry is
    /// an RTU BUS rather than the TCP connector every pre-D-7a entry is.
    ///
    /// <para><b>Never throws, and answers <see langword="false"/> for anything it cannot read.</b> This is a
    /// ROUTING question asked before validation, by <c>ConnectorsJsonRegistration</c> and by
    /// <c>ConnectorsConfig.ResolveEntries</c>'s registration-key resolver — and a document too malformed to
    /// answer it must fall down the path that already knows how to report a malformed document (the TCP arm,
    /// whose factory reports the parse error as an ordinary rejection), never take a new path that would report
    /// it a second, different way.</para>
    /// </summary>
    public static bool DeclaresATransport(string? settingsJson)
    {
        if (string.IsNullOrWhiteSpace(settingsJson)) return false;

        try
        {
            using var document = JsonDocument.Parse(settingsJson);
            return document.RootElement.ValueKind == JsonValueKind.Object
                   && document.RootElement.TryGetProperty(TransportProperty, out var transport)
                   && transport.ValueKind == JsonValueKind.String
                   && !string.IsNullOrWhiteSpace(transport.GetString());
        }
        catch (JsonException)
        {
            return false;
        }
    }

    /// <summary>
    /// Parses the bus-level half of an RTU <c>settings</c> document. The DEVICE half is
    /// <see cref="ModbusMultidropMap.FanOut"/>'s and is deliberately not touched here — the same document is
    /// handed to both, and this method reads only the keys <see cref="ModbusMultidropMap"/> does not.
    ///
    /// <para><b>Throws</b> (<see cref="InvalidOperationException"/>/<see cref="JsonException"/>), exactly like
    /// every other parse function in this namespace, because the caller is the one that decides whether a
    /// malformed document disables this connector for the run or crashes the host — and every existing caller
    /// of the parse path already makes that decision.</para>
    ///
    /// <para>🔴 <b><see cref="SerialTransport"/> is refused, and the refusal is a deployment fact rather than a
    /// missing feature.</b> The serial link exists, works and is tested — <c>SerialPortBusLink</c> in
    /// <c>St4i.EdgeCore.Serial</c>, built by D-3. What does not exist is a build of the engine that carries it:
    /// Đợt D §6 scopes <c>System.IO.Ports</c> to that one project so a gateway deployment does not acquire a
    /// serial dependency, and <c>SerialDependencyScopingTests</c> pins that <c>St4i.EngineApi</c>'s own build
    /// output contains no <c>System.IO.Ports.dll</c>. Referencing it from the engine is a one-line project
    /// change that inverts a deliberately-pinned deployment assertion, which is a decision about what this
    /// product ships rather than about how this file parses. So the token is recognised and answered with the
    /// truth: this build cannot open a COM port. <b>A named refusal is the opposite of a stub</b> — an operator
    /// who writes <c>COM3</c> is told exactly why it cannot work and what does, instead of being told the
    /// transport is unknown or, worse, watching a connector fail to start for no stated reason.</para>
    /// </summary>
    public static ModbusRtuBusSettings Parse(string settingsJson)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(settingsJson);

        using var document = JsonDocument.Parse(settingsJson);
        var root = document.RootElement;

        if (root.ValueKind != JsonValueKind.Object)
        {
            throw new InvalidOperationException(
                $"Modbus RTU bus: the connector's 'settings' must be a JSON object (got {root.ValueKind}).");
        }

        if (!root.TryGetProperty(TransportProperty, out var transportProperty)
            || transportProperty.ValueKind != JsonValueKind.String
            || string.IsNullOrWhiteSpace(transportProperty.GetString()))
        {
            throw new InvalidOperationException(
                $"Modbus RTU bus: '{TransportProperty}' must be a non-blank string. Omit it entirely for an " +
                $"ordinary Modbus TCP connector; set it to '{GatewayTransport}' for an RTU bus behind a serial " +
                "gateway.");
        }

        var transport = transportProperty.GetString()!.Trim();

        if (string.Equals(transport, SerialTransport, StringComparison.OrdinalIgnoreCase))
        {
            throw new InvalidOperationException(
                $"Modbus RTU bus: transport '{SerialTransport}' (a directly-attached COM port) is not available " +
                "in this build. The serial link itself exists and is tested, but the engine is deliberately built " +
                "WITHOUT the System.IO.Ports dependency so that a gateway-only deployment does not carry it " +
                "(Đợt D §6, pinned by SerialDependencyScopingTests) — so there is no code in this process that " +
                $"can open a COM port. Put the RS-485 segment behind a serial device server and use " +
                $"'{GatewayTransport}' with that gateway's host and port.");
        }

        if (!string.Equals(transport, GatewayTransport, StringComparison.OrdinalIgnoreCase))
        {
            throw new InvalidOperationException(
                $"Modbus RTU bus: unknown transport '{transport}'. This build understands '{GatewayTransport}' " +
                $"(RTU framing over a TCP serial gateway); '{SerialTransport}' is recognised but unavailable — see " +
                "the message it produces for why.");
        }

        if (!root.TryGetProperty("host", out var hostProperty)
            || hostProperty.ValueKind != JsonValueKind.String
            || string.IsNullOrWhiteSpace(hostProperty.GetString()))
        {
            throw new InvalidOperationException(
                $"Modbus RTU bus: '{GatewayTransport}' requires a non-blank 'host' — the serial gateway's " +
                "address. This is NOT a Modbus TCP endpoint: the devices behind it speak RTU framing on a serial " +
                "line the gateway owns.");
        }

        if (!root.TryGetProperty("port", out var portProperty)
            || portProperty.ValueKind != JsonValueKind.Number
            || !portProperty.TryGetInt32(out var port)
            || port is < 1 or > 65535)
        {
            throw new InvalidOperationException(
                $"Modbus RTU bus: '{GatewayTransport}' requires a 'port' between 1 and 65535 — the gateway's TCP " +
                "port for THIS serial line. Serial device servers expose one port per physical line (4001, 4002, " +
                "…), so there is no default that could be right: guessing which line was meant is how a write " +
                "reaches the wrong bus.");
        }

        return new ModbusRtuBusSettings(GatewayTransport, hostProperty.GetString()!.Trim(), port);
    }

    /// <summary>The shared bus's key, built by the link type's own <c>CreateBusKey</c> and never by string
    /// interpolation here — <see cref="ModbusBusRegistry"/>'s doc comment records why that rule exists and what
    /// a hand-built key costs (two connectors silently riding one link they were not configured for).</summary>
    public string BusKey => GatewayTcpBusLink.CreateBusKey(Host, Port);

    /// <summary>The opener a <see cref="ModbusRtuConnectorFactory"/> is built with. Deferred, not connected:
    /// the socket is dialled lazily inside the bus's first transaction, which is what keeps
    /// <see cref="St4i.Connector.Abstractions.IConnectorFactory.TryCreate"/>'s "no I/O" contract true all the
    /// way down.</summary>
    public Func<CancellationToken, Task<IModbusBusLink>> Opener() => GatewayTcpBusLink.Opener(Host, Port);
}
