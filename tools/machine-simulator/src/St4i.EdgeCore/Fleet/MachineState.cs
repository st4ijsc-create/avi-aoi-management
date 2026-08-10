using St4i.EdgeCore.Models;
using St4i.Connector.Abstractions.Models;

namespace St4i.EdgeCore.Fleet;

/// <summary>
/// Thread-safe, per-machine live state accumulated from every <see cref="EdgePipeline.Committed"/>
/// reading — the headless-host analogue of the WPF app's <c>MachineViewModel</c> (Task 16), just
/// without any WPF/ObservableCollection/dispatcher dependency: every mutation happens under
/// <see cref="_gate"/>, and every read-out method (<see cref="SnapshotTile"/>/<see cref="SnapshotDetail"/>)
/// takes a short-lived snapshot under the same lock so a concurrent HTTP GET never observes a torn state.
///
/// <para>🔴 <b>Task E-2 (blueprint §9.6(a)) — this file MOVED from <c>St4i.EngineApi/Fleet/</c> and was
/// SPLIT in the process, because <c>MachineState.cs</c> and <c>Dtos.cs</c> hooked into each other in BOTH
/// directions:</b> this class returned <c>FleetTileDto</c>/<c>MachineDetailDto</c> (declared in
/// <c>Dtos.cs</c>) while <c>Dtos.cs</c>'s <c>MachineDetailDto</c> consumed <c>CycleLogEntry</c>/
/// <c>TelemetrySeriesDto</c>/<c>SpcSummaryDto</c>/<c>BoardPointDto</c> (declared in THIS file). §4's
/// "leave the DTOs behind" decision only stands once that cycle is cut. It is cut here: the four
/// projection records left with the DTOs, the two <c>To*</c> methods became
/// <see cref="SnapshotTile"/>/<see cref="SnapshotDetail"/> returning the DOMAIN records in
/// <c>FleetSnapshots.cs</c>, and <c>St4i.EngineApi.Fleet.FleetProjections</c> (extension methods,
/// so every existing <c>state.ToTile()</c>/<c>state.ToDetail()</c> call site compiles unchanged) maps
/// those onto the wire DTOs. This assembly now names no web shape at all; the edge is one-way.</para>
/// </summary>
public sealed class MachineState
{
    /// <summary>E1: the status value a tile/detail reports before its first cycle — and, since E1,
    /// also the value <see cref="ToTile(bool)"/> reports whenever the fleet pipeline isn't running,
    /// regardless of the last real verdict. Already understood by the web UI's <c>MachineCard</c>
    /// <c>STATUS_META</c> map (neutral badge, "status.idle" label) — no new status vocabulary needed.</summary>
    private const string IdleStatusText = "Idle";

    /// <summary>Sparkline depth — same cap as the WPF dashboard tile's Spark collection.</summary>
    private const int MaxSparkPoints = 30;

    /// <summary>SPC/telemetry chart depth — same cap as the WPF Machine Detail screen's chart buffers.</summary>
    private const int MaxChartPoints = 50;

    /// <summary>Cycle log depth — same cap as the WPF Machine Detail screen's DataGrid.</summary>
    private const int MaxCycleLogRows = 200;

    private readonly object _gate = new();

    private readonly List<double> _spark = new();
    private readonly List<double> _spcValues = new();
    private readonly Dictionary<string, List<double>> _telemetry = new(StringComparer.OrdinalIgnoreCase);
    private IReadOnlyList<MeasurementResult> _boardPoints = Array.Empty<MeasurementResult>();
    private readonly List<MachineCycleRecord> _cycleLog = new();

    /// <summary>WS3-T1 — the latest reading's cycle plan (or null for a machine type this task doesn't
    /// wire a plan for), surfaced on <c>GET /v1/machines/{code}</c> — the SAME per-machine polled surface
    /// the HMI panel already reads (<c>useMachine</c>, ~1s), chosen as the lightest place to expose this:
    /// no new endpoint, no socket-shape change. Replaced wholesale on every <see cref="ApplyReading"/>
    /// call (never accumulated), mirroring <see cref="_boardPoints"/>'s own "always exactly the LATEST
    /// cycle's worth" contract. Gated to null on the exposed DTO whenever the fleet isn't running (see
    /// <see cref="ToDetail(bool)"/>) — "idle machine = no active plan".</summary>
    private CyclePlan? _currentPlan;

    private long _passCount;
    private long _judgedCount;
    private string? _cachedConfigVersion;

    /// <summary>Folded-in high-water mark from every RAW counter reset observed so far (final-review
    /// I-1) — see <see cref="_lastRawCycleCounter"/>'s remarks for why this exists.</summary>
    private long _cycleOffset;

