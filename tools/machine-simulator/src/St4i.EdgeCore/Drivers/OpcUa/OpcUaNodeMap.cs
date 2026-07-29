using System.Text.Json;
using System.Text.Json.Serialization;
using St4i.Connector.Abstractions.Models;

namespace St4i.EdgeCore.Drivers.OpcUa;

/// <summary>GĐ3 sub-3 OU-1 — the OPC-UA session security mode <see cref="OpcUaDriver"/> negotiates.
/// Deliberately a ONE-member enum for the MVP: <see cref="None"/> (no message signing/encryption) is all
/// the loopback de-risk gate proved (see task-1-report.md) and all a same-host/trusted-network exhibition
/// PLC link needs today. <c>Sign</c>/<c>SignAndEncrypt</c> (Basic256Sha256 + trusted app-instance
/// certificates) are a DEFERRED follow-up — see the class doc comment on <see cref="OpcUaDriver"/> for the
/// AutoAcceptUntrustedCertificates caveat this MVP leans on instead.</summary>
public enum OpcUaSecurityMode { None }

/// <summary>
/// Task B-3 (.superpowers/sdd/2026-07-29-dotB-machine-control-blueprint/task-3-brief.md) — the mandatory
/// physical bounds a writable OPC-UA node must declare, PLUS the wire value type a driver must narrow a
/// setpoint value to before calling <c>WriteAsync</c> (an OPC-UA <c>Variant</c> needs an exact CLR type, not
/// whatever <see cref="object"/>? domain the value arrived in — the same re-narrowing concern
/// <see cref="CommandArgumentDeclaration"/> exists for on the command-argument side).
///
/// <para><b><see cref="ValueType"/> is restricted to a NUMERIC <see cref="CommandArgumentType"/></b>
/// (<see cref="CommandArgumentType.Bool"/>/<see cref="CommandArgumentType.String"/> are rejected by
/// <see cref="OpcUaNodeMap.FromJson"/> at parse time) — a writable SETPOINT is, by this task's own scope, a
/// numeric value with a declared range (see <see cref="Min"/>/<see cref="Max"/>'s own remarks); a boolean/
/// string writable node is a documented, deferred follow-up, not built here.</para>
///
/// <para><see cref="Min"/>/<see cref="Max"/> are nullable for the same reason
/// <see cref="Modbus.ModbusWritableRange"/>'s own are — see that type's doc comment for why mandatory-ness is
/// enforced by an explicit post-deserialize check in <see cref="OpcUaNodeMap.FromJson"/> (so the rejection
/// message can name the specific point) rather than by <see langword="required"/> members here.</para>
/// </summary>
public sealed record OpcUaWritableSetpoint(CommandArgumentType ValueType, double? Min, double? Max)
{
    /// <summary>
    /// The write-side narrowing this setpoint declaration exists to drive: given an engineering-unit
    /// <paramref name="engineeringValue"/> ALREADY known to be within <see cref="Min"/>/<see cref="Max"/>
    /// (that check is <see cref="Models.SetpointRejectionReason.OutOfRange"/>'s own job, upstream of this
    /// method), narrows it to the exact CLR value <see cref="ValueType"/> declares — mirroring
    /// <see cref="Modbus.ModbusRegister.TryComputeRawWordForWrite"/>'s role for Modbus, minus the Scale step
    /// (an OPC-UA server already reports/accepts engineering-unit values — see
    /// <see cref="OpcUaNode"/>'s own class doc comment). Never silently truncates: an integral
    /// <see cref="ValueType"/> that would overflow its own representable range is rejected, same "assert the
    /// failure" discipline as the Modbus side.
    /// </summary>
    public bool TryNarrowForWrite(double engineeringValue, out object? narrowed, out string? error)
    {
        if ((Min is { } min && engineeringValue < min) || (Max is { } max && engineeringValue > max))
        {
            narrowed = null;
            error = $"value {engineeringValue} is outside the declared [{Min},{Max}] range.";
            return false;
        }

        if (ValueType == CommandArgumentType.Double)
        {
            narrowed = engineeringValue;
            error = null;
            return true;
        }

        var rounded = Math.Round(engineeringValue, MidpointRounding.AwayFromZero);
        var (rangeMin, rangeMax) = CommandArgumentDeclaration.IntegralRange(ValueType);
        if (rounded < rangeMin || rounded > rangeMax)
        {
            narrowed = null;
            error = $"value {engineeringValue} rounds to {rounded}, which is outside the {ValueType} " +
                     $"representable range [{rangeMin},{rangeMax}].";
            return false;
        }

        narrowed = ValueType switch
        {
            CommandArgumentType.Int16 => (short)rounded,
            CommandArgumentType.UInt16 => (ushort)rounded,
            CommandArgumentType.Int32 => (int)rounded,
            CommandArgumentType.UInt32 => (uint)rounded,
            _ => throw new ArgumentOutOfRangeException(nameof(ValueType), ValueType, "unreachable — every numeric case is listed above."),
        };
        error = null;
        return true;
    }
}

