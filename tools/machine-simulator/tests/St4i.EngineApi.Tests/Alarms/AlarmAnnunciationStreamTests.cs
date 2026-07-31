using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using System.Text.Json.Serialization;
using Microsoft.AspNetCore.Identity;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.Extensions.DependencyInjection;
using St4i.EngineApi.Alarms;
using St4i.EngineApi.Auth;
using St4i.EngineApi.Hubs;
using St4i.EngineApi.Tests.Auth;
using Xunit;

namespace St4i.EngineApi.Tests.Alarms;

/// <summary>
/// 🔴 Task C-5 — <c>GET /v1/alarms/annunciations</c> through the REAL host: the wire between
/// <see cref="LocalAnnunciationChannel"/> and an open browser page, and the ONE place the whole chain can be
/// proved end to end — a real alarm raised on the store the host resolves, through C-1's real edge detector,
/// through the real channel, out of a real HTTP response as a real SSE frame.
///
/// <para>Every other C-5 test drives the channel or the hub directly. Those cannot see the two things that
/// actually break in production: whether <c>Program.cs</c> connected the channel at all, and whether the SSE
/// framing on the wire is what a browser will parse.</para>
///
/// <para>Same env-var-swap-then-eager-build factory recipe and shared
/// <see cref="SecurityEnvVarTests.CollectionName"/> collection tag as
/// <c>AlarmEndpointsTests</c>/<c>AlarmNotifierWiringTests</c> — every per-concern directory is redirected to
/// a throwaway temp dir so no host built here touches <c>%ProgramData%\ST4I\sim\...</c>.</para>
/// </summary>
[Collection(SecurityEnvVarTests.CollectionName)]
public sealed class AlarmAnnunciationStreamTests
{
    private static readonly SemaphoreSlim EnvLock = new(1, 1);
    private static readonly JsonSerializerOptions JsonOptions = new(JsonSerializerDefaults.Web);
    private static readonly JsonSerializerOptions JsonOptionsWithEnums = new(JsonSerializerDefaults.Web)
    {
        Converters = { new JsonStringEnumConverter() },
    };

    /// <param name="alarmsDir">🔴 Review round 1 (I-2) — supplied by the standing-replay tests so an alarm
    /// can be left in <c>alarms.db</c> BEFORE the host boots, which is the only way to reproduce the case
    /// that matters: C-1's <c>Restored</c> edge firing at seed time with nobody connected.</param>
    private static async Task<WebApplicationFactory<Program>> CreateFactoryAsync(
        Func<NotificationConfigStore, Task>? configure = null,
        string? alarmsDir = null,
        int? maxListeners = null)
    {
        var notificationsDir = Directory.CreateTempSubdirectory("st4i-annunstream-notifications-").FullName;
        if (configure is not null)
        {
            await configure(new NotificationConfigStore(notificationsDir)).ConfigureAwait(false);
        }

        var dirs = new Dictionary<string, string>
        {
            ["ST4I_SECURITY_DIR"] = Directory.CreateTempSubdirectory("st4i-annunstream-security-").FullName,
            ["ST4I_HISTORIAN_DIR"] = Directory.CreateTempSubdirectory("st4i-annunstream-historian-").FullName,
            ["ST4I_WAL_DIR"] = Directory.CreateTempSubdirectory("st4i-annunstream-wal-").FullName,
            ["ST4I_SETTINGS_DIR"] = Directory.CreateTempSubdirectory("st4i-annunstream-settings-").FullName,
            ["ST4I_ASSETS_DIR"] = Directory.CreateTempSubdirectory("st4i-annunstream-assets-").FullName,
            ["ST4I_ALARMS_DIR"] = alarmsDir
                ?? Directory.CreateTempSubdirectory("st4i-annunstream-alarms-").FullName,
            ["ST4I_IDENTITY_DIR"] = Directory.CreateTempSubdirectory("st4i-annunstream-identity-").FullName,
            ["ST4I_SITELINK_DIR"] = Directory.CreateTempSubdirectory("st4i-annunstream-sitelink-").FullName,
            ["ST4I_BRIDGE_SPOOL_DIR"] = Directory.CreateTempSubdirectory("st4i-annunstream-bridgespool-").FullName,
            ["ST4I_CONNECTOR_CONFIG_DIR"] = Directory.CreateTempSubdirectory("st4i-annunstream-connectorcfg-").FullName,
            [NotificationConfigStore.EnvVarDir] = notificationsDir,
        };

        await EnvLock.WaitAsync().ConfigureAwait(false);
        var previous = dirs.Keys
            .Concat(new[] { "ST4I_DEMO_ENABLED", "ASPNETCORE_ENVIRONMENT" })
            .ToDictionary(name => name, Environment.GetEnvironmentVariable);
        try
        {
            foreach (var (name, value) in dirs) Environment.SetEnvironmentVariable(name, value);
            Environment.SetEnvironmentVariable("ST4I_DEMO_ENABLED", null);
            Environment.SetEnvironmentVariable("ASPNETCORE_ENVIRONMENT", "Production");

            // 🔴 Task C-7 — the subscriber cap is a PRODUCTION constant of 32, and a test that opened 33
            // real SSE connections to observe it would be slow, flaky and would prove the same thing. The
            // last AddSingleton wins, so this replaces the hub Program.cs registered with one whose cap the
            // test chose. The production DEFAULT is asserted separately, so shrinking it here cannot
            // quietly change what ships.
            var factory = maxListeners is null
                ? new WebApplicationFactory<Program>()
                : new WebApplicationFactory<Program>().WithWebHostBuilder(builder =>
                    builder.ConfigureServices(services =>
                        services.AddSingleton(new AlarmAnnunciationHub(maxListeners: maxListeners.Value))));
            _ = factory.Server; // build AND start the host now, while the env vars above are still set.
            return factory;
        }
        finally
        {
            foreach (var (name, value) in previous) Environment.SetEnvironmentVariable(name, value);
            EnvLock.Release();
        }
    }

