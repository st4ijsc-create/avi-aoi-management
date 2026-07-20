using System.Text.Json;

namespace St4i.EngineApi.Config;

/// <summary>
/// Explicit JSON options for config-sync endpoint RESPONSES — required because of a real System.Text.Json
/// footgun this task hit and confirmed via a live curl smoke test (see below), NOT a hypothetical.
///
/// System.Text.Json's converter-selection precedence (highest to lowest) is: member-level
/// <c>[JsonConverter]</c> &gt; a converter registered in <see cref="JsonSerializerOptions.Converters"/> &gt;
/// TYPE-level <c>[JsonConverter]</c>. <c>Program.cs</c>'s <c>ConfigureHttpJsonOptions</c> (which every
/// OTHER endpoint's <c>Results.Ok(...)</c> implicitly uses) registers a plain <c>JsonStringEnumConverter()</c>
/// GLOBALLY. For those other endpoints' own enums (<c>TransportMode</c>, <c>DeviceClass</c>,
/// <c>DriverKind</c>, <c>Verdict</c>, ...) — none of which carry a type-level attribute of their own —
/// that's harmless and intentional (see <c>ModeEndpoints</c>' own doc comment: plain PascalCase member
/// names on the wire, e.g. <c>{mode:"Live"}</c>).
///
/// But every <c>St4i.EdgeCore.Config</c> enum (<c>ProductLifecycleStatus</c>/<c>MeasurementType</c>/
/// <c>ToleranceMode</c>/<c>PointShape</c>/<c>CoordinateMode</c>/<c>RecipeStatus</c>/
/// <c>VariantOverrideAction</c>) DOES carry its own type-level <c>SnakeLower</c>/<c>SnakeUpper</c>
/// <c>[JsonConverter]</c> specifically to match CONFIG_SYNC_SERVER_CONTRACT.md's exact wire vocabulary
/// (e.g. <c>ToleranceMode.Range</c> → <c>"range"</c>, <c>MeasurementType.Dimension</c> → <c>"DIMENSION"</c>)
/// — and per that precedence order, the GLOBAL registration silently OUTRANKS it, so a config response
/// serialized through the normal <c>Results.Ok(...)</c> pipeline came back as <c>"Range"</c>/<c>"Dimension"</c>
/// instead (verified live: <c>GET /v1/products/{code}/points</c> before this fix). <see cref="Options"/>
/// is a plain <see cref="JsonSerializerDefaults.Web"/> instance with NO enum converter added, so every
/// config-sync response's own type-level converters are the only ones in play and win as intended.
/// <c>ConfigEndpoints</c> uses <c>Results.Json(value, ConfigJson.Options)</c> in place of
/// <c>Results.Ok(value)</c> everywhere a response can carry one of these types.
/// </summary>
internal static class ConfigJson
{
    public static readonly JsonSerializerOptions Options = new(JsonSerializerDefaults.Web);
}
