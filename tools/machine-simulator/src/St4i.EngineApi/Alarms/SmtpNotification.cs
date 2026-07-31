using System.Globalization;
using System.Security.Cryptography;
using System.Text;

namespace St4i.EngineApi.Alarms;

/// <summary>
/// Task C-4 (.superpowers/sdd/2026-07-30-dotC-alarm-notification-blueprint/task-4-brief.md) — the headers
/// this channel sets, and the two facts about the message shape that a mail-server operator or a C-8
/// documentation page needs to be able to quote.
/// </summary>
public static class SmtpContract
{
    /// <summary>The literal that starts every subject, so an operator can write ONE mailbox rule that
    /// catches every alarm this product sends and nothing else. Deliberately ASCII and deliberately not
    /// configurable: a filter token that varies per install is a filter token nobody can document.</summary>
    public const string SubjectTag = "[ST4I]";

    /// <summary>The alarm's dedup key, so a server-side rule (Sieve, an Exchange transport rule) can route
    /// or mute one specific alarm without parsing the body.</summary>
    public const string AlarmKeyHeader = "X-ST4I-Alarm-Key";

    /// <summary>The <see cref="AlarmPriority"/> member name — the header an on-call rotation filters on.</summary>
    public const string PriorityHeader = "X-ST4I-Priority";

    /// <summary>🔴 The <see cref="AlarmEdgeKind"/> member name. Worth its own header because FOUR of the
    /// five kinds are not "an alarm is happening", and a recipient who wants only <c>Raised</c> and
    /// <c>Escalated</c> should not have to read the body to get it.</summary>
    public const string EdgeHeader = "X-ST4I-Edge";

    /// <summary>The <see cref="AlarmSource"/> member name.</summary>
    public const string SourceHeader = "X-ST4I-Source";

    /// <summary>Which configured SMTP instance sent this, mirroring the webhook contract's
    /// <c>source.channelInstance</c>.</summary>
    public const string InstanceHeader = "X-ST4I-Instance";

    /// <summary>The engine hostname. In a header rather than only in the body so a mailbox receiving from
    /// several plants can be filtered per plant. Not in the <c>Message-ID</c> domain — see
    /// <see cref="SmtpMessageBuilder"/>.</summary>
    public const string HostHeader = "X-ST4I-Host";

    /// <summary>
    /// 🔴 RFC 3834. <b>The one header here that is load-bearing rather than convenient.</b> Without it, a
    /// recipient with an out-of-office auto-reply answers every alarm, and a shared ops mailbox with an
    /// auto-responder can bounce a reply back at the <c>From</c> address on every message — a mail loop
    /// started by an alarm storm. <c>Auto-Submitted: auto-generated</c> is the standard instruction to every
    /// conforming responder not to reply.
    /// </summary>
    public const string AutoSubmittedHeader = "Auto-Submitted";

    /// <summary>The value for <see cref="AutoSubmittedHeader"/>.</summary>
    public const string AutoSubmittedValue = "auto-generated";

    /// <summary>Microsoft's equivalent of <see cref="AutoSubmittedHeader"/>, which Exchange honours and
    /// RFC 3834 alone does not reach. Suppresses OOF replies, DSNs and read receipts.</summary>
    public const string AutoResponseSuppressHeader = "X-Auto-Response-Suppress";

    /// <summary>The value for <see cref="AutoResponseSuppressHeader"/>.</summary>
    public const string AutoResponseSuppressValue = "All";

    /// <summary>ISO-8601, UTC, explicit <c>Z</c> — the same rendering
    /// <see cref="WebhookContract.FormatUtc"/> pins, so an operator comparing an email against a webhook
    /// body is comparing identical strings.</summary>
    public static string FormatUtc(DateTimeOffset value) => WebhookContract.FormatUtc(value);
}

