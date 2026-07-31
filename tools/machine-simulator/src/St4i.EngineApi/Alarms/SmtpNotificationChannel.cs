using System.Diagnostics;
using System.Net;
using System.Net.Mail;
using System.Net.Sockets;
using System.Runtime.Versioning;

namespace St4i.EngineApi.Alarms;

/// <summary>
/// Task C-4 — a point-in-time snapshot of <see cref="SmtpNotificationChannel"/>'s counters, so "did any
/// email actually leave this machine, and did anything get lost?" is answerable without a log file.
/// Cumulative since process start. C-7 surfaces these next to <see cref="AlarmNotifierStats"/> and
/// <see cref="WebhookChannelStats"/>.
///
/// <para>🔴 <b>The accounting invariant</b>, the same one <see cref="WebhookChannelStats"/> holds and for
/// the same reason: for every (notification, configured SMTP instance) pair, EXACTLY ONE of
/// <paramref name="Suppressed"/>, <paramref name="Delivered"/>, <paramref name="Lost"/> and
/// <paramref name="Cancelled"/> moves. One <c>switch</c> in the whole class touches the first three, every
/// path through the delivery reaches it, and the fourth is reached only by re-throwing.</para>
/// </summary>
/// <param name="Considered">Notifications handed to this channel by the drain loop, before any
/// filtering.</param>
/// <param name="Suppressed">(notification, instance) pairs deliberately not sent — the instance is
/// disabled, or the alarm is less severe than that instance's minimum priority. NOT a loss.</param>
/// <param name="Delivered">(notification, instance) pairs the relay accepted for AT LEAST ONE recipient.
/// See <paramref name="PartiallyDelivered"/> for why "at least one" rather than "all".</param>
/// <param name="Lost">
/// 🔴 (notification, instance) pairs that were MEANT to be delivered and reached NOBODY. The full list,
/// because this is the operator-facing definition of the counter and C-3's review found that a stale one is
/// how a counter's meaning rots: a permanent SMTP rejection (any 5xx — bad credentials, relay denied, no
/// such mailbox); an authentication failure; a retry budget exhausted against a transient failure or an
/// unreachable relay; a stored password that exists but <b>could not be decrypted</b>; a configured
/// username with no stored password, or a stored password with no username; a configuration that could not
/// be read back after being listed; an unusable <c>From</c> address or a recipient list with nothing valid
/// in it; every recipient rejected; or an internal fault.
///
/// <para><b>This batch offers no delivery guarantee and there is no queue behind this channel</b> (see
/// <see cref="AlarmNotifier"/>): the edge that produced this notification will not be re-emitted. A
/// non-zero value here means somebody was not told something that happened.</para></param>
/// <param name="Cancelled">Deliveries abandoned because the process is shutting down. Also a loss, counted
/// separately because it is expected during shutdown and alarming at any other time.</param>
/// <param name="Attempts">SMTP conversations actually started, INCLUDING retries.</param>
/// <param name="Retries">The subset of <paramref name="Attempts"/> that were not the first try.</param>
/// <param name="PartiallyDelivered">
/// 🔴 The subset of <paramref name="Delivered"/> in which the relay accepted SOME recipients and rejected
/// others. Counted as delivered rather than lost because the alarm did reach a human, and reporting it as a
/// loss would tell an operator nobody was told when somebody was — but counted separately because a
/// recipient who is silently never receiving alarms is exactly the failure this channel exists to prevent,
/// and it is invisible in <paramref name="Delivered"/> alone. The rejected addresses are named in a
/// warning.</param>
public sealed record SmtpChannelStats(
    long Considered,
    long Suppressed,
    long Delivered,
    long Lost,
    long Cancelled,
    long Attempts,
    long Retries,
    long PartiallyDelivered);

