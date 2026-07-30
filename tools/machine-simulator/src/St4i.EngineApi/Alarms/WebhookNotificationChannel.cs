using System.Diagnostics;
using System.Globalization;
using System.Net;
using System.Net.Http.Headers;
using System.Runtime.Versioning;

namespace St4i.EngineApi.Alarms;

/// <summary>
/// Task C-3 — a point-in-time snapshot of <see cref="WebhookNotificationChannel"/>'s counters, so
/// "did anything actually leave this machine, and did anything get lost?" is answerable without a log file.
/// Cumulative since process start. C-7 surfaces these next to <see cref="AlarmNotifierStats"/>.
///
/// <para>🔴 <b>The accounting invariant.</b> For every (notification, configured webhook instance) pair
/// this channel sees, EXACTLY ONE of <paramref name="Suppressed"/>, <paramref name="Delivered"/>,
/// <paramref name="Lost"/> and <paramref name="Cancelled"/> moves — there is one <c>switch</c> in the whole
/// class that touches the first three, every path through the delivery reaches it, and the fourth is
/// reached only by re-throwing. That is what makes "a notification vanished and no counter moved" a state
/// this class cannot be in, rather than a rule a maintainer has to remember.</para>
/// </summary>
/// <param name="Considered">Notifications handed to this channel by the drain loop. Includes every edge
/// kind and priority, before any filtering.</param>
/// <param name="Suppressed">(notification, instance) pairs deliberately not sent — the instance is
/// disabled, or the alarm is less severe than that instance's minimum priority. NOT a loss: this is the
/// operator's configuration working.</param>
/// <param name="Delivered">(notification, instance) pairs the receiver answered with a 2xx.</param>
/// <param name="Lost">
/// 🔴 (notification, instance) pairs that were MEANT to be delivered and were not. The full list, because
/// this is the operator-facing definition of the counter and a stale one is how the <c>Unsigned</c> defect
/// below arose: a permanent rejection; a retry budget exhausted; an undecryptable destination URL; an
/// <b>undecryptable signing secret</b> (review round 1, I-1 — sending unsigned instead would silently stop
/// this machine proving its identity); a <b>configuration that could not be read back</b> after being
/// listed (review round 1, M-1 — indistinguishable from a delete in the same instant, so counted as the
/// loss it more likely is); an unusable auth token; or an internal fault.
///
/// <para><b>This batch offers no delivery guarantee and there is no queue behind this channel</b> (see
/// <see cref="AlarmNotifier"/>): the edge that produced this notification will not be re-emitted. A
/// non-zero value here means somebody was not told something that happened.</para></param>
/// <param name="Cancelled">Deliveries abandoned because the process is shutting down. Also a loss, counted
/// separately because it is expected during shutdown and alarming at any other time. When shutdown arrives
/// before the destination list has been resolved the unit is the whole notification rather than one
/// (notification, instance) pair — there is no instance list yet to count against.</param>
/// <param name="Attempts">HTTP requests actually issued, INCLUDING retries. <c>Attempts</c> materially
/// above <c>Delivered + Lost</c> means the receiver is flaky.</param>
/// <param name="Retries">The subset of <paramref name="Attempts"/> that were not the first try for their
/// delivery.</param>
/// <param name="Unsigned">Attempts sent with no <c>X-ST4I-Signature</c>, which after review round 1 (I-1)
/// can only mean ONE thing: no signing secret is configured for that instance. Legitimate for Slack/Teams
/// (the URL is the credential there), and worth being able to see for anything else — see
/// <see cref="WebhookSigner"/>. It deliberately does NOT cover "a signing secret is configured but its key
/// could not be decrypted": that is a channel that has stopped proving its identity, it is counted under
/// <paramref name="Lost"/>, and nothing is sent.</param>
public sealed record WebhookChannelStats(
    long Considered,
    long Suppressed,
    long Delivered,
    long Lost,
    long Cancelled,
    long Attempts,
    long Retries,
    long Unsigned);

