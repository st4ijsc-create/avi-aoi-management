using System.Runtime.CompilerServices;
using St4i.EdgeCore.Drivers.Simulators;
using St4i.EdgeCore.Models;

namespace St4i.EdgeCore.Drivers;

/// <summary>
/// The exhibition "south side": wraps a fleet of <see cref="IMachineSimulator"/>s and yields their
/// readings at each sim's own cadence (<see cref="MachineDescriptor.CycleSeconds"/>), round-robin
/// across the fleet — e.g. a 1s screwdriver and a 4s AOI machine both stream at their own natural
/// rate from a single <see cref="ReadAsync"/> stream. This is I/O PACING ONLY (real-time
/// <see cref="Task.Delay(TimeSpan,CancellationToken)"/>) — it never influences the deterministic
/// value logic inside each sim, which is a pure function of (seed, cycle).
/// </summary>
public sealed class SimulatedDriver : IDeviceDriver
{
    private readonly IReadOnlyList<IMachineSimulator> _sims;
    private readonly long[] _cycleCounters;
    private readonly DateTimeOffset[] _nextDueAt;
    private volatile bool _disposed;

    public SimulatedDriver(IReadOnlyList<IMachineSimulator> sims)
    {
        if (sims is null) throw new ArgumentNullException(nameof(sims));
        if (sims.Count == 0) throw new ArgumentException("At least one simulator is required.", nameof(sims));

        _sims = sims;
        Id = "sim-driver:" + string.Join(",", _sims.Select(s => s.Descriptor.Code));

        var now = DateTimeOffset.UtcNow;
        _cycleCounters = new long[_sims.Count];
        _nextDueAt = new DateTimeOffset[_sims.Count];
        for (var i = 0; i < _sims.Count; i++) _nextDueAt[i] = now;
    }

    public string Id { get; }

    public DriverKind Kind => DriverKind.Simulated;

    /// <summary>Always Connected — a pure in-process simulator has no external link to lose.</summary>
    public DriverHealthState Health => DriverHealthState.Connected;

    public async IAsyncEnumerable<DeviceReading> ReadAsync([EnumeratorCancellation] CancellationToken ct)
    {
        while (!_disposed)
        {
            ct.ThrowIfCancellationRequested();

            var idx = NextDueIndex();
            var wait = _nextDueAt[idx] - DateTimeOffset.UtcNow;
            if (wait > TimeSpan.Zero)
            {
                await Task.Delay(wait, ct).ConfigureAwait(false);
            }

            if (_disposed) yield break;

            var sim = _sims[idx];
            _cycleCounters[idx]++;
            var reading = sim.NextCycle(_cycleCounters[idx]);

            var cadence = sim.Descriptor.CycleSeconds > 0 ? sim.Descriptor.CycleSeconds : 1.0;
            _nextDueAt[idx] = _nextDueAt[idx].AddSeconds(cadence);

            yield return reading;
        }
    }

    /// <summary>Index of the sim whose next cycle is due soonest (earliest <see cref="_nextDueAt"/>).</summary>
    private int NextDueIndex()
    {
        var best = 0;
        for (var i = 1; i < _nextDueAt.Length; i++)
        {
            if (_nextDueAt[i] < _nextDueAt[best]) best = i;
        }

        return best;
    }

    public ValueTask DisposeAsync()
    {
        _disposed = true;
        return ValueTask.CompletedTask;
    }
}
