namespace St4i.EdgeCore.Drivers.OpcUa;

/// <summary>
/// GĐ3 sub-3 OU-1 — configuration for the OPC-UA client driver: whether it's on at all, and where its
/// <see cref="OpcUaNodeMap"/> JSON lives. Mirrors <see cref="Modbus.ModbusOptions.FromEnvironment"/>'s
/// idiom exactly: env vars are read ONCE at startup, an unset/blank string falls back to its default
/// rather than throwing.
///
/// Like <see cref="Modbus.ModbusOptions"/> (and UNLIKE <see cref="Uns.UnsOptions"/>), <see cref="Enabled"/>
/// defaults to <see langword="false"/> — additive: with <c>ST4I_OPCUA_ENABLED</c> unset, a fresh
/// install/CI run is byte-identical to pre-OU-1 behavior (no extra pipeline slot, no OPC-UA session, no
/// app-instance cert generated on disk).
/// </summary>
public sealed class OpcUaOptions
{
    public const string EnvVarEnabled = "ST4I_OPCUA_ENABLED";

    /// <summary>See <see cref="EndpointUrl"/>'s doc comment / <see cref="OpcUaNodeMap"/>'s class doc
    /// comment "EndpointUrl precedence" note — this env var is read into <see cref="EndpointUrl"/> for
    /// symmetry with <c>ModbusOptions.Host</c>/<c>Port</c>, but the current driver/factory wiring always
    /// uses the node map's own (required) <c>EndpointUrl</c> instead.</summary>
    public const string EnvVarEndpoint = "ST4I_OPCUA_ENDPOINT";

    public const string EnvVarMapPath = "ST4I_OPCUA_MAP";

    /// <summary>Overrides the app-instance-certificate pki root directory (default:
    /// <see cref="OpcUaPkiPaths.DefaultRoot"/>, <c>%ProgramData%\ST4I\sim\opcua-pki</c>). Env-relocatable
    /// per the GĐ3 sub-3 OU-1 brief — useful for tests/CI that need an isolated pki dir.</summary>
    public const string EnvVarPkiDir = "ST4I_OPCUA_PKI_DIR";

    /// <summary>Whether the OPC-UA driver is active at all. Defaults to <see langword="false"/> — see the
    /// class doc comment for why this is the opposite default from <see cref="Uns.UnsOptions.Enabled"/>.</summary>
    public bool Enabled { get; init; }

    /// <summary><see langword="null"/> means "not configured via env var". See the class doc comment —
    /// currently unused by the driver wiring; the node map's own <c>EndpointUrl</c> always wins.</summary>
    public string? EndpointUrl { get; init; }

    /// <summary>Path to the <see cref="OpcUaNodeMap"/> JSON file. <see langword="null"/> means "not
    /// configured" — Program.cs treats a null/unset path the same as a load failure: logs a warning and
    /// disables OPC-UA for this run rather than crashing startup.</summary>
    public string? MapPath { get; init; }

    /// <summary><see langword="null"/> means "use <see cref="OpcUaPkiPaths.DefaultRoot"/>".</summary>
    public string? PkiDir { get; init; }

    /// <summary>Builds an <see cref="OpcUaOptions"/> from the <c>ST4I_OPCUA_*</c> environment variables:
    /// <list type="bullet">
    /// <item><c>ST4I_OPCUA_ENABLED</c> → <see cref="Enabled"/> ("true"/"1" (case-insensitive) → true;
    /// unset/anything else → false — same opposite-of-UNS default polarity as <c>ST4I_MODBUS_ENABLED</c>.)</item>
    /// <item><c>ST4I_OPCUA_ENDPOINT</c> → <see cref="EndpointUrl"/> (unset/blank → <see langword="null"/>).</item>
    /// <item><c>ST4I_OPCUA_MAP</c> → <see cref="MapPath"/> (unset/blank → <see langword="null"/>).</item>
    /// <item><c>ST4I_OPCUA_PKI_DIR</c> → <see cref="PkiDir"/> (unset/blank → <see langword="null"/>,
    /// i.e. <see cref="OpcUaPkiPaths.DefaultRoot"/>).</item>
    /// </list>
    /// </summary>
    public static OpcUaOptions FromEnvironment()
    {
        var enabledRaw = Environment.GetEnvironmentVariable(EnvVarEnabled);
        var enabled = enabledRaw == "1" || string.Equals(enabledRaw, "true", StringComparison.OrdinalIgnoreCase);

        var endpointRaw = Environment.GetEnvironmentVariable(EnvVarEndpoint);
        var endpoint = string.IsNullOrWhiteSpace(endpointRaw) ? null : endpointRaw;

        var mapPathRaw = Environment.GetEnvironmentVariable(EnvVarMapPath);
        var mapPath = string.IsNullOrWhiteSpace(mapPathRaw) ? null : mapPathRaw;

        var pkiDirRaw = Environment.GetEnvironmentVariable(EnvVarPkiDir);
        var pkiDir = string.IsNullOrWhiteSpace(pkiDirRaw) ? null : pkiDirRaw;

        return new OpcUaOptions
        {
            Enabled = enabled,
            EndpointUrl = endpoint,
            MapPath = mapPath,
            PkiDir = pkiDir,
        };
    }
}

/// <summary>GĐ3 sub-3 OU-1 — resolves the app-instance-certificate pki root <see cref="OpcUaDriver"/> uses
/// to auto-generate/store its client certificate (OPC-UA requires one even at
/// <see cref="OpcUaSecurityMode.None"/> — see <see cref="OpcUaDriver"/>'s class doc comment). Mirrors
/// <c>St4i.EngineApi.AssetRegistry.AssetRegistryStore.DefaultRoot</c>/<c>ResolveRoot</c>'s exact idiom: a
/// sibling of <c>...\sim\assets</c>/<c>...\sim\historian</c>/<c>...\sim\security</c>/<c>...\sim\wal</c>,
/// never the same directory.
///
/// <para><b>Path-length note (de-risk gate finding, task-1-report.md):</b> the OPC Foundation stack's
/// Directory certificate store round-trips a just-created cert through native Windows crypto APIs
/// (<c>X509CertificateLoader.LoadCertificateFromFile</c>) that silently fail (a misleading
/// <see cref="System.Security.Cryptography.CryptographicException"/> "cannot find the path specified")
/// once the FULL file path (root + <c>certs\&lt;subject&gt; [&lt;thumbprint&gt;].der</c>) gets long enough
/// to approach Windows' legacy MAX_PATH. <c>%ProgramData%\ST4I\sim\opcua-pki</c> is short enough in
/// practice; this is called out here because it bit the de-risk gate's proof under a deeply-nested sandbox
/// scratch directory before the fix (a short pki root) was applied.</para>
/// </summary>
public static class OpcUaPkiPaths
{
    public static string DefaultRoot() => Path.Combine(
        Environment.GetFolderPath(Environment.SpecialFolder.CommonApplicationData), "ST4I", "sim", "opcua-pki");

    /// <summary>Resolves the effective pki root: <paramref name="directory"/> if given, else
    /// <see cref="OpcUaOptions.EnvVarPkiDir"/> if set, else <see cref="DefaultRoot"/>. Pure path
    /// arithmetic — does not create anything on disk.</summary>
    public static string ResolveRoot(string? directory = null)
    {
        if (!string.IsNullOrWhiteSpace(directory)) return directory;
        var env = Environment.GetEnvironmentVariable(OpcUaOptions.EnvVarPkiDir);
        return string.IsNullOrWhiteSpace(env) ? DefaultRoot() : env;
    }
}
