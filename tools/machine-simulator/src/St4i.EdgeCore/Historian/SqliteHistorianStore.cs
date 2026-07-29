using System.Globalization;
using Microsoft.Data.Sqlite;

namespace St4i.EdgeCore.Historian;

/// <summary>
/// WS-A-T2 — <see cref="IHistorianStore"/> on raw <c>Microsoft.Data.Sqlite</c> (no ORM). One SQLite file
/// (<c>historian.db</c>) under <paramref name="directory"/> (or <see cref="DefaultRoot"/>), 3 tables
/// (results / telemetry / run-events) created by an ordered migration ladder tracked via
/// <c>PRAGMA user_version</c>. Every public method opens a short-lived <see cref="SqliteConnection"/> (the
/// provider pools physical connections per connection-string, so this is cheap) with WAL + a busy timeout
/// so concurrent readers/writers don't fail outright, and disposes it before returning — no connection is
/// held open across calls.
/// </summary>
public sealed class SqliteHistorianStore : IHistorianStore
{
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

    public SqliteHistorianStore(string? directory = null)
    {
        var root = directory ?? DefaultRoot();
        Directory.CreateDirectory(root);
        DbPath = Path.Combine(root, "historian.db");
        EnsureSchema();
    }

    private static string DefaultRoot() => Path.Combine(
        Environment.GetFolderPath(Environment.SpecialFolder.CommonApplicationData), "ST4I", "sim", "historian");

    // ─────────────────────────────────────────────────────────────────────
    // Schema
    // ─────────────────────────────────────────────────────────────────────

    private void EnsureSchema()
    {
        using var connection = OpenConnection();
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
    /// SM-2 fix round 1 (review IMPORTANT 1a) — the "real-presence gate": the one rule every
    /// customer-facing historian query/aggregate in this store applies so fabricated data is never
    /// silently blended with real data.
    ///
    /// <b>Round 1 correction:</b> the original version treated "explicitly fabricated" and "unknown
    /// provenance" identically — both were excluded ONLY when at least one explicitly-real row was also
    /// present in the exact same scope, and BOTH passed through unfiltered otherwise. That let a real
    /// machine which simply cycles less often than the demo fleet (a slow assembly station, say) produce a
    /// narrow historian/report window containing ZERO of its own rows but many demo rows — the gate would
    /// then hand back the demo fleet's rows COMPLETELY UNFILTERED for that window, while
    /// <see cref="FleetHost.Snapshot"/> was, at the very same moment, reporting <c>HasMixedProvenance:
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
    private static async Task<List<string>> ApplyRealPresenceGateAsync(
        SqliteConnection connection, List<string> whereClauses, List<(string Name, object Value)> parameters,
        bool includeFabricated, CancellationToken ct)
    {
        if (includeFabricated) return whereClauses;

        var probeClauses = new List<string>(whereClauses) { "is_fabricated = 0" };
        var probeWhereSql = " WHERE " + string.Join(" AND ", probeClauses);

        using var probeCmd = connection.CreateCommand();
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

    public async Task<IReadOnlyList<TelemetrySamplePoint>> QueryTelemetryAsync(
        string machineCode, string metric, DateTimeOffset from, DateTimeOffset to, CancellationToken ct)
    {
        using var connection = await OpenConnectionAsync(ct).ConfigureAwait(false);
        using var cmd = connection.CreateCommand();
        cmd.CommandText = """
            SELECT event_time_utc, value FROM historian_telemetry
            WHERE machine_code = @machine_code AND metric = @metric AND event_time_utc BETWEEN @from AND @to
            ORDER BY event_time_utc;
            """;
        cmd.Parameters.AddWithValue("@machine_code", machineCode);
        cmd.Parameters.AddWithValue("@metric", metric);
        cmd.Parameters.AddWithValue("@from", ToIso(from));
        cmd.Parameters.AddWithValue("@to", ToIso(to));

        var results = new List<TelemetrySamplePoint>();
        using var reader = await cmd.ExecuteReaderAsync(ct).ConfigureAwait(false);
        while (await reader.ReadAsync(ct).ConfigureAwait(false))
        {
            results.Add(new TelemetrySamplePoint(ParseIso(reader.GetString(0)), reader.GetDouble(1)));
        }
        return results;
    }

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

    public async Task<OeeInputAggregate> AggregateForOeeAsync(
        string machineCode, DateTimeOffset from, DateTimeOffset to, CancellationToken ct, bool includeFabricated = false)
    {
        using var connection = await OpenConnectionAsync(ct).ConfigureAwait(false);

        var fromIso = ToIso(from);
        var toIso = ToIso(to);

        // SM-2 — the gate is probed over the SAME scope this aggregate counts from (machine + ProcessResult
        // + window), deliberately WITHOUT the verdict slicing below: "is there real data in this window" is
        // one question, independent of how the two counts below then slice it by verdict.
        var scopeClauses = new List<string> { "machine_code = @machine_code", "reading_kind = 'ProcessResult'", "event_time_utc BETWEEN @from AND @to" };
        var scopeParameters = new List<(string Name, object Value)> { ("@machine_code", machineCode), ("@from", fromIso), ("@to", toIso) };
        var effectiveClauses = await ApplyRealPresenceGateAsync(connection, scopeClauses, scopeParameters, includeFabricated, ct)
            .ConfigureAwait(false);
        var scopeSql = string.Join(" AND ", effectiveClauses);

        long totalCount;
        using (var cmd = connection.CreateCommand())
        {
            cmd.CommandText = $"SELECT COUNT(*) FROM historian_results WHERE {scopeSql} AND verdict <> 'Skip';";
            cmd.Parameters.AddWithValue("@machine_code", machineCode);
            cmd.Parameters.AddWithValue("@from", fromIso);
            cmd.Parameters.AddWithValue("@to", toIso);
            totalCount = (long)(await cmd.ExecuteScalarAsync(ct).ConfigureAwait(false))!;
        }

        long goodCount;
        using (var cmd = connection.CreateCommand())
        {
            cmd.CommandText = $"SELECT COUNT(*) FROM historian_results WHERE {scopeSql} AND verdict IN ('Pass', 'Warn');";
            cmd.Parameters.AddWithValue("@machine_code", machineCode);
            cmd.Parameters.AddWithValue("@from", fromIso);
            cmd.Parameters.AddWithValue("@to", toIso);
            goodCount = (long)(await cmd.ExecuteScalarAsync(ct).ConfigureAwait(false))!;
        }

        var runTime = await ComputeRunTimeAsync(connection, from, to, ct).ConfigureAwait(false);

        return new OeeInputAggregate(machineCode, from, to, totalCount, goodCount, runTime);
    }

    // Run-time = sum of active [Start, next Stop/Estop) intervals from historian_run_events, clipped to
    // [from, to]; an unmatched trailing Start (no Stop/Estop before `to`) runs to `to`. historian_run_events
    // has no machine_code column — run state is line/system-wide, not per-machine, matching the DDL.
    // Only the interval-open/close core is implemented here; WS-A-T3 hardens edge cases (overlapping
    // starts, multi-window spans, etc.) with dedicated tests.
    private static async Task<TimeSpan> ComputeRunTimeAsync(SqliteConnection connection, DateTimeOffset from, DateTimeOffset to, CancellationToken ct)
    {
        using var cmd = connection.CreateCommand();
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
