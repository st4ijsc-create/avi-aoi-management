namespace St4i.EngineApi.Alarms;

/// <summary>
/// Task C-2 (.superpowers/sdd/2026-07-30-dotC-alarm-notification-blueprint/task-2-brief.md) — the four
/// channels the owner approved in the Đợt C blueprint (§2). One row per member in
/// <see cref="NotificationConfigStore"/>'s <c>notification_channels</c> table, and the member NAME is what
/// is persisted (never its ordinal — same discipline <see cref="AlarmStore"/> already uses for
/// <see cref="AlarmPriority"/>/<see cref="AlarmSource"/>, so reordering this enum can never silently
/// re-point an operator's stored configuration at a different channel).
/// </summary>
public enum NotificationChannel
{
    /// <summary>C-3 — an HTTP POST to a URL an operator supplies (Slack/Teams/MES/Zabbix all accept
    /// one), signed with <see cref="NotificationSecretNames.WebhookSigningSecret"/> so the receiver can
    /// verify the POST really came from this machine.</summary>
    Webhook,

    /// <summary>C-4 — e-mail via <see cref="System.Net.Mail.SmtpClient"/> (BCL; this batch adds no
    /// NuGet). See <see cref="SmtpTlsMode"/> for the one place that BCL choice constrains what an
    /// operator may configure.</summary>
    Smtp,

    /// <summary>C-5 — noise and light at the machine itself (web audio + a Windows toast across the
    /// DesktopShell process boundary). Reaches only somebody already near the machine, and needs no
    /// configuration beyond on/off and a threshold — C-5 owns everything else.</summary>
    LocalAnnunciation,

    /// <summary>🔴 C-6 — energising a real annunciator/beacon through a declared writable point or
    /// command. The highest-risk item in the batch: it is an ordinary machine write, it passes through
    /// <c>EstopGuardRule</c> unchanged, and it is therefore dark while HALT is latched. Never a safety
    /// device — see the blueprint §4 and <see cref="RelayChannelConfig"/>.</summary>
    Relay,
}

/// <summary>
/// Task C-2 — how <see cref="System.Net.Mail.SmtpClient"/> (which C-4 must use: BCL only, no NuGet) is
/// allowed to secure the connection.
///
/// <para>🔴 <b>Why there is no <c>ImplicitTls</c>/SMTPS/port-465 member, and why that absence is
/// deliberate rather than an oversight:</b> <see cref="System.Net.Mail.SmtpClient"/> is compat-only and
/// implements exactly ONE TLS mode — connect in the clear, then issue <c>STARTTLS</c> (that is all
/// <c>SmtpClient.EnableSsl</c> does). It cannot negotiate TLS at connect time, which is what port 465
/// requires. Offering an <c>ImplicitTls</c> option here would let an operator save a configuration that
/// C-4 provably cannot honour without taking a NuGet dependency this batch forbids — a config store whose
/// values the implementing task must silently ignore is worse than one that never accepted them. An
/// operator who needs SMTPS must point this at a relay that speaks STARTTLS.</para>
/// </summary>
public enum SmtpTlsMode
{
    /// <summary>No transport security at all — a plain SMTP conversation. Legitimate for an in-plant
    /// relay on an isolated network (the Đợt A target deployment), and dangerous anywhere else: the
    /// <see cref="NotificationSecretNames.SmtpPassword"/> travels in the clear under this mode.</summary>
    None,

    /// <summary>Connect in the clear, then upgrade with <c>STARTTLS</c> (<c>SmtpClient.EnableSsl =
    /// true</c>). The only secured mode the BCL client can actually perform.</summary>
    StartTls,
}

/// <summary>
/// Task C-2 — which of the two, mutually exclusive, machine-write shapes a relay target is.
///
/// <para><b>This enum is new, and it had to be:</b> nothing in this solution discriminates "writable
/// point" from "command" with a value — the separation is carried STRUCTURALLY everywhere else (two
/// request records <c>SetpointWriteRequest</c>/<c>CommandRequest</c>, two result records, two rejection
/// enums, two endpoints, and two different RBAC policies — Engineer for a setpoint, Admin for a command).
/// A stored configuration cannot carry that structure, so it must carry a discriminator instead; the
/// alternative — one "target name" field that C-6 probes against both — would collapse a distinction Đợt B
/// spent a whole task establishing, and would let a config intended for a setpoint fire a command.</para>
/// </summary>
public enum RelayTargetKind
{
    /// <summary>A declared WRITABLE POINT (<c>SetpointWriteRequest.Point</c>) — a value written to a
    /// named point, bounds-checked against the register map. Engineer-authorised on the HTTP path.</summary>
    Point,

