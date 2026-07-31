using System.Diagnostics;
using System.Text.Json;
using St4i.EngineApi.Alarms;
using Xunit;

namespace St4i.EngineApi.Tests.Alarms;

/// <summary>
/// 🔴 Task C-5 — <see cref="LocalAnnunciationChannel"/> and <see cref="AlarmAnnunciationHub"/>: the only
/// alarm channel in Đợt C that still works with the network gone, and the one whose whole risk is the
/// opposite of C-3's and C-4's. Those two could fail to reach a remote; this one has nothing to fail, which
/// makes "report success unconditionally" the easy and wrong implementation.
///
/// <para><b>So the load-bearing tests here are the ones about NOT claiming success.</b>
/// <see cref="WithNobodyListening_TheAnnunciationIsCountedUnheard_NotAsASuccess"/> and
/// <see cref="AListenerTooFarBehind_DoesNotMakeTheAnnunciationLookHeard"/> are the two that a wrong
/// implementation passes only by accident, and both are mutation-proven (see the C-5 report).</para>
///
/// <para>Every test drives a REAL <see cref="NotificationConfigStore"/> against a real SQLite file, for the
/// same reason C-3's and C-4's suites do: the configuration round trip is part of what is under test, and a
/// fake would define it away.</para>
/// </summary>
public sealed class LocalAnnunciationChannelTests : IDisposable
{
    private readonly List<string> _tempDirs = new();

    public void Dispose()
    {
        foreach (var dir in _tempDirs)
        {
            try { Directory.Delete(dir, recursive: true); } catch { /* best-effort cleanup */ }
        }
    }

    private string NewTempDir()
    {
        var dir = Directory.CreateTempSubdirectory("st4i-annunciation-tests-").FullName;
        _tempDirs.Add(dir);
        return dir;
    }

    private NotificationConfigStore NewStore() => new(NewTempDir());

    private static readonly DateTimeOffset FixedNow = new(2026, 7, 31, 11, 4, 5, TimeSpan.Zero);

    private static Alarm MakeAlarm(
        string key = "DriverHealth|DOWN|MODBUS-01",
        AlarmPriority priority = AlarmPriority.High,
        AlarmState state = AlarmState.Active,
        string? runbook = "runbook://drivers/down",
        bool clearOnAck = false) =>
        new(1, key, AlarmSource.DriverHealth, "DOWN", priority, state,
            "Driver MODBUS-01 is unreachable", runbook, "MODBUS-01",
            ClearOnAck: clearOnAck, Count: 7,
            FirstRaisedUtc: new DateTimeOffset(2026, 7, 31, 11, 0, 0, TimeSpan.Zero),
            LastRaisedUtc: new DateTimeOffset(2026, 7, 31, 11, 4, 0, TimeSpan.Zero),
            AckedUtc: null, AckedBy: null);

    private static NotificationJob MakeJob(
        AlarmEdgeKind edge = AlarmEdgeKind.Raised,
        Alarm? alarm = null,
        AlarmPriority? previousPriority = null,
        string? actor = null,
        long sequence = 91) =>
        new(sequence, edge, alarm ?? MakeAlarm(), FixedNow, previousPriority, actor);

    /// <summary>🔴 Review round 1 (M-1) — there is no <c>warnings</c> parameter, because the channel has no
    /// <c>logWarning</c> to collect from. It briefly had both, copied from C-3/C-4 where they are used, and
    /// the dead delegate made half of <see cref="AThrowingLogDelegate_IsNotItselfAFailure"/> inert.</summary>
    private static LocalAnnunciationChannel NewChannel(
        NotificationConfigStore store,
        AlarmAnnunciationHub hub,
        ICollection<(Exception Cause, string Message)>? errors = null) =>
        new(store, hub,
            logError: (ex, msg) => { if (errors is not null) lock (errors) errors.Add((ex, msg)); });

    /// <summary>Drains everything a listener has RIGHT NOW. Publishing is synchronous and has already
    /// completed by the time <c>DispatchAsync</c> returns, so this never has to wait for anything.</summary>
    private static List<AlarmAnnunciation> Drain(AlarmAnnunciationHub.Listener listener)
    {
        var items = new List<AlarmAnnunciation>();
        while (listener.Reader.TryRead(out var item)) items.Add(item);
        return items;
    }

    // ─────────────────────────────────────────────────────────────────────
    // The configuration gate — the severity inversion, in both directions.
    // ─────────────────────────────────────────────────────────────────────

