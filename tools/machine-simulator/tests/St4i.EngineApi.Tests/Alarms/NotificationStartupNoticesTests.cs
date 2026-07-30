using St4i.EngineApi.Alarms;
using Xunit;

namespace St4i.EngineApi.Tests.Alarms;

/// <summary>
/// 🔴 Task C-2 — proof that C-1's placeholder enable gate was COLLAPSED rather than merely replaced, and
/// that the failure it was collapsed to prevent is now unreachable.
///
/// <para>C-1's review named the exact outcome that must become impossible: an operator configures a
/// webhook completely correctly and gets "a fully configured, completely silent alarm system with no error
/// anywhere". The headline test here does not check that outcome on a few examples — it enumerates the
/// ENTIRE input space of <see cref="NotificationStartupNotices.Describe"/> (every channel absent /
/// configured-and-disabled / configured-and-enabled, crossed with with-and-without a delivery
/// implementation) and asserts the property directly.</para>
/// </summary>
public sealed class NotificationStartupNoticesTests
{
    /// <summary>What one channel's configuration state is in a generated combination.</summary>
    private enum ChannelState { Absent, ConfiguredDisabled, ConfiguredEnabled }

    private static NotificationChannelSummary Summary(NotificationChannel channel, bool enabled) =>
        new(channel, enabled, AlarmPriority.High, DateTimeOffset.UtcNow);

    /// <summary>Every assignment of a <see cref="ChannelState"/> to each of the four channels — 3^4 = 81
    /// configurations.</summary>
    private static IEnumerable<IReadOnlyList<NotificationChannelSummary>> AllConfigurations()
    {
        var channels = Enum.GetValues<NotificationChannel>();
        var states = Enum.GetValues<ChannelState>();
        var total = (int)Math.Pow(states.Length, channels.Length);

        for (var combination = 0; combination < total; combination++)
        {
            var list = new List<NotificationChannelSummary>();
            var remaining = combination;
            foreach (var channel in channels)
            {
                var state = states[remaining % states.Length];
                remaining /= states.Length;
                if (state == ChannelState.ConfiguredDisabled) list.Add(Summary(channel, enabled: false));
                else if (state == ChannelState.ConfiguredEnabled) list.Add(Summary(channel, enabled: true));
            }
            yield return list;
        }
    }

    // ─────────────────────────────────────────────────────────────────────
    // The headline invariant.
    // ─────────────────────────────────────────────────────────────────────

    /// <summary>
    /// 🔴 THE test this task exists to make possible: <b>there is no reachable configuration in which
    /// nothing will be delivered and the host says nothing about it.</b>
    ///
    /// <para>Asserted over all 81 channel configurations × both delivery-implementation states = 162
    /// cases, so a future task that adds a fifth channel, or a new quiet state, cannot reintroduce the
    /// silent-misconfiguration failure without turning this red. The combination count is itself asserted,
    /// so a generator that silently stopped producing cases could not make this pass vacuously.</para>
    /// </summary>
    [Fact]
    public void NoConfigurationCanBeSilentlyInert_OverTheEntireInputSpace()
    {
        var cases = 0;
        var silentCases = 0;
        var deliveringCases = 0;

        foreach (var channels in AllConfigurations())
        {
            foreach (var hasDelivery in new[] { false, true })
            {
                cases++;
                var willDeliver = NotificationStartupNotices.WillDeliver(channels, hasDelivery);
                var notices = NotificationStartupNotices.Describe(channels, hasDelivery);

                if (willDeliver)
                {
                    deliveringCases++;

                    // The complement matters too: when alarms WILL reach somebody, the host must not cry
                    // wolf about the gate. (The clear-text-password warning is about credentials, not the
                    // gate, and cannot occur here — these summaries carry no SMTP configuration.)
                    Assert.Contains(notices, notice => notice.Severity == NotificationNoticeSeverity.Information);
                    Assert.DoesNotContain(notices, notice => notice.Severity == NotificationNoticeSeverity.Warning);
                }
                else
                {
                    silentCases++;
                    Assert.Contains(notices, notice => notice.Severity == NotificationNoticeSeverity.Warning);
                }
            }
        }

        // 3^4 channel configurations × 2 delivery states.
        Assert.Equal(162, cases);

        // Non-vacuity in both directions: the space really does contain silent AND delivering cases, so
        // neither branch above went unexercised, and a generator that stopped early cannot pass.
        //   delivering = hasDelivery(1 of 2) AND at least one channel enabled.
        //                Configurations with NO enabled channel = 2^4 = 16 (each channel Absent or
        //                Disabled), so 81 - 16 = 65 have at least one.
        //   silent     = all 81 with no delivery implementation, plus the 16 with nothing enabled.
        Assert.Equal(65, deliveringCases);
        Assert.Equal(81 + 16, silentCases);
    }

    // ─────────────────────────────────────────────────────────────────────
    // The specific states, named — so a failure says WHICH one regressed.
    // ─────────────────────────────────────────────────────────────────────

    [Fact]
    public void NothingConfiguredAtAll_WarnsThatAlarmsReachNobody()
    {
        var notices = NotificationStartupNotices.Describe(
            Array.Empty<NotificationChannelSummary>(), hasDeliveryImplementation: true);

        var warning = Assert.Single(notices, n => n.Severity == NotificationNoticeSeverity.Warning);
        Assert.Contains("No alarm notification channel is configured", warning.Message);
        Assert.Contains("not looking at the screen", warning.Message);
    }

