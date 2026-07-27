using Makaretu.Dns;
using St4i.EdgeCore.Site;
using Xunit;

namespace St4i.EdgeCore.Tests.Site;

/// <summary>
/// GĐ3 sub-2 SD-1 (task-1-brief.md) — <see cref="SiteDiscovery"/>: the mDNS browse-only Site discovery
/// this task adds.
///
/// <para><b>The de-risk-gate proof</b> (<see cref="LoopbackRoundTrip_AdvertisedInstance_IsDiscovered"/>) —
/// this is the actual "does <c>Makaretu.Dns.Multicast.New</c> 0.38.0 work on <c>net10.0-windows</c>" proof
/// the brief demanded BEFORE any production code was written: it uses the SAME package directly (not
/// <see cref="SiteDiscovery"/>) to ADVERTISE a fake <c>_synapse-site-sd1test._tcp</c> instance via
/// <see cref="ServiceProfile"/> + <see cref="ServiceDiscovery.Advertise"/>, then drives
/// <see cref="SiteDiscovery.DiscoverAsync"/> against that same instance end-to-end over a real (loopback)
/// UDP multicast round-trip. Verified manually during this task's implementation (see task-1-report.md) —
/// confirmed working on this dev box: the advertiser's PTR/SRV/TXT/A landed in the browser's
/// <c>AnswerReceived</c> in ONE reply message, exactly as <see cref="SiteDiscovery"/>'s own doc comment
/// describes. <see cref="MulticastService.IncludeLoopbackInterfaces"/> is set (it's a STATIC/process-wide
/// switch in this package, confirmed via reflection — deliberately NOT touched by
/// <see cref="SiteDiscovery"/> itself, which runs unmodified against whatever real LAN interfaces a
/// production box has) purely to make this ONE test maximally reliable in an unknown sandbox/CI runner that
/// might have no active physical NIC.</para>
///
/// <para><b>Never-throws</b> — an already-cancelled token, and a service type nobody is advertising, both
/// return an empty list rather than throwing (or hanging past the bounded timeout).</para>
///
/// <para><b>Pure collection/dedup unit test</b> (the <c>CollectFromMessages_*</c> methods below) — feeds
/// <see cref="SiteDiscovery.CollectFromMessages"/> hand-built, synthetic <see cref="Message"/>s (real
/// Makaretu.Dns record TYPES, but constructed directly in memory — no socket, no multicast, no network
/// I/O at all) so the PTR-anchor filtering, SRV/TXT/A correlation, and dedup-by-instance-name behavior has
/// coverage that can NEVER depend on whether multicast happens to work in whatever environment runs this
/// suite — see this class' own remarks on the loopback test above for why that independent coverage
/// matters.</para>
/// </summary>
[Collection("St4i.EdgeCore.Tests.Site")]
public sealed class SiteDiscoveryTests
{
    // ─────────────────────────────────────────────────────────────────────
    // De-risk gate: real loopback mDNS advertise -> SiteDiscovery.DiscoverAsync browse round-trip.
    // ─────────────────────────────────────────────────────────────────────

    [Fact]
    public async Task LoopbackRoundTrip_AdvertisedInstance_IsDiscovered()
    {
        // Maximizes the odds this real-multicast test succeeds regardless of the sandbox's network
        // topology — see this class' own doc comment. A process-wide, idempotent switch; safe to set
        // unconditionally at the top of this one test.
        MulticastService.IncludeLoopbackInterfaces = true;

        const string serviceType = "_synapse-site-sd1test._tcp";
        const string instanceName = "sd1-test-site";
        const ushort port = 48884;

        using var advertiserMdns = new MulticastService();
        using var advertiserSd = new ServiceDiscovery(advertiserMdns);
        var profile = new ServiceProfile(instanceName, serviceType, port);
        profile.AddProperty("siteId", "sd1-test");
        advertiserSd.Advertise(profile);
        advertiserMdns.Start();

        try
        {
            var discovery = new SiteDiscovery(serviceType);

            var sites = await discovery.DiscoverAsync(TimeSpan.FromSeconds(4));

            var found = Assert.Single(sites, s => s.InstanceName.StartsWith(instanceName, StringComparison.OrdinalIgnoreCase));
            Assert.Equal(port, found.Port);
            Assert.False(string.IsNullOrWhiteSpace(found.Host));
            Assert.Equal("sd1-test", found.Txt["siteId"]);
        }
        finally
        {
            advertiserSd.Unadvertise(profile);
            advertiserMdns.Stop();
        }
    }

