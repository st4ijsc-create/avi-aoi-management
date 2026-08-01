using System.Collections.Concurrent;
using System.Diagnostics;
using System.Runtime.CompilerServices;
using System.Text.Json;
using Microsoft.Data.Sqlite;
using Microsoft.Extensions.Logging.Abstractions;
using St4i.Connector.Abstractions;
using St4i.Connector.Abstractions.Models;
using St4i.EdgeCore.Infrastructure;
using St4i.EdgeCore.Mapping;
using St4i.EdgeCore.Models;
using St4i.EdgeCore.Transport;
using St4i.EngineApi.Alarms;
using St4i.EngineApi.Auth;
using St4i.EngineApi.Fleet;
using St4i.EngineApi.Policy;
using St4i.EngineApi.Policy.Rules;
using St4i.EngineApi.Safety;
using Xunit;

namespace St4i.EngineApi.Tests.Alarms;

/// <summary>
/// 🔴 Task C-6 — <see cref="RelayNotificationChannel"/>: the only channel in this product where a
/// notification moves something physical.
///
/// <para><b>Nothing about the write path is faked below the driver.</b> Every test drives a real
/// <see cref="FleetHost"/> with a real injected <see cref="IWritableDeviceDriver"/>, a real
/// <see cref="PolicyEngine"/> holding the three real rules in the real order <c>Program.cs</c> registers
/// them, a real <see cref="AuditRecorder"/>, and a real <see cref="NotificationConfigStore"/> over a
/// throwaway directory. The test double is the DRIVER and nothing above it — because what these tests are
/// about is precisely whether the gate, the resolution path and the outcome vocabulary are being used
/// correctly, which a faked <c>FleetHost</c> would define away.</para>
/// </summary>
public sealed class RelayNotificationChannelTests : IDisposable
{
    private const string MachineCode = "RELAY-01";
    private const string PointName = "beacon";
    private const string CommandName = "sound-horn";

    /// <summary>
    /// The FLOOR under the flap-storm test's interval, not the interval itself — that is measured at run
    /// time; see <see cref="UnderAFlapStorm_TheCoilWriteRateIsBounded_MeasuredInElapsedTime"/>.
    ///
    /// <para>Smaller than the 2 s this channel ships with (see
    /// <see cref="RelayNotificationChannel.DefaultMinWriteInterval"/>) so the bound can be MEASURED rather
    /// than waited out — but deliberately NOT as small as possible.</para>
    ///
    /// <para>🔴 The interval must stay comfortably LARGER than one dispatch's own work (a config read, a
    /// policy evaluation, a real driver call and an audit append — observed at roughly 25 ms idle and
    /// 100 ms under full-suite load). If it does not, two things break at once: the elapsed floor in that
    /// test can be satisfied by the WORK alone (so it would pass with the rate limiter deleted — the
    /// vacuity class this batch keeps catching), and the limiter legitimately never waits, so the
    /// <c>RateLimited &gt; 0</c> smoke check fails while nothing is wrong.</para>
    ///
    /// <para>🔴 Closeout round (B-2): 400 ms used to be the interval outright, which made both of those
    /// properties depend on an assumption about machine speed baked in as a constant — the same
    /// machine-coupling that already forced one over-specified assertion in that test to be weakened. It is
    /// now only the LOWER BOUND; the test measures a warm dispatch and takes
    /// <c>max(400 ms, 4 x measured)</c>, so the 4x margin is a fact about the machine the test is running
    /// on rather than about the machine it was written on.</para></summary>
    private static readonly TimeSpan FastIntervalFloor = TimeSpan.FromMilliseconds(400);

    /// <summary>Effectively off, for the many tests whose subject is not the limiter.</summary>
    private static readonly TimeSpan NoInterval = TimeSpan.Zero;

    private readonly List<string> _tempDirs = new();
    private readonly List<FleetHost> _hosts = new();

    public void Dispose()
    {
        foreach (var host in _hosts)
        {
            try { host.AdditionalPipelinesForTests = null; host.Stop(); } catch { /* best-effort */ }
        }

        foreach (var dir in _tempDirs)
        {
            try { Directory.Delete(dir, recursive: true); } catch { /* best-effort */ }
        }
    }

    // ─────────────────────────────────────────────────────────────────────
    // Harness
    // ─────────────────────────────────────────────────────────────────────

    private string NewTempDir()
    {
        var dir = Directory.CreateTempSubdirectory("st4i-relay-tests-").FullName;
        _tempDirs.Add(dir);
        return dir;
    }

    /// <summary>The same composition every other <see cref="FleetHost"/> suite in this project uses — Demo
    /// mode, no real network call ever made.</summary>
    private FleetHost CreateHost()
    {
        var demo = new DemoTransport(latencyMs: 0);
        var live = LiveTransport.ForMachine("http://localhost:1", mkKey: "", machineCode: "TEST", queuePath: null, verifyTls: true);
        var auto = new AutoTransport(live, demo);
        var switchable = new SwitchableTransport(demo);
        var coordinator = new TransportCoordinator(switchable, demo, live, auto, TransportMode.Demo);
        var host = new FleetHost(switchable, coordinator, new EventBus());
        _hosts.Add(host);
        return host;
    }

    /// <summary>A roster member whose <see cref="MachineDescriptor.DriverKind"/> is
    /// <see cref="DriverKinds.Modbus"/>, paired with an injected slot labelled <c>modbus</c> — the cheapest
    /// way to get a live, resolvable, WRITABLE slot without standing up NModbus. Copied from
    /// <c>FleetHostMachineDriverResolutionTests</c>, which is where this recipe is argued.</summary>
    private static MachineDescriptor ModbusStyleMachine(string code) => new(
        code, $"SN-{code}", DeviceClass.Automation, "MODBUS_TCP", null,
        DriverKinds.Modbus, null, null, CycleSeconds: 0.5);

    /// <summary>Brings up a live, writable slot for <see cref="MachineCode"/> and waits until Đợt B's own
    /// resolution agrees it is <see cref="MachineDriverAvailability.Writable"/> — so no test below can pass
    /// or fail for want of a driver that had not started yet.</summary>
    private async Task<FakeAnnunciatorDriver> StartWritableFleetAsync(FleetHost host, FakeAnnunciatorDriver? driver = null)
    {
        driver ??= new FakeAnnunciatorDriver();
        Assert.True(host.RegisterMachine(ModbusStyleMachine(MachineCode)));
        host.AdditionalPipelinesForTests = () => new List<(string Label, IDeviceDriver Driver, MappingProfile Profile)>
        {
            ("modbus", driver, new MappingProfile { Name = "modbus", DeviceClass = "Test" }),
        };
        host.Start();

        var deadline = DateTime.UtcNow.AddSeconds(15);
        while (host.GetMachineDriverAvailability(MachineCode) != MachineDriverAvailability.Writable &&
               DateTime.UtcNow < deadline)
        {
            await Task.Delay(25);
        }

        Assert.Equal(MachineDriverAvailability.Writable, host.GetMachineDriverAvailability(MachineCode));
        return driver;
    }

    /// <summary>
    /// 🔴 Brings the fleet back up after a HALT, and it is needed for a reason worth stating rather than
    /// working around silently: <see cref="FleetHost.Estop"/> does not only latch a flag, it TEARS DOWN every
    /// live pipeline. So after <see cref="FleetHost.ResetEstop"/> the machine resolves as
    /// <see cref="MachineDriverAvailability.NoLiveDriver"/> until the fleet is started again — which means
    /// the real product behaviour is that a HALT leaves the annunciator undriveable for longer than the
    /// latch itself is engaged. The relay reports that honestly (<c>NoLiveDriver</c>, its own counter) rather
    /// than as a refusal.
    /// </summary>
    private static async Task RestartWritableAsync(FleetHost host)
    {
        host.Start();
        var deadline = DateTime.UtcNow.AddSeconds(15);
        while (host.GetMachineDriverAvailability(MachineCode) != MachineDriverAvailability.Writable &&
               DateTime.UtcNow < deadline)
        {
            await Task.Delay(25);
        }

        Assert.Equal(MachineDriverAvailability.Writable, host.GetMachineDriverAvailability(MachineCode));
    }

    /// <summary>🔴 The REAL rule set, in the REAL order <c>Program.cs</c> registers it (safety first, so a
    /// SAFETY_BLOCKED denial wins over a later role denial). Built here rather than resolved from a host so
    /// these tests need no <c>WebApplicationFactory</c>; a drift between this list and <c>Program.cs</c>'s
    /// would show up as a rule that stopped gating, which
    /// <see cref="TheRelayPresentsDotBsOwnActionIds_SoEveryRuleAlreadyGatesIt"/> pins independently.</summary>
    private static PolicyEngine RealPolicyEngine() => new(new IPolicyRule[]
    {
        new EstopGuardRule(),
        new CriticalAlarmGuardRule(),
        new RoleObligationRule(),
    });

    private static (AuditRecorder Recorder, RecordingAuditStore Store) NewAudit()
    {
        var store = new RecordingAuditStore();
        return (new AuditRecorder(store, NullLogger<AuditRecorder>.Instance), store);
    }

    private RelayNotificationChannel NewChannel(
        NotificationConfigStore store, FleetHost host, AuditRecorder audit,
        TimeSpan? interval = null,
        List<string>? warnings = null, List<string>? errors = null) =>
        new(store, host, RealPolicyEngine(), audit,
            minWriteInterval: interval ?? NoInterval,
            logError: (_, msg) => { if (errors is not null) lock (errors) errors.Add(msg); },
            logWarning: msg => { if (warnings is not null) lock (warnings) warnings.Add(msg); });

