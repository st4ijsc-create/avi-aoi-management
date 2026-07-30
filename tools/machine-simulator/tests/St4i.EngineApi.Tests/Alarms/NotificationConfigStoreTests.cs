using System.Security.AccessControl;
using System.Security.Cryptography;
using System.Security.Principal;
using System.Text.Json;
using Microsoft.Data.Sqlite;
using St4i.EngineApi.Alarms;
using Xunit;

namespace St4i.EngineApi.Tests.Alarms;

/// <summary>
/// Task C-2 — unit proof of <see cref="NotificationConfigStore"/>: the migration ladder, per-channel
/// round-trips, the never-throws contract, DPAPI secret handling, the directory ACL, and — the reason this
/// task exists — that a credential cannot reach a public read, a returned object, or a log line.
/// </summary>
public sealed class NotificationConfigStoreTests
{
    private static string TempDir() => Directory.CreateTempSubdirectory("st4i-notificationconfig-tests-").FullName;

    /// <summary>A value distinctive enough that finding it ANYWHERE is proof of a leak.</summary>
    private const string SecretSentinel = "S3CRET-do-not-leak-2b3f9a17";

    private const string WebhookUrlWithSecretPath =
        "https://hooks.slack.example/services/T000/B000/" + SecretSentinel;

    // ─────────────────────────────────────────────────────────────────────
    // 1. Migration ladder — applies from empty, and is idempotent across repeated opens.
    // ─────────────────────────────────────────────────────────────────────

    [Fact]
    public void Migrations_ApplyFromEmpty_CreatingEveryTableAndStampingUserVersion()
    {
        var store = new NotificationConfigStore(TempDir());

        using var connection = new SqliteConnection($"Data Source={store.DbPath}");
        connection.Open();

        Assert.Equal(1L, UserVersion(connection));

        foreach (var table in AllTables)
        {
            using var cmd = connection.CreateCommand();
            cmd.CommandText = "SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' AND name = @name;";
            cmd.Parameters.AddWithValue("@name", table);
            Assert.Equal(1L, (long)cmd.ExecuteScalar()!);
        }
    }

    /// <summary>Re-opening the same directory must not re-run the ladder, must not throw, and must not
    /// disturb the data — the ordinary case every process restart exercises.</summary>
    [Fact]
    public async Task Migrations_AreIdempotentAcrossRepeatedOpens_AndPreserveData()
    {
        var dir = TempDir();

        var first = new NotificationConfigStore(dir);
        Assert.True(await first.SaveRelayAsync(
            enabled: true, AlarmPriority.Critical, "MODBUS-01", RelayTargetKind.Command, "AnnunciatorOn"));

        for (var open = 0; open < 3; open++)
        {
            var reopened = new NotificationConfigStore(dir);

            using var connection = new SqliteConnection($"Data Source={reopened.DbPath}");
            connection.Open();
            Assert.Equal(1L, UserVersion(connection));

            var relay = await reopened.GetRelayAsync();
            Assert.NotNull(relay);
            Assert.Equal("MODBUS-01", relay!.MachineCode);
            Assert.Equal(RelayTargetKind.Command, relay.TargetKind);
            Assert.Equal("AnnunciatorOn", relay.TargetName);
        }
    }

    // ─────────────────────────────────────────────────────────────────────
    // 2. 🔴 The structural projection guarantee — the test that must catch TOMORROW's mistake.
    // ─────────────────────────────────────────────────────────────────────

