using System.Security.Cryptography;
using System.Text;
using System.Text.Encodings.Web;
using System.Text.Json;

namespace St4i.EdgeCore.Config;

/// <summary>
/// Computes the sha256-of-stable-stringified-JSON checksum the server uses as its authoritative
/// drift key for recipe/device_settings payloads (CONFIG_SYNC_SERVER_CONTRACT.md, System A:
/// <c>checksum = sha256(stableStringify(payload))</c>). Mirrors <c>server/db/machineRecipe.ts</c>'s
/// <c>stableStringify</c> algorithm exactly: object keys sorted ordinally (recursively — nested
/// objects too), arrays keep their original element order, primitives serialize via
/// JSON.stringify-equivalent rules:
/// <code>
/// function stableStringify(value) {
///   if (value === null || typeof value !== "object") return JSON.stringify(value);
///   if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
///   const keys = Object.keys(value).sort();
///   return `{${keys.map(k => `${JSON.stringify(k)}:${stableStringify(value[k])}`).join(",")}}`;
/// }
/// </code>
/// Input can be any JSON-serializable graph (a <c>Dictionary&lt;string, object?&gt;</c> — the
/// common case, e.g. <see cref="Recipe.Payload"/> — a POCO, an already-parsed
/// <see cref="JsonElement"/>, ...): it is normalized to a <see cref="JsonElement"/> tree first so
/// every input shape hashes the same way regardless of the CLR type it started as.
///
/// This is a best-effort mirror, not a byte-for-byte guarantee across runtimes: floating-point
/// number formatting and a handful of Unicode-escaping edge cases (lone surrogates, U+2028/U+2029)
/// can differ between .NET's JSON writer and a JS engine's <c>JSON.stringify</c> for pathological
/// inputs. What IS guaranteed here — and is what actually matters for local versioning/diffing
/// before a real server is in the loop — is that it's deterministic and key-order-independent on
/// this side. See <see cref="JavaScriptEncoder.UnsafeRelaxedJsonEscaping"/> below for why the string
/// encoder specifically was NOT left at STJ's default (which would escape Vietnamese diacritics and
/// characters like <c>&lt;</c>/<c>&amp;</c> that JS's <c>JSON.stringify</c> leaves alone, e.g. in a
/// recipe's <c>notes</c> field).
/// </summary>
public static class ConfigChecksum
{
    private static readonly JsonSerializerOptions SerializeOptions = new()
    {
        // STJ's default encoder is HTML-safe (escapes '<','>','&','\'' and most non-ASCII) — the
        // right choice for a browser response, the wrong choice here: JS's JSON.stringify only
        // escapes what JSON syntax actually requires ('"','\\', control chars), so a Vietnamese
        // product/point name or recipe note would stable-stringify to different bytes — and thus a
        // different checksum — on this side vs. the server's, purely from over-escaping.
        Encoder = JavaScriptEncoder.UnsafeRelaxedJsonEscaping,
    };

    /// <summary>Computes the lowercase-hex sha256 of <paramref name="payload"/>'s stable-stringified
    /// form.</summary>
    public static string Compute(object? payload)
    {
        using var doc = JsonSerializer.SerializeToDocument(payload, SerializeOptions);
        return Compute(doc.RootElement);
    }

    /// <summary>Same as <see cref="Compute(object?)"/> but takes an already-parsed
    /// <see cref="JsonElement"/> directly (e.g. a value freshly read off the wire) — avoids a
    /// redundant serialize round-trip.</summary>
    public static string Compute(JsonElement payload)
    {
        var sb = new StringBuilder();
        StableStringify(payload, sb);
        var hash = SHA256.HashData(Encoding.UTF8.GetBytes(sb.ToString()));
        return Convert.ToHexString(hash).ToLowerInvariant();
    }

