using St4i.Hmi.Contracts;

namespace St4i.EngineApi.HmiModel;

/// <summary>
/// WS-HMI-0b Task 1 — machine-code identity, closed at the ONE seam every caller shares.
///
/// <para><b>Why a decorator and not a fifth handler patch.</b> Rounds 1 and 2 each normalised a machine
/// code inside <c>HmiModelEndpoints.PutAsync</c> alone — round 1 reconciled the route against the body,
/// round 2 made that reconciliation survive a case-only difference. Both were PER-HANDLER, so the other
/// handlers that hand a machine code to <see cref="IComponentModelStore"/>/<see cref="ITagNamespaceStore"/>
/// never got it, and re-review #2 measured the original failure through the route instead of the body:
/// two PUTs at differing route case landed on two SQLite rows, hid each other's edits, and
/// <c>GET /v1/components/{variant}/integrity</c> — an Operator-tier route — returned a clean bill of
/// health for a document it had never read. <see cref="ComponentModelStore"/> keys
/// <c>machine_code TEXT PRIMARY KEY</c> with no <c>COLLATE NOCASE</c> (case-SENSITIVE) and that file is one
/// of WS-HMI-0a's two frozen stores this task's constraints forbid touching, so the mismatch cannot be
/// closed in the storage layer's own collation. It is closed here instead: the DI registration in
/// <c>Program.cs</c> hands out ONLY these decorators, never the raw stores, so a handler cannot reach the
/// case-sensitive key without going through <see cref="MachineCodeIdentity.Canonicalize"/> first —
/// REGARDLESS of whether that handler exists today or is written next month.</para>
///
/// <para><b>The identity rule.</b> A machine code is a case-INSENSITIVE identity, and its ONE canonical
/// spelling is <c>Trim().ToUpperInvariant()</c> — chosen (over, say, lower-casing) only because every
/// fixture and every existing machine code in this codebase is already upper-cased (<c>AOI-01</c>,
/// <c>SCRW-01</c>, ...); there is no deeper reason than matching the ambient convention.</para>
///
/// <para>🔴 <b>WHERE THE RULE APPLIES — the enumeration, because three consecutive rounds shipped a
/// PARTIAL adoption of a stated rule and each time the stating paragraph sat exactly where the rule
/// failed.</b> Round 3's version of this paragraph claimed the rule was "applied to EVERY machine code
/// this seam sees, on EVERY call", and re-review #3 measured that false: FOUR of the SIX methods across
/// the two decorators canonicalised, and <c>ListMachineCodesAsync</c> forwarded stored keys verbatim — so
/// <c>GetAsync</c> and <c>ListMachineCodesAsync</c>, two methods of the SAME decorator, disagreed about the
/// identity of a row that was already on disk. The rule now applies to:
/// <list type="bullet">
///   <item><description>every machine code going IN — <c>PutAsync</c>'s <c>doc.MachineCode</c> (both
///   contracts) and every read's route-derived parameter;</description></item>
///   <item><description>every machine code coming OUT — <c>ListMachineCodesAsync</c>'s returned list
///   (canonicalised AND de-duplicated), and the <c>machineCode</c> field of every document
///   <c>GetAsync</c> returns, so a caller who read the list and a caller who read a document never hold
///   two different names for one machine;</description></item>
///   <item><description>and a canonical-miss FALLBACK in
///   <see cref="CanonicalizingComponentModelStore.GetAsync"/>, so a row already stored under a
///   non-canonical key is still SERVED rather than merely re-labelled — see that method.</description></item>
/// </list>
/// The thing keeping that enumeration honest is not this paragraph. It is
/// <c>CanonicalMachineCodeStoresTests.Every_method_of_both_store_seams_carries_a_declared_identity_disposition</c>,
/// which reads both interfaces by reflection and goes red if a SEVENTH method is added with no declared
/// disposition — and
/// <c>...Every_declared_disposition_is_measured_against_a_recording_inner_store</c>, which does not trust
/// the declaration either: it drives each method and asserts what a recording inner store RECEIVED.</para>
///
/// <para>🔴 <b>WHAT THIS DOES NOT CANONICALISE — both exclusions, and the residue, named rather than left
/// to be assumed.</b> Round 3's version of this paragraph named one of two exclusions and omitted the
/// broken one; this is the complete list.
/// <list type="number">
///   <item><description><b>Every machine-code-prefixed PATH — all THREE of them, counted rather than
///   sampled.</b> <see cref="ITagNamespaceStore.FindTagAsync"/>'s <c>path</c> parameter; every
///   <see cref="TagDescriptor.Path"/> inside a namespace document; and — named here at fix round 5, after
///   this same paragraph shipped incomplete in two consecutive rounds — <b><see cref="ComponentNode.TagPrefix"/>
///   inside a component-tree document</b>. The third is not an afterthought: it is the field
///   <c>ModelIntegrity.Check</c>'s Ordinal check 4 actually compares, so it is the field the pinned
///   integrity-warning test below exercises, and it is the field that goes out of step with
///   <c>machineCode</c> on a read-modify-write — a document read back through the fallback carries
///   <c>machineCode: LEGACY-01</c> next to <c>tagPrefix: legacy-01/spindle</c>, and PUTting it back
///   PERSISTS that disagreement. All three are one identity kind and get one rule, below.</description></item>
///   <item><description><b>Why paths are that identity kind and not this one</b> — a tag <c>path</c> is a
///   DIFFERENT identity from a machine code, and deliberately untouched. <c>tag_index.path</c> is a GLOBAL primary key with no
///   machine-code-prefix requirement (<see cref="ContractInvariants"/>'s own doc comment: "Pattern của
///   <c>path</c> không đòi tiền tố mã máy"), and <c>ModelIntegrity.IsPathPrefix</c> is Ordinal by design,
///   so rewriting a leading segment would corrupt every path that does not begin with a machine code.
///   <b>The consequence, stated because it is real and downstream — in BOTH contracts, because giving only
///   the namespace example is how <see cref="ComponentNode.TagPrefix"/> went unnamed for two rounds:</b> a
///   namespace authored as <c>find-01</c> persists as <c>machineCode: "FIND-01"</c> with paths still
///   <c>find-01/…</c>; and a component tree authored as <c>find-01</c> persists as
///   <c>machineCode: "FIND-01"</c> with <c>tagPrefix: "find-01/spindle"</c>. Either way the two halves of
///   one document disagree about the machine's spelling. That is FORCED, not chosen — the
///   frozen store derives its primary key from <c>doc.MachineCode</c>, so a canonical KEY is unobtainable
///   without a canonical FIELD. <b>The rule that follows, and the one WS-HMI-0c and Task 2's
///   <c>PUT /v1/tags/{machineCode}</c> are meant to read: a tag path is NOT derivable from a machine code
///   — look one up (<c>GetAsync(machineCode).Tags</c>, or <c>FindTagAsync(path)</c>), never compose one.</b>
///   Composing was never sound (a namespace for <c>AOI-01</c> may legitimately declare
///   <c>line3/camera/temp</c>); canonicalisation only makes an already-unsound pattern fail visibly. And
///   the disagreement is REPORTED rather than silent: <c>ModelIntegrity.Check</c>'s Ordinal
///   <c>tagPrefix</c> rule turns it into an ordinary warning on the PUT response and at
///   <c>GET /v1/components/{code}/integrity</c> — this task's central rule, losing integrity WARNS and
///   losing safety REFUSES, applied to exactly this case. Pinned by
///   <c>CanonicalMachineCodeStoresTests.A_tag_path_is_not_derivable_from_a_machine_code_and_is_never_rewritten</c>
///   and <c>...A_machineCode_tagPath_case_desynchronisation_surfaces_as_an_integrity_warning</c>.</description></item>
///   <item><description><b>A non-canonically-keyed row in <c>tag-namespaces.db</c> cannot be resolved</b>,
///   where the same row in <c>component-models.db</c> can. Not a choice: the fallback in
///   <see cref="CanonicalizingComponentModelStore.GetAsync"/> works by ENUMERATING stored keys, and
///   <see cref="ITagNamespaceStore"/> has no enumeration method to do that with — adding one would mean
///   changing <see cref="TagNamespaceStore"/>, which is frozen. So a namespace written by a direct
///   <c>new TagNamespaceStore(dir)</c> caller under a non-canonical spelling is invisible to this seam. It
///   is unreachable rather than mis-reported (<c>namespaceLoaded:false</c> is the honest answer to "this
///   seam has no namespace for that identity"), and nothing that goes through DI — every HTTP handler, and
///   Task 2's write path — can create one. <b>The one cost of that honesty, spelled out at fix round 5
///   rather than left one sentence short:</b> <c>namespaceLoaded:false</c> is byte-for-byte what a machine
///   with NO namespace at all reports, so an API client cannot distinguish "your namespace is on disk and
///   this seam cannot read it" from "you never declared one". An engineer who wrote through a non-DI path
///   gets the report of an engineer who wrote nothing. That is materially better than the shape re-review
///   #2 condemned — it never claims health for a document it did not read, and the component half of the
///   same request IS read and reported — but it is not free, and it is the reason the residue is pinned by
///   a test rather than merely admitted here.</description></item>
/// </list></para>
///
/// <para>🔴 <b>THE GUARANTEE, stated at the strength it actually has.</b> Anything that takes
/// <see cref="IComponentModelStore"/>/<see cref="ITagNamespaceStore"/> from DI gets canonicalisation for
/// free and cannot opt out; the decorators are <c>internal</c>, so an out-of-assembly consumer cannot even
/// name them, and its only correct move is to take the interface. Through this seam, two spellings of one
/// identity can never diverge into two rows — no matter which handler, which HTTP verb, or which of
/// body/route supplied which spelling. <b>What survives, said plainly rather than softened away:</b>
/// <see cref="ComponentModelStore"/>/<see cref="TagNamespaceStore"/> remain <c>public sealed</c> and
/// constructible (they must: <c>Program.cs</c> reads their <c>EnvVarDir</c> constants and
/// <c>TestRunTempRoot</c> depends on the public <c>EnvVarDir</c>/<c>DefaultRoot</c>/<c>ResolveRoot</c>
/// triple), so a caller that does <c>new ComponentModelStore(dir)</c> can still put a non-canonical row on
/// disk. That row is now LISTED under its canonical identity, SERVED at every spelling of it, and
/// SUPERSEDED by the next write through this seam — but it is not deleted, because neither interface has a
/// delete and neither store may be changed. So the honest sentence is: <b>airtight for DI; for a row a
/// direct constructor already wrote, the API presents one consistent identity and serves it, while a
/// superseded duplicate can linger on disk unreachable.</b> Cleaning those up is a migration, and a
/// migration is a task, not a silence.</para>
///
/// <para>🔴 <b>AND ONE ASSUMPTION THE GUARANTEE RESTS ON THAT THIS CLASS DOES NOT OWN, named at fix round 5
/// because an unnamed assumption is how the last three rounds went wrong.</b> "A caller who read the list
/// and a caller who read a document never hold two different names for one machine" is true because both
/// frozen stores bind their primary key FROM the document's own field —
/// <c>AddWithValue("@machine_code", doc.MachineCode)</c>, <c>ComponentModelStore.cs:192</c> and
/// <c>TagNamespaceStore.cs:219</c> — so key ≡ field for every row that can exist. This decorator cannot
/// enforce that and does not try. What it does instead is not depend on it: <c>GetAsync</c> canonicalises
/// the <c>machineCode</c> of every document on the way OUT, so even a store that accepted a key independent
/// of the field could not make the list and a document disagree. That output half is otherwise invisible
/// (a real row's field is already canonical), which is exactly why it went unmeasured until round 5 — it is
/// now driven by the <c>GetAsync</c> entries in <c>CanonicalMachineCodeStoresTests</c>' disposition table,
/// seeded with the key≠field row no real writer can produce.</para>
///
/// <para><b>Cost, named:</b> the fallback costs one extra <c>ListMachineCodesAsync</c> query per
/// <c>GetAsync</c> MISS — which includes every §5-bis "machine declared nothing" read. <b>The aggregate,
/// which the per-call figure does not convey:</b> <c>GET /v1/component-types</c> reads every listed code
/// through <c>GetAsync</c>, so over a database whose rows are ALL non-canonically keyed it is n misses ×
/// an n-row scan each — O(n²) rows read (measured by re-review #4: 151 inner calls, 51 of them full scans,
/// for 50 legacy rows). A CANONICAL database pays none of it: zero misses, zero scans. So the cost is a
/// property of legacy data awaiting migration, not of normal operation, and at fleet scale (tens of
/// machines against a local SQLite file) the worst case is a few thousand short row reads. Accepted here;
/// it would not be acceptable against a remote store.</para>
/// </summary>
internal static class MachineCodeIdentity
{
    /// <summary>The ONE canonicalisation rule for machine-code identity across this store seam:
    /// <c>Trim().ToUpperInvariant()</c>. A null/blank input is returned UNCHANGED (never coerced to
    /// <c>""</c> or thrown on) — a blank machine code is <see cref="ContractInvariants"/>'s violation to
    /// report, not this method's job to paper over or reject.</summary>
    public static string Canonicalize(string? machineCode) =>
        string.IsNullOrWhiteSpace(machineCode) ? machineCode! : machineCode.Trim().ToUpperInvariant();

