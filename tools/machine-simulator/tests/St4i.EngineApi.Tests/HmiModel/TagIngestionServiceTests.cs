using System.Text.Json;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Logging.Abstractions;
using St4i.Connector.Abstractions.Models;
using St4i.EngineApi.HmiModel;
using St4i.Hmi.Contracts;
using Xunit;

namespace St4i.EngineApi.Tests.HmiModel;

/// <summary>
/// WS-HMI-0c Task 4 — the ingestion door.
///
/// <para><b>What these tests do NOT measure:</b> (1) they do NOT measure that a driver reads any address —
/// no device, no session, no register is involved anywhere in this file; the flag they check is
/// <c>DriverTagSupport</c>'s statement about a KIND, and Task 3 owns that boundary. (2) They do NOT
/// re-implement §5 — every violation asserted here is one <c>ContractInvariants</c> produced, reached
/// through the real store, because a second statement of that rule in this file is exactly the drift the
/// rule's single-site design exists to prevent. (3) They do NOT measure the HTTP surface: no route is
/// mapped, no request is made; <c>GET /v1/tags</c> is <c>HmiTagEndpointsTests</c>' subject. (4) They do NOT
/// measure the <c>Program.cs</c> startup wiring — see <c>TagIngestionWiringTests</c> for the composition
/// root, and the swallow that protects connector registration lives there, not here.</para>
///
/// <para>The store used throughout is a REAL <c>TagNamespaceStore</c> behind the REAL
/// <c>CanonicalizingTagNamespaceStore</c> — the same pair DI hands out — because the central proposition
/// ("a failed reload leaves the running namespace intact") is a statement about what is on disk, and a
/// hand-written fake asserting it would be certifying itself.</para>
/// </summary>
public sealed class TagIngestionServiceTests : IDisposable
{
    private readonly List<string> _tempDirs = new();