    /// <summary>🔴 The exact state C-1's review named: something IS configured and it delivers nothing.</summary>
    [Fact]
    public void ConfiguredButEveryChannelDisabled_IsLoudlyVisible()
    {
        var channels = new[]
        {
            Summary(NotificationChannel.Webhook, enabled: false),
            Summary(NotificationChannel.Smtp, enabled: false),
        };

        var notices = NotificationStartupNotices.Describe(channels, hasDeliveryImplementation: true);

        var warning = Assert.Single(notices, n => n.Severity == NotificationNoticeSeverity.Warning);
        Assert.Contains("CONFIGURED", warning.Message);
        Assert.Contains("DISABLED", warning.Message);
        // Names them, so an operator does not have to go looking for which ones.
        Assert.Contains("Webhook", warning.Message);
        Assert.Contains("Smtp", warning.Message);
    }

    /// <summary>The honest C-2 state of the world: an operator can configure and enable a channel today,
    /// and this build still delivers nothing because no channel implementation exists yet. That must be
    /// said out loud rather than looking like success.</summary>
    [Fact]
    public void EnabledButThisBuildHasNoDeliveryImplementation_SaysSoInsteadOfLookingHealthy()
    {
        var channels = new[] { Summary(NotificationChannel.Webhook, enabled: true) };

        var notices = NotificationStartupNotices.Describe(channels, hasDeliveryImplementation: false);

        var warning = Assert.Single(notices, n => n.Severity == NotificationNoticeSeverity.Warning);
        Assert.Contains("no delivery implementation", warning.Message);
        Assert.Contains("DISCARDED", warning.Message);
        Assert.False(NotificationStartupNotices.WillDeliver(channels, hasDeliveryImplementation: false));
    }

    [Fact]
    public void EnabledWithARealDeliveryImplementation_ReportsActiveAndWarnsAboutNothing()
    {
        var channels = new[]
        {
            Summary(NotificationChannel.Webhook, enabled: true),
            Summary(NotificationChannel.Relay, enabled: false),
        };

        var notices = NotificationStartupNotices.Describe(channels, hasDeliveryImplementation: true);

        var info = Assert.Single(notices);
        Assert.Equal(NotificationNoticeSeverity.Information, info.Severity);
        Assert.Contains("ACTIVE", info.Message);
        Assert.Contains("Webhook", info.Message);
        Assert.True(NotificationStartupNotices.WillDeliver(channels, hasDeliveryImplementation: true));
    }

    // ─────────────────────────────────────────────────────────────────────
    // ShouldRunTheSeam — configured, not enabled, is what brings the seam up.
    // ─────────────────────────────────────────────────────────────────────

    [Fact]
    public void ShouldRunTheSeam_IsFalseOnlyWhenNothingIsConfiguredAtAll()
    {
        Assert.False(NotificationStartupNotices.ShouldRunTheSeam(Array.Empty<NotificationChannelSummary>()));

        // 🔴 Configured-but-disabled DOES run the seam, so that flipping `enabled` at runtime takes effect
        // without a restart. If this ever becomes false, C-1's trap has been rebuilt one layer down.
        Assert.True(NotificationStartupNotices.ShouldRunTheSeam(
            new[] { Summary(NotificationChannel.Smtp, enabled: false) }));
        Assert.True(NotificationStartupNotices.ShouldRunTheSeam(
            new[] { Summary(NotificationChannel.Smtp, enabled: true) }));
    }

    // ─────────────────────────────────────────────────────────────────────
    // The credential-handling warning.
    // ─────────────────────────────────────────────────────────────────────

    /// <summary>An SMTP password over an unsecured connection is sent in clear text. The store accepts
    /// that configuration (it is legitimate on an isolated in-plant relay with no auth), so the host says
    /// so once per boot rather than the product pretending it did not notice.</summary>
    [Fact]
    public void AnSmtpPasswordWithoutTls_IsWarnedAboutSeparatelyFromTheGate()
    {
        var channels = new[]
        {
            new NotificationChannelSummary(
                NotificationChannel.Smtp, Enabled: true, AlarmPriority.High, DateTimeOffset.UtcNow,
                Smtp: new SmtpChannelSummary(
                    "mail.local", 25, SmtpTlsMode.None, "sim@plant", new[] { "ops@plant" }, "svc",
                    HasPassword: true)),
        };

        var notices = NotificationStartupNotices.Describe(channels, hasDeliveryImplementation: true);

        Assert.Contains(notices, n =>
            n.Severity == NotificationNoticeSeverity.Warning && n.Message.Contains("clear text"));
        // The gate itself is healthy, so the ACTIVE information line is still there.
        Assert.Contains(notices, n => n.Severity == NotificationNoticeSeverity.Information);
    }

    [Fact]
    public void AnSmtpPasswordWithStartTls_IsNotWarnedAbout()
    {
        var channels = new[]
        {
            new NotificationChannelSummary(
                NotificationChannel.Smtp, Enabled: true, AlarmPriority.High, DateTimeOffset.UtcNow,
                Smtp: new SmtpChannelSummary(
                    "mail.local", 587, SmtpTlsMode.StartTls, "sim@plant", new[] { "ops@plant" }, "svc",
                    HasPassword: true)),
        };

        var notices = NotificationStartupNotices.Describe(channels, hasDeliveryImplementation: true);

        Assert.DoesNotContain(notices, n => n.Message.Contains("clear text"));
    }
}
