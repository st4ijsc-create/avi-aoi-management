using Microsoft.Data.Sqlite;
using St4i.EdgeCore.Site;
using Xunit;

namespace St4i.EdgeCore.Tests.Site;

/// <summary>
/// GĐ3 closeout WI-2 — <see cref="BridgeSpool"/>: the durable, ordered, bounded, never-throwing SQLite
/// spool that will backstop the northbound Site bridge (WI-3 wires it into <c>UnsBridge</c>; this task
/// proves the store in isolation). Each test gets its own fresh temp directory (its own
/// <c>bridge-spool.db</c>), deleted on dispose — same idiom as <c>AlarmStoreTests</c>/
/// <c>AssetRegistryStoreTests</c>.
///
/// Coverage mirrors the task brief's acceptance list: FIFO ordering, ack-prefix delete, restart durability
/// (pending items AND the monotonic seq counter both survive a fresh store instance over the same
/// directory), <c>dropped_total</c> surviving that same restart, drop-oldest trim by age and by bytes,
/// byte-for-byte binary fidelity for a Sparkplug-B-protobuf-shaped payload (0x00 bytes + high bytes),
/// never-throws on a directory that vanishes out from under the store, and no duplicate seq values under
/// concurrent enqueues.
///
/// <para>WI-3 review fix round 2 (cheap hardening 3) — tagged into the SAME <c>"St4i.EdgeCore.Tests.Site"</c>
/// collection as <c>UnsBridgeSpoolTests</c>/<c>UnsBridgeTests</c>/<c>SiteBridgeManagerTests</c>/
/// <c>SiteLinkStoreTests</c>/<c>SiteTrustPinTests</c> (see <see cref="SiteTestCollection"/>'s own doc
/// comment for why that collection serializes its members against each other). This class's
/// <c>ResolveRoot_EnvOverride_ReturnsConfiguredDirectory</c>/<c>BridgeSpoolOptions_FromEnvironment_*</c> tests
/// mutate the SAME <c>ST4I_BRIDGE_SPOOL_DIR</c>/<c>ST4I_BRIDGE_SPOOL_ENABLED</c> process-wide environment
/// variables <c>UnsBridgeSpoolTests</c> holds for the several seconds it takes to boot two brokers and
/// reconnect — left in its own (unmarked, therefore concurrently-scheduled) collection, xunit could
/// legitimately interleave the two, flipping the env var out from under a bridge mid-test. Being in the SAME
/// collection is what actually prevents that (<c>SiteTestCollection</c>'s own <c>DisableParallelization</c>
/// only serializes MEMBERS of one collection against each other — it does nothing for a class sitting in a
/// different, unmarked collection, which is exactly the gap this closes).</para>
/// </summary>
[Collection("St4i.EdgeCore.Tests.Site")]
public sealed class BridgeSpoolTests : IDisposable
{
    private readonly List<string> _tempDirs = new();

    public void Dispose()
    {
        foreach (var dir in _tempDirs)
        {
            try { Directory.Delete(dir, recursive: true); } catch { /* best-effort cleanup */ }
        }
    }

    private string NewTempDir()
    {
        var dir = Directory.CreateTempSubdirectory("st4i-bridgespool-tests-").FullName;
        _tempDirs.Add(dir);
        return dir;
    }

    // A Sparkplug-B-protobuf-SHAPED payload: NOT valid protobuf (doesn't need to be — the store treats it
    // as opaque bytes), but it deliberately includes 0x00 bytes (which would truncate a C-string / naive
    // text round-trip) and bytes >= 0x80 (which would mangle under any non-binary-safe text encoding).
    private static byte[] SparkplugLikePayload() =>
        new byte[] { 0x00, 0x01, 0xFF, 0x7F, 0x80, 0x00, 0xDE, 0xAD, 0xBE, 0xEF, 0x00, 0xC0, 0xFF, 0xEE };

    // ─────────────────────────────────────────────────────────────────────
    // 1. Enqueue -> PeekBatchAsync returns them in ascending seq order.
    // ─────────────────────────────────────────────────────────────────────