    private string TempDir()
    {
        var dir = Path.Combine(Path.GetTempPath(), "st4i-ingest-tests", Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(dir);
        _tempDirs.Add(dir);
        return dir;
    }

    /// <summary>The real pair DI resolves: the canonicalising decorator over the real SQLite store.</summary>
    private ITagNamespaceStore RealStore() => new CanonicalizingTagNamespaceStore(new TagNamespaceStore(TempDir()));

    public void Dispose()
    {
        foreach (var dir in _tempDirs)
        {
            try { Directory.Delete(dir, recursive: true); } catch (IOException) { } catch (UnauthorizedAccessException) { }
        }
    }

    /// <summary>
    /// A PURE recorder. It counts and delegates and decides nothing — deliberately, because WS-HMI-0b's fix
    /// round 3 found a test double that had re-implemented the production predicate and was therefore
    /// certifying itself rather than the code.
    /// </summary>
    private sealed class RecordingStore : ITagNamespaceStore
    {
        private readonly ITagNamespaceStore _inner;
        public RecordingStore(ITagNamespaceStore inner) => _inner = inner;

        public int PutCalls { get; private set; }

        public Task PutAsync(TagNamespaceDocument doc, CancellationToken ct = default)
        {
            PutCalls++;
            return _inner.PutAsync(doc, ct);
        }

        public Task<TagNamespaceDocument?> GetAsync(string machineCode, CancellationToken ct = default)
            => _inner.GetAsync(machineCode, ct);

        public Task<TagDescriptor?> FindTagAsync(string path, CancellationToken ct = default)
            => _inner.FindTagAsync(path, ct);
    }

    /// <summary>Captures what the startup loop logged. A pure recorder — it decides nothing.</summary>
    private sealed class RecordingLogger : ILogger
    {
        public List<(LogLevel Level, string Message)> Entries { get; } = new();

        public IDisposable? BeginScope<TState>(TState state) where TState : notnull => null;
        public bool IsEnabled(LogLevel logLevel) => true;

        public void Log<TState>(LogLevel logLevel, EventId eventId, TState state, Exception? exception,
            Func<TState, Exception?, string> formatter)
            => Entries.Add((logLevel, formatter(state, exception)));
    }

    /// <summary>A store that fails every write, for the "an unexpected store failure is reported, not
    /// thrown" path. It decides nothing either — it always throws.</summary>
    private sealed class AlwaysFailingStore : ITagNamespaceStore
    {
        public Task PutAsync(TagNamespaceDocument doc, CancellationToken ct = default)
            => throw new InvalidOperationException("the disk is on fire");
        public Task<TagNamespaceDocument?> GetAsync(string machineCode, CancellationToken ct = default)
            => Task.FromResult<TagNamespaceDocument?>(null);
        public Task<TagDescriptor?> FindTagAsync(string path, CancellationToken ct = default)
            => Task.FromResult<TagDescriptor?>(null);
    }

    // -------------------------------------------------------------------------------------------------
    // Fixtures.
    // -------------------------------------------------------------------------------------------------

    private static string Map(string machineCode, params string[] tagObjects) => $$"""
        { "schemaVersion": 1, "machineCode": "{{machineCode}}", "entries": [ {{string.Join(", ", tagObjects)}} ] }
        """;

    private static string ModbusTag(string path, int register) => $$"""
        { "path": "{{path}}", "dataType": "float", "unit": "C", "engMin": 0, "engMax": 300,
          "access": "r", "source": { "kind": "modbus", "unitId": 1, "register": {{register}} } }
        """;

    /// <summary>A tag that violates §5: writable, with no <c>policyAction</c>.</summary>
    private static string WritableTagWithNoPolicy(string path) => $$"""
        { "path": "{{path}}", "dataType": "float", "unit": "C", "engMin": 0, "engMax": 300,
          "access": "rw", "source": { "kind": "modbus", "unitId": 1, "register": 1 } }
        """;

    private static string DerivedTag(string path) => $$"""
        { "path": "{{path}}", "dataType": "float", "unit": "F", "engMin": 0, "engMax": 600,
          "access": "r", "source": { "kind": "derived", "expr": "oven/temp * 1.8 + 32" } }
        """;

    private static string Json(TagNamespaceDocument? doc) =>
        doc is null ? "(absent)" : JsonSerializer.Serialize(doc, HmiContractJson.Options);

    // -------------------------------------------------------------------------------------------------
    // The happy path.
    // -------------------------------------------------------------------------------------------------

    /// <summary>
    /// Does not measure: the HTTP read surface. The document is read back through the same store seam the
    /// route would use, which is what makes this about ingestion rather than about routing.
    /// </summary>
    [Fact]
    public async Task A_valid_declaration_is_stored_and_reads_back_as_declared()
    {
        var store = RealStore();
        var service = new TagIngestionService(store);

        var result = await service.IngestAsync(
            "AOI-01", DriverKinds.Modbus, Map("AOI-01", ModbusTag("oven/temp", 40001), ModbusTag("oven/pressure", 40002)));

        Assert.True(result.Ok);
        Assert.Empty(result.Errors);
        Assert.Equal(2, result.TagCount);
        Assert.Equal(2, result.BackedCount);

        var stored = await store.GetAsync("AOI-01");
        Assert.NotNull(stored);
        Assert.Equal(new[] { "oven/temp", "oven/pressure" }, stored!.Tags.Select(t => t.Path));
        Assert.All(stored.Tags, t => Assert.True(t.IsBackedByDriver));
    }

    /// <summary>
    /// <c>BackedCount</c> is not <c>TagCount</c>. The gap is the honest measure of how much of a
    /// declaration is decoration, and a service that reported them equal would be hiding exactly what
    /// Task 3 was built to expose.
    ///
    /// <para>Does not measure: whether the derived expression is valid — nothing evaluates it.</para>
    /// </summary>
    [Fact]
    public async Task BackedCount_counts_only_the_tags_a_driver_really_backs()
    {
        var service = new TagIngestionService(RealStore());

        var result = await service.IngestAsync(
            "AOI-01", DriverKinds.Modbus, Map("AOI-01", ModbusTag("oven/temp", 40001), DerivedTag("oven/degF")));

        Assert.True(result.Ok);
        Assert.Equal(2, result.TagCount);
        Assert.Equal(1, result.BackedCount);
    }

    /// <summary>
    /// Does not measure: which kinds can back — that is <c>DriverTagSupportTests</c>. This measures only
    /// that the ingestion path asks, rather than assuming a registered connector backs everything.
    /// </summary>
    [Fact]
    public async Task A_connector_of_a_kind_that_cannot_back_stores_its_tags_as_unbacked()
    {
        var store = RealStore();
        var service = new TagIngestionService(store);

        var result = await service.IngestAsync(
            "AOI-01", DriverKinds.Simulated, Map("AOI-01", ModbusTag("oven/temp", 40001)));

        Assert.True(result.Ok);
        Assert.Equal(1, result.TagCount);
        Assert.Equal(0, result.BackedCount);
        Assert.False((await store.GetAsync("AOI-01"))!.Tags.Single().IsBackedByDriver);
    }

    // -------------------------------------------------------------------------------------------------
    // THE MOST IMPORTANT TEST: a broken reload must not take the running namespace with it.
    // -------------------------------------------------------------------------------------------------

    /// <summary>
    /// <b>A §5-violating declaration is refused, reports EVERY violation, and leaves the running namespace
    /// byte-for-byte as it was.</b> A failed reload that wipes a working namespace is worse than a failed
    /// reload: the machine loses a screen it had, and the operator now has two problems.
    ///
    /// <para>The comparison is on the serialised document rather than on the record, because
    /// <c>TagNamespaceDocument</c>'s generated equality compares its <c>Tags</c> list by REFERENCE — two
    /// reads deserialise two lists and would never be equal, so a record comparison here would pass for
    /// the wrong reason on an unchanged namespace and fail for the wrong reason on any namespace at
    /// all.</para>
    ///
    /// <para>Does not measure: §5 itself. Both violations below are produced by
    /// <c>ContractInvariants</c> inside the real store; this file asserts they arrive intact and that
    /// nothing was written, not what the rule says.</para>
    /// </summary>
    [Fact]
    public async Task A_section5_violating_declaration_is_refused_with_every_violation_and_the_running_namespace_survives()
    {
        var store = RealStore();
        var service = new TagIngestionService(store);

        await service.IngestAsync("AOI-01", DriverKinds.Modbus, Map("AOI-01", ModbusTag("oven/temp", 40001)));
        var before = Json(await store.GetAsync("AOI-01"));

        var result = await service.IngestAsync(
            "AOI-01", DriverKinds.Modbus,
            Map("AOI-01", WritableTagWithNoPolicy("oven/setpoint"), WritableTagWithNoPolicy("oven/limit")));

        Assert.False(result.Ok);
        Assert.Equal(0, result.TagCount);

        // EVERY violation, not the first: two writable tags with no policyAction are two separate
        // violations, and an operator told about one of them fixes half the file and restarts to be told
        // about the other.
        Assert.True(result.Errors.Count >= 2,
            $"expected a violation for each offending tag, got {result.Errors.Count}: {string.Join(" | ", result.Errors)}");
        Assert.Contains(result.Errors, e => e.Contains("oven/setpoint", StringComparison.Ordinal));
        Assert.Contains(result.Errors, e => e.Contains("oven/limit", StringComparison.Ordinal));

        Assert.Equal(before, Json(await store.GetAsync("AOI-01")));
    }

    /// <summary>
    /// The precise mechanics of the step above, which the class doc comment refuses to blur: a §5 violation
    /// DOES enter <c>PutAsync</c> — that is where the check lives, once, at the door every caller passes —
    /// and the call throws before opening a connection, so nothing is written. "Does not touch the store"
    /// is literally true of every EARLIER failure and means "leaves the namespace unchanged" here.
    ///
    /// <para>Does not measure: that no connection was opened — that is <c>TagNamespaceStore</c>'s own
    /// guarantee and its own test. This measures the call count and the surviving document.</para>
    /// </summary>
    [Fact]
    public async Task A_section5_violation_enters_the_store_exactly_once_and_writes_nothing()
    {
        var recording = new RecordingStore(RealStore());
        var service = new TagIngestionService(recording);

        await service.IngestAsync("AOI-01", DriverKinds.Modbus, Map("AOI-01", ModbusTag("oven/temp", 40001)));
        var before = Json(await recording.GetAsync("AOI-01"));
        var callsAfterTheGoodWrite = recording.PutCalls;

        var result = await service.IngestAsync(
            "AOI-01", DriverKinds.Modbus, Map("AOI-01", WritableTagWithNoPolicy("oven/setpoint")));

        Assert.False(result.Ok);
        Assert.Equal(callsAfterTheGoodWrite + 1, recording.PutCalls);
        Assert.Equal(before, Json(await recording.GetAsync("AOI-01")));
    }

    /// <summary>
    /// The probe for every failure that must never reach the store at all. Each row is a different step of
    /// <c>parse → identity → build → save</c> failing, and the assertion is the same for all of them:
    /// <c>PutAsync</c> was never entered and the running namespace is untouched.
    ///
    /// <para>Does not measure: the error text of each row — that is pinned per-row elsewhere. This is
    /// about reachability of the store.</para>
    /// </summary>
    [Theory]
    [InlineData("{ not json at all", "a document that cannot be parsed")]
    [InlineData("null", "valid JSON that is not a declaration")]
    [InlineData("{ \"schemaVersion\": 1, \"machineCode\": \"OTHER-MACHINE\", \"entries\": [] }", "a map for a different machine")]
    public async Task The_store_is_never_entered_when_ingestion_fails_before_the_save_step(string tagMapJson, string why)
    {
        var recording = new RecordingStore(RealStore());
        var service = new TagIngestionService(recording);

        await service.IngestAsync("AOI-01", DriverKinds.Modbus, Map("AOI-01", ModbusTag("oven/temp", 40001)));
        var before = Json(await recording.GetAsync("AOI-01"));
        var callsAfterTheGoodWrite = recording.PutCalls;

        var result = await service.IngestAsync("AOI-01", DriverKinds.Modbus, tagMapJson);

        Assert.False(result.Ok);
        Assert.NotEmpty(result.Errors);
        Assert.Equal(callsAfterTheGoodWrite, recording.PutCalls);
        Assert.Equal(before, Json(await recording.GetAsync("AOI-01")));
        Assert.False(string.IsNullOrWhiteSpace(why));
    }

    /// <summary>
    /// Does not measure: what kind of store failure occurred. The point is that no store failure escapes
    /// as an exception — a caller gets a result it can log, which is what keeps connector registration
    /// alive.
    /// </summary>
    [Fact]
    public async Task An_unexpected_store_failure_is_reported_rather_than_thrown()
    {
        var service = new TagIngestionService(new AlwaysFailingStore());

        var result = await service.IngestAsync("AOI-01", DriverKinds.Modbus, Map("AOI-01", ModbusTag("oven/temp", 40001)));

        Assert.False(result.Ok);
        Assert.Equal(0, result.TagCount);
        Assert.Contains(result.Errors, e => e.Contains("the disk is on fire", StringComparison.Ordinal));
    }

    // -------------------------------------------------------------------------------------------------
    // Reload replaces.
    // -------------------------------------------------------------------------------------------------

    /// <summary>
    /// Re-ingesting replaces rather than merges, and a tag that is no longer declared stops resolving.
    /// WS-HMI-0a pinned that at the store layer; what is pinned HERE is that the ingestion path really goes
    /// through that layer instead of accumulating its own state — <c>FindTagAsync</c> reads the
    /// <c>tag_index</c> table, so a dropped tag still resolving would mean the index was never rewritten.
    ///
    /// <para>Does not measure: the index's schema or its transaction — <c>TagNamespaceStore</c>'s own tests
    /// own that.</para>
    /// </summary>
    [Fact]
    public async Task Reingesting_replaces_the_namespace_and_a_tag_no_longer_declared_disappears()
    {
        var store = RealStore();
        var service = new TagIngestionService(store);

        await service.IngestAsync(
            "AOI-01", DriverKinds.Modbus, Map("AOI-01", ModbusTag("oven/temp", 40001), ModbusTag("oven/pressure", 40002)));
        Assert.NotNull(await store.FindTagAsync("oven/pressure"));

        var result = await service.IngestAsync("AOI-01", DriverKinds.Modbus, Map("AOI-01", ModbusTag("oven/temp", 40001)));

        Assert.True(result.Ok);
        Assert.Equal(1, result.TagCount);
        Assert.Equal(new[] { "oven/temp" }, (await store.GetAsync("AOI-01"))!.Tags.Select(t => t.Path));
        Assert.Null(await store.FindTagAsync("oven/pressure"));
    }

    // -------------------------------------------------------------------------------------------------
    // §5-bis — absence.
    // -------------------------------------------------------------------------------------------------

    /// <summary>
    /// A connector that declares no tag map is valid and contributes nothing. Critically it does not reach
    /// the store, so it cannot erase a namespace some other source already established for that machine —
    /// which is the difference between "contributes no tags" and "declares that there are none".
    ///
    /// <para>Does not measure: whether any connector actually omits a map in production — that is the
    /// wiring's concern.</para>
    /// </summary>
    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData("   ")]
    public async Task A_connector_with_no_tag_map_is_valid_contributes_nothing_and_erases_nothing(string? absent)
    {
        var recording = new RecordingStore(RealStore());
        var service = new TagIngestionService(recording);

        await service.IngestAsync("AOI-01", DriverKinds.Modbus, Map("AOI-01", ModbusTag("oven/temp", 40001)));
        var before = Json(await recording.GetAsync("AOI-01"));
        var callsAfterTheGoodWrite = recording.PutCalls;

        var result = await service.IngestAsync("AOI-01", DriverKinds.Modbus, absent);

        Assert.True(result.Ok);
        Assert.Equal(0, result.TagCount);
        Assert.Equal(0, result.BackedCount);
        Assert.Empty(result.Errors);
        Assert.Equal(callsAfterTheGoodWrite, recording.PutCalls);
        Assert.Equal(before, Json(await recording.GetAsync("AOI-01")));
    }

