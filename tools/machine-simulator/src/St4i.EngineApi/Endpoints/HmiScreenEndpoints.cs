using Microsoft.Data.Sqlite;
using St4i.EngineApi.Auth;
using St4i.EngineApi.Fleet;
using St4i.EngineApi.HmiModel;
using St4i.Hmi.Contracts;

namespace St4i.EngineApi.Endpoints;

/// <summary>
/// WS-HMI-2 Task 3 — the screen HTTP surface over Task 1/2's <see cref="IHmiScreenStore"/>: five routes
/// (six behaviours — <c>GET /v1/screens/{screenId}</c> answers both "current" and "?version=N" through one
/// mapped route). Same shape as <c>HmiTagEndpoints.cs</c> next door — <c>internal static</c> handlers bound
/// by method group, returning <see cref="IResult"/>, errors as <see cref="ApiErrorDto"/>, the store obtained
/// as a plain constructor parameter the minimal-API binder resolves from DI (never a manual
/// <c>GetRequiredService</c>) — see that file for the conventions this one follows rather than restates.
/// <c>store</c> is always <see cref="CanonicalizingHmiScreenStore"/>: <c>Program.cs</c> hands out only the
/// decorator, never the raw, whitespace-sensitive-keyed <see cref="HmiScreenStore"/>, so every
/// <c>screenId</c> this file sees is trimmed before the inner store's SQL parameter ever binds it.
///
/// <para>🔴 <b>WHY <c>GET /v1/screens/{screenId}</c> IS 404 FOR AN UNDECLARED SCREEN WHILE ITS TWO SIBLING
/// ROUTES ARE EMPTY-200 — Step 1 of this task's brief, decided and recorded here so a reader who skims both
/// families in one sitting does not conclude they disagree by accident.</b> <c>GET /v1/components/{code}</c>
/// and <c>GET /v1/tags?machine=</c> both answer 200 with an EMPTY document for a machine that has declared
/// nothing, because §5-bis says "a machine that has declared nothing" is a VALID product state — the machine
/// still runs, it simply has no component tree or tag namespace loaded yet. <b>A screen is a different
/// question.</b> There is no such thing as a valid EMPTY screen: a document with zero widgets still had to be
/// authored by somebody, on purpose, through this very <c>PUT</c> route — it is not a default state a machine
/// starts in the way "no component tree yet" is. So <c>screenId</c> nobody ever <c>PUT</c> is not "loaded and
/// empty", it is simply NOT FOUND, and 404 is the honest answer. §5-bis is not violated by this: a machine
/// with no screen declared for it still runs fine, exactly as a machine with no component tree does — nothing
/// about §5-bis says every kind of "not yet declared" must read back the same way, only that a machine's own
/// absence of declaration must not be treated as an error. <b>The differentiator, stated plainly:</b> asking
/// for a NAMESPACE/TREE that nobody has loaded yet is asking about a machine's declared STATE, which can
/// legitimately be "nothing so far"; asking for a SCREEN nobody ever authored is asking for a DOCUMENT that
/// was never created, and a document that was never created is not found — the same distinction
/// <c>HmiTagEndpoints.cs</c> already draws between its own two routes (<c>?machine=</c> vs <c>by-path/</c>),
/// applied one level up.</para>
///
/// <para>🔴 <b>WHY <c>PUT</c>'S ROUTE/BODY <c>screenId</c> MISMATCH IS 409, NOT THE 400 ITS SIBLING ROUTES
/// USE — a deliberate departure from <c>HmiModelEndpoints.PutAsync</c>/<c>HmiTagEndpoints.PutAsync</c>,
/// mandated by this task's own interface table, not an oversight.</b> Both sibling routes treat a
/// route-vs-body machine-code disagreement as a malformed REQUEST (400): a machine code carries no version
/// history, so "which one did you mean" has no server-state dimension to conflict with. A screen does — every
/// <c>screenId</c> names a whole VERSION HISTORY this store already owns, and refusing a body that names a
/// DIFFERENT existing (or about-to-exist) history than the route is closer to a conflict with what the server
/// already holds than to "this JSON is shaped wrong". 409 also matches HIGH-1 of WS-HMI-0b (the ruling this
/// guard exists to prevent a re-run of): a caller who PUTs to <c>/v1/screens/INTENDED</c> with
/// <c>body.screenId = "VICTIM"</c> must be told plainly that TWO IDENTITIES were named and neither was
/// silently chosen — not have the body's identity silently win (which would overwrite VICTIM's whole history
/// while the caller believes INTENDED was written) and not have the route's identity silently win either
/// (which would launder body.screenId's identity out of the picture with no signal). The response names BOTH
/// values for exactly that reason.</para>
///
/// <para>🔴 <b><c>SQLITE_BUSY</c> (<c>SqliteErrorCode == 5</c>), AND WHY <c>HmiTagEndpoints.cs</c>'s
/// primary-key catch is DEAD CODE at this door.</b> Measured in Task 1 (<c>HmiScreenStoreTests.cs</c>'s own
/// doc comment): under real write contention, <see cref="HmiScreenStore.PutAsync"/> (and, by the same
/// mechanism, <see cref="HmiScreenStore.RollbackAsync"/> — both append through the same
/// <c>AppendVersionAsync</c>, which opens the transaction) blocks for ~34 SECONDS — roughly SEVEN TIMES the
/// configured <c>busy_timeout=5000</c> — and then throws <see cref="SqliteException"/> with
/// <c>SqliteErrorCode == 5</c> (<c>SQLITE_BUSY</c>), thrown from <c>BeginTransaction()</c> ITSELF, before any
/// read or write statement runs. <c>src/</c> carries no <c>UseExceptionHandler</c>, no
/// <c>IExceptionHandler</c>, no <c>ProblemDetails</c> mapping (grepped, zero hits for all three) — so an
/// uncaught one becomes an HTTP 500 WITH AN EMPTY BODY, after holding the request thread for roughly half a
/// minute. <c>HmiTagEndpoints.cs:161</c>'s
/// <c>catch (SqliteException ex) when (IsPathAlreadyClaimed(ex))</c> matches SqliteErrorCode 19 (
/// <c>SQLITE_CONSTRAINT</c>) with extended code 1555/2067 — a PRIMARY KEY or UNIQUE violation. That shape is
/// correct where it lives (a global <c>tag_index.path</c> collision really does surface that way) and would
/// be DEAD CODE here: <c>HmiScreenStore.AppendVersionAsync</c> computes <c>nextVersion</c> as
/// <c>MAX(version)+1</c> for THIS caller's own already-serialised write inside the SAME transaction that
/// takes the write lock at <c>BEGIN IMMEDIATE</c> — a second, concurrent writer never reaches the
/// <c>INSERT</c> at all; it is blocked at <c>BEGIN</c> until the first commits or the wait exceeds
/// <c>busy_timeout</c>. The primary-key constraint this store's own doc comment calls out as "a concurrency
/// bug, not a case this store's contract asks it to paper over silently" therefore never fires on this path;
/// the real contention error is <c>SQLITE_BUSY</c>, a completely different <c>SqliteErrorCode</c>.</para>
///
/// <para><b>What an operator sees instead of the 34-second blank, and why this and not something else:</b>
/// <c>503 Service Unavailable</c> with an <see cref="ApiErrorDto"/> naming the store as busy and inviting a
/// retry — the SAME status this codebase already uses for "a dependency this handler needs is not currently
/// usable" (<c>NotificationEndpoints.StoreUnavailable</c>). 503 rather than 409: this is not a conflict with
/// another caller's COMMITTED state (nothing committed, nothing to disagree with) — it is a dependency
/// (SQLite's own write lock) being contended RIGHT NOW, which is the textbook shape 503 exists for and the
/// shape a client's own retry logic already expects to see for "try again shortly". 503 rather than a bare
/// 500: the caller sent a well-formed request that would have succeeded had it arrived a few seconds later —
/// telling it "your request was malformed" (400) or "the server is broken" (500, and here, for half a minute,
/// silently) would both be worse answers than "this exact request is retriable". The wait itself is NOT
/// shortened by this fix — <c>busy_timeout=5000</c> is <see cref="HmiScreenStore"/>'s own pragma, frozen by
/// Task 1, and this endpoint does not touch it — what changes is that the caller gets a clean, fast-to-parse
/// 503 with a reason INSTEAD OF an empty-bodied 500 after the same wait. Applied to BOTH <c>PUT</c> and
/// <c>rollback</c>, because <see cref="IHmiScreenStore.RollbackAsync"/> appends through the identical
/// <c>BeginTransaction()</c> call path. NOT applied to the four read routes: none of them opens a
/// transaction, and SQLite's WAL mode lets readers proceed without blocking on a writer's lock — there is no
/// reachable <c>SQLITE_BUSY</c> on a read in this store TODAY, ON AN ALREADY-MIGRATED DATABASE — scoped
/// deliberately, not left absolute: <c>HmiScreenStore.EnsureSchema()</c> DOES open <c>BEGIN IMMEDIATE</c>
/// for any entry in its own <c>Migrations</c> ladder newer than the database's stored
/// <c>PRAGMA user_version</c> (that store's own doc comment already anticipates "future screen-store schema
/// changes append a new <c>(Version, Statements)</c> entry here"), and <see cref="IHmiScreenStore"/>'s DI
/// registration is a LAZY factory — so the FIRST read route resolved after such a migration ships is what
/// runs it, under a real writer, and would hit the exact uncaught 34-second path this class exists to close
/// on the write side. Not fixed here (no migration exists today to fix it against); named so a future
/// migration author reads this before assuming reads stay exempt forever.</para>
///
/// <para>📎 🔴 <b>"THIS TASK DOES NOT PUBLISH AN <see cref="HmiModelChangedEvent"/>" — RÚT, WS-HMI-2 Task 4,
/// giữ nguyên văn ở trên.</b> Đúng cho tới hết <c>0e0514d5</c>. <c>HmiModelEvents.ScreenChanged</c> now
/// exists, and both <see cref="PutAsync"/> and <see cref="RollbackAsync"/> call
/// <see cref="IHmiChangeBus.Publish"/> with it. <see cref="PutAsync"/> publishes
/// <c>HmiModelEvents.ScreenChanged(screenId, version)</c> where <c>version</c> is what
/// <c>store.PutAsync</c> returned. <see cref="RollbackAsync"/> publishes the SAME factory call with the NEW
/// version <c>store.RollbackAsync</c> returned — never <c>body.ToVersion</c>, the version the caller asked
/// to restore — because a subscriber that re-reads after a rollback sees the restored CONTENT sitting at
/// the new, highest version number, and an event naming the old target would send that re-read looking at
/// the wrong row. Both publishes pass the RAW <c>screenId</c> parameter, not a pre-canonicalised one —
/// <c>HmiModelEvents.ScreenChanged</c> canonicalises internally, the one place this rule cannot be forgotten
/// at a call site, same shape <c>ComponentModelChanged</c>/<c>TagNamespaceChanged</c> already use for
/// machine codes.</para>
///
/// <para>📎 🔴 <b>"...one line dropped into the ordering Task 3 shaped for exactly this, unchanged: build
/// the response value first, run whatever else comes after, publish, then <c>return</c> LAST" — RÚT for
/// <see cref="RollbackAsync"/> specifically, WS-HMI-2 Task 4 fix round 1 (review INFO), giữ nguyên văn ở
/// trên.</b> True for <see cref="PutAsync"/> still — nothing between its store call and its response can
/// throw, so the response-first ordering costs nothing and is kept. FALSE for <see cref="RollbackAsync"/>
/// as of this fix round: its publish now sits IMMEDIATELY after <c>store.RollbackAsync</c> commits, BEFORE
/// the post-commit <c>WidgetCount</c> read, not after building the response. The write's own doc comment
/// (<c>HmiModelChangedEvent</c>) commits only to "published only AFTER the store has accepted the write" —
/// under the old ordering, a rollback that committed and was then cancelled while decorating its own
/// response with <c>WidgetCount</c> announced NOTHING, silently breaking that commitment on a lane with no
/// backfill to recover the miss. See <see cref="RollbackAsync"/>'s own doc comment at the publish call for
/// the full reasoning, including why moving it earlier does not reopen the hazard the old ordering
/// guarded against.</para>
/// </summary>
public static class HmiScreenEndpoints
{
    /// <summary>
    /// 🔴 SECURITY REVIEW MEDIUM-1 — the two audit actions this family records.
    ///
    /// <para><b>Neither screen write produced an audit record before this,</b> while fifteen other
    /// endpoint families in this directory did, and the <c>screens</c> table has no author column. The
    /// consequence the review names: an Engineer publishes to <c>machine-aoi-01</c>, every operator on
    /// AOI-01 sees a different panel on the next load, and afterwards <b>no artefact anywhere names who
    /// did it</b> — not the audit log, not the version history. This branch is the first HMI write whose
    /// effect is what an operator sees on the machine in front of them, which is why the gap starts to
    /// matter here.</para>
    ///
    /// <para><b>Named on the existing convention, not a new one:</b> <c>&lt;domain&gt;.&lt;thing&gt;
    /// .&lt;verb&gt;</c>, the same shape as <c>machine.setpoint.write</c>, <c>asset.lifecycle.set</c> and
    /// the rest.</para>
    ///
    /// <para>🔴 <b>WHY THE ENGINE DOES NOT RESOLVE THE MACHINE, and why <c>targetId</c> is enough.</b>
    /// The <c>machine-</c> prefix is a BROWSER-side derivation (<c>web/src/hmi-runtime/publishedScreen.ts</c>
    /// says so of itself), and the review's §3 ruling is that it must stay one: <c>Policies.Engineer</c>
    /// is fleet-wide, so there is no per-machine authority for the engine to consult, and dragging a
    /// roster lookup into this path would import exactly the coupling that ruling rejected — plus a story
    /// for a machine that leaves the roster. It is also unnecessary: the screen id RECORDED here is
    /// <c>machine-aoi-01</c> verbatim, so an investigator reading the row sees both that a machine panel
    /// was the target and which machine, without the engine having to hold an opinion about the prefix.</para>
    /// </summary>
    internal const string PublishAction = "hmi.screen.publish";

