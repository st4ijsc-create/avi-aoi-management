using St4i.Connector.Abstractions;
using St4i.Connector.Abstractions.Models;

namespace St4i.EdgeCore.Drivers.Modbus;

/// <summary>
/// GP-4 (.superpowers/sdd/2026-07-28-wsg-plugin-connector-seam-blueprint/task-4-brief.md) — the
/// <see cref="IConnectorFactory"/> adapter that lets Modbus register itself into a host's
/// <c>St4i.EngineApi.Fleet.ConnectorRegistry</c> instead of needing its own dedicated
/// <see cref="FleetHost"/> constructor parameter. Deliberately a thin wrapper, NOT a replacement, for
/// <see cref="ModbusDriverFactory"/>: this class owns exactly one job — turn the OPAQUE configuration
/// string a registry hands it into a validated <see cref="ModbusRegisterMap"/> without throwing — and then
/// delegates the actual driver construction to a freshly-built <see cref="ModbusDriverFactory"/>, reusing
/// its existing <see cref="ModbusDriverFactory.Create"/> rather than duplicating
/// <c>new ModbusTcpDriver(...)</c> here.
///
/// <para><see cref="ModbusOptions"/> (host/port — NOT part of the register map JSON) is supplied once, at
/// this adapter's own construction, by whatever wires it into a registry (<c>Program.cs</c>, mirroring
/// exactly how it constructs <see cref="ModbusDriverFactory"/> today) — <see cref="TryCreate"/>'s
/// <c>config</c> parameter is the register-map JSON text alone, i.e. exactly the string
/// <c>File.ReadAllText(ModbusOptions.MapPath)</c> already produces, so a host that already loaded that
/// file for its own purposes (e.g. to build a roster seed descriptor) can hand this adapter the very same
/// text with no re-reading, re-formatting, or wrapping.</para>
/// </summary>
public sealed class ModbusConnectorFactory : IConnectorFactory
{
    private readonly ModbusOptions _options;
    private readonly Action<string>? _logWarning;
    private readonly Action<Exception, string>? _logError;

    public ModbusConnectorFactory(
        ModbusOptions options,
        Action<string>? logWarning = null,
        Action<Exception, string>? logError = null)
    {
        _options = options ?? throw new ArgumentNullException(nameof(options));
        _logWarning = logWarning;
        _logError = logError;
    }

    public string Kind => DriverKinds.Modbus;

    /// <summary><paramref name="config"/> is the Modbus register-map JSON text (see the class doc
    /// comment) — parsed fresh on every call via <see cref="ModbusRegisterMap.FromJson"/>, whose exceptions
    /// (bad JSON, a missing/blank required field, an empty register list — see that method's own doc
    /// comment) are caught here and translated into the non-throwing
    /// <see cref="IConnectorFactory.TryCreate"/> contract: today's exact "a malformed map file disables
    /// Modbus for this run without crashing the host" behavior, now expressed structurally instead of via
    /// an ad hoc try/catch at the call site.</summary>
    public bool TryCreate(string config, out IDeviceDriver? driver, out string? error)
    {
        try
        {
            var map = ModbusRegisterMap.FromJson(config);
            driver = new ModbusDriverFactory(_options, map, _logWarning, _logError).Create();
            error = null;
            return true;
        }
        catch (Exception ex)
        {
            driver = null;
            error = ex.Message;
            return false;
        }
    }
}
