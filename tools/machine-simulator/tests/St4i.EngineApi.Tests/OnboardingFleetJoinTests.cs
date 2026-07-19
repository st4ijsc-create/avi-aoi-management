using System.Net;
using System.Net.Http;
using System.Text.Json;
using St4i.EdgeCore.Infrastructure;
using St4i.EdgeCore.Models;
using St4i.EdgeCore.Transport;
using St4i.EngineApi.Fleet;
using Xunit;

namespace St4i.EngineApi.Tests;

/// <summary>
/// E2 — proves onboarding actually makes a machine JOIN the live fleet, in both Demo and Live modes,
/// closing the #1 user complaint: a completed onboarding used to fabricate/claim an <c>mk_</c> key that
/// nobody could ever see anywhere (no tile on Dashboard/Machine List/Detail, no cycles produced).
///
/// <see cref="OnboardingService"/> itself stays fleet-free by design (E2) — the fleet-join glue lives in
/// <see cref="OnboardingFleetJoin"/>, exercised here directly against a real <see cref="FleetHost"/>
/// (same composition <see cref="FleetHostHealthAndRegistrationTests"/> uses, minus the ASP.NET host) —
/// exactly the seam <c>Endpoints/OnboardingEndpoints.cs</c> calls after a successful claim/enroll.
/// </summary>
public sealed class OnboardingFleetJoinTests
{
    private static readonly TimeSpan PollTimeout = TimeSpan.FromSeconds(10);
    private static readonly TimeSpan PollInterval = TimeSpan.FromMilliseconds(100);

    /// <summary>Same composition as FleetHost's own DI wiring / FleetHostHealthAndRegistrationTests —
    /// default mode Demo, so no real network call is ever made.</summary>
    private static FleetHost CreateHost()
    {
        var demo = new DemoTransport(latencyMs: 0);
        var live = LiveTransport.ForMachine("http://localhost:1", mkKey: "", machineCode: "TEST", queuePath: null, verifyTls: true);
        var auto = new AutoTransport(live, demo);
        var switchable = new SwitchableTransport(demo);
        var coordinator = new TransportCoordinator(switchable, demo, live, auto, TransportMode.Demo);
        var eventBus = new EventBus();
        return new FleetHost(switchable, coordinator, eventBus);
    }

    private static async Task WaitUntilAsync(Func<bool> predicate, string because)
    {
        var deadline = DateTime.UtcNow + PollTimeout;
        while (DateTime.UtcNow < deadline)
        {
            if (predicate()) return;
            await Task.Delay(PollInterval);
        }

        Assert.True(predicate(), $"timed out after {PollTimeout} waiting for: {because}");
    }

    // ─────────────────────────────────────────────────────────────────────
    // DEMO — Register → Poll → Claim/Enroll → fleet
    // ─────────────────────────────────────────────────────────────────────
    [Fact]
    public async Task Demo_RegisterPollClaim_NewSerial_JoinsFleet_AndCyclesAfterStart()
    {
        var svc = new OnboardingService();
        var host = CreateHost();
        const string serial = "E2-DEMO-NEW-01";

        var register = await svc.RegisterAsync(new OnboardingRegisterRequest(serial, "Test Screwdrive", "SCREWDRIVE"), CancellationToken.None);
        Assert.Equal("Pending", register.Step);
        Assert.False(register.IsApproved);

        var poll = await svc.PollAsync(new OnboardingPollRequest(serial), CancellationToken.None);
        Assert.Equal("Approved", poll.Step);
        Assert.True(poll.IsApproved);

        var claim = await svc.ClaimAsync(
            new OnboardingClaimRequest(serial, "mct_whatever", Name: "Test Screwdrive", MachineType: "SCREWDRIVE"),
            CancellationToken.None);
        Assert.Equal("Claimed", claim.Step);
        Assert.NotNull(claim.MkKey);
        Assert.StartsWith("mk_", claim.MkKey);
        Assert.Equal(serial, claim.MachineCode);

        // The seam OnboardingEndpoints calls after a successful claim.
        var joined = OnboardingFleetJoin.JoinFleetIfProvisioned(host, claim, serial, "SCREWDRIVE");
        Assert.Contains("tham gia đội máy mô phỏng", joined.Message);

        var beforeStart = host.Snapshot();
        var tile = Assert.Single(beforeStart.Machines, m => string.Equals(m.Code, serial, StringComparison.OrdinalIgnoreCase));
        Assert.Equal(DeviceClass.Automation, tile.DeviceClass);
        Assert.Equal("Idle", tile.StatusText);
        Assert.Equal(0, tile.Cycles);

        host.Start();
        try
        {
            await WaitUntilAsync(() => host.MachineDetail(serial)?.Cycles > 0, $"{serial} to produce a cycle after Start");
            Assert.Contains(host.Snapshot().Machines, m => string.Equals(m.Code, serial, StringComparison.OrdinalIgnoreCase) && m.Cycles > 0);
        }
        finally
        {
            host.Stop();
        }
    }

