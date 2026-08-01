using System.Globalization;
using System.Text.Json;
using System.Text.Json.Serialization;

namespace St4i.Connector.Abstractions.Json;

/// <summary>
/// GP-2 — reads/writes the untyped <c>object?</c> domain used by
/// <see cref="St4i.Connector.Abstractions.Models.TelemetrySample.Value"/> and the values of
/// <see cref="St4i.Connector.Abstractions.Models.DeviceReading.Genealogy"/>. Registered for
/// <see cref="object"/> in <see cref="ConnectorJson.Options"/>, which is what makes it apply to both:
/// System.Text.Json consults the registered <see cref="object"/> converter for every property/dictionary
/// slot whose static CLR type is exactly <see cref="object"/>.
///
/// <para><b>The failure this replaces:</b> without a converter registered here, System.Text.Json's own
/// default behaviour for an <see cref="object"/>-typed member is to deserialize it into a
/// <see cref="JsonElement"/>. <see cref="JsonElement"/> is NOT <see cref="IConvertible"/>, so every
/// numeric-telemetry aggregation site that goes through
/// <see cref="St4i.Connector.Abstractions.Models.TelemetryNumeric.TryGet"/> would silently start
/// returning <see langword="false"/> for every reading that ever crossed a sidecar process boundary — no
/// exception, no log, the value just vanishes. This converter instead reads JSON straight back into CLR
/// primitives that already work everywhere <see cref="TelemetryNumeric"/>/<c>Normalizer</c>/
/// <c>LiveTransport</c> already expect (see task-2-report.md for exactly what was checked at each site).</para>
///
/// <para><b>Domain (verified against every concrete driver + parser in this repo — task-2-brief.md's
/// "documented value domain"):</b> <see cref="TelemetrySample.Value"/> is
/// <c>double | bool | string | null</c> (only <c>OpcUaDriver.BoxValue</c> ever produces a non-numeric
/// string — a status tag like <c>"RUNNING"</c>; every numeric OPC-UA type it handles widens to
/// <see cref="double"/>; <c>IotSensorSim</c>/<c>ModbusTcpDriver</c> are always <see cref="double"/>).
/// <see cref="DeviceReading.Genealogy"/> values are <c>string | int | double</c>
/// (<c>Doc28Parser.Parse</c>: <c>lotCode</c>/<c>panelId</c>/<c>operatorId</c> → string,
/// <c>boardIndex</c> → int, <c>cycleTimeSec</c> → double). This converter's accepted CLR write-domain is
/// WIDER than that documented minimum, though: <c>null | bool | string</c>, every standard CLR
/// integral-numeric primitive (<see cref="sbyte"/>/<see cref="byte"/>/<see cref="short"/>/
/// <see cref="ushort"/>/<see cref="int"/>/<see cref="uint"/>/<see cref="long"/>/<see cref="ulong"/> — all
/// widen losslessly to <see cref="long"/>, EXCEPT a <see cref="ulong"/> exceeding
/// <see cref="long.MaxValue"/>, which is rejected — see <c>WriteIntegral</c>), and both
/// <see cref="float"/> and <see cref="double"/> (a <see cref="float"/> widens losslessly to
/// <see cref="double"/> — every 32-bit float value has an exact 64-bit double representation). Review
/// round 1 (task-2-report.md "Fix round 1"): the FIRST version of this converter only accepted exactly
/// <c>int | long | double</c> and rejected e.g. a <see cref="float"/> telemetry value with the SAME
/// <see cref="JsonException"/> a genuinely out-of-domain <see cref="DateTime"/> gets — but
/// <see cref="TelemetryNumeric.TryGet"/>, <c>Normalizer.CoerceToNumber</c>, and
/// <c>LiveTransport.GetDouble</c> all ALREADY accept <see cref="float"/>/<see cref="short"/>/etc.
/// in-process today, so the narrower domain would have handed the first third-party driver author who
/// wrote <c>Value = someFloatSensorReading</c> a hard failure at the sidecar boundary for a value that
/// works everywhere else — exactly the kind of surprise decision (b) exists to prevent, not enable.
/// <see cref="decimal"/> is the one CLR numeric primitive still explicitly rejected — widening it to
/// <see cref="double"/> IS genuinely lossy (decimal keeps ~28-29 significant digits; double keeps
/// ~15-17), so it gets its own named <c>case decimal</c> arm with a message explaining why, rather than
/// silently falling into the generic "unknown type" default arm below.</para>
///
/// <para><b>Decision (a) — integral numbers.</b> JSON text cannot distinguish the abstract values <c>5</c>
/// and <c>5.0</c>, but a JSON NUMBER TOKEN'S OWN LEXICAL SHAPE can: <see cref="Utf8JsonReader.TryGetInt64"/>
/// succeeds only when the token contains no decimal point/exponent, REGARDLESS of the numeric value
/// (empirically confirmed while building this: <c>"12.0"</c> fails <c>TryGetInt64</c> even though 12.0 is
/// mathematically an integer — see task-2-report.md). So: <list type="bullet">
/// <item><description>WRITE — an <see cref="int"/>/<see cref="long"/> value is written as a bare integer
/// literal (no decimal point). A <see cref="double"/> value is written with a decimal-point/exponent
/// marker FORCED even when it happens to be a whole number (<c>20.0</c> writes as the text
/// <c>"20.0"</c>, never the shortest-round-trippable-but-ambiguous <c>"20"</c> that
/// <see cref="Utf8JsonWriter.WriteNumberValue(double)"/> would otherwise produce) — otherwise an entirely
/// ordinary whole-number telemetry reading (e.g. a temperature sample of exactly 20°C) would be lexically
/// indistinguishable on the wire from a genuine integer and would silently come back as <see cref="long"/>
/// instead of <see cref="double"/>.</description></item>
/// <item><description>READ — a JSON number token becomes <see cref="long"/> when
/// <see cref="Utf8JsonReader.TryGetInt64"/> succeeds (fits in 64 bits AND the token has no decimal
/// point/exponent), <see cref="double"/> otherwise. This keeps <c>Genealogy["boardIndex"]</c> an integer
/// across the round trip (never re-emerging as <c>5.0</c>, a wire-format-visible change) while keeping a
/// genuine <see cref="double"/> telemetry value a <see cref="double"/> even when its value is
/// whole.</description></item>
/// </list>
/// Confirmed this does not break any existing consumer: <see cref="long"/> IS <see cref="IConvertible"/>,
/// so <see cref="TelemetryNumeric.TryGet"/> resolves it exactly like any other numeric input (see
/// <c>Decision_A_*</c> tests in <c>ConnectorRoundTripTests</c>, which feed the converter's OWN
/// <see cref="long"/> output through <see cref="TelemetryNumeric.TryGet"/> rather than a hand-written
/// literal). <c>St4i.EdgeCore.Mapping.Normalizer.CoerceToNumber</c>'s numeric-type switch already lists
/// <c>double or float or int or long or short or decimal</c>, and
/// <c>St4i.EdgeCore.Transport.LiveTransport.GetDouble</c>'s switch already lists
/// <c>double, float, int, long, short, decimal</c> — both already treat <see cref="long"/> identically to
/// <see cref="int"/>/<see cref="double"/>, with no code change required in either (see
/// task-2-report.md).</para>
///
/// <para><b>Decision (b) — out-of-domain values: reject loudly, never silently coerce.</b> A
/// <see cref="DateTime"/>, an array, or a nested object assigned to
/// <see cref="TelemetrySample.Value"/>/a <see cref="DeviceReading.Genealogy"/> value is outside the
/// documented domain above. Letting it fall through to whatever System.Text.Json's reflection-based
/// serializer would otherwise do to it (e.g. a <see cref="DateTime"/> silently becoming an ISO-8601
/// <see cref="string"/>) is exactly the kind of silent, type-changing surprise at a process boundary this
/// whole task exists to close off — a receiving sidecar would have no way to tell "this was always a
/// string" from "this used to be something else and got coerced". So: <c>Write</c> throws
/// <see cref="JsonException"/> for any CLR value outside the widened numeric domain described above
/// (including non-finite <see cref="double"/>s — <see cref="double.NaN"/>/±<see cref="double.PositiveInfinity"/>
/// are not valid JSON at all, and <see cref="decimal"/>/an overflowing <see cref="ulong"/>, both genuinely
/// lossy to widen), and <c>Read</c> throws <see cref="JsonException"/> for a JSON array/object
/// token, or for a number token so large it can only be represented as a non-finite <see cref="double"/>
/// (symmetric with the WRITE-side NaN/Infinity rejection).</para>
///
/// <para><b>Decision (b)'s blast radius (review round 1 — read this before building the sidecar host):</b>
/// throwing from <c>Write</c> aborts serialization of the ENTIRE <see cref="DeviceReading"/> being
/// serialized, not just the one offending value — <see cref="JsonSerializer.Serialize{TValue}(TValue, JsonSerializerOptions)"/>
/// has no "skip this one field and continue" mode once a converter throws partway through an object
/// graph. That is a deliberate escalation from today's IN-PROCESS behaviour, where
/// <see cref="TelemetryNumeric.TryGet"/> merely skips a value it cannot convert and every other value in
/// the same reading is unaffected. At a process boundary that escalation is the right call — see this
/// class doc's opening paragraphs on why silent coercion is worse — but it means whoever builds the
/// sidecar host MUST wrap each reading's serialize call in its own try/catch and quarantine (log +
/// drop/dead-letter) the ONE bad reading, or a single buggy third-party driver emitting one out-of-domain
/// value kills its entire reading stream, not just that one sample.</para>
/// </summary>
public sealed class ConnectorObjectConverter : JsonConverter<object?>
{
    private static readonly char[] FloatingPointMarkerChars = ['.', 'e', 'E'];

