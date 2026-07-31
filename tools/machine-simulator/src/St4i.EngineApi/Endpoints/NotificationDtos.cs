using St4i.EngineApi.Alarms;

namespace St4i.EngineApi.Endpoints;

// ─────────────────────────────────────────────────────────────────────────
// Requests. 🔴 Every secret-bearing field carries the SAME tri-state, stated on each one because a caller
// that guesses wrong either fails to clear a credential or wipes one it meant to keep:
//     absent / null → leave the stored credential exactly as it is
//     ""            → DELETE the stored credential
//     any value     → replace it
// ─────────────────────────────────────────────────────────────────────────

/// <summary>
/// <c>PUT /v1/notifications/webhook</c>. Engineer.
/// </summary>
/// <param name="Url">🔴 REQUIRED on every save, including one that only changes a label — see
/// <see cref="NotificationEndpoints"/>'s doc comment for why this endpoint deliberately cannot re-use the
/// stored URL. It is stored ENCRYPTED (it is a bearer capability: whoever holds a Slack or Teams incoming
/// webhook URL can post), and no read of this API returns it. <c>endpoint</c> and <c>urlFingerprint</c> on
/// the current configuration are what let you confirm you are entering the same destination.</param>
/// <param name="Label">An operator's note ("Ops Slack #line-alerts"). Blank clears it. Never a
/// credential.</param>
/// <param name="AuthHeaderName">The header a static-token receiver authenticates with (<c>X-Api-Key</c>,
/// <c>Authorization</c>). 🔴 Blank CLEARS it — and clearing it also deletes the stored token, because a
/// token that names no header can never be sent. Not a credential and visible in every read: knowing WHICH
/// header a webhook authenticates with authorises nobody.</param>
/// <param name="SigningSecret">The HMAC key the POST is signed with. Tri-state (see above). Absent for
/// Slack and Teams, which verify nothing and treat the URL as the credential.</param>
/// <param name="AuthToken">The COMPLETE value of <paramref name="AuthHeaderName"/>'s header, scheme word
/// included (<c>Bearer eyJhb…</c> for a bearer token, the bare key for <c>X-Api-Key</c>). Tri-state.
///
/// <para>🔴 <b>Review round 1 (M-4) — the ONE case where the tri-state above does not hold, and a UI can
/// lose a credential by omission.</b> This field's "absent = keep" is overridden by
/// <paramref name="AuthHeaderName"/>: leaving the HEADER NAME out of a request clears it, and clearing it
/// DELETES the stored token with it (a token that names no header can never be sent). So a form that PUTs a
/// label change without re-sending <paramref name="AuthHeaderName"/> silently wipes the token even though
/// it said nothing about the token at all. That follows from PUT meaning full replacement here, but it is
/// the kind of thing a caller discovers in production, so: <b>a client editing an existing webhook must
/// re-send every non-secret field it is not deliberately clearing, including
/// <paramref name="AuthHeaderName"/>.</b> The secret fields are the only ones with keep-on-absent
/// semantics.</para></param>
public sealed record WebhookConfigRequest(
    bool Enabled,
    string? MinPriority,
    string? Url,
    string? Label = null,
    string? AuthHeaderName = null,
    string? SigningSecret = null,
    string? AuthToken = null,
    string? Instance = null);

/// <summary>
/// <c>PUT /v1/notifications/smtp</c>. Engineer.
/// </summary>
/// <param name="Tls">🔴 <c>None</c> or <c>StartTls</c>. There is deliberately no implicit-TLS/SMTPS/port-465
/// mode: <see cref="System.Net.Mail.SmtpClient"/> implements only STARTTLS and provably cannot honour one,
/// and a configuration store that accepted a value the channel must silently ignore is worse than one that
/// never accepted it.</param>
/// <param name="Username">Deliberately NOT a secret and visible in every read — an operator diagnosing an
/// authentication failure needs to see which account is configured, and a username alone authorises
/// nobody. Blank clears it.</param>
/// <param name="Password">Tri-state (see above). 🔴 Stored encrypted and never returned by any read; the
/// configuration reports only whether one EXISTS.</param>
public sealed record SmtpConfigRequest(
    bool Enabled,
    string? MinPriority,
    string? Host,
    int Port,
    string? Tls,
    string? FromAddress,
    IReadOnlyList<string>? Recipients,
    string? Username = null,
    string? Password = null,
    string? Instance = null);

/// <summary><c>PUT /v1/notifications/local-annunciation</c>. Engineer. On/off and a threshold is the whole
/// configuration — everything about HOW an annunciation presents (which tone, how loud, whether the browser
/// is holding it muted) is a property of the SCREEN, not of this engine.</summary>
public sealed record LocalAnnunciationConfigRequest(
    bool Enabled,
    string? MinPriority,
    string? Instance = null);