    /// <summary>
    /// <see cref="AlarmPriority"/> is declared MOST-severe-first, so "at least as severe as the threshold"
    /// is <c>&lt;=</c> and not <c>&gt;=</c>. Both directions are asserted for every threshold, so an
    /// implementation with the comparison inverted — which would annunciate everything EXCEPT the alarms
    /// that matter — cannot pass by getting one row right.
    /// </summary>
    [Theory]
    [InlineData(AlarmPriority.Critical, AlarmPriority.Critical, true)]
    [InlineData(AlarmPriority.Critical, AlarmPriority.High, false)]
    [InlineData(AlarmPriority.Critical, AlarmPriority.Medium, false)]
    [InlineData(AlarmPriority.Critical, AlarmPriority.Low, false)]
    [InlineData(AlarmPriority.High, AlarmPriority.Critical, true)]
    [InlineData(AlarmPriority.High, AlarmPriority.High, true)]
    [InlineData(AlarmPriority.High, AlarmPriority.Medium, false)]
    [InlineData(AlarmPriority.High, AlarmPriority.Low, false)]
    [InlineData(AlarmPriority.Low, AlarmPriority.Critical, true)]
    [InlineData(AlarmPriority.Low, AlarmPriority.Low, true)]
    public async Task AnAlarmIsAnnunciated_AtOrAboveTheThreshold_AndNeverBelowIt(
        AlarmPriority minPriority, AlarmPriority alarmPriority, bool expected)
    {
        var store = NewStore();
        Assert.True(await store.SaveLocalAnnunciationAsync(enabled: true, minPriority));

        var hub = new AlarmAnnunciationHub();
        using var listener = hub.Subscribe();
        var channel = NewChannel(store, hub);

        await channel.DispatchAsync(MakeJob(alarm: MakeAlarm(priority: alarmPriority)));

        var received = Drain(listener);
        var stats = channel.Stats;

        Assert.Equal(expected ? 1 : 0, received.Count);
        Assert.Equal(expected ? 1 : 0, stats.Announced);
        Assert.Equal(expected ? 0 : 1, stats.Suppressed);
        Assert.Equal(0, stats.Unheard);
        Assert.Equal(0, stats.Lost);
        Assert.Equal(1, stats.Considered);
    }

    [Fact]
    public async Task ADisabledInstance_AnnunciatesNothing_AndIsCountedSuppressed()
    {
        var store = NewStore();
        Assert.True(await store.SaveLocalAnnunciationAsync(enabled: false, AlarmPriority.Low));

        var hub = new AlarmAnnunciationHub();
        using var listener = hub.Subscribe();
        var channel = NewChannel(store, hub);

        await channel.DispatchAsync(MakeJob(alarm: MakeAlarm(priority: AlarmPriority.Critical)));

        Assert.Empty(Drain(listener));
        Assert.Equal(0, hub.Published);
        var stats = channel.Stats;
        Assert.Equal(1, stats.Suppressed);
        Assert.Equal(0, stats.Announced);
        Assert.Equal(0, stats.Unheard);
    }

    /// <summary>Nothing configured at all: the channel must be silent and must move NOTHING but
    /// <c>Considered</c> — in particular it must not invent an <c>Unheard</c>, which would report a loss for
    /// a channel nobody asked for.</summary>
    [Fact]
    public async Task NothingConfigured_PublishesNothing_AndMovesNoCounterButConsidered()
    {
        var store = NewStore();
        var hub = new AlarmAnnunciationHub();
        using var listener = hub.Subscribe();
        var channel = NewChannel(store, hub);

        await channel.DispatchAsync(MakeJob(alarm: MakeAlarm(priority: AlarmPriority.Critical)));

        Assert.Empty(Drain(listener));
        Assert.Equal(0, hub.Published);
        Assert.Equal(new LocalAnnunciationStats(1, 0, 0, 0, 0, 0, 0), channel.Stats);
    }

    /// <summary>Another channel's configuration must not make this one annunciate. Cheap, and it is exactly
    /// the mistake a <c>foreach</c> over <c>ListAsync</c> without the channel filter makes.</summary>
    [Fact]
    public async Task AnotherChannelsConfiguration_IsIgnoredEntirely()
    {
        var store = NewStore();
        Assert.True(await store.SaveWebhookAsync(
            enabled: true, AlarmPriority.Low, "https://hooks.example/x"));
        Assert.True(await store.SaveSmtpAsync(
            enabled: true, AlarmPriority.Low, "mail.local", 25, SmtpTlsMode.None,
            "a@b.local", new[] { "c@d.local" }, username: null));

        var hub = new AlarmAnnunciationHub();
        using var listener = hub.Subscribe();
        var channel = NewChannel(store, hub);

        await channel.DispatchAsync(MakeJob(alarm: MakeAlarm(priority: AlarmPriority.Critical)));

        Assert.Empty(Drain(listener));
        Assert.Equal(new LocalAnnunciationStats(1, 0, 0, 0, 0, 0, 0), channel.Stats);
    }

    // ─────────────────────────────────────────────────────────────────────
    // 🔴 What "delivered" means here — the two tests this task exists for.
    // ─────────────────────────────────────────────────────────────────────

    /// <summary>
    /// 🔴 <b>The headline honesty test.</b> A local annunciation channel has no remote to answer it, so the
    /// tempting implementation publishes, returns, and counts a success. On an unattended machine — which is
    /// the normal state of the deployment this channel exists for — that would report every alarm as
    /// delivered while nothing whatsoever annunciated, and it would be indistinguishable from a working
    /// channel.
    ///
    /// <para>With nobody attached the annunciation is counted <c>Unheard</c>, and <c>Announced</c> stays at
    /// zero. The configuration is fine, the channel is enabled and the threshold is met — so
    /// <c>Suppressed</c> must stay zero too, or the "your configuration is working" bucket would be
    /// absorbing a real loss.</para>
    /// </summary>
    [Fact]
    public async Task WithNobodyListening_TheAnnunciationIsCountedUnheard_NotAsASuccess()
    {
        var store = NewStore();
        Assert.True(await store.SaveLocalAnnunciationAsync(enabled: true, AlarmPriority.Low));

        var hub = new AlarmAnnunciationHub();
        var channel = NewChannel(store, hub);
        Assert.Equal(0, hub.ListenerCount);

        await channel.DispatchAsync(MakeJob(alarm: MakeAlarm(priority: AlarmPriority.Critical)));

        var stats = channel.Stats;
        Assert.Equal(1, stats.Unheard);
        Assert.Equal(0, stats.Announced);
        Assert.Equal(0, stats.Suppressed);
        Assert.Equal(0, stats.Lost);
        Assert.Equal(0, stats.ListenersAtLastAnnunciation);
        // The publish really was attempted — otherwise this would pass for a channel that never ran at all.
        Assert.Equal(1, hub.Published);
        Assert.Equal(0, hub.FannedOut);
    }

