using System.Security.Cryptography;
using System.Security.Cryptography.X509Certificates;
using System.Text;
using Microsoft.AspNetCore.Mvc;
using St4i.EdgeCore.Identity;
using St4i.EdgeCore.Site;
using St4i.EngineApi.Auth;
using St4i.EngineApi.Fleet;

namespace St4i.EngineApi.Endpoints;

/// <summary>
/// GĐ3 EC-3 (docs/plans .../2026-07-27-giaidoan3-ecosystem-connect-blueprint/task-3-brief.md) — the HTTP
/// surface over EC-2's <see cref="SiteBridgeManager"/> + EC-1's <see cref="DeviceIdentity"/>:
/// <c>GET /v1/site</c> (Site-link status + config, Operator), <c>PUT /v1/site</c> (set/enable the Site
/// link — drives <see cref="SiteBridgeManager.ApplyAsync"/> — Engineer, audited), and
/// <c>GET /v1/site/identity</c> (this device's own public cert + fingerprint, to register at a Site —
/// Operator).
///
/// <para><b>Nullable manager:</b> <see cref="SiteBridgeManager"/> is only registered in DI when the local
/// UNS spine is enabled (<c>Program.cs</c>, gated on <c>ST4I_UNS_ENABLED</c>) — a standalone device with no
/// local spine has nothing to bridge. Every handler below therefore takes <c>SiteBridgeManager?</c>
/// (nullable): <c>GetSiteAsync</c> degrades to a fixed "disabled, no bridge" view that still reports the
/// device's own identity fingerprint (a device has an identity whether or not anything is federated), and
/// <c>PutSiteAsync</c> 409s (there is nothing to apply a Site link TO). <see cref="DeviceIdentity"/> is
/// always registered (EC-1/EC-2), so it's a plain non-nullable dependency here.
///
/// <para><b>Why <c>[FromServices]</c> on <c>mgr</c>, explicitly:</b> minimal APIs only auto-infer a complex
/// parameter as service-sourced when that TYPE is actually registered in the container at endpoint-metadata
/// build time. When UNS is disabled, <see cref="SiteBridgeManager"/> is registered nowhere at all, so
/// without the explicit attribute the framework instead infers <c>mgr</c> as a (JSON) request-body
/// parameter — which then throws <c>InvalidOperationException</c> ("Body was inferred but the method does
/// not allow inferred body parameters") the moment routing touches a <c>GET</c> endpoint's metadata, taking
/// the WHOLE host down at first request, not just this route. <c>[FromServices]</c> forces the
/// service-resolution path unconditionally, which resolves to <see langword="null"/> (not an exception) for
/// an unregistered nullable type — exactly the "may legitimately be absent" contract this class needs.</para>
///
/// <para><b>PEM handling:</b> <see cref="PersistedSiteLink.SiteTrustPem"/> is never echoed back on
/// <c>GET</c> (see <see cref="SiteStatusDto"/> — no PEM field at all) — it's write-only via <c>PUT</c>; a
/// GET instead exposes the PINNED <see cref="BridgeStatusSnapshot.SiteFingerprint"/> the bridge actually
/// validated against on its last successful handshake. The audit row <c>PutSiteAsync</c> writes never
/// includes the raw PEM either (see <see cref="PemFingerprint"/>) — only its length + a SHA-256 fingerprint
/// of its own bytes, enough to tell two submitted PEMs apart in the audit trail without ever putting a
/// certificate blob in the audit log.</para>
///
/// <para><b>Deferred: <c>POST /v1/site/test</c></b> (a pre-save connectivity probe from the blueprint) is
/// NOT implemented here — see this task's report for why: the live <see cref="BridgeState"/> badge
/// (<c>Connecting</c> → <c>Connected</c>/<c>Degraded</c> + <c>LastError</c>) that <c>GET /v1/site</c>
/// already exposes IS the operator's connection feedback once a link is saved, so a dedicated pre-save
/// probe is a follow-up, not a blocker for this task.</para>
///
/// <para><b>GĐ3 sub-2 SD-1</b> (<c>.superpowers/sdd/2026-07-27-giaidoan3-mdns-join-wizard-blueprint/task-1-brief.md</c>)
/// adds <c>GET /v1/site/discover</c>: an mDNS LAN scan (<see cref="St4i.EdgeCore.Site.ISiteDiscovery"/>) so
/// the web join wizard can pre-fill a Site's host/port instead of an operator hand-typing them. Engineer
/// (an ACTIVE network scan — sends a real multicast query onto the LAN — is a step up from the read-only
/// Operator-level <c>GET /v1/site</c>/<c>GET /v1/site/identity</c> above, but still read-only from THIS
/// device's own state's point of view: it changes nothing, persists nothing, so no audit row). Discovery
/// never changes trust — see <see cref="St4i.EdgeCore.Site.SiteDiscovery"/>'s own doc comment; the operator
/// still pins the Site's certificate via the UNCHANGED <c>PUT /v1/site</c> above.</para>
/// </summary>
public static class SiteEndpoints
{
    public static void MapSiteEndpoints(this IEndpointRouteBuilder app)
    {
        app.MapGet("/v1/site", GetSiteAsync).RequireAuthorization(Policies.Operator);
        app.MapPut("/v1/site", PutSiteAsync).RequireAuthorization(Policies.Engineer);
        app.MapGet("/v1/site/identity", GetIdentityAsync).RequireAuthorization(Policies.Operator);
        app.MapGet("/v1/site/discover", DiscoverAsync).RequireAuthorization(Policies.Engineer);
    }