    [Fact]
    public async Task EnqueueAsync_ThenPeekBatchAsync_ReturnsAscendingSeqOrder()
    {
        var spool = new BridgeSpool(NewTempDir());

        var seq1 = await spool.EnqueueAsync("uns/v1/line1/cellA/DATA", new byte[] { 1 }, retain: false);
        var seq2 = await spool.EnqueueAsync("uns/v1/line1/cellA/DATA", new byte[] { 2 }, retain: false);
        var seq3 = await spool.EnqueueAsync("uns/v1/line1/cellA/DATA", new byte[] { 3 }, retain: true);

        Assert.True(seq1 > 0);
        Assert.True(seq2 > seq1);
        Assert.True(seq3 > seq2);

        var batch = await spool.PeekBatchAsync(100);

        Assert.Equal(3, batch.Count);
        Assert.Equal(new[] { seq1, seq2, seq3 }, batch.Select(i => i.Seq).ToArray());
        Assert.Equal(new byte[] { 1 }, batch[0].Payload);
        Assert.Equal(new byte[] { 2 }, batch[1].Payload);
        Assert.Equal(new byte[] { 3 }, batch[2].Payload);
        Assert.False(batch[0].Retain);
        Assert.True(batch[2].Retain);
    }

    [Fact]
    public async Task PeekBatchAsync_RespectsMax()
    {
        var spool = new BridgeSpool(NewTempDir());
        for (var i = 0; i < 5; i++)
        {
            await spool.EnqueueAsync("t", new byte[] { (byte)i }, retain: false);
        }

        var batch = await spool.PeekBatchAsync(2);

        Assert.Equal(2, batch.Count);
    }

    // ─────────────────────────────────────────────────────────────────────
    // 2. AckThroughAsync deletes exactly the prefix seq <= mark; later items untouched.
    // ─────────────────────────────────────────────────────────────────────

    [Fact]
    public async Task AckThroughAsync_DeletesExactlyThePrefix_LaterItemsUntouched()
    {
        var spool = new BridgeSpool(NewTempDir());
        var seq1 = await spool.EnqueueAsync("t", new byte[] { 1 }, retain: false);
        var seq2 = await spool.EnqueueAsync("t", new byte[] { 2 }, retain: false);
        var seq3 = await spool.EnqueueAsync("t", new byte[] { 3 }, retain: false);

        await spool.AckThroughAsync(seq2);

        var remaining = await spool.PeekBatchAsync(100);
        Assert.Equal(new[] { seq3 }, remaining.Select(i => i.Seq).ToArray());

        var stats = await spool.StatsAsync();
        Assert.Equal(1, stats.Depth);
        Assert.Equal(seq3, stats.MinSeq);
        Assert.Equal(seq3, stats.MaxSeq);
    }

    [Fact]
    public async Task AckThroughAsync_UnknownHighSeq_ClearsEverything_NeverThrows()
    {
        var spool = new BridgeSpool(NewTempDir());
        await spool.EnqueueAsync("t", new byte[] { 1 }, retain: false);
        await spool.EnqueueAsync("t", new byte[] { 2 }, retain: false);

        await spool.AckThroughAsync(999_999);

        Assert.Empty(await spool.PeekBatchAsync(100));
    }

    // ─────────────────────────────────────────────────────────────────────
    // 3. Restart durability: a NEW store instance over the SAME directory sees the pending items, and the
    //    next enqueued seq continues upward — never restarts at 1.
    // ─────────────────────────────────────────────────────────────────────

    [Fact]
    public async Task Restart_PendingItemsSurvive_AndNextSeqContinuesUpward()
    {
        var dir = NewTempDir();
        var first = new BridgeSpool(dir);
        var seq1 = await first.EnqueueAsync("t", new byte[] { 1 }, retain: false);
        var seq2 = await first.EnqueueAsync("t", new byte[] { 2 }, retain: false);

        // Release the first instance's pooled native connection so the second instance below isn't
        // "restarting" against a still-open handle — same clear-then-reopen idiom AlarmStoreTests uses.
        SqliteConnection.ClearAllPools();

        var second = new BridgeSpool(dir); // simulates a process restart
        var pending = await second.PeekBatchAsync(100);
        Assert.Equal(new[] { seq1, seq2 }, pending.Select(i => i.Seq).ToArray());

        var seq3 = await second.EnqueueAsync("t", new byte[] { 3 }, retain: false);
        Assert.True(seq3 > seq2);
    }

