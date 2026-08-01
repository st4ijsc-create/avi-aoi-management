using System.Reflection;
using St4i.Connector.Conformance.Tests.Fakes;
using Xunit;
using Xunit.Sdk;

namespace St4i.Connector.Conformance.Tests;

/// <summary>
/// GP-6 — the negative-control proof this task's brief treats as a first-class deliverable, not scaffolding:
/// for each check that has a corresponding deliberately non-conforming fake driver (see <c>Fakes/</c>), this
/// proves the check GENUINELY rejects it — i.e. the check would NOT still pass if the mechanism it claims to
/// verify were deleted from a real driver. Each test instantiates a harness wired to exactly one fake and
/// calls the ONE check method that fake violates directly (never via xunit's automatic <c>[Fact]</c>
/// discovery on the harness itself — see <see cref="DeviceDriverConformanceSuite"/>'s class doc comment for
/// why), asserting that call throws.
/// </summary>
public sealed class NegativeControlTests
{
    [Fact]
    public async Task Construction_check_rejects_a_driver_that_connects_in_its_constructor()
    {
        var harness = new ConnectsInConstructorHarness();

        var ex = await Record.ExceptionAsync(() => harness.Check_Construction_IsNonBlocking_AndPerformsNoIO());

        Assert.IsAssignableFrom<XunitException>(ex);
    }

    [Fact]
    public async Task Cancellation_check_rejects_a_driver_that_ignores_its_token()
    {
        var harness = new IgnoresCancellationHarness();

        var ex = await Record.ExceptionAsync(() => harness.Check_ReadAsync_HonoursCancellation_WhenNoDeviceIsReachable());

        Assert.IsAssignableFrom<XunitException>(ex);
    }

    [Fact]
    public async Task Reuse_check_rejects_a_driver_that_reuses_and_mutates_a_reading_instance()
    {
        var harness = new ReusesReadingInstanceHarness();

        var ex = await Record.ExceptionAsync(() => harness.Check_ReadAsync_NeverReusesOrMutatesAYieldedReading());

        Assert.IsAssignableFrom<XunitException>(ex);
    }

    [Fact]
    public async Task RoundTrip_check_rejects_a_driver_that_emits_an_out_of_domain_telemetry_value()
    {
        var harness = new EmitsOutOfDomainTelemetryHarness();

        var ex = await Record.ExceptionAsync(() => harness.Check_Telemetry_RoundTripsLosslesslyThroughConnectorJson());

        Assert.IsAssignableFrom<XunitException>(ex);
    }

    /// <summary>Proves the reuse check's SECOND mechanism (content-drift against a snapshot taken at yield
    /// time) has teeth independently of the first (top-level <c>ReferenceEquals</c>) — see
    /// <see cref="MutatesSharedTelemetryListFakeDriver"/>'s own doc comment for why a fake that only trips
    /// the first mechanism wouldn't prove this.</summary>
    [Fact]
    public async Task Reuse_check_rejects_a_driver_that_mutates_a_shared_sub_object_across_fresh_wrappers()
    {
        var harness = new MutatesSharedTelemetryListHarness();

        var ex = await Record.ExceptionAsync(() => harness.Check_ReadAsync_NeverReusesOrMutatesAYieldedReading());

        Assert.IsAssignableFrom<XunitException>(ex);
    }

    // ---- Fix round 1 (task-6-report.md) — negative controls added on review -----------------------

    /// <summary>IMPORTANT 1 — the device-backed Health check's <c>sawConnected</c> loop was dead code
    /// against both real protocol drivers (neither ever yields against <c>CreateDriver()</c>'s fast-failing
    /// target, so the loop body never ran in any previously-wired test). <see cref="ReusesReadingInstanceFakeDriver"/>
    /// is device-backed (default <c>ModelsExternalDeviceConnection</c>), reports
    /// <see cref="St4i.Connector.Abstractions.Models.DriverHealthState.Connected"/> constantly, and DOES
    /// yield readings continuously — proving the loop body actually executes.
    ///
    /// <para><b>Honesty note:</b> this fake's Health is CONSTANT, so — verified by temporarily disabling
    /// <c>sawConnected</c> and re-running — this control alone would still pass even without it (the final
    /// single-sample assertion independently catches a driver that's Connected the ENTIRE time). It proves
    /// the loop body isn't dead/no-op code, not that <c>sawConnected</c> is independently load-bearing; see
    /// <see cref="TransientlyConnectedThenDownFakeDriver"/>'s own control below for that.</para>
    /// </summary>
    [Fact]
    public async Task Health_check_rejects_a_device_backed_driver_that_reports_Connected_while_yielding_with_no_real_device()
    {
        var harness = new ReusesReadingInstanceHarness();

        var ex = await Record.ExceptionAsync(() => harness.Check_Health_OnlyTakesDocumentedValues_AndIsSaneWithNoDevice());

        Assert.IsAssignableFrom<XunitException>(ex);
    }

