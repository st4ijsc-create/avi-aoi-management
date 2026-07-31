using System.Globalization;
using System.Text.RegularExpressions;
using Microsoft.Extensions.DependencyInjection;
using St4i.EngineApi.Alarms;
using St4i.EngineApi.Auth;
using St4i.EngineApi.Fleet;

namespace St4i.EngineApi.Endpoints;

/// <summary>
/// 🔴 Task C-7 (.superpowers/sdd/2026-07-30-dotC-alarm-notification-blueprint/task-7-brief.md) — <b>the four
/// alarm notification channels C-3..C-6 built, given endpoints.</b> Until this file existed, every one of
/// them could only be configured by hand-editing a SQLite database on the machine.
///
/// <h3>🔴🔴 The relay routes are ADMIN, and every other route here is not</h3>
/// <para><see cref="St4i.EngineApi.Policy.MachineWriteGate.RoleFor"/> returns <see cref="Roles.Admin"/> for
/// a <see cref="RelayTargetKind.Command"/> target, and <see cref="RelayNotificationChannel"/> presents it.
/// So <b>saving a relay row with <c>targetKind = Command</c> makes this product perform, automatically and
/// for as long as that row exists, an action a human needs Admin for</b>. Every other config-mutation
/// endpoint in this repository is Engineer-tier; following that precedent here would have handed an Engineer
/// Admin-tier command authority through a config row. C-6's review found this (I-2) and recorded it on
/// <c>MachineWriteGate.RoleFor</c> and on <see cref="NotificationConfigStore.SaveRelayAsync"/>.</para>
///
/// <para><b>The whole relay ROUTE is Admin, not just its <c>Command</c> case, and that is deliberate.</b>
/// Gating on the request BODY would put the privilege boundary inside a handler — one <c>if</c>, evaluated
/// after model binding, invisible to <c>RbacPolicyTests</c>' metadata sweep (which reads endpoint metadata,
/// the only thing in the suite that can see a missing <c>.RequireAuthorization</c> at all), and one editing
/// mistake away from being bypassable. As separate routes the boundary is ROUTING: an Engineer's request for
/// <c>PUT /v1/notifications/relay</c> is rejected by the authorization middleware before any handler runs,
/// before the body is read, and the sweep asserts the policy in both directions. Over-restricting a
/// configuration route costs an Engineer an escalation to an Admin for the one channel that drives hardware;
/// under-restricting it is a privilege escalation. <b>Lowering <c>RoleFor</c> instead is NOT the alternative
/// fix</b> — it would make <c>RoleObligationRule</c> deny every command relay permanently, so the store would
/// accept a configuration the channel could never honour, which is the identical fault C-2 refused an
/// implicit-TLS enum member over.</para>
///
/// <para>DELETE is Admin for the same route for a smaller reason: an Engineer who could delete the relay row
/// could silently un-configure the plant's beacon and could not put it back, since the save is Admin. A
/// mutation whose inverse needs a higher role is not really a lower-privilege mutation.</para>
///
/// <h3>🔴 No secret can travel outward through this file</h3>
/// <para><b>Structurally, not by review.</b> No handler here calls
/// <see cref="NotificationConfigStore.GetSecretAsync"/> or any of the engine-internal
/// <c>Get*Async</c> full reads — the only store read any handler performs is
/// <see cref="NotificationConfigStore.ListAsync"/>, which C-2 built as the one credential-free projection
/// and whose SQL cannot name an encrypted column. Secrets travel INWARD only: a plaintext value arrives in a
/// request body, is handed straight to <see cref="NotificationConfigStore.SetSecretAsync"/> (which encrypts
/// it), and is never read back, never echoed in a response, and never placed in an audit row — the audit
/// records only WHETHER a credential changed. The send test needs credentials, and that is exactly why it
/// lives inside the channels (<see cref="WebhookNotificationChannel.SendTestAsync"/>,
/// <see cref="SmtpNotificationChannel.SendTestAsync"/>): what crosses back into this file is a
/// <see cref="NotificationTestOutcome"/> of prose.</para>
///
/// <para>🔴 <b>The webhook PUT therefore requires its URL every time</b>, and that is the price of the
/// paragraph above rather than an oversight. Letting a save omit the URL and keep the stored one would mean
/// this file reading the decrypted capability back out of the store to write it in again — creating exactly
/// the second path to a plaintext credential that C-3 and C-4 were each told not to create, and putting it
/// in an HTTP handler, one edit away from a response body. PUT means full replacement here; a webhook's
/// non-secret facts (<c>endpoint</c>, <c>urlFingerprint</c>, <c>label</c>) are what let an operator confirm
/// they are re-entering the same destination.</para>
///
/// <h3>Rate limiting — see <see cref="NotificationTestRateLimiter"/></h3>
/// <para>Exactly one route is limited, and the reasoning for the ones that are not is written on that class.
/// This is the first rate limiter in this product; Đợt B's review named the absence as its top carried
/// item.</para>
/// </summary>
public static class NotificationEndpoints
{
    /// <summary>
    /// The channel-instance key an operator may address. Bounded and restricted because it becomes a primary
    /// key in <c>notification_channels</c>: an unvalidated instance is an unbounded caller-supplied key
    /// space, and this store has no per-caller quota. <c>NotificationConfigStore</c> itself only rejects
    /// blank, deliberately (it is engine-internal); the boundary is here.
    /// </summary>
    private static readonly Regex InstancePattern =
        new("^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$", RegexOptions.Compiled | RegexOptions.CultureInvariant);

    /// <summary>
    /// 🔴 How many configured instances one channel may have.
    ///
    /// <para><b>Review round 1 (I-2) — without this, the send-test rate limiter's stated goal is defeated
    /// through the routes it deliberately does not limit.</b> <see cref="InstancePattern"/> validates a
    /// key's SHAPE and said nothing about how many exist, and <see cref="NotificationConfigStore"/> has no
    /// quota of its own (its doc comment says so). Meanwhile
    /// <see cref="WebhookNotificationChannel.DispatchAsync"/> fans out to EVERY configured, enabled instance
    /// concurrently. So the same authenticated Engineer the limiter is written against could create N
    /// webhook instances pointing at one third party and turn every alarm edge — and every
    /// <see cref="AlarmEdgeKind.Restored"/> at every restart — into N outbound messages, through a path with
    /// no limiter in front of it at all. The 5 s bucket bounds the BUTTON; this bounds the FAN-OUT.</para>
    ///
    /// <para>🔴 It also corrects an argument I made and got wrong: the configuration writes were left
    /// unlimited partly on the grounds that they are "idempotent". That is true PER INSTANCE KEY and false
    /// ACROSS them — re-saving <c>default</c> a thousand times changes nothing, while saving a thousand
    /// DISTINCT keys creates a thousand destinations. Idempotence was never the property that made the key
    /// space safe; a bound is.</para>
    ///
    /// <para><b>Eight, argued.</b> The blueprint's own target list is Slack, Teams, MES and Zabbix — four —
    /// and this build writes exactly one (<see cref="NotificationConfigStore.DefaultInstance"/>). Eight is
    /// double the largest configuration anyone has described, and it bounds the worst case an alarm edge can
    /// cost at eight concurrent sends per channel rather than at whatever a script felt like creating.
    /// Deliberately enforced at the ENDPOINT rather than in the store: the store is engine-internal and its
    /// existing callers (C-3..C-6) only ever read, so this is a boundary rule about untrusted input, in the
    /// same place <see cref="InstancePattern"/> is.</para>
    /// </summary>
    public const int MaxInstancesPerChannel = 8;

