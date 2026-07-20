using System.Text.Json;
using System.Text.Json.Serialization;

namespace St4i.EdgeCore.Config;

/// <summary>
/// Shared enum-to-JSON-string converter factories for the config-sync domain model (Task C1). String
/// values mirror the server's Postgres enum labels / JSON field vocabulary exactly — see
/// <c>docs/CONFIG_SYNC_SERVER_CONTRACT.md</c>'s <c>&lt;POINT&gt;</c> shape and the
/// <c>product_models</c>/<c>machine_recipes</c> columns it documents:
/// <list type="bullet">
///   <item>lower_snake_case for <see cref="ToleranceMode"/>/<see cref="PointShape"/>/
///   <see cref="ProductLifecycleStatus"/>/<see cref="CoordinateMode"/>/<see cref="RecipeStatus"/>/
///   <see cref="VariantOverrideAction"/> (<c>min_only</c>, <c>range</c>, <c>development</c>,
///   <c>pixel</c>, <c>draft</c>, <c>exclude</c>, ...).</item>
///   <item>UPPER_SNAKE_CASE for <see cref="MeasurementType"/> — the one field the server spells in
///   caps (<c>DIMENSION</c>, <c>VISUAL</c>, ...).</item>
/// </list>
/// Applied per-enum via <c>[JsonConverter(typeof(SnakeLowerEnumConverter))]</c> /
/// <c>[JsonConverter(typeof(SnakeUpperEnumConverter))]</c> directly on the enum type declaration, so
/// every serializer that touches these types — <see cref="ProductConfigStore"/>'s persistence,
/// <see cref="ConfigChecksum"/>'s normalization, a plain ad-hoc <c>JsonSerializer.Serialize</c> in a
/// test — gets the right wire casing automatically. Nobody has to remember to register a converter
/// on a <c>JsonSerializerOptions</c> instance (and nobody can forget to, either).
///
/// Two factories (not one converter class per enum) because <c>JsonStringEnumConverter&lt;TEnum&gt;</c>
/// takes its naming policy as a constructor argument, and a <see cref="JsonConverterAttribute"/> can
/// only name a parameterless-constructible type — a <see cref="JsonConverterFactory"/> is STJ's
/// documented way around that: it gets asked for the concrete <c>TEnum</c> at resolution time and
/// builds the right closed converter then.
///
/// Note the extra unwrap step in <see cref="CreateConverterFor"/>: <c>JsonStringEnumConverter&lt;TEnum&gt;</c>
/// is ITSELF a <see cref="JsonConverterFactory"/> (not a concrete <c>JsonConverter&lt;TEnum&gt;</c>) —
/// STJ refuses a factory whose <c>CreateConverter</c> returns another factory ("cannot return an
/// instance of JsonConverterFactory"), so this factory must call the inner one's own
/// <c>CreateConverter</c> and hand back ITS result, not the factory instance itself.
/// </summary>
internal sealed class SnakeLowerEnumConverter : JsonConverterFactory
{
    public override bool CanConvert(Type typeToConvert) => typeToConvert.IsEnum;

    public override JsonConverter CreateConverter(Type typeToConvert, JsonSerializerOptions options) =>
        EnumConverterHelper.CreateConverterFor(typeToConvert, JsonNamingPolicy.SnakeCaseLower, options);
}

/// <summary>UPPER_SNAKE_CASE sibling of <see cref="SnakeLowerEnumConverter"/> — see its doc comment.
/// Used only by <see cref="MeasurementType"/> (the contract's one all-caps enum field).</summary>
internal sealed class SnakeUpperEnumConverter : JsonConverterFactory
{
    public override bool CanConvert(Type typeToConvert) => typeToConvert.IsEnum;

    public override JsonConverter CreateConverter(Type typeToConvert, JsonSerializerOptions options) =>
        EnumConverterHelper.CreateConverterFor(typeToConvert, JsonNamingPolicy.SnakeCaseUpper, options);
}

/// <summary>Shared unwrap logic for <see cref="SnakeLowerEnumConverter"/>/<see cref="SnakeUpperEnumConverter"/>
/// — see their doc comment for why this can't just return the closed
/// <c>JsonStringEnumConverter&lt;TEnum&gt;</c> instance directly.</summary>
internal static class EnumConverterHelper
{
    public static JsonConverter CreateConverterFor(Type enumType, JsonNamingPolicy namingPolicy, JsonSerializerOptions options)
    {
        var inner = (JsonConverterFactory)Activator.CreateInstance(
            typeof(JsonStringEnumConverter<>).MakeGenericType(enumType),
            namingPolicy,
            /* allowIntegerValues */ false)!;
        return inner.CreateConverter(enumType, options)!;
    }
}