    /// <summary>A declared COMMAND (<c>CommandRequest.Command</c>) — a named, argument-less action (a
    /// Modbus coil pulse, an OPC-UA method call). Admin-authorised on the HTTP path.</summary>
    Command,
}

/// <summary>
/// Task C-2 — the well-known names under which a channel's encrypted secrets are stored in
/// <see cref="NotificationConfigStore"/>'s <c>notification_secrets</c> table.
///
/// <para>Secrets are addressed by NAME rather than by column precisely so that adding a second secret to
/// a channel is a new ROW, never a new column — which is what keeps the credential-free read projection
/// safe by construction instead of by a maintainer remembering a rule. See
/// <see cref="NotificationConfigStore"/>'s own doc comment.</para>
/// </summary>
public static class NotificationSecretNames
{
    /// <summary>
    /// 🔴 C-3 — the webhook's destination URL, stored ENCRYPTED rather than as a plain column.
    ///
    /// <para><b>Review round 1 (I2) moved it here, and the reasoning is worth keeping.</b> The original
    /// C-2 shape classified the URL secret-bearing and then stored it in the clear, on the argument that
    /// its realistic exposure was this product's own read API (which the projection split already covers)
    /// rather than another local account (which the directory ACL covers). That argument missed the
    /// residual value DPAPI has OVER the ACL under
    /// <see cref="System.Security.Cryptography.DataProtectionScope.LocalMachine"/>: <b>machine-binding</b>.
    /// An ACL protects a file that stays put; it does nothing once <c>notifications.db</c> leaves the
    /// machine in a backup, a support bundle or a <c>%ProgramData%</c> snapshot. A Slack/Teams incoming
    /// webhook URL is a bearer capability — whoever holds it can post — so a copied database was handing
    /// over a working capability while the HMAC signing secret sitting in the very same file was not.
    /// Two capability-grade values in one file with opposite treatment is not a defensible line.</para>
    ///
    /// <para><see cref="WebhookChannelConfig.Endpoint"/> and
    /// <see cref="WebhookChannelConfig.UrlFingerprint"/> remain plain columns — they are derived,
    /// non-secret facts ABOUT the URL, and they are what makes the capability's absence from every public
    /// read survivable for an operator (see <see cref="WebhookChannelConfig.UrlFingerprint"/>).</para>
    /// </summary>
    public const string WebhookUrl = "webhook.url";

    /// <summary>C-3 — the HMAC key the webhook POST is signed with, so the receiver can verify the
    /// request really came from this machine.</summary>
    public const string WebhookSigningSecret = "webhook.signing_secret";

    /// <summary>C-4 — the password for <see cref="SmtpChannelConfig.Username"/>. The one value in this
    /// product that belongs to a THIRD PARTY (a mail server operator), not to this machine — which is
    /// exactly why it does not live in <c>CredentialStore</c>; see
    /// <see cref="NotificationConfigStore"/>'s own doc comment.</summary>
    public const string SmtpPassword = "smtp.password";
}

/// <summary>
/// Task C-2 — the two facts EVERY channel carries, and the one operation every channel performs on them.
///
/// <para>🔴 <b><see cref="MinPriority"/> is a THRESHOLD, never an override.</b> It decides whether an
/// alarm that already has a priority is worth delivering; nothing here can change what an alarm's
/// priority IS. That distinction is load-bearing rather than pedantic:
/// <see cref="AlarmSource.Identity"/> is capped at <see cref="AlarmPriority.High"/> by deliberate design
/// (an expiring certificate feeds a machine-write gate and must never be able to halt production), and a
/// configuration store that could promote a priority would let an operator's notification setting quietly
/// undo a safety decision made somewhere else entirely. There is therefore no "treat X as Critical" knob
/// in this type, and adding one later would need this paragraph answered first.</para>
/// </summary>
public interface INotificationChannelConfig
{
    /// <summary>Whether this channel should deliver at all. The ONLY enable mechanism in the product —
    /// Task C-2 deleted C-1's placeholder <c>ST4I_ALARM_NOTIFY_ENABLED</c> env gate rather than leave two
    /// (see <see cref="NotificationStartupNotices"/>).</summary>
    bool Enabled { get; }

