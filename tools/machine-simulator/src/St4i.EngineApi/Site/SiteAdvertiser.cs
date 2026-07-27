using System.Reflection;
using System.Text;
using Makaretu.Dns;
using Microsoft.Extensions.Hosting;
using St4i.EdgeCore.Identity;
using St4i.EdgeCore.Uns;

namespace St4i.EngineApi.Site;

/// <summary>
/// GĐ3 closeout WI-1 Part B (<c>.superpowers/sdd/2026-07-28-giaidoan3-ws-i-closeout-blueprint/task-1-brief.md</c>)
/// — the mirror image of <see cref="SiteDiscovery"/>: instead of the machine BROWSING the LAN for a
/// SYNAPSE Site, this ADVERTISES the machine itself over mDNS, so a Site's own join flow can find it
/// without an operator hand-typing a host/port. Deliberately a DIFFERENT service type
/// (<see cref="DefaultServiceType"/>, <c>_st4i-machine._tcp</c>) than <see cref="SiteDiscovery.DefaultServiceType"/>
/// (<c>_synapse-site._tcp</c>) — a Site advertises the Site type; a machine advertises the machine type.
/// </summary>
public interface ISiteAdvertiser : IAsyncDisposable
{
    /// <summary><see langword="true"/> once a <see cref="Start"/> call has actually begun advertising (a
    /// live <see cref="MulticastService"/> is up and the profile has been handed to
    /// <see cref="ServiceDiscovery.Advertise"/>). Stays <see langword="false"/> when advertising is disabled
    /// (<see cref="UnsOptions.Enabled"/> is <see langword="false"/>, or <see cref="EnvVarAdvertise"/> is set
    /// to <c>0</c>/<c>false</c>) or when the last <see cref="Start"/> attempt failed for any reason (no
    /// multicast-capable NIC, the port couldn't be resolved yet, ...).</summary>
    bool IsAdvertising { get; }

    /// <summary>Attempts to begin advertising. NEVER throws — any failure (no multicast-capable NIC, the
    /// host's own listening address not resolvable yet, a firewall silently dropping multicast, ...) is
    /// logged and leaves <see cref="IsAdvertising"/> <see langword="false"/>, exactly as if this had never
    /// been called; the caller (a hosted service's own startup) always proceeds normally either way. Calling
    /// this again while already advertising is a harmless no-op (never opens a second socket); calling it
    /// again after a failed attempt retries.</summary>
    void Start();

    /// <summary>Stops advertising (best-effort <see cref="ServiceDiscovery.Unadvertise(ServiceProfile)"/>,
    /// then disposes the underlying <see cref="MulticastService"/>/<see cref="ServiceDiscovery"/> pair) and
    /// leaves <see cref="IsAdvertising"/> <see langword="false"/>. Idempotent and clean to call more than
    /// once, or when never actually started.</summary>
    Task StopAsync();
}