    public static void MapNotificationEndpoints(this IEndpointRouteBuilder app)
    {
        // ── Reads. Engineer, not Operator: these carry the whole notification CONFIGURATION — SMTP
        // usernames, every alarm recipient's e-mail address, webhook endpoints, and the machine and point a
        // relay is allowed to energise. None of it is a credential (C-2's projection makes that structural),
        // and none of it is secret, but it is the same tier of material as GET /v1/settings, which is
        // Engineer for the same reason. The Operator-tier notification surface already exists and is
        // deliberately narrower: GET /v1/alarms/annunciations' `ready` frame tells a screen whether it will
        // be annunciated, which is the only part of this an operator needs.
        app.MapGet("/v1/notifications/channels", ListChannelsAsync)
            .RequireAuthorization(Policies.Engineer);
        app.MapGet("/v1/notifications/status", GetStatusAsync)
            .RequireAuthorization(Policies.Engineer);

        // ── Writes. One route per channel rather than one parameterised route, so each carries its own
        // policy in its own endpoint metadata. See the class doc comment: this is what makes the relay's
        // Admin gate a routing fact the RBAC sweep can assert, rather than an `if` inside a handler.
        app.MapPut("/v1/notifications/webhook", SaveWebhookAsync)
            .RequireAuthorization(Policies.Engineer);
        app.MapDelete("/v1/notifications/webhook", DeleteWebhookAsync)
            .RequireAuthorization(Policies.Engineer);

        app.MapPut("/v1/notifications/smtp", SaveSmtpAsync)
            .RequireAuthorization(Policies.Engineer);
        app.MapDelete("/v1/notifications/smtp", DeleteSmtpAsync)
            .RequireAuthorization(Policies.Engineer);

        app.MapPut("/v1/notifications/local-annunciation", SaveLocalAnnunciationAsync)
            .RequireAuthorization(Policies.Engineer);
        app.MapDelete("/v1/notifications/local-annunciation", DeleteLocalAnnunciationAsync)
            .RequireAuthorization(Policies.Engineer);

        // 🔴🔴 ADMIN. See the class doc comment — this is the privilege-escalation close.
        app.MapPut("/v1/notifications/relay", SaveRelayAsync)
            .RequireAuthorization(Policies.Admin);
        app.MapDelete("/v1/notifications/relay", DeleteRelayAsync)
            .RequireAuthorization(Policies.Admin);

        // ── The send test. Engineer: it reaches a third party but changes nothing here.
        app.MapPost("/v1/notifications/test", SendTestAsync)
            .RequireAuthorization(Policies.Engineer);
    }

    // ─────────────────────────────────────────────────────────────────────
    // GET /v1/notifications/channels
    // ─────────────────────────────────────────────────────────────────────

    /// <summary>
    /// Every configured channel, credential-free, plus the configuration store's own health.
    ///
    /// <para>🔴 The health block is beside the list rather than on a separate route because of what an empty
    /// list means: <see cref="NotificationConfigStore.ListAsync"/> is never-throws, so a read that FAILED
    /// returns exactly what "nothing is configured" returns. Two facts that are indistinguishable in one
    /// field must be shown together or the reader will pick the wrong one.</para>
    /// </summary>
    internal static async Task<IResult> ListChannelsAsync(HttpContext context, CancellationToken ct)
    {
        // 🔴 Resolved with GetService rather than taken as a handler parameter, and that is not a style
        // choice. Program.cs registers this store ONLY when it could be opened, so the type may not be in
        // the container at all — a handler parameter would then fail to BIND (minimal APIs treat an
        // unregistered type as a body parameter), and the operator would get a binding error where the
        // honest answer below exists. Same idiom, and the same reason, as AlarmAnnunciationStreamEndpoint.
        var store = context.RequestServices.GetService<NotificationConfigStore>();
        if (store is null)
        {
            return Results.Ok(new NotificationChannelsDto(
                Array.Empty<NotificationChannelSummary>(), UnavailableStore()));
        }

        var channels = await store.ListAsync(ct).ConfigureAwait(false);
        return Results.Ok(new NotificationChannelsDto(channels, Health(store)));
    }

    // ─────────────────────────────────────────────────────────────────────
    // GET /v1/notifications/status
    // ─────────────────────────────────────────────────────────────────────

    /// <summary>
    /// 🔴 Every channel's counters, routed somewhere for the first time — with the wordings four separate
    /// reviews in this batch established, because the short form of three of these counters says something
    /// false.
    /// </summary>
    internal static IResult GetStatusAsync(HttpContext context)
    {
        var services = context.RequestServices;
        var store = services.GetService<NotificationConfigStore>();
        var notifier = services.GetService<AlarmNotifier>();
        var webhook = services.GetService<WebhookNotificationChannel>();
        var smtp = services.GetService<SmtpNotificationChannel>();
        var local = services.GetService<LocalAnnunciationChannel>();
        var relay = services.GetService<RelayNotificationChannel>();
        var hub = services.GetService<AlarmAnnunciationHub>();

        var health = store is null ? UnavailableStore() : Health(store);
        var attention = new List<string>();

        if (!health.Available || health.ReadFailures > 0) attention.Add(health.Detail);

        var smtpDto = smtp is null ? null : BuildSmtpStatus(smtp.Stats);
        if (smtpDto?.PartialDelivery is { } partial) attention.Add(partial);

        // 🔴 Review round 1 (M-3) — keyed off the HUB alone, not off the hub AND the channel. Program.cs
        // registers the hub UNCONDITIONALLY and maps GET /v1/alarms/annunciations unconditionally, while the
        // channel exists only when the configuration store opened. Requiring both meant that on exactly the
        // degraded host this page exists for, the listener gauges and the refused-stream warning disappeared
        // while the 503 subscriber cap was live and refusing browsers — the reader would have seen nothing
        // at all about a stream that was actively turning pages away. The channel's own counters are
        // optional now, because they are the part that genuinely does not exist without a channel.
        var localDto = hub is null ? null : BuildLocalStatus(local?.Stats, hub);
        if (hub is not null && hub.Rejected > 0)
        {
            attention.Add(
                $"{hub.Rejected.ToString(CultureInfo.InvariantCulture)} browser session(s) were REFUSED an " +
                $"alarm-annunciation stream because all {hub.MaxListeners.ToString(CultureInfo.InvariantCulture)} " +
                "listener slots were in use. Those pages were not annunciated. They retry automatically.");
        }

        var relayDto = relay is null ? null : BuildRelayStatus(relay.Stats, relay.InstanceStates);
        if (relayDto is not null)
        {
            foreach (var instance in relayDto.Instances)
            {
                if (instance.Energised == true && instance.LatchedAlarms == 0)
                {
                    attention.Add(
                        $"Relay '{instance.Instance}': the annunciator is believed to be ON while no alarm " +
                        "is latched — this product asked for it to go out and the write did not succeed " +
                        "(most often the HALT latch refusing it). It is still lit.");
                }
            }
        }

        AddLossNotes(attention, webhook?.Stats, smtp?.Stats, local?.Stats, relay?.Stats, notifier?.Stats);

        return Results.Ok(new NotificationStatusDto(
            ConfigStore: health,
            Notifier: notifier?.Stats,
            Queues: notifier?.ChannelStats ?? Array.Empty<AlarmNotifierChannelStats>(),
            Webhook: webhook?.Stats,
            Smtp: smtpDto,
            LocalAnnunciation: localDto,
            Relay: relayDto,
            Attention: attention));
    }

