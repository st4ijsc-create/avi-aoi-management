using System.Runtime.Versioning;
using St4i.EdgeCore.Identity;
using Xunit;

namespace St4i.EdgeCore.Tests.Licensing;

/// <summary>
/// 🔴 WS-E — <b>the riskiest thing about the fingerprint design, made visible.</b>
///
/// <para><see cref="DeviceIdentityStore.TryLoad"/> treats ANY read failure as "no stored identity" and
/// <see cref="DeviceIdentityStore.LoadOrCreate"/> then regenerates — correct for that store's own purpose
/// (a device must always have a usable identity), but it means the licence fingerprint's first component
/// can change <b>with no hardware change at all</b>: a power cut mid-write on a factory floor, a DPAPI
/// scope change, a blob copied in from another machine.</para>
///
/// <para>The failure chain: corruption → silent regeneration → the machine is now at 3-of-4 → one more
/// ordinary event (the NIC swap the tolerance was designed to survive) takes it to 2-of-4 and the paid
/// features switch off. The tolerance built to prevent a 3am call has been spent by an unrelated
/// subsystem's recovery path, and nobody knows until the features go.</para>
///
/// <para><see cref="DeviceIdentityStore.WasRegenerated"/> does not prevent any of that — preventing it
/// would break the contract the store is built on. It makes the event REPORTABLE, so a machine one event
/// away from refusing is visible before it refuses rather than after.</para>
/// </summary>
[SupportedOSPlatform("windows")]
public sealed class DeviceIdentityRegenerationSignalTests : IDisposable
{
    private readonly string _dir;

    /// <summary>Throwaway identity root per test class.</summary>
    public DeviceIdentityRegenerationSignalTests()
    {
        _dir = Path.Combine(Path.GetTempPath(), "st4i-regen-tests", Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(_dir);
    }

    /// <summary>Removes the throwaway root.</summary>
    public void Dispose()
    {
        try { Directory.Delete(_dir, recursive: true); } catch (IOException) { /* best effort */ }
    }

    /// <summary>A first run mints an identity, so the flag is set — this IS a regeneration relative to
    /// any licence issued before it.</summary>
    [Fact]
    public void A_first_run_reports_the_identity_as_regenerated()
    {
        var store = new DeviceIdentityStore(_dir, (_, _) => { });

        Assert.False(store.WasRegenerated); // nothing has been asked of it yet

        var identity = store.LoadOrCreate("test-node");

        Assert.NotNull(identity);
        Assert.True(store.WasRegenerated);
    }

    /// <summary>
    /// 🔴 <b>NEGATIVE CONTROL, and the assertion the whole signal rests on.</b> A store that LOADED an
    /// existing identity must report <see langword="false"/>. Without this, a flag hardwired to
    /// <see langword="true"/> would pass the test above and make the signal meaningless — it would fire on
    /// every boot and stop being read, which is exactly how a warning dies.
    /// </summary>
    [Fact]
    public void Loading_an_existing_identity_does_not_report_a_regeneration()
    {
        var first = new DeviceIdentityStore(_dir, (_, _) => { });
        var minted = first.LoadOrCreate("test-node");
        Assert.True(first.WasRegenerated);

        // A SECOND store over the same directory: this one loads rather than mints.
        var second = new DeviceIdentityStore(_dir, (_, _) => { });
        var loaded = second.LoadOrCreate("test-node");

        Assert.False(second.WasRegenerated);
        Assert.Equal(minted.Fingerprint, loaded.Fingerprint); // and it really is the same identity
    }

    /// <summary>
    /// 🔴 <b>THE FAILURE THIS SIGNAL EXISTS FOR, SIMULATED:</b> a corrupted identity blob — what a power
    /// cut mid-write leaves behind — is silently discarded and a NEW identity minted, with no hardware
    /// change whatsoever. The fingerprint's first component has moved, and the flag is what says so.
    /// </summary>
    [Fact]
    public void A_corrupt_identity_blob_regenerates_silently_and_the_flag_is_what_reports_it()
    {
        var first = new DeviceIdentityStore(_dir, (_, _) => { });
        var original = first.LoadOrCreate("test-node");

        // Simulate the power cut: replace the sealed blob with garbage.
        File.WriteAllBytes(Path.Combine(_dir, "device-identity.bin"), [0xDE, 0xAD, 0xBE, 0xEF]);

        var after = new DeviceIdentityStore(_dir, (_, _) => { });
        var replacement = after.LoadOrCreate("test-node");

        // The identity CHANGED with no hardware change — this is the whole problem.
        Assert.NotEqual(original.Fingerprint, replacement.Fingerprint);

        // 🔴 And it is no longer silent.
        Assert.True(after.WasRegenerated);
    }

    /// <summary>
    /// 🔴 A deliberate operator ROTATION does not set the flag. Conflating a chosen action with a silent
    /// recovery would make the one signal that means "something went wrong unnoticed" fire routinely on
    /// something somebody chose — which is how a signal stops being read.
    /// </summary>
    [Fact]
    public void A_deliberate_rotation_is_not_reported_as_a_silent_regeneration()
    {
        var store = new DeviceIdentityStore(_dir, (_, _) => { });
        _ = store.LoadOrCreate("test-node");

        var fresh = new DeviceIdentityStore(_dir, (_, _) => { });
        _ = fresh.TryLoad();
        Assert.False(fresh.WasRegenerated);

        _ = fresh.Rotate("test-node");

        Assert.False(fresh.WasRegenerated);
    }

    /// <summary><see cref="DeviceIdentityStore.TryLoad"/> alone never mints, so a fingerprint READ cannot
    /// change the value it is reporting.</summary>
    [Fact]
    public void TryLoad_on_an_empty_root_neither_mints_nor_reports_a_regeneration()
    {
        var store = new DeviceIdentityStore(_dir, (_, _) => { });

        Assert.Null(store.TryLoad());
        Assert.False(store.WasRegenerated);
        Assert.False(File.Exists(Path.Combine(_dir, "device-identity.bin")));
    }
}
