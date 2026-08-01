using System.Security.Cryptography;
using System.Security.Cryptography.X509Certificates;
using Makaretu.Dns;
using St4i.EdgeCore.Identity;
using St4i.EdgeCore.Uns;
using St4i.EngineApi.Site;
using Xunit;

namespace St4i.EngineApi.Tests.Site;

/// <summary>
/// GĐ3 closeout WI-1 Part B (<c>.superpowers/sdd/2026-07-28-giaidoan3-ws-i-closeout-blueprint/task-1-brief.md</c>)
/// — <see cref="SiteAdvertiser"/>: the machine's own mDNS advertise direction (<c>_st4i-machine._tcp</c>),
/// the mirror image of <see cref="SiteDiscoveryTests"/>'s browse-only <see cref="SiteDiscovery"/>.
///
/// <para><b>Why <c>[Collection("St4i.EngineApi.Tests.Site")]</c> (same as <c>SiteDiscoveryTests</c>), not
/// <see cref="St4i.EngineApi.Tests.Auth.SecurityEnvVarTests"/>'s collection — fix round 1:</b>
/// <see cref="LoopbackRoundTrip_Advertised_IsDiscoveredBySiteDiscovery"/> now toggles the SAME
/// process-wide static <see cref="MulticastService.IncludeLoopbackInterfaces"/> flag
/// <c>SiteDiscoveryTests.LoopbackRoundTrip_AdvertisedInstance_IsDiscovered</c> does, for the SAME ~4+
/// second duration each — sharing THIS class' collection with that test is what prevents the two from ever
/// racing that mutation (xUnit never runs two classes in the same collection concurrently). This is a
/// direct, necessary consequence of applying that precaution (see the loopback test's own doc comment
/// below) — leaving it in a DIFFERENT collection from <c>SiteDiscoveryTests</c> would have reintroduced
/// exactly the kind of cross-test flake this task's own brief warns about.
/// <see cref="Start_WhenAdvertiseEnvVarIsZero_NeverAdvertises"/> still mutates the real process-wide
/// <c>ST4I_MDNS_ADVERTISE</c> env var — a class can only carry ONE <c>[Collection]</c> tag, so this
/// deliberately accepts NOT sharing <see cref="St4i.EngineApi.Tests.Auth.SecurityEnvVarTests.CollectionName"/>
/// with the twelve <c>WebApplicationFactory&lt;Program&gt;</c>-building classes that also read this var.
/// That residual window is already narrow (env var set → one synchronous, no-I/O <c>Start()</c> call that
/// short-circuits immediately when disabled → immediate restore) and, separately, was already NOT a hard
/// guarantee for this specific var even under that other collection: <c>SiteAdvertiser.StartAsync</c>
/// defers its real <c>Start()</c> call to <c>IHostApplicationLifetime.ApplicationStarted</c> via
/// <c>Task.Run</c> (an intentional, reviewed startup-latency fix), so a factory-building test's own env-var
/// restore can already race that ASYNCHRONOUS continuation regardless of which collection this class is
/// in.</para>
///
/// <para><b>Never-throws, environment-independent by design:</b>
/// <see cref="Start_CalledTwice_IsHarmlessAndIdempotent"/> deliberately does NOT assert
/// <see cref="ISiteAdvertiser.IsAdvertising"/> is <see langword="true"/> after <c>Start()</c> — only that
/// two calls never throw and leave <c>IsAdvertising</c> in the SAME state, whichever that state turns out
/// to be in whatever sandbox/CI runner executes this suite (mirrors this project's existing tolerance for
/// environments with no usable multicast-capable interface — see <c>SiteDiscoveryTests</c>' own doc
/// comment). Only the loopback round-trip test below asserts genuine delivery, with its own soft-skip.</para>
/// </summary>
[Collection("St4i.EngineApi.Tests.Site")]
public sealed class SiteAdvertiserTests : IDisposable
{
    private readonly List<string> _tempDirs = new();

    public void Dispose()
    {
        foreach (var dir in _tempDirs)
        {
            try { Directory.Delete(dir, recursive: true); } catch { /* best-effort cleanup */ }
        }
    }

