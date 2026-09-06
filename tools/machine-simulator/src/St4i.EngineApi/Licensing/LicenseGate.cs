using System.Runtime.Versioning;
using Microsoft.Data.Sqlite;
using St4i.EdgeCore.Identity;
using St4i.EdgeCore.Licensing;

namespace St4i.EngineApi.Licensing;

/// <summary>
/// WS-E — the process-wide licence state, evaluated ONCE at startup and cached for the process lifetime,
/// and the only thing any gate asks.
///
/// <para><b>Why once.</b> Exactly <c>DemoModeGate</c>'s discipline. A licence whose state can flip
/// mid-process gives an operator a running machine whose feature set changes under their hands, and
/// re-reading a file on a hot path turns a disk hiccup into a per-request failure mode on an appliance.
/// A licence that expires at 14:00 on a machine that started at 06:00 changes NOTHING at 14:00; the next
/// restart evaluates it as <see cref="LicenseState.Grace"/>. An entitlement boundary must never be
/// crossed while an operator is looking at the screen. Activation
/// (<c>POST /v1/license/activate</c>) takes effect on restart, and its response says so in words.</para>
///
/// <para>🔴 <b>THIS TYPE IS NOT AN <c>IPolicyRule</c> AND MUST NEVER BECOME ONE.</b>
/// <c>St4i.EngineApi.Policy.PolicyEngine</c> is default-deny, and <c>FleetEndpoints</c> routes
/// <c>fleet.estop</c> and <c>fleet.estop_reset</c> through it. A <c>LicenseRule</c> in that rule array —
/// the most obvious way to add a gate in this codebase, which is exactly what makes it dangerous — would
/// be evaluated on the E-stop path, and any bug in it that returned a deny (a null licence during a
/// startup race, an exception surfacing as a deny, a copy-pasted action list) would make <b>HALT
/// unreachable</b>. Licence gating is an ASP.NET endpoint filter attached route by route
/// (<see cref="LicenseFeatureFilter"/>): a filter can only affect the route it is attached to, and there
/// is no route it can reach by accident because the implementer must name each one.
/// <c>PolicyRuleArrayPinTests</c> pins the rule array to its exact three types so a future author cannot
/// make this mistake quietly.</para>
/// </summary>
[SupportedOSPlatform("windows")]
public sealed class LicenseGate
{
    private readonly LicenseEvaluation _evaluation;

    /// <summary>The evaluated state — what an engineer surface reports.</summary>
    public LicenseState State => _evaluation.State;

    /// <summary>The full evaluation, for <c>GET /v1/license</c>.</summary>
    public LicenseEvaluation Evaluation => _evaluation;

    /// <summary>The edition label from the licence, or <c>"Core"</c> when there is no entitled licence.</summary>
    public string Edition => _evaluation.Payload?.Edition ?? "Core";

    /// <summary>When the licence expires, or <see langword="null"/> for perpetual/none.</summary>
    public DateTimeOffset? ExpiresAtUtc => _evaluation.Payload?.ExpiresAtUtc;

    /// <param name="evaluation">The startup evaluation.</param>
    public LicenseGate(LicenseEvaluation evaluation)
    {
        ArgumentNullException.ThrowIfNull(evaluation);
        _evaluation = evaluation;
    }

    /// <summary>
    /// 🔴 The one question every gate asks. <see langword="true"/> when this machine is entitled to
    /// <paramref name="feature"/>.
    ///
    /// <para>Reads a SET that is never <see langword="null"/> and always contains
    /// <see cref="LicenseFeatures.Core"/>, so this cannot fail open by dereferencing nothing and cannot
    /// fail closed on a Core feature no matter what state the licence is in — which is why an expired
    /// licence still renders an operator's screen.</para>
    /// </summary>
    /// <param name="feature">A <see cref="LicenseFeatures"/> constant.</param>
    /// <returns><see langword="true"/> when entitled.</returns>
    public bool Has(string feature) => _evaluation.Features.Contains(feature);

