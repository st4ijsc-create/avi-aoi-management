using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Http.HttpResults;
using St4i.EdgeCore.Historian;
using St4i.EngineApi.Endpoints;
using St4i.EngineApi.Tests.Auth;
using Xunit;

namespace St4i.EngineApi.Tests;

/// <summary>
/// AU-1 (2026-08-22), item 17 of <c>tools/machine-simulator/docs/owner-decisions.md</c> — the telemetry read
/// surface's provenance gate. Same "hand-construct the exact store, call the internal handler directly"
/// convention as <see cref="HistorianEndpointsProvenanceTests"/>, which covers the results/OEE/CSV surfaces;
/// this file adds NEW tests only and touches none of them.
///
/// <para><b>What each test in here is FOR — the breakdown below was MEASURED by running both controls, after
/// the tests were written, and it corrected one label the author had guessed wrong.</b> A test that is green
/// on both sides of a diff measures nothing about that diff, and this project has paid for that confusion more
/// than once. Listed, not counted:</para>
/// <para>RED when the gate is deleted from <c>SqliteHistorianStore.QueryTelemetryAsync</c> (control A) —
/// <see cref="GateOptIn_OnAMachineWithBothKinds_KeepsTheRealSamplesAndDropsTheFabricatedOnes"/>,
/// <see cref="GateOptIn_OnAPurelyFabricatedMachine_ReturnsNothing_WhileTheUngatedReadReturnsEverySample"/>,
/// <see cref="GateOptIn_UnknownProvenanceSamples_AreExcludedOnceSomethingExplicitlyRealSharesTheWindow"/>,
/// <see cref="StoreLevelDefault_IsTheGatedOne_SoTheOptOutLivesOnlyAtTheEndpoint"/>. These are the witnesses.</para>
/// <para>RED when the endpoint default is flipped to the sibling rule (control B) —
/// <see cref="Default_WithNoExplicitValue_StillReturnsEverySampleIncludingFabricated_LegacyContinuity"/>, and
/// it was the ONLY red in the whole suite under that control: before this file existed, flipping that default
/// would have gone unnoticed by every one of the 2 804 tests.</para>
/// <para>RED under NEITHER control, and labelled as guards on the tests themselves rather than left to look
/// like evidence — <see cref="TheJoinThisReadWasSaidToBeUnableToMake_IsTotal_NoStoredSampleIsAnOrphan"/>
/// (a structural measurement, deliberately independent of the gate) and
/// <see cref="GateOptIn_UnknownProvenanceSamples_PassWhenNothingExplicitlyRealSharesTheWindow"/> (written as a
/// witness, measured as a guard, relabelled).</para>
///
/// <para><b>The claim these tests exist to settle.</b> Three published places said the provenance asymmetry on
/// <c>QueryTelemetryAsync</c> was STRUCTURAL and could not be closed by a flag — item 17's own title, the
/// verdict-table row for item 17, and the doc comments on <see cref="IHistorianStore.QueryTelemetryAsync"/>
/// and <c>SqliteHistorianStore.QueryTelemetryAsync</c>. That is false, and
/// <see cref="TheJoinThisReadWasSaidToBeUnableToMake_IsTotal_NoStoredSampleIsAnOrphan"/> is the measurement
/// that refutes it: the link the claim names as the reason it is impossible is the very thing that makes it
/// possible, and it is NOT NULL, so it is total.</para>
/// </summary>
// 🔴 Task L-1 — joins this collection for the PROCESS-WIDE SQLITE CONNECTION POOL, not for env vars.
//    SqliteConnection.ClearAllPools() is process-global; membership rule and the full list are in
//    tests/St4i.EngineApi.Tests/Auth/SecurityEnvVarTests.cs.
[Collection(SecurityEnvVarTests.CollectionName)]
public sealed class HistorianTelemetryProvenanceTests
{
    private const string Metric = "Torque";

    private static SqliteHistorianStore NewStore() =>
        new(Directory.CreateTempSubdirectory("st4i-historian-telemetry-provenance-").FullName);