    /// <summary>
    /// The other side of the line above: a declaration that is PRESENT and declares zero entries is a
    /// statement — "this machine has no tags" — and it replaces. Absence is not a claim; an empty
    /// declaration is, and conflating them would make it impossible to ever clear a namespace.
    ///
    /// <para>Does not measure: whether an empty namespace is served as 200 or 404 — WS-HMI-0b ruled that
    /// and no route is exercised here.</para>
    /// </summary>
    [Fact]
    public async Task A_present_but_empty_declaration_is_a_statement_and_replaces_the_namespace()
    {
        var store = RealStore();
        var service = new TagIngestionService(store);

        await service.IngestAsync("AOI-01", DriverKinds.Modbus, Map("AOI-01", ModbusTag("oven/temp", 40001)));

        var result = await service.IngestAsync("AOI-01", DriverKinds.Modbus, Map("AOI-01"));

        Assert.True(result.Ok);
        Assert.Equal(0, result.TagCount);
        Assert.Empty((await store.GetAsync("AOI-01"))!.Tags);
        Assert.Null(await store.FindTagAsync("oven/temp"));
    }

    // -------------------------------------------------------------------------------------------------
    // Ruling S-5 — the declaration and the binding disagree.
    // -------------------------------------------------------------------------------------------------

    /// <summary>
    /// <b>Refuse, and name both codes.</b> Writing under the binding's code would give one machine another
    /// machine's tags; writing under the declaration's code would let a connector registered for machine A
    /// replace the namespace of an unrelated machine B — WS-HMI-0b Task 1's HIGH-1 one layer up. The
    /// message has to contain both spellings, because an operator who can see only one of them cannot tell
    /// which file to edit.
    ///
    /// <para>Does not measure: that machine B exists or is running. The refusal does not depend on it, and
    /// making the test depend on it would weaken the rule to "refuse when it would collide".</para>
    /// </summary>
    [Fact]
    public async Task A_declaration_naming_a_different_machine_is_refused_and_the_error_names_both()
    {
        var service = new TagIngestionService(RealStore());

        var result = await service.IngestAsync(
            "AOI-01", DriverKinds.Modbus, Map("PRESS-07", ModbusTag("oven/temp", 40001)));

        Assert.False(result.Ok);
        var error = Assert.Single(result.Errors);
        Assert.Contains("PRESS-07", error, StringComparison.Ordinal);
        Assert.Contains("AOI-01", error, StringComparison.Ordinal);
    }

