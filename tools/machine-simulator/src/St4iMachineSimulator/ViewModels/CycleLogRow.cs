namespace St4iMachineSimulator.ViewModels;

/// <summary>
/// One row of a machine's cycle log (Task 16 Machine Detail screen's <c>DataGrid</c>) — a compact
/// summary of a single committed <see cref="St4i.EdgeCore.Models.DeviceReading"/>: when it happened,
/// which unit it was, its verdict, and one representative key-metric string. Immutable —
/// <c>MachineViewModel.CycleLog</c> only ever appends new rows (evicting the oldest once past its
/// cap — see <c>MachineViewModel.MaxCycleLogRows</c>), never mutates an existing one.
/// </summary>
public sealed record CycleLogRow(DateTimeOffset Time, string Serial, string Verdict, string KeyMetric);
