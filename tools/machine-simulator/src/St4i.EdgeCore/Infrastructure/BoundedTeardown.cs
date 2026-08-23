namespace St4i.EdgeCore.Infrastructure;

/// <summary>
/// 🔴 <b>THE SEAM ITEM 48 AND ITEM 52 WERE BOTH BLOCKED ON, BUILT BY BK-1 ON 2026-08-23 UNDER THE OWNER'S
/// RULING OF THE SAME DAY</b> (<c>docs/owner-decisions.md</c> items 48, 51, 52 — "build the seam, unlock all
/// three"). Three reports in a row stopped at the same wall and described it the same way: a witness for
/// "teardown is bounded" needs a shutdown step that HANGS on command, and a witness for "a failing teardown
/// is not swallowed" needs one that THROWS on command — and neither <see cref="Drivers.Mqtt.MqttDriver"/>'s
/// MQTT client nor <see cref="Drivers.Mqtt.InProcessBroker"/>'s server can be handed a fake from outside.
///
/// <para><b>What this type is, stated as the shape rather than as a promise.</b> It is the one shutdown STEP
/// both of those classes were performing inline, lifted out with its budget and its report made explicit. A
/// test hands it a delegate that never completes, or one that throws, and asserts the outcome directly. The
/// two call sites hand it the real <c>DisconnectAsync</c>/<c>StopAsync</c>, and a caller that supplies a
/// <c>report</c> sink observes the SAME line this type emits — which is what ties "the driver is bounded" to
/// "this type is bounded" without either class exposing a test-only hatch.</para>
///
/// <para>🔴 <b>WHY THIS AND NOT AN INJECTED CLIENT — the alternative was measured, not dismissed.</b> Handing
/// <see cref="Drivers.Mqtt.MqttDriver"/> an <c>IMqttClient</c> would put an MQTTnet type on
/// <c>St4i.EdgeCore</c>'s PUBLIC API (it carries none today) and would still not reach
/// <see cref="Drivers.Mqtt.InProcessBroker"/>, whose <c>MqttServer</c> is a concrete class behind no
/// interface at all. Making either seam <see langword="internal"/> instead needs a SECOND
/// <c>InternalsVisibleTo</c> on this assembly, and this assembly's <c>AssemblyInfo.cs</c> argues at length
/// against exactly that. This type needs neither: it is ordinary production code that both call sites
/// genuinely use, and the test infrastructure it adds is a delegate parameter.</para>
///
/// <para>🔴 <b>WHAT IT DOES NOT MEASURE, stated here because the result it produces is a log line and a log
/// line reads like proof.</b> It bounds how long THIS PROCESS waits for a shutdown step. It does not stop the
/// step: an overrun step keeps running, detached, holding whatever it holds — a port that was not released is
/// still not released, and the next bind on it still fails. It says nothing about whether MQTTnet's own
/// <c>DisconnectAsync</c>/<c>StopAsync</c> honour the token handed to them; the second race exists precisely
/// because that is unknown. And it asserts nothing about the truth of the text it emits.</para>
/// </summary>
public static class BoundedTeardown
{
    /// <summary>How much longer the wall-clock race waits than the token does, so the two deadlines cannot
    /// collide. 🔴 <b>This is not padding; without it the helper reports the wrong cause.</b> Firing both at
    /// the same instant makes "the step cancelled itself politely" and "the step ignored its token and was
    /// abandoned" a coin flip, and those are the two outcomes a reader of the sink is trying to tell apart —
    /// measured as a flapping assertion before this existed, not reasoned about. The consequence is that the
    /// true wall-clock ceiling on a caller is <c>budget + 250 ms</c>, which is why the caller-facing budgets
    /// are chosen with headroom under the host's own.</summary>
    private static readonly TimeSpan CooperativeGrace = TimeSpan.FromMilliseconds(250);

