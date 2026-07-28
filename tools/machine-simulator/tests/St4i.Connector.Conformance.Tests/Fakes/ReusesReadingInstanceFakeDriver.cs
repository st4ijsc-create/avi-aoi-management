using System.Runtime.CompilerServices;
using St4i.Connector.Abstractions;
using St4i.Connector.Abstractions.Models;

namespace St4i.Connector.Conformance.Tests.Fakes;

/// <summary>
/// GP-6 negative control #3 — deliberately violates "no <c>DeviceReading</c> instance reuse across yields"
/// by allocating ONE <see cref="DeviceReading"/> up front, mutating it in place every cycle, and yielding the
/// SAME reference every time — standing in for a driver that pools readings.
/// </summary>
public sealed class ReusesReadingInstanceFakeDriver : IDeviceDriver
{
    private readonly DeviceReading _pooled = new()
    {
        MachineCode = "FAKE",
        Kind = ReadingKind.Telemetry,
        SerialNumber = "SN",
        Verdict = Verdict.Skip,
    };

    public string Id => "fake:reuses-reading-instance";

    public string Kind => "fake.reuses-reading-instance";

    public DriverHealthState Health => DriverHealthState.Connected;

    public async IAsyncEnumerable<DeviceReading> ReadAsync([EnumeratorCancellation] CancellationToken ct)
    {
        long cycle = 0;
        while (!ct.IsCancellationRequested)
        {
            cycle++;

            // The conformance violation under test: mutate and re-yield the SAME object instead of
            // allocating a fresh DeviceReading each cycle.
            _pooled.CycleCounter = cycle;
            _pooled.Timestamp = DateTimeOffset.UtcNow;
            _pooled.Telemetry = new List<TelemetrySample> { new("value", (double)cycle, "unit", "good") };

            yield return _pooled;
            await Task.Delay(TimeSpan.FromMilliseconds(10), ct).ConfigureAwait(false);
        }
    }

    public ValueTask DisposeAsync() => ValueTask.CompletedTask;
}