    /// <summary>With a listener attached, the annunciation really arrives and carries every field the
    /// browser renders. Asserted field by field rather than "something arrived": a payload that silently
    /// lost <c>runbook</c> or <c>priority</c> would still satisfy a count.</summary>
    [Fact]
    public async Task WithAListenerAttached_ItReallyReceivesTheEdge_AndItIsCountedAnnounced()
    {
        var store = NewStore();
        Assert.True(await store.SaveLocalAnnunciationAsync(enabled: true, AlarmPriority.High));

        var hub = new AlarmAnnunciationHub();
        using var listener = hub.Subscribe();
        var channel = NewChannel(store, hub);

        await channel.DispatchAsync(MakeJob(sequence: 4242));

        var received = Assert.Single(Drain(listener));
        Assert.Equal(4242, received.Sequence);
        Assert.Equal(AlarmEdgeKind.Raised, received.Edge);
        Assert.Equal(FixedNow, received.AtUtc);
        Assert.Equal(NotificationConfigStore.DefaultInstance, received.Instance);
        Assert.Equal("DriverHealth|DOWN|MODBUS-01", received.Key);
        Assert.Equal(AlarmSource.DriverHealth, received.Source);
        Assert.Equal("DOWN", received.Code);
        Assert.Equal(AlarmPriority.High, received.Priority);
        Assert.Equal(AlarmState.Active, received.State);
        Assert.Equal("Driver MODBUS-01 is unreachable", received.Message);
        Assert.Equal("runbook://drivers/down", received.Runbook);
        Assert.Equal("MODBUS-01", received.TargetId);
        Assert.False(received.ClearOnAck);
        Assert.Equal(7, received.Count);
        Assert.Null(received.PreviousPriority);
        Assert.Null(received.Actor);

        var stats = channel.Stats;
        Assert.Equal(1, stats.Announced);
        Assert.Equal(0, stats.Unheard);
        Assert.Equal(1, stats.ListenersAtLastAnnunciation);
    }

    /// <summary>🔴 <c>Alarm.Id</c> is the SQLite rowid, and C-1's review established that SQLite hands a
    /// deleted high-water rowid straight back to the next insert — so a client keying on it would merge two
    /// unrelated alarms. It must not be on the wire, and this pins that by serialising the real payload
    /// rather than by reading the record definition.</summary>
    [Fact]
    public void TheWirePayload_CarriesNoAlarmRowId_BecauseSqliteReusesThem()
    {
        var json = JsonSerializer.Serialize(
            AlarmAnnunciation.From(MakeJob(), "default"),
            new JsonSerializerOptions(JsonSerializerDefaults.Web));

        Assert.DoesNotContain("\"id\"", json, StringComparison.OrdinalIgnoreCase);
        // Non-vacuity: the stable identity IS there, so this is not passing because nothing serialised.
        Assert.Contains("\"key\":\"DriverHealth|DOWN|MODBUS-01\"", json, StringComparison.Ordinal);
    }

    /// <summary>The SSE framing on the wire is <c>data: &lt;one line&gt;</c>, so a raw newline inside the
    /// serialised payload would split one event into two malformed ones. <c>System.Text.Json</c> escapes
    /// newlines, and the endpoint's own comment says so — this is what makes that an assertion rather than
    /// an assumption.</summary>
    [Fact]
    public void TheWirePayload_IsAlwaysOneLine_SoSseFramingCannotBeSplitByAnAlarmMessage()
    {
        var nasty = MakeAlarm(key: "K\nnewline") with
        {
            Message = "line one\nline two\r\nline three",
            Runbook = "runbook\nwith\nnewlines",
        };

        var json = JsonSerializer.Serialize(
            AlarmAnnunciation.From(MakeJob(alarm: nasty), "default"),
            new JsonSerializerOptions(JsonSerializerDefaults.Web));

        Assert.DoesNotContain('\n', json);
        Assert.DoesNotContain('\r', json);
        // Non-vacuity: the message really is in there, escaped rather than dropped.
        Assert.Contains("line one", json, StringComparison.Ordinal);
    }

    [Fact]
    public async Task TwoListeners_BothReceiveIt_AndTheGaugeReportsTwo()
    {
        var store = NewStore();
        Assert.True(await store.SaveLocalAnnunciationAsync(enabled: true, AlarmPriority.Low));

        var hub = new AlarmAnnunciationHub();
        using var first = hub.Subscribe();
        using var second = hub.Subscribe();
        var channel = NewChannel(store, hub);

        await channel.DispatchAsync(MakeJob());

        Assert.Single(Drain(first));
        Assert.Single(Drain(second));
        var stats = channel.Stats;
        // ONE (notification, instance) pair, however many screens heard it — the counter's unit is the
        // pair, and the listener count is a separate gauge.
        Assert.Equal(1, stats.Announced);
        Assert.Equal(2, stats.ListenersAtLastAnnunciation);
        Assert.Equal(2, hub.FannedOut);
    }

