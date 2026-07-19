using System.Text.Json;
using System.Text.Json.Serialization;

namespace St4i.EngineApi;

/// <summary>Shared JSON shape for every response this host writes — both the ASP.NET minimal-API
/// default serializer (wired in <c>Program.cs</c> via <c>ConfigureHttpJsonOptions</c>) and the WS
/// inspector stream's manual <see cref="System.Text.Json.JsonSerializer"/> calls (which don't go
/// through that pipeline) use THIS instance, so an <c>ApiTraceEvent</c> looks identical whether it
/// arrived over HTTP or the socket. Enums serialize as their C# member name (e.g. <c>"Live"</c>,
/// <c>"ProcessResult"</c>) — matches the exact casing the Task 3 brief's endpoint contracts use
/// (<c>PUT /v1/mode {mode:"Live"|"Demo"|"Auto"}</c>).</summary>
internal static class ApiJson
{
    public static readonly JsonSerializerOptions Options = BuildOptions();

    private static JsonSerializerOptions BuildOptions()
    {
        var options = new JsonSerializerOptions(JsonSerializerDefaults.Web);
        options.Converters.Add(new JsonStringEnumConverter());
        return options;
    }
}