    /// <summary>🔴 <see cref="SmtpChannelStats.PartiallyDelivered"/> is the ONLY signal in this product that
    /// one recipient has silently stopped receiving alarms, so it gets its own sentence and is hoisted into
    /// <see cref="NotificationStatusDto.Attention"/> rather than left as one number among eight.</summary>
    private static SmtpStatusDto BuildSmtpStatus(SmtpChannelStats stats) => new(
        stats,
        stats.PartiallyDelivered == 0
            ? null
            : $"{stats.PartiallyDelivered.ToString(CultureInfo.InvariantCulture)} alarm e-mail(s) were " +
              "accepted by the relay for SOME recipients and rejected for others. The people on the " +
              "rejected addresses are SILENTLY not receiving alarms: they were not told, nothing else in " +
              "this product will tell them, and this counter is the only place that failure is visible. " +
              "The rejected addresses are named in the host log. Correct or remove them.");

    private static LocalAnnunciationStatusDto BuildLocalStatus(
        LocalAnnunciationStats? stats, AlarmAnnunciationHub hub) => new(
        stats,
        Listeners: hub.ListenerCount,
        MaxListeners: hub.MaxListeners,
        RejectedListeners: hub.Rejected,
        HubPublished: hub.Published,
        HubFannedOut: hub.FannedOut,
        HubOverflowed: hub.Overflowed,
        // 🔴 C-5 review round 2 (M-9): this counter's meaning NARROWED when the connect-time replay landed,
        // and the obvious label for it is now false. Stated in full rather than abbreviated, because the
        // short form ("alarms nobody was told about") is exactly the wrong reading and it is the reading a
        // three-word label produces.
        UnheardMeaning:
        "Unheard counts edges for which NO browser session was attached at the instant the edge happened. " +
        "It is NOT \"alarms nobody was told about\": every alarm still standing when this engine started is " +
        "counted here (nothing can be attached that early) and is then replayed to the next page that " +
        "connects, because GET /v1/alarms/annunciations serves the currently-active set at connect time. " +
        "What remains permanently untold is only an edge whose alarm had already cleared before anyone " +
        "connected — a transient nobody saw.");

    private static RelayStatusDto BuildRelayStatus(
        RelayChannelStats stats, IReadOnlyList<RelayInstanceState> instances) => new(
        stats,
        instances.Select(i => new RelayInstanceStateDto(
            i.Instance, i.LatchedAlarms, i.Energised, i.LastAttemptUtc,
            DescribeAnnunciator(i))).ToList());

    /// <summary>
    /// 🔴 C-6's carried constraint, in one place: <see cref="RelayInstanceState.Energised"/> must never
    /// render as "off".
    ///
    /// <para>Three states, three different facts. <see langword="true"/> beside an empty latch set means
    /// <b>the product asked for the annunciator to go out and was refused</b> — the beacon is still lit and
    /// somebody needs to know. <see langword="null"/> means <b>this product does not know what the
    /// annunciator is doing</b> — a fresh process that has commanded nothing, or a write that came back
    /// <see cref="St4i.Connector.Abstractions.WriteOutcome.Indeterminate"/>, after which nobody knows whether
    /// the coil moved. Only <see langword="false"/> means off. Collapsing "unknown" into "off" is how a lit
    /// beacon becomes invisible on a screen.</para>
    /// </summary>
    internal static string DescribeAnnunciator(RelayInstanceState state) => state.Energised switch
    {
        true when state.LatchedAlarms == 0 =>
            "ON, and no alarm is latched — this product asked for it to go OUT and the write did not " +
            "succeed. The annunciator is still lit.",
        true =>
            "ON — this product commanded it on for " +
            state.LatchedAlarms.ToString(CultureInfo.InvariantCulture) + " latched alarm(s), and that write " +
            "was applied.",
        false =>
            "OFF — this product commanded it off and that write was applied.",
        null when state.LastAttemptUtc is null =>
            "UNKNOWN — nothing has been commanded in this process yet, so this product has no belief about " +
            "the annunciator. This is NOT the same as off.",
        _ =>
            "UNKNOWN — the last write to this annunciator returned INDETERMINATE, so nobody knows whether " +
            "the coil moved. This is NOT the same as off.",
    };

    /// <summary>Every "somebody was not told something that happened" counter, in one place, phrased as the
    /// loss it is. A channel's <c>Lost</c> is documented as exactly that in all four channels.</summary>
    private static void AddLossNotes(
        List<string> attention, WebhookChannelStats? webhook, SmtpChannelStats? smtp,
        LocalAnnunciationStats? local, RelayChannelStats? relay, AlarmNotifierStats? notifier)
    {
        void Loss(long count, string channel, string consequence)
        {
            if (count > 0)
            {
                attention.Add(
                    $"{channel}: {count.ToString(CultureInfo.InvariantCulture)} alarm notification(s) were " +
                    $"lost — {consequence} There is no delivery queue behind any channel in this build, so " +
                    "those edges will not be re-emitted.");
            }
        }

        Loss(webhook?.Lost ?? 0, "Webhook", "they reached nobody.");
        Loss(smtp?.Lost ?? 0, "E-mail", "they reached nobody.");
        Loss(local?.Lost ?? 0, "Local annunciation", "this channel itself failed (which is different from " +
                                                     "nobody having a screen open).");
        Loss(relay?.Lost ?? 0, "Relay", "the annunciator was not driven.");

        if (notifier is { Dropped: > 0 } dropped)
        {
            attention.Add(
                $"The alarm notification seam DROPPED {dropped.Dropped.ToString(CultureInfo.InvariantCulture)} " +
                "(job, channel) pair(s): a queue was full, or a drain was abandoned. A non-zero value seen " +
                "only during shutdown is expected; one that grows while this engine is running means a " +
                "channel is not keeping up — the per-channel queue depths above say which.");
        }
    }

