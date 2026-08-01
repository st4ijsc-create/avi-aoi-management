using System.Diagnostics;
using System.Net;
using System.Net.Sockets;
using St4i.Connector.Abstractions.Models;
using St4i.EdgeCore.Drivers.OpcUa;
using Xunit;

namespace St4i.EdgeCore.Tests.Drivers.OpcUa;

/// <summary>
/// Task B-5 (.superpowers/sdd/2026-07-29-dotB-machine-control-blueprint/task-5-brief.md) — the write and
/// command-execution proof for <see cref="OpcUaDriver"/>: a real in-process OPC Foundation reference SERVER
/// (<see cref="OpcUaLoopbackHarness.StartWritableServerAsync"/>, a purely-additive sibling of the existing
/// read-only harness) for the "reaches the device" cases, and a hand-rolled raw TCP listener (mirroring
/// <c>OpcUaDriverConformanceTests.CreateUnresponsiveDeviceAsync</c>'s own technique) where a test needs a
/// target that never completes a session at all.
///
/// <para>Deliberately a NEW file — <see cref="OpcUaDriverLoopbackTests"/> and the conformance suite stay
/// completely unchanged (extend, never weaken — B-4's own precedent); only <see cref="OpcUaLoopbackHarness"/>
/// gained purely-additive members (<see cref="OpcUaLoopbackHarness.StartWritableServerAsync"/>,
/// <see cref="OpcUaLoopbackHarness.BuildWritableMap"/>).</para>
/// </summary>
[Collection("St4i.EdgeCore.Tests.OpcUa")]
public sealed class OpcUaDriverWriteTests
{
    private static string NewPkiRoot(string tag) =>
        Path.Combine(Path.GetTempPath(), $"st4i-opcua-write-{tag}-" + Guid.NewGuid().ToString("N")[..8]);

    // ─────────────────────────────────────────────────────────────────────
    // 1) A setpoint within range reaches the device and reports Applied — Bool, integral, and floating
    // types all covered.
    // ─────────────────────────────────────────────────────────────────────

    [Fact]
    public async Task WriteSetpointAsync_DoubleWithinRange_ReachesDevice_ReportsApplied()
    {
        var pkiRoot = NewPkiRoot("double-ok");
        await using var server = await OpcUaLoopbackHarness.StartWritableServerAsync(pkiRoot);
        await using var driver = new OpcUaDriver(OpcUaLoopbackHarness.BuildWritableMap("PLC-OU-WRITE-DOUBLE", server.EndpointUrl), pkiDir: pkiRoot);

        var result = await driver.WriteSetpointAsync(new SetpointWriteRequest("speed", 123.5), CancellationToken.None);

        Assert.Equal("speed", result.Point);
        Assert.Equal(WriteOutcome.Applied, result.Outcome);
        Assert.Null(result.RejectionReason);

        // The load-bearing assertion: read the value straight off the SERVER's own address space —
        // independent of OpcUaDriver entirely — proving the write genuinely reached the "device".
        Assert.Equal(123.5, (double)server.GetVariableValue("Speed"), precision: 10);
    }

    [Fact]
    public async Task WriteSetpointAsync_BoolWithinDomain_ReachesDevice_ReportsApplied()
    {
        var pkiRoot = NewPkiRoot("bool-ok");
        await using var server = await OpcUaLoopbackHarness.StartWritableServerAsync(pkiRoot);
        await using var driver = new OpcUaDriver(OpcUaLoopbackHarness.BuildWritableMap("PLC-OU-WRITE-BOOL", server.EndpointUrl), pkiDir: pkiRoot);

        var result = await driver.WriteSetpointAsync(new SetpointWriteRequest("enabled", true), CancellationToken.None);

        Assert.Equal(WriteOutcome.Applied, result.Outcome);
        Assert.Equal(true, server.GetVariableValue("Enabled"));
    }

    [Fact]
    public async Task WriteSetpointAsync_Int16WithinRange_ReachesDevice_ReportsApplied()
    {
        var pkiRoot = NewPkiRoot("int16-ok");
        await using var server = await OpcUaLoopbackHarness.StartWritableServerAsync(pkiRoot);
        await using var driver = new OpcUaDriver(OpcUaLoopbackHarness.BuildWritableMap("PLC-OU-WRITE-INT16", server.EndpointUrl), pkiDir: pkiRoot);

        var result = await driver.WriteSetpointAsync(new SetpointWriteRequest("mode", -7L), CancellationToken.None);

        Assert.Equal(WriteOutcome.Applied, result.Outcome);
        Assert.Equal((short)-7, server.GetVariableValue("Mode"));
    }

    [Fact]
    public async Task WriteSetpointAsync_UInt32WithinRange_ReachesDevice_ReportsApplied()
    {
        var pkiRoot = NewPkiRoot("uint32-ok");
        await using var server = await OpcUaLoopbackHarness.StartWritableServerAsync(pkiRoot);
        await using var driver = new OpcUaDriver(OpcUaLoopbackHarness.BuildWritableMap("PLC-OU-WRITE-UINT32", server.EndpointUrl), pkiDir: pkiRoot);

        var result = await driver.WriteSetpointAsync(new SetpointWriteRequest("count", 42L), CancellationToken.None);

        Assert.Equal(WriteOutcome.Applied, result.Outcome);
        Assert.Equal((uint)42, server.GetVariableValue("Count"));
    }

    // ─────────────────────────────────────────────────────────────────────
    // 2) A command invokes the declared method with correctly-narrowed arguments — and ONLY the declared
    // method (proven by an independent invocation counter on the SERVER, not this driver's own return value).
    // ─────────────────────────────────────────────────────────────────────

    [Fact]
    public async Task InvokeCommandAsync_WithCorrectlyNarrowedArgument_InvokesOnlyTheDeclaredMethod_ReportsApplied()
    {
        var pkiRoot = NewPkiRoot("call-ok");
        await using var server = await OpcUaLoopbackHarness.StartWritableServerAsync(pkiRoot);
        await using var driver = new OpcUaDriver(OpcUaLoopbackHarness.BuildWritableMap("PLC-OU-CALL-OK", server.EndpointUrl), pkiDir: pkiRoot);

        // "speed" is declared UInt16 [0,1000] — B-1's own documented gap: this arrives at the driver as a
        // boxed `long` (an integral JSON-shaped number widens to long, never UInt16 itself), and must be
        // RE-NARROWED from the map's own declaration, not guessed from this runtime type.
        var result = await driver.InvokeCommandAsync(new CommandRequest("start-cycle", new Dictionary<string, object> { ["speed"] = 250L }), CancellationToken.None);

        Assert.Equal("start-cycle", result.Command);
        Assert.Equal(WriteOutcome.Applied, result.Outcome);
        Assert.Null(result.RejectionReason);

        // The load-bearing "only the declared method, correctly narrowed" assertion: the SERVER's own
        // instrumented method recorded exactly one invocation, and the EXACT CLR type it received is
        // ushort (not long/int) — proving the narrowing, not just a return value this driver authored itself.
        Assert.Equal(1, server.Controls.StartCycleInvokedCount);
        Assert.Equal(0, server.Controls.PingInvokedCount);
        Assert.IsType<ushort>(server.Controls.LastStartCycleArgument);
        Assert.Equal((ushort)250, server.Controls.LastStartCycleArgument);
    }

