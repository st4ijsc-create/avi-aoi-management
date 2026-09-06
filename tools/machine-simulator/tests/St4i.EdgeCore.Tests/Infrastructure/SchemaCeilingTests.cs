using Microsoft.Data.Sqlite;
using St4i.EdgeCore.Historian;
using St4i.EdgeCore.Infrastructure;
using St4i.EdgeCore.Site;
using Xunit;

namespace St4i.EdgeCore.Tests.Infrastructure;

/// <summary>
/// 🔴 WS-F4 Task 1 — the schema ceiling for the two SQLite stores that live in <c>St4i.EdgeCore</c>.
/// The other eight are pinned by the sibling suite in <c>St4i.EngineApi.Tests</c>; the split is the
/// assembly boundary and nothing else.
///
/// <para><b>What each store gets, and why it is exactly two tests and not one.</b> A ceiling that
/// refused EVERYTHING would pass every "refuses a database from the future" test ever written, and would
/// also brick every machine in the field. So each store has a pair, and the pair is the measurement:</para>
/// <list type="bullet">
/// <item><b>the ceiling test</b> — a database stamped one version ABOVE the store's highest known rung is
/// refused with <see cref="SchemaFromTheFutureException"/>;</item>
/// <item><b>the negative control</b> — a database at EXACTLY the store's own current version opens
/// normally. This is the half that fails if the ceiling is too greedy, and without it the first test is
/// satisfied by <c>throw new SchemaFromTheFutureException(...)</c> at the top of every constructor.</item>
/// </list>
///
/// <para>🔴 <b>The negative control is built by letting the store itself create the database</b>, not by
/// stamping a number this test chose. Stamping would make the control assert against this file's opinion
/// of the ladder; letting the store migrate a fresh directory and then re-opening the SAME directory
/// asserts against the ladder that actually shipped, and keeps passing when a future task appends a rung.
/// That second open is the whole control: it is the ordinary restart every machine does on every boot.</para>
/// </summary>
public sealed class SchemaCeilingTests
{
    private static string NewTempDir()
    {
        var dir = Path.Combine(Path.GetTempPath(), "st4i-schema-ceiling-" + Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(dir);
        return dir;
    }

    /// <summary>Reads <c>PRAGMA user_version</c> from a database the store has already created.</summary>
    private static long ReadUserVersion(string dbPath)
    {
        using var connection = new SqliteConnection($"Data Source={dbPath}");
        connection.Open();
        using var cmd = connection.CreateCommand();
        cmd.CommandText = "PRAGMA user_version;";
        return Convert.ToInt64(cmd.ExecuteScalar(), System.Globalization.CultureInfo.InvariantCulture);
    }

    /// <summary>
    /// Stamps a database with a <c>user_version</c> from the future — the exact state an older binary
    /// finds after a newer one has migrated the file and the operator has rolled the product back.
    /// </summary>
    private static void StampVersion(string dbPath, long version)
    {
        using var connection = new SqliteConnection($"Data Source={dbPath}");
        connection.Open();
        using var cmd = connection.CreateCommand();
        cmd.CommandText = $"PRAGMA user_version = {version};";
        cmd.ExecuteNonQuery();
        SqliteConnection.ClearAllPools();
    }

    /// <summary>
    /// The shared body of every ceiling test: let the store build its database, note the version it chose,
    /// stamp one higher, and assert the next open is refused and says something useful.
    /// </summary>
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

        // The refusal must be USABLE at 3am, so assert what it actually carries rather than only its type.
        Assert.Equal(shipped + 1, ex.FileSchemaVersion);
        Assert.Equal(shipped, ex.HighestKnownVersion);
        Assert.Contains(expectedFileName, ex.Message, StringComparison.Ordinal);
        Assert.Contains((shipped + 1).ToString(System.Globalization.CultureInfo.InvariantCulture), ex.Message, StringComparison.Ordinal);
        Assert.Contains("reinstall", ex.Message, StringComparison.OrdinalIgnoreCase);

        // Nothing was destroyed on the way out — the same promise the Throws posture already publishes.
        Assert.True(File.Exists(dbPath));
    }

    /// <summary>
    /// The shared negative control: the store opens a database at its OWN version, twice. If this reddens,
    /// the ceiling refuses the ordinary case and every machine in the field is bricked.
    /// </summary>
    private static void AssertOpensItsOwnDatabase(Func<string, object> construct, string expectedFileName)
    {
        var dir = NewTempDir();
        construct(dir);
        SqliteConnection.ClearAllPools();

        var dbPath = Path.Combine(dir, expectedFileName);
        var shipped = ReadUserVersion(dbPath);

        // The re-open is the control. No exception may escape it.
        var ex = Record.Exception(() => construct(dir));
        Assert.True(ex is null,
            $"the ceiling refused a database at its OWN version {shipped} ({expectedFileName}). " +
            $"This is the failure mode where a ceiling that refuses everything looks correct: " +
            $"{ex?.GetType().Name}: {ex?.Message}");

        Assert.Equal(shipped, ReadUserVersion(dbPath));
    }

