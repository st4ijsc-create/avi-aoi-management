using System.Text.Json;
using St4i.Connector.Abstractions.Json;
using St4i.Connector.Abstractions.Models;
using Xunit;

namespace St4i.Connector.Abstractions.Tests;

/// <summary>
/// Task B-1 (.superpowers/sdd/2026-07-29-dotB-machine-control-blueprint/task-1-brief.md) — the write
/// contract's request/result types are the sidecar-readiness gate GP-2 established for
/// <see cref="DeviceReading"/> (<c>ConnectorRoundTripTests</c>), applied to a brand-new capability: every
/// type here must round-trip losslessly through <see cref="ConnectorJson.Options"/>, exactly like every
/// <see cref="DeviceReading"/> member already does — INCLUDING the one outcome most products never even
/// model (<see cref="WriteOutcome.Indeterminate"/>) and every documented rejection reason for both the
/// setpoint and the command operation.
/// </summary>
public class WriteRoundTripTests
{
    // ─────────────────────────────────────────────────────────────────────
    // SetpointWriteRequest — Value reuses TelemetrySample.Value's object? domain.
    // ─────────────────────────────────────────────────────────────────────
    [Fact]
    public void SetpointWriteRequest_DoubleValue_RoundTrips()
    {
        var back = RoundTrip(new SetpointWriteRequest("speed_rpm", 1420.5));

        Assert.Equal("speed_rpm", back.Point);
        Assert.Equal(1420.5, Assert.IsType<double>(back.Value));
    }

    [Fact]
    public void SetpointWriteRequest_BoolValue_RoundTrips()
    {
        var back = RoundTrip(new SetpointWriteRequest("enabled", true));

        Assert.True(Assert.IsType<bool>(back.Value));
    }

    [Fact]
    public void SetpointWriteRequest_StringValue_RoundTrips()
    {
        var back = RoundTrip(new SetpointWriteRequest("mode", "AUTO"));

        Assert.Equal("AUTO", Assert.IsType<string>(back.Value));
    }

    [Fact]
    public void SetpointWriteRequest_NullValue_RoundTrips()
    {
        var back = RoundTrip(new SetpointWriteRequest("mode", null));

        Assert.Null(back.Value);
    }

    [Fact]
    public void SetpointWriteRequest_OutOfDomainValue_ThrowsLoudly_SameAsTelemetrySample()
    {
        // Proves Value genuinely goes through ConnectorObjectConverter's domain rather than some laxer
        // ad-hoc handling — a DateTime is rejected here exactly like it already is for
        // TelemetrySample.Value (see ConnectorRoundTripTests.DecisionB_SerializingDateTimeValue_ThrowsLoudly).
        var original = new SetpointWriteRequest("bad", DateTime.UtcNow);

        var ex = Assert.Throws<JsonException>(() => JsonSerializer.Serialize(original, ConnectorJson.Options));
        Assert.Contains("DateTime", ex.Message);
    }

    // ─────────────────────────────────────────────────────────────────────
    // SetpointWriteResult — every WriteOutcome, every SetpointRejectionReason.
    // ─────────────────────────────────────────────────────────────────────
    [Fact]
    public void SetpointWriteResult_Applied_RoundTrips()
    {
        var back = RoundTrip(new SetpointWriteResult("speed_rpm", WriteOutcome.Applied));

        Assert.Equal("speed_rpm", back.Point);
        Assert.Equal(WriteOutcome.Applied, back.Outcome);
        Assert.Null(back.RejectionReason);
        Assert.Null(back.Detail);
    }

    [Fact]
    public void SetpointWriteResult_Rejected_UnknownPoint_RoundTrips()
    {
        var back = RoundTrip(new SetpointWriteResult("bogus", WriteOutcome.Rejected, SetpointRejectionReason.UnknownPoint, "no such point"));

        Assert.Equal(WriteOutcome.Rejected, back.Outcome);
        Assert.Equal(SetpointRejectionReason.UnknownPoint, back.RejectionReason);
        Assert.Equal("no such point", back.Detail);
    }

