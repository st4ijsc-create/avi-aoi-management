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
/// <item><description><b>It must not block.</b> <see cref="IAlarmStore.RaiseAsync"/> runs on the request
/// path of every policy denial (<c>PolicyResults.DenyAsync</c>). <see cref="Notify"/> is deliberately
/// <see langword="void"/> and synchronous: the only correct implementation shape is "decide, then
/// <c>TryWrite</c> into a bounded channel" — never an await, never an HTTP call, never a
/// file/serial/relay write. See <see cref="AlarmNotifier"/>, which follows
/// <see cref="St4i.EdgeCore.Historian.HistorianWriter"/>'s established enqueue/drain
/// idiom.</description></item>
/// </list>
///
/// The default is <see cref="NullAlarmNotifier"/> — with nothing configured, behaviour is bit-for-bit
/// what it was before Đợt C. This whole batch is additive and default-off.
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
/// repository and (until <c>ST4I_ALARM_NOTIFY_ENABLED</c> is set) the production host as well — so the
/// alarm engine's behaviour with Đợt C merged is byte-identical to its behaviour before, right down to
/// not having an extra thread.
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
