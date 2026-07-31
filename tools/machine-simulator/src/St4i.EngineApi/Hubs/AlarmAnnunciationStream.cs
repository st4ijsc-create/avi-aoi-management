using System.Text;
using System.Text.Json;
using Microsoft.AspNetCore.Http.Features;
using Microsoft.Extensions.DependencyInjection;
using St4i.EngineApi.Alarms;
using St4i.EngineApi.Auth;

namespace St4i.EngineApi.Hubs;

/// <summary>
/// Task C-5 — the opening <c>ready</c> frame of <c>GET /v1/alarms/annunciations</c>: what this engine will
/// and will not annunciate, told to the page at connect time.
///
/// <para>🔴 <b>This frame exists to stop the page claiming to be armed when it is not.</b> The C-5 brief's
/// rule — "a mute annunciator that looks armed is worse than none" — has a second half beyond the browser's
/// autoplay policy: an annunciator indicator on a build where the channel is DISABLED, or was never
/// configured at all, is exactly the same lie one level up. The page cannot learn that from anywhere else
/// (C-7 owns the configuration endpoints, and this task does not add one), and it is not a secret — the
/// local-annunciation channel has no credential of any kind — so the stream that would carry the
/// annunciations says up front whether any are coming.</para>
/// </summary>
/// <param name="Configured">Whether any local-annunciation instance exists in
/// <see cref="NotificationConfigStore"/> at all.</param>
/// <param name="Enabled">Whether at least one exists AND is enabled. <see langword="false"/> with
/// <paramref name="Configured"/> <see langword="true"/> is the "somebody configured it and turned it off"
/// state C-2's startup notice also warns about.</param>
/// <param name="MinPriority">The most PERMISSIVE threshold among the enabled instances — i.e. the least
/// severe alarm that will annunciate anywhere. <see langword="null"/> when nothing is enabled. Reported as
/// the most permissive rather than the strictest because it is the honest answer to the only question a
/// screen can ask: "what is the quietest thing I will hear about?"</param>
/// <param name="Instance">Which enabled instance supplied <paramref name="MinPriority"/> — i.e. the one
/// doing the most work. <see langword="null"/> when nothing is enabled. Carried so the connect-time standing
/// replay can name a real configured instance rather than assuming
/// <see cref="NotificationConfigStore.DefaultInstance"/>.</param>
/// <param name="HeartbeatSeconds">How often this stream emits an SSE comment while idle, so a client can
/// tell "quiet" from "dead" without guessing.</param>
public sealed record AlarmAnnunciationReady(
    bool Configured,
    bool Enabled,
    AlarmPriority? MinPriority,
    string? Instance,
    int HeartbeatSeconds);

