using System.Text.Json;
using System.Text.Json.Serialization;

namespace St4i.Connector.Abstractions.Json;

/// <summary>
/// GP-2 (.superpowers/sdd/2026-07-28-wsg-plugin-connector-seam-blueprint/task-2-brief.md) — the ONE
/// <see cref="JsonSerializerOptions"/> instance that defines the connector wire format: the contract a
/// vendor driver running in a future out-of-process sidecar and the host reading it back on the other
/// side of that process boundary BOTH compile against. Unlike an in-process call, there is no shared CLR
/// type on the other end of a sidecar boundary — only this class's choices — so every setting below is
/// deliberate and documented, not "whatever <see cref="JsonSerializerOptions"/>'s parameterless
/// constructor happens to default to".
/// </summary>
public static class ConnectorJson
{
    /// <summary>
    /// The cached, canonical wire-format options. <c>static readonly</c> is load-bearing, not
    /// stylistic: constructing a <see cref="JsonSerializerOptions"/> triggers System.Text.Json's
    /// per-instance reflection/plan caching, so building a fresh instance per call would silently defeat
    /// that cache and re-pay the cost on every single <c>DeviceReading</c> once this sits on the sidecar's
    /// per-reading hot path.
    /// </summary>
    public static readonly JsonSerializerOptions Options = Build();

    private static JsonSerializerOptions Build()
    {
        var options = new JsonSerializerOptions
        {
            // camelCase property names — matches every other wire-facing JsonSerializerOptions already
            // in this codebase (St4i.EdgeCore.Site.UnsBridge.ResyncJsonOptions,
            // St4i.EdgeCore.Uns.UnsPublisher.SemanticJsonOptions, St4i.EngineApi.JsonConfig/ConfigJson) —
            // a third-party driver author has exactly one naming convention to learn across this product,
            // not a bespoke one for the connector seam.
            PropertyNamingPolicy = JsonNamingPolicy.CamelCase,

            // Lenient on READ only. A sidecar built in another stack/language has no guarantee of sharing
            // this process's exact casing habits; refusing to bind "Metric" to "metric" would silently
            // drop a field for no reason a driver author could easily diagnose. WRITE is unaffected by
            // this flag — this process still always emits strict camelCase.
            PropertyNameCaseInsensitive = true,

            // Nulls stay explicit (the default — never DefaultIgnoreCondition.WhenWritingNull).
            // DeviceReading is a full point-in-time snapshot, not a partial PATCH: an omitted field must
            // never be confused with a field that is explicitly null (e.g. Plan is genuinely absent for
            // most reading kinds). Dropping null members to save wire bytes is a false economy for a
            // contract that has no shared source on the other side of the boundary to fall back on.

            // Strict number handling (the default). This is a machine-to-machine wire format — a real
            // sidecar process emits genuine JSON number tokens — not a user-facing form, so
            // AllowReadingFromString-style laxity would only paper over a producer bug. Strict also means
            // NaN/±Infinity are REJECTED rather than silently coerced; ConnectorObjectConverter enforces
            // the same policy explicitly for the object? domain (decision (b) — see its own doc comment).
            NumberHandling = JsonNumberHandling.Strict,

            // Enums as camelCase strings, never bare ints. Enums.cs has already grown once (GP-1 moved 5
            // enums into this assembly) and nothing stops a member being inserted/reordered later — a
            // wire format serializing ReadingKind.Telemetry as the bare int 1 would silently reinterpret
            // every value the moment that happens on either side of a sidecar boundary that isn't
            // recompiled in lockstep. Spelling the name out costs a few bytes and buys total immunity to
            // that reordering hazard.
            // The object? converter — see ConnectorObjectConverter's own class doc comment for the full
            // domain/decision (a)/decision (b) story. Registered for `object` so it covers BOTH
            // TelemetrySample.Value and every value inside Genealogy (a Dictionary<string, object>) —
            // System.Text.Json consults it for any property/dictionary-value slot typed exactly `object`.
            Converters =
            {
                new JsonStringEnumConverter(JsonNamingPolicy.CamelCase),
                new ConnectorObjectConverter(),
            },
        };

        return options;
    }
}
