using System.Net;
using System.Net.Http;
using St4i.EdgeCore.Models;
using St4i.EdgeCore.Transport;
using Xunit;

namespace St4i.EdgeCore.Tests.Transport;

/// <summary>
/// owner-decisions.md item 20 — <see cref="TransportCoordinator"/> disposed the <see cref="LiveTransport"/>
/// it REPLACED and had no path at all to dispose the one it still HELD, so the last live transport of a
/// process was released by nothing in this tree. These tests pin BOTH halves of that ownership rule, so
/// neither can be removed without something going red.
///
/// 🔴 CEILING, kept exactly where the item put it: this is NOT a claim about a production leak, and
/// asserting it were one would be the same overstatement the item warned against. Both composition roots
/// register the coordinator as a DI singleton — one instance per process, socket pool reclaimed at exit
/// either way. The case that was genuinely paying was a process that builds MANY coordinators, which is
/// what these suites do across dozens of files.
///
/// HOW DISPOSAL IS OBSERVED, since <see cref="LiveTransport"/> exposes no "am I disposed" flag: the chain
/// <c>coordinator.Dispose() → LiveTransport.Dispose() → St4iDeviceClient.Dispose() → HttpClient.Dispose()</c>
/// ends at the handler, because the vendored SDK builds its client as <c>new HttpClient(handler)</c> and
/// that overload's <c>disposeHandler</c> defaults to true. So a handler that records its own disposal is a
/// faithful witness for the whole chain rather than a proxy for one link of it.
///
/// CONTROL PAIR (run, not assumed): with <see cref="TransportCoordinator.Dispose"/>'s BODY emptied and its
/// signature left in place, <c>Dispose_DisposesTheLiveTransportStillHeld</c> and
/// <c>Dispose_AfterRebuild_DisposesTheCURRENTLiveTransport</c> both FAIL and
/// <c>RebuildLive_StillDisposesTheReplacedLiveTransport</c> still PASSES — which is the point: the
/// pre-existing half was already covered, and only the new half moves.
/// </summary>
public sealed class TransportCoordinatorDisposalTests
{
    /// <summary>Records its own disposal. Deliberately NOT reusing <c>CapturingHandler</c>: that fake is
    /// shared by several suites and giving it disposal-tracking would put a second concern on a fake many
    /// tests depend on, for one caller's benefit.</summary>
    private sealed class DisposeTrackingHandler : HttpMessageHandler
    {
        public int DisposeCount { get; private set; }

        public bool WasDisposed => DisposeCount > 0;

        protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken ct) =>
            Task.FromResult(new HttpResponseMessage(HttpStatusCode.Created)
            {
                Content = new StringContent("{\"ok\":true,\"data\":{\"success\":true}}"),
            });

        protected override void Dispose(bool disposing)
        {
            if (disposing) DisposeCount++;
            base.Dispose(disposing);
        }
    }

    private static LiveTransport LiveWith(DisposeTrackingHandler handler, string machineCode) =>
        LiveTransport.ForMachine("http://127.0.0.1:1", "mk_test_key", machineCode, null, true, handler);

    /// <summary>Every coordinator here gets an explicit throwaway WAL directory. Omitting
    /// <c>walOptions</c> would default to <c>new WalOptions()</c> — WAL enabled, DEFAULT root — and
    /// <see cref="TransportCoordinator.RebuildLive"/> calls <c>EnsureDir()</c>, so the rebuild tests below
    /// would create and write under the REAL %ProgramData% WAL path instead of a temp dir. Same isolation
    /// <see cref="TransportCoordinatorWalTests"/> already applies for the same reason.</summary>
    private static TransportCoordinator NewCoordinator(
        LiveTransport initialLive, HttpMessageHandler? rebuildHandler = null)
    {
        var demo = new DemoTransport(latencyMs: 0);
        var auto = new AutoTransport(initialLive, demo);
        var switchable = new SwitchableTransport(demo);
        var wal = new WalOptions { Directory = Directory.CreateTempSubdirectory("st4i-coordinator-dispose-").FullName };
        return new TransportCoordinator(switchable, demo, initialLive, auto, TransportMode.Demo, wal, rebuildHandler);
    }

    [Fact]
    public void Dispose_DisposesTheLiveTransportStillHeld()
    {
        var handler = new DisposeTrackingHandler();
        var coordinator = NewCoordinator(LiveWith(handler, "M-HELD"));

        // Precondition, asserted rather than assumed — without it a handler that was somehow disposed at
        // construction would make the post-condition below pass for the wrong reason.
        Assert.False(handler.WasDisposed);

        coordinator.Dispose();

        Assert.True(handler.WasDisposed);
    }

    [Fact]
    public void Dispose_IsIdempotent()
    {
        // A DI container disposes its singletons; a test may also dispose the same instance. Both must be
        // able to happen without the second call doing anything.
        var handler = new DisposeTrackingHandler();
        var coordinator = NewCoordinator(LiveWith(handler, "M-TWICE"));

        coordinator.Dispose();
        coordinator.Dispose();
        coordinator.Dispose();

        Assert.Equal(1, handler.DisposeCount);
    }

    [Fact]
    public void RebuildLive_StillDisposesTheReplacedLiveTransport()
    {
        // The half that ALREADY worked. It is asserted here so that a future edit to Dispose() which
        // accidentally took over (or broke) the replace-path disposal cannot pass unnoticed — and so the
        // control pair has a member that must stay GREEN on both sides.
        var replacedHandler = new DisposeTrackingHandler();
        var coordinator = NewCoordinator(LiveWith(replacedHandler, "M-REPLACED"));

        Assert.False(replacedHandler.WasDisposed);

        coordinator.RebuildLive("http://127.0.0.1:2", "M-REPLACED", "mk_test_key", verifyTls: true);

        Assert.True(replacedHandler.WasDisposed);

        coordinator.Dispose();
    }

    [Fact]
    public void Dispose_AfterRebuild_DisposesTheCURRENTLiveTransport()
    {
        // Discriminating against a Dispose() that captured `_live` once (e.g. in the constructor) instead
        // of reading the field under the gate at disposal time: after a rebuild, the instance that must be
        // released is the NEW one. The coordinator's own handler seam is what RebuildLive forwards into
        // every LiveTransport it builds, so `rebuiltHandler` IS the second instance's witness — this does
        // not settle for "the first one wasn't disposed twice".
        var firstHandler = new DisposeTrackingHandler();
        var rebuiltHandler = new DisposeTrackingHandler();
        var coordinator = NewCoordinator(LiveWith(firstHandler, "M-SEQ"), rebuiltHandler);

        coordinator.RebuildLive("http://127.0.0.1:3", "M-SEQ", "mk_test_key", verifyTls: true);

        Assert.True(firstHandler.WasDisposed);      // released by the rebuild itself
        Assert.False(rebuiltHandler.WasDisposed);   // the current one is still live

        coordinator.Dispose();

        Assert.True(rebuiltHandler.WasDisposed);    // ...and only Dispose() could have released it
        Assert.Equal(1, firstHandler.DisposeCount); // not re-released
    }
}
