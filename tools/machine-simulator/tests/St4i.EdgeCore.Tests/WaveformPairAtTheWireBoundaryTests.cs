using System.Text;
using System.Text.Json;
using MQTTnet;
using St4i.Connector.Abstractions.Models;
using St4i.EdgeCore.Drivers;
using St4i.EdgeCore.Drivers.Simulators;
using St4i.EdgeCore.Mapping;
using St4i.EdgeCore.Models;
using St4i.EdgeCore.Tests.Fakes;
using St4i.EdgeCore.Tests.Site;
using St4i.EdgeCore.Transport;
using St4i.EdgeCore.Uns;
using Xunit;

namespace St4i.EdgeCore.Tests;

/// <summary>
/// 🔴 Task AK-1 (<c>.superpowers/sdd/item14-option3/task-1-brief.md</c>) — <b>the witness for the owner's
/// decision of 2026-08-19 on <c>docs/owner-decisions.md</c> item 14, option 3.</b>
///
/// <para><b>WHY THIS FILE HAD TO BE WRITTEN AT ALL, and it is the first work item of that decision rather
/// than the last.</b> The measurement that preceded the ruling found that placing the <c>[t, v]</c>
/// transform at the <c>Normalizer</c> boundary reddens NOTHING in the suite: the only two test files that
/// touch a waveform both sit UPSTREAM of the boundary, on
/// <see cref="St4i.Connector.Abstractions.Models.DeviceReading"/>, and no test anywhere asserted the shape
/// of <c>payload["waveforms"][*]["samples"]</c>. A green suite there was not evidence the change is safe;
/// it was evidence there was no instrument. The other two ways of settling item 14 each had a witness that
/// goes red on its own. This one has to be given one, or the transform can be removed later by anybody, in
/// silence, and every existing test will still pass.</para>
///
/// <para><b>WHAT EACH FACT BELOW IS FOR, so the file is not read as one assertion written five times.</b>
/// <list type="bullet">
///   <item><description>The pairs actually reach the OUTBOUND HTTP BODY, not merely the payload dictionary
///   — asserted through a real <see cref="LiveTransport"/> and the SDK's own serializer, because the
///   in-between reader (<c>LiveTransport.ReadSampleSeries</c>) accepts a row if and only if it is a
///   <see langword="double"/><c>[]</c> and drops anything else with no exception and no log. A transform
///   that returned <c>List&lt;double&gt;</c> or a tuple would leave a dictionary that looks right and a
///   wire body carrying <c>samples: []</c>.</description></item>
///   <item><description>The <c>t</c> published is the instant <c>RateHz</c> IMPLIES, pinned to the number
///   rather than to a description, so that a later round which "corrects" it to where <c>WelderSim</c>
///   actually drew its curve has to redden here and say so — that correction would be a decision about what
///   <c>rateHz</c> MEANS, which no ruling has taken.</description></item>
///   <item><description>Series that are ALREADY paired cross the boundary untouched, including the
///   awkward case that makes the row-length condition load-bearing: spec 57 §8.1's own canonical example
///   carries <c>rateHz: 500</c> BESIDE pair rows, so a transform keyed on <c>RateHz</c> alone would destroy
///   real data.</description></item>
///   <item><description>The retained MQTT semantic mirror carries the same pairs, because it is a
///   serialization of the same envelope object — <b>that surface is a PUBLISHED one and it changes with
///   this decision.</b> Who subscribes to it is NOT MEASURED and is not measurable from this repository;
///   this fact proves what leaves, never who reads it.</description></item>
/// </list></para>
///
/// <para><b>🔴 WHAT A GREEN RUN HERE DOES NOT WITNESS.</b> It says nothing about whether the platform's
/// ingest route accepts the body — nothing here POSTs to a running gate, and the only dynamic evidence of
/// that remains the A/B control pair recorded in item 14, measured elsewhere and handed over. It says
/// nothing about the SDK's store-and-forward queue, which writes whole payloads to disk as JSONL and
/// replays them later, so a queue written before this change replays the OLD shape afterwards through a
/// window nobody has measured. And it says nothing about <c>WelderSim</c>'s 4.17% skew being right or
/// wrong; it pins only that this boundary did not silently pick a side on it.</para>
/// </summary>
public sealed class WaveformPairAtTheWireBoundaryTests
{
    private static readonly MachineDescriptor Descriptor =
        new("MC-01", "SN", DeviceClass.Automation, "TYPE", "step", DriverKinds.Simulated, "RC1", null, 1.0);

