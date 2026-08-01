using System.Security.Cryptography;
using System.Security.Cryptography.X509Certificates;

namespace St4i.EdgeCore.Tests.Site;

/// <summary>
/// GĐ3 EC-2 test helper — generates the small certificate shapes <c>SiteTrustPinTests</c>/<c>UnsBridgeTests</c>
/// both need: a self-signed "CA" (able to sign a leaf), a leaf issued by that CA, a plain self-signed leaf
/// (for the "pin the leaf directly, no CA" shape), and <see cref="Persist"/> — reloads a freshly-minted
/// certificate with <see cref="X509KeyStorageFlags.PersistKeySet"/>.
///
/// <para><b>Why <see cref="Persist"/> exists at all:</b> <see cref="CertificateRequest.CreateSelfSigned"/>/
/// <see cref="CertificateRequest.Create(X509Certificate2, DateTimeOffset, DateTimeOffset, byte[])"/> +
/// <see cref="X509Certificate2.CopyWithPrivateKey(ECDsa)"/> all hand back a certificate backed by an
/// EPHEMERAL in-memory key. That is fine for pure chain-validation tests (<c>SiteTrustPinTests</c> never
/// touches schannel), but empirically fails outright the moment either side of a REAL TLS handshake tries
/// to use such a certificate on Windows/schannel — <c>AuthenticationException</c>
/// ("the platform does not support ephemeral keys" server-side; "the credentials supplied to the package
/// were not recognized" client-side) — the EXACT SAME finding
/// <see cref="St4i.EdgeCore.Identity.DeviceIdentityStore"/>'s own doc comment documents for the device
/// identity certificate (EC-1 review C-1). <c>UnsBridgeTests</c>' full-mTLS loopback-Site forwarding test
/// therefore reloads BOTH the synthetic "Site" server certificate and the synthetic device (client)
/// certificate through this same PFX-export-then-reload-with-<c>PersistKeySet</c> round-trip before handing
/// them to MQTTnet.</para>
/// </summary>
internal static class TestCertificates
{
    private const string PfxPassword = "st4i.edgecore.tests.sitetrustpin.v1";

    public static X509Certificate2 CreateCa(string commonName)
    {
        using var ecdsa = ECDsa.Create(ECCurve.NamedCurves.nistP256);
        var request = new CertificateRequest($"CN={commonName}", ecdsa, HashAlgorithmName.SHA256);
        request.CertificateExtensions.Add(new X509BasicConstraintsExtension(certificateAuthority: true, hasPathLengthConstraint: false, pathLengthConstraint: 0, critical: true));
        request.CertificateExtensions.Add(new X509KeyUsageExtension(
            X509KeyUsageFlags.KeyCertSign | X509KeyUsageFlags.CrlSign | X509KeyUsageFlags.DigitalSignature, critical: true));
        return request.CreateSelfSigned(DateTimeOffset.UtcNow.AddDays(-1), DateTimeOffset.UtcNow.AddYears(5));
    }

    /// <summary>A leaf certificate issued (signed) by <paramref name="issuer"/>, WITH its own private key
    /// attached (an ephemeral key — see this class's own doc comment; callers that need a real TLS
    /// handshake to succeed must additionally call <see cref="Persist"/>).</summary>
    public static X509Certificate2 CreateLeaf(string commonName, X509Certificate2 issuer)
    {
        using var ecdsa = ECDsa.Create(ECCurve.NamedCurves.nistP256);
        var request = new CertificateRequest($"CN={commonName}", ecdsa, HashAlgorithmName.SHA256);
        request.CertificateExtensions.Add(new X509BasicConstraintsExtension(certificateAuthority: false, hasPathLengthConstraint: false, pathLengthConstraint: 0, critical: true));
        request.CertificateExtensions.Add(new X509KeyUsageExtension(
            X509KeyUsageFlags.DigitalSignature | X509KeyUsageFlags.KeyEncipherment, critical: true));

        var serial = Guid.NewGuid().ToByteArray();
        using var publicOnly = request.Create(issuer, DateTimeOffset.UtcNow.AddDays(-1), DateTimeOffset.UtcNow.AddYears(1), serial);
        return publicOnly.CopyWithPrivateKey(ecdsa);
    }

    /// <summary>A plain self-signed leaf (not a CA) — the "pin the Site's own leaf directly, no
    /// intermediate CA" trust shape.</summary>
    public static X509Certificate2 CreateSelfSignedLeaf(string commonName)
    {
        using var ecdsa = ECDsa.Create(ECCurve.NamedCurves.nistP256);
        var request = new CertificateRequest($"CN={commonName}", ecdsa, HashAlgorithmName.SHA256);
        request.CertificateExtensions.Add(new X509BasicConstraintsExtension(certificateAuthority: false, hasPathLengthConstraint: false, pathLengthConstraint: 0, critical: true));
        return request.CreateSelfSigned(DateTimeOffset.UtcNow.AddDays(-1), DateTimeOffset.UtcNow.AddYears(1));
    }

    /// <summary>Round-trips <paramref name="cert"/> through a PFX export/reload with
    /// <see cref="X509KeyStorageFlags.PersistKeySet"/> — see this class's own doc comment for why a real
    /// TLS handshake (unlike pure chain validation) needs this.</summary>
    public static X509Certificate2 Persist(X509Certificate2 cert)
    {
        var pfxBytes = cert.Export(X509ContentType.Pfx, PfxPassword);
        return X509CertificateLoader.LoadPkcs12(pfxBytes, PfxPassword, X509KeyStorageFlags.PersistKeySet);
    }
}