/// <summary>
/// Task C-4 — one rendered message, before anything that can touch a socket or throw.
///
/// <para>🔴 <b>Why a plan record rather than a <see cref="System.Net.Mail.MailMessage"/>.</b>
/// <c>MailMessage</c>'s own setters throw — <c>Subject</c> rejects a CR or LF with an
/// <see cref="ArgumentException"/>, <c>MailAddress</c> rejects a malformed address with a
/// <see cref="FormatException"/> — so building one is a failure path that has to be counted, not a pure
/// render. Splitting the two means the exact subject, body and header set are assertable in a test with no
/// server involved, and the throwing part is confined to the channel where a loss counter exists.</para>
/// </summary>
/// <param name="Subject">The complete <c>Subject</c> header value. Guaranteed free of CR/LF.</param>
/// <param name="Body">The complete plain-text body.</param>
/// <param name="Headers">Additional headers, in the order they should be added.</param>
/// <param name="Urgent">Whether to mark the message high-priority (<c>X-Priority: 1</c>,
/// <c>Importance: high</c>, <c>Priority: urgent</c> — .NET emits all three from
/// <c>MailPriority.High</c>).</param>
public sealed record SmtpMessagePlan(
    string Subject,
    string Body,
    IReadOnlyList<(string Name, string Value)> Headers,
    bool Urgent);

/// <summary>
/// 🔴 Task C-4 — <b>what the email actually says, and why each part of it is there.</b>
///
/// <para><b>The reader this is written for</b> is an operator looking at a phone at 02:00. They need five
/// things and they need them in this order: how bad, what changed, which machine, what to do, and when. The
/// subject carries the first three; the body's first two lines carry the fourth and fifth. Everything below
/// that is for the person who is now at a keyboard.</para>
///
/// <para>🔴 <b>English only, and that is a decision rather than an omission.</b> The strings this message
/// wraps are already English and are not this task's to translate: <see cref="Alarm.Message"/> and
/// <see cref="Alarm.Runbook"/> are written by <see cref="AlarmEvaluator"/> in English, and
/// <see cref="Alarm.Key"/>, <see cref="AlarmSource"/>, <see cref="Alarm.Code"/>,
/// <see cref="AlarmPriority"/> and <see cref="AlarmEdgeKind"/> are identifiers that MUST stay stable
/// because operators write mailbox filters and Sieve rules against them. A Vietnamese wrapper around
/// English content produces a message that is neither language end to end, and doubling the subject halves
/// the characters a phone lock-screen preview shows — which is the one place the wording has to work
/// hardest. The product's Vietnamese surface is the UI (C-8), where the whole string is under one
/// translator's control and no mail filter depends on it.</para>
///
/// <para>🔴 <b>Plain text, never HTML.</b> Three reasons and the third is the one that decides it: it
/// renders identically in every client including a lock-screen preview and an SMS/pager gateway; it is
/// smaller; and <see cref="Alarm.Message"/> is operator-facing free text that would otherwise be
/// interpolated into markup — the exact injection surface C-3 chose the strict JSON encoder to avoid. A
/// text body has no such surface at all.</para>
///
/// <para>🔴 <b>Threading is done with real RFC 5322 headers, not by keeping the subject constant.</b> Both
/// facts an operator wants are then available at once: the subject changes so <c>RAISED</c> and
/// <c>CLEARED</c> are distinguishable at a glance in a message list, AND every message about one alarm key
/// collapses into one conversation, so seeing the alarm and seeing that it already cleared is one glance
/// rather than two searches. Every message carries a <c>References</c>/<c>In-Reply-To</c> pointing at a
/// synthetic root derived from <see cref="Alarm.Key"/>; the root message is never sent, which is ordinary
/// for machine senders and which every client handles by grouping on the reference.</para>
/// </summary>
public static class SmtpMessageBuilder
{
    /// <summary>Bound on any single free-text value interpolated into the subject. RFC 5322 recommends
    /// header lines under 78 characters and requires folding past 998; more practically, a subject longer
    /// than this is truncated by every mail client anyway, and the interesting part is at the front.</summary>
    public const int MaxSubjectValueLength = 60;

    /// <summary>Bound on a free-text value placed in a header. Headers are for filters, not for prose —
    /// the full text is in the body.</summary>
    public const int MaxHeaderValueLength = 200;