    private string NewTempDir()
    {
        var dir = Directory.CreateTempSubdirectory("st4i-siteadvertiser-tests-").FullName;
        _tempDirs.Add(dir);
        return dir;
    }

    private static DeviceIdentity NewIdentity(string nodeId, string fingerprint)
    {
        using var ecdsa = ECDsa.Create(ECCurve.NamedCurves.nistP256);
        var request = new CertificateRequest($"CN={nodeId}", ecdsa, HashAlgorithmName.SHA256);
        var cert = request.CreateSelfSigned(DateTimeOffset.UtcNow.AddDays(-1), DateTimeOffset.UtcNow.AddYears(1));
        return new DeviceIdentity(cert, cert.ExportCertificatePem(), fingerprint, nodeId);
    }

    /// <summary>GĐ3 closeout WI-4 fix round 1 — <see cref="SiteAdvertiser"/> now takes a
    /// <see cref="DeviceIdentityProvider"/> instead of a plain <see cref="DeviceIdentity"/>. The wrapping
    /// <see cref="DeviceIdentityStore"/> here is only ever used to satisfy the provider's constructor — none
    /// of these tests call <see cref="DeviceIdentityProvider.Rotate"/>, so it never touches the throwaway
    /// temp directory beyond the ACL/directory-creation the store's own ctor always does.</summary>
    private DeviceIdentityProvider NewIdentityProvider(string nodeId, string fingerprint)
    {
        var identity = NewIdentity(nodeId, fingerprint);
        var store = new DeviceIdentityStore(NewTempDir());
        return new DeviceIdentityProvider(store, identity);
    }

    private static Func<IReadOnlyCollection<string>?> Bound(params string[] addresses) => () => addresses;

    private static Func<IReadOnlyCollection<string>?> Unbound() => () => null;

    private static string UniqueServiceType(string suffix) =>
        "_st4i-machine-test-" + suffix + "-" + Guid.NewGuid().ToString("N")[..8] + "._tcp";

    // ─────────────────────────────────────────────────────────────────────
    // TXT records built from UnsOptions + DeviceIdentity.
    // ─────────────────────────────────────────────────────────────────────

    [Fact]
    public void BuildTxtRecords_ReflectsUnsOptionsAndIdentity()
    {
        var identity = NewIdentity("cell-a1", "FINGERPRINT123");
        var unsOptions = new UnsOptions { Site = "plant1", Area = "line3", Line = "cellA", Cell = "cell-a1" };

        var txt = SiteAdvertiser.BuildTxtRecords(unsOptions, identity);

        Assert.Equal("cell-a1", txt["node"]);
        Assert.Equal("FINGERPRINT123", txt["fp"]);
        Assert.Equal("plant1", txt["site"]);
        Assert.Equal("line3", txt["area"]);
        Assert.Equal("cellA", txt["line"]);
        Assert.Equal("cell-a1", txt["cell"]);
        Assert.False(string.IsNullOrWhiteSpace(txt["v"]));
    }

    // ─────────────────────────────────────────────────────────────────────
    // Sanitized instance name.
    // ─────────────────────────────────────────────────────────────────────

    [Theory]
    [InlineData("plain-node-1", "plain-node-1")]
    [InlineData("My Node!!", "My_Node__")]
    [InlineData("node.with.dots", "node.with.dots")]
    [InlineData("", "st4i-machine")]
    [InlineData("   ", "st4i-machine")]
    public void SanitizeInstanceName_ProducesADnsSafeLabel(string input, string expected)
    {
        Assert.Equal(expected, SiteAdvertiser.SanitizeInstanceName(input));
    }

    // ─────────────────────────────────────────────────────────────────────
    // Enablement: ST4I_MDNS_ADVERTISE=0 / UnsOptions.Enabled=false -> never advertises.
    // ─────────────────────────────────────────────────────────────────────