/// <summary>
/// 🔴 Task C-5 — <c>GET /v1/alarms/annunciations</c>: the wire between
/// <see cref="LocalAnnunciationChannel"/> and every open browser page, as Server-Sent Events.
///
/// <para><b>Why SSE, and why not the polling that is already there.</b> The alarm list is already polled
/// (<c>useAlarms</c>, 4 s) and that is the honest baseline for a TABLE. It is not adequate for an
/// ANNUNCIATOR, for two reasons that are properties of browsers rather than preferences:
/// <list type="number">
/// <item><description>A polling loop is built on <c>setTimeout</c>, and a background tab has its timers
/// throttled to roughly one per minute — and, after five minutes hidden with no audio playing, to Chrome's
/// "intensive throttling" of one per minute regardless of the interval asked for. An annunciator exists
/// precisely to reach somebody who is NOT looking at the tab, so the one situation it must work in is the
/// one polling degrades worst in. An open <c>EventSource</c> is not a timer: a message dispatches when the
/// bytes arrive, background tab or not.</description></item>
/// <item><description>Polling sees STATE; this channel is built on EDGES. C-1's whole reason for existing is
/// that the sources restate an unchanged alarm every 5 s, and the edge detector in front of this stream has
/// already absorbed that. A poller would have to re-derive edges by diffing snapshots, would miss any edge
/// that opened and closed between two polls, and could not see
/// <see cref="AlarmEdgeKind.Escalated"/> at all.</description></item>
/// </list></para>
///
/// <para><b>Why SSE rather than a WebSocket</b>, given this host already has one
/// (<see cref="InspectorStreamEndpoint"/>): this stream is server-push-only with no client→server message
/// contract, which is exactly the shape SSE is for; it is ordinary HTTP, so it inherits the cookie session,
/// the CORS policy and the dev-server proxy with nothing new to configure; the browser reconnects on its own
/// (honouring the <c>retry:</c> below) instead of the manual reconnect loop <c>lib/inspector.ts</c> had to
/// write; and it survives the reverse-proxy shapes this product is deployed behind, which a WebSocket
/// upgrade does not always. <c>X-Accel-Buffering: no</c> is set for the one proxy behaviour that WOULD break
/// it — response buffering, which turns a live stream into a stalled one.</para>
///
/// <para>🔴 <b>No EDGE backfill, but a bounded replay of what is STANDING — and review round 1 (I-2) is why
/// those are different things.</b> This endpoint still does not replay history, and still has no
/// <c>id:</c>/<c>Last-Event-ID</c> mechanism, unlike <see cref="InspectorStreamEndpoint"/>'s 200-event
/// catch-up next door: replaying EDGES would make a page reload sound an alarm that was dealt with an hour
/// ago, which is how an annunciator becomes noise.</para>
///
/// <para><b>But the first version of this class then claimed something false, and the falsehood hid a real
/// hole.</b> It said <see cref="AlarmEdgeKind.Restored"/> — the edge kind that carries standing state across
/// a restart — was "only heard by a page that was already open across the restart, which is exactly right".
/// It is heard by nobody, ever. <see cref="AlarmNotifierSeedService"/> emits those jobs from its
/// <c>StartAsync</c>, milliseconds after boot; a page that WAS open across the restart had its connection
/// severed when the process died and does not come back until its <c>retry:</c> elapses. So every
/// <c>Restored</c> published at seed time reaches zero listeners and is correctly counted <c>Unheard</c> —
/// and the consequence was that <b>after any engine restart a standing Critical alarm annunciated to
/// nobody, while the page went on reporting "Armed"</b>. That is the brief's own "a mute annunciator that
/// looks armed is worse than none", one level up.</para>
///
/// <para>🔴 <b>The fix, and why it is not the backfill this class refuses.</b> On connect, a client is sent
/// the alarms that are ACTIVE RIGHT NOW — not edges that happened, but state that is true. An alarm still in
/// <c>active_alarms</c> is by definition NOT dealt with, which is the whole difference: the noise argument
/// above is about re-announcing things that are over. Bounded at <see cref="MaxStandingReplay"/>, filtered
/// by the same threshold the channel itself applies, ordered most-severe-first by
/// <see cref="IAlarmStore.ListActiveAsync"/>, sent only when the channel is enabled (a disabled channel
/// annunciates nothing, so there is nothing to replay), and de-duplicated by the client through the ordinary
/// <c>sequence</c> mechanism — see <see cref="AlarmAnnunciation.FromStanding"/> for how a replay token is
/// made stable and collision-free with no server-side state. The complete list, unbounded, is
/// <c>GET /v1/alarms</c> on the same screen.</para>
///
/// <para><b>Operator, not Engineer</b>, unlike the inspector stream next door: this carries alarm content,
/// and <c>GET /v1/alarms</c> — the same content, in table form — is already Operator.</para>
///
/// <para>🔴 <b>The listener registers only AFTER the opening frame has been flushed.</b> That ordering is
/// what lets <see cref="LocalAnnunciationChannel"/> count honestly: a registered listener is one whose
/// client has already received bytes on this connection, not merely one whose handler has started. See
/// <see cref="AlarmAnnunciationHub"/>.</para>
/// </summary>
public static class AlarmAnnunciationStreamEndpoint
{
    /// <summary>How long a client should wait before reconnecting, handed to the browser's own
    /// <c>EventSource</c> reconnect via the SSE <c>retry:</c> field. Three seconds: long enough that a
    /// restarting engine is not hammered, short enough that an operator who reloads is annunciable again
    /// before they have finished reading the page.</summary>
    public const int ReconnectDelayMs = 3_000;

    /// <summary>Idle heartbeat. Serves two jobs: it is what makes a dead client's write FAIL (so the
    /// listener is unregistered and the channel stops counting it as somebody who heard something), and it
    /// keeps an idle stream alive through proxies that close quiet connections. Fifteen seconds is well
    /// inside the 60 s idle timeout that is the common default.</summary>
    public const int HeartbeatSeconds = 15;

    /// <summary>
    /// 🔴 Review round 1 (I-2) — how many currently-standing alarms a connecting client is told about.
    ///
    /// <para>An annunciator's job is to get somebody's attention, and twenty cards plus a tone does that as
    /// well as two hundred would; past that it is a wall of red that annunciates nothing and a page that
    /// takes a visible moment to render. <see cref="IAlarmStore.ListActiveAsync"/> returns most-severe-first,
    /// so the twenty an operator sees are the twenty that matter most — the truncation is by severity, not
    /// arbitrary. Nothing is lost by it: the alarms are all still in <c>GET /v1/alarms</c>, unbounded, on the
    /// very screen this strip sits on.</para></summary>
    public const int MaxStandingReplay = 20;

