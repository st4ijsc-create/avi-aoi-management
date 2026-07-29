namespace St4i.EdgeCore.Historian;

/// <summary>
/// WS-A-T1 — storage-agnostic contract for the durable historian. No implementation lives here (SQLite
/// comes in a later WS-A task); this is the shape every historian backend (and every caller — the edge
/// pipeline appending results, the HMI/API querying them) is written against.
/// </summary>
public interface IHistorianStore
{
    Task AppendResultsAsync(IReadOnlyList<HistorianResultRecord> records, CancellationToken ct);

    Task AppendRunEventAsync(HistorianRunEvent runEvent, CancellationToken ct);

    Task<HistorianResultsPage> QueryResultsAsync(HistorianResultQuery query, CancellationToken ct);

    Task<IReadOnlyList<HistorianResultRow>> QueryBySerialAsync(string serialNumber, CancellationToken ct);

    Task<IReadOnlyList<TelemetrySamplePoint>> QueryTelemetryAsync(string machineCode, string metric, DateTimeOffset from, DateTimeOffset to, CancellationToken ct);

    /// <param name="includeFabricated">SM-2 — same explicit opt-in escape hatch as
    /// <see cref="HistorianResultQuery.IncludeFabricated"/>: default <see langword="false"/> applies the
    /// real-presence gate documented on <see cref="SqliteHistorianStore.AggregateForOeeAsync"/>;
    /// <see langword="true"/> bypasses it and aggregates every row regardless of provenance.</param>
    Task<OeeInputAggregate> AggregateForOeeAsync(string machineCode, DateTimeOffset from, DateTimeOffset to, CancellationToken ct, bool includeFabricated = false);

    Task<IReadOnlyList<HistorianRunEvent>> QueryRunEventsAsync(DateTimeOffset from, DateTimeOffset to, CancellationToken ct);

    Task<int> PruneOlderThanAsync(DateTimeOffset cutoffUtc, CancellationToken ct);

    Task<HistorianStats> GetStatsAsync(CancellationToken ct);
}
