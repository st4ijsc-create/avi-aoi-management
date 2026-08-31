using System.Text.Json;
using St4i.Hmi.Contracts;

namespace St4i.EngineApi.HmiModel;

/// <summary>
/// WS-HMI-0c Task 1 — one tag a connector declares it can back.
///
/// <para>Field-for-field a <see cref="TagDescriptor"/> minus <c>isBackedByDriver</c>, and the omission is
/// the point. <c>isBackedByDriver</c> is the ANSWER this workstream computes; a connector declaring it
/// about itself would be the declaration marking its own homework, which is precisely the defect
/// <c>IsConsumedBySimulator</c>/<c>UnconsumedConfigKindsTests</c> exist to prevent elsewhere in this tree.
/// A connector says "here is a tag and here is where it comes from"; Task 3 decides whether that source
/// KIND can really back it, and Task 4 sets the flag.</para>
/// </summary>
/// <param name="Source">Where the value comes from — the field Task 3 reads to decide whether a driver of
/// that kind exists and can back this tag. Left exactly as the document gave it, including
/// <see langword="null"/>: inventing a <see cref="TagSource"/> the connector did not declare would be the
/// parser answering a question only the connector can.</param>
public sealed record TagMapEntry(
    string Path,
    string DataType,
    string? Unit,
    double? EngMin,
    double? EngMax,
    IReadOnlyList<string>? EnumValues,
    string Access,
    string? PolicyAction,
    TagSource Source);

