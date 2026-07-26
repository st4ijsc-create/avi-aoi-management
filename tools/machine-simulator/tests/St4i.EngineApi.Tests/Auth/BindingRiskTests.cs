using St4i.EngineApi.Auth;
using Xunit;

namespace St4i.EngineApi.Tests.Auth;

/// <summary>
/// WS-D-D5 — <see cref="BindingRisk.Describe"/> is a pure, I/O-free function of a bound-URL list, so
/// every case below is a plain in-memory unit test (no <c>WebApplicationFactory</c>/host needed) — see
/// the task-5 brief's own table of cases, reproduced 1:1 as facts/theories here.
/// </summary>
public sealed class BindingRiskTests
{
    // ─────────────────────────────────────────────────────────────────────
    // Safe: loopback host, any case, over plain http.
    // ─────────────────────────────────────────────────────────────────────

    [Theory]
    [InlineData("http://localhost:5199")]
    [InlineData("http://LOCALHOST:5199")]
    [InlineData("http://127.0.0.1:5199")]
    [InlineData("http://[::1]:5199")]
    [InlineData("http://[::1]")]
    public void Describe_LoopbackOverHttp_ReturnsNull(string url)
    {
        Assert.Null(BindingRisk.Describe(new[] { url }));
    }

    // ─────────────────────────────────────────────────────────────────────
    // Risky: non-loopback host over plain http — 0.0.0.0, the +/* wildcards, a LAN IP/hostname.
    // ─────────────────────────────────────────────────────────────────────

    [Theory]
    [InlineData("http://0.0.0.0:5199", "0.0.0.0")]
    [InlineData("http://+:5199", "+")]
    [InlineData("http://*:5199", "*")]
    [InlineData("http://192.168.1.10:5199", "192.168.1.10")]
    [InlineData("http://my-machine-host:5199", "my-machine-host")]
    public void Describe_NonLoopbackOverHttp_ReturnsMessageNamingTheBinding(string url, string expectedNamedFragment)
    {
        var result = BindingRisk.Describe(new[] { url });

        Assert.NotNull(result);
        Assert.Contains(url, result);
        Assert.Contains(expectedNamedFragment, result);
    }

    // The message must actually explain the risk, not just name the binding — cleartext credential
    // exposure + a concrete remediation, per the brief.
    [Fact]
    public void Describe_NonLoopbackOverHttp_MessageExplainsRiskAndRemediation()
    {
        var result = BindingRisk.Describe(new[] { "http://0.0.0.0:5199" });

        Assert.NotNull(result);
        Assert.Contains("cleartext", result, StringComparison.OrdinalIgnoreCase);
        Assert.Contains("HTTPS", result, StringComparison.Ordinal);
    }

    // ─────────────────────────────────────────────────────────────────────
    // https is safe regardless of host — even 0.0.0.0/wildcard.
    // ─────────────────────────────────────────────────────────────────────

    [Theory]
    [InlineData("https://0.0.0.0:5199")]
    [InlineData("https://+:5199")]
    [InlineData("https://192.168.1.10:5199")]
    public void Describe_HttpsAnyHost_ReturnsNull(string url)
    {
        Assert.Null(BindingRisk.Describe(new[] { url }));
    }

    // ─────────────────────────────────────────────────────────────────────
    // Mixed list — one risky entry among safe ones still trips the check and names the offender.
    // ─────────────────────────────────────────────────────────────────────

    [Fact]
    public void Describe_MixedList_OneRisky_ReturnsMessageNamingOnlyTheRiskyOne()
    {
        var result = BindingRisk.Describe(new[] { "http://localhost:5199", "http://0.0.0.0:5199", "https://192.168.1.10:5443" });

        Assert.NotNull(result);
        Assert.Contains("http://0.0.0.0:5199", result);
        Assert.DoesNotContain("http://localhost:5199", result);
    }

    [Fact]
    public void Describe_MixedList_AllSafe_ReturnsNull()
    {
        var result = BindingRisk.Describe(new[] { "http://localhost:5199", "https://0.0.0.0:5199", "http://127.0.0.1:5000" });

        Assert.Null(result);
    }

    // ─────────────────────────────────────────────────────────────────────
    // Edge cases: empty/null-ish input.
    // ─────────────────────────────────────────────────────────────────────

    [Fact]
    public void Describe_EmptyList_ReturnsNull()
    {
        Assert.Null(BindingRisk.Describe(Array.Empty<string>()));
    }

    [Fact]
    public void Describe_ThrowsOnNullEnumerable()
    {
        Assert.Throws<ArgumentNullException>(() => BindingRisk.Describe(null!));
    }
}
