using System.IO.Ports;
using System.Text.Json;

namespace St4i.EdgeCore.Drivers.Modbus;

/// <summary>
/// 🔴 Task D-7c (.superpowers/sdd/2026-08-02-dotD-modbus-rtu-blueprint/task-7c-brief.md) — <b>how a
/// configuration file declares a Modbus RTU bus on a DIRECTLY-ATTACHED RS-485 line.</b> The serial twin of
/// <see cref="ModbusRtuBusSettings"/>, and the reason it is a separate type in a separate assembly rather than
/// a third arm of that one.
///
/// <para><b>🔴 Why this cannot live beside <see cref="ModbusRtuBusSettings"/>, which is where the obvious
/// design puts it.</b> <see cref="ModbusRtuBusSettings"/> is in <c>St4i.EdgeCore</c>;
/// <see cref="SerialLineSettings"/> and <see cref="SerialPortBusLink"/> are in <c>St4i.EdgeCore.Serial</c>,
/// which <i>references</i> <c>St4i.EdgeCore</c>. An extra arm inside
/// <see cref="ModbusRtuBusSettings.Parse"/> would therefore be a <b>circular project reference</b>, and it
/// could only be broken by moving the serial link INTO <c>St4i.EdgeCore</c> — which is exactly the migration
/// <c>SerialDependencyScopingTests.TheRtuFramingLayersOwnAssembly_ReferencesNeitherSystemIoPorts_NorTheSerialAssembly</c>
/// exists to forbid, because it would put <c>System.IO.Ports</c> into the RTU framing layer and therefore into
/// every consumer of it, including the ones that only ever speak to a gateway. The seam is not negotiable:
/// <see cref="SerialLineSettings"/> exposes <see cref="System.IO.Ports.Parity"/> and
/// <see cref="System.IO.Ports.StopBits"/> in its own public surface, so <b>no parser for it can be compiled
/// into <c>St4i.EdgeCore</c> at all</b>.
///
/// <para>What ships instead is the symmetry: the gateway half of the schema lives next to
/// <see cref="GatewayTcpBusLink"/>, the serial half lives next to <see cref="SerialPortBusLink"/>, and the
/// <b>switch between them lives in the composition root</b>
/// (<c>St4i.EngineApi.Config.ConnectorsJsonRegistration.RegisterRtuBus</c>), which is the only layer that is
/// allowed to know both transports exist. Neither settings type names the other.</para></para>
///
/// <para><b>The document.</b> One <c>connectors.json</c> entry whose <c>settings</c> value is a bus:</para>
/// <code>
/// {
///   "id": "rs485-line1",                //  the BUS's connector instance id — each device derives {id}:unit{n}
///   "kind": "Modbus",                   //  RTU and TCP are two transports for ONE kind — see ModbusRtuDriver.Kind
///   "settings": {
///     "transport": "rtu-serial",        // 🔴 THE DISCRIMINATOR — "rtu-gateway" is the TCP serial device server
///     "portName": "COM3",               //  required; the ONLY required serial field
///     "baudRate": 19200,                //  optional, default 19200  (MODBUS over Serial Line V1.02 §2.5.1)
///     "parity":   "even",               //  optional, default "even" (§2.5.1 — NOT SerialPort's own "none")
///     "dataBits": 8,                    //  optional, default 8      (8 is the only legal value for RTU)
///     "stopBits": 1,                    //  optional, default 1
///     "devices": [
///       { "machineCode": "M1", "unitId": 1, "pollIntervalMs": 1000, "readTimeoutMs": 300, "registers": [ … ] },
///       { "machineCode": "M2", "unitId": 2, "pollIntervalMs": 1000, "readTimeoutMs": 300, "registers": [ … ] }
///     ]
///   }
/// }
/// </code>
///
/// <para><b>🔴 It composes with D-7a's multidrop fan-out UNCHANGED, and that is a structural fact rather than a
/// hope.</b> The bus-level parser (this type) and the device-level parser
/// (<see cref="ModbusMultidropMap.FanOut"/>) read <b>disjoint key sets</b> of the SAME document:
/// <see cref="ModbusMultidropMap"/> reads <c>devices</c> and refuses only device-level keys at the root, so the
/// five serial keys above pass through it untouched — exactly as <c>host</c>/<c>port</c> already do for the
/// gateway transport. A serial bus is therefore the same N-device fan-out with a different opener, and the
/// only thing that changes between the two transports is the <c>(busKey, openLink)</c> pair the composition
/// root hands to <see cref="ModbusRtuConnectorFactory"/> — whose signature names no type from either
/// transport.</para>
///
/// <para><b>🔴 The line parameters are per-BUS and every one of them is in the bus key.</b> That is
/// <see cref="SerialLineSettings"/>'s own decision and this type merely feeds it: two devices on one wire
/// cannot declare different baud rates, because they are two elements of one <c>devices</c> array under one
/// set of line parameters. Two SEPARATE connector entries naming the same port with different framing get two
/// keys, two buses and two attempts to open one port — the second of which fails loudly (see
/// <see cref="SerialPortBusLink.CreateBusKey"/> and <see cref="SerialPortBusLink.DescribeOpenFailure"/>), which
/// is a refusal rather than a silent adoption of whichever configuration constructed the bus first.</para>
///
/// <para>🔴 <b>WHAT IS REFUSED AT PARSE TIME, AND WHAT IS DELIBERATELY NOT — the distinction the brief asks
/// for, stated as the rule that produced it.</b> This parser refuses only what is <b>decidably wrong about the
/// document</b>: a missing/blank <c>portName</c>, a non-positive <c>baudRate</c>, a <c>dataBits</c> that is not
/// 8, an unknown <c>parity</c>, a <c>stopBits</c> that is not 1 or 2, and a gateway field (<c>host</c>/
/// <c>port</c>) on a serial bus. Every one of those is a configuration that <b>could never have worked on any
/// machine</b>.
///
/// <para><b>Whether the named port EXISTS ON THIS MACHINE is not one of them.</b> It is a start-up/runtime
/// issue, surfaced by <see cref="SerialPortBusLink.OpenAsync"/> as
/// <see cref="SerialPortUnavailableException"/> on the first transaction, and it is deliberately not a parse
/// refusal for three reasons that each hold on their own:
/// <list type="number">
/// <item><description>A configuration file is written for a SITE and deployed to an image. <c>COM7</c> absent
/// during a config review on a laptop is not an error; the same file on the panel PC is correct. A parse-time
/// refusal would make one connectors.json valid or invalid depending on which machine read it, which is the
/// same "a green number means different things on different machines" trap blueprint §8.1 records for the
/// test suite.</description></item>
/// <item><description>A USB RS-485 adapter that is unplugged at boot must come back <b>when it is plugged
/// in</b>. <see cref="SerialPortBusLink"/>'s own contract is that the bus faults its link and the next
/// transaction calls the opener again, forever, with the driver reporting <c>Degraded</c> meanwhile. A
/// parse-time refusal would replace that with "restart the host", which is strictly worse and is a regression
/// against the transport that already ships.</description></item>
/// <item><description><see cref="St4i.Connector.Abstractions.IConnectorFactory.TryCreate"/>'s contract is that
/// it performs NO I/O. Deciding presence means asking the operating system, on the registration path, on every
/// startup.</description></item>
/// </list>
/// What the operator gets instead is a failure message that <b>says which of the three it was</b> — see
/// <see cref="SerialPortBusLink.DescribeOpenFailure"/>, which is where D-3's recorded message defect is
/// closed.</para></para>
///
/// <para>🔴 <b>THE HARDWARE LIMIT, restated here because this is the type an operator's configuration lands
/// in.</b> Blueprint §9: <b>this product supports ONLY RS-485 adapters with AUTOMATIC direction control</b>
/// (auto-DE / TXDEN). It does not drive a transmit-enable line, and it cannot:
/// <see cref="System.IO.Ports.SerialPort"/> exposes no transmit-complete signal, so a software RTS turnaround
/// could only ever be a timing guess, and a wrong guess corrupts another device's frame on a shared bus. An
/// installation using a manual-DE adapter will not transmit at all — see
/// <see cref="SerialPortBusLink.CreatePort"/> for why that is the safe failure. <see cref="DescribeLimit"/> is
/// the operator-facing form, and the composition root logs it once per serial bus at startup.</para>
///
/// <para>🔴 <b>AND WHAT HAS NEVER HAPPENED, stated so no reader has to infer it.</b> <b>No Modbus frame has
/// ever traversed this transport against real hardware.</b> D-3 measured the seam (exclusive open, cancellation
/// latency, the drain primitive, open/close cost) against a real COM port with a standalone probe, and D-6's
/// conformance work runs the RTU framing against an IN-MEMORY paired transport. Neither is a wire. Blueprint
/// §9 calls the bench acceptance step out explicitly and it is still outstanding after this task.</para>
/// </summary>
/// <param name="Transport">The normalised transport token — always
/// <see cref="ModbusRtuBusSettings.SerialTransport"/> for a value this type returns.</param>
/// <param name="Line">The validated line parameters. Every field of it is in <see cref="BusKey"/>.</param>
public sealed record ModbusRtuSerialBusSettings(string Transport, SerialLineSettings Line)
{
    /// <summary>The COM port. Named <c>portName</c> rather than <c>port</c> deliberately: <c>port</c> already
    /// means the GATEWAY transport's TCP port in the same <c>settings</c> position, and one key meaning two
    /// unrelated things across two transports is how an operator ends up on the wrong line. It also matches
    /// <see cref="SerialPort.PortName"/>, which is what a wiring diagram calls it.</summary>
    public const string PortNameProperty = "portName";

