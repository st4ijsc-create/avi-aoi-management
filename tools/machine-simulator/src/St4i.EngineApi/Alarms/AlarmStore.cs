using System.Globalization;
using Microsoft.Data.Sqlite;

namespace St4i.EngineApi.Alarms;

/// <summary>
/// GĐ3 sub-4 LC-1 — <see cref="IAlarmStore"/> on raw <c>Microsoft.Data.Sqlite</c> (no ORM), its OWN SQLite
/// file (<c>alarms.db</c>) under <paramref name="directory"/> (else <c>ST4I_ALARMS_DIR</c>, else
/// <see cref="DefaultRoot"/>) with a <c>PRAGMA user_version</c>-tracked migration ladder and short-lived,
/// WAL-mode connections — the SAME shape as
/// <see cref="St4i.EngineApi.AssetRegistry.AssetRegistryStore"/>/<see cref="St4i.EngineApi.Auth.SqliteAuditStore"/>
/// (see their doc comments for the rationale this class does not repeat).
///
/// Two tables, two very different write disciplines:
/// <list type="bullet">
/// <item><description><c>active_alarms</c> — the LIVE set. One row per distinct <see cref="AlarmRaise.Key"/>
/// (its TEXT PRIMARY KEY); rows are UPSERTed by <see cref="RaiseAsync"/> and DELETEd by
/// <see cref="ClearAsync"/>/a ClearOnAck <see cref="AckAsync"/> — a Cleared alarm does not linger here with
/// a "Cleared" state, it's simply gone. This table has no declared <c>INTEGER PRIMARY KEY</c>, so every row
/// still gets SQLite's implicit <c>rowid</c> — that rowid IS <see cref="Alarm.Id"/>, and it is stable across
/// an UPSERT's <c>DO UPDATE</c> path (that's a real SQL UPDATE, not a delete+insert).
///
/// <para>🔴 A rowid is NOT stable across a clear-and-re-raise, and — this part matters, because a Task C-1
/// design decision turns on it — it is NOT necessarily new either. Without <c>AUTOINCREMENT</c>, SQLite
/// assigns "one more than the largest rowid currently in the table", so a cleared key that was the table's
/// HIGH-WATER row hands its rowid straight back to the next insert: on a single-alarm table the sequence
/// raise/clear/raise yields rowid 1, then rowid 1 again, with <see cref="Alarm.Count"/> going 1 → 1 (a
/// re-INSERT reseeds it). Only a cleared NON-high-water row leaves a gap that later inserts skip past.
/// Anything reasoning about <c>(rowid, count)</c> as though it advanced monotonically is therefore wrong —
/// both components can DECREASE. See <c>_writeGate</c>'s doc comment for the consequence.</para></description></item>
/// <item><description><c>alarm_history</c> — the APPEND-ONLY event log (raised/cleared/acked), never
/// mutated or deleted — the durable record of "what happened and when" that outlives whatever
/// <c>active_alarms</c> currently contains.</description></item>
/// </list>
///
/// <see cref="RaiseAsync"/>/<see cref="ClearAsync"/> NEVER throw into their caller (see <see cref="IAlarmStore"/>'s
/// doc comment) — every other member is a direct, caller-invoked read/write reachable only from
/// <c>AlarmEndpoints</c>, so a genuine failure there is allowed to surface as an ordinary exception, same as
/// every comparable store in this codebase.
///
/// <para>Task C-1 — this class is also where the notification seam (<see cref="IAlarmNotifier"/>) is
/// invoked from, deliberately NOT <see cref="AlarmEvaluator"/>: the evaluator is only ONE of the callers
/// that mutate alarm state (<c>PolicyResults.DenyAsync</c> and <c>AlarmEndpoints</c>' ack are the others),
/// so hooking it would silently miss every Policy alarm and every operator ack. There are exactly four
/// state-transition sites and all four are in this file — <see cref="RaiseAsync"/>'s upsert (which may be
/// a first raise OR a restatement of an identical active alarm), <see cref="ClearAsync"/>'s delete (which
/// may be a no-op), and <see cref="AckAsync"/>'s two branches. Every one of them reports through
/// <c>NotifySafely</c>, and only ever AFTER its write has committed: a notification for an alarm that was
/// never recorded is a lie. All three mutating members hold <c>_writeGate</c> across write-AND-notify, so
/// the notifier observes transitions in commit order — see that field's own doc comment for the race that
/// closes and why it cannot be reconstructed downstream.</para>
/// </summary>
public sealed class AlarmStore : IAlarmStore
{
    /// <summary>Directory override — same idiom as <c>ST4I_ASSETS_DIR</c>/<c>ST4I_SECURITY_DIR</c>. Unset
    /// or blank means "use <see cref="DefaultRoot"/>".</summary>
    public const string EnvVarDir = "ST4I_ALARMS_DIR";