/// <summary>
/// Task B-3 — an OPC-UA method this map declares by name, so <see cref="Models.IWritableDeviceDriver.Commands"/>
/// can list it and <see cref="Models.IWritableDeviceDriver.InvokeCommandAsync"/> (B-4/B-5) can call it without
/// re-deriving which nodes a name refers to. The OPC-UA <c>Call</c> service needs BOTH the parent object's own
/// NodeId and the method's own NodeId (a method is never called "bare" — it is always called ON an object) —
/// declaring both here is exactly the "in a shape B-4/B-5 can execute without re-deriving intent" the task
/// brief asks for, rather than leaving a future driver to browse the address space back to the owning object
/// at write time.
/// </summary>
/// <param name="Name">The command's name — see <see cref="Models.IWritableDeviceDriver.Commands"/>.</param>
/// <param name="ObjectNodeId">The OPC-UA NodeId of the object this method is called ON.</param>
/// <param name="MethodNodeId">The OPC-UA NodeId of the method itself.</param>
/// <param name="Arguments">Optional named input arguments — <see langword="null"/>/empty for a method that
/// takes none. Narrowed the same way a Modbus command's arguments are — see
/// <see cref="CommandArgumentDeclaration.TryNarrow"/> — closing the exact gap B-1's own doc comment names: an
/// OPC-UA <c>UInt16</c> input argument arrives as a boxed <see langword="long"/> and must be re-narrowed
/// against the type declared here before <c>CallAsync</c> can use it.</param>
public sealed record OpcUaCommand(
    string Name, string ObjectNodeId, string MethodNodeId, IReadOnlyList<CommandArgumentDeclaration>? Arguments = null);

