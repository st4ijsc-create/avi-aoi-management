using St4i.Hmi.Contracts;

namespace St4i.EngineApi.HmiModel;

/// <summary>The outcome of one ingestion attempt. <paramref name="Errors"/> carries EVERY reason the
/// attempt failed, never just the first — a §5-violating declaration typically breaks several rules at once
/// and an operator fixing them one restart at a time is the cost of reporting only one.</summary>
/// <param name="Ok"><see langword="true"/> only when the namespace this call was asked to produce is the
/// namespace now stored. A no-op (a connector that declares no tag map) is also <see langword="true"/>:
/// nothing failed.</param>
/// <param name="TagCount">Tags in the stored document. Zero on every failure, and zero for a connector with
/// no tag map.</param>
/// <param name="BackedCount">How many of those tags <see cref="DriverTagSupport"/> says are really driver-
/// backed. Never larger than <paramref name="TagCount"/>, and the gap between the two is the honest measure
/// of how much of a declaration is decoration.</param>
public sealed record IngestResult(bool Ok, int TagCount, int BackedCount, IReadOnlyList<string> Errors);

/// <summary>
/// WS-HMI-0c Task 4 — the door a connector's tag map comes through: parse, compile, validate, store.
///
/// <para><b>The store arrives by DI and is never constructed here (ruling S-3).</b> WS-HMI-0b closed
/// machine-code identity structurally: <see cref="ITagNamespaceStore"/> resolves ONLY to
/// <c>CanonicalizingTagNamespaceStore</c>, and the raw <c>TagNamespaceStore</c> is a <c>Program.cs</c> local
/// that is deliberately never registered, so no component can obtain the case-sensitive-keyed store even by
/// asking for it by type. Ingestion is the door that writes most; a store constructed here would bypass
/// every canonicalisation guarantee that cost five fix rounds to build, and it would do so silently.</para>
///
/// <para><b>Order: parse → identity → build → validate-and-save.</b> A failure at any step returns
/// <c>Ok: false</c> and leaves the stored namespace exactly as it was.
/// <see cref="ITagNamespaceStore.PutAsync"/> is reached only on the last step, and validation lives INSIDE
/// it (<c>TagNamespaceStore.PutAsync</c> calls <see cref="ContractInvariants.ThrowIfInvalid(TagNamespaceDocument)"/>
/// before it opens a connection), which is deliberate: §5 is enforced once, at the door every caller passes,
/// rather than a second time here where the two copies could drift. <b>The precise consequence, because
/// "does not touch the store" and "validates via the store" cannot both be literally true of the same
/// step:</b> a §5 violation DOES call <c>PutAsync</c> and the call throws before any write, so the store is
/// entered but the namespace is unchanged. Every earlier failure never reaches <c>PutAsync</c> at all. Both
/// halves are pinned by probe.</para>
///
/// <para><b>A failed reload must never wipe a working namespace.</b> That is the property this ordering
/// exists to guarantee and the one worth restating: a machine whose tag map an operator has just broken
/// keeps the screen it had. Losing a working namespace to a bad edit is strictly worse than refusing the
/// edit, because the refusal is recoverable and the machine stays usable while it is being fixed.</para>
///
/// <para><b>An absent tag map is not an empty one.</b> A connector that declares no map at all is valid
/// (§5-bis) and contributes nothing — it does not reach the store, so it cannot overwrite a namespace some
/// other source already put there. A declaration that is PRESENT and declares zero entries is a different
/// statement — "this machine has no tags" — and is stored, replacing whatever was there. Absence is not a
/// claim; an empty declaration is.</para>
///
/// <para>This class never throws for an ingestion failure and never logs: it reports. The swallow that
/// keeps a bad map from taking a machine down lives at the call site in <c>Program.cs</c>, where the
/// logger is, and is documented there.</para>
/// </summary>
public sealed class TagIngestionService
{
    /// <summary>
    /// The folder, beside the binary, the composition root reads tag maps from — one
    /// <c>{machineCode}.json</c> per machine, a sibling of <c>connectors.json</c> and <c>fleet.json</c>.
    /// A constant rather than a literal in <c>Program.cs</c> so the convention has one spelling and a test
    /// can name it.
    ///
    /// <para>🔴 <b>This class never reads that folder</b> — it is handed a document string. Ingestion is a
    /// no-op until an operator creates the folder, which is what keeps this task's startup change
    /// byte-identical for every existing deployment.</para>
    ///
    /// <para>🔴 <b>BESIDE THE BINARY WITH NO RELOCATION VARIABLE, WHICH IS A DELIBERATE PAIR — my first
    /// version got this wrong and two guards caught it.</b> I first gave it BOTH a
    /// <c>ST4I_HMI_TAGMAPS_DIR</c> variable AND a beside-the-binary default.
    /// <c>PerHostDataRootsTests.TheBesideTheBinaryStorePopulation_IsEmpty_…</c> and
    /// <c>TestHarnessIsolationTests</c> both refused it, and they were right: BF-1's rule is that a
    /// directory which HAS a relocation variable must be derivable from the machine-wide root. That left
    /// two coherent shapes, and this is the one with a precedent — <c>connectors.json</c> and
    /// <c>fleet.json</c> are operator-authored input beside the binary with no variable, which is a
    /// category <c>PerHostDataRootsTests</c> already names ("READS ONLY — operator-authored input beside
    /// the binary; a shared copy is the intent").
    ///
    /// <para>The alternative — a nineteenth machine-wide root under <c>%ProgramData%\ST4I\sim</c> — was
    /// built and then reverted. It works, and it survives an upgrade, which this shape does NOT: a publish
    /// replaces the directory beside the binary, so hand-authored tag maps are lost on every upgrade
    /// exactly as a hand-edited <c>connectors.json</c> is. But it also requires a keep-versus-purge
    /// classification in <c>packaging/remove-data.ps1</c>, and that is an OWNER ruling
    /// (2026-08-23(b) is cited as one) rather than something this task may decide. Both the cost and the
    /// alternative are recorded in this task's report for the owner to rule on.</para></para>
    /// </summary>
    public const string DirectoryName = "tag-maps";

