namespace St4i.EdgeService;

/// <summary>Parsed command-line options for the headless edge service (Task 21). See
/// <c>Program.cs</c>'s arg parsing and <see cref="EdgeWorker"/>'s use of each.</summary>
/// <param name="SmokeCount">From <c>--smoke &lt;N&gt;</c> — if set, <see cref="EdgeWorker"/> stops the
/// host itself once N <see cref="St4i.EdgeCore.Engine.EdgePipeline.Committed"/> events have fired,
/// instead of running until externally cancelled.</param>
/// <param name="FleetPath">From <c>--fleet &lt;path&gt;</c> — if set and the file exists,
/// <see cref="EdgeWorker"/> loads the fleet via <see cref="St4i.EdgeCore.Infrastructure.FleetConfig.Load"/>
/// instead of its in-code default roster.</param>
public sealed record EdgeServiceOptions(int? SmokeCount, string? FleetPath);