    public const string BaudRateProperty = "baudRate";
    public const string ParityProperty = "parity";
    public const string DataBitsProperty = "dataBits";
    public const string StopBitsProperty = "stopBits";

    /// <summary>The five parity tokens, in <see cref="Parity"/>'s own order. A STRING rather than the enum's
    /// ordinal because <c>"parity": 2</c> is unreadable and, worse, silently plausible — <see cref="Parity"/>'s
    /// zero value is <see cref="Parity.None"/>, so a mistyped or defaulted number lands on the one setting that
    /// makes the character 10 bits wide instead of 11.</summary>
    private static readonly (string Token, Parity Value)[] ParityTokens =
    {
        ("none", Parity.None), ("odd", Parity.Odd), ("even", Parity.Even),
        ("mark", Parity.Mark), ("space", Parity.Space),
    };

    /// <summary>🔴 Fix round 1, review M-2 — every root key an <c>rtu-serial</c> document may carry. Anything
    /// else is refused rather than ignored (see <see cref="ModbusRtuBusSettings.RefuseUnknownBusLevelKey"/>).
    /// <see cref="ModbusMultidropMap.DevicesProperty"/> is in the list because the two parsers read the SAME
    /// document and this one must not refuse the half it does not read. The gateway transport's own
    /// <c>host</c>/<c>port</c> are deliberately NOT here — they are refused earlier, by a rule that says where
    /// they belong instead of merely that they are unrecognised.</summary>
    private static readonly string[] SerialBusKeys =
    {
        ModbusRtuBusSettings.TransportProperty, PortNameProperty, BaudRateProperty, ParityProperty,
        DataBitsProperty, StopBitsProperty, ModbusMultidropMap.DevicesProperty,
    };

