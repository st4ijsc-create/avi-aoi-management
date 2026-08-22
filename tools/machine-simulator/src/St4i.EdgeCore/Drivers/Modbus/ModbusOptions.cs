using System.Globalization;

namespace St4i.EdgeCore.Drivers.Modbus;

/// <summary>
/// G2-6 (WS-H) — configuration for the Modbus TCP driver: whether it's on at all, which host/port to
/// dial, and where its <see cref="ModbusRegisterMap"/> JSON lives. Mirrors the
/// <see cref="St4i.EdgeCore.Transport.WalOptions.FromEnvironment"/>/<see cref="St4i.EdgeCore.Uns.UnsOptions.FromEnvironment"/>
/// idiom: env vars are read ONCE at startup, an unset/blank string falls back to its default rather than
/// throwing, and an unparseable <see cref="EnvVarPort"/> value is silently ignored (keeps the default)
/// instead of crashing startup on a typo.
///
/// UNLIKE <see cref="St4i.EdgeCore.Uns.UnsOptions"/> (default ON), <see cref="Enabled"/> defaults to
/// <see langword="false"/> — this task is additive: with no Modbus endpoint configured, a fresh
/// install/CI run is byte-identical to pre-G2-6 behavior (no extra pipeline slot, no extra TCP traffic,
/// nothing).
///
/// <para>🔴 WHO READS THE FOUR ENV-VAR NAME CONSTANTS BELOW, measured rather than assumed, because an
/// earlier census got this exactly backwards in both halves. It reported that "both production hosts
/// hardcode the literal instead" of naming the constant. Neither half survived re-measurement, and the
/// re-measurement has now been run a second time and still holds:
/// <list type="bullet">
///   <item>NO <c>.cs</c> file under <c>src/</c> other than this file and
///     <see cref="St4i.EdgeCore.Drivers.OpcUa.OpcUaOptions"/> carries any of the seven spellings as a
///     string LITERAL. What that census read as hardcoded literals in the two hosts were <c>//</c> comment
///     lines — <c>St4i.EdgeService.EdgeConnectors</c>'s comment says the opposite of what it was quoted
///     for, recording that that host has never read these variables at all.</item>
///   <item><c>St4i.EngineApi.Program</c> DOES name two of them, fully qualified
///     (<c>St4i.EdgeCore.Drivers.Modbus.ModbusOptions.EnvVarMapPath</c> and the OPC-UA twin), in two
///     startup error messages. The mechanism a public name constant exists for is working, not dead.
///     A grep for the UNQUALIFIED spelling cannot see the qualified form; that is how the miss happened.</item>
///   <item>Both production hosts obtain VALUES through <see cref="FromEnvironment"/>, i.e. through these
///     constants, never through a second copy.</item>
/// </list>
/// The genuine drift risk was never in the hosts — it is between these constants and the copies that live
/// elsewhere: <c>README.md</c> §16.4/§16.6's two env-var tables, and, until this was written, two test
/// files. <c>ConnectorEndpointsTests</c> and <c>ConnectorEndpointsEnvSeedingSideEffectsTests</c> now call
/// these constants by name instead of retyping the strings, which removes two of the three copies and
/// makes a rename of any value here reach them by compilation.</para>
///
/// <para>🔴 <b>THE LAST SENTENCE OF THAT PARAGRAPH IS RETRACTED, 2026-08-22 (owner-decisions.md item 36).</b>
/// It read: <i>"The README tables remain a hand-kept copy with no witness: nothing goes red if they drift,
/// and that is still true."</i> It was true when written and it is no longer:
/// <c>St4i.EngineApi.Tests.DriverDocumentationTests</c> derives the four names below (and the OPC-UA four,
/// and both classes' numeric defaults and guards) from THIS FILE and compares them against README
/// §16.4/§16.6, so a rename here now reddens a test instead of rotting a table. <b>What that witness does
/// not buy, said here rather than left to be assumed:</b> it compares VALUES and NAME SETS, plus the
/// handful of value-bearing sentences its own remarks name one by one. The rationale and deferral prose in
/// those two sections is still a hand-kept copy no instrument reads, and building the witness is how two
/// already-drifted sentences were found (§16.6's "hardcoded 15 seconds" and §16.4's six-of-seven
/// argument-type list).</para>
///
/// <para>🔴 <b>ONE CLAUSE OF THE READER CENSUS ABOVE IS NARROWED 2026-08-22</b> (docs/owner-decisions.md
/// item 25, stage 9). The census sentence reading <i>"recording that that host has never read these
/// variables at all"</i> is kept verbatim above, because the point it was making — that
/// <c>St4i.EdgeService.EdgeConnectors</c> has no environment-variable CONNECTOR ROUTE — is correct and is
/// what that host's own comment says. What does not survive re-measurement is the words "at all".
/// Measured on the working tree 2026-08-22: <c>EdgeConnectors.Build</c> calls
/// <see cref="FromEnvironment"/>, which reads all four variables named below through
/// <c>Environment.GetEnvironmentVariable</c>, and hands the result to
/// <see cref="ModbusConnectorFactory"/> and thence <see cref="ModbusDriverFactory"/> — so
/// <see cref="EnvVarHost"/> and <see cref="EnvVarPort"/> DO reach a driver in that host. What that host
/// does not consult is <see cref="Enabled"/> and <see cref="MapPath"/>: its connectors come from
/// <c>connectors.json</c>. So the correct statement is that this class has TWO production callers of
/// <see cref="FromEnvironment"/> and one env-var connector route, not one caller.</para>
/// </summary>
public sealed class ModbusOptions
{
    /// <summary>Name of the environment variable that decides whether the Modbus TCP driver runs at all.
    /// 🔴 <b>Opt-IN polarity, and the accepted vocabulary is two tokens wide.</b>
    /// <see cref="FromEnvironment"/> resolves <c>"1"</c> and <c>"true"</c> (case-insensitive) to on and
    /// resolves any other value to off, so an UNSET variable and a MISSPELLED one are indistinguishable at
    /// this boundary — both leave the driver dormant, and neither produces a diagnostic from this class.
    /// Measured 2026-08-22 against the built assembly: <c>TRUE</c> → on, <c>1</c> → on, <c>yes</c> →
    /// off.</summary>
    public const string EnvVarEnabled = "ST4I_MODBUS_ENABLED";