    /// <summary>
    /// 🔴 The central safety test. It does not check today's field list; it checks three things against
    /// each other, so that a FUTURE column cannot slip through:
    /// <list type="number">
    /// <item><description><b>The classification is exhaustive</b>, compared against the columns that
    /// physically exist (<c>PRAGMA table_info</c>). A maintainer who adds <c>webhook_bearer_token</c> and
    /// says nothing about it fails here — they are forced to declare whether it is a
    /// secret.</description></item>
    /// <item><description><b>No public projection names a secret-bearing column.</b> Having declared their
    /// new column a secret, adding it to a summary constant fails here.</description></item>
    /// <item><description><b>Non-vacuity.</b> If somebody "fixed" a failure by deleting the secret
    /// classifications, (2) would pass trivially — so the known secret-bearing columns are asserted to
    /// still be classified as such, and to still be reachable through their FULL projections.</description></item>
    /// </list>
    /// The projection strings compared here are the very constants
    /// <see cref="NotificationConfigStore"/> builds its SQL from, not copies — see
    /// <see cref="NotificationConfigSchema"/>'s own doc comment for why that matters.
    /// </summary>
    [Fact]
    public void TheSchemaIsFullyClassified_AndNoPublicProjectionSelectsASecretBearingColumn()
    {
        var store = new NotificationConfigStore(TempDir());

        using var connection = new SqliteConnection($"Data Source={store.DbPath}");
        connection.Open();

        var physical = new HashSet<(string Table, string Column)>();
        foreach (var table in AllTables)
        {
            using var cmd = connection.CreateCommand();
            cmd.CommandText = $"PRAGMA table_info({table});";
            using var reader = cmd.ExecuteReader();
            while (reader.Read()) physical.Add((table, reader.GetString(reader.GetOrdinal("name"))));
        }

        var classified = NotificationConfigSchema.Classification
            .Select(entry => (entry.Table, entry.Column))
            .ToHashSet();

        // (1) Exhaustive, in both directions.
        var unclassified = physical.Except(classified).OrderBy(c => c.Table).ThenBy(c => c.Column).ToList();
        Assert.True(unclassified.Count == 0,
            "These columns physically exist but are not classified in NotificationConfigSchema.Classification. " +
            "Declare whether each one is secret-bearing before it can reach a read projection: " +
            string.Join(", ", unclassified.Select(c => $"{c.Table}.{c.Column}")));

        var stale = classified.Except(physical).OrderBy(c => c.Table).ThenBy(c => c.Column).ToList();
        Assert.True(stale.Count == 0,
            "These columns are classified but no longer exist — the classification has drifted from the schema: " +
            string.Join(", ", stale.Select(c => $"{c.Table}.{c.Column}")));

        // (2) No public projection may name a secret-bearing column.
        var secretBearing = NotificationConfigSchema.Classification
            .Where(entry => entry.SecretBearing)
            .Select(entry => (entry.Table, entry.Column))
            .ToHashSet();

        foreach (var (table, columns) in NotificationConfigSchema.PublicProjections)
        {
            foreach (var column in NotificationConfigSchema.Split(columns))
            {
                Assert.False(secretBearing.Contains((table, column)),
                    $"The public projection for '{table}' selects '{column}', which is classified as " +
                    "secret-bearing. A credential must never be in the SQL a public read runs — remove it " +
                    "from the SUMMARY constant (it belongs only in the FULL one).");
            }
        }

        // (3) Non-vacuity — (2) must not be passing because nothing is classified secret any more.
        Assert.Equal(2, secretBearing.Count);
        Assert.Contains((NotificationConfigSchema.WebhookTable, "url"), secretBearing);
        Assert.Contains((NotificationConfigSchema.SecretsTable, "secret"), secretBearing);

        // ...and each remains reachable through its own FULL projection, so the split is a split rather
        // than the column having quietly become unreadable everywhere.
        Assert.Contains("url", NotificationConfigSchema.Split(NotificationConfigSchema.WebhookFullColumns));
        Assert.Contains("secret", NotificationConfigSchema.Split(NotificationConfigSchema.SecretFullColumns));
    }