    private static MappingProfile Profile => MappingProfile.ForClass(DeviceClass.Automation);

    /// <summary>The waveform entries of a normalized process-result payload, as the dictionaries the
    /// envelope actually carries. Deliberately not helper-wrapped past this point: each fact reads the
    /// concrete <c>["samples"]</c> object itself, because the CLR type of that object is half of what is
    /// being asserted.</summary>
    private static IReadOnlyList<Dictionary<string, object?>> WaveformEntries(CanonicalEnvelope env)
    {
        var raw = Assert.IsType<List<object>>(env.Payload["waveforms"]);
        return raw.Select(e => Assert.IsType<Dictionary<string, object?>>(e)).ToList();
    }

    private static IReadOnlyList<double[]> WireRows(CanonicalEnvelope env, int waveformIndex = 0) =>
        Assert.IsAssignableFrom<IReadOnlyList<double[]>>(WaveformEntries(env)[waveformIndex]["samples"]);

    private static DeviceReading ReadingWithWaveform(WaveformSeries series)
    {
        var r = new DeviceReading
        {
            MachineCode = "MC-01",
            Kind = ReadingKind.ProcessResult,
            SerialNumber = "SN-1",
            StepType = "step",
            Verdict = Verdict.Pass,
            CycleCounter = 1,
            Timestamp = DateTimeOffset.UnixEpoch,
        };
        r.Waveforms.Add(series);
        return r;
    }

    /// <summary>Sends a normalized envelope through a real <see cref="LiveTransport"/> against a capturing
    /// handler and returns the request body that would have gone onto the wire.</summary>
    private static async Task<string> WireBodyOf(CanonicalEnvelope env)
    {
        var handler = new CapturingHandler
        {
            Responder = (_, _) => (System.Net.HttpStatusCode.Created,
                "{\"ok\":true,\"data\":{\"success\":true,\"processResultId\":1}}"),
        };
        using var live = LiveTransport.ForMachine("http://x", "mk_test", "MC-01", null, true, handler);
        var ack = await live.SendAsync(env, default);
        Assert.True(ack.Success);
        return handler.LastBody!;
    }

    private static JsonElement FirstWireWaveform(string body)
    {
        using var doc = JsonDocument.Parse(body);
        return doc.RootElement.GetProperty("waveforms")[0].Clone();
    }

    // ══ 1. THE DECISION ITSELF, MEASURED ON THE OUTBOUND BODY ════════════════════════════════════════

    /// <summary>🔴 The load-bearing fact. <c>WelderSim</c> emits one-element rows and is NOT changed by
    /// item 14; the pair is built at the boundary and it survives all the way onto the HTTP body. Remove
    /// the transform and every row on the wire is length 1 again; return a row type other than
    /// <see langword="double"/><c>[]</c> and <c>samples</c> arrives EMPTY. Both are red here.</summary>
    [Fact]
    public async Task WelderSimsOneElementRows_LeaveTheHttpBoundaryAsPairs_WhileTheProducerItselfIsUntouched()
    {
        var reading = new WelderSim(Descriptor, 11).NextCycle(1);
        var produced = Assert.Single(reading.Waveforms);

        // The producer is upstream of the decision and stays where it was: still one element per row.
        Assert.NotNull(produced.RateHz);
        Assert.All(produced.Samples, row => Assert.Single(row));

        var env = Normalizer.Normalize(reading, Profile);
        var wire = FirstWireWaveform(await WireBodyOf(env));

        Assert.Equal("weld_current", wire.GetProperty("name").GetString());
        Assert.Equal("A", wire.GetProperty("unit").GetString());

        // rateHz travels UNCHANGED in meaning and in value — this decision converts a row shape and
        // redefines no field. A round that moves this number is changing the payload, not the shape.
        Assert.Equal(produced.RateHz!.Value, wire.GetProperty("rateHz").GetDouble(), 12);

        var rows = wire.GetProperty("samples");
        Assert.Equal(produced.Samples.Count, rows.GetArrayLength());
        Assert.NotEqual(0, rows.GetArrayLength()); // the ReadSampleSeries silent-drop shape, stated as a check

        for (var i = 0; i < produced.Samples.Count; i++)
        {
            var row = rows[i];
            Assert.Equal(2, row.GetArrayLength());
            Assert.Equal(i / produced.RateHz!.Value, row[0].GetDouble(), 12);
            Assert.Equal(produced.Samples[i][0], row[1].GetDouble(), 12); // the value itself is untouched
        }
    }