    /// <summary>Name of the environment variable carrying the Modbus TCP host to dial. Unset, empty or
    /// whitespace falls back to <see cref="DefaultHost"/> rather than failing startup — measured
    /// 2026-08-22: a value of three spaces yields <c>127.0.0.1</c>. The consequence to plan for is that a
    /// deployment which blanks this variable dials LOOPBACK instead of refusing to start, so the mistake
    /// surfaces where a CONNECT failure surfaces — <see cref="ModbusTcpDriver"/>'s poll loop reports it
    /// through its <c>logError</c> callback and degrades Health — and not as a configuration error at
    /// startup.</summary>
    public const string EnvVarHost = "ST4I_MODBUS_HOST";

    /// <summary>Name of the environment variable carrying the Modbus TCP port. 🔴 <b>Two kinds of bad
    /// value are handled two different ways, and the more dangerous kind is the one that is accepted.</b>
    /// A value that does not parse as an <see langword="int"/> is discarded and <see cref="DefaultPort"/>
    /// applies (measured 2026-08-22: <c>not-a-number</c> → 502, three spaces → 502); a value that DOES
    /// parse is taken as given with no range check, so <c>-3</c> reaches <see cref="Port"/> intact
    /// (measured) and surfaces later as a socket error inside the poll loop.</summary>
    public const string EnvVarPort = "ST4I_MODBUS_PORT";

    /// <summary>Name of the environment variable carrying the filesystem path of the
    /// <see cref="ModbusRegisterMap"/> JSON document. This is the prerequisite that
    /// <see cref="EnvVarEnabled"/> cannot substitute for: with the driver enabled and this unset or blank,
    /// <see cref="MapPath"/> is <see langword="null"/> and <c>St4i.EngineApi.Program</c> throws
    /// <c>InvalidOperationException</c> naming this constant, catches it in the same block that catches a
    /// malformed map, writes a startup warning to STANDARD ERROR — there is no app logger that early, and
    /// the code says so at the catch — and leaves the Modbus slot unfilled for the run. So "enabled but
    /// silent" is a reachable, supported state rather than a contradiction.</summary>
    public const string EnvVarMapPath = "ST4I_MODBUS_MAP";

    /// <summary>The host <see cref="FromEnvironment"/> falls back to when <see cref="EnvVarHost"/> is
    /// unset or blank: the IPv4 loopback address. The CONSEQUENCE, stated rather than a rationale this
    /// repository does not record: a deployment that switches Modbus on without pointing it somewhere
    /// dials the SAME machine, so it reaches a locally hosted gateway or simulator if one is listening and
    /// otherwise fails to connect — it does not reach out onto the plant network by accident.</summary>
    public const string DefaultHost = "127.0.0.1";

