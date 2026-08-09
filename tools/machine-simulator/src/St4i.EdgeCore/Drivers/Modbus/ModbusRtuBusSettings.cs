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

        // 🔴 Fix round 1, review M-2 — LAST, deliberately. Every refusal above is more specific than "I do not
        // know that key", so a document that trips one of them must get that message rather than this one. In
        // particular 'portName' is caught above by the cross-transport rule, which tells the operator which
        // transport it belongs to; reaching it through here would tell them only that it is unrecognised.
        RefuseUnknownBusLevelKey(root, GatewayTransport, GatewayBusKeys);

        return new ModbusRtuBusSettings(GatewayTransport, hostProperty.GetString()!.Trim(), port);
    }

    /// <summary>Every root key a <see cref="GatewayTransport"/> document may carry.
    /// <see cref="ModbusMultidropMap.DevicesProperty"/> is in the list because the two parsers read the SAME
    /// document and this one must not refuse the half it does not read.</summary>
    private static readonly string[] GatewayBusKeys =
    {
        TransportProperty, "host", "port", ModbusMultidropMap.DevicesProperty,
    };

    /// <summary>
    /// 🔴 Fix round 1, review M-2 — <b>a bus-level key this build does not recognise is REFUSED, not ignored,
    /// and a near-miss is named.</b> Shared by both bus-settings parsers: this one and
    /// <c>ModbusRtuSerialBusSettings</c> in <c>St4i.EdgeCore.Serial</c>, which calls it with its own key list.
    ///
    /// <para><b>The measured failure it closes.</b>
    /// <c>{"transport":"rtu-serial","portName":"COM31","baudrate":9600,"Parity":"none", …}</c> parsed cleanly to
    /// <c>modbus-rtu-serial:COM31:19200:8:E:1</c> — <see cref="System.Text.Json.JsonElement.TryGetProperty(string,out System.Text.Json.JsonElement)"/>
    /// is case-sensitive and nothing refused the two misspellings. <b>The operator asked for 9600-8-N-1 and got
    /// 19200-8-E-1.</b> That lands in the one place with no symptom: this file's own doc warns that "a parity
    /// mismatch never throws on the wire: it surfaces as a device that simply never answers", which is
    /// indistinguishable from a wiring fault or a wrong unit id.</para>
    ///
    /// <para><b>Why ONE implementation for two parsers in two assemblies.</b> The review graded this Minor for
    /// consistency with the pre-existing gateway parser; the coordinator's ruling is that the consistency is the
    /// argument for fixing rather than for matching, and that the two must not silently diverge. A shared method
    /// with a per-transport key list is what makes "they cannot diverge" structural instead of a promise —
    /// <c>St4i.EdgeCore.Serial</c> references this assembly, so the dependency runs the only direction it can.</para>
    ///
    /// <para><b>The near-miss half is the actionable half.</b> An unknown key that matches a known one
    /// case-insensitively is reported as <i>"did you mean 'baudRate'?"</i>, because the failure this closes is a
    /// misspelling of the operator's OWN key, not an invented one.</para>
    /// </summary>
    /// <param name="root">The already-validated <c>settings</c> object.</param>
    /// <param name="transportToken">Named in the message so an operator with two buses knows which one.</param>
    /// <param name="knownKeys">Every root key this transport's parser reads, plus the device half's own.</param>
    /// <exception cref="InvalidOperationException">A root key outside <paramref name="knownKeys"/>.</exception>
    public static void RefuseUnknownBusLevelKey(
        JsonElement root, string transportToken, IReadOnlyList<string> knownKeys)
    {
        ArgumentNullException.ThrowIfNull(knownKeys);

        foreach (var property in root.EnumerateObject())
        {
            var known = false;
            string? nearMiss = null;

            foreach (var candidate in knownKeys)
            {
                if (string.Equals(property.Name, candidate, StringComparison.Ordinal))
                {
                    known = true;
                    break;
                }

                if (string.Equals(property.Name, candidate, StringComparison.OrdinalIgnoreCase))
                {
                    nearMiss = candidate;
                }
            }

            if (known) continue;

            var suggestion = nearMiss is null
                ? $"Keys this transport understands: {string.Join(", ", knownKeys.Select(k => $"'{k}'"))}."
                : $"Did you mean '{nearMiss}'? Keys are case-SENSITIVE.";

            throw new InvalidOperationException(
                $"Modbus RTU bus ('{transportToken}'): '{property.Name}' is not a key this build reads, so it " +
                $"would have been SILENTLY IGNORED — and the bus would have run on defaults the document does " +
                $"not state. {suggestion}");
        }
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

    /// <summary>
    /// 🔴 <b>Task F-1 — the operator-facing statement of the ONE-HOST-PER-SEGMENT deployment constraint, for
    /// the transport on which nothing whatsoever enforces it.</b> Logged once per gateway bus by every
    /// composition root that registers one, exactly like <c>ModbusRtuSerialBusSettings.DescribeLimit</c> is
    /// for the serial transport's hardware limit.
    ///
    /// <para><b>Why this exists on the GATEWAY arm and not on the serial one.</b> On a directly attached COM
    /// line a second holder is refused by the operating system and meets
    /// <c>SerialPortBusLink.DescribeOpenFailure</c>'s held-port arm, which names the sibling host first. A
    /// gateway produces <b>no error at all</b>: two hosts dial the same device server, both connects succeed,
    /// and neither learns of the other — so there is no failure path on which to say this, and the only moment
    /// an operator can be told is the moment the bus is registered. E-5 gave the serial transport its sentence
    /// and left this transport with none, which is the gap this closes.</para>
    ///
    /// <para><b>It states a CONSTRAINT, never a guarantee, and the wording is load-bearing.</b> This product
    /// arbitrates nothing on either transport: machine-code claims are a <c>ConcurrentDictionary</c> inside one
    /// process, and <see cref="ModbusBusRegistry"/>'s shared-link bookkeeping is per-process too. The serial
    /// refusal is the OS's exclusive open — accidental safety, not a design — and here there is not even that.
    /// A sentence that let a reader believe the product enforces one host per wire would be worse than
    /// silence, because it would stop them checking the one thing that actually decides it.</para>
    ///
    /// <para>🔴 <b>It names BOTH configuration surfaces, because it is emitted from FOUR producing paths and
    /// only two of them are a <c>connectors.json</c> (F-1 review, I-3).</b> The other two —
    /// <c>Program.cs</c>'s persisted-bus startup registration and the <c>POST /v1/connectors</c> save
    /// response — reach an operator about a bus held in the <b>connector-config store</b>, which no
    /// <c>connectors.json</c> file mentions. Naming only the file would send that operator to open the
    /// engine's <c>connectors.json</c>, not find the bus, and conclude the engine is not on the segment: the
    /// wrong conclusion, produced by the notice written to prevent it. That is D-5's I-1 class — a sentence
    /// true of some of the paths that generate it — and it is the same class the held-port arm was corrected
    /// for in E-5.</para>
    ///
    /// <para>🔴 <b>THE CONSEQUENCE, and the first version of this paragraph got it backwards (branch review,
    /// F-1).</b> It said two uncoordinated frame sources "do not corrupt data" because NModbus validates the
    /// slave address and the function code, so a stray frame becomes a rejected transaction rather than a
    /// plausible wrong number. <b>This repository had already probed the opposite and written it down three
    /// files away</b> — see <see cref="ModbusBus"/>'s own remarks: a differing slave address, a differing
    /// function code and a bad CRC ARE caught, but <b>a stale frame matching on all three is NOT caught and
    /// is returned to the caller as the answer</b> (measured: a request for register 99 answered with
    /// register 0's stale value, silently, no exception). RTU has no transaction id, so nothing remains to
    /// check. And <c>IsDesynchronised</c> cannot rescue it: that flag is set when a transaction FAILS to
    /// consume a complete validated response, and this transaction consumes one and believes it.</para>
    ///
    /// <para><b>Two masters on one segment are the case that defeats it, not an exotic one</b> — they poll
    /// the same devices with the same function codes, which is exactly the same-address/same-function/
    /// same-byte-count shape the probe found uncatchable. So the honest statement is that a shared segment
    /// can commit a WRONG REGISTER VALUE as a real reading, and this product's whole data-provenance
    /// argument (README §20.3) is that fabricated numbers never blend into customer-facing ones.</para>
    ///
    /// <para><b>The RATE stays labelled UNMEASURED — for both outcomes, and that is the point of the fix
    /// rather than an afterthought.</b> Nobody has measured how often two masters produce a matching stale
    /// frame, and nobody has measured the <c>Indeterminate</c> frequency either; there is no RS-485 hardware
    /// on any machine here. The defect being repaired was an UNHEDGED reassurance sitting next to a hedged
    /// number, which makes a reader take "your data is safe" as the established half. Replacing it with a
    /// different unhedged adjective would be the same mistake pointing the other way.</para>
    /// </summary>
    public string DescribeSegmentOwnership() =>
        $"Modbus RTU over a gateway at {Host}:{Port}: this product's deployment rule is ONE HOST PER SEGMENT, " +
        "and on this transport NOTHING enforces it. St4i.EngineApi and St4i.EdgeService can each be pointed " +
        "at this same gateway — from their own connectors.json, OR, on St4i.EngineApi, from a bus saved " +
        "earlier through POST /v1/connectors and re-registered from the connector-config store at every " +
        "startup. Both connections succeed, neither host can see the other, and no error is raised on either " +
        "side. That is a CONSTRAINT ON THE DEPLOYMENT, not a guarantee this build provides — on a directly " +
        "attached COM line the operating system happens to refuse the second open, and a gateway has no " +
        "equivalent. If a second master is on this segment its frames interleave with this one's, and the " +
        "checks catch only SOME of them: a reply whose slave address differs, whose function code differs, " +
        "or whose CRC is bad IS refused. A reply that matches on all three is NOT — it is handed back as the " +
        "answer to whatever was asked, with no exception and no resynchronisation, because an RTU response " +
        "frame carries no transaction id and there is nothing left to check (probed against NModbus in this " +
        "product: a request for register 99 returned register 0's stale value, silently). Two masters poll " +
        "the SAME devices with the SAME function codes, so that is the ORDINARY shape of the collision here, " +
        "not the exotic one. So a shared segment can commit a WRONG REGISTER VALUE as a real reading, and " +
        "write commands land on Indeterminate. NOBODY HAS MEASURED how often either happens. Before " +
        "treating an implausible reading, or a slow or indeterminate write, as a device fault, confirm that " +
        "exactly one host owns this gateway: check BOTH hosts' connectors.json AND the engine's saved " +
        "connectors (GET /v1/connectors/configured), because a bus that was saved through the API will not " +
        "appear in any connectors.json file.";
}