    [Fact]
    public async Task InvokeCommandAsync_NoArgumentCommand_ReportsApplied_OnlyThatMethodInvoked()
    {
        var pkiRoot = NewPkiRoot("call-noargs");
        await using var server = await OpcUaLoopbackHarness.StartWritableServerAsync(pkiRoot);
        await using var driver = new OpcUaDriver(OpcUaLoopbackHarness.BuildWritableMap("PLC-OU-CALL-NOARGS", server.EndpointUrl), pkiDir: pkiRoot);

        var result = await driver.InvokeCommandAsync(new CommandRequest("ping"), CancellationToken.None);

        Assert.Equal(WriteOutcome.Applied, result.Outcome);
        Assert.Equal(1, server.Controls.PingInvokedCount);
        Assert.Equal(0, server.Controls.StartCycleInvokedCount);
    }

    [Fact]
    public async Task InvokeCommandAsync_UnknownCommand_RejectedWithoutInvokingAnything()
    {
        var pkiRoot = NewPkiRoot("call-unknown");
        await using var server = await OpcUaLoopbackHarness.StartWritableServerAsync(pkiRoot);
        await using var driver = new OpcUaDriver(OpcUaLoopbackHarness.BuildWritableMap("PLC-OU-CALL-UNKNOWN", server.EndpointUrl), pkiDir: pkiRoot);

        var result = await driver.InvokeCommandAsync(new CommandRequest("does-not-exist"), CancellationToken.None);

        Assert.Equal(WriteOutcome.Rejected, result.Outcome);
        Assert.Equal(CommandRejectionReason.UnknownCommand, result.RejectionReason);
        Assert.Equal(0, server.Controls.StartCycleInvokedCount);
        Assert.Equal(0, server.Controls.PingInvokedCount);
    }

    [Fact]
    public async Task InvokeCommandAsync_MissingRequiredArgument_RejectedWithoutInvokingTheDevice()
    {
        var pkiRoot = NewPkiRoot("call-missing-arg");
        await using var server = await OpcUaLoopbackHarness.StartWritableServerAsync(pkiRoot);
        await using var driver = new OpcUaDriver(OpcUaLoopbackHarness.BuildWritableMap("PLC-OU-CALL-MISSING", server.EndpointUrl), pkiDir: pkiRoot);

        var result = await driver.InvokeCommandAsync(new CommandRequest("start-cycle"), CancellationToken.None);

        Assert.Equal(WriteOutcome.Rejected, result.Outcome);
        Assert.Equal(CommandRejectionReason.InvalidArgument, result.RejectionReason);
        Assert.Equal(0, server.Controls.StartCycleInvokedCount);
    }

    [Fact]
    public async Task InvokeCommandAsync_WrongArgumentType_RejectedWithoutInvokingTheDevice()
    {
        var pkiRoot = NewPkiRoot("call-wrong-type");
        await using var server = await OpcUaLoopbackHarness.StartWritableServerAsync(pkiRoot);
        await using var driver = new OpcUaDriver(OpcUaLoopbackHarness.BuildWritableMap("PLC-OU-CALL-WRONGTYPE", server.EndpointUrl), pkiDir: pkiRoot);

        // "speed" is declared UInt16 — a string is never an accepted runtime shape for it.
        var result = await driver.InvokeCommandAsync(
            new CommandRequest("start-cycle", new Dictionary<string, object> { ["speed"] = "fast" }), CancellationToken.None);

        Assert.Equal(WriteOutcome.Rejected, result.Outcome);
        Assert.Equal(CommandRejectionReason.InvalidArgument, result.RejectionReason);
        Assert.Equal(0, server.Controls.StartCycleInvokedCount);
    }

    [Fact]
    public async Task InvokeCommandAsync_ArgumentOutsideDeclaredRange_RejectedWithoutInvokingTheDevice()
    {
        var pkiRoot = NewPkiRoot("call-out-of-range");
        await using var server = await OpcUaLoopbackHarness.StartWritableServerAsync(pkiRoot);
        await using var driver = new OpcUaDriver(OpcUaLoopbackHarness.BuildWritableMap("PLC-OU-CALL-OOR", server.EndpointUrl), pkiDir: pkiRoot);

        // "speed" declares [0,1000] — 5000 is a valid UInt16 but outside the DECLARED range.
        var result = await driver.InvokeCommandAsync(
            new CommandRequest("start-cycle", new Dictionary<string, object> { ["speed"] = 5000L }), CancellationToken.None);

        Assert.Equal(WriteOutcome.Rejected, result.Outcome);
        Assert.Equal(CommandRejectionReason.InvalidArgument, result.RejectionReason);
        Assert.Equal(0, server.Controls.StartCycleInvokedCount);
    }

    // ─────────────────────────────────────────────────────────────────────
    // 3) B-3's limits are enforced through this entry point — out-of-range, NaN, wrong type — device
    // untouched in every rejection. TryNarrowForWrite/TryNarrowAll are CALLED, never re-derived.
    // ─────────────────────────────────────────────────────────────────────

    [Fact]
    public async Task WriteSetpointAsync_UnknownPoint_RejectedWithoutTouchingDevice()
    {
        var pkiRoot = NewPkiRoot("unknown-point");
        await using var server = await OpcUaLoopbackHarness.StartWritableServerAsync(pkiRoot);
        await using var driver = new OpcUaDriver(OpcUaLoopbackHarness.BuildWritableMap("PLC-OU-UNKNOWN", server.EndpointUrl), pkiDir: pkiRoot);

        var before = server.GetVariableValue("Speed");
        var result = await driver.WriteSetpointAsync(new SetpointWriteRequest("does-not-exist", 1.0), CancellationToken.None);

        Assert.Equal(WriteOutcome.Rejected, result.Outcome);
        Assert.Equal(SetpointRejectionReason.UnknownPoint, result.RejectionReason);
        Assert.Equal(before, server.GetVariableValue("Speed"));
    }

