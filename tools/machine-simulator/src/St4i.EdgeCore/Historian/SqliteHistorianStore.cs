using System.Globalization;
using Microsoft.Data.Sqlite;
using St4i.EdgeCore.Infrastructure;

namespace St4i.EdgeCore.Historian;

/// <summary>
/// WS-A-T2 — <see cref="IHistorianStore"/> on raw <c>Microsoft.Data.Sqlite</c> (no ORM). One SQLite file
/// (<c>historian.db</c>) under the constructor's <c>directory</c> (or <see cref="DefaultRoot"/>), 3 tables
/// (results / telemetry / run-events) created by an ordered migration ladder tracked via
/// <c>PRAGMA user_version</c>. Every public method opens a short-lived <see cref="SqliteConnection"/> (the
/// provider pools physical connections per connection-string, so this is cheap) with WAL + a busy timeout
/// so concurrent readers/writers don't fail outright, and disposes it before returning — no connection is
/// held open across calls.
/// </summary>
public sealed class SqliteHistorianStore : IHistorianStore
{
    /// <summary>The file this instance opened, fixed at construction and never re-pointed —
    /// <c>historian.db</c> inside whatever directory the constructor resolved. It is exposed because it is
    /// the ONLY way a caller can find the data afterwards: nothing else publishes the resolved root, and a
    /// store built with the default root has a path the caller never named. It is also the exact file
    /// <see cref="GetStatsAsync"/> measures. Two stores handed the same directory open the SAME file and
    /// coordinate through nothing but SQLite's own locking.</summary>
    public string DbPath { get; }

    private static readonly string[] OpenPragmas =
    {
        "PRAGMA journal_mode=WAL;",
        "PRAGMA synchronous=NORMAL;",
        "PRAGMA busy_timeout=5000;",
        "PRAGMA foreign_keys=ON;",
    };

    // Ordered migration ladder — future schema changes append a new (Version, Statements) entry here;
    // EnsureSchema() applies only the entries newer than the DB's current PRAGMA user_version, each inside
    // its own transaction. No migrator library — this is the whole mechanism.
    private static readonly (int Version, string[] Statements)[] Migrations =
    {
        (1, new[]
        {
            """
            CREATE TABLE IF NOT EXISTS historian_results (
              id INTEGER PRIMARY KEY AUTOINCREMENT, machine_code TEXT NOT NULL, device_class TEXT NOT NULL,
              machine_type TEXT NOT NULL, reading_kind TEXT NOT NULL, cycle_counter INTEGER NOT NULL,
              serial_number TEXT NOT NULL, verdict TEXT NOT NULL, recipe_code TEXT NULL, recipe_version TEXT NULL,
              key_metric_name TEXT NULL, key_metric_value REAL NULL, key_metric_unit TEXT NULL,
              ng_count INTEGER NOT NULL DEFAULT 0, point_count INTEGER NOT NULL DEFAULT 0,
              ack_success INTEGER NOT NULL, ack_duplicate INTEGER NOT NULL, ack_queued INTEGER NOT NULL,
              genealogy_json TEXT NULL, measurements_json TEXT NULL,
              event_time_utc TEXT NOT NULL, ingested_at_utc TEXT NOT NULL);
            """,
            "CREATE INDEX IF NOT EXISTS ix_results_machine_time ON historian_results(machine_code, event_time_utc);",
            "CREATE INDEX IF NOT EXISTS ix_results_serial ON historian_results(serial_number);",
            "CREATE INDEX IF NOT EXISTS ix_results_time ON historian_results(event_time_utc);",
            """
            CREATE TABLE IF NOT EXISTS historian_telemetry (
              id INTEGER PRIMARY KEY AUTOINCREMENT, result_id INTEGER NOT NULL REFERENCES historian_results(id) ON DELETE CASCADE,
              machine_code TEXT NOT NULL, metric TEXT NOT NULL, value REAL NOT NULL, unit TEXT NULL, quality TEXT NOT NULL,
              event_time_utc TEXT NOT NULL);
            """,
            "CREATE INDEX IF NOT EXISTS ix_telemetry_machine_metric_time ON historian_telemetry(machine_code, metric, event_time_utc);",
            """
            CREATE TABLE IF NOT EXISTS historian_run_events (
              id INTEGER PRIMARY KEY AUTOINCREMENT, event_type TEXT NOT NULL, at_utc TEXT NOT NULL, note TEXT NULL);
            """,
            "CREATE INDEX IF NOT EXISTS ix_run_events_time ON historian_run_events(at_utc);",
        }),

        // SM-2 (.superpowers/sdd/2026-07-29-dotA-single-machine-sellable-blueprint/task-2-brief.md) —
        // data lineage, durable: whether a result row came from a fabricated (simulated/demo) machine.
        // NULLable, no DEFAULT, deliberately: a row written before this migration ran is left NULL by
        // SQLite's own ALTER-TABLE-ADD-COLUMN semantics (no default = NULL for every pre-existing row),
        // which is exactly this project's chosen "Unknown provenance" state for a pre-migration row —
        // see HistorianResultRecord.IsFabricated's own doc comment for why that is a THIRD state, never
        // silently folded into "real" or "fabricated". Every row appended from this task onward always
        // supplies an explicit 0/1 (HistorianResultRecord.From always computes a concrete bool) — NULL
        // only ever describes data this column did not exist to classify yet.
        (2, new[]
        {
            "ALTER TABLE historian_results ADD COLUMN is_fabricated INTEGER NULL;",
        }),
    };

    // Shared column list for historian_results SELECTs (QueryResultsAsync / QueryBySerialAsync) so both
    // stay in lockstep with ReadResultRow's ordinal lookups.
    private const string ResultColumns = """
        id, machine_code, device_class, machine_type, reading_kind, cycle_counter, serial_number, verdict,
        recipe_code, recipe_version, key_metric_name, key_metric_value, key_metric_unit,
        ng_count, point_count, ack_success, ack_duplicate, ack_queued,
        genealogy_json, measurements_json, event_time_utc, ingested_at_utc, is_fabricated
        """;

    /// <summary>🔴 Construction does DISK WORK, synchronously, and can throw. It creates the directory,
    /// opens a connection and runs the migration ladder to completion before returning, so a store that
    /// exists is a store whose schema is current — there is no separate initialise step and no lazily
    /// migrated state. The cost of that is that a permissions failure or a full disk surfaces from a
    /// constructor, in whatever thread happened to build the object graph. A database stamped with a
    /// version NEWER than this build knows is not a failure and not detected: the ladder simply has nothing
    /// to apply, and the store proceeds against a schema it was not written for.</summary>
    /// <param name="directory">Where <c>historian.db</c> lives. It is created if absent, including missing
    /// parents. <see langword="null"/> selects a fixed machine-wide location under the common
    /// application-data folder — machine-wide and not per-user, so every account on the box reads one
    /// history, and NOT beside the executable, so an upgrade that replaces the binaries leaves the data
    /// where it is. A caller that passes a relative path gets a database resolved against the process's
    /// current directory, which is why the resolved answer is published as
    /// <see cref="DbPath"/>.</param>
    public SqliteHistorianStore(string? directory = null)
    {
        var root = ResolveRoot(directory);
        Directory.CreateDirectory(root);
        DbPath = Path.Combine(root, "historian.db");
        EnsureSchema();
    }

