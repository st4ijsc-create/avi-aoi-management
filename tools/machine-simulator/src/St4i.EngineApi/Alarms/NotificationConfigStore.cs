using System.Globalization;
using System.Runtime.Versioning;
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
/// the very strings that go into the <c>SELECT</c>. See
/// <c>NotificationConfigStoreTests.TheSchemaIsFullyClassified_AndNoPublicProjectionSelectsASecretBearingColumn</c>.</para>
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

    internal const string ChannelFullColumns = "channel, enabled, min_priority, created_at, updated_at";
    internal const string ChannelSummaryColumns = "channel, enabled, min_priority, updated_at";

    internal const string WebhookFullColumns = "url, endpoint";
    internal const string WebhookSummaryColumns = "endpoint";

    internal const string SmtpFullColumns = "host, port, tls_mode, from_address, recipients_json, username";
    internal const string SmtpSummaryColumns = "host, port, tls_mode, from_address, recipients_json, username";

    internal const string RelayFullColumns = "machine_code, target_kind, target_name";
    internal const string RelaySummaryColumns = "machine_code, target_kind, target_name";

    /// <summary>The ONLY projection that ever names the <c>secret</c> column — used by
    /// <see cref="NotificationConfigStore.GetSecretAsync"/> alone, which is engine-internal.</summary>
    internal const string SecretFullColumns = "secret";

    /// <summary>What a PUBLIC read is allowed to know about a stored secret: that it exists, and under
    /// what name. Never its value.</summary>
    internal const string SecretSummaryColumns = "channel, name";

    /// <summary>
    /// Every physical column this store persists, and whether it carries material that must never reach a
    /// GET response, a log line or an audit row.
    ///
    /// <para>The test asserts this list is EXHAUSTIVE against the live schema in both directions — a
    /// column that exists but is not listed here fails, and a column listed here that no longer exists
    /// fails. So a maintainer who adds <c>webhook_bearer_token</c> cannot get a green suite by ignoring
    /// this file; they are forced to state whether it is a secret, and if they say yes and also add it to
    /// a summary projection, the second assertion fails too.</para>
    /// </summary>
    internal static readonly (string Table, string Column, bool SecretBearing)[] Classification =
    {
        (ChannelsTable, "channel", false),
        (ChannelsTable, "enabled", false),
        (ChannelsTable, "min_priority", false),
        (ChannelsTable, "created_at", false),
        (ChannelsTable, "updated_at", false),

        (WebhookTable, "channel", false),
        // 🔴 The whole reason webhook_config has a summary projection at all — see
        // WebhookChannelConfig.Url's own doc comment for why an incoming-webhook URL IS a credential.
        (WebhookTable, "url", true),
        (WebhookTable, "endpoint", false),

        (SmtpTable, "channel", false),
        (SmtpTable, "host", false),
        (SmtpTable, "port", false),
        (SmtpTable, "tls_mode", false),
        (SmtpTable, "from_address", false),
        (SmtpTable, "recipients_json", false),
        (SmtpTable, "username", false),

        (RelayTable, "channel", false),
        (RelayTable, "machine_code", false),
        (RelayTable, "target_kind", false),
        (RelayTable, "target_name", false),

        (SecretsTable, "channel", false),
        (SecretsTable, "name", false),
        (SecretsTable, "secret", true),
        (SecretsTable, "updated_at", false),
    };

    /// <summary>Every projection reachable from a PUBLIC read — i.e. everything
    /// <see cref="NotificationConfigStore.ListAsync"/> touches. The test asserts none of these names a
    /// column classified secret-bearing above.</summary>
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
/// <para>Raw <c>Microsoft.Data.Sqlite</c>, no ORM, its own file (<c>notifications.db</c>) under
/// <paramref name="directory"/> / <c>ST4I_NOTIFICATIONS_DIR</c> / <see cref="DefaultRoot"/>, a
/// <c>PRAGMA user_version</c> migration ladder applied per-version inside a transaction, and short-lived
/// WAL-mode connections — the same shape as <see cref="AlarmStore"/> and
/// <see cref="St4i.EngineApi.Fleet.ConnectorConfigStore"/>, copied rather than reinvented.</para>
///
/// <para>🔴 <b>Never-throws, unlike <see cref="St4i.EngineApi.Fleet.ConnectorConfigStore"/>.</b> That
/// store is reached only from explicit HTTP mutations, so it is allowed to surface a 500. This one is
/// read from the alarm NOTIFICATION path — C-3..C-6 will ask it "should I deliver this?" and "what is the
/// SMTP password?" from inside <see cref="AlarmNotifier"/>'s drain loop, which sits behind
/// <see cref="AlarmStore"/>'s never-throws contract. A configuration read that threw would turn a
/// transient SQLite hiccup into a lost alarm, so every member here swallows and reports through
/// <c>logError</c> instead, returning "nothing configured" (which every caller must already handle).</para>
///
/// <para>🔴 <b>How a secret is kept out of a public read: structurally, not defensively.</b> Two
/// independent mechanisms, both of which have to be actively defeated rather than merely forgotten:
/// <list type="number">
/// <item><description><b>A separate table.</b> Encrypted secrets live in <c>notification_secrets</c>,
/// addressed by (channel, NAME). Nothing in <c>notification_channels</c> or the three per-channel tables
/// holds one, so the read that backs C-7's endpoint cannot expose a secret by widening a column list — it
/// would have to add a JOIN to a table whose only value column is a DPAPI blob. And because a new secret
/// is a new ROW rather than a new column, the ordinary way to add one does not touch a projection at
/// all.</description></item>
/// <item><description><b>The projection split</b>, for the one value that is sensitive but not
/// encrypted — <c>webhook_config.url</c> (see <see cref="WebhookChannelConfig.Url"/> for why a Slack/Teams
/// incoming-webhook URL is itself a credential). <see cref="NotificationConfigSchema.WebhookFullColumns"/>
/// includes it; <see cref="NotificationConfigSchema.WebhookSummaryColumns"/> does not name it at all, so
/// it is not in the SQL the public query runs. Exactly <c>ConnectorConfigStore</c>'s <c>map_json</c>
/// discipline, and for exactly the same reason.</description></item>
/// </list>
/// The classification and both projections are declared in <see cref="NotificationConfigSchema"/> and
/// checked by a test against the live schema, so a future maintainer who adds a secret-bearing column gets
/// a red suite rather than a code review they might not get.</para>
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
/// </summary>
[SupportedOSPlatform("windows")]
public sealed class NotificationConfigStore
{
    /// <summary>Directory override — same idiom as <c>ST4I_ALARMS_DIR</c>/<c>ST4I_ASSETS_DIR</c>.</summary>
    public const string EnvVarDir = "ST4I_NOTIFICATIONS_DIR";

