using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using System.Text.Json.Serialization;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging;
using St4i.EdgeCore.Config;
using St4i.EdgeCore.Infrastructure;
using St4i.EngineApi.Fleet;
using St4i.EngineApi.Tests.Auth;
using Xunit;

namespace St4i.EngineApi.Tests;

/// <summary>
/// 🔴 <b>Task H-1a — a persisted settings triple that CANNOT be activated must leave the host UP, and the
/// operator must be told. This is the test that made the S6 closure legal.</b>
///
/// <para><b>Why this file exists at all.</b> <c>FleetHost.UpdateSettings</c> commits
/// serverUrl/machineCode/verifyTls under <c>FleetCore</c>'s lock and only then ACTIVATES them
/// (<c>CredentialStore.Load</c> → <c>RebuildLive</c> → host callback → persist). G-2 refused the uniform
/// S-set remedy — <c>Save</c> in a <c>finally</c> — for exactly one reason: <c>Program.cs</c> replays the
/// persisted triple back into that same method BEFORE <c>app.Run()</c>, unwrapped, so persisting a triple
/// that cannot be activated converted a recoverable runtime failure into a BOOT LOOP. Hardening the replay
/// is what removes the loop; the unconditional persist is what it then makes safe. This file measures the
/// first half, and it had to exist before the second half was written.</para>
///
/// <para>🔴 <b>The level is asserted, not just the text</b> — blueprint §10.4 turned into a requirement
/// rather than a lesson. <c>St4i.EngineApi</c> ships no <c>appsettings.json</c>, so the framework's own
/// default minimum applies: a <c>LogDebug</c> line on this path would not be quiet, it would be
/// <b>silent</b>, and "the host starts and says so" would be false while every string assertion stayed
/// green. The capturing provider below deliberately returns <c>IsEnabled(_) =&gt; true</c> — which is what
/// makes a level assertion NECESSARY rather than redundant, because a demoted call would still be captured.
/// A mutation from <c>LogError</c> to <c>LogDebug</c> is the one this pins.</para>
///
/// <para><b>What it does NOT measure, stated because the omission would otherwise be invisible.</b> It does
/// not prove the line reaches the Windows Event Log — nothing here runs under <c>AddWindowsService</c>, and
/// the Event Log claim rests on <c>AddEventLog</c>'s documented default filter (Warning and above), which
/// is read, not executed. What is measured is the property that claim depends on: the emitted level.</para>
///
/// <para>Same real-env-var-mutation technique and collection as <see cref="FleetSettingsPersistenceEnvVarTests"/>
/// — <c>Program.cs</c> reads every one of these variables straight off
/// <see cref="Environment.GetEnvironmentVariable(string)"/> with no <c>IConfiguration</c> seam, so two
/// factory boots racing at the same instant could cross-contaminate.</para>
/// </summary>
[Collection(SecurityEnvVarTests.CollectionName)]
public sealed class StartupSettingsReplayHardeningTests
{
    private static readonly SemaphoreSlim EnvLock = new(1, 1);

    private static readonly JsonSerializerOptions JsonOptions = new(JsonSerializerDefaults.Web)
    {
        Converters = { new JsonStringEnumConverter() },
    };

    /// <summary>The one shape of persisted file that reaches the throw: <c>machineCode</c> present but
    /// EMPTY. <c>CredentialStore.Load</c> starts with <c>ArgumentException.ThrowIfNullOrEmpty</c>, so this
    /// throws before touching the filesystem — a value-dependent failure, not an environmental one, which
    /// is the half that made the boot loop permanent rather than transient. Written as raw JSON on purpose:
    /// an operator hand-editing <c>fleet-settings.json</c> is the reachability this closes, and no
    /// <c>PUT /v1/settings</c> is involved.</summary>
    private static void WriteUnactivatableSettingsFile(string settingsDir, string serverUrl) =>
        File.WriteAllText(
            Path.Combine(settingsDir, "fleet-settings.json"),
            $$"""{"ServerUrl":"{{serverUrl}}","MachineCode":"","VerifyTls":false}""");

    private sealed record EnvOverrides(string? ServerUrl, string? MachineCode, string SettingsDir);

