using System.Text.Json;
using St4i.Connector.Abstractions.Json;
using St4i.Connector.Abstractions.Models;
using Xunit;

namespace St4i.Connector.Abstractions.Tests;

/// <summary>
/// GP-2 (.superpowers/sdd/2026-07-28-wsg-plugin-connector-seam-blueprint/task-2-brief.md) — THE
/// deliverable of this task. Nothing in this repository has ever deserialized a <see cref="DeviceReading"/>
/// before this task (the outbound ingest path is one-way); once the sidecar isolation model exists, every
/// reading a third-party driver produces crosses a process boundary as JSON exactly like this. Without
/// <see cref="ConnectorObjectConverter"/> registered in <see cref="ConnectorJson.Options"/>, every
/// <c>object?</c>-typed value here (<see cref="TelemetrySample.Value"/>, every
/// <see cref="DeviceReading.Genealogy"/> value) deserializes into a <see cref="JsonElement"/> instead of
/// a CLR primitive — <see cref="JsonElement"/> is not <see cref="IConvertible"/>, so
/// <see cref="TelemetryNumeric.TryGet"/> silently returns <see langword="false"/> for it and the value
/// vanishes with no exception, no log. This test class proves that failure cannot happen: a fully
/// populated <see cref="DeviceReading"/> — every member non-default, every collection non-empty — must
/// survive <see cref="ConnectorJson.Options"/> serialize→deserialize losslessly, and the awkward members
/// nobody has ever exercised (a list of arrays inside a positional record, a mutable list that must stay
/// mutable, a non-UTC <see cref="DateTimeOffset"/>, enums, the two judgement calls) get their own explicit
/// coverage.
/// </summary>
public class ConnectorRoundTripTests
{
    // ─────────────────────────────────────────────────────────────────────
    // The deliverable: a fully populated DeviceReading, round-tripped, deeply asserted.
    // ─────────────────────────────────────────────────────────────────────
    [Fact]
    public void FullyPopulatedDeviceReading_RoundTrips_Losslessly()
    {
        var original = BuildFullyPopulatedReading();

        var json = JsonSerializer.Serialize(original, ConnectorJson.Options);
        var back = JsonSerializer.Deserialize<DeviceReading>(json, ConnectorJson.Options);

        Assert.NotNull(back);

        // ---- top-level scalars ----
        Assert.Equal(original.MachineCode, back!.MachineCode);
        Assert.Equal(original.Kind, back.Kind);
        Assert.Equal(original.SerialNumber, back.SerialNumber);
        Assert.Equal(original.StepType, back.StepType);
        Assert.Equal(original.Verdict, back.Verdict);
        Assert.Equal(original.RecipeCode, back.RecipeCode);
        Assert.Equal(original.RecipeVersion, back.RecipeVersion);
        Assert.Equal(original.CycleCounter, back.CycleCounter);

        // DateTimeOffset: exact instant AND the non-UTC offset itself (a naive converter/format could
        // normalize to UTC and silently lose which local offset the reading actually happened in).
        Assert.Equal(original.Timestamp, back.Timestamp);
        Assert.Equal(original.Timestamp.Offset, back.Timestamp.Offset);
        Assert.Equal(TimeSpan.FromHours(7), back.Timestamp.Offset);

        // ---- Metrics: MetricSample is a scalar-only record (no collection members), so a direct
        // list-vs-list Assert.Equal is genuine deep structural equality (xunit compares IEnumerable
        // sequences element-by-element via each element's own IEquatable<T>). Also stresses full
        // round-trip precision of a "gnarly" double (0.1 + 0.2 = 0.30000000000000004).
        Assert.Equal(original.Metrics, back.Metrics);

        // ---- Waveforms: WaveformSeries wraps IReadOnlyList<double[]> — a KNOWN xunit/record trap.
        // A record's compiler-generated Equals falls back to EqualityComparer<T>.Default for a
        // non-record member; for List<double[]> that is reference equality (List<T> does not override
        // Equals), so `Assert.Equal(original.Waveforms, back.Waveforms)` would FAIL even for a perfectly
        // correct round trip, for a reason that has nothing to do with the converter. Decomposed by hand.
        Assert.Equal(original.Waveforms.Count, back.Waveforms.Count);
        for (var i = 0; i < original.Waveforms.Count; i++)
        {
            AssertWaveformEqual(original.Waveforms[i], back.Waveforms[i]);
        }

        // ---- Measurements: MeasurementResult's own members (Bbox?, Values3d?) are scalar-only records,
        // so a direct list compare here IS genuine deep equality — covers a fully-populated Bbox+Values3d
        // instance and a second, partially-null instance (Bbox null, most of Values3d null) in one pass.
        Assert.Equal(original.Measurements, back.Measurements);

        // ---- Telemetry: one sample of each documented value type, both structurally AND by explicit
        // CLR type (the brief's exact ask: "asserting the CLR type on the way back out, not just the
        // value" — a JsonElement can equal-compare wrong in misleading ways, so the type check is the
        // one that actually catches the JsonElement failure mode).
        Assert.Equal(original.Telemetry, back.Telemetry);
        AssertTelemetryValue<double>(back, "temperature_whole", 20.0);
        AssertTelemetryValue<double>(back, "precise", 0.1 + 0.2);
        AssertTelemetryValue<bool>(back, "running", true);
        AssertTelemetryValue<string>(back, "status", "RUNNING");
        var nullSample = back.Telemetry.Single(t => t.Metric == "unavailable");
        Assert.Null(nullSample.Value);

        // ---- Genealogy: string | int | double, asserting CLR types back (decision (a) lives here).
        Assert.NotNull(back.Genealogy);
        Assert.Equal(original.Genealogy!.Count, back.Genealogy!.Count);
        var lotCode = Assert.IsType<string>(back.Genealogy["lotCode"]);
        Assert.Equal("LOT-2026-07-28", lotCode);
        var panelId = Assert.IsType<string>(back.Genealogy["panelId"]);
        Assert.Equal("PNL-9", panelId);
        var operatorId = Assert.IsType<string>(back.Genealogy["operatorId"]);
        Assert.Equal("OP-1", operatorId);
        // boardIndex was written as a CLR `int` — comes back as `long` (decision (a)'s documented,
        // deliberate coercion), NOT `double` (which would silently change 5 into 5.0 on the wire).
        var boardIndex = Assert.IsType<long>(back.Genealogy["boardIndex"]);
        Assert.Equal(5L, boardIndex);
        var cycleTimeSec = Assert.IsType<double>(back.Genealogy["cycleTimeSec"]);
        Assert.Equal(12.75, cycleTimeSec);

        // ---- Plan: CyclePlan wraps IReadOnlyList<CyclePlanStep> — same record-wrapping-a-list trap as
        // Waveforms, decomposed the same way. CyclePlanStep itself has no collection members, so the
        // Steps list CAN be compared directly once pulled out of the wrapping record.
        Assert.NotNull(back.Plan);
        Assert.Equal(original.Plan!.CycleCounter, back.Plan!.CycleCounter);
        Assert.Equal(original.Plan.StartedAt, back.Plan.StartedAt);
        Assert.Equal(original.Plan.StartedAt.Offset, back.Plan.StartedAt.Offset);
        Assert.Equal(original.Plan.DurationSeconds, back.Plan.DurationSeconds);
        Assert.Equal(original.Plan.Steps, back.Plan.Steps);

        // ---- Mutability: DeviceReading.Measurements/Waveforms/Metrics/Telemetry are declared as
        // concrete `List<T>` (not an interface), so System.Text.Json materializes them as `List<T>`
        // directly — but prove it, and prove an index-assignment mutation actually works, mirroring
        // ScenarioAwareDriver.Inject's real post-yield mutation-by-index pattern.
        Assert.IsType<List<MeasurementResult>>(back.Measurements);
        var mutated = back.Measurements[0] with { Result = "MUTATED" };
        back.Measurements[0] = mutated;
        Assert.Equal("MUTATED", back.Measurements[0].Result);
    }