    /// <summary>See <see cref="PublishAction"/>. A separate action id rather than a flag on the same one,
    /// because "restored an old version" and "published new authorship" are different acts and an
    /// investigator filters on the action.</summary>
    internal const string RollbackAction = "hmi.screen.rollback";

    public static void MapHmiScreenEndpoints(this IEndpointRouteBuilder app)
    {
        app.MapGet("/v1/screens", ListAsync).RequireAuthorization(Policies.Operator);
        // Session 2 (HMI-3) — READ-ONLY, and mapped BEFORE the by-id route on purpose. ASP.NET routing
        // scores a literal segment above a parameter one, so `/v1/screens/generate` reaches this handler
        // and never `GetAsync` with `screenId == "generate"`; the map order merely makes that visible to a
        // reader instead of leaving it to the matcher's precedence table. The cost is that `generate` is
        // no longer reachable as a screen ID over GET — measured, nothing in this repository declares,
        // ships or tests a screen by that name.
        app.MapGet("/v1/screens/generate", GenerateAsync).RequireAuthorization(Policies.Engineer);
        app.MapGet("/v1/screens/{screenId}", GetAsync).RequireAuthorization(Policies.Operator);
        app.MapPut("/v1/screens/{screenId}", PutAsync).RequireAuthorization(Policies.Engineer);
        app.MapGet("/v1/screens/{screenId}/versions", ListVersionsAsync).RequireAuthorization(Policies.Operator);
        app.MapPost("/v1/screens/{screenId}/rollback", RollbackAsync).RequireAuthorization(Policies.Engineer);
    }