    /// <summary>The LEAST severe priority worth delivering on this channel. Only
    /// <see cref="AlarmPriority.Critical"/> and <see cref="AlarmPriority.High"/> actually occur in this
    /// build (Policy is Critical; NgRate, DriverHealth and Identity are High), so
    /// <see cref="AlarmPriority.High"/> means "everything" and <see cref="AlarmPriority.Critical"/> means
    /// "only the ones that gate the line".</summary>
    AlarmPriority MinPriority { get; }
}

/// <summary>Task C-2 — the severity comparison every channel needs, in ONE place.</summary>
public static class NotificationDelivery
{
    /// <summary>🔴 <see cref="AlarmPriority"/> is declared MOST-SEVERE-FIRST (<c>Critical = 0</c> …
    /// <c>Low = 3</c>), so "at least as severe as the threshold" is <c>&lt;=</c>, NOT <c>&gt;=</c>. This
    /// lives here, once, rather than in each of C-3..C-6 because the inversion is exactly the kind of
    /// thing four independent implementations get wrong in at least one of them — and getting it
    /// backwards would mean a channel that delivers everything EXCEPT the alarms that matter.
    /// <see cref="AlarmNotifier"/> already had to document the same inversion for its own
    /// <c>IsMoreSevere</c>.</summary>
    public static bool MeetsThreshold(AlarmPriority priority, AlarmPriority minPriority) =>
        priority <= minPriority;

    /// <summary>Whether <paramref name="config"/> should deliver an alarm of this
    /// <paramref name="priority"/> — the whole question C-3..C-6 ask. A <see langword="null"/> config
    /// (the channel was never configured) delivers nothing.</summary>
    public static bool Delivers(this INotificationChannelConfig? config, AlarmPriority priority) =>
        config is { Enabled: true } && MeetsThreshold(priority, config.MinPriority);
}

/// <summary>
/// Task C-2 — the FULL webhook configuration, including <see cref="Url"/>. Engine-internal only (C-3);
/// never routed to an HTTP response. The credential-free shape is <see cref="WebhookChannelSummary"/>.
/// </summary>
/// <param name="Url">🔴 The bearer capability, DPAPI-sealed in <c>notification_secrets</c> under
/// <see cref="NotificationSecretNames.WebhookUrl"/> — see there for why it is encrypted rather than a
/// plain column. Populated only by the ENGINE-INTERNAL read
/// (<see cref="NotificationConfigStore.GetWebhookAsync"/>, for C-3); no public projection can reach it,
/// because it is not a column of <c>webhook_config</c> at all. <see langword="null"/> if the secret is
/// missing or its blob cannot be unprotected — a channel that cannot be posted to, which C-3 must
/// handle rather than assume away.</param>
/// <param name="Endpoint">The derived, deliberately NON-secret display form — scheme, host and
/// non-default port only, with the path, query, fragment AND userinfo (i.e. every part that can carry a
/// capability token) discarded. Computed once by <see cref="NotificationConfigStore"/> at save time and
/// stored as its own column, the same pattern <c>ConnectorConfigStore</c> uses for <c>host</c>/<c>port</c>
/// alongside the opaque <c>map_json</c> it cannot expose.
///
/// <para><b>Known limitation, doc-only:</b> a token embedded in a SUBDOMAIN would survive this
/// truncation, since the host is exactly what <see cref="Endpoint"/> preserves. Not live for any target
/// in the blueprint's list — Slack, Teams, Discord and Zapier all carry their secret in the PATH — but
/// worth stating rather than letting a future integration assume the host is always safe.</para></param>
/// <param name="UrlFingerprint">
/// 🔴 Review round 1 (I3) — what makes the URL's absence from every public read SURVIVABLE.
///
/// <para><see cref="Endpoint"/> alone identifies nothing: it is <c>https://hooks.slack.com</c> for EVERY
/// Slack webhook on earth. So an operator asking "is this still pointed at #line-alerts, or at the
/// channel we deleted last month?" could not answer it from any read the product offered, and the only
/// remedy was to blind-re-enter the URL. That is the pressure that would have pushed C-7/C-8 into either
/// shipping an unverifiable configuration screen or exposing the URL — undoing the encryption
/// entirely.</para>
///
/// <para>A truncated SHA-256 of the full URL answers "did this change?" and "are these two the same?"
/// without ever returning the capability — the same "opaque token obtainable only by having seen the real
/// thing" role <c>ConnectorWriteCapability.ComputeFingerprint</c>, <c>DeviceIdentity.Fingerprint</c> and
/// <c>SiteEndpoints.PemFingerprint</c> already play in this codebase. Truncation is safe here because the
/// fingerprint is only ever compared, never inverted: recovering the URL would mean guessing the whole
/// high-entropy path and checking it, which the full digest would allow equally.</para></param>
/// <param name="Label">Review round 1 (I3) — an optional operator-supplied name ("Ops Slack #line-alerts").
/// Free text, never derived, never a credential, and shown by every public read: the fingerprint proves
/// two configurations are the SAME, and this is what tells a human WHICH one it is. Deliberately not
/// validated beyond a length bound — it is a note to the next operator, not an identifier.</param>
public sealed record WebhookChannelConfig(
    bool Enabled,
    AlarmPriority MinPriority,
    string Instance,
    string? Url,
    string Endpoint,
    string UrlFingerprint,
    string? Label) : INotificationChannelConfig;