/// <summary>
/// 🔴 Task C-3 (.superpowers/sdd/2026-07-30-dotC-alarm-notification-blueprint/task-3-brief.md) — <b>the
/// first time an alarm leaves this machine.</b> An HTTP POST of a versioned, signed
/// <see cref="WebhookPayload"/> to every configured, enabled webhook whose minimum priority the alarm
/// meets.
///
/// <para><b>Where it sits.</b> Behind C-1's <see cref="AlarmNotifier"/>: the edge detector has already
/// absorbed the 5s re-raise storm, so this class sees one message per real change and never per tick. It
/// runs on the notifier's single-reader DRAIN THREAD, which holds no lock — so it may block, but every
/// millisecond it blocks delays every other notification behind it. That constraint, not politeness, is
/// what sets the retry budget below.</para>
///
/// <para>🔴 <b>Never-throws, with exactly one deliberate exception.</b> Every failure is caught, counted
/// and reported. The ONE thing that propagates is an <see cref="OperationCanceledException"/> raised by a
/// genuine shutdown — because C-1's drain loop distinguishes that case and counts the job as a drop, and
/// swallowing it would make a truncated drain invisible. A dispatch timeout is a failure to be counted; a
/// shutdown is not. (<see cref="HttpClient"/>'s own request timeout raises a
/// <see cref="TaskCanceledException"/>, which DERIVES from <see cref="OperationCanceledException"/> — the
/// classic way to muddle the two. This class cannot: <see cref="HttpClient.Timeout"/> is set to
/// <see cref="Timeout.InfiniteTimeSpan"/>, so every cancellation here comes from a token whose source this
/// class knows.)</para>
///
/// <para>🔴 <b>ONE <see cref="HttpClient"/> for the channel's lifetime.</b> Constructing one per send is
/// the standard route to socket exhaustion — every disposed client leaves a connection in TIME_WAIT for
/// minutes. <see cref="SocketsHttpHandler.PooledConnectionLifetime"/> is set because the other half of that
/// trade is a long-lived client that never re-resolves DNS; two minutes bounds how long this channel can
/// keep posting to an address a receiver has moved away from.</para>
///
/// <para>🔴 <b>Redirects are NOT followed.</b> A webhook URL is a bearer capability and the request carries
/// a signature and possibly an auth token; following a 3xx would hand all three to a host the operator
/// never configured, chosen by whoever controls the original one. A redirect is therefore a permanent
/// failure with a clear reason instead of a silent re-target.</para>
///
/// <para>🔴 <b>Nothing this class logs can contain a credential, structurally.</b> Every message it
/// produces names its destination through <see cref="WebhookIdentity"/>, whose fields are exactly C-2's
/// non-secret webhook projection — the instance, the <c>scheme://host</c> endpoint, the truncated URL
/// fingerprint and the operator's label. <b>The URL is not a field of that type</b>, so there is no
/// formatting path it can travel down. The signing secret is only ever an argument to
/// <see cref="WebhookSigner.Sign"/>; the auth token is only ever a header value. The receiver's RESPONSE
/// BODY is deliberately never read into a log either: an echoing or misconfigured endpoint would reflect
/// our own auth header back at us, and a log line is a much longer-lived place for a token than a socket.
/// (One residual, stated rather than papered over: a <see cref="HttpRequestException"/> from a connect or
/// DNS failure carries <c>host:port</c> in its own message. That is exactly
/// <see cref="WebhookChannelConfig.Endpoint"/>, which C-2 classifies non-secret and returns from every
/// public read — the capability-bearing path and query never appear.)</para>
///
/// <para><b>It does not write to the alarm store</b>, deliberately. C-1's review flagged that a channel
/// calling back into <see cref="IAlarmStore"/> would take the store's write gate from the drain thread and
/// couple drain throughput to alarm-write throughput on the policy-denial request path. This channel reads
/// configuration and posts; the <see cref="NotificationJob"/> carries everything else.</para>
///
/// <para><b>Every edge kind is sent, including <see cref="AlarmEdgeKind.Restored"/></b>, with the kind in
/// both the body and the <c>X-ST4I-Event</c> header so a receiver can route or drop it without parsing.
/// C-1 noted a webhook MAY ignore <c>Restored</c>; it is not ignored here because the blueprint's own
/// targets include machine receivers (MES, Zabbix) whose whole reason to care is re-establishing standing
/// state after an engine restart, and because a channel that silently drops a documented edge kind is a
/// surprise where a field a receiver filters on is not. The known cost is C-1's: a crash-looping process
/// re-announces standing alarms once per restart. It is bounded by restart rate rather than tick rate,
/// further bounded by each instance's minimum priority, and rate limiting is C-7's.</para>
/// </summary>
[SupportedOSPlatform("windows")]
public sealed class WebhookNotificationChannel : IDisposable
{
    /// <summary>
    /// Per-attempt HTTP timeout. Matches <c>ResilienceProbe</c>'s 5s, this repository's only other outbound
    /// HTTP timeout, rather than inventing a second number.
    /// </summary>
    public static readonly TimeSpan DefaultAttemptTimeout = TimeSpan.FromSeconds(5);

    /// <summary>
    /// 🔴 The HARD bound on how long one notification may occupy the drain thread for one webhook, retries
    /// and backoff included.
    ///
    /// <para><b>Why 10 seconds, argued.</b> This channel blocks C-1's single-reader drain loop, so a dead
    /// webhook delays every other notification behind it by exactly this much. Ten seconds admits two full
    /// 5s attempts against a BLACK-HOLING endpoint — one that accepts the connection and then says nothing,
    /// where the per-attempt timeout dominates — and all three attempts against a REFUSED one.</para>
    ///
    /// <para>🔴 That second case is the one that actually sets the number, and it is measured rather than
    /// assumed: on Windows, .NET's connect path takes roughly <b>two seconds</b> to surface
    /// <c>HttpRequestException</c> for a plainly refused TCP connection, not the microseconds an RST would
    /// suggest. Three attempts plus 250 ms + 500 ms of backoff is therefore about 6.8 s — inside a 10 s
    /// budget and well outside a 5 s one. A 5 s budget would silently degrade "retry a refused connection
    /// three times" into "try it twice", which is the sort of thing that is true in the code and false in
    /// production.</para>
    ///
    /// <para>Anything longer starts to matter for the one bulk case this channel has —
    /// <see cref="AlarmEdgeKind.Restored"/> at startup emits one job per standing alarm — and anything much
    /// shorter would give up on a receiver that is merely slow. Shutdown does not wait for it either way:
    /// cancellation wins over the budget, always.</para>
    /// </summary>
    public static readonly TimeSpan DefaultTotalBudget = TimeSpan.FromSeconds(10);