    [Fact]
    public async Task WriteSetpointAsync_DeclaredReadOnlyInMap_RejectedWithoutTouchingDevice()
    {
        var pkiRoot = NewPkiRoot("not-writable");
        await using var server = await OpcUaLoopbackHarness.StartWritableServerAsync(pkiRoot);
        await using var driver = new OpcUaDriver(OpcUaLoopbackHarness.BuildWritableMap("PLC-OU-NOTWRITABLE", server.EndpointUrl), pkiDir: pkiRoot);

        var before = server.GetVariableValue("Speed");
        var result = await driver.WriteSetpointAsync(new SetpointWriteRequest("speed-readonly", 1.0), CancellationToken.None);

        Assert.Equal(WriteOutcome.Rejected, result.Outcome);
        Assert.Equal(SetpointRejectionReason.NotWritable, result.RejectionReason);
        Assert.Equal(before, server.GetVariableValue("Speed"));
    }

    [Fact]
    public async Task WriteSetpointAsync_OutOfDeclaredRange_RejectedWithoutTouchingDevice()
    {
        var pkiRoot = NewPkiRoot("out-of-range");
        await using var server = await OpcUaLoopbackHarness.StartWritableServerAsync(pkiRoot);
        await using var driver = new OpcUaDriver(OpcUaLoopbackHarness.BuildWritableMap("PLC-OU-OOR", server.EndpointUrl), pkiDir: pkiRoot);

        var before = server.GetVariableValue("Speed");
        // "speed" declares [0,500].
        var result = await driver.WriteSetpointAsync(new SetpointWriteRequest("speed", 60000.0), CancellationToken.None);

        Assert.Equal(WriteOutcome.Rejected, result.Outcome);
        Assert.Equal(SetpointRejectionReason.OutOfRange, result.RejectionReason);
        Assert.Equal(before, server.GetVariableValue("Speed"));
    }

    [Fact]
    public async Task WriteSetpointAsync_NaN_RejectedWithoutTouchingDevice()
    {
        var pkiRoot = NewPkiRoot("nan");
        await using var server = await OpcUaLoopbackHarness.StartWritableServerAsync(pkiRoot);
        await using var driver = new OpcUaDriver(OpcUaLoopbackHarness.BuildWritableMap("PLC-OU-NAN", server.EndpointUrl), pkiDir: pkiRoot);

        var before = server.GetVariableValue("Speed");
        // B-3's Critical #2 (task-3-report.md): NaN silently wrote 0 before that fix. Verifying the fix is
        // called correctly through THIS entry point, not re-derived here.
        var result = await driver.WriteSetpointAsync(new SetpointWriteRequest("speed", double.NaN), CancellationToken.None);

        Assert.Equal(WriteOutcome.Rejected, result.Outcome);
        Assert.Equal(SetpointRejectionReason.OutOfRange, result.RejectionReason);
        Assert.Equal(before, server.GetVariableValue("Speed"));
    }

    [Fact]
    public async Task WriteSetpointAsync_WrongType_RejectedWithoutTouchingDevice()
    {
        var pkiRoot = NewPkiRoot("wrong-type");
        await using var server = await OpcUaLoopbackHarness.StartWritableServerAsync(pkiRoot);
        await using var driver = new OpcUaDriver(OpcUaLoopbackHarness.BuildWritableMap("PLC-OU-WRONGTYPE", server.EndpointUrl), pkiDir: pkiRoot);

        var before = server.GetVariableValue("Speed");
        // "speed" is a numeric (Double) setpoint — a string has no legitimate meaning here.
        var result = await driver.WriteSetpointAsync(new SetpointWriteRequest("speed", "fast"), CancellationToken.None);

        Assert.Equal(WriteOutcome.Rejected, result.Outcome);
        Assert.Equal(SetpointRejectionReason.OutOfRange, result.RejectionReason);
        Assert.Equal(before, server.GetVariableValue("Speed"));
    }

    [Fact]
    public async Task WriteSetpointAsync_BoolWrongType_RejectedWithoutTouchingDevice()
    {
        var pkiRoot = NewPkiRoot("bool-wrong-type");
        await using var server = await OpcUaLoopbackHarness.StartWritableServerAsync(pkiRoot);
        await using var driver = new OpcUaDriver(OpcUaLoopbackHarness.BuildWritableMap("PLC-OU-BOOLWRONGTYPE", server.EndpointUrl), pkiDir: pkiRoot);

        var before = server.GetVariableValue("Enabled");
        // "enabled" is Bool — a numeric value is never an accepted runtime shape for it.
        var result = await driver.WriteSetpointAsync(new SetpointWriteRequest("enabled", 1.0), CancellationToken.None);

        Assert.Equal(WriteOutcome.Rejected, result.Outcome);
        Assert.Equal(SetpointRejectionReason.OutOfRange, result.RejectionReason);
        Assert.Equal(before, server.GetVariableValue("Enabled"));
    }

    // ─────────────────────────────────────────────────────────────────────
    // 4) Device-level rejection (the server itself refuses a write this map declares writable) reports
    // Failed — a KNOWN "no" — device value unchanged. OPC-UA's Write service is atomic per value; unlike a
    // command, there is no partial-application concept.
    // ─────────────────────────────────────────────────────────────────────

    [Fact]
    public async Task WriteSetpointAsync_ServerRejectsTheWrite_ReportsFailed_DeviceUnchanged()
    {
        var pkiRoot = NewPkiRoot("server-rejects");
        await using var server = await OpcUaLoopbackHarness.StartWritableServerAsync(pkiRoot);
        await using var driver = new OpcUaDriver(OpcUaLoopbackHarness.BuildWritableMap("PLC-OU-SERVERREJECT", server.EndpointUrl), pkiDir: pkiRoot);

        // "locked" is declared writable in OUR map, but the SERVER marks the underlying node read-only
        // (AccessLevel CurrentRead only) — a legitimate map/device mismatch, not one of this driver's own
        // pre-flight checks.
        var before = server.GetVariableValue("Locked");
        var result = await driver.WriteSetpointAsync(new SetpointWriteRequest("locked", 5.0), CancellationToken.None);

        Assert.Equal(WriteOutcome.Failed, result.Outcome);
        Assert.Null(result.RejectionReason);
        Assert.Contains("locked", result.Detail, StringComparison.Ordinal);
        Assert.Equal(before, server.GetVariableValue("Locked"));
    }

    // ─────────────────────────────────────────────────────────────────────
    // 5) A command that DID run, then reported failure itself, is Indeterminate — never Failed (which would
    // wrongly tell an operator nothing happened) and never Applied (the outcome is genuinely unconfirmed).
    // Proven with an independent server-side invocation counter, not this driver's own say-so.
    // ─────────────────────────────────────────────────────────────────────