    /// <summary>
    /// Parses the bus-level half of an <c>rtu-serial</c> <c>settings</c> document. The DEVICE half is
    /// <see cref="ModbusMultidropMap.FanOut"/>'s and is deliberately not touched here — the same document is
    /// handed to both, and this method reads only the keys <see cref="ModbusMultidropMap"/> does not.
    ///
    /// <para><b>Throws</b> (<see cref="InvalidOperationException"/>/<see cref="JsonException"/>), exactly like
    /// <see cref="ModbusRtuBusSettings.Parse"/> and every other parse function in this namespace, because the
    /// caller is the one that decides whether a malformed document disables this connector for the run or
    /// crashes the host. The <c>connectors.json</c> caller disables THAT BUS and nothing else.</para>
    /// </summary>
    public static ModbusRtuSerialBusSettings Parse(string settingsJson)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(settingsJson);

        using var document = JsonDocument.Parse(settingsJson);
        var root = document.RootElement;

        if (root.ValueKind != JsonValueKind.Object)
        {
            throw new InvalidOperationException(
                $"Modbus RTU serial bus: the connector's 'settings' must be a JSON object (got {root.ValueKind}).");
        }

        if (!root.TryGetProperty(ModbusRtuBusSettings.TransportProperty, out var transportProperty)
            || transportProperty.ValueKind != JsonValueKind.String
            || string.IsNullOrWhiteSpace(transportProperty.GetString()))
        {
            throw new InvalidOperationException(
                $"Modbus RTU serial bus: '{ModbusRtuBusSettings.TransportProperty}' must be a non-blank string. " +
                $"Set it to '{ModbusRtuBusSettings.SerialTransport}' for a directly-attached RS-485 line, or to " +
                $"'{ModbusRtuBusSettings.GatewayTransport}' for a line behind a serial device server; omit it " +
                "entirely for an ordinary Modbus TCP connector.");
        }