/// <summary>
/// <see cref="ISiteAdvertiser"/>'s implementation, built on the SAME <c>Makaretu.Dns.Multicast.New</c> 0.38.0
/// package <see cref="SiteDiscovery"/> uses (see that class' own doc comment for the package's own
/// licensing/de-risk history) — but unlike <see cref="SiteDiscovery.DiscoverAsync"/> (which builds and
/// disposes an ephemeral <see cref="MulticastService"/>/<see cref="ServiceDiscovery"/> pair PER CALL), this
/// class keeps ONE such pair alive for its whole advertising lifetime: advertising is a standing
/// announcement ("here I am, always"), not a bounded, operator-initiated scan.
///
/// <para><b>Instance name:</b> the SANITIZED <see cref="DeviceIdentity.NodeId"/> (see
/// <see cref="SanitizeInstanceName"/>) — a raw NodeId is arbitrary operator/config-supplied text (it flows
/// straight from <see cref="UnsOptions.Cell"/> at first-run identity creation — see
/// <see cref="DeviceIdentityStore.LoadOrCreate"/>), and while Makaretu's own <see cref="ServiceProfile"/>
/// happens to escape/tolerate unusual characters without throwing (confirmed empirically), a sanitized,
/// human-readable label is what an operator actually wants to see show up in a Site's own join UI.</para>
///
/// <para><b>Port: read from the ACTUAL bound server addresses, never hard-coded.</b> The <c>resolveBoundAddresses</c>
/// ctor parameter is a plain delegate (<see cref="Func{TResult}"/>) rather than a direct
/// <c>Microsoft.AspNetCore.Hosting.Server.IServer</c> dependency — same "keep ASP.NET-Core-hosting-specific
/// types out of the directly-testable class" idiom this project's own
/// <c>St4i.EngineApi.Auth.BindingRisk.Describe(string[])</c> already established (see its own tests): the
/// production DI registration in <c>Program.cs</c> supplies
/// <c>() =&gt; sp.GetRequiredService&lt;IServer&gt;().Features.Get&lt;IServerAddressesFeature&gt;()?.Addresses</c>,
/// while every test here supplies a trivial in-memory delegate instead. <c>IServerAddressesFeature</c> is
/// only populated once Kestrel has ACTUALLY begun listening (see the WS-D-D5 binding-risk check in
/// <c>Program.cs</c> for the same constraint already documented there) — which is why <c>StartAsync</c>
/// below defers the real <see cref="Start"/> attempt to <see cref="IHostApplicationLifetime.ApplicationStarted"/>
/// rather than calling it immediately.</para>
///
/// <para><b>Never-crashes-the-host, same discipline as <c>AlarmEvaluatorService</c>
/// (<c>St4i.EngineApi.Alarms</c>, the FIRST <see cref="IHostedService"/> in this project — this is the
/// SECOND):</b> the entirety of <see cref="Start"/>'s real work is wrapped in one try/catch; any failure is
/// logged via the ctor's <c>logError</c> callback and leaves <see cref="IsAdvertising"/> false — a machine
/// with no usable multicast-capable NIC, or a firewall silently dropping the traffic, still starts and
/// serves its normal HTTP surface exactly as if <c>ST4I_MDNS_ADVERTISE=0</c> had been set.</para>
///
/// <para><b>Enablement:</b> default ON whenever <see cref="UnsOptions.Enabled"/> is <see langword="true"/>
/// (the product-decision exception to this codebase's usual "off by default" additive idiom — see this
/// task's own report for the explicit sign-off) — <see cref="EnvVarAdvertise"/> set to <c>0</c>/<c>false</c>
/// disables it independently of UNS, same "0/false (case-insensitive) disables" convention
/// <see cref="UnsOptions.FromEnvironment"/> already uses for <see cref="UnsOptions.EnvVarEnabled"/>.</para>
/// </summary>
public sealed class SiteAdvertiser : ISiteAdvertiser, IHostedService
{
    /// <summary>Overrides the mDNS service type this instance advertises under. Same "ctor-arg &gt; env &gt;
    /// built-in-default" precedence as <see cref="SiteDiscovery.EnvVarServiceType"/>.</summary>
    public const string EnvVarServiceType = "ST4I_MDNS_SERVICE_TYPE";

    /// <summary>The machine's OWN mDNS service type — deliberately different from
    /// <see cref="SiteDiscovery.DefaultServiceType"/> (<c>_synapse-site._tcp</c>, what a Site advertises and
    /// this device browses FOR): a Site browses for machines under THIS type, never the other way
    /// around.</summary>
    public const string DefaultServiceType = "_st4i-machine._tcp";

    /// <summary>Set to <c>0</c> or <c>false</c> (case-insensitive) to disable advertising even though
    /// <see cref="UnsOptions.Enabled"/> is <see langword="true"/> — independent of, and checked in addition
    /// to, the UNS gate. Same idiom as <see cref="UnsOptions.EnvVarEnabled"/>.</summary>
    public const string EnvVarAdvertise = "ST4I_MDNS_ADVERTISE";

    private readonly UnsOptions _unsOptions;
    private readonly DeviceIdentity _identity;
    private readonly Func<IReadOnlyCollection<string>?> _resolveBoundAddresses;
    private readonly IHostApplicationLifetime? _lifetime;
    private readonly string _serviceType;
    private readonly Action<Exception, string>? _logError;
    private readonly object _gate = new();

    private MulticastService? _mdns;
    private ServiceDiscovery? _sd;
    private ServiceProfile? _profile;
    private bool _disposed;

