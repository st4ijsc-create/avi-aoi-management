using St4i.Hmi.Contracts;

namespace St4i.EngineApi.HmiModel;

/// <summary>
/// WS-HMI-2 Task 2 — <c>screenId</c> identity, closed at the ONE seam every caller of
/// <see cref="IHmiScreenStore"/> shares. Same law <see cref="CanonicalMachineCodeStores"/> (this
/// namespace's <c>CanonicalMachineCodeStores.cs</c>) closed for machine-code identity, stated there as a
/// rule rather than a count: <b>the raw store may be constructed exactly where the composition root needs
/// it, and must never be registered.</b> <c>Program.cs</c> hands <see cref="IHmiScreenStore"/> out as ONLY
/// <see cref="CanonicalizingHmiScreenStore"/> — a handler that takes the interface gets canonicalisation
/// for free and cannot opt out, because there is no DI path to the raw, whitespace-sensitive-keyed
/// <see cref="HmiScreenStore"/> for any handler, existing or written next month.
///
/// <para><b>The identity rule, and what it is NOT — measured, not assumed.</b> <c>contracts/hmi-screen.
/// schema.json</c> declares <c>screenId</c> with <c>pattern: "^[a-z0-9-]+$"</c> — already lowercase BY THE
/// FROZEN CONTRACT, so this seam does <b>not</b> fold case the way <see cref="MachineCodeIdentity"/> does
/// for machine codes. That is a deliberate difference, not an oversight: a machine code has no case
/// constraint at all, so <c>AOI-01</c>/<c>aoi-01</c> are two equally-valid spellings of one identity and
/// folding them is a merge. A screenId spelled <c>Line-Overview</c> is not a second valid spelling of
/// <c>line-overview</c> — it is a document the frozen schema says should never have existed, and silently
/// lower-casing it would launder a contract violation into a merge instead of surfacing it. So this seam
/// folds exactly one thing: <see cref="ScreenIdentity.Canonicalize"/> is <c>Trim()</c>, nothing else.</para>
///
/// <para>🔴 <b>The gap that makes trimming necessary anyway, measured rather than assumed from the pattern
/// string above.</b> The schema's <c>pattern</c> is enforced by <c>check-contracts.mjs</c> against
/// fixtures and by the TypeScript builder — <b>not</b> by the C# runtime write door.
/// <see cref="ContractInvariants.Validate(HmiScreenDocument)"/>, which
/// <see cref="HmiScreenStore.PutAsync"/> calls as its first statement, checks only
/// <c>string.IsNullOrWhiteSpace(doc.ScreenId)</c> for this field — there is no regex check anywhere in
/// that method (grepped: zero hits for the pattern's character class in <c>ContractInvariants.cs</c>). So
/// <c>"  line-overview  "</c> reaches <see cref="HmiScreenStore.PutAsync"/> exactly as freely as
/// <c>"line-overview"</c> does, and the <c>screens</c>/<c>screen_current</c> tables key on
/// <c>screen_id TEXT</c> with no <c>COLLATE NOCASE</c> and no trimming of their own (verified against
/// <see cref="HmiScreenStore"/>'s migration DDL) — SQLite's default BINARY collation treats padded and
/// unpadded spellings as two distinct primary keys. Left alone, one screen edited once with a
/// leading/trailing space would silently become two rows: one the builder's next load finds, one it
/// never sees again. That is the exact "two spellings, one entity, two rows" shape
/// <c>CanonicalMachineCodeStores.cs</c>'s own doc comment opens with, for a different field. <b>This is
/// reported, not silently fixed elsewhere</b>: enforcing the schema's character-class pattern at the C#
/// write door is a validation gap in <see cref="ContractInvariants"/>, not an identity question this
/// decorator answers — folding whitespace here does not, and is not meant to, make an out-of-pattern
/// spelling (a stray uppercase letter, say) valid. It only stops whitespace from splitting one identity
/// into two.</para>
///
/// <para><b>The empty string, named rather than left to be inferred.</b>
/// <see cref="ScreenIdentity.Canonicalize"/> mirrors <see cref="MachineCodeIdentity.Canonicalize"/>'s
/// null/blank handling exactly, for the same reason: a null/whitespace-only <c>screenId</c> is
/// returned UNCHANGED, never coerced to <c>""</c> and never thrown on here. Two reasons, both real: (1)
/// calling <c>.Trim()</c> on a null string throws <see cref="NullReferenceException"/>, and this
/// interface's non-nullable <c>string screenId</c> parameters are a compile-time promise only —
/// deserialization can still hand this seam a runtime null; (2) whether a blank/whitespace screenId is
/// valid is <see cref="ContractInvariants"/>'s call to make, not this decorator's — trimming
/// <c>"   "</c> down to <c>""</c> changes nothing about whether
/// <see cref="ContractInvariants.Validate(HmiScreenDocument)"/> rejects it (its own check is
/// <c>IsNullOrWhiteSpace</c>, true for both spellings), so there is no behavioural reason to coerce it
/// and a philosophical reason not to: canonicalisation and validation are different jobs.</para>
///
/// <para>🔴 <b>What this does NOT do, named the way <c>CanonicalMachineCodeStores.cs</c> names its own
/// exclusions — because a decorator that describes its guarantee without describing its edges invites the
/// same "PARTIAL adoption of a stated rule" defect that file spent five rounds closing.</b>
/// <list type="number">
///   <item><description><b>No canonical-miss fallback on <see cref="GetAsync"/>/
///   <see cref="ListVersionsAsync"/>/<see cref="RollbackAsync"/>.</b>
///   <see cref="CanonicalizingComponentModelStore.GetAsync"/> carries one because
///   <see cref="ComponentModelStore"/> already had real, reachable rows on disk — written through a raw,
///   undecorated registration — before its decorator existed. <see cref="HmiScreenStore"/> has no such
///   history: this task is the FIRST time <see cref="IHmiScreenStore"/> is registered in
///   <c>Program.cs</c> at all, so no handler has ever been able to write a screen through DI without
///   going through this decorator, and no shipped build has ever exposed a raw-store write path to a real
///   <c>%ProgramData%</c> installation. A fallback here would be unreachable code with nothing to
///   reach.</description></item>
///   <item><description><b>The residual risk that leaves, named rather than assumed away:</b> the raw
///   <see cref="HmiScreenStore"/> constructor stays <c>public</c> (it must — the composition root
///   constructs it directly, and its tests do too), so a caller that does
///   <c>new HmiScreenStore(dir)</c> against the SAME directory <c>Program.cs</c> resolves can still write
///   a padded row this decorator's <see cref="GetAsync"/> will report as "never declared". That is the
///   same honest shape <c>CanonicalMachineCodeStores.cs</c> accepts for a direct
///   <c>new ComponentModelStore(dir)</c> caller: airtight for DI, not for a raw constructor call against
///   production data. Should a screen ever need the fallback machinery (a migration finds padded rows on
///   a real install), <see cref="IHmiScreenStore.ListScreenIdsAsync"/> already gives this store the
///   enumeration <see cref="ITagNamespaceStore"/> lacks, so the fix would be adding that fallback here —
///   not inventing a new mechanism.</description></item>
///   <item><description><b><see cref="ListScreenIdsAsync"/> forwards verbatim — no canonicalise-and-
///   deduplicate the way <see cref="CanonicalizingComponentModelStore.ListMachineCodesAsync"/> does.</b>
///   Not an oversight: canonicalise-and-dedupe on the way OUT while <see cref="GetAsync"/> has no
///   fallback would reproduce the EXACT bug <c>CanonicalMachineCodeStores.cs</c> spent re-review #3 on —
///   the list naming an identity a detail read cannot serve. Given no fallback exists (see above), the
///   only safe pairing is "neither method rewrites what it did not write", which is what every row
///   already is under the DI-only guarantee this decorator provides.</description></item>
/// </list></para>
///
/// <para><b>The guarantee, at the strength it actually has.</b> Every screen written through DI — which is
/// every screen any HTTP handler or background job can write, because the raw store is never registered —
/// is stored under its trimmed <c>screenId</c>, and every read through DI resolves that same trimmed
/// spelling. Two spellings differing only in surrounding whitespace can never diverge into two rows through
/// this seam. What is NOT covered is stated above rather than left to be discovered.</para>
/// </summary>
internal static class ScreenIdentity
{
    /// <summary>The ONE canonicalisation rule for <c>screenId</c> identity across this store seam:
    /// <c>Trim()</c> — no case change (see this file's own doc comment for why screenId's contract makes
    /// that a different question from machine-code identity). A null/blank input is returned UNCHANGED
    /// (never coerced to <c>""</c> or thrown on) — a blank screenId is <see cref="ContractInvariants"/>'s
    /// violation to report, not this method's job to paper over or reject.</summary>
    public static string Canonicalize(string? screenId) =>
        string.IsNullOrWhiteSpace(screenId) ? screenId! : screenId.Trim();
}

