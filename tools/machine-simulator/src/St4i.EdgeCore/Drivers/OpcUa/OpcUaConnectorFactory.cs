using St4i.Connector.Abstractions;
using St4i.Connector.Abstractions.Models;

namespace St4i.EdgeCore.Drivers.OpcUa;

/// <summary>
/// GP-4 (.superpowers/sdd/2026-07-28-wsg-plugin-connector-seam-blueprint/task-4-brief.md) — the
/// <see cref="IConnectorFactory"/> adapter that lets OPC-UA register itself into a host's
/// <c>St4i.EngineApi.Fleet.ConnectorRegistry</c> instead of needing its own dedicated
/// <see cref="FleetHost"/> constructor parameter. Mirrors <see cref="Modbus.ModbusConnectorFactory"/>
/// exactly: turns the opaque configuration string a registry hands it into a validated
/// <see cref="OpcUaNodeMap"/> without throwing, then delegates actual driver construction to a
/// freshly-built <see cref="OpcUaDriverFactory"/>, reusing its existing <see cref="OpcUaDriverFactory.Create"/>
/// rather than duplicating <c>new OpcUaDriver(...)</c> here.
///
/// <para><c>pkiDir</c> (NOT part of the node map JSON) is supplied once, at this adapter's own
/// construction, by whatever wires it into a registry (<c>Program.cs</c>, mirroring exactly how it
/// constructs <see cref="OpcUaDriverFactory"/> today) — <see cref="TryCreate"/>'s <c>config</c> parameter
/// is the node-map JSON text alone, exactly the string <c>File.ReadAllText(OpcUaOptions.MapPath)</c>
/// already produces.</para>
///
/// <para><b>DI disambiguation, resolved:</b> <see cref="OpcUaDriverFactory"/> used to be registered in DI
/// as ITSELF (a distinct concrete type) purely so it would never collide with Modbus's own
/// <c>Func&lt;IDeviceDriver&gt;</c> singleton registration — see that class's own now-historical "DI
/// disambiguation" remarks. This adapter is never itself registered in DI at all (Program.cs constructs it
/// with a plain <see langword="new"/>, the same way it already constructs
/// <see cref="Modbus.ModbusConnectorFactory"/>) — the ONLY DI singleton either connector kind needs now is
/// the one <c>ConnectorRegistry</c> itself, so the collision this workaround existed to avoid cannot occur
/// even in principle: there is exactly one registered type, not two.</para>
/// </summary>
public sealed class OpcUaConnectorFactory : IConnectorFactory
{
    private readonly string? _pkiDir;
    private readonly Action<string>? _logWarning;
    private readonly Action<Exception, string>? _logError;

    public OpcUaConnectorFactory(
        string? pkiDir = null,
        Action<string>? logWarning = null,
        Action<Exception, string>? logError = null)
    {
        _pkiDir = pkiDir;
        _logWarning = logWarning;
        _logError = logError;
    }

    public string Kind => DriverKinds.OpcUa;

    /// <summary><paramref name="config"/> is the OPC-UA node-map JSON text (see the class doc comment) —
    /// parsed fresh on every call via <see cref="OpcUaNodeMap.FromJson"/>, whose exceptions are caught here
    /// and translated into the non-throwing <see cref="IConnectorFactory.TryCreate"/> contract: today's
    /// exact "a malformed node map file disables OPC-UA for this run without crashing the host" behavior,
    /// now expressed structurally instead of via an ad hoc try/catch at the call site.</summary>
    public bool TryCreate(string config, out IDeviceDriver? driver, out string? error)
    {
        try
        {
            var map = OpcUaNodeMap.FromJson(config);
            driver = new OpcUaDriverFactory(map, _pkiDir, _logWarning, _logError).Create();
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