        var transport = transportProperty.GetString()!.Trim();
        if (!string.Equals(transport, ModbusRtuBusSettings.SerialTransport, StringComparison.OrdinalIgnoreCase))
        {
            // Reachable only from a direct caller: the composition root switches on the token BEFORE choosing a
            // parser. Named rather than left to fail on a missing 'portName', because "this is the wrong parser
            // for that document" and "your document is missing a field" have completely different remedies.
            throw new InvalidOperationException(
                $"Modbus RTU serial bus: this parser reads the '{ModbusRtuBusSettings.SerialTransport}' transport " +
                $"(a directly-attached COM port), but the document declares '{transport}'. " +
                $"'{ModbusRtuBusSettings.GatewayTransport}' is read by ModbusRtuBusSettings.Parse instead.");
        }

        // 🔴 The gateway's own fields, refused on a serial bus. Same class of defect as
        // ModbusMultidropMap's "a device-level key at the bus root": the key is silently IGNORED, so the file on
        // disk and the configuration actually running are two different things, and the operator's mental model
        // ("I set the port to 4001") is wrong in the one direction that puts a write on a line they did not mean.
        RefuseGatewayField(root, "host");
        RefuseGatewayField(root, "port");

        // 🔴 Fix round 1, review M-2 — AFTER the cross-transport refusals above and BEFORE every value check
        // below, and the ordering was decided by a failing test rather than by argument.
        //
        // AFTER, because 'host'/'port' must be answered by the rule that says WHICH TRANSPORT they belong to,
        // never by "unrecognised".
        //
        // BEFORE the required-'portName' check, because that is where the first draft put it and the
        // `"portname":"COM3"` row went red: the operator was told *"'portName' is required"* while looking at a
        // document that visibly contains a portname. A true sentence that reads as a lie is D-5's I-1 shape, and
        // it is exactly what this fix exists to remove — so the misspelling is named first, and only a document
        // with no such key at all falls through to "required".
        ModbusRtuBusSettings.RefuseUnknownBusLevelKey(root, ModbusRtuBusSettings.SerialTransport, SerialBusKeys);

