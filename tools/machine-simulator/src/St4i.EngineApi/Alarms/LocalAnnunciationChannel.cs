namespace St4i.EngineApi.Alarms;

/// <summary>
/// Task C-5 — a point-in-time snapshot of <see cref="LocalAnnunciationChannel"/>'s counters. Cumulative
/// since process start. C-7 surfaces these next to <see cref="AlarmNotifierStats"/>,
/// <see cref="WebhookChannelStats"/> and <see cref="SmtpChannelStats"/>.
///
/// <para>🔴 <b>The accounting invariant, the same one C-3 and C-4 hold and by the same construction.</b> For
/// every (notification, configured local-annunciation instance) pair this channel sees, EXACTLY ONE of
/// <paramref name="Suppressed"/>, <paramref name="Announced"/>, <paramref name="Unheard"/> and
/// <paramref name="Lost"/> moves; <paramref name="Cancelled"/> is reached only by re-throwing. One
/// <c>switch</c> over a four-member outcome is the only thing in the class that touches the first four.</para>
///
/// <para>🔴 <b>Why there is no <c>Delivered</c>, and why that is the honest shape rather than a pessimistic
/// one.</b> Webhook and SMTP learn the fate of a message from a remote answer — a 2xx, a 250. This channel
/// has no remote and therefore no answer. What it CAN observe, exactly, is how many browser sessions were
/// attached to this process at the instant of the edge, so the two outcomes it reports are "handed to at
/// least one attached session" and "handed to nobody". Calling the first one <c>Delivered</c> would import a
/// promise from the other two channels that this one cannot keep: an attached session can be a background
/// tab, its sound can be blocked by the browser's autoplay policy, and there may be nobody in the room.
/// <paramref name="Announced"/> says precisely what was observed and nothing beyond it.</para>
/// </summary>
/// <param name="Considered">Notifications handed to this channel by C-1's drain loop, before any
/// filtering.</param>
/// <param name="Suppressed">(notification, instance) pairs deliberately not annunciated — the instance is
/// disabled, or the alarm is less severe than its minimum priority. NOT a loss: this is the operator's
/// configuration working.</param>
/// <param name="Announced">
/// 🔴 (notification, instance) pairs handed to at least one ATTACHED browser session.
///
/// <para><b>What this does and does not claim.</b> A session is counted as attached only once its
/// <c>text/event-stream</c> response has written and flushed its opening frame, so the bytes for this
/// annunciation went to a connection a client had already received data on. It does <b>NOT</b> claim that a
/// human saw or heard anything: the page may be in a background tab, and the browser's autoplay policy may
/// be holding the sound muted until somebody clicks. The browser surface makes that muted state visible at
/// the screen; this counter deliberately does not pretend to know about it.</para></param>
/// <param name="Unheard">
/// 🔴 (notification, instance) pairs that annunciated NOWHERE — nobody had the UI open, or every attached
/// session was too far behind to accept it (see <see cref="AlarmAnnunciationHub.Overflowed"/>, which
/// separates those two). This is this channel's honest loss, and it is expected to be large on a machine
/// nobody is watching, which is exactly the reason the batch also has three channels that do not need a
/// screen. The alarm itself is unaffected — it is still recorded and still visible at <c>/alarms</c> — but
/// nobody was told about it as it happened, and there is no queue behind this channel that will tell them
/// later.</param>
/// <param name="Lost">
/// (notification, instance) pairs the channel FAILED to annunciate through an internal fault. Distinct from
/// <paramref name="Unheard"/> on purpose — <c>Unheard</c> means this channel worked and nobody was there,
/// <c>Lost</c> means this channel did not work.
///
/// <para>🔴 <b>The list is shorter than C-3's and C-4's, and the missing entry is missing for a structural
/// reason rather than an overlooked one.</b> Both of those count "a configuration that was listed and then
/// could not be read back" as a loss, because both must go back to the store for a SIDE TABLE the
/// credential-free summary does not carry (a webhook's URL, an SMTP host and recipient list) — and C-3's
/// test for it works by deleting the side row while leaving the channel row, a state its
/// <c>LEFT JOIN</c> still lists and its <c>INNER JOIN</c> cannot resolve. Local annunciation has no side
/// table at all: <see cref="NotificationChannelSummary.Enabled"/> and
/// <see cref="NotificationChannelSummary.MinPriority"/> are the entire configuration, so this channel reads
/// the store ONCE and the read-back-disagreement state does not exist for it. See
/// <see cref="LocalAnnunciationChannel.DispatchAsync"/>.</para></param>
/// <param name="Cancelled">Annunciations abandoned because the process is shutting down. 🔴 Its unit is the
/// NOTIFICATION rather than the (notification, instance) pair — see
/// <see cref="LocalAnnunciationChannel.DispatchAsync"/> for why this channel has exactly one place a
/// shutdown can be observed, where C-3 and C-4 have one per in-flight delivery.</param>
/// <param name="ListenersAtLastAnnunciation">How many sessions accepted the most recent
/// <paramref name="Announced"/> pair. A diagnostic gauge, not part of the invariant — it is what tells an
/// operator "two people had it open" rather than only "somebody did".</param>
public sealed record LocalAnnunciationStats(
    long Considered,
    long Suppressed,
    long Announced,
    long Unheard,
    long Lost,
    long Cancelled,
    int ListenersAtLastAnnunciation);