    /// <summary>🔴 <b>OWNER ITEM 72 — the historian relocation variable, opened on the STORE by the owner's
    /// ruling of 2026-08-25 (<i>"open the seam"</i>). It is the same literal the composition root has read
    /// since WS-A-T14, deliberately, and that sameness is the whole design.</b>
    ///
    /// <para><b>Who wins, derived rather than assumed.</b> Before this const there was exactly ONE reader of
    /// <c>ST4I_HISTORIAN_DIR</c> in <c>src/</c> — <c>St4i.EngineApi/Program.cs</c>, at the composition root —
    /// which reads it and threads the value into this constructor as an EXPLICIT argument. There are three
    /// readers now (that one, this store and <see cref="OeeSettingsStore"/>), and the precedence that decides
    /// between them is the <c>explicit path &gt; environment variable &gt; default</c> order F-1 established
    /// for all eighteen machine-wide roots: <b><c>Program.cs</c>'s explicit argument WINS</b>, and this store's
    /// own env read is what answers for every OTHER construction site — <c>new SqliteHistorianStore()</c>
    /// with no argument, which no host performs today and which every direct-construction test does.</para>
    ///
    /// <para>🔴 <b>The one window in which those two readers can disagree, named rather than denied.</b> They
    /// read the SAME variable, so they can only differ if its value CHANGES between the composition root's
    /// read (once, while the container is built) and a later construction. That is a real window and it is
    /// not closed here; what is closed is the shape item 65 had to pay for, where two readers consulted two
    /// different sources and answered differently on the same input. Here the source is one name and the
    /// order is stated.</para></summary>
    public const string EnvVarDir = "ST4I_HISTORIAN_DIR";

    /// <summary>🔴 <b>The historian root — <c>%ProgramData%\ST4I\sim\historian</c> — and it is BYTE-IDENTICAL
    /// to what this method computed before the seam existed.</b> Item 72's seam makes the root OVERRIDABLE;
    /// it does not move it. Every deployment that sets no variable and passes no directory resolves exactly
    /// the path it resolved before, which matters more here than anywhere else in the tree: this folder holds
    /// the event table every reported OEE number is computed from. The witness that the default did not move
    /// is <c>HistorianRootSeamTests.WithNoVariableSet_BothStoresResolveTheUnchangedProductionDefault</c>.
    /// <para>Made <see langword="public"/> by the same ruling: it was private, so nothing outside these two
    /// files could state what the production answer IS, and a test asserting "the default did not move" had
    /// to re-spell the path instead of reading it.</para></summary>
    /// <returns>The machine-wide historian directory. Pure path arithmetic — creates nothing.</returns>
    public static string DefaultRoot() => Path.Combine(
        Environment.GetFolderPath(Environment.SpecialFolder.CommonApplicationData), "ST4I", "sim", "historian");

    /// <summary>Resolves the effective historian directory: <paramref name="directory"/> if given, else
    /// <see cref="EnvVarDir"/> if set, else <see cref="DefaultRoot"/> — the identical contract
    /// <c>DeviceIdentityStore.ResolveRoot</c> and its siblings carry. Pure path arithmetic: it does not create
    /// anything on disk (the constructor does that).</summary>
    /// <param name="directory">An explicit override, or <see langword="null"/>/whitespace to fall through to
    /// the environment variable and then to the default.</param>
    /// <returns>The directory <c>historian.db</c> will be opened in.</returns>
    public static string ResolveRoot(string? directory = null)
    {
        if (!string.IsNullOrWhiteSpace(directory)) return directory;
        var env = Environment.GetEnvironmentVariable(EnvVarDir);
        return string.IsNullOrWhiteSpace(env) ? DefaultRoot() : env;
    }

    // ─────────────────────────────────────────────────────────────────────
    // Schema
    // ─────────────────────────────────────────────────────────────────────

    /// <summary>🔴 WS-F4 Task 1 — the highest migration rung this build understands, DERIVED from
    /// <see cref="Migrations"/> rather than restated, so a new rung cannot leave the ceiling behind.
    /// A database above this was written by a newer build; see
    /// <see cref="SchemaFromTheFutureException"/> for why that must be a refusal and not a skip.</summary>
    private static long HighestKnownSchemaVersion => Migrations[^1].Version;

    private void EnsureSchema()
    {
        using var connection = OpenConnection();

        // 🔴 WS-F4 Task 1 — THE SCHEMA CEILING. Refuse a database written by a NEWER build before the
        // ladder below is allowed to skip it silently. This call must stay ABOVE the loop: the loop's own
        // `continue` skips every rung when the file is ahead, so a guard placed inside it could never fire
        // on the one input that matters. HighestKnownSchemaVersion is derived from Migrations, so adding a
        // rung raises the ceiling automatically and the two can never drift apart.
        SchemaFromTheFutureException.ThrowIfDatabaseIsNewerThanThisBuild(
            connection, DbPath, HighestKnownSchemaVersion);

        var currentVersion = GetUserVersion(connection);

        foreach (var (version, statements) in Migrations)
        {
            if (version <= currentVersion) continue;

            using var transaction = connection.BeginTransaction();
            foreach (var statement in statements)
            {
                using var cmd = connection.CreateCommand();
                cmd.Transaction = transaction;
                cmd.CommandText = statement;
                cmd.ExecuteNonQuery();
            }

            using (var pragmaCmd = connection.CreateCommand())
            {
                pragmaCmd.Transaction = transaction;
                // PRAGMA user_version does not support bind parameters. `version` always comes from this
                // fixed, code-defined migration ladder above (never external/user input), so interpolating
                // it here carries none of the injection risk parameterization guards against.
                pragmaCmd.CommandText = $"PRAGMA user_version = {version};";
                pragmaCmd.ExecuteNonQuery();
            }

            transaction.Commit();
            currentVersion = version;
        }
    }

    private static long GetUserVersion(SqliteConnection connection)
    {
        using var cmd = connection.CreateCommand();
        cmd.CommandText = "PRAGMA user_version;";
        var result = cmd.ExecuteScalar();
        return result is null ? 0 : Convert.ToInt64(result, CultureInfo.InvariantCulture);
    }

    // ─────────────────────────────────────────────────────────────────────
    // Connections
    // ─────────────────────────────────────────────────────────────────────

    private SqliteConnection OpenConnection()
    {
        var connection = new SqliteConnection($"Data Source={DbPath}");
        connection.Open();
        ApplyPragmas(connection);
        return connection;
    }

    private async Task<SqliteConnection> OpenConnectionAsync(CancellationToken ct)
    {
        var connection = new SqliteConnection($"Data Source={DbPath}");
        await connection.OpenAsync(ct).ConfigureAwait(false);
        await ApplyPragmasAsync(connection, ct).ConfigureAwait(false);
        return connection;
    }

    private static void ApplyPragmas(SqliteConnection connection)
    {
        foreach (var pragma in OpenPragmas)
        {
            using var cmd = connection.CreateCommand();
            cmd.CommandText = pragma;
            cmd.ExecuteNonQuery();
        }
    }

    private static async Task ApplyPragmasAsync(SqliteConnection connection, CancellationToken ct)
    {
        foreach (var pragma in OpenPragmas)
        {
            using var cmd = connection.CreateCommand();
            cmd.CommandText = pragma;
            await cmd.ExecuteNonQueryAsync(ct).ConfigureAwait(false);
        }
    }

    // ─────────────────────────────────────────────────────────────────────
    // Append
    // ─────────────────────────────────────────────────────────────────────

