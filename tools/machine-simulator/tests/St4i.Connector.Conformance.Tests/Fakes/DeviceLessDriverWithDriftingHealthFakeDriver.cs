using System.Runtime.CompilerServices;
using St4i.Connector.Abstractions;
using St4i.Connector.Abstractions.Models;

namespace St4i.Connector.Conformance.Tests.Fakes;

/// <summary>
/// GP-6 negative control #6 (task-6-report.md "Fix round 1", IMPORTANT 2) — a device-less driver (no
/// external connection concept at all, same shape as <c>SimulatedDriver</c>) whose <see cref="Health"/>
/// starts at the value it implicitly claims to be constant (<see cref="DriverHealthState.Connected"/>) but
/// DRIFTS to <see cref="DriverHealthState.Degraded"/> once it actually starts yielding readings — proving
/// that <see cref="DeviceDriverConformanceSuite"/>'s device-less Health check catches drift away from its
/// declared constant, not just a tautological "did it change" comparison that a literal constant-expression
/// getter could never fail regardless of what the driver actually does.
/// </summary>
public sealed class DeviceLessDriverWithDriftingHealthFakeDriver : IDeviceDriver
{
    private DriverHealthState _health = DriverHealthState.Connected;

    public string Id => "fake:device-less-drifting-health";

    public string Kind => "fake.device-less-drifting-health";

    public DriverHealthState Health => _health;

    public async IAsyncEnumerable<DeviceReading> ReadAsync([EnumeratorCancellation] CancellationToken ct)
    {
        while (!ct.IsCancellationRequested)
        {
            // The violation: drifts away from the constant this driver implicitly claims to report.
            _health = DriverHealthState.Degraded;

            yield return new DeviceReading
            {
                MachineCode = "FAKE",
                Kind = ReadingKind.Telemetry,
                SerialNumber = "SN",
                Verdict = Verdict.Skip,
                Timestamp = DateTimeOffset.UtcNow,
            };

            await Task.Delay(TimeSpan.FromMilliseconds(10), ct).ConfigureAwait(false);
        }
    }

    public ValueTask DisposeAsync() => ValueTask.CompletedTask;
}
