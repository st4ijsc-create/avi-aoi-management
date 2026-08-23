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
public enum OpcUaSecurityMode
{
    /// <summary>No message signing and no encryption on the session. The token a map file spells is this
    /// C# member name, matched case-insensitively (<c>"none"</c> binds, measured 2026-08-22); a numeric
    /// <c>0</c> binds here too, and a token that names no member fails the parse with a
    /// <c>JsonException</c> pointing at <c>$.securityMode</c> (measured with <c>"SignAndEncrypt"</c>).
    /// 🔴 <b>The operational consequence, which is a precondition on the deployment rather than a
    /// setting:</b> <see cref="OpcUaDriver"/> selects its endpoint with <c>useSecurity: false</c> and then
    /// builds a <c>UserIdentity</c> from <see cref="OpcUaNodeMap.Username"/> and
    /// <see cref="OpcUaNodeMap.Password"/>, so those credentials reach the server without protection from
    /// the OPC-UA security layer, and the same-host-or-trusted-network posture described on
    /// <see cref="OpcUaDriver"/> is what keeps them private — see that class's doc comment for the deferred
    /// <c>Sign</c>/<c>SignAndEncrypt</c> work this member is the placeholder for.</summary>
    None,
}

/// <summary>
/// Task B-3 (.superpowers/sdd/2026-07-29-dotB-machine-control-blueprint/task-3-brief.md) — the mandatory
/// physical bounds a writable OPC-UA node must declare, PLUS the wire value type a driver must narrow a
/// setpoint value to before calling <c>WriteAsync</c> (an OPC-UA <c>Variant</c> needs an exact CLR type, not
/// whatever <see cref="object"/>? domain the value arrived in — the same re-narrowing concern
/// <see cref="CommandArgumentDeclaration"/> exists for on the command-argument side).
///
/// <para><b><see cref="ValueType"/> is nullable and mandatory</b> — Fix round 1 (minor, closing a gap the
/// review flagged while overruling the original Bool restriction below): an OMITTED <c>"valueType"</c> JSON
/// key used to bind silently to its CLR default, <see cref="CommandArgumentType.Bool"/> (ordinal 0) — under
/// the ORIGINAL "Bool is always rejected" rule this happened to still fail loudly (for the wrong reason), but
/// now that <see cref="CommandArgumentType.Bool"/> is a legitimately ACCEPTED value type (see below), an
/// omitted <c>valueType"</c> could otherwise silently become a valid-looking Bool declaration. <see cref="OpcUaNodeMap.FromJson"/>
/// now rejects a <see langword="null"/> <see cref="ValueType"/> explicitly, so a forgotten field still cannot
/// arm anything — including a numeric write, which is exactly the property Fix round 1's own review comment
/// asked to preserve.</para>
///
/// <para><b><see cref="CommandArgumentType.Bool"/> is ACCEPTED — Fix round 1, overruling the original
/// Bool/String rejection.</b> The original design treated <see cref="Min"/>/<see cref="Max"/> as the
/// DEFINITION of a setpoint rather than a MEANS of bounding one — but a boolean's domain
/// <c>{false,true}</c> is exhaustively enumerable, a STRONGER bound than any numeric range, not a missing
/// one. Enable/disable, auto/manual, and mode-select bits are among the most common real OPC-UA writes, and
/// the two workarounds this original restriction forced (declare it as <c>UInt16 [0,1]</c> and hope the
/// server coerces, or express it as a COMMAND, which B-6 gates at a STRICTER RBAC role) both push an ordinary
/// boolean write into a higher-privilege lane than it needs — a safety regression dressed up as caution.
/// <see cref="CommandArgumentType.String"/> remains rejected (unchanged) — a boolean's exhaustive domain is
/// what makes this override safe; a string's domain is not similarly bounded, and nothing in the review
/// asked for that one to move.</para>
///
/// <para>For <see cref="CommandArgumentType.Bool"/> specifically, <see cref="Min"/>/<see cref="Max"/> must
/// be ABSENT (both <see langword="null"/>) — mirroring <see cref="CommandArgumentDeclaration.ValidateSelf"/>'s
/// own "bounds are only meaningful for a numeric type" rule exactly. For every numeric
/// <see cref="CommandArgumentType"/>, <see cref="Min"/>/<see cref="Max"/> remain MANDATORY, unchanged.</para>
///
/// <para><b>Fix round 1 — "consider" item, resolved: <see cref="TryNarrowForWrite"/> stays
/// <see langword="bool"/> + <see langword="string"/>?, not <see cref="St4i.Connector.Abstractions.Models.SetpointRejectionReason"/>.</b>
/// Every failure it can produce corresponds to EXACTLY ONE <see cref="St4i.Connector.Abstractions.Models.SetpointRejectionReason"/> member
/// — <see cref="St4i.Connector.Abstractions.Models.SetpointRejectionReason.OutOfRange"/> — for the identical reasoning
/// <see cref="Modbus.ModbusRegister.TryComputeRawWordForWrite"/>'s own doc comment gives (which name/writability
/// question this method is never asked to answer). See <see cref="CommandArgumentDeclaration"/>'s own doc
/// comment for the same call on the command-argument side.</para>
/// </summary>
public sealed record OpcUaWritableSetpoint(CommandArgumentType? ValueType, double? Min, double? Max)
{
    /// <summary>
    /// The write-side narrowing this setpoint declaration exists to drive: given the raw value a caller
    /// supplied (<see langword="bool"/> for a <see cref="CommandArgumentType.Bool"/> setpoint;
    /// <see langword="double"/>/<see langword="long"/> for a numeric one — the same widened domain
    /// <see cref="CommandArgumentDeclaration.TryNarrow"/> accepts), narrows it to the exact CLR value
    /// <see cref="ValueType"/> declares — mirroring <see cref="Modbus.ModbusRegister.TryComputeRawWordForWrite"/>'s
    /// role for Modbus, minus the Scale step (an OPC-UA server already reports/accepts engineering-unit values
    /// — see <see cref="OpcUaNode"/>'s own class doc comment). Never silently truncates: an integral
    /// <see cref="ValueType"/> that would overflow its own representable range is rejected, same "assert the
    /// failure" discipline as the Modbus side; a non-finite numeric value (<see cref="double.NaN"/>/±Infinity)
    /// is rejected too — Fix round 1 (Critical #2) — NaN previously failed every declared-range/physical-range
    /// comparison silently and then narrowed to a live 0.
    /// </summary>
    public bool TryNarrowForWrite(object? rawValue, out object? narrowed, out string? error)
    {
        if (ValueType is null)
        {
            narrowed = null;
            error = "this setpoint has no declared value type (should have been rejected at parse time)";
            return false;
        }

        if (ValueType == CommandArgumentType.Bool)
        {
            if (rawValue is bool boolValue)
            {
                narrowed = boolValue;
                error = null;
                return true;
            }

            narrowed = null;
            error = $"expected Bool, got {DescribeRuntimeType(rawValue)}";
            return false;
        }

        double engineeringValue;
        if (rawValue is double d)
        {
            engineeringValue = d;
        }
        else if (rawValue is long l)
        {
            engineeringValue = l;
        }
        else
        {
            narrowed = null;
            error = $"expected a numeric value for {ValueType}, got {DescribeRuntimeType(rawValue)}";
            return false;
        }

        if (!double.IsFinite(engineeringValue))
        {
            narrowed = null;
            error = $"value {engineeringValue} is not finite";
            return false;
        }

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
        var (rangeMin, rangeMax) = CommandArgumentDeclaration.IntegralRange(ValueType.Value);
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

    private static string DescribeRuntimeType(object? value) => value switch
    {
        null => "null",
        bool => "Bool",
        string => "String",
        long => "an integral number",
        double => "a floating-point number",
        _ => value.GetType().Name,
    };
}

/// <summary>
/// Task B-3 — an OPC-UA method this map declares by name, so <see cref="St4i.Connector.Abstractions.IWritableDeviceDriver.Commands"/>
/// can list it and <see cref="St4i.Connector.Abstractions.IWritableDeviceDriver.InvokeCommandAsync"/> (B-4/B-5) can call it without
/// re-deriving which nodes a name refers to. The OPC-UA <c>Call</c> service needs BOTH the parent object's own
/// NodeId and the method's own NodeId (a method is never called "bare" — it is always called ON an object) —
/// declaring both here is exactly the "in a shape B-4/B-5 can execute without re-deriving intent" the task
/// brief asks for, rather than leaving a future driver to browse the address space back to the owning object
/// at write time.
/// </summary>
/// <param name="Name">The command's name — see <see cref="St4i.Connector.Abstractions.IWritableDeviceDriver.Commands"/>.</param>
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
/// <see cref="St4i.Connector.Abstractions.Models.TelemetrySample"/>. Mirrors <see cref="Modbus.ModbusRegister"/>'s role for the Modbus
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
    /// <summary>The value <see cref="PollIntervalMs"/> resolves to when the key is absent, or when a
    /// declared value is refused by <see cref="FromJson"/>'s domain check. Named rather than repeated so
    /// the property initializer and the parse fallback cannot drift apart. Same figure as
    /// <c>ModbusRegisterMap.DefaultPollIntervalMs</c>, declared separately because these two maps mirror
    /// each other rather than share a base.</summary>
    public const int DefaultPollIntervalMs = 1000;

