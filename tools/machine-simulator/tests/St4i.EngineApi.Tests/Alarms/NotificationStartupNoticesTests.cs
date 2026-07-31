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
/// ENTIRE input space of <see cref="NotificationStartupNotices.Describe"/> and asserts the property
/// directly.</para>
///
/// <para>🔴 <b>Task C-3 widened that input space, and had to.</b> C-2's second argument was a single
/// <c>bool hasDeliveryImplementation</c>, which was a whole-build fact only because in C-2 it was uniformly
/// <see langword="false"/>. C-3 is the task that makes it true, at which point one boolean claims a
/// delivery implementation for SMTP, local annunciation and relay as well — a build that cannot send an
/// email would have reported "Alarm notifications are ACTIVE on 1 channel(s): Smtp". The parameter is now
/// the SET of channels this build can deliver, and the space grows from 3⁴ × 2 = 162 to 6⁴ = 1296.</para>
/// </summary>
public sealed class NotificationStartupNoticesTests
{
    /// <summary>What one channel's configuration state is in a generated combination.</summary>
    private enum ChannelState { Absent, ConfiguredDisabled, ConfiguredEnabled }

    private static readonly IReadOnlySet<NotificationChannel> AllImplemented =
        new HashSet<NotificationChannel>(Enum.GetValues<NotificationChannel>());

    private static readonly IReadOnlySet<NotificationChannel> NoneImplemented =
        new HashSet<NotificationChannel>();

    private static IReadOnlySet<NotificationChannel> Implemented(params NotificationChannel[] channels) =>
        new HashSet<NotificationChannel>(channels);

    private static NotificationChannelSummary Summary(NotificationChannel channel, bool enabled) =>
        new(channel, NotificationConfigStore.DefaultInstance, enabled, AlarmPriority.High, DateTimeOffset.UtcNow);

    /// <summary>Every assignment, to each of the four channels, of a <see cref="ChannelState"/> AND whether
    /// this build implements it — (3 × 2)⁴ = 1296 combinations.</summary>
    private static IEnumerable<(IReadOnlyList<NotificationChannelSummary> Channels,
                                IReadOnlySet<NotificationChannel> Implemented)> AllConfigurations()
    {
        var channels = Enum.GetValues<NotificationChannel>();
        var states = Enum.GetValues<ChannelState>();
        var perChannel = states.Length * 2;
        var total = (int)Math.Pow(perChannel, channels.Length);

        for (var combination = 0; combination < total; combination++)
        {
            var list = new List<NotificationChannelSummary>();
            var implemented = new HashSet<NotificationChannel>();
            var remaining = combination;

            foreach (var channel in channels)
            {
                var slot = remaining % perChannel;
                remaining /= perChannel;

                if (slot >= states.Length) implemented.Add(channel);
                var state = states[slot % states.Length];

                if (state == ChannelState.ConfiguredDisabled) list.Add(Summary(channel, enabled: false));
                else if (state == ChannelState.ConfiguredEnabled) list.Add(Summary(channel, enabled: true));
            }

            yield return (list, implemented);
        }
    }

    // ─────────────────────────────────────────────────────────────────────
    // The headline invariant.
    // ─────────────────────────────────────────────────────────────────────