/// <summary>
/// 🔴 Task C-4 (.superpowers/sdd/2026-07-30-dotC-alarm-notification-blueprint/task-4-brief.md) — <b>the
/// channel a customer asks for by name, and the one this product can least guarantee</b>, because it
/// depends on a mail server nobody here controls. An SMTP message to every configured, enabled SMTP
/// instance whose minimum priority the alarm meets.
///
/// <para><b>Where it sits.</b> Behind C-1's <see cref="AlarmNotifier"/>, exactly like
/// <see cref="WebhookNotificationChannel"/>: the edge detector has already absorbed the 5s re-raise storm,
/// so this class sees one message per real change and never per tick. It runs on the notifier's
/// single-reader DRAIN THREAD, so it may block — and every millisecond it blocks delays every other
/// notification behind it. That is what sets the budget below, not politeness.</para>
///
/// <para>🔴 <b>Never-throws, with exactly one deliberate exception</b> — an
/// <see cref="OperationCanceledException"/> from a genuine shutdown, which C-1's drain loop distinguishes
/// and counts as a drop. Everything else is caught, counted and reported.</para>
///
/// <para>🔴 <b>WHAT <see cref="SmtpClient"/> CANNOT DO — state this wherever this channel is
/// documented.</b> It implements only RFC 3207 <c>STARTTLS</c> (that is the whole of what
/// <see cref="SmtpClient.EnableSsl"/> does) and cannot negotiate TLS at connect time. <b>Implicit TLS —
/// SMTPS, port 465 — is therefore unreachable</b>, and no configuration of this product can make it work;
/// C-2 left <see cref="SmtpTlsMode"/> deliberately without an implicit-TLS member for that reason, and
/// <see cref="NotificationStartupNotices"/> warns once per boot for a channel configured on 465. An
/// operator who needs SMTPS must point this at a relay that speaks STARTTLS on 587 or plain SMTP on 25.
/// Measured, so the warning's own claim is accurate: against a port that expects a TLS handshake this
/// channel does NOT hang — it is bounded by <see cref="DefaultAttemptTimeout"/> and
/// <see cref="DefaultTotalBudget"/> like any other unresponsive relay.</para>
///
/// <para>🔴 <b>ONE <see cref="SmtpClient"/> PER ATTEMPT — the opposite of the webhook channel's
/// long-lived <see cref="System.Net.Http.HttpClient"/>, and not by oversight.</b> Two measured facts force
/// it. <see cref="SmtpClient"/> refuses concurrent sends on one instance: the second call throws
/// <see cref="InvalidOperationException"/> ("An asynchronous call is already in progress") SYNCHRONOUSLY,
/// so a shared instance across this channel's own concurrent fan-out would fail outright. And
/// <see cref="SmtpClient.Dispose"/> is this class's cancellation mechanism (see below), which makes an
/// instance single-use by construction. There is no socket-exhaustion trade to weigh: one message per alarm
/// EDGE is not a rate at which connection churn matters.</para>
///
/// <para>🔴 <b>Nothing this class logs can contain the password.</b> The plaintext is only ever an argument
/// to <see cref="NetworkCredential"/>; every message this class produces names its destination through
/// <see cref="SmtpIdentity"/>, whose fields are the instance, <c>host:port</c>, the TLS mode and the
/// recipient COUNT — the password is not a field of that type, so there is no formatting path it can travel
/// down. Verified additionally that the BCL does not leak it either: a rejected <c>AUTH</c> produces
/// <c>SmtpException("Authentication failed.")</c> whose full <c>ToString()</c> contains neither the
/// password nor the username.</para>
///
/// <para>🔴 <b>One residual this channel cannot close, stated rather than papered over.</b>
/// <see cref="SmtpClient"/> does not abort when the relay REJECTS <c>AUTH</c> — measured: it swallows the
/// <c>535</c> and continues to <c>MAIL FROM</c> unauthenticated. Against any real authenticating relay the
/// next reply is a 5xx and this channel reports a permanent, counted loss (see <see cref="Classify"/>). But
/// against a relay that rejects the credentials AND STILL ACCEPTS mail from this host — one where the host
/// is on an IP allowlist — the message is delivered anonymously and <b>nothing anywhere reports that the
/// stored password is wrong</b>. No notification is lost, so the counters remain honest; what is lost is
/// the operator's knowledge that their credential has stopped working. It is not detectable from this API,
/// which exposes no <c>AUTH</c> result at all, and closing it would need an SMTP library this batch may not
/// add. C-7's "send test" is the natural place to surface it, because a test send can be checked against
/// what the relay reports.</para>
///
/// <para>🔴 <b>Recipients and the From address are not secrets, but they ARE personal data</b>, so they are
/// treated as such: no ordinary log line names them — the identity carries a recipient COUNT. The single
/// exception is a per-recipient rejection, where the rejected address IS named, because "one of your 4
/// recipients was rejected" without saying which is a message an operator cannot act on at all. That is the
/// only place an address reaches a log, and it is the only place naming it buys anything.</para>
///
/// <para><b>It does not write to the alarm store and never re-queries it</b>, for the reason C-1's review
/// gave: a channel calling back into <see cref="IAlarmStore"/> would take the store's write gate from the
/// drain thread and couple drain throughput to alarm-write throughput on the policy-denial request
/// path.</para>
/// </summary>
[SupportedOSPlatform("windows")]
public sealed class SmtpNotificationChannel
{
    /// <summary>Per-attempt bound on one whole SMTP conversation — connect, EHLO, AUTH, MAIL, RCPT, DATA.
    /// Matches <see cref="WebhookNotificationChannel.DefaultAttemptTimeout"/> rather than inventing a
    /// second number, so C-7's <c>Task.WhenAll</c> fan-out across channels costs one budget and not the
    /// larger of two.</summary>
    public static readonly TimeSpan DefaultAttemptTimeout = TimeSpan.FromSeconds(5);

    /// <summary>
    /// 🔴 The HARD bound on how long one notification may occupy the drain thread for one SMTP instance,
    /// retries and backoff included.
    ///
    /// <para><b>Why 10 seconds, measured rather than copied.</b> C-3 found that .NET's connect path takes
    /// about two seconds to surface a REFUSED TCP connection on this platform and warned that C-4 would
    /// meet the same surprise through a different client. It does, and the number is the same:
    /// <see cref="SmtpClient"/> against a closed port on loopback took <b>2046 / 2050 / 2019 ms</b> across
    /// three runs. Three attempts plus 250 ms + 500 ms of backoff is therefore about 6.8 s — inside a 10 s
    /// budget and well outside a 5 s one. A 5 s budget would silently degrade "retry a refused connection
    /// three times" into "try it twice".</para>
    ///
    /// <para>10 s is also what bounds the one bulk case this channel has:
    /// <see cref="AlarmEdgeKind.Restored"/> at startup emits one job per standing alarm. Shutdown does not
    /// wait for it either way — cancellation beats the budget, always.</para>
    /// </summary>
    public static readonly TimeSpan DefaultTotalBudget = TimeSpan.FromSeconds(10);

    /// <summary>First try plus two retries — the same shape as the webhook channel and the vendored SDK.
    /// A relay that has failed three times in ten seconds is down, not blipping.</summary>
    public const int DefaultMaxAttempts = 3;

    /// <summary>Exponential backoff base — 250 ms, then 500 ms. No jitter: there is exactly one sender per
    /// machine, so there is no herd to disperse, and determinism is worth more in a test.</summary>
    public static readonly TimeSpan DefaultBaseBackoff = TimeSpan.FromMilliseconds(250);

    /// <summary>
    /// 🔴 The multiplier applied to <see cref="_attemptTimeout"/> when setting
    /// <see cref="SmtpClient.Timeout"/>, so that timeout is a BACKSTOP and never the mechanism that fires.
    ///
    /// <para>This is load-bearing for the retry policy, not tuning. <see cref="SmtpClient.Timeout"/>
    /// expiring produces <c>SmtpException(GeneralFailure, "The operation has timed out.")</c> with no inner
    /// exception — and a rejected <c>AUTH</c> produces <c>SmtpException(GeneralFailure, "Authentication
    /// failed.")</c>, also with no inner exception. The two are indistinguishable by type or status code,
    /// and they need OPPOSITE retry decisions: a timeout is worth another go, hammering a wrong password is
    /// how a service account gets locked out. Making this class's own cancellation always win means a
    /// timeout is recognised by <c>attemptCts.IsCancellationRequested</c> before any exception is
    /// classified, so a bare <c>GeneralFailure</c> with no socket cause can be treated as the permanent
    /// failure it almost certainly is. See <see cref="Classify"/>.</para>
    /// </summary>
    private const int SmtpClientTimeoutBackstopFactor = 3;