    /// <summary>First try plus two retries. Three is the vendored SDK's shape and is where the value of
    /// another attempt falls off: a receiver that has failed three times in ten seconds is down, not
    /// blipping.</summary>
    public const int DefaultMaxAttempts = 3;

    /// <summary>Exponential backoff base — 250 ms, then 500 ms. Short because the whole budget is short;
    /// no jitter because there is exactly one sender per machine, so there is no herd to disperse and
    /// determinism is worth more in a test.</summary>
    public static readonly TimeSpan DefaultBaseBackoff = TimeSpan.FromMilliseconds(250);

    /// <summary>
    /// 🔴 The statuses worth trying again, and by omission the ones that mean "stop, you are wrong".
    ///
    /// <para><c>{429, 500, 502, 503, 504}</c> is the vendored SDK's set
    /// (<c>examples/device-client/csharp/St4iDeviceClient.cs</c>) and is kept as-is: rate limiting, a
    /// transient server fault, and the three proxy/gateway statuses that mean the receiver's front door
    /// answered but its back end did not. <c>408</c> is added — it is defined as "the client did not
    /// produce a request in time", and retrying is its specified remedy.</para>
    ///
    /// <para><b>Everything else is permanent, and the 4xx cases are the ones that matter.</b> A 400 means
    /// the receiver rejected these exact bytes and a retry sends the same bytes again. A 401/403 means the
    /// auth token is wrong, and hammering it is how a service account gets locked out. <b>A 404 is what
    /// Slack returns for a REVOKED incoming webhook</b> — retrying a deleted destination three times per
    /// alarm forever is the purest form of the noise this whole batch exists to prevent. 410 and 422 are
    /// the same story. Retrying any of them costs the drain loop real time to reach an outcome that was
    /// already known from the first response.</para>
    /// </summary>
    private static readonly HashSet<int> RetryableStatuses = new() { 408, 429, 500, 502, 503, 504 };

    private readonly NotificationConfigStore _store;
    private readonly HttpClient _http;
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
    private long _unsigned;

    /// <summary>
    /// 🔴 The ONLY way this class names a webhook in a message. Its fields are exactly C-2's non-secret
    /// webhook projection; the destination URL is deliberately NOT one of them, which is what makes "no log
    /// line can contain the capability" a property of the type rather than of every call site remembering.
    /// </summary>
    private readonly record struct WebhookIdentity(
        string Instance, string Endpoint, string Fingerprint, string? Label)
    {
        public override string ToString() =>
            string.IsNullOrWhiteSpace(Label)
                ? $"'{Instance}' ({Endpoint}, url {Fingerprint})"
                : $"'{Instance}' ('{Label}', {Endpoint}, url {Fingerprint})";
    }

    /// <summary>What one (notification, instance) delivery did. Deliberately only three members: every
    /// path through <see cref="DeliverAsync"/> ends at exactly one of them, and the single <c>switch</c>
    /// over this enum is the accounting choke point described on <see cref="WebhookChannelStats"/>.</summary>
    private enum DeliveryOutcome
    {
        Suppressed,
        Delivered,
        Lost,
    }

    /// <summary>One attempt's verdict, so the retry loop has a single place that decides "again or not".
    /// There is deliberately no "permanent" member: the two permanent cases — a non-retryable status and an
    /// unsendable request — report and <c>return</c> from inside the attempt, because both already know
    /// exactly what to say and neither can be usefully described by a later, more generic summary.</summary>
    private enum AttemptVerdict
    {
        /// <summary>Worth another go if there is budget and an attempt left.</summary>
        Retryable,

        /// <summary>Out of budget; do not sleep, do not retry.</summary>
        BudgetExhausted,
    }

    /// <param name="store">C-2's configuration store. Read on EVERY notification rather than cached, so an
    /// operator enabling, disabling or re-pointing a webhook through C-7 takes effect on the next alarm
    /// with no restart and no cache to invalidate. The cost is one SQLite read per notification — and
    /// notifications are edges, not ticks.</param>
    /// <param name="sourceHost">What the payload reports as the machine that sent it. Defaults to
    /// <see cref="Environment.MachineName"/>; a parameter so the wire format is directly assertable.</param>
    /// <param name="clock">Injectable for tests. Supplies the per-attempt timestamp that goes into both the
    /// payload and the signature.</param>
    public WebhookNotificationChannel(
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

        var handler = new SocketsHttpHandler
        {
            // See the class doc comment: a redirect would re-target a signed, credentialed POST at a host
            // the operator never configured.
            AllowAutoRedirect = false,
            // The price of a process-lifetime HttpClient is stale DNS. Two minutes is the widely used bound
            // and is short relative to how long a webhook configuration lives.
            PooledConnectionLifetime = TimeSpan.FromMinutes(2),
            AutomaticDecompression = DecompressionMethods.None,
        };

        // 🔴 InfiniteTimeSpan on purpose. HttpClient's own timeout raises a TaskCanceledException that is
        // indistinguishable at the catch site from a shutdown, which is precisely the confusion C-1's
        // review had to fix one layer up. Removing that timeout entirely means every cancellation this
        // class sees came from a token it created or was handed, so "is this a shutdown?" is answerable
        // rather than guessable. The per-attempt bound is enforced by _attemptTimeout and the whole send by
        // _totalBudget; neither can be exceeded, because those linked sources cancel the request itself.
        _http = new HttpClient(handler, disposeHandler: true) { Timeout = Timeout.InfiniteTimeSpan };
        _http.DefaultRequestHeaders.UserAgent.ParseAdd(WebhookContract.UserAgent);
    }

