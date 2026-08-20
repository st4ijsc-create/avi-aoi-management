using System.Text.Json;

namespace St4i.EdgeCore.Historian;

/// <summary>
/// WS-A-T1 — the flat, storage-ready projection of one <see cref="St4i.Connector.Abstractions.Models.DeviceReading"/> +
/// its <see cref="St4i.EdgeCore.Models.TransportAck"/>. Every scalar is carried over untouched (raw
/// <c>CycleCounter</c>, no offset-adjustment — that belongs to a caller like <c>MachineState</c>, not the
/// historian); the metric/telemetry/measurement collections are reduced the SAME way the rest of the app
/// already reduces them, never a second, independently-invented rule.
/// </summary>
/// <param name="MachineCode">Which machine produced this, taken from the READING rather than from the
/// descriptor beside it — unlike <paramref name="DeviceClass"/> and <paramref name="MachineType"/>, which
/// come from the descriptor. A driver that reports a code the roster does not contain therefore writes that
/// code into history, and nothing here reconciles the two.</param>
/// <param name="DeviceClass">The descriptor's device class, rendered as the ENUM MEMBER'S NAME. It is
/// stored as text, so the member's spelling is what history is written in: renaming a member does not
/// migrate the rows already stored under the old name, it splits them off.</param>
/// <param name="MachineType">The descriptor's free-form type string, copied verbatim — no casing rule and
/// no vocabulary is enforced anywhere on the way in, so this column holds exactly what somebody typed into
/// the roster.</param>
/// <param name="ReadingKind">The reading's kind as the enum member's name. Load-bearing rather than
/// descriptive: the OEE aggregate selects on the literal <c>ProcessResult</c>, so a reading whose kind does
/// not spell that exactly is invisible to every OEE number this product reports.</param>
/// <param name="CycleCounter">The driver's own cycle number, raw. It is neither unique nor monotonic across
/// time — a driver that restarts begins counting again, and two machines share the whole range — so it
/// identifies a cycle only together with <paramref name="MachineCode"/>. It is not a quantity to sum: it is
/// a label.</param>
/// <param name="SerialNumber">The unit this cycle acted on. This is the column with an index of its own, and
/// that index is what makes the genealogy trace of one unit cheap; a simulated machine composes it from its
/// roster seed plus a zero-padded cycle number, so it is unique per cycle but only as unique BETWEEN
/// machines as their seeds are.</param>
/// <param name="Verdict">The reading's verdict as the enum member's name. Three of those names are matched
/// as string literals by the OEE aggregate — one to exclude a reading from the denominator, two to credit
/// it to the numerator — so this column's spelling sets the quality figure long after the reading itself is
/// gone.</param>
/// <param name="RecipeCode">The recipe in force, as the reading reported it, or <see langword="null"/> when
/// neither the driver nor the roster named one. There is no reference to the recipe store: this is a
/// remembered string, and the recipe it names may since have been edited or deleted.</param>
/// <param name="RecipeVersion">The recipe's version as the reading reported it, with the same
/// no-reference caveat as <paramref name="RecipeCode"/>. The pair is what lets a stored row be re-read
/// against the specification that was actually in force — provided somebody kept that version
/// somewhere, which this store does not.</param>
/// <param name="KeyMetricName">🔴 "Key" is a POSITION, not a judgement: this is the FIRST metric the reading
/// carried, and nothing ranks or selects among the others. A driver that reorders its metrics changes which
/// one history records as key, with no other visible effect. <see langword="null"/> when the reading carried
/// no metrics at all.</param>
/// <param name="KeyMetricValue">That first metric's value, unrounded and unconverted.
/// <see langword="null"/> exactly when the reading had no metrics — never a sentinel, so a stored zero is a
/// measured zero.</param>
/// <param name="KeyMetricUnit">That first metric's unit as the driver spelled it. Nothing normalizes units
/// anywhere on this path, so <c>mm</c> and <c>millimetre</c> are two units to every consumer of this
/// column.</param>
/// <param name="NgCount">How many of the reading's MEASUREMENT POINTS were judged NG, counted by
/// case-insensitive comparison against that one token and by nothing else. It is not derived from
/// <paramref name="Verdict"/> and does not have to agree with it — the two are independent judgements made
/// at different places — and it says nothing about metrics, only about points.</param>
/// <param name="PointCount">How many measurement points the reading carried, and therefore the denominator
/// <paramref name="NgCount"/> is out of. Zero for a reading with no points at all, which is the normal shape
/// of a process result or a telemetry sample rather than an anomaly.</param>
/// <param name="AckSuccess">Whether the ecosystem server accepted this reading. These three ack booleans are
/// ALL that survives of the send: the status code, the latency, the server-assigned id and the error message
/// are all discarded here, so this store can say that a reading failed to ship but never why.</param>
/// <param name="AckDuplicate">Whether the server recognised this reading as one it already had. A duplicate
/// is a success, and this is the durable record that a reading was sent more than once but counted
/// once.</param>
/// <param name="AckQueued">Whether the reading was taken by a store-and-forward queue instead of reaching
/// the server on that attempt. Combined with <paramref name="AckSuccess"/> it distinguishes an accepted
/// deferral from a local buffer catching a failure — the same two-bit distinction the operator sees
/// live.</param>
/// <param name="GenealogyJson">The reading's genealogy, serialized with web-default JSON options
/// (camelCase), or <see langword="null"/> when it was absent or empty — an empty collection is stored as
/// null, not as <c>[]</c>. It is opaque TEXT to this store: nothing indexes it and no query looks
/// inside.</param>
/// <param name="MeasurementsJson">The reading's measurement points, serialized the same way and null on the
/// same empty rule. It is the ONLY place the individual points survive, and
/// <paramref name="PointCount"/>/<paramref name="NgCount"/> are the pre-computed summaries of it — which
/// means those two are the only queryable facts about the points, and re-deriving anything else costs a
/// parse per row.</param>
/// <param name="EventTimeUtc">When the machine says the cycle happened, converted to UTC. This is the
/// column every window, every sort by time and the retention cutoff use, so it is the clock that governs
/// this store — and it is the MACHINE's clock, not this edge's. A machine whose clock is wrong files its
/// history in the wrong place and gets pruned on the wrong day.</param>
/// <param name="IngestedAtUtc">When this edge folded the row, supplied by the caller rather than read from
/// a clock in here. Its distance from <paramref name="EventTimeUtc"/> is the replay lag, which is the one
/// way a stored row shows that it arrived out of a backlog rather than live.</param>
/// <param name="TelemetrySamples">The reading's numeric telemetry, already filtered: a sample whose value is
/// not genuinely numeric is dropped on the way in rather than stored as null, so this collection is not a
/// complete record of what the device published. 🔴 It is also always EMPTY on a record read back out of the
/// store — samples live in their own table and are fetched by a separate query — so a caller must never
/// treat an empty collection here as "this reading had no telemetry".</param>
/// <param name="IsFabricated">SM-2 (.superpowers/sdd/2026-07-29-dotA-single-machine-sellable-blueprint/
/// task-2-brief.md) — data lineage, explicit at the source rather than inferred later: whether this
/// reading came from a fabricated (simulated/demo) machine, computed ONCE, at write time, from the SAME
/// <see cref="St4i.EdgeCore.Models.MachineDescriptor.DriverKind"/> every other classification in this
/// codebase already reads (see <see cref="From"/> and the single canonical
/// <see cref="St4i.Connector.Abstractions.Models.DriverKinds.IsFabricated"/> call path it uses) — never
/// re-derived later by looking up a machine's CURRENT driver kind, which would be fragile (the roster
/// changes, machines get re-registered under the same code, and a row written months ago must still be
/// classifiable on its own). <see cref="From"/> ALWAYS sets a concrete <see langword="true"/>/
/// <see langword="false"/> value here — <see langword="null"/> only ever arises from
/// <see cref="SqliteHistorianStore"/> reading back a row written before this column existed (see that
/// class's migration ladder), and is this project's deliberate "Unknown provenance" state — see
/// <see cref="SqliteHistorianStore"/>'s own doc comment for what a query does with it.</param>
public sealed record HistorianResultRecord(
    string MachineCode, string DeviceClass, string MachineType, string ReadingKind,
    long CycleCounter, string SerialNumber, string Verdict,
    string? RecipeCode, string? RecipeVersion,
    string? KeyMetricName, double? KeyMetricValue, string? KeyMetricUnit,
    int NgCount, int PointCount,
    bool AckSuccess, bool AckDuplicate, bool AckQueued,
    string? GenealogyJson, string? MeasurementsJson,
    DateTimeOffset EventTimeUtc, DateTimeOffset IngestedAtUtc,
    IReadOnlyList<TelemetrySampleRecord> TelemetrySamples,
    bool? IsFabricated = null)
{
    private static readonly JsonSerializerOptions JsonOptions = new(JsonSerializerDefaults.Web);

    /// <summary>The one place a row is composed for storage, and the place four separate sources are
    /// reconciled into one flat record. It is worth reading as a set of DECISIONS rather than as a copy,
    /// because three of them are not visible anywhere else: which metric becomes the key one (the first,
    /// positionally), what counts as NG (a case-insensitive match on one token, over measurement points
    /// only), and whether the row is fabricated (decided HERE, at write time, from the descriptor's driver
    /// kind — never re-derived later, because the roster can change while a stored row cannot).
    /// <para>It never throws and never rejects: a reading with no metrics, no measurements and no telemetry
    /// produces a complete row full of nulls and zeros. Nothing here validates that the reading's machine
    /// code matches the descriptor's, so the two identities in the result can disagree.</para></summary>
    /// <param name="descriptor">The roster entry, consulted for the machine's CLASSIFICATION and for its
    /// driver kind. Its <c>Code</c> is deliberately not used — the reading's own machine code wins.</param>
    /// <param name="reading">The finished cycle. Everything measured comes from here, and its collections
    /// are read defensively: absent and empty are treated alike.</param>
    /// <param name="ack">What the send resulted in. Only three of its booleans are kept; the rest of the
    /// send's outcome is not persisted by this product at all.</param>
    /// <param name="ingestedAtUtc">The moment to record as ingestion time. It is a parameter rather than a
    /// clock read so that a batch replayed out of a backlog can be stamped consistently, and so that tests
    /// are not at the mercy of a real clock. Nothing checks that it is later than the reading's own
    /// timestamp.</param>
    /// <returns>A record ready for <see cref="IHistorianStore.AppendResultsAsync"/>, with no reference back
    /// to any of the four inputs.</returns>
    public static HistorianResultRecord From(
        St4i.EdgeCore.Models.MachineDescriptor descriptor,
        St4i.Connector.Abstractions.Models.DeviceReading reading,
        St4i.EdgeCore.Models.TransportAck ack,
        DateTimeOffset ingestedAtUtc)
    {
        var firstMetric = reading.Metrics.Count > 0 ? reading.Metrics[0] : null;

        // NG tally: MeasurementResult.Result carries the pass/fail token ("OK"/"NG"/"NTF" — see
        // Doc28Parser.ResultTokens) the same way MachineState.cs/MachineViewModel.cs/FleetHost.cs already
        // count it, so the historian never invents a second, disagreeing definition of "NG".
        var ngCount = reading.Measurements.Count(m => string.Equals(m.Result, "NG", StringComparison.OrdinalIgnoreCase));

        var telemetrySamples = new List<TelemetrySampleRecord>();
        foreach (var sample in reading.Telemetry)
        {
            // GĐ3 sub-3 OU-2 PART A — mirrors MachineState.cs's numeric-telemetry filter EXACTLY via the
            // ONE shared St4i.Connector.Abstractions.Models.TelemetryNumeric helper: a genuinely-numeric value (doubles,
            // ints, a numeric string like "42.5") is kept; anything else (null, a non-numeric string like
            // an OPC-UA "status"="RUNNING" tag) is silently skipped — NEVER throws (see TelemetryNumeric's
            // own class doc comment for why the old `is IConvertible ... ToDouble(null)` pattern this
            // replaced was unsafe: string IS IConvertible, so Convert.ToDouble("RUNNING") used to throw).
            if (!St4i.Connector.Abstractions.Models.TelemetryNumeric.TryGet(sample.Value, out var numeric)) continue;

            telemetrySamples.Add(new TelemetrySampleRecord(sample.Metric, numeric, sample.Unit, sample.Quality));
        }

        return new HistorianResultRecord(
            MachineCode: reading.MachineCode,
            DeviceClass: descriptor.DeviceClass.ToString(),
            MachineType: descriptor.MachineType.ToString(),
            ReadingKind: reading.Kind.ToString(),
            CycleCounter: reading.CycleCounter,
            SerialNumber: reading.SerialNumber,
            Verdict: reading.Verdict.ToString(),
            RecipeCode: reading.RecipeCode,
            RecipeVersion: reading.RecipeVersion,
            KeyMetricName: firstMetric?.Name,
            KeyMetricValue: firstMetric?.Value,
            KeyMetricUnit: firstMetric?.Unit,
            NgCount: ngCount,
            PointCount: reading.Measurements?.Count ?? 0,
            AckSuccess: ack.Success,
            AckDuplicate: ack.Duplicate,
            AckQueued: ack.Queued,
            GenealogyJson: reading.Genealogy is { Count: > 0 } genealogy ? JsonSerializer.Serialize(genealogy, JsonOptions) : null,
            MeasurementsJson: reading.Measurements is { Count: > 0 } measurements ? JsonSerializer.Serialize(measurements, JsonOptions) : null,
            EventTimeUtc: reading.Timestamp.ToUniversalTime(),
            IngestedAtUtc: ingestedAtUtc,
            TelemetrySamples: telemetrySamples,
            IsFabricated: St4i.Connector.Abstractions.Models.DriverKinds.IsFabricated(descriptor.DriverKind));
    }
}