    /// <summary>The last RAW <see cref="DeviceReading.CycleCounter"/> seen (i.e. straight off
    /// <c>St4i.EdgeCore.Drivers.SimulatedDriver</c>, NOT the offset-adjusted <see cref="Cycles"/>
    /// below) — tracked so <see cref="ApplyReading"/> can detect a driver restart
    /// (<c>FleetCore.ApplyScenario</c>'s <c>StopLocked()</c> + <c>RebuildPipelineOffLock</c> on a
    /// cycle-rate/scenario change builds a brand-new <c>SimulatedDriver</c> whose per-machine counters reset
    /// to 0 — 🔴 task J-1 changed that call shape from <c>StopLocked()+StartLocked()</c>, and the property
    /// asserted here is UNAFFECTED because a plan is built per start and never outlives one, so no simulator
    /// instance survives a restart to carry a counter across it) purely
    /// from the counter going backwards, with no dependency on FleetHost telling this class a restart
    /// happened.</summary>
    private long _lastRawCycleCounter;

    public MachineState(MachineDescriptor descriptor)
    {
        Descriptor = descriptor ?? throw new ArgumentNullException(nameof(descriptor));
    }

    public MachineDescriptor Descriptor { get; }

    public string Code => Descriptor.Code;

    public string StatusText { get; private set; } = IdleStatusText;

    /// <summary>Running pass rate in [0,1] — Pass and Warn both count as "success" (mirrors
    /// Normalizer.ComputeOverallResult treating Warn as OK); Telemetry readings are excluded entirely.</summary>
    public double PassRate { get; private set; }

    public long Cycles { get; private set; }

    public string LastCycleSummary { get; private set; } = "—";

    /// <summary>Human-readable outcome of the last sync-config call — "—" until one has run this
    /// session, same contract as the WPF app's <c>MachineViewModel.DriftState</c>.</summary>
    public string DriftState { get; private set; } = "—";

    public string? CachedConfigVersion { get { lock (_gate) return _cachedConfigVersion; } }

    /// <summary>Applies one committed reading — the SAME per-reading logic the WPF app's
    /// <c>MachineViewModel.ApplyReading</c>/<c>FleetViewModel.OnCommitted</c> apply, just under a plain
    /// lock instead of a UI-thread dispatch.</summary>
    public void ApplyReading(DeviceReading reading, TransportAck ack)
    {
        lock (_gate)
        {
            // Final-review I-1: a speed-slider/scenario-preset change restarts the fleet's driver, which
            // resets the RAW per-machine cycle counter back toward 1 — without this, the DISPLAYED
            // Cycles (and every tile's spark/summary derived from it) would visibly rewind on the
            // dashboard even though the fleet-wide KPI total (FleetCore._totalCycles, Interlocked and
            // never reset by Stop/Start) keeps climbing. Detect the restart purely from the raw counter
            // going backwards and fold the pre-restart high-water mark into a running offset, so the
            // number a visitor is watching only ever climbs.
            var rawCycleCounter = reading.CycleCounter;
            if (rawCycleCounter < _lastRawCycleCounter)
            {
                _cycleOffset += _lastRawCycleCounter;
            }

            _lastRawCycleCounter = rawCycleCounter;
            Cycles = _cycleOffset + rawCycleCounter;

            if (reading.Verdict != Verdict.Skip)
            {
                _judgedCount++;
                if (reading.Verdict is Verdict.Pass or Verdict.Warn) _passCount++;
                PassRate = _judgedCount == 0 ? 0.0 : (double)_passCount / _judgedCount;
            }

            StatusText = reading.Verdict switch
            {
                Verdict.Fail => "FAIL",
                Verdict.Warn => "WARN",
                Verdict.Skip => "TELEMETRY",
                _ => "OK",
            };

            LastCycleSummary = BuildSummary(reading, ack);

            _spark.Add(SparkValue(reading));
            TrimFront(_spark, MaxSparkPoints);

            if (reading.Metrics.Count > 0)
            {
                _spcValues.Add(reading.Metrics[0].Value);
                TrimFront(_spcValues, MaxChartPoints);
            }

            foreach (var sample in reading.Telemetry)
            {
                // GĐ3 sub-3 OU-2 PART A — the REQUIRED gate OU-1's review flagged: the old
                // `is not IConvertible ... ToDouble(null)` pattern crashed on a non-numeric string tag
                // (e.g. an OPC-UA "status" node → "RUNNING" — string IS IConvertible, so
                // Convert.ToDouble("RUNNING") threw a FormatException straight out of
                // FleetCore.OnPipelineCommitted, killing that machine's whole pipeline slot). The shared
                // TelemetryNumeric helper never throws: a genuinely-numeric value (or a numeric string
                // like "42.5") is kept exactly as before; a non-numeric string/anything else is skipped.
                if (!TelemetryNumeric.TryGet(sample.Value, out var numeric)) continue;

                if (!_telemetry.TryGetValue(sample.Metric, out var series))
                {
                    series = new List<double>();
                    _telemetry[sample.Metric] = series;
                }

                series.Add(numeric);
                TrimFront(series, MaxChartPoints);
            }

            if (reading.Kind == ReadingKind.Inspection && reading.Measurements.Count > 0)
            {
                // Replaced wholesale on every inspection reading, not accumulated — mirrors
                // MachineViewModel.BoardPoints' "always exactly one board's worth" contract.
                _boardPoints = reading.Measurements.ToList();
            }

            // WS3-T1 — always replaced wholesale (null included) with THIS reading's own plan, never
            // accumulated: an idle-equivalent reading kind/simulator (or a machine with no product
            // configured for AOI) legitimately has no plan this cycle, and the exposed DTO must reflect
            // that rather than keep showing a stale plan from several cycles ago.
            _currentPlan = reading.Plan;

            _cycleLog.Add(new MachineCycleRecord(reading.Timestamp, reading.SerialNumber, reading.Verdict.ToString(), FormatKeyMetric(reading)));
            TrimFront(_cycleLog, MaxCycleLogRows);
        }
    }