    /// <summary>Runs one best-effort shutdown step under a wall-clock ceiling and reports what happened,
    /// instead of awaiting it forever or discarding its failure.
    ///
    /// <para><b>Two mechanisms, because one of them is cooperative and cooperation is not guaranteed.</b> The
    /// step is handed a token that fires at <paramref name="budget"/>, which is the polite half; the wait is
    /// ALSO raced against a timer set a short grace LATER, which is the half that holds when the step ignores
    /// its token. The stagger is what keeps the two outcomes distinguishable at the sink; the price is that
    /// the wall-clock ceiling a caller actually sees is <paramref name="budget"/> plus that grace, not
    /// <paramref name="budget"/>. A step that overruns is detached and its eventual outcome is observed and
    /// discarded, so an exception it throws afterwards cannot surface as an unobserved task exception on a
    /// finalizer thread.</para>
    ///
    /// <para><b>It does not throw.</b> A step that fails synchronously, faults, or is cancelled produces a
    /// report line and a normal return — a teardown helper that threw would re-create the failure mode it
    /// exists to remove. The only exceptions out of this method come from its own argument checks.</para></summary>
    /// <param name="what">Short name of the step, used as the prefix of every report line (for example
    /// <c>"MqttDriver.DisconnectAsync"</c>). Callers pass a literal; nothing parses it.</param>
    /// <param name="step">The shutdown work. Invoked once, immediately, with a token that fires at
    /// <paramref name="budget"/>. Returning <see langword="null"/> is treated as already-completed.</param>
    /// <param name="budget">Wall-clock ceiling on how long the CALLER waits. Must be positive — a
    /// non-positive ceiling would mean "abandon before starting", which no call site wants and which would
    /// read as a bug at the report sink rather than at the mistake.</param>
    /// <param name="report">Where the outcome goes. <see langword="null"/> restores the old behaviour
    /// exactly — bounded, and silent — which is what keeps this callable from a class that has no sink
    /// wired.</param>
    /// <returns>A task that completes when the step completed, or when <paramref name="budget"/> elapsed and
    /// the step was detached, whichever is first.</returns>
    /// <exception cref="ArgumentNullException"><paramref name="what"/> or <paramref name="step"/> is
    /// <see langword="null"/>.</exception>
    /// <exception cref="ArgumentOutOfRangeException"><paramref name="budget"/> is not positive.</exception>
    public static async Task RunAsync(
        string what,
        Func<CancellationToken, Task> step,
        TimeSpan budget,
        Action<string>? report)
    {
        if (what is null) throw new ArgumentNullException(nameof(what));
        if (step is null) throw new ArgumentNullException(nameof(step));
        if (budget <= TimeSpan.Zero) throw new ArgumentOutOfRangeException(nameof(budget), budget, "budget must be positive.");

        var ms = (long)budget.TotalMilliseconds;
        var cts = new CancellationTokenSource(budget);

        Task work;
        try
        {
            work = step(cts.Token) ?? Task.CompletedTask;
        }
        catch (Exception ex)
        {
            // Thrown before the step ever returned a task — a synchronous argument/state failure, not a
            // shutdown that went wrong. Named separately because the two have different causes.
            cts.Dispose();
            Report(report, $"{what}: threw before starting — {ex.GetType().Name}: {ex.Message}");
            return;
        }

        var finished = await Task.WhenAny(work, Task.Delay(budget + CooperativeGrace, CancellationToken.None)).ConfigureAwait(false);
        if (!ReferenceEquals(finished, work))
        {
            // Overran. Detach: observe the eventual outcome so it cannot resurface as an unobserved task
            // exception, and release the token source only once the step can no longer read it.
            _ = work.ContinueWith(
                static (t, state) =>
                {
                    _ = t.Exception;
                    ((CancellationTokenSource)state!).Dispose();
                },
                cts,
                CancellationToken.None,
                TaskContinuationOptions.ExecuteSynchronously,
                TaskScheduler.Default);

            Report(report, $"{what}: still running after {ms} ms — detached, teardown continued without it");
            return;
        }

        cts.Dispose();

        try
        {
            await work.ConfigureAwait(false);
            Report(report, $"{what}: completed within {ms} ms");
        }
        catch (OperationCanceledException)
        {
            Report(report, $"{what}: gave up at the {ms} ms budget");
        }
        catch (Exception ex)
        {
            Report(report, $"{what}: failed — {ex.GetType().Name}: {ex.Message}");
        }
    }

    /// <summary>Hands one line to the caller's sink. A sink that throws is contained here: this runs during
    /// teardown, where an exception out of a log call would replace a reported failure with an unreported
    /// one.</summary>
    private static void Report(Action<string>? report, string line)
    {
        if (report is null) return;
        try { report(line); }
        catch { /* a broken sink must not break the shutdown it is describing */ }
    }
}