/// <summary>A stored reading together with the identity the STORE gave it. The pairing exists because
/// <see cref="HistorianResultRecord"/> deliberately has no identity of its own — it is the shape of a
/// reading, not of a row — so nothing before storage can refer to a particular one.</summary>
/// <param name="Id">The store's own row id, assigned on append. It is the only durable handle this product
/// has on a single stored reading, and it is NOT the ecosystem server's id for the same reading — that one
/// arrives on the ack and is discarded. Because it is assigned in append order it also serves as the
/// browse's sort key, which is why paging by it is paging by arrival rather than by
/// event time.</param>
/// <param name="Record">The reading as stored. Its
/// <see cref="HistorianResultRecord.TelemetrySamples"/> is always empty here, whatever was written.</param>
public sealed record HistorianResultRow(long Id, HistorianResultRecord Record);

/// <summary>One numeric telemetry sample as it is STORED — the write-side shape, distinct from
/// <see cref="TelemetrySamplePoint"/>, which is what a chart reads back. The two differ in what they keep,
/// so the round trip is lossy by design rather than by accident.</summary>
/// <param name="Metric">The series name, exactly as the driver published it. It is the read-side match key
/// and nothing normalizes it, so a driver that changes the spelling of a metric starts a new series and
/// abandons the old one.</param>
/// <param name="Value">The sample, already narrowed to a double. Samples whose values were not genuinely
/// numeric never reach this type — they are dropped upstream — so this collection is a filtered view of
/// what the device published, not a copy of it.</param>
/// <param name="Unit">The unit as the driver spelled it, or <see langword="null"/> when it published none.
/// Nothing converts or validates it, and it is DROPPED on the way back out, so two samples of the same
/// metric in different units are indistinguishable to every reader.</param>
/// <param name="Quality">The driver's own quality word — an OPC-UA style status, not an enum this product
/// defines. It is stored as given, never validated against any vocabulary, and it is also dropped on the way
/// back out.</param>
public sealed record TelemetrySampleRecord(string Metric, double Value, string? Unit, string Quality);

