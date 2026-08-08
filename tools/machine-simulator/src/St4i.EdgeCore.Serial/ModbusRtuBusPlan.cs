namespace St4i.EdgeCore.Drivers.Modbus;

/// <summary>
/// 🔴 Task D-7b (.superpowers/sdd/2026-08-02-dotD-modbus-rtu-blueprint/task-7b-brief.md) — <b>one RTU bus
/// document, resolved into the two things every caller of it needs: the TRANSPORT to open, and the LINE
/// IDENTITY to show an operator.</b>
///
/// <para>🔴 <b>Task E-5 moved this type from <c>St4i.EngineApi.Config</c> to <c>St4i.EdgeCore.Serial</c>
/// (namespace <c>St4i.EdgeCore.Drivers.Modbus</c>, beside <see cref="ModbusRtuSerialBusSettings"/>), so
/// <c>St4i.EdgeService</c> — the host that owns the machine with the RS-485 port — can resolve a bus document
/// too. It is a genuine leaf: the two arms below are the only reason it cannot live in <c>St4i.EdgeCore</c>
/// itself (the serial arm names <see cref="ModbusRtuSerialBusSettings"/>, which cannot compile there — see
/// <c>ConnectorsJsonRegistration.RegisterRtuBus</c>'s own remarks on the circular reference), and this
/// assembly is the one place that can see both transports. No behaviour changed: the file is byte-identical
/// below the namespace line.</b></para>
///
/// <para><b>Why this type exists, stated as the defect it prevents.</b> Before D-7b there was exactly one
/// consumer of an RTU document — <c>ConnectorsJsonRegistration</c>'s own <c>RegisterRtuBus</c> — and
/// its transport switch was written inline. D-7b adds three more: <c>POST /v1/connectors</c>, the
/// <c>GET /v1/connectors/configured</c> visibility seeder, and the startup path that re-registers a bus from
/// persisted rows. Four copies of a two-arm switch is four chances for one of them to answer
/// <c>rtu-serial</c> with the gateway parser, and the symptom of that is a bus that silently opens the wrong
/// thing. The switch is here, once; every caller asks this type.</para>
///
/// <para><b>🔴 The LINE projection is D-7a's decision and D-7c's hand-off, and this is its only code path.</b>
/// D-7a decided a serial port path belongs in the store's <c>host</c> column and explicitly NOT in
/// <c>map_json</c>; D-7c pinned the structural half (a port name can never reach <c>map_json</c>, because the
/// fan-out hands each device its own array element verbatim) and recorded that the <c>host</c> half still had
/// no code path at all. <see cref="Host"/>/<see cref="Port"/> below ARE that code path:
/// <c>Line.PortName</c>/<see langword="null"/> for a serial bus, the gateway's own host/port for a gateway
/// bus. It is asserted at the STORE boundary (<c>ConnectorConfigStoreTests</c>), where the
/// <c>SummaryColumns</c>/<c>FullColumns</c> split actually lives, not at the endpoint.</para>
///
/// <para><b>Why <see cref="Port"/> is <see langword="null"/> and not 0 for a serial line.</b> A COM port has
/// no port NUMBER, and the column it lands in is rendered as <c>host:port</c> by every existing client. 0
/// would render as <c>COM3:0</c>, which reads as an address that could be dialled. <see langword="null"/>
/// renders as the line alone, which is what it is.</para>
/// </summary>
/// <param name="Transport">🔴 <b>The CANONICAL transport constant this document resolved to</b> —
/// <see cref="ModbusRtuBusSettings.SerialTransport"/> or <see cref="ModbusRtuBusSettings.GatewayTransport"/>,
/// never the operator's own spelling.
///
/// <para>Fix round 1, review M-1: this used to say "verbatim (never normalised — an operator's own spelling
/// has to survive)", which described <see cref="ModbusRtuBusSettings.ReadTransport"/>'s contract rather than
/// this one and was false of both arms of <see cref="Resolve"/>. The distinction is real and belongs where it
/// is true: <c>ReadTransport</c> must keep the raw spelling because the message for an UNKNOWN transport has
/// to quote what the operator actually wrote. By the time a plan exists the token has been RECOGNISED, and
/// every consumer of this field (the audit row's after-state, the save response) wants the canonical name —
/// an audit trail that recorded <c>rtu-Serial</c> for one bus and <c>rtu-serial</c> for its neighbour would
/// make two identical configurations look different to whoever reads it.</para></param>
/// <param name="BusKey">The reference-counting key <see cref="ModbusBusRegistry"/> shares one open link
/// under. Two documents naming the same physical line MUST produce the same key, which is why it comes from
/// the transport's own <c>CreateBusKey</c> rather than from the operator's bus id.</param>
/// <param name="OpenLink">Opens the link. Called at most once per <see cref="BusKey"/> per process, by the
/// registry, on the first driver's first transaction.</param>
/// <param name="Host">See the remarks — the LINE, projected for the store's <c>host</c> column.</param>
/// <param name="Port">See the remarks — <see langword="null"/> for a serial line.</param>
/// <param name="LimitNotice">🔴 Blueprint §9's automatic-DE limit, for a serial line only
/// (<see cref="ModbusRtuSerialBusSettings.DescribeLimit"/>); <see langword="null"/> for a gateway, whose
/// direction control is the gateway's problem and not this product's. Callers log it once per bus.</param>
public sealed record ModbusRtuBusPlan(
    string Transport,
    string BusKey,
    Func<CancellationToken, Task<IModbusBusLink>> OpenLink,
    string? Host,
    int? Port,
    string? LimitNotice)
{
    /// <summary>
    /// Reads the BUS-LEVEL half of <paramref name="settingsJson"/>. The DEVICE half is
    /// <see cref="ModbusMultidropMap.FanOut"/>'s and is deliberately untouched here — the same document goes
    /// to both parsers and they read disjoint keys.
    /// </summary>
    /// <exception cref="Exception">Whatever the chosen parser throws for a malformed document — deliberately
    /// not wrapped. Every caller already owns the decision about what a malformed bus means (disable that bus
    /// for the run, or refuse the request with the parser's own message), and a wrapper here would replace the
    /// message that names the offending key with a second, vaguer one.</exception>
    public static ModbusRtuBusPlan Resolve(string settingsJson)
    {
        // ReadTransport never throws and answers null for a document too malformed to read. The ELSE arm is
        // the gateway parser, which produces the same named refusal for a blank/absent transport that it
        // always has — so an unreadable document degrades into an existing message rather than a
        // NullReferenceException. (Identical reasoning, and identical behaviour, to the inline switch this
        // method replaced in ConnectorsJsonRegistration.RegisterRtuBus.)
        var transport = ModbusRtuBusSettings.ReadTransport(settingsJson);

        if (string.Equals(transport, ModbusRtuBusSettings.SerialTransport, StringComparison.OrdinalIgnoreCase))
        {
            var serial = ModbusRtuSerialBusSettings.Parse(settingsJson);
            return new ModbusRtuBusPlan(
                Transport: ModbusRtuBusSettings.SerialTransport,
                BusKey: serial.BusKey,
                OpenLink: serial.Opener(),
                Host: serial.Line.PortName,
                Port: null,
                LimitNotice: serial.DescribeLimit());
        }

        var gateway = ModbusRtuBusSettings.Parse(settingsJson);
        return new ModbusRtuBusPlan(
            Transport: ModbusRtuBusSettings.GatewayTransport,
            BusKey: gateway.BusKey,
            OpenLink: gateway.Opener(),
            Host: gateway.Host,
            Port: gateway.Port,
            LimitNotice: null);
    }

    /// <summary>🔴 Task D-7b — the operator-facing one-liner naming this physical line, used by the audit
    /// row and by every message that has to say WHICH wire it is talking about. Never the bus id: an
    /// operator's label for a bus is what they call it, and the point of this string is what it actually
    /// is.</summary>
    public string DescribeLine() => Port is { } p ? $"{Host}:{p}" : Host ?? "(unknown)";
}