    private readonly NotificationConfigStore _store;
    private readonly string _sourceHost;
    private readonly TimeSpan _attemptTimeout;
    private readonly TimeSpan _totalBudget;
    private readonly TimeSpan _baseBackoff;
    private readonly int _maxAttempts;
    private readonly Action<Exception, string>? _logError;
    private readonly Action<string>? _logWarning;
    private readonly Func<DateTimeOffset> _clock;

    private long _considered;
    private long _suppressed;
    private long _delivered;
    private long _lost;
    private long _cancelled;
    private long _attempts;
    private long _retries;
    private long _partiallyDelivered;

    /// <summary>
    /// 🔴 The ONLY way this class names an SMTP destination in a message. Its fields are the non-secret,
    /// non-personal subset of <see cref="SmtpChannelConfig"/>: the password is not a field of this type, and
    /// neither are the recipient addresses or the <c>From</c> address — which is what makes "no log line can
    /// contain a credential, and no ordinary log line can contain personal data" a property of the type
    /// rather than of every call site remembering.
    /// </summary>
    private readonly record struct SmtpIdentity(
        string Instance, string Host, int Port, SmtpTlsMode Tls, int RecipientCount)
    {
        public override string ToString() =>
            $"'{Instance}' ({Host}:{Port.ToString(System.Globalization.CultureInfo.InvariantCulture)}, " +
            $"TLS {Tls}, {RecipientCount.ToString(System.Globalization.CultureInfo.InvariantCulture)} recipient(s))";
    }

    /// <summary>What one (notification, instance) delivery did. Deliberately only three members: every path
    /// through <see cref="DeliverAsync"/> ends at exactly one of them, and the single <c>switch</c> over
    /// this enum is the accounting choke point described on <see cref="SmtpChannelStats"/>.</summary>
    private enum DeliveryOutcome
    {
        Suppressed,
        Delivered,
        Lost,
    }

    /// <summary>How one attempt's failure should be treated. There is deliberately no "permanent" member
    /// carrying a message: a permanent failure reports and returns from inside the attempt, because it
    /// already knows exactly what to say.</summary>
    private enum FailureKind
    {
        /// <summary>A transport failure or a 4xx SMTP reply — worth another go if there is budget left.</summary>
        Retryable,

        /// <summary>A 5xx SMTP reply, an authentication failure, or a message that could not be built:
        /// the same inputs would produce the same answer.</summary>
        Permanent,
    }

    /// <param name="store">C-2's configuration store. Read on EVERY notification rather than cached, so an
    /// operator enabling, disabling or re-pointing a mail relay through C-7 takes effect on the next alarm
    /// with no restart and no cache to invalidate.</param>
    /// <param name="sourceHost">What the message reports as the machine that sent it. Defaults to
    /// <see cref="Environment.MachineName"/>; a parameter so the wire format is directly assertable.</param>
    public SmtpNotificationChannel(
        NotificationConfigStore store,
        Action<Exception, string>? logError = null,
        Action<string>? logWarning = null,
        string? sourceHost = null,
        TimeSpan? attemptTimeout = null,
        TimeSpan? totalBudget = null,
        TimeSpan? baseBackoff = null,
        int maxAttempts = DefaultMaxAttempts,
        Func<DateTimeOffset>? clock = null)
    {
        ArgumentNullException.ThrowIfNull(store);

        _store = store;
        _logError = logError;
        _logWarning = logWarning;
        _sourceHost = string.IsNullOrWhiteSpace(sourceHost) ? Environment.MachineName : sourceHost;
        _attemptTimeout = attemptTimeout ?? DefaultAttemptTimeout;
        _totalBudget = totalBudget ?? DefaultTotalBudget;
        _baseBackoff = baseBackoff ?? DefaultBaseBackoff;
        _maxAttempts = Math.Max(1, maxAttempts);
        _clock = clock ?? (() => DateTimeOffset.UtcNow);
    }

    /// <summary>Cumulative counters — see <see cref="SmtpChannelStats"/>.</summary>
    public SmtpChannelStats Stats => new(
        Interlocked.Read(ref _considered),
        Interlocked.Read(ref _suppressed),
        Interlocked.Read(ref _delivered),
        Interlocked.Read(ref _lost),
        Interlocked.Read(ref _cancelled),
        Interlocked.Read(ref _attempts),
        Interlocked.Read(ref _retries),
        Interlocked.Read(ref _partiallyDelivered));

    // ─────────────────────────────────────────────────────────────────────
    // Dispatch — the delegate AlarmNotifier's drain loop calls.
    // ─────────────────────────────────────────────────────────────────────

