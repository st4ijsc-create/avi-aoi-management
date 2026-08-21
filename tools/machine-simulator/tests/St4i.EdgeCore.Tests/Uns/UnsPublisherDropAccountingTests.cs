using System.Net;
using System.Net.Sockets;
using St4i.EdgeCore.Uns;
using Xunit;

namespace St4i.EdgeCore.Tests.Uns;

/// <summary>
/// 🔴 Owner decision 15, task AP-1 (2026-08-21) — <see cref="UnsPublisher"/>'s drop accounting. Before this
/// file, nothing in this repository asserted anything about this publisher's bounded queue under pressure:
/// its six <c>"UNS publish queue saturated"</c> branches were unreachable by saturation (a
/// <see cref="System.Threading.Channels.BoundedChannelFullMode.DropOldest"/> <c>TryWrite</c> returns
/// <see langword="true"/> on a FULL channel), so the UNS spine lost its OLDEST pending publishes — readings,
/// device birth/death, node birth/death, line state — with no log, no counter and no line on
/// <c>/v1/health</c>. The same pair of witnesses exists for the other two channels the ruling covers:
/// <c>HistorianWriterTests.Enqueue_OnAFullChannel_...</c> and
/// <c>UnsBridgeSpoolTests.ForwardQueueSaturated_...</c>.
///
/// <para>🔴 <b>How the reader is held off, and why it is not a sleep.</b> <c>RunFlushLoopAsync</c> awaits the
/// connect task ONCE before it touches the channel at all. So the queue is provably untouched for as long as
/// the MQTT connect has not resolved — and a <see cref="TcpListener"/> that is started but never accepted
/// from gives exactly that: the OS completes the TCP handshake into the backlog, so the connect does not
/// fail fast, and MQTTnet then waits for a CONNACK that never arrives. The window is the client's own
/// connect timeout (ten seconds by default) against a handful of synchronous enqueues, and it is not merely
/// assumed: every test below asserts <c>Queued == Capacity</c>, which is false the instant the reader
/// consumed anything. A drained channel therefore FAILS these tests instead of quietly changing what they
/// measure.</para>
/// </summary>
public sealed class UnsPublisherDropAccountingTests
{
    /// <summary>Starts a socket that accepts at the TCP level and never speaks MQTT — see the class doc
    /// comment. The caller stops it in a <c>finally</c>, which also lets the publisher's own disposal finish
    /// promptly instead of waiting out its 5s drain bound.</summary>
    private static TcpListener StartSilentListener(out int port)
    {
        var listener = new TcpListener(IPAddress.Loopback, 0);
        listener.Start();
        port = ((IPEndPoint)listener.LocalEndpoint).Port;
        return listener;
    }

    /// <summary>🔴 The silent loss, made loud. Every eviction is counted
    /// (<see cref="UnsPublisherStats.Evicted"/>), warned as SATURATION, and kept apart from the shutdown
    /// drops — which is the whole point, because the branch this class shipped with carried the saturation
    /// wording on the only path that could never be saturation.</summary>
    [Fact]
    public async Task PublishOnAFullQueue_EvictsTheOldest_AndEveryEvictionIsCountedAndWarned()
    {
        const int Capacity = 4;
        const int Extra = 3;

        var warnings = new List<string>();
        var listener = StartSilentListener(out var port);
        var publisher = new UnsPublisher(
            new UnsOptions { BrokerPort = port },
            logWarning: msg => { lock (warnings) warnings.Add(msg); },
            capacity: Capacity);

        try
        {
            for (var i = 0; i < Capacity + Extra; i++)
            {
                publisher.PublishLineState($"state-{i}");
            }

            var stats = publisher.Stats;
            Assert.Equal(Capacity, stats.Queued);           // the flush loop really did consume nothing
            Assert.Equal(Extra, stats.Evicted);             // every eviction counted...
            Assert.Equal(0, stats.DroppedAfterShutdown);    // ...and NOT confused with a shutdown drop

            List<string> seen;
            lock (warnings) seen = warnings.ToList();
            Assert.Equal(Extra, seen.Count);
            Assert.All(seen, msg =>
            {
                Assert.Contains("saturated", msg, StringComparison.Ordinal);
                Assert.DoesNotContain("shutting down", msg, StringComparison.Ordinal);
            });

            // Oldest-first, and named by the message: the evicted items are states 0..Extra-1, never the
            // newest. A counter that moved for the wrong item would satisfy the arithmetic above.
            for (var i = 0; i < Extra; i++)
            {
                Assert.Contains(seen, msg => msg.Contains($"lineState(state-{i})", StringComparison.Ordinal));
            }
        }
        finally
        {
            listener.Stop();
            await publisher.DisposeAsync();
        }
    }

    /// <summary>🔴 The other half: a publish refused because the publisher is shutting down is counted
    /// SEPARATELY and worded differently. "The UNS spine is not keeping up" during an orderly exit sends an
    /// operator after a problem that does not exist.</summary>
    [Fact]
    public async Task PublishAfterDispose_IsCountedSeparately_AndReportedAsShutdownNotSaturation()
    {
        var warnings = new List<string>();
        var listener = StartSilentListener(out var port);
        var publisher = new UnsPublisher(
            new UnsOptions { BrokerPort = port },
            logWarning: msg => { lock (warnings) warnings.Add(msg); });

        try
        {
            await publisher.DisposeAsync();

            // Deliberately the SAME method twice rather than one of the Publish*/Birth pair: owner item 23
            // has already been ruled REMOVE, and a witness written across a member another task is deleting
            // would hand that task a repair it never asked for.
            publisher.PublishLineState("after-1");
            publisher.PublishLineState("after-2");

            var stats = publisher.Stats;
            Assert.Equal(2, stats.DroppedAfterShutdown);
            Assert.Equal(0, stats.Evicted);

            List<string> seen;
            lock (warnings) seen = warnings.ToList();
            Assert.Equal(2, seen.Count);
            Assert.All(seen, msg =>
            {
                Assert.Contains("shutdown", msg, StringComparison.Ordinal);
                Assert.DoesNotContain("saturated", msg, StringComparison.Ordinal);
                Assert.DoesNotContain("not keeping up", msg, StringComparison.Ordinal);
            });
        }
        finally
        {
            listener.Stop();
            await publisher.DisposeAsync();
        }
    }
}