    /// <summary>
    /// A spelling difference is NOT a disagreement. Machine codes are a case-insensitive identity whose one
    /// canonical form is <c>Trim().ToUpperInvariant()</c>, and refusing <c>aoi-01</c> against
    /// <c>AOI-01</c> would reject correct configurations and teach operators the check is noise.
    /// <c>MachineCodeIdentity.SameIdentity</c> is the single place that decides this.
    ///
    /// <para>Does not measure: how the store keys the document — the canonicalising decorator owns that,
    /// which is why the read below uses a third spelling again.</para>
    /// </summary>
    [Theory]
    [InlineData("aoi-01")]
    [InlineData("AOI-01")]
    [InlineData("  Aoi-01  ")]
    public async Task A_declaration_differing_only_in_spelling_is_the_same_machine(string declaredCode)
    {
        var store = RealStore();
        var service = new TagIngestionService(store);

        var result = await service.IngestAsync(
            "AOI-01", DriverKinds.Modbus, Map(declaredCode, ModbusTag("oven/temp", 40001)));

        Assert.True(result.Ok, string.Join(" | ", result.Errors));
        Assert.Equal(1, result.TagCount);
        Assert.NotNull(await store.GetAsync("aOi-01"));
    }

    /// <summary>
    /// A declaration that omits the machine code adopts the binding's — the "fill it in when the body omits
    /// it" half of the rule the PUT routes already use.
    ///
    /// <para>Does not measure: whether omitting it is good practice. It is legal, and legal inputs must
    /// have a decided behaviour.</para>
    /// </summary>
    [Fact]
    public async Task A_declaration_that_omits_the_machine_code_adopts_the_binding()
    {
        var store = RealStore();
        var service = new TagIngestionService(store);

        var result = await service.IngestAsync(
            "AOI-01", DriverKinds.Modbus,
            $$"""{ "schemaVersion": 1, "entries": [ {{ModbusTag("oven/temp", 40001)}} ] }""");

        Assert.True(result.Ok, string.Join(" | ", result.Errors));
        var stored = await store.GetAsync("AOI-01");
        Assert.NotNull(stored);
        Assert.Equal("AOI-01", stored!.MachineCode);
    }