    /// <summary>
    /// C-1's <c>dispatch</c> delegate. Fans out to every configured SMTP instance CONCURRENTLY, for the
    /// reason C-3 established: done sequentially, N unreachable relays would hold C-1's single-reader drain
    /// loop for N × <see cref="DefaultTotalBudget"/>. Destinations are independent and have no ordering
    /// relationship, so fanning out keeps the loop's exposure at ONE budget however many are configured.
    /// Ordering BETWEEN notifications is untouched — the drain loop still hands over one job at a time.
    /// </summary>
    public async Task DispatchAsync(NotificationJob job, CancellationToken ct = default)
    {
        ArgumentNullException.ThrowIfNull(job);
        Interlocked.Increment(ref _considered);

        var fannedOut = false;
        try
        {
            ct.ThrowIfCancellationRequested();

            var configured = await _store.ListAsync(ct).ConfigureAwait(false);

            // Kept as defence in depth after Task C-4 made the store itself propagate cancellation: this
            // covers a shutdown landing after the read returned. Without one or the other, an empty list is
            // indistinguishable from "no SMTP channel is configured" and the notification would vanish with
            // no counter moving.
            ct.ThrowIfCancellationRequested();

            var instances = new List<(string Instance, bool HasPassword)>();
            foreach (var summary in configured)
            {
                if (summary.Channel != NotificationChannel.Smtp) continue;

                // A cheap first pass over the credential-free summary, so an instance that is disabled or
                // below threshold never causes its DPAPI secret to be decrypted at all. The AUTHORITATIVE
                // decision is re-taken on the full configuration in DeliverAsync.
                if (!summary.Enabled ||
                    !NotificationDelivery.MeetsThreshold(job.Alarm.Priority, summary.MinPriority))
                {
                    Interlocked.Increment(ref _suppressed);
                    continue;
                }

                // 🔴 C-3 review round 1 (I-1), the same shape one channel over: HasPassword is derived from
                // the PRESENCE of a row, so it is the ONLY thing that can tell "no password is configured"
                // from "a password is configured and its DPAPI blob will not decrypt". GetSecretAsync
                // returns null for both. Carried forward into DeliverAsync — see there.
                instances.Add((summary.Instance, summary.Smtp?.HasPassword == true));
            }

            if (instances.Count == 0) return;

            fannedOut = true;
            await Task.WhenAll(instances.Select(target =>
                    DeliverAndCountAsync(target.Instance, target.HasPassword, job, ct)))
                .ConfigureAwait(false);
        }
        catch (OperationCanceledException) when (ct.IsCancellationRequested)
        {
            // Counted here ONLY if no per-instance delivery had started; once fan-out begins each abandoned
            // delivery counts itself. Re-thrown either way: C-1's drain loop counts a shutdown-abandoned job
            // as a drop, and swallowing it would make a truncated drain invisible.
            if (!fannedOut) Interlocked.Increment(ref _cancelled);
            throw;
        }
        catch (Exception ex)
        {
            // Counted rather than merely logged, for the reason AlarmNotifier's own catch-all is: a log
            // saying an alarm was lost, next to a counter reading zero, says the opposite of the log.
            Interlocked.Increment(ref _lost);
            ReportError(ex, "Alarm e-mail: resolving the configured SMTP destinations faulted — this " +
                            $"notification ({job.Edge} '{job.Alarm.Key}') was NOT sent to anybody.");
        }
    }

    /// <summary>🔴 The accounting choke point: exactly one counter moves per (notification, instance) pair,
    /// and every path through <see cref="DeliverAsync"/> ends at this switch.</summary>
    private async Task DeliverAndCountAsync(
        string instance, bool hasPassword, NotificationJob job, CancellationToken ct)
    {
        DeliveryOutcome outcome;
        try
        {
            outcome = await DeliverAsync(instance, hasPassword, job, ct).ConfigureAwait(false);
        }
        catch (OperationCanceledException) when (ct.IsCancellationRequested)
        {
            Interlocked.Increment(ref _cancelled);
            throw;
        }
        catch (Exception ex)
        {
            outcome = DeliveryOutcome.Lost;
            ReportError(ex, $"Alarm e-mail {instance}: the channel itself faulted — this notification " +
                            $"({job.Edge} '{job.Alarm.Key}') was NOT delivered.");
        }

        switch (outcome)
        {
            case DeliveryOutcome.Suppressed: Interlocked.Increment(ref _suppressed); break;
            case DeliveryOutcome.Delivered: Interlocked.Increment(ref _delivered); break;
            default: Interlocked.Increment(ref _lost); break;
        }
    }

    /// <summary>Resolves one instance's configuration and credentials, then sends. Never throws except on a
    /// genuine shutdown.</summary>
    /// <param name="hasPassword">Whether a password ROW exists for this instance, from the credential-free
    /// summary. The only way to distinguish "no password configured" from "the password will not decrypt on
    /// this machine".</param>
    private async Task<DeliveryOutcome> DeliverAsync(
        string instance, bool hasPassword, NotificationJob job, CancellationToken ct)
    {
        var config = await _store.GetSmtpAsync(instance, ct).ConfigureAwait(false);
        ct.ThrowIfCancellationRequested();

        if (config is null)
        {
            // C-3 review round 1 (M-1) — GetSmtpAsync returns null for TWO different things: the instance
            // was deleted between the list read and this one, and the read FAILED (never-throws, so a fault
            // reads as "unconfigured"). Only the first is "the operator's configuration working". They
            // cannot be told apart here, so this follows the rule the rest of this class follows —
            // over-reporting a loss is strictly safer than under-reporting one — and says both
            // possibilities out loud rather than picking one.
            ReportWarning($"Alarm e-mail '{instance}' could not be read back after it was listed as " +
                          "configured — it was either deleted in the last instant, or its configuration " +
                          $"store could not be read. The notification {job.Edge} '{job.Alarm.Key}' was NOT " +
                          "sent to it.");
            return DeliveryOutcome.Lost;
        }

        // 🔴 The authoritative gate, taken on the full configuration through the one shared helper rather
        // than re-derived here — AlarmPriority is declared most-severe-FIRST, and C-2 put that comparison
        // in one place precisely so four channels cannot each get the inversion wrong. Re-taking it also
        // closes the window in which an operator disabled the channel between the summary read and now.
        if (!config.Delivers(job.Alarm.Priority)) return DeliveryOutcome.Suppressed;

        var identity = new SmtpIdentity(
            instance, config.Host, config.Port, config.Tls, config.Recipients?.Count ?? 0);

        var credential = await ResolveCredentialAsync(config, identity, hasPassword, job, ct)
            .ConfigureAwait(false);
        if (credential.Outcome is { } credentialFailure) return credentialFailure;

        ct.ThrowIfCancellationRequested();

        return await SendWithRetriesAsync(config, identity, credential.Credential, job, instance, ct)
            .ConfigureAwait(false);
    }