    /// <summary>A page that closed must stop counting as somebody who heard it. Without this the channel
    /// would keep reporting <c>Announced</c> for an empty control room — the same lie as the unconditional
    /// success, arriving a few minutes later.</summary>
    [Fact]
    public async Task AListenerThatDetached_StopsCounting_AndTheAnnunciationGoesBackToUnheard()
    {
        var store = NewStore();
        Assert.True(await store.SaveLocalAnnunciationAsync(enabled: true, AlarmPriority.Low));

        var hub = new AlarmAnnunciationHub();
        var channel = NewChannel(store, hub);

        var listener = hub.Subscribe();
        await channel.DispatchAsync(MakeJob(sequence: 1));
        Assert.Equal(1, channel.Stats.Announced);
        Assert.Single(Drain(listener));

        listener.Dispose();
        Assert.Equal(0, hub.ListenerCount);

        await channel.DispatchAsync(MakeJob(sequence: 2));
        var stats = channel.Stats;
        Assert.Equal(1, stats.Announced);
        Assert.Equal(1, stats.Unheard);

        // Disposal also completes the reader, so the SSE handler's pending read returns instead of hanging.
        Assert.False(listener.Reader.TryRead(out _));
        Assert.True(listener.Reader.Completion.IsCompleted);
        // Idempotent — the handler's finally can run after the connection already faulted.
        listener.Dispose();
    }

    /// <summary>
    /// 🔴 The second honesty test, and the subtler one. A wedged browser session is still ATTACHED — so a
    /// channel that counted attachment rather than acceptance would report every alarm as annunciated to a
    /// page that has stopped consuming anything.
    ///
    /// <para>The queue is filled to capacity first (proving the listener is genuinely full rather than
    /// absent), then one more annunciation is published: the listener refuses it, the hub counts the
    /// refusal, and the channel counts <c>Unheard</c> rather than <c>Announced</c>.</para>
    /// </summary>
    [Fact]
    public async Task AListenerTooFarBehind_DoesNotMakeTheAnnunciationLookHeard()
    {
        var store = NewStore();
        Assert.True(await store.SaveLocalAnnunciationAsync(enabled: true, AlarmPriority.Low));

        const int Capacity = 4;
        var hub = new AlarmAnnunciationHub(listenerCapacity: Capacity);
        using var wedged = hub.Subscribe();
        var channel = NewChannel(store, hub);

        for (var i = 0; i < Capacity; i++)
        {
            await channel.DispatchAsync(MakeJob(sequence: i));
        }
        Assert.Equal(Capacity, channel.Stats.Announced);
        Assert.Equal(0, hub.Overflowed);

        // One past the brim. The listener is attached and useless, which is the whole point.
        await channel.DispatchAsync(MakeJob(sequence: 99));

        var stats = channel.Stats;
        Assert.Equal(Capacity, stats.Announced);
        Assert.Equal(1, stats.Unheard);
        Assert.Equal(1, hub.Overflowed);
        Assert.Equal(1, hub.ListenerCount);
        // And the overflow really dropped the NEW one rather than evicting an old one — a drop-oldest queue
        // would have kept the count at Capacity while silently losing the earliest alarm instead.
        var received = Drain(wedged);
        Assert.Equal(Capacity, received.Count);
        Assert.DoesNotContain(received, item => item.Sequence == 99);
    }

    /// <summary>One wedged session must not silence a healthy one. The annunciation is <c>Announced</c>
    /// because somebody really got it, AND the overflow is still counted — both facts, neither hiding the
    /// other.</summary>
    [Fact]
    public async Task OneWedgedListenerAndOneHealthy_IsStillAnnounced_AndTheOverflowIsStillCounted()
    {
        var store = NewStore();
        Assert.True(await store.SaveLocalAnnunciationAsync(enabled: true, AlarmPriority.Low));

        const int Capacity = 2;
        var hub = new AlarmAnnunciationHub(listenerCapacity: Capacity);
        using var wedged = hub.Subscribe();
        using var healthy = hub.Subscribe();
        var channel = NewChannel(store, hub);

        for (var i = 0; i < Capacity; i++)
        {
            await channel.DispatchAsync(MakeJob(sequence: i));
            Drain(healthy); // the healthy one keeps up; the wedged one never reads
        }

        await channel.DispatchAsync(MakeJob(sequence: 77));

        var stats = channel.Stats;
        Assert.Equal(Capacity + 1, stats.Announced);
        Assert.Equal(0, stats.Unheard);
        Assert.Equal(1, stats.ListenersAtLastAnnunciation);
        Assert.Equal(1, hub.Overflowed);
        Assert.Equal(77, Assert.Single(Drain(healthy)).Sequence);
    }

    // ─────────────────────────────────────────────────────────────────────
    // Edge kinds — including the two an annunciator exists to STOP on.
    // ─────────────────────────────────────────────────────────────────────

    /// <summary>
    /// 🔴 All five edge kinds are published, and the two that matter most are the ones a message-oriented
    /// channel could reasonably drop. <see cref="AlarmEdgeKind.Acked"/> is ISA-18.2's "silence the horn" and
    /// <see cref="AlarmEdgeKind.Cleared"/> releases the latch; a channel that published only
    /// <see cref="AlarmEdgeKind.Raised"/> would leave the screen shouting about an alarm somebody had
    /// already taken responsibility for.
    /// </summary>
    [Theory]
    [InlineData(AlarmEdgeKind.Raised)]
    [InlineData(AlarmEdgeKind.Escalated)]
    [InlineData(AlarmEdgeKind.Acked)]
    [InlineData(AlarmEdgeKind.Cleared)]
    [InlineData(AlarmEdgeKind.Restored)]
    public async Task EveryEdgeKindIsPublished_IncludingTheTwoAnAnnunciatorStopsOn(AlarmEdgeKind edge)
    {
        var store = NewStore();
        Assert.True(await store.SaveLocalAnnunciationAsync(enabled: true, AlarmPriority.Low));

        var hub = new AlarmAnnunciationHub();
        using var listener = hub.Subscribe();
        var channel = NewChannel(store, hub);

        await channel.DispatchAsync(MakeJob(edge: edge));

        Assert.Equal(edge, Assert.Single(Drain(listener)).Edge);
        Assert.Equal(1, channel.Stats.Announced);
    }

