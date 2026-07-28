namespace St4i.Connector.Abstractions.Models;

/// <summary>
/// GP-3 (.superpowers/sdd/2026-07-28-wsg-plugin-connector-seam-blueprint/task-3-brief.md) — <c>DriverKind</c>
/// used to be a closed 5-member enum (<see cref="IDeviceDriver.Kind"/>,
/// <see cref="St4i.EdgeCore.Models.MachineDescriptor.DriverKind"/>, ...). A closed enum can never gain a
/// member from outside this assembly, so as long as it stayed one, no third-party connector could exist at
/// all — this task opened it into a free-form <see langword="string"/> id instead. These five constants are
/// the ONLY ones this codebase reserves; anything else is a third party's own id to define.
///
/// <b>The compatibility guarantee this class exists to keep:</b> real installs already have an
/// <c>assets.db</c> holding <c>driver_kind</c> TEXT rows, and a web UI already reads these five exact
/// PascalCase spellings off the wire (<c>Simulated</c>/<c>HotFolderAoi</c>/<c>Mqtt</c>/<c>Modbus</c>/
/// <c>OpcUa</c> — the same strings the old enum's <c>JsonStringEnumConverter</c> produced with no naming
/// policy). Every built-in driver (<c>SimulatedDriver</c>, <c>HotFolderAoiDriver</c>, <c>MqttDriver</c>,
/// <c>ModbusTcpDriver</c>, <c>OpcUaDriver</c>) and every in-code fleet roster references these constants —
/// never a magic string literal — so the exact spelling can never drift.
///
/// <b>Casing rule (the one real decision this task had to make):</b> <c>fleet.json</c> has always accepted
/// any casing for <c>driverKind</c> (a case-insensitive <c>JsonStringEnumConverter</c> — e.g. the shipped
/// <c>fleet.json</c>'s own lowercase <c>"simulated"</c>), while the wire/on-disk value is always the exact
/// PascalCase spelling below. Now that this is a plain string with no enum backing that case-insensitivity
/// for free, <see cref="Normalize"/> is the ONE place that decision is made: an incoming id that
/// case-insensitively matches one of these five is folded to the canonical spelling below (preserving
/// today's tolerant <c>fleet.json</c> behavior exactly); anything else is returned byte-for-byte unchanged.
/// This means the five built-ins can NEVER split into two different "connectors" by casing alone
/// (<c>"modbus"</c> and <c>"Modbus"</c> both resolve to the one <see cref="Modbus"/> id) — but a
/// third-party id is opaque and case-SENSITIVE: this assembly does not know a third party's canonical
/// casing, so it never folds it, and <c>"vendor.acme.weld"</c>/<c>"Vendor.Acme.Weld"</c> are two distinct
/// ids as far as this codebase is concerned. A third-party author is responsible for using one consistent
/// spelling everywhere it registers.
///
/// <b>Recommended (NOT enforced) third-party convention:</b> a namespaced, reverse-DNS-style id — e.g.
/// <c>vendor.acme.weld</c> — so two unrelated vendors' ids cannot collide. This is a recommendation in this
/// doc comment only, not a validated/enforced format: enforcing a shape here would just move the closed-set
/// problem from "which enum members exist" to "which string shapes are legal", trading one third-party
/// blocker for another. A future task can revisit this if id collisions turn out to be a real-world problem
/// once third-party connectors actually exist.
/// </summary>
public static class DriverKinds
{
    public const string Simulated = "Simulated";
    public const string HotFolderAoi = "HotFolderAoi";
    public const string Mqtt = "Mqtt";
    public const string Modbus = "Modbus";
    public const string OpcUa = "OpcUa";

    /// <summary>Every built-in id, in the exact casing every built-in driver/roster/wire value must use.
    /// Not itself part of the public contract (third parties never need to enumerate this) — internal to
    /// <see cref="Normalize"/>.</summary>
    private static readonly string[] BuiltIns = { Simulated, HotFolderAoi, Mqtt, Modbus, OpcUa };

    /// <summary>
    /// Case-insensitively matches <paramref name="id"/> against the five built-in ids above and, if it
    /// matches one, returns that id's exact canonical spelling — e.g. <c>"simulated"</c>,
    /// <c>"SIMULATED"</c>, and <c>"Simulated"</c> all return <see cref="Simulated"/> unchanged. Any id that
    /// does not match a built-in (a third-party id, or a genuine typo of a built-in name) is returned
    /// byte-for-byte as given — never case-folded, never rejected: this method's whole job is
    /// normalization, not validation. <see langword="null"/>/empty is returned unchanged (nothing to
    /// normalize against).
    /// </summary>
    public static string Normalize(string id)
    {
        if (string.IsNullOrEmpty(id)) return id;

        foreach (var builtIn in BuiltIns)
        {
            if (string.Equals(builtIn, id, StringComparison.OrdinalIgnoreCase)) return builtIn;
        }

        return id;
    }
}
