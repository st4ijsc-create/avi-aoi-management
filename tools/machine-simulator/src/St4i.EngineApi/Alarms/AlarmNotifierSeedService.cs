using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;

namespace St4i.EngineApi.Alarms;

/// <summary>
/// Task C-1 — the restart hook: reads <c>active_alarms</c> ONCE at host start and hands it to
/// <see cref="IAlarmNotifier.SeedFromActive"/>, so the edge detector adopts alarms raised by a PREVIOUS
/// process instead of either re-announcing them as fresh or pretending they do not exist. See
/// <see cref="AlarmNotifier.SeedFromActive"/> for the decision and its argument.
///
/// <para>An <see cref="IHostedService"/> rather than a constructor call because
/// <see cref="IAlarmStore.ListActiveAsync"/> is async and because it breaks what would otherwise be a
/// dependency cycle: <see cref="AlarmStore"/> holds the notifier, so the notifier must NOT hold the store.
/// It is the seeding SERVICE that knows both. (<see cref="AlarmNotifier"/>'s own drain loop needs no
/// hosted service — it is registered through a DI factory lambda and so is disposed by the container, the
/// same way <see cref="St4i.EdgeCore.Historian.HistorianWriter"/> already is.)</para>
///
/// <para>Registered ONLY in <c>St4i.EngineApi</c>, and only when the notification seam is switched on —
/// the alarm engine runs in no other process (<c>St4i.EdgeService</c> and both WPF apps never host
/// <see cref="IAlarmStore"/>).</para>
///
/// <para>Never throws: a seeding failure must not take the host down (the generic host stops the ENTIRE
/// process on an exception escaping <see cref="IHostedService.StartAsync"/>). A failed seed leaves the
/// detector empty, which degrades to "the first re-raise of each standing alarm looks like a fresh raise"
/// — noisy but safe, and logged as an error so it is not mistaken for normal.</para>
/// </summary>
public sealed class AlarmNotifierSeedService : IHostedService
{
    private readonly IAlarmStore _alarms;
    private readonly IAlarmNotifier _notifier;
    private readonly ILogger<AlarmNotifierSeedService>? _logger;

    public AlarmNotifierSeedService(IAlarmStore alarms, IAlarmNotifier notifier, ILogger<AlarmNotifierSeedService>? logger = null)
    {
        _alarms = alarms ?? throw new ArgumentNullException(nameof(alarms));
        _notifier = notifier ?? throw new ArgumentNullException(nameof(notifier));
        _logger = logger;
    }

    public async Task StartAsync(CancellationToken cancellationToken)
    {
        try
        {
            var active = await _alarms.ListActiveAsync(cancellationToken).ConfigureAwait(false);
            _notifier.SeedFromActive(active);

            // UNCONDITIONAL, including the zero case. "Adopted 0 alarms" and "seeding never ran" are very
            // different facts and must not look identical in a log — until C-7 exposes
            // AlarmNotifierStats.Seeded on an endpoint, this line is the ONLY way an operator can tell
            // them apart, and the brief's requirement is that they can find out what the system did.
            _logger?.LogInformation(
                "Alarm notifier adopted {Count} alarm(s) still active from a previous process — each raised ONE " +
                "'Restored' notification (not a fresh 'Raised'), and none of them will re-notify while the " +
                "condition simply persists.",
                active.Count);
        }
        catch (Exception ex)
        {
            _logger?.LogError(
                ex,
                "Alarm notifier could not read the active alarms left by a previous process — the edge detector starts " +
                "EMPTY, so each standing alarm's next re-raise will be announced as if it were new.");
        }
    }

    public Task StopAsync(CancellationToken cancellationToken) => Task.CompletedTask;
}
