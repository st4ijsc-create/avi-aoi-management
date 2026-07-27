using System.Collections.Concurrent;
using Makaretu.Dns;

namespace St4i.EngineApi.Site;

/// <summary>
/// GĐ3 sub-2 SD-1 (<c>.superpowers/sdd/2026-07-27-giaidoan3-mdns-join-wizard-blueprint/task-1-brief.md</c>) —
/// mDNS browse-only discovery of SYNAPSE Sites on the LAN, so the web join wizard can PRE-FILL a
/// <c>PUT /v1/site</c> host/port instead of an operator hand-typing them. This is purely an operator
/// convenience: it does NOT change trust in any way — the operator still pastes/pins the Site's
/// <see cref="St4i.EdgeCore.Site.PersistedSiteLink.SiteTrustPem"/> exactly as EC-3's <c>PUT /v1/site</c>
/// already requires (see <c>SiteEndpoints.IsValidTrustPem</c>). Discovery has no opinion on trust at all; it
/// only ever surfaces "here's what's advertising itself as a Site on this LAN segment, and here's where it
/// says its MQTT broker is" — a Site's own SRV target could be spoofed by anything on the local network
/// (mDNS itself has no authentication), which is exactly WHY the trust-pin step is never skipped or
/// auto-filled.
///
/// <para><b>GĐ3 closeout WI-1 (<c>.superpowers/sdd/2026-07-28-giaidoan3-ws-i-closeout-blueprint/task-1-brief.md</c>)
/// moved this whole file here from <c>St4i.EdgeCore.Site</c></b> — the ONLY change of that move was the
/// namespace (<c>St4i.EdgeCore.Site</c> → <c>St4i.EngineApi.Site</c>) and, with it,
/// <c>Makaretu.Dns.Multicast.New</c>'s <c>PackageReference</c> (EdgeCore.csproj → EngineApi.csproj): the
/// public API (type names, const values, the service-type string) is byte-identical. Reason: EngineApi is
/// the ONLY consumer of <see cref="ISiteDiscovery"/> (<c>SiteEndpoints.DiscoverAsync</c>) — EdgeCore's own
/// <c>St4i.EdgeService</c>/WPF build outputs were carrying Makaretu's (and its transitive
/// <c>Common.Logging</c>'s) DLLs for no reason, since neither of those hosts ever touches mDNS at all. See
/// <c>St4i.EdgeCore.Tests.MakaretuNotShippedTests</c> for the proof those outputs are now clean, and this
/// task's own report for the full rationale. Everything else that lived in <c>St4i.EdgeCore.Site</c>
/// (<see cref="St4i.EdgeCore.Site.UnsBridge"/>, <see cref="St4i.EdgeCore.Site.SiteBridgeManager"/>,
/// <see cref="St4i.EdgeCore.Site.SiteTrustPin"/>, <see cref="St4i.EdgeCore.Site.SiteLinkStore"/>,
/// <see cref="St4i.EdgeCore.Site.BridgeStatus"/>, <see cref="St4i.EdgeCore.Site.PersistedSiteLink"/>) STAYS
/// in EdgeCore — <c>St4i.EdgeService</c> genuinely needs those for its own northbound Site bridge.</para>
/// </summary>
public sealed record DiscoveredSite(
    string InstanceName,
    string Host,
    int Port,
    IReadOnlyList<string> Addresses,
    IReadOnlyDictionary<string, string> Txt);

/// <summary>See <see cref="SiteDiscovery"/> for the full contract.</summary>
public interface ISiteDiscovery
{
    /// <summary>Browses the LAN (mDNS) for the SYNAPSE Site service type for up to <paramref name="timeout"/>,
    /// returning the deduped discovered instances. NEVER throws — a network/multicast error yields an empty
    /// list (logged via the ctor's <c>logError</c> callback). Per-call ephemeral: a fresh
    /// <see cref="MulticastService"/>/<see cref="ServiceDiscovery"/> pair is started, queried, collected, then
    /// stopped/disposed inside this one call — no always-on multicast socket is held between calls (or while
    /// this call isn't in flight).</summary>
    Task<IReadOnlyList<DiscoveredSite>> DiscoverAsync(TimeSpan timeout, CancellationToken ct = default);
}