    /// <summary>🔴 <b>WHICH <c>t</c> — pinned to the number, because two defensible numbers exist and the
    /// difference is measurable.</b> The axis published is the one <c>RateHz</c> implies,
    /// <c>t(i) = i / rateHz</c>, so the series spans <c>(N-1)/rateHz</c> and falls exactly ONE sampling
    /// period short of the weld duration the same reading reports. <c>WelderSim</c> draws its curve on the
    /// OTHER axis — endpoint-inclusive over the duration — and the two differ by <c>1/N</c>, 4.17% at its
    /// 24 points. This fact asserts BOTH: that the implied axis is what left, and that the producer's axis
    /// is what did NOT. Deciding to publish the producer's axis instead would mean deciding what
    /// <c>rateHz</c> means, which is a payload change item 14 does not cover.</summary>
    [Fact]
    public async Task TheTimeAxisPublished_IsTheOneRateHzIMPLIES_AndTheGapToWhereWelderSimDrewItsCurveIsPinnedNotClosed()
    {
        var reading = new WelderSim(Descriptor, 11).NextCycle(1);
        var produced = Assert.Single(reading.Waveforms);
        var rate = produced.RateHz!.Value;
        var n = produced.Samples.Count;
        var weldSeconds = reading.Metrics.Single(m => m.Name == "weld_time").Value / 1000.0;

        var rows = FirstWireWaveform(await WireBodyOf(Normalizer.Normalize(reading, Profile)))
            .GetProperty("samples");

        var lastT = rows[n - 1][0].GetDouble();

        // What DID leave: the implied axis.
        Assert.Equal((n - 1) / rate, lastT, 12);

        // What did NOT leave: the axis WelderSim drew on, which ends at the full weld duration.
        Assert.NotEqual(weldSeconds, lastT, 12);
        Assert.Equal(weldSeconds - (1.0 / rate), lastT, 12); // short by exactly one sampling period
        Assert.Equal(1.0 / n, (weldSeconds - lastT) / weldSeconds, 12); // = 4.1666…% at N = 24

        // And the first sample is the one instant on which the two axes agree.
        Assert.Equal(0.0, rows[0][0].GetDouble());
    }

    // ══ 2. WHAT MUST NOT BE TOUCHED ══════════════════════════════════════════════════════════════════