    /// <summary>The batch is ONE transaction across BOTH tables, which is where the interface's all-or-none
    /// promise is actually kept. Each result is inserted, its new row id is read back with
    /// <c>last_insert_rowid()</c>, and that id keys the sample rows that follow — so the samples are tied to
    /// their reading by a value read inside the same connection, and this method is not safe to
    /// parallelise over one connection even though nothing here prevents it. Row ids are assigned in the
    /// order the caller supplied, which is what makes "newest first" elsewhere mean "last supplied
    /// first". An empty batch returns before a connection is even opened.</summary>
    public async Task AppendResultsAsync(IReadOnlyList<HistorianResultRecord> records, CancellationToken ct)
    {
        if (records.Count == 0) return;

        using var connection = await OpenConnectionAsync(ct).ConfigureAwait(false);
        using var transaction = connection.BeginTransaction();

        const string insertResultSql = """
            INSERT INTO historian_results
                (machine_code, device_class, machine_type, reading_kind, cycle_counter, serial_number, verdict,
                 recipe_code, recipe_version, key_metric_name, key_metric_value, key_metric_unit,
                 ng_count, point_count, ack_success, ack_duplicate, ack_queued,
                 genealogy_json, measurements_json, event_time_utc, ingested_at_utc, is_fabricated)
            VALUES
                (@machine_code, @device_class, @machine_type, @reading_kind, @cycle_counter, @serial_number, @verdict,
                 @recipe_code, @recipe_version, @key_metric_name, @key_metric_value, @key_metric_unit,
                 @ng_count, @point_count, @ack_success, @ack_duplicate, @ack_queued,
                 @genealogy_json, @measurements_json, @event_time_utc, @ingested_at_utc, @is_fabricated);
            """;

        const string insertTelemetrySql = """
            INSERT INTO historian_telemetry (result_id, machine_code, metric, value, unit, quality, event_time_utc)
            VALUES (@result_id, @machine_code, @metric, @value, @unit, @quality, @event_time_utc);
            """;

        foreach (var record in records)
        {
            var eventTimeIso = ToIso(record.EventTimeUtc);

            using (var cmd = connection.CreateCommand())
            {
                cmd.Transaction = transaction;
                cmd.CommandText = insertResultSql;
                cmd.Parameters.AddWithValue("@machine_code", record.MachineCode);
                cmd.Parameters.AddWithValue("@device_class", record.DeviceClass);
                cmd.Parameters.AddWithValue("@machine_type", record.MachineType);
                cmd.Parameters.AddWithValue("@reading_kind", record.ReadingKind);
                cmd.Parameters.AddWithValue("@cycle_counter", record.CycleCounter);
                cmd.Parameters.AddWithValue("@serial_number", record.SerialNumber);
                cmd.Parameters.AddWithValue("@verdict", record.Verdict);
                cmd.Parameters.AddWithValue("@recipe_code", (object?)record.RecipeCode ?? DBNull.Value);
                cmd.Parameters.AddWithValue("@recipe_version", (object?)record.RecipeVersion ?? DBNull.Value);
                cmd.Parameters.AddWithValue("@key_metric_name", (object?)record.KeyMetricName ?? DBNull.Value);
                cmd.Parameters.AddWithValue("@key_metric_value", (object?)record.KeyMetricValue ?? DBNull.Value);
                cmd.Parameters.AddWithValue("@key_metric_unit", (object?)record.KeyMetricUnit ?? DBNull.Value);
                cmd.Parameters.AddWithValue("@ng_count", record.NgCount);
                cmd.Parameters.AddWithValue("@point_count", record.PointCount);
                cmd.Parameters.AddWithValue("@ack_success", record.AckSuccess ? 1 : 0);
                cmd.Parameters.AddWithValue("@ack_duplicate", record.AckDuplicate ? 1 : 0);
                cmd.Parameters.AddWithValue("@ack_queued", record.AckQueued ? 1 : 0);
                cmd.Parameters.AddWithValue("@genealogy_json", (object?)record.GenealogyJson ?? DBNull.Value);
                cmd.Parameters.AddWithValue("@measurements_json", (object?)record.MeasurementsJson ?? DBNull.Value);
                cmd.Parameters.AddWithValue("@event_time_utc", eventTimeIso);
                cmd.Parameters.AddWithValue("@ingested_at_utc", ToIso(record.IngestedAtUtc));
                cmd.Parameters.AddWithValue("@is_fabricated", record.IsFabricated switch
                {
                    true => 1,
                    false => 0,
                    null => DBNull.Value,
                });
                await cmd.ExecuteNonQueryAsync(ct).ConfigureAwait(false);
            }

            long resultId;
            using (var idCmd = connection.CreateCommand())
            {
                idCmd.Transaction = transaction;
                idCmd.CommandText = "SELECT last_insert_rowid();";
                resultId = (long)(await idCmd.ExecuteScalarAsync(ct).ConfigureAwait(false))!;
            }

            foreach (var sample in record.TelemetrySamples)
            {
                using var cmd = connection.CreateCommand();
                cmd.Transaction = transaction;
                cmd.CommandText = insertTelemetrySql;
                cmd.Parameters.AddWithValue("@result_id", resultId);
                cmd.Parameters.AddWithValue("@machine_code", record.MachineCode);
                cmd.Parameters.AddWithValue("@metric", sample.Metric);
                cmd.Parameters.AddWithValue("@value", sample.Value);
                cmd.Parameters.AddWithValue("@unit", (object?)sample.Unit ?? DBNull.Value);
                cmd.Parameters.AddWithValue("@quality", sample.Quality);
                cmd.Parameters.AddWithValue("@event_time_utc", eventTimeIso);
                await cmd.ExecuteNonQueryAsync(ct).ConfigureAwait(false);
            }
        }

        await transaction.CommitAsync(ct).ConfigureAwait(false);
    }

    /// <summary>One statement, no transaction, and no de-duplication of any kind: the same transition
    /// written twice becomes two rows. That matters because the run-time computation reading these rows is
    /// a state machine, not a counter — a second consecutive <c>Start</c> is absorbed and a
    /// <c>Stop</c> with no open <c>Start</c> is discarded, so a duplicate row is stored but does not
    /// double-count. Nothing here validates the event type against the set the aggregate
    /// recognises.</summary>
    public async Task AppendRunEventAsync(HistorianRunEvent runEvent, CancellationToken ct)
    {
        using var connection = await OpenConnectionAsync(ct).ConfigureAwait(false);
        using var cmd = connection.CreateCommand();
        cmd.CommandText = """
            INSERT INTO historian_run_events (event_type, at_utc, note)
            VALUES (@event_type, @at_utc, @note);
            """;
        cmd.Parameters.AddWithValue("@event_type", runEvent.EventType);
        cmd.Parameters.AddWithValue("@at_utc", ToIso(runEvent.AtUtc));
        cmd.Parameters.AddWithValue("@note", (object?)runEvent.Note ?? DBNull.Value);
        await cmd.ExecuteNonQueryAsync(ct).ConfigureAwait(false);
    }

    // ─────────────────────────────────────────────────────────────────────
    // Query — results
    // ─────────────────────────────────────────────────────────────────────