/// <summary>
/// 🔴🔴 <c>PUT /v1/notifications/relay</c>. <b>ADMIN</b> — see <see cref="NotificationEndpoints"/>'s doc
/// comment. This is the one configuration in this product that grants authority: with
/// <paramref name="TargetKind"/> = <c>Command</c> it makes the engine perform, automatically and for as long
/// as the row exists, an action a human needs Admin for.
/// </summary>
/// <param name="MachineCode">Resolved case-insensitively against the live roster at FIRE time, and
/// deliberately not checked against it here: the roster changes at runtime, so a save-time check would prove
/// nothing and would forbid configuring a machine before it is onboarded.</param>
/// <param name="TargetKind">🔴 <c>Point</c> (a declared writable point — Engineer-tier when a human does it)
/// or <c>Command</c> (a declared, argument-less command — Admin-tier when a human does it, and the reason
/// this whole route is Admin). A <c>Command</c> target can ASSERT the annunciator and structurally cannot
/// RELEASE it: a latching beacon needs a <c>Point</c>.</param>
/// <param name="TargetName">Matched case-SENSITIVELY, because the drivers' own point/command lookups are
/// ordinal — folding case here would make this configuration disagree with the thing that performs the
/// write.</param>
/// <param name="OnValueJson">The raw JSON SCALAR written to energise — <c>true</c>, <c>1</c>, <c>"ON"</c>.
/// Required for a <c>Point</c> target and refused for a <c>Command</c> one. There is deliberately no
/// default: a default would be this product choosing what to write to a coil it cannot prove is a lamp
/// rather than a conveyor, and <c>true</c> is simply wrong for a Modbus holding register that wants
/// <c>1</c>.</param>
/// <param name="OffValueJson">The scalar written to release. A separate value rather than a derived inverse,
/// because the register map's declared range is the authority on what "off" is and this product must not
/// infer it.</param>
public sealed record RelayConfigRequest(
    bool Enabled,
    string? MinPriority,
    string? MachineCode,
    string? TargetKind,
    string? TargetName,
    string? OnValueJson = null,
    string? OffValueJson = null,
    string? Instance = null);

/// <summary><c>POST /v1/notifications/test</c>. Engineer, rate limited — see
/// <see cref="NotificationTestRateLimiter"/>.</summary>
/// <param name="Channel">🔴 <c>Webhook</c> or <c>Smtp</c> only. <c>LocalAnnunciation</c> and <c>Relay</c> are
/// refused with a 400 that says why, rather than silently unsupported — see
/// <see cref="NotificationEndpoints.SendTestAsync"/>.</param>
public sealed record NotificationTestRequest(string? Channel, string? Instance = null);

// ─────────────────────────────────────────────────────────────────────────
// Responses.
// ─────────────────────────────────────────────────────────────────────────

/// <summary>
/// 🔴 The configuration store's own health, returned beside EVERY configuration read and every save.
///
/// <para><b>Why it is not a separate route.</b> <see cref="NotificationConfigStore.ListAsync"/> is
/// never-throws: a read that FAILED returns exactly what "nothing is configured" returns, and every one of
/// the four channels reports that state identically — they move <c>Considered</c> and nothing else. It is
/// the one loss family no channel can count, and C-3, C-4, C-5 and C-6 each carried it forward. Two facts
/// that are indistinguishable in the data must be shown together, or a reader picks the wrong one.</para>
/// </summary>
/// <param name="Available">Whether the store is running at all. <see langword="false"/> means it could not
/// be OPENED at startup, so no channel exists in this process and nothing can be configured or delivered
/// until the engine is restarted.</param>
/// <param name="Directory">Where <c>notifications.db</c> lives. Public because that directory's ACL IS the
/// confidentiality boundary against another local account, so an operator diagnosing permissions needs to
/// find it.</param>
/// <param name="LastFailureType">🔴 The exception's TYPE NAME only, never its message: a message is
/// provider-controlled text and this record is destined for an HTTP response. The host log has the
/// full exception.</param>
/// <param name="Detail">The sentence that says what a zero somewhere else might actually mean. Longer than a
/// label on purpose.</param>
public sealed record NotificationConfigStoreHealthDto(
    bool Available,
    string? Directory,
    long ReadFailures,
    long WriteFailures,
    string? LastFailureOperation,
    string? LastFailureType,
    DateTimeOffset? LastFailureUtc,
    string Detail);

/// <summary><c>GET /v1/notifications/channels</c> — every configured channel, credential-free, and the
/// store's health beside it.</summary>
public sealed record NotificationChannelsDto(
    IReadOnlyList<NotificationChannelSummary> Channels,
    NotificationConfigStoreHealthDto ConfigStore);

/// <summary>What a save returns: the channel as it now stands, read back through the ONE credential-free
/// projection rather than assembled by the handler — a hand-built response DTO is precisely how a
/// secret-bearing field reaches a response body, which is why
/// <see cref="NotificationConfigStore.SaveWebhookAsync"/> returns a <see cref="bool"/> and not a
/// summary.</summary>
public sealed record NotificationSaveResultDto(
    NotificationChannelSummary? Saved,
    NotificationConfigStoreHealthDto ConfigStore);

