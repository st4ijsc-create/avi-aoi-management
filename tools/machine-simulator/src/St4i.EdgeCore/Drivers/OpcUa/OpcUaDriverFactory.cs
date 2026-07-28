using St4i.Connector.Abstractions;

namespace St4i.EdgeCore.Drivers.OpcUa;

/// <summary>
/// GĐ3 sub-3 OU-1 — builds a fresh <see cref="OpcUaDriver"/> per <c>FleetHost.StartLocked</c> call: a
/// driver owns a live OPC-UA session torn down (best-effort) whenever its pipeline slot stops/restarts, so
/// each pipeline (re)start needs a BRAND NEW instance, never a reused one — same reasoning
/// <see cref="Modbus.ModbusDriverFactory"/> already documents for itself.
///
/// <para><b>DI disambiguation (GĐ3 sub-3 OU-1 brief):</b> Program.cs registers Modbus's factory as a bare
/// <c>Func&lt;IDeviceDriver&gt;</c> singleton — a SECOND <c>Func&lt;IDeviceDriver&gt;</c> registration for
/// OPC-UA would collide (last registration wins, or an ambiguous resolution, depending on how it's
/// consumed). This class is registered as ITSELF instead (a distinct concrete type), and
/// <c>FleetHost</c>'s ctor takes a distinct <c>OpcUaDriverFactory?</c> param (not another
/// <c>Func&lt;IDeviceDriver&gt;?</c>) — the two optional dependencies can never be confused with each
/// other by the DI container.</para>
///
/// <para><b>Testability:</b> unlike <see cref="Modbus.ModbusDriverFactory"/> (which stays
/// <see langword="sealed"/> — Modbus's <c>FleetHost</c> ctor param is a bare <c>Func&lt;IDeviceDriver&gt;</c>,
/// so a test can inject a fake driver with no NModbus dependency by just passing a lambda), THIS factory
/// IS the type <c>FleetHost</c>'s ctor param is declared as, so a test proving the OPC-UA slot's wiring
/// (<c>St4i.EngineApi.Tests.FleetHostOpcUaSlotTests</c>) needs a way to substitute a fake driver WITHOUT a
/// real OPC-UA session. <see cref="Create"/> is therefore <see langword="virtual"/> and this class is not
/// sealed — that test defines a small subclass overriding <see cref="Create"/> to return a fake
/// <see cref="IDeviceDriver"/>, the standard "test subclass overrides the one virtual factory method"
/// double, same idea as <c>FleetHost</c>'s own <c>DriverDecoratorForTests</c>/
/// <c>AdditionalPipelinesForTests</c> internal test seams achieve for the simulated pipeline.</para>
/// </summary>
public class OpcUaDriverFactory
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

    public virtual IDeviceDriver Create() => new OpcUaDriver(_map, _logWarning, _logError, _pkiDir);
}
