using Microsoft.Data.Sqlite;
using St4i.EdgeCore.Identity;
using St4i.EngineApi.Auth;
using St4i.EngineApi.Fleet;
using St4i.EngineApi.HmiModel;
using St4i.Hmi.Contracts;

namespace St4i.EngineApi.Endpoints;

/// <summary>
/// Session 4 (HMI-5) — the two screen-pack routes, over <see cref="HmiScreenPackService"/>. Same shape as
/// <c>HmiScreenEndpoints.cs</c> next door — <c>internal static</c> handlers bound by method group,
/// returning <see cref="IResult"/>, errors as <see cref="ApiErrorDto"/>, dependencies as plain constructor
/// parameters the minimal-API binder resolves from DI — see that file for the conventions this one follows
/// rather than restates.
///
/// ══════════════════════════════════════════════════════════════════════════════════════════════════
/// 🔴 THE TWO TIERS, AND WHY IMPORT IS ENGINEER RATHER THAN ADMIN
/// ══════════════════════════════════════════════════════════════════════════════════════════════════
/// <b><c>GET /v1/screens/export</c> is <see cref="Policies.Operator"/>.</b> It is a READ, and it returns
/// EXACTLY what an Operator can already fetch one screen at a time through
/// <c>GET /v1/screens/{screenId}</c> and <c>GET /v1/screens/{screenId}/versions</c>, both Operator. Gating
/// a batched read above the tier of the reads it batches would be a difference with no reason behind it —
/// the same argument the census already records for <c>/v1/hmi/changes</c> ("gating a notification higher
/// than the data it points at"). Nothing here touches a device.
///
/// <b><c>POST /v1/screens/import</c> is <see cref="Policies.Engineer"/> — weighed against the publish tier,
/// not defaulted to it.</b> The import writes screen documents, which is precisely what
/// <c>PUT /v1/screens/{screenId}</c> does, and that route is Engineer for a reason the census states:
/// authoring a screen is a CONFIGURATION authority, not a DEVICE authority; nothing in this workstream
/// writes to a machine.
///
/// The case for putting import HIGHER, at Admin, and why it loses: an import writes MANY screens at once
/// and can move the current pointer of screens the importer never authored, so it has more blast radius
/// than one publish. That is a real difference in SCALE — and scale is not what separates the tiers in
/// this census. Admin is reserved for the routes that reach a machine or change who may reach one
/// (<c>POST /v1/machines/{code}/command</c>, the user store, identity rotation). An import reaches no
/// machine. Putting it at Admin would say "batching Engineer-tier writes creates Admin-tier authority",
/// which is not a rule this codebase holds anywhere else — <c>POST /v1/machines/{code}/config/push</c>
/// pushes a whole configuration at Engineer.
///
/// And the blast radius is smaller than it first appears, because of the append-only boundary: an import
/// destroys nothing. Every prior version survives, every imported screen is one <c>rollback</c> — already
/// Engineer, already audited — from being undone. An operation that is fully reversible by an
/// Engineer-tier route does not need a higher tier than that route to invoke.
///
/// 🔴 Both rows join the RBAC census (<c>RbacPolicyTests</c>) in this same commit.
///
/// ══════════════════════════════════════════════════════════════════════════════════════════════════
/// 🔴 ROUTE ORDER — <c>export</c>/<c>import</c> ARE LITERAL SEGMENTS UNDER <c>/v1/screens/</c>
/// ══════════════════════════════════════════════════════════════════════════════════════════════════
/// <c>GET /v1/screens/export</c> sits in the same literal-vs-parameter position <c>/v1/screens/generate</c>
/// already occupies against <c>GET /v1/screens/{screenId}</c>. ASP.NET scores a literal segment above a
/// parameter one, so this is correct regardless of registration order — and, exactly as
/// <c>HmiScreenEndpoints</c> does for <c>generate</c>, these are mapped in a call placed BEFORE the by-id
/// route in <c>Program.cs</c> so the precedence is visible in the source rather than only in the matcher's
/// table. The cost is the same and is stated the same way: <c>export</c> is no longer reachable as a
/// screen ID over GET. Measured — nothing in this repository declares, ships or tests a screen by that
/// name (<c>import</c> is a POST to a route with no by-id POST sibling, so it costs nothing at all).
///
/// ══════════════════════════════════════════════════════════════════════════════════════════════════
/// 🔴 THE IMPORT'S STATUS CODE IS 200, NOT 207 OR 400, EVEN WHEN AN ENTRY IS REFUSED
/// ══════════════════════════════════════════════════════════════════════════════════════════════════
/// An import is a BATCH whose entries succeed or fail independently (see
/// <c>HmiScreenPackService.ImportAsync</c>'s doc comment for why all-or-nothing is not honestly available
/// over a store that cannot delete). The request itself was well-formed and was fully processed, so 200 is
/// the truthful status; the per-entry outcomes are the answer, and the response carries a labelled row for
/// every screen. A 400 would claim the caller sent a bad REQUEST when they sent a good request containing
/// one bad DOCUMENT, and — worse — would suggest nothing was written when eleven of twelve screens landed.
/// The one whole-request refusal that IS a 400 is an unreadable wrapper: a <c>packVersion</c> this engine
/// does not know, refused before any entry is examined.
/// </summary>
public static class HmiScreenPackEndpoints
{
    /// <summary>Audit action for one screen landing through an import. A SEPARATE id from
    /// <c>HmiScreenEndpoints.PublishAction</c>, for the identical reason that file gives for keeping
    /// <c>rollback</c> separate from <c>publish</c>: "arrived in a pack from another machine" and
    /// "authored here" are different acts, and an investigator filters on the action.</summary>
    internal const string ImportAction = "hmi.screen.import";

