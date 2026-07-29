namespace St4i.Connector.Abstractions.Models;

/// <summary>
/// Task B-3 (.superpowers/sdd/2026-07-29-dotB-machine-control-blueprint/task-3-brief.md) — the closed set of
/// wire-level value types a map can declare for a <see cref="CommandArgumentDeclaration"/> (a
/// <see cref="CommandRequest.Arguments"/> entry) or an OPC-UA writable node's own value type. Deliberately
/// minimal — mirrors <see cref="St4i.EdgeCore.Drivers.Modbus.ModbusDataType"/>'s own "deliberately minimal for
/// G2-6" idiom: <see cref="Int64"/>/<see cref="UInt64"/>/<see cref="Single"/> are a documented, deferred
/// follow-up, not built here, because nothing in this batch's scoped protocols (Modbus 16-bit registers,
/// the OPC-UA MVP surface this codebase drives) needs them yet.
/// </summary>
public enum CommandArgumentType
{
    Bool,
    Int16,
    UInt16,
    Int32,
    UInt32,
    Double,
    String,
}

/// <summary>
/// Task B-3 — one named argument a <see cref="CommandRequest"/> may carry, and the type it must be narrowed
/// to before a driver ever uses it. Existing separately from <see cref="St4i.EdgeCore.Drivers.Modbus.ModbusCommand"/>/
/// <see cref="St4i.EdgeCore.Drivers.OpcUa.OpcUaCommand"/> (which reference this type rather than each
/// declaring their own argument shape) so the narrowing logic below is written, and tested, exactly once —
/// shared by both protocols' command declarations, and by an OPC-UA writable setpoint's own value-type
/// narrowing (<see cref="St4i.EdgeCore.Drivers.OpcUa.OpcUaWritableSetpoint.TryNarrowForWrite"/>), which needs
/// the identical "narrow a declared numeric type, bounds-checked" logic for a different reason (the OPC-UA
/// <c>Variant</c> the driver eventually writes needs an exact CLR type, not whatever <see cref="object"/>
/// domain the value arrived in).
///
/// <para><b>Why this exists at all — B-1's own documented gap.</b> <see cref="CommandRequest.Arguments"/>'s
/// own doc comment says its value domain carries NO type information: an OPC-UA argument typed
/// <see cref="CommandArgumentType.UInt16"/> on the wire arrives in <see cref="CommandRequest.Arguments"/> as a
/// boxed <see cref="long"/> (every CLR integral primitive widens to <see langword="long"/> —
/// <see cref="Json.ConnectorObjectConverter"/>'s own domain), and "an implementation must expect to RE-NARROW
/// a value against whatever type the map actually declares for that argument" — that map declaration is
/// exactly this type, and <see cref="TryNarrow"/> is the re-narrowing B-1's doc comment says is
/// needed.</para>
///
/// <para><b><see cref="Min"/>/<see cref="Max"/> are optional</b> — unlike a writable SETPOINT's own physical
/// bounds (mandatory, enforced at parse time — see <see cref="St4i.EdgeCore.Drivers.Modbus.ModbusWritableRange"/>/
/// <see cref="St4i.EdgeCore.Drivers.OpcUa.OpcUaWritableSetpoint"/>), the task brief's mandatory-limits rule
/// names "a writable point" specifically, not a command argument — <see cref="CommandRejectionReason.InvalidArgument"/>'s
/// own doc comment covers "a missing required argument, or a value/type that does not match", which a bare
/// type check already satisfies without a declared range. A range is still accepted, and enforced by
/// <see cref="TryNarrow"/> when given, for a command whose author DOES want one (e.g. a "SetMode" command's
/// numeric mode argument only having three legal values) — just never required.</para>
///
/// <para><see cref="ValidateSelf"/> is a schema-shape check (is this declaration internally consistent —
/// non-blank name, a range only where a range means something, <see cref="Min"/> ≤ <see cref="Max"/>), run
/// explicitly by each map's own <c>FromJson</c> with full context (which command, which argument) rather than
/// thrown from this record's own constructor — <c>System.Text.Json</c>'s exception-wrapping behavior for a
/// throwing record constructor reached via nested-array deserialization is not something either map's
/// <c>FromJson</c> wants to depend on to still name the offending point/command precisely (the brief's own
/// "reject at parse time, with a message naming the point" requirement) — so this type is a plain, never-
/// throwing data holder, and every map's <c>FromJson</c> is the one place validation failures turn into a
/// contextualized <see cref="InvalidOperationException"/>.</para>
/// </summary>
/// <param name="Name">The argument's name — the key a caller supplies in <see cref="CommandRequest.Arguments"/>.</param>
/// <param name="Type">The wire-level type this argument must narrow to before use.</param>
/// <param name="Min">Optional lower bound (inclusive), meaningful only for a numeric <paramref name="Type"/>.</param>
/// <param name="Max">Optional upper bound (inclusive), meaningful only for a numeric <paramref name="Type"/>.</param>
public sealed record CommandArgumentDeclaration(string Name, CommandArgumentType Type, double? Min = null, double? Max = null)
{
    /// <summary>
    /// Schema-shape self-check — see this record's own class doc comment for why this is a plain method,
    /// not constructor validation. Returns <see langword="null"/> when this declaration is internally
    /// consistent; otherwise an operator-readable message (naming this argument by <see cref="Name"/>) the
    /// caller should prefix with its own command/point context before surfacing or throwing.
    /// </summary>
    public string? ValidateSelf()
    {
        if (string.IsNullOrWhiteSpace(Name))
        {
            return "argument name must be non-blank";
        }

        if ((Type is CommandArgumentType.Bool or CommandArgumentType.String) && (Min is not null || Max is not null))
        {
            return $"argument '{Name}': min/max bounds are only meaningful for a numeric type — declared type is {Type}";
        }

        if (Min is not null && Max is not null && Min > Max)
        {
            return $"argument '{Name}': min ({Min}) must be <= max ({Max})";
        }

        return null;
    }

