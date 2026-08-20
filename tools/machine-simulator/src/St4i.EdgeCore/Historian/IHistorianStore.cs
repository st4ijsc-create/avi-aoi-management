namespace St4i.EdgeCore.Historian;

/// <summary>
/// WS-A-T1 — storage-agnostic contract for the durable historian. No implementation lives here (SQLite
/// comes in a later WS-A task); this is the shape every historian backend (and every caller — the edge
/// pipeline appending results, the HMI/API querying them) is written against.
/// </summary>
public interface IHistorianStore
{
    /// <summary>Commits a batch of finished readings, all or none. The batch is the unit of durability, not
    /// the record: a caller that needs a single reading on disk sends a batch of one and waits. Each
    /// record's nested telemetry samples are stored as their own rows attached to that result, so this one
    /// call writes to two tables and the two can never disagree about which reading a sample belongs
    /// to.</summary>
    /// <param name="records">The readings to commit, in the order they should be numbered — insertion order
    /// is what later "newest first" reads sort by, so it is a meaningful order and not a set. An empty list
    /// is a no-op that does no I/O at all.</param>
    /// <param name="ct">Cancels the commit. Cancellation before the commit point leaves NOTHING written;
    /// there is no partial batch to clean up.</param>
    Task AppendResultsAsync(IReadOnlyList<HistorianResultRecord> records, CancellationToken ct);

    /// <summary>Records one line-state transition. These are the events the OEE run-time term is computed
    /// from, and they are the only thing in this store that is not about a reading.</summary>
    /// <param name="runEvent">The transition. 🔴 It carries no machine — run state here is a property of the
    /// LINE, so an event written while one machine is being serviced applies to every machine's OEE
    /// window.</param>
    /// <param name="ct">Cancels the write.</param>
    Task AppendRunEventAsync(HistorianRunEvent runEvent, CancellationToken ct);

    /// <summary>The operator-facing browse over stored readings: filter, count, page. Two things about the
    /// rows it returns are not visible in the signature — they come back NEWEST FIRST, and their
    /// <see cref="HistorianResultRecord.TelemetrySamples"/> is ALWAYS empty regardless of what was stored,
    /// because telemetry is a separate table fetched on demand by
    /// <see cref="QueryTelemetryAsync"/>.</summary>
    /// <param name="query">Filters, paging, and the provenance escape hatch. Every filter it carries is an
    /// exact match, never a prefix or a range except for the two timestamps.</param>
    /// <param name="ct">Cancels the read.</param>
    Task<HistorianResultsPage> QueryResultsAsync(HistorianResultQuery query, CancellationToken ct);

    /// <summary>Every stored reading carrying one serial, across ALL machines — this is the genealogy trace
    /// of a unit as it moved down the line, not a query about a machine. It returns rows in EVENT-TIME
    /// ORDER, oldest first, which is the opposite of <see cref="QueryResultsAsync"/> and is the point: the
    /// order is the route the unit took. There is no paging, so a serial that was re-worked many times
    /// returns everything.</summary>
    /// <param name="includeFabricated">SM-2 fix round 1 (review IMPORTANT 2) — same explicit opt-in
    /// escape hatch as <see cref="HistorianResultQuery.IncludeFabricated"/>: default
    /// <see langword="false"/> applies the real-presence gate documented on
    /// <see cref="SqliteHistorianStore"/>'s own <c>ApplyRealPresenceGateAsync</c> (the web "View genealogy"
    /// dialog's own data source — gated so a fabricated reading can never silently present as a real
    /// unit's genealogy); <see langword="true"/> bypasses it and returns every row regardless of
    /// provenance.</param>
    /// <param name="serialNumber">The unit's serial, matched exactly. Serials are generated per machine from
    /// <see cref="Models.MachineDescriptor.SerialSeed"/>, so two machines configured with the same seed will
    /// return each other's rows here and this method cannot tell them apart.</param>
    /// <param name="ct">Cancels the read.</param>
    Task<IReadOnlyList<HistorianResultRow>> QueryBySerialAsync(string serialNumber, CancellationToken ct, bool includeFabricated = false);

