using System.Globalization;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Text.Json.Serialization;

namespace St4i.EngineApi.Alarms;

/// <summary>
/// Task C-3 (.superpowers/sdd/2026-07-30-dotC-alarm-notification-blueprint/task-3-brief.md) — the wire
/// contract of the alarm webhook: the HTTP headers, the JSON body, and the signature over them.
///
/// <para>🔴 <b>This type is a PUBLIC INTERFACE, not an implementation detail.</b> A customer writes a
/// receiver against it and we do not get to change it quietly afterwards. Everything here is therefore
/// versioned (<see cref="SpecVersion"/>), named explicitly with <see cref="JsonPropertyName"/> rather than
/// inherited from a C# identifier that a refactor could rename, and serialised with nulls PRESENT rather
/// than omitted — a receiver's schema must not watch fields appear and disappear depending on which edge
/// fired.</para>
/// </summary>
public static class WebhookContract
{
    /// <summary>The contract version carried in every body as <c>specVersion</c>. Bump only for a change a
    /// receiver written against the previous version could not survive; additive fields do not bump it,
    /// which is exactly why a receiver must ignore fields it does not recognise.</summary>
    public const int SpecVersion = 1;

    /// <summary>The body's <c>type</c> discriminator. A receiver multiplexing several ST4I integrations on
    /// one endpoint switches on this rather than guessing from the shape.</summary>
    public const string EventType = "st4i.alarm.edge";

    /// <summary>Hex-encoded HMAC-SHA256 of the signed material, prefixed with the scheme tag
    /// <c>v1=</c>. Absent entirely when no signing secret is configured — see
    /// <see cref="WebhookSigner"/>.</summary>
    public const string SignatureHeader = "X-ST4I-Signature";

    /// <summary>Unix time in SECONDS at the moment this attempt was built. Part of the signed material, so
    /// it cannot be altered by whoever captured the request. Absent when unsigned.</summary>
    public const string TimestampHeader = "X-ST4I-Timestamp";

    /// <summary>The delivery identifier, duplicated from the body so a receiver can dedup without parsing
    /// JSON. STABLE across every retry of the same notification to the same webhook instance.</summary>
    public const string DeliveryHeader = "X-ST4I-Delivery";

    /// <summary>The <see cref="AlarmEdgeKind"/>, duplicated from the body so a receiver can route (or
    /// cheaply drop <see cref="AlarmEdgeKind.Restored"/>) without parsing JSON.</summary>
    public const string EventHeader = "X-ST4I-Event";

    /// <summary>The scheme tag on <see cref="SignatureHeader"/>. A tag rather than a bare hex digest so a
    /// future scheme (a different hash, a different signed material) can be introduced alongside this one
    /// and a receiver can tell which it is looking at instead of failing to verify for reasons it cannot
    /// diagnose.</summary>
    public const string SignatureScheme = "v1";

    /// <summary>Identifies this product in <c>User-Agent</c>. Deliberately carries no version of the host
    /// machine, no hostname and nothing else an unauthenticated receiver did not need to be told.</summary>
    public const string UserAgent = "st4i-machine-simulator-alarm-webhook/1";

    /// <summary>
    /// The serializer settings the body is produced with, exposed because the SIGNATURE is over the exact
    /// bytes these settings produce.
    ///
    /// <para>Two deliberate choices. <see cref="JsonIgnoreCondition.Never"/>: a null field is EMITTED as
    /// <c>null</c> rather than omitted, so <c>alarm.ackedBy</c> exists in every body and a receiver's
    /// schema is stable across edge kinds. And the DEFAULT (strict) encoder rather than
    /// <c>UnsafeRelaxedJsonEscaping</c>: alarm messages are operator-facing free text that a receiver very
    /// commonly renders into HTML, so <c>&lt;</c>, <c>&gt;</c> and <c>&amp;</c> escaping is worth more than
    /// a human-readable Vietnamese message in a raw body that no human reads anyway.</para>
    /// </summary>
    internal static readonly JsonSerializerOptions Json = new()
    {
        DefaultIgnoreCondition = JsonIgnoreCondition.Never,
        WriteIndented = false,
    };

