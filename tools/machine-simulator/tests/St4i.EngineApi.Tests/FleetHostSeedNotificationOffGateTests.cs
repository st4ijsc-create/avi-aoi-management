using System.Collections.Concurrent;
using System.Diagnostics;
using St4i.Connector.Abstractions.Models;
using St4i.EdgeCore.Infrastructure;
using St4i.EdgeCore.Models;
using St4i.EdgeCore.Transport;
using St4i.EngineApi.AssetRegistry;
using St4i.EngineApi.Fleet;
using Xunit;

namespace St4i.EngineApi.Tests;

/// <summary>
/// 🔴 Task G-1 (.superpowers/sdd/gate-and-log-channel/task-1-brief.md, part 1) — the witness for blueprint
/// §9.2 violation 3, which E-2 recorded and deliberately did not fix because a fix folded into a MOVE makes
/// "behaviour unchanged" untrue.
///
/// <para><b>What the defect was.</b> <c>FleetCore.RegisterMachine</c> invoked its host-supplied
/// <c>onMachineSeeded</c> callback while holding <c>_gate</c> — the same lock <c>Estop()</c> takes.
/// <c>_ = assetRegistry.UpsertAsync(descriptor)</c> reads as fire-and-forget and is not: Microsoft.Data.Sqlite
/// does not override the async ADO.NET members, so a real <c>AssetRegistryStore</c> runs its whole open+insert
/// on the calling thread. Blueprint §9.2 MEASURED a thread merely reading <c>EstopEngaged</c> blocked up to
/// <b>12.35 ms</b> by it.
///
/// <para><b>Why the first test here is a measurement and not a shape check.</b> §8.1's fifth rule: a
/// mitigation must be verified by measuring its effect on the thing it protects, on the production path,
/// with no observer the mechanism does not itself need. What this task protects is a reader of the halt
/// latch, so that is what is timed — not "is the invoke lexically outside the lock", which is the reading
/// that D-7a proved worthless. The registry double blocks SYNCHRONOUSLY (a <c>Thread.Sleep</c>, faithful to
/// the sync-shim behaviour above) for <see cref="SeedCallbackBlockFor"/>; with the fix the
/// <c>EstopEngaged</c> read returns inside <see cref="ReaderBudget"/>, without it the read cannot return
/// until the callback does. The bound is deliberately a wide multiple of the measured 12.35 ms rather than
/// a tight one — this asserts "the lock is not held across the callback at all", which is a structural
/// property, not a latency budget that a slow CI box could shave.
///
/// <para><b>MUTATION-PROVEN, not read.</b> Reverting the fix (invoking <c>_onMachineSeeded</c> inside
/// <c>RegisterMachine</c>'s <c>lock (_gate)</c> again) turns
/// <see cref="WhileASeedCallbackIsRunning_AReaderOfTheHaltLatchIsNotBlocked_Measured"/> RED. It does not
/// hang: the callback's block is bounded, so the mutant fails on the elapsed assertion and the suite
/// completes.
///
/// <para><b>The second test is the other half, and it is the harder half.</b> Moving a call out of a lock
/// is what makes "exactly one notification per seeded machine, in fleet order, never before the machine is
/// registered" breakable. All three are pinned here — deliberately testing what changed, not what was kept.
/// </summary>
public sealed class FleetHostSeedNotificationOffGateTests
{
    /// <summary>How long the fake registry's upsert holds the calling thread for the ONE machine the
    /// measurement registers. Long enough that a lock held across it is unmistakable, short enough that the
    /// mutant fails fast instead of looking like a hang.</summary>
    private static readonly TimeSpan SeedCallbackBlockFor = TimeSpan.FromSeconds(2);

    /// <summary>The budget for a single <c>EstopEngaged</c> read taken while the callback above is running.
    /// A quarter of the block — any value below it says the gate was not held across the callback.</summary>
    private static readonly TimeSpan ReaderBudget = TimeSpan.FromMilliseconds(500);

    private const string BlockingCode = "G1-SEED-BLOCKS-01";