    /// <summary>The other built-in producer already emits <c>[angle, torque]</c> rows with no
    /// <c>RateHz</c>, which is a <c>[t, v]</c> pair under the published spec's own reading of <c>t</c> as
    /// "the abscissa — time in seconds OR angle in degrees". It must cross the boundary with nothing done
    /// to it, and element 0 must still be the angle rather than a time somebody manufactured.</summary>
    [Fact]
    public async Task ScrewdriveSimsAlreadyPairedRows_CrossTheBoundaryUntouched_AndElementZeroIsStillTheAngle()
    {
        var reading = new ScrewdriveSim(Descriptor, 11).NextCycle(1);
        var produced = Assert.Single(reading.Waveforms);
        Assert.Null(produced.RateHz);

        var env = Normalizer.Normalize(reading, Profile);

        // Reference identity, not value equality: the boundary passes the very same rows through.
        Assert.Same(produced.Samples, WaveformEntries(env)[0]["samples"]);

        var wire = FirstWireWaveform(await WireBodyOf(env));

        // No rate was claimed upstream and none is manufactured here. The SDK serializes with
        // JsonIgnoreCondition.WhenWritingNull, so "absent" is how a null rateHz appears on this wire.
        Assert.False(wire.TryGetProperty("rateHz", out _));

        var rows = wire.GetProperty("samples");
        var finalAngle = reading.Metrics.Single(m => m.Name == "angle").Value;
        Assert.Equal(produced.Samples.Count, rows.GetArrayLength());
        for (var i = 0; i < produced.Samples.Count; i++)
        {
            Assert.Equal(2, rows[i].GetArrayLength());
            Assert.Equal(produced.Samples[i][0], rows[i][0].GetDouble(), 12);
            Assert.Equal(produced.Samples[i][1], rows[i][1].GetDouble(), 12);
        }

        Assert.Equal(finalAngle, rows[produced.Samples.Count - 1][0].GetDouble(), 9);
    }

    /// <summary>🔴 <b>The case that makes the row-length condition load-bearing rather than defensive.</b>
    /// Spec 57 §8.1's own canonical example — the one all three reference SDK samples reproduce — carries
    /// <c>rateHz: 500</c> BESIDE two-element rows whose element 0 is an ANGLE. A boundary that paired on
    /// "RateHz is set" would rewrite that abscissa into an index-derived time and destroy the data. The
    /// numbers below are that example's, used as INPUT to prove a pass-through, never as an assertion about
    /// which convention is canonical.</summary>
    [Fact]
    public void ARatedSeriesThatALREADYCarriesPairs_IsNotPairedASecondTime()
    {
        var alreadyPaired = new List<double[]>
        {
            new[] { 0.0, 0.02 }, new[] { 90.0, 0.15 }, new[] { 412.0, 0.82 },
        };
        var series = new WaveformSeries("torque_vs_angle", "Nm", 500.0, alreadyPaired);

        var env = Normalizer.Normalize(ReadingWithWaveform(series), Profile);

        Assert.Same(alreadyPaired, WaveformEntries(env)[0]["samples"]);
        Assert.Equal(500.0, Assert.IsType<double>(WaveformEntries(env)[0]["rateHz"]));
    }

    // ══ 3. THE BANK THAT PROVES THE INSTRUMENT CAN GO RED — §8.1(h6) ═════════════════════════════════