    /// <summary>
    /// 🔴 The credential decision — where "cannot authenticate" is prevented from silently becoming
    /// "authenticate as nobody".
    ///
    /// <para>This is C-3's I-1 finding applied to the credential C-4 owns.
    /// <see cref="NotificationConfigStore.GetSecretAsync"/> returns <see langword="null"/> for BOTH "no
    /// password is stored" and "the DPAPI blob would not decrypt" — the latter being exactly what a
    /// <c>notifications.db</c> copied from another machine looks like. Handing <see langword="null"/>
    /// credentials to <see cref="SmtpClient"/> is not an error there; it means "send anonymously". So
    /// without this, a machine that had stopped being able to authenticate would either produce a stream of
    /// 5xx rejections that read to an operator as a WRONG password rather than an unreadable one, or —
    /// against a relay that also accepts anonymous mail — would quietly keep working while the configuration
    /// API went on reporting <c>HasPassword = true</c>. Both are worse than a counted, named loss.</para>
    ///
    /// <para>The row's PRESENCE (<paramref name="hasPassword"/>, from the credential-free summary) is what
    /// separates the two cases.</para>
    /// </summary>
    /// <returns><c>Outcome</c> non-null means stop; otherwise <c>Credential</c> is what to authenticate
    /// with, and <see langword="null"/> there legitimately means "send anonymously".</returns>
    private async Task<(DeliveryOutcome? Outcome, NetworkCredential? Credential)> ResolveCredentialAsync(
        SmtpChannelConfig config, SmtpIdentity identity, bool hasPassword, NotificationJob job,
        CancellationToken ct)
    {
        var hasUsername = !string.IsNullOrWhiteSpace(config.Username);

        // The legitimate anonymous case, and it had to be: an in-plant relay on an isolated network that
        // accepts mail from the shop floor without credentials is the Đợt A target deployment, and
        // demanding a password would make the most common configuration impossible. This is the SMTP
        // analogue of the webhook's unsigned POST.
        if (!hasUsername && !hasPassword) return (null, null);

        if (hasUsername && !hasPassword)
        {
            // Sending anyway would present an unauthenticated conversation to a relay that requires one — a
            // 5xx that looks to the operator like their password is WRONG when in fact none is stored.
            ReportWarning($"Alarm e-mail {identity} is configured to authenticate as '{config.Username}', " +
                          "but no password is stored for it. Sending unauthenticated would be rejected by " +
                          $"the relay in a way that looks like a wrong password, so the notification " +
                          $"{job.Edge} '{job.Alarm.Key}' was NOT sent. Store the password under the " +
                          $"'{NotificationSecretNames.SmtpPassword}' secret.");
            return (DeliveryOutcome.Lost, null);
        }

        if (!hasUsername)
        {
            // A stored password with no username cannot be used at all: there is nothing to authenticate
            // AS. Ignoring it and sending anonymously is the silent-downgrade shape this whole method
            // exists to refuse.
            ReportWarning($"Alarm e-mail {identity} has a password stored but NO username configured, so " +
                          "there is nothing to authenticate as. Sending anonymously would silently ignore " +
                          $"a credential an operator deliberately stored, so the notification {job.Edge} " +
                          $"'{job.Alarm.Key}' was NOT sent. Set a username, or remove the stored password " +
                          "to send anonymously on purpose.");
            return (DeliveryOutcome.Lost, null);
        }

        var password = await ReadSecretAsync(NotificationSecretNames.SmtpPassword, identity.Instance, ct)
            .ConfigureAwait(false);

        if (string.IsNullOrEmpty(password))
        {
            // 🔴 hasPassword is true and the read came back empty: the blob exists and would not decrypt.
            // Never the plaintext, never a fragment of it — the failure is reported by what an operator can
            // act on.
            ReportWarning($"Alarm e-mail {identity} has a password stored for '{config.Username}', but it " +
                          "could not be read (the encrypted value is unreadable on this machine — " +
                          "typically a notifications.db copied from another host). Sending unauthenticated " +
                          $"would silently stop this machine proving who it is, so the notification " +
                          $"{job.Edge} '{job.Alarm.Key}' was NOT sent. Re-save the password to repair it, " +
                          "or remove it and clear the username to send anonymously on purpose.");
            return (DeliveryOutcome.Lost, null);
        }

        return (null, new NetworkCredential(config.Username, password));
    }

    /// <summary>The ONE way this class reads a secret. The store propagates cancellation itself since Task
    /// C-4; this guard closes the remaining window, in which a shutdown arrives after the read returned but
    /// before its result is acted on — where the result is acted on by reporting a MISSING CREDENTIAL that
    /// is not missing, moving <c>Lost</c> instead of <c>Cancelled</c>, and, because no
    /// <see cref="OperationCanceledException"/> propagates, being recorded by C-1's drain loop as a
    /// successful dispatch.</summary>
    private async Task<string?> ReadSecretAsync(string name, string instance, CancellationToken ct)
    {
        var secret = await _store
            .GetSecretAsync(NotificationChannel.Smtp, name, instance, ct)
            .ConfigureAwait(false);

        ct.ThrowIfCancellationRequested();
        return secret;
    }

    // ─────────────────────────────────────────────────────────────────────
    // The send, with a bounded retry budget.
    // ─────────────────────────────────────────────────────────────────────