    // ─────────────────────────────────────────────────────────────────────
    // 3b. The monotonic-seq invariant that actually requires AUTOINCREMENT (not plain rowid): drain the
    //     table down to EMPTY, then enqueue again — the next seq must continue from the historical max,
    //     never fall back to 1. A plain `INTEGER PRIMARY KEY` would reuse rowid 1 here since SQLite's
    //     default rowid-assignment picks (current MAX(rowid) + 1), which resets to 1 once the table is
    //     empty; AUTOINCREMENT tracks the high-water mark separately in sqlite_sequence and never reuses.
    // ─────────────────────────────────────────────────────────────────────

    [Fact]
    public async Task Seq_NeverReused_EvenAfterTheTableIsFullyDrained()
    {
        var spool = new BridgeSpool(NewTempDir());
        var seq1 = await spool.EnqueueAsync("t", new byte[] { 1 }, retain: false);
        var seq2 = await spool.EnqueueAsync("t", new byte[] { 2 }, retain: false);
        var seq3 = await spool.EnqueueAsync("t", new byte[] { 3 }, retain: false);

        // Drain the table to completely empty.
        await spool.AckThroughAsync(seq3);
        Assert.Empty(await spool.PeekBatchAsync(100));

        var seq4 = await spool.EnqueueAsync("t", new byte[] { 4 }, retain: false);

        Assert.True(seq4 > seq3, $"expected seq4 ({seq4}) > seq3 ({seq3}) — seq must never fall back to 1 after the table empties.");
        Assert.NotEqual(seq1, seq4);
    }

    // ─────────────────────────────────────────────────────────────────────
    // 4. dropped_total also survives a restart.
    // ─────────────────────────────────────────────────────────────────────

    [Fact]
    public async Task DroppedTotal_SurvivesRestart()
    {
        var dir = NewTempDir();
        var first = new BridgeSpool(dir, maxBytes: 10);
        for (var i = 0; i < 5; i++)
        {
            await first.EnqueueAsync("t", new byte[8], retain: false); // 8 bytes each, cap is 10
        }

        var dropped = await first.TrimAsync();
        Assert.True(dropped > 0);

        var statsBefore = await first.StatsAsync();
        Assert.Equal(dropped, statsBefore.DroppedTotal);

        SqliteConnection.ClearAllPools();
        var second = new BridgeSpool(dir, maxBytes: 10);
        var statsAfter = await second.StatsAsync();

        Assert.Equal(statsBefore.DroppedTotal, statsAfter.DroppedTotal);
    }

    // ─────────────────────────────────────────────────────────────────────
    // 5. Trim by AGE drops oldest-first and increments dropped_total. Deterministic: enqueue via the
    //    public API, then rewrite `enqueued_at` directly via a raw connection to simulate age — no real
    //    sleeps (chosen over injecting a clock: keeps the production class free of test-only seams while
    //    still exercising the real cutoff-comparison SQL).
    // ─────────────────────────────────────────────────────────────────────

    [Fact]
    public async Task TrimAsync_ByAge_DropsOldestFirst_IncrementsDroppedTotal()
    {
        var dir = NewTempDir();
        var spool = new BridgeSpool(dir, maxAgeHours: 48);

        var seqOld1 = await spool.EnqueueAsync("t", new byte[] { 1 }, retain: false);
        var seqOld2 = await spool.EnqueueAsync("t", new byte[] { 2 }, retain: false);
        var seqFresh = await spool.EnqueueAsync("t", new byte[] { 3 }, retain: false);

        BackdateEnqueuedAt(dir, seqOld1, DateTimeOffset.UtcNow.AddHours(-72));
        BackdateEnqueuedAt(dir, seqOld2, DateTimeOffset.UtcNow.AddHours(-49));
        // seqFresh left at "now" — inside the 48h window, must survive.

        var dropped = await spool.TrimAsync();

        Assert.Equal(2, dropped);
        var remaining = await spool.PeekBatchAsync(100);
        Assert.Equal(new[] { seqFresh }, remaining.Select(i => i.Seq).ToArray());

        var stats = await spool.StatsAsync();
        Assert.Equal(2, stats.DroppedTotal);
    }

    // ─────────────────────────────────────────────────────────────────────
    // 6. Trim by BYTES drops oldest-first and increments dropped_total. Byte measure: SUM(LENGTH(payload))
    //    across all rows (see BridgeSpool's doc comment for why) — the test's payload sizes are chosen so
    //    the expected drop count is unambiguous under that exact measure.
    // ─────────────────────────────────────────────────────────────────────