    /// <summary>
    /// The black-box companion to the test above: whatever the column analysis says, the actual object a
    /// public read returns must not contain the secret. Serialising the WHOLE result and searching it
    /// catches a leak the schema analysis cannot model — e.g. somebody adding a computed property that
    /// returns the URL, which is not a column at all.
    /// </summary>
    [Fact]
    public async Task ListAsync_NeverCarriesTheWebhookUrlOrAnySecret_EvenSerialisedWhole()
    {
        var store = new NotificationConfigStore(TempDir());

        Assert.True(await store.SaveWebhookAsync(enabled: true, AlarmPriority.High, WebhookUrlWithSecretPath));
        Assert.True(await store.SetSecretAsync(
            NotificationChannel.Webhook, NotificationSecretNames.WebhookSigningSecret, SecretSentinel));
        Assert.True(await store.SaveSmtpAsync(
            enabled: true, AlarmPriority.High, "mail.local", 587, SmtpTlsMode.StartTls,
            "sim@plant", new[] { "ops@plant" }, "svc-account"));
        Assert.True(await store.SetSecretAsync(
            NotificationChannel.Smtp, NotificationSecretNames.SmtpPassword, SecretSentinel));

        var summaries = await store.ListAsync();
        var serialised = JsonSerializer.Serialize(summaries);

        Assert.DoesNotContain(SecretSentinel, serialised, StringComparison.Ordinal);
        Assert.DoesNotContain(WebhookUrlWithSecretPath, serialised, StringComparison.Ordinal);

        // Non-vacuity: the read really did return the channels (so "no sentinel" is not "no data"), and it
        // reports the FACT that each secret exists without its value.
        var webhook = Assert.Single(summaries, s => s.Channel == NotificationChannel.Webhook);
        Assert.NotNull(webhook.Webhook);
        Assert.True(webhook.Webhook!.HasSigningSecret);
        Assert.Equal("https://hooks.slack.example", webhook.Webhook.Endpoint);

        var smtp = Assert.Single(summaries, s => s.Channel == NotificationChannel.Smtp);
        Assert.True(smtp.Smtp!.HasPassword);
        Assert.Equal("svc-account", smtp.Smtp.Username);
    }

    /// <summary>The engine-internal read DOES return the URL — otherwise C-3 could never post anything,
    /// and the projection split above would be hiding the value from everyone rather than from the public
    /// read only.</summary>
    [Fact]
    public async Task GetWebhookAsync_DoesReturnTheUrl_ForTheEngineInternalCaller()
    {
        var store = new NotificationConfigStore(TempDir());
        Assert.True(await store.SaveWebhookAsync(enabled: true, AlarmPriority.High, WebhookUrlWithSecretPath));

        var config = await store.GetWebhookAsync();

        Assert.NotNull(config);
        Assert.Equal(WebhookUrlWithSecretPath, config!.Url);
        Assert.Equal("https://hooks.slack.example", config.Endpoint);
    }

    [Theory]
    [InlineData("https://host.example/a/b?token=x", "https://host.example")]
    [InlineData("http://10.0.0.5:8080/hook", "http://10.0.0.5:8080")]
    [InlineData("https://host.example:443/hook", "https://host.example")]
    public async Task TheDerivedEndpoint_KeepsSchemeHostAndPort_AndDiscardsEverythingThatCanCarryAToken(
        string url, string expectedEndpoint)
    {
        var store = new NotificationConfigStore(TempDir());
        Assert.True(await store.SaveWebhookAsync(enabled: true, AlarmPriority.High, url));

        var summary = Assert.Single(await store.ListAsync());
        Assert.Equal(expectedEndpoint, summary.Webhook!.Endpoint);
    }

    [Theory]
    [InlineData("")]
    [InlineData("   ")]
    [InlineData("not-a-url")]
    [InlineData("/relative/only")]
    [InlineData("ftp://host.example/hook")]
    public async Task SaveWebhookAsync_RefusesAnythingThatIsNotAnAbsoluteHttpUrl(string url)
    {
        var store = new NotificationConfigStore(TempDir());

        Assert.False(await store.SaveWebhookAsync(enabled: true, AlarmPriority.High, url));
        Assert.Empty(await store.ListAsync()); // and the channel row was rolled back with it
    }

    // ─────────────────────────────────────────────────────────────────────
    // 3. Round-trips — every channel's facts survive.
    // ─────────────────────────────────────────────────────────────────────