    /// <summary>ISO-8601, UTC, with an explicit <c>Z</c>. Formatted into a <see cref="string"/> in the
    /// payload records rather than left as a <see cref="DateTimeOffset"/> for the serializer to render,
    /// so the wire format is pinned by this method and not by a serializer default that a future .NET
    /// upgrade could move.</summary>
    public static string FormatUtc(DateTimeOffset value) =>
        value.ToUniversalTime().ToString("yyyy-MM-dd'T'HH:mm:ss.fffffff'Z'", CultureInfo.InvariantCulture);
}

/// <summary>Task C-3 — WHERE the notification came from. Answers "which machine is telling me this?", which
/// is a different question from <see cref="WebhookPayloadAlarm.TargetId"/> ("which machine is the alarm
/// ABOUT?") — one simulator host runs a whole fleet.</summary>
/// <param name="Product">A fixed product identifier, so a receiver aggregating several vendors can tell
/// whose message this is without relying on the URL it arrived at.</param>
/// <param name="Host">The hostname of the machine running the engine. Not a credential, and the single
/// most useful field when the same webhook receives from several plants.</param>
/// <param name="ChannelInstance">Which configured webhook instance produced this — <c>default</c>,
/// <c>mes</c>, etc. Lets a receiver behind two configured destinations tell them apart.</param>
public sealed record WebhookPayloadSource(
    [property: JsonPropertyName("product")] string Product,
    [property: JsonPropertyName("host")] string Host,
    [property: JsonPropertyName("channelInstance")] string ChannelInstance);

/// <summary>Task C-3 — WHAT changed. This, not the alarm's own state, is why a message was sent at all: the
/// notification layer fires on EDGES (see <see cref="AlarmNotifier"/>), so a receiver that treats every
/// message as "an alarm is happening" will be wrong for four of the five kinds.</summary>
/// <param name="Kind">The <see cref="AlarmEdgeKind"/> member name — <c>Raised</c>, <c>Escalated</c>,
/// <c>Acked</c>, <c>Cleared</c> or <c>Restored</c>. 🔴 <c>Restored</c> means "this alarm was ALREADY
/// standing when the engine restarted"; it is not a new condition, and a receiver that pages on it will
/// page on every restart.</param>
/// <param name="Sequence">C-1's per-process, strictly increasing ordinal. Lets a receiver order two
/// messages about one alarm without trusting clocks. RESETS TO ZERO on restart — pair it with
/// <see cref="Source.Host"/> and <see cref="AtUtc"/> for cross-restart identity.</param>
/// <param name="AtUtc">When the edge was detected.</param>
/// <param name="PreviousPriority">Non-null only for <c>Escalated</c>: the priority the alarm held
/// before.</param>
/// <param name="Actor">The operator who acked or cleared, or null for a system-originated edge.</param>
public sealed record WebhookPayloadEdge(
    [property: JsonPropertyName("kind")] string Kind,
    [property: JsonPropertyName("sequence")] long Sequence,
    [property: JsonPropertyName("atUtc")] string AtUtc,
    [property: JsonPropertyName("previousPriority")] string? PreviousPriority,
    [property: JsonPropertyName("actor")] string? Actor);

