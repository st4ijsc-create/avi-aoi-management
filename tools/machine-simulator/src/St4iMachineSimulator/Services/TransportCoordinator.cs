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
    /// what is actively serving traffic.
    /// </summary>
    public void RebuildLive(string serverUrl, string machineCode, string? mkKey, bool verifyTls)
    {
        var newLive = LiveTransport.ForMachine(serverUrl, mkKey ?? string.Empty, machineCode, null, verifyTls);
        var newAuto = new AutoTransport(newLive, _demo);

        lock (_gate)
        {
            _auto.FallbackChanged -= OnFallbackChanged;
            _live = newLive;
            _auto = newAuto;
            _auto.FallbackChanged += OnFallbackChanged;
        }

        if (Mode is TransportMode.Live or TransportMode.Auto)
        {
            ApplyModeInternal(Mode);
        }
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