    [Fact]
    public async Task EveryChannel_RoundTripsAllOfItsFacts()
    {
        var dir = TempDir();
        var store = new NotificationConfigStore(dir);

        Assert.True(await store.SaveWebhookAsync(enabled: true, AlarmPriority.Critical, "https://mes.plant/alarm?src=sim"));
        Assert.True(await store.SaveSmtpAsync(
            enabled: false, AlarmPriority.High, "smtp.plant", 587, SmtpTlsMode.StartTls,
            "sim@plant", new[] { "ops@plant", "maint@plant" }, "svc-account"));
        Assert.True(await store.SaveLocalAnnunciationAsync(enabled: true, AlarmPriority.High));
        Assert.True(await store.SaveRelayAsync(
            enabled: true, AlarmPriority.Critical, "MODBUS-01", RelayTargetKind.Point, "annunciator"));

        // A fresh instance over the same directory — restart survival, the same technique
        // ConnectorConfigStoreTests uses.
        var reopened = new NotificationConfigStore(dir);

        var webhook = await reopened.GetWebhookAsync();
        Assert.True(webhook!.Enabled);
        Assert.Equal(AlarmPriority.Critical, webhook.MinPriority);
        Assert.Equal("https://mes.plant/alarm?src=sim", webhook.Url);

        var smtp = await reopened.GetSmtpAsync();
        Assert.False(smtp!.Enabled);
        Assert.Equal(AlarmPriority.High, smtp.MinPriority);
        Assert.Equal("smtp.plant", smtp.Host);
        Assert.Equal(587, smtp.Port);
        Assert.Equal(SmtpTlsMode.StartTls, smtp.Tls);
        Assert.Equal("sim@plant", smtp.FromAddress);
        Assert.Equal(new[] { "ops@plant", "maint@plant" }, smtp.Recipients);
        Assert.Equal("svc-account", smtp.Username);

        var local = await reopened.GetLocalAnnunciationAsync();
        Assert.True(local!.Enabled);
        Assert.Equal(AlarmPriority.High, local.MinPriority);

        var relay = await reopened.GetRelayAsync();
        Assert.True(relay!.Enabled);
        Assert.Equal("MODBUS-01", relay.MachineCode);
        Assert.Equal(RelayTargetKind.Point, relay.TargetKind);
        Assert.Equal("annunciator", relay.TargetName);

        Assert.Equal(4, (await reopened.ListAsync()).Count);
    }

    [Fact]
    public async Task SavingTheSameChannelTwice_Upserts_AndPreservesWhenItWasFirstConfigured()
    {
        var store = new NotificationConfigStore(TempDir());

        Assert.True(await store.SaveLocalAnnunciationAsync(enabled: true, AlarmPriority.High));
        var first = Assert.Single(await store.ListAsync());
        await Task.Delay(15);
        Assert.True(await store.SaveLocalAnnunciationAsync(enabled: false, AlarmPriority.Critical));

        var second = Assert.Single(await store.ListAsync()); // still ONE row, not two
        Assert.False(second.Enabled);
        Assert.Equal(AlarmPriority.Critical, second.MinPriority);
        Assert.True(second.UpdatedAtUtc >= first.UpdatedAtUtc);
    }

    [Fact]
    public async Task DeleteAsync_RemovesTheChannelItsConfigurationAndItsSecrets_Together()
    {
        var store = new NotificationConfigStore(TempDir());
        Assert.True(await store.SaveWebhookAsync(enabled: true, AlarmPriority.High, "https://mes.plant/hook"));
        Assert.True(await store.SetSecretAsync(
            NotificationChannel.Webhook, NotificationSecretNames.WebhookSigningSecret, SecretSentinel));

        Assert.True(await store.DeleteAsync(NotificationChannel.Webhook));

        Assert.Empty(await store.ListAsync());
        Assert.Null(await store.GetWebhookAsync());
        // 🔴 ON DELETE CASCADE: no orphaned credential is left behind for a channel nobody configured.
        Assert.Null(await store.GetSecretAsync(
            NotificationChannel.Webhook, NotificationSecretNames.WebhookSigningSecret));
        Assert.False(await store.DeleteAsync(NotificationChannel.Webhook)); // already gone
    }

