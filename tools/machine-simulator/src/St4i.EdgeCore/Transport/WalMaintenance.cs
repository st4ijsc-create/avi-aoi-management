using System.Text;

namespace St4i.EdgeCore.Transport;

/// <summary>
/// WS-C-T5 — the size guardrail <see cref="WalOptions.MaxBytes"/> promised but nothing enforced yet: left
/// alone, a machine's on-disk WAL queue file (<see cref="WalOptions.ResolveQueueFile"/>) grows without
/// bound while a machine stays offline, which is exactly the unbounded-growth risk the platform's own
/// server-side store-forward policy already guards against (see the repo-root <c>.env.example</c>'s
/// <c>OT_STORE_FORWARD_ENABLED</c>/<c>INSPECTION_STORE_FORWARD_ENABLED</c> remarks: "overflow drops the
/// OLDEST — never silently: every drop is counted + warned + metered"). This mirrors that policy at the
/// SDK-WAL layer: when a queue file exceeds <see cref="WalOptions.MaxBytes"/>, the OLDEST lines (the front
/// of the file — appended first, replayed first, exactly the SDK's own FIFO order) are dropped until the
/// retained newest tail fits the budget, and the file is rewritten ATOMICALLY (temp file + <see
/// cref="File.Move(string,string,bool)"/>, the SAME idiom
/// <see cref="St4i.EdgeCore.Config.MachineConfigStore"/>'s own <c>WriteAllTextAtomic</c> uses) so a reader
/// mid-crash never observes a half-written file. The dropped count is always RETURNED (never silently
/// swallowed) so the pump (see <see cref="WalFlushPump"/>) can log it — "never silently" applied to the
/// client-side WAL too.
///
/// CONCURRENCY (best-effort, by design — read this before touching either side): the SDK's own
/// <c>St4iDeviceClient.Enqueue</c>/<c>DrainQueue</c> (examples/device-client/csharp/St4iDeviceClient.cs)
/// append/rewrite this SAME physical file under THEIR OWN <c>_queueLock</c> — a private, per-instance
/// monitor this type has no way to see or share (the SDK is a vendored reference client this repo does
/// not modify). <see cref="TrimFileToMaxBytes"/> therefore reads, computes, and atomically rewrites the
/// file WITHOUT holding that lock: a rare interleave — the SDK appending a new line, or draining the whole
/// file to empty, at the exact moment a trim's read or rewrite lands — could theoretically drop or
/// duplicate a line versus a perfectly-serialized world. This is accepted, not a bug to chase: the
/// drop-oldest-on-overflow policy this type exists to enforce already means SOME loss is the intended
/// outcome once a file is over budget, and the actual production window is tiny (the pump only calls this
/// once per tick, right after its own drain attempt already shrank the file — see <see
/// cref="WalFlushPump"/>'s remarks on invocation order). Any I/O failure from a genuine mid-flight
/// collision (the file locked/being replaced right as this reads or renames) is caught and treated as a
/// skipped-this-tick no-op (see <see cref="TrimFileToMaxBytes"/>'s catch clauses and
/// <see cref="TrimDirectory"/>'s per-file catch) — a failing trim must never take down the pump's loop; the
/// next tick simply tries again.
/// </summary>
public static class WalMaintenance
{
    /// <summary>Trims ONE JSONL queue file to at most <paramref name="maxBytes"/> by dropping the OLDEST
    /// lines (from the top of the file) until the retained tail (the newest lines, FIFO order preserved)
    /// fits the budget. No-op (returns 0, file untouched — not even rewritten) when the file is
    /// missing/empty/whitespace-only, or already at or under <paramref name="maxBytes"/>. When even the
    /// single newest line alone exceeds <paramref name="maxBytes"/>, that one line is still KEPT (never
    /// dropped to an empty file) — a huge single record is surfaced via the returned drop count for
    /// whatever OLDER lines it displaced, not silently annihilated along with them. Always returns the
    /// number of lines actually dropped so the caller can log/count it (never silent) — 0 whenever nothing
    /// was rewritten, including when a concurrent SDK write makes this tick's read/rewrite fail (see the
    /// class doc's concurrency remarks: caught internally, never thrown from here).</summary>
    public static int TrimFileToMaxBytes(string filePath, long maxBytes)
    {
        ArgumentException.ThrowIfNullOrEmpty(filePath);

        if (!File.Exists(filePath)) return 0;

        string content;
        try
        {
            content = File.ReadAllText(filePath);
        }
        catch (IOException)
        {
            // Best-effort: a concurrent SDK Enqueue/DrainQueue mid-flight (see class doc). Skip this
            // tick — nothing rewritten, nothing to count as dropped.
            return 0;
        }
        catch (UnauthorizedAccessException)
        {
            return 0;
        }

        if (string.IsNullOrWhiteSpace(content)) return 0;

        // Split on the SDK's own line terminator (Enqueue appends "line + \n") and drop blank lines —
        // same "Where(l => l.Trim().Length > 0)" convention the SDK's own DrainQueue/QueueLen use.
        var lines = content.Split('\n')
            .Select(l => l.TrimEnd('\r'))
            .Where(l => l.Trim().Length > 0)
            .ToList();
        if (lines.Count == 0) return 0;

        var totalBytes = lines.Sum(LineBytes);
        if (totalBytes <= maxBytes) return 0;

        // Walk from the newest (last) line backward, keeping as many trailing lines as fit the budget.
        // The `kept.Count > 0` guard is what guarantees at least the single newest line always survives,
        // even alone over budget (see doc comment) — only ever applied once at least one line is kept.
        var kept = new List<string>();
        var keptBytes = 0L;
        for (var i = lines.Count - 1; i >= 0; i--)
        {
            var lineBytes = LineBytes(lines[i]);
            if (kept.Count > 0 && keptBytes + lineBytes > maxBytes) break;
            kept.Insert(0, lines[i]);
            keptBytes += lineBytes;
        }

        var dropped = lines.Count - kept.Count;
        if (dropped <= 0) return 0; // defensive — totalBytes > maxBytes above should always drop >= 1

        try
        {
            WriteAllLinesAtomic(filePath, kept);
        }
        catch (IOException)
        {
            // Best-effort (see class doc): rewrite collided with a concurrent SDK write. The original
            // file is untouched (WriteAllLinesAtomic never partially overwrites it — see its own doc),
            // so nothing was actually dropped this tick; the next tick gets another chance.
            return 0;
        }
        catch (UnauthorizedAccessException)
        {
            return 0;
        }

        return dropped;
    }

