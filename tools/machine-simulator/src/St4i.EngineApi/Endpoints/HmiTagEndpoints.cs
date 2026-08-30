using Microsoft.Data.Sqlite;
using St4i.EngineApi.Auth;
using St4i.EngineApi.Fleet;
using St4i.EngineApi.HmiModel;
using St4i.Hmi.Contracts;

namespace St4i.EngineApi.Endpoints;

/// <summary>
/// WS-HMI-0b Task 2 — the tag-namespace HTTP surface over WS-HMI-0a's <see cref="ITagNamespaceStore"/>:
/// <c>GET /v1/tags?machine={code}</c> (Operator), <c>GET /v1/tags/by-path/{**path}</c> (Operator) and
/// <c>PUT /v1/tags/{machineCode}</c> (Engineer). Same shape as <c>HmiModelEndpoints.cs</c> next door —
/// <c>internal static</c> handlers bound by method group, returning <see cref="IResult"/>, errors as
/// <see cref="ApiErrorDto"/>, stores obtained as plain constructor parameters the minimal-API binder
/// resolves from DI (never a manual <c>GetRequiredService</c>) — see that file for the conventions this one
/// follows rather than restates.
///
/// <para>🔴 <b>TWO ROUTES, TWO DIFFERENT ANSWERS FOR "I DON'T HAVE THAT", AND THE DIFFERENCE IS DELIBERATE.</b>
/// <c>GET /v1/tags?machine=NOPE</c> returns <b>200 with an empty document</b>; <c>GET /v1/tags/by-path/…</c>
/// for an unknown path returns <b>404</b>. That is not an inconsistency to be tidied away: asking for a
/// SPECIFIC TAG that does not exist is genuinely "not found", while asking for the namespace of a machine
/// that has declared nothing is §5-bis — "a machine that has declared nothing" is a VALID product state, not
/// an error, and collapsing it to 404 would make "not yet commissioned" indistinguishable from "broken".
/// Both are pinned together in one test
/// (<c>HmiTagEndpointsTests.An_undeclared_machine_is_empty_200_while_an_unknown_tag_path_is_404</c>) so that
/// a change to either side has to face the other.</para>
///
/// <para>🔴 <b><c>{**path}</c> IS A CATCH-ALL AND MUST STAY ONE.</b> A tag <c>path</c> contains <c>/</c>
/// (<c>SCRW-01/spindle/torque</c>). A conventional <c>{path}</c> parameter matches ONE segment, so every
/// real tag would 404 — the route would be wrong for its entire population while looking right. Pinned by a
/// deliberately three-segment path, because a two-segment one would also pass against a <c>{a}/{b}</c>
/// route.</para>
///
/// <para>🔴 <b>A TAG PATH IS NOT DERIVABLE FROM A MACHINE CODE — look one up, never compose one.</b> This
/// is the endpoint that ruling (WS-HMI-0b Task 1, fix rounds 4/5) was written about.
/// <c>CanonicalizingTagNamespaceStore</c> canonicalises the machine code on <c>PutAsync</c>/<c>GetAsync</c>
/// and deliberately does NOT touch <see cref="ITagNamespaceStore.FindTagAsync"/>'s <c>path</c>, because
/// <c>tag_index.path</c> is a GLOBAL primary key with no machine-code-prefix requirement and
/// <c>ModelIntegrity.IsPathPrefix</c> is Ordinal by design. So <c>?machine=</c> is case-INSENSITIVE here and
/// <c>by-path/</c> is case-SENSITIVE, which is a real asymmetry a caller has to know about rather than a
/// bug — <c>A_machine_code_is_case_insensitive_but_a_tag_path_is_not</c> is that asymmetry made
/// mechanical.</para>
/// </summary>
public static class HmiTagEndpoints
{
    public static void MapHmiTagEndpoints(this IEndpointRouteBuilder app)
    {
        app.MapGet("/v1/tags", GetByMachineAsync).RequireAuthorization(Policies.Operator);
        app.MapGet("/v1/tags/by-path/{**path}", GetByPathAsync).RequireAuthorization(Policies.Operator);
        app.MapPut("/v1/tags/{machineCode}", PutAsync).RequireAuthorization(Policies.Engineer);
    }