    /// <summary>Upper guard for <see cref="PollIntervalMs"/>. <b>Derived, not chosen</b>, and derived for
    /// the same arithmetic reason as <c>ModbusRegisterMap.MaxPollIntervalMs</c> even though this type has
    /// no <c>EffectiveReadTimeoutMs</c> of its own: the figure is the largest value that survives a
    /// <see langword="int"/> multiplication by four, which is where the sibling map stops being able to
    /// describe its own behaviour. Item 38 (task BD-1, 2026-08-23) deliberately declines to invent a
    /// smaller, rounder ceiling — a ceiling stated too small jails a legitimate slow-cadence deployment,
    /// and the widest bound declared anywhere in the surrounding product is one hour.</summary>
    public const int MaxPollIntervalMs = int.MaxValue / 4;

    private static readonly JsonSerializerOptions JsonOptions = new()
    {
        PropertyNameCaseInsensitive = true,
        Converters = { new JsonStringEnumConverter() },
    };

    /// <summary>The equipment code this map's readings are attributed to — the identity handed to
    /// <c>St4i.EngineApi.Fleet.FleetHost.RegisterMachine</c>, which forwards it to
    /// <c>FleetCore.RegisterMachine</c> and the live roster. <b>Mandatory in two separate
    /// senses with two different failure shapes, both measured 2026-08-22 against the built
    /// assembly:</b> an ABSENT <c>"machineCode"</c> key fails inside the JSON binder with
    /// <c>JsonException: … was missing required properties including: 'MachineCode'</c>, while a
    /// PRESENT-but-blank value passes the binder and fails afterwards in <see cref="FromJson"/>'s own
    /// check with a message naming the field. <c>required</c> buys the first and not the second, which is
    /// why the second check exists. Both leave through <c>St4i.EngineApi.Program</c>'s try/catch, which
    /// writes a startup warning to standard error and leaves the OPC-UA slot unfilled for the run.</summary>
    public required string MachineCode { get; init; }

