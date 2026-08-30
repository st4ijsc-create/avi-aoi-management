using St4i.EngineApi.Auth;
using St4i.EngineApi.Fleet;
using St4i.EngineApi.HmiModel;
using St4i.Hmi.Contracts;

namespace St4i.EngineApi.Endpoints;

/// <summary>
/// WS-HMI-0b Task 1 — the component-tree HTTP surface over WS-HMI-0a's <see cref="IComponentModelStore"/>
/// and <see cref="ITagNamespaceStore"/>: <c>GET /v1/components</c> (every machine code with a declared
/// tree, Operator), <c>GET /v1/components/{machineCode}</c> (detail — <b>200 with an EMPTY document for an
/// undeclared machine, never 404</b>: §5-bis, "a machine that has declared nothing" is a valid product
/// state), <c>PUT /v1/components/{machineCode}</c> (Engineer; 400 <see cref="ApiErrorDto"/> on a §5
/// violation), <c>GET /v1/components/{machineCode}/integrity</c> (referential-integrity report against
/// whatever tag namespace this machine has loaded, if any) and <c>GET /v1/component-types</c> (every
/// <see cref="ComponentTypeDef"/> declared by any machine, deduplicated by <c>TypeId</c>).
///
/// Same shape as <c>AssetEndpoints.cs</c> — <c>static</c> handlers bound by method group, returning
/// <see cref="IResult"/>, errors as <see cref="ApiErrorDto"/> — see that file's own doc comment for the
/// convention this one follows rather than restates. The store is obtained the same way, too: a plain
/// constructor parameter ASP.NET's minimal-API model binder resolves from DI, no manual
/// <c>GetRequiredService</c> anywhere in this file.
/// </summary>
public static class HmiModelEndpoints
{
    public static void MapHmiModelEndpoints(this IEndpointRouteBuilder app)
    {
        app.MapGet("/v1/components", ListMachineCodesAsync).RequireAuthorization(Policies.Operator);
        app.MapGet("/v1/components/{machineCode}", GetAsync).RequireAuthorization(Policies.Operator);
        app.MapPut("/v1/components/{machineCode}", PutAsync).RequireAuthorization(Policies.Engineer);
        app.MapGet("/v1/components/{machineCode}/integrity", GetIntegrityAsync).RequireAuthorization(Policies.Operator);
        app.MapGet("/v1/component-types", ListComponentTypesAsync).RequireAuthorization(Policies.Operator);
    }

    // ─────────────────────────────────────────────────────────────────────
    // GET /v1/components
    // ─────────────────────────────────────────────────────────────────────
    internal static async Task<IResult> ListMachineCodesAsync(IComponentModelStore store, CancellationToken ct)
    {
        // Fix round 4, HIGH-1 — no de-duplication or normalisation in THIS handler, deliberately: `store`
        // is the canonicalizing decorator, and its ListMachineCodesAsync is what canonicalises and
        // de-duplicates. Doing it here as well would be a per-handler patch of exactly the shape that
        // produced rounds 1-3, and it would leave any FUTURE lister uncovered. The property that matters —
        // every code this returns is a code GetAsync can actually serve — belongs to the seam, and is
        // pinned there (CanonicalMachineCodeStoresTests.Every_code_the_list_reports_is_a_code_GetAsync_can_actually_serve).
        var codes = await store.ListMachineCodesAsync(ct).ConfigureAwait(false);
        return Results.Ok(codes);
    }

    // ─────────────────────────────────────────────────────────────────────
    // GET /v1/components/{machineCode}
    // ─────────────────────────────────────────────────────────────────────
    internal static async Task<IResult> GetAsync(string machineCode, IComponentModelStore store, CancellationToken ct)
    {
        // Fix round 3, HIGH-A — `machineCode` is passed to the store RAW, deliberately: `store` is the
        // canonicalizing decorator (CanonicalMachineCodeStores.cs), and THAT is what makes this lookup find
        // the right row regardless of which case the caller used in the URL — not a normalization line in
        // this handler. `canonicalCode` below is computed separately and used ONLY for the response echo.
        var doc = await store.GetAsync(machineCode, ct).ConfigureAwait(false);
        var canonicalCode = MachineCodeIdentity.Canonicalize(machineCode);

        // §5-bis: a machine that has declared nothing is a VALID product state, not an error. The store
        // already returns null rather than throwing for this case (see ComponentModelStore.GetAsync's own
        // doc comment) — this is the HTTP-side half of the same rule: 200 with an empty document, never 404.
        //
        // Results.Json(..., HmiContractJson.Options) rather than Results.Ok(...): a ComponentModelDocument
        // carries optional fields (ComponentNode.ParentId, ComponentTagDef.Min/Max/Unit/EnumValues/
        // PolicyAction, ...), and the app's ambient per-request JSON options (Program.cs's
        // ConfigureHttpJsonOptions) do NOT ignore nulls on write — only HmiContractJson.Options does. Every
        // OTHER HMI contract producer in this codebase (the two stores) already serializes with this exact
        // options instance; this is the HTTP layer keeping that same "absence IS null, never written
        // explicitly" rule the contract's own doc comments state.
        return Results.Json(doc ?? EmptyDocument(canonicalCode), HmiContractJson.Options);
    }

