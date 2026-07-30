using System.Linq;
using System.Reflection;
using System.Runtime.CompilerServices;
using St4i.Connector.Abstractions;
using St4i.Connector.Abstractions.Models;
using Xunit;
using Xunit.Sdk;

namespace St4i.Connector.Conformance.Tests;

/// <summary>
/// Task B-7, review fix round 1 (Important) — closes the one gap the review found: everything else about the
/// applicability mechanism (<see cref="DeviceDriverConformanceSuite.FindUnwiredAndUnacknowledgedChecks"/>'s
/// <c>includeWriteChecks</c> parameter) was already proven directly, in
/// <c>WriteNegativeControlTests.WiringEnforcement_WriteChecksAreExemptWhenReadOnly_ButRequiredAndAcknowledgeableWhenWritable</c>
/// — but that test only calls the STATIC helper with an explicit <c>bool</c>. Nothing exercised the LIVE path:
/// <see cref="DeviceDriverConformanceSuite.EveryCheckIsWiredOrAcknowledged"/>'s own
/// <c>IsWriteCapableAsync</c> branch, which derives that same <c>bool</c> from
/// <c>CreateDriver() is IWritableDeviceDriver</c>. A future change to that branch (or to the reflection logic
/// it feeds) could break the enforcement without any test noticing — on a suite whose entire value
/// proposition is "silent omission cannot happen," that was the one gap worth closing.
///
/// <para>Two real harnesses, each wiring ZERO <c>[Fact]</c> checks, calling the REAL, async
/// <see cref="DeviceDriverConformanceSuite.EveryCheckIsWiredOrAcknowledged"/> method directly (never the
/// static helper) — proving BY CONSTRUCTION that the live path gates correctly in both directions:</para>
/// <list type="bullet">
/// <item><description>a WRITE-CAPABLE harness (<see cref="WriteCapableWiringNothingHarness"/>, whose
/// <c>CreateDriver()</c> returns an <see cref="IWritableDeviceDriver"/>) fails loudly, naming EVERY missing
/// <c>Write_*</c> check by name;</description></item>
/// <item><description>a READ-ONLY harness (<see cref="ReadOnlyWiringNothingHarness"/>, whose
/// <c>CreateDriver()</c> returns a plain <see cref="IDeviceDriver"/>) also fails (it wires zero READ checks
/// either — those are never exempt), but its failure message names NO <c>Write_*</c> check at
/// all.</description></item>
/// </list>
///
/// <para>Both harnesses leave <see cref="DeviceDriverConformanceSuite.IsConformanceTarget"/> at its default
/// (<see langword="true"/>) — deliberately, unlike every negative-control harness in <c>Fakes/</c> — because
/// the early-return guard that flag gates would otherwise make <c>EveryCheckIsWiredOrAcknowledged</c> a no-op,
/// defeating the entire point of this probe. Both are <see langword="internal"/> (not <see
/// langword="public"/>) and declare no <c>[Fact]</c>-attributed delegating methods of their own, so xunit's own
/// discovery — which only considers public test classes — never auto-runs their inherited
/// <c>EveryCheckIsWiredOrAcknowledged</c> as a live test in its own right; only the two <c>[Fact]</c> methods
/// below invoke it, explicitly, exactly like every other negative-control proof in this project already
/// does. Confirmed empirically: this project's own test count is unaffected beyond the two new
/// <c>[Fact]</c>s this file adds — neither harness contributes a third, auto-discovered test.</para>
/// </summary>
public sealed class Probe_ApplicabilityByConstructionTests
{
    [Fact]
    public async Task WriteCapableHarness_WiringNothing_FailsLoudly_NamingEveryMissingWriteCheck()
    {
        var harness = new WriteCapableWiringNothingHarness();

        var ex = await Record.ExceptionAsync(() => harness.EveryCheckIsWiredOrAcknowledged());

        Assert.IsAssignableFrom<XunitException>(ex);

        const string checkPrefix = "Check_";
        var declaredWriteCheckNames = typeof(DeviceDriverConformanceSuite)
            .GetMethods(BindingFlags.Public | BindingFlags.Instance | BindingFlags.DeclaredOnly)
            .Where(m => m.Name.StartsWith(checkPrefix + "Write_", StringComparison.Ordinal))
            .Select(m => m.Name[checkPrefix.Length..])
            .ToArray();

        Assert.NotEmpty(declaredWriteCheckNames); // sanity — this probe needs at least one Check_Write_* to exist.

        foreach (var name in declaredWriteCheckNames)
        {
            Assert.Contains(name, ex!.Message, StringComparison.Ordinal);
        }
    }

