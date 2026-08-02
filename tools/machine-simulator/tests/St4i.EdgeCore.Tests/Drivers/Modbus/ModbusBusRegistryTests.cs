using St4i.EdgeCore.Drivers.Modbus;
using Xunit;

namespace St4i.EdgeCore.Tests.Drivers.Modbus;

/// <summary>
/// Task D-2 — the sharing/reference-count contract, as D-4 will consume it. D-2 puts only one device on a
/// bus; these tests pin the N-device behaviour anyway, because the seam is being designed for D-4 now rather
/// than bent to fit later.
/// </summary>
public class ModbusBusRegistryTests
{
    private static Func<CancellationToken, Task<IModbusBusLink>> Opener(InMemoryBusLinkPair pair, Action? onOpen = null)
        => _ => { onOpen?.Invoke(); return Task.FromResult<IModbusBusLink>(pair.Master); };

    [Fact]
    public async Task TwoLeasesForOneKey_ShareOneBus_AndTheOpenerIsUsedOnlyOnce()
    {
        await using var registry = new ModbusBusRegistry();
        var pair = InMemoryBusLinkPair.Create();
        var openCount = 0;

        await using var first = registry.Acquire("bus-A", Opener(pair, () => openCount++));
        await using var second = registry.Acquire("bus-A", Opener(pair, () => openCount++));

        Assert.Same(first.Bus, second.Bus);
        Assert.Equal(2, registry.LeaseCount("bus-A"));

        // Acquire performs NO I/O — the link is opened lazily, which is what makes it safe to call from a
        // driver constructor (IDeviceDriver's own conformance rule).
        Assert.Equal(0, openCount);
        Assert.Equal(0, first.Bus.LinkGeneration);
    }

    [Fact]
    public async Task DifferentKeys_GetDifferentBuses()
    {
        await using var registry = new ModbusBusRegistry();
        var pairA = InMemoryBusLinkPair.Create();
        var pairB = InMemoryBusLinkPair.Create();

        await using var a = registry.Acquire("bus-A", Opener(pairA));
        await using var b = registry.Acquire("bus-B", Opener(pairB));

        Assert.NotSame(a.Bus, b.Bus);
        Assert.Equal(1, registry.LeaseCount("bus-A"));
        Assert.Equal(1, registry.LeaseCount("bus-B"));
    }

    /// <summary>
    /// 🔴 "The last release disposes, an earlier release does not" — asserted on the BUS's own usability, not
    /// only on a counter. A disposed bus refuses transactions, so driving one is the assertion that
    /// distinguishes "still alive" from "the counter says 1".
    /// </summary>
    [Fact]
    public async Task ReleasingOneOfTwoLeases_LeavesTheBusAliveAndUsable()
    {
        await using var harness = ModbusRtuLoopbackHarness.Start(((byte)1, new ushort[] { 64, 0 }));
        var first = harness.Lease();
        var second = harness.Lease();
        var bus = first.Bus;

        await first.DisposeAsync();

        Assert.Equal(1, harness.Registry.LeaseCount(harness.BusKey));
        Assert.True(harness.Registry.HasBus(harness.BusKey));

        await using (var transaction = await bus.BeginTransactionAsync(2_000, 0, CancellationToken.None))
        {
            var value = await transaction.ExecuteAsync(m => m.ReadHoldingRegistersAsync(1, 0, 1));
            Assert.Equal(64, value[0]);
        }

        await second.DisposeAsync();
    }

