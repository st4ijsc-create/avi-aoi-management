using St4i.Connector.Abstractions.Models;
using St4i.Hmi.Contracts;

namespace St4i.EngineApi.HmiModel;

/// <summary>
/// WS-HMI-0c Task 2 — compiles a connector's <see cref="TagMapDeclaration"/> into the
/// <see cref="TagNamespaceDocument"/> the HMI actually serves.
///
/// <para>The compilation itself is almost a copy: a <see cref="TagMapEntry"/> is field-for-field a
/// <see cref="TagDescriptor"/> minus one flag. That one flag is the entire reason this type exists.</para>
///
/// <para><b><c>isBackedByDriver</c> is computed here, never carried.</b> It is the word an operator reads
/// as "this number came off the machine", and Task 1 deliberately left it out of the declaration so a
/// connector could not assert it about itself. The blueprint's lesson block records what the alternative
/// looks like: <c>dispense_program</c> and <c>weld_profile</c> were declared in full, domain-checked,
/// persisted and served over a real route for months, and nothing read them. Every mechanical signal was
/// green the whole time. A flag copied from a declaration has exactly that shape — faithfully carried, and
/// still a claim nobody checked.</para>
///
/// <para><b>Two conditions, both necessary, and the second is a decision this task made — see the Task 2
/// report.</b> A tag is reported as driver-backed only when BOTH hold:</para>
/// <list type="number">
/// <item><description><see cref="DriverTagSupport.CanBack"/> says this build can construct a connector of
/// <c>driverKind</c> at all. This is the brief's proposition 3: a kind with no address-read path yields
/// <see langword="false"/> <b>however complete the declaration is</b> — a thousand perfectly-formed Modbus
/// registers do not create a driver.</description></item>
/// <item><description>the tag's own <see cref="TagSource.Kind"/> names that same connector kind. The
/// frozen schema's source union has five arms — <c>modbus</c>, <c>opcua</c>, <c>mqtt</c>,
/// <c>simulated</c>, <c>derived</c> — so a document may legally pair a Modbus connector with a
/// <c>derived</c> tag (a value computed from an expression) or a <c>simulated</c> one (a value
/// manufactured outright). Neither is read off a device by any driver, and reporting either as
/// driver-backed because the CONNECTOR happens to be a Modbus one would be precisely the false claim this
/// type exists to prevent. It also refuses the incoherent pairing — an <c>opcua</c> nodeId declared on a
/// Modbus connector — in the fail-closed direction, because a Modbus driver cannot read a node
/// id.</description></item>
/// </list>
///
/// <para><b>The second condition needs no new lookup table, which is why it is safe to add.</b> The
/// schema's source kinds are the lowercase spellings of the driver kinds they name, and
/// <see cref="DriverKinds.Normalize"/> already folds case-insensitively against the five built-ins — so
/// <c>"modbus"</c> folds to <see cref="DriverKinds.Modbus"/> and compares equal to a <c>Modbus</c>
/// connector with no table of mine in between. <c>"derived"</c> is the one source kind naming no driver at
/// all; it matches no built-in, is returned byte-for-byte unchanged, and therefore can never equal a
/// connector kind. A hand-written source→driver map would have been a second statement of a fact
/// <see cref="DriverKinds"/> already owns, and the version that drifted would have been mine.</para>
///
/// <para><b>What this type does NOT do, deliberately.</b> It performs no §5 safety work: an entry with
/// <c>access: "rw"</c> and no <c>policyAction</c> compiles here and is refused at the write door by
/// <see cref="ContractInvariants"/>, which every caller passes through including the many that never touch
/// this builder. It does not interpret <c>policyAction</c> at all — the value is copied verbatim and no
/// authorisation decision is derived from it here (WS-HMI-0c carry-forward S-6 therefore remains open at
/// this layer, and the Task 2 report says so rather than implying it was closed). It does not rewrite
/// units; that is <c>MappingProfile</c>'s layer answering a different question. And it does not
/// canonicalise <see cref="TagMapDeclaration.MachineCode"/> — see below.</para>
///
/// <para><b>Machine code passes through verbatim (ruling S-5).</b>
/// <see cref="TagMapDeclaration.CanonicalMachineCode"/>'s own doc comment instructs this task to use the
/// canonical form for grouping and same-machine comparison and never to compare the raw field — and this
/// builder makes no such comparison, so it makes no such call. Canonicalisation of the stored document is
/// owned structurally by WS-HMI-0b's <c>CanonicalizingTagNamespaceStore</c>, which rewrites
/// <c>doc.MachineCode</c> and the storage key on every <c>PutAsync</c>. Doing it here as well would put one
/// identity rule in two places, which is the objection Task 1 already made about this same field.
/// <b>The residue, named rather than left to be found:</b> a caller that serves a built document WITHOUT
/// going through that store hands out the engineer's raw spelling. Nothing in this task does that, and
/// nothing here prevents it.</para>
/// </summary>
public static class TagNamespaceBuilder
{
    /// <summary>
    /// Compiles <paramref name="declaration"/> into a namespace document, deciding
    /// <see cref="TagDescriptor.IsBackedByDriver"/> for each tag from
    /// <paramref name="connectorDriverKind"/> and the tag's own source.
    /// </summary>
    /// <param name="declaration">The connector's declaration. Its <c>machineCode</c> and
    /// <c>schemaVersion</c> are carried into the result unchanged; a <see langword="null"/> or empty
    /// <c>entries</c> list yields an EMPTY, VALID document rather than <see langword="null"/> or an
    /// exception (§5-bis — a machine that has declared nothing is a real product state, not an error).</param>
    /// <param name="connectorDriverKind">The kind of the connector that supplied the declaration. A
    /// <see langword="null"/>, blank or unrecognised kind backs nothing, which is the fail-closed
    /// direction: the harmful mistake is telling an operator a manufactured number is real.</param>
    public static TagNamespaceDocument Build(TagMapDeclaration declaration, string? connectorDriverKind)
    {
        ArgumentNullException.ThrowIfNull(declaration);

        // Asked ONCE for the document rather than per tag: the answer cannot vary between two tags of one
        // connector, and asking per tag would invite a later edit that made it look as though it could.
        var thisKindCanBackAnything = DriverTagSupport.CanBack(connectorDriverKind);
        var connectorKind = DriverKinds.Normalize(connectorDriverKind ?? string.Empty);

        // Task 1 normalises a missing `entries` to empty on parse, but Build is public and a
        // hand-constructed declaration can still carry a genuine null here. §5-bis is answered the same way
        // either way.
        var entries = declaration.Entries ?? Array.Empty<TagMapEntry>();

        var tags = new List<TagDescriptor>(entries.Count);
        foreach (var entry in entries)
        {
            tags.Add(new TagDescriptor(
                entry.Path,
                entry.DataType,
                entry.Unit,
                entry.EngMin,
                entry.EngMax,
                entry.EnumValues,
                entry.Access,
                entry.PolicyAction,
                entry.Source,
                IsBackedByDriver: thisKindCanBackAnything && SourceNamesTheConnectorsOwnKind(entry.Source, connectorKind)));
        }

        return new TagNamespaceDocument(declaration.SchemaVersion, declaration.MachineCode, tags);
    }

    /// <summary>
    /// Whether this tag's declared source is one the connector's own driver reads, decided by folding the
    /// source kind through <see cref="DriverKinds.Normalize"/> — the one place this codebase decides that
    /// two spellings of a built-in id are the same id — and comparing it to the connector's kind.
    ///
    /// <para>A <see langword="null"/> source answers <see langword="false"/>. Task 1 preserves a missing
    /// <c>source</c> as null rather than inventing one, so this is reachable; a tag that says nothing about
    /// where its value comes from is not a tag anything is known to back.</para>
    /// </summary>
    private static bool SourceNamesTheConnectorsOwnKind(TagSource? source, string normalizedConnectorKind)
        => source is not null
           && string.Equals(
               DriverKinds.Normalize(source.Kind ?? string.Empty),
               normalizedConnectorKind,
               StringComparison.Ordinal);
}
