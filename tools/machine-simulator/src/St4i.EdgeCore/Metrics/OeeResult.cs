namespace St4i.EdgeCore.Metrics;

/// <summary>
/// WS-A-T4 — the result of <see cref="OeeCalculator.Calculate"/>: A×P×Q plus the three honest loss buckets
/// (Downtime/Speed/Quality) that explain the gap between <see cref="PlannedProductionTime"/> and a perfect
/// <see cref="Oee"/> of 1. Every ratio is clamped to <c>[0, 1]</c> and every loss <see cref="TimeSpan"/> is
/// clamped to non-negative — see <see cref="OeeCalculator"/> for why.
/// </summary>
public sealed record OeeResult(
    string MachineCode, DateTimeOffset From, DateTimeOffset To,
    double Availability, double Performance, double Quality, double Oee,
    TimeSpan PlannedProductionTime, TimeSpan RunTime,
    TimeSpan DowntimeLossTime, TimeSpan SpeedLossTime, TimeSpan QualityLossTime,
    long TotalCount, long GoodCount, double IdealCycleSeconds);