    public override object? Read(ref Utf8JsonReader reader, Type typeToConvert, JsonSerializerOptions options)
    {
        switch (reader.TokenType)
        {
            case JsonTokenType.Null:
                return null;

            case JsonTokenType.True:
                return true;

            case JsonTokenType.False:
                return false;

            case JsonTokenType.String:
                // Always the raw string, unconditionally — never attempt to reinterpret it as a number.
                // The wire format is already self-describing here: a JSON STRING token (quoted) means
                // "this was a string", full stop, even if its contents happen to look numeric. Conflating
                // the two is exactly the kind of guessing decision (b) rejects elsewhere.
                return reader.GetString();

            case JsonTokenType.Number:
                if (reader.TryGetInt64(out var integral))
                {
                    return integral;
                }

                if (reader.TryGetDouble(out var floating))
                {
                    if (double.IsInfinity(floating))
                    {
                        // A JSON number so large its only double representation is +/-Infinity is not a
                        // value this converter's own WRITE side could ever have produced (WriteFloating
                        // below rejects non-finite doubles outright) — reject symmetrically on READ too
                        // rather than silently manufacturing a non-finite double no downstream consumer
                        // documented above is prepared to see.
                        throw new JsonException(
                            "Connector object? domain: JSON number token overflows to a non-finite double " +
                            "(+/-Infinity) — rejecting loudly rather than silently producing a non-finite value.");
                    }

                    return floating;
                }

                throw new JsonException("Connector object? domain: JSON number token could not be read as Int64 or Double.");

            case JsonTokenType.StartArray:
                throw new JsonException(
                    "Connector object? domain is null|bool|string|number — a JSON array is out of domain " +
                    "(decision (b): reject loudly, see ConnectorObjectConverter's class doc comment).");

            case JsonTokenType.StartObject:
                throw new JsonException(
                    "Connector object? domain is null|bool|string|number — a JSON object is out of domain " +
                    "(decision (b): reject loudly, see ConnectorObjectConverter's class doc comment).");

            default:
                throw new JsonException($"Connector object? domain: unexpected token {reader.TokenType}.");
        }
    }