    private static async Task<WebApplicationFactory<Program>> CreateFactoryAsync(
        EnvOverrides overrides, List<(LogLevel Level, string Message)> capturedLog)
    {
        var securityDir = Directory.CreateTempSubdirectory("st4i-h1a-security-").FullName;
        var historianDir = Directory.CreateTempSubdirectory("st4i-h1a-historian-").FullName;
        var walDir = Directory.CreateTempSubdirectory("st4i-h1a-wal-").FullName;
        var identityDir = Directory.CreateTempSubdirectory("st4i-h1a-identity-").FullName;
        var siteLinkDir = Directory.CreateTempSubdirectory("st4i-h1a-sitelink-").FullName;
        var alarmsDir = Directory.CreateTempSubdirectory("st4i-h1a-alarms-").FullName;
        var bridgeSpoolDir = Directory.CreateTempSubdirectory("st4i-h1a-bridgespool-").FullName;
        var connectorConfigDir = Directory.CreateTempSubdirectory("st4i-h1a-connectorconfig-").FullName;
        // Isolated even though the failing path throws BEFORE any file read: the FALLBACK arm's
        // CredentialStore.Load(<a real machine code>) does reach the filesystem, and it must not read
        // (or create anything under) a real install's %ProgramData%\ST4I\sim\creds.
        var credsDir = Directory.CreateTempSubdirectory("st4i-h1a-creds-").FullName;

        await EnvLock.WaitAsync().ConfigureAwait(false);
        var previous = new Dictionary<string, string?>(StringComparer.Ordinal);
        void Set(string name, string? value)
        {
            previous[name] = Environment.GetEnvironmentVariable(name);
            Environment.SetEnvironmentVariable(name, value);
        }

        try
        {
            Set("ST4I_SECURITY_DIR", securityDir);
            Set("ST4I_DEMO_ENABLED", "true");
            Set("ST4I_HISTORIAN_DIR", historianDir);
            Set("ST4I_WAL_DIR", walDir);
            Set("ST4I_IDENTITY_DIR", identityDir);
            Set("ST4I_SITELINK_DIR", siteLinkDir);
            Set("ST4I_ALARMS_DIR", alarmsDir);
            Set("ST4I_BRIDGE_SPOOL_DIR", bridgeSpoolDir);
            Set("ST4I_CONNECTOR_CONFIG_DIR", connectorConfigDir);
            Set(CredentialStore.EnvVarDir, credsDir);
            Set(FleetSettingsStore.EnvVarDir, overrides.SettingsDir);
            Set("ASPNETCORE_ENVIRONMENT", "Production");
            Set("ST4I_SERVER_URL", overrides.ServerUrl);
            Set("ST4I_MACHINE_CODE", overrides.MachineCode);
            Set("ST4I_VERIFY_TLS", null);

            var factory = new WebApplicationFactory<Program>().WithWebHostBuilder(b =>
                b.ConfigureServices(services =>
                    services.AddSingleton<ILoggerProvider>(new CapturingLoggerProvider(capturedLog))));
            _ = factory.Server; // force the host to build NOW, while the env vars above are still set.
            return factory;
        }
        finally
        {
            foreach (var (name, value) in previous) Environment.SetEnvironmentVariable(name, value);
            EnvLock.Release();
        }
    }

    private const string ReplayFailureMarker = "STARTUP SETTINGS REPLAY FAILED";

    /// <summary>🔴 The load-bearing one. A hand-edited <c>fleet-settings.json</c> whose triple cannot be
    /// activated: the host must come UP (every endpoint answering, not just the process alive) and must
    /// have said so at a level the framework's default filter emits.</summary>
    [Fact]
    public async Task AnUnactivatablePersistedTriple_StillBootsTheHost_AndReportsItAtErrorLevel()
    {
        var settingsDir = Directory.CreateTempSubdirectory("st4i-h1a-settings-").FullName;
        WriteUnactivatableSettingsFile(settingsDir, "https://h1a-boot.example.test");
        var log = new List<(LogLevel Level, string Message)>();

        // No env floor at all — the ordinary desktop/service launch. The fallback replay is therefore a
        // no-op inside UpdateSettings, so this test measures the GUARD and nothing else.
        await using var factory = await CreateFactoryAsync(new EnvOverrides(null, null, settingsDir), log);

        // The host is UP: a real request over the real pipeline, not merely `factory.Server` not throwing.
        using var client = factory.CreateClient(new WebApplicationFactoryClientOptions { HandleCookies = true });
        using var response = await client.GetAsync("/v1/settings");
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);