    /// <summary>Two spellings of one machine-code identity, compared the way this seam defines identity.
    /// Exists so the fallback below cannot drift into a second, subtly different comparison.</summary>
    public static bool SameIdentity(string? a, string? b) =>
        string.Equals(Canonicalize(a), Canonicalize(b), StringComparison.Ordinal);
}

/// <summary>Canonicalises every machine code crossing the <see cref="IComponentModelStore"/> seam, in both
/// directions — see this file's own top-level doc comment for the enumeration and the rationale. Wraps
/// rather than replaces: WS-HMI-0a's store is untouched, this is composition, not modification.</summary>
internal sealed class CanonicalizingComponentModelStore : IComponentModelStore
{
    private readonly IComponentModelStore _inner;

    public CanonicalizingComponentModelStore(IComponentModelStore inner) => _inner = inner;

    public Task PutAsync(ComponentModelDocument doc, CancellationToken ct = default) =>
        _inner.PutAsync(Canonical(doc), ct);

    /// <summary>Canonical key first; if that misses, resolve the identity against the keys actually
    /// stored, and read the row that IS this identity under some other spelling.
    ///
    /// <para>🔴 <b>The fallback is the fix for re-review #3's HIGH, and canonicalising the list alone
    /// would not have been.</b> With one row keyed <c>legacy-01</c> on disk — written by a direct store
    /// caller, or by this branch two commits ago, and surviving a redeploy under
    /// <c>%ProgramData%\ST4I\sim\hmi-model</c> — canonicalising only the OUTPUT of
    /// <see cref="ListMachineCodesAsync"/> would make the list say <c>LEGACY-01</c> and this method still
    /// return <see langword="null"/>, which the HTTP layer turns into the §5-bis EMPTY document: a machine
    /// listed, its tree invisible, its types dropped from <c>/v1/component-types</c>, and — the worst of
    /// them — <c>GET /v1/components/legacy-01/integrity</c> returning a CLEAN bill of health at OPERATOR
    /// tier for a document it never read. That is the same consequence, re-labelled. Before this branch
    /// that request returned the real document, so leaving it was a REGRESSION on existing data, not
    /// merely an unmigrated residual.</para>
    ///
    /// <para>Deterministic when more than one non-canonical spelling exists: the canonical key wins
    /// outright (it is tried first), and among non-canonical spellings the ordinally-first is chosen, so
    /// two reads never disagree. The document is returned with its <c>MachineCode</c> canonicalised, so a
    /// caller never sees a document whose identity contradicts the list it came from.</para></summary>
    public async Task<ComponentModelDocument?> GetAsync(string machineCode, CancellationToken ct = default)
    {
        var canonical = MachineCodeIdentity.Canonicalize(machineCode);

        var doc = await _inner.GetAsync(canonical, ct).ConfigureAwait(false);
        if (doc is null)
        {
            var storedKey = await ResolveStoredKeyAsync(canonical, ct).ConfigureAwait(false);
            if (storedKey is not null)
            {
                doc = await _inner.GetAsync(storedKey, ct).ConfigureAwait(false);
            }
        }

        return doc is null ? null : Canonical(doc);
    }

