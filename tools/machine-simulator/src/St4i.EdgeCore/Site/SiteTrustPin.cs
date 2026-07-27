using System.Security.Cryptography.X509Certificates;

namespace St4i.EdgeCore.Site;

/// <summary>
/// GĐ3 EC-2 — SECURITY-CRITICAL. Validates a Site broker's presented TLS certificate against the
/// operator-pinned trust anchor (<see cref="PersistedSiteLink.SiteTrustPem"/>) — a CA certificate the
/// Site's leaf chains to, OR the Site's own self-signed leaf pinned directly. This is the "don't trust the
/// wrong Site" guard: <see cref="UnsBridge"/>'s remote (Site) MQTT client wires this in as its
/// <c>WithCertificateValidationHandler</c>, so it is the ONLY thing standing between this device's local
/// UNS spine and an attacker who can get a TCP listener on <c>Host:Port</c> (DNS spoofing, a rogue AP, a
/// compromised network segment, ...) — the machine's ambient default CA trust store is DELIBERATELY
/// IRRELEVANT here (<see cref="X509ChainTrustMode.CustomRootTrust"/>): a globally-trusted public CA saying
/// "yes" means nothing for "is this actually MY operator's Site broker".
///
/// <para><b>FAIL-CLOSED, by construction:</b> every non-happy-path returns <see langword="false"/>, never
/// throws, and there is no code path that returns <see langword="true"/> without a real
/// <see cref="X509Chain.Build"/> success against the caller-pinned trust store:
/// <list type="bullet">
/// <item><paramref name="presented"/> is <see langword="null"/> → not trusted (nothing to validate).</item>
/// <item><paramref name="siteTrustPem"/> is <see langword="null"/>/blank/whitespace-only → not trusted
/// (an unconfigured or accidentally-cleared pin must never mean "trust anything").</item>
/// <item><paramref name="siteTrustPem"/> doesn't parse as PEM certificate(s) (garbage, truncated, wrong
/// label) → <see cref="X509Certificate2Collection.ImportFromPem"/> throws <see cref="System.Security.Cryptography.CryptographicException"/>,
/// caught here → not trusted, never propagated as an exception (a malformed pin must degrade to "nothing
/// pinned", not crash the bridge's TLS handshake callback).</item>
/// <item><paramref name="siteTrustPem"/> parses but yields zero certificates → not trusted (empty pin ==
/// no pin).</item>
/// <item><paramref name="presented"/> doesn't chain to anything in the pinned store (wrong CA, an
/// unrelated cert, an expired/not-yet-valid cert, ...) → <see cref="X509Chain.Build"/> returns
/// <see langword="false"/> → not trusted.</item>
/// </list>
/// The ONLY way this returns <see langword="true"/> is a real chain build succeeding against the exact
/// bytes the operator configured — see <c>SiteTrustPinTests</c> (<c>tests/St4i.EdgeCore.Tests/Site/</c>)
/// for the full accept/reject matrix.</para>
///
/// <para><b>Why <see cref="X509RevocationMode.NoCheck"/>:</b> this is a private pinned trust relationship
/// (an operator manually configuring which Site a device may federate to), not a public-CA chain — there is
/// no CRL/OCSP endpoint for a private/self-signed Site CA to check against, and even attempting revocation
/// checking would make the bridge's TLS handshake depend on external network reachability it has no
/// business needing. The pin itself (an operator explicitly re-provisioning <see cref="PersistedSiteLink.SiteTrustPem"/>)
/// IS this system's revocation mechanism.</para>
///
/// <para><b>Why both <c>CustomTrustStore</c> and <c>ExtraStore</c> get the same pinned collection:</b>
/// <c>CustomTrustStore</c> is what <see cref="X509ChainTrustMode.CustomRootTrust"/> actually trusts as
/// roots; <c>ExtraStore</c> additionally makes the same certificate(s) available to the chain BUILDER as
/// candidate intermediates/issuers. For the "CA pins a leaf" shape these overlap harmlessly; for a
/// multi-certificate PEM (e.g. an intermediate bundled with a root) this is what lets the builder actually
/// assemble the chain instead of failing to find the intermediate.</para>
/// </summary>
public static class SiteTrustPin
{
    /// <summary>Pure, allocation-light, never-throwing. See this class's own doc comment for the full
    /// fail-closed contract.</summary>
    public static bool IsTrusted(X509Certificate2? presented, string siteTrustPem)
    {
        if (presented is null || string.IsNullOrWhiteSpace(siteTrustPem)) return false;

        var pinned = new X509Certificate2Collection();
        try
        {
            pinned.ImportFromPem(siteTrustPem);
        }
        catch
        {
            // Malformed/garbage/truncated PEM — degrade to "nothing pinned", never throw out of a
            // TLS validation callback (that would tear down the handshake with an unhandled exception
            // instead of a clean "reject").
            return false;
        }

        if (pinned.Count == 0) return false;

        using var chain = new X509Chain();
        chain.ChainPolicy.TrustMode = X509ChainTrustMode.CustomRootTrust;
        chain.ChainPolicy.RevocationMode = X509RevocationMode.NoCheck; // private pinned trust, no OCSP/CRL — see doc comment
        chain.ChainPolicy.CustomTrustStore.AddRange(pinned);
        chain.ChainPolicy.ExtraStore.AddRange(pinned); // so a pinned intermediate is available to the builder
        return chain.Build(presented);
    }
}
