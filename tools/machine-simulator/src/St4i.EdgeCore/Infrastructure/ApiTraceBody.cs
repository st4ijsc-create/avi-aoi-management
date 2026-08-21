using System.Collections;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using St4i.EdgeCore.Models;

namespace St4i.EdgeCore.Infrastructure;

/// <summary>
/// 🔴 Task AT-1 — owner item 27, THE OWNER'S RULING of 2026-08-22. The SEPARATE lane for the request body.
/// <para>This type exists because the ruling forbade the obvious alternative. Adding a body member to
/// <see cref="ApiTraceEvent"/> would have changed the shape of THREE already-published payloads — the
/// <c>WS /v1/inspector/stream</c> frame and the two JSON files the web and WPF Export buttons write to a
/// user's disk — and task AS-1 measured on 2026-08-21 that two of those three have no consumer count
/// behind them at all. So <see cref="ApiTraceEvent"/> keeps its ten members and its wire shape to the
/// byte, and everything about the body travels here instead.</para>
/// <para>🔴 <b>A NEW surface is not a FREE surface</b>, and three conditions ride with it. They are
/// implemented in <see cref="From"/> rather than at any render site, because this record is what enters
/// the engine's in-memory ring: masking applied at a UI would leave the unmasked copy in RAM, which is the
/// thing being avoided.</para>
/// <list type="number">
///   <item><description><b>An ALLOWLIST, not a denylist.</b> <see cref="CanonicalEnvelope.Payload"/> is an
///   untyped <c>Dictionary&lt;string, object&gt;</c> and <c>Normalizer</c> forwards every unrecognised
///   genealogy key straight into it, so the key space is open-ended and operator-supplied. A denylist over
///   an open key space cannot be closed — one new driver field defeats it. Only
///   <see cref="AllowedKeys"/> is ever rendered with its value.</description></item>
///   <item><description><b>A byte cap that SAYS it capped.</b> See <see cref="RetainedByteCap"/> and
///   <see cref="Truncated"/>. Item 28's finding was a UI printing a cap's VALUE without ever naming it as
///   a cap; this record carries the cap and the fact that it bit as data, so no reader has to infer
///   either.</description></item>
///   <item><description><b>What was hidden is NAMED.</b> <see cref="WithheldKeys"/> lists the keys that
///   were not rendered, so a reader can never mistake this for the whole body. Naming them leaks nothing
///   the key set does not already reveal, and withholding them silently would produce exactly the
///   false confidence this record is meant to prevent.</description></item>
/// </list>
/// <para>🔴 <b>What this surface does NOT do, stated so nobody infers otherwise.</b> It does not show
/// measured VALUES. Item 27's own body names customer measurement data — readings, serial numbers, recipe
/// codes — as the real reason to say no, so metric values, waveform samples, measurement results, the
/// serial number and the recipe are all withheld BY NAME rather than rendered. This answers "what am I
/// sending, which fields are present, and how many of each" and it deliberately does not answer "what did
/// the part measure". It is also NOT a record of what went on the wire: the cap bounds what is RETAINED
/// here, never what was sent.</para>
/// </summary>
/// <param name="At">The publishing instant, stamped by the caller from the SAME clock read as its
/// <see cref="ApiTraceEvent.At"/>, which is what lets a reader line the two up. There is no id on
/// <see cref="ApiTraceEvent"/> to join on and this ruling did not permit adding one.</param>
/// <param name="MachineCode">The machine the reading came from — the second half of the correlation
/// handle, and the only one that disambiguates two machines stamped in the same tick.</param>
/// <param name="Path">The ingest route as this repository spells it, copied from
/// <see cref="CanonicalEnvelope.Path"/> exactly as <c>EdgePipeline</c> copies it into
/// <see cref="ApiTraceEvent.Path"/>.</param>
/// <param name="IdempotencyDigest">A short SHA-256 digest of the reading's idempotency key. Stable across
/// a retry, so it answers "is this the same reading again?" — the question the raw key is actually wanted
/// for — without carrying the key itself.
/// <para>🔴 It is a DIGEST rather than the key because the key is not the structural identifier it looks
/// like. <c>Normalizer.BuildIdempotencyKey</c> composes it from customer data: every shape embeds the
/// RECIPE CODE, and the inspection shape embeds the SERIAL NUMBER as well. Both are named in owner item
/// 27's own body as reasons to withhold, so publishing the key would have leaked through an allowlist
/// built to stop exactly that. This was caught by this feature's own test, not by review.</para>
/// <para>🔴 And the honest limit, stated rather than implied: this is DE-IDENTIFICATION, not secrecy. The
/// input has low entropy and a known format, so anyone holding the machine roster can confirm a guess by
/// digesting it. It stops a body dump from casually disclosing recipe codes and serial numbers; it does
/// not withstand a party who already knows what to look for.</para></param>
/// <param name="Json">The rendered, allowlisted body. 🔴 When <paramref name="Truncated"/> is
/// <see langword="true"/> this is a BYTE PREFIX and is therefore NOT parseable JSON — that flag is the
/// only way to know, which is why it is not optional.</param>
/// <param name="Truncated">Whether <see cref="RetainedByteCap"/> actually bit.</param>
/// <param name="RetainedByteCap">The cap that was applied, carried as data so the surface names its own
/// ceiling instead of leaving a reader to discover it.</param>
/// <param name="RenderedByteCount">How many bytes the allowlisted render came to BEFORE the cap. Larger
/// than <paramref name="RetainedByteCap"/> exactly when <paramref name="Truncated"/> is set.</param>
/// <param name="WithheldKeys">The names of the payload keys that were not rendered, capped at
/// <see cref="MaxWithheldKeysListed"/> entries.</param>
/// <param name="WithheldKeyCount">How many keys were withheld in total — the number
/// <paramref name="WithheldKeys"/> may itself have been capped away from.</param>
public sealed record ApiTraceBody(
    DateTimeOffset At,
    string MachineCode,
    string Path,
    string IdempotencyDigest,
    string Json,
    bool Truncated,
    int RetainedByteCap,
    int RenderedByteCount,
    IReadOnlyList<string> WithheldKeys,
    int WithheldKeyCount)
{
    /// <summary>🔴 The retained-body ceiling: 16 KiB per body. It is a MEASURED choice, not a round number,
    /// and both halves of the measurement are worth stating.
    /// <para>What it does not touch: the largest body this product's own generators emit today is a
    /// 24-point welder process result at <b>1 314 bytes</b> measured (20-point screwdriver: 1 207 bytes; a
    /// telemetry body: 255 bytes; a process result with no waveform at all: 285 bytes). Every shape this
    /// repository ships is an order of magnitude under this cap, so nothing shipped is truncated
    /// today.</para>
    /// <para>What it does touch, and this is the case it exists for: the generators are not the ceiling —
    /// a third-party Modbus/OPC UA/hot-folder driver supplies whatever it likes, and <c>src/</c> contains
    /// no size limit of any kind on an outgoing body to inherit (AS-1 measured that scan empty on
    /// 2026-08-21). A 100 000-sample waveform — the figure owner item 14 and the ecosystem's own
    /// <c>openapi.ts</c> both name — measures <b>2 169 909 bytes</b>, about 2.07 MiB, and IS truncated
    /// here, with <see cref="Truncated"/> set to say so.</para>
    /// <para>The other half of why 16 KiB: this record is retained in the engine's trace ring, which holds
    /// <see cref="EventBus.DefaultCapacity"/> entries, so the ceiling on what this feature can add to a
    /// long-running edge process is <c>500 × 16 KiB = 8 MiB</c>. That product is the actual budget being
    /// set; the per-body number is derived from it.</para></summary>
    public const int DefaultByteCap = 16 * 1024;

    /// <summary>How many withheld key NAMES are listed before the list itself is cut. Genealogy keys are
    /// operator-supplied and unbounded in both count and length, so an uncapped name list would be a second
    /// unbounded allocation behind a feature whose entire point is that it is bounded.
    /// <see cref="WithheldKeyCount"/> always reports the true total.</summary>
    public const int MaxWithheldKeysListed = 64;

    /// <summary>🔴 The ALLOWLIST — the complete set of payload keys ever rendered with their value, and the
    /// reason this feature is not a data-at-rest surface. Every one is structural: a schema version, a
    /// route-level identifier, a verdict token, a timestamp. None of them is a measurement, a serial
    /// number, a recipe or an operator-supplied string.
    /// <para>Enumerated from all three shapes <c>Normalizer</c> builds. Process result contributes
    /// <c>schemaVersion, machineCode, stepType, result, ts</c>; inspection contributes
    /// <c>overallResult, inspectionTime</c> alongside the same shared three; telemetry contributes nothing —
    /// its only key is <c>samples</c>, which is measurement data and is withheld, so a telemetry body
    /// renders as an empty object with <c>samples</c> named as withheld.</para>
    /// <para>🔴 Deliberately ABSENT, each for a reason item 27 states in its own body: <c>serialNumber</c>
    /// and the <c>recipe</c> block are customer identifiers; <c>metrics</c>, <c>waveforms</c>,
    /// <c>measurements</c> and <c>samples</c> are customer measurement data; and every genealogy key is
    /// absent by construction, since anything not on this list is withheld whether or not it was
    /// foreseen.</para>
    /// <para>🔴 <c>idempotencyKey</c> is absent too, and it is the one worth explaining because it looks
    /// structural and is not. <c>Normalizer.BuildIdempotencyKey</c> builds it out of the recipe code — and,
    /// on the inspection shape, the serial number — so allowlisting it would have re-admitted through the
    /// front door exactly the two values the entries above withhold. It was on this list until this
    /// feature's own test compared rendered VALUES rather than key names and caught it. What survives of it
    /// is <see cref="IdempotencyDigest"/>, which answers the retry question without carrying the
    /// constituents. The general lesson is on the list itself: an allowlist is only as good as the
    /// assumption that its members are what their names suggest.</para></summary>
    public static readonly IReadOnlySet<string> AllowedKeys = new HashSet<string>(StringComparer.Ordinal)
    {
        "schemaVersion", "machineCode", "stepType", "result", "ts",
        "overallResult", "inspectionTime",
    };

    private static readonly JsonSerializerOptions RenderOptions = new(JsonSerializerDefaults.Web);

    /// <summary>How many hex characters of the SHA-256 are kept: 16, i.e. 64 bits. Enough that two distinct
    /// readings colliding inside a 500-entry ring is not a practical concern, short enough that nobody is
    /// tempted to read it as the key itself.</summary>
    private const int DigestHexLength = 16;

    private static string DigestOf(string idempotencyKey)
    {
        var hash = SHA256.HashData(Encoding.UTF8.GetBytes(idempotencyKey));
        return Convert.ToHexString(hash)[..DigestHexLength].ToLowerInvariant();
    }

    /// <summary>Builds the retained body from an envelope, applying the allowlist, the cap and the
    /// withheld-name accounting in that order. Called at the point the trace event is constructed — the
    /// masking has to happen before the record enters the ring, not at a render site.
    /// <para>It never throws: a payload key whose value will not serialize is treated as withheld rather
    /// than propagating an exception into the send loop, because nothing about producing a diagnostic view
    /// may affect whether a reading is delivered.</para></summary>
    /// <param name="env">The envelope whose <see cref="CanonicalEnvelope.Payload"/> is being described.</param>
    /// <param name="at">The same clock read used for the paired <see cref="ApiTraceEvent.At"/>.</param>
    /// <param name="byteCap">Overrides <see cref="DefaultByteCap"/>; non-positive selects the default.</param>
    public static ApiTraceBody From(CanonicalEnvelope env, DateTimeOffset at, int byteCap = DefaultByteCap)
    {
        ArgumentNullException.ThrowIfNull(env);
        if (byteCap <= 0) byteCap = DefaultByteCap;

        var rendered = new Dictionary<string, object?>(StringComparer.Ordinal);
        var withheld = new List<string>();

        foreach (var kv in env.Payload)
        {
            if (AllowedKeys.Contains(kv.Key))
            {
                rendered[kv.Key] = kv.Value;
            }
            else
            {
                // The NAME plus, for a collection, how many elements it had. A count is shape, not content:
                // it is what makes this list useful for the question item 27 was opened to answer, and it
                // discloses nothing a reader could not get by counting rows they are allowed to see.
                withheld.Add(kv.Value is ICollection collection && kv.Value is not string
                    ? $"{kv.Key}[{collection.Count}]"
                    : kv.Key);
            }
        }

        string json;
        try
        {
            json = JsonSerializer.Serialize(rendered, RenderOptions);
        }
        catch (NotSupportedException)
        {
            // An allowlisted value that will not serialize: report the shape as empty rather than fail the
            // send loop, and say so in the withheld list so the gap is visible.
            json = "{}";
            withheld.Add("(unserializable allowlisted value)");
        }

        var renderedBytes = Encoding.UTF8.GetByteCount(json);
        var truncated = renderedBytes > byteCap;
        if (truncated)
        {
            var raw = Encoding.UTF8.GetBytes(json);
            json = Encoding.UTF8.GetString(raw, 0, byteCap);
        }

        var listed = withheld.Count > MaxWithheldKeysListed
            ? withheld.GetRange(0, MaxWithheldKeysListed)
            : withheld;

        return new ApiTraceBody(
            At: at,
            MachineCode: env.MachineCode,
            Path: env.Path,
            IdempotencyDigest: DigestOf(env.IdempotencyKey),
            Json: json,
            Truncated: truncated,
            RetainedByteCap: byteCap,
            RenderedByteCount: renderedBytes,
            WithheldKeys: listed,
            WithheldKeyCount: withheld.Count);
    }
}