    [Fact]
    public async Task Demo_Enroll_NewSerial_JoinsFleet_WithMappedDeviceClass()
    {
        var svc = new OnboardingService();
        var host = CreateHost();
        const string serial = "E2-DEMO-ENROLL-01";

        var enroll = await svc.EnrollAsync(new OnboardingEnrollRequest(serial, "met_abc", "Test AOI", "AOI"), CancellationToken.None);
        Assert.Equal("Enrolled", enroll.Step);
        Assert.NotNull(enroll.MkKey);

        var joined = OnboardingFleetJoin.JoinFleetIfProvisioned(host, enroll, serial, "AOI");
        Assert.Contains("tham gia đội máy mô phỏng", joined.Message);

        var tile = Assert.Single(host.Snapshot().Machines, m => string.Equals(m.Code, serial, StringComparison.OrdinalIgnoreCase));
        Assert.Equal(DeviceClass.AoiAvi, tile.DeviceClass); // AOI → aoi_avi, same 3-way split as the real server
    }

    [Fact]
    public async Task Demo_Claim_DuplicateSerial_FriendlyMessage_NoCrash_NoDuplicateTile()
    {
        var svc = new OnboardingService();
        var host = CreateHost();
        const string serial = "E2-DEMO-DUP-01";

        var first = await svc.ClaimAsync(new OnboardingClaimRequest(serial, "mct_1", MachineType: "AOI"), CancellationToken.None);
        var firstJoined = OnboardingFleetJoin.JoinFleetIfProvisioned(host, first, serial, "AOI");
        Assert.Contains("tham gia đội máy mô phỏng", firstJoined.Message);

        // Re-onboarding the SAME serial (operator re-runs the wizard, e.g. after closing it too early) —
        // must not crash and must not create a second tile.
        var second = await svc.ClaimAsync(new OnboardingClaimRequest(serial, "mct_2", MachineType: "AOI"), CancellationToken.None);
        var secondJoined = OnboardingFleetJoin.JoinFleetIfProvisioned(host, second, serial, "AOI");
        Assert.Equal("Claimed", secondJoined.Step); // still a normal success from the credential's point of view
        Assert.Contains("đã có trong đội máy mô phỏng", secondJoined.Message);
        Assert.Contains("không tạo trùng", secondJoined.Message);

        var count = host.Snapshot().Machines.Count(m => string.Equals(m.Code, serial, StringComparison.OrdinalIgnoreCase));
        Assert.Equal(1, count);
    }

    /// <summary>Completion-review #6 — the register field is free text with placeholder hint "e.g.
    /// Automation, IoT, AOI/AVI". "AOI"/"AVI" already resolved correctly; the bare "IoT" the placeholder
    /// itself suggests fell through to the Automation fallback because only the more specific
    /// IOT_SENSOR/IOT_GATEWAY keys existed. Case-insensitive per <see cref="OnboardingFleetJoin.BuildDescriptor"/>'s
    /// own <c>ToUpperInvariant()</c> normalization.</summary>
    [Theory]
    [InlineData("IoT")]
    [InlineData("iot")]
    [InlineData("IOT")]
    public void BuildDescriptor_BareIotAlias_MapsToIotDeviceClass_NotAutomationFallback(string freeTextType)
    {
        var descriptor = OnboardingFleetJoin.BuildDescriptor("E2-IOT-ALIAS-01", "SN-IOT-ALIAS-01", freeTextType);
        Assert.Equal(DeviceClass.Iot, descriptor.DeviceClass);
    }

    [Fact]
    public void JoinFleetIfProvisioned_NonProvisioningStep_LeavesFleetUnchanged()
    {
        var host = CreateHost();
        var before = host.Fleet.Count;

        var pending = new OnboardingStepResult("Pending", null, null, false, "waiting for admin approval");
        var result = OnboardingFleetJoin.JoinFleetIfProvisioned(host, pending, "E2-NOJOIN-01", "AOI");

        Assert.Equal(pending, result); // untouched — no fleet-join suffix appended
        Assert.Equal(before, host.Fleet.Count);
    }