    /// <summary>
    /// Task C8 — deterministic, ORDER-INDEPENDENT content checksum for a product's ACTIVE measurement
    /// points: the checksum-first drift key (docs/CONFIG_SYNC_STANDARDS_RESEARCH.md §5 — "adopt a
    /// content hash as binary identity, like OPC UA's <c>InternalId</c>... surface it as the drift key,
    /// matching CFX's checksum-first drift comparison"), mirroring this project's OWN server-side
    /// <c>computeDriftState</c> (server/services/configDriftService.ts: "when BOTH carry a checksum it
    /// is authoritative (byte-exact); otherwise fall back to (code, version) equality").
    ///
    /// Points are canonicalized — filtered to non-tombstoned (<see cref="MeasurementPoint.IsDeleted"/>
    /// false) and sorted by <see cref="MeasurementPoint.Code"/> (ordinal) — before hashing, so the SAME
    /// active-point SET always checksums identically no matter what order the caller's list (or each
    /// point's <see cref="MeasurementPoint.OrderIndex"/>) happens to be in; callers do not need to
    /// pre-filter or pre-sort.
    ///
    /// <see cref="MeasurementPoint.LastModifiedAt"/>/<see cref="MeasurementPoint.DeletedAt"/>/
    /// <see cref="MeasurementPoint.DeletedAtVersion"/> are stripped from each point before hashing —
    /// audit/tombstone metadata, not spec content. Without this, two points with byte-identical spec
    /// but different edit timestamps (e.g. a no-op re-save, or a push that resurrects a previously
    /// tombstoned point) would checksum differently and look like drift when nothing observable
    /// actually changed.
    /// </summary>
    public static string ComputePointsChecksum(IEnumerable<MeasurementPoint> points)
    {
        ArgumentNullException.ThrowIfNull(points);

        using var doc = JsonSerializer.SerializeToDocument(
            points.Where(p => !p.IsDeleted).OrderBy(p => p.Code, StringComparer.Ordinal).ToList(),
            SerializeOptions);

        var canonicalPoints = doc.RootElement.EnumerateArray().Select(el => StripFields(el, AuditFieldNames)).ToList();
        return Compute(canonicalPoints);
    }

    private static readonly HashSet<string> AuditFieldNames = new(StringComparer.Ordinal)
    {
        nameof(MeasurementPoint.LastModifiedAt),
        nameof(MeasurementPoint.DeletedAt),
        nameof(MeasurementPoint.DeletedAtVersion),
    };

    /// <summary>Just <see cref="MeasurementPoint.LastModifiedAt"/> — the ONE field a push merge always
    /// refreshes to "now" even when nothing else about the point changed. Deliberately narrower than
    /// <see cref="AuditFieldNames"/>: <see cref="PointContentEquals"/> uses this set (not the full audit
    /// set) because a tombstone resurrection/deletion (<see cref="MeasurementPoint.DeletedAt"/>/
    /// <see cref="MeasurementPoint.DeletedAtVersion"/> changing) IS a real, observable content change for
    /// "did this push actually do anything" purposes — unlike for the checksum/diff's drift-key purpose,
    /// where those two are correctly excluded (see <see cref="ComputePointsChecksum"/>'s own doc
    /// comment).</summary>
    private static readonly HashSet<string> TimestampOnlyFieldName = new(StringComparer.Ordinal)
    {
        nameof(MeasurementPoint.LastModifiedAt),
    };

    /// <summary>
    /// Task review #1 — canonicalizes ONE point the exact same way <see cref="ComputePointsChecksum"/>
    /// canonicalizes each point in a set (serialize, then strip <see cref="AuditFieldNames"/>), WITHOUT
    /// hashing — so a caller needing an apples-to-apples FULL-SPEC, property-by-property comparison of two
    /// points (the field-level diff, <c>ConfigSyncEngine.DiffFields</c> in <c>St4i.EngineApi</c>)
    /// reuses the exact same field set the drift-key checksum uses. This is what guarantees the diff and
    /// the checksum-based drift badge can never disagree about what counts as "the spec": if a field is
    /// (or isn't) part of the hash, it's (or isn't) part of the diff too, by construction — there is no
    /// separate, hand-maintained field list to fall out of sync.
    /// </summary>
    public static IReadOnlyDictionary<string, JsonElement> CanonicalizePoint(MeasurementPoint point) =>
        CanonicalizePoint(point, AuditFieldNames);