/// <summary>
/// mDNS (RFC 6762/6763, "Bonjour"/"zeroconf") browser for the SYNAPSE Site service type, built on
/// <c>Makaretu.Dns.Multicast.New</c> 0.38.0 (the jdomnitz-maintained fork of the original
/// richardschneider/net-mdns — MIT, confirmed to build/run on <c>net10.0-windows</c> as this task's own
/// de-risk gate; see the task-1 report for the loopback advertise→browse proof).
///
/// <para><b>Per-call ephemeral, not always-on:</b> unlike <see cref="St4i.EdgeCore.Uns.UnsBroker"/> (an
/// always-on loopback MQTT listener) or <see cref="St4i.EdgeCore.Site.SiteBridgeManager"/> (a long-lived
/// northbound bridge once a Site link is enabled), THIS class holds no state and no socket between calls.
/// Every <see cref="DiscoverAsync"/> call
/// constructs its own <see cref="MulticastService"/> + <see cref="ServiceDiscovery"/>, starts them, sends
/// exactly one <c>QueryServiceInstances</c> multicast query, collects whatever reply messages arrive for
/// <paramref name="timeout"/>'s duration, then stops/disposes both — regardless of whether the call
/// succeeds, times out, is cancelled, or throws internally. This is deliberate: discovery is an
/// operator-initiated, bounded action (a wizard clicking "scan the network"), never a background listener —
/// see the brief's "NO always-on multicast socket" constraint.</para>
///
/// <para><b>Collect-then-parse:</b> while the browse window is open, the <see cref="MulticastService.AnswerReceived"/>
/// handler does the absolute minimum — enqueue the raw <see cref="Message"/> into a
/// <see cref="ConcurrentQueue{T}"/> — so the actual PTR/SRV/TXT/A correlation logic runs exactly ONCE,
/// single-threaded, after the window closes, in <see cref="CollectFromMessages"/>. That single method is
/// the entire "what SRV/TXT/A do we resolve" contract, and it's a pure function (message list + service
/// type in, deduped <see cref="DiscoveredSite"/> list out) — which is what lets
/// <c>SiteDiscoveryTests</c> unit-test the correlation/dedup logic directly against synthetic, in-memory
/// records, with no real multicast socket involved at all (see that test class' own doc comment for why
/// that matters: multicast can be unavailable/flaky in a sandboxed CI runner).</para>
///
/// <para><b>What gets resolved:</b> per RFC 6762 convention (confirmed empirically against this exact
/// package during the de-risk gate), a single mDNS reply to <c>QueryServiceInstances</c> bundles the PTR
/// (points at the instance), SRV (host+port), TXT (key=value properties), and A/AAAA (the SRV target
/// host's own addresses) records together (<see cref="Message.Answers"/> plus
/// <see cref="Message.AdditionalRecords"/>). <see cref="CollectFromMessages"/> still tolerates a PTR/SRV/TXT/A
/// split across separate messages (three passes over the UNION of every message received in the window): a
/// PTR record whose OWN name matches the queried service type marks its <see cref="PTRRecord.DomainName"/>
/// target as a "real" discovered instance — filtering out unrelated zeroconf chatter (printers, Chromecasts,
/// ...) that also shares UDP 5353 on the same LAN segment; a SRV/TXT record is only accepted once its
/// <see cref="ResourceRecord.Name"/> matches an instance already marked valid that way; an A/AAAA record is
/// kept indexed by its own name (the SRV target's hostname) and only surfaced in the final
/// <see cref="DiscoveredSite.Addresses"/> list for an instance whose SRV target resolved to that same
/// hostname. An instance that never produces a SRV record within the window is dropped entirely (per the
/// brief: "at minimum return InstanceName + Host + Port + Txt" — a "discovered" Site the web wizard couldn't
/// dial is not useful to surface at all); <see cref="DiscoveredSite.Addresses"/> legitimately CAN be empty
/// (the join wizard only needs Host/Port to pre-fill the form — <c>SiteEndpoints.PutSiteAsync</c> dials by
/// hostname, not a pre-resolved IP).</para>
///
/// <para><b>Dedup:</b> keyed by the fully-qualified instance name (e.g.
/// <c>plant-a-site._synapse-site._tcp.local</c>) — repeated mDNS traffic for the same instance (multicast is
/// inherently "fire more than once, receivers dedupe" by design) collapses to one <see cref="DiscoveredSite"/>
/// entry; the last SRV/TXT/A seen for that instance across every message in the window wins.</para>
///
/// <para><b>NEVER throws:</b> the entire body — construction, <c>Start()</c>, the query, the bounded wait,
/// and the post-window parse — is wrapped so any exception (a firewall blocking the multicast group, no
/// usable network interface, a malformed reply from something else on the LAN, ...) yields an empty list
/// plus a call to the ctor's <c>logError</c> callback, never an exception escaping to the caller. Honors
/// <paramref name="ct"/> cancellation: an already-cancelled token returns empty immediately (never even
/// opens a socket); a token that fires mid-wait stops waiting early and parses whatever was already
/// collected, exactly like a natural timeout would.</para>
/// </summary>
public sealed class SiteDiscovery : ISiteDiscovery
{
    /// <summary>Overrides the mDNS service type this instance browses for. Same "env var, unset/blank falls
    /// back to the built-in default" idiom as <see cref="Uns.UnsOptions.FromEnvironment"/>'s own env
    /// reads.</summary>
    public const string EnvVarServiceType = "ST4I_SITE_SERVICE_TYPE";