    [Fact]
    public async Task AnEscalationCarriesWhatItEscalatedFrom_AndAnAckCarriesWhoAckedIt()
    {
        var store = NewStore();
        Assert.True(await store.SaveLocalAnnunciationAsync(enabled: true, AlarmPriority.Low));

        var hub = new AlarmAnnunciationHub();
        using var listener = hub.Subscribe();
        var channel = NewChannel(store, hub);

        await channel.DispatchAsync(MakeJob(
            edge: AlarmEdgeKind.Escalated,
            alarm: MakeAlarm(priority: AlarmPriority.Critical),
            previousPriority: AlarmPriority.High));
        await channel.DispatchAsync(MakeJob(
            edge: AlarmEdgeKind.Acked,
            alarm: MakeAlarm(state: AlarmState.Acked),
            actor: "operator-7",
            sequence: 92));

        var received = Drain(listener);
        Assert.Equal(2, received.Count);
        Assert.Equal(AlarmPriority.High, received[0].PreviousPriority);
        Assert.Equal(AlarmPriority.Critical, received[0].Priority);
        Assert.Equal("operator-7", received[1].Actor);
        Assert.Equal(AlarmState.Acked, received[1].State);
    }

    // ─────────────────────────────────────────────────────────────────────
    // The accounting invariant.
    // ─────────────────────────────────────────────────────────────────────

    /// <summary>
    /// 🔴 For every (notification, instance) pair, EXACTLY ONE of Suppressed / Announced / Unheard / Lost
    /// moves. Driven with three instances producing two different outcomes at once from one dispatch, with
    /// the sum asserted against the instance count — so a path that moved two counters, or none, fails here
    /// rather than being noticed by a maintainer reading the switch.
    /// </summary>
    [Fact]
    public async Task EveryNotificationInstancePair_MovesExactlyOneCounter()
    {
        var store = NewStore();
        Assert.True(await store.SaveLocalAnnunciationAsync(enabled: true, AlarmPriority.Critical, "screens"));
        Assert.True(await store.SaveLocalAnnunciationAsync(enabled: false, AlarmPriority.Low, "off"));
        Assert.True(await store.SaveLocalAnnunciationAsync(enabled: true, AlarmPriority.Critical, "quiet"));

        var hub = new AlarmAnnunciationHub();
        using var listener = hub.Subscribe();
        var channel = NewChannel(store, hub);

        await channel.DispatchAsync(MakeJob(alarm: MakeAlarm(priority: AlarmPriority.Critical)));

        var withListener = channel.Stats;
        Assert.Equal(1, withListener.Considered);
        Assert.Equal(3, withListener.Suppressed + withListener.Announced +
                        withListener.Unheard + withListener.Lost);
        Assert.Equal(1, withListener.Suppressed); // "off"
        Assert.Equal(2, withListener.Announced);  // "screens" + "quiet", both reached the one open page

        // Same three instances, nobody attached: the two that were Announced become Unheard, and the sum
        // still equals the instance count. Two different outcome mixes over the same configuration is what
        // makes this an invariant rather than one arrangement that happens to add up.
        listener.Dispose();
        await channel.DispatchAsync(MakeJob(alarm: MakeAlarm(priority: AlarmPriority.Critical), sequence: 2));

        var after = channel.Stats;
        Assert.Equal(2, after.Considered);
        Assert.Equal(6, after.Suppressed + after.Announced + after.Unheard + after.Lost);
        Assert.Equal(2, after.Suppressed);
        Assert.Equal(2, after.Announced);
        Assert.Equal(2, after.Unheard);
        Assert.Equal(0, after.Lost);
    }

    // ─────────────────────────────────────────────────────────────────────
    // Never-throws.
    // ─────────────────────────────────────────────────────────────────────

    /// <summary>
    /// 🔴 C-1's drain loop counts a throwing dispatch delegate as a DispatchFailure and carries on, but a
    /// channel that throws is a channel whose own counters have stopped being true. A structurally broken
    /// job — the kind only an internal bug produces — must be absorbed, counted as a loss, and reported.
    /// </summary>
    [Fact]
    public async Task AStructurallyBrokenJob_DoesNotThrowOutOfTheDrainLoop_AndIsCountedLost()
    {
        var store = NewStore();
        Assert.True(await store.SaveLocalAnnunciationAsync(enabled: true, AlarmPriority.Low));

        var hub = new AlarmAnnunciationHub();
        using var listener = hub.Subscribe();
        var errors = new List<(Exception Cause, string Message)>();
        var channel = NewChannel(store, hub, errors: errors);

        // NotificationJob's contract says Alarm is never null; this is what an internal bug looks like.
        var broken = new NotificationJob(1, AlarmEdgeKind.Raised, null!, FixedNow);

        await channel.DispatchAsync(broken);

        Assert.Empty(Drain(listener));
        var stats = channel.Stats;
        Assert.Equal(1, stats.Lost);
        Assert.Equal(0, stats.Announced);
        Assert.Equal(0, stats.Unheard);
        var (_, message) = Assert.Single(errors);
        Assert.Contains("NOT annunciated", message, StringComparison.OrdinalIgnoreCase);
    }

