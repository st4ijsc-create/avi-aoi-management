using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using System.Text.Json.Serialization;
using Microsoft.AspNetCore.Mvc.Testing;
using St4i.EngineApi.Fleet;
using St4i.EngineApi.Tests.Auth;
using Xunit;

namespace St4i.EngineApi.Tests;

/// <summary>
/// WS-F1 final-review fix F1 — proves `Program.cs` actually reads `ST4I_SERVER_URL`/
/// `ST4I_MACHINE_CODE`/`ST4I_VERIFY_TLS` at startup and applies them as <see cref="FleetHost"/>'s
/// INITIAL Live settings (via the exact same <see cref="FleetHost.UpdateSettings"/> path a runtime
/// `PUT /v1/settings` uses) — the fix that makes a headless Windows Service's Live config actually
/// survive a restart, closing the gap the final review flagged: README §15.2/§15.8(a) advertised this
/// env-var channel while `St4i.EngineApi` read none of the three (only `St4i.EdgeService`'s
/// `EdgeWorker` did).
///
/// Boots the REAL composition root (`Microsoft.AspNetCore.Mvc.Testing`'s
/// <c>WebApplicationFactory&lt;Program&gt;</c>) rather than constructing <see cref="FleetHost"/>
/// directly — same rationale as <see cref="St4i.EngineApi.Tests.Auth.AuthPipelineTests"/>: the thing
/// under test IS the `Program.cs` env-read-then-apply wiring itself, not just
/// <see cref="FleetHost.UpdateSettings"/> in isolation (already covered elsewhere, e.g.
/// <c>SettingsWalPreservationTests</c>). `ST4I_DEMO_ENABLED=true` is set purely so the demo
/// auto-login middleware satisfies the `GET /v1/settings` route's Engineer policy with zero explicit
/// login — same technique as <c>AuthPipelineTests.DemoModeEnabled_AllowsFleetAccess_WithoutAnyExplicitLogin</c>.
///
/// `Program.cs` reads every one of these env vars straight off
/// <see cref="Environment.GetEnvironmentVariable(string)"/> with no <c>IConfiguration</c> seam, so —
/// same as <see cref="St4i.EngineApi.Tests.Auth.AuthPipelineTests"/> — this test mutates the REAL
/// process environment around the eager <c>factory.Server</c> build and restores it in a
/// <c>finally</c>. <c>[Collection(SecurityEnvVarTests.CollectionName)]</c> puts this class in the SAME
/// xUnit collection as every other class that does that real-env-var dance
/// (<c>AuthPipelineTests</c>/<c>RbacPolicyTests</c>/<c>AuditEndpointsTests</c>), which xUnit always
/// runs sequentially relative to each other — without it, xUnit's default one-collection-per-class
/// parallelism could race two classes mutating real process env vars at the same wall-clock instant.
/// </summary>
[Collection(SecurityEnvVarTests.CollectionName)]
public sealed class LiveSettingsEnvVarTests
{
    private static readonly SemaphoreSlim EnvLock = new(1, 1);

    // SettingsDto carries a TransportMode enum field (`Mode`) — JsonSerializerDefaults.Web alone has
    // no JsonStringEnumConverter (see AuthPipelineTests' own doc comment on why it parses capabilities
    // as a raw JsonDocument instead for the same reason), so deserializing straight into the typed DTO
    // needs the SAME converter Program.cs's own ConfigureHttpJsonOptions registers server-side.
    private static readonly JsonSerializerOptions JsonOptions = new(JsonSerializerDefaults.Web)
    {
        Converters = { new JsonStringEnumConverter() },
    };

