using System.Runtime.Versioning;
using St4i.EdgeCore.Identity;
using St4i.EdgeCore.Licensing;
using Xunit;

namespace St4i.EdgeCore.Tests.Licensing;

/// <summary>
/// WS-E — the fingerprint's tolerance arithmetic and its failure behaviour.
///
/// <para>This is the decision that generates 3am calls, so it is tested around <b>what breaks</b> rather
/// than what identifies: a NIC swap, a disk replacement, a clone onto new hardware, and a component that
/// simply cannot be read on a given appliance.</para>
/// </summary>
[SupportedOSPlatform("windows")]
public sealed class MachineFingerprintTests
{
    private static LicenseFingerprint Fp(string? a = "a", string? b = "b", string? c = "c", string? d = "d") =>
        new(a, b, c, d);

    /// <summary>🔴 3-of-4 tolerates exactly one hardware event at a time — a disk swap breaks the volume
    /// serial alone, a NIC swap breaks the MAC alone, and both survive. That is what actually happens in
    /// the field, and the reason the threshold is not 4-of-4.</summary>
    [Fact]
    public void Three_of_four_survives_a_single_hardware_event()
    {
        var issued = Fp();

        var afterDiskSwap = Fp(c: "NEW-DISK");
        Assert.Equal(3, MachineFingerprint.CountMatches(issued, afterDiskSwap, out _));

        var afterNicSwap = Fp(d: "NEW-NIC");
        Assert.Equal(3, MachineFingerprint.CountMatches(issued, afterNicSwap, out _));
    }

    /// <summary>🔴 A disk-image clone onto new hardware breaks BOTH the volume serial and the MAC while
    /// the device identity and MachineGuid ride along in the image — 2-of-4, correctly refused. This is
    /// the revenue leak 2-of-4 would have left open.</summary>
    [Fact]
    public void A_clone_onto_new_hardware_falls_below_the_threshold()
    {
        var issued = Fp();
        var clone = Fp(c: "OTHER-DISK", d: "OTHER-NIC");

        var matches = MachineFingerprint.CountMatches(issued, clone, out var mismatched);

        Assert.Equal(2, matches);
        Assert.True(matches < MachineFingerprint.RequiredMatches(null));
        Assert.Equal(["volumeSerial", "primaryMac"], mismatched);
    }

    /// <summary>🔴 A component that could not be READ counts as NOT MATCHING — never as an exception and
    /// never as a match. Counting an unreadable component as a match would let a machine that can read
    /// nothing match every licence.</summary>
    [Fact]
    public void An_unreadable_component_never_counts_as_a_match()
    {
        var issued = Fp();

        // Unreadable on this machine (null observed).
        Assert.Equal(3, MachineFingerprint.CountMatches(issued, Fp(d: null), out _));

        // Unspecified in the licence (null expected) — likewise not a match.
        Assert.Equal(3, MachineFingerprint.CountMatches(Fp(d: null), Fp(), out _));

        // 🔴 The pathological case: nothing readable at all must be ZERO matches, not four.
        Assert.Equal(0, MachineFingerprint.CountMatches(issued, Fp(null, null, null, null), out _));
        Assert.Equal(0, MachineFingerprint.CountMatches(null, Fp(), out _));
        Assert.Equal(0, MachineFingerprint.CountMatches(Fp(), null, out _));
    }

    /// <summary>🔴 <b>NEGATIVE CONTROL.</b> The tests above are about mismatches; a counter that returned 0
    /// for everything would pass most of them. This proves an identical fingerprint scores 4.</summary>
    [Fact]
    public void An_identical_fingerprint_matches_all_four()
    {
        Assert.Equal(4, MachineFingerprint.CountMatches(Fp(), Fp(), out var mismatched));
        Assert.Empty(mismatched);
    }

    /// <summary>The signed policy is honoured, so ST4I can issue a looser licence to a customer with a
    /// documented hardware quirk without shipping a new binary.</summary>
    [Fact]
    public void The_signed_policy_sets_the_threshold()
    {
        Assert.Equal(3, MachineFingerprint.RequiredMatches(null));
        Assert.Equal(2, MachineFingerprint.RequiredMatches(new LicenseFingerprintPolicy(2, null)));
        Assert.Equal(4, MachineFingerprint.RequiredMatches(new LicenseFingerprintPolicy(4, null)));
    }

    /// <summary>🔴 A policy of 0 would bind to nothing (one licence, every machine) and a policy above 4
    /// could never be satisfied (a paid machine bricked). Neither is a value ST4I would issue, so both are
    /// clamped — up for revenue, down for the customer, each the safe direction for its own error.</summary>
    [Fact]
    public void An_impossible_policy_is_clamped_in_the_safe_direction()
    {
        Assert.Equal(1, MachineFingerprint.RequiredMatches(new LicenseFingerprintPolicy(0, null)));
        Assert.Equal(1, MachineFingerprint.RequiredMatches(new LicenseFingerprintPolicy(-5, null)));
        Assert.Equal(4, MachineFingerprint.RequiredMatches(new LicenseFingerprintPolicy(99, null)));
    }

    /// <summary>Reading the real machine never throws, and reports whether the device identity was
    /// regenerated during the read.</summary>
    [Fact]
    public void Reading_the_real_machine_never_throws()
    {
        var dir = Path.Combine(Path.GetTempPath(), "st4i-fp-tests", Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(dir);
        try
        {
            var store = new DeviceIdentityStore(dir, (_, _) => { });
            var fingerprint = MachineFingerprint.Read(store, out var regenerated);

            Assert.NotNull(fingerprint);

            // 🔴 Read() uses TryLoad, never LoadOrCreate: reporting a fingerprint must not MINT an
            // identity, or GET /v1/license/fingerprint would change the value it is reporting.
            Assert.False(regenerated);
            Assert.Null(fingerprint.DeviceIdentity); // nothing stored yet in this throwaway root
            Assert.False(File.Exists(Path.Combine(dir, "device-identity.bin")));

            // Non-vacuity: at least one component must actually be readable on a real machine, or this
            // test is measuring nothing and the whole scheme is unreachable here.
            Assert.True(
                fingerprint.MachineGuid is not null || fingerprint.VolumeSerial is not null ||
                fingerprint.PrimaryMac is not null,
                "No fingerprint component was readable on this machine; 3-of-4 would be unreachable.");
        }
        finally
        {
            try { Directory.Delete(dir, recursive: true); } catch (IOException) { /* best effort */ }
        }
    }

    /// <summary>Hashing is stable and does not leak the underlying identifier.</summary>
    [Fact]
    public void Hashing_is_stable_and_opaque()
    {
        Assert.Equal(MachineFingerprint.Hash("abc"), MachineFingerprint.Hash("abc"));
        Assert.NotEqual(MachineFingerprint.Hash("abc"), MachineFingerprint.Hash("abd"));
        Assert.Equal(64, MachineFingerprint.Hash("abc").Length);
        Assert.DoesNotContain("abc", MachineFingerprint.Hash("abc"), StringComparison.Ordinal);
    }

    /// <summary>The four component names are exactly what the signed policy quantifies over.</summary>
    [Fact]
    public void The_component_names_are_the_four_the_design_names()
    {
        Assert.Equal(
            ["deviceIdentity", "machineGuid", "volumeSerial", "primaryMac"],
            MachineFingerprint.ComponentNames);
    }
}