        if (!root.TryGetProperty(PortNameProperty, out var portNameProperty)
            || portNameProperty.ValueKind != JsonValueKind.String
            || string.IsNullOrWhiteSpace(portNameProperty.GetString()))
        {
            throw new InvalidOperationException(
                $"Modbus RTU serial bus: '{ModbusRtuBusSettings.SerialTransport}' requires a non-blank " +
                $"'{PortNameProperty}' — the COM port this RS-485 segment is wired to, e.g. \"COM3\". There is no " +
                "default, because a machine with several adapters has several ports and guessing which segment " +
                "was meant is how a write reaches the wrong bus.");
        }

        var baudRate = ReadOptionalPositiveInt(root, BaudRateProperty, SerialLineSettings.DefaultBaudRate);
        var dataBits = ReadOptionalPositiveInt(root, DataBitsProperty, SerialLineSettings.DefaultDataBits);
        var parity = ReadOptionalParity(root);
        var stopBits = ReadOptionalStopBits(root);

        SerialLineSettings line;
        try
        {
            line = new SerialLineSettings(
                portNameProperty.GetString()!, baudRate, parity, dataBits, stopBits);
        }
        catch (ArgumentException ex)
        {
            // 🔴 <b>MUTATION-FOUND, and the finding is that a check here was a SECOND statement of one rule.</b>
            // This method used to refuse `dataBits != 8` itself, on the reasoning that an operator wrote a JSON
            // key and must be answered about that key rather than about a constructor parameter. A mutation
            // deleting that check SURVIVED the whole suite — because <see cref="SerialLineSettings"/>'s own
            // refusal already carries the identical content (Modbus RTU is 8 data bits by definition; 7 is ASCII
            // framing, which blueprint §9 puts out of scope) AND names the same word, `dataBits`, since the
            // constructor parameter and the JSON key coincide. Two statements of one remedy is precisely the
            // shape this codebase records as drifting, so the duplicate is gone and the rule is stated once,
            // beside the type that owns it.
            //
            // What that makes this branch: not an unreachable "assert the failure" guard, but the ORDINARY path
            // for a `dataBits` this parser deliberately no longer second-guesses — reached and asserted by
            // AMalformedSerialBus_IsRefusedNamingTheFieldThatIsWrong's dataBits row. It still exists for the
            // "cannot happen" half too (a future line parameter added to SerialLineSettings and not to this
            // parser), and blueprint §8.1's rule is what it answers: when it happens anyway, the bus is refused
            // with the constructor's own reason attached rather than letting an ArgumentOutOfRangeException
            // escape a method documented to throw InvalidOperationException/JsonException.
            throw new InvalidOperationException(
                $"Modbus RTU serial bus: the line parameters were refused by SerialLineSettings — {ex.Message}", ex);
        }