    // ─────────────────────────────────────────────────────────────────────
    // GET /v1/screens
    // ─────────────────────────────────────────────────────────────────────
    internal static async Task<IResult> ListAsync(IHmiScreenStore store, CancellationToken ct)
    {
        var ids = await store.ListScreenIdsAsync(ct).ConfigureAwait(false);
        return Results.Ok(ids);
    }

    // ─────────────────────────────────────────────────────────────────────
    // GET /v1/screens/{screenId}[?version=N] — see this class's own doc comment for why an undeclared
    // screen is 404, never the empty-200 §5-bis gives its component-tree/tag-namespace siblings.
    // ─────────────────────────────────────────────────────────────────────
    internal static async Task<IResult> GetAsync(string screenId, int? version, IHmiScreenStore store, CancellationToken ct)
    {
        var doc = await store.GetAsync(screenId, version, ct).ConfigureAwait(false);
        if (doc is not null)
        {
            return Results.Json(doc, HmiContractJson.Options);
        }

        return Results.NotFound(new ApiErrorDto(
            version is null
                ? $"no screen is declared with id '{screenId}'."
                : $"screen '{screenId}' has no version {version.Value}."));
    }

    // ─────────────────────────────────────────────────────────────────────
    // GET /v1/screens/generate?machine={code}
    //
    // 🔴 READ-ONLY, AND IT STORES NOTHING. The document is computed by `ScreenGenerator` (pure, static —
    // `TagNamespaceBuilder` is the precedent) from the machine's DECLARED component tree and handed back
    // over the wire. Nothing is written: no screen row, no version, no audit entry. So
    // `GET /v1/screens/{id}` still answers 404 for the id this document names, which is this class's own
    // ruling ("there is no such thing as a valid EMPTY screen") left exactly as it was —
    // `HmiScreenEndpointsTests.Generate_stores_nothing_so_the_id_it_names_still_answers_404` proves that
    // against the real pipeline rather than restating it here.
    //
    // 🔴 `Policies.Engineer`, NOT the Operator tier its GET siblings carry, and the difference is the
    // point rather than an oversight. Every other read on this family answers a document somebody
    // AUTHORED; this one answers a PROPOSED document — the starting point of an authoring session, which
    // is an Engineer's act. It matches the tier of the door the result is destined for
    // (`PUT /v1/screens/{screenId}`), so the route cannot hand an Operator a draft they could never
    // publish. It still writes nothing, so this is the read tier of a write workflow, not a write.
    //
    // 🔴 WHY 200 WITH A ONE-LABEL SCREEN FOR AN UNDECLARED MACHINE, rather than 404. This route asks the
    // same question `GET /v1/components/{code}` asks, and that route answers §5-bis's empty-200 because "a
    // machine that has declared nothing" is a real product state. Generation over an empty model is a real
    // answer to a real question — and `ScreenGenerator` returns a screen carrying ONE label that says the
    // machine declares no components, never a zero-widget document, because a zero-widget screen is
    // indistinguishable from a generator that silently failed.
    // ─────────────────────────────────────────────────────────────────────
    internal static async Task<IResult> GenerateAsync(
        string? machine, string? screenId, IComponentModelStore components, CancellationToken ct)
    {
        if (string.IsNullOrWhiteSpace(machine))
        {
            return Results.BadRequest(new ApiErrorDto(
                "query parameter 'machine' is required — GET /v1/screens/generate?machine={code}."));
        }

        // Raw to the store, exactly as `HmiModelEndpoints.GetAsync` does it: `components` is the
        // canonicalizing decorator, and THAT is what makes the lookup case-insensitive — not a
        // normalisation line here.
        var model = await components.GetAsync(machine, ct).ConfigureAwait(false);
        var canonical = MachineCodeIdentity.Canonicalize(machine);
        model ??= new ComponentModelDocument(
            ContractInvariants.SchemaVersionConst, canonical,
            Array.Empty<ComponentNode>(), Array.Empty<ComponentTypeDef>());

        var generated = ScreenGenerator.Generate(model, screenId);

        // HmiContractJson.Options, never Results.Ok: an HmiScreenDocument carries optional fields
        // (`titleEn`, `component`, `bindings`, `props`, `policyAction`) and only these options honour this
        // contract family's "absence IS null, never written explicitly" rule. The same reason every other
        // producer in this directory uses it.
        return Results.Json(generated, HmiContractJson.Options);
    }

