using St4i.Connector.Abstractions.Models;
using Xunit;

namespace St4i.Connector.Abstractions.Tests;

/// <summary>
/// GP-3 (.superpowers/sdd/2026-07-28-wsg-plugin-connector-seam-blueprint/task-3-brief.md) — `DriverKind`
/// used to be a closed 5-member enum; a third party could never add a member to it, so as long as it
/// stayed one, no third-party connector could exist at all. This class proves the two load-bearing halves
/// of opening it into a free-form string id: (1) the five built-in ids still hold their EXACT historical
/// spellings — the compatibility guarantee real installs' `assets.db`/the web UI depend on — and (2) the
/// one deliberate casing/normalization rule (fold a case-insensitive built-in match to canonical, leave
/// anything else — including a third-party id — untouched) behaves exactly as documented on
/// <see cref="DriverKinds"/> itself.
/// </summary>
public class DriverKindsTests
{
    // ─────────────────────────────────────────────────────────────────────
    // The compatibility guarantee: the five built-in spellings, pinned as literal strings.
    // ─────────────────────────────────────────────────────────────────────
    [Fact]
    public void BuiltInConstants_MatchExactHistoricalWireSpellings()
    {
        // These are not incidental — they are the exact PascalCase member names the old `DriverKind`
        // enum serialized to (JsonStringEnumConverter, no naming policy) before GP-3, and what
        // AssetRegistryStore already has persisted into real assets.db TEXT columns. Asserting the
        // literal strings (not just "still equal to what the constant says") is the point: if any of
        // these ever drifted, this test — not a downstream symptom — is what would catch it.
        Assert.Equal("Simulated", DriverKinds.Simulated);
        Assert.Equal("HotFolderAoi", DriverKinds.HotFolderAoi);
        Assert.Equal("Mqtt", DriverKinds.Mqtt);
        Assert.Equal("Modbus", DriverKinds.Modbus);
        Assert.Equal("OpcUa", DriverKinds.OpcUa);
    }

    // ─────────────────────────────────────────────────────────────────────
    // Normalize — the casing decision.
    // ─────────────────────────────────────────────────────────────────────
    [Theory]
    [InlineData("Simulated", "Simulated")]
    [InlineData("simulated", "Simulated")]
    [InlineData("SIMULATED", "Simulated")]
    [InlineData("SiMuLaTeD", "Simulated")]
    [InlineData("hotFolderAoi", "HotFolderAoi")]
    [InlineData("HOTFOLDERAOI", "HotFolderAoi")]
    [InlineData("MQTT", "Mqtt")]
    [InlineData("mqtt", "Mqtt")]
    [InlineData("modbus", "Modbus")]
    [InlineData("MODBUS", "Modbus")]
    [InlineData("opcua", "OpcUa")]
    [InlineData("OPCUA", "OpcUa")]
    [InlineData("OpcUA", "OpcUa")]
    public void Normalize_AnyCasingOfABuiltIn_FoldsToTheCanonicalSpelling(string input, string expectedCanonical)
    {
        Assert.Equal(expectedCanonical, DriverKinds.Normalize(input));
    }

    [Theory]
    [InlineData("vendor.acme.weld")]
    [InlineData("Vendor.Acme.Weld")]
    [InlineData("VENDOR.ACME.WELD")]
    [InlineData("simulatedx")] // a near-miss/typo of a built-in — must NOT fuzzy-match, must pass through.
    [InlineData("Modbu")] // truncated near-miss of a built-in.
    public void Normalize_AnythingNotABuiltIn_PassesThroughByteForByteUnchanged(string thirdPartyId)
    {
        // The other half of the casing decision: a third-party id is opaque. This assembly does not know
        // the vendor's own canonical casing, so it never folds it — "vendor.acme.weld" and
        // "Vendor.Acme.Weld" are two DIFFERENT ids as far as this method is concerned. That is a
        // documented, deliberate consequence (see DriverKinds' own doc comment), not an oversight.
        Assert.Equal(thirdPartyId, DriverKinds.Normalize(thirdPartyId));
    }

    [Fact]
    public void Normalize_DifferentCasingOfAThirdPartyId_DoesNotCollapseToTheSameId()
    {
        // The failure mode the brief specifically warns about, proven directly: unlike the five
        // built-ins, two different casings of the SAME third-party id remain two different strings after
        // normalization — never silently unified.
        var lower = DriverKinds.Normalize("vendor.acme.weld");
        var titled = DriverKinds.Normalize("Vendor.Acme.Weld");

        Assert.NotEqual(lower, titled);
    }

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    public void Normalize_NullOrEmpty_ReturnsUnchanged(string? input)
    {
        Assert.Equal(input, DriverKinds.Normalize(input!));
    }
}