    [Fact]
    public async Task ReadOnlyHarness_WiringNothing_FailsForReadReasons_ButNamesNoWriteChecks()
    {
        var harness = new ReadOnlyWiringNothingHarness();

        var ex = await Record.ExceptionAsync(() => harness.EveryCheckIsWiredOrAcknowledged());

        // Fails too — a read-only driver still owes every READ check; those are never exempt. The point of
        // this test is what the failure DOESN'T name, not that it passes. Checked against the exact declared
        // Write_* names (never the bare substring "Write_") because the method's own boilerplate explanatory
        // text ALWAYS mentions "Check_Write_*" generically (see its own doc comment), regardless of whether
        // any write check is actually missing — a substring-only assertion would false-positive on that
        // fixed text every time, proving nothing about the actual missing-list content.
        Assert.IsAssignableFrom<XunitException>(ex);

        const string checkPrefix = "Check_";
        var declaredWriteCheckNames = typeof(DeviceDriverConformanceSuite)
            .GetMethods(BindingFlags.Public | BindingFlags.Instance | BindingFlags.DeclaredOnly)
            .Where(m => m.Name.StartsWith(checkPrefix + "Write_", StringComparison.Ordinal))
            .Select(m => m.Name[checkPrefix.Length..])
            .ToArray();

        Assert.NotEmpty(declaredWriteCheckNames);

        foreach (var name in declaredWriteCheckNames)
        {
            Assert.DoesNotContain(name, ex!.Message, StringComparison.Ordinal);
        }
    }
}

/// <summary>Wired to a real <see cref="IWritableDeviceDriver"/>, wiring ZERO <c>[Fact]</c> checks of its own —
/// see the class doc comment above for why <see cref="DeviceDriverConformanceSuite.IsConformanceTarget"/> is
/// deliberately left at its default (<see langword="true"/>) here, unlike every negative-control harness in
/// <c>Fakes/</c>.</summary>
internal sealed class WriteCapableWiringNothingHarness : DeviceDriverConformanceSuite
{
    protected override IDeviceDriver CreateDriver() => new InstantWritableProbeFakeDriver();

    protected override Task<IReadOnlyList<DeviceReading>> CollectReadingsAsync(
        int count, TimeSpan timeout, Action<DeviceReading>? onYielded = null) =>
        throw new NotSupportedException(
            "never called — this harness only exercises EveryCheckIsWiredOrAcknowledged's wiring reflection, never a readings-dependent check.");
}

/// <summary>The read-only mirror of <see cref="WriteCapableWiringNothingHarness"/> — wired to a plain
/// <see cref="IDeviceDriver"/> that does NOT implement <see cref="IWritableDeviceDriver"/> at all, also wiring
/// ZERO <c>[Fact]</c> checks.</summary>
internal sealed class ReadOnlyWiringNothingHarness : DeviceDriverConformanceSuite
{
    protected override IDeviceDriver CreateDriver() => new InstantReadOnlyProbeFakeDriver();

    protected override Task<IReadOnlyList<DeviceReading>> CollectReadingsAsync(
        int count, TimeSpan timeout, Action<DeviceReading>? onYielded = null) =>
        throw new NotSupportedException(
            "never called — this harness only exercises EveryCheckIsWiredOrAcknowledged's wiring reflection.");
}

/// <summary>A minimal, instantly-constructed <see cref="IWritableDeviceDriver"/> — behaviourally irrelevant
/// (this probe never invokes any <c>Check_*</c> method against it, only inspects
/// <see cref="WriteCapableWiringNothingHarness.CreateDriver"/>'s runtime TYPE), kept deliberately separate
/// from <c>Fakes/WritableFakeDriverBase.cs</c>'s own subclasses so this probe does not depend on any of their
/// specific (behaviourally meaningful) shapes.</summary>
internal sealed class InstantWritableProbeFakeDriver : IWritableDeviceDriver
{
    public string Id => "probe:writable";

    public string Kind => "probe.writable";

    public DriverHealthState Health => DriverHealthState.Down;

    public IReadOnlyList<string> WritablePoints => Array.Empty<string>();

    public IReadOnlyList<string> Commands => Array.Empty<string>();

    public async IAsyncEnumerable<DeviceReading> ReadAsync([EnumeratorCancellation] CancellationToken ct)
    {
        await Task.CompletedTask;
        yield break;
    }

    public ValueTask DisposeAsync() => ValueTask.CompletedTask;

    public Task<SetpointWriteResult> WriteSetpointAsync(SetpointWriteRequest request, CancellationToken ct) =>
        throw new NotSupportedException("never called by this probe.");

    public Task<CommandResult> InvokeCommandAsync(CommandRequest request, CancellationToken ct) =>
        throw new NotSupportedException("never called by this probe.");
}

/// <summary>A minimal, instantly-constructed, plain <see cref="IDeviceDriver"/> — deliberately does NOT
/// implement <see cref="IWritableDeviceDriver"/>, the one fact this probe's read-only half depends on.</summary>
internal sealed class InstantReadOnlyProbeFakeDriver : IDeviceDriver
{
    public string Id => "probe:read-only";

    public string Kind => "probe.read-only";

    public DriverHealthState Health => DriverHealthState.Down;

    public async IAsyncEnumerable<DeviceReading> ReadAsync([EnumeratorCancellation] CancellationToken ct)
    {
        await Task.CompletedTask;
        yield break;
    }

    public ValueTask DisposeAsync() => ValueTask.CompletedTask;
}
