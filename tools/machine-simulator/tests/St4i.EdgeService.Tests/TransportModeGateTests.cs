using Xunit;

namespace St4i.EdgeService.Tests;

/// <summary>
/// Task F1-2 — <see cref="TransportModeGate"/>'s env-var parsing rules. This is EdgeService's OWN
/// copy of St4i.EngineApi.Config.DemoModeGate's <c>ST4I_DEMO_ENABLED</c> truthy-parse semantics
/// (same env var name, same rules) — see <see cref="TransportModeGate"/>'s own doc comment for why a
/// bare console host duplicates this small gate instead of referencing EngineApi as a library. Mirrors
/// DemoModeGateTests' shape/cases exactly, using the `internal` raw-value ctor (test-only seam) instead
/// of mutating the process-wide environment variable (flaky under a parallel test run).
/// </summary>
public sealed class TransportModeGateTests
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
        Assert.False(new TransportModeGate(raw).Enabled);
    }

    [Theory]
    [InlineData("1")]
    [InlineData("true")]
    [InlineData("True")]
    [InlineData("TRUE")]
    [InlineData("  true  ")]
    public void Enabled_ForTruthyValues(string raw)
    {
        Assert.True(new TransportModeGate(raw).Enabled);
    }

    [Fact]
    public void DefaultCtor_ReadsRealEnvironmentVariable()
    {
        var previous = Environment.GetEnvironmentVariable(TransportModeGate.EnvVarName);
        try
        {
            Environment.SetEnvironmentVariable(TransportModeGate.EnvVarName, "true");
            Assert.True(new TransportModeGate().Enabled);

            Environment.SetEnvironmentVariable(TransportModeGate.EnvVarName, null);
            Assert.False(new TransportModeGate().Enabled);
        }
        finally
        {
            Environment.SetEnvironmentVariable(TransportModeGate.EnvVarName, previous);
        }
    }

    [Fact]
    public void EnvVarName_IsSt4iDemoEnabled_SameNameAsEngineApisDemoModeGate()
    {
        // Not a reference to St4i.EngineApi.Config.DemoModeGate.EnvVarName (this project deliberately
        // does not ProjectReference EngineApi — see TransportModeGate's doc comment) — this asserts the
        // duplicated literal stays in sync by convention, same as the DesktopShell/App.xaml.cs precedents.
        Assert.Equal("ST4I_DEMO_ENABLED", TransportModeGate.EnvVarName);
    }
}