    public string DbPath { get; }

    private readonly Action<Exception, string>? _logError;

    /// <summary>Task C-1 — where alarm-state EDGES are reported, after (never before) the write that
    /// caused them has committed. Defaults to <see cref="NullAlarmNotifier"/>, which is why every
    /// pre-existing construction site behaves bit-for-bit as it did before Đợt C.</summary>
    private readonly IAlarmNotifier _notifier;

    /// <summary>
    /// Task C-1 review fix (I-2) — serialises <b>write-then-notify</b> across
    /// <see cref="RaiseAsync"/>/<see cref="ClearAsync"/>/<see cref="AckAsync"/>, so the order in which the
    /// notifier observes transitions is exactly the order in which the rows actually changed. Same
    /// <see cref="SemaphoreSlim"/>-capacity-1 idiom, and for the same class of reason, as
    /// <see cref="St4i.EngineApi.Auth.SqliteAuditStore"/>'s own <c>_appendLock</c>: SQLite's statement
    /// atomicity does not serialise a MULTI-step operation, and this one is multi-step the moment the
    /// notification is part of it.
    ///
    /// <para>🔴 The concrete race it closes: thread A's raise upserts key <c>K</c> and commits
    /// (<see cref="AlarmTransitionKind.ReRaised"/>), then awaits its history append. In that window thread
    /// B acks the same alarm, DELETEs the row and notifies <c>Cleared</c> — the detector drops <c>K</c>. A
    /// then resumes and notifies its stale <c>ReRaised</c>, which now finds <c>K</c> untracked and is
    /// emitted as a fresh <b>Raised</b> for a row that no longer exists. For a
    /// <see cref="AlarmSource.Policy"/> key that never heals: <see cref="AlarmEvaluator"/> only ever clears
    /// DriverHealth/NgRate/Identity keys, and nothing re-raises Policy periodically, so the detector would
    /// believe that alarm is active until the same action is denied AND acked again — a latched relay coil
    /// once C-6 lands, i.e. precisely the spurious pulse this task exists to prevent.</para>
    ///
    /// <para><b>Why not reconstruct the ordering in the detector from <see cref="Alarm.Id"/> +
    /// <see cref="Alarm.Count"/>, rejecting any raise that is "not strictly newer" than the last transition
    /// applied for that key?</b> Because <b>no monotone order over <c>(rowid, count)</c> exists to be
    /// strictly-newer WITH RESPECT TO</b> — both components can decrease. A cleared high-water row hands its
    /// rowid back to the next insert (see the <c>active_alarms</c> bullet above), and that re-insert reseeds
    /// <c>count</c> to 1. So across a single key's life the pairs genuinely run 1/1 → 1/2 → (clear) → 1/1:
    /// the sequence goes BACKWARDS at a point where nothing is stale. Any comparison-based guard must
    /// therefore either admit a stale raise or reject a legitimate one — there is no threshold that
    /// separates them, because the two orders are not comparable in the first place. This is not a
    /// near-miss that a cleverer predicate would fix.
    ///
    /// <para><c>(FirstRaisedUtc, Count)</c> — which DOES distinguish the two, since a re-INSERT stamps a
    /// fresh <c>first_raised_at</c> — was considered and rejected: it makes a coil-safety invariant rest on
    /// wall-clock monotonicity, so an NTP step backwards, or simply two operations landing inside one clock
    /// tick, would silently break it. No extra column is available either (this task adds no migration).</para>
    ///
    /// Ordering the writes at the source is exact and depends on nothing; reconstructing the order
    /// afterwards is not possible from what the row carries.</para>
    ///
    /// <para>Cost: alarm WRITES become logically single-threaded in this process. SQLite's WAL already
    /// permits only one writer at a time, so this mostly replaces <c>SQLITE_BUSY</c> back-off with a fair
    /// queue rather than adding contention. Reads (<see cref="ListActiveAsync"/>/
    /// <see cref="QueryHistoryAsync"/>) do not take it, and neither does per-call connection setup —
    /// <see cref="OpenConnectionAsync"/> and its four PRAGMAs run BEFORE the wait in all three members,
    /// since they touch nothing shared and cannot affect ordering. The critical section is exactly
    /// statement-execute → history-append → notify. Lock ordering is always store-gate → notifier-gate and
    /// never the reverse, so the two cannot deadlock.</para>
    ///
    /// <para>🔴 The corollary a channel author must know: because <see cref="IAlarmNotifier.Notify"/> runs
    /// INSIDE this gate, a notifier that blocks does not merely slow its own caller — it stalls every alarm
    /// write in the process, including every policy denial on the request path. That is why the interface
    /// documents non-blocking as a hard requirement rather than a preference.</para>
    /// </summary>
    private readonly SemaphoreSlim _writeGate = new(1, 1);

