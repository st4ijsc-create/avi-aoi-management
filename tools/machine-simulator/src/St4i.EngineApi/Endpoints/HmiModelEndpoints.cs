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
        var codes = await store.ListMachineCodesAsync(ct).ConfigureAwait(false);
        return Results.Ok(codes);
    }

    // ─────────────────────────────────────────────────────────────────────
    // GET /v1/components/{machineCode}
    // ─────────────────────────────────────────────────────────────────────
    internal static async Task<IResult> GetAsync(string machineCode, IComponentModelStore store, CancellationToken ct)
    {
        var doc = await store.GetAsync(machineCode, ct).ConfigureAwait(false);

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
        return Results.Json(doc ?? EmptyDocument(machineCode), HmiContractJson.Options);
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
    // 🔴 REVIEW FIX ROUND 1, HIGH-1 — THE ROUTE'S machineCode IS AUTHORITATIVE, NEVER THE BODY'S, BY
    // REJECTION RATHER THAN SILENT OVERRIDE. ComponentModelStore.PutAsync keys its row on doc.MachineCode
    // (the body), not on this handler's route parameter — nothing reconciled the two before this fix. A
    // caller PUTting to /v1/components/INTENDED-01 with body.machineCode = "VICTIM-99" was silently writing
    // VICTIM-99's ENTIRE tree while being told, at 200, that INTENDED-01 now has one component — and
    // because an undeclared machine reads back 200-empty (§5-bis), the caller could not distinguish "my
    // write landed on the wrong machine" from "nothing was ever declared here". Decided REJECT (400) rather
    // than silently rewriting body.MachineCode to match the route: a client that gets no signal when its
    // belief about which field is authoritative is wrong learns nothing and keeps sending the same bug.
    // This is the SAME three-line guard shape ConfigEndpoints.cs uses three times already
    // (UpsertProductAsync/UpsertPointAsync/UpsertRecipeAsync: fill the identity in when the body omits it,
    // reject when the body disagrees with the route) — matched here rather than inventing a fourth spelling
    // of the same rule, per the reviewer's steer that consistency inside one API beats a fresh preference.
    // See Put_BodyMachineCodeMismatchesRoute_Gets400_AndTheVictimMachineIsUntouched (rejection) and
    // Put_BodyMachineCodeOmitted_IsFilledFromTheRoute (the lenient arm) for the tests that pin both halves.
    // ─────────────────────────────────────────────────────────────────────
    internal static async Task<IResult> PutAsync(
        string machineCode, ComponentModelDocument body, IComponentModelStore store, ITagNamespaceStore tags, CancellationToken ct)
    {
        // `body` itself can never be null here — ComponentModelDocument is a non-nullable complex parameter,
        // so RequestDelegateFactory already 400s an absent/literal-null body before this handler is entered.
        // `body.MachineCode`, however, CAN be null/blank (an omitted JSON field, or an explicit ""): handled
        // by the fill-or-reject guard immediately below, not here.
        if (string.IsNullOrWhiteSpace(body.MachineCode))
        {
            body = body with { MachineCode = machineCode };
        }
        else if (!string.Equals(body.MachineCode, machineCode, StringComparison.OrdinalIgnoreCase))
        {
            return Results.BadRequest(new ApiErrorDto(
                $"body.machineCode ('{body.MachineCode}') must match the route {{machineCode}} ('{machineCode}') (or be omitted)."));
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
        // not a constraint (see ModelIntegrity's own doc comment for why).
        var ns = await tags.GetAsync(machineCode, ct).ConfigureAwait(false);
        var warnings = ModelIntegrity.Check(body, ns);

        return Results.Ok(new PutModelResultDto(machineCode, body.Components.Count, warnings));
    }

    // ─────────────────────────────────────────────────────────────────────
    // GET /v1/components/{machineCode}/integrity
    // ─────────────────────────────────────────────────────────────────────
    internal static async Task<IResult> GetIntegrityAsync(
        string machineCode, IComponentModelStore store, ITagNamespaceStore tags, CancellationToken ct)
    {
        var doc = await store.GetAsync(machineCode, ct).ConfigureAwait(false) ?? EmptyDocument(machineCode);
        var ns = await tags.GetAsync(machineCode, ct).ConfigureAwait(false);
        var violations = ModelIntegrity.Check(doc, ns);

        // ns is not null ⇔ a namespace has actually been loaded for this machine — distinct from "loaded and
        // empty" (Tags.Count == 0), which IntegrityReportDto's own doc comment calls out by name.
        return Results.Ok(new IntegrityReportDto(machineCode, ns is not null, violations));
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
