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
