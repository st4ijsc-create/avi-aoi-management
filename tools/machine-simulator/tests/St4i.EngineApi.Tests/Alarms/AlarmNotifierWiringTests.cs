using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.Extensions.DependencyInjection;
using St4i.EngineApi.Alarms;
using St4i.EngineApi.Tests.Auth;
using Xunit;

namespace St4i.EngineApi.Tests.Alarms;

/// <summary>
/// Task C-1 — real-host proof of the notification seam's DI wiring in <c>Program.cs</c>: that it is
/// genuinely DEFAULT-OFF (nothing registered, <see cref="AlarmStore"/> falling back to
/// <see cref="NullAlarmNotifier"/>), and that turning it on resolves the whole graph — notifier, its
/// interface forward, and <see cref="AlarmNotifierSeedService"/> — without a cycle, and actually seeds from
/// <c>alarms.db</c> at startup.
///
/// <para>🔴 Task C-2 — the SWITCH these tests operate has changed, and that is the point of the change.
/// C-1 gated the seam on the <c>ST4I_ALARM_NOTIFY_ENABLED</c> env var; that gate is deleted, and the seam
/// now runs iff <see cref="NotificationConfigStore"/> holds at least one configured channel. So "off" is
/// no longer "an environment variable is unset" — it is "nobody has configured a channel", which is the
/// only state in which silence is not a misconfiguration. These two tests therefore seed (or do not seed)
/// a real config store rather than setting an env var; everything they ASSERT is unchanged.</para>
///
/// Same env-var-swap-then-eager-build protocol and shared
/// <see cref="SecurityEnvVarTests.CollectionName"/> collection tag as
/// <c>PolicyEndpointGatingTests</c>/<c>RbacPolicyTests</c> — every per-concern directory is redirected to a
/// throwaway temp dir so no host built here touches <c>%ProgramData%\ST4I\sim\...</c>.
/// </summary>
[Collection(SecurityEnvVarTests.CollectionName)]
public sealed class AlarmNotifierWiringTests
{
    private static readonly SemaphoreSlim EnvLock = new(1, 1);

    /// <summary>C-1's deleted env gate. Named here ONLY so
    /// <see cref="TheDeletedEnvGate_HasNoEffect_ConfigurationIsTheOnlySwitch"/> can prove that setting it
    /// does nothing — nothing in <c>src/</c> reads this string any more.</summary>
    private const string DeletedEnvGate = "ST4I_ALARM_NOTIFY_ENABLED";