    /// <summary>
    /// 🔴 THE test this task exists to make possible: <b>there is no reachable configuration in which
    /// nothing will be delivered and the host says nothing about it</b> — plus, since C-3, <b>no reachable
    /// configuration in which a channel an operator ENABLED is silently unimplemented.</b>
    ///
    /// <para>Asserted over all 1296 cases, with every branch count derived independently and asserted, so a
    /// generator that silently stopped producing cases could not make this pass vacuously. A future task
    /// that adds a fifth channel, or a new quiet state, cannot reintroduce the silent-misconfiguration
    /// failure without turning this red.</para>
    /// </summary>
    [Fact]
    public void NoConfigurationCanBeSilentlyInert_OverTheEntireInputSpace()
    {
        var cases = 0;
        var silentCases = 0;
        var deliveringCases = 0;
        var partiallyImplementedCases = 0;
        var cleanlyDeliveringCases = 0;

        foreach (var (channels, implemented) in AllConfigurations())
        {
            cases++;

            var willDeliver = NotificationStartupNotices.WillDeliver(channels, implemented);
            var notices = NotificationStartupNotices.Describe(channels, implemented);
            var enabledButUnimplemented = channels
                .Where(c => c.Enabled && !implemented.Contains(c.Channel))
                .ToList();

            if (willDeliver)
            {
                deliveringCases++;
                Assert.Contains(notices, notice => notice.Severity == NotificationNoticeSeverity.Information);
            }
            else
            {
                silentCases++;
                // The invariant C-2 built this function for.
                Assert.Contains(notices, notice => notice.Severity == NotificationNoticeSeverity.Warning);
            }

            if (enabledButUnimplemented.Count > 0)
            {
                partiallyImplementedCases++;

                // 🔴 The C-3 addition: each enabled-but-undeliverable channel is NAMED, even when some
                // other channel is delivering perfectly well and the host is otherwise reporting success.
                var warning = Assert.Single(
                    notices,
                    n => n.Severity == NotificationNoticeSeverity.Warning &&
                         n.Message.Contains("no delivery implementation", StringComparison.Ordinal));
                foreach (var channel in enabledButUnimplemented)
                {
                    Assert.Contains(channel.Channel.ToString(), warning.Message, StringComparison.Ordinal);
                }
            }
            else if (willDeliver)
            {
                cleanlyDeliveringCases++;

                // The complement matters too: when every enabled channel really will be delivered, the host
                // must not cry wolf. (The credential warnings are about credentials, not the gate, and
                // cannot occur here — these summaries carry no SMTP or webhook configuration.)
                Assert.DoesNotContain(notices, notice => notice.Severity == NotificationNoticeSeverity.Warning);
            }
        }

        // (3 configuration states × implemented-or-not)^4 channels.
        Assert.Equal(1296, cases);

        // Non-vacuity, every count derived rather than observed:
        //   delivering            = at least one channel is (Enabled AND implemented). Per channel 5 of the
        //                           6 slots are NOT that, so 6^4 - 5^4 = 1296 - 625 = 671.
        //   silent                = the complement, 625.
        //   partiallyImplemented  = at least one channel is (Enabled AND NOT implemented) — the same
        //                           arithmetic mirrored, 671.
        //   cleanlyDelivering     = no channel is (Enabled AND NOT implemented) [5^4 = 625] minus those
        //                           where none is (Enabled AND implemented) either [4^4 = 256] = 369.
        Assert.Equal(671, deliveringCases);
        Assert.Equal(625, silentCases);
        Assert.Equal(671, partiallyImplementedCases);
        Assert.Equal(369, cleanlyDeliveringCases);
    }

    // ─────────────────────────────────────────────────────────────────────
    // The specific states, named — so a failure says WHICH one regressed.
    // ─────────────────────────────────────────────────────────────────────

    [Fact]
    public void NothingConfiguredAtAll_WarnsThatAlarmsReachNobody()
    {
        var notices = NotificationStartupNotices.Describe(
            Array.Empty<NotificationChannelSummary>(), AllImplemented);

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

        var notices = NotificationStartupNotices.Describe(channels, AllImplemented);

        var warning = Assert.Single(notices, n => n.Severity == NotificationNoticeSeverity.Warning);
        Assert.Contains("CONFIGURED", warning.Message);
        Assert.Contains("DISABLED", warning.Message);
        // Names them, so an operator does not have to go looking for which ones.
        Assert.Contains("Webhook", warning.Message);
        Assert.Contains("Smtp", warning.Message);
    }

    /// <summary>The honest state of the world for any channel whose task has not landed: an operator can
    /// configure and enable it today and this build still delivers nothing through it. That must be said
    /// out loud rather than looking like success.</summary>
    [Fact]
    public void EnabledButThisBuildHasNoDeliveryImplementation_SaysSoInsteadOfLookingHealthy()
    {
        var channels = new[] { Summary(NotificationChannel.Webhook, enabled: true) };

        var notices = NotificationStartupNotices.Describe(channels, NoneImplemented);

        var warning = Assert.Single(notices, n => n.Severity == NotificationNoticeSeverity.Warning);
        Assert.Contains("no delivery implementation", warning.Message);
        Assert.Contains("DISCARDED", warning.Message);
        Assert.False(NotificationStartupNotices.WillDeliver(channels, NoneImplemented));
    }