    /// <summary>Builds the filter from whichever members of the query are non-null, appends the
    /// provenance clause, then runs TWO statements: a count for the page total and a select for the page
    /// itself. They are not wrapped in a transaction, so a commit landing between them can make
    /// <see cref="HistorianResultsPage.Total"/> describe a slightly different population than
    /// <see cref="HistorianResultsPage.Items"/> — on a live line, where rows arrive continuously, that is
    /// the normal case rather than a race to be surprised by. Paging is by row id descending, which is
    /// insertion order and NOT event time: a batch appended late but timestamped early sorts as new
    /// here.</summary>
    public async Task<HistorianResultsPage> QueryResultsAsync(HistorianResultQuery query, CancellationToken ct)
    {
        using var connection = await OpenConnectionAsync(ct).ConfigureAwait(false);

        var whereClauses = new List<string>();
        var parameters = new List<(string Name, object Value)>();

        if (query.MachineCode is not null)
        {
            whereClauses.Add("machine_code = @machine_code");
            parameters.Add(("@machine_code", query.MachineCode));
        }
        if (query.From is not null)
        {
            whereClauses.Add("event_time_utc >= @from");
            parameters.Add(("@from", ToIso(query.From.Value)));
        }
        if (query.To is not null)
        {
            whereClauses.Add("event_time_utc <= @to");
            parameters.Add(("@to", ToIso(query.To.Value)));
        }
        if (query.SerialNumber is not null)
        {
            whereClauses.Add("serial_number = @serial_number");
            parameters.Add(("@serial_number", query.SerialNumber));
        }
        if (query.Verdict is not null)
        {
            whereClauses.Add("verdict = @verdict");
            parameters.Add(("@verdict", query.Verdict));
        }
        if (query.ReadingKind is not null)
        {
            whereClauses.Add("reading_kind = @reading_kind");
            parameters.Add(("@reading_kind", query.ReadingKind));
        }

        var effectiveWhereClauses = await ApplyRealPresenceGateAsync(connection, whereClauses, parameters, query.IncludeFabricated, ct)
            .ConfigureAwait(false);
        var whereSql = effectiveWhereClauses.Count > 0 ? " WHERE " + string.Join(" AND ", effectiveWhereClauses) : string.Empty;

        int total;
        using (var countCmd = connection.CreateCommand())
        {
            countCmd.CommandText = $"SELECT COUNT(*) FROM historian_results{whereSql};";
            foreach (var (name, value) in parameters) countCmd.Parameters.AddWithValue(name, value);
            total = Convert.ToInt32((long)(await countCmd.ExecuteScalarAsync(ct).ConfigureAwait(false))!, CultureInfo.InvariantCulture);
        }

        var items = new List<HistorianResultRow>();
        using (var selectCmd = connection.CreateCommand())
        {
            selectCmd.CommandText = $"""
                SELECT {ResultColumns}
                FROM historian_results{whereSql}
                ORDER BY id DESC
                LIMIT @limit OFFSET @offset;
                """;
            foreach (var (name, value) in parameters) selectCmd.Parameters.AddWithValue(name, value);
            selectCmd.Parameters.AddWithValue("@limit", query.Limit);
            selectCmd.Parameters.AddWithValue("@offset", query.Offset);

            using var reader = await selectCmd.ExecuteReaderAsync(ct).ConfigureAwait(false);
            while (await reader.ReadAsync(ct).ConfigureAwait(false))
            {
                items.Add(ReadResultRow(reader));
            }
        }

        return new HistorianResultsPage(items, total, query.Limit, query.Offset);
    }

    /// <summary>
    /// SM-2 fix round 1 (review IMPORTANT 1a) — the "real-presence gate": the one rule this store applies so
    /// fabricated data is never silently blended with real data. It is defined ONCE, here, and every read
    /// that gates reaches it rather than restating it.
    ///
    /// <para>📎 <b>THE OPENING SENTENCE THAT STOOD HERE IS RETRACTED — 2026-08-22 (AU-1), quoted verbatim,
    /// nothing struck through and nothing deleted.</b> It read: <i>"the one rule every customer-facing
    /// historian query/aggregate in this store applies so fabricated data is never silently blended with real
    /// data."</i> The word that fails is <b>every</b>. AL-1 measured this on 2026-08-20 and retracted the
    /// claim in <c>tools/machine-simulator/docs/owner-decisions.md</c>; the retraction never reached this
    /// file, so the false sentence went on being the one a reader of the CODE saw for two more days. That gap
    /// — a claim retracted in the record but left standing at its source — is the same shape as the defect
    /// the record exists to end, and it is why this correction is written here and not only there.</para>
    ///
    /// <para><b>What is true instead, listed rather than counted.</b> Reads that reach this gate:
    /// <see cref="QueryResultsAsync"/>, <see cref="QueryBySerialAsync"/>, <see cref="AggregateForOeeAsync"/>,
    /// and — since 2026-08-22 — <see cref="QueryTelemetryAsync"/>. Reads that do not:
    /// <see cref="QueryRunEventsAsync"/>, whose table carries neither a machine nor a provenance column, and
    /// <see cref="GetStatsAsync"/>, which is deliberately a report ABOUT the store rather than a customer view
    /// of its contents. 🔴 And the half that keeps <b>every</b> from being repaired by simply adding the fourth
    /// name: <see cref="QueryTelemetryAsync"/> CAN now reach this gate but its shipped caller does not ask it
    /// to — <c>GET /v1/historian/telemetry</c> still returns fabricated samples by default. So this gate is
    /// reachable from four reads and DEFAULT-ON for three. See item 17 in the owner-decisions record.</para>
    ///
    /// <b>Round 1 correction:</b> the original version treated "explicitly fabricated" and "unknown
    /// provenance" identically — both were excluded ONLY when at least one explicitly-real row was also
    /// present in the exact same scope, and BOTH passed through unfiltered otherwise. That let a real
    /// machine which simply cycles less often than the demo fleet (a slow assembly station, say) produce a
    /// narrow historian/report window containing ZERO of its own rows but many demo rows — the gate would
    /// then hand back the demo fleet's rows COMPLETELY UNFILTERED for that window, while
    /// <c>St4i.EngineApi.Fleet.FleetHost.Snapshot</c> was, at the very same moment, reporting <c>HasMixedProvenance:
    /// true</c> and real-only live totals for the same fleet — two customer-facing screens disagreeing
    /// about the same moment. <c>is_fabricated = 1</c> is unambiguous (this codebase wrote it itself, at
    /// commit time — see <see cref="HistorianResultRecord.IsFabricated"/>) — there is never a legitimate
    /// reason to show it on a customer-facing surface by default, so it is now EXCLUDED UNCONDITIONALLY.
    /// The presence-gate heuristic below is reserved for what it actually exists to serve: deciding whether
    /// <see langword="null"/> ("Unknown provenance," this project's honest label for a pre-migration row —
    /// see <see cref="HistorianResultRecord.IsFabricated"/>'s own doc comment) is safe to include.
    ///
    /// Given the SAME scope a caller already asked for (<paramref name="whereClauses"/>/
    /// <paramref name="parameters"/> — machine/time/serial/etc., exactly as filtered):
    ///
    ///  - If <paramref name="includeFabricated"/> is <see langword="true"/> (the explicit escape hatch —
    ///    see <see cref="HistorianResultQuery.IncludeFabricated"/>'s own doc comment), the gate is skipped
    ///    entirely — every row in scope, regardless of provenance.
    ///  - Else, this probes whether at least one row in that EXACT scope is explicitly real
    ///    (<c>is_fabricated = 0</c>). If so, the returned clause additionally requires
    ///    <c>is_fabricated = 0</c> — both fabricated AND unknown rows are excluded, because once real data
    ///    is known to exist in this exact scope, an uncertain row can no longer be trusted to belong with
    ///    it.
    ///  - Else (nothing explicitly real in scope), the returned clause requires
    ///    <c>is_fabricated IS NULL OR is_fabricated = 0</c> — explicit fabricated rows are STILL excluded
    ///    (never shown by default, demo or not), but Unknown rows pass through: a pre-migration row stays
    ///    readable rather than silently vanishing the moment nothing in scope can prove it real.
    ///
    /// <b>Known residual limitation (accepted, written down rather than fixed):</b> once ANY explicitly-real
    /// row exists in a scope, EVERY Unknown row in that same scope is excluded too — including a
    /// legitimately-real pre-migration row that simply predates this column. Acceptable today because no
    /// paying customer's historian data predates this migration (verified against this project's own
    /// timeline — see the task report). If that premise is ever wrong for some install, upgrading a customer
    /// whose real machine reappears post-upgrade would silently drop that machine's OWN pre-migration
    /// history from a report the instant its first post-upgrade row lands. There is no way to distinguish
    /// that case from "Unknown = actually fabricated" without a second column recording WHEN the row was
    /// written relative to the migration, which this task does not add.
    ///
    /// <b>Fix 1 (task-7 review, CRITICAL) — this method's own "excluded UNCONDITIONALLY" behavior above is
    /// still exactly true GIVEN <paramref name="includeFabricated"/> is <see langword="false"/>; what
    /// changed is who decides that boolean.</b> <c>St4i.EngineApi.Endpoints.HistorianEndpoints</c> used to
    /// hardcode <c>includeFabricated ?? false</c> on every route with no carve-out, which meant an
    /// exhibition/demo install (100% <c>Simulated</c> roster) could never produce a single default-visible
    /// row anywhere — not "narrower than intended," literally zero, permanently. That endpoint-layer default
    /// now runs through <c>HistorianEndpoints.ResolveIncludeFabricated</c> instead, which flips to
    /// <see langword="true"/> when <see cref="St4i.EdgeCore.Config.DemoModeGate.Enabled"/> (see that
    /// method's own doc comment for why the default is keyed off that flag rather than the live roster).
    /// This store method is unchanged and still the right place to enforce the rule once a caller HAS
    /// decided what <paramref name="includeFabricated"/> should be — it does not itself know about Demo
    /// mode, and should not.
    /// </summary>
    /// <param name="connection">The open connection to probe on. It is the CALLER's connection, so the
    /// probe observes whatever transaction state that caller has established.</param>
    /// <param name="whereClauses">The scope being gated, as SQL fragments joined with <c>AND</c>. Returned
    /// unchanged when <paramref name="includeFabricated"/> is set, and otherwise returned with exactly one
    /// provenance clause appended — never reordered and never rewritten.</param>
    /// <param name="parameters">The bindings for <paramref name="whereClauses"/>. The probe binds the same
    /// set the caller will bind, which is what makes "is there real data in this scope" a question about
    /// the caller's scope rather than a wider one.</param>
    /// <param name="includeFabricated">When <see langword="true"/> the gate is skipped entirely and the
    /// clauses come back untouched — the opt-in that lets a demo or exhibition install see its own rows.</param>
    /// <param name="ct">Cancels the probe query.</param>
    /// <param name="transaction">The open transaction the probe must run inside, or <see langword="null"/>
    /// for the callers that read outside one. Supplied only by
    /// <see cref="AggregateForOeeAsync"/>, whose gate probe has to share the one snapshot its two counts
    /// share — see that method's doc comment. <c>Microsoft.Data.Sqlite</c> refuses to execute a command on a
    /// connection with an open transaction unless the command is told about it, so this is required rather
    /// than optional whenever the caller has one.</param>
    private static async Task<List<string>> ApplyRealPresenceGateAsync(
        SqliteConnection connection, List<string> whereClauses, List<(string Name, object Value)> parameters,
        bool includeFabricated, CancellationToken ct, SqliteTransaction? transaction = null)
    {
        if (includeFabricated) return whereClauses;

        var probeClauses = new List<string>(whereClauses) { "is_fabricated = 0" };
        var probeWhereSql = " WHERE " + string.Join(" AND ", probeClauses);

        using var probeCmd = connection.CreateCommand();
        probeCmd.Transaction = transaction;
        probeCmd.CommandText = $"SELECT EXISTS(SELECT 1 FROM historian_results{probeWhereSql});";
        foreach (var (name, value) in parameters) probeCmd.Parameters.AddWithValue(name, value);
        var hasReal = Convert.ToInt64(
            (await probeCmd.ExecuteScalarAsync(ct).ConfigureAwait(false))!, CultureInfo.InvariantCulture) != 0;

        var effectiveClauses = new List<string>(whereClauses)
        {
            hasReal ? "is_fabricated = 0" : "(is_fabricated IS NULL OR is_fabricated = 0)",
        };
        return effectiveClauses;
    }