/// <summary>
/// 🔴 Task C-5 (.superpowers/sdd/2026-07-30-dotC-alarm-notification-blueprint/task-5-brief.md) — <b>the only
/// channel in Đợt C that still works when the network is gone.</b> Webhook and SMTP both need something
/// outside this machine; Đợt A made this product run standalone and offline on one machine in a factory, and
/// this is the channel that honours that.
///
/// <para><b>Its reach is small and it is not oversold anywhere.</b> It tells whoever has this product's web
/// UI open — on the machine itself under the desktop shell, or on any browser pointed at it. It has no
/// credential, no network and no queue.</para>
///
/// <para>🔴 <b>The temptation this class exists to resist.</b> With nothing to fail, the easy implementation
/// reports success unconditionally: publish, return, increment a "delivered" counter. That would be a
/// channel that reports success while nothing annunciates — and it would be indistinguishable from a working
/// one on a machine with no browser open, which is the normal state of an unattended machine. Instead every
/// publish goes through <see cref="AlarmAnnunciationHub"/>, which reports how many browser sessions actually
/// accepted it, and a publish that reached nobody is counted as <see cref="LocalAnnunciationStats.Unheard"/>
/// rather than as a success. See <see cref="LocalAnnunciationStats"/> for what <c>Announced</c> does and
/// does not claim.</para>
///
/// <para><b>Where it sits.</b> Behind C-1's <see cref="AlarmNotifier"/>, on the notifier's single-reader
/// drain thread, exactly like C-3 and C-4. Unlike them it has no time budget, no retry policy and no
/// per-instance concurrency, and all three absences are the same fact: its only work per instance is one
/// SQLite read and one non-blocking <c>TryWrite</c> per attached session. There is nothing here that can
/// take seconds, so there is nothing to bound, nothing worth attempting twice, and no head-of-line delay to
/// fan out away from. <b>Adding a budget would be inventing a bound for an operation that cannot exceed
/// it</b>, and a retry would re-annunciate an edge that was already published.</para>
///
/// <para>🔴 <b>Never-throws, with exactly one deliberate exception</b> — the same contract C-3 and C-4 hold.
/// Every failure is caught, counted and reported. The ONE thing that propagates is an
/// <see cref="OperationCanceledException"/> from a genuine shutdown, because C-1's drain loop distinguishes
/// that case and counts the job as a drop; swallowing it would make a truncated drain invisible.</para>
///
/// <para>🔴 <b>Every edge kind is published, including <see cref="AlarmEdgeKind.Acked"/> and
/// <see cref="AlarmEdgeKind.Cleared"/>, and that is not symmetry for its own sake.</b> For a webhook those
/// two are informational; for an annunciator they are the ISA-18.2 moments at which it must STOP — "silence
/// the horn" on an ack, release the latch on a clear. A channel that published only
/// <see cref="AlarmEdgeKind.Raised"/> would leave the screen shouting about an alarm an operator had already
/// taken responsibility for, which is how an annunciator trains people to ignore it.
/// <see cref="AlarmEdgeKind.Restored"/> is published too, but review round 1 (I-2) established that
/// <b>nothing can hear it</b>: <see cref="AlarmNotifierSeedService"/> emits those jobs during host start,
/// milliseconds after boot, when no browser can be attached — so every one of them is published to zero
/// listeners and correctly counted <see cref="LocalAnnunciationStats.Unheard"/>. It is still published
/// rather than filtered out, because "nobody was listening" is a fact this channel should report rather
/// than a case it should hide. <b>What actually keeps a restart from leaving a standing Critical alarm
/// unannunciated is the connect-time replay in
/// <see cref="St4i.EngineApi.Hubs.AlarmAnnunciationStreamEndpoint"/></b>, which serves the currently-active
/// set to each client as it attaches — a different mechanism, deliberately, because it is per-connection
/// state rather than a broadcast edge.</para>
///
/// <para><b>It does not write to the alarm store</b>, deliberately, for C-1's reason: a channel calling back
/// into <see cref="IAlarmStore"/> would take the store's write gate from the drain thread and couple drain
/// throughput to alarm-write throughput on the policy-denial request path.</para>
/// </summary>
public sealed class LocalAnnunciationChannel
{
    private readonly NotificationConfigStore _store;
    private readonly AlarmAnnunciationHub _hub;
    /// <summary>🔴 Review round 1 (M-1) — there is NO <c>logWarning</c> companion, unlike C-3 and C-4.
    /// Theirs report per-delivery conditions an operator can act on (a rejected status, an unreadable
    /// credential); this channel has no credential and no remote, so after the single-read simplification
    /// its only non-success outcomes are <c>Unheard</c> — deliberately a counter rather than a log line, see
    /// <see cref="Announce"/> — and an internal fault, which is an error. A warning parameter copied over
    /// from the siblings and never invoked is worse than absent: it is a hook a maintainer reasonably
    /// assumes fires, and it made half of <c>AThrowingLogDelegate_IsNotItselfAFailure</c> inert.</summary>
    private readonly Action<Exception, string>? _logError;

