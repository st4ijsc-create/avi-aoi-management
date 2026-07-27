using St4i.EdgeCore.Uns.Sparkplug;
using Xunit;

namespace St4i.EdgeCore.Tests.Uns.Sparkplug;

/// <summary>G2-2 — <see cref="SparkplugPayload"/>: the hand-rolled encoder/decoder round-trips a
/// <see cref="SparkplugPayloadMessage"/> through <see cref="SparkplugPayload.Encode"/> then
/// <see cref="SparkplugPayload.Decode"/>, covering every datatype the codec supports (Int/Long/Float/
/// Double/Boolean/String) plus the payload-level timestamp/seq fields and multi-metric ordering.</summary>
public sealed class SparkplugPayloadTests
{
    [Fact]
    public void Encode_ThenDecode_RoundTripsTimestampAndSeq()
    {
        var payload = new SparkplugPayloadMessage(1_700_000_000_000UL, 7UL, Array.Empty<SparkplugMetric>());

        var decoded = SparkplugPayload.Decode(SparkplugPayload.Encode(payload));

        Assert.Equal(payload.Timestamp, decoded.Timestamp);
        Assert.Equal(payload.Seq, decoded.Seq);
        Assert.Empty(decoded.Metrics);
    }

    [Theory]
    [InlineData(SparkplugDataType.Int32)]
    [InlineData(SparkplugDataType.Int64)]
    [InlineData(SparkplugDataType.Float)]
    [InlineData(SparkplugDataType.Double)]
    [InlineData(SparkplugDataType.Boolean)]
    [InlineData(SparkplugDataType.String)]
    public void Encode_ThenDecode_RoundTripsEveryCoveredDatatype(SparkplugDataType dataType)
    {
        object value = dataType switch
        {
            SparkplugDataType.Int32 => -42,
            SparkplugDataType.Int64 => 9_000_000_000L,
            SparkplugDataType.Float => 3.5f,
            SparkplugDataType.Double => 31.4159,
            SparkplugDataType.Boolean => true,
            SparkplugDataType.String => "RC-1",
            _ => throw new ArgumentOutOfRangeException(nameof(dataType)),
        };

        var metric = new SparkplugMetric("m1", Alias: 1, Timestamp: 123456, dataType, value);
        var payload = new SparkplugPayloadMessage(1, 0, new[] { metric });

        var decoded = SparkplugPayload.Decode(SparkplugPayload.Encode(payload));

        var decodedMetric = Assert.Single(decoded.Metrics);
        Assert.Equal("m1", decodedMetric.Name);
        Assert.Equal(1UL, decodedMetric.Alias);
        Assert.Equal(123456UL, decodedMetric.Timestamp);
        Assert.Equal(dataType, decodedMetric.DataType);
        Assert.Equal(value, decodedMetric.Value);
    }

    [Fact]
    public void Encode_ThenDecode_RoundTripsMultipleMetricsInOrder()
    {
        var metrics = new[]
        {
            new SparkplugMetric("temperature", 1, 100, SparkplugDataType.Double, 31.4),
            new SparkplugMetric("running", 2, 200, SparkplugDataType.Boolean, true),
            new SparkplugMetric("recipe", 3, 300, SparkplugDataType.String, "RC-1"),
        };
        var payload = new SparkplugPayloadMessage(999, 5, metrics);

        var decoded = SparkplugPayload.Decode(SparkplugPayload.Encode(payload));

        Assert.Equal(3, decoded.Metrics.Count);
        Assert.Equal("temperature", decoded.Metrics[0].Name);
        Assert.Equal(31.4, decoded.Metrics[0].Value);
        Assert.Equal("running", decoded.Metrics[1].Name);
        Assert.Equal(true, decoded.Metrics[1].Value);
        Assert.Equal("recipe", decoded.Metrics[2].Name);
        Assert.Equal("RC-1", decoded.Metrics[2].Value);
    }

    [Fact]
    public void Decode_UnknownField_IsSkippedRatherThanThrowing()
    {
        // A genuinely-unknown wire field can't be produced through the public Encode API (by design —
        // every field this codec writes is one it also reads), so this proves SkipLastField's forward-
        // compatibility path directly: hand-append an extra unrecognized field (a high field number, so it
        // can never collide with one of this codec's own) after a normal encode, and confirm Decode still
        // recovers everything it DOES understand instead of throwing.
        var payload = new SparkplugPayloadMessage(1, 2, Array.Empty<SparkplugMetric>());
        var bytes = SparkplugPayload.Encode(payload);

        using var stream = new MemoryStream();
        stream.Write(bytes, 0, bytes.Length);
        var extra = new Google.Protobuf.CodedOutputStream(stream);
        extra.WriteTag(99, Google.Protobuf.WireFormat.WireType.Varint);
        extra.WriteUInt64(12345);
        extra.Flush();

        var decoded = SparkplugPayload.Decode(stream.ToArray());

        Assert.Equal(1UL, decoded.Timestamp);
        Assert.Equal(2UL, decoded.Seq);
    }
}