    private static NotificationJob Job(
        AlarmEdgeKind edge, string key, AlarmPriority priority = AlarmPriority.Critical, long sequence = 1) =>
        new(sequence, edge, MakeAlarm(key, priority), DateTimeOffset.UtcNow, null, null);

    private static Alarm MakeAlarm(string key, AlarmPriority priority) =>
        new(1, key, AlarmSource.DriverHealth, "DOWN", priority, AlarmState.Active, "synthetic", null, key,
            false, 1, DateTimeOffset.UtcNow, DateTimeOffset.UtcNow, null, null);

    private static Task<bool> SavePointRelayAsync(
        NotificationConfigStore store, AlarmPriority minPriority = AlarmPriority.Critical, bool enabled = true,
        string instance = NotificationConfigStore.DefaultInstance, string machineCode = MachineCode,
        string onValue = "1", string offValue = "0") =>
        store.SaveRelayAsync(enabled, minPriority, machineCode, RelayTargetKind.Point, PointName,
            onValue, offValue, instance);

    // ─────────────────────────────────────────────────────────────────────
    // 1. 🔴🔴 THE NON-NEGOTIABLE: HALT latched ⇒ the beacon does not light.
    // ─────────────────────────────────────────────────────────────────────

    /// <summary>
    /// 🔴🔴 <b>THE test of this batch.</b> Đợt B established that every machine write passes
    /// <see cref="EstopGuardRule"/> and that HALT latched means nothing commands the machine. An automatic
    /// annunciator has NO human in the loop, which is exactly why it gets no exception.
    ///
    /// <para>Written to be impossible to misread, on the model of Đợt B's own equivalent: the SAME channel,
    /// the SAME configuration, the SAME alarm and the SAME driver are exercised TWICE — once with the HALT
    /// latch engaged and once with it clear. With HALT engaged: <b>zero</b> writes reached the driver, the
    /// attempt is counted <see cref="RelayChannelStats.Refused"/>, and the operator-visible warning says the
    /// annunciator was not driven. With HALT clear: the identical dispatch writes. So the test cannot pass
    /// because the channel was misconfigured, because the driver was unreachable, or because nothing was
    /// wired — every one of those worlds fails the second half.</para>
    /// </summary>
    [Fact]
    public async Task HaltLatched_TheBeaconDoesNotLight_AndNothingReachesTheDriver()
    {
        var dir = NewTempDir();
        var store = new NotificationConfigStore(dir);
        Assert.True(await SavePointRelayAsync(store));

        var host = CreateHost();
        var driver = await StartWritableFleetAsync(host);
        var (audit, auditStore) = NewAudit();
        var warnings = new List<string>();
        var channel = NewChannel(store, host, audit, warnings: warnings);

        // ── HALT engaged ────────────────────────────────────────────────────────────────────────────────
        host.Estop();
        Assert.True(host.GetSafetyStatus().EstopEngaged);

        await channel.DispatchAsync(Job(AlarmEdgeKind.Raised, "alarm-a"));

        Assert.Equal(0, driver.WriteCallCount);
        Assert.Equal(0, driver.CommandCallCount);
        Assert.Equal(1, channel.Stats.Refused);
        Assert.Equal(0, channel.Stats.Applied);

        // The product does NOT believe it lit anything.
        var halted = Assert.Single(channel.InstanceStates);
        Assert.Null(halted.Energised);
        Assert.Equal(1, halted.LatchedAlarms);

        Assert.Contains(warnings, w =>
            w.Contains("REFUSED", StringComparison.Ordinal) &&
            w.Contains("SAFETY_BLOCKED", StringComparison.Ordinal) &&
            w.Contains("NOT driven", StringComparison.Ordinal));

        // Audited as a refusal, under this channel's own identity, before any I/O.
        var denied = Assert.Single(auditStore.Rows, r => r.Action.EndsWith(".denied", StringComparison.Ordinal));
        Assert.Equal($"{MachineWriteGate.SetpointAction}.denied", denied.Action);
        Assert.Equal(RelayNotificationChannel.SystemActor, denied.ActorUsername);
        Assert.Contains("SAFETY_BLOCKED", denied.NewValueJson, StringComparison.Ordinal);

        // ── HALT clear: the IDENTICAL dispatch writes. ─────────────────────────────────────────────────
        host.ResetEstop();
        Assert.False(host.GetSafetyStatus().EstopEngaged);
        await RestartWritableAsync(host);   // Estop tore the pipelines down — see that helper.

        await channel.DispatchAsync(Job(AlarmEdgeKind.Raised, "alarm-b"));

        Assert.Equal(1, driver.WriteCallCount);
        Assert.Equal(PointName, driver.LastSetpoint?.Point);
        // 🔴 The driver receives EXACTLY what the operator declared, with the type the connector value
        // domain gives it: the stored JSON `1` is an Int64, not a double, and `true` would be a bool. That
        // is precisely why C-6 stores the raw JSON scalar rather than a typed column — see RelayValue.
        Assert.Equal(1L, driver.LastSetpoint?.Value);
        Assert.Equal(1, channel.Stats.Applied);
        Assert.True(Assert.Single(channel.InstanceStates).Energised);
    }

    /// <summary>
    /// 🔴 <b>The failure mode the brief said not to paper over: HALT is latched while the beacon is ON, so
    /// the gate refuses the OFF write too.</b>
    ///
    /// <para>No exception is carved for the release — a rule with one exception grows a second. So what is
    /// asserted is the honest consequence: the release is <see cref="RelayChannelStats.Refused"/>, and
    /// <b><see cref="RelayInstanceState.Energised"/> is still <see langword="true"/></b>. The product must
    /// never believe the beacon is off while it is on, and the warning must say so in words an operator can
    /// act on. Then, when HALT is reset, the very next edge notices the disagreement and de-energises —
    /// so the divergence is transient rather than permanent.</para>
    /// </summary>
    [Fact]
    public async Task HaltLatchedWhileLit_TheOffWriteIsRefusedToo_AndTheProductStillBelievesItIsLit()
    {
        var dir = NewTempDir();
        var store = new NotificationConfigStore(dir);
        Assert.True(await SavePointRelayAsync(store));

        var host = CreateHost();
        var driver = await StartWritableFleetAsync(host);
        var (audit, _) = NewAudit();
        var warnings = new List<string>();
        var channel = NewChannel(store, host, audit, warnings: warnings);

        await channel.DispatchAsync(Job(AlarmEdgeKind.Raised, "alarm-a"));
        Assert.True(Assert.Single(channel.InstanceStates).Energised);
        Assert.Equal(1, driver.WriteCallCount);

        host.Estop();
        await channel.DispatchAsync(Job(AlarmEdgeKind.Cleared, "alarm-a", sequence: 2));

        Assert.Equal(1, driver.WriteCallCount);          // nothing further reached the device
        Assert.Equal(1, channel.Stats.Refused);

        var stuck = Assert.Single(channel.InstanceStates);
        Assert.True(stuck.Energised);                     // 🔴 still ON, and the product says so
        Assert.Equal(0, stuck.LatchedAlarms);             // while nothing is standing

        Assert.Contains(warnings, w => w.Contains("STILL ENERGISED", StringComparison.Ordinal));

        // And it repairs itself the moment the refusal is lifted — the divergence is transient.
        host.ResetEstop();
        await RestartWritableAsync(host);
        await channel.DispatchAsync(Job(AlarmEdgeKind.Raised, "alarm-b", sequence: 3));
        await channel.DispatchAsync(Job(AlarmEdgeKind.Cleared, "alarm-b", sequence: 4));

        Assert.False(Assert.Single(channel.InstanceStates).Energised);
        Assert.Equal(0L, driver.LastSetpoint?.Value);
    }

    /// <summary>
    /// 🔴 <b>The relay presents Đợt B's OWN action ids, which is the strongest available form of "the same
    /// gate, intact".</b>
    ///
    /// <para>Asserted against the rules themselves rather than through the channel, because the hazard is
    /// specific: <see cref="EstopGuardRule"/> matches its actuating set ORDINALLY and returns "does not
    /// apply" for anything outside it. A private action id invented for the relay would therefore sail past
    /// the HALT latch entirely. This pins that the two ids the channel actually uses are the two the rules
    /// gate — and, in the other direction, that a plausible near-miss is NOT gated by
    /// <see cref="EstopGuardRule"/>, so nobody can conclude the rule is doing something fuzzy.</para>
    /// </summary>
    [Fact]
    public void TheRelayPresentsDotBsOwnActionIds_SoEveryRuleAlreadyGatesIt()
    {
        Assert.Equal(MachineWriteGate.SetpointAction, MachineWriteGate.ActionFor(RelayTargetKind.Point));
        Assert.Equal(MachineWriteGate.CommandAction, MachineWriteGate.ActionFor(RelayTargetKind.Command));

        var halted = new SafetySnapshot(EstopEngaged: true, IsRunning: false);
        var estop = new EstopGuardRule();

        foreach (var action in new[] { MachineWriteGate.SetpointAction, MachineWriteGate.CommandAction })
        {
            var denial = estop.Evaluate(new PolicyRequest(
                action, Roles.Admin, RelayNotificationChannel.SystemActor, halted));
            Assert.NotNull(denial);
            Assert.Equal(PolicyEffect.Deny, denial!.Effect);
            Assert.Equal(PolicyReasonCode.SafetyBlocked, denial.Reason);
        }

        // The near-miss: a private id would NOT be gated by EstopGuardRule at all. (The engine would then
        // default-deny it via RoleObligationRule — which is the accident that saves you, not a design.)
        Assert.Null(estop.Evaluate(new PolicyRequest(
            "alarm.relay.write", Roles.Admin, RelayNotificationChannel.SystemActor, halted)));
        var engine = RealPolicyEngine();
        Assert.Equal(
            PolicyReasonCode.Unsupported,
            engine.Evaluate(new PolicyRequest(
                "alarm.relay.write", Roles.Admin, RelayNotificationChannel.SystemActor,
                new SafetySnapshot(false, true))).Reason);

        // Least privilege: a point relay presents Engineer, not Admin.
        Assert.Equal(Roles.Engineer, MachineWriteGate.RoleFor(RelayTargetKind.Point));
        Assert.Equal(Roles.Admin, MachineWriteGate.RoleFor(RelayTargetKind.Command));
        Assert.Equal(
            PolicyReasonCode.PolicyDenied,
            engine.Evaluate(new PolicyRequest(
                MachineWriteGate.CommandAction, Roles.Engineer, RelayNotificationChannel.SystemActor,
                new SafetySnapshot(false, true))).Reason);
    }

