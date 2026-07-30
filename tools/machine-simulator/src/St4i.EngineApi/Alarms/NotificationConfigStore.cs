using System.Globalization;
using System.Runtime.Versioning;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using Microsoft.Data.Sqlite;
using St4i.EdgeCore.Infrastructure;

namespace St4i.EngineApi.Alarms;

/// <summary>
/// Task C-2 — the physical schema of <see cref="NotificationConfigStore"/>, declared ONCE so that the SQL
/// the store actually runs and the assertions the tests actually make cannot drift apart.
///
/// <para>🔴 <b>Why this is a type and not a handful of <c>private const</c>s inside the store</b> (which
/// is how <c>ConnectorConfigStore</c> does it): the brief requires a test that catches TOMORROW's mistake,
/// not today's field list. That is only possible if the test can compare three things — the columns that
/// physically exist (from <c>PRAGMA table_info</c>), the columns somebody has CLASSIFIED as secret-bearing
/// or not, and the columns each PUBLIC read actually projects. Copying the projection strings into the
/// test would make the test pass while the store leaked; reading them from here means the test asserts on
/// the very strings that go into the <c>SELECT</c>.</para>
///
/// <para><b>Review round 1 (I1) — neither list the test walks is hand-maintained any more.</b> The table
/// list is discovered from <c>sqlite_master</c> rather than named by the test, and
/// <see cref="PublicProjections"/> is checked by reflection against every <c>*SummaryColumns</c> constant
/// declared here. Before that, the guarantee held only WITHIN the five tables the test happened to name: a
/// maintainer adding a whole new table (C-3's <c>webhook_headers</c>, a future <c>teams_config</c>), or a
/// second summary constant for an existing one, got a green suite carrying an unclassified column — the
/// brief's own strongest wording failing one level up from where the test was looking.</para>
/// </summary>
internal static class NotificationConfigSchema
{
    internal const string ChannelsTable = "notification_channels";
    internal const string WebhookTable = "webhook_config";
    internal const string SmtpTable = "smtp_config";
    internal const string RelayTable = "relay_config";
    internal const string SecretsTable = "notification_secrets";

    // ── The two projections per table. FULL is engine-internal; SUMMARY backs every public read. ──────
    // They are separate literals rather than one aliasing the other ON PURPOSE: if SmtpSummaryColumns
    // were declared as `= SmtpFullColumns`, a future secret column added to smtp_config would be pulled
    // into the public projection automatically, which is precisely the silent failure this whole
    // arrangement exists to prevent.
    //
    // 🔴 Every constant here whose name ends in "SummaryColumns" MUST appear in PublicProjections below —
    // enforced by reflection in the schema test, so adding a sixth table's summary and forgetting to
    // register it fails the suite instead of silently escaping the scan.

    // Review round 2 (M4) — there is deliberately NO ChannelFullColumns. One existed and was referenced
    // nowhere: no read returns a whole channel row (the per-channel getters project `enabled` and
    // `min_priority` explicitly and join their side table; ListAsync uses the summary). Left in place it
    // advertised `created_at` as readable when nothing reads it, which is a promise the type does not keep.
    internal const string ChannelSummaryColumns = "channel, instance, enabled, min_priority, updated_at";

    // Task C-3 added `auth_header_name` (schema v2) to BOTH projections. It is a header NAME, never a
    // value: see WebhookChannelConfig.AuthHeaderName for why that is not a credential, and
    // WebhookAuthHeader for why the value went into notification_secrets instead. This is exactly the
    // "named secret plus a non-secret header-name column" ladder entry C-2 predicted, and it needed no
    // table rebuild — which was the point of doing the `instance` re-key before any field data existed.
    internal const string WebhookFullColumns = "endpoint, url_fingerprint, label, auth_header_name";
    internal const string WebhookSummaryColumns = "endpoint, url_fingerprint, label, auth_header_name";

    internal const string SmtpFullColumns = "host, port, tls_mode, from_address, recipients_json, username";
    internal const string SmtpSummaryColumns = "host, port, tls_mode, from_address, recipients_json, username";

    internal const string RelayFullColumns = "machine_code, target_kind, target_name";
    internal const string RelaySummaryColumns = "machine_code, target_kind, target_name";

    /// <summary>🔴 The ONLY projection in this store that names the <c>secret</c> column — used by
    /// <see cref="NotificationConfigStore.GetSecretAsync"/> alone, which is engine-internal. This, not
    /// <c>webhook_config</c>, is where the FULL-versus-SUMMARY split now does its work: review round 1
    /// (I2) moved the webhook URL into <c>notification_secrets</c>, so no plaintext table holds a
    /// secret-bearing column any more.</summary>
    internal const string SecretFullColumns = "secret";

    /// <summary>What a PUBLIC read is allowed to know about a stored secret: that it exists, for which
    /// channel instance, and under what name. Never its value.</summary>
    internal const string SecretSummaryColumns = "channel, instance, name";

    /// <summary>
    /// Every physical column this store persists, and whether it carries material that must never reach a
    /// GET response, a log line or an audit row.
    ///
    /// <para>The test asserts this list is EXHAUSTIVE against the live schema in both directions — a
    /// column that exists but is not listed here fails, and a column listed here that no longer exists
    /// fails — with the table list discovered from <c>sqlite_master</c>, so a brand-new TABLE is covered
    /// too. A maintainer who adds <c>webhook_bearer_token</c> cannot get a green suite by ignoring this
    /// file; they are forced to state whether it is a secret, and if they say yes and also add it to a
    /// summary projection, the second assertion fails as well.</para>
    /// </summary>
    internal static readonly (string Table, string Column, bool SecretBearing)[] Classification =
    {
        (ChannelsTable, "channel", false),
        (ChannelsTable, "instance", false),
        (ChannelsTable, "enabled", false),
        (ChannelsTable, "min_priority", false),
        (ChannelsTable, "created_at", false),
        (ChannelsTable, "updated_at", false),

        (WebhookTable, "channel", false),
        (WebhookTable, "instance", false),
        // Review round 1 (I2) — `url` is GONE from this table; it is an encrypted row in
        // notification_secrets. What remains are two derived, non-secret facts ABOUT the destination.
        (WebhookTable, "endpoint", false),
        (WebhookTable, "url_fingerprint", false),
        (WebhookTable, "label", false),
        // Task C-3 (schema v2) — the NAME of the header that carries a static auth token. The token
        // itself is a DPAPI row in notification_secrets under NotificationSecretNames.WebhookAuthToken;
        // this column is what makes that partition structural rather than conventional.
        (WebhookTable, "auth_header_name", false),

        (SmtpTable, "channel", false),
        (SmtpTable, "instance", false),
        (SmtpTable, "host", false),
        (SmtpTable, "port", false),
        (SmtpTable, "tls_mode", false),
        (SmtpTable, "from_address", false),
        (SmtpTable, "recipients_json", false),
        (SmtpTable, "username", false),

        (RelayTable, "channel", false),
        (RelayTable, "instance", false),
        (RelayTable, "machine_code", false),
        (RelayTable, "target_kind", false),
        (RelayTable, "target_name", false),

        (SecretsTable, "channel", false),
        (SecretsTable, "instance", false),
        (SecretsTable, "name", false),
        // 🔴 The one secret-bearing column in the entire schema. Every credential this product stores —
        // the SMTP password, the webhook HMAC key, and (since I2) the webhook URL — is a DPAPI blob here.
        (SecretsTable, "secret", true),
        (SecretsTable, "updated_at", false),
    };