    /// <summary>Every way a row can reach this boundary, driven one at a time, so the transform's domain is
    /// asserted rather than described. Pass-through cases use reference identity: value equality would also
    /// pass if the boundary rebuilt an identical list, and rebuilding is not what is being claimed.</summary>
    [Fact]
    public void TheBoundaryPairsExactlyTheRowsItCan_AndNeverInventsATimeAxisItCannotDerive()
    {
        // Converted: a finite positive rate beside one-element rows.
        var scalars = new List<double[]> { new[] { 10.0 }, new[] { 11.0 }, new[] { 12.0 } };
        var converted = WireRows(Normalizer.Normalize(
            ReadingWithWaveform(new WaveformSeries("rated", "A", 200.0, scalars)), Profile));
        Assert.Equal(3, converted.Count);
        Assert.Equal(new[] { 0.0, 10.0 }, converted[0]);
        Assert.Equal(new[] { 1 / 200.0, 11.0 }, converted[1]);
        Assert.Equal(new[] { 2 / 200.0, 12.0 }, converted[2]);

        // NOT converted, one reason each — and there is no time base in any of them.
        foreach (var (label, rate) in new (string, double?)[]
                 {
                     ("no rate at all", null),
                     ("zero rate", 0.0),
                     ("negative rate", -200.0),
                     ("not-a-number rate", double.NaN),
                     ("infinite rate", double.PositiveInfinity),
                 })
        {
            var rows = new List<double[]> { new[] { 10.0 }, new[] { 11.0 } };
            var env = Normalizer.Normalize(
                ReadingWithWaveform(new WaveformSeries(label, "A", rate, rows)), Profile);
            Assert.Same(rows, WaveformEntries(env)[0]["samples"]);
        }

        // A rate beside rows that are not scalars: nothing to pair, nothing rebuilt.
        var triples = new List<double[]> { new[] { 0.0, 1.0, 2.0 } };
        var tripleEnv = Normalizer.Normalize(
            ReadingWithWaveform(new WaveformSeries("triples", "A", 200.0, triples)), Profile);
        Assert.Same(triples, WaveformEntries(tripleEnv)[0]["samples"]);

        var empties = new List<double[]> { Array.Empty<double>() };
        var emptyRowEnv = Normalizer.Normalize(
            ReadingWithWaveform(new WaveformSeries("empty-rows", "A", 200.0, empties)), Profile);
        Assert.Same(empties, WaveformEntries(emptyRowEnv)[0]["samples"]);

        var none = new List<double[]>();
        var noneEnv = Normalizer.Normalize(
            ReadingWithWaveform(new WaveformSeries("no-rows", "A", 200.0, none)), Profile);
        Assert.Same(none, WaveformEntries(noneEnv)[0]["samples"]);

        // Ragged: the scalar rows pair on their OWN index, the rest are handed through as they arrived.
        var ragged = new List<double[]> { new[] { 10.0 }, new[] { 5.0, 11.0 }, new[] { 12.0 } };
        var raggedRows = WireRows(Normalizer.Normalize(
            ReadingWithWaveform(new WaveformSeries("ragged", "A", 200.0, ragged)), Profile));
        Assert.Equal(new[] { 0.0, 10.0 }, raggedRows[0]);
        Assert.Same(ragged[1], raggedRows[1]);
        Assert.Equal(new[] { 2 / 200.0, 12.0 }, raggedRows[2]);
    }

    /// <summary>🔴 The type gate stated where it bites. <c>LiveTransport.ReadSampleSeries</c> keeps a row
    /// if and only if <c>point is double[]</c> and discards everything else with no exception and no log,
    /// so a boundary that emitted <c>List&lt;double&gt;</c>, <c>object[]</c> or a tuple would produce a
    /// correct-looking payload and an outbound body carrying <c>samples: []</c>. Asserted on the payload
    /// (before serialization) as well as on the body (after it), because those two failures look
    /// identical from one side only.</summary>
    [Fact]
    public async Task EveryRowLeavingTheBoundaryIsADoubleArray_TheOnlyRowTypeTheOutboundReaderAccepts()
    {
        var reading = new WelderSim(Descriptor, 11).NextCycle(1);
        reading.Waveforms.Add(new ScrewdriveSim(Descriptor, 11).NextCycle(1).Waveforms[0]);

        var env = Normalizer.Normalize(reading, Profile);
        var entries = WaveformEntries(env);
        Assert.Equal(2, entries.Count);

        foreach (var entry in entries)
        {
            foreach (var row in Assert.IsAssignableFrom<IReadOnlyList<double[]>>(entry["samples"]))
            {
                Assert.IsType<double[]>(row);
            }
        }

        using var doc = JsonDocument.Parse(await WireBodyOf(env));
        var wave = doc.RootElement.GetProperty("waveforms");
        Assert.Equal(2, wave.GetArrayLength());
        Assert.Equal(reading.Waveforms[0].Samples.Count, wave[0].GetProperty("samples").GetArrayLength());
        Assert.Equal(reading.Waveforms[1].Samples.Count, wave[1].GetProperty("samples").GetArrayLength());
    }

    // ══ 4. THE SECOND PUBLISHED SURFACE ══════════════════════════════════════════════════════════════