    public override void Write(Utf8JsonWriter writer, object? value, JsonSerializerOptions options)
    {
        switch (value)
        {
            case null:
                writer.WriteNullValue();
                return;

            case bool b:
                writer.WriteBooleanValue(b);
                return;

            case string s:
                writer.WriteStringValue(s);
                return;

            // Review round 1: widened from the original "exactly int|long" to every standard CLR
            // integral-numeric primitive — a float/short/byte/etc. telemetry value already works
            // in-process (TelemetryNumeric.TryGet/Normalizer.CoerceToNumber/LiveTransport.GetDouble all
            // already accept it), so rejecting it only at the sidecar boundary would be exactly the
            // surprise decision (b) exists to prevent, not cause. All of these widen to long losslessly
            // (ulong is the one exception — handled, not silently truncated, inside WriteIntegral).
            case sbyte or byte or short or ushort or int or uint or long or ulong:
                WriteIntegral(writer, value);
                return;

            // float widens to double losslessly (every 32-bit float value has an exact 64-bit double
            // representation) — same WriteFloating path double itself uses, including the forced
            // decimal-point marker (decision (a)) and the NaN/Infinity rejection.
            case float f:
                WriteFloating(writer, f);
                return;

            case double d:
                WriteFloating(writer, d);
                return;

            case decimal:
                // The one CLR numeric primitive still explicitly rejected, not merely uncovered: unlike
                // every arm above, there is no lossless path to this converter's one floating-point wire
                // representation (double) — decimal keeps ~28-29 significant digits, double keeps
                // ~15-17. Named explicitly (its own case, its own message) rather than left to fall into
                // the generic "unknown type" default below, per review round 1.
                throw new JsonException(
                    $"Value of type {value.GetType()} (decimal) is explicitly rejected: widening it to " +
                    "double would silently lose precision (decimal keeps ~28-29 significant digits, " +
                    "double keeps ~15-17). Rejecting loudly rather than silently coercing — see " +
                    "ConnectorObjectConverter's class doc comment, decision (b).");

            default:
                // Decision (b): reject loudly. A DateTime/Guid/array/List<T>/nested POCO/JsonElement/etc.
                // is outside the documented object? domain — throwing here (rather than letting
                // System.Text.Json's reflection-based fallback silently stringify/serialize it) is the
                // whole point: a silent type change at a process boundary is the exact failure class this
                // task exists to close off.
                throw new JsonException(
                    $"Value of type {value.GetType()} is outside the connector wire contract's documented " +
                    "object? domain (null|bool|string|any integral CLR numeric primitive|float|double). " +
                    "Rejecting loudly rather than silently coercing — see ConnectorObjectConverter's class " +
                    "doc comment, decision (b).");
        }
    }