    [Fact]
    public void Enums_SerializeAsCamelCaseStrings_NeverBareIntegers()
    {
        var reading = new DeviceReading { Kind = ReadingKind.Inspection, Verdict = Verdict.Warn };

        var json = JsonSerializer.Serialize(reading, ConnectorJson.Options);

        Assert.Contains("\"kind\":\"inspection\"", json);
        Assert.Contains("\"verdict\":\"warn\"", json);
        // A bare-int enum wire format would contain e.g. "kind":2 — assert that shape is entirely absent.
        Assert.DoesNotContain("\"kind\":2", json);
        Assert.DoesNotContain("\"verdict\":1", json);
    }

    // ─────────────────────────────────────────────────────────────────────
    // Empty/default and all-nullables-null — "a converter that only works on the rich case is not a
    // contract" (task-2-brief.md).
    // ─────────────────────────────────────────────────────────────────────
    [Fact]
    public void DefaultDeviceReading_RoundTrips()
    {
        var original = new DeviceReading();

        var json = JsonSerializer.Serialize(original, ConnectorJson.Options);
        var back = JsonSerializer.Deserialize<DeviceReading>(json, ConnectorJson.Options);

        Assert.NotNull(back);
        Assert.Equal(original.MachineCode, back!.MachineCode);
        Assert.Equal(original.Kind, back.Kind);
        Assert.Equal(original.SerialNumber, back.SerialNumber);
        Assert.Null(back.StepType);
        Assert.Equal(original.Verdict, back.Verdict);
        Assert.Null(back.RecipeCode);
        Assert.Null(back.RecipeVersion);
        Assert.Empty(back.Metrics);
        Assert.Empty(back.Waveforms);
        Assert.Empty(back.Measurements);
        Assert.Empty(back.Telemetry);
        Assert.Equal(0, back.CycleCounter);
        Assert.Equal(original.Timestamp, back.Timestamp);
        Assert.Null(back.Genealogy);
        Assert.Null(back.Plan);
    }

