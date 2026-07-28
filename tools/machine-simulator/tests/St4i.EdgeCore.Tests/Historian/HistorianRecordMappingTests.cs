using St4i.EdgeCore.Historian;
using St4i.EdgeCore.Models;
using St4i.Connector.Abstractions.Models;
using Xunit;

namespace St4i.EdgeCore.Tests.Historian;

/// <summary>
/// WS-A-T1 — proves <see cref="HistorianResultRecord.From"/> maps a <see cref="DeviceReading"/> +
/// <see cref="TransportAck"/> (plus the owning <see cref="MachineDescriptor"/>) into a flat, storage-ready
/// record: every scalar field carried over untouched, the key metric/telemetry/measurement collections
/// reduced the SAME way the rest of the app already reduces them (no second, independently-invented rule).
/// </summary>
public class HistorianRecordMappingTests
{
    [Fact]
    public void From_maps_a_process_result_reading_and_ack_into_every_scalar_field()
    {
        var descriptor = new MachineDescriptor(
            "SCRW-01", "SN-SCRW-01", DeviceClass.Automation, "SCREWDRIVE", "screw_tightening",
            DriverKinds.Simulated, "RC1", null, 1.0);

        var timestamp = new DateTimeOffset(2026, 7, 26, 10, 30, 0, TimeSpan.Zero);
        var reading = new DeviceReading
        {
            MachineCode = "SCRW-01",
            Kind = ReadingKind.ProcessResult,
            SerialNumber = "SN-0001",
            Verdict = Verdict.Pass,
            RecipeCode = "RC1",
            RecipeVersion = "v2",
            Metrics = new List<MetricSample> { new("torque", 12.1, "Nm", 10.5, 13.5, 12.0) },
            CycleCounter = 42,
            Timestamp = timestamp,
            Genealogy = new Dictionary<string, object> { ["lot"] = "L100", ["operator"] = "jdoe" },
        };
        var ack = new TransportAck(Success: true, Duplicate: false, Queued: true, HttpStatus: 200, LatencyMs: 15);
        var ingestedAt = new DateTimeOffset(2026, 7, 26, 10, 30, 1, TimeSpan.Zero);

        var record = HistorianResultRecord.From(descriptor, reading, ack, ingestedAt);

        Assert.Equal("SCRW-01", record.MachineCode);
        Assert.Equal("Automation", record.DeviceClass);
        Assert.Equal("SCREWDRIVE", record.MachineType);
        Assert.Equal("ProcessResult", record.ReadingKind);
        Assert.Equal(42L, record.CycleCounter);
        Assert.Equal("SN-0001", record.SerialNumber);
        Assert.Equal("Pass", record.Verdict);
        Assert.Equal("RC1", record.RecipeCode);
        Assert.Equal("v2", record.RecipeVersion);
        Assert.Equal("torque", record.KeyMetricName);
        Assert.Equal(12.1, record.KeyMetricValue);
        Assert.Equal("Nm", record.KeyMetricUnit);
        Assert.Equal(0, record.NgCount);
        Assert.Equal(0, record.PointCount);
        Assert.True(record.AckSuccess);
        Assert.False(record.AckDuplicate);
        Assert.True(record.AckQueued);
        Assert.NotNull(record.GenealogyJson);
        Assert.Contains("L100", record.GenealogyJson);
        Assert.Null(record.MeasurementsJson);
        Assert.Equal(timestamp.ToUniversalTime(), record.EventTimeUtc);
        Assert.Equal(ingestedAt, record.IngestedAtUtc);
        Assert.Empty(record.TelemetrySamples);
    }

