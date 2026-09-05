using System.Globalization;
using St4i.Hmi.Contracts;

namespace St4i.EngineApi.HmiModel;

/// <summary>
/// Session 4 (HMI-5) — export and import of screen packs, over <see cref="IHmiScreenStore"/> and nothing
/// else.
///
/// ══════════════════════════════════════════════════════════════════════════════════════════════════
/// ⚠ <b>LINE ENDINGS: THIS FILE IS LF; <c>HmiScreenStore.cs</c> NEXT DOOR IS CRLF. MEASURED, NOT GUESSED.</b>
/// ══════════════════════════════════════════════════════════════════════════════════════════════════
/// Counted at the byte level: <c>HmiScreenStore.cs</c> = 415 CRLF / 0 bare LF; this file, <c>ScreenPack.cs</c>
/// and <c>HmiScreenPackEndpoints.cs</c> = 0 CRLF / all bare LF. The repository has
/// <c>core.autocrlf=true</c> and no <c>.gitattributes</c>, so files enter the worktree in whichever shape
/// their author's tooling produced and nothing normalises them afterwards.
///
/// <para><b>Why this is written here rather than left to be discovered.</b> It is the THIRD line-ending
/// trap this programme has hit — one session ago a source-text matcher requiring <c>\n\n</c> passed on one
/// worktree and failed on another at the SAME commit. The failure mode is silent in both directions: a
/// <c>sed</c>/patch/regex written against one of these two files can no-op against the other while
/// reporting success, and a matcher that anchors on a literal newline shape will pass here and fail next
/// door. It is also easy to mis-measure — a shell layer that normalises on read (Git Bash's <c>grep</c>
/// among them) will report BOTH files as LF, which is how this stayed invisible until it was counted in
/// bytes rather than looked at.</para>
///
/// <para><b>What to do:</b> read normalised (<c>.Replace("\r\n", "\n")</c> — the idiom
/// <c>HmiModelWiringTests</c>/<c>SchemaEnumGuardPinTests</c> already use, and <c>readSource</c> on the web
/// side) before matching source text from either file, and never assume an edit tool that worked on one
/// will work on the other. Do NOT "fix" this by rewriting either file's endings wholesale: that is a
/// diff touching every line of a frozen-adjacent file, which buys nothing and hides the next real
/// change.</para>
///
/// ══════════════════════════════════════════════════════════════════════════════════════════════════
/// 🔴 THE APPEND-ONLY BOUNDARY, AND WHY THIS CLASS CANNOT BREACH IT EVEN BY MISTAKE
/// ══════════════════════════════════════════════════════════════════════════════════════════════════
/// The session boundary is absolute: <b>import may only append. It may never overwrite, delete, or edit an
/// existing version in place.</b>
///
/// This class does not enforce that with a check it could forget to run. It enforces it STRUCTURALLY: the
/// ONLY write this file performs is <c>store.PutAsync(...)</c>, and <c>PutAsync</c>'s own contract is
/// "appends a new version, never overwrites" — implemented as a plain <c>INSERT</c> against a
/// <c>(screen_id, version)</c> primary key at a version number computed as one past the current maximum
/// (<c>HmiScreenStore.AppendVersionAsync</c>: "Plain INSERT, never INSERT OR REPLACE / ON CONFLICT"). There
/// is no other write door to reach: <see cref="IHmiScreenStore"/> exposes exactly two mutations,
/// <c>PutAsync</c> and <c>RollbackAsync</c>, both appends, and <b>there is no DELETE at all</b> — the
/// standing WS-HMI-2 security ruling that a delete trades a visible append for an invisible removal. That
/// ruling is not reopened here and this class does not want it reopened: an import that could remove a row
/// would be exactly the silent data loss the boundary exists to prevent.
///
/// What pins it rather than merely asserting it: <c>ScreenPackTests</c> imports over an existing screen and
/// then reads BACK every pre-existing version, asserting each still holds its ORIGINAL document —
/// <c>Import_over_an_existing_screen_leaves_every_prior_version_byte_identical</c>. That test goes red the
/// instant a write path is introduced that mutates a stored row, because the old bytes would no longer be
/// there to read. Its NEGATIVE CONTROL is beside it: an import that refused everything would also leave
/// prior versions untouched and would pass, so
/// <c>Import_over_an_existing_screen_actually_appends_a_new_version</c> asserts the version COUNT grew and
/// the new head IS the imported document. Neither test alone is sufficient; the pair is.
///
/// ══════════════════════════════════════════════════════════════════════════════════════════════════
/// 🔴 THE ID COLLISION DECISION — NAMED, NOT HANDLED QUIETLY
/// ══════════════════════════════════════════════════════════════════════════════════════════════════
/// <b>An imported screen whose id already exists in the target store lands as a NEW VERSION of that
/// screen</b> (<see cref="ScreenImportOutcome.AppendedAsNewVersion"/>), and the import's report says so per
/// screen, distinctly from <see cref="ScreenImportOutcome.Created"/>.
///
/// The three candidate designs, and why this is the one:
///
///   1. <b>OVERWRITE the existing screen.</b> REFUSED, and it is the session's stop condition, not a
///      preference. It destroys an engineer's authored work with no record; the store deliberately has no
///      operation that can do it; and building one for import would reopen the DELETE ruling through a side
///      door with a friendlier name.
///
///   2. <b>REFUSE the import on collision</b> ("this screen already exists — rename it first"). Safe, and
///      REJECTED anyway, because it makes the feature not work for its own motivating case. The brief's
///      engineer is carrying machine A's screens to machine B — and machine B, commissioned from the same
///      generator, very likely already HAS <c>line-overview</c>. A tool that refuses precisely when the
///      screens correspond is a tool that only ever works on empty stores. Worse, it would push engineers
///      to rename screens to import them, permanently forking two identities for one panel in a store with
///      no DELETE to merge them back.
///
///   3. <b>APPEND as a new version.</b> CHOSEN. It is the operation the store was built around — the whole
///      reason <c>screens</c> is keyed <c>(screen_id, version)</c> rather than <c>screen_id</c> is that
///      history must survive a write. The prior document is not lost, it is version N; the imported one is
///      version N+1 and becomes current. And the store already has a name for undoing it:
///      <c>POST /v1/screens/{id}/rollback</c> puts the previous version back — itself by appending, so
///      even the undo loses nothing. An import is therefore fully reversible through an operation that
///      already exists, audited, at the same tier.
///
/// <b>HOW THE ENGINEER FINDS OUT — this is the half that makes the choice honest rather than merely
/// safe.</b> A collision that landed silently would be indistinguishable from a fresh create, and the
/// engineer would learn about it only when a colleague's panel changed under them. So:
///
///   * The per-entry outcome is <see cref="ScreenImportOutcome.AppendedAsNewVersion"/>, a DIFFERENT value
///     from <see cref="ScreenImportOutcome.Created"/> — the API response carries it per screen, and the
///     editor renders the two differently. A caller cannot fail to receive the distinction; it is not a
///     count, it is a labelled row per screen.
///   * <see cref="ScreenImportResult.Version"/> carries the version it landed AT. A number greater than 1
///     is itself the collision, visible without reading the outcome enum.
///   * The audit trail records it. Import writes through the same <c>PutAsync</c> the publish endpoint
///     uses, and <c>HmiScreenPackEndpoints</c> records one audit row per imported screen — so "who
///     replaced the current version of line-overview, when" is answerable after the fact, which is the
///     property a silent overwrite would have destroyed permanently.
///
/// ══════════════════════════════════════════════════════════════════════════════════════════════════
/// 🔴 A DOCUMENT TODAY'S VALIDATOR WOULD REJECT — EXPORT CARRIES IT, IMPORT REFUSES IT
/// ══════════════════════════════════════════════════════════════════════════════════════════════════
/// This case is real, not hypothetical: <c>RollbackAsync</c> does not re-validate, and
/// <c>ContractInvariants.Validate(HmiScreenDocument)</c> has been tightened twice since the first screen
/// row was written. A CURRENT row can therefore fail today's validator.
///
///   * <b>EXPORT carries it, labelled.</b> Refusing to export it would strand a live screen permanently —
///     the store has no DELETE, so the engineer could neither carry it nor remove it. The entry ships with
///     <c>exportValid: false</c> and every violation listed, so the pack is honest about what it holds.
///     Pinned by <c>Export_carries_a_document_todays_validator_rejects_and_labels_it_invalid</c>, which
///     seeds such a row the only honest way — a raw SQLite insert past every C# write door, the same
///     technique <c>CanonicalScreenStore</c>'s own doc comment describes for reproducing a legacy row.
///   * <b>IMPORT refuses it</b> (<see cref="ScreenImportOutcome.RejectedInvalid"/>), and refuses on its OWN
///     call to today's validator, never on the pack's <c>exportValid</c> label. Importing is NEW
///     AUTHORSHIP into a different store — the exact case <c>PutAsync</c> validates unconditionally — and
///     an import that trusted a flag inside its own untrusted input would be a laundry: hand-edit
///     <c>exportValid</c> to <see langword="true"/> and an invalid document walks through a door whose
///     entire job is to validate. The flag is diagnostic; <c>ContractInvariants</c> is the gate.
///
/// <b>The asymmetry is deliberate and is the same one the store already draws</b> between
/// <c>RollbackAsync</c> (restores content the system already accepted — no re-validation) and
/// <c>PutAsync</c> (new authorship — unconditional validation). An export reads what the system accepted;
/// an import authors into a store that never accepted it. Different questions, different answers.
///
/// ══════════════════════════════════════════════════════════════════════════════════════════════════
/// 🔴 ONE REFUSAL DOES NOT ABORT THE BATCH, AND WHY THAT IS NOT A HALF-WRITE
/// ══════════════════════════════════════════════════════════════════════════════════════════════════
/// A pack of twelve screens with one invalid entry imports the other eleven and reports the one refusal.
/// The alternative — all-or-nothing — sounds safer and is not available honestly: <see cref="IHmiScreenStore"/>
/// exposes no transaction spanning multiple screens, so "roll back the eleven" would mean DELETING rows,
/// which does not exist and must not. A per-entry report of what landed is the truthful shape for a store
/// that can only append. Every entry is independent, every outcome is named, and nothing is half-written:
/// <c>PutAsync</c> validates before it opens a connection, so a refused entry touches no table at all.
/// </summary>
public sealed class HmiScreenPackService
{
    private readonly IHmiScreenStore _store;

