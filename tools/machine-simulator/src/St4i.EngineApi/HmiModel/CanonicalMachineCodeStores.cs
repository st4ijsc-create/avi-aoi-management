using St4i.Hmi.Contracts;

namespace St4i.EngineApi.HmiModel;

/// <summary>
/// WS-HMI-0b Task 1, fix round 3 (HIGH-A, closed structurally). Rounds 1 and 2 each normalised a machine
/// code inside <c>HmiModelEndpoints.PutAsync</c> alone — round 1 reconciled the route against the body,
/// round 2 made that reconciliation survive a case-only difference. Both were PER-HANDLER: the fix lived
/// inside one method, so the other three handlers that hand a machine code to
/// <see cref="IComponentModelStore"/> (<c>GetAsync</c>, <c>GetIntegrityAsync</c>, and transitively
/// <c>ITagNamespaceStore.GetAsync</c>) never got it, and re-review #2 measured the exact original failure
/// through the route instead of the body: two PUTs at differing route case landed on two SQLite rows,
/// hid each other's edits, and <c>GET /v1/components/{variant}/integrity</c> — an Operator-tier route —
/// returned a clean bill of health for a document it had never read.
///
/// <para><b>THIS is the structural answer, not a fifth per-handler patch.</b> <see cref="ComponentModelStore"/>
/// keys <c>machine_code TEXT PRIMARY KEY</c> with no <c>COLLATE NOCASE</c> — case-sensitive — and that
/// file is one of WS-HMI-0a's two frozen stores this task's constraints forbid touching, so the identity
/// mismatch cannot be closed by changing the storage layer's own collation. Instead, every machine code is
/// canonicalised at the ONE seam every current and future caller shares: the <see cref="IComponentModelStore"/>/
/// <see cref="ITagNamespaceStore"/> DI registration in <c>Program.cs</c> hands out ONLY these decorators —
/// never the raw <see cref="ComponentModelStore"/>/<see cref="TagNamespaceStore"/> — so a handler cannot
/// reach the case-sensitive store without going through <see cref="MachineCodeIdentity.Canonicalize"/>
/// first, REGARDLESS of whether that handler exists today or is written next month. This is what makes the
/// property "no fifth path can be added without normalising" true by construction rather than by
/// convention: there is no code path in this composition root that would ever hand a raw store to an HTTP
/// handler. <c>HmiModelWiringTests</c>-style DI-resolution assertions in
/// <c>HmiModelEndpointsTests.cs</c> pin that the decorators, not the raw stores, are what
/// <c>IComponentModelStore</c>/<c>ITagNamespaceStore</c> resolve to.</para>
///
/// <para><b>The identity rule, restated precisely because rounds 1 and 2 each stated a version of it that
/// was not yet true everywhere:</b> a machine code is a case-INSENSITIVE identity, and its ONE canonical
/// persisted spelling is <c>ToUpperInvariant()</c> of whatever was first written — chosen (over, say,
/// lower-casing) only because every fixture and every existing machine code in this codebase is already
/// upper-cased (<c>AOI-01</c>, <c>SCRW-01</c>, ...); there is no deeper reason than matching the ambient
/// convention. Applied to EVERY machine code this seam sees, on EVERY call — <c>PutAsync</c>'s document,
/// and every read's route-derived parameter — so two spellings of one identity can never diverge into two
/// rows no matter which handler, which HTTP verb, or which of body/route supplied which spelling.</para>
///
/// <para><b>What this does NOT canonicalise, named rather than left to be assumed:</b> a tag <c>path</c>
/// (<see cref="ITagNamespaceStore.FindTagAsync"/>'s parameter) is a DIFFERENT identity from a machine code
/// — <see cref="ContractInvariants"/>'s own duplicate-path rule and <c>ModelIntegrity.IsPathPrefix</c> both
/// already treat it as ordinal/case-sensitive by design, and nothing in this task's findings asked that to
/// change. Only the <c>machineCode</c>/<c>doc.MachineCode</c> identity is in scope here.</para>
/// </summary>
internal static class MachineCodeIdentity
{
    /// <summary>The ONE canonicalisation rule for machine-code identity across this store seam:
    /// <c>Trim().ToUpperInvariant()</c>. A null/blank input is returned UNCHANGED (never coerced to
    /// <c>""</c> or thrown on) — a blank machine code is <see cref="ContractInvariants"/>'s violation to
    /// report, not this method's job to paper over or reject.</summary>
    public static string Canonicalize(string? machineCode) =>
        string.IsNullOrWhiteSpace(machineCode) ? machineCode! : machineCode.Trim().ToUpperInvariant();
}

/// <summary>Canonicalises every machine code before it reaches the case-sensitive <see cref="ComponentModelStore"/>
/// — see this file's own top-level doc comment for the full rationale. Wraps rather than replaces: WS-HMI-0a's
/// store is untouched, this is composition, not modification.</summary>
internal sealed class CanonicalizingComponentModelStore : IComponentModelStore
{
    private readonly IComponentModelStore _inner;

    public CanonicalizingComponentModelStore(IComponentModelStore inner) => _inner = inner;

    public Task PutAsync(ComponentModelDocument doc, CancellationToken ct = default) =>
        _inner.PutAsync(doc with { MachineCode = MachineCodeIdentity.Canonicalize(doc.MachineCode) }, ct);

    public Task<ComponentModelDocument?> GetAsync(string machineCode, CancellationToken ct = default) =>
        _inner.GetAsync(MachineCodeIdentity.Canonicalize(machineCode), ct);

    public Task<IReadOnlyList<string>> ListMachineCodesAsync(CancellationToken ct = default) =>
        _inner.ListMachineCodesAsync(ct);
}

/// <summary>The <see cref="ITagNamespaceStore"/> twin of <see cref="CanonicalizingComponentModelStore"/> —
/// same rationale, same rule, same reason it exists NOW even though <c>PUT /v1/tags/{machineCode}</c> is
/// WS-HMI-0b Task 2's job, not this one's: <c>HmiModelEndpoints.PutAsync</c>/<c>GetIntegrityAsync</c>
/// already call <see cref="ITagNamespaceStore.GetAsync"/> with a route-derived machine code today, so the
/// SAME case-variant miss (a real namespace, invisible to an integrity check addressed by a different
/// spelling) is reachable in THIS task, not only in Task 2's future write path.</summary>
internal sealed class CanonicalizingTagNamespaceStore : ITagNamespaceStore
{
    private readonly ITagNamespaceStore _inner;

    public CanonicalizingTagNamespaceStore(ITagNamespaceStore inner) => _inner = inner;

    public Task PutAsync(TagNamespaceDocument doc, CancellationToken ct = default) =>
        _inner.PutAsync(doc with { MachineCode = MachineCodeIdentity.Canonicalize(doc.MachineCode) }, ct);

    public Task<TagNamespaceDocument?> GetAsync(string machineCode, CancellationToken ct = default) =>
        _inner.GetAsync(MachineCodeIdentity.Canonicalize(machineCode), ct);

    // path is a tag path, not a machine code — a different identity this fix is not in scope to change
    // (see this file's own top-level doc comment). Passed through unchanged.
    public Task<TagDescriptor?> FindTagAsync(string path, CancellationToken ct = default) =>
        _inner.FindTagAsync(path, ct);
}