    public string DbPath { get; }

    /// <summary>The resolved directory holding <c>notifications.db</c>. Public because it IS the
    /// confidentiality boundary for every stored secret (see <see cref="NotificationSecretProtector"/>) —
    /// an operator diagnosing permissions needs to be able to find it.</summary>
    public string RootDirectory { get; }

    private readonly Action<Exception, string>? _logError;

    private static readonly string[] OpenPragmas =
    {
        "PRAGMA journal_mode=WAL;",
        "PRAGMA synchronous=NORMAL;",
        "PRAGMA busy_timeout=5000;",
        // Load-bearing here, not boilerplate: DeleteAsync relies on ON DELETE CASCADE to clear a
        // channel's side-table row AND its secrets, and SetSecretAsync relies on the same constraint to
        // refuse a secret for a channel that was never configured.
        "PRAGMA foreign_keys=ON;",
    };

    private static readonly (int Version, string[] Statements)[] Migrations =
    {
        (1, new[]
        {
            $"""
            CREATE TABLE IF NOT EXISTS {NotificationConfigSchema.ChannelsTable} (
              channel TEXT PRIMARY KEY,
              enabled INTEGER NOT NULL,
              min_priority TEXT NOT NULL,
              created_at TEXT NOT NULL,
              updated_at TEXT NOT NULL);
            """,
            $"""
            CREATE TABLE IF NOT EXISTS {NotificationConfigSchema.WebhookTable} (
              channel TEXT PRIMARY KEY
                REFERENCES {NotificationConfigSchema.ChannelsTable}(channel) ON DELETE CASCADE,
              url TEXT NOT NULL,
              endpoint TEXT NOT NULL);
            """,
            $"""
            CREATE TABLE IF NOT EXISTS {NotificationConfigSchema.SmtpTable} (
              channel TEXT PRIMARY KEY
                REFERENCES {NotificationConfigSchema.ChannelsTable}(channel) ON DELETE CASCADE,
              host TEXT NOT NULL,
              port INTEGER NOT NULL,
              tls_mode TEXT NOT NULL,
              from_address TEXT NOT NULL,
              recipients_json TEXT NOT NULL,
              username TEXT NULL);
            """,
            $"""
            CREATE TABLE IF NOT EXISTS {NotificationConfigSchema.RelayTable} (
              channel TEXT PRIMARY KEY
                REFERENCES {NotificationConfigSchema.ChannelsTable}(channel) ON DELETE CASCADE,
              machine_code TEXT NOT NULL,
              target_kind TEXT NOT NULL,
              target_name TEXT NOT NULL);
            """,
            // The secret's VALUE column is a BLOB: ProtectedData.Protect returns bytes, and round-tripping
            // them through TEXT would mean a base64 step whose only effect is to make the ciphertext
            // look like something worth reading.
            $"""
            CREATE TABLE IF NOT EXISTS {NotificationConfigSchema.SecretsTable} (
              channel TEXT NOT NULL
                REFERENCES {NotificationConfigSchema.ChannelsTable}(channel) ON DELETE CASCADE,
              name TEXT NOT NULL,
              secret BLOB NOT NULL,
              updated_at TEXT NOT NULL,
              PRIMARY KEY (channel, name));
            """,
        }),
    };

