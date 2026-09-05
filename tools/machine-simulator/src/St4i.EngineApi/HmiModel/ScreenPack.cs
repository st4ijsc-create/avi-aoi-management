using St4i.Hmi.Contracts;

namespace St4i.EngineApi.HmiModel;

/// <summary>
/// Session 4 (HMI-5) — THE SCREEN PACK: the artefact an engineer carries screens between machines in.
///
/// ══════════════════════════════════════════════════════════════════════════════════════════════════
/// 🔴 WHY THIS RECORD LIVES HERE AND NOT IN <c>St4i.Hmi.Contracts</c>
/// ══════════════════════════════════════════════════════════════════════════════════════════════════
/// <c>src/St4i.Hmi.Contracts/*.cs</c> and <c>contracts/*.schema.json</c> are FROZEN for this session. A
/// pack is a NEW artefact — it did not exist to be frozen — so it is shaped here, in the engine, beside
/// the store it reads from and writes to. What it CARRIES is not new and is not reshaped:
/// <see cref="ScreenPackEntry.Document"/> is the frozen <see cref="HmiScreenDocument"/> itself, serialized
/// by the same <see cref="HmiContractJson.Options"/> every other producer in this family uses. A pack is a
/// WRAPPER around frozen documents, never a re-encoding of them — round-tripping a pack through
/// <c>System.Text.Json</c> and comparing the inner documents to what the store served is pinned by
/// <c>ScreenPackTests.Pack_round_trip_preserves_each_document_byte_for_byte</c>.
///
/// ══════════════════════════════════════════════════════════════════════════════════════════════════
/// 🔴 WHAT A PACK CARRIES, AND WHY EACH FIELD IS NOT OPTIONAL DECORATION
/// ══════════════════════════════════════════════════════════════════════════════════════════════════
/// The brief's test is "enough that importing it is not a gamble": WHICH screens, at WHICH versions, from
/// WHERE, and WHEN. Each maps to exactly one field, and each exists because importing without it forces a
/// guess:
///
///   * <see cref="ScreenPackEntry.ScreenId"/> + <see cref="ScreenPackEntry.Version"/> — WHICH screen at
///     WHICH version. The version is the SOURCE store's version number and is recorded as PROVENANCE, not
///     as an instruction: an import NEVER writes a document at the version number the pack names (see
///     <see cref="ScreenPackEntry.Version"/>'s own note). Without it, an engineer holding two packs from
///     the same machine a week apart cannot tell which is newer without diffing every widget.
///   * <see cref="ExportedFrom"/> — WHERE. The site identity of the store that produced the pack.
///   * <see cref="ExportedAtUtc"/> — WHEN. ISO-8601 UTC, the same shape as
///     <see cref="ScreenVersionInfo.SavedAtUtc"/>, so the two timestamps a reader sees side by side are in
///     one format rather than two.
///   * <see cref="PackVersion"/> — which pack SHAPE this is. Not the screen schema version (that lives
///     inside each document, where the frozen contract put it). A pack read by a future engine that
///     changed the wrapper needs to know which wrapper it is holding, and the alternative — sniffing the
///     field set — is how a format becomes unversionable.
///
/// ══════════════════════════════════════════════════════════════════════════════════════════════════
/// 🔴 <see cref="ScreenPackEntry.ExportValid"/> — THE FIELD THAT EXISTS BECAUSE THE STORE HAS HISTORY
/// ══════════════════════════════════════════════════════════════════════════════════════════════════
/// This is the field a reader should stop at, because it encodes the one genuinely hard fact about this
/// store: <b>a row written under older rules can still be CURRENT.</b>
/// <c>HmiScreenStore.RollbackAsync</c> deliberately does not re-validate ("a restore is not new
/// authorship" — <c>IHmiScreenStore.RollbackAsync</c>'s own doc comment), and
/// <c>ContractInvariants.Validate(HmiScreenDocument)</c> has been TIGHTENED twice since the first screen
/// row was written (the <c>screenId</c> pattern rule at WS-HMI-2 Task 2 fix round 1; the
/// <c>layout.cols</c>/<c>rows</c> range rule at Task 3 fix round 1). So a document this engine served
/// yesterday, legitimately, can fail today's validator.
///
/// EXPORT DOES NOT REFUSE IT. Refusing to export a currently-served document loses data — it would mean
/// an engineer's real, live screen simply cannot be carried, and the store has no DELETE to remove it
/// either, so it would be stranded permanently. The pack therefore carries the document AND a HONEST
/// LABEL: <see cref="ScreenPackEntry.ExportValid"/> is <see langword="false"/> and
/// <see cref="ScreenPackEntry.ExportViolations"/> carries every violation today's validator found, so a
/// reader of the pack — human or machine — knows before importing.
///
/// IMPORT DOES REFUSE IT, and refuses on its OWN re-validation rather than trusting the label. The two are
/// not in tension: export is a READ of something the system already accepted; import is NEW AUTHORSHIP
/// into a DIFFERENT store, and new authorship is the exact case
/// <c>HmiScreenStore.PutAsync</c> validates unconditionally. Trusting the pack's own
/// <see cref="ScreenPackEntry.ExportValid"/> flag would make the label the gate, which is a side door: a
/// hand-edited pack claiming <c>exportValid: true</c> would launder an invalid document into the store.
/// The flag is DIAGNOSTIC — it tells the importing engineer why a refusal was predictable — and
/// <c>ContractInvariants</c>, reached through <c>PutAsync</c>, is the gate.
/// </summary>
/// <param name="PackVersion">Shape version of this wrapper — see the class doc comment. Always
/// <see cref="CurrentPackVersion"/> for a pack this engine writes.</param>
/// <param name="ExportedFrom">Site identity of the store that produced this pack. Provenance only: an
/// import never consults it to decide anything.</param>
/// <param name="ExportedAtUtc">ISO-8601 UTC instant the pack was produced.</param>
/// <param name="Screens">The screens carried, in <c>screenId</c> order (the order
/// <c>IHmiScreenStore.ListScreenIdsAsync</c> returns), so two exports of an unchanged store compare
/// equal rather than differing by enumeration order.</param>
public sealed record ScreenPackDocument(
    int PackVersion,
    string ExportedFrom,
    string ExportedAtUtc,
    IReadOnlyList<ScreenPackEntry> Screens)
{
    /// <summary>The only pack shape this engine writes, and the only one <c>ImportAsync</c> accepts. A
    /// pack declaring any other number is REFUSED rather than best-effort read — the same posture
    /// <c>ContractInvariants</c> takes to <c>schemaVersion</c> ("a document declaring a different number
    /// is lying about the contract it obeys"), for the same reason: guessing at an unknown wrapper is how
    /// a field silently changes meaning between two engines.</summary>
    public const int CurrentPackVersion = 1;
}