    private long _considered;
    private long _suppressed;
    private long _announced;
    private long _unheard;
    private long _lost;
    private long _cancelled;
    private int _lastListeners;

    /// <summary>What one (notification, instance) pair did. Four members, one <c>switch</c>, every path
    /// through <see cref="AnnounceAsync"/> ending at exactly one of them — the accounting choke point
    /// described on <see cref="LocalAnnunciationStats"/>. <c>Cancelled</c> is deliberately not a member: it
    /// is reached only by re-throwing, so it cannot be confused with an outcome that was decided.</summary>
    private enum AnnunciationOutcome
    {
        Suppressed,
        Announced,
        Unheard,
        Lost,
    }

    /// <param name="store">C-2's configuration store. Read on EVERY notification rather than cached, the
    /// same decision C-3 made and for the same reason: an operator enabling, disabling or re-thresholding
    /// this channel through C-7 takes effect on the next alarm with no restart and no cache to invalidate.
    /// The cost is one SQLite read per notification, and notifications are edges, not ticks.</param>
    /// <param name="hub">Where annunciations go, and the ONLY thing in this process that knows whether
    /// anybody is listening. See <see cref="AlarmAnnunciationHub"/>.</param>
    public LocalAnnunciationChannel(
        NotificationConfigStore store,
        AlarmAnnunciationHub hub,
        Action<Exception, string>? logError = null)
    {
        ArgumentNullException.ThrowIfNull(store);
        ArgumentNullException.ThrowIfNull(hub);

        _store = store;
        _hub = hub;
        _logError = logError;
    }

    /// <summary>Cumulative counters — see <see cref="LocalAnnunciationStats"/>.</summary>
    public LocalAnnunciationStats Stats => new(
        Interlocked.Read(ref _considered),
        Interlocked.Read(ref _suppressed),
        Interlocked.Read(ref _announced),
        Interlocked.Read(ref _unheard),
        Interlocked.Read(ref _lost),
        Interlocked.Read(ref _cancelled),
        Volatile.Read(ref _lastListeners));

    /// <summary>How many browser sessions are attached right now. Exposed so C-7 can answer "is anybody
    /// actually watching?" without reaching past this channel into the hub.</summary>
    public int ListenerCount => _hub.ListenerCount;

    // ─────────────────────────────────────────────────────────────────────
    // Dispatch — the delegate AlarmNotifier's drain loop calls.
    // ─────────────────────────────────────────────────────────────────────

