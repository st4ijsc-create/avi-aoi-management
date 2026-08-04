namespace St4i.EdgeCore.Tests.Drivers.Modbus;

/// <summary>
/// Task D-2 — <b>runs indefinitely-blocking work on a DEDICATED thread instead of a thread-pool one.</b>
///
/// <para><b>This exists because of a measured, diagnosed failure, not as a precaution.</b> The first full run
/// of this task's tests failed five assertions, two of them in <i>pre-existing</i> Modbus TCP tests that were
/// green on 4/4 consecutive baseline runs immediately before and green 3/3 when this task's new tests were
/// run in isolation. The distinguishing variable was total parallel load, and the mechanism is thread-pool
/// starvation, not a tight assertion threshold:</para>
///
/// <list type="bullet">
/// <item><description>An NModbus RTU slave network's <c>ListenAsync</c> blocks its caller for the entire
/// lifetime of the test (probed — it does not yield before entering its synchronous read loop). One per RTU
/// test class, several classes in parallel.</description></item>
/// <item><description>Every NModbus read is sync-over-threadpool underneath, so each in-flight read holds a
/// pool thread for its whole duration — including the deliberately long ones these tests use to prove
/// cancellation does not wait out a timeout.</description></item>
/// <item><description>The .NET thread pool injects new threads at roughly one per second once its minimum is
/// exhausted. A <c>Task.Run</c> that cannot get a thread has not started, so a test measuring "how long did
/// it take to unblock" measures the queue, not the mechanism — one such measurement read <b>9113 ms</b>
/// against a 30000 ms bound it was meant to disprove.</description></item>
/// </list>
///
/// <para>Loosening the thresholds would have made those failures rarer without making them less real, and the
/// batch rule is explicit that a rate is a symptom rather than a diagnosis. Taking the blocking work off the
/// pool removes the contention instead of tolerating it, and it is also the honest model: a real RTU slave is
/// a device, not a queued work item.</para>
/// </summary>
internal static class BlockingWork
{
    /// <summary>Runs <paramref name="work"/> on a fresh background thread and completes the returned task with
    /// its result (or its exception). The thread is background, so it can never hold the test host open.</summary>
    public static Task<T> Run<T>(Func<T> work, string name)
    {
        var tcs = new TaskCompletionSource<T>(TaskCreationOptions.RunContinuationsAsynchronously);
        var thread = new Thread(() =>
        {
            try { tcs.TrySetResult(work()); }
            catch (OperationCanceledException ex) { tcs.TrySetCanceled(ex.CancellationToken); }
            catch (Exception ex) { tcs.TrySetException(ex); }
        })
        {
            IsBackground = true,
            Name = name,
        };
        thread.Start();
        return tcs.Task;
    }

    /// <summary>Void-returning overload — see <see cref="Run{T}"/>.</summary>
    public static Task Run(Action work, string name) =>
        Run<object?>(() => { work(); return null; }, name);

    /// <summary>Runs an async delegate whose SYNCHRONOUS prefix blocks — the shape
    /// <c>IModbusSlaveNetwork.ListenAsync</c> has (it blocks its caller, then returns a task). Both halves stay
    /// off the pool.</summary>
    public static Task RunAsync(Func<Task> work, string name)
    {
        var tcs = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
        var thread = new Thread(() =>
        {
            try
            {
                work().ContinueWith(t =>
                {
                    if (t.IsFaulted) tcs.TrySetException(t.Exception!.InnerExceptions);
                    else if (t.IsCanceled) tcs.TrySetCanceled();
                    else tcs.TrySetResult();
                }, TaskScheduler.Default);
            }
            catch (OperationCanceledException) { tcs.TrySetCanceled(); }
            catch (Exception ex) { tcs.TrySetException(ex); }
        })
        {
            IsBackground = true,
            Name = name,
        };
        thread.Start();
        return tcs.Task;
    }
}
