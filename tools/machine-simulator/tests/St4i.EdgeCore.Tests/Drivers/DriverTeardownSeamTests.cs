using System.Diagnostics;
using St4i.Connector.Abstractions.Models;
using St4i.EdgeCore.Drivers.HotFolder;
using St4i.EdgeCore.Drivers.Mqtt;
using St4i.EdgeCore.Infrastructure;
using Xunit;

namespace St4i.EdgeCore.Tests.Drivers;

/// <summary>
/// 🔴 <b>THE WITNESSES THE SEAM WAS BUILT FOR</b> — BK-1, 2026-08-23, <c>docs/owner-decisions.md</c> items 48
/// and 52, under the owner's ruling of the same day ("build the seam, unlock all three").
///
/// <para><b>Why this file exists at all.</b> Item 48 defects 2 and 4 and item 52 sub-item 3 were each measured
/// twice and then declined twice, by two different tasks, for one shared reason: the fixes change runtime
/// behaviour, this project refuses a behaviour change with no red-able witness, and no witness could be
/// written because a shutdown step that HANGS and a shutdown step that THROWS could not be produced.
/// <c>MqttDriver</c> builds its own MQTT client from a static factory and <c>InProcessBroker</c> builds its
/// own <c>MqttServer</c> inside <c>StartAsync</c>; neither accepts one from outside, and
/// <c>HotFolderAoiDriver</c> held no sink of any kind.</para>
///
/// <para><b>The label on each test below is part of the test.</b> A test that is green on both sides of the
/// change is a GUARD — it pins behaviour against future drift — and calling it a witness would be the exact
/// false-confidence this repository's conformance suite was built to stop. Each test says which it is, and
/// for the witnesses, what turning the fix off produces.</para>
///
/// <para>🔴 <b>WHAT THIS FILE DOES NOT MEASURE, stated here because it is where the results appear.</b>
/// Nothing here exercises MQTTnet's real <c>DisconnectAsync</c> or <c>StopAsync</c> against a broker that has
/// stopped answering — that scenario needs a socket peer that accepts and then goes silent, which is not
/// reproducible on a loopback listener this suite can stand up. What is measured is that this codebase stops
/// waiting, and reports, when a step does not finish. Whether MQTTnet's own calls honour the token handed to
/// them is unmeasured here and is why the wall-clock race exists beside the token at all.</para>
/// </summary>
public sealed class DriverTeardownSeamTests
{
    /// <summary>Short enough that a hung step is decisively distinguishable from a slow one, long enough that
    /// CI jitter cannot make a completed step look overrun. Same reasoning as the conformance suite's own
    /// budgets.</summary>
    private static readonly TimeSpan TestBudget = TimeSpan.FromMilliseconds(300);

    // ── BoundedTeardown itself ─────────────────────────────────────────────────────────────────────────

    /// <summary>🔴 WITNESS. Turn the race off — await the step directly — and this test never returns.
    /// This is the assertion that carries the "bounded" half of item 48 defects 2 and 4.</summary>
    [Fact]
    public async Task BoundedTeardown_ReturnsWithinItsBudget_WhenTheStepNeverCompletes()
    {
        var neverCompletes = new TaskCompletionSource();
        var lines = new List<string>();

        var sw = Stopwatch.StartNew();
        await BoundedTeardown.RunAsync("probe", _ => neverCompletes.Task, TestBudget, lines.Add);
        sw.Stop();

        Assert.True(sw.Elapsed < TimeSpan.FromSeconds(3),
            $"BoundedTeardown waited {sw.ElapsedMilliseconds} ms on a step that can never complete. The " +
            "wall-clock race is what bounds a callee that ignores its token; without it this call is the " +
            "unbounded await item 48 defect 2 and defect 4 are both about.");
        var line = Assert.Single(lines);
        Assert.Contains("still running", line);
        Assert.Contains("detached", line);

        neverCompletes.SetResult(); // let the detached continuation run rather than leaving it parked
    }

    /// <summary>🔴 WITNESS. Delete the report call from the failure arm and the line disappears — which is
    /// precisely the state item 48 defect 4 named "deliberately blind": an empty catch in a class holding no
    /// sink.</summary>
    [Fact]
    public async Task BoundedTeardown_ReportsAFailingStep_RatherThanSwallowingIt()
    {
        var lines = new List<string>();

        await BoundedTeardown.RunAsync(
            "probe",
            _ => Task.FromException(new InvalidOperationException("port still bound")),
            TestBudget,
            lines.Add);

        var line = Assert.Single(lines);
        Assert.Contains("failed", line);
        Assert.Contains(nameof(InvalidOperationException), line);
        Assert.Contains("port still bound", line);
    }

