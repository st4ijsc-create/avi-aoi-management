namespace St4i.EngineApi.AssetRegistry;

/// <summary>
/// P2-1 (WS-J Asset Registry) — builds the canonical ISA-95 asset URN:
/// <c>urn:isa95:{site}:{area}:{line}:{cell}:{equipment}</c>. The address segments (site/area/line/cell)
/// come from the SAME process-wide <see cref="St4i.EdgeCore.Uns.UnsOptions"/> that
/// <c>UnsTopicBuilder</c> already addresses equipment with — one address, one URN scheme, everywhere in
/// this host. <c>equipment</c> is the machine's <see cref="St4i.EdgeCore.Models.MachineDescriptor.Code"/>.
/// </summary>
public static class IsaUrnBuilder
{
    public static string Build(string site, string area, string line, string cell, string equipment)
        => $"urn:isa95:{Seg(site)}:{Seg(area)}:{Seg(line)}:{Seg(cell)}:{Seg(equipment)}";

    /// <summary>A blank/whitespace-only segment becomes <c>"_"</c> rather than an empty string — an empty
    /// segment would collapse two adjacent colons (<c>::</c>), making the URN ambiguous to split back
    /// apart; <c>"_"</c> keeps every URN a clean 6-part, colon-delimited string no matter how sparsely
    /// <see cref="St4i.EdgeCore.Uns.UnsOptions"/> is configured.</summary>
    private static string Seg(string s) => string.IsNullOrWhiteSpace(s) ? "_" : s.Trim();
}