    [Fact]
    public void EnabledWithARealDeliveryImplementation_ReportsActiveAndWarnsAboutNothing()
    {
        var channels = new[]
        {
            Summary(NotificationChannel.Webhook, enabled: true),
            Summary(NotificationChannel.Relay, enabled: false),
        };

        var notices = NotificationStartupNotices.Describe(
            channels, Implemented(NotificationChannel.Webhook));

        var info = Assert.Single(notices);
        Assert.Equal(NotificationNoticeSeverity.Information, info.Severity);
        Assert.Contains("ACTIVE", info.Message);
        Assert.Contains("Webhook", info.Message);
        Assert.True(NotificationStartupNotices.WillDeliver(channels, Implemented(NotificationChannel.Webhook)));
    }

    /// <summary>
    /// 🔴 The regression Task C-3 would have shipped with C-2's single boolean, pinned by name.
    ///
    /// <para>C-3 is the first task to give the host a real delivery implementation. With one flag, turning
    /// it on for the webhook turned it on for every channel: this exact configuration — a delivering
    /// webhook next to an enabled SMTP channel that C-4 has not built yet — would have produced
    /// <b>"Alarm notifications are ACTIVE on 2 channel(s): Webhook, Smtp"</b> and nothing else. An operator
    /// who had configured an e-mail recipient would have been told, in so many words, that it was
    /// working.</para>
    /// </summary>
    [Fact]
    public void AChannelWithNoImplementation_IsStillNamed_EvenWhileAnotherChannelIsDeliveringFine()
    {
        var channels = new[]
        {
            Summary(NotificationChannel.Webhook, enabled: true),
            Summary(NotificationChannel.Smtp, enabled: true),
        };

        var notices = NotificationStartupNotices.Describe(
            channels, Implemented(NotificationChannel.Webhook));

        var info = Assert.Single(notices, n => n.Severity == NotificationNoticeSeverity.Information);
        Assert.Contains("ACTIVE", info.Message);
        Assert.Contains("Webhook", info.Message);
        // The heart of it: the ACTIVE line must not claim the channel this build cannot send.
        Assert.DoesNotContain("Smtp", info.Message);

        var warning = Assert.Single(notices, n => n.Severity == NotificationNoticeSeverity.Warning);
        Assert.Contains("no delivery implementation", warning.Message);
        Assert.Contains("Smtp", warning.Message);
        Assert.DoesNotContain("Webhook", warning.Message);

        // And "something will be delivered" is still true, because the webhook will be.
        Assert.True(NotificationStartupNotices.WillDeliver(channels, Implemented(NotificationChannel.Webhook)));
    }

    /// <summary>
    /// 🔴 Task C-4 — <b>the new arm, and the reason the flag was made a SET rather than a bool.</b> C-4
    /// adds exactly one <c>HashSet</c> member in <c>Program.cs</c>, and this is what that member is worth:
    /// the "configured, ENABLED and still silent" warning stops firing for SMTP, with no wording anywhere
    /// having had to be remembered and changed.
    ///
    /// <para>Deliberately asserted as a TRANSITION — the same configuration described twice, once against
    /// the set this build had before C-4 and once against the set it has now — because the property under
    /// test is that adding a member is sufficient. Asserting only the post-C-4 state would pass equally
    /// well for a build that had hard-coded the answer.</para>
    ///
    /// <para>The two channels C-5 and C-6 own are still enabled and still unimplemented in both cases, so
    /// this also pins that the warning did not simply stop working.</para>
    /// </summary>
    [Fact]
    public void AddingSmtpToTheImplementedSet_IsTheWholeOfWhatStopsTheSilentChannelWarning()
    {
        var channels = new[]
        {
            Summary(NotificationChannel.Webhook, enabled: true),
            Summary(NotificationChannel.Smtp, enabled: true),
            Summary(NotificationChannel.LocalAnnunciation, enabled: true),
            Summary(NotificationChannel.Relay, enabled: true),
        };

        // Before C-4: the webhook delivers, and SMTP is named as silent.
        var beforeC4 = NotificationStartupNotices.Describe(
            channels, Implemented(NotificationChannel.Webhook));
        var beforeWarning = Assert.Single(
            beforeC4, n => n.Message.Contains("no delivery implementation", StringComparison.Ordinal));
        Assert.Contains("Smtp", beforeWarning.Message, StringComparison.Ordinal);

        // After C-4: the same configuration, one more set member.
        var afterC4 = NotificationStartupNotices.Describe(
            channels, Implemented(NotificationChannel.Webhook, NotificationChannel.Smtp));

        var active = Assert.Single(afterC4, n => n.Severity == NotificationNoticeSeverity.Information);
        Assert.Contains("ACTIVE on 2 channel(s)", active.Message, StringComparison.Ordinal);
        Assert.Contains("Webhook", active.Message, StringComparison.Ordinal);
        Assert.Contains("Smtp", active.Message, StringComparison.Ordinal);

        var afterWarning = Assert.Single(
            afterC4, n => n.Message.Contains("no delivery implementation", StringComparison.Ordinal));
        // 🔴 The transition: SMTP has left the silent list, and nothing else has.
        Assert.DoesNotContain("Smtp", afterWarning.Message, StringComparison.Ordinal);
        Assert.Contains("LocalAnnunciation", afterWarning.Message, StringComparison.Ordinal);
        Assert.Contains("Relay", afterWarning.Message, StringComparison.Ordinal);
        Assert.Contains("2 alarm notification channel(s)", afterWarning.Message, StringComparison.Ordinal);
    }

