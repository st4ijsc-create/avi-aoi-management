using Microsoft.Data.Sqlite;
using St4i.EdgeCore.Infrastructure;
using St4i.EdgeCore.Uns;
using St4i.EngineApi.Alarms;
using St4i.EngineApi.AssetRegistry;
using St4i.EngineApi.Auth;
using St4i.EngineApi.Fleet;
using St4i.EngineApi.HmiModel;
using St4i.EngineApi.Tests.Licensing;
using Xunit;

namespace St4i.EngineApi.Tests;

/// <summary>
/// 🔴 WS-F4 Task 1 — the schema ceiling for the eight SQLite stores that live in <c>St4i.EngineApi</c>.
/// The other two (<c>historian.db</c>, <c>bridge-spool.db</c>) are pinned by the sibling suite in
/// <c>St4i.EdgeCore.Tests</c>; the split is the assembly boundary and nothing else.
///
/// <para><b>The defect these ten pairs close.</b> Every one of these stores ran
/// <c>if (version &lt;= currentVersion) continue;</c> with no <c>else</c>, so an older binary opening a
/// newer database skipped the whole ladder and <b>returned reporting success</b>, then queried a schema it
/// had never seen. <c>security.db</c> is the LOGIN and AUDIT database, so the observable failure was an
/// engineer at 3am unable to sign in to the machine that would have told them what was wrong — reached, not
/// by a botched update, but by a rollback that looked like it worked.</para>
///
/// <para><b>Why every store gets a PAIR.</b> A ceiling that refused everything satisfies "refuses a
/// database from the future" perfectly and bricks every machine in the field. Only the negative control —
/// the store opening a database at its own current version — tells those two apart, so each store has one
/// of each and neither test is meaningful alone.</para>
///
/// <para><b>The negative control never stamps a version of its own.</b> It lets the store create and
/// migrate a fresh database, then re-opens the SAME directory — the ordinary restart every machine
/// performs on every boot. That keeps the control honest against the ladder that actually shipped, and
/// keeps it passing unchanged when a future task appends a rung.</para>
/// </summary>
public sealed class SchemaCeilingTests
{
    private static string NewTempDir()
    {
        var dir = Path.Combine(Path.GetTempPath(), "st4i-schema-ceiling-" + Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(dir);
        return dir;
    }

    private static long ReadUserVersion(string dbPath)
    {
        using var connection = new SqliteConnection($"Data Source={dbPath}");
        connection.Open();
        using var cmd = connection.CreateCommand();
        cmd.CommandText = "PRAGMA user_version;";
        return Convert.ToInt64(cmd.ExecuteScalar(), System.Globalization.CultureInfo.InvariantCulture);
    }

    private static void StampVersion(string dbPath, long version)
    {
        using var connection = new SqliteConnection($"Data Source={dbPath}");
        connection.Open();
        using var cmd = connection.CreateCommand();
        cmd.CommandText = $"PRAGMA user_version = {version};";
        cmd.ExecuteNonQuery();
        SqliteConnection.ClearAllPools();
    }

    /// <summary>Ceiling half: stamp one above whatever the store shipped, assert a readable refusal.</summary>
    private static void AssertRefusesAFutureDatabase(Func<string, object> construct, string expectedFileName)
    {
        var dir = NewTempDir();
        construct(dir);
        SqliteConnection.ClearAllPools();

        var dbPath = Path.Combine(dir, expectedFileName);
        Assert.True(File.Exists(dbPath), $"expected the store to create {dbPath}");

        var shipped = ReadUserVersion(dbPath);
        StampVersion(dbPath, shipped + 1);

        var ex = Assert.Throws<SchemaFromTheFutureException>(() => construct(dir));

        Assert.Equal(shipped + 1, ex.FileSchemaVersion);
        Assert.Equal(shipped, ex.HighestKnownVersion);
        Assert.Contains(expectedFileName, ex.Message, StringComparison.Ordinal);
        Assert.Contains("reinstall", ex.Message, StringComparison.OrdinalIgnoreCase);

        // Nothing destroyed on the way out — the Throws posture's existing promise, re-checked here.
        Assert.True(File.Exists(dbPath));
    }

    /// <summary>Negative control: the store must still open a database at its own version.</summary>
    private static void AssertOpensItsOwnDatabase(Func<string, object> construct, string expectedFileName)
    {
        var dir = NewTempDir();
        construct(dir);
        SqliteConnection.ClearAllPools();

        var dbPath = Path.Combine(dir, expectedFileName);
        var shipped = ReadUserVersion(dbPath);

        var ex = Record.Exception(() => construct(dir));
        Assert.True(ex is null,
            $"the ceiling refused a database at its OWN version {shipped} ({expectedFileName}). " +
            $"This is exactly how a ceiling that refuses everything disguises itself as a working one: " +
            $"{ex?.GetType().Name}: {ex?.Message}");

        Assert.Equal(shipped, ReadUserVersion(dbPath));
    }

    // ── security.db — the login and audit database; the 3am failure the ledger names ───────────────

    [Fact]
    public void SecurityDb_refuses_a_database_written_by_a_newer_build() =>
        AssertRefusesAFutureDatabase(dir => new SecurityDb(dir), "security.db");

    [Fact]
    public void SecurityDb_still_opens_a_database_at_its_own_version() =>
        AssertOpensItsOwnDatabase(dir => new SecurityDb(dir), "security.db");

    // ── alarms.db ─────────────────────────────────────────────────────────────────────────────────

    [Fact]
    public void AlarmStore_refuses_a_database_written_by_a_newer_build() =>
        AssertRefusesAFutureDatabase(dir => new AlarmStore(dir), "alarms.db");

    [Fact]
    public void AlarmStore_still_opens_a_database_at_its_own_version() =>
        AssertOpensItsOwnDatabase(dir => new AlarmStore(dir), "alarms.db");

    // ── notifications.db ──────────────────────────────────────────────────────────────────────────

    [Fact]
    public void NotificationConfigStore_refuses_a_database_written_by_a_newer_build() =>
        AssertRefusesAFutureDatabase(dir => new NotificationConfigStore(dir), "notifications.db");

    [Fact]
    public void NotificationConfigStore_still_opens_a_database_at_its_own_version() =>
        AssertOpensItsOwnDatabase(dir => new NotificationConfigStore(dir), "notifications.db");

    // ── assets.db ─────────────────────────────────────────────────────────────────────────────────

    [Fact]
    public void AssetRegistryStore_refuses_a_database_written_by_a_newer_build() =>
        AssertRefusesAFutureDatabase(dir => new AssetRegistryStore(new UnsOptions(), dir), "assets.db");

    [Fact]
    public void AssetRegistryStore_still_opens_a_database_at_its_own_version() =>
        AssertOpensItsOwnDatabase(dir => new AssetRegistryStore(new UnsOptions(), dir), "assets.db");

    // ── connector-config.db — the deepest ladder in the product (five rungs) ───────────────────────

    [Fact]
    public void ConnectorConfigStore_refuses_a_database_written_by_a_newer_build() =>
        AssertRefusesAFutureDatabase(dir => new ConnectorConfigStore(dir), "connector-config.db");

    [Fact]
    public void ConnectorConfigStore_still_opens_a_database_at_its_own_version() =>
        AssertOpensItsOwnDatabase(dir => new ConnectorConfigStore(dir), "connector-config.db");

    // ── hmi-model.db ──────────────────────────────────────────────────────────────────────────────

    [Fact]
    public void ComponentModelStore_refuses_a_database_written_by_a_newer_build() =>
        AssertRefusesAFutureDatabase(dir => new ComponentModelStore(dir), "hmi-model.db");

    [Fact]
    public void ComponentModelStore_still_opens_a_database_at_its_own_version() =>
        AssertOpensItsOwnDatabase(dir => new ComponentModelStore(dir), "hmi-model.db");

    // ── hmi-screens.db — append-only, so a future row can never be un-authored (blueprint §3.5) ────

    [Fact]
    public void HmiScreenStore_refuses_a_database_written_by_a_newer_build() =>
        AssertRefusesAFutureDatabase(dir => new HmiScreenStore(dir), "hmi-screens.db");

    [Fact]
    public void HmiScreenStore_still_opens_a_database_at_its_own_version() =>
        AssertOpensItsOwnDatabase(dir => new HmiScreenStore(dir), "hmi-screens.db");

    // ── tag-namespaces.db ─────────────────────────────────────────────────────────────────────────

    [Fact]
    public void TagNamespaceStore_refuses_a_database_written_by_a_newer_build() =>
        AssertRefusesAFutureDatabase(dir => new TagNamespaceStore(dir), "tag-namespaces.db");

    [Fact]
    public void TagNamespaceStore_still_opens_a_database_at_its_own_version() =>
        AssertOpensItsOwnDatabase(dir => new TagNamespaceStore(dir), "tag-namespaces.db");

    // ── the census, restated as a test rather than as a claim in a report ──────────────────────────

    /// <summary>
    /// 🔴 The ceiling is only worth what its COVERAGE is worth, so coverage is MEASURED rather than
    /// asserted in prose: every store in <c>src/</c> that carries the migration ladder must also carry the
    /// ceiling.
    ///
    /// <para><b>This is what catches the ELEVENTH store.</b> The ten guarded here became identical by
    /// being copied from one another; the next store will be made the same way, and no test written
    /// against these ten by name would notice it arriving unguarded. This one reddens.</para>
    ///
    /// <para><b>Both halves are decided on CODE, never on raw text</b> — via
    /// <see cref="CSharpSourceScan"/>, this repo's own tested lexer, which blanks comments and string
    /// literals before anything is searched. That matters in both directions here: this very file
    /// discusses <c>version &lt;= currentVersion</c> in prose and would otherwise nominate itself, and a
    /// store whose only mention of the ceiling was a comment promising to add it later would otherwise
    /// count as guarded. The scanner's own doc comment argues why it exists rather than Roslyn, and
    /// <c>CSharpSourceScanTests</c> attacks it with the exact deceptions that have burned this programme
    /// before.</para>
    /// </summary>
    [Fact]
    public void Every_store_carrying_the_migration_ladder_also_carries_the_ceiling()
    {
        var srcRoot = FindSrcRoot();
        var offenders = new List<string>();
        var guarded = new List<string>();

        foreach (var file in Directory.EnumerateFiles(srcRoot, "*.cs", SearchOption.AllDirectories))
        {
            var text = File.ReadAllText(file);
            var code = CSharpSourceScan.StripCommentsAndStrings(text);

            // The ladder is identified by its loop variables appearing together in CODE: `currentVersion`
            // is the ladder's cursor and exists in no other shape in this product.
            var isLadder = CSharpSourceScan.FindIdentifierLines(code, "currentVersion").Count > 0
                && CSharpSourceScan.FindIdentifierLines(code, "Migrations").Count > 0;
            if (!isLadder) continue;

            var callsTheCeiling =
                CSharpSourceScan.FindIdentifierLines(code, "ThrowIfDatabaseIsNewerThanThisBuild").Count > 0;

            if (callsTheCeiling) guarded.Add(Path.GetFileName(file));
            else offenders.Add(Path.GetFileName(file));
        }

        // Non-vacuity, and it is load-bearing twice: a sweep that matched nothing would make the assertion
        // below a sentence rather than a test, and a sweep that silently stopped finding stores would hide
        // a store's REMOVAL as easily as its addition. The literal is the measured count of ladders in
        // src/ and a new store must move it deliberately.
        Assert.Equal(10, guarded.Count);

        Assert.True(offenders.Count == 0,
            "These stores carry the migration ladder but NOT the schema ceiling, so an older binary opening " +
            "a newer database will skip every migration and report success — the silent 3am failure " +
            $"WS-F4 Task 1 exists to remove: {string.Join(", ", offenders)}");
    }

    private static string FindSrcRoot()
    {
        var dir = AppContext.BaseDirectory;
        while (dir is not null)
        {
            var candidate = Path.Combine(dir, "src");
            if (Directory.Exists(candidate) && Directory.Exists(Path.Combine(candidate, "St4i.EngineApi")))
            {
                return candidate;
            }

            dir = Path.GetDirectoryName(dir);
        }

        throw new InvalidOperationException("Could not locate the src/ root from " + AppContext.BaseDirectory);
    }
}
