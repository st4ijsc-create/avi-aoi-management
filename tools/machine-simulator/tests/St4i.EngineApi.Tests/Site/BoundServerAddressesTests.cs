using System.Security.Cryptography;
using System.Security.Cryptography.X509Certificates;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Hosting.Server;
using Microsoft.AspNetCore.Hosting.Server.Features;
using Microsoft.Extensions.DependencyInjection;
using St4i.EdgeCore.Identity;
using St4i.EdgeCore.Uns;
using St4i.EngineApi.Site;
using Xunit;

namespace St4i.EngineApi.Tests.Site;

/// <summary>
/// 🔴 <b>Task AC-1 — the two facts a real process had to be started to learn.</b> The published build's
/// own log carries
/// <c>fail: SiteAdvertiser[0] … No server addresses are bound yet — the host may not have started
/// listening.</c>, and it carries it AFTER <c>Now listening on:</c> and AFTER <c>Application started.</c>.
/// Both halves matter: the advertise fails, and the ordering the failure blames is not the ordering that
/// happened.
///
/// <para><b>What this file measures, and why nothing already here could.</b> Every other
/// <see cref="SiteAdvertiser"/> test supplies its bound addresses as a <c>string[]</c> (see
/// <c>SiteAdvertiserTests.Bound</c>), and the twelve <c>WebApplicationFactory&lt;Program&gt;</c> classes
/// run on <c>TestServer</c>. Both of those satisfy the <c>IReadOnlyCollection&lt;string&gt;</c> conversion
/// the composition root used to depend on; Kestrel's own address collection does not. So the two tests
/// below start a REAL Kestrel host and read its REAL <see cref="IServerAddressesFeature"/> — the one
/// surface the suite had never touched, and the reason 2755 green tests coexisted with a build in which no
/// Site could ever advertise.</para>
///
/// <para><b>Neither test asserts <see cref="ISiteAdvertiser.IsAdvertising"/> is
/// <see langword="true"/></b> — same reason <c>SiteAdvertiserTests</c> does not: whether a multicast group
/// can be joined is a property of whatever machine runs the suite, and the posture this product promises
/// for a machine without one is "the host comes up and the failure is reported", not "advertising
/// succeeds". What IS asserted is that the failure reported is no longer THIS one.</para>
///
/// <para><b><see cref="Collection"/>:</b> shares <c>SiteAdvertiserTests</c>' collection because
/// <see cref="TheAdvertiserWiredTheWayProgramCsWiresIt_OverAListeningHost_NeverReportsTheNotBoundYetFailure"/>
/// constructs a live <c>MulticastService</c>, exactly as that class' own <c>Start()</c> tests do; xUnit
/// never runs two classes of one collection concurrently, so the mDNS traffic of the two files cannot
/// overlap.</para>
/// </summary>
[Collection("St4i.EngineApi.Tests.Site")]
public sealed class BoundServerAddressesTests : IDisposable
{
    /// <summary>The verbatim substring of the failure the published build logged. Kept as a literal here
    /// rather than derived from <see cref="SiteAdvertiser"/>'s message so that a future edit to that
    /// message cannot silently make this test assert nothing — a derived needle always matches.</summary>
    private const string NotBoundYetNeedle = "No server addresses are bound yet";

    private readonly List<string> _tempDirs = new();

    public void Dispose()
    {
        foreach (var dir in _tempDirs)
        {
            try { Directory.Delete(dir, recursive: true); } catch { /* best-effort cleanup */ }
        }
    }

    /// <summary>A minimal but REAL host: Kestrel, bound to an ephemeral loopback port, actually started.
    /// Port 0 so two of these can never collide with each other or with anything else on the machine.</summary>
    private static async Task<WebApplication> StartRealKestrelHostAsync()
    {
        var builder = WebApplication.CreateBuilder();
        var app = builder.Build();
        app.Urls.Add("http://127.0.0.1:0");
        await app.StartAsync();
        return app;
    }

    private DeviceIdentityProvider NewIdentityProvider(string nodeId, string fingerprint)
    {
        using var ecdsa = ECDsa.Create(ECCurve.NamedCurves.nistP256);
        var request = new CertificateRequest($"CN={nodeId}", ecdsa, HashAlgorithmName.SHA256);
        var cert = request.CreateSelfSigned(DateTimeOffset.UtcNow.AddDays(-1), DateTimeOffset.UtcNow.AddYears(1));
        var identity = new DeviceIdentity(cert, cert.ExportCertificatePem(), fingerprint, nodeId);

        var dir = Directory.CreateTempSubdirectory("st4i-boundaddresses-tests-").FullName;
        _tempDirs.Add(dir);
        return new DeviceIdentityProvider(new DeviceIdentityStore(dir), identity);
    }