    /// <summary>🔴 <b>The retained MQTT semantic mirror changes with this decision, and it is a PUBLISHED
    /// surface.</b> <c>EdgePipeline</c> normalizes once and hands the SAME envelope to the UNS publisher and
    /// to the transport, and the publisher serializes that envelope whole onto a retained <c>syn/…</c>
    /// topic. So the pairs appear there too, on the day the transform lands, with no separate call site to
    /// notice. 🔴 <b>WHO SUBSCRIBES TO THAT TOPIC IS NOT MEASURED and is not measurable from this
    /// repository</b> — the type's own doc comment states that subscribers are outside it altogether, which
    /// is a claim by a document and not a count of subscribers. This fact proves only what leaves.</summary>
    [Fact]
    public async Task TheRetainedSemanticMirror_CarriesTheSamePairs_BecauseItIsTheSameEnvelope()
    {
        var port = BridgeTestNet.GetFreePort();
        var options = new UnsOptions { Site = "s1", Area = "a1", Line = "l1", Cell = "c1", BrokerPort = port };

        await using var broker = new UnsBroker(port);
        await broker.StartAsync();

        var reading = new WelderSim(Descriptor, 11).NextCycle(1);
        reading.MachineCode = "WELD-01";
        var produced = Assert.Single(reading.Waveforms);
        var envelope = Normalizer.Normalize(reading, Profile);
        var semanticTopic = UnsTopicBuilder.BuildSemanticTopic(options, "WELD-01", ReadingKind.ProcessResult);

        await using (var publisher = new UnsPublisher(options))
        {
            var factory = new MqttClientFactory();

            // An EARLY subscriber exists only to establish that the publish has landed. Per MQTT-3.3.1-9 a
            // broker forwards a LIVE message with Retain=0 even when it was published retained, so this one
            // cannot prove retention and is not asked to.
            MqttApplicationMessage? live = null;
            using var earlySubscriber = factory.CreateMqttClient();
            earlySubscriber.ApplicationMessageReceivedAsync += args =>
            {
                if (args.ApplicationMessage.Topic == semanticTopic) live = args.ApplicationMessage;
                return Task.CompletedTask;
            };
            await earlySubscriber.ConnectAsync(new MqttClientOptionsBuilder().WithTcpServer("127.0.0.1", port).Build());
            await earlySubscriber.SubscribeAsync(
                new MqttClientSubscribeOptionsBuilder().WithTopicFilter(semanticTopic).Build());

            publisher.PublishReading(reading, envelope);

            await BridgeTestNet.WaitUntilAsync(
                () => live is not null,
                "the semantic mirror of a WELDER process result to reach a subscriber at all");

            // A subscriber that arrives AFTER the publish can only be served from retention, and gets
            // Retain=1 on that replay. That is the proof this is a RETAINED, standing surface rather than
            // one momentary message.
            MqttApplicationMessage? retained = null;
            using var lateSubscriber = factory.CreateMqttClient();
            lateSubscriber.ApplicationMessageReceivedAsync += args =>
            {
                if (args.ApplicationMessage.Topic == semanticTopic) retained = args.ApplicationMessage;
                return Task.CompletedTask;
            };
            await lateSubscriber.ConnectAsync(new MqttClientOptionsBuilder().WithTcpServer("127.0.0.1", port).Build());
            await lateSubscriber.SubscribeAsync(
                new MqttClientSubscribeOptionsBuilder().WithTopicFilter(semanticTopic).Build());

            await BridgeTestNet.WaitUntilAsync(
                () => retained is not null,
                "the retained semantic mirror to be replayed to a subscriber that arrived after the publish");

            Assert.True(retained!.Retain);
            var json = Encoding.UTF8.GetString(System.Buffers.BuffersExtensions.ToArray(retained.Payload));
            using var doc = JsonDocument.Parse(json);
            var rows = doc.RootElement
                .GetProperty("payload").GetProperty("waveforms")[0].GetProperty("samples");

            Assert.Equal(produced.Samples.Count, rows.GetArrayLength());
            for (var i = 0; i < produced.Samples.Count; i++)
            {
                Assert.Equal(2, rows[i].GetArrayLength());
                Assert.Equal(i / produced.RateHz!.Value, rows[i][0].GetDouble(), 12);
                Assert.Equal(produced.Samples[i][0], rows[i][1].GetDouble(), 12);
            }
        }
    }
}
