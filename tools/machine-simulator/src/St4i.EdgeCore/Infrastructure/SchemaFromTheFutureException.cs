using Microsoft.Data.Sqlite;

namespace St4i.EdgeCore.Infrastructure;

/// <summary>
/// WS-F4 Task 1 — 🔴 <b>THE SCHEMA CEILING.</b> Thrown when a SQLite store is asked to open a database
/// whose <c>PRAGMA user_version</c> is HIGHER than the highest rung of the binary's own migration ladder:
/// the file was written by a NEWER build of this product than the one now running.
///
/// <para>🔴 <b>The defect this closes, and why it was the dangerous one.</b> Every one of the ten stores
/// shared this ladder: <c>foreach (var (version, statements) in Migrations) { if (version &lt;=
/// currentVersion) continue; … }</c> — <b>with no <c>else</c>.</b> An OLDER binary opening a NEWER database
/// read <c>user_version = 3</c>, found only rungs 1 and 2, skipped both as <c>&lt;= 3</c>, and
/// <b>returned from <c>EnsureSchema()</c> reporting success.</b> It then issued old-shaped <c>SELECT</c>s
/// against a schema it had never seen. If the newer version only added a table or a nullable column it
/// worked by luck; if it renamed, dropped or <c>NOT NULL</c>-ed anything, every query against that store
/// threw at runtime — and for <c>security.db</c> that is the LOGIN database.</para>
///
/// <para>The route to it is a rollback that looks like a success. An engineer upgrades, hits an unrelated
/// problem, and rolls back the only way anyone knows — reinstall the older MSI. That restores
/// <c>%ProgramFiles%</c> perfectly and touches nothing under <c>%ProgramData%</c>, which is where every
/// byte of state lives. The old binary then comes up against a database from the future and says nothing.
/// <b>It is 3am, nobody can log in to the machine that would explain why, and there is no engineer on site
/// and no internet.</b> That silence is worse than a failed update, because a failed update is loud.</para>
///
/// <para>🔴 <b>This is not a new pattern; it is an old one finally applied here.</b>
/// <c>LicenseVerifier</c> has always done exactly this for licences —
/// <c>SupportedPayloadVersion</c> plus <c>LicenseState.Unsupported</c>, documented as "a readable refusal,
/// never a best-effort parse of a format that may have changed meaning". The licensing code got this
/// right and the ten data stores did not. This type finishes applying the discipline this codebase
/// already argued for.</para>
///
/// <para>🔴 <b>Refusing to start is not a machine with no way back — it is the way back, spoken aloud.</b>
/// The failure being replaced is silent corruption of the login and production-history databases. What
/// replaces it names the file, both version numbers, and the exact remedy. A machine that refuses to open
/// a store AND tells you which version to reinstall has a way back and is telling you what it is; a
/// machine that opens it and then cannot authenticate anyone does not.</para>
///
/// <para><b>Posture: this changes no store's published posture.</b> All ten stores already carry
/// <c>Posture.Throws</c> in <c>OperatorDataRemovalCensusTests.ExpectedPostures</c> for "the artefact is
/// present and this process cannot use its bytes" — the law in <c>docs/startup-failure-posture.md</c> §3.6.
/// A database from the future is that situation exactly, so this adds a new CAUSE for an existing, pinned
/// posture rather than a new posture. What each caller does with the throw remains §1's business and is
/// unchanged: <c>NotificationConfigStore</c>'s construction is wrapped in <c>Program.cs</c> and yields
/// <b>U</b> (the host comes up and reports), <c>ConnectorConfigStore</c>'s is unguarded and yields
/// <b>S</b>. This type deliberately does not decide that for them.</para>
/// </summary>
public sealed class SchemaFromTheFutureException : Exception
{
    /// <summary>Full path of the database that was written by a newer build.</summary>
    public string DatabasePath { get; }

    /// <summary>The <c>PRAGMA user_version</c> actually found in the file.</summary>
    public long FileSchemaVersion { get; }

    /// <summary>The highest migration rung THIS build knows how to apply.</summary>
    public long HighestKnownVersion { get; }