    /// <summary>The last release disposes — asserted by the bus REFUSING work afterwards, not by absence of
    /// the map entry alone. A registry that forgot the bus but never disposed the link would leak a socket
    /// (or, in D-3, hold a COM port open against every later attempt to use it) and pass a
    /// map-entry-only assertion.</summary>
    [Fact]
    public async Task ReleasingTheLastLease_DisposesTheBus()
    {
        var harness = ModbusRtuLoopbackHarness.Start(((byte)1, new ushort[] { 64, 0 }));
        var lease = harness.Lease();
        var bus = lease.Bus;

        await using (var warmup = await bus.BeginTransactionAsync(2_000, 0, CancellationToken.None))
        {
            await warmup.ExecuteAsync(m => m.ReadHoldingRegistersAsync(1, 0, 1));
        }
        Assert.Equal(1, bus.LinkGeneration);

        await lease.DisposeAsync();

        Assert.Equal(0, harness.Registry.LeaseCount(harness.BusKey));
        Assert.False(harness.Registry.HasBus(harness.BusKey));
        await Assert.ThrowsAsync<ObjectDisposedException>(
            () => bus.BeginTransactionAsync(1_000, 0, CancellationToken.None));

        await harness.DisposeAsync();
    }

    /// <summary>
    /// 🔴 Releasing a lease twice decrements ONCE. <c>FleetHost</c> best-effort disposes drivers both on fault
    /// and on restart, so this genuinely happens; a double decrement would dispose a bus that other drivers
    /// are still using, and the symptom would appear on an unrelated device with nothing pointing back here.
    /// The assertion is again the surviving bus's usability, not the counter alone.
    /// </summary>
    [Fact]
    public async Task ReleasingALeaseTwice_DecrementsOnce_AndLeavesASiblingLeaseWorking()
    {
        await using var harness = ModbusRtuLoopbackHarness.Start(((byte)1, new ushort[] { 99, 0 }));
        var doomed = harness.Lease();
        var survivor = harness.Lease();
        var bus = survivor.Bus;

        await doomed.DisposeAsync();
        await doomed.DisposeAsync();

        Assert.True(doomed.IsReleased);
        Assert.Equal(1, harness.Registry.LeaseCount(harness.BusKey));
        Assert.True(harness.Registry.HasBus(harness.BusKey));

        await using (var transaction = await bus.BeginTransactionAsync(2_000, 0, CancellationToken.None))
        {
            var value = await transaction.ExecuteAsync(m => m.ReadHoldingRegistersAsync(1, 0, 1));
            Assert.Equal(99, value[0]);
        }

        await survivor.DisposeAsync();
    }

    /// <summary>Releasing then re-acquiring the same key builds a genuinely new bus, rather than resurrecting
    /// a disposed one.</summary>
    [Fact]
    public async Task ReacquiringAKeyAfterTheLastRelease_BuildsAFreshBus()
    {
        await using var registry = new ModbusBusRegistry();
        var pair = InMemoryBusLinkPair.Create();

        var first = registry.Acquire("bus-A", Opener(pair));
        var firstBus = first.Bus;
        await first.DisposeAsync();

        await using var second = registry.Acquire("bus-A", Opener(pair));
        Assert.NotSame(firstBus, second.Bus);
        Assert.Equal(1, registry.LeaseCount("bus-A"));
    }

    /// <summary>Registry disposal tears every bus down regardless of outstanding leases, and a lease released
    /// afterwards is a harmless no-op — teardown ordering between a host and its drivers is not something a
    /// driver being disposed should have to get right.</summary>
    [Fact]
    public async Task DisposingTheRegistry_DisposesEveryBus_AndALaterLeaseReleaseIsHarmless()
    {
        var registry = new ModbusBusRegistry();
        var pair = InMemoryBusLinkPair.Create();
        var lease = registry.Acquire("bus-A", Opener(pair));
        var bus = lease.Bus;

        await registry.DisposeAsync();

        await Assert.ThrowsAsync<ObjectDisposedException>(() => bus.BeginTransactionAsync(1_000, 0, CancellationToken.None));
        Assert.False(registry.HasBus("bus-A"));

        await lease.DisposeAsync();   // must not throw
        Assert.True(lease.IsReleased);
    }

