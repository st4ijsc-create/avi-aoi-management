using System.Collections;
using System.Collections.Concurrent;
using System.Text;
using St4i.EdgeCore.Models;

namespace St4i.EdgeCore.Transport;

/// <summary>
/// Offline fabricator: produces realistic-looking <see cref="TransportAck"/>/<see cref="HeartbeatResult"/>/
/// <see cref="ConfigSyncResult"/> responses with no network at all, so the rest of the app (simulator UI,
/// dashboards, replay) works end-to-end at an exhibition booth with no server reachable.
///
/// Deliberately deterministic: given the same sequence of calls, it always produces the same sequence of
/// acks (no wall-clock/random seeding) so demo runs are reproducible and testable.
/// </summary>
public sealed class DemoTransport : ITransport
{
    /// <summary>Simulated round-trip current version returned by <see cref="SyncConfigAsync"/>.</summary>
    private const string DemoConfigVersion = "1.0.0-demo";

    private readonly double _latencyMs;
    private readonly double _fakeErrorRate;

    private long _processResultCounter;
    private long _inspectionCounter;

    private readonly ConcurrentDictionary<(string MachineCode, string IdempotencyKey), long> _processResultIds = new();
    private readonly ConcurrentDictionary<(string MachineCode, string IdempotencyKey), long> _inspectionIds = new();

    public DemoTransport(double latencyMs = 40, double fakeErrorRate = 0.0)
    {
        _latencyMs = latencyMs;
        _fakeErrorRate = Math.Clamp(fakeErrorRate, 0.0, 1.0);
    }

    public TransportMode Mode => TransportMode.Demo;

    public async Task<TransportAck> SendAsync(CanonicalEnvelope env, CancellationToken ct)
    {
        await DelayAsync(ct);

        if (ShouldSimulateQueued(env.IdempotencyKey))
        {
            // Store-and-forward: the message never actually reached "the server" this call — it was
            // accepted locally and would be flushed later. No HTTP round-trip happened, so HttpStatus=0.
            return new TransportAck(Success: true, Queued: true, LatencyMs: (long)_latencyMs);
        }

        return env.Kind switch
        {
            ReadingKind.ProcessResult => AckProcessResult(env),
            ReadingKind.Inspection => AckInspection(env),
            ReadingKind.Telemetry => AckTelemetry(env),
            _ => throw new ArgumentOutOfRangeException(nameof(env), env.Kind, "Unknown ReadingKind"),
        };
    }

    public async Task<HeartbeatResult> HeartbeatAsync(string machineCode, CancellationToken ct)
    {
        await DelayAsync(ct);

        // Deterministic pseudo machine id derived from the code, purely so repeated heartbeats for the
        // same machine look stable across a demo session — not a real registry lookup.
        var machineId = (long)(StableHash(machineCode) % 1_000_000) + 1;
        return new HeartbeatResult(true, machineId, "active", 365);
    }

    public async Task<ConfigSyncResult> SyncConfigAsync(string machineCode, string configKind, string? cachedVersion, CancellationToken ct)
    {
        await DelayAsync(ct);

        var changed = !string.Equals(cachedVersion, DemoConfigVersion, StringComparison.Ordinal);
        return new ConfigSyncResult(changed, DemoConfigVersion, changed ? "synced" : "none", Applied: true);
    }

    // ─────────────────────────────────────────────────────────────────────
    // ACK FABRICATION
    // ─────────────────────────────────────────────────────────────────────

    private TransportAck AckProcessResult(CanonicalEnvelope env)
    {
        var (id, duplicate) = AssignId(_processResultIds, ref _processResultCounter, env.MachineCode, env.IdempotencyKey);
        return new TransportAck(Success: true, Id: id, Duplicate: duplicate, HttpStatus: 201, LatencyMs: (long)_latencyMs);
    }

    private TransportAck AckInspection(CanonicalEnvelope env)
    {
        var (id, duplicate) = AssignId(_inspectionIds, ref _inspectionCounter, env.MachineCode, env.IdempotencyKey);
        return new TransportAck(Success: true, Id: id, Duplicate: duplicate, HttpStatus: 201, LatencyMs: (long)_latencyMs);
    }

    private TransportAck AckTelemetry(CanonicalEnvelope env)
    {
        var accepted = CountSamples(env.Payload.GetValueOrDefault("samples"));
        return new TransportAck(Success: true, Accepted: accepted, HttpStatus: 202, LatencyMs: (long)_latencyMs);
    }

    /// <summary>
    /// First call for a given (machineCode, idempotencyKey) pair mints a new incrementing id; every
    /// subsequent call for the same pair returns the SAME id with Duplicate=true — mirrors the real
    /// ingest endpoints' idempotency-key dedup contract (doc61).
    /// </summary>
    private static (long Id, bool Duplicate) AssignId(
        ConcurrentDictionary<(string MachineCode, string IdempotencyKey), long> map,
        ref long counter,
        string machineCode,
        string idempotencyKey)
    {
        var key = (machineCode, idempotencyKey);
        if (map.TryGetValue(key, out var existing))
        {
            return (existing, true);
        }

        var candidate = Interlocked.Increment(ref counter);
        var winner = map.GetOrAdd(key, candidate);
        return (winner, winner != candidate);
    }

    /// <summary>Counts <c>Payload["samples"]</c> regardless of its concrete collection type.</summary>
    private static int CountSamples(object? samples)
    {
        switch (samples)
        {
            case null:
                return 0;
            case ICollection collection:
                return collection.Count;
            case IEnumerable enumerable:
                var n = 0;
                foreach (var _ in enumerable) n++;
                return n;
            default:
                return 0;
        }
    }

    // ─────────────────────────────────────────────────────────────────────
    // DETERMINISTIC "STORE-AND-FORWARD" SIMULATION
    // ─────────────────────────────────────────────────────────────────────

    /// <summary>
    /// Decides, deterministically from the idempotency key (never from wall-clock/RNG), whether this
    /// send should look like it got store-and-forward-queued instead of ack'd immediately. Keeps demo
    /// runs reproducible: the same envelope always gets the same outcome.
    /// </summary>
    private bool ShouldSimulateQueued(string idempotencyKey)
    {
        if (_fakeErrorRate <= 0.0) return false;
        if (_fakeErrorRate >= 1.0) return true;

        var bucket = StableHash(idempotencyKey) % 100;
        return bucket < (uint)(_fakeErrorRate * 100);
    }

    /// <summary>Stable (process- and run-independent) 32-bit FNV-1a hash — unlike string.GetHashCode(),
    /// which is randomized per-process in .NET, this must be reproducible across runs for determinism.</summary>
    private static uint StableHash(string s)
    {
        unchecked
        {
            var hash = 2166136261u;
            foreach (var b in Encoding.UTF8.GetBytes(s))
            {
                hash ^= b;
                hash *= 16777619u;
            }

            return hash;
        }
    }

    private Task DelayAsync(CancellationToken ct) =>
        _latencyMs > 0 ? Task.Delay((int)_latencyMs, ct) : Task.CompletedTask;
}
