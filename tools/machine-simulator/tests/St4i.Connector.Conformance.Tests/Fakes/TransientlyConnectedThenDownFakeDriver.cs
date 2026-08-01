using System.Diagnostics;
using System.Runtime.CompilerServices;
using St4i.Connector.Abstractions;
using St4i.Connector.Abstractions.Models;

namespace St4i.Connector.Conformance.Tests.Fakes;

/// <summary>
/// GP-6 negative control #7 (task-6-report.md "Fix round 1", IMPORTANT 1 — the FULLY isolating proof). The
/// two fakes originally cited for this fix (<see cref="ReusesReadingInstanceFakeDriver"/>/
/// <see cref="MutatesSharedTelemetryListFakeDriver"/>) both report a CONSTANT
/// <see cref="DriverHealthState.Connected"/> — empirically confirmed (by temporarily disabling the
/// <c>sawConnected</c> mechanism and re-running) to still be caught by the check's OTHER, final-state
/// assertion alone, meaning they prove the loop body executes without pooling, but do NOT prove
/// <c>sawConnected</c> is independently load-bearing the way the brief's "would deleting this change any
/// result" bar requires.
///
/// <para>This fake closes that gap: it reports <see cref="DriverHealthState.Connected"/> for a short,
/// DETERMINISTIC window at the start of enumeration (based on elapsed wall-clock time, not cycle count, so
/// timing jitter can't accidentally miss it), then reverts to and STAYS at
/// <see cref="DriverHealthState.Down"/> for the remainder — by the time
/// <c>Check_Health_OnlyTakesDocumentedValues_AndIsSaneWithNoDevice</c>'s 3-second drive window ends, Health
/// is reliably NOT <see cref="DriverHealthState.Connected"/>, so the check's final single-sample assertion
/// alone would MISS this violation entirely. Only <c>sawConnected</c>, checked throughout, catches it.</para>
/// </summary>
public sealed class TransientlyConnectedThenDownFakeDriver : IDeviceDriver
{
    private static readonly TimeSpan ConnectedWindow = TimeSpan.FromMilliseconds(500);

    private readonly Stopwatch _sinceStart = Stopwatch.StartNew();

    public string Id => "fake:transiently-connected-then-down";

    public string Kind => "fake.transiently-connected-then-down";

    public DriverHealthState Health => _sinceStart.Elapsed < ConnectedWindow
        ? DriverHealthState.Connected
        : DriverHealthState.Down;

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
            };
            await Task.Delay(TimeSpan.FromMilliseconds(10), ct).ConfigureAwait(false);
        }
    }

    public ValueTask DisposeAsync() => ValueTask.CompletedTask;
}