    private static readonly string[] OpenPragmas =
    {
        "PRAGMA journal_mode=WAL;",
        "PRAGMA synchronous=NORMAL;",
        "PRAGMA busy_timeout=5000;",
        "PRAGMA foreign_keys=ON;",
    };

    // Ordered migration ladder — future alarm-schema changes append a new (Version, Statements) entry
    // here; EnsureSchema() applies only the entries newer than the DB's current PRAGMA user_version, each
    // inside its own transaction. No migrator library — mirrors AssetRegistryStore/SqliteAuditStore exactly.
    private static readonly (int Version, string[] Statements)[] Migrations =
    {
        (1, new[]
        {
            """
            CREATE TABLE IF NOT EXISTS active_alarms (
              key TEXT PRIMARY KEY,
              source TEXT NOT NULL,
              code TEXT NOT NULL,
              priority TEXT NOT NULL,
              state TEXT NOT NULL,
              message TEXT NOT NULL,
              runbook TEXT NULL,
              target_id TEXT NULL,
              clear_on_ack INTEGER NOT NULL,
              count INTEGER NOT NULL,
              first_raised_at TEXT NOT NULL,
              last_raised_at TEXT NOT NULL,
              acked_at TEXT NULL,
              acked_by TEXT NULL);
            """,
            "CREATE INDEX IF NOT EXISTS ix_active_alarms_priority ON active_alarms(priority);",
            """
            CREATE TABLE IF NOT EXISTS alarm_history (
              seq INTEGER PRIMARY KEY,
              at TEXT NOT NULL,
              key TEXT NOT NULL,
              event TEXT NOT NULL,
              source TEXT NOT NULL,
              code TEXT NOT NULL,
              priority TEXT NOT NULL,
              message TEXT NOT NULL,
              actor TEXT NULL);
            """,
            "CREATE INDEX IF NOT EXISTS ix_alarm_history_at ON alarm_history(at);",
            "CREATE INDEX IF NOT EXISTS ix_alarm_history_key ON alarm_history(key);",
        }),
    };

    /// <param name="directory">Explicit directory override (tests), or <see langword="null"/> to resolve
    /// via <see cref="ResolveRoot"/> (env var, then <see cref="DefaultRoot"/>).</param>
    /// <param name="logError">Where <see cref="RaiseAsync"/>/<see cref="ClearAsync"/> report a swallowed
    /// failure. Optional — a <see langword="null"/> logger just means the failure is silently swallowed
    /// (still never thrown).</param>
    /// <param name="notifier">Task C-1 — the notification seam (see <see cref="IAlarmNotifier"/>).
    /// Optional and TRAILING so every pre-existing construction site keeps compiling untouched;
    /// <see langword="null"/> means <see cref="NullAlarmNotifier"/>, i.e. exactly the pre-Đợt-C
    /// behaviour with no extra thread and no extra allocation.</param>
    public AlarmStore(string? directory = null, Action<Exception, string>? logError = null, IAlarmNotifier? notifier = null)
    {
        _logError = logError;
        _notifier = notifier ?? NullAlarmNotifier.Instance;

        var root = ResolveRoot(directory);
        Directory.CreateDirectory(root);
        DbPath = Path.Combine(root, "alarms.db");
        EnsureSchema();
    }

    /// <summary>The default alarms root: <c>%ProgramData%\ST4I\sim\alarms</c> — a SIBLING of
    /// <c>...\sim\assets</c>/<c>...\sim\historian</c>/<c>...\sim\security</c>, never the same directory.</summary>
    public static string DefaultRoot() => Path.Combine(
        Environment.GetFolderPath(Environment.SpecialFolder.CommonApplicationData), "ST4I", "sim", "alarms");