    // ─────────────────────────────────────────────────────────────────────
    // GET /v1/site
    // ─────────────────────────────────────────────────────────────────────
    internal static IResult GetSiteAsync([FromServices] SiteBridgeManager? mgr, DeviceIdentity identity)
    {
        if (mgr is null)
        {
            // UNS disabled — no bridge could ever exist. Still report a real DeviceFingerprint: the
            // device's identity is unconditional (EC-1), independent of whether a Site link exists.
            return Results.Ok(new SiteStatusDto(
                Enabled: false, Host: "", Port: 0, BridgeState: nameof(BridgeState.Disabled),
                LastError: null, SiteFingerprint: null, DeviceFingerprint: identity.Fingerprint, UnsEnabled: false));
        }

        var current = mgr.Current;
        var status = mgr.Status();
        return Results.Ok(new SiteStatusDto(
            current.Enabled, current.Host, current.Port, status.State.ToString(),
            status.LastError, status.SiteFingerprint, status.DeviceFingerprint, UnsEnabled: true));
    }

    // ─────────────────────────────────────────────────────────────────────
    // PUT /v1/site {enabled,host,port,siteTrustPem}
    // ─────────────────────────────────────────────────────────────────────
    internal static async Task<IResult> PutSiteAsync(
        SiteLinkRequest body, [FromServices] SiteBridgeManager? mgr, DeviceIdentity identity, HttpContext ctx, AuditRecorder recorder, CancellationToken ct)
    {
        if (mgr is null)
        {
            return Results.Conflict(new ApiErrorDto(
                "The local UNS spine is disabled (ST4I_UNS_ENABLED=false); enable it to federate to a Site."));
        }

        if (body is null)
        {
            return Results.BadRequest(new ApiErrorDto("Request body is required."));
        }

        if (body.Enabled)
        {
            if (string.IsNullOrWhiteSpace(body.Host))
            {
                return Results.BadRequest(new ApiErrorDto("host is required when enabling the Site link."));
            }

            if (body.Port is not { } port || port is < 1 or > 65535)
            {
                return Results.BadRequest(new ApiErrorDto("port must be between 1 and 65535 when enabling the Site link."));
            }

            if (!IsValidTrustPem(body.SiteTrustPem))
            {
                return Results.BadRequest(new ApiErrorDto(
                    "siteTrustPem must be a valid PEM containing at least one certificate when enabling the Site link."));
            }
        }

        // "before" read BEFORE the mutation, same WS-D-D4 before/after ordering every other mutating
        // handler in this project follows.
        var before = mgr.Current;

        var link = new PersistedSiteLink
        {
            Enabled = body.Enabled,
            Host = body.Host ?? "",
            Port = body.Port ?? 8883,
            SiteTrustPem = body.SiteTrustPem ?? "",
        };

        // Never throws (SiteBridgeManager's own contract) — stops the old bridge, persists, starts a new
        // one if Enabled. Synchronous from this caller's point of view: by the time this returns, Current/
        // Status() already reflect the new link, so the immediate GET a caller does next sees it applied.
        await mgr.ApplyAsync(link).ConfigureAwait(false);

        // Security-relevant change — audited. NEVER the raw PEM (see this class's own doc comment): only
        // its length + a content fingerprint, enough to distinguish submissions without logging a cert blob.
        await recorder.RecordAsync(
            ctx, "site.link.set", "site", link.Host,
            new { before.Enabled, before.Host, before.Port },
            new { link.Enabled, link.Host, link.Port, pemLen = link.SiteTrustPem.Length, pemFingerprint = PemFingerprint(link.SiteTrustPem) },
            ct).ConfigureAwait(false);

        return GetSiteAsync(mgr, identity);
    }