    /// <summary>
    /// Reporting a failure must never itself become a failure — <c>logError</c> is caller-supplied and is
    /// reached from inside never-throws paths.
    ///
    /// <para>🔴 Review round 1 (M-1) — this test used to pass a throwing <c>logWarning</c> too, and that
    /// half was INERT: the channel never invoked it. The parameter is gone, and the assertion below is now
    /// only about the delegate that genuinely runs. A non-vacuity guard proves it really was invoked, so
    /// this cannot silently become inert again the way its predecessor did.</para>
    /// </summary>
    [Fact]
    public async Task AThrowingLogDelegate_IsNotItselfAFailure()
    {
        var store = NewStore();
        Assert.True(await store.SaveLocalAnnunciationAsync(enabled: true, AlarmPriority.Low));

        var hub = new AlarmAnnunciationHub();
        var invoked = 0;
        var channel = new LocalAnnunciationChannel(
            store, hub,
            logError: (_, _) =>
            {
                Interlocked.Increment(ref invoked);
                throw new InvalidOperationException("the logger is broken too");
            });

        await channel.DispatchAsync(new NotificationJob(1, AlarmEdgeKind.Raised, null!, FixedNow));

        Assert.Equal(1, channel.Stats.Lost);
        // Non-vacuity: the throwing delegate really ran, so "did not become a failure" is about a throw
        // that happened rather than about a hook that was never called.
        Assert.Equal(1, invoked);
    }

    // ─────────────────────────────────────────────────────────────────────
    // Cancellation.
    // ─────────────────────────────────────────────────────────────────────

    /// <summary>
    /// 🔴 A shutdown must be counted as a shutdown and must PROPAGATE, because C-1's drain loop counts an
    /// abandoned job as a drop and swallowing the exception would make a truncated drain invisible. It must
    /// also not be mistaken for <c>Unheard</c>, which would tell an operator nobody was watching when in
    /// fact the process was exiting.
    ///
    /// <para>Elapsed time is asserted, and the number is reported in the C-5 report. This channel has no
    /// network call and no budget, so the bound being measured is the whole dispatch path — the guard, the
    /// store read and the publish.</para>
    /// </summary>
    [Fact]
    public async Task Cancellation_IsHonouredPromptly_AndCountedAsAShutdownRatherThanAsUnheard()
    {
        var store = NewStore();
        Assert.True(await store.SaveLocalAnnunciationAsync(enabled: true, AlarmPriority.Low));

        var hub = new AlarmAnnunciationHub();
        using var listener = hub.Subscribe();
        var channel = NewChannel(store, hub);

        using var cts = new CancellationTokenSource();
        await cts.CancelAsync();

        var elapsed = Stopwatch.StartNew();
        var thrown = await Assert.ThrowsAnyAsync<OperationCanceledException>(
            () => channel.DispatchAsync(MakeJob(), cts.Token));
        elapsed.Stop();

        // Generous by three orders of magnitude against the ~0ms this actually takes — the assertion is
        // "nothing here blocks", not a benchmark that fails on a loaded CI box.
        // Measured on this platform at 1.99 / 2.05 / 2.33 ms across three runs (C-5 report §9). The bound
        // is two orders of magnitude above that on purpose: the assertion is "nothing in this path blocks",
        // not a benchmark that goes red on a loaded box.
        Assert.True(elapsed.ElapsedMilliseconds < 500,
            $"cancellation took {elapsed.ElapsedMilliseconds}ms.");

        // The token is the CALLER's, so C-1's `when (ct.IsCancellationRequested)` filter matches and the
        // job is counted as dropped rather than as a dispatch failure.
        Assert.Equal(cts.Token, thrown.CancellationToken);

        var stats = channel.Stats;
        Assert.Equal(1, stats.Cancelled);
        Assert.Equal(0, stats.Unheard);
        Assert.Equal(0, stats.Announced);
        Assert.Equal(0, stats.Lost);
        Assert.Empty(Drain(listener));
        Assert.Equal(0, hub.Published);
    }