    [Fact]
    public async Task TrimAsync_ByBytes_DropsOldestFirst_IncrementsDroppedTotal()
    {
        var spool = new BridgeSpool(NewTempDir(), maxBytes: 25); // budget fits exactly 2 of the 10-byte payloads

        var seq1 = await spool.EnqueueAsync("t", new byte[10], retain: false);
        var seq2 = await spool.EnqueueAsync("t", new byte[10], retain: false);
        var seq3 = await spool.EnqueueAsync("t", new byte[10], retain: false); // total now 30 > 25

        var dropped = await spool.TrimAsync();

        Assert.Equal(1, dropped); // drop the single oldest (seq1) -> remaining 20 bytes <= 25
        var remaining = await spool.PeekBatchAsync(100);
        Assert.Equal(new[] { seq2, seq3 }, remaining.Select(i => i.Seq).ToArray());

        var stats = await spool.StatsAsync();
        Assert.Equal(1, stats.DroppedTotal);
    }

    [Fact]
    public async Task TrimAsync_ByBytes_ASingleHugeItemAloneOverBudget_IsNeverDroppedToEmpty()
    {
        var spool = new BridgeSpool(NewTempDir(), maxBytes: 5);

        var seq1 = await spool.EnqueueAsync("t", new byte[50], retain: false); // alone already over budget

        var dropped = await spool.TrimAsync();

        Assert.Equal(0, dropped); // nothing else to drop in its place — the single newest item survives
        var remaining = await spool.PeekBatchAsync(100);
        Assert.Equal(new[] { seq1 }, remaining.Select(i => i.Seq).ToArray());
    }

    [Fact]
    public async Task TrimAsync_UnderBudget_IsANoOp()
    {
        var spool = new BridgeSpool(NewTempDir(), maxBytes: 10_000, maxAgeHours: 48);
        await spool.EnqueueAsync("t", new byte[] { 1, 2, 3 }, retain: false);

        var dropped = await spool.TrimAsync();

        Assert.Equal(0, dropped);
        Assert.Equal(1, (await spool.StatsAsync()).Depth);
        Assert.Equal(0, (await spool.StatsAsync()).DroppedTotal);
    }

    // ─────────────────────────────────────────────────────────────────────
    // 7. Binary fidelity — a Sparkplug-B-protobuf-shaped byte[] (0x00 bytes + high bytes) round-trips
    //    byte-for-byte through the BLOB column.
    // ─────────────────────────────────────────────────────────────────────

    [Fact]
    public async Task EnqueueAsync_BinaryPayloadWithNullAndHighBytes_RoundTripsByteForByte()
    {
        var spool = new BridgeSpool(NewTempDir());
        var payload = SparkplugLikePayload();

        var seq = await spool.EnqueueAsync("spBv1.0/group/DDATA/edge/device", payload, retain: false);
        var batch = await spool.PeekBatchAsync(10);

        var item = Assert.Single(batch);
        Assert.Equal(seq, item.Seq);
        Assert.Equal(payload, item.Payload); // byte-for-byte, not just length
        Assert.Equal(payload.Length, item.Payload.Length);
    }

    // ─────────────────────────────────────────────────────────────────────
    // 8. A bad/unwritable directory (deleted out from under an already-constructed store) never throws
    //    from any public method — safe return values hold.
    // ─────────────────────────────────────────────────────────────────────

    [Fact]
    public async Task EnqueueAsync_NeverThrows_WhenTheDbDirectoryIsGone_ReturnsNegativeOne()
    {
        var dir = NewTempDir();
        Exception? captured = null;
        var spool = new BridgeSpool(dir, logError: (ex, _) => captured = ex);

        SqliteConnection.ClearAllPools();
        Directory.Delete(dir, recursive: true);

        var seq = await spool.EnqueueAsync("t", new byte[] { 1 }, retain: false);

        Assert.Equal(-1, seq);
        Assert.NotNull(captured);
    }

    [Fact]
    public async Task PeekBatchAsync_NeverThrows_WhenTheDbDirectoryIsGone_ReturnsEmpty()
    {
        var dir = NewTempDir();
        var spool = new BridgeSpool(dir);
        await spool.EnqueueAsync("t", new byte[] { 1 }, retain: false);

        SqliteConnection.ClearAllPools();
        Directory.Delete(dir, recursive: true);

        var batch = await spool.PeekBatchAsync(10);

        Assert.Empty(batch);
    }

