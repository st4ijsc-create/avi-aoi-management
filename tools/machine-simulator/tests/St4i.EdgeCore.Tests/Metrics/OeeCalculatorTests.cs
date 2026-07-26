using St4i.EdgeCore.Historian;
using St4i.EdgeCore.Metrics;
using Xunit;

namespace St4i.EdgeCore.Tests.Metrics;

/// <summary>
/// WS-A-T4 — proves <see cref="OeeCalculator.Calculate"/> turns an <see cref="OeeInputAggregate"/> +
/// planned time + ideal cycle into an honest A×P×Q result with three loss buckets, and that every division
/// is guarded: no NaN/Infinity, no ratio above 1, no negative loss time, ever.
/// </summary>
public class OeeCalculatorTests
{
    private static readonly DateTimeOffset From = new(2026, 7, 26, 8, 0, 0, TimeSpan.Zero);
    private static readonly DateTimeOffset To = new(2026, 7, 26, 8, 5, 0, TimeSpan.Zero);

    [Fact]
    public void Perfect_run_yields_A_P_Q_and_Oee_of_one_with_zero_losses()
    {
        var input = new OeeInputAggregate("M-01", From, To, TotalCount: 100, GoodCount: 100, RunTime: TimeSpan.FromSeconds(100));

        var result = OeeCalculator.Calculate(input, TimeSpan.FromSeconds(100), idealCycleSeconds: 1.0);

        Assert.Equal(1.0, result.Availability);
        Assert.Equal(1.0, result.Performance);
        Assert.Equal(1.0, result.Quality);
        Assert.Equal(1.0, result.Oee);
        Assert.Equal(TimeSpan.Zero, result.DowntimeLossTime);
        Assert.Equal(TimeSpan.Zero, result.SpeedLossTime);
        Assert.Equal(TimeSpan.Zero, result.QualityLossTime);
    }

    [Fact]
    public void Zero_planned_time_yields_zero_availability_without_divide_by_zero()
    {
        var input = new OeeInputAggregate("M-01", From, To, TotalCount: 10, GoodCount: 10, RunTime: TimeSpan.FromSeconds(10));

        var result = OeeCalculator.Calculate(input, TimeSpan.Zero, idealCycleSeconds: 1.0);

        Assert.Equal(0.0, result.Availability);
        Assert.False(double.IsNaN(result.Availability));
        Assert.False(double.IsInfinity(result.Availability));
    }

    [Fact]
    public void Zero_total_count_yields_zero_performance_and_zero_quality_without_nan()
    {
        var input = new OeeInputAggregate("M-01", From, To, TotalCount: 0, GoodCount: 0, RunTime: TimeSpan.FromSeconds(100));

        var result = OeeCalculator.Calculate(input, TimeSpan.FromSeconds(100), idealCycleSeconds: 1.0);

        Assert.Equal(0.0, result.Performance);
        Assert.Equal(0.0, result.Quality);
        Assert.False(double.IsNaN(result.Performance));
        Assert.False(double.IsNaN(result.Quality));
    }

    [Fact]
    public void NgHeavy_run_computes_quality_and_quality_loss_time()
    {
        var input = new OeeInputAggregate("M-01", From, To, TotalCount: 100, GoodCount: 60, RunTime: TimeSpan.FromSeconds(100));

        var result = OeeCalculator.Calculate(input, TimeSpan.FromSeconds(100), idealCycleSeconds: 1.0);

        Assert.Equal(0.6, result.Quality);
        Assert.Equal(TimeSpan.FromSeconds(40), result.QualityLossTime);
    }

    [Fact]
    public void Performance_never_exceeds_one_even_when_ideal_run_time_exceeds_actual_run_time()
    {
        // idealRunSeconds = 5.0 * 100 = 500s > RunTime (100s) -> would be a ratio of 5 unclamped.
        var input = new OeeInputAggregate("M-01", From, To, TotalCount: 100, GoodCount: 100, RunTime: TimeSpan.FromSeconds(100));

        var result = OeeCalculator.Calculate(input, TimeSpan.FromSeconds(100), idealCycleSeconds: 5.0);

        Assert.Equal(1.0, result.Performance);
    }

    [Fact]
    public void Oee_equals_availability_times_performance_times_quality()
    {
        var input = new OeeInputAggregate("M-01", From, To, TotalCount: 90, GoodCount: 81, RunTime: TimeSpan.FromSeconds(180));

        var result = OeeCalculator.Calculate(input, TimeSpan.FromSeconds(200), idealCycleSeconds: 1.8);

        Assert.Equal(result.Availability * result.Performance * result.Quality, result.Oee, precision: 12);
    }

    [Fact]
    public void Loss_buckets_are_never_negative()
    {
        var input = new OeeInputAggregate("M-01", From, To, TotalCount: 50, GoodCount: 50, RunTime: TimeSpan.FromSeconds(50));

        // RunTime (50s) < planned (200s) -> downtime loss; ideal run (5s) << run time -> no speed loss;
        // all good -> no quality loss. Still assert none of the three ever go negative.
        var result = OeeCalculator.Calculate(input, TimeSpan.FromSeconds(200), idealCycleSeconds: 0.1);

        Assert.True(result.DowntimeLossTime >= TimeSpan.Zero);
        Assert.True(result.SpeedLossTime >= TimeSpan.Zero);
        Assert.True(result.QualityLossTime >= TimeSpan.Zero);
    }
}