    private async Task<DeliveryOutcome> SendWithRetriesAsync(
        SmtpChannelConfig config, SmtpIdentity identity, NetworkCredential? credential,
        NotificationJob job, string instance, CancellationToken ct)
    {
        // 🔴 STABLE for every attempt of this delivery, like the webhook's. It becomes the Message-ID, so a
        // retry after a timeout that the relay had in fact already accepted arrives carrying the SAME
        // Message-ID and a receiving server can deduplicate it. A fresh id per attempt would turn this retry
        // policy into a duplicate generator.
        var deliveryId = Guid.NewGuid().ToString("N");

        using var budget = CancellationTokenSource.CreateLinkedTokenSource(ct);
        budget.CancelAfter(_totalBudget);
        var elapsed = Stopwatch.StartNew();

        string? failure = null;
        Exception? cause = null;
        var attemptsMade = 0;

        for (var attempt = 1; attempt <= _maxAttempts; attempt++)
        {
            // 🔴 Cancellation beats the budget, every time — the coordinator's C-3 ruling, and the reason
            // C-1's unbounded post-timeout `await _drainLoop` cannot hang the host on this channel's
            // account.
            ct.ThrowIfCancellationRequested();

            attemptsMade = attempt;

            using (var attemptCts = CancellationTokenSource.CreateLinkedTokenSource(budget.Token))
            {
                attemptCts.CancelAfter(_attemptTimeout);
                try
                {
                    Interlocked.Increment(ref _attempts);
                    if (attempt > 1) Interlocked.Increment(ref _retries);

                    var rejected = await SendOnceAsync(
                        config, identity, credential, job, instance, deliveryId, attemptCts.Token)
                        .ConfigureAwait(false);

                    if (rejected.Count == 0) return DeliveryOutcome.Delivered;

                    // 🔴 Some recipients were accepted and some were not. Measured: the relay still ran
                    // DATA and the message really was delivered to the survivors. Retrying would send it to
                    // them AGAIN and fail on the same addresses, so this is terminal — but it is a
                    // DELIVERY, because somebody was told. Named addresses: see the class doc comment on
                    // personal data.
                    Interlocked.Increment(ref _partiallyDelivered);
                    ReportWarning(
                        $"Alarm e-mail {identity} was delivered, but the relay REJECTED " +
                        $"{rejected.Count.ToString(System.Globalization.CultureInfo.InvariantCulture)} of " +
                        $"its recipient(s): {string.Join(", ", rejected)}. Those people were NOT told about " +
                        $"{job.Edge} '{job.Alarm.Key}'; everyone else was. Correct or remove the rejected " +
                        "address(es) — this is not retried, because retrying would deliver the message to " +
                        "the others a second time.");
                    return DeliveryOutcome.Delivered;
                }
                // 🔴 The token checks come FIRST and they catch EVERY exception type, not just
                // OperationCanceledException — the divergence from the webhook channel that SmtpClient
                // forces. Cancelling a pending TCP connect is done by disposing the client (see
                // SendOnceAsync), which surfaces as an SmtpException rather than as a cancellation. Without
                // these filters a shutdown would be classified as a transport failure, retried, counted as
                // Lost instead of Cancelled, and never propagated to C-1's drain loop.
                catch (Exception) when (ct.IsCancellationRequested)
                {
                    throw new OperationCanceledException(
                        "The alarm e-mail was abandoned because the process is shutting down.", ct);
                }
                catch (Exception) when (budget.IsCancellationRequested)
                {
                    failure = BudgetElapsed();
                    cause = null;
                    break;
                }
                catch (Exception) when (attemptCts.IsCancellationRequested)
                {
                    // The per-attempt timeout and ONLY that: a shutdown and the budget were excluded above.
                    // A slow relay is exactly the transport failure worth trying again.
                    failure = $"the {_attemptTimeout.TotalSeconds:0.#}s attempt timeout elapsed";
                    cause = null;
                }
                catch (Exception ex)
                {
                    var (kind, description) = Classify(ex, credential is not null);
                    if (kind == FailureKind.Permanent)
                    {
                        // "Stop, you are wrong." Retrying would replay an identical conversation against a
                        // relay that has already made a considered decision about it, at the cost of
                        // drain-loop time every other notification is waiting on.
                        var message =
                            $"Alarm e-mail {identity} was REJECTED — {description}. This is permanent, so " +
                            $"it was not retried. The notification {job.Edge} '{job.Alarm.Key}' is lost." +
                            PermanentHint(ex);
                        if (ex is SmtpException or SmtpFailedRecipientException) ReportWarning(message);
                        else ReportError(ex, message);
                        return DeliveryOutcome.Lost;
                    }

                    failure = description;
                    cause = ex is SocketException or IOException ? ex : null;
                }
            }

            if (attempt == _maxAttempts) break;

            var delay = NextDelay(attempt, elapsed.Elapsed);
            if (delay is null)
            {
                failure = BudgetElapsed();
                break;
            }

            try
            {
                await Task.Delay(delay.Value, budget.Token).ConfigureAwait(false);
            }
            catch (OperationCanceledException) when (ct.IsCancellationRequested)
            {
                throw;
            }
            catch (OperationCanceledException)
            {
                failure = BudgetElapsed();
                break;
            }
        }

        var summary =
            $"Alarm e-mail {identity} FAILED after " +
            $"{attemptsMade.ToString(System.Globalization.CultureInfo.InvariantCulture)} attempt(s) — " +
            $"{failure ?? "no attempt completed"}. The notification {job.Edge} '{job.Alarm.Key}' is LOST: " +
            "this build has no delivery queue behind the e-mail channel, and the alarm's edge will not be " +
            "re-emitted.";

        if (cause is not null) ReportError(cause, summary);
        else ReportWarning(summary);

        return DeliveryOutcome.Lost;
    }

