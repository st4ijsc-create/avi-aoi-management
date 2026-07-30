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
    /// notifications directory BEFORE the host is built — the C-2 replacement for C-1's env-var switch.</param>
    /// <param name="channelEnabled">Whether that channel is enabled. Configured-but-disabled must STILL
    /// register the seam — see <see cref="NotificationStartupNotices.ShouldRunTheSeam"/>.</param>
    /// <param name="legacyEnvGate">A value for the deleted <c>ST4I_ALARM_NOTIFY_ENABLED</c> variable, to
    /// prove it is inert.</param>
    private static async Task<WebApplicationFactory<Program>> CreateFactoryAsync(
        bool configureAChannel, string alarmsDir, bool channelEnabled = true, string? legacyEnvGate = null)
    {
        var notificationsDir = Directory.CreateTempSubdirectory("st4i-notifywire-notifications-").FullName;
        if (configureAChannel)
        {
            // A channel an operator configured in some earlier session. Local annunciation is used because
            // it is the one channel with no side-table configuration of its own, so this seeds the gate
            // without asserting anything about a channel implementation that does not exist yet.
            var configStore = new NotificationConfigStore(notificationsDir);
            Assert.True(await configStore.SaveLocalAnnunciationAsync(channelEnabled, AlarmPriority.High)
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

    /// <summary>🔴 The batch is additive and DEFAULT-OFF: on a fresh install with NO channel configured,
    /// the notifier is not registered at all — no background drain loop, no hosted service — and the alarm
    /// store resolves exactly the object graph it resolved before Đợt C. Task C-2 preserves this exactly;
    /// only the thing being read changed (an empty config store, not an unset env var).</summary>
    [Fact]
    public async Task NothingConfigured_RegistersNoNotifierAtAll_AndTheAlarmStoreStillWorks()
    {
        var alarmsDir = Directory.CreateTempSubdirectory("st4i-notifywire-alarms-").FullName;
        var factory = await CreateFactoryAsync(configureAChannel: false, alarmsDir);
        try
        {
            Assert.Null(factory.Services.GetService<IAlarmNotifier>());
            Assert.Null(factory.Services.GetService<AlarmNotifier>());

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
    /// 🔴 Task C-2 — a channel that is CONFIGURED but DISABLED still brings the seam up.
    ///
    /// <para>This is the deliberate asymmetry in <see cref="NotificationStartupNotices.ShouldRunTheSeam"/>,
    /// and it exists to stop the C-1 trap being rebuilt one layer down: if registration depended on
    /// <c>enabled</c>, an operator (or C-7's endpoint) toggling a channel on would change nothing until
    /// somebody restarted the process, with no error to explain the silence — the exact shape of failure
    /// this task was written to remove. Because the seam is already running, only the channel's own flag
    /// has to change.</para>
    /// </summary>
    [Fact]
    public async Task AConfiguredButDisabledChannel_StillRegistersTheSeam_SoARuntimeEnableNeedsNoRestart()
    {
        var alarmsDir = Directory.CreateTempSubdirectory("st4i-notifywire-alarms-").FullName;
        var factory = await CreateFactoryAsync(configureAChannel: true, alarmsDir, channelEnabled: false);
        try
        {
            Assert.NotNull(factory.Services.GetService<AlarmNotifier>());
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

    /// <summary>
    /// 🔴 Task C-2 — the gate really was COLLAPSED, not merely supplemented: C-1's
    /// <c>ST4I_ALARM_NOTIFY_ENABLED</c> is set to <c>"1"</c> here — the value that used to switch the whole
    /// seam on — and with no channel configured it does exactly nothing.
    ///
    /// <para>Worth its own test because "we deleted the env var" is the kind of claim that quietly stops
    /// being true: someone restoring the variable as a convenience switch would reintroduce two disagreeing
    /// enable mechanisms, and this test fails the moment they do.</para>
    /// </summary>
    [Fact]
    public async Task TheDeletedEnvGate_HasNoEffect_ConfigurationIsTheOnlySwitch()
    {
        var alarmsDir = Directory.CreateTempSubdirectory("st4i-notifywire-alarms-").FullName;
        var factory = await CreateFactoryAsync(configureAChannel: false, alarmsDir, legacyEnvGate: "1");
        try
        {
            Assert.Null(factory.Services.GetService<IAlarmNotifier>());
            Assert.Null(factory.Services.GetService<AlarmNotifier>());
        }
        finally
        {
            factory.Dispose();
            try { Directory.Delete(alarmsDir, recursive: true); } catch { /* best-effort */ }
        }
    }
}