    /// <summary>
    /// Evaluates the licence for this process. Never throws — every failure path inside resolves to a
    /// state, because a licence problem must not stop a machine from starting.
    /// </summary>
    /// <param name="licenseStore">The licence store.</param>
    /// <param name="verifier">The signature verifier.</param>
    /// <param name="identityStore">The device identity store, or <see langword="null"/>.</param>
    /// <param name="securityDbPath">Path to <c>security.db</c>, for the monotonic audit floor, or
    /// <see langword="null"/> to skip the floor (the wall clock is then trusted).</param>
    /// <returns>The gate.</returns>
    public static LicenseGate Create(
        LicenseStore licenseStore,
        LicenseVerifier verifier,
        DeviceIdentityStore? identityStore,
        string? securityDbPath)
    {
        ArgumentNullException.ThrowIfNull(licenseStore);
        ArgumentNullException.ThrowIfNull(verifier);

        // 🔴 Read(out …) rather than TryRead(): an UNREADABLE licence file must not be reported as an
        // ABSENT one. Both leave the machine on Core features — the boundary is unaffected either way —
        // but they send a support engineer to different places, so the distinction is carried through to
        // the state rather than collapsed here.
        var outcome = licenseStore.Read(out var envelopeJson);
        if (outcome == LicenseFileRead.Unreadable)
        {
            envelopeJson = UnreadableSentinel;
        }

        return new LicenseGate(LicenseEvaluator.Evaluate(
            envelopeJson, verifier, identityStore,
            DateTimeOffset.UtcNow, ReadAuditFloor(securityDbPath)));
    }

    /// <summary>🔴 What is handed to the evaluator when the licence FILE could not be read at all. It is
    /// not a licence and cannot verify, so it lands in <see cref="LicenseState.Corrupt"/> — which is the
    /// correct report: something is there and this machine cannot read it. Distinct from
    /// <see langword="null"/>, which means genuinely no file and yields
    /// <see cref="LicenseState.Missing"/>.</summary>
    private const string UnreadableSentinel =
        "{\"payload\":\"\",\"signature\":\"\",\"_st4iNote\":\"the licence file exists but could not be read\"}";

    /// <summary>
    /// The newest <c>audit_log.at_utc</c> — the monotonic floor a clock check is measured against,
    /// because that table is append-only and hash-chained and so is a time this machine has already
    /// committed to.
    ///
    /// <para>🔴 Returns <see langword="null"/> on ANY failure, and on a fresh install with no rows. That
    /// null means "trust the wall clock", which is the accepted hole recorded in
    /// <see cref="LicenseClock"/>: set the clock back, wipe the audit database, run forever. Deterring
    /// casual rollback is what this floor does; defeating a determined local administrator is not
    /// something it attempts.</para>
    /// </summary>
    /// <param name="securityDbPath">Path to <c>security.db</c>, or <see langword="null"/>.</param>
    /// <returns>The floor, or <see langword="null"/>.</returns>
    internal static DateTimeOffset? ReadAuditFloor(string? securityDbPath)
    {
        if (string.IsNullOrWhiteSpace(securityDbPath) || !File.Exists(securityDbPath)) return null;

        try
        {
            using var connection = new SqliteConnection(
                new SqliteConnectionStringBuilder { DataSource = securityDbPath, Mode = SqliteOpenMode.ReadOnly }
                    .ToString());
            connection.Open();

            using var cmd = connection.CreateCommand();
            cmd.CommandText = "SELECT MAX(at_utc) FROM audit_log;";
            var raw = cmd.ExecuteScalar() as string;

            return string.IsNullOrWhiteSpace(raw)
                ? null
                : DateTimeOffset.TryParse(raw, System.Globalization.CultureInfo.InvariantCulture,
                    System.Globalization.DateTimeStyles.AdjustToUniversal | System.Globalization.DateTimeStyles.AssumeUniversal,
                    out var parsed)
                    ? parsed
                    : null;
        }
        catch (Exception ex) when (ex is SqliteException or IOException or UnauthorizedAccessException or InvalidOperationException)
        {
            // No audit table yet, a locked file, a schema that predates the log — all mean "no floor",
            // never a startup failure.
            return null;
        }
    }
}