    [Fact]
    public async Task InvokeCommandAsync_MethodRunsThenReportsFailure_ReportsIndeterminate_NotFailed()
    {
        var pkiRoot = NewPkiRoot("invoked-then-fails");
        await using var server = await OpcUaLoopbackHarness.StartWritableServerAsync(pkiRoot);
        server.Controls.StartCycleRejectsAfterRunning = true;
        await using var driver = new OpcUaDriver(OpcUaLoopbackHarness.BuildWritableMap("PLC-OU-INVOKED-FAILS", server.EndpointUrl), pkiDir: pkiRoot);

        var result = await driver.InvokeCommandAsync(
            new CommandRequest("start-cycle", new Dictionary<string, object> { ["speed"] = 10L }), CancellationToken.None);

        Assert.Equal(WriteOutcome.Indeterminate, result.Outcome);
        Assert.Null(result.RejectionReason);
        Assert.Contains("unconfirmed", result.Detail, StringComparison.OrdinalIgnoreCase);
        // The load-bearing assertion: the method GENUINELY ran (an independent server-side fact) even though
        // the reported outcome is Indeterminate, not Failed — proving this is NOT the "never invoked"
        // pre-flight rejection shape.
        Assert.Equal(1, server.Controls.StartCycleInvokedCount);
    }

    /// <summary>The OTHER half of the Failed-vs-Indeterminate command distinction: a MAP/REALITY mismatch
    /// (this map under-declares "start-cycle"'s arguments relative to what the real server-side method
    /// actually requires) reaches <c>IsPreInvocationCallRejection</c>'s TRUE branch — unlike every other
    /// rejection test in this file, which this driver's OWN pre-flight narrowing catches before ever calling
    /// <c>CallAsync</c> at all. Exercising this branch for real (not just by inspection) matters: it is the
    /// only test in this file that reaches the SERVER's own Call-service precondition check.</summary>
    [Fact]
    public async Task InvokeCommandAsync_MapUnderDeclaresArguments_ServerRejectsBeforeInvoking_ReportsFailed()
    {
        var pkiRoot = NewPkiRoot("call-server-precondition");
        await using var server = await OpcUaLoopbackHarness.StartWritableServerAsync(pkiRoot);

        // Deliberately a MAP/REALITY mismatch: this map declares "start-cycle" as a ZERO-argument command,
        // but the REAL server-side "StartCycle" method requires exactly one UInt16 argument. This driver's
        // own narrowing (CommandArgumentDeclaration.TryNarrowAll) sees zero declared == zero supplied and
        // passes cleanly, so the rejection proven here comes from the SERVER itself.
        var mismatchedMap = new OpcUaNodeMap
        {
            MachineCode = "PLC-OU-CALL-SERVER-PRECONDITION",
            EndpointUrl = server.EndpointUrl,
            Nodes = new List<OpcUaNode> { new("ns=2;s=Speed", "speed", "rpm", new OpcUaWritableSetpoint(CommandArgumentType.Double, 0, 500)) },
            Commands = new List<OpcUaCommand> { new("start-cycle", "ns=2;s=Machine", "ns=2;s=StartCycle") },
        };
        await using var driver = new OpcUaDriver(mismatchedMap, pkiDir: pkiRoot);

        var result = await driver.InvokeCommandAsync(new CommandRequest("start-cycle"), CancellationToken.None);

        Assert.Equal(WriteOutcome.Failed, result.Outcome);
        Assert.Null(result.RejectionReason);
        Assert.Contains("start-cycle", result.Detail, StringComparison.Ordinal);
        // The load-bearing assertion: the SERVER's own precondition check rejected this BEFORE the method
        // ever ran — an independent, server-side fact, not this driver's own say-so.
        Assert.Equal(0, server.Controls.StartCycleInvokedCount);
    }

    // ─────────────────────────────────────────────────────────────────────
    // Review fix round 1 (Important #1) — a malformed NodeId in the MAP (B-3's own FromJson validates only
    // non-blankness, never that a NodeId string actually PARSES) used to construct outside any try, falling
    // through to the generic backstop's "unexpected failure: {ex.Message}" — losing the one fact that
    // matters: this never reached the device at all. Now returns Indeterminate with a Detail that says so
    // explicitly, never the generic backstop text.
    // ─────────────────────────────────────────────────────────────────────

    [Fact]
    public async Task WriteSetpointAsync_MalformedNodeIdInMap_ReturnsActionableDetail_NeverGenericBackstop()
    {
        var pkiRoot = NewPkiRoot("write-malformed-nodeid");
        await using var server = await OpcUaLoopbackHarness.StartWritableServerAsync(pkiRoot);

        var malformedMap = new OpcUaNodeMap
        {
            MachineCode = "PLC-OU-WRITE-MALFORMED-NODEID",
            EndpointUrl = server.EndpointUrl,
            Nodes = new List<OpcUaNode> { new("ns=zz;s=Speed", "speed", "rpm", new OpcUaWritableSetpoint(CommandArgumentType.Double, 0, 500)) },
        };
        await using var driver = new OpcUaDriver(malformedMap, pkiDir: pkiRoot);

        var result = await driver.WriteSetpointAsync(new SetpointWriteRequest("speed", 42.0), CancellationToken.None);

        Assert.Equal(WriteOutcome.Indeterminate, result.Outcome);
        Assert.Null(result.RejectionReason);
        // The load-bearing assertions: NOT the generic backstop, and specific enough to send someone to fix
        // the map rather than physically inspect a machine that was never contacted.
        Assert.DoesNotContain("unexpected failure", result.Detail, StringComparison.Ordinal);
        Assert.Contains("never sent to the device", result.Detail, StringComparison.Ordinal);
        Assert.Contains("speed", result.Detail, StringComparison.Ordinal);
    }

    [Fact]
    public async Task InvokeCommandAsync_MalformedNodeIdInMap_ReturnsActionableDetail_NeverGenericBackstop_DeviceUntouched()
    {
        var pkiRoot = NewPkiRoot("call-malformed-nodeid");
        await using var server = await OpcUaLoopbackHarness.StartWritableServerAsync(pkiRoot);

        var malformedMap = new OpcUaNodeMap
        {
            MachineCode = "PLC-OU-CALL-MALFORMED-NODEID",
            EndpointUrl = server.EndpointUrl,
            Nodes = new List<OpcUaNode> { new("ns=2;s=Speed", "speed", "rpm", new OpcUaWritableSetpoint(CommandArgumentType.Double, 0, 500)) },
            Commands = new List<OpcUaCommand>
            {
                new("start-cycle", "ns=zz;s=Machine", "ns=2;s=StartCycle",
                    new List<CommandArgumentDeclaration> { new("speed", CommandArgumentType.UInt16, 0, 1000) }),
            },
        };
        await using var driver = new OpcUaDriver(malformedMap, pkiDir: pkiRoot);

        var result = await driver.InvokeCommandAsync(
            new CommandRequest("start-cycle", new Dictionary<string, object> { ["speed"] = 10L }), CancellationToken.None);

        Assert.Equal(WriteOutcome.Indeterminate, result.Outcome);
        Assert.Null(result.RejectionReason);
        Assert.DoesNotContain("unexpected failure", result.Detail, StringComparison.Ordinal);
        Assert.Contains("never invoked", result.Detail, StringComparison.Ordinal);
        Assert.Contains("start-cycle", result.Detail, StringComparison.Ordinal);
        // The load-bearing assertion: an independent, server-side fact — the malformed NodeId means
        // CallAsync was never even issued, so the method genuinely never ran.
        Assert.Equal(0, server.Controls.StartCycleInvokedCount);
    }

