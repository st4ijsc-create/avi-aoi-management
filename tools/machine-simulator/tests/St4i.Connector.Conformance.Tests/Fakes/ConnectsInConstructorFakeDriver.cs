using System.Runtime.CompilerServices;
using St4i.Connector.Abstractions;
using St4i.Connector.Abstractions.Models;

namespace St4i.Connector.Conformance.Tests.Fakes;

/// <summary>
/// GP-6 negative control #1 — deliberately violates "construction is non-blocking and does not connect" by
/// blocking synchronously in its constructor (standing in for a driver that opens a socket/session there).
/// Proves <see cref="DeviceDriverConformanceSuite.Check_Construction_IsNonBlocking_AndPerformsNoIO"/> would
/// genuinely reject a driver that does this — see <c>NegativeControlTests</c>.
/// </summary>
public sealed class ConnectsInConstructorFakeDriver : IDeviceDriver
{
    public ConnectsInConstructorFakeDriver()
    {
        Thread.Sleep(TimeSpan.FromSeconds(1));
    }

    public string Id => "fake:connects-in-ctor";

    public string Kind => "fake.connects-in-ctor";

    public DriverHealthState Health => DriverHealthState.Connected;

    public async IAsyncEnumerable<DeviceReading> ReadAsync([EnumeratorCancellation] CancellationToken ct)
    {
        while (true)
        {
            ct.ThrowIfCancellationRequested();
            await Task.Delay(TimeSpan.FromMilliseconds(10), ct).ConfigureAwait(false);
            yield return new DeviceReading
            {
                MachineCode = "FAKE",
                Kind = ReadingKind.Telemetry,
                SerialNumber = "SN",
                Verdict = Verdict.Skip,
                Timestamp = DateTimeOffset.UtcNow,
            };
        }
    }

    public ValueTask DisposeAsync() => ValueTask.CompletedTask;
}
