using St4i.EngineApi.Config;
using Xunit;

namespace St4i.EngineApi.Tests;

/// <summary>WS2-T1 — <see cref="DemoModeGate"/>'s env-var parsing rules. Uses the `internal`
/// raw-value ctor (test-only seam, see its own doc comment) instead of mutating the process-wide
/// <c>ST4I_DEMO_ENABLED</c> environment variable, which would be flaky under a parallel test run.</summary>
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
}
