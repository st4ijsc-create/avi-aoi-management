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

    // ─────────────────────────────────────────────────────────────────────
    // Task-7 (whole-batch review, IMPORTANT) — whitespace-padded built-ins must still fold: the bug this
    // closes was that DriverKinds.IsFabricated(" Simulated ") (the exact shape an untrimmed fleet.json
    // field can produce, since FleetConfig.Load never trimmed before this fix) silently failed open to
    // "real" because Normalize's own OrdinalIgnoreCase comparison never matched an unequal-length padded
    // string.
    // ─────────────────────────────────────────────────────────────────────
    [Theory]
    [InlineData(" Simulated ", "Simulated")]
    [InlineData("\tModbus\n", "Modbus")]
    [InlineData("  opcua  ", "OpcUa")]
    public void Normalize_WhitespacePaddedBuiltIn_TrimsThenFoldsToCanonicalSpelling(string input, string expectedCanonical)
    {
        Assert.Equal(expectedCanonical, DriverKinds.Normalize(input));
    }

    [Fact]
    public void Normalize_WhitespacePaddedThirdPartyId_PassesThroughUntrimmed()
    {
        // A non-matching id's OWN whitespace is its author's concern — this method only trims to widen
        // the built-in MATCH, it never launders an unrecognized id's surrounding whitespace away.
        const string padded = "  vendor.acme.weld  ";
        Assert.Equal(padded, DriverKinds.Normalize(padded));
    }

    // ─────────────────────────────────────────────────────────────────────
    // SM-2 (.superpowers/sdd/2026-07-29-dotA-single-machine-sellable-blueprint/task-2-brief.md) —
    // IsFabricated: the single canonical "is this reading manufactured, never real process data" call
    // path, mirroring Normalize's own "one comparison rule" contract. Simulated is the ONLY built-in kind
    // this codebase ever manufactures data for; every other built-in and every third-party id is real.
    // ─────────────────────────────────────────────────────────────────────
    [Theory]
    [InlineData("Simulated")]
    [InlineData("simulated")]
    [InlineData("SIMULATED")]
    public void IsFabricated_AnyCasingOfSimulated_ReturnsTrue(string driverKind)
    {
        Assert.True(DriverKinds.IsFabricated(driverKind));
    }

    [Theory]
    [InlineData("HotFolderAoi")]
    [InlineData("Mqtt")]
    [InlineData("Modbus")]
    [InlineData("modbus")]
    [InlineData("OpcUa")]
    [InlineData("opcua")]
    [InlineData("vendor.acme.weld")]
    [InlineData("Vendor.Acme.Weld")]
    public void IsFabricated_EveryOtherBuiltInAndAnyThirdPartyId_ReturnsFalse(string driverKind)
    {
        Assert.False(DriverKinds.IsFabricated(driverKind));
    }

    // ─────────────────────────────────────────────────────────────────────
    // Task-7 (whole-batch review, small item) — three inputs the review found untested: IsFabricated
    // silently "fails open" to false (real) for null/empty, and (before the Normalize trim fix above) for
    // a whitespace-padded "Simulated" too. Pinned here as DELIBERATE, documented behavior (see
    // IsFabricated's own doc comment for why null/empty resolving a call-site's own ambiguity is NOT this
    // method's job), not an untested accident.
    // ─────────────────────────────────────────────────────────────────────
    [Fact]
    public void IsFabricated_Null_ReturnsFalse_FailsOpenToReal_Deliberately()
    {
        Assert.False(DriverKinds.IsFabricated(null));
    }

    [Fact]
    public void IsFabricated_Empty_ReturnsFalse_FailsOpenToReal_Deliberately()
    {
        Assert.False(DriverKinds.IsFabricated(""));
    }

    [Theory]
    [InlineData(" Simulated ")]
    [InlineData("\tSimulated\n")]
    [InlineData("  simulated  ")]
    public void IsFabricated_WhitespacePaddedSimulated_ReturnsTrue(string driverKind)
    {
        // The Normalize trim fix's own end-to-end proof: a padded "Simulated" must be recognized as
        // fabricated, not silently pass through as an "unrecognized" (therefore real) third-party id.
        Assert.True(DriverKinds.IsFabricated(driverKind));
    }
}