    /// <summary>Every projection reachable from a PUBLIC read — i.e. everything
    /// <see cref="NotificationConfigStore.ListAsync"/> touches. The test asserts none of these names a
    /// column classified secret-bearing above, AND that every <c>*SummaryColumns</c> constant declared in
    /// this class is registered here.</summary>
    internal static readonly (string Table, string Columns)[] PublicProjections =
    {
        (ChannelsTable, ChannelSummaryColumns),
        (WebhookTable, WebhookSummaryColumns),
        (SmtpTable, SmtpSummaryColumns),
        (RelayTable, RelaySummaryColumns),
        (SecretsTable, SecretSummaryColumns),
    };

    /// <summary>Splits one of the projection constants above into its individual column names.</summary>
    internal static string[] Split(string columns) =>
        columns.Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries);

    /// <summary>Qualifies a projection constant with a table alias for use inside a JOIN, so
    /// <see cref="NotificationConfigStore.ListAsync"/>'s SQL is BUILT FROM the same constants the test
    /// asserts on rather than restating them.</summary>
    internal static string Qualify(string alias, string columns) =>
        string.Join(", ", Split(columns).Select(column => $"{alias}.{column}"));
}

/// <summary>
/// Task C-2 (.superpowers/sdd/2026-07-30-dotC-alarm-notification-blueprint/task-2-brief.md) — where the
/// answer to "tell whom, how" lives, and the first place in this product that stores a THIRD-PARTY
/// credential.
///
/// <para>Raw <c>Microsoft.Data.Sqlite</c>, no ORM, its own file (<c>notifications.db</c>) under an explicit
/// directory / <c>ST4I_NOTIFICATIONS_DIR</c> / <see cref="DefaultRoot"/>, a <c>PRAGMA user_version</c>
/// migration ladder applied per-version inside a transaction, and short-lived WAL-mode connections — the
/// same shape as <see cref="AlarmStore"/> and <see cref="St4i.EngineApi.Fleet.ConnectorConfigStore"/>,
/// copied rather than reinvented.</para>
///
/// <para>🔴 <b>Never-throws, unlike <see cref="St4i.EngineApi.Fleet.ConnectorConfigStore"/>.</b> That
/// store is reached only from explicit HTTP mutations, so it is allowed to surface a 500. This one is
/// read from the alarm NOTIFICATION path — C-3..C-6 will ask it "should I deliver this?" and "what is the
/// SMTP password?" from inside <see cref="AlarmNotifier"/>'s drain loop, which sits behind
/// <see cref="AlarmStore"/>'s never-throws contract. A configuration read that threw would turn a
/// transient SQLite hiccup into a lost alarm, so every member here swallows and reports through
/// <c>logError</c> instead, returning "nothing configured" (which every caller must already handle).</para>
///
/// <para>🔴 <b>How a secret is kept out of a public read: structurally, not defensively.</b> After review
/// round 1 (I2) there is ONE rule and no exceptions to it — <b>every credential is a DPAPI blob in
/// <c>notification_secrets</c>, addressed by (channel, instance, NAME)</b>. No plaintext table holds a
/// secret-bearing column at all, so the read that backs C-7's endpoint cannot expose a credential by
/// widening a column list; it would have to add a JOIN to a table whose only value column is encrypted
/// ciphertext. And because a new secret is a new ROW rather than a new column, the ordinary way to add one
/// does not touch a projection at all — which is what makes a maintainer FALL INTO the safe path instead
/// of having to remember a rule. The surviving FULL/SUMMARY projection split lives on
/// <c>notification_secrets</c> itself (<see cref="NotificationConfigSchema.SecretFullColumns"/> versus
/// <see cref="NotificationConfigSchema.SecretSummaryColumns"/>): a public read learns that a credential
/// EXISTS and what it is called, never what it is.</para>
///
/// <para><b>Why five tables rather than one wide one</b> (the brief allows more than one, and warns
/// against contorting a single one to avoid a join): a single table would need eleven mostly-NULL columns,
/// and a NULL would then mean two different things — "this channel does not have that field" for a
/// webhook row's <c>smtp_host</c>, versus "unset" for a genuinely optional value. Splitting the
/// channel-specific facts into <c>webhook_config</c>/<c>smtp_config</c>/<c>relay_config</c> lets every one
/// of those columns be <c>NOT NULL</c>, so the DATABASE enforces "an SMTP configuration has a host", which
/// a sparse table structurally cannot. <see cref="NotificationChannel.LocalAnnunciation"/> gets no side
/// table because it genuinely has no configuration beyond the two universal fields — an empty table would
/// have been the contortion. <c>ON DELETE CASCADE</c> (with <c>PRAGMA foreign_keys=ON</c>, already in this
/// codebase's standard pragma set) makes removing a channel remove its configuration AND its secrets in
/// one statement, which a file-per-secret layout could not do atomically.</para>
///
/// <para>🔴 <b>Review round 1 (I4) — <c>instance</c> is part of every primary key from v1.</b> Nothing in
/// this build writes anything but <see cref="DefaultInstance"/>, and that is the point: it is free now and
/// expensive later. The original one-row-per-channel shape leaned on <c>ConnectorConfigStore</c>'s
/// precedent, but that precedent is weaker than it looks — its one-row-per-kind is FORCED by
/// <c>ConnectorRegistry.Register</c>, which can physically run only one connector per kind. No equivalent
/// structural limit exists for webhooks, and the blueprint's own target list (Slack/Teams/MES/Zabbix)
/// implies more than one. Worse, <c>notification_secrets</c> is keyed by the secret's PURPOSE, so a second
/// webhook's <c>webhook.signing_secret</c> would have collided with the first: supporting two webhooks
/// meant rebuilding THREE tables and re-keying every stored DPAPI blob, after field data existed. A column
/// with a default costs nothing today.</para>
/// </summary>
[SupportedOSPlatform("windows")]
public sealed class NotificationConfigStore
{
    /// <summary>Directory override — same idiom as <c>ST4I_ALARMS_DIR</c>/<c>ST4I_ASSETS_DIR</c>.</summary>
    public const string EnvVarDir = "ST4I_NOTIFICATIONS_DIR";

    /// <summary>The instance key every row this build writes uses — see this class's own doc comment for
    /// why the column exists before anything needs it.</summary>
    public const string DefaultInstance = "default";

    /// <summary>Upper bound on <see cref="WebhookChannelConfig.Label"/>. Generous — it is a note to the
    /// next operator, not an identifier — but bounded, because an unbounded free-text column in a
    /// configuration store is how a log line or a UI eventually gets a surprise.</summary>
    public const int MaxLabelLength = 200;

    public string DbPath { get; }

    /// <summary>The resolved directory holding <c>notifications.db</c>. Public because it IS the
    /// confidentiality boundary against another local account (see
    /// <see cref="NotificationSecretProtector"/>) — an operator diagnosing permissions needs to find it.</summary>
    public string RootDirectory { get; }

    private readonly Action<Exception, string>? _logError;

    private static readonly string[] OpenPragmas =
    {
        "PRAGMA journal_mode=WAL;",
        "PRAGMA synchronous=NORMAL;",
        "PRAGMA busy_timeout=5000;",
        // Load-bearing here, not boilerplate: DeleteAsync relies on ON DELETE CASCADE to clear a
        // channel's side-table row AND its secrets, and SetSecretAsync relies on the same constraint to
        // refuse a secret for a channel instance that was never configured.
        "PRAGMA foreign_keys=ON;",
    };

