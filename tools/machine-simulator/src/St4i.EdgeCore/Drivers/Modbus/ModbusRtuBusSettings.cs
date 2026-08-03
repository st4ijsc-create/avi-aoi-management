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
/// this type returns. 🔴 Task D-7c: that is now a statement about which HALF OF THE SCHEMA this type reads, not
/// about what the product can open. The <see cref="SerialTransport"/> half is read by
/// <c>ModbusRtuSerialBusSettings</c> in <c>St4i.EdgeCore.Serial</c>, and both transports ship — see
/// <see cref="SerialTransport"/> for why the two parsers cannot be one.</param>
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

    /// <summary>🔴 RTU framing over a directly-attached COM port.
    ///
    /// <para><b>Task D-7c — this transport now SHIPS.</b> Until D-7c the token was accepted by the schema and
    /// refused by the build, because nothing that could open a COM port was referenced by any host. All three
    /// hosts now reference <c>St4i.EdgeCore.Serial</c> (the owner's ruling of 2026-08-03), and the document is
    /// read by <c>ModbusRtuSerialBusSettings</c> in that assembly — <b>not by <see cref="Parse"/> below</b>,
    /// which cannot see it: <c>St4i.EdgeCore.Serial</c> references <c>St4i.EdgeCore</c>, so an arm here would
    /// be a circular reference, and <c>SerialLineSettings</c> exposes <c>System.IO.Ports</c> types that must
    /// never enter this assembly. The switch between the two parsers lives in the composition root
    /// (<c>St4i.EngineApi.Config.ConnectorsJsonRegistration.RegisterRtuBus</c>).</para>
    ///
    /// <para>The constant stays HERE, beside <see cref="GatewayTransport"/>, because it is part of ONE
    /// schema's discriminator vocabulary: <see cref="ReadTransport"/> — the routing peek every caller uses —
    /// lives in this assembly and must be able to name both tokens, and a build with no serial assembly must
    /// still be able to say what an <c>rtu-serial</c> document is.</para></summary>
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
    /// 🔴 Task D-7c — <b>the transport token this document declares, verbatim (trimmed), or
    /// <see langword="null"/> if it declares none.</b> This is the routing peek the composition root switches
    /// on to choose between the gateway parser (this type) and the serial one
    /// (<c>ModbusRtuSerialBusSettings</c>, in <c>St4i.EdgeCore.Serial</c>).
    ///
    /// <para><b>Never throws, exactly like <see cref="DeclaresATransport"/>, and for the same reason:</b> this
    /// question is asked BEFORE validation, and a document too malformed to answer it must fall down the path
    /// that already knows how to report a malformed document rather than take a new one that reports it a
    /// second, different way.</para>
    ///
    /// <para><b>Returns the RAW token, not a normalised one.</b> The caller compares case-insensitively; what
    /// it must not lose is the operator's own spelling, because the message for an unknown transport has to be
    /// able to quote what they actually wrote. Normalising here would make "rtu-Gateway" and "rtu-gateway"
    /// indistinguishable in exactly the message whose job is to show the difference.</para>
    /// </summary>
    public static string? ReadTransport(string? settingsJson)
    {
        if (string.IsNullOrWhiteSpace(settingsJson)) return null;

        try
        {
            using var document = JsonDocument.Parse(settingsJson);
            if (document.RootElement.ValueKind != JsonValueKind.Object) return null;
            if (!document.RootElement.TryGetProperty(TransportProperty, out var transport)) return null;
            if (transport.ValueKind != JsonValueKind.String) return null;

            var raw = transport.GetString();
            return string.IsNullOrWhiteSpace(raw) ? null : raw.Trim();
        }
        catch (JsonException)
        {
            return null;
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
    /// <para>🔴 <b>Task D-7c — <see cref="SerialTransport"/> is still refused HERE, but the refusal changed
    /// meaning completely and the old wording was about to become a false record.</b> D-7a's message said the
    /// serial transport "is not available in this build", because no host referenced
    /// <c>St4i.EdgeCore.Serial</c>. That is no longer true: all three hosts reference it and a directly-attached
    /// RS-485 line ships. What this method refuses now is not a missing feature but <b>the wrong parser</b> —
    /// an <c>rtu-serial</c> document is read by <c>ModbusRtuSerialBusSettings</c>, which lives in
    /// <c>St4i.EdgeCore.Serial</c> and therefore cannot be reached from this assembly at all (that reference
    /// runs the other way; see <see cref="SerialTransport"/>). The composition root switches on
    /// <see cref="ReadTransport"/> BEFORE choosing a parser, so an operator can no longer produce this message
    /// through <c>connectors.json</c> — only a direct API caller can, and it tells them the one thing they need,
    /// which is where the other half of the schema lives.</para>
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
                $"Modbus RTU bus: this parser reads the '{GatewayTransport}' transport (RTU framing over a TCP " +
                $"serial device server), but the document declares '{SerialTransport}' — a directly-attached COM " +
                "port. That transport SHIPS; its settings are read by ModbusRtuSerialBusSettings.Parse in " +
                "St4i.EdgeCore.Serial, which this assembly cannot reference (the project reference runs the other " +
                "way, so that System.IO.Ports never enters the RTU framing layer). A connectors.json entry is " +
                "routed to the right parser by the composition root before either is called, so reaching this " +
                "message means a caller chose the parser by hand.");
        }

        if (!string.Equals(transport, GatewayTransport, StringComparison.OrdinalIgnoreCase))
        {
            throw new InvalidOperationException(
                $"Modbus RTU bus: unknown transport '{transport}'. This build understands '{GatewayTransport}' " +
                $"(RTU framing over a TCP serial gateway) and '{SerialTransport}' (a directly-attached COM port, " +
                "read by ModbusRtuSerialBusSettings in St4i.EdgeCore.Serial).");
        }

        // 🔴 Task D-7c — the SERIAL transport's own field, refused on a gateway bus. The sweep half of the same
        // rule ModbusRtuSerialBusSettings applies to 'host'/'port' in the other direction: a key that reads as
        // though it configures this bus and is silently IGNORED makes the file on disk and the configuration
        // actually running two different things. Fixing only one direction would be the "fixed one instance of a
        // class rather than sweeping it" failure blueprint §8.1 records.
        if (root.TryGetProperty("portName", out _))
        {
            throw new InvalidOperationException(
                $"Modbus RTU bus: 'portName' belongs to the '{SerialTransport}' transport (a directly-attached " +
                $"COM port) and does NOTHING on a '{GatewayTransport}' bus, whose line is owned by the device " +
                $"server named in 'host'. Remove 'portName', or change '{TransportProperty}' to " +
                $"'{SerialTransport}' if this segment really is wired straight into this machine.");
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