    /// <summary>
    /// 🔴 <b>The premise beneath the one fact this channel resolves differently from the HTTP endpoint.</b>
    ///
    /// <para><see cref="RelayNotificationChannel"/> passes <c>CriticalAlarmActive: false</c>, and the whole
    /// derivation rests on this: <see cref="AlarmPriority"/> is most-severe-first, so a Critical alarm meets
    /// EVERY relay threshold and is therefore always one the relay is itself annunciating — the input to the
    /// write, never an independent reason to withhold it. If a priority above Critical is ever added, or the
    /// threshold comparison changes, this goes red and the derivation must be redone rather than silently
    /// surviving as folklore.</para>
    ///
    /// <para>The second row is the non-vacuity control: a HIGH alarm does NOT meet a Critical threshold, so
    /// this theory is asserting a real distinction rather than "everything meets everything".</para>
    /// </summary>
    [Theory]
    [InlineData(AlarmPriority.Critical, AlarmPriority.Critical, true)]
    [InlineData(AlarmPriority.Critical, AlarmPriority.High, true)]
    [InlineData(AlarmPriority.Critical, AlarmPriority.Medium, true)]
    [InlineData(AlarmPriority.Critical, AlarmPriority.Low, true)]
    [InlineData(AlarmPriority.High, AlarmPriority.Critical, false)]
    [InlineData(AlarmPriority.Low, AlarmPriority.High, false)]
    public void ACriticalAlarmMeetsEveryRelayThreshold_WhichIsWhyTheCriticalGuardCannotGateThisChannel(
        AlarmPriority alarm, AlarmPriority threshold, bool expected) =>
        Assert.Equal(expected, NotificationDelivery.MeetsThreshold(alarm, threshold));

    /// <summary>
    /// 🔴 The functional consequence of that derivation, asserted end to end: <b>a relay configured at the
    /// Critical threshold actually lights for a Critical alarm.</b>
    ///
    /// <para>This is the headline configuration and it is the one that <see cref="CriticalAlarmGuardRule"/>
    /// would make structurally impossible if this channel resolved <c>CriticalAlarmActive</c> the way the
    /// HTTP endpoint does — the very alarm that should light the beacon is the one that would block the
    /// write, so the beacon would be guaranteed dark exactly when the plant is in its worst state. Mutating
    /// the channel to pass <c>true</c> fails this test alone.</para>
    /// </summary>
    [Fact]
    public async Task ARelayAtTheCriticalThreshold_ActuallyLightsForACriticalAlarm()
    {
        var dir = NewTempDir();
        var store = new NotificationConfigStore(dir);
        Assert.True(await SavePointRelayAsync(store, AlarmPriority.Critical));

        var host = CreateHost();
        var driver = await StartWritableFleetAsync(host);
        var (audit, _) = NewAudit();
        var channel = NewChannel(store, host, audit);

        await channel.DispatchAsync(Job(AlarmEdgeKind.Raised, "critical-1", AlarmPriority.Critical));

        Assert.Equal(1, channel.Stats.Applied);
        Assert.Equal(1, driver.WriteCallCount);
        Assert.True(Assert.Single(channel.InstanceStates).Energised);
    }

    // ─────────────────────────────────────────────────────────────────────
    // 2. Edge-driven, not tick-driven: the latch.
    // ─────────────────────────────────────────────────────────────────────

    /// <summary>
    /// 🔴 <b>The storm pattern produces ONE write, not one per tick and not one per alarm.</b>
    ///
    /// <para>Two storms in one test, because they are different mechanisms. First, C-1's edge detector never
    /// hands a re-raise over at all — driven here through a REAL <see cref="AlarmStore"/> and a REAL
    /// <see cref="AlarmNotifier"/> so the whole chain is exercised. Second, this channel's own latch absorbs
    /// a hundred DISTINCT alarms into a single energise, which the edge detector cannot do because every one
    /// of them is a genuine edge.</para>
    ///
    /// <para>Non-vacuity: the notifier's own <c>Suppressed</c> counter is asserted (zero in every degenerate
    /// world where nothing was detected), the latch is asserted to hold all 100 keys, and the ONE write is
    /// asserted to have carried the configured energise value.</para>
    /// </summary>
    [Fact]
    public async Task AStormOfAlarms_ProducesExactlyOneWrite_NotOnePerAlarmAndNotOnePerTick()
    {
        var dir = NewTempDir();
        var store = new NotificationConfigStore(dir);
        Assert.True(await SavePointRelayAsync(store, AlarmPriority.High));

        var host = CreateHost();
        var driver = await StartWritableFleetAsync(host);
        var (audit, _) = NewAudit();
        var channel = NewChannel(store, host, audit);

        // ── Storm 1: one alarm, restated 240 times, through the REAL detector and the REAL store. ──────
        var alarmsDir = NewTempDir();
        var notifier = new AlarmNotifier(new[]
        {
            new AlarmNotificationChannel(nameof(NotificationChannel.Relay), channel.DispatchAsync),
        });
        var alarms = new AlarmStore(alarmsDir, notifier: notifier);
        var raise = new AlarmRaise(
            AlarmSource.DriverHealth, "DOWN", AlarmPriority.Critical, "storm", TargetId: "slot-1");

        for (var i = 0; i < 240; i++) await alarms.RaiseAsync(raise);
        await notifier.DisposeAsync();

        Assert.Equal(239, notifier.Stats.Suppressed);     // the detector really saw all 240
        Assert.Equal(1, notifier.Stats.Enqueued);
        Assert.Equal(1, driver.WriteCallCount);           // 🔴 ONE coil write for twenty minutes of ticks
        Assert.Equal(1, channel.Stats.Applied);

        // ── Storm 2: a hundred DISTINCT alarms, every one a genuine edge. ──────────────────────────────
        for (var i = 0; i < 100; i++)
        {
            await channel.DispatchAsync(Job(AlarmEdgeKind.Raised, $"burst-{i}", sequence: 100 + i));
        }

        Assert.Equal(1, driver.WriteCallCount);           // 🔴 still ONE — the latch was already asserted
        Assert.Equal(100, channel.Stats.Unchanged);
        Assert.Equal(101, Assert.Single(channel.InstanceStates).LatchedAlarms);
        Assert.Equal(1L, driver.LastSetpoint?.Value);
    }

    /// <summary>The latch releases only when the LAST alarm clears — the property that makes a beacon mean
    /// "something is wrong" rather than "the most recent thing is wrong".</summary>
    [Fact]
    public async Task TheLatchReleasesOnlyWhenTheLastAlarmClears()
    {
        var dir = NewTempDir();
        var store = new NotificationConfigStore(dir);
        Assert.True(await SavePointRelayAsync(store));

        var host = CreateHost();
        var driver = await StartWritableFleetAsync(host);
        var (audit, _) = NewAudit();
        var channel = NewChannel(store, host, audit);

        await channel.DispatchAsync(Job(AlarmEdgeKind.Raised, "a", sequence: 1));
        await channel.DispatchAsync(Job(AlarmEdgeKind.Raised, "b", sequence: 2));
        await channel.DispatchAsync(Job(AlarmEdgeKind.Raised, "c", sequence: 3));
        Assert.Equal(1, driver.WriteCallCount);

        await channel.DispatchAsync(Job(AlarmEdgeKind.Cleared, "a", sequence: 4));
        await channel.DispatchAsync(Job(AlarmEdgeKind.Cleared, "b", sequence: 5));
        Assert.Equal(1, driver.WriteCallCount);                       // still lit — 'c' is standing
        Assert.True(Assert.Single(channel.InstanceStates).Energised);

        await channel.DispatchAsync(Job(AlarmEdgeKind.Cleared, "c", sequence: 6));
        Assert.Equal(2, driver.WriteCallCount);
        Assert.Equal(0L, driver.LastSetpoint?.Value);
        Assert.False(Assert.Single(channel.InstanceStates).Energised);

        // A clear for a key that was never latched changes nothing at all.
        await channel.DispatchAsync(Job(AlarmEdgeKind.Cleared, "never-seen", sequence: 7));
        Assert.Equal(2, driver.WriteCallCount);
    }