    // ─────────────────────────────────────────────────────────────────────
    // LIVE CLAIM — request shaping against the real server's REST proxy contract
    // (POST {serverUrl}/api/machine/claim {serialNumber,claimToken} -> {success,apiKey,machineId,code})
    // ─────────────────────────────────────────────────────────────────────
    [Fact]
    public async Task LiveClaim_PostsExactUrlAndBody_ParsesMkKeyAndCode_ThenJoinsFleet()
    {
        HttpRequestMessage? capturedRequest = null;
        string? capturedBody = null;
        var handler = new StubHandler((req, body) =>
        {
            capturedRequest = req;
            capturedBody = body;
            return (HttpStatusCode.OK, "{\"success\":true,\"apiKey\":\"mk_deadbeefcafe\",\"machineId\":42,\"code\":\"SN-SIM9001\",\"message\":\"API key claimed\"}");
        });

        var svc = new OnboardingService(new HttpClient(handler));
        var result = await svc.ClaimAsync(
            new OnboardingClaimRequest("SIM-9001", "mct_abc123", IsDemo: false, ServerUrl: "http://fake-synapse.local", MachineType: "AUTOMATION"),
            CancellationToken.None);

        // Request shape — exactly what doc 61 / server/_core/index.ts's REST proxy expects.
        Assert.NotNull(capturedRequest);
        Assert.Equal(HttpMethod.Post, capturedRequest!.Method);
        Assert.Equal("http://fake-synapse.local/api/machine/claim", capturedRequest.RequestUri!.ToString());
        using (var doc = JsonDocument.Parse(capturedBody!))
        {
            var root = doc.RootElement;
            Assert.Equal(2, root.EnumerateObject().Count()); // ONLY serialNumber + claimToken — no extra fields
            Assert.Equal("SIM-9001", root.GetProperty("serialNumber").GetString());
            Assert.Equal("mct_abc123", root.GetProperty("claimToken").GetString());
        }

        // Response parsing.
        Assert.Equal("Claimed", result.Step);
        Assert.Equal("mk_deadbeefcafe", result.MkKey);
        Assert.Equal("SN-SIM9001", result.MachineCode); // server's canonical code, NOT the raw serial

        // Fleet-join glue behaves identically for the Live path.
        var host = CreateHost();
        var joined = OnboardingFleetJoin.JoinFleetIfProvisioned(host, result, "SIM-9001", "AUTOMATION");
        Assert.Contains("tham gia đội máy mô phỏng", joined.Message);
        Assert.Contains(host.Snapshot().Machines, m => m.Code == "SN-SIM9001");
    }

    [Fact]
    public async Task LiveClaim_ServerRejects_ReturnsIdleWithMessage_NoThrow_NoFleetJoin()
    {
        var handler = new StubHandler((_, _) => (HttpStatusCode.BadRequest, "{\"success\":false,\"message\":\"claimToken invalid or already spent\"}"));
        var svc = new OnboardingService(new HttpClient(handler));

        var result = await svc.ClaimAsync(
            new OnboardingClaimRequest("SIM-9002", "bad-token", IsDemo: false, ServerUrl: "http://fake-synapse.local"),
            CancellationToken.None);

        Assert.Equal("Idle", result.Step);
        Assert.Null(result.MkKey);
        Assert.Contains("Claim failed", result.Message);

        var host = CreateHost();
        var before = host.Fleet.Count;
        var joined = OnboardingFleetJoin.JoinFleetIfProvisioned(host, result, "SIM-9002", "AUTOMATION");
        Assert.Equal(result, joined); // Idle step — no fleet mutation attempted
        Assert.Equal(before, host.Fleet.Count);
    }

    private sealed class StubHandler : HttpMessageHandler
    {
        private readonly Func<HttpRequestMessage, string, (HttpStatusCode Status, string Body)> _responder;

        public StubHandler(Func<HttpRequestMessage, string, (HttpStatusCode, string)> responder) => _responder = responder;

        protected override async Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken)
        {
            var body = request.Content is null ? string.Empty : await request.Content.ReadAsStringAsync(cancellationToken).ConfigureAwait(false);
            var (status, json) = _responder(request, body);
            return new HttpResponseMessage(status) { Content = new StringContent(json) };
        }
    }
}
