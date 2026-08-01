using St4i.EdgeCore.Models;
using St4i.EdgeCore.Transport;

namespace St4i.EngineApi.Config;

/// <summary>
/// Task C3 — composition-root helper for config-sync, mirroring
/// <see cref="St4i.EdgeCore.Transport.TransportCoordinator"/>'s role one layer up: the single place that
/// knows how to point <see cref="SwitchableConfigSyncBackend"/> at Demo (<see cref="SimulatedEcosystem"/>)
/// or Live (<see cref="LiveConfigSyncBackend"/>) for the CURRENT <see cref="TransportMode"/>, and how to
/// rebuild the held <see cref="LiveConfigSyncBackend"/> when Settings changes serverUrl/machineCode/mk_.
///
/// Deliberately NOT a per-call retry/fallback dance like <see cref="AutoTransport"/> — config-sync calls
/// are low-frequency and user-initiated (an operator clicking Pull/Push), not a hot per-cycle send path,
/// and <see cref="IConfigSyncBackend"/>'s methods have no shared "did this fail because the network is
/// down" signal to hook a retry off of the way <see cref="TransportAck"/>/<see cref="HeartbeatResult"/>/
/// <see cref="ConfigSyncResult"/> do. Instead, Auto is a STATIC per-rebuild decision — resolves to Live
/// only when the held <see cref="LiveConfigSyncBackend.IsConfigured"/> (a serverUrl AND a stored mk_ are
/// both present), else Demo — exactly the plan's own "Auto = Live if a server+key are configured else
/// Demo" wording.
/// </summary>
public sealed class ConfigSyncCoordinator
{
    private readonly object _gate = new();
    private readonly SwitchableConfigSyncBackend _switchable;
    private readonly SimulatedEcosystem _demo;

    private LiveConfigSyncBackend _live;

    public ConfigSyncCoordinator(SwitchableConfigSyncBackend switchable, SimulatedEcosystem demo, LiveConfigSyncBackend initialLive)
    {
        _switchable = switchable ?? throw new ArgumentNullException(nameof(switchable));
        _demo = demo ?? throw new ArgumentNullException(nameof(demo));
        _live = initialLive ?? throw new ArgumentNullException(nameof(initialLive));
    }

    /// <summary>The <see cref="LiveConfigSyncBackend"/> currently held — exposed so a caller (e.g. a
    /// future diagnostics endpoint) can inspect <see cref="LiveConfigSyncBackend.IsConfigured"/> without
    /// this class needing to duplicate that state.</summary>
    public LiveConfigSyncBackend Live
    {
        get { lock (_gate) return _live; }
    }

    /// <summary>Re-points <see cref="SwitchableConfigSyncBackend"/> at Demo/Live for <paramref
    /// name="mode"/>, using whichever <see cref="LiveConfigSyncBackend"/> is currently held (call
    /// <see cref="RebuildLive"/> first if connection settings just changed). Idempotent/cheap — safe to
    /// call on every <c>TransportCoordinator.ModeChanged</c>-equivalent transition.</summary>
    public void ApplyMode(TransportMode mode)
    {
        IConfigSyncBackend target;
        lock (_gate)
        {
            target = mode switch
            {
                TransportMode.Live => _live,
                TransportMode.Auto => _live.IsConfigured ? _live : (IConfigSyncBackend)_demo,
                _ => _demo,
            };
        }

        _switchable.SetInner(target);
    }

    /// <summary>Rebuilds the held <see cref="LiveConfigSyncBackend"/> from fresh connection settings —
    /// mirrors <see cref="TransportCoordinator.RebuildLive"/> exactly, including disposing the REPLACED
    /// instance only after re-pointing the switchable at the fresh one (so no in-flight call can observe
    /// a disposed <see cref="HttpClient"/>). <paramref name="currentMode"/> is the app's current
    /// Live/Demo/Auto mode (read from <c>FleetHost.Mode</c>/<c>TransportCoordinator.Mode</c> by the
    /// caller) — re-applied only when it's Live or Auto, same as the transport side.</summary>
    public void RebuildLive(string serverUrl, string machineCode, string? mkKey, bool verifyTls, TransportMode currentMode)
    {
        var newLive = LiveConfigSyncBackend.ForMachine(serverUrl, mkKey, machineCode, verifyTls);

        LiveConfigSyncBackend oldLive;
        lock (_gate)
        {
            oldLive = _live;
            _live = newLive;
        }

        if (currentMode is TransportMode.Live or TransportMode.Auto)
        {
            ApplyMode(currentMode);
        }

        oldLive.Dispose();
    }
}