    /// <summary>The same provenance gate as the paged browse, over a filter of exactly one column, with no
    /// paging and no upper bound on the result — the whole trace comes back in one list. Ordering is by
    /// event time, and event times are stored as ISO-8601 TEXT, so this is a lexicographic sort that
    /// happens to be chronological because every value is written in fixed-width round-trip UTC. A row
    /// written by anything that did not use that format would sort into the wrong place rather than
    /// fail.</summary>
    public async Task<IReadOnlyList<HistorianResultRow>> QueryBySerialAsync(string serialNumber, CancellationToken ct, bool includeFabricated = false)
    {
        using var connection = await OpenConnectionAsync(ct).ConfigureAwait(false);

        // SM-2 fix round 1 (review IMPORTANT 2) — the web "View genealogy" dialog's own data source,
        // reachable from every historian row's row-action, was left unfiltered by the original SM-2 pass.
        // Gated with the SAME ApplyRealPresenceGateAsync rule QueryResultsAsync/AggregateForOeeAsync use —
        // a fabricated reading can no longer silently present as a real unit's genealogy trace.
        var whereClauses = new List<string> { "serial_number = @serial_number" };
        var parameters = new List<(string Name, object Value)> { ("@serial_number", serialNumber) };
        var effectiveClauses = await ApplyRealPresenceGateAsync(connection, whereClauses, parameters, includeFabricated, ct)
            .ConfigureAwait(false);

        using var cmd = connection.CreateCommand();
        cmd.CommandText = $"""
            SELECT {ResultColumns}
            FROM historian_results
            WHERE {string.Join(" AND ", effectiveClauses)}
            ORDER BY event_time_utc;
            """;
        foreach (var (name, value) in parameters) cmd.Parameters.AddWithValue(name, value);

        var results = new List<HistorianResultRow>();
        using var reader = await cmd.ExecuteReaderAsync(ct).ConfigureAwait(false);
        while (await reader.ReadAsync(ct).ConfigureAwait(false))
        {
            results.Add(ReadResultRow(reader));
        }
        return results;
    }

    // Reconstructs a HistorianResultRecord straight from historian_results columns. TelemetrySamples is
    // ALWAYS empty on rows returned this way (QueryResultsAsync / QueryBySerialAsync) — telemetry lives in
    // a separate table keyed by result_id and is fetched on demand via QueryTelemetryAsync instead of being
    // joined/aggregated back in here on every results query.
    private static HistorianResultRow ReadResultRow(SqliteDataReader reader)
    {
        var id = reader.GetInt64(reader.GetOrdinal("id"));
        var record = new HistorianResultRecord(
            MachineCode: reader.GetString(reader.GetOrdinal("machine_code")),
            DeviceClass: reader.GetString(reader.GetOrdinal("device_class")),
            MachineType: reader.GetString(reader.GetOrdinal("machine_type")),
            ReadingKind: reader.GetString(reader.GetOrdinal("reading_kind")),
            CycleCounter: reader.GetInt64(reader.GetOrdinal("cycle_counter")),
            SerialNumber: reader.GetString(reader.GetOrdinal("serial_number")),
            Verdict: reader.GetString(reader.GetOrdinal("verdict")),
            RecipeCode: GetNullableString(reader, "recipe_code"),
            RecipeVersion: GetNullableString(reader, "recipe_version"),
            KeyMetricName: GetNullableString(reader, "key_metric_name"),
            KeyMetricValue: GetNullableDouble(reader, "key_metric_value"),
            KeyMetricUnit: GetNullableString(reader, "key_metric_unit"),
            NgCount: reader.GetInt32(reader.GetOrdinal("ng_count")),
            PointCount: reader.GetInt32(reader.GetOrdinal("point_count")),
            AckSuccess: reader.GetInt64(reader.GetOrdinal("ack_success")) != 0,
            AckDuplicate: reader.GetInt64(reader.GetOrdinal("ack_duplicate")) != 0,
            AckQueued: reader.GetInt64(reader.GetOrdinal("ack_queued")) != 0,
            GenealogyJson: GetNullableString(reader, "genealogy_json"),
            MeasurementsJson: GetNullableString(reader, "measurements_json"),
            EventTimeUtc: ParseIso(reader.GetString(reader.GetOrdinal("event_time_utc"))),
            IngestedAtUtc: ParseIso(reader.GetString(reader.GetOrdinal("ingested_at_utc"))),
            TelemetrySamples: Array.Empty<TelemetrySampleRecord>(),
            IsFabricated: GetNullableBool(reader, "is_fabricated"));

        return new HistorianResultRow(id, record);
    }