    // Ordered migration ladder — future schema changes append a new (Version, Statements) entry here.
    //
    // 🔴 Review round 1 (I2/I4) reshaped version 1 IN PLACE rather than adding a version 2. That is
    // normally the wrong thing to do, and is justified here by one fact: this schema has never shipped. It
    // was introduced one commit earlier on an unmerged feature branch, no released build has ever created
    // this database, and every test points at a throwaway temp directory. Adding a v2 that DROPped and
    // recreated three tables would have left a destructive migration in the ladder forever, as precedent,
    // to handle a state that cannot exist. Once this branch merges that argument expires, and every
    // further change is an append.
    //
    // Review round 2 (M5) — the one machine on which that reasoning does NOT hold, and the recovery.
    // EnsureSchema only applies versions ABOVE the stored user_version, and the reshaped v1 is still
    // version 1. So a notifications.db created by the PREVIOUS commit (686140f1) is left silently
    // un-migrated: it lacks the `instance` column, every query against it fails, and because this store is
    // never-throws that surfaces as "nothing configured" rather than as an error. Unreachable for any
    // shipped build — no released version ever created this file — but reachable on a dev or reviewer
    // machine that booted the host at that exact commit.
    //   Recovery: delete %ProgramData%\ST4I\sim\notifications\notifications.db (or whatever
    //   ST4I_NOTIFICATIONS_DIR points at) and restart. There is nothing to preserve — no build that could
    //   have written that file ever shipped, so any content is a developer's own test data.
    private static readonly (int Version, string[] Statements)[] Migrations =
    {
        (1, new[]
        {
            $"""
            CREATE TABLE IF NOT EXISTS {NotificationConfigSchema.ChannelsTable} (
              channel TEXT NOT NULL,
              instance TEXT NOT NULL DEFAULT 'default',
              enabled INTEGER NOT NULL,
              min_priority TEXT NOT NULL,
              created_at TEXT NOT NULL,
              updated_at TEXT NOT NULL,
              PRIMARY KEY (channel, instance));
            """,
            $"""
            CREATE TABLE IF NOT EXISTS {NotificationConfigSchema.WebhookTable} (
              channel TEXT NOT NULL,
              instance TEXT NOT NULL DEFAULT 'default',
              endpoint TEXT NOT NULL,
              url_fingerprint TEXT NOT NULL,
              label TEXT NULL,
              PRIMARY KEY (channel, instance),
              FOREIGN KEY (channel, instance)
                REFERENCES {NotificationConfigSchema.ChannelsTable}(channel, instance) ON DELETE CASCADE);
            """,
            $"""
            CREATE TABLE IF NOT EXISTS {NotificationConfigSchema.SmtpTable} (
              channel TEXT NOT NULL,
              instance TEXT NOT NULL DEFAULT 'default',
              host TEXT NOT NULL,
              port INTEGER NOT NULL,
              tls_mode TEXT NOT NULL,
              from_address TEXT NOT NULL,
              recipients_json TEXT NOT NULL,
              username TEXT NULL,
              PRIMARY KEY (channel, instance),
              FOREIGN KEY (channel, instance)
                REFERENCES {NotificationConfigSchema.ChannelsTable}(channel, instance) ON DELETE CASCADE);
            """,
            $"""
            CREATE TABLE IF NOT EXISTS {NotificationConfigSchema.RelayTable} (
              channel TEXT NOT NULL,
              instance TEXT NOT NULL DEFAULT 'default',
              machine_code TEXT NOT NULL,
              target_kind TEXT NOT NULL,
              target_name TEXT NOT NULL,
              PRIMARY KEY (channel, instance),
              FOREIGN KEY (channel, instance)
                REFERENCES {NotificationConfigSchema.ChannelsTable}(channel, instance) ON DELETE CASCADE);
            """,
            // The secret's VALUE column is a BLOB: ProtectedData.Protect returns bytes, and round-tripping
            // them through TEXT would mean a base64 step whose only effect is to make the ciphertext look
            // like something worth reading.
            $"""
            CREATE TABLE IF NOT EXISTS {NotificationConfigSchema.SecretsTable} (
              channel TEXT NOT NULL,
              instance TEXT NOT NULL DEFAULT 'default',
              name TEXT NOT NULL,
              secret BLOB NOT NULL,
              updated_at TEXT NOT NULL,
              PRIMARY KEY (channel, instance, name),
              FOREIGN KEY (channel, instance)
                REFERENCES {NotificationConfigSchema.ChannelsTable}(channel, instance) ON DELETE CASCADE);
            """,
        }),

        // 🔴 Task C-3 — the FIRST genuine append to this ladder, and the shape C-2 predicted for it.
        // C-2's review named the sharpest gap it was leaving: a generic MES or Zabbix receiver that
        // authenticates by a static bearer token could not be configured at all, and an HMAC signature does
        // not help it because its auth layer runs before anything that could verify one. C-2 also designed
        // the answer — a NAMED SECRET plus a NON-SECRET header-name column — and noted it would need no
        // rebuild. It did not: one nullable ALTER, because the `instance` re-key was done while the schema
        // had never shipped.
        //
        // Deliberately a v2 append rather than a v1 reshape. v1's in-place reshape was justified only by
        // "no released build has ever created this database"; that argument is about the state of the
        // world, not a licence, and appending is what the ladder is for.
        (2, new[]
        {
            $"ALTER TABLE {NotificationConfigSchema.WebhookTable} ADD COLUMN auth_header_name TEXT NULL;",
        }),
    };

    /// <param name="directory">Explicit directory override (tests), or <see langword="null"/> to resolve
    /// via <see cref="ResolveRoot"/>.</param>
    /// <param name="logError">Where a swallowed failure is reported. Optional — a <see langword="null"/>
    /// logger means the failure is silently absorbed (still never thrown). 🔴 Nothing passed to this
    /// callback ever contains a secret: see <see cref="SetSecretAsync"/>/<see cref="GetSecretAsync"/>,
    /// which report by channel, instance and NAME only.</param>
    public NotificationConfigStore(string? directory = null, Action<Exception, string>? logError = null)
    {
        _logError = logError;

        RootDirectory = ResolveRoot(directory);
        Directory.CreateDirectory(RootDirectory);

        // Applied here AND, unconditionally, inside UpsertSecretAsync — the ONE method every credential
        // write funnels through (review round 2, F1: it used to be applied by SetSecretAsync, which
        // SaveWebhookAsync bypassed). Self-healing, best-effort, never throws — see SecurityDirAcl.Apply.
        // Same unconditional-on-every-save posture as CredentialStore, and for the same reason: under
        // DataProtectionScope.LocalMachine this ACL is the confidentiality boundary against another LOCAL
        // account, so an install upgraded from a build that predates this store must get locked down on its
        // next write rather than only on a fresh install.
        SecurityDirAcl.Apply(RootDirectory, message => Console.Error.WriteLine($"[notificationconfig] {message}"));

        DbPath = Path.Combine(RootDirectory, "notifications.db");
        EnsureSchema();
    }

    /// <summary>The default root: <c>%ProgramData%\ST4I\sim\notifications</c> — a SIBLING of
    /// <c>...\sim\alarms</c>/<c>...\sim\creds</c>/<c>...\sim\security</c>, never the same directory.</summary>
    public static string DefaultRoot() => Path.Combine(
        Environment.GetFolderPath(Environment.SpecialFolder.CommonApplicationData), "ST4I", "sim", "notifications");

    /// <summary>Resolves the effective directory: <paramref name="directory"/> if given, else
    /// <see cref="EnvVarDir"/> if set, else <see cref="DefaultRoot"/>. Pure path arithmetic.</summary>
    public static string ResolveRoot(string? directory = null)
    {
        if (!string.IsNullOrWhiteSpace(directory)) return directory;
        var env = Environment.GetEnvironmentVariable(EnvVarDir);
        return string.IsNullOrWhiteSpace(env) ? DefaultRoot() : env;
    }

    // ─────────────────────────────────────────────────────────────────────
    // Schema / connections — copied line-for-line from AlarmStore.
    // ─────────────────────────────────────────────────────────────────────

