using System.Linq;
using St4i.Connector.Conformance.Tests.Fakes;
using Xunit;
using Xunit.Sdk;

namespace St4i.Connector.Conformance.Tests;

/// <summary>
/// Task B-7 (.superpowers/sdd/2026-07-29-dotB-machine-control-blueprint/task-7-brief.md) — the write-contract
/// mirror of <see cref="NegativeControlTests"/>: for each new <c>Check_Write_*</c> method, a deliberately
/// non-conforming fake driver (see <c>Fakes/WritableFakeDrivers.cs</c>) proves the check GENUINELY rejects it,
/// never incidentally caught by some other check. Same discipline as the read-side file: each test
/// instantiates a harness wired to exactly one fake and calls the ONE check method that fake violates
/// directly (never via xunit's automatic <c>[Fact]</c> discovery — see
/// <see cref="DeviceDriverConformanceSuite"/>'s class doc comment), asserting that call throws.
/// </summary>
public sealed class WriteNegativeControlTests
{
    [Fact]
    public async Task TimedOut_check_rejects_a_driver_that_throws_instead_of_returning_Indeterminate()
    {
        var harness = new ThrowsOnTimeoutWritableHarness();

        var ex = await Record.ExceptionAsync(() => harness.Check_Write_TimedOutWriteOrCommand_ReturnsIndeterminate_NeverThrows());

        Assert.IsAssignableFrom<XunitException>(ex);
    }

    [Fact]
    public async Task Detail_check_rejects_a_driver_that_returns_the_same_canned_Detail_for_every_cause()
    {
        var harness = new AlwaysSameDetailWritableHarness();

        var ex = await Record.ExceptionAsync(() => harness.Check_Write_Indeterminate_DetailIsNonEmpty_AndDistinguishesDistinctCauses());

        Assert.IsAssignableFrom<XunitException>(ex);
    }

    [Fact]
    public async Task NoRetry_check_rejects_a_driver_whose_transport_silently_retries()
    {
        var harness = new RetriesCommandOnTimeoutWritableHarness();

        var ex = await Record.ExceptionAsync(() => harness.Check_Write_NoImplicitRetry_ExactlyOneCommandAttemptReachesTheDeviceOnTimeout());

        Assert.IsAssignableFrom<XunitException>(ex);
    }

    [Fact]
    public async Task Namespaces_check_rejects_a_driver_that_accepts_a_commands_name_as_a_point()
    {
        var harness = new ConflatesSetpointAndCommandNamespacesHarness();

        var ex = await Record.ExceptionAsync(() => harness.Check_Write_SetpointAndCommandNamespaces_AreDistinct());

        Assert.IsAssignableFrom<XunitException>(ex);
    }

    [Fact]
    public async Task UnknownPointOrCommand_check_rejects_a_driver_that_accepts_anything()
    {
        var harness = new AcceptsUnknownPointOrCommandHarness();

        var ex = await Record.ExceptionAsync(() => harness.Check_Write_UnknownPointOrCommand_RejectedWithoutTouchingDevice());

        Assert.IsAssignableFrom<XunitException>(ex);
    }

    [Fact]
    public async Task CapabilityLists_check_rejects_a_driver_that_hands_out_the_raw_mutable_list()
    {
        var harness = new MutableCapabilityListHarness();

        var ex = await Record.ExceptionAsync(() => harness.Check_Write_CapabilityLists_AreEffectivelyImmutable());

        Assert.IsAssignableFrom<XunitException>(ex);
    }

    [Fact]
    public async Task Cancellation_check_rejects_a_driver_that_ignores_its_token_on_a_write()
    {
        var harness = new IgnoresCancellationOnWriteHarness();

        var ex = await Record.ExceptionAsync(() => harness.Check_Write_Cancellation_HonouredPromptly_EvenAgainstAnUnresponsiveDevice());

        Assert.IsAssignableFrom<XunitException>(ex);
    }

    [Fact]
    public async Task RoundTrip_check_rejects_a_driver_that_emits_a_result_that_silently_mangles_on_round_trip()
    {
        var harness = new EmitsUnserializableWriteResultHarness();

        var ex = await Record.ExceptionAsync(() => harness.Check_Write_RoundTripsLosslesslyThroughConnectorJson());

        Assert.IsAssignableFrom<XunitException>(ex);
    }

    // ---- applicability mechanism: "not a gap" for a read-only driver, still required for a writable one ----

    /// <summary>Proves <see cref="DeviceDriverConformanceSuite.FindUnwiredAndUnacknowledgedChecks"/>'s
    /// <c>includeWriteChecks</c> parameter — the applicability mechanism itself — behaves exactly as
    /// documented: for a driver evaluated as READ-ONLY, no <c>Check_Write_*</c> name is ever reported missing
    /// (a first-class, silent, correct "this driver does not write" — never something requiring an
    /// <c>AcknowledgedGaps</c> entry); for the SAME harness evaluated as WRITABLE, every single one of them is
    /// reported missing (it wires none), and acknowledging every reported name clears them — the identical
    /// "acknowledging suppresses it" proof <c>NegativeControlTests.WiringEnforcement_...</c> already gives the
    /// read side, extended to prove the write side's applicability gate has real teeth in BOTH directions.
    /// Reuses <see cref="ConnectsInConstructorHarness"/> purely for its reflection shape (zero <c>[Fact]</c>
    /// methods), exactly like that existing test does — never instantiated as a live, xunit-discoverable,
    /// deliberately-incomplete conformance class.</summary>
    [Fact]
    public void WiringEnforcement_WriteChecksAreExemptWhenReadOnly_ButRequiredAndAcknowledgeableWhenWritable()
    {
        var declaredWriteCheckCount = typeof(DeviceDriverConformanceSuite)
            .GetMethods(System.Reflection.BindingFlags.Public | System.Reflection.BindingFlags.Instance | System.Reflection.BindingFlags.DeclaredOnly)
            .Count(m => m.Name.StartsWith("Check_Write_", StringComparison.Ordinal));

        Assert.True(declaredWriteCheckCount > 0, "sanity — this suite must declare at least one Check_Write_* method for this test to mean anything.");

        // Evaluated as READ-ONLY: a harness wiring NOTHING at all still reports zero Write_* names missing.
        var missingReadOnly = DeviceDriverConformanceSuite.FindUnwiredAndUnacknowledgedChecks(
            typeof(ConnectsInConstructorHarness), Array.Empty<string>(), includeWriteChecks: false);
        Assert.DoesNotContain(missingReadOnly, n => n.StartsWith("Write_", StringComparison.Ordinal));

        // The IDENTICAL harness type, evaluated as WRITABLE: every Check_Write_* now shows up as missing.
        var missingWritable = DeviceDriverConformanceSuite.FindUnwiredAndUnacknowledgedChecks(
            typeof(ConnectsInConstructorHarness), Array.Empty<string>(), includeWriteChecks: true);
        var missingWriteNames = missingWritable.Where(n => n.StartsWith("Write_", StringComparison.Ordinal)).ToArray();
        Assert.Equal(declaredWriteCheckCount, missingWriteNames.Length);

        // Acknowledging every missing write-check name clears them — same suppression proof as the read side.
        var stillMissing = DeviceDriverConformanceSuite.FindUnwiredAndUnacknowledgedChecks(
            typeof(ConnectsInConstructorHarness), missingWriteNames, includeWriteChecks: true);
        Assert.DoesNotContain(stillMissing, n => n.StartsWith("Write_", StringComparison.Ordinal));
    }
}