    /// <summary>
    /// Renders one notification. Pure: no I/O, no clock beyond <paramref name="sentAtUtc"/>, nothing that
    /// throws — so the exact bytes a recipient will read are directly assertable.
    /// </summary>
    /// <param name="fromDomain">The domain part of the configured <c>From</c> address, used for the
    /// <c>Message-ID</c> and the synthetic thread root. 🔴 The engine HOSTNAME is deliberately not used
    /// here: a <c>Message-ID</c> whose domain does not match the sender's is a documented spam-filter
    /// signal, and an internal machine name is not a domain anybody can resolve. The hostname is carried in
    /// <see cref="SmtpContract.HostHeader"/> instead, where it costs nothing.</param>
    /// <param name="deliveryId">Stable across every retry of this notification to this instance — the same
    /// idempotency discipline as the webhook's <c>deliveryId</c>. It makes the <c>Message-ID</c> stable
    /// across retries too, which is what lets a receiving server deduplicate a message this channel sent
    /// twice because an attempt timed out after the relay had already accepted it.</param>
    public static SmtpMessagePlan Build(
        NotificationJob job, string sourceHost, string instance, string fromDomain, string deliveryId,
        DateTimeOffset sentAtUtc)
    {
        ArgumentNullException.ThrowIfNull(job);

        var alarm = job.Alarm;
        var priority = alarm.Priority.ToString();
        var target = Target(alarm);

        // 🔴 ASCII hyphen, not an em dash. A non-ASCII character anywhere in the subject forces the whole
        // header through RFC 2047 encoded-word encoding (verified on the wire), which turns a greppable
        // subject into "=?utf-8?B?W1NUNEld...?=" in a mail log, a filter rule and a phone preview. An
        // all-ASCII alarm therefore produces an all-ASCII, unencoded subject; a Vietnamese alarm message
        // still encodes correctly, but it does so because of ITS content rather than because of ours.
        var escalation = job.Edge == AlarmEdgeKind.Escalated && job.PreviousPriority is { } previous
            ? $" (was {previous})"
            : "";

        var subject =
            $"{SmtpContract.SubjectTag} {priority.ToUpperInvariant()} {job.Edge.ToString().ToUpperInvariant()}" +
            $"{escalation} - {alarm.Source}/{Clip(alarm.Code, MaxSubjectValueLength)} on " +
            $"{Clip(target, MaxSubjectValueLength)} ({Clip(sourceHost, MaxSubjectValueLength)})";

        var threadRoot = ThreadRoot(alarm.Key, fromDomain);

        var headers = new List<(string, string)>
        {
            // Ours rather than the mail stack's, so it is stable across this channel's own retries.
            ("Message-ID", $"<st4i.{Atom(instance)}.{job.Sequence}.{Atom(deliveryId)}@{fromDomain}>"),
            ("References", threadRoot),
            ("In-Reply-To", threadRoot),
            (SmtpContract.AutoSubmittedHeader, SmtpContract.AutoSubmittedValue),
            (SmtpContract.AutoResponseSuppressHeader, SmtpContract.AutoResponseSuppressValue),
            (SmtpContract.AlarmKeyHeader, HeaderValue(alarm.Key)),
            (SmtpContract.PriorityHeader, priority),
            (SmtpContract.EdgeHeader, job.Edge.ToString()),
            (SmtpContract.SourceHeader, alarm.Source.ToString()),
            (SmtpContract.InstanceHeader, HeaderValue(instance)),
            (SmtpContract.HostHeader, HeaderValue(sourceHost)),
        };

        return new SmtpMessagePlan(
            Subject: subject,
            Body: BuildBody(job, sourceHost, instance, sentAtUtc, target),
            Headers: headers,
            // Only Critical. Marking everything urgent is how a client's urgent flag stops meaning anything,
            // and this build raises exactly two priorities (Policy is Critical; the rest are High).
            Urgent: alarm.Priority == AlarmPriority.Critical);
    }