    // ─────────────────────────────────────────────────────────────────────
    // PUT/DELETE /v1/notifications/webhook
    // ─────────────────────────────────────────────────────────────────────

    internal static async Task<IResult> SaveWebhookAsync(
        WebhookConfigRequest? body, HttpContext context, AuditRecorder recorder, CancellationToken ct)
    {
        // See ListChannelsAsync for why the store is resolved rather than bound as a parameter.
        var store = context.RequestServices.GetService<NotificationConfigStore>();
        if (body is null) return Bad("Request body is required.");
        if (store is null) return StoreUnavailable();
        if (!TryInstance(body.Instance, out var instance, out var instanceError)) return Bad(instanceError!);
        if (!TryPriority(body.MinPriority, out var minPriority, out var priorityError)) return Bad(priorityError!);

        if (string.IsNullOrWhiteSpace(body.Url))
        {
            // See the class doc comment: this endpoint deliberately cannot reuse a stored URL, because doing
            // so would mean decrypting a capability inside an HTTP handler.
            return Bad(
                "A webhook URL is required on every save. This endpoint replaces the whole webhook " +
                "configuration, and it deliberately cannot re-use the stored URL: reading an encrypted " +
                "destination back out of the store inside a request handler is the one path by which a " +
                "credential reaches a response body. Check `urlFingerprint` on the current configuration to " +
                "confirm you are entering the same destination.");
        }

        // 🔴 The carried C-2/C-3 item. NotificationConfigStore refuses a BLANK authHeaderName (null clears
        // it; "" is invalid) — and "" is exactly what a cleared form field sends. Normalising here, at the
        // boundary where an empty form field becomes a value, is the fix: the store's stricter contract is
        // correct for an engine-internal caller and stays as it is. Without this the operator's cleared
        // field failed the WHOLE save with an error about a field they had just emptied.
        var authHeaderName = Blank(body.AuthHeaderName);
        var label = Blank(body.Label);

        if (label is { Length: > NotificationConfigStore.MaxLabelLength })
        {
            return Bad($"A webhook label may be at most {NotificationConfigStore.MaxLabelLength} characters.");
        }

        if (authHeaderName is not null && !WebhookAuthHeader.IsValidName(authHeaderName, out var headerReason))
        {
            return Bad(headerReason);
        }

        if (!Uri.TryCreate(body.Url, UriKind.Absolute, out var parsed) ||
            (parsed.Scheme != Uri.UriSchemeHttp && parsed.Scheme != Uri.UriSchemeHttps))
        {
            // Deliberately does not echo the URL back — it may be a working capability with a typo'd scheme,
            // and a 400 body is as long-lived as a log line.
            return Bad("A webhook URL must be an absolute http:// or https:// URL.");
        }

        var (before, atCap) = await LoadForSaveAsync(store, NotificationChannel.Webhook, instance, ct)
            .ConfigureAwait(false);
        if (atCap is not null) return atCap;

        var saved = await store.SaveWebhookAsync(
                body.Enabled, minPriority, body.Url, label, authHeaderName, instance, ct)
            .ConfigureAwait(false);

        var signing = SecretOutcome.Unchanged;
        var token = SecretOutcome.Unchanged;
        if (saved)
        {
            signing = await ApplySecretAsync(
                store, NotificationChannel.Webhook, NotificationSecretNames.WebhookSigningSecret,
                body.SigningSecret, instance, ct).ConfigureAwait(false);

            if (authHeaderName is null)
            {
                // Clearing the header name removes the token with it. A token that names no header can never
                // be sent, and a credential retained for a purpose that no longer exists is a credential
                // nobody is auditing. A false here means there was no token row to remove, which is the
                // intent already satisfied — never a failure.
                token = await store.DeleteSecretAsync(
                    NotificationChannel.Webhook, NotificationSecretNames.WebhookAuthToken, instance, ct)
                    .ConfigureAwait(false)
                    ? SecretOutcome.Changed
                    : SecretOutcome.Unchanged;
            }
            else
            {
                token = await ApplySecretAsync(
                    store, NotificationChannel.Webhook, NotificationSecretNames.WebhookAuthToken,
                    body.AuthToken, instance, ct).ConfigureAwait(false);
            }
        }

        var after = saved
            ? await FindAsync(store, NotificationChannel.Webhook, instance, ct).ConfigureAwait(false)
            : before;

        // 🔴 The audit row carries the credential-free SUMMARY and the two credential OUTCOMES. Never the
        // URL, never the signing secret, never the token: an audit log is the longest-lived store in this
        // product. Review round 1 (I-1) — the outcomes are recorded by NAME rather than as booleans, so a
        // credential that FAILED to store is distinguishable in the log from one the request never carried.
        await recorder.RecordAsync(
            context, "notification.webhook.save", "notification", $"Webhook/{instance}",
            before,
            new
            {
                Saved = saved, Config = after,
                SigningSecret = signing.ToString(), AuthToken = token.ToString(),
            },
            ct).ConfigureAwait(false);

        if (!saved) return SaveFailed("webhook");
        // 🔴 Review round 1 (I-1). A committed channel row with a credential that did not commit is the one
        // state that must never answer 200: every channel reads a missing secret as "none is configured",
        // and for the webhook that means posting UNSIGNED from now on.
        if (signing == SecretOutcome.Failed) return SecretFailed("webhook", "signing secret");
        if (token == SecretOutcome.Failed) return SecretFailed("webhook", "authentication token");

        return Results.Ok(SaveResult(after, store));
    }

    internal static Task<IResult> DeleteWebhookAsync(
        string? instance, HttpContext context, AuditRecorder recorder, CancellationToken ct) =>
        DeleteChannelAsync(NotificationChannel.Webhook, instance, context, recorder, ct);

    // ─────────────────────────────────────────────────────────────────────
    // PUT/DELETE /v1/notifications/smtp
    // ─────────────────────────────────────────────────────────────────────

