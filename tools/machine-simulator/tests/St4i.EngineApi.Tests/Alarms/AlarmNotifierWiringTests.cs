using System.Diagnostics;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging;
using St4i.EngineApi.Alarms;
using St4i.EngineApi.Tests.Auth;
using Xunit;

namespace St4i.EngineApi.Tests.Alarms;

/// <summary>
/// Task C-1 — real-host proof of the notification seam's DI wiring in <c>Program.cs</c>: originally that
/// it was genuinely DEFAULT-OFF (nothing registered, <see cref="AlarmStore"/> falling back to
/// <see cref="NullAlarmNotifier"/>), and that turning it on resolves the whole graph — notifier, its
/// interface forward, and <see cref="AlarmNotifierSeedService"/> — without a cycle, and actually seeds from
/// <c>alarms.db</c> at startup.
///
/// <para>🔴 Task C-2 — the SWITCH these tests operate has changed, and that is the point of the change.
/// C-1 gated the seam on the <c>ST4I_ALARM_NOTIFY_ENABLED</c> env var; that gate is deleted. So "off" is
/// no longer "an environment variable is unset" — it is "nobody has configured a channel", which is the
/// only state in which silence is not a misconfiguration. These two tests therefore seed (or do not seed)
/// a real config store rather than setting an env var; everything they ASSERT is unchanged.</para>
///
/// <para>🔴 <b>Task C-8 corrected the sentence above, which said the seam "now runs iff
/// <see cref="NotificationConfigStore"/> holds at least one configured channel".</b> C-2's review round 1
/// (I5) overturned exactly that: the seam is registered UNCONDITIONALLY, to delete the whole class of
/// "configured but never registered" rather than leave one transition — the first channel ever configured
/// on a host that booted with none — needing a restart. This class's own
/// <c>NothingConfigured_StillRegistersTheSeam_AndTheAlarmStoreStillWorks</c> is the test that proves it,
/// and it had been contradicting this doc comment ever since. What an unconfigured host does NOT do is
/// deliver anything to anybody — which is the claim worth making, and the one that is still true.</para>
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
    /// <param name="configureHost">🔴 Task C-5 — applied INSIDE the env-var window, deliberately.
    /// <c>WithWebHostBuilder</c> builds a second host, and calling it after this method returned would build
    /// that host with the real <c>%ProgramData%</c> directories restored. Its one use today is capturing the
    /// startup notices <c>Program.cs</c> logs; see
    /// <see cref="TheHostsOwnStartupNotice_NamesEveryChannelItCanActuallyDeliver_AndNoOther"/>.</param>
    private static async Task<WebApplicationFactory<Program>> CreateFactoryAsync(
        bool configureAChannel, string alarmsDir, string? legacyEnvGate = null,
        Func<NotificationConfigStore, Task>? configure = null,
        Action<IWebHostBuilder>? configureHost = null)
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
            var configured = configureHost is null ? factory : factory.WithWebHostBuilder(configureHost);
            _ = configured.Server; // build AND start the host now, while the env vars above are still set.
            return configured;
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
    /// 🔴 Task C-4 review (I-4), <b>rewritten by Task C-6 because the original stopped discriminating.</b>
    ///
    /// <para><b>What it used to pin, and why that is no longer the whole property.</b> C-4's version raised
    /// ONE alarm against two black-holed destinations and asserted both were contacted within 5 s. That
    /// separated <c>Task.WhenAll</c> from a sequential <c>foreach</c> — the only two compositions that
    /// existed then. C-6 replaced the composition entirely with one queue and one drain loop per channel, and
    /// under that shape the old assertion passes for a reason it was never testing: a single shared queue
    /// composed with <c>WhenAll</c> would ALSO pass it. Left as it was, it would have gone on passing while
    /// the property C-6 exists to deliver was absent.</para>
    ///
    /// <para>🔴 <b>What it pins now: the NEXT notification.</b> <c>Task.WhenAll</c> bounded ONE edge's cost
    /// at <c>max(budget)</c>, but the single drain loop does not read edge N+1 until edge N's <c>WhenAll</c>
    /// has completed — so a webhook wedged for its whole 10 s budget still held every other channel for 10 s
    /// PER EDGE. That is the real failure: a plant restarting into a dead webhook replays its standing
    /// alarms and the beacon is dark 10 s behind each one. So: the webhook is black-holed, the SMTP relay
    /// ANSWERS, and TWO alarms are raised. The second alarm's mail must arrive promptly.</para>
    ///
    /// <para><b>Asserted in ELAPSED TIME from the second raise</b>, not merely by arrival: C-3 and C-4 both
    /// shipped budget tests that passed with the guard deleted because only wall-clock differed and nothing
    /// measured it. Under any shared-queue composition the second message cannot arrive before the webhook's
    /// 10 s budget expires; the 5 s bound separates that from the sub-second reality cleanly. The FIRST
    /// message's arrival is asserted too, and separately, so a regression that broke the whole SMTP channel
    /// reports as that rather than as a queueing failure.</para>
    /// </summary>
    [Fact]
    public async Task AWedgedChannelDoesNotDelayAnotherChannelsNextNotification_MeasuredInElapsedTime()
    {
        // The webhook never answers, so its channel is occupied for its full 10s budget per notification.
        await using var webhookReceiver = WebhookLoopbackServer.Start(_ => null);
        // The relay DOES answer — it is the live channel whose promptness is being measured.
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
                    enabled: true, AlarmPriority.High, webhookReceiver.Url("/hooks/concurrent")));
            });

        try
        {
            var store = factory.Services.GetRequiredService<IAlarmStore>();

            await store.RaiseAsync(new AlarmRaise(
                AlarmSource.DriverHealth, "DOWN", AlarmPriority.Critical, "first", TargetId: "slot-7"));

            // 🔴 Closeout round (B-1) — BOTH conditions are polled, and the reason is the property this very
            // test exists to prove.
            //
            // This used to poll `relay.Messages.Count < 1` alone and then assert the WEBHOOK had been
            // contacted with no poll at all. C-6 gave every channel its own queue and its own drain loop, so
            // there is NO ordering relationship between "SMTP delivered" and "webhook started" — that
            // independence IS the guarantee under test, and it is exactly what made the un-polled assert
            // racy. The webhook side is additionally the slower one to arm: it decrypts a DPAPI-sealed
            // secret and builds its `HttpClient` handler on first use, neither of which the SMTP path does.
            //
            // Measured, not assumed: on an IDLE machine, in isolation, the old form failed 1 run in 5 on
            // `webhookReceiver.Requests.Count > 0` at ~617 ms — so this was never a load-only flake. A
            // recording bug was ruled out separately: WebhookLoopbackServer enqueues the request BEFORE it
            // consults the responder, so a black-holed hook is still recorded on arrival.
            //
            // The two-condition idiom is the one the composition tests in this file already use
            // (`AConfiguredEmailChannel_ReallyReceivesAnAlarm_AlongsideTheWebhook` and
            // `AConfiguredLocalAnnunciation_ReallyAnnunciates_AlongsideTheWebhookAndTheEmail`, which polls
            // FOUR conditions); this now matches them.
            var firstDeadline = DateTimeOffset.UtcNow.AddSeconds(20);
            while ((relay.Messages.Count < 1 || webhookReceiver.Requests.Count < 1) &&
                   DateTimeOffset.UtcNow < firstDeadline)
            {
                await Task.Delay(10);
            }

            Assert.True(relay.Messages.Count >= 1, "the SMTP relay never received the FIRST alarm at all.");

            // Non-vacuity: the webhook channel really is wedged on the first notification by now, so the
            // second one below is genuinely racing a held channel rather than an idle one. Now POLLED for
            // above, so this is a real precondition rather than a bet on scheduler order.
            Assert.True(webhookReceiver.Requests.Count > 0, "the webhook receiver was never contacted.");

            var raisedAt = Stopwatch.StartNew();
            await store.RaiseAsync(new AlarmRaise(
                AlarmSource.NgRate, "NG_RATE_HIGH", AlarmPriority.Critical, "second", TargetId: "fleet"));

            var secondDeadline = DateTimeOffset.UtcNow.AddSeconds(5);
            while (relay.Messages.Count < 2 && DateTimeOffset.UtcNow < secondDeadline) await Task.Delay(10);
            var elapsed = raisedAt.Elapsed;

            Assert.True(relay.Messages.Count >= 2,
                $"the SMTP relay did not receive the SECOND alarm within {elapsed.TotalSeconds:0.#}s while a " +
                "dead webhook was still occupied with the first — the notification channels are sharing a " +
                "queue again, which makes every channel wait out the slowest one's budget PER EDGE.");

            // 🔴 ELAPSED, not a counter. Sharing a queue puts this at >= the webhook's 10s budget.
            Assert.True(elapsed < TimeSpan.FromSeconds(5),
                $"the second alarm took {elapsed.TotalSeconds:0.#}s to reach the live channel.");
        }
        finally
        {
            factory.Dispose();
            try { Directory.Delete(alarmsDir, recursive: true); } catch { /* best-effort */ }
        }
    }

    /// <summary>
    /// 🔴 Task C-5 — the THIRD channel through the real host, and the proof that C-5 APPENDED to the
    /// dispatch composition rather than replacing anything.
    ///
    /// <para>All three channels are configured and one alarm is raised. The webhook and the relay both
    /// receive it AND the local-annunciation channel counts an <c>Announced</c> — so a C-5 wiring that had
    /// overwritten <c>Program.cs</c>'s <c>dispatch</c> instead of adding to its channel list, or that had
    /// been registered but never added to the list at all, fails here. That is the wiring failure a unit
    /// test structurally cannot see, and it is the one that would reach a customer.</para>
    ///
    /// <para>The <see cref="AlarmAnnunciationHub"/> listener is subscribed directly rather than over HTTP:
    /// the SSE transport has its own end-to-end test
    /// (<c>AlarmAnnunciationStreamTests.AnAlarmRaisedThroughTheRealHost_ArrivesOnAnOpenStream_…</c>), and
    /// what THIS test is about is the composition, so it holds the transport constant.</para>
    /// </summary>
    [Fact]
    public async Task AConfiguredLocalAnnunciation_ReallyAnnunciates_AlongsideTheWebhookAndTheEmail()
    {
        await using var webhookReceiver = WebhookLoopbackServer.Start(new ScriptedResponse(200, "OK"));
        await using var relay = SmtpLoopbackServer.Start();
        var alarmsDir = Directory.CreateTempSubdirectory("st4i-notifywire-alarms-").FullName;

        var factory = await CreateFactoryAsync(
            configureAChannel: false, alarmsDir,
            configure: async store =>
            {
                Assert.True(await store.SaveWebhookAsync(
                    enabled: true, AlarmPriority.High, webhookReceiver.Url("/hooks/three")));
                Assert.True(await store.SaveSmtpAsync(
                    enabled: true, AlarmPriority.High, SmtpLoopbackServer.Host, relay.Port,
                    SmtpTlsMode.None, "alarms@plant.local", new[] { "ops@plant.local" }, username: null));
                Assert.True(await store.SaveLocalAnnunciationAsync(enabled: true, AlarmPriority.High));
                // 🔴 Task C-6 — the fourth channel, pointed at a machine this host's roster does not carry.
                // That is deliberate: what THIS test is about is composition, and MachineNotFound is a
                // counter only the real relay channel, really dispatched, can move. Whether a real coil
                // moves is RelayNotificationChannelTests' subject, against a real writable driver.
                Assert.True(await store.SaveRelayAsync(
                    enabled: true, AlarmPriority.High, "NOT-IN-THIS-ROSTER", RelayTargetKind.Point, "beacon",
                    onValueJson: "1", offValueJson: "0"));
            });

        try
        {
            var channel = factory.Services.GetService<LocalAnnunciationChannel>();
            Assert.NotNull(channel);
            var relayChannel = factory.Services.GetService<RelayNotificationChannel>();
            Assert.NotNull(relayChannel);

            var hub = factory.Services.GetRequiredService<AlarmAnnunciationHub>();
            using var listener = hub.Subscribe();

            var store = factory.Services.GetRequiredService<IAlarmStore>();
            await store.RaiseAsync(new AlarmRaise(
                AlarmSource.DriverHealth, "DOWN", AlarmPriority.Critical, "wiring", TargetId: "slot-4"));

            var deadline = DateTimeOffset.UtcNow.AddSeconds(30);
            while ((relay.Messages.Count == 0 || webhookReceiver.Requests.Count == 0 ||
                    channel!.Stats.Announced == 0 || relayChannel!.Stats.Considered == 0) &&
                   DateTimeOffset.UtcNow < deadline)
            {
                await Task.Delay(25);
            }

            // 🔴 All FOUR fired for the one alarm — a C-6 wiring that had replaced the channel list rather
            // than appending to it, or registered the channel without composing it, fails here.
            Assert.Single(webhookReceiver.Requests);
            Assert.Single(relay.Messages);
            Assert.Equal(1, channel!.Stats.Announced);
            Assert.Equal(0, channel.Stats.Unheard);
            Assert.Equal(1, relayChannel!.Stats.Considered);
            Assert.Equal(1, relayChannel.Stats.MachineNotFound);

            Assert.True(listener.Reader.TryRead(out var annunciation));
            Assert.Equal(AlarmEdgeKind.Raised, annunciation!.Edge);
            Assert.Equal("slot-4", annunciation.TargetId);
            Assert.Equal(AlarmPriority.Critical, annunciation.Priority);
        }
        finally
        {
            factory.Dispose();
            try { Directory.Delete(alarmsDir, recursive: true); } catch { /* best-effort */ }
        }
    }

    /// <summary>
    /// 🔴 <b>Task C-5 — the hole every earlier task's version of this test left open, found by mutation.</b>
    ///
    /// <para><c>NotificationStartupNoticesTests</c> exercises <c>Describe</c> as a PURE FUNCTION, against a
    /// hand-built set. It therefore cannot see whether <c>Program.cs</c> actually PUTS a channel in that
    /// set — and it does not: deleting
    /// <c>implementedNotificationChannels.Add(NotificationChannel.LocalAnnunciation)</c> from
    /// <c>Program.cs</c> left all 297 alarm tests green. The build would then have gone on delivering local
    /// annunciations perfectly while telling the operator, at every boot, that this build "has no delivery
    /// implementation for them — alarm edges are detected and then DISCARDED". That is C-3's §9 regression
    /// wearing its coat inside out: the same one line, disagreeing with reality in the other direction, and
    /// the same class of defect the set was introduced to make impossible. The identical hole exists for
    /// the Webhook and SMTP members, which is why this test asserts all three rather than only C-5's.</para>
    ///
    /// <para>Asserted against what the host ACTUALLY SAYS — the notices it logs at startup — because that is
    /// the artefact an operator reads and the only thing that can disagree with the delivery the other
    /// wiring tests prove.</para>
    ///
    /// <para>🔴 <b>Task C-6 rewrote the assertions, because C-5's control disappeared when the fourth channel
    /// landed.</b> C-5 could keep Relay enabled-and-unimplemented as a live control proving this test could
    /// still SEE an undeliverable channel. With all four channels implemented there is no fifth to hold in
    /// reserve, so the shape changed: the ACTIVE notice must name all four AND the "no delivery
    /// implementation" warning must be ABSENT ENTIRELY. That pair still kills each of the four
    /// <c>implementedNotificationChannels.Add(...)</c> lines individually and in both directions — deleting
    /// one makes the ACTIVE notice say 3 and omit it, and simultaneously makes the warning appear naming it.
    /// The ability of the notice machinery to produce that warning at all is covered exhaustively next door
    /// by <c>NotificationStartupNoticesTests</c> (every channel × absent/disabled/enabled ×
    /// implemented-or-not, 1296 cases), which is the control this test no longer carries itself.</para>
    /// </summary>
    [Fact]
    public async Task TheHostsOwnStartupNotice_NamesEveryChannelItCanActuallyDeliver_AndNoOther()
    {
        await using var webhookReceiver = WebhookLoopbackServer.Start(new ScriptedResponse(200, "OK"));
        await using var relay = SmtpLoopbackServer.Start();
        var alarmsDir = Directory.CreateTempSubdirectory("st4i-notifywire-alarms-").FullName;
        var notices = new CapturingLoggerProvider();

        var factory = await CreateFactoryAsync(
            configureAChannel: false, alarmsDir,
            configure: async store =>
            {
                Assert.True(await store.SaveWebhookAsync(
                    enabled: true, AlarmPriority.High, webhookReceiver.Url("/hooks/notice")));
                Assert.True(await store.SaveSmtpAsync(
                    enabled: true, AlarmPriority.High, SmtpLoopbackServer.Host, relay.Port,
                    SmtpTlsMode.None, "alarms@plant.local", new[] { "ops@plant.local" }, username: null));
                Assert.True(await store.SaveLocalAnnunciationAsync(enabled: true, AlarmPriority.High));
                // 🔴 Task C-6 — the fourth channel, now IMPLEMENTED. Its target is never driven here (no
                // alarm is raised), so this configures the channel without asserting anything about a
                // machine write; RelayNotificationChannelTests owns that.
                Assert.True(await store.SaveRelayAsync(
                    enabled: true, AlarmPriority.High, "MODBUS-01", RelayTargetKind.Command, "beacon"));
            },
            configureHost: builder => builder.ConfigureLogging(logging => logging.AddProvider(notices)));

        try
        {
            var active = Assert.Single(notices.Messages, m => m.Contains("ACTIVE on", StringComparison.Ordinal));
            Assert.Contains("ACTIVE on 4 channel(s)", active, StringComparison.Ordinal);
            Assert.Contains("Webhook", active, StringComparison.Ordinal);
            Assert.Contains("Smtp", active, StringComparison.Ordinal);
            Assert.Contains("LocalAnnunciation", active, StringComparison.Ordinal);
            Assert.Contains("Relay", active, StringComparison.Ordinal);

            // 🔴 And NOTHING is reported as undeliverable. Deleting any one of the four
            // implementedNotificationChannels.Add(...) lines fails BOTH halves at once.
            Assert.DoesNotContain(
                notices.Messages, m => m.Contains("no delivery implementation", StringComparison.Ordinal));
        }
        finally
        {
            factory.Dispose();
            try { Directory.Delete(alarmsDir, recursive: true); } catch { /* best-effort */ }
        }
    }

    /// <summary>Collects what the host logs during startup, so a test can assert on the notices
    /// <c>Program.cs</c> emits before <c>app.Run()</c> — the only place the implemented-channel set is
    /// observable from outside.</summary>
    private sealed class CapturingLoggerProvider : ILoggerProvider
    {
        private readonly List<string> _messages = new();

        public IReadOnlyList<string> Messages
        {
            get { lock (_messages) return _messages.ToList(); }
        }

        public ILogger CreateLogger(string categoryName) => new Collector(this);

        public void Dispose() { }

        private sealed class Collector(CapturingLoggerProvider owner) : ILogger
        {
            public IDisposable? BeginScope<TState>(TState state) where TState : notnull => null;

            public bool IsEnabled(LogLevel logLevel) => true;

            public void Log<TState>(
                LogLevel logLevel, EventId eventId, TState state, Exception? exception,
                Func<TState, Exception?, string> formatter)
            {
                var message = formatter(state, exception);
                lock (owner._messages) owner._messages.Add(message);
            }
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