    private readonly ITagNamespaceStore _store;

    /// <param name="store">The DI-resolved <see cref="ITagNamespaceStore"/> — in this composition root that
    /// is always the canonicalising decorator. Ruling S-3: never construct one.</param>
    public TagIngestionService(ITagNamespaceStore store)
    {
        ArgumentNullException.ThrowIfNull(store);
        _store = store;
    }

    /// <summary>
    /// Ingests <paramref name="tagMapJson"/> as the tag namespace for <paramref name="machineCode"/>.
    /// </summary>
    /// <param name="machineCode">The machine the CONNECTOR REGISTRATION binds this map to. This is the
    /// authority on which machine is being written — see the identity rule below.</param>
    /// <param name="connectorDriverKind">The registered connector's kind, which decides
    /// <c>isBackedByDriver</c> together with each tag's own source (see
    /// <see cref="TagNamespaceBuilder"/>).</param>
    /// <param name="tagMapJson">The declaration document, or <see langword="null"/>/blank for a connector
    /// that declares no map.</param>
    /// <remarks>
    /// <para>🔴 <b>WHEN THE DECLARATION AND THE BINDING DISAGREE ABOUT THE MACHINE (ruling S-5).</b> The
    /// declaration carries a <c>machineCode</c> and so does the registration that triggered this call. The
    /// rule is the one <c>HmiTagEndpoints.PutAsync</c> and <c>HmiModelEndpoints.PutAsync</c> already use for
    /// route-versus-body, matched here rather than invented afresh: <b>fill the identity in when the
    /// declaration omits it, REFUSE when it names a materially different machine.</b>
    ///
    /// <para>Refusing is the fail-closed choice and both silent alternatives are worse. Writing under the
    /// BINDING's code would attach one machine's tag map to another machine — an operator reads real-looking
    /// tags belonging to a different device. Writing under the DECLARATION's code would let a connector
    /// registered for machine A silently replace the namespace of an unrelated, possibly running machine B,
    /// which is WS-HMI-0b Task 1's HIGH-1 one layer up: there a <c>PUT /v1/tags/INTENDED</c> carrying
    /// <c>body.machineCode = "VICTIM"</c> overwrote VICTIM's entire namespace while reporting success.</para>
    ///
    /// <para>"Materially different" is decided by <see cref="MachineCodeIdentity.SameIdentity"/>, the one
    /// place this seam defines machine-code identity, so <c>aoi-01</c> and <c>AOI-01</c> are the SAME
    /// machine and are not refused — refusing on a spelling difference would reject correct configurations
    /// and teach operators that the check is noise. <see cref="TagMapDeclaration.CanonicalMachineCode"/>'s
    /// doc comment requires exactly this: use the canonical form for any same-machine comparison, never the
    /// raw field.</para></para>
    /// </remarks>
    public async Task<IngestResult> IngestAsync(
        string machineCode,
        string? connectorDriverKind,
        string? tagMapJson,
        CancellationToken ct = default)
    {
        // §5-bis. Absence is not a declaration, so it neither fails nor writes — in particular it cannot
        // erase a namespace another source (an engineer's PUT /v1/tags) already established for this
        // machine. Returning before the store is touched is the whole of that guarantee.
        if (string.IsNullOrWhiteSpace(tagMapJson))
        {
            return new IngestResult(Ok: true, TagCount: 0, BackedCount: 0, Errors: Array.Empty<string>());
        }

        if (!TagMapDeclaration.TryParse(tagMapJson, out var declaration, out var parseError))
        {
            return Failed(parseError ?? "the tag map document could not be parsed.");
        }

        // The identity rule. Before the build, so a map belonging to another machine is refused without
        // ever being compiled into a document that could be stored by a later edit to this method.
        if (!string.IsNullOrWhiteSpace(declaration!.MachineCode) &&
            // 🔴 LOW-5 — through TagMapDeclaration.CanonicalMachineCode(), which until this fix round had
            // ZERO production callers. Ruling S-5 looked closed because the method existed and its doc
            // comment said "Tasks 2 and 4 must call this for any same-machine comparison" — and Task 4
            // honoured the RULE (it compared canonical identities) while calling MachineCodeIdentity
            // directly, so what shipped was an uncalled method with an instruction nobody had followed.
            // That is the computed-but-unconsumed shape both the Task 2 and Task 3 reports named for their
            // own types, sitting unnoticed one file away. Canonicalize is idempotent, so passing an
            // already-canonical string to SameIdentity is exact, not merely harmless.
            !MachineCodeIdentity.SameIdentity(declaration.CanonicalMachineCode(), machineCode))
        {
            return Failed(
                $"the tag map declares machineCode '{declaration.MachineCode}' but the connector that " +
                $"supplied it is bound to machine '{machineCode}'. Refusing rather than guessing which one " +
                "is right: writing it under either code would silently give one machine another machine's " +
                "tags. Correct the declaration or the connector binding so the two agree.");
        }

        // Adopt the binding's spelling, the same way the PUT routes adopt the route's. The two are already
        // the same IDENTITY at this point, and the store canonicalises on write, so this is about the
        // document saying what the registration says rather than about where it lands.
        var document = TagNamespaceBuilder.Build(declaration, connectorDriverKind) with { MachineCode = machineCode };

        try
        {
            // Validation happens INSIDE this call and throws before anything is written. See the class doc
            // comment for why §5 is not also checked here.
            await _store.PutAsync(document, ct).ConfigureAwait(false);
        }
        catch (ContractViolationException ex)
        {
            // EVERY violation, not the first: ContractViolationException.Violations is the full list
            // ContractInvariants.Validate collected.
            return new IngestResult(Ok: false, TagCount: 0, BackedCount: 0, Errors: ex.Violations);
        }
        catch (Exception ex)
        {
            // Total, deliberately. WS-HMI-0b Task 2 fix round 3 found a narrow `catch (SqliteException)`
            // turning a handled 409 back into a 500 because an unrelated JsonException escaped it; the
            // property to close is "no store failure escapes this method", not "these named failures do
            // not". A caller cannot act on the difference anyway: every outcome here is "the namespace was
            // not replaced", and the namespace is unchanged in all of them.
            return Failed($"the tag namespace could not be stored: {ex.Message}");
        }

        return new IngestResult(
            Ok: true,
            TagCount: document.Tags.Count,
            BackedCount: document.Tags.Count(t => t.IsBackedByDriver),
            Errors: Array.Empty<string>());
    }

