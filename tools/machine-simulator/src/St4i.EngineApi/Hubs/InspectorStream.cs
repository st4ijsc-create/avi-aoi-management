using System.Net.WebSockets;
using System.Text.Json;
using System.Threading.Channels;
using Microsoft.Extensions.DependencyInjection;
using St4i.EdgeCore.Infrastructure;
using St4i.EngineApi;
using St4i.EngineApi.Auth;

namespace St4i.EngineApi.Hubs;

/// <summary>
/// <c>WS /v1/inspector/stream</c> — on connect, backfills <see cref="EventBus.Recent"/>
/// (<see cref="BackfillEventCount"/>) as individual JSON messages (oldest-first, matching
/// <see cref="EventBus.Recent"/>'s own ordering), then
/// keeps pushing every subsequent <see cref="EventBus.Traced"/> event as its own JSON message for as
/// long as the socket stays open. Server-push-only (no client→server message contract) — the headless
/// host analogue of the WPF app's <c>ApiInspectorView</c>/<c>InspectorViewModel</c>, just over a raw
/// WebSocket instead of data-binding.
///
/// Final-review M-1: the backfill is skipped when the client passes <c>?skipBackfill=1</c> on the
/// upgrade request — <c>web/src/lib/inspector.ts</c> sets that on every RECONNECT (not the initial
/// connection), because otherwise a WS blip/engine hiccup mid-exhibition re-injects up to
/// <see cref="BackfillEventCount"/> already-seen historical rows into the client's ring as duplicates
/// every time it reconnects.
/// </summary>
public static class InspectorStreamEndpoint
{
    /// <summary>How many buffered <see cref="ApiTraceEvent"/>s a freshly-connected socket is replayed:
    /// 200. Owner item 28 — this used to be a bare <c>200</c> literal inside <see cref="RunAsync"/>, which
    /// made it the ONE cap on API-trace history with no name to point at, even though it is the cap that
    /// BINDS FIRST for anyone who just opened or reloaded the pane (the engine's own
    /// <see cref="EventBus.DefaultCapacity"/> ring holds 500, and the web tab's <c>RING_CAPACITY</c> holds
    /// 1000 — neither of those can hand a new tab more than this). Naming it is the whole point: a cap a
    /// reader cannot name is a cap a reader cannot check. It must never exceed
    /// <see cref="EventBus.DefaultCapacity"/> — a backfill larger than the ring it reads from would be a
    /// promise the ring cannot keep — and <c>InspectorStreamBackfillCapTests</c> holds that relation.</summary>
    internal const int BackfillEventCount = 200;

    /// <summary>🔴 The largest slot window <c>GET /v1/inspector/bodies</c> will look back over: 200 ring
    /// slots, the same depth a freshly-connected socket is backfilled to. Task AT-1, owner item 27.
    /// <para>It is pinned to <see cref="BackfillEventCount"/> deliberately. The body lane must never reach
    /// further back than the event lane a reader is correlating it against — a caller who can see 200
    /// events but 500 bodies would be handed bodies for events it has no way to display, which is a
    /// correlation trap rather than a feature. Like every other cap on this pane it is NAMED on the
    /// response itself (<c>slotWindow</c>), because owner item 28's finding was a UI that printed cap
    /// VALUES without ever saying they were caps.</para></summary>
    internal const int MaxBodySlotWindow = BackfillEventCount;