    /// <summary>An SSE COMMENT (a line starting with <c>:</c>), which every conforming client ignores — so
    /// the heartbeat cannot be mistaken for an event by a client that does not know about it.</summary>
    private static readonly byte[] Heartbeat = Encoding.UTF8.GetBytes(": keep-alive\n\n");

    public static void MapAlarmAnnunciationStream(this IEndpointRouteBuilder app)
    {
        app.MapGet("/v1/alarms/annunciations", HandleAsync).RequireAuthorization(Policies.Operator);
    }

    internal static async Task HandleAsync(HttpContext context)
    {
        var hub = context.RequestServices.GetRequiredService<AlarmAnnunciationHub>();
        // GetService, not GetRequiredService: Program.cs registers the configuration store only when it
        // could be OPENED, and a stream that 500s because the store is unreadable would be a worse answer
        // than a stream that honestly reports "nothing is configured".
        var store = context.RequestServices.GetService<NotificationConfigStore>();
        var ct = context.RequestAborted;

        var response = context.Response;
        response.StatusCode = StatusCodes.Status200OK;
        response.ContentType = "text/event-stream; charset=utf-8";
        response.Headers.CacheControl = "no-cache, no-store";
        // Not part of any RFC — it is nginx's own opt-out, and it is the single header that decides whether
        // this endpoint works or silently stalls behind the reverse proxies this product gets deployed
        // behind. Harmless everywhere else.
        response.Headers["X-Accel-Buffering"] = "no";

        // Without this, ASP.NET may buffer the response body and the first frame never leaves — which would
        // make the listener registration below claim a client that has received nothing.
        context.Features.Get<IHttpResponseBodyFeature>()?.DisableBuffering();

        var ready = await ReadReadyStateAsync(store, ct).ConfigureAwait(false);

        try
        {
            await WriteAsync(response.Body, $"retry: {ReconnectDelayMs}\n\n", ct).ConfigureAwait(false);
            await WriteEventAsync(response.Body, "ready", JsonSerializer.Serialize(ready, ApiJson.Options), ct)
                .ConfigureAwait(false);
            await response.Body.FlushAsync(ct).ConfigureAwait(false);
        }
        catch (OperationCanceledException)
        {
            return; // The client vanished before it could be registered — nothing to unregister.
        }
        catch (IOException)
        {
            return;
        }

        // 🔴 Registered only now: see the class doc comment. Everything above has already reached the wire.
        using var listener = hub.Subscribe();
        var reader = listener.Reader;

        try
        {
            // 🔴 Review round 1 (I-2) — BEFORE the loop but AFTER the subscription, and that order is the
            // whole reason there is no gap: an edge arriving during the replay lands in this listener's
            // queue and is written the moment the loop starts, so it can neither be lost nor overtaken.
            // (A live edge for an alarm that was also replayed simply replaces it on the client, whose
            // standing set is keyed by the alarm key.)
            await ReplayStandingAsync(context, response.Body, ready, ct).ConfigureAwait(false);

            while (!ct.IsCancellationRequested)
            {
                bool hasItems;
                using (var idle = CancellationTokenSource.CreateLinkedTokenSource(ct))
                {
                    idle.CancelAfter(TimeSpan.FromSeconds(HeartbeatSeconds));
                    try
                    {
                        hasItems = await reader.WaitToReadAsync(idle.Token).ConfigureAwait(false);
                    }
                    catch (OperationCanceledException) when (!ct.IsCancellationRequested)
                    {
                        // The heartbeat elapsed, not the request. Prove the socket is still there.
                        await response.Body.WriteAsync(Heartbeat, ct).ConfigureAwait(false);
                        await response.Body.FlushAsync(ct).ConfigureAwait(false);
                        continue;
                    }
                }

                if (!hasItems) break; // The listener was disposed — only shutdown does that.

                while (reader.TryRead(out var annunciation))
                {
                    await WriteEventAsync(
                            response.Body, "annunciation",
                            JsonSerializer.Serialize(annunciation, ApiJson.Options), ct)
                        .ConfigureAwait(false);
                }

                await response.Body.FlushAsync(ct).ConfigureAwait(false);
            }
        }
        catch (OperationCanceledException)
        {
            // Normal: the client navigated away, closed the tab, or the host is shutting down.
        }
        catch (IOException)
        {
            // Normal: the client vanished mid-write.
        }
    }

