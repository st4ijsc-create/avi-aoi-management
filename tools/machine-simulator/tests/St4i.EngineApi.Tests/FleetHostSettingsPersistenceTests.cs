using St4i.EdgeCore.Config;
using St4i.EdgeCore.Infrastructure;
using St4i.EdgeCore.Models;
using St4i.EdgeCore.Transport;
using St4i.EngineApi.Fleet;
using Xunit;

namespace St4i.EngineApi.Tests;

/// <summary>
/// FF-1 (docs/plans/2026-07-27-ws-ff-fast-follows.md) — proves <see cref="FleetHost.UpdateSettings"/>
/// persists serverUrl/machineCode/verifyTls through a <see cref="FleetSettingsStore"/>, and that a FRESH
/// <see cref="FleetHost"/> pointed at the SAME settings directory picks the persisted values back up on
/// construction — the in-process analogue of a real process restart, same "new store pointed at the same
/// directory" technique <c>MachineConfigStoreTests</c>/<c>OeeSettingsStoreTests</c> already use for their
/// own restart-survival tests. No ASP.NET host involved here (unlike
/// <see cref="FleetSettingsPersistenceEnvVarTests"/>, which covers the SAME contract end-to-end through
/// the real <c>Program.cs</c> composition root, plus the env-var-vs-persisted-file precedence decision
/// that lives there, not in <see cref="FleetHost"/> itself).
/// </summary>
public sealed class FleetHostSettingsPersistenceTests
{
    private static string TempDir() => Directory.CreateTempSubdirectory("st4i-fleethost-settings-tests-").FullName;

    /// <summary>Same Demo-mode-only composition as <see cref="FleetHostHealthAndRegistrationTests.CreateHost"/>
    /// (no real network ever touched) plus an explicit, per-call <see cref="WalOptions.Directory"/> pointed
    /// at a temp dir — required because <see cref="FleetHost.UpdateSettings"/> triggers
    /// <see cref="TransportCoordinator.RebuildLive"/>, which (with the DEFAULT <see cref="WalOptions"/>)
    /// would otherwise create/touch the real <c>%ProgramData%\ST4I\sim\wal</c> directory, exactly the
    /// "isolate tests from the real machine" precaution <c>SettingsWalPreservationTests</c> already takes.</summary>
    private static (SwitchableTransport Switchable, TransportCoordinator Coordinator) BuildTransport(string walDir)
    {
        var wal = new WalOptions { Directory = walDir };
        var demo = new DemoTransport(latencyMs: 0);
        var live = LiveTransport.ForMachine("http://localhost:1", mkKey: "", machineCode: "TEST", queuePath: null, verifyTls: true);
        var auto = new AutoTransport(live, demo);
        var switchable = new SwitchableTransport(demo);
        var coordinator = new TransportCoordinator(switchable, demo, live, auto, TransportMode.Demo, wal);
        return (switchable, coordinator);
    }

    [Fact]
    public void UpdateSettings_PersistsChange_AndAFreshFleetHost_PointedAtSameDir_PicksItUpOnConstruction()
    {
        var settingsDir = TempDir();
        var machineCode = "FF1-FH-RESTART-" + Guid.NewGuid().ToString("N")[..8];

        var store1 = new FleetSettingsStore(settingsDir);
        var (switchable1, coordinator1) = BuildTransport(TempDir());
        var host1 = new FleetHost(switchable1, coordinator1, new EventBus(), settingsStore: store1);

        var updated = host1.UpdateSettings(new SettingsUpdateRequest(
            ServerUrl: "http://ff1-fh-restart.example.test:6001",
            VerifyTls: false,
            Language: null,
            MachineCode: machineCode));
        Assert.Equal("http://ff1-fh-restart.example.test:6001", updated.ServerUrl);
        Assert.Equal(machineCode, updated.MachineCode);
        Assert.False(updated.VerifyTls);

        // A FRESH FleetHost, fresh transport wiring — but a fresh FleetSettingsStore pointed at the SAME
        // settings directory, "simulating a process restart" exactly like MachineConfigStoreTests'
        // State_survives_a_fresh_store_instance_pointed_at_the_same_directory does.
        var store2 = new FleetSettingsStore(settingsDir);
        var (switchable2, coordinator2) = BuildTransport(TempDir());
        var host2 = new FleetHost(switchable2, coordinator2, new EventBus(), settingsStore: store2);

        var settings = host2.GetSettings();
        Assert.Equal("http://ff1-fh-restart.example.test:6001", settings.ServerUrl);
        Assert.Equal(machineCode, settings.MachineCode);
        Assert.False(settings.VerifyTls);
    }

