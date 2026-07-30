namespace St4i.EngineApi.Alarms;

/// <summary>
/// Task C-1 (Đợt C, <c>docs/plans/2026-07-30-dotC-alarm-notification-blueprint.md</c> §6) — the seam every
/// notification channel sits behind. Webhook (C-3), SMTP (C-4), local annunciation (C-5) and the physical
/// relay (C-6) all hang off THIS, and none of them exist yet: this interface plus
/// <see cref="AlarmNotifier"/> are the whole of C-1.
///
/// 🔴 <see cref="Notify"/> is called from <see cref="AlarmStore"/> immediately after a successful
/// <c>active_alarms</c> write, which means it inherits that method's two hardest constraints:
/// <list type="bullet">
/// <item><description><b>It must never throw.</b> <see cref="IAlarmStore.RaiseAsync"/>/
/// <see cref="IAlarmStore.ClearAsync"/> are documented never-throws (see <see cref="IAlarmStore"/>) —
/// an alarm must be recorded even when everything else is on fire. An implementation that throws would
/// break that contract from the inside. (<see cref="AlarmStore"/> ALSO wraps every call in its own
/// try/catch — belt and braces, and tested — but that guard exists to survive a hostile implementation,
/// not to excuse one.)</description></item>
/// <item><description>🔴 <b>It must not block — and the blast radius is the whole process, not just the
/// caller.</b> <see cref="Notify"/> is invoked from inside <c>AlarmStore._writeGate</c>, the
/// capacity-1 semaphore that serialises write-then-notify so that transitions reach the edge detector in
/// commit order (see that field's doc comment for the race it closes). A <see cref="Notify"/> that blocks
/// therefore does not merely slow ITS OWN caller: it stalls <b>every alarm write in the process</b> behind
/// it — every <see cref="AlarmSource.DriverHealth"/>/<see cref="AlarmSource.NgRate"/> evaluator tick and
/// every policy denial on the HTTP request path (<c>PolicyResults.DenyAsync</c>), whether or not they have
/// anything to do with the alarm being notified. That is why this is a hard requirement and not a
/// preference. <see cref="Notify"/> is deliberately <see langword="void"/> and synchronous: the only
/// correct implementation shape is "decide, then <c>TryWrite</c> into a bounded channel" — never an await,
/// never a sleep, never an HTTP call, never a file/serial/relay write. Real work belongs on the far side
/// of the channel, on the drain loop. See <see cref="AlarmNotifier"/>, which follows
/// <see cref="St4i.EdgeCore.Historian.HistorianWriter"/>'s established enqueue/drain
/// idiom.</description></item>
/// </list>
///
/// The default is <see cref="NullAlarmNotifier"/>, which does nothing and allocates nothing — see there.
///
/// <para>🔴 Task C-2 (review round 2, M1) — this used to say "with nothing configured, behaviour is
/// bit-for-bit what it was before Đợt C; this whole batch is additive and default-off". <b>That is no
/// longer true of the production host and must not be repeated.</b> C-2 deleted the
/// <c>ST4I_ALARM_NOTIFY_ENABLED</c> gate and now registers a real <see cref="AlarmNotifier"/>
/// unconditionally, so a fresh install starts one bounded channel, one drain loop and one hosted service
/// it did not start before. The trade was made deliberately: a seam that is only sometimes registered is a
/// seam an operator can configure and never have run. <see cref="NullAlarmNotifier"/> remains the default
/// for every OTHER construction site — every test, and any non-host caller that builds an
/// <see cref="AlarmStore"/> directly.</para>
/// </summary>
public interface IAlarmNotifier
{
    /// <summary>Reports a completed <see cref="IAlarmStore"/> write. MUST be non-blocking and MUST NOT
    /// throw. Implementations are responsible for edge detection — <paramref name="transition"/> reports
    /// what the DATABASE did, including <see cref="AlarmTransitionKind.ReRaised"/>, which arrives once
    /// every <see cref="AlarmThresholds.EvalIntervalMs"/> (5s) for as long as a DriverHealth/NgRate
    /// condition holds and must NOT reach a channel.</summary>
    /// <param name="transition">The store's own report of what it did. A
    /// <see cref="AlarmTransitionKind.None"/> transition is a legal no-op.</param>
    /// <param name="actor">The username behind an ack/ack-clear, or <see langword="null"/> for a
    /// system-originated write (a raise, an evaluator clear).</param>
    /// <remarks>Called while <c>AlarmStore._writeGate</c> is held — see the interface's own doc comment.
    /// Blocking here blocks every alarm write in the process, and calling back into
    /// <see cref="IAlarmStore"/> from here would re-enter that gate and deadlock.</remarks>
    void Notify(AlarmTransition transition, string? actor = null);

    /// <summary>Called ONCE at host start with everything currently in <c>active_alarms</c> — alarms this
    /// process did not raise and will never see a <see cref="AlarmTransitionKind.Raised"/> transition
    /// for. See <see cref="AlarmNotifier.SeedFromActive"/> for what a real implementation must do with
    /// them and why. MUST be non-blocking and MUST NOT throw, same as
    /// <see cref="Notify"/>.</summary>
    void SeedFromActive(IReadOnlyList<Alarm> active);
}

/// <summary>
/// Task C-1 — the DEFAULT <see cref="IAlarmNotifier"/>: does nothing, allocates nothing, starts no
/// background loop. <see cref="AlarmStore"/> falls back to this whenever its optional <c>notifier</c>
/// constructor parameter is <see langword="null"/>, which is every pre-existing construction site in this
/// repository — every test and every non-host caller that constructs an <see cref="AlarmStore"/> directly.
///
/// <para>Task C-2 — the PRODUCTION host is no longer one of them. C-1's <c>ST4I_ALARM_NOTIFY_ENABLED</c>
/// env gate is DELETED, and <c>Program.cs</c> now registers a real <see cref="AlarmNotifier"/>
/// unconditionally: a seam that is only sometimes present is a seam that can be configured and then
/// silently never run. Whether anything is actually DELIVERED is decided by
/// <see cref="NotificationConfigStore"/> alone — see <see cref="NotificationStartupNotices"/> — never by
/// whether the notifier object happens to exist.</para>
/// </summary>
public sealed class NullAlarmNotifier : IAlarmNotifier
{
    /// <summary>The single shared instance — it holds no state, so there is no reason for a second.</summary>
    public static readonly NullAlarmNotifier Instance = new();

    private NullAlarmNotifier()
    {
    }

    /// <inheritdoc/>
    public void Notify(AlarmTransition transition, string? actor = null)
    {
    }

    /// <inheritdoc/>
    public void SeedFromActive(IReadOnlyList<Alarm> active)
    {
    }
}