    internal static async Task<IResult> SaveSmtpAsync(
        SmtpConfigRequest? body, HttpContext context, AuditRecorder recorder, CancellationToken ct)
    {
        var store = context.RequestServices.GetService<NotificationConfigStore>();
        if (body is null) return Bad("Request body is required.");
        if (store is null) return StoreUnavailable();
        if (!TryInstance(body.Instance, out var instance, out var instanceError)) return Bad(instanceError!);
        if (!TryPriority(body.MinPriority, out var minPriority, out var priorityError)) return Bad(priorityError!);

        if (string.IsNullOrWhiteSpace(body.Host)) return Bad("An SMTP host is required.");
        if (body.Port is <= 0 or > 65535) return Bad("An SMTP port must be between 1 and 65535.");

        if (!Enum.TryParse<SmtpTlsMode>(body.Tls, ignoreCase: true, out var tls) || !Enum.IsDefined(tls))
        {
            return Bad(
                $"'{body.Tls}' is not a valid SMTP TLS mode. Valid values are " +
                $"{string.Join(", ", Enum.GetNames<SmtpTlsMode>())}. There is deliberately no implicit-TLS " +
                "(SMTPS, port 465) mode: the .NET mail client this product is built on implements only " +
                "STARTTLS and provably cannot honour one.");
        }

        if (string.IsNullOrWhiteSpace(body.FromAddress)) return Bad("A From address is required.");

        var recipients = (body.Recipients ?? Array.Empty<string>())
            .Where(r => !string.IsNullOrWhiteSpace(r))
            .Select(r => r.Trim())
            .ToList();
        if (recipients.Count == 0) return Bad("At least one recipient is required.");

        // Validated here rather than left to blow up at send time — a stored address the channel cannot
        // build a MailMessage from is a configuration that looks saved and can never deliver, which is
        // C-2's own ImplicitTls principle applied to an address.
        foreach (var address in recipients.Concat(new[] { body.FromAddress }))
        {
            try { _ = new System.Net.Mail.MailAddress(address); }
            catch (FormatException) { return Bad($"'{address}' is not a valid e-mail address."); }
            catch (ArgumentException) { return Bad($"'{address}' is not a valid e-mail address."); }
        }

        var username = Blank(body.Username);
        var (before, atCap) = await LoadForSaveAsync(store, NotificationChannel.Smtp, instance, ct)
            .ConfigureAwait(false);
        if (atCap is not null) return atCap;

        var saved = await store.SaveSmtpAsync(
                body.Enabled, minPriority, body.Host, body.Port, tls, body.FromAddress, recipients,
                username, instance, ct)
            .ConfigureAwait(false);

        var password = SecretOutcome.Unchanged;
        if (saved)
        {
            password = await ApplySecretAsync(
                store, NotificationChannel.Smtp, NotificationSecretNames.SmtpPassword,
                body.Password, instance, ct).ConfigureAwait(false);
        }

        var after = saved
            ? await FindAsync(store, NotificationChannel.Smtp, instance, ct).ConfigureAwait(false)
            : before;

        await recorder.RecordAsync(
            context, "notification.smtp.save", "notification", $"Smtp/{instance}",
            before, new { Saved = saved, Config = after, Password = password.ToString() },
            ct).ConfigureAwait(false);

        if (!saved) return SaveFailed("SMTP");
        // 🔴 Review round 1 (I-1). SMTP survived the old bug only by luck — a stored username with no
        // readable password lands in CredentialPlan.PasswordMissing and the channel refuses to send rather
        // than downgrading — but "saved by luck" is not a property, and an ANONYMOUS relay configuration
        // whose password silently failed to store would have sent anonymously with no complaint at all.
        if (password == SecretOutcome.Failed) return SecretFailed("SMTP", "password");

        return Results.Ok(SaveResult(after, store));
    }

    internal static Task<IResult> DeleteSmtpAsync(
        string? instance, HttpContext context, AuditRecorder recorder, CancellationToken ct) =>
        DeleteChannelAsync(NotificationChannel.Smtp, instance, context, recorder, ct);

    // ─────────────────────────────────────────────────────────────────────
    // PUT/DELETE /v1/notifications/local-annunciation
    // ─────────────────────────────────────────────────────────────────────

    internal static async Task<IResult> SaveLocalAnnunciationAsync(
        LocalAnnunciationConfigRequest? body, HttpContext context, AuditRecorder recorder,
        CancellationToken ct)
    {
        var store = context.RequestServices.GetService<NotificationConfigStore>();
        if (body is null) return Bad("Request body is required.");
        if (store is null) return StoreUnavailable();
        if (!TryInstance(body.Instance, out var instance, out var instanceError)) return Bad(instanceError!);
        if (!TryPriority(body.MinPriority, out var minPriority, out var priorityError)) return Bad(priorityError!);

        var (before, atCap) = await LoadForSaveAsync(store, NotificationChannel.LocalAnnunciation, instance, ct)
            .ConfigureAwait(false);
        if (atCap is not null) return atCap;

        var saved = await store
            .SaveLocalAnnunciationAsync(body.Enabled, minPriority, instance, ct)
            .ConfigureAwait(false);

        var after = saved
            ? await FindAsync(store, NotificationChannel.LocalAnnunciation, instance, ct).ConfigureAwait(false)
            : before;

        await recorder.RecordAsync(
            context, "notification.localannunciation.save", "notification", $"LocalAnnunciation/{instance}",
            before, new { Saved = saved, Config = after }, ct).ConfigureAwait(false);

        return saved ? Results.Ok(SaveResult(after, store)) : SaveFailed("local annunciation");
    }

    internal static Task<IResult> DeleteLocalAnnunciationAsync(
        string? instance, HttpContext context, AuditRecorder recorder, CancellationToken ct) =>
        DeleteChannelAsync(NotificationChannel.LocalAnnunciation, instance, context, recorder, ct);

    // ─────────────────────────────────────────────────────────────────────
    // 🔴🔴 PUT/DELETE /v1/notifications/relay — ADMIN. See the class doc comment.
    // ─────────────────────────────────────────────────────────────────────

    internal static async Task<IResult> SaveRelayAsync(
        RelayConfigRequest? body, HttpContext context, AuditRecorder recorder, CancellationToken ct)
    {
        var store = context.RequestServices.GetService<NotificationConfigStore>();
        if (body is null) return Bad("Request body is required.");
        if (store is null) return StoreUnavailable();
        if (!TryInstance(body.Instance, out var instance, out var instanceError)) return Bad(instanceError!);
        if (!TryPriority(body.MinPriority, out var minPriority, out var priorityError)) return Bad(priorityError!);

        if (string.IsNullOrWhiteSpace(body.MachineCode)) return Bad("A machine code is required.");
        if (string.IsNullOrWhiteSpace(body.TargetName)) return Bad("A target point or command name is required.");

        if (!Enum.TryParse<RelayTargetKind>(body.TargetKind, ignoreCase: true, out var targetKind) ||
            !Enum.IsDefined(targetKind))
        {
            return Bad(
                $"'{body.TargetKind}' is not a valid relay target kind. Valid values are " +
                $"{string.Join(", ", Enum.GetNames<RelayTargetKind>())}.");
        }

        var onValue = Blank(body.OnValueJson);
        var offValue = Blank(body.OffValueJson);

        // Pre-validated here so the caller gets a precise 400 instead of the store's opaque "it did not
        // save". The store enforces the same rules itself and remains the authority — this is a better
        // error message, never a second decision.
        if (targetKind == RelayTargetKind.Point)
        {
            if (!RelayValue.TryParse(onValue, out _, out var onError)) return Bad($"onValueJson: {onError}");
            if (!RelayValue.TryParse(offValue, out _, out var offError)) return Bad($"offValueJson: {offError}");
        }
        else if (onValue is not null || offValue is not null)
        {
            return Bad(
                "A Command relay target takes no energise/de-energise value — it is an argument-less pulse, " +
                "and storing a value the channel provably ignores is worse than refusing it. A Command " +
                "target also CANNOT release the latch: use a Point target for a latching beacon.");
        }

        var (before, atCap) = await LoadForSaveAsync(store, NotificationChannel.Relay, instance, ct)
            .ConfigureAwait(false);
        if (atCap is not null) return atCap;

        var saved = await store.SaveRelayAsync(
                body.Enabled, minPriority, body.MachineCode, targetKind, body.TargetName,
                onValue, offValue, instance, ct)
            .ConfigureAwait(false);

        var after = saved
            ? await FindAsync(store, NotificationChannel.Relay, instance, ct).ConfigureAwait(false)
            : before;

        // 🔴 The audit row for the one configuration in this product that grants authority. `TargetKind`
        // is in it because that field, and only that field, decides whether this row makes the engine
        // perform an Admin-tier machine command for as long as it exists.
        await recorder.RecordAsync(
            context, "notification.relay.save", "notification", $"Relay/{instance}",
            before, new { Saved = saved, Config = after, GrantsCommandAuthority = targetKind == RelayTargetKind.Command },
            ct).ConfigureAwait(false);

        return saved ? Results.Ok(SaveResult(after, store)) : SaveFailed("relay");
    }