    /// <summary>
    /// The inclusive representable range of one of the four integral <see cref="CommandArgumentType"/>
    /// members — the SAME bound <see cref="TryNarrow"/> checks a raw <see cref="long"/> against before
    /// narrowing. Exposed publicly so a caller (a future driver, or a test) can reuse the identical bound
    /// this type checks against, rather than re-deriving <c>short.MinValue</c>/<c>ushort.MaxValue</c>/etc.
    /// itself. Throws for <see cref="CommandArgumentType.Bool"/>/<see cref="CommandArgumentType.String"/> —
    /// "representable range" has no meaning for either.
    /// </summary>
    public static (long Min, long Max) IntegralRange(CommandArgumentType type) => type switch
    {
        CommandArgumentType.Int16 => (short.MinValue, short.MaxValue),
        CommandArgumentType.UInt16 => (ushort.MinValue, ushort.MaxValue),
        CommandArgumentType.Int32 => (int.MinValue, int.MaxValue),
        CommandArgumentType.UInt32 => (uint.MinValue, uint.MaxValue),
        _ => throw new ArgumentOutOfRangeException(nameof(type), type, "IntegralRange is only meaningful for Int16/UInt16/Int32/UInt32."),
    };

    /// <summary>
    /// The re-narrowing B-1's own doc comment says an implementation must perform: given the raw
    /// <see cref="object"/>? a caller supplied for this argument (via <see cref="CommandRequest.Arguments"/> —
    /// <see langword="bool"/>|<see langword="string"/>|<see langword="long"/>|<see langword="double"/>|
    /// <see langword="null"/>, the <see cref="Json.ConnectorObjectConverter"/> domain), attempts to produce the
    /// exact CLR value <see cref="Type"/> declares. Never throws — a type mismatch, an out-of-representable-
    /// range integral value, or a value outside a declared <see cref="Min"/>/<see cref="Max"/> all return
    /// <see langword="false"/> with an operator-readable <paramref name="error"/>, the same "cheap rejection,
    /// no I/O" shape <see cref="IWritableDeviceDriver.InvokeCommandAsync"/>'s own
    /// <see cref="CommandRejectionReason.InvalidArgument"/> is for.
    ///
    /// <para><b>Deliberately strict, never coercive</b> — a JSON value that arrived as <see langword="double"/>
    /// (e.g. the caller sent <c>20.5</c>) is never truncated/rounded into an integral <see cref="Type"/>; only
    /// a <see langword="long"/> (an integral-shaped JSON number, per <see cref="Json.ConnectorObjectConverter"/>'s
    /// own decision (a)) narrows to <see cref="CommandArgumentType.Int16"/>/<see cref="CommandArgumentType.UInt16"/>/
    /// <see cref="CommandArgumentType.Int32"/>/<see cref="CommandArgumentType.UInt32"/>. The reverse — a
    /// whole-number JSON value with no decimal marker arriving as <see langword="long"/> for a
    /// <see cref="CommandArgumentType.Double"/>-typed argument — IS widened (losslessly; every <see langword="long"/>
    /// this converter can produce fits exactly in a <see langword="double"/> mantissa... actually not exactly for
    /// the full <see langword="long"/> range, but for any value a real command argument would plausibly carry,
    /// and rejecting an ordinary whole-number setpoint like <c>"speed": 20</c> for a Double-typed argument would
    /// be a worse surprise than the reverse) — this one widening direction is accepted deliberately, mirroring
    /// why <see cref="Json.ConnectorObjectConverter"/> itself treats a whole-number double specially (decision
    /// (a)).</para>
    /// </summary>
    public bool TryNarrow(object? rawValue, out object? narrowed, out string? error)
    {
        switch (Type)
        {
            case CommandArgumentType.Bool:
                if (rawValue is bool boolValue)
                {
                    narrowed = boolValue;
                    error = null;
                    return true;
                }
                narrowed = null;
                error = $"argument '{Name}': expected {CommandArgumentType.Bool}, got {DescribeRuntimeType(rawValue)}";
                return false;

            case CommandArgumentType.String:
                if (rawValue is string stringValue)
                {
                    narrowed = stringValue;
                    error = null;
                    return true;
                }
                narrowed = null;
                error = $"argument '{Name}': expected {CommandArgumentType.String}, got {DescribeRuntimeType(rawValue)}";
                return false;

            case CommandArgumentType.Double:
                double asDouble;
                if (rawValue is double doubleValue)
                {
                    asDouble = doubleValue;
                }
                else if (rawValue is long longAsDouble)
                {
                    asDouble = longAsDouble;
                }
                else
                {
                    narrowed = null;
                    error = $"argument '{Name}': expected {CommandArgumentType.Double}, got {DescribeRuntimeType(rawValue)}";
                    return false;
                }

                if ((Min is { } minD && asDouble < minD) || (Max is { } maxD && asDouble > maxD))
                {
                    narrowed = null;
                    error = $"argument '{Name}': value {asDouble} is outside the declared [{Min},{Max}] range";
                    return false;
                }

                narrowed = asDouble;
                error = null;
                return true;

            case CommandArgumentType.Int16:
            case CommandArgumentType.UInt16:
            case CommandArgumentType.Int32:
            case CommandArgumentType.UInt32:
                if (rawValue is not long rawIntegral)
                {
                    narrowed = null;
                    error = $"argument '{Name}': expected {Type} (an integral JSON number), got {DescribeRuntimeType(rawValue)}";
                    return false;
                }

                var (rangeMin, rangeMax) = IntegralRange(Type);
                if (rawIntegral < rangeMin || rawIntegral > rangeMax)
                {
                    narrowed = null;
                    error = $"argument '{Name}': value {rawIntegral} is outside the {Type} representable range [{rangeMin},{rangeMax}]";
                    return false;
                }

                if ((Min is { } minI && rawIntegral < minI) || (Max is { } maxI && rawIntegral > maxI))
                {
                    narrowed = null;
                    error = $"argument '{Name}': value {rawIntegral} is outside the declared [{Min},{Max}] range";
                    return false;
                }

                narrowed = Type switch
                {
                    CommandArgumentType.Int16 => (short)rawIntegral,
                    CommandArgumentType.UInt16 => (ushort)rawIntegral,
                    CommandArgumentType.Int32 => (int)rawIntegral,
                    CommandArgumentType.UInt32 => (uint)rawIntegral,
                    _ => throw new ArgumentOutOfRangeException(nameof(Type), Type, "unreachable — every integral case is listed above."),
                };
                error = null;
                return true;

            default:
                narrowed = null;
                error = $"argument '{Name}': unsupported declared type {Type}";
                return false;
        }
    }