    public HmiScreenPackService(IHmiScreenStore store) => _store = store;

    /// <summary>
    /// Builds a pack from the CURRENT version of every screen named in <paramref name="screenIds"/>, or of
    /// every screen in the store when that list is <see langword="null"/> or empty.
    ///
    /// <para><b>CURRENT versions, not whole histories</b> — a deliberate scope, stated so it is not read as
    /// an oversight. A pack answers "give me these screens as they stand"; carrying every historical
    /// version would mean an import either replays them (creating N versions per screen in the target,
    /// polluting the history with another store's past) or discards them (carrying data it never uses).
    /// The provenance version number in each entry preserves the one fact a whole history would have been
    /// carried FOR: which version this content was.</para>
    ///
    /// <para>A named screen that does not exist is SKIPPED, not an error — the same convention
    /// <c>GetAsync</c> follows ("a screen nobody declared is a valid product state"). The caller learns
    /// which screens are present by reading the pack's own entry list, which is shorter than what it
    /// asked for.</para>
    /// </summary>
    public async Task<ScreenPackDocument> ExportAsync(
        string exportedFrom, IReadOnlyList<string>? screenIds = null, CancellationToken ct = default)
    {
        var ids = screenIds is { Count: > 0 }
            ? screenIds.Select(ScreenIdentity.Canonicalize).Distinct(StringComparer.Ordinal).OrderBy(id => id, StringComparer.Ordinal).ToList()
            : (await _store.ListScreenIdsAsync(ct).ConfigureAwait(false)).ToList();

        var entries = new List<ScreenPackEntry>();
        foreach (var id in ids)
        {
            var doc = await _store.GetAsync(id, null, ct).ConfigureAwait(false);
            if (doc is null) continue;

            var versions = await _store.ListVersionsAsync(id, ct).ConfigureAwait(false);
            // The current version IS the highest — IHmiScreenStore.GetAsync's own contract, restated there
            // as a property of the interface rather than of one implementation. Reading it from the history
            // rather than assuming a number keeps this honest for any store obeying that contract.
            var current = versions.LastOrDefault(v => v.IsCurrent) ?? versions.LastOrDefault();

            // 🔴 Today's validator, run for the LABEL, never as a filter. See this class's doc comment:
            // refusing to export a currently-served document would strand it permanently in a store with
            // no DELETE.
            var violations = ContractInvariants.Validate(doc);

            entries.Add(new ScreenPackEntry(
                ScreenId: id,
                Version: current?.Version ?? 0,
                SavedAtUtc: current?.SavedAtUtc ?? "",
                ExportValid: violations.Count == 0,
                ExportViolations: violations,
                Document: doc));
        }

        return new ScreenPackDocument(
            ScreenPackDocument.CurrentPackVersion,
            exportedFrom,
            DateTimeOffset.UtcNow.ToUniversalTime().ToString("O", CultureInfo.InvariantCulture),
            entries);
    }