    /// <summary>Trims every <c>*.jsonl</c> file in <paramref name="options"/>'s resolved WAL directory to
    /// <see cref="WalOptions.MaxBytes"/>, returning the TOTAL lines dropped across all of them. No-op
    /// (returns 0) when the directory doesn't exist yet — a fleet that has never buffered anything has no
    /// directory to trim. Each file is trimmed independently: one file failing (see
    /// <see cref="TrimFileToMaxBytes"/>'s own best-effort catch, plus this method's own per-file catch for
    /// anything that still escapes it, e.g. a directory-enumeration race) never stops the others from
    /// being trimmed in the same pass.</summary>
    public static int TrimDirectory(WalOptions options)
    {
        ArgumentNullException.ThrowIfNull(options);

        var dir = options.ResolveDir();
        if (!Directory.Exists(dir)) return 0;

        var totalDropped = 0;
        foreach (var file in Directory.EnumerateFiles(dir, "*.jsonl"))
        {
            try
            {
                totalDropped += TrimFileToMaxBytes(file, options.MaxBytes);
            }
            catch (IOException)
            {
                // Best-effort (see class doc) — skip this file this tick, try again next tick.
            }
            catch (UnauthorizedAccessException)
            {
            }
        }

        return totalDropped;
    }

    private static long LineBytes(string line) => Encoding.UTF8.GetByteCount(line) + 1; // +1 for the trailing '\n'

    /// <summary>Same temp-file + <see cref="File.Move(string,string,bool)"/> atomic-rewrite idiom as
    /// <see cref="St4i.EdgeCore.Config.MachineConfigStore"/>'s own <c>WriteAllTextAtomic</c>: <paramref
    /// name="path"/> is always either its complete old content or its complete new content, never a
    /// partial write, even if the process dies mid-rewrite. On any failure (temp-file write or the
    /// rename itself), the stray temp file is best-effort cleaned up before the exception is rethrown —
    /// this type never leaves <c>.tmp-*</c> litter behind, success or failure.</summary>
    private static void WriteAllLinesAtomic(string path, IReadOnlyList<string> lines)
    {
        var tempPath = path + ".tmp-" + Guid.NewGuid().ToString("N");
        var content = lines.Count == 0 ? string.Empty : string.Join("\n", lines) + "\n";
        try
        {
            File.WriteAllText(tempPath, content);
            File.Move(tempPath, path, overwrite: true);
        }
        catch
        {
            try
            {
                if (File.Exists(tempPath)) File.Delete(tempPath);
            }
            catch
            {
                // Best-effort cleanup only — the original rewrite failure is what matters and is
                // rethrown below regardless of whether this cleanup itself succeeds.
            }

            throw;
        }
    }
}