    private static IngestResult Failed(string error) =>
        new(Ok: false, TagCount: 0, BackedCount: 0, Errors: new[] { error });
}

/// <summary>
/// WS-HMI-0c Task 4 — the startup loop that reads the tag-map folder and feeds
/// <see cref="TagIngestionService"/>, extracted from <c>Program.cs</c> so it can be tested.
///
/// <para>🔴 <b>WHY IT IS A TYPE AND NOT TEN LINES IN THE COMPOSITION ROOT.</b> It WAS ten lines in
/// <c>Program.cs</c>, and the Task 4 sweep measured what that cost: removing the swallow reddened nothing
/// (row P2) and typo-ing the folder name reddened nothing (row P3), because no test could reach a loop that
/// resolved its own directory from <c>AppContext.BaseDirectory</c> — the shared artifact directory this
/// repository's D-1 review (I-3) records as racing the whole suite. That is the same hole, with the same
/// cause and the same fix, that D-1 found when a ~40-line connectors.json dispatch lived inside a DI lambda
/// where no test could reach it; <c>ConnectorsJsonRegistration</c> is that extraction and this is its
/// twin. Taking the directory as a PARAMETER is the whole of the fix: a test passes a temp folder.</para>
/// </summary>
public static class TagMapStartupIngestion
{
    /// <summary>The folder tag maps are read from in a real run: <c>tag-maps/</c> beside the binary. Kept
    /// separate from <see cref="IngestAll"/> so the loop takes a directory a test can choose, while the
    /// production path still has exactly one place that decides where that directory is.</summary>
    public static string ResolveDirectory() =>
        Path.Combine(AppContext.BaseDirectory, TagIngestionService.DirectoryName);