    private void EnsureSchema()
    {
        using var connection = OpenConnection();
        var currentVersion = GetUserVersion(connection);

        foreach (var (version, statements) in Migrations)
        {
            if (version <= currentVersion) continue;

            using var transaction = connection.BeginTransaction();
            foreach (var statement in statements)
            {
                using var cmd = connection.CreateCommand();
                cmd.Transaction = transaction;
                cmd.CommandText = statement;
                cmd.ExecuteNonQuery();
            }

            using (var pragmaCmd = connection.CreateCommand())
            {
                pragmaCmd.Transaction = transaction;
                // PRAGMA user_version does not support bind parameters; `version` always comes from this
                // fixed, code-defined migration ladder above (never external/user input).
                pragmaCmd.CommandText = $"PRAGMA user_version = {version};";
                pragmaCmd.ExecuteNonQuery();
            }

            transaction.Commit();
            currentVersion = version;
        }
    }

    private static long GetUserVersion(SqliteConnection connection)
    {
        using var cmd = connection.CreateCommand();
        cmd.CommandText = "PRAGMA user_version;";
        var result = cmd.ExecuteScalar();
        return result is null ? 0 : Convert.ToInt64(result, CultureInfo.InvariantCulture);
    }

    private SqliteConnection OpenConnection()
    {
        var connection = new SqliteConnection($"Data Source={DbPath}");
        connection.Open();
        ApplyPragmas(connection);
        return connection;
    }

    private async Task<SqliteConnection> OpenConnectionAsync(CancellationToken ct)
    {
        var connection = new SqliteConnection($"Data Source={DbPath}");
        await connection.OpenAsync(ct).ConfigureAwait(false);
        await ApplyPragmasAsync(connection, ct).ConfigureAwait(false);
        return connection;
    }

    private static void ApplyPragmas(SqliteConnection connection)
    {
        foreach (var pragma in OpenPragmas)
        {
            using var cmd = connection.CreateCommand();
            cmd.CommandText = pragma;
            cmd.ExecuteNonQuery();
        }
    }

    private static async Task ApplyPragmasAsync(SqliteConnection connection, CancellationToken ct)
    {
        foreach (var pragma in OpenPragmas)
        {
            using var cmd = connection.CreateCommand();
            cmd.CommandText = pragma;
            await cmd.ExecuteNonQueryAsync(ct).ConfigureAwait(false);
        }
    }

    // ─────────────────────────────────────────────────────────────────────
    // Writes — one channel row plus (for three of the four) one side-table row, in one transaction.
    // ─────────────────────────────────────────────────────────────────────

    /// <summary>
    /// Saves the webhook channel. Returns <see langword="false"/> — never throws — if
    /// <paramref name="url"/> is not an absolute <c>http</c>/<c>https</c> URL, because
    /// <see cref="WebhookChannelConfig.Endpoint"/> and <see cref="WebhookChannelConfig.UrlFingerprint"/>
    /// are derived from it and a configuration whose credential-free display values could not be computed
    /// must not be stored.
    ///
    /// <para>🔴 The URL is encrypted and written to <c>notification_secrets</c> INSIDE the same
    /// transaction as the endpoint/fingerprint columns (review round 1, I2). One transaction is what stops
    /// a half-saved webhook — a destination with no derived display values, or display values pointing at
    /// a destination that was never stored — from ever existing.</para>
    /// </summary>
    /// <returns><see langword="true"/> if persisted. 🔴 Deliberately a <see cref="bool"/> rather than the
    /// saved summary (which is what <c>ConnectorConfigStore.SaveAsync</c> returns): a hand-built return
    /// DTO is precisely how a secret-bearing field reaches a response body, so C-7's endpoint is made to
    /// read back through <see cref="ListAsync"/> — the one credential-free projection — instead of being
    /// handed a shape this method assembled itself.</returns>
    /// <param name="authHeaderName">🔴 Task C-3 — the name of the header carrying
    /// <see cref="NotificationSecretNames.WebhookAuthToken"/>, for a receiver that authenticates by a
    /// static token. Validated by <see cref="WebhookAuthHeader.IsValidName"/>, which refuses the headers
    /// the webhook channel sets itself: a configuration able to name <c>X-ST4I-Signature</c> could
    /// OVERWRITE THE SIGNATURE, which is the most damaging thing a non-secret field could be allowed to
    /// do. Rejected here rather than skipped at send time, so the bad configuration cannot be stored and
    /// then quietly ignored.</param>
    public Task<bool> SaveWebhookAsync(
        bool enabled, AlarmPriority minPriority, string url, string? label = null,
        string? authHeaderName = null, string instance = DefaultInstance, CancellationToken ct = default) =>
        SaveAsync(NotificationChannel.Webhook, instance, enabled, minPriority, "webhook",
            async (connection, transaction, nowIso) =>
        {
            if (string.IsNullOrWhiteSpace(url) ||
                !Uri.TryCreate(url, UriKind.Absolute, out var parsed) ||
                (parsed.Scheme != Uri.UriSchemeHttp && parsed.Scheme != Uri.UriSchemeHttps))
            {
                // Note what is NOT in this message: the URL. It failed to parse, but "failed to parse" is
                // a claim about a value that may still be a working Slack capability URL with a typo'd
                // scheme, and log files outlive configurations.
                throw new ArgumentException("A webhook URL must be an absolute http:// or https:// URL.", nameof(url));
            }

            if (label is { Length: > MaxLabelLength })
            {
                throw new ArgumentException($"A webhook label may be at most {MaxLabelLength} characters.", nameof(label));
            }

            if (authHeaderName is not null && !WebhookAuthHeader.IsValidName(authHeaderName, out var reason))
            {
                // `reason` names the header only; the token lives in notification_secrets and is not in
                // scope here at all.
                throw new ArgumentException(reason, nameof(authHeaderName));
            }

            using (var cmd = connection.CreateCommand())
            {
                cmd.Transaction = transaction;
                cmd.CommandText = $"""
                    INSERT INTO {NotificationConfigSchema.WebhookTable}
                        (channel, instance, endpoint, url_fingerprint, label, auth_header_name)
                    VALUES (@channel, @instance, @endpoint, @fingerprint, @label, @auth_header_name)
                    ON CONFLICT(channel, instance) DO UPDATE SET
                        endpoint = excluded.endpoint,
                        url_fingerprint = excluded.url_fingerprint,
                        label = excluded.label,
                        auth_header_name = excluded.auth_header_name;
                    """;
                cmd.Parameters.AddWithValue("@channel", nameof(NotificationChannel.Webhook));
                cmd.Parameters.AddWithValue("@instance", instance);
                cmd.Parameters.AddWithValue("@endpoint", DeriveEndpoint(parsed));
                cmd.Parameters.AddWithValue("@fingerprint", ComputeUrlFingerprint(url));
                cmd.Parameters.AddWithValue("@label", (object?)label ?? DBNull.Value);
                cmd.Parameters.AddWithValue("@auth_header_name", (object?)authHeaderName ?? DBNull.Value);
                await cmd.ExecuteNonQueryAsync(ct).ConfigureAwait(false);
            }

            await UpsertSecretAsync(
                connection, transaction, NotificationChannel.Webhook, instance,
                NotificationSecretNames.WebhookUrl, url, nowIso, ct).ConfigureAwait(false);
        }, ct);