    /// <param name="directory">Explicit directory override (tests), or <see langword="null"/> to resolve
    /// via <see cref="ResolveRoot"/>.</param>
    /// <param name="logError">Where a swallowed failure is reported. Optional — a <see langword="null"/>
    /// logger means the failure is silently absorbed (still never thrown). 🔴 Nothing passed to this
    /// callback ever contains a secret: see <see cref="SetSecretAsync"/>/<see cref="GetSecretAsync"/>,
    /// which report by channel and NAME only.</param>
    public NotificationConfigStore(string? directory = null, Action<Exception, string>? logError = null)
    {
        _logError = logError;

        RootDirectory = ResolveRoot(directory);
        Directory.CreateDirectory(RootDirectory);

        // Applied here AND on every SetSecretAsync (self-healing, best-effort, never throws — see
        // SecurityDirAcl.Apply). Same unconditional-on-every-save posture as CredentialStore, and for the
        // same reason: under DataProtectionScope.LocalMachine this ACL is the entire confidentiality
        // boundary, so an install upgraded from a build that predates this store must get locked down on
        // its next write rather than only on a fresh install.
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
    /// <see cref="WebhookChannelConfig.Endpoint"/> is derived from it and a configuration whose
    /// credential-free display value could not be computed must not be stored.
    /// </summary>
    /// <returns><see langword="true"/> if persisted. 🔴 Deliberately a <see cref="bool"/> rather than the
    /// saved summary (which is what <c>ConnectorConfigStore.SaveAsync</c> returns): a hand-built return
    /// DTO is precisely how a secret-bearing field reaches a response body, so C-7's endpoint is made to
    /// read back through <see cref="ListAsync"/> — the one credential-free projection — instead of being
    /// handed a shape this method assembled itself.</returns>
    public Task<bool> SaveWebhookAsync(
        bool enabled, AlarmPriority minPriority, string url, CancellationToken ct = default) =>
        SaveAsync(NotificationChannel.Webhook, enabled, minPriority, "webhook", async (connection, transaction) =>
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

            using var cmd = connection.CreateCommand();
            cmd.Transaction = transaction;
            cmd.CommandText = $"""
                INSERT INTO {NotificationConfigSchema.WebhookTable} (channel, url, endpoint)
                VALUES (@channel, @url, @endpoint)
                ON CONFLICT(channel) DO UPDATE SET url = excluded.url, endpoint = excluded.endpoint;
                """;
            cmd.Parameters.AddWithValue("@channel", nameof(NotificationChannel.Webhook));
            cmd.Parameters.AddWithValue("@url", url);
            cmd.Parameters.AddWithValue("@endpoint", DeriveEndpoint(parsed));
            await cmd.ExecuteNonQueryAsync(ct).ConfigureAwait(false);
        }, ct);

