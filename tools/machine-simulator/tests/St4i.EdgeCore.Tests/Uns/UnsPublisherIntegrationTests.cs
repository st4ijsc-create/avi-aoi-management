using System.Collections.Concurrent;
using System.Text;
using System.Text.Json;
using MQTTnet;
using St4i.EdgeCore.Mapping;
using St4i.EdgeCore.Models;
using St4i.EdgeCore.Uns;
using St4i.EdgeCore.Uns.Sparkplug;
using Xunit;

namespace St4i.EdgeCore.Tests.Uns;

/// <summary>
/// G2-2 — end-to-end proof that <see cref="UnsPublisher"/> genuinely round-trips through a real MQTT
/// broker (<see cref="UnsBroker"/>, MQTTnet v5 — same wire protocol <c>MqttDriverTests</c> already proves
/// out for the driver side): publishing ONE reading results in a message on BOTH the Sparkplug DDATA topic
/// (decodable via <see cref="SparkplugPayload.Decode"/>) and the retained semantic <c>syn/...</c> mirror
/// (JSON = the same <see cref="CanonicalEnvelope"/> passed in).
///
/// Deliberately no <c>Task.Delay</c>-based sleeps for synchronization (the repo has pre-existing MQTT
/// timing flakiness — see MqttDriverTests' own 500ms "let it connect" delay, which this file avoids
/// entirely): every wait is a bounded (&lt;=5s) poll, same <c>WaitUntilAsync</c> shape
/// <c>HistorianWriterTests</c> already uses.
/// </summary>
public sealed class UnsPublisherIntegrationTests
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

    /// <summary>MqttApplicationMessage.Payload is a <see cref="ReadOnlySequence{T}"/> — its own
    /// <c>.ToArray()</c> extension is ambiguous at this call site against
    /// <see cref="System.Collections.Immutable.ImmutableArrayExtensions"/>'s same-named extension (both in
    /// scope via this project's implicit usings), so this fully-qualifies the one this file actually means.</summary>
    private static byte[] PayloadBytes(MqttApplicationMessage message) =>
        System.Buffers.BuffersExtensions.ToArray(message.Payload);

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
    public async Task PublishReading_DeliversBothSparkplugDdataAndRetainedSemanticMirror_ThroughARealBroker()
    {
        const int port = 18840;
        var options = new UnsOptions { Site = "s1", Area = "a1", Line = "l1", Cell = "c1", BrokerPort = port };

        await using var broker = new UnsBroker(port);
        await broker.StartAsync();

        var received = new ConcurrentDictionary<string, MqttApplicationMessage>();
        var factory = new MqttClientFactory();
        using var subscriber = factory.CreateMqttClient();
        subscriber.ApplicationMessageReceivedAsync += args =>
        {
            received[args.ApplicationMessage.Topic] = args.ApplicationMessage;
            return Task.CompletedTask;
        };
        await subscriber.ConnectAsync(new MqttClientOptionsBuilder().WithTcpServer("127.0.0.1", port).Build());
        await subscriber.SubscribeAsync(new MqttClientSubscribeOptionsBuilder()
            .WithTopicFilter("spBv1.0/#")
            .WithTopicFilter("syn/#")
            .Build());

        await using var publisher = new UnsPublisher(options);

        var reading = BuildProcessResultReading("EQ-1");
        var envelope = Normalizer.Normalize(reading, MappingProfile.ForClass(DeviceClass.Automation));

        publisher.PublishReading(reading, envelope);

        var sparkplugTopic = UnsTopicBuilder.BuildSparkplugDataTopic(options, "EQ-1");
        var semanticTopic = UnsTopicBuilder.BuildSemanticTopic(options, "EQ-1", ReadingKind.ProcessResult);

        await WaitUntilAsync(
            () => received.ContainsKey(sparkplugTopic) && received.ContainsKey(semanticTopic),
            "both the Sparkplug DDATA and semantic-mirror messages to arrive on the subscriber");

        // Semantic mirror: JSON = the canonical envelope.
        var semanticMessage = received[semanticTopic];
        var json = Encoding.UTF8.GetString(PayloadBytes(semanticMessage));
        using var doc = JsonDocument.Parse(json);
        Assert.Equal("EQ-1", doc.RootElement.GetProperty("machineCode").GetString());
        Assert.Equal(envelope.Path, doc.RootElement.GetProperty("path").GetString());
        Assert.Equal(envelope.IdempotencyKey, doc.RootElement.GetProperty("idempotencyKey").GetString());

        // Sparkplug DDATA: decodable, carries the metric + the verdict/cycleCounter this codec maps on.
        var sparkplugMessage = received[sparkplugTopic];
        var decodedPayload = SparkplugPayload.Decode(PayloadBytes(sparkplugMessage));
        Assert.Contains(decodedPayload.Metrics, m => m.Name == "torque" && (double)m.Value == 12.3);
        Assert.Contains(decodedPayload.Metrics, m => m.Name == "verdict" && (string)m.Value == "Pass");
        Assert.Contains(decodedPayload.Metrics, m => m.Name == "cycleCounter" && (long)m.Value == 1L);

        // Retention proof: per MQTT-3.3.1-9, the broker sets Retain=0 when forwarding a LIVE message to an
        // ALREADY-subscribed client (which is what `received` above captured) — retention can only be
        // proven by a subscriber that connects/subscribes AFTER the publish and gets the message replayed
        // BECAUSE it's retained, with Retain=1 on that replay. This is that proof.
        using var lateSubscriber = factory.CreateMqttClient();
        MqttApplicationMessage? replayed = null;
        lateSubscriber.ApplicationMessageReceivedAsync += args =>
        {
            if (args.ApplicationMessage.Topic == semanticTopic) replayed = args.ApplicationMessage;
            return Task.CompletedTask;
        };
        await lateSubscriber.ConnectAsync(new MqttClientOptionsBuilder().WithTcpServer("127.0.0.1", port).Build());
        await lateSubscriber.SubscribeAsync(new MqttClientSubscribeOptionsBuilder().WithTopicFilter(semanticTopic).Build());

        await WaitUntilAsync(() => replayed is not null, "a late subscriber to receive the retained semantic-mirror message on subscribe");
        Assert.True(replayed!.Retain);
    }

    [Fact]
    public async Task PublishReading_CalledTwice_SecondSparkplugMessageHasAnIncrementedSeq()
    {
        const int port = 18841;
        var options = new UnsOptions { Site = "s1", Area = "a1", Line = "l1", Cell = "c1", BrokerPort = port };

        await using var broker = new UnsBroker(port);
        await broker.StartAsync();

        var seenSeqs = new ConcurrentBag<ulong>();
        var factory = new MqttClientFactory();
        using var subscriber = factory.CreateMqttClient();
        subscriber.ApplicationMessageReceivedAsync += args =>
        {
            seenSeqs.Add(SparkplugPayload.Decode(PayloadBytes(args.ApplicationMessage)).Seq);
            return Task.CompletedTask;
        };
        await subscriber.ConnectAsync(new MqttClientOptionsBuilder().WithTcpServer("127.0.0.1", port).Build());
        var sparkplugTopic = UnsTopicBuilder.BuildSparkplugDataTopic(options, "EQ-2");
        await subscriber.SubscribeAsync(new MqttClientSubscribeOptionsBuilder().WithTopicFilter(sparkplugTopic).Build());

        await using var publisher = new UnsPublisher(options);
        var profile = MappingProfile.ForClass(DeviceClass.Automation);

        var reading1 = BuildProcessResultReading("EQ-2");
        publisher.PublishReading(reading1, Normalizer.Normalize(reading1, profile));

        await WaitUntilAsync(() => seenSeqs.Count >= 1, "the first DDATA message to arrive");

        var reading2 = BuildProcessResultReading("EQ-2");
        reading2.CycleCounter = 2;
        publisher.PublishReading(reading2, Normalizer.Normalize(reading2, profile));

        await WaitUntilAsync(() => seenSeqs.Count >= 2, "the second DDATA message to arrive");

        var ordered = seenSeqs.OrderBy(s => s).ToList();
        Assert.Equal(2, ordered.Count);
        Assert.Equal(ordered[0] + 1, ordered[1]);
    }

    [Fact]
    public async Task PublishReading_Telemetry_MapsToSemanticTelemetryAspectTopic()
    {
        const int port = 18842;
        var options = new UnsOptions { Site = "s1", Area = "a1", Line = "l1", Cell = "c1", BrokerPort = port };

        await using var broker = new UnsBroker(port);
        await broker.StartAsync();

        var received = new ConcurrentDictionary<string, MqttApplicationMessage>();
        var factory = new MqttClientFactory();
        using var subscriber = factory.CreateMqttClient();
        subscriber.ApplicationMessageReceivedAsync += args =>
        {
            received[args.ApplicationMessage.Topic] = args.ApplicationMessage;
            return Task.CompletedTask;
        };
        await subscriber.ConnectAsync(new MqttClientOptionsBuilder().WithTcpServer("127.0.0.1", port).Build());
        await subscriber.SubscribeAsync(new MqttClientSubscribeOptionsBuilder().WithTopicFilter("syn/#").Build());

        await using var publisher = new UnsPublisher(options);

        var reading = new DeviceReading
        {
            MachineCode = "IOT-1",
            Kind = ReadingKind.Telemetry,
            SerialNumber = "SN-IOT-1",
            Timestamp = DateTimeOffset.UtcNow,
            Telemetry = new() { new TelemetrySample("temperature", 31.4, "C") },
        };
        var envelope = Normalizer.Normalize(reading, MappingProfile.ForClass(DeviceClass.Iot));
        publisher.PublishReading(reading, envelope);

        var expectedTopic = UnsTopicBuilder.BuildSemanticTopic(options, "IOT-1", ReadingKind.Telemetry);

        await WaitUntilAsync(() => received.ContainsKey(expectedTopic), "the telemetry-aspect semantic topic to receive a message");
        Assert.EndsWith("/telemetry", expectedTopic);
    }
}
