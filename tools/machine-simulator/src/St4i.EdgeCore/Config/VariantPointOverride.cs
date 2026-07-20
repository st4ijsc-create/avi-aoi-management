using System.Text.Json;
using System.Text.Json.Serialization;

namespace St4i.EdgeCore.Config;

/// <summary>What a <see cref="VariantPointOverride"/> does to the base point it targets — mirrors
/// <c>variant_point_overrides.action</c> (<c>exclude|override</c>).</summary>
[JsonConverter(typeof(SnakeLowerEnumConverter))]
public enum VariantOverrideAction { Exclude, Override }

/// <summary>
/// One variant's patch against a single base-product point — the edge-local mirror of a
/// <c>variant_point_overrides</c> row. Targets the base point by <see cref="BasePointCode"/> rather
/// than the server's <c>basePointDefId</c>, consistent with every other model in this namespace
/// keying identity by code, not by a server-assigned id (see <see cref="ProductModel"/>'s doc
/// comment).
/// </summary>
public sealed class VariantPointOverride
{
    public string BasePointCode { get; set; } = "";
    public VariantOverrideAction Action { get; set; } = VariantOverrideAction.Override;

    /// <summary>Partial <see cref="MeasurementPoint"/> field patch (jsonb on the server) applied on
    /// top of the base point when <see cref="Action"/> is <see cref="VariantOverrideAction.Override"/>
    /// — e.g. <c>{"lowerLimit":4800,"upperLimit":5200}</c> for a tighter tolerance on one revision.
    /// Meaningless (and normally omitted) when <see cref="Action"/> is
    /// <see cref="VariantOverrideAction.Exclude"/>.</summary>
    public JsonElement? PatchJson { get; set; }
}