/// <summary>A line-state transition. These rows are the ONLY input to the run-time term of every OEE figure
/// this product reports, and they are line-wide — the type carries no machine, because the underlying table
/// has no column for one.</summary>
/// <param name="EventType">A free string of which exactly three values mean anything to the run-time
/// computation: <c>Start</c> opens an interval, <c>Stop</c> and <c>Estop</c> close it, all three compared
/// case-insensitively. Any other value — including <c>EstopReset</c>, which this product does write — is
/// stored, returned by the run-event query, and IGNORED by the computation. Nothing validates it at any
/// layer, so a typo becomes a row that silently never closes an interval.</param>
/// <param name="AtUtc">When the transition happened. It is the sole ordering key for the interval replay, so
/// two events written out of order are replayed in timestamp order, not in write order.</param>
/// <param name="Note">Free operator text. Stored, returned, and read by nothing in this codebase — it exists
/// to be shown to a human later.</param>
public sealed record HistorianRunEvent(string EventType, DateTimeOffset AtUtc, string? Note = null);

/// <summary>The whole vocabulary of the stored-results browse. Every filter here is an EXACT match except
/// the two timestamps, which are inclusive bounds — there is no wildcard, no prefix and no case folding
/// anywhere in it, and there is no way to express OR. A member left null is not a filter at all, so the
/// default-constructed query is "everything, newest 200 first, real data only".</summary>
/// <param name="MachineCode">One machine, spelled exactly as its readings were stored. Null means every
/// machine, which is what makes an unfiltered browse a line-wide view rather than an error.</param>
/// <param name="From">Earliest event time to include, inclusive. Null leaves that side unbounded, so the
/// browse reaches back as far as retention has left anything.</param>
/// <param name="To">Latest event time to include, inclusive. Both bounds are on the machine's own event
/// time, not on ingestion, so a backlog replayed today does not appear in today's window.</param>
/// <param name="SerialNumber">One unit, matched exactly. It filters within the paged browse; the unpaged
/// genealogy trace is a different method.</param>
/// <param name="Verdict">The stored verdict STRING, which means it must be spelled the way the verdict enum
/// spells its members. A value that matches no member is not an error — it is a filter that matches
/// nothing.</param>
/// <param name="ReadingKind">The stored reading-kind string, with the same spelling requirement and the same
/// silent-empty behaviour as <paramref name="Verdict"/>.</param>
/// <param name="Limit">Page size. 🔴 It is NOT validated or capped here and goes straight into the SQL
/// <c>LIMIT</c>: SQLite reads a NEGATIVE limit as "no limit at all", so a negative value returns the entire
/// filtered table rather than failing. The clamp that makes the shipped HTTP route safe lives in that
/// route, not in this type, so any other caller of this store inherits the raw behaviour.</param>
/// <param name="Offset">How many rows to skip. Paging is over row id descending — arrival order — so a page
/// boundary is stable only while nothing is being appended; on a live line, rows arriving between two page
/// requests push earlier rows down and a reader walking pages can see the same row twice.</param>
/// <param name="IncludeFabricated">SM-2 — the explicit opt-in escape hatch for a surface that
/// legitimately wants to see fabricated data too (e.g. a demo/exhibition historian view), per the task-2
/// brief: "the separation must be explicit, never an accident of aggregation." Default
/// <see langword="false"/> is this project's real-data-by-default posture: EXPLICITLY-fabricated rows
/// (<c>is_fabricated = 1</c>) are always excluded; Unknown-provenance rows (pre-migration,
/// <see langword="null"/>) are excluded too only once the SAME scope also contains at least one row
/// explicitly known to be real — see <see cref="SqliteHistorianStore"/>'s own
/// <c>ApplyRealPresenceGateAsync</c> doc comment for the full rule (and its round-1 correction) this flag
/// gates. Set <see langword="true"/> to bypass the whole rule and see every row regardless of
/// provenance.</param>
public sealed record HistorianResultQuery(
    string? MachineCode = null, DateTimeOffset? From = null, DateTimeOffset? To = null,
    string? SerialNumber = null, string? Verdict = null, string? ReadingKind = null,
    int Limit = 200, int Offset = 0, bool IncludeFabricated = false);