    // ─────────────────────────────────────────────────────────────────────
    // PUT /v1/screens/{screenId}
    //
    // Order, per this task's brief and WS-HMI-0b's rule this class's own doc comment restates: check
    // route-vs-body → store.PutAsync (where §5 is enforced, by ContractInvariants inside the store, BEFORE
    // any connection opens) → build the response → return. Nothing after the response is built can throw.
    // ─────────────────────────────────────────────────────────────────────
    internal static async Task<IResult> PutAsync(
        string screenId, HmiScreenDocument body, IHmiScreenStore store, IHmiChangeBus changes,
        HttpContext context, AuditRecorder recorder, CancellationToken ct)
    {
        // `body` itself can never be null — HmiScreenDocument is a non-nullable complex parameter, so
        // RequestDelegateFactory already 400s an absent/literal-null/malformed-JSON body before this handler
        // is entered. `body.ScreenId` CAN be null/blank (an omitted JSON field) or spell a DIFFERENT identity
        // from the route — both handled below. Compared via ScreenIdentity.SameIdentity (trim only, no case
        // fold) rather than a fresh StringComparison here, so this guard and the store's own identity rule
        // can never quietly drift apart.
        if (!string.IsNullOrWhiteSpace(body.ScreenId) && !ScreenIdentity.SameIdentity(body.ScreenId, screenId))
        {
            return Results.Conflict(new ApiErrorDto(
                $"body.screenId ('{body.ScreenId}') does not match the route {{screenId}} ('{screenId}') — " +
                "refused rather than silently choosing one of the two identities named."));
        }

        if (string.IsNullOrWhiteSpace(body.ScreenId))
        {
            body = body with { ScreenId = screenId };
        }

        int version;
        try
        {
            // §5 door — ContractInvariants.ThrowIfInvalid runs as PutAsync's first statement, before any
            // connection opens, so a rejected document cannot leave a half-written record: a subsequent GET
            // for this screenId has to come back exactly as it was before this call (still 404 if nobody had
            // declared it before).
            version = await store.PutAsync(body, ct).ConfigureAwait(false);
        }
        catch (ContractViolationException ex)
        {
            // ex.Message already carries EVERY violation (ContractViolationException's own ctor joins them),
            // not just the first.
            return Results.BadRequest(new ApiErrorDto(ex.Message));
        }
        catch (SqliteException ex) when (IsWriteLockBusy(ex))
        {
            // See this class's own doc comment for the measurement and the reasoning behind 503.
            return WriteBusy();
        }

        // 🔴 SECURITY REVIEW MEDIUM-1 — the audit row, AFTER the write succeeded and BEFORE the response
        // is built. `CancellationToken.None` deliberately, the same choice MachineWriteEndpoints makes for
        // the same reason: the write has already happened, and a caller who walked away must not be the
        // reason it went unrecorded. `AuditRecorder.RecordAsync` never throws (its own documented failure
        // policy — a lost audit row must not fail the request it describes), so this does not breach the
        // ordering rule the next comment states.
        await recorder.RecordAsync(
            context, PublishAction, "screen", ScreenIdentity.Canonicalize(screenId),
            null,
            new { version, widgetCount = body.Widgets.Count },
            CancellationToken.None).ConfigureAwait(false);

        // Response built BEFORE anything else that could run — see this class's own doc comment for why the
        // publish sits here, second-to-last, with `return` last and nothing that can throw after it. Note
        // this covers `Publish` itself, not the `HmiModelEvents.ScreenChanged(...)` argument evaluated to
        // build its call — see RollbackAsync's own publish-site comment below for why that factory call is
        // total by construction and does not need a second catch here.
        var response = Results.Ok(new PutScreenResultDto(ScreenIdentity.Canonicalize(screenId), version, body.Widgets.Count));
        changes.Publish(HmiModelEvents.ScreenChanged(screenId, version));
        return response;
    }

