using St4i.EdgeCore.Config;
using St4i.EdgeCore.Infrastructure;
using St4i.EdgeCore.Models;
using St4i.EdgeCore.Transport;
using St4i.EngineApi.Endpoints;
using St4i.EngineApi.Fleet;
using Xunit;

namespace St4i.EngineApi.Tests;

/// <summary>
/// I-1 (prod-ui review, defense in depth) — <see cref="OnboardingEndpoints.TryResolveIsDemo"/> is the
/// engine-side backstop for a flag-off deployment: even though the web wizard (<c>Onboarding.tsx</c>)
/// now gates its own Demo/Live toggle on <c>useCapabilities().demoEnabled</c>, a stale cached page, a
/// hand-written SDK, or a bare curl request could still send <c>isDemo:true</c>. These tests exercise
/// the resolution rules directly (same seam <c>ConfigEndpointsRequestBodyTests</c>/
/// <c>OnboardingFleetJoinTests</c> use — <c>internal</c> + this assembly's <c>AssemblyInfo.cs</c>
/// <c>InternalsVisibleTo("St4i.EngineApi.Tests")</c>) rather than spinning up a TestServer.
/// </summary>
public sealed class OnboardingEndpointsResolveIsDemoTests
{
    /// <summary>Same composition as <c>OnboardingFleetJoinTests.CreateHost</c> — no real network call
    /// is ever made regardless of the seeded initial mode.</summary>
    private static FleetHost CreateHost(TransportMode initialMode)
    {
        var demo = new DemoTransport(latencyMs: 0);
        var live = LiveTransport.ForMachine("http://localhost:1", mkKey: "", machineCode: "TEST", queuePath: null, verifyTls: true);
        var auto = new AutoTransport(live, demo);
        var switchable = new SwitchableTransport(demo);
        var coordinator = new TransportCoordinator(switchable, demo, live, auto, initialMode);
        var eventBus = new EventBus();
        return new FleetHost(switchable, coordinator, eventBus);
    }

    [Fact]
    public void ExplicitTrue_GateOff_Refuses()
    {
        var host = CreateHost(TransportMode.Live);
        var gateOff = new DemoModeGate(rawValue: null);

        var result = OnboardingEndpoints.TryResolveIsDemo(requested: true, host, gateOff);

        Assert.Null(result); // the "refuse" sentinel — endpoints turn this into an honest 400
    }

    [Fact]
    public void ExplicitTrue_GateOn_ResolvesDemo()
    {
        var host = CreateHost(TransportMode.Live);
        var gateOn = new DemoModeGate(rawValue: "true");

        var result = OnboardingEndpoints.TryResolveIsDemo(requested: true, host, gateOn);

        Assert.True(result);
    }

    [Theory]
    [InlineData(null)]
    [InlineData("true")]
    public void ExplicitFalse_ResolvesLive_RegardlessOfGate(string? gateRaw)
    {
        var host = CreateHost(TransportMode.Demo); // even with the fleet itself sitting in Demo
        var gate = new DemoModeGate(gateRaw);

        var result = OnboardingEndpoints.TryResolveIsDemo(requested: false, host, gate);

        Assert.False(result); // explicit isDemo:false is never refused — only explicit true is gated
    }

    [Theory]
    [InlineData(TransportMode.Live, false)]
    [InlineData(TransportMode.Demo, true)]
    public void OmittedRequest_FallsBackToFleetHostMode_RegardlessOfGate(TransportMode hostMode, bool expectedIsDemo)
    {
        var host = CreateHost(hostMode);

        // A flag-off deployment can only ever have FleetHost.Mode == Live in practice (Program.cs seeds
        // TransportCoordinator with Demo only when DemoModeGate.Enabled) — asserting both gate states
        // here proves the omitted-isDemo path never even LOOKS at the gate, only at the engine's own
        // current mode, so it can't be tricked into fabricating anything on a flag-off deployment.
        var gateOff = new DemoModeGate(rawValue: null);
        Assert.Equal(expectedIsDemo, OnboardingEndpoints.TryResolveIsDemo(requested: null, host, gateOff));

        var gateOn = new DemoModeGate(rawValue: "true");
        Assert.Equal(expectedIsDemo, OnboardingEndpoints.TryResolveIsDemo(requested: null, host, gateOn));
    }
}
