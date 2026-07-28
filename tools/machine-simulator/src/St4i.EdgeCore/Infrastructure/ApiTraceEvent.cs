using St4i.EdgeCore.Models;
using St4i.Connector.Abstractions.Models;

namespace St4i.EdgeCore.Infrastructure;

/// <summary>
/// One row of the WPF app's live "API trace" view: what got sent, where, and what came back.
/// Pure data — carries a real wall-clock timestamp (<see cref="At"/>) because it records an event
/// that already happened, not simulation state.
/// </summary>
public record ApiTraceEvent(
    DateTimeOffset At,
    string MachineCode,
    ReadingKind Kind,
    string Method,
    string Path,
    int Status,
    long LatencyMs,
    TransportMode Mode,
    bool Duplicate,
    string? Error);