/// <summary>Canonicalises every <c>screenId</c> crossing the <see cref="IHmiScreenStore"/> seam — see this
/// file's own top-level doc comment for the rule, the measurement behind it, and what it deliberately does
/// not cover. Wraps rather than replaces: WS-HMI-2 Task 1's store is untouched, this is composition, not
/// modification.</summary>
internal sealed class CanonicalizingHmiScreenStore : IHmiScreenStore
{
    private readonly IHmiScreenStore _inner;

    public CanonicalizingHmiScreenStore(IHmiScreenStore inner) => _inner = inner;

    /// <summary>Every member <see cref="IHmiScreenStore"/>'s surface carries today — its own declared
    /// members; the interface has no base interface today, but a future one would need its members named
    /// here too, exactly the hole <c>CanonicalMachineCodeStoresTests.SeamSurface</c> closed after a
    /// reflection guard that read only <c>GetMethods()</c> let a seventh method through on a base
    /// interface. <see cref="HmiScreenStoreTests"/>'s reflection guard reads this set against
    /// <c>typeof(IHmiScreenStore).GetMethods().Concat(typeof(IHmiScreenStore).GetInterfaces().
    /// SelectMany(i =&gt; i.GetMethods()))</c> and fails if either side names a method the other does
    /// not. A name missing here means a future method can be added to the interface and forwarded by a
    /// default implementation, or simply left unimplemented, with nothing catching it — the exact defect
    /// WS-HMI-0b's machine-code seam shipped three consecutive rounds running.</summary>
    public static readonly IReadOnlySet<string> HandledMethods = new HashSet<string>(StringComparer.Ordinal)
    {
        nameof(IHmiScreenStore.GetAsync),
        nameof(IHmiScreenStore.PutAsync),
        nameof(IHmiScreenStore.ListScreenIdsAsync),
        nameof(IHmiScreenStore.ListVersionsAsync),
        nameof(IHmiScreenStore.RollbackAsync),
    };