    /// <summary>Audit action for producing a pack. Recorded even though an export writes nothing to the
    /// screen store, because an export COPIES an entire machine's screens OUT — the one question an
    /// investigator asks after a leak is who took a copy and when, and a read that answers it only by its
    /// absence from the log is a read nobody can investigate.</summary>
    internal const string ExportAction = "hmi.screen.export";

    public static void MapHmiScreenPackEndpoints(this IEndpointRouteBuilder app)
    {
        app.MapGet("/v1/screens/export", ExportAsync).RequireAuthorization(Policies.Operator);
        app.MapPost("/v1/screens/import", ImportAsync).RequireAuthorization(Policies.Engineer);
    }

    // ─────────────────────────────────────────────────────────────────────
    // GET /v1/screens/export[?screenId=a&screenId=b]
    //
    // Omitting `screenId` exports every screen in the store. Naming one or more exports exactly those that
    // exist; a named screen that does not exist is skipped rather than 404ing the whole pack — the same
    // convention IHmiScreenStore.GetAsync follows ("a screen nobody declared is a valid product state"),
    // and the caller sees which arrived by reading the pack's own entry list.
    // ─────────────────────────────────────────────────────────────────────
    internal static async Task<IResult> ExportAsync(
        string[]? screenId, HmiScreenPackService packs, DeviceIdentityProvider identity,
        HttpContext context, AuditRecorder recorder, CancellationToken ct)
    {
        var pack = await packs.ExportAsync(identity.Current.Fingerprint, screenId, ct).ConfigureAwait(false);

        // After the read, before the response is built — same ordering as every mutating handler next
        // door, and CancellationToken.None for the same reason: the copy has already been made, and a
        // caller who walks away must not be the reason it went unrecorded.
        await recorder.RecordAsync(
            context, ExportAction, "screen-pack", $"{pack.Screens.Count} screen(s)",
            null,
            new { screenIds = pack.Screens.Select(s => s.ScreenId).ToArray(), invalid = pack.Screens.Count(s => !s.ExportValid) },
            CancellationToken.None).ConfigureAwait(false);

        // HmiContractJson.Options, never Results.Ok: the pack CARRIES HmiScreenDocuments, whose optional
        // fields (`titleEn`, `component`, `bindings`, `props`, `policyAction`) only these options serialise
        // under this contract family's "absence IS null, never written explicitly" rule. Serialising the
        // wrapper with default options would reshape the frozen documents inside it.
        return Results.Json(pack, HmiContractJson.Options);
    }

