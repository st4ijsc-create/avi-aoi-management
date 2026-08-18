using System.Runtime.CompilerServices;
using System.Text;
using St4i.EdgeCore.Models;

namespace St4i.EdgeCore.Drivers.HotFolder;

/// <summary>
/// The first REAL proof driver (Task 11): watches <paramref name="watchDir"/>-style hot folders for
/// doc-28 (docs/ECOSYSTEM/28_ST4I_STANDARD_INSPECTION_FEED_SPEC.md) result files dropped by a
/// simulated (or real) AOI machine — typically via <see cref="Doc28Writer"/> on the producer side —
/// parses each with <see cref="Doc28Parser.Parse"/>, and yields the resulting
/// <see cref="DeviceReading"/> through the same <see cref="IDeviceDriver"/> seam every other driver
/// uses (Task 10's <see cref="SimulatedDriver"/>, Task 12's MQTT driver, ...).
///
/// Pickup strategy is a poll+watch hybrid rather than a bare <see cref="FileSystemWatcher"/>:
/// <list type="bullet">
/// <item>A <see cref="FileSystemWatcher"/> misses files that already existed BEFORE it started
/// watching — so <see cref="ReadAsync"/> always does a full directory scan on every pass (not just a
/// one-time startup scan), which trivially also covers "existing files at startup".</item>
/// <item>A <see cref="FileSystemWatcher"/> can fire while a file is still mid-write. The doc28 §6.3
/// atomic-write protocol (write "*.tmp", flush+close, then rename) exists precisely so the watcher
/// never has to guess: every file whose name does NOT end in ".tmp" is, by the protocol's contract,
/// complete — so "skip *.tmp" is both necessary and sufficient here, no extra staleness heuristics
/// needed.</item>
/// <item>The watcher instance only shortens the poll's wake-up latency (<see cref="SemaphoreSlim"/>
/// signal); the periodic re-scan is what a test (or production) can always rely on, even if the
/// watcher fails to start (e.g. a network share) or misses an event.</item>
/// </list>
/// </summary>
public sealed class HotFolderAoiDriver : IDeviceDriver
{
    private static readonly TimeSpan PollInterval = TimeSpan.FromMilliseconds(120);

    private readonly string _watchDir;
    private readonly string _archiveDir;
    private readonly string _errorDir;
    private readonly FileSystemWatcher? _watcher;
    private readonly SemaphoreSlim _wake = new(0, int.MaxValue);
    private volatile bool _disposed;

    public HotFolderAoiDriver(string watchDir, string archiveDir, string errorDir)
    {
        if (watchDir is null) throw new ArgumentNullException(nameof(watchDir));
        if (archiveDir is null) throw new ArgumentNullException(nameof(archiveDir));
        if (errorDir is null) throw new ArgumentNullException(nameof(errorDir));

        _watchDir = watchDir;
        _archiveDir = archiveDir;
        _errorDir = errorDir;

        Directory.CreateDirectory(_watchDir);
        Directory.CreateDirectory(_archiveDir);
        Directory.CreateDirectory(_errorDir);

        Id = "hotfolder-aoi:" + _watchDir;

        _watcher = TryCreateWatcher();
        Health = DriverHealthState.Connected;
    }

    public string Id { get; }

    public DriverKind Kind => DriverKind.HotFolderAoi;

    public DriverHealthState Health { get; private set; }

    public async IAsyncEnumerable<DeviceReading> ReadAsync([EnumeratorCancellation] CancellationToken ct)
    {
        while (!_disposed)
        {
            ct.ThrowIfCancellationRequested();

            var path = FindNextCandidate();
            if (path is null)
            {
                await WaitForWakeOrPollTickAsync(ct).ConfigureAwait(false);
                continue;
            }

            string content;
            try
            {
                content = await ReadFullyAsync(path, ct).ConfigureAwait(false);
            }
            catch (FileNotFoundException)
            {
                continue; // raced with something else moving/removing it between scan and read
            }
            catch (IOException)
            {
                // Locked despite the atomic-rename convention (e.g. a slow network volume) — wait a
                // tick and re-scan rather than tearing down the whole stream over one file.
                await Task.Delay(PollInterval, ct).ConfigureAwait(false);
                continue;
            }

            var fileName = Path.GetFileName(path);
            DeviceReading reading;
            try
            {
                reading = Doc28Parser.Parse(content, fileName);
            }
            catch (Doc28ValidationException)
            {
                // §6.3 rule 4: files that fail to parse go to error/ — untouched, never deleted.
                MoveTo(path, _errorDir);
                continue;
            }

            // Move to archive BEFORE yielding: the reading is handed to the caller only once the
            // hot-folder no longer holds it, matching "never leave a processed file sitting in
            // watchDir" even if the caller stops enumerating right after this item.
            MoveTo(path, _archiveDir);
            yield return reading;
        }
    }

