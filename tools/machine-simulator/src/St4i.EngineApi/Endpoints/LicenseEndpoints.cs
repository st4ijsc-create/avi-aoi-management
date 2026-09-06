using System.Runtime.Versioning;
using St4i.EdgeCore.Identity;
using St4i.EdgeCore.Licensing;
using St4i.EngineApi.Auth;
using St4i.EngineApi.Licensing;

namespace St4i.EngineApi.Endpoints;

/// <summary>
/// WS-E (License/Edition) — the three routes that let a machine be licensed offline, and the diagnostic
/// surface a support engineer reads during an incident call.
///
/// <para><b>The whole offline-activation loop:</b> read the fingerprint → e-mail it to ST4I → receive a
/// licence JSON → paste it into <c>POST /v1/license/activate</c> → restart.</para>
///
/// <para>🔴 <b>None of these routes carries a licence filter, and two of them must not.</b>
/// <c>GET /v1/license/fingerprint</c> is what an UNLICENSED machine calls to get itself licensed — gating
/// it on a licence would make activation impossible, which is the one bootstrap this workstream cannot
/// get wrong. <c>GET /v1/license</c> is the diagnostic: a support engineer must be able to read the
/// licence state precisely when the licence is broken. <c>POST /v1/license/activate</c> is how a machine
/// stops being unlicensed. All three are RBAC-gated as usual and none is anonymous.</para>
/// </summary>
[SupportedOSPlatform("windows")]
public static class LicenseEndpoints
{
    /// <summary>Registers the three licence routes.</summary>
    /// <param name="app">The endpoint route builder.</param>
    public static void MapLicenseEndpoints(this IEndpointRouteBuilder app)
    {
        ArgumentNullException.ThrowIfNull(app);

        // The diagnostic. Engineer: it carries a customer name and the machine's own fingerprint, which is
        // the same tier of material as GET /v1/settings.
        app.MapGet("/v1/license", (LicenseGate gate, LicenseStore store) =>
            Results.Ok(Describe(gate, store)))
            .RequireAuthorization(Policies.Engineer);

        // 🔴 MUST WORK WHEN UNLICENSED — that is the entire point. Returns the four components separately
        // (never one combined hash) so support can see at a glance WHICH one moved, which is what turns a
        // machine at 3-of-4 into something visible before it refuses rather than after.
        app.MapGet("/v1/license/fingerprint", (DeviceIdentityProvider identity) =>
        {
            _ = identity; // resolved so the fingerprint reads the SAME identity this process loaded.
            var fingerprint = MachineFingerprint.Read(null, out var regenerated);
            return Results.Ok(new LicenseFingerprintDto(
                fingerprint.DeviceIdentity, fingerprint.MachineGuid, fingerprint.VolumeSerial,
                fingerprint.PrimaryMac, regenerated,
                regenerated
                    ? "⚠ This machine's device identity was REGENERATED during this boot rather than " +
                      "loaded. The deviceIdentity component below may differ from the one a previously " +
                      "issued licence was bound to, with no hardware change. Report this when requesting " +
                      "a licence."
                    : null));
        }).RequireAuthorization(Policies.Engineer);

        // Offline activation. Admin: installing an entitlement is an ownership act, not a configuration one.
        app.MapPost("/v1/license/activate", async (
            HttpContext context, LicenseStore store, LicenseVerifier verifier,
            AuditRecorder recorder, LicenseGate gate, CancellationToken ct) =>
        {
            string body;
            using (var reader = new StreamReader(context.Request.Body))
            {
                body = await reader.ReadToEndAsync(ct).ConfigureAwait(false);
            }

            if (string.IsNullOrWhiteSpace(body))
            {
                return Results.BadRequest(new { error = "The request body must be the licence JSON." });
            }

            // 🔴 VERIFY BEFORE WRITING. A licence that fails verification is NEVER persisted, so a bad
            // paste — a truncated e-mail, the wrong customer's file, a hand-edited expiry — cannot
            // displace a licence that is currently working. This is why the check is here and not
            // inside LicenseStore.Save: the store writes what it is given, and the decision about
            // whether the bytes deserve to be written belongs at the door.
            var verdict = verifier.Verify(body, out var payload, out var diagnostic);
            if (verdict != LicenseState.Valid || payload is null)
            {
                return Results.BadRequest(new
                {
                    error = diagnostic ?? "The licence could not be verified.",
                    reason = verdict.ToString(),
                });
            }

            var previous = gate.Edition;
            try
            {
                store.Save(body);
            }
            catch (Exception ex) when (ex is IOException or UnauthorizedAccessException)
            {
                return Results.Problem(
                    detail: $"The licence verified but could not be written to {store.LicensePath}: {ex.Message}",
                    statusCode: StatusCodes.Status500InternalServerError);
            }

            await recorder.RecordAsync(context, "license.activate", "license", payload.LicenseId,
                new { edition = previous }, new { edition = payload.Edition, payload.LicenseId }, ct)
                .ConfigureAwait(false);

            // 🔴 The response says IN WORDS that a restart is required, because the state is evaluated
            // once at startup and a caller who assumed otherwise would report "activation did nothing".
            return Results.Ok(new LicenseActivationResultDto(
                Accepted: true,
                LicenseId: payload.LicenseId,
                Edition: payload.Edition,
                ExpiresAtUtc: payload.ExpiresAtUtc?.ToUniversalTime().ToString("O"),
                Message: "The licence was verified and installed. It takes effect when the engine next " +
                         "restarts — licence state is evaluated once at startup so that a machine's feature " +
                         "set can never change under an operator's hands mid-shift."));
        }).RequireAuthorization(Policies.Admin);
    }

