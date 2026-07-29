using Microsoft.Extensions.Logging.Abstractions;
using St4i.EdgeCore.Config;
using St4i.EdgeCore.Transport;
using Xunit;

namespace St4i.EdgeService.Tests;

/// <summary>
/// Task F1-2 — <see cref="EdgeWorker.BuildTransport"/> (gate-driven Live/Demo selection + WAL wiring)
/// and <see cref="EdgeWorker.ResolveGate"/> (the `--smoke` CI-path default). Both are `internal static`
/// methods taking every input as an explicit parameter — no <see cref="Environment"/> reads, no real
/// `%ProgramData%` credential-store I/O — specifically so this suite can exercise them directly instead
/// of only being integration-covered by a real process run. Reachable from this separate test project
/// via St4i.EdgeService's <c>AssemblyInfo.cs</c> <c>InternalsVisibleTo("St4i.EdgeService.Tests")</c>.
/// </summary>
public sealed class EdgeWorkerBuildTransportTests
{
    private static string FreshTempDir() =>
        Path.Combine(Path.GetTempPath(), "st4i-edgeservice-tests-" + Guid.NewGuid().ToString("N"));

    // ── BuildTransport ──────────────────────────────────────────────────────────────────────────

    [Fact]
    public void BuildTransport_GateEnabled_ReturnsDemoTransport()
    {
        var gate = new DemoModeGate("true");
        var wal = new WalOptions { Directory = FreshTempDir(), Enabled = true };

        var transport = EdgeWorker.BuildTransport(
            gate, serverUrl: "http://unused", machineCode: "UNUSED-01", verifyTls: true,
            wal: wal, mkKey: null, logger: NullLogger.Instance);

        Assert.IsType<DemoTransport>(transport);
        // Demo mode must never touch the WAL directory — nothing to flush, nothing to durably queue.
        Assert.False(Directory.Exists(wal.ResolveDir()));
    }

    [Fact]
    public void BuildTransport_GateDisabled_ReturnsLiveTransport()
    {
        var gate = new DemoModeGate(null);
        var wal = new WalOptions { Directory = FreshTempDir(), Enabled = true };

        var transport = EdgeWorker.BuildTransport(
            gate, serverUrl: "http://localhost:5000", machineCode: "EDGE-SVC-01", verifyTls: true,
            wal: wal, mkKey: null, logger: NullLogger.Instance);

        try
        {
            Assert.IsType<LiveTransport>(transport);
        }
        finally
        {
            (transport as IDisposable)?.Dispose();
        }
    }

    [Fact]
    public void BuildTransport_GateDisabled_WalEnabled_CreatesTheWalDirectory()
    {
        // WS-C's Critical lesson (WalOptions.EnsureDir's own remarks): a fresh install has never created
        // %ProgramData%\ST4I\sim\wal, and the vendored SDK's own Enqueue does NOT create missing parent
        // directories — BuildTransport MUST call EnsureDir() itself on the Live path, or the very first
        // offline write is lost instead of durably queued.
        var gate = new DemoModeGate(null);
        var dir = FreshTempDir();
        var wal = new WalOptions { Directory = dir, Enabled = true };
        Assert.False(Directory.Exists(dir));

        var transport = EdgeWorker.BuildTransport(
            gate, serverUrl: "http://localhost:5000", machineCode: "EDGE-SVC-01", verifyTls: true,
            wal: wal, mkKey: null, logger: NullLogger.Instance);

        try
        {
            Assert.True(Directory.Exists(dir));
        }
        finally
        {
            (transport as IDisposable)?.Dispose();
            if (Directory.Exists(dir)) Directory.Delete(dir, recursive: true);
        }
    }

    [Fact]
    public void BuildTransport_GateDisabled_WalDisabled_NeverCreatesTheWalDirectory()
    {
        var gate = new DemoModeGate(null);
        var dir = FreshTempDir();
        var wal = new WalOptions { Directory = dir, Enabled = false };

        var transport = EdgeWorker.BuildTransport(
            gate, serverUrl: "http://localhost:5000", machineCode: "EDGE-SVC-01", verifyTls: true,
            wal: wal, mkKey: null, logger: NullLogger.Instance);

        try
        {
            Assert.False(Directory.Exists(dir));
        }
        finally
        {
            (transport as IDisposable)?.Dispose();
        }
    }

    [Fact]
    public void BuildTransport_GateDisabled_NullMkKey_StillReturnsALiveTransport()
    {
        // A not-yet-onboarded box (no CredentialStore.Load hit yet) must still boot into Live — it just
        // fails sends until a key exists (see LiveTransport's own St4iConfigException handling), rather
        // than silently falling back to a fabricated Demo fleet.
        var gate = new DemoModeGate(null);
        var wal = new WalOptions { Directory = FreshTempDir(), Enabled = false };

        var transport = EdgeWorker.BuildTransport(
            gate, serverUrl: "http://localhost:5000", machineCode: "EDGE-SVC-01", verifyTls: true,
            wal: wal, mkKey: null, logger: NullLogger.Instance);

        try
        {
            Assert.IsType<LiveTransport>(transport);
        }
        finally
        {
            (transport as IDisposable)?.Dispose();
        }
    }

    // ── ResolveGate (the `--smoke` CI-path default) ─────────────────────────────────────────────

    [Fact]
    public void ResolveGate_NoSmoke_NoRawValue_IsLiveByDefault()
    {
        Assert.False(EdgeWorker.ResolveGate(smokeCount: null, demoEnabledRaw: null).Enabled);
    }

    [Fact]
    public void ResolveGate_SmokeSet_RawUnset_DefaultsToDemo()
    {
        // README §9's `--smoke N` CI path must stay fast/deterministic without requiring the CI script
        // to learn a new env var — unset ST4I_DEMO_ENABLED under --smoke keeps behaving exactly like it
        // always did (Demo), even though a bare launch now defaults to Live.
        Assert.True(EdgeWorker.ResolveGate(smokeCount: 20, demoEnabledRaw: null).Enabled);
    }

    [Theory]
    [InlineData("")]
    [InlineData("   ")]
    public void ResolveGate_SmokeSet_RawBlank_DefaultsToDemo(string raw)
    {
        Assert.True(EdgeWorker.ResolveGate(smokeCount: 5, demoEnabledRaw: raw).Enabled);
    }

    [Fact]
    public void ResolveGate_SmokeSet_ExplicitFalse_HonorsTheExplicitOverride()
    {
        // An operator who explicitly sets ST4I_DEMO_ENABLED=false wants to smoke-test the LIVE path
        // against a real reachable server — --smoke must not silently force Demo over an explicit choice.
        Assert.False(EdgeWorker.ResolveGate(smokeCount: 20, demoEnabledRaw: "false").Enabled);
    }

    [Fact]
    public void ResolveGate_SmokeSet_ExplicitTrue_StaysDemo()
    {
        Assert.True(EdgeWorker.ResolveGate(smokeCount: 20, demoEnabledRaw: "true").Enabled);
    }

    [Fact]
    public void ResolveGate_NoSmoke_ExplicitTrue_IsDemo()
    {
        Assert.True(EdgeWorker.ResolveGate(smokeCount: null, demoEnabledRaw: "true").Enabled);
    }
}
