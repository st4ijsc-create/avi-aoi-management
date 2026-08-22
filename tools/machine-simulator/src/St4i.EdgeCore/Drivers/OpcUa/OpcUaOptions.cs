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
///
/// <para>🔴 See <see cref="Modbus.ModbusOptions"/>'s class doc for the measured reader census covering the
/// env-var name constants on BOTH classes, and for the two sentences of an earlier census that it
/// corrects. The short form for this class: <see cref="EnvVarMapPath"/> is named, fully qualified, by
/// <c>St4i.EngineApi.Program</c> in a startup error message; <see cref="EnvVarPkiDir"/> is read by
/// <see cref="OpcUaPkiPaths.DefaultRoot"/> and named by <c>OpcUaDriver</c>'s class doc;
/// <see cref="EnvVarEnabled"/> and <see cref="EnvVarEndpoint"/> had no reader outside this file until
/// <c>ConnectorEndpointsTests</c> was changed to call <see cref="EnvVarEnabled"/> and
/// <see cref="EnvVarMapPath"/> by name rather than retyping their strings.</para>
/// </summary>
public sealed class OpcUaOptions
{
    /// <summary>Name of the environment variable that decides whether the OPC-UA client driver runs at
    /// all. Opt-IN polarity and the same two-token vocabulary as <c>ModbusOptions.EnvVarEnabled</c>:
    /// <see cref="FromEnvironment"/> resolves <c>"1"</c> and <c>"true"</c> (case-insensitive) to on and any
    /// other value to off, so an unset variable and a misspelled one are indistinguishable at this
    /// boundary. 🔴 <b>Switching this on is the precondition for a disk side effect the OFF state cannot
    /// reach:</b> with it off, <c>St4i.EngineApi.Program</c> skips the whole OPC-UA block and no driver is
    /// constructed; with it on AND a node map that loads, the driver auto-generates an app-instance
    /// certificate under <see cref="OpcUaPkiPaths.ResolveRoot"/>, because the OPC-UA stack requires one
    /// even at <see cref="OpcUaSecurityMode.None"/> — see <see cref="OpcUaDriver"/>'s class doc
    /// comment.</summary>
    public const string EnvVarEnabled = "ST4I_OPCUA_ENABLED";

    /// <summary>See <see cref="EndpointUrl"/>'s doc comment / <see cref="OpcUaNodeMap"/>'s class doc
    /// comment "EndpointUrl precedence" note — this env var is read into <see cref="EndpointUrl"/> for
    /// symmetry with <c>ModbusOptions.Host</c>/<c>Port</c>, but the current driver/factory wiring always
    /// uses the node map's own (required) <c>EndpointUrl</c> instead.</summary>
    public const string EnvVarEndpoint = "ST4I_OPCUA_ENDPOINT";

    /// <summary>Name of the environment variable carrying the filesystem path of the
    /// <see cref="OpcUaNodeMap"/> JSON document. This is the prerequisite <see cref="EnvVarEnabled"/>
    /// cannot substitute for: with the driver enabled and this unset or blank, <see cref="MapPath"/> is
    /// <see langword="null"/> and <c>St4i.EngineApi.Program</c> throws an
    /// <c>InvalidOperationException</c> naming this constant, catches it in the same block that catches a
    /// malformed map, writes a startup warning to standard error and leaves the OPC-UA slot unfilled for
    /// the run rather than crashing startup. 🔴 Because the node map is also where the endpoint comes from
    /// — see the "EndpointUrl precedence" note on <see cref="OpcUaNodeMap"/>, and note that
    /// <see cref="EndpointUrl"/>, the property <see cref="EnvVarEndpoint"/> feeds, has no reader under
    /// <c>src/</c> outside this class: measured 2026-08-22 by enumerating each <c>EndpointUrl</c>
    /// occurrence in the <c>*.cs</c> this repository owns, and the ones under <c>src/</c> outside this file
    /// all name <c>OpcUaNodeMap.EndpointUrl</c> instead — an OPC-UA deployment therefore cannot be
    /// expressed with environment variables alone: this variable points at a FILE that has to
    /// exist.</summary>
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
    /// <summary>The built-in pki root, <c>%ProgramData%\ST4I\sim\opcua-pki</c>, which resolved to
    /// <c>C:\ProgramData\ST4I\sim\opcua-pki</c> when measured 2026-08-22 on this platform.
    ///
    /// <para>🔴 <b>This method does NOT consult <see cref="OpcUaOptions.EnvVarPkiDir"/>, and that is the
    /// whole distinction between it and <see cref="ResolveRoot"/>.</b> Measured 2026-08-22 with
    /// <c>ST4I_OPCUA_PKI_DIR</c> pointed at a different directory: <see cref="ResolveRoot"/> returned the
    /// override, this method returned the ProgramData path unchanged. A caller that reaches for this one
    /// directly therefore bypasses an operator's relocation — prefer <see cref="ResolveRoot"/> unless the
    /// ProgramData path itself is what is wanted (which is the case for a message that has to name the
    /// built-in default).</para>
    ///
    /// <para>Pure path arithmetic on a well-known folder: it does not touch the file system, so the
    /// directory it names need not exist when this returns. The reason it is
    /// kept SHORT is recorded on this class: a deep root pushed the certificate file path far enough to
    /// trip a legacy path-length limit in the native crypto load.</para></summary>
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
