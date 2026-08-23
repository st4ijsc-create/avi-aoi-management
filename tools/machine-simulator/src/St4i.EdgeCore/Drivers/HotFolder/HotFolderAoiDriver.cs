using System.Runtime.CompilerServices;
using System.Text;
using St4i.Connector.Abstractions;
using St4i.Connector.Abstractions.Models;

namespace St4i.EdgeCore.Drivers.HotFolder;

/// <summary>
/// The first REAL proof driver (Task 11): watches <c>watchDir</c>-style hot folders for
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
///
/// <para>🔴 <b>THE <see cref="IDeviceDriver.Health"/> EXEMPTION, CLAIMED HERE BECAUSE THE CONTRACT SAYS IT
/// MUST BE CLAIMED IN THE CLASS DOC AND UNTIL 2026-08-23 IT WAS NOT</b> — <c>docs/owner-decisions.md</c>
/// item 48, defect 5, ruled by BI-1 under the coordinator's delegation. <see cref="IDeviceDriver.Health"/>
/// forbids reporting <see cref="DriverHealthState.Connected"/> while no external device is reachable,
/// exempts "a driver with no external device at all", and states that <b>claiming that exemption without
/// documenting it is itself a conformance violation</b>. This driver was claiming it in behaviour, and
/// only <c>HotFolderAoiDriverConformanceTests</c> — which says in its own words that it is judging BY
/// ANALOGY — said so on its behalf. That is the defect: the class the contract asks was silent.
///
/// <para><b>The claim is made in the narrow form the measurement supports, not the wide one.</b> This
/// driver has no socket, no session and no handshake: it reads a directory. <see cref="Health"/> takes
/// exactly two values over an instance's life — <see cref="DriverHealthState.Connected"/> from the moment
/// the constructor returns and <see cref="DriverHealthState.Down"/> from the moment
/// <see cref="DisposeAsync"/> runs — and <see cref="DriverHealthState.Degraded"/> is never assigned
/// anywhere in this class.
///
/// <para>🔴 <b>AND THE CLAIM IS QUALIFIED RATHER THAN ASSERTED FLAT, because the honest reading is that it
/// does not obviously hold.</b> A watch directory on a network share IS an external dependency by any
/// operator's reading of the word, and this member keeps reporting Connected in three states a reader
/// would not call connected — the watch directory deleted after construction, watcher creation having
/// failed, and the watcher losing events afterwards. Those three are enumerated with their mechanisms at
/// <see cref="Health"/>'s own declaration and are NOT retracted by this paragraph. So what is written down
/// here is the exemption this driver relies on TODAY plus the reason it is uncomfortable, which is what the
/// contract asked for and is strictly more than the silence it replaces. Narrowing the exemption — or
/// giving this driver a real Degraded state — is a behaviour change and is one of the four defects item 48
/// records as NOT taken.</para></para></para>
/// </summary>
public sealed class HotFolderAoiDriver : IDeviceDriver
{
    private static readonly TimeSpan PollInterval = TimeSpan.FromMilliseconds(120);

    private readonly string _watchDir;
    private readonly string _archiveDir;
    private readonly string _errorDir;
    private readonly Action<string>? _diagnostics;
    private readonly SemaphoreSlim _wake = new(0, int.MaxValue);
    private FileSystemWatcher? _watcher;
    private int _started;
    private volatile bool _disposed;