    [Fact]
    public async Task AcquireAfterRegistryDisposal_Throws()
    {
        var registry = new ModbusBusRegistry();
        var pair = InMemoryBusLinkPair.Create();
        await registry.DisposeAsync();

        Assert.Throws<ObjectDisposedException>(() => registry.Acquire("bus-A", Opener(pair)));
    }

    /// <summary>
    /// 🔴 <see cref="ModbusBusSettings"/>'s declared defaults are what an unconfigured bus actually gets.
    /// This looks tautological and is not: the type shipped as a <c>readonly record struct</c> first, and for
    /// a struct <c>new ModbusBusSettings()</c> silently produces the ZERO value and discards the declared
    /// defaults — a 0 ms quiet window, i.e. a resynchronisation step that runs and observes nothing. Every
    /// test in this file caught it, but only because they exercise the default path; this one states the
    /// property directly so a future change back to a struct (or to <c>default</c> anywhere) fails here, by
    /// name, instead of scattering unrelated failures.
    /// </summary>
    [Fact]
    public void TheDefaultSettings_AreTheDeclaredDefaults_NotTheZeroValue()
    {
        Assert.Equal(50, ModbusBusSettings.Default.QuietWindowMs);
        Assert.Equal(5, ModbusBusSettings.Default.PollSliceMs);

        var freshlyConstructed = new ModbusBusSettings();
        Assert.Equal(50, freshlyConstructed.QuietWindowMs);
        Assert.Equal(5, freshlyConstructed.PollSliceMs);
    }

    /// <summary>A quiet window of zero is refused at construction. It reads as a harmless "turn the delay
    /// off", and would silently mean "observe silence without looking" — the hopeful answer this whole
    /// mechanism exists to replace.</summary>
    [Fact]
    public async Task ANonPositiveQuietWindow_IsRefused()
    {
        await using var registry = new ModbusBusRegistry();
        var pair = InMemoryBusLinkPair.Create();

        Assert.Throws<ArgumentOutOfRangeException>(
            () => registry.Acquire("bus-A", _ => Task.FromResult<IModbusBusLink>(pair.Master), new ModbusBusSettings(QuietWindowMs: 0)));
        Assert.Throws<ArgumentOutOfRangeException>(
            () => registry.Acquire("bus-B", _ => Task.FromResult<IModbusBusLink>(pair.Master), new ModbusBusSettings(PollSliceMs: 0)));
    }

    /// <summary>
    /// Concurrent acquires for one key produce one bus and an exact lease count — the registry's own lock,
    /// exercised rather than assumed.
    ///
    /// <para>The racers run on DEDICATED threads, not the pool. A <see cref="Barrier"/> cannot release until
    /// every participant has arrived, so 32 <c>Task.Run</c> racers block 32 pool threads at once and wait on
    /// threads the pool injects at roughly one per second — which does not merely make this test slow, it
    /// starves every other test running in parallel. Diagnosed, not guessed: this class was bisected out as
    /// the cause of three pre-existing Modbus TCP tests failing (a poll that normally lands in milliseconds
    /// timing out after 5 s, and a request never reaching the wire at all). See <see cref="BlockingWork"/>.</para>
    /// </summary>
    [Fact]
    public async Task ConcurrentAcquiresForOneKey_ProduceExactlyOneBus()
    {
        await using var registry = new ModbusBusRegistry();
        var pair = InMemoryBusLinkPair.Create();

        const int racers = 32;
        using var start = new Barrier(racers);
        var leases = new ModbusBusLease[racers];

        await Task.WhenAll(Enumerable.Range(0, racers).Select(i => BlockingWork.Run(() =>
        {
            start.SignalAndWait();
            leases[i] = registry.Acquire("bus-race", Opener(pair));
        }, $"acquire-racer-{i}")));

        Assert.Equal(racers, registry.LeaseCount("bus-race"));
        Assert.All(leases, l => Assert.Same(leases[0].Bus, l.Bus));

        foreach (var l in leases) await l.DisposeAsync();
        Assert.False(registry.HasBus("bus-race"));
    }
}
