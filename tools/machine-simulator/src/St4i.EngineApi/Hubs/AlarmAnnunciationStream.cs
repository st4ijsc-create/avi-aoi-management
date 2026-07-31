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
/// <param name="HeartbeatSeconds">How often this stream emits an SSE comment while idle, so a client can
/// tell "quiet" from "dead" without guessing.</param>
public sealed record AlarmAnnunciationReady(
    bool Configured,
    bool Enabled,
    AlarmPriority? MinPriority,
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
/// <para>🔴 <b>There is deliberately NO backfill and no <c>id:</c>/<c>Last-Event-ID</c> replay</b>, which is
/// the opposite of <see cref="InspectorStreamEndpoint"/>'s 200-event catch-up. An annunciator announces what
/// is happening NOW; replaying edges from before the page opened would make a page reload sound an alarm
/// that was dealt with an hour ago, which is how an annunciator becomes noise. The standing state after the
/// fact is what <c>GET /v1/alarms</c> is for, and it is on the same screen. The one edge kind that carries
/// history — <see cref="AlarmEdgeKind.Restored"/> — is emitted once per process start by C-1 and is
/// therefore only heard by a page that was already open across the restart, which is exactly right.</para>
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
    /// What this engine will annunciate, as of this connection. Never throws: the store is never-throws for
    /// failures, and a cancelled read here simply means the client is already gone.
    /// </summary>
    private static async Task<AlarmAnnunciationReady> ReadReadyStateAsync(
        NotificationConfigStore? store, CancellationToken ct)
    {
        if (store is null) return new AlarmAnnunciationReady(false, false, null, HeartbeatSeconds);

        IReadOnlyList<NotificationChannelSummary> channels;
        try
        {
            channels = await store.ListAsync(ct).ConfigureAwait(false);
        }
        catch (OperationCanceledException)
        {
            return new AlarmAnnunciationReady(false, false, null, HeartbeatSeconds);
        }

        var configured = channels
            .Where(c => c.Channel == NotificationChannel.LocalAnnunciation)
            .ToList();
        var enabled = configured.Where(c => c.Enabled).ToList();

        // AlarmPriority is declared MOST-severe-first, so the most PERMISSIVE threshold is the largest
        // underlying value — the same inversion NotificationDelivery.MeetsThreshold exists to keep in one
        // place, restated here because this is a Max rather than a comparison and cannot go through it.
        AlarmPriority? minPriority = enabled.Count == 0
            ? null
            : enabled.Max(c => c.MinPriority);

        return new AlarmAnnunciationReady(
            configured.Count > 0, enabled.Count > 0, minPriority, HeartbeatSeconds);
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