    /// <summary>Cumulative counters — see <see cref="WebhookChannelStats"/>.</summary>
    public WebhookChannelStats Stats => new(
        Interlocked.Read(ref _considered),
        Interlocked.Read(ref _suppressed),
        Interlocked.Read(ref _delivered),
        Interlocked.Read(ref _lost),
        Interlocked.Read(ref _cancelled),
        Interlocked.Read(ref _attempts),
        Interlocked.Read(ref _retries),
        Interlocked.Read(ref _unsigned));

    // ─────────────────────────────────────────────────────────────────────
    // Dispatch — the delegate AlarmNotifier's drain loop calls.
    // ─────────────────────────────────────────────────────────────────────

    /// <summary>
    /// C-1's <c>dispatch</c> delegate. Fans out to every configured webhook instance CONCURRENTLY.
    ///
    /// <para>🔴 <b>Why more than one webhook, and why concurrently.</b> C-2 put <c>instance</c> in the
    /// primary key specifically to leave the count open, and the blueprint's own target list — Slack,
    /// Teams, MES, Zabbix — implies more than one; so this channel reads and posts to EVERY configured
    /// webhook instance rather than exactly one. Done sequentially that would multiply the head-of-line
    /// delay this class already imposes on C-1's single-reader drain loop: N dead webhooks would hold the
    /// loop for N × <see cref="DefaultTotalBudget"/>. Destinations are independent and have no ordering
    /// relationship with one another, so fanning out keeps the loop's exposure at ONE budget however many
    /// are configured. Ordering BETWEEN notifications is untouched — the drain loop still hands over one
    /// job at a time, and a key's <c>Cleared</c> still cannot overtake its <c>Raised</c>.</para>
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

            // 🔴 NotificationConfigStore is never-throws, so a read cancelled by shutdown comes back as an
            // EMPTY list rather than as an exception. Without this check that is indistinguishable from
            // "no webhook is configured", and the notification would vanish with no counter moving — the
            // exact silent-loss shape C-1's review found twice.
            ct.ThrowIfCancellationRequested();

            var instances = new List<(string Instance, bool HasSigningSecret)>();
            foreach (var summary in configured)
            {
                if (summary.Channel != NotificationChannel.Webhook) continue;

                // A cheap first pass over the credential-free summary, so an instance that is disabled or
                // below threshold never causes its DPAPI secrets to be decrypted at all. The AUTHORITATIVE
                // decision is re-taken on the full configuration in DeliverAsync (see there).
                if (!summary.Enabled ||
                    !NotificationDelivery.MeetsThreshold(job.Alarm.Priority, summary.MinPriority))
                {
                    Interlocked.Increment(ref _suppressed);
                    continue;
                }

                // 🔴 Review round 1 (I-1) — HasSigningSecret is carried forward from here because it is the
                // ONLY thing that can tell "no secret is configured" from "a secret is configured and its
                // blob will not decrypt". It is derived from the PRESENCE of a row, never from reading the
                // value, whereas GetSecretAsync returns null for both. See DeliverAsync.
                instances.Add((summary.Instance, summary.Webhook?.HasSigningSecret == true));
            }

            if (instances.Count == 0) return;

