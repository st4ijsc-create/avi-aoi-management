using System.Net.WebSockets;
using System.Text.Json;
using System.Threading.Channels;
using Microsoft.Extensions.DependencyInjection;
using St4i.EdgeCore.Infrastructure;
using St4i.EngineApi;

namespace St4i.EngineApi.Hubs;

/// <summary>
/// <c>WS /v1/inspector/stream</c> — on connect, backfills <see cref="EventBus.Recent"/>(200) as
/// individual JSON messages (oldest-first, matching <see cref="EventBus.Recent"/>'s own ordering), then
/// keeps pushing every subsequent <see cref="EventBus.Traced"/> event as its own JSON message for as
/// long as the socket stays open. Server-push-only (no client→server message contract) — the headless
/// host analogue of the WPF app's <c>ApiInspectorView</c>/<c>InspectorViewModel</c>, just over a raw
/// WebSocket instead of data-binding.
/// </summary>
public static class InspectorStreamEndpoint
{
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
            using var socket = await context.WebSockets.AcceptWebSocketAsync().ConfigureAwait(false);
            await RunAsync(socket, eventBus, context.RequestAborted).ConfigureAwait(false);
        });
    }

    private static async Task RunAsync(WebSocket socket, EventBus eventBus, CancellationToken requestAborted)
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
            foreach (var e in eventBus.Recent(200))
            {
                await SendAsync(socket, e, linkedCts.Token).ConfigureAwait(false);
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
