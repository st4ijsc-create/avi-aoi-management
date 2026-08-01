using System.Globalization;

namespace St4i.EngineApi.Alarms;

/// <summary>
/// GĐ3 sub-4 LC-2 — the knobs <see cref="AlarmEvaluator"/>'s windowed NG-rate source (and the
/// <see cref="AlarmEvaluatorService"/> timer that drives it) reads. Mirrors the
/// <see cref="St4i.EdgeCore.Transport.WalOptions.FromEnvironment"/> idiom exactly: env vars override the
/// built-in defaults below, and an unparseable value is IGNORED (keeps the default) rather than crashing
/// startup on a typo.
/// </summary>
public sealed class AlarmThresholds
{
    /// <summary>Overrides <see cref="NgRateThreshold"/> — the fraction (0.20 = 20%) of judged units in a
    /// window that must be NG before the fleet-wide NG-rate alarm raises.</summary>
    public const string EnvVarNgRateThreshold = "ST4I_ALARM_NGRATE_THRESHOLD";

    /// <summary>Overrides <see cref="NgRateMinSample"/> — the minimum judged-unit delta a window must have
    /// accumulated before the NG-rate source evaluates at all (below this, it does nothing — neither
    /// raises nor clears — to avoid flapping on a tiny sample).</summary>
    public const string EnvVarNgRateMinSample = "ST4I_ALARM_NGRATE_MINSAMPLE";

    /// <summary>Overrides <see cref="EvalIntervalMs"/> — the <see cref="AlarmEvaluatorService"/>'s
    /// <see cref="PeriodicTimer"/> period.</summary>
    public const string EnvVarEvalIntervalMs = "ST4I_ALARM_EVAL_INTERVAL_MS";

    /// <summary>GĐ3 closeout WI-4 — overrides <see cref="IdentityExpiryWarnDays"/>: how many days before
    /// the device identity certificate's <c>NotAfter</c> the <see cref="AlarmSource.Identity"/> alarm
    /// starts warning.</summary>
    public const string EnvVarIdentityExpiryWarnDays = "ST4I_IDENTITY_EXPIRY_WARN_DAYS";

    private const double DefaultNgRateThreshold = 0.20;
    private const long DefaultNgRateMinSample = 5;
    private const int DefaultEvalIntervalMs = 5000;
    private const int DefaultIdentityExpiryWarnDays = 30;

    /// <summary>NG-rate fraction (0.0-1.0) above which the fleet-wide <c>NgRate:HIGH:fleet</c> alarm
    /// raises. Defaults to 0.20 (20%).</summary>
    public double NgRateThreshold { get; init; } = DefaultNgRateThreshold;

    /// <summary>Minimum judged-unit delta (since the evaluator's last pass) required before the NG-rate
    /// source evaluates at all. Defaults to 5.</summary>
    public long NgRateMinSample { get; init; } = DefaultNgRateMinSample;

    /// <summary><see cref="AlarmEvaluatorService"/>'s poll period, in milliseconds. Defaults to 5000
    /// (5s).</summary>
    public int EvalIntervalMs { get; init; } = DefaultEvalIntervalMs;

    /// <summary>GĐ3 closeout WI-4 — how many days before the device identity certificate's <c>NotAfter</c>
    /// the <see cref="AlarmSource.Identity"/> <c>EXPIRING</c> alarm raises. Defaults to 30.</summary>
    public int IdentityExpiryWarnDays { get; init; } = DefaultIdentityExpiryWarnDays;

    /// <summary>
    /// Builds <see cref="AlarmThresholds"/> from the <c>ST4I_ALARM_*</c> environment variables, same
    /// "unparseable → keep the default, never throw" posture as
    /// <see cref="St4i.EdgeCore.Transport.WalOptions.FromEnvironment"/>.
    /// </summary>
    public static AlarmThresholds FromEnvironment()
    {
        var ngRateThreshold = DefaultNgRateThreshold;
        var ngRateThresholdRaw = Environment.GetEnvironmentVariable(EnvVarNgRateThreshold);
        if (!string.IsNullOrWhiteSpace(ngRateThresholdRaw) &&
            double.TryParse(ngRateThresholdRaw, NumberStyles.Float, CultureInfo.InvariantCulture, out var parsedThreshold))
        {
            ngRateThreshold = parsedThreshold;
        }

        var ngRateMinSample = DefaultNgRateMinSample;
        var ngRateMinSampleRaw = Environment.GetEnvironmentVariable(EnvVarNgRateMinSample);
        if (!string.IsNullOrWhiteSpace(ngRateMinSampleRaw) &&
            long.TryParse(ngRateMinSampleRaw, NumberStyles.Integer, CultureInfo.InvariantCulture, out var parsedMinSample))
        {
            ngRateMinSample = parsedMinSample;
        }

        var evalIntervalMs = DefaultEvalIntervalMs;
        var evalIntervalMsRaw = Environment.GetEnvironmentVariable(EnvVarEvalIntervalMs);
        if (!string.IsNullOrWhiteSpace(evalIntervalMsRaw) &&
            int.TryParse(evalIntervalMsRaw, NumberStyles.Integer, CultureInfo.InvariantCulture, out var parsedIntervalMs))
        {
            evalIntervalMs = parsedIntervalMs;
        }

        var identityExpiryWarnDays = DefaultIdentityExpiryWarnDays;
        var identityExpiryWarnDaysRaw = Environment.GetEnvironmentVariable(EnvVarIdentityExpiryWarnDays);
        if (!string.IsNullOrWhiteSpace(identityExpiryWarnDaysRaw) &&
            int.TryParse(identityExpiryWarnDaysRaw, NumberStyles.Integer, CultureInfo.InvariantCulture, out var parsedWarnDays))
        {
            identityExpiryWarnDays = parsedWarnDays;
        }

        return new AlarmThresholds
        {
            NgRateThreshold = ngRateThreshold,
            NgRateMinSample = ngRateMinSample,
            EvalIntervalMs = evalIntervalMs,
            IdentityExpiryWarnDays = identityExpiryWarnDays,
        };
    }
}