    [Fact]
    public void NoSettingsStore_UpdateSettings_StillWorks_JustNothingSurvivesRestart()
    {
        // Every pre-existing FleetHost test constructs it with no settingsStore at all — pins that
        // contract explicitly: UpdateSettings must keep working exactly as before (in-memory only, no
        // exception) when there's nothing to persist to.
        var (switchable, coordinator) = BuildTransport(TempDir());
        var host = new FleetHost(switchable, coordinator, new EventBus());

        var updated = host.UpdateSettings(new SettingsUpdateRequest(
            ServerUrl: "http://no-store.example.test", VerifyTls: null, Language: null, MachineCode: null));
        Assert.Equal("http://no-store.example.test", updated.ServerUrl);
    }

    [Fact]
    public void LanguageOnlyChange_NeverWritesToTheSettingsStore()
    {
        var settingsDir = TempDir();
        var store = new FleetSettingsStore(settingsDir);
        var (switchable, coordinator) = BuildTransport(TempDir());
        var host = new FleetHost(switchable, coordinator, new EventBus(), settingsStore: store);

        host.UpdateSettings(new SettingsUpdateRequest(ServerUrl: null, VerifyTls: null, Language: "vi", MachineCode: null));

        // Only language moved — serverUrl/machineCode/verifyTls never changed, so nothing should ever have
        // been written to disk. Also proves language itself is never a persisted field (FleetSettingsStore/
        // PersistedFleetSettings has no property for it at all).
        Assert.Null(store.Load());
    }

    [Fact]
    public void NoPersistedFileYet_FreshFleetHost_KeepsItsOwnBuiltInDefaults()
    {
        // A settingsStore pointed at an empty directory (no fleet-settings.json ever written) must not
        // perturb FleetHost's own built-in defaults — this is the "brand-new install" case.
        var store = new FleetSettingsStore(TempDir());
        var (switchable, coordinator) = BuildTransport(TempDir());
        var host = new FleetHost(switchable, coordinator, new EventBus(), settingsStore: store);

        var settings = host.GetSettings();
        Assert.Equal(FleetHost.DefaultServerUrl, settings.ServerUrl);
        Assert.Equal(FleetHost.DefaultMachineCode, settings.MachineCode);
        Assert.True(settings.VerifyTls);
    }

    // SM-3 — an operator explicitly clearing the Server URL field (or a brand-new install, whose
    // in-memory default IS already "") must be a legitimate "standalone, no ecosystem" state, never a
    // crash. Before SM-3's LiveTransport.ForMachine guard, an empty serverUrl reaching the vendored
    // St4iDeviceClient ctor via RebuildLive threw St4iConfigException synchronously out of
    // UpdateSettings — this proves that path is safe now, and that the empty value round-trips through
    // persistence unmangled (never silently coerced back to some non-empty default).
    [Fact]
    public void UpdateSettings_ExplicitEmptyServerUrl_MeansStandalone_DoesNotThrow_AndPersists()
    {
        var settingsDir = TempDir();
        var store = new FleetSettingsStore(settingsDir);
        var (switchable, coordinator) = BuildTransport(TempDir());
        var host = new FleetHost(switchable, coordinator, new EventBus(), settingsStore: store);

        // Seed a real, non-empty serverUrl first, exactly like an operator who connects then later
        // decides to disconnect — proves this is a genuine, reachable transition, not just "never set".
        host.UpdateSettings(new SettingsUpdateRequest(
            ServerUrl: "http://was-connected.example.test", VerifyTls: null, Language: null, MachineCode: null));

        var updated = host.UpdateSettings(new SettingsUpdateRequest(
            ServerUrl: "", VerifyTls: null, Language: null, MachineCode: null));

        Assert.Equal("", updated.ServerUrl);
        Assert.Equal("", host.GetSettings().ServerUrl);
        Assert.Equal("", store.Load()!.ServerUrl);
    }
}