    /// <summary>Resolves the effective alarms directory: <paramref name="directory"/> if given, else
    /// <c>ST4I_ALARMS_DIR</c> if set, else <see cref="DefaultRoot"/>. Pure path arithmetic — does not create
    /// anything on disk.</summary>
    public static string ResolveRoot(string? directory = null)
    {
        if (!string.IsNullOrWhiteSpace(directory)) return directory;
        var env = Environment.GetEnvironmentVariable(EnvVarDir);
        return string.IsNullOrWhiteSpace(env) ? DefaultRoot() : env;
    }

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
                // fixed, code-defined migration ladder above (never external/user input).
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
    // RaiseAsync — upsert active_alarms + append "raised" history. NEVER throws.
    // ─────────────────────────────────────────────────────────────────────

    public async Task<AlarmTransition> RaiseAsync(AlarmRaise raise, CancellationToken ct = default)
    {
        if (raise is null) return AlarmTransition.None;

        try
        {
            var key = raise.Key;

            // Deliberately OUTSIDE the gate: opening a per-call connection and applying its four PRAGMAs is
            // five round trips of setup that touch nothing shared and cannot affect ordering. Holding the
            // gate across them would serialise every alarm write behind another caller's connection setup,
            // on the request path of every policy denial, for nothing.
            using var connection = await OpenConnectionAsync(ct).ConfigureAwait(false);

            // Task C-1 (I-2) — the write AND its notification happen under one gate, so the notifier can
            // never see a transition out of commit order. See _writeGate's own doc comment.
            await _writeGate.WaitAsync(ct).ConfigureAwait(false);
            try
            {
                // Inside the gate, so the stamped timestamp reflects the order rows actually change rather
                // than the order callers arrived.
                var nowIso = ToIso(DateTimeOffset.UtcNow);

                Alarm upserted;
                using (var cmd = connection.CreateCommand())
                {
                    // ON CONFLICT(key) DO UPDATE deliberately OMITS first_raised_at/state/acked_at/acked_by
                    // — SQLite leaves an omitted column exactly as it was on conflict, so a re-raise of an
                    // already-Acked (ClearOnAck=false) alarm stays Acked rather than silently reverting to
                    // Active — see Alarm's own doc comment.
                    //
                    // Task C-1 — RETURNING (SQLite >= 3.35; this build bundles SQLitePCLRaw 2.1.12) makes
                    // the upsert report the row it just wrote in the SAME statement. That matters for more
                    // than convenience: telling a first raise from a re-raise by SELECTing first and then
                    // upserting would be two statements with a window between them, and two concurrent
                    // raises of one key (the evaluator's timer thread and a request-path policy denial CAN
                    // overlap) would both read "absent" and both claim to be the first. One statement has no
                    // such window. It also hands the notification seam the COMPLETE resulting alarm, so no
                    // channel ever has to go back and re-query a row that may have changed by then.
                    cmd.CommandText = $"""
                        INSERT INTO active_alarms
                            (key, source, code, priority, state, message, runbook, target_id, clear_on_ack,
                             count, first_raised_at, last_raised_at, acked_at, acked_by)
                        VALUES
                            (@key, @source, @code, @priority, @state, @message, @runbook, @target_id, @clear_on_ack,
                             1, @now, @now, NULL, NULL)
                        ON CONFLICT(key) DO UPDATE SET
                            last_raised_at = excluded.last_raised_at,
                            count = count + 1,
                            message = excluded.message,
                            priority = excluded.priority
                        RETURNING rowid AS id, {Columns};
                        """;
                    cmd.Parameters.AddWithValue("@key", key);
                    cmd.Parameters.AddWithValue("@source", raise.Source.ToString());
                    cmd.Parameters.AddWithValue("@code", raise.Code);
                    cmd.Parameters.AddWithValue("@priority", raise.Priority.ToString());
                    cmd.Parameters.AddWithValue("@state", nameof(AlarmState.Active));
                    cmd.Parameters.AddWithValue("@message", raise.Message);
                    cmd.Parameters.AddWithValue("@runbook", (object?)raise.Runbook ?? DBNull.Value);
                    cmd.Parameters.AddWithValue("@target_id", (object?)raise.TargetId ?? DBNull.Value);
                    cmd.Parameters.AddWithValue("@clear_on_ack", raise.ClearOnAck ? 1 : 0);
                    cmd.Parameters.AddWithValue("@now", nowIso);

                    using var reader = await cmd.ExecuteReaderAsync(ct).ConfigureAwait(false);
                    if (!await reader.ReadAsync(ct).ConfigureAwait(false))
                    {
                        throw new InvalidOperationException(
                            $"active_alarms upsert for key '{key}' returned no row — the alarm was not recorded.");
                    }
                    upserted = ReadAlarm(reader);

                    // Step the statement to completion before disposing it. A single-row upsert cannot
                    // produce a second row, so this is a formality — but an abandoned RETURNING statement is
                    // exactly the kind of thing that is only "obviously fine" until it is not.
                    while (await reader.ReadAsync(ct).ConfigureAwait(false)) { }
                }

                await AppendHistoryAsync(connection, key, "raised", raise.Source, raise.Code, raise.Priority, raise.Message, actor: null, ct)
                    .ConfigureAwait(false);

                // count == 1 is exactly "the INSERT path ran": VALUES seeds it to 1 and DO UPDATE only ever
                // increments, so a count of 1 can only mean this call created the row (or re-created it
                // after an earlier clear, which is the same edge as far as anyone downstream is concerned).
                var transition = new AlarmTransition(
                    upserted.Count == 1 ? AlarmTransitionKind.Raised : AlarmTransitionKind.ReRaised, upserted);

                // Notify only after BOTH writes committed. A notification for an alarm that was never
                // recorded is a lie, and every failure path throws to the catch below before reaching here.
                // NotifySafely is unconditionally never-throws, so it cannot be mistaken for a DB fault.
                NotifySafely(transition, actor: null);
                return transition;
            }
            finally
            {
                _writeGate.Release();
            }
        }
        catch (Exception ex)
        {
            // Deliberately swallowed — see IAlarmStore's doc comment: a Policy DENY handler (or LC-2's
            // periodic evaluator) must never fail just because alarms.db hiccuped. Also covers a cancelled
            // _writeGate.WaitAsync above (which never entered the inner try, so nothing to release).
            _logError?.Invoke(ex, $"Alarm raise failed for key '{raise?.Key}' — this alarm was not recorded.");
            return AlarmTransition.None;
        }
    }