/// <summary>One page of the browse plus the two numbers a pager needs to draw itself. The count and the page
/// are read with two separate statements outside a transaction, so on a live line they can describe
/// populations a few rows apart; the pairing is a report of two observations, not a snapshot.</summary>
/// <param name="Items">The rows on this page, newest arrival first, at most <paramref name="Limit"/> of
/// them. Fewer than <paramref name="Limit"/> does not mean this is the last page — it means it is the last
/// page as of this read.</param>
/// <param name="Total">How many rows match the filter with paging removed. It is the count AFTER the
/// provenance gate, so it is the number of rows this caller is allowed to see, not the number
/// stored.</param>
/// <param name="Limit">The page size that was ASKED for, echoed back unchanged — not the number of rows
/// actually returned, which is <c>Items.Count</c>. The two differ on the last page and whenever the caller
/// asked for more than exists.</param>
/// <param name="Offset">The offset that was asked for, echoed back the same way. Neither this nor
/// <paramref name="Limit"/> is recomputed or corrected, so an out-of-range offset comes back verbatim beside
/// an empty page.</param>
public sealed record HistorianResultsPage(IReadOnlyList<HistorianResultRow> Items, int Total, int Limit, int Offset);

/// <summary>One point of a trend series — the READ-side shape of telemetry, and deliberately smaller than
/// <see cref="TelemetrySampleRecord"/>, the shape it was stored in. Unit and quality are dropped on the way
/// out, so a series returned here may mix units and may include samples the device itself flagged as bad,
/// with nothing in the data to say which.</summary>
/// <param name="At">The parent reading's event time, copied onto the sample when it was stored — so every
/// sample of one reading shares one instant, and a series is stepped at reading cadence rather than at any
/// finer sampling rate the device may have used.</param>
/// <param name="Value">The stored numeric value, unchanged.</param>
public sealed record TelemetrySamplePoint(DateTimeOffset At, double Value);