    // ─────────────────────────────────────────────────────────────────────
    // GET /v1/tags?machine={code}
    //
    // 🔴 A MISSING OR BLANK ?machine= IS A 400, NOT "EVERY MACHINE". An endpoint that silently returns
    // everything when its filter is absent is how a UI accidentally drags down an entire site's namespace —
    // a namespace is hundreds or thousands of flat tags per machine, which is the reason TagNamespaceStore
    // carries a separate index table in the first place. The brief mandates this and gives that reason; its
    // own test list never pinned it, so the coordinator ruled the test REQUIRED and it exists:
    // GetByMachine_WithoutAUsableFilter_Gets400_NeverEveryMachine, which loads two real machines first so
    // that "returned everything" and "returned nothing" are distinguishable rather than two shades of empty.
    //
    // IsNullOrWhiteSpace, not IsNullOrEmpty: `?machine=` and `?machine=%20` are different doors and this
    // codebase has already shipped a round where exactly that distinction was the defect (fix round 4,
    // MEDIUM-1 — a whitespace-only policyAction was an ungated write door reported as gated). One rule.
    // ─────────────────────────────────────────────────────────────────────
    internal static async Task<IResult> GetByMachineAsync(string? machine, ITagNamespaceStore tags, CancellationToken ct)
    {
        if (string.IsNullOrWhiteSpace(machine))
        {
            return Results.BadRequest(new ApiErrorDto(
                "query parameter 'machine' is required — GET /v1/tags does not return every machine's " +
                "namespace. Ask for one machine: /v1/tags?machine={machineCode}."));
        }

        // `machine` passed RAW: `tags` is the canonicalizing decorator, and THAT is what makes this lookup
        // find the row regardless of the caller's casing — not a normalization line in this handler.
        // `canonicalCode` is computed separately and used ONLY for the empty-document echo.
        var doc = await tags.GetAsync(machine, ct).ConfigureAwait(false);
        var canonicalCode = MachineCodeIdentity.Canonicalize(machine);

        // §5-bis, the tag-namespace half: a machine whose namespace has not been loaded yet is a VALID
        // product state. 200 with an empty document, never 404 — see this class's own doc comment for why
        // the sibling by-path route answers differently.
        return Results.Json(
            doc ?? new TagNamespaceDocument(1, canonicalCode, Array.Empty<TagDescriptor>()),
            HmiContractJson.Options);
    }

    // ─────────────────────────────────────────────────────────────────────
    // GET /v1/tags/by-path/{**path}
    // ─────────────────────────────────────────────────────────────────────
    internal static async Task<IResult> GetByPathAsync(string path, ITagNamespaceStore tags, CancellationToken ct)
    {
        // Passed RAW and deliberately NOT canonicalised — a tag path is a different identity from a machine
        // code (see this class's doc comment). The decorator's FindTagAsync forwards it verbatim for the
        // same reason, and CanonicalMachineCodeStoresTests pins that it keeps doing so.
        var tag = await tags.FindTagAsync(path, ct).ConfigureAwait(false);

        return tag is null
            ? Results.NotFound(new ApiErrorDto($"no tag is declared at path '{path}'."))
            : Results.Json(tag, HmiContractJson.Options);
    }