/// <summary>
/// Task C-3 — the alarm as it stood AT the edge (never re-queried; see <see cref="NotificationJob"/>).
///
/// <para>🔴 <b><see cref="Alarm.Id"/> is deliberately NOT here.</b> It is the SQLite <c>rowid</c>, and this
/// repository already established (C-1 review round 2) that SQLite hands a deleted high-water rowid straight
/// back to the next insert — so a receiver keying on it would silently merge two unrelated alarms. The
/// stable identifier is <see cref="Key"/>.</para>
/// </summary>
/// <param name="Key">The dedup identity: source + code + target. Stable across restarts, and what a
/// receiver should correlate a <c>Cleared</c> back to its <c>Raised</c> with.</param>
/// <param name="Source">The <see cref="AlarmSource"/> member name.</param>
/// <param name="Code">The machine-readable condition code.</param>
/// <param name="Priority">The <see cref="AlarmPriority"/> member name. Only <c>Critical</c> and <c>High</c>
/// occur in this build.</param>
/// <param name="State">The <see cref="AlarmState"/> member name as it stood at the edge.</param>
/// <param name="Message">Operator-facing free text.</param>
/// <param name="Runbook">An optional pointer at what to do about it.</param>
/// <param name="TargetId">Which machine (or <c>fleet</c>) the alarm is ABOUT.</param>
/// <param name="ClearOnAck">Whether this is an EVENT alarm (acking clears it) or a CONDITION alarm (acking
/// only silences it). A receiver rendering "is this still on?" needs it.</param>
/// <param name="Count">How many times the condition has been restated since it was first raised — the
/// number the edge detector exists to keep OFF the wire.</param>
public sealed record WebhookPayloadAlarm(
    [property: JsonPropertyName("key")] string Key,
    [property: JsonPropertyName("source")] string Source,
    [property: JsonPropertyName("code")] string Code,
    [property: JsonPropertyName("priority")] string Priority,
    [property: JsonPropertyName("state")] string State,
    [property: JsonPropertyName("message")] string Message,
    [property: JsonPropertyName("runbook")] string? Runbook,
    [property: JsonPropertyName("targetId")] string? TargetId,
    [property: JsonPropertyName("clearOnAck")] bool ClearOnAck,
    [property: JsonPropertyName("count")] int Count,
    [property: JsonPropertyName("firstRaisedUtc")] string FirstRaisedUtc,
    [property: JsonPropertyName("lastRaisedUtc")] string LastRaisedUtc,
    [property: JsonPropertyName("ackedUtc")] string? AckedUtc,
    [property: JsonPropertyName("ackedBy")] string? AckedBy);

/// <summary>
/// Task C-3 — the whole body.
/// </summary>
/// <param name="Text">
/// 🔴 <b>The Slack/Teams compatibility field, and the reason one payload reaches all four targets.</b>
///
/// <para>The blueprint's premise is that a webhook has "the widest reach per line of code — Slack, Teams,
/// MES, Zabbix". That is only true with this field. A Slack incoming webhook REJECTS a body with no
/// <c>text</c> (or <c>blocks</c>) as <c>invalid_payload</c>, and a legacy Teams Office-365 connector
/// behaves the same way; both ignore top-level keys they do not recognise. So a single body carrying a
/// human-readable one-liner AND the structured objects below posts unmodified to a Slack channel, a Teams
/// channel, and a custom MES/Zabbix receiver — without this product growing a per-vendor formatter.</para>
///
/// <para>A structured consumer must read <paramref name="Alarm"/> and <paramref name="Edge"/> and treat
/// this as display text: its wording is not part of the contract and WILL change.</para>
/// </param>
/// <param name="SpecVersion">See <see cref="WebhookContract.SpecVersion"/>.</param>
/// <param name="Type">See <see cref="WebhookContract.EventType"/>.</param>
/// <param name="DeliveryId">
/// 🔴 The idempotency key. STABLE across every retry of this notification to this webhook instance, and
/// distinct for every other (notification, instance) pair.
///
/// <para>This is what makes the retry policy safe for a receiver: an attempt that timed out may well have
/// been delivered, so a retry can genuinely duplicate. A receiver that records this value and drops a
/// repeat gets at-most-once behaviour out of an at-least-once sender. Without it, "retry on timeout" is a
/// duplicate generator.</para>
/// </param>
/// <param name="SentAtUtc">When THIS attempt was built — moves between retries, unlike
/// <paramref name="DeliveryId"/> and unlike <c>edge.atUtc</c>.</param>
public sealed record WebhookPayload(
    [property: JsonPropertyName("text")] string Text,
    [property: JsonPropertyName("specVersion")] int SpecVersion,
    [property: JsonPropertyName("type")] string Type,
    [property: JsonPropertyName("deliveryId")] string DeliveryId,
    [property: JsonPropertyName("sentAtUtc")] string SentAtUtc,
    [property: JsonPropertyName("source")] WebhookPayloadSource Source,
    [property: JsonPropertyName("edge")] WebhookPayloadEdge Edge,
    [property: JsonPropertyName("alarm")] WebhookPayloadAlarm Alarm)
{
    /// <summary>Builds the body for one notification. Pure — no I/O, no clock beyond
    /// <paramref name="sentAtUtc"/> — so the exact bytes a receiver will see are directly testable.</summary>
    public static WebhookPayload From(
        NotificationJob job, string sourceHost, string channelInstance, string deliveryId,
        DateTimeOffset sentAtUtc)
    {
        ArgumentNullException.ThrowIfNull(job);

        var alarm = job.Alarm;
        return new WebhookPayload(
            Text: BuildText(job, sourceHost),
            SpecVersion: WebhookContract.SpecVersion,
            Type: WebhookContract.EventType,
            DeliveryId: deliveryId,
            SentAtUtc: WebhookContract.FormatUtc(sentAtUtc),
            Source: new WebhookPayloadSource("st4i-machine-simulator", sourceHost, channelInstance),
            Edge: new WebhookPayloadEdge(
                job.Edge.ToString(),
                job.Sequence,
                WebhookContract.FormatUtc(job.AtUtc),
                job.PreviousPriority?.ToString(),
                job.Actor),
            Alarm: new WebhookPayloadAlarm(
                alarm.Key,
                alarm.Source.ToString(),
                alarm.Code,
                alarm.Priority.ToString(),
                alarm.State.ToString(),
                alarm.Message,
                alarm.Runbook,
                alarm.TargetId,
                alarm.ClearOnAck,
                alarm.Count,
                WebhookContract.FormatUtc(alarm.FirstRaisedUtc),
                WebhookContract.FormatUtc(alarm.LastRaisedUtc),
                alarm.AckedUtc is { } acked ? WebhookContract.FormatUtc(acked) : null,
                alarm.AckedBy));
    }

    /// <summary>The one-line human summary. Front-loads priority and edge kind because that is what a
    /// person scanning a Slack channel needs before anything else.</summary>
    private static string BuildText(NotificationJob job, string sourceHost)
    {
        var alarm = job.Alarm;
        var target = string.IsNullOrWhiteSpace(alarm.TargetId) ? "fleet" : alarm.TargetId;
        var actor = string.IsNullOrWhiteSpace(job.Actor) ? "" : $" by {job.Actor}";
        var escalation = job.PreviousPriority is { } previous ? $" (was {previous})" : "";
        return $"[{alarm.Priority.ToString().ToUpperInvariant()}] {job.Edge.ToString().ToUpperInvariant()}" +
               $"{escalation}{actor} — {alarm.Source}/{alarm.Code} on {target}: {alarm.Message} " +
               $"(engine {sourceHost})";
    }

    /// <summary>The exact bytes that are POSTed AND the exact bytes that are signed. One method so those two
    /// can never be different bytes — the failure that makes a signature unverifiable in a way nobody can
    /// debug from the receiving end.</summary>
    public byte[] ToUtf8Bytes() => JsonSerializer.SerializeToUtf8Bytes(this, WebhookContract.Json);
}