    // ─────────────────────────────────────────────────────────────────────
    // POST /v1/screens/import
    //
    // 🔴 APPENDS ONLY. Every entry lands through IHmiScreenStore.PutAsync, which never overwrites a stored
    // version — see HmiScreenPackService's doc comment for why that is structural rather than a check, and
    // for the id-collision decision this route reports per screen.
    // ─────────────────────────────────────────────────────────────────────
    internal static async Task<IResult> ImportAsync(
        ScreenPackDocument body, HmiScreenPackService packs, IHmiChangeBus changes,
        HttpContext context, AuditRecorder recorder, CancellationToken ct)
    {
        IReadOnlyList<ScreenImportResult> results;
        try
        {
            results = await packs.ImportAsync(body, ct).ConfigureAwait(false);
        }
        catch (ArgumentOutOfRangeException ex)
        {
            // An unreadable WRAPPER — refused whole, nothing examined, nothing written. See this class's
            // doc comment for why this is the one whole-request 400.
            return Results.BadRequest(new ApiErrorDto(StripParameterFraming(ex.Message)));
        }
        catch (SqliteException ex) when (HmiScreenEndpoints.IsWriteLockBusy(ex))
        {
            return WriteBusy();
        }

        // One audit row per screen that actually landed, carrying the outcome so "appended over an existing
        // screen" is distinguishable from "created" in the log as well as in the response. Refusals are not
        // audited as writes because they were not writes — they wrote nothing.
        foreach (var landed in results.Where(r => r.Version is not null))
        {
            await recorder.RecordAsync(
                context, ImportAction, "screen", landed.ScreenId,
                null,
                new { version = landed.Version, outcome = landed.Outcome.ToString() },
                CancellationToken.None).ConfigureAwait(false);
        }

        var response = Results.Ok(new ScreenImportReportDto(
            results.Count,
            results.Count(r => r.Outcome == ScreenImportOutcome.Created),
            results.Count(r => r.Outcome == ScreenImportOutcome.AppendedAsNewVersion),
            results.Count(r => r.Version is null),
            results.Select(r => new ScreenImportResultDto(
                r.ScreenId, r.Outcome.ToString(), r.Version, r.Violations)).ToList()));

        // Announced AFTER the response object exists and nothing that can throw remains — the same
        // ordering rule HmiScreenEndpoints.PutAsync states and for the same reason. One event per screen
        // that landed: the lane's fact is "screenId is now at version", which is per screen, not per batch.
        foreach (var landed in results.Where(r => r.Version is not null))
        {
            changes.Publish(HmiModelEvents.ScreenChanged(landed.ScreenId, landed.Version!.Value));
        }

        return response;
    }

    private static string StripParameterFraming(string message)
    {
        var idx = message.IndexOf(" (Parameter", StringComparison.Ordinal);
        return idx < 0 ? message : message[..idx];
    }

    /// <summary>Same 503 and same reasoning as <c>HmiScreenEndpoints</c>'s own write-busy answer — see that
    /// class's doc comment for the measurement behind choosing 503 over 409 or a bare 500.</summary>
    private static IResult WriteBusy() => Results.Json(
        new ApiErrorDto(
            "the screen store is busy with another write right now — this request was well-formed and " +
            "would likely succeed on retry; wait a moment and try again."),
        statusCode: StatusCodes.Status503ServiceUnavailable);
}

/// <summary>One row of an import report. <paramref name="Outcome"/> is the
/// <see cref="ScreenImportOutcome"/> name — <c>Created</c>, <c>AppendedAsNewVersion</c>,
/// <c>RejectedInvalid</c> or <c>RejectedIdentityConflict</c>. <paramref name="Version"/> is where the
/// document landed IN THIS STORE (never the pack's provenance version) and is <see langword="null"/> for a
/// refusal.</summary>
public sealed record ScreenImportResultDto(
    string ScreenId, string Outcome, int? Version, IReadOnlyList<string> Violations);

/// <summary>What an import did. The four counts are a SUMMARY of <paramref name="Results"/>, never a
/// replacement for it — <paramref name="Appended"/> in particular is the id-collision count, and it is
/// reported separately from <paramref name="Created"/> precisely so an engineer cannot miss that an
/// existing screen was moved to a new current version.</summary>
public sealed record ScreenImportReportDto(
    int Total, int Created, int Appended, int Rejected, IReadOnlyList<ScreenImportResultDto> Results);