    // ─────────────────────────────────────────────────────────────────────
    // Review fix round 1 (Important #2) — IsPreInvocationCallRejection's allowlist originally covered only
    // the argument-shape codes, missing the node/method-IDENTITY codes from the SAME OPC-UA Part 4 §5.11.2
    // precondition table. Consequence: a map typo (a command/object/method name that does not resolve on the
    // real server) reported Indeterminate — "check the machine" — for a command that provably never ran.
    // ─────────────────────────────────────────────────────────────────────

    [Fact]
    public async Task InvokeCommandAsync_ObjectNodeIdUnknownToServer_ReportsFailed_NotIndeterminate_DeviceUntouched()
    {
        var pkiRoot = NewPkiRoot("call-typo-objectnodeid");
        await using var server = await OpcUaLoopbackHarness.StartWritableServerAsync(pkiRoot);

        // Parses fine (valid NodeId syntax) but does not resolve to any real node on the server — the exact
        // shape a commissioning-time map typo produces.
        var typoMap = new OpcUaNodeMap
        {
            MachineCode = "PLC-OU-CALL-TYPO-OBJECT",
            EndpointUrl = server.EndpointUrl,
            Nodes = new List<OpcUaNode> { new("ns=2;s=Speed", "speed", "rpm", new OpcUaWritableSetpoint(CommandArgumentType.Double, 0, 500)) },
            Commands = new List<OpcUaCommand>
            {
                new("start-cycle", "ns=2;s=ThisObjectDoesNotExist", "ns=2;s=StartCycle",
                    new List<CommandArgumentDeclaration> { new("speed", CommandArgumentType.UInt16, 0, 1000) }),
            },
        };
        await using var driver = new OpcUaDriver(typoMap, pkiDir: pkiRoot);

        var result = await driver.InvokeCommandAsync(
            new CommandRequest("start-cycle", new Dictionary<string, object> { ["speed"] = 10L }), CancellationToken.None);

        Assert.Equal(WriteOutcome.Failed, result.Outcome);
        Assert.Null(result.RejectionReason);
        // The load-bearing assertion: a KNOWN "no" (Failed), never Indeterminate — the server's own
        // invocation counter proves the method genuinely never ran, so telling an operator to go inspect the
        // physical machine would be pure noise.
        Assert.Equal(0, server.Controls.StartCycleInvokedCount);
    }

    [Fact]
    public async Task InvokeCommandAsync_MethodNodeIdNotAMethod_ReportsFailed_NotIndeterminate_DeviceUntouched()
    {
        var pkiRoot = NewPkiRoot("call-typo-methodnodeid");
        await using var server = await OpcUaLoopbackHarness.StartWritableServerAsync(pkiRoot);

        // "ns=2;s=Speed" is a real node — a VARIABLE, not a method — so the Call service's own precondition
        // check (is the methodId actually a callable method?) rejects this before ever invoking anything.
        var typoMap = new OpcUaNodeMap
        {
            MachineCode = "PLC-OU-CALL-TYPO-METHOD",
            EndpointUrl = server.EndpointUrl,
            Nodes = new List<OpcUaNode> { new("ns=2;s=Speed", "speed", "rpm", new OpcUaWritableSetpoint(CommandArgumentType.Double, 0, 500)) },
            Commands = new List<OpcUaCommand>
            {
                new("start-cycle", "ns=2;s=Machine", "ns=2;s=Speed",
                    new List<CommandArgumentDeclaration> { new("speed", CommandArgumentType.UInt16, 0, 1000) }),
            },
        };
        await using var driver = new OpcUaDriver(typoMap, pkiDir: pkiRoot);

        var result = await driver.InvokeCommandAsync(
            new CommandRequest("start-cycle", new Dictionary<string, object> { ["speed"] = 10L }), CancellationToken.None);

        Assert.Equal(WriteOutcome.Failed, result.Outcome);
        Assert.Null(result.RejectionReason);
        Assert.Equal(0, server.Controls.StartCycleInvokedCount);
    }

    // ─────────────────────────────────────────────────────────────────────
    // 6) A write/command that times out reports Indeterminate — and GENUINELY times out (a real loopback
    // server whose handler stalls well past the client's own configured operation-timeout bound).
    // ─────────────────────────────────────────────────────────────────────

    // Generous enough that real session setup (app-instance cert check + endpoint discovery + CreateSession)
    // on a fresh pki root never itself exceeds this bound (which would falsely attribute the timeout to
    // session setup rather than the write/call itself) — see OpcUaDriverLoopbackTests' own remarks on OPC-UA
    // session setup being slower than a bare TCP dial. MethodDelayMs is comfortably longer still.
    private const int GenuineTimeoutOperationTimeoutMs = 3000;
    private const int GenuineTimeoutServerDelayMs = 6000;

    [Fact]
    public async Task WriteSetpointAsync_DeviceNeverResponds_GenuinelyTimesOut_ReportsIndeterminate()
    {
        var pkiRoot = NewPkiRoot("write-timeout");
        await using var server = await OpcUaLoopbackHarness.StartWritableServerAsync(pkiRoot);
        await using var driver = new OpcUaDriver(
            OpcUaLoopbackHarness.BuildWritableMap("PLC-OU-WRITE-TIMEOUT", server.EndpointUrl), pkiDir: pkiRoot,
            operationTimeoutMs: GenuineTimeoutOperationTimeoutMs);

        // Prime the session BEFORE introducing the server-side delay — see the cancellation tests' own
        // remarks above for the observed flake this avoids (session establishment competing with the bound
        // under a full test-suite run's heavier concurrent load).
        var warmup = await driver.WriteSetpointAsync(new SetpointWriteRequest("speed", 1.0), CancellationToken.None);
        Assert.Equal(WriteOutcome.Applied, warmup.Outcome);
        server.Controls.MethodDelayMs = GenuineTimeoutServerDelayMs;

        var stopwatch = Stopwatch.StartNew();
        var result = await driver.WriteSetpointAsync(new SetpointWriteRequest("speed", 42.0), CancellationToken.None);
        stopwatch.Stop();

        Assert.Equal(WriteOutcome.Indeterminate, result.Outcome);
        Assert.Null(result.RejectionReason);
        Assert.Contains("did not complete", result.Detail, StringComparison.Ordinal);

        // The load-bearing assertion this test exists to make: it GENUINELY waited out the client's own
        // operation-timeout bound, not an approximation.
        Assert.True(stopwatch.Elapsed >= TimeSpan.FromMilliseconds(GenuineTimeoutOperationTimeoutMs - 200),
            $"write returned after only {stopwatch.Elapsed} — too fast to have genuinely waited out a {GenuineTimeoutOperationTimeoutMs}ms bound.");
        Assert.True(stopwatch.Elapsed < TimeSpan.FromSeconds(GenuineTimeoutOperationTimeoutMs / 1000.0 + 5),
            $"write took {stopwatch.Elapsed} — unexpectedly slow for a single bounded attempt.");

        // Let the server's own slow write handler actually finish before this test's `await using` blocks
        // tear the server/driver down — avoids a background Thread.Sleep outliving this test.
        await Task.Delay(GenuineTimeoutServerDelayMs - GenuineTimeoutOperationTimeoutMs + 500);
    }