    private static HistorianResultRecord MakeReading(
        string machineCode, string serialNumber, DateTimeOffset eventTimeUtc, bool isFabricated, double sampleValue) =>
        new(
            MachineCode: machineCode, DeviceClass: "Automation", MachineType: "MODBUS_TCP", ReadingKind: "ProcessResult",
            CycleCounter: 1, SerialNumber: serialNumber, Verdict: "Pass",
            RecipeCode: null, RecipeVersion: null,
            KeyMetricName: null, KeyMetricValue: null, KeyMetricUnit: null,
            NgCount: 0, PointCount: 1,
            AckSuccess: true, AckDuplicate: false, AckQueued: false,
            GenealogyJson: null, MeasurementsJson: null,
            EventTimeUtc: eventTimeUtc, IngestedAtUtc: eventTimeUtc,
            TelemetrySamples: new[] { new TelemetrySampleRecord(Metric, sampleValue, "Nm", "Good") },
            IsFabricated: isFabricated);

    private static T ExpectOk<T>(IResult result)
    {
        var ok = Assert.IsType<Ok<T>>(result);
        Assert.Equal(StatusCodes.Status200OK, ok.StatusCode);
        Assert.NotNull(ok.Value);
        return ok.Value!;
    }

    private static Task<IResult> QueryAsync(
        SqliteHistorianStore store, string machine, DateTimeOffset now, bool? includeFabricated) =>
        HistorianEndpoints.GetTelemetryAsync(
            machine: machine, metric: Metric,
            from: now.AddHours(-1).ToString("O"), to: now.AddHours(1).ToString("O"),
            store, CancellationToken.None, includeFabricated: includeFabricated);

    /// <summary>A reading AND one telemetry sample of it, written the way the table looked before the SM-2
    /// migration added <c>is_fabricated</c> — the column is simply left out of the INSERT, so SQLite's own
    /// ADD-COLUMN-without-DEFAULT semantics leave it NULL. Same convention as
    /// <c>HistorianEndpointsProvenanceTests.InsertLegacyShapeRow</c>, extended to carry a sample, because the
    /// question item 17 asks is about the SAMPLE table and a parentless sample cannot exist.</summary>
    private static void InsertLegacyReadingWithSample(
        string dbPath, string machineCode, string serialNumber, DateTimeOffset eventTime, double sampleValue)
    {
        using var connection = new Microsoft.Data.Sqlite.SqliteConnection($"Data Source={dbPath}");
        connection.Open();

        var eventTimeIso = eventTime.ToUniversalTime().ToString("O");

        using (var cmd = connection.CreateCommand())
        {
            cmd.CommandText = """
                INSERT INTO historian_results
                    (machine_code, device_class, machine_type, reading_kind, cycle_counter, serial_number, verdict,
                     recipe_code, recipe_version, key_metric_name, key_metric_value, key_metric_unit,
                     ng_count, point_count, ack_success, ack_duplicate, ack_queued,
                     genealogy_json, measurements_json, event_time_utc, ingested_at_utc)
                VALUES
                    (@machine_code, 'Automation', 'MODBUS_TCP', 'ProcessResult', 1, @serial_number, 'Pass',
                     NULL, NULL, NULL, NULL, NULL,
                     0, 0, 1, 0, 0,
                     NULL, NULL, @event_time_utc, @event_time_utc);
                """;
            cmd.Parameters.AddWithValue("@machine_code", machineCode);
            cmd.Parameters.AddWithValue("@serial_number", serialNumber);
            cmd.Parameters.AddWithValue("@event_time_utc", eventTimeIso);
            cmd.ExecuteNonQuery();
        }

        using (var cmd = connection.CreateCommand())
        {
            cmd.CommandText = """
                INSERT INTO historian_telemetry (result_id, machine_code, metric, value, unit, quality, event_time_utc)
                VALUES (last_insert_rowid(), @machine_code, @metric, @value, 'Nm', 'Good', @event_time_utc);
                """;
            cmd.Parameters.AddWithValue("@machine_code", machineCode);
            cmd.Parameters.AddWithValue("@metric", Metric);
            cmd.Parameters.AddWithValue("@value", sampleValue);
            cmd.Parameters.AddWithValue("@event_time_utc", eventTimeIso);
            cmd.ExecuteNonQuery();
        }
    }