    /// <summary>The OPC-UA server endpoint, e.g. <c>opc.tcp://host:port</c>. See the class doc comment's
    /// "EndpointUrl precedence" note — this is the ONLY source <see cref="OpcUaDriver"/> ever reads.</summary>
    public required string EndpointUrl { get; init; }

    /// <summary>The session security mode negotiated for this endpoint. An absent key resolves to
    /// <see cref="OpcUaSecurityMode.None"/> (measured 2026-08-22), and
    /// <see cref="OpcUaSecurityMode"/> declares a single member, so a map cannot currently ask for
    /// anything stronger — read the field as a statement of the deployment's posture rather than as a
    /// knob, and see <see cref="OpcUaSecurityMode.None"/> for what that costs the credentials below.
    ///
    /// <para>🔴 <b>An out-of-range NUMERIC value is accepted here, which the string form is not.</b>
    /// Measured 2026-08-22: <c>"securityMode": 1</c> binds and the resulting value prints as <c>1</c>,
    /// naming no declared member, while <c>"securityMode": "SignAndEncrypt"</c> fails the parse. So the
    /// enum's own token list is enforced on spellings and not on integers.</para>
    ///
    /// <para>🔴 <b>The ACCESSIBILITY of this member is load-bearing</b> for the reason recorded on
    /// <see cref="Password"/>: the JSON binder skips members that are not public, so narrowing it would
    /// compile and would then discard whatever a map declared, silently.</para></summary>
    public OpcUaSecurityMode SecurityMode { get; init; } = OpcUaSecurityMode.None;