    /// <summary>
    /// 🔴 The one-line headline, per edge kind. It exists because <b>four of the five kinds are NOT "an
    /// alarm is happening"</b>, and a single generic sentence would make an operator read the detail block
    /// to find out whether they need to get out of bed.
    /// </summary>
    private static string Headline(NotificationJob job, string sourceHost)
    {
        var alarm = job.Alarm;
        var priority = alarm.Priority.ToString().ToUpperInvariant();
        var actor = string.IsNullOrWhiteSpace(job.Actor) ? "an operator" : job.Actor;

        return job.Edge switch
        {
            AlarmEdgeKind.Raised =>
                $"A {priority} alarm has been RAISED on {sourceHost}.",
            AlarmEdgeKind.Escalated =>
                $"An alarm on {sourceHost} has ESCALATED to {priority}" +
                (job.PreviousPriority is { } previous ? $" (it was {previous})." : "."),
            AlarmEdgeKind.Acked =>
                $"A {priority} alarm on {sourceHost} was ACKNOWLEDGED by {actor}. " +
                "The condition is still active — this is the horn being silenced, not the alarm ending.",
            AlarmEdgeKind.Cleared =>
                $"A {priority} alarm on {sourceHost} has CLEARED. No action is needed.",
            // 🔴 The restart edge. Saying "raised" here would be a lie once per restart, and a crash-looping
            // engine would page somebody repeatedly for a condition that started hours ago.
            AlarmEdgeKind.Restored =>
                $"A {priority} alarm was ALREADY STANDING on {sourceHost} when the engine restarted. " +
                "This is not a new condition; it is a restart notice for an alarm that is still on.",
            _ => $"A {priority} alarm on {sourceHost} changed state.",
        };
    }

    private static string BuildBody(
        NotificationJob job, string sourceHost, string instance, DateTimeOffset sentAtUtc, string target)
    {
        var alarm = job.Alarm;
        var body = new StringBuilder();

        body.Append(Headline(job, sourceHost)).Append("\r\n\r\n");
        body.Append("  ").Append(OneLine(alarm.Message)).Append("\r\n\r\n");

        body.Append("WHAT TO DO\r\n");
        if (!string.IsNullOrWhiteSpace(alarm.Runbook))
        {
            body.Append("  ").Append(OneLine(alarm.Runbook)).Append("\r\n\r\n");
        }
        else
        {
            // 🔴 Never blank. An operator woken at 02:00 by a message whose action section is empty has been
            // told there is a problem and nothing else; naming the two places the answer actually lives is
            // worth more than an honest-looking gap.
            body.Append("  No runbook is recorded for this alarm. Open the alarms page on ")
                .Append(sourceHost)
                .Append(" for its\r\n  current state and history");
            body.Append(job.Alarm.ClearOnAck
                ? ", and acknowledge it there to clear it.\r\n\r\n"
                : ". Acknowledging it silences it; it clears only when the\r\n  condition itself ends.\r\n\r\n");
        }

        body.Append("DETAIL\r\n");
        Row(body, "Alarm key", alarm.Key);
        Row(body, "Source / code", $"{alarm.Source} / {alarm.Code}");
        Row(body, "About", target);
        Row(body, "Priority", alarm.Priority.ToString());
        Row(body, "State", alarm.State.ToString());
        Row(body, "Edge", $"{job.Edge} (#{job.Sequence.ToString(CultureInfo.InvariantCulture)}, detected " +
                          $"{SmtpContract.FormatUtc(job.AtUtc)})");
        if (job.PreviousPriority is { } was) Row(body, "Escalated from", was.ToString());
        if (!string.IsNullOrWhiteSpace(job.Actor)) Row(body, "By", OneLine(job.Actor));
        Row(body, "Alarm type", alarm.ClearOnAck
            ? "EVENT - acknowledging it clears it"
            : "CONDITION - acknowledging only silences it");
        Row(body, "Restated", $"{alarm.Count.ToString(CultureInfo.InvariantCulture)} time(s) since " +
                              SmtpContract.FormatUtc(alarm.FirstRaisedUtc));
        Row(body, "Last restated", SmtpContract.FormatUtc(alarm.LastRaisedUtc));
        Row(body, "Acknowledged", alarm.AckedUtc is { } acked
            ? $"{SmtpContract.FormatUtc(acked)}" +
              (string.IsNullOrWhiteSpace(alarm.AckedBy) ? "" : $" by {OneLine(alarm.AckedBy)}")
            : "not acknowledged");

        body.Append("\r\n--\r\n");
        body.Append("Sent by the ST4I machine simulator on ").Append(sourceHost)
            .Append(" (SMTP channel '").Append(instance).Append("') at ")
            .Append(SmtpContract.FormatUtc(sentAtUtc)).Append(".\r\n");
        // 🔴 Said in the message itself because it is the single most surprising property of this channel,
        // and an operator who assumes otherwise will wait for a message that is never coming.
        body.Append("This message reports one alarm EDGE, not a periodic status. There is no delivery queue\r\n");
        body.Append("behind this channel: if a message did not arrive, it was not resent.\r\n");
        body.Append("Do not reply - this mailbox is not monitored.\r\n");

        return body.ToString();
    }

