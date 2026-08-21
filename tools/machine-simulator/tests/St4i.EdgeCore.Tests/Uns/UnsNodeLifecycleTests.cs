using System.Collections.Concurrent;
using System.Linq;
using MQTTnet;
using St4i.EdgeCore.Mapping;
using St4i.Connector.Abstractions.Models;
using St4i.EdgeCore.Uns;
using St4i.EdgeCore.Uns.Sparkplug;
using Xunit;

namespace St4i.EdgeCore.Tests.Uns;

/// <summary>
/// G2-3 (WS-B Phase B1) — end-to-end proof of <see cref="UnsPublisher"/>'s NODE-level Sparkplug lifecycle:
/// <see cref="UnsPublisher.PublishNodeBirth"/> (NBIRTH — resets the node sequence, carries a monotonic
/// <c>bdSeq</c> metric) and <see cref="UnsPublisher.PublishNodeDeath"/> (NDEATH — pairs with the most
/// recent birth via the SAME bdSeq; a no-op, born-guarded, when no birth is outstanding). Also the
/// regression guard for the companion DBIRTH seq-reset fix: per Sparkplug B spec, ONLY an NBIRTH resets
/// the edge node's sequence — a DBIRTH must not.
///
/// Same "no fixed Task.Delay, only bounded (&lt;=5s) polling against a real broker round-trip" discipline
/// as <see cref="UnsPublisherIntegrationTests"/> (the repo has known MQTT timing flakiness this avoids
/// entirely) — including the born-guard absence check, which proves a negative via a CANARY message
/// (published right after the no-op death call, then waited for) rather than a blind sleep: because the
/// publisher's background flush loop drains its channel strictly in enqueue order, the canary's arrival
/// proves the loop has drained past the point a buggy NDEATH would have been queued.
/// </summary>
public sealed class UnsNodeLifecycleTests
{
    private static readonly TimeSpan PollTimeout = TimeSpan.FromSeconds(5);
    private static readonly TimeSpan PollInterval = TimeSpan.FromMilliseconds(25);

    private static async Task WaitUntilAsync(Func<bool> predicate, string because)
    {
        var deadline = DateTime.UtcNow + PollTimeout;
        while (DateTime.UtcNow < deadline)
        {
            if (predicate()) return;
            await Task.Delay(PollInterval);
        }

        Assert.True(predicate(), $"timed out after {PollTimeout} waiting for: {because}");
    }

    /// <summary>Same fully-qualified <c>.ToArray()</c> disambiguation <see cref="UnsPublisherIntegrationTests"/>
    /// already documents (ReadOnlySequence&lt;T&gt; vs ImmutableArrayExtensions both in scope).</summary>
    private static byte[] PayloadBytes(MqttApplicationMessage message) =>
        System.Buffers.BuffersExtensions.ToArray(message.Payload);

    private static long BdSeqOf(SparkplugPayloadMessage msg) =>
        (long)msg.Metrics.Single(m => m.Name == "bdSeq").Value;

    private static DeviceReading BuildProcessResultReading(string machineCode) => new()
    {
        MachineCode = machineCode,
        Kind = ReadingKind.ProcessResult,
        SerialNumber = "SN-1",
        StepType = "screw_tightening",
        Verdict = Verdict.Pass,
        RecipeCode = "RC-1",
        CycleCounter = 1,
        Timestamp = DateTimeOffset.UtcNow,
        Metrics = new() { new MetricSample("torque", 12.3, "Nm") },
    };

    [Fact]
    public async Task PublishNodeBirth_PublishesNbirthWithSeqZero_AndBdSeqMetricZero()
    {
        const int port = 18843;
        var options = new UnsOptions { Site = "s1", Area = "a1", Line = "l1", Cell = "c1", BrokerPort = port };

        await using var broker = new UnsBroker(port);
        await broker.StartAsync();

        SparkplugPayloadMessage? decoded = null;
        var factory = new MqttClientFactory();
        using var subscriber = factory.CreateMqttClient();
        var nbirthTopic = UnsTopicBuilder.BuildSparkplugTopic(options, SparkplugMsgType.NBIRTH);
        subscriber.ApplicationMessageReceivedAsync += args =>
        {
            decoded = SparkplugPayload.Decode(PayloadBytes(args.ApplicationMessage));
            return Task.CompletedTask;
        };
        await subscriber.ConnectAsync(new MqttClientOptionsBuilder().WithTcpServer("127.0.0.1", port).Build());
        await subscriber.SubscribeAsync(new MqttClientSubscribeOptionsBuilder().WithTopicFilter(nbirthTopic).Build());

        await using var publisher = new UnsPublisher(options);

        publisher.PublishNodeBirth();

        await WaitUntilAsync(() => decoded is not null, "the NBIRTH message to arrive");

        Assert.Equal(0UL, decoded!.Seq);
        var bdSeqMetric = Assert.Single(decoded.Metrics, m => m.Name == "bdSeq");
        Assert.Equal(SparkplugDataType.Int64, bdSeqMetric.DataType);
        Assert.Equal(0L, (long)bdSeqMetric.Value);
    }