    [Fact]
    public async Task AckThroughAsync_NeverThrows_WhenTheDbDirectoryIsGone()
    {
        var dir = NewTempDir();
        var spool = new BridgeSpool(dir);
        var seq = await spool.EnqueueAsync("t", new byte[] { 1 }, retain: false);

        SqliteConnection.ClearAllPools();
        Directory.Delete(dir, recursive: true);

        // Must not throw.
        await spool.AckThroughAsync(seq);
    }

    [Fact]
    public async Task StatsAsync_NeverThrows_WhenTheDbDirectoryIsGone_ReturnsEmptyStats()
    {
        var dir = NewTempDir();
        var spool = new BridgeSpool(dir);

        SqliteConnection.ClearAllPools();
        Directory.Delete(dir, recursive: true);

        var stats = await spool.StatsAsync();

        Assert.Equal(0, stats.Depth);
        Assert.Equal(0, stats.DroppedTotal);
        Assert.Null(stats.OldestUtc);
    }

    [Fact]
    public async Task TrimAsync_NeverThrows_WhenTheDbDirectoryIsGone_ReturnsZero()
    {
        var dir = NewTempDir();
        var spool = new BridgeSpool(dir);

        SqliteConnection.ClearAllPools();
        Directory.Delete(dir, recursive: true);

        var dropped = await spool.TrimAsync();

        Assert.Equal(0, dropped);
    }

    // ─────────────────────────────────────────────────────────────────────
    // 9. Concurrent enqueues from several tasks -> no duplicate seq values.
    // ─────────────────────────────────────────────────────────────────────

    [Fact]
    public async Task EnqueueAsync_ManyConcurrentCalls_NoDuplicateSeqValues()
    {
        var spool = new BridgeSpool(NewTempDir());
        const int n = 50;

        var tasks = new Task<long>[n];
        for (var i = 0; i < n; i++)
        {
            var idx = i;
            tasks[idx] = spool.EnqueueAsync("t", new byte[] { (byte)idx }, retain: false);
        }

        var seqs = await Task.WhenAll(tasks);

        Assert.All(seqs, s => Assert.True(s > 0));
        Assert.Equal(n, seqs.Distinct().Count());

        var stats = await spool.StatsAsync();
        Assert.Equal(n, stats.Depth);
    }

    // ─────────────────────────────────────────────────────────────────────
    // Directory resolution — same house idiom as AlarmStore/SiteLinkStore.
    // ─────────────────────────────────────────────────────────────────────

    [Fact]
    public void ResolveRoot_EnvOverride_ReturnsConfiguredDirectory()
    {
        var previous = Environment.GetEnvironmentVariable(BridgeSpool.EnvVarDir);
        try
        {
            var tempDir = Path.Combine(Path.GetTempPath(), "st4i-bridgespool-env-" + Guid.NewGuid().ToString("N"));
            Environment.SetEnvironmentVariable(BridgeSpool.EnvVarDir, tempDir);

            Assert.Equal(tempDir, BridgeSpool.ResolveRoot());
        }
        finally
        {
            Environment.SetEnvironmentVariable(BridgeSpool.EnvVarDir, previous);
        }
    }

    [Fact]
    public void ResolveRoot_ExplicitDirectory_TakesPriorityOverEnvVar()
    {
        var previous = Environment.GetEnvironmentVariable(BridgeSpool.EnvVarDir);
        try
        {
            Environment.SetEnvironmentVariable(BridgeSpool.EnvVarDir, Path.Combine(Path.GetTempPath(), "st4i-bridgespool-env-should-not-win"));
            var explicitDir = Path.Combine(Path.GetTempPath(), "st4i-bridgespool-explicit-" + Guid.NewGuid().ToString("N"));

            Assert.Equal(explicitDir, BridgeSpool.ResolveRoot(explicitDir));
        }
        finally
        {
            Environment.SetEnvironmentVariable(BridgeSpool.EnvVarDir, previous);
        }
    }

    [Fact]
    public void ResolveRoot_NoOverrideAtAll_ReturnsDefaultRoot()
    {
        var previous = Environment.GetEnvironmentVariable(BridgeSpool.EnvVarDir);
        try
        {
            Environment.SetEnvironmentVariable(BridgeSpool.EnvVarDir, null);

            Assert.Equal(BridgeSpool.DefaultRoot(), BridgeSpool.ResolveRoot());
        }
        finally
        {
            Environment.SetEnvironmentVariable(BridgeSpool.EnvVarDir, previous);
        }
    }