/// <summary>Everything the OEE calculation is allowed to know about one machine over one window — three
/// measured quantities and the window they were measured over, with no reference back to the store. 🔴 It is
/// NOT uniformly per-machine: the two counts are, the run time is not.</summary>
/// <param name="MachineCode">The machine the two counts were taken for. It does not describe
/// <paramref name="RunTime"/>.</param>
/// <param name="From">Start of the measured window, echoed from the request so the result can be labelled
/// without carrying the request around.</param>
/// <param name="To">End of the measured window, echoed the same way.</param>
/// <param name="TotalCount">Process-result readings in the window with any verdict except Skip — the
/// denominator of the quality term. It counts READINGS, not units and not measurement points, so a unit
/// inspected twice counts twice.</param>
/// <param name="GoodCount">Process-result readings in the window verdicted Pass or Warn — the numerator.
/// It is a strict subset of <paramref name="TotalCount"/> only because the two SQL predicates that produce
/// them are nested, and that nesting is the ONLY thing bounding the quality ratio: this type does not
/// enforce the relationship and the calculator does not check it.</param>
/// <param name="RunTime">🔴 How long the LINE was running in this window, not this machine. It is replayed
/// from line-wide run events that carry no machine at all, so every machine aggregated over the same window
/// receives the same value — a machine idle through a running shift is charged the shift's uptime, and its
/// availability reads as though it had been working.</param>
public sealed record OeeInputAggregate(string MachineCode, DateTimeOffset From, DateTimeOffset To, long TotalCount, long GoodCount, TimeSpan RunTime);