    // ─────────────────────────────────────────────────────────────────────
    // 4. Secrets — round-trip, corrupt blob, and the foreign-key ordering rule.
    // ─────────────────────────────────────────────────────────────────────

    [Fact]
    public async Task ASecret_SurvivesAStoreRoundTrip_AndIsNotStoredInClearText()
    {
        var dir = TempDir();
        var store = new NotificationConfigStore(dir);
        Assert.True(await store.SaveSmtpAsync(
            enabled: true, AlarmPriority.High, "smtp.plant", 587, SmtpTlsMode.StartTls,
            "sim@plant", new[] { "ops@plant" }, "svc"));
        Assert.True(await store.SetSecretAsync(
            NotificationChannel.Smtp, NotificationSecretNames.SmtpPassword, SecretSentinel));

        var reopened = new NotificationConfigStore(dir);
        Assert.Equal(SecretSentinel, await reopened.GetSecretAsync(
            NotificationChannel.Smtp, NotificationSecretNames.SmtpPassword));

        // The bytes on disk are DPAPI ciphertext, not the plaintext. Pools are cleared first so the file
        // is closed (and the WAL checkpointed back into it) before it is read; the -wal/-shm sidecars are
        // scanned too if they survive, since in WAL mode a recent write can still be sitting in one.
        SqliteConnection.ClearAllPools();

        var scanned = 0;
        foreach (var suffix in new[] { "", "-wal", "-shm" })
        {
            var path = store.DbPath + suffix;
            if (!File.Exists(path)) continue;
            scanned++;
            var raw = await File.ReadAllBytesAsync(path);
            Assert.DoesNotContain(
                SecretSentinel, System.Text.Encoding.UTF8.GetString(raw), StringComparison.Ordinal);
        }

        Assert.True(scanned > 0); // non-vacuity: something really was read from disk
    }

    /// <summary>A corrupt or foreign blob reads as "no stored secret" and does NOT throw — the same rule
    /// <c>CredentialStore.Load</c> follows, and load-bearing here because this read happens on the
    /// notification dispatch path.</summary>
    [Fact]
    public async Task ACorruptOrForeignSecretBlob_ReadsAsAbsent_AndDoesNotThrow()
    {
        var dir = TempDir();
        var store = new NotificationConfigStore(dir);
        Assert.True(await store.SaveSmtpAsync(
            enabled: true, AlarmPriority.High, "smtp.plant", 587, SmtpTlsMode.StartTls,
            "sim@plant", new[] { "ops@plant" }, null));
        Assert.True(await store.SetSecretAsync(
            NotificationChannel.Smtp, NotificationSecretNames.SmtpPassword, SecretSentinel));

        // Valid DPAPI-LocalMachine ciphertext, but under DIFFERENT entropy — i.e. a blob from somewhere
        // else, which Unprotect rejects exactly like plain corruption.
        var foreign = ProtectedData.Protect(
            System.Text.Encoding.UTF8.GetBytes("should-never-come-back"),
            System.Text.Encoding.UTF8.GetBytes("some-other-entropy"),
            DataProtectionScope.LocalMachine);

        using (var connection = new SqliteConnection($"Data Source={store.DbPath}"))
        {
            connection.Open();
            using var cmd = connection.CreateCommand();
            cmd.CommandText =
                "UPDATE notification_secrets SET secret = @secret WHERE channel = 'Smtp' AND name = @name;";
            cmd.Parameters.AddWithValue("@secret", foreign);
            cmd.Parameters.AddWithValue("@name", NotificationSecretNames.SmtpPassword);
            Assert.Equal(1, cmd.ExecuteNonQuery());
        }
        SqliteConnection.ClearAllPools();

        Exception? captured = null;
        var reopened = new NotificationConfigStore(dir, logError: (ex, _) => captured = ex);

        // Must not throw, and must read as absent.
        Assert.Null(await reopened.GetSecretAsync(
            NotificationChannel.Smtp, NotificationSecretNames.SmtpPassword));

        // A corrupt blob is NOT an error path — it is a normal "no stored secret" answer, so nothing is
        // logged either. (Contrast the never-throws tests below, which DO capture an exception.)
        Assert.Null(captured);
    }