    /// <summary>Same eager-build-under-mutated-real-env-vars technique as
    /// <c>AuthPipelineTests.CreateFactoryAsync</c> (see that method's own doc comment for the full
    /// "why `ASPNETCORE_ENVIRONMENT=Production`" rationale) — extended with the three F1 env vars this
    /// fix wave adds. <paramref name="serverUrl"/>/<paramref name="machineCode"/>/<paramref name="verifyTlsRaw"/>
    /// are only set on the real environment when non-null, so a caller can exercise "some set, some
    /// left absent" combinations (proving the unset ones truly leave FleetHost's own defaults
    /// untouched) without setting an empty string.</summary>
    private static async Task<WebApplicationFactory<Program>> CreateFactoryAsync(
        string? serverUrl, string? machineCode, string? verifyTlsRaw)
    {
        var securityDir = Directory.CreateTempSubdirectory("st4i-live-settings-security-").FullName;
        var historianDir = Directory.CreateTempSubdirectory("st4i-live-settings-historian-").FullName;
        var walDir = Directory.CreateTempSubdirectory("st4i-live-settings-wal-").FullName;
        // FF-1 — isolated the same way as historian/WAL above: without this, FleetHost.UpdateSettings' new
        // persist-on-change behavior (this env-var seeding call goes through that exact method) would
        // read/write the REAL %ProgramData%\ST4I\sim\settings\fleet-settings.json — leaking state across
        // test runs and defeating THIS file's whole "env var becomes FleetHost's initial setting" premise
        // the very next time any WebApplicationFactory<Program> boots without ST4I_SETTINGS_DIR isolated,
        // since a persisted file now takes precedence over these env vars (see FF-1's own precedence docs).
        var settingsDir = Directory.CreateTempSubdirectory("st4i-live-settings-settings-").FullName;

        await EnvLock.WaitAsync().ConfigureAwait(false);
        var prevSecurityDir = Environment.GetEnvironmentVariable("ST4I_SECURITY_DIR");
        var prevDemoEnabled = Environment.GetEnvironmentVariable("ST4I_DEMO_ENABLED");
        var prevHistorianDir = Environment.GetEnvironmentVariable("ST4I_HISTORIAN_DIR");
        var prevWalDir = Environment.GetEnvironmentVariable("ST4I_WAL_DIR");
        var prevSettingsDir = Environment.GetEnvironmentVariable("ST4I_SETTINGS_DIR");
        var prevEnvironment = Environment.GetEnvironmentVariable("ASPNETCORE_ENVIRONMENT");
        var prevServerUrl = Environment.GetEnvironmentVariable("ST4I_SERVER_URL");
        var prevMachineCode = Environment.GetEnvironmentVariable("ST4I_MACHINE_CODE");
        var prevVerifyTls = Environment.GetEnvironmentVariable("ST4I_VERIFY_TLS");
        try
        {
            Environment.SetEnvironmentVariable("ST4I_SECURITY_DIR", securityDir);
            Environment.SetEnvironmentVariable("ST4I_DEMO_ENABLED", "true");
            Environment.SetEnvironmentVariable("ST4I_HISTORIAN_DIR", historianDir);
            Environment.SetEnvironmentVariable("ST4I_WAL_DIR", walDir);
            Environment.SetEnvironmentVariable("ST4I_SETTINGS_DIR", settingsDir);
            Environment.SetEnvironmentVariable("ASPNETCORE_ENVIRONMENT", "Production");
            Environment.SetEnvironmentVariable("ST4I_SERVER_URL", serverUrl);
            Environment.SetEnvironmentVariable("ST4I_MACHINE_CODE", machineCode);
            Environment.SetEnvironmentVariable("ST4I_VERIFY_TLS", verifyTlsRaw);

            var factory = new WebApplicationFactory<Program>();
            _ = factory.Server; // force the host to build NOW, while the env vars above are still set.
            return factory;
        }
        finally
        {
            Environment.SetEnvironmentVariable("ST4I_SECURITY_DIR", prevSecurityDir);
            Environment.SetEnvironmentVariable("ST4I_DEMO_ENABLED", prevDemoEnabled);
            Environment.SetEnvironmentVariable("ST4I_HISTORIAN_DIR", prevHistorianDir);
            Environment.SetEnvironmentVariable("ST4I_WAL_DIR", prevWalDir);
            Environment.SetEnvironmentVariable("ST4I_SETTINGS_DIR", prevSettingsDir);
            Environment.SetEnvironmentVariable("ASPNETCORE_ENVIRONMENT", prevEnvironment);
            Environment.SetEnvironmentVariable("ST4I_SERVER_URL", prevServerUrl);
            Environment.SetEnvironmentVariable("ST4I_MACHINE_CODE", prevMachineCode);
            Environment.SetEnvironmentVariable("ST4I_VERIFY_TLS", prevVerifyTls);
            EnvLock.Release();
        }
    }

    [Fact]
    public async Task AllThreeEnvVarsSet_BecomeFleetHosts_InitialLiveSettings()
    {
        var machineCode = "F1-ENV-TEST-" + Guid.NewGuid().ToString("N")[..8];
        await using var factory = await CreateFactoryAsync(
            serverUrl: "https://central.example.test:8443",
            machineCode: machineCode,
            verifyTlsRaw: "false");
        using var client = factory.CreateClient(new WebApplicationFactoryClientOptions { HandleCookies = true });

        using var response = await client.GetAsync("/v1/settings");
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);

        var settings = await response.Content.ReadFromJsonAsync<SettingsDto>(JsonOptions);
        Assert.NotNull(settings);
        Assert.Equal("https://central.example.test:8443", settings!.ServerUrl);
        Assert.Equal(machineCode, settings.MachineCode);
        Assert.False(settings.VerifyTls);
    }

    [Fact]
    public async Task NoEnvVarsSet_FleetHost_KeepsItsOwnBuiltInDefaults()
    {
        await using var factory = await CreateFactoryAsync(serverUrl: null, machineCode: null, verifyTlsRaw: null);
        using var client = factory.CreateClient(new WebApplicationFactoryClientOptions { HandleCookies = true });

        using var response = await client.GetAsync("/v1/settings");
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);

        var settings = await response.Content.ReadFromJsonAsync<SettingsDto>(JsonOptions);
        Assert.NotNull(settings);
        Assert.Equal(FleetHost.DefaultServerUrl, settings!.ServerUrl);
        Assert.Equal(FleetHost.DefaultMachineCode, settings.MachineCode);
        Assert.True(settings.VerifyTls);
    }

    [Fact]
    public async Task OnlyServerUrlSet_LeavesMachineCodeAndVerifyTls_AtTheirDefaults()
    {
        await using var factory = await CreateFactoryAsync(
            serverUrl: "https://only-server-url.example.test",
            machineCode: null,
            verifyTlsRaw: null);
        using var client = factory.CreateClient(new WebApplicationFactoryClientOptions { HandleCookies = true });

        using var response = await client.GetAsync("/v1/settings");
        var settings = await response.Content.ReadFromJsonAsync<SettingsDto>(JsonOptions);
        Assert.NotNull(settings);
        Assert.Equal("https://only-server-url.example.test", settings!.ServerUrl);
        // ST4I_MACHINE_CODE/ST4I_VERIFY_TLS were left unset — SettingsUpdateRequest's null fields must
        // leave these at FleetHost's own built-in defaults, not get clobbered to some other value.
        Assert.Equal(FleetHost.DefaultMachineCode, settings.MachineCode);
        Assert.True(settings.VerifyTls);
    }
}