    // ── historian.db — one of the two stores the ledger names as the dangerous ones ────────────────

    [Fact]
    public void Historian_refuses_a_database_written_by_a_newer_build() =>
        AssertRefusesAFutureDatabase(dir => new SqliteHistorianStore(dir), "historian.db");

    [Fact]
    public void Historian_still_opens_a_database_at_its_own_version() =>
        AssertOpensItsOwnDatabase(dir => new SqliteHistorianStore(dir), "historian.db");

    // ── bridge-spool.db ───────────────────────────────────────────────────────────────────────────

    [Fact]
    public void BridgeSpool_refuses_a_database_written_by_a_newer_build() =>
        AssertRefusesAFutureDatabase(dir => new BridgeSpool(dir), "bridge-spool.db");

    [Fact]
    public void BridgeSpool_still_opens_a_database_at_its_own_version() =>
        AssertOpensItsOwnDatabase(dir => new BridgeSpool(dir), "bridge-spool.db");

    // ── the guard's own boundary, asserted directly rather than through a store ────────────────────

    /// <summary>
    /// 🔴 The off-by-one that decides whether this feature is a fix or an outage, tested at the guard
    /// itself: <c>equal</c> passes, <c>below</c> passes, only <c>above</c> throws. Every store's negative
    /// control depends on this being <c>&gt;</c> rather than <c>&gt;=</c>, and this is the one place that
    /// comparison is pinned without a store in the way.
    /// </summary>
    [Theory]
    [InlineData(0, 3, false)]   // brand new file, ladder at 3 — must migrate, never refuse
    [InlineData(2, 3, false)]   // one rung behind — the ordinary upgrade
    [InlineData(3, 3, false)]   // exactly current — the overwhelmingly common case in the field
    [InlineData(4, 3, true)]    // one ahead — the rollback that used to be silent
    [InlineData(99, 3, true)]   // far ahead
    public void The_ceiling_refuses_only_versions_strictly_above_what_this_build_knows(
        long fileVersion, long highestKnown, bool shouldThrow)
    {
        var dir = NewTempDir();
        var dbPath = Path.Combine(dir, "probe.db");

        using var connection = new SqliteConnection($"Data Source={dbPath}");
        connection.Open();
        using (var cmd = connection.CreateCommand())
        {
            cmd.CommandText = $"PRAGMA user_version = {fileVersion};";
            cmd.ExecuteNonQuery();
        }

        var ex = Record.Exception(() =>
            SchemaFromTheFutureException.ThrowIfDatabaseIsNewerThanThisBuild(connection, dbPath, highestKnown));

        if (shouldThrow)
        {
            var typed = Assert.IsType<SchemaFromTheFutureException>(ex);
            Assert.Equal(fileVersion, typed.FileSchemaVersion);
            Assert.Equal(highestKnown, typed.HighestKnownVersion);
        }
        else
        {
            Assert.True(ex is null, $"the ceiling refused user_version {fileVersion} against a ladder top of " +
                $"{highestKnown}, which is not a database from the future: {ex?.Message}");
        }
    }

    /// <summary>
    /// 🔴 The message is the deliverable, so it is asserted as prose rather than only as a type. The
    /// reader is an engineer at 3am with no internet: the sentence has to name the file, both numbers, and
    /// the remedy, and must not tell them to delete the database that holds their data.
    /// </summary>
    [Fact]
    public void The_refusal_names_the_file_both_versions_and_the_remedy()
    {
        var ex = new SchemaFromTheFutureException(@"C:\ProgramData\ST4I\sim\security\security.db", 7, 2);

        Assert.Contains(@"C:\ProgramData\ST4I\sim\security\security.db", ex.Message, StringComparison.Ordinal);
        Assert.Contains("7", ex.Message, StringComparison.Ordinal);
        Assert.Contains("2", ex.Message, StringComparison.Ordinal);
        Assert.Contains("reinstall", ex.Message, StringComparison.OrdinalIgnoreCase);
        Assert.Contains("newer version", ex.Message, StringComparison.OrdinalIgnoreCase);

        // It must never advise the one action that loses the data.
        Assert.DoesNotContain("delete this file to", ex.Message, StringComparison.OrdinalIgnoreCase);
        Assert.Contains("Do NOT delete", ex.Message, StringComparison.Ordinal);
    }
}