    /// <param name="configureAChannel">Whether to persist a notification channel into the throwaway
    /// notifications directory BEFORE the host is built. Since review round 1 (I5) this no longer decides
    /// whether the seam is REGISTERED — it always is — only whether there is anything configured for it to
    /// deliver to.</param>
    /// <param name="legacyEnvGate">A value for the deleted <c>ST4I_ALARM_NOTIFY_ENABLED</c> variable, to
    /// prove it is inert.</param>
    /// <param name="configure">Task C-3 — extra configuration to persist before the host boots, so a test
    /// can point a real webhook channel at a real receiver.</param>
    private static async Task<WebApplicationFactory<Program>> CreateFactoryAsync(
        bool configureAChannel, string alarmsDir, string? legacyEnvGate = null,
        Func<NotificationConfigStore, Task>? configure = null)
    {
        var notificationsDir = Directory.CreateTempSubdirectory("st4i-notifywire-notifications-").FullName;
        if (configure is not null)
        {
            await configure(new NotificationConfigStore(notificationsDir)).ConfigureAwait(false);
        }

        if (configureAChannel)
        {
            // A channel an operator configured in some earlier session. Local annunciation is used because
            // it is the one channel with no side-table configuration of its own, so this configures
            // something real without asserting anything about a channel implementation that does not exist
            // yet.
            var configStore = new NotificationConfigStore(notificationsDir);
            Assert.True(await configStore.SaveLocalAnnunciationAsync(enabled: true, AlarmPriority.High)
                .ConfigureAwait(false));
        }

        var securityDir = Directory.CreateTempSubdirectory("st4i-notifywire-security-").FullName;
        var historianDir = Directory.CreateTempSubdirectory("st4i-notifywire-historian-").FullName;
        var walDir = Directory.CreateTempSubdirectory("st4i-notifywire-wal-").FullName;
        var settingsDir = Directory.CreateTempSubdirectory("st4i-notifywire-settings-").FullName;
        var identityDir = Directory.CreateTempSubdirectory("st4i-notifywire-identity-").FullName;
        var siteLinkDir = Directory.CreateTempSubdirectory("st4i-notifywire-sitelink-").FullName;
        var bridgeSpoolDir = Directory.CreateTempSubdirectory("st4i-notifywire-bridgespool-").FullName;
        var connectorConfigDir = Directory.CreateTempSubdirectory("st4i-notifywire-connectorconfig-").FullName;

        await EnvLock.WaitAsync().ConfigureAwait(false);
        var previous = new Dictionary<string, string?>
        {
            ["ST4I_SECURITY_DIR"] = Environment.GetEnvironmentVariable("ST4I_SECURITY_DIR"),
            ["ST4I_HISTORIAN_DIR"] = Environment.GetEnvironmentVariable("ST4I_HISTORIAN_DIR"),
            ["ST4I_WAL_DIR"] = Environment.GetEnvironmentVariable("ST4I_WAL_DIR"),
            ["ST4I_SETTINGS_DIR"] = Environment.GetEnvironmentVariable("ST4I_SETTINGS_DIR"),
            ["ST4I_IDENTITY_DIR"] = Environment.GetEnvironmentVariable("ST4I_IDENTITY_DIR"),
            ["ST4I_SITELINK_DIR"] = Environment.GetEnvironmentVariable("ST4I_SITELINK_DIR"),
            ["ST4I_ALARMS_DIR"] = Environment.GetEnvironmentVariable("ST4I_ALARMS_DIR"),
            ["ST4I_BRIDGE_SPOOL_DIR"] = Environment.GetEnvironmentVariable("ST4I_BRIDGE_SPOOL_DIR"),
            ["ST4I_CONNECTOR_CONFIG_DIR"] = Environment.GetEnvironmentVariable("ST4I_CONNECTOR_CONFIG_DIR"),
            [NotificationConfigStore.EnvVarDir] = Environment.GetEnvironmentVariable(NotificationConfigStore.EnvVarDir),
            [DeletedEnvGate] = Environment.GetEnvironmentVariable(DeletedEnvGate),
            ["ASPNETCORE_ENVIRONMENT"] = Environment.GetEnvironmentVariable("ASPNETCORE_ENVIRONMENT"),
        };

        try
        {
            Environment.SetEnvironmentVariable("ST4I_SECURITY_DIR", securityDir);
            Environment.SetEnvironmentVariable("ST4I_HISTORIAN_DIR", historianDir);
            Environment.SetEnvironmentVariable("ST4I_WAL_DIR", walDir);
            Environment.SetEnvironmentVariable("ST4I_SETTINGS_DIR", settingsDir);
            Environment.SetEnvironmentVariable("ST4I_IDENTITY_DIR", identityDir);
            Environment.SetEnvironmentVariable("ST4I_SITELINK_DIR", siteLinkDir);
            Environment.SetEnvironmentVariable("ST4I_ALARMS_DIR", alarmsDir);
            Environment.SetEnvironmentVariable("ST4I_BRIDGE_SPOOL_DIR", bridgeSpoolDir);
            Environment.SetEnvironmentVariable("ST4I_CONNECTOR_CONFIG_DIR", connectorConfigDir);
            Environment.SetEnvironmentVariable(NotificationConfigStore.EnvVarDir, notificationsDir);
            Environment.SetEnvironmentVariable(DeletedEnvGate, legacyEnvGate);
            Environment.SetEnvironmentVariable("ASPNETCORE_ENVIRONMENT", "Production");

            var factory = new WebApplicationFactory<Program>();
            _ = factory.Server; // build AND start the host now, while the env vars above are still set.
            return factory;
        }
        finally
        {
            foreach (var (name, value) in previous) Environment.SetEnvironmentVariable(name, value);
            EnvLock.Release();
        }
    }