    // ─────────────────────────────────────────────────────────────────────
    // ClearAsync — delete from active_alarms + append "cleared" history. No-op if absent. NEVER throws.
    // ─────────────────────────────────────────────────────────────────────

    public async Task<AlarmTransition> ClearAsync(string key, CancellationToken ct = default)
    {
        try
        {
            // Outside the gate — see RaiseAsync's own comment: per-call connection setup is not shared
            // state and cannot affect ordering.
            using var connection = await OpenConnectionAsync(ct).ConfigureAwait(false);

            // Task C-1 (I-2) — write and notification under one gate; see _writeGate's doc comment.
            await _writeGate.WaitAsync(ct).ConfigureAwait(false);
            try
            {
                Alarm? removed;
                using (var delCmd = connection.CreateCommand())
                {
                    // Task C-1 — DELETE ... RETURNING replaces the previous SELECT-then-DELETE pair for the
                    // same reason RaiseAsync uses RETURNING: one statement has no window in which a
                    // concurrent clear of the same key could make BOTH callers believe they were the one
                    // that removed it (and therefore both announce a "cleared" edge). It also still yields
                    // the row's Source/Code/Priority/Message for the history append, which is what the
                    // SELECT was there for.
                    delCmd.CommandText = $"DELETE FROM active_alarms WHERE key = @key RETURNING rowid AS id, {Columns};";
                    delCmd.Parameters.AddWithValue("@key", key);

                    using var reader = await delCmd.ExecuteReaderAsync(ct).ConfigureAwait(false);
                    removed = await reader.ReadAsync(ct).ConfigureAwait(false) ? ReadAlarm(reader) : null;
                    while (await reader.ReadAsync(ct).ConfigureAwait(false)) { }
                }

                // No-op (not an error) — nothing active carried this key. The evaluator does this on every
                // tick for every healthy slot, so this is by far the most common outcome.
                if (removed is null) return AlarmTransition.None;

                await AppendHistoryAsync(connection, key, "cleared", removed.Source, removed.Code, removed.Priority, removed.Message, actor: null, ct)
                    .ConfigureAwait(false);

                var transition = new AlarmTransition(
                    AlarmTransitionKind.Cleared, removed with { State = AlarmState.Cleared });

                NotifySafely(transition, actor: null);
                return transition;
            }
            finally
            {
                _writeGate.Release();
            }
        }
        catch (Exception ex)
        {
            _logError?.Invoke(ex, $"Alarm clear failed for key '{key}'.");
            return AlarmTransition.None;
        }
    }