    // -------------------------------------------------------------------------------------------------
    // Ruling S-3.
    // -------------------------------------------------------------------------------------------------

    /// <summary>
    /// 🔴 <b>MED-3 — a schema-required field missing from an entry is refused at the write door.</b> Before
    /// this, an entry omitting <c>source</c> parsed, compiled, drew ZERO violations, threw nothing and
    /// serialised with <c>source</c> absent, so a namespace the frozen schema forbids was stored and served
    /// — through this very ingestion path. <c>ContractInvariants</c> now checks the remaining required
    /// fields for presence, which is where it closes because that door is the one EVERY producer passes:
    /// closing it in the builder would have left <c>PUT /v1/tags</c> open to the identical document.
    ///
    /// <para>Does not measure: full schema validity. Presence only — no pattern, no enum membership, no
    /// <c>additionalProperties</c>. A tag whose <c>dataType</c> is <c>"xyzzy"</c> still passes, and that
    /// remains the deliberate non-fix <c>ContractInvariants</c> declares.</para>
    /// </summary>
    [Theory]
    [InlineData("source", """{ "path": "oven/temp", "dataType": "float", "engMin": 0, "engMax": 300, "access": "r" }""")]
    [InlineData("dataType", """{ "path": "oven/temp", "engMin": 0, "engMax": 300, "access": "r", "source": { "kind": "modbus", "unitId": 1, "register": 1 } }""")]
    [InlineData("source.kind", """{ "path": "oven/temp", "dataType": "float", "engMin": 0, "engMax": 300, "access": "r", "source": { "unitId": 1, "register": 1 } }""")]
    public async Task A_tag_map_omitting_a_schema_required_field_is_refused_at_the_write_door(
        string missingField, string tagObject)
    {
        var store = RealStore();
        var service = new TagIngestionService(store);

        await service.IngestAsync("AOI-01", DriverKinds.Modbus, Map("AOI-01", ModbusTag("oven/ok", 40001)));
        var before = Json(await store.GetAsync("AOI-01"));

        var result = await service.IngestAsync("AOI-01", DriverKinds.Modbus, Map("AOI-01", tagObject));

        Assert.False(result.Ok, $"a tag omitting '{missingField}' was accepted; the schema requires it.");
        Assert.Contains(result.Errors, e => e.Contains(missingField.Split('.')[^1], StringComparison.Ordinal));
        Assert.Equal(before, Json(await store.GetAsync("AOI-01")));
    }