    // ─────────────────────────────────────────────────────────────────────
    // The structural claim, refuted by measurement
    // ─────────────────────────────────────────────────────────────────────

    /// <summary>🔴 WITNESS. The refutation of "the asymmetry cannot be closed by passing a flag here." The
    /// reason given was that a sample carries no provenance of its own, "only a link to the result that
    /// produced it." This measures that link: it is declared NOT NULL, and no stored sample — including one
    /// written in the pre-migration shape — fails to resolve through it. A total join is not a heuristic, so
    /// nothing about a sample's provenance has to be invented, defaulted or guessed.</summary>
    [Fact]
    public async Task TheJoinThisReadWasSaidToBeUnableToMake_IsTotal_NoStoredSampleIsAnOrphan()
    {
        var store = NewStore();
        var now = DateTimeOffset.UtcNow;
        await store.AppendResultsAsync(new[]
        {
            MakeReading("TEL-JOIN-01", "SN-F", now.AddMinutes(-3), isFabricated: true, sampleValue: 1),
            MakeReading("TEL-JOIN-01", "SN-R", now.AddMinutes(-2), isFabricated: false, sampleValue: 2),
        }, CancellationToken.None);
        InsertLegacyReadingWithSample(store.DbPath, "TEL-JOIN-01", "SN-OLD", now.AddMinutes(-1), sampleValue: 3);

        using var connection = new Microsoft.Data.Sqlite.SqliteConnection($"Data Source={store.DbPath}");
        connection.Open();

        // The column the "cannot be closed" claim named as the reason it could not be closed.
        bool resultIdIsNotNull;
        using (var cmd = connection.CreateCommand())
        {
            cmd.CommandText = "SELECT \"notnull\" FROM pragma_table_info('historian_telemetry') WHERE name = 'result_id';";
            resultIdIsNotNull = Convert.ToInt64(cmd.ExecuteScalar(), System.Globalization.CultureInfo.InvariantCulture) != 0;
        }

        long sampleCount;
        using (var cmd = connection.CreateCommand())
        {
            cmd.CommandText = "SELECT COUNT(*) FROM historian_telemetry;";
            sampleCount = Convert.ToInt64(cmd.ExecuteScalar(), System.Globalization.CultureInfo.InvariantCulture);
        }

        long orphanCount;
        using (var cmd = connection.CreateCommand())
        {
            cmd.CommandText = """
                SELECT COUNT(*) FROM historian_telemetry t
                WHERE NOT EXISTS (SELECT 1 FROM historian_results r WHERE r.id = t.result_id);
                """;
            orphanCount = Convert.ToInt64(cmd.ExecuteScalar(), System.Globalization.CultureInfo.InvariantCulture);
        }

        Assert.True(resultIdIsNotNull, "historian_telemetry.result_id must be NOT NULL for the provenance join to be total.");
        Assert.Equal(3, sampleCount);
        Assert.Equal(0, orphanCount);
    }

    // ─────────────────────────────────────────────────────────────────────
    // The gate, once a caller asks for it
    // ─────────────────────────────────────────────────────────────────────

    /// <summary>🔴 WITNESS. Goes red if the gate is removed from <c>SqliteHistorianStore.QueryTelemetryAsync</c>
    /// or if the endpoint stops threading the caller's explicit value.</summary>
    [Fact]
    public async Task GateOptIn_OnAMachineWithBothKinds_KeepsTheRealSamplesAndDropsTheFabricatedOnes()
    {
        var store = NewStore();
        var now = DateTimeOffset.UtcNow;
        await store.AppendResultsAsync(new[]
        {
            MakeReading("TEL-MIX-01", "SN-F1", now.AddMinutes(-3), isFabricated: true, sampleValue: 11),
            MakeReading("TEL-MIX-01", "SN-R1", now.AddMinutes(-2), isFabricated: false, sampleValue: 22),
            MakeReading("TEL-MIX-01", "SN-R2", now.AddMinutes(-1), isFabricated: false, sampleValue: 33),
        }, CancellationToken.None);

        var gated = ExpectOk<TelemetryPointDto[]>(await QueryAsync(store, "TEL-MIX-01", now, includeFabricated: false));

        Assert.Equal(new[] { 22d, 33d }, gated.Select(p => p.Value).ToArray());
        Assert.DoesNotContain(gated, p => p.Value == 11d);
    }