    // ─────────────────────────────────────────────────────────────────────
    // Query — telemetry / run-events
    // ─────────────────────────────────────────────────────────────────────

    /// <summary>The window is matched with a text <c>BETWEEN</c> over the same fixed-width ISO-8601 encoding
    /// the ordering relies on, and both metric and machine are compared as stored: no trimming, no case
    /// folding, no aliasing of metric names.
    ///
    /// <para>📎 <b>THE SUMMARY THAT STOOD HERE IS RETRACTED — 2026-08-22 (AU-1), quoted verbatim, nothing
    /// struck through and nothing deleted.</b> It read: <i>"🔴 The one read in this class that does NOT call
    /// the provenance gate — the three around it all do. It is not an omission that a flag would fix: the
    /// sample rows carry a machine code and an event time but no provenance column, so there is nothing here
    /// to filter on without joining back to the result row, and this method deliberately does not join."</i>
    /// Two of its three clauses survive re-measurement and one does not. TRUE: the sample rows carry no
    /// provenance column of their own, and before 2026-08-22 this method did not join. FALSE: <i>"not an
    /// omission that a flag would fix."</i> A flag fixes it, because the join it calls impossible is TOTAL —
    /// <c>historian_telemetry.result_id</c> is <c>NOT NULL REFERENCES historian_results(id)</c>, so every
    /// sample row has exactly one parent reading, and that parent carries <c>is_fabricated</c>. The provenance
    /// of a sample was never missing; it was one hop away and unjoined.</para>
    ///
    /// <para><b>How the gate is reached, and why it is not re-implemented here.</b> When
    /// <paramref name="includeFabricated"/> is <see langword="false"/> this delegates to the SAME
    /// <see cref="ApplyRealPresenceGateAsync"/> the three reads around it call, over a scope expressed on
    /// <c>historian_results</c>, and applies the clause it returns through
    /// <c>result_id IN (SELECT id FROM historian_results WHERE …)</c>. There is no second copy of the rule, so
    /// a future change to the rule cannot leave this read behind — which is precisely how this read fell
    /// behind in the first place.</para>
    ///
    /// <para>🔴 <b>One deliberate imprecision, stated rather than smoothed over.</b> The gate probe's scope is
    /// machine + window, NOT machine + metric + window, because <c>historian_results</c> has no metric column
    /// — a reading is not per-metric. So the probe asks "is any reading from this machine in this window
    /// explicitly real?" rather than "…that produced this metric". That is WIDER than the caller's filter, and
    /// wider in the STRICTER direction: a real reading elsewhere in the window makes <c>hasReal</c> true, which
    /// turns the admitted set from <c>(is_fabricated IS NULL OR is_fabricated = 0)</c> into
    /// <c>is_fabricated = 0</c> and so drops Unknown-provenance samples that a metric-scoped probe might have
    /// kept. It cannot go the other way and admit a fabricated sample: <c>is_fabricated = 1</c> is excluded
    /// under both branches.</para>
    ///
    /// <para>🔴 <b>What the default does NOT do.</b> <paramref name="includeFabricated"/> defaults to
    /// <see langword="false"/> here for parity with the reads around it, but the only shipped caller —
    /// <c>St4i.EngineApi.Endpoints.HistorianEndpoints.GetTelemetryAsync</c> — passes <see langword="true"/>
    /// unless a caller explicitly says otherwise, so <c>GET /v1/historian/telemetry</c> returns exactly the
    /// rows today that it returned before this parameter existed. That is not an oversight either; it is item
    /// 17's open half. See that endpoint's doc comment and item 17 in
    /// <c>tools/machine-simulator/docs/owner-decisions.md</c>.</para></summary>
    public async Task<IReadOnlyList<TelemetrySamplePoint>> QueryTelemetryAsync(
        string machineCode, string metric, DateTimeOffset from, DateTimeOffset to, CancellationToken ct,
        bool includeFabricated = false)
    {
        using var connection = await OpenConnectionAsync(ct).ConfigureAwait(false);

        var fromIso = ToIso(from);
        var toIso = ToIso(to);

        // Empty unless the gate is engaged. When it is empty the CommandText below is character-for-character
        // the statement this method issued before the gate existed — that identity is what makes
        // includeFabricated:true a guaranteed no-op rather than a hopefully-equivalent rewrite.
        var provenanceClause = string.Empty;
        if (!includeFabricated)
        {
            // The caller's scope, restated on historian_results. The window translates EXACTLY rather than
            // approximately: AppendResultsAsync writes one `eventTimeIso` and stamps it on the reading AND on
            // every sample of that reading, so a sample is inside this window if and only if its parent is.
            var scopeClauses = new List<string> { "machine_code = @machine_code", "event_time_utc BETWEEN @from AND @to" };
            var scopeParameters = new List<(string Name, object Value)>
            {
                ("@machine_code", machineCode), ("@from", fromIso), ("@to", toIso),
            };

            var effectiveClauses = await ApplyRealPresenceGateAsync(
                connection, scopeClauses, scopeParameters, includeFabricated, ct).ConfigureAwait(false);

            // Only code-defined fragments are interpolated — scopeClauses above are literals written here and
            // ApplyRealPresenceGateAsync appends one of its own two literals. Every VALUE is still bound.
            provenanceClause =
                $" AND result_id IN (SELECT id FROM historian_results WHERE {string.Join(" AND ", effectiveClauses)})";
        }

        using var cmd = connection.CreateCommand();
        cmd.CommandText = $"""
            SELECT event_time_utc, value FROM historian_telemetry
            WHERE machine_code = @machine_code AND metric = @metric AND event_time_utc BETWEEN @from AND @to{provenanceClause}
            ORDER BY event_time_utc;
            """;
        cmd.Parameters.AddWithValue("@machine_code", machineCode);
        cmd.Parameters.AddWithValue("@metric", metric);
        cmd.Parameters.AddWithValue("@from", fromIso);
        cmd.Parameters.AddWithValue("@to", toIso);

        var results = new List<TelemetrySamplePoint>();
        using var reader = await cmd.ExecuteReaderAsync(ct).ConfigureAwait(false);
        while (await reader.ReadAsync(ct).ConfigureAwait(false))
        {
            results.Add(new TelemetrySamplePoint(ParseIso(reader.GetString(0)), reader.GetDouble(1)));
        }
        return results;
    }