    /// <summary>Saves the SMTP channel. The PASSWORD is not a parameter here — it is set separately via
    /// <see cref="SetSecretAsync"/> under <see cref="NotificationSecretNames.SmtpPassword"/>, so that the
    /// only code path capable of handling a plaintext credential is the one that encrypts it.</summary>
    public Task<bool> SaveSmtpAsync(
        bool enabled, AlarmPriority minPriority, string host, int port, SmtpTlsMode tls,
        string fromAddress, IReadOnlyList<string> recipients, string? username,
        string instance = DefaultInstance, CancellationToken ct = default) =>
        SaveAsync(NotificationChannel.Smtp, instance, enabled, minPriority, "SMTP",
            async (connection, transaction, _) =>
        {
            ArgumentException.ThrowIfNullOrWhiteSpace(host);
            ArgumentException.ThrowIfNullOrWhiteSpace(fromAddress);
            ArgumentNullException.ThrowIfNull(recipients);
            if (port is <= 0 or > 65535) throw new ArgumentOutOfRangeException(nameof(port), port, "SMTP port out of range.");
            if (recipients.Count == 0) throw new ArgumentException("An SMTP channel needs at least one recipient.", nameof(recipients));

            using var cmd = connection.CreateCommand();
            cmd.Transaction = transaction;
            cmd.CommandText = $"""
                INSERT INTO {NotificationConfigSchema.SmtpTable}
                    (channel, instance, host, port, tls_mode, from_address, recipients_json, username)
                VALUES (@channel, @instance, @host, @port, @tls, @from, @recipients, @username)
                ON CONFLICT(channel, instance) DO UPDATE SET
                    host = excluded.host, port = excluded.port, tls_mode = excluded.tls_mode,
                    from_address = excluded.from_address, recipients_json = excluded.recipients_json,
                    username = excluded.username;
                """;
            cmd.Parameters.AddWithValue("@channel", nameof(NotificationChannel.Smtp));
            cmd.Parameters.AddWithValue("@instance", instance);
            cmd.Parameters.AddWithValue("@host", host);
            cmd.Parameters.AddWithValue("@port", port);
            cmd.Parameters.AddWithValue("@tls", tls.ToString());
            cmd.Parameters.AddWithValue("@from", fromAddress);
            cmd.Parameters.AddWithValue("@recipients", JsonSerializer.Serialize(recipients));
            cmd.Parameters.AddWithValue("@username", (object?)username ?? DBNull.Value);
            await cmd.ExecuteNonQueryAsync(ct).ConfigureAwait(false);
        }, ct);

    /// <summary>Saves the local-annunciation channel — on/off and a threshold, nothing else. No side
    /// table: see this class's own doc comment.</summary>
    public Task<bool> SaveLocalAnnunciationAsync(
        bool enabled, AlarmPriority minPriority, string instance = DefaultInstance,
        CancellationToken ct = default) =>
        SaveAsync(NotificationChannel.LocalAnnunciation, instance, enabled, minPriority,
            "local annunciation", null, ct);

    /// <summary>🔴 Saves the relay channel — see <see cref="RelayChannelConfig"/> for what is stored, what
    /// is deliberately NOT (an address; the energise/de-energise values), and why.</summary>
    public Task<bool> SaveRelayAsync(
        bool enabled, AlarmPriority minPriority, string machineCode, RelayTargetKind targetKind,
        string targetName, string instance = DefaultInstance, CancellationToken ct = default) =>
        SaveAsync(NotificationChannel.Relay, instance, enabled, minPriority, "relay",
            async (connection, transaction, _) =>
        {
            ArgumentException.ThrowIfNullOrWhiteSpace(machineCode);
            ArgumentException.ThrowIfNullOrWhiteSpace(targetName);

            using var cmd = connection.CreateCommand();
            cmd.Transaction = transaction;
            cmd.CommandText = $"""
                INSERT INTO {NotificationConfigSchema.RelayTable}
                    (channel, instance, machine_code, target_kind, target_name)
                VALUES (@channel, @instance, @machine_code, @target_kind, @target_name)
                ON CONFLICT(channel, instance) DO UPDATE SET
                    machine_code = excluded.machine_code, target_kind = excluded.target_kind,
                    target_name = excluded.target_name;
                """;
            cmd.Parameters.AddWithValue("@channel", nameof(NotificationChannel.Relay));
            cmd.Parameters.AddWithValue("@instance", instance);
            cmd.Parameters.AddWithValue("@machine_code", machineCode);
            cmd.Parameters.AddWithValue("@target_kind", targetKind.ToString());
            cmd.Parameters.AddWithValue("@target_name", targetName);
            await cmd.ExecuteNonQueryAsync(ct).ConfigureAwait(false);
        }, ct);

    /// <summary>Shared upsert: the <c>notification_channels</c> row plus an optional side-table row, in
    /// ONE transaction, so a channel can never end up enabled with no configuration behind it.
    /// <c>created_at</c> is omitted from the <c>DO UPDATE</c> clause (SQLite leaves an omitted column as
    /// it was), so re-saving a channel preserves when it was first configured.</summary>
    private async Task<bool> SaveAsync(
        NotificationChannel channel, string instance, bool enabled, AlarmPriority minPriority, string label,
        Func<SqliteConnection, SqliteTransaction, string, Task>? saveDetail, CancellationToken ct)
    {
        try
        {
            ArgumentException.ThrowIfNullOrWhiteSpace(instance);

            var nowIso = ToIso(DateTimeOffset.UtcNow);

            using var connection = await OpenConnectionAsync(ct).ConfigureAwait(false);
            using var transaction = connection.BeginTransaction();

            using (var cmd = connection.CreateCommand())
            {
                cmd.Transaction = transaction;
                cmd.CommandText = $"""
                    INSERT INTO {NotificationConfigSchema.ChannelsTable}
                        (channel, instance, enabled, min_priority, created_at, updated_at)
                    VALUES (@channel, @instance, @enabled, @min_priority, @now, @now)
                    ON CONFLICT(channel, instance) DO UPDATE SET
                        enabled = excluded.enabled,
                        min_priority = excluded.min_priority,
                        updated_at = excluded.updated_at;
                    """;
                cmd.Parameters.AddWithValue("@channel", channel.ToString());
                cmd.Parameters.AddWithValue("@instance", instance);
                cmd.Parameters.AddWithValue("@enabled", enabled ? 1 : 0);
                cmd.Parameters.AddWithValue("@min_priority", minPriority.ToString());
                cmd.Parameters.AddWithValue("@now", nowIso);
                await cmd.ExecuteNonQueryAsync(ct).ConfigureAwait(false);
            }

            if (saveDetail is not null) await saveDetail(connection, transaction, nowIso).ConfigureAwait(false);

            transaction.Commit();
            return true;
        }
        catch (Exception ex)
        {
            _logError?.Invoke(ex, $"Saving the {label} notification channel ('{instance}') failed — it was NOT persisted.");
            return false;
        }
    }

    /// <summary>Removes a channel instance's configuration entirely. <c>ON DELETE CASCADE</c> takes its
    /// side-table row and every one of its stored secrets with it, in the same statement — so "delete the
    /// channel" can never leave an orphaned credential behind.</summary>
    public async Task<bool> DeleteAsync(
        NotificationChannel channel, string instance = DefaultInstance, CancellationToken ct = default)
    {
        try
        {
            using var connection = await OpenConnectionAsync(ct).ConfigureAwait(false);
            using var cmd = connection.CreateCommand();
            cmd.CommandText =
                $"DELETE FROM {NotificationConfigSchema.ChannelsTable} WHERE channel = @channel AND instance = @instance;";
            cmd.Parameters.AddWithValue("@channel", channel.ToString());
            cmd.Parameters.AddWithValue("@instance", instance);
            return await cmd.ExecuteNonQueryAsync(ct).ConfigureAwait(false) > 0;
        }
        catch (Exception ex)
        {
            _logError?.Invoke(ex, $"Deleting the {channel} notification channel ('{instance}') failed.");
            return false;
        }
    }

    // ─────────────────────────────────────────────────────────────────────
    // Secrets — the ONLY code paths that touch plaintext or the `secret` column.
    // ─────────────────────────────────────────────────────────────────────

