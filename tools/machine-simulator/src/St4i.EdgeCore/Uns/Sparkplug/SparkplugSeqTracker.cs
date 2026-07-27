namespace St4i.EdgeCore.Uns.Sparkplug;

/// <summary>
/// G2-2 — the per-edge-node Sparkplug B sequence number: every NBIRTH/NDEATH/DBIRTH/DDEATH/NDATA/DDATA
/// message on one edge node's session shares a single monotonically increasing <c>seq</c> (0-255,
/// wrapping 255 -&gt; 0), so a Sparkplug-aware subscriber can detect a dropped/out-of-order message. A
/// fresh NBIRTH resets the sequence back to 0 (per spec — <see cref="ResetOnBirth"/>). One instance
/// models exactly one edge node (this process's single <see cref="UnsOptions.Cell"/>), shared by every
/// device under it — NOT one per device (that's what <see cref="SparkplugAliasTable"/> is for).
/// Thread-safe: <see cref="UnsPublisher"/>'s background flush loop is the only caller today, but nothing
/// here assumes single-threaded access.
/// </summary>
public sealed class SparkplugSeqTracker
{
    private readonly object _gate = new();
    private int _seq = -1; // Next() immediately after construction returns 0.

    /// <summary>Returns the next seq value (0-255 inclusive), wrapping 255 back to 0.</summary>
    public byte Next()
    {
        lock (_gate)
        {
            _seq = (_seq + 1) % 256;
            return (byte)_seq;
        }
    }

    /// <summary>Per spec: an NBIRTH restarts the sequence — the NEXT <see cref="Next"/> call after this
    /// returns 0, exactly like a brand-new tracker.</summary>
    public void ResetOnBirth()
    {
        lock (_gate)
        {
            _seq = -1;
        }
    }
}
