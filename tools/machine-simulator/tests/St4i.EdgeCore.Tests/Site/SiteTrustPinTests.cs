using St4i.EdgeCore.Site;
using Xunit;

namespace St4i.EdgeCore.Tests.Site;

/// <summary>
/// GĐ3 EC-2 — SECURITY tests for <see cref="SiteTrustPin.IsTrusted"/>, the fail-closed "don't trust the
/// wrong Site" guard <see cref="UnsBridge"/>'s remote client wires in as its TLS certificate-validation
/// handler. Covers the full accept/reject matrix the class's own doc comment promises: a leaf chaining to
/// the pinned CA is trusted; a self-signed leaf pinned DIRECTLY (no CA) is trusted; an unrelated
/// certificate is rejected even against a valid pin; and every malformed/missing-input shape (null
/// presented cert, blank pin, garbage pin, PEM-shaped-but-invalid pin) is rejected WITHOUT throwing.
/// </summary>
[Collection("St4i.EdgeCore.Tests.Site")]
public sealed class SiteTrustPinTests
{
    [Fact]
    public void IsTrusted_LeafChainsToThePinnedCa_ReturnsTrue()
    {
        using var ca = TestCertificates.CreateCa("Test Site CA");
        using var leaf = TestCertificates.CreateLeaf("site.example.test", ca);

        var trusted = SiteTrustPin.IsTrusted(leaf, ca.ExportCertificatePem());

        Assert.True(trusted);
    }

    [Fact]
    public void IsTrusted_SelfSignedLeafPinnedDirectly_ReturnsTrue()
    {
        using var selfSignedLeaf = TestCertificates.CreateSelfSignedLeaf("site-standalone.example.test");

        var trusted = SiteTrustPin.IsTrusted(selfSignedLeaf, selfSignedLeaf.ExportCertificatePem());

        Assert.True(trusted);
    }

    [Fact]
    public void IsTrusted_UnrelatedCertificateAgainstAValidPin_ReturnsFalse()
    {
        using var siteCa = TestCertificates.CreateCa("Test Site CA");
        using var unrelatedCa = TestCertificates.CreateCa("Unrelated CA");
        using var unrelatedLeaf = TestCertificates.CreateLeaf("attacker.example.test", unrelatedCa);

        var trusted = SiteTrustPin.IsTrusted(unrelatedLeaf, siteCa.ExportCertificatePem());

        Assert.False(trusted);
    }

    [Fact]
    public void IsTrusted_LeafSignedByADifferentCaThanThePin_ReturnsFalse()
    {
        // Same idea as the "unrelated" case above but the rejected cert is itself a well-formed,
        // correctly-issued leaf — just issued by the WRONG CA. Chain-of-trust must matter, not just
        // "is this a valid certificate at all".
        using var pinnedCa = TestCertificates.CreateCa("Pinned Site CA");
        using var otherCa = TestCertificates.CreateCa("Other Fleet's CA");
        using var wrongIssuerLeaf = TestCertificates.CreateLeaf("site.example.test", otherCa);

        var trusted = SiteTrustPin.IsTrusted(wrongIssuerLeaf, pinnedCa.ExportCertificatePem());

        Assert.False(trusted);
    }

    [Fact]
    public void IsTrusted_BlankTrustPem_ReturnsFalse_FailClosed()
    {
        using var leaf = TestCertificates.CreateSelfSignedLeaf("site.example.test");

        Assert.False(SiteTrustPin.IsTrusted(leaf, ""));
        Assert.False(SiteTrustPin.IsTrusted(leaf, "   "));
    }

    [Fact]
    public void IsTrusted_NullTrustPem_ReturnsFalse_FailClosed()
    {
        using var leaf = TestCertificates.CreateSelfSignedLeaf("site.example.test");

        Assert.False(SiteTrustPin.IsTrusted(leaf, null!));
    }

    [Fact]
    public void IsTrusted_MalformedTrustPem_ReturnsFalse_WithoutThrowing()
    {
        using var leaf = TestCertificates.CreateSelfSignedLeaf("site.example.test");

        var exception = Record.Exception(() => SiteTrustPin.IsTrusted(leaf, "not a pem at all, just garbage bytes"));

        Assert.Null(exception);
        Assert.False(SiteTrustPin.IsTrusted(leaf, "not a pem at all, just garbage bytes"));
    }

    [Fact]
    public void IsTrusted_PemShapedButInvalidContent_ReturnsFalse_WithoutThrowing()
    {
        using var leaf = TestCertificates.CreateSelfSignedLeaf("site.example.test");
        const string pemShapedGarbage = "-----BEGIN CERTIFICATE-----\nAAAA\n-----END CERTIFICATE-----";

        var exception = Record.Exception(() => SiteTrustPin.IsTrusted(leaf, pemShapedGarbage));

        Assert.Null(exception);
        Assert.False(SiteTrustPin.IsTrusted(leaf, pemShapedGarbage));
    }

    [Fact]
    public void IsTrusted_NullPresentedCertificate_ReturnsFalse_FailClosed()
    {
        using var ca = TestCertificates.CreateCa("Test Site CA");

        Assert.False(SiteTrustPin.IsTrusted(null, ca.ExportCertificatePem()));
    }

    [Fact]
    public void IsTrusted_EmptyPinnedCollection_ReturnsFalse()
    {
        // A PEM string that parses but yields zero certificates (whitespace-only after trimming headers
        // is covered by the blank-PEM test above); this covers "well-formed but empty" defensively should
        // ImportFromPem ever accept an input that produces zero entries without throwing.
        using var leaf = TestCertificates.CreateSelfSignedLeaf("site.example.test");

        Assert.False(SiteTrustPin.IsTrusted(leaf, "\n\n"));
    }
}