    private static async Task<HttpClient> LoginAsOperatorAsync(WebApplicationFactory<Program> factory)
    {
        using (var bootstrapClient = factory.CreateClient())
        using (var bootstrap = await bootstrapClient.PostAsJsonAsync(
                   "/v1/auth/bootstrap",
                   new { username = "annun-admin", password = "AdminPass123!", displayName = (string?)null },
                   JsonOptions))
        {
            Assert.Equal(HttpStatusCode.OK, bootstrap.StatusCode);
        }

        var userStore = factory.Services.GetRequiredService<IUserStore>();
        var hash = new PasswordHasher<AppUser>().HashPassword(AppUser.Instance, "OperatorPass123!");
        await userStore.CreateAsync("annun-operator", hash, Roles.Operator, null, "test", CancellationToken.None);

        var client = factory.CreateClient(new WebApplicationFactoryClientOptions { HandleCookies = true });
        using var login = await client.PostAsJsonAsync(
            "/v1/auth/login", new { username = "annun-operator", password = "OperatorPass123!" }, JsonOptions);
        Assert.Equal(HttpStatusCode.OK, login.StatusCode);
        return client;
    }

    /// <summary>One parsed SSE frame — the event name and its <c>data:</c> payload.</summary>
    private sealed record Frame(string Event, string Data);

    /// <summary>Reads SSE frames off a live response body. Returns <see langword="null"/> at the deadline
    /// rather than hanging, so a broken stream fails as an assertion instead of as a test timeout.</summary>
    private static async Task<Frame?> ReadFrameAsync(StreamReader reader, TimeSpan timeout)
    {
        using var deadline = new CancellationTokenSource(timeout);
        string? name = null;
        try
        {
            while (await reader.ReadLineAsync(deadline.Token) is { } line)
            {
                if (line.StartsWith("event:", StringComparison.Ordinal))
                {
                    name = line["event:".Length..].Trim();
                }
                else if (line.StartsWith("data:", StringComparison.Ordinal))
                {
                    return new Frame(name ?? "message", line["data:".Length..].Trim());
                }
            }
        }
        catch (OperationCanceledException)
        {
        }
        return null;
    }

    // ─────────────────────────────────────────────────────────────────────
    // Authorisation.
    // ─────────────────────────────────────────────────────────────────────

    /// <summary>The stream carries alarm content, so it is gated exactly like <c>GET /v1/alarms</c> is.
    /// A push channel that skipped the gate the pull channel enforces would be a way to read alarms without
    /// a session.</summary>
    [Fact]
    public async Task TheStream_RefusesAnUnauthenticatedClient()
    {
        await using var factory = await CreateFactoryAsync();
        using var anonymous = factory.CreateClient();

        using var response = await anonymous.GetAsync(
            "/v1/alarms/annunciations", HttpCompletionOption.ResponseHeadersRead);

        Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
    }

    // ─────────────────────────────────────────────────────────────────────
    // The ready frame — the page must never be able to claim it is armed when it is not.
    // ─────────────────────────────────────────────────────────────────────