    /// <summary>
    /// One SMTP conversation.
    ///
    /// <para>🔴 <b>The cancellation mechanism, and why it is two things rather than one.</b>
    /// <see cref="SmtpClient.SendMailAsync(MailMessage, CancellationToken)"/> honours its token in every
    /// phase EXCEPT while the TCP connect is pending — measured: against an unroutable address a token
    /// cancelled at 500 ms did not return for <b>21.0 seconds</b>, the OS connect timeout, and it surfaced
    /// as <see cref="SmtpException"/> rather than as a cancellation. Left alone that hangs host shutdown for
    /// 21 s per configured instance, because C-1's <c>DisposeAsync</c> awaits the drain loop UNBOUNDED after
    /// its own 5 s timeout.</para>
    ///
    /// <para>So the token is backed by a registration that DISPOSES the client. Disposal tears the pending
    /// socket down, which is the only thing that interrupts a connect in progress: measured at
    /// <b>503 / 508 / 517 ms</b> against a token cancelled at 500 ms — i.e. 3-17 ms of overhead, against 21
    /// s without it. <see cref="SmtpClient.SendAsyncCancel"/> was measured and does NOT work for this API
    /// (it belongs to the older event-based <c>SendAsync</c>, and the send still ran the full 21 s). A
    /// healthy send with the registration in place completes normally, so the mechanism costs nothing when
    /// it is not needed.</para>
    ///
    /// <para><b>The consequence the caller must handle:</b> a cancellation delivered this way arrives as an
    /// <see cref="SmtpException"/>, not an <see cref="OperationCanceledException"/> — which is exactly why
    /// <see cref="SendWithRetriesAsync"/>'s catch filters test the TOKENS rather than the exception
    /// type.</para>
    /// </summary>
    /// <returns>The recipients the relay rejected while accepting others; empty means everyone was
    /// accepted.</returns>
    private async Task<IReadOnlyList<string>> SendOnceAsync(
        SmtpChannelConfig config, SmtpIdentity identity, NetworkCredential? credential,
        NotificationJob job, string instance, string deliveryId, CancellationToken attemptToken)
    {
        using var message = BuildMessage(config, job, instance, deliveryId);

        using var client = new SmtpClient(config.Host, config.Port)
        {
            // 🔴 STARTTLS, and only STARTTLS — see the class doc comment. This flag is the entire TLS
            // surface System.Net.Mail offers.
            EnableSsl = config.Tls == SmtpTlsMode.StartTls,
            DeliveryMethod = SmtpDeliveryMethod.Network,
            // Never the process identity: this product must not authenticate to a third party's mail server
            // as whatever Windows account the service happens to run under.
            UseDefaultCredentials = false,
            Credentials = credential,
            // A BACKSTOP, deliberately longer than this class's own attempt bound so it can never be the
            // mechanism that fires — see SmtpClientTimeoutBackstopFactor for why that matters to the retry
            // decision. It does bound the connect phase on its own (measured), which is what makes it a
            // usable last line if the token machinery above ever fails.
            Timeout = checked((int)Math.Min(
                int.MaxValue, _attemptTimeout.TotalMilliseconds * SmtpClientTimeoutBackstopFactor)),
        };

        // The registration is disposed BEFORE the client (reverse declaration order), and
        // CancellationTokenRegistration.Dispose waits for a callback already running on another thread — so
        // the deterministic `using` disposal below cannot race the cancellation callback's.
        using var abortOnCancel = attemptToken.Register(static state =>
        {
            try { ((SmtpClient)state!).Dispose(); }
            catch { /* racing a completing send; the send's own outcome is what is reported */ }
        }, client);

        var rejected = new List<string>();
        try
        {
            await client.SendMailAsync(message, attemptToken).ConfigureAwait(false);
        }
        catch (SmtpFailedRecipientsException ex) when (ex.InnerExceptions.Length < message.To.Count)
        {
            // SOME recipients were rejected and at least one was not. Anything else — every recipient
            // rejected, or a failure that is not recipient-scoped — propagates to the classifier.
            foreach (var inner in ex.InnerExceptions) rejected.Add(Recipient(inner));
        }
        catch (SmtpFailedRecipientException ex) when (message.To.Count > 1 &&
                                                      ex is not SmtpFailedRecipientsException)
        {
            // The singular type means exactly one recipient failed; with more than one configured, the rest
            // were accepted. (Measured: .NET returns the singular type for a single failure and the plural
            // type for several.)
            rejected.Add(Recipient(ex));
        }

        return rejected;
    }

    /// <summary>Builds the <see cref="MailMessage"/>. Everything that can throw lives here rather than in
    /// <see cref="SmtpMessageBuilder"/>, which is pure — see that class for why the split exists.</summary>
    private MailMessage BuildMessage(
        SmtpChannelConfig config, NotificationJob job, string instance, string deliveryId)
    {
        var from = new MailAddress(config.FromAddress);
        var message = new MailMessage { From = from };

        foreach (var recipient in config.Recipients) message.To.Add(new MailAddress(recipient));

        var plan = SmtpMessageBuilder.Build(
            job, _sourceHost, instance, from.Host, deliveryId, _clock());

        message.Subject = plan.Subject;
        message.Body = plan.Body;
        message.IsBodyHtml = false;
        message.SubjectEncoding = System.Text.Encoding.UTF8;
        message.BodyEncoding = System.Text.Encoding.UTF8;
        message.Priority = plan.Urgent ? MailPriority.High : MailPriority.Normal;

        foreach (var (name, value) in plan.Headers) message.Headers.Add(name, value);

        return message;
    }

    // ─────────────────────────────────────────────────────────────────────
    // Retry classification — RFC 5321's own 4xx/5xx split, plus what it cannot express.
    // ─────────────────────────────────────────────────────────────────────

    /// <summary>
    /// 🔴 <b>Whether this failure is worth another attempt.</b> SMTP makes the distinction the brief asks
    /// for cleanly, and this is the one place it is decided.
    ///
    /// <para><b>RFC 5321's rule:</b> a <b>4xx</b> reply is TRANSIENT and the specified remedy is to try
    /// again (421 service not available, 450 mailbox busy / greylisted, 451 local error, 452 insufficient
    /// storage). A <b>5xx</b> reply is PERMANENT and the specified behaviour is to stop — 535 authentication
    /// failed, 530 authentication required, 550 no such mailbox, 552 message too big, 554 relay access
    /// denied. Those are exactly the three cases the brief names as must-not-retry, and hammering any of
    /// them is how a service account gets locked out or a relay starts refusing this host outright.</para>
    ///
    /// <para>🔴 <b>Where a REJECTED PASSWORD actually shows up, measured — and it is not where it looks
    /// like it should.</b> <see cref="SmtpClient"/> does <b>not</b> abort when the relay rejects
    /// <c>AUTH</c>: it swallows the <c>535</c> and carries straight on to <c>MAIL FROM</c>
    /// unauthenticated. Verified against a relay that answered 535 to the credentials and then accepted
    /// everything — the send SUCCEEDED. So a wrong password never surfaces as an authentication error at
    /// all; what surfaces is whatever the relay says NEXT, which for any real authenticating relay is a
    /// clean 5xx (<c>530 Authentication required</c>, or <c>554 Relay access denied</c>) — and the 4xx/5xx
    /// rule above then classifies it permanent with no special case needed. The brief's "bad credentials
    /// must not be retried" is therefore satisfied by the ordinary rule rather than by detecting
    /// authentication, which this API gives no way to do.</para>
    ///
    /// <para><b>What the status code cannot express, and how it is handled.</b>
    /// <see cref="SmtpException.StatusCode"/> is <c>GeneralFailure</c> (-1) for several different things:</para>
    /// <list type="bullet">
    /// <item><description>a refused connection or a DNS failure — inner <see cref="SocketException"/> —
    /// <b>retry</b>;</description></item>
    /// <item><description>a read timeout — no inner exception — would be worth retrying, but this class's
    /// own attempt timeout is made to fire first (see <see cref="SmtpClientTimeoutBackstopFactor"/>), so it
    /// never reaches here;</description></item>
    /// <item><description>a protocol breakdown the client could not characterise — no inner exception —
    /// <b>permanent</b>, because the same conversation against the same relay will break the same way, and
    /// retrying spends drain-loop time every other notification is waiting on;</description></item>
    /// <item><description>a multi-recipient failure, where the real codes are on
    /// <see cref="SmtpFailedRecipientsException.InnerExceptions"/> and the outer status is meaningless.
    /// Reading the outer one would retry a permanent 550.</description></item>
    /// </list>
    /// <para>So the rule is stated in terms of the CAUSE rather than the code: a transport failure is one
    /// with a socket/IO cause, and a bare <c>GeneralFailure</c> with no such cause is treated as permanent.
    /// That errs toward not retrying, which is the safe direction here.</para>
    /// </summary>
    private static (FailureKind Kind, string Description) Classify(Exception ex, bool authenticated) => ex switch
    {
        // Must precede SmtpFailedRecipientException/SmtpException — it derives from both. Reaching here
        // means EVERY recipient was rejected (a partial rejection is handled in SendOnceAsync), so the
        // decision is the worst of the per-recipient codes.
        SmtpFailedRecipientsException recipients => ClassifyRecipients(recipients),

        SmtpFailedRecipientException recipient => ClassifyStatus(
            (int)recipient.StatusCode,
            $"the relay rejected every recipient (SMTP {(int)recipient.StatusCode})"),

        SmtpException { InnerException: SocketException or IOException } transport =>
            (FailureKind.Retryable, $"the connection failed ({transport.InnerException!.GetType().Name})"),

        // 🔴 A bare GeneralFailure: a protocol breakdown with no socket cause. See the method doc — this is
        // NOT where a rejected password lands (SmtpClient carries on past a rejected AUTH and the relay's
        // NEXT reply is what fails, as a clean 5xx). Permanent because the same conversation would break
        // the same way, and the drain loop is paying for every retry.
        SmtpException { StatusCode: SmtpStatusCode.GeneralFailure } =>
            (FailureKind.Permanent, authenticated
                ? "the relay refused the conversation; if this persists, check the stored username and password"
                : "the relay refused the conversation"),

        SmtpException smtp => ClassifyStatus(
            (int)smtp.StatusCode, $"the relay answered SMTP {(int)smtp.StatusCode} ({smtp.StatusCode})"),

        SocketException or IOException => (FailureKind.Retryable, $"the connection failed ({ex.GetType().Name})"),

        // A malformed From address, a malformed recipient, or a subject the mail stack refused: the same
        // configuration would fail identically next time.
        FormatException or ArgumentException or InvalidOperationException or ObjectDisposedException =>
            (FailureKind.Permanent, $"the message could not be built or sent ({ex.GetType().Name})"),

        _ => (FailureKind.Permanent, $"an unexpected failure ({ex.GetType().Name})"),
    };