    /// <summary>
    /// Narrows every entry of <paramref name="supplied"/> against <paramref name="declared"/> in one pass —
    /// the whole-request shape <see cref="IWritableDeviceDriver.InvokeCommandAsync"/>'s own
    /// <see cref="CommandRejectionReason.InvalidArgument"/> doc comment describes: "a required argument was
    /// missing, or a supplied argument's value/type does not match what the command declares." Rejects (returns
    /// <see langword="false"/>) on the FIRST problem found, in declared-argument order: a missing required
    /// entry, a <see cref="TryNarrow"/> failure, or an entry in <paramref name="supplied"/> that names an
    /// argument <paramref name="declared"/> never declared at all (an unknown-argument typo must not be
    /// silently ignored). Never throws, never touches any device — this is the same "cheap rejection before any
    /// I/O" the interface itself requires of an actual <c>InvokeCommandAsync</c> implementation, available here
    /// so a future driver (B-4/B-5) does not have to re-derive this iteration itself.
    /// </summary>
    public static bool TryNarrowAll(
        IReadOnlyList<CommandArgumentDeclaration> declared,
        IReadOnlyDictionary<string, object>? supplied,
        out IReadOnlyDictionary<string, object?> narrowed,
        out string? error)
    {
        var suppliedSafe = supplied ?? new Dictionary<string, object>();
        var result = new Dictionary<string, object?>(StringComparer.Ordinal);

        foreach (var declaration in declared)
        {
            if (!suppliedSafe.TryGetValue(declaration.Name, out var rawValue))
            {
                narrowed = EmptyResult;
                error = $"missing required argument '{declaration.Name}'";
                return false;
            }

            if (!declaration.TryNarrow(rawValue, out var narrowedValue, out var narrowError))
            {
                narrowed = EmptyResult;
                error = narrowError;
                return false;
            }

            result[declaration.Name] = narrowedValue;
        }

        // Deliberately a hand-rolled loop, not `declared.Select(d => d.Name)` — this assembly is pinned at
        // zero dependencies beyond System.Runtime/System.Collections/System.Text.Json (see
        // ZeroDependencyTests.BuiltDll_ReferencesOnlyBcl_NoNewDependencyIntroduced); System.Linq is not one
        // of them, and pulling it in here just to build a name set is not worth reopening that boundary.
        var declaredNames = new HashSet<string>(StringComparer.Ordinal);
        foreach (var declaration in declared)
        {
            declaredNames.Add(declaration.Name);
        }

        foreach (var suppliedName in suppliedSafe.Keys)
        {
            if (!declaredNames.Contains(suppliedName))
            {
                narrowed = EmptyResult;
                error = $"unknown argument '{suppliedName}' — this command declares no such argument";
                return false;
            }
        }

        narrowed = result;
        error = null;
        return true;
    }

    private static readonly IReadOnlyDictionary<string, object?> EmptyResult = new Dictionary<string, object?>();

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
