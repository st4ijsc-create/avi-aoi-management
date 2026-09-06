using System.Runtime.Versioning;

namespace St4i.EngineApi.Licensing;

/// <summary>
/// WS-E — 🔴 <b>THE ONLY MECHANISM BY WHICH A LICENCE MAY REFUSE ANYTHING.</b> An ASP.NET endpoint
/// filter that answers <c>403</c> with <c>reason: "LICENSE_REQUIRED"</c> when this machine is not
/// entitled to the feature the route was registered with.
///
/// <para><b>Why a filter and not a policy rule.</b> <c>Policy.PolicyEngine</c> is default-deny and
/// <c>FleetEndpoints</c> evaluates it for <c>fleet.estop</c> and <c>fleet.estop_reset</c>. A licence rule
/// in that array would sit on the E-stop path, where a single spurious deny makes <b>HALT
/// unreachable</b> — a licence problem stopping a machine, which is the one thing this workstream may
/// never cause. An endpoint filter can only affect the route it is attached to, and it cannot reach
/// E-stop by accident because every gated route is named by hand at its own <c>Map*</c> registration.
/// <c>PolicyRuleArrayPinTests</c> pins the rule array to exactly its three current types so this cannot
/// be undone quietly, and no type in this namespace implements <c>IPolicyRule</c>.</para>
///
/// <para><b>What is gated, and what is deliberately not.</b> Gated: the AUTHORING right (the screen,
/// component-model and tag <c>PUT</c>s, rollback, generate, import), line COMMAND execution, and
/// notification-dispatch configuration writes. Never gated: <c>GET /v1/screens/{id}</c>,
/// <c>GET /v1/components/{code}</c>, <c>GET /v1/tags</c>, <c>WS /v1/hmi/changes</c> — measured to be
/// exactly what the kiosk renders from (<c>web/src/routes/Hmi.tsx</c> lines 144, 158, 169, 490) — nor
/// <c>GET /v1/line</c>, nor anything on the E-stop, HALT, mode, historian, collection or alarm-
/// annunciation paths. An expired licence locks authoring; it does not blank a screen and it does not
/// stop a machine.</para>
/// </summary>
[SupportedOSPlatform("windows")]
public sealed class LicenseFeatureFilter : IEndpointFilter
{
    private readonly LicenseGate _gate;
    private readonly string _feature;

    /// <param name="gate">The process-wide licence gate.</param>
    /// <param name="feature">The <c>St4i.EdgeCore.Licensing.LicenseFeatures</c> constant this route requires.</param>
    public LicenseFeatureFilter(LicenseGate gate, string feature)
    {
        ArgumentNullException.ThrowIfNull(gate);
        ArgumentException.ThrowIfNullOrWhiteSpace(feature);
        _gate = gate;
        _feature = feature;
    }

    /// <summary>
    /// Refuses with <c>403</c> when unentitled; otherwise runs the route unchanged.
    /// </summary>
    /// <param name="context">The invocation context.</param>
    /// <param name="next">The next filter or the endpoint itself.</param>
    /// <returns>The route's own result, or a <c>403</c>.</returns>
    public async ValueTask<object?> InvokeAsync(EndpointFilterInvocationContext context, EndpointFilterDelegate next)
    {
        ArgumentNullException.ThrowIfNull(context);
        ArgumentNullException.ThrowIfNull(next);

        if (_gate.Has(_feature)) return await next(context).ConfigureAwait(false);

        return Results.Json(new LicenseDenyDto(
            Error: $"This deployment is not licensed for '{_feature}'.",
            Reason: "LICENSE_REQUIRED",
            Feature: _feature,
            LicenseState: _gate.State.ToString(),
            Edition: _gate.Edition), statusCode: StatusCodes.Status403Forbidden);
    }
}

/// <summary>WS-E — the body of a licence refusal. Machine-readable <see cref="Reason"/> so a client can
/// tell a licence refusal apart from an RBAC one without parsing prose, and
/// <see cref="Feature"/>/<see cref="LicenseState"/> so it can say WHICH entitlement and WHY.</summary>
/// <param name="Error">Human-readable message.</param>
/// <param name="Reason">Always <c>"LICENSE_REQUIRED"</c>.</param>
/// <param name="Feature">The feature string the route required.</param>
/// <param name="LicenseState">The current <c>St4i.EdgeCore.Licensing.LicenseState</c> name.</param>
/// <param name="Edition">The current edition label.</param>
public sealed record LicenseDenyDto(string Error, string Reason, string Feature, string LicenseState, string Edition);

/// <summary>WS-E — the one-line form used at every gated <c>Map*</c> registration, so the gate reads as a
/// single named requirement rather than a filter construction repeated a dozen times.</summary>
[SupportedOSPlatform("windows")]
public static class LicenseFilterExtensions
{
    /// <summary>
    /// Requires <paramref name="feature"/> for this route. 🔴 Resolves <see cref="LicenseGate"/> from DI
    /// at REQUEST time rather than capturing it at registration, so a composition root that registers the
    /// gate after the endpoints cannot silently produce an ungated route.
    /// </summary>
    /// <typeparam name="TBuilder">The endpoint convention builder type.</typeparam>
    /// <param name="builder">The route being registered.</param>
    /// <param name="feature">The required feature string.</param>
    /// <returns><paramref name="builder"/>, for chaining.</returns>
    public static TBuilder RequireLicense<TBuilder>(this TBuilder builder, string feature)
        where TBuilder : IEndpointConventionBuilder
    {
        ArgumentNullException.ThrowIfNull(builder);
        ArgumentException.ThrowIfNullOrWhiteSpace(feature);

        return builder.AddEndpointFilterFactory((factoryContext, next) =>
        {
            var gate = factoryContext.ApplicationServices.GetService<LicenseGate>();

            // 🔴 A missing gate does NOT fail open. If the composition root never registered one, every
            // gated route refuses rather than silently granting the paid surface — fail-closed for
            // features. It cannot affect operation: no operation route carries this filter.
            if (gate is null)
            {
                return async invocationContext =>
                {
                    await Task.CompletedTask.ConfigureAwait(false);
                    return Results.Json(new LicenseDenyDto(
                        Error: $"This deployment is not licensed for '{feature}'.",
                        Reason: "LICENSE_REQUIRED",
                        Feature: feature,
                        LicenseState: St4i.EdgeCore.Licensing.LicenseState.Missing.ToString(),
                        Edition: "Core"), statusCode: StatusCodes.Status403Forbidden);
                };
            }

            var filter = new LicenseFeatureFilter(gate, feature);
            return invocationContext => filter.InvokeAsync(invocationContext, next);
        });
    }
}