    /// <inheritdoc/>
    /// <remarks>Computed, not separately tracked state: <see langword="true"/> exactly when
    /// <c>_mdns</c> is non-null, which <see cref="Start"/>/<see cref="StopAsync"/> always keep in
    /// lockstep with the rest of the live-advertising fields — a separate bool could only ever drift
    /// from that, never legitimately disagree with it.</remarks>
    public bool IsAdvertising => _mdns is not null;

    /// <param name="unsOptions">Supplies the ISA-95 address (<see cref="UnsOptions.Site"/>/<see cref="UnsOptions.Area"/>/
    /// <see cref="UnsOptions.Line"/>/<see cref="UnsOptions.Cell"/>) for the TXT records, and
    /// <see cref="UnsOptions.Enabled"/> gates advertising on/off alongside <see cref="EnvVarAdvertise"/>.</param>
    /// <param name="identity">This device's own identity — <see cref="DeviceIdentity.NodeId"/> (sanitized)
    /// becomes the mDNS instance name; <see cref="DeviceIdentity.NodeId"/>/<see cref="DeviceIdentity.Fingerprint"/>
    /// both also go into the TXT records.</param>
    /// <param name="resolveBoundAddresses">Returns the host's currently-bound listen addresses (e.g.
    /// <c>["http://localhost:5199"]</c>), or <see langword="null"/>/empty if the server hasn't started
    /// listening yet — see this class' own doc comment for why this is a plain delegate, not a direct
    /// ASP.NET Core hosting dependency.</param>
    /// <param name="lifetime"><see langword="null"/> in tests (which call <see cref="Start"/> directly);
    /// supplied by the real DI registration so <see cref="StartAsync"/> can defer the actual attempt to
    /// <see cref="IHostApplicationLifetime.ApplicationStarted"/> (see this class' own doc comment).</param>
    /// <param name="serviceType">Explicit override (mainly for tests — a throwaway service type per test
    /// avoids cross-test mDNS traffic collisions). <see langword="null"/>/blank falls through to
    /// <see cref="EnvVarServiceType"/>, then <see cref="DefaultServiceType"/>.</param>
    /// <param name="logError">Invoked (never thrown) whenever a <see cref="Start"/> attempt fails
    /// internally.</param>
    public SiteAdvertiser(
        UnsOptions unsOptions,
        DeviceIdentity identity,
        Func<IReadOnlyCollection<string>?> resolveBoundAddresses,
        IHostApplicationLifetime? lifetime = null,
        string? serviceType = null,
        Action<Exception, string>? logError = null)
    {
        _unsOptions = unsOptions ?? throw new ArgumentNullException(nameof(unsOptions));
        _identity = identity ?? throw new ArgumentNullException(nameof(identity));
        _resolveBoundAddresses = resolveBoundAddresses ?? throw new ArgumentNullException(nameof(resolveBoundAddresses));
        _lifetime = lifetime;
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

    // ─────────────────────────────────────────────────────────────────────
    // IHostedService — the SECOND one in St4i.EngineApi (AlarmEvaluatorService is the first).
    // ─────────────────────────────────────────────────────────────────────

    /// <summary>Never blocks and never throws: with a real <paramref name="cancellationToken"/>/lifetime,
    /// defers the actual <see cref="Start"/> attempt to <see cref="IHostApplicationLifetime.ApplicationStarted"/>
    /// (see this class' own doc comment for why) — and even then, runs it on the thread pool
    /// (<see cref="Task.Run(Action)"/>) rather than inline on the callback, since <c>ApplicationStarted</c>'s
    /// callbacks all run synchronously as part of the generic host's own <c>StartAsync</c> (the SAME chain
    /// the WS-D-D5 binding-risk check in <c>Program.cs</c> also hangs off), and <see cref="Start"/>'s real
    /// work (enumerating network interfaces, joining a multicast group) is genuine socket I/O that must
    /// never add to that shared critical path. With no lifetime supplied (tests constructing this type
    /// directly as an <see cref="IHostedService"/>, if ever), calls <see cref="Start"/> immediately instead —
    /// either way this method itself always completes synchronously.</summary>
    public Task StartAsync(CancellationToken cancellationToken)
    {
        if (_lifetime is not null)
        {
            _lifetime.ApplicationStarted.Register(() => _ = Task.Run(Start));
        }
        else
        {
            Start();
        }

        return Task.CompletedTask;
    }

    Task IHostedService.StopAsync(CancellationToken cancellationToken) => StopAsync();

    // ─────────────────────────────────────────────────────────────────────
    // ISiteAdvertiser
    // ─────────────────────────────────────────────────────────────────────

    /// <inheritdoc/>
    public void Start()
    {
        lock (_gate)
        {
            if (_disposed || IsAdvertising)
            {
                // Already disposed, or already advertising — a second Start() call is a harmless no-op
                // (never opens a second socket). A PRIOR FAILED attempt (IsAdvertising still false) is not
                // guarded here, so a later Start() call can legitimately retry.
                return;
            }

            if (!IsAdvertiseEnabled(_unsOptions))
            {
                return;
            }

            try
            {
                var port = ResolvePort(_resolveBoundAddresses());
                var instanceName = SanitizeInstanceName(_identity.NodeId);

                var mdns = new MulticastService();
                var sd = new ServiceDiscovery(mdns);
                var profile = new ServiceProfile(instanceName, _serviceType, (ushort)port);
                foreach (var kv in BuildTxtRecords(_unsOptions, _identity))
                {
                    profile.AddProperty(kv.Key, kv.Value);
                }

                // Same construction order SiteDiscoveryTests' own de-risk-gate proof uses (Advertise() THEN
                // mdns.Start()) — confirmed empirically to work end to end on net10.0-windows.
                sd.Advertise(profile);
                mdns.Start();

                // IsAdvertising is computed off _mdns (see its own doc comment) — setting these three is
                // what flips it true, with no separate assignment needed.
                _mdns = mdns;
                _sd = sd;
                _profile = profile;
            }
            catch (Exception ex)
            {
                _logError?.Invoke(ex, $"mDNS Site advertise failed for service type '{_serviceType}'.");
            }
        }
    }

    /// <inheritdoc/>
    public Task StopAsync()
    {
        MulticastService? mdns;
        ServiceDiscovery? sd;
        ServiceProfile? profile;
        lock (_gate)
        {
            mdns = _mdns;
            sd = _sd;
            profile = _profile;
            _mdns = null;
            _sd = null;
            _profile = null;
        }

        // Best-effort, individually guarded — same "one cleanup call's failure must never mask or skip the
        // others" discipline as SiteDiscovery.DiscoverAsync's own finally block.
        try { if (sd is not null && profile is not null) sd.Unadvertise(profile); } catch { /* best-effort cleanup */ }
        try { sd?.Dispose(); } catch { /* best-effort cleanup */ }
        try { mdns?.Stop(); } catch { /* best-effort cleanup */ }
        try { mdns?.Dispose(); } catch { /* best-effort cleanup */ }

        return Task.CompletedTask;
    }

    /// <inheritdoc/>
    public async ValueTask DisposeAsync()
    {
        lock (_gate)
        {
            _disposed = true;
        }

        await StopAsync().ConfigureAwait(false);
    }

    // ─────────────────────────────────────────────────────────────────────
    // Pure helpers — internal so St4i.EngineApi.Tests (this assembly's existing AssemblyInfo.cs
    // InternalsVisibleTo) can exercise them directly, same seam convention as SiteDiscovery.CollectFromMessages.
    // ─────────────────────────────────────────────────────────────────────

    /// <summary><see langword="false"/> when <see cref="UnsOptions.Enabled"/> is off, OR
    /// <see cref="EnvVarAdvertise"/> is <c>0</c>/<c>false</c> (case-insensitive) — both checked fresh on
    /// every <see cref="Start"/> call (not cached at construction), same "read once per decision, not once
    /// per process" posture as <see cref="UnsOptions.FromEnvironment"/> itself.</summary>
    internal static bool IsAdvertiseEnabled(UnsOptions unsOptions)
    {
        if (!unsOptions.Enabled)
        {
            return false;
        }

        var raw = Environment.GetEnvironmentVariable(EnvVarAdvertise);
        if (raw == "0" || string.Equals(raw, "false", StringComparison.OrdinalIgnoreCase))
        {
            return false;
        }

        return true;
    }

    /// <summary>Parses a TCP port out of the host's own bound listen addresses (e.g.
    /// <c>"http://localhost:5199"</c>) — the FIRST address that parses as an absolute URI with a positive
    /// port wins. Throws (caught by <see cref="Start"/>'s own try/catch) when
    /// <paramref name="addresses"/> is <see langword="null"/>/empty, or none of them parse — e.g. this
    /// hosted service's own <see cref="StartAsync"/> ran before Kestrel actually bound anything, which
    /// <see cref="Start"/> reports the same way it would report any other startup failure: log + never
    /// advertise, never throw out of the caller.</summary>
    internal static int ResolvePort(IReadOnlyCollection<string>? addresses)
    {
        if (addresses is null || addresses.Count == 0)
        {
            throw new InvalidOperationException(
                "No server addresses are bound yet — the host may not have started listening.");
        }

        foreach (var address in addresses)
        {
            if (Uri.TryCreate(address, UriKind.Absolute, out var uri) && uri.Port > 0)
            {
                return uri.Port;
            }
        }

        throw new InvalidOperationException(
            $"Could not parse a port out of the bound server addresses ({string.Join(", ", addresses)}).");
    }

    /// <summary>Reduces an arbitrary <see cref="DeviceIdentity.NodeId"/> to a DNS-label-safe mDNS instance
    /// name: trims surrounding whitespace, keeps <c>[A-Za-z0-9._-]</c>, replaces every other character with
    /// <c>_</c>, and falls back to a fixed constant if that leaves nothing at all — same sanitize-don't-throw
    /// shape as <see cref="DeviceIdentityStore"/>'s own <c>SanitizeForCommonName</c> (a separate, private
    /// copy here rather than a shared dependency: <see cref="ServiceProfile"/>'s own instance-name parameter
    /// has different — looser — validity rules than an X.500 <c>CN=</c>, so this is deliberately its own
    /// small, independently-documented method, not a reused one).</summary>
    internal static string SanitizeInstanceName(string nodeId)
    {
        var trimmed = (nodeId ?? string.Empty).Trim();
        if (trimmed.Length == 0)
        {
            return "st4i-machine";
        }

        var sb = new StringBuilder(trimmed.Length);
        foreach (var c in trimmed)
        {
            sb.Append(char.IsLetterOrDigit(c) || c is '.' or '_' or '-' ? c : '_');
        }

        return sb.Length == 0 ? "st4i-machine" : sb.ToString();
    }

    /// <summary>The TXT record set the brief specifies, verbatim: <c>node</c>/<c>fp</c> from
    /// <see cref="DeviceIdentity"/>, <c>site</c>/<c>area</c>/<c>line</c>/<c>cell</c> from
    /// <see cref="UnsOptions"/>'s own ISA-95 address, and <c>v</c> — this assembly's own
    /// <see cref="AssemblyInformationalVersionAttribute"/> (driven by <c>Directory.Build.props</c>'
    /// single <c>&lt;Version&gt;</c>, the same property <c>CapabilitiesEndpoints</c>' <c>GET /v1/capabilities</c>
    /// already surfaces off <see cref="Assembly.GetName"/>'s <c>Version</c> — this uses the informational
    /// attribute specifically, per the brief's own wording).</summary>
    internal static IReadOnlyDictionary<string, string> BuildTxtRecords(UnsOptions unsOptions, DeviceIdentity identity) =>
        new Dictionary<string, string>
        {
            ["node"] = identity.NodeId,
            ["fp"] = identity.Fingerprint,
            ["site"] = unsOptions.Site,
            ["area"] = unsOptions.Area,
            ["line"] = unsOptions.Line,
            ["cell"] = unsOptions.Cell,
            ["v"] = AssemblyInformationalVersion(),
        };

    private static string AssemblyInformationalVersion()
    {
        var asm = typeof(SiteAdvertiser).Assembly;
        return asm.GetCustomAttribute<AssemblyInformationalVersionAttribute>()?.InformationalVersion
            ?? asm.GetName().Version?.ToString()
            ?? "0.0.0";
    }
}
