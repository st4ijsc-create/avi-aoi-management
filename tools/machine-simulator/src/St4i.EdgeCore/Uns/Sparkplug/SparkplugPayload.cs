using Google.Protobuf;

namespace St4i.EdgeCore.Uns.Sparkplug;

/// <summary>
/// The Sparkplug B metric datatypes this hand-rolled codec covers (brief: "cover the datatypes you
/// actually emit — Int/Long/Float/Double/Boolean/String"). Numeric values match the public Sparkplug B
/// <c>DataType</c> enum (Eclipse Tahu <c>sparkplug_b.proto</c>) for the subset in use here, so a metric's
/// declared <see cref="SparkplugMetric.DataType"/> (wire field 4) is meaningful to a real Sparkplug-aware
/// reader even though the surrounding <see cref="SparkplugPayload"/>/<see cref="SparkplugMetric"/> framing
/// below is this task's own minimal encoding (see <see cref="SparkplugPayload"/>'s doc comment for exactly
/// where it does/doesn't match the public .proto).
/// </summary>
public enum SparkplugDataType : uint
{
    Int32 = 3,
    Int64 = 4,
    Float = 9,
    Double = 10,
    Boolean = 11,
    String = 12,
}

/// <summary>One Sparkplug B metric: a name/alias pair (see <see cref="SparkplugAliasTable"/>), its own
/// timestamp, declared <see cref="SparkplugDataType"/>, and the value itself — boxed as whichever CLR type
/// <see cref="DataType"/> implies (<see cref="int"/>, <see cref="long"/>, <see cref="float"/>,
/// <see cref="double"/>, <see cref="bool"/>, or <see cref="string"/>).</summary>
public sealed record SparkplugMetric(string Name, ulong Alias, ulong Timestamp, SparkplugDataType DataType, object Value);

/// <summary>One Sparkplug B <c>Payload</c> message: a timestamp, the ordered list of metrics it carries,
/// and this edge node's current <see cref="SparkplugSeqTracker"/> value.</summary>
public sealed record SparkplugPayloadMessage(ulong Timestamp, ulong Seq, IReadOnlyList<SparkplugMetric> Metrics);

/// <summary>
/// G2-2 — a hand-rolled, minimal Sparkplug B <c>Payload</c>/<c>Metric</c> protobuf encoder/decoder, built
/// directly on <see cref="Google.Protobuf.CodedOutputStream"/>/<see cref="Google.Protobuf.CodedInputStream"/>'s
/// low-level tag/value primitives — deliberately NOT a protoc-generated <c>IMessage</c> (the task brief's
/// "ONE new NuGet: Google.Protobuf, runtime only — NO protoc/Grpc.Tools" constraint), which is why every
/// field below is written/read by raw field number rather than through generated message classes.
///
/// Field numbers — BOTH <c>Metric</c> (name=1, alias=2, timestamp=3, datatype=4, plus the value oneof
/// fields this codec actually emits: int_value=10, long_value=11, float_value=12, double_value=13,
/// boolean_value=14, string_value=15) AND <c>Payload</c> (timestamp=1, metrics=2, <b>seq=3</b>) match the
/// canonical Eclipse Tahu <c>sparkplug_b.proto</c> exactly. G2-2 review fix round 1 (Important):
/// <c>Payload.seq</c> was originally written at field 5 (the task brief's own error — it described field
/// 5 as seq, but the real proto defines field 5 as <c>body</c> and field 3 as <c>seq</c>); a real
/// Sparkplug host (Ignition/HiveMQ/a future SYNAPSE Site) reading a wire-type-mismatched or absent seq
/// at field 3 would never see dropped/out-of-order detection, defeating the whole point of the field.
/// Fixed to field 3, per spec; <c>Payload</c> field 4 (<c>uuid</c>) and field 5 (<c>body</c>) are left
/// unwritten/unused — this codec doesn't need them for G2-2's scope.
/// </summary>
public static class SparkplugPayload
{
    private const int PayloadFieldTimestamp = 1;
    private const int PayloadFieldMetrics = 2;
    private const int PayloadFieldSeq = 3;

    private const int MetricFieldName = 1;
    private const int MetricFieldAlias = 2;
    private const int MetricFieldTimestamp = 3;
    private const int MetricFieldDataType = 4;
    private const int MetricFieldIntValue = 10;
    private const int MetricFieldLongValue = 11;
    private const int MetricFieldFloatValue = 12;
    private const int MetricFieldDoubleValue = 13;
    private const int MetricFieldBooleanValue = 14;
    private const int MetricFieldStringValue = 15;

    /// <summary>Encodes a full <see cref="SparkplugPayloadMessage"/> (timestamp + repeated metrics + seq)
    /// to its wire bytes.</summary>
    public static byte[] Encode(SparkplugPayloadMessage payload)
    {
        ArgumentNullException.ThrowIfNull(payload);

        using var stream = new MemoryStream();
        var output = new CodedOutputStream(stream);

        output.WriteTag(PayloadFieldTimestamp, WireFormat.WireType.Varint);
        output.WriteUInt64(payload.Timestamp);

        foreach (var metric in payload.Metrics)
        {
            var metricBytes = EncodeMetric(metric);
            output.WriteTag(PayloadFieldMetrics, WireFormat.WireType.LengthDelimited);
            output.WriteBytes(ByteString.CopyFrom(metricBytes));
        }

        output.WriteTag(PayloadFieldSeq, WireFormat.WireType.Varint);
        output.WriteUInt64(payload.Seq);

        output.Flush();
        return stream.ToArray();
    }

