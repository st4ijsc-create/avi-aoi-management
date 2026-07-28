using St4i.EngineApi.Auth;
using St4i.EngineApi.Fleet;

namespace St4i.EngineApi.Endpoints;

/// <summary><c>GET /v1/connectors</c> — GP-5
/// (.superpowers/sdd/2026-07-28-wsg-plugin-connector-seam-blueprint/task-5-brief.md item 3) — the
/// visibility projection for a connector that is CONFIGURED (registered into <see cref="ConnectorRegistry"/>)
/// but not currently running because its most recent start attempt failed. Operator-level (same policy as
/// <c>GET /v1/assets</c>/<c>GET /v1/alarms</c> — plain fleet-visibility information, not a mutation),
/// deliberately separate from <c>GET /v1/health</c>: an optional peripheral's bad config must never flip the
/// whole host unhealthy (the GP-4 review's own judgment, unchanged by this task), but an operator must still
/// be able to SEE that it isn't running instead of discovering it only in a log file.</summary>
public static class ConnectorEndpoints
{
    public static void MapConnectorEndpoints(this IEndpointRouteBuilder app)
    {
        app.MapGet("/v1/connectors", (FleetHost host) => Results.Ok(host.GetConfiguredConnectorIssues()))
            .RequireAuthorization(Policies.Operator);
    }
}