    // ─────────────────────────────────────────────────────────────────────
    // GET /v1/screens/{screenId}/versions
    //
    // No 404 for an undeclared screen — IHmiScreenStore.ListVersionsAsync's own contract is "empty, never
    // throw" for a screenId nobody has declared, and this task's interface table asks for 200 here, not 404.
    // That is not a contradiction of the GET-by-id 404 above: a version HISTORY is inherently a list, and an
    // empty list is a truthful, ordinary answer to "what versions exist" the same way GET /v1/components
    // (the LIST route, not the by-id one) never 404s either.
    // ─────────────────────────────────────────────────────────────────────
    internal static async Task<IResult> ListVersionsAsync(string screenId, IHmiScreenStore store, CancellationToken ct)
    {
        var versions = await store.ListVersionsAsync(screenId, ct).ConfigureAwait(false);
        return Results.Ok(versions);
    }

    // ─────────────────────────────────────────────────────────────────────
    // POST /v1/screens/{screenId}/rollback
    //
    // 🔴 Deliberately does NOT run ContractInvariants again — see IHmiScreenStore.RollbackAsync's own doc
    // comment (WS-HMI-2 Task 2 fix round 2, HIGH-1): RollbackAsync restores a document THE SYSTEM ALREADY
    // ACCEPTED under whatever rule applied the day it was written, not new authorship, and re-validating it
    // against TODAY'S rules here would re-introduce exactly the bug that fix closed — a validation rule
    // tightened after a row was written would brick every future restore of that row, forever. This handler
    // adds NO second validation pass; ContractInvariants stays the one write door, and it is not this
    // endpoint's job to open a second one.
    // ─────────────────────────────────────────────────────────────────────
    internal static async Task<IResult> RollbackAsync(
        string screenId, RollbackRequestDto body, IHmiScreenStore store, IHmiChangeBus changes,
        HttpContext context, AuditRecorder recorder, CancellationToken ct)
    {
        int version;
        try
        {
            version = await store.RollbackAsync(screenId, body.ToVersion, ct).ConfigureAwait(false);
        }
        catch (ArgumentOutOfRangeException ex)
        {
            // Thrown for BOTH "this screen was never declared" and "this screen exists but not at this
            // version" — IHmiScreenStore.RollbackAsync's own contract does not distinguish them. The current
            // version pointer is untouched: nothing in the store's RollbackAsync writes anything before this
            // throw.
            return Results.NotFound(new ApiErrorDto(StripParameterFraming(ex.Message)));
        }
        catch (SqliteException ex) when (IsWriteLockBusy(ex))
        {
            return WriteBusy();
        }

        // 🔴 THE PUBLISH SITS HERE, IMMEDIATELY AFTER THE COMMIT — deliberately BEFORE the widgetCount
        // read below, not after it like PutAsync's — WS-HMI-2 Task 4 fix round 1 (review INFO). The fact
        // being announced is "screenId is now at version", which is already true and fixed the instant
        // store.RollbackAsync returns; WidgetCount is decoration for THIS caller's own response only, read
        // from a SEPARATE call that can be cancelled. The previous ordering (publish after that read) meant
        // a rollback that committed and was then cancelled while decorating its own response announced
        // NOTHING — a real, committed change silently unpublished on a lane with no backfill to recover it.
        // Publishing here closes that: the announcement now depends only on the write that already
        // succeeded, never on best-effort decoration of one caller's own reply.
        //
        // This does put the widgetCount read's own `throw;` (below) AFTER the publish, which looks at first
        // glance like a second breach of "nothing that can throw runs after the publish" — it is not the
        // same hazard PutAsync's ordering guards against. That rule exists to stop an ACTIVE caller being
        // told 500 (failure) for a change that just succeeded and was announced — see HmiChangeBus.Publish's
        // own doc comment. The ONLY exception that can still escape past this point is
        // OperationCanceledException, and by definition a cancelled caller is not present to be told
        // anything, true or false — the same distinction HmiChangeBus.Publish's own doc comment draws for a
        // SUBSCRIBER'S cancellation applies here to the CALLER'S: there is no live listener left to receive
        // a false "failure", so publishing before that possible throw trades a purely theoretical breach of
        // the letter of the ordering rule for closing a real, measured gap in what the rule exists to
        // protect.
        //
        // 🔴 A SECOND, NARROWER TOTALITY THIS RELIES ON — WS-HMI-2 Task 4 fix round 1 (review INFO), named
        // rather than left implicit. `HmiChangeBus.Publish`'s own total-catch wraps SUBSCRIBER invocations
        // only; the argument `HmiModelEvents.ScreenChanged(screenId, version)` is evaluated BEFORE `Publish`
        // is entered, so a throw from constructing the event itself is not caught by anything. That factory
        // is total BY CONSTRUCTION, not by luck: `ScreenIdentity.Canonicalize` is `Trim()` on a possibly-null
        // string (returns the input unchanged rather than throwing when null/blank — see that method's own
        // doc comment), `DateTimeOffset.UtcNow` cannot throw, and the record constructor assigns four already-
        // validated values with no further computation. Pinned directly, for every adjacent factory sharing
        // this same shape, by
        // <c>HmiModelEventsTests.The_change_event_factories_cannot_throw_for_any_screenId_or_machine_code</c>
        // — deliberately NOT fixed by wrapping the evaluation in a second try/catch here: that would either
        // duplicate `Publish`'s own swallow (hiding a genuine bug in OUR code, which should fail loudly in
        // development, behind the same blanket that must protect a write from a THIRD PARTY subscriber) or
        // require a new `Publish(Func<HmiModelChangedEvent>)` overload that blurs "a hostile subscriber
        // misbehaved" and "our own event failed to build" into one indistinguishable, silently-dropped
        // outcome. Keeping construction outside the catch keeps those two failure classes distinguishable;
        // total-by-construction is what makes that safe to do.
        changes.Publish(HmiModelEvents.ScreenChanged(screenId, version));

        // 🔴 SECURITY REVIEW MEDIUM-1 — see PublishAction. `toVersion` is recorded ALONGSIDE the version
        // the call produced, because "restored version 2" and "which produced version 9" are two different
        // facts and an investigator needs both: the first is what the engineer asked for, the second is
        // what the store now serves. `CancellationToken.None` for the reason PutAsync's own audit call
        // states.
        await recorder.RecordAsync(
            context, RollbackAction, "screen", ScreenIdentity.Canonicalize(screenId),
            null,
            new { version, toVersion = body.ToVersion },
            CancellationToken.None).ConfigureAwait(false);

        // WidgetCount is read from the CONTENT of the version just appended, not from the request body — a
        // rollback request carries no widget list at all. `version` is the number RollbackAsync just
        // returned (the NEW, highest version — never toVersion), so this GET always finds a row, UNLESS it
        // throws.
        //
        // 🔴 THE ROLLBACK ITSELF HAS ALREADY COMMITTED (and, as of this fix round, already ANNOUNCED) by the
        // time this line runs. A throw from THIS read must never turn a write that succeeded into a response
        // reporting failure: the caller would see 500 for a rollback that, on disk, worked. Total by design,
        // the same shape as HmiChangeBus.Publish and HmiTagEndpoints.DescribeClaimedPathsAsync's own catches
        // — a best-effort WidgetCount is never more important than the fact that the version number it
        // decorates is real. OperationCanceledException still propagates: the caller going away is not this
        // read's failure to paper over, and — see the publish-ordering note above — is no longer this
        // read's failure to un-announce either.
        int widgetCount;
        try
        {
            var restored = await store.GetAsync(screenId, version, ct).ConfigureAwait(false);
            widgetCount = restored?.Widgets.Count ?? 0;
        }
        catch (OperationCanceledException)
        {
            throw;
        }
        catch (Exception)
        {
            widgetCount = 0;
        }

        // `version` here is the NEW version RollbackAsync just returned, never body.ToVersion — see this
        // class's own doc comment for why a subscriber that re-reads must land on the row the rollback
        // actually produced. (The event carrying it was already published above.)
        return Results.Ok(new PutScreenResultDto(ScreenIdentity.Canonicalize(screenId), version, widgetCount));
    }