    // ─────────────────────────────────────────────────────────────────────
    // AckAsync — ClearOnAck=true clears (delete + "cleared" history, no separate "acked" row);
    // ClearOnAck=false acks in place ("acked" history). Returns null if unknown/already cleared.
    // ─────────────────────────────────────────────────────────────────────

    public async Task<Alarm?> AckAsync(long id, string by, CancellationToken ct = default)
    {
        // Outside the gate — see RaiseAsync's own comment: per-call connection setup is not shared state
        // and cannot affect ordering.
        using var connection = await OpenConnectionAsync(ct).ConfigureAwait(false);

        // Task C-1 (I-2) — an ack DELETEs or UPDATEs a row a concurrent raise may be mid-write on, so it
        // takes the same gate. No try/catch around it: AckAsync is deliberately NOT a never-throws member
        // (see IAlarmStore), and a cancelled wait here surfaces the same way any other failure does.
        await _writeGate.WaitAsync(ct).ConfigureAwait(false);
        try
        {
            var current = await ReadByRowIdAsync(connection, id, ct).ConfigureAwait(false);
            if (current is null) return null;

            var nowIso = ToIso(DateTimeOffset.UtcNow);
            var ackedAtUtc = ParseIso(nowIso);

            if (current.ClearOnAck)
            {
                using (var delCmd = connection.CreateCommand())
                {
                    delCmd.CommandText = "DELETE FROM active_alarms WHERE rowid = @id;";
                    delCmd.Parameters.AddWithValue("@id", id);
                    await delCmd.ExecuteNonQueryAsync(ct).ConfigureAwait(false);
                }

                await AppendHistoryAsync(connection, current.Key, "cleared", current.Source, current.Code, current.Priority, current.Message, actor: by, ct)
                    .ConfigureAwait(false);

                var cleared = current with { State = AlarmState.Cleared, AckedUtc = ackedAtUtc, AckedBy = by };

                // Task C-1 — an EVENT alarm (every Policy denial) can leave active_alarms ONLY through this
                // branch, so this is a genuine "the alarm is over" edge, not a bookkeeping detail. Treating
                // it as a non-edge would leave a downstream annunciator/relay latched on forever after an
                // operator acknowledged the very alarm that lit it.
                NotifySafely(new AlarmTransition(AlarmTransitionKind.Cleared, cleared), actor: by);
                return cleared;
            }
            else
            {
                using (var updCmd = connection.CreateCommand())
                {
                    updCmd.CommandText = "UPDATE active_alarms SET state = @state, acked_at = @now, acked_by = @by WHERE rowid = @id;";
                    updCmd.Parameters.AddWithValue("@state", nameof(AlarmState.Acked));
                    updCmd.Parameters.AddWithValue("@now", nowIso);
                    updCmd.Parameters.AddWithValue("@by", by);
                    updCmd.Parameters.AddWithValue("@id", id);
                    await updCmd.ExecuteNonQueryAsync(ct).ConfigureAwait(false);
                }

                await AppendHistoryAsync(connection, current.Key, "acked", current.Source, current.Code, current.Priority, current.Message, actor: by, ct)
                    .ConfigureAwait(false);

                var acked = current with { State = AlarmState.Acked, AckedUtc = ackedAtUtc, AckedBy = by };

                // Task C-1 — reported on EVERY ack, including a repeat ack of an already-Acked alarm
                // (nothing here refuses one). Collapsing repeats to a single edge is the notifier's job, not
                // the store's: the store reports what it did, the detector decides what is news.
                NotifySafely(new AlarmTransition(AlarmTransitionKind.Acked, acked), actor: by);
                return acked;
            }
        }
        finally
        {
            _writeGate.Release();
        }
    }

    // ─────────────────────────────────────────────────────────────────────
    // ListActiveAsync — everything currently live, priority-severity desc then last-raised desc.
    // ─────────────────────────────────────────────────────────────────────

    public async Task<IReadOnlyList<Alarm>> ListActiveAsync(CancellationToken ct = default)
    {
        using var connection = await OpenConnectionAsync(ct).ConfigureAwait(false);
        using var cmd = connection.CreateCommand();
        cmd.CommandText = $"""
            SELECT rowid AS id, {Columns}
            FROM active_alarms
            ORDER BY
                CASE priority
                    WHEN 'Critical' THEN 0
                    WHEN 'High' THEN 1
                    WHEN 'Medium' THEN 2
                    WHEN 'Low' THEN 3
                    ELSE 4
                END ASC,
                last_raised_at DESC;
            """;

        var results = new List<Alarm>();
        using var reader = await cmd.ExecuteReaderAsync(ct).ConfigureAwait(false);
        while (await reader.ReadAsync(ct).ConfigureAwait(false))
        {
            results.Add(ReadAlarm(reader));
        }
        return results;
    }