    private static FleetHost CreateHost(IAssetRegistry? assetRegistry)
    {
        var demo = new DemoTransport(latencyMs: 0);
        var live = LiveTransport.ForMachine("http://localhost:1", mkKey: "", machineCode: "TEST", queuePath: null, verifyTls: true);
        var auto = new AutoTransport(live, demo);
        var switchable = new SwitchableTransport(demo);
        var coordinator = new TransportCoordinator(switchable, demo, live, auto, TransportMode.Demo);
        var eventBus = new EventBus();
        return new FleetHost(switchable, coordinator, eventBus, assetRegistry: assetRegistry);
    }

    private static MachineDescriptor NewDescriptor(string code) => new(
        Code: code,
        SerialSeed: $"SN-{code}",
        DeviceClass: DeviceClass.Automation,
        MachineType: "MODBUS_TCP",
        StepType: null,
        DriverKind: DriverKinds.Modbus,
        RecipeCode: null,
        MappingProfile: null,
        CycleSeconds: 1.0);

    [Fact]
    public async Task WhileASeedCallbackIsRunning_AReaderOfTheHaltLatchIsNotBlocked_Measured()
    {
        var registry = new BlockingAssetRegistry(BlockingCode, SeedCallbackBlockFor);
        var host = CreateHost(registry);

        // The fleet is deliberately NOT started: this isolates the seed notification from the restart path,
        // so a green result cannot be explained by anything but where the callback runs.
        Assert.False(host.IsRunning);

        var register = Task.Run(() => host.RegisterMachine(NewDescriptor(BlockingCode)));

        Assert.True(
            registry.CallbackEntered.Wait(TimeSpan.FromSeconds(10)),
            "the seed callback should have been invoked for the registered machine");

        // THE MEASUREMENT. EstopEngaged is a `lock (_gate) return _estopEngaged` getter — the very reader
        // blueprint §9.2 timed at 12.35 ms — and Estop() takes that same lock.
        var stopwatch = Stopwatch.StartNew();
        var latched = host.EstopEngaged;
        stopwatch.Stop();

        Assert.True(
            await register,
            "the registration itself must still succeed — a fast read of a machine that was never registered proves nothing");
        Assert.True(registry.Upserted.Contains(BlockingCode), "the callback must actually have run for this machine");
        Assert.False(latched);

        Assert.True(
            stopwatch.Elapsed < ReaderBudget,
            $"a reader of the HALT latch waited {stopwatch.Elapsed.TotalMilliseconds:F1} ms while a seed " +
            $"callback ran; budget is {ReaderBudget.TotalMilliseconds:F0} ms and the callback blocks for " +
            $"{SeedCallbackBlockFor.TotalMilliseconds:F0} ms — _gate is being held across the callback again");
    }

    [Fact]
    public void SeedNotifications_AreOncePerMachine_InRosterOrder_AndNeverBeforeTheMachineIsInTheRoster()
    {
        var registry = new OrderRecordingAssetRegistry();
        var host = CreateHost(registry);

        // (a) CONSTRUCTOR SEEDING — one notification per roster machine, in fleet order. Asserted against
        //     the host's own roster rather than a hardcoded list, and asserted non-empty so the equality
        //     below cannot pass vacuously on two empty sequences.
        var rosterAtConstruction = host.Fleet.Select(d => d.Code).ToList();
        Assert.NotEmpty(rosterAtConstruction);
        Assert.Equal(rosterAtConstruction, registry.Order);

        // (b) From here on, every upsert also answers "was this machine already in the roster when I was
        //     told about it?" — the invariant that taking the call out of the lock could have inverted.
        registry.RosterProbe = code => host.Fleet.Any(d => string.Equals(d.Code, code, StringComparison.OrdinalIgnoreCase));

        Assert.True(host.RegisterMachine(NewDescriptor("G1-ORDER-A")));
        Assert.True(host.RegisterMachine(NewDescriptor("G1-ORDER-B")));

        // (c) A REFUSED registration owes no notification — the enqueue sits after both failure returns.
        Assert.False(host.RegisterMachine(NewDescriptor("G1-ORDER-A")));

        Assert.Equal(
            rosterAtConstruction.Concat(new[] { "G1-ORDER-A", "G1-ORDER-B" }).ToList(),
            registry.Order);
        Assert.Empty(registry.NotifiedBeforeRegistered);
    }

