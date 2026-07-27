using System.Text.Json;
using System.Text.Json.Serialization;

namespace St4i.EdgeCore.Drivers.OpcUa;

/// <summary>GĐ3 sub-3 OU-1 — the OPC-UA session security mode <see cref="OpcUaDriver"/> negotiates.
/// Deliberately a ONE-member enum for the MVP: <see cref="None"/> (no message signing/encryption) is all
/// the loopback de-risk gate proved (see task-1-report.md) and all a same-host/trusted-network exhibition
/// PLC link needs today. <c>Sign</c>/<c>SignAndEncrypt</c> (Basic256Sha256 + trusted app-instance
/// certificates) are a DEFERRED follow-up — see the class doc comment on <see cref="OpcUaDriver"/> for the
/// AutoAcceptUntrustedCertificates caveat this MVP leans on instead.</summary>
public enum OpcUaSecurityMode { None }

/// <summary>One OPC-UA node → canonical-tag mapping: which node to read (the OPC-UA string form, e.g.
/// <c>"ns=2;s=Temperature"</c> — parsed straight into an <see cref="Opc.Ua.NodeId"/> via its own
/// string-constructor) and the metric name/unit it becomes on the resulting
/// <see cref="Models.TelemetrySample"/>. Mirrors <see cref="Modbus.ModbusRegister"/>'s role for the Modbus
/// driver — no scale/offset here (unlike Modbus, an OPC-UA server already reports engineering-unit values,
/// so no raw-register decode step is needed).</summary>
public sealed record OpcUaNode(string NodeId, string Metric, string? Unit = null);

/// <summary>A minimal OPC-UA node map for one machine: its equipment code, the server endpoint to dial,
/// security/auth, poll cadence, and the ordered nodes <see cref="OpcUaDriver"/> reads each poll. Loaded
/// from JSON via <see cref="FromJson"/> — the same idiom as <see cref="Modbus.ModbusRegisterMap.FromJson"/>
/// (case-insensitive property names, enum values matched by C# member name).
///
/// <para><b>EndpointUrl precedence</b> (GĐ3 sub-3 OU-1 brief) — this field is <see langword="required"/>
/// and always wins: <see cref="OpcUaOptions.EndpointUrl"/> (the <c>ST4I_OPCUA_ENDPOINT</c> env var) is
/// currently NOT consulted by <see cref="OpcUaDriverFactory"/>/Program.cs's startup wiring at all — it
/// exists only for symmetry with <c>ModbusOptions.Host</c>/<c>Port</c> and is reserved for a possible
/// future "quick-connect with no map file" mode. A configured OPC-UA machine's endpoint is decided
/// EXCLUSIVELY by its node-map JSON.</para>
/// </summary>
public sealed class OpcUaNodeMap
{
    private static readonly JsonSerializerOptions JsonOptions = new()
    {
        PropertyNameCaseInsensitive = true,
        Converters = { new JsonStringEnumConverter() },
    };

    public required string MachineCode { get; init; }

    /// <summary>The OPC-UA server endpoint, e.g. <c>opc.tcp://host:port</c>. See the class doc comment's
    /// "EndpointUrl precedence" note — this is the ONLY source <see cref="OpcUaDriver"/> ever reads.</summary>
    public required string EndpointUrl { get; init; }

    public OpcUaSecurityMode SecurityMode { get; init; } = OpcUaSecurityMode.None;

    /// <summary><see langword="null"/> (default) means anonymous auth.</summary>
    public string? Username { get; init; }

    public string? Password { get; init; }

    public int PollIntervalMs { get; init; } = 1000;

    public required IReadOnlyList<OpcUaNode> Nodes { get; init; }

    /// <summary>Parses a node-map JSON document. Throws <see cref="JsonException"/>/
    /// <see cref="InvalidOperationException"/> straight through on malformed JSON, a missing required field
    /// (<see cref="MachineCode"/>/<see cref="EndpointUrl"/>/<see cref="Nodes"/>), a blank/whitespace-only
    /// <see cref="MachineCode"/>/<see cref="EndpointUrl"/>, or an empty <see cref="Nodes"/> list — same
    /// "validate INSIDE the one throwing parse function every malformed-map case funnels through" fix
    /// <see cref="Modbus.ModbusRegisterMap.FromJson"/> already applies (P2-3 review), so Program.cs's
    /// try/catch around this call (which logs a warning and disables OPC-UA for the run) is the only place
    /// that ever has to think about a bad map — this method itself stays a plain, throwing parse
    /// function.</summary>
    public static OpcUaNodeMap FromJson(string json)
    {
        var map = JsonSerializer.Deserialize<OpcUaNodeMap>(json, JsonOptions);
        if (map is null)
        {
            throw new InvalidOperationException("OpcUaNodeMap.FromJson: JSON deserialized to null.");
        }

        if (string.IsNullOrWhiteSpace(map.MachineCode))
        {
            throw new InvalidOperationException("OPC-UA node map: 'machineCode' must be a non-blank string.");
        }

        if (string.IsNullOrWhiteSpace(map.EndpointUrl))
        {
            throw new InvalidOperationException("OPC-UA node map: 'endpointUrl' must be a non-blank string.");
        }

        if (map.Nodes.Count == 0)
        {
            throw new InvalidOperationException("OPC-UA node map: 'nodes' must contain at least one entry.");
        }

        return map;
    }
}
