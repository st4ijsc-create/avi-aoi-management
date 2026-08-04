using NModbus;

namespace St4i.EdgeCore.Drivers.Modbus;

/// <summary>
/// 🔴 Task D-5 (.superpowers/sdd/2026-08-02-dotD-modbus-rtu-blueprint/task-5-brief.md) — <b>the transport-agnostic
/// half of a Modbus write, extracted so <see cref="ModbusTcpDriver"/> and <see cref="ModbusRtuDriver"/> share one
/// implementation instead of holding two copies that can drift.</b>
///
/// <para>Every member here was <c>private static</c> on <see cref="ModbusTcpDriver"/> and is moved VERBATIM — this
/// is a mechanical extraction, not a rewrite, and <c>ModbusTcpDriverWriteTests</c> is what proves it
/// behaviour-preserving (a moved total there would mean it was not). It is the same move D-2 made when it pulled
/// the read-side decode out of <see cref="ModbusTcpDriver"/> into <see cref="ModbusRegister.DecodeRawWord"/> so the
/// RTU driver could reuse the identical math: <b>a copy is not a reuse, and the drift would be silent.</b></para>
///
/// <para><b>What is deliberately NOT here: the value math.</b> The declared <c>[min,max]</c> check, the finiteness
/// check, the physical-type range check after inverse scaling and the rounding all live in
/// <see cref="ModbusRegister.TryComputeRawWordForWrite"/> — B-3's one place — and both drivers CALL it. This class
/// adds no second validation path; it only resolves a NAME to a declaration and narrows the request's
/// <see langword="object"/>? value to the <see langword="double"/> that method takes.</para>
///
/// <para><b>Why <see cref="DescribeSlaveException"/> in particular must not be duplicated.</b> It is a
/// hand-written six-entry mapping over the Modbus protocol exception codes, deliberately chosen over NModbus's own
/// several-sentences-of-spec-prose <c>Message</c>. Two copies of a hand-written table drift silently and the drift
/// is operator-visible on the commissioning path — which is exactly the defect class blueprint §8.1 names ("fixing
/// one instance of a defect class gives no immunity to the class").</para>
///
/// <para><see langword="internal"/> rather than <see langword="public"/>, and NOT reachable from the test assembly:
/// <c>St4i.EdgeCore</c> deliberately carries no <c>InternalsVisibleTo</c> (see its <c>AssemblyInfo.cs</c>), so every
/// member below is exercised through the two drivers' own public write methods, which is where the behaviour
/// actually matters.</para>
/// </summary>
internal static class ModbusWritePreflight
{
    /// <summary>Resolves a <see cref="Models.SetpointWriteRequest.Point"/> name to the register that declares it.
    /// Ordinal comparison, deliberately: a point name is an identifier the map author wrote and the caller repeats
    /// verbatim, not something to be matched loosely.</summary>
    /// <returns>The declaring register, or <see langword="null"/> when this map declares no such metric — which is
    /// the driver's <see cref="Models.SetpointRejectionReason.UnknownPoint"/> case.</returns>
    public static ModbusRegister? FindRegisterByMetric(ModbusRegisterMap map, string metric)
    {
        foreach (var register in map.Registers)
        {
            if (string.Equals(register.Metric, metric, StringComparison.Ordinal))
            {
                return register;
            }
        }

        return null;
    }

    /// <summary>The command counterpart of <see cref="FindRegisterByMetric"/> — same ordinal rule, same
    /// <see langword="null"/>-means-unknown contract.</summary>
    public static ModbusCommand? FindCommandByName(ModbusRegisterMap map, string name)
    {
        foreach (var command in map.Commands)
        {
            if (string.Equals(command.Name, name, StringComparison.Ordinal))
            {
                return command;
            }
        }

        return null;
    }