/// <summary>What a delete returns.</summary>
public sealed record NotificationDeleteResultDto(
    NotificationChannel Channel,
    string Instance,
    string Message);

/// <summary>🔴 <see cref="SmtpChannelStats.PartiallyDelivered"/> is the ONLY signal anywhere in this product
/// that one recipient has silently stopped receiving alarms, so it gets a sentence of its own rather than
/// being one number among eight.</summary>
/// <param name="PartialDelivery"><see langword="null"/> when nothing has been partially delivered. Non-null
/// is also hoisted into <see cref="NotificationStatusDto.Attention"/>.</param>
public sealed record SmtpStatusDto(SmtpChannelStats Stats, string? PartialDelivery);

/// <summary>Local annunciation's counters, plus the hub gauges that say whether anybody is attached.</summary>
/// <param name="Listeners">Browser sessions attached RIGHT NOW. A gauge.</param>
/// <param name="MaxListeners">The cap. See <see cref="AlarmAnnunciationHub.DefaultMaxListeners"/>.</param>
/// <param name="RejectedListeners">Sessions REFUSED because the cap was reached. Each one is a page that was
/// not annunciated.</param>
/// <param name="UnheardMeaning">🔴 The long form of <see cref="LocalAnnunciationStats.Unheard"/>, carried in
/// the payload rather than left to a screen to invent, because the short form ("alarms nobody was told
/// about") is false — see <see cref="LocalAnnunciationStats"/>.</param>
/// <param name="Stats">🔴 <see langword="null"/> when the local-annunciation CHANNEL is not running — which
/// happens whenever the configuration store could not be opened. The hub gauges beside it are still real:
/// review round 1 (M-3) found that requiring both made every listener gauge, and the refused-stream warning,
/// vanish on exactly the degraded host where the subscriber cap is still turning browsers away.</param>
public sealed record LocalAnnunciationStatusDto(
    LocalAnnunciationStats? Stats,
    int Listeners,
    int MaxListeners,
    long RejectedListeners,
    long HubPublished,
    long HubFannedOut,
    long HubOverflowed,
    string UnheardMeaning);

/// <summary>The relay's counters and what it believes about each configured annunciator.</summary>
public sealed record RelayStatusDto(
    RelayChannelStats Stats,
    IReadOnlyList<RelayInstanceStateDto> Instances);

/// <summary>
/// 🔴 One relay instance, as an operator may see it.
///
/// <para><b><see cref="RelayInstanceState.Commanded"/> is deliberately absent.</b> C-6 carried the
/// constraint that C-7 must render <c>Energised</c> and never <c>Commanded</c>: they answer different
/// questions (<c>Commanded</c> is the level a write was last ISSUED for, which is what the write gate
/// consults; <c>Energised</c> is what this product believes the device is DOING), and a screen showing the
/// wrong one would report a beacon as off after a write that never reached it. Leaving it out of the payload
/// makes that mistake unavailable rather than merely discouraged.</para>
/// </summary>
/// <param name="Energised">🔴 <see langword="true"/> = believed ON, <see langword="false"/> = believed OFF,
/// <see langword="null"/> = <b>UNKNOWN</b>. Never render <see langword="null"/> as "off" — see
/// <paramref name="AnnunciatorState"/>, which is the rendering.</param>
/// <param name="AnnunciatorState">🔴 The sentence a screen should show. It distinguishes the three states
/// that a boolean cannot: <b>ON with nothing latched</b> means this product asked for the beacon to go out
/// and was refused (it is still lit); <b>UNKNOWN</b> means this product does not know what the beacon is
/// doing, which is not the same as off.</param>
public sealed record RelayInstanceStateDto(
    string Instance,
    int LatchedAlarms,
    bool? Energised,
    DateTimeOffset? LastAttemptUtc,
    string AnnunciatorState);

/// <summary>
/// <c>GET /v1/notifications/status</c> — every channel's counters, routed somewhere for the first time.
/// </summary>
/// <param name="Notifier">The seam's own accounting, or <see langword="null"/> if it is not running.</param>
/// <param name="Queues">Per-channel queue accounting. The aggregate can only say "something is falling
/// behind"; this says WHICH, which is the whole reason C-6 gave each channel its own queue.</param>
/// <param name="Attention">🔴 The things an operator must not have to find. Every entry is a full sentence
/// naming a real, current condition — a partial e-mail delivery (the only visible sign that one recipient
/// has silently stopped receiving alarms), an annunciator believed lit with no alarm latched, a
/// configuration store that has failed a read, a browser refused a stream, a dropped notification. Empty is
/// the normal state and means exactly that.</param>
public sealed record NotificationStatusDto(
    NotificationConfigStoreHealthDto ConfigStore,
    AlarmNotifierStats? Notifier,
    IReadOnlyList<AlarmNotifierChannelStats> Queues,
    WebhookChannelStats? Webhook,
    SmtpStatusDto? Smtp,
    LocalAnnunciationStatusDto? LocalAnnunciation,
    RelayStatusDto? Relay,
    IReadOnlyList<string> Attention);