    /// <summary>🔴 Task C-2 review round 1 (I5) — the seam is registered UNCONDITIONALLY, so a fresh
    /// install with NO channel configured still resolves the whole graph. That is the point: there is no
    /// state in which a later "enable this channel" can fail to take effect because the notifier was never
    /// built. Nothing is DELIVERED, of course — that is decided by configuration at the point of delivery
    /// — and the alarm store still raises/re-raises/clears exactly as it did before Đợt C.</summary>
    [Fact]
    public async Task NothingConfigured_StillRegistersTheSeam_AndTheAlarmStoreStillWorks()
    {
        var alarmsDir = Directory.CreateTempSubdirectory("st4i-notifywire-alarms-").FullName;
        var factory = await CreateFactoryAsync(configureAChannel: false, alarmsDir);
        try
        {
            Assert.NotNull(factory.Services.GetService<IAlarmNotifier>());
            Assert.NotNull(factory.Services.GetService<AlarmNotifier>());

            // Nothing is wired behind it, so every edge is drained and discarded rather than delivered.
            Assert.False(factory.Services.GetRequiredService<AlarmNotifier>().Stats.Dispatched > 0);

            var store = factory.Services.GetRequiredService<IAlarmStore>();
            var raise = new AlarmRaise(
                AlarmSource.DriverHealth, "DOWN", AlarmPriority.Critical, "m", TargetId: "slot-1");
            Assert.Equal(AlarmTransitionKind.Raised, (await store.RaiseAsync(raise)).Kind);
            Assert.Equal(AlarmTransitionKind.ReRaised, (await store.RaiseAsync(raise)).Kind);
            Assert.Equal(AlarmTransitionKind.Cleared, (await store.ClearAsync(raise.Key)).Kind);
        }
        finally
        {
            factory.Dispose();
            try { Directory.Delete(alarmsDir, recursive: true); } catch { /* best-effort */ }
        }
    }

    /// <summary>With a channel configured, the whole graph resolves (no DI cycle between the store and the
    /// notifier) and <see cref="AlarmNotifierSeedService"/> really runs during host start: an alarm written
    /// to <c>alarms.db</c> BEFORE the host existed is adopted as one
    /// <see cref="AlarmEdgeKind.Restored"/>, and its subsequent re-raises are suppressed.</summary>
    [Fact]
    public async Task AChannelConfigured_ResolvesTheWholeGraph_AndSeedsFromAlarmsDbAtStartup()
    {
        var alarmsDir = Directory.CreateTempSubdirectory("st4i-notifywire-alarms-").FullName;

        // A previous "process" leaves an alarm standing in alarms.db.
        var raise = new AlarmRaise(
            AlarmSource.DriverHealth, "DOWN", AlarmPriority.Critical, "left over", TargetId: "slot-9");
        await new AlarmStore(alarmsDir).RaiseAsync(raise);

        var factory = await CreateFactoryAsync(configureAChannel: true, alarmsDir);
        try
        {
            var notifier = factory.Services.GetRequiredService<AlarmNotifier>();
            Assert.Same(notifier, factory.Services.GetRequiredService<IAlarmNotifier>());

            var seeded = notifier.Stats;
            Assert.Equal(1, seeded.Seeded);
            Assert.Equal(1, seeded.Enqueued); // one Restored, never a fresh Raised
            Assert.Equal(0, seeded.Suppressed);

            // The store the host resolves is wired to that same notifier: a re-raise of the adopted alarm
            // is suppressed rather than announced.
            var store = factory.Services.GetRequiredService<IAlarmStore>();
            await store.RaiseAsync(raise);
            await store.RaiseAsync(raise);

            var after = notifier.Stats;
            Assert.Equal(1, after.Enqueued);
            Assert.Equal(2, after.Suppressed);
        }
        finally
        {
            factory.Dispose();
            try { Directory.Delete(alarmsDir, recursive: true); } catch { /* best-effort */ }
        }
    }