    /// <summary>Null-checks the three directory paths, composes <see cref="Id"/>, and latches
    /// <see cref="Health"/> to <see cref="DriverHealthState.Connected"/>. It touches no disk.
    ///
    /// <para>🔴 <b>"This constructor performs real I/O, which is a direct violation of
    /// <see cref="IDeviceDriver"/>'s type-level rule … and it is recorded rather than fixed here" IS
    /// RETRACTED, 2026-08-23, BK-1</b> (<c>docs/owner-decisions.md</c> item 48 defect 1, measured first by
    /// BB-1 on 2026-08-22 and re-confirmed by BI-1). Quoted and retired in place. It was true and it is now
    /// fixed rather than recorded: the three <see cref="Directory.CreateDirectory(string)"/> calls and the
    /// <see cref="FileSystemWatcher"/> moved to the FIRST pass of <see cref="ReadAsync"/>, which is where
    /// <see cref="IDeviceDriver"/> says connection and session work belongs. The rule exists because
    /// <c>FleetCore.StartLocked</c> builds drivers under the same lock <c>Estop()</c> takes, so a constructor
    /// that blocks on a slow or unreachable volume blocks that halt call.</para>
    ///
    /// <para><b>What moved WITH the I/O, because the ordering is the part that could have broken something.</b>
    /// The three directories now come into existence when the first read pass runs instead of when the
    /// constructor returns. Re-measured rather than carried forward: the two construction sites outside tests
    /// are <c>FleetCore.RunHotFolderAoiDemoAsync</c> and
    /// <c>St4iMachineSimulator.Services.FleetService.RunHotFolderAoiDemoAsync</c>, and BOTH write their demo
    /// file through <c>Doc28Writer.WriteAtomic</c>, which creates the watch directory itself, BEFORE they
    /// construct this driver — so neither ever depended on the constructor for it. <c>MoveTo</c> likewise
    /// creates its destination before every move. A caller that constructed this driver purely to have the
    /// three directories appear, and never enumerated, would see a behaviour change; no such caller exists in
    /// this tree.</para>
    ///
    /// <para><b>Health is still latched here, and that is not an oversight.</b> Narrowing it, or giving this
    /// driver a real Degraded state, is a separate behaviour change that item 48 records as NOT taken; the
    /// exemption claimed in this class's own doc comment is unchanged.</para></summary>
    /// <param name="watchDir">Directory scanned for completed result files. Created on the first read pass,
    /// not here. Files whose name ends in <c>.tmp</c> are skipped, which is what makes the doc-28 §6.3
    /// atomic-write protocol sufficient on its own.</param>
    /// <param name="archiveDir">Where a successfully parsed file is moved BEFORE its reading is yielded.
    /// Created on the first read pass, and again by each move. A name collision is disambiguated with a
    /// suffix rather than overwritten.</param>
    /// <param name="errorDir">Where a file that fails doc-28 validation is moved, intact and never deleted.
    /// Created on the first read pass, and again by each move. A file landing here produces no reading and no
    /// exception to any caller.</param>
    /// <param name="diagnostics">Optional sink for the two things this driver used to discard: the reason a
    /// file was moved to <paramref name="errorDir"/>, and a failure to start the watcher. Added by BK-1 on
    /// 2026-08-23 for <c>docs/owner-decisions.md</c> item 52 sub-item 3, whose whole finding was that the
    /// error path carried no reason anywhere — no log line, no sidecar, no informative rename. It is called on
    /// the enumerating thread, inline, so it must be prompt; a throw out of it is contained and discarded.
    /// <see langword="null"/> reproduces the previous silence exactly.</param>
    public HotFolderAoiDriver(
        string watchDir,
        string archiveDir,
        string errorDir,
        Action<string>? diagnostics = null)
    {
        if (watchDir is null) throw new ArgumentNullException(nameof(watchDir));
        if (archiveDir is null) throw new ArgumentNullException(nameof(archiveDir));
        if (errorDir is null) throw new ArgumentNullException(nameof(errorDir));

        _watchDir = watchDir;
        _archiveDir = archiveDir;
        _errorDir = errorDir;
        _diagnostics = diagnostics;

        Id = "hotfolder-aoi:" + _watchDir;

        Health = DriverHealthState.Connected;
    }

    /// <summary>Composed once by the constructor as <c>"hotfolder-aoi:"</c> followed by the watch directory
    /// EXACTLY as it was handed in — not normalised, not made absolute, not case-folded. Two drivers given
    /// the same directory by two different spellings therefore report two different ids while contending for
    /// the same files, and the id carries a filesystem path into whatever logs or surfaces read it. Fixed for
    /// the lifetime of the instance, as <see cref="IDeviceDriver.Id"/> requires.</summary>
    public string Id { get; }

    /// <summary>Always <c>DriverKinds.HotFolderAoi</c>, one of the five ids this codebase reserves. Read in
    /// production by <c>FleetCore.GetDriverHealth()</c> into <c>DriverHealthSnapshot.Kind</c>, which
    /// <c>St4i.EngineApi.Alarms.AlarmEvaluator</c> interpolates twice into the TEXT of a degraded/down alarm.
    /// It is not the alarm's key or target — those are the slot label. The DEGRADED text in particular is out
    /// of reach for this driver, since <see cref="Health"/> is never assigned that value here; only the DOWN
    /// text is, and only from disposal onward.</summary>
    public string Kind => DriverKinds.HotFolderAoi;