    /// <summary>
    /// 🔴 <b>An ack does NOT release this latch, and an ack that CLEARS does.</b>
    ///
    /// <para>ISA-18.2's ack means "silence the horn" and C-5 honours it — because C-5 knows it is driving a
    /// sound. This channel does not know what it is driving, and extinguishing what might be a LAMP because
    /// somebody acknowledged the alarm hides a condition that is still live. The second half is the
    /// distinction that keeps this from being a blanket refusal to listen: a Policy alarm's ack arrives as a
    /// <see cref="AlarmEdgeKind.Cleared"/> — the row really is gone — and that DOES release.</para>
    /// </summary>
    [Fact]
    public async Task AnAckDoesNotReleaseTheLatch_ButAnAckThatClearsTheAlarmDoes()
    {
        var dir = NewTempDir();
        var store = new NotificationConfigStore(dir);
        Assert.True(await SavePointRelayAsync(store));

        var host = CreateHost();
        var driver = await StartWritableFleetAsync(host);
        var (audit, _) = NewAudit();
        var channel = NewChannel(store, host, audit);

        await channel.DispatchAsync(Job(AlarmEdgeKind.Raised, "condition", sequence: 1));
        Assert.Equal(1, driver.WriteCallCount);

        await channel.DispatchAsync(Job(AlarmEdgeKind.Acked, "condition", sequence: 2));
        Assert.Equal(1, driver.WriteCallCount);                       // 🔴 still lit
        Assert.True(Assert.Single(channel.InstanceStates).Energised);
        Assert.Equal(1, Assert.Single(channel.InstanceStates).LatchedAlarms);
        Assert.Equal(1, channel.Stats.Suppressed);

        // The ClearOnAck path (every Policy denial) reaches this channel as Cleared, and that releases.
        await channel.DispatchAsync(Job(AlarmEdgeKind.Cleared, "condition", sequence: 3));
        Assert.Equal(2, driver.WriteCallCount);
        Assert.False(Assert.Single(channel.InstanceStates).Energised);
    }

    /// <summary>🔴 A restart into a standing alarm relights the beacon. C-1's <c>Restored</c> edge is the
    /// only signal a fresh process gets for an alarm raised before it started, and a relay that ignored it
    /// would sit dark through a real outage forever — the alarm never raises again, because every re-raise
    /// is correctly suppressed.</summary>
    [Fact]
    public async Task ARestartIntoAStandingAlarm_RelightsTheBeacon()
    {
        var dir = NewTempDir();
        var store = new NotificationConfigStore(dir);
        Assert.True(await SavePointRelayAsync(store));

        var host = CreateHost();
        var driver = await StartWritableFleetAsync(host);
        var (audit, _) = NewAudit();
        var channel = NewChannel(store, host, audit);

        await channel.DispatchAsync(Job(AlarmEdgeKind.Restored, "standing", sequence: 1));

        Assert.Equal(1, driver.WriteCallCount);
        Assert.Equal(1L, driver.LastSetpoint?.Value);
        Assert.True(Assert.Single(channel.InstanceStates).Energised);
    }

    /// <summary>An alarm below the instance's threshold is not a latch input at all — it neither lights the
    /// beacon nor, when it clears, disturbs one that a qualifying alarm lit.</summary>
    [Fact]
    public async Task AnAlarmBelowTheThreshold_IsNotALatchInput()
    {
        var dir = NewTempDir();
        var store = new NotificationConfigStore(dir);
        Assert.True(await SavePointRelayAsync(store, AlarmPriority.Critical));

        var host = CreateHost();
        var driver = await StartWritableFleetAsync(host);
        var (audit, _) = NewAudit();
        var channel = NewChannel(store, host, audit);

        await channel.DispatchAsync(Job(AlarmEdgeKind.Raised, "high", AlarmPriority.High, sequence: 1));
        Assert.Equal(0, driver.WriteCallCount);
        Assert.Equal(1, channel.Stats.Suppressed);

        await channel.DispatchAsync(Job(AlarmEdgeKind.Raised, "crit", AlarmPriority.Critical, sequence: 2));
        Assert.Equal(1, driver.WriteCallCount);

        // The below-threshold alarm's own clear must not release a latch it never asserted.
        await channel.DispatchAsync(Job(AlarmEdgeKind.Cleared, "high", AlarmPriority.High, sequence: 3));
        Assert.Equal(1, driver.WriteCallCount);
        Assert.True(Assert.Single(channel.InstanceStates).Energised);
    }

    /// <summary>A disabled instance drives nothing, whatever arrives.</summary>
    [Fact]
    public async Task ADisabledInstance_DrivesNothing()
    {
        var dir = NewTempDir();
        var store = new NotificationConfigStore(dir);
        Assert.True(await SavePointRelayAsync(store, enabled: false));

        var host = CreateHost();
        var driver = await StartWritableFleetAsync(host);
        var (audit, auditStore) = NewAudit();
        var channel = NewChannel(store, host, audit);

        await channel.DispatchAsync(Job(AlarmEdgeKind.Raised, "a"));

        Assert.Equal(0, driver.WriteCallCount);
        Assert.Equal(1, channel.Stats.Suppressed);
        Assert.Empty(auditStore.Rows);
    }

    // ─────────────────────────────────────────────────────────────────────
    // 3. 🔴 Rate limiting — the first in this product. Measured in elapsed time.
    // ─────────────────────────────────────────────────────────────────────

    /// <summary>
    /// 🔴 <b>The rate bound, proven in WALL-CLOCK rather than in counters.</b>
    ///
    /// <para>C-3 and C-4 both shipped budget tests that passed with the guard deleted, because the counters
    /// were identical and only the wall-clock differed. So this asserts the two inequalities that only a real
    /// limiter can satisfy, from a real <see cref="Stopwatch"/>:</para>
    /// <list type="number">
    /// <item><description><c>elapsed &gt;= (writes - 1) * interval</c> — the writes really were spaced. With
    /// the limiter deleted, 40 flaps complete in a few milliseconds and this fails immediately.</description></item>
    /// <item><description><c>writes &lt;= elapsed / interval + 1</c> — the bound was never exceeded at any
    /// point, not merely on average.</description></item>
    /// </list>
    /// <para>Non-vacuity in the other direction, which matters as much: the limiter must DELAY and never
    /// DROP, because a dropped release leaves a beacon lit. So the final state is asserted to match the final
    /// desired state exactly, and the write count is asserted to be the full number of transitions — nothing
    /// was coalesced away.</para>
    ///
    /// <para>The flap is what the limiter is actually for. A raise STORM is absorbed by the latch itself
    /// (see <see cref="AStormOfAlarms_ProducesExactlyOneWrite_NotOnePerAlarmAndNotOnePerTick"/>); what can
    /// still hammer a coil is a condition that raises and clears repeatedly.</para>
    /// </summary>
    [Fact]
    public async Task UnderAFlapStorm_TheCoilWriteRateIsBounded_MeasuredInElapsedTime()
    {
        const int Flaps = 5; // 10 transitions; at the 400 ms floor that is a 3.6 s elapsed floor

        var dir = NewTempDir();
        var store = new NotificationConfigStore(dir);
        Assert.True(await SavePointRelayAsync(store));

        var host = CreateHost();
        var driver = await StartWritableFleetAsync(host);
        var (audit, _) = NewAudit();

        // ─────────────────────────────────────────────────────────────────
        // 🔴 Closeout round (B-2) — the interval is MEASURED against this machine, not asserted about it.
        //
        // Both of this test's real properties depend on `interval >> one dispatch's own work`: the elapsed
        // floor below is only proof of the LIMITER if the WORK alone cannot satisfy it, and the
        // `RateLimited > 0` smoke check at the bottom is only meaningful if the work finishes inside the
        // cooldown. A fixed 400 ms encoded a guess about machine speed into both — and this test has
        // already been bitten once by exactly that (see the long note at the bottom: an assertion that
        // "every write after the first had to wait" was RIGHT about the limiter and WRONG about the
        // machine, and had to be weakened under load).
        //
        // So: run a few warm dispatches with the limiter OFF, take the mean, and use max(floor, 4x that).
        // On a fast idle machine this is just the 400 ms floor; on a machine slow enough that 400 ms would
        // have been the wrong number, the interval moves with it instead of the test going red.
        //
        // 🔴 MEASURED here on an idle machine across three runs: perDispatch = 0.53 / 0.23 / 0.22 ms, so
        // the interval stays at the 400 ms floor and this test's arithmetic is BIT-FOR-BIT what it was.
        // That is the intended outcome — the change buys headroom on a slow or loaded machine, and buys
        // nothing (and costs nothing) on a fast one. The floor only stops binding above ~100 ms/dispatch,
        // which is the figure the note at the bottom recorded under full-suite load.
        // ─────────────────────────────────────────────────────────────────
        var probeChannel = NewChannel(store, host, audit, interval: NoInterval);
        await probeChannel.DispatchAsync(Job(AlarmEdgeKind.Raised, "probe", sequence: 1)); // JIT + first touch
        const int Probes = 4;
        var probeClock = Stopwatch.StartNew();
        for (var p = 0; p < Probes; p++)
        {
            await probeChannel.DispatchAsync(Job(
                p % 2 == 0 ? AlarmEdgeKind.Cleared : AlarmEdgeKind.Raised, "probe", sequence: p + 2));
        }

        var perDispatch = TimeSpan.FromTicks(Math.Max(1, probeClock.Elapsed.Ticks / Probes));
        var interval = TimeSpan.FromTicks(Math.Max(FastIntervalFloor.Ticks, perDispatch.Ticks * 4));

        // 🔴 The probe wrote to the same coil, so the write count below is taken RELATIVE to here. That is
        // sound rather than merely convenient: the real channel constructed next is FRESH, so its belief
        // about the coil starts UNKNOWN and its first edge writes unconditionally — whatever state the
        // probe left the coil in cannot suppress or add a write.
        var writesBefore = driver.WriteCallCount;
        var channel = NewChannel(store, host, audit, interval: interval);

        var clock = Stopwatch.StartNew();
        for (var i = 0; i < Flaps; i++)
        {
            await channel.DispatchAsync(Job(AlarmEdgeKind.Raised, "flapper", sequence: 2 * i + 1));
            await channel.DispatchAsync(Job(AlarmEdgeKind.Cleared, "flapper", sequence: 2 * i + 2));
        }

        var elapsed = clock.Elapsed;
        var writes = driver.WriteCallCount - writesBefore;

        // Nothing was dropped: every transition really was written, and the final state is correct.
        Assert.Equal(2 * Flaps, writes);
        Assert.Equal(0L, driver.LastSetpoint?.Value);
        Assert.False(Assert.Single(channel.InstanceStates).Energised);

        // 🔴 THE BOUND, in elapsed time. This is the load-bearing proof and it is unchanged in kind — only
        // the interval it is expressed in is now a measurement rather than a constant.
        var floor = TimeSpan.FromTicks(interval.Ticks * (writes - 1));
        Assert.True(elapsed >= floor,
            $"{writes} coil writes completed in {elapsed.TotalMilliseconds:0}ms, which is faster than the " +
            $"{interval.TotalMilliseconds:0}ms minimum interval allows ({floor.TotalMilliseconds:0}ms) — " +
            "the rate limiter is not bounding anything. " +
            $"(one dispatch measured {perDispatch.TotalMilliseconds:0.#}ms; interval = max(" +
            $"{FastIntervalFloor.TotalMilliseconds:0}ms, 4x that).)");

        var ceiling = elapsed.Ticks / interval.Ticks + 1;
        Assert.True(writes <= ceiling,
            $"{writes} coil writes in {elapsed.TotalMilliseconds:0}ms exceeds the bound of {ceiling}.");

        // 🔴 A SMOKE CHECK, not the proof — and it is deliberately weak, because a stronger version of it
        // FAILED under full-suite load and taught me something worth writing down.
        //
        // The first version asserted `RateLimited >= writes - 1`: "every write after the first had to wait".
        // That is true only while the per-dispatch WORK (a config read, a policy evaluation, a driver call
        // and an audit append) is faster than the interval. Under a loaded machine it is not — the work
        // alone exceeded 60ms, so most writes were already outside the cooldown and legitimately did not
        // wait, and the counter was RIGHT while my assertion was wrong. That is an over-specification that
        // couples a test to machine speed, which is the same class of defect as a vacuous assertion and
        // fails just as uninformatively.
        //
        // The load-bearing proof is the ELAPSED floor above, and the interval is now large relative to the
        // work precisely so that the floor cannot be satisfied by the work alone — which is what would make
        // this test pass with the limiter deleted. This line only confirms the limiter's wait path executed
        // at all rather than being dead code.
        //
        // 🔴 Closeout round (B-2): the reason that note ends "the interval is now large relative to the
        // work" is that the interval is MEASURED against the work, above — so this line's premise is
        // established on the machine running it rather than assumed. When it does fail, the message now
        // carries the two numbers needed to tell "the limiter is dead" from "this machine is slower than
        // 4x its own dispatch", which are opposite conclusions.
        Assert.True(channel.Stats.RateLimited > 0,
            "the rate limiter never waited even once — its wait path is not being exercised at all. " +
            $"(one dispatch measured {perDispatch.TotalMilliseconds:0.#}ms against a " +
            $"{interval.TotalMilliseconds:0}ms interval.)");
    }