    /// <summary>Canonicalised AND de-duplicated: two spellings of one machine are ONE entry, and every
    /// entry names an identity <see cref="GetAsync"/> can actually serve — which is the property
    /// <c>CanonicalMachineCodeStoresTests.Every_code_the_list_reports_is_a_code_GetAsync_can_actually_serve</c>
    /// states directly. Re-sorted after canonicalising because the inner store's <c>ORDER BY
    /// machine_code</c> is an ordinal sort of the STORED spellings, which is not an ordering of the
    /// canonical ones.</summary>
    public async Task<IReadOnlyList<string>> ListMachineCodesAsync(CancellationToken ct = default)
    {
        var stored = await _inner.ListMachineCodesAsync(ct).ConfigureAwait(false);

        return stored.Select(MachineCodeIdentity.Canonicalize)
                     .Distinct(StringComparer.Ordinal)
                     .OrderBy(code => code, StringComparer.Ordinal)
                     .ToList();
    }

    private async Task<string?> ResolveStoredKeyAsync(string canonical, CancellationToken ct)
    {
        // A blank machine code is not an identity — ContractInvariants reports it; scanning for it here
        // would only turn one violation into a table scan.
        if (string.IsNullOrWhiteSpace(canonical)) return null;

        var stored = await _inner.ListMachineCodesAsync(ct).ConfigureAwait(false);
        return stored.Where(code => MachineCodeIdentity.SameIdentity(code, canonical))
                     .OrderBy(code => code, StringComparer.Ordinal)
                     .FirstOrDefault();
    }