    /// <summary>
    /// Ingests one <c>{machineCode}.json</c> per bound connector, and returns how many succeeded.
    /// </summary>
    /// <param name="directory">Where the maps live. An absent directory is the ordinary state of an install
    /// that has never declared one, and yields zero ingestions and no error.</param>
    /// <param name="bindings">The connector bindings, as
    /// <c>ConnectorRegistry.SnapshotBindings()</c> reports them, paired with each instance's kind. Passed
    /// as data rather than as the registry so this type needs no <c>St4i.EdgeCore</c> type in its
    /// signature and a test needs no registry to drive it.</param>
    /// <remarks>
    /// 🔴 <b>THE SWALLOW, AND WHAT IT COSTS.</b> This is one of exactly TWO places in this workstream that
    /// swallow an exception; the other is <c>AssetRegistryStore.UpsertAsync</c>, and the reasoning is
    /// identical: a machine must still RUN when its HMI namespace is broken. By the time this runs the
    /// connector is registered, polling a real device and writing historian rows — letting a malformed JSON
    /// file abort startup would take a working production line down over a screen definition.
    ///
    /// <para><b>THE PRICE, stated plainly rather than left to be discovered:</b> an operator whose tag map
    /// is malformed gets a machine that runs and a screen that never appears, and the only trace is a log
    /// line. Nothing in the UI says the map was refused — <c>GET /v1/tags</c> returns the previous
    /// namespace or an empty one, indistinguishable from a machine nobody has declared tags for. The cheap
    /// way to close that, NOT built here because it is a contract change: carry the last
    /// <see cref="IngestResult"/> per machine and expose it on the tag-namespace response or
    /// <c>GET /v1/capabilities</c>, so the refusal reaches somebody already looking.</para>
    /// </remarks>
    public static int IngestAll(
        string directory,
        IReadOnlyList<(string InstanceId, string? MachineCode, string? DriverKind)> bindings,
        TagIngestionService service,
        ILogger logger)
    {
        ArgumentNullException.ThrowIfNull(bindings);
        ArgumentNullException.ThrowIfNull(service);
        ArgumentNullException.ThrowIfNull(logger);

        var maps = IndexMapFiles(directory, logger);
        var ingested = 0;

        foreach (var (instanceId, machineCode, driverKind) in bindings)
        {
            // An UNBOUND connector names no machine, so there is no namespace to attach a map to. Skipping
            // is not a failure: the connector runs, it simply has no HMI identity to declare tags for.
            if (string.IsNullOrWhiteSpace(machineCode)) continue;

            try
            {
                if (!maps.TryGetValue(MachineCodeIdentity.Canonicalize(machineCode), out var path))
                {
                    // §5-bis — a connector that declares no tag map is VALID. It contributes nothing, and
                    // in particular does not reach the store, so it cannot erase a namespace an engineer
                    // already established for this machine through PUT /v1/tags.
                    continue;
                }

                var result = service.IngestAsync(machineCode, driverKind, File.ReadAllText(path))
                    .GetAwaiter().GetResult();

                if (result.Ok)
                {
                    ingested++;
                    logger.LogInformation(
                        "Machine '{MachineCode}': ingested {TagCount} tag(s) from '{TagMapPath}', {BackedCount} of " +
                        "them backed by a real driver.", machineCode, result.TagCount, path, result.BackedCount);
                }
                else
                {
                    // EVERY violation on one line, because an operator told about one of five errors fixes
                    // the file five restarts in a row.
                    logger.LogError(
                        "Machine '{MachineCode}': tag map '{TagMapPath}' was REFUSED and the previously stored HMI " +
                        "namespace for this machine is UNCHANGED. The connector is registered and the machine runs " +
                        "normally; only its HMI screen is affected. {ViolationCount} problem(s): {Violations}",
                        machineCode, path, result.Errors.Count, string.Join(" | ", result.Errors));
                }
            }
            catch (Exception ex)
            {
                // 🔴 THE SWALLOW. See the remarks above for why it exists and what it costs. Total, and
                // deliberately so: IngestAsync already converts every failure it can foresee into a result,
                // so anything arriving here is unforeseen — an I/O error reading the file, a permission
                // change mid-boot — and the one thing that must not happen is that it reaches the host and
                // stops a line.
                logger.LogError(ex,
                    "Machine '{MachineCode}': HMI tag ingestion failed unexpectedly and was skipped. The connector " +
                    "is registered and the machine runs normally; its HMI namespace is unchanged.", machineCode);
            }
        }

        return ingested;
    }