    [Fact]
    public async Task PublishNodeBirthThenDeath_PairsBdSeq_AndIsMonotonicAcrossCycles()
    {
        const int port = 18844;
        var options = new UnsOptions { Site = "s1", Area = "a1", Line = "l1", Cell = "c1", BrokerPort = port };

        await using var broker = new UnsBroker(port);
        await broker.StartAsync();

        var nbirths = new ConcurrentQueue<SparkplugPayloadMessage>();
        var ndeaths = new ConcurrentQueue<SparkplugPayloadMessage>();
        var nbirthTopic = UnsTopicBuilder.BuildSparkplugTopic(options, SparkplugMsgType.NBIRTH);
        var ndeathTopic = UnsTopicBuilder.BuildSparkplugTopic(options, SparkplugMsgType.NDEATH);

        var factory = new MqttClientFactory();
        using var subscriber = factory.CreateMqttClient();
        subscriber.ApplicationMessageReceivedAsync += args =>
        {
            var msg = SparkplugPayload.Decode(PayloadBytes(args.ApplicationMessage));
            if (args.ApplicationMessage.Topic == nbirthTopic) nbirths.Enqueue(msg);
            else if (args.ApplicationMessage.Topic == ndeathTopic) ndeaths.Enqueue(msg);
            return Task.CompletedTask;
        };
        await subscriber.ConnectAsync(new MqttClientOptionsBuilder().WithTcpServer("127.0.0.1", port).Build());
        await subscriber.SubscribeAsync(new MqttClientSubscribeOptionsBuilder()
            .WithTopicFilter(nbirthTopic)
            .WithTopicFilter(ndeathTopic)
            .Build());

        await using var publisher = new UnsPublisher(options);

        publisher.PublishNodeBirth();
        await WaitUntilAsync(() => nbirths.Count == 1, "the first NBIRTH to arrive");
        Assert.Equal(0L, BdSeqOf(nbirths.ElementAt(0)));

        publisher.PublishNodeDeath();
        await WaitUntilAsync(() => ndeaths.Count == 1, "the NDEATH to arrive");
        Assert.Equal(0L, BdSeqOf(ndeaths.ElementAt(0)));

        publisher.PublishNodeBirth();
        await WaitUntilAsync(() => nbirths.Count == 2, "the second NBIRTH (a new cycle) to arrive");
        Assert.Equal(1L, BdSeqOf(nbirths.ElementAt(1)));
    }

    [Fact]
    public async Task PublishNodeDeath_WithoutPrecedingBirth_IsABornGuardedNoOp_NoNdeathMessageEverArrives()
    {
        const int port = 18845;
        var options = new UnsOptions { Site = "s1", Area = "a1", Line = "l1", Cell = "c1", BrokerPort = port };

        await using var broker = new UnsBroker(port);
        await broker.StartAsync();

        var ndeaths = new ConcurrentQueue<MqttApplicationMessage>();
        var canaryArrived = new ConcurrentQueue<MqttApplicationMessage>();
        var ndeathTopic = UnsTopicBuilder.BuildSparkplugTopic(options, SparkplugMsgType.NDEATH);
        var canaryTopic = UnsTopicBuilder.BuildSparkplugDataTopic(options, "CANARY");

        var factory = new MqttClientFactory();
        using var subscriber = factory.CreateMqttClient();
        subscriber.ApplicationMessageReceivedAsync += args =>
        {
            if (args.ApplicationMessage.Topic == ndeathTopic) ndeaths.Enqueue(args.ApplicationMessage);
            else if (args.ApplicationMessage.Topic == canaryTopic) canaryArrived.Enqueue(args.ApplicationMessage);
            return Task.CompletedTask;
        };
        await subscriber.ConnectAsync(new MqttClientOptionsBuilder().WithTcpServer("127.0.0.1", port).Build());
        await subscriber.SubscribeAsync(new MqttClientSubscribeOptionsBuilder()
            .WithTopicFilter(ndeathTopic)
            .WithTopicFilter(canaryTopic)
            .Build());

        await using var publisher = new UnsPublisher(options);

        publisher.PublishNodeDeath(); // no preceding birth — the born-guard resolves this synchronously,
                                       // BEFORE anything is written to the channel.

        // Canary, published right after: since the flush loop drains its channel strictly in enqueue
        // order, this message's arrival proves the loop has drained past where a (buggy) NDEATH would
        // have landed — a deterministic, bounded way to prove a negative with no fixed sleep.
        var canaryReading = BuildProcessResultReading("CANARY");
        var envelope = Normalizer.Normalize(canaryReading, MappingProfile.ForClass(DeviceClass.Automation));
        publisher.PublishReading(canaryReading, envelope);

        await WaitUntilAsync(() => canaryArrived.Count == 1, "the canary reading to arrive after the no-op death call");

        Assert.Empty(ndeaths);
    }