/// <summary>
/// 🔴 Task C-3 — the signature, and the recipe a receiver implements to verify it.
///
/// <para><b>Why sign at all.</b> A receiver on a plant LAN cannot otherwise tell this product's POST from
/// anyone else's: the destination URL is frequently the only secret, and a URL leaks through proxy logs,
/// browser history, screenshots and support bundles. The signature lets a receiver reject a body that was
/// tampered with in transit AND a body that was never produced by the machine holding the key.</para>
///
/// <para>The receiver-facing version of everything below, including a worked example, is
/// <c>docs/ALARM_WEBHOOK_CONTRACT.md</c> — that document and this comment must not drift apart.</para>
///
/// <para>🔴 <b>THE VERIFICATION RECIPE — implement exactly this.</b> Given the raw request body BYTES
/// (before any JSON parsing or re-serialisation — a re-serialised body will not verify), the
/// <c>X-ST4I-Timestamp</c> header and the <c>X-ST4I-Signature</c> header:</para>
/// <code>
///   1. Reject if X-ST4I-Signature is absent, or does not start with "v1=".
///   2. Reject if |now - X-ST4I-Timestamp| > 300 seconds.        # replay window
///   3. signedMaterial = utf8(X-ST4I-Timestamp) + utf8(".") + rawBodyBytes
///   4. expected = "v1=" + lowercase_hex(HMAC_SHA256(key = utf8(sharedSecret),
///                                                   message = signedMaterial))
///   5. Accept iff constant_time_equals(expected, X-ST4I-Signature).
///   6. Drop the message if body.deliveryId has been seen before.  # closes the replay window
/// </code>
///
/// <para><b>Why the timestamp is INSIDE the signed material</b> rather than merely sent alongside: a
/// timestamp a captured request can be re-stamped with protects nothing. Signing
/// <c>timestamp + "." + body</c> binds the two, so an attacker replaying a captured POST must replay the
/// original timestamp too — and step 2 then bounds how long that capture is worth anything to five
/// minutes.</para>
///
/// <para>🔴 <b>Five minutes is a window, not a wall, and step 6 is not optional.</b> Within the tolerance a
/// captured request replays perfectly — that is inherent to any timestamp-bounded scheme, including Slack's
/// and Stripe's. What closes it is <c>deliveryId</c>: it is stable across this sender's own retries and
/// unique per notification, so a receiver that records it gets both replay rejection AND correct dedup of
/// legitimate retries from one mechanism. A receiver that skips step 6 is exposed for 300 seconds per
/// captured request, and will also duplicate every notification this sender retries after a timeout.</para>
///
/// <para><b>The separator matters.</b> Without the <c>.</c>, timestamp <c>1234</c> with a body starting
/// <c>5{...</c> and timestamp <c>12345</c> with a body starting <c>{...</c> produce identical signed
/// material — a length-extension-flavoured ambiguity that costs one byte to remove. The body is JSON and
/// therefore always starts with <c>{</c>, so the separator is unambiguous.</para>
///
/// <para><b>When there is no secret, there is no header.</b> An unsigned POST omits BOTH
/// <c>X-ST4I-Signature</c> and <c>X-ST4I-Timestamp</c> rather than sending an empty or placeholder value —
/// a receiver checking "is the header present" must not be able to be fooled by a blank one. This state is
/// legitimate: a Slack or Teams incoming-webhook URL IS the credential and those services verify nothing,
/// so demanding a signing secret would make the most common configuration impossible. A receiver that
/// requires signatures must reject an unsigned request itself — this sender cannot know it should have
/// signed.</para>
/// </summary>
public static class WebhookSigner
{
    /// <summary>The replay tolerance a receiver is told to enforce (step 2). Stated here so the recipe, the
    /// documentation and the tests all quote one number.</summary>
    public const int ReplayToleranceSeconds = 300;