    internal static Task<IResult> DeleteRelayAsync(
        string? instance, HttpContext context, AuditRecorder recorder, CancellationToken ct) =>
        DeleteChannelAsync(NotificationChannel.Relay, instance, context, recorder, ct);

    // ─────────────────────────────────────────────────────────────────────
    // POST /v1/notifications/test
    // ─────────────────────────────────────────────────────────────────────

    /// <summary>
    /// 🔴 The send test. <c>POST /v1/connectors/test</c>'s shape exactly — <b>always 200 with an inline
    /// ok/error</b>, and 400 only when the REQUEST itself is malformed — plus one status that endpoint has
    /// no reason to produce: <b>429</b>, from the one rate limiter in this product.
    ///
    /// <para>🔴 <b>Webhook and SMTP only, and the two refusals are stated rather than silently unsupported.</b>
    /// A LOCAL ANNUNCIATION test would have to publish a fabricated annunciation into every open page, which
    /// renders as an alarm card and a tone for a condition that is not happening — a fabricated alarm on an
    /// operator's screen, to test a configuration. What that test would have told you is already on this
    /// API: the stream's own <c>ready</c> frame says whether the channel is configured and enabled, and
    /// <c>status</c> reports how many sessions are attached right now. A RELAY test would be a real machine
    /// write at Admin tier that energises a physical annunciator, fights the channel's own latch for
    /// ownership of the coil, and would leave a beacon lit if the release were then refused by the HALT
    /// latch. Both are genuinely wanted and neither is this endpoint's shape; see the C-7 report.</para>
    /// </summary>
    internal static async Task<IResult> SendTestAsync(
        NotificationTestRequest? body, HttpContext context, NotificationTestRateLimiter limiter,
        AuditRecorder recorder, CancellationToken ct)
    {
        if (body is null) return Bad("Request body is required.");
        if (!TryInstance(body.Instance, out var instance, out var instanceError)) return Bad(instanceError!);

        if (!Enum.TryParse<NotificationChannel>(body.Channel, ignoreCase: true, out var channel) ||
            !Enum.IsDefined(channel))
        {
            return Bad(
                $"'{body.Channel}' is not a notification channel. Valid values are " +
                $"{string.Join(", ", Enum.GetNames<NotificationChannel>())}.");
        }

        if (channel is NotificationChannel.LocalAnnunciation)
        {
            return Bad(
                "Local annunciation has no send test, deliberately: it would publish a fabricated alarm " +
                "card and tone to every open page for a condition that is not happening. Use the `ready` " +
                "frame of GET /v1/alarms/annunciations (is it configured and enabled?) and " +
                "`localAnnunciation.listeners` on GET /v1/notifications/status (is anybody attached right " +
                "now?) — together those answer what a test would.");
        }

        if (channel is NotificationChannel.Relay)
        {
            return Bad(
                "The relay has no send test in this build, deliberately: energising a real annunciator is " +
                "an Admin-tier machine write that would take the coil away from the channel's own latch and " +
                "could leave a beacon lit if the release were then refused by the HALT latch. Watch " +
                "`relay.instances[].annunciatorState` on GET /v1/notifications/status instead — it reports " +
                "what this product believes the annunciator is doing, and says so explicitly when it does " +
                "not know.");
        }

        // 🔴 The rate limit is taken BEFORE any I/O and stamped on ACCEPTANCE, not on completion — the same
        // discipline C-6's per-instance write limiter uses, and for the same reason: stamping after would
        // let a slow receiver stretch the interval, so the bound would be on how fast requests FINISH rather
        // than on how fast this product can be made to start them. A refusal writes no audit row: the
        // limiter exists to bound work per request, and a row per refusal would make the refused path more
        // expensive than the accepted one, which is the wrong shape for a limiter.
        if (!limiter.TryAcquire(DateTimeOffset.UtcNow, out var retryAfter))
        {
            context.Response.Headers.RetryAfter =
                Math.Max(1, (int)Math.Ceiling(retryAfter.TotalSeconds)).ToString(CultureInfo.InvariantCulture);
            return Results.Json(
                new ApiErrorDto(
                    $"A notification send test was already run within the last " +
                    $"{limiter.MinInterval.TotalSeconds:0.#}s. A send test posts to a third party — a chat " +
                    "channel, a mail relay — so this endpoint is rate limited to stop it being used to " +
                    $"generate outbound traffic. Try again in {retryAfter.TotalSeconds:0.#}s."),
                statusCode: StatusCodes.Status429TooManyRequests);
        }

        var services = context.RequestServices;
        NotificationTestOutcome outcome;

        if (channel == NotificationChannel.Webhook)
        {
            var webhook = services.GetService<WebhookNotificationChannel>();
            outcome = webhook is null
                ? Unavailable("webhook")
                : await webhook.SendTestAsync(instance, ct).ConfigureAwait(false);
        }
        else
        {
            var smtp = services.GetService<SmtpNotificationChannel>();
            outcome = smtp is null
                ? Unavailable("e-mail")
                : await smtp.SendTestAsync(instance, ct).ConfigureAwait(false);
        }

        // Audited: this reaches a third party and puts a message in front of people. `POST /v1/connectors/test`
        // is deliberately NOT audited because it only reads from a device on the plant's own network; this
        // one sends.
        //
        // 🔴 Review round 1 (M-2) — the audit row records the OUTCOME and not `outcome.Detail`. Detail can
        // carry an `HttpRequestException` message, which is provider-controlled text: exactly what
        // NotificationConfigStoreHealth refuses to record for being "destined for an HTTP response", and the
        // audit chain is the longest-lived store in this product. No leak was demonstrated — the reviewer
        // could not construct a .NET message carrying the URL path or query, only the authority, which C-2
        // already classifies non-secret — so this is consistency and defence in depth rather than a fix.
        // The full text still reaches the operator in the RESPONSE, where it is transient and is the whole
        // point of running a test.
        await recorder.RecordAsync(
            context, "notification.test", "notification", $"{channel}/{instance}",
            null, new { outcome.Ok }, ct).ConfigureAwait(false);

        return Results.Ok(outcome);
    }