    /// <summary>
    /// 🔴 Task C-3 — the whole chain, through the REAL host: an alarm raised on the store the host
    /// resolves reaches a real HTTP receiver, signed.
    ///
    /// <para>Every other C-3 test drives <see cref="WebhookNotificationChannel"/> directly. This one is the
    /// only proof that <c>Program.cs</c> actually connects it: that the channel is registered, that its
    /// <c>DispatchAsync</c> really is the notifier's dispatch delegate, and that a webhook configured in an
    /// earlier session is picked up at boot. Wiring is exactly the kind of thing a unit test cannot see.</para>
    /// </summary>
    [Fact]
    public async Task AConfiguredWebhook_ReallyReceivesAnAlarmRaisedThroughTheHost()
    {
        await using var receiver = WebhookLoopbackServer.Start(new ScriptedResponse(200, "OK"));
        var alarmsDir = Directory.CreateTempSubdirectory("st4i-notifywire-alarms-").FullName;

        var factory = await CreateFactoryAsync(
            configureAChannel: false, alarmsDir,
            configure: async store =>
            {
                Assert.True(await store.SaveWebhookAsync(
                    enabled: true, AlarmPriority.High, receiver.Url("/hooks/wiring"), label: "Wiring test"));
                Assert.True(await store.SetSecretAsync(
                    NotificationChannel.Webhook, NotificationSecretNames.WebhookSigningSecret, "wiring-key"));
            });

        try
        {
            Assert.NotNull(factory.Services.GetService<WebhookNotificationChannel>());

            var store = factory.Services.GetRequiredService<IAlarmStore>();
            await store.RaiseAsync(new AlarmRaise(
                AlarmSource.DriverHealth, "DOWN", AlarmPriority.Critical, "wiring", TargetId: "slot-3"));

            // The drain loop is a background task; poll rather than sleep a fixed amount.
            var deadline = DateTimeOffset.UtcNow.AddSeconds(20);
            while (receiver.Requests.Count == 0 && DateTimeOffset.UtcNow < deadline)
            {
                await Task.Delay(25);
            }

            var request = Assert.Single(receiver.Requests);
            Assert.Equal("POST", request.Method);
            Assert.Equal("/hooks/wiring", request.Target);
            Assert.Equal("Raised", request.Header(WebhookContract.EventHeader));
            Assert.StartsWith("v1=", request.Header(WebhookContract.SignatureHeader)!, StringComparison.Ordinal);
            Assert.Contains("slot-3", request.BodyText, StringComparison.Ordinal);

            var channelStats = factory.Services.GetRequiredService<WebhookNotificationChannel>().Stats;
            Assert.Equal(1, channelStats.Delivered);
            Assert.Equal(0, channelStats.Lost);
        }
        finally
        {
            factory.Dispose();
            try { Directory.Delete(alarmsDir, recursive: true); } catch { /* best-effort */ }
        }
    }