    /// <summary>
    /// Enumerated ONCE and keyed by canonical machine code rather than probed with
    /// <c>Path.Combine(dir, code + ".json")</c> per binding. A machine code is a case-INSENSITIVE identity
    /// and file-name case sensitivity is a property of the FILESYSTEM — so a per-binding probe would find
    /// <c>aoi-01.json</c> for machine <c>AOI-01</c> on Windows and silently not find it on Linux. Same
    /// lookup on both, decided by this codebase's identity rule rather than by the volume it is installed on.
    /// </summary>
    private static Dictionary<string, string> IndexMapFiles(string directory, ILogger logger)
    {
        var maps = new Dictionary<string, string>(StringComparer.Ordinal);
        try
        {
            if (!Directory.Exists(directory)) return maps;

            foreach (var file in Directory.EnumerateFiles(directory, "*.json"))
            {
                var key = MachineCodeIdentity.Canonicalize(Path.GetFileNameWithoutExtension(file));
                if (string.IsNullOrWhiteSpace(key)) continue;

                if (!maps.TryAdd(key, file))
                {
                    logger.LogWarning(
                        "Two tag-map files in '{TagMapDir}' name the same machine '{MachineCode}' (they differ " +
                        "only in spelling); '{Winner}' is used and '{Ignored}' is ignored. Machine codes are a " +
                        "case-insensitive identity — rename one of the files.",
                        directory, key, maps[key], file);
                }
            }
        }
        catch (Exception ex)
        {
            // An unreadable directory disables tag ingestion for this run and nothing else. Same "one bad
            // source disables only itself" posture every other startup config load has.
            logger.LogError(ex,
                "Tag-map directory '{TagMapDir}' could not be listed — no HMI tag namespace is ingested this run. " +
                "Every connector still registers and every machine still runs.", directory);
        }

        return maps;
    }
}