    /// <summary>Removes .NET's own runtime-appended framing (<c>" (Parameter 'toVersion')\r\nActual
    /// value was 99."</c>, measured against a live response) from an
    /// <see cref="ArgumentOutOfRangeException.Message"/> before it reaches a client. The AUTHORED sentence —
    /// <see cref="HmiScreenStore.RollbackAsync"/>'s own message, naming the real version numbers or saying
    /// there are none — always comes first in that message, so cutting at the first occurrence of the
    /// framing's marker leaves the authored half untouched. Not a parse: a message carrying no such marker
    /// (any other exception shape) passes through byte-for-byte, and this never throws.</summary>
    private static string StripParameterFraming(string message)
    {
        var idx = message.IndexOf(" (Parameter", StringComparison.Ordinal);
        return idx < 0 ? message : message[..idx];
    }

    /// <summary><c>SqliteErrorCode == 5</c> is <c>SQLITE_BUSY</c> — the write-lock-contention error this
    /// store's <c>BEGIN IMMEDIATE</c> raises from <c>BeginTransaction()</c> itself when another writer holds
    /// the lock past <c>busy_timeout</c>. NOT <c>SqliteErrorCode == 19</c> (<c>SQLITE_CONSTRAINT</c>, what
    /// <c>HmiTagEndpoints.IsPathAlreadyClaimed</c> matches) — see this class's own doc comment for why that
    /// shape is unreachable on this store's write path and would be dead code here. <c>internal</c>, not
    /// <c>private</c>: WS-HMI-2 Task 3 fix round 1 (review MED-3) measured that the SPECIFICITY of
    /// <c>== 5</c> — as opposed to any wider predicate that would launder a genuine
    /// <c>SQLITE_CONSTRAINT</c>/<c>SQLITE_CORRUPT</c>/<c>SQLITE_READONLY</c> into "busy, retry" — was not
    /// pinned by any test that exercised only the HTTP surface (a real non-busy write-path
    /// <see cref="SqliteException"/> is not reproducible on demand through this store without corrupting a
    /// real file). Exposed for a direct unit assertion instead:
    /// <c>HmiScreenEndpointsTests.IsWriteLockBusy_IsTrueOnlyForSqliteErrorCode5</c>.</summary>
    internal static bool IsWriteLockBusy(SqliteException ex) => ex.SqliteErrorCode == 5;

    /// <summary>See this class's own doc comment for the measurement and the reasoning behind 503 over 409
    /// or a bare 500. Same status <c>NotificationEndpoints.StoreUnavailable</c> already uses for "a
    /// dependency this handler needs is not currently usable".</summary>
    private static IResult WriteBusy() => Results.Json(
        new ApiErrorDto(
            "the screen store is busy with another write right now — this request was well-formed and " +
            "would likely succeed on retry; wait a moment and try again."),
        statusCode: StatusCodes.Status503ServiceUnavailable);
}