    [Fact]
    public void From_keeps_only_numeric_telemetry_samples_matching_the_MachineState_filter()
    {
        var descriptor = new MachineDescriptor(
            "IOT-01", "SN-IOT-01", DeviceClass.Iot, "IOT_SENSOR", null,
            DriverKinds.Simulated, null, null, 1.0);

        var reading = new DeviceReading
        {
            MachineCode = "IOT-01",
            Kind = ReadingKind.Telemetry,
            SerialNumber = "",
            Verdict = Verdict.Skip,
            Telemetry = new List<TelemetrySample>
            {
                new("temperature", 42.5, "C", "good"),
                // Not IConvertible (null fails the `is IConvertible` pattern match) -> must be excluded,
                // mirroring MachineState.cs:153's `if (sample.Value is not IConvertible convertible) continue;`.
                new("status_blob", null, null, "good"),
            },
            CycleCounter = 7,
            Timestamp = DateTimeOffset.UtcNow,
        };
        var ack = new TransportAck(Success: true);

        var record = HistorianResultRecord.From(descriptor, reading, ack, DateTimeOffset.UtcNow);

        var sample = Assert.Single(record.TelemetrySamples);
        Assert.Equal("temperature", sample.Metric);
        Assert.Equal(42.5, sample.Value);
        Assert.Equal("C", sample.Unit);
        Assert.Equal("good", sample.Quality);
    }

    /// <summary>GĐ3 sub-3 OU-2 PART A — the REQUIRED gate OU-1's review flagged: a non-numeric string
    /// telemetry value (e.g. an OPC-UA "status" node → "RUNNING") must be silently skipped here too, NOT
    /// throw a <see cref="FormatException"/> (the old `is IConvertible convertible` pattern match would
    /// have matched a string and then `convertible.ToDouble(null)` would have thrown). A numeric STRING
    /// ("42.5") must still parse, same as a genuine numeric type.</summary>
    [Fact]
    public void From_SkipsNonNumericStringTelemetry_ButParsesNumericStringTelemetry_NeverThrows()
    {
        var descriptor = new MachineDescriptor(
            "OPCUA-01", "SN-OPCUA-01", DeviceClass.Automation, "OPC_UA", null,
            DriverKinds.OpcUa, null, null, 1.0);

        var reading = new DeviceReading
        {
            MachineCode = "OPCUA-01",
            Kind = ReadingKind.Telemetry,
            SerialNumber = "",
            Verdict = Verdict.Skip,
            Telemetry = new List<TelemetrySample>
            {
                new("temp", 23.5, "C", "good"),
                new("status", "RUNNING", null, "good"),
                new("setpoint", "42.5", "C", "good"),
            },
            CycleCounter = 1,
            Timestamp = DateTimeOffset.UtcNow,
        };
        var ack = new TransportAck(Success: true);

        var ex = Record.Exception(() => HistorianResultRecord.From(descriptor, reading, ack, DateTimeOffset.UtcNow));
        Assert.Null(ex);

        var record = HistorianResultRecord.From(descriptor, reading, ack, DateTimeOffset.UtcNow);
        Assert.Equal(2, record.TelemetrySamples.Count);
        Assert.Contains(record.TelemetrySamples, s => s.Metric == "temp" && s.Value == 23.5);
        Assert.Contains(record.TelemetrySamples, s => s.Metric == "setpoint" && s.Value == 42.5);
        Assert.DoesNotContain(record.TelemetrySamples, s => s.Metric == "status");
    }

    [Fact]
    public void From_counts_NG_measurements_and_serializes_them_for_an_inspection_reading()
    {
        var descriptor = new MachineDescriptor(
            "AOI-01", "SN-AOI-01", DeviceClass.AoiAvi, "AOI", "inspection",
            DriverKinds.Simulated, "RC1", null, 1.0);

        var measurements = new List<MeasurementResult>
        {
            new("PT-01", "OK", 1.0),
            new("PT-02", "NG", 2.0),
            new("PT-03", "OK", 3.0),
            new("PT-04", "NG", 4.0),
        };
        var reading = new DeviceReading
        {
            MachineCode = "AOI-01",
            Kind = ReadingKind.Inspection,
            SerialNumber = "SN-9001",
            Verdict = Verdict.Fail,
            Measurements = measurements,
            CycleCounter = 3,
            Timestamp = DateTimeOffset.UtcNow,
        };
        var ack = new TransportAck(Success: true);

        var record = HistorianResultRecord.From(descriptor, reading, ack, DateTimeOffset.UtcNow);

        Assert.Equal(4, record.PointCount);
        Assert.Equal(2, record.NgCount);
        Assert.NotNull(record.MeasurementsJson);
        Assert.Contains("PT-02", record.MeasurementsJson);
    }
}