/// <summary>
/// WS-HMI-0c Task 1 — a connector's declaration of the tags it can back, for one machine.
///
/// <para>🔴 <b>WHY THIS IS A SEPARATE DOCUMENT AND NOT PART OF THE CONNECTOR'S CONFIG STRING.</b>
/// <c>IConnectorFactory.TryCreate(string config, …)</c> takes an OPAQUE string whose inside each vendor
/// defines; <c>ConnectorConfigStore</c> forwards it verbatim and nothing in this codebase parses it. A tag
/// map inside that string would force every third-party connector to understand OUR format inside THEIR
/// document — coupling their schema to ours in the one place we deliberately do not reach. So this is our
/// data, keyed by <c>machineCode</c>, exactly the way <see cref="TagNamespaceDocument"/> already is.</para>
///
/// <para>🔴 <b>WHAT THIS PARSER DOES NOT DO, and the reason is the whole design.</b> It performs SHAPE
/// work — read the document, report what it says, normalise a missing list to empty so no caller can
/// null-dereference it — and no SAFETY work at all. §5's rule that a writable tag must carry a
/// <c>policyAction</c> belongs to <see cref="ContractInvariants"/> at the write door, where EVERY caller
/// passes, including the many that never touch this parser. Enforcing it here as well would put one safety
/// rule in two places, and two places drift: this repository has already paid for that, when the
/// <c>IsNullOrEmpty</c>/<c>IsNullOrWhiteSpace</c> split was closed at the two sites a finding named while
/// the rule stayed broken at the three that mattered. An entry with <c>access: "rw"</c> and no
/// <c>policyAction</c> therefore PARSES here and is REFUSED at the door — once, by the component that owns
/// the rule.</para>
///
/// <para>§5-bis at this layer: <b>a connector that declares no tag map is valid.</b> It contributes no
/// tags, produces no error and blocks nothing — and a declaration whose <c>entries</c> array is absent or
/// empty is that same valid state written down.</para>
/// </summary>
/// <param name="MachineCode">Verbatim, as the document spelled it — see
/// <see cref="CanonicalMachineCode"/> before using it as an identity.</param>
public sealed record TagMapDeclaration(
    int SchemaVersion,
    string MachineCode,
    IReadOnlyList<TagMapEntry> Entries)
{
    /// <summary>🔴 <b>The machine code as an IDENTITY, which is not the same thing as the string the
    /// document carried.</b>
    ///
    /// <para><see cref="MachineCode"/> is preserved verbatim because a parser that renamed the engineer's
    /// own string would be lying about the file it just read. But a machine code is a case-INSENSITIVE
    /// identity whose one canonical spelling is <c>Trim().ToUpperInvariant()</c>, so anything that uses the
    /// raw field to DECIDE something — grouping declarations by machine, or asking whether two connectors
    /// describe the same machine — would treat <c>aoi-01</c> and <c>AOI-01</c> as two machines. That is
    /// WS-HMI-0b Task 1's HIGH-A one layer up, and it cost five fix rounds down there.</para>
    ///
    /// <para><b>Why this is not also applied on parse.</b> WS-HMI-0b closed the storage half structurally:
    /// <c>CanonicalizingTagNamespaceStore</c> rewrites <c>doc.MachineCode</c> and the storage key on every
    /// <c>PutAsync</c>, so a declaration reaching the namespace through DI — the only route Task 4 may use
    /// — is canonicalised whether or not the ingesting code remembered to. Canonicalising here too would
    /// add no safety and one more place implementing the rule, which is the same objection this type makes
    /// about <c>policyAction</c> above. What remains is only the PRE-STORE identity decision, and this
    /// method is its one answer: <b>Tasks 2 and 4 must call this for any grouping or same-machine
    /// comparison, and must not compare <see cref="MachineCode"/> directly.</b></para>
    ///
    /// <para>A METHOD rather than a property, deliberately: a public property would be serialised by
    /// <c>System.Text.Json</c> into a <c>canonicalMachineCode</c> field this document does not have, and a
    /// shape that grows a field on write is a shape that no longer round-trips.</para></summary>
    public string CanonicalMachineCode() => MachineCodeIdentity.Canonicalize(MachineCode);

    /// <summary>Parses a tag-map document. Never throws: malformed input becomes
    /// <paramref name="error"/>.</summary>
    /// <param name="json">The document text.</param>
    /// <param name="decl">The parsed declaration, or <see langword="null"/> when this returns
    /// <see langword="false"/>.</param>
    /// <param name="error">A human-readable reason INCLUDING A POSITION when the input was malformed, or
    /// <see langword="null"/> on success.</param>
    /// <returns><see langword="true"/> if <paramref name="json"/> was a tag-map document.</returns>
    /// <remarks>
    /// <para>🔴 <b>THE ERROR NAMES A POSITION, and that is a requirement rather than a nicety.</b> A
    /// connector's tag map is hundreds to thousands of entries — the same population
    /// <see cref="ITagNamespaceStore"/>'s own doc comment describes. "Invalid JSON" for a 2 000-entry
    /// document tells an engineer only what they already knew. All three coordinates
    /// <see cref="JsonException"/> carries are reported: the LINE, the position within it, and — the one
    /// that actually finds the entry in a large array — the JSON PATH, e.g. <c>$.entries[1337].dataType</c>.
    /// Pinned by <c>TagMapDeclarationTests.A_syntax_error_deep_in_a_large_map_is_located_not_merely_reported</c>,
    /// whose break is planted at entry 1 337 precisely so a parser that reported position only near the
    /// start of a document would fail it.</para>
    ///
    /// <para><b>Valid JSON that is not a declaration is an error, not a null success.</b> <c>"null"</c>
    /// parses without throwing and deserialises to a null reference, so catching
    /// <see cref="JsonException"/> alone would return <see langword="true"/> with a null
    /// <paramref name="decl"/> — and every caller trusting the boolean would dereference it. Checked
    /// explicitly.</para>
    ///
    /// <para>Uses <see cref="HmiContractJson.Options"/>, never a fresh <c>JsonSerializerOptions</c>: the
    /// naming policy and null-handling that every other HMI contract producer already uses, so a document
    /// this parser accepts is a document the rest of the pipeline reads the same way.</para>
    /// </remarks>
    public static bool TryParse(string json, out TagMapDeclaration? decl, out string? error)
    {
        decl = null;
        error = null;

        if (string.IsNullOrWhiteSpace(json))
        {
            error = "the tag map document is empty.";
            return false;
        }

        TagMapDeclaration? parsed;
        try
        {
            parsed = JsonSerializer.Deserialize<TagMapDeclaration>(json, HmiContractJson.Options);
        }
        catch (JsonException ex)
        {
            error = Describe(ex);
            return false;
        }

        if (parsed is null)
        {
            // Reached by the literal `null` document: valid JSON, no exception, no declaration.
            error = "the tag map document parsed to no declaration (was it the literal `null`?).";
            return false;
        }

        // Shape normalisation, not safety: an omitted `entries` array deserialises to a genuine null —
        // C#'s non-nullable annotation does not survive System.Text.Json on a missing field, the mechanism
        // behind two HIGH findings in WS-HMI-0b — and a null list is a NullReferenceException waiting in
        // whichever consumer forgets. A declaration with no entries is VALID (§5-bis) and now also safe to
        // enumerate.
        decl = parsed.Entries is null ? parsed with { Entries = Array.Empty<TagMapEntry>() } : parsed;
        return true;
    }

    /// <summary>Turns a <see cref="JsonException"/> into a sentence an engineer can act on. Every
    /// coordinate the exception carries is included and each is guarded: <c>LineNumber</c>,
    /// <c>BytePositionInLine</c> and <c>Path</c> are all nullable, and a message that printed "line " with
    /// nothing after it would be worse than omitting it.
    ///
    /// <para>🔴 <b>Reported 1-BASED, and <see cref="JsonException"/>'s own trailing coordinates are
    /// stripped rather than passed through.</b> System.Text.Json counts lines and columns from ZERO and
    /// appends its own <c>" Path: … | LineNumber: … | BytePositionInLine: …"</c> to the message. Forwarding
    /// that verbatim produced a sentence carrying TWO different line numbers for one error — measured:
    /// <c>"…at line 1342, position 41, path $.entries[1337]: … | LineNumber: 1341 | …"</c> — and an
    /// engineer reading it has to guess which is the line their editor will show. Editors are 1-based, so
    /// the human-facing numbers are 1-based and the machine's duplicate tail is cut. Nothing is lost: the
    /// explanatory half of the message is kept whole, and the coordinates it removes are the ones already
    /// stated, more usefully, at the front.</para></summary>
    private static string Describe(JsonException ex)
    {
        var where = new List<string>(3);
        if (ex.LineNumber is { } line) where.Add($"line {line + 1}");
        if (ex.BytePositionInLine is { } pos) where.Add($"position {pos + 1}");
        if (!string.IsNullOrEmpty(ex.Path)) where.Add($"path {ex.Path}");

        // Cut System.Text.Json's own 0-based coordinate tail; keep its explanation of WHAT is wrong.
        var reason = ex.Message;
        var tail = reason.IndexOf(" Path: ", StringComparison.Ordinal);
        if (tail >= 0) reason = reason[..tail].TrimEnd();

        return where.Count == 0
            ? $"the tag map document is not valid JSON: {reason}"
            : $"the tag map document is not valid JSON at {string.Join(", ", where)}: {reason}";
    }
}
