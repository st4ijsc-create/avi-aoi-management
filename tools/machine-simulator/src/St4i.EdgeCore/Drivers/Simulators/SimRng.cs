namespace St4i.EdgeCore.Drivers.Simulators;

/// <summary>
/// Deterministic per-cycle RNG. doc-62 §6: "Determinism: Random seed cố định/máy để tái lập; biến
/// thiên theo index, KHÔNG theo DateTime.Now" — values vary by cycle INDEX, never by wall clock.
/// <see cref="For"/> is a pure function of (seed, cycle): the same pair always yields a
/// <see cref="Random"/> that produces the same draw sequence, regardless of call order, how many
/// times it's called, or which process/run it's called from — so replaying cycle 5 directly
/// reproduces the exact same reading as advancing through cycles 1..5 would have.
///
/// Deliberately hand-rolled (splitmix64-style mix) rather than <c>HashCode.Combine</c>: that API
/// mixes in a per-process random seed, which would make even same-seed/same-cycle draws differ
/// between runs — exactly what determinism must not do (same rationale as DemoTransport's
/// hand-rolled FNV-1a StableHash).
/// </summary>
internal static class SimRng
{
    public static Random For(int seed, long cycle)
    {
        unchecked
        {
            var h = (ulong)seed;
            h = h * 6364136223846793005UL + 1442695040888963407UL;
            h ^= (ulong)cycle;
            h = h * 6364136223846793005UL + 1442695040888963407UL;
            h ^= h >> 33;
            var folded = (int)(h ^ (h >> 32));
            return new Random(folded);
        }
    }

    /// <summary>Box-Muller transform: a standard-normal-derived sample from two uniform draws.</summary>
    public static double NextGaussian(this Random r, double mean, double stdDev)
    {
        var u1 = 1.0 - r.NextDouble(); // in (0,1], never 0 (avoids Log(0))
        var u2 = r.NextDouble();
        var z = Math.Sqrt(-2.0 * Math.Log(u1)) * Math.Cos(2.0 * Math.PI * u2);
        return mean + stdDev * z;
    }
}