    [Fact]
    public void ReadingWithAllNullablesNull_RoundTrips()
    {
        var original = new DeviceReading
        {
            MachineCode = "M1",
            Kind = ReadingKind.Telemetry,
            SerialNumber = "SN-1",
            StepType = null,
            Verdict = Verdict.Skip,
            RecipeCode = null,
            RecipeVersion = null,
            CycleCounter = 7,
            Timestamp = DateTimeOffset.UtcNow,
            Metrics = new List<MetricSample> { new("m", 1.0, Unit: null, Lsl: null, Usl: null, Nominal: null) },
            Waveforms = new List<WaveformSeries> { new("w", Unit: null, RateHz: null, Samples: new List<double[]>()) },
            Measurements = new List<MeasurementResult> { new("P1", "OK") }, // every optional param left null
            Telemetry = new List<TelemetrySample> { new("t", null, Unit: null) },
            Genealogy = null,
            Plan = null,
        };

        var json = JsonSerializer.Serialize(original, ConnectorJson.Options);
        var back = JsonSerializer.Deserialize<DeviceReading>(json, ConnectorJson.Options);

        Assert.NotNull(back);
        Assert.Null(back!.StepType);
        Assert.Null(back.RecipeCode);
        Assert.Null(back.RecipeVersion);
        Assert.Null(back.Genealogy);
        Assert.Null(back.Plan);

        var metric = Assert.Single(back.Metrics);
        Assert.Null(metric.Unit);
        Assert.Null(metric.Lsl);
        Assert.Null(metric.Usl);
        Assert.Null(metric.Nominal);

        var waveform = Assert.Single(back.Waveforms);
        Assert.Null(waveform.Unit);
        Assert.Null(waveform.RateHz);
        Assert.Empty(waveform.Samples);

        var measurement = Assert.Single(back.Measurements);
        Assert.Null(measurement.MeasuredValue);
        Assert.Null(measurement.DefectCatalogCode);
        Assert.Null(measurement.DefectSeverity);
        Assert.Null(measurement.Unit);
        Assert.Null(measurement.Bbox);
        Assert.Null(measurement.Values3d);

        var telemetry = Assert.Single(back.Telemetry);
        Assert.Null(telemetry.Value);
        Assert.Null(telemetry.Unit);
    }

    // ─────────────────────────────────────────────────────────────────────
    // Decision (a) — integral numbers: explicit, closed-loop verification.
    // ─────────────────────────────────────────────────────────────────────
    [Fact]
    public void DecisionA_GenealogyIntValue_RoundTripsAsLong_AndFeedsTelemetryNumericCorrectly()
    {
        var original = new DeviceReading
        {
            Genealogy = new Dictionary<string, object> { ["boardIndex"] = 5 },
        };

        var json = JsonSerializer.Serialize(original, ConnectorJson.Options);
        var back = JsonSerializer.Deserialize<DeviceReading>(json, ConnectorJson.Options)!;

        var boardIndex = back.Genealogy!["boardIndex"];
        Assert.IsType<long>(boardIndex); // not double — 5 must not silently become 5.0 on the wire.
        Assert.Equal(5L, boardIndex);

        // Closes the loop the brief specifically asks for: feed the CONVERTER'S OWN long output through
        // TelemetryNumeric.TryGet (the one shared helper every numeric-telemetry aggregation site in this
        // product goes through) and confirm it still resolves correctly — not a hand-written `long`
        // literal, the actual value this converter produces.
        Assert.True(TelemetryNumeric.TryGet(boardIndex, out var asDouble));
        Assert.Equal(5.0, asDouble);
    }

