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
/// <para>🔴 <b>THE GAP THAT MADE TRIMMING NECESSARY WAS TWO GAPS, NOT ONE — CLOSED, WS-HMI-2 Task 2 fix
/// round 1 (review carried ruling).</b> This paragraph used to say <see cref="ContractInvariants"/> checks
/// only <c>IsNullOrWhiteSpace(doc.ScreenId)</c> and cited a "TypeScript builder" enforcing the schema's
/// pattern — <b>that builder does not exist</b> (grepped: zero <c>a-z0-9</c>-pattern hits anywhere in
/// <c>web/src</c>), so the corrected claim is worse than the one it replaces, not better, and is retracted
/// rather than repeated. What was true and now is NOT: <see cref="ContractInvariants.Validate(HmiScreenDocument)"/>,
/// which <see cref="HmiScreenStore.PutAsync"/> calls as its first statement, now ALSO rejects a
/// <c>screenId</c> that does not match <c>^[a-z0-9-]+$</c> — see that method's own doc comment for the
/// measurement (<c>ScreenId="MyScreen"</c> drew 0 violations before this round) and for why the fix belongs
/// there and not in a builder. <b>How the two fixes interact, stated so a reader does not have to work it
/// out:</b> this decorator's <c>Trim()</c> runs BEFORE the document reaches that check, so a DI caller who
/// types <c>"  line-overview  "</c> gets it silently forgiven (trimmed, then valid) while a DI caller who
/// types <c>"  Line-Overview  "</c> gets a <see cref="ContractViolationException"/> naming the violation
/// (trimmed to <c>"Line-Overview"</c>, still fails the pattern) — whitespace is an accident this decorator
/// exists to forgive, a wrong character is a specification violation <see cref="ContractInvariants"/> exists
/// to refuse, and the two are not the same question. <b>What is now UNREACHABLE through any DI or direct
/// <c>HmiScreenStore.PutAsync</c> call, stated so the residual below is not over-read:</b> the exact
/// padded-and-otherwise-valid row (<c>"  padded-screen  "</c>) MED-1's own probe used to demonstrate the
/// fallback below is now REJECTED at the write door before it ever reaches a table, because
/// <c>^[a-z0-9-]+$</c> has no whitespace in its character class either. That closes the reproduction this
/// task shipped it against — it does not retire the PROPERTY the fallback establishes; see the next
/// paragraph for why the fallback is kept anyway.</para>
///
/// <para>🔴 <b>THE PROPERTY THIS SEAM NOW ESTABLISHES — every identity the seam NAMES, the seam can SERVE —
/// closed as a property (review MED-1), not left paired with a decision that did not survive its own
/// probe.</b> A previous version of this file argued <see cref="ListScreenIdsAsync"/> forwarding verbatim
/// and <see cref="GetAsync"/> having no canonical-miss fallback were a SAFE PAIRING. Measured, with a raw
/// <c>new HmiScreenStore(dir)</c>-written row <c>"  padded-screen  "</c> seeded directly (bypassing
/// <see cref="ContractInvariants"/> entirely, which is exactly how such a row would exist — a build from
/// before this round, or a direct database write, not a live C# write path): the list named
/// <c>"  padded-screen  "</c>, and <see cref="GetAsync"/>/<see cref="ListVersionsAsync"/> BOTH answered
/// "never declared" for the exact string the list had just handed back, while
/// <see cref="RollbackAsync"/> threw naming a THIRD spelling (the canonicalised one) that matched neither.
/// Three methods, three different answers, for one row. <b>The argument was wrong because decision (2) —
/// no output canonicalisation — bought nothing: decision (1), no fallback, was the entire cause</b>, and
/// removing (2) alone (canonicalise-and-dedupe the list) would have made the list LIE (report a clean
/// canonical name for a row nothing could then serve), which is worse. Closed here the way
/// <see cref="CanonicalizingComponentModelStore.GetAsync"/> already closes it for machine codes — see that
/// method's own doc comment for the re-review it defends against, now measured for screens too:
/// <see cref="ListScreenIdsAsync"/> canonicalises AND de-duplicates its output (so the list only ever
/// names an identity that is, by construction, a name <see cref="GetAsync"/> can resolve), and
/// <see cref="GetAsync"/>/<see cref="ListVersionsAsync"/>/<see cref="RollbackAsync"/> each try the canonical
/// spelling first and, on a miss, resolve the identity against the RAW stored ids
/// (<c>_inner.ListScreenIdsAsync</c>, never this decorator's own canonicalised one — resolving against an
/// already-canonicalised list could never find a non-canonical row) and retry under whichever spelling the
/// row actually lives at.</para>
///
/// <para>🔴 <b>WHAT THE FALLBACK DOES NOT DO — <see cref="RollbackAsync"/>'s residual, named rather than
/// assumed away.</b> <see cref="HmiScreenStore.RollbackAsync"/> reads and re-<c>PutAsync</c>s entirely
/// through its OWN (raw) <c>GetAsync</c>/<c>PutAsync</c> — so forwarding a RESOLVED raw spelling to
/// <c>_inner.RollbackAsync</c> makes the call SUCCEED (the property above holds: the identity is served),
/// but the NEW version it appends is written under that SAME raw, non-canonical spelling, not migrated to
/// canonical — because the raw store's own <c>PutAsync</c> does not go back through this decorator. This
/// is the identical shape <c>CanonicalMachineCodeStores.cs</c>'s own guarantee section accepts for a direct
/// <c>ComponentModelStore</c> caller: airtight for SERVING an identity through DI, not a promise to REWRITE
/// a row's storage key. A screen rolled back through this path stays reachable at every spelling
/// <see cref="GetAsync"/> already resolves; it does not become a canonical row by being rolled back.
/// Self-healing the key would mean re-implementing <see cref="HmiScreenStore.RollbackAsync"/>'s own
/// version-history and error-message logic here, duplicating business logic this decorator exists to wrap
/// rather than replace — judged the wrong trade for a residual that, after the paragraph above, requires a
/// row already on disk from before this round shipped.</para>
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
/// <para><b>The guarantee, at the strength it actually has.</b> Every screen written through DI — which is
/// every screen any HTTP handler or background job can write, because the raw store is never registered —
/// is stored under its trimmed, pattern-valid <c>screenId</c>, and every read through DI resolves that
/// same identity NO MATTER which spelling of it (canonical, or a raw non-canonical spelling a row happens
/// to be stored under) a caller supplies — the list, the document, and every version-history read agree.
/// What is NOT covered — a rolled-back row's storage key staying non-canonical — is stated above rather
/// than left to be discovered.</para>
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

    /// <summary>Two spellings of one <c>screenId</c> identity, compared the way this seam defines identity.
    /// Exists so the fallback below cannot drift into a second, subtly different comparison — same reason
    /// <see cref="MachineCodeIdentity.SameIdentity"/> exists for its own seam.</summary>
    public static bool SameIdentity(string? a, string? b) =>
        string.Equals(Canonicalize(a), Canonicalize(b), StringComparison.Ordinal);
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

    /// <summary>Canonical key first; if that misses, resolve the identity against the RAW stored ids and
    /// retry under whichever spelling the row actually lives at — see this file's top-level doc comment
    /// (MED-1) for the measurement that made this necessary and for why <see cref="ListScreenIdsAsync"/>'s
    /// own canonicalisation does not make this redundant. The returned document's <c>ScreenId</c> is
    /// re-canonicalised on the way out, so a caller never sees a document whose identity contradicts the
    /// list it came from — same reasoning as <see cref="CanonicalizingComponentModelStore.GetAsync"/>.</summary>
    public async Task<HmiScreenDocument?> GetAsync(string screenId, int? version = null, CancellationToken ct = default)
    {
        var canonical = ScreenIdentity.Canonicalize(screenId);

        var doc = await _inner.GetAsync(canonical, version, ct).ConfigureAwait(false);
        if (doc is null)
        {
            var storedId = await ResolveStoredScreenIdAsync(canonical, ct).ConfigureAwait(false);
            if (storedId is not null)
            {
                doc = await _inner.GetAsync(storedId, version, ct).ConfigureAwait(false);
            }
        }

        return doc is null ? null : Canonical(doc);
    }

    /// <summary>Canonicalises <c>doc.ScreenId</c> before it ever reaches the inner store's SQL parameter —
    /// this is the one method where skipping canonicalisation would let two spellings become two rows,
    /// because <c>doc.ScreenId</c> IS the primary-key column <see cref="HmiScreenStore"/> binds it to.</summary>
    public Task<int> PutAsync(HmiScreenDocument doc, CancellationToken ct = default) =>
        _inner.PutAsync(doc with { ScreenId = ScreenIdentity.Canonicalize(doc.ScreenId) }, ct);

    /// <summary>Canonicalised AND de-duplicated — mirrors
    /// <see cref="CanonicalizingComponentModelStore.ListMachineCodesAsync"/>'s own reasoning exactly, closed
    /// here for the same MED-1 property: every entry names an identity <see cref="GetAsync"/> can actually
    /// serve. Re-sorted after canonicalising because the inner store's <c>ORDER BY screen_id</c> is an
    /// ordinal sort of the STORED (possibly padded) spellings, which is not an ordering of the canonical
    /// ones.</summary>
    public async Task<IReadOnlyList<string>> ListScreenIdsAsync(CancellationToken ct = default)
    {
        var stored = await _inner.ListScreenIdsAsync(ct).ConfigureAwait(false);

        return stored.Select(ScreenIdentity.Canonicalize)
                     .Distinct(StringComparer.Ordinal)
                     .OrderBy(id => id, StringComparer.Ordinal)
                     .ToList();
    }

    /// <summary>Canonical key first; if that returns EMPTY (this method's own documented, non-throwing
    /// "nobody declared this" signal — see <see cref="IHmiScreenStore.ListVersionsAsync"/>), resolve the
    /// identity against the RAW stored ids and retry, same fallback as <see cref="GetAsync"/>.</summary>
    public async Task<IReadOnlyList<ScreenVersionInfo>> ListVersionsAsync(string screenId, CancellationToken ct = default)
    {
        var canonical = ScreenIdentity.Canonicalize(screenId);

        var versions = await _inner.ListVersionsAsync(canonical, ct).ConfigureAwait(false);
        if (versions.Count == 0)
        {
            var storedId = await ResolveStoredScreenIdAsync(canonical, ct).ConfigureAwait(false);
            if (storedId is not null)
            {
                versions = await _inner.ListVersionsAsync(storedId, ct).ConfigureAwait(false);
            }
        }

        return versions;
    }

    /// <summary>Canonical key first; <see cref="HmiScreenStore.RollbackAsync"/> THROWS
    /// <see cref="ArgumentOutOfRangeException"/> rather than returning an empty/null miss signal, so the
    /// fallback here is a catch-and-retry, not a result check. Only retries when the resolved raw spelling
    /// actually DIFFERS from what was already tried — otherwise a genuinely-bad <paramref name="toVersion"/>
    /// on an already-canonical screen would be re-thrown a second time for no reason, and the ORIGINAL
    /// exception (naming the real available versions) is what should reach the caller. See this file's
    /// top-level doc comment for what this fallback does NOT do: the new version it appends is written
    /// under the RESOLVED (possibly non-canonical) spelling, not migrated to canonical.</summary>
    public async Task<int> RollbackAsync(string screenId, int toVersion, CancellationToken ct = default)
    {
        var canonical = ScreenIdentity.Canonicalize(screenId);
        try
        {
            return await _inner.RollbackAsync(canonical, toVersion, ct).ConfigureAwait(false);
        }
        catch (ArgumentOutOfRangeException) when (!string.IsNullOrWhiteSpace(canonical))
        {
            var storedId = await ResolveStoredScreenIdAsync(canonical, ct).ConfigureAwait(false);
            if (storedId is null || string.Equals(storedId, canonical, StringComparison.Ordinal))
            {
                throw;
            }

            return await _inner.RollbackAsync(storedId, toVersion, ct).ConfigureAwait(false);
        }
    }

    /// <summary>Resolves a canonical identity against the ids ACTUALLY on disk — deliberately reading
    /// <c>_inner.ListScreenIdsAsync</c> (the raw, un-canonicalised list), never this decorator's own
    /// <see cref="ListScreenIdsAsync"/>: resolving against an already-canonicalised list could never find a
    /// non-canonical row, which would make this method always return <see langword="null"/> and the whole
    /// fallback a no-op. Deterministic when more than one non-canonical spelling exists (ordinally-first
    /// wins), same tie-break as <see cref="CanonicalizingComponentModelStore"/>'s twin.</summary>
    private async Task<string?> ResolveStoredScreenIdAsync(string canonical, CancellationToken ct)
    {
        // A blank screenId is not an identity — ContractInvariants reports it; scanning for it here would
        // only turn one violation into a table scan.
        if (string.IsNullOrWhiteSpace(canonical)) return null;

        var stored = await _inner.ListScreenIdsAsync(ct).ConfigureAwait(false);
        return stored.Where(id => ScreenIdentity.SameIdentity(id, canonical))
                     .OrderBy(id => id, StringComparer.Ordinal)
                     .FirstOrDefault();
    }

    private static HmiScreenDocument Canonical(HmiScreenDocument doc) =>
        doc with { ScreenId = ScreenIdentity.Canonicalize(doc.ScreenId) };
}