    private static NotificationTestOutcome Unavailable(string channel) => new(false,
        $"The alarm {channel} channel is not running in this process, because the notification " +
        "configuration store could not be opened when this engine started. Nothing can be tested or " +
        "delivered until that is fixed — see the configuration-store health on GET /v1/notifications/status.");

    // ─────────────────────────────────────────────────────────────────────
    // Shared
    // ─────────────────────────────────────────────────────────────────────

    /// <summary>Deleting a channel instance. <c>ON DELETE CASCADE</c> takes its side-table row AND every
    /// stored secret with it, so "remove this channel" can never strand a credential.</summary>
    private static async Task<IResult> DeleteChannelAsync(
        NotificationChannel channel, string? instanceRaw, HttpContext context, AuditRecorder recorder,
        CancellationToken ct)
    {
        var store = context.RequestServices.GetService<NotificationConfigStore>();
        if (store is null) return StoreUnavailable();
        if (!TryInstance(instanceRaw, out var instance, out var instanceError)) return Bad(instanceError!);

        var before = await FindAsync(store, channel, instance, ct).ConfigureAwait(false);
        if (before is null)
        {
            return Results.NotFound(new ApiErrorDto(
                $"No {channel} notification channel named '{instance}' is configured."));
        }

        var deleted = await store.DeleteAsync(channel, instance, ct).ConfigureAwait(false);

        await recorder.RecordAsync(
            context, $"notification.{channel.ToString().ToLowerInvariant()}.delete", "notification",
            $"{channel}/{instance}", before, new { Deleted = deleted }, ct).ConfigureAwait(false);

        if (!deleted) return SaveFailed(channel.ToString());

        return Results.Ok(new NotificationDeleteResultDto(
            channel, instance,
            "Removed, along with every credential stored for it. The change takes effect on the next alarm " +
            "edge — nothing is re-delivered and, for the relay, an annunciator this product had already " +
            "energised is NOT switched off by removing its configuration."));
    }

    /// <summary>
    /// 🔴 What happened to one stored credential — <b>three outcomes, not two</b>.
    ///
    /// <para><b>Review round 1 (I-1) made this an enum, and the <see cref="bool"/> it replaced was a real
    /// silent downgrade.</b> <see cref="NotificationConfigStore.SetSecretAsync"/> is never-throws and returns
    /// <see langword="false"/> ONLY on failure — but the caller folded that <see langword="false"/> into a
    /// flag whose other meaning was "the request carried no secret", answered <c>200</c>, and wrote
    /// <c>"signingSecretChanged": false</c> to the audit log. The channel row had committed and the secret
    /// had not, so <c>HasSigningSecret</c> stayed <see langword="false"/> and
    /// <see cref="WebhookNotificationChannel"/> took its "no signing secret is configured" branch and
    /// <b>posted UNSIGNED</b> — a machine that had quietly stopped proving its identity, after a green save.
    /// That is the exact shape C-3's own I-1 was about, one layer up, and the shape
    /// <see cref="SmtpNotificationChannel"/>'s credential planner refuses three separate ways.</para>
    /// </summary>
    private enum SecretOutcome
    {
        /// <summary>The request carried no value for this credential, so the stored one is untouched.</summary>
        Unchanged,

        /// <summary>The credential was written or deleted, as asked.</summary>
        Changed,

        /// <summary>🔴 The store was asked to SET a value and did not commit it. The caller must fail the
        /// request: the alternative is a configuration that looks saved and is not.</summary>
        Failed,
    }

    /// <summary>
    /// The tri-state a secret field carries, in one place: <see langword="null"/> (or absent) leaves the
    /// stored credential alone, <c>""</c> DELETES it, and any other value replaces it.
    ///
    /// <para>Absent and explicit <c>null</c> are indistinguishable after JSON binding, so the convention has
    /// to be carried by the empty string rather than by which of the two arrived. Stated on the request
    /// records too, because a caller that guesses wrong here either fails to clear a credential or wipes one
    /// it meant to keep.</para>
    ///
    /// <para>🔴 <b>A failed DELETE is deliberately NOT a failure</b>, unlike a failed set.
    /// <see cref="NotificationConfigStore.DeleteSecretAsync"/> returns <see langword="false"/> when no row
    /// was removed, and "there was nothing stored to clear" is the operator's intent already satisfied. A
    /// failed SET is the opposite: the credential the operator just typed is not there, and every channel
    /// reads its absence as "none is configured".</para>
    /// </summary>
    private static async Task<SecretOutcome> ApplySecretAsync(
        NotificationConfigStore store, NotificationChannel channel, string name, string? value,
        string instance, CancellationToken ct)
    {
        if (value is null) return SecretOutcome.Unchanged;

        if (value.Length == 0)
        {
            var deleted = await store.DeleteSecretAsync(channel, name, instance, ct).ConfigureAwait(false);
            return deleted ? SecretOutcome.Changed : SecretOutcome.Unchanged;
        }

        var stored = await store.SetSecretAsync(channel, name, value, instance, ct).ConfigureAwait(false);
        return stored ? SecretOutcome.Changed : SecretOutcome.Failed;
    }

    /// <summary>🔴 The response for a credential that did not commit — the secret-write analogue of
    /// <see cref="SaveFailed"/>, and it names WHICH credential so an operator knows what to re-enter. The
    /// channel row itself HAS committed at this point, which is why the message says so: the configuration
    /// is live and the credential is missing, and that combination is what makes the channel behave as
    /// though none was ever configured.</summary>
    private static IResult SecretFailed(string channel, string credential) => Results.Json(
        new ApiErrorDto(
            $"The {channel} configuration was saved, but its {credential} was NOT stored — the " +
            "configuration store could not commit it. 🔴 This channel will behave as though no " +
            $"{credential} is configured (for a webhook that means posting UNSIGNED, or being rejected by a " +
            "receiver that requires a token), so it must not be left in this state. Re-submit this save to " +
            "store the credential again; the host log names the underlying failure and " +
            "GET /v1/notifications/status reports the store's health."),
        statusCode: StatusCodes.Status500InternalServerError);