    /// <summary>
    /// Task review #2 — "did a re-push actually change this point's content", the check
    /// <c>SimulatedEcosystem.SyncPointsAsync</c> needs before counting a point toward
    /// <c>PointsUpdated</c>/bumping the product version: a redundant push of BYTE-IDENTICAL content must
    /// not inflate the version number or leave a misleading "pushed vN→vN+1" history row. Compares the
    /// FULL spec (same field set <see cref="CanonicalizePoint(MeasurementPoint)"/> uses) PLUS the
    /// tombstone fields (<see cref="MeasurementPoint.DeletedAt"/>/<see cref="MeasurementPoint.DeletedAtVersion"/>)
    /// — only <see cref="MeasurementPoint.LastModifiedAt"/> is excluded, since a push merge always
    /// refreshes it to "now" even on a genuine no-op and would otherwise make every comparison report
    /// "changed". Excluding the tombstone fields too (like the checksum/diff do) would WRONGLY treat
    /// resurrecting a previously-deleted point as a no-op.
    /// </summary>
    public static bool PointContentEquals(MeasurementPoint a, MeasurementPoint b)
    {
        var canonicalA = CanonicalizePoint(a, TimestampOnlyFieldName);
        var canonicalB = CanonicalizePoint(b, TimestampOnlyFieldName);
        return Compute(canonicalA) == Compute(canonicalB);
    }

    private static IReadOnlyDictionary<string, JsonElement> CanonicalizePoint(MeasurementPoint point, HashSet<string> excludeFields)
    {
        ArgumentNullException.ThrowIfNull(point);
        using var doc = JsonSerializer.SerializeToDocument(point, SerializeOptions);
        return StripFields(doc.RootElement, excludeFields);
    }

    /// <summary>Re-shapes one already-serialized point <see cref="JsonElement"/> into a plain
    /// string-keyed dictionary with <paramref name="excludeFields"/> removed, so <see cref="Compute(object?)"/>
    /// can hash the result like any other input (a fresh <see cref="JsonSerializer.SerializeToDocument"/>
    /// round-trip on a filtered/re-typed clone would be needlessly expensive — this just walks the
    /// object's own properties once). Each kept value is <see cref="JsonElement.Clone"/>d: the source
    /// <paramref name="point"/> comes from a <c>using var doc = JsonSerializer.SerializeToDocument(...)</c>
    /// the caller disposes at the end of ITS OWN method (see <see cref="CanonicalizePoint(MeasurementPoint, HashSet{string})"/>)
    /// — <see cref="CanonicalizePoint(MeasurementPoint)"/>/<see cref="PointContentEquals"/> hand this
    /// dictionary back to code OUTSIDE that scope (e.g. <c>ConfigSyncEngine.DiffFields</c>, one assembly
    /// over), so an un-cloned <see cref="JsonElement"/> would throw <see cref="ObjectDisposedException"/>
    /// the moment anything tries to read it after the source document is gone. Cloning makes every
    /// returned value independently alive, matching the "hand out something the caller can hold onto"
    /// contract an <c>IReadOnlyDictionary</c> return type implies.</summary>
    private static Dictionary<string, JsonElement> StripFields(JsonElement point, HashSet<string> excludeFields)
    {
        var dict = new Dictionary<string, JsonElement>();
        foreach (var prop in point.EnumerateObject())
        {
            if (excludeFields.Contains(prop.Name)) continue;
            dict[prop.Name] = prop.Value.Clone();
        }

        return dict;
    }

    private static void StableStringify(JsonElement el, StringBuilder sb)
    {
        switch (el.ValueKind)
        {
            case JsonValueKind.Object:
                sb.Append('{');
                var firstProp = true;
                foreach (var prop in el.EnumerateObject().OrderBy(p => p.Name, StringComparer.Ordinal))
                {
                    if (!firstProp) sb.Append(',');
                    firstProp = false;
                    sb.Append(JsonSerializer.Serialize(prop.Name, SerializeOptions));
                    sb.Append(':');
                    StableStringify(prop.Value, sb);
                }
                sb.Append('}');
                break;

            case JsonValueKind.Array:
                sb.Append('[');
                var firstItem = true;
                foreach (var item in el.EnumerateArray())
                {
                    if (!firstItem) sb.Append(',');
                    firstItem = false;
                    StableStringify(item, sb);
                }
                sb.Append(']');
                break;

            case JsonValueKind.String:
                sb.Append(JsonSerializer.Serialize(el.GetString(), SerializeOptions));
                break;

            case JsonValueKind.Number:
                // Raw text as originally written — avoids re-formatting a value we didn't produce
                // (e.g. one just parsed off the wire) through a second, potentially lossy pass.
                sb.Append(el.GetRawText());
                break;

            case JsonValueKind.True:
                sb.Append("true");
                break;

            case JsonValueKind.False:
                sb.Append("false");
                break;

            default: // Null / Undefined
                sb.Append("null");
                break;
        }
    }
}