    /// <summary>
    /// Builds the refusal. 🔴 The message is the whole point of this type and is written for one specific
    /// reader: an engineer at 3am, in a factory, with no internet and no colleague. It therefore names
    /// <b>the file</b> (so they know which of ten databases is the problem), <b>both version numbers</b>
    /// (so they can tell "one rung ahead" from "wildly ahead"), and <b>what to actually do</b> — reinstall
    /// the newer version. A diagnostic that says only "schema mismatch" would leave that reader exactly as
    /// stuck as silence would.
    /// </summary>
    /// <param name="databasePath">Full path of the offending database file.</param>
    /// <param name="fileSchemaVersion">The <c>user_version</c> read from the file.</param>
    /// <param name="highestKnownVersion">The highest rung in this build's ladder.</param>
    public SchemaFromTheFutureException(string databasePath, long fileSchemaVersion, long highestKnownVersion)
        : base(BuildMessage(databasePath, fileSchemaVersion, highestKnownVersion))
    {
        DatabasePath = databasePath;
        FileSchemaVersion = fileSchemaVersion;
        HighestKnownVersion = highestKnownVersion;
    }

    private static string BuildMessage(string databasePath, long fileSchemaVersion, long highestKnownVersion) =>
        $"The database '{databasePath}' was written by a NEWER version of this product and cannot be opened " +
        $"safely by this one. Its schema version is {fileSchemaVersion}; the highest this build understands " +
        $"is {highestKnownVersion}. This build will NOT open it, because reading a schema it does not know " +
        $"would corrupt data or fail unpredictably later instead of now. " +
        $"TO FIX: reinstall the newer version of the product that created this database (the one you had " +
        $"installed before), which understands schema version {fileSchemaVersion}. " +
        $"Nothing has been changed or deleted — the database is intact and this build simply refused to " +
        $"touch it. Do NOT delete this file: it holds your data.";

    /// <summary>
    /// 🔴 <b>THE CEILING ITSELF — the single guard all ten stores call, so there is ONE of it to get right
    /// and one place a future store is added to.</b> Reads <c>PRAGMA user_version</c> and refuses if it is
    /// above <paramref name="highestKnownVersion"/>.
    ///
    /// <para><b>It must be called BEFORE the migration loop, not inside it.</b> Inside, it would be
    /// unreachable on exactly the input that matters: the loop's own <c>continue</c> skips every rung when
    /// the file is ahead, so the body never runs and no guard placed there could ever fire.</para>
    ///
    /// <para><b>What makes this safe to add to ten live stores.</b> It refuses only <c>&gt;</c>, never
    /// <c>&gt;=</c> or <c>&lt;</c>. A database at exactly the highest known version — the overwhelmingly
    /// common case, every up-to-date machine in the field — passes, and so does every older one, which is
    /// the upgrade path the ladder exists to serve. A ceiling that refused any of those would be a far
    /// worse defect than the one being fixed, which is why every store's test for this has a negative
    /// control that opens a same-version database and asserts it still works.</para>
    /// </summary>
    /// <param name="connection">An open connection to the database being guarded.</param>
    /// <param name="databasePath">The file's path, for the diagnostic.</param>
    /// <param name="highestKnownVersion">The highest rung in the caller's migration ladder.</param>
    /// <exception cref="SchemaFromTheFutureException">The file's <c>user_version</c> exceeds
    /// <paramref name="highestKnownVersion"/>.</exception>
    public static void ThrowIfDatabaseIsNewerThanThisBuild(
        SqliteConnection connection, string databasePath, long highestKnownVersion)
    {
        ArgumentNullException.ThrowIfNull(connection);

        using var cmd = connection.CreateCommand();
        cmd.CommandText = "PRAGMA user_version;";
        var result = cmd.ExecuteScalar();
        var fileVersion = result is null
            ? 0L
            : Convert.ToInt64(result, System.Globalization.CultureInfo.InvariantCulture);

        if (fileVersion > highestKnownVersion)
        {
            throw new SchemaFromTheFutureException(databasePath, fileVersion, highestKnownVersion);
        }
    }
}
