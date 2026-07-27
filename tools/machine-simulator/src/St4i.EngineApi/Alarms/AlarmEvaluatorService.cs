using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;
using St4i.EngineApi.Fleet;

namespace St4i.EngineApi.Alarms;

/// <summary>
/// GĐ3 sub-4 LC-2 — the FIRST <see cref="IHostedService"/> in St4i.EngineApi: a thin
/// <see cref="PeriodicTimer"/> loop that, every <see cref="AlarmThresholds.EvalIntervalMs"/>, reads a
/// fresh <see cref="FleetHost.GetDriverHealth"/> snapshot + <see cref="FleetHost.GetKpiCounters"/> pair
/// and hands them to <see cref="AlarmEvaluator.EvaluateAsync"/>. Carries NO evaluation logic of its own —
/// see <see cref="AlarmEvaluator"/>'s own doc comment for why that class, not this one, is where the
/// actual DriverHealth/NG-rate rules live and get tested.
///
/// Additive + never-crashes-the-host: <see cref="AlarmEvaluator.EvaluateAsync"/> already never throws
/// (each of its two sources is independently try/caught — see that class), but this loop wraps the call
/// in its OWN try/catch anyway, for defense in depth — a future change to either method must never be
/// able to take the whole ASP.NET Core host down via an unhandled exception escaping
/// <see cref="BackgroundService.ExecuteAsync"/> (the generic host stops the ENTIRE process on that, by
/// design). A caught tick failure is logged and the loop simply continues to the next tick.
/// </summary>
public sealed class AlarmEvaluatorService : BackgroundService
{
    private readonly FleetHost _fleet;
    private readonly AlarmEvaluator _evaluator;
    private readonly AlarmThresholds _thresholds;
    private readonly ILogger<AlarmEvaluatorService>? _logger;

    public AlarmEvaluatorService(
        FleetHost fleet, AlarmEvaluator evaluator, AlarmThresholds thresholds, ILogger<AlarmEvaluatorService>? logger = null)
    {
        _fleet = fleet ?? throw new ArgumentNullException(nameof(fleet));
        _evaluator = evaluator ?? throw new ArgumentNullException(nameof(evaluator));
        _thresholds = thresholds ?? throw new ArgumentNullException(nameof(thresholds));
        _logger = logger;
    }

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        using var timer = new PeriodicTimer(TimeSpan.FromMilliseconds(Math.Max(1, _thresholds.EvalIntervalMs)));

        while (await timer.WaitForNextTickAsync(stoppingToken).ConfigureAwait(false))
        {
            try
            {
                await _evaluator.EvaluateAsync(_fleet.GetDriverHealth(), _fleet.GetKpiCounters(), stoppingToken)
                    .ConfigureAwait(false);
            }
            catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested)
            {
                // Expected on shutdown — the timer's own WaitForNextTickAsync above is what actually
                // ends the loop; this just guards against a cancellation surfacing from mid-evaluation.
            }
            catch (Exception ex)
            {
                // Never let a bad tick take the host down — log and keep ticking (see class doc comment).
                _logger?.LogError(ex, "AlarmEvaluatorService: an evaluation tick failed — the loop continues.");
            }
        }
    }
}
