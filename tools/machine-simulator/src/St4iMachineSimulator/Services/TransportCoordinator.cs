using St4i.EdgeCore.Models;
using St4i.EdgeCore.Transport;

namespace St4iMachineSimulator.Services;

/// <summary>
/// Task 19a composition-root helper — the single source of truth for the shell's Live/Demo/Auto
/// <see cref="Mode"/> and the one place that knows how to point the DI <see cref="SwitchableTransport"/>
/// singleton at the transport instance matching it. Both <c>AppShellViewModel</c> (the top-bar Mode
/// combo) and <c>SettingsViewModel</c> (the Settings screen's own Mode selector + connection fields)
/// depend on THIS class rather than on each other — avoids what would otherwise be a circular DI
/// dependency between the two ViewModels (Settings needs to switch Mode; the shell needs to show
/// Settings in its nav) — and gives both a single, always-consistent view of the current Mode via
/// <see cref="ModeChanged"/>.
/// </summary>
public sealed class TransportCoordinator
{
    private readonly object _gate = new();
    private readonly SwitchableTransport _switchable;
    private readonly DemoTransport _demo;

    private LiveTransport _live;
    private AutoTransport _auto;

    public TransportCoordinator(
        SwitchableTransport switchable,
        DemoTransport demo,
        LiveTransport initialLive,
        AutoTransport initialAuto,
        TransportMode initialMode)
    {
        _switchable = switchable ?? throw new ArgumentNullException(nameof(switchable));
        _demo = demo ?? throw new ArgumentNullException(nameof(demo));
        _live = initialLive ?? throw new ArgumentNullException(nameof(initialLive));
        _auto = initialAuto ?? throw new ArgumentNullException(nameof(initialAuto));
        _auto.FallbackChanged += OnFallbackChanged;

        Mode = initialMode;
        ApplyModeInternal(initialMode);
    }

    /// <summary>Fired whenever <see cref="AutoTransport.FallbackChanged"/> fires on whichever
    /// <see cref="AutoTransport"/> instance is CURRENTLY wired up — the subscription itself moves along
    /// when <see cref="RebuildLive"/> swaps in a fresh instance, so a subscriber here never has to
    /// re-hook itself after a Settings-triggered rebuild.</summary>
    public event Action<bool>? FallbackChanged;

    /// <summary>Fired whenever <see cref="Mode"/> actually changes value (never re-fired for setting it
    /// to what it already is — see <see cref="ApplyMode"/>), so dependent ViewModels can mirror it
    /// without re-triggering each other back and forth.</summary>
    public event Action<TransportMode>? ModeChanged;

    public TransportMode Mode { get; private set; }

    public DemoTransport Demo => _demo;

    public LiveTransport Live { get { lock (_gate) return _live; } }

    public AutoTransport Auto { get { lock (_gate) return _auto; } }

    /// <summary>
    /// Points the DI <see cref="SwitchableTransport"/> singleton at Demo/Live/Auto per <paramref
    /// name="mode"/>. Idempotent — always re-applies (cheap: a single field swap under
    /// <see cref="SwitchableTransport"/>'s own lock), but only raises <see cref="ModeChanged"/> when the
    /// value actually differs from the previous <see cref="Mode"/>.
    /// </summary>
    public void ApplyMode(TransportMode mode)
    {
        var changed = Mode != mode;
        Mode = mode;
        ApplyModeInternal(mode);
        if (changed) ModeChanged?.Invoke(mode);
    }

    /// <summary>
    /// Settings screen — rebuilds <see cref="LiveTransport"/> (and the <see cref="AutoTransport"/>
    /// wrapping it) from new connection settings (server URL / TLS verification / credential) and, if
    /// <see cref="Mode"/> is currently Live or Auto, re-points <see cref="SwitchableTransport"/> at the
    /// fresh instance so the change takes effect immediately. A rebuild while Mode is Demo still
    /// replaces the held Live/Auto instances (ready for the next switch to Live/Auto) without disturbing
    /// what is actively serving traffic. Disposes the REPLACED <see cref="LiveTransport"/> (releasing
    /// its wrapped <see cref="HttpClient"/>) once nothing new can be routed to it — see
    /// <see cref="LiveTransport.Dispose"/>'s remarks: Settings can call this once per keystroke
    /// (ServerUrl/MachineCode use <c>UpdateSourceTrigger=PropertyChanged</c>), so without this every
    /// edit would leak an HttpClient.
    /// </summary>
    public void RebuildLive(string serverUrl, string machineCode, string? mkKey, bool verifyTls)
    {
        var newLive = LiveTransport.ForMachine(serverUrl, mkKey ?? string.Empty, machineCode, null, verifyTls);
        var newAuto = new AutoTransport(newLive, _demo);

        LiveTransport oldLive;
        lock (_gate)
        {
            // Narrow, accepted race (same risk class as FleetService.Stop's CTS-disposal remarks):
            // AutoTransport fires FallbackChanged OUTSIDE its own internal lock (see its own
            // SetFallingBack remarks), so a call already in flight on the OLD _auto right as this
            // rebuild runs could still deliver one stray FallbackChanged notification after the
            // unsubscribe below (or, rarely, miss one) — delegate -=/Invoke is thread-safe (no crash;
            // Invoke captures its own snapshot), this is purely "at most one notification off" during a
            // Settings-triggered rebuild, not worth synchronizing further for this exhibition tool.
            _auto.FallbackChanged -= OnFallbackChanged;
            oldLive = _live;
            _live = newLive;
            _auto = newAuto;
            _auto.FallbackChanged += OnFallbackChanged;
        }

        // Re-point the switchable to the FRESH instance before disposing the old one, so any call that
        // arrives after this point never sees a disposed LiveTransport — the same narrow "already
        // in-flight before the rebuild started" window noted above is the only case that could still
        // observe the old client mid-disposal, and is accepted for the same reason.
        if (Mode is TransportMode.Live or TransportMode.Auto)
        {
            ApplyModeInternal(Mode);
        }

        oldLive.Dispose();
    }

    private void ApplyModeInternal(TransportMode mode)
    {
        ITransport target;
        lock (_gate)
        {
            target = mode switch
            {
                TransportMode.Live => _live,
                TransportMode.Auto => _auto,
                _ => _demo,
            };
        }

        _switchable.SetInner(target);
    }

    private void OnFallbackChanged(bool isFallingBack) => FallbackChanged?.Invoke(isFallingBack);
}