    /// <summary>
    /// 🔴 <b>LOW-5 — ruling S-5 is closed by a CALL, not by a method existing.</b>
    /// <c>TagMapDeclaration.CanonicalMachineCode()</c> shipped with its doc comment instructing "Tasks 2
    /// and 4 must call this for any grouping or same-machine comparison" and ZERO production callers: Task 2
    /// legitimately makes no such comparison, and Task 4 made one but reached past the method to
    /// <c>MachineCodeIdentity</c> directly. The rule was obeyed and the seam it was supposed to run through
    /// was dead — the same computed-but-unconsumed shape this workstream keeps finding, one file away from
    /// two reports that each named it about their own type.
    ///
    /// <para>A behavioural test cannot see this: comparing canonical identities directly gives byte-identical
    /// answers, so every ingestion test stays green either way. What distinguishes them is whether the seam
    /// is USED, and that is a fact about source, so this is a source census — the same instrument
    /// <c>PerHostDataRootsTests</c> uses for the same reason.</para>
    ///
    /// <para>Does not measure: that the call is in the RIGHT place, or that its result is used correctly —
    /// <c>A_declaration_differing_only_in_spelling_is_the_same_machine</c> and its sweep rows do that. This
    /// measures only that the seam is not dead.</para>
    /// </summary>
    [Fact]
    public void CanonicalMachineCode_has_at_least_one_production_caller()
    {
        var srcRoot = Path.Combine(MachineSimulatorRoot(), "src");

        var callers = Directory
            .EnumerateFiles(srcRoot, "*.cs", SearchOption.AllDirectories)
            .Where(f => !f.Contains($"{Path.DirectorySeparatorChar}obj{Path.DirectorySeparatorChar}", StringComparison.Ordinal))
            .Where(f => !f.Contains($"{Path.DirectorySeparatorChar}bin{Path.DirectorySeparatorChar}", StringComparison.Ordinal))
            // The declaration itself is not a caller.
            .Where(f => !f.EndsWith("TagMapDeclaration.cs", StringComparison.Ordinal))
            // 🔴 COMMENT LINES ARE EXCLUDED, and that is the whole difference between this test working and
            // not. The first version matched the file's raw text, so the paragraph EXPLAINING LOW-5 — which
            // names `CanonicalMachineCode()` twice — kept the census green after the call itself was
            // removed. Measured: restoring the exact LOW-5 regression left this test passing. A census that
            // is satisfied by its own explanation measures nothing; the doc comment for LOW-5 must not be
            // able to stand in for the call it describes.
            .Where(f => File.ReadLines(f).Any(line =>
            {
                var code = line.TrimStart();
                return !code.StartsWith("//", StringComparison.Ordinal)
                       && !code.StartsWith("///", StringComparison.Ordinal)
                       && !code.StartsWith("*", StringComparison.Ordinal)
                       && code.Contains("CanonicalMachineCode()", StringComparison.Ordinal);
            }))
            .Select(f => Path.GetRelativePath(srcRoot, f).Replace('\\', '/'))
            .OrderBy(f => f, StringComparer.Ordinal)
            .ToList();

        Assert.True(callers.Count > 0,
            "TagMapDeclaration.CanonicalMachineCode() has no production caller. Its own doc comment tells " +
            "Tasks 2 and 4 to use it for every same-machine comparison, so an uncalled method means either " +
            "a comparison is reaching past it to MachineCodeIdentity (which is what LOW-5 found) or the " +
            "instruction is obsolete. Do not delete this test to make the method's absence acceptable — " +
            "either restore the call or retract the instruction it enforces.");
    }

    private static string MachineSimulatorRoot()
    {
        var dir = new DirectoryInfo(AppContext.BaseDirectory);
        while (dir is not null)
        {
            if (File.Exists(Path.Combine(dir.FullName, "README.md")) &&
                File.Exists(Path.Combine(dir.FullName, "fleet.json")) &&
                Directory.Exists(Path.Combine(dir.FullName, "src")))
            {
                return dir.FullName;
            }

            dir = dir.Parent;
        }

        throw new InvalidOperationException(
            "Could not locate tools/machine-simulator (README.md + fleet.json + src/) by walking up from " +
            $"\"{AppContext.BaseDirectory}\". Fix this walk — do NOT weaken the census to make it run.");
    }

    // -------------------------------------------------------------------------------------------------
    // The startup loop, which Task 4's sweep proved was unreachable while it lived inline in Program.cs.
    // -------------------------------------------------------------------------------------------------