        return new ModbusRtuSerialBusSettings(ModbusRtuBusSettings.SerialTransport, line);
    }

    /// <summary>The shared bus's key, built by the link type's own <see cref="SerialPortBusLink.CreateBusKey"/>
    /// and never by string interpolation here — <see cref="ModbusBusRegistry"/>'s doc comment records why that
    /// rule exists and what a hand-built key costs. Every line parameter is folded in, so two connectors that
    /// disagree about baud rate are two buses rather than one silent misconfiguration.</summary>
    public string BusKey => SerialPortBusLink.CreateBusKey(Line);

    /// <summary>The opener a <see cref="ModbusRtuConnectorFactory"/> is built with. Deferred, not opened: the
    /// port is opened lazily inside the bus's first transaction, which is what keeps
    /// <see cref="St4i.Connector.Abstractions.IConnectorFactory.TryCreate"/>'s "no I/O" contract true all the
    /// way down — and is what makes an absent adapter a degraded device rather than a refused
    /// configuration.</summary>
    public Func<CancellationToken, Task<IModbusBusLink>> Opener() => SerialPortBusLink.Opener(Line);

    /// <summary>
    /// 🔴 The operator-facing statement of blueprint §9's hardware limit, logged once per serial bus by the
    /// composition root at startup.
    ///
    /// <para>It is here, on the settings type, rather than only in the blueprint, because the person who needs
    /// it is the person who just wrote <c>"portName": "COM3"</c> — and the failure it warns about is silent: a
    /// manual-DE adapter does not throw, it simply never transmits, which reads exactly like a wiring fault or
    /// a wrong unit id.</para>
    /// </summary>
    public string DescribeLimit() =>
        $"Modbus RTU serial bus on {Line.Describe()}: this product drives NO transmit-enable line, so it " +
        "supports ONLY RS-485 adapters with AUTOMATIC direction control (auto-DE / TXDEN). System.IO.Ports " +
        "exposes no transmit-complete signal, so a software RTS turnaround could only be a timing guess and a " +
        "wrong guess corrupts another device's frame on this same segment. An adapter that needs DE toggled " +
        "manually will not transmit at all on this line (RTS is left deasserted, which holds such a " +
        "transceiver in RECEIVE — the safe failure, not a working one).";

    private static void RefuseGatewayField(JsonElement root, string field)
    {
        if (!root.TryGetProperty(field, out _)) return;

        throw new InvalidOperationException(
            $"Modbus RTU serial bus: '{field}' belongs to the '{ModbusRtuBusSettings.GatewayTransport}' transport " +
            $"(a serial device server reached over TCP) and does NOTHING on a directly-attached line. A serial bus " +
            $"names its COM port with '{PortNameProperty}'. Remove '{field}', or change " +
            $"'{ModbusRtuBusSettings.TransportProperty}' to '{ModbusRtuBusSettings.GatewayTransport}' if this " +
            "segment really is behind a gateway.");
    }

    private static int ReadOptionalPositiveInt(JsonElement root, string property, int fallback)
    {
        if (!root.TryGetProperty(property, out var element)) return fallback;

        if (element.ValueKind != JsonValueKind.Number || !element.TryGetInt32(out var value) || value <= 0)
        {
            throw new InvalidOperationException(
                $"Modbus RTU serial bus: '{property}' must be a positive whole number when present (default " +
                $"{fallback}).");
        }

        return value;
    }

    private static Parity ReadOptionalParity(JsonElement root)
    {
        if (!root.TryGetProperty(ParityProperty, out var element)) return SerialLineSettings.DefaultParity;

        if (element.ValueKind == JsonValueKind.String && element.GetString() is { } raw)
        {
            var token = raw.Trim();
            foreach (var (candidate, value) in ParityTokens)
            {
                if (string.Equals(token, candidate, StringComparison.OrdinalIgnoreCase)) return value;
            }
        }

        throw new InvalidOperationException(
            $"Modbus RTU serial bus: '{ParityProperty}' must be one of " +
            string.Join(", ", ParityTokens.Select(p => $"\"{p.Token}\"")) +
            $" (default \"{ParityTokens.First(p => p.Value == SerialLineSettings.DefaultParity).Token}\", which is " +
            "MODBUS over Serial Line V1.02 §2.5.1's required default — NOT SerialPort's own \"none\"). A parity " +
            "mismatch never throws on the wire: it surfaces as a device that simply never answers.");
    }

    private static StopBits ReadOptionalStopBits(JsonElement root)
    {
        if (!root.TryGetProperty(StopBitsProperty, out var element)) return SerialLineSettings.DefaultStopBits;

        if (element.ValueKind == JsonValueKind.Number && element.TryGetInt32(out var value))
        {
            if (value == 1) return StopBits.One;
            if (value == 2) return StopBits.Two;
        }

        throw new InvalidOperationException(
            $"Modbus RTU serial bus: '{StopBitsProperty}' must be 1 or 2 (default 1). 1.5 stop bits is defined " +
            "only for a 5-bit character, which RTU is not, and 0 is not a line a port can be opened on at all. " +
            "MODBUS over Serial Line V1.02 §2.5.1 wants 2 when 'parity' is \"none\", so that the character stays " +
            "11 bits wide; this product accepts what is declared rather than silently rewriting it.");
    }
}