/// <summary>One OPC-UA node → canonical-tag mapping: which node to read (the OPC-UA string form, e.g.
/// <c>"ns=2;s=Temperature"</c> — parsed straight into an <see cref="Opc.Ua.NodeId"/> via its own
/// string-constructor) and the metric name/unit it becomes on the resulting
/// <see cref="Models.TelemetrySample"/>. Mirrors <see cref="Modbus.ModbusRegister"/>'s role for the Modbus
/// driver — no scale/offset here (unlike Modbus, an OPC-UA server already reports engineering-unit values,
/// so no raw-register decode step is needed).
///
/// <para><b>Task B-3 — <see cref="Writable"/>.</b> <see langword="null"/> (the default, and the ONLY value
/// every node in every map shipped before this task can ever have) means exactly what it always has: this is
/// a read-only point. A non-null value declares this node as a setpoint — <see cref="Metric"/> names it, the
/// same identity a read reports under — writable within its own declared bounds. See
/// <see cref="OpcUaNodeMap.FromJson"/> for what this declaration is validated against at parse time.</para>
/// </summary>
public sealed record OpcUaNode(string NodeId, string Metric, string? Unit = null, OpcUaWritableSetpoint? Writable = null);

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

    /// <summary>Task B-3 — the methods this map declares, by name. Defaults to empty (every map shipped
    /// before this task, and every map that never sets this key, parses identically — a read-only connector,
    /// exactly as today). See <see cref="OpcUaCommand"/>'s own doc comment for the shape.</summary>
    public IReadOnlyList<OpcUaCommand> Commands { get; init; } = Array.Empty<OpcUaCommand>();

    /// <summary>Task B-3 — the exact vocabulary a driver hands back through
    /// <see cref="Models.IWritableDeviceDriver.WritablePoints"/>: every <see cref="Nodes"/> entry whose
    /// <see cref="OpcUaNode.Writable"/> is non-null, by <see cref="OpcUaNode.Metric"/>. Empty for a map that
    /// declares no writable points — the additive default this task guarantees for every existing map.</summary>
    public IReadOnlyList<string> WritablePointNames
    {
        get
        {
            var names = new List<string>();
            foreach (var node in Nodes)
            {
                if (node.Writable is not null)
                {
                    names.Add(node.Metric);
                }
            }

            return names;
        }
    }

    /// <summary>Task B-3 — the exact vocabulary a driver hands back through
    /// <see cref="Models.IWritableDeviceDriver.Commands"/>: every <see cref="Commands"/> entry's own
    /// <see cref="OpcUaCommand.Name"/>.</summary>
    public IReadOnlyList<string> CommandNames
    {
        get
        {
            var names = new List<string>(Commands.Count);
            foreach (var command in Commands)
            {
                names.Add(command.Name);
            }

            return names;
        }
    }

    /// <summary>Parses a node-map JSON document. Throws <see cref="JsonException"/>/
    /// <see cref="InvalidOperationException"/> straight through on malformed JSON, a missing required field
    /// (<see cref="MachineCode"/>/<see cref="EndpointUrl"/>/<see cref="Nodes"/>), a blank/whitespace-only
    /// <see cref="MachineCode"/>/<see cref="EndpointUrl"/>, or an empty <see cref="Nodes"/> list — same
    /// "validate INSIDE the one throwing parse function every malformed-map case funnels through" fix
    /// <see cref="Modbus.ModbusRegisterMap.FromJson"/> already applies (P2-3 review), so Program.cs's
    /// try/catch around this call (which logs a warning and disables OPC-UA for the run) is the only place
    /// that ever has to think about a bad map — this method itself stays a plain, throwing parse
    /// function.
    ///
    /// <para>Task B-3 additionally validates every <see cref="OpcUaNode.Writable"/>/<see cref="Commands"/>
    /// declaration the same way — see <see cref="ValidateWritableNodes"/>/<see cref="ValidateCommands"/> for
    /// the exact rules and messages.</para></summary>
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

        ValidateWritableNodes(map.Nodes);
        ValidateCommands(map.Commands);

        return map;
    }

    /// <summary>
    /// Task B-3 — the mandatory-limits gate for OPC-UA writable nodes, mirroring
    /// <see cref="Modbus.ModbusRegisterMap"/>'s own (see that class's <c>ValidateWritableRegisters</c> for the
    /// full rationale). Every check below throws <see cref="InvalidOperationException"/> naming the offending
    /// node's <see cref="OpcUaNode.Metric"/>/<see cref="OpcUaNode.NodeId"/>.
    /// </summary>
    private static void ValidateWritableNodes(IReadOnlyList<OpcUaNode> nodes)
    {
        var writableMetrics = new HashSet<string>(StringComparer.Ordinal);

        foreach (var node in nodes)
        {
            if (node.Writable is null)
            {
                continue;
            }

            var pointLabel = $"'{node.Metric}' ({node.NodeId})";

            if (node.Writable.ValueType is CommandArgumentType.Bool or CommandArgumentType.String)
            {
                throw new InvalidOperationException(
                    $"OPC-UA node map: writable node {pointLabel} declares value type '{node.Writable.ValueType}' — " +
                    "a writable SETPOINT must declare a numeric value type (Int16/UInt16/Int32/UInt32/Double); " +
                    "a boolean/string writable node is not supported by this map version.");
            }

            if (node.Writable.Min is null || node.Writable.Max is null)
            {
                throw new InvalidOperationException(
                    $"OPC-UA node map: writable node {pointLabel} is missing mandatory 'min'/'max' limits — " +
                    "a writable point must declare both bounds explicitly; this is never defaulted to unbounded.");
            }

            var min = node.Writable.Min.Value;
            var max = node.Writable.Max.Value;

            if (!double.IsFinite(min) || !double.IsFinite(max))
            {
                throw new InvalidOperationException(
                    $"OPC-UA node map: writable node {pointLabel} declares a non-finite 'min'/'max' limit.");
            }

            if (min > max)
            {
                throw new InvalidOperationException(
                    $"OPC-UA node map: writable node {pointLabel} declares min ({min}) greater than max ({max}).");
            }

            if (node.Writable.ValueType != CommandArgumentType.Double)
            {
                var (rangeMin, rangeMax) = CommandArgumentDeclaration.IntegralRange(node.Writable.ValueType);
                if (min < rangeMin || min > rangeMax || max < rangeMin || max > rangeMax)
                {
                    throw new InvalidOperationException(
                        $"OPC-UA node map: writable node {pointLabel} declares a [{min},{max}] range that overflows " +
                        $"its own value type {node.Writable.ValueType}'s representable range [{rangeMin},{rangeMax}].");
                }
            }

            if (!writableMetrics.Add(node.Metric))
            {
                throw new InvalidOperationException(
                    $"OPC-UA node map: more than one writable node declares metric '{node.Metric}' — a writable " +
                    "point's name must be unique (it is the identity a write targets by name, and two nodes " +
                    "sharing it would make a write's target ambiguous).");
            }
        }
    }

    /// <summary>Task B-3 — command-declaration validation: unique names, and every declared argument's own
    /// schema-shape check (<see cref="CommandArgumentDeclaration.ValidateSelf"/>) — mirrors
    /// <see cref="Modbus.ModbusRegisterMap"/>'s own <c>ValidateCommands</c>.</summary>
    private static void ValidateCommands(IReadOnlyList<OpcUaCommand> commands)
    {
        var names = new HashSet<string>(StringComparer.Ordinal);

        foreach (var command in commands)
        {
            if (string.IsNullOrWhiteSpace(command.Name))
            {
                throw new InvalidOperationException("OPC-UA node map: a command's 'name' must be a non-blank string.");
            }

            if (!names.Add(command.Name))
            {
                throw new InvalidOperationException(
                    $"OPC-UA node map: more than one command declares name '{command.Name}' — command names must be unique.");
            }

            if (string.IsNullOrWhiteSpace(command.ObjectNodeId))
            {
                throw new InvalidOperationException(
                    $"OPC-UA node map: command '{command.Name}' is missing a mandatory 'objectNodeId'.");
            }

            if (string.IsNullOrWhiteSpace(command.MethodNodeId))
            {
                throw new InvalidOperationException(
                    $"OPC-UA node map: command '{command.Name}' is missing a mandatory 'methodNodeId'.");
            }

            if (command.Arguments is null)
            {
                continue;
            }

            var argumentNames = new HashSet<string>(StringComparer.Ordinal);
            foreach (var argument in command.Arguments)
            {
                var argumentError = argument.ValidateSelf();
                if (argumentError is not null)
                {
                    throw new InvalidOperationException(
                        $"OPC-UA node map: command '{command.Name}' declares an invalid argument — {argumentError}");
                }

                if (!argumentNames.Add(argument.Name))
                {
                    throw new InvalidOperationException(
                        $"OPC-UA node map: command '{command.Name}' declares more than one argument named '{argument.Name}'.");
                }
            }
        }
    }
}