    /// <summary>Narrows <see cref="Models.SetpointWriteRequest.Value"/>'s object? domain (double|bool|string|null,
    /// widened at deserialization — see that property's own doc comment) down to the <see langword="double"/>
    /// <see cref="ModbusRegister.TryComputeRawWordForWrite"/> needs, mirroring the numeric branch of
    /// <c>OpcUaNodeMap.TryNarrowForWrite</c> exactly (double|long accepted; a JSON integral number arrives as
    /// <see langword="long"/> — see <c>Json.ConnectorObjectConverter</c>'s own doc comment). Every Modbus
    /// register is numeric, so a <see langword="bool"/>/<see langword="string"/>/<see langword="null"/>
    /// value has no legitimate meaning here; per B-3's own precedent (every failure
    /// <c>TryComputeRawWordForWrite</c> itself can produce maps to EXACTLY ONE <see cref="Models.SetpointRejectionReason"/>
    /// member — <see cref="Models.SetpointRejectionReason.OutOfRange"/>), a wrong-type value is rejected the same
    /// way: there is no separate "wrong type" rejection reason in this contract, and treating "not a number"
    /// as a range failure is the closest honest fit.</summary>
    public static bool TryToEngineeringValue(object? value, out double engineeringValue, out string? error)
    {
        switch (value)
        {
            case double d:
                engineeringValue = d;
                error = null;
                return true;
            case long l:
                engineeringValue = l;
                error = null;
                return true;
            default:
                engineeringValue = default;
                error = $"expected a numeric value, got {DescribeRuntimeType(value)}.";
                return false;
        }
    }

    /// <summary>Review fix round 2 (Important, task B-4) — the ONE deliberate exception to the drivers' "TYPE name
    /// only, never <c>ex.Message</c>" redaction discipline (contrast with every OTHER catch in either driver, which
    /// still redacts). A <see cref="SlaveException"/> carries no credentials and nothing derived from the map's own
    /// configuration — it is a small, fixed vocabulary of Modbus protocol exception codes
    /// (<see cref="SlaveExceptionCodes"/>, empirically confirmed by reflection against the installed
    /// NModbus 3.0.83 to be exactly six <see langword="const byte"/> values, 1-6) reported by the DEVICE
    /// ITSELF over the wire — not arbitrary text, and structurally incapable of echoing
    /// <c>_map.Username</c>/<c>Password</c> (Modbus has neither) or anything else the drivers do not
    /// already show the operator verbatim (a point/command name, a coil address). It is also the single
    /// most useful message on the commissioning path: an integrator who sees "Illegal Data Address" learns
    /// immediately their register address is wrong, without going log-diving for a message the device
    /// already handed them plainly. Deliberately does NOT surface NModbus's own <c>ex.Message</c>
    /// (confirmed by reflection to be several sentences of verbatim Modbus-spec prose per code — accurate,
    /// but unsuited to a one-line operator Detail, and not a shape this codebase controls if NModbus ever
    /// reword it) — this hand-written, six-entry mapping is the deliberate, controlled shape instead. If a
    /// future NModbus version reports a code outside 1-6, the fallback still names the raw numeric code
    /// rather than silently reverting to <c>ex.Message</c>.
    ///
    /// <para>🔴 Task D-5 moved this off <see cref="ModbusTcpDriver"/> so the RTU driver reports the SAME six
    /// strings. Two copies of a hand-written table are two things that can drift, and the drift would be
    /// visible to an integrator standing at a panel.</para></summary>
    public static string DescribeSlaveException(SlaveException ex) => ex.SlaveExceptionCode switch
    {
        SlaveExceptionCodes.IllegalFunction =>
            $"Illegal Function (Modbus exception code {ex.SlaveExceptionCode})",
        SlaveExceptionCodes.IllegalDataAddress =>
            $"Illegal Data Address (Modbus exception code {ex.SlaveExceptionCode})",
        SlaveExceptionCodes.IllegalDataValue =>
            $"Illegal Data Value (Modbus exception code {ex.SlaveExceptionCode})",
        SlaveExceptionCodes.SlaveDeviceFailure =>
            $"Slave Device Failure (Modbus exception code {ex.SlaveExceptionCode})",
        SlaveExceptionCodes.Acknowledge =>
            $"Acknowledge — device accepted the request but needs more time (Modbus exception code {ex.SlaveExceptionCode})",
        SlaveExceptionCodes.SlaveDeviceBusy =>
            $"Slave Device Busy (Modbus exception code {ex.SlaveExceptionCode})",
        _ => $"unrecognized Modbus exception code {ex.SlaveExceptionCode}",
    };

    private static string DescribeRuntimeType(object? value) => value switch
    {
        null => "null",
        bool => "a bool",
        string => "a string",
        long => "an integral number",
        double => "a floating-point number",
        _ => value.GetType().Name,
    };
}