    /// <summary>The signature header value for <paramref name="body"/> at
    /// <paramref name="unixTimeSeconds"/>, or <see langword="null"/> when
    /// <paramref name="signingSecret"/> is absent — in which case NO signature or timestamp header is sent
    /// at all.</summary>
    public static string? Sign(byte[] body, long unixTimeSeconds, string? signingSecret)
    {
        ArgumentNullException.ThrowIfNull(body);
        if (string.IsNullOrEmpty(signingSecret)) return null;

        var timestamp = Encoding.UTF8.GetBytes(unixTimeSeconds.ToString(CultureInfo.InvariantCulture));
        var material = new byte[timestamp.Length + 1 + body.Length];
        timestamp.CopyTo(material, 0);
        material[timestamp.Length] = (byte)'.';
        body.CopyTo(material, timestamp.Length + 1);

        var digest = HMACSHA256.HashData(Encoding.UTF8.GetBytes(signingSecret), material);
        return $"{WebhookContract.SignatureScheme}={Convert.ToHexString(digest).ToLowerInvariant()}";
    }
}

/// <summary>
/// 🔴 Task C-3 — the answer to the gap C-2 named and left open: <b>a generic MES or Zabbix receiver that
/// authenticates by a static bearer token.</b>
///
/// <para><b>Why HMAC alone was not sufficient, which is the argument C-2's brief asked for.</b> The
/// signature proves authenticity to code that knows to look for it. A receiver's AUTH layer is almost never
/// that code: it is nginx checking <c>Authorization</c>, an API gateway checking <c>X-Api-Key</c>, or
/// Zabbix's own token check — all of which run BEFORE anything that could compute an HMAC, and none of
/// which has ever heard of <c>X-ST4I-Signature</c>. Such a receiver does not reject our POST for being
/// unsigned; it rejects it with a 401 for being unauthenticated, and no amount of signing changes that.
/// Leaving this out would mean the widest-reach channel could not be pointed at two of the four targets
/// the blueprint names.</para>
///
/// <para>🔴 <b>What was NOT done, and why the shape matters.</b> C-2 refused free-form custom headers on
/// the grounds that a key/value blob cannot be structurally partitioned into secret and non-secret, and
/// that refusal stands — this is the escape hatch C-2 designed instead: <b>one non-secret header NAME
/// column</b> (<c>webhook_config.auth_header_name</c>, visible in every public read, because knowing that a
/// webhook authenticates with <c>X-Api-Key</c> authorises nobody) plus <b>one named DPAPI secret</b>
/// (<see cref="NotificationSecretNames.WebhookAuthToken"/>) holding the value. The partition is in the
/// schema, not in a convention: there is no place to put a credential that is not the encrypted table.</para>
///
/// <para>🔴 <b>The stored secret is the COMPLETE header value, verbatim.</b> For a bearer token an
/// operator stores <c>Bearer eyJhb…</c>, INCLUDING the scheme word; for <c>X-Api-Key</c> they store the
/// key alone. The product prepends nothing and infers nothing. One rule that is occasionally inconvenient
/// beats a scheme-guessing heuristic that is silently wrong for whichever half of the receivers it did not
/// anticipate.</para>
/// </summary>
public static class WebhookAuthHeader
{
    /// <summary>Generous but bounded — an unbounded name column in a configuration store is how a log line
    /// or a UI eventually gets a surprise (the same reasoning as
    /// <see cref="NotificationConfigStore.MaxLabelLength"/>).</summary>
    public const int MaxNameLength = 64;

