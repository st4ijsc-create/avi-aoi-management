using System.Runtime.CompilerServices;
using St4i.Connector.Abstractions;
using St4i.Connector.Abstractions.Models;

namespace St4i.Connector.Conformance.Tests.Fakes;

/// <summary>
/// GP-6 negative control #4 — deliberately violates the connector wire contract's documented
/// <c>object?</c> domain (null|bool|string|numeric — see <c>ConnectorObjectConverter</c>'s class doc
/// comment) by emitting a <see cref="DateTime"/> telemetry value, which GP-2 made throw loudly at
/// serialize time rather than silently coerce (decision (b)).
/// </summary>
public sealed class EmitsOutOfDomainTelemetryFakeDriver : IDeviceDriver
{
    public string Id => "fake:emits-out-of-domain-telemetry";

    public string Kind => "fake.emits-out-of-domain-telemetry";

    public DriverHealthState Health => DriverHealthState.Connected;

    public async IAsyncEnumerable<DeviceReading> ReadAsync([EnumeratorCancellation] CancellationToken ct)
    {
        while (!ct.IsCancellationRequested)
        {
            yield return new DeviceReading
            {
                MachineCode = "FAKE",
                Kind = ReadingKind.Telemetry,
                SerialNumber = "SN",
                Verdict = Verdict.Skip,
                Timestamp = DateTimeOffset.UtcNow,
                Telemetry = new List<TelemetrySample>
                {
                    // Out of domain: a DateTime is neither null|bool|string|numeric.
                    new("bad-value", DateTime.UtcNow, null, "good"),
                },
            };
            await Task.Delay(TimeSpan.FromMilliseconds(10), ct).ConfigureAwait(false);
        }
    }

    public ValueTask DisposeAsync() => ValueTask.CompletedTask;
}
