using St4i.Connector.Abstractions;

namespace St4i.EdgeCore.Drivers.OpcUa;

/// <summary>
/// GĐ3 sub-3 OU-1 — builds a fresh <see cref="OpcUaDriver"/> per <c>FleetHost.StartLocked</c> call: a
/// driver owns a live OPC-UA session torn down (best-effort) whenever its pipeline slot stops/restarts, so
/// each pipeline (re)start needs a BRAND NEW instance, never a reused one — same reasoning
/// <see cref="Modbus.ModbusDriverFactory"/> already documents for itself.
///
/// <para><b>DI disambiguation, now historical (GP-4 update):</b> this class used to be registered in DI as
/// ITSELF (a distinct concrete type) purely so it would never collide with Modbus's own
/// <c>Func&lt;IDeviceDriver&gt;</c> singleton registration, and <c>FleetHost</c>'s ctor took a dedicated
/// <c>OpcUaDriverFactory?</c> parameter for the same reason. GP-4
/// (.superpowers/sdd/2026-07-28-wsg-plugin-connector-seam-blueprint/task-4-brief.md) removed both: this
/// type is no longer registered in DI at all (<c>OpcUaConnectorFactory</c>, an
/// <c>St4i.Connector.Abstractions.IConnectorFactory</c> adapter, constructs one internally with a plain
/// <see langword="new"/>), and <c>FleetHost</c> no longer has an OPC-UA-specific constructor parameter —
/// only one <c>ConnectorRegistry</c> singleton, so the collision this workaround existed to avoid cannot
/// occur even in principle anymore.</para>
///
/// <para><b>Testability, now also historical:</b> before GP-4, <c>FleetHost</c>'s ctor took this concrete
/// type directly, so <c>St4i.EngineApi.Tests.FleetHostOpcUaSlotTests</c> substituted a fake driver by
/// subclassing this class and overriding a <see langword="virtual"/> <see cref="Create"/>. That seam has
/// moved: a test now registers a plain <c>IConnectorFactory</c> test double (returning a fake driver from
/// <c>TryCreate</c>) into a <c>ConnectorRegistry</c> instead — no subclass of THIS class is needed, or
/// exists, anymore. <see cref="Create"/> is therefore no longer <see langword="virtual"/> and this class
/// is <see langword="sealed"/>, matching <see cref="Modbus.ModbusDriverFactory"/>'s own shape exactly.</para>
/// </summary>
public sealed class OpcUaDriverFactory
{
    private readonly OpcUaNodeMap _map;
    private readonly string? _pkiDir;
    private readonly Action<string>? _logWarning;
    private readonly Action<Exception, string>? _logError;

    public OpcUaDriverFactory(
        OpcUaNodeMap map, string? pkiDir = null,
        Action<string>? logWarning = null, Action<Exception, string>? logError = null)
    {
        _map = map ?? throw new ArgumentNullException(nameof(map));
        _pkiDir = pkiDir;
        _logWarning = logWarning;
        _logError = logError;
    }

    public IDeviceDriver Create() => new OpcUaDriver(_map, _logWarning, _logError, _pkiDir);
}