    // ─────────────────────────────────────────────────────────────────────
    // The credential-handling warnings.
    // ─────────────────────────────────────────────────────────────────────

    /// <summary>🔴 Task C-3 — the webhook parallel of the SMTP clear-text warning: a static auth token over
    /// plain HTTP crosses the network in the clear on every alarm, and the HMAC signature does not help
    /// because it authenticates rather than encrypts.</summary>
    [Fact]
    public void AWebhookAuthTokenOverPlainHttp_IsWarnedAbout()
    {
        var notices = NotificationStartupNotices.Describe(
            new[] { WebhookSummary("http://mes.plant", "X-Api-Key", hasAuthToken: true) },
            Implemented(NotificationChannel.Webhook));

        var warning = Assert.Single(notices, n => n.Severity == NotificationNoticeSeverity.Warning);
        Assert.Contains("clear text", warning.Message);
        Assert.Contains("X-Api-Key", warning.Message);
        Assert.Contains("https://", warning.Message);
        // The gate itself is healthy, so the ACTIVE information line is still there.
        Assert.Contains(notices, n => n.Severity == NotificationNoticeSeverity.Information);
    }

    [Fact]
    public void AWebhookAuthTokenOverHttps_IsNotWarnedAbout()
    {
        var notices = NotificationStartupNotices.Describe(
            new[] { WebhookSummary("https://mes.plant", "X-Api-Key", hasAuthToken: true) },
            Implemented(NotificationChannel.Webhook));

        Assert.DoesNotContain(notices, n => n.Severity == NotificationNoticeSeverity.Warning);
    }

    /// <summary>The deliberate non-fatigue choice: plain HTTP to an in-plant receiver on an isolated
    /// network is a configuration this product accepts, and warning about every one of them is how the
    /// SMTP clear-text warning next door stops being read. The warning fires on a CREDENTIAL crossing the
    /// wire, not on a scheme.</summary>
    [Fact]
    public void AWebhookOverPlainHttpWithNoStoredToken_IsNotWarnedAbout()
    {
        var notices = NotificationStartupNotices.Describe(
            new[] { WebhookSummary("http://mes.plant", authHeaderName: null, hasAuthToken: false) },
            Implemented(NotificationChannel.Webhook));

        Assert.DoesNotContain(notices, n => n.Severity == NotificationNoticeSeverity.Warning);
    }

    /// <summary>An SMTP password over an unsecured connection is sent in clear text. The store accepts
    /// that configuration (it is legitimate on an isolated in-plant relay with no auth), so the host says
    /// so once per boot rather than the product pretending it did not notice.</summary>
    [Fact]
    public void AnSmtpPasswordWithoutTls_IsWarnedAboutSeparatelyFromTheGate()
    {
        var notices = NotificationStartupNotices.Describe(
            new[] { SmtpSummary(25, SmtpTlsMode.None, hasPassword: true) }, AllImplemented);

        Assert.Contains(notices, n =>
            n.Severity == NotificationNoticeSeverity.Warning && n.Message.Contains("clear text"));
        // The gate itself is healthy, so the ACTIVE information line is still there.
        Assert.Contains(notices, n => n.Severity == NotificationNoticeSeverity.Information);
    }