    private string? FindNextCandidate()
    {
        IEnumerable<string> files;
        try
        {
            files = Directory.EnumerateFiles(_watchDir);
        }
        catch (DirectoryNotFoundException)
        {
            return null;
        }
        catch (IOException)
        {
            return null;
        }

        string? best = null;
        foreach (var f in files)
        {
            if (f.EndsWith(".tmp", StringComparison.OrdinalIgnoreCase)) continue; // atomic-write in progress
            if (best is null || string.CompareOrdinal(f, best) < 0) best = f;
        }

        return best;
    }

    private async Task WaitForWakeOrPollTickAsync(CancellationToken ct)
    {
        using var linked = CancellationTokenSource.CreateLinkedTokenSource(ct);
        linked.CancelAfter(PollInterval);
        try
        {
            await _wake.WaitAsync(linked.Token).ConfigureAwait(false);
        }
        catch (OperationCanceledException) when (!ct.IsCancellationRequested)
        {
            // Just the poll-interval timer firing (not real cancellation) — fall through and let
            // the caller re-scan the directory.
        }
    }

    private static async Task<string> ReadFullyAsync(string path, CancellationToken ct)
    {
        using var stream = new FileStream(path, FileMode.Open, FileAccess.Read, FileShare.Read);
        using var reader = new StreamReader(stream, Encoding.UTF8, detectEncodingFromByteOrderMarks: true);
        return await reader.ReadToEndAsync(ct).ConfigureAwait(false);
    }

    private static void MoveTo(string path, string destDir)
    {
        Directory.CreateDirectory(destDir);
        var dest = Path.Combine(destDir, Path.GetFileName(path));
        if (File.Exists(dest))
        {
            // Name collision (re-drop of the same machine/serial/timestamp triple) — disambiguate
            // rather than overwrite, since archive/error must never silently lose a prior file.
            dest = Path.Combine(destDir, $"{Path.GetFileNameWithoutExtension(path)}__{Guid.NewGuid():N}{Path.GetExtension(path)}");
        }

        File.Move(path, dest);
    }

    private FileSystemWatcher? TryCreateWatcher()
    {
        try
        {
            var watcher = new FileSystemWatcher(_watchDir)
            {
                NotifyFilter = NotifyFilters.FileName | NotifyFilters.LastWrite | NotifyFilters.CreationTime | NotifyFilters.Size,
                IncludeSubdirectories = false,
            };
            watcher.Created += (_, _) => SignalWake();
            watcher.Renamed += (_, _) => SignalWake(); // .tmp -> final rename lands here
            watcher.Changed += (_, _) => SignalWake();
            watcher.Error += (_, _) => SignalWake(); // e.g. internal buffer overflow — fall back to polling
            watcher.EnableRaisingEvents = true;
            return watcher;
        }
        catch (IOException)
        {
            // Some environments (network shares, sandboxes) can't create a FileSystemWatcher — the
            // poll loop in ReadAsync still covers everything, just at PollInterval latency instead
            // of near-instant.
            return null;
        }
    }

    private void SignalWake()
    {
        if (_wake.CurrentCount == 0)
        {
            try { _wake.Release(); }
            catch (ObjectDisposedException) { /* disposed concurrently with an in-flight FS event */ }
        }
    }

    public ValueTask DisposeAsync()
    {
        if (_disposed) return ValueTask.CompletedTask;
        _disposed = true;
        Health = DriverHealthState.Down;
        _watcher?.Dispose();
        _wake.Dispose();
        return ValueTask.CompletedTask;
    }
}