    [Fact]
    public async Task ASecretForAChannelThatWasNeverConfigured_IsRefused_LeavingNoOrphanedCredential()
    {
        var store = new NotificationConfigStore(TempDir());

        // No SaveSmtpAsync first — the foreign key has nothing to point at.
        Assert.False(await store.SetSecretAsync(
            NotificationChannel.Smtp, NotificationSecretNames.SmtpPassword, SecretSentinel));
        Assert.Null(await store.GetSecretAsync(
            NotificationChannel.Smtp, NotificationSecretNames.SmtpPassword));
    }

    [Fact]
    public async Task DeleteSecretAsync_RemovesOnlyThatSecret_AndLeavesTheChannelConfigured()
    {
        var store = new NotificationConfigStore(TempDir());
        Assert.True(await store.SaveWebhookAsync(enabled: true, AlarmPriority.High, "https://mes.plant/hook"));
        Assert.True(await store.SetSecretAsync(
            NotificationChannel.Webhook, NotificationSecretNames.WebhookSigningSecret, SecretSentinel));

        Assert.True(await store.DeleteSecretAsync(
            NotificationChannel.Webhook, NotificationSecretNames.WebhookSigningSecret));

        Assert.Null(await store.GetSecretAsync(
            NotificationChannel.Webhook, NotificationSecretNames.WebhookSigningSecret));
        var summary = Assert.Single(await store.ListAsync());
        Assert.False(summary.Webhook!.HasSigningSecret);
        Assert.Equal("https://mes.plant", summary.Webhook.Endpoint);
    }

    // ─────────────────────────────────────────────────────────────────────
    // 5. 🔴 No secret in any log line this store emits, including error paths.
    // ─────────────────────────────────────────────────────────────────────

    /// <summary>
    /// Every failure this store can report goes through one <c>logError</c> callback. This drives the
    /// reachable failure paths that HANDLE a secret and asserts the sentinel appears neither in the
    /// message nor anywhere in the exception (whose <c>ToString</c> includes its message, inner exceptions
    /// and stack) — the place a parameter value would surface if one were ever interpolated in.
    /// </summary>
    [Fact]
    public async Task NoSecretEverReachesALogLine_OnAnyReachableFailurePath()
    {
        var dir = TempDir();
        var logged = new List<string>();
        var store = new NotificationConfigStore(dir, logError: (ex, message) =>
        {
            logged.Add(message);
            logged.Add(ex.ToString());
        });

        // (a) Storing a secret for a channel that does not exist — a foreign-key failure raised while the
        //     plaintext is in scope, which is the most likely place for it to be interpolated into a
        //     message by accident.
        Assert.False(await store.SetSecretAsync(
            NotificationChannel.Smtp, NotificationSecretNames.SmtpPassword, SecretSentinel));

        // (b) A webhook URL that fails validation while the (secret-bearing) URL is in scope.
        Assert.False(await store.SaveWebhookAsync(enabled: true, AlarmPriority.High, "not-a-url-" + SecretSentinel));

        // (c) Reading and writing against a directory that has vanished, with the plaintext in hand.
        Assert.True(await store.SaveWebhookAsync(enabled: true, AlarmPriority.High, WebhookUrlWithSecretPath));
        SqliteConnection.ClearAllPools();
        Directory.Delete(dir, recursive: true);
        Assert.False(await store.SetSecretAsync(
            NotificationChannel.Webhook, NotificationSecretNames.WebhookSigningSecret, SecretSentinel));
        Assert.Null(await store.GetSecretAsync(
            NotificationChannel.Webhook, NotificationSecretNames.WebhookSigningSecret));
        Assert.Empty(await store.ListAsync());

        // Non-vacuity: these paths really did report failures, so "no sentinel" is not "no log lines".
        Assert.NotEmpty(logged);

        foreach (var line in logged)
        {
            Assert.DoesNotContain(SecretSentinel, line, StringComparison.Ordinal);
        }
    }