    [Fact]
    public async Task Start_WhenAdvertiseEnvVarIsZero_NeverAdvertises()
    {
        var prev = Environment.GetEnvironmentVariable(SiteAdvertiser.EnvVarAdvertise);
        try
        {
            Environment.SetEnvironmentVariable(SiteAdvertiser.EnvVarAdvertise, "0");

            var identityProvider = NewIdentityProvider("node-disabled-test", "FP1");
            var unsOptions = new UnsOptions();
            await using var advertiser = new SiteAdvertiser(
                unsOptions, identityProvider, Bound("http://localhost:25201"), serviceType: UniqueServiceType("disabled"));

            advertiser.Start();

            Assert.False(advertiser.IsAdvertising);
        }
        finally
        {
            Environment.SetEnvironmentVariable(SiteAdvertiser.EnvVarAdvertise, prev);
        }
    }

    [Fact]
    public async Task Start_WhenUnsOptionsDisabled_NeverAdvertises()
    {
        var identityProvider = NewIdentityProvider("node-uns-disabled", "FP2");
        var unsOptions = new UnsOptions { Enabled = false };
        await using var advertiser = new SiteAdvertiser(
            unsOptions, identityProvider, Bound("http://localhost:25202"), serviceType: UniqueServiceType("uns-off"));

        advertiser.Start();

        Assert.False(advertiser.IsAdvertising);
    }

    // ─────────────────────────────────────────────────────────────────────
    // Never-throws: no bound address yet (a startup-ordering failure a real host could hit), Start() twice.
    // ─────────────────────────────────────────────────────────────────────

    [Fact]
    public async Task Start_NoBoundAddressesYet_DoesNotThrow_AndIsAdvertisingStaysFalse()
    {
        var identityProvider = NewIdentityProvider("node-nofail", "FP3");
        var unsOptions = new UnsOptions();
        await using var advertiser = new SiteAdvertiser(
            unsOptions, identityProvider, Unbound(), serviceType: UniqueServiceType("noaddr"));

        var ex = Record.Exception(() => advertiser.Start());

        Assert.Null(ex);
        Assert.False(advertiser.IsAdvertising);
    }

    [Fact]
    public async Task Start_CalledTwice_IsHarmlessAndIdempotent()
    {
        var identityProvider = NewIdentityProvider("node-twice", "FP4");
        var unsOptions = new UnsOptions();
        await using var advertiser = new SiteAdvertiser(
            unsOptions, identityProvider, Bound("http://localhost:25204"), serviceType: UniqueServiceType("twice"));

        var firstEx = Record.Exception(() => advertiser.Start());
        Assert.Null(firstEx);
        var stateAfterFirst = advertiser.IsAdvertising;

        var secondEx = Record.Exception(() => advertiser.Start());
        Assert.Null(secondEx);
        Assert.Equal(stateAfterFirst, advertiser.IsAdvertising);
    }

    // ─────────────────────────────────────────────────────────────────────
    // Dispose/Stop: clean and idempotent.
    // ─────────────────────────────────────────────────────────────────────

    [Fact]
    public async Task DisposeAsync_CalledTwice_IsCleanAndIdempotent()
    {
        var identityProvider = NewIdentityProvider("node-dispose", "FP5");
        var unsOptions = new UnsOptions();
        var advertiser = new SiteAdvertiser(
            unsOptions, identityProvider, Bound("http://localhost:25205"), serviceType: UniqueServiceType("dispose"));

        advertiser.Start();

        var ex = await Record.ExceptionAsync(async () =>
        {
            await advertiser.DisposeAsync();
            await advertiser.DisposeAsync();
        });

        Assert.Null(ex);
        Assert.False(advertiser.IsAdvertising);
    }

    [Fact]
    public async Task StopAsync_CalledTwice_IsCleanAndIdempotent()
    {
        var identityProvider = NewIdentityProvider("node-stop", "FP6");
        var unsOptions = new UnsOptions();
        await using var advertiser = new SiteAdvertiser(
            unsOptions, identityProvider, Bound("http://localhost:25206"), serviceType: UniqueServiceType("stop"));

        advertiser.Start();

        var ex = await Record.ExceptionAsync(async () =>
        {
            await advertiser.StopAsync();
            await advertiser.StopAsync();
        });

        Assert.Null(ex);
        Assert.False(advertiser.IsAdvertising);
    }