    // ─────────────────────────────────────────────────────────────────────
    // PUT /v1/components/{machineCode}
    //
    // 🔴 THIS IS LAST-WRITER-WINS, stated here rather than left to be discovered. The frozen
    // ComponentModelDocument carries no concurrency token — no ETag/version field a caller could round-trip
    // — and ComponentModelStore.PutAsync does write an `updated_at` column, but no SELECT in that store
    // returns it, so this handler has nothing to compare a caller's belief against even if it wanted to.
    // Adding one would mean changing WS-HMI-0a's frozen store, which this task's constraints forbid. The
    // real cost: two engineers editing the same machine's component tree concurrently silently lose one
    // edit — the SECOND PUT to land simply overwrites the first, with no conflict reported to either
    // caller. Accepted here by construction, not by accident — see
    // HmiModelEndpointsTests.Put_TwiceToTheSameMachine_TheSecondWriteWins_LastWriterWins for the test that
    // pins it.
    //
    // 🔴 REVIEW FIX ROUND 1, HIGH-1 — the route's machineCode wins over the body's, by REJECTING a
    // disagreement rather than silently overriding it. ComponentModelStore.PutAsync keys its row on
    // doc.MachineCode (the body), not on this handler's route parameter — nothing reconciled the two before
    // this fix. A caller PUTting to /v1/components/INTENDED-01 with body.machineCode = "VICTIM-99" was
    // silently writing VICTIM-99's ENTIRE tree while being told, at 200, that INTENDED-01 now has one
    // component — and because an undeclared machine reads back 200-empty (§5-bis), the caller could not
    // distinguish "my write landed on the wrong machine" from "nothing was ever declared here". Decided
    // REJECT (400) rather than silently rewriting body.MachineCode to match the route: a client that gets no
    // signal when its belief about which field is authoritative is wrong learns nothing and keeps sending
    // the same bug. This is the SAME three-line guard shape ConfigEndpoints.cs uses three times already
    // (UpsertProductAsync/UpsertPointAsync/UpsertRecipeAsync: fill the identity in when the body omits it,
    // reject when the body disagrees with the route) — matched here rather than inventing a fourth spelling
    // of the same rule, per the reviewer's steer that consistency inside one API beats a fresh preference.
    //
    // 🔴 REVIEW FIX ROUND 2, HIGH-A, PARTIAL — comparing case-INSENSITIVELY was not, by itself, enough:
    // ComponentModelStore keys `machine_code TEXT PRIMARY KEY` with no `COLLATE NOCASE` (case-SENSITIVE),
    // and round 2 only normalized THIS handler's own `body` — the other three handlers that hand a machine
    // code to the store (GetAsync, GetIntegrityAsync, and ITagNamespaceStore.GetAsync via this handler and
    // GetIntegrityAsync) still passed the raw route string straight through. Re-review #2 measured the
    // ORIGINAL failure mode reproduced through the ROUTE instead of the body: two PUTs at differing route
    // case landed on two rows, hid each other's edits, and GET /v1/components/{variant}/integrity — an
    // Operator-tier route — returned a clean bill of health for a document it had never read.
    //
    // 🔴 REVIEW FIX ROUND 3, HIGH-A, CLOSED STRUCTURALLY — not by adding a normalization line to the other
    // three handlers (a fourth, fifth, sixth per-handler patch is exactly the shape that produced rounds 1
    // and 2's failures). See CanonicalMachineCodeStores.cs: `store`/`tags` in EVERY handler in this file are
    // CANONICALIZING DECORATORS, registered as the ONLY thing IComponentModelStore/ITagNamespaceStore
    // resolve to in Program.cs. Every machine code this seam sees — `body` below (its `MachineCode` field,
    // rewritten by the decorator BEFORE it reaches the case-sensitive store) and every read handler's route
    // parameter — is canonicalized structurally, whether or not the handler author remembers to think about
    // case: this handler does NOT canonicalize `body`/`machineCode` itself for the store calls below
    // (deliberately — see their own comments), because the decorator is what has to be trusted, not this
    // handler's own diligence. The guard immediately below still rejects a genuine MISMATCH (a body naming a
    // materially different machine — HIGH-1's original concern); once it passes, a SEPARATE `canonicalCode`
    // value is computed near the end, used ONLY for the RESPONSE echo — see GetAsync/GetIntegrityAsync for
    // the identical split applied on the read side.
    //
    // 🔴 REVIEW FIX ROUND 4, HIGH-1 — round 3 canonicalised what went INTO the store and not what came OUT.
    // Four of the six methods across the two decorators canonicalised; ListMachineCodesAsync forwarded
    // stored keys verbatim, so GET /v1/components could hand out a spelling GET /v1/components/{code} could
    // not serve, and the Operator-tier integrity route reported a clean bill of health for a document it
    // never read — the exact consequence re-review #2 condemned round 2 for, reached by a different door.
    // Closed by canonicalising both directions AND by a canonical-miss fallback in the decorator's own
    // GetAsync. See CanonicalMachineCodeStores.cs for the enumeration and for the two residues it names.
    //
    // THE IDENTITY RULE, stated at the strength it has rather than at the strength it would be nice to
    // have: a machine code is a case-INSENSITIVE identity, and its ONE canonical persisted spelling is
    // `Trim().ToUpperInvariant()`. THROUGH THIS SEAM — which is every handler in this file, because DI
    // hands out only the decorators — two spellings of one identity cannot diverge into two rows,
    // regardless of which handler, which HTTP verb, or which of body/route supplied which spelling; and
    // every machine code this API emits (the list, every document's `machineCode` field, every response
    // echo) is the canonical one, so a client that reads the list and a client that reads a document never
    // hold two different names for one machine. What that does NOT claim, and CanonicalMachineCodeStores.cs
    // says at length: the raw stores stay public and constructible, so a non-DI caller can still put a
    // non-canonical row on disk. Such a row is now listed under its canonical identity, served at every
    // spelling of it, and superseded by the next write — but not deleted, because no interface here has a
    // delete and neither store may be changed.
    //
    // Verified by probe before trusting the sentence, per the reviewer's own standing instruction — see
    // Put_RouteCaseVariant_NormalizesToOneRow_NotTwo,
    // Put_RouteCaseVariant_WithBodyMachineCodeOmitted_StillNormalizesToOneRow,
    // Get_And_GetIntegrity_And_List_FindTheSameRow_RegardlessOfRouteCase (route side; the body side is
    // pinned by round 2's own three tests), and, for the round-4 half,
    // A_row_written_directly_to_the_store_is_listed_readable_and_honestly_reported plus the whole of
    // CanonicalMachineCodeStoresTests — whose enumeration test goes red if a SEVENTH method is added to
    // either store interface and forwards unhandled, which is what makes this paragraph a property rather
    // than a fourth consecutive claim about one.
    //
    // NOTE ON ConfigEndpoints.cs, measured rather than assumed (twice — round 2's own probe, then re-review
    // #2's independent, stronger one covering BOTH body- and route-case variants surviving a disk reload):
    // its three route/body-code guards share this compare-without-normalize SHAPE but NOT this defect.
    // ProductConfigStore's `_products`/`_recipes` Dictionaries use StringComparer.OrdinalIgnoreCase and
    // UpsertPoint matches by StringComparison.OrdinalIgnoreCase before replacing in place — case-insensitive
    // identity is already that STORE's own semantics, not just the guard's, so a case-variant upsert there
    // never creates a second row; only the persisted Code field's own casing drifts to whichever request
    // wrote last. Not fixed here: pre-existing, on `main`, outside this task's range — reported to the owner
    // rather than patched.
    // ─────────────────────────────────────────────────────────────────────
    internal static async Task<IResult> PutAsync(
        string machineCode, ComponentModelDocument body, IComponentModelStore store, ITagNamespaceStore tags, CancellationToken ct)
    {
        // `body` itself can never be null here — ComponentModelDocument is a non-nullable complex parameter,
        // so RequestDelegateFactory already 400s an absent/literal-null body before this handler is entered.
        // `body.MachineCode`, however, CAN be null/blank (an omitted JSON field, or an explicit ""), or spell
        // the same identity in a different case — both handled below.
        if (!string.IsNullOrWhiteSpace(body.MachineCode) &&
            !string.Equals(body.MachineCode, machineCode, StringComparison.OrdinalIgnoreCase))
        {
            return Results.BadRequest(new ApiErrorDto(
                $"body.machineCode ('{body.MachineCode}') must match the route {{machineCode}} ('{machineCode}') (or be omitted)."));
        }

        // Fill an omitted body code from the route — still NOT canonicalized here. The STORE call below is
        // what determines the persisted spelling (store.PutAsync is the canonicalizing decorator, which
        // rewrites doc.MachineCode before it ever reaches the case-sensitive SQLite key); this line only
        // keeps `body.MachineCode` non-blank for ModelIntegrity.Check further down.
        if (string.IsNullOrWhiteSpace(body.MachineCode))
        {
            body = body with { MachineCode = machineCode };
        }

        try
        {
            // §5 door — the store validates and throws BEFORE writing anything (see
            // ComponentModelStore.PutAsync's own doc comment). A rejected document must not leave a
            // half-written record: a subsequent GET for this machine has to come back exactly as it was
            // before this call.
            await store.PutAsync(body, ct).ConfigureAwait(false);
        }
        catch (ContractViolationException ex)
        {
            // ex.Message already carries EVERY violation (ContractViolationException's own ctor joins them
            // with " | "), not just the first — the brief's own requirement, met without re-deriving the join.
            return Results.BadRequest(new ApiErrorDto(ex.Message));
        }

        // Referential integrity against whatever tag namespace this machine has loaded (null if none) is a
        // WARNING, never a rejection — declaration order between a component tree and a tag namespace is
        // not a constraint (see ModelIntegrity's own doc comment for why). `machineCode` passed RAW — same
        // reason as GetAsync above: `tags` is the canonicalizing decorator.
        var ns = await tags.GetAsync(machineCode, ct).ConfigureAwait(false);
        var warnings = ModelIntegrity.Check(body, ns);

        // Response echo only — computed AFTER the store calls, never used to decide what got written.
        var canonicalCode = MachineCodeIdentity.Canonicalize(machineCode);
        return Results.Ok(new PutModelResultDto(canonicalCode, body.Components.Count, warnings));
    }