    /// <summary>Canonicalises the lookup key only. No canonical-miss fallback — see this file's top-level
    /// doc comment for why one is not reachable today and what would need to change to add it.</summary>
    public Task<HmiScreenDocument?> GetAsync(string screenId, int? version = null, CancellationToken ct = default) =>
        _inner.GetAsync(ScreenIdentity.Canonicalize(screenId), version, ct);

    /// <summary>Canonicalises <c>doc.ScreenId</c> before it ever reaches the inner store's SQL parameter —
    /// this is the one method where skipping canonicalisation would let two spellings become two rows,
    /// because <c>doc.ScreenId</c> IS the primary-key column <see cref="HmiScreenStore"/> binds it to.</summary>
    public Task<int> PutAsync(HmiScreenDocument doc, CancellationToken ct = default) =>
        _inner.PutAsync(doc with { ScreenId = ScreenIdentity.Canonicalize(doc.ScreenId) }, ct);

    /// <summary>No <c>screenId</c> parameter to canonicalise, and — unlike
    /// <see cref="CanonicalizingComponentModelStore.ListMachineCodesAsync"/> — no canonicalise-and-
    /// deduplicate on the returned list either. See this file's top-level doc comment, exclusion 3: pairing
    /// that with a fallback-free <see cref="GetAsync"/> would reproduce the exact "list names an identity
    /// the detail read cannot serve" defect <c>CanonicalMachineCodeStores.cs</c> was built to close.</summary>
    public Task<IReadOnlyList<string>> ListScreenIdsAsync(CancellationToken ct = default) =>
        _inner.ListScreenIdsAsync(ct);

    /// <summary>Canonicalises the lookup key only, same as <see cref="GetAsync"/> — an empty result for a
    /// screen nobody declared under this spelling is this method's own documented, non-throwing
    /// contract.</summary>
    public Task<IReadOnlyList<ScreenVersionInfo>> ListVersionsAsync(string screenId, CancellationToken ct = default) =>
        _inner.ListVersionsAsync(ScreenIdentity.Canonicalize(screenId), ct);

    /// <summary>Canonicalises the lookup key only. The inner store's own <see cref="HmiScreenStore.RollbackAsync"/>
    /// reads and re-<c>PutAsync</c>s entirely through its OWN (raw) methods, so by the time this call
    /// reaches it, handing it an already-trimmed <paramref name="screenId"/> is enough — there is no second
    /// identity-bearing value on this call for this decorator to touch.</summary>
    public Task<int> RollbackAsync(string screenId, int toVersion, CancellationToken ct = default) =>
        _inner.RollbackAsync(ScreenIdentity.Canonicalize(screenId), toVersion, ct);
}