    // ─────────────────────────────────────────────────────────────────────
    // De-risk gate: real loopback advertise -> SiteDiscovery browse round-trip.
    //
    // Fix round 1 review finding — this test used to `return;` quietly (reporting a plain xUnit "Passed")
    // when either step below couldn't be verified, and the report inferred "it genuinely ran" from
    // DiscoverAsync's ~4s duration. That inference does NOT hold: SiteDiscovery.DiscoverAsync
    // unconditionally `await Task.Delay(timeout, ct)`s for the WHOLE window regardless of whether it
    // already collected a hit — a "found nothing" run takes exactly the same ~4s as a genuine success, so
    // duration cannot tell the two apart. Fixed two ways:
    //   1. Same MulticastService.IncludeLoopbackInterfaces = true precaution
    //      SiteDiscoveryTests.LoopbackRoundTrip_AdvertisedInstance_IsDiscovered uses (restored in a
    //      finally) — makes this test maximally reliable in an unknown sandbox/CI runner that might have
    //      no active physical NIC, same rationale as that test's own doc comment.
    //   2. The two `return;` soft-skips are gone. Confirmed empirically (a throwaway probe project pinned
    //      to this exact repo's xunit 2.9.2 + xunit.runner.visualstudio 2.8.2) that
    //      Xunit.Sdk.SkipException.ForSkip(...) does NOT map to a genuine "Skipped" bucket under THIS
    //      toolchain via `dotnet test` — it reports as a plain "Failed", the same as any other assertion
    //      failure, because xunit.runner.visualstudio 2.8.2 predates the dynamic-skip-token recognition
    //      xunit.execution 2.9+ added (bumping ONLY that test-only runner package to get real "Skipped"
    //      support was judged out of scope for this fix-round — it's a version change with project-wide
    //      blast radius, not something "exactly these two findings" authorized). So instead: every
    //      condition below is now a plain, clearly-worded xUnit assertion — the test either genuinely
    //      verifies the full round trip (passes only by reaching and satisfying the final Assert.Equal
    //      calls) or fails LOUDLY with an actionable message (visible in test output, never silent) if
    //      advertising or discovery didn't work. [Trait("Category","RequiresMulticast")] is the
    //      established, already-existing escape hatch for a genuinely NIC-less CI runner to exclude this
    //      test outright (`--filter "Category!=RequiresMulticast"`) — SiteDiscoveryTests' own doc comment
    //      already documents this same tag for exactly that purpose, so this test relies on the SAME
    //      CI-level opt-out rather than a silent in-test one.
    // ─────────────────────────────────────────────────────────────────────

    [Fact]
    [Trait("Category", "RequiresMulticast")]
    public async Task LoopbackRoundTrip_Advertised_IsDiscoveredBySiteDiscovery()
    {
        var previousIncludeLoopback = MulticastService.IncludeLoopbackInterfaces;
        MulticastService.IncludeLoopbackInterfaces = true;
        try
        {
            var serviceType = UniqueServiceType("rt");
            var identityProvider = NewIdentityProvider("rt-node-1", "RTFINGERPRINT");
            var unsOptions = new UnsOptions { Site = "rtsite", Area = "rtarea", Line = "rtline", Cell = "rtcell" };
            const int port = 25299;

            var advertiser = new SiteAdvertiser(unsOptions, identityProvider, Bound($"http://localhost:{port}"), serviceType: serviceType);
            try
            {
                advertiser.Start();

                Assert.True(advertiser.IsAdvertising,
                    "SiteAdvertiser.Start() did not begin advertising — no usable multicast-capable NIC " +
                    "in this environment? (see [Trait(\"Category\",\"RequiresMulticast\")] to exclude this " +
                    "test in a known NIC-less CI runner instead of silently skipping in-test).");

                var discovery = new SiteDiscovery(serviceType);
                var sites = await discovery.DiscoverAsync(TimeSpan.FromSeconds(4));

                Assert.True(sites.Count > 0,
                    "Advertised successfully but nothing round-tripped within the 4s browse window — " +
                    "multicast delivery itself did not work in this environment.");

                var found = Assert.Single(sites);
                Assert.Equal(port, found.Port);
                Assert.Equal("rt-node-1", found.Txt["node"]);
                Assert.Equal("RTFINGERPRINT", found.Txt["fp"]);
                Assert.Equal("rtsite", found.Txt["site"]);
                Assert.Equal("rtarea", found.Txt["area"]);
                Assert.Equal("rtline", found.Txt["line"]);
                Assert.Equal("rtcell", found.Txt["cell"]);
            }
            finally
            {
                await advertiser.DisposeAsync();
            }
        }
        finally
        {
            MulticastService.IncludeLoopbackInterfaces = previousIncludeLoopback;
        }
    }

