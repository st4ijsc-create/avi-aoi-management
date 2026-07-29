using System.Diagnostics.CodeAnalysis;
using St4i.Connector.Abstractions;
using St4i.Connector.Abstractions.Models;
using St4i.EdgeCore.Drivers.Modbus;
using St4i.EdgeCore.Drivers.OpcUa;
using St4i.EdgeCore.Models;

namespace St4i.EngineApi.Fleet;

/// <summary>
/// SM-5 (.superpowers/sdd/2026-07-29-dotA-single-machine-sellable-blueprint/task-5-brief.md) — the ONE
/// place a <c>POST /v1/connectors</c> (or <c>/v1/connectors/test</c>) request is turned into either "here is
/// a working <see cref="IConnectorFactory"/> plus the <see cref="MachineDescriptor"/> to seed the roster
/// with" or an operator-readable rejection reason. Deliberately restricted to exactly the two connector
/// kinds this build can actually drive (<see cref="DriverKinds.Modbus"/>/<see cref="DriverKinds.OpcUa"/>) —
/// the brief is explicit that stubbing a protocol with no working driver (Serial/RS-485, S7, EtherNet/IP,
/// SECS/GEM) into any picker, backend included, is the exact dishonesty this whole batch removes. A kind
/// that doesn't normalize to one of these two is rejected with a 400-shaped error, never silently accepted
/// and dropped.
///
/// <para><b>Reuses the SAME parsers the built-in connectors already trust</b> — <see cref="ModbusRegisterMap.FromJson"/>/
/// <see cref="OpcUaNodeMap.FromJson"/>, exactly as <see cref="ModbusConnectorFactory.TryCreate"/>/
/// <see cref="OpcUaConnectorFactory.TryCreate"/> themselves do — rather than re-implementing map validation a
/// second time. A malformed/incomplete map (bad JSON, a missing required field, an empty register/node list)
/// throws straight out of those methods; this class catches it and reports the exception's own message,
/// mirroring the "one throwing parse function, caller decides what a failure means" idiom those two classes'
/// own doc comments already establish.</para>
///
/// <para><b>Host/port is a per-connector, per-request concern for Modbus, NOT reused from any shared
/// environment-configured <see cref="ModbusOptions"/>.</b> Unlike <c>connectors.json</c>'s own dispatch (which
/// reuses ONE process-wide, env-derived <c>ModbusOptions</c> for every <c>connectors.json</c> Modbus entry —
/// a pre-existing limitation this task does not touch), an operator adding a connector through the UI is
/// naming a SPECIFIC real machine at a SPECIFIC address, so this class builds a FRESH, per-request
/// <see cref="ModbusOptions"/> from the request's own <c>host</c>/<c>port</c> fields. OPC-UA has no such
/// split: its endpoint/security/credentials already live inside the node-map JSON itself
/// (<see cref="OpcUaNodeMap.EndpointUrl"/>/<see cref="OpcUaNodeMap.Username"/>/<see cref="OpcUaNodeMap.Password"/>),
/// so <c>host</c>/<c>port</c> are simply ignored for that kind (harmless extra fields, not an error) — only
/// <paramref name="pkiDir"/> (the app-instance-certificate root, a device-wide location, not per-connector) is
/// threaded through, mirroring Program.cs's own OPC-UA wiring.</para>
/// </summary>
public static class ConnectorConfigValidation
{
    /// <summary>Everything a caller needs once a request has been accepted: the ready-to-register factory,
    /// the roster descriptor to seed via <see cref="FleetHost.RegisterMachine"/>, and the exact
    /// <paramref name="Host"/>/<paramref name="Port"/>/<paramref name="MachineCode"/> to persist via
    /// <see cref="ConnectorConfigStore.SaveAsync"/> (already normalized/trimmed — never re-derived a second
    /// time from the raw request by the caller).</summary>
    /// <param name="WriteCapability">Task B-3 — what THIS map declares (adapted from whichever protocol's own
    /// parsed map — <see cref="St4i.EdgeCore.Drivers.Modbus.ModbusRegisterMap.WritablePointNames"/>/<c>CommandNames</c>
    /// or <see cref="St4i.EdgeCore.Drivers.OpcUa.OpcUaNodeMap.WritablePointNames"/>/<c>CommandNames</c> — into
    /// the one generic shape <see cref="ConnectorConfigStore"/>/the save gate share). Never <see langword="null"/>
    /// — <see cref="ConnectorWriteCapability.None"/> for a map that declares neither, matching every map this
    /// build has ever accepted before this task.</param>
    public sealed record ConnectorValidationResult(
        string Kind, string MachineCode, string? Host, int? Port, double PollIntervalSeconds,
        IConnectorFactory Factory, MachineDescriptor Descriptor, ConnectorWriteCapability WriteCapability);

