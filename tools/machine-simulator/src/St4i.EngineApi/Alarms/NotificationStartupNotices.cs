namespace St4i.EngineApi.Alarms;

/// <summary>How loudly a <see cref="NotificationStartupNotice"/> should be said.</summary>
public enum NotificationNoticeSeverity
{
    Information,
    Warning,
}

/// <summary>Task C-2 — one thing the host should say about the notification configuration at
/// startup.</summary>
public sealed record NotificationStartupNotice(NotificationNoticeSeverity Severity, string Message);

/// <summary>
/// 🔴 Task C-2 — the collapse of C-1's placeholder <c>ST4I_ALARM_NOTIFY_ENABLED</c> env gate, and the
/// guarantee that replaces it.
///
/// <para><b>What was wrong with two mechanisms.</b> C-1 shipped an env var as a temporary switch and
/// flagged that it must not survive as a second enable mechanism. Its review then found the danger ran the
/// opposite way from the one first assumed: the risk was never "somebody turns it on by accident", it was
/// that an operator would configure a webhook or an SMTP recipient completely correctly, never learn that
/// an environment variable also had to be set, and get a <b>fully configured alarm system that notifies
/// absolutely nobody, with no error anywhere</b>. A configuration that is silently inert is worse than one
/// that refuses to save.</para>
///
/// <para><b>What replaced it.</b> The env var is gone — <see cref="NotificationConfigStore"/> is now the
/// only enable mechanism in the product, and a channel's own <c>enabled</c> flag is the only switch. Two
/// enable mechanisms cannot disagree if there is only one.</para>
///
/// <para>🔴 <b>Review round 1 (I5) — the seam is registered UNCONDITIONALLY.</b> C-2 originally registered
/// <see cref="AlarmNotifier"/> only when at least one channel was configured, preserving C-1's zero-cost
/// "off means off" and leaving one transition — the first channel ever configured on a host that started
/// with none — needing a restart, bound only by a doc comment telling C-7 to warn about it. The objection
/// was to the binding, not the arithmetic: a rule that lives in prose is a rule the next task can miss.
/// Registering always costs one bounded channel and one idle drain loop, and "bit-for-bit identical when
/// nothing is configured" is only worth defending if somebody is measuring it. Nobody is. So the entire
/// class of "configured but never registered" is deleted rather than deferred, and whether anything is
/// DELIVERED is now decided by configuration alone, at the point of delivery.</para>
///
/// <para>🔴 <b>The guarantee, stated as a property rather than a list of cases.</b> Deliveries happen only
/// when at least one channel is enabled AND this build actually has a delivery implementation behind the
/// seam. So:</para>
/// <code>
///   !WillDeliver(channels, hasDelivery)  ⇒  Describe(channels, hasDelivery) contains a Warning
/// </code>
/// <para>There is no reachable combination of "somebody configured something" and "nothing will be
/// delivered" that this host passes over in silence. That is asserted EXHAUSTIVELY over the whole input
/// space (every subset of channels × enabled/disabled × with/without a delivery implementation) in
/// <c>NotificationStartupNoticesTests</c>, not by example — so a future task that adds a fifth channel or a
/// new quiet state cannot reintroduce the silent-misconfiguration failure without a red suite.</para>
///
/// <para><b>Why this is a pure function and not inline logic in <c>Program.cs</c>:</b> the same reason
/// <c>BindingRisk.Describe</c> already is — a startup-only side effect buried in the host's composition
/// root is testable only by booting a host, which is exactly the kind of coverage that gets skipped. The
/// wiring in <c>Program.cs</c> is then three lines that cannot be got wrong.</para>
/// </summary>
public static class NotificationStartupNotices
{
    /// <summary>Whether an alarm edge can actually reach a human in this process, as configured. Both
    /// halves are required: a channel an operator enabled, and something behind the seam that can deliver
    /// it.</summary>
    /// <param name="hasDeliveryImplementation">Whether a dispatch delegate is wired behind
    /// <see cref="AlarmNotifier"/>. 🔴 Derived in <c>Program.cs</c> from the SAME local variable that
    /// supplies the notifier's own <c>dispatch</c> argument, never hard-coded per task: as of C-2 that
    /// variable is <see langword="null"/>, so this is <see langword="false"/> and the corresponding
    /// warning fires — and it stops firing by itself the moment C-3 assigns a real dispatch, with nobody
    /// having to remember to delete it.</param>
    public static bool WillDeliver(
        IReadOnlyList<NotificationChannelSummary> channels, bool hasDeliveryImplementation)
    {
        ArgumentNullException.ThrowIfNull(channels);
        return hasDeliveryImplementation && channels.Any(channel => channel.Enabled);
    }