    /// <summary>🔴 With the channel configured and enabled, the stream says so — including the threshold, so
    /// the page can tell an operator what the quietest thing it will hear about is.</summary>
    [Fact]
    public async Task TheReadyFrame_ReportsAnEnabledChannelAndItsThreshold()
    {
        await using var factory = await CreateFactoryAsync(
            store => store.SaveLocalAnnunciationAsync(enabled: true, AlarmPriority.Critical));
        using var client = await LoginAsOperatorAsync(factory);

        using var response = await client.GetAsync(
            "/v1/alarms/annunciations", HttpCompletionOption.ResponseHeadersRead);

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        Assert.Equal("text/event-stream", response.Content.Headers.ContentType?.MediaType);
        // The header that decides whether this endpoint works or silently stalls behind a reverse proxy.
        Assert.Equal("no", Assert.Single(response.Headers.GetValues("X-Accel-Buffering")));

        await using var body = await response.Content.ReadAsStreamAsync();
        using var reader = new StreamReader(body);

        var frame = await ReadFrameAsync(reader, TimeSpan.FromSeconds(10));
        Assert.NotNull(frame);
        Assert.Equal("ready", frame!.Event);

        var ready = JsonSerializer.Deserialize<AlarmAnnunciationReady>(frame.Data, JsonOptionsWithEnums);
        Assert.NotNull(ready);
        Assert.True(ready!.Configured);
        Assert.True(ready.Enabled);
        Assert.Equal(AlarmPriority.Critical, ready.MinPriority);
        Assert.Equal(AlarmAnnunciationStreamEndpoint.HeartbeatSeconds, ready.HeartbeatSeconds);
    }

    /// <summary>
    /// 🔴 The case the C-5 brief's "a mute annunciator that looks armed is worse than none" rule covers at
    /// the ENGINE end rather than the browser end. Nothing is configured, so nothing will ever annunciate —
    /// and the stream opens anyway and says exactly that, instead of leaving the page to assume it is
    /// armed because the connection succeeded.
    /// </summary>
    [Fact]
    public async Task WithNothingConfigured_TheStreamStillOpens_AndSaysNothingWillAnnunciate()
    {
        await using var factory = await CreateFactoryAsync();
        using var client = await LoginAsOperatorAsync(factory);

        using var response = await client.GetAsync(
            "/v1/alarms/annunciations", HttpCompletionOption.ResponseHeadersRead);
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);

        await using var body = await response.Content.ReadAsStreamAsync();
        using var reader = new StreamReader(body);
        var frame = await ReadFrameAsync(reader, TimeSpan.FromSeconds(10));

