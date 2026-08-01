using St4i.EdgeCore.Models;
using St4i.Connector.Abstractions.Models;
using St4i.EngineApi.Fleet;
using Xunit;

namespace St4i.EngineApi.Tests;

/// <summary>
/// WS-C-T4 — the ack-label bug fix: <c>MachineState.BuildSummary</c>'s <c>ackLabel</c> ternary used to
/// check <c>!ack.Success</c> FIRST, so a real disk-buffered write
/// (<c>Success:false, Queued:true</c> — see <c>LiveTransport.SendAsync</c>'s <c>St4iNetworkException</c>
/// handling) was mislabeled "ERR" even though it was successfully queued for later replay, not actually
/// failed. <c>BuildSummary</c> is private, so this drives it through the SAME public seam
/// <c>MachineStateCycleOffsetTests.cs</c> already uses (<see cref="MachineState.ApplyReading"/> →
/// <see cref="MachineState.LastCycleSummary"/>) and asserts on the trailing "ack:&lt;label&gt;" segment.
/// <c>MachineViewModel.cs</c> (WPF)'s <c>BuildSummary</c> is kept byte-for-byte identical (see that
/// file's own remarks) but has no dedicated test project to exercise separately.
/// </summary>
public sealed class MachineStateAckLabelTests
{
    private static readonly MachineDescriptor Descriptor = new(
        "SCRW-01", "SN-SCRW01", DeviceClass.Automation, "SCREWDRIVE", "screw_tightening",
        DriverKinds.Simulated, "RC-SCRW-A", null, CycleSeconds: 0.6);

    private static DeviceReading Reading() => new()
    {
        MachineCode = Descriptor.Code,
        Kind = ReadingKind.ProcessResult,
        SerialNumber = "SN-1",
        Verdict = Verdict.Pass,
        CycleCounter = 1,
        Timestamp = DateTimeOffset.UtcNow,
    };

    private static string AckLabelFor(TransportAck ack)
    {
        var state = new MachineState(Descriptor);
        state.ApplyReading(Reading(), ack);

        var summary = state.LastCycleSummary;
        const string marker = "ack:";
        var idx = summary.IndexOf(marker, StringComparison.Ordinal);
        Assert.True(idx >= 0, $"LastCycleSummary had no \"{marker}\" segment: \"{summary}\"");
        return summary[(idx + marker.Length)..];
    }

    [Fact]
    public void ClientBufferedWrite_SuccessFalseQueuedTrue_IsLabeledBuffered_NotErr()
    {
        Assert.Equal("buffered", AckLabelFor(new TransportAck(Success: false, Queued: true)));
    }

    [Fact]
    public void ServerAcceptedStoreForward_SuccessTrueQueuedTrue_IsLabeledQueued()
    {
        Assert.Equal("queued", AckLabelFor(new TransportAck(Success: true, Queued: true)));
    }

    [Fact]
    public void GenuineFailure_SuccessFalseQueuedFalse_IsLabeledErr()
    {
        Assert.Equal("ERR", AckLabelFor(new TransportAck(Success: false, Queued: false)));
    }

    [Fact]
    public void QueuedAndDuplicate_QueuedWinsOverDuplicate_IsLabeledQueued()
    {
        Assert.Equal("queued", AckLabelFor(new TransportAck(Success: true, Queued: true, Duplicate: true)));
    }

    [Fact]
    public void SuccessfulDuplicateNotQueued_IsLabeledDup()
    {
        Assert.Equal("dup", AckLabelFor(new TransportAck(Success: true, Queued: false, Duplicate: true)));
    }

    [Fact]
    public void PlainSuccess_NotQueuedNotDuplicate_IsLabeledOk()
    {
        Assert.Equal("ok", AckLabelFor(new TransportAck(Success: true, Queued: false, Duplicate: false)));
    }
}