    /// <summary>The limiter must not delay the FIRST write of an instance's life — a beacon that took two
    /// seconds to light on the first alarm after boot would be paying the storm price for a storm that never
    /// happened.</summary>
    [Fact]
    public async Task TheFirstWriteIsNeverDelayed()
    {
        var dir = NewTempDir();
        var store = new NotificationConfigStore(dir);
        Assert.True(await SavePointRelayAsync(store));

        var host = CreateHost();
        var driver = await StartWritableFleetAsync(host);
        var (audit, _) = NewAudit();
        var channel = NewChannel(store, host, audit, interval: TimeSpan.FromSeconds(30));

        var clock = Stopwatch.StartNew();
        await channel.DispatchAsync(Job(AlarmEdgeKind.Raised, "first"));
        var elapsed = clock.Elapsed;

        Assert.Equal(1, driver.WriteCallCount);
        Assert.True(elapsed < TimeSpan.FromSeconds(5), $"the first write waited {elapsed}.");
        Assert.Equal(0, channel.Stats.RateLimited);
    }

    // ─────────────────────────────────────────────────────────────────────
    // 4. 🔴 The write outcomes — Indeterminate above all.
    // ─────────────────────────────────────────────────────────────────────

    /// <summary>
    /// 🔴 <b><see cref="WriteOutcome.Indeterminate"/> is never retried, reaches the operator as ITSELF, and
    /// leaves this channel's belief UNKNOWN rather than assumed.</b>
    ///
    /// <para>B-1 made this outcome first-class precisely because after a timeout the driver does not know
    /// whether the device applied the write, and re-pulsing a coil you may already have pulsed is the wrong
    /// move. Three things are asserted, and the third is the one that is easy to get wrong: (a) exactly ONE
    /// write reached the driver — no retry; (b) the counter and the operator-visible warning both say
    /// INDETERMINATE, never "failed"; (c) <see cref="RelayInstanceState.Energised"/> is
    /// <see langword="null"/>, so the NEXT genuine transition writes unconditionally instead of being
    /// suppressed as redundant. Reverting the belief to its old value instead would leave a beacon dark on a
    /// state this process merely assumed.</para>
    /// </summary>
    [Fact]
    public async Task Indeterminate_IsNotRetried_ReachesTheOperatorAsItself_AndLeavesTheStateUnknown()
    {
        var dir = NewTempDir();
        var store = new NotificationConfigStore(dir);
        Assert.True(await SavePointRelayAsync(store));

        var host = CreateHost();
        var driver = await StartWritableFleetAsync(host, new FakeAnnunciatorDriver { Outcome = WriteOutcome.Indeterminate });
        var (audit, auditStore) = NewAudit();
        var warnings = new List<string>();
        var channel = NewChannel(store, host, audit, warnings: warnings);

        await channel.DispatchAsync(Job(AlarmEdgeKind.Raised, "a", sequence: 1));

        Assert.Equal(1, driver.WriteCallCount);                       // (a) exactly one attempt
        Assert.Equal(1, channel.Stats.Indeterminate);
        Assert.Equal(0, channel.Stats.Failed);                        // (b) NOT collapsed into "failed"
        Assert.Equal(0, channel.Stats.Applied);
        Assert.Contains(warnings, w => w.Contains("INDETERMINATE", StringComparison.Ordinal));
        Assert.Contains(warnings, w => w.Contains("will NOT retry", StringComparison.Ordinal));

        var state = Assert.Single(channel.InstanceStates);
        Assert.Null(state.Energised);                                 // (c) UNKNOWN, not assumed

        // It survives the audit hop as itself too.
        var row = Assert.Single(auditStore.Rows);
        Assert.Contains(nameof(WriteOutcome.Indeterminate), row.NewValueJson, StringComparison.Ordinal);

        // And because the belief is UNKNOWN, the next genuine transition writes rather than being
        // suppressed as redundant — which is what stops one timeout from stranding the beacon forever.
        driver.Outcome = WriteOutcome.Applied;
        await channel.DispatchAsync(Job(AlarmEdgeKind.Cleared, "a", sequence: 2));
        Assert.Equal(2, driver.WriteCallCount);
        Assert.Equal(0L, driver.LastSetpoint?.Value);
    }