    /// <returns><see langword="true"/> with <paramref name="result"/> populated on success;
    /// <see langword="false"/> with an operator-readable <paramref name="error"/> otherwise. Never throws —
    /// every exception a malformed map/kind could produce is caught and translated into
    /// <paramref name="error"/>, the same non-throwing contract <see cref="IConnectorFactory.TryCreate"/>
    /// itself is held to.</returns>
    public static bool TryValidate(
        string? kindRaw,
        string? host,
        int? port,
        string? mapJson,
        string? pkiDir,
        [NotNullWhen(true)] out ConnectorValidationResult? result,
        [NotNullWhen(false)] out string? error)
    {
        result = null;

        if (string.IsNullOrWhiteSpace(kindRaw))
        {
            error = "kind is required.";
            return false;
        }

        if (string.IsNullOrWhiteSpace(mapJson))
        {
            error = "mapJson is required — paste or upload the register-map / node-map JSON for this machine.";
            return false;
        }

        var kind = DriverKinds.Normalize(kindRaw.Trim());

        if (kind == DriverKinds.Modbus)
        {
            return TryValidateModbus(host, port, mapJson, out result, out error);
        }

        if (kind == DriverKinds.OpcUa)
        {
            return TryValidateOpcUa(mapJson, pkiDir, out result, out error);
        }

        error = $"Unsupported connector kind '{kindRaw}' — only Modbus TCP ('Modbus') and OPC-UA ('OpcUa') " +
                "are supported by this build.";
        return false;
    }

    private static bool TryValidateModbus(
        string? host, int? port, string mapJson,
        [NotNullWhen(true)] out ConnectorValidationResult? result,
        [NotNullWhen(false)] out string? error)
    {
        result = null;

        if (string.IsNullOrWhiteSpace(host))
        {
            error = "host is required for a Modbus connector.";
            return false;
        }

        if (port is not { } p || p is < 1 or > 65535)
        {
            error = "port must be between 1 and 65535 for a Modbus connector.";
            return false;
        }

        ModbusRegisterMap map;
        try
        {
            map = ModbusRegisterMap.FromJson(mapJson);
        }
        catch (Exception ex)
        {
            error = $"Invalid Modbus register map: {ex.Message}";
            return false;
        }

        var trimmedHost = host.Trim();
        var options = new ModbusOptions { Enabled = true, Host = trimmedHost, Port = p };
        var factory = new ModbusConnectorFactory(options);
        var pollIntervalSeconds = Math.Max(0.1, map.PollIntervalMs / 1000.0);

        var descriptor = new MachineDescriptor(
            Code: map.MachineCode,
            SerialSeed: $"SN-{map.MachineCode}",
            DeviceClass: DeviceClass.Automation,
            MachineType: "MODBUS_TCP",
            StepType: null,
            DriverKind: DriverKinds.Modbus,
            RecipeCode: null,
            MappingProfile: null,
            CycleSeconds: pollIntervalSeconds);

        var writeCapability = new ConnectorWriteCapability(map.WritablePointNames, map.CommandNames);

        result = new ConnectorValidationResult(DriverKinds.Modbus, map.MachineCode, trimmedHost, p, pollIntervalSeconds, factory, descriptor, writeCapability);
        error = null;
        return true;
    }

    private static bool TryValidateOpcUa(
        string mapJson, string? pkiDir,
        [NotNullWhen(true)] out ConnectorValidationResult? result,
        [NotNullWhen(false)] out string? error)
    {
        result = null;

        OpcUaNodeMap map;
        try
        {
            map = OpcUaNodeMap.FromJson(mapJson);
        }
        catch (Exception ex)
        {
            error = $"Invalid OPC-UA node map: {ex.Message}";
            return false;
        }

        var factory = new OpcUaConnectorFactory(pkiDir: pkiDir);
        var pollIntervalSeconds = Math.Max(0.1, map.PollIntervalMs / 1000.0);

        var descriptor = new MachineDescriptor(
            Code: map.MachineCode,
            SerialSeed: $"SN-{map.MachineCode}",
            DeviceClass: DeviceClass.Automation,
            MachineType: "OPC_UA",
            StepType: null,
            DriverKind: DriverKinds.OpcUa,
            RecipeCode: null,
            MappingProfile: null,
            CycleSeconds: pollIntervalSeconds);

        var writeCapability = new ConnectorWriteCapability(map.WritablePointNames, map.CommandNames);

        // Host/Port are not part of this kind's persisted-store columns — the map's own EndpointUrl is
        // authoritative (see this class's doc comment).
        result = new ConnectorValidationResult(DriverKinds.OpcUa, map.MachineCode, Host: null, Port: null, pollIntervalSeconds, factory, descriptor, writeCapability);
        error = null;
        return true;
    }
}
