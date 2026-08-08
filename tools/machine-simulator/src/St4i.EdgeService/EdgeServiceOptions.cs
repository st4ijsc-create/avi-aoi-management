namespace St4i.EdgeService;

/// <summary>Parsed command-line options for the headless edge service (Task 21). See
/// <c>Program.cs</c>'s arg parsing and <see cref="EdgeWorker"/>'s use of each.</summary>
/// <param name="SmokeCount">From <c>--smoke &lt;N&gt;</c> — if set, <see cref="EdgeWorker"/> stops the
/// host itself once N <see cref="St4i.EdgeCore.Engine.EdgePipeline.Committed"/> events have fired,
/// instead of running until externally cancelled.</param>
/// <param name="FleetPath">From <c>--fleet &lt;path&gt;</c> — if set and the file exists,
/// <see cref="EdgeWorker"/> loads the fleet via <see cref="St4i.EdgeCore.Infrastructure.FleetConfig.Load"/>
/// instead of its in-code default roster.</param>
/// <param name="ConnectorsPath">🔴 Task E-3 — from <c>--connectors &lt;path&gt;</c>. <see langword="null"/>
/// (the default, and every pre-existing call site) means <c>connectors.json</c> beside the exe — see
/// <see cref="EdgeConnectors.ResolvePath"/>. Deliberately its OWN flag rather than a second meaning for
/// <c>--fleet</c>: blueprint §9.4(1) is a record of what one flag with two readers costs, and this is the
/// same shape one layer down.</param>
public sealed record EdgeServiceOptions(int? SmokeCount, string? FleetPath, string? ConnectorsPath = null);