    /// <summary>
    /// <b>The swallow, pinned.</b> Task 4's sweep rows P2 and P3 were GREEN: removing the swallow and
    /// typo-ing the folder name each reddened nothing, because the loop resolved its own directory from
    /// <c>AppContext.BaseDirectory</c> and no test could reach it. Extracting it so the directory is a
    /// PARAMETER is what makes this test possible at all.
    ///
    /// <para>A store that throws on every write makes every machine's ingestion fail. The loop must
    /// complete, return zero, and not propagate — because by the time it runs the connectors are
    /// registered and a throw here would take a running line down over a screen definition.</para>
    ///
    /// <para>Does not measure: what the operator sees. Nothing surfaces the refusal outside a log line —
    /// that is the open item this task's report names, not something this test closes.</para>
    /// </summary>
    /// <para>🔴 TWO earlier versions of this test could not fail, and both are worth recording because they
    /// are different mistakes. The first used <c>AlwaysFailingStore</c>, whose throw <c>IngestAsync</c>
    /// catches internally and converts to <c>Ok: false</c> — so the exception never reached the loop's
    /// <c>catch</c> and the sweep row that removes it stayed GREEN. The second created a DIRECTORY named
    /// <c>AOI-01.json</c>, which <c>Directory.EnumerateFiles</c> does not return at all, so the machine was
    /// simply treated as having no map. The failure has to originate outside <c>IngestAsync</c> AND survive
    /// the file enumeration: a real file, held open with <c>FileShare.None</c>, makes
    /// <c>File.ReadAllText</c> throw <c>IOException</c> from inside the loop — the unforeseen-I/O shape the
    /// swallow exists for.</para>
    [Fact]
    public void The_startup_loop_swallows_a_failure_it_cannot_foresee_so_a_bad_map_cannot_break_registration()
    {
        var dir = TempDir();
        var locked = Path.Combine(dir, "AOI-01.json");
        File.WriteAllText(locked, Map("AOI-01", ModbusTag("oven/temp", 40001)));
        File.WriteAllText(Path.Combine(dir, "AOI-02.json"), Map("AOI-02", ModbusTag("oven/temp", 40002)));

        var log = new RecordingLogger();

        using (new FileStream(locked, FileMode.Open, FileAccess.Read, FileShare.None))
        {
            var ingested = TagMapStartupIngestion.IngestAll(
                dir,
                new[] { ("modbus-1", (string?)"AOI-01", (string?)DriverKinds.Modbus),
                        ("modbus-2", (string?)"AOI-02", (string?)DriverKinds.Modbus) },
                new TagIngestionService(RealStore()),
                log);

            // The unreadable one was swallowed and named; the OTHER machine still got its namespace, which
            // is the whole point — one bad map disables only itself.
            Assert.Equal(1, ingested);
        }

        Assert.Contains(log.Entries, e => e.Level == LogLevel.Error && e.Message.Contains("AOI-01", StringComparison.Ordinal));
    }

    /// <summary>
    /// 🔴 <b>W-HIGH-1 — the directory swallow, which was WHOLLY unmeasured: `when (false)` on it left the
    /// whole suite green.</b> It is the more dangerous of this file's two swallows. The per-machine one
    /// loses one machine's screen; this one is reached before any machine is considered, from a method
    /// called at the top of <c>IngestAll</c>, which <c>Program.cs</c> invokes from a TOP-LEVEL STATEMENT
    /// with nothing above it to catch — so without it an unreadable <c>tag-maps/</c> folder stops the HOST,
    /// and every machine on the box goes with it.
    ///
    /// <para>Does not measure: that a real ACL denial throws. Nothing here changes a permission — see the
    /// internal overload's own doc comment for why an ACL-based test would be the kind that passes having
    /// measured nothing on a host whose process bypasses DENY. What this measures is the structural
    /// property: the listing call is inside the try, and a throw from it does not escape
    /// <c>IngestAll</c>.</para>
    /// </summary>
    [Fact]
    public void An_unreadable_tag_map_directory_does_not_stop_the_host()
    {
        var log = new RecordingLogger();

        var ingested = TagMapStartupIngestion.IngestAll(
            TempDir(),
            new[] { ("modbus-1", (string?)"AOI-01", (string?)DriverKinds.Modbus) },
            new TagIngestionService(RealStore()),
            log,
            listFiles: _ => throw new UnauthorizedAccessException("access to the tag-map directory is denied"));

        Assert.Equal(0, ingested);
        Assert.Contains(log.Entries, e =>
            e.Level == LogLevel.Error && e.Message.Contains("could not be listed", StringComparison.Ordinal));
    }

    /// <summary>
    /// An UNBOUND connector is skipped before anything is attempted for it — it names no machine, so there
    /// is no namespace to attach a map to. Asserted on the LOG rather than on the return value, because
    /// both the guarded and unguarded versions return zero: without the guard, the lookup is attempted with
    /// a null code, throws, and is swallowed into an error line. Silence is the observable difference.
    ///
    /// <para>Does not measure: that an unbound connector is otherwise healthy — the registry's concern.</para>
    /// </summary>
    [Fact]
    public void An_unbound_connector_is_skipped_silently_rather_than_failing_into_the_swallow()
    {
        var log = new RecordingLogger();

        var ingested = TagMapStartupIngestion.IngestAll(
            TempDir(),
            new[] { ("modbus-1", (string?)null, (string?)DriverKinds.Modbus) },
            new TagIngestionService(RealStore()),
            log);

        Assert.Equal(0, ingested);
        Assert.DoesNotContain(log.Entries, e => e.Level == LogLevel.Error);
    }

