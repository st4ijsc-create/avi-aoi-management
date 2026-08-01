using St4i.Connector.Abstractions;

namespace St4i.EdgeCore.Drivers.Modbus;

/// <summary>
/// G2-6 (WS-H) — builds a fresh <see cref="ModbusTcpDriver"/> per <c>FleetHost.StartLocked</c> call: a
/// driver owns a live TCP connection torn down (best-effort) whenever its pipeline slot stops/restarts, so
/// each pipeline (re)start needs a BRAND NEW instance, never a reused one (same reasoning
/// <c>SimulatorFactory.Create</c> already applies to the simulated fleet's own drivers). Program.cs
/// constructs exactly one of these (when <see cref="ModbusOptions.Enabled"/> and the register map loads)
/// and registers its <see cref="Create"/> method as the <c>Func&lt;IDeviceDriver&gt;</c> singleton
/// St4i.EngineApi's <c>FleetHost</c> optional ctor param resolves.
/// </summary>
public sealed class ModbusDriverFactory
{
    private readonly ModbusOptions _options;
    private readonly ModbusRegisterMap _map;
    private readonly Action<string>? _logWarning;
    private readonly Action<Exception, string>? _logError;

    public ModbusDriverFactory(
        ModbusOptions options, ModbusRegisterMap map,
        Action<string>? logWarning = null, Action<Exception, string>? logError = null)
    {
        _options = options ?? throw new ArgumentNullException(nameof(options));
        _map = map ?? throw new ArgumentNullException(nameof(map));
        _logWarning = logWarning;
        _logError = logError;
    }

    public IDeviceDriver Create() => new ModbusTcpDriver(_options.Host, _options.Port, _map, _logWarning, _logError);
}