    [Fact]
    public void AnSmtpPasswordWithStartTls_IsNotWarnedAbout()
    {
        var notices = NotificationStartupNotices.Describe(
            new[] { SmtpSummary(587, SmtpTlsMode.StartTls, hasPassword: true) }, AllImplemented);

        Assert.DoesNotContain(notices, n => n.Message.Contains("clear text"));
        Assert.DoesNotContain(notices, n => n.Message.Contains("implicit TLS"));
    }

    /// <summary>
    /// 🔴 Review round 1 — port 465 is implicit TLS (SMTPS), and
    /// <see cref="System.Net.Mail.SmtpClient"/> — which C-4 must use — implements only RFC 3207 STARTTLS.
    /// It cannot complete a handshake there in EITHER mode. <see cref="SmtpTlsMode"/> correctly offers no
    /// implicit-TLS member, but an enum's silence does not help an operator who simply types the port their
    /// mail provider gave them.
    ///
    /// <para>🔴 <b>Task C-4 review (I-2) — this test used to assert the warning says "hang", and that was
    /// C-2 PREDICTING what a channel that did not yet exist would do.</b> C-4 built it and measured the
    /// opposite: the delivery is bounded by the attempt timeout and the total budget like any other
    /// unresponsive relay, and is counted as a lost notification. An operator told to expect a hang would
    /// go looking for a stuck process that this product cannot produce — and C-8 publishes this text. The
    /// assertion is inverted rather than deleted, so the false claim cannot come back.</para>
    /// </summary>
    [Theory]
    [InlineData(SmtpTlsMode.StartTls)]
    [InlineData(SmtpTlsMode.None)]
    public void Port465_IsWarnedAbout_BecauseSystemNetMailCannotSpeakImplicitTls(SmtpTlsMode tls)
    {
        var notices = NotificationStartupNotices.Describe(
            new[] { SmtpSummary(465, tls, hasPassword: false) }, AllImplemented);

        var warning = Assert.Single(notices, n => n.Severity == NotificationNoticeSeverity.Warning);
        Assert.Contains("465", warning.Message);
        Assert.Contains("implicit TLS", warning.Message);
        Assert.Contains("STARTTLS", warning.Message);

        // What actually happens, per C-4's measurement: nothing is delivered, and each attempt ends at the
        // budget and is counted as a loss.
        Assert.Contains("lost notification", warning.Message, StringComparison.OrdinalIgnoreCase);
        Assert.DoesNotContain("hang", warning.Message, StringComparison.OrdinalIgnoreCase);
    }

    [Fact]
    public void Port587_IsNotWarnedAbout()
    {
        var notices = NotificationStartupNotices.Describe(
            new[] { SmtpSummary(587, SmtpTlsMode.StartTls, hasPassword: false) }, AllImplemented);

        Assert.DoesNotContain(notices, n => n.Severity == NotificationNoticeSeverity.Warning);
    }

    private static NotificationChannelSummary SmtpSummary(int port, SmtpTlsMode tls, bool hasPassword) =>
        new(NotificationChannel.Smtp, NotificationConfigStore.DefaultInstance, Enabled: true,
            AlarmPriority.High, DateTimeOffset.UtcNow,
            Smtp: new SmtpChannelSummary(
                "mail.local", port, tls, "sim@plant", new[] { "ops@plant" }, "svc", hasPassword));

    private static NotificationChannelSummary WebhookSummary(
        string endpoint, string? authHeaderName, bool hasAuthToken) =>
        new(NotificationChannel.Webhook, NotificationConfigStore.DefaultInstance, Enabled: true,
            AlarmPriority.High, DateTimeOffset.UtcNow,
            Webhook: new WebhookChannelSummary(
                endpoint, "0123456789ABCDEF", "Ops MES", HasUrl: true, HasSigningSecret: true,
                authHeaderName, hasAuthToken));
}