    /// <summary>
    /// 🔴🔴 <b>Review round 1 (C-1) — the test that was missing, and the defect it would have caught.</b>
    ///
    /// <para>The write gate used to consult <c>Energised</c>, which an <see cref="WriteOutcome.Indeterminate"/>
    /// write sets to <see langword="null"/>. <c>null == true</c> is false, so while the belief was UNKNOWN
    /// <b>every subsequent latch input wrote again</b> — not merely a level transition. Twenty distinct
    /// alarms in ONE episode produced twenty writes instead of one, and for a
    /// <see cref="RelayTargetKind.Command"/> target every one of those is a real actuation, not a redundant
    /// attempt at the same one. It contradicted the brief, the class doc and this channel's own
    /// "will NOT retry" warning string all at once.</para>
    ///
    /// <para>It went untested because the original Indeterminate test only ever followed the indeterminate
    /// write with a <see cref="AlarmEdgeKind.Cleared"/> — which IS a real transition, and so writes
    /// correctly either way. This test drives the case that is not a transition: N more raises in the same
    /// episode. Run for BOTH target kinds, because the Point case is a harmless idempotent re-write and the
    /// Command case is the one that actuates.</para>
    /// </summary>
    [Theory]
    [InlineData(RelayTargetKind.Point)]
    [InlineData(RelayTargetKind.Command)]
    public async Task AfterAnIndeterminateWrite_FurtherAlarmsInTheSameEpisode_DoNotWriteAgain(RelayTargetKind kind)
    {
        const int FurtherAlarms = 20;

        var store = new NotificationConfigStore(NewTempDir());
        Assert.True(kind == RelayTargetKind.Command
            ? await store.SaveRelayAsync(
                enabled: true, AlarmPriority.Critical, MachineCode, RelayTargetKind.Command, CommandName)
            : await SavePointRelayAsync(store));

        var host = CreateHost();
        var driver = await StartWritableFleetAsync(
            host, new FakeAnnunciatorDriver { Outcome = WriteOutcome.Indeterminate });
        var (audit, _) = NewAudit();
        var channel = NewChannel(store, host, audit);

        // The energise comes back INDETERMINATE — nobody knows whether the device took it.
        await channel.DispatchAsync(Job(AlarmEdgeKind.Raised, "alarm-0", sequence: 1));
        Assert.Equal(1, channel.Stats.Indeterminate);

        // ...and now the rest of the storm arrives. The latch is already asserted, so none of it is a level
        // transition, so NONE of it may reach the device again.
        for (var i = 1; i <= FurtherAlarms; i++)
        {
            await channel.DispatchAsync(Job(AlarmEdgeKind.Raised, $"alarm-{i}", sequence: 1 + i));
        }

        var writes = kind == RelayTargetKind.Command ? driver.CommandCallCount : driver.WriteCallCount;
        Assert.Equal(1, writes);
        Assert.Equal(FurtherAlarms, channel.Stats.Unchanged);
        Assert.Equal(1, channel.Stats.Indeterminate);   // still exactly one attempt, ever

        // The belief is still honestly UNKNOWN — suppressing the re-writes must NOT be done by pretending
        // the indeterminate write succeeded.
        var state = Assert.Single(channel.InstanceStates);
        Assert.Null(state.Energised);
        Assert.True(state.Commanded);                   // ...while the COMMANDED level is recorded
        Assert.Equal(FurtherAlarms + 1, state.LatchedAlarms);

        // And the episode still ends correctly: the last clear IS a real transition, so it writes.
        driver.Outcome = WriteOutcome.Applied;
        for (var i = 0; i <= FurtherAlarms; i++)
        {
            await channel.DispatchAsync(Job(AlarmEdgeKind.Cleared, $"alarm-{i}", sequence: 100 + i));
        }

        if (kind == RelayTargetKind.Command)
        {
            // A command cannot release — asserted here too so this test cannot pass by the Command case
            // silently behaving like the Point case.
            Assert.Equal(1, driver.CommandCallCount);
            Assert.Equal(1, channel.Stats.ReleaseUnsupported);
        }
        else
        {
            Assert.Equal(2, driver.WriteCallCount);
            Assert.Equal(0L, driver.LastSetpoint?.Value);
            Assert.False(Assert.Single(channel.InstanceStates).Energised);
        }
    }

    /// <summary>A value the register map refuses is <see cref="WriteOutcome.Rejected"/>: counted separately,
    /// reported with the driver's own reason, never retried, and — because no device was touched — the
    /// channel's belief about the coil is left exactly as it was.</summary>
    [Fact]
    public async Task Rejected_IsCountedSeparately_NotRetried_AndLeavesTheBeliefUnchanged()
    {
        var dir = NewTempDir();
        var store = new NotificationConfigStore(dir);
        Assert.True(await SavePointRelayAsync(store));

        var host = CreateHost();
        var driver = await StartWritableFleetAsync(host, new FakeAnnunciatorDriver
        {
            Outcome = WriteOutcome.Rejected,
            Rejection = SetpointRejectionReason.OutOfRange,
        });
        var (audit, _) = NewAudit();
        var warnings = new List<string>();
        var channel = NewChannel(store, host, audit, warnings: warnings);

        await channel.DispatchAsync(Job(AlarmEdgeKind.Raised, "a"));

        Assert.Equal(1, driver.WriteCallCount);
        Assert.Equal(1, channel.Stats.Rejected);
        Assert.Equal(0, channel.Stats.Failed);
        Assert.Equal(0, channel.Stats.Indeterminate);
        Assert.Null(Assert.Single(channel.InstanceStates).Energised);
        Assert.Contains(warnings, w =>
            w.Contains("REJECTED", StringComparison.Ordinal) &&
            w.Contains(nameof(SetpointRejectionReason.OutOfRange), StringComparison.Ordinal));
    }

    /// <summary>A definitively failed write is counted as <see cref="WriteOutcome.Failed"/> and not retried
    /// — B-1 forbids implicit retries on ANY write outcome and this channel does not second-guess it.</summary>
    [Fact]
    public async Task Failed_IsCountedSeparately_AndNotRetried()
    {
        var dir = NewTempDir();
        var store = new NotificationConfigStore(dir);
        Assert.True(await SavePointRelayAsync(store));

        var host = CreateHost();
        var driver = await StartWritableFleetAsync(host, new FakeAnnunciatorDriver { Outcome = WriteOutcome.Failed });
        var (audit, _) = NewAudit();
        var channel = NewChannel(store, host, audit);

        await channel.DispatchAsync(Job(AlarmEdgeKind.Raised, "a"));

        Assert.Equal(1, driver.WriteCallCount);
        Assert.Equal(1, channel.Stats.Failed);
        Assert.Equal(0, channel.Stats.Indeterminate);
        Assert.Null(Assert.Single(channel.InstanceStates).Energised);
    }

    /// <summary>
    /// 🔴 Đợt B models FOUR distinguishable "no driver to write to" cases and this channel does not collapse
    /// them — an operator needs a different explanation for a mistyped code than for a stopped fleet than for
    /// a read-only connector. Each case is reached through the real <see cref="FleetHost"/> resolution path
    /// and each moves its OWN counter; the theory would pass vacuously if they shared one.
    /// </summary>
    [Fact]
    public async Task TheFourUnavailableCases_AreDistinguished_AndNoneIsCollapsed()
    {
        var (audit, _) = NewAudit();

        // (1) MachineNotFound — the configured code is in no roster.
        {
            var store = new NotificationConfigStore(NewTempDir());
            Assert.True(await SavePointRelayAsync(store, machineCode: "NOT-IN-ANY-ROSTER"));
            var host = CreateHost();
            host.Start();
            var channel = NewChannel(store, host, audit);
            await channel.DispatchAsync(Job(AlarmEdgeKind.Raised, "a"));
            Assert.Equal(1, channel.Stats.MachineNotFound);
            Assert.Equal(0, channel.Stats.NoLiveDriver + channel.Stats.ReadOnly + channel.Stats.AmbiguousDriver);
            host.Stop();
        }

        // (2) NoLiveDriver — the roster knows it, nothing is driving it.
        {
            var store = new NotificationConfigStore(NewTempDir());
            Assert.True(await SavePointRelayAsync(store, machineCode: "SCRW-01"));
            var host = CreateHost();                     // never started
            var channel = NewChannel(store, host, audit);
            await channel.DispatchAsync(Job(AlarmEdgeKind.Raised, "a"));
            Assert.Equal(1, channel.Stats.NoLiveDriver);
            Assert.Equal(0, channel.Stats.MachineNotFound + channel.Stats.ReadOnly + channel.Stats.AmbiguousDriver);
        }

        // (3) ReadOnly — a live driver that cannot write at all (the simulated fleet).
        {
            var store = new NotificationConfigStore(NewTempDir());
            Assert.True(await SavePointRelayAsync(store, machineCode: "SCRW-01"));
            var host = CreateHost();
            host.Start();
            var deadline = DateTime.UtcNow.AddSeconds(15);
            while (host.GetMachineDriverAvailability("SCRW-01") != MachineDriverAvailability.ReadOnly &&
                   DateTime.UtcNow < deadline)
            {
                await Task.Delay(25);
            }

            Assert.Equal(MachineDriverAvailability.ReadOnly, host.GetMachineDriverAvailability("SCRW-01"));
            var channel = NewChannel(store, host, audit);
            await channel.DispatchAsync(Job(AlarmEdgeKind.Raised, "a"));
            Assert.Equal(1, channel.Stats.ReadOnly);
            Assert.Equal(0, channel.Stats.MachineNotFound + channel.Stats.NoLiveDriver + channel.Stats.AmbiguousDriver);
            host.Stop();
        }

        // (4) AmbiguousDriver — two roster members resolve to the same live connector.
        {
            var store = new NotificationConfigStore(NewTempDir());
            Assert.True(await SavePointRelayAsync(store));
            var host = CreateHost();
            var driver = new FakeAnnunciatorDriver();
            Assert.True(host.RegisterMachine(ModbusStyleMachine(MachineCode)));
            Assert.True(host.RegisterMachine(ModbusStyleMachine("RELAY-02")));
            host.AdditionalPipelinesForTests = () => new List<(string Label, IDeviceDriver Driver, MappingProfile Profile)>
            {
                ("modbus", driver, new MappingProfile { Name = "modbus", DeviceClass = "Test" }),
            };
            host.Start();
            var deadline = DateTime.UtcNow.AddSeconds(15);
            while (host.GetMachineDriverAvailability(MachineCode) != MachineDriverAvailability.AmbiguousDriver &&
                   DateTime.UtcNow < deadline)
            {
                await Task.Delay(25);
            }

            Assert.Equal(MachineDriverAvailability.AmbiguousDriver, host.GetMachineDriverAvailability(MachineCode));
            var channel = NewChannel(store, host, audit);
            await channel.DispatchAsync(Job(AlarmEdgeKind.Raised, "a"));
            Assert.Equal(1, channel.Stats.AmbiguousDriver);
            Assert.Equal(0, driver.WriteCallCount);       // no I/O was ever attempted
            host.AdditionalPipelinesForTests = null;
            host.Stop();
        }
    }

    // ─────────────────────────────────────────────────────────────────────
    // 5. Command targets, and the configuration asymmetry.
    // ─────────────────────────────────────────────────────────────────────