    // ─────────────────────────────────────────────────────────────────────
    // PUT /v1/tags/{machineCode}
    //
    // 🔴 LAST-WRITER-WINS, same as PUT /v1/components/{machineCode} and for the same reason: the frozen
    // TagNamespaceDocument carries no concurrency token, and TagNamespaceStore writes `updated_at` but no
    // SELECT returns it, so this handler has nothing to compare a caller's belief against. Two engineers
    // re-declaring one machine's namespace concurrently silently lose an edit. Accepted by construction.
    //
    // 🔴 THE ROUTE/BODY GUARD is the same three-line shape ConfigEndpoints.cs uses three times and
    // HmiModelEndpoints.PutAsync uses once — fill the identity in when the body omits it, REJECT when the
    // body names a materially different machine — matched here rather than invented afresh. Without the
    // reject arm, PUT /v1/tags/INTENDED with body.machineCode "VICTIM" silently overwrites VICTIM's entire
    // namespace while reporting success, which is Task 1's HIGH-1 one contract over.
    // ─────────────────────────────────────────────────────────────────────
    internal static async Task<IResult> PutAsync(
        string machineCode, TagNamespaceDocument body, ITagNamespaceStore tags,
        ITagIndexCollisionQuery collisions, CancellationToken ct)
    {
        // `body` itself can never be null — TagNamespaceDocument is a non-nullable complex parameter, so
        // RequestDelegateFactory 400s an absent/literal-null body before this handler is entered.
        // `body.MachineCode` CAN be null/blank or differ only in case; both are handled here.
        if (!string.IsNullOrWhiteSpace(body.MachineCode) &&
            !string.Equals(body.MachineCode, machineCode, StringComparison.OrdinalIgnoreCase))
        {
            return Results.BadRequest(new ApiErrorDto(
                $"body.machineCode ('{body.MachineCode}') must match the route {{machineCode}} ('{machineCode}') (or be omitted)."));
        }

        if (string.IsNullOrWhiteSpace(body.MachineCode))
        {
            body = body with { MachineCode = machineCode };
        }

        try
        {
            // §5 door — the store validates and throws BEFORE opening a connection, so a rejected document
            // cannot leave a half-written record. This route is the FIRST HTTP traffic that
            // ContractInvariants.Validate(TagNamespaceDocument)'s element-field closure has ever received:
            // that closure (TagDescriptor.Path/Access, TagNamespaceDocument.MachineCode) was added in fix
            // round 3 justified by THIS task — "leaving this hole here would have shipped it on that task's
            // day one" — and HmiTagEndpointsTests probes it rather than assuming it.
            await tags.PutAsync(body, ct).ConfigureAwait(false);
        }
        catch (ContractViolationException ex)
        {
            // ex.Message already carries EVERY violation joined by the exception's own ctor, not the first.
            return Results.BadRequest(new ApiErrorDto(ex.Message));
        }
        catch (SqliteException ex) when (IsPathAlreadyClaimed(ex))
        {
            // 🔴 THE P1 HAZARD THIS CONTRACT HAS AND THE COMPONENT TREE DOES NOT, and which this task's
            // brief does not mention. `tag_index.path` is a GLOBAL primary key across every machine and
            // TagNamespaceStore.PutAsync loads it with a bare INSERT. ContractInvariants' duplicate-path
            // rule is scoped to ONE document and says so itself: "Luật này KHÔNG bắt được gì: hai MÁY KHÁC
            // NHAU cùng khai một path … Trường hợp ấy vẫn ném SqliteException ở store." Until this route
            // existed nothing could reach it from outside; now a client body that violates no §5 rule at
            // all can, and an unmapped SqliteException is a 500 — P1 measured false.
            //
            // 409, not 400, matching this codebase's own established answer for a UNIQUE-constraint
            // collision (UserEndpoints.cs:106 names this exact shape: "a raw UNIQUE-constraint
            // SqliteException (an unhandled 500), not a clean 409"). The document is well formed; the SAME
            // body would succeed against a database where no other machine had claimed the path, so this is
            // a conflict with server state rather than a malformed request.
            //
            // The store's transaction has already rolled back by the time this runs (PutAsync's `using var
            // transaction` disposes without a Commit on the throw path), so P2 holds and the diagnosis
            // below reads the pre-existing state, not a partial one.
            var claimed = await DescribeClaimedPathsAsync(body, machineCode, collisions, ct).ConfigureAwait(false);

            // "showing 10 of 27", never a hedge. Fix round 1 said "there may be more" because a
            // prefix-limited probe genuinely did not know; the bulk query knows the exact total, so the
            // message states it. That also dissolves fix round 1's other defect (re-review NEW-2): the
            // truncation notice used to be omitted on the found-nothing branch — precisely the case where
            // the cap had bitten — leaving a caller unable to tell "no collision" from "gave up looking".
            // There is no longer a "gave up looking" state to be unable to distinguish.
            var shown = claimed.Take(MaxNamedCollisions).ToList();
            return Results.Conflict(new ApiErrorDto(
                claimed.Count > 0
                    ? $"tag path(s) already declared by another machine: {string.Join(", ", shown)}" +
                      (claimed.Count > shown.Count ? $" (showing {shown.Count} of {claimed.Count})" : "") +
                      ". A tag path is a GLOBAL key across every machine, not a per-machine one — rename " +
                      "the path, or retire it from the machine that owns it first."
                    : $"a tag path in this namespace is already declared by another machine ({ex.Message})."));
        }

        var tagCount = body.Tags.Count;
        var backedByDriverCount = body.Tags.Count(t => t is { IsBackedByDriver: true });

        // Response echo only — computed after the store call, never used to decide what got written.
        return Results.Ok(new PutNamespaceResultDto(
            MachineCodeIdentity.Canonicalize(machineCode), tagCount, backedByDriverCount));
    }

    /// <summary>Narrowed to the two extended codes a duplicate <c>tag_index.path</c> can actually raise.
    /// <c>SqliteErrorCode == 19</c> (<c>SQLITE_CONSTRAINT</c>) alone is NOT specific enough — the same base
    /// code covers NOT NULL violations, so matching on it would map a genuine bug to a tidy 409 and hide it.
    /// Same reasoning, and the same two codes, as <c>AdminRecoveryVerbs.IsAppendIdCollision</c>, which
    /// documents having verified this against this exact <c>Microsoft.Data.Sqlite</c> package.</summary>
    private static bool IsPathAlreadyClaimed(SqliteException ex) =>
        ex.SqliteErrorCode == 19 // SQLITE_CONSTRAINT
        && (ex.SqliteExtendedErrorCode == 1555 // SQLITE_CONSTRAINT_PRIMARYKEY — tag_index.path is the PK
            || ex.SqliteExtendedErrorCode == 2067); // SQLITE_CONSTRAINT_UNIQUE — defensive alternate