    // ─────────────────────────────────────────────────────────────────────
    // QueryHistoryAsync — filtered/paged read of the append-only alarm_history log, newest-first.
    // ─────────────────────────────────────────────────────────────────────

    public async Task<AlarmHistoryPage> QueryHistoryAsync(AlarmHistoryFilter filter, CancellationToken ct = default)
    {
        using var connection = await OpenConnectionAsync(ct).ConfigureAwait(false);

        var whereClauses = new List<string>();
        var parameters = new List<(string Name, object Value)>();

        if (filter.Source is not null)
        {
            whereClauses.Add("source = @source");
            parameters.Add(("@source", filter.Source.Value.ToString()));
        }
        if (filter.Priority is not null)
        {
            whereClauses.Add("priority = @priority");
            parameters.Add(("@priority", filter.Priority.Value.ToString()));
        }
        if (filter.From is not null)
        {
            whereClauses.Add("at >= @from");
            parameters.Add(("@from", ToIso(filter.From.Value)));
        }
        if (filter.To is not null)
        {
            whereClauses.Add("at <= @to");
            parameters.Add(("@to", ToIso(filter.To.Value)));
        }

        var whereSql = whereClauses.Count > 0 ? " WHERE " + string.Join(" AND ", whereClauses) : string.Empty;

        int total;
        using (var countCmd = connection.CreateCommand())
        {
            countCmd.CommandText = $"SELECT COUNT(*) FROM alarm_history{whereSql};";
            foreach (var (name, value) in parameters) countCmd.Parameters.AddWithValue(name, value);
            total = Convert.ToInt32((long)(await countCmd.ExecuteScalarAsync(ct).ConfigureAwait(false))!, CultureInfo.InvariantCulture);
        }

        var items = new List<AlarmHistoryEntry>();
        using (var selectCmd = connection.CreateCommand())
        {
            selectCmd.CommandText = $"""
                SELECT seq, at, key, event, source, code, priority, message, actor
                FROM alarm_history{whereSql}
                ORDER BY seq DESC
                LIMIT @limit OFFSET @offset;
                """;
            foreach (var (name, value) in parameters) selectCmd.Parameters.AddWithValue(name, value);
            selectCmd.Parameters.AddWithValue("@limit", filter.Limit);
            selectCmd.Parameters.AddWithValue("@offset", filter.Offset);

            using var reader = await selectCmd.ExecuteReaderAsync(ct).ConfigureAwait(false);
            while (await reader.ReadAsync(ct).ConfigureAwait(false))
            {
                items.Add(new AlarmHistoryEntry(
                    Seq: reader.GetInt64(0),
                    AtUtc: ParseIso(reader.GetString(1)),
                    Key: reader.GetString(2),
                    Event: reader.GetString(3),
                    Source: Enum.Parse<AlarmSource>(reader.GetString(4)),
                    Code: reader.GetString(5),
                    Priority: Enum.Parse<AlarmPriority>(reader.GetString(6)),
                    Message: reader.GetString(7),
                    Actor: reader.IsDBNull(8) ? null : reader.GetString(8)));
            }
        }

        return new AlarmHistoryPage(items, total, filter.Limit, filter.Offset);
    }

    // ─────────────────────────────────────────────────────────────────────
    // Shared helpers
    // ─────────────────────────────────────────────────────────────────────

    private const string Columns =
        "key, source, code, priority, state, message, runbook, target_id, clear_on_ack, count, first_raised_at, last_raised_at, acked_at, acked_by";

