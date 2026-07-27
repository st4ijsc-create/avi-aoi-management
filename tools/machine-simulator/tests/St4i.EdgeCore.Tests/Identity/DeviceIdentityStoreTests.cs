using System.Net;
using System.Net.Security;
using System.Net.Sockets;
using System.Security.Authentication;
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

    // EC-1 review C-1/I-1 — the regression test that would have caught the EphemeralKeySet bug: a
    // real SslStream mutual-TLS loopback handshake using the EXACT certificate DeviceIdentityStore hands
    // out. Under EphemeralKeySet this fails on Windows/schannel with an AuthenticationException
    // (SEC_E_UNKNOWN_CREDENTIALS) even though Certificate.HasPrivateKey reports true — HasPrivateKey alone
    // is NOT proof the key is usable for a TLS handshake. Uses the store's own generated cert as BOTH the
    // server and client certificate (self-signed; a permissive RemoteCertificateValidationCallback accepts
    // it on both sides) — this test is about key USABILITY for schannel, not chain-of-trust validation.
    [Fact]
    public async Task Certificate_LoadedFromStore_CanCompleteARealMutualTlsHandshake()
    {
        var store = new DeviceIdentityStore(NewTempDir());
        var identity = store.LoadOrCreate("NODE-MTLS");

        var listener = new TcpListener(IPAddress.Loopback, 0);
        listener.Start();
        var port = ((IPEndPoint)listener.LocalEndpoint).Port;

        Exception? serverError = null;
        Exception? clientError = null;
        var serverSawClientCert = false;

        var serverTask = Task.Run(async () =>
        {
            try
            {
                using var connection = await listener.AcceptTcpClientAsync();
                using var ssl = new SslStream(connection.GetStream(), leaveInnerStreamOpen: false);
                var options = new SslServerAuthenticationOptions
                {
                    ServerCertificate = identity.Certificate,
                    ClientCertificateRequired = true,
                    EnabledSslProtocols = SslProtocols.Tls12 | SslProtocols.Tls13,
                    RemoteCertificateValidationCallback = (_, _, _, _) => true,
                };
                await ssl.AuthenticateAsServerAsync(options, CancellationToken.None);
                serverSawClientCert = ssl.RemoteCertificate is not null;

                var buffer = new byte[1];
                _ = await ssl.ReadAsync(buffer);
            }
            catch (Exception ex)
            {
                serverError = ex;
            }
        });

        var clientTask = Task.Run(async () =>
        {
            try
            {
                using var tcp = new TcpClient();
                await tcp.ConnectAsync(IPAddress.Loopback, port);
                using var ssl = new SslStream(tcp.GetStream(), leaveInnerStreamOpen: false);
                var options = new SslClientAuthenticationOptions
                {
                    TargetHost = "localhost",
                    ClientCertificates = new X509CertificateCollection { identity.Certificate },
                    EnabledSslProtocols = SslProtocols.Tls12 | SslProtocols.Tls13,
                    RemoteCertificateValidationCallback = (_, _, _, _) => true,
                };
                await ssl.AuthenticateAsClientAsync(options, CancellationToken.None);
                await ssl.WriteAsync(new byte[] { 42 });
            }
            catch (Exception ex)
            {
                clientError = ex;
            }
        });

        var both = Task.WhenAll(serverTask, clientTask);
        var finished = await Task.WhenAny(both, Task.Delay(TimeSpan.FromSeconds(15)));
        listener.Stop();

        Assert.True(ReferenceEquals(finished, both), "mTLS handshake timed out");
        Assert.True(clientError is null, $"client-side handshake threw: {clientError}");
        Assert.True(serverError is null, $"server-side handshake threw: {serverError}");
        Assert.True(serverSawClientCert, "server did not receive a client certificate during the handshake");
    }

    // EC-1 review M-1 — nodeId is interpolated into an X.500 "CN=<nodeId>" DN string; raw DN
    // metacharacters (',', '=', '"') or a whitespace-only nodeId must not throw out of Create (breaking
    // LoadOrCreate's never-throw promise) or silently corrupt the subject into extra bogus RDNs.
    [Theory]
    [InlineData("a,b=c\"d ")]
    [InlineData("   ")]
    public void LoadOrCreate_NodeIdWithDnMetacharactersOrWhitespaceOnly_DoesNotThrow_AndYieldsAUsableCert(string weirdNodeId)
    {
        var store = new DeviceIdentityStore(NewTempDir());

        var exception = Record.Exception(() => store.LoadOrCreate(weirdNodeId));

        Assert.Null(exception);
        var identity = store.TryLoad();
        Assert.NotNull(identity);
        Assert.True(identity!.Certificate.HasPrivateKey);
        Assert.NotEmpty(identity.Fingerprint);
    }
}