    /// <summary>Reads ONE channel instance back through <see cref="NotificationConfigStore.ListAsync"/> —
    /// the one credential-free projection. 🔴 Deliberately not through the engine-internal <c>Get*Async</c>
    /// reads, which carry the decrypted URL: see the class doc comment.</summary>
    private static async Task<NotificationChannelSummary?> FindAsync(
        NotificationConfigStore store, NotificationChannel channel, string instance, CancellationToken ct)
    {
        var all = await store.ListAsync(ct).ConfigureAwait(false);
        return all.FirstOrDefault(
            c => c.Channel == channel && string.Equals(c.Instance, instance, StringComparison.Ordinal));
    }

    /// <summary>
    /// 🔴 Review round 1 (I-2) — the one read every save does, answering both "what was here before?" (for
    /// the audit row) and "may a NEW instance be created at all?" (see
    /// <see cref="MaxInstancesPerChannel"/>) from a single <see cref="NotificationConfigStore.ListAsync"/>.
    ///
    /// <para>The cap applies only to a genuinely new key: re-saving an instance that already exists is the
    /// idempotent case and must never be refused because the channel happens to be full — that would make a
    /// full channel unfixable.</para>
    /// </summary>
    /// <returns><c>AtCap</c> non-null means stop and return it.</returns>
    private static async Task<(NotificationChannelSummary? Existing, IResult? AtCap)> LoadForSaveAsync(
        NotificationConfigStore store, NotificationChannel channel, string instance, CancellationToken ct)
    {
        var all = await store.ListAsync(ct).ConfigureAwait(false);

        var existing = all.FirstOrDefault(
            c => c.Channel == channel && string.Equals(c.Instance, instance, StringComparison.Ordinal));
        if (existing is not null) return (existing, null);

        var configured = all.Count(c => c.Channel == channel);
        if (configured < MaxInstancesPerChannel) return (null, null);

        return (null, Results.Json(
            new ApiErrorDto(
                $"This engine already has {configured.ToString(CultureInfo.InvariantCulture)} configured " +
                $"{channel} instance(s), which is the maximum ({MaxInstancesPerChannel}). Every configured, " +
                "enabled instance is delivered to on every qualifying alarm edge, so the instance count is " +
                "an outbound-traffic multiplier rather than a bookkeeping detail. Delete an instance you no " +
                "longer need, or re-save an existing one by name."),
            statusCode: StatusCodes.Status409Conflict));
    }

    private static NotificationSaveResultDto SaveResult(
        NotificationChannelSummary? saved, NotificationConfigStore store) =>
        new(saved, Health(store));

    private static NotificationConfigStoreHealthDto Health(NotificationConfigStore store)
    {
        var health = store.Health;
        var detail = health.ReadFailures > 0
            ? $"🔴 The notification configuration store has failed " +
              $"{health.ReadFailures.ToString(CultureInfo.InvariantCulture)} read(s) since this engine " +
              $"started (most recently {health.LastFailureType} during '{health.LastFailureOperation}'). A " +
              "failed read is reported to every channel as \"nothing is configured\", so a channel showing " +
              "no activity may be one that could not be read rather than one nobody configured, and an " +
              "alarm may have gone to nobody with every channel counter still reading zero. Check the host " +
              "log and the permissions on the directory below."
            : "The notification configuration store is readable. An empty channel list therefore really " +
              "does mean nothing is configured.";

        return new NotificationConfigStoreHealthDto(
            Available: true,
            Directory: store.RootDirectory,
            health.ReadFailures,
            health.WriteFailures,
            health.LastFailureOperation,
            health.LastFailureType,
            health.LastFailureUtc,
            detail);
    }

    private static NotificationConfigStoreHealthDto UnavailableStore() => new(
        Available: false,
        Directory: null,
        ReadFailures: 0,
        WriteFailures: 0,
        LastFailureOperation: null,
        LastFailureType: null,
        LastFailureUtc: null,
        Detail:
        "🔴 The notification configuration store could not be opened when this engine started, so NO alarm " +
        "notification channel is running this session and no configuration can be saved. Nothing will be " +
        "sent to anybody. The startup log says why (typically the directory could not be created, or the " +
        "database could not be migrated); this is fixed by repairing that and restarting the engine.");

    /// <summary>Whether a caller-supplied instance key is usable, and what it becomes. Empty means
    /// <see cref="NotificationConfigStore.DefaultInstance"/> — every row this build writes uses it, so a
    /// caller that has never heard of instances gets the right one by saying nothing.</summary>
    private static bool TryInstance(string? raw, out string instance, out string? error)
    {
        instance = string.IsNullOrWhiteSpace(raw) ? NotificationConfigStore.DefaultInstance : raw.Trim();
        if (InstancePattern.IsMatch(instance))
        {
            error = null;
            return true;
        }

        instance = NotificationConfigStore.DefaultInstance;
        error = "A channel instance must be 1-64 characters of letters, digits, '.', '_' or '-', starting " +
                "with a letter or a digit. Leave it out entirely for the default instance.";
        return false;
    }

    private static bool TryPriority(string? raw, out AlarmPriority priority, out string? error)
    {
        if (string.IsNullOrWhiteSpace(raw))
        {
            priority = AlarmPriority.High;
            error = "A minimum priority is required. In this build only Critical and High actually occur, " +
                    "so High means \"everything\" and Critical means \"only the ones that gate the line\".";
            return false;
        }

        if (!Enum.TryParse(raw, ignoreCase: true, out priority) || !Enum.IsDefined(priority))
        {
            error = $"'{raw}' is not a valid alarm priority. Valid values are " +
                    $"{string.Join(", ", Enum.GetNames<AlarmPriority>())}.";
            priority = AlarmPriority.High;
            return false;
        }

        error = null;
        return true;
    }

    /// <summary>An empty or whitespace-only string from a cleared form field becomes
    /// <see langword="null"/> — see the carried item closed in <see cref="SaveWebhookAsync"/>.</summary>
    private static string? Blank(string? value) =>
        string.IsNullOrWhiteSpace(value) ? null : value.Trim();

    private static IResult Bad(string message) => Results.BadRequest(new ApiErrorDto(message));

    private static IResult StoreUnavailable() => Results.Json(
        new ApiErrorDto(UnavailableStore().Detail),
        statusCode: StatusCodes.Status503ServiceUnavailable);

    /// <summary>The store is never-throws: a failed write returns <see langword="false"/> rather than
    /// raising, so this is the only place a caller learns that a save did not commit. 500 rather than 503 —
    /// the store IS open (an unopenable one is handled above), so this is a fault in this engine rather than
    /// a dependency being down.</summary>
    private static IResult SaveFailed(string channel) => Results.Json(
        new ApiErrorDto(
            $"The {channel} notification configuration was NOT saved — the configuration store rejected or " +
            "could not commit the write. Nothing was changed. The host log names the failure; " +
            "GET /v1/notifications/status reports the store's health."),
        statusCode: StatusCodes.Status500InternalServerError);
}