    /// <summary>Builds the diagnostic view of the current licence.</summary>
    /// <param name="gate">The process-wide gate.</param>
    /// <param name="store">The store, for the path a support engineer needs to quote.</param>
    /// <returns>The diagnostic DTO.</returns>
    private static LicenseStatusDto Describe(LicenseGate gate, LicenseStore store)
    {
        var e = gate.Evaluation;
        return new LicenseStatusDto(
            State: e.State.ToString(),
            Edition: gate.Edition,
            LicenseId: e.Payload?.LicenseId,
            Customer: e.Payload?.Customer,
            IssuedAtUtc: e.Payload?.IssuedAtUtc?.ToUniversalTime().ToString("O"),
            ExpiresAtUtc: e.Payload?.ExpiresAtUtc?.ToUniversalTime().ToString("O"),
            GraceDays: e.Payload?.GraceDays ?? 0,
            Features: [.. e.Features.OrderBy(f => f, StringComparer.Ordinal)],
            FingerprintMatches: e.FingerprintMatches,
            FingerprintRequired: MachineFingerprint.RequiredMatches(e.Payload?.FingerprintPolicy),
            // 🔴 The binding mode is REPORTED, not inferred. A support engineer must be able to see from
            // one call that a licence is unbound — the owner's ruling is that the mode is named and
            // visible, and a diagnostic that omitted it would put the name back out of sight.
            BindingMode: LicenseBindingMode.IsUnbound(e.Payload?.FingerprintPolicy)
                ? LicenseBindingMode.Unbound
                : LicenseBindingMode.Machine,
            IdentityWasRegenerated: e.IdentityWasRegenerated,
            EvaluatedAtUtc: e.EvaluatedAtUtc.ToUniversalTime().ToString("O"),
            LicensePath: store.LicensePath,
            Diagnostic: e.Diagnostic,
            // 🔴 Stated on every response, because it is the sentence that stops a support engineer
            // chasing a licence when the caller's actual problem is a machine that will not run.
            OperationImpact: "None. Licence state never affects HALT, E-stop, mode, data collection, " +
                             "historian recording, alarm annunciation or operator screen rendering.");
    }
}

/// <summary>WS-E — <c>GET /v1/license</c>'s body: everything a support engineer needs to state the
/// licence situation from one call.</summary>
/// <param name="State">The <see cref="LicenseState"/> name.</param>
/// <param name="Edition">The edition label, or <c>"Core"</c>.</param>
/// <param name="LicenseId">ST4I's issue id, for quoting.</param>
/// <param name="Customer">The entitled customer.</param>
/// <param name="IssuedAtUtc">ISO-8601 issue time.</param>
/// <param name="ExpiresAtUtc">ISO-8601 expiry, or <see langword="null"/> for perpetual/none.</param>
/// <param name="GraceDays">The grace window length.</param>
/// <param name="Features">The effective feature set.</param>
/// <param name="FingerprintMatches">How many identity components match.</param>
/// <param name="FingerprintRequired">How many must match.</param>
/// <param name="BindingMode">🔴 <c>machine</c> (bound, the only mode a customer licence may use) or
/// <c>unbound-test-only</c>. Reported so an unbound licence is visible at a glance rather than inferred
/// from a threshold.</param>
/// <param name="IdentityWasRegenerated">🔴 Whether the device identity was regenerated this boot.</param>
/// <param name="EvaluatedAtUtc">The instant used for the window arithmetic — the wall clock, or the audit
/// floor when the wall clock was not credible.</param>
/// <param name="LicensePath">Where the file is expected on disk.</param>
/// <param name="Diagnostic">Engineer-facing detail.</param>
/// <param name="OperationImpact">Always states that operation is unaffected.</param>
public sealed record LicenseStatusDto(
    string State, string Edition, string? LicenseId, string? Customer, string? IssuedAtUtc,
    string? ExpiresAtUtc, int GraceDays, IReadOnlyList<string> Features, int FingerprintMatches,
    int FingerprintRequired, string BindingMode, bool IdentityWasRegenerated, string EvaluatedAtUtc,
    string LicensePath, string? Diagnostic, string OperationImpact);

/// <summary>WS-E — <c>GET /v1/license/fingerprint</c>'s body: the four components SEPARATELY, so support
/// can see which one moved.</summary>
/// <param name="DeviceIdentity">Hashed device-identity certificate thumbprint.</param>
/// <param name="MachineGuid">Hashed Windows MachineGuid.</param>
/// <param name="VolumeSerial">Hashed system volume identity.</param>
/// <param name="PrimaryMac">Hashed primary NIC MAC.</param>
/// <param name="IdentityWasRegenerated">🔴 Whether the identity was minted rather than loaded this boot.</param>
/// <param name="Warning">Human-readable form of the above, or <see langword="null"/>.</param>
public sealed record LicenseFingerprintDto(
    string? DeviceIdentity, string? MachineGuid, string? VolumeSerial, string? PrimaryMac,
    bool IdentityWasRegenerated, string? Warning);

/// <summary>WS-E — <c>POST /v1/license/activate</c>'s body.</summary>
/// <param name="Accepted">Always <see langword="true"/> on a 200 — a rejection is a 400.</param>
/// <param name="LicenseId">The installed licence's id.</param>
/// <param name="Edition">The installed edition.</param>
/// <param name="ExpiresAtUtc">ISO-8601 expiry, or <see langword="null"/> for perpetual.</param>
/// <param name="Message">🔴 States in words that a restart is required.</param>
public sealed record LicenseActivationResultDto(
    bool Accepted, string? LicenseId, string? Edition, string? ExpiresAtUtc, string Message);