    /// <summary>
    /// 🔴 A <see cref="RelayTargetKind.Command"/> target PULSES on assert and <b>cannot release</b> — a
    /// command is argument-less and there is no un-pulse. The channel says so with its own counter and a
    /// warning naming the alternative, rather than reporting a de-energisation that did not happen.
    ///
    /// <para>The second half is what keeps this from being a silent dead end: the belief still returns to
    /// "not energised", so the NEXT alarm episode pulses again rather than being suppressed as
    /// redundant.</para>
    /// </summary>
    [Fact]
    public async Task ACommandTarget_PulsesOnAssert_CannotRelease_AndSaysSo()
    {
        var dir = NewTempDir();
        var store = new NotificationConfigStore(dir);
        Assert.True(await store.SaveRelayAsync(
            enabled: true, AlarmPriority.Critical, MachineCode, RelayTargetKind.Command, CommandName));

        var host = CreateHost();
        var driver = await StartWritableFleetAsync(host);
        var (audit, auditStore) = NewAudit();
        var warnings = new List<string>();
        var channel = NewChannel(store, host, audit, warnings: warnings);

        await channel.DispatchAsync(Job(AlarmEdgeKind.Raised, "a", sequence: 1));
        Assert.Equal(1, driver.CommandCallCount);
        Assert.Equal(CommandName, driver.LastCommand?.Command);
        Assert.Equal(0, driver.WriteCallCount);            // a command, never a setpoint
        Assert.Equal(1, channel.Stats.Applied);

        // The command path is authorised at Admin, and the audit row records the tier the act ran under.
        Assert.Equal(Roles.Admin, Assert.Single(auditStore.Rows).ActorRole);
        Assert.Equal(MachineWriteGate.CommandAction, Assert.Single(auditStore.Rows).Action);

        await channel.DispatchAsync(Job(AlarmEdgeKind.Cleared, "a", sequence: 2));
        Assert.Equal(1, driver.CommandCallCount);          // 🔴 no un-pulse
        Assert.Equal(1, channel.Stats.ReleaseUnsupported);
        Assert.Contains(warnings, w =>
            w.Contains("NOT de-energised", StringComparison.Ordinal) &&
            w.Contains("POINT target", StringComparison.Ordinal));

        // 🔴 Review round 2 (n-2) — the release IS audited (it changes what the product believes about a
        // physical output) but NOT under the bare action id. This channel files its writes under Đợt B's own
        // id so an investigator's "what wrote to this machine?" query finds automatic writes; a row for
        // something never attempted must not inflate the actuation count in that very query. So: exactly ONE
        // row still carries the bare id — the pulse that really happened — and the release carries the
        // suffixed one.
        Assert.Equal(2, auditStore.Rows.Count);
        Assert.Equal(
            MachineWriteGate.CommandAction,
            Assert.Single(auditStore.Rows, r => r.Action == MachineWriteGate.CommandAction).Action);
        Assert.Equal(
            MachineWriteGate.CommandAction + RelayNotificationChannel.ReleaseUnsupportedActionSuffix,
            auditStore.Rows[1].Action);
        Assert.Contains("releaseUnsupported", auditStore.Rows[1].NewValueJson, StringComparison.Ordinal);

        // ...and the next episode pulses again rather than being suppressed as redundant.
        await channel.DispatchAsync(Job(AlarmEdgeKind.Raised, "b", sequence: 3));
        Assert.Equal(2, driver.CommandCallCount);
    }

    /// <summary>
    /// 🔴 The store REFUSES both halves of the point/command asymmetry, on C-2's own <c>ImplicitTls</c>
    /// principle: a store whose values the implementing task must silently ignore is worse than one that
    /// never accepted them. A point relay without latch values is a beacon that can never light; a command
    /// relay WITH them carries a value the channel provably ignores.
    /// </summary>
    [Fact]
    public async Task ThePointCommandAsymmetry_IsRefusedAtSaveTime_InBothDirections()
    {
        var store = new NotificationConfigStore(NewTempDir());

        Assert.False(await store.SaveRelayAsync(
            true, AlarmPriority.Critical, MachineCode, RelayTargetKind.Point, PointName));
        Assert.False(await store.SaveRelayAsync(
            true, AlarmPriority.Critical, MachineCode, RelayTargetKind.Point, PointName, onValueJson: "1"));
        Assert.False(await store.SaveRelayAsync(
            true, AlarmPriority.Critical, MachineCode, RelayTargetKind.Point, PointName,
            onValueJson: "not json", offValueJson: "0"));
        Assert.False(await store.SaveRelayAsync(
            true, AlarmPriority.Critical, MachineCode, RelayTargetKind.Point, PointName,
            onValueJson: "[1,2]", offValueJson: "0"));      // out of the connector value domain
        Assert.False(await store.SaveRelayAsync(
            true, AlarmPriority.Critical, MachineCode, RelayTargetKind.Command, CommandName, onValueJson: "1"));

        // Nothing was persisted by any of those.
        Assert.Empty(await store.ListAsync());

        // And the two legal shapes round-trip, values included.
        Assert.True(await store.SaveRelayAsync(
            true, AlarmPriority.Critical, MachineCode, RelayTargetKind.Point, PointName, "true", "false"));
        var config = await store.GetRelayAsync();
        Assert.Equal("true", config!.OnValueJson);
        Assert.Equal("false", config.OffValueJson);
        Assert.True(RelayValue.TryParse(config.OnValueJson, out var on, out _));
        Assert.Equal(true, on);

        Assert.True(await store.SaveRelayAsync(
            true, AlarmPriority.Critical, MachineCode, RelayTargetKind.Command, CommandName,
            instance: "horn"));
        var command = await store.GetRelayAsync("horn");
        Assert.Null(command!.OnValueJson);

        // The credential-free public projection carries them too — "what does this write to that coil?" is
        // the most auditable fact about this channel and none of it is a secret.
        var summary = Assert.Single(
            await store.ListAsync(),
            s => s.Channel == NotificationChannel.Relay && s.Instance == NotificationConfigStore.DefaultInstance);
        Assert.Equal("true", summary.Relay!.OnValueJson);
        Assert.Equal("false", summary.Relay.OffValueJson);
    }

    /// <summary>
    /// A point relay whose stored latch value is missing is <see cref="RelayChannelStats.Misconfigured"/> —
    /// counted, warned about in words that name the fix, and NEVER written with a value this product
    /// invented.
    ///
    /// <para>Reaching that state needs a hand-edited database, because
    /// <see cref="NotificationConfigStore.SaveRelayAsync"/> refuses to create it — so the test edits the row
    /// directly, which is exactly the situation the branch exists for (a row written before schema v3, or an
    /// operator with sqlite3).</para>
    /// </summary>
    [Fact]
    public async Task APointRelayWithNoStoredValue_IsCountedMisconfigured_AndNoValueIsInvented()
    {
        var dir = NewTempDir();
        var store = new NotificationConfigStore(dir);
        Assert.True(await store.SaveRelayAsync(
            enabled: true, AlarmPriority.Critical, MachineCode, RelayTargetKind.Command, CommandName));

        // Hand-edit: make it a POINT target with no values, which the store would never persist.
        await using (var connection = new SqliteConnection($"Data Source={store.DbPath}"))
        {
            await connection.OpenAsync();
            await using var cmd = connection.CreateCommand();
            cmd.CommandText =
                "UPDATE relay_config SET target_kind = 'Point', target_name = @p, on_value = NULL, off_value = NULL;";
            cmd.Parameters.AddWithValue("@p", PointName);
            Assert.Equal(1, await cmd.ExecuteNonQueryAsync());
        }

        var host = CreateHost();
        var driver = await StartWritableFleetAsync(host);
        var (audit, _) = NewAudit();
        var warnings = new List<string>();
        var channel = NewChannel(store, host, audit, warnings: warnings);

        await channel.DispatchAsync(Job(AlarmEdgeKind.Raised, "a"));

        Assert.Equal(0, driver.WriteCallCount);
        Assert.Equal(0, driver.CommandCallCount);
        Assert.Equal(1, channel.Stats.Misconfigured);
        Assert.Contains(warnings, w => w.Contains("does NOT invent a value", StringComparison.Ordinal));
    }

    // ─────────────────────────────────────────────────────────────────────
    // 6. Audit identity.
    // ─────────────────────────────────────────────────────────────────────

    /// <summary>
    /// 🔴 <b>Every attempt is audited under a DISTINCT system identity — including refused ones.</b>
    ///
    /// <para>Six months later an investigator reading <c>machine.setpoint.write</c> rows must be able to
    /// separate "an engineer did this" from "the alarm relay did this". The action id is deliberately Đợt
    /// B's own, so the rows appear in the query an investigator already uses; the ACTOR is what separates
    /// them, and it is deliberately NOT the shared <see cref="AuditRecorder.SystemActor"/>, which would
    /// collapse this automation with the next one.</para>
    /// </summary>
    [Fact]
    public async Task EveryAttemptIsAudited_UnderADistinctSystemIdentity_IncludingRefusedOnes()
    {
        var dir = NewTempDir();
        var store = new NotificationConfigStore(dir);
        Assert.True(await SavePointRelayAsync(store));

        var host = CreateHost();
        await StartWritableFleetAsync(host);
        var (audit, auditStore) = NewAudit();
        var channel = NewChannel(store, host, audit);

        await channel.DispatchAsync(Job(AlarmEdgeKind.Raised, "a", sequence: 1));   // permitted + applied
        host.Estop();
        await channel.DispatchAsync(Job(AlarmEdgeKind.Cleared, "a", sequence: 2));  // refused

        Assert.Equal(2, auditStore.Rows.Count);
        Assert.All(auditStore.Rows, r =>
        {
            Assert.Equal(RelayNotificationChannel.SystemActor, r.ActorUsername);
            Assert.NotEqual(AuditRecorder.SystemActor, r.ActorUsername);
            Assert.Equal(Roles.Engineer, r.ActorRole);     // least privilege: a POINT target is Engineer-tier
            Assert.Equal("machine", r.TargetType);
            Assert.Equal(MachineCode, r.TargetId);
            Assert.Contains("alarm.relay", r.NewValueJson, StringComparison.Ordinal);
        });

        Assert.Equal(MachineWriteGate.SetpointAction, auditStore.Rows[0].Action);
        Assert.Equal($"{MachineWriteGate.SetpointAction}.denied", auditStore.Rows[1].Action);

        // The row carries what an investigator needs to reconstruct the decision, not just its outcome.
        using var doc = JsonDocument.Parse(auditStore.Rows[0].NewValueJson!);
        Assert.Equal("energise", doc.RootElement.GetProperty("intent").GetString());
        Assert.Equal(PointName, doc.RootElement.GetProperty("target").GetString());
        Assert.Equal("Raised", doc.RootElement.GetProperty("edge").GetString());
        Assert.Equal("a", doc.RootElement.GetProperty("alarmKey").GetString());
    }