    [Fact]
    public void SetpointWriteResult_Rejected_NotWritable_RoundTrips()
    {
        var back = RoundTrip(new SetpointWriteResult("cfg_reg", WriteOutcome.Rejected, SetpointRejectionReason.NotWritable));

        Assert.Equal(SetpointRejectionReason.NotWritable, back.RejectionReason);
    }

    [Fact]
    public void SetpointWriteResult_Rejected_OutOfRange_RoundTrips()
    {
        var back = RoundTrip(new SetpointWriteResult("speed_rpm", WriteOutcome.Rejected, SetpointRejectionReason.OutOfRange));

        Assert.Equal(SetpointRejectionReason.OutOfRange, back.RejectionReason);
    }

    [Fact]
    public void SetpointWriteResult_Failed_RoundTrips()
    {
        var back = RoundTrip(new SetpointWriteResult("speed_rpm", WriteOutcome.Failed, Detail: "device returned NAK"));

        Assert.Equal(WriteOutcome.Failed, back.Outcome);
        Assert.Null(back.RejectionReason);
        Assert.Equal("device returned NAK", back.Detail);
    }

    [Fact]
    public void SetpointWriteResult_Indeterminate_RoundTrips()
    {
        // The outcome the brief specifically calls out as the one most products hide entirely — proven to
        // survive the exact wire format a future sidecar boundary will use, Detail intact.
        var back = RoundTrip(new SetpointWriteResult(
            "speed_rpm", WriteOutcome.Indeterminate, Detail: "write timed out after 3000ms; device state unknown"));

        Assert.Equal(WriteOutcome.Indeterminate, back.Outcome);
        Assert.Null(back.RejectionReason);
        Assert.Equal("write timed out after 3000ms; device state unknown", back.Detail);
    }

    [Fact]
    public void SetpointWriteResult_Enums_SerializeAsCamelCaseStrings_NeverBareIntegers()
    {
        var result = new SetpointWriteResult("p", WriteOutcome.Indeterminate, SetpointRejectionReason.OutOfRange);

        var json = JsonSerializer.Serialize(result, ConnectorJson.Options);

        Assert.Contains("\"outcome\":\"indeterminate\"", json);
        Assert.Contains("\"rejectionReason\":\"outOfRange\"", json);
        // A bare-int enum wire format would contain e.g. "outcome":3 — assert that shape is entirely absent.
        Assert.DoesNotContain("\"outcome\":3", json);
        Assert.DoesNotContain("\"rejectionReason\":2", json);
    }

    // ─────────────────────────────────────────────────────────────────────
    // CommandRequest — Arguments reuses DeviceReading.Genealogy's string|int|double domain.
    // ─────────────────────────────────────────────────────────────────────
    [Fact]
    public void CommandRequest_NoArguments_RoundTrips()
    {
        var back = RoundTrip(new CommandRequest("start-cycle"));

        Assert.Equal("start-cycle", back.Command);
        Assert.Null(back.Arguments);
    }

    [Fact]
    public void CommandRequest_WithArguments_RoundTrips_SameDomainAsGenealogy()
    {
        var original = new CommandRequest("dispense", new Dictionary<string, object>
        {
            ["volumeMl"] = 12.5,
            ["cycles"] = 3,
            ["recipe"] = "RCP-9",
        });

        var back = RoundTrip(original);

        Assert.Equal("dispense", back.Command);
        Assert.NotNull(back.Arguments);
        Assert.Equal(12.5, Assert.IsType<double>(back.Arguments!["volumeMl"]));
        // decision (a) from ConnectorObjectConverter: a CLR int round-trips as long, never silently as
        // double — same behaviour DeviceReading.Genealogy already relies on.
        Assert.Equal(3L, Assert.IsType<long>(back.Arguments["cycles"]));
        Assert.Equal("RCP-9", Assert.IsType<string>(back.Arguments["recipe"]));
    }