    private static ComponentModelDocument Canonical(ComponentModelDocument doc) =>
        doc with { MachineCode = MachineCodeIdentity.Canonicalize(doc.MachineCode) };
}

/// <summary>The <see cref="ITagNamespaceStore"/> twin of <see cref="CanonicalizingComponentModelStore"/> —
/// same rule, same reason it exists NOW even though <c>PUT /v1/tags/{machineCode}</c> is WS-HMI-0b Task 2's
/// job: <c>HmiModelEndpoints.PutAsync</c>/<c>GetIntegrityAsync</c> already call
/// <see cref="ITagNamespaceStore.GetAsync"/> with a route-derived machine code today, so the SAME
/// case-variant miss (a real namespace, invisible to an integrity check addressed by a different spelling)
/// is reachable in THIS task.
///
/// <para><b>Two documented differences from the twin, neither of them a choice</b> — see exclusions 1 and 2
/// in this file's top-level doc comment: <see cref="FindTagAsync"/> forwards a tag PATH untouched (a
/// different identity), and <see cref="GetAsync"/> has no canonical-miss fallback because
/// <see cref="ITagNamespaceStore"/> exposes no way to enumerate stored keys.</para></summary>
internal sealed class CanonicalizingTagNamespaceStore : ITagNamespaceStore
{
    private readonly ITagNamespaceStore _inner;

    public CanonicalizingTagNamespaceStore(ITagNamespaceStore inner) => _inner = inner;

    public Task PutAsync(TagNamespaceDocument doc, CancellationToken ct = default) =>
        _inner.PutAsync(Canonical(doc), ct);

    public async Task<TagNamespaceDocument?> GetAsync(string machineCode, CancellationToken ct = default)
    {
        var doc = await _inner.GetAsync(MachineCodeIdentity.Canonicalize(machineCode), ct).ConfigureAwait(false);
        return doc is null ? null : Canonical(doc);
    }

    /// <summary><c>path</c> is a tag path, not a machine code — a DIFFERENT identity, deliberately
    /// forwarded verbatim. Judged correct by re-review #3 §2.3; the reasoning, and the rule it imposes on
    /// downstream consumers ("look a path up, never compose one from a machine code"), are exclusion 1 in
    /// this file's top-level doc comment.</summary>
    public Task<TagDescriptor?> FindTagAsync(string path, CancellationToken ct = default) =>
        _inner.FindTagAsync(path, ct);

    private static TagNamespaceDocument Canonical(TagNamespaceDocument doc) =>
        doc with { MachineCode = MachineCodeIdentity.Canonicalize(doc.MachineCode) };
}
