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
        // Non-ASCII (Vietnamese diacritics) + quote/backslash/newline in one string, round-tripped
        // through System.Text.Json's default (escaping) encoder and back to the exact original text.
        AssertTelemetryValue<string>(
            back,
            "operator_note_vi",
            "Ca đêm — Nguyễn Thị Xuân nói: \"máy chạy êm\"\nKhông có lỗi.\\OK\\");

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
        var operatorNameVi = Assert.IsType<string>(back.Genealogy["operatorNameVi"]);
        Assert.Equal("Nguyễn Văn Á", operatorNameVi);

        // ---- Plan: CyclePlan wraps IReadOnlyList<CyclePlanStep> — same record-wrapping-a-list trap as
        // Waveforms, decomposed the same way. CyclePlanStep itself has no collection members, so the
        // Steps list CAN be compared directly once pulled out of the wrapping record.
        Assert.NotNull(back.Plan);
        Assert.Equal(original.Plan!.CycleCounter, back.Plan!.CycleCounter);
        Assert.Equal(original.Plan.StartedAt, back.Plan.StartedAt);
        Assert.Equal(original.Plan.StartedAt.Offset, back.Plan.StartedAt.Offset);
        Assert.Equal(original.Plan.DurationSeconds, back.Plan.DurationSeconds);
        Assert.Equal(original.Plan.Steps, back.Plan.Steps);

        // ---- Mutability: DeviceReading.Measurements/Waveforms/Metrics/Telemetry are ALL declared as
        // concrete `List<T>` (not an interface), so System.Text.Json materializes them as `List<T>`
        // directly — but prove it for every one of them (review round 1: the brief said "the mutable
        // collections", plural — the original test only covered Measurements), and prove an
        // index-assignment mutation actually works on each, mirroring ScenarioAwareDriver.Inject's real
        // post-yield mutation-by-index pattern.
        Assert.IsType<List<MeasurementResult>>(back.Measurements);
        back.Measurements[0] = back.Measurements[0] with { Result = "MUTATED" };
        Assert.Equal("MUTATED", back.Measurements[0].Result);

        Assert.IsType<List<MetricSample>>(back.Metrics);
        back.Metrics[0] = back.Metrics[0] with { Name = "MUTATED_METRIC" };
        Assert.Equal("MUTATED_METRIC", back.Metrics[0].Name);

        Assert.IsType<List<WaveformSeries>>(back.Waveforms);
        back.Waveforms[0] = back.Waveforms[0] with { Name = "MUTATED_WAVEFORM" };
        Assert.Equal("MUTATED_WAVEFORM", back.Waveforms[0].Name);

        Assert.IsType<List<TelemetrySample>>(back.Telemetry);
        back.Telemetry[0] = back.Telemetry[0] with { Metric = "MUTATED_TELEMETRY" };
        Assert.Equal("MUTATED_TELEMETRY", back.Telemetry[0].Metric);
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
    // Options hardening (review round 1).
    // ─────────────────────────────────────────────────────────────────────
    [Fact]
    public void Options_IsReadOnly_MutationAttemptThrows()
    {
        // Without MakeReadOnly(), ConnectorJson.Options -- despite being documented as THE one instance
        // defining the connector wire format -- would stay a plain mutable object until the first
        // Serialize/Deserialize call auto-froze it, letting any consumer holding the reference silently
        // redefine the wire format process-wide first. Prove it is locked, and that mutating it fails
        // loudly rather than silently succeeding or silently being ignored.
        Assert.True(ConnectorJson.Options.IsReadOnly);
        Assert.Throws<InvalidOperationException>(() =>
            ConnectorJson.Options.Converters.Add(new ConnectorObjectConverter()));
    }

    [Fact]
    public void PropertyNameCaseInsensitive_PascalCasePayload_StillBinds()
    {
        // PropertyNameCaseInsensitive is the one option a third-party sidecar author (writing in a
        // stack/framework whose default JSON emitter doesn't happen to favour camelCase) is most likely
        // to lean on -- prove it actually binds, not just that the flag is set. Enum VALUES are left in
        // our own camelCase convention here deliberately, to isolate this test to property-name binding
        // rather than also exercising enum-value case matching (a separate, unrelated concern).
        const string pascalJson = """
            {"MachineCode":"M1","Kind":"telemetry","SerialNumber":"SN1","Verdict":"skip",
             "CycleCounter":3,"Timestamp":"2026-07-28T00:00:00+00:00",
             "Telemetry":[{"Metric":"temp","Value":21.5,"Unit":"C","Quality":"good"}]}
            """;

        var back = JsonSerializer.Deserialize<DeviceReading>(pascalJson, ConnectorJson.Options);

        Assert.NotNull(back);
        Assert.Equal("M1", back!.MachineCode);
        Assert.Equal(ReadingKind.Telemetry, back.Kind);
        Assert.Equal("SN1", back.SerialNumber);
        Assert.Equal(Verdict.Skip, back.Verdict);
        Assert.Equal(3, back.CycleCounter);
        var sample = Assert.Single(back.Telemetry);
        Assert.Equal("temp", sample.Metric);
        Assert.Equal(21.5, Assert.IsType<double>(sample.Value));
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

    [Fact]
    public void DecisionA_FloatAndOtherIntegralPrimitives_WidenLosslessly()
    {
        // Review round 1: the FIRST version of this converter accepted exactly int|long|double and
        // threw for anything else -- including a `float`, even though TelemetryNumeric.TryGet,
        // Normalizer.CoerceToNumber, and LiveTransport.GetDouble ALL already accept
        // float/short/byte/sbyte/ushort/uint/ulong in-process today. Rejecting them only at the sidecar
        // boundary would be exactly the surprise decision (b) exists to prevent. All of these widen
        // losslessly (no driver in this repo produces most of them today, but the widening is provably
        // exact, unlike decimal -- see DecisionB_SerializingDecimalValue_ThrowsLoudly below).
        var reading = new DeviceReading
        {
            Telemetry = new List<TelemetrySample>
            {
                new("f", 12.5f),
                new("sh", (short)7),
                new("by", (byte)9),
                new("sb", (sbyte)-3),
                new("us", (ushort)40000),
                new("ui", 4000000000u),
                new("ul", 12345UL),
            },
        };

        var json = JsonSerializer.Serialize(reading, ConnectorJson.Options);
        var back = JsonSerializer.Deserialize<DeviceReading>(json, ConnectorJson.Options)!;

        AssertTelemetryValue<double>(back, "f", 12.5); // float widens to double, not long.
        AssertTelemetryValue<long>(back, "sh", 7L);
        AssertTelemetryValue<long>(back, "by", 9L);
        AssertTelemetryValue<long>(back, "sb", -3L);
        AssertTelemetryValue<long>(back, "us", 40000L);
        AssertTelemetryValue<long>(back, "ui", 4000000000L);
        AssertTelemetryValue<long>(back, "ul", 12345L);
    }

    [Fact]
    public void DecisionA_UlongExceedingLongMaxValue_ThrowsLoudly_RatherThanLosePrecision()
    {
        // The one integral CLR primitive that does NOT always widen losslessly to `long`: a ulong above
        // long.MaxValue. Widening it to `double` (this converter's only floating-point wire
        // representation) instead would silently lose precision (double cannot exactly represent every
        // 64-bit integer) -- the same "reject rather than silently lose precision" call as `decimal`.
        var reading = new DeviceReading
        {
            Telemetry = new List<TelemetrySample> { new("huge", ulong.MaxValue) },
        };

        var ex = Assert.Throws<JsonException>(() => JsonSerializer.Serialize(reading, ConnectorJson.Options));
        Assert.Contains("long.MaxValue", ex.Message);
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
    public void DecisionB_SerializingDecimalValue_ThrowsLoudly_ExplicitlyNamed()
    {
        // decimal is the one CLR numeric primitive still rejected even after review round 1 widened the
        // rest of the numeric domain — widening it to double (this converter's only floating-point wire
        // representation) would silently lose precision (decimal ~28-29 significant digits vs. double's
        // ~15-17), so it gets its own named rejection rather than falling into the generic default arm.
        var reading = new DeviceReading
        {
            Telemetry = new List<TelemetrySample> { new("dec", 12.5m) },
        };

        var ex = Assert.Throws<JsonException>(() => JsonSerializer.Serialize(reading, ConnectorJson.Options));
        Assert.Contains("decimal", ex.Message);
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
        // Positive control first (review round 1): prove this EXACT JSON shape deserializes fine with an
        // ordinary scalar `value`, so the throw below is demonstrably caused by the array — not a stray
        // field name or other unrelated mistake in the hand-written JSON.
        AssertControlValueDeserializes("42");

        var badJson = TelemetryReadingJsonWithRawValue("[1,2]");
        Assert.Throws<JsonException>(() => JsonSerializer.Deserialize<DeviceReading>(badJson, ConnectorJson.Options));
    }

    [Fact]
    public void DecisionB_DeserializingJsonObjectToken_ThrowsLoudly()
    {
        AssertControlValueDeserializes("42"); // positive control — see DeserializingJsonArrayToken above.

        var badJson = TelemetryReadingJsonWithRawValue("{\"nested\":1}");
        Assert.Throws<JsonException>(() => JsonSerializer.Deserialize<DeviceReading>(badJson, ConnectorJson.Options));
    }

    [Fact]
    public void DecisionB_DeserializingNumberTooLargeForFiniteDouble_ThrowsLoudly()
    {
        // Symmetric with the WRITE-side NaN/Infinity rejection: a number this large can only be
        // represented as a non-finite double, which this converter's own Write would never produce and
        // must not silently manufacture on Read either.
        AssertControlValueDeserializes("42"); // positive control — see DeserializingJsonArrayToken above.

        var badJson = TelemetryReadingJsonWithRawValue("1e400");
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

    /// <summary>A minimal, valid <see cref="DeviceReading"/> JSON document with one telemetry sample
    /// whose <c>value</c> is the given RAW (already-JSON) text — used by the three
    /// <c>DecisionB_Deserializing*</c> tests so they all exercise the exact same document shape and
    /// differ only in the one token under test.</summary>
    private static string TelemetryReadingJsonWithRawValue(string rawValueJson) =>
        "{\"machineCode\":\"M\",\"kind\":\"telemetry\",\"serialNumber\":\"S\",\"verdict\":\"pass\"," +
        "\"metrics\":[],\"waveforms\":[],\"measurements\":[]," +
        "\"telemetry\":[{\"metric\":\"x\",\"value\":" + rawValueJson + ",\"unit\":null,\"quality\":\"good\"}]," +
        "\"cycleCounter\":0,\"timestamp\":\"2026-07-28T00:00:00+00:00\",\"genealogy\":null,\"plan\":null}";

    /// <summary>Positive control for the three <c>DecisionB_Deserializing*</c> tests: deserializes
    /// <see cref="TelemetryReadingJsonWithRawValue"/> with an ordinary scalar <c>42</c> value and asserts
    /// it succeeds, proving the document shape itself is valid before the caller swaps in an
    /// out-of-domain token and asserts THAT throws.</summary>
    private static void AssertControlValueDeserializes(string rawValueJson)
    {
        var controlJson = TelemetryReadingJsonWithRawValue(rawValueJson);
        var control = JsonSerializer.Deserialize<DeviceReading>(controlJson, ConnectorJson.Options);
        Assert.Equal(42L, Assert.IsType<long>(Assert.Single(control!.Telemetry).Value));
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
            // Review round 1: no test string before this exercised non-ASCII. This product's UI/docs are
            // bilingual Vietnamese and System.Text.Json's default encoder escapes non-ASCII by default
            // (\uXXXX sequences on the wire) -- prove the escaped form still decodes back to the exact
            // original string, plus a quote/backslash/newline in the same value for good measure.
            new("operator_note_vi", "Ca đêm — Nguyễn Thị Xuân nói: \"máy chạy êm\"\nKhông có lỗi.\\OK\\", null, "good"),
        },
        Genealogy = new Dictionary<string, object>
        {
            ["lotCode"] = "LOT-2026-07-28",
            ["panelId"] = "PNL-9",
            ["operatorId"] = "OP-1",
            ["boardIndex"] = 5,
            ["cycleTimeSec"] = 12.75,
            ["operatorNameVi"] = "Nguyễn Văn Á",
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