    private static void WriteIntegral(Utf8JsonWriter writer, object value)
    {
        long asLong;
        try
        {
            asLong = Convert.ToInt64(value, CultureInfo.InvariantCulture);
        }
        catch (OverflowException)
        {
            // Only reachable for a ulong greater than long.MaxValue. Widening THAT to double would be
            // genuinely lossy (double cannot exactly represent every 64-bit integer) — the same reason
            // `decimal` is rejected above rather than silently coerced, not a special case of its own.
            throw new JsonException(
                $"Value {value} ({value.GetType()}) exceeds long.MaxValue and cannot be represented on " +
                "the wire without lossy widening to double — rejecting loudly rather than silently " +
                "losing precision, see ConnectorObjectConverter's class doc comment, decision (b).");
        }

        writer.WriteNumberValue(asLong);
    }

    private static void WriteFloating(Utf8JsonWriter writer, double d)
    {
        if (double.IsNaN(d) || double.IsInfinity(d))
        {
            // Not valid JSON at all (RFC 8259 has no token for NaN/Infinity). System.Text.Json's own
            // writer would throw an ArgumentException here anyway if asked to write these directly — this
            // check makes the rejection an explicit, documented JsonException with a message that
            // explains WHY, rather than relying on an incidental exception type/message from deeper
            // inside the writer.
            throw new JsonException(
                $"Value {d} is not representable as a JSON number (NaN/Infinity are not valid JSON) — " +
                "rejecting loudly rather than silently coercing, see ConnectorObjectConverter's class doc " +
                "comment, decision (b).");
        }

        // Force a decimal-point/exponent marker so a whole-number double round-trips as a double, not an
        // integer (decision (a)) — System.Text.Json's own shortest-round-trippable text for e.g. 20.0 is
        // "20" with NO marker, which Utf8JsonReader.TryGetInt64 (this converter's own Read, above) would
        // otherwise happily accept as an integer literal.
        var text = d.ToString("R", CultureInfo.InvariantCulture);
        if (text.IndexOfAny(FloatingPointMarkerChars) < 0)
        {
            text += ".0";
        }

        // WriteRawValue: `text` was just produced by `double.ToString("R")` (optionally with a literal
        // ".0" appended), so it is always valid, already-normalized JSON number syntax — skipping the
        // writer's own validation pass here is safe and avoids re-parsing text we just formatted.
        writer.WriteRawValue(text, skipInputValidation: true);
    }
}