    /// <summary>🔴 <c>GET /v1/inspector/bodies</c> — the SEPARATE lane for request bodies, task AT-1, owner
    /// item 27 (the owner's ruling of 2026-08-22).
    /// <para>It is a distinct route rather than a member on <see cref="ApiTraceEvent"/> because that record
    /// leaves this process on three already-published surfaces — the WS frame this same class serializes,
    /// and the two JSON files the web and WPF Export buttons write — and the ruling froze all three. Adding
    /// a route adds a surface without moving any of them, which is the entire point of doing it this
    /// way.</para>
    /// <para>Same <see cref="Policies.Engineer"/> authorisation as the stream: a body is strictly more
    /// sensitive than the metadata, so it can never be reachable by a weaker policy than the events
    /// are.</para></summary>
    public static void MapInspectorBodies(this IEndpointRouteBuilder app)
    {
        ArgumentNullException.ThrowIfNull(app);

        app.MapGet("/v1/inspector/bodies", (HttpContext context, EventBus eventBus) =>
        {
            var slots = MaxBodySlotWindow;
            if (context.Request.Query.TryGetValue("slots", out var raw) &&
                int.TryParse(raw, out var requested) && requested > 0)
            {
                slots = Math.Min(requested, MaxBodySlotWindow);
            }

            return Results.Json(new InspectorBodiesResponse(
                Bodies: eventBus.RecentBodies(slots),
                SlotWindow: slots,
                MaxSlotWindow: MaxBodySlotWindow,
                RingCapacity: EventBus.DefaultCapacity,
                RetainedByteCap: ApiTraceBody.DefaultByteCap,
                MaxWithheldKeysListed: ApiTraceBody.MaxWithheldKeysListed,
                AllowedKeys: ApiTraceBody.AllowedKeys.OrderBy(k => k, StringComparer.Ordinal).ToArray()),
                ApiJson.Options);
        }).RequireAuthorization(Policies.Engineer);
    }

    public static void MapInspectorStream(this IEndpointRouteBuilder app)
    {
        app.Map("/v1/inspector/stream", async (HttpContext context) =>
        {
            if (!context.WebSockets.IsWebSocketRequest)
            {
                context.Response.StatusCode = StatusCodes.Status400BadRequest;
                await context.Response.WriteAsync("expected a WebSocket upgrade request").ConfigureAwait(false);
                return;
            }

            var eventBus = context.RequestServices.GetRequiredService<EventBus>();
            var skipBackfill = context.Request.Query.TryGetValue("skipBackfill", out var flag) &&
                (flag == "1" || string.Equals(flag, "true", StringComparison.OrdinalIgnoreCase));
            using var socket = await context.WebSockets.AcceptWebSocketAsync().ConfigureAwait(false);
            await RunAsync(socket, eventBus, skipBackfill, context.RequestAborted).ConfigureAwait(false);
        }).RequireAuthorization(Policies.Engineer);
    }

    private static async Task RunAsync(WebSocket socket, EventBus eventBus, bool skipBackfill, CancellationToken requestAborted)
    {
        // Unbounded: EventBus.Publish itself is already bounded (a 500-capacity ring — see its own
        // remarks), so a slow/stalled client can only ever cause this channel to grow to that same
        // bound's worth of trace events before the publisher-side ring itself starts dropping the
        // oldest, not runaway memory growth.
        var channel = Channel.CreateUnbounded<ApiTraceEvent>(new UnboundedChannelOptions { SingleReader = true, SingleWriter = false });
        void OnTraced(ApiTraceEvent e) => channel.Writer.TryWrite(e);

        // Subscribe BEFORE the Recent() backfill snapshot below, so no event published concurrently
        // with that snapshot is ever lost — the accepted cost is a harmless duplicate right at the seam
        // (a live trace view tolerates one repeated row far better than a silently dropped one).
        eventBus.Traced += OnTraced;

        using var linkedCts = CancellationTokenSource.CreateLinkedTokenSource(requestAborted);

        try
        {
            if (!skipBackfill)
            {
                foreach (var e in eventBus.Recent(BackfillEventCount))
                {
                    await SendAsync(socket, e, linkedCts.Token).ConfigureAwait(false);
                }
            }

            // Pumps (and discards) whatever the client sends — a WebSocket's receive loop must still run
            // even for a server-push-only stream, both to observe a client-initiated close handshake and
            // because some clients/proxies expect the server to keep reading control frames (ping/pong).
            var receiveTask = DrainIncomingAsync(socket, linkedCts);

            try
            {
                await foreach (var e in channel.Reader.ReadAllAsync(linkedCts.Token).ConfigureAwait(false))
                {
                    if (socket.State != WebSocketState.Open) break;
                    await SendAsync(socket, e, linkedCts.Token).ConfigureAwait(false);
                }
            }
            catch (OperationCanceledException)
            {
                // normal: requestAborted fired, or DrainIncomingAsync observed a close/error and cancelled us
            }

            linkedCts.Cancel();
            await receiveTask.ConfigureAwait(false);
        }
        catch (WebSocketException)
        {
            // normal: client dropped the connection mid-send
        }
        catch (OperationCanceledException)
        {
        }
        finally
        {
            eventBus.Traced -= OnTraced;
            channel.Writer.TryComplete();
            await TryCloseAsync(socket).ConfigureAwait(false);
        }
    }