    /// <summary>Takes exactly two values over the life of an instance:
    /// <see cref="DriverHealthState.Connected"/> from the moment the constructor returns, and
    /// <see cref="DriverHealthState.Down"/> from the moment <see cref="DisposeAsync"/> runs.
    /// <see cref="DriverHealthState.Degraded"/> is never assigned anywhere in this class.
    ///
    /// <para>🔴 <b>So this reports Connected in three states a reader would not call connected</b>, and each
    /// is reachable: the watch directory being deleted after construction (the scan catches
    /// <see cref="DirectoryNotFoundException"/> and simply finds nothing);
    /// <see cref="FileSystemWatcher"/> creation having failed, e.g. on a network share, leaving the driver on
    /// the 120 ms poll with no event path at all; and the watcher LOSING events afterwards, since its
    /// <c>Error</c> handler only nudges the poll and reports nowhere else. In each of those this member keeps
    /// reading Connected, so nothing about it reaches the driver-health path
    /// <c>St4i.EngineApi.Alarms.AlarmEvaluator</c> watches. What is left to notice is the ABSENCE of
    /// readings, which is a different alarm source and not this one.</para>
    ///
    /// <para><b>Where that sits against the contract.</b> <see cref="IDeviceDriver.Health"/> exempts a driver
    /// with no external device from its "never report Connected while unreachable" rule, but requires such a
    /// driver to claim the exemption in its own CLASS doc comment and to state the values Health takes
    /// instead.
    ///
    /// <para>🔴 <b>"This class's class-level comment does neither … the class-level claim the contract
    /// actually asks for is still absent" IS RETRACTED, 2026-08-23, BK-1.</b> Quoted and retired in place. It
    /// was true when it was written and it stopped being true EARLIER THE SAME DAY, in the same file: BI-1
    /// paid item 48 defect 5 by writing the class-level claim, and left this paragraph and
    /// <c>HotFolderAoiDriverConformanceTests</c>' own remarks both still saying it is missing. So the fix for
    /// "the class doc is silent" shipped alongside two surviving statements that it is — one of them nine
    /// lines further down the same declaration. That is the defect this file exists to end, committed inside
    /// the commit that closed an instance of it, and it is named here rather than quietly overwritten.</para>
    ///
    /// What still stands from that paragraph, because retracting the whole of it would lose the part that is
    /// still the honest reading: the exemption is claimed BY ANALOGY rather than obviously, and a watched
    /// directory on a network share is not clearly "no external device at all". The class-level claim says so
    /// in as many words.</para></summary>
    public DriverHealthState Health { get; private set; }

