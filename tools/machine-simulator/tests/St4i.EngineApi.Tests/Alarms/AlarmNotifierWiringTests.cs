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
/// Same env-var-swap-then-eager-build protocol and shared
/// <see cref="SecurityEnvVarTests.CollectionName"/> collection tag as
/// <c>PolicyEndpointGatingTests</c>/<c>RbacPolicyTests</c> — every per-concern directory is redirected to a
/// throwaway temp dir so no host built here touches <c>%ProgramData%\ST4I\sim\...</c>.
/// </summary>
[Collection(SecurityEnvVarTests.CollectionName)]
public sealed class AlarmNotifierWiringTests
{
    private static readonly SemaphoreSlim EnvLock = new(1, 1);

    private static async Task<WebApplicationFactory<Program>> CreateFactoryAsync(string? notifyEnabled, string alarmsDir)
    {
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
            ["ST4I_ALARM_NOTIFY_ENABLED"] = Environment.GetEnvironmentVariable("ST4I_ALARM_NOTIFY_ENABLED"),
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
            Environment.SetEnvironmentVariable("ST4I_ALARM_NOTIFY_ENABLED", notifyEnabled);
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

    /// <summary>🔴 The batch is additive and DEFAULT-OFF: with the gate unset, the notifier is not
    /// registered at all — no background drain loop, no hosted service — and the alarm store resolves
    /// exactly the object graph it resolved before Đợt C.</summary>
    [Fact]
    public async Task DefaultOff_RegistersNoNotifierAtAll_AndTheAlarmStoreStillWorks()
    {
        var alarmsDir = Directory.CreateTempSubdirectory("st4i-notifywire-alarms-").FullName;
        var factory = await CreateFactoryAsync(notifyEnabled: null, alarmsDir);
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

    /// <summary>Switched on, the whole graph resolves (no DI cycle between the store and the notifier) and
    /// <see cref="AlarmNotifierSeedService"/> really runs during host start: an alarm written to
    /// <c>alarms.db</c> BEFORE the host existed is adopted as one
    /// <see cref="AlarmEdgeKind.Restored"/>, and its subsequent re-raises are suppressed.</summary>
    [Fact]
    public async Task Enabled_ResolvesTheWholeGraph_AndSeedsFromAlarmsDbAtStartup()
    {
        var alarmsDir = Directory.CreateTempSubdirectory("st4i-notifywire-alarms-").FullName;

        // A previous "process" leaves an alarm standing in alarms.db.
        var raise = new AlarmRaise(
            AlarmSource.DriverHealth, "DOWN", AlarmPriority.Critical, "left over", TargetId: "slot-9");
        await new AlarmStore(alarmsDir).RaiseAsync(raise);

        var factory = await CreateFactoryAsync(notifyEnabled: "1", alarmsDir);
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
}