    /// <summary>
    /// The loop's happy path and its §5-bis arm in one: a bound machine with a map is ingested, a bound
    /// machine WITHOUT one is skipped silently, and an UNBOUND connector is skipped because it names no
    /// machine to attach a namespace to.
    ///
    /// <para>Does not measure: the order machines are processed in — nothing depends on it.</para>
    /// </summary>
    [Fact]
    public async Task The_startup_loop_ingests_bound_machines_that_have_a_map_and_skips_the_rest()
    {
        var dir = TempDir();
        File.WriteAllText(Path.Combine(dir, "AOI-01.json"), Map("AOI-01", ModbusTag("oven/temp", 40001)));

        var store = RealStore();

        var ingested = TagMapStartupIngestion.IngestAll(
            dir,
            new[] { ("modbus-1", (string?)"AOI-01", (string?)DriverKinds.Modbus),
                    ("modbus-2", (string?)"AOI-99", (string?)DriverKinds.Modbus),   // bound, no map file
                    ("modbus-3", (string?)null,     (string?)DriverKinds.Modbus) }, // unbound
            new TagIngestionService(store),
            NullLogger.Instance);

        Assert.Equal(1, ingested);
        Assert.NotNull(await store.GetAsync("AOI-01"));
        Assert.Null(await store.GetAsync("AOI-99"));
    }

    /// <summary>
    /// The map file is found by CANONICAL machine code, not by the filesystem's own case rules. A
    /// per-binding <c>Path.Combine(dir, code + ".json")</c> probe would resolve <c>aoi-01.json</c> for
    /// machine <c>AOI-01</c> on Windows and silently not on Linux — a lookup decided by the volume the
    /// product is installed on rather than by this codebase's identity rule.
    ///
    /// <para>Does not measure: behaviour on a case-sensitive filesystem — this suite runs on Windows. What
    /// it measures is that the lookup never asks the filesystem to match, which is what makes the two
    /// platforms agree.</para>
    /// </summary>
    /// <para>🔴 The first version wrote <c>aoi-01.json</c> and bound <c>AOI-01</c>, which does not
    /// discriminate: the INDEX key is canonical either way, so a raw <c>TryGetValue(machineCode)</c> found
    /// it too and the sweep row that removes the canonicalisation stayed GREEN. The BINDING side is what
    /// has to be non-canonical for the lookup to be the thing under test.</para>
    [Theory]
    [InlineData("AOI-01.json", "aoi-01")]
    [InlineData("aoi-01.json", "AOI-01")]
    [InlineData("  aoi-01  .json", "AOI-01")]
    public async Task A_map_file_is_matched_to_its_machine_by_canonical_code(string fileName, string boundCode)
    {
        var dir = TempDir();
        File.WriteAllText(Path.Combine(dir, fileName), Map(boundCode, ModbusTag("oven/temp", 40001)));

        var store = RealStore();

        var ingested = TagMapStartupIngestion.IngestAll(
            dir,
            new[] { ("modbus-1", (string?)boundCode, (string?)DriverKinds.Modbus) },
            new TagIngestionService(store),
            NullLogger.Instance);

        Assert.Equal(1, ingested);
        Assert.NotNull(await store.GetAsync("AOI-01"));
    }

    /// <summary>
    /// An absent tag-map folder is the ordinary state of an install that has never declared one: zero
    /// ingestions, no throw. This is what keeps Task 4's startup change byte-identical for every existing
    /// deployment.
    ///
    /// <para>Also pins the production folder NAME (sweep row P3, previously green): a typo in
    /// <c>ResolveDirectory</c> now reddens here rather than shipping.</para>
    ///
    /// <para>Does not measure: that the folder is absent in a real install — only that absence is handled.</para>
    /// </summary>
    [Fact]
    public void An_absent_tag_map_folder_ingests_nothing_and_throws_nothing()
    {
        var ingested = TagMapStartupIngestion.IngestAll(
            Path.Combine(TempDir(), "does-not-exist"),
            new[] { ("modbus-1", (string?)"AOI-01", (string?)DriverKinds.Modbus) },
            new TagIngestionService(RealStore()),
            NullLogger.Instance);

        Assert.Equal(0, ingested);

        Assert.Equal(TagIngestionService.ResolveDir(), TagMapStartupIngestion.ResolveDirectory());
        Assert.EndsWith("hmi-tagmaps", TagMapStartupIngestion.ResolveDirectory(), StringComparison.Ordinal);
    }

    /// <summary>
    /// Ruling S-3, asserted structurally rather than promised in a comment: the service has exactly one
    /// constructor, it takes the store seam, and there is no parameterless way to build one that could
    /// construct its own. A future edit adding a convenience constructor that news up a store would have to
    /// break this test to do it.
    ///
    /// <para>Does not measure: what DI is configured to resolve <c>ITagNamespaceStore</c> to — that is
    /// <c>TagIngestionWiringTests</c>, which asserts it is the canonicalising decorator.</para>
    /// </summary>
    [Fact]
    public void The_service_can_only_be_built_around_an_injected_store()
    {
        var constructors = typeof(TagIngestionService).GetConstructors();

        var only = Assert.Single(constructors);
        var parameter = Assert.Single(only.GetParameters());
        Assert.Equal(typeof(ITagNamespaceStore), parameter.ParameterType);

        Assert.Throws<ArgumentNullException>(() => new TagIngestionService(null!));
    }
}
