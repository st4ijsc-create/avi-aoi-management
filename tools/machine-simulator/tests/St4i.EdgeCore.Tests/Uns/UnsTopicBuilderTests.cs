using St4i.EdgeCore.Models;
using St4i.Connector.Abstractions.Models;
using St4i.EdgeCore.Uns;
using Xunit;

namespace St4i.EdgeCore.Tests.Uns;

/// <summary>
/// G2-2 — <see cref="UnsTopicBuilder"/>: pure topic-string arithmetic, no broker/network involved. Locks
/// down the exact two topic-family templates from the task brief:
/// <c>spBv1.0/{site}.{area}.{line}/{msgType}/{cell}[/{equipment}]</c> and
/// <c>syn/{site}/{area}/{line}/{cell}/{equipment}/{aspect}</c>.
/// </summary>
public sealed class UnsTopicBuilderTests
{
    private static readonly UnsOptions Options = new()
    {
        Site = "s1",
        Area = "a1",
        Line = "l1",
        Cell = "c1",
        BrokerPort = 18830,
    };

    private static readonly MachineDescriptor Device = new(
        "EQ-1", "SN-EQ1", DeviceClass.Automation, "SCREWDRIVE", "screw_tightening",
        DriverKind.Simulated, "RC-1", null, 1.0);

    [Fact]
    public void BuildSparkplugDataTopic_ProducesTheExactDdataTopicString()
    {
        var topic = UnsTopicBuilder.BuildSparkplugDataTopic(Options, Device);

        Assert.Equal("spBv1.0/s1.a1.l1/DDATA/c1/EQ-1", topic);
    }

    [Fact]
    public void BuildSemanticTopic_ProcessResult_ProducesTheExactResultAspectTopicString()
    {
        var topic = UnsTopicBuilder.BuildSemanticTopic(Options, Device, ReadingKind.ProcessResult);

        Assert.Equal("syn/s1/a1/l1/c1/EQ-1/result", topic);
    }

    [Fact]
    public void BuildLineStateTopic_ProducesTheExactLineStateTopicString()
    {
        var topic = UnsTopicBuilder.BuildLineStateTopic(Options);

        Assert.Equal("syn/s1/a1/l1/c1/_line/state", topic);
    }

    [Theory]
    [InlineData(ReadingKind.ProcessResult, "result")]
    [InlineData(ReadingKind.Telemetry, "telemetry")]
    [InlineData(ReadingKind.Inspection, "inspection")]
    public void AspectFor_MapsEachReadingKindToItsDocumentedAspectSegment(ReadingKind kind, string expectedAspect)
    {
        Assert.Equal(expectedAspect, UnsTopicBuilder.AspectFor(kind));
    }

    [Theory]
    [InlineData(SparkplugMsgType.NBIRTH)]
    [InlineData(SparkplugMsgType.NDEATH)]
    [InlineData(SparkplugMsgType.NDATA)]
    public void BuildSparkplugTopic_NodeLevelMsgTypes_OmitTheDeviceSegment(SparkplugMsgType msgType)
    {
        var topic = UnsTopicBuilder.BuildSparkplugTopic(Options, msgType);

        Assert.Equal($"spBv1.0/s1.a1.l1/{msgType}/c1", topic);
    }

    [Theory]
    [InlineData(SparkplugMsgType.DBIRTH)]
    [InlineData(SparkplugMsgType.DDEATH)]
    [InlineData(SparkplugMsgType.DDATA)]
    public void BuildSparkplugTopic_DeviceLevelMsgTypes_AppendTheEquipmentSegment(SparkplugMsgType msgType)
    {
        var topic = UnsTopicBuilder.BuildSparkplugTopic(Options, msgType, "EQ-9");

        Assert.Equal($"spBv1.0/s1.a1.l1/{msgType}/c1/EQ-9", topic);
    }

    [Fact]
    public void BuildSparkplugTopic_DeviceLevelWithoutEquipmentCode_Throws()
    {
        Assert.Throws<ArgumentException>(() => UnsTopicBuilder.BuildSparkplugTopic(Options, SparkplugMsgType.DDATA));
    }

    [Fact]
    public void GroupId_JoinsSiteAreaLineWithDots()
    {
        Assert.Equal("s1.a1.l1", UnsTopicBuilder.GroupId(Options));
    }

    [Fact]
    public void StringEquipmentCodeOverloads_ProduceTheSameTopicsAsTheMachineDescriptorOverloads()
    {
        Assert.Equal(
            UnsTopicBuilder.BuildSparkplugDataTopic(Options, Device),
            UnsTopicBuilder.BuildSparkplugDataTopic(Options, Device.Code));

        Assert.Equal(
            UnsTopicBuilder.BuildSemanticTopic(Options, Device, ReadingKind.Telemetry),
            UnsTopicBuilder.BuildSemanticTopic(Options, Device.Code, ReadingKind.Telemetry));
    }
}