    /// <summary>
    /// DPAPI-protects <paramref name="plaintext"/> and stores it under (channel, instance, name),
    /// re-applying the directory ACL first (see <see cref="NotificationSecretProtector"/> for why that ACL
    /// covers another local account while DPAPI's machine-binding covers the file leaving the machine).
    ///
    /// <para>Requires the channel instance to have been saved already — the foreign key refuses a secret
    /// for a channel that does not exist, so an orphaned credential for a channel nobody configured is not
    /// a state this store can reach.</para>
    /// </summary>
    /// <returns><see langword="false"/> if it could not be stored. 🔴 Neither the return value, the
    /// <c>logError</c> message, nor any exception raised inside this method contains
    /// <paramref name="plaintext"/>: the failure is reported by channel, instance and secret NAME only.</returns>
    public async Task<bool> SetSecretAsync(
        NotificationChannel channel, string name, string plaintext,
        string instance = DefaultInstance, CancellationToken ct = default)
    {
        try
        {
            ArgumentException.ThrowIfNullOrWhiteSpace(name);
            ArgumentException.ThrowIfNullOrEmpty(plaintext);

            // The ACL is applied inside UpsertSecretAsync — the choke point EVERY credential write passes
            // through, including SaveWebhookAsync's. See that method's own doc comment (review round 2, F1).
            using var connection = await OpenConnectionAsync(ct).ConfigureAwait(false);
            using var transaction = connection.BeginTransaction();
            await UpsertSecretAsync(
                connection, transaction, channel, instance, name, plaintext,
                ToIso(DateTimeOffset.UtcNow), ct).ConfigureAwait(false);
            transaction.Commit();
            return true;
        }
        catch (Exception ex)
        {
            _logError?.Invoke(ex, $"Storing the '{name}' secret for the {channel} notification channel ('{instance}') failed — it was NOT saved.");
            return false;
        }
    }

    /// <summary>
    /// The single place a plaintext secret becomes ciphertext and reaches the database — shared by
    /// <see cref="SetSecretAsync"/> and by <see cref="SaveWebhookAsync"/>, which needs it to run inside its
    /// own transaction so the URL and its derived display columns commit together.
    ///
    /// <para>🔴 <b>Review round 2 (F1) — the ACL is applied HERE, not at the call sites, and this method is
    /// an instance method for that reason alone.</b> It was <see langword="static"/>, with
    /// <see cref="SetSecretAsync"/> applying the ACL itself; round 1 then added
    /// <see cref="SaveWebhookAsync"/> as a second writer of credential material that called straight in
    /// here — so the ONE new credential path was the one path that skipped the lock-down, while the
    /// constructor's comment claimed the ACL ran on every secret write. Applying it at the choke point
    /// every credential must pass through makes that claim true by construction instead of by two call
    /// sites both remembering, and a third writer added later cannot reintroduce the gap.</para>
    /// </summary>
    private async Task UpsertSecretAsync(
        SqliteConnection connection, SqliteTransaction transaction, NotificationChannel channel,
        string instance, string name, string plaintext, string nowIso, CancellationToken ct)
    {
        // Best-effort, never throws (see SecurityDirAcl.Apply). Runs before the write rather than after, so
        // a directory created since the last boot is locked down BEFORE ciphertext lands in it.
        SecurityDirAcl.Apply(RootDirectory, message => Console.Error.WriteLine($"[notificationconfig] {message}"));

        var protectedBytes = NotificationSecretProtector.Protect(plaintext);

        using var cmd = connection.CreateCommand();
        cmd.Transaction = transaction;
        cmd.CommandText = $"""
            INSERT INTO {NotificationConfigSchema.SecretsTable} (channel, instance, name, secret, updated_at)
            VALUES (@channel, @instance, @name, @secret, @now)
            ON CONFLICT(channel, instance, name) DO UPDATE SET
                secret = excluded.secret, updated_at = excluded.updated_at;
            """;
        cmd.Parameters.AddWithValue("@channel", channel.ToString());
        cmd.Parameters.AddWithValue("@instance", instance);
        cmd.Parameters.AddWithValue("@name", name);
        cmd.Parameters.AddWithValue("@secret", protectedBytes);
        cmd.Parameters.AddWithValue("@now", nowIso);
        await cmd.ExecuteNonQueryAsync(ct).ConfigureAwait(false);
    }

    /// <summary>
    /// The stored secret, or <see langword="null"/> if there is none — ENGINE-INTERNAL ONLY (C-3's webhook
    /// poster and signer, C-4's SMTP client). Never routed to an HTTP response; the public read
    /// (<see cref="ListAsync"/>) reports only whether a secret EXISTS.
    ///
    /// <para>A blob that cannot be unprotected — corrupt, written under different entropy, or copied from
    /// another machine — reads as <see langword="null"/> ("no stored secret"), never as an exception. See
    /// <see cref="NotificationSecretProtector.TryUnprotect"/>.</para>
    /// </summary>
    public async Task<string?> GetSecretAsync(
        NotificationChannel channel, string name, string instance = DefaultInstance,
        CancellationToken ct = default)
    {
        try
        {
            using var connection = await OpenConnectionAsync(ct).ConfigureAwait(false);
            return await ReadSecretAsync(connection, channel, instance, name, ct).ConfigureAwait(false);
        }
        catch (Exception ex)
        {
            _logError?.Invoke(ex, $"Reading the '{name}' secret for the {channel} notification channel ('{instance}') failed — treating it as unset.");
            return null;
        }
    }

    private static async Task<string?> ReadSecretAsync(
        SqliteConnection connection, NotificationChannel channel, string instance, string name,
        CancellationToken ct)
    {
        using var cmd = connection.CreateCommand();
        cmd.CommandText = $"""
            SELECT {NotificationConfigSchema.SecretFullColumns} FROM {NotificationConfigSchema.SecretsTable}
            WHERE channel = @channel AND instance = @instance AND name = @name;
            """;
        cmd.Parameters.AddWithValue("@channel", channel.ToString());
        cmd.Parameters.AddWithValue("@instance", instance);
        cmd.Parameters.AddWithValue("@name", name);

        using var reader = await cmd.ExecuteReaderAsync(ct).ConfigureAwait(false);
        if (!await reader.ReadAsync(ct).ConfigureAwait(false)) return null;
        return NotificationSecretProtector.TryUnprotect((byte[])reader["secret"]);
    }

    /// <summary>Removes one stored secret. Returns whether a row was actually removed.</summary>
    public async Task<bool> DeleteSecretAsync(
        NotificationChannel channel, string name, string instance = DefaultInstance,
        CancellationToken ct = default)
    {
        try
        {
            using var connection = await OpenConnectionAsync(ct).ConfigureAwait(false);
            using var cmd = connection.CreateCommand();
            cmd.CommandText = $"""
                DELETE FROM {NotificationConfigSchema.SecretsTable}
                WHERE channel = @channel AND instance = @instance AND name = @name;
                """;
            cmd.Parameters.AddWithValue("@channel", channel.ToString());
            cmd.Parameters.AddWithValue("@instance", instance);
            cmd.Parameters.AddWithValue("@name", name);
            return await cmd.ExecuteNonQueryAsync(ct).ConfigureAwait(false) > 0;
        }
        catch (Exception ex)
        {
            _logError?.Invoke(ex, $"Deleting the '{name}' secret for the {channel} notification channel ('{instance}') failed.");
            return false;
        }
    }

    // ─────────────────────────────────────────────────────────────────────
    // Engine-internal FULL reads — one per channel. Never routed to an HTTP response.
    // ─────────────────────────────────────────────────────────────────────