    /// <summary><see langword="null"/> (default) means anonymous auth.</summary>
    public string? Username { get; init; }

    /// <summary>The password presented with <see cref="Username"/> for username/password authentication.
    /// An absent key and an explicit <c>"password": null</c> both resolve to <see langword="null"/>, which
    /// means anonymous — the two are indistinguishable once parsed (measured 2026-08-22). A password
    /// supplied WITHOUT a <see cref="Username"/> also parses successfully (measured) and is then
    /// DISCARDED: <see cref="OpcUaDriver"/>'s session setup branches on <see cref="Username"/> alone and
    /// builds a bare anonymous <c>UserIdentity</c> when it is blank, so the session-identity path does not
    /// carry this field at all in that shape. The scope of that statement, enumerated 2026-08-22 rather
    /// than assumed: across the <c>Drivers/OpcUa</c> cone this member has ONE code read,
    /// <see cref="OpcUaDriver"/>'s identity construction, plus the copy in <see cref="FromJson"/>'s
    /// null-<see cref="Commands"/> reconstruction; the other mentions are comments.
    /// The value is held in an ordinary managed string for the lifetime of the map object;
    /// it is not placed in a protected secret store, and the map file on disk is the credential's real
    /// home.
    ///
    /// <para>🔴 <b>The ACCESSIBILITY of this member is load-bearing, and that is a measurement rather than
    /// a style preference.</b> The JSON binder skips members that are not public, so narrowing this one
    /// compiles and then binds the map with this field left at <see langword="null"/> while reporting a
    /// successful parse. With <see cref="Username"/> still set, the driver's
    /// <c>new UserIdentity(Username, UTF8.GetBytes(Password ?? string.Empty))</c> would present the right
    /// user with an EMPTY password — an authentication attempt that looks correct in the map and is wrong
    /// on the wire. Measured 2026-08-22 on an isolated control (a public class
    /// whose properties were made <c>internal</c>: the declared JSON values were discarded, the CLR
    /// defaults survived, and no exception was raised). <c>docs/owner-decisions.md</c> item 25 names this
    /// member and <c>ModbusRegisterMap.UnitId</c> as the two worked examples of that class.</para></summary>
    public string? Password { get; init; }

