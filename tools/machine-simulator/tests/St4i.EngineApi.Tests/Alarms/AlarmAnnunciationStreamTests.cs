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

    private static async Task<WebApplicationFactory<Program>> CreateFactoryAsync(
        Func<NotificationConfigStore, Task>? configure = null)
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
            ["ST4I_ALARMS_DIR"] = Directory.CreateTempSubdirectory("st4i-annunstream-alarms-").FullName,
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
}