    // ─────────────────────────────────────────────────────────────────────
    // GET /v1/components/{machineCode}/integrity
    // ─────────────────────────────────────────────────────────────────────
    internal static async Task<IResult> GetIntegrityAsync(
        string machineCode, IComponentModelStore store, ITagNamespaceStore tags, CancellationToken ct)
    {
        // Fix round 3, HIGH-A — this is the route re-review #2 singled out as the worst consequence of the
        // round-2 gap: WITHOUT the canonicalizing decorator, a case-variant route finds neither the real
        // document nor the real namespace (both case-sensitive-keyed misses), so this handler would report a
        // CLEAN health check — namespaceLoaded:false, zero violations — for a machine whose tree was
        // declared under the other spelling. `machineCode` is passed RAW to both calls below: `store`/`tags`
        // are the canonicalizing decorators, and THEY are what makes these lookups find the real data
        // regardless of route case. `canonicalCode` is computed separately, used only for the response echo.
        var doc = await store.GetAsync(machineCode, ct).ConfigureAwait(false);
        var ns = await tags.GetAsync(machineCode, ct).ConfigureAwait(false);
        var canonicalCode = MachineCodeIdentity.Canonicalize(machineCode);
        doc ??= EmptyDocument(canonicalCode);
        var violations = ModelIntegrity.Check(doc, ns);

        // ns is not null ⇔ a namespace has actually been loaded for this machine — distinct from "loaded and
        // empty" (Tags.Count == 0), which IntegrityReportDto's own doc comment calls out by name.
        return Results.Ok(new IntegrityReportDto(canonicalCode, ns is not null, violations));
    }

