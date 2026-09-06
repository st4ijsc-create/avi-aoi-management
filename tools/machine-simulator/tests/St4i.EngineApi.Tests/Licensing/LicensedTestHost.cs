using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;
using St4i.EdgeCore.Licensing;
using LicenseGate = St4i.EngineApi.Licensing.LicenseGate;

namespace St4i.EngineApi.Tests.Licensing;

/// <summary>
/// 🔴 WS-E — boots a <see cref="WebApplicationFactory{Program}"/> whose <see cref="LicenseGate"/> reports a
/// fully entitled machine, for the suites that exercise the PAID surface.
///
/// <para><b>Why this exists, stated plainly rather than buried.</b> WS-E gated the HMI authoring writes
/// and the Line command route behind a licence. Three pre-existing suites —
/// <c>HmiModelEndpointsTests</c>, <c>HmiModelEventsTests</c> and <c>LineEndpointsTests</c> — exercise
/// exactly those routes, and they boot a bare host with no licence file, so every one of their writes
/// began answering <c>403 LICENSE_REQUIRED</c>. That is the GATE WORKING. It is not a reason to weaken the
/// gate, and it is not a reason to change what those suites assert: each of them is about whether a PUT
/// validates, normalises, emits an event or refuses with a 409, and none of them is about licensing.</para>
///
/// <para><b>What was rejected, and why.</b> An <c>ST4I_LICENSE_DISABLED</c>-style escape hatch would have
/// fixed all three suites in one line — and would have shipped a documented licence bypass inside the
/// revenue mechanism, readable by anyone with the binary. A test-only <c>#if</c> would be the same hole
/// with a worse audit trail. What this helper does instead is make the test host resemble the deployment
/// those suites are actually about: a LICENSED machine, which is what a customer running the HMI builder
/// has. The unlicensed case is not thereby untested — <c>LicenseReadPathTests</c> boots the same routes
/// with an EXPIRED and a MISSING gate and asserts the 403, and <c>HmiModelWiringTests</c> keeps booting a
/// genuinely unlicensed host and asserting the capabilities response.</para>
///
/// <para>🔴 <b>This helper can only ever GRANT.</b> It has no parameter for a restricted licence, so it
/// cannot be reached for by a future author trying to make a licence test pass — a licence test must build
/// its own gate and say what state it is testing. Nothing here touches the verifier, the fingerprint or
/// the clock: it replaces the evaluated RESULT, which is the seam a test may honestly move.</para>
/// </summary>
internal static class LicensedTestHost
{
    /// <summary>
    /// A <see cref="LicenseGate"/> reporting a valid, perpetual, fully entitled licence.
    /// </summary>
    /// <returns>The gate.</returns>
    public static LicenseGate FullyEntitledGate() =>
        new(new LicenseEvaluation(
            LicenseState.Valid,
            new LicensePayload(
                V: 1,
                LicenseId: "ST4I-TEST-HOST",
                Customer: "Test Host",
                Edition: "Site-Connected",
                Features: null,
                Fingerprint: null,
                FingerprintPolicy: null,
                IssuedAtUtc: DateTimeOffset.UnixEpoch,
                NotBeforeUtc: DateTimeOffset.UnixEpoch,
                ExpiresAtUtc: null,
                GraceDays: 30,
                Seats: 1,
                Notes: "test host"),
            LicenseFeatures.SiteConnected,
            Diagnostic: null,
            ObservedFingerprint: null,
            FingerprintMatches: 4,
            IdentityWasRegenerated: false,
            EvaluatedAtUtc: DateTimeOffset.UnixEpoch));

    /// <summary>
    /// Builds a factory whose licence gate is fully entitled. Every other service is exactly what the real
    /// composition root produces.
    /// </summary>
    /// <returns>The factory. The caller owns its lifetime and must force <c>.Server</c> itself while any
    /// environment overrides it needs are still live.</returns>
    public static WebApplicationFactory<Program> Create() =>
        new WebApplicationFactory<Program>().WithWebHostBuilder(builder =>
            builder.ConfigureServices(services =>
            {
                services.RemoveAll<LicenseGate>();
                services.AddSingleton(FullyEntitledGate());
            }));
}