    /// <summary>
    /// The full webhook configuration INCLUDING the decrypted destination URL — C-3 only.
    ///
    /// <para>Written out rather than routed through the shared <see cref="GetAsync"/> helper because the
    /// URL is no longer a column of <c>webhook_config</c> (review round 1, I2): it is a DPAPI blob in
    /// <c>notification_secrets</c>, read here on the same connection.
    /// <see cref="WebhookChannelConfig.Url"/> is <see langword="null"/> when that blob is missing or
    /// unreadable — a configured channel that cannot actually post.</para>
    /// </summary>
    public async Task<WebhookChannelConfig?> GetWebhookAsync(
        string instance = DefaultInstance, CancellationToken ct = default)
    {
        try
        {
            using var connection = await OpenConnectionAsync(ct).ConfigureAwait(false);

            bool enabled;
            AlarmPriority minPriority;
            string endpoint, fingerprint;
            string? label, authHeaderName;

            using (var cmd = connection.CreateCommand())
            {
                cmd.CommandText = $"""
                    SELECT c.enabled, c.min_priority,
                           {NotificationConfigSchema.Qualify("d", NotificationConfigSchema.WebhookFullColumns)}
                    FROM {NotificationConfigSchema.ChannelsTable} c
                    JOIN {NotificationConfigSchema.WebhookTable} d
                      ON d.channel = c.channel AND d.instance = c.instance
                    WHERE c.channel = @channel AND c.instance = @instance;
                    """;
                cmd.Parameters.AddWithValue("@channel", nameof(NotificationChannel.Webhook));
                cmd.Parameters.AddWithValue("@instance", instance);

                using var reader = await cmd.ExecuteReaderAsync(ct).ConfigureAwait(false);
                if (!await reader.ReadAsync(ct).ConfigureAwait(false)) return null;

                enabled = ReadEnabled(reader);
                minPriority = ReadMinPriority(reader);
                endpoint = reader.GetString(reader.GetOrdinal("endpoint"));
                fingerprint = reader.GetString(reader.GetOrdinal("url_fingerprint"));
                label = GetNullableString(reader, "label");
                authHeaderName = GetNullableString(reader, "auth_header_name");
            }

            var url = await ReadSecretAsync(
                connection, NotificationChannel.Webhook, instance,
                NotificationSecretNames.WebhookUrl, ct).ConfigureAwait(false);

            return new WebhookChannelConfig(
                enabled, minPriority, instance, url, endpoint, fingerprint, label, authHeaderName);
        }
        catch (Exception ex)
        {
            _logError?.Invoke(ex, $"Reading the Webhook notification channel ('{instance}') failed — treating it as unconfigured.");
            return null;
        }
    }

    /// <summary>The full SMTP configuration — C-4 only. The password is NOT part of this record; fetch it
    /// with <see cref="GetSecretAsync"/> under <see cref="NotificationSecretNames.SmtpPassword"/>.</summary>
    public Task<SmtpChannelConfig?> GetSmtpAsync(
        string instance = DefaultInstance, CancellationToken ct = default) =>
        GetAsync(NotificationChannel.Smtp, instance, NotificationConfigSchema.SmtpTable,
            NotificationConfigSchema.SmtpFullColumns,
            (enabled, min, reader) => new SmtpChannelConfig(
                enabled, min, instance,
                reader.GetString(reader.GetOrdinal("host")),
                reader.GetInt32(reader.GetOrdinal("port")),
                Enum.Parse<SmtpTlsMode>(reader.GetString(reader.GetOrdinal("tls_mode"))),
                reader.GetString(reader.GetOrdinal("from_address")),
                ParseRecipients(reader.GetString(reader.GetOrdinal("recipients_json"))),
                GetNullableString(reader, "username")), ct);

    /// <summary>🔴 The full relay configuration — C-6 only.</summary>
    public Task<RelayChannelConfig?> GetRelayAsync(
        string instance = DefaultInstance, CancellationToken ct = default) =>
        GetAsync(NotificationChannel.Relay, instance, NotificationConfigSchema.RelayTable,
            NotificationConfigSchema.RelayFullColumns,
            (enabled, min, reader) => new RelayChannelConfig(
                enabled, min, instance,
                reader.GetString(reader.GetOrdinal("machine_code")),
                Enum.Parse<RelayTargetKind>(reader.GetString(reader.GetOrdinal("target_kind"))),
                reader.GetString(reader.GetOrdinal("target_name"))), ct);

    /// <summary>The local-annunciation configuration — C-5 only. No side table, so this reads the channel
    /// row alone.</summary>
    public async Task<LocalAnnunciationChannelConfig?> GetLocalAnnunciationAsync(
        string instance = DefaultInstance, CancellationToken ct = default)
    {
        try
        {
            using var connection = await OpenConnectionAsync(ct).ConfigureAwait(false);
            using var cmd = connection.CreateCommand();
            cmd.CommandText = $"""
                SELECT enabled, min_priority FROM {NotificationConfigSchema.ChannelsTable}
                WHERE channel = @channel AND instance = @instance;
                """;
            cmd.Parameters.AddWithValue("@channel", nameof(NotificationChannel.LocalAnnunciation));
            cmd.Parameters.AddWithValue("@instance", instance);

            using var reader = await cmd.ExecuteReaderAsync(ct).ConfigureAwait(false);
            if (!await reader.ReadAsync(ct).ConfigureAwait(false)) return null;
            return new LocalAnnunciationChannelConfig(ReadEnabled(reader), ReadMinPriority(reader), instance);
        }
        catch (Exception ex)
        {
            _logError?.Invoke(ex, $"Reading the local-annunciation notification channel ('{instance}') failed — treating it as unconfigured.");
            return null;
        }
    }

    /// <summary>Shared engine-internal read: the channel row joined to its side table, using that table's
    /// FULL projection.</summary>
    private async Task<T?> GetAsync<T>(
        NotificationChannel channel, string instance, string table, string fullColumns,
        Func<bool, AlarmPriority, SqliteDataReader, T> map, CancellationToken ct) where T : class
    {
        try
        {
            using var connection = await OpenConnectionAsync(ct).ConfigureAwait(false);
            using var cmd = connection.CreateCommand();
            cmd.CommandText = $"""
                SELECT c.enabled, c.min_priority, {NotificationConfigSchema.Qualify("d", fullColumns)}
                FROM {NotificationConfigSchema.ChannelsTable} c
                JOIN {table} d ON d.channel = c.channel AND d.instance = c.instance
                WHERE c.channel = @channel AND c.instance = @instance;
                """;
            cmd.Parameters.AddWithValue("@channel", channel.ToString());
            cmd.Parameters.AddWithValue("@instance", instance);

            using var reader = await cmd.ExecuteReaderAsync(ct).ConfigureAwait(false);
            if (!await reader.ReadAsync(ct).ConfigureAwait(false)) return null;
            return map(ReadEnabled(reader), ReadMinPriority(reader), reader);
        }
        catch (Exception ex)
        {
            _logError?.Invoke(ex, $"Reading the {channel} notification channel ('{instance}') failed — treating it as unconfigured.");
            return null;
        }
    }

    // ─────────────────────────────────────────────────────────────────────
    // The PUBLIC read — the one projection C-7's endpoint is allowed to serialise.
    // ─────────────────────────────────────────────────────────────────────