            fannedOut = true;
            await Task.WhenAll(instances.Select(target =>
                    DeliverAndCountAsync(target.Instance, target.HasSigningSecret, job, ct)))
                .ConfigureAwait(false);
        }
        catch (OperationCanceledException) when (ct.IsCancellationRequested)
        {
            // Counted here ONLY if no per-instance delivery had started; once fan-out begins each abandoned
            // delivery counts itself in DeliverAndCountAsync, and counting again would double-report.
            // Re-thrown either way: C-1's drain loop counts a shutdown-abandoned job as a drop, and
            // swallowing it here would make a truncated drain invisible.
            if (!fannedOut) Interlocked.Increment(ref _cancelled);
            throw;
        }
        catch (Exception ex)
        {
            // Defensive: nothing above should be able to throw anything else (ListAsync is never-throws).
            // Counted rather than merely logged, for the reason AlarmNotifier's own catch-all is — a log
            // saying an alarm was lost, next to a counter reading zero, says the opposite of the log.
            Interlocked.Increment(ref _lost);
            ReportError(ex, "Alarm webhook: resolving the configured destinations faulted — this " +
                            $"notification ({job.Edge} '{job.Alarm.Key}') was NOT sent to anybody.");
        }
    }

    /// <summary>🔴 The accounting choke point: exactly one counter moves per (notification, instance)
    /// pair, and every path through <see cref="DeliverAsync"/> ends at this switch.</summary>
    private async Task DeliverAndCountAsync(
        string instance, bool hasSigningSecret, NotificationJob job, CancellationToken ct)
    {
        DeliveryOutcome outcome;
        try
        {
            outcome = await DeliverAsync(instance, hasSigningSecret, job, ct).ConfigureAwait(false);
        }
        catch (OperationCanceledException) when (ct.IsCancellationRequested)
        {
            Interlocked.Increment(ref _cancelled);
            throw;
        }
        catch (Exception ex)
        {
            // DeliverAsync reports and absorbs its own failures; reaching here means something structural
            // went wrong, so it gets its own distinct wording rather than being folded into a delivery
            // failure an operator would then go looking for on the network.
            outcome = DeliveryOutcome.Lost;
            ReportError(ex, $"Alarm webhook {instance}: the channel itself faulted — this notification " +
                            $"({job.Edge} '{job.Alarm.Key}') was NOT delivered.");
        }

        switch (outcome)
        {
            case DeliveryOutcome.Suppressed: Interlocked.Increment(ref _suppressed); break;
            case DeliveryOutcome.Delivered: Interlocked.Increment(ref _delivered); break;
            default: Interlocked.Increment(ref _lost); break;
        }
    }

    /// <summary>Resolves one instance's configuration and credentials, then posts. Never throws except on
    /// a genuine shutdown.
    ///
    /// <para>🔴 <b>Every read of <see cref="NotificationConfigStore"/> in this method is followed
    /// immediately by <c>ct.ThrowIfCancellationRequested()</c></b> — for the secret reads, structurally, via
    /// <see cref="ReadSecretAsync"/>. That store is never-throws, so a read cancelled by shutdown returns
    /// "nothing is stored" rather than an exception; without the guard, a shutdown landing in that window
    /// is reported to the operator as a MISSING CREDENTIAL, counted as <c>Lost</c> instead of
    /// <c>Cancelled</c>, and — because the <see cref="OperationCanceledException"/> never propagates —
    /// counted by C-1's drain loop as <b>Dispatched, i.e. delivered</b>. Review round 1 (I-2) found exactly
    /// that on the auth-token read.</para></summary>
    /// <param name="hasSigningSecret">Whether a signing secret ROW exists for this instance, from the
    /// credential-free summary. See the I-1 comment below: this is the only way to distinguish "unsigned by
    /// configuration" from "unsigned because the key would not decrypt".</param>
    private async Task<DeliveryOutcome> DeliverAsync(
        string instance, bool hasSigningSecret, NotificationJob job, CancellationToken ct)
    {
        var config = await _store.GetWebhookAsync(instance, ct).ConfigureAwait(false);
        ct.ThrowIfCancellationRequested();

        if (config is null)
        {
            // 🔴 Review round 1 (M-1) — this used to be Suppressed, and that was the wrong bucket.
            // GetWebhookAsync returns null for TWO different things: the instance was deleted between the
            // list read above and this one, and the read FAILED (never-throws, so a fault reads as
            // "unconfigured"). Only the first is "the operator's configuration working", which is what
            // Suppressed is documented to mean; the second is a real lost notification. They cannot be told
            // apart here, so this follows the rule the rest of this class follows — over-reporting a loss
            // is strictly safer than under-reporting one — and says both possibilities out loud rather than
            // picking one. The deletion race needs a DELETE to land between two reads inside one dispatch;
            // a store fault does not.
            ReportWarning($"Alarm webhook '{instance}' could not be read back after it was listed as " +
                          "configured — it was either deleted in the last instant, or its configuration " +
                          $"store could not be read. The notification {job.Edge} '{job.Alarm.Key}' was NOT " +
                          "sent to it.");
            return DeliveryOutcome.Lost;
        }

        // 🔴 The authoritative gate, taken on the full configuration through the one shared helper
        // (NotificationDelivery.Delivers) rather than re-derived here — AlarmPriority is declared
        // most-severe-FIRST, and C-2 put that comparison in one place precisely so four channels cannot
        // each get the inversion wrong. Re-taking it also closes the window in which an operator disabled
        // the channel between the summary read above and now.
        if (!config.Delivers(job.Alarm.Priority)) return DeliveryOutcome.Suppressed;

        var identity = new WebhookIdentity(instance, config.Endpoint, config.UrlFingerprint, config.Label);

        if (config.Url is null || !Uri.TryCreate(config.Url, UriKind.Absolute, out var url) ||
            (url.Scheme != Uri.UriSchemeHttp && url.Scheme != Uri.UriSchemeHttps))
        {
            // A configured, enabled channel with no usable destination — C-2's GetWebhookAsync reports a
            // missing or unreadable DPAPI blob as a null URL rather than pretending the channel is healthy.
            // This IS a loss and must read as one.
            ReportWarning($"Alarm webhook {identity} is enabled but its stored destination could not be " +
                          "read (the encrypted URL is missing, or cannot be decrypted on this machine). " +
                          $"The notification {job.Edge} '{job.Alarm.Key}' was NOT sent. Re-save the webhook " +
                          "URL to repair it.");
            return DeliveryOutcome.Lost;
        }

        var signingSecret = await ReadSecretAsync(
            NotificationSecretNames.WebhookSigningSecret, instance, ct).ConfigureAwait(false);

        if (hasSigningSecret && string.IsNullOrEmpty(signingSecret))
        {
            // 🔴 Review round 1 (I-1) — the case that used to SILENTLY DOWNGRADE to an unsigned POST.
            //
            // GetSecretAsync is never-throws and returns null for both "no secret stored" and "the DPAPI
            // blob would not decrypt" — which is exactly what a notifications.db copied from another
            // machine looks like. Signing with a null key is not an error in WebhookSigner; it means
            // "send unsigned". So the machine quietly stopped proving its identity, delivered anyway,
            // counted a success, warned nobody, and the config API went on reporting HasSigningSecret =
            // true. Against a signature-enforcing receiver every alarm then 401s; against a permissive one
            // this ships unauthenticated alarm traffic indefinitely.
            //
            // The row's PRESENCE (hasSigningSecret, from the credential-free summary) is what separates the
            // two, and this is now the exact inverse of nothing: it mirrors the unreadable-URL case above,
            // for the same reason — a channel that cannot do what it is configured to do must not look
            // healthy.
            //
            // Narrow accepted window: an operator deleting the signing secret between the list read and
            // this one gets one spurious Lost, then healthy unsigned delivery from the next notification
            // onwards. Erring toward Lost is this class's stated rule.
            ReportWarning($"Alarm webhook {identity} has a signing secret stored, but it could not be read " +
                          "(the encrypted key is unreadable on this machine — typically a notifications.db " +
                          "copied from another host). Sending UNSIGNED would silently stop this machine " +
                          $"proving its identity, so the notification {job.Edge} '{job.Alarm.Key}' was NOT " +
                          "sent. Re-save the signing secret to repair it, or remove it to send unsigned " +
                          "deliberately.");
            return DeliveryOutcome.Lost;
        }

        string? authToken = null;
        var authHeaderName = config.AuthHeaderName;
        if (!string.IsNullOrWhiteSpace(authHeaderName))
        {
            authToken = await ReadSecretAsync(
                NotificationSecretNames.WebhookAuthToken, instance, ct).ConfigureAwait(false);

            if (!WebhookAuthHeader.IsValidValue(authToken))
            {
                // Posting anyway would present an unauthenticated request to a receiver that requires one —
                // a 401 that looks like the operator's token is WRONG when in fact it is MISSING. Fail here,
                // name the header, never echo the value.
                ReportWarning($"Alarm webhook {identity} is configured to authenticate with the " +
                              $"'{authHeaderName}' header, but no usable token is stored for it. The " +
                              $"notification {job.Edge} '{job.Alarm.Key}' was NOT sent. Store the token " +
                              $"under the '{NotificationSecretNames.WebhookAuthToken}' secret.");
                return DeliveryOutcome.Lost;
            }
        }

        ct.ThrowIfCancellationRequested();

        return await SendWithRetriesAsync(
            url, identity, job, instance, signingSecret, authHeaderName, authToken, ct).ConfigureAwait(false);
    }

    /// <summary>
    /// 🔴 Review round 1 (I-2) — the ONE way this class reads a secret, and the reason it is a method
    /// rather than two call sites.
    ///
    /// <para><see cref="NotificationConfigStore.GetSecretAsync"/> is never-throws: a read cancelled by
    /// shutdown comes back as <see langword="null"/>, indistinguishable from "no secret is stored". Both
    /// callers act on that null by reporting a MISSING CREDENTIAL and returning <c>Lost</c> — so a shutdown
    /// landing in that window told the operator their token was missing when it was not, moved the wrong
    /// counter, and, because the <see cref="OperationCanceledException"/> never propagated, was recorded by
    /// C-1's drain loop as a successful dispatch. The guard used to live after both reads, where an early
    /// <c>return</c> could step around it — and did. Putting it here makes "a cancelled secret read is a
    /// cancellation, not a missing secret" true by construction, including for whatever secret C-7 or a
    /// later channel adds.</para>
    /// </summary>
    private async Task<string?> ReadSecretAsync(string name, string instance, CancellationToken ct)
    {
        var secret = await _store
            .GetSecretAsync(NotificationChannel.Webhook, name, instance, ct)
            .ConfigureAwait(false);

        ct.ThrowIfCancellationRequested();
        return secret;
    }

    // ─────────────────────────────────────────────────────────────────────
    // The send, with a bounded retry budget.
    // ─────────────────────────────────────────────────────────────────────

    private async Task<DeliveryOutcome> SendWithRetriesAsync(
        Uri url, WebhookIdentity identity, NotificationJob job, string instance,
        string? signingSecret, string? authHeaderName, string? authToken, CancellationToken ct)
    {
        // 🔴 STABLE for every attempt of this delivery. A retry after a timeout can genuinely duplicate a
        // POST the receiver already processed, so this idempotency key is what makes retrying safe for them
        // — see WebhookPayload.DeliveryId. A fresh id per attempt would turn this retry policy into a
        // duplicate generator.
        var deliveryId = Guid.NewGuid().ToString("N");

        using var budget = CancellationTokenSource.CreateLinkedTokenSource(ct);
        budget.CancelAfter(_totalBudget);
        var elapsed = Stopwatch.StartNew();

        string? failure = null;
        Exception? cause = null;
        TimeSpan? retryAfter = null;
        var attemptsMade = 0;

        for (var attempt = 1; attempt <= _maxAttempts; attempt++)
        {
            // 🔴 Cancellation beats the budget, every time — the coordinator's ruling, and the reason C-1's
            // unbounded post-timeout `await _drainLoop` cannot hang the host on this channel's account.
            ct.ThrowIfCancellationRequested();

            attemptsMade = attempt;
            retryAfter = null;
            AttemptVerdict verdict;

            using (var attemptCts = CancellationTokenSource.CreateLinkedTokenSource(budget.Token))
            {
                attemptCts.CancelAfter(_attemptTimeout);
                try
                {
                    var now = _clock();
                    var payload = WebhookPayload.From(job, _sourceHost, instance, deliveryId, now);
                    var body = payload.ToUtf8Bytes();
                    var unixSeconds = now.ToUnixTimeSeconds();
                    var signature = WebhookSigner.Sign(body, unixSeconds, signingSecret);

                    using var request = BuildRequest(
                        url, body, signature, unixSeconds, deliveryId, job.Edge,
                        authHeaderName, authToken, out var headerProblem);

                    if (headerProblem is not null)
                    {
                        ReportWarning($"Alarm webhook {identity}: {headerProblem} The notification " +
                                      $"{job.Edge} '{job.Alarm.Key}' was NOT sent.");
                        return DeliveryOutcome.Lost;
                    }

                    Interlocked.Increment(ref _attempts);
                    if (attempt > 1) Interlocked.Increment(ref _retries);
                    if (signature is null) Interlocked.Increment(ref _unsigned);

                    using var response = await _http
                        .SendAsync(request, HttpCompletionOption.ResponseHeadersRead, attemptCts.Token)
                        .ConfigureAwait(false);

                    if (response.IsSuccessStatusCode) return DeliveryOutcome.Delivered;

                    var status = (int)response.StatusCode;
                    if (!RetryableStatuses.Contains(status))
                    {
                        // 🔴 "Stop, you are wrong." Retrying would send identical bytes to an endpoint that
                        // has already made a considered decision about them, at the cost of drain-loop time
                        // every other notification is waiting on.
                        ReportWarning(
                            $"Alarm webhook {identity} was REJECTED with HTTP {status} " +
                            $"({SafeReason(response.ReasonPhrase)}) — a permanent rejection, so it was not " +
                            "retried. " +
                            $"The notification {job.Edge} '{job.Alarm.Key}' is lost." + PermanentHint(status));
                        return DeliveryOutcome.Lost;
                    }

                    failure = $"HTTP {status} ({SafeReason(response.ReasonPhrase)})";
                    cause = null;
                    retryAfter = ReadRetryAfter(response, _clock());
                    verdict = AttemptVerdict.Retryable;
                }
                catch (OperationCanceledException) when (ct.IsCancellationRequested)
                {
                    throw; // Shutdown. Counted by DeliverAndCountAsync; C-1 counts the job as a drop.
                }
                catch (OperationCanceledException) when (budget.IsCancellationRequested)
                {
                    failure = BudgetElapsed();
                    cause = null;
                    verdict = AttemptVerdict.BudgetExhausted;
                }
                catch (OperationCanceledException)
                {
                    // The per-attempt timeout and ONLY that: HttpClient's own timeout is disabled, and a
                    // shutdown was excluded above. A slow receiver is exactly the transport failure worth
                    // trying again.
                    failure = $"the {_attemptTimeout.TotalSeconds:0.#}s attempt timeout elapsed";
                    cause = null;
                    verdict = AttemptVerdict.Retryable;
                }
                catch (HttpRequestException ex)
                {
                    // Refused, DNS, TLS, reset — the transport never got an answer, so the receiver may
                    // never have seen the request at all.
                    failure = "the connection failed";
                    cause = ex;
                    verdict = AttemptVerdict.Retryable;
                }
                catch (Exception ex)
                {
                    // Anything else is permanent: the same inputs would produce the same failure.
                    ReportError(ex, $"Alarm webhook {identity}: the request could not be sent. The " +
                                    $"notification {job.Edge} '{job.Alarm.Key}' is lost.");
                    return DeliveryOutcome.Lost;
                }
            }

            if (verdict != AttemptVerdict.Retryable || attempt == _maxAttempts) break;

            var delay = NextDelay(attempt, retryAfter, elapsed.Elapsed, out var retryAfterOverran);
            if (retryAfterOverran)
            {
                ReportWarning(
                    $"Alarm webhook {identity} asked to be retried after longer than the " +
                    $"{_totalBudget.TotalSeconds:0.#}s delivery budget allows ({failure}). Abandoned " +
                    "rather than holding the alarm notification drain loop open for it; the notification " +
                    $"{job.Edge} '{job.Alarm.Key}' is lost.");
                return DeliveryOutcome.Lost;
            }

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
            $"Alarm webhook {identity} FAILED after {attemptsMade} attempt(s) — " +
            $"{failure ?? "no attempt completed"}. The notification {job.Edge} '{job.Alarm.Key}' is LOST: " +
            "this build has no delivery queue behind the webhook, and the alarm's edge will not be " +
            "re-emitted.";

        if (cause is not null) ReportError(cause, summary);
        else ReportWarning(summary);

        return DeliveryOutcome.Lost;
    }

    private string BudgetElapsed() => $"the {_totalBudget.TotalSeconds:0.#}s delivery budget elapsed";

    /// <summary>
    /// 🔴 Review round 1 (M-2) — the reason phrase is the ONE piece of receiver-controlled text this class
    /// puts in a log line, so it is bounded before it gets there.
    ///
    /// <para>It cannot carry a CR or LF (neither survives HTTP/1.1 status-line framing, and HTTP/2 has no
    /// reason phrase at all), so this is not log injection — it is an untrusted party choosing how much of
    /// an operator's log file to occupy, once per failed attempt. Eighty characters is more than any real
    /// phrase ("Service Unavailable" is nineteen) and is a bound rather than a judgement about what a
    /// receiver ought to send.</para>
    /// </summary>
    private const int MaxReasonPhraseLength = 80;

    private static string SafeReason(string? reasonPhrase)
    {
        if (string.IsNullOrEmpty(reasonPhrase)) return "no reason phrase";
        return reasonPhrase.Length <= MaxReasonPhraseLength
            ? reasonPhrase
            : reasonPhrase[..MaxReasonPhraseLength] + "…";
    }

    /// <summary>Extra guidance for the permanent statuses whose cause an operator can actually act on —
    /// the difference between "the webhook is broken" and a support call.</summary>
    private static string PermanentHint(int status) => status switch
    {
        401 or 403 => " Check the authentication header and token stored for this webhook.",
        404 or 410 => " A 404/410 from Slack or Teams means the incoming webhook was DELETED — re-create " +
                      "it and save the new URL.",
        >= 300 and < 400 => " Redirects are deliberately not followed, because that would send the " +
                            "signature and any auth token to a host you did not configure. Store the " +
                            "final URL instead.",
        400 or 422 => " The receiver rejected the payload itself; see the webhook payload contract.",
        _ => "",
    };

    /// <summary>
    /// How long to wait before the next attempt, or <see langword="null"/> if there is no room left in the
    /// budget for one.
    /// </summary>
    /// <param name="retryAfterOverran">Set when the receiver asked, via <c>Retry-After</c>, for longer than
    /// the remaining budget. 🔴 Honouring such a request literally would park C-1's single-reader drain
    /// loop for as long as the receiver felt like — a 429 with <c>Retry-After: 300</c> from a rate-limited
    /// Slack would stall every other alarm notification for five minutes. The request is honoured up to the
    /// budget and abandoned beyond it, which is the only reading that respects both the receiver and the
    /// loop.</param>
    private TimeSpan? NextDelay(
        int attempt, TimeSpan? retryAfter, TimeSpan elapsed, out bool retryAfterOverran)
    {
        retryAfterOverran = false;

        var backoff = TimeSpan.FromMilliseconds(_baseBackoff.TotalMilliseconds * Math.Pow(2, attempt - 1));
        var delay = retryAfter is { } wanted && wanted > backoff ? wanted : backoff;

        var remaining = _totalBudget - elapsed;
        if (delay >= remaining)
        {
            // Distinguish "the receiver asked for more than we have" from "we simply ran out": the first is
            // a message an operator can act on, the second is just the budget doing its job.
            retryAfterOverran = retryAfter is { } asked && asked >= remaining;
            return null;
        }

        return delay;
    }

    private static TimeSpan? ReadRetryAfter(HttpResponseMessage response, DateTimeOffset now)
    {
        var header = response.Headers.RetryAfter;
        if (header is null) return null;
        if (header.Delta is { } delta) return delta < TimeSpan.Zero ? TimeSpan.Zero : delta;
        if (header.Date is { } date)
        {
            var span = date - now;
            return span < TimeSpan.Zero ? TimeSpan.Zero : span;
        }
        return null;
    }

    /// <param name="headerProblem">Non-null when a header could not be attached — the only way this can
    /// happen is a stored auth header the HTTP stack refuses, which is a configuration fault to be reported
    /// and counted, not an exception to be thrown out of a never-throws channel. Names the header, never
    /// the value.</param>
    private static HttpRequestMessage BuildRequest(
        Uri url, byte[] body, string? signature, long unixSeconds, string deliveryId,
        AlarmEdgeKind edge, string? authHeaderName, string? authToken, out string? headerProblem)
    {
        headerProblem = null;

        var request = new HttpRequestMessage(HttpMethod.Post, url)
        {
            Content = new ByteArrayContent(body),
        };

        // The exact bytes signed above are the exact bytes sent — ByteArrayContent re-encodes nothing,
        // which is what makes the receiver's "hash the raw body" step work.
        request.Content.Headers.ContentType = new MediaTypeHeaderValue("application/json")
        {
            CharSet = "utf-8",
        };

        request.Headers.TryAddWithoutValidation(WebhookContract.DeliveryHeader, deliveryId);
        request.Headers.TryAddWithoutValidation(WebhookContract.EventHeader, edge.ToString());

        if (signature is not null)
        {
            // Both, or neither — see WebhookSigner: a receiver must not be able to be fooled by a blank
            // signature header, and a timestamp with nothing binding it to the body protects nothing.
            request.Headers.TryAddWithoutValidation(WebhookContract.SignatureHeader, signature);
            request.Headers.TryAddWithoutValidation(
                WebhookContract.TimestampHeader, unixSeconds.ToString(CultureInfo.InvariantCulture));
        }

        if (!string.IsNullOrWhiteSpace(authHeaderName) && authToken is not null &&
            !request.Headers.TryAddWithoutValidation(authHeaderName, authToken))
        {
            headerProblem =
                $"the configured authentication header '{authHeaderName}' was refused by the HTTP stack, " +
                "so the request would have been sent unauthenticated.";
        }

        return request;
    }

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

    public void Dispose() => _http.Dispose();
}