    /// <summary>Saves the SMTP channel. The PASSWORD is not a parameter here — it is set separately via
    /// <see cref="SetSecretAsync"/> under <see cref="NotificationSecretNames.SmtpPassword"/>, so that the
    /// only code path capable of handling a plaintext credential is the one that encrypts it.</summary>
    public Task<bool> SaveSmtpAsync(
        bool enabled, AlarmPriority minPriority, string host, int port, SmtpTlsMode tls,
        string fromAddress, IReadOnlyList<string> recipients, string? username,
        CancellationToken ct = default) =>
        SaveAsync(NotificationChannel.Smtp, enabled, minPriority, "SMTP", async (connection, transaction) =>
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
                    (channel, host, port, tls_mode, from_address, recipients_json, username)
                VALUES (@channel, @host, @port, @tls, @from, @recipients, @username)
                ON CONFLICT(channel) DO UPDATE SET
                    host = excluded.host, port = excluded.port, tls_mode = excluded.tls_mode,
                    from_address = excluded.from_address, recipients_json = excluded.recipients_json,
                    username = excluded.username;
                """;
            cmd.Parameters.AddWithValue("@channel", nameof(NotificationChannel.Smtp));
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
        bool enabled, AlarmPriority minPriority, CancellationToken ct = default) =>
        SaveAsync(NotificationChannel.LocalAnnunciation, enabled, minPriority, "local annunciation", null, ct);

    /// <summary>🔴 Saves the relay channel — see <see cref="RelayChannelConfig"/> for what is stored, what
    /// is deliberately NOT (an address; the energise/de-energise values), and why.</summary>
    public Task<bool> SaveRelayAsync(
        bool enabled, AlarmPriority minPriority, string machineCode, RelayTargetKind targetKind,
        string targetName, CancellationToken ct = default) =>
        SaveAsync(NotificationChannel.Relay, enabled, minPriority, "relay", async (connection, transaction) =>
        {
            ArgumentException.ThrowIfNullOrWhiteSpace(machineCode);
            ArgumentException.ThrowIfNullOrWhiteSpace(targetName);

            using var cmd = connection.CreateCommand();
            cmd.Transaction = transaction;
            cmd.CommandText = $"""
                INSERT INTO {NotificationConfigSchema.RelayTable} (channel, machine_code, target_kind, target_name)
                VALUES (@channel, @machine_code, @target_kind, @target_name)
                ON CONFLICT(channel) DO UPDATE SET
                    machine_code = excluded.machine_code, target_kind = excluded.target_kind,
                    target_name = excluded.target_name;
                """;
            cmd.Parameters.AddWithValue("@channel", nameof(NotificationChannel.Relay));
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
        NotificationChannel channel, bool enabled, AlarmPriority minPriority, string label,
        Func<SqliteConnection, SqliteTransaction, Task>? saveDetail, CancellationToken ct)
    {
        try
        {
            var nowIso = ToIso(DateTimeOffset.UtcNow);

            using var connection = await OpenConnectionAsync(ct).ConfigureAwait(false);
            using var transaction = connection.BeginTransaction();

            using (var cmd = connection.CreateCommand())
            {
                cmd.Transaction = transaction;
                cmd.CommandText = $"""
                    INSERT INTO {NotificationConfigSchema.ChannelsTable}
                        (channel, enabled, min_priority, created_at, updated_at)
                    VALUES (@channel, @enabled, @min_priority, @now, @now)
                    ON CONFLICT(channel) DO UPDATE SET
                        enabled = excluded.enabled,
                        min_priority = excluded.min_priority,
                        updated_at = excluded.updated_at;
                    """;
                cmd.Parameters.AddWithValue("@channel", channel.ToString());
                cmd.Parameters.AddWithValue("@enabled", enabled ? 1 : 0);
                cmd.Parameters.AddWithValue("@min_priority", minPriority.ToString());
                cmd.Parameters.AddWithValue("@now", nowIso);
                await cmd.ExecuteNonQueryAsync(ct).ConfigureAwait(false);
            }

            if (saveDetail is not null) await saveDetail(connection, transaction).ConfigureAwait(false);

            transaction.Commit();
            return true;
        }
        catch (Exception ex)
        {
            _logError?.Invoke(ex, $"Saving the {label} notification channel failed — it was NOT persisted.");
            return false;
        }
    }

    /// <summary>Removes a channel's configuration entirely. <c>ON DELETE CASCADE</c> takes its side-table
    /// row and every one of its stored secrets with it, in the same statement — so "delete the channel"
    /// can never leave an orphaned credential behind.</summary>
    public async Task<bool> DeleteAsync(NotificationChannel channel, CancellationToken ct = default)
    {
        try
        {
            using var connection = await OpenConnectionAsync(ct).ConfigureAwait(false);
            using var cmd = connection.CreateCommand();
            cmd.CommandText = $"DELETE FROM {NotificationConfigSchema.ChannelsTable} WHERE channel = @channel;";
            cmd.Parameters.AddWithValue("@channel", channel.ToString());
            return await cmd.ExecuteNonQueryAsync(ct).ConfigureAwait(false) > 0;
        }
        catch (Exception ex)
        {
            _logError?.Invoke(ex, $"Deleting the {channel} notification channel failed.");
            return false;
        }
    }

    // ─────────────────────────────────────────────────────────────────────
    // Secrets — the ONLY code paths that touch plaintext or the `secret` column.
    // ─────────────────────────────────────────────────────────────────────

    /// <summary>
    /// DPAPI-protects <paramref name="plaintext"/> and stores it under (channel, name), re-applying the
    /// directory ACL first (see <see cref="NotificationSecretProtector"/> for why that ACL is the entire
    /// confidentiality boundary).
    ///
    /// <para>Requires the channel to have been saved already — the foreign key refuses a secret for a
    /// channel that does not exist, so an orphaned credential for a channel nobody configured is not a
    /// state this store can reach.</para>
    /// </summary>
    /// <returns><see langword="false"/> if it could not be stored. 🔴 Neither the return value, the
    /// <c>logError</c> message, nor any exception raised inside this method contains
    /// <paramref name="plaintext"/>: the failure is reported by channel and secret NAME only.</returns>
    public async Task<bool> SetSecretAsync(
        NotificationChannel channel, string name, string plaintext, CancellationToken ct = default)
    {
        try
        {
            ArgumentException.ThrowIfNullOrWhiteSpace(name);
            ArgumentException.ThrowIfNullOrEmpty(plaintext);

            SecurityDirAcl.Apply(RootDirectory, message => Console.Error.WriteLine($"[notificationconfig] {message}"));

            var protectedBytes = NotificationSecretProtector.Protect(plaintext);

            using var connection = await OpenConnectionAsync(ct).ConfigureAwait(false);
            using var cmd = connection.CreateCommand();
            cmd.CommandText = $"""
                INSERT INTO {NotificationConfigSchema.SecretsTable} (channel, name, secret, updated_at)
                VALUES (@channel, @name, @secret, @now)
                ON CONFLICT(channel, name) DO UPDATE SET secret = excluded.secret, updated_at = excluded.updated_at;
                """;
            cmd.Parameters.AddWithValue("@channel", channel.ToString());
            cmd.Parameters.AddWithValue("@name", name);
            cmd.Parameters.AddWithValue("@secret", protectedBytes);
            cmd.Parameters.AddWithValue("@now", ToIso(DateTimeOffset.UtcNow));
            await cmd.ExecuteNonQueryAsync(ct).ConfigureAwait(false);
            return true;
        }
        catch (Exception ex)
        {
            _logError?.Invoke(ex, $"Storing the '{name}' secret for the {channel} notification channel failed — it was NOT saved.");
            return false;
        }
    }

    /// <summary>
    /// The stored secret, or <see langword="null"/> if there is none — ENGINE-INTERNAL ONLY (C-3's
    /// webhook signer, C-4's SMTP client). Never routed to an HTTP response; the public read
    /// (<see cref="ListAsync"/>) reports only whether a secret EXISTS.
    ///
    /// <para>A blob that cannot be unprotected — corrupt, written under different entropy, or copied from
    /// another machine — reads as <see langword="null"/> ("no stored secret"), never as an exception. See
    /// <see cref="NotificationSecretProtector.TryUnprotect"/>.</para>
    /// </summary>
    public async Task<string?> GetSecretAsync(
        NotificationChannel channel, string name, CancellationToken ct = default)
    {
        try
        {
            using var connection = await OpenConnectionAsync(ct).ConfigureAwait(false);
            using var cmd = connection.CreateCommand();
            cmd.CommandText = $"""
                SELECT {NotificationConfigSchema.SecretFullColumns} FROM {NotificationConfigSchema.SecretsTable}
                WHERE channel = @channel AND name = @name;
                """;
            cmd.Parameters.AddWithValue("@channel", channel.ToString());
            cmd.Parameters.AddWithValue("@name", name);

            using var reader = await cmd.ExecuteReaderAsync(ct).ConfigureAwait(false);
            if (!await reader.ReadAsync(ct).ConfigureAwait(false)) return null;

            var blob = (byte[])reader["secret"];
            return NotificationSecretProtector.TryUnprotect(blob);
        }
        catch (Exception ex)
        {
            _logError?.Invoke(ex, $"Reading the '{name}' secret for the {channel} notification channel failed — treating it as unset.");
            return null;
        }
    }

    /// <summary>Removes one stored secret. Returns whether a row was actually removed.</summary>
    public async Task<bool> DeleteSecretAsync(
        NotificationChannel channel, string name, CancellationToken ct = default)
    {
        try
        {
            using var connection = await OpenConnectionAsync(ct).ConfigureAwait(false);
            using var cmd = connection.CreateCommand();
            cmd.CommandText = $"DELETE FROM {NotificationConfigSchema.SecretsTable} WHERE channel = @channel AND name = @name;";
            cmd.Parameters.AddWithValue("@channel", channel.ToString());
            cmd.Parameters.AddWithValue("@name", name);
            return await cmd.ExecuteNonQueryAsync(ct).ConfigureAwait(false) > 0;
        }
        catch (Exception ex)
        {
            _logError?.Invoke(ex, $"Deleting the '{name}' secret for the {channel} notification channel failed.");
            return false;
        }
    }

    // ─────────────────────────────────────────────────────────────────────
    // Engine-internal FULL reads — one per channel. Never routed to an HTTP response.
    // ─────────────────────────────────────────────────────────────────────

    /// <summary>The full webhook configuration INCLUDING the URL — C-3 only.</summary>
    public Task<WebhookChannelConfig?> GetWebhookAsync(CancellationToken ct = default) =>
        GetAsync(NotificationChannel.Webhook, NotificationConfigSchema.WebhookTable,
            NotificationConfigSchema.WebhookFullColumns,
            (enabled, min, reader) => new WebhookChannelConfig(
                enabled, min, reader.GetString(reader.GetOrdinal("url")), reader.GetString(reader.GetOrdinal("endpoint"))), ct);

    /// <summary>The full SMTP configuration — C-4 only. The password is NOT part of this record; fetch it
    /// with <see cref="GetSecretAsync"/> under <see cref="NotificationSecretNames.SmtpPassword"/>.</summary>
    public Task<SmtpChannelConfig?> GetSmtpAsync(CancellationToken ct = default) =>
        GetAsync(NotificationChannel.Smtp, NotificationConfigSchema.SmtpTable,
            NotificationConfigSchema.SmtpFullColumns,
            (enabled, min, reader) => new SmtpChannelConfig(
                enabled, min,
                reader.GetString(reader.GetOrdinal("host")),
                reader.GetInt32(reader.GetOrdinal("port")),
                Enum.Parse<SmtpTlsMode>(reader.GetString(reader.GetOrdinal("tls_mode"))),
                reader.GetString(reader.GetOrdinal("from_address")),
                ParseRecipients(reader.GetString(reader.GetOrdinal("recipients_json"))),
                GetNullableString(reader, "username")), ct);

    /// <summary>🔴 The full relay configuration — C-6 only.</summary>
    public Task<RelayChannelConfig?> GetRelayAsync(CancellationToken ct = default) =>
        GetAsync(NotificationChannel.Relay, NotificationConfigSchema.RelayTable,
            NotificationConfigSchema.RelayFullColumns,
            (enabled, min, reader) => new RelayChannelConfig(
                enabled, min,
                reader.GetString(reader.GetOrdinal("machine_code")),
                Enum.Parse<RelayTargetKind>(reader.GetString(reader.GetOrdinal("target_kind"))),
                reader.GetString(reader.GetOrdinal("target_name"))), ct);

    /// <summary>The local-annunciation configuration — C-5 only. No side table, so this reads the channel
    /// row alone.</summary>
    public async Task<LocalAnnunciationChannelConfig?> GetLocalAnnunciationAsync(CancellationToken ct = default)
    {
        try
        {
            using var connection = await OpenConnectionAsync(ct).ConfigureAwait(false);
            using var cmd = connection.CreateCommand();
            cmd.CommandText = $"""
                SELECT enabled, min_priority FROM {NotificationConfigSchema.ChannelsTable} WHERE channel = @channel;
                """;
            cmd.Parameters.AddWithValue("@channel", nameof(NotificationChannel.LocalAnnunciation));

            using var reader = await cmd.ExecuteReaderAsync(ct).ConfigureAwait(false);
            if (!await reader.ReadAsync(ct).ConfigureAwait(false)) return null;
            return new LocalAnnunciationChannelConfig(ReadEnabled(reader), ReadMinPriority(reader));
        }
        catch (Exception ex)
        {
            _logError?.Invoke(ex, "Reading the local-annunciation notification channel failed — treating it as unconfigured.");
            return null;
        }
    }

    /// <summary>Shared engine-internal read: the channel row joined to its side table, using that table's
    /// FULL projection.</summary>
    private async Task<T?> GetAsync<T>(
        NotificationChannel channel, string table, string fullColumns,
        Func<bool, AlarmPriority, SqliteDataReader, T> map, CancellationToken ct) where T : class
    {
        try
        {
            using var connection = await OpenConnectionAsync(ct).ConfigureAwait(false);
            using var cmd = connection.CreateCommand();
            cmd.CommandText = $"""
                SELECT c.enabled, c.min_priority, {NotificationConfigSchema.Qualify("d", fullColumns)}
                FROM {NotificationConfigSchema.ChannelsTable} c
                JOIN {table} d ON d.channel = c.channel
                WHERE c.channel = @channel;
                """;
            cmd.Parameters.AddWithValue("@channel", channel.ToString());

            using var reader = await cmd.ExecuteReaderAsync(ct).ConfigureAwait(false);
            if (!await reader.ReadAsync(ct).ConfigureAwait(false)) return null;
            return map(ReadEnabled(reader), ReadMinPriority(reader), reader);
        }
        catch (Exception ex)
        {
            _logError?.Invoke(ex, $"Reading the {channel} notification channel failed — treating it as unconfigured.");
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
    /// <para>🔴 Its SQL is assembled from <see cref="NotificationConfigSchema"/>'s SUMMARY constants, and
    /// <c>webhook_config.url</c> is simply not among them — there is no redaction step here to forget.
    /// The <c>secret</c> column is not merely omitted either: the secrets table is joined only for its
    /// (channel, name) pairs, so what this method learns about a credential is that one exists.</para>
    /// </summary>
    public async Task<IReadOnlyList<NotificationChannelSummary>> ListAsync(CancellationToken ct = default)
    {
        try
        {
            using var connection = await OpenConnectionAsync(ct).ConfigureAwait(false);

            // Which secrets exist, by name. Reading `name` (never `secret`) is what makes
            // "HasSigningSecret"/"HasPassword" derivable without the value ever being fetched.
            var secretNames = new Dictionary<string, HashSet<string>>(StringComparer.Ordinal);
            using (var secretsCmd = connection.CreateCommand())
            {
                secretsCmd.CommandText =
                    $"SELECT {NotificationConfigSchema.SecretSummaryColumns} FROM {NotificationConfigSchema.SecretsTable};";
                using var secretsReader = await secretsCmd.ExecuteReaderAsync(ct).ConfigureAwait(false);
                while (await secretsReader.ReadAsync(ct).ConfigureAwait(false))
                {
                    var channelName = secretsReader.GetString(secretsReader.GetOrdinal("channel"));
                    if (!secretNames.TryGetValue(channelName, out var names))
                    {
                        names = new HashSet<string>(StringComparer.Ordinal);
                        secretNames[channelName] = names;
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
                    LEFT JOIN {NotificationConfigSchema.WebhookTable} w ON w.channel = c.channel
                    LEFT JOIN {NotificationConfigSchema.SmtpTable}    s ON s.channel = c.channel
                    LEFT JOIN {NotificationConfigSchema.RelayTable}   r ON r.channel = c.channel
                    ORDER BY c.channel;
                    """;

                using var reader = await cmd.ExecuteReaderAsync(ct).ConfigureAwait(false);
                while (await reader.ReadAsync(ct).ConfigureAwait(false))
                {
                    var channelName = reader.GetString(reader.GetOrdinal("channel"));
                    // Enum.Parse, not TryParse-and-skip: this store is the ONLY writer of this column, so
                    // an unrecognized value is genuine corruption/schema drift. Silently skipping the row
                    // would hide a channel an operator believes is configured — the never-throws catch
                    // below reports the failure loudly instead, and the startup notices then say
                    // "nothing configured", which is at least honest about the consequence.
                    var channel = Enum.Parse<NotificationChannel>(channelName);
                    var names = secretNames.TryGetValue(channelName, out var found) ? found : null;

                    results.Add(new NotificationChannelSummary(
                        Channel: channel,
                        Enabled: ReadEnabled(reader),
                        MinPriority: ReadMinPriority(reader),
                        UpdatedAtUtc: ParseIso(reader.GetString(reader.GetOrdinal("updated_at"))),
                        Webhook: GetNullableString(reader, "endpoint") is { } endpoint
                            ? new WebhookChannelSummary(
                                endpoint,
                                names?.Contains(NotificationSecretNames.WebhookSigningSecret) == true)
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
    /// token (path, query, fragment) is discarded. See <see cref="WebhookChannelConfig.Endpoint"/>.</summary>
    private static string DeriveEndpoint(Uri url) =>
        url.IsDefaultPort ? $"{url.Scheme}://{url.Host}" : $"{url.Scheme}://{url.Host}:{url.Port}";

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