    // ─────────────────────────────────────────────────────────────────────
    // Never-throws.
    // ─────────────────────────────────────────────────────────────────────

    [Fact]
    public async Task DiscoverAsync_AlreadyCancelledToken_ReturnsEmptyList_NeverThrows()
    {
        var discovery = new SiteDiscovery("_synapse-site-cancel-test._tcp");
        using var cts = new CancellationTokenSource();
        cts.Cancel();

        var exception = await Record.ExceptionAsync(async () =>
        {
            var sites = await discovery.DiscoverAsync(TimeSpan.FromSeconds(5), cts.Token);
            Assert.Empty(sites);
        });

        Assert.Null(exception);
    }

    [Fact]
    public async Task DiscoverAsync_NobodyAdvertisingThatServiceType_ReturnsEmptyList_NeverThrows()
    {
        // A service type nobody on this box/LAN is advertising — a bounded, short window, so this test
        // stays fast rather than waiting out a full production-sized timeout.
        var discovery = new SiteDiscovery("_synapse-site-nobody-home-" + Guid.NewGuid().ToString("N") + "._tcp");

        var exception = await Record.ExceptionAsync(async () =>
        {
            var sites = await discovery.DiscoverAsync(TimeSpan.FromMilliseconds(300));
            Assert.Empty(sites);
        });

        Assert.Null(exception);
    }

    [Fact]
    public async Task DiscoverAsync_BogusServiceTypeWithInvalidCharacters_ReturnsEmptyList_NeverThrows()
    {
        var discovery = new SiteDiscovery("not a valid service type !! ._tcp");

        var exception = await Record.ExceptionAsync(async () =>
        {
            var sites = await discovery.DiscoverAsync(TimeSpan.FromMilliseconds(300));
            Assert.Empty(sites);
        });

        Assert.Null(exception);
    }

    // ─────────────────────────────────────────────────────────────────────
    // Pure collection/dedup unit test — synthetic records, no real multicast.
    // ─────────────────────────────────────────────────────────────────────

    private const string SynthServiceType = "_synapse-site._tcp";
    private const string SynthPtrName = SynthServiceType + ".local";

    private static Message ReplyMessage(params ResourceRecord[] records)
    {
        var message = new Message();
        message.Answers.AddRange(records);
        return message;
    }

    private static PTRRecord Ptr(string instanceFqdn) => new()
    {
        Name = SynthPtrName,
        DomainName = instanceFqdn,
    };

    private static SRVRecord Srv(string instanceFqdn, string hostFqdn, ushort port) => new()
    {
        Name = instanceFqdn,
        Target = hostFqdn,
        Port = port,
    };

    private static TXTRecord Txt(string instanceFqdn, params string[] strings) => new()
    {
        Name = instanceFqdn,
        Strings = strings.ToList(),
    };

    private static ARecord Addr(string hostFqdn, string ip) => new()
    {
        Name = hostFqdn,
        Address = System.Net.IPAddress.Parse(ip),
    };

    [Fact]
    public void CollectFromMessages_FullSetInOneMessage_ProducesOneDiscoveredSite()
    {
        const string instance = "site-a._synapse-site._tcp.local";
        const string host = "site-a-host.synapse-site.local";
        var message = ReplyMessage(
            Ptr(instance),
            Srv(instance, host, 8883),
            Txt(instance, "siteId=alpha", "region=eu"),
            Addr(host, "192.168.1.50"));

        var results = SiteDiscovery.CollectFromMessages(new[] { message }, SynthServiceType);

        var site = Assert.Single(results);
        Assert.Equal(instance, site.InstanceName);
        Assert.Equal(host, site.Host);
        Assert.Equal(8883, site.Port);
        Assert.Equal("alpha", site.Txt["siteId"]);
        Assert.Equal("eu", site.Txt["region"]);
        Assert.Contains("192.168.1.50", site.Addresses);
    }