    // ─────────────────────────────────────────────────────────────────────
    // GET /v1/site/identity
    // ─────────────────────────────────────────────────────────────────────
    internal static IResult GetIdentityAsync(DeviceIdentity identity) =>
        Results.Ok(new SiteIdentityDto(identity.Fingerprint, identity.CertificatePem));

    // ─────────────────────────────────────────────────────────────────────
    // GET /v1/site/discover — mDNS LAN browse (SD-1). Bounded ~4s; empty array is a legitimate result
    // (no Site advertising on this LAN segment, or none reachable within the window) — never a 404/500.
    // ─────────────────────────────────────────────────────────────────────
    internal static async Task<IResult> DiscoverAsync(ISiteDiscovery discovery, CancellationToken ct)
    {
        var sites = await discovery.DiscoverAsync(TimeSpan.FromSeconds(4), ct).ConfigureAwait(false);
        return Results.Ok(sites);
    }

    /// <summary>Fail-closed, same intent as <see cref="SiteTrustPin.IsTrusted"/>: a blank/missing PEM, or
    /// one that doesn't parse into at least one certificate, is rejected (400) rather than silently
    /// accepted — an enabled Site link with an unusable trust pin would leave the bridge unable to ever
    /// validate the Site broker's presented certificate.</summary>
    private static bool IsValidTrustPem(string? pem)
    {
        if (string.IsNullOrWhiteSpace(pem)) return false;

        try
        {
            var certs = new X509Certificate2Collection();
            certs.ImportFromPem(pem);
            return certs.Count > 0;
        }
        catch (CryptographicException)
        {
            return false;
        }
    }

    /// <summary>A SHA-256 fingerprint of the PEM TEXT itself (not the certificate's own thumbprint) —
    /// purely so an audit row can distinguish "the same PEM was resubmitted" from "a different PEM was
    /// submitted" without ever recording the PEM bytes themselves.</summary>
    private static string PemFingerprint(string pem) =>
        string.IsNullOrEmpty(pem) ? "" : Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(pem)));
}

// ─────────────────────────────────────────────────────────────────────────
// DTOs
// ─────────────────────────────────────────────────────────────────────────

/// <summary>The Site-link status + config view. <see cref="BridgeState"/> is the enum's own name as a
/// string (e.g. <c>"Connecting"</c>) — NOT the raw <see cref="PersistedSiteLink.SiteTrustPem"/>, which
/// is write-only via <see cref="SiteLinkRequest"/> (see <see cref="SiteEndpoints"/>'s own doc comment for
/// why); <see cref="SiteFingerprint"/> is the pinned value the bridge actually validated on its last
/// successful handshake instead.</summary>
public sealed record SiteStatusDto(
    bool Enabled, string Host, int Port, string BridgeState, string? LastError,
    string? SiteFingerprint, string DeviceFingerprint, bool UnsEnabled);

/// <summary>The <c>PUT /v1/site</c> request body. <see cref="Host"/>/<see cref="Port"/>/
/// <see cref="SiteTrustPem"/> are only validated/required when <see cref="Enabled"/> is <see langword="true"/>
/// (see <see cref="SiteEndpoints.PutSiteAsync"/>) — disabling the link needs none of them.</summary>
public sealed record SiteLinkRequest(bool Enabled, string? Host, int? Port, string? SiteTrustPem);

/// <summary>This device's own public identity, for an operator (or an automated pairing flow) to register
/// at a SYNAPSE Site.</summary>
public sealed record SiteIdentityDto(string DeviceFingerprint, string DeviceCertPem);