    // ─────────────────────────────────────────────────────────────────────
    // GĐ3 closeout WI-4 fix round 1 (Important #2) — a device-identity rotation must actually reach a LIVE
    // mDNS advertisement, not just the in-memory DeviceIdentityProvider.Current pointer.
    // ─────────────────────────────────────────────────────────────────────

    [Fact]
    public async Task RestartAsync_NeverThrows_AndLeavesConsistentState()
    {
        var identityProvider = NewIdentityProvider("node-restart", "FP7");
        var unsOptions = new UnsOptions();
        await using var advertiser = new SiteAdvertiser(
            unsOptions, identityProvider, Bound("http://localhost:25207"), serviceType: UniqueServiceType("restart"));

        advertiser.Start();
        var stateAfterStart = advertiser.IsAdvertising;

        identityProvider.Rotate();

        var ex = await Record.ExceptionAsync(() => advertiser.RestartAsync());

        Assert.Null(ex);
        // Same environment-independent tolerance as Start_CalledTwice_IsHarmlessAndIdempotent above:
        // RestartAsync must never throw and must leave IsAdvertising in the SAME state a fresh Start()
        // would produce in whatever sandbox/CI runner this executes in — not necessarily true.
        Assert.Equal(stateAfterStart, advertiser.IsAdvertising);
    }

    [Fact]
    [Trait("Category", "RequiresMulticast")]
    public async Task RestartAsync_AfterRotation_ReAdvertisesWithTheNewFingerprint()
    {
        var previousIncludeLoopback = MulticastService.IncludeLoopbackInterfaces;
        MulticastService.IncludeLoopbackInterfaces = true;
        try
        {
            var serviceType = UniqueServiceType("rot");
            var identityProvider = NewIdentityProvider("rot-node-1", "OLD-FINGERPRINT");
            var unsOptions = new UnsOptions { Site = "rotsite", Area = "rotarea", Line = "rotline", Cell = "rotcell" };
            const int port = 25298;

            var advertiser = new SiteAdvertiser(unsOptions, identityProvider, Bound($"http://localhost:{port}"), serviceType: serviceType);
            try
            {
                advertiser.Start();
                Assert.True(advertiser.IsAdvertising,
                    "SiteAdvertiser.Start() did not begin advertising — no usable multicast-capable NIC " +
                    "in this environment? (see [Trait(\"Category\",\"RequiresMulticast\")] to exclude this " +
                    "test in a known NIC-less CI runner instead of silently skipping in-test).");

                // A real rotation — mints+persists a brand-new identity through the SAME DeviceIdentityStore
                // NewIdentityProvider wired up, exactly like the real POST /v1/site/identity/rotate handler.
                var rotated = identityProvider.Rotate();
                Assert.NotEqual("OLD-FINGERPRINT", rotated.Fingerprint);

                // Merely rotating the provider does nothing to the advertisement already live above — see
                // ISiteAdvertiser.RestartAsync's own doc comment. RestartAsync is what actually re-keys it.
                await advertiser.RestartAsync();
                Assert.True(advertiser.IsAdvertising, "RestartAsync did not resume advertising.");

                var discovery = new SiteDiscovery(serviceType);
                var sites = await discovery.DiscoverAsync(TimeSpan.FromSeconds(4));

                Assert.True(sites.Count > 0,
                    "Advertised successfully after RestartAsync but nothing round-tripped within the 4s " +
                    "browse window — multicast delivery itself did not work in this environment.");

                var found = Assert.Single(sites);
                Assert.Equal(port, found.Port);
                Assert.Equal(rotated.Fingerprint, found.Txt["fp"]);
                Assert.NotEqual("OLD-FINGERPRINT", found.Txt["fp"]);
            }
            finally
            {
                await advertiser.DisposeAsync();
            }
        }
        finally
        {
            MulticastService.IncludeLoopbackInterfaces = previousIncludeLoopback;
        }
    }
}