    /// <summary>Task C-1 — hands a completed transition to the notification seam, and is the LAST line of
    /// defence for <see cref="RaiseAsync"/>/<see cref="ClearAsync"/>'s never-throws contract:
    /// <see cref="IAlarmNotifier.Notify"/> is documented never-throws, but a documented contract is not an
    /// enforced one, and a hostile/buggy implementation must not be able to turn "the alarm was recorded"
    /// into an exception in a policy-deny handler or an evaluator tick. Note the deliberately DIFFERENT
    /// message from the store's own failure path: the alarm IS in the database here — only the
    /// notification was lost — and saying otherwise would send an operator hunting the wrong
    /// problem.</summary>
    private void NotifySafely(in AlarmTransition transition, string? actor)
    {
        try
        {
            _notifier.Notify(transition, actor);
        }
        catch (Exception ex)
        {
            try
            {
                _logError?.Invoke(
                    ex,
                    $"Alarm notification hook threw for key '{transition.Alarm?.Key}' — the alarm itself WAS recorded; " +
                    "only its notification was lost.");
            }
            catch
            {
                // Even the REPORT failed. Swallow it: this method is called from inside RaiseAsync's and
                // ClearAsync's own try blocks now (it has to be, to stay under _writeGate), so anything
                // escaping here would be caught by their catch and mis-reported as "this alarm was not
                // recorded" — the one thing that message must never say when the alarm is safely written.
            }
        }
    }

    private static async Task<Alarm?> ReadByRowIdAsync(SqliteConnection connection, long id, CancellationToken ct)
    {
        using var cmd = connection.CreateCommand();
        cmd.CommandText = $"SELECT rowid AS id, {Columns} FROM active_alarms WHERE rowid = @id;";
        cmd.Parameters.AddWithValue("@id", id);

        using var reader = await cmd.ExecuteReaderAsync(ct).ConfigureAwait(false);
        if (!await reader.ReadAsync(ct).ConfigureAwait(false)) return null;
        return ReadAlarm(reader);
    }

    private static async Task AppendHistoryAsync(
        SqliteConnection connection, string key, string eventName, AlarmSource source, string code,
        AlarmPriority priority, string message, string? actor, CancellationToken ct)
    {
        using var cmd = connection.CreateCommand();
        cmd.CommandText = """
            INSERT INTO alarm_history (at, key, event, source, code, priority, message, actor)
            VALUES (@at, @key, @event, @source, @code, @priority, @message, @actor);
            """;
        cmd.Parameters.AddWithValue("@at", ToIso(DateTimeOffset.UtcNow));
        cmd.Parameters.AddWithValue("@key", key);
        cmd.Parameters.AddWithValue("@event", eventName);
        cmd.Parameters.AddWithValue("@source", source.ToString());
        cmd.Parameters.AddWithValue("@code", code);
        cmd.Parameters.AddWithValue("@priority", priority.ToString());
        cmd.Parameters.AddWithValue("@message", message);
        cmd.Parameters.AddWithValue("@actor", (object?)actor ?? DBNull.Value);
        await cmd.ExecuteNonQueryAsync(ct).ConfigureAwait(false);
    }

    private static Alarm ReadAlarm(SqliteDataReader reader) => new(
        Id: reader.GetInt64(reader.GetOrdinal("id")),
        Key: reader.GetString(reader.GetOrdinal("key")),
        Source: Enum.Parse<AlarmSource>(reader.GetString(reader.GetOrdinal("source"))),
        Code: reader.GetString(reader.GetOrdinal("code")),
        Priority: Enum.Parse<AlarmPriority>(reader.GetString(reader.GetOrdinal("priority"))),
        State: Enum.Parse<AlarmState>(reader.GetString(reader.GetOrdinal("state"))),
        Message: reader.GetString(reader.GetOrdinal("message")),
        Runbook: GetNullableString(reader, "runbook"),
        TargetId: GetNullableString(reader, "target_id"),
        ClearOnAck: reader.GetInt64(reader.GetOrdinal("clear_on_ack")) != 0,
        Count: Convert.ToInt32(reader.GetInt64(reader.GetOrdinal("count")), CultureInfo.InvariantCulture),
        FirstRaisedUtc: ParseIso(reader.GetString(reader.GetOrdinal("first_raised_at"))),
        LastRaisedUtc: ParseIso(reader.GetString(reader.GetOrdinal("last_raised_at"))),
        AckedUtc: GetNullableString(reader, "acked_at") is { } ackedAt ? ParseIso(ackedAt) : null,
        AckedBy: GetNullableString(reader, "acked_by"));

    private static string? GetNullableString(SqliteDataReader reader, string column)
    {
        var ordinal = reader.GetOrdinal(column);
        return reader.IsDBNull(ordinal) ? null : reader.GetString(ordinal);
    }

    private static string ToIso(DateTimeOffset value) => value.ToUniversalTime().ToString("O", CultureInfo.InvariantCulture);

    private static DateTimeOffset ParseIso(string value) =>
        DateTimeOffset.Parse(value, CultureInfo.InvariantCulture, DateTimeStyles.RoundtripKind);
}