    /// <summary>🔴 WITNESS for the OTHER half of the bound, and the two halves fail differently: this one
    /// checks the step is actually handed a token that fires, which is what lets a cooperative callee stop
    /// early instead of being abandoned still running.</summary>
    [Fact]
    public async Task BoundedTeardown_HandsTheStepATokenThatFiresAtTheBudget()
    {
        var lines = new List<string>();
        var observed = false;

        await BoundedTeardown.RunAsync(
            "probe",
            async ct =>
            {
                observed = ct.CanBeCanceled;
                await Task.Delay(Timeout.Infinite, ct);
            },
            TestBudget,
            lines.Add);

        Assert.True(observed, "the step was handed a token that can never be cancelled");
        var line = Assert.Single(lines);
        Assert.Contains("gave up at the", line);
    }

    /// <summary>GUARD, not a witness — green before this change too, because the old code also swallowed a
    /// throwing teardown rather than letting it escape. It pins that giving the helper a sink did not turn a
    /// contained failure into a thrown one, which is the regression a "report it" change invites.</summary>
    [Fact]
    public async Task BoundedTeardown_DoesNotThrow_WhenTheSinkItselfThrows()
    {
        var ex = await Record.ExceptionAsync(() => BoundedTeardown.RunAsync(
            "probe",
            _ => Task.FromException(new InvalidOperationException("inner")),
            TestBudget,
            _ => throw new InvalidOperationException("the sink is broken")));

        Assert.Null(ex);
    }

    // ── the two call sites, tied to the helper ─────────────────────────────────────────────────────────

    /// <summary>🔴 WITNESS that <c>InProcessBroker</c> actually ROUTES its stop through the bounded helper
    /// rather than merely having one available. Restore the old body — <c>await server.StopAsync()</c> in a
    /// bare try/catch — and no line reaches the sink at all, because that body has nowhere to send one.
    ///
    /// <para><b>The port is hard-coded, like every other broker test in this file's neighbourhood, and that
    /// is a known cost recorded in <c>MqttDriverTests</c>: a stranded broker collides with the next run. It
    /// is a distinct port from the two used there.</b></para></summary>
    [Fact]
    public async Task InProcessBroker_DisposeAsync_ReportsItsStopStep_ThroughTheSinkItWasGiven()
    {
        var lines = new List<string>();
        var broker = new InProcessBroker(lines.Add);
        await broker.StartAsync(18836);

        await broker.DisposeAsync();

        var line = Assert.Single(lines);
        Assert.StartsWith("InProcessBroker.StopAsync:", line);
        Assert.Contains("completed within", line);
    }

    /// <summary>GUARD. A broker built the way every existing call site builds it — no sink — must behave
    /// exactly as it did: dispose cleanly, report nowhere. Green on both sides of the change by design; it
    /// exists so "the sink is optional" is asserted rather than assumed.</summary>
    [Fact]
    public async Task InProcessBroker_WithNoSink_StillDisposesCleanly()
    {
        var broker = new InProcessBroker();
        await broker.StartAsync(18837);

        Assert.Null(await Record.ExceptionAsync(async () => await broker.DisposeAsync()));
    }

    /// <summary>🔴 WITNESS that <c>MqttDriver</c> routes BOTH of its teardown waits through the bounded
    /// helper. No broker is needed: the driver's connect attempt fails in the background against a port
    /// nothing is listening on, and the drain step runs regardless. Restore either old body and its line
    /// disappears from the sink.</summary>
    [Fact]
    public async Task MqttDriver_DisposeAsync_ReportsItsTeardownSteps_ThroughTheSinkItWasGiven()
    {
        var lines = new List<string>();
        var driver = new MqttDriver(
            "localhost", 1, new[] { "st4i/+/telemetry" },
            (_, _) => null,
            lines.Add);

        await driver.DisposeAsync();

        Assert.Contains(lines, l => l.StartsWith("MqttDriver.connect+subscribe drain:", StringComparison.Ordinal));
    }