    private static (FailureKind, string) ClassifyRecipients(SmtpFailedRecipientsException ex)
    {
        // Permanent if ANY recipient failed permanently: the transient ones would be retried into a
        // conversation that is going to fail on the permanent ones anyway, and every recipient failed here
        // by construction, so nothing was delivered to protect from a duplicate.
        var codes = ex.InnerExceptions.Select(inner => (int)inner.StatusCode).ToArray();
        var permanent = codes.Any(code => code is >= 500 and < 600);
        return (permanent ? FailureKind.Permanent : FailureKind.Retryable,
            $"the relay rejected all {ex.InnerExceptions.Length.ToString(System.Globalization.CultureInfo.InvariantCulture)} " +
            $"recipient(s) (SMTP {string.Join("/", codes.Distinct())})");
    }

    private static (FailureKind, string) ClassifyStatus(int code, string description) =>
        (code is >= 400 and < 500 ? FailureKind.Retryable : FailureKind.Permanent, description);

    /// <summary>Extra guidance for the permanent failures whose cause an operator can act on — the
    /// difference between "the e-mail is broken" and a support call.</summary>
    private static string PermanentHint(Exception ex)
    {
        var code = ex switch
        {
            SmtpFailedRecipientsException many when many.InnerExceptions.Length > 0 =>
                (int)many.InnerExceptions[0].StatusCode,
            SmtpFailedRecipientException one => (int)one.StatusCode,
            SmtpException smtp => (int)smtp.StatusCode,
            _ => 0,
        };

        return code switch
        {
            (int)SmtpStatusCode.GeneralFailure =>
                " Check the username and the stored password for this channel, and that the relay allows " +
                "this host to send.",
            530 or 535 =>
                " The relay refused the credentials. Check the username and re-save the password; if the " +
                "relay needs no authentication, clear both.",
            550 or 551 or 553 =>
                " A 550/551/553 means the relay does not accept one of these addresses — check the " +
                "recipient list and the From address.",
            554 =>
                " A 554 is usually RELAY ACCESS DENIED: the relay will not send on this host's behalf. " +
                "Authenticate, or have the mail administrator allow this host's address.",
            552 => " The message was too large for the relay, which is a relay configuration matter.",
            _ => "",
        };
    }

    private string BudgetElapsed() => $"the {_totalBudget.TotalSeconds:0.#}s delivery budget elapsed";

    /// <summary>How long to wait before the next attempt, or <see langword="null"/> if there is no room
    /// left in the budget for one. There is no <c>Retry-After</c> equivalent in SMTP — a 4xx carries no
    /// machine-readable delay — so the backoff is entirely ours.</summary>
    private TimeSpan? NextDelay(int attempt, TimeSpan elapsed)
    {
        var delay = TimeSpan.FromMilliseconds(_baseBackoff.TotalMilliseconds * Math.Pow(2, attempt - 1));
        return delay >= _totalBudget - elapsed ? null : delay;
    }

    /// <summary>The rejected address, as the relay named it. .NET wraps it in angle brackets; they are
    /// stripped so an operator can copy the address straight into the configuration.</summary>
    private static string Recipient(SmtpFailedRecipientException ex) =>
        (ex.FailedRecipient ?? "unknown").Trim('<', '>');

    // ─────────────────────────────────────────────────────────────────────
    // Reporting — never itself a failure.
    // ─────────────────────────────────────────────────────────────────────

    private void ReportError(Exception ex, string message)
    {
        try { _logError?.Invoke(ex, message); } catch { /* nothing left to report it to */ }
    }

    private void ReportWarning(string message)
    {
        try { _logWarning?.Invoke(message); } catch { /* nothing left to report it to */ }
    }
}
