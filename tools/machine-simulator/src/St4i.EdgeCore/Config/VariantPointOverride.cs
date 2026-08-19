using System.Text.Json;
using System.Text.Json.Serialization;

namespace St4i.EdgeCore.Config;

/// <summary>What a <see cref="VariantPointOverride"/> does to the base point it targets — mirrors
/// <c>variant_point_overrides.action</c> (<c>exclude|override</c>).</summary>
[JsonConverter(typeof(SnakeLowerEnumConverter))]
public enum VariantOverrideAction
{
    /// <summary>Wire value <c>"exclude"</c>. Drop the targeted base point from this variant entirely —
    /// the case where <see cref="VariantPointOverride.PatchJson"/> carries nothing. Never honoured on
    /// this side; see <see cref="ProductVariant"/>'s remarks.</summary>
    Exclude,

    /// <summary>Wire value <c>"override"</c>, and the default a
    /// <see cref="VariantPointOverride"/> starts life with: keep the base point but apply
    /// <see cref="VariantPointOverride.PatchJson"/> on top of it.</summary>
    Override,
}

/// <summary>
/// One variant's patch against a single base-product point — the edge-local mirror of a
/// <c>variant_point_overrides</c> row. Targets the base point by <see cref="BasePointCode"/> rather
/// than the server's <c>basePointDefId</c>, consistent with every other model in this namespace
/// keying identity by code, not by a server-assigned id (see <see cref="ProductModel"/>'s doc
/// comment).
/// </summary>
public sealed class VariantPointOverride
{
    /// <summary>Which base point this patch targets: the value of that point's
    /// <see cref="MeasurementPoint.Code"/>, not the server's <c>basePointDefId</c> (see this type's
    /// summary for why). It is an unchecked reference — no code here verifies that a point with this
    /// code exists in <see cref="ProductModel.Points"/>, and because nothing resolves overrides at all,
    /// a patch aimed at a point that was deleted years ago persists silently rather than surfacing as
    /// an error.</summary>
    public string BasePointCode { get; set; } = "";

    /// <summary>Whether this entry removes the targeted point or patches it. Defaults to
    /// <see cref="VariantOverrideAction.Override"/>, which is also the only value that gives
    /// <see cref="PatchJson"/> any meaning. Serialized as the contract's lowercase word, never as the
    /// enum's underlying number — <c>allowIntegerValues: false</c> in
    /// <see cref="EnumConverterHelper.CreateConverterFor"/> makes a numeric value a hard read
    /// failure.</summary>
    public VariantOverrideAction Action { get; set; } = VariantOverrideAction.Override;

    /// <summary>Partial <see cref="MeasurementPoint"/> field patch (jsonb on the server) applied on
    /// top of the base point when <see cref="Action"/> is <see cref="VariantOverrideAction.Override"/>
    /// — e.g. <c>{"lowerLimit":4800,"upperLimit":5200}</c> for a tighter tolerance on one revision.
    /// Meaningless (and normally omitted) when <see cref="Action"/> is
    /// <see cref="VariantOverrideAction.Exclude"/>.</summary>
    public JsonElement? PatchJson { get; set; }
}