    /// <summary>Records the outcome of a <c>POST /v1/machines/{code}/sync-config</c> call — mirrors
    /// <c>MachineViewModel.SyncConfigAsync</c>'s success path.</summary>
    public void ApplyConfigSync(ConfigSyncResult result)
    {
        lock (_gate)
        {
            _cachedConfigVersion = result.Version;
            DriftState = BuildDriftStateText(result);
        }
    }

    public void ApplyConfigSyncError(string message)
    {
        lock (_gate)
        {
            DriftState = $"ERROR: {message}";
        }
    }

    /// <summary>Snapshot for one <c>GET /v1/fleet</c> row. E1 (health-truth): when the fleet pipeline is
    /// NOT running, <paramref name="fleetRunning"/> is false and the reported status is forced to
    /// <see cref="IdleStatusText"/> regardless of the last real verdict — otherwise a stopped fleet keeps
    /// showing every tile as whatever it last was (e.g. "OK"/green), which is exactly the "always
    /// healthy after Stop" bug this exists to fix. <see cref="Cycles"/>/<see cref="PassRate"/>/
    /// <see cref="LastCycleSummary"/>/the spark line are left untouched either way: a machine that ran
    /// then stopped should still show its last-known counters, just flagged idle instead of live.
    ///
    /// <para>E-2: was <c>ToTile(bool)</c> returning <c>FleetTileDto</c>. Same lock, same fields, same
    /// order — only the return SHAPE changed, from the wire DTO to the domain record. The DTO overloads
    /// (<c>ToTile()</c>/<c>ToTile(bool)</c>) live on as extension methods in
    /// <c>St4i.EngineApi.Fleet.FleetProjections</c>.</para></summary>
    public MachineTileSnapshot SnapshotTile(bool fleetRunning)
    {
        lock (_gate)
        {
            return new MachineTileSnapshot(
                Code,
                Descriptor.DeviceClass,
                Descriptor.DriverKind,
                fleetRunning ? StatusText : IdleStatusText,
                PassRate,
                Cycles,
                LastCycleSummary,
                _spark.ToArray());
        }
    }

    /// <summary>Snapshot for <c>GET /v1/machines/{code}</c>. Branch-review I-9: when the fleet pipeline
    /// is NOT running, <paramref name="fleetRunning"/> is false and the reported <c>StatusText</c> is
    /// forced to <see cref="IdleStatusText"/> regardless of the last real verdict — the exact same gate
    /// <see cref="SnapshotTile(bool)"/> already applies. Before this, <c>ToDetail()</c> was the one
    /// snapshot that skipped the gate, so a stopped machine kept reporting its last real verdict (e.g.
    /// "OK") to this endpoint even while <c>GET /v1/fleet</c> correctly reported it idle — reproduced
    /// live as a stopped machine's detail page/HMI panel rendering a green "ĐẠT" pass badge. Every other
    /// field (Cycles/PassRate/board points/cycle log/telemetry/SPC) is left untouched either way, same as
    /// <see cref="SnapshotTile(bool)"/>'s own contract.
    ///
    /// <para>E-2: board points are handed back as the raw <see cref="MeasurementResult"/>s this class
    /// already stores — the shell's own projection is what narrows them to a <c>BoardPointDto</c>. That
    /// is deliberate: inventing a domain twin of a four-field DTO here would have been a second shape to
    /// keep in step, and the reading's own measurement type is already a shared abstraction.</para></summary>
    public MachineDetailSnapshot SnapshotDetail(bool fleetRunning)
    {
        lock (_gate)
        {
            var spc = BuildSpcSummary(_spcValues);
            var telemetry = _telemetry.Count == 0
                ? Array.Empty<MachineTelemetrySeries>()
                : _telemetry.Select(kv => new MachineTelemetrySeries(kv.Key, kv.Value.ToArray())).ToArray();
            var boardPoints = _boardPoints.ToArray();

            return new MachineDetailSnapshot(
                Code,
                Descriptor.DeviceClass,
                Descriptor.DriverKind,
                fleetRunning ? StatusText : IdleStatusText,
                PassRate,
                Cycles,
                spc,
                telemetry,
                boardPoints,
                _cycleLog.ToArray(),
                DriftState,
                // WS3-T1 — "idle machine = no active plan, twin renders static": gated by the SAME
                // fleetRunning flag every other live-ness-sensitive field on this DTO already uses.
                fleetRunning ? _currentPlan : null);
        }
    }