    /// <summary>
    /// 🔴 Review round 1 (I-2) — tells a connecting client what is standing RIGHT NOW, so an engine restart
    /// stops leaving a Critical alarm annunciated to nobody. See the class doc comment for why this is not
    /// the edge backfill this endpoint still refuses.
    ///
    /// <para>Silent when the channel is not enabled: a disabled or unconfigured channel annunciates nothing,
    /// so there is nothing to replay, and replaying anyway would be this endpoint annunciating on a channel
    /// the operator switched off.</para>
    ///
    /// <para>Never throws. A failure to read the alarm store must not take down a stream whose LIVE path is
    /// unaffected by it — the connection is still perfectly able to annunciate every edge from this moment
    /// on, which is more than the caller had before. A write failure is the client going away and is handled
    /// by the loop that follows.</para>
    /// </summary>
    private static async Task ReplayStandingAsync(
        HttpContext context, Stream body, AlarmAnnunciationReady ready, CancellationToken ct)
    {
        if (!ready.Enabled || ready.MinPriority is not { } threshold || ready.Instance is not { } instance)
        {
            return;
        }

        var alarms = context.RequestServices.GetService<IAlarmStore>();
        if (alarms is null) return;

        IReadOnlyList<Alarm> active;
        try
        {
            active = await alarms.ListActiveAsync(ct).ConfigureAwait(false);
        }
        catch (OperationCanceledException)
        {
            throw;
        }
        catch (Exception)
        {
            // See the doc comment: the live path does not depend on this, so a store failure degrades the
            // connection rather than failing it. IAlarmStore reports its own failures.
            return;
        }

        var now = DateTimeOffset.UtcNow;
        var sent = 0;
        foreach (var alarm in active)
        {
            if (sent >= MaxStandingReplay) break;
            // The same comparison the channel itself applies, through the same shared helper — most-severe-
            // first means this is `<=`, and C-2 put it in one place so nothing re-derives it.
            if (!NotificationDelivery.MeetsThreshold(alarm.Priority, threshold)) continue;

            await WriteEventAsync(
                    body, "annunciation",
                    JsonSerializer.Serialize(
                        AlarmAnnunciation.FromStanding(alarm, instance, now), ApiJson.Options),
                    ct)
                .ConfigureAwait(false);
            sent++;
        }

        if (sent > 0) await body.FlushAsync(ct).ConfigureAwait(false);
    }

    /// <summary>
    /// What this engine will annunciate, as of this connection. Never throws: the store is never-throws for
    /// failures, and a cancelled read here simply means the client is already gone.
    /// </summary>
    private static async Task<AlarmAnnunciationReady> ReadReadyStateAsync(
        NotificationConfigStore? store, CancellationToken ct)
    {
        var nothing = new AlarmAnnunciationReady(false, false, null, null, HeartbeatSeconds);
        if (store is null) return nothing;

        IReadOnlyList<NotificationChannelSummary> channels;
        try
        {
            channels = await store.ListAsync(ct).ConfigureAwait(false);
        }
        catch (OperationCanceledException)
        {
            return nothing;
        }

        var configured = channels
            .Where(c => c.Channel == NotificationChannel.LocalAnnunciation)
            .ToList();
        var enabled = configured.Where(c => c.Enabled).ToList();

        // 🔴 AlarmPriority is declared MOST-severe-first (Critical = 0 … Low = 3), so the most PERMISSIVE
        // threshold — the least severe alarm that will annunciate ANYWHERE — is the LARGEST underlying
        // value, i.e. MaxBy, not MinBy.
        //
        // Review round 1 (I-1): this is the one place in the channel that cannot go through
        // NotificationDelivery.Delivers, because it is a selection rather than a comparison — so it is also
        // the one place the inversion C-2 centralised can come back. The reviewer proved it was unpinned by
        // flipping it to MinBy and watching all 297 alarm tests stay green: every test until then configured
        // a single enabled instance, where Max and Min are the same value.
        // AlarmAnnunciationStreamTests.TwoEnabledInstances_… now configures two at different thresholds, so
        // the flip is a red suite.
        var mostPermissive = enabled.Count == 0 ? null : enabled.MaxBy(c => c.MinPriority);

        return new AlarmAnnunciationReady(
            configured.Count > 0, enabled.Count > 0,
            mostPermissive?.MinPriority, mostPermissive?.Instance, HeartbeatSeconds);
    }

    private static Task WriteEventAsync(Stream body, string name, string json, CancellationToken ct)
    {
        // The payload is one line by construction — System.Text.Json never emits a raw newline inside a
        // JSON string (it escapes them as \n), and this serializer is not indented. If that ever stopped
        // being true, a bare newline would split one event into two malformed ones, so it is asserted by a
        // test rather than assumed here.
        return WriteAsync(body, $"event: {name}\ndata: {json}\n\n", ct);
    }

    private static async Task WriteAsync(Stream body, string text, CancellationToken ct)
    {
        await body.WriteAsync(Encoding.UTF8.GetBytes(text), ct).ConfigureAwait(false);
    }
}