    /// <summary>🔴 WITNESS, and it is THE MEASUREMENT behind item 17's STOP condition. A machine whose readings
    /// are all fabricated — an ordinary simulated machine, on a deployment where <c>DemoModeGate</c> is off,
    /// which is every product install — returns ZERO samples once the gate is engaged, not merely fewer. The
    /// same seed returns every sample when the gate is not engaged, and both halves are asserted here so the
    /// difference is the measurement rather than an inference from two separate tests.</summary>
    [Fact]
    public async Task GateOptIn_OnAPurelyFabricatedMachine_ReturnsNothing_WhileTheUngatedReadReturnsEverySample()
    {
        var store = NewStore();
        var now = DateTimeOffset.UtcNow;
        await store.AppendResultsAsync(new[]
        {
            MakeReading("TEL-DEMO-01", "SN-D1", now.AddMinutes(-3), isFabricated: true, sampleValue: 41),
            MakeReading("TEL-DEMO-01", "SN-D2", now.AddMinutes(-2), isFabricated: true, sampleValue: 42),
            MakeReading("TEL-DEMO-01", "SN-D3", now.AddMinutes(-1), isFabricated: true, sampleValue: 43),
        }, CancellationToken.None);

        var ungated = ExpectOk<TelemetryPointDto[]>(await QueryAsync(store, "TEL-DEMO-01", now, includeFabricated: true));
        var gated = ExpectOk<TelemetryPointDto[]>(await QueryAsync(store, "TEL-DEMO-01", now, includeFabricated: false));

        Assert.Equal(3, ungated.Length);
        Assert.Empty(gated);
    }

    // ─────────────────────────────────────────────────────────────────────
    // The third state: Unknown provenance, both directions
    // ─────────────────────────────────────────────────────────────────────

    /// <summary>🔴 <b>GUARD, NOT A WITNESS — and this label was CORRECTED after measuring, not guessed before.</b>
    /// It was written as a witness. Running the control (gate deleted from the store) left it GREEN, because
    /// "Unknown samples come back" is also what an ungated read does — so it does not discriminate the gate's
    /// presence and cannot be offered as evidence of it. What it does hold is the ADMISSION RULE for the third
    /// state: a sample whose parent predates the <c>is_fabricated</c> column is Unknown, neither fabricated nor
    /// real, and with nothing explicitly real sharing its window the gate must keep it rather than let a
    /// pre-migration series silently vanish. It goes red if that rule is ever narrowed to exclude Unknown
    /// unconditionally — which is a real and tempting simplification, and the reason this test stays.</summary>
    [Fact]
    public async Task GateOptIn_UnknownProvenanceSamples_PassWhenNothingExplicitlyRealSharesTheWindow()
    {
        var store = NewStore();
        var now = DateTimeOffset.UtcNow;
        InsertLegacyReadingWithSample(store.DbPath, "TEL-LEGACY-01", "SN-OLD-1", now.AddMinutes(-3), sampleValue: 51);
        InsertLegacyReadingWithSample(store.DbPath, "TEL-LEGACY-01", "SN-OLD-2", now.AddMinutes(-2), sampleValue: 52);

        var gated = ExpectOk<TelemetryPointDto[]>(await QueryAsync(store, "TEL-LEGACY-01", now, includeFabricated: false));

        Assert.Equal(new[] { 51d, 52d }, gated.Select(p => p.Value).ToArray());
    }