    [Fact]
    public void DecisionA_WholeNumberTelemetryDouble_RoundTripsAsDouble_NotLong()
    {
        // The subtle half of decision (a): System.Text.Json's own shortest-round-trippable text for 20.0
        // is "20" (no decimal marker) — if the converter just delegated to WriteNumberValue(double), an
        // entirely ordinary whole-number telemetry reading would silently come back as `long`, not
        // `double`. The converter must force a marker on WRITE specifically to prevent this.
        var original = new DeviceReading
        {
            Telemetry = new List<TelemetrySample> { new("temp", 20.0) },
        };

        var json = JsonSerializer.Serialize(original, ConnectorJson.Options);
        Assert.Contains("\"value\":20.0", json); // the forced marker, visible on the wire.

        var back = JsonSerializer.Deserialize<DeviceReading>(json, ConnectorJson.Options)!;
        var value = back.Telemetry[0].Value;
        Assert.IsType<double>(value);
        Assert.Equal(20.0, value);
    }

    // ─────────────────────────────────────────────────────────────────────
    // Decision (b) — out-of-domain values: reject loudly, both directions.
    // ─────────────────────────────────────────────────────────────────────
    [Fact]
    public void DecisionB_SerializingDateTimeValue_ThrowsLoudly_NeverSilentlyStringifies()
    {
        var reading = new DeviceReading
        {
            Telemetry = new List<TelemetrySample> { new("bad", DateTime.UtcNow) },
        };

        var ex = Assert.Throws<JsonException>(() => JsonSerializer.Serialize(reading, ConnectorJson.Options));
        Assert.Contains("DateTime", ex.Message);
    }

    [Fact]
    public void DecisionB_SerializingArrayValue_ThrowsLoudly()
    {
        var reading = new DeviceReading
        {
            Genealogy = new Dictionary<string, object> { ["bad"] = new[] { 1, 2, 3 } },
        };

        Assert.Throws<JsonException>(() => JsonSerializer.Serialize(reading, ConnectorJson.Options));
    }

    [Fact]
    public void DecisionB_SerializingNestedObjectValue_ThrowsLoudly()
    {
        var reading = new DeviceReading
        {
            // A Bbox instance is a perfectly normal type elsewhere in this same model — but it is not in
            // Genealogy's documented domain (string|int|double), so it must still be rejected here.
            Genealogy = new Dictionary<string, object> { ["bad"] = new Bbox(1, 2, 3, 4) },
        };

        Assert.Throws<JsonException>(() => JsonSerializer.Serialize(reading, ConnectorJson.Options));
    }

    [Fact]
    public void DecisionB_SerializingNaN_ThrowsLoudly_NotSilentlyCoerced()
    {
        var reading = new DeviceReading
        {
            Telemetry = new List<TelemetrySample> { new("bad", double.NaN) },
        };

        Assert.Throws<JsonException>(() => JsonSerializer.Serialize(reading, ConnectorJson.Options));
    }

    [Fact]
    public void DecisionB_SerializingInfinity_ThrowsLoudly()
    {
        var reading = new DeviceReading
        {
            Telemetry = new List<TelemetrySample> { new("bad", double.PositiveInfinity) },
        };

        Assert.Throws<JsonException>(() => JsonSerializer.Serialize(reading, ConnectorJson.Options));
    }

    [Fact]
    public void DecisionB_DeserializingJsonArrayToken_ThrowsLoudly()
    {
        const string badJson = """
            {"machineCode":"M","kind":"telemetry","serialNumber":"S","verdict":"pass","metrics":[],
             "waveforms":[],"measurements":[],
             "telemetry":[{"metric":"x","value":[1,2],"unit":null,"quality":"good"}],
             "cycleCounter":0,"timestamp":"2026-07-28T00:00:00+00:00","genealogy":null,"plan":null}
            """;

        Assert.Throws<JsonException>(() => JsonSerializer.Deserialize<DeviceReading>(badJson, ConnectorJson.Options));
    }

    [Fact]
    public void DecisionB_DeserializingJsonObjectToken_ThrowsLoudly()
    {
        const string badJson = """
            {"machineCode":"M","kind":"telemetry","serialNumber":"S","verdict":"pass","metrics":[],
             "waveforms":[],"measurements":[],
             "telemetry":[{"metric":"x","value":{"nested":1},"unit":null,"quality":"good"}],
             "cycleCounter":0,"timestamp":"2026-07-28T00:00:00+00:00","genealogy":null,"plan":null}
            """;

        Assert.Throws<JsonException>(() => JsonSerializer.Deserialize<DeviceReading>(badJson, ConnectorJson.Options));
    }