    /// <summary>The pickup loop. Each pass rescans the watch directory, takes the ORDINALLY SMALLEST
    /// non-<c>.tmp</c> filename, reads it, parses it, moves it, and yields at most one reading; with nothing
    /// to take it parks until the watcher nudges it or 120 ms elapse, whichever comes first. Pickup order is
    /// therefore filename order, not arrival order — the doc-28 naming convention is what makes that
    /// approximate time order, and a producer that names files otherwise will see them picked up in the
    /// order it named them.
    ///
    /// <para><b>Three failures are absorbed rather than raised, and each disappears differently.</b> A file
    /// that vanished between the scan and the read is skipped silently. A file still locked despite the
    /// atomic-rename convention costs one poll interval and is retried on the next pass, indefinitely. A file
    /// that fails doc-28 validation is moved to the error directory and produces nothing — no reading, no
    /// log, no exception to the caller. What is NOT absorbed is everything else: an
    /// <see cref="UnauthorizedAccessException"/> from the read, or any failure of the archive/error move,
    /// leaves this method and ends the enumeration, alongside the
    /// <see cref="OperationCanceledException"/> cancellation raises.</para>
    ///
    /// <para><b>The archive move happens BEFORE the yield, on purpose</b>, so a caller that stops enumerating
    /// on the item it was just handed cannot leave that file sitting in the watch directory to be picked up
    /// twice. The cost of that ordering is the other direction: a reading whose consumer never processed it
    /// has already been moved out of the hot folder, so a crash between the move and the consumer's commit
    /// loses it from the folder's point of view.</para></summary>
    /// <param name="ct">Checked at the top of every pass and honoured while parked, which is where this loop
    /// spends nearly all of its time. It does NOT bound the whole method: the archive/error move is
    /// synchronous file I/O taking no token, so on a wedged volume cancellation waits for that call to
    /// return.</param>
    /// <returns>One reading per successfully parsed file, filename order, at most one per pass.</returns>
    public async IAsyncEnumerable<DeviceReading> ReadAsync([EnumeratorCancellation] CancellationToken ct)
    {
        EnsureStarted();

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
            catch (Doc28ValidationException ex)
            {
                // §6.3 rule 4: files that fail to parse go to error/ — untouched, never deleted.
                //
                // 🔴 THE EXCEPTION IS BOUND NOW, AND THAT IS THE WHOLE OF item 52 sub-item 3. It used to be
                // `catch (Doc28ValidationException)` with no binding: the message and any inner exception were
                // discarded unread on the ONLY production path that catches this type, so a rejected file
                // reached error/ carrying no reason anywhere. Six of Doc28Parser's 34 throw sites name no file
                // either (its own remarks enumerate them) — reporting the file name HERE covers all 34 at one
                // site instead of changing six signatures, and it is the file name this driver already holds
                // rather than one threaded down through the parser's field-level helpers.
                Report($"doc-28 rejected '{fileName}' -> {_errorDir}: {Describe(ex)}");
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

    /// <summary>Does, on the first read pass, the file-system work the constructor used to do: creates the
    /// three directories and starts the watcher. Runs at most once per instance — the
    /// <see cref="Interlocked.CompareExchange(ref int, int, int)"/> latch makes that true even if two callers
    /// enumerate concurrently, which nothing in this tree does but which the type does not forbid either.
    ///
    /// <para><b>A driver disposed before it was ever enumerated never does this work at all</b>, which is the
    /// point of moving it: the cost is paid by the caller that actually reads, on that caller's thread, and
    /// not by whoever happened to be holding the fleet lock at construction time.</para></summary>
    private void EnsureStarted()
    {
        if (Interlocked.CompareExchange(ref _started, 1, 0) != 0) return;
        if (_disposed) return;

        Directory.CreateDirectory(_watchDir);
        Directory.CreateDirectory(_archiveDir);
        Directory.CreateDirectory(_errorDir);

        var watcher = TryCreateWatcher();
        _watcher = watcher;
        if (watcher is null)
        {
            // One of the three states this driver's Health member documents as reported Connected while a
            // reader would not call it connected. It stays Connected — narrowing Health is a behaviour change
            // item 48 records as not taken — but it is no longer invisible to a caller that wired a sink.
            Report($"watcher unavailable for '{_watchDir}' — falling back to the {PollInterval.TotalMilliseconds:F0} ms poll; Health still reads Connected");
        }

        // Disposal may have raced the work above; undo it rather than leave a live handle behind.
        if (_disposed)
        {
            _watcher = null;
            watcher?.Dispose();
        }
    }

    /// <summary>Hands one line to the caller's sink, if there is one. A sink that throws is contained: this is
    /// called from inside the read loop, where an exception out of a log call would end an enumeration that
    /// the actual file-system work had already survived.</summary>
    private void Report(string line)
    {
        var sink = _diagnostics;
        if (sink is null) return;
        try { sink(line); }
        catch { /* a broken sink must not end the read loop it is describing */ }
    }

    /// <summary>Flattens a validation failure into one line: its own message, plus the inner exception's type
    /// and message when it has one. <c>Doc28Parser</c> wraps the underlying JSON reader failure as an inner
    /// exception on exactly one of its throw sites, and that is the site whose detail is worth the most —
    /// "invalid JSON" without the parser's own position says very little.</summary>
    private static string Describe(Doc28ValidationException ex) =>
        ex.InnerException is { } inner
            ? $"{ex.Message} (inner {inner.GetType().Name}: {inner.Message})"
            : ex.Message;

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

    /// <summary>Nudges a reader parked in <see cref="WaitForWakeOrPollTickAsync"/>. Called from the
    /// watcher's event handlers (to shorten pickup latency) and from <see cref="DisposeAsync"/> (to end the
    /// loop at once). The <c>CurrentCount == 0</c> test only keeps the count from growing without bound
    /// under a burst of file-system events; a lost race there costs a single extra permit, which the very
    /// next loop pass consumes harmlessly.
    ///
    /// <para>The <see cref="ObjectDisposedException"/> catch is a belt-and-braces guard, NOT a live path:
    /// <see cref="DisposeAsync"/> deliberately never disposes <c>_wake</c> (see its own doc comment for the
    /// measured reason), so nothing in this class can put the semaphore into a disposed state. It stays so
    /// that re-introducing a <c>Dispose</c> call cannot turn a file-system event into a thrown exception on
    /// a watcher callback thread.</para></summary>
    private void SignalWake()
    {
        if (_wake.CurrentCount == 0)
        {
            try { _wake.Release(); }
            catch (ObjectDisposedException) { /* see this method's own doc comment — not a live path */ }
        }
    }

    /// <summary>
    /// 🔴 <b><see cref="_wake"/> is deliberately NOT disposed, and that single omission is the whole fix for
    /// a defect that wedged an entire test assembly for 900 s at a time.</b>
    ///
    /// <para><b>The mechanism, measured rather than reasoned about.</b>
    /// <see cref="SemaphoreSlim.Dispose()"/> clears the semaphore's queue of pending ASYNC waiters
    /// (<c>m_asyncHead</c>/<c>m_asyncTail</c>) <b>without completing them</b>. When the waiting side's own
    /// token then fires, <c>WaitUntilCountOrTimeoutAsync</c> asks <c>RemoveAsyncWaiter</c> whether its node
    /// is still in the list; it is not (dispose emptied the list), so instead of throwing
    /// <see cref="OperationCanceledException"/> it falls through to <c>return await asyncWaiter</c> — an
    /// awaited task that nothing will ever complete. A standalone probe on this exact runtime measured
    /// <b>200/200</b> permanently-stranded awaits for "park a waiter, dispose the semaphore, then let the
    /// waiter's own token fire" — this is deterministic, not a rare race.</para>
    ///
    /// <para><b>What that cost here.</b> <see cref="ReadAsync"/> parks in
    /// <see cref="WaitForWakeOrPollTickAsync"/> for all but a few microseconds of every
    /// <see cref="PollInterval"/>, so a <see cref="DisposeAsync"/> landing on an idle driver stranded the
    /// enumeration <b>permanently</b>: no exception, no cancellation, no completion — an
    /// <c>await foreach</c> that can never end and that no <see cref="CancellationToken"/> can reach,
    /// because the cancellation path is precisely the path that gets swallowed. In the suite that showed up
    /// as <c>HotFolderAoiDriverConformanceTests.DisposeAsync_IsIdempotent_AfterCancellation</c> never
    /// returning, which held the assembly's parallel phase open forever and so kept the two
    /// <c>DisableParallelization</c> collections (Site, OpcUa — 122 tests) from ever starting. See
    /// <c>.superpowers/sdd/backlog-test-deadlines/edgecore-host-crash-report.md</c>.
    /// <b>In production the same disposal happens on every connector stop/reconfigure</b>
    /// (<c>FleetHost</c> cancels, then disposes on a bounded budget), so each one leaked a permanently
    /// parked read loop.</para>
    ///
    /// <para><b>Why not disposing is correct, not a shortcut.</b> Two siblings in this same assembly already
    /// reached the same conclusion for the same reason and say so in their own code:
    /// <see cref="St4i.EdgeCore.Site.SiteBridgeManager"/> ("deliberately NOT calling <c>_gate.Dispose()</c>")
    /// and <see cref="St4i.EdgeCore.Drivers.Modbus.ModbusBus"/> ("the arbitration semaphore itself is NOT
    /// disposed"). A <see cref="SemaphoreSlim"/> owns exactly one disposable thing — the
    /// <see cref="SemaphoreSlim.AvailableWaitHandle"/> it allocates LAZILY on first access. This class never
    /// touches that property (only <see cref="SemaphoreSlim.WaitAsync(CancellationToken)"/> and
    /// <see cref="SemaphoreSlim.Release()"/>), so there is nothing for <c>Dispose</c> to free and it has no
    /// finalizer to suppress. Skipping it releases no resource later and strands no caller now.</para>
    ///
    /// <para><b>The <see cref="SignalWake"/> below is the fast path, not the guarantee.</b> It releases the
    /// semaphore so a parked reader wakes immediately, re-tests <c>while (!_disposed)</c> and leaves at once
    /// rather than waiting out up to one <see cref="PollInterval"/>. Even if that release were removed, the
    /// reader's own <c>linked.CancelAfter(PollInterval)</c> now genuinely ends the wait within 120 ms —
    /// which it could NOT do while the semaphore was being disposed underneath it. That is the difference
    /// between a bounded teardown and an unbounded one.</para>
    /// </summary>
    public ValueTask DisposeAsync()
    {
        if (_disposed) return ValueTask.CompletedTask;
        _disposed = true;
        Health = DriverHealthState.Down;
        _watcher?.Dispose();
        SignalWake();
        return ValueTask.CompletedTask;
    }
}