    private static Task SendAsync(WebSocket socket, ApiTraceEvent e, CancellationToken ct)
    {
        var json = JsonSerializer.SerializeToUtf8Bytes(e, ApiJson.Options);
        return socket.SendAsync(json, WebSocketMessageType.Text, endOfMessage: true, ct);
    }

    private static async Task DrainIncomingAsync(WebSocket socket, CancellationTokenSource linkedCts)
    {
        var buffer = new byte[1024];
        try
        {
            while (socket.State == WebSocketState.Open && !linkedCts.IsCancellationRequested)
            {
                var result = await socket.ReceiveAsync(buffer, linkedCts.Token).ConfigureAwait(false);
                if (result.MessageType == WebSocketMessageType.Close)
                {
                    linkedCts.Cancel();
                    break;
                }
            }
        }
        catch (OperationCanceledException)
        {
        }
        catch (WebSocketException)
        {
            linkedCts.Cancel();
        }
    }

    private static async Task TryCloseAsync(WebSocket socket)
    {
        if (socket.State is not (WebSocketState.Open or WebSocketState.CloseReceived)) return;

        try
        {
            await socket.CloseAsync(WebSocketCloseStatus.NormalClosure, "closing", CancellationToken.None).ConfigureAwait(false);
        }
        catch (WebSocketException)
        {
        }
        catch (ObjectDisposedException)
        {
        }
    }
}

/// <summary>🔴 The response shape of <c>GET /v1/inspector/bodies</c> — task AT-1, owner item 27.
/// <para>Every ceiling that shaped this payload is a FIELD on it rather than a number a reader has to know
/// already. That is the direct lesson of owner item 28, which found four caps on API-trace history and a UI
/// that printed their values without ever naming one as a cap: a reader who cannot see the ceiling cannot
/// tell a short list from a truncated one.</para>
/// <para>🔴 This shape is NEW, and nothing about it is shared with the trace event's wire contract. It is
/// deliberately not a superset, not a wrapper around, and not a version of the
/// <c>WS /v1/inspector/stream</c> frame — those stay byte-identical, which is what the ruling
/// required.</para></summary>
/// <param name="Bodies">The retained bodies found in the inspected slots, oldest-first. Normally SHORTER
/// than <paramref name="SlotWindow"/>: a slot whose publisher retained no body contributes nothing, so this
/// length is not an event count and must not be read as one.</param>
/// <param name="SlotWindow">How many ring slots were actually inspected — the effective window after the
/// <c>?slots=</c> query value was clamped.</param>
/// <param name="MaxSlotWindow">The ceiling <paramref name="SlotWindow"/> was clamped to.</param>
/// <param name="RingCapacity">The engine ring's depth. Bodies older than this are gone regardless of what
/// was asked for, because a body is evicted in the same slot as the event it belongs to.</param>
/// <param name="RetainedByteCap">The per-body byte ceiling. A body whose <c>truncated</c> flag is set was
/// cut to this, and its <c>json</c> is a byte prefix rather than parseable JSON.</param>
/// <param name="MaxWithheldKeysListed">The ceiling on how many withheld key NAMES are listed per body;
/// each body's own <c>withheldKeyCount</c> reports the true total.</param>
/// <param name="AllowedKeys">The complete allowlist — the only payload keys that can ever appear rendered
/// with a value. Published here so a reader can tell "this key was absent from the payload" from "this key
/// is never shown", which are very different facts and are otherwise indistinguishable.</param>
public sealed record InspectorBodiesResponse(
    IReadOnlyList<ApiTraceBody> Bodies,
    int SlotWindow,
    int MaxSlotWindow,
    int RingCapacity,
    int RetainedByteCap,
    int MaxWithheldKeysListed,
    IReadOnlyList<string> AllowedKeys);