    // ─────────────────────────────────────────────────────────────────────
    // 7. Accounting, never-throws, cancellation.
    // ─────────────────────────────────────────────────────────────────────

    /// <summary>🔴 The accounting invariant: for every (notification, instance) pair, exactly one counter
    /// moves. Driven over a mix of outcomes rather than one arrangement that happens to add up — a
    /// suppression, an applied write, an unchanged latch, a release and a refusal.</summary>
    [Fact]
    public async Task EveryNotificationInstancePair_MovesExactlyOneCounter()
    {
        var dir = NewTempDir();
        var store = new NotificationConfigStore(dir);
        Assert.True(await SavePointRelayAsync(store, AlarmPriority.Critical));
        Assert.True(await SavePointRelayAsync(store, AlarmPriority.Critical, instance: "second"));
        Assert.True(await SavePointRelayAsync(store, AlarmPriority.Critical, enabled: false, instance: "off"));

        var host = CreateHost();
        await StartWritableFleetAsync(host);
        var (audit, _) = NewAudit();
        var channel = NewChannel(store, host, audit);

        var jobs = new[]
        {
            Job(AlarmEdgeKind.Raised, "a", AlarmPriority.Critical, 1),
            Job(AlarmEdgeKind.Raised, "b", AlarmPriority.High, 2),      // below threshold -> Suppressed
            Job(AlarmEdgeKind.Raised, "c", AlarmPriority.Critical, 3),  // already lit -> Unchanged
            Job(AlarmEdgeKind.Acked, "a", AlarmPriority.Critical, 4),   // -> Suppressed
            Job(AlarmEdgeKind.Cleared, "a", AlarmPriority.Critical, 5),
            Job(AlarmEdgeKind.Cleared, "c", AlarmPriority.Critical, 6),
        };

        foreach (var job in jobs) await channel.DispatchAsync(job);

        host.Estop();
        await channel.DispatchAsync(Job(AlarmEdgeKind.Raised, "d", AlarmPriority.Critical, 7));

        var s = channel.Stats;
        var accounted =
            s.Suppressed + s.Unchanged + s.Applied + s.Rejected + s.Failed + s.Indeterminate + s.Refused +
            s.MachineNotFound + s.NoLiveDriver + s.ReadOnly + s.AmbiguousDriver + s.ReleaseUnsupported +
            s.Misconfigured + s.Lost;

        Assert.Equal(7, s.Considered);
        Assert.Equal(7 * 3, accounted);        // 7 notifications x 3 configured instances
        Assert.Equal(0, s.Cancelled);
        Assert.Equal(0, s.Lost);
    }

    /// <summary>A structurally broken job is absorbed and counted — never thrown out of C-1's drain loop.
    /// C-5 found by mutation that a never-throws handler which interpolates <c>job.Alarm.Key</c> throws on
    /// the one input it exists to absorb.</summary>
    [Fact]
    public async Task AStructurallyBrokenJob_IsAbsorbedAndCounted_NeverThrown()
    {
        var dir = NewTempDir();
        var store = new NotificationConfigStore(dir);
        Assert.True(await SavePointRelayAsync(store));

        var host = CreateHost();
        await StartWritableFleetAsync(host);
        var (audit, _) = NewAudit();
        var errors = new List<string>();
        var channel = NewChannel(store, host, audit, errors: errors);

        var broken = new NotificationJob(1, AlarmEdgeKind.Raised, null!, DateTimeOffset.UtcNow, null, null);
        await channel.DispatchAsync(broken);   // must not throw

        Assert.Equal(1, channel.Stats.Lost);
        Assert.NotEmpty(errors);
        Assert.Contains(errors, e => e.Contains("null alarm", StringComparison.Ordinal));
    }

    /// <summary>Cancellation is honoured promptly and counted as itself, and the exception PROPAGATES so
    /// C-1's drain loop can record the job as dropped. Measured in elapsed time, because "promptly" is a
    /// timing claim.</summary>
    [Fact]
    public async Task Cancellation_IsHonouredPromptly_CountedAsItself_AndPropagates()
    {
        var dir = NewTempDir();
        var store = new NotificationConfigStore(dir);
        Assert.True(await SavePointRelayAsync(store));

        var host = CreateHost();
        var driver = await StartWritableFleetAsync(host);
        var (audit, _) = NewAudit();
        var channel = NewChannel(store, host, audit);

        using var cts = new CancellationTokenSource();
        cts.Cancel();

        var clock = Stopwatch.StartNew();
        await Assert.ThrowsAnyAsync<OperationCanceledException>(
            () => channel.DispatchAsync(Job(AlarmEdgeKind.Raised, "a"), cts.Token));
        var elapsed = clock.Elapsed;

        Assert.True(elapsed < TimeSpan.FromMilliseconds(500), $"cancellation took {elapsed}.");
        Assert.Equal(1, channel.Stats.Cancelled);
        Assert.Equal(0, driver.WriteCallCount);
        Assert.Equal(0, channel.Stats.Applied);
    }

    // ─────────────────────────────────────────────────────────────────────
    // Test doubles
    // ─────────────────────────────────────────────────────────────────────

    /// <summary>A live, writable driver whose write outcome the test controls. Deliberately NOT a mock
    /// framework: this is the ONE thing below the channel that is faked, and everything above it —
    /// <see cref="FleetHost"/> resolution, the policy engine, the audit chain, the configuration store — is
    /// real.</summary>
    private sealed class FakeAnnunciatorDriver : IWritableDeviceDriver
    {
        private int _writeCalls;
        private int _commandCalls;

        public WriteOutcome Outcome { get; set; } = WriteOutcome.Applied;
        public SetpointRejectionReason? Rejection { get; init; }

        public int WriteCallCount => Volatile.Read(ref _writeCalls);
        public int CommandCallCount => Volatile.Read(ref _commandCalls);
        public SetpointWriteRequest? LastSetpoint { get; private set; }
        public CommandRequest? LastCommand { get; private set; }

        public string Id => "fake-annunciator";
        public string Kind => DriverKinds.Modbus;
        public DriverHealthState Health => DriverHealthState.Connected;
        public IReadOnlyList<string> WritablePoints { get; } = new[] { PointName };
        public IReadOnlyList<string> Commands { get; } = new[] { CommandName };

        public async IAsyncEnumerable<DeviceReading> ReadAsync([EnumeratorCancellation] CancellationToken ct)
        {
            await Task.Delay(Timeout.Infinite, ct).ConfigureAwait(false);
            yield break;
        }

        public ValueTask DisposeAsync() => ValueTask.CompletedTask;

        public Task<SetpointWriteResult> WriteSetpointAsync(SetpointWriteRequest request, CancellationToken ct)
        {
            Interlocked.Increment(ref _writeCalls);
            LastSetpoint = request;
            return Task.FromResult(new SetpointWriteResult(
                request.Point, Outcome, Rejection, Detail: $"test double: {Outcome}"));
        }

        public Task<CommandResult> InvokeCommandAsync(CommandRequest request, CancellationToken ct)
        {
            Interlocked.Increment(ref _commandCalls);
            LastCommand = request;
            return Task.FromResult(new CommandResult(
                request.Command, Outcome, Detail: $"test double: {Outcome}"));
        }
    }

    /// <summary>An in-memory <see cref="IAuditStore"/>. The hash chain is <c>SqliteAuditStore</c>'s own
    /// concern and is tested there; what these tests need is the ROWS, in order.</summary>
    private sealed class RecordingAuditStore : IAuditStore
    {
        private readonly ConcurrentQueue<AuditEntry> _rows = new();

        public IReadOnlyList<AuditEntry> Rows => _rows.ToList();

        public Task<AuditEntry> AppendAsync(AuditAppend e, CancellationToken ct)
        {
            var entry = new AuditEntry(
                _rows.Count + 1, e.AtUtc, e.ActorUsername, e.ActorRole, e.Action, e.TargetType, e.TargetId,
                e.OldValueJson, e.NewValueJson, e.CorrelationId, e.ClientIp, new string('0', 64), new string('0', 64));
            _rows.Enqueue(entry);
            return Task.FromResult(entry);
        }

        public Task<AuditPage> QueryAsync(
            DateTimeOffset? from, DateTimeOffset? to, string? actor, string? action, string? target,
            int limit, int offset, CancellationToken ct) =>
            Task.FromResult(new AuditPage(Rows, _rows.Count, limit, offset));

        public Task<AuditVerifyResult> VerifyChainAsync(CancellationToken ct) =>
            Task.FromResult(new AuditVerifyResult(true, null, "in-memory test double"));
    }
}