    /// <summary>One metric's stored samples for one machine over a window — the series behind a trend chart.
    /// It reads the stored samples directly and never joins back to the reading that produced them; a sample
    /// nevertheless lives and dies with that reading, because pruning a result takes its samples with it.
    /// <para>🔴 This is the ONE read on this interface with no provenance parameter, and that is not an
    /// oversight to be read past: it returns a fabricated machine's samples unfiltered, while the two reads
    /// above it and the aggregate below it all default to hiding them. The reason is structural rather than
    /// a policy choice — the stored sample carries no provenance of its own, only a link to the result that
    /// produced it — so the asymmetry cannot be closed by passing a flag here. A caller charting a mixed
    /// fleet is charting demo data alongside real data and nothing in the signature says so.</para></summary>
    /// <param name="machineCode">The machine, matched exactly. Samples are stored with the machine code
    /// copied onto them, so this does not join back to the result row.</param>
    /// <param name="metric">The metric name, matched exactly and case-sensitively as stored. Metric names
    /// are whatever the driver emitted; nothing normalizes them, so a driver that renames a metric starts a
    /// new series rather than continuing the old one.</param>
    /// <param name="from">Start of the window, inclusive.</param>
    /// <param name="to">End of the window, inclusive. Both ends are compared against the sample's EVENT
    /// time, which is copied from the parent reading — not against when the sample was written.</param>
    /// <param name="ct">Cancels the read.</param>
    Task<IReadOnlyList<TelemetrySamplePoint>> QueryTelemetryAsync(string machineCode, string metric, DateTimeOffset from, DateTimeOffset to, CancellationToken ct);

    /// <summary>Reduces one machine's stored history over a window to the three quantities OEE needs. It is
    /// the boundary between this store and <see cref="Metrics.OeeCalculator"/>: everything domain-specific
    /// about WHICH readings count happens here, and the calculator only divides.
    /// <para>🔴 The returned aggregate is not uniformly per-machine, and the signature hides it. The two
    /// counts are this machine's, restricted to process-result readings; the run time is the LINE's,
    /// computed from run events that carry no machine at all. So two machines on one line over one window
    /// return different counts and identical run time, and a machine that was idle while the line ran gets
    /// charged for the line's uptime.</para></summary>
    /// <param name="machineCode">The machine whose readings are counted, matched exactly. It does NOT
    /// restrict the run-time term.</param>
    /// <param name="from">Start of the window, inclusive, compared against event time.</param>
    /// <param name="to">End of the window, inclusive. Run-time intervals that straddle either edge are
    /// clipped to the window rather than dropped, and an interval still open at <c>to</c> is counted as
    /// running right up to it.</param>
    /// <param name="ct">Cancels the read.</param>
    /// <param name="includeFabricated">SM-2 — same explicit opt-in escape hatch as
    /// <see cref="HistorianResultQuery.IncludeFabricated"/>: default <see langword="false"/> applies the
    /// real-presence gate documented on <see cref="SqliteHistorianStore.AggregateForOeeAsync"/>;
    /// <see langword="true"/> bypasses it and aggregates every row regardless of provenance.</param>
    Task<OeeInputAggregate> AggregateForOeeAsync(string machineCode, DateTimeOffset from, DateTimeOffset to, CancellationToken ct, bool includeFabricated = false);

    /// <summary>The line-state transitions in a window, oldest first — the raw material behind the run-time
    /// term, exposed so a caller can show the operator WHY a window scored what it did. There is no machine
    /// filter because the events have no machine, and no provenance filter because they have no provenance
    /// either: a demo session and a real shift write indistinguishable rows here.</summary>
    /// <param name="from">Start of the window, inclusive.</param>
    /// <param name="to">End of the window, inclusive.</param>
    /// <param name="ct">Cancels the read.</param>
    Task<IReadOnlyList<HistorianRunEvent>> QueryRunEventsAsync(DateTimeOffset from, DateTimeOffset to, CancellationToken ct);

    /// <summary>Retention, applied by hand: deletes stored history older than a cutoff. This is the only
    /// method on this interface that destroys data, and nothing calls it on a timer — a deployment that
    /// never invokes it never prunes.</summary>
    /// <param name="cutoffUtc">Rows STRICTLY older than this are deleted; a row exactly at the cutoff
    /// survives. Results are judged by their event time, not by when they were ingested, so replaying old
    /// data into a fresh database writes rows that are already prunable.</param>
    /// <param name="ct">Cancels the prune.</param>
    /// <returns>🔴 The number of RESULT rows deleted only. Their telemetry samples are deleted as well and
    /// are not counted, and run events older than the same cutoff are deleted as well and are not counted
    /// either — so a return of 0 does not mean nothing was destroyed.</returns>
    Task<int> PruneOlderThanAsync(DateTimeOffset cutoffUtc, CancellationToken ct);

    /// <summary>How much history exists and how much room it takes — the numbers an operator needs to decide
    /// whether to prune. Every figure is unfiltered by provenance and by machine: this is the state of the
    /// STORE, not a view of anyone's data.</summary>
    /// <param name="ct">Cancels the read.</param>
    Task<HistorianStats> GetStatsAsync(CancellationToken ct);
}
