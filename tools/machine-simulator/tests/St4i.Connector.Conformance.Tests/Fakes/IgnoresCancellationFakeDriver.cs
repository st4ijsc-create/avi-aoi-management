using System.Runtime.CompilerServices;
using St4i.Connector.Abstractions;
using St4i.Connector.Abstractions.Models;

namespace St4i.Connector.Conformance.Tests.Fakes;

/// <summary>
/// GP-6 negative control #2 — deliberately violates "<c>ReadAsync</c> honours cancellation" by never
/// observing <paramref name="ct"/> at all inside its loop, standing in for a driver stuck in a
/// connect-retry loop that ignores its token (task-6-brief.md's own framing of the realistic failure mode).
/// The delay below is finite (not <see cref="Timeout.Infinite"/>) purely so this fake's own background task
/// eventually winds down on its own after a negative-control test proves the point, rather than leaking a
/// truly immortal task for the rest of the test process's life.
/// </summary>
public sealed class IgnoresCancellationFakeDriver : IDeviceDriver
{
    public string Id => "fake:ignores-cancellation";

    public string Kind => "fake.ignores-cancellation";

    public DriverHealthState Health => DriverHealthState.Down;

    public async IAsyncEnumerable<DeviceReading> ReadAsync([EnumeratorCancellation] CancellationToken ct)
    {
        while (true)
        {
            // Deliberately does NOT pass ct here — the conformance violation under test.
            await Task.Delay(TimeSpan.FromSeconds(20)).ConfigureAwait(false);
        }

#pragma warning disable CS0162 // deliberately unreachable — only present so this compiles as an iterator.
        yield break;
#pragma warning restore CS0162
    }

    public ValueTask DisposeAsync() => ValueTask.CompletedTask;
}