    [Fact]
    public async Task PublishNodeBirth_ResetsTheNodeSequence_NextDdataDecodesToSeqOne()
    {
        const int port = 18846;
        var options = new UnsOptions { Site = "s1", Area = "a1", Line = "l1", Cell = "c1", BrokerPort = port };

        await using var broker = new UnsBroker(port);
        await broker.StartAsync();

        SparkplugPayloadMessage? decoded = null;
        var ddataTopic = UnsTopicBuilder.BuildSparkplugDataTopic(options, "EQ-SEQ");

        var factory = new MqttClientFactory();
        using var subscriber = factory.CreateMqttClient();
        subscriber.ApplicationMessageReceivedAsync += args =>
        {
            if (args.ApplicationMessage.Topic == ddataTopic)
            {
                decoded = SparkplugPayload.Decode(PayloadBytes(args.ApplicationMessage));
            }

            return Task.CompletedTask;
        };
        await subscriber.ConnectAsync(new MqttClientOptionsBuilder().WithTcpServer("127.0.0.1", port).Build());
        await subscriber.SubscribeAsync(new MqttClientSubscribeOptionsBuilder().WithTopicFilter(ddataTopic).Build());

        await using var publisher = new UnsPublisher(options);

        publisher.PublishNodeBirth(); // takes seq 0, resets the tracker

        var reading = BuildProcessResultReading("EQ-SEQ");
        var envelope = Normalizer.Normalize(reading, MappingProfile.ForClass(DeviceClass.Automation));
        publisher.PublishReading(reading, envelope);

        await WaitUntilAsync(() => decoded is not null, "the DDATA message following the NBIRTH to arrive");

        Assert.Equal(1UL, decoded!.Seq);
    }

    // 🔴 DELETED 2026-08-21 — `PublishBirth_DeviceLevelDbirth_DoesNotResetTheNodeSequence`. This is the
    // ONE test in the tree that CALLED IUnsPublisher.PublishBirth rather than merely implementing it on a
    // fake, and the owner's ruling on owner-decisions.md item 23 removed that method. This is the single
    // test EXPECT_EDGECORE moves for (1168 -> 1167).
    //
    // WHAT IS LOST, STATED PLAINLY BECAUSE A DELETED REGRESSION GUARD IS A COST AND NOT A TIDY-UP: it was
    // a real guard for a real fixed defect. G2-2's PublishBirthCoreAsync called _seq.ResetOnBirth(), which
    // the Sparkplug B spec forbids for a DEVICE birth (only NBIRTH resets an edge node's sequence). G2-3
    // fixed it, and this test pinned the fix with the exact discriminating value (reading2 at seq 2 —
    // seq 1 would have meant the reset was back), rather than a looser non-zero check that could not tell
    // fixed from buggy.
    //
    // WHY THE LOSS IS BOUNDED RATHER THAN OPEN: the defect it guarded was a wrong sequence reset inside
    // the DBIRTH publish path, and that path no longer exists — there is now no code in this repository
    // that publishes a DBIRTH at all, so the specific regression cannot recur while that stays true. The
    // sibling rule it does NOT cover is still covered: `NodeBirth_ResetsTheSequence`-style guards for
    // NBIRTH (the message that MUST reset) remain in this file, untouched. If a DBIRTH path is ever
    // re-introduced, this test is the one to re-introduce with it.

}
