using St4i.EngineApi.Auth;
using St4i.EngineApi.Fleet;

namespace St4i.EngineApi.Endpoints;

/// <summary><c>GET /v1/settings</c> · <c>PUT /v1/settings {serverUrl,verifyTls,language}</c> ·
/// <c>POST /v1/settings/probe {serverUrl}</c> → <c>ProbeResult</c> (<c>{reachable,status,paths}</c>).</summary>
public static class SettingsEndpoints
{
    public static void MapSettingsEndpoints(this IEndpointRouteBuilder app)
    {
        app.MapGet("/v1/settings", (FleetHost host) => Results.Ok(host.GetSettings()))
            .RequireAuthorization(Policies.Engineer);

        // WS-D-D2 — the route-level policy is Engineer (settings exposes serverUrl/language, an
        // Engineer-tier concern), but disabling TLS verification specifically is escalated to an
        // in-handler Admin-only gate: an Engineer can otherwise change serverUrl/language/machineCode
        // freely, but flipping VerifyTls to false (accepting an unverified/self-signed server cert) is a
        // materially bigger security decision the blueprint reserves for Admin. `httpContext.User` is
        // read directly (not a second RequireAuthorization/policy) because this decision depends on the
        // REQUEST BODY (VerifyTls==false), not just the route — RequireAuthorization can't see the body.
        app.MapPut("/v1/settings", async (
            SettingsUpdateRequest request, FleetHost host, HttpContext httpContext, AuditRecorder recorder, CancellationToken ct) =>
        {
            if (request.VerifyTls == false && !httpContext.User.IsInRole(Roles.Admin))
            {
                // Rejected mutation (403) — per the WS-D-D4 ordering rule, no audit row is written here.
                return Results.Json(
                    new ApiErrorDto("Disabling TLS certificate verification (verifyTls=false) requires the Admin role."),
                    statusCode: StatusCodes.Status403Forbidden);
            }

            var old = host.GetSettings();
            var updated = host.UpdateSettings(request);

            // WS-D-D4 — "changed fields old→new" (only the fields THIS request actually touched, not the
            // whole settings object every time — Language is deliberately not TLS-sensitive/not gated, but
            // still worth recording precisely which fields moved).
            var oldChanged = new Dictionary<string, object?>();
            var newChanged = new Dictionary<string, object?>();
            if (request.ServerUrl is not null) { oldChanged["serverUrl"] = old.ServerUrl; newChanged["serverUrl"] = updated.ServerUrl; }
            if (request.VerifyTls is not null) { oldChanged["verifyTls"] = old.VerifyTls; newChanged["verifyTls"] = updated.VerifyTls; }
            if (request.MachineCode is not null) { oldChanged["machineCode"] = old.MachineCode; newChanged["machineCode"] = updated.MachineCode; }
            if (request.Language is not null) { oldChanged["language"] = old.Language; newChanged["language"] = updated.Language; }

            if (oldChanged.Count > 0)
            {
                await recorder.RecordAsync(httpContext, "settings.update", "settings", null, oldChanged, newChanged, ct)
                    .ConfigureAwait(false);
            }

            // A distinct row on a TRUE→FALSE verifyTls transition specifically — a materially bigger
            // security decision (see this class's own doc comment on the in-handler Admin-only gate above)
            // deserves its own, easy-to-filter-for action name, not just a field inside settings.update.
            if (old.VerifyTls && !updated.VerifyTls)
            {
                await recorder.RecordAsync(httpContext, "settings.verifyTls_disabled", "settings", null, true, false, ct)
                    .ConfigureAwait(false);
            }

            return Results.Ok(updated);
        }).RequireAuthorization(Policies.Engineer);

        app.MapPost("/v1/settings/probe", async (ProbeRequest request, FleetHost host, CancellationToken ct) =>
        {
            if (string.IsNullOrWhiteSpace(request.ServerUrl))
                return Results.BadRequest(new ApiErrorDto("serverUrl is required"));

            // ResilienceProbe.ProbeAsync never throws on a connectivity failure — it reports
            // Reachable=false with its own bounded (5s) HttpClient timeout, so this never hangs the
            // caller regardless of whether serverUrl is unreachable/refused/DNS-fails.
            var result = await host.ProbeAsync(request.ServerUrl, ct).ConfigureAwait(false);
            return Results.Ok(result);
        }).RequireAuthorization(Policies.Engineer);
    }
}