    /// <summary>Same proof as above, against the OTHER existing device-backed-and-yielding fake — belt and
    /// braces per the reviewer's explicit callout of both harnesses. Same honesty note applies: constant
    /// Health means this alone doesn't isolate <c>sawConnected</c> either.</summary>
    [Fact]
    public async Task Health_check_rejects_the_shared_sub_object_fake_too()
    {
        var harness = new MutatesSharedTelemetryListHarness();

        var ex = await Record.ExceptionAsync(() => harness.Check_Health_OnlyTakesDocumentedValues_AndIsSaneWithNoDevice());

        Assert.IsAssignableFrom<XunitException>(ex);
    }

    /// <summary>THE load-bearing proof for <c>sawConnected</c> specifically: <see cref="TransientlyConnectedThenDownFakeDriver"/>
    /// is Connected only for a short window, then Down for the rest of the drive — by the time the check's
    /// final single-sample assertion runs, Health is reliably NOT Connected, so THAT assertion alone would
    /// miss this violation entirely. Only <c>sawConnected</c>, checked throughout, catches it. Verified by
    /// temporarily disabling <c>sawConnected</c> and re-running: this control went from rejecting to
    /// silently passing — confirming the mechanism is genuinely, independently load-bearing, not merely
    /// redundant with the final assertion the way the two controls above are.</summary>
    [Fact]
    public async Task Health_check_rejects_a_driver_whose_Connected_report_is_purely_transient()
    {
        var harness = new TransientlyConnectedThenDownHarness();

        var ex = await Record.ExceptionAsync(() => harness.Check_Health_OnlyTakesDocumentedValues_AndIsSaneWithNoDevice());

        Assert.IsAssignableFrom<XunitException>(ex);
    }

    /// <summary>IMPORTANT 2 — proves the device-LESS Health branch's assertion is falsifiable: a driver that
    /// starts at its implicitly-claimed constant Health but DRIFTS away from it once active is rejected. A
    /// tautological before/after comparison (what this replaced) could never have caught this for a driver
    /// whose Health getter happened to be a literal constant expression — <see cref="DeviceLessDriverWithDriftingHealthFakeDriver"/>
    /// is deliberately NOT a constant getter, so this control only has teeth if the assertion is genuinely
    /// checking against an external expectation.</summary>
    [Fact]
    public async Task Health_check_rejects_a_device_less_driver_whose_health_drifts_from_its_declared_constant()
    {
        var harness = new DeviceLessDriverWithDriftingHealthHarness();

        var ex = await Record.ExceptionAsync(() => harness.Check_Health_OnlyTakesDocumentedValues_AndIsSaneWithNoDevice());

        Assert.IsAssignableFrom<XunitException>(ex);
    }

    /// <summary>Cheap fold (task-6-report.md "Fix round 1") — <c>Check_Construction_IsNonBlocking_AndPerformsNoIO</c>
    /// previously measured only elapsed time, so a constructor that established a connection FAST would pass.
    /// <see cref="ReusesReadingInstanceFakeDriver"/> reports
    /// <see cref="St4i.Connector.Abstractions.Models.DriverHealthState.Connected"/> from the instant it is
    /// constructed (no sleep, so the timing assertion alone would pass) — proving the added
    /// Health-immediately-after-construction proxy assertion has independent teeth.</summary>
    [Fact]
    public async Task Construction_check_rejects_a_driver_that_reports_Connected_immediately_without_ever_actually_connecting()
    {
        var harness = new ReusesReadingInstanceHarness();

        var ex = await Record.ExceptionAsync(() => harness.Check_Construction_IsNonBlocking_AndPerformsNoIO());

        Assert.IsAssignableFrom<XunitException>(ex);
    }

    /// <summary>IMPORTANT 3 — proves <see cref="DeviceDriverConformanceSuite.FindUnwiredAndUnacknowledgedChecks"/>
    /// (the reflection logic backing <see cref="DeviceDriverConformanceSuite.EveryCheckIsWiredOrAcknowledged"/>)
    /// genuinely detects silent omission, and that acknowledging suppresses it — WITHOUT instantiating a
    /// "live", xunit-auto-discoverable, deliberately-incomplete conformance class (which would itself become
    /// a permanently-failing test the moment xunit discovered it; see
    /// <see cref="DeviceDriverConformanceSuite.IsConformanceTarget"/>'s own doc comment). Reuses
    /// <see cref="ConnectsInConstructorHarness"/> as the "incomplete" type under test purely for its shape
    /// (zero <c>[Fact]</c> methods of its own) — this call never actually runs any check against its fake,
    /// it only inspects the harness TYPE's own method metadata.</summary>
    [Fact]
    public void WiringEnforcement_FlagsAHarnessThatWiresNothing_AndAcknowledgingEveryNameClearsIt()
    {
        var declaredCheckCount = typeof(DeviceDriverConformanceSuite)
            .GetMethods(BindingFlags.Public | BindingFlags.Instance | BindingFlags.DeclaredOnly)
            .Count(m => m.Name.StartsWith("Check_", StringComparison.Ordinal));

        var allMissing = DeviceDriverConformanceSuite.FindUnwiredAndUnacknowledgedChecks(
            typeof(ConnectsInConstructorHarness), Array.Empty<string>());

        Assert.Equal(declaredCheckCount, allMissing.Count);

        var noneMissing = DeviceDriverConformanceSuite.FindUnwiredAndUnacknowledgedChecks(
            typeof(ConnectsInConstructorHarness), allMissing);

        Assert.Empty(noneMissing);
    }
}