    /// <summary>The TCP port <see cref="FromEnvironment"/> falls back to when <see cref="EnvVarPort"/> is
    /// unset, blank or unparseable: 502, the port registered for Modbus/TCP. A deployment whose gateway
    /// listens elsewhere overrides it through <see cref="EnvVarPort"/>, subject to the missing range check
    /// recorded there.</summary>
    public const int DefaultPort = 502;

    /// <summary>Whether the Modbus driver is active at all. Defaults to <see langword="false"/> — see the
    /// class doc comment for why this is the opposite default from <see cref="St4i.EdgeCore.Uns.UnsOptions.Enabled"/>.</summary>
    public bool Enabled { get; init; }

    /// <summary>The host <see cref="ModbusTcpDriver"/> dials. Reading this tells you what the process will
    /// connect to; it does not tell you whether an operator chose it, because an absent
    /// <see cref="EnvVarHost"/> and a blank one both arrive here as <see cref="DefaultHost"/>. Resolved by
    /// one <see cref="FromEnvironment"/> call per host process — there are two such hosts,
    /// <c>St4i.EngineApi.Program</c> and <c>St4i.EdgeService.EdgeConnectors</c> — and it is not re-read, so
    /// changing the variable moves this value at that process's next start and not before.</summary>
    public string Host { get; init; } = DefaultHost;

    /// <summary>The TCP port <see cref="ModbusTcpDriver"/> dials, resolved once at startup. Not range
    /// checked on the way in — see <see cref="EnvVarPort"/>: a parseable value outside the usable port
    /// range arrives intact (measured 2026-08-22 with <c>-3</c>) and fails at socket-open time inside the
    /// driver's poll loop, where it is reported as a connect failure rather than as a configuration
    /// fault.</summary>
    public int Port { get; init; } = DefaultPort;

    /// <summary>Path to the <see cref="ModbusRegisterMap"/> JSON file. <see langword="null"/> means
    /// "not configured" — Program.cs treats a null/unset path the same as a load failure: logs a warning
    /// and disables Modbus for this run rather than crashing startup.</summary>
    public string? MapPath { get; init; }

    /// <summary>Builds a <see cref="ModbusOptions"/> from the <c>ST4I_MODBUS_*</c> environment variables:
    /// <list type="bullet">
    /// <item><c>ST4I_MODBUS_ENABLED</c> → <see cref="Enabled"/> ("true"/"1" (case-insensitive) → true;
    /// unset/anything else → false — the opposite default polarity from <c>ST4I_WAL_ENABLED</c>/
    /// <c>ST4I_UNS_ENABLED</c>, which default ON and look for "false"/"0" to opt OUT).</item>
    /// <item><c>ST4I_MODBUS_HOST</c> → <see cref="Host"/> (unset/blank → <see cref="DefaultHost"/>).</item>
    /// <item><c>ST4I_MODBUS_PORT</c> → <see cref="Port"/>. An unparseable value is IGNORED (keeps
    /// <see cref="DefaultPort"/>) rather than throwing.</item>
    /// <item><c>ST4I_MODBUS_MAP</c> → <see cref="MapPath"/> (unset/blank → <see langword="null"/>).</item>
    /// </list>
    /// </summary>
    public static ModbusOptions FromEnvironment()
    {
        var enabledRaw = Environment.GetEnvironmentVariable(EnvVarEnabled);
        var enabled = enabledRaw == "1" || string.Equals(enabledRaw, "true", StringComparison.OrdinalIgnoreCase);

        var hostRaw = Environment.GetEnvironmentVariable(EnvVarHost);
        var host = string.IsNullOrWhiteSpace(hostRaw) ? DefaultHost : hostRaw;

        var port = DefaultPort;
        var portRaw = Environment.GetEnvironmentVariable(EnvVarPort);
        if (!string.IsNullOrWhiteSpace(portRaw) &&
            int.TryParse(portRaw, NumberStyles.Integer, CultureInfo.InvariantCulture, out var parsedPort))
        {
            port = parsedPort;
        }

        var mapPathRaw = Environment.GetEnvironmentVariable(EnvVarMapPath);
        var mapPath = string.IsNullOrWhiteSpace(mapPathRaw) ? null : mapPathRaw;

        return new ModbusOptions
        {
            Enabled = enabled,
            Host = host,
            Port = port,
            MapPath = mapPath,
        };
    }
}