    /// <summary>How many colliding paths the 409 NAMES. Purely a presentation choice now that
    /// <see cref="ITagIndexCollisionQuery"/> finds them all in bulk — an error listing hundreds of paths is
    /// not a diagnosis, and the message states the exact total alongside ("showing 10 of 27") rather than
    /// hedging. In fix round 1 this doubled as a correctness bound, which is what made a collision past the
    /// cut-off undiagnosable; it no longer bounds what is FOUND, only what is PRINTED.</summary>
    internal const int MaxNamedCollisions = 10;

    /// <summary>Names the offending path(s) so the 409 is actionable — SQLite's own message says only
    /// <c>UNIQUE constraint failed: tag_index.path</c> and never which value collided.
    ///
    /// <para>Runs ONLY on the failure path, so it costs nothing in normal operation. It asks
    /// <see cref="ITagIndexCollisionQuery"/> ONE bulk question rather than probing per tag — see that
    /// type's doc comment for why fix round 1's per-tag loop had to go and what property replaced it:
    /// <b>a collision anywhere in the body is diagnosed, and the cost does not grow per tag.</b></para>
    ///
    /// <para><b>Paths this machine already owns cannot appear</b>, and that is now decided by the table
    /// that actually owns the answer: the query compares <c>tag_index.machine_code</c> against this
    /// machine's canonical code. Fix round 1 inferred the same thing from the machine's own stored
    /// document, which worked but asked a proxy. Without the exclusion in either form the 409 names the
    /// claimant's own paths as another machine's and sends an engineer to rename paths nobody else owns —
    /// pinned by <c>A_409_names_the_path_another_machine_owns_and_never_the_claimants_own</c>, which,
    /// unlike the re-declaration test this once cited, actually enters the 409 path.</para>
    ///
    /// <para><b>Duplicates are collapsed before the query</b>: a body may legally repeat a path (that is
    /// ContractInvariants' rule to refuse, not this diagnosis's), and asking about it twice would both
    /// waste a parameter slot and print it twice.</para>
    ///
    /// <para>🔴 <b>TOTAL by design, and that is the point rather than a lapse (fix round 1, F3).</b> This
    /// method previously caught only <see cref="SqliteException"/> while standing under a comment saying a
    /// throwing diagnosis "would turn the 409 it is explaining back into the 500 it exists to prevent" —
    /// which was exactly what it permitted: the diagnostic reads <c>JsonSerializer.Deserialize</c> a stored
    /// document, so a <see cref="System.Text.Json.JsonException"/> from a corrupt row escaped and the code
    /// written to close a 500 path opened one on its own error branch. The fix is not "add JsonException to
    /// the list" — that closes the type a review named and leaves the next one. The PROPERTY is: <b>no path
    /// through the collision handler, including its diagnosis, may produce a 500.</b> A best-effort
    /// explanation is never more important than the answer it decorates, so every failure degrades to "no
    /// paths named" and the caller falls back to SQLite's own message.
    /// <see cref="OperationCanceledException"/> is the one deliberate exception: a cancelled request is the
    /// caller going away, not a server error, and reporting a conflict that never happened would be worse
    /// than propagating. Pinned by <c>A_collision_diagnosis_that_fails_still_answers_409_never_500</c> and
    /// <c>A_cancelled_request_still_propagates_out_of_the_collision_diagnosis</c>.</para></summary>
    private static async Task<IReadOnlyList<string>> DescribeClaimedPathsAsync(
        TagNamespaceDocument body, string machineCode, ITagIndexCollisionQuery collisions, CancellationToken ct)
    {
        try
        {
            var candidates = body.Tags
                .Where(t => t is not null && !string.IsNullOrWhiteSpace(t.Path))
                .Select(t => t.Path)
                .Distinct(StringComparer.Ordinal)
                .ToList();

            return await collisions
                .ClaimedByAnotherMachineAsync(MachineCodeIdentity.Canonicalize(machineCode), candidates, ct)
                .ConfigureAwait(false);
        }
        catch (OperationCanceledException)
        {
            // The caller went away. Not this handler's failure to explain, and not a conflict.
            throw;
        }
        catch (Exception)
        {
            // Deliberately total — see this method's own doc comment. The 409 is the answer; the list of
            // names is decoration, and decoration must never be able to replace the answer with a 500.
            return Array.Empty<string>();
        }
    }
}