/// <summary>The state of the store itself — what an operator needs in order to decide whether to prune.
/// Every figure is unfiltered: no machine, no window, and no provenance gate, so these counts include
/// fabricated rows that no customer-facing query would show.</summary>
/// <param name="ResultRowCount">Stored readings, all machines, all time.</param>
/// <param name="TelemetryRowCount">Stored telemetry samples. It is normally much larger than
/// <paramref name="ResultRowCount"/> — one reading explodes into one row per numeric sample — so the two are
/// not comparable magnitudes and their ratio is a property of the drivers, not of the store.</param>
/// <param name="OldestEventTimeUtc">Earliest event time among stored READINGS only; telemetry and run events
/// are not consulted. <see langword="null"/> when there are no readings, which is a different state from
/// "no data" — run events can exist with no readings at all.</param>
/// <param name="NewestEventTimeUtc">Latest event time among stored readings, with the same two caveats. It
/// is the machine's clock, so a machine with a wrong clock can push this into the future.</param>
/// <param name="DbSizeBytes">Size of the main database FILE. It excludes the write-ahead-log sidecar, so it
/// can under-report data already committed, and it does not shrink when rows are pruned, because freed pages
/// are reused rather than returned. It measures the container, never the data.</param>
public sealed record HistorianStats(long ResultRowCount, long TelemetryRowCount, DateTimeOffset? OldestEventTimeUtc, DateTimeOffset? NewestEventTimeUtc, long DbSizeBytes);