    /// <summary>
    /// 🔴 <b>The property that actually matters about cancellation, asserted over the race rather than at
    /// one point in it: a notification NEVER vanishes with no counter moving.</b>
    ///
    /// <para>A shutdown can land at three places in this dispatch — before the entry guard, inside
    /// <see cref="NotificationConfigStore.ListAsync"/> (where C-4 made the store throw rather than return an
    /// empty list), and after that read has returned but before anything is acted on. No test can pin the
    /// third in isolation: the window is nanoseconds wide, and the honest thing is to say so rather than to
    /// write a test whose name claims a window it cannot hit. What CAN be pinned, and is what the guards
    /// exist for, is the invariant across all three: every dispatch either completes with a real outcome or
    /// throws with <c>Cancelled</c> moved, and the counters always add up to the number of dispatches. The
    /// failure this forbids is the one C-1's review found twice — a notification that simply disappears
    /// because an empty configuration list was indistinguishable from "nothing is configured".</para>
    ///
    /// <para>Both outcomes are accepted per iteration, so this cannot flake on timing; what it cannot
    /// tolerate is a dispatch that neither annunciated nor counted anything.</para>
    /// </summary>
    [Fact]
    public async Task UnderARacingShutdown_EveryDispatchEitherCompletesOrIsCountedCancelled_NeverVanishes()
    {
        var store = NewStore();
        Assert.True(await store.SaveLocalAnnunciationAsync(enabled: true, AlarmPriority.Low));
        _ = await store.ListAsync(); // warm the SQLite file so the race is over the read, not over open()

        var hub = new AlarmAnnunciationHub(listenerCapacity: 1024);
        using var listener = hub.Subscribe();
        var channel = NewChannel(store, hub);

        const int Iterations = 60;
        var threw = 0;
        for (var i = 0; i < Iterations; i++)
        {
            using var cts = new CancellationTokenSource();
            // Straddles the whole dispatch: some iterations cancel before it starts, some during the store
            // read, some after it has returned.
            cts.CancelAfter(TimeSpan.FromTicks(i * 2000));
            try
            {
                await channel.DispatchAsync(MakeJob(sequence: i), cts.Token);
            }
            catch (OperationCanceledException)
            {
                threw++;
                // 🔴 Asserted on the TOKEN STATE, not on the exception's own CancellationToken, and the
                // difference is load-bearing: when the shutdown lands inside the store's SQLite read the
                // OperationCanceledException that surfaces carries ADO.NET's token rather than the
                // caller's. C-1's drain loop filters with `when (ct.IsCancellationRequested)` — the token
                // STATE — precisely so that both shapes are recognised as a shutdown, so this asserts the
                // same thing the drain loop actually tests.
                Assert.True(cts.Token.IsCancellationRequested);
            }
        }

        var stats = channel.Stats;
        Assert.Equal(Iterations, stats.Considered);
        // 🔴 Review round 1 (M-2) — the race must actually have raced, on BOTH sides. Without these two
        // guards this test would pass for a sweep that never cancelled anything (or one that cancelled
        // everything), asserting an invariant over a case it never reached. `TheHubTolerates…` in this file
        // guards its own race the same way; this one was missing it.
        Assert.True(threw > 0, "no iteration was cancelled — the sweep never reached the race at all.");
        Assert.True(threw < Iterations,
            $"every one of the {Iterations} iterations was cancelled — the sweep never reached the " +
            "completing side, so the invariant was only checked against one outcome.");
        // 🔴 The invariant. Every dispatch is accounted for exactly once, whichever side of the race it
        // fell on, and nothing was absorbed.
        Assert.Equal(Iterations, stats.Cancelled + stats.Announced + stats.Unheard + stats.Lost);
        Assert.Equal(threw, stats.Cancelled);
        Assert.Equal(0, stats.Lost);
        // A cancelled dispatch publishes nothing, so the listener saw exactly the ones that got through.
        Assert.Equal(stats.Announced, Drain(listener).Count);
    }

    /// <summary>
    /// 🔴 <b>The premise this channel's two cancellation guards rest on, pinned so the dependency is LOUD
    /// rather than silent.</b>
    ///
    /// <para>Stated plainly, because mutation says so and reading would not: deleting EITHER
    /// <c>ct.ThrowIfCancellationRequested()</c> from <c>DispatchAsync</c> leaves this whole suite green.
    /// They are redundant today because C-4 made <see cref="NotificationConfigStore"/> propagate
    /// cancellation itself, and that is what actually produces the behaviour
    /// <see cref="Cancellation_IsHonouredPromptly_AndCountedAsAShutdownRatherThanAsUnheard"/> asserts. The
    /// guards are kept anyway — they are one line each and they are what stops a future store regression
    /// from turning a shutdown into "nothing is configured" — but a redundancy nobody has written down is
    /// how a guard gets deleted as dead code, taking a real guarantee with it.</para>
    ///
    /// <para>So this asserts the store behaviour the guards are redundant WITH. If C-2's store ever goes
    /// back to swallowing cancellation, this turns red in the same commit and the guards stop being
    /// belt-and-braces. The non-vacuity half matters as much: a store read that merely FAILS must still not
    /// throw, or the never-throws contract the whole batch is built on would have been broken instead.</para>
    /// </summary>
    [Fact]
    public async Task ACancelledStoreRead_Throws_WhichIsWhyThisChannelsOwnGuardsAreBeltAndBraces()
    {
        var store = NewStore();
        Assert.True(await store.SaveLocalAnnunciationAsync(enabled: true, AlarmPriority.Low));

        using var cts = new CancellationTokenSource();
        await cts.CancelAsync();

        await Assert.ThrowsAnyAsync<OperationCanceledException>(() => store.ListAsync(cts.Token));

        // Non-vacuity, in both directions that matter.
        //
        // (a) The same read on the same store with a LIVE token does not throw and really returns the row —
        //     so the assertion above is about cancellation, not about this store being broken.
        Assert.Single(await store.ListAsync());

        // (b) A store whose database file has been replaced with garbage FAILS, and a failure is still
        //     never-throws. Without this the assertion above would also pass for a store that had simply
        //     become throwy in general, which would be a breach of the contract the whole batch rests on
        //     rather than the cancellation fix it is meant to pin.
        //     (ClearAllPools first: Microsoft.Data.Sqlite pools connections, so the file stays locked after
        //     the reads above until the pool is drained.)
        var brokenDir = NewTempDir();
        var broken = new NotificationConfigStore(brokenDir);
        Assert.True(await broken.SaveLocalAnnunciationAsync(enabled: true, AlarmPriority.Low));
        Microsoft.Data.Sqlite.SqliteConnection.ClearAllPools();
        await File.WriteAllTextAsync(
            Path.Combine(brokenDir, "notifications.db"), "this is not a SQLite database");
        Assert.Empty(await broken.ListAsync());
    }

