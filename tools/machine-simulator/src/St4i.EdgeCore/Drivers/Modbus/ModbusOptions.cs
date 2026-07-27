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
/// </summary>
public sealed class ModbusOptions
{
    public const string EnvVarEnabled = "ST4I_MODBUS_ENABLED";
    public const string EnvVarHost = "ST4I_MODBUS_HOST";
    public const string EnvVarPort = "ST4I_MODBUS_PORT";
    public const string EnvVarMapPath = "ST4I_MODBUS_MAP";

    public const string DefaultHost = "127.0.0.1";
    public const int DefaultPort = 502;

    /// <summary>Whether the Modbus driver is active at all. Defaults to <see langword="false"/> — see the
    /// class doc comment for why this is the opposite default from <see cref="St4i.EdgeCore.Uns.UnsOptions.Enabled"/>.</summary>
    public bool Enabled { get; init; }

    public string Host { get; init; } = DefaultHost;

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