    /// <summary>Decodes wire bytes produced by <see cref="Encode"/> back into a <see cref="SparkplugPayloadMessage"/>.
    /// Unknown fields (a future encoder version's additions) are skipped rather than throwing, matching
    /// standard protobuf forward-compatibility.</summary>
    public static SparkplugPayloadMessage Decode(byte[] data)
    {
        ArgumentNullException.ThrowIfNull(data);

        var input = new CodedInputStream(data);
        ulong timestamp = 0;
        ulong seq = 0;
        var metrics = new List<SparkplugMetric>();

        uint tag;
        while ((tag = input.ReadTag()) != 0)
        {
            switch (WireFormat.GetTagFieldNumber(tag))
            {
                case PayloadFieldTimestamp:
                    timestamp = input.ReadUInt64();
                    break;
                case PayloadFieldMetrics:
                    metrics.Add(DecodeMetric(input.ReadBytes().ToByteArray()));
                    break;
                case PayloadFieldSeq:
                    seq = input.ReadUInt64();
                    break;
                default:
                    input.SkipLastField();
                    break;
            }
        }

        return new SparkplugPayloadMessage(timestamp, seq, metrics);
    }

    private static byte[] EncodeMetric(SparkplugMetric metric)
    {
        using var stream = new MemoryStream();
        var output = new CodedOutputStream(stream);

        output.WriteTag(MetricFieldName, WireFormat.WireType.LengthDelimited);
        output.WriteString(metric.Name);

        output.WriteTag(MetricFieldAlias, WireFormat.WireType.Varint);
        output.WriteUInt64(metric.Alias);

        output.WriteTag(MetricFieldTimestamp, WireFormat.WireType.Varint);
        output.WriteUInt64(metric.Timestamp);

        output.WriteTag(MetricFieldDataType, WireFormat.WireType.Varint);
        output.WriteUInt32((uint)metric.DataType);

        switch (metric.DataType)
        {
            case SparkplugDataType.Int32:
                output.WriteTag(MetricFieldIntValue, WireFormat.WireType.Varint);
                output.WriteInt32(Convert.ToInt32(metric.Value));
                break;
            case SparkplugDataType.Int64:
                output.WriteTag(MetricFieldLongValue, WireFormat.WireType.Varint);
                output.WriteInt64(Convert.ToInt64(metric.Value));
                break;
            case SparkplugDataType.Float:
                output.WriteTag(MetricFieldFloatValue, WireFormat.WireType.Fixed32);
                output.WriteFloat(Convert.ToSingle(metric.Value));
                break;
            case SparkplugDataType.Double:
                output.WriteTag(MetricFieldDoubleValue, WireFormat.WireType.Fixed64);
                output.WriteDouble(Convert.ToDouble(metric.Value));
                break;
            case SparkplugDataType.Boolean:
                output.WriteTag(MetricFieldBooleanValue, WireFormat.WireType.Varint);
                output.WriteBool(Convert.ToBoolean(metric.Value));
                break;
            case SparkplugDataType.String:
                output.WriteTag(MetricFieldStringValue, WireFormat.WireType.LengthDelimited);
                output.WriteString(metric.Value?.ToString() ?? string.Empty);
                break;
            default:
                throw new NotSupportedException($"SparkplugPayload does not encode datatype {metric.DataType}.");
        }

        output.Flush();
        return stream.ToArray();
    }

    private static SparkplugMetric DecodeMetric(byte[] data)
    {
        var input = new CodedInputStream(data);
        var name = string.Empty;
        ulong alias = 0;
        ulong timestamp = 0;
        var dataType = default(SparkplugDataType);
        object? value = null;

        uint tag;
        while ((tag = input.ReadTag()) != 0)
        {
            switch (WireFormat.GetTagFieldNumber(tag))
            {
                case MetricFieldName:
                    name = input.ReadString();
                    break;
                case MetricFieldAlias:
                    alias = input.ReadUInt64();
                    break;
                case MetricFieldTimestamp:
                    timestamp = input.ReadUInt64();
                    break;
                case MetricFieldDataType:
                    dataType = (SparkplugDataType)input.ReadUInt32();
                    break;
                case MetricFieldIntValue:
                    value = input.ReadInt32();
                    break;
                case MetricFieldLongValue:
                    value = input.ReadInt64();
                    break;
                case MetricFieldFloatValue:
                    value = input.ReadFloat();
                    break;
                case MetricFieldDoubleValue:
                    value = input.ReadDouble();
                    break;
                case MetricFieldBooleanValue:
                    value = input.ReadBool();
                    break;
                case MetricFieldStringValue:
                    value = input.ReadString();
                    break;
                default:
                    input.SkipLastField();
                    break;
            }
        }

        return new SparkplugMetric(name, alias, timestamp, dataType, value ?? string.Empty);
    }
}
