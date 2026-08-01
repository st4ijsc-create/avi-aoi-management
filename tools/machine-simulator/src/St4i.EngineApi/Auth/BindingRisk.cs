namespace St4i.EngineApi.Auth;

/// <summary>
/// WS-D-D5 — pure, I/O-free risk assessment over the server's ACTUAL bound addresses (as reported by
/// <c>IServerAddressesFeature</c> post-start — see <c>Program.cs</c>'s <c>ApplicationStarted</c>
/// registration for the caller), so it is fully unit-testable with no <c>WebApplicationFactory</c>/host
/// needed. A binding is "risky" when it serves PLAIN HTTP on a NON-LOOPBACK host: the cookie-session auth
/// D1 built (and every credential it protects) would then traverse whatever network reaches that host in
/// cleartext — an HTTPS binding is safe regardless of host (the brief's "https scheme -> not risky
/// regardless of host"), and an HTTP binding is safe ONLY when it's loopback-only (nothing off-box can
/// even reach it).
///
/// Loopback = host is (case-insensitively) <c>localhost</c>, <c>127.0.0.1</c>, or <c>[::1]</c> — exactly
/// the brief's three forms, not the whole 127.0.0.0/8 range or every IPv6 loopback spelling. Everything
/// else — <c>0.0.0.0</c>, ASP.NET Core's <c>+</c>/<c>*</c> "bind to all interfaces" wildcards, a LAN IP, a
/// hostname — is non-loopback.
///
/// Deliberately hand-parses the URL instead of <see cref="Uri"/>: Kestrel's own bound-address strings can
/// contain <c>+</c>/<c>*</c> host placeholders (<c>http://+:5199</c>, <c>http://*:5199</c>) that
/// <see cref="Uri"/> either rejects or mis-parses, so a purpose-built split on <c>"://"</c> then the
/// authority's trailing <c>:port</c> is both simpler and more correct for this exact input shape than
/// routing through general-purpose URI parsing.
/// </summary>
public static class BindingRisk
{
    /// <summary>Returns a human-readable warning naming every risky binding in <paramref name="boundUrls"/>,
    /// or <see langword="null"/> when none of them are risky (including an empty/null-only list).</summary>
    public static string? Describe(IEnumerable<string> boundUrls)
    {
        ArgumentNullException.ThrowIfNull(boundUrls);

        var risky = new List<string>();
        foreach (var url in boundUrls)
        {
            if (!string.IsNullOrWhiteSpace(url) && IsRiskyHttpBinding(url))
            {
                risky.Add(url);
            }
        }

        if (risky.Count == 0)
        {
            return null;
        }

        return
            $"Insecure network exposure: {string.Join(", ", risky)} serve(s) plain HTTP on a non-loopback " +
            "address. Session cookies and any credentials sent to this API would traverse the local " +
            "network in CLEARTEXT, readable by anyone else on that network. Bind to a loopback-only " +
            "address (localhost/127.0.0.1/[::1]) or put this host behind HTTPS.";
    }

    private static bool IsRiskyHttpBinding(string url)
    {
        var schemeEnd = url.IndexOf("://", StringComparison.Ordinal);
        if (schemeEnd < 0)
        {
            return false; // not a recognizable scheme://host[:port] shape — nothing to flag.
        }

        var scheme = url[..schemeEnd];
        if (!string.Equals(scheme, "http", StringComparison.OrdinalIgnoreCase))
        {
            return false; // https (or anything else) is out of scope for this check regardless of host.
        }

        var afterScheme = url[(schemeEnd + 3)..];
        var authorityEnd = afterScheme.IndexOfAny(PathQueryFragmentSeparators);
        var authority = authorityEnd >= 0 ? afterScheme[..authorityEnd] : afterScheme;

        return !IsLoopbackHost(ExtractHost(authority));
    }

    private static readonly char[] PathQueryFragmentSeparators = { '/', '?', '#' };

    private static string ExtractHost(string authority)
    {
        if (authority.StartsWith('['))
        {
            // Bracketed IPv6, e.g. "[::1]:5199" — the host IS the bracketed form, port (if any) trails it.
            var closeBracket = authority.IndexOf(']');
            return closeBracket >= 0 ? authority[..(closeBracket + 1)] : authority;
        }

        var lastColon = authority.LastIndexOf(':');
        return lastColon >= 0 ? authority[..lastColon] : authority;
    }

    private static bool IsLoopbackHost(string host) =>
        string.Equals(host, "localhost", StringComparison.OrdinalIgnoreCase) ||
        string.Equals(host, "127.0.0.1", StringComparison.Ordinal) ||
        string.Equals(host, "[::1]", StringComparison.OrdinalIgnoreCase);
}