    [Fact]
    public void CollectFromMessages_RecordsSplitAcrossMessages_StillCorrelates()
    {
        const string instance = "site-b._synapse-site._tcp.local";
        const string host = "site-b-host.synapse-site.local";

        // PTR arrives alone first, then SRV+TXT, then the address — three separate reply messages, the
        // way real, staggered mDNS traffic could plausibly arrive.
        var messages = new[]
        {
            ReplyMessage(Ptr(instance)),
            ReplyMessage(Srv(instance, host, 8884), Txt(instance, "siteId=beta")),
            ReplyMessage(Addr(host, "10.0.0.5")),
        };

        var results = SiteDiscovery.CollectFromMessages(messages, SynthServiceType);

        var site = Assert.Single(results);
        Assert.Equal(host, site.Host);
        Assert.Equal(8884, site.Port);
        Assert.Equal("beta", site.Txt["siteId"]);
        Assert.Contains("10.0.0.5", site.Addresses);
    }

    [Fact]
    public void CollectFromMessages_DuplicateAnnouncements_DedupsByInstanceName_LastWins()
    {
        const string instance = "site-c._synapse-site._tcp.local";
        const string host = "site-c-host.synapse-site.local";

        // The same instance announced twice with a different port the second time (e.g. a restart) —
        // mDNS's own "repeat, receivers dedupe" convention. The LAST value observed wins.
        var messages = new[]
        {
            ReplyMessage(Ptr(instance), Srv(instance, host, 8883), Txt(instance, "v=1")),
            ReplyMessage(Ptr(instance), Srv(instance, host, 9000), Txt(instance, "v=2")),
        };

        var results = SiteDiscovery.CollectFromMessages(messages, SynthServiceType);

        var site = Assert.Single(results);
        Assert.Equal(9000, site.Port);
        Assert.Equal("2", site.Txt["v"]);
    }

    [Fact]
    public void CollectFromMessages_InstanceWithNoSrv_IsDropped()
    {
        // A PTR (and even a TXT) arrived, but no SRV ever did within the window — nothing a join wizard
        // could dial, so this instance must not appear in the result at all.
        const string instance = "site-d._synapse-site._tcp.local";
        var message = ReplyMessage(Ptr(instance), Txt(instance, "siteId=delta"));

        var results = SiteDiscovery.CollectFromMessages(new[] { message }, SynthServiceType);

        Assert.Empty(results);
    }

    [Fact]
    public void CollectFromMessages_UnrelatedServiceTypeTraffic_IsIgnored()
    {
        // A PTR for a DIFFERENT service type (e.g. some other zeroconf device chattering on the same UDP
        // 5353 group) must never be picked up as a discovered Site.
        var unrelatedPtr = new PTRRecord { Name = "_googlecast._tcp.local", DomainName = "chromecast-1._googlecast._tcp.local" };
        var unrelatedSrv = Srv("chromecast-1._googlecast._tcp.local", "chromecast-1.local", 8009);
        var message = ReplyMessage(unrelatedPtr, unrelatedSrv);

        var results = SiteDiscovery.CollectFromMessages(new[] { message }, SynthServiceType);

        Assert.Empty(results);
    }

    [Fact]
    public void CollectFromMessages_NoMessagesAtAll_ReturnsEmptyList()
    {
        var results = SiteDiscovery.CollectFromMessages(Array.Empty<Message>(), SynthServiceType);

        Assert.Empty(results);
    }

    [Fact]
    public void CollectFromMessages_TxtWithNoEqualsSign_IsSkippedRatherThanThrowing()
    {
        const string instance = "site-e._synapse-site._tcp.local";
        const string host = "site-e-host.synapse-site.local";
        var message = ReplyMessage(
            Ptr(instance),
            Srv(instance, host, 8883),
            Txt(instance, "bareattribute", "valid=1"));

        var results = SiteDiscovery.CollectFromMessages(new[] { message }, SynthServiceType);

        var site = Assert.Single(results);
        Assert.Equal("1", site.Txt["valid"]);
        Assert.False(site.Txt.ContainsKey("bareattribute"));
    }
}