    /// <summary>Milliseconds the poll loop waits after each poll completes — a gap between polls rather
    /// than a fixed period. An absent key resolves to 1000 (measured 2026-08-22).
    ///
    /// <para>🔴 <b>Not range checked, with the same three measured failure shapes as
    /// <c>ModbusRegisterMap.PollIntervalMs</c>:</b> <see cref="FromJson"/> accepts <c>0</c> and negative
    /// values and stores them as given (measured 2026-08-22 for <c>0</c>, <c>-1</c> and <c>-5</c>), and
    /// <see cref="OpcUaDriver"/> hands the value to
    /// <c>Task.Delay</c>, which was measured to complete immediately at <c>0</c> (an unthrottled poll
    /// loop), to wait indefinitely at <c>-1</c> (the endpoint is read once and then stays quiet), and to
    /// throw <c>ArgumentOutOfRangeException</c> at <c>-2</c> and below, out of a <c>catch</c> that handles
    /// cancellation and does not handle this. Recorded as measured behaviour: the task that wrote this
    /// sentence documents the driver family under <c>docs/owner-decisions.md</c> item 25 and is not
    /// permitted to change code.</para>
    ///
    /// <para>📐 <b>EXECUTED 2026-08-23 (task BD-1, item 38). The paragraph above is kept verbatim; every
    /// shape it records still reproduces for a map built programmatically, and only the PARSE path
    /// changed.</b> <see cref="FromJson"/> now runs this key through
    /// <see cref="ResolvePollIntervalMs"/> — a mirror of
    /// <c>ModbusRegisterMap.ResolvePollIntervalMs</c>, which carries the domain rule that map's
    /// <c>readTimeoutMs</c>/<c>retries</c> have always used. <b>Mirrored rather than shared, and that is a
    /// choice worth naming:</b> this type already mirrors <see cref="ValidateWritableNodes"/> and
    /// <see cref="ValidateCommands"/> off their Modbus counterparts instead of hoisting them into a common
    /// helper, and the operator-facing message has to read "OPC-UA node map:" rather than "Modbus register
    /// map:" — sharing the function would have required parameterising its prose, which buys nothing here
    /// and makes both messages harder to find by grep.
    ///
    /// <para>🔴 <b>This map has NO range-checked neighbour to copy from.</b> Item 38's title says the two
    /// adjacent fields ARE checked; measured on 2026-08-23, that is true of
    /// <c>ModbusRegisterMap</c> and false here — <c>OpcUaNodeMap</c> declares no <c>readTimeoutMs</c> and
    /// no <c>retries</c> at all, so on this side of the pair the fix imports a convention rather than
    /// restoring one.</para></para></summary>
    public int PollIntervalMs { get; init; } = DefaultPollIntervalMs;

    /// <summary>The nodes this map declares, in the order the poll loop reads them each cycle — one
    /// <c>DeviceReading</c> is yielded per poll, so the list's length is how wide that reading is.
    ///
    /// <para><b>Three ways to get this wrong, three different outcomes, all measured 2026-08-22.</b> An
    /// ABSENT <c>"nodes"</c> key fails the bind with <c>JsonException: … was missing required properties
    /// including: 'Nodes'</c>. A present-but-EMPTY array passes the binder and is refused by
    /// <see cref="FromJson"/>'s own check with a message naming the field. 🔴 An explicit
    /// <c>"nodes": null</c> satisfies the required-property check, binds a genuine null, and raises a bare
    /// <c>NullReferenceException</c> out of <see cref="FromJson"/> — a parse failure that does not say
    /// what was wrong. That is the same shape this file records as FIXED for <see cref="Commands"/>
    /// further down, still live on this member; it is reported rather than repaired here, and the twin
    /// lives on <c>ModbusRegisterMap.Registers</c>.</para></summary>
    public required IReadOnlyList<OpcUaNode> Nodes { get; init; }

    /// <summary>Task B-3 — the methods this map declares, by name. Defaults to empty (every map shipped
    /// before this task, and every map that never sets this key, parses identically — a read-only connector,
    /// exactly as today). See <see cref="OpcUaCommand"/>'s own doc comment for the shape.</summary>
    public IReadOnlyList<OpcUaCommand> Commands { get; init; } = Array.Empty<OpcUaCommand>();

    /// <summary>Task B-3 — the exact vocabulary a driver hands back through
    /// <see cref="St4i.Connector.Abstractions.IWritableDeviceDriver.WritablePoints"/>: every <see cref="Nodes"/> entry whose
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
    /// <see cref="St4i.Connector.Abstractions.IWritableDeviceDriver.Commands"/>: every <see cref="Commands"/> entry's own
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