    /// <summary>
    /// Imports every entry of <paramref name="pack"/>, APPENDING each as a new version of its screen.
    /// Returns one result per entry, in the pack's own order.
    ///
    /// <para>🔴 <b>THE ONLY WRITE IN THIS METHOD IS <c>_store.PutAsync</c>.</b> See this class's doc
    /// comment for why that is what makes the append-only boundary structural rather than a check.</para>
    ///
    /// <para>Throws <see cref="ArgumentOutOfRangeException"/> for a pack declaring a
    /// <see cref="ScreenPackDocument.PackVersion"/> this engine does not know, or one exceeding
    /// <see cref="ScreenPackDocument.MaxScreensPerPack"/> / <see cref="ScreenPackDocument.MaxWidgetsPerPack"/>
    /// — all three refused WHOLE, before any entry is examined, so an over-cap or unreadable pack can never
    /// half-import into a store with no DELETE to undo it.</para>
    ///
    /// <para>🔴 <b>SECURITY REVIEW L-1 — A screenId APPEARING TWICE IN ONE PACK IS AN ERROR, NOT
    /// LAST-ONE-WINS.</b> The reviewer measured 1,000 entries of one id landing as 1,000 permanent versions
    /// in a store with no DELETE. The first entry with a given id imports normally; every later entry with
    /// that same id is refused as <see cref="ScreenImportOutcome.RejectedDuplicateInPack"/>.
    ///
    /// <para><b>Why an error rather than last-one-wins</b>, which was the other honest candidate. A pack is
    /// ONE AUTHORED ARTEFACT describing a set of screens, and a set does not contain the same member twice —
    /// <see cref="ExportAsync"/> already de-duplicates its id list, so no pack this engine PRODUCES can
    /// contain a duplicate, and the two ends must agree or the format means different things at each. Given
    /// that, a duplicate can only come from hand-editing or from concatenating two packs, and in BOTH cases
    /// the engineer has two documents and no stated intent about which should win. Last-one-wins would pick
    /// one silently — and pick it by array ORDER, which is not something a JSON author reliably controls or
    /// even sees. Refusing names the mistake at the moment it can still be fixed. It is also the strictly
    /// safer half of the choice under this store's own constraints: a refusal writes nothing and is
    /// undoable by editing the pack, whereas the wrong silent winner is a permanent version in a store with
    /// no DELETE.</para></para>
    /// </summary>
    public async Task<IReadOnlyList<ScreenImportResult>> ImportAsync(
        ScreenPackDocument pack, CancellationToken ct = default)
    {
        if (pack.PackVersion != ScreenPackDocument.CurrentPackVersion)
        {
            throw new ArgumentOutOfRangeException(
                nameof(pack), pack.PackVersion,
                $"pack declares packVersion {pack.PackVersion}; this engine reads " +
                $"{ScreenPackDocument.CurrentPackVersion} only.");
        }

        // 🔴 SECURITY REVIEW H-1 — BOTH ceilings checked HERE, before the loop below writes anything. An
        // over-cap pack must be refused WHOLE: a partial import into a store with no DELETE cannot be
        // undone, so "refuse after 300 of 20,000 landed" would be the worst possible answer. The message
        // names the LIMIT and the ACTUAL size, because "too large" that does not say by how much is a
        // refusal the caller cannot act on.
        if (pack.Screens.Count > ScreenPackDocument.MaxScreensPerPack)
        {
            throw new ArgumentOutOfRangeException(
                nameof(pack), pack.Screens.Count,
                $"pack carries {pack.Screens.Count} screens, above the limit of " +
                $"{ScreenPackDocument.MaxScreensPerPack} — refused whole, so no entry is imported.");
        }

        // `long`, not `int`: the sum of individually-legal entries is exactly the quantity that overflows
        // here (the reviewer's measured pack summed to 1,000,000), and an overflow would wrap to a small
        // number and PASS this very check.
        long totalWidgets = 0;
        foreach (var entry in pack.Screens) totalWidgets += entry.Document?.Widgets?.Count ?? 0;
        if (totalWidgets > ScreenPackDocument.MaxWidgetsPerPack)
        {
            throw new ArgumentOutOfRangeException(
                nameof(pack), totalWidgets,
                $"pack carries {totalWidgets} widgets in total, above the limit of " +
                $"{ScreenPackDocument.MaxWidgetsPerPack} — refused whole, so no entry is imported. " +
                "Every entry may be individually legal; this is the ceiling on their sum.");
        }

        var results = new List<ScreenImportResult>();
        // L-1 — ids already claimed by an EARLIER entry of THIS pack. Ordinal, over the canonicalised id,
        // so it compares the same spelling the store would key on.
        var seenInThisPack = new HashSet<string>(StringComparer.Ordinal);

        foreach (var entry in pack.Screens)
        {
            var envelopeId = ScreenIdentity.Canonicalize(entry.ScreenId);

            // 🔴 Envelope-vs-document identity, refused rather than resolved — the same ruling
            // `PUT /v1/screens/{screenId}` made for its route-vs-body conflict, for the same reason:
            // silently choosing one of two identities a caller named is how a screen lands somewhere its
            // author did not ask for, in a store that cannot delete it again.
            if (!ScreenIdentity.SameIdentity(entry.ScreenId, entry.Document.ScreenId))
            {
                results.Add(new ScreenImportResult(
                    envelopeId, ScreenImportOutcome.RejectedIdentityConflict, null,
                    new[]
                    {
                        $"entry screenId '{entry.ScreenId}' does not match its document's screenId " +
                        $"'{entry.Document.ScreenId}' — refused rather than silently choosing one of the two.",
                    }));
                continue;
            }

            // 🔴 L-1 — a second entry naming an id an EARLIER entry of this same pack already claimed.
            // Checked AFTER the identity check above deliberately: an entry that is BOTH self-inconsistent
            // and a duplicate is reported for the identity conflict, the fault that makes it unusable
            // regardless of what else is in the pack.
            if (!seenInThisPack.Add(envelopeId))
            {
                results.Add(new ScreenImportResult(
                    envelopeId, ScreenImportOutcome.RejectedDuplicateInPack, null,
                    new[]
                    {
                        $"screenId '{envelopeId}' appears more than once in this pack — a pack is one " +
                        "authored artefact and describes each screen once. The FIRST entry with this id " +
                        "was imported; this one is refused rather than silently overwriting it or " +
                        "appending a second version chosen by array order.",
                    }));
                continue;
            }

            // Whether this id already exists decides only WHICH OUTCOME IS REPORTED — never whether or how
            // the write happens. Both paths call the same PutAsync, which appends either way. Read BEFORE
            // the write so the answer describes the store as the engineer left it.
            var existing = await _store.ListVersionsAsync(envelopeId, ct).ConfigureAwait(false);
            var collided = existing.Count > 0;

            int version;
            try
            {
                // 🔴 TODAY'S VALIDATOR, reached the ordinary way. PutAsync calls
                // ContractInvariants.ThrowIfInvalid as its first statement, before any connection opens —
                // so this import gets the SAME gate an engineer's publish gets, and cannot become a side
                // door around it. `entry.ExportValid` is NOT consulted anywhere in this method; grep it.
                version = await _store.PutAsync(entry.Document, ct).ConfigureAwait(false);
            }
            catch (ContractViolationException ex)
            {
                // Nothing was written — PutAsync validates before it opens a connection.
                results.Add(new ScreenImportResult(
                    envelopeId, ScreenImportOutcome.RejectedInvalid, null, ex.Violations));
                continue;
            }

            results.Add(new ScreenImportResult(
                envelopeId,
                collided ? ScreenImportOutcome.AppendedAsNewVersion : ScreenImportOutcome.Created,
                version,
                Array.Empty<string>()));
        }

        return results;
    }
}