    private static void Row(StringBuilder body, string label, string value) =>
        body.Append("  ").Append(label.PadRight(15)).Append(OneLine(value)).Append("\r\n");

    /// <summary>What the alarm is ABOUT. 🔴 The placeholder is <c>unspecified</c>, never <c>fleet</c> —
    /// C-3's review round 2 (m-1) established that a fleet-wide alarm arrives carrying the LITERAL
    /// <c>"fleet"</c> from <see cref="AlarmEvaluator"/>'s NgRate raise, so substituting that word for a
    /// blank would be this product's own display code inventing a fleet-wide alarm that nothing
    /// sent.</summary>
    private static string Target(Alarm alarm) =>
        string.IsNullOrWhiteSpace(alarm.TargetId) ? "unspecified" : alarm.TargetId;

    /// <summary>
    /// 🔴 The synthetic thread root, derived from <see cref="Alarm.Key"/> so every edge for one alarm —
    /// raised, escalated, acked, cleared, and the restart notice — lands in one conversation.
    ///
    /// <para>A HASH of the key rather than the key itself: <see cref="Alarm.Key"/> contains <c>:</c> and,
    /// for a Policy denial, whatever the denied action was called, none of which is guaranteed to be a legal
    /// <c>msg-id</c> atom. Hashing makes the identifier well-formed by construction instead of by hoping
    /// about the shape of a key. It is stable across process restarts, which is exactly what makes the
    /// restart notice thread with the original raise.</para>
    /// </summary>
    private static string ThreadRoot(string alarmKey, string fromDomain)
    {
        var digest = Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(alarmKey ?? "")))[..16]
            .ToLowerInvariant();
        return $"<st4i.alarm.{digest}@{fromDomain}>";
    }

    /// <summary>Reduces a value to the characters legal in a <c>msg-id</c> dot-atom, so a configured
    /// instance name or a GUID can never produce a malformed <c>Message-ID</c>.</summary>
    private static string Atom(string? value)
    {
        if (string.IsNullOrWhiteSpace(value)) return "x";
        var atom = new StringBuilder(value.Length);
        foreach (var c in value)
        {
            atom.Append(char.IsAsciiLetterOrDigit(c) || c is '-' or '.' or '_' ? c : '-');
        }
        return atom.Length == 0 ? "x" : atom.ToString();
    }

    /// <summary>
    /// 🔴 Collapses a value to a single line. Applied to EVERY free-text value that reaches the subject or
    /// a header.
    ///
    /// <para><c>MailMessage.Subject</c> rejects a CR or LF by THROWING (verified), and
    /// <c>MailMessage.Headers.Add</c> accepts one verbatim (also verified) — so the same input is a counted
    /// loss on one path and a header-injection primitive on the other. Neither is acceptable in a
    /// never-throws channel, and neither depends on believing that no alarm message will ever contain a
    /// newline. Also strips the other control characters, which no header may carry.</para>
    /// </summary>
    private static string OneLine(string? value)
    {
        if (string.IsNullOrEmpty(value)) return "";
        var text = new StringBuilder(value.Length);
        foreach (var c in value)
        {
            text.Append(c is '\r' or '\n' ? ' ' : char.IsControl(c) ? ' ' : c);
        }
        return text.ToString().Trim();
    }

    private static string HeaderValue(string? value) => Clip(OneLine(value), MaxHeaderValueLength);

    private static string Clip(string? value, int max)
    {
        var text = OneLine(value);
        if (text.Length == 0) return "";
        return text.Length <= max ? text : text[..max] + "...";
    }
}