/// <summary>Task C-2 — the credential-free webhook projection. The URL is absent because it is not a
/// column of <c>webhook_config</c> at all — it is an encrypted row in another table — not because it was
/// removed after being fetched.</summary>
/// <param name="HasUrl">Whether a destination is stored AND could be decrypted. <see langword="false"/>
/// means this channel cannot post anywhere, which is exactly the kind of thing an operator must be able
/// to see without being handed the URL.</param>
/// <param name="HasSigningSecret">Whether <see cref="NotificationSecretNames.WebhookSigningSecret"/> is
/// set. Derived from the PRESENCE of a row (its <c>name</c> column), never by reading the secret.</param>
public sealed record WebhookChannelSummary(
    string Endpoint,
    string UrlFingerprint,
    string? Label,
    bool HasUrl,
    bool HasSigningSecret);

/// <summary>Task C-2 — the FULL SMTP configuration. Note the password is NOT here: it lives in
/// <c>notification_secrets</c> under <see cref="NotificationSecretNames.SmtpPassword"/> and is fetched
/// separately by <see cref="NotificationConfigStore.GetSecretAsync"/>, so no read of this record can ever
/// carry it.</summary>
/// <param name="Username">Deliberately NOT treated as a secret and visible in the summary: an operator
/// diagnosing an authentication failure needs to see WHICH account is configured, a username alone
/// authorises nothing, and hiding it would make the configuration unreadable for no security gain.</param>
public sealed record SmtpChannelConfig(
    bool Enabled,
    AlarmPriority MinPriority,
    string Instance,
    string Host,
    int Port,
    SmtpTlsMode Tls,
    string FromAddress,
    IReadOnlyList<string> Recipients,
    string? Username) : INotificationChannelConfig;

/// <summary>Task C-2 — the credential-free SMTP projection. Every field of
/// <see cref="SmtpChannelConfig"/> is present because none of them is secret-bearing; the password was
/// never a column of <c>smtp_config</c> in the first place.</summary>
public sealed record SmtpChannelSummary(
    string Host,
    int Port,
    SmtpTlsMode Tls,
    string FromAddress,
    IReadOnlyList<string> Recipients,
    string? Username,
    bool HasPassword);

/// <summary>Task C-2 — local annunciation carries nothing beyond the two universal facts. C-5 owns
/// everything else (which sound, how loud, how long, which browsers/toasts) and will add columns through
/// the migration ladder if it needs them.</summary>
public sealed record LocalAnnunciationChannelConfig(
    bool Enabled,
    AlarmPriority MinPriority,
    string Instance) : INotificationChannelConfig;

