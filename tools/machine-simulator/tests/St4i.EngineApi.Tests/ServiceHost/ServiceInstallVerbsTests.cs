using St4i.EngineApi.ServiceHost;
using Xunit;

namespace St4i.EngineApi.Tests.ServiceHost;

/// <summary>WS-F1-T1 — <see cref="ServiceInstallVerbs"/>'s PURE arg-vector builders. Only
/// <see cref="ServiceInstallVerbs.BuildScCreateArgs"/>/<see cref="ServiceInstallVerbs.BuildScDeleteArgs"/>
/// (and <see cref="ServiceInstallVerbs.TryHandle"/>'s no-verb-present short-circuit, which also does zero
/// I/O) are unit-tested here — the actual `sc.exe` process invocation (`--install`/`--uninstall`) and the
/// `ServiceController` status query (`--status`) need either elevation or a real installed service, so
/// those are manual/doc-verified only (see task-1-report.md), not exercised by this suite.</summary>
public sealed class ServiceInstallVerbsTests
{
    [Fact]
    public void BuildScCreateArgs_ProducesExactScExeArgVector_WithCorrectKeyEqualsValueSpacing()
    {
        var args = ServiceInstallVerbs.BuildScCreateArgs(
            exePath: @"C:\Program Files\St4i\St4i.EngineApi.exe",
            serviceName: "St4iEngineApi",
            account: "LocalSystem",
            startType: "auto");

        // sc.exe's own quirky `key= value` syntax: NO space before "=", exactly ONE space after it
        // (sc.exe treats "key=value" and "key =value" as parse errors — the single space after "="
        // is load-bearing, not cosmetic). The binPath/DisplayName values are additionally
        // double-quoted so a path/display name containing spaces survives sc.exe's own tokenizing.
        Assert.Equal(
            new[]
            {
                "create",
                "St4iEngineApi",
                "binPath= \"C:\\Program Files\\St4i\\St4i.EngineApi.exe\"",
                "start= auto",
                "obj= LocalSystem",
                "DisplayName= \"ST4I Machine Simulator Engine\"",
            },
            args);
    }

    [Fact]
    public void BuildScCreateArgs_UsesConstantsDisplayName_RegardlessOfServiceNameArgument()
    {
        var args = ServiceInstallVerbs.BuildScCreateArgs(
            exePath: @"C:\svc.exe",
            serviceName: "SomeOtherName",
            account: "NT AUTHORITY\\LocalService",
            startType: "demand");

        Assert.Equal("SomeOtherName", args[1]);
        Assert.Equal("binPath= \"C:\\svc.exe\"", args[2]);
        Assert.Equal("start= demand", args[3]);
        Assert.Equal("obj= NT AUTHORITY\\LocalService", args[4]);
        Assert.Equal($"DisplayName= \"{ServiceHostConstants.DisplayName}\"", args[5]);
    }

    [Fact]
    public void BuildScDeleteArgs_ProducesDeleteArgVector()
    {
        var args = ServiceInstallVerbs.BuildScDeleteArgs("St4iEngineApi");

        Assert.Equal(new[] { "delete", "St4iEngineApi" }, args);
    }

    [Theory]
    // Wrapped in an outer `object[]` (not just `new[] { ... }`) — xUnit's InlineData ctor is `params
    // object[]`, and the theory method's single parameter is ITSELF a string[]; without the outer
    // object[] wrapper the compiler can't tell "one string[] argument" apart from "params-expand this
    // array's own elements", which is a compile error (CS0182), not just a runtime surprise.
    [InlineData(new object[] { new string[] { } })]
    [InlineData(new object[] { new[] { "--urls", "http://localhost:6000" } })]
    [InlineData(new object[] { new[] { "--help" } })]
    public void TryHandle_ReturnsFalse_AndDoesNoIo_WhenNoServiceVerbIsPresent(string[] args)
    {
        // No sc.exe/ServiceController call happens on this path (verified by the mere fact this test
        // runs successfully with no admin rights and no installed service) — TryHandle must check for
        // the recognized verbs BEFORE attempting anything else.
        var handled = ServiceInstallVerbs.TryHandle(args, out var exitCode);

        Assert.False(handled);
        Assert.Equal(0, exitCode);
    }
}
