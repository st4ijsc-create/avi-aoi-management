namespace St4i.EdgeCore.Licensing;

/// <summary>
/// WS-E — the feature strings every gate reads, and the editions that are merely LABELS over them.
///
/// <para>🔴 <b>Editions are a set of feature strings, never a build flavour</b> (roadmap:342, "edition =
/// tập cờ, không build riêng"). The edition name is what appears on an invoice; <see cref="LicensePayload.Features"/>
/// is what the code consults. That is what makes an upgrade a re-issued licence with more strings rather
/// than a migration, which is the whole of "license-credit nâng cấp" (roadmap:136).</para>
///
/// <para>🔴 <b>THE ACCEPTANCE CRITERION IS LINE, NOT HMI.</b> roadmap:377 reads "mở khoá Line bằng
/// license mới" — unlocking Line with a new licence. An edition set that gated only the two HMI
/// capability flags would satisfy the ledger's headline and fail the roadmap's own stated test, so
/// <see cref="LineControl"/> and <see cref="AlarmsNotify"/> are gated here and enforced at their routes.</para>
/// </summary>
public static class LicenseFeatures
{
    // ── Core: permanently free, in every edition, including no licence at all ───────────────────────

    /// <summary>🔴 <b>READ access to the HMI API, and it is CORE — permanently free, deliberately.</b>
    ///
    /// <para>This is the one place fail-closed and fail-open genuinely collide, and the resolution is the
    /// boundary the whole design rests on. The kiosk RENDERS screens the builder AUTHORED: measured at
    /// <c>web/src/routes/Hmi.tsx</c>, the operator panel reads <c>GET /v1/screens/{id}</c> (line 144),
    /// <c>GET /v1/components/{code}</c> (line 169, feeding <c>ScreenRenderer</c>'s <c>components</c> prop
    /// at line 490) and <c>WS /v1/hmi/changes</c> (line 158). Gating any of those on entitlement means an
    /// expired licence BLANKS AN OPERATOR'S SCREEN ON A RUNNING MACHINE — a licence problem stopping a
    /// machine, in the most literal sense the boundary forbids.</para>
    ///
    /// <para>So the read is free forever and the AUTHORING right is what is sold. The honest sentence to
    /// a customer: <i>you are buying the ability to create and change screens, not the ability to display
    /// them.</i> <c>LicenseReadPathTests.Expired_license_still_renders_the_operator_screen</c> pins it.</para></summary>
    public const string HmiApi = "hmi.api";

    /// <summary>🔴 READ access to the component model, and CORE for the same measured reason as
    /// <see cref="HmiApi"/>: the kiosk's <c>useMachineComponents(code)</c> call is what resolves every
    /// <c>{component}</c> binding on a rendered screen. The blueprint left this as an explicit go/no-go —
    /// "confirm before shipping that the runtime renderer does not need <c>GET /v1/components/{code}</c>
    /// to paint a screen; if it does, <c>HmiModelEnabled</c> joins <c>hmi.api</c> in Core". It does, so it
    /// has. <b>Machine edition is therefore sold on <see cref="HmiAuthoring"/> alone.</b></summary>
    public const string HmiModel = "hmi.model";

    // ── Machine edition: the authoring right, which is the thing actually sold ──────────────────────

    /// <summary>🔴 <b>THE PAID AUTHORING RIGHT.</b> Every route that CREATES or CHANGES a screen, a
    /// component model or a tag namespace: the <c>PUT</c>s, rollback, generate and import. Gated as an
    /// endpoint filter at each route's own registration — never as a policy rule.</summary>
    public const string HmiAuthoring = "hmi.authoring";

    /// <summary>Screen-pack import. Separate from <see cref="HmiAuthoring"/> only so a future edition can
    /// sell bulk import without the visual editor; both are Machine today.</summary>
    public const string ScreensImport = "screens.import";

    // ── Line edition: the roadmap's own acceptance criterion ────────────────────────────────────────

    /// <summary>🔴 Line command execution (<c>POST /v1/line/{command}</c>). This is the feature
    /// roadmap:377's acceptance test unlocks. <c>GET /v1/line</c> is NOT gated — reading line state is an
    /// operator-visibility concern, and a licence must not blank an operator's view of the line any more
    /// than it may blank their screen.</summary>
    public const string LineControl = "line.control";

    /// <summary>Alarm NOTIFICATION DISPATCH configuration — the webhook/SMTP channels. 🔴 Alarm
    /// ANNUNCIATION is Core and ungated: an operator must always see that an alarm fired. What is sold is
    /// the machine telling somebody ELSE about it.</summary>
    public const string AlarmsNotify = "alarms.notify";

    // ── Site-Connected edition ──────────────────────────────────────────────────────────────────────

    /// <summary>Northbound federation to a SYNAPSE Site.</summary>
    public const string SiteBridge = "site.bridge";

    /// <summary>The third-party connector SDK surface.</summary>
    public const string ConnectorSdk = "connector.sdk";

    /// <summary>
    /// 🔴 The feature set an appliance has with NO licence at all — and the reason an unlicensed machine
    /// is a <i>working machine</i> rather than a brick. Everything an operator touches on a running
    /// machine is here or is not licence-aware at all (HALT, E-stop, mode, data collection, historian,
    /// alarm annunciation never consult a licence in the first place).
    /// </summary>
    public static readonly IReadOnlySet<string> Core =
        new HashSet<string>(StringComparer.Ordinal) { HmiApi, HmiModel };

    /// <summary>Machine edition — Core plus the authoring right the product is named for.</summary>
    public static readonly IReadOnlySet<string> Machine =
        new HashSet<string>(Core, StringComparer.Ordinal) { HmiAuthoring, ScreensImport };

    /// <summary>Line edition — Machine plus line command and notification dispatch (roadmap:377).</summary>
    public static readonly IReadOnlySet<string> Line =
        new HashSet<string>(Machine, StringComparer.Ordinal) { LineControl, AlarmsNotify };

    /// <summary>Site-Connected — Line plus federation and the connector SDK.</summary>
    public static readonly IReadOnlySet<string> SiteConnected =
        new HashSet<string>(Line, StringComparer.Ordinal) { SiteBridge, ConnectorSdk };

    /// <summary>
    /// Resolves an edition LABEL to its feature set, for issuing and for diagnostics. Returns
    /// <see cref="Core"/> for an unrecognised label — 🔴 never throws and never grants: an unknown edition
    /// name in a signed payload must degrade to the free set, not to an exception on a startup path and
    /// not to everything.
    /// </summary>
    /// <param name="edition">The edition label, case-insensitive.</param>
    /// <returns>The feature set that edition grants.</returns>
    public static IReadOnlySet<string> ForEdition(string? edition) => edition?.Trim().ToLowerInvariant() switch
    {
        "machine" => Machine,
        "line" => Line,
        "site-connected" or "siteconnected" or "site" => SiteConnected,
        _ => Core,
    };
}