    [Fact]
    public void DecisionB_DeserializingNumberTooLargeForFiniteDouble_ThrowsLoudly()
    {
        // Symmetric with the WRITE-side NaN/Infinity rejection: a number this large can only be
        // represented as a non-finite double, which this converter's own Write would never produce and
        // must not silently manufacture on Read either.
        var badJson = "{\"machineCode\":\"M\",\"kind\":\"telemetry\",\"serialNumber\":\"S\",\"verdict\":\"pass\"," +
                      "\"metrics\":[],\"waveforms\":[],\"measurements\":[]," +
                      "\"telemetry\":[{\"metric\":\"x\",\"value\":1e400,\"unit\":null,\"quality\":\"good\"}]," +
                      "\"cycleCounter\":0,\"timestamp\":\"2026-07-28T00:00:00+00:00\",\"genealogy\":null,\"plan\":null}";

        Assert.Throws<JsonException>(() => JsonSerializer.Deserialize<DeviceReading>(badJson, ConnectorJson.Options));
    }

    // ─────────────────────────────────────────────────────────────────────
    // Helpers
    // ─────────────────────────────────────────────────────────────────────
    private static void AssertWaveformEqual(WaveformSeries expected, WaveformSeries actual)
    {
        Assert.Equal(expected.Name, actual.Name);
        Assert.Equal(expected.Unit, actual.Unit);
        Assert.Equal(expected.RateHz, actual.RateHz);
        Assert.Equal(expected.Samples.Count, actual.Samples.Count);
        for (var i = 0; i < expected.Samples.Count; i++)
        {
            Assert.Equal(expected.Samples[i], actual.Samples[i]); // double[] compares by sequence in xunit.
        }
    }

    private static void AssertTelemetryValue<T>(DeviceReading reading, string metric, T expected)
    {
        var sample = reading.Telemetry.Single(t => t.Metric == metric);
        var actual = Assert.IsType<T>(sample.Value);
        Assert.Equal(expected, actual);
    }

    private static DeviceReading BuildFullyPopulatedReading() => new()
    {
        MachineCode = "AOI-07",
        Kind = ReadingKind.Inspection,
        SerialNumber = "SN-000123",
        StepType = "final_inspection",
        Verdict = Verdict.Warn,
        RecipeCode = "RCP-9",
        RecipeVersion = "v2.3",
        CycleCounter = 4242,
        Timestamp = new DateTimeOffset(2026, 7, 28, 14, 30, 0, 250, TimeSpan.FromHours(7)),
        Metrics = new List<MetricSample>
        {
            new("torque", 0.1 + 0.2, "Nm", 10.0, 15.0, 12.5),
        },
        Waveforms = new List<WaveformSeries>
        {
            new(
                "vibration",
                "g",
                1000.0,
                new List<double[]>
                {
                    new[] { 0.1, 0.2, 0.3 },
                    new[] { -1.5, 2.75 },
                    Array.Empty<double>(),
                }),
        },
        Measurements = new List<MeasurementResult>
        {
            new(
                PointCode: "P1",
                Result: "NG",
                MeasuredValue: 3.14159,
                DefectCatalogCode: "D-100",
                DefectSeverity: "Major",
                Unit: "mm",
                Bbox: new Bbox(10, 20, 30, 40),
                Values3d: new Values3d(1.1, 2.2, 3.3, 4.4, 5.5, 6.6, 7.7, 8.8, 9.9, 10.1, 11.11)),
            new(
                PointCode: "P2",
                Result: "OK",
                Bbox: null,
                Values3d: new Values3d(HeightUm: 5.0)),
        },
        Telemetry = new List<TelemetrySample>
        {
            new("temperature_whole", 20.0, "C", "good"),
            new("precise", 0.1 + 0.2, "V", "good"),
            new("running", true, null, "good"),
            new("status", "RUNNING", null, "good"),
            new("unavailable", null, null, "bad"),
        },
        Genealogy = new Dictionary<string, object>
        {
            ["lotCode"] = "LOT-2026-07-28",
            ["panelId"] = "PNL-9",
            ["operatorId"] = "OP-1",
            ["boardIndex"] = 5,
            ["cycleTimeSec"] = 12.75,
        },
        Plan = new CyclePlan(
            CycleCounter: 4242,
            StartedAt: new DateTimeOffset(2026, 7, 28, 14, 29, 0, TimeSpan.FromHours(7)),
            DurationSeconds: 8.5,
            Steps: new List<CyclePlanStep>
            {
                new(0, "PT-1", 0.1, 0.2, "OK", 1.23, "Nm"),
                new(1, "PT-2", 0.3, 0.4, null, null, null),
            }),
    };
}