    // ─────────────────────────────────────────────────────────────────────
    // End to end through C-1's real edge detector and a real alarm store.
    // ─────────────────────────────────────────────────────────────────────

    /// <summary>
    /// 🔴 The whole point of Đợt C in one test, for this channel: the 5s re-raise storm reaches the screen
    /// exactly ONCE. A real <see cref="AlarmStore"/>, a real <see cref="AlarmNotifier"/> with this channel
    /// as its dispatch delegate, and 240 raises of one unchanged alarm — an hour of evaluator ticks —
    /// produce one annunciation, and the clear produces one more.
    /// </summary>
    [Fact]
    public async Task ThroughTheRealNotifier_240RaisesOfOneAlarm_AnnunciateExactlyOnce()
    {
        var store = NewStore();
        Assert.True(await store.SaveLocalAnnunciationAsync(enabled: true, AlarmPriority.Low));

        var hub = new AlarmAnnunciationHub(listenerCapacity: 512);
        using var listener = hub.Subscribe();
        var channel = NewChannel(store, hub);

        await using var notifier = new AlarmNotifier(dispatch: channel.DispatchAsync);
        var alarms = new AlarmStore(NewTempDir(), notifier: notifier);

        var raise = new AlarmRaise(
            AlarmSource.DriverHealth, "DOWN", AlarmPriority.Critical, "unreachable", TargetId: "slot-1");
        for (var i = 0; i < 240; i++) await alarms.RaiseAsync(raise);
        await alarms.ClearAsync(raise.Key);

        var deadline = DateTimeOffset.UtcNow.AddSeconds(20);
        while (channel.Stats.Considered < 2 && DateTimeOffset.UtcNow < deadline) await Task.Delay(10);

        var received = Drain(listener);
        Assert.Equal(2, received.Count);
        Assert.Equal(AlarmEdgeKind.Raised, received[0].Edge);
        Assert.Equal(AlarmEdgeKind.Cleared, received[1].Edge);
        Assert.Equal(2, channel.Stats.Announced);
        // Non-vacuity: the detector really did see all 240 and suppressed 239 of them, rather than the
        // store having quietly stopped raising.
        Assert.Equal(239, notifier.Stats.Suppressed);
    }

    // ─────────────────────────────────────────────────────────────────────
    // The hub, on its own.
    // ─────────────────────────────────────────────────────────────────────

    /// <summary>The hub's <c>TryOffer</c> must return FALSE on a full queue, not silently discard. That is
    /// the whole reason its channel uses <c>BoundedChannelFullMode.Wait</c>: <c>DropWrite</c> returns TRUE
    /// while dropping, which would make the hub report an annunciation that never happened — the same lie
    /// this channel exists to avoid, one layer down.</summary>
    [Fact]
    public void TheHubReportsARefusal_RatherThanDroppingSilently()
    {
        var hub = new AlarmAnnunciationHub(listenerCapacity: 1);
        using var listener = hub.Subscribe();
        var annunciation = AlarmAnnunciation.From(MakeJob(), "default");

        Assert.Equal(1, hub.Publish(annunciation));
        Assert.Equal(0, hub.Publish(annunciation));

        Assert.Equal(2, hub.Published);
        Assert.Equal(1, hub.FannedOut);
        Assert.Equal(1, hub.Overflowed);
        Assert.Single(Drain(listener));
    }

    [Fact]
    public void PublishingWithNoListeners_IsCountedAndReportsZero()
    {
        var hub = new AlarmAnnunciationHub();
        Assert.Equal(0, hub.Publish(AlarmAnnunciation.From(MakeJob(), "default")));
        Assert.Equal(1, hub.Published);
        Assert.Equal(0, hub.FannedOut);
        Assert.Equal(0, hub.Overflowed);
        Assert.Equal(0, hub.ListenerCount);
    }

    /// <summary>Listeners come and go on request threads while the drain thread publishes. The registry
    /// must tolerate that; this drives 8 concurrent subscribe/dispose loops against a continuous publisher
    /// and asserts the accounting still adds up and nothing throws.</summary>
    [Fact]
    public async Task TheHubToleratesListenersAttachingAndDetachingWhilePublishing()
    {
        var hub = new AlarmAnnunciationHub(listenerCapacity: 8);
        var annunciation = AlarmAnnunciation.From(MakeJob(), "default");
        using var stop = new CancellationTokenSource(TimeSpan.FromMilliseconds(400));

        var publisher = Task.Run(() =>
        {
            var published = 0L;
            while (!stop.IsCancellationRequested)
            {
                hub.Publish(annunciation);
                published++;
            }
            return published;
        });

        var churn = Enumerable.Range(0, 8).Select(index => Task.Run(() =>
        {
            _ = index;
            while (!stop.IsCancellationRequested)
            {
                using var listener = hub.Subscribe();
                while (listener.Reader.TryRead(out _)) { }
            }
        })).ToArray();

        var count = await publisher;
        await Task.WhenAll(churn);

        // Non-vacuity: the race really ran, on both sides.
        Assert.True(count > 100, $"only {count} publishes — the race did not run.");
        Assert.True(hub.FannedOut > 0, "no listener ever accepted anything — the churn never attached.");
        Assert.Equal(count, hub.Published);
        // 🔴 Every listener that attached was removed again by its Dispose. A registry that leaked entries
        // would leave the channel counting Announced forever against pages that closed hours ago.
        Assert.Equal(0, hub.ListenerCount);
    }
}
