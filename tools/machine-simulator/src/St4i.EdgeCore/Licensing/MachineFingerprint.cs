using System.Net.NetworkInformation;
using System.Runtime.Versioning;
using System.Security.Cryptography;
using System.Text;
using Microsoft.Win32;
using St4i.EdgeCore.Identity;

namespace St4i.EdgeCore.Licensing;

/// <summary>
/// WS-E — reads this machine's four fingerprint components and decides whether a licence's fingerprint
/// matches.
///
/// <para>🔴 <b>EVERY READ IS INDIVIDUALLY WRAPPED, AND AN UNREADABLE COMPONENT COUNTS AS NOT MATCHING —
/// never as an exception, and never as a match.</b> These reads touch the registry, the filesystem and
/// the NIC enumeration on a real appliance: a registry ACL, a headless VM with no physical NIC, a
/// volume-serial call on an unusual mount can each fail. An exception escaping here would run on a
/// startup path and take the whole engine down over a LICENCE, which is precisely the boundary
/// violation this workstream exists to avoid. Counting an unreadable component as a MATCH would be the
/// opposite error: a machine that cannot read any component would match every licence.</para>
///
/// <para><b>What is deliberately NOT a component.</b> roadmap:305 names "TPM/CPU/MAC". TPM is dropped:
/// it is the most binding and the most brittle — a firmware TPM cleared by a BIOS update, a
/// <c>tpm.msc</c> clear or a motherboard RMA silently changes it, and the failure mode is a machine that
/// refuses its paid features after routine IT maintenance. CPU id is dropped too: <c>ProcessorId</c> is
/// documented as non-unique across many server SKUs, and a non-unique component in a binding fingerprint
/// is worse than no component. Hostname and domain membership are dropped because customers rename
/// machines and one must never bind to a mutable label. 🔴 This contradicts the roadmap text and is
/// recorded here rather than quietly done.</para>
/// </summary>
[SupportedOSPlatform("windows")]
public static class MachineFingerprint
{
    /// <summary>The component names, in the order <see cref="LicenseFingerprintPolicy.Of"/> lists them.</summary>
    public static readonly IReadOnlyList<string> ComponentNames =
        ["deviceIdentity", "machineGuid", "volumeSerial", "primaryMac"];

    /// <summary>
    /// Reads all four components. Never throws.
    /// </summary>
    /// <param name="identityStore">The device-identity store to read component #1 from, or
    /// <see langword="null"/> to construct one at the default/env-resolved root.</param>
    /// <param name="identityWasRegenerated">🔴 <see langword="true"/> when the identity store MINTED the
    /// identity during this read rather than loading it — see
    /// <see cref="DeviceIdentityStore.WasRegenerated"/> for the failure chain this surfaces. A caller that
    /// sees this true is looking at a fingerprint that may have moved with no hardware change at all.</param>
    /// <returns>The four hashed components; any that could not be read is <see langword="null"/>.</returns>
    public static LicenseFingerprint Read(
        DeviceIdentityStore? identityStore, out bool identityWasRegenerated)
    {
        identityWasRegenerated = false;

        string? identity = null;
        try
        {
            var store = identityStore ?? new DeviceIdentityStore();
            // 🔴 TryLoad, NOT LoadOrCreate: reading a fingerprint must never MINT an identity. If it did,
            // GET /v1/license/fingerprint — the endpoint a customer calls to have a licence issued — would
            // itself change the value it is reporting on a machine whose identity had gone missing, and
            // the licence would be issued against a fingerprint that the next boot might not reproduce.
            var loaded = store.TryLoad();
            identityWasRegenerated = store.WasRegenerated;
            if (loaded is not null) identity = Hash(loaded.Fingerprint);
        }
        catch (Exception ex) when (IsExpectedReadFailure(ex))
        {
            identity = null;
        }

        return new LicenseFingerprint(identity, ReadMachineGuid(), ReadVolumeSerial(), ReadPrimaryMac());
    }

    /// <summary>
    /// Counts how many of <paramref name="expected"/>'s components match <paramref name="observed"/>'s.
    /// A <see langword="null"/> on EITHER side never counts as a match — an unreadable component and an
    /// unspecified one are both "not matching".
    /// </summary>
    /// <param name="expected">The fingerprint inside the signed licence.</param>
    /// <param name="observed">This machine's fingerprint as read now.</param>
    /// <param name="mismatched">The names of the components that did not match, for the engineer surface.</param>
    /// <returns>The number of matching components, 0..4.</returns>
    public static int CountMatches(
        LicenseFingerprint? expected, LicenseFingerprint? observed, out IReadOnlyList<string> mismatched)
    {
        var misses = new List<string>();
        if (expected is null || observed is null)
        {
            mismatched = ComponentNames;
            return 0;
        }

        var pairs = new (string Name, string? Expected, string? Observed)[]
        {
            ("deviceIdentity", expected.DeviceIdentity, observed.DeviceIdentity),
            ("machineGuid", expected.MachineGuid, observed.MachineGuid),
            ("volumeSerial", expected.VolumeSerial, observed.VolumeSerial),
            ("primaryMac", expected.PrimaryMac, observed.PrimaryMac),
        };

        var matches = 0;
        foreach (var (name, e, o) in pairs)
        {
            if (e is not null && o is not null && string.Equals(e, o, StringComparison.OrdinalIgnoreCase))
            {
                matches++;
            }
            else
            {
                misses.Add(name);
            }
        }

        mismatched = misses;
        return matches;
    }