    // ─────────────────────────────────────────────────────────────────────
    // CommandResult — every WriteOutcome, every CommandRejectionReason.
    // ─────────────────────────────────────────────────────────────────────
    [Fact]
    public void CommandResult_Applied_RoundTrips()
    {
        var back = RoundTrip(new CommandResult("start-cycle", WriteOutcome.Applied));

        Assert.Equal("start-cycle", back.Command);
        Assert.Equal(WriteOutcome.Applied, back.Outcome);
        Assert.Null(back.RejectionReason);
    }

    [Fact]
    public void CommandResult_Rejected_UnknownCommand_RoundTrips()
    {
        var back = RoundTrip(new CommandResult("bogus", WriteOutcome.Rejected, CommandRejectionReason.UnknownCommand, "no such command"));

        Assert.Equal(CommandRejectionReason.UnknownCommand, back.RejectionReason);
        Assert.Equal("no such command", back.Detail);
    }

    [Fact]
    public void CommandResult_Rejected_InvalidArgument_RoundTrips()
    {
        var back = RoundTrip(new CommandResult("dispense", WriteOutcome.Rejected, CommandRejectionReason.InvalidArgument));

        Assert.Equal(CommandRejectionReason.InvalidArgument, back.RejectionReason);
    }

    [Fact]
    public void CommandResult_Failed_RoundTrips()
    {
        var back = RoundTrip(new CommandResult("start-cycle", WriteOutcome.Failed, Detail: "interlock engaged"));

        Assert.Equal(WriteOutcome.Failed, back.Outcome);
        Assert.Equal("interlock engaged", back.Detail);
    }

    [Fact]
    public void CommandResult_Indeterminate_RoundTrips()
    {
        // CallAsync is the highest-risk surface this whole batch adds — an indeterminate command result
        // must survive the wire exactly as honestly as an indeterminate setpoint result does.
        var back = RoundTrip(new CommandResult(
            "start-cycle", WriteOutcome.Indeterminate, Detail: "CallAsync timed out; motion state unknown"));

        Assert.Equal(WriteOutcome.Indeterminate, back.Outcome);
        Assert.Equal("CallAsync timed out; motion state unknown", back.Detail);
    }

    [Fact]
    public void CommandResult_Enums_SerializeAsCamelCaseStrings_NeverBareIntegers()
    {
        var result = new CommandResult("c", WriteOutcome.Indeterminate, CommandRejectionReason.InvalidArgument);

        var json = JsonSerializer.Serialize(result, ConnectorJson.Options);

        Assert.Contains("\"outcome\":\"indeterminate\"", json);
        Assert.Contains("\"rejectionReason\":\"invalidArgument\"", json);
        Assert.DoesNotContain("\"outcome\":3", json);
    }

    // ─────────────────────────────────────────────────────────────────────
    // Helpers
    // ─────────────────────────────────────────────────────────────────────
    private static SetpointWriteRequest RoundTrip(SetpointWriteRequest original) =>
        JsonSerializer.Deserialize<SetpointWriteRequest>(JsonSerializer.Serialize(original, ConnectorJson.Options), ConnectorJson.Options)!;

    private static SetpointWriteResult RoundTrip(SetpointWriteResult original) =>
        JsonSerializer.Deserialize<SetpointWriteResult>(JsonSerializer.Serialize(original, ConnectorJson.Options), ConnectorJson.Options)!;

    private static CommandRequest RoundTrip(CommandRequest original) =>
        JsonSerializer.Deserialize<CommandRequest>(JsonSerializer.Serialize(original, ConnectorJson.Options), ConnectorJson.Options)!;

    private static CommandResult RoundTrip(CommandResult original) =>
        JsonSerializer.Deserialize<CommandResult>(JsonSerializer.Serialize(original, ConnectorJson.Options), ConnectorJson.Options)!;
}