/// <summary>
/// 🔴 Task C-2 — the relay target: WHICH machine, and WHICH declared writable point or command.
///
/// <para><b>No address, ever.</b> Đợt B settled that points and commands are NAMED and that the register
/// map is the entire safety boundary; a configuration that stored a coil address would be a second,
/// unvalidated boundary sitting beside the real one. Resolving <see cref="TargetName"/> to whatever the
/// driver actually writes is C-6's problem, performed through the ordinary
/// <c>FleetHost.TryWriteSetpointAsync</c>/<c>TryInvokeCommandAsync</c> path, which means the map's own
/// bounds and <c>EstopGuardRule</c> both still apply.</para>
///
/// <para>🔴 <b>Known gap this task deliberately did not guess at — the energise/de-energise VALUES.</b>
/// A <see cref="RelayTargetKind.Command"/> target needs none (it is an argument-less pulse). A
/// <see cref="RelayTargetKind.Point"/> target does: the blueprint (§4) decided the relay LATCHES — on
/// when the first alarm becomes active, off when the last one clears — and a latch over a named point
/// means writing one value to assert and another to release. Those values are not stored here because
/// their domain (<c>bool</c> for an OPC-UA Bool setpoint, a number for a Modbus holding register) is a
/// consequence of how C-6 chooses to latch, and inventing them now would either be dead columns or a
/// silently wrong write to a point the system cannot prove is a lamp rather than a conveyor. C-6 adds two
/// nullable columns through the migration ladder once it has made that decision — which is exactly what
/// the ladder is for.</para>
/// </summary>
/// <param name="MachineCode">Stored verbatim. Resolved case-INSENSITIVELY against the live roster at fire
/// time (the convention every endpoint in this codebase already uses), and deliberately not validated
/// against the roster at save time: the roster changes at runtime, so a save-time check would prove
/// nothing and would forbid configuring a machine before it is registered.</param>
/// <param name="TargetName">Stored verbatim and matched case-SENSITIVELY (ordinal) — the drivers'
/// own <c>FindRegisterByMetric</c>/<c>FindCommandByName</c> lookups are ordinal, so folding case here
/// would make this store disagree with the thing that ultimately performs the write.</param>
public sealed record RelayChannelConfig(
    bool Enabled,
    AlarmPriority MinPriority,
    string Instance,
    string MachineCode,
    RelayTargetKind TargetKind,
    string TargetName) : INotificationChannelConfig;

/// <summary>Task C-2 — the credential-free relay projection. Identical in content to
/// <see cref="RelayChannelConfig"/>'s target fields because a machine code and a DECLARED point/command
/// name are not secrets — they are exactly what an operator must be able to audit ("what is this product
/// allowed to energise?"), and Đợt B's own framing argues FOR maximum visibility of what a map
/// grants.</summary>
public sealed record RelayChannelSummary(
    string MachineCode,
    RelayTargetKind TargetKind,
    string TargetName);

/// <summary>
/// Task C-2 — the ONE credential-free shape every public read returns, and the shape C-7's endpoint will
/// serialise directly. Exactly one of <see cref="Webhook"/>/<see cref="Smtp"/>/<see cref="Relay"/> is
/// non-<see langword="null"/>, selected by <see cref="Channel"/>; all three are
/// <see langword="null"/> for <see cref="NotificationChannel.LocalAnnunciation"/>, which has no
/// configuration of its own.
/// </summary>
/// <param name="Instance">Review round 1 (I4) — which configured instance of
/// <paramref name="Channel"/> this is. <c>"default"</c> for every row this build writes; part of the
/// primary key from v1 so that a second webhook (Slack AND the MES) is a new ROW rather than a three-table
/// rebuild after field data exists. See <see cref="NotificationConfigStore.DefaultInstance"/>.</param>
public sealed record NotificationChannelSummary(
    NotificationChannel Channel,
    string Instance,
    bool Enabled,
    AlarmPriority MinPriority,
    DateTimeOffset UpdatedAtUtc,
    WebhookChannelSummary? Webhook = null,
    SmtpChannelSummary? Smtp = null,
    RelayChannelSummary? Relay = null);