    /// <summary>
    /// 🔴 Header names this channel sets itself, or that the HTTP stack owns. Configuring one of these
    /// would let a notification configuration OVERWRITE THE SIGNATURE — the single most damaging thing a
    /// non-secret configuration field could be allowed to do — or corrupt framing. Rejected at SAVE time
    /// rather than skipped at send time, so the bad configuration cannot be stored and then quietly ignored.
    /// </summary>
    private static readonly HashSet<string> Reserved = new(StringComparer.OrdinalIgnoreCase)
    {
        WebhookContract.SignatureHeader,
        WebhookContract.TimestampHeader,
        WebhookContract.DeliveryHeader,
        WebhookContract.EventHeader,
        "Content-Type", "Content-Length", "Content-Encoding", "User-Agent",
        "Host", "Connection", "Transfer-Encoding", "Expect", "Upgrade", "TE", "Trailer",
    };

    /// <summary>RFC 9110 <c>token</c> characters. Anything outside this set is not a header name, and a
    /// CR or LF inside one is a request-splitting primitive — so this is a security check, not
    /// tidiness.</summary>
    private const string TokenChars = "!#$%&'*+-.^_`|~0123456789" +
        "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ";

    /// <summary>Whether <paramref name="name"/> may be stored as a webhook's authentication header name.
    /// <paramref name="reason"/> is safe to log: it names the header, never a value.</summary>
    public static bool IsValidName(string? name, out string reason)
    {
        if (string.IsNullOrWhiteSpace(name))
        {
            reason = "A webhook authentication header name must not be blank.";
            return false;
        }

        if (name.Length > MaxNameLength)
        {
            reason = $"A webhook authentication header name may be at most {MaxNameLength} characters.";
            return false;
        }

        foreach (var c in name)
        {
            if (!TokenChars.Contains(c, StringComparison.Ordinal))
            {
                reason = "A webhook authentication header name may contain only RFC 9110 token characters.";
                return false;
            }
        }

        if (Reserved.Contains(name))
        {
            reason = $"'{name}' is set by the webhook channel itself or by the HTTP stack and cannot be " +
                     "used to carry authentication.";
            return false;
        }

        reason = "";
        return true;
    }

    /// <summary>Whether the stored token is usable as an HTTP header VALUE. Checked before it is handed to
    /// <see cref="System.Net.Http.Headers.HttpHeaders"/> so the failure an operator sees names the problem
    /// rather than surfacing as a <see cref="FormatException"/> — and so nothing that looks like a CRLF ever
    /// reaches the request builder. 🔴 The token itself is never returned, logged or echoed.</summary>
    public static bool IsValidValue(string? token) =>
        !string.IsNullOrEmpty(token) && !token.Any(c => char.IsControl(c));
}