        var ready = JsonSerializer.Deserialize<AlarmAnnunciationReady>(frame!.Data, JsonOptionsWithEnums);
        Assert.False(ready!.Configured);
        Assert.False(ready.Enabled);
        Assert.Null(ready.MinPriority);
    }

    /// <summary>Configured and switched OFF is a THIRD state, and it must not read as either of the other
    /// two: an operator who turned it off deliberately should see that, not "never configured".</summary>
    [Fact]
    public async Task AConfiguredButDisabledChannel_ReadsAsConfiguredAndNotEnabled()
    {
        await using var factory = await CreateFactoryAsync(
            store => store.SaveLocalAnnunciationAsync(enabled: false, AlarmPriority.High));
        using var client = await LoginAsOperatorAsync(factory);

        using var response = await client.GetAsync(
            "/v1/alarms/annunciations", HttpCompletionOption.ResponseHeadersRead);
        await using var body = await response.Content.ReadAsStreamAsync();
        using var reader = new StreamReader(body);
        var frame = await ReadFrameAsync(reader, TimeSpan.FromSeconds(10));

        var ready = JsonSerializer.Deserialize<AlarmAnnunciationReady>(frame!.Data, JsonOptionsWithEnums);
        Assert.True(ready!.Configured);
        Assert.False(ready.Enabled);
        Assert.Null(ready.MinPriority);
    }

    /// <summary>
    /// 🔴 <b>Review round 1 (I-1) — the one place in this channel that re-derives the severity comparison,
    /// and until now nothing pinned it.</b>
    ///
    /// <para><c>AlarmPriority</c> is declared MOST-severe-first, so the most PERMISSIVE threshold — the
    /// least severe alarm that will annunciate anywhere — is the LARGEST underlying value. Every other
    /// comparison in this channel goes through <c>NotificationDelivery.Delivers</c>, which C-2 created so
    /// four channels could not each get the inversion wrong; this is a SELECTION rather than a comparison
    /// and cannot, which makes it exactly where the inversion can come back.</para>
    ///
    /// <para>The reviewer proved it was unpinned by flipping <c>MaxBy</c> to <c>MinBy</c> and watching all
    /// 297 alarm tests stay green — every test until now configured a SINGLE enabled instance, where the two
    /// are the same value. Two enabled instances at different thresholds is the whole point of this test:
    /// with Critical and Low configured, the strip must read "Low and above", because an alarm at Low really
    /// will annunciate. Reporting Critical would tell an operator the annunciator is quieter than it
    /// is.</para>
    ///
    /// <para>The DISABLED instance is the second half: a disabled instance annunciates nothing, so its
    /// threshold must not widen the reported one either.</para>
    /// </summary>
    [Fact]
    public async Task TwoEnabledInstances_ReportTheMostPermissiveThreshold_NotTheStrictest()
    {
        await using var factory = await CreateFactoryAsync(async store =>
        {
            Assert.True(await store.SaveLocalAnnunciationAsync(true, AlarmPriority.Critical, "strict"));
            Assert.True(await store.SaveLocalAnnunciationAsync(true, AlarmPriority.Low, "permissive"));
            // Enabled=false, and the MOST permissive threshold of the three — so if a disabled instance
            // were counted, the answer would still be Low but for the wrong reason. It is Medium instead:
            // more permissive than Critical, stricter than Low, so it can only ever be the reported value
            // if disabled instances are wrongly included.
            Assert.True(await store.SaveLocalAnnunciationAsync(false, AlarmPriority.Medium, "off"));
        });
        using var client = await LoginAsOperatorAsync(factory);

        using var response = await client.GetAsync(
            "/v1/alarms/annunciations", HttpCompletionOption.ResponseHeadersRead);
        await using var body = await response.Content.ReadAsStreamAsync();
        using var reader = new StreamReader(body);
        var frame = await ReadFrameAsync(reader, TimeSpan.FromSeconds(10));

        var ready = JsonSerializer.Deserialize<AlarmAnnunciationReady>(frame!.Data, JsonOptionsWithEnums);
        Assert.True(ready!.Configured);
        Assert.True(ready.Enabled);
        Assert.Equal(AlarmPriority.Low, ready.MinPriority);
        Assert.Equal("permissive", ready.Instance);
    }

    // ─────────────────────────────────────────────────────────────────────
    // 🔴 Review round 1 (I-2) — the connect-time standing replay.
    // ─────────────────────────────────────────────────────────────────────

    /// <summary>
    /// 🔴 <b>The hole I-2 found: after an engine restart a standing Critical alarm annunciated to NOBODY,
    /// while the page went on reporting "Armed".</b>
    ///
    /// <para>C-1's <c>Restored</c> edges are emitted by <c>AlarmNotifierSeedService.StartAsync</c>,
    /// milliseconds after boot. No browser can be connected then — a page that WAS open across the restart
    /// had its stream severed when the process died and does not return until its <c>retry:</c> elapses. So
    /// every <c>Restored</c> reaches zero listeners and is counted <c>Unheard</c>, correctly, and the
    /// standing alarm is never annunciated at all.</para>
    ///
    /// <para>This test reproduces the whole shape: an alarm is left standing in <c>alarms.db</c> by a
    /// "previous process", the host boots, and only THEN does a client connect — exactly the ordering the
    /// old design could not serve. The alarm must arrive on connect, as <c>Restored</c>, so the operator is
    /// told that a Critical condition is on right now.</para>
    /// </summary>
    [Fact]
    public async Task AnAlarmStandingFromBeforeTheHostStarted_IsAnnunciatedToAClientThatConnectsAfterwards()
    {
        var alarmsDir = Directory.CreateTempSubdirectory("st4i-annunstream-standing-").FullName;
        // A previous "process" leaves a Critical alarm standing. Nothing is listening when the host's seed
        // service fires its Restored edge — which is the entire point.
        await new AlarmStore(alarmsDir).RaiseAsync(new AlarmRaise(
            AlarmSource.DriverHealth, "DOWN", AlarmPriority.Critical, "left over", TargetId: "slot-9"));

        await using var factory = await CreateFactoryAsync(
            store => store.SaveLocalAnnunciationAsync(enabled: true, AlarmPriority.High),
            alarmsDir);
        using var client = await LoginAsOperatorAsync(factory);

        // The seed really did publish to nobody — the premise, asserted rather than assumed.
        var channel = factory.Services.GetRequiredService<LocalAnnunciationChannel>();
        var seeded = DateTimeOffset.UtcNow.AddSeconds(10);
        while (channel.Stats.Considered == 0 && DateTimeOffset.UtcNow < seeded) await Task.Delay(10);
        Assert.Equal(1, channel.Stats.Unheard);
        Assert.Equal(0, channel.Stats.Announced);

        using var response = await client.GetAsync(
            "/v1/alarms/annunciations", HttpCompletionOption.ResponseHeadersRead);
        await using var body = await response.Content.ReadAsStreamAsync();
        using var reader = new StreamReader(body);
        Assert.Equal("ready", (await ReadFrameAsync(reader, TimeSpan.FromSeconds(10)))!.Event);

        var frame = await ReadFrameAsync(reader, TimeSpan.FromSeconds(15));
        Assert.NotNull(frame);
        Assert.Equal("annunciation", frame!.Event);

        var annunciation = JsonSerializer.Deserialize<AlarmAnnunciation>(frame.Data, JsonOptionsWithEnums);
        Assert.Equal(AlarmEdgeKind.Restored, annunciation!.Edge);
        Assert.Equal(AlarmPriority.Critical, annunciation.Priority);
        Assert.Equal("slot-9", annunciation.TargetId);
        Assert.Equal("left over", annunciation.Message);
        // Negative, so a replay token can never collide with AlarmNotifier's per-process ordinals, which
        // start at 1 and only increase.
        Assert.True(annunciation.Sequence < 0, $"replay sequence {annunciation.Sequence} is not negative.");
    }

    /// <summary>The replay token must be STABLE while the alarm stands, or a page that reconnects after a
    /// blip would be sounded again for something it is already showing. Two independent connections must
    /// therefore see the SAME sequence for the same standing alarm.</summary>
    [Fact]
    public async Task TheReplayTokenIsStableAcrossConnections_SoAReconnectDoesNotReAnnunciate()
    {
        var alarmsDir = Directory.CreateTempSubdirectory("st4i-annunstream-standing-").FullName;
        var alarms = new AlarmStore(alarmsDir);
        var raise = new AlarmRaise(
            AlarmSource.DriverHealth, "DOWN", AlarmPriority.Critical, "stable", TargetId: "slot-2");
        await alarms.RaiseAsync(raise);

        await using var factory = await CreateFactoryAsync(
            store => store.SaveLocalAnnunciationAsync(enabled: true, AlarmPriority.High),
            alarmsDir);
        using var client = await LoginAsOperatorAsync(factory);

        var first = await ReadFirstAnnunciationAsync(client);

        // A re-raise between the two connections — the 5s evaluator tick this product does constantly. It
        // moves LastRaisedUtc and Count but PRESERVES FirstRaisedUtc, which is exactly why the token is
        // built from the latter. Using LastRaisedUtc would make the second connection re-sound.
        await factory.Services.GetRequiredService<IAlarmStore>().RaiseAsync(raise);

        var second = await ReadFirstAnnunciationAsync(client);

        Assert.Equal(first.Sequence, second.Sequence);
        Assert.Equal(first.Key, second.Key);
    }

    private static async Task<AlarmAnnunciation> ReadFirstAnnunciationAsync(HttpClient client)
    {
        using var response = await client.GetAsync(
            "/v1/alarms/annunciations", HttpCompletionOption.ResponseHeadersRead);
        await using var body = await response.Content.ReadAsStreamAsync();
        using var reader = new StreamReader(body);
        Assert.Equal("ready", (await ReadFrameAsync(reader, TimeSpan.FromSeconds(10)))!.Event);
        var frame = await ReadFrameAsync(reader, TimeSpan.FromSeconds(15));
        Assert.Equal("annunciation", frame!.Event);
        return JsonSerializer.Deserialize<AlarmAnnunciation>(frame.Data, JsonOptionsWithEnums)!;
    }

    /// <summary>A standing alarm BELOW the configured threshold must not be replayed — the replay applies
    /// exactly the gate the channel applies, or connecting would annunciate things an operator configured
    /// the channel to ignore.</summary>
    [Fact]
    public async Task AStandingAlarmBelowTheThreshold_IsNotReplayed()
    {
        var alarmsDir = Directory.CreateTempSubdirectory("st4i-annunstream-standing-").FullName;
        var alarms = new AlarmStore(alarmsDir);
        await alarms.RaiseAsync(new AlarmRaise(
            AlarmSource.NgRate, "HIGH", AlarmPriority.High, "below threshold", TargetId: "fleet"));
        await alarms.RaiseAsync(new AlarmRaise(
            AlarmSource.DriverHealth, "DOWN", AlarmPriority.Critical, "above threshold", TargetId: "slot-1"));

        await using var factory = await CreateFactoryAsync(
            store => store.SaveLocalAnnunciationAsync(enabled: true, AlarmPriority.Critical),
            alarmsDir);
        using var client = await LoginAsOperatorAsync(factory);

        using var response = await client.GetAsync(
            "/v1/alarms/annunciations", HttpCompletionOption.ResponseHeadersRead);
        await using var body = await response.Content.ReadAsStreamAsync();
        using var reader = new StreamReader(body);
        Assert.Equal("ready", (await ReadFrameAsync(reader, TimeSpan.FromSeconds(10)))!.Event);

        var first = await ReadFrameAsync(reader, TimeSpan.FromSeconds(15));
        var admitted = JsonSerializer.Deserialize<AlarmAnnunciation>(first!.Data, JsonOptionsWithEnums);
        Assert.Equal(AlarmPriority.Critical, admitted!.Priority);

        // Nothing else follows: the High alarm is below the Critical threshold. A short read that times out
        // is the assertion — the heartbeat is 15s, so anything arriving inside 3s is a replayed frame.
        Assert.Null(await ReadFrameAsync(reader, TimeSpan.FromSeconds(3)));
    }

    /// <summary>A DISABLED channel replays nothing. Replaying anyway would be this endpoint annunciating on
    /// a channel the operator switched off — which is the same class of fault as the host claiming delivery
    /// for a channel it cannot deliver.</summary>
    [Fact]
    public async Task ADisabledChannel_ReplaysNothing_EvenWithAlarmsStanding()
    {
        var alarmsDir = Directory.CreateTempSubdirectory("st4i-annunstream-standing-").FullName;
        await new AlarmStore(alarmsDir).RaiseAsync(new AlarmRaise(
            AlarmSource.DriverHealth, "DOWN", AlarmPriority.Critical, "standing", TargetId: "slot-3"));

        await using var factory = await CreateFactoryAsync(
            store => store.SaveLocalAnnunciationAsync(enabled: false, AlarmPriority.Low),
            alarmsDir);
        using var client = await LoginAsOperatorAsync(factory);

        using var response = await client.GetAsync(
            "/v1/alarms/annunciations", HttpCompletionOption.ResponseHeadersRead);
        await using var body = await response.Content.ReadAsStreamAsync();
        using var reader = new StreamReader(body);
        Assert.Equal("ready", (await ReadFrameAsync(reader, TimeSpan.FromSeconds(10)))!.Event);

        Assert.Null(await ReadFrameAsync(reader, TimeSpan.FromSeconds(3)));
    }

    /// <summary>The replay is BOUNDED. Twenty cards plus a tone annunciates as well as two hundred would,
    /// and past that it is a wall of red that renders slowly and says nothing; the complete list is
    /// <c>GET /v1/alarms</c> on the same screen. <c>ListActiveAsync</c> returns most-severe-first, so what
    /// survives the truncation is what matters most.</summary>
    [Fact]
    public async Task TheStandingReplayIsBounded_AndKeepsTheMostSevere()
    {
        var alarmsDir = Directory.CreateTempSubdirectory("st4i-annunstream-standing-").FullName;
        var alarms = new AlarmStore(alarmsDir);
        const int Standing = AlarmAnnunciationStreamEndpoint.MaxStandingReplay + 7;
        // Deliberately raised least-severe FIRST, so an implementation that truncated by insertion order
        // rather than by severity would keep the wrong ones.
        for (var i = 0; i < Standing; i++)
        {
            var priority = i < 7 ? AlarmPriority.High : AlarmPriority.Critical;
            await alarms.RaiseAsync(new AlarmRaise(
                AlarmSource.DriverHealth, "DOWN", priority, $"standing {i}", TargetId: $"slot-{i}"));
        }

        await using var factory = await CreateFactoryAsync(
            store => store.SaveLocalAnnunciationAsync(enabled: true, AlarmPriority.Low),
            alarmsDir);
        using var client = await LoginAsOperatorAsync(factory);

        using var response = await client.GetAsync(
            "/v1/alarms/annunciations", HttpCompletionOption.ResponseHeadersRead);
        await using var body = await response.Content.ReadAsStreamAsync();
        using var reader = new StreamReader(body);
        Assert.Equal("ready", (await ReadFrameAsync(reader, TimeSpan.FromSeconds(10)))!.Event);

        var replayed = new List<AlarmAnnunciation>();
        while (await ReadFrameAsync(reader, TimeSpan.FromSeconds(3)) is { } frame)
        {
            Assert.Equal("annunciation", frame.Event);
            replayed.Add(JsonSerializer.Deserialize<AlarmAnnunciation>(frame.Data, JsonOptionsWithEnums)!);
        }

        Assert.Equal(AlarmAnnunciationStreamEndpoint.MaxStandingReplay, replayed.Count);
        // 🔴 Truncation by SEVERITY, not by arbitrary order: all 20 kept are Critical, and none of the 7
        // High ones displaced one.
        Assert.All(replayed, item => Assert.Equal(AlarmPriority.Critical, item.Priority));
    }

    // ─────────────────────────────────────────────────────────────────────
    // 🔴 The end-to-end proof.
    // ─────────────────────────────────────────────────────────────────────

    /// <summary>
    /// 🔴 <b>The whole chain, through the real host.</b> A page has the stream open; an alarm is raised on
    /// the <see cref="IAlarmStore"/> the host resolves; C-1's edge detector decides it is an edge; the
    /// notifier's drain loop calls the channel <c>Program.cs</c> wired in; the channel publishes to the hub;
    /// and the SSE handler writes a frame a browser can parse.
    ///
    /// <para>This is the only test that can see the two failures that actually reach a customer — a channel
    /// that was never wired into the host at all, and SSE framing a browser rejects. It also asserts the
    /// channel's own counter went to <c>Announced</c> rather than <c>Unheard</c>, which is the difference
    /// between "somebody was told" and "nobody was there", and is only true because the listener really was
    /// registered by then.</para>
    /// </summary>
    [Fact]
    public async Task AnAlarmRaisedThroughTheRealHost_ArrivesOnAnOpenStream_AndIsCountedAnnounced()
    {
        await using var factory = await CreateFactoryAsync(
            store => store.SaveLocalAnnunciationAsync(enabled: true, AlarmPriority.High));
        using var client = await LoginAsOperatorAsync(factory);

        var hub = factory.Services.GetRequiredService<AlarmAnnunciationHub>();
        var channel = factory.Services.GetService<LocalAnnunciationChannel>();
        Assert.NotNull(channel);

        using var response = await client.GetAsync(
            "/v1/alarms/annunciations", HttpCompletionOption.ResponseHeadersRead);
        await using var body = await response.Content.ReadAsStreamAsync();
        using var reader = new StreamReader(body);

        // The ready frame is written and FLUSHED before the listener is registered, so seeing it is not
        // enough — wait for the registration itself, or the alarm below could race ahead of it and be
        // correctly counted Unheard.
        Assert.Equal("ready", (await ReadFrameAsync(reader, TimeSpan.FromSeconds(10)))!.Event);
        var deadline = DateTimeOffset.UtcNow.AddSeconds(10);
        while (hub.ListenerCount == 0 && DateTimeOffset.UtcNow < deadline) await Task.Delay(10);
        Assert.Equal(1, hub.ListenerCount);

        var alarms = factory.Services.GetRequiredService<IAlarmStore>();
        await alarms.RaiseAsync(new AlarmRaise(
            AlarmSource.DriverHealth, "DOWN", AlarmPriority.Critical, "unreachable", TargetId: "slot-5"));

        var frame = await ReadFrameAsync(reader, TimeSpan.FromSeconds(20));
        Assert.NotNull(frame);
        Assert.Equal("annunciation", frame!.Event);

        var annunciation = JsonSerializer.Deserialize<AlarmAnnunciation>(frame.Data, JsonOptionsWithEnums);
        Assert.NotNull(annunciation);
        Assert.Equal(AlarmEdgeKind.Raised, annunciation!.Edge);
        Assert.Equal(AlarmPriority.Critical, annunciation.Priority);
        Assert.Equal(AlarmSource.DriverHealth, annunciation.Source);
        Assert.Equal("DOWN", annunciation.Code);
        Assert.Equal("slot-5", annunciation.TargetId);
        Assert.Equal("unreachable", annunciation.Message);

        Assert.Equal(1, channel!.Stats.Announced);
        Assert.Equal(0, channel.Stats.Unheard);
    }

    /// <summary>
    /// 🔴 A page that goes away must stop being counted as somebody who is listening. This is what the
    /// channel's <c>Announced</c> counter rests on: without it the engine would go on reporting alarms as
    /// annunciated to browser sessions that closed hours ago.
    ///
    /// <para>The disconnect is driven by disposing the response, which is what a closed tab looks like to
    /// Kestrel.</para>
    /// </summary>
    [Fact]
    public async Task WhenTheClientGoesAway_TheListenerIsUnregistered_SoTheEngineStopsClaimingItHeardAnything()
    {
        await using var factory = await CreateFactoryAsync(
            store => store.SaveLocalAnnunciationAsync(enabled: true, AlarmPriority.Low));
        using var client = await LoginAsOperatorAsync(factory);
        var hub = factory.Services.GetRequiredService<AlarmAnnunciationHub>();

        var response = await client.GetAsync(
            "/v1/alarms/annunciations", HttpCompletionOption.ResponseHeadersRead);
        var body = await response.Content.ReadAsStreamAsync();
        var reader = new StreamReader(body);
        Assert.Equal("ready", (await ReadFrameAsync(reader, TimeSpan.FromSeconds(10)))!.Event);

        var attached = DateTimeOffset.UtcNow.AddSeconds(10);
        while (hub.ListenerCount == 0 && DateTimeOffset.UtcNow < attached) await Task.Delay(10);
        Assert.Equal(1, hub.ListenerCount);

        reader.Dispose();
        await body.DisposeAsync();
        response.Dispose();

        var detached = DateTimeOffset.UtcNow.AddSeconds(20);
        while (hub.ListenerCount > 0 && DateTimeOffset.UtcNow < detached) await Task.Delay(20);
        Assert.Equal(0, hub.ListenerCount);
    }

    // ─────────────────────────────────────────────────────────────────────
    // 🔴 Task C-7 — the subscriber cap.
    // ─────────────────────────────────────────────────────────────────────

    /// <summary>
    /// 🔴 Task C-7 — until this task <c>AlarmAnnunciationHub.Subscribe()</c> had NO cap, so an ordinary
    /// authenticated GET could be opened without limit by one client. The cost is per LIVE CONNECTION rather
    /// than per connect — each listener holds a bounded queue and a per-iteration linked CTS and timer, and
    /// <c>Publish</c> is O(listeners) on C-1's DRAIN THREAD, the same thread a beacon write waits behind —
    /// which is why the bound is a concurrency cap and not a rate limit.
    ///
    /// <para><b>And it is refused with a 503 BEFORE any stream byte is written.</b> A refusal delivered
    /// mid-stream would arrive on a response already committed as a 200 <c>text/event-stream</c>: the page
    /// would see an annunciator that opened and then went quiet, which is the C-5 brief's "a mute
    /// annunciator that looks armed is worse than none", one level up.</para>
    /// </summary>
    [Fact]
    public async Task AtTheSubscriberCap_ANewStreamIsRefusedWith503_BeforeAnyStreamByteIsWritten()
    {
        await using var factory = await CreateFactoryAsync(
            store => store.SaveLocalAnnunciationAsync(enabled: true, AlarmPriority.High),
            maxListeners: 1);
        using var client = await LoginAsOperatorAsync(factory);
        var hub = factory.Services.GetRequiredService<AlarmAnnunciationHub>();

        var first = await client.GetAsync("/v1/alarms/annunciations", HttpCompletionOption.ResponseHeadersRead);
        var firstBody = await first.Content.ReadAsStreamAsync();
        var firstReader = new StreamReader(firstBody);
        Assert.Equal(HttpStatusCode.OK, first.StatusCode);
        Assert.Equal("ready", (await ReadFrameAsync(firstReader, TimeSpan.FromSeconds(10)))!.Event);

        var attached = DateTimeOffset.UtcNow.AddSeconds(10);
        while (hub.ListenerCount == 0 && DateTimeOffset.UtcNow < attached) await Task.Delay(10);
        Assert.Equal(1, hub.ListenerCount);

        using (var second = await client.GetAsync(
                   "/v1/alarms/annunciations", HttpCompletionOption.ResponseHeadersRead))
        {
            Assert.Equal(HttpStatusCode.ServiceUnavailable, second.StatusCode);
            // 🔴 Not an event-stream: the refusal never pretends to be a stream that will annunciate.
            Assert.NotEqual("text/event-stream", second.Content.Headers.ContentType?.MediaType);
            Assert.NotNull(second.Headers.RetryAfter);

            var body = await second.Content.ReadAsStringAsync();
            Assert.Contains("would NOT be annunciated", body, StringComparison.Ordinal);
        }

        Assert.Equal(1, hub.Rejected);

        // 🔴 And it is a CAP, not a wall: closing the first connection frees the slot and the next page
        // attaches. A browser's own EventSource retry (3 s) is what makes that automatic.
        firstReader.Dispose();
        await firstBody.DisposeAsync();
        first.Dispose();

        var detached = DateTimeOffset.UtcNow.AddSeconds(20);
        while (hub.ListenerCount > 0 && DateTimeOffset.UtcNow < detached) await Task.Delay(20);
        Assert.Equal(0, hub.ListenerCount);

        using var third = await client.GetAsync(
            "/v1/alarms/annunciations", HttpCompletionOption.ResponseHeadersRead);
        Assert.Equal(HttpStatusCode.OK, third.StatusCode);
    }

    /// <summary>The production cap is asserted here, so a test that shrinks it for its own convenience
    /// cannot quietly change what ships.</summary>
    [Fact]
    public void TheDocumentedSubscriberCap_IsWhatTheHubActuallyUses()
    {
        Assert.Equal(32, AlarmAnnunciationHub.DefaultMaxListeners);
        Assert.Equal(AlarmAnnunciationHub.DefaultMaxListeners, new AlarmAnnunciationHub().MaxListeners);
    }
}