    /// <summary>🔴 WITNESS, and it pins the ACCEPTED COST rather than a success. The residual the gate's own doc
    /// comment records — once anything explicitly real is in scope, every Unknown row in that scope goes too,
    /// including a legitimately-real pre-migration one — reaches the telemetry surface unchanged, because the
    /// rule is shared. Asserting it here means a future change to that rule cannot quietly alter what this
    /// surface does with Unknown without a red test.</summary>
    [Fact]
    public async Task GateOptIn_UnknownProvenanceSamples_AreExcludedOnceSomethingExplicitlyRealSharesTheWindow()
    {
        var store = NewStore();
        var now = DateTimeOffset.UtcNow;
        InsertLegacyReadingWithSample(store.DbPath, "TEL-LEGACY-02", "SN-OLD-1", now.AddMinutes(-3), sampleValue: 61);
        await store.AppendResultsAsync(new[]
        {
            MakeReading("TEL-LEGACY-02", "SN-R1", now.AddMinutes(-2), isFabricated: false, sampleValue: 62),
        }, CancellationToken.None);

        var gated = ExpectOk<TelemetryPointDto[]>(await QueryAsync(store, "TEL-LEGACY-02", now, includeFabricated: false));

        var point = Assert.Single(gated);
        Assert.Equal(62d, point.Value);
    }

    // ─────────────────────────────────────────────────────────────────────
    // Guards — NOT witnesses. Read the label.
    // ─────────────────────────────────────────────────────────────────────

    /// <summary>🔴 <b>GUARD, NOT A WITNESS — this test is green on BOTH sides of the change that introduced it,
    /// and it measures nothing about that change.</b> It exists to fail if someone LATER wires this route to
    /// <c>ResolveIncludeFabricated</c> the way its siblings are wired. That flip is the half of item 17 the
    /// owner has not ruled on, and its cost is measured by
    /// <see cref="GateOptIn_OnAPurelyFabricatedMachine_ReturnsNothing_WhileTheUngatedReadReturnsEverySample"/>:
    /// a simulated machine's trend chart goes to empty on every non-demo install. If a future task flips the
    /// default on an owner's ruling, this test SHOULD go red and SHOULD be rewritten — a red here is a
    /// question, not a regression.</summary>
    [Fact]
    public async Task Default_WithNoExplicitValue_StillReturnsEverySampleIncludingFabricated_LegacyContinuity()
    {
        var store = NewStore();
        var now = DateTimeOffset.UtcNow;
        await store.AppendResultsAsync(new[]
        {
            MakeReading("TEL-DEFAULT-01", "SN-F1", now.AddMinutes(-3), isFabricated: true, sampleValue: 71),
            MakeReading("TEL-DEFAULT-01", "SN-R1", now.AddMinutes(-2), isFabricated: false, sampleValue: 72),
        }, CancellationToken.None);
        InsertLegacyReadingWithSample(store.DbPath, "TEL-DEFAULT-01", "SN-OLD-1", now.AddMinutes(-1), sampleValue: 73);

        var defaulted = ExpectOk<TelemetryPointDto[]>(await QueryAsync(store, "TEL-DEFAULT-01", now, includeFabricated: null));

        Assert.Equal(new[] { 71d, 72d, 73d }, defaulted.Select(p => p.Value).ToArray());
    }

    /// <summary>🔴 <b>GUARD, NOT A WITNESS.</b> The store method's own default is <see langword="false"/> — the
    /// safe one, matching the reads around it — so that a NEW caller of <see cref="IHistorianStore"/> gets the
    /// gate rather than silently bypassing it. The endpoint is the ONE place that opts out, deliberately and
    /// visibly. This fails if that polarity is ever quietly reversed at the store layer, which would move the
    /// opt-out somewhere no reviewer is looking.</summary>
    [Fact]
    public async Task StoreLevelDefault_IsTheGatedOne_SoTheOptOutLivesOnlyAtTheEndpoint()
    {
        var store = NewStore();
        var now = DateTimeOffset.UtcNow;
        await store.AppendResultsAsync(new[]
        {
            MakeReading("TEL-STORE-01", "SN-D1", now.AddMinutes(-1), isFabricated: true, sampleValue: 81),
        }, CancellationToken.None);

        var viaStoreDefault = await store.QueryTelemetryAsync(
            "TEL-STORE-01", Metric, now.AddHours(-1), now.AddHours(1), CancellationToken.None);

        Assert.Empty(viaStoreDefault);
    }
}
