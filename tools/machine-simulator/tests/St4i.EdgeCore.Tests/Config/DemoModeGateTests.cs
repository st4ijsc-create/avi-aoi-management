using St4i.EdgeCore.Config;
using Xunit;

namespace St4i.EdgeCore.Tests.Config;

/// <summary>
/// WS2-T1 — <see cref="DemoModeGate"/>'s env-var parsing rules.
///
/// SM-1b fix round 1 (.superpowers/sdd/2026-07-29-dotA-single-machine-sellable-blueprint/task-1b-brief.md,
/// review) — this is the ONE consolidated home for this test, moved here from
/// <c>St4i.EngineApi.Tests.DemoModeGateTests</c> and <c>St4i.EdgeService.Tests.TransportModeGateTests</c>
/// (both deleted) now that <see cref="DemoModeGate"/> itself moved to <c>St4i.EdgeCore.Config</c> and both
/// St4i.EngineApi and St4i.EdgeService consume this SAME class — see <see cref="DemoModeGate"/>'s own doc
/// comment for the full history. There is no longer a second copy's "same env var name, same rule" fact
/// to cross-check (<c>TransportModeGateTests.EnvVarName_IsSt4iDemoEnabled_SameNameAsEngineApisDemoModeGate</c>
/// is dropped, not ported — with one canonical class there is nothing left to keep "in sync by
/// convention").
/// </summary>
public sealed class DemoModeGateTests
{
    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData("   ")]
    [InlineData("0")]
    [InlineData("false")]
    [InlineData("False")]
    [InlineData("no")]
    [InlineData("yes")]
    [InlineData("enabled")]
    public void Disabled_ForAbsentOrNonTruthyValues(string? raw)
    {
        Assert.False(new DemoModeGate(raw).Enabled);
    }

    [Theory]
    [InlineData("1")]
    [InlineData("true")]
    [InlineData("True")]
    [InlineData("TRUE")]
    [InlineData("  true  ")]
    public void Enabled_ForTruthyValues(string raw)
    {
        Assert.True(new DemoModeGate(raw).Enabled);
    }

    [Fact]
    public void DefaultCtor_ReadsRealEnvironmentVariable()
    {
        var previous = Environment.GetEnvironmentVariable(DemoModeGate.EnvVarName);
        try
        {
            Environment.SetEnvironmentVariable(DemoModeGate.EnvVarName, "true");
            Assert.True(new DemoModeGate().Enabled);

            Environment.SetEnvironmentVariable(DemoModeGate.EnvVarName, null);
            Assert.False(new DemoModeGate().Enabled);
        }
        finally
        {
            Environment.SetEnvironmentVariable(DemoModeGate.EnvVarName, previous);
        }
    }

    [Fact]
    public void EnvVarName_IsSt4iDemoEnabled()
    {
        // Restored (task-7 whole-batch review, small item) — dropped during the SM-1b consolidation
        // (this class's own doc comment: "there is no longer a second copy's 'same env var name, same
        // rule' fact to cross-check"). That reasoning was right about ONE job this assertion did (proving
        // two duplicate copies agreed with each other — genuinely obsolete once there was only one copy)
        // but missed the OTHER, still-live job: pinning the literal string every launch script, README
        // snippet, and `web/playwright.config.ts`'s own webServer env block (`ST4I_DEMO_ENABLED: "true"`)
        // actually sets. None of those hardcode a reference to this constant, so nothing else in this
        // solution would fail to compile — or fail loudly at all — if this constant's spelling ever
        // drifted from what those call sites hardcode; a passing test suite would keep passing right up
        // until an exhibition build silently stopped starting in Demo mode.
        Assert.Equal("ST4I_DEMO_ENABLED", DemoModeGate.EnvVarName);
    }

    [Fact]
    public void RawValueCtor_IsPublic_BecauseEdgeServiceResolveGateIsAGenuineProductionCaller()
    {
        // SM-1b fix round 1 — pins the ctor's accessibility itself: EdgeWorker.ResolveGate (production
        // code in a DIFFERENT assembly, St4i.EdgeService) constructs a DemoModeGate from an
        // already-resolved raw string, not through the parameterless real-env-var ctor. If this ctor
        // ever regresses back to `internal`, that call site (and this whole cross-assembly reuse) stops
        // compiling — this test documents why it must stay public rather than leaving that fact only in
        // a doc comment.
        var gate = new DemoModeGate(rawValue: "true");
        Assert.True(gate.Enabled);
    }
}