    /// <summary>Test double that reproduces the ONE property of a real <c>AssetRegistryStore</c> that
    /// matters here and that <c>FakeAssetRegistry</c> (a <c>ConcurrentDictionary</c> returning
    /// <see cref="Task.CompletedTask"/>) cannot: the upsert consumes the CALLING thread. Blueprint §9.2's
    /// own review correction says exactly this — the existing fakes "cannot tell synchronous from
    /// asynchronous apart", which is why a defect measured on a real store had no witness for four batches.
    ///
    /// <para>Blocks only for <paramref name="blockingCode"/>: the constructor seeds the whole demo roster
    /// through this same callback, and blocking there would cost N × the delay for no added evidence.</para>
    /// </summary>
    private sealed class BlockingAssetRegistry : IAssetRegistry
    {
        private readonly string _blockingCode;
        private readonly TimeSpan _blockFor;

        public BlockingAssetRegistry(string blockingCode, TimeSpan blockFor)
        {
            _blockingCode = blockingCode;
            _blockFor = blockFor;
        }

        public ManualResetEventSlim CallbackEntered { get; } = new(false);

        public ConcurrentBag<string> Upserted { get; } = new();

        public Task UpsertAsync(MachineDescriptor descriptor, CancellationToken ct = default)
        {
            Upserted.Add(descriptor.Code);

            if (string.Equals(descriptor.Code, _blockingCode, StringComparison.OrdinalIgnoreCase))
            {
                CallbackEntered.Set();
                Thread.Sleep(_blockFor);
            }

            return Task.CompletedTask;
        }

        public Task<AssetRecord?> GetAsync(string code, CancellationToken ct = default) => Task.FromResult<AssetRecord?>(null);

        public Task<IReadOnlyList<AssetRecord>> ListAsync(CancellationToken ct = default) =>
            Task.FromResult<IReadOnlyList<AssetRecord>>(Array.Empty<AssetRecord>());

        public Task<AssetRecord?> SetLifecycleAsync(string code, AssetLifecycleState state, CancellationToken ct = default) =>
            Task.FromResult<AssetRecord?>(null);
    }

    /// <summary>Records the ORDER and MULTIPLICITY of seed notifications, and — through
    /// <see cref="RosterProbe"/> — whether the roster already contained each machine at the moment it was
    /// announced.</summary>
    private sealed class OrderRecordingAssetRegistry : IAssetRegistry
    {
        private readonly List<string> _order = new();
        private readonly object _gate = new();

        /// <summary>Set AFTER construction (the host reference does not exist during its own ctor). Null
        /// means "do not probe", which is how the constructor-seeding pass is allowed to run.</summary>
        public Func<string, bool>? RosterProbe { get; set; }

        public List<string> NotifiedBeforeRegistered { get; } = new();

        public IReadOnlyList<string> Order
        {
            get { lock (_gate) return _order.ToList(); }
        }

        public Task UpsertAsync(MachineDescriptor descriptor, CancellationToken ct = default)
        {
            var probe = RosterProbe;
            var registered = probe is null || probe(descriptor.Code);

            lock (_gate)
            {
                _order.Add(descriptor.Code);
                if (!registered) NotifiedBeforeRegistered.Add(descriptor.Code);
            }

            return Task.CompletedTask;
        }

        public Task<AssetRecord?> GetAsync(string code, CancellationToken ct = default) => Task.FromResult<AssetRecord?>(null);

        public Task<IReadOnlyList<AssetRecord>> ListAsync(CancellationToken ct = default) =>
            Task.FromResult<IReadOnlyList<AssetRecord>>(Array.Empty<AssetRecord>());

        public Task<AssetRecord?> SetLifecycleAsync(string code, AssetLifecycleState state, CancellationToken ct = default) =>
            Task.FromResult<AssetRecord?>(null);
    }
}