    [Fact]
    public async Task InvokeCommandAsync_DeviceNeverResponds_GenuinelyTimesOut_ReportsIndeterminate()
    {
        var pkiRoot = NewPkiRoot("call-timeout");
        await using var server = await OpcUaLoopbackHarness.StartWritableServerAsync(pkiRoot);
        await using var driver = new OpcUaDriver(
            OpcUaLoopbackHarness.BuildWritableMap("PLC-OU-CALL-TIMEOUT", server.EndpointUrl), pkiDir: pkiRoot,
            operationTimeoutMs: GenuineTimeoutOperationTimeoutMs);

        // Prime the session first — same reasoning as the write test above.
        var warmup = await driver.InvokeCommandAsync(new CommandRequest("ping"), CancellationToken.None);
        Assert.Equal(WriteOutcome.Applied, warmup.Outcome);
        server.Controls.MethodDelayMs = GenuineTimeoutServerDelayMs;

        var stopwatch = Stopwatch.StartNew();
        var result = await driver.InvokeCommandAsync(
            new CommandRequest("start-cycle", new Dictionary<string, object> { ["speed"] = 1L }), CancellationToken.None);
        stopwatch.Stop();

        Assert.Equal(WriteOutcome.Indeterminate, result.Outcome);
        Assert.Null(result.RejectionReason);
        // A genuine service-level timeout THROWS (a ServiceResultException, BadRequestTimeout — see
        // task-5-report.md) rather than returning a Bad CallMethodResult, so this lands in the generic
        // catch, not the IsPreInvocationCallRejection branch — a DIFFERENT Detail message from the
        // "invoked-then-rejected" case above, but the SAME honesty: the exact string a NullReferenceException
        // would have destroyed if this driver had a B-4-Critical-#2-shaped bug (see the class doc comment).
        Assert.Contains("did not complete", result.Detail, StringComparison.Ordinal);
        Assert.Contains("unconfirmed", result.Detail, StringComparison.OrdinalIgnoreCase);
        Assert.Contains("start-cycle", result.Detail, StringComparison.Ordinal);

        Assert.True(stopwatch.Elapsed >= TimeSpan.FromMilliseconds(GenuineTimeoutOperationTimeoutMs - 200),
            $"call returned after only {stopwatch.Elapsed} — too fast to have genuinely waited out a {GenuineTimeoutOperationTimeoutMs}ms bound.");
        Assert.True(stopwatch.Elapsed < TimeSpan.FromSeconds(GenuineTimeoutOperationTimeoutMs / 1000.0 + 5),
            $"call took {stopwatch.Elapsed} — unexpectedly slow for a single bounded attempt.");

        // Let the server's own slow method actually finish (and increment its counter) before asserting
        // against it — this is ALSO the no-retry non-vacuous proof (section 7 below reuses this shape).
        await Task.Delay(GenuineTimeoutServerDelayMs - GenuineTimeoutOperationTimeoutMs + 500);
        Assert.Equal(1, server.Controls.StartCycleInvokedCount);
    }

    // ─────────────────────────────────────────────────────────────────────
    // 7) No implicit retry — made NON-VACUOUS: an INDEPENDENT server-side invocation counter (not this
    // driver's own return value, and not "xunit called the method once" — the exact vacuous shape a
    // reviewer caught earlier in this batch) proves exactly ONE call reached the server for one timed-out
    // command. See task-5-report.md for the mutation-testing verification performed against this test.
    // ─────────────────────────────────────────────────────────────────────

    [Fact]
    public async Task InvokeCommandAsync_OnTimeout_ExactlyOneInvocationReachesTheServer_NoRetry()
    {
        var pkiRoot = NewPkiRoot("call-noretry");
        await using var server = await OpcUaLoopbackHarness.StartWritableServerAsync(pkiRoot);
        await using var driver = new OpcUaDriver(
            OpcUaLoopbackHarness.BuildWritableMap("PLC-OU-CALL-NORETRY", server.EndpointUrl), pkiDir: pkiRoot,
            operationTimeoutMs: GenuineTimeoutOperationTimeoutMs);

        // Prime the session first — same reasoning as the timeout tests above: this test's own assertion
        // (exactly 1 invocation) depends on CallAsync genuinely being attempted within the bound, which a
        // session establishment competing with that same bound under full-suite load could otherwise defeat.
        var warmup = await driver.InvokeCommandAsync(new CommandRequest("ping"), CancellationToken.None);
        Assert.Equal(WriteOutcome.Applied, warmup.Outcome);
        server.Controls.MethodDelayMs = GenuineTimeoutServerDelayMs;

        var result = await driver.InvokeCommandAsync(
            new CommandRequest("start-cycle", new Dictionary<string, object> { ["speed"] = 1L }), CancellationToken.None);
        Assert.Equal(WriteOutcome.Indeterminate, result.Outcome);

        // Generous extra wait so a would-be second (retried) invocation has every opportunity to reach the
        // server before this test asserts against it — mirrors ModbusTcpDriverWriteTests' own idiom exactly.
        await Task.Delay(GenuineTimeoutServerDelayMs - GenuineTimeoutOperationTimeoutMs + 1000);

        Assert.Equal(1, server.Controls.StartCycleInvokedCount);
    }

    // ─────────────────────────────────────────────────────────────────────
    // 8) Cancellation unblocks a stuck write/command promptly — measured against a LONG operation-timeout
    // bound, so a failure to honour `ct` would make this test itself hang for a long time rather than
    // silently pass.
    // ─────────────────────────────────────────────────────────────────────