    /// <summary>
    /// 🔴 Task C-4 — the whole chain for the SECOND channel, through the REAL host: an alarm raised on the
    /// store the host resolves reaches a real SMTP relay.
    ///
    /// <para>Every other C-4 test drives <see cref="SmtpNotificationChannel"/> directly. This is the only
    /// proof that <c>Program.cs</c> actually connects it — and, because a webhook is configured at the same
    /// time, that the two dispatch delegates are composed rather than one replacing the other. That
    /// composition is the thing a unit test structurally cannot see, and getting it wrong (a channel that
    /// silently shadows another) is exactly the wiring failure that would otherwise reach a customer.</para>
    /// </summary>
    [Fact]
    public async Task AConfiguredEmailChannel_ReallyReceivesAnAlarm_AlongsideTheWebhook()
    {
        await using var webhookReceiver = WebhookLoopbackServer.Start(new ScriptedResponse(200, "OK"));
        await using var relay = SmtpLoopbackServer.Start();
        var alarmsDir = Directory.CreateTempSubdirectory("st4i-notifywire-alarms-").FullName;

        var factory = await CreateFactoryAsync(
            configureAChannel: false, alarmsDir,
            configure: async store =>
            {
                Assert.True(await store.SaveSmtpAsync(
                    enabled: true, AlarmPriority.High, SmtpLoopbackServer.Host, relay.Port,
                    SmtpTlsMode.None, "alarms@plant.local", new[] { "ops@plant.local" }, username: null));
                Assert.True(await store.SaveWebhookAsync(
                    enabled: true, AlarmPriority.High, webhookReceiver.Url("/hooks/wiring")));
            });

        try
        {
            Assert.NotNull(factory.Services.GetService<SmtpNotificationChannel>());

            var store = factory.Services.GetRequiredService<IAlarmStore>();
            await store.RaiseAsync(new AlarmRaise(
                AlarmSource.DriverHealth, "DOWN", AlarmPriority.Critical, "wiring", TargetId: "slot-3"));

            var deadline = DateTimeOffset.UtcNow.AddSeconds(30);
            while ((relay.Messages.Count == 0 || webhookReceiver.Requests.Count == 0) &&
                   DateTimeOffset.UtcNow < deadline)
            {
                await Task.Delay(25);
            }

            var received = Assert.Single(relay.Messages);
            Assert.Equal("alarms@plant.local", received.MailFrom);
            Assert.Equal("ops@plant.local", Assert.Single(received.RcptTo));
            Assert.Contains("CRITICAL RAISED", received.Header("Subject")!, StringComparison.Ordinal);
            Assert.Contains("slot-3", received.Body, StringComparison.Ordinal);

            // 🔴 BOTH channels fired for the one alarm — the composition, not one shadowing the other.
            Assert.Single(webhookReceiver.Requests);
            Assert.Equal(1, factory.Services.GetRequiredService<SmtpNotificationChannel>().Stats.Delivered);
            Assert.Equal(1, factory.Services.GetRequiredService<WebhookNotificationChannel>().Stats.Delivered);
        }
        finally
        {
            factory.Dispose();
            try { Directory.Delete(alarmsDir, recursive: true); } catch { /* best-effort */ }
        }
    }

    /// <summary>
    /// 🔴 Task C-2 — the gate really was COLLAPSED, not merely supplemented.
    ///
    /// <para>C-1's <c>ST4I_ALARM_NOTIFY_ENABLED</c> is set to <c>"0"</c> here — the value that would
    /// disable the seam under ANY plausible reintroduction of an env gate, whether opt-in or opt-out — and
    /// the notifier is registered anyway. Worth its own test because "we deleted the env var" is the kind
    /// of claim that quietly stops being true: somebody restoring it as a convenience switch would
    /// reintroduce two disagreeing enable mechanisms, and wrapping the registration in a condition again is
    /// exactly how that would land. This fails the moment it does.</para>
    /// </summary>
    [Fact]
    public async Task TheDeletedEnvGate_HasNoEffect_TheSeamRunsRegardless()
    {
        var alarmsDir = Directory.CreateTempSubdirectory("st4i-notifywire-alarms-").FullName;
        var factory = await CreateFactoryAsync(configureAChannel: false, alarmsDir, legacyEnvGate: "0");
        try
        {
            Assert.NotNull(factory.Services.GetService<IAlarmNotifier>());
            Assert.Same(
                factory.Services.GetRequiredService<AlarmNotifier>(),
                factory.Services.GetRequiredService<IAlarmNotifier>());
        }
        finally
        {
            factory.Dispose();
            try { Directory.Delete(alarmsDir, recursive: true); } catch { /* best-effort */ }
        }
    }
}