    /// <summary>🔴 <b>The defect, at the statement that carried it.</b> Kestrel's
    /// <see cref="IServerAddressesFeature.Addresses"/> is declared <c>ICollection&lt;string&gt;</c> and its
    /// runtime type implements <c>ICollection&lt;string&gt;</c>, <c>IEnumerable&lt;string&gt;</c> and
    /// <c>IEnumerable</c> — and NOT <c>IReadOnlyCollection&lt;string&gt;</c>. The composition root's old
    /// <c>as IReadOnlyCollection&lt;string&gt;</c> therefore answered <see langword="null"/> on a host that
    /// was listening. This asserts the replacement returns the addresses the host is actually bound to.
    ///
    /// <para>The second assertion — that the feature's own collection is NOT an
    /// <c>IReadOnlyCollection&lt;string&gt;</c> — is what keeps the first from being satisfied for the
    /// wrong reason. Were a future ASP.NET Core to start implementing that interface, the old spelling
    /// would begin working and this file would no longer be measuring anything; the assertion turns that
    /// into a RED that says so, instead of a green that has quietly stopped meaning what it says.</para></summary>
    [Fact]
    public async Task Read_OverARealListeningKestrelHost_ReturnsTheAddressesTheHostIsBoundTo()
    {
        var app = await StartRealKestrelHostAsync();
        try
        {
            var server = app.Services.GetRequiredService<IServer>();
            var feature = server.Features.Get<IServerAddressesFeature>();
            Assert.NotNull(feature);

            // Premise: the host really is listening, so "no addresses" below could only be the reader's
            // fault and never the host's.
            var live = feature.Addresses;
            Assert.NotEmpty(live);

            Assert.Null(live as IReadOnlyCollection<string>);

            var read = BoundServerAddresses.Read(server);

            Assert.NotNull(read);
            Assert.Equal(live.OrderBy(a => a, StringComparer.Ordinal).ToArray(),
                read.OrderBy(a => a, StringComparer.Ordinal).ToArray());
            Assert.All(read, address => Assert.True(
                Uri.TryCreate(address, UriKind.Absolute, out var uri) && uri.Port > 0,
                $"'{address}' is not an absolute URI with a positive port, so SiteAdvertiser.ResolvePort " +
                "could not have used it."));
        }
        finally
        {
            await app.StopAsync();
            await app.DisposeAsync();
        }
    }

    /// <summary>🔴 <b>The consequence, at the surface the operator actually reads.</b> Wires a real
    /// <see cref="SiteAdvertiser"/> the way <c>Program.cs</c> wires it — same
    /// <see cref="BoundServerAddresses.Read"/> delegate over a real, listening Kestrel host — and asserts
    /// the error channel never carries the published build's line.
    ///
    /// <para><b>Non-vacuity is asserted, not assumed:</b> the delegate's invocation count must be exactly
    /// one, so a <see cref="SiteAdvertiser.Start"/> that short-circuited before resolving a port (UNS
    /// disabled, <c>ST4I_MDNS_ADVERTISE=0</c>, an already-advertising instance) cannot be mistaken for a
    /// fixed one. And the outcome is asserted as a DISJUNCTION — advertising, or one failure that is not
    /// this failure — because a machine with no multicast-capable NIC must still reach the second branch
    /// and must still report there.</para></summary>
    [Fact]
    public async Task TheAdvertiserWiredTheWayProgramCsWiresIt_OverAListeningHost_NeverReportsTheNotBoundYetFailure()
    {
        var app = await StartRealKestrelHostAsync();
        try
        {
            var server = app.Services.GetRequiredService<IServer>();
            var invocations = 0;
            var failures = new List<(Exception Exception, string Message)>();

            await using var advertiser = new SiteAdvertiser(
                new UnsOptions(),
                NewIdentityProvider("node-realkestrel", "FP-AC1"),
                () => { invocations++; return BoundServerAddresses.Read(server); },
                serviceType: "_st4i-machine-test-ac1-" + Guid.NewGuid().ToString("N")[..8] + "._tcp",
                logError: (ex, msg) => failures.Add((ex, msg)));

            var thrown = Record.Exception(() => advertiser.Start());

            // The posture that must survive this fix: Start() never throws out to its caller.
            Assert.Null(thrown);

            Assert.Equal(1, invocations);

            Assert.DoesNotContain(failures, f =>
                f.Exception is InvalidOperationException
                && f.Exception.Message.Contains(NotBoundYetNeedle, StringComparison.Ordinal));

            Assert.True(advertiser.IsAdvertising || failures.Count == 1,
                "Start() neither began advertising nor reported exactly one failure — the never-throws " +
                "posture requires that every attempt end in one of those two states. Failures seen: " +
                string.Join(" | ", failures.Select(f => f.Exception.GetType().Name + ": " + f.Exception.Message)));
        }
        finally
        {
            await app.StopAsync();
            await app.DisposeAsync();
        }
    }
}