    [Fact]
    public async Task WriteSetpointAsync_CancelledMidFlight_UnblocksPromptly_ReportsIndeterminate()
    {
        var pkiRoot = NewPkiRoot("write-cancel");
        await using var server = await OpcUaLoopbackHarness.StartWritableServerAsync(pkiRoot);
        // Deliberately a LONG bound (30s): if cancellation did NOT promptly unblock the in-flight write,
        // this test would itself hang for ~30s rather than fail fast — the elapsed-time assertion below is
        // the actual proof, not a guess dressed up as one.
        await using var driver = new OpcUaDriver(
            OpcUaLoopbackHarness.BuildWritableMap("PLC-OU-WRITE-CANCEL", server.EndpointUrl), pkiDir: pkiRoot,
            operationTimeoutMs: 30_000);

        // Prime the session BEFORE introducing any server-side delay, so the 300ms cancellation below lands
        // inside the ACTUAL write call, never inside session establishment — which, under a full test-suite
        // run's heavier concurrent load, can itself occasionally take longer than 300ms (observed: this test
        // flaked under a full-suite run with "could not reach the device" instead, before this fix).
        var warmup = await driver.WriteSetpointAsync(new SetpointWriteRequest("speed", 1.0), CancellationToken.None);
        Assert.Equal(WriteOutcome.Applied, warmup.Outcome);

        server.Controls.MethodDelayMs = 15_000;

        using var cts = new CancellationTokenSource(TimeSpan.FromMilliseconds(300));
        var stopwatch = Stopwatch.StartNew();
        var result = await driver.WriteSetpointAsync(new SetpointWriteRequest("speed", 42.0), cts.Token);
        stopwatch.Stop();

        Assert.Equal(WriteOutcome.Indeterminate, result.Outcome);
        Assert.Contains("cancelled before a definitive response arrived", result.Detail, StringComparison.Ordinal);
        Assert.True(stopwatch.Elapsed < TimeSpan.FromSeconds(3),
            $"cancellation took {stopwatch.Elapsed} to unblock a write bounded by a 30s operation timeout — " +
            "Session.WriteAsync's own native CancellationToken support should unblock it promptly (measured " +
            "~300ms in task-5-report.md's own probe), not wait out anywhere close to the full bound.");

        await Task.Delay(15_200);
    }

    [Fact]
    public async Task InvokeCommandAsync_CancelledMidFlight_UnblocksPromptly_ReportsIndeterminate()
    {
        var pkiRoot = NewPkiRoot("call-cancel");
        await using var server = await OpcUaLoopbackHarness.StartWritableServerAsync(pkiRoot);
        await using var driver = new OpcUaDriver(
            OpcUaLoopbackHarness.BuildWritableMap("PLC-OU-CALL-CANCEL", server.EndpointUrl), pkiDir: pkiRoot,
            operationTimeoutMs: 30_000);

        // Prime the session first — same reasoning as the setpoint test above (a real, observed flake under
        // full-suite load: the 300ms cancellation firing during session establishment instead of the call).
        var warmup = await driver.InvokeCommandAsync(new CommandRequest("ping"), CancellationToken.None);
        Assert.Equal(WriteOutcome.Applied, warmup.Outcome);

        server.Controls.MethodDelayMs = 15_000;

        using var cts = new CancellationTokenSource(TimeSpan.FromMilliseconds(300));
        var stopwatch = Stopwatch.StartNew();
        var result = await driver.InvokeCommandAsync(
            new CommandRequest("start-cycle", new Dictionary<string, object> { ["speed"] = 1L }), cts.Token);
        stopwatch.Stop();

        Assert.Equal(WriteOutcome.Indeterminate, result.Outcome);
        Assert.Contains("cancelled before a definitive response arrived", result.Detail, StringComparison.Ordinal);
        Assert.Contains("unconfirmed", result.Detail, StringComparison.OrdinalIgnoreCase);
        Assert.True(stopwatch.Elapsed < TimeSpan.FromSeconds(3),
            $"cancellation took {stopwatch.Elapsed} to unblock a command bounded by a 30s operation timeout.");

        await Task.Delay(15_200);
    }

    // ─────────────────────────────────────────────────────────────────────
    // 9) DisposeAsync must never wait on an in-flight write/command, even boundedly — mirrors B-2's own
    // signed-off "HALT must never be delayed by an in-flight write" design at the FleetHost layer.
    // ─────────────────────────────────────────────────────────────────────

    [Fact]
    public async Task DisposeAsync_WhileCommandIsStuckMidFlight_ReturnsPromptly_AndTheStuckCommandObservesIndeterminate()
    {
        var pkiRoot = NewPkiRoot("call-dispose-race");
        await using var server = await OpcUaLoopbackHarness.StartWritableServerAsync(pkiRoot);
        server.Controls.MethodDelayMs = 15_000;
        var driver = new OpcUaDriver(
            OpcUaLoopbackHarness.BuildWritableMap("PLC-OU-CALL-DISPOSE", server.EndpointUrl), pkiDir: pkiRoot,
            operationTimeoutMs: 30_000);

        var commandTask = driver.InvokeCommandAsync(
            new CommandRequest("start-cycle", new Dictionary<string, object> { ["speed"] = 1L }), CancellationToken.None);
        await Task.Delay(TimeSpan.FromMilliseconds(500)); // let the call genuinely start and reach the server.

        var stopwatch = Stopwatch.StartNew();
        await driver.DisposeAsync();
        stopwatch.Stop();

        Assert.True(stopwatch.Elapsed < TimeSpan.FromSeconds(2),
            $"DisposeAsync took {stopwatch.Elapsed} while a command was still stuck mid-flight, bounded by a " +
            "30s operation timeout — disposal must never wait on an in-flight command, not even boundedly.");

        var completed = await Task.WhenAny(commandTask, Task.Delay(TimeSpan.FromSeconds(5)));
        Assert.Same(commandTask, completed);
        var result = await commandTask;
        Assert.Equal(WriteOutcome.Indeterminate, result.Outcome);

        await Task.Delay(15_200);
    }

    // ─────────────────────────────────────────────────────────────────────
    // 10) The interleaving cases. IMPORTANT, empirically-corrected finding (task-5-report.md): an EARLIER
    // version of these two tests asserted a write completes WITHOUT waiting for an in-flight poll (and vice
    // versa), reasoning from OPC-UA's RequestHandle correlation alone. That assertion was FALSE and the
    // tests caught it: the real OPC Foundation reference SERVER used here (the same stack many lightweight
    // OPC-UA servers build on) serializes ALL Read/Write/Call dispatch through one NodeManager-wide critical
    // section — verified independently with a minimal two-node repro (task-5-report.md) — so a write DOES
    // end up queued behind an in-flight poll's read AT THE SERVER, and vice versa, exactly as it would
    // behind a real PLC's own request-processing model. <see cref="OpcUaDriver"/> ITSELF adds NO additional
    // serialization of its own on top of whatever the server does (see its "Concurrency" doc-comment
    // remarks) — but this driver has no way to know, and does not need to control, how any given server
    // chooses to process concurrent requests. What actually matters — and what these tests prove — is that
    // BOTH operations complete CORRECTLY regardless of that ordering: no deadlock, no corruption, no
    // misdelivered result, which is the real safety property OPC-UA's RequestHandle correlation provides.
    // ─────────────────────────────────────────────────────────────────────