    /// <summary>
    /// Every configured channel, credential-free. This is the ONLY read intended to reach an HTTP
    /// response.
    ///
    /// <para>🔴 Its SQL is assembled from <see cref="NotificationConfigSchema"/>'s SUMMARY constants. No
    /// credential can appear in it by construction: every secret this product stores — the SMTP password,
    /// the webhook signing key and the webhook URL — is a DPAPI blob in <c>notification_secrets</c>, and
    /// that table is joined only for its (channel, instance, name) triples. What this method learns about
    /// a credential is that one exists.</para>
    /// </summary>
    public async Task<IReadOnlyList<NotificationChannelSummary>> ListAsync(CancellationToken ct = default)
    {
        try
        {
            using var connection = await OpenConnectionAsync(ct).ConfigureAwait(false);

            // Which secrets exist, by name. Reading `name` (never `secret`) is what makes
            // "HasUrl"/"HasSigningSecret"/"HasPassword" derivable without any value being fetched.
            var secretNames = new Dictionary<(string Channel, string Instance), HashSet<string>>();
            using (var secretsCmd = connection.CreateCommand())
            {
                secretsCmd.CommandText =
                    $"SELECT {NotificationConfigSchema.SecretSummaryColumns} FROM {NotificationConfigSchema.SecretsTable};";
                using var secretsReader = await secretsCmd.ExecuteReaderAsync(ct).ConfigureAwait(false);
                while (await secretsReader.ReadAsync(ct).ConfigureAwait(false))
                {
                    var key = (
                        secretsReader.GetString(secretsReader.GetOrdinal("channel")),
                        secretsReader.GetString(secretsReader.GetOrdinal("instance")));
                    if (!secretNames.TryGetValue(key, out var names))
                    {
                        names = new HashSet<string>(StringComparer.Ordinal);
                        secretNames[key] = names;
                    }
                    names.Add(secretsReader.GetString(secretsReader.GetOrdinal("name")));
                }
            }

            var results = new List<NotificationChannelSummary>();
            using (var cmd = connection.CreateCommand())
            {
                cmd.CommandText = $"""
                    SELECT {NotificationConfigSchema.Qualify("c", NotificationConfigSchema.ChannelSummaryColumns)},
                           {NotificationConfigSchema.Qualify("w", NotificationConfigSchema.WebhookSummaryColumns)},
                           {NotificationConfigSchema.Qualify("s", NotificationConfigSchema.SmtpSummaryColumns)},
                           {NotificationConfigSchema.Qualify("r", NotificationConfigSchema.RelaySummaryColumns)}
                    FROM {NotificationConfigSchema.ChannelsTable} c
                    LEFT JOIN {NotificationConfigSchema.WebhookTable} w
                           ON w.channel = c.channel AND w.instance = c.instance
                    LEFT JOIN {NotificationConfigSchema.SmtpTable} s
                           ON s.channel = c.channel AND s.instance = c.instance
                    LEFT JOIN {NotificationConfigSchema.RelayTable} r
                           ON r.channel = c.channel AND r.instance = c.instance
                    ORDER BY c.channel, c.instance;
                    """;

                using var reader = await cmd.ExecuteReaderAsync(ct).ConfigureAwait(false);
                while (await reader.ReadAsync(ct).ConfigureAwait(false))
                {
                    var channelName = reader.GetString(reader.GetOrdinal("channel"));
                    var instance = reader.GetString(reader.GetOrdinal("instance"));
                    // Enum.Parse, not TryParse-and-skip: this store is the ONLY writer of this column, so
                    // an unrecognized value is genuine corruption/schema drift. Silently skipping the row
                    // would hide a channel an operator believes is configured — the never-throws catch
                    // below reports the failure loudly instead, and the startup notices then say
                    // "nothing configured", which is at least honest about the consequence.
                    var channel = Enum.Parse<NotificationChannel>(channelName);
                    var names = secretNames.TryGetValue((channelName, instance), out var found) ? found : null;

                    results.Add(new NotificationChannelSummary(
                        Channel: channel,
                        Instance: instance,
                        Enabled: ReadEnabled(reader),
                        MinPriority: ReadMinPriority(reader),
                        UpdatedAtUtc: ParseIso(reader.GetString(reader.GetOrdinal("updated_at"))),
                        Webhook: GetNullableString(reader, "endpoint") is { } endpoint
                            ? new WebhookChannelSummary(
                                endpoint,
                                reader.GetString(reader.GetOrdinal("url_fingerprint")),
                                GetNullableString(reader, "label"),
                                names?.Contains(NotificationSecretNames.WebhookUrl) == true,
                                names?.Contains(NotificationSecretNames.WebhookSigningSecret) == true,
                                GetNullableString(reader, "auth_header_name"),
                                names?.Contains(NotificationSecretNames.WebhookAuthToken) == true)
                            : null,
                        Smtp: GetNullableString(reader, "host") is { } smtpHost
                            ? new SmtpChannelSummary(
                                smtpHost,
                                reader.GetInt32(reader.GetOrdinal("port")),
                                Enum.Parse<SmtpTlsMode>(reader.GetString(reader.GetOrdinal("tls_mode"))),
                                reader.GetString(reader.GetOrdinal("from_address")),
                                ParseRecipients(reader.GetString(reader.GetOrdinal("recipients_json"))),
                                GetNullableString(reader, "username"),
                                names?.Contains(NotificationSecretNames.SmtpPassword) == true)
                            : null,
                        Relay: GetNullableString(reader, "machine_code") is { } machineCode
                            ? new RelayChannelSummary(
                                machineCode,
                                Enum.Parse<RelayTargetKind>(reader.GetString(reader.GetOrdinal("target_kind"))),
                                reader.GetString(reader.GetOrdinal("target_name")))
                            : null));
                }
            }

            return results;
        }
        catch (Exception ex)
        {
            _logError?.Invoke(ex, "Listing notification channels failed — reporting none configured.");
            return Array.Empty<NotificationChannelSummary>();
        }
    }

    // ─────────────────────────────────────────────────────────────────────
    // Helpers
    // ─────────────────────────────────────────────────────────────────────

    /// <summary>Scheme, host and non-default port ONLY — every part of the URL that can carry a capability
    /// token (userinfo, path, query, fragment) is discarded. <see cref="Uri.Host"/> deliberately excludes
    /// userinfo, so <c>https://user:pass@host/hook</c> reduces to <c>https://host</c>. See
    /// <see cref="WebhookChannelConfig.Endpoint"/>, including the documented subdomain caveat.</summary>
    private static string DeriveEndpoint(Uri url) =>
        url.IsDefaultPort ? $"{url.Scheme}://{url.Host}" : $"{url.Scheme}://{url.Host}:{url.Port}";

    /// <summary>Review round 1 (I3) — a truncated, uppercase SHA-256 of the FULL URL, so an operator can
    /// tell two configurations apart, and tell whether one changed, without the capability ever being
    /// returned. See <see cref="WebhookChannelConfig.UrlFingerprint"/> for why truncation is safe here and
    /// for the repo precedents this follows.</summary>
    private static string ComputeUrlFingerprint(string url) =>
        Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(url)))[..16];

    private static bool ReadEnabled(SqliteDataReader reader) =>
        reader.GetInt64(reader.GetOrdinal("enabled")) != 0;

    private static AlarmPriority ReadMinPriority(SqliteDataReader reader) =>
        Enum.Parse<AlarmPriority>(reader.GetString(reader.GetOrdinal("min_priority")));

    private static IReadOnlyList<string> ParseRecipients(string json) =>
        JsonSerializer.Deserialize<List<string>>(json) ?? new List<string>();

    private static string? GetNullableString(SqliteDataReader reader, string column)
    {
        var ordinal = reader.GetOrdinal(column);
        return reader.IsDBNull(ordinal) ? null : reader.GetString(ordinal);
    }

    private static string ToIso(DateTimeOffset value) =>
        value.ToUniversalTime().ToString("O", CultureInfo.InvariantCulture);

    private static DateTimeOffset ParseIso(string value) =>
        DateTimeOffset.Parse(value, CultureInfo.InvariantCulture, DateTimeStyles.RoundtripKind);
}