    /// <summary>One statement, one table, no join and no gate — the run-event table has no machine column
    /// and no provenance column, so there is nothing here to restrict by. The window is a text
    /// <c>BETWEEN</c> over the same fixed-width ISO-8601 encoding the ordering relies on, inclusive at both
    /// ends. Contrast this with the query the OEE run-time term issues against the SAME table a few methods
    /// down: that one has no lower bound at all, deliberately, and the difference is documented on the
    /// interface.</summary>
    public async Task<IReadOnlyList<HistorianRunEvent>> QueryRunEventsAsync(DateTimeOffset from, DateTimeOffset to, CancellationToken ct)
    {
        using var connection = await OpenConnectionAsync(ct).ConfigureAwait(false);
        using var cmd = connection.CreateCommand();
        cmd.CommandText = """
            SELECT event_type, at_utc, note FROM historian_run_events
            WHERE at_utc BETWEEN @from AND @to
            ORDER BY at_utc;
            """;
        cmd.Parameters.AddWithValue("@from", ToIso(from));
        cmd.Parameters.AddWithValue("@to", ToIso(to));

        var results = new List<HistorianRunEvent>();
        using var reader = await cmd.ExecuteReaderAsync(ct).ConfigureAwait(false);
        while (await reader.ReadAsync(ct).ConfigureAwait(false))
        {
            var eventType = reader.GetString(0);
            var at = ParseIso(reader.GetString(1));
            var note = reader.IsDBNull(2) ? null : reader.GetString(2);
            results.Add(new HistorianRunEvent(eventType, at, note));
        }
        return results;
    }

    // ─────────────────────────────────────────────────────────────────────
    // OEE aggregate
    // ─────────────────────────────────────────────────────────────────────

    /// <summary>Where the product's OEE counting rules are actually written down, as three SQL predicates
    /// rather than as prose anywhere else: only <c>ProcessResult</c> readings are counted at all, the total
    /// is every verdict except <c>Skip</c>, and the good count is <c>Pass</c> or <c>Warn</c>. Those are
    /// stored STRINGS compared exactly, so they are pinned to the spelling of the verdict enum's members —
    /// renaming a member would leave old rows uncountable and is why that spelling is a published contract.
    /// <para>The provenance gate is probed over the machine, the reading kind and the window but
    /// deliberately WITHOUT the verdict slicing, so "is there real data here" is decided once for the
    /// window rather than separately for the numerator and the denominator. The consequence worth having is
    /// that the two counts are always drawn from the same population: a gate evaluated per count could
    /// admit a good count taken from a different set of rows than the total it is divided by, and the
    /// calculator that divides them does not bound that ratio.</para>
    /// <para>The run-time term is computed from run events with no machine filter and no window filter on
    /// the lower edge — every event up to the end of the window is replayed as a state machine, and the
    /// resulting intervals are clipped to the window. An interval still open at the end of the window is
    /// counted as running to the end of it.</para>
    /// <para>🔴 <b>THE "SAME POPULATION" SENTENCE ABOVE WAS MEASURED INCOMPLETE, 2026-08-21, task AQ-1
    /// (owner item 16), and is MADE WHOLE HERE, 2026-08-22, task AT-1 — quoted and extended in place, not
    /// deleted.</b> Sharing one gate across both counts is necessary for the two counts to come from one
    /// population, and it was never sufficient. All four statements below run on ONE connection, and
    /// outside a transaction SQLite in WAL gives EACH statement its own snapshot — so a concurrent
    /// <see cref="AppendResultsAsync"/> committing between the total and the good count made the good count
    /// see rows the total never had, and the aggregate returned <c>GoodCount &gt; TotalCount</c>. Measured on
    /// this store at the cadence the shipped <c>fleet.json</c> actually runs, that happened. The four reads
    /// are therefore now wrapped in ONE DEFERRED transaction, which is what actually delivers the single
    /// population the sentence above claims.</para>
    /// <para>The transaction is <c>deferred: true</c> ON PURPOSE and that is not a detail. This method is
    /// read-only and sits on three synchronous request paths, so it must not take a write lock:
    /// <c>Microsoft.Data.Sqlite</c>'s parameterless <c>BeginTransaction()</c> issues <c>BEGIN IMMEDIATE</c>
    /// and would do exactly that — measured, it blocked a concurrent writer until that writer failed with
    /// <c>SQLite Error 5: database is locked</c>. The deferred form issues a bare <c>BEGIN</c>, takes its
    /// read snapshot at the first read, blocks no writer at all, and holds the snapshot to the end. Both
    /// forms report <c>IsolationLevel.Serializable</c>, so the property is NOT what distinguishes them —
    /// only the deferred flag is. The residual cost is named rather than hidden: an open read transaction
    /// holds the WAL checkpointer back for its lifetime, which is why the transaction is ended as soon as
    /// the last read returns instead of at the end of the method.</para></summary>
    public async Task<OeeInputAggregate> AggregateForOeeAsync(
        string machineCode, DateTimeOffset from, DateTimeOffset to, CancellationToken ct, bool includeFabricated = false)
    {
        using var connection = await OpenConnectionAsync(ct).ConfigureAwait(false);

        // AT-1 (owner item 16, owner's ruling 2026-08-22) — ONE snapshot for all four reads below. Deferred,
        // because this method is read-only and must not take the write lock the parameterless overload takes.
        using var transaction = connection.BeginTransaction(deferred: true);

        var fromIso = ToIso(from);
        var toIso = ToIso(to);

        // SM-2 — the gate is probed over the SAME scope this aggregate counts from (machine + ProcessResult
        // + window), deliberately WITHOUT the verdict slicing below: "is there real data in this window" is
        // one question, independent of how the two counts below then slice it by verdict.
        var scopeClauses = new List<string> { "machine_code = @machine_code", "reading_kind = 'ProcessResult'", "event_time_utc BETWEEN @from AND @to" };
        var scopeParameters = new List<(string Name, object Value)> { ("@machine_code", machineCode), ("@from", fromIso), ("@to", toIso) };
        var effectiveClauses = await ApplyRealPresenceGateAsync(connection, scopeClauses, scopeParameters, includeFabricated, ct, transaction)
            .ConfigureAwait(false);
        var scopeSql = string.Join(" AND ", effectiveClauses);

        long totalCount;
        using (var cmd = connection.CreateCommand())
        {
            cmd.Transaction = transaction;
            cmd.CommandText = $"SELECT COUNT(*) FROM historian_results WHERE {scopeSql} AND verdict <> 'Skip';";
            cmd.Parameters.AddWithValue("@machine_code", machineCode);
            cmd.Parameters.AddWithValue("@from", fromIso);
            cmd.Parameters.AddWithValue("@to", toIso);
            totalCount = (long)(await cmd.ExecuteScalarAsync(ct).ConfigureAwait(false))!;
        }

        long goodCount;
        using (var cmd = connection.CreateCommand())
        {
            cmd.Transaction = transaction;
            cmd.CommandText = $"SELECT COUNT(*) FROM historian_results WHERE {scopeSql} AND verdict IN ('Pass', 'Warn');";
            cmd.Parameters.AddWithValue("@machine_code", machineCode);
            cmd.Parameters.AddWithValue("@from", fromIso);
            cmd.Parameters.AddWithValue("@to", toIso);
            goodCount = (long)(await cmd.ExecuteScalarAsync(ct).ConfigureAwait(false))!;
        }

        var runTime = await ComputeRunTimeAsync(connection, from, to, ct, transaction).ConfigureAwait(false);

        // Read-only: end the snapshot the moment the last read returns, so the WAL checkpointer is held
        // back for the shortest window this method can manage.
        await transaction.CommitAsync(ct).ConfigureAwait(false);

        return new OeeInputAggregate(machineCode, from, to, totalCount, goodCount, runTime);
    }

