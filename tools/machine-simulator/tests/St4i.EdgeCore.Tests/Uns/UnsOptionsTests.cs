using St4i.EdgeCore.Uns;
using Xunit;

namespace St4i.EdgeCore.Tests.Uns;

/// <summary>G2-2 — <see cref="UnsOptions.FromEnvironment"/>: same "read once, unparseable falls back to
/// default rather than throwing" idiom as <c>WalOptions.FromEnvironment</c>.</summary>
public sealed class UnsOptionsTests
{
    private static readonly string[] AllEnvVars =
    {
        UnsOptions.EnvVarEnabled, UnsOptions.EnvVarSite, UnsOptions.EnvVarArea,
        UnsOptions.EnvVarLine, UnsOptions.EnvVarCell, UnsOptions.EnvVarPort,
    };

    private static IDisposable ScopedEnv(params (string Name, string? Value)[] vars)
    {
        var previous = AllEnvVars.ToDictionary(v => v, Environment.GetEnvironmentVariable);
        foreach (var (name, value) in vars)
        {
            Environment.SetEnvironmentVariable(name, value);
        }

        return new RestoreEnv(previous);
    }

    private sealed class RestoreEnv(Dictionary<string, string?> previous) : IDisposable
    {
        public void Dispose()
        {
            foreach (var (name, value) in previous)
            {
                Environment.SetEnvironmentVariable(name, value);
            }
        }
    }

    [Fact]
    public void FromEnvironment_NoEnvVarsSet_UsesDefaults()
    {
        using var _ = ScopedEnv(AllEnvVars.Select(v => (v, (string?)null)).ToArray());

        var options = UnsOptions.FromEnvironment();

        Assert.True(options.Enabled);
        Assert.Equal("site", options.Site);
        Assert.Equal("area", options.Area);
        Assert.Equal("line", options.Line);
        Assert.Equal("cell", options.Cell);
        Assert.Equal(UnsOptions.DefaultBrokerPort, options.BrokerPort);
    }

    [Fact]
    public void FromEnvironment_UnsEnabledFalse_DisablesUns()
    {
        using var _ = ScopedEnv((UnsOptions.EnvVarEnabled, "false"));

        Assert.False(UnsOptions.FromEnvironment().Enabled);
    }

    [Fact]
    public void FromEnvironment_UnsEnabledZero_DisablesUns()
    {
        using var _ = ScopedEnv((UnsOptions.EnvVarEnabled, "0"));

        Assert.False(UnsOptions.FromEnvironment().Enabled);
    }

    [Fact]
    public void FromEnvironment_SiteAreaLineCellOverrides_AreApplied()
    {
        using var _ = ScopedEnv(
            (UnsOptions.EnvVarSite, "plant1"),
            (UnsOptions.EnvVarArea, "smt"),
            (UnsOptions.EnvVarLine, "line3"),
            (UnsOptions.EnvVarCell, "cell7"));

        var options = UnsOptions.FromEnvironment();

        Assert.Equal("plant1", options.Site);
        Assert.Equal("smt", options.Area);
        Assert.Equal("line3", options.Line);
        Assert.Equal("cell7", options.Cell);
    }

    [Fact]
    public void FromEnvironment_PortOverride_ParsesConfiguredValue()
    {
        using var _ = ScopedEnv((UnsOptions.EnvVarPort, "19999"));

        Assert.Equal(19999, UnsOptions.FromEnvironment().BrokerPort);
    }

    [Fact]
    public void FromEnvironment_UnparseablePort_FallsBackToDefaultRatherThanThrowing()
    {
        using var _ = ScopedEnv((UnsOptions.EnvVarPort, "not-a-number"));

        var options = UnsOptions.FromEnvironment();

        Assert.Equal(UnsOptions.DefaultBrokerPort, options.BrokerPort);
    }
}
