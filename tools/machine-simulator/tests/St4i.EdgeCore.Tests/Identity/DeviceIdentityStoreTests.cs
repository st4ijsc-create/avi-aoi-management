using System.Security.Cryptography;
using System.Security.Cryptography.X509Certificates;
using St4i.EdgeCore.Identity;
using Xunit;

namespace St4i.EdgeCore.Tests.Identity;

/// <summary>
/// GĐ3 EC-1 — <see cref="DeviceIdentityStore"/>: <c>LoadOrCreate</c> is idempotent (a second store
/// instance pointed at the same directory sees the SAME persisted cert, not a freshly regenerated one),
/// the exported PEM round-trips through an independent parse, <see cref="DeviceIdentityStore.TryLoad"/>
/// never mints an identity as a side effect, a corrupted stored blob is tolerated (regenerate rather than
/// throw — same "never crash the caller over a bad file" stance as
/// <see cref="St4i.EdgeCore.Infrastructure.CredentialStore"/> and
/// <see cref="St4i.EdgeCore.Config.FleetSettingsStore"/>), and <c>nodeId</c> only matters on the very
/// first (create) call — a later <c>LoadOrCreate</c> with a different nodeId still returns the originally
/// persisted identity.
/// </summary>
public sealed class DeviceIdentityStoreTests : IDisposable
{
    private readonly List<string> _tempDirs = new();

    public void Dispose()
    {
        foreach (var dir in _tempDirs)
        {
            try { Directory.Delete(dir, recursive: true); } catch { /* best-effort cleanup */ }
        }
    }

    private string NewTempDir()
    {
        var dir = Directory.CreateTempSubdirectory("st4i-device-identity-tests-").FullName;
        _tempDirs.Add(dir);
        return dir;
    }

    [Fact]
    public void LoadOrCreate_FirstCall_GeneratesAPersistedIdentityWithAPrivateKeyAndTheGivenNodeId()
    {
        var store = new DeviceIdentityStore(NewTempDir());

        var identity = store.LoadOrCreate("NODE-1");

        Assert.True(identity.Certificate.HasPrivateKey);
        Assert.Contains("NODE-1", identity.Certificate.Subject);
        Assert.Equal("NODE-1", identity.NodeId);
        Assert.NotEmpty(identity.Fingerprint);
    }

    [Fact]
    public void LoadOrCreate_SecondCallFromANewStoreInstance_ReturnsTheSamePersistedCertificate()
    {
        var dir = NewTempDir();
        var first = new DeviceIdentityStore(dir).LoadOrCreate("NODE-1");

        var second = new DeviceIdentityStore(dir).LoadOrCreate("NODE-1"); // simulates a process restart

        Assert.Equal(first.Fingerprint, second.Fingerprint);
        Assert.True(second.Certificate.HasPrivateKey);
    }

    [Fact]
    public void CertificatePem_StartsWithThePemHeader_AndReparsesToTheSameFingerprint()
    {
        var store = new DeviceIdentityStore(NewTempDir());
        var identity = store.LoadOrCreate("NODE-1");

        Assert.StartsWith("-----BEGIN CERTIFICATE-----", identity.CertificatePem);

        using var reparsed = X509Certificate2.CreateFromPem(identity.CertificatePem);
        Assert.Equal(identity.Fingerprint, reparsed.GetCertHashString(HashAlgorithmName.SHA256));
    }

    [Fact]
    public void TryLoad_BeforeAnyCreate_ReturnsNull()
    {
        var store = new DeviceIdentityStore(NewTempDir());

        Assert.Null(store.TryLoad());
    }

    [Fact]
    public void TryLoad_AfterLoadOrCreate_ReturnsTheSamePersistedIdentity_WithoutMintingANewOne()
    {
        var store = new DeviceIdentityStore(NewTempDir());
        var created = store.LoadOrCreate("NODE-1");

        var loaded = store.TryLoad();

        Assert.NotNull(loaded);
        Assert.Equal(created.Fingerprint, loaded!.Fingerprint);
    }