    // ─────────────────────────────────────────────────────────────────────
    // GET /v1/component-types
    // ─────────────────────────────────────────────────────────────────────
    internal static async Task<IResult> ListComponentTypesAsync(IComponentModelStore store, CancellationToken ct)
    {
        var codes = await store.ListMachineCodesAsync(ct).ConfigureAwait(false);

        var seen = new HashSet<string>(StringComparer.Ordinal);
        var merged = new List<ComponentTypeDef>();

        foreach (var code in codes)
        {
            // `continue` on null used to be how a machine's types SILENTLY VANISHED: round 3's list handed
            // out a stored spelling that its own GetAsync could not resolve, so every legacy-keyed machine
            // fell through this branch and /v1/component-types under-reported without saying anything. The
            // branch is still right (a row deleted between the list and this read is a real, benign race),
            // but it is no longer load-bearing for case identity — the seam guarantees every listed code is
            // resolvable, and that guarantee is what is pinned, not this `continue`.
            var doc = await store.GetAsync(code, ct).ConfigureAwait(false);
            if (doc is null) continue;

            foreach (var type in doc.Types)
            {
                // First declaration wins when two machines disagree on the same typeId's content. Per this
                // task's brief: that disagreement is a real gap worth a warning of its own, but closing it is
                // NOT this task's job — TODO for a later task, noted rather than silently absorbed.
                if (seen.Add(type.TypeId))
                {
                    merged.Add(type);
                }
            }
        }

        // Same reason as GetAsync above: ComponentTypeDef's nested ComponentTagDef carries optional fields,
        // so this has to go through HmiContractJson.Options rather than the ambient per-request JSON options.
        return Results.Json(merged, HmiContractJson.Options);
    }

    private static ComponentModelDocument EmptyDocument(string machineCode) =>
        new(1, machineCode, Array.Empty<ComponentNode>(), Array.Empty<ComponentTypeDef>());
}
