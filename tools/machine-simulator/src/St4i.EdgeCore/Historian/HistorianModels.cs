using System.Text.Json;

namespace St4i.EdgeCore.Historian;

/// <summary>
/// WS-A-T1 — the flat, storage-ready projection of one <see cref="St4i.Connector.Abstractions.Models.DeviceReading"/> +
/// its <see cref="St4i.EdgeCore.Models.TransportAck"/>. Every scalar is carried over untouched (raw
/// <c>CycleCounter</c>, no offset-adjustment — that belongs to a caller like <c>MachineState</c>, not the
/// historian); the metric/telemetry/measurement collections are reduced the SAME way the rest of the app
/// already reduces them, never a second, independently-invented rule.
/// </summary>
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

public sealed record HistorianResultRow(long Id, HistorianResultRecord Record);

public sealed record TelemetrySampleRecord(string Metric, double Value, string? Unit, string Quality);

public sealed record HistorianRunEvent(string EventType, DateTimeOffset AtUtc, string? Note = null);

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

public sealed record HistorianResultsPage(IReadOnlyList<HistorianResultRow> Items, int Total, int Limit, int Offset);

public sealed record TelemetrySamplePoint(DateTimeOffset At, double Value);

public sealed record OeeInputAggregate(string MachineCode, DateTimeOffset From, DateTimeOffset To, long TotalCount, long GoodCount, TimeSpan RunTime);

public sealed record HistorianStats(long ResultRowCount, long TelemetryRowCount, DateTimeOffset? OldestEventTimeUtc, DateTimeOffset? NewestEventTimeUtc, long DbSizeBytes);
