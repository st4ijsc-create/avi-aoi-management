using System.Reflection;
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
    // Fix round 1 (task-1-report.md, CRITICAL) — WriteOutcome.Applied used to be ordinal 0
    // (default(WriteOutcome)), so a missing/absent "outcome" field deserialized to "the device took it".
    // These pin the empirical scenarios the review reproduced against the real types before the fix, and
    // prove they now resolve to the safe (Indeterminate) reading instead.
    // ─────────────────────────────────────────────────────────────────────
    [Fact]
    public void DefaultWriteOutcome_IsIndeterminate_NotApplied()
    {
        // The single most load-bearing assertion in this whole file: default(WriteOutcome) — what ANY
        // uninitialized field, FirstOrDefault() over an empty sequence, or missing-JSON-field resolves to
        // — must be the pessimistic outcome, never the optimistic one.
        Assert.Equal(WriteOutcome.Indeterminate, default(WriteOutcome));
        Assert.NotEqual(WriteOutcome.Applied, default(WriteOutcome));
    }

    [Fact]
    public void SetpointWriteResult_MissingOutcomeField_DeserializesToIndeterminate_NotApplied()
    {
        // Reproduces the review's exact empirical finding: {"point":"p"} with no "outcome" key at all.
        const string json = """{"point":"p"}""";

        var back = JsonSerializer.Deserialize<SetpointWriteResult>(json, ConnectorJson.Options);

        Assert.NotNull(back);
        Assert.Equal(WriteOutcome.Indeterminate, back!.Outcome);
        Assert.NotEqual(WriteOutcome.Applied, back.Outcome);
        Assert.Null(back.RejectionReason);
    }

    [Fact]
    public void SetpointWriteResult_EmptyJsonObject_DeserializesToIndeterminate_NotApplied()
    {
        // Reproduces the review's second empirical finding: {} — every field absent, including "point".
        const string json = "{}";

        var back = JsonSerializer.Deserialize<SetpointWriteResult>(json, ConnectorJson.Options);

        Assert.NotNull(back);
        Assert.Equal(WriteOutcome.Indeterminate, back!.Outcome);
        Assert.NotEqual(WriteOutcome.Applied, back.Outcome);
    }

    [Fact]
    public void SetpointWriteResult_OutOfRangeIntegerOutcome_ThrowsLoudly_NoLongerSilentlyAccepted()
    {
        // Reproduces the review's third empirical finding: {"outcome":99} used to bind to an undefined enum
        // value with Enum.IsDefined == false and NO exception anywhere. allowIntegerValues: false
        // (ConnectorJson's fix round 1) means an integer token is rejected outright now, defined or not.
        const string json = """{"point":"p","outcome":99}""";

        Assert.Throws<JsonException>(() => JsonSerializer.Deserialize<SetpointWriteResult>(json, ConnectorJson.Options));
    }

    [Fact]
    public void SetpointWriteResult_ValidOrdinalAsInteger_AlsoThrows_IntegersAreNeverAcceptedAtAll()
    {
        // Not just out-of-range integers — allowIntegerValues: false rejects EVERY integer form, including
        // one that happens to name a real, defined member (Rejected = 1). The wire format is camelCase
        // strings only, full stop; a byte-for-byte valid ordinal is not a backdoor around that.
        const string json = """{"point":"p","outcome":1,"rejectionReason":"outOfRange"}""";

        Assert.Throws<JsonException>(() => JsonSerializer.Deserialize<SetpointWriteResult>(json, ConnectorJson.Options));
    }

    [Fact]
    public void SetpointWriteResult_UnknownStringOutcome_StillThrowsLoudly_UnchangedBehavior()
    {
        // Positive control: an unknown STRING already threw before this fix round (only the integer path
        // was silently permissive) — confirms this fix didn't accidentally change that already-correct
        // behavior.
        const string json = """{"point":"p","outcome":"not-a-real-outcome"}""";

        Assert.Throws<JsonException>(() => JsonSerializer.Deserialize<SetpointWriteResult>(json, ConnectorJson.Options));
    }

    [Fact]
    public void DeviceReading_Enums_StillRoundTripAfterAllowIntegerValuesChange()
    {
        // The allowIntegerValues:false change is on the SHARED ConnectorJson.Options, so it applies to
        // every enum on this wire format, not just the new write-contract ones. Confirms DeviceReading's own
        // enums (ReadingKind/Verdict) still round-trip exactly as ConnectorRoundTripTests already pins —
        // this is a second, targeted check specifically on the enum-string path this fix touched.
        var reading = new DeviceReading { Kind = ReadingKind.Inspection, Verdict = Verdict.Warn };

        var json = JsonSerializer.Serialize(reading, ConnectorJson.Options);
        var back = JsonSerializer.Deserialize<DeviceReading>(json, ConnectorJson.Options);

        Assert.Equal(ReadingKind.Inspection, back!.Kind);
        Assert.Equal(Verdict.Warn, back.Verdict);
    }

    // ─────────────────────────────────────────────────────────────────────
    // Fix round 2 (task-1-report.md, IMPORTANT) — a `with` expression bypasses fix round 1's validating
    // `init` INITIALIZER entirely (it clones fields directly, then calls only the explicitly-listed
    // properties' `init` ACCESSORS, which never re-run an initializer expression). Verified empirically
    // (both here and independently by the reviewer) that this actually compiled and silently produced an
    // inconsistent instance before this fix round. The real fix removes the `init` accessor from BOTH
    // Outcome and RejectionReason entirely, which turns `with { Outcome = ... }` / `with { RejectionReason =
    // ... }` into a COMPILE ERROR (CS0200) — there is no runtime code path left to test, because the whole
    // point is that the vulnerable code no longer compiles. A source snippet proving that cannot live in
    // this file (it would stop the entire test assembly from building), so the closest genuine
    // runtime-checkable proxy for "a `with` expression cannot target this property" is reflection: a
    // property has no accessor a `with` expression could invoke if and only if PropertyInfo.SetMethod is
    // null. These tests assert exactly that — they would FAIL (SetMethod non-null) against fix round 1's
    // code, and they pass now. See task-1-report.md's "Fix round 2" section for the exact three `with`
    // expressions from the review, each confirmed via a standalone scratch build to now produce
    // "error CS0200: Property or indexer '...' cannot be assigned to -- it is read only".
    // ─────────────────────────────────────────────────────────────────────
    [Theory]
    [InlineData(typeof(SetpointWriteResult), nameof(SetpointWriteResult.Outcome))]
    [InlineData(typeof(SetpointWriteResult), nameof(SetpointWriteResult.RejectionReason))]
    [InlineData(typeof(CommandResult), nameof(CommandResult.Outcome))]
    [InlineData(typeof(CommandResult), nameof(CommandResult.RejectionReason))]
    public void OutcomeAndRejectionReason_HaveNoSetterOrInitAccessor_SoWithExpressionsCannotTargetThem(Type resultType, string propertyName)
    {
        var property = resultType.GetProperty(propertyName);
        Assert.NotNull(property);
        // No SetMethod at all (not even a non-public one) — this is precisely the condition that makes
        // `with { <PropertyName> = ... }` a compiler error on this type. If this property ever regains an
        // `init` accessor (SetMethod would then be non-null, decorated with IsExternalInit), this assertion
        // is what catches the regression.
        Assert.Null(property!.SetMethod);
    }

    [Fact]
    public void SetpointWriteResult_PointAndDetail_RemainFreelyWithable_WithIsNotBrokenWholesale()
    {
        // Positive control: proves the fix is scoped to Outcome/RejectionReason specifically, not a side
        // effect that accidentally disabled `with` for this whole record. Point/Detail keep ordinary `init`
        // accessors and a legitimate `with` on either still compiles and works.
        var original = new SetpointWriteResult("p", WriteOutcome.Applied, Detail: "original detail");

        var renamed = original with { Point = "q" };
        var redetailed = original with { Detail = "new detail" };

        Assert.Equal("q", renamed.Point);
        Assert.Equal(WriteOutcome.Applied, renamed.Outcome); // untouched by the `with`.
        Assert.Equal("new detail", redetailed.Detail);
        Assert.Equal("p", redetailed.Point); // untouched by the `with`.
    }

    [Fact]
    public void CommandResult_CommandAndDetail_RemainFreelyWithable_WithIsNotBrokenWholesale()
    {
        var original = new CommandResult("start-cycle", WriteOutcome.Applied, Detail: "original detail");

        var renamed = original with { Command = "stop-cycle" };
        var redetailed = original with { Detail = "new detail" };

        Assert.Equal("stop-cycle", renamed.Command);
        Assert.Equal(WriteOutcome.Applied, renamed.Outcome);
        Assert.Equal("new detail", redetailed.Detail);
        Assert.Equal("start-cycle", redetailed.Command);
    }

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
        // Fix round 1: Outcome must be Rejected here — RejectionReason is only legal alongside Rejected
        // (enforced by the record's own validating initializer; see SetpointWriteResult_IllegalCombination_*
        // below), so Indeterminate+OutOfRange (the original combination this test used) is no longer a
        // constructible value at all.
        var result = new SetpointWriteResult("p", WriteOutcome.Rejected, SetpointRejectionReason.OutOfRange);

        var json = JsonSerializer.Serialize(result, ConnectorJson.Options);

        Assert.Contains("\"outcome\":\"rejected\"", json);
        Assert.Contains("\"rejectionReason\":\"outOfRange\"", json);
        // A bare-int enum wire format would contain e.g. "outcome":1 — assert that shape is entirely absent.
        Assert.DoesNotContain("\"outcome\":1", json);
        Assert.DoesNotContain("\"rejectionReason\":2", json);
    }

    [Fact]
    public void SetpointWriteResult_IllegalCombination_AppliedWithRejectionReason_ThrowsAtConstruction()
    {
        // Fix round 1 (IMPORTANT) — "RejectionReason non-null iff Outcome is Rejected" is now enforced by
        // the record itself, not just documented. Applied carrying a reason is exactly the illegal state
        // the two-enum split was supposed to make impossible one level up; this proves it is now impossible
        // at THIS level too.
        var ex = Assert.Throws<ArgumentException>(() =>
            new SetpointWriteResult("p", WriteOutcome.Applied, SetpointRejectionReason.OutOfRange));
        Assert.Contains("RejectionReason", ex.Message);
    }

    [Fact]
    public void SetpointWriteResult_IllegalCombination_RejectedWithNoReason_ThrowsAtConstruction()
    {
        Assert.Throws<ArgumentException>(() => new SetpointWriteResult("p", WriteOutcome.Rejected));
    }

    [Fact]
    public void SetpointWriteResult_IllegalCombination_ThrowsOnDeserialize_NotJustOnDirectConstruction()
    {
        // The record's validating initializer runs as part of the SAME constructor System.Text.Json calls
        // when deserializing a record — proves a malformed wire payload (exactly the sidecar/third-party
        // producer scenario this assembly exists for) is rejected too, not only a caller using `new` directly.
        // Empirically confirmed the thrown type: System.Text.Json lets the ArgumentException from the
        // property initializer propagate UNWRAPPED here (not re-wrapped as JsonException), so this asserts
        // the real, observed type rather than a generic Exception.
        const string badJson = """{"point":"p","outcome":"applied","rejectionReason":"outOfRange"}""";
        Assert.Throws<ArgumentException>(() => JsonSerializer.Deserialize<SetpointWriteResult>(badJson, ConnectorJson.Options));
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
        // Fix round 1: Outcome must be Rejected — see the equivalent SetpointWriteResult test's own comment.
        var result = new CommandResult("c", WriteOutcome.Rejected, CommandRejectionReason.InvalidArgument);

        var json = JsonSerializer.Serialize(result, ConnectorJson.Options);

        Assert.Contains("\"outcome\":\"rejected\"", json);
        Assert.Contains("\"rejectionReason\":\"invalidArgument\"", json);
        Assert.DoesNotContain("\"outcome\":1", json);
    }

    [Fact]
    public void CommandResult_IllegalCombination_AppliedWithRejectionReason_ThrowsAtConstruction()
    {
        var ex = Assert.Throws<ArgumentException>(() =>
            new CommandResult("c", WriteOutcome.Applied, CommandRejectionReason.InvalidArgument));
        Assert.Contains("RejectionReason", ex.Message);
    }

    [Fact]
    public void CommandResult_IllegalCombination_RejectedWithNoReason_ThrowsAtConstruction()
    {
        Assert.Throws<ArgumentException>(() => new CommandResult("c", WriteOutcome.Rejected));
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