    [Fact]
    public async Task WriteWhilePollIsInFlight_BothCompleteCorrectly()
    {
        var pkiRoot = NewPkiRoot("write-mid-poll");
        await using var server = await OpcUaLoopbackHarness.StartWritableServerAsync(pkiRoot);

        var pollReadStarted = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
        server.Controls.OnCountReadStarted = () => pollReadStarted.TrySetResult();
        server.Controls.ReadDelayMs = 2000;

        await using var driver = new OpcUaDriver(
            OpcUaLoopbackHarness.BuildWritableMap("PLC-OU-WRITE-MID-POLL", server.EndpointUrl, pollIntervalMs: 30_000),
            pkiDir: pkiRoot, operationTimeoutMs: 30_000);

        using var pollCts = new CancellationTokenSource();
        DeviceReading? reading = null;
        var pollTask = Task.Run(async () =>
        {
            await foreach (var r in driver.ReadAsync(pollCts.Token))
            {
                reading = r;
                break;
            }
        });

        // Deterministic (not a wall-clock guess): wait until the poll's OWN read is genuinely in flight
        // before issuing the write, so this scenario really does exercise "a write mid-poll".
        await pollReadStarted.Task.WaitAsync(TimeSpan.FromSeconds(10));
        Assert.False(pollTask.IsCompleted, "the poll must still be mid-flight when the write below is issued.");

        // OpcUaDriver never blocks THIS call behind the poll itself — _sessionLock (see the class doc
        // comment) only guards the brief "ensure a live session" step, already satisfied by the time the
        // poll started reading, so this proceeds straight to WriteAsync. Whatever happens next (genuine
        // concurrent dispatch, or queuing behind the poll's own read at the SERVER) is safe either way.
        var writeResult = await driver.WriteSetpointAsync(new SetpointWriteRequest("speed", 77.0), CancellationToken.None);

        var pollCompleted = await Task.WhenAny(pollTask, Task.Delay(TimeSpan.FromSeconds(10))) == pollTask;

        Assert.Equal(WriteOutcome.Applied, writeResult.Outcome);
        Assert.Equal(77.0, (double)server.GetVariableValue("Speed"), precision: 10);
        Assert.True(pollCompleted, "the poll should still complete correctly even with a write racing it mid-flight.");
        Assert.NotNull(reading);

        pollCts.Cancel();
        try { await pollTask; } catch (OperationCanceledException) { }
    }

    [Fact]
    public async Task PollWhileWriteIsInFlight_BothCompleteCorrectly()
    {
        var pkiRoot = NewPkiRoot("poll-mid-write");
        await using var server = await OpcUaLoopbackHarness.StartWritableServerAsync(pkiRoot);

        var writeStarted = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
        server.Controls.OnSpeedWriteStarted = () => writeStarted.TrySetResult();
        server.Controls.MethodDelayMs = 2000;

        await using var driver = new OpcUaDriver(
            OpcUaLoopbackHarness.BuildWritableMap("PLC-OU-POLL-MID-WRITE", server.EndpointUrl, pollIntervalMs: 30_000),
            pkiDir: pkiRoot, operationTimeoutMs: 30_000);

        var writeTask = driver.WriteSetpointAsync(new SetpointWriteRequest("speed", 88.0), CancellationToken.None);

        // Deterministic: wait until the write's own request is genuinely in flight before polling.
        await writeStarted.Task.WaitAsync(TimeSpan.FromSeconds(10));
        Assert.False(writeTask.IsCompleted, "the write must still be mid-flight when the poll below runs.");

        using var pollCts = new CancellationTokenSource(TimeSpan.FromSeconds(10));
        DeviceReading? reading = null;
        await foreach (var r in driver.ReadAsync(pollCts.Token))
        {
            reading = r;
            break;
        }

        Assert.NotNull(reading);

        var writeResult = await writeTask;
        Assert.Equal(WriteOutcome.Applied, writeResult.Outcome);
        Assert.Equal(88.0, (double)server.GetVariableValue("Speed"), precision: 10);
    }

    // ─────────────────────────────────────────────────────────────────────
    // 11) "Write during reconnect" — a poll iteration and a write/command racing to independently rebuild a
    // session on a FRESHLY-constructed driver (no session yet) must not build two — _sessionLock exists
    // exactly to prevent this. Measured via the SERVER's own SessionCreated event count, not inferred.
    // ─────────────────────────────────────────────────────────────────────

    [Fact]
    public async Task ConcurrentPollAndWrite_OnFreshDriver_BuildExactlyOneSession_BothSucceed()
    {
        var pkiRoot = NewPkiRoot("write-during-reconnect");
        await using var server = await OpcUaLoopbackHarness.StartWritableServerAsync(pkiRoot);

        await using var driver = new OpcUaDriver(
            OpcUaLoopbackHarness.BuildWritableMap("PLC-OU-RECONNECT-RACE", server.EndpointUrl, pollIntervalMs: 30_000),
            pkiDir: pkiRoot);

        using var pollCts = new CancellationTokenSource();
        DeviceReading? reading = null;
        var pollTask = Task.Run(async () =>
        {
            await foreach (var r in driver.ReadAsync(pollCts.Token))
            {
                reading = r;
                break;
            }
        });

        // Issued essentially simultaneously — the driver has NO session yet, so both this write and the
        // poll's own first iteration race to call EnsureSessionAsync at roughly the same time.
        var writeTask = driver.WriteSetpointAsync(new SetpointWriteRequest("speed", 99.0), CancellationToken.None);

        var writeResult = await writeTask;
        var pollCompleted = await Task.WhenAny(pollTask, Task.Delay(TimeSpan.FromSeconds(15))) == pollTask;

        Assert.True(pollCompleted, "the poll should yield its first reading within a reasonable bound.");
        Assert.Equal(WriteOutcome.Applied, writeResult.Outcome);
        Assert.NotNull(reading);
        Assert.Equal(99.0, (double)server.GetVariableValue("Speed"), precision: 10);

        // The load-bearing assertion: EXACTLY one session was ever created, even though a poll iteration and
        // a write raced to reconnect at the same time on a driver with no session yet — _sessionLock's whole
        // reason for existing (see OpcUaDriver's own "Concurrency" doc-comment remarks).
        Assert.Equal(1, server.SessionCreatedCount);

        pollCts.Cancel();
        try { await pollTask; } catch (OperationCanceledException) { }
    }
}