    // Run-time = sum of active [Start, next Stop/Estop) intervals from historian_run_events, clipped to
    // [from, to]; an unmatched trailing Start (no Stop/Estop before `to`) runs to `to`. historian_run_events
    // has no machine_code column — run state is line/system-wide, not per-machine, matching the DDL.
    // Only the interval-open/close core is implemented here; WS-A-T3 hardens edge cases (overlapping
    // starts, multi-window spans, etc.) with dedicated tests.
    private static async Task<TimeSpan> ComputeRunTimeAsync(SqliteConnection connection, DateTimeOffset from, DateTimeOffset to, CancellationToken ct, SqliteTransaction? transaction = null)
    {
        using var cmd = connection.CreateCommand();
        cmd.Transaction = transaction;
        cmd.CommandText = """
            SELECT event_type, at_utc FROM historian_run_events
            WHERE at_utc <= @to
            ORDER BY at_utc ASC;
            """;
        cmd.Parameters.AddWithValue("@to", ToIso(to));

        DateTimeOffset? activeStart = null;
        var runTime = TimeSpan.Zero;

        using var reader = await cmd.ExecuteReaderAsync(ct).ConfigureAwait(false);
        while (await reader.ReadAsync(ct).ConfigureAwait(false))
        {
            var eventType = reader.GetString(0);
            var at = ParseIso(reader.GetString(1));

            if (string.Equals(eventType, "Start", StringComparison.OrdinalIgnoreCase))
            {
                activeStart ??= at;
            }
            else if (string.Equals(eventType, "Stop", StringComparison.OrdinalIgnoreCase) ||
                     string.Equals(eventType, "Estop", StringComparison.OrdinalIgnoreCase))
            {
                if (activeStart is { } start)
                {
                    runTime += ClippedSpan(start, at, from, to);
                    activeStart = null;
                }
            }
        }

        if (activeStart is { } trailingStart)
        {
            runTime += ClippedSpan(trailingStart, to, from, to);
        }

        return runTime;
    }

    private static TimeSpan ClippedSpan(DateTimeOffset start, DateTimeOffset end, DateTimeOffset from, DateTimeOffset to)
    {
        var clippedStart = start < from ? from : start;
        var clippedEnd = end > to ? to : end;
        return clippedEnd > clippedStart ? clippedEnd - clippedStart : TimeSpan.Zero;
    }

    // ─────────────────────────────────────────────────────────────────────
    // Prune / stats
    // ─────────────────────────────────────────────────────────────────────

    /// <summary>Two deletes in one transaction: results, then run events. Telemetry is never named — those
    /// rows go with their result through the foreign key's cascade, which works only because
    /// <c>foreign_keys</c> is turned ON per connection when it is opened, not because the schema says so. A
    /// build that ever stopped applying that pragma would silently orphan telemetry instead of deleting it,
    /// and this method would still report success.
    /// <para>The count returned is the results delete only, so it under-reports what was destroyed —
    /// see the interface's own note. The prune is by EVENT time for results and by event time for run
    /// events too, so a window with no readings can still lose the run events that explain
    /// it.</para></summary>
    public async Task<int> PruneOlderThanAsync(DateTimeOffset cutoffUtc, CancellationToken ct)
    {
        using var connection = await OpenConnectionAsync(ct).ConfigureAwait(false);
        using var transaction = connection.BeginTransaction();

        var cutoffIso = ToIso(cutoffUtc);

        int deletedResults;
        using (var cmd = connection.CreateCommand())
        {
            cmd.Transaction = transaction;
            // historian_telemetry rows for these results cascade via ON DELETE CASCADE (foreign_keys=ON
            // is applied on this connection by ApplyPragmas above).
            cmd.CommandText = "DELETE FROM historian_results WHERE event_time_utc < @cutoff;";
            cmd.Parameters.AddWithValue("@cutoff", cutoffIso);
            deletedResults = await cmd.ExecuteNonQueryAsync(ct).ConfigureAwait(false);
        }

        using (var cmd = connection.CreateCommand())
        {
            cmd.Transaction = transaction;
            cmd.CommandText = "DELETE FROM historian_run_events WHERE at_utc < @cutoff;";
            cmd.Parameters.AddWithValue("@cutoff", cutoffIso);
            await cmd.ExecuteNonQueryAsync(ct).ConfigureAwait(false);
        }

        await transaction.CommitAsync(ct).ConfigureAwait(false);
        return deletedResults;
    }

    /// <summary>Four independent statements plus one file measurement, none of them in a transaction, so
    /// the five numbers are five separate observations of a moving store rather than one snapshot.
    /// <para>🔴 The size is <see cref="FileInfo.Length"/> of the main database file ALONE. This store runs
    /// in write-ahead-log mode, so recently committed data can still be sitting in the <c>-wal</c> sidecar
    /// and is not counted here: the figure can be smaller than what the history actually occupies on disk,
    /// and it does not shrink when rows are pruned either, because SQLite reuses freed pages instead of
    /// returning them. Read it as "the size of the container", never as "the size of the
    /// data".</para></summary>
    public async Task<HistorianStats> GetStatsAsync(CancellationToken ct)
    {
        using var connection = await OpenConnectionAsync(ct).ConfigureAwait(false);

        long resultCount;
        using (var cmd = connection.CreateCommand())
        {
            cmd.CommandText = "SELECT COUNT(*) FROM historian_results;";
            resultCount = (long)(await cmd.ExecuteScalarAsync(ct).ConfigureAwait(false))!;
        }

        long telemetryCount;
        using (var cmd = connection.CreateCommand())
        {
            cmd.CommandText = "SELECT COUNT(*) FROM historian_telemetry;";
            telemetryCount = (long)(await cmd.ExecuteScalarAsync(ct).ConfigureAwait(false))!;
        }

        DateTimeOffset? oldest = null;
        DateTimeOffset? newest = null;
        using (var cmd = connection.CreateCommand())
        {
            cmd.CommandText = "SELECT MIN(event_time_utc), MAX(event_time_utc) FROM historian_results;";
            using var reader = await cmd.ExecuteReaderAsync(ct).ConfigureAwait(false);
            if (await reader.ReadAsync(ct).ConfigureAwait(false))
            {
                if (!reader.IsDBNull(0)) oldest = ParseIso(reader.GetString(0));
                if (!reader.IsDBNull(1)) newest = ParseIso(reader.GetString(1));
            }
        }

        var dbSizeBytes = new FileInfo(DbPath).Length;

        return new HistorianStats(resultCount, telemetryCount, oldest, newest, dbSizeBytes);
    }

    // ─────────────────────────────────────────────────────────────────────
    // ISO-8601 round-trip helpers ("O" format, always UTC)
    // ─────────────────────────────────────────────────────────────────────

    private static string ToIso(DateTimeOffset value) => value.ToUniversalTime().ToString("O", CultureInfo.InvariantCulture);

    private static DateTimeOffset ParseIso(string value) =>
        DateTimeOffset.Parse(value, CultureInfo.InvariantCulture, DateTimeStyles.RoundtripKind);

    private static string? GetNullableString(SqliteDataReader reader, string column)
    {
        var ordinal = reader.GetOrdinal(column);
        return reader.IsDBNull(ordinal) ? null : reader.GetString(ordinal);
    }

    private static double? GetNullableDouble(SqliteDataReader reader, string column)
    {
        var ordinal = reader.GetOrdinal(column);
        return reader.IsDBNull(ordinal) ? null : reader.GetDouble(ordinal);
    }

    private static bool? GetNullableBool(SqliteDataReader reader, string column)
    {
        var ordinal = reader.GetOrdinal(column);
        return reader.IsDBNull(ordinal) ? null : reader.GetInt64(ordinal) != 0;
    }
}