    /// <summary>The SYNAPSE Site mDNS service type every Site (once SD-2/a future Site-side task advertises
    /// it) registers itself under, and every device's join wizard (this task) browses for. A bare service
    /// type (no leading instance name, no trailing <c>.local</c>) — <see cref="ServiceDiscovery.QueryServiceInstances(DomainName)"/>
    /// appends <c>.local</c> itself.</summary>
    public const string DefaultServiceType = "_synapse-site._tcp";

    private readonly string _serviceType;
    private readonly Action<Exception, string>? _logError;

    /// <param name="serviceType">Explicit override (mainly for tests — a throwaway service type per test
    /// avoids cross-test mDNS traffic collisions on a shared LAN/loopback). <see langword="null"/>/blank
    /// falls through to <see cref="EnvVarServiceType"/>, then <see cref="DefaultServiceType"/> — same
    /// ctor-arg &gt; env &gt; built-in-default precedence <see cref="Uns.UnsOptions.FromEnvironment"/>
    /// documents for its own fields.</param>
    /// <param name="logError">Invoked (never thrown) whenever a browse attempt fails internally. <see
    /// langword="null"/> is fine — errors are simply not observed anywhere (the DI registration in
    /// <c>Program.cs</c> always supplies a real logger-backed callback).</param>
    public SiteDiscovery(string? serviceType = null, Action<Exception, string>? logError = null)
    {
        _serviceType = ResolveServiceType(serviceType);
        _logError = logError;
    }

    private static string ResolveServiceType(string? explicitServiceType)
    {
        if (!string.IsNullOrWhiteSpace(explicitServiceType))
        {
            return explicitServiceType;
        }

        var env = Environment.GetEnvironmentVariable(EnvVarServiceType);
        return string.IsNullOrWhiteSpace(env) ? DefaultServiceType : env;
    }

    /// <inheritdoc/>
    public async Task<IReadOnlyList<DiscoveredSite>> DiscoverAsync(TimeSpan timeout, CancellationToken ct = default)
    {
        // Already-cancelled token: never even open a socket — same "bounded, cheap to call speculatively"
        // contract a caller would expect from any other cancellable read-only query in this codebase.
        if (ct.IsCancellationRequested)
        {
            return Array.Empty<DiscoveredSite>();
        }

        var trimmedServiceType = _serviceType.Trim().TrimEnd('.');

        // The ONLY thing the live receive callback does — see this class' own doc comment for why the
        // actual PTR/SRV/TXT/A correlation is deferred to a single post-window pass instead.
        var receivedMessages = new ConcurrentQueue<Message>();

        MulticastService? mdns = null;
        ServiceDiscovery? sd = null;
        try
        {
            mdns = new MulticastService();
            sd = new ServiceDiscovery(mdns);

            mdns.AnswerReceived += (_, e) => receivedMessages.Enqueue(e.Message);

            mdns.Start();
            sd.QueryServiceInstances(trimmedServiceType);

            try
            {
                await Task.Delay(timeout, ct).ConfigureAwait(false);
            }
            catch (OperationCanceledException)
            {
                // Cancelled mid-wait: honor it by stopping early and parsing whatever was collected so
                // far — same "cancellation means stop, not fail" contract as every other bounded wait in
                // this codebase (e.g. WalFlushPump's own tick loop).
            }

            return CollectFromMessages(receivedMessages, trimmedServiceType);
        }
        catch (Exception ex)
        {
            _logError?.Invoke(ex, $"mDNS Site discovery failed for service type '{trimmedServiceType}'.");
            return Array.Empty<DiscoveredSite>();
        }
        finally
        {
            // Best-effort, individually guarded: a Stop()/Dispose() failure must never mask (or replace)
            // whatever result/error the try block above already decided on, and must never prevent the
            // OTHER cleanup call from still running.
            try { sd?.Dispose(); } catch { /* best-effort cleanup */ }
            try { mdns?.Stop(); } catch { /* best-effort cleanup */ }
            try { mdns?.Dispose(); } catch { /* best-effort cleanup */ }
        }
    }