        List<(LogLevel Level, string Message)> replayFailures;
        lock (log) replayFailures = log.Where(e => e.Message.Contains(ReplayFailureMarker, StringComparison.Ordinal)).ToList();

        Assert.True(replayFailures.Count > 0,
            "The host booted but said NOTHING about the persisted triple it could not apply. Silence here " +
            "is the whole defect: an operator sees a service that started and a configuration that is not " +
            "in effect, with no line anywhere joining the two. Captured lines: " +
            string.Join(" | ", log.Select(e => $"[{e.Level}] {e.Message}")));

        // §10.4, asserted rather than assumed: Debug/Trace emit NOTHING under the framework default
        // minimum (this product ships no appsettings.json), so a demotion would leave every text
        // assertion above green while the operator learned nothing.
        Assert.All(replayFailures, entry => Assert.Equal(LogLevel.Error, entry.Level));

        // It has to name the file an operator can actually repair, or "says so" is decoration.
        Assert.Contains(replayFailures, e => e.Message.Contains("fleet-settings.json", StringComparison.Ordinal));
    }

    /// <summary>🔴 The FALLBACK arm, which is a separate claim and gets a separate test. A failed persisted
    /// replay must not merely be survived — the env-var floor is replayed after it, i.e. the branch this
    /// very startup would have taken had the file not existed.</summary>
    [Fact]
    public async Task WhenThePersistedTripleFails_TheEnvironmentFloorIsReplayedInstead()
    {
        var settingsDir = Directory.CreateTempSubdirectory("st4i-h1a-settings-fallback-").FullName;
        WriteUnactivatableSettingsFile(settingsDir, "https://h1a-file-that-fails.example.test");
        var machineCode = "H1A-FLOOR-" + Guid.NewGuid().ToString("N")[..8];
        var log = new List<(LogLevel Level, string Message)>();

        await using var factory = await CreateFactoryAsync(
            new EnvOverrides("https://h1a-floor.example.test", machineCode, settingsDir), log);

        using var client = factory.CreateClient(new WebApplicationFactoryClientOptions { HandleCookies = true });
        using var response = await client.GetAsync("/v1/settings");
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);

        var settings = await response.Content.ReadFromJsonAsync<SettingsDto>(JsonOptions);
        Assert.NotNull(settings);

        // The floor won, and it won by being REPLAYED after the failure — not by having been chosen in
        // the first place, which it was not: the file existed, so the file was the primary source.
        Assert.Equal("https://h1a-floor.example.test", settings!.ServerUrl);
        Assert.Equal(machineCode, settings.MachineCode);

        // …and the failure that got us here was still reported. A fallback that succeeds silently would
        // hide a persisted file that is permanently dead.
        lock (log)
        {
            Assert.Contains(log, e =>
                e.Level == LogLevel.Error && e.Message.Contains(ReplayFailureMarker, StringComparison.Ordinal));
        }
    }

    /// <summary>Captures LEVEL as well as text. <c>IsEnabled</c> is deliberately unconditional so a
    /// demoted call is still captured and can be caught by the level assertion — a provider that filtered
    /// would turn a demotion into an empty list, which reads identically to "the code path never ran".</summary>
    private sealed class CapturingLoggerProvider : ILoggerProvider
    {
        private readonly List<(LogLevel Level, string Message)> _entries;
        public CapturingLoggerProvider(List<(LogLevel Level, string Message)> entries) => _entries = entries;
        public ILogger CreateLogger(string categoryName) => new CapturingLogger(_entries);
        public void Dispose() { }

        private sealed class CapturingLogger : ILogger
        {
            private readonly List<(LogLevel Level, string Message)> _entries;
            public CapturingLogger(List<(LogLevel Level, string Message)> entries) => _entries = entries;
            public IDisposable? BeginScope<TState>(TState state) where TState : notnull => null;
            public bool IsEnabled(LogLevel logLevel) => true;

            public void Log<TState>(
                LogLevel logLevel, EventId eventId, TState state, Exception? exception,
                Func<TState, Exception?, string> formatter)
            {
                lock (_entries) _entries.Add((logLevel, formatter(state, exception)));
            }
        }
    }
}