    // ─────────────────────────────────────────────────────────────────────
    // 6. Never-throws — mirroring AlarmStore's own directory-is-gone tests.
    // ─────────────────────────────────────────────────────────────────────

    /// <summary>Every member must survive its directory vanishing underneath it, because this store is
    /// read from the notification dispatch path that sits behind <c>AlarmStore</c>'s never-throws
    /// contract. Mirrors <c>AlarmStoreTests.RaiseAsync_NeverThrows_WhenTheDbDirectoryIsGone</c>.</summary>
    [Fact]
    public async Task EveryMember_NeverThrows_WhenTheDbDirectoryIsGone()
    {
        var dir = TempDir();
        var errors = new List<string>();
        var store = new NotificationConfigStore(dir, logError: (_, message) => errors.Add(message));

        Assert.True(await store.SaveWebhookAsync(enabled: true, AlarmPriority.High, "https://mes.plant/hook"));

        // The ctor already opened (and Microsoft.Data.Sqlite pools) a native connection against this file.
        SqliteConnection.ClearAllPools();
        Directory.Delete(dir, recursive: true);

        // None of these may throw — an unhandled exception fails this test on its own.
        Assert.False(await store.SaveWebhookAsync(enabled: true, AlarmPriority.High, "https://mes.plant/hook"));
        Assert.False(await store.SaveSmtpAsync(
            enabled: true, AlarmPriority.High, "smtp.plant", 587, SmtpTlsMode.StartTls,
            "sim@plant", new[] { "ops@plant" }, null));
        Assert.False(await store.SaveLocalAnnunciationAsync(enabled: true, AlarmPriority.High));
        Assert.False(await store.SaveRelayAsync(
            enabled: true, AlarmPriority.High, "M-1", RelayTargetKind.Point, "annunciator"));
        Assert.False(await store.DeleteAsync(NotificationChannel.Webhook));
        Assert.False(await store.SetSecretAsync(NotificationChannel.Webhook, "n", "v"));
        Assert.Null(await store.GetSecretAsync(NotificationChannel.Webhook, "n"));
        Assert.False(await store.DeleteSecretAsync(NotificationChannel.Webhook, "n"));
        Assert.Null(await store.GetWebhookAsync());
        Assert.Null(await store.GetSmtpAsync());
        Assert.Null(await store.GetLocalAnnunciationAsync());
        Assert.Null(await store.GetRelayAsync());
        Assert.Empty(await store.ListAsync());

        Assert.NotEmpty(errors); // the failures were reported, not silently swallowed
    }

    // ─────────────────────────────────────────────────────────────────────
    // 7. The directory ACL — the entire confidentiality boundary under LocalMachine-scoped DPAPI.
    // ─────────────────────────────────────────────────────────────────────

    /// <summary>Mirrors <c>CredentialStoreTests.Save_locks_down_creds_directory_acl</c>. Asserted after a
    /// SAVE rather than only after construction, because the ACL is re-applied on every secret write —
    /// self-healing for an install upgraded from a build that predates this store.</summary>
    [Fact]
    public async Task SetSecretAsync_LocksDownTheNotificationsDirectoryAcl()
    {
        var dir = TempDir();
        var store = new NotificationConfigStore(dir);
        Assert.True(await store.SaveWebhookAsync(enabled: true, AlarmPriority.High, "https://mes.plant/hook"));
        Assert.True(await store.SetSecretAsync(
            NotificationChannel.Webhook, NotificationSecretNames.WebhookSigningSecret, SecretSentinel));

        var acl = new DirectoryInfo(dir).GetAccessControl(AccessControlSections.Access);

        // Inheritance disabled — %ProgramData%'s default Authenticated-Users grant no longer applies.
        Assert.True(acl.AreAccessRulesProtected);

        var grantedTo = acl
            .GetAccessRules(includeExplicit: true, includeInherited: true, typeof(SecurityIdentifier))
            .Cast<FileSystemAccessRule>()
            .Select(rule => (SecurityIdentifier)rule.IdentityReference)
            .ToArray();

        Assert.Contains(grantedTo, sid => sid.Equals(new SecurityIdentifier(WellKnownSidType.LocalSystemSid, null)));
        Assert.Contains(grantedTo, sid => sid.Equals(new SecurityIdentifier(WellKnownSidType.BuiltinAdministratorsSid, null)));
    }