    /// <summary>
    /// Task B-3 fix round 1 (Important #1) — the RICHER counterpart to <see cref="WritablePointNames"/>,
    /// mirroring <see cref="Modbus.ModbusRegisterMap.WritablePointBounds"/> exactly: not just which points are
    /// writable, but the declared bounds (<see langword="null"/> for a <see cref="CommandArgumentType.Bool"/>
    /// setpoint, which has none by design) AND the NodeId it actually targets. Consumed by
    /// <c>St4i.EngineApi.Fleet.ConnectorConfigValidation</c> to build the deliberate-save-gate's confirmation
    /// fingerprint, so widening a limit or RE-POINTING a writable node to a different NodeId also changes the
    /// required confirmation.
    /// </summary>
    public IReadOnlyList<(string Metric, string Target, double? Min, double? Max)> WritablePointBounds
    {
        get
        {
            var bounds = new List<(string, string, double?, double?)>();
            foreach (var node in Nodes)
            {
                if (node.Writable is not null)
                {
                    bounds.Add((node.Metric, node.NodeId, node.Writable.Min, node.Writable.Max));
                }
            }

            return bounds;
        }
    }

    /// <summary>Task B-3 fix round 1 (Important #1) — the RICHER counterpart to <see cref="CommandNames"/>:
    /// each method's name AND the object/method NodeId pair it actually calls, formatted as one
    /// human-readable, deterministic string — so RE-POINTING a method to a different object/method also
    /// changes the confirmation fingerprint, not just adding/removing a command by name.</summary>
    public IReadOnlyList<(string Name, string Target)> CommandTargets
    {
        get
        {
            var targets = new List<(string, string)>(Commands.Count);
            foreach (var command in Commands)
            {
                targets.Add((command.Name, $"{command.ObjectNodeId} -> {command.MethodNodeId}"));
            }

            return targets;
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
    /// <param name="json">The node-map JSON document.</param>
    /// <param name="logWarning">Item 38 (2026-08-23) — invoked once per malformed
    /// <see cref="PollIntervalMs"/> value that was ignored in favour of
    /// <see cref="DefaultPollIntervalMs"/>. Optional, and optional for a reason worth stating: before this
    /// parameter existed <c>OpcUaConnectorFactory</c>'s own doc comment recorded that
    /// "<c>OpcUaNodeMap.FromJson</c> takes no logger" as a known asymmetry with the Modbus adapter. It
    /// takes one now, defaulted so that all three existing call sites compile unchanged; the connector
    /// factory passes its real sink, and the two St4i.EngineApi call sites still pass nothing, so a bad
    /// cadence declared through those paths is corrected silently. That residue is named rather than
    /// hidden.</param>
    public static OpcUaNodeMap FromJson(string json, Action<string>? logWarning = null)
    {
        // Item 38 — a JsonDocument alongside the strongly-typed bind, the same two-step
        // ModbusRegisterMap.FromJson has always used, so the raw element is available for the domain
        // check below. JsonDocument.Parse and JsonSerializer.Deserialize raise the same JsonException on
        // malformed input, so the failure shape for a broken document is unchanged.
        using var document = JsonDocument.Parse(json);

        var map = document.RootElement.Deserialize<OpcUaNodeMap>(JsonOptions);
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

        // 🔴 Item 39 (task BD-1, 2026-08-23) — the twin of ModbusRegisterMap's `"registers": null`. An
        // explicit JSON null satisfies `required` (which only demands the KEY be present), binds through
        // into a property declared non-nullable, and used to raise a BARE NullReferenceException out of
        // the `.Count` below — a string with no field, no machine code and nothing to act on, handed to
        // the operator verbatim by OpcUaConnectorFactory.TryCreate. Unlike `commands` further down, an
        // empty default is not available: an empty list is itself refused on the next line. It names the
        // field and the machine code, the two identifiers this method has; the FILE is named by the frame
        // that owns the path (St4i.EngineApi.Program's startup catch wraps this message in '{MapPath}').
        if (map.Nodes is null)
        {
            throw new InvalidOperationException(
                $"OPC-UA node map for machine '{map.MachineCode}': 'nodes' was declared as null. " +
                "Give it an array of at least one node entry, or remove the key entirely to see which " +
                "required field is missing. (A JSON null is not the same as an omitted key: 'required' " +
                "accepts it.)");
        }

        if (map.Nodes.Count == 0)
        {
            throw new InvalidOperationException("OPC-UA node map: 'nodes' must contain at least one entry.");
        }

        // Item 38 — the domain check, mirroring ModbusRegisterMap's. Applied AFTER the identity and node
        // checks so that a map which is wrong in more than one way reports the structural fault first;
        // a cadence that falls back to its default is a warning, not a failure, and must not be the
        // headline when 'nodes' is also broken.
        var resolvedPollIntervalMs = ResolvePollIntervalMs(map.PollIntervalMs, logWarning);

        // Fix round 1 (minor) — an explicit JSON `"commands": null` (which OVERRIDES this property's
        // initializer default, unlike an omitted key) used to bind Commands to a genuine null, so
        // ValidateCommands's own foreach threw a bare NullReferenceException instead of a named parse error.
        // Same "explicit null treated as omitted" precedent as Modbus's own equivalent fix. OpcUaNodeMap is a
        // plain class (not a record — no `with` expression available), so a null Commands is normalized by
        // reconstructing rather than mutating an init-only property post-construction.
        //
        // Item 38 widened this branch's trigger: the reconstruction is now also how a REFUSED
        // pollIntervalMs gets replaced, since the property is init-only and this type has no `with`.
        // Reconstructing only when something actually changed keeps the common path allocation-identical
        // to before.
        if (map.Commands is null || resolvedPollIntervalMs != map.PollIntervalMs)
        {
            map = new OpcUaNodeMap
            {
                MachineCode = map.MachineCode,
                EndpointUrl = map.EndpointUrl,
                SecurityMode = map.SecurityMode,
                Username = map.Username,
                Password = map.Password,
                PollIntervalMs = resolvedPollIntervalMs,
                Nodes = map.Nodes,
                Commands = map.Commands ?? Array.Empty<OpcUaCommand>(),
            };
        }

        ValidateWritableNodes(map.Nodes);
        ValidateCommands(map.Commands);

        return map;
    }

    /// <summary>Item 38 (task BD-1, 2026-08-23) — <see cref="PollIntervalMs"/>'s domain check, the mirror
    /// of <c>ModbusRegisterMap.ResolvePollIntervalMs</c>: same rule, same message wording, this map's own
    /// operator-facing prefix. Must be &gt; 0 and not above <see cref="MaxPollIntervalMs"/>; a violation
    /// warns through <paramref name="logWarning"/> and falls back to <see cref="DefaultPollIntervalMs"/>
    /// rather than failing the whole map, because a cadence typo should not disable an entire driver for
    /// the run.
    ///
    /// <para>It takes the BOUND value rather than reading the raw <see cref="JsonElement"/>, for the
    /// reason set out in full on the Modbus counterpart: the binder matches property names
    /// case-insensitively and an ordinal <c>TryGetProperty</c> does not, so a raw lookup would miss a
    /// document spelled <c>"PollIntervalMs"</c> and silently overwrite a valid declared cadence with the
    /// default. Reading what the binder produced inherits the binder's matching rules exactly.</para>
    ///
    /// <para>An explicit JSON <c>null</c> and a wrong JSON type never reach here — both throw out of the
    /// bind, unchanged by item 38.</para></summary>
    private static int ResolvePollIntervalMs(int value, Action<string>? logWarning)
    {
        if (value <= 0)
        {
            logWarning?.Invoke($"OPC-UA node map: 'pollIntervalMs' must be > 0 (got {value}) — ignoring and using the default instead.");
            return DefaultPollIntervalMs;
        }

        if (value > MaxPollIntervalMs)
        {
            logWarning?.Invoke($"OPC-UA node map: 'pollIntervalMs' {value} exceeds the maximum of {MaxPollIntervalMs} — ignoring and using the default instead.");
            return DefaultPollIntervalMs;
        }

        return value;
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

            // Fix round 1, I4 — the write identity itself (Metric/NodeId) must be non-blank; a blank NodeId
            // in particular would leave a future driver with no address to actually write to at all.
            if (string.IsNullOrWhiteSpace(node.Metric))
            {
                throw new InvalidOperationException(
                    $"OPC-UA node map: a writable node ({node.NodeId}) has a blank 'metric' — a writable point's " +
                    "name must be non-blank; it is the identity a write targets by name.");
            }

            if (string.IsNullOrWhiteSpace(node.NodeId))
            {
                throw new InvalidOperationException(
                    $"OPC-UA node map: writable node {pointLabel} has a blank 'nodeId' — a writable point needs a " +
                    "real NodeId to actually address a write to.");
            }

            // Fix round 1 (minor) — ValueType is nullable specifically so an OMITTED "valueType" is
            // detectable and rejected, rather than silently binding to its CLR default
            // (CommandArgumentType.Bool, ordinal 0) and looking like a deliberate (and, since the Bool
            // override below, now legitimately acceptable) Bool declaration.
            if (node.Writable.ValueType is null)
            {
                throw new InvalidOperationException(
                    $"OPC-UA node map: writable node {pointLabel} is missing mandatory 'valueType' — never " +
                    "defaulted to Bool (or anything else).");
            }

            var valueType = node.Writable.ValueType.Value;

            // Fix round 1 (overruling the original design) — Bool is ACCEPTED: a boolean's domain
            // {false,true} is exhaustively enumerable, a STRONGER bound than any numeric range, not a
            // missing one. Min/Max must be ABSENT for Bool (mirrors CommandArgumentDeclaration.ValidateSelf's
            // own "bounds are only meaningful for a numeric type" rule). String remains rejected — its
            // domain isn't similarly bounded.
            if (valueType == CommandArgumentType.String)
            {
                throw new InvalidOperationException(
                    $"OPC-UA node map: writable node {pointLabel} declares value type 'String' — a writable " +
                    "SETPOINT must declare Bool or a numeric value type (Int16/UInt16/Int32/UInt32/Double); a " +
                    "string writable node is not supported by this map version.");
            }

            if (valueType == CommandArgumentType.Bool)
            {
                if (node.Writable.Min is not null || node.Writable.Max is not null)
                {
                    throw new InvalidOperationException(
                        $"OPC-UA node map: writable node {pointLabel} declares 'min'/'max' with value type 'Bool' — " +
                        "bounds are only meaningful for a numeric type; a boolean's domain is already exhaustively " +
                        "{false,true}. Omit 'min'/'max' for a Bool writable node.");
                }

                if (!writableMetrics.Add(node.Metric))
                {
                    throw new InvalidOperationException(
                        $"OPC-UA node map: more than one writable node declares metric '{node.Metric}' — a writable " +
                        "point's name must be unique (it is the identity a write targets by name, and two nodes " +
                        "sharing it would make a write's target ambiguous).");
                }

                continue;
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

            if (valueType != CommandArgumentType.Double)
            {
                var (rangeMin, rangeMax) = CommandArgumentDeclaration.IntegralRange(valueType);
                if (min < rangeMin || min > rangeMax || max < rangeMin || max > rangeMax)
                {
                    throw new InvalidOperationException(
                        $"OPC-UA node map: writable node {pointLabel} declares a [{min},{max}] range that overflows " +
                        $"its own value type {valueType}'s representable range [{rangeMin},{rangeMax}].");
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