    private static MachineSpcSummary BuildSpcSummary(List<double> values)
    {
        if (values.Count == 0) return new MachineSpcSummary(Array.Empty<double>(), 0.0, 0.0, 0.0);

        var mean = values.Average();
        var stdDev = values.Count > 1
            ? Math.Sqrt(values.Sum(v => (v - mean) * (v - mean)) / (values.Count - 1))
            : 0.0;
        return new MachineSpcSummary(values.ToArray(), mean, mean + 3 * stdDev, mean - 3 * stdDev);
    }

    private static void TrimFront<T>(List<T> list, int max)
    {
        while (list.Count > max) list.RemoveAt(0);
    }

    /// <summary>Same per-class fallback chain as the WPF app's <c>MachineViewModel.SparkValue</c>: first
    /// metric (process machines), first telemetry sample (IoT), else a 1/0 pass-fail step (AOI has no
    /// scalar Metrics).</summary>
    private static double SparkValue(DeviceReading reading)
    {
        if (reading.Metrics.Count > 0) return reading.Metrics[0].Value;

        // GĐ3 sub-3 OU-2 PART A — same TelemetryNumeric hardening as the telemetry-series loop above: a
        // non-numeric first telemetry sample (e.g. a status string) must fall through to the pass/fail
        // step below, never throw. A genuinely-numeric first sample (including a numeric string) keeps
        // resolving to exactly the same spark value as before this task.
        if (reading.Telemetry.Count > 0 && TelemetryNumeric.TryGet(reading.Telemetry[0].Value, out var numeric)) return numeric;

        return reading.Verdict == Verdict.Fail ? 0.0 : 1.0;
    }

    private static string FormatKeyMetric(DeviceReading reading)
    {
        if (reading.Metrics.Count > 0)
        {
            var m = reading.Metrics[0];
            return $"{m.Name}={m.Value:0.###}{m.Unit}";
        }

        if (reading.Telemetry.Count > 0)
        {
            var t = reading.Telemetry[0];
            return $"{t.Metric}={t.Value}{t.Unit}";
        }

        if (reading.Measurements.Count > 0)
        {
            var ngCount = reading.Measurements.Count(m => m.Result == "NG");
            return $"{reading.Measurements.Count} pts, {ngCount} NG";
        }

        return "—";
    }

    private static string BuildSummary(DeviceReading reading, TransportAck ack)
    {
        var kindLabel = reading.Kind switch
        {
            ReadingKind.Inspection => "Inspection",
            ReadingKind.Telemetry => "Telemetry",
            _ => "Process",
        };
        // WS-C-T4 fix — Queued must be checked FIRST: a real disk-buffered write (client-side WAL,
        // Success:false/Queued:true — see LiveTransport.SendAsync's St4iNetworkException handling) was
        // previously mislabeled "ERR" by the old !ack.Success-first ternary, even though it was
        // successfully queued for later replay, not actually failed. "queued" = server-side
        // store-forward accepted the write (Success:true/Queued:true); "buffered" = this machine's own
        // local WAL took it because the send itself failed (Success:false/Queued:true).
        var ackLabel = ack.Queued ? (ack.Success ? "queued" : "buffered")
                     : !ack.Success ? "ERR"
                     : ack.Duplicate ? "dup"
                     : "ok";
        return $"#{reading.CycleCounter} {kindLabel} · {reading.Verdict} · ack:{ackLabel}";
    }

    private static string BuildDriftStateText(ConfigSyncResult result)
    {
        var drift = result.DriftState ?? (result.Changed ? "changed" : "none");
        return $"{drift} · v{result.Version ?? "?"} · applied={result.Applied}";
    }
}