    /// <summary>
    /// C-1's <c>dispatch</c> delegate.
    ///
    /// <para>🔴 <b>ONE store read for the whole dispatch, where C-3 and C-4 each take two, and the
    /// difference is structural rather than a shortcut.</b> Those two read the credential-free summary to
    /// decide WHETHER to bother, then read the full configuration because the thing they actually need — a
    /// webhook's encrypted URL, an SMTP host and recipient list — lives in a side table the summary cannot
    /// carry. Local annunciation has no side table (see <see cref="LocalAnnunciationChannelConfig"/>):
    /// <see cref="NotificationChannelSummary.Enabled"/> and
    /// <see cref="NotificationChannelSummary.MinPriority"/> ARE the entire configuration, and both come back
    /// from <see cref="NotificationConfigStore.ListAsync"/>. A second read would query the very same row,
    /// so it could add exactly one new outcome — "the row vanished in the microseconds between the two
    /// reads" — while costing a SQLite round trip per instance per notification on C-1's drain thread. That
    /// is a branch bought at a real price which nothing can reach and no test can reproduce, and the
    /// honest thing is not to have it. The severity gate still goes through the one shared helper
    /// (<see cref="NotificationDelivery.Delivers"/>) rather than being re-derived here, because
    /// <see cref="AlarmPriority"/> is declared most-severe-FIRST and C-2 put that comparison in one place
    /// precisely so four channels cannot each get the inversion wrong.</para>
    ///
    /// <para>🔴 <b>Instances are walked SEQUENTIALLY, where C-3/C-4 fan out with <c>Task.WhenAll</c>.</b>
    /// They do so because each of their instances is an independent NETWORK destination whose budget would
    /// otherwise ADD to the drain loop's head-of-line delay. Here an instance costs one non-blocking
    /// publish, so there is no budget to add, and wrapping that in tasks would buy nothing while making the
    /// order of the published annunciations non-deterministic for no reason. The head-of-line property the
    /// host's own <c>Task.WhenAll</c> composition protects is untouched — that is BETWEEN channels, and this
    /// channel's whole contribution to it is microseconds.</para>
    /// </summary>
    public async Task DispatchAsync(NotificationJob job, CancellationToken ct = default)
    {
        ArgumentNullException.ThrowIfNull(job);
        Interlocked.Increment(ref _considered);

        try
        {
            // 🔴 BOTH guards around this read are BELT-AND-BRACES, and that is measured rather than
            // assumed: deleting either one leaves all 298 alarm tests green, because since C-4
            // NotificationConfigStore.ListAsync ITSELF throws on a cancelled token — before the read for an
            // already-cancelled one, during it otherwise. So the store is what actually provides this
            // channel's cancellation behaviour today, and the two lines here are what stop that from being a
            // SILENT dependency: without them, a future store that went back to never-throws would turn a
            // shutdown into "nothing is configured", and this notification would vanish with no counter
            // moving at all — the exact silent-loss shape C-1's review found twice.
            //
            // The dependency is pinned loudly rather than left as folklore: LocalAnnunciationChannelTests'
            // ACancelledStoreRead_Throws_… asserts the premise directly, so if the store ever stops
            // throwing, that test goes red and these guards stop being redundant in the same commit.
            // (C-3 keeps the identical pair, for the identical reason.)
            ct.ThrowIfCancellationRequested();

            var configured = await _store.ListAsync(ct).ConfigureAwait(false);

            // The second one covers the only window the store structurally cannot see: a shutdown landing
            // after the read has returned and before its result is acted on.
            ct.ThrowIfCancellationRequested();

            var instances = new List<LocalAnnunciationChannelConfig>();
            foreach (var summary in configured)
            {
                if (summary.Channel != NotificationChannel.LocalAnnunciation) continue;

                var config = new LocalAnnunciationChannelConfig(
                    summary.Enabled, summary.MinPriority, summary.Instance);

                if (!config.Delivers(job.Alarm.Priority))
                {
                    Interlocked.Increment(ref _suppressed);
                    continue;
                }

                instances.Add(config);
            }

            foreach (var config in instances)
            {
                AnnounceAndCount(config.Instance, job);
            }
        }
        catch (OperationCanceledException) when (ct.IsCancellationRequested)
        {
            // 🔴 EXACTLY ONE increment per notification, and — unlike C-3 and C-4 — no "did the fan-out
            // start?" bookkeeping to decide whether counting here would double-report. Theirs is needed
            // because their per-instance deliveries are concurrent and run for seconds, so a shutdown can
            // land inside any of them and each has to count itself. Here the per-instance work is
            // synchronous and takes microseconds, so the only two places a shutdown can be observed at all
            // are the two guards above, both of which land here. Adding a third guard inside the loop would
            // be a branch nothing can reach and no test could reproduce.
            //
            // The consequence, stated rather than left to be inferred: this counter's unit is the
            // NOTIFICATION, not the (notification, instance) pair. The exactly-one-counter invariant on
            // LocalAnnunciationStats is over the other four.
            Interlocked.Increment(ref _cancelled);
            throw;
        }
        catch (Exception ex)
        {
            // Defensive: nothing above should be able to throw anything else. Counted rather than merely
            // logged, for the reason AlarmNotifier's own catch-all is — a log saying an alarm was lost, next
            // to a counter reading zero, says the opposite of the log.
            Interlocked.Increment(ref _lost);
            ReportError(ex, "Local alarm annunciation: resolving the configured instances faulted — this " +
                            $"notification ({Describe(job)}) was NOT annunciated anywhere.");
        }
    }