    /// <summary>The pure PTR→SRV/TXT→A correlation + dedup logic <see cref="DiscoverAsync"/> runs once,
    /// after its browse window closes. <c>internal</c> (not <c>private</c>) specifically so
    /// <c>St4i.EngineApi.Tests</c> (see this assembly's <c>AssemblyInfo.cs</c> <c>InternalsVisibleTo</c>) can
    /// feed it synthetic, in-memory <see cref="Message"/>s built from hand-constructed
    /// <see cref="PTRRecord"/>/<see cref="SRVRecord"/>/<see cref="TXTRecord"/>/<see cref="AddressRecord"/>
    /// instances — a unit test of this method never opens a real socket, so it can't be flaky/unavailable
    /// the way the real loopback advertise→browse integration test legitimately can be in a locked-down
    /// sandbox. See <see cref="SiteDiscovery"/>'s own doc comment for the full 3-pass algorithm this
    /// implements.</summary>
    internal static IReadOnlyList<DiscoveredSite> CollectFromMessages(IEnumerable<Message> messages, string serviceType)
    {
        // What a PTR record answering a query for `serviceType` looks like: "{serviceType}.local" — see
        // ServiceDiscovery.QueryServiceInstances' own doc comment ("typically of the form _service._tcp")
        // and this class' own doc comment for why anchoring on this filters out unrelated zeroconf traffic.
        var ptrTargetName = serviceType.Trim().TrimEnd('.') + ".local";

        var validInstanceNames = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        var hostPortByInstance = new Dictionary<string, (string Host, int Port)>(StringComparer.OrdinalIgnoreCase);
        var txtByInstance = new Dictionary<string, Dictionary<string, string>>(StringComparer.OrdinalIgnoreCase);
        var addressesByHost = new Dictionary<string, List<string>>(StringComparer.OrdinalIgnoreCase);

        foreach (var message in messages)
        {
            try
            {
                var records = message.Answers.Concat(message.AdditionalRecords).ToList();

                // Pass 1 — establish which instance names are legitimately answering THIS query (see this
                // class' own doc comment for why: anything else sharing UDP 5353 gets ignored).
                foreach (var record in records)
                {
                    if (record is PTRRecord ptr &&
                        string.Equals(ptr.Name.ToString().TrimEnd('.'), ptrTargetName, StringComparison.OrdinalIgnoreCase))
                    {
                        validInstanceNames.Add(ptr.DomainName.ToString());
                    }
                }

                // Pass 2 — SRV (host+port)/TXT (properties), only for instances Pass 1 already validated.
                foreach (var record in records)
                {
                    var name = record.Name.ToString();

                    switch (record)
                    {
                        case SRVRecord srv when validInstanceNames.Contains(name):
                            hostPortByInstance[name] = (srv.Target.ToString(), srv.Port);
                            break;

                        case TXTRecord txt when validInstanceNames.Contains(name):
                            txtByInstance[name] = ParseTxtStrings(txt.Strings);
                            break;
                    }
                }

                // Pass 3 — A/AAAA addresses, indexed by the record's OWN name (the host name a SRV target
                // points at) — correlated against hostPortByInstance.Host below, since an address record
                // can legitimately arrive before its owning SRV, in a different message.
                foreach (var record in records)
                {
                    if (record is AddressRecord addr)
                    {
                        var key = record.Name.ToString();
                        if (!addressesByHost.TryGetValue(key, out var list))
                        {
                            list = new List<string>();
                            addressesByHost[key] = list;
                        }

                        list.Add(addr.Address.ToString());
                    }
                }
            }
            catch
            {
                // A single malformed/unexpected message from whatever else is chattering on the LAN's mDNS
                // multicast group must never abort the whole browse window — swallow and keep processing
                // the rest.
            }
        }

        var results = new List<DiscoveredSite>();
        foreach (var instanceName in validInstanceNames)
        {
            if (!hostPortByInstance.TryGetValue(instanceName, out var hostPort))
            {
                // Never resolved a SRV for this instance within the window — nothing a join wizard could
                // actually dial. See this class' own doc comment for why this is dropped, not returned
                // with a blank host.
                continue;
            }

            var addresses = addressesByHost.TryGetValue(hostPort.Host, out var addrList)
                ? addrList.Distinct().ToList()
                : new List<string>();
            var txt = txtByInstance.TryGetValue(instanceName, out var t)
                ? t
                : new Dictionary<string, string>();

            results.Add(new DiscoveredSite(instanceName, hostPort.Host, hostPort.Port, addresses, txt));
        }

        return results;
    }

    /// <summary>TXT records are a flat list of <c>key=value</c> strings (RFC 6763 §6.3) — a string with no
    /// <c>=</c> (a bare attribute, or the synthesized <c>txtvers=1</c>-style boilerplate this package's own
    /// <see cref="ServiceProfile"/> always prepends) is skipped rather than throwing on
    /// <see cref="string.Substring(int)"/> with a negative index.</summary>
    private static Dictionary<string, string> ParseTxtStrings(IEnumerable<string> strings)
    {
        var result = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
        foreach (var entry in strings)
        {
            var separatorIndex = entry.IndexOf('=');
            if (separatorIndex > 0)
            {
                result[entry[..separatorIndex]] = entry[(separatorIndex + 1)..];
            }
        }

        return result;
    }
}