    [Fact]
    public void DefaultRoot_IsSiblingOfSitelinkDefaultDir_NotTheSameDirectory()
    {
        var sitelinkRoot = SiteLinkStore.DefaultRoot();
        var bridgeSpoolRoot = BridgeSpool.DefaultRoot();

        Assert.NotEqual(sitelinkRoot, bridgeSpoolRoot);
        Assert.Equal(Path.GetDirectoryName(sitelinkRoot), Path.GetDirectoryName(bridgeSpoolRoot));
        Assert.EndsWith("bridge-spool", bridgeSpoolRoot, StringComparison.Ordinal);
    }

    [Fact]
    public void BridgeSpoolOptions_FromEnvironment_UnparseableValues_FallBackToDefaults()
    {
        var previousDir = Environment.GetEnvironmentVariable(BridgeSpoolOptions.EnvVarDir);
        var previousEnabled = Environment.GetEnvironmentVariable(BridgeSpoolOptions.EnvVarEnabled);
        var previousMaxBytes = Environment.GetEnvironmentVariable(BridgeSpoolOptions.EnvVarMaxBytes);
        var previousMaxAge = Environment.GetEnvironmentVariable(BridgeSpoolOptions.EnvVarMaxAgeHours);
        try
        {
            Environment.SetEnvironmentVariable(BridgeSpoolOptions.EnvVarDir, null);
            Environment.SetEnvironmentVariable(BridgeSpoolOptions.EnvVarEnabled, "not-a-bool");
            Environment.SetEnvironmentVariable(BridgeSpoolOptions.EnvVarMaxBytes, "not-a-number");
            Environment.SetEnvironmentVariable(BridgeSpoolOptions.EnvVarMaxAgeHours, "not-a-number-either");

            var options = BridgeSpoolOptions.FromEnvironment();

            Assert.True(options.Enabled); // unparseable ST4I_BRIDGE_SPOOL_ENABLED -> default true
            Assert.Equal(64L * 1024 * 1024, options.MaxBytes);
            Assert.Equal(48, options.MaxAgeHours);
            Assert.Null(options.Directory);
        }
        finally
        {
            Environment.SetEnvironmentVariable(BridgeSpoolOptions.EnvVarDir, previousDir);
            Environment.SetEnvironmentVariable(BridgeSpoolOptions.EnvVarEnabled, previousEnabled);
            Environment.SetEnvironmentVariable(BridgeSpoolOptions.EnvVarMaxBytes, previousMaxBytes);
            Environment.SetEnvironmentVariable(BridgeSpoolOptions.EnvVarMaxAgeHours, previousMaxAge);
        }
    }

    [Fact]
    public void BridgeSpoolOptions_FromEnvironment_ExplicitDisabled_ParsesFalse()
    {
        var previous = Environment.GetEnvironmentVariable(BridgeSpoolOptions.EnvVarEnabled);
        try
        {
            Environment.SetEnvironmentVariable(BridgeSpoolOptions.EnvVarEnabled, "false");
            Assert.False(BridgeSpoolOptions.FromEnvironment().Enabled);

            Environment.SetEnvironmentVariable(BridgeSpoolOptions.EnvVarEnabled, "0");
            Assert.False(BridgeSpoolOptions.FromEnvironment().Enabled);
        }
        finally
        {
            Environment.SetEnvironmentVariable(BridgeSpoolOptions.EnvVarEnabled, previous);
        }
    }

    // Directly UPDATEs enqueued_at on a raw connection to the store's own DB file — deterministic
    // age-simulation with no real sleeps (see the age-trim test's own doc comment above for the rationale).
    private static void BackdateEnqueuedAt(string directory, long seq, DateTimeOffset at)
    {
        var dbPath = Path.Combine(directory, "bridge-spool.db");
        using var connection = new SqliteConnection($"Data Source={dbPath}");
        connection.Open();
        using var cmd = connection.CreateCommand();
        cmd.CommandText = "UPDATE spool SET enqueued_at = @at WHERE seq = @seq;";
        cmd.Parameters.AddWithValue("@at", at.ToUniversalTime().ToString("O"));
        cmd.Parameters.AddWithValue("@seq", seq);
        cmd.ExecuteNonQuery();
    }
}