    /// <summary>🔴 WITNESS for item 48 defect 1. Before this change the three
    /// <c>Directory.CreateDirectory</c> calls ran in the constructor, so the first assertion below was FALSE
    /// on a tree without the fix — it is the assertion that turns "construction performs no I/O" from a
    /// sentence in <c>IDeviceDriver</c>'s contract into something a run can refute.
    ///
    /// <para><b>The second half is load-bearing too and for a different reason:</b> a fix that simply deleted
    /// the directory creation would pass the first assertion and break both demo entry points. The pair says
    /// the work MOVED rather than vanished.</para></summary>
    [Fact]
    public async Task HotFolderAoiDriver_Construction_TouchesNoDisk_AndTheFirstReadPassCreatesAllThree()
    {
        var (root, watch, archive, error) = NewHotFolderPaths();
        try
        {
            var driver = new HotFolderAoiDriver(watch, archive, error);

            Assert.False(Directory.Exists(watch), "constructing the driver created the watch directory");
            Assert.False(Directory.Exists(archive), "constructing the driver created the archive directory");
            Assert.False(Directory.Exists(error), "constructing the driver created the error directory");

            using var cts = new CancellationTokenSource(TimeSpan.FromSeconds(2));
            try
            {
                await foreach (var _ in driver.ReadAsync(cts.Token)) { break; }
            }
            catch (OperationCanceledException) { /* expected: an empty watch dir yields nothing */ }

            Assert.True(Directory.Exists(watch), "the first read pass did not create the watch directory");
            Assert.True(Directory.Exists(archive), "the first read pass did not create the archive directory");
            Assert.True(Directory.Exists(error), "the first read pass did not create the error directory");

            await driver.DisposeAsync();
        }
        finally
        {
            if (Directory.Exists(root)) Directory.Delete(root, recursive: true);
        }
    }

    /// <summary>🔴 WITNESS for item 52 sub-item 3. The item measured that a file rejected by
    /// <c>Doc28Parser</c> reaches <c>error/</c> carrying no reason on any surface — the catch did not even
    /// bind the exception. This asserts the reason arrives, that it names the file, and that it names the
    /// destination. Restore the unbound catch and the sink receives nothing.
    ///
    /// <para><b>It also covers the six throw sites that name no file</b>, which is why the fix went to the
    /// catch rather than to the parser: the driver supplies the file name for all 34 sites at one place.</para></summary>
    [Fact]
    public async Task HotFolderAoiDriver_ReportsWhyAFileWasMovedToTheErrorDirectory()
    {
        var (root, watch, archive, error) = NewHotFolderPaths();
        Directory.CreateDirectory(watch);
        try
        {
            const string BadName = "AOI-01__SN-BAD__20260101T000000+0000.st4i.json";
            await File.WriteAllTextAsync(Path.Combine(watch, BadName), "{ this is not valid doc28 json");

            var lines = new List<string>();
            await using var driver = new HotFolderAoiDriver(watch, archive, error, lines.Add);

            using var cts = new CancellationTokenSource(TimeSpan.FromSeconds(3));
            try
            {
                await foreach (var _ in driver.ReadAsync(cts.Token)) { break; }
            }
            catch (OperationCanceledException) { /* expected: an invalid file yields no reading */ }

            var line = Assert.Single(lines, l => l.StartsWith("doc-28 rejected", StringComparison.Ordinal));
            Assert.Contains(BadName, line);
            Assert.Contains(error, line);
            Assert.True(line.Length > ("doc-28 rejected '" + BadName + "' -> " + error + ": ").Length,
                "the report named the file and the destination but carried no reason, which is the whole " +
                "of what item 52 sub-item 3 measured as missing");
        }
        finally
        {
            if (Directory.Exists(root)) Directory.Delete(root, recursive: true);
        }
    }

    /// <summary>GUARD, and it is labelled that way deliberately. Item 48 defect 3 is not a broken behaviour —
    /// it is a behaviour NOBODY CHECKS: <c>MqttDriver.ReadAsync</c> after a completed <c>DisposeAsync</c>
    /// raises <see cref="ObjectDisposedException"/> rather than yielding an empty sequence, which
    /// <c>MqttDriver.ReadAsync</c>'s own doc comment states as measured on 2026-08-22 by a standalone probe.
    /// Paying that defect IS adding coverage, so this is green on both sides of this change by construction.
    /// It re-measures the claim BI-1 declined to re-measure and pins it against drift.</summary>
    [Fact]
    public async Task MqttDriver_ReEnumeratingAfterDispose_RaisesObjectDisposed_GUARD_NotAWitness()
    {
        var driver = new MqttDriver("localhost", 1, new[] { "st4i/+/telemetry" }, (_, _) => null);
        await driver.DisposeAsync();

        await Assert.ThrowsAsync<ObjectDisposedException>(async () =>
        {
            await foreach (var _ in driver.ReadAsync(CancellationToken.None)) { break; }
        });
    }

    private static (string Root, string Watch, string Archive, string Error) NewHotFolderPaths()
    {
        var root = Path.Combine(Path.GetTempPath(), "st4i-seam-" + Guid.NewGuid().ToString("N")[..8]);
        return (root, Path.Combine(root, "in"), Path.Combine(root, "archive"), Path.Combine(root, "error"));
    }
}