    [Fact]
    public void LoadOrCreate_CorruptStoredBlob_RegeneratesAFreshIdentityInsteadOfThrowing()
    {
        var dir = NewTempDir();
        var original = new DeviceIdentityStore(dir).LoadOrCreate("NODE-1");

        File.WriteAllBytes(Path.Combine(dir, "device-identity.bin"), new byte[] { 1, 2, 3, 4, 5, 6, 7, 8 });

        var regenerated = new DeviceIdentityStore(dir).LoadOrCreate("NODE-1");

        Assert.True(regenerated.Certificate.HasPrivateKey);
        Assert.NotEmpty(regenerated.Fingerprint);
        Assert.NotEqual(original.Fingerprint, regenerated.Fingerprint);
    }

    [Fact]
    public void LoadOrCreate_NodeIdIsUsedOnlyAtCreate_ALaterCallWithADifferentNodeIdReturnsThePersistedIdentity()
    {
        var dir = NewTempDir();
        var createdAsNodeA = new DeviceIdentityStore(dir).LoadOrCreate("NODE-A");

        var loadedAsNodeB = new DeviceIdentityStore(dir).LoadOrCreate("NODE-B");

        Assert.Equal(createdAsNodeA.Fingerprint, loadedAsNodeB.Fingerprint);
        Assert.Equal("NODE-A", loadedAsNodeB.NodeId);
    }

    [Fact]
    public void Fingerprint_MatchesTheCertificatesOwnSha256HashString()
    {
        var store = new DeviceIdentityStore(NewTempDir());
        var identity = store.LoadOrCreate("NODE-1");

        Assert.Equal(identity.Certificate.GetCertHashString(HashAlgorithmName.SHA256), identity.Fingerprint);
        Assert.Matches("^[0-9A-F]+$", identity.Fingerprint);
    }

    [Fact]
    public void ResolveRoot_ExplicitDirectory_TakesPriorityOverEnvVar()
    {
        var previous = Environment.GetEnvironmentVariable(DeviceIdentityStore.EnvVarDir);
        try
        {
            Environment.SetEnvironmentVariable(DeviceIdentityStore.EnvVarDir, Path.Combine(Path.GetTempPath(), "st4i-identity-env-should-not-win"));
            var explicitDir = Path.Combine(Path.GetTempPath(), "st4i-identity-explicit-" + Guid.NewGuid().ToString("N"));

            Assert.Equal(explicitDir, DeviceIdentityStore.ResolveRoot(explicitDir));
        }
        finally
        {
            Environment.SetEnvironmentVariable(DeviceIdentityStore.EnvVarDir, previous);
        }
    }

    [Fact]
    public void ResolveRoot_EnvOverride_ReturnsConfiguredDirectory()
    {
        var previous = Environment.GetEnvironmentVariable(DeviceIdentityStore.EnvVarDir);
        try
        {
            var tempDir = Path.Combine(Path.GetTempPath(), "st4i-identity-env-" + Guid.NewGuid().ToString("N"));
            Environment.SetEnvironmentVariable(DeviceIdentityStore.EnvVarDir, tempDir);

            Assert.Equal(tempDir, DeviceIdentityStore.ResolveRoot());
        }
        finally
        {
            Environment.SetEnvironmentVariable(DeviceIdentityStore.EnvVarDir, previous);
        }
    }

    [Fact]
    public void DefaultRoot_IsSiblingOfCredsDefaultDir_NotTheSameDirectory()
    {
        var credsDefaultRoot = Path.Combine(
            Environment.GetFolderPath(Environment.SpecialFolder.CommonApplicationData), "ST4I", "sim", "creds");

        var identityDefaultRoot = DeviceIdentityStore.DefaultRoot();

        Assert.NotEqual(credsDefaultRoot, identityDefaultRoot);
        Assert.Equal(Path.GetDirectoryName(credsDefaultRoot), Path.GetDirectoryName(identityDefaultRoot));
    }
}
