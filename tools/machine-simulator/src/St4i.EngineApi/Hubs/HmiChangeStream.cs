using System.Net.WebSockets;
using System.Text.Json;
using System.Threading.Channels;
using Microsoft.Extensions.DependencyInjection;
using St4i.EngineApi.Auth;
using St4i.EngineApi.HmiModel;
using St4i.Hmi.Contracts;

namespace St4i.EngineApi.Hubs;

/// <summary>
/// <c>WS /v1/hmi/changes</c> — WS-HMI-0b Task 3. Pushes a <see cref="HmiModelChangedEvent"/> as its own
/// JSON message each time a component tree or a tag namespace is successfully written, for as long as the
/// socket stays open.
///
/// <para>🔴 <b>A SECOND ROUTE, NOT A SECOND MECHANISM.</b> The plan's architecture note said to extend
/// <c>WS /v1/inspector/stream</c> rather than add an SSE channel, so that an offline single-machine product
/// does not make the web branch speak two realtime dialects. That goal is met: this is a WebSocket, same
/// transport and same client library, at one more URL. What could not be met was extending the inspector
/// stream itself — its frame is <c>ApiTraceEvent</c>, a closed record whose shape is frozen by the ruling
/// at <c>InspectorStream.cs:217-219</c> across three published surfaces, and an HMI change has no truthful
/// <c>ReadingKind</c> and nowhere to put a tag count. See <see cref="HmiModelChangedEvent"/> for the full
/// reasoning and for what this lane does and does not commit to.</para>
///
/// <para>🔴 <b>THIS LANE REPLAYS NOTHING ON CONNECT, and that is a decision rather than an omission.</b>
/// A change event is an INVALIDATION SIGNAL, not a record. A client that has just connected is about to
/// read current state anyway, so replaying history would only make a fresh pane issue re-reads for changes
/// it never missed. And a bounded replay could not promise completeness to a RECONNECTING client either —
/// a disconnect of unknown length can outrun any ring — so a client that cares must re-read on reconnect
/// regardless, which means a backfill here would buy nothing anyone could rely on. There is therefore no
/// ring behind <see cref="IHmiChangeBus"/> at all: the absence is structural, not a configuration set to
/// zero, so there is no cap for a future reader to have to find and check.
///
/// <para><b>The rule, stated once:</b> <i>a subscriber is told about changes that happen while it is
/// subscribed, and nothing else. On connect and on reconnect alike, read current state.</i> Note the
/// contrast the neighbouring lane makes necessary to say out loud:
/// <c>WS /v1/inspector/stream</c> backfills 200 and skips it only when the client passes
/// <c>?skipBackfill=1</c>, which <c>web/src/lib/inspector.ts</c> sets on RECONNECT but not on first
/// connect — so that lane behaves differently for a fresh pane than for a reconnecting one. This one
/// behaves identically for both, which is the point of choosing rather than inheriting.</para></para>
///
/// <para><b><see cref="Policies.Operator"/>, not <see cref="Policies.Engineer"/> like the inspector
/// stream.</b> Subscribing is a read, and what it carries — a machine code and a tag count — is strictly
/// less than <c>GET /v1/tags?machine=</c> already returns at Operator. Gating a notification higher than
/// the data it points at would be a difference with no rationale behind it. Nothing on this lane writes to
/// a device, so <c>Admin</c> is never involved.</para>
/// </summary>
public static class HmiChangeStreamEndpoint
{
    public static void MapHmiChangeStream(this IEndpointRouteBuilder app)
    {
        ArgumentNullException.ThrowIfNull(app);

        app.Map("/v1/hmi/changes", async (HttpContext context) =>
        {
            if (!context.WebSockets.IsWebSocketRequest)
            {
                context.Response.StatusCode = StatusCodes.Status400BadRequest;
                await context.Response.WriteAsync("expected a WebSocket upgrade request").ConfigureAwait(false);
                return;
            }

            var bus = context.RequestServices.GetRequiredService<IHmiChangeBus>();
            using var socket = await context.WebSockets.AcceptWebSocketAsync().ConfigureAwait(false);
            await RunAsync(socket, bus, context.RequestAborted).ConfigureAwait(false);
        }).RequireAuthorization(Policies.Operator);
    }

    private static async Task RunAsync(WebSocket socket, IHmiChangeBus bus, CancellationToken requestAborted)
    {
        // Unbounded, and bounded in practice by the fact that this lane publishes once per successful
        // HMI write — a rate a human engineer sets, not a device. Same shape as InspectorStream's pump.
        var channel = Channel.CreateUnbounded<HmiModelChangedEvent>(
            new UnboundedChannelOptions { SingleReader = true, SingleWriter = false });

        // TryWrite cannot throw, which matters more here than it does next door: HmiChangeBus.Publish
        // swallows subscriber failures precisely so a write is never failed by its own announcement, and a
        // handler that could throw would be leaning on that safety net instead of not needing it.
        void OnChanged(HmiModelChangedEvent e) => channel.Writer.TryWrite(e);

        bus.Changed += OnChanged;

        using var linkedCts = CancellationTokenSource.CreateLinkedTokenSource(requestAborted);

        try
        {
            // No backfill — see this class's own doc comment. Subscription above is the whole of "connect".
            var receiveTask = DrainIncomingAsync(socket, linkedCts);

            try
            {
                await foreach (var e in channel.Reader.ReadAllAsync(linkedCts.Token).ConfigureAwait(false))
                {
                    if (socket.State != WebSocketState.Open) break;
                    var json = JsonSerializer.SerializeToUtf8Bytes(e, HmiContractJson.Options);
                    await socket.SendAsync(json, WebSocketMessageType.Text, endOfMessage: true, linkedCts.Token)
                        .ConfigureAwait(false);
                }
            }
            catch (OperationCanceledException)
            {
                // normal: the request was aborted, or the receive loop observed a close and cancelled us
            }

            linkedCts.Cancel();
            await receiveTask.ConfigureAwait(false);
        }
        catch (WebSocketException)
        {
            // normal: the client dropped the connection mid-send
        }
        catch (OperationCanceledException)
        {
        }
        finally
        {
            bus.Changed -= OnChanged;
            channel.Writer.TryComplete();
            await TryCloseAsync(socket).ConfigureAwait(false);
        }
    }

    /// <summary>Pumps and discards whatever the client sends. A server-push-only stream still has to run a
    /// receive loop — to observe a client-initiated close handshake, and because some clients and proxies
    /// expect the server to keep reading control frames.</summary>
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
            await socket.CloseAsync(WebSocketCloseStatus.NormalClosure, "closing", CancellationToken.None)
                .ConfigureAwait(false);
        }
        catch (WebSocketException)
        {
        }
        catch (ObjectDisposedException)
        {
        }
    }
}