/// <summary>One screen inside a <see cref="ScreenPackDocument"/>. See that record's doc comment for why
/// each field is here.</summary>
/// <param name="ScreenId">The screen's id in the SOURCE store, canonicalised (trimmed) exactly as
/// <see cref="ScreenIdentity.Canonicalize"/> does everywhere else. Note this is recorded ALONGSIDE
/// <paramref name="Document"/>'s own <c>ScreenId</c> rather than instead of it, and an import checks the
/// two agree — a pack whose envelope and document name different identities is refused rather than
/// silently resolved in favour of one, the same ruling <c>PUT /v1/screens/{screenId}</c> made for its
/// route-vs-body conflict.</param>
/// <param name="Version">The version number this document held IN THE SOURCE STORE. 🔴 PROVENANCE, NEVER
/// AN INSTRUCTION. An import writes through <c>PutAsync</c>, which assigns the next version number in the
/// TARGET store; this number is never used as a write target, and could not be — writing "at" a version
/// number is exactly the in-place write the append-only boundary forbids. It is here so an engineer can
/// answer "which version of line-overview is in this pack" without diffing.</param>
/// <param name="SavedAtUtc">When the SOURCE store recorded this version — copied verbatim from
/// <see cref="ScreenVersionInfo.SavedAtUtc"/>. Distinct from
/// <see cref="ScreenPackDocument.ExportedAtUtc"/>: one is when the screen was authored, the other when the
/// pack was made, and collapsing them would lose the age of the content.</param>
/// <param name="ExportValid">Whether TODAY'S <c>ContractInvariants</c> accepts
/// <paramref name="Document"/>. See <see cref="ScreenPackDocument"/>'s doc comment — DIAGNOSTIC, never a
/// gate. An import re-validates and ignores this field entirely.</param>
/// <param name="ExportViolations">Every violation today's validator found, or empty when
/// <paramref name="ExportValid"/> is <see langword="true"/>. Every violation, not the first — the same
/// rule <c>ContractViolationException</c> follows, for the same reason: a reader fixing a pack needs to
/// see all of them in one pass.</param>
/// <param name="Document">The frozen <see cref="HmiScreenDocument"/>, verbatim. Never reshaped.</param>
public sealed record ScreenPackEntry(
    string ScreenId,
    int Version,
    string SavedAtUtc,
    bool ExportValid,
    IReadOnlyList<string> ExportViolations,
    HmiScreenDocument Document);

/// <summary>What one screen in a pack DID when imported. Returned per entry so an import that partly
/// succeeds reports exactly which screens landed and which did not — an import is a batch, and a batch
/// that reports only a total is one an engineer cannot act on.</summary>
public enum ScreenImportOutcome
{
    /// <summary>The screen did not exist in the target store; it landed as version 1.</summary>
    Created,

    /// <summary>🔴 THE ID COLLISION OUTCOME. The screen ALREADY EXISTED in the target store, and the
    /// imported document was APPENDED as a NEW, HIGHER version — never written over the existing one. See
    /// <c>HmiScreenPackService.ImportAsync</c>'s doc comment for the full argument.</summary>
    AppendedAsNewVersion,

    /// <summary>Today's <c>ContractInvariants</c> refused the document. NOTHING was written for this
    /// entry — <c>PutAsync</c> validates before it opens a connection.</summary>
    RejectedInvalid,

    /// <summary>The pack entry's envelope <c>screenId</c> and its document's own <c>screenId</c> name
    /// different identities. Refused rather than resolved in favour of either. Nothing written.</summary>
    RejectedIdentityConflict,
}

/// <summary>One line of an import's report. <paramref name="Version"/> is the version the document landed
/// AT IN THE TARGET STORE — never the pack's provenance version — and is <see langword="null"/> for the
/// two refusal outcomes, because a refused entry has no version.</summary>
public sealed record ScreenImportResult(
    string ScreenId,
    ScreenImportOutcome Outcome,
    int? Version,
    IReadOnlyList<string> Violations);