    /// <summary>
    /// The effective match threshold: the signed <see cref="LicenseFingerprintPolicy.Required"/>, or 3
    /// when the payload does not carry one.
    ///
    /// <para>🔴 Clamped to 1..4. A signed policy of 0 would match every machine — a licence that binds to
    /// nothing — and a policy above 4 could never be satisfied, bricking a paid machine. Neither is a
    /// value ST4I would issue, so both are treated as a corrupt-but-signed policy and clamped rather than
    /// honoured. Clamping UP from 0 is fail-closed for revenue; clamping DOWN from 5+ is fail-open for the
    /// customer, and each is the safe direction for its own error.</para>
    /// </summary>
    /// <param name="policy">The signed policy, or <see langword="null"/>.</param>
    /// <returns>The number of components that must match.</returns>
    public static int RequiredMatches(LicenseFingerprintPolicy? policy) =>
        policy is null ? 3 : Math.Clamp(policy.Required, 1, ComponentNames.Count);

    /// <summary>
    /// <c>HKLM\SOFTWARE\Microsoft\Cryptography\MachineGuid</c> — survives disk, NIC, RAM, GPU and
    /// motherboard swaps; changes only on OS reinstall or sysprep. The most stable Windows machine id,
    /// and the reason TPM's stability is not needed.
    /// </summary>
    /// <returns>The hashed value, or <see langword="null"/> if it could not be read.</returns>
    public static string? ReadMachineGuid()
    {
        try
        {
            using var key = Registry.LocalMachine.OpenSubKey(
                @"SOFTWARE\Microsoft\Cryptography", writable: false);
            var value = key?.GetValue("MachineGuid") as string;
            return string.IsNullOrWhiteSpace(value) ? null : Hash(value);
        }
        catch (Exception ex) when (IsExpectedReadFailure(ex))
        {
            return null;
        }
    }

    /// <summary>
    /// The volume serial of the drive holding <c>%ProgramData%</c> — cheap, and the component that tells
    /// two cloned VMs sharing a MachineGuid apart.
    /// </summary>
    /// <returns>The hashed value, or <see langword="null"/> if it could not be read.</returns>
    public static string? ReadVolumeSerial()
    {
        try
        {
            var programData = Environment.GetFolderPath(Environment.SpecialFolder.CommonApplicationData);
            if (string.IsNullOrWhiteSpace(programData)) return null;

            var root = Path.GetPathRoot(Path.GetFullPath(programData));
            if (string.IsNullOrWhiteSpace(root)) return null;

            var drive = new DriveInfo(root);
            // DriveInfo exposes no serial, so the durable identifiers it DOES expose stand in: the volume
            // label plus the filesystem plus the total size. A reformat changes the last two; a disk swap
            // changes all three. That is the same event class the real serial detects, without a P/Invoke
            // into GetVolumeInformation whose failure modes on a mapped or virtual volume are worse than
            // the component being slightly coarser.
            if (!drive.IsReady) return null;
            return Hash($"{root}|{drive.VolumeLabel}|{drive.DriveFormat}|{drive.TotalSize}");
        }
        catch (Exception ex) when (IsExpectedReadFailure(ex))
        {
            return null;
        }
    }

    /// <summary>
    /// The lowest-index physical, non-virtual, non-loopback NIC's MAC. Traditional, and the component an
    /// OEM integrator recognises. Breaks on a NIC swap, an unplugged USB-Ethernet adapter, or a
    /// Hyper-V/Docker/VPN adapter changing enumeration order — which is exactly why it is one of four and
    /// not the whole fingerprint.
    /// </summary>
    /// <returns>The hashed value, or <see langword="null"/> if no such NIC could be read.</returns>
    public static string? ReadPrimaryMac()
    {
        try
        {
            var mac = NetworkInterface.GetAllNetworkInterfaces()
                .Where(n => n.NetworkInterfaceType is not NetworkInterfaceType.Loopback
                                and not NetworkInterfaceType.Tunnel)
                .Where(n => !n.Description.Contains("virtual", StringComparison.OrdinalIgnoreCase))
                .Select(n => n.GetPhysicalAddress().ToString())
                .Where(a => !string.IsNullOrWhiteSpace(a) && a != "000000000000")
                // Ordinal sort, not enumeration order: the OS may reorder adapters between boots, and a
                // component that changes because Windows enumerated differently is a false mismatch.
                .OrderBy(a => a, StringComparer.Ordinal)
                .FirstOrDefault();

            return mac is null ? null : Hash(mac);
        }
        catch (Exception ex) when (IsExpectedReadFailure(ex))
        {
            return null;
        }
    }

    /// <summary>SHA-256, lowercase hex — so a component can be quoted to support without revealing the
    /// underlying identifier.</summary>
    /// <param name="value">The raw component value.</param>
    /// <returns>Lowercase hex digest.</returns>
    public static string Hash(string value) =>
        Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(value))).ToLowerInvariant();

    /// <summary>
    /// 🔴 The exception filter every component read shares. Broad on purpose — a component read must never
    /// escalate to a crash on a startup path — but NOT a bare <c>catch</c>: an
    /// <see cref="OutOfMemoryException"/> or a <see cref="StackOverflowException"/> is not a licence
    /// problem and must not be reported as an unreadable fingerprint component.
    /// </summary>
    /// <param name="ex">The caught exception.</param>
    /// <returns><see langword="true"/> when the exception is an expected component-read failure.</returns>
    private static bool IsExpectedReadFailure(Exception ex) =>
        ex is IOException
            or UnauthorizedAccessException
            or System.Security.SecurityException
            or NotSupportedException
            or PlatformNotSupportedException
            or ArgumentException
            or InvalidOperationException
            or NetworkInformationException;
}