    /// <summary>Everything the host should say at startup about where alarms will and will not go.</summary>
    public static IReadOnlyList<NotificationStartupNotice> Describe(
        IReadOnlyList<NotificationChannelSummary> channels, bool hasDeliveryImplementation)
    {
        ArgumentNullException.ThrowIfNull(channels);

        var notices = new List<NotificationStartupNotice>();
        var enabled = channels.Where(channel => channel.Enabled).ToList();

        if (channels.Count == 0)
        {
            // The fresh-install case. Still a Warning, not Information: the product's own README calls
            // "alarms cannot reach anyone who is not looking at the screen" a defect, and an install that
            // has never been configured is living with that defect whether or not anyone noticed.
            notices.Add(new NotificationStartupNotice(
                NotificationNoticeSeverity.Warning,
                "No alarm notification channel is configured. Alarms are still recorded and visible at /alarms, " +
                "but NOTHING is sent to anyone who is not looking at the screen — no webhook, no email, no " +
                "annunciation, no relay."));
        }
        else if (enabled.Count == 0)
        {
            // 🔴 The case the brief names explicitly: somebody configured a channel and it is inert.
            notices.Add(new NotificationStartupNotice(
                NotificationNoticeSeverity.Warning,
                $"{channels.Count} alarm notification channel(s) are CONFIGURED but every one of them is DISABLED " +
                $"({FormatChannels(channels)}) — no alarm will be sent to anyone. Enable at least one, or remove " +
                "them so this warning stops being the only sign that they exist."));
        }
        else if (!hasDeliveryImplementation)
        {
            // Configured, enabled, and still silent — because this build has nothing behind the seam yet.
            // Self-clearing: the condition is read from the live notifier, so it disappears when a real
            // channel implementation is wired in.
            notices.Add(new NotificationStartupNotice(
                NotificationNoticeSeverity.Warning,
                $"{enabled.Count} alarm notification channel(s) are configured and ENABLED ({FormatChannels(enabled)}), " +
                "but this build has no delivery implementation behind the notification seam — alarm edges are " +
                "detected and then DISCARDED. Nobody will be notified. This is a build limitation, not a " +
                "configuration error."));
        }
        else
        {
            notices.Add(new NotificationStartupNotice(
                NotificationNoticeSeverity.Information,
                $"Alarm notifications are ACTIVE on {enabled.Count} channel(s): {FormatChannels(enabled)}."));
        }

        // Independent of the gate, and reported whether or not anything is enabled: a password that
        // crosses the wire in clear text is worth saying out loud exactly once per boot. SmtpTlsMode.None
        // is a legitimate choice for an isolated in-plant relay, which is why the store accepts it — but
        // it stops being legitimate the moment credentials are attached to it.
        foreach (var channel in channels)
        {
            if (channel.Smtp is { Tls: SmtpTlsMode.None, HasPassword: true } smtp)
            {
                notices.Add(new NotificationStartupNotice(
                    NotificationNoticeSeverity.Warning,
                    $"The SMTP notification channel is configured with NO transport security (host {smtp.Host}:{smtp.Port}) " +
                    "but has a stored password — that password is sent in clear text over the network on every " +
                    "message. Use STARTTLS, or point this at a relay that does not require authentication."));
            }

            // 🔴 Review round 1 — port 465 is IMPLICIT TLS (SMTPS): the server expects a TLS handshake the
            // instant the socket opens. System.Net.Mail.SmtpClient, which C-4 must use, implements only
            // RFC 3207 STARTTLS and cannot do that in either mode — with StartTls it sends EHLO in the
            // clear to a server waiting for a ClientHello and the connection hangs until it times out;
            // with None it gets TLS bytes back and fails to parse them. SmtpTlsMode deliberately has no
            // ImplicitTls member (offering one would be a promise C-4 could not keep without a forbidden
            // NuGet), but the enum's silence does not help an operator who simply types the port they were
            // given. Saying it once per boot does.
            if (channel.Smtp is { Port: 465 } implicitTls)
            {
                notices.Add(new NotificationStartupNotice(
                    NotificationNoticeSeverity.Warning,
                    $"The SMTP notification channel is configured on port 465 ({implicitTls.Host}:465), which is " +
                    "implicit TLS (SMTPS). This product sends mail through System.Net.Mail, which supports only " +
                    "STARTTLS — it cannot complete a handshake on 465 and the attempt will hang rather than fail " +
                    "quickly. Use port 587 with STARTTLS, or port 25 on an in-plant relay."));
            }
        }

        return notices;
    }

    private static string FormatChannels(IEnumerable<NotificationChannelSummary> channels) =>
        string.Join(", ", channels.Select(channel => channel.Channel.ToString()));
}