    /// <summary>🔴 The accounting choke point: exactly one counter moves per (notification, instance) pair,
    /// and every path through <see cref="Announce"/> ends at this switch.
    ///
    /// <para>Synchronous, unlike C-3's and C-4's, because there is genuinely nothing to await once the
    /// configuration is in hand — a <c>Task</c>-returning method that can throw before its first
    /// <c>await</c> throws SYNCHRONOUSLY out of the call rather than through the returned task, which is a
    /// footgun worth not installing for the sake of a matching signature.</para></summary>
    private void AnnounceAndCount(string instance, NotificationJob job)
    {
        AnnunciationOutcome outcome;
        try
        {
            outcome = Announce(instance, job);
        }
        catch (Exception ex)
        {
            // Defence in depth: nothing in Announce should be able to throw. Counted rather than merely
            // logged, for the reason AlarmNotifier's own catch-all is — a log saying an alarm was lost, next
            // to a counter reading zero, says the opposite of the log.
            outcome = AnnunciationOutcome.Lost;
            ReportError(ex, $"Local alarm annunciation '{instance}': the channel itself faulted — this " +
                            $"notification ({Describe(job)}) was NOT annunciated.");
        }

        switch (outcome)
        {
            case AnnunciationOutcome.Suppressed: Interlocked.Increment(ref _suppressed); break;
            case AnnunciationOutcome.Announced: Interlocked.Increment(ref _announced); break;
            case AnnunciationOutcome.Unheard: Interlocked.Increment(ref _unheard); break;
            default: Interlocked.Increment(ref _lost); break;
        }
    }

    /// <summary>Publishes one (notification, instance) pair and reports what became of it.</summary>
    private AnnunciationOutcome Announce(string instance, NotificationJob job)
    {
        var listeners = _hub.Publish(AlarmAnnunciation.From(job, instance));
        if (listeners <= 0)
        {
            // 🔴 The honest outcome, and the whole reason this channel bothers to ask the hub rather than
            // returning as soon as it has published. Nothing was annunciated.
            //
            // Deliberately NOT logged as a warning: on an unattended machine this is the normal state of
            // the world for every single alarm, and a log line per edge would be exactly the noise that
            // teaches an operator to stop reading the log. It is visible where it belongs — as a counter,
            // which C-7 surfaces.
            return AnnunciationOutcome.Unheard;
        }

        Volatile.Write(ref _lastListeners, listeners);
        return AnnunciationOutcome.Announced;
    }

    // ─────────────────────────────────────────────────────────────────────
    // Reporting — never itself a failure.
    // ─────────────────────────────────────────────────────────────────────

    /// <summary>
    /// 🔴 How a job is named in a failure message, and it is null-safe for a reason found by a test rather
    /// than by reading.
    ///
    /// <para>Both catch-alls in this class originally interpolated <c>job.Alarm.Key</c> directly. The ONLY
    /// way to reach those handlers is a job that is structurally broken — and the most likely way for one
    /// to be broken is a null <see cref="NotificationJob.Alarm"/>, which is precisely what the message then
    /// dereferenced. So the never-throws handler threw, out of the never-throws channel, out of C-1's drain
    /// loop, on the one input it existed to absorb. A failure path that only runs on malformed input must
    /// not itself assume the input is well formed.</para>
    /// </summary>
    private static string Describe(NotificationJob? job) =>
        job is null ? "<null job>"
        : job.Alarm is null ? $"{job.Edge} <null alarm>"
        : $"{job.Edge} '{job.Alarm.Key}'";

    private void ReportError(Exception ex, string message)
    {
        try { _logError?.Invoke(ex, message); } catch { /* nothing left to report it to */ }
    }
}