    // ─────────────────────────────────────────────────────────────────────
    // 8. Minimum priority is a THRESHOLD, never an override.
    // ─────────────────────────────────────────────────────────────────────

    /// <summary>🔴 <see cref="AlarmPriority"/> is declared most-severe-FIRST, so the comparison is
    /// inverted relative to the obvious reading. Getting it backwards would produce a channel that
    /// delivers everything except the alarms that matter.</summary>
    [Theory]
    [InlineData(AlarmPriority.Critical, AlarmPriority.Critical, true)]
    [InlineData(AlarmPriority.High, AlarmPriority.Critical, false)]   // High does not meet a Critical-only bar
    [InlineData(AlarmPriority.Critical, AlarmPriority.High, true)]    // Critical always clears a High bar
    [InlineData(AlarmPriority.High, AlarmPriority.High, true)]
    [InlineData(AlarmPriority.Medium, AlarmPriority.High, false)]
    public void MeetsThreshold_TreatsCriticalAsMoreSevereThanHigh(
        AlarmPriority alarm, AlarmPriority minimum, bool expected) =>
        Assert.Equal(expected, NotificationDelivery.MeetsThreshold(alarm, minimum));

    /// <summary>
    /// 🔴 The Identity cap keeps its meaning. <c>AlarmSource.Identity</c> is capped at
    /// <see cref="AlarmPriority.High"/> by deliberate design so an expiring certificate can never reach a
    /// Critical-only gate and halt production. Nothing in this store can change that: a channel's
    /// configuration decides only whether an alarm is DELIVERED, and there is no code path by which it can
    /// alter an alarm's priority.
    /// </summary>
    [Fact]
    public async Task ChannelConfiguration_CanFilterButCanNeverPromoteAnAlarmsPriority()
    {
        var store = new NotificationConfigStore(TempDir());
        Assert.True(await store.SaveWebhookAsync(enabled: true, AlarmPriority.Critical, "https://mes.plant/hook"));

        var webhook = await store.GetWebhookAsync();

        // A High alarm (everything Identity can ever be) does not reach a Critical-only channel...
        Assert.False(webhook.Delivers(AlarmPriority.High));
        // ...and a Critical one does. The alarm's own priority is the input, never an output.
        Assert.True(webhook.Delivers(AlarmPriority.Critical));

        // Disabled beats any threshold.
        Assert.True(await store.SaveWebhookAsync(enabled: false, AlarmPriority.High, "https://mes.plant/hook"));
        Assert.False((await store.GetWebhookAsync()).Delivers(AlarmPriority.Critical));

        // A channel that was never configured delivers nothing rather than throwing.
        Assert.False(((SmtpChannelConfig?)null).Delivers(AlarmPriority.Critical));
    }

    // ─────────────────────────────────────────────────────────────────────
    // Helpers
    // ─────────────────────────────────────────────────────────────────────

    private static readonly string[] AllTables =
    {
        NotificationConfigSchema.ChannelsTable,
        NotificationConfigSchema.WebhookTable,
        NotificationConfigSchema.SmtpTable,
        NotificationConfigSchema.RelayTable,
        NotificationConfigSchema.SecretsTable,
    };

    private static long UserVersion(SqliteConnection connection)
    {
        using var cmd = connection.CreateCommand();
        cmd.CommandText = "PRAGMA user_version;";
        return Convert.ToInt64(cmd.ExecuteScalar()!);
    }
}
