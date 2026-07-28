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
}
