using System.Runtime.CompilerServices;
using St4i.Connector.Abstractions;
using St4i.Connector.Abstractions.Models;

namespace St4i.Connector.Conformance.Tests.Fakes;

/// <summary>
/// GP-6 negative control #5 — a NARROWER violation of "no <c>DeviceReading</c> instance reuse across
/// yields" than <see cref="ReusesReadingInstanceFakeDriver"/>: this fake allocates a FRESH
/// <see cref="DeviceReading"/> wrapper every cycle (so the cheap top-level <c>ReferenceEquals</c> check in
/// <see cref="DeviceDriverConformanceSuite.Check_ReadAsync_NeverReusesOrMutatesAYieldedReading"/> would NOT
/// catch it), but wraps the SAME, in-place-mutated <c>List&lt;TelemetrySample&gt;</c> in every one of those
/// wrappers — exactly the "shared, later-mutated sub-object" scenario
/// <see cref="DeviceReadingClone"/>'s own class doc comment calls out by name. Exists specifically to prove
/// the check's SECOND, content-drift mechanism has teeth independently of the first — the first negative
/// control alone wouldn't prove that, since its top-level-reuse violation trips the cheap
/// <c>ReferenceEquals</c> assertion before the content-drift assertion ever runs.
/// </summary>
public sealed class MutatesSharedTelemetryListFakeDriver : IDeviceDriver
{
    // Deliberately shared across every yielded reading — mutated IN PLACE each cycle rather than replaced.
    private readonly List<TelemetrySample> _sharedTelemetry = new();

    public string Id => "fake:mutates-shared-telemetry-list";

    public string Kind => "fake.mutates-shared-telemetry-list";

    public DriverHealthState Health => DriverHealthState.Connected;

    public async IAsyncEnumerable<DeviceReading> ReadAsync([EnumeratorCancellation] CancellationToken ct)
    {
        long cycle = 0;
        while (!ct.IsCancellationRequested)
        {
            cycle++;
            _sharedTelemetry.Clear();
            _sharedTelemetry.Add(new TelemetrySample("value", (double)cycle, "unit", "good"));

            yield return new DeviceReading
            {
                MachineCode = "FAKE",
                Kind = ReadingKind.Telemetry,
                SerialNumber = "SN",
                Verdict = Verdict.Skip,
                Timestamp = DateTimeOffset.UtcNow,
                CycleCounter = cycle,
                // The violation: the SAME list instance every cycle, not a fresh one — the wrapping
                // DeviceReading above IS fresh each time, so top-level ReferenceEquals sees distinct objects.
                Telemetry = _sharedTelemetry,
            };

            await Task.Delay(TimeSpan.FromMilliseconds(10), ct).ConfigureAwait(false);
        }
    }

    public ValueTask DisposeAsync() => ValueTask.CompletedTask;
}
